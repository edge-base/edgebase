// EdgeBase Kotlin SDK — JS/Browser push provider (FCM via Firebase JS SDK).
//
//, FCM 일원화: FCM token via Firebase JS SDK, navigator for device info.

package dev.edgebase.sdk.client

import dev.edgebase.sdk.core.HttpClient
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine
import kotlin.js.Promise

actual class PlatformPush actual constructor() {
    // FCM token provider must be set by the app via setFcmTokenProvider() (FCM 일원화).
    private var fcmTokenProvider: (suspend () -> String)? = null
    private var permissionStatusProvider: (() -> String)? = null
    private var permissionRequester: (suspend () -> String)? = null
    private var topicSubscriber: (suspend (String) -> Unit)? = null
    private var topicUnsubscriber: (suspend (String) -> Unit)? = null

    actual fun setTokenProvider(provider: (suspend () -> String)?) {
        fcmTokenProvider = provider
    }

    actual suspend fun getToken(client: HttpClient): Pair<String, Map<String, String>?>? {
        val provider = fcmTokenProvider
            ?: throw IllegalStateException("FCM token provider not set. Call setTokenProvider() first.")
        return try {
            Pair(provider(), null)
        } catch (error: Exception) {
            throw IllegalStateException("FCM token provider failed: ${error.message ?: error::class.simpleName}", error)
        }
    }

    actual fun getDeviceInfo(): Map<String, String> = mapOf(
        "name" to "Browser",
        "osVersion" to js("navigator.userAgent").unsafeCast<String>(),
        "locale" to js("navigator.language").unsafeCast<String>()
    )

    actual fun getPlatformName(): String = "web"

    actual suspend fun requestPermission(): String {
        permissionRequester?.let { return it() }
        return try {
            val promise = js("Notification.requestPermission()").unsafeCast<Promise<String>>()
            val result = suspendCoroutine<String> { cont ->
                promise.then(
                    onFulfilled = { value -> cont.resume(value); null },
                    onRejected = { cont.resume("denied"); null }
                )
            }
            // Browser returns "default" for not-yet-decided → normalize to "notDetermined"
            if (result == "default") "notDetermined" else result
        } catch (_: Throwable) {
            "denied"
        }
    }

    actual fun getPermissionStatus(): String {
        permissionStatusProvider?.let { return it() }
        return try {
            val status = js("Notification.permission").unsafeCast<String>()
            // Browser returns "default" → normalize to "notDetermined"
            if (status == "default") "notDetermined" else status
        } catch (_: Throwable) {
            "notDetermined"
        }
    }

    actual suspend fun subscribeTopic(topic: String, client: HttpClient) {
        topicSubscriber?.let {
            it(topic)
            return
        }
        // Web: server-side via IID API
        client.post("/push/topic/subscribe", mapOf("topic" to topic))
    }

    actual suspend fun unsubscribeTopic(topic: String, client: HttpClient) {
        topicUnsubscriber?.let {
            it(topic)
            return
        }
        // Web: server-side via IID API
        client.post("/push/topic/unsubscribe", mapOf("topic" to topic))
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
