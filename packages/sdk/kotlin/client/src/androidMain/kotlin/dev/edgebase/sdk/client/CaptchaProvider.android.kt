// EdgeBase Kotlin SDK — Android captcha provider (Turnstile via WebView).
//
// Android client creation requires AndroidEdgeBase.client(currentActivity, ...),
// which captures an already-resumed Activity without hidden-API reflection.
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
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import java.security.SecureRandom
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal actual val usesDirectCaptchaSiteKey: Boolean = false

actual suspend fun acquireCaptchaToken(baseUrl: String, siteKey: String, action: String): String? {
    testCaptchaToken()?.let { return it }
    val channel = secureCaptchaChannel()
    val challengeUrl = buildHostedCaptchaChallengeUrl(baseUrl, action, channel, "android")
    return try {
        withTimeout(30_000L) {
          withContext(Dispatchers.Main) {
            suspendCancellableCoroutine { cont ->
                var resumed = false
                var overlay: FrameLayout? = null

                @SuppressLint("SetJavaScriptEnabled")
                val webView = try {
                    WebView(
                        AndroidActivityTracker.getCurrentActivity()
                            ?: AndroidActivityTracker.ensureContext()
                    ).apply {
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = true
                        settings.allowFileAccess = false
                        settings.allowContentAccess = false
                        settings.setSupportMultipleWindows(false)
                        settings.javaScriptCanOpenWindowsAutomatically = false
                        settings.cacheMode = WebSettings.LOAD_NO_CACHE
                        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                    }
                } catch (error: RuntimeException) {
                    cont.resumeWithException(
                        CaptchaUnavailableException("webview_initialization_failed", error)
                    )
                    return@suspendCancellableCoroutine
                }
                CookieManager.getInstance().apply {
                    setAcceptCookie(true)
                    setAcceptThirdPartyCookies(webView, true)
                }

                fun cleanup() {
                    overlay?.let { ov ->
                        (ov.parent as? ViewGroup)?.removeView(ov)
                    }
                    overlay = null
                    webView.removeJavascriptInterface("EdgeBaseCaptchaBridge")
                    webView.stopLoading()
                    webView.destroy()
                }

                fun finish(token: String) {
                    Handler(Looper.getMainLooper()).post {
                        if (!resumed) {
                            resumed = true
                            cleanup()
                            if (cont.isActive) cont.resume(token)
                        }
                    }
                }

                fun fail(reason: String) {
                    Handler(Looper.getMainLooper()).post {
                        if (!resumed) {
                            resumed = true
                            cleanup()
                            if (cont.isActive) {
                                cont.resumeWithException(CaptchaUnavailableException(reason))
                            }
                        }
                    }
                }

                webView.webViewClient = object : WebViewClient() {
                    private fun blockUnexpected(url: String): Boolean {
                        if (url == challengeUrl) return false
                        fail("unexpected_navigation")
                        return true
                    }

                    override fun shouldOverrideUrlLoading(
                        view: WebView,
                        request: WebResourceRequest
                    ): Boolean = request.isForMainFrame && blockUnexpected(request.url.toString())

                    @Deprecated("Deprecated in Android")
                    override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean =
                        blockUnexpected(url)

                    override fun onReceivedError(
                        view: WebView,
                        request: WebResourceRequest,
                        error: WebResourceError
                    ) {
                        if (request.isForMainFrame) fail("challenge_load_failed")
                    }

                    override fun onReceivedHttpError(
                        view: WebView,
                        request: WebResourceRequest,
                        errorResponse: WebResourceResponse
                    ) {
                        if (request.isForMainFrame && errorResponse.statusCode >= 400) {
                            fail("challenge_http_${errorResponse.statusCode}")
                        }
                    }

                    override fun onRenderProcessGone(
                        view: WebView,
                        detail: RenderProcessGoneDetail
                    ): Boolean {
                        fail("renderer_terminated")
                        return true
                    }
                }

                webView.addJavascriptInterface(object {
                    @JavascriptInterface
                    fun postMessage(raw: String) {
                        val message = parseHostedCaptchaMessage(raw, channel) ?: return
                        Handler(Looper.getMainLooper()).post {
                            if (resumed) return@post
                            if (message.type == "token") {
                                finish(message.value)
                            } else if (message.type == "error") {
                                fail(captchaBridgeFailureReason(message.value))
                            } else if (message.type == "interactive" && message.value == "show") {
                                // Phase 2: Show WebView as overlay on current Activity
                                val activity = AndroidActivityTracker.getCurrentActivity()
                                if (activity == null) {
                                    fail("activity_unavailable")
                                    return@post
                                }
                                val contentView = activity.findViewById<FrameLayout>(
                                    android.R.id.content
                                )
                                if (contentView == null) {
                                    fail("activity_content_unavailable")
                                    return@post
                                }

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
                            } else if (message.type == "interactive" && message.value == "hide") {
                                overlay?.let { ov ->
                                    (ov.parent as? ViewGroup)?.removeView(ov)
                                }
                                overlay = null
                            }
                        }
                    }
                }, "EdgeBaseCaptchaBridge")

                cont.invokeOnCancellation {
                    Handler(Looper.getMainLooper()).post {
                        if (!resumed) {
                            resumed = true
                            cleanup()
                        }
                    }
                }
                webView.loadUrl(challengeUrl)
            }
          }
        }
    } catch (timeout: TimeoutCancellationException) {
        throw CaptchaUnavailableException("timeout", timeout)
    }
}

private fun secureCaptchaChannel(): String {
    return try {
        val bytes = ByteArray(16)
        SecureRandom().nextBytes(bytes)
        bytes.joinToString("") { "%02x".format(it.toInt() and 0xff) }
    } catch (error: RuntimeException) {
        throw CaptchaUnavailableException("secure_random_unavailable", error)
    }
}

private fun captchaBridgeFailureReason(value: String): String {
    val normalized = value.lowercase()
        .map { if (it.isLetterOrDigit() || it == '_' || it == '-') it else '_' }
        .joinToString("")
        .take(128)
    return if (normalized.isBlank()) "challenge_error" else "challenge_$normalized"
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
