// EdgeBase Kotlin SDK — Android captcha provider (Turnstile via WebView).
//
// Zero-config: uses AndroidActivityTracker for Application context and Activity
// tracking. No developer initialization required.
//
// Phase 1: Headless WebView renders Cloudflare Turnstile invisibly (99% auto-pass).
// Phase 2: If interactive challenge needed, WebView is shown as a full-screen
//          dimmed overlay on the current Activity.
//: Auto-captcha across all platforms.

package dev.edgebase.sdk.client

import android.annotation.SuppressLint
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

actual suspend fun acquireCaptchaToken(siteKey: String, action: String): String? {
    testCaptchaToken()?.let { return it }
    return withTimeoutOrNull(30_000L) {
        withContext(Dispatchers.Main) {
            suspendCoroutine { cont ->
                var resumed = false
                var overlay: FrameLayout? = null

                @SuppressLint("SetJavaScriptEnabled")
                val webView = WebView(AndroidActivityTracker.ensureContext()).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    webViewClient = object : WebViewClient() {}
                }

                fun cleanup() {
                    overlay?.let { ov ->
                        (ov.parent as? ViewGroup)?.removeView(ov)
                    }
                    overlay = null
                    webView.destroy()
                }

                webView.addJavascriptInterface(object {
                    @JavascriptInterface
                    fun onToken(token: String) {
                        if (!resumed) {
                            resumed = true
                            Handler(Looper.getMainLooper()).post { cleanup() }
                            cont.resume(token)
                        }
                    }

                    @JavascriptInterface
                    fun onError(error: String) {
                        if (!resumed) {
                            resumed = true
                            Handler(Looper.getMainLooper()).post { cleanup() }
                            cont.resume(null)
                        }
                    }

                    @JavascriptInterface
                    fun onInteractive(state: String) {
                        Handler(Looper.getMainLooper()).post {
                            if (state == "show") {
                                // Phase 2: Show WebView as overlay on current Activity
                                val activity = AndroidActivityTracker.getCurrentActivity() ?: return@post
                                val contentView = activity.findViewById<FrameLayout>(
                                    android.R.id.content
                                ) ?: return@post

                                // Remove WebView from any existing parent
                                (webView.parent as? ViewGroup)?.removeView(webView)

                                // Create dimmed overlay
                                val ov = FrameLayout(activity).apply {
                                    setBackgroundColor(Color.argb(128, 0, 0, 0))
                                    layoutParams = FrameLayout.LayoutParams(
                                        FrameLayout.LayoutParams.MATCH_PARENT,
                                        FrameLayout.LayoutParams.MATCH_PARENT
                                    )
                                }

                                // Center the WebView in the overlay
                                val webViewParams = FrameLayout.LayoutParams(
                                    FrameLayout.LayoutParams.WRAP_CONTENT,
                                    FrameLayout.LayoutParams.WRAP_CONTENT
                                ).apply { gravity = Gravity.CENTER }

                                ov.addView(webView, webViewParams)
                                contentView.addView(ov)
                                overlay = ov
                            } else if (state == "hide") {
                                overlay?.let { ov ->
                                    (ov.parent as? ViewGroup)?.removeView(ov)
                                }
                                overlay = null
                            }
                        }
                    }
                }, "captchaHandler")

                val html = buildTurnstileHtml(siteKey, action)
                webView.loadDataWithBaseURL(
                    "https://challenges.cloudflare.com",
                    html, "text/html", "utf-8", null
                )
            }
        }
    }
}

private fun testCaptchaToken(): String? {
    val envToken = System.getenv("EDGEBASE_TEST_CAPTCHA_TOKEN")
        ?.takeIf { it.isNotBlank() }
    if (envToken != null) return envToken

    val context = try {
        AndroidActivityTracker.ensureContext()
    } catch (_: Exception) {
        return null
    }

    return if (context.packageName.endsWith(".test")) {
        "test-captcha-token"
    } else {
        null
    }
}

// ─── Backward-Compatible Init ─────────────────────────────────────────────

/**
 * Optional: manually set Application context.
 * Only needed if auto-detection via ActivityThread reflection fails.
 * Delegates to shared AndroidActivityTracker.
 */
fun initCaptchaContext(context: android.content.Context) {
    AndroidActivityTracker.initContext(context)
}

// ─── HTML Template ───

/**
 * Build the Turnstile HTML page for WebView rendering.
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
          callback:function(t){window.captchaHandler.onToken(t)},
          'error-callback':function(e){window.captchaHandler.onError(String(e))},
          'before-interactive-callback':function(){window.captchaHandler.onInteractive('show')},
          'after-interactive-callback':function(){window.captchaHandler.onInteractive('hide')},
          'timeout-callback':function(){window.captchaHandler.onError('timeout')}
        });
      }else{setTimeout(init,50)}
    }
    init();
  </script>
</body>
</html>
""".trimIndent()
