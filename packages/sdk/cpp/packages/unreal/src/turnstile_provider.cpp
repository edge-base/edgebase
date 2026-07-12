#include "edgebase/turnstile_provider.h"

#include "edgebase/edgebase.h"
#include <nlohmann/json.hpp>

#include <array>
#include <cctype>
#include <chrono>
#include <cstdint>
#include <random>
#include <stdexcept>

#if defined(_WIN32)
#include <bcrypt.h>
#if defined(_MSC_VER)
#pragma comment(lib, "bcrypt.lib")
#endif
#elif defined(__unix__) || defined(__APPLE__)
#include <cerrno>
#include <fcntl.h>
#include <unistd.h>
#endif

namespace client {
namespace {

constexpr const char *kChallengePath = "/api/captcha/challenge";
constexpr const char *kMessagePrefix = "edgebase://message/";
constexpr std::size_t kMaxRawMessageBytes = 4096;
constexpr std::size_t kMaxTokenBytes = 2048;
constexpr std::size_t kMaxErrorBytes = 256;
constexpr std::size_t kMaxReadyBytes = 32;
constexpr auto kSiteKeyCacheTtl = std::chrono::minutes(5);

bool isAsciiAlphaNumeric(char ch) {
  const auto value = static_cast<unsigned char>(ch);
  return (value >= 'a' && value <= 'z') ||
         (value >= 'A' && value <= 'Z') ||
         (value >= '0' && value <= '9');
}

bool isValidChannel(const std::string &channel) {
  if (channel.size() < 22 || channel.size() > 64) {
    return false;
  }
  for (const char ch : channel) {
    if (!isAsciiAlphaNumeric(ch) && ch != '_' && ch != '-') {
      return false;
    }
  }
  return true;
}

bool isAllowedAction(const std::string &action) {
  static constexpr std::array<const char *, 8> actions = {
      "signup", "signin", "anonymous", "magic-link", "phone",
      "password-reset", "oauth", "function"};
  for (const char *allowed : actions) {
    if (action == allowed) {
      return true;
    }
  }
  return false;
}

bool isValidHostname(const std::string &hostname) {
  if (hostname.empty() || hostname.size() > 253 || hostname.front() == '.' ||
      hostname.back() == '.') {
    return false;
  }
  std::size_t labelStart = 0;
  while (labelStart < hostname.size()) {
    const auto labelEnd = hostname.find('.', labelStart);
    const auto end = labelEnd == std::string::npos ? hostname.size() : labelEnd;
    const auto length = end - labelStart;
    if (length == 0 || length > 63 ||
        !isAsciiAlphaNumeric(hostname[labelStart]) ||
        !isAsciiAlphaNumeric(hostname[end - 1])) {
      return false;
    }
    for (std::size_t i = labelStart; i < end; ++i) {
      if (!isAsciiAlphaNumeric(hostname[i]) && hostname[i] != '-') {
        return false;
      }
    }
    if (labelEnd == std::string::npos) {
      break;
    }
    labelStart = labelEnd + 1;
  }
  return true;
}

bool isValidPort(const std::string &port) {
  if (port.empty() || port.size() > 5) {
    return false;
  }
  unsigned int value = 0;
  for (const char ch : port) {
    if (ch < '0' || ch > '9') {
      return false;
    }
    value = value * 10U + static_cast<unsigned int>(ch - '0');
  }
  return value > 0 && value <= 65535;
}

std::string normalizeHttpsOrigin(const std::string &baseUrl) {
  if (baseUrl.size() < 9 || baseUrl.size() > 2048 ||
      baseUrl.compare(0, 8, "https://") != 0) {
    return "";
  }

  std::string origin = baseUrl;
  if (origin.back() == '/') {
    origin.pop_back();
  }
  const std::string authority = origin.substr(8);
  if (authority.empty() || authority.find_first_of("/?#\\@") !=
                               std::string::npos) {
    return "";
  }
  for (const char ch : authority) {
    const auto value = static_cast<unsigned char>(ch);
    if (value <= 0x20 || value >= 0x7f) {
      return "";
    }
  }

  if (authority.front() == '[') {
    const auto close = authority.find(']');
    if (close == std::string::npos || close <= 2) {
      return "";
    }
    const std::string literal = authority.substr(1, close - 1);
    unsigned int colonCount = 0;
    for (const char ch : literal) {
      if (ch == ':') {
        ++colonCount;
      } else if (!std::isxdigit(static_cast<unsigned char>(ch)) && ch != '.') {
        return "";
      }
    }
    if (colonCount < 2) {
      return "";
    }
    const std::string suffix = authority.substr(close + 1);
    if (!suffix.empty() &&
        (suffix.front() != ':' || !isValidPort(suffix.substr(1)))) {
      return "";
    }
  } else {
    const auto colon = authority.find(':');
    if (colon != std::string::npos &&
        (authority.find(':', colon + 1) != std::string::npos ||
         !isValidPort(authority.substr(colon + 1)))) {
      return "";
    }
    const std::string hostname = authority.substr(0, colon);
    if (!isValidHostname(hostname)) {
      return "";
    }
  }
  return origin;
}

void fillSecureRandom(std::uint8_t *buffer, std::size_t size) {
#if defined(_WIN32)
  const NTSTATUS status = BCryptGenRandom(
      nullptr, reinterpret_cast<PUCHAR>(buffer), static_cast<ULONG>(size),
      BCRYPT_USE_SYSTEM_PREFERRED_RNG);
  if (status < 0) {
    throw std::runtime_error("BCryptGenRandom failed");
  }
#elif defined(__unix__) || defined(__APPLE__)
  int flags = O_RDONLY;
#ifdef O_CLOEXEC
  flags |= O_CLOEXEC;
#endif
  const int descriptor = open("/dev/urandom", flags);
  if (descriptor < 0) {
    throw std::runtime_error("secure random source unavailable");
  }
  std::size_t offset = 0;
  while (offset < size) {
    const ssize_t readCount =
        read(descriptor, buffer + offset, static_cast<size_t>(size - offset));
    if (readCount > 0) {
      offset += static_cast<std::size_t>(readCount);
      continue;
    }
    if (readCount < 0 && errno == EINTR) {
      continue;
    }
    close(descriptor);
    throw std::runtime_error("secure random read failed");
  }
  close(descriptor);
#else
  std::random_device source;
  if (source.entropy() <= 0.0) {
    throw std::runtime_error("cryptographic random source unavailable");
  }
  for (std::size_t i = 0; i < size; ++i) {
    buffer[i] = static_cast<std::uint8_t>(source());
  }
#endif
}

int hexValue(char ch) {
  if (ch >= '0' && ch <= '9') {
    return ch - '0';
  }
  if (ch >= 'a' && ch <= 'f') {
    return 10 + ch - 'a';
  }
  if (ch >= 'A' && ch <= 'F') {
    return 10 + ch - 'A';
  }
  return -1;
}

bool percentDecodeMessage(const std::string &encoded, std::string &decoded) {
  if (encoded.empty() || encoded.size() > kMaxRawMessageBytes * 3) {
    return false;
  }
  decoded.clear();
  decoded.reserve(encoded.size());
  for (std::size_t i = 0; i < encoded.size(); ++i) {
    char ch = encoded[i];
    if (ch == '%') {
      if (i + 2 >= encoded.size()) {
        return false;
      }
      const int high = hexValue(encoded[i + 1]);
      const int low = hexValue(encoded[i + 2]);
      if (high < 0 || low < 0) {
        return false;
      }
      ch = static_cast<char>((high << 4) | low);
      i += 2;
    } else if (ch == '/' || ch == '?' || ch == '#') {
      return false;
    }
    decoded.push_back(ch);
    if (decoded.size() > kMaxRawMessageBytes) {
      return false;
    }
  }
  return true;
}

bool hasSafeJsonDepth(const std::string &rawJson) {
  bool inString = false;
  bool escaped = false;
  int depth = 0;
  for (const char ch : rawJson) {
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch == '\\') {
        escaped = true;
      } else if (ch == '"') {
        inString = false;
      }
      continue;
    }
    if (ch == '"') {
      inString = true;
    } else if (ch == '{' || ch == '[') {
      if (++depth > 8) return false;
    } else if (ch == '}' || ch == ']') {
      if (--depth < 0) return false;
    }
  }
  return depth == 0 && !inString && !escaped;
}

} // namespace

std::map<std::string, TurnstileProvider::SiteKeyCacheEntry>
    TurnstileProvider::siteKeyCache_;
std::mutex TurnstileProvider::mutex_;
TurnstileProvider::WebViewFactory TurnstileProvider::webViewFactory_;
TurnstileProvider::PreflightGuard TurnstileProvider::preflightGuard_;
TurnstileProvider::Clock TurnstileProvider::clock_ =
    []() { return std::chrono::steady_clock::now(); };
std::shared_ptr<GeneratedDbApi> TurnstileProvider::core_;

void TurnstileProvider::setGeneratedApi(std::shared_ptr<GeneratedDbApi> core) {
  std::lock_guard<std::mutex> lock(mutex_);
  core_ = std::move(core);
}

std::string TurnstileProvider::fetchSiteKey(
    const std::shared_ptr<HttpClient> &http) {
  if (!http) {
    return "";
  }
  const std::string baseUrl = normalizeHttpsOrigin(http->getBaseUrl());
  if (baseUrl.empty()) {
    return "";
  }
  Clock clock;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    clock = clock_;
  }
  const auto now = clock();
  {
    std::lock_guard<std::mutex> lock(mutex_);
    const auto cached = siteKeyCache_.find(baseUrl);
    if (cached != siteKeyCache_.end() && now < cached->second.expiresAt) {
      return cached->second.siteKey;
    }
    if (cached != siteKeyCache_.end()) {
      siteKeyCache_.erase(cached);
    }
  }

  std::shared_ptr<GeneratedDbApi> configuredCore;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    configuredCore = core_;
  }

  Result result;
  try {
    if (configuredCore && &configuredCore->getHttp() == http.get()) {
      result = configuredCore->get_config();
    } else {
      GeneratedDbApi temporaryCore(*http);
      result = temporaryCore.get_config();
    }
  } catch (...) {
    throw std::runtime_error(
        "captcha-unavailable: config_fetch_failed");
  }
  if (!result.ok) {
    throw std::runtime_error(
        "captcha-unavailable: config_fetch_failed");
  }
  if (result.body.size() > 65536) {
    throw std::runtime_error(
        "captcha-unavailable: config_invalid_response");
  }

  const auto json = nlohmann::json::parse(result.body, nullptr, false);
  if (json.is_discarded() || !json.is_object() ||
      !json.contains("captcha")) {
    throw std::runtime_error(
        "captcha-unavailable: config_invalid_response");
  }
  if (json["captcha"].is_null()) {
    return "";
  }
  if (!json["captcha"].is_object() ||
      !json["captcha"].contains("siteKey") ||
      !json["captcha"]["siteKey"].is_string()) {
    throw std::runtime_error(
        "captcha-unavailable: config_invalid_response");
  }
  const auto siteKey = json["captcha"]["siteKey"].get<std::string>();
  if (siteKey.empty() || siteKey.size() > 512) {
    throw std::runtime_error(
        "captcha-unavailable: config_invalid_response");
  }

  const auto expiresAt = clock() + kSiteKeyCacheTtl;
  std::lock_guard<std::mutex> lock(mutex_);
  siteKeyCache_[baseUrl] = {siteKey, expiresAt};
  return siteKey;
}

std::string TurnstileProvider::resolveCaptchaToken(
    const std::shared_ptr<HttpClient> &http, const std::string &action,
    const std::string &manualToken) {
  if (!manualToken.empty()) {
    return manualToken;
  }
  PreflightGuard guard;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    guard = preflightGuard_;
  }
  if (guard) {
    guard();
  }
  if (!http || fetchSiteKey(http).empty()) {
    return "";
  }
  return acquireCaptchaToken(http->getBaseUrl(), action);
}

void TurnstileProvider::setPreflightGuard(PreflightGuard guard) {
  std::lock_guard<std::mutex> lock(mutex_);
  preflightGuard_ = std::move(guard);
}

void TurnstileProvider::setClockForTesting(Clock clock) {
  std::lock_guard<std::mutex> lock(mutex_);
  clock_ = clock ? std::move(clock)
                 : Clock([]() { return std::chrono::steady_clock::now(); });
  siteKeyCache_.clear();
}

void TurnstileProvider::setWebViewFactory(WebViewFactory factory) {
  const bool enabled = static_cast<bool>(factory);
  {
    std::lock_guard<std::mutex> lock(mutex_);
    webViewFactory_ = std::move(factory);
  }
  if (enabled) {
    AuthClient::setCaptchaTokenProvider(
        [](const std::shared_ptr<HttpClient> &http, const std::string &action,
           const std::string &manualToken) {
          return TurnstileProvider::resolveCaptchaToken(http, action,
                                                        manualToken);
        });
  } else {
    AuthClient::setCaptchaTokenProvider({});
  }
}

std::string TurnstileProvider::acquireCaptchaToken(
    const std::string &baseUrl, const std::string &action) {
  WebViewFactory factory;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    factory = webViewFactory_;
  }
  if (!factory) {
    throw std::runtime_error(
        "captcha-unavailable: no Unreal hosted CAPTCHA WebView adapter is registered");
  }
  const std::string channel = generateSecureChannel();
  const std::string challengeUrl =
      buildChallengeUrl(baseUrl, action, channel);
  const std::string token = factory(challengeUrl, channel);
  if (token.empty()) {
    throw std::runtime_error(
        "captcha-unavailable: Unreal hosted CAPTCHA did not return a token");
  }
  if (token.size() > kMaxTokenBytes) {
    throw std::runtime_error(
        "captcha-unavailable: Unreal hosted CAPTCHA returned an oversized token");
  }
  return token;
}

std::string TurnstileProvider::buildChallengeUrl(
    const std::string &baseUrl, const std::string &action,
    const std::string &channel) {
  const std::string origin = normalizeHttpsOrigin(baseUrl);
  if (origin.empty() || !isAllowedAction(action) ||
      !isValidChannel(channel)) {
    throw std::invalid_argument(
        "Turnstile requires an origin-only HTTPS URL, fixed action, and "
        "secure channel");
  }
  return origin + kChallengePath + "?action=" + action + "&channel=" +
         channel + "&bridge=uri";
}

std::string TurnstileProvider::generateSecureChannel() {
  std::array<std::uint8_t, 16> bytes{};
  fillSecureRandom(bytes.data(), bytes.size());
  static constexpr char hex[] = "0123456789abcdef";
  std::string channel;
  channel.reserve(bytes.size() * 2);
  for (const auto value : bytes) {
    channel.push_back(hex[(value >> 4) & 0x0f]);
    channel.push_back(hex[value & 0x0f]);
  }
  return channel;
}

bool TurnstileProvider::tryParseChallengeMessage(
    const std::string &rawJson, const std::string &expectedChannel,
    std::string &type, std::string &value) {
  type.clear();
  value.clear();
  if (rawJson.empty() || rawJson.size() > kMaxRawMessageBytes ||
      !isValidChannel(expectedChannel) || !hasSafeJsonDepth(rawJson)) {
    return false;
  }

  const auto json = nlohmann::json::parse(rawJson, nullptr, false);
  if (json.is_discarded() || !json.is_object() || json.size() != 4 ||
      !json.contains("v") ||
      !(json["v"].is_number_integer() || json["v"].is_number_unsigned()) ||
      json["v"] != 1 || !json.contains("channel") ||
      !json["channel"].is_string() ||
      json["channel"].get_ref<const std::string &>() != expectedChannel ||
      !json.contains("type") || !json["type"].is_string() ||
      !json.contains("value") || !json["value"].is_string()) {
    return false;
  }

  const auto parsedType = json["type"].get<std::string>();
  const auto parsedValue = json["value"].get<std::string>();
  bool valid = false;
  if (parsedType == "token") {
    valid = !parsedValue.empty() && parsedValue.size() <= kMaxTokenBytes;
  } else if (parsedType == "error") {
    valid = parsedValue.size() <= kMaxErrorBytes;
  } else if (parsedType == "ready") {
    valid = parsedValue.size() <= kMaxReadyBytes;
  } else if (parsedType == "interactive") {
    valid = parsedValue == "show" || parsedValue == "hide";
  }
  if (!valid) {
    return false;
  }
  type = parsedType;
  value = parsedValue;
  return true;
}

bool TurnstileProvider::tryParseChallengeUri(
    const std::string &uri, const std::string &expectedChannel,
    std::string &type, std::string &value) {
  type.clear();
  value.clear();
  if (uri.compare(0, std::char_traits<char>::length(kMessagePrefix),
                  kMessagePrefix) != 0) {
    return false;
  }
  std::string decoded;
  if (!percentDecodeMessage(
          uri.substr(std::char_traits<char>::length(kMessagePrefix)),
          decoded)) {
    return false;
  }
  return tryParseChallengeMessage(decoded, expectedChannel, type, value);
}

} // namespace client
