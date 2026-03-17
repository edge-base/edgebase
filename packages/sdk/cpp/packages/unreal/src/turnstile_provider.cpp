#include "edgebase/turnstile_provider.h"
#include "edgebase/edgebase.h"
#include <nlohmann/json.hpp>

namespace client {

std::string TurnstileProvider::siteKeyCache_;
std::mutex TurnstileProvider::mutex_;
TurnstileProvider::WebViewFactory TurnstileProvider::webViewFactory_;
std::shared_ptr<GeneratedDbApi> TurnstileProvider::core_;

void TurnstileProvider::setGeneratedApi(std::shared_ptr<GeneratedDbApi> core) {
  std::lock_guard<std::mutex> lock(mutex_);
  core_ = std::move(core);
}

std::string TurnstileProvider::fetchSiteKey(
    const std::shared_ptr<HttpClient> &http) {
  {
    std::lock_guard<std::mutex> lock(mutex_);
    if (!siteKeyCache_.empty())
      return siteKeyCache_;
  }

  // Delegate to GeneratedDbApi::get_config() if available;
  // fall back to HttpClient for backward compatibility.
  Result r;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    if (core_) {
      r = core_->get_config();
    } else {
      // Fallback: construct a temporary GeneratedDbApi from the HttpClient.
      // This avoids hardcoding "/config" and still uses the generated method.
      GeneratedDbApi tempCore(*http);
      r = tempCore.get_config();
    }
  }

  if (!r.ok)
    return "";

  try {
    auto j = nlohmann::json::parse(r.body);
    if (j.contains("captcha") && j["captcha"].is_object() &&
        j["captcha"].contains("siteKey") &&
        j["captcha"]["siteKey"].is_string()) {
      std::lock_guard<std::mutex> lock(mutex_);
      siteKeyCache_ = j["captcha"]["siteKey"].get<std::string>();
      return siteKeyCache_;
    }
  } catch (...) {
  }
  return "";
}

std::string TurnstileProvider::resolveCaptchaToken(
    const std::shared_ptr<HttpClient> &http, const std::string &action,
    const std::string &manualToken) {
  if (!manualToken.empty())
    return manualToken;

  std::string siteKey = fetchSiteKey(http);
  if (siteKey.empty())
    return "";

  std::lock_guard<std::mutex> lock(mutex_);
  if (webViewFactory_) {
    try {
      return webViewFactory_(siteKey, action);
    } catch (...) {
      return "";
    }
  }

  return ""; // No WebView factory — let server handle
}

void TurnstileProvider::setWebViewFactory(WebViewFactory factory) {
  std::lock_guard<std::mutex> lock(mutex_);
  webViewFactory_ = std::move(factory);
}

std::string TurnstileProvider::getTurnstileHtml(const std::string &siteKey,
                                                const std::string &action,
                                                const std::string &appearance) {
  // JS helper: try window.ue binding first, fall back to edgebase:// URL scheme.
  // URL scheme allows SWebBrowser adapter to intercept via OnBeforeNavigation.
  return R"(<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async></script>
<style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:transparent}</style>
</head><body><div id="cf-turnstile"></div><script>
var edgebaseWidgetId = null;
function send(type,val){
  if(window.ue&&window.ue.edgebase&&window.ue.edgebase['on'+type]){window.ue.edgebase['on'+type](val)}
  else{window.location='edgebase://'+type+'/'+encodeURIComponent(val||'')}
}
window.edgebaseResetTurnstile=function(){
  if(window.turnstile&&edgebaseWidgetId!==null){window.turnstile.reset(edgebaseWidgetId)}
}
function init(){if(window.turnstile){edgebaseWidgetId=window.turnstile.render('#cf-turnstile',{
sitekey:')" +
         siteKey + R"(',action:')" + action +
         R"(',appearance:')" + appearance +
         R"(',
callback:function(t){send('token',t)},
'error-callback':function(e){send('error',String(e))},
'before-interactive-callback':function(){send('interactive','show')},
'after-interactive-callback':function(){send('interactive','hide')},
'timeout-callback':function(){send('error','timeout')}
});send('ready','ready')}else{setTimeout(init,50)}}init();
</script></body></html>)";
}

} // namespace client
