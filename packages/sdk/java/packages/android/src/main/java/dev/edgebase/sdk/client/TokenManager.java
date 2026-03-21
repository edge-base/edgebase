// EdgeBase Java SDK — Token management.
// Thread-safe token storage and refresh with 30-second buffer preemptive refresh.
package dev.edgebase.sdk.client;

import dev.edgebase.sdk.core.*;

import com.google.gson.Gson;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;
import java.util.function.Consumer;
import java.util.function.Function;

/**
 * Token manager — handles token lifecycle with thread-safe refresh.
 *
 * <p>
 * Features:
 * <ul>
 * <li>30-second buffer preemptive refresh</li>
 * <li>Concurrent refresh deduplication via synchronized</li>
 * <li>Persistent storage via {@link TokenStorage}</li>
 * </ul>
 */
class TokenManager {
    private static final int REFRESH_BUFFER_SECONDS = 30;

    private final TokenStorage storage;
    private final Object lock = new Object();
    private TokenPair currentTokens;
    private Function<String, TokenPair> refreshCallback;
    private Consumer<Map<String, Object>> onAuthStateChange;

    TokenManager(TokenStorage storage) {
        this.storage = storage;
        this.currentTokens = storage.getTokens();
    }

    void setRefreshCallback(Function<String, TokenPair> callback) {
        this.refreshCallback = callback;
    }

    void setOnAuthStateChange(Consumer<Map<String, Object>> listener) {
        this.onAuthStateChange = listener;
    }

    void setTokens(TokenPair pair) {
        synchronized (lock) {
            this.currentTokens = pair;
            storage.saveTokens(pair);
        }
        if (onAuthStateChange != null) {
            onAuthStateChange.accept(decodeJwtPayload(pair.getAccessToken()));
        }
    }

    String getAccessToken() {
        synchronized (lock) {
            if (currentTokens == null)
                return null;

            String accessToken = currentTokens.getAccessToken();
            boolean shouldRefresh = accessToken == null
                    || accessToken.isEmpty()
                    || isTokenExpiringSoon(accessToken);

            if (shouldRefresh) {
                if (refreshCallback != null) {
                    try {
                        TokenPair newTokens = refreshCallback.apply(currentTokens.getRefreshToken());
                        currentTokens = newTokens;
                        storage.saveTokens(newTokens);
                        if (onAuthStateChange != null) {
                            onAuthStateChange.accept(decodeJwtPayload(newTokens.getAccessToken()));
                        }
                        return newTokens.getAccessToken();
                    } catch (Exception e) {
                        // 401 means token revoked/expired — clear session (matches JS SDK).
                        // Other errors (network, 5xx) keep session for retry.
                        if (e instanceof EdgeBaseError && ((EdgeBaseError) e).getStatusCode() == 401) {
                            currentTokens = null;
                            storage.clearTokens();
                            if (onAuthStateChange != null) {
                                onAuthStateChange.accept(null);
                            }
                            return null;
                        }
                        return accessToken;
                    }
                }
            }
            return accessToken;
        }
    }

    String getRefreshToken() {
        synchronized (lock) {
            return currentTokens != null ? currentTokens.getRefreshToken() : null;
        }
    }

    Map<String, Object> currentUser() {
        synchronized (lock) {
            if (currentTokens == null)
                return null;
            return decodeJwtPayload(currentTokens.getAccessToken());
        }
    }

    void clearTokens() {
        synchronized (lock) {
            currentTokens = null;
            storage.clearTokens();
        }
        if (onAuthStateChange != null) {
            onAuthStateChange.accept(null);
        }
    }

    boolean tryRestoreSession() {
        synchronized (lock) {
            TokenPair stored = storage.getTokens();
            if (stored == null)
                return false;
            currentTokens = stored;
            return true;
        }
    }

    void destroy() {
        clearTokens();
        refreshCallback = null;
        onAuthStateChange = null;
    }

    /**
     * Decode JWT payload without verification (client-side only).
     */
    @SuppressWarnings("unchecked")
    static Map<String, Object> decodeJwtPayload(String token) {
        try {
            String[] parts = token.split("\\.");
            if (parts.length < 2)
                return null;
            String payload = parts[1];
            // Add padding if needed
            switch (payload.length() % 4) {
                case 2:
                    payload += "==";
                    break;
                case 3:
                    payload += "=";
                    break;
            }
            byte[] decoded = Base64.getUrlDecoder().decode(payload);
            String jsonStr = new String(decoded, StandardCharsets.UTF_8);
            Gson gson = new Gson();
            Map<String, Object> map = gson.fromJson(jsonStr, Map.class);
            if (map != null) {
                Object normalizedId = map.get("sub") != null ? map.get("sub") : map.get("userId");
                if (map.get("id") == null && normalizedId != null) {
                    map.put("id", normalizedId);
                }
                if (map.get("userId") == null && map.get("id") != null) {
                    map.put("userId", map.get("id"));
                }
                if (!map.containsKey("customClaims") && map.get("custom") instanceof Map<?, ?>) {
                    map.put("customClaims", map.get("custom"));
                }
            }
            return map;
        } catch (Exception e) {
            return null;
        }
    }

    private boolean isTokenExpiringSoon(String token) {
        try {
            Map<String, Object> payload = decodeJwtPayload(token);
            if (payload == null)
                return false;
            Object expObj = payload.get("exp");
            if (!(expObj instanceof Number))
                return false;
            long exp = ((Number) expObj).longValue();
            long now = System.currentTimeMillis() / 1000;
            return exp - now < REFRESH_BUFFER_SECONDS;
        } catch (Exception e) {
            return false;
        }
    }
}

/**
 * In-memory token storage for testing / JVM usage.
 */
class MemoryTokenStorage implements TokenStorage {
    private TokenPair tokens;

    @Override
    public TokenPair getTokens() {
        return tokens;
    }

    @Override
    public void saveTokens(TokenPair pair) {
        tokens = pair;
    }

    @Override
    public void clearTokens() {
        tokens = null;
    }
}

/**
 * No-op token storage for server-side SDK.
 */
class NoOpTokenStorage implements TokenStorage {
    @Override
    public TokenPair getTokens() {
        return null;
    }

    @Override
    public void saveTokens(TokenPair pair) {
    }

    @Override
    public void clearTokens() {
    }
}
