// KvClient — KV namespace access for server-side use.
package dev.edgebase.sdk.admin

import dev.edgebase.sdk.core.*

/**
 * Client for a user-defined KV namespace.
 *
 * ```kotlin
 * val kv = admin.kv("cache")
 * kv.set("key", "value", ttl = 300)
 * val value = kv.get("key")
 * ```
 */
class KvClient internal constructor(
    private val client: HttpClient,
    private val namespace: String
) {
    /** Get a value by key. Returns null if not found (404). */
    @Suppress("UNCHECKED_CAST")
    suspend fun get(key: String): String? {
        return try {
            val res = client.post("/kv/$namespace", mapOf("action" to "get", "key" to key))
            (res as? Map<String, Any?>)?.get("value") as? String
        } catch (e: dev.edgebase.sdk.core.EdgeBaseError) {
            if (e.statusCode == 404) null else throw e
        }
    }

    /** Set a key-value pair with optional TTL in seconds. */
    suspend fun set(key: String, value: String, ttl: Int? = null) {
        val body = mutableMapOf<String, Any?>("action" to "set", "key" to key, "value" to value)
        if (ttl != null) body["ttl"] = ttl
        client.post("/kv/$namespace", body)
    }

    /** Delete a key. */
    suspend fun delete(key: String) {
        client.post("/kv/$namespace", mapOf("action" to "delete", "key" to key))
    }

    /** List keys with optional prefix, limit, and cursor. */
    @Suppress("UNCHECKED_CAST")
    suspend fun list(prefix: String? = null, limit: Int? = null, cursor: String? = null): Map<String, Any?> {
        val body = mutableMapOf<String, Any?>("action" to "list")
        if (prefix != null) body["prefix"] = prefix
        if (limit != null) body["limit"] = limit
        if (cursor != null) body["cursor"] = cursor
        val res = client.post("/kv/$namespace", body)
        return res as? Map<String, Any?> ?: emptyMap()
    }
}
