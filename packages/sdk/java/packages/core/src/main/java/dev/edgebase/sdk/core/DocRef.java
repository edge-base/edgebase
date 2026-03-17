// EdgeBase Java SDK — Document reference for single-document operations.
//
// All HTTP calls delegate to GeneratedDbApi (generated core).
// No hardcoded API paths — the core is the single source of truth.
package dev.edgebase.sdk.core;

import dev.edgebase.sdk.core.generated.GeneratedDbApi;

import java.util.Collections;
import java.util.Map;
import java.util.function.Consumer;

/**
 * Document reference for single-document operations.
 *
 * <p>
 * Usage:
 *
 * <pre>{@code
 * Map<String, Object> doc = client.db("shared").table("posts").doc("abc123").get();
 * client.db("shared").table("posts").doc("abc123").update(Map.of("title", "Updated"));
 * client.db("shared").table("posts").doc("abc123").delete();
 * }</pre>
 */
public class DocRef {
    private static String buildDatabaseLiveChannel(String namespace, String instanceId, String table, String docId) {
        String base = instanceId != null
                ? "dblive:" + namespace + ":" + instanceId + ":" + table
                : "dblive:" + namespace + ":" + table;
        return docId != null ? base + ":" + docId : base;
    }

    private final GeneratedDbApi core;
    private final String namespace;
    private final String instanceId;
    private final String tableName;
    private final String id;
    private final DatabaseLiveClient databaseLive;

    DocRef(GeneratedDbApi core, String namespace, String instanceId,
            String tableName, String id, DatabaseLiveClient databaseLive) {
        this.core = core;
        this.namespace = namespace;
        this.instanceId = instanceId;
        this.tableName = tableName;
        this.id = id;
        this.databaseLive = databaseLive;
    }

    public String getCollectionName() {
        return tableName;
    }

    public String getId() {
        return id;
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> get() {
        if (instanceId != null) {
            return (Map<String, Object>) core.dbGetRecord(namespace, instanceId, tableName, id, Collections.emptyMap());
        }
        return (Map<String, Object>) core.dbSingleGetRecord(namespace, tableName, id, Collections.emptyMap());
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> update(Map<String, ?> data) {
        if (instanceId != null) {
            return (Map<String, Object>) core.dbUpdateRecord(namespace, instanceId, tableName, id, data);
        }
        return (Map<String, Object>) core.dbSingleUpdateRecord(namespace, tableName, id, data);
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> delete() {
        if (instanceId != null) {
            return (Map<String, Object>) core.dbDeleteRecord(namespace, instanceId, tableName, id);
        }
        return (Map<String, Object>) core.dbSingleDeleteRecord(namespace, tableName, id);
    }

    /**
     * Subscribe to this document's changes.
     * Only available when using client-side SDK (EdgeBase.client()).
     */
    public DatabaseLiveClient.Subscription onSnapshot(Consumer<DbChange> listener) {
        if (databaseLive == null) {
            throw new UnsupportedOperationException(
                    "onSnapshot() is not available on the server SDK. Use EdgeBase.client() for database-live subscriptions.");
        }
        return databaseLive.subscribe(buildDatabaseLiveChannel(namespace, instanceId, tableName, id), listener);
    }
}
