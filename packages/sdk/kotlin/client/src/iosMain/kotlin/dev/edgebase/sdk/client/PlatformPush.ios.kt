// EdgeBase Kotlin SDK — iOS push provider (APNs).
//
//: APNs via UNUserNotificationCenter, UIDevice for device info.
// getPermissionStatus() uses a cached value updated asynchronously since iOS
// doesn't support synchronous permission status checks.

@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)

package dev.edgebase.sdk.client

import dev.edgebase.sdk.core.HttpClient
import platform.Foundation.NSLocale
import platform.Foundation.currentLocale
import platform.Foundation.languageCode
import platform.UIKit.UIDevice
import platform.UserNotifications.UNAuthorizationOptionAlert
import platform.UserNotifications.UNAuthorizationOptionBadge
import platform.UserNotifications.UNAuthorizationOptionSound
import platform.UserNotifications.UNAuthorizationStatusAuthorized
import platform.UserNotifications.UNAuthorizationStatusDenied
import platform.UserNotifications.UNAuthorizationStatusProvisional
import platform.UserNotifications.UNUserNotificationCenter
import kotlin.concurrent.Volatile
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine
actual class PlatformPush actual constructor() {
    // FCM token provider must be set by the app via setFcmTokenProvider() (FCM 일원화).
    private var fcmTokenProvider: (suspend () -> String)? = null
    private var topicSubscriberFn: (suspend (String) -> Unit)? = null
    private var topicUnsubscriberFn: (suspend (String) -> Unit)? = null
    private var permissionStatusProvider: (() -> String)? = null
    private var permissionRequester: (suspend () -> String)? = null

    // Cached permission status for synchronous getPermissionStatus().
    // Updated by requestPermission() and refreshed asynchronously on each
    // getPermissionStatus() call. Initial value is "notDetermined".
    @Volatile
    private var cachedPermissionStatus: String = "notDetermined"

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
        val device = UIDevice.currentDevice
        return mapOf(
            "name" to device.name,
            "osVersion" to "iOS ${device.systemVersion}",
            "locale" to (NSLocale.currentLocale.languageCode ?: "en")
        )
    }

    actual fun getPlatformName(): String = "ios"

    actual suspend fun requestPermission(): String {
        permissionRequester?.let { return it() }
        return suspendCoroutine { cont ->
        val center = UNUserNotificationCenter.currentNotificationCenter()
        val options = UNAuthorizationOptionAlert or UNAuthorizationOptionBadge or UNAuthorizationOptionSound
        center.requestAuthorizationWithOptions(options) { granted, _ ->
            val status = if (granted) "granted" else "denied"
            cachedPermissionStatus = status
            cont.resume(status)
        }
    }
    }

    actual fun getPermissionStatus(): String {
        permissionStatusProvider?.let {
            cachedPermissionStatus = it()
            return cachedPermissionStatus
        }
        // Fire-and-forget async refresh of the cached status.
        // Returns the cached value immediately (accurate after first requestPermission()
        // or after the async refresh completes on the next call).
        val center = UNUserNotificationCenter.currentNotificationCenter()
        center.getNotificationSettingsWithCompletionHandler { settings ->
            if (settings != null) {
                cachedPermissionStatus = when (settings.authorizationStatus) {
                    UNAuthorizationStatusAuthorized, UNAuthorizationStatusProvisional -> "granted"
                    UNAuthorizationStatusDenied -> "denied"
                    else -> "notDetermined"
                }
            }
        }
        return cachedPermissionStatus
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
