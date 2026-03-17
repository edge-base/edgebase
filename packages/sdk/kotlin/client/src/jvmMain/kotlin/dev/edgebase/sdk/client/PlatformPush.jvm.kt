// EdgeBase Kotlin SDK — JVM/Desktop push provider (No-op).
//
// Desktop apps should use database-live subscriptions instead of push notifications.
//.

package dev.edgebase.sdk.client

import dev.edgebase.sdk.core.HttpClient

actual class PlatformPush actual constructor() {
    private var tokenProvider: (suspend () -> String)? = null
    private var permissionStatusProvider: (() -> String)? = null
    private var permissionRequester: (suspend () -> String)? = null
    private var topicSubscriber: (suspend (String) -> Unit)? = null
    private var topicUnsubscriber: (suspend (String) -> Unit)? = null

    actual suspend fun getToken(client: HttpClient): Pair<String, Map<String, String>?>? {
        val provider = tokenProvider
            ?: throw IllegalStateException("FCM token provider not set. Call setTokenProvider() first.")
        return try {
            Pair(provider(), null)
        } catch (error: Exception) {
            throw IllegalStateException("FCM token provider failed: ${error.message ?: error::class.simpleName}", error)
        }
    }

    actual fun getDeviceInfo(): Map<String, String> = mapOf(
        "name" to "${System.getProperty("os.name")} Desktop",
        "osVersion" to "${System.getProperty("os.name")} ${System.getProperty("os.version")}",
        "locale" to java.util.Locale.getDefault().toLanguageTag()
    )

    actual fun getPlatformName(): String = "desktop"

    actual suspend fun requestPermission(): String = permissionRequester?.invoke() ?: "denied"

    actual fun getPermissionStatus(): String = permissionStatusProvider?.invoke() ?: "denied"

    actual suspend fun subscribeTopic(topic: String, client: HttpClient) {
        topicSubscriber?.invoke(topic)
    }

    actual suspend fun unsubscribeTopic(topic: String, client: HttpClient) {
        topicUnsubscriber?.invoke(topic)
    }

    actual fun setTokenProvider(provider: (suspend () -> String)?) {
        tokenProvider = provider
    }

    actual fun setPermissionStatusProvider(provider: (() -> String)?) {
        permissionStatusProvider = provider
    }

    actual fun setPermissionRequester(requester: (suspend () -> String)?) {
        permissionRequester = requester
    }

    actual fun setTopicProvider(
        subscribe: (suspend (String) -> Unit)?,
        unsubscribe: (suspend (String) -> Unit)?
    ) {
        topicSubscriber = subscribe
        topicUnsubscriber = unsubscribe
    }
}
