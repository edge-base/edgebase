// EdgeBase Kotlin SDK — Zero-config Android Activity tracker.
//
// Auto-detects Application context via ActivityThread reflection (same pattern
// used by Firebase, WorkManager, etc.) and tracks the current foreground
// Activity via ActivityLifecycleCallbacks. No developer initialization required.
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
    private var appContext: android.content.Context? = null
    private var currentActivityRef: WeakReference<Activity>? = null
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
     * Optional: manually set Application context.
     * Only needed if auto-detection via ActivityThread reflection fails.
     */
    fun initContext(context: android.content.Context) {
        appContext = context.applicationContext
        (context.applicationContext as? Application)?.let { registerLifecycleTracking(it) }
    }

    /**
     * Register ActivityLifecycleCallbacks to auto-track the current foreground Activity.
     * Called once, idempotent.
     */
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
}
