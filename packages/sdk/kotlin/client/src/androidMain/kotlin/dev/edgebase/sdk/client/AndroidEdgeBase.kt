package dev.edgebase.sdk.client

import android.app.Activity

/**
 * Android-specific client factory.
 *
 * Pass the current Activity when creating the SDK from an already-resumed UI.
 * This is the release-safe contract that lets an immediately interactive
 * CAPTCHA attach without relying on hidden Android APIs or a lifecycle replay.
 * The default token storage is process memory. Supply a platform-secure
 * [DurableTokenStorage] before anonymous email/phone account upgrades.
 */
object AndroidEdgeBase {
    /**
     * Create an Android client. [tokenStorage] must implement
     * [DurableTokenStorage] for anonymous replacement-session flows.
     */
    fun client(
        activity: Activity,
        url: String,
        tokenStorage: TokenStorage? = null,
        projectId: String? = null
    ): ClientEdgeBase {
        AndroidActivityTracker.initContext(activity)
        return ClientEdgeBase(url, tokenStorage, projectId)
    }
}

internal actual fun validateClientPlatformInitialization() {
    if (System.getProperty("edgebase.test.allowMissingAndroidActivity") == "true") return
    val activity = AndroidActivityTracker.getCurrentActivity()
    if (activity == null || activity.isFinishing) {
        throw IllegalStateException(
            "EdgeBase Android clients require the current Activity at SDK initialization. " +
                "Use AndroidEdgeBase.client(activity, url, ...) after the Activity is available."
        )
    }
}
