#pragma once

#include <chrono>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <string>

namespace client {

class HttpClient;
class GeneratedDbApi;

/**
 * Turnstile captcha provider.
 * Checks /api/config and auto-acquires a token from EdgeBase's hosted
 * same-origin challenge page.
 *
 * On Unreal Engine: uses WebBrowserWidget for Turnstile rendering.
 * Requires calling setWebViewFactory() during initialization.
 */
class TurnstileProvider {
public:
  /**
   * Resolve captcha token: use provided token or auto-acquire.
   * @param http HttpClient for token management (shared_ptr kept for compat)
   * @param action Action name (signup, signin, anonymous, password-reset)
   * @param manualToken Optional manual token override
   * @return Captcha token or empty string if not configured
   */
  static std::string resolveCaptchaToken(
      const std::shared_ptr<HttpClient> &http,
      const std::string &action,
      const std::string &manualToken = "");

  /**
   * Fetch siteKey from GET /api/config via GeneratedDbApi. The cache is keyed
   * by the normalized HTTPS base URL so multiple EdgeBase clients cannot
   * share another deployment's CAPTCHA configuration.
   * Returns an empty string only for a successful {"captcha": null} response.
   * Request and malformed-response failures throw with the
   * "captcha-unavailable" diagnostic contract.
   */
  static std::string fetchSiteKey(const std::shared_ptr<HttpClient> &http);

  /**
   * Set the GeneratedDbApi instance for config fetching.
   * Call once during initialization alongside setWebViewFactory().
   */
  static void setGeneratedApi(std::shared_ptr<GeneratedDbApi> core);

  /**
   * WebView factory callback type.
   * Receives (hostedChallengeUrl, channel) and should return the captcha token.
   */
  using WebViewFactory =
      std::function<std::string(const std::string &hostedChallengeUrl,
                                const std::string &channel)>;

  /** Runs before any synchronous config fetch or WebView work. */
  using PreflightGuard = std::function<void()>;

  /**
   * Set the WebView factory for token acquisition.
   * Call once during initialization (e.g. in GameInstance::Init).
   */
  static void setWebViewFactory(WebViewFactory factory);

  /** Register a platform-thread guard for synchronous protected auth. */
  static void setPreflightGuard(PreflightGuard guard);

  /** Override the monotonic clock for deterministic cache expiry tests. */
  using Clock = std::function<std::chrono::steady_clock::time_point()>;
  static void setClockForTesting(Clock clock);

  /**
   * Acquire a token from the registered WebView without fetching config.
   * The factory is invoked without holding the provider mutex.
   */
  static std::string acquireCaptchaToken(const std::string &baseUrl,
                                         const std::string &action);

  /// Build an origin-only HTTPS hosted challenge URL using the URI bridge.
  static std::string buildChallengeUrl(const std::string &baseUrl,
                                       const std::string &action,
                                       const std::string &channel);

  /// Generate a 128-bit cryptographically secure, URL-safe channel.
  static std::string generateSecureChannel();

  /// Parse and validate a channel-bound hosted challenge JSON message.
  static bool tryParseChallengeMessage(const std::string &rawJson,
                                       const std::string &expectedChannel,
                                       std::string &type,
                                       std::string &value);

  /// Decode edgebase://message/<percent-encoded-json> and validate it.
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
