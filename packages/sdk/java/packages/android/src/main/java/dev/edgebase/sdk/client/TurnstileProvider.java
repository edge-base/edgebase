package dev.edgebase.sdk.client;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.Application;
import android.content.Context;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;

import dev.edgebase.sdk.core.HttpClient;
import dev.edgebase.sdk.core.generated.GeneratedDbApi;

import java.io.InputStreamReader;
import java.lang.ref.WeakReference;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * Turnstile captcha provider for Android.
 * Uses android.webkit.WebView to render Cloudflare Turnstile.
 *
 * <p><b>Zero-config:</b> auto-detects Application context via ActivityThread
 * reflection and tracks the current Activity via ActivityLifecycleCallbacks.
 * No manual initialization required.</p>
 *
 * <p>Phase 1: Headless WebView (invisible, auto-pass for 99% of users).</p>
 * <p>Phase 2: If interactive challenge needed, WebView shown as dimmed overlay on Activity.</p>
 */
@SuppressWarnings("deprecation")
public class TurnstileProvider {
    private static final Map<String, String> siteKeyCache = new ConcurrentHashMap<>();
    private static Context appContext;
    private static WeakReference<Activity> currentActivityRef;
    private static boolean lifecycleRegistered = false;
    private static final Map<String, GeneratedDbApi> generatedApis = new ConcurrentHashMap<>();

    // ── Zero-Config Context Management ──────────────────────────────────────

    /**
     * Ensure we have an Application context. Auto-detects on first call
     * via ActivityThread.currentApplication() reflection (same pattern used
     * by Firebase, WorkManager, etc.).
     */
    @SuppressLint("PrivateApi")
    private static Context ensureContext() {
        if (appContext != null) return appContext;

        // Auto-detect via ActivityThread.currentApplication()
        try {
            Class<?> activityThread = Class.forName("android.app.ActivityThread");
            Object app = activityThread.getMethod("currentApplication").invoke(null);
            if (app instanceof Application) {
                appContext = (Context) app;
                registerLifecycleTracking((Application) app);
                return appContext;
            }
        } catch (Exception ignored) { /* reflection blocked — fall through */ }

        throw new IllegalStateException(
            "TurnstileProvider: Could not auto-detect Application context. " +
            "Call TurnstileProvider.initialize(context) during app initialization."
        );
    }

    /**
     * Register ActivityLifecycleCallbacks to auto-track the current foreground
     * Activity. Called once, idempotent.
     */
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

    // ── Optional Manual Init (backward-compatible) ──────────────────────────

    /**
     * Optional: manually set Application context.
     * Only needed if auto-detection via ActivityThread reflection fails.
     */
    public static void initialize(Context context) {
        appContext = context.getApplicationContext();
        if (appContext instanceof Application) {
            registerLifecycleTracking((Application) appContext);
        }
    }

    /**
     * Set the GeneratedDbApi instance for config fetching.
     * When set, fetchSiteKey() delegates to core.getConfig() instead of
     * making a raw HTTP call with a hardcoded /api/ path.
     */
    public static void setGeneratedApi(String baseUrl, GeneratedDbApi api) {
        if (api == null) {
            return;
        }
        generatedApis.put(normalizeBaseUrl(baseUrl), api);
    }

    /**
     * @deprecated Use {@link #setGeneratedApi(String, GeneratedDbApi)} so caches stay isolated per base URL.
     */
    @Deprecated
    public static void setGeneratedApi(GeneratedDbApi api) {
        if (api == null) {
            return;
        }
        generatedApis.put("", api);
    }

    // ── Core API ────────────────────────────────────────────────────────────

    /**
     * Resolve captcha token: use provided or auto-acquire.
     * @param baseUrl Server base URL
     * @param action Action name (signup, signin, etc.)
     * @param manualToken Optional manual token override
     * @return Captcha token or null
     */
    public static String resolveCaptchaToken(String baseUrl, String action, String manualToken) {
        if (manualToken != null) return manualToken;
        String siteKey = fetchSiteKey(baseUrl);
        if (siteKey == null) return null;
        try {
            return acquireToken(siteKey, action);
        } catch (Exception e) {
            return null;
        }
    }

    @SuppressWarnings("unchecked")
    private static String fetchSiteKey(String baseUrl) {
        String normalizedBaseUrl = normalizeBaseUrl(baseUrl);
        String cachedSiteKey = siteKeyCache.get(normalizedBaseUrl);
        if (cachedSiteKey != null) return cachedSiteKey;

        // Delegate to GeneratedDbApi.getConfig() when available
        GeneratedDbApi generatedApi = generatedApis.get(normalizedBaseUrl);
        if (generatedApi == null) {
            generatedApi = generatedApis.get("");
        }
        if (generatedApi != null) {
            try {
                Object result = generatedApi.getConfig();
                if (result instanceof Map) {
                    Map<String, Object> config = (Map<String, Object>) result;
                    String siteKey = extractSiteKey(config);
                    if (siteKey != null) {
                        siteKeyCache.put(normalizedBaseUrl, siteKey);
                    }
                    return siteKey;
                }
            } catch (Exception ignored) {}
            return null;
        }

        // Fallback: raw HTTP (for cases where GeneratedDbApi is not yet initialized)
        try {
            URL url = new URL(baseUrl + GeneratedDbApi.ApiPaths.GET_CONFIG);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            if (conn.getResponseCode() == 200) {
                Gson gson = new Gson();
                Map<String, Object> config = gson.fromJson(
                    new InputStreamReader(conn.getInputStream()),
                    new TypeToken<Map<String, Object>>(){}.getType()
                );
                String siteKey = extractSiteKey(config);
                if (siteKey != null) {
                    siteKeyCache.put(normalizedBaseUrl, siteKey);
                }
                return siteKey;
            }
        } catch (Exception ignored) {}
        return null;
    }

    private static String normalizeBaseUrl(String baseUrl) {
        if (baseUrl == null) {
            return "";
        }
        return baseUrl.replaceAll("/+$", "");
    }

    @SuppressWarnings("unchecked")
    private static String extractSiteKey(Map<String, Object> config) {
        if (config != null && config.containsKey("captcha")) {
            Map<String, Object> captcha = (Map<String, Object>) config.get("captcha");
            if (captcha != null && captcha.containsKey("siteKey")) {
                return (String) captcha.get("siteKey");
            }
        }
        return null;
    }

    @SuppressLint("SetJavaScriptEnabled")
    private static String acquireToken(String siteKey, String action) throws Exception {
        Context ctx = ensureContext();

        CompletableFuture<String> future = new CompletableFuture<>();
        Handler handler = new Handler(Looper.getMainLooper());

        handler.post(() -> {
            final WebView webView = new WebView(ctx);
            webView.getSettings().setJavaScriptEnabled(true);
            webView.getSettings().setDomStorageEnabled(true);

            // Overlay reference for interactive challenge (array for mutation in lambda)
            final FrameLayout[] overlayRef = {null};

            // Cleanup: remove overlay and destroy WebView
            final Runnable cleanup = () -> handler.post(() -> {
                if (overlayRef[0] != null) {
                    ViewGroup parent = (ViewGroup) overlayRef[0].getParent();
                    if (parent != null) parent.removeView(overlayRef[0]);
                    overlayRef[0] = null;
                }
                webView.destroy();
            });

            webView.addJavascriptInterface(new Object() {
                @JavascriptInterface
                public void onToken(String token) {
                    if (!future.isDone()) future.complete(token);
                    cleanup.run();
                }

                @JavascriptInterface
                public void onError(String error) {
                    if (!future.isDone()) future.completeExceptionally(new Exception(error));
                    cleanup.run();
                }

                @JavascriptInterface
                public void onInteractive(String state) {
                    handler.post(() -> {
                        if ("show".equals(state)) {
                            // Phase 2: Show WebView as overlay on current Activity
                            if (currentActivityRef == null) return;
                            Activity activity = currentActivityRef.get();
                            if (activity == null || activity.isFinishing()) return;

                            FrameLayout contentView = (FrameLayout) activity.findViewById(android.R.id.content);
                            if (contentView == null) return;

                            // Remove WebView from any existing parent
                            ViewGroup wp = (ViewGroup) webView.getParent();
                            if (wp != null) wp.removeView(webView);

                            // Create dimmed overlay
                            FrameLayout overlay = new FrameLayout(activity);
                            overlay.setBackgroundColor(Color.argb(128, 0, 0, 0));
                            overlay.setLayoutParams(new FrameLayout.LayoutParams(
                                FrameLayout.LayoutParams.MATCH_PARENT,
                                FrameLayout.LayoutParams.MATCH_PARENT
                            ));

                            // Center the WebView in the overlay
                            FrameLayout.LayoutParams wvParams = new FrameLayout.LayoutParams(
                                FrameLayout.LayoutParams.WRAP_CONTENT,
                                FrameLayout.LayoutParams.WRAP_CONTENT
                            );
                            wvParams.gravity = Gravity.CENTER;

                            overlay.addView(webView, wvParams);
                            contentView.addView(overlay);
                            overlayRef[0] = overlay;
                        } else if ("hide".equals(state)) {
                            if (overlayRef[0] != null) {
                                ViewGroup parent = (ViewGroup) overlayRef[0].getParent();
                                if (parent != null) parent.removeView(overlayRef[0]);
                                overlayRef[0] = null;
                            }
                        }
                    });
                }
            }, "captchaHandler");

            webView.setWebViewClient(new WebViewClient());
            String html = turnstileHtml(siteKey, action);
            webView.loadDataWithBaseURL("https://challenges.cloudflare.com", html, "text/html", "UTF-8", null);
        });

        return future.get(30, TimeUnit.SECONDS);
    }

    private static String turnstileHtml(String siteKey, String action) {
        return "<!DOCTYPE html><html><head>" +
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
            "<script src=\"https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit\" async></script>" +
            "<style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:transparent}</style>" +
            "</head><body><div id=\"cf-turnstile\"></div><script>" +
            "function init(){if(window.turnstile){window.turnstile.render('#cf-turnstile',{" +
            "sitekey:'" + siteKey + "',action:'" + action + "',appearance:'interaction-only'," +
            "callback:function(t){captchaHandler.onToken(t)}," +
            "'error-callback':function(e){captchaHandler.onError(String(e))}," +
            "'before-interactive-callback':function(){captchaHandler.onInteractive('show')}," +
            "'after-interactive-callback':function(){captchaHandler.onInteractive('hide')}," +
            "'timeout-callback':function(){captchaHandler.onError('timeout')}" +
            "})}else{setTimeout(init,50)}}init();" +
            "</script></body></html>";
    }
}
