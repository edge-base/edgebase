// EdgeBase Kotlin SDK — JS/Browser captcha provider (Turnstile via DOM).

package dev.edgebase.sdk.client

import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal actual val usesDirectCaptchaSiteKey: Boolean = true

private var captchaRequestSequence = 0
private var turnstileScriptLoading = false
private var turnstileScriptLoadGeneration = 0
private var turnstileScriptDeadlineHandle: dynamic = null
private var turnstileScriptDeadlineCallback: (() -> Unit)? = null
private val turnstileReadyCallbacks = mutableListOf<() -> Unit>()
private val turnstileErrorCallbacks = mutableListOf<(String) -> Unit>()

private const val TURNSTILE_SCRIPT_ID = "edgebase-turnstile-script"
private const val TURNSTILE_SCRIPT_OWNED_ATTRIBUTE = "data-edgebase-owned"
private const val TURNSTILE_SCRIPT_UNUSABLE_ATTRIBUTE = "data-edgebase-unusable"
private const val TURNSTILE_SCRIPT_LOAD_TIMEOUT_MS = 10_000

internal data class CaptchaDomIds(val overlay: String, val container: String)

internal fun nextCaptchaDomIds(): CaptchaDomIds {
    captchaRequestSequence += 1
    return CaptchaDomIds(
        overlay = "edgebase-captcha-overlay-$captchaRequestSequence",
        container = "edgebase-captcha-widget-$captchaRequestSequence"
    )
}

internal fun registerTurnstileScriptWaiter(
    onReady: () -> Unit,
    onError: (String) -> Unit
): () -> Unit {
    turnstileReadyCallbacks += onReady
    turnstileErrorCallbacks += onError
    return {
        turnstileReadyCallbacks.remove(onReady)
        turnstileErrorCallbacks.remove(onError)
    }
}

internal fun pendingTurnstileScriptWaiters(): Int = turnstileReadyCallbacks.size
internal fun turnstileScriptLoadingForTest(): Boolean = turnstileScriptLoading
internal fun expireTurnstileScriptLoadForTest() {
    turnstileScriptDeadlineCallback?.invoke()
}

internal fun settleTurnstileScriptReadyForTest() {
    val callbacks = turnstileReadyCallbacks.toList()
    turnstileReadyCallbacks.clear()
    turnstileErrorCallbacks.clear()
    callbacks.forEach { it() }
}

internal fun settleTurnstileScriptErrorForTest(reason: String) {
    val callbacks = turnstileErrorCallbacks.toList()
    turnstileReadyCallbacks.clear()
    turnstileErrorCallbacks.clear()
    callbacks.forEach { it(reason) }
}

@Suppress("UNUSED_PARAMETER")
actual suspend fun acquireCaptchaToken(baseUrl: String, siteKey: String, action: String): String? {
    return suspendCancellableCoroutine { cont ->
        var resumed = false
        var timeoutId: dynamic = null
        var overlay: dynamic = null
        var widgetId: dynamic = null
        var unregisterScriptWaiter: (() -> Unit)? = null
        val domIds = nextCaptchaDomIds()

        fun cleanup() {
            if (timeoutId != null) js("window.clearTimeout")(timeoutId)
            unregisterScriptWaiter?.invoke()
            unregisterScriptWaiter = null
            try {
                if (widgetId != null && isTurnstileAvailable()) {
                    val turnstile = js("window.turnstile")
                    turnstile.remove(widgetId)
                }
            } catch (_: Throwable) {}
            try {
                if (overlay != null && overlay.parentNode != null) {
                    overlay.parentNode.removeChild(overlay)
                }
            } catch (_: Throwable) {}
            overlay = null
            widgetId = null
        }

        fun complete(token: String) {
            if (!resumed) {
                resumed = true
                cleanup()
                cont.resume(token)
            }
        }

        fun fail(reason: String) {
            if (!resumed) {
                resumed = true
                cleanup()
                cont.resumeWithException(CaptchaUnavailableException(reason))
            }
        }

        timeoutId = js("window.setTimeout")({ fail("timeout") }, 30_000)
        unregisterScriptWaiter = loadTurnstileScript(onReady = onReady@{
            if (resumed || !cont.isActive) return@onReady
            try {
                overlay = js("document.createElement('div')")
                overlay.id = domIds.overlay
                overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;z-index:999999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.1);"

                val container = js("document.createElement('div')")
                container.id = domIds.container
                overlay.appendChild(container)
                js("document.body.appendChild")(overlay)

                val options = js("({})")
                options.sitekey = siteKey
                options.action = action
                options.appearance = "interaction-only"
                options.callback = { token: String -> complete(token) }
                options["error-callback"] = { _: dynamic ->
                    fail("challenge_error")
                }
                options["before-interactive-callback"] = {
                    try {
                        if (overlay != null) overlay.style.background = "rgba(0,0,0,0.5)"
                    } catch (_: Throwable) {}
                }
                options["after-interactive-callback"] = {
                    try {
                        if (overlay != null) overlay.style.background = "rgba(0,0,0,0.1)"
                    } catch (_: Throwable) {}
                }
                options["timeout-callback"] = { fail("challenge_timeout") }

                val turnstile = js("window.turnstile")
                widgetId = turnstile.render(container, options)
                // A custom/preloaded Turnstile implementation can invoke an
                // error callback before render() returns its widget id. In that
                // case cleanup already ran, so remove the late id explicitly.
                if (resumed && widgetId != null && isTurnstileAvailable()) {
                    turnstile.remove(widgetId)
                    widgetId = null
                }
            } catch (_: Throwable) {
                fail("render_failed")
            }
        }, onError = { reason -> fail(reason) })

        cont.invokeOnCancellation {
            if (!resumed) {
                resumed = true
                cleanup()
            }
        }
    }
}

private fun isTurnstileAvailable(): Boolean =
    js("typeof window !== 'undefined' && typeof window.turnstile !== 'undefined'")
        .unsafeCast<Boolean>()

/** Load one shared Turnstile script and settle every concurrent waiter. */
internal fun loadTurnstileScript(onReady: () -> Unit, onError: (String) -> Unit): () -> Unit {
    if (isTurnstileAvailable()) {
        onReady()
        return {}
    }

    val unregister = registerTurnstileScriptWaiter(onReady, onError)
    if (turnstileScriptLoading) return unregister
    turnstileScriptLoading = true
    turnstileScriptLoadGeneration += 1
    val generation = turnstileScriptLoadGeneration
    var settled = false

    val existingScript = js("document.getElementById('edgebase-turnstile-script')")
    val existingIsUnusable = existingScript != null &&
        existingScript.getAttribute(TURNSTILE_SCRIPT_UNUSABLE_ATTRIBUTE) == "true"
    val script = if (existingScript != null && !existingIsUnusable) {
        existingScript
    } else {
        js("document.createElement('script')")
    }
    val created = script !== existingScript
    if (created) {
        script.id = if (existingScript == null) TURNSTILE_SCRIPT_ID
            else "$TURNSTILE_SCRIPT_ID-$generation"
        script.setAttribute(TURNSTILE_SCRIPT_OWNED_ATTRIBUTE, "true")
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        script.async = true
    }
    val owned = script.getAttribute(TURNSTILE_SCRIPT_OWNED_ATTRIBUTE) == "true"

    lateinit var loadListener: (dynamic) -> Unit
    lateinit var errorListener: (dynamic) -> Unit

    fun cleanupSharedLoad() {
        try { script.removeEventListener("load", loadListener) } catch (_: Throwable) {}
        try { script.removeEventListener("error", errorListener) } catch (_: Throwable) {}
        if (turnstileScriptDeadlineHandle != null) {
            js("window.clearTimeout")(turnstileScriptDeadlineHandle)
        }
        turnstileScriptDeadlineHandle = null
        turnstileScriptDeadlineCallback = null
    }

    fun markUnusableOrRemove() {
        try {
            if (owned) {
                if (script.parentNode != null) script.parentNode.removeChild(script)
            } else {
                script.setAttribute(TURNSTILE_SCRIPT_UNUSABLE_ATTRIBUTE, "true")
            }
        } catch (_: Throwable) {}
    }

    fun finishError(reason: String) {
        if (settled || generation != turnstileScriptLoadGeneration) return
        settled = true
        cleanupSharedLoad()
        markUnusableOrRemove()
        turnstileScriptLoading = false
        settleTurnstileScriptErrorForTest(reason)
    }

    fun finishReady() {
        if (settled || generation != turnstileScriptLoadGeneration) return
        if (!isTurnstileAvailable()) {
            finishError("script_global_missing")
            return
        }
        settled = true
        cleanupSharedLoad()
        turnstileScriptLoading = false
        settleTurnstileScriptReadyForTest()
    }

    loadListener = { _: dynamic -> finishReady() }
    errorListener = { _: dynamic -> finishError("script_load_failed") }
    script.addEventListener("load", loadListener)
    script.addEventListener("error", errorListener)
    turnstileScriptDeadlineCallback = { finishError("script_load_timeout") }
    turnstileScriptDeadlineHandle = js("window.setTimeout")(
        turnstileScriptDeadlineCallback,
        TURNSTILE_SCRIPT_LOAD_TIMEOUT_MS,
    )
    if (created) js("document.head.appendChild")(script)
    return unregister
}
