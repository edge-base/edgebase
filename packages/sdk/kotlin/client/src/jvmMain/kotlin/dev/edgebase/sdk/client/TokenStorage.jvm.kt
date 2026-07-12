// EdgeBase Kotlin SDK — JVM/Desktop Preferences token storage.
//
// Uses java.util.prefs.Preferences for persistent token storage on JVM.
//: Refresh tokens in platform storage (Preferences for Desktop).

package dev.edgebase.sdk.client

import java.util.prefs.Preferences
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

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
) : DurableTokenStorage {

    private val prefs: Preferences = Preferences.userRoot().node(nodeName)
    private val pairKey = "token_pair"
    private val accessKey = "access_token"
    private val refreshKey = "refresh_token"

    override suspend fun getTokens(): TokenPair? {
        val encoded = prefs.get(pairKey, null)
        if (encoded != null) {
            val value = Json.parseToJsonElement(encoded).jsonObject
            return TokenPair(
                value.getValue("accessToken").jsonPrimitive.content,
                value.getValue("refreshToken").jsonPrimitive.content,
            )
        }
        val access = prefs.get(accessKey, null) ?: return null
        val refresh = prefs.get(refreshKey, null) ?: return null
        return TokenPair(accessToken = access, refreshToken = refresh).also { saveTokens(it) }
    }

    override suspend fun saveTokens(pair: TokenPair) {
        prefs.put(pairKey, buildJsonObject {
            put("accessToken", pair.accessToken)
            put("refreshToken", pair.refreshToken)
        }.toString())
        prefs.remove(accessKey)
        prefs.remove(refreshKey)
        prefs.flush()
    }

    override suspend fun clearTokens() {
        prefs.remove(pairKey)
        prefs.remove(accessKey)
        prefs.remove(refreshKey)
        prefs.flush()
    }
}
