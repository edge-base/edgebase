// room_client.h — RoomClient v2 for EdgeBase C++ SDK.
// Real-time multiplayer state synchronisation using WebSocket.
//
// v2 REDESIGN: 3 state areas (sharedState, playerState, serverState).
//   - Client can only read + subscribe + send(). All writes are server-only.
//   - send() uses requestId + callback pairs for async result matching.
//   - Subscription returns a Subscription struct with unsubscribe().
//   - namespace + roomId identification (replaces single roomId).
//
// Usage:
//   auto room = client.room("game", "lobby-1");
//   room->join();
//   room->on_shared_state([](const json& state, const json& changes) { });
//   room->send("SET_SCORE", {{"score", 42}},
//     [](const json& result) { /* success */ },
//     [](const std::string& err) { /* error */ });
//   room->leave();

#pragma once
#include <atomic>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include "nlohmann/json.hpp"

namespace edgebase {

using json = nlohmann::json;

// ── Subscription ────────────────────────────────────────────────────────────

/// Returned by on_*() methods. Call unsubscribe() to remove the handler.
struct Subscription {
  std::function<void()> unsubscribe;
};

// ── Types ───────────────────────────────────────────────────────────────────

/// Options for RoomClient connection behaviour.
struct RoomOptions {
  bool auto_reconnect = true;
  int max_reconnect_attempts = 10;
  int reconnect_base_delay_ms = 1000;
  int send_timeout_ms = 10000;
};

/**
 * @brief RoomClient v2 manages a WebSocket connection to an EdgeBase Room.
 *
 * Note: This is a platform-agnostic header. Integrate with your preferred
 * WebSocket library (e.g., Boost.Beast, libwebsockets, uWebSockets) by
 * supplying the _ws_impl. A stub implementation is provided.
 */
class RoomClient : public std::enable_shared_from_this<RoomClient> {
public:
  struct Diagnostic {
    bool connected = false;
    bool authenticated = false;
    bool joined = false;
    bool transportOpened = false;
    std::string lastTransportEvent;
    std::string lastTransportReason;
    int lastTransportHttpStatus = 0;
    int lastTransportCloseCode = 0;
    std::string lastProtocolMessageType;
  };

  // ── Handler types ─────────────────────────────────────────────────────
  using StateHandler = std::function<void(const json &state, const json &changes)>;
  using MessageHandler = std::function<void(const json &data)>;
  using AllMessageHandler = std::function<void(const std::string &type, const json &data)>;
  using ErrorHandler =
      std::function<void(const std::string &code, const std::string &message)>;
  using KickedHandler = std::function<void()>;
  using ResultCallback = std::function<void(const json &)>;
  using ErrorCallback = std::function<void(const std::string &)>;
  using VoidCallback = std::function<void()>;
  using TokenFn = std::function<std::string()>;
  using MembersSyncHandler = std::function<void(const json &)>;
  using MemberHandler = std::function<void(const json &)>;
  using MemberLeaveHandler =
      std::function<void(const json &, const std::string &)>;
  using MemberStateChangeHandler =
      std::function<void(const json &, const json &)>;
  using SignalHandler = std::function<void(const json &, const json &)>;
  using AnySignalHandler =
      std::function<void(const std::string &, const json &, const json &)>;
  using MediaTrackHandler = std::function<void(const json &, const json &)>;
  using MediaStateHandler = std::function<void(const json &, const json &)>;
  using MediaDeviceHandler = std::function<void(const json &, const json &)>;
  using ReconnectHandler = std::function<void(const json &)>;
  using ConnectionStateHandler = std::function<void(const std::string &)>;

  struct StateNamespace {
    RoomClient *room = nullptr;
    json get_shared() const {
      return room ? room->get_shared_state() : json::object();
    }
    json get_mine() const {
      return room ? room->get_player_state() : json::object();
    }
    Subscription on_shared_change(StateHandler handler) {
      return room ? room->on_shared_state(std::move(handler))
                  : Subscription{};
    }
    Subscription on_mine_change(StateHandler handler) {
      return room ? room->on_player_state(std::move(handler))
                  : Subscription{};
    }
    void send(const std::string &action_type, const json &payload,
              ResultCallback on_result, ErrorCallback on_error) {
      if (room) {
        room->send(action_type, payload, std::move(on_result),
                   std::move(on_error));
      }
    }
  };

  struct MetaNamespace {
    RoomClient *room = nullptr;
    json get() const { return room ? room->get_metadata() : json::object(); }
  };

  struct SignalsNamespace {
    RoomClient *room = nullptr;
    void send(const std::string &event, const json &payload,
              VoidCallback on_success, ErrorCallback on_error,
              const json &options = json::object()) {
      if (room) {
        room->send_signal(event, payload, std::move(on_success),
                          std::move(on_error), options);
      }
    }
    void send_to(const std::string &member_id, const std::string &event,
                 const json &payload, VoidCallback on_success,
                 ErrorCallback on_error) {
      if (room) {
        room->send_signal(event, payload, std::move(on_success),
                          std::move(on_error),
                          json{{"memberId", member_id}});
      }
    }
    Subscription on(const std::string &event, SignalHandler handler) {
      return room ? room->on_signal(event, std::move(handler))
                  : Subscription{};
    }
    Subscription on_any(AnySignalHandler handler) {
      return room ? room->on_any_signal(std::move(handler)) : Subscription{};
    }
  };

  struct MembersNamespace {
    RoomClient *room = nullptr;
    json list() const { return room ? room->room_members_ : json::array(); }
    Subscription on_sync(MembersSyncHandler handler) {
      return room ? room->on_members_sync(std::move(handler))
                  : Subscription{};
    }
    Subscription on_join(MemberHandler handler) {
      return room ? room->on_member_join(std::move(handler))
                  : Subscription{};
    }
    Subscription on_leave(MemberLeaveHandler handler) {
      return room ? room->on_member_leave(std::move(handler))
                  : Subscription{};
    }
    void set_state(const json &state, VoidCallback on_success,
                   ErrorCallback on_error) {
      if (room) {
        room->send_member_state(state, std::move(on_success),
                                std::move(on_error));
      }
    }
    void clear_state(VoidCallback on_success, ErrorCallback on_error) {
      if (room) {
        room->clear_member_state(std::move(on_success), std::move(on_error));
      }
    }
    Subscription on_state_change(MemberStateChangeHandler handler) {
      return room ? room->on_member_state_change(std::move(handler))
                  : Subscription{};
    }
  };

  struct AdminNamespace {
    RoomClient *room = nullptr;
    void kick(const std::string &member_id, VoidCallback on_success,
              ErrorCallback on_error) {
      if (room) {
        room->send_admin("kick", member_id, json::object(),
                         std::move(on_success), std::move(on_error));
      }
    }
    void mute(const std::string &member_id, VoidCallback on_success,
              ErrorCallback on_error) {
      if (room) {
        room->send_admin("mute", member_id, json::object(),
                         std::move(on_success), std::move(on_error));
      }
    }
    void block(const std::string &member_id, VoidCallback on_success,
               ErrorCallback on_error) {
      if (room) {
        room->send_admin("block", member_id, json::object(),
                         std::move(on_success), std::move(on_error));
      }
    }
    void set_role(const std::string &member_id, const std::string &role,
                  VoidCallback on_success, ErrorCallback on_error) {
      if (room) {
        room->send_admin("setRole", member_id, json{{"role", role}},
                         std::move(on_success), std::move(on_error));
      }
    }
    void disable_video(const std::string &member_id, VoidCallback on_success,
                       ErrorCallback on_error) {
      if (room) {
        room->send_admin("disableVideo", member_id, json::object(),
                         std::move(on_success), std::move(on_error));
      }
    }
    void stop_screen_share(const std::string &member_id,
                           VoidCallback on_success,
                           ErrorCallback on_error) {
      if (room) {
        room->send_admin("stopScreenShare", member_id, json::object(),
                         std::move(on_success), std::move(on_error));
      }
    }
  };

  struct MediaNamespace {
    static constexpr const char *documentation_url =
        "https://edgebase.fun/docs/room/media";

    struct TransportOptions {
      std::string provider = "cloudflare_realtimekit";
      json cloudflare_realtimekit = json::object();
      json p2p = json::object();
    };

    struct CloudflareRealtimeKitNamespace {
      static std::string unavailable_message() {
        return std::string(
                   "Room media transport provider 'cloudflare_realtimekit' is "
                   "not available yet in EdgeBase C++. See ") +
               documentation_url;
      }

      void create_session(const json &,
                          ResultCallback,
                          ErrorCallback on_error) const {
        report_unavailable(on_error, unavailable_message());
      }
    };

    struct Transport {
      std::string provider = "cloudflare_realtimekit";

      void connect(const json &,
                   ResultCallback,
                   ErrorCallback on_error) const {
        report_unavailable(on_error, unavailable_message(provider));
      }

      void enable_audio(const json &,
                        ResultCallback,
                        ErrorCallback on_error) const {
        report_unavailable(on_error, unavailable_message(provider));
      }

      void enable_video(const json &,
                        ResultCallback,
                        ErrorCallback on_error) const {
        report_unavailable(on_error, unavailable_message(provider));
      }

      void start_screen_share(const json &,
                              ResultCallback,
                              ErrorCallback on_error) const {
        report_unavailable(on_error, unavailable_message(provider));
      }

      void disable_audio(VoidCallback, ErrorCallback on_error) const {
        report_unavailable(on_error, unavailable_message(provider));
      }

      void disable_video(VoidCallback, ErrorCallback on_error) const {
        report_unavailable(on_error, unavailable_message(provider));
      }

      void stop_screen_share(VoidCallback, ErrorCallback on_error) const {
        report_unavailable(on_error, unavailable_message(provider));
      }

      void set_muted(const std::string &,
                     bool,
                     VoidCallback,
                     ErrorCallback on_error) const {
        report_unavailable(on_error, unavailable_message(provider));
      }

      void switch_devices(const json &, VoidCallback, ErrorCallback on_error) const {
        report_unavailable(on_error, unavailable_message(provider));
      }

      Subscription on_remote_track(MediaTrackHandler) const {
        throw std::runtime_error(unavailable_message(provider));
      }

      std::string get_session_id() const { return std::string(); }

      void *get_peer_connection() const { return nullptr; }

      void destroy() const {}

    private:
      static std::string unavailable_message(const std::string &provider_name) {
        return std::string("Room media transport provider '") + provider_name +
               "' is not available yet in EdgeBase C++. See " +
               documentation_url;
      }
    };

    struct KindNamespace {
      RoomClient *room = nullptr;
      std::string kind;
      void enable(const json &payload, VoidCallback on_success,
                  ErrorCallback on_error) {
        if (room) {
          room->send_media("publish", kind, payload, std::move(on_success),
                           std::move(on_error));
        }
      }
      void disable(VoidCallback on_success, ErrorCallback on_error) {
        if (room) {
          room->send_media("unpublish", kind, json::object(),
                           std::move(on_success), std::move(on_error));
        }
      }
      void set_muted(bool muted, VoidCallback on_success,
                     ErrorCallback on_error) {
        if (room) {
          room->send_media("mute", kind, json{{"muted", muted}},
                           std::move(on_success), std::move(on_error));
        }
      }
    };

    struct ScreenNamespace {
      RoomClient *room = nullptr;
      void start(const json &payload, VoidCallback on_success,
                 ErrorCallback on_error) {
        if (room) {
          room->send_media("publish", "screen", payload,
                           std::move(on_success), std::move(on_error));
        }
      }
      void stop(VoidCallback on_success, ErrorCallback on_error) {
        if (room) {
          room->send_media("unpublish", "screen", json::object(),
                           std::move(on_success), std::move(on_error));
        }
      }
    };

    struct DevicesNamespace {
      RoomClient *room = nullptr;
      void set(const json &payload, VoidCallback on_success,
               ErrorCallback on_error) {
        if (room) {
          room->switch_media_devices(payload, std::move(on_success),
                                     std::move(on_error));
        }
      }
    };

    explicit MediaNamespace(RoomClient *owner = nullptr)
        : room(owner), audio{owner, "audio"}, video{owner, "video"},
          screen{owner}, devices{owner}, cloudflare_realtimekit{} {}

    RoomClient *room = nullptr;
    KindNamespace audio;
    KindNamespace video;
    ScreenNamespace screen;
    DevicesNamespace devices;
    CloudflareRealtimeKitNamespace cloudflare_realtimekit;

    json list() const { return room ? room->media_members_ : json::array(); }
    Transport transport() const {
      return transport(TransportOptions{});
    }

    Transport transport(const TransportOptions &options) const {
      return Transport{
          options.provider.empty() ? std::string("cloudflare_realtimekit")
                                   : options.provider,
      };
    }
    Subscription on_track(MediaTrackHandler handler) {
      return room ? room->on_media_track(std::move(handler)) : Subscription{};
    }
    Subscription on_track_removed(MediaTrackHandler handler) {
      return room ? room->on_media_track_removed(std::move(handler))
                  : Subscription{};
    }
    Subscription on_state_change(MediaStateHandler handler) {
      return room ? room->on_media_state_change(std::move(handler))
                  : Subscription{};
    }
    Subscription on_device_change(MediaDeviceHandler handler) {
      return room ? room->on_media_device_change(std::move(handler))
                  : Subscription{};
    }

  private:
    static void report_unavailable(ErrorCallback on_error,
                                   const std::string &message) {
      if (on_error) {
        on_error(message);
        return;
      }
      throw std::runtime_error(message);
    }
  };

  struct SessionNamespace {
    RoomClient *room = nullptr;
    Subscription on_error(ErrorHandler handler) {
      return room ? room->on_error(std::move(handler)) : Subscription{};
    }
    Subscription on_kicked(KickedHandler handler) {
      return room ? room->on_kicked(std::move(handler)) : Subscription{};
    }
    Subscription on_reconnect(ReconnectHandler handler) {
      return room ? room->on_reconnect(std::move(handler)) : Subscription{};
    }
    Subscription on_connection_state_change(ConnectionStateHandler handler) {
      return room ? room->on_connection_state_change(std::move(handler))
                  : Subscription{};
    }
    std::string user_id() const { return room ? room->current_user_id_ : ""; }
    std::string connection_id() const {
      return room ? room->current_connection_id_ : "";
    }
    std::string connection_state() const {
      return room ? room->connection_state_ : "idle";
    }
  };

  // ── Platform-injected WebSocket functions ─────────────────────────────
  using SendFn = std::function<void(const std::string &)>;
  using ConnectFn =
      std::function<void(const std::string &url,
                         std::function<void(const std::string &)> on_message,
                         std::function<void()> on_close)>;
  using CloseFn = std::function<void()>;

  using Options = RoomOptions;

  RoomClient(const std::string &base_url, const std::string &namespace_name,
             const std::string &room_id, TokenFn token_fn,
             Options opts = Options())
      : namespace_name_(namespace_name), room_id_(room_id),
        base_url_(trim_trailing_slash(base_url)),
        token_fn_(std::move(token_fn)), opts_(opts), state{this}, meta{this},
        signals{this}, members{this}, admin{this}, media{this},
        session{this} {}
  ~RoomClient();

  // ── Metadata (HTTP, no WebSocket needed) ──────────────────────────────

  /// Get room metadata without joining (HTTP GET).
  /// Returns developer-defined metadata set by room.setMetadata() on the server.
  /// Requires an HTTP GET implementation to be injected via set_http_get_fn().
  json get_metadata() const;

  /// Static: Get room metadata without creating a RoomClient instance.
  /// Useful for lobby screens where you need room info before joining.
  static json get_metadata(const std::string &base_url,
                           const std::string &namespace_name,
                           const std::string &room_id,
                           std::function<std::string(const std::string &)> http_get_fn);

  // ── Connection ────────────────────────────────────────────────────────

  /// Connect to the room, authenticate, and join.
  void join();

  /// Leave the room and disconnect. Cleans up all pending requests.
  void leave();

  // ── State Accessors (read-only) ───────────────────────────────────────

  /// Get current shared state (snapshot copy).
  json get_shared_state() const;

  /// Get current player state (snapshot copy).
  json get_player_state() const;

  /// Connection/auth lifecycle hints for headless runners and diagnostics.
  bool is_connected() const { return connected_.load(); }
  bool is_authenticated() const { return authenticated_.load(); }
  bool is_joined() const { return joined_.load(); }
  bool is_ready() const {
    return connected_.load() && authenticated_.load() && joined_.load();
  }
  Diagnostic get_diagnostic() const;
  void note_transport_event(const std::string &event, const std::string &reason,
                            int http_status = 0, int close_code = 0);
  void note_protocol_message(const std::string &type);

  // ── Send Action ───────────────────────────────────────────────────────

  /// Send an action to the server. Callbacks are invoked when the server
  /// responds with action_result or action_error for the matching requestId.
  void send(const std::string &action_type, const json &payload,
            ResultCallback on_result, ErrorCallback on_error);

  // ── Subscriptions (v2 API) ────────────────────────────────────────────

  /// Subscribe to shared state changes (full sync + deltas).
  Subscription on_shared_state(StateHandler handler);

  /// Subscribe to player state changes (full sync + deltas).
  Subscription on_player_state(StateHandler handler);

  /// Subscribe to messages of a specific type sent by room.sendMessage().
  Subscription on_message(const std::string &type, MessageHandler handler);

  /// Subscribe to ALL messages regardless of type.
  Subscription on_any_message(AllMessageHandler handler);

  /// Subscribe to errors.
  Subscription on_error(ErrorHandler handler);

  /// Subscribe to kick events.
  Subscription on_kicked(KickedHandler handler);

  /// Test-only hook for feeding parsed room protocol frames.
  void handle_raw_for_testing(const std::string &raw) { handle_message(raw); }

  StateNamespace state;
  MetaNamespace meta;
  SignalsNamespace signals;
  MembersNamespace members;
  AdminNamespace admin;
  MediaNamespace media;
  SessionNamespace session;

  // ── Inject WebSocket implementations (platform-specific) ─────────────

  /// Provide a connect function that starts a WebSocket connection.
  void set_connect_fn(ConnectFn fn) { connect_fn_ = std::move(fn); }
  /// Provide a send function that sends text frames.
  void set_send_fn(SendFn fn) { send_fn_ = std::move(fn); }
  /// Provide a close function.
  void set_close_fn(CloseFn fn) { close_fn_ = std::move(fn); }
  /// Provide an HTTP GET function (url → response body string).
  void set_http_get_fn(std::function<std::string(const std::string &)> fn) {
    http_get_fn_ = std::move(fn);
  }
  /// Provide a metadata fetch function that delegates to GeneratedDbApi.
  /// Receives (namespace, roomId) and returns parsed JSON metadata.
  /// When set, get_metadata() uses this instead of constructing URLs directly.
  using MetadataFetchFn =
      std::function<json(const std::string &ns, const std::string &roomId)>;
  void set_metadata_fetch_fn(MetadataFetchFn fn) {
    metadata_fetch_fn_ = std::move(fn);
  }

  const std::string namespace_name_;
  const std::string room_id_;

private:
  std::string base_url_;
  TokenFn token_fn_;
  Options opts_;
  ConnectFn connect_fn_;
  SendFn send_fn_;
  CloseFn close_fn_;
  std::function<std::string(const std::string &)> http_get_fn_;
  MetadataFetchFn metadata_fetch_fn_;

  // ── State ─────────────────────────────────────────────────────────────
  json shared_state_ = json::object();
  int shared_version_ = 0;
  json player_state_ = json::object();
  int player_version_ = 0;
  json room_members_ = json::array();
  json media_members_ = json::array();
  std::string current_user_id_;
  std::string current_connection_id_;
  std::string connection_state_ = "idle";
  json reconnect_info_ = json::object();

  // ── Connection state ──────────────────────────────────────────────────
  std::atomic<bool> connected_{false};
  std::atomic<bool> authenticated_{false};
  std::atomic<bool> joined_{false};
  std::atomic<bool> intentionally_left_{false};
  std::atomic<bool> shutting_down_{false};
  std::atomic<uint64_t> reconnect_generation_{0};
  int reconnect_attempts_ = 0;

  // ── Pending send() requests (requestId -> callbacks) ──────────────────
  struct PendingRequest {
    ResultCallback on_result;
    ErrorCallback on_error;
  };
  struct PendingVoidRequest {
    VoidCallback on_success;
    ErrorCallback on_error;
  };
  std::map<std::string, PendingRequest> pending_requests_;
  std::map<std::string, PendingVoidRequest> pending_signal_requests_;
  std::map<std::string, PendingVoidRequest> pending_admin_requests_;
  std::map<std::string, PendingVoidRequest> pending_member_state_requests_;
  std::map<std::string, PendingVoidRequest> pending_media_requests_;
  mutable std::mutex pending_requests_mx_;

  // ── Handler lists (keyed by ID for reliable unsubscribe) ───────────────
  std::atomic<int> next_handler_id_{1};
  std::map<int, StateHandler> shared_state_handlers_;
  std::map<int, StateHandler> player_state_handlers_;
  // message_handlers_: outer key = messageType, inner key = handler ID
  std::map<std::string, std::map<int, MessageHandler>> message_handlers_;
  std::map<int, AllMessageHandler> all_message_handlers_;
  std::map<int, ErrorHandler> error_handlers_;
  std::map<int, KickedHandler> kicked_handlers_;
  std::map<int, MembersSyncHandler> members_sync_handlers_;
  std::map<int, MemberHandler> member_join_handlers_;
  std::map<int, MemberLeaveHandler> member_leave_handlers_;
  std::map<int, MemberStateChangeHandler> member_state_handlers_;
  std::map<std::string, std::map<int, SignalHandler>> signal_handlers_;
  std::map<int, AnySignalHandler> any_signal_handlers_;
  std::map<int, MediaTrackHandler> media_track_handlers_;
  std::map<int, MediaTrackHandler> media_track_removed_handlers_;
  std::map<int, MediaStateHandler> media_state_handlers_;
  std::map<int, MediaDeviceHandler> media_device_handlers_;
  std::map<int, ReconnectHandler> reconnect_handlers_;
  std::map<int, ConnectionStateHandler> connection_state_handlers_;

  // ── Heartbeat ─────────────────────────────────────────────────────────
  std::thread heartbeat_thread_;
  bool heartbeat_running_ = false;

  // ── Request ID generation ─────────────────────────────────────────────
  std::atomic<uint64_t> request_counter_{0};

  // ── Private methods ───────────────────────────────────────────────────
  std::string ws_url() const;
  void authenticate();
  void handle_message(const std::string &raw);
  void send_leave_and_close();
  void send_raw(const json &msg);
  void send_signal(const std::string &event, const json &payload,
                   VoidCallback on_success, ErrorCallback on_error,
                   const json &options);
  void send_member_state(const json &state, VoidCallback on_success,
                         ErrorCallback on_error);
  void clear_member_state(VoidCallback on_success, ErrorCallback on_error);
  void send_admin(const std::string &operation, const std::string &member_id,
                  const json &payload, VoidCallback on_success,
                  ErrorCallback on_error);
  void send_media(const std::string &operation, const std::string &kind,
                  const json &payload, VoidCallback on_success,
                  ErrorCallback on_error);
  void switch_media_devices(const json &payload, VoidCallback on_success,
                            ErrorCallback on_error);
  void schedule_reconnect();
  std::string generate_request_id();
  void reject_all_pending(const std::string &reason);
  void resolve_pending_void(std::map<std::string, PendingVoidRequest> &pending,
                            const std::string &request_id);
  void reject_pending_void(std::map<std::string, PendingVoidRequest> &pending,
                           const std::string &request_id,
                           const std::string &message);
  Subscription on_signal(const std::string &event, SignalHandler handler);
  Subscription on_any_signal(AnySignalHandler handler);
  Subscription on_members_sync(MembersSyncHandler handler);
  Subscription on_member_join(MemberHandler handler);
  Subscription on_member_leave(MemberLeaveHandler handler);
  Subscription on_member_state_change(MemberStateChangeHandler handler);
  Subscription on_media_track(MediaTrackHandler handler);
  Subscription on_media_track_removed(MediaTrackHandler handler);
  Subscription on_media_state_change(MediaStateHandler handler);
  Subscription on_media_device_change(MediaDeviceHandler handler);
  Subscription on_reconnect(ReconnectHandler handler);
  Subscription on_connection_state_change(ConnectionStateHandler handler);
  void set_connection_state(const std::string &state);
  void upsert_room_member(const json &member);
  json *ensure_media_member(const json &member);
  void sync_media_members_with_room_members();
  void upsert_media_track(const json &member, const json &track);
  void remove_media_track(const json &member, const json &track);
  static void deep_set(json &obj, const std::string &path, const json &value);
  static std::string trim_trailing_slash(const std::string &s);
  static std::string url_encode(const std::string &s);
  static constexpr int kRoomExplicitLeaveCloseDelayMs = 40;
  mutable std::mutex diagnostic_mx_;
  bool transport_opened_ = false;
  std::string last_transport_event_;
  std::string last_transport_reason_;
  int last_transport_http_status_ = 0;
  int last_transport_close_code_ = 0;
  std::string last_protocol_message_type_;
};

} // namespace edgebase
