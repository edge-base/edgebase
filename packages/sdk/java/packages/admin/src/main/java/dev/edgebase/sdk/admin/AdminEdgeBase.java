// EdgeBase Java SDK — Admin-side SDK (Spring / Ktor / backend).
//: client/server split, #122: Server→Admin rename.
package dev.edgebase.sdk.admin;

import dev.edgebase.sdk.core.*;
import dev.edgebase.sdk.core.generated.GeneratedDbApi;

import java.util.*;

/**
 * Admin-side EdgeBase SDK.
 *
 * <p>
 * Exposes: adminAuth, sql, broadcast, table, storage, setContext, destroy.
 * <p>
 * Does NOT expose: auth, database-live (client-only).
 *
 * <p>
 * Usage:
 * 
 * <pre>{@code
 * AdminEdgeBase admin = EdgeBase.admin("https://my-app.edgebase.fun", "sk-...");
 * admin.adminAuth().createUser(Map.of("email", "admin@example.com", "password", "pass"));
 * List<?> rows = admin.sql("posts", "SELECT id, title FROM posts WHERE published = 1");
 * }</pre>
 */
public class AdminEdgeBase {
    private final AdminAuthClient adminAuth;
    private final StorageClient storage;
    private final FunctionsClient functions;
    private final AnalyticsClient analytics;
    private final HttpClient httpClient;
    private final GeneratedDbApi core;
    private final ContextManager contextManager;
    private final String baseUrl;

    public AdminEdgeBase(String url, String serviceKey, String projectId) {
        this.baseUrl = url.replaceAll("/$", "");
        this.contextManager = new ContextManager();
        TokenManager noOpTokenManager = new TokenManager() {
            @Override
            public String getAccessToken() {
                return null;
            }

            @Override
            public String getRefreshToken() {
                return null;
            }

            @Override
            public void setTokens(String access, String refresh) {
            }

            @Override
            public void clearTokens() {
            }
        };
        this.httpClient = new HttpClient(baseUrl, noOpTokenManager, contextManager, serviceKey, projectId);
        this.core = new GeneratedDbApi(httpClient);
        this.adminAuth = new AdminAuthClient(httpClient, serviceKey);
        this.storage = new StorageClient(httpClient);
        dev.edgebase.sdk.admin.generated.GeneratedAdminApi generatedAdmin =
                new dev.edgebase.sdk.admin.generated.GeneratedAdminApi(httpClient);
        this.functions = new FunctionsClient(httpClient);
        this.analytics = new AnalyticsClient(core, generatedAdmin);
    }

    /** Admin authentication client (requires Service Key). */
    public AdminAuthClient adminAuth() {
        return adminAuth;
    }

    /** Storage client. */
    public StorageClient storage() {
        return storage;
    }

    /** Functions client. */
    public FunctionsClient functions() {
        return functions;
    }

    /** Analytics client. */
    public AnalyticsClient analytics() {
        return analytics;
    }

    /** Get a table reference (no database-live on admin, defaults to "shared" namespace). */
    public TableRef table(String name) {
        return new TableRef(core, name, "shared", null, null);
    }

    /**
     * Get a DB namespace accessor.
     * Usage: admin.db("shared").table("posts").getList()
     */
    public DbRef db(String namespace) {
        return db(namespace, null);
    }

    /**
     * Get a dynamic namespace + instance ID accessor.
     * Usage: admin.db("workspace", "ws-123").table("docs").getList()
     */
    public DbRef db(String namespace, String instanceId) {
        return new DbRef(core, namespace, instanceId, null);
    }

    /**
     * Execute raw SQL on a table's DO.
     *
     * @param tableName Target table name (determines which DO to hit)
     * @param query     SQL query string
     * @return query results
     */
    @SuppressWarnings("unchecked")
    public List<Object> sql(String namespace, String query) {
        return sql(namespace, null, query, Collections.emptyList());
    }

    @SuppressWarnings("unchecked")
    public List<Object> sql(String namespace, String query, List<Object> params) {
        return sql(namespace, null, query, params);
    }

    public List<Object> sql(String namespace, String id, String query) {
        return sql(namespace, id, query, Collections.emptyList());
    }

    @SuppressWarnings("unchecked")
    public List<Object> sql(String namespace, String id, String query, List<Object> params) {
        // Server expects: { namespace, sql, params }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("namespace", namespace);
        if (id != null) {
            body.put("id", id);
        }
        body.put("sql", query);
        body.put("params", params);
        Object result = httpClient.post("/sql", body);
        if (result instanceof Map) {
            // Server may wrap rows in { rows: [...] }
            @SuppressWarnings("unchecked")
            Map<String, Object> map = (Map<String, Object>) result;
            if (map.containsKey("rows"))
                return (List<Object>) map.get("rows");
        }
        return result instanceof List ? (List<Object>) result : Collections.emptyList();
    }

    /**
     * Send a broadcast message to a database-live channel.
     */
    public void broadcast(String channel, String event) {
        broadcast(channel, event, Collections.emptyMap());
    }

    public void broadcast(String channel, String event, Map<String, Object> payload) {
        httpClient.post("/db/broadcast", Map.of(
                "channel", channel,
                "event", event,
                "payload", payload));
    }

    /** Set legacy isolateBy context state. HTTP routing no longer consumes it. */
    public void setContext(Map<String, Object> context) {
        contextManager.setContext(context);
    }

    /** Get current legacy isolateBy context state. */
    public Map<String, Object> getContext() {
        return contextManager.getContext();
    }

    /** Access a user-defined KV namespace. */
    public KvClient kv(String namespace) {
        return new KvClient(httpClient, namespace);
    }

    /** Access a user-defined D1 database. */
    public D1Client d1(String database) {
        return new D1Client(httpClient, database);
    }

    /** Access a user-defined Vectorize index. */
    public VectorizeClient vector(String index) {
        return new VectorizeClient(httpClient, index);
    }

    /** Push notification management. */
    public PushClient push() {
        return new PushClient(httpClient);
    }

    /** Destroy the client, cleaning up resources. */
    public void destroy() {
        analytics.destroy();
        httpClient.close();
    }
}
