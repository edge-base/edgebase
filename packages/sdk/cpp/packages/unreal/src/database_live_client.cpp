// EdgeBase C++ SDK — Database live transport
//
// IXWebSocket-based database-live with auto-reconnect.
// See: https://github.com/machinezone/IXWebSocket
//
// Usage:
//   auto table = client.db("shared").table("posts");
//
//   // DB subscription
//   int id = table.onSnapshot([](const eb::DbChange& c) {
//       std::cout << c.changeType << " " << c.docId << "\n";
//   });

#include "edgebase/edgebase.h"

#include <iostream>
#include <ixwebsocket/IXWebSocket.h>
#include <nlohmann/json.hpp>

namespace client {

using json = nlohmann::json;

// ─── Helpers ─────────────────────────────────────────────────────────────────

static std::string buildWsUrl(const std::string &baseUrl,
                              const std::string &channel = "") {
  std::string url = baseUrl;
  // strip trailing slash
  if (!url.empty() && url.back() == '/')
    url.pop_back();
  // replace http(s) with ws(s)
  if (url.substr(0, 8) == "https://")
    url = "wss://" + url.substr(8);
  else if (url.substr(0, 7) == "http://")
    url = "ws://" + url.substr(7);
  auto wsUrl = url + ApiPaths::CONNECT_DATABASE_SUBSCRIPTION;
  if (!channel.empty()) {
    wsUrl += "?channel=" + channel;
  }
  return wsUrl;
}

static std::string normalizeDatabaseLiveChannel(const std::string &tableOrChannel) {
  return tableOrChannel.rfind("dblive:", 0) == 0 ? tableOrChannel
                                                    : "dblive:" + tableOrChannel;
}

// ─── DatabaseLiveClient ──────────────────────────────────────────────────────────

DatabaseLiveClient::DatabaseLiveClient(std::string baseUrl,
                               std::shared_ptr<HttpClient> http)
    : baseUrl_(std::move(baseUrl)), http_(std::move(http)) {
  // Don't connect eagerly — connect per-channel when onSnapshot is called
}

DatabaseLiveClient::~DatabaseLiveClient() { destroy(); }

void DatabaseLiveClient::connect(const std::string &channel) {
  auto *ws = new ix::WebSocket();
  ws_ = ws;

  ws->setUrl(buildWsUrl(baseUrl_, channel));
  running_ = true;

  ws->setOnMessageCallback([this](const ix::WebSocketMessagePtr &msg) {
    if (msg->type == ix::WebSocketMessageType::Open) {
      // WS connected — send auth message
      json auth;
      auth["type"] = "auth";
      auth["token"] = http_ ? http_->getToken() : "";
      sendRaw(auth.dump());
    } else if (msg->type == ix::WebSocketMessageType::Message) {
      // Check for auth_success or auth_refreshed to flush pending subscribes
      //
      try {
        auto j = json::parse(msg->str);
        if (j.is_object() && (j.value("type", "") == "auth_success" ||
                              j.value("type", "") == "auth_refreshed")) {
          // Flush all pending subscribes
          std::lock_guard<std::mutex> lk(pendingMx_);
          for (auto &s : pendingSubscribes_) {
            auto *w = static_cast<ix::WebSocket *>(ws_);
            if (w)
              w->send(s);
          }
          pendingSubscribes_.clear();
          wsOpen_ = true;
          wsReadyCv_.notify_all();
        }
      } catch (...) {
      }
      dispatchMessage(msg->str);
    } else if (msg->type == ix::WebSocketMessageType::Close) {
      wsOpen_ = false;
    } else if (msg->type == ix::WebSocketMessageType::Error) {
      std::cerr << "[EdgeBase DatabaseLive] WS error: " << msg->errorInfo.reason
                << "\n";
      wsOpen_ = false;
    }
  });

  ws->enableAutomaticReconnection();
  ws->start();
}

void DatabaseLiveClient::sendRaw(const std::string &jsonStr) {
  if (!ws_)
    return;
  auto *ws = static_cast<ix::WebSocket *>(ws_);
  ws->send(jsonStr);
}

void DatabaseLiveClient::dispatchMessage(const std::string &raw) {
  json j;
  try {
    j = json::parse(raw);
  } catch (...) {
    return;
  }

  if (!j.is_object())
    return;

  // Build a simple string map for handlers
  std::map<std::string, std::string> msg;
  for (auto &[k, v] : j.items()) {
    if (v.is_string())
      msg[k] = v.get<std::string>();
    else
      msg[k] = v.dump();
  }

  // DB change dispatch
  auto typeIt = msg.find("type");
  if (typeIt != msg.end() && typeIt->second == "db_change") {
    DbChange change;
    const std::string messageChannel =
        msg.count("channel") ? normalizeDatabaseLiveChannel(msg.at("channel")) : "";
    change.changeType = msg.count("changeType") ? msg.at("changeType") : "";
    change.table = msg.count("table") ? msg.at("table") : "";
    change.docId = msg.count("docId") ? msg.at("docId") : "";
    change.timestamp = msg.count("timestamp") ? msg.at("timestamp") : "";
    change.dataJson = j.count("data") ? j["data"].dump() : "{}";

    std::lock_guard<std::mutex> lk(handlersMx_);
    for (auto &[id, entry] : snapshotHandlers_) {
      if ((!messageChannel.empty() && entry.channel == messageChannel) ||
          (messageChannel.empty() &&
           entry.channel == normalizeDatabaseLiveChannel(change.table)))
        entry.handler(change);
    }
  }

  // Generic message dispatch
  {
    std::lock_guard<std::mutex> lk(handlersMx_);
    for (auto &[id, handler] : handlers_)
      handler(msg);
  }
}

int DatabaseLiveClient::onSnapshot(const std::string &tableName,
                               std::function<void(const DbChange &)> handler,
                               const std::vector<FilterTuple> &serverFilters,
                               const std::vector<FilterTuple> &serverOrFilters) {
  int id = nextId_++;
  const std::string channel = normalizeDatabaseLiveChannel(tableName);
  {
    std::lock_guard<std::mutex> lk(handlersMx_);
    snapshotHandlers_[id] = {channel, std::move(handler), serverFilters,
                             serverOrFilters};
  }

  // Store server-side filters for recovery
  if (!serverFilters.empty()) {
    channelFilters_[channel] = serverFilters;
  }
  if (!serverOrFilters.empty()) {
    channelOrFilters_[channel] = serverOrFilters;
  }

  // Build subscribe message
  json sub;
  sub["type"] = "subscribe";
  sub["channel"] = channel;

  // Include server-side filters if provided
  if (!serverFilters.empty()) {
    json filters = json::array();
    for (const auto &f : serverFilters) {
      filters.push_back({{"field", f.field}, {"op", f.op}, {"value", f.value}});
    }
    sub["filters"] = filters;
  }
  if (!serverOrFilters.empty()) {
    json orFilters = json::array();
    for (const auto &f : serverOrFilters) {
      orFilters.push_back({{"field", f.field}, {"op", f.op}, {"value", f.value}});
    }
    sub["orFilters"] = orFilters;
  }

  std::string subStr = sub.dump();

  // Connect with channel parameter (server requires it)
  if (!ws_) {
    {
      std::lock_guard<std::mutex> lk(pendingMx_);
      pendingSubscribes_.push_back(subStr);
    }
    connect(channel);
  } else if (wsOpen_) {
    // Already open — send immediately
    sendRaw(subStr);
  } else {
    // WS connecting but not open yet — queue it
    std::lock_guard<std::mutex> lk(pendingMx_);
    pendingSubscribes_.push_back(subStr);
  }
  return id;
}

void DatabaseLiveClient::unsubscribe(int id) {
  std::lock_guard<std::mutex> lk(handlersMx_);
  snapshotHandlers_.erase(id);
  handlers_.erase(id);
}

int DatabaseLiveClient::addMessageHandler(MessageHandler handler) {
  int id = nextId_++;
  std::lock_guard<std::mutex> lk(handlersMx_);
  handlers_[id] = std::move(handler);
  return id;
}

void DatabaseLiveClient::removeMessageHandler(int id) {
  std::lock_guard<std::mutex> lk(handlersMx_);
  handlers_.erase(id);
}

void DatabaseLiveClient::destroy() {
  running_ = false;
  if (ws_) {
    auto *ws = static_cast<ix::WebSocket *>(ws_);
    ws->stop();
    delete ws;
    ws_ = nullptr;
  }
}

} // namespace client
