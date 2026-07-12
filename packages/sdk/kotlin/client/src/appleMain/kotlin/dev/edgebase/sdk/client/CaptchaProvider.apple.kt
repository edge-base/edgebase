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

import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.ObjCSignatureOverride
import kotlinx.cinterop.usePinned
import platform.Foundation.NSError
import platform.Foundation.NSURL
import platform.Foundation.NSURLRequest
import platform.WebKit.WKNavigation
import platform.WebKit.WKNavigationAction
import platform.WebKit.WKNavigationActionPolicy
import platform.WebKit.WKNavigationDelegateProtocol
import platform.WebKit.WKNavigationResponse
import platform.WebKit.WKNavigationResponsePolicy
import platform.WebKit.WKScriptMessage
import platform.WebKit.WKScriptMessageHandlerProtocol
import platform.WebKit.WKUserContentController
import platform.WebKit.WKWebView
import platform.WebKit.WKWebViewConfiguration
import platform.WebKit.WKWebsiteDataStore
import platform.CoreGraphics.CGRectMake
import platform.Security.SecRandomCopyBytes
import platform.Security.errSecSuccess
import platform.Security.kSecRandomDefault
import platform.darwin.NSObject
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal actual val usesDirectCaptchaSiteKey: Boolean = false

internal expect fun attachCaptchaOverlay(webView: WKWebView): Boolean

@Suppress("UNUSED_PARAMETER")
actual suspend fun acquireCaptchaToken(baseUrl: String, siteKey: String, action: String): String? {
    val randomBytes = ByteArray(16)
    val randomStatus = randomBytes.usePinned {
        SecRandomCopyBytes(kSecRandomDefault, randomBytes.size.toULong(), it.addressOf(0))
    }
    if (randomStatus != errSecSuccess) {
        throw CaptchaUnavailableException("secure_random_unavailable")
    }
    val channel = randomBytes.joinToString("") { byte ->
        (byte.toInt() and 0xff).toString(16).padStart(2, '0')
    }
    val challengeUrl = buildHostedCaptchaChallengeUrl(baseUrl, action, channel, "webkit")
    return try {
      withTimeout(30_000L) {
       withContext(Dispatchers.Main) {
        suspendCancellableCoroutine { cont ->
        var resumed = false
        val userContentController = WKUserContentController()
        lateinit var webView: WKWebView
        val expected = NSURL(string = challengeUrl)

        fun cleanup() {
            userContentController.removeScriptMessageHandlerForName("edgebaseCaptcha")
            webView.stopLoading()
            webView.removeFromSuperview()
        }

        fun finish(token: String) {
            if (!resumed) {
                resumed = true
                cleanup()
                if (cont.isActive) cont.resume(token)
            }
        }

        fun fail(reason: String) {
            if (!resumed) {
                resumed = true
                cleanup()
                if (cont.isActive) {
                    cont.resumeWithException(CaptchaUnavailableException(reason))
                }
            }
        }

        val messageHandler = object : NSObject(),
            WKScriptMessageHandlerProtocol,
            WKNavigationDelegateProtocol {
            override fun userContentController(
                userContentController: WKUserContentController,
                didReceiveScriptMessage: WKScriptMessage
            ) {
                if (resumed) return
                if (didReceiveScriptMessage.name != "edgebaseCaptcha") return
                if (!didReceiveScriptMessage.frameInfo.mainFrame) {
                    fail("origin_frame_mismatch")
                    return
                }
                val origin = didReceiveScriptMessage.frameInfo.securityOrigin
                if (!origin.protocol.equals(expected.scheme, ignoreCase = true) ||
                    !origin.host.equals(expected.host, ignoreCase = true) ||
                    origin.port != (expected.port?.longValue ?: 0L)) {
                    fail("origin_mismatch")
                    return
                }
                val body = didReceiveScriptMessage.body as? String ?: return
                val message = parseHostedCaptchaMessage(body, channel) ?: return
                when (message.type) {
                    "token" -> finish(message.value)
                    "error" -> fail(captchaBridgeFailureReason(message.value))
                    "interactive" -> when (message.value) {
                        "show" -> if (!attachCaptchaOverlay(webView)) fail("activity_unavailable")
                        "hide" -> webView.removeFromSuperview()
                    }
                }
            }

            override fun webView(
                webView: WKWebView,
                decidePolicyForNavigationAction: WKNavigationAction,
                decisionHandler: (platform.WebKit.WKNavigationActionPolicy) -> Unit
            ) {
                val mainFrame = decidePolicyForNavigationAction.targetFrame?.mainFrame != false
                val next = decidePolicyForNavigationAction.request.URL?.absoluteString
                if (mainFrame && next != challengeUrl) {
                    decisionHandler(WKNavigationActionPolicy.WKNavigationActionPolicyCancel)
                    fail("unexpected_navigation")
                } else {
                    decisionHandler(WKNavigationActionPolicy.WKNavigationActionPolicyAllow)
                }
            }

            override fun webView(
                webView: WKWebView,
                decidePolicyForNavigationResponse: WKNavigationResponse,
                decisionHandler: (platform.WebKit.WKNavigationResponsePolicy) -> Unit
            ) {
                val response = decidePolicyForNavigationResponse.response as? platform.Foundation.NSHTTPURLResponse
                if (decidePolicyForNavigationResponse.forMainFrame &&
                    response != null && response.statusCode !in 200L..299L) {
                    decisionHandler(WKNavigationResponsePolicy.WKNavigationResponsePolicyCancel)
                    fail("challenge_http_${response.statusCode}")
                } else {
                    decisionHandler(WKNavigationResponsePolicy.WKNavigationResponsePolicyAllow)
                }
            }

            @ObjCSignatureOverride
            override fun webView(
                webView: WKWebView,
                didFailProvisionalNavigation: WKNavigation?,
                withError: NSError
            ) = fail("challenge_load_failed")

            @ObjCSignatureOverride
            override fun webView(
                webView: WKWebView,
                didFailNavigation: WKNavigation?,
                withError: NSError
            ) = fail("challenge_load_failed")

            override fun webViewWebContentProcessDidTerminate(webView: WKWebView) =
                fail("renderer_terminated")
        }

        userContentController.addScriptMessageHandler(messageHandler, name = "edgebaseCaptcha")

        val config = WKWebViewConfiguration().apply {
            this.userContentController = userContentController
            websiteDataStore = WKWebsiteDataStore.defaultDataStore()
        }

        webView = WKWebView(frame = CGRectMake(0.0, 0.0, 1.0, 1.0), configuration = config)
        webView.navigationDelegate = messageHandler
        val url = NSURL(string = challengeUrl)
        webView.loadRequest(NSURLRequest.requestWithURL(url))

        cont.invokeOnCancellation {
            CoroutineScope(Dispatchers.Main).launch {
              if (!resumed) {
                  resumed = true
                  cleanup()
              }
            }
        }
        }
       }
      }
    } catch (timeout: TimeoutCancellationException) {
        throw CaptchaUnavailableException("timeout", timeout)
    }
}

private fun captchaBridgeFailureReason(value: String): String {
    val normalized = value.lowercase()
        .map { if (it.isLetterOrDigit() || it == '_' || it == '-') it else '_' }
        .joinToString("")
        .take(128)
    return if (normalized.isBlank()) "challenge_error" else "challenge_$normalized"
}
