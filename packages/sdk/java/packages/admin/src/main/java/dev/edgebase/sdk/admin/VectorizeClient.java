// EdgeBase Java SDK — VectorizeClient for user-defined Vectorize indexes.
// Note: Vectorize is Edge-only. In local/Docker, the server returns stub responses.
package dev.edgebase.sdk.admin;

import dev.edgebase.sdk.core.*;

import java.util.*;

/**
 * Client for a user-defined Vectorize index.
 *
 * <pre>{@code
 * admin.vector("embeddings").upsert(List.of(Map.of("id", "doc-1", "values", List.of(0.1, 0.2))));
 * List<Map<String, Object>> results = admin.vector("embeddings").search(List.of(0.1, 0.2), 10, null);
 * }</pre>
 */
public class VectorizeClient {
    private final HttpClient httpClient;
    private final String index;

    public VectorizeClient(HttpClient httpClient, String index) {
        this.httpClient = httpClient;
        this.index = index;
    }

    /** Insert or update vectors. Returns mutation result with ok, count, mutationId. */
    @SuppressWarnings("unchecked")
    public Map<String, Object> upsert(List<Map<String, Object>> vectors) {
        Object res = httpClient.post("/vectorize/" + index,
                Map.of("action", "upsert", "vectors", vectors));
        return res instanceof Map ? (Map<String, Object>) res : Collections.emptyMap();
    }

    /** Insert vectors (errors on duplicate ID — server returns 409). */
    @SuppressWarnings("unchecked")
    public Map<String, Object> insert(List<Map<String, Object>> vectors) {
        Object res = httpClient.post("/vectorize/" + index,
                Map.of("action", "insert", "vectors", vectors));
        return res instanceof Map ? (Map<String, Object>) res : Collections.emptyMap();
    }

    /** Search for similar vectors. */
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> search(List<Double> vector, int topK, Map<String, Object> filter) {
        return search(vector, topK, filter, null, null, null);
    }

    /** Search with default topK=10. */
    public List<Map<String, Object>> search(List<Double> vector) {
        return search(vector, 10, null, null, null, null);
    }

    /** Search for similar vectors with full options. */
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> search(
            List<Double> vector, int topK, Map<String, Object> filter,
            String namespace, Boolean returnValues, String returnMetadata) {
        Map<String, Object> body = new HashMap<>();
        body.put("action", "search");
        body.put("vector", vector);
        body.put("topK", topK);
        if (filter != null) body.put("filter", filter);
        if (namespace != null) body.put("namespace", namespace);
        if (returnValues != null) body.put("returnValues", returnValues);
        if (returnMetadata != null) body.put("returnMetadata", returnMetadata);
        Object res = httpClient.post("/vectorize/" + index, body);
        if (res instanceof Map) {
            Object matches = ((Map<String, Object>) res).get("matches");
            return matches instanceof List ? (List<Map<String, Object>>) matches : Collections.emptyList();
        }
        return Collections.emptyList();
    }

    /** Search by an existing vector's ID (Vectorize v2 only). */
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> queryById(String vectorId, int topK, Map<String, Object> filter) {
        return queryById(vectorId, topK, filter, null, null, null);
    }

    /** Search by an existing vector's ID with full options. */
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> queryById(
            String vectorId, int topK, Map<String, Object> filter,
            String namespace, Boolean returnValues, String returnMetadata) {
        Map<String, Object> body = new HashMap<>();
        body.put("action", "queryById");
        body.put("vectorId", vectorId);
        body.put("topK", topK);
        if (filter != null) body.put("filter", filter);
        if (namespace != null) body.put("namespace", namespace);
        if (returnValues != null) body.put("returnValues", returnValues);
        if (returnMetadata != null) body.put("returnMetadata", returnMetadata);
        Object res = httpClient.post("/vectorize/" + index, body);
        if (res instanceof Map) {
            Object matches = ((Map<String, Object>) res).get("matches");
            return matches instanceof List ? (List<Map<String, Object>>) matches : Collections.emptyList();
        }
        return Collections.emptyList();
    }

    /** Retrieve vectors by their IDs. */
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> getByIds(List<String> ids) {
        Object res = httpClient.post("/vectorize/" + index,
                Map.of("action", "getByIds", "ids", ids));
        if (res instanceof Map) {
            Object vectors = ((Map<String, Object>) res).get("vectors");
            return vectors instanceof List ? (List<Map<String, Object>>) vectors : Collections.emptyList();
        }
        return Collections.emptyList();
    }

    /** Delete vectors by IDs. Returns mutation result with ok, count, mutationId. */
    @SuppressWarnings("unchecked")
    public Map<String, Object> delete(List<String> ids) {
        Object res = httpClient.post("/vectorize/" + index,
                Map.of("action", "delete", "ids", ids));
        return res instanceof Map ? (Map<String, Object>) res : Collections.emptyMap();
    }

    /** Get index info (vector count, dimensions, metric). */
    @SuppressWarnings("unchecked")
    public Map<String, Object> describe() {
        Object res = httpClient.post("/vectorize/" + index,
                Map.of("action", "describe"));
        return res instanceof Map ? (Map<String, Object>) res : Collections.emptyMap();
    }
}
