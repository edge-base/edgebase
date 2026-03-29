// EdgeBase Java SDK — Client-side SDK entry point (Android / mobile / desktop).
//: client/server split, #122: Server→Admin rename.
package dev.edgebase.sdk.client;

import dev.edgebase.sdk.core.*;
import dev.edgebase.sdk.core.generated.GeneratedDbApi;

import java.lang.ref.WeakReference;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Client-side EdgeBase SDK.
 *
 * <p>
 * Exposes: auth, db, storage, push, destroy.
 * <p>
 * Does NOT expose: adminAuth, sql (admin-only).
 *
 * <p>
 * Usage:
 *
 * <pre>{@code
 * ClientEdgeBase client = EdgeBase.client("https://my-app.edgebase.fun");
 * client.auth().signUp("user@test.com", "pass123");
 * var posts = client.db("shared").table("posts").getList();
 * }</pre>
 */
public class ClientEdgeBase {
    private final HttpClient httpClient;
    private final GeneratedDbApi core;
    private final AuthClient auth;
    private final DatabaseLiveClient databaseLive;
    private final StorageClient storage;
    private final PushClient push;
    private final FunctionsClient functions;
    private final AnalyticsClient analytics;
    private final TokenManager tokenManager;
    private final ContextManager contextManager;
    private final List<WeakReference<RoomClient>> roomClients = new CopyOnWriteArrayList<>();
    private final String baseUrl;

    ClientEdgeBase(String url) {
        this(url, new MemoryTokenStorage(), null);
    }

    ClientEdgeBase(String url, TokenStorage tokenStorage, String projectId) {
        this.baseUrl = url.replaceAll("/$", "");
        this.contextManager = new ContextManager();
        this.tokenManager = new TokenManager(tokenStorage != null ? tokenStorage : new MemoryTokenStorage());

        // Create core TokenManager adapter for HttpClient
        dev.edgebase.sdk.core.TokenManager coreTokenManager = new dev.edgebase.sdk.core.TokenManager() {
            @Override
            public String getAccessToken() {
                return tokenManager.getAccessToken();
            }

            @Override
            public String getRefreshToken() {
                return tokenManager.getRefreshToken();
            }

            @Override
            public void setTokens(String access, String refresh) {
                tokenManager.setTokens(new TokenPair(access, refresh));
            }

            @Override
            public void clearTokens() {
                tokenManager.clearTokens();
            }
        };

        this.httpClient = new HttpClient(baseUrl, coreTokenManager, contextManager, null, projectId);
        this.tokenManager.setRefreshCallback(refreshToken -> {
            Object rawResult = this.httpClient.postPublic("/auth/refresh", Map.of("refreshToken", refreshToken));
            if (!(rawResult instanceof Map)) {
                throw new EdgeBaseError(500, "Invalid auth refresh response.");
            }

            @SuppressWarnings("unchecked")
            Map<String, Object> result = (Map<String, Object>) rawResult;
            Object nextAccessToken = result.get("accessToken");
            Object nextRefreshToken = result.get("refreshToken");
            if (!(nextAccessToken instanceof String) || !(nextRefreshToken instanceof String)) {
                throw new EdgeBaseError(500, "Invalid auth refresh response.");
            }

            return new TokenPair((String) nextAccessToken, (String) nextRefreshToken);
        });
        this.core = new GeneratedDbApi(httpClient);
        this.auth = new AuthClient(httpClient, tokenManager, core);
        this.databaseLive = new DatabaseLiveClient(baseUrl, tokenManager);
        this.storage = new StorageClient(httpClient);
        this.push = new PushClient(httpClient);
        this.functions = new FunctionsClient(httpClient);
        this.analytics = new AnalyticsClient(core);

        // Only wire Android-specific captcha helpers when the runtime actually
        // provides Android classes. This keeps desktop/server JVM consumers from
        // crashing during client construction.
        if (isAndroidRuntime()) {
            try {
                TurnstileProvider.setGeneratedApi(baseUrl, core);
            } catch (Throwable ignored) {
            }
        }

        this.auth.onBeforeSignOut(() -> {
            try {
                this.push.unregister();
            } catch (Exception ignored) {
            }
        });
    }

    /** Authentication client. */
    public AuthClient auth() {
        return auth;
    }

    /** Storage client. */
    public StorageClient storage() {
        return storage;
    }

    /** Push notification client. */
    public PushClient push() {
        return push;
    }

    /** App Functions client. */
    public FunctionsClient functions() {
        return functions;
    }

    /** Analytics client. */
    public AnalyticsClient analytics() {
        return analytics;
    }

    /** Select a DB block by namespace and optional instance ID (#133 §2). */
    public DbRef db(String namespace, String instanceId) {
        return new DbRef(core, namespace, instanceId, databaseLive);
    }

    /** Select a DB block by namespace (shared / static DBs). */
    public DbRef db(String namespace) {
        return db(namespace, null);
    }

    /**
     * Create a room client for the given namespace and room ID (v2 protocol,).
     *
     * @param namespace room namespace (e.g. "game", "chat")
     * @param roomId    room instance ID within the namespace
     * @return a new RoomClient instance (call join() to connect)
     */
    public RoomClient room(String namespace, String roomId) {
        RoomClient roomClient = new RoomClient(
                baseUrl,
                httpClient,
                namespace,
                roomId,
                tokenManager::getAccessToken,
                listener -> tokenManager.setOnAuthStateChange(user -> listener.accept(user != null)));
        roomClients.add(new WeakReference<>(roomClient));
        return roomClient;
    }

    /** Set legacy isolateBy context state. HTTP DB routing uses db(namespace, id). */
    public void setContext(Map<String, Object> context) {
        contextManager.setContext(context);
    }

    /** Get current legacy isolateBy context state. */
    public Map<String, Object> getContext() {
        return contextManager.getContext();
    }

    /** Set locale for auth email i18n and Accept-Language headers. */
    public void setLocale(String locale) {
        httpClient.setLocale(locale);
    }

    /** Get the currently configured locale override. */
    public String getLocale() {
        return httpClient.getLocale();
    }

    /** Clear legacy isolateBy context state. */
    public void clearContext() {
        contextManager.clearContext();
    }

    /** Destroy the client, cleaning up resources. */
    public void destroy() {
        for (WeakReference<RoomClient> roomRef : roomClients) {
            RoomClient roomClient = roomRef.get();
            if (roomClient == null) {
                continue;
            }
            try {
                roomClient.destroy();
            } catch (Exception ignored) {
            }
        }
        roomClients.clear();
        analytics.destroy();
        databaseLive.destroy();
        tokenManager.destroy();
        httpClient.close();
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
