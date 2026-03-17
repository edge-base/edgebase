// EdgeBase Kotlin SDK — Platform push notification provider (KMP expect).
//
// Platform-specific push notification token acquisition, device info, and permissions.
///§9/§10, #130: KMP expect/actual for push.

package dev.edgebase.sdk.client

import dev.edgebase.sdk.core.HttpClient

/**
 * Platform-specific push notification provider (FCM 일원화).
 *
 * | Platform | Implementation |
 * |----------|---------------|
 * | Android  | FCM (FirebaseMessaging) |
 * | iOS      | FCM via Firebase iOS SDK (token provider injection) |
 * | macOS    | FCM via Firebase macOS SDK (token provider injection) |
 * | JS       | FCM via Firebase JS SDK (token provider injection) |
 * | JVM      | No-op (desktop — use database-live instead) |
 */
expect class PlatformPush() {
    /**
     * Get the platform FCM token.
     * Returns a pair of (token, null) or null if unavailable.
     */
    suspend fun getToken(client: HttpClient): Pair<String, Map<String, String>?>?

    /** Get device info (name, osVersion, locale). */
    fun getDeviceInfo(): Map<String, String>

    /** Get platform identifier ("android", "ios", "web", "desktop"). */
    fun getPlatformName(): String

    /** Request notification permission. Returns "granted"|"denied"|"notDetermined". */
    suspend fun requestPermission(): String

    /** Get current permission status. Returns "granted"|"denied"|"notDetermined". */
    fun getPermissionStatus(): String

    /** Subscribe to a push topic. */
    suspend fun subscribeTopic(topic: String, client: HttpClient)

    /** Unsubscribe from a push topic. */
    suspend fun unsubscribeTopic(topic: String, client: HttpClient)

    /** Override token acquisition for headless or custom-platform integrations. */
    fun setTokenProvider(provider: (suspend () -> String)?)

    /** Override permission status lookup for headless or custom-platform integrations. */
    fun setPermissionStatusProvider(provider: (() -> String)?)

    /** Override permission request flow for headless or custom-platform integrations. */
    fun setPermissionRequester(requester: (suspend () -> String)?)

    /** Override topic subscription plumbing for headless or custom-platform integrations. */
    fun setTopicProvider(
        subscribe: (suspend (String) -> Unit)?,
        unsubscribe: (suspend (String) -> Unit)?
    )
}
