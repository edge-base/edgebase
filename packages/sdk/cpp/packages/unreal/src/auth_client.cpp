// EdgeBase C++ Core — AuthClient implementation.
// All auth API calls delegate to GeneratedDbApi (api_core.h).
// Token management is preserved in the wrapper.
#include "edgebase/edgebase.h"
#include "edgebase/turnstile_provider.h"
#include <nlohmann/json.hpp>

namespace client {

struct AuthClient::State {
  std::mutex cbMutex;
  std::vector<AuthStateCallback> authCallbacks;
};

AuthClient::AuthClient(std::shared_ptr<HttpClient> http,
                       std::shared_ptr<GeneratedDbApi> core)
    : http_(std::move(http)), core_(std::move(core)),
      state_(std::make_shared<State>()) {}

void AuthClient::notifyAuthChange(const std::string &userJson) const {
  // Copy callbacks under lock, then invoke outside lock to avoid deadlocks.
  std::vector<AuthStateCallback> cbs;
  {
    std::lock_guard<std::mutex> lk(state_->cbMutex);
    cbs = state_->authCallbacks;
  }
  for (auto &cb : cbs) {
    cb(userJson);
  }
}

void AuthClient::onAuthStateChange(AuthStateCallback callback) {
  std::lock_guard<std::mutex> lk(state_->cbMutex);
  state_->authCallbacks.push_back(std::move(callback));
}

static void extractAndStoreToken(const Result &r,
                                 const std::shared_ptr<HttpClient> &http) {
  if (!r.ok)
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

Result AuthClient::signUp(const std::string &email, const std::string &password,
                          const std::string &displayName,
                          const std::string &captchaToken) const {
  nlohmann::json body = {{"email", email}, {"password", password}};
  if (!displayName.empty())
    body["displayName"] = displayName;
  //: auto-acquire captcha token
  std::string resolved = TurnstileProvider::resolveCaptchaToken(http_, "signup", captchaToken);
  if (!resolved.empty()) body["captchaToken"] = resolved;
  auto r = core_->auth_signup(body.dump());
  extractAndStoreToken(r, http_);
  notifyAuthChange(r.body);
  return r;
}

Result AuthClient::signIn(const std::string &email, const std::string &password,
                          const std::string &captchaToken) const {
  nlohmann::json body = {{"email", email}, {"password", password}};
  //: auto-acquire captcha token
  std::string resolved = TurnstileProvider::resolveCaptchaToken(http_, "signin", captchaToken);
  if (!resolved.empty()) body["captchaToken"] = resolved;
  auto r = core_->auth_signin(body.dump());
  // If MFA is required, return without setting tokens
  if (r.ok) {
    try {
      auto j = nlohmann::json::parse(r.body);
      if (j.contains("mfaRequired") && j["mfaRequired"].get<bool>()) {
        return r;
      }
    } catch (...) {}
  }
  extractAndStoreToken(r, http_);
  notifyAuthChange(r.body);
  return r;
}

Result AuthClient::signOut() const {
  std::string body = "{}";
  std::string rt = http_->getRefreshToken();
  if (!rt.empty()) {
    nlohmann::json j = {{"refreshToken", rt}};
    body = j.dump();
  }
  auto r = core_->auth_signout(body);
  if (r.ok) {
    http_->clearToken();
    http_->clearRefreshToken();
    notifyAuthChange("");
  }
  return r;
}

Result AuthClient::signInAnonymously(const std::string &captchaToken) const {
  //: auto-acquire captcha token
  std::string resolved = TurnstileProvider::resolveCaptchaToken(http_, "anonymous", captchaToken);
  nlohmann::json body = nlohmann::json::object();
  if (!resolved.empty()) {
    body["captchaToken"] = resolved;
  }
  Result r = core_->auth_signin_anonymous(body.dump());
  extractAndStoreToken(r, http_);
  notifyAuthChange(r.body);
  return r;
}

Result AuthClient::signInWithMagicLink(const std::string &email,
                                       const std::string &captchaToken) const {
  nlohmann::json body = {{"email", email}};
  //: auto-acquire captcha token
  std::string resolved =
      TurnstileProvider::resolveCaptchaToken(http_, "magic-link", captchaToken);
  if (!resolved.empty())
    body["captchaToken"] = resolved;
  return core_->auth_signin_magic_link(body.dump());
}

Result AuthClient::verifyMagicLink(const std::string &token) const {
  nlohmann::json body = {{"token", token}};
  auto r = core_->auth_verify_magic_link(body.dump());
  extractAndStoreToken(r, http_);
  notifyAuthChange(r.body);
  return r;
}

std::string AuthClient::signInWithOAuth(const std::string &provider,
                                        const std::string &redirectUrl,
                                        const std::string &captchaToken) const {
  // Build the OAuth redirect URL (no network call, mirrors Swift/C#).
  // This returns a relative URL that the caller prefixes with the base URL.
  std::string url = ApiPaths::oauth_redirect(provider);
  if (!redirectUrl.empty()) {
    url += "?redirectUrl=" + redirectUrl;
    if (!captchaToken.empty())
      url += "&captcha_token=" + captchaToken;
  } else if (!captchaToken.empty()) {
    url += "?captcha_token=" + captchaToken;
  }
  return url;
}

std::string AuthClient::linkWithOAuth(const std::string &provider,
                                      const std::string &redirectUrl) const {
  std::string url = ApiPaths::oauth_link_start(provider);
  if (!redirectUrl.empty())
    url += "?redirectUrl=" + redirectUrl;
  return url;
}

Result AuthClient::changePassword(const std::string &currentPassword,
                                  const std::string &newPassword) const {
  nlohmann::json body = {{"currentPassword", currentPassword},
                         {"newPassword", newPassword}};
  auto r = core_->auth_change_password(body.dump());
  extractAndStoreToken(r, http_);
  return r;
}

Result AuthClient::updateProfile(
    const std::map<std::string, std::string> &data) const {
  nlohmann::json body = data;
  return core_->auth_update_profile(body.dump());
}

Result AuthClient::verifyEmail(const std::string &token) const {
  nlohmann::json body = {{"token", token}};
  return core_->auth_verify_email(body.dump());
}

Result AuthClient::requestPasswordReset(const std::string &email,
                                        const std::string &captchaToken) const {
  nlohmann::json body = {{"email", email}};
  //: auto-acquire captcha token
  std::string resolved = TurnstileProvider::resolveCaptchaToken(http_, "password-reset", captchaToken);
  if (!resolved.empty()) body["captchaToken"] = resolved;
  return core_->auth_request_password_reset(body.dump());
}

Result AuthClient::resetPassword(const std::string &token,
                                 const std::string &newPassword) const {
  nlohmann::json body = {{"token", token}, {"newPassword", newPassword}};
  return core_->auth_reset_password(body.dump());
}

Result AuthClient::listSessions() const { return core_->auth_get_sessions(); }

Result AuthClient::revokeSession(const std::string &sessionId) const {
  return core_->auth_delete_session(sessionId);
}

std::string AuthClient::currentToken() const { return http_->getToken(); }

// ── Phone / SMS Auth ──────────────────────────────────────────────────────────

Result AuthClient::signInWithPhone(const std::string &phone) const {
  nlohmann::json body = {{"phone", phone}};
  return core_->auth_signin_phone(body.dump());
}

Result AuthClient::verifyPhone(const std::string &phone,
                               const std::string &code) const {
  nlohmann::json body = {{"phone", phone}, {"code", code}};
  auto r = core_->auth_verify_phone(body.dump());
  extractAndStoreToken(r, http_);
  notifyAuthChange(r.body);
  return r;
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

Result AuthClient::linkWithEmail(const std::string &email,
                                 const std::string &password) const {
  nlohmann::json body = {{"email", email}, {"password", password}};
  auto r = core_->auth_link_email(body.dump());
  extractAndStoreToken(r, http_);
  notifyAuthChange(r.body);
  return r;
}

std::string AuthClient::currentUser() const {
  std::string token = http_->getToken();
  if (token.empty())
    return "";

  // JWT = header.payload.signature — decode the payload (second segment)
  auto firstDot = token.find('.');
  if (firstDot == std::string::npos)
    return "";
  auto secondDot = token.find('.', firstDot + 1);
  if (secondDot == std::string::npos)
    return "";

  std::string payload = token.substr(firstDot + 1, secondDot - firstDot - 1);

  // Base64url to standard base64
  for (auto &c : payload) {
    if (c == '-')
      c = '+';
    else if (c == '_')
      c = '/';
  }
  while (payload.size() % 4 != 0)
    payload += '=';

  // Decode base64
  static const std::string chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string decoded;
  int val = 0, bits = -8;
  for (unsigned char c : payload) {
    if (c == '=')
      break;
    auto pos = chars.find(c);
    if (pos == std::string::npos)
      continue;
    val = (val << 6) + static_cast<int>(pos);
    bits += 6;
    if (bits >= 0) {
      decoded += static_cast<char>((val >> bits) & 0xFF);
      bits -= 8;
    }
  }

  return decoded;
}

// ── MFA / TOTP ──────────────────────────────────────────────────────────────

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
  auto r = core_->auth_mfa_verify(body.dump());
  extractAndStoreToken(r, http_);
  notifyAuthChange(r.body);
  return r;
}

Result AuthClient::useRecoveryCode(const std::string &mfaTicket,
                                   const std::string &recoveryCode) const {
  nlohmann::json body = {{"mfaTicket", mfaTicket},
                         {"recoveryCode", recoveryCode}};
  auto r = core_->auth_mfa_recovery(body.dump());
  extractAndStoreToken(r, http_);
  notifyAuthChange(r.body);
  return r;
}

Result AuthClient::disableTotp(const std::string &password,
                               const std::string &code) const {
  // Build JSON body with optional password/code fields
  nlohmann::json body = nlohmann::json::object();
  if (!password.empty()) body["password"] = password;
  if (!code.empty()) body["code"] = code;
  return core_->auth_mfa_totp_delete(body.dump());
}

Result AuthClient::listFactors() const {
  return core_->auth_mfa_factors();
}

} // namespace client
