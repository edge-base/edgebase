// PushClient — Client-side push notification management.
//
// `register()` — requires tokenProvider to be set first (via setFcmTokenProvider).
// The app integrates firebase-messaging and passes its FCM token provider.
//
// Usage:
//   client.push().setFcmTokenProvider(() -> FirebaseMessaging.getInstance().getToken(...));
//   client.push().register();
//   client.push().register(Map.of("topic", "news"));
package dev.edgebase.sdk.client;

import dev.edgebase.sdk.core.*;

import java.util.Map;

/**
 * Client-side push notification management.
 * Auto-acquires FCM token — no tokenProvider needed.
 */
public class PushClient {
    private final HttpClient client;
    private final java.util.List<java.util.function.Consumer<Map<String, Object>>> messageListeners = new java.util.ArrayList<>();
    private final java.util.List<java.util.function.Consumer<Map<String, Object>>> openedAppListeners = new java.util.ArrayList<>();

    private java.util.function.Supplier<String> permissionStatusProvider;
    private java.util.function.Supplier<String> permissionRequester;

    /** FCM token provider — must be set before calling register(). */
    private java.util.concurrent.Callable<String> fcmTokenProvider;

    /** Topic subscription handlers — set via setTopicHandlers() (FCM 일원화). */
    private java.util.function.Consumer<String> topicSubscribeHandler;
    private java.util.function.Consumer<String> topicUnsubscribeHandler;

    // Internal device ID and token cache
    private String cachedDeviceId;
    private String cachedToken;

    public PushClient(HttpClient client) {
        this.client = client;
        // SDK-internal defaults — auto-handle POST_NOTIFICATIONS on Android 13+.
        // Developers can override with setPermissionStatusProvider() / setPermissionRequester().
        this.permissionStatusProvider = PushClient::defaultPermissionStatus;
        this.permissionRequester = PushClient::defaultPermissionRequest;
    }

    private String getOrCreateDeviceId() {
        if (cachedDeviceId != null)
            return cachedDeviceId;
        cachedDeviceId = java.util.UUID.randomUUID().toString();
        return cachedDeviceId;
    }

    /**
     * Register for push notifications.
     * Auto-acquires FCM token, caches, sends to server only on change (§9).
     */
    public void register() {
        register(null);
    }

    /**
     * Register for push notifications with optional metadata.
     */
    public void register(Map<String, Object> metadata) {
        // 1. Request permission
        String perm = requestPermission();
        if (!"granted".equals(perm))
            return;

        // 2. Get FCM token via tokenProvider (must be set by caller using
        // setFcmTokenProvider)
        String token;
        try {
            if (fcmTokenProvider == null)
                throw new IllegalStateException("FCM token provider not set. Call setFcmTokenProvider() first.");
            token = fcmTokenProvider.call();
        } catch (IllegalStateException e) {
            throw e;
        } catch (Exception e) {
            throw new RuntimeException("Failed to get FCM token.", e);
        }

        // 3. Check cache — skip if unchanged (§9), unless metadata provided
        if (token.equals(cachedToken) && metadata == null)
            return;

        // 4. Register with server — auto-collect deviceInfo
        String deviceId = getOrCreateDeviceId();
        Map<String, Object> deviceInfo = new java.util.HashMap<>();
        if (isAndroidRuntime()) {
            deviceInfo.put("name", android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL);
            deviceInfo.put("osVersion", "Android " + android.os.Build.VERSION.RELEASE);
        } else {
            deviceInfo.put("name", System.getProperty("os.name", "JVM"));
            deviceInfo.put("osVersion", System.getProperty("os.version", "unknown"));
        }
        deviceInfo.put("locale", java.util.Locale.getDefault().toLanguageTag());

        Map<String, Object> body = new java.util.HashMap<>();
        body.put("deviceId", deviceId);
        body.put("token", token);
        body.put("platform", "android");
        body.put("deviceInfo", deviceInfo);
        if (metadata != null)
            body.put("metadata", metadata);
        client.post("/push/register", body);
        cachedToken = token;
    }

    /** Unregister current device (or a specific device by ID). */
    public void unregister(String deviceId) {
        client.post("/push/unregister", Map.of("deviceId", deviceId != null ? deviceId : getOrCreateDeviceId()));
        cachedToken = null;
    }

    /** Unregister current device. */
    public void unregister() {
        unregister(null);
    }

    /** Listen for push messages in foreground. */
    public void onMessage(java.util.function.Consumer<Map<String, Object>> callback) {
        messageListeners.add(callback);
    }

    /** Listen for notification taps that opened the app. */
    public void onMessageOpenedApp(java.util.function.Consumer<Map<String, Object>> callback) {
        openedAppListeners.add(callback);
    }

    /**
     * Get notification permission status. Returns
     * "granted"|"denied"|"notDetermined".
     */
    public String getPermissionStatus() {
        return permissionStatusProvider != null ? permissionStatusProvider.get() : "notDetermined";
    }

    /** Set provider for permission status (platform-specific). */
    public void setPermissionStatusProvider(java.util.function.Supplier<String> provider) {
        this.permissionStatusProvider = provider;
    }

    /** Request notification permission from the user. */
    public String requestPermission() {
        return permissionRequester != null ? permissionRequester.get() : "denied";
    }

    /** Set provider for permission request (platform-specific). */
    public void setPermissionRequester(java.util.function.Supplier<String> requester) {
        this.permissionRequester = requester;
    }

    /**
     * Set the FCM token provider.
     * The app must inject its own TokenProvider that calls FirebaseMessaging.
     * Example: client.push().setFcmTokenProvider(() ->
     * Tasks.await(FirebaseMessaging.getInstance().getToken()));
     */
    public void setFcmTokenProvider(java.util.concurrent.Callable<String> provider) {
        this.fcmTokenProvider = provider;
    }

    /**
     * Set topic subscription handlers.
     * Example: client.push().setTopicHandlers(
     *   topic -> FirebaseMessaging.getInstance().subscribeToTopic(topic),
     *   topic -> FirebaseMessaging.getInstance().unsubscribeFromTopic(topic)
     * );
     */
    public void setTopicHandlers(java.util.function.Consumer<String> subscribe, java.util.function.Consumer<String> unsubscribe) {
        this.topicSubscribeHandler = subscribe;
        this.topicUnsubscribeHandler = unsubscribe;
    }

    /** Subscribe to a push notification topic. */
    public void subscribeTopic(String topic) {
        if (topicSubscribeHandler == null)
            throw new IllegalStateException("Topic handlers not set. Call setTopicHandlers() first.");
        topicSubscribeHandler.accept(topic);
    }

    /** Unsubscribe from a push notification topic. */
    public void unsubscribeTopic(String topic) {
        if (topicUnsubscribeHandler == null)
            throw new IllegalStateException("Topic handlers not set. Call setTopicHandlers() first.");
        topicUnsubscribeHandler.accept(topic);
    }

    /** Dispatch a foreground message. Called from FirebaseMessagingService. */
    public void dispatchMessage(Map<String, Object> message) {
        for (var cb : messageListeners)
            cb.accept(message);
    }

    /**
     * Dispatch a notification-opened event. Called from Activity intent handling.
     */
    public void dispatchMessageOpenedApp(Map<String, Object> message) {
        for (var cb : openedAppListeners)
            cb.accept(message);
    }

    private static String defaultPermissionStatus() {
        if (!isAndroidRuntime()) {
            return "notDetermined";
        }
        try {
            return PushPermissionHelper.getPermissionStatus();
        } catch (Throwable ignored) {
            return "notDetermined";
        }
    }

    private static String defaultPermissionRequest() {
        if (!isAndroidRuntime()) {
            return "denied";
        }
        try {
            return PushPermissionHelper.requestPermission();
        } catch (Throwable ignored) {
            return "denied";
        }
    }

    private static boolean isAndroidRuntime() {
        try {
            Class.forName("android.os.Build");
            return true;
        } catch (Throwable ignored) {
            return false;
        }
    }
}
