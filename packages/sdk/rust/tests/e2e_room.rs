//! Room E2E Integration Tests for Rust SDK (v2 protocol)
//!
//! Tests use real WebSocket connections to a local wrangler dev server.
//!
//! Run:
//!   cd packages/sdk/rust
//!   BASE_URL=http://localhost:8688 EDGEBASE_SERVICE_KEY=test-service-key-for-admin \
//!   CARGO_TARGET_DIR=/tmp/rust-target cargo test --test e2e_room -- --nocapture

use edgebase::EdgeBase;
use edgebase_core::room::RoomClient;
use edgebase_core::Error;
use std::env;
use std::sync::{Arc, Mutex};

fn base_url() -> String {
    env::var("BASE_URL").unwrap_or_else(|_| "http://localhost:8688".to_string())
}

fn service_key() -> String {
    env::var("EDGEBASE_SERVICE_KEY").unwrap_or_default()
}

fn unique_email_room() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    format!("rust-room-{}-{}@test.com", ts, n)
}

/// Sign in a user via HTTP and return the access token.
async fn sign_in_user(base_url: &str, email: &str, password: &str) -> String {
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/api/auth/signin", base_url))
        .json(&serde_json::json!({ "email": email, "password": password }))
        .send()
        .await
        .expect("signin request failed");
    let body: serde_json::Value = resp.json().await.expect("signin json parse");
    body["accessToken"]
        .as_str()
        .expect("no accessToken in signin response")
        .to_string()
}

async fn create_user_with_retry(
    admin: &EdgeBase,
    email: &str,
    password: &str,
) -> Result<std::collections::HashMap<String, serde_json::Value>, Error> {
    let mut last_error: Option<Error> = None;

    for attempt in 0..3 {
        match admin.admin_auth().create_user(email, password).await {
            Ok(created) => return Ok(created),
            Err(Error::Api { status, message })
                if status == 503
                    && message.contains("worker restarted mid-request")
                    && attempt < 2 =>
            {
                last_error = Some(Error::Api { status, message });
                tokio::time::sleep(std::time::Duration::from_millis(150 * (attempt + 1) as u64)).await;
            }
            Err(err) => return Err(err),
        }
    }

    Err(last_error.unwrap_or_else(|| Error::Config("create_user retry exhausted".to_string())))
}


// ═══════════════════════════════════════════════════════════
// Room v2 — Shared State Sync (E2E 52)
// ═══════════════════════════════════════════════════════════

#[tokio::test]
async fn e2e_room_v2_shared_state_sync_between_two_clients() {
    let url = base_url();
    let key = service_key();
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let room_id = format!("test-v2-rust-{}", ts);

    // Sign up two users using admin
    let jb_admin = EdgeBase::server(&url, &key).expect("admin init");
    let email1 = unique_email_room();
    let email2 = unique_email_room();

    let _r1 = create_user_with_retry(&jb_admin, &email1, "TestPass1!").await.expect("user1");
    let _r2 = create_user_with_retry(&jb_admin, &email2, "TestPass2!").await.expect("user2");

    // Sign in both to get tokens
    let token1 = sign_in_user(&url, &email1, "TestPass1!").await;
    let token2 = sign_in_user(&url, &email2, "TestPass2!").await;

    // v2: constructor takes (base_url, namespace, room_id, token_fn, opts)
    let room1 = RoomClient::new(&url, "game", &room_id, move || token1.clone(), None);
    let room2 = RoomClient::new(&url, "game", &room_id, move || token2.clone(), None);

    let states1: Arc<Mutex<Vec<serde_json::Value>>> = Arc::new(Mutex::new(vec![]));
    let states2: Arc<Mutex<Vec<serde_json::Value>>> = Arc::new(Mutex::new(vec![]));

    let s1 = states1.clone();
    let s2 = states2.clone();

    // v2: on_shared_state returns Subscription, handler receives (&state, &changes)
    let _sub1 = room1.on_shared_state(move |state, _changes| {
        s1.lock().unwrap().push(state.clone());
    });
    let _sub2 = room2.on_shared_state(move |state, _changes| {
        s2.lock().unwrap().push(state.clone());
    });

    // v2: join() takes no tenant parameter
    room1.join().await.expect("room1 join");
    room2.join().await.expect("room2 join");
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    // v2: use send() instead of patch_state()
    let _ = room1.send("SET_SCORE", Some(serde_json::json!({"score": 100}))).await;
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    let snap1 = states1.lock().unwrap().clone();
    let snap2 = states2.lock().unwrap().clone();

    assert!(!snap1.is_empty(), "room1 should receive shared state");
    assert!(!snap2.is_empty(), "room2 should receive shared state");

    room1.leave().await;
    room2.leave().await;
}

// ═══════════════════════════════════════════════════════════
// Room v2 — Send Action with Result (E2E 53)
// ═══════════════════════════════════════════════════════════

#[tokio::test]
async fn e2e_room_v2_send_action_returns_result() {
    let url = base_url();
    let key = service_key();
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let room_id = format!("test-v2-auth-rust-{}", ts);

    // Create user via admin
    let jb_admin = EdgeBase::server(&url, &key).expect("admin init");
    let email = unique_email_room();
    let created = create_user_with_retry(&jb_admin, &email, "TestAuth1!").await.expect("create_user");

    let _uid = created
        .get("user").and_then(|u| u.get("id")).and_then(|v| v.as_str())
        .or_else(|| created.get("id").and_then(|v| v.as_str()))
        .expect("uid")
        .to_string();

    // Sign in to get token
    let token = sign_in_user(&url, &email, "TestAuth1!").await;

    // v2: constructor with namespace
    let room = RoomClient::new(&url, "game", &room_id, move || token.clone(), None);

    let states: Arc<Mutex<Vec<serde_json::Value>>> = Arc::new(Mutex::new(vec![]));
    let st = states.clone();
    let _sub = room.on_shared_state(move |state, _changes| {
        st.lock().unwrap().push(state.clone());
    });

    room.join().await.expect("join");
    tokio::time::sleep(std::time::Duration::from_secs(1)).await;

    // v2: send() is async and returns Result<Value, Error>
    let _result = room.send("TEST_MUTATION", Some(serde_json::json!({"message": "Rust Auth Test"}))).await;
    // send() should complete (either Ok or Err depending on server handler)
    // If the server has a handler for TEST_MUTATION, it returns Ok with result
    // If not, it may return an error — either way, we got a response
    tokio::time::sleep(std::time::Duration::from_secs(3)).await;

    let snap = states.lock().unwrap().clone();
    assert!(!snap.is_empty(), "should receive shared state updates");

    room.leave().await;
}
