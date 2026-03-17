// EdgeBase Kotlin SDK — JVM/Desktop Preferences token storage.
//
// Uses java.util.prefs.Preferences for persistent token storage on JVM.
//: Refresh tokens in platform storage (Preferences for Desktop).

package dev.edgebase.sdk.client

import java.util.prefs.Preferences

actual fun createDefaultTokenStorage(): TokenStorage = PreferencesTokenStorage()

/**
 * java.util.prefs.Preferences-based token storage for JVM desktop.
 *
 * Storage location:
 * - macOS: ~/Library/Preferences/com.apple.java.util.prefs.plist (or similar)
 * - Linux: ~/.java/.userPrefs/
 * - Windows: Registry HKCU\Software\JavaSoft\Prefs
 */
class PreferencesTokenStorage(
    nodeName: String = "dev/edgebase/sdk"
) : TokenStorage {

    private val prefs: Preferences = Preferences.userRoot().node(nodeName)
    private val accessKey = "access_token"
    private val refreshKey = "refresh_token"

    override suspend fun getTokens(): TokenPair? {
        val access = prefs.get(accessKey, null) ?: return null
        val refresh = prefs.get(refreshKey, null) ?: return null
        return TokenPair(accessToken = access, refreshToken = refresh)
    }

    override suspend fun saveTokens(pair: TokenPair) {
        prefs.put(accessKey, pair.accessToken)
        prefs.put(refreshKey, pair.refreshToken)
        prefs.flush()
    }

    override suspend fun clearTokens() {
        prefs.remove(accessKey)
        prefs.remove(refreshKey)
        prefs.flush()
    }
}
