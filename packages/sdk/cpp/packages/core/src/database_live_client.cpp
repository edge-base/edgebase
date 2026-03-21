// Database live transport for C++ SDK.

#include <edgebase/edgebase.h>

#include <algorithm>
#include <set>
#include <sstream>
#include <cctype>
#include <cstdlib>
#include <ixwebsocket/IXWebSocket.h>
#include <nlohmann/json.hpp>

namespace client {

using json = nlohmann::json;

static std::string buildWsUrl(const std::string &baseUrl,
                              const std::string &channel = "") {
  std::string url = baseUrl;
  if (!url.empty() && url.back() == '/')
    url.pop_back();
  if (url.rfind("https://", 0) == 0)
    url = "wss://" + url.substr(8);
  else if (url.rfind("http://", 0) == 0)
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

DatabaseLiveClient::DatabaseLiveClient(std::string baseUrl,
                               std::shared_ptr<HttpClient> http)
    : baseUrl_(std::move(baseUrl)), http_(std::move(http)) {}

DatabaseLiveClient::~DatabaseLiveClient() { destroy(); }

void DatabaseLiveClient::connect(const std::string &channel) {
  auto *ws = new ix::WebSocket();
  ws_ = ws;
  running_ = true;
  authenticated_ = false;
  wsOpen_ = false;
  ws->setUrl(buildWsUrl(baseUrl_, channel));
  ws->enableAutomaticReconnection();

  ws->setOnMessageCallback([this](const ix::WebSocketMessagePtr &msg) {
    if (msg->type == ix::WebSocketMessageType::Open) {
      json auth = {
          {"type", "auth"},
          {"token", http_ ? http_->getToken() : ""},
      };
      auto *socket = static_cast<ix::WebSocket *>(ws_);
      if (socket)
        socket->send(auth.dump());
      return;
    }

    if (msg->type == ix::WebSocketMessageType::Message) {
      try {
        auto j = json::parse(msg->str);
        const auto type = j.value("type", "");
        if (type == "auth_success" || type == "auth_refreshed") {
          authenticated_ = true;
          wsOpen_ = true;

          if (type == "auth_refreshed" && j.contains("revokedChannels") &&
              j["revokedChannels"].is_array()) {
            std::lock_guard<std::mutex> lock(handlersMx_);
            for (const auto &entry : j["revokedChannels"]) {
              if (!entry.is_string())
                continue;
              const auto revoked = entry.get<std::string>();
              for (auto &handler : revokedHandlers_) {
                handler(revoked);
              }
            }
          }

          {
            std::lock_guard<std::mutex> lock(pendingMx_);
            auto *socket = static_cast<ix::WebSocket *>(ws_);
            for (const auto &pending : pendingSubscribes_) {
              if (socket)
                socket->send(pending);
            }
            pendingSubscribes_.clear();
          }
          resubscribeAll();
        } else if (type == "FILTER_RESYNC") {
          resyncFilters();
        }
      } catch (...) {
      }
      dispatchMessage(msg->str);
      return;
    }

    if (msg->type == ix::WebSocketMessageType::Close ||
        msg->type == ix::WebSocketMessageType::Error) {
      wsOpen_ = false;
      authenticated_ = false;
    }
  });

  ws->start();
}

int DatabaseLiveClient::onSnapshot(const std::string &tableName,
                               std::function<void(const DbChange &)> handler,
                               const std::vector<FilterTuple> &serverFilters,
                               const std::vector<FilterTuple> &serverOrFilters) {
  int id = nextId_++;
  const std::string channel = normalizeDatabaseLiveChannel(tableName);
  std::vector<FilterTuple> effectiveFilters;
  std::vector<FilterTuple> effectiveOrFilters;
  {
    std::lock_guard<std::mutex> lock(handlersMx_);
    snapshotHandlers_[id] = {channel, std::move(handler), serverFilters, serverOrFilters};
    recomputeChannelFilters(channel);
    // Use recomputed channel-level filters for the subscribe message
    auto fit = channelFilters_.find(channel);
    if (fit != channelFilters_.end()) effectiveFilters = fit->second;
    auto ofit = channelOrFilters_.find(channel);
    if (ofit != channelOrFilters_.end()) effectiveOrFilters = ofit->second;
  }

  json sub = {{"type", "subscribe"}, {"channel", channel}};
  if (!effectiveFilters.empty()) {
    sub["filters"] = json::array();
    for (const auto &filter : effectiveFilters) {
      sub["filters"].push_back(json::array({filter.field, filter.op, filter.value}));
    }
  }
  if (!effectiveOrFilters.empty()) {
    sub["orFilters"] = json::array();
    for (const auto &filter : effectiveOrFilters) {
      sub["orFilters"].push_back(json::array({filter.field, filter.op, filter.value}));
    }
  }

  const auto payload = sub.dump();
  if (!ws_) {
    {
      std::lock_guard<std::mutex> lock(pendingMx_);
      pendingSubscribes_.push_back(payload);
    }
    connect(channel);
  } else if (wsOpen_ && authenticated_) {
    sendRaw(payload);
  } else {
    std::lock_guard<std::mutex> lock(pendingMx_);
    pendingSubscribes_.push_back(payload);
  }

  return id;
}

void DatabaseLiveClient::unsubscribe(int id) {
  std::lock_guard<std::mutex> lock(handlersMx_);
  auto it = snapshotHandlers_.find(id);
  if (it != snapshotHandlers_.end()) {
    const auto channel = it->second.channel;
    snapshotHandlers_.erase(it);
    bool hasOther = false;
    for (const auto &[otherId, entry] : snapshotHandlers_) {
      if (entry.channel == channel) {
        hasOther = true;
        break;
      }
    }
    if (!hasOther) {
      channelFilters_.erase(channel);
      channelOrFilters_.erase(channel);
      // Send unsubscribe since no handlers remain
      json unsub = {{"type", "unsubscribe"}, {"channel", channel}};
      sendRaw(unsub.dump());
    } else {
      // Recompute filters from remaining handlers and re-send subscribe
      recomputeChannelFilters(channel);
      json sub = {{"type", "subscribe"}, {"channel", channel}};
      auto filterIt = channelFilters_.find(channel);
      if (filterIt != channelFilters_.end()) {
        sub["filters"] = json::array();
        for (const auto &filter : filterIt->second) {
          sub["filters"].push_back(json::array({filter.field, filter.op, filter.value}));
        }
      }
      auto orFilterIt = channelOrFilters_.find(channel);
      if (orFilterIt != channelOrFilters_.end()) {
        sub["orFilters"] = json::array();
        for (const auto &filter : orFilterIt->second) {
          sub["orFilters"].push_back(json::array({filter.field, filter.op, filter.value}));
        }
      }
      sendRaw(sub.dump());
    }
  }
  handlers_.erase(id);
}

void DatabaseLiveClient::sendRaw(const std::string &jsonStr) {
  auto *ws = static_cast<ix::WebSocket *>(ws_);
  if (!ws) {
    {
      std::lock_guard<std::mutex> lock(pendingMx_);
      pendingSubscribes_.push_back(jsonStr);
    }
    connect();
    return;
  }
  if (!wsOpen_ || !authenticated_) {
    std::lock_guard<std::mutex> lock(pendingMx_);
    pendingSubscribes_.push_back(jsonStr);
    return;
  }
  ws->send(jsonStr);
}

int DatabaseLiveClient::addMessageHandler(MessageHandler handler) {
  int id = nextId_++;
  std::lock_guard<std::mutex> lock(handlersMx_);
  handlers_[id] = std::move(handler);
  return id;
}

void DatabaseLiveClient::removeMessageHandler(int id) {
  std::lock_guard<std::mutex> lock(handlersMx_);
  handlers_.erase(id);
}

void DatabaseLiveClient::onSubscriptionRevoked(SubscriptionRevokedHandler handler) {
  std::lock_guard<std::mutex> lock(handlersMx_);
  revokedHandlers_.push_back(std::move(handler));
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

  std::map<std::string, std::string> msg;
  for (auto &[key, value] : j.items()) {
    msg[key] = value.is_string() ? value.get<std::string>() : value.dump();
  }

  auto matchChannel = [](const std::string &channel, const DbChange &chg,
                        const std::string &msgCh) -> bool {
    if (!msgCh.empty()) return channel == msgCh;
    std::vector<std::string> parts;
    std::istringstream iss(channel);
    std::string part;
    while (std::getline(iss, part, ':')) parts.push_back(part);
    if (parts.empty() || parts[0] != "dblive") return false;
    switch (parts.size()) {
      case 2: return parts[1] == chg.table;
      case 3: return parts[2] == chg.table;
      case 4:
        if (parts[2] == chg.table && chg.docId == parts[3]) return true;
        return parts[3] == chg.table;
      case 5: return parts[3] == chg.table && chg.docId == parts[4];
      default: return false;
    }
  };

  if (msg.count("type") && msg.at("type") == "batch_changes") {
    const std::string table = msg.count("table") ? msg.at("table") : "";
    const std::string batchChannel = msg.count("channel") ? msg.at("channel") : "";
    if (j.count("changes") && j["changes"].is_array()) {
      for (const auto &ch : j["changes"]) {
        DbChange change;
        change.changeType = ch.value("event", "");
        change.table = table;
        change.docId = ch.value("docId", "");
        change.timestamp = ch.value("timestamp", "");
        change.dataJson = ch.count("data") ? ch["data"].dump() : "{}";
        const std::string msgCh = batchChannel.empty() ? "" : normalizeDatabaseLiveChannel(batchChannel);

        std::lock_guard<std::mutex> lock(handlersMx_);
        for (auto &[id, entry] : snapshotHandlers_) {
          if (matchChannel(entry.channel, change, msgCh)) {
            entry.handler(change);
          }
        }
      }
    }
  }

  if (msg.count("type") && msg.at("type") == "db_change") {
    DbChange change;
    const std::string messageChannel =
        msg.count("channel") ? normalizeDatabaseLiveChannel(msg.at("channel")) : "";
    change.changeType = msg.count("changeType") ? msg.at("changeType") : "";
    change.table = msg.count("table") ? msg.at("table") : "";
    change.docId = msg.count("docId") ? msg.at("docId") : "";
    change.timestamp = msg.count("timestamp") ? msg.at("timestamp") : "";
    change.dataJson = j.count("data") ? j["data"].dump() : "{}";

    std::lock_guard<std::mutex> lock(handlersMx_);
    for (auto &[id, entry] : snapshotHandlers_) {
      if (matchChannel(entry.channel, change, messageChannel)) {
        entry.handler(change);
      }
    }
  }

  std::lock_guard<std::mutex> lock(handlersMx_);
  for (auto &[id, handler] : handlers_) {
    handler(msg);
  }
}

void DatabaseLiveClient::resubscribeAll() {
  std::lock_guard<std::mutex> lock(handlersMx_);
  // Collect unique channels to avoid duplicate subscribe messages
  std::set<std::string> channels;
  for (const auto &[id, entry] : snapshotHandlers_) {
    channels.insert(entry.channel);
  }
  for (const auto &channel : channels) {
    json sub = {{"type", "subscribe"}, {"channel", channel}};
    auto filterIt = channelFilters_.find(channel);
    if (filterIt != channelFilters_.end()) {
      sub["filters"] = json::array();
      for (const auto &filter : filterIt->second) {
        sub["filters"].push_back(json::array({filter.field, filter.op, filter.value}));
      }
    }
    auto orFilterIt = channelOrFilters_.find(channel);
    if (orFilterIt != channelOrFilters_.end()) {
      sub["orFilters"] = json::array();
      for (const auto &filter : orFilterIt->second) {
        sub["orFilters"].push_back(json::array({filter.field, filter.op, filter.value}));
      }
    }
    sendRaw(sub.dump());
  }
}

void DatabaseLiveClient::recomputeChannelFilters(const std::string &channel) {
  // Must be called with handlersMx_ held.
  // Find the first handler for this channel that has filters/orFilters.
  bool foundFilters = false;
  bool foundOrFilters = false;
  for (const auto &[id, entry] : snapshotHandlers_) {
    if (entry.channel != channel) continue;
    if (!foundFilters && !entry.filters.empty()) {
      channelFilters_[channel] = entry.filters;
      foundFilters = true;
    }
    if (!foundOrFilters && !entry.orFilters.empty()) {
      channelOrFilters_[channel] = entry.orFilters;
      foundOrFilters = true;
    }
    if (foundFilters && foundOrFilters) break;
  }
  if (!foundFilters) channelFilters_.erase(channel);
  if (!foundOrFilters) channelOrFilters_.erase(channel);
}

void DatabaseLiveClient::resyncFilters() { resubscribeAll(); }

void DatabaseLiveClient::destroy() {
  running_ = false;
  authenticated_ = false;
  wsOpen_ = false;
  {
    std::lock_guard<std::mutex> lock(handlersMx_);
    channelFilters_.clear();
    channelOrFilters_.clear();
    snapshotHandlers_.clear();
    handlers_.clear();
  }
  {
    std::lock_guard<std::mutex> lock(pendingMx_);
    pendingSubscribes_.clear();
  }
  if (ws_) {
    auto *ws = static_cast<ix::WebSocket *>(ws_);
    ws->stop();
    delete ws;
    ws_ = nullptr;
  }
}

// ── AuthClient minimal implementation ────────────────────────────────────────
// Delegates to GeneratedDbApi when core_ is available; falls back to HttpClient.
// Token management is preserved in the wrapper.

static void extractAndStoreTokenStub(const Result &r,
                                     const std::shared_ptr<HttpClient> &http) {
  if (!r.ok || r.body.empty())
    return;
  try {
    auto j = nlohmann::json::parse(r.body);
    if (j.contains("accessToken") && j["accessToken"].is_string())
      http->setToken(j["accessToken"].get<std::string>());
    if (j.contains("refreshToken") && j["refreshToken"].is_string())
      http->setRefreshToken(j["refreshToken"].get<std::string>());
  } catch (...) {
  }
}

static std::string toLowerCopy(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(),
                 [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
  return value;
}

static std::string resolveCaptchaTokenForTests(const std::string &manualToken) {
  if (!manualToken.empty()) {
    return manualToken;
  }

  if (const char *injected = std::getenv("EDGEBASE_TEST_CAPTCHA_TOKEN");
      injected != nullptr && *injected != '\0') {
    return injected;
  }

  const char *testMode = std::getenv("TEST_MODE");
  const char *baseUrl = std::getenv("EDGEBASE_URL");
  const char *mockUrl = std::getenv("MOCK_SERVER_URL");
  if (testMode != nullptr && toLowerCopy(testMode) == "mock" &&
      ((baseUrl != nullptr && *baseUrl != '\0') ||
       (mockUrl != nullptr && *mockUrl != '\0'))) {
    return "test-captcha-token";
  }

  return "";
}

struct AuthClient::State {
  std::mutex cbMutex;
  std::vector<AuthStateCallback> authCallbacks;
};

AuthClient::AuthClient(std::shared_ptr<HttpClient> http,
                       std::shared_ptr<GeneratedDbApi> core)
    : http_(std::move(http)), core_(std::move(core)),
      state_(std::make_shared<State>()) {}

Result AuthClient::signUp(const std::string &email, const std::string &password,
                          const std::string &displayName,
                          const std::string &captchaToken) const {
  nlohmann::json body = {{"email", email}, {"password", password}};
  if (!displayName.empty())
    body["displayName"] = displayName;
  const auto resolvedCaptcha = resolveCaptchaTokenForTests(captchaToken);
  if (!resolvedCaptcha.empty())
    body["captchaToken"] = resolvedCaptcha;
  auto result = core_->auth_signup(body.dump());
  extractAndStoreTokenStub(result, http_);
  if (result.ok)
    notifyAuthChange(currentUser());
  return result;
}

Result AuthClient::signIn(const std::string &email, const std::string &password,
                          const std::string &captchaToken) const {
  nlohmann::json body = {{"email", email}, {"password", password}};
  const auto resolvedCaptcha = resolveCaptchaTokenForTests(captchaToken);
  if (!resolvedCaptcha.empty())
    body["captchaToken"] = resolvedCaptcha;
  auto result = core_->auth_signin(body.dump());
  extractAndStoreTokenStub(result, http_);
  if (result.ok)
    notifyAuthChange(currentUser());
  return result;
}

Result AuthClient::signOut() const {
  std::string rt = http_->getRefreshToken();
  nlohmann::json j = {{"refreshToken", rt}};
  auto result = core_->auth_signout(j.dump());
  if (result.ok) {
    http_->clearToken();
    http_->clearRefreshToken();
    notifyAuthChange("");
  }
  return result;
}

Result
AuthClient::signInAnonymously(const std::string &captchaToken) const {
  nlohmann::json body = nlohmann::json::object();
  const auto resolvedCaptcha = resolveCaptchaTokenForTests(captchaToken);
  if (!resolvedCaptcha.empty()) {
    body["captchaToken"] = resolvedCaptcha;
  }
  auto result = core_->auth_signin_anonymous(body.dump());
  extractAndStoreTokenStub(result, http_);
  if (result.ok)
    notifyAuthChange(currentUser());
  return result;
}

Result AuthClient::signInWithMagicLink(const std::string &email,
                                       const std::string &captchaToken) const {
  nlohmann::json body = {{"email", email}};
  const auto resolvedCaptcha = resolveCaptchaTokenForTests(captchaToken);
  if (!resolvedCaptcha.empty()) {
    body["captchaToken"] = resolvedCaptcha;
  }
  return core_->auth_signin_magic_link(body.dump());
}

Result AuthClient::verifyMagicLink(const std::string &token) const {
  nlohmann::json body = {{"token", token}};
  auto result = core_->auth_verify_magic_link(body.dump());
  extractAndStoreTokenStub(result, http_);
  if (result.ok)
    notifyAuthChange(currentUser());
  return result;
}

std::string
AuthClient::signInWithOAuth(const std::string &provider,
                            const std::string &redirectUrl,
                            const std::string & /*captchaToken*/) const {
  // OAuth returns a redirect URL — not a JSON API call.
  // Keep as URL construction (no network call, mirrors Swift/C#).
  std::string url = ApiPaths::oauth_redirect(provider);
  if (!redirectUrl.empty())
    url += "?redirectUrl=" + redirectUrl;
  return url;
}

Result AuthClient::linkWithEmail(const std::string &email,
                                 const std::string &password) const {
  nlohmann::json body = {{"email", email}, {"password", password}};
  auto result = core_->auth_link_email(body.dump());
  extractAndStoreTokenStub(result, http_);
  if (result.ok)
    notifyAuthChange(currentUser());
  return result;
}

std::string
AuthClient::linkWithOAuth(const std::string &provider,
                          const std::string &redirectUrl) const {
  std::string url = ApiPaths::oauth_link_start(provider);
  if (!redirectUrl.empty()) {
    url += "?redirectUrl=" + redirectUrl;
  }
  return url;
}

Result AuthClient::changePassword(const std::string &cur,
                                  const std::string &nw) const {
  nlohmann::json body = {{"currentPassword", cur}, {"newPassword", nw}};
  auto result = core_->auth_change_password(body.dump());
  extractAndStoreTokenStub(result, http_);
  if (result.ok)
    notifyAuthChange(currentUser());
  return result;
}

Result AuthClient::refreshToken() const {
  const std::string refresh_token = http_->getRefreshToken();
  if (refresh_token.empty()) {
    return {false, 401, "", "No refresh token available"};
  }
  nlohmann::json body = {{"refreshToken", refresh_token}};
  auto result = core_->auth_refresh(body.dump());
  extractAndStoreTokenStub(result, http_);
  if (result.ok)
    notifyAuthChange(currentUser());
  return result;
}

Result AuthClient::updateProfile(
    const std::map<std::string, std::string> &data) const {
  nlohmann::json body = data;
  auto result = core_->auth_update_profile(body.dump());
  extractAndStoreTokenStub(result, http_);
  if (result.ok)
    notifyAuthChange(currentUser());
  return result;
}

Result AuthClient::verifyEmail(const std::string &token) const {
  nlohmann::json body = {{"token", token}};
  return core_->auth_verify_email(body.dump());
}

Result AuthClient::requestEmailVerification(
    const std::string &redirectUrl) const {
  nlohmann::json body = nlohmann::json::object();
  if (!redirectUrl.empty())
    body["redirectUrl"] = redirectUrl;
  return core_->auth_request_email_verification(body.dump());
}

Result AuthClient::verifyEmailChange(const std::string &token) const {
  nlohmann::json body = {{"token", token}};
  return core_->auth_verify_email_change(body.dump());
}

Result
AuthClient::requestPasswordReset(const std::string &email,
                                 const std::string &captchaToken) const {
  nlohmann::json body = {{"email", email}};
  const auto resolvedCaptcha = resolveCaptchaTokenForTests(captchaToken);
  if (!resolvedCaptcha.empty()) {
    body["captchaToken"] = resolvedCaptcha;
  }
  return core_->auth_request_password_reset(body.dump());
}

Result AuthClient::resetPassword(const std::string &token,
                                 const std::string &newPassword) const {
  nlohmann::json body = {{"token", token}, {"newPassword", newPassword}};
  return core_->auth_reset_password(body.dump());
}

Result AuthClient::changeEmail(const std::string &newEmail,
                               const std::string &password,
                               const std::string &redirectUrl) const {
  nlohmann::json body = {{"newEmail", newEmail}, {"password", password}};
  if (!redirectUrl.empty())
    body["redirectUrl"] = redirectUrl;
  return core_->auth_change_email(body.dump());
}

Result AuthClient::listSessions() const {
  return core_->auth_get_sessions();
}

Result AuthClient::revokeSession(const std::string &sessionId) const {
  return core_->auth_delete_session(sessionId);
}

Result AuthClient::listIdentities() const {
  return core_->auth_get_identities();
}

Result AuthClient::unlinkIdentity(const std::string &identityId) const {
  return core_->auth_delete_identity(identityId);
}

Result AuthClient::signInWithPhone(const std::string &phone) const {
  nlohmann::json body = {{"phone", phone}};
  const auto resolvedCaptcha = resolveCaptchaTokenForTests("");
  if (!resolvedCaptcha.empty()) {
    body["captchaToken"] = resolvedCaptcha;
  }
  return core_->auth_signin_phone(body.dump());
}

Result AuthClient::verifyPhone(const std::string &phone,
                               const std::string &code) const {
  nlohmann::json body = {{"phone", phone}, {"code", code}};
  auto result = core_->auth_verify_phone(body.dump());
  extractAndStoreTokenStub(result, http_);
  if (result.ok)
    notifyAuthChange(currentUser());
  return result;
}

Result AuthClient::linkWithPhone(const std::string &phone) const {
  nlohmann::json body = {{"phone", phone}};
  return core_->auth_link_phone(body.dump());
}

Result AuthClient::verifyLinkPhone(const std::string &phone,
                                   const std::string &code) const {
  nlohmann::json body = {{"phone", phone}, {"code", code}};
  return core_->auth_verify_link_phone(body.dump());
}

Result AuthClient::signInWithEmailOtp(const std::string &email) const {
  nlohmann::json body = {{"email", email}};
  return core_->auth_signin_email_otp(body.dump());
}

Result AuthClient::verifyEmailOtp(const std::string &email,
                                  const std::string &code) const {
  nlohmann::json body = {{"email", email}, {"code", code}};
  auto result = core_->auth_verify_email_otp(body.dump());
  extractAndStoreTokenStub(result, http_);
  if (result.ok)
    notifyAuthChange(currentUser());
  return result;
}

Result AuthClient::passkeysRegisterOptions() const {
  return core_->auth_passkeys_register_options();
}

Result AuthClient::passkeysRegister(const std::string &responseJson) const {
  nlohmann::json body = {{"response", nlohmann::json::parse(responseJson)}};
  return core_->auth_passkeys_register(body.dump());
}

Result AuthClient::passkeysAuthOptions(const std::string &email) const {
  nlohmann::json body = nlohmann::json::object();
  if (!email.empty())
    body["email"] = email;
  return core_->auth_passkeys_auth_options(body.dump());
}

Result AuthClient::passkeysAuthenticate(
    const std::string &responseJson) const {
  nlohmann::json body = {{"response", nlohmann::json::parse(responseJson)}};
  auto result = core_->auth_passkeys_authenticate(body.dump());
  extractAndStoreTokenStub(result, http_);
  if (result.ok)
    notifyAuthChange(currentUser());
  return result;
}

Result AuthClient::passkeysList() const {
  return core_->auth_passkeys_list();
}

Result AuthClient::passkeysDelete(const std::string &credentialId) const {
  return core_->auth_passkeys_delete(credentialId);
}

Result AuthClient::enrollTotp() const {
  return core_->auth_mfa_totp_enroll();
}

Result AuthClient::verifyTotpEnrollment(const std::string &factorId,
                                        const std::string &code) const {
  nlohmann::json body = {{"factorId", factorId}, {"code", code}};
  return core_->auth_mfa_totp_verify(body.dump());
}

Result AuthClient::verifyTotp(const std::string &mfaTicket,
                              const std::string &code) const {
  nlohmann::json body = {{"mfaTicket", mfaTicket}, {"code", code}};
  auto result = core_->auth_mfa_verify(body.dump());
  extractAndStoreTokenStub(result, http_);
  if (result.ok)
    notifyAuthChange(currentUser());
  return result;
}

Result AuthClient::useRecoveryCode(const std::string &mfaTicket,
                                   const std::string &recoveryCode) const {
  nlohmann::json body = {{"mfaTicket", mfaTicket},
                         {"recoveryCode", recoveryCode}};
  auto result = core_->auth_mfa_recovery(body.dump());
  extractAndStoreTokenStub(result, http_);
  if (result.ok)
    notifyAuthChange(currentUser());
  return result;
}

Result AuthClient::disableTotp(const std::string &password,
                               const std::string &code) const {
  nlohmann::json body = nlohmann::json::object();
  if (!password.empty()) body["password"] = password;
  if (!code.empty()) body["code"] = code;
  return core_->auth_mfa_totp_delete(body.dump());
}

Result AuthClient::listFactors() const {
  return core_->auth_mfa_factors();
}

std::string AuthClient::currentToken() const { return http_->getToken(); }

std::string AuthClient::currentUser() const {
  std::string token = http_->getToken();
  if (token.empty()) {
    return "";
  }

  auto firstDot = token.find('.');
  if (firstDot == std::string::npos) {
    return "";
  }
  auto secondDot = token.find('.', firstDot + 1);
  if (secondDot == std::string::npos) {
    return "";
  }

  std::string payload = token.substr(firstDot + 1, secondDot - firstDot - 1);
  for (auto &c : payload) {
    if (c == '-') c = '+';
    else if (c == '_') c = '/';
  }
  while (payload.size() % 4 != 0) {
    payload += '=';
  }

  static const std::string chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string decoded;
  int val = 0;
  int bits = -8;
  for (unsigned char c : payload) {
    if (c == '=') {
      break;
    }
    auto pos = chars.find(c);
    if (pos == std::string::npos) {
      continue;
    }
    val = (val << 6) + static_cast<int>(pos);
    bits += 6;
    if (bits >= 0) {
      decoded += static_cast<char>((val >> bits) & 0xFF);
      bits -= 8;
    }
  }

  try {
    auto parsed = nlohmann::json::parse(decoded);
    if (parsed.is_object() && !parsed.contains("id") &&
        parsed.contains("sub") && parsed["sub"].is_string()) {
      parsed["id"] = parsed["sub"];
    }
    if (parsed.is_object() && !parsed.contains("customClaims") &&
        parsed.contains("custom") && parsed["custom"].is_object()) {
      parsed["customClaims"] = parsed["custom"];
    }
    return parsed.dump();
  } catch (...) {
    return decoded;
  }
}

void AuthClient::onAuthStateChange(AuthStateCallback callback) {
  std::lock_guard<std::mutex> lock(state_->cbMutex);
  state_->authCallbacks.push_back(std::move(callback));
}

void AuthClient::notifyAuthChange(const std::string &userJson) const {
  std::lock_guard<std::mutex> lock(state_->cbMutex);
  for (const auto &cb : state_->authCallbacks)
    cb(userJson);
}

} // namespace client
