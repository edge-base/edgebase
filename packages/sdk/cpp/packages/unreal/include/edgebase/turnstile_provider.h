#pragma once

#include <functional>
#include <memory>
#include <mutex>
#include <string>

namespace client {

class HttpClient;
class GeneratedDbApi;

/**
 * Turnstile captcha provider.
 * Fetches siteKey from /api/config via GeneratedDbApi and auto-acquires token.
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
   * Fetch siteKey from GET /api/config via GeneratedDbApi (cached).
   */
  static std::string fetchSiteKey(const std::shared_ptr<HttpClient> &http);

  /**
   * Set the GeneratedDbApi instance for config fetching.
   * Call once during initialization alongside setWebViewFactory().
   */
  static void setGeneratedApi(std::shared_ptr<GeneratedDbApi> core);

  /**
   * WebView factory callback type.
   * Receives (siteKey, action) and should return the captcha token.
   */
  using WebViewFactory = std::function<std::string(const std::string &siteKey,
                                                    const std::string &action)>;

  /**
   * Set the WebView factory for token acquisition.
   * Call once during initialization (e.g. in GameInstance::Init).
   */
  static void setWebViewFactory(WebViewFactory factory);

  /**
   * Generate the Turnstile HTML for loading in a WebView/browser widget.
   * JS bridge communicates via edgebase:// navigation callbacks or window.ue.
   */
  static std::string getTurnstileHtml(const std::string &siteKey,
                                      const std::string &action,
                                      const std::string &appearance =
                                          "interaction-only");

private:
  static std::string siteKeyCache_;
  static std::mutex mutex_;
  static WebViewFactory webViewFactory_;
  static std::shared_ptr<GeneratedDbApi> core_;
};

} // namespace client
