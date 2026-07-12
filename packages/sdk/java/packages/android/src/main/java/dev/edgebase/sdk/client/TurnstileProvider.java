package dev.edgebase.sdk.client;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.CookieManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;

import dev.edgebase.sdk.core.HttpClient;
import dev.edgebase.sdk.core.generated.GeneratedDbApi;

import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Turnstile captcha provider for Android.
 * Uses android.webkit.WebView to render Cloudflare Turnstile.
 *
 * <p>For an interactive challenge, initialize with the current Activity via
 * {@link #initialize(Context)} (or the Android-aware EdgeBase factory). This
 * also works when SDK initialization happens after the Activity is resumed.</p>
 *
 * <p>Phase 1: Headless WebView (invisible, auto-pass for 99% of users).</p>
 * <p>Phase 2: If interactive challenge needed, WebView shown as dimmed overlay on Activity.</p>
 */
@SuppressWarnings("deprecation")
public class TurnstileProvider {
    static final long SITE_KEY_CACHE_TTL_NANOS = TimeUnit.MINUTES.toNanos(5);
    private static final Map<String, CachedSiteKey> siteKeyCache = new ConcurrentHashMap<>();
    private static final Map<String, GeneratedDbApi> generatedApis = new ConcurrentHashMap<>();

    private static final class CachedSiteKey {
        private final String value;
        private final long cachedAtNanos;

        private CachedSiteKey(String value, long cachedAtNanos) {
            this.value = value;
            this.cachedAtNanos = cachedAtNanos;
        }
    }

    static boolean isSiteKeyCacheFresh(long cachedAtNanos, long nowNanos) {
        long age = nowNanos - cachedAtNanos;
        return age >= 0 && age < SITE_KEY_CACHE_TTL_NANOS;
    }

    private static void cacheSiteKey(String baseUrl, String siteKey) {
        if (siteKey != null && !siteKey.isBlank()) {
            siteKeyCache.put(baseUrl, new CachedSiteKey(siteKey, System.nanoTime()));
        }
    }

    // ── Zero-Config Context Management ──────────────────────────────────────

    /**
     * Ensure we have an Application context. Auto-detects on first call
     * via ActivityThread.currentApplication() reflection (same pattern used
     * by Firebase, WorkManager, etc.).
     */
    private static Context ensureContext() {
        return AndroidActivityTracker.ensureContext();
    }

    // ── Optional Manual Init (backward-compatible) ──────────────────────────

    /**
     * Optional: manually set Application context.
     * Only needed if auto-detection via ActivityThread reflection fails.
     */
    public static void initialize(Context context) {
        if (context == null) throw new IllegalArgumentException("context must not be null");
        AndroidActivityTracker.initialize(context);
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
        if (Looper.myLooper() == Looper.getMainLooper()) {
            throw new CaptchaUnavailableException("ui_thread_blocking");
        }
        String siteKey = fetchSiteKey(baseUrl);
        if (siteKey == null) return null;
        try {
            return acquireToken(normalizeBaseUrl(baseUrl), action);
        } catch (CaptchaUnavailableException error) {
            throw error;
        } catch (Exception error) {
            throw new CaptchaUnavailableException("acquisition_failed", error);
        }
    }

    @SuppressWarnings("unchecked")
    static String fetchSiteKey(String baseUrl) {
        String normalizedBaseUrl = normalizeBaseUrl(baseUrl);
        CachedSiteKey cachedSiteKey = siteKeyCache.get(normalizedBaseUrl);
        if (cachedSiteKey != null) {
            if (isSiteKeyCacheFresh(cachedSiteKey.cachedAtNanos, System.nanoTime())) {
                return cachedSiteKey.value;
            }
            siteKeyCache.remove(normalizedBaseUrl, cachedSiteKey);
        }

        // Delegate to GeneratedDbApi.getConfig() when available
        GeneratedDbApi generatedApi = generatedApis.get(normalizedBaseUrl);
        if (generatedApi == null) {
            generatedApi = generatedApis.get("");
        }
        if (generatedApi != null) {
            try {
                Object result = generatedApi.getConfig();
                if (!(result instanceof Map)) {
                    throw new CaptchaUnavailableException("config_invalid_response");
                }
                Map<String, Object> config = (Map<String, Object>) result;
                String siteKey = extractSiteKey(config);
                cacheSiteKey(normalizedBaseUrl, siteKey);
                return siteKey;
            } catch (CaptchaUnavailableException error) {
                throw error;
            } catch (IllegalStateException error) {
                String reason = "Invalid JSON response body".equals(error.getMessage())
                    ? "config_invalid_response"
                    : "config_fetch_failed";
                throw new CaptchaUnavailableException(reason, error);
            } catch (Exception error) {
                throw new CaptchaUnavailableException("config_fetch_failed", error);
            }
        }

        // Fallback: raw HTTP (for cases where GeneratedDbApi is not yet initialized)
        HttpURLConnection conn = null;
        try {
            URL url = new URL(normalizedBaseUrl + GeneratedDbApi.ApiPaths.GET_CONFIG);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(10_000);
            conn.setReadTimeout(10_000);
            int status = conn.getResponseCode();
            if (status != 200) {
                throw new CaptchaUnavailableException(
                    "config_fetch_failed",
                    new IllegalStateException("GET /api/config returned HTTP " + status)
                );
            }
            Gson gson = new Gson();
            Map<String, Object> config;
            try (InputStreamReader reader = new InputStreamReader(
                    conn.getInputStream(), StandardCharsets.UTF_8)) {
                config = gson.fromJson(
                    reader,
                    new TypeToken<Map<String, Object>>(){}.getType()
                );
            } catch (RuntimeException error) {
                throw new CaptchaUnavailableException("config_invalid_response", error);
            }
            if (config == null) {
                throw new CaptchaUnavailableException("config_invalid_response");
            }
            String siteKey = extractSiteKey(config);
            cacheSiteKey(normalizedBaseUrl, siteKey);
            return siteKey;
        } catch (CaptchaUnavailableException error) {
            throw error;
        } catch (Exception error) {
            throw new CaptchaUnavailableException("config_fetch_failed", error);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static String normalizeBaseUrl(String baseUrl) {
        if (baseUrl == null) {
            return "";
        }
        return baseUrl.replaceAll("/+$", "");
    }

    @SuppressWarnings("unchecked")
    private static String extractSiteKey(Map<String, Object> config) {
        if (!config.containsKey("captcha")) {
            throw new CaptchaUnavailableException("config_invalid_response");
        }
        Object captchaValue = config.get("captcha");
        if (captchaValue == null) return null;
        if (!(captchaValue instanceof Map)) {
            throw new CaptchaUnavailableException("config_invalid_response");
        }
        Map<String, Object> captcha = (Map<String, Object>) captchaValue;
        if (!captcha.containsKey("siteKey")) {
            throw new CaptchaUnavailableException("config_invalid_response");
        }
        Object siteKeyValue = captcha.get("siteKey");
        if (!(siteKeyValue instanceof String)) {
            throw new CaptchaUnavailableException("config_invalid_response");
        }
        String siteKey = (String) siteKeyValue;
        if (siteKey.isBlank() || siteKey.getBytes(StandardCharsets.UTF_8).length > 512) {
            throw new CaptchaUnavailableException("config_invalid_response");
        }
        return siteKey;
    }

    @SuppressLint("SetJavaScriptEnabled")
    private static String acquireToken(String baseUrl, String action) throws Exception {
        Activity activity = AndroidActivityTracker.getCurrentActivity();
        Context ctx = activity != null ? activity : ensureContext();
        String channel = secureChannel();
        String challengeUrl = buildChallengeUrl(baseUrl, action, channel);

        CompletableFuture<String> future = new CompletableFuture<>();
        Handler handler = new Handler(Looper.getMainLooper());
        AtomicReference<Runnable> cleanupRef = new AtomicReference<>();

        handler.post(() -> {
            if (future.isDone()) return;
            final WebView webView;
            try {
                webView = new WebView(ctx);
            } catch (RuntimeException error) {
                fail(future, "webview_initialization_failed", error);
                return;
            }
            WebSettings settings = webView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(false);
            settings.setSupportMultipleWindows(false);
            settings.setJavaScriptCanOpenWindowsAutomatically(false);
            settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            CookieManager.getInstance().setAcceptCookie(true);
            try {
                CookieManager.class
                    .getMethod("setAcceptThirdPartyCookies", WebView.class, boolean.class)
                    .invoke(CookieManager.getInstance(), webView, true);
            } catch (Exception ignored) {
                // API < 21 has no third-party-cookie toggle. The package min
                // runtime is newer, but keep host-side compilation portable.
            }

            // Overlay reference for interactive challenge (array for mutation in lambda)
            final FrameLayout[] overlayRef = {null};
            final AtomicBoolean cleaned = new AtomicBoolean(false);

            // Cleanup: remove overlay and destroy WebView
            final Runnable cleanup = () -> handler.post(() -> {
                if (!cleaned.compareAndSet(false, true)) return;
                if (overlayRef[0] != null) {
                    ViewGroup parent = (ViewGroup) overlayRef[0].getParent();
                    if (parent != null) parent.removeView(overlayRef[0]);
                    overlayRef[0] = null;
                }
                webView.removeJavascriptInterface("EdgeBaseCaptchaBridge");
                webView.stopLoading();
                webView.setWebViewClient(null);
                webView.destroy();
            });
            cleanupRef.set(cleanup);

            java.util.function.Consumer<String> handleMessage = raw -> {
                String[] message = parseBridgeMessage(raw, channel);
                if (message == null || future.isDone()) return;
                if ("token".equals(message[0])) {
                    future.complete(message[1]);
                    cleanup.run();
                } else if ("error".equals(message[0])) {
                    fail(future, bridgeFailureReason(message[1]));
                    cleanup.run();
                } else if ("interactive".equals(message[0])) {
                    handler.post(() -> {
                        if ("show".equals(message[1])) {
                            Activity current = AndroidActivityTracker.getCurrentActivity();
                            if (current == null || current.isFinishing()) {
                                fail(future, "activity_unavailable");
                                cleanup.run();
                                return;
                            }
                            FrameLayout contentView = (FrameLayout) current.findViewById(android.R.id.content);
                            if (contentView == null) {
                                fail(future, "activity_content_unavailable");
                                cleanup.run();
                                return;
                            }
                            ViewGroup parent = (ViewGroup) webView.getParent();
                            if (parent != null) parent.removeView(webView);
                            FrameLayout overlay = new FrameLayout(current);
                            overlay.setBackgroundColor(Color.argb(128, 0, 0, 0));
                            overlay.setLayoutParams(new FrameLayout.LayoutParams(
                                FrameLayout.LayoutParams.MATCH_PARENT,
                                FrameLayout.LayoutParams.MATCH_PARENT
                            ));
                            FrameLayout.LayoutParams webViewParams = new FrameLayout.LayoutParams(
                                FrameLayout.LayoutParams.WRAP_CONTENT,
                                FrameLayout.LayoutParams.WRAP_CONTENT
                            );
                            webViewParams.gravity = Gravity.CENTER;
                            overlay.addView(webView, webViewParams);
                            contentView.addView(overlay);
                            overlayRef[0] = overlay;
                        } else if ("hide".equals(message[1]) && overlayRef[0] != null) {
                            ViewGroup parent = (ViewGroup) overlayRef[0].getParent();
                            if (parent != null) parent.removeView(overlayRef[0]);
                            overlayRef[0] = null;
                        }
                    });
                }
            };

            webView.addJavascriptInterface(new Object() {
                @JavascriptInterface
                public void postMessage(String raw) {
                    handleMessage.accept(raw);
                }
            }, "EdgeBaseCaptchaBridge");

            webView.setWebViewClient(new WebViewClient() {
                private boolean blockUnexpectedMainNavigation(String url) {
                    if (challengeUrl.equals(url)) return false;
                    if (fail(future, "unexpected_navigation")) cleanup.run();
                    return true;
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView view, String url) {
                    return blockUnexpectedMainNavigation(url);
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    if (request == null || !request.isForMainFrame()) return false;
                    return blockUnexpectedMainNavigation(request.getUrl().toString());
                }

                @Override
                public void onReceivedError(
                    WebView view,
                    WebResourceRequest request,
                    WebResourceError error
                ) {
                    if (request != null && request.isForMainFrame() &&
                        fail(future, "challenge_load_failed")) cleanup.run();
                }

                @Override
                public void onReceivedError(
                    WebView view,
                    int errorCode,
                    String description,
                    String failingUrl
                ) {
                    if (challengeUrl.equals(failingUrl) &&
                        fail(future, "challenge_load_failed")) cleanup.run();
                }

                @Override
                public void onReceivedHttpError(
                    WebView view,
                    WebResourceRequest request,
                    WebResourceResponse response
                ) {
                    if (request != null && request.isForMainFrame() && response != null &&
                        response.getStatusCode() >= 400 &&
                        fail(future, "challenge_http_" + response.getStatusCode())) cleanup.run();
                }

                @Override
                public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                    if (fail(future, "renderer_terminated")) cleanup.run();
                    return true;
                }
            });
            webView.loadUrl(challengeUrl);
        });

        try {
            return future.get(30, TimeUnit.SECONDS);
        } catch (TimeoutException timeout) {
            throw new CaptchaUnavailableException("timeout", timeout);
        } catch (ExecutionException execution) {
            Throwable cause = execution.getCause();
            if (cause instanceof CaptchaUnavailableException) {
                throw (CaptchaUnavailableException) cause;
            }
            throw new CaptchaUnavailableException("acquisition_failed", cause);
        } finally {
            Runnable cleanup = cleanupRef.get();
            if (cleanup != null) cleanup.run();
            else future.cancel(true);
        }
    }

    static String buildChallengeUrl(String baseUrl, String action, String channel) throws Exception {
        if (!java.util.Set.of(
            "signup", "signin", "anonymous", "magic-link", "phone",
            "password-reset", "oauth", "function"
        ).contains(action) || !channel.matches("^[A-Za-z0-9_-]{22,64}$")) {
            throw new IllegalArgumentException("Invalid Turnstile action or channel.");
        }
        URI base = URI.create(normalizeBaseUrl(baseUrl));
        if (!"https".equalsIgnoreCase(base.getScheme()) || base.getHost() == null ||
            base.getUserInfo() != null || base.getQuery() != null || base.getFragment() != null) {
            throw new IllegalArgumentException("Turnstile requires an HTTPS EdgeBase base URL.");
        }
        if (base.getPath() != null && !base.getPath().isEmpty() && !"/".equals(base.getPath())) {
            throw new IllegalArgumentException("Turnstile EdgeBase base URL must be origin-only.");
        }
        return normalizeBaseUrl(baseUrl) + "/api/captcha/challenge" +
            "?action=" + action + "&channel=" + channel + "&bridge=android";
    }

    private static String secureChannel() {
        try {
            byte[] bytes = new byte[16];
            new SecureRandom().nextBytes(bytes);
            StringBuilder result = new StringBuilder(32);
            for (byte value : bytes) result.append(String.format("%02x", value & 0xff));
            return result.toString();
        } catch (RuntimeException error) {
            throw new CaptchaUnavailableException("secure_random_unavailable", error);
        }
    }

    private static boolean fail(CompletableFuture<String> future, String reason) {
        return fail(future, reason, null);
    }

    private static boolean fail(CompletableFuture<String> future, String reason, Throwable cause) {
        return future.completeExceptionally(new CaptchaUnavailableException(reason, cause));
    }

    private static String bridgeFailureReason(String value) {
        if (value == null || value.isBlank()) return "challenge_error";
        String normalized = value.toLowerCase(java.util.Locale.ROOT)
            .replaceAll("[^a-z0-9_-]", "_");
        if (normalized.length() > 128) normalized = normalized.substring(0, 128);
        return "challenge_" + normalized;
    }

    @SuppressWarnings("unchecked")
    static String[] parseBridgeMessage(String raw, String channel) {
        if (raw == null || raw.getBytes(StandardCharsets.UTF_8).length > 4096) return null;
        try {
            Map<String, Object> payload = new Gson().fromJson(
                raw,
                new TypeToken<Map<String, Object>>(){}.getType()
            );
            if (payload == null || !(payload.get("v") instanceof Number) ||
                ((Number) payload.get("v")).intValue() != 1 ||
                !channel.equals(payload.get("channel")) ||
                !(payload.get("type") instanceof String) ||
                !(payload.get("value") instanceof String)) return null;
            String type = (String) payload.get("type");
            String value = (String) payload.get("value");
            if ("token".equals(type) && !value.isEmpty() && value.length() <= 2048) {
                return new String[]{type, value};
            }
            if ("error".equals(type)) return new String[]{type, value.substring(0, Math.min(256, value.length()))};
            if ("interactive".equals(type) && ("show".equals(value) || "hide".equals(value))) {
                return new String[]{type, value};
            }
            if ("ready".equals(type) && value.length() <= 32) return new String[]{type, value};
        } catch (Exception ignored) {}
        return null;
    }
}
