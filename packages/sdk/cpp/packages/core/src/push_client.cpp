// PushClient — Push notification management for Unreal Engine (
// §5/§9/§10). Supports Android (FCM), iOS (APNs), macOS (APNs), Web (VAPID).
// Windows/Linux — use Web Push (browser) instead.
//
// Usage in Unreal Engine:
//   client.push.setPlatform("ios"); // or "android", "macos", "web"
//   client.push.setTokenProvider([]() { return GetFCMToken(); });
//   client.push.setDeviceInfo(R"({"name":"iPhone
//   15","osVersion":"iOS 17.2","locale":"ko-KR"})"); client.push.registerPush();

#include <chrono>
#include <edgebase/edgebase.h>
#include <random>
#include <sstream>

#include "push_permission.h"

namespace client {

struct PushClient::State {
  std::vector<MessageCallback> messageListeners;
  std::vector<MessageCallback> openedAppListeners;
  PermissionProvider permissionStatusProvider;
  PermissionProvider permissionRequester;
  TokenProvider tokenProvider;
  std::string cachedDeviceId;
  std::string cachedToken;
  std::string cachedDeviceInfo;
  std::string cachedPlatform;
};

PushClient::PushClient(std::shared_ptr<HttpClient> http)
    : http_(std::move(http)), state_(std::make_shared<State>()) {}

std::string PushClient::getOrCreateDeviceId() {
  if (!state_->cachedDeviceId.empty())
    return state_->cachedDeviceId;
  // Simple unique ID generation
  auto now = std::chrono::system_clock::now().time_since_epoch().count();
  std::mt19937 rng(static_cast<unsigned>(now));
  std::uniform_int_distribution<uint64_t> dist;
  std::ostringstream ss;
  ss << std::hex << dist(rng) << "-" << dist(rng);
  state_->cachedDeviceId = ss.str();
  return state_->cachedDeviceId;
}

void PushClient::setTokenProvider(TokenProvider provider) {
  state_->tokenProvider = std::move(provider);
}

void PushClient::registerPush(const std::string &metadataJson) {
  // 1. Request permission
  auto perm = requestPermission();
  if (perm != "granted")
    return;

  // 2. Get token from provider
  if (!state_->tokenProvider)
    throw std::runtime_error("tokenProvider not set. Call setTokenProvider() "
                             "before registerPush().");
  auto token = state_->tokenProvider();

  // 3. Check cache — skip if unchanged (§9), unless metadata provided
  if (state_->cachedToken == token && metadataJson.empty())
    return;

  // 4. Register with server — send deviceInfo and platform
  auto deviceId = getOrCreateDeviceId();
  auto platform =
      state_->cachedPlatform.empty() ? "android" : state_->cachedPlatform;
  registerToken(deviceId, token, platform, state_->cachedDeviceInfo,
                metadataJson);
  state_->cachedToken = token;
}

void PushClient::setDeviceInfo(const std::string &deviceInfoJson) {
  state_->cachedDeviceInfo = deviceInfoJson;
}

void PushClient::setPlatform(const std::string &platform) {
  state_->cachedPlatform = platform;
}

Result PushClient::registerToken(const std::string &deviceId,
                                 const std::string &token,
                                 const std::string &platform,
                                 const std::string &deviceInfoJson,
                                 const std::string &metadataJson) const {
  std::ostringstream body;
  body << R"({"deviceId":")" << deviceId << R"(","token":")" << token
       << R"(","platform":")" << platform << R"(")";
  if (!deviceInfoJson.empty()) {
    body << R"(,"deviceInfo":)" << deviceInfoJson;
  }
  if (!metadataJson.empty()) {
    body << R"(,"metadata":)" << metadataJson;
  }
  body << "}";
  return http_->post("/push/register", body.str());
}

Result PushClient::unregisterToken(const std::string &deviceId) const {
  auto id = deviceId.empty()
                ? const_cast<PushClient *>(this)->getOrCreateDeviceId()
                : deviceId;
  std::ostringstream body;
  body << R"({"deviceId":")" << id << R"("})";
  return http_->post("/push/unregister", body.str());
}

Result PushClient::subscribeTopic(const std::string &topic) const {
  std::ostringstream body;
  body << R"({"topic":")" << topic << R"("})";
  return http_->post("/push/topic/subscribe", body.str());
}

Result PushClient::unsubscribeTopic(const std::string &topic) const {
  std::ostringstream body;
  body << R"({"topic":")" << topic << R"("})";
  return http_->post("/push/topic/unsubscribe", body.str());
}

void PushClient::onMessage(MessageCallback callback) {
  state_->messageListeners.push_back(std::move(callback));
}

void PushClient::onMessageOpenedApp(MessageCallback callback) {
  state_->openedAppListeners.push_back(std::move(callback));
}

std::string PushClient::getPermissionStatus() const {
  if (state_->permissionStatusProvider)
    return state_->permissionStatusProvider();
  return internal::platformGetPermissionStatus();
}

std::string PushClient::requestPermission() const {
  if (state_->permissionRequester)
    return state_->permissionRequester();
  return internal::platformRequestPermission();
}

void PushClient::dispatchMessage(const std::string &messageJson) const {
  for (const auto &cb : state_->messageListeners)
    cb(messageJson);
}

void PushClient::dispatchMessageOpenedApp(
    const std::string &messageJson) const {
  for (const auto &cb : state_->openedAppListeners)
    cb(messageJson);
}

void PushClient::setPermissionStatusProvider(PermissionProvider provider) {
  state_->permissionStatusProvider = std::move(provider);
}

void PushClient::setPermissionRequester(PermissionProvider requester) {
  state_->permissionRequester = std::move(requester);
}

} // namespace client
