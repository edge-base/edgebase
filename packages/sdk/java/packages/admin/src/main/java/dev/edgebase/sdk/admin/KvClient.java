// EdgeBase Java SDK — KvClient for user-defined KV namespaces.
package dev.edgebase.sdk.admin;

import dev.edgebase.sdk.core.*;

import java.util.*;

/**
 * Client for a user-defined KV namespace.
 *
 * <pre>{@code
 * KvClient kv = admin.kv("cache");
 * kv.set("key", "value", 300);
 * String val = kv.get("key");
 * }</pre>
 */
public class KvClient {
    private final HttpClient httpClient;
    private final String namespace;

    public KvClient(HttpClient httpClient, String namespace) {
        this.httpClient = httpClient;
        this.namespace = namespace;
    }

    /** Get a value by key. Returns null if not found. */
    @SuppressWarnings("unchecked")
    public String get(String key) {
        Object res = httpClient.post("/kv/" + namespace,
                Map.of("action", "get", "key", key));
        if (res instanceof Map) {
            Object val = ((Map<String, Object>) res).get("value");
            return val != null ? val.toString() : null;
        }
        return null;
    }

    /** Set a key-value pair. */
    public void set(String key, String value) {
        set(key, value, -1);
    }

    /** Set a key-value pair with TTL in seconds. */
    public void set(String key, String value, int ttl) {
        Map<String, Object> body = new HashMap<>();
        body.put("action", "set");
        body.put("key", key);
        body.put("value", value);
        if (ttl > 0)
            body.put("ttl", ttl);
        httpClient.post("/kv/" + namespace, body);
    }

    /** Delete a key. */
    public void delete(String key) {
        httpClient.post("/kv/" + namespace,
                Map.of("action", "delete", "key", key));
    }

    /** List keys with optional prefix and limit. */
    @SuppressWarnings("unchecked")
    public Map<String, Object> list(String prefix, int limit, String cursor) {
        Map<String, Object> body = new HashMap<>();
        body.put("action", "list");
        if (prefix != null)
            body.put("prefix", prefix);
        if (limit > 0)
            body.put("limit", limit);
        if (cursor != null)
            body.put("cursor", cursor);
        Object res = httpClient.post("/kv/" + namespace, body);
        return res instanceof Map ? (Map<String, Object>) res : Collections.emptyMap();
    }

    /** List all keys. */
    public Map<String, Object> list() {
        return list(null, 0, null);
    }
}
