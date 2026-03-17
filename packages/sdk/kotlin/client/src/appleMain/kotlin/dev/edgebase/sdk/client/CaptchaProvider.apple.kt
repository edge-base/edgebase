// EdgeBase Kotlin SDK — Apple (iOS/macOS) captcha provider (Turnstile via WKWebView).
//
// WKWebView renders Cloudflare Turnstile and bridges the token back
// to Kotlin via WKScriptMessageHandler.
//
// Phase 1: Invisible WKWebView (99% auto-pass).
// Phase 2: If interactive challenge needed, WKWebView shown as overlay on key window.
//
//: Auto-captcha across all platforms.

@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)

package dev.edgebase.sdk.client

import kotlinx.cinterop.ObjCAction
import kotlinx.coroutines.suspendCancellableCoroutine
import platform.Foundation.NSError
import platform.Foundation.NSURL
import platform.WebKit.WKNavigation
import platform.WebKit.WKNavigationDelegateProtocol
import platform.WebKit.WKScriptMessage
import platform.WebKit.WKScriptMessageHandlerProtocol
import platform.WebKit.WKUserContentController
import platform.WebKit.WKWebView
import platform.WebKit.WKWebViewConfiguration
import platform.CoreGraphics.CGRectMake
import platform.darwin.NSObject
import kotlin.coroutines.resume

internal expect fun attachCaptchaOverlay(webView: WKWebView): Boolean

actual suspend fun acquireCaptchaToken(siteKey: String, action: String): String? {
    return suspendCancellableCoroutine { cont ->
        var resumed = false

        val userContentController = WKUserContentController()

        val messageHandler = object : NSObject(), WKScriptMessageHandlerProtocol {
            var webView: WKWebView? = null

            override fun userContentController(
                userContentController: WKUserContentController,
                didReceiveScriptMessage: WKScriptMessage
            ) {
                if (resumed) return
                val name = didReceiveScriptMessage.name
                val body = didReceiveScriptMessage.body as? String

                when (name) {
                    "onToken" -> {
                        if (body != null && body.isNotEmpty()) {
                            resumed = true
                            removeWebViewOverlay()
                            cont.resume(body)
                        }
                    }
                    "onError" -> {
                        resumed = true
                        removeWebViewOverlay()
                        cont.resume(null)
                    }
                    "onInteractive" -> {
                        when (body) {
                            "show" -> showWebViewOverlay()
                            "hide" -> removeWebViewOverlay()
                        }
                    }
                }
            }

            private fun showWebViewOverlay() {
                val wv = webView ?: return
                attachCaptchaOverlay(wv)
            }

            private fun removeWebViewOverlay() {
                webView?.removeFromSuperview()
            }
        }

        userContentController.addScriptMessageHandler(messageHandler, name = "onToken")
        userContentController.addScriptMessageHandler(messageHandler, name = "onError")
        userContentController.addScriptMessageHandler(messageHandler, name = "onInteractive")

        val config = WKWebViewConfiguration().apply {
            this.userContentController = userContentController
        }

        val webView = WKWebView(frame = CGRectMake(0.0, 0.0, 1.0, 1.0), configuration = config)
        messageHandler.webView = webView

        val html = buildTurnstileHtml(siteKey, action)
        webView.loadHTMLString(html, baseURL = NSURL(string = "https://challenges.cloudflare.com"))

        cont.invokeOnCancellation {
            webView.stopLoading()
            userContentController.removeScriptMessageHandlerForName("onToken")
            userContentController.removeScriptMessageHandlerForName("onError")
            userContentController.removeScriptMessageHandlerForName("onInteractive")
            messageHandler.webView?.removeFromSuperview()
        }
    }
}

/**
 * Build the Turnstile HTML page for WKWebView rendering.
 * Uses appearance: 'interaction-only' so it's invisible for 99% of users.
 * Includes before/after interactive callbacks for the 1% who need to solve a challenge.
 */
private fun buildTurnstileHtml(siteKey: String, action: String): String = """
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async></script>
  <style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:transparent}</style>
</head>
<body>
  <div id="cf-turnstile"></div>
  <script>
    function init(){
      if(window.turnstile){
        window.turnstile.render('#cf-turnstile',{
          sitekey:'$siteKey',
          action:'$action',
          appearance:'interaction-only',
          callback:function(t){window.webkit.messageHandlers.onToken.postMessage(t)},
          'error-callback':function(e){window.webkit.messageHandlers.onError.postMessage(String(e))},
          'before-interactive-callback':function(){window.webkit.messageHandlers.onInteractive.postMessage('show')},
          'after-interactive-callback':function(){window.webkit.messageHandlers.onInteractive.postMessage('hide')},
          'timeout-callback':function(){window.webkit.messageHandlers.onError.postMessage('timeout')}
        });
      }else{setTimeout(init,50)}
    }
    init();
  </script>
</body>
</html>
""".trimIndent()
