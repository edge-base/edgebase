// EdgeBase Kotlin SDK — Database live client (KMP).
//
// Ktor WebSocket-based subscriptions with auto-reconnect.
// Supports table subscriptions (Flow) and server-side filters.
// Auth via WebSocket message (not HTTP headers) — server database live endpoint requires
// a { type: "auth", token, sdkVersion } message after session open.
//: OkHttp WebSocket → Ktor WebSocket for KMP.

package dev.edgebase.sdk.client

import dev.edgebase.sdk.core.*
import dev.edgebase.sdk.core.DatabaseLiveClient as CoreDatabaseLiveClient
import dev.edgebase.sdk.core.generated.ApiPaths

import io.ktor.client.plugins.websocket.*
import io.ktor.client.request.*
import io.ktor.websocket.*

import kotlinx.coroutines.*
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.*

private const val SDK_VERSION = "0.1.5"

// MARK: - FilterTuple

/**
 * Server-side filter condition: [field, operator, value].
 * Mirrors the JS SDK FilterTuple type.
 */
typealias FilterTuple = Triple<String, String, Any?>

private fun normalizeDatabaseLiveChannel(tableOrChannel: String): String =
    if (tableOrChannel.startsWith("dblive:")) tableOrChannel else "dblive:$tableOrChannel"

private fun channelTableName(channel: String): String {
    val parts = channel.split(":")
    return when {
        parts.size <= 1 -> channel
        parts.size == 2 -> parts[1]
        parts.size == 3 -> parts[2]
        else -> parts[3]
    }
}

private fun matchesDatabaseLiveChannel(channel: String, change: DbChange, messageChannel: String? = null): Boolean {
    if (!messageChannel.isNullOrBlank()) {
        return channel == normalizeDatabaseLiveChannel(messageChannel)
    }
    val parts = channel.split(":")
    if (parts.firstOrNull() != "dblive") return false
    return when (parts.size) {
        2 -> parts[1] == change.table
        3 -> parts[2] == change.table
        4 -> {
            // Could be dblive:ns:table:docId or dblive:ns:instanceId:table
            if (parts[2] == change.table && change.id == parts[3]) true
            else parts[3] == change.table
        }
        else -> parts[3] == change.table && change.id == parts[4]
    }
}

// MARK: - DatabaseLiveClient

/**
 * Database live client using Ktor WebSocket with automatic reconnection.
 *
 * Authentication is performed via WebSocket message (not HTTP headers):
 * after the WS session opens, we send `{"type":"auth","token":"...","sdkVersion":"0.1.5"}`
 * and wait for `auth_success` or `auth_refreshed` before signaling ready.
 */
internal class DatabaseLiveClient(
    private val url: String,
    private val tokenManager: TokenManager
) : CoreDatabaseLiveClient {
    private val json = Json { ignoreUnknownKeys = true }
    private val ktorClient = createPlatformHttpClient().config {
        install(WebSockets)
    }
    private var session: DefaultClientWebSocketSession? = null
    private var isConnected = false
    private var isAuthenticated = false
    private var shouldReconnect = true
    private var connectionJob: Job? = null
    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())

    // Shared message flow for subscription lifecycle events.
    internal val messageFlow = MutableSharedFlow<Map<String, Any?>>(
        extraBufferCapacity = 64,
        onBufferOverflow = BufferOverflow.SUSPEND
    )

    /** Server-side filters per channel for recovery after FILTER_RESYNC. */
    private val channelFilters = mutableMapOf<String, List<FilterTuple>>()

    /** Server-side OR filters per channel for recovery after FILTER_RESYNC. */
    private val channelOrFilters = mutableMapOf<String, List<FilterTuple>>()

    /** Channels currently subscribed to — used for resubscribeAll() after auth. */
    private val subscribedChannels = mutableSetOf<String>()
    private var waitingForAuth = false

    init {
        if (tokenManager is ClientTokenManager) {
            tokenManager.setOnAuthStateChange { user ->
                handleAuthStateChange(user)
            }
        }
    }

    // MARK: - Connection

    private suspend fun ensureConnected(channel: String? = null) {
        if (isConnected && isAuthenticated) return
        val deferred = CompletableDeferred<Unit>()
        connect(channel, deferred)
        deferred.await()
    }

    private fun connect(channel: String? = null, readySignal: CompletableDeferred<Unit>? = null) {
        connectionJob?.cancel()
        connectionJob = scope.launch {
            try {
                val wsBase = url
                    .replace("https://", "wss://")
                    .replace("http://", "ws://") + ApiPaths.CONNECT_DATABASE_SUBSCRIPTION
                val wsUrl = if (channel != null) {
                    "$wsBase?channel=${platformUrlEncode(channel)}"
                } else wsBase

                ktorClient.webSocket(wsUrl) {
                    session = this
                    isConnected = true

                    // --- WebSocket auth handshake ---
                    // Server DatabaseLiveDO ignores HTTP headers; auth must be sent as a
                    // WebSocket message and we must wait for auth_success/auth_refreshed.
                    try {
                        authenticate(readySignal)
                    } catch (e: Exception) {
                        handleAuthenticationFailure(e)
                        readySignal?.complete(Unit) // Don't hang on auth failure
                        return@webSocket
                    }

                    // --- Normal incoming frame loop (post-auth) ---
                    try {
                        for (frame in incoming) {
                            if (frame is Frame.Text) {
                                processIncomingFrame(frame)
                            }
                        }
                    } catch (_: Exception) { /* connection closed */ }
                }
            } catch (_: Exception) {
                readySignal?.complete(Unit) // Don't hang on connection failure
            }

            isConnected = false
            isAuthenticated = false
            session = null

            if (shouldReconnect && !waitingForAuth) {
                delay(1000)
                connect()
            }
        }
    }

    // MARK: - Auth Handshake

    /**
     * Send auth message and wait for auth_success or auth_refreshed.
     *
     * This runs inside the `ktorClient.webSocket()` block, reading frames
     * from the incoming channel until the auth handshake completes.
     */
    private suspend fun DefaultClientWebSocketSession.authenticate(
        readySignal: CompletableDeferred<Unit>?
    ) {
        val token = tokenManager.getAccessToken()
        if (token == null) {
            val hasSession = tokenManager.getRefreshToken() != null
            val message = if (hasSession) {
                "DatabaseLive is waiting for an active access token."
            } else {
                "No access token available. Sign in first."
            }
            throw EdgeBaseError(401, message)
        }

        // Send auth message via the WebSocket session
        val authMsg = buildJsonObject {
            put("type", JsonPrimitive("auth"))
            put("token", JsonPrimitive(token))
            put("sdkVersion", JsonPrimitive(SDK_VERSION))
        }
        send(Frame.Text(json.encodeToString(JsonElement.serializer(), authMsg)))

        // Read frames until we get auth_success, auth_refreshed, or error
        for (frame in incoming) {
            if (frame !is Frame.Text) continue

            val text = frame.readText()
            val element = try {
                json.parseToJsonElement(text)
            } catch (_: Exception) { continue }

            @Suppress("UNCHECKED_CAST")
            val msg = HttpClient.jsonElementToAny(element) as? Map<String, Any?> ?: continue
            val type = msg["type"] as? String

            when (type) {
                "auth_success" -> {
                    isAuthenticated = true
                    resubscribeAll()
                    readySignal?.complete(Unit)
                    return
                }
                "auth_refreshed" -> {
                    handleAuthRefreshed(msg)
                    isAuthenticated = true
                    resubscribeAll()
                    readySignal?.complete(Unit)
                    return
                }
                "error" -> {
                    val errorMsg = msg["message"] as? String ?: "Auth failed"
                    throw EdgeBaseError(401, errorMsg)
                }
            }
            // Ignore unrelated messages during auth handshake
        }
        // If incoming channel closes without auth response, throw
        throw EdgeBaseError(401, "WebSocket closed before auth completed")
    }

    // MARK: - Incoming Frame Processing

    /**
     * Process an incoming text frame after authentication.
     * Intercepts auth_refreshed and FILTER_RESYNC before emitting to messageFlow.
     */
    private fun processIncomingFrame(frame: Frame.Text) {
        try {
            val text = frame.readText()
            val element = json.parseToJsonElement(text)
            @Suppress("UNCHECKED_CAST")
            val msg = HttpClient.jsonElementToAny(element) as? Map<String, Any?> ?: return

            val type = msg["type"] as? String

            // Intercept auth_refreshed: clean up revoked channels and dispatch
            if (type == "auth_refreshed") {
                handleAuthRefreshed(msg)
                // Dispatch subscription_revoked events to messageFlow for app listeners
                @Suppress("UNCHECKED_CAST")
                val revoked = (msg["revokedChannels"] as? List<*>)
                    ?.filterIsInstance<String>() ?: emptyList()
                for (ch in revoked) {
                    messageFlow.tryEmit(mapOf(
                        "type" to "subscription_revoked",
                        "channel" to ch
                    ))
                }
                return
            }

            // Intercept FILTER_RESYNC: re-send stored filters to server
            if (type == "FILTER_RESYNC") {
                resyncFilters()
                return
            }

            if (type == "batch_changes") {
                @Suppress("UNCHECKED_CAST")
                val changes = msg["changes"] as? List<Map<String, Any?>> ?: emptyList()
                val table = (msg["table"] as? String)
                    ?: channelTableName(msg["channel"] as? String ?: "")
                for (change in changes) {
                    messageFlow.tryEmit(mapOf(
                        "type" to "db_change",
                        "changeType" to change["event"],
                        "table" to table,
                        "docId" to change["docId"],
                        "data" to change["data"],
                        "timestamp" to change["timestamp"],
                    ))
                }
                return
            }

            // Handle NOT_AUTHENTICATED: attempt re-auth
            if (type == "error") {
                val code = msg["code"] as? String
                if (code == "NOT_AUTHENTICATED") {
                    isAuthenticated = false
                    scope.launch {
                        try {
                            session?.close(CloseReason(CloseReason.Codes.NORMAL, "Re-authenticating"))
                        } catch (_: Exception) { /* already closed */ }
                        session = null
                        isConnected = false
                        connect()
                    }
                }
            }

            // All other messages: emit to shared flow
            messageFlow.tryEmit(msg)
        } catch (_: Exception) { /* ignore parse failures */ }
    }

    // MARK: - Auth Refreshed Handling

    /**
     * Handle auth_refreshed: parse revokedChannels and clean up state.
     */
    private fun handleAuthRefreshed(msg: Map<String, Any?>) {
        @Suppress("UNCHECKED_CAST")
        val revoked = (msg["revokedChannels"] as? List<*>)
            ?.filterIsInstance<String>() ?: emptyList()
        for (ch in revoked) {
            subscribedChannels.remove(ch)
            channelFilters.remove(ch)
            channelOrFilters.remove(ch)
        }
    }

    // MARK: - Resubscribe / Resync

    /**
     * Re-subscribe all tracked channels with stored filters after auth.
     */
    private fun resubscribeAll() {
        for (channel in subscribedChannels.toList()) {
            sendSubscribeInternal(channel)
        }
    }

    private fun refreshAuth() {
        scope.launch {
            val token = tokenManager.getAccessToken() ?: return@launch
            sendMessage(mapOf(
                "type" to "auth",
                "token" to token,
                "sdkVersion" to SDK_VERSION
            ))
        }
    }

    private fun handleAuthStateChange(user: Map<String, Any?>?) {
        if (user != null) {
            if (isConnected && isAuthenticated) {
                refreshAuth()
                return
            }

            waitingForAuth = false
            if (subscribedChannels.isNotEmpty() && !isConnected) {
                connect(subscribedChannels.firstOrNull())
            }
            return
        }

        waitingForAuth = subscribedChannels.isNotEmpty()
        isConnected = false
        isAuthenticated = false
        scope.launch {
            try {
                session?.close(CloseReason(CloseReason.Codes.NORMAL, "Signed out"))
            } catch (_: Exception) { /* already closed */ }
            session = null
        }
    }

    private fun handleAuthenticationFailure(error: Exception) {
        waitingForAuth = error is EdgeBaseError
            && error.statusCode == 401
            && subscribedChannels.isNotEmpty()
        isConnected = false
        isAuthenticated = false
        scope.launch {
            try {
                session?.close(CloseReason(CloseReason.Codes.VIOLATED_POLICY, error.message ?: "Auth failed"))
            } catch (_: Exception) { /* already closed */ }
            session = null
        }
    }

    /**
     * Re-send stored filters to server after FILTER_RESYNC.
     */
    private fun resyncFilters() {
        for (channel in channelFilters.keys.toList()) {
            val filters = channelFilters[channel] ?: emptyList()
            val orFilters = channelOrFilters[channel] ?: emptyList()
            if (filters.isNotEmpty() || orFilters.isNotEmpty()) {
                val msg = mutableMapOf<String, Any?>(
                    "type" to "subscribe",
                    "channel" to channel
                )
                if (filters.isNotEmpty()) msg["filters"] = filters.toFilterJson()
                if (orFilters.isNotEmpty()) msg["orFilters"] = orFilters.toFilterJson()
                sendMessage(msg)
            }
        }
    }

    // MARK: - Send

    internal fun sendMessage(message: Map<String, Any?>) {
        val element = HttpClient.anyToJsonElement(message)
        val str = json.encodeToString(JsonElement.serializer(), element)
        scope.launch {
            try {
                session?.send(Frame.Text(str))
            } catch (_: Exception) { /* ignore if disconnected */ }
        }
    }

    /**
     * Send a subscribe message for a channel, including stored filters.
     */
    private fun sendSubscribeInternal(channel: String) {
        val msg = mutableMapOf<String, Any?>(
            "type" to "subscribe",
            "channel" to channel
        )
        val filters = channelFilters[channel]
        val orFilters = channelOrFilters[channel]
        if (filters != null && filters.isNotEmpty()) msg["filters"] = filters.toFilterJson()
        if (orFilters != null && orFilters.isNotEmpty()) msg["orFilters"] = orFilters.toFilterJson()
        sendMessage(msg)
    }

    // MARK: - Subscribe

    /**
     * Subscribe to a table and receive changes as a Flow.
     */
    override fun subscribe(tableName: String): Flow<DbChange> = subscribe(
        tableName = tableName,
        serverFilters = null,
        serverOrFilters = null
    )

    /**
     * Subscribe to a table with optional server-side filters and receive changes as a Flow.
     */
    fun subscribe(
        tableName: String,
        serverFilters: List<FilterTuple>? = null,
        serverOrFilters: List<FilterTuple>? = null
    ): Flow<DbChange> = callbackFlow {
        val channel = normalizeDatabaseLiveChannel(tableName)

        // Store filters for recovery
        if (serverFilters != null && serverFilters.isNotEmpty()) {
            channelFilters[channel] = serverFilters
        }
        if (serverOrFilters != null && serverOrFilters.isNotEmpty()) {
            channelOrFilters[channel] = serverOrFilters
        }

        // Track channel subscription
        subscribedChannels.add(channel)

        ensureConnected(channel)

        // Send subscribe message with filters
        sendSubscribeInternal(channel)

        val job = scope.launch {
            messageFlow.collect { msg ->
                val type = msg["type"] as? String
                if (type == "db_change") {
                    val change = DbChange.fromJson(msg)
                    val messageChannel = msg["channel"] as? String
                    if (matchesDatabaseLiveChannel(channel, change, messageChannel)) {
                        trySend(change)
                    }
                }
            }
        }

        awaitClose {
            job.cancel()
            subscribedChannels.remove(channel)
            channelFilters.remove(channel)
            channelOrFilters.remove(channel)
            sendMessage(mapOf(
                "type" to "unsubscribe",
                "channel" to channel
            ))
        }
    }

    /**
     * Unsubscribe from a channel by ID.
     */
    override fun unsubscribe(id: String) {
        subscribedChannels.remove(id)
        channelFilters.remove(id)
        channelOrFilters.remove(id)
        sendMessage(mapOf("type" to "unsubscribe", "channel" to id))
    }

    // MARK: - Cleanup

    fun destroy() {
        shouldReconnect = false
        // Cancel connection job — this aborts the WebSocket session.
        // Server detects the disconnect automatically.
        connectionJob?.cancel()
        session = null
        isConnected = false
        isAuthenticated = false
        subscribedChannels.clear()
        channelFilters.clear()
        channelOrFilters.clear()
        scope.cancel()
        ktorClient.close()
    }
}

// MARK: - FilterTuple JSON Conversion

/**
 * Convert a list of FilterTuples to the JSON-compatible list-of-lists format
 * expected by the server: [[field, op, value], ...]
 */
private fun List<FilterTuple>.toFilterJson(): List<List<Any?>> =
    map { (field, op, value) -> listOf(field, op, value) }
