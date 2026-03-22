// room.rs — RoomClient v2 for EdgeBase Rust SDK.
//
// Complete redesign from v1:
//   - 2 client-visible state areas: sharedState (all clients), playerState (per-player)
//   - Client can only read + subscribe + send(). All writes are server-only.
//   - send() returns a Result resolved by requestId matching via oneshot channel
//   - Subscription returns a Subscription struct with unsubscribe()
//   - namespace + roomId identification (replaces single roomId)
//
// Usage:
//   let room = RoomClient::new(&url, "game", "lobby-1", move || token.clone(), None);
//   room.join().await?;
//   let sub = room.on_shared_state(|state, changes| { ... });
//   let result = room.send("SET_SCORE", Some(json!({"score": 42}))).await?;
//   sub.unsubscribe();
//   room.leave().await;

use crate::error::Error;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};
use tokio::sync::{mpsc, oneshot};
use tokio::time::{sleep, timeout, Duration};
use uuid::Uuid;

// ── Public types ──────────────────────────────────────────────────────────────

pub struct RoomOptions {
    pub auto_reconnect: bool,
    pub max_reconnect_attempts: u32,
    pub reconnect_base_delay_ms: u64,
    /// Timeout for send() requests in ms (default: 10000)
    pub send_timeout_ms: u64,
    /// Timeout for WebSocket connection establishment in ms (default: 15000)
    pub connection_timeout_ms: u64,
}

impl Default for RoomOptions {
    fn default() -> Self {
        Self {
            auto_reconnect: true,
            max_reconnect_attempts: 10,
            reconnect_base_delay_ms: 1000,
            send_timeout_ms: 10_000,
            connection_timeout_ms: 15_000,
        }
    }
}

// ── Subscription ──────────────────────────────────────────────────────────────

/// Handle returned by on_* methods. Call `unsubscribe()` to remove the handler.
pub struct Subscription {
    remove_fn: Mutex<Option<Box<dyn FnOnce() + Send>>>,
}

impl Subscription {
    fn new(remove_fn: impl FnOnce() + Send + 'static) -> Self {
        Self {
            remove_fn: Mutex::new(Some(Box::new(remove_fn))),
        }
    }

    /// Remove the handler. Safe to call multiple times (subsequent calls are no-ops).
    pub fn unsubscribe(self) {
        if let Some(f) = self.remove_fn.lock().unwrap().take() {
            f();
        }
    }
}

impl Drop for Subscription {
    fn drop(&mut self) {
        if let Some(f) = self.remove_fn.lock().unwrap().take() {
            f();
        }
    }
}

// ── Handler type aliases (internal) ──────────────────────────────────────────

type StateHandler = Arc<dyn Fn(&Value, &Value) + Send + Sync>;
type MessageHandler = Arc<dyn Fn(&Value) + Send + Sync>;
type ErrorHandler = Arc<dyn Fn(&str, &str) + Send + Sync>;
type KickedHandler = Arc<dyn Fn() + Send + Sync>;
type MembersSyncHandler = Arc<dyn Fn(&Value) + Send + Sync>;
type MemberHandler = Arc<dyn Fn(&Value) + Send + Sync>;
type MemberLeaveHandler = Arc<dyn Fn(&Value, &str) + Send + Sync>;
type MemberStateHandler = Arc<dyn Fn(&Value, &Value) + Send + Sync>;
type SignalHandler = Arc<dyn Fn(&Value, &Value) + Send + Sync>;
type AnySignalHandler = Arc<dyn Fn(&str, &Value, &Value) + Send + Sync>;
type MediaTrackHandler = Arc<dyn Fn(&Value, &Value) + Send + Sync>;
type MediaStateHandler = Arc<dyn Fn(&Value, &Value) + Send + Sync>;
type MediaDeviceHandler = Arc<dyn Fn(&Value, &Value) + Send + Sync>;
type ReconnectHandler = Arc<dyn Fn(&Value) + Send + Sync>;
type ConnectionStateHandler = Arc<dyn Fn(&str) + Send + Sync>;

/// ID-tagged handler entry for removal by Subscription.
type HandlerList<H> = Arc<Mutex<Vec<(u64, H)>>>;

pub(crate) enum RoomWsCommand {
    Send(String),
    Close,
}

const ROOM_EXPLICIT_LEAVE_CLOSE_DELAY: Duration = Duration::from_millis(40);
const ROOM_STATE_IDLE: &str = "idle";
const ROOM_STATE_CONNECTING: &str = "connecting";
const ROOM_STATE_CONNECTED: &str = "connected";
const ROOM_STATE_RECONNECTING: &str = "reconnecting";
const ROOM_STATE_DISCONNECTED: &str = "disconnected";
const ROOM_STATE_KICKED: &str = "kicked";

// ── RoomClient v2 ─────────────────────────────────────────────────────────────

pub struct RoomClient {
    /// Room namespace (e.g. "game", "chat")
    pub namespace: String,
    /// Room instance ID within the namespace
    pub room_id: String,

    // ── State ───
    shared_state: RwLock<Value>,
    shared_version: RwLock<u64>,
    player_state: RwLock<Value>,
    player_version: RwLock<u64>,
    members: RwLock<Value>,
    media_members: RwLock<Value>,
    current_user_id: Mutex<Option<String>>,
    current_connection_id: Mutex<Option<String>>,
    connection_state: RwLock<String>,
    reconnect_info: RwLock<Option<Value>>,

    // ── Config ───
    base_url: String,
    token_fn: Box<dyn Fn() -> String + Send + Sync>,
    opts: RoomOptions,

    // ── Handlers (Arc-wrapped so Subscription closures can hold clones) ───
    shared_state_handlers: HandlerList<StateHandler>,
    player_state_handlers: HandlerList<StateHandler>,
    message_handlers: Arc<Mutex<HashMap<String, Vec<(u64, MessageHandler)>>>>,
    error_handlers: HandlerList<ErrorHandler>,
    kicked_handlers: HandlerList<KickedHandler>,
    member_sync_handlers: HandlerList<MembersSyncHandler>,
    member_join_handlers: HandlerList<MemberHandler>,
    member_leave_handlers: HandlerList<MemberLeaveHandler>,
    member_state_handlers: HandlerList<MemberStateHandler>,
    signal_handlers: Arc<Mutex<HashMap<String, Vec<(u64, SignalHandler)>>>>,
    any_signal_handlers: HandlerList<AnySignalHandler>,
    media_track_handlers: HandlerList<MediaTrackHandler>,
    media_track_removed_handlers: HandlerList<MediaTrackHandler>,
    media_state_handlers: HandlerList<MediaStateHandler>,
    media_device_handlers: HandlerList<MediaDeviceHandler>,
    reconnect_handlers: HandlerList<ReconnectHandler>,
    connection_state_handlers: HandlerList<ConnectionStateHandler>,
    handler_id_counter: Mutex<u64>,

    // ── Pending send() requests (requestId → oneshot Sender) ───
    pending_requests: Mutex<HashMap<String, oneshot::Sender<Result<Value, Error>>>>,
    pending_signal_requests: Mutex<HashMap<String, oneshot::Sender<Result<(), Error>>>>,
    pending_admin_requests: Mutex<HashMap<String, oneshot::Sender<Result<(), Error>>>>,
    pending_member_state_requests: Mutex<HashMap<String, oneshot::Sender<Result<(), Error>>>>,
    pending_media_requests: Mutex<HashMap<String, oneshot::Sender<Result<(), Error>>>>,

    // ── WS send channel ───
    send_tx: Mutex<Option<mpsc::Sender<RoomWsCommand>>>,

    // ── Control ───
    stop_tx: Mutex<Option<mpsc::Sender<()>>>,
    intentionally_left: Mutex<bool>,
}

impl RoomClient {
    /// Create a new v2 RoomClient.
    ///
    /// # Arguments
    /// * `base_url` - EdgeBase server URL (http or https)
    /// * `namespace` - Room namespace (e.g. "game", "chat")
    /// * `room_id` - Room instance ID within the namespace
    /// * `token_fn` - Closure that returns the current access token
    /// * `opts` - Optional RoomOptions for reconnect and timeout configuration
    pub fn new(
        base_url: &str,
        namespace: &str,
        room_id: &str,
        token_fn: impl Fn() -> String + Send + Sync + 'static,
        opts: Option<RoomOptions>,
    ) -> Arc<Self> {
        Arc::new(Self {
            namespace: namespace.to_string(),
            room_id: room_id.to_string(),
            shared_state: RwLock::new(json!({})),
            shared_version: RwLock::new(0),
            player_state: RwLock::new(json!({})),
            player_version: RwLock::new(0),
            members: RwLock::new(json!([])),
            media_members: RwLock::new(json!([])),
            current_user_id: Mutex::new(None),
            current_connection_id: Mutex::new(None),
            connection_state: RwLock::new(ROOM_STATE_IDLE.to_string()),
            reconnect_info: RwLock::new(None),
            base_url: base_url.trim_end_matches('/').to_string(),
            token_fn: Box::new(token_fn),
            opts: opts.unwrap_or_default(),
            shared_state_handlers: Arc::new(Mutex::new(vec![])),
            player_state_handlers: Arc::new(Mutex::new(vec![])),
            message_handlers: Arc::new(Mutex::new(HashMap::new())),
            error_handlers: Arc::new(Mutex::new(vec![])),
            kicked_handlers: Arc::new(Mutex::new(vec![])),
            member_sync_handlers: Arc::new(Mutex::new(vec![])),
            member_join_handlers: Arc::new(Mutex::new(vec![])),
            member_leave_handlers: Arc::new(Mutex::new(vec![])),
            member_state_handlers: Arc::new(Mutex::new(vec![])),
            signal_handlers: Arc::new(Mutex::new(HashMap::new())),
            any_signal_handlers: Arc::new(Mutex::new(vec![])),
            media_track_handlers: Arc::new(Mutex::new(vec![])),
            media_track_removed_handlers: Arc::new(Mutex::new(vec![])),
            media_state_handlers: Arc::new(Mutex::new(vec![])),
            media_device_handlers: Arc::new(Mutex::new(vec![])),
            reconnect_handlers: Arc::new(Mutex::new(vec![])),
            connection_state_handlers: Arc::new(Mutex::new(vec![])),
            handler_id_counter: Mutex::new(0),
            pending_requests: Mutex::new(HashMap::new()),
            pending_signal_requests: Mutex::new(HashMap::new()),
            pending_admin_requests: Mutex::new(HashMap::new()),
            pending_member_state_requests: Mutex::new(HashMap::new()),
            pending_media_requests: Mutex::new(HashMap::new()),
            send_tx: Mutex::new(None),
            stop_tx: Mutex::new(None),
            intentionally_left: Mutex::new(false),
        })
    }

    // ── State Accessors ──────────────────────────────────────────────────────

    /// Get current shared state (read-only snapshot).
    pub fn get_shared_state(&self) -> Value {
        self.shared_state.read().unwrap().clone()
    }

    /// Get current player state (read-only snapshot).
    pub fn get_player_state(&self) -> Value {
        self.player_state.read().unwrap().clone()
    }

    /// Get the current logical room members snapshot.
    pub fn list_members(&self) -> Value {
        self.members.read().unwrap().clone()
    }

    /// Get the current media member snapshot.
    pub fn list_media_members(&self) -> Value {
        self.media_members.read().unwrap().clone()
    }

    /// Get the current session connection state.
    pub fn connection_state(&self) -> String {
        self.connection_state.read().unwrap().clone()
    }

    pub fn state(self: &Arc<Self>) -> RoomStateNamespace {
        RoomStateNamespace::new(Arc::clone(self))
    }

    pub fn meta(self: &Arc<Self>) -> RoomMetaNamespace {
        RoomMetaNamespace::new(Arc::clone(self))
    }

    pub fn signals(self: &Arc<Self>) -> RoomSignalsNamespace {
        RoomSignalsNamespace::new(Arc::clone(self))
    }

    pub fn members(self: &Arc<Self>) -> RoomMembersNamespace {
        RoomMembersNamespace::new(Arc::clone(self))
    }

    pub fn admin(self: &Arc<Self>) -> RoomAdminNamespace {
        RoomAdminNamespace::new(Arc::clone(self))
    }

    pub fn media(self: &Arc<Self>) -> RoomMediaNamespace {
        RoomMediaNamespace::new(Arc::clone(self))
    }

    pub fn session(self: &Arc<Self>) -> RoomSessionNamespace {
        RoomSessionNamespace::new(Arc::clone(self))
    }

    // ── Metadata (HTTP, no WebSocket needed) ─────────────────────────────────

    /// Get room metadata without joining (HTTP GET).
    /// Returns developer-defined metadata set by room.setMetadata() on the server.
    pub async fn get_metadata(&self) -> Result<Value, Error> {
        Self::get_metadata_static(&self.base_url, &self.namespace, &self.room_id).await
    }

    /// Static: Get room metadata without creating a RoomClient instance.
    /// Useful for lobby screens where you need room info before joining.
    pub async fn get_metadata_static(
        base_url: &str,
        namespace: &str,
        room_id: &str,
    ) -> Result<Value, Error> {
        let url = format!(
            "{}/api/room/metadata?namespace={}&id={}",
            base_url.trim_end_matches('/'),
            urlencoding::encode(namespace),
            urlencoding::encode(room_id)
        );
        let resp = reqwest::get(&url)
            .await
            .map_err(|e| Error::Room(format!("Failed to get room metadata: {}", e)))?;
        if !resp.status().is_success() {
            return Err(Error::Room(format!(
                "Failed to get room metadata: {}",
                resp.status()
            )));
        }
        let body = resp
            .text()
            .await
            .map_err(|e| Error::Room(format!("Failed to read room metadata body: {}", e)))?;
        serde_json::from_str(&body)
            .map_err(|e| Error::Room(format!("Failed to parse room metadata: {}", e)))
    }

    // ── Connection Lifecycle ─────────────────────────────────────────────────

    /// Connect to the room, authenticate, and join.
    pub async fn join(self: &Arc<Self>) -> Result<(), Error> {
        *self.intentionally_left.lock().unwrap() = false;
        self.set_connection_state(ROOM_STATE_CONNECTING);

        let (stop_tx, mut stop_rx) = mpsc::channel::<()>(1);
        *self.stop_tx.lock().unwrap() = Some(stop_tx);

        let this = Arc::clone(self);
        tokio::spawn(async move {
            let mut attempts = 0u32;
            loop {
                match this.establish().await {
                    Ok(mut ws_rx) => {
                        attempts = 0;
                        loop {
                            tokio::select! {
                                _ = stop_rx.recv() => return,
                                msg = ws_rx.recv() => {
                                    match msg {
                                        Some(raw) => this.handle_message(&raw),
                                        None => {
                                            // WS closed — reject pending requests
                                            // if disconnect was not intentional
                                            if !*this.intentionally_left.lock().unwrap() {
                                                this.reject_all_pending(
                                                    "WebSocket disconnected",
                                                );
                                            }
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Err(_) => {}
                }
                if *this.intentionally_left.lock().unwrap() {
                    return;
                }
                if !this.opts.auto_reconnect || attempts >= this.opts.max_reconnect_attempts {
                    this.set_connection_state(ROOM_STATE_DISCONNECTED);
                    return;
                }
                let delay = (this.opts.reconnect_base_delay_ms * (1u64 << attempts)).min(30_000);
                attempts += 1;
                this.begin_reconnect_attempt(attempts as u64);
                sleep(Duration::from_millis(delay)).await;
            }
        });
        Ok(())
    }

    /// Leave the room and disconnect. Cleans up all pending send() requests.
    pub async fn leave(&self) {
        *self.intentionally_left.lock().unwrap() = true;

        let send_tx = self.send_tx.lock().unwrap().clone();
        if let Some(tx) = send_tx.as_ref() {
            let _ = tx
                .send(RoomWsCommand::Send(
                    json!({"type": "leave"}).to_string(),
                ))
                .await;
            sleep(ROOM_EXPLICIT_LEAVE_CLOSE_DELAY).await;
            let _ = tx.send(RoomWsCommand::Close).await;
        }

        if let Some(tx) = self.stop_tx.lock().unwrap().take() {
            let _ = tx.send(()).await;
        }

        *self.send_tx.lock().unwrap() = None;

        // Reject all pending requests with explicit error
        self.reject_all_pending("Room left");

        // Reset state
        *self.shared_state.write().unwrap() = json!({});
        *self.shared_version.write().unwrap() = 0;
        *self.player_state.write().unwrap() = json!({});
        *self.player_version.write().unwrap() = 0;
        *self.members.write().unwrap() = json!([]);
        *self.media_members.write().unwrap() = json!([]);
        *self.current_user_id.lock().unwrap() = None;
        *self.current_connection_id.lock().unwrap() = None;
        *self.reconnect_info.write().unwrap() = None;
        self.set_connection_state(ROOM_STATE_IDLE);
    }

    // ── Actions ──────────────────────────────────────────────────────────────

    /// Send an action to the server.
    /// Returns a Result that resolves with the action result from the server.
    ///
    /// # Example
    /// ```ignore
    /// let result = room.send("SET_SCORE", Some(json!({"score": 42}))).await?;
    /// ```
    pub async fn send(&self, action_type: &str, payload: Option<Value>) -> Result<Value, Error> {
        if self.send_tx.lock().unwrap().is_none() {
            return Err(Error::Room("Not connected to room".to_string()));
        }

        let request_id = Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel::<Result<Value, Error>>();

        self.pending_requests
            .lock()
            .unwrap()
            .insert(request_id.clone(), tx);

        self.ws_send(json!({
            "type": "send",
            "actionType": action_type,
            "payload": payload.unwrap_or(json!({})),
            "requestId": request_id,
        }));

        let timeout_ms = self.opts.send_timeout_ms;
        let action_type_owned = action_type.to_string();
        let req_id = request_id.clone();

        match timeout(Duration::from_millis(timeout_ms), rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => {
                // oneshot channel closed (room left or sender dropped)
                self.pending_requests.lock().unwrap().remove(&req_id);
                Err(Error::Room(
                    "Room left while waiting for action result".to_string(),
                ))
            }
            Err(_) => {
                // Timeout
                self.pending_requests.lock().unwrap().remove(&req_id);
                Err(Error::RoomTimeout(format!(
                    "Action '{}' timed out",
                    action_type_owned
                )))
            }
        }
    }

    // ── Subscriptions (v2 API) ───────────────────────────────────────────────

    /// Subscribe to shared state changes.
    /// Handler receives (full_state, changes) on each sync/delta.
    pub fn on_shared_state(
        &self,
        handler: impl Fn(&Value, &Value) + Send + Sync + 'static,
    ) -> Subscription {
        let id = self.next_handler_id();
        let handler = Arc::new(handler) as StateHandler;
        self.shared_state_handlers.lock().unwrap().push((id, handler));

        let list = Arc::clone(&self.shared_state_handlers);
        Subscription::new(move || {
            list.lock().unwrap().retain(|(hid, _)| *hid != id);
        })
    }

    /// Subscribe to player state changes.
    /// Handler receives (full_state, changes) on each sync/delta.
    pub fn on_player_state(
        &self,
        handler: impl Fn(&Value, &Value) + Send + Sync + 'static,
    ) -> Subscription {
        let id = self.next_handler_id();
        let handler = Arc::new(handler) as StateHandler;
        self.player_state_handlers.lock().unwrap().push((id, handler));

        let list = Arc::clone(&self.player_state_handlers);
        Subscription::new(move || {
            list.lock().unwrap().retain(|(hid, _)| *hid != id);
        })
    }

    /// Subscribe to messages of a specific type sent by room.sendMessage().
    ///
    /// # Example
    /// ```ignore
    /// let sub = room.on_message("game_over", |data| { println!("{:?}", data); });
    /// ```
    pub fn on_message(
        &self,
        msg_type: &str,
        handler: impl Fn(&Value) + Send + Sync + 'static,
    ) -> Subscription {
        let id = self.next_handler_id();
        let handler = Arc::new(handler) as MessageHandler;
        let msg_type = msg_type.to_string();
        {
            let mut map = self.message_handlers.lock().unwrap();
            map.entry(msg_type.clone())
                .or_insert_with(Vec::new)
                .push((id, handler));
        }

        let map = Arc::clone(&self.message_handlers);
        Subscription::new(move || {
            if let Some(list) = map.lock().unwrap().get_mut(&msg_type) {
                list.retain(|(hid, _)| *hid != id);
            }
        })
    }

    /// Subscribe to error events.
    pub fn on_error(
        &self,
        handler: impl Fn(&str, &str) + Send + Sync + 'static,
    ) -> Subscription {
        let id = self.next_handler_id();
        let handler = Arc::new(handler) as ErrorHandler;
        self.error_handlers.lock().unwrap().push((id, handler));

        let list = Arc::clone(&self.error_handlers);
        Subscription::new(move || {
            list.lock().unwrap().retain(|(hid, _)| *hid != id);
        })
    }

    /// Subscribe to kick events. After being kicked, auto-reconnect is disabled.
    pub fn on_kicked(&self, handler: impl Fn() + Send + Sync + 'static) -> Subscription {
        let id = self.next_handler_id();
        let handler = Arc::new(handler) as KickedHandler;
        self.kicked_handlers.lock().unwrap().push((id, handler));

        let list = Arc::clone(&self.kicked_handlers);
        Subscription::new(move || {
            list.lock().unwrap().retain(|(hid, _)| *hid != id);
        })
    }

    pub fn on_members_sync(
        &self,
        handler: impl Fn(&Value) + Send + Sync + 'static,
    ) -> Subscription {
        let id = self.next_handler_id();
        let handler = Arc::new(handler) as MembersSyncHandler;
        self.member_sync_handlers.lock().unwrap().push((id, handler));

        let list = Arc::clone(&self.member_sync_handlers);
        Subscription::new(move || {
            list.lock().unwrap().retain(|(hid, _)| *hid != id);
        })
    }

    pub fn on_member_join(
        &self,
        handler: impl Fn(&Value) + Send + Sync + 'static,
    ) -> Subscription {
        let id = self.next_handler_id();
        let handler = Arc::new(handler) as MemberHandler;
        self.member_join_handlers.lock().unwrap().push((id, handler));

        let list = Arc::clone(&self.member_join_handlers);
        Subscription::new(move || {
            list.lock().unwrap().retain(|(hid, _)| *hid != id);
        })
    }

    pub fn on_member_leave(
        &self,
        handler: impl Fn(&Value, &str) + Send + Sync + 'static,
    ) -> Subscription {
        let id = self.next_handler_id();
        let handler = Arc::new(handler) as MemberLeaveHandler;
        self.member_leave_handlers.lock().unwrap().push((id, handler));

        let list = Arc::clone(&self.member_leave_handlers);
        Subscription::new(move || {
            list.lock().unwrap().retain(|(hid, _)| *hid != id);
        })
    }

    pub fn on_member_state_change(
        &self,
        handler: impl Fn(&Value, &Value) + Send + Sync + 'static,
    ) -> Subscription {
        let id = self.next_handler_id();
        let handler = Arc::new(handler) as MemberStateHandler;
        self.member_state_handlers.lock().unwrap().push((id, handler));

        let list = Arc::clone(&self.member_state_handlers);
        Subscription::new(move || {
            list.lock().unwrap().retain(|(hid, _)| *hid != id);
        })
    }

    pub fn on_signal(
        &self,
        event: &str,
        handler: impl Fn(&Value, &Value) + Send + Sync + 'static,
    ) -> Subscription {
        let id = self.next_handler_id();
        let handler = Arc::new(handler) as SignalHandler;
        let event = event.to_string();
        {
            let mut map = self.signal_handlers.lock().unwrap();
            map.entry(event.clone())
                .or_insert_with(Vec::new)
                .push((id, handler));
        }

        let map = Arc::clone(&self.signal_handlers);
        Subscription::new(move || {
            if let Some(list) = map.lock().unwrap().get_mut(&event) {
                list.retain(|(hid, _)| *hid != id);
            }
        })
    }

    pub fn on_any_signal(
        &self,
        handler: impl Fn(&str, &Value, &Value) + Send + Sync + 'static,
    ) -> Subscription {
        let id = self.next_handler_id();
        let handler = Arc::new(handler) as AnySignalHandler;
        self.any_signal_handlers.lock().unwrap().push((id, handler));

        let list = Arc::clone(&self.any_signal_handlers);
        Subscription::new(move || {
            list.lock().unwrap().retain(|(hid, _)| *hid != id);
        })
    }

    pub fn on_media_track(
        &self,
        handler: impl Fn(&Value, &Value) + Send + Sync + 'static,
    ) -> Subscription {
        let id = self.next_handler_id();
        let handler = Arc::new(handler) as MediaTrackHandler;
        self.media_track_handlers.lock().unwrap().push((id, handler));

        let list = Arc::clone(&self.media_track_handlers);
        Subscription::new(move || {
            list.lock().unwrap().retain(|(hid, _)| *hid != id);
        })
    }

    pub fn on_media_track_removed(
        &self,
        handler: impl Fn(&Value, &Value) + Send + Sync + 'static,
    ) -> Subscription {
        let id = self.next_handler_id();
        let handler = Arc::new(handler) as MediaTrackHandler;
        self.media_track_removed_handlers
            .lock()
            .unwrap()
            .push((id, handler));

        let list = Arc::clone(&self.media_track_removed_handlers);
        Subscription::new(move || {
            list.lock().unwrap().retain(|(hid, _)| *hid != id);
        })
    }

    pub fn on_media_state_change(
        &self,
        handler: impl Fn(&Value, &Value) + Send + Sync + 'static,
    ) -> Subscription {
        let id = self.next_handler_id();
        let handler = Arc::new(handler) as MediaStateHandler;
        self.media_state_handlers.lock().unwrap().push((id, handler));

        let list = Arc::clone(&self.media_state_handlers);
        Subscription::new(move || {
            list.lock().unwrap().retain(|(hid, _)| *hid != id);
        })
    }

    pub fn on_media_device_change(
        &self,
        handler: impl Fn(&Value, &Value) + Send + Sync + 'static,
    ) -> Subscription {
        let id = self.next_handler_id();
        let handler = Arc::new(handler) as MediaDeviceHandler;
        self.media_device_handlers.lock().unwrap().push((id, handler));

        let list = Arc::clone(&self.media_device_handlers);
        Subscription::new(move || {
            list.lock().unwrap().retain(|(hid, _)| *hid != id);
        })
    }

    pub fn on_reconnect(
        &self,
        handler: impl Fn(&Value) + Send + Sync + 'static,
    ) -> Subscription {
        let id = self.next_handler_id();
        let handler = Arc::new(handler) as ReconnectHandler;
        self.reconnect_handlers.lock().unwrap().push((id, handler));

        let list = Arc::clone(&self.reconnect_handlers);
        Subscription::new(move || {
            list.lock().unwrap().retain(|(hid, _)| *hid != id);
        })
    }

    pub fn on_connection_state_change(
        &self,
        handler: impl Fn(&str) + Send + Sync + 'static,
    ) -> Subscription {
        let id = self.next_handler_id();
        let handler = Arc::new(handler) as ConnectionStateHandler;
        self.connection_state_handlers
            .lock()
            .unwrap()
            .push((id, handler));

        let list = Arc::clone(&self.connection_state_handlers);
        Subscription::new(move || {
            list.lock().unwrap().retain(|(hid, _)| *hid != id);
        })
    }

    pub async fn send_signal(
        &self,
        event: &str,
        payload: Option<Value>,
        options: Option<Value>,
    ) -> Result<(), Error> {
        if self.send_tx.lock().unwrap().is_none() {
            return Err(Error::Room("Not connected to room".to_string()));
        }

        let request_id = Uuid::new_v4().to_string();
        let options = options.unwrap_or_else(|| json!({}));
        let message = json!({
            "type": "signal",
            "event": event,
            "payload": payload.unwrap_or_else(|| json!({})),
            "requestId": request_id,
            "memberId": options.get("memberId").cloned().unwrap_or(Value::Null),
            "includeSelf": options.get("includeSelf").and_then(Value::as_bool).unwrap_or(false),
        });

        self.send_unit_request(&self.pending_signal_requests, request_id, message, format!("Signal '{}' timed out", event)).await
    }

    pub async fn send_member_state(&self, state: Value) -> Result<(), Error> {
        if self.send_tx.lock().unwrap().is_none() {
            return Err(Error::Room("Not connected to room".to_string()));
        }

        let request_id = Uuid::new_v4().to_string();
        let message = json!({
            "type": "member_state",
            "state": state,
            "requestId": request_id,
        });

        self.send_unit_request(
            &self.pending_member_state_requests,
            request_id,
            message,
            "Member state update timed out".to_string(),
        ).await
    }

    pub async fn clear_member_state(&self) -> Result<(), Error> {
        if self.send_tx.lock().unwrap().is_none() {
            return Err(Error::Room("Not connected to room".to_string()));
        }

        let request_id = Uuid::new_v4().to_string();
        let message = json!({
            "type": "member_state_clear",
            "requestId": request_id,
        });

        self.send_unit_request(
            &self.pending_member_state_requests,
            request_id,
            message,
            "Member state clear timed out".to_string(),
        ).await
    }

    pub async fn send_admin(
        &self,
        operation: &str,
        member_id: &str,
        payload: Option<Value>,
    ) -> Result<(), Error> {
        if self.send_tx.lock().unwrap().is_none() {
            return Err(Error::Room("Not connected to room".to_string()));
        }

        let request_id = Uuid::new_v4().to_string();
        let message = json!({
            "type": "admin",
            "operation": operation,
            "memberId": member_id,
            "payload": payload.unwrap_or_else(|| json!({})),
            "requestId": request_id,
        });

        self.send_unit_request(
            &self.pending_admin_requests,
            request_id,
            message,
            format!("Admin '{}' timed out", operation),
        ).await
    }

    pub async fn send_media(
        &self,
        operation: &str,
        kind: &str,
        payload: Option<Value>,
    ) -> Result<(), Error> {
        if self.send_tx.lock().unwrap().is_none() {
            return Err(Error::Room("Not connected to room".to_string()));
        }

        let request_id = Uuid::new_v4().to_string();
        let message = json!({
            "type": "media",
            "operation": operation,
            "kind": kind,
            "payload": payload.unwrap_or_else(|| json!({})),
            "requestId": request_id,
        });

        self.send_unit_request(
            &self.pending_media_requests,
            request_id,
            message,
            format!("Media '{}:{}' timed out", operation, kind),
        ).await
    }

    pub async fn switch_media_devices(&self, payload: Value) -> Result<(), Error> {
        if let Some(device_id) = payload.get("audioInputId").and_then(Value::as_str) {
            self.send_media("device", "audio", Some(json!({ "deviceId": device_id }))).await?;
        }
        if let Some(device_id) = payload.get("videoInputId").and_then(Value::as_str) {
            self.send_media("device", "video", Some(json!({ "deviceId": device_id }))).await?;
        }
        if let Some(device_id) = payload.get("screenInputId").and_then(Value::as_str) {
            self.send_media("device", "screen", Some(json!({ "deviceId": device_id }))).await?;
        }
        Ok(())
    }

    /// Reject all pending requests across all pending maps with an error message.
    /// Called when the WebSocket disconnects unexpectedly.
    fn reject_all_pending(&self, message: &str) {
        let error_msg = message.to_string();

        // Reject pending action requests
        for (_, tx) in self.pending_requests.lock().unwrap().drain() {
            let _ = tx.send(Err(Error::Room(error_msg.clone())));
        }

        // Reject pending signal requests
        for (_, tx) in self.pending_signal_requests.lock().unwrap().drain() {
            let _ = tx.send(Err(Error::Room(error_msg.clone())));
        }

        // Reject pending admin requests
        for (_, tx) in self.pending_admin_requests.lock().unwrap().drain() {
            let _ = tx.send(Err(Error::Room(error_msg.clone())));
        }

        // Reject pending member state requests
        for (_, tx) in self.pending_member_state_requests.lock().unwrap().drain() {
            let _ = tx.send(Err(Error::Room(error_msg.clone())));
        }

        // Reject pending media requests
        for (_, tx) in self.pending_media_requests.lock().unwrap().drain() {
            let _ = tx.send(Err(Error::Room(error_msg.clone())));
        }
    }

    /// Leave the room, clear all handler lists, and release resources.
    /// After calling destroy(), this RoomClient instance should not be reused.
    pub async fn destroy(self: &Arc<Self>) {
        self.leave().await;

        // Clear all handler lists
        self.shared_state_handlers.lock().unwrap().clear();
        self.player_state_handlers.lock().unwrap().clear();
        self.message_handlers.lock().unwrap().clear();
        self.error_handlers.lock().unwrap().clear();
        self.kicked_handlers.lock().unwrap().clear();
        self.member_sync_handlers.lock().unwrap().clear();
        self.member_join_handlers.lock().unwrap().clear();
        self.member_leave_handlers.lock().unwrap().clear();
        self.member_state_handlers.lock().unwrap().clear();
        self.signal_handlers.lock().unwrap().clear();
        self.any_signal_handlers.lock().unwrap().clear();
        self.media_track_handlers.lock().unwrap().clear();
        self.media_track_removed_handlers.lock().unwrap().clear();
        self.media_state_handlers.lock().unwrap().clear();
        self.media_device_handlers.lock().unwrap().clear();
        self.reconnect_handlers.lock().unwrap().clear();
        self.connection_state_handlers.lock().unwrap().clear();
    }

    // ── Private: Connection ──────────────────────────────────────────────────

    fn ws_url(&self) -> String {
        let u = self
            .base_url
            .replace("https://", "wss://")
            .replace("http://", "ws://");
        format!(
            "{}/api/room?namespace={}&id={}",
            u,
            urlencoding::encode(&self.namespace),
            urlencoding::encode(&self.room_id)
        )
    }

    /// Send a raw JSON message over the WS write channel.
    fn ws_send(&self, msg: Value) {
        let s = msg.to_string();
        if let Some(tx) = self.send_tx.lock().unwrap().as_ref() {
            let tx = tx.clone();
            tokio::spawn(async move {
                let _ = tx.send(RoomWsCommand::Send(s)).await;
            });
        }
    }

    #[cfg(test)]
    pub(crate) fn attach_send_channel_for_testing(&self, tx: mpsc::Sender<RoomWsCommand>) {
        *self.send_tx.lock().unwrap() = Some(tx);
    }

    #[cfg(test)]
    pub(crate) fn handle_message_for_testing(&self, raw: &str) {
        self.handle_message(raw);
    }

    async fn establish(&self) -> anyhow::Result<mpsc::Receiver<String>> {
        use futures_util::{SinkExt, StreamExt};
        use tokio_tungstenite::{connect_async, tungstenite::Message};

        let (ws_stream, _response) = tokio::time::timeout(
            std::time::Duration::from_millis(self.opts.connection_timeout_ms),
            connect_async(self.ws_url()),
        )
        .await
        .map_err(|_| anyhow::anyhow!(
            "Room WebSocket connection timed out after {}ms. Is the server running?",
            self.opts.connection_timeout_ms,
        ))??;
        let (mut write, mut read) = ws_stream.split();

        // Auth
        let auth = json!({"type": "auth", "token": (self.token_fn)(), "sdkVersion": "0.2.0"});
        write.send(Message::Text(auth.to_string().into())).await?;

        // Wait for auth_success
        let join_raw = if let Some(Ok(Message::Text(raw))) = read.next().await {
            let raw_str: &str = &raw;
            let resp: Value = serde_json::from_str(raw_str)?;
            let t = resp["type"].as_str().unwrap_or("");
            if t != "auth_success" && t != "auth_refreshed" {
                anyhow::bail!("Room auth failed: {}", resp["message"]);
            }

            *self.current_user_id.lock().unwrap() = resp["userId"].as_str().map(|value| value.to_string());
            *self.current_connection_id.lock().unwrap() = resp["connectionId"].as_str().map(|value| value.to_string());

            // v2: join with last known shared + player state for eviction recovery
            let join_msg = json!({
                "type": "join",
                "lastSharedState": *self.shared_state.read().unwrap(),
                "lastSharedVersion": *self.shared_version.read().unwrap(),
                "lastPlayerState": *self.player_state.read().unwrap(),
                "lastPlayerVersion": *self.player_version.read().unwrap(),
            });
            join_msg.to_string()
        } else {
            anyhow::bail!("Room: no auth response");
        };

        // Shared WS write channel
        let (write_tx, mut write_rx) = mpsc::channel::<RoomWsCommand>(128);
        *self.send_tx.lock().unwrap() = Some(write_tx.clone());

        // WS writer task
        tokio::spawn(async move {
            while let Some(command) = write_rx.recv().await {
                match command {
                    RoomWsCommand::Send(msg) => {
                        if write.send(Message::Text(msg.into())).await.is_err() {
                            break;
                        }
                    }
                    RoomWsCommand::Close => {
                        let _ = write.send(Message::Close(None)).await;
                        break;
                    }
                }
            }
        });

        // Send join message
        let _ = write_tx.send(RoomWsCommand::Send(join_raw)).await;

        // Heartbeat
        let htx = write_tx.clone();
        tokio::spawn(async move {
            loop {
                sleep(Duration::from_secs(30)).await;
                if htx
                    .send(RoomWsCommand::Send(json!({"type":"ping"}).to_string()))
                    .await
                    .is_err()
                {
                    break;
                }
            }
        });

        // WS reader → msg_rx channel consumed by join() loop
        let (msg_tx, msg_rx) = mpsc::channel::<String>(128);
        tokio::spawn(async move {
            while let Some(Ok(Message::Text(raw))) = read.next().await {
                let raw_str: String = raw.into();
                if msg_tx.send(raw_str).await.is_err() {
                    break;
                }
            }
        });

        Ok(msg_rx)
    }

    // ── Private: Message Handling ────────────────────────────────────────────

    fn handle_message(&self, raw: &str) {
        let msg: Value = match serde_json::from_str(raw) {
            Ok(v) => v,
            Err(_) => return,
        };
        let t = msg["type"].as_str().unwrap_or("");

        match t {
            "sync" => self.handle_sync(&msg),
            "shared_delta" => self.handle_shared_delta(&msg),
            "player_delta" => self.handle_player_delta(&msg),
            "action_result" => self.handle_action_result(&msg),
            "action_error" => self.handle_action_error(&msg),
            "message" => self.handle_server_message(&msg),
            "signal" => self.handle_signal(&msg),
            "signal_sent" => self.resolve_pending_unit_request(&self.pending_signal_requests, &msg),
            "signal_error" => self.reject_pending_unit_request(&self.pending_signal_requests, &msg, "Signal error"),
            "members_sync" => self.handle_members_sync(&msg),
            "member_join" => self.handle_member_join(&msg),
            "member_leave" => self.handle_member_leave(&msg),
            "member_state" => self.handle_member_state(&msg),
            "member_state_error" => self.reject_pending_unit_request(&self.pending_member_state_requests, &msg, "Member state error"),
            "admin_result" => self.resolve_pending_unit_request(&self.pending_admin_requests, &msg),
            "admin_error" => self.reject_pending_unit_request(&self.pending_admin_requests, &msg, "Admin error"),
            "media_sync" => self.handle_media_sync(&msg),
            "media_track" => self.handle_media_track(&msg),
            "media_track_removed" => self.handle_media_track_removed(&msg),
            "media_state" => self.handle_media_state(&msg),
            "media_device" => self.handle_media_device(&msg),
            "media_result" => self.resolve_pending_unit_request(&self.pending_media_requests, &msg),
            "media_error" => self.reject_pending_unit_request(&self.pending_media_requests, &msg, "Media error"),
            "kicked" => self.handle_kicked(),
            "error" => self.handle_error(&msg),
            "pong" => {}
            _ => {}
        }
    }

    fn handle_sync(&self, msg: &Value) {
        *self.shared_state.write().unwrap() = msg["sharedState"].clone();
        *self.shared_version.write().unwrap() = msg["sharedVersion"].as_u64().unwrap_or(0);
        *self.player_state.write().unwrap() = msg["playerState"].clone();
        *self.player_version.write().unwrap() = msg["playerVersion"].as_u64().unwrap_or(0);
        self.set_connection_state(ROOM_STATE_CONNECTED);

        if let Some(info) = self.reconnect_info.write().unwrap().take() {
            for (_, handler) in self.reconnect_handlers.lock().unwrap().iter() {
                handler(&info);
            }
        }

        // Notify shared state handlers (full state as changes on sync)
        let shared = self.shared_state.read().unwrap().clone();
        for (_, handler) in self.shared_state_handlers.lock().unwrap().iter() {
            handler(&shared, &shared);
        }
        let player = self.player_state.read().unwrap().clone();
        for (_, handler) in self.player_state_handlers.lock().unwrap().iter() {
            handler(&player, &player);
        }
    }

    fn handle_shared_delta(&self, msg: &Value) {
        let delta = &msg["delta"];
        *self.shared_version.write().unwrap() = msg["version"].as_u64().unwrap_or(0);

        if let Value::Object(map) = delta {
            let mut state = self.shared_state.write().unwrap();
            for (path, value) in map {
                deep_set(&mut state, path, value.clone());
            }
        }

        let state = self.shared_state.read().unwrap().clone();
        for (_, handler) in self.shared_state_handlers.lock().unwrap().iter() {
            handler(&state, delta);
        }
    }

    fn handle_player_delta(&self, msg: &Value) {
        let delta = &msg["delta"];
        *self.player_version.write().unwrap() = msg["version"].as_u64().unwrap_or(0);

        if let Value::Object(map) = delta {
            let mut state = self.player_state.write().unwrap();
            for (path, value) in map {
                deep_set(&mut state, path, value.clone());
            }
        }

        let state = self.player_state.read().unwrap().clone();
        for (_, handler) in self.player_state_handlers.lock().unwrap().iter() {
            handler(&state, delta);
        }
    }

    fn handle_action_result(&self, msg: &Value) {
        let request_id = msg["requestId"].as_str().unwrap_or("");
        if let Some(tx) = self.pending_requests.lock().unwrap().remove(request_id) {
            let _ = tx.send(Ok(msg["result"].clone()));
        }
    }

    fn handle_action_error(&self, msg: &Value) {
        let request_id = msg["requestId"].as_str().unwrap_or("");
        if let Some(tx) = self.pending_requests.lock().unwrap().remove(request_id) {
            let message = msg["message"].as_str().unwrap_or("Unknown error");
            let _ = tx.send(Err(Error::Room(message.to_string())));
        }
    }

    fn handle_server_message(&self, msg: &Value) {
        let message_type = msg["messageType"].as_str().unwrap_or("");
        let data = &msg["data"];

        let handlers = self.message_handlers.lock().unwrap();
        if let Some(list) = handlers.get(message_type) {
            for (_, handler) in list {
                handler(data);
            }
        }
    }

    fn handle_signal(&self, msg: &Value) {
        let event = msg["event"].as_str().unwrap_or("");
        let payload = &msg["payload"];
        let meta = &msg["meta"];

        if let Some(list) = self.signal_handlers.lock().unwrap().get(event) {
            for (_, handler) in list {
                handler(payload, meta);
            }
        }

        for (_, handler) in self.any_signal_handlers.lock().unwrap().iter() {
            handler(event, payload, meta);
        }
    }

    fn handle_members_sync(&self, msg: &Value) {
        let members = normalize_members(&msg["members"]);
        *self.members.write().unwrap() = members.clone();
        self.merge_members_into_media();

        for (_, handler) in self.member_sync_handlers.lock().unwrap().iter() {
            handler(&members);
        }
    }

    fn handle_member_join(&self, msg: &Value) {
        if let Some(member) = normalize_member(&msg["member"]) {
            self.upsert_member(member.clone());
            for (_, handler) in self.member_join_handlers.lock().unwrap().iter() {
                handler(&member);
            }
        }
    }

    fn handle_member_leave(&self, msg: &Value) {
        if let Some(member) = normalize_member(&msg["member"]) {
            let member_id = member["memberId"].as_str().unwrap_or("");
            self.remove_member(member_id);
            let reason = msg["reason"].as_str().unwrap_or("leave");
            for (_, handler) in self.member_leave_handlers.lock().unwrap().iter() {
                handler(&member, reason);
            }
        }
    }

    fn handle_member_state(&self, msg: &Value) {
        if let Some(mut member) = normalize_member(&msg["member"]) {
            let state = object_or_empty(&msg["state"]);
            member["state"] = state.clone();
            self.upsert_member(member.clone());
            self.resolve_pending_unit_request(&self.pending_member_state_requests, msg);

            for (_, handler) in self.member_state_handlers.lock().unwrap().iter() {
                handler(&member, &state);
            }
        }
    }

    fn handle_media_sync(&self, msg: &Value) {
        let media_members = normalize_media_members(&msg["members"]);
        *self.media_members.write().unwrap() = media_members.clone();
        self.merge_members_into_media();
    }

    fn handle_media_track(&self, msg: &Value) {
        if let (Some(member), Some(track)) = (
            normalize_member(&msg["member"]),
            normalize_track(&msg["track"]),
        ) {
            self.upsert_media_track(&member, &track);
            for (_, handler) in self.media_track_handlers.lock().unwrap().iter() {
                handler(&track, &member);
            }
        }
    }

    fn handle_media_track_removed(&self, msg: &Value) {
        if let (Some(member), Some(track)) = (
            normalize_member(&msg["member"]),
            normalize_track(&msg["track"]),
        ) {
            self.remove_media_track(&member, &track);
            for (_, handler) in self
                .media_track_removed_handlers
                .lock()
                .unwrap()
                .iter()
            {
                handler(&track, &member);
            }
        }
    }

    fn handle_media_state(&self, msg: &Value) {
        if let Some(member) = normalize_member(&msg["member"]) {
            let state = object_or_empty(&msg["state"]);
            self.upsert_media_state(&member, state.clone());
            for (_, handler) in self.media_state_handlers.lock().unwrap().iter() {
                handler(&member, &state);
            }
        }
    }

    fn handle_media_device(&self, msg: &Value) {
        if let Some(member) = normalize_member(&msg["member"]) {
            let change = json!({
                "kind": msg["kind"].clone(),
                "deviceId": msg["deviceId"].clone(),
            });
            self.apply_media_device_change(&member, &change);
            for (_, handler) in self.media_device_handlers.lock().unwrap().iter() {
                handler(&member, &change);
            }
        }
    }

    fn handle_kicked(&self) {
        self.set_connection_state(ROOM_STATE_KICKED);
        *self.intentionally_left.lock().unwrap() = true;
        for (_, handler) in self.kicked_handlers.lock().unwrap().iter() {
            handler();
        }
    }

    fn handle_error(&self, msg: &Value) {
        let code = msg["code"].as_str().unwrap_or("");
        let message = msg["message"].as_str().unwrap_or("");
        for (_, handler) in self.error_handlers.lock().unwrap().iter() {
            handler(code, message);
        }
    }

    // ── Private: Helpers ─────────────────────────────────────────────────────

    async fn send_unit_request(
        &self,
        pending: &Mutex<HashMap<String, oneshot::Sender<Result<(), Error>>>>,
        request_id: String,
        message: Value,
        timeout_message: String,
    ) -> Result<(), Error> {
        let (tx, rx) = oneshot::channel::<Result<(), Error>>();
        pending.lock().unwrap().insert(request_id.clone(), tx);
        self.ws_send(message);

        match timeout(Duration::from_millis(self.opts.send_timeout_ms), rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => {
                pending.lock().unwrap().remove(&request_id);
                Err(Error::Room(
                    "Room left while waiting for room control result".to_string(),
                ))
            }
            Err(_) => {
                pending.lock().unwrap().remove(&request_id);
                Err(Error::RoomTimeout(timeout_message))
            }
        }
    }

    fn resolve_pending_unit_request(
        &self,
        pending: &Mutex<HashMap<String, oneshot::Sender<Result<(), Error>>>>,
        msg: &Value,
    ) {
        let request_id = msg["requestId"].as_str().unwrap_or("");
        if let Some(tx) = pending.lock().unwrap().remove(request_id) {
            let _ = tx.send(Ok(()));
        }
    }

    fn reject_pending_unit_request(
        &self,
        pending: &Mutex<HashMap<String, oneshot::Sender<Result<(), Error>>>>,
        msg: &Value,
        fallback: &str,
    ) {
        let request_id = msg["requestId"].as_str().unwrap_or("");
        if let Some(tx) = pending.lock().unwrap().remove(request_id) {
            let message = msg["message"].as_str().unwrap_or(fallback);
            let _ = tx.send(Err(Error::Room(message.to_string())));
        }
    }

    fn set_connection_state(&self, next: &str) {
        let mut state = self.connection_state.write().unwrap();
        if state.as_str() == next {
            return;
        }
        *state = next.to_string();
        drop(state);

        for (_, handler) in self.connection_state_handlers.lock().unwrap().iter() {
            handler(next);
        }
    }

    fn begin_reconnect_attempt(&self, attempt: u64) {
        *self.reconnect_info.write().unwrap() = Some(json!({ "attempt": attempt }));
        self.set_connection_state(ROOM_STATE_RECONNECTING);
    }

    fn upsert_member(&self, member: Value) {
        let member_id = member["memberId"].as_str().unwrap_or("").to_string();
        if member_id.is_empty() {
            return;
        }

        let mut members = self.members.write().unwrap();
        let list = members.as_array_mut().expect("members array");
        if let Some(existing) = list
            .iter_mut()
            .find(|entry| entry["memberId"].as_str() == Some(member_id.as_str()))
        {
            *existing = member;
        } else {
            list.push(member);
        }
        drop(members);
        self.merge_members_into_media();
    }

    fn remove_member(&self, member_id: &str) {
        {
            let mut members = self.members.write().unwrap();
            if let Some(list) = members.as_array_mut() {
                list.retain(|entry| entry["memberId"].as_str() != Some(member_id));
            }
        }
        {
            let mut media_members = self.media_members.write().unwrap();
            if let Some(list) = media_members.as_array_mut() {
                list.retain(|entry| entry["member"]["memberId"].as_str() != Some(member_id));
            }
        }
    }

    fn merge_members_into_media(&self) {
        let members = self.members.read().unwrap().clone();
        let mut media_members = self.media_members.write().unwrap();
        if let Some(list) = media_members.as_array_mut() {
            for media_member in list.iter_mut() {
                let member_id = media_member["member"]["memberId"].as_str().unwrap_or("");
                if let Some(member) = members
                    .as_array()
                    .and_then(|entries| {
                        entries
                            .iter()
                            .find(|entry| entry["memberId"].as_str() == Some(member_id))
                    })
                {
                    media_member["member"] = member.clone();
                }
            }
        }
    }

    fn ensure_media_member(&self, member: &Value) -> usize {
        self.upsert_member(member.clone());
        let member_id = member["memberId"].as_str().unwrap_or("");
        let mut media_members = self.media_members.write().unwrap();
        let list = media_members.as_array_mut().expect("media members array");
        if let Some(index) = list
            .iter()
            .position(|entry| entry["member"]["memberId"].as_str() == Some(member_id))
        {
            list[index]["member"] = member.clone();
            return index;
        }

        list.push(json!({
            "member": member,
            "state": {},
            "tracks": [],
        }));
        list.len() - 1
    }

    fn upsert_media_track(&self, member: &Value, track: &Value) {
        let index = self.ensure_media_member(member);
        let mut media_members = self.media_members.write().unwrap();
        let list = media_members.as_array_mut().expect("media members array");
        let tracks = list[index]["tracks"].as_array_mut().expect("tracks array");
        let kind = track["kind"].as_str().unwrap_or("");
        if let Some(existing) = tracks
            .iter_mut()
            .find(|entry| entry["kind"].as_str() == Some(kind))
        {
            *existing = track.clone();
        } else {
            tracks.push(track.clone());
        }
        apply_track_to_state(&mut list[index]["state"], track, true);
    }

    fn remove_media_track(&self, member: &Value, track: &Value) {
        let index = self.ensure_media_member(member);
        let mut media_members = self.media_members.write().unwrap();
        let list = media_members.as_array_mut().expect("media members array");
        let kind = track["kind"].as_str().unwrap_or("");
        if let Some(tracks) = list[index]["tracks"].as_array_mut() {
            tracks.retain(|entry| entry["kind"].as_str() != Some(kind));
        }
        apply_track_to_state(&mut list[index]["state"], track, false);
    }

    fn upsert_media_state(&self, member: &Value, state: Value) {
        let index = self.ensure_media_member(member);
        let mut media_members = self.media_members.write().unwrap();
        let list = media_members.as_array_mut().expect("media members array");
        list[index]["state"] = state;
    }

    fn apply_media_device_change(&self, member: &Value, change: &Value) {
        let index = self.ensure_media_member(member);
        let mut media_members = self.media_members.write().unwrap();
        let list = media_members.as_array_mut().expect("media members array");
        let kind = change["kind"].as_str().unwrap_or("");
        let device_id = change["deviceId"].clone();
        if let Some(state) = list[index]["state"].as_object_mut() {
            let kind_state = state.entry(kind.to_string()).or_insert_with(|| json!({}));
            if let Some(kind_state_map) = kind_state.as_object_mut() {
                kind_state_map.insert("deviceId".to_string(), device_id);
            }
        }
    }

    fn next_handler_id(&self) -> u64 {
        let mut counter = self.handler_id_counter.lock().unwrap();
        *counter += 1;
        *counter
    }
}

// ── Helper ────────────────────────────────────────────────────────────────────

fn deep_set(obj: &mut Value, path: &str, value: Value) {
    if let Some(dot) = path.find('.') {
        let head = &path[..dot];
        let tail = &path[dot + 1..];
        if let Value::Object(map) = obj {
            let nested = map.entry(head.to_string()).or_insert(json!({}));
            deep_set(nested, tail, value);
        }
    } else if let Value::Object(map) = obj {
        if value.is_null() {
            map.remove(path);
        } else {
            map.insert(path.to_string(), value);
        }
    }
}

fn object_or_empty(value: &Value) -> Value {
    if value.is_object() {
        value.clone()
    } else {
        json!({})
    }
}

fn normalize_member(value: &Value) -> Option<Value> {
    let member_id = value["memberId"].as_str()?;
    let user_id = value["userId"].as_str()?;
    let mut member = json!({
        "memberId": member_id,
        "userId": user_id,
        "state": object_or_empty(&value["state"]),
    });

    if let Some(connection_id) = value["connectionId"].as_str() {
        member["connectionId"] = Value::String(connection_id.to_string());
    }
    if let Some(connection_count) = value["connectionCount"].as_u64() {
        member["connectionCount"] = Value::from(connection_count);
    }
    if let Some(role) = value["role"].as_str() {
        member["role"] = Value::String(role.to_string());
    }
    Some(member)
}

fn normalize_members(value: &Value) -> Value {
    Value::Array(
        value
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(normalize_member)
            .collect(),
    )
}

fn normalize_track(value: &Value) -> Option<Value> {
    let kind = value["kind"].as_str()?;
    let mut track = json!({
        "kind": kind,
        "muted": value["muted"].as_bool().unwrap_or(false),
    });

    if let Some(track_id) = value["trackId"].as_str() {
        track["trackId"] = Value::String(track_id.to_string());
    }
    if let Some(device_id) = value["deviceId"].as_str() {
        track["deviceId"] = Value::String(device_id.to_string());
    }
    if let Some(published_at) = value["publishedAt"].as_u64() {
        track["publishedAt"] = Value::from(published_at);
    }
    if let Some(admin_disabled) = value["adminDisabled"].as_bool() {
        track["adminDisabled"] = Value::Bool(admin_disabled);
    }
    Some(track)
}

fn normalize_tracks(value: &Value) -> Value {
    Value::Array(
        value
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(normalize_track)
            .collect(),
    )
}

fn normalize_media_members(value: &Value) -> Value {
    Value::Array(
        value
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|entry| {
                let member = normalize_member(&entry["member"])?;
                Some(json!({
                    "member": member,
                    "state": object_or_empty(&entry["state"]),
                    "tracks": normalize_tracks(&entry["tracks"]),
                }))
            })
            .collect(),
    )
}

fn apply_track_to_state(state: &mut Value, track: &Value, published: bool) {
    if !state.is_object() {
        *state = json!({});
    }

    let kind = match track["kind"].as_str() {
        Some(kind) => kind,
        None => return,
    };

    let state_map = state.as_object_mut().expect("state object");
    let kind_state = state_map
        .entry(kind.to_string())
        .or_insert_with(|| json!({}));
    let kind_state_map = kind_state.as_object_mut().expect("kind state object");
    kind_state_map.insert(
        "published".to_string(),
        Value::Bool(published),
    );
    kind_state_map.insert(
        "muted".to_string(),
        Value::Bool(track["muted"].as_bool().unwrap_or(false)),
    );

    if published {
        if let Some(track_id) = track.get("trackId") {
            kind_state_map.insert("trackId".to_string(), track_id.clone());
        }
        if let Some(device_id) = track.get("deviceId") {
            kind_state_map.insert("deviceId".to_string(), device_id.clone());
        }
        if let Some(published_at) = track.get("publishedAt") {
            kind_state_map.insert("publishedAt".to_string(), published_at.clone());
        }
        if let Some(admin_disabled) = track.get("adminDisabled") {
            kind_state_map.insert("adminDisabled".to_string(), admin_disabled.clone());
        }
    } else {
        kind_state_map.remove("trackId");
        kind_state_map.remove("publishedAt");
        if let Some(admin_disabled) = track.get("adminDisabled") {
            kind_state_map.insert("adminDisabled".to_string(), admin_disabled.clone());
        }
    }
}

pub struct RoomStateNamespace {
    client: Arc<RoomClient>,
}

impl RoomStateNamespace {
    fn new(client: Arc<RoomClient>) -> Self {
        Self { client }
    }

    pub fn get_shared(&self) -> Value {
        self.client.get_shared_state()
    }

    pub fn get_mine(&self) -> Value {
        self.client.get_player_state()
    }

    pub fn on_shared_change(
        &self,
        handler: impl Fn(&Value, &Value) + Send + Sync + 'static,
    ) -> Subscription {
        self.client.on_shared_state(handler)
    }

    pub fn on_mine_change(
        &self,
        handler: impl Fn(&Value, &Value) + Send + Sync + 'static,
    ) -> Subscription {
        self.client.on_player_state(handler)
    }

    pub async fn send(&self, action_type: &str, payload: Option<Value>) -> Result<Value, Error> {
        self.client.send(action_type, payload).await
    }
}

pub struct RoomMetaNamespace {
    client: Arc<RoomClient>,
}

impl RoomMetaNamespace {
    fn new(client: Arc<RoomClient>) -> Self {
        Self { client }
    }

    pub async fn get(&self) -> Result<Value, Error> {
        self.client.get_metadata().await
    }
}

pub struct RoomSignalsNamespace {
    client: Arc<RoomClient>,
}

impl RoomSignalsNamespace {
    fn new(client: Arc<RoomClient>) -> Self {
        Self { client }
    }

    pub async fn send(
        &self,
        event: &str,
        payload: Option<Value>,
        options: Option<Value>,
    ) -> Result<(), Error> {
        self.client.send_signal(event, payload, options).await
    }

    pub async fn send_to(
        &self,
        member_id: &str,
        event: &str,
        payload: Option<Value>,
    ) -> Result<(), Error> {
        self.client
            .send_signal(event, payload, Some(json!({ "memberId": member_id })))
            .await
    }

    pub fn on(
        &self,
        event: &str,
        handler: impl Fn(&Value, &Value) + Send + Sync + 'static,
    ) -> Subscription {
        self.client.on_signal(event, handler)
    }

    pub fn on_any(
        &self,
        handler: impl Fn(&str, &Value, &Value) + Send + Sync + 'static,
    ) -> Subscription {
        self.client.on_any_signal(handler)
    }
}

pub struct RoomMembersNamespace {
    client: Arc<RoomClient>,
}

impl RoomMembersNamespace {
    fn new(client: Arc<RoomClient>) -> Self {
        Self { client }
    }

    pub fn list(&self) -> Value {
        self.client.list_members()
    }

    pub fn on_sync(
        &self,
        handler: impl Fn(&Value) + Send + Sync + 'static,
    ) -> Subscription {
        self.client.on_members_sync(handler)
    }

    pub fn on_join(
        &self,
        handler: impl Fn(&Value) + Send + Sync + 'static,
    ) -> Subscription {
        self.client.on_member_join(handler)
    }

    pub fn on_leave(
        &self,
        handler: impl Fn(&Value, &str) + Send + Sync + 'static,
    ) -> Subscription {
        self.client.on_member_leave(handler)
    }

    pub async fn set_state(&self, state: Value) -> Result<(), Error> {
        self.client.send_member_state(state).await
    }

    pub async fn clear_state(&self) -> Result<(), Error> {
        self.client.clear_member_state().await
    }

    pub fn on_state_change(
        &self,
        handler: impl Fn(&Value, &Value) + Send + Sync + 'static,
    ) -> Subscription {
        self.client.on_member_state_change(handler)
    }
}

pub struct RoomAdminNamespace {
    client: Arc<RoomClient>,
}

impl RoomAdminNamespace {
    fn new(client: Arc<RoomClient>) -> Self {
        Self { client }
    }

    pub async fn kick(&self, member_id: &str) -> Result<(), Error> {
        self.client.send_admin("kick", member_id, None).await
    }

    pub async fn mute(&self, member_id: &str) -> Result<(), Error> {
        self.client.send_admin("mute", member_id, None).await
    }

    pub async fn block(&self, member_id: &str) -> Result<(), Error> {
        self.client.send_admin("block", member_id, None).await
    }

    pub async fn set_role(&self, member_id: &str, role: &str) -> Result<(), Error> {
        self.client
            .send_admin("setRole", member_id, Some(json!({ "role": role })))
            .await
    }

    pub async fn disable_video(&self, member_id: &str) -> Result<(), Error> {
        self.client.send_admin("disableVideo", member_id, None).await
    }

    pub async fn stop_screen_share(&self, member_id: &str) -> Result<(), Error> {
        self.client
            .send_admin("stopScreenShare", member_id, None)
            .await
    }
}

pub struct RoomMediaKindNamespace {
    client: Arc<RoomClient>,
    kind: &'static str,
}

impl RoomMediaKindNamespace {
    fn new(client: Arc<RoomClient>, kind: &'static str) -> Self {
        Self { client, kind }
    }

    pub async fn enable(&self, payload: Option<Value>) -> Result<(), Error> {
        self.client.send_media("publish", self.kind, payload).await
    }

    pub async fn disable(&self) -> Result<(), Error> {
        self.client.send_media("unpublish", self.kind, None).await
    }

    pub async fn set_muted(&self, muted: bool) -> Result<(), Error> {
        self.client
            .send_media("mute", self.kind, Some(json!({ "muted": muted })))
            .await
    }
}

pub struct RoomScreenMediaNamespace {
    client: Arc<RoomClient>,
}

impl RoomScreenMediaNamespace {
    fn new(client: Arc<RoomClient>) -> Self {
        Self { client }
    }

    pub async fn start(&self, payload: Option<Value>) -> Result<(), Error> {
        self.client.send_media("publish", "screen", payload).await
    }

    pub async fn stop(&self) -> Result<(), Error> {
        self.client.send_media("unpublish", "screen", None).await
    }
}

pub struct RoomMediaDevicesNamespace {
    client: Arc<RoomClient>,
}

impl RoomMediaDevicesNamespace {
    fn new(client: Arc<RoomClient>) -> Self {
        Self { client }
    }

    pub async fn switch_inputs(&self, payload: Value) -> Result<(), Error> {
        self.client.switch_media_devices(payload).await
    }
}

pub struct RoomMediaNamespace {
    client: Arc<RoomClient>,
}

impl RoomMediaNamespace {
    fn new(client: Arc<RoomClient>) -> Self {
        Self { client }
    }

    pub fn list(&self) -> Value {
        self.client.list_media_members()
    }

    pub fn audio(&self) -> RoomMediaKindNamespace {
        RoomMediaKindNamespace::new(Arc::clone(&self.client), "audio")
    }

    pub fn video(&self) -> RoomMediaKindNamespace {
        RoomMediaKindNamespace::new(Arc::clone(&self.client), "video")
    }

    pub fn screen(&self) -> RoomScreenMediaNamespace {
        RoomScreenMediaNamespace::new(Arc::clone(&self.client))
    }

    pub fn devices(&self) -> RoomMediaDevicesNamespace {
        RoomMediaDevicesNamespace::new(Arc::clone(&self.client))
    }

    pub fn on_track(
        &self,
        handler: impl Fn(&Value, &Value) + Send + Sync + 'static,
    ) -> Subscription {
        self.client.on_media_track(handler)
    }

    pub fn on_track_removed(
        &self,
        handler: impl Fn(&Value, &Value) + Send + Sync + 'static,
    ) -> Subscription {
        self.client.on_media_track_removed(handler)
    }

    pub fn on_state_change(
        &self,
        handler: impl Fn(&Value, &Value) + Send + Sync + 'static,
    ) -> Subscription {
        self.client.on_media_state_change(handler)
    }

    pub fn on_device_change(
        &self,
        handler: impl Fn(&Value, &Value) + Send + Sync + 'static,
    ) -> Subscription {
        self.client.on_media_device_change(handler)
    }
}

pub struct RoomSessionNamespace {
    client: Arc<RoomClient>,
}

impl RoomSessionNamespace {
    fn new(client: Arc<RoomClient>) -> Self {
        Self { client }
    }

    pub fn on_error(
        &self,
        handler: impl Fn(&str, &str) + Send + Sync + 'static,
    ) -> Subscription {
        self.client.on_error(handler)
    }

    pub fn on_kicked(&self, handler: impl Fn() + Send + Sync + 'static) -> Subscription {
        self.client.on_kicked(handler)
    }

    pub fn on_reconnect(
        &self,
        handler: impl Fn(&Value) + Send + Sync + 'static,
    ) -> Subscription {
        self.client.on_reconnect(handler)
    }

    pub fn on_connection_state_change(
        &self,
        handler: impl Fn(&str) + Send + Sync + 'static,
    ) -> Subscription {
        self.client.on_connection_state_change(handler)
    }

    pub fn connection_state(&self) -> String {
        self.client.connection_state()
    }

    pub fn user_id(&self) -> Option<String> {
        self.client.current_user_id.lock().unwrap().clone()
    }

    pub fn connection_id(&self) -> Option<String> {
        self.client.current_connection_id.lock().unwrap().clone()
    }
}
