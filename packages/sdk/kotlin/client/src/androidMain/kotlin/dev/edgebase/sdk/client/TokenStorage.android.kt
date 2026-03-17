// EdgeBase Kotlin SDK — Android default token storage.
//
// Returns MemoryTokenStorage by default. Android requires Context for
// SharedPreferences/EncryptedSharedPreferences, so apps should inject their own
// TokenStorage via ClientEdgeBase(url, tokenStorage = myStorage).
//: DI pattern for platform-specific storage.

package dev.edgebase.sdk.client

actual fun createDefaultTokenStorage(): TokenStorage = MemoryTokenStorage()
