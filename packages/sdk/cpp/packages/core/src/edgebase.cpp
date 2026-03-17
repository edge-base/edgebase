// EdgeBase C++ Core SDK — Entry point implementation.
//
// Implements the EdgeBase class declared in include/edgebase/edgebase.h.
// All client objects share a single HttpClient instance.
// DB operations go through GeneratedDbApi (generated core).

#include <edgebase/edgebase.h>
#include <ixwebsocket/IXWebSocket.h>
#include <nlohmann/json.hpp>
#include <chrono>
#include <stdexcept>

namespace client {

EdgeBase::EdgeBase(std::string url) {
  while (!url.empty() && url.back() == '/')
    url.pop_back();
  baseUrl_ = url;
  http_ = std::make_shared<HttpClient>(baseUrl_);
  // Create the generated core, which wraps HttpClient for all API calls.
  core_ = std::make_shared<GeneratedDbApi>(*http_);
  // database-live transport is lazy-initialized on first db().table().onSnapshot() call.
}

EdgeBase::~EdgeBase() {
  if (databaseLive_)
    databaseLive_->destroy();
}

StorageClient EdgeBase::storage() const {
  return StorageClient(http_, core_, baseUrl_);
}

AuthClient EdgeBase::auth() const {
  if (!authClient_)
    authClient_ = std::make_shared<AuthClient>(http_, core_);
  return *authClient_;
}

PushClient EdgeBase::push() const {
  if (!pushClient_)
    pushClient_ = std::make_shared<PushClient>(http_);
  return *pushClient_;
}

FunctionsClient EdgeBase::functions() const { return FunctionsClient(http_); }

AnalyticsClient EdgeBase::analytics() const { return AnalyticsClient(core_); }

/// Select DB block by namespace + optional instance ID (#133 §2).
DbRef EdgeBase::db(const std::string &ns, const std::string &instanceId) const {
  return DbRef(core_, ns, instanceId, databaseLive());
}

std::shared_ptr<DatabaseLiveClient> EdgeBase::databaseLive() const {
  if (!databaseLive_)
    databaseLive_ = std::make_shared<DatabaseLiveClient>(baseUrl_, http_);
  return databaseLive_;
}

/// Create a RoomClient v2 for the given namespace and room ID.
std::shared_ptr<edgebase::RoomClient>
EdgeBase::room(const std::string &namespace_name, const std::string &room_id,
               edgebase::RoomOptions opts) const {
  // Capture http_ for token retrieval inside the room's TokenFn.
  auto http = http_;
  auto core = core_;
  auto rc = std::make_shared<edgebase::RoomClient>(
      baseUrl_, namespace_name, room_id,
      [http]() -> std::string { return http->getToken(); }, opts);
  // Inject metadata fetch that delegates to GeneratedDbApi.get_room_metadata()
  // with namespace/id query params.
  rc->set_metadata_fetch_fn(
      [core](const std::string &ns,
             const std::string &roomId) -> nlohmann::json {
        auto r = core->get_room_metadata({{"namespace", ns}, {"id", roomId}});
        if (!r.ok)
          return nlohmann::json::object();
        return nlohmann::json::parse(r.body);
      });
  struct RoomTransportState {
    std::mutex mx;
    std::shared_ptr<ix::WebSocket> socket;
    bool open = false;
    std::vector<std::string> pending;
  };

  auto transport = std::make_shared<RoomTransportState>();
  auto weak_rc = std::weak_ptr<edgebase::RoomClient>(rc);
  rc->set_connect_fn(
      [transport, weak_rc](const std::string &url,
                           std::function<void(const std::string &)> on_message,
                           std::function<void()> on_close) {
        auto socket = std::make_shared<ix::WebSocket>();
        socket->setUrl(url);
        socket->disableAutomaticReconnection();
        socket->setOnMessageCallback(
            [transport, socket, on_message, on_close, weak_rc](
                const ix::WebSocketMessagePtr &msg) {
              if (msg->type == ix::WebSocketMessageType::Open) {
                if (auto room = weak_rc.lock()) {
                  room->note_transport_event("open", "");
                }
                std::vector<std::string> pending;
                {
                  std::lock_guard<std::mutex> lock(transport->mx);
                  transport->socket = socket;
                  transport->open = true;
                  pending.swap(transport->pending);
                }
                for (const auto &frame : pending) {
                  socket->send(frame);
                }
                return;
              }
              if (msg->type == ix::WebSocketMessageType::Message) {
                on_message(msg->str);
                return;
              }
              if (msg->type == ix::WebSocketMessageType::Close) {
                if (auto room = weak_rc.lock()) {
                  room->note_transport_event(
                      "close", msg->closeInfo.reason, 0, msg->closeInfo.code);
                }
                {
                  std::lock_guard<std::mutex> lock(transport->mx);
                  transport->open = false;
                }
                on_close();
                return;
              }
              if (msg->type == ix::WebSocketMessageType::Error) {
                if (auto room = weak_rc.lock()) {
                  room->note_transport_event(
                      "error",
                      msg->errorInfo.reason,
                      msg->errorInfo.http_status,
                      0);
                }
                {
                  std::lock_guard<std::mutex> lock(transport->mx);
                  transport->open = false;
                }
                on_close();
              }
            });
        {
          std::lock_guard<std::mutex> lock(transport->mx);
          transport->socket = socket;
          transport->open = false;
        }
        socket->start();
      });
  rc->set_send_fn([transport](const std::string &raw) {
    std::shared_ptr<ix::WebSocket> socket;
    {
      std::lock_guard<std::mutex> lock(transport->mx);
      socket = transport->socket;
      if (!socket || !transport->open) {
        transport->pending.push_back(raw);
        return;
      }
    }
    socket->send(raw);
  });
  rc->set_close_fn([transport]() {
    std::shared_ptr<ix::WebSocket> socket;
    {
      std::lock_guard<std::mutex> lock(transport->mx);
      socket = transport->socket;
      transport->open = false;
      transport->socket.reset();
      transport->pending.clear();
    }
    if (socket) {
      socket->stop();
    }
  });
  return rc;
}

void EdgeBase::setContext(const std::map<std::string, std::string> &ctx) {
  http_->setContext(ctx);
}

std::map<std::string, std::string> EdgeBase::getContext() const {
  return http_->getContext();
}

void EdgeBase::setLocale(const std::string &locale) { http_->setLocale(locale); }

std::string EdgeBase::getLocale() const { return http_->getLocale(); }

FunctionsClient::FunctionsClient(std::shared_ptr<HttpClient> http)
    : http_(std::move(http)) {}

Result FunctionsClient::call(
    const std::string &path, const std::string &method,
    const std::string &jsonBody,
    const std::map<std::string, std::string> &query) const {
  const std::string normalizedPath = "/functions/" + path;
  if (method == "GET")
    return http_->get(normalizedPath, query);
  if (method == "PUT")
    return http_->put(normalizedPath, jsonBody);
  if (method == "PATCH")
    return http_->patch(normalizedPath, jsonBody);
  if (method == "DELETE")
    return http_->del(normalizedPath);
  return http_->post(normalizedPath, jsonBody);
}

Result FunctionsClient::get(
    const std::string &path,
    const std::map<std::string, std::string> &query) const {
  return call(path, "GET", "{}", query);
}

Result FunctionsClient::post(const std::string &path,
                             const std::string &jsonBody) const {
  return call(path, "POST", jsonBody);
}

Result FunctionsClient::put(const std::string &path,
                            const std::string &jsonBody) const {
  return call(path, "PUT", jsonBody);
}

Result FunctionsClient::patch(const std::string &path,
                              const std::string &jsonBody) const {
  return call(path, "PATCH", jsonBody);
}

Result FunctionsClient::del(const std::string &path) const {
  return call(path, "DELETE");
}

AnalyticsClient::AnalyticsClient(std::shared_ptr<GeneratedDbApi> core)
    : core_(std::move(core)) {}

Result AnalyticsClient::track(const std::string &name,
                              const std::string &propertiesJson) const {
  return trackBatch({AnalyticsEvent{name, propertiesJson, std::nullopt}});
}

Result AnalyticsClient::trackBatch(
    const std::vector<AnalyticsEvent> &events) const {
  if (events.empty())
    return {true, 204, "", ""};

  nlohmann::json body = {{"events", nlohmann::json::array()}};
  for (const auto &event : events) {
    nlohmann::json payload = {{"name", event.name},
                              {"timestamp", event.timestamp.value_or(
                                  static_cast<long long>(
                                      std::chrono::duration_cast<std::chrono::milliseconds>(
                                          std::chrono::system_clock::now().time_since_epoch())
                                          .count()))}};

    const auto properties =
        nlohmann::json::parse(event.propertiesJson, nullptr, false);
    if (!properties.is_discarded() && !properties.is_null() &&
        !(properties.is_object() && properties.empty())) {
      payload["properties"] = properties;
    }
    body["events"].push_back(payload);
  }

  return core_->track_events(body.dump());
}

// ── DbRef implementation
// ──────────────────────────────────────────────────────

DbRef::DbRef(std::shared_ptr<GeneratedDbApi> core, std::string ns,
             std::string instanceId, std::shared_ptr<DatabaseLiveClient> databaseLive)
    : core_(std::move(core)), databaseLive_(std::move(databaseLive)),
      ns_(std::move(ns)), instanceId_(std::move(instanceId)) {}

TableRef DbRef::table(const std::string &name) const {
  return TableRef(core_, name, ns_, instanceId_, databaseLive_);
}

} // namespace client
