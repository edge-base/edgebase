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
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import com.unity3d.player.UnityPlayer;

import org.json.JSONObject;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public final class EdgeBaseTurnstileBridge {
    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static final Map<String, RequestState> REQUESTS = new ConcurrentHashMap<>();

    private EdgeBaseTurnstileBridge() {
    }

    public static void requestToken(String gameObjectName, String requestId, String html) {
        MAIN.post(() -> startRequest(gameObjectName, requestId, html));
    }

    public static void cancelTokenRequest(String requestId) {
        MAIN.post(() -> cancelRequest(requestId));
    }

    @SuppressLint("SetJavaScriptEnabled")
    private static void startRequest(String gameObjectName, String requestId, String html) {
        Activity activity = UnityPlayer.currentActivity;
        if (activity == null || activity.isFinishing()) {
            sendMessage(gameObjectName, requestId, "error", "android-activity-unavailable");
            return;
        }

        cancelRequest(requestId);

        WebView webView = new WebView(activity);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            cookieManager.setAcceptThirdPartyCookies(webView, true);
        }

        RequestState state = new RequestState(gameObjectName, requestId, webView);
        REQUESTS.put(requestId, state);

        webView.setWebViewClient(new BridgeClient(requestId));
        webView.loadDataWithBaseURL(
            "https://challenges.cloudflare.com",
            html,
            "text/html",
            "UTF-8",
            null
        );
    }

    private static void cancelRequest(String requestId) {
        RequestState state = REQUESTS.remove(requestId);
        if (state == null) {
            return;
        }

        if (state.dialog != null && state.dialog.isShowing()) {
            state.dialog.dismiss();
        }

        ViewGroup parent = (ViewGroup) state.webView.getParent();
        if (parent != null) {
            parent.removeView(state.webView);
        }
        state.webView.stopLoading();
        state.webView.destroy();
    }

    private static void showInteractiveDialog(RequestState state) {
        Activity activity = UnityPlayer.currentActivity;
        if (activity == null || activity.isFinishing()) {
            sendMessage(state.gameObjectName, state.requestId, "error", "android-activity-unavailable");
            cancelRequest(state.requestId);
            return;
        }

        if (state.dialog != null && state.dialog.isShowing()) {
            return;
        }

        Dialog dialog = new Dialog(activity, android.R.style.Theme_Translucent_NoTitleBar_Fullscreen);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        dialog.setCancelable(false);

        Window window = dialog.getWindow();
        if (window != null) {
            window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        }

        FrameLayout overlay = new FrameLayout(activity);
        overlay.setLayoutParams(new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));
        overlay.setBackgroundColor(Color.argb(160, 7, 10, 16));

        FrameLayout card = new FrameLayout(activity);
        GradientDrawable cardBackground = new GradientDrawable();
        cardBackground.setColor(Color.WHITE);
        cardBackground.setCornerRadius(dp(activity, 18));
        card.setBackground(cardBackground);
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

        ViewGroup previousParent = (ViewGroup) state.webView.getParent();
        if (previousParent != null) {
            previousParent.removeView(state.webView);
        }

        card.addView(state.webView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));
        overlay.addView(card, cardParams);
        dialog.setContentView(overlay);
        dialog.show();

        state.dialog = dialog;
    }

    private static void handleBridgeUri(String requestId, Uri uri) {
        RequestState state = REQUESTS.get(requestId);
        if (state == null) {
            return;
        }

        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();
        String value = "";
        String encodedPath = uri.getEncodedPath();
        if (encodedPath != null && encodedPath.length() > 1) {
            value = Uri.decode(encodedPath.substring(1));
        }

        switch (host) {
            case "token":
                sendMessage(state.gameObjectName, requestId, "token", value);
                cancelRequest(requestId);
                break;
            case "error":
                sendMessage(state.gameObjectName, requestId, "error", value);
                cancelRequest(requestId);
                break;
            case "interactive":
                if ("show".equals(value)) {
                    showInteractiveDialog(state);
                } else if ("hide".equals(value)) {
                    if (state.dialog != null && state.dialog.isShowing()) {
                        state.dialog.dismiss();
                    }
                    state.dialog = null;
                }
                break;
            default:
                sendMessage(state.gameObjectName, requestId, "debug", uri.toString());
                break;
        }
    }

    private static void sendMessage(String gameObjectName, String requestId, String type, String value) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("requestId", requestId == null ? "" : requestId);
            payload.put("type", type == null ? "" : type);
            payload.put("value", value == null ? "" : value);
            UnityPlayer.UnitySendMessage(gameObjectName, "OnEdgeBaseCaptchaTokenMessage", payload.toString());
        } catch (Exception exception) {
            UnityPlayer.UnitySendMessage(gameObjectName, "OnEdgeBaseCaptchaTokenMessage",
                "{\"requestId\":\"" + requestId + "\",\"type\":\"error\",\"value\":\"bridge-json-error\"}");
        }
    }

    private static int dp(Activity activity, int value) {
        return Math.round(TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value,
            activity.getResources().getDisplayMetrics()
        ));
    }

    private static final class RequestState {
        final String gameObjectName;
        final String requestId;
        final WebView webView;
        Dialog dialog;

        RequestState(String gameObjectName, String requestId, WebView webView) {
            this.gameObjectName = gameObjectName;
            this.requestId = requestId;
            this.webView = webView;
        }
    }

    private static final class BridgeClient extends WebViewClient {
        private final String requestId;

        BridgeClient(String requestId) {
            this.requestId = requestId;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return handle(url);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request != null ? request.getUrl() : null;
            return uri != null && handle(uri.toString());
        }

        private boolean handle(String url) {
            if (url == null || !url.startsWith("edgebase://")) {
                return false;
            }

            handleBridgeUri(requestId, Uri.parse(url));
            return true;
        }
    }
}
