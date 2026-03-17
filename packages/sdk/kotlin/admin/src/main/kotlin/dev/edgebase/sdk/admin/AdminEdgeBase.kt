// EdgeBase Kotlin SDK — Admin (server-side) entry point.
//
// Server SDK with Service Key auth, admin user management, D1, KV, Vectorize.
//: client/server split, #121: KV/D1/Vectorize, #122: Server->Admin rename.
//
// Usage:
//   val admin = AdminEdgeBase("https://my-app.edgebase.fun", serviceKey = System.getenv("EDGEBASE_SERVICE_KEY") ?: "")
//   val user = admin.adminAuth.getUser("user-id")
//   val kv = admin.kv("cache")

package dev.edgebase.sdk.admin

import dev.edgebase.sdk.admin.generated.GeneratedAdminApi
import dev.edgebase.sdk.core.*
import dev.edgebase.sdk.core.generated.GeneratedDbApi

/**
 * Server-side EdgeBase SDK (admin).
 *
 * Exposes: adminAuth, db, storage, push, kv, d1, vector, broadcast, destroy.
 * Requires a Service Key for authentication (no user tokens).
 *
 * ```kotlin
 * val admin = AdminEdgeBase("https://my-app.edgebase.fun", serviceKey = System.getenv("EDGEBASE_SERVICE_KEY") ?: "")
 * val user = admin.adminAuth.getUser("user-id")
 * val rows = admin.d1("analytics").exec("SELECT * FROM events")
 * admin.broadcast("chat-room-1", "new-message", mapOf("text" to "hello"))
 * ```
 */
class AdminEdgeBase(
    url: String,
    serviceKey: String,
    projectId: String? = null
) {
    val baseUrl: String = url.trimEnd('/')
    private val contextManager = ContextManager()
    private val noOpTokenManager = object : TokenManager {
        override suspend fun getAccessToken(): String? = null
        override suspend fun getRefreshToken(): String? = null
        override suspend fun setTokens(access: String, refresh: String) {}
        override suspend fun clearTokens() {}
    }
    private val httpClient = HttpClient(
        baseUrl = baseUrl,
        tokenManager = noOpTokenManager,
        serviceKey = serviceKey,
        projectId = projectId
    )
    private val generatedCore = GeneratedDbApi(httpClient)
    private val generatedAdmin = GeneratedAdminApi(httpClient)

    val adminAuth = AdminAuthClient(httpClient, serviceKey, generatedAdmin)
    val storage = StorageClient(httpClient, generatedCore)
    val push = AdminPushClient(httpClient)
    val functions = FunctionsClient(httpClient)
    val analytics = AnalyticsClient(generatedCore, generatedAdmin)

    /** Select a DB block by namespace and optional instance ID (#133 §2). */
    fun db(namespace: String, instanceId: String? = null): DbRef {
        return DbRef(generatedCore, namespace, instanceId, databaseLive = null)
    }

    /** Get a KV namespace client. */
    fun kv(namespace: String): KvClient {
        return KvClient(httpClient, namespace)
    }

    /** Get a D1 database client. */
    fun d1(database: String): D1Client {
        return D1Client(httpClient, database)
    }

    /** Get a Vectorize index client. */
    fun vector(index: String): VectorizeClient {
        return VectorizeClient(httpClient, index)
    }

    /** Execute a raw SQL query against a DB namespace. */
    @Suppress("UNCHECKED_CAST")
    suspend fun sql(
        namespace: String = "shared",
        instanceId: String? = null,
        query: String,
        params: List<Any?> = emptyList(),
    ): List<Map<String, Any?>> {
        val result = generatedAdmin.executeSql(
            buildMap {
                put("namespace", namespace)
                put("sql", query)
                put("params", params)
                if (instanceId != null) put("id", instanceId)
            }
        )
        return when (result) {
            is List<*> -> result.filterIsInstance<Map<String, Any?>>()
            is Map<*, *> -> (result["rows"] as? List<*>)?.filterIsInstance<Map<String, Any?>>() ?: emptyList()
            else -> emptyList()
        }
    }

    /**
     * Broadcast a message to a DatabaseLive channel from the server.
     * Delegates to [GeneratedAdminApi.databaseLiveBroadcast].
     *
     * @param channel DatabaseLive channel name (e.g. `"chat-room-1"`)
     * @param event Event type string (e.g. `"new-message"`)
     * @param payload Optional JSON-serializable payload
     */
    suspend fun broadcast(
        channel: String,
        event: String,
        payload: Map<String, Any?>? = null,
    ) {
        val body = mutableMapOf<String, Any?>("channel" to channel, "event" to event)
        if (payload != null) body["payload"] = payload
        generatedAdmin.databaseLiveBroadcast(body)
    }

    /** Destroy — clean up resources. */
    fun destroy() {
        httpClient.close()
    }
}
