// EdgeBase Java SDK — Database live transport.
// OkHttp WebSocket-based DB subscription transport with auto-reconnect and message-based auth.
// Supports table subscriptions and server-side filters.
package dev.edgebase.sdk.client;

import dev.edgebase.sdk.core.*;
import dev.edgebase.sdk.core.generated.GeneratedDbApi;

import com.google.gson.Gson;
import okhttp3.*;

import java.io.Closeable;
import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;

/**
 * DatabaseLive client using OkHttp WebSocket with automatic reconnection
 * and message-based authentication.
 *
 * <p>The server (DatabaseLiveDO) ignores HTTP Authorization headers for WebSocket
 * connections. Authentication is performed by sending a {@code {"type":"auth"}}
 * message immediately after the WebSocket opens.
 *
 * <p>
 * Usage:
 *
 * <pre>{@code
 * // Table subscription
 * var sub = client.db("shared").table("posts").onSnapshot(change -> System.out.println(change));
 * sub.close(); // unsubscribe
 *
 * // Collection subscription
 * var sub = client.db("shared").table("posts").onSnapshot(change -> System.out.println(change));
 * sub.close();
 * }</pre>
 */
class DatabaseLiveClient implements dev.edgebase.sdk.core.DatabaseLiveClient {
    private static final Gson gson = new Gson();
    private static final String SDK_VERSION = "0.2.5";

    private final String url;
    private final TokenManager tokenManager;
    private final OkHttpClient okHttpClient;

    private WebSocket webSocket;
    private volatile boolean isConnected;
    private volatile boolean authenticated;
    private volatile boolean waitingForAuth;
    private volatile boolean shouldReconnect = true;
    private volatile int reconnectAttempts;
    private final List<Consumer<Map<String, Object>>> messageListeners = new CopyOnWriteArrayList<>();
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "edgebase-dblive");
        t.setDaemon(true);
        return t;
    });

    /** Channels the client is currently subscribed to. */
    private final Set<String> subscribedChannels = ConcurrentHashMap.newKeySet();

    /** Server-side filters per channel for recovery after FILTER_RESYNC. */
    private final ConcurrentHashMap<String, List<FilterTuple>> channelFilters = new ConcurrentHashMap<>();

    /** Server-side OR filters per channel for recovery after FILTER_RESYNC. */
    private final ConcurrentHashMap<String, List<FilterTuple>> channelOrFilters = new ConcurrentHashMap<>();

    DatabaseLiveClient(String url, TokenManager tokenManager) {
        this.url = url;
        this.tokenManager = tokenManager;
        this.okHttpClient = new OkHttpClient.Builder()
                .readTimeout(0, TimeUnit.MILLISECONDS)
                .build();
        this.tokenManager.setOnAuthStateChange(this::handleAuthStateChange);
    }

    private static String normalizeDatabaseLiveChannel(String tableOrChannel) {
        return tableOrChannel.startsWith("dblive:") ? tableOrChannel : "dblive:" + tableOrChannel;
    }

    private static boolean matchesDatabaseLiveChannel(String channel, DbChange change, String messageChannel) {
        if (messageChannel != null && !messageChannel.isBlank()) {
            return Objects.equals(channel, normalizeDatabaseLiveChannel(messageChannel));
        }
        String[] parts = channel.split(":");
        if (parts.length == 0 || !"dblive".equals(parts[0])) {
            return false;
        }
        return switch (parts.length) {
            case 2 -> Objects.equals(parts[1], change.getTable());
            case 3 -> Objects.equals(parts[2], change.getTable());
            case 4 -> (Objects.equals(parts[2], change.getTable()) && Objects.equals(parts[3], change.getId()))
                    || Objects.equals(parts[3], change.getTable());
            default -> Objects.equals(parts[3], change.getTable()) && Objects.equals(parts[4], change.getId());
        };
    }

    private static String channelTableName(String channel) {
        String[] parts = channel.split(":");
        if (parts.length <= 1) {
            return channel;
        }
        if (parts.length == 2) {
            return parts[1];
        }
        if (parts.length == 3) {
            return parts[2];
        }
        return parts[3];
    }

    // ─── Connection ───

    private synchronized void ensureConnected(String channel) {
        if (isConnected)
            return;
        connect(channel);
    }

    private void connect(String channel) {
        String wsBase = url.replace("https://", "wss://").replace("http://", "ws://")
                + GeneratedDbApi.ApiPaths.CONNECT_DATABASE_SUBSCRIPTION;
        String wsUrl = channel != null
                ? wsBase + "?channel=" + URLEncoder.encode(channel, StandardCharsets.UTF_8)
                : wsBase;

        // No Authorization header — server ignores HTTP headers for WS auth.
        // Auth is performed via message after connection opens.
        Request request = new Request.Builder().url(wsUrl).build();

        webSocket = okHttpClient.newWebSocket(request, new WebSocketListener() {
            @Override
            public void onOpen(WebSocket ws, Response response) {
                isConnected = true;
                authenticated = false;
                // Send auth message immediately (message-based auth)
                sendAuthMessage();
            }

            @Override
            @SuppressWarnings("unchecked")
            public void onMessage(WebSocket ws, String text) {
                try {
                    Map<String, Object> msg = gson.fromJson(text, Map.class);
                    if (msg == null)
                        return;

                    String type = (String) msg.get("type");

                    // ── Auth success: mark authenticated & re-subscribe all channels
                    if ("auth_success".equals(type)) {
                        authenticated = true;
                        reconnectAttempts = 0;
                        resubscribeAll();
                        return;
                    }

                    // ── Auth refreshed: handle revoked channels, then re-subscribe
                    if ("auth_refreshed".equals(type)) {
                        authenticated = true;
                        reconnectAttempts = 0;
                        handleAuthRefreshed(msg);
                        resubscribeAll();
                        return;
                    }

                    // ── FILTER_RESYNC: server lost filter state (e.g. after hibernation)
                    if ("FILTER_RESYNC".equals(type)) {
                        resyncFilters();
                        return;
                    }

                    // Handle NOT_AUTHENTICATED: trigger re-auth
                    if ("error".equals(type)) {
                        String code = (String) msg.get("code");
                        if ("NOT_AUTHENTICATED".equals(code) || "AUTH_FAILED".equals(code)) {
                            handleAuthenticationFailure(new EdgeBaseError(401, "Authentication lost"));
                        }
                    }

                    // Dispatch to all registered listeners
                    for (Consumer<Map<String, Object>> listener : messageListeners) {
                        listener.accept(msg);
                    }
                } catch (Exception ignored) {
                }
            }

            @Override
            public void onClosing(WebSocket ws, int code, String reason) {
                ws.close(1000, null);
                isConnected = false;
                authenticated = false;
            }

            @Override
            public void onClosed(WebSocket ws, int code, String reason) {
                isConnected = false;
                authenticated = false;
                if (shouldReconnect && !waitingForAuth) {
                    long delay = Math.min((long) (1000 * Math.pow(2, reconnectAttempts)), 30000);
                    reconnectAttempts++;
                    scheduler.schedule(() -> connect(null), delay, TimeUnit.MILLISECONDS);
                }
            }

            @Override
            public void onFailure(WebSocket ws, Throwable t, Response response) {
                isConnected = false;
                authenticated = false;
                if (shouldReconnect && !waitingForAuth) {
                    long delay = Math.min((long) (1000 * Math.pow(2, reconnectAttempts)), 30000);
                    reconnectAttempts++;
                    scheduler.schedule(() -> connect(null), delay, TimeUnit.MILLISECONDS);
                }
            }
        });
    }

    // ─── Auth ───

    /**
     * Send a {@code {"type":"auth","token":"...","sdkVersion":"0.2.5"}} message.
     * This is the only auth mechanism the server accepts for WebSocket connections.
     */
    private void sendAuthMessage() {
        String token = tokenManager.getAccessToken();
        if (token == null) {
            handleAuthenticationFailure(new EdgeBaseError(401, hasSession()
                    ? "DatabaseLive is waiting for an active access token."
                    : "No access token available. Sign in first."));
            return;
        }

        Map<String, Object> authMsg = new LinkedHashMap<>();
        authMsg.put("type", "auth");
        authMsg.put("token", token);
        authMsg.put("sdkVersion", SDK_VERSION);
        sendRaw(authMsg);
    }

    /**
     * Handle {@code auth_refreshed} message with {@code revokedChannels}.
     * Removes revoked channels from subscription tracking and filter maps,
     * then dispatches {@code subscription_revoked} events so the application can react.
     */
    @SuppressWarnings("unchecked")
    private void handleAuthRefreshed(Map<String, Object> msg) {
        List<String> revoked = Collections.emptyList();
        Object revokedObj = msg.get("revokedChannels");
        if (revokedObj instanceof List) {
            revoked = (List<String>) revokedObj;
        }

        for (String channel : revoked) {
            String normalized = normalizeDatabaseLiveChannel(channel);
            subscribedChannels.remove(normalized);
            channelFilters.remove(normalized);
            channelOrFilters.remove(normalized);
        }

        // Dispatch subscription_revoked events to listeners
        if (!revoked.isEmpty()) {
            for (String channel : revoked) {
                Map<String, Object> event = new LinkedHashMap<>();
                event.put("type", "subscription_revoked");
                event.put("channel", channel);
                for (Consumer<Map<String, Object>> listener : messageListeners) {
                    listener.accept(event);
                }
            }
        }
    }

    // ─── Resubscribe / Resync ───

    /**
     * Re-subscribe all tracked channels after authentication.
     * Sends subscribe messages (with stored filters) for every channel
     * in {@link #subscribedChannels}.
     */
    private void resubscribeAll() {
        for (String channel : subscribedChannels) {
            sendSubscribe(channel);
        }
    }

    /**
     * Re-send stored filters to server after FILTER_RESYNC.
     * Called when the server signals it lost filter state (e.g. after hibernation).
     */
    private void resyncFilters() {
        for (String channel : subscribedChannels) {
            List<FilterTuple> filters = channelFilters.get(channel);
            List<FilterTuple> orFilters = channelOrFilters.get(channel);
            boolean hasFilters = filters != null && !filters.isEmpty();
            boolean hasOrFilters = orFilters != null && !orFilters.isEmpty();
            if (hasFilters || hasOrFilters) {
                Map<String, Object> msg = new LinkedHashMap<>();
                msg.put("type", "subscribe");
                msg.put("channel", channel);
                if (hasFilters) {
                    msg.put("filters", toJsonFilters(filters));
                }
                if (hasOrFilters) {
                    msg.put("orFilters", toJsonFilters(orFilters));
                }
                sendRaw(msg);
            }
        }
    }

    // ─── Send ───

    /**
     * Send a message through the WebSocket. Only sends if connected and authenticated.
     * Use {@link #sendRaw(Map)} for messages that bypass the auth check (e.g. the auth
     * message itself).
     */
    void sendMessage(Map<String, Object> message) {
        if (webSocket != null && isConnected && authenticated) {
            webSocket.send(gson.toJson(message));
        }
    }

    /**
     * Send a raw message without auth check. Used for the auth handshake itself.
     */
    private void sendRaw(Map<String, Object> message) {
        if (webSocket != null && isConnected) {
            webSocket.send(gson.toJson(message));
        }
    }

    /**
     * Send a subscribe message for the given channel, including stored filters if any.
     */
    private void sendSubscribe(String channel) {
        Map<String, Object> msg = new LinkedHashMap<>();
        msg.put("type", "subscribe");
        msg.put("channel", channel);

        List<FilterTuple> filters = channelFilters.get(channel);
        List<FilterTuple> orFilters = channelOrFilters.get(channel);
        if (filters != null && !filters.isEmpty()) {
            msg.put("filters", toJsonFilters(filters));
        }
        if (orFilters != null && !orFilters.isEmpty()) {
            msg.put("orFilters", toJsonFilters(orFilters));
        }

        sendRaw(msg);
    }

    // ─── Subscribe ───

    /**
     * Subscribe to a table and receive changes.
     *
     * @param tableName table name
     * @param listener  callback for each change
     * @return a Subscription that can be closed to unsubscribe
     */
    @Override
    public Subscription subscribe(String tableName, Consumer<DbChange> listener) {
        return subscribe(tableName, listener, null, null);
    }

    /**
     * Subscribe to a table with server-side filters and receive changes.
     *
     * @param tableName     table name
     * @param listener      callback for each change
     * @param serverFilters server-side filter conditions, may be null
     * @param serverOrFilters server-side OR filter conditions, may be null
     * @return a Subscription that can be closed to unsubscribe
     */
    public Subscription subscribe(String tableName, Consumer<DbChange> listener,
            List<FilterTuple> serverFilters, List<FilterTuple> serverOrFilters) {
        String channel = normalizeDatabaseLiveChannel(tableName);

        // Track channel
        subscribedChannels.add(channel);

        // Store server-side filters for recovery
        if (serverFilters != null && !serverFilters.isEmpty()) {
            channelFilters.put(channel, new ArrayList<>(serverFilters));
        }
        if (serverOrFilters != null && !serverOrFilters.isEmpty()) {
            channelOrFilters.put(channel, new ArrayList<>(serverOrFilters));
        }

        ensureConnected(channel);

        // Only send subscribe if already authenticated; otherwise resubscribeAll() will
        // handle it once auth_success arrives.
        if (authenticated) {
            sendSubscribe(channel);
        }

        Consumer<Map<String, Object>> messageListener = msg -> {
            String type = (String) msg.get("type");
            if ("db_change".equals(type)) {
                DbChange change = DbChange.fromJson(msg);
                String messageChannel = msg.get("channel") instanceof String ? (String) msg.get("channel") : null;
                if (matchesDatabaseLiveChannel(channel, change, messageChannel)) {
                    listener.accept(change);
                }
            } else if ("batch_changes".equals(type)) {
                Object rawChanges = msg.get("changes");
                if (!(rawChanges instanceof List<?> changes)) {
                    return;
                }
                String fallbackTable = msg.get("table") instanceof String
                        ? (String) msg.get("table")
                        : channelTableName(msg.get("channel") instanceof String ? (String) msg.get("channel") : "");
                for (Object item : changes) {
                    if (!(item instanceof Map<?, ?> changeMap)) {
                        continue;
                    }
                    Map<String, Object> synthetic = new LinkedHashMap<>();
                    synthetic.put("changeType", changeMap.get("event"));
                    synthetic.put("table", fallbackTable);
                    synthetic.put("docId", changeMap.get("docId"));
                    synthetic.put("data", changeMap.get("data"));
                    synthetic.put("timestamp", changeMap.get("timestamp"));
                    DbChange change = DbChange.fromJson(synthetic);
                    String messageChannel = msg.get("channel") instanceof String ? (String) msg.get("channel") : null;
                    if (matchesDatabaseLiveChannel(channel, change, messageChannel)) {
                        listener.accept(change);
                    }
                }
            }
        };
        messageListeners.add(messageListener);

        return new Subscription(channel, messageListener);
    }

    @Override
    public void unsubscribe(String id) {
        String channel = normalizeDatabaseLiveChannel(id);
        subscribedChannels.remove(channel);
        channelFilters.remove(channel);
        channelOrFilters.remove(channel);
        if (authenticated) {
            sendRaw(Map.of(
                    "type", "unsubscribe",
                    "channel", channel));
        }
    }

    // ─── Cleanup ───

    void destroy() {
        shouldReconnect = false;
        if (webSocket != null) {
            webSocket.close(1000, "Client destroyed");
            webSocket = null;
        }
        isConnected = false;
        authenticated = false;
        messageListeners.clear();
        subscribedChannels.clear();
        channelFilters.clear();
        channelOrFilters.clear();
        scheduler.shutdownNow();
        okHttpClient.dispatcher().executorService().shutdown();
        okHttpClient.connectionPool().evictAll();
        Cache cache = okHttpClient.cache();
        if (cache != null) {
            try {
                cache.close();
            } catch (IOException ignored) {
            }
        }
    }

    // ─── Helpers ───

    /**
     * Convert a list of {@link FilterTuple} to the JSON-serializable format
     * expected by the server: {@code [[field, op, value], ...]}.
     */
    private static List<List<Object>> toJsonFilters(List<FilterTuple> filters) {
        List<List<Object>> result = new ArrayList<>();
        for (FilterTuple f : filters) {
            result.add(f.toJson());
        }
        return result;
    }

    // ─── Subscription ───

    /**
     * A database-live subscription that can be closed to unsubscribe.
     */
    public class Subscription implements Closeable, dev.edgebase.sdk.core.DatabaseLiveClient.Subscription {
        private final String tableName;
        private final Consumer<Map<String, Object>> messageListener;
        private volatile boolean closed;

        Subscription(String tableName, Consumer<Map<String, Object>> messageListener) {
            this.tableName = tableName;
            this.messageListener = messageListener;
        }

        @Override
        public void close() {
            if (closed)
                return;
            closed = true;
            messageListeners.remove(messageListener);
            String channel = normalizeDatabaseLiveChannel(tableName);
            subscribedChannels.remove(channel);
            channelFilters.remove(channel);
            channelOrFilters.remove(channel);
            if (authenticated) {
                sendRaw(Map.of(
                        "type", "unsubscribe",
                        "channel", channel));
            }
        }

        @Override
        public void cancel() {
            close();
        }

        public boolean isClosed() {
            return closed;
        }
    }

    private void refreshAuth() {
        String token = tokenManager.getAccessToken();
        if (token == null || !isConnected) {
            return;
        }
        sendRaw(Map.of(
                "type", "auth",
                "token", token,
                "sdkVersion", SDK_VERSION));
    }

    private void handleAuthStateChange(Map<String, Object> user) {
        if (user != null) {
            if (isConnected && authenticated) {
                refreshAuth();
                return;
            }
            waitingForAuth = false;
            if (!subscribedChannels.isEmpty() && !isConnected) {
                connect(subscribedChannels.iterator().next());
            }
            return;
        }

        waitingForAuth = !subscribedChannels.isEmpty();
        isConnected = false;
        authenticated = false;
        if (webSocket != null) {
            webSocket.close(1000, "Signed out");
            webSocket = null;
        }
    }

    private void handleAuthenticationFailure(EdgeBaseError error) {
        waitingForAuth = error.getStatusCode() == 401 && !subscribedChannels.isEmpty() && !hasSession();
        isConnected = false;
        authenticated = false;
        if (webSocket != null) {
            webSocket.close(4001, error.getMessage());
            webSocket = null;
        }
    }

    private boolean hasSession() {
        return tokenManager.getRefreshToken() != null || tokenManager.currentUser() != null;
    }
}
