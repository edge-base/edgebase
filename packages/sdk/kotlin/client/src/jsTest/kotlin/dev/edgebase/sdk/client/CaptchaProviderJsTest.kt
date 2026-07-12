package dev.edgebase.sdk.client

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class CaptchaProviderJsTest {
    @Test
    fun concurrent_requests_receive_distinct_dom_ids() {
        val first = nextCaptchaDomIds()
        val second = nextCaptchaDomIds()
        assertNotEquals(first.overlay, second.overlay)
        assertNotEquals(first.container, second.container)
    }

    @Test
    fun cancelled_waiter_is_not_invoked_by_delayed_script_load() {
        var invoked = false
        val unregister = registerTurnstileScriptWaiter(
            onReady = { invoked = true },
            onError = { invoked = true }
        )
        assertEquals(1, pendingTurnstileScriptWaiters())

        unregister()
        settleTurnstileScriptReadyForTest()

        assertFalse(invoked)
        assertEquals(0, pendingTurnstileScriptWaiters())
    }

    @Test
    fun shared_script_error_settles_all_concurrent_waiters_once() {
        val reasons = mutableListOf<String>()
        registerTurnstileScriptWaiter({}, reasons::add)
        registerTurnstileScriptWaiter({}, reasons::add)

        settleTurnstileScriptErrorForTest("script_load_failed")
        settleTurnstileScriptErrorForTest("late_duplicate")

        assertEquals(listOf("script_load_failed", "script_load_failed"), reasons)
        assertEquals(0, pendingTurnstileScriptWaiters())
    }

    @Test
    fun inert_host_script_times_out_without_removal_and_next_owned_attempt_is_not_poisoned() {
        val browserWindow = js("window")
        val hadTurnstile = js("Object.prototype.hasOwnProperty.call(window, 'turnstile')")
            .unsafeCast<Boolean>()
        val originalTurnstile = browserWindow.turnstile
        js("delete window.turnstile")
        val hostScript = js("document.createElement('script')")
        hostScript.id = "edgebase-turnstile-script"
        js("document.head.appendChild")(hostScript)

        try {
            val firstReasons = mutableListOf<String>()
            loadTurnstileScript({}, firstReasons::add)
            assertTrue(turnstileScriptLoadingForTest())

            expireTurnstileScriptLoadForTest()

            assertEquals(listOf("script_load_timeout"), firstReasons)
            assertFalse(turnstileScriptLoadingForTest())
            assertEquals(0, pendingTurnstileScriptWaiters())
            assertTrue(hostScript.isConnected.unsafeCast<Boolean>())
            assertEquals("true", hostScript.getAttribute("data-edgebase-unusable"))

            // A retry bypasses the inert host-owned element and creates an
            // SDK-owned attempt. Only that owned element is removed on error.
            val secondReasons = mutableListOf<String>()
            loadTurnstileScript({}, secondReasons::add)
            val ownedScript = js("document.querySelector('script[data-edgebase-owned=true]')")
            assertTrue(ownedScript != null)
            ownedScript.dispatchEvent(js("new Event('error')"))

            assertEquals(listOf("script_load_failed"), secondReasons)
            assertFalse(turnstileScriptLoadingForTest())
            assertTrue(hostScript.isConnected.unsafeCast<Boolean>())
            assertFalse(ownedScript.isConnected.unsafeCast<Boolean>())
        } finally {
            try { hostScript.remove() } catch (_: Throwable) {}
            if (hadTurnstile) browserWindow.turnstile = originalTurnstile
            else js("delete window.turnstile")
        }
    }

    @Test
    fun loaded_host_script_without_global_settles_and_detaches_listeners() {
        val browserWindow = js("window")
        val hadTurnstile = js("Object.prototype.hasOwnProperty.call(window, 'turnstile')")
            .unsafeCast<Boolean>()
        val originalTurnstile = browserWindow.turnstile
        js("delete window.turnstile")
        val hostScript = js("document.createElement('script')")
        hostScript.id = "edgebase-turnstile-script"
        js("document.head.appendChild")(hostScript)

        try {
            val reasons = mutableListOf<String>()
            loadTurnstileScript({}, reasons::add)
            hostScript.dispatchEvent(js("new Event('load')"))
            hostScript.dispatchEvent(js("new Event('error')"))

            assertEquals(listOf("script_global_missing"), reasons)
            assertFalse(turnstileScriptLoadingForTest())
            assertEquals(0, pendingTurnstileScriptWaiters())
            assertTrue(hostScript.isConnected.unsafeCast<Boolean>())
            assertEquals("true", hostScript.getAttribute("data-edgebase-unusable"))
        } finally {
            try { hostScript.remove() } catch (_: Throwable) {}
            if (hadTurnstile) browserWindow.turnstile = originalTurnstile
            else js("delete window.turnstile")
        }
    }

    @Test
    fun direct_site_key_challenge_failure_retries_once_and_cleans_each_dom_request() = runTest {
        val browserWindow = js("window")
        val hadTurnstile = js("Object.prototype.hasOwnProperty.call(window, 'turnstile')")
            .unsafeCast<Boolean>()
        val originalTurnstile = browserWindow.turnstile
        val turnstile = js(
            """({
                renderCount: 0,
                removeCount: 0,
                render: function(container, options) {
                    this.renderCount += 1;
                    var widgetId = 'widget-' + this.renderCount;
                    globalThis.setTimeout(function() {
                        options['error-callback']('invalid-sitekey');
                    }, 0);
                    return widgetId;
                },
                remove: function(widgetId) {
                    this.removeCount += 1;
                }
            })"""
        )
        browserWindow.turnstile = turnstile

        try {
            var refreshCount = 0
            val failure = try {
                acquireCaptchaWithSingleSiteKeyRetry(
                    initialSiteKey = "site-key-v1",
                    directSiteKey = true,
                    acquire = { siteKey ->
                        acquireCaptchaToken(
                            "https://api.example.test",
                            siteKey,
                            "signin"
                        ) ?: error("token required")
                    },
                    refreshSiteKey = {
                        refreshCount += 1
                        "site-key-v2"
                    }
                )
                null
            } catch (error: CaptchaUnavailableException) {
                error
            }

            assertEquals("challenge_error", failure?.reason)
            assertEquals(1, refreshCount)
            assertEquals(2, turnstile.renderCount.unsafeCast<Int>())
            assertEquals(2, turnstile.removeCount.unsafeCast<Int>())
            assertEquals(
                0,
                js("document.querySelectorAll('[id^=edgebase-captcha-overlay-]').length")
                    .unsafeCast<Int>()
            )
            assertEquals(0, pendingTurnstileScriptWaiters())
        } finally {
            if (hadTurnstile) {
                browserWindow.turnstile = originalTurnstile
            } else {
                js("delete window.turnstile")
            }
        }
    }

    @Test
    fun site_key_retry_policy_excludes_hosted_and_non_challenge_failures() {
        assertTrue(shouldRetryCaptchaWithFreshSiteKey(true, "challenge_error"))
        assertFalse(shouldRetryCaptchaWithFreshSiteKey(false, "challenge_error"))
        assertFalse(shouldRetryCaptchaWithFreshSiteKey(true, "timeout"))
        assertFalse(shouldRetryCaptchaWithFreshSiteKey(true, "render_failed"))
    }
}
