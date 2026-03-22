package dev.edgebase.sdk.client;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.Application;
import android.content.Context;
import android.os.Bundle;

import java.lang.ref.WeakReference;

final class AndroidActivityTracker {
    private static Context appContext;
    private static WeakReference<Activity> currentActivityRef;
    private static boolean lifecycleRegistered = false;

    private AndroidActivityTracker() {
    }

    @SuppressLint("PrivateApi")
    static Context ensureContext() {
        if (appContext != null) {
            return appContext;
        }

        try {
            Class<?> activityThread = Class.forName("android.app.ActivityThread");
            Object app = activityThread.getMethod("currentApplication").invoke(null);
            if (app instanceof Application application) {
                initialize(application);
                return appContext;
            }
        } catch (Throwable ignored) {
        }

        throw new IllegalStateException(
                "EdgeBase Android runtime could not auto-detect the Application context. " +
                        "Call AndroidActivityTracker.initialize(context) during app startup."
        );
    }

    static void initialize(Context context) {
        if (context == null) {
            return;
        }

        appContext = context.getApplicationContext();
        if (context instanceof Activity activity) {
            currentActivityRef = new WeakReference<>(activity);
        }
        if (appContext instanceof Application application) {
            registerLifecycleTracking(application);
        }
    }

    static Activity getCurrentActivity() {
        WeakReference<Activity> reference = currentActivityRef;
        Activity activity = reference == null ? null : reference.get();
        if (activity != null) {
            return activity;
        }

        try {
            ensureContext();
        } catch (Throwable ignored) {
        }

        reference = currentActivityRef;
        return reference == null ? null : reference.get();
    }

    private static void registerLifecycleTracking(Application app) {
        if (lifecycleRegistered) {
            return;
        }
        lifecycleRegistered = true;

        app.registerActivityLifecycleCallbacks(new Application.ActivityLifecycleCallbacks() {
            @Override
            public void onActivityCreated(Activity activity, Bundle savedInstanceState) {
                currentActivityRef = new WeakReference<>(activity);
            }

            @Override
            public void onActivityStarted(Activity activity) {
                currentActivityRef = new WeakReference<>(activity);
            }

            @Override
            public void onActivityResumed(Activity activity) {
                currentActivityRef = new WeakReference<>(activity);
            }

            @Override
            public void onActivityPaused(Activity activity) {
                Activity current = currentActivityRef == null ? null : currentActivityRef.get();
                if (current == activity) {
                    currentActivityRef = null;
                }
            }

            @Override
            public void onActivityStopped(Activity activity) {
            }

            @Override
            public void onActivitySaveInstanceState(Activity activity, Bundle outState) {
            }

            @Override
            public void onActivityDestroyed(Activity activity) {
                Activity current = currentActivityRef == null ? null : currentActivityRef.get();
                if (current == activity) {
                    currentActivityRef = null;
                }
            }
        });
    }
}
