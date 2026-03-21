// room_client.cpp — RoomClient v2 implementation.
//
// v2 redesign: sharedState + playerState, send() with requestId callbacks,
// Subscription-based listeners, namespace+roomId WS URL.

#include "edgebase/room_client.h"
#include "edgebase/generated/api_core.h"
#include <algorithm>
#include <chrono>
#include <iomanip>
#include <sstream>
#include <thread>
#include <vector>

namespace edgebase {

// ── Metadata (HTTP, no WebSocket needed) ─────────────────────────────────────

RoomClient::~RoomClient() {
  shutting_down_.store(true);
  intentionally_left_.store(true);
  reconnect_generation_.fetch_add(1);
  heartbeat_running_ = false;
  connected_.store(false);
  authenticated_.store(false);
  joined_.store(false);
  if (close_fn_) {
    close_fn_();
  }
}

RoomClient::Diagnostic RoomClient::get_diagnostic() const {
  std::lock_guard<std::mutex> lock(diagnostic_mx_);
  return Diagnostic{
      .connected = connected_.load(),
      .authenticated = authenticated_.load(),
      .joined = joined_.load(),
      .transportOpened = transport_opened_,
      .lastTransportEvent = last_transport_event_,
      .lastTransportReason = last_transport_reason_,
      .lastTransportHttpStatus = last_transport_http_status_,
      .lastTransportCloseCode = last_transport_close_code_,
      .lastProtocolMessageType = last_protocol_message_type_,
  };
}

json RoomClient::get_metadata() const {
  // Prefer the injected metadata fetch function (delegates to GeneratedDbApi).
  if (metadata_fetch_fn_) {
    return metadata_fetch_fn_(namespace_name_, room_id_);
  }
  return get_metadata(base_url_, namespace_name_, room_id_, http_get_fn_);
}

json RoomClient::get_metadata(const std::string &base_url,
                              const std::string &namespace_name,
                              const std::string &room_id,
                              std::function<std::string(const std::string &)> http_get_fn) {
  if (!http_get_fn) {
    return json::object();
  }
  // Static method: must construct URL directly (no GeneratedDbApi available).
  std::string url = trim_trailing_slash(base_url) + client::ApiPaths::GET_ROOM_METADATA
      + "?namespace=" + url_encode(namespace_name)
      + "&id=" + url_encode(room_id);
  std::string body = http_get_fn(url);
  return json::parse(body);
}

// ── Connection ──────────────────────────────────────────────────────────────

void RoomClient::join() {
  if (shutting_down_.load())
    return;
  intentionally_left_.store(false);
  if (connected_.load())
    return;
  set_connection_state(reconnect_info_.is_object() && !reconnect_info_.empty()
                           ? "reconnecting"
                           : "connecting");

  if (!connect_fn_) {
    // No WS implementation injected — stub mode.
    return;
  }

  auto weak_self = weak_from_this();
  connect_fn_(
      ws_url(),
      [weak_self](const std::string &raw) {
        if (auto self = weak_self.lock()) {
          self->handle_message(raw);
        }
      },
      [weak_self]() {
        auto self = weak_self.lock();
        if (!self)
          return;
        self->connected_.store(false);
        self->authenticated_.store(false);
        self->joined_.store(false);
        self->heartbeat_running_ = false;
        if (self->last_transport_close_code_ == 4004 &&
            self->connection_state_ != "kicked") {
          for (auto &[id, h] : self->kicked_handlers_)
            h();
          self->intentionally_left_.store(true);
          self->set_connection_state("kicked");
        }

        // Reject pending requests on unexpected disconnect
        if (!self->intentionally_left_.load()) {
          self->reject_all_pending("WebSocket connection lost");
        }

        if (!self->intentionally_left_.load() && self->opts_.auto_reconnect &&
            self->reconnect_attempts_ < self->opts_.max_reconnect_attempts) {
          self->schedule_reconnect();
        }
      });

  connected_.store(true);
  reconnect_attempts_ = 0;
  authenticate();
}

void RoomClient::leave() {
  intentionally_left_.store(true);
  reconnect_generation_.fetch_add(1);
  heartbeat_running_ = false;
  if (heartbeat_thread_.joinable())
    heartbeat_thread_.detach();

  // Reject all pending send() requests
  reject_all_pending("Room left");
  send_leave_and_close();

  connected_.store(false);
  authenticated_.store(false);
  joined_.store(false);
  shared_state_ = json::object();
  shared_version_ = 0;
  player_state_ = json::object();
  player_version_ = 0;
  room_members_ = json::array();
  media_members_ = json::array();
  current_user_id_.clear();
  current_connection_id_.clear();
  reconnect_info_ = json::object();
  set_connection_state("disconnected");
}

// ── State Accessors ─────────────────────────────────────────────────────────

json RoomClient::get_shared_state() const { return shared_state_; }

json RoomClient::get_player_state() const { return player_state_; }

// ── Send Action ─────────────────────────────────────────────────────────────

void RoomClient::send(const std::string &action_type, const json &payload,
                      ResultCallback on_result, ErrorCallback on_error) {
  if (!connected_.load() || !authenticated_.load()) {
    if (on_error)
      on_error("Not connected to room");
    return;
  }

  std::string request_id = generate_request_id();

  {
    std::lock_guard<std::mutex> lock(pending_requests_mx_);
    pending_requests_[request_id] = PendingRequest{std::move(on_result),
                                                   std::move(on_error)};
  }

  send_raw({{"type", "send"},
            {"actionType", action_type},
            {"payload", payload},
            {"requestId", request_id}});

  // Timeout for pending request
  auto weak = weak_from_this();
  int timeout_ms = opts_.send_timeout_ms;
  std::thread([weak, request_id, timeout_ms]() {
    std::this_thread::sleep_for(std::chrono::milliseconds(timeout_ms));
    auto self = weak.lock();
    if (!self) return;
    ErrorCallback on_error;
    {
      std::lock_guard<std::mutex> lock(self->pending_requests_mx_);
      auto it = self->pending_requests_.find(request_id);
      if (it != self->pending_requests_.end()) {
        on_error = std::move(it->second.on_error);
        self->pending_requests_.erase(it);
      }
    }
    if (on_error) {
      on_error("Action timed out");
    }
  }).detach();
}

// ── Subscriptions (v2 API) ──────────────────────────────────────────────────

Subscription RoomClient::on_shared_state(StateHandler handler) {
  int id = next_handler_id_.fetch_add(1);
  shared_state_handlers_[id] = std::move(handler);
  auto *map = &shared_state_handlers_;
  return Subscription{[map, id]() { map->erase(id); }};
}

Subscription RoomClient::on_player_state(StateHandler handler) {
  int id = next_handler_id_.fetch_add(1);
  player_state_handlers_[id] = std::move(handler);
  auto *map = &player_state_handlers_;
  return Subscription{[map, id]() { map->erase(id); }};
}

Subscription RoomClient::on_message(const std::string &type,
                                    MessageHandler handler) {
  int id = next_handler_id_.fetch_add(1);
  message_handlers_[type][id] = std::move(handler);
  auto *outer = &message_handlers_;
  std::string t = type;
  return Subscription{[outer, t, id]() {
    auto it = outer->find(t);
    if (it != outer->end()) {
      it->second.erase(id);
      if (it->second.empty())
        outer->erase(it);
    }
  }};
}

Subscription RoomClient::on_any_message(AllMessageHandler handler) {
  int id = next_handler_id_.fetch_add(1);
  all_message_handlers_[id] = std::move(handler);
  auto *map = &all_message_handlers_;
  return Subscription{[map, id]() { map->erase(id); }};
}

Subscription RoomClient::on_error(ErrorHandler handler) {
  int id = next_handler_id_.fetch_add(1);
  error_handlers_[id] = std::move(handler);
  auto *map = &error_handlers_;
  return Subscription{[map, id]() { map->erase(id); }};
}

Subscription RoomClient::on_kicked(KickedHandler handler) {
  int id = next_handler_id_.fetch_add(1);
  kicked_handlers_[id] = std::move(handler);
  auto *map = &kicked_handlers_;
  return Subscription{[map, id]() { map->erase(id); }};
}

Subscription RoomClient::on_signal(const std::string &event,
                                   SignalHandler handler) {
  int id = next_handler_id_.fetch_add(1);
  signal_handlers_[event][id] = std::move(handler);
  auto *outer = &signal_handlers_;
  std::string key = event;
  return Subscription{[outer, key, id]() {
    auto it = outer->find(key);
    if (it != outer->end()) {
      it->second.erase(id);
      if (it->second.empty())
        outer->erase(it);
    }
  }};
}

Subscription RoomClient::on_any_signal(AnySignalHandler handler) {
  int id = next_handler_id_.fetch_add(1);
  any_signal_handlers_[id] = std::move(handler);
  auto *map = &any_signal_handlers_;
  return Subscription{[map, id]() { map->erase(id); }};
}

Subscription RoomClient::on_members_sync(MembersSyncHandler handler) {
  int id = next_handler_id_.fetch_add(1);
  members_sync_handlers_[id] = std::move(handler);
  auto *map = &members_sync_handlers_;
  return Subscription{[map, id]() { map->erase(id); }};
}

Subscription RoomClient::on_member_join(MemberHandler handler) {
  int id = next_handler_id_.fetch_add(1);
  member_join_handlers_[id] = std::move(handler);
  auto *map = &member_join_handlers_;
  return Subscription{[map, id]() { map->erase(id); }};
}

Subscription RoomClient::on_member_leave(MemberLeaveHandler handler) {
  int id = next_handler_id_.fetch_add(1);
  member_leave_handlers_[id] = std::move(handler);
  auto *map = &member_leave_handlers_;
  return Subscription{[map, id]() { map->erase(id); }};
}

Subscription RoomClient::on_member_state_change(
    MemberStateChangeHandler handler) {
  int id = next_handler_id_.fetch_add(1);
  member_state_handlers_[id] = std::move(handler);
  auto *map = &member_state_handlers_;
  return Subscription{[map, id]() { map->erase(id); }};
}

Subscription RoomClient::on_media_track(MediaTrackHandler handler) {
  int id = next_handler_id_.fetch_add(1);
  media_track_handlers_[id] = std::move(handler);
  auto *map = &media_track_handlers_;
  return Subscription{[map, id]() { map->erase(id); }};
}

Subscription RoomClient::on_media_track_removed(MediaTrackHandler handler) {
  int id = next_handler_id_.fetch_add(1);
  media_track_removed_handlers_[id] = std::move(handler);
  auto *map = &media_track_removed_handlers_;
  return Subscription{[map, id]() { map->erase(id); }};
}

Subscription RoomClient::on_media_state_change(MediaStateHandler handler) {
  int id = next_handler_id_.fetch_add(1);
  media_state_handlers_[id] = std::move(handler);
  auto *map = &media_state_handlers_;
  return Subscription{[map, id]() { map->erase(id); }};
}

Subscription RoomClient::on_media_device_change(MediaDeviceHandler handler) {
  int id = next_handler_id_.fetch_add(1);
  media_device_handlers_[id] = std::move(handler);
  auto *map = &media_device_handlers_;
  return Subscription{[map, id]() { map->erase(id); }};
}

Subscription RoomClient::on_reconnect(ReconnectHandler handler) {
  int id = next_handler_id_.fetch_add(1);
  reconnect_handlers_[id] = std::move(handler);
  auto *map = &reconnect_handlers_;
  return Subscription{[map, id]() { map->erase(id); }};
}

Subscription RoomClient::on_connection_state_change(
    ConnectionStateHandler handler) {
  int id = next_handler_id_.fetch_add(1);
  connection_state_handlers_[id] = std::move(handler);
  auto *map = &connection_state_handlers_;
  return Subscription{[map, id]() { map->erase(id); }};
}

// ── Private: URL ────────────────────────────────────────────────────────────

std::string RoomClient::ws_url() const {
  std::string u = base_url_;
  // Replace http(s) with ws(s)
  if (u.find("https://") == 0)
    u.replace(0, 8, "wss://");
  else if (u.find("http://") == 0)
    u.replace(0, 7, "ws://");

  return u + std::string(client::ApiPaths::CONNECT_ROOM) + "?namespace=" + url_encode(namespace_name_) +
         "&id=" + url_encode(room_id_);
}

// ── Private: Auth ───────────────────────────────────────────────────────────

void RoomClient::authenticate() {
  const auto token = token_fn_();
  if (token.empty()) {
    reject_all_pending("Auth state lost");
    intentionally_left_.store(true);
    connected_.store(false);
    authenticated_.store(false);
    joined_.store(false);
    set_connection_state("auth_lost");
    if (close_fn_) {
      close_fn_();
    }
    return;
  }

  send_raw({{"type", "auth"}, {"token", token}});
}

// ── Private: Message Handling ───────────────────────────────────────────────

void RoomClient::handle_message(const std::string &raw) {
  json msg;
  try {
    msg = json::parse(raw);
  } catch (...) {
    return;
  }
  const std::string type = msg.value("type", "");
  note_protocol_message(type);

  // ── Auth success ──
  if ((type == "auth_success" || type == "auth_refreshed") && !authenticated_.load()) {
    authenticated_.store(true);
    current_user_id_ = msg.value("userId", current_user_id_);
    current_connection_id_ = msg.value("connectionId", current_connection_id_);

    // Send join with last known state for eviction recovery
    send_raw({{"type", "join"},
              {"lastSharedState", shared_state_},
              {"lastSharedVersion", shared_version_},
              {"lastPlayerState", player_state_},
              {"lastPlayerVersion", player_version_}});
    joined_.store(true);
    return;
  }

  // ── Sync (full state) ──
  if (type == "sync") {
    shared_state_ = msg.value("sharedState", json::object());
    shared_version_ = msg.value("sharedVersion", 0);
    player_state_ = msg.value("playerState", json::object());
    player_version_ = msg.value("playerVersion", 0);
    auto reconnect_info = reconnect_info_;
    reconnect_info_ = json::object();
    set_connection_state("connected");

    for (auto &[id, h] : shared_state_handlers_)
      h(shared_state_, shared_state_);
    for (auto &[id, h] : player_state_handlers_)
      h(player_state_, player_state_);
    if (reconnect_info.is_object() && !reconnect_info.empty()) {
      for (auto &[id, h] : reconnect_handlers_)
        h(reconnect_info);
    }
    return;
  }

  // ── Shared delta ──
  if (type == "shared_delta") {
    json delta = msg.value("delta", json::object());
    shared_version_ = msg.value("version", shared_version_);
    for (auto &[path, val] : delta.items())
      deep_set(shared_state_, path, val);
    for (auto &[id, h] : shared_state_handlers_)
      h(shared_state_, delta);
    return;
  }

  // ── Player delta ──
  if (type == "player_delta") {
    json delta = msg.value("delta", json::object());
    player_version_ = msg.value("version", player_version_);
    for (auto &[path, val] : delta.items())
      deep_set(player_state_, path, val);
    for (auto &[id, h] : player_state_handlers_)
      h(player_state_, delta);
    return;
  }

  // ── Action result ──
  if (type == "action_result") {
    std::string request_id = msg.value("requestId", "");
    ResultCallback on_result;
    {
      std::lock_guard<std::mutex> lock(pending_requests_mx_);
      auto it = pending_requests_.find(request_id);
      if (it != pending_requests_.end()) {
        on_result = std::move(it->second.on_result);
        pending_requests_.erase(it);
      }
    }
    if (on_result) {
      on_result(msg.value("result", json()));
    }
    return;
  }

  // ── Action error ──
  if (type == "action_error") {
    std::string request_id = msg.value("requestId", "");
    ErrorCallback on_error;
    {
      std::lock_guard<std::mutex> lock(pending_requests_mx_);
      auto it = pending_requests_.find(request_id);
      if (it != pending_requests_.end()) {
        on_error = std::move(it->second.on_error);
        pending_requests_.erase(it);
      }
    }
    if (on_error) {
      on_error(msg.value("message", "Unknown error"));
    }
    return;
  }

  // ── Server message ──
  if (type == "message") {
    std::string message_type = msg.value("messageType", "");
    json data = msg.value("data", json());

    auto it = message_handlers_.find(message_type);
    if (it != message_handlers_.end()) {
      for (auto &[id, h] : it->second)
        h(data);
    }
    for (auto &[id, h] : all_message_handlers_)
      h(message_type, data);
    return;
  }

  if (type == "signal") {
    std::string event = msg.value("event", "");
    json payload = msg.value("payload", json::object());
    json meta = msg.value("meta", json::object());
    auto it = signal_handlers_.find(event);
    if (it != signal_handlers_.end()) {
      for (auto &[id, h] : it->second)
        h(payload, meta);
    }
    for (auto &[id, h] : any_signal_handlers_)
      h(event, payload, meta);
    return;
  }

  if (type == "signal_sent") {
    resolve_pending_void(pending_signal_requests_, msg.value("requestId", ""));
    return;
  }

  if (type == "signal_error") {
    reject_pending_void(pending_signal_requests_, msg.value("requestId", ""),
                        msg.value("message", "Signal error"));
    return;
  }

  if (type == "members_sync") {
    room_members_ = msg.value("members", json::array());
    sync_media_members_with_room_members();
    for (auto &[id, h] : members_sync_handlers_)
      h(room_members_);
    return;
  }

  if (type == "member_join") {
    json member = msg.value("member", json::object());
    upsert_room_member(member);
    for (auto &[id, h] : member_join_handlers_)
      h(member);
    return;
  }

  if (type == "member_leave") {
    json member = msg.value("member", json::object());
    const auto member_id =
        member.value("memberId", member.value("userId", std::string()));
    if (!member_id.empty()) {
      room_members_.erase(std::remove_if(room_members_.begin(), room_members_.end(),
                                         [&](const json &entry) {
                                           return entry.value("memberId", entry.value("userId", std::string())) == member_id;
                                         }),
                          room_members_.end());
      media_members_.erase(std::remove_if(media_members_.begin(), media_members_.end(),
                                          [&](const json &entry) {
                                            return entry.value("member", json::object())
                                                       .value("memberId", std::string()) == member_id;
                                          }),
                           media_members_.end());
    }
    std::string reason = msg.value("reason", "");
    for (auto &[id, h] : member_leave_handlers_)
      h(member, reason);
    return;
  }

  if (type == "member_state") {
    json member = msg.value("member", json::object());
    json state = msg.value("state", member.value("state", json::object()));
    if (member.is_object() && !member.empty())
      upsert_room_member(member);
    resolve_pending_void(pending_member_state_requests_,
                         msg.value("requestId", ""));
    for (auto &[id, h] : member_state_handlers_)
      h(member, state);
    return;
  }

  if (type == "member_state_error") {
    reject_pending_void(pending_member_state_requests_,
                        msg.value("requestId", ""),
                        msg.value("message", "Member state error"));
    return;
  }

  if (type == "media_sync") {
    media_members_ = msg.value("members", json::array());
    sync_media_members_with_room_members();
    return;
  }

  if (type == "media_track") {
    json member = msg.value("member", json::object());
    json track = msg.value("track", json::object());
    upsert_media_track(member, track);
    for (auto &[id, h] : media_track_handlers_)
      h(track, member);
    return;
  }

  if (type == "media_track_removed") {
    json member = msg.value("member", json::object());
    json track = msg.value("track", json::object());
    remove_media_track(member, track);
    for (auto &[id, h] : media_track_removed_handlers_)
      h(track, member);
    return;
  }

  if (type == "media_state") {
    json member = msg.value("member", json::object());
    json state = msg.value("state", json::object());
    if (auto *media_member = ensure_media_member(member)) {
      (*media_member)["state"] = state;
    }
    for (auto &[id, h] : media_state_handlers_)
      h(member, state);
    return;
  }

  if (type == "media_device") {
    json member = msg.value("member", json::object());
    ensure_media_member(member);
    json change{{"kind", msg.value("kind", "")},
                {"deviceId", msg.value("deviceId", "")}};
    for (auto &[id, h] : media_device_handlers_)
      h(member, change);
    return;
  }

  if (type == "media_result") {
    resolve_pending_void(pending_media_requests_, msg.value("requestId", ""));
    return;
  }

  if (type == "media_error") {
    reject_pending_void(pending_media_requests_, msg.value("requestId", ""),
                        msg.value("message", "Media error"));
    return;
  }

  if (type == "admin_result") {
    resolve_pending_void(pending_admin_requests_, msg.value("requestId", ""));
    return;
  }

  if (type == "admin_error") {
    reject_pending_void(pending_admin_requests_, msg.value("requestId", ""),
                        msg.value("message", "Admin error"));
    return;
  }

  // ── Kicked ──
  if (type == "kicked") {
    for (auto &[id, h] : kicked_handlers_)
      h();
    intentionally_left_.store(true); // Don't auto-reconnect after kick
    set_connection_state("kicked");
    return;
  }

  // ── Error ──
  if (type == "error") {
    std::string code = msg.value("code", "");
    std::string message = msg.value("message", "");
    for (auto &[id, h] : error_handlers_)
      h(code, message);
    return;
  }

  // ── Pong (heartbeat response) — no action needed ──
}

// ── Private: Helpers ────────────────────────────────────────────────────────

void RoomClient::send_raw(const json &msg) {
  if (!connected_.load() || !send_fn_)
    return;
  // Note: no authenticated_ check here — send_raw is used to send the
  // auth message itself (before authentication completes).
  send_fn_(msg.dump());
}

void RoomClient::send_signal(const std::string &event, const json &payload,
                             VoidCallback on_success, ErrorCallback on_error,
                             const json &options) {
  if (!connected_.load() || !authenticated_.load()) {
    if (on_error)
      on_error("Not connected to room");
    return;
  }
  std::string request_id = generate_request_id();
  {
    std::lock_guard<std::mutex> lock(pending_requests_mx_);
    pending_signal_requests_[request_id] =
        PendingVoidRequest{std::move(on_success), std::move(on_error)};
  }
  json message{{"type", "signal"},
               {"event", event},
               {"payload", payload},
               {"requestId", request_id},
               {"includeSelf", options.value("includeSelf", false)}};
  if (options.contains("memberId"))
    message["memberId"] = options["memberId"];
  send_raw(message);

  // Timeout for pending signal request
  auto weak = weak_from_this();
  int timeout_ms = opts_.send_timeout_ms;
  std::thread([weak, request_id, timeout_ms]() {
    std::this_thread::sleep_for(std::chrono::milliseconds(timeout_ms));
    auto self = weak.lock();
    if (!self) return;
    ErrorCallback on_error;
    {
      std::lock_guard<std::mutex> lock(self->pending_requests_mx_);
      auto it = self->pending_signal_requests_.find(request_id);
      if (it != self->pending_signal_requests_.end()) {
        on_error = std::move(it->second.on_error);
        self->pending_signal_requests_.erase(it);
      }
    }
    if (on_error) {
      on_error("Signal timed out");
    }
  }).detach();
}

void RoomClient::send_member_state(const json &state, VoidCallback on_success,
                                   ErrorCallback on_error) {
  if (!connected_.load() || !authenticated_.load()) {
    if (on_error)
      on_error("Not connected to room");
    return;
  }
  std::string request_id = generate_request_id();
  {
    std::lock_guard<std::mutex> lock(pending_requests_mx_);
    pending_member_state_requests_[request_id] =
        PendingVoidRequest{std::move(on_success), std::move(on_error)};
  }
  send_raw({{"type", "member_state"},
            {"state", state},
            {"requestId", request_id}});

  // Timeout for pending member state request
  auto weak = weak_from_this();
  int timeout_ms = opts_.send_timeout_ms;
  std::thread([weak, request_id, timeout_ms]() {
    std::this_thread::sleep_for(std::chrono::milliseconds(timeout_ms));
    auto self = weak.lock();
    if (!self) return;
    ErrorCallback on_error;
    {
      std::lock_guard<std::mutex> lock(self->pending_requests_mx_);
      auto it = self->pending_member_state_requests_.find(request_id);
      if (it != self->pending_member_state_requests_.end()) {
        on_error = std::move(it->second.on_error);
        self->pending_member_state_requests_.erase(it);
      }
    }
    if (on_error) {
      on_error("Member state timed out");
    }
  }).detach();
}

void RoomClient::clear_member_state(VoidCallback on_success,
                                    ErrorCallback on_error) {
  if (!connected_.load() || !authenticated_.load()) {
    if (on_error)
      on_error("Not connected to room");
    return;
  }
  std::string request_id = generate_request_id();
  {
    std::lock_guard<std::mutex> lock(pending_requests_mx_);
    pending_member_state_requests_[request_id] =
        PendingVoidRequest{std::move(on_success), std::move(on_error)};
  }
  send_raw({{"type", "member_state_clear"}, {"requestId", request_id}});

  // Timeout for pending member state clear request
  auto weak = weak_from_this();
  int timeout_ms = opts_.send_timeout_ms;
  std::thread([weak, request_id, timeout_ms]() {
    std::this_thread::sleep_for(std::chrono::milliseconds(timeout_ms));
    auto self = weak.lock();
    if (!self) return;
    ErrorCallback on_error;
    {
      std::lock_guard<std::mutex> lock(self->pending_requests_mx_);
      auto it = self->pending_member_state_requests_.find(request_id);
      if (it != self->pending_member_state_requests_.end()) {
        on_error = std::move(it->second.on_error);
        self->pending_member_state_requests_.erase(it);
      }
    }
    if (on_error) {
      on_error("Member state clear timed out");
    }
  }).detach();
}

void RoomClient::send_admin(const std::string &operation,
                            const std::string &member_id,
                            const json &payload, VoidCallback on_success,
                            ErrorCallback on_error) {
  if (!connected_.load() || !authenticated_.load()) {
    if (on_error)
      on_error("Not connected to room");
    return;
  }
  std::string request_id = generate_request_id();
  {
    std::lock_guard<std::mutex> lock(pending_requests_mx_);
    pending_admin_requests_[request_id] =
        PendingVoidRequest{std::move(on_success), std::move(on_error)};
  }
  send_raw({{"type", "admin"},
            {"operation", operation},
            {"memberId", member_id},
            {"payload", payload},
            {"requestId", request_id}});

  // Timeout for pending admin request
  auto weak = weak_from_this();
  int timeout_ms = opts_.send_timeout_ms;
  std::thread([weak, request_id, timeout_ms]() {
    std::this_thread::sleep_for(std::chrono::milliseconds(timeout_ms));
    auto self = weak.lock();
    if (!self) return;
    ErrorCallback on_error;
    {
      std::lock_guard<std::mutex> lock(self->pending_requests_mx_);
      auto it = self->pending_admin_requests_.find(request_id);
      if (it != self->pending_admin_requests_.end()) {
        on_error = std::move(it->second.on_error);
        self->pending_admin_requests_.erase(it);
      }
    }
    if (on_error) {
      on_error("Admin action timed out");
    }
  }).detach();
}

void RoomClient::send_media(const std::string &operation,
                            const std::string &kind, const json &payload,
                            VoidCallback on_success, ErrorCallback on_error) {
  if (!connected_.load() || !authenticated_.load()) {
    if (on_error)
      on_error("Not connected to room");
    return;
  }
  std::string request_id = generate_request_id();
  {
    std::lock_guard<std::mutex> lock(pending_requests_mx_);
    pending_media_requests_[request_id] =
        PendingVoidRequest{std::move(on_success), std::move(on_error)};
  }
  send_raw({{"type", "media"},
            {"operation", operation},
            {"kind", kind},
            {"payload", payload},
            {"requestId", request_id}});

  // Timeout for pending media request
  auto weak = weak_from_this();
  int timeout_ms = opts_.send_timeout_ms;
  std::thread([weak, request_id, timeout_ms]() {
    std::this_thread::sleep_for(std::chrono::milliseconds(timeout_ms));
    auto self = weak.lock();
    if (!self) return;
    ErrorCallback on_error;
    {
      std::lock_guard<std::mutex> lock(self->pending_requests_mx_);
      auto it = self->pending_media_requests_.find(request_id);
      if (it != self->pending_media_requests_.end()) {
        on_error = std::move(it->second.on_error);
        self->pending_media_requests_.erase(it);
      }
    }
    if (on_error) {
      on_error("Media action timed out");
    }
  }).detach();
}

void RoomClient::switch_media_devices(const json &payload,
                                      VoidCallback on_success,
                                      ErrorCallback on_error) {
  auto shared_success = std::make_shared<std::atomic<int>>(0);
  auto expected = std::make_shared<int>(0);
  auto maybe_send = [&](const char *kind, const char *key) {
    if (payload.contains(key) && payload[key].is_string() &&
        !payload[key].get<std::string>().empty()) {
      (*expected)++;
      send_media("device", kind, json{{"deviceId", payload[key]}},
                 [shared_success, expected, on_success]() {
                   if (shared_success->fetch_add(1) + 1 == *expected && on_success)
                     on_success();
                 },
                 on_error);
    }
  };
  maybe_send("audio", "audioInputId");
  maybe_send("video", "videoInputId");
  maybe_send("screen", "screenInputId");
  if (*expected == 0 && on_success)
    on_success();
}

void RoomClient::send_leave_and_close() {
  if (connected_.load() && send_fn_) {
    send_fn_(json{{"type", "leave"}}.dump());
  }

  if (!close_fn_)
    return;

  auto close = close_fn_;
  std::thread([close]() mutable {
    std::this_thread::sleep_for(
        std::chrono::milliseconds(kRoomExplicitLeaveCloseDelayMs));
    close();
  }).detach();
}

void RoomClient::schedule_reconnect() {
  if (reconnect_attempts_ >= opts_.max_reconnect_attempts)
    return;
  int delay = std::min(
      opts_.reconnect_base_delay_ms * (1 << reconnect_attempts_), 30000);
  const auto generation = reconnect_generation_.fetch_add(1) + 1;
  auto weak_self = weak_from_this();
  reconnect_attempts_++;
  reconnect_info_ = json{{"attempt", reconnect_attempts_}};
  set_connection_state("reconnecting");
  std::thread([weak_self, delay, generation]() {
    std::this_thread::sleep_for(std::chrono::milliseconds(delay));
    auto self = weak_self.lock();
    if (!self)
      return;
    if (self->shutting_down_.load())
      return;
    if (self->intentionally_left_.load())
      return;
    if (self->reconnect_generation_.load() != generation)
      return;
    self->join();
  }).detach();
}

std::string RoomClient::generate_request_id() {
  uint64_t count = request_counter_.fetch_add(1);
  auto now = std::chrono::steady_clock::now().time_since_epoch();
  auto ms =
      std::chrono::duration_cast<std::chrono::milliseconds>(now).count();
  std::ostringstream oss;
  oss << "req-" << ms << "-" << count;
  return oss.str();
}

void RoomClient::reject_all_pending(const std::string &reason) {
  std::vector<ErrorCallback> callbacks;
  {
    std::lock_guard<std::mutex> lock(pending_requests_mx_);
    callbacks.reserve(pending_requests_.size() + pending_signal_requests_.size() +
                      pending_admin_requests_.size() +
                      pending_member_state_requests_.size() +
                      pending_media_requests_.size());
    for (auto &[id, pending] : pending_requests_) {
      if (pending.on_error)
        callbacks.push_back(std::move(pending.on_error));
    }
    pending_requests_.clear();
    for (auto &[id, request] : pending_signal_requests_) {
      if (request.on_error)
        callbacks.push_back(std::move(request.on_error));
    }
    pending_signal_requests_.clear();
    for (auto &[id, request] : pending_admin_requests_) {
      if (request.on_error)
        callbacks.push_back(std::move(request.on_error));
    }
    pending_admin_requests_.clear();
    for (auto &[id, request] : pending_member_state_requests_) {
      if (request.on_error)
        callbacks.push_back(std::move(request.on_error));
    }
    pending_member_state_requests_.clear();
    for (auto &[id, request] : pending_media_requests_) {
      if (request.on_error)
        callbacks.push_back(std::move(request.on_error));
    }
    pending_media_requests_.clear();
  }
  for (auto &callback : callbacks) {
    callback(reason);
  }
}

void RoomClient::resolve_pending_void(
    std::map<std::string, PendingVoidRequest> &pending,
    const std::string &request_id) {
  VoidCallback on_success;
  {
    std::lock_guard<std::mutex> lock(pending_requests_mx_);
    auto it = pending.find(request_id);
    if (it != pending.end()) {
      on_success = std::move(it->second.on_success);
      pending.erase(it);
    }
  }
  if (on_success) {
    on_success();
  }
}

void RoomClient::reject_pending_void(
    std::map<std::string, PendingVoidRequest> &pending,
    const std::string &request_id, const std::string &message) {
  ErrorCallback on_error;
  {
    std::lock_guard<std::mutex> lock(pending_requests_mx_);
    auto it = pending.find(request_id);
    if (it != pending.end()) {
      on_error = std::move(it->second.on_error);
      pending.erase(it);
    }
  }
  if (on_error) {
    on_error(message);
  }
}

void RoomClient::set_connection_state(const std::string &state) {
  if (connection_state_ == state)
    return;
  connection_state_ = state;
  for (auto &[id, h] : connection_state_handlers_)
    h(state);
}

void RoomClient::upsert_room_member(const json &member) {
  const auto member_id =
      member.value("memberId", member.value("userId", std::string()));
  if (member_id.empty())
    return;
  for (auto &entry : room_members_) {
    if (entry.value("memberId", entry.value("userId", std::string())) ==
        member_id) {
      entry = member;
      return;
    }
  }
  room_members_.push_back(member);
}

json *RoomClient::ensure_media_member(const json &member) {
  const auto member_id =
      member.value("memberId", member.value("userId", std::string()));
  if (member_id.empty())
    return nullptr;
  for (auto &entry : media_members_) {
    if (entry.value("member", json::object())
            .value("memberId", std::string()) == member_id) {
      entry["member"] = member;
      if (!entry.contains("state"))
        entry["state"] = json::object();
      if (!entry.contains("tracks"))
        entry["tracks"] = json::array();
      return &entry;
    }
  }
  media_members_.push_back(
      json{{"member", member}, {"state", json::object()}, {"tracks", json::array()}});
  return &media_members_.back();
}

void RoomClient::sync_media_members_with_room_members() {
  media_members_.erase(std::remove_if(media_members_.begin(), media_members_.end(),
                                      [&](const json &entry) {
                                        const auto member_id =
                                            entry.value("member", json::object())
                                                .value("memberId",
                                                       std::string());
                                        if (member_id.empty())
                                          return false;
                                        return std::none_of(
                                            room_members_.begin(),
                                            room_members_.end(),
                                            [&](const json &member) {
                                              return member.value(
                                                         "memberId",
                                                         member.value(
                                                             "userId",
                                                             std::string())) ==
                                                     member_id;
                                            });
                                      }),
                       media_members_.end());
}

void RoomClient::upsert_media_track(const json &member, const json &track) {
  auto *media_member = ensure_media_member(member);
  if (!media_member)
    return;
  auto &tracks = (*media_member)["tracks"];
  const auto track_id = track.value("trackId", std::string());
  const auto kind = track.value("kind", std::string());
  for (auto &entry : tracks) {
    if ((!track_id.empty() && entry.value("trackId", std::string()) == track_id) ||
        (track_id.empty() && !kind.empty() &&
         entry.value("kind", std::string()) == kind)) {
      entry = track;
      return;
    }
  }
  tracks.push_back(track);
}

void RoomClient::remove_media_track(const json &member, const json &track) {
  auto *media_member = ensure_media_member(member);
  if (!media_member)
    return;
  auto &tracks = (*media_member)["tracks"];
  const auto track_id = track.value("trackId", std::string());
  const auto kind = track.value("kind", std::string());
  tracks.erase(std::remove_if(tracks.begin(), tracks.end(), [&](const json &entry) {
                 return (!track_id.empty() &&
                         entry.value("trackId", std::string()) == track_id) ||
                        (track_id.empty() && !kind.empty() &&
                         entry.value("kind", std::string()) == kind);
               }),
               tracks.end());
}

// Recursive dot-path deep set.
void RoomClient::deep_set(json &obj, const std::string &path,
                          const json &value) {
  auto dot = path.find('.');
  if (dot == std::string::npos) {
    if (value.is_null())
      obj.erase(path);
    else
      obj[path] = value;
    return;
  }
  std::string head = path.substr(0, dot);
  std::string tail = path.substr(dot + 1);
  if (!obj.contains(head) || !obj[head].is_object())
    obj[head] = json::object();
  deep_set(obj[head], tail, value);
}

std::string RoomClient::trim_trailing_slash(const std::string &s) {
  std::string r = s;
  while (!r.empty() && r.back() == '/')
    r.pop_back();
  return r;
}

std::string RoomClient::url_encode(const std::string &s) {
  std::ostringstream encoded;
  for (unsigned char c : s) {
    if (isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~')
      encoded << c;
    else
      encoded << '%' << std::uppercase << std::hex << std::setw(2)
              << std::setfill('0') << static_cast<int>(c);
  }
  return encoded.str();
}

void RoomClient::note_transport_event(const std::string &event,
                                      const std::string &reason,
                                      int http_status,
                                      int close_code) {
  std::lock_guard<std::mutex> lock(diagnostic_mx_);
  last_transport_event_ = event;
  last_transport_reason_ = reason;
  last_transport_http_status_ = http_status;
  last_transport_close_code_ = close_code;
  if (event == "open") {
    transport_opened_ = true;
  }
}

void RoomClient::note_protocol_message(const std::string &type) {
  std::lock_guard<std::mutex> lock(diagnostic_mx_);
  last_protocol_message_type_ = type;
}

} // namespace edgebase
