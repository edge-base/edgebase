// EdgeBase Kotlin SDK — Android push provider (FCM).
//
//: FCM token via FirebaseMessaging, android.os.Build for device info.
// POST_NOTIFICATIONS runtime permission auto-handled via headless PermissionFragment.

package dev.edgebase.sdk.client

import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.google.firebase.messaging.FirebaseMessaging
import dev.edgebase.sdk.core.HttpClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

actual class PlatformPush actual constructor() {
    private var tokenProvider: (suspend () -> String)? = null
    private var permissionStatusProvider: (() -> String)? = null
    private var permissionRequester: (suspend () -> String)? = null
    private var topicSubscriber: (suspend (String) -> Unit)? = null
    private var topicUnsubscriber: (suspend (String) -> Unit)? = null

    actual suspend fun getToken(client: HttpClient): Pair<String, Map<String, String>?>? {
        tokenProvider?.let {
            return try {
                Pair(it(), null)
            } catch (_: Exception) {
                null
            }
        }
        return try {
            val token = FirebaseMessaging.getInstance().token.await()
            token?.let { Pair(it, null) }
        } catch (_: Exception) {
            null
        }
    }

    actual fun getDeviceInfo(): Map<String, String> = mapOf(
        "name" to "${Build.MANUFACTURER} ${Build.MODEL}",
        "osVersion" to "Android ${Build.VERSION.RELEASE}",
        "locale" to java.util.Locale.getDefault().toLanguageTag()
    )

    actual fun getPlatformName(): String = "android"

    actual suspend fun requestPermission(): String {
        permissionRequester?.let { return it() }
        // Pre-Android 13 (API < 33): POST_NOTIFICATIONS not required
        if (Build.VERSION.SDK_INT < 33) return "granted"

        // Already granted?
        if (getPermissionStatus() == "granted") return "granted"

        // Need a FragmentActivity to show the permission dialog
        val activity = AndroidActivityTracker.getCurrentActivity()
        if (activity !is FragmentActivity) {
            // No Activity available or not a FragmentActivity — can't request
            return "notDetermined"
        }

        // Request via headless Fragment on the main thread
        return withContext(Dispatchers.Main) {
            suspendCoroutine { cont ->
                PermissionFragment.request(activity) { granted ->
                    cont.resume(if (granted) "granted" else "denied")
                }
            }
        }
    }

    actual fun getPermissionStatus(): String {
        permissionStatusProvider?.let { return it() }
        // Pre-Android 13 (API < 33): POST_NOTIFICATIONS not required
        if (Build.VERSION.SDK_INT < 33) return "granted"

        val ctx = try {
            AndroidActivityTracker.ensureContext()
        } catch (_: Exception) {
            return "notDetermined"
        }

        return if (ContextCompat.checkSelfPermission(
                ctx, "android.permission.POST_NOTIFICATIONS"
            ) == PackageManager.PERMISSION_GRANTED
        ) "granted" else "notDetermined"
    }

    actual suspend fun subscribeTopic(topic: String, client: HttpClient) {
        topicSubscriber?.let {
            it(topic)
            return
        }
        FirebaseMessaging.getInstance().subscribeToTopic(topic).await()
    }

    actual suspend fun unsubscribeTopic(topic: String, client: HttpClient) {
        topicUnsubscriber?.let {
            it(topic)
            return
        }
        FirebaseMessaging.getInstance().unsubscribeFromTopic(topic).await()
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
