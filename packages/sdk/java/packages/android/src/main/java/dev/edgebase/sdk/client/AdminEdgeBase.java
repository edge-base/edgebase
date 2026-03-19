// EdgeBase Java SDK — Admin-side SDK entry point for Android package.
//: client/server split, #122: Server→Admin rename.
//
// This is a thin wrapper in the client package that delegates to the
// admin package's AdminEdgeBase. The android module re-exports it so
// users can do: EdgeBase.admin("url", "key").
package dev.edgebase.sdk.client;

import dev.edgebase.sdk.core.*;
import dev.edgebase.sdk.core.generated.GeneratedDbApi;
import dev.edgebase.sdk.admin.AdminAuthClient;
import dev.edgebase.sdk.admin.KvClient;
import dev.edgebase.sdk.admin.D1Client;
import dev.edgebase.sdk.admin.VectorizeClient;

import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * Admin-side EdgeBase SDK (Android module re-export).
 *
 * <p>
 * Exposes: adminAuth, kv, d1, vector, sql, broadcast, db, storage, destroy.
 * <p>
 * Does NOT expose: auth, database-live (client-only).
 *
 * <p>
 * Usage:
 *
 * <pre>{@code
 * AdminEdgeBase admin = EdgeBase.admin("https://my-app.edgebase.fun", "sk-...");
 * admin.db("shared").table("posts").getList();
 * admin.adminAuth().createUser(Map.of("email", "...", "password", "..."));
 * }</pre>
 */
public class AdminEdgeBase {
    private final HttpClient httpClient;
    private final GeneratedDbApi core;
    private final StorageClient storage;
    private final ContextManager contextManager;
    private final String baseUrl;
    private final String serviceKey;

    public AdminEdgeBase(String url, String serviceKey, String projectId) {
        this.baseUrl = url.replaceAll("/$", "");
        this.serviceKey = serviceKey;
        this.contextManager = new ContextManager();
        dev.edgebase.sdk.core.TokenManager noOpTokenManager = new dev.edgebase.sdk.core.TokenManager() {
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
        this.storage = new StorageClient(httpClient);
    }

    /** Admin auth client for server-side user management. */
    public AdminAuthClient adminAuth() {
        return new AdminAuthClient(httpClient, serviceKey);
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

    /** Select a DB block by namespace and optional instance ID (#133 §2). */
    public DbRef db(String namespace, String instanceId) {
        return new DbRef(core, namespace, instanceId, null);
    }

    /** Select a DB block by namespace (shared / static DBs). */
    public DbRef db(String namespace) {
        return db(namespace, null);
    }

    /** Storage client. */
    public StorageClient storage() {
        return storage;
    }

    /** Destroy the client, cleaning up resources. */
    public void destroy() {
        httpClient.close();
    }
}
