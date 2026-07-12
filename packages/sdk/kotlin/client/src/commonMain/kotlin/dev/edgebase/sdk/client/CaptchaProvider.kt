// EdgeBase Kotlin SDK — Captcha provider (KMP expect/actual).
//
// Auto-captcha across all platforms via Cloudflare Turnstile.
//: Auto-captcha across all platforms.

package dev.edgebase.sdk.client

import dev.edgebase.sdk.core.HttpClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.time.Duration
import kotlin.time.Duration.Companion.minutes
import kotlin.time.TimeMark
import kotlin.time.TimeSource

internal val captchaSiteKeyCacheTtl: Duration = 5.minutes
internal data class CachedCaptchaSiteKey(val value: String, val cachedAt: TimeMark)
private val siteKeyCache: MutableMap<String, CachedCaptchaSiteKey> = mutableMapOf()
private val siteKeyCacheMutex = Mutex()
private val captchaActions = setOf(
    "signup", "signin", "anonymous", "magic-link", "phone",
    "password-reset", "oauth", "function"
)
private val captchaBridges = setOf("rn", "webkit", "android", "flutter", "vuplex", "unity", "uri")

internal fun cachedCaptchaSiteKeyIfFresh(
    entry: CachedCaptchaSiteKey,
    ttl: Duration = captchaSiteKeyCacheTtl
): String? = if (isCaptchaSiteKeyCacheFresh(entry.cachedAt.elapsedNow(), ttl)) entry.value else null

internal fun isCaptchaSiteKeyCacheFresh(
    age: Duration,
    ttl: Duration = captchaSiteKeyCacheTtl
): Boolean = age >= Duration.ZERO && age < ttl

internal fun shouldRetryCaptchaWithFreshSiteKey(
    usesDirectSiteKey: Boolean,
    reason: String
): Boolean = usesDirectSiteKey && reason == "challenge_error"

internal fun buildHostedCaptchaChallengeUrl(
    baseUrl: String,
    action: String,
    channel: String,
    bridge: String
): String {
    val trimmed = baseUrl.trim()
    require(trimmed.startsWith("https://", ignoreCase = true))
    val afterScheme = trimmed.substring(8)
    val authority = afterScheme.substringBefore('/')
    val path = afterScheme.substringAfter('/', missingDelimiterValue = "")
    require(authority.isNotBlank() && '@' !in authority && '?' !in trimmed && '#' !in trimmed)
    require(path.isEmpty())
    require(action in captchaActions)
    require(channel.matches(Regex("^[A-Za-z0-9_-]{22,64}$")))
    require(bridge in captchaBridges)
    return trimmed.trimEnd('/') + "/api/captcha/challenge" +
        "?action=$action&channel=$channel&bridge=$bridge"
}

internal data class CaptchaBridgeMessage(val type: String, val value: String)

/**
 * Raised when CAPTCHA is configured but the client runtime cannot obtain a
 * token. Callers can distinguish this local availability failure from a
 * server-side auth rejection by checking [code] and [reason].
 */
class CaptchaUnavailableException(
    val reason: String,
    cause: Throwable? = null
) : Exception("CAPTCHA unavailable: $reason", cause) {
    val code: String = "captcha-unavailable"
}

internal fun parseHostedCaptchaMessage(raw: String, expectedChannel: String): CaptchaBridgeMessage? {
    if (raw.encodeToByteArray().size > 4096) return null
    return try {
        val payload = Json.parseToJsonElement(raw).jsonObject
        if (payload["v"]?.jsonPrimitive?.intOrNull != 1 ||
            payload["channel"]?.jsonPrimitive?.contentOrNull != expectedChannel) return null
        val type = payload["type"]?.jsonPrimitive?.contentOrNull ?: return null
        val value = payload["value"]?.jsonPrimitive?.contentOrNull ?: return null
        when {
            type == "token" && value.isNotEmpty() && value.length <= 2048 ->
                CaptchaBridgeMessage(type, value)
            type == "error" -> CaptchaBridgeMessage(type, value.take(256))
            type == "interactive" && value in setOf("show", "hide") ->
                CaptchaBridgeMessage(type, value)
            type == "ready" && value.length <= 32 -> CaptchaBridgeMessage(type, value)
            else -> null
        }
    } catch (_: Exception) {
        null
    }
}

/**
 * Fetch the Turnstile site key from the server config endpoint.
 * Caches a positive result for five minutes so hostname/site-key rotation is
 * picked up by long-running clients without a network request on every call.
 */
suspend fun fetchSiteKey(client: HttpClient): String? {
    val cachedSiteKey = siteKeyCacheMutex.withLock {
        val cached = siteKeyCache[client.baseUrl] ?: return@withLock null
        cachedCaptchaSiteKeyIfFresh(cached).also { fresh ->
            if (fresh == null) siteKeyCache.remove(client.baseUrl)
        }
    }
    if (cachedSiteKey != null) return cachedSiteKey
    return try {
        @Suppress("UNCHECKED_CAST")
        val config = client.getPublic("/config") as? Map<String, Any?>
            ?: throw CaptchaUnavailableException("config_invalid_response")
        if (!config.containsKey("captcha")) {
            throw CaptchaUnavailableException("config_invalid_response")
        }
        val captchaValue = config["captcha"] ?: return null
        @Suppress("UNCHECKED_CAST")
        val captcha = captchaValue as? Map<String, Any?>
            ?: throw CaptchaUnavailableException("config_invalid_response")
        val siteKeyValue = captcha["siteKey"]
            ?: throw CaptchaUnavailableException("config_invalid_response")
        val key = (siteKeyValue as? String)?.takeIf {
            it.isNotBlank() && it.encodeToByteArray().size <= 512
        }
            ?: throw CaptchaUnavailableException("config_invalid_response")
        siteKeyCacheMutex.withLock {
            siteKeyCache[client.baseUrl] = CachedCaptchaSiteKey(
                value = key,
                cachedAt = TimeSource.Monotonic.markNow()
            )
        }
        key
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (error: CaptchaUnavailableException) {
        throw error
    } catch (error: IllegalStateException) {
        val reason = if (error.message == "Invalid JSON response body") {
            "config_invalid_response"
        } else {
            "config_fetch_failed"
        }
        throw CaptchaUnavailableException(reason, error)
    } catch (error: Exception) {
        throw CaptchaUnavailableException("config_fetch_failed", error)
    }
}

private suspend fun invalidateCachedSiteKey(baseUrl: String) {
    siteKeyCacheMutex.withLock { siteKeyCache.remove(baseUrl) }
}

/**
 * Platform-specific Turnstile token acquisition.
 *
 * | Platform | Implementation |
 * |----------|---------------|
 * | Android  | Headless WebView with Turnstile JS |
 * | Apple    | WKWebView with Turnstile JS |
 * | JS       | Direct Turnstile script in browser DOM |
 * | JVM      | No-op (server-side, captcha not applicable) |
 */
expect suspend fun acquireCaptchaToken(baseUrl: String, siteKey: String, action: String): String?
internal expect val usesDirectCaptchaSiteKey: Boolean

internal suspend fun acquireCaptchaWithSingleSiteKeyRetry(
    initialSiteKey: String,
    directSiteKey: Boolean,
    acquire: suspend (String) -> String,
    refreshSiteKey: suspend () -> String?
): String? {
    return try {
        acquire(initialSiteKey)
    } catch (error: CaptchaUnavailableException) {
        if (!shouldRetryCaptchaWithFreshSiteKey(directSiteKey, error.reason)) throw error
        val refreshedSiteKey = refreshSiteKey() ?: return null
        acquire(refreshedSiteKey)
    }
}

/**
 * Resolve a captcha token for the given action.
 *
 * If [manualToken] is provided, returns it immediately.
 * Otherwise, fetches the site key and acquires a token via the platform provider.
 */
suspend fun resolveCaptchaToken(client: HttpClient, action: String, manualToken: String? = null): String? {
    if (manualToken != null) return manualToken
    val siteKey = fetchSiteKey(client) ?: return null
    suspend fun acquireRequired(key: String): String {
        return try {
            acquireCaptchaToken(client.baseUrl, key, action)
                ?: throw CaptchaUnavailableException("token_not_returned")
        } catch (error: CaptchaUnavailableException) {
            throw error
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            throw CaptchaUnavailableException("acquisition_failed", error)
        }
    }
    return acquireCaptchaWithSingleSiteKeyRetry(
        initialSiteKey = siteKey,
        directSiteKey = usesDirectCaptchaSiteKey,
        acquire = ::acquireRequired,
        refreshSiteKey = {
            invalidateCachedSiteKey(client.baseUrl)
            fetchSiteKey(client)
        }
    )
}
