#pragma once

#include <functional>
#include <memory>
#include <mutex>
#include <string>

namespace client {

class HttpClient;
class GeneratedDbApi;

class EDGEBASE_API TurnstileProvider {
public:
  static std::string resolveCaptchaToken(
      const std::shared_ptr<HttpClient> &http,
      const std::string &action,
      const std::string &manualToken = "");

  static std::string fetchSiteKey(const std::shared_ptr<HttpClient> &http);
  static void setGeneratedApi(std::shared_ptr<GeneratedDbApi> core);

  using WebViewFactory = std::function<std::string(
      const std::string &siteKey, const std::string &action)>;

  static void setWebViewFactory(WebViewFactory factory);

  static std::string getTurnstileHtml(
      const std::string &siteKey,
      const std::string &action,
      const std::string &appearance = "interaction-only");

private:
  static std::string siteKeyCache_;
  static std::mutex mutex_;
  static WebViewFactory webViewFactory_;
  static std::shared_ptr<GeneratedDbApi> core_;
};

} // namespace client
