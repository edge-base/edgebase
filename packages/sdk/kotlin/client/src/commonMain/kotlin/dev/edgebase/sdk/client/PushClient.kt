// EdgeBase Kotlin SDK — Push notification client (KMP).
//
// Client-side push notification management.
// Delegates platform-specific operations to PlatformPush (expect/actual).
///§9/§10, #130: KMP 전환.

package dev.edgebase.sdk.client

import dev.edgebase.sdk.core.*

/**
 * Client-side push notification management.
 *
 * Usage:
 * ```kotlin
 * client.push.register()                              // auto platform token
 * client.push.register(mapOf("topic" to "news"))      // with metadata
 * ```
 */
class PushClient(
    private val client: HttpClient,
    private val platform: PlatformPush = PlatformPush()
) {
    private val messageListeners = mutableListOf<(Map<String, Any?>) -> Unit>()
    private val openedAppListeners = mutableListOf<(Map<String, Any?>) -> Unit>()

    private var cachedDeviceId: String? = null
    private var cachedToken: String? = null

    private fun getOrCreateDeviceId(): String {
        cachedDeviceId?.let { return it }
        val id = platformUuid()
        cachedDeviceId = id
        return id
    }

    /**
     * Register for push notifications.
     * Auto-acquires platform push token, caches, sends to server only on change (§9).
     */
    suspend fun register(metadata: Map<String, Any?>? = null) {
        // 1. Request permission
        val perm = requestPermission()
        if (perm != "granted") return

        // 2. Get FCM token
        val tokenPair = platform.getToken(client) ?: return
        val token = tokenPair.first

        // 3. Check cache — skip if unchanged (§9), unless metadata provided
        if (cachedToken == token && metadata == null) return

        // 4. Register with server — auto-collect deviceInfo
        val deviceId = getOrCreateDeviceId()
        val deviceInfo = platform.getDeviceInfo()
        val body = mutableMapOf<String, Any?>(
            "deviceId" to deviceId,
            "token" to token,
            "platform" to platform.getPlatformName(),
            "deviceInfo" to deviceInfo
        )
        if (metadata != null) body["metadata"] = metadata
        client.post("/push/register", body)
        cachedToken = token
    }

    /**
     * Unregister current device (or a specific device by ID).
     */
    suspend fun unregister(deviceId: String? = null) {
        val id = deviceId ?: getOrCreateDeviceId()
        client.post("/push/unregister", mapOf("deviceId" to id))
        cachedToken = null
    }

    /** Listen for push messages in foreground. */
    fun onMessage(callback: (Map<String, Any?>) -> Unit) {
        messageListeners.add(callback)
    }

    /** Listen for notification taps that opened the app. */
    fun onMessageOpenedApp(callback: (Map<String, Any?>) -> Unit) {
        openedAppListeners.add(callback)
    }

    /** Get notification permission status. Returns "granted"|"denied"|"notDetermined". */
    fun getPermissionStatus(): String {
        return platform.getPermissionStatus()
    }

    /** Request notification permission from the user. */
    suspend fun requestPermission(): String {
        return platform.requestPermission()
    }

    /**
     * Subscribe to a push notification topic.
     * Mobile: Firebase SDK directly. Web: server-side via IID API.
     */
    suspend fun subscribeTopic(topic: String) {
        platform.subscribeTopic(topic, client)
    }

    /**
     * Unsubscribe from a push notification topic.
     */
    suspend fun unsubscribeTopic(topic: String) {
        platform.unsubscribeTopic(topic, client)
    }

    /** Override token acquisition for headless or custom-platform integrations. */
    fun setTokenProvider(provider: suspend () -> String) {
        platform.setTokenProvider(provider)
    }

    /**
     * Override permission status/request flows for headless or custom-platform integrations.
     * Either closure may be omitted to keep the platform default for that branch.
     */
    fun setPermissionProvider(
        getPermissionStatus: (() -> String)? = null,
        requestPermission: (suspend () -> String)? = null
    ) {
        platform.setPermissionStatusProvider(getPermissionStatus)
        platform.setPermissionRequester(requestPermission)
    }

    /** Override topic subscription plumbing for headless or custom-platform integrations. */
    fun setTopicProvider(
        subscribe: suspend (String) -> Unit,
        unsubscribe: suspend (String) -> Unit
    ) {
        platform.setTopicProvider(subscribe, unsubscribe)
    }

    /** Dispatch a foreground message to registered listeners. Called from platform push service. */
    fun dispatchMessage(message: Map<String, Any?>) {
        for (cb in messageListeners) cb(message)
    }

    /** Dispatch a notification-opened event. Called from platform app lifecycle. */
    fun dispatchMessageOpenedApp(message: Map<String, Any?>) {
        for (cb in openedAppListeners) cb(message)
    }
}
