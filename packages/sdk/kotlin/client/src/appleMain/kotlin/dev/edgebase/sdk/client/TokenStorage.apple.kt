// EdgeBase Kotlin SDK — Apple (iOS/macOS) persistent token storage.
//
// Uses NSUserDefaults for reliable cross-platform (iOS + macOS) persistence.
// For production apps requiring Keychain-level security, inject a custom
// KeychainTokenStorage via ClientEdgeBase(url, tokenStorage = myKeychainStorage).
//: Refresh tokens in platform-secure storage.

@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)

package dev.edgebase.sdk.client

import platform.Foundation.NSUserDefaults

actual fun createDefaultTokenStorage(): TokenStorage = UserDefaultsTokenStorage()

/**
 * NSUserDefaults-based token storage for iOS and macOS.
 *
 * Provides persistent token storage across app launches.
 * Uses a suite name to isolate EdgeBase tokens from other app defaults.
 *
 * For higher security (Keychain), inject a custom TokenStorage:
 * ```kotlin
 * val client = ClientEdgeBase(url, tokenStorage = myKeychainStorage)
 * ```
 */
class UserDefaultsTokenStorage(
    suiteName: String = "dev.edgebase.sdk.tokens"
) : TokenStorage {

    private val defaults: NSUserDefaults = NSUserDefaults(suiteName = suiteName)
    private val accessKey = "edgebase_access_token"
    private val refreshKey = "edgebase_refresh_token"

    override suspend fun getTokens(): TokenPair? {
        val access = defaults.stringForKey(accessKey) ?: return null
        val refresh = defaults.stringForKey(refreshKey) ?: return null
        return TokenPair(accessToken = access, refreshToken = refresh)
    }

    override suspend fun saveTokens(pair: TokenPair) {
        defaults.setObject(pair.accessToken, forKey = accessKey)
        defaults.setObject(pair.refreshToken, forKey = refreshKey)
        defaults.synchronize()
    }

    override suspend fun clearTokens() {
        defaults.removeObjectForKey(accessKey)
        defaults.removeObjectForKey(refreshKey)
        defaults.synchronize()
    }
}
