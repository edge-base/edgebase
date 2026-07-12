package dev.edgebase.unity;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.Dialog;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import com.unity3d.player.UnityPlayer;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

/** Hosted Turnstile bridge used by the EdgeBase Unity package on Android. */
public final class EdgeBaseTurnstileBridge {
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final Map<String, RequestState> REQUESTS = new ConcurrentHashMap<>();

    private EdgeBaseTurnstileBridge() {}

    public static void requestToken(
        String gameObjectName,
        String requestId,
        String challengeUrl,
        String channel
    ) {
        MAIN.post(() -> startRequest(gameObjectName, requestId, challengeUrl, channel));
    }

    public static void cancelTokenRequest(String requestId) {
        MAIN.post(() -> cleanup(requestId));
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private static void startRequest(
        String gameObjectName,
        String requestId,
        String challengeUrl,
        String channel
    ) {
        Activity activity = UnityPlayer.currentActivity;
        if (activity == null || activity.isFinishing()) {
            sendMessage(gameObjectName, requestId, "error", "android-activity-unavailable");
            return;
        }
        if (!isValidChallengeUrl(challengeUrl, channel)) {
            sendMessage(gameObjectName, requestId, "error", "invalid-challenge-url");
            return;
        }

        cleanup(requestId);
        final WebView webView;
        try {
            webView = new WebView(activity);
        } catch (RuntimeException error) {
            sendMessage(gameObjectName, requestId, "error", "webview-initialization-failed");
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
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cookies.setAcceptThirdPartyCookies(webView, true);
        }

        RequestState state = new RequestState(
            gameObjectName,
            requestId,
            challengeUrl,
            channel,
            webView
        );
        REQUESTS.put(requestId, state);
        webView.addJavascriptInterface(new UnityBridge(state), "Unity");
        webView.setWebViewClient(new BridgeClient(state));
        try {
            webView.loadUrl(challengeUrl);
        } catch (RuntimeException error) {
            finish(state, "error", "load-failed");
        }
    }

    private static boolean isValidChallengeUrl(String value, String channel) {
        if (value == null || channel == null || !channel.matches("[A-Za-z0-9_-]{22,64}")) {
            return false;
        }
        Uri uri = Uri.parse(value);
        return "https".equalsIgnoreCase(uri.getScheme())
            && uri.getHost() != null
            && uri.getUserInfo() == null
            && "/api/captcha/challenge".equals(uri.getPath())
            && channel.equals(uri.getQueryParameter("channel"))
            && "unity".equals(uri.getQueryParameter("bridge"))
            && uri.getFragment() == null;
    }

    private static void handleHostedMessage(RequestState state, String json) {
        if (json == null || json.getBytes(StandardCharsets.UTF_8).length > 4096) return;
        try {
            JSONObject message = new JSONObject(json);
            if (message.optInt("v", -1) != 1) return;
            if (!state.channel.equals(message.optString("channel", ""))) return;
            String type = message.optString("type", "");
            String value = message.optString("value", "");
            if ("token".equals(type)) {
                if (value.isEmpty() || value.length() > 2048) {
                    finish(state, "error", "invalid-token");
                } else {
                    finish(state, "token", value);
                }
            } else if ("error".equals(type)) {
                finish(state, "error", value.substring(0, Math.min(value.length(), 256)));
            } else if ("interactive".equals(type)) {
                if ("show".equals(value)) showInteractiveDialog(state);
                else if ("hide".equals(value)) hideInteractiveDialog(state);
            }
        } catch (Exception ignored) {
            // Ignore malformed/unbound messages. The SDK timeout remains authoritative.
        }
    }

    private static void finish(RequestState state, String type, String value) {
        if (!state.terminal.compareAndSet(false, true)) return;
        sendMessage(state.gameObjectName, state.requestId, type, value);
        cleanup(state.requestId);
    }

    private static void cleanup(String requestId) {
        RequestState state = REQUESTS.remove(requestId);
        if (state == null) return;
        if (state.dialog != null && state.dialog.isShowing()) state.dialog.dismiss();
        ViewGroup parent = (ViewGroup) state.webView.getParent();
        if (parent != null) parent.removeView(state.webView);
        state.webView.removeJavascriptInterface("Unity");
        state.webView.stopLoading();
        state.webView.setWebViewClient(null);
        state.webView.destroy();
    }

    private static void showInteractiveDialog(RequestState state) {
        Activity activity = UnityPlayer.currentActivity;
        if (activity == null || activity.isFinishing()) {
            finish(state, "error", "android-activity-unavailable");
            return;
        }
        if (state.dialog != null && state.dialog.isShowing()) return;

        Dialog dialog = new Dialog(activity, android.R.style.Theme_Translucent_NoTitleBar_Fullscreen);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        dialog.setCancelable(false);
        Window window = dialog.getWindow();
        if (window != null) {
            window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        }

        FrameLayout overlay = new FrameLayout(activity);
        overlay.setBackgroundColor(Color.argb(160, 7, 10, 16));
        FrameLayout card = new FrameLayout(activity);
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.WHITE);
        background.setCornerRadius(dp(activity, 18));
        card.setBackground(background);
        int padding = dp(activity, 12);
        card.setPadding(padding, padding, padding, padding);
        FrameLayout.LayoutParams cardParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            dp(activity, 340)
        );
        int margin = dp(activity, 18);
        cardParams.leftMargin = margin;
        cardParams.rightMargin = margin;
        cardParams.gravity = Gravity.CENTER;

        ViewGroup oldParent = (ViewGroup) state.webView.getParent();
        if (oldParent != null) oldParent.removeView(state.webView);
        card.addView(state.webView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));
        overlay.addView(card, cardParams);
        dialog.setContentView(overlay);
        dialog.show();
        state.dialog = dialog;
    }

    private static void hideInteractiveDialog(RequestState state) {
        if (state.dialog != null && state.dialog.isShowing()) state.dialog.dismiss();
        state.dialog = null;
    }

    private static void sendMessage(
        String gameObjectName,
        String requestId,
        String type,
        String value
    ) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("requestId", requestId == null ? "" : requestId);
            payload.put("type", type == null ? "" : type);
            payload.put("value", value == null ? "" : value);
            UnityPlayer.UnitySendMessage(
                gameObjectName,
                "OnEdgeBaseCaptchaTokenMessage",
                payload.toString()
            );
        } catch (Exception ignored) {
            UnityPlayer.UnitySendMessage(
                gameObjectName,
                "OnEdgeBaseCaptchaTokenMessage",
                "{\"requestId\":\"\",\"type\":\"error\",\"value\":\"bridge-json-error\"}"
            );
        }
    }

    private static int dp(Activity activity, int value) {
        return Math.round(TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value,
            activity.getResources().getDisplayMetrics()
        ));
    }

    private static final class UnityBridge {
        private final RequestState state;

        UnityBridge(RequestState state) {
            this.state = state;
        }

        @JavascriptInterface
        public void call(String message) {
            MAIN.post(() -> handleHostedMessage(state, message));
        }
    }

    private static final class RequestState {
        final String gameObjectName;
        final String requestId;
        final String challengeUrl;
        final String channel;
        final WebView webView;
        final AtomicBoolean terminal = new AtomicBoolean(false);
        Dialog dialog;

        RequestState(
            String gameObjectName,
            String requestId,
            String challengeUrl,
            String channel,
            WebView webView
        ) {
            this.gameObjectName = gameObjectName;
            this.requestId = requestId;
            this.challengeUrl = challengeUrl;
            this.channel = channel;
            this.webView = webView;
        }
    }

    private static final class BridgeClient extends WebViewClient {
        private final RequestState state;

        BridgeClient(RequestState state) {
            this.state = state;
        }

        private boolean allowOrFail(String value, boolean mainFrame) {
            if (!mainFrame) return false;
            if (state.challengeUrl.equals(value)) return false;
            finish(state, "error", "navigation-blocked");
            return true;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return allowOrFail(url, true);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return request != null && allowOrFail(
                request.getUrl().toString(),
                request.isForMainFrame()
            );
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request != null && request.isForMainFrame()) finish(state, "error", "load-failed");
        }

        @Override
        public void onReceivedHttpError(
            WebView view,
            WebResourceRequest request,
            WebResourceResponse response
        ) {
            if (request != null && request.isForMainFrame() && response != null
                && response.getStatusCode() >= 400) {
                finish(state, "error", "http-error");
            }
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            finish(state, "error", "renderer-terminated");
            return true;
        }
    }
}
