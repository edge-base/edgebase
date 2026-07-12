// EdgeBase Kotlin SDK — JS/Browser localStorage token storage.
//
// Uses window.localStorage for persistent token storage in browsers.
//: Refresh tokens in platform storage (localStorage for web).

package dev.edgebase.sdk.client

import kotlinx.browser.window
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

actual fun createDefaultTokenStorage(): TokenStorage = LocalStorageTokenStorage()

/**
 * localStorage-based token storage for web browsers.
 *
 * The pair is stored in one localStorage item so refresh rotation cannot leave
 * a mixed access/refresh pair. Legacy split keys are read once and migrated.
 */
class LocalStorageTokenStorage(
    private val prefix: String = "edgebase_"
) : DurableTokenStorage {

    private val pairKey get() = "${prefix}token_pair"
    private val accessKey get() = "${prefix}access_token"
    private val refreshKey get() = "${prefix}refresh_token"

    override suspend fun getTokens(): TokenPair? {
        val encoded = window.localStorage.getItem(pairKey)
        if (encoded != null) {
            val value = Json.parseToJsonElement(encoded).jsonObject
            return TokenPair(
                accessToken = value.getValue("accessToken").jsonPrimitive.content,
                refreshToken = value.getValue("refreshToken").jsonPrimitive.content,
            )
        }

        val access = window.localStorage.getItem(accessKey) ?: return null
        val refresh = window.localStorage.getItem(refreshKey) ?: return null
        return TokenPair(access, refresh).also { saveTokens(it) }
    }

    override suspend fun saveTokens(pair: TokenPair) {
        val encoded = buildJsonObject {
            put("accessToken", pair.accessToken)
            put("refreshToken", pair.refreshToken)
        }.toString()
        window.localStorage.setItem(pairKey, encoded)
        // The authoritative pair is already durable. Legacy cleanup is not part
        // of the transaction and must not turn a successful adoption into a
        // false failure.
        runCatching { window.localStorage.removeItem(accessKey) }
        runCatching { window.localStorage.removeItem(refreshKey) }
    }

    override suspend fun clearTokens() {
        window.localStorage.removeItem(pairKey)
        window.localStorage.removeItem(accessKey)
        window.localStorage.removeItem(refreshKey)
    }
}
