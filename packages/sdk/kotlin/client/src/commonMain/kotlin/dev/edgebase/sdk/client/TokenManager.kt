// EdgeBase Kotlin SDK — Token management (KMP).
//
// Thread-safe token storage and refresh with 30-second buffer preemptive refresh.
//: java.util.Base64/System.currentTimeMillis → platform functions.

package dev.edgebase.sdk.client

import dev.edgebase.sdk.core.*

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.*

/**
 * Token pair — access + refresh tokens.
 */
data class TokenPair(
    val accessToken: String,
    val refreshToken: String
)

/**
 * Token storage interface — allows DI of platform-specific storage.
 *
 * Android: EncryptedSharedPreferences
 * iOS: Keychain
 * JS: localStorage
 * JVM: java.util.prefs.Preferences
 */
interface TokenStorage {
    suspend fun getTokens(): TokenPair?
    suspend fun saveTokens(pair: TokenPair)
    suspend fun clearTokens()
}

/**
 * In-memory token storage for testing / default usage.
 */
class MemoryTokenStorage : TokenStorage {
    private var tokens: TokenPair? = null

    override suspend fun getTokens(): TokenPair? = tokens
    override suspend fun saveTokens(pair: TokenPair) { tokens = pair }
    override suspend fun clearTokens() { tokens = null }
}

/**
 * No-op token storage for server-side SDK.
 * Server authenticates via Service Key only — no JWT tokens needed.
 */
class NoOpTokenStorage : TokenStorage {
    override suspend fun getTokens(): TokenPair? = null
    override suspend fun saveTokens(pair: TokenPair) { /* no-op */ }
    override suspend fun clearTokens() { /* no-op */ }
}

/**
 * Create platform-specific default token storage.
 *
 * | Platform | Storage |
 * |----------|---------|
 * | Android  | MemoryTokenStorage (inject SharedPreferences via DI) |
 * | iOS/macOS| KeychainTokenStorage (Security.framework) |
 * | JS       | LocalStorageTokenStorage (window.localStorage) |
 * | JVM      | PreferencesTokenStorage (java.util.prefs.Preferences) |
 */
expect fun createDefaultTokenStorage(): TokenStorage

/**
 * Convenience factory for a server-side token manager (always returns null tokens).
 * Use with [HttpClient] when the client uses Service Key authentication.
 */
fun NoOpTokenManager(): ClientTokenManager = ClientTokenManager(NoOpTokenStorage())

/**
 * Token manager — handles token lifecycle with thread-safe refresh.
 *
 * Features:
 * - 30-second buffer preemptive refresh
 * - Concurrent refresh deduplication via Mutex
 * - Persistent storage via [TokenStorage]
 */
class ClientTokenManager(private val storage: TokenStorage) : TokenManager {
    private val mutex = Mutex()
    private var currentTokens: TokenPair? = null
    private var refreshCallback: (suspend (String) -> TokenPair)? = null
    private val authStateListeners = mutableListOf<(Map<String, Any?>?) -> Unit>()
    private val json = Json { ignoreUnknownKeys = true }

    companion object {
        private const val REFRESH_BUFFER_SECONDS = 30

        /**
         * Decode JWT payload without verification (client-side only).
         */
        @Suppress("UNCHECKED_CAST")
        fun decodeJwtPayload(token: String): Map<String, Any?>? {
            return try {
                val parts = token.split(".")
                if (parts.size < 2) return null
                val payload = parts[1]
                val decoded = platformBase64UrlDecode(payload)
                val jsonStr = decoded.decodeToString()
                val jsonInstance = Json { ignoreUnknownKeys = true }
                val element = jsonInstance.parseToJsonElement(jsonStr)
                val obj = element as? JsonObject ?: return null
                val decodedMap = obj.entries.associate { (k, v) -> k to jsonElementToAny(v) }.toMutableMap()
                if (!decodedMap.containsKey("id")) {
                    decodedMap["id"] = decodedMap["sub"] ?: decodedMap["userId"]
                }
                if (!decodedMap.containsKey("customClaims") && decodedMap["custom"] is Map<*, *>) {
                    decodedMap["customClaims"] = decodedMap["custom"]
                }
                decodedMap
            } catch (_: Exception) {
                null
            }
        }

        private fun jsonElementToAny(element: JsonElement): Any? {
            return when (element) {
                is JsonObject -> element.entries.associate { (k, v) -> k to jsonElementToAny(v) }
                is JsonArray -> element.map { jsonElementToAny(it) }
                is JsonPrimitive -> when {
                    element.isString -> element.content
                    element.booleanOrNull != null -> element.boolean
                    element.longOrNull != null -> element.long
                    element.doubleOrNull != null -> element.double
                    else -> element.content
                }
            }
        }
    }

    /**
     * Set the callback used to refresh tokens.
     */
    fun setRefreshCallback(callback: suspend (String) -> TokenPair) {
        refreshCallback = callback
    }

    /**
     * Set auth state change listener.
     */
    fun setOnAuthStateChange(listener: (Map<String, Any?>?) -> Unit) {
        authStateListeners += listener
    }

    /**
     * Store tokens and persist to storage.
     */
    suspend fun setTokens(pair: TokenPair) {
        mutex.withLock {
            currentTokens = pair
            storage.saveTokens(pair)
        }
        notifyAuthStateChange(decodeJwtPayload(pair.accessToken))
    }

    // TokenManager interface
    override suspend fun setTokens(access: String, refresh: String) {
        setTokens(TokenPair(access, refresh))
    }

    /**
     * Get a valid access token, refreshing if needed.
     */
    override suspend fun getAccessToken(): String? {
        mutex.withLock {
            val tokens = currentTokens ?: return null

            // Check if token needs refresh (30s buffer)
            if (isTokenExpiringSoon(tokens.accessToken)) {
                val callback = refreshCallback ?: return tokens.accessToken
                return try {
                    val newTokens = callback(tokens.refreshToken)
                    currentTokens = newTokens
                    storage.saveTokens(newTokens)
                    notifyAuthStateChange(decodeJwtPayload(newTokens.accessToken))
                    newTokens.accessToken
                } catch (e: Exception) {
                    // 401 means token revoked/expired — clear session (matches JS SDK).
                    // Other errors (network, 5xx) keep session for retry.
                    if (e is EdgeBaseError && e.statusCode == 401) {
                        currentTokens = null
                        storage.clearTokens()
                        notifyAuthStateChange(null)
                        null
                    } else {
                        tokens.accessToken
                    }
                }
            }
            return tokens.accessToken
        }
    }

    /**
     * Get current refresh token.
     */
    override suspend fun getRefreshToken(): String? = mutex.withLock { currentTokens?.refreshToken }

    /**
     * Get current user from cached access token (decoded JWT payload).
     */
    fun currentUser(): Map<String, Any?>? {
        val token = currentTokens?.accessToken ?: return null
        return decodeJwtPayload(token)
    }

    /**
     * Clear all tokens.
     */
    override suspend fun clearTokens() {
        mutex.withLock {
            currentTokens = null
            storage.clearTokens()
        }
        notifyAuthStateChange(null)
    }

    /**
     * Try to restore session from persistent storage.
     */
    suspend fun tryRestoreSession(): Boolean {
        mutex.withLock {
            val stored = storage.getTokens() ?: return false
            currentTokens = stored
            return true
        }
    }

    /**
     * Clean up resources.
     */
    suspend fun destroy() {
        clearTokens()
        refreshCallback = null
        authStateListeners.clear()
    }

    private fun notifyAuthStateChange(user: Map<String, Any?>?) {
        for (listener in authStateListeners.toList()) {
            listener(user)
        }
    }

    /**
     * Check if JWT token is expiring within buffer period.
     */
    private fun isTokenExpiringSoon(token: String): Boolean {
        return try {
            val payload = decodeJwtPayload(token) ?: return false
            val exp = (payload["exp"] as? Number)?.toLong() ?: return false
            val now = currentTimeMillis() / 1000
            exp - now < REFRESH_BUFFER_SECONDS
        } catch (_: Exception) {
            false
        }
    }
}
