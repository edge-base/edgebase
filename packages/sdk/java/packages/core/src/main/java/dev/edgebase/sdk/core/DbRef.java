// EdgeBase Java SDK — DbRef: namespace-scoped database block reference.
//
// Decision #133: db(namespace, instanceId) -> DbRef -> table(name) -> TableRef
// Mirrors the pattern: client.db("shared").table("posts").getList()
//
// All HTTP calls delegate to GeneratedDbApi (generated core).
// No hardcoded API paths or withDbPath() — the core handles URL construction.
package dev.edgebase.sdk.core;

import dev.edgebase.sdk.core.generated.GeneratedDbApi;

/**
 * A reference to a specific database block identified by namespace and optional
 * instance ID.
 *
 * <p>
 * Usage:
 *
 * <pre>{@code
 * DbRef db = client.db("shared");
 * TableRef posts = db.table("posts");
 * List<Map<String, Object>> rows = posts.getList().getItems();
 * }</pre>
 */
public class DbRef {
    private final GeneratedDbApi core;
    private final String namespace;
    private final String instanceId;
    private final DatabaseLiveClient databaseLive;

    public DbRef(GeneratedDbApi core, String namespace, String instanceId, DatabaseLiveClient databaseLive) {
        this.core = core;
        this.namespace = namespace;
        this.instanceId = instanceId;
        this.databaseLive = databaseLive;
    }

    /** Namespace of this DB block (e.g. "shared", "tenant-abc"). */
    public String getNamespace() {
        return namespace;
    }

    /** Instance ID of this DB block, or {@code null} for shared/static DBs. */
    public String getInstanceId() {
        return instanceId;
    }

    /**
     * Returns a {@link TableRef} scoped to this DB block.
     *
     * @param name table name (e.g. "posts")
     */
    public TableRef table(String name) {
        return new TableRef(core, name, namespace, instanceId, databaseLive);
    }
}
