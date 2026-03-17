// EdgeBase Java SDK — Admin authentication client.
// Server-side user management with Service Key authentication.
package dev.edgebase.sdk.admin;

import dev.edgebase.sdk.core.*;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

/**
 * Admin auth client for server-side user management.
 *
 * <p>
 * Only available via {@link AdminEdgeBase} /
 * {@link EdgeBase#server(String, String)}.
 *
 * <p>
 * Usage:
 * 
 * <pre>{@code
 * var admin = EdgeBase.admin("https://...", "sk-...");
 * var user = admin.adminAuth().getUser("user-id");
 * admin.adminAuth().setCustomClaims("user-id", Map.of("role", "pro"));
 * }</pre>
 */
public class AdminAuthClient {
    private final HttpClient client;
    private final String serviceKey;

    public AdminAuthClient(HttpClient client, String serviceKey) {
        this.client = client;
        this.serviceKey = serviceKey;
    }

    private void requireServiceKey() {
        if (serviceKey == null || serviceKey.isEmpty()) {
            throw new EdgeBaseError(403,
                    "Service Key required for admin operations. Use EdgeBase.admin(url, serviceKey).");
        }
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> getUser(String userId) {
        requireServiceKey();
        return (Map<String, Object>) client.get("/auth/admin/users/" + userId);
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> listUsers() {
        return listUsers(null, null);
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> listUsers(Integer limit, String cursor) {
        requireServiceKey();
        Map<String, String> params = new HashMap<>();
        if (limit != null)
            params.put("limit", limit.toString());
        if (cursor != null)
            params.put("cursor", cursor);
        return (Map<String, Object>) client.get("/auth/admin/users", params.isEmpty() ? null : params);
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> createUser(Map<String, Object> data) {
        requireServiceKey();
        return (Map<String, Object>) client.post("/auth/admin/users", data);
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> updateUser(String userId, Map<String, Object> data) {
        requireServiceKey();
        return (Map<String, Object>) client.patch("/auth/admin/users/" + userId, data);
    }

    public void deleteUser(String userId) {
        requireServiceKey();
        client.delete("/auth/admin/users/" + userId);
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> setCustomClaims(String userId, Map<String, Object> claims) {
        requireServiceKey();
        return (Map<String, Object>) client.put("/auth/admin/users/" + userId + "/claims", claims);
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> revokeAllSessions(String userId) {
        requireServiceKey();
        return (Map<String, Object>) client.post("/auth/admin/users/" + userId + "/revoke", Collections.emptyMap());
    }
}
