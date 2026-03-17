// D1Client — D1 database access for server-side use.
package dev.edgebase.sdk.admin

import dev.edgebase.sdk.core.*

/**
 * Client for a user-defined D1 database.
 *
 * ```kotlin
 * val rows = admin.d1("analytics").exec("SELECT * FROM events WHERE type = ?", listOf("click"))
 * ```
 */
class D1Client internal constructor(
    private val client: HttpClient,
    private val database: String
) {
    /**
     * Execute a SQL query. Use ? placeholders for bind parameters.
     * All SQL is allowed (DDL included).
     */
    @Suppress("UNCHECKED_CAST")
    suspend fun exec(query: String, params: List<Any?> = emptyList()): List<Any?> {
        val body = mutableMapOf<String, Any?>("query" to query)
        if (params.isNotEmpty()) body["params"] = params
        val res = client.post("/d1/$database", body)
        val map = res as? Map<String, Any?> ?: return emptyList()
        return map["results"] as? List<Any?> ?: emptyList()
    }
}
