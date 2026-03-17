// EdgeBase Kotlin SDK — Client-side entry point (KMP).
//
// Main SDK class for Android, iOS, Web, and Desktop clients.
//: client/server split, #122: Server→Admin rename, #130: KMP 전환.
//
// Usage:
//   val client = ClientEdgeBase("https://my-app.edgebase.fun")
//   val user = client.auth.signUp(email = "test@example.com", password = "pass123")

package dev.edgebase.sdk.client

import dev.edgebase.sdk.core.*
import dev.edgebase.sdk.core.generated.GeneratedDbApi

/**
 * Client-side EdgeBase SDK.
 *
 * Exposes: auth, db, storage, push, destroy.
 * Does NOT expose: adminAuth, sql (admin-only).
 *
 * ```kotlin
 * val client = ClientEdgeBase("https://my-app.edgebase.fun")
 * client.auth.signUp(email = "user@test.com", password = "pass123")
 * val posts = client.db("shared").table("posts").get()
 * ```
 */
class ClientEdgeBase(
    url: String,
    tokenStorage: TokenStorage? = null,
    projectId: String? = null
) {
    val baseUrl: String = url.trimEnd('/')
    private val contextManager = ContextManager()
    private val _tokenManager = ClientTokenManager(tokenStorage ?: createDefaultTokenStorage())
    private val httpClient = HttpClient(
        baseUrl = baseUrl,
        tokenManager = _tokenManager,
        projectId = projectId
    )
    private val generatedCore = GeneratedDbApi(httpClient)

    val auth = AuthClient(httpClient, _tokenManager, generatedCore)
    val storage = StorageClient(httpClient, generatedCore)
    internal val databaseLive = DatabaseLiveClient(url = baseUrl, tokenManager = _tokenManager)
    val push = PushClient(httpClient)
    val functions = FunctionsClient(httpClient)
    val analytics = AnalyticsClient(generatedCore)

    init {
        // Setup refresh callback
        _tokenManager.setRefreshCallback { refreshToken ->
            @Suppress("UNCHECKED_CAST")
            val result = httpClient.postPublic("/auth/refresh", mapOf("refreshToken" to refreshToken)) as Map<String, Any?>
            val access = result["accessToken"] as? String
                ?: throw EdgeBaseError(0, "Invalid refresh response")
            val refresh = result["refreshToken"] as? String
                ?: throw EdgeBaseError(0, "Invalid refresh response")
            TokenPair(access, refresh)
        }
    }

    /** Select a DB block by namespace and optional instance ID (#133 §2). */
    fun db(namespace: String, instanceId: String? = null): DbRef {
        return DbRef(generatedCore, namespace, instanceId, databaseLive)
    }

    /**
     * Create a [RoomClient] for a specific namespace and room ID.
     *
     * ```kotlin
     * val room = client.room("game", "room-123")
     * room.join()
     * val result = room.send("SET_SCORE", mapOf("score" to 42))
     * ```
     */
    fun room(namespace: String, roomId: String, options: RoomOptions = RoomOptions()): RoomClient {
        return RoomClient(baseUrl, namespace, roomId, _tokenManager, options, core = generatedCore)
    }

    fun setLocale(locale: String?) {
        httpClient.setLocale(locale)
    }

    fun getLocale(): String? = httpClient.getLocale()

    suspend fun setContext(context: Map<String, Any>) {
        contextManager.setContext(context)
    }

    suspend fun getContext(): Map<String, Any> = contextManager.getContext()

    /** Try to restore session from persistent token storage. */
    suspend fun tryRestoreSession(): Boolean {
        return _tokenManager.tryRestoreSession()
    }

    /** Destroy — clean up resources (Ktor engine, coroutine scopes). */
    suspend fun destroy() {
        analytics.destroy()
        _tokenManager.destroy()
        databaseLive.destroy()
        httpClient.close()
    }
}
