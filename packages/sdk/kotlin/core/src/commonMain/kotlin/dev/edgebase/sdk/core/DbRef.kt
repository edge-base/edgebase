// EdgeBase Kotlin SDK — DbRef: namespace-scoped DB block accessor (#133 §2).
// All HTTP calls delegate to Generated Core (ApiCore.kt) via TableRef.
package dev.edgebase.sdk.core

import dev.edgebase.sdk.core.generated.GeneratedDbApi

/**
 * Reference to a DB namespace block (e.g. "shared", "workspace").
 * Use [table] to get a [TableRef] for CRUD operations.
 *
 * ```kotlin
 * val posts = client.db("shared").table("posts")
 * val rows = posts.where("status", "==", "published").get()
 * ```
 */
class DbRef(
    private val core: GeneratedDbApi,
    private val namespace: String,
    private val instanceId: String?,
    private val databaseLive: Any? // DatabaseLiveClient — Any to avoid circular dep in core
) {
    /** Get a [TableRef] for the named table. */
    @Suppress("UNCHECKED_CAST")
    fun table(name: String): TableRef {
        return TableRef(core, name, databaseLive as DatabaseLiveClient?, namespace, instanceId)
    }
}
