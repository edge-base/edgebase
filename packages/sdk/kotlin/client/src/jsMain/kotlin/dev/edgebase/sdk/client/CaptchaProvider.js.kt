// EdgeBase Kotlin SDK — JS/Browser captcha provider (Turnstile via DOM).
//
// Loads the Cloudflare Turnstile script directly into the browser document
// and renders the widget in an overlay div.
//: Auto-captcha across all platforms.

package dev.edgebase.sdk.client

import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.js.Promise

actual suspend fun acquireCaptchaToken(siteKey: String, action: String): String? {
    return suspendCancellableCoroutine { cont ->
        var resumed = false

        fun complete(token: String?) {
            if (!resumed) {
                resumed = true
                // Clean up overlay
                try {
                    val overlay = js("document.getElementById('edgebase-captcha-overlay')")
                    if (overlay != null) {
                        js("overlay.parentNode.removeChild(overlay)")
                    }
                } catch (_: Throwable) {}
                cont.resume(token)
            }
        }

        // Ensure Turnstile script is loaded
        loadTurnstileScript {
            try {
                // Create overlay container
                val overlay = js("document.createElement('div')")
                overlay.id = "edgebase-captcha-overlay"
                overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;z-index:999999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.1);"

                val container = js("document.createElement('div')")
                container.id = "edgebase-captcha-widget"
                overlay.appendChild(container)
                js("document.body.appendChild(overlay)")

                // Render Turnstile widget
                val options = js("({})")
                options.sitekey = siteKey
                options.action = action
                options.appearance = "interaction-only"
                options.callback = { token: String ->
                    complete(token)
                }
                js("options['error-callback'] = function(err) { }")
                options.asDynamic()["error-callback"] = { _: dynamic ->
                    complete(null)
                }
                js("options['before-interactive-callback'] = function() { }")
                options.asDynamic()["before-interactive-callback"] = {
                    // Show overlay for interactive challenge
                    try {
                        val ov = js("document.getElementById('edgebase-captcha-overlay')")
                        if (ov != null) {
                            ov.style.background = "rgba(0,0,0,0.5)"
                        }
                    } catch (_: Throwable) {}
                }
                js("options['after-interactive-callback'] = function() { }")
                options.asDynamic()["after-interactive-callback"] = {
                    // Hide overlay after interactive challenge
                    try {
                        val ov = js("document.getElementById('edgebase-captcha-overlay')")
                        if (ov != null) {
                            ov.style.background = "rgba(0,0,0,0.1)"
                        }
                    } catch (_: Throwable) {}
                }
                js("options['timeout-callback'] = function() { }")
                options.asDynamic()["timeout-callback"] = {
                    complete(null)
                }

                js("turnstile.render('#edgebase-captcha-widget', options)")
            } catch (_: Throwable) {
                complete(null)
            }
        }

        cont.invokeOnCancellation {
            complete(null)
        }
    }
}

/**
 * Load the Cloudflare Turnstile script into the document head if not already present.
 */
private fun loadTurnstileScript(onReady: () -> Unit) {
    // Check if turnstile is already available
    if (js("typeof turnstile !== 'undefined'").unsafeCast<Boolean>()) {
        onReady()
        return
    }

    // Check if script tag already exists
    val existingScript = js("document.getElementById('edgebase-turnstile-script')")
    if (existingScript != null) {
        // Script is loading, wait for it
        existingScript.addEventListener("load", { _: dynamic -> onReady() })
        return
    }

    // Create and append script element
    val script = js("document.createElement('script')")
    script.id = "edgebase-turnstile-script"
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js"
    script.async = true
    script.addEventListener("load", { _: dynamic -> onReady() })
    script.addEventListener("error", { _: dynamic ->
        // Script failed to load — callback with nothing
    })
    js("document.head.appendChild(script)")
}
