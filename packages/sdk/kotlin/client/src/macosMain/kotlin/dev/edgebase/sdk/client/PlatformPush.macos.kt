// EdgeBase Kotlin SDK — macOS push provider (APNs).
//
//: APNs via UNUserNotificationCenter.

@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)

package dev.edgebase.sdk.client

import dev.edgebase.sdk.core.HttpClient
import platform.Foundation.NSLocale
import platform.Foundation.NSProcessInfo
import platform.Foundation.currentLocale
import platform.Foundation.languageCode
import platform.UserNotifications.UNAuthorizationOptionAlert
import platform.UserNotifications.UNAuthorizationOptionBadge
import platform.UserNotifications.UNAuthorizationOptionSound
import platform.UserNotifications.UNUserNotificationCenter
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

actual class PlatformPush actual constructor() {
    // FCM token provider must be set by the app via setFcmTokenProvider() (FCM 일원화).
    private var fcmTokenProvider: (suspend () -> String)? = null
    private var topicSubscriberFn: (suspend (String) -> Unit)? = null
    private var topicUnsubscriberFn: (suspend (String) -> Unit)? = null
    private var permissionStatusProvider: (() -> String)? = null
    private var permissionRequester: (suspend () -> String)? = null

    actual fun setTokenProvider(provider: (suspend () -> String)?) {
        fcmTokenProvider = provider
    }

    actual fun setTopicProvider(
        subscribe: (suspend (String) -> Unit)?,
        unsubscribe: (suspend (String) -> Unit)?
    ) {
        topicSubscriberFn = subscribe
        topicUnsubscriberFn = unsubscribe
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

    actual fun getDeviceInfo(): Map<String, String> {
        val osVersion = NSProcessInfo.processInfo.operatingSystemVersionString
        return mapOf(
            "name" to "macOS Desktop",
            "osVersion" to "macOS $osVersion",
            "locale" to (NSLocale.currentLocale.languageCode ?: "en")
        )
    }

    actual fun getPlatformName(): String = "macos"

    actual suspend fun requestPermission(): String {
        permissionRequester?.let { return it() }
        return suspendCoroutine { cont ->
        val center = UNUserNotificationCenter.currentNotificationCenter()
        val options = UNAuthorizationOptionAlert or UNAuthorizationOptionBadge or UNAuthorizationOptionSound
        center.requestAuthorizationWithOptions(options) { granted, _ ->
            cont.resume(if (granted) "granted" else "denied")
        }
    }
    }

    actual fun getPermissionStatus(): String {
        permissionStatusProvider?.let { return it() }
        // Synchronous check is not available on macOS — return "notDetermined" as default.
        // Use requestPermission() for accurate status.
        return "notDetermined"
    }

    actual suspend fun subscribeTopic(topic: String, client: HttpClient) {
        topicSubscriberFn?.invoke(topic)
            ?: throw IllegalStateException("Topic provider not set. Call setTopicProvider() first.")
    }

    actual suspend fun unsubscribeTopic(topic: String, client: HttpClient) {
        topicUnsubscriberFn?.invoke(topic)
            ?: throw IllegalStateException("Topic provider not set. Call setTopicProvider() first.")
    }

    actual fun setPermissionStatusProvider(provider: (() -> String)?) {
        permissionStatusProvider = provider
    }

    actual fun setPermissionRequester(requester: (suspend () -> String)?) {
        permissionRequester = requester
    }
}
