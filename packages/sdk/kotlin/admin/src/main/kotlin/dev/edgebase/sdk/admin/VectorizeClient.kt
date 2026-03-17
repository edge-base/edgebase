// VectorizeClient — Vectorize index access for server-side use.
// Note: Vectorize is Edge-only. In local/Docker, the server returns stub responses.
package dev.edgebase.sdk.admin

import dev.edgebase.sdk.core.*

/**
 * Client for a user-defined Vectorize index.
 *
 * ```kotlin
 * admin.vector("embeddings").upsert(listOf(mapOf("id" to "doc-1", "values" to listOf(0.1, 0.2))))
 * val results = admin.vector("embeddings").search(listOf(0.1, 0.2), topK = 5)
 * ```
 */
class VectorizeClient internal constructor(
    private val client: HttpClient,
    private val index: String
) {
    /** Insert or update vectors. Returns mutation result with ok, count, mutationId. */
    @Suppress("UNCHECKED_CAST")
    suspend fun upsert(vectors: List<Map<String, Any?>>): Map<String, Any?> {
        val res = client.post("/vectorize/$index", mapOf("action" to "upsert", "vectors" to vectors))
        return res as? Map<String, Any?> ?: emptyMap()
    }

    /** Insert vectors (errors on duplicate ID — server returns 409). */
    @Suppress("UNCHECKED_CAST")
    suspend fun insert(vectors: List<Map<String, Any?>>): Map<String, Any?> {
        val res = client.post("/vectorize/$index", mapOf("action" to "insert", "vectors" to vectors))
        return res as? Map<String, Any?> ?: emptyMap()
    }

    /** Search for similar vectors. */
    @Suppress("UNCHECKED_CAST")
    suspend fun search(
        vector: List<Double>,
        topK: Int = 10,
        filter: Map<String, Any?>? = null,
        namespace: String? = null,
        returnValues: Boolean? = null,
        returnMetadata: String? = null
    ): List<Map<String, Any?>> {
        val body = mutableMapOf<String, Any?>(
            "action" to "search",
            "vector" to vector,
            "topK" to topK
        )
        if (filter != null) body["filter"] = filter
        if (namespace != null) body["namespace"] = namespace
        if (returnValues != null) body["returnValues"] = returnValues
        if (returnMetadata != null) body["returnMetadata"] = returnMetadata
        val res = client.post("/vectorize/$index", body)
        val map = res as? Map<String, Any?> ?: return emptyList()
        return map["matches"] as? List<Map<String, Any?>> ?: emptyList()
    }

    /** Search by an existing vector's ID (Vectorize v2 only). */
    @Suppress("UNCHECKED_CAST")
    suspend fun queryById(
        vectorId: String,
        topK: Int = 10,
        filter: Map<String, Any?>? = null,
        namespace: String? = null,
        returnValues: Boolean? = null,
        returnMetadata: String? = null
    ): List<Map<String, Any?>> {
        val body = mutableMapOf<String, Any?>(
            "action" to "queryById",
            "vectorId" to vectorId,
            "topK" to topK
        )
        if (filter != null) body["filter"] = filter
        if (namespace != null) body["namespace"] = namespace
        if (returnValues != null) body["returnValues"] = returnValues
        if (returnMetadata != null) body["returnMetadata"] = returnMetadata
        val res = client.post("/vectorize/$index", body)
        val map = res as? Map<String, Any?> ?: return emptyList()
        return map["matches"] as? List<Map<String, Any?>> ?: emptyList()
    }

    /** Retrieve vectors by their IDs. */
    @Suppress("UNCHECKED_CAST")
    suspend fun getByIds(ids: List<String>): List<Map<String, Any?>> {
        val res = client.post("/vectorize/$index", mapOf("action" to "getByIds", "ids" to ids))
        val map = res as? Map<String, Any?> ?: return emptyList()
        return map["vectors"] as? List<Map<String, Any?>> ?: emptyList()
    }

    /** Delete vectors by IDs. Returns mutation result with ok, count, mutationId. */
    @Suppress("UNCHECKED_CAST")
    suspend fun delete(ids: List<String>): Map<String, Any?> {
        val res = client.post("/vectorize/$index", mapOf("action" to "delete", "ids" to ids))
        return res as? Map<String, Any?> ?: emptyMap()
    }

    /** Get index info (vector count, dimensions, metric). */
    @Suppress("UNCHECKED_CAST")
    suspend fun describe(): Map<String, Any?> {
        val res = client.post("/vectorize/$index", mapOf("action" to "describe"))
        return res as? Map<String, Any?> ?: emptyMap()
    }
}
