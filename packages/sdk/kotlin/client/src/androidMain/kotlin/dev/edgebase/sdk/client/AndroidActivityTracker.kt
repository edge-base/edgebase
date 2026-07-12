// EdgeBase Kotlin SDK — Android Activity tracker.
//
// AndroidEdgeBase captures the initial Activity synchronously, then lifecycle
// callbacks keep the foreground Activity current for later UI-bound features.
//
// Shared by CaptchaProvider, PlatformPush, and any other component that needs
// Activity context on Android.

package dev.edgebase.sdk.client

import android.annotation.SuppressLint
import android.app.Activity
import android.app.Application
import android.os.Bundle
import java.lang.ref.WeakReference

object AndroidActivityTracker {
    @Volatile
    private var appContext: android.content.Context? = null
    @Volatile
    private var currentActivityRef: WeakReference<Activity>? = null
    @Volatile
    private var lifecycleRegistered = false

    /**
     * Get the current foreground Activity (if any).
     * Returns null if no Activity is resumed or if the reference has been GC'd.
     */
    fun getCurrentActivity(): Activity? = currentActivityRef?.get()

    /**
     * Ensure we have an Application context. Auto-detects on first call
     * via ActivityThread.currentApplication() reflection.
     * Falls back to manual init via [initContext] if reflection fails.
     */
    @SuppressLint("PrivateApi", "DiscouragedPrivateApi")
    fun ensureContext(): android.content.Context {
        appContext?.let { return it }

        // Auto-detect via ActivityThread.currentApplication() — reliable on all Android versions
        try {
            val activityThread = Class.forName("android.app.ActivityThread")
            val currentApp = activityThread.getMethod("currentApplication")
            val app = currentApp.invoke(null) as? Application
            if (app != null) {
                appContext = app
                registerLifecycleTracking(app)
                return app
            }
        } catch (_: Exception) { /* reflection blocked — fall through */ }

        throw IllegalStateException(
            "EdgeBase: Could not auto-detect Application context. " +
            "Call AndroidActivityTracker.initContext(context) during app initialization."
        )
    }

    /**
     * Set the application context and synchronously capture an Activity when
     * one is supplied. AndroidEdgeBase uses this before client construction.
     */
    fun initContext(context: android.content.Context) {
        appContext = context.applicationContext
        // Lifecycle callbacks registered after an Activity has already reached
        // RESUMED do not receive a replay. Capturing an explicitly supplied
        // Activity closes that first-interactive-CAPTCHA gap.
        if (context is Activity && !context.isFinishing) {
            currentActivityRef = WeakReference(context)
        }
        (context.applicationContext as? Application)?.let { registerLifecycleTracking(it) }
    }

    /**
     * Register ActivityLifecycleCallbacks to auto-track the current foreground Activity.
     * Called once, idempotent.
     */
    @Synchronized
    private fun registerLifecycleTracking(app: Application) {
        if (lifecycleRegistered) return
        lifecycleRegistered = true

        app.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
            override fun onActivityResumed(activity: Activity) {
                currentActivityRef = WeakReference(activity)
            }
            override fun onActivityPaused(activity: Activity) {
                if (currentActivityRef?.get() === activity) {
                    currentActivityRef = null
                }
            }
            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
            override fun onActivityStarted(activity: Activity) {}
            override fun onActivityStopped(activity: Activity) {}
            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
            override fun onActivityDestroyed(activity: Activity) {}
        })
    }

    internal fun clearForTest() {
        currentActivityRef = null
        appContext = null
    }
}
