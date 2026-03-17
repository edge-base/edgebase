// EdgeBase Java SDK — PushClient for push notification management.
package dev.edgebase.sdk.admin;

import dev.edgebase.sdk.core.*;
import dev.edgebase.sdk.admin.generated.GeneratedAdminApi;

import java.util.*;

/**
 * Client for push notification operations.
 *
 * <pre>{@code
 * Map<String, Object> result = client.push().send("userId", Map.of("title", "Hello", "body", "World"));
 * Map<String, Object> result = client.push().sendMany(List.of("u1", "u2"), Map.of("title", "News"));
 * List<Map<String, Object>> logs = client.push().getLogs("userId");
 * }</pre>
 */
public class PushClient {
    private final HttpClient httpClient;
    private final GeneratedAdminApi adminCore;

    public PushClient(HttpClient httpClient) {
        this.httpClient = httpClient;
        this.adminCore = new GeneratedAdminApi(httpClient);
    }

    /** Send a push notification to a single user's devices. */
    @SuppressWarnings("unchecked")
    public Map<String, Object> send(String userId, Map<String, Object> payload) {
        Object res = httpClient.post("/push/send",
                Map.of("userId", userId, "payload", payload));
        return res instanceof Map ? (Map<String, Object>) res : Collections.emptyMap();
    }

    /**
     * Send a push notification to multiple users (no limit — server chunks
     * internally).
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> sendMany(List<String> userIds, Map<String, Object> payload) {
        Object res = httpClient.post("/push/send-many",
                Map.of("userIds", userIds, "payload", payload));
        return res instanceof Map ? (Map<String, Object>) res : Collections.emptyMap();
    }

    /** Send a push notification to a specific device token. */
    @SuppressWarnings("unchecked")
    public Map<String, Object> sendToToken(String token, Map<String, Object> payload, String platform) {
        Object res = httpClient.post("/push/send-to-token",
                Map.of("token", token, "payload", payload, "platform", platform != null ? platform : "web"));
        return res instanceof Map ? (Map<String, Object>) res : Collections.emptyMap();
    }

    /** Get registered device tokens for a user — token values NOT exposed. */
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> getTokens(String userId) {
        Map<String, String> query = new LinkedHashMap<>();
        query.put("userId", userId);
        Object res = adminCore.getPushTokens(query);
        if (res instanceof Map) {
            Object items = ((Map<String, Object>) res).get("items");
            if (items instanceof List) {
                List<Map<String, Object>> result = new ArrayList<>();
                for (Object item : (List<?>) items) {
                    if (item instanceof Map) {
                        result.add((Map<String, Object>) item);
                    }
                }
                return result;
            }
        }
        return Collections.emptyList();
    }

    /** Get push send logs for a user (last 24 hours). */
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> getLogs(String userId) {
        return getLogs(userId, -1);
    }

    /** Get push send logs for a user with limit. */
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> getLogs(String userId, int limit) {
        Map<String, String> query = new LinkedHashMap<>();
        query.put("userId", userId);
        if (limit > 0)
            query.put("limit", String.valueOf(limit));
        Object res = adminCore.getPushLogs(query);
        if (res instanceof Map) {
            Object items = ((Map<String, Object>) res).get("items");
            if (items instanceof List) {
                List<Map<String, Object>> result = new ArrayList<>();
                for (Object item : (List<?>) items) {
                    if (item instanceof Map) {
                        result.add((Map<String, Object>) item);
                    }
                }
                return result;
            }
        }
        return Collections.emptyList();
    }

    /** Send a push notification to an FCM topic. */
    @SuppressWarnings("unchecked")
    public Map<String, Object> sendToTopic(String topic, Map<String, Object> payload) {
        Object res = httpClient.post("/push/send-to-topic",
                Map.of("topic", topic, "payload", payload));
        return res instanceof Map ? (Map<String, Object>) res : Collections.emptyMap();
    }

    /** Broadcast a push notification to all devices via /topics/all. */
    @SuppressWarnings("unchecked")
    public Map<String, Object> broadcast(Map<String, Object> payload) {
        Object res = httpClient.post("/push/broadcast",
                Map.of("payload", payload));
        return res instanceof Map ? (Map<String, Object>) res : Collections.emptyMap();
    }
}
