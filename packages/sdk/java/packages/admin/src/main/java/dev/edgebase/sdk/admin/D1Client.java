// EdgeBase Java SDK — D1Client for user-defined D1 databases.
package dev.edgebase.sdk.admin;

import dev.edgebase.sdk.core.*;

import java.util.*;

/**
 * Client for a user-defined D1 database.
 *
 * <pre>{@code
 * List<Object> rows = admin.d1("analytics").exec("SELECT * FROM events WHERE type = ?", List.of("click"));
 * }</pre>
 */
public class D1Client {
    private final HttpClient httpClient;
    private final String database;

    public D1Client(HttpClient httpClient, String database) {
        this.httpClient = httpClient;
        this.database = database;
    }

    /** Execute a SQL query without params. */
    public List<Object> exec(String query) {
        return exec(query, Collections.emptyList());
    }

    /**
     * Execute a SQL query with bind parameters.
     * All SQL is allowed (DDL included).
     */
    @SuppressWarnings("unchecked")
    public List<Object> exec(String query, List<Object> params) {
        Map<String, Object> body = new HashMap<>();
        body.put("query", query);
        if (!params.isEmpty())
            body.put("params", params);
        Object res = httpClient.post("/d1/" + database, body);
        if (res instanceof Map) {
            Object results = ((Map<String, Object>) res).get("results");
            return results instanceof List ? (List<Object>) results : Collections.emptyList();
        }
        return Collections.emptyList();
    }
}
