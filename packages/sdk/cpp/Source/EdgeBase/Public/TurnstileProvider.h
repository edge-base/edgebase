#pragma once

#include <chrono>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <string>

#ifndef EDGEBASE_API
#define EDGEBASE_API
#endif

namespace client {

class HttpClient;
class GeneratedDbApi;

/**
 * Turnstile captcha provider for the packaged Unreal plugin.
 * Checks /api/config and auto-acquires a token from EdgeBase's hosted
 * same-origin challenge page.
 */
class EDGEBASE_API TurnstileProvider {
public:
  /** Resolve a manual token or auto-acquire one for a protected action. */
  static std::string resolveCaptchaToken(
      const std::shared_ptr<HttpClient> &http,
      const std::string &action,
      const std::string &manualToken = "");

  /**
   * Fetch and cache the public site key per normalized HTTPS base URL.
   * Returns empty only for a successful {"captcha": null} response; request
   * and malformed-response failures throw with the "captcha-unavailable"
   * diagnostic contract.
   */
  static std::string fetchSiteKey(const std::shared_ptr<HttpClient> &http);

  /** Optionally provide the generated API instance used for config fetches. */
  static void setGeneratedApi(std::shared_ptr<GeneratedDbApi> core);

  /** Receives (hostedChallengeUrl, channel) and returns the captcha token. */
  using WebViewFactory =
      std::function<std::string(const std::string &hostedChallengeUrl,
                                const std::string &channel)>;

  /** Runs before any synchronous config fetch or WebView work. */
  using PreflightGuard = std::function<void()>;

  /** Register the platform WebView factory and core auth provider hook. */
  static void setWebViewFactory(WebViewFactory factory);

  /** Register a platform-thread guard for synchronous protected auth. */
  static void setPreflightGuard(PreflightGuard guard);

  /** Override the monotonic clock for deterministic cache expiry tests. */
  using Clock = std::function<std::chrono::steady_clock::time_point()>;
  static void setClockForTesting(Clock clock);

  /** Invoke the factory without holding the provider mutex. */
  static std::string acquireCaptchaToken(const std::string &baseUrl,
                                         const std::string &action);

  /** Build an origin-only HTTPS hosted challenge URL using the URI bridge. */
  static std::string buildChallengeUrl(const std::string &baseUrl,
                                       const std::string &action,
                                       const std::string &channel);

  /** Generate a 128-bit cryptographically secure, URL-safe channel. */
  static std::string generateSecureChannel();

  /** Parse and validate a channel-bound hosted challenge JSON message. */
  static bool tryParseChallengeMessage(const std::string &rawJson,
                                       const std::string &expectedChannel,
                                       std::string &type,
                                       std::string &value);

  /** Decode edgebase://message/<percent-encoded-json> and validate it. */
  static bool tryParseChallengeUri(const std::string &uri,
                                   const std::string &expectedChannel,
                                   std::string &type,
                                   std::string &value);

private:
  struct SiteKeyCacheEntry {
    std::string siteKey;
    std::chrono::steady_clock::time_point expiresAt;
  };
  static std::map<std::string, SiteKeyCacheEntry> siteKeyCache_;
  static std::mutex mutex_;
  static WebViewFactory webViewFactory_;
  static PreflightGuard preflightGuard_;
  static Clock clock_;
  static std::shared_ptr<GeneratedDbApi> core_;
};

} // namespace client
