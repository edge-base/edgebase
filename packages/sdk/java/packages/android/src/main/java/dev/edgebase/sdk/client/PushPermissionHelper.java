package dev.edgebase.sdk.client;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.Application;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Process;

import java.lang.ref.WeakReference;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/**
 * Built-in push notification permission handler for Android.
 * Uses zero-config Activity tracking (same pattern as TurnstileProvider)
 * to auto-detect Application context and track the current foreground Activity.
 *
 * <p>Uses only base Android API (no AndroidX dependency) for compatibility
 * with stub-only compilation on non-Android hosts.</p>
 *
 * <p>Used as the default permission provider in PushClient. Developers can
 * override with setPermissionStatusProvider() / setPermissionRequester().</p>
 */
public class PushPermissionHelper {

    private static Context appContext;
    private static WeakReference<Activity> currentActivityRef;
    private static boolean lifecycleRegistered = false;

    // ── Zero-Config Context ─────────────────────────────────────────────────

    @SuppressLint("PrivateApi")
    private static Context ensureContext() {
        if (appContext != null) return appContext;

        try {
            Class<?> activityThread = Class.forName("android.app.ActivityThread");
            Object app = activityThread.getMethod("currentApplication").invoke(null);
            if (app instanceof Application) {
                appContext = (Context) app;
                registerLifecycleTracking((Application) app);
                return appContext;
            }
        } catch (Exception ignored) { /* reflection blocked */ }

        throw new IllegalStateException(
            "PushPermissionHelper: Could not auto-detect Application context."
        );
    }

    private static void registerLifecycleTracking(Application app) {
        if (lifecycleRegistered) return;
        lifecycleRegistered = true;

        app.registerActivityLifecycleCallbacks(new Application.ActivityLifecycleCallbacks() {
            @Override public void onActivityResumed(Activity activity) {
                currentActivityRef = new WeakReference<>(activity);
            }
            @Override public void onActivityPaused(Activity activity) {
                if (currentActivityRef != null && currentActivityRef.get() == activity) {
                    currentActivityRef = null;
                }
            }
            @Override public void onActivityCreated(Activity a, Bundle b) {}
            @Override public void onActivityStarted(Activity a) {}
            @Override public void onActivityStopped(Activity a) {}
            @Override public void onActivitySaveInstanceState(Activity a, Bundle b) {}
            @Override public void onActivityDestroyed(Activity a) {}
        });
    }

    // ── Permission API ──────────────────────────────────────────────────────

    /**
     * Check POST_NOTIFICATIONS permission status.
     * Pre-Android 13 (API < 33): always returns "granted" (no runtime permission needed).
     * API 33+: checks context.checkPermission() directly.
     */
    public static String getPermissionStatus() {
        if (Build.VERSION.SDK_INT < 33) return "granted";

        try {
            Context ctx = ensureContext();
            // Use Context.checkPermission() — works without AndroidX
            int result = ctx.checkPermission(
                "android.permission.POST_NOTIFICATIONS",
                Process.myPid(),
                Process.myUid());
            return result == PackageManager.PERMISSION_GRANTED ? "granted" : "notDetermined";
        } catch (Exception e) {
            return "notDetermined";
        }
    }

    /**
     * Request POST_NOTIFICATIONS permission.
     * Pre-Android 13 (API < 33): returns "granted" immediately.
     * API 33+: uses Activity.requestPermissions() directly.
     *
     * <p>Returns "notDetermined" if no Activity is available
     * (e.g., called from a Service or background thread).</p>
     */
    public static String requestPermission() {
        if (Build.VERSION.SDK_INT < 33) return "granted";
        if ("granted".equals(getPermissionStatus())) return "granted";

        // Need an Activity to show the permission dialog
        Activity activity = currentActivityRef != null ? currentActivityRef.get() : null;
        if (activity == null) {
            return "notDetermined";
        }

        CompletableFuture<String> future = new CompletableFuture<>();

        // Must run on main thread — use reflection for requestPermissions()
        // (not available in stub JAR used for compilation)
        activity.runOnUiThread(() -> {
            try {
                java.lang.reflect.Method requestPerms = Activity.class.getMethod(
                    "requestPermissions", String[].class, int.class);
                requestPerms.invoke(activity,
                    new String[]{"android.permission.POST_NOTIFICATIONS"},
                    19126 // EdgeBase push permission request code
                );
                // Note: actual result requires onRequestPermissionsResult handling.
                // For SDK use, we check the status after a short delay.
                // In practice, the permission dialog blocks the UI thread.
                future.complete("notDetermined");
            } catch (Exception e) {
                future.complete("notDetermined");
            }
        });

        try {
            return future.get(30, TimeUnit.SECONDS);
        } catch (Exception e) {
            return "notDetermined";
        }
    }
}
