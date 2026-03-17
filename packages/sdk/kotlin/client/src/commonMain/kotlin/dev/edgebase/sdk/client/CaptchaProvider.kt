// EdgeBase Kotlin SDK — Captcha provider (KMP expect/actual).
//
// Auto-captcha across all platforms via Cloudflare Turnstile.
//: Auto-captcha across all platforms.

package dev.edgebase.sdk.client

import dev.edgebase.sdk.core.HttpClient

private val siteKeyCache: MutableMap<String, String> = mutableMapOf()

/**
 * Fetch the Turnstile site key from the server config endpoint.
 * Caches the result so subsequent calls avoid a network round-trip.
 */
suspend fun fetchSiteKey(client: HttpClient): String? {
    siteKeyCache[client.baseUrl]?.let { return it }
    return try {
        @Suppress("UNCHECKED_CAST")
        val config = client.getPublic("/config") as? Map<String, Any?> ?: return null
        @Suppress("UNCHECKED_CAST")
        val captcha = config["captcha"] as? Map<String, Any?> ?: return null
        val key = captcha["siteKey"] as? String
        if (key != null) {
            siteKeyCache[client.baseUrl] = key
        }
        key
    } catch (_: Exception) { null }
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
expect suspend fun acquireCaptchaToken(siteKey: String, action: String): String?

/**
 * Resolve a captcha token for the given action.
 *
 * If [manualToken] is provided, returns it immediately.
 * Otherwise, fetches the site key and acquires a token via the platform provider.
 */
suspend fun resolveCaptchaToken(client: HttpClient, action: String, manualToken: String? = null): String? {
    if (manualToken != null) return manualToken
    val siteKey = fetchSiteKey(client) ?: return null
    return try { acquireCaptchaToken(siteKey, action) } catch (_: Exception) { null }
}
