// EdgeBase Kotlin SDK — JS/Browser localStorage token storage.
//
// Uses window.localStorage for persistent token storage in browsers.
//: Refresh tokens in platform storage (localStorage for web).

package dev.edgebase.sdk.client

import kotlinx.browser.window

actual fun createDefaultTokenStorage(): TokenStorage = LocalStorageTokenStorage()

/**
 * localStorage-based token storage for web browsers.
 *
 * Keys:
 * - "edgebase_access_token"
 * - "edgebase_refresh_token"
 */
class LocalStorageTokenStorage(
    private val prefix: String = "edgebase_"
) : TokenStorage {

    private val accessKey get() = "${prefix}access_token"
    private val refreshKey get() = "${prefix}refresh_token"

    override suspend fun getTokens(): TokenPair? {
        return try {
            val access = window.localStorage.getItem(accessKey) ?: return null
            val refresh = window.localStorage.getItem(refreshKey) ?: return null
            TokenPair(accessToken = access, refreshToken = refresh)
        } catch (_: Throwable) {
            null
        }
    }

    override suspend fun saveTokens(pair: TokenPair) {
        try {
            window.localStorage.setItem(accessKey, pair.accessToken)
            window.localStorage.setItem(refreshKey, pair.refreshToken)
        } catch (_: Throwable) {
            // localStorage may be unavailable (private browsing, quota exceeded)
        }
    }

    override suspend fun clearTokens() {
        try {
            window.localStorage.removeItem(accessKey)
            window.localStorage.removeItem(refreshKey)
        } catch (_: Throwable) {
            // Ignore errors during cleanup
        }
    }
}
