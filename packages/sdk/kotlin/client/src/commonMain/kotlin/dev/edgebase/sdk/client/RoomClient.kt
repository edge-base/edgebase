// EdgeBase Kotlin SDK - RoomClient v2 (KMP)
// Real-time multiplayer state synchronisation.
//
// Complete redesign from v1.
// - 3 state areas: sharedState (all clients), playerState (per-player), serverState (server-only, not sent)
// - Client can only read + subscribe + send(). All writes are server-only.
// - send() returns a result via requestId matching (suspend + CompletableDeferred)
// - Subscription returns { unsubscribe() } object
// - namespace + roomId identification (replaces single roomId)

package dev.edgebase.sdk.client

import dev.edgebase.sdk.core.*
import dev.edgebase.sdk.core.generated.GeneratedDbApi
import io.ktor.client.plugins.websocket.*
import io.ktor.client.request.*
import io.ktor.client.statement.*
import io.ktor.websocket.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*

private const val ROOM_EXPLICIT_LEAVE_CLOSE_DELAY_MS = 40L

internal interface RoomSocketHandle {
    suspend fun send(frame: Frame)
    suspend fun close(reason: CloseReason)
}

private class KtorRoomSocketHandle(
    private val session: DefaultClientWebSocketSession,
) : RoomSocketHandle {
    override suspend fun send(frame: Frame) {
        session.send(frame)
    }

    override suspend fun close(reason: CloseReason) {
        session.close(reason)
    }
}

fun interface Subscription {
    fun unsubscribe()
}

data class RoomOptions(
    val autoReconnect: Boolean = true,
    val maxReconnectAttempts: Int = 10,
    val reconnectBaseDelayMs: Long = 1000L,
    val sendTimeoutMs: Long = 10000L,
    /** Timeout for WebSocket connection establishment in ms (default: 15000) */
    val connectionTimeoutMs: Long = 15000L,
)

typealias StateHandler = (Map<String, Any?>, Map<String, Any?>) -> Unit
typealias MessageHandler = (Any?) -> Unit
typealias ErrorHandler = (Map<String, String>) -> Unit
typealias KickedHandler = () -> Unit
typealias MembersSyncHandler = (List<Map<String, Any?>>) -> Unit
typealias MemberHandler = (Map<String, Any?>) -> Unit
typealias MemberLeaveHandler = (Map<String, Any?>, String) -> Unit
typealias MemberStateHandler = (Map<String, Any?>, Map<String, Any?>) -> Unit
typealias SignalHandler = (Any?, Map<String, Any?>) -> Unit
typealias AnySignalHandler = (String, Any?, Map<String, Any?>) -> Unit
typealias MediaTrackHandler = (Map<String, Any?>, Map<String, Any?>) -> Unit
typealias MediaStateHandler = (Map<String, Any?>, Map<String, Any?>) -> Unit
typealias MediaDeviceHandler = (Map<String, Any?>, Map<String, Any?>) -> Unit
typealias ReconnectHandler = (Map<String, Any?>) -> Unit
typealias ConnectionStateHandler = (String) -> Unit

class RoomClient(
    private val baseUrl: String,
    val namespace: String,
    val roomId: String,
    private val tokenManager: TokenManager,
    private val options: RoomOptions = RoomOptions(),
    private val core: GeneratedDbApi? = null,
) {
    private var _sharedState: MutableMap<String, Any?> = mutableMapOf()
    private var _sharedVersion: Int = 0
    private var _playerState: MutableMap<String, Any?> = mutableMapOf()
    private var _playerVersion: Int = 0
    private var _members: MutableList<MutableMap<String, Any?>> = mutableListOf()
    private var _mediaMembers: MutableList<MutableMap<String, Any?>> = mutableListOf()
    private var _connectionState: String = "idle"
    private var _reconnectInfo: MutableMap<String, Any?>? = null

    var userId: String? = null
        private set

    var connectionId: String? = null
        private set

    var players: List<Map<String, Any?>> = emptyList()
        private set

    private val json = Json { ignoreUnknownKeys = true }
    private val scope = CoroutineScope(Dispatchers.Default + SupervisorJob())
    private val ktorClient = createPlatformHttpClient().config { install(WebSockets) }
    private var webSocketSession: DefaultClientWebSocketSession? = null
    private var socketHandle: RoomSocketHandle? = null
    private var isConnected = false
    private var isAuthenticated = false
    private var isJoined = false
    private var intentionallyLeft = false
    private var reconnectAttempts = 0
    private var waitingForAuth = false
    private var joinRequested = false

    private val pendingRequests = mutableMapOf<String, CompletableDeferred<Any?>>()
    private val pendingSignalRequests = mutableMapOf<String, CompletableDeferred<Unit>>()
    private val pendingAdminRequests = mutableMapOf<String, CompletableDeferred<Unit>>()
    private val pendingMemberStateRequests = mutableMapOf<String, CompletableDeferred<Unit>>()
    private val pendingMediaRequests = mutableMapOf<String, CompletableDeferred<Unit>>()

    private val sharedStateHandlers = mutableListOf<StateHandler>()
    private val playerStateHandlers = mutableListOf<StateHandler>()
    private val messageHandlers = mutableMapOf<String, MutableList<MessageHandler>>()
    private val allMessageHandlers = mutableListOf<(String, Any?) -> Unit>()
    private val errorHandlers = mutableListOf<ErrorHandler>()
    private val kickedHandlers = mutableListOf<KickedHandler>()
    private val joinHandlers = mutableListOf<MemberHandler>()
    private val leaveHandlers = mutableListOf<MemberHandler>()
    private val memberSyncHandlers = mutableListOf<MembersSyncHandler>()
    private val memberJoinHandlers = mutableListOf<MemberHandler>()
    private val memberLeaveHandlers = mutableListOf<MemberLeaveHandler>()
    private val memberStateHandlers = mutableListOf<MemberStateHandler>()
    private val signalHandlers = mutableMapOf<String, MutableList<SignalHandler>>()
    private val anySignalHandlers = mutableListOf<AnySignalHandler>()
    private val mediaTrackHandlers = mutableListOf<MediaTrackHandler>()
    private val mediaTrackRemovedHandlers = mutableListOf<MediaTrackHandler>()
    private val mediaStateHandlers = mutableListOf<MediaStateHandler>()
    private val mediaDeviceHandlers = mutableListOf<MediaDeviceHandler>()
    private val reconnectHandlers = mutableListOf<ReconnectHandler>()
    private val connectionStateHandlers = mutableListOf<ConnectionStateHandler>()

    val state = RoomStateNamespace(this)
    val meta = RoomMetaNamespace(this)
    val signals = RoomSignalsNamespace(this)
    val members = RoomMembersNamespace(this)
    val admin = RoomAdminNamespace(this)
    val media = RoomMediaNamespace(this)
    val session = RoomSessionNamespace(this)

    init {
        if (tokenManager is ClientTokenManager) {
            tokenManager.setOnAuthStateChange { user ->
                handleAuthStateChange(user)
            }
        }
    }

    fun getSharedState(): Map<String, Any?> = cloneValue(_sharedState)

    fun getPlayerState(): Map<String, Any?> = cloneValue(_playerState)

    fun listMembers(): List<Map<String, Any?>> = cloneValue(_members.toList())

    fun listMediaMembers(): List<Map<String, Any?>> = cloneValue(_mediaMembers.toList())

    fun connectionState(): String = _connectionState

    internal fun attachSocketForTesting(
        socketHandle: RoomSocketHandle,
        connected: Boolean = true,
        authenticated: Boolean = true,
        joined: Boolean = true,
    ) {
        this.socketHandle = socketHandle
        isConnected = connected
        isAuthenticated = authenticated
        isJoined = joined
    }

    internal fun handleRawForTesting(text: String) {
        handleRaw(text)
    }

    @Suppress("UNCHECKED_CAST")
    suspend fun getMetadata(): Map<String, Any?> {
        if (core != null) {
            val query = mapOf("namespace" to namespace, "id" to roomId)
            return core.getRoomMetadata(query) as? Map<String, Any?> ?: emptyMap()
        }

        return getMetadata(baseUrl, namespace, roomId)
    }

    companion object {
        suspend fun getMetadata(
            baseUrl: String,
            namespace: String,
            roomId: String,
        ): Map<String, Any?> {
            val client = createPlatformHttpClient()
            val url = "${baseUrl.trimEnd('/')}/api/room/metadata?namespace=${platformUrlEncode(namespace)}&id=${platformUrlEncode(roomId)}"
            try {
                val response: HttpResponse = client.get(url)
                val body = response.bodyAsText()
                val json = Json { ignoreUnknownKeys = true }
                val element = json.parseToJsonElement(body)
                @Suppress("UNCHECKED_CAST")
                return HttpClient.jsonElementToAny(element) as? Map<String, Any?> ?: emptyMap()
            } finally {
                client.close()
            }
        }
    }

    fun join() {
        intentionallyLeft = false
        joinRequested = true
        setConnectionState(if (_reconnectInfo != null) "reconnecting" else "connecting")
        if (!isConnected) {
            scope.launch { establish() }
        }
    }

    fun leave() {
        intentionallyLeft = true
        joinRequested = false
        waitingForAuth = false

        pendingRequests.values.forEach { deferred ->
            deferred.completeExceptionally(EdgeBaseError(499, "Room left"))
        }
        pendingRequests.clear()
        rejectPendingUnitRequests(pendingSignalRequests, EdgeBaseError(499, "Room left"))
        rejectPendingUnitRequests(pendingAdminRequests, EdgeBaseError(499, "Room left"))
        rejectPendingUnitRequests(pendingMemberStateRequests, EdgeBaseError(499, "Room left"))
        rejectPendingUnitRequests(pendingMediaRequests, EdgeBaseError(499, "Room left"))

        val socket = socketHandle
        sendMsg(mapOf("type" to "leave"), requireAuth = false)
        scope.launch {
            delay(ROOM_EXPLICIT_LEAVE_CLOSE_DELAY_MS)
            try {
                socket?.close(CloseReason(CloseReason.Codes.NORMAL, "Client disconnect"))
            } catch (_: Exception) {
                // Already closed.
            }
        }

        webSocketSession = null
        socketHandle = null
        isConnected = false
        isAuthenticated = false
        isJoined = false
        reconnectAttempts = 0
        _sharedState = mutableMapOf()
        _sharedVersion = 0
        _playerState = mutableMapOf()
        _playerVersion = 0
        _members = mutableListOf()
        _mediaMembers = mutableListOf()
        _reconnectInfo = null
        userId = null
        connectionId = null
        players = emptyList()
        setConnectionState("idle")
    }

    suspend fun send(actionType: String, payload: Any? = null): Any? {
        if (!isConnected || !isAuthenticated) {
            throw EdgeBaseError(400, "Not connected to room")
        }

        val requestId = platformUuid()
        val deferred = CompletableDeferred<Any?>()
        pendingRequests[requestId] = deferred

        sendMsg(
            mapOf(
                "type" to "send",
                "actionType" to actionType,
                "payload" to (payload ?: emptyMap<String, Any?>()),
                "requestId" to requestId,
            ),
        )

        return try {
            withTimeout(options.sendTimeoutMs) {
                deferred.await()
            }
        } catch (_: TimeoutCancellationException) {
            pendingRequests.remove(requestId)
            throw EdgeBaseError(408, "Action '$actionType' timed out")
        }
    }

    suspend fun sendSignal(
        event: String,
        payload: Any? = null,
        options: Map<String, Any?> = emptyMap(),
    ) {
        sendUnitRequest(
            pendingSignalRequests,
            "Signal '$event' timed out",
        ) { requestId ->
            buildMap {
                put("type", "signal")
                put("event", event)
                put("payload", payload ?: emptyMap<String, Any?>())
                put("requestId", requestId)
                (options["includeSelf"] as? Boolean)?.let { put("includeSelf", it) }
                (options["memberId"] as? String)?.let { put("memberId", it) }
            }
        }
    }

    suspend fun sendMemberState(state: Map<String, Any?>) {
        sendUnitRequest(
            pendingMemberStateRequests,
            "Member state update timed out",
        ) { requestId ->
            mapOf(
                "type" to "member_state",
                "state" to state,
                "requestId" to requestId,
            )
        }
    }

    suspend fun clearMemberState() {
        sendUnitRequest(
            pendingMemberStateRequests,
            "Member state clear timed out",
        ) { requestId ->
            mapOf(
                "type" to "member_state_clear",
                "requestId" to requestId,
            )
        }
    }

    suspend fun sendAdmin(
        operation: String,
        memberId: String,
        payload: Any? = null,
    ) {
        sendUnitRequest(
            pendingAdminRequests,
            "Admin operation '$operation' timed out",
        ) { requestId ->
            mapOf(
                "type" to "admin",
                "operation" to operation,
                "memberId" to memberId,
                "payload" to (payload ?: emptyMap<String, Any?>()),
                "requestId" to requestId,
            )
        }
    }

    suspend fun sendMedia(
        operation: String,
        kind: String,
        payload: Any? = null,
    ) {
        sendUnitRequest(
            pendingMediaRequests,
            "Media operation '$operation' timed out",
        ) { requestId ->
            mapOf(
                "type" to "media",
                "operation" to operation,
                "kind" to kind,
                "payload" to (payload ?: emptyMap<String, Any?>()),
                "requestId" to requestId,
            )
        }
    }

    suspend fun switchMediaDevices(payload: Map<String, Any?>) {
        val audioInputId = payload["audioInputId"] as? String
        val videoInputId = payload["videoInputId"] as? String
        val screenInputId = payload["screenInputId"] as? String

        if (audioInputId != null) {
            sendMedia("device", "audio", mapOf("deviceId" to audioInputId))
        }
        if (videoInputId != null) {
            sendMedia("device", "video", mapOf("deviceId" to videoInputId))
        }
        if (screenInputId != null) {
            sendMedia("device", "screen", mapOf("deviceId" to screenInputId))
        }
    }

    fun onSharedState(handler: StateHandler): Subscription {
        sharedStateHandlers.add(handler)
        return Subscription { sharedStateHandlers.remove(handler) }
    }

    fun onPlayerState(handler: StateHandler): Subscription {
        playerStateHandlers.add(handler)
        return Subscription { playerStateHandlers.remove(handler) }
    }

    fun onMessage(messageType: String, handler: MessageHandler): Subscription {
        messageHandlers.getOrPut(messageType) { mutableListOf() }.add(handler)
        return Subscription {
            messageHandlers[messageType]?.remove(handler)
        }
    }

    fun onAnyMessage(handler: (String, Any?) -> Unit): Subscription {
        allMessageHandlers.add(handler)
        return Subscription { allMessageHandlers.remove(handler) }
    }

    fun onError(handler: ErrorHandler): Subscription {
        errorHandlers.add(handler)
        return Subscription { errorHandlers.remove(handler) }
    }

    fun onKicked(handler: KickedHandler): Subscription {
        kickedHandlers.add(handler)
        return Subscription { kickedHandlers.remove(handler) }
    }

    fun onJoin(handler: MemberHandler): Subscription {
        joinHandlers.add(handler)
        return Subscription { joinHandlers.remove(handler) }
    }

    fun onLeave(handler: MemberHandler): Subscription {
        leaveHandlers.add(handler)
        return Subscription { leaveHandlers.remove(handler) }
    }

    fun onMembersSync(handler: MembersSyncHandler): Subscription {
        memberSyncHandlers.add(handler)
        return Subscription { memberSyncHandlers.remove(handler) }
    }

    fun onMemberJoin(handler: MemberHandler): Subscription {
        memberJoinHandlers.add(handler)
        return Subscription { memberJoinHandlers.remove(handler) }
    }

    fun onMemberLeave(handler: MemberLeaveHandler): Subscription {
        memberLeaveHandlers.add(handler)
        return Subscription { memberLeaveHandlers.remove(handler) }
    }

    fun onMemberStateChange(handler: MemberStateHandler): Subscription {
        memberStateHandlers.add(handler)
        return Subscription { memberStateHandlers.remove(handler) }
    }

    fun onSignal(event: String, handler: SignalHandler): Subscription {
        signalHandlers.getOrPut(event) { mutableListOf() }.add(handler)
        return Subscription {
            signalHandlers[event]?.remove(handler)
        }
    }

    fun onAnySignal(handler: AnySignalHandler): Subscription {
        anySignalHandlers.add(handler)
        return Subscription { anySignalHandlers.remove(handler) }
    }

    fun onMediaTrack(handler: MediaTrackHandler): Subscription {
        mediaTrackHandlers.add(handler)
        return Subscription { mediaTrackHandlers.remove(handler) }
    }

    fun onMediaTrackRemoved(handler: MediaTrackHandler): Subscription {
        mediaTrackRemovedHandlers.add(handler)
        return Subscription { mediaTrackRemovedHandlers.remove(handler) }
    }

    fun onMediaStateChange(handler: MediaStateHandler): Subscription {
        mediaStateHandlers.add(handler)
        return Subscription { mediaStateHandlers.remove(handler) }
    }

    fun onMediaDeviceChange(handler: MediaDeviceHandler): Subscription {
        mediaDeviceHandlers.add(handler)
        return Subscription { mediaDeviceHandlers.remove(handler) }
    }

    fun onReconnect(handler: ReconnectHandler): Subscription {
        reconnectHandlers.add(handler)
        return Subscription { reconnectHandlers.remove(handler) }
    }

    fun onConnectionStateChange(handler: ConnectionStateHandler): Subscription {
        connectionStateHandlers.add(handler)
        return Subscription { connectionStateHandlers.remove(handler) }
    }

    private fun wsUrl(): String {
        val u = baseUrl.trimEnd('/')
            .replace("https://", "wss://")
            .replace("http://", "ws://")
        return "$u/api/room?namespace=${platformUrlEncode(namespace)}&id=${platformUrlEncode(roomId)}"
    }

    private suspend fun establish() {
        setConnectionState(if (_reconnectInfo != null) "reconnecting" else "connecting")

        try {
            val token = tokenManager.getAccessToken()
            if (token == null) {
                val hasSession = tokenManager.getRefreshToken() != null
                val message = if (hasSession) {
                    "Room is waiting for an active access token."
                } else {
                    "No access token available. Sign in first."
                }
                throw EdgeBaseError(401, message)
            }

            val url = wsUrl()
            try {
                withTimeout(options.connectionTimeoutMs) {
            ktorClient.webSocket(url) {
                webSocketSession = this
                socketHandle = KtorRoomSocketHandle(this)
                isConnected = true
                reconnectAttempts = 0

                val authMsg = mapOf("type" to "auth", "token" to token)
                send(Frame.Text(json.encodeToString(JsonElement.serializer(), HttpClient.anyToJsonElement(authMsg))))

                val authFrame = incoming.receive()
                if (authFrame is Frame.Text) {
                    val resp = json.parseToJsonElement(authFrame.readText()).jsonObject
                    val t = resp["type"]?.jsonPrimitive?.content ?: ""
                    if (t != "auth_success" && t != "auth_refreshed") {
                        throw EdgeBaseError(401, "Room auth failed: ${resp["message"]?.jsonPrimitive?.content}")
                    }

                    isAuthenticated = true
                    waitingForAuth = false
                    userId = resp["userId"]?.jsonPrimitive?.contentOrNull
                    connectionId = resp["connectionId"]?.jsonPrimitive?.contentOrNull

                    sendMsg(
                        mapOf(
                            "type" to "join",
                            "lastSharedState" to HashMap(_sharedState),
                            "lastSharedVersion" to _sharedVersion,
                            "lastPlayerState" to HashMap(_playerState),
                            "lastPlayerVersion" to _playerVersion,
                        ),
                    )
                    isJoined = true
                }

                val hbJob = launch { heartbeat() }

                try {
                    for (frame in incoming) {
                        if (frame is Frame.Text) {
                            handleRaw(frame.readText())
                        }
                    }
                } catch (_: Exception) {
                    // Connection closed.
                }

                hbJob.cancel()
            }
                } // withTimeout
            } catch (e: TimeoutCancellationException) {
                throw EdgeBaseError(408,
                    "Room WebSocket connection timed out after ${options.connectionTimeoutMs}ms. Is the server running?")
            }
        } catch (e: Exception) {
            handleAuthenticationFailure(e)
        }

        isConnected = false
        isAuthenticated = false
        isJoined = false
        val closeCode = try {
            webSocketSession?.closeReason?.await()?.code?.toInt()
        } catch (_: Throwable) {
            null
        }
        webSocketSession = null
        socketHandle = null
        if (closeCode == 4004 && _connectionState != "kicked") {
            handleKicked()
        }

        if (
            !intentionallyLeft &&
            !waitingForAuth &&
            options.autoReconnect &&
            reconnectAttempts < options.maxReconnectAttempts &&
            _connectionState != "kicked" &&
            _connectionState != "auth_lost"
        ) {
            val attempt = reconnectAttempts + 1
            val reconnectDelay = minOf(options.reconnectBaseDelayMs * (1L shl reconnectAttempts), 30000L)
            reconnectAttempts++
            beginReconnectAttempt(attempt)
            delay(reconnectDelay)
            if (joinRequested && !waitingForAuth) {
                establish()
            }
        } else if (!intentionallyLeft && _connectionState != "kicked" && _connectionState != "auth_lost") {
            setConnectionState("disconnected")
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun handleRaw(text: String) {
        val element = try {
            json.parseToJsonElement(text)
        } catch (_: Exception) {
            return
        }
        val msg = HttpClient.jsonElementToAny(element) as? Map<String, Any?> ?: return
        val type = msg["type"] as? String ?: return

        when (type) {
            "auth_success", "auth_refreshed" -> handleAuthSuccessFrame(msg)
            "sync" -> handleSync(msg)
            "shared_delta" -> handleSharedDelta(msg)
            "player_delta" -> handlePlayerDelta(msg)
            "action_result" -> handleActionResult(msg)
            "action_error" -> handleActionError(msg)
            "message" -> handleServerMessage(msg)
            "signal" -> handleSignalFrame(msg)
            "signal_sent" -> handleSignalSent(msg)
            "signal_error" -> handleSignalError(msg)
            "members_sync" -> handleMembersSync(msg)
            "member_join" -> handleMemberJoinFrame(msg)
            "member_leave" -> handleMemberLeaveFrame(msg)
            "member_state" -> handleMemberStateFrame(msg)
            "member_state_error" -> handleMemberStateError(msg)
            "admin_result" -> handleAdminResult(msg)
            "admin_error" -> handleAdminError(msg)
            "media_sync" -> handleMediaSync(msg)
            "media_track" -> handleMediaTrackFrame(msg)
            "media_track_removed" -> handleMediaTrackRemovedFrame(msg)
            "media_state" -> handleMediaStateFrame(msg)
            "media_device" -> handleMediaDeviceFrame(msg)
            "media_result" -> handleMediaResult(msg)
            "media_error" -> handleMediaError(msg)
            "kicked" -> handleKicked()
            "error" -> handleError(msg)
            "pong" -> Unit
        }
    }

    private fun handleAuthSuccessFrame(msg: Map<String, Any?>) {
        userId = msg["userId"] as? String ?: userId
        connectionId = msg["connectionId"] as? String ?: connectionId
    }

    @Suppress("UNCHECKED_CAST")
    private fun handleSync(msg: Map<String, Any?>) {
        _sharedState = ((msg["sharedState"] as? Map<String, Any?>) ?: emptyMap()).toMutableMap()
        _sharedVersion = (msg["sharedVersion"] as? Number)?.toInt() ?: 0
        _playerState = ((msg["playerState"] as? Map<String, Any?>) ?: emptyMap()).toMutableMap()
        _playerVersion = (msg["playerVersion"] as? Number)?.toInt() ?: 0

        val sharedSnapshot = getSharedState()
        val playerSnapshot = getPlayerState()
        setConnectionState("connected")

        val reconnectSnapshot = _reconnectInfo?.let { cloneValue(it) }
        _reconnectInfo = null
        reconnectSnapshot?.let { info ->
            reconnectHandlers.forEach { handler -> handler(info) }
        }

        sharedStateHandlers.forEach { handler -> handler(sharedSnapshot, sharedSnapshot) }
        playerStateHandlers.forEach { handler -> handler(playerSnapshot, playerSnapshot) }
    }

    @Suppress("UNCHECKED_CAST")
    private fun handleSharedDelta(msg: Map<String, Any?>) {
        val delta = msg["delta"] as? Map<String, Any?> ?: emptyMap()
        _sharedVersion = (msg["version"] as? Number)?.toInt() ?: _sharedVersion

        for ((path, value) in delta) {
            deepSet(_sharedState, path, value)
        }

        val sharedSnapshot = getSharedState()
        val deltaSnapshot = cloneValue(delta)
        sharedStateHandlers.forEach { handler -> handler(sharedSnapshot, deltaSnapshot) }
    }

    @Suppress("UNCHECKED_CAST")
    private fun handlePlayerDelta(msg: Map<String, Any?>) {
        val delta = msg["delta"] as? Map<String, Any?> ?: emptyMap()
        _playerVersion = (msg["version"] as? Number)?.toInt() ?: _playerVersion

        for ((path, value) in delta) {
            deepSet(_playerState, path, value)
        }

        val playerSnapshot = getPlayerState()
        val deltaSnapshot = cloneValue(delta)
        playerStateHandlers.forEach { handler -> handler(playerSnapshot, deltaSnapshot) }
    }

    private fun handleActionResult(msg: Map<String, Any?>) {
        val requestId = msg["requestId"] as? String ?: return
        val deferred = pendingRequests.remove(requestId) ?: return
        deferred.complete(msg["result"])
    }

    private fun handleActionError(msg: Map<String, Any?>) {
        val requestId = msg["requestId"] as? String ?: return
        val deferred = pendingRequests.remove(requestId) ?: return
        deferred.completeExceptionally(EdgeBaseError(400, msg["message"] as? String ?: "Action error"))
    }

    private fun handleServerMessage(msg: Map<String, Any?>) {
        val messageType = msg["messageType"] as? String ?: return
        val data = msg["data"]
        messageHandlers[messageType]?.forEach { handler -> handler(data) }
        allMessageHandlers.forEach { handler -> handler(messageType, data) }
    }

    private fun handleSignalFrame(msg: Map<String, Any?>) {
        val event = msg["event"] as? String ?: return
        val payload = msg["payload"]
        val meta = normalizeSignalMeta(msg["meta"])

        signalHandlers[event]?.forEach { handler ->
            handler(payload, cloneValue(meta))
        }
        anySignalHandlers.forEach { handler ->
            handler(event, payload, cloneValue(meta))
        }
    }

    private fun handleSignalSent(msg: Map<String, Any?>) {
        resolvePendingUnitRequest(pendingSignalRequests, msg["requestId"] as? String)
    }

    private fun handleSignalError(msg: Map<String, Any?>) {
        rejectPendingUnitRequest(
            pendingSignalRequests,
            msg["requestId"] as? String,
            EdgeBaseError(400, msg["message"] as? String ?: "Signal send failed"),
        )
    }

    private fun handleMembersSync(msg: Map<String, Any?>) {
        _members = normalizeMembers(msg["members"]).toMutableList()
        val memberIds = _members.mapNotNull { it["memberId"] as? String }.toSet()
        _mediaMembers = _mediaMembers.filterTo(mutableListOf()) { mediaMember ->
            val member = mediaMember["member"] as? Map<String, Any?>
            val memberId = member?.get("memberId") as? String
            memberId != null && memberIds.contains(memberId)
        }

        _members.forEach { member -> syncMediaMemberInfo(member) }
        players = listMembers()

        val snapshot = listMembers()
        memberSyncHandlers.forEach { handler -> handler(snapshot) }
    }

    private fun handleMemberJoinFrame(msg: Map<String, Any?>) {
        val member = normalizeMember(msg["member"]) ?: return
        upsertMember(member)
        syncMediaMemberInfo(member)
        players = listMembers()

        val snapshot = cloneValue(member)
        memberJoinHandlers.forEach { handler -> handler(cloneValue(snapshot)) }
        joinHandlers.forEach { handler -> handler(cloneValue(snapshot)) }
    }

    private fun handleMemberLeaveFrame(msg: Map<String, Any?>) {
        val member = normalizeMember(msg["member"]) ?: return
        removeMember(member["memberId"] as String)
        removeMediaMember(member["memberId"] as String)
        players = listMembers()

        val reason = normalizeLeaveReason(msg["reason"])
        val snapshot = cloneValue(member)
        memberLeaveHandlers.forEach { handler -> handler(cloneValue(snapshot), reason) }
        leaveHandlers.forEach { handler -> handler(cloneValue(snapshot)) }
    }

    private fun handleMemberStateFrame(msg: Map<String, Any?>) {
        val member = normalizeMember(msg["member"]) ?: return
        val state = normalizeState(msg["state"])
        member["state"] = cloneValue(state)
        upsertMember(member)
        syncMediaMemberInfo(member)
        players = listMembers()

        val requestId = msg["requestId"] as? String
        if (requestId != null && member["memberId"] == userId) {
            resolvePendingUnitRequest(pendingMemberStateRequests, requestId)
        }

        val memberSnapshot = cloneValue(member)
        val stateSnapshot = cloneValue(state)
        memberStateHandlers.forEach { handler -> handler(memberSnapshot, stateSnapshot) }
    }

    private fun handleMemberStateError(msg: Map<String, Any?>) {
        rejectPendingUnitRequest(
            pendingMemberStateRequests,
            msg["requestId"] as? String,
            EdgeBaseError(400, msg["message"] as? String ?: "Member state update failed"),
        )
    }

    private fun handleMediaSync(msg: Map<String, Any?>) {
        _mediaMembers = normalizeMediaMembers(msg["members"]).toMutableList()
        _members.forEach { member -> syncMediaMemberInfo(member) }
    }

    private fun handleMediaTrackFrame(msg: Map<String, Any?>) {
        val member = normalizeMember(msg["member"]) ?: return
        val track = normalizeMediaTrack(msg["track"]) ?: return
        val mediaMember = ensureMediaMember(member)
        upsertMediaTrack(mediaMember, track)
        mergeMediaState(
            mediaMember,
            track["kind"] as String,
            mapOf(
                "published" to true,
                "muted" to (track["muted"] as? Boolean ?: false),
                "trackId" to track["trackId"],
                "deviceId" to track["deviceId"],
                "publishedAt" to track["publishedAt"],
                "adminDisabled" to track["adminDisabled"],
            ),
        )

        val memberSnapshot = cloneValue(mediaMember["member"] as Map<String, Any?>)
        val trackSnapshot = cloneValue(track)
        mediaTrackHandlers.forEach { handler -> handler(trackSnapshot, memberSnapshot) }
    }

    private fun handleMediaTrackRemovedFrame(msg: Map<String, Any?>) {
        val member = normalizeMember(msg["member"]) ?: return
        val track = normalizeMediaTrack(msg["track"]) ?: return
        val mediaMember = ensureMediaMember(member)
        removeMediaTrack(mediaMember, track)

        val state = mutableMapOf<String, Any?>(
            "published" to false,
            "muted" to false,
            "adminDisabled" to false,
        )
        val mediaState = (mediaMember["state"] as? MutableMap<String, Any?>) ?: mutableMapOf()
        mediaState[track["kind"] as String] = state
        mediaMember["state"] = mediaState

        val memberSnapshot = cloneValue(mediaMember["member"] as Map<String, Any?>)
        val trackSnapshot = cloneValue(track)
        mediaTrackRemovedHandlers.forEach { handler -> handler(trackSnapshot, memberSnapshot) }
    }

    private fun handleMediaStateFrame(msg: Map<String, Any?>) {
        val member = normalizeMember(msg["member"]) ?: return
        val mediaMember = ensureMediaMember(member)
        mediaMember["state"] = normalizeMediaState(msg["state"])

        val memberSnapshot = cloneValue(mediaMember["member"] as Map<String, Any?>)
        val stateSnapshot = cloneValue(mediaMember["state"] as Map<String, Any?>)
        mediaStateHandlers.forEach { handler -> handler(memberSnapshot, stateSnapshot) }
    }

    private fun handleMediaDeviceFrame(msg: Map<String, Any?>) {
        val member = normalizeMember(msg["member"]) ?: return
        val kind = normalizeMediaKind(msg["kind"]) ?: return
        val deviceId = msg["deviceId"] as? String ?: return
        val mediaMember = ensureMediaMember(member)

        mergeMediaState(mediaMember, kind, mapOf("deviceId" to deviceId))
        val tracks = ((mediaMember["tracks"] as? List<Map<String, Any?>>) ?: emptyList()).map { track ->
            if (track["kind"] == kind) {
                cloneMutableMap(track).also { it["deviceId"] = deviceId }
            } else {
                cloneMutableMap(track)
            }
        }
        mediaMember["tracks"] = tracks.toMutableList()

        val memberSnapshot = cloneValue(mediaMember["member"] as Map<String, Any?>)
        val change = mutableMapOf<String, Any?>(
            "kind" to kind,
            "deviceId" to deviceId,
        )
        mediaDeviceHandlers.forEach { handler -> handler(memberSnapshot, cloneValue(change)) }
    }

    private fun handleMediaResult(msg: Map<String, Any?>) {
        resolvePendingUnitRequest(pendingMediaRequests, msg["requestId"] as? String)
    }

    private fun handleMediaError(msg: Map<String, Any?>) {
        rejectPendingUnitRequest(
            pendingMediaRequests,
            msg["requestId"] as? String,
            EdgeBaseError(400, msg["message"] as? String ?: "Media operation failed"),
        )
    }

    private fun handleAdminResult(msg: Map<String, Any?>) {
        resolvePendingUnitRequest(pendingAdminRequests, msg["requestId"] as? String)
    }

    private fun handleAdminError(msg: Map<String, Any?>) {
        rejectPendingUnitRequest(
            pendingAdminRequests,
            msg["requestId"] as? String,
            EdgeBaseError(400, msg["message"] as? String ?: "Admin operation failed"),
        )
    }

    private fun handleKicked() {
        kickedHandlers.forEach { handler -> handler() }
        intentionallyLeft = true
        joinRequested = false
        _reconnectInfo = null
        setConnectionState("kicked")
    }

    private fun handleError(msg: Map<String, Any?>) {
        val err = mapOf(
            "code" to (msg["code"] as? String ?: ""),
            "message" to (msg["message"] as? String ?: ""),
        )
        errorHandlers.forEach { handler -> handler(err) }
    }

    private fun sendMsg(msg: Map<String, Any?>, requireAuth: Boolean = true) {
        if (!isConnected) return
        if (requireAuth && !isAuthenticated) return

        val element = HttpClient.anyToJsonElement(msg)
        val str = json.encodeToString(JsonElement.serializer(), element)
        scope.launch {
            try {
                socketHandle?.send(Frame.Text(str))
            } catch (_: Exception) {
                // Socket is gone.
            }
        }
    }

    private suspend fun heartbeat() {
        while (isConnected) {
            delay(30_000L)
            sendMsg(mapOf("type" to "ping"))
        }
    }

    private fun refreshAuth() {
        scope.launch {
            val token = tokenManager.getAccessToken() ?: return@launch
            sendMsg(mapOf("type" to "auth", "token" to token))
        }
    }

    private fun handleAuthStateChange(user: Map<String, Any?>?) {
        if (user != null) {
            if (isConnected && isAuthenticated) {
                refreshAuth()
                return
            }

            waitingForAuth = false
            if (joinRequested && !isConnected) {
                reconnectAttempts = 0
                scope.launch { establish() }
            }
            return
        }

        val socket = socketHandle
        waitingForAuth = joinRequested
        _reconnectInfo = null
        setConnectionState("auth_lost")
        sendMsg(mapOf("type" to "leave"), requireAuth = false)

        isConnected = false
        isAuthenticated = false
        isJoined = false
        webSocketSession = null
        socketHandle = null
        _members = mutableListOf()
        _mediaMembers = mutableListOf()
        players = emptyList()
        userId = null
        connectionId = null

        scope.launch {
            try {
                delay(ROOM_EXPLICIT_LEAVE_CLOSE_DELAY_MS)
                socket?.close(CloseReason(CloseReason.Codes.NORMAL, "Signed out"))
            } catch (_: Exception) {
                // Already closed.
            }
        }
    }

    private fun handleAuthenticationFailure(error: Exception) {
        waitingForAuth = error is EdgeBaseError && error.statusCode == 401 && joinRequested
        if (waitingForAuth) {
            setConnectionState("auth_lost")
        }
        isConnected = false
        isAuthenticated = false
        isJoined = false
    }

    fun destroy() {
        leave()
        scope.cancel()
        ktorClient.close()
    }

    private suspend fun sendUnitRequest(
        pending: MutableMap<String, CompletableDeferred<Unit>>,
        timeoutMessage: String,
        buildMessage: (String) -> Map<String, Any?>,
    ) {
        if (!isConnected || !isAuthenticated) {
            throw EdgeBaseError(400, "Not connected to room")
        }

        val requestId = platformUuid()
        val deferred = CompletableDeferred<Unit>()
        pending[requestId] = deferred
        sendMsg(buildMessage(requestId))

        try {
            withTimeout(options.sendTimeoutMs) {
                deferred.await()
            }
        } catch (_: TimeoutCancellationException) {
            pending.remove(requestId)
            throw EdgeBaseError(408, timeoutMessage)
        }
    }

    private fun resolvePendingUnitRequest(
        pending: MutableMap<String, CompletableDeferred<Unit>>,
        requestId: String?,
    ) {
        if (requestId == null) return
        pending.remove(requestId)?.complete(Unit)
    }

    private fun rejectPendingUnitRequest(
        pending: MutableMap<String, CompletableDeferred<Unit>>,
        requestId: String?,
        error: EdgeBaseError,
    ) {
        if (requestId == null) return
        pending.remove(requestId)?.completeExceptionally(error)
    }

    private fun rejectPendingUnitRequests(
        pending: MutableMap<String, CompletableDeferred<Unit>>,
        error: EdgeBaseError,
    ) {
        pending.values.forEach { deferred ->
            deferred.completeExceptionally(error)
        }
        pending.clear()
    }

    private fun setConnectionState(next: String) {
        if (_connectionState == next) return
        _connectionState = next
        connectionStateHandlers.forEach { handler -> handler(next) }
    }

    private fun beginReconnectAttempt(attempt: Int) {
        _reconnectInfo = mutableMapOf("attempt" to attempt)
        setConnectionState("reconnecting")
    }

    private fun upsertMember(member: Map<String, Any?>) {
        val memberId = member["memberId"] as? String ?: return
        val index = _members.indexOfFirst { it["memberId"] == memberId }
        val snapshot = cloneMutableMap(member)
        if (index >= 0) {
            _members[index] = snapshot
        } else {
            _members.add(snapshot)
        }
    }

    private fun removeMember(memberId: String) {
        _members = _members.filterTo(mutableListOf()) { it["memberId"] != memberId }
    }

    private fun syncMediaMemberInfo(member: Map<String, Any?>) {
        val memberId = member["memberId"] as? String ?: return
        val mediaMember = _mediaMembers.find { entry ->
            val info = entry["member"] as? Map<String, Any?>
            info?.get("memberId") == memberId
        } ?: return

        mediaMember["member"] = cloneMutableMap(member)
    }

    private fun ensureMediaMember(member: Map<String, Any?>): MutableMap<String, Any?> {
        val memberId = member["memberId"] as? String ?: return mutableMapOf(
            "member" to cloneMutableMap(member),
            "state" to mutableMapOf<String, Any?>(),
            "tracks" to mutableListOf<Map<String, Any?>>(),
        )

        val existing = _mediaMembers.find { entry ->
            val info = entry["member"] as? Map<String, Any?>
            info?.get("memberId") == memberId
        }
        if (existing != null) {
            existing["member"] = cloneMutableMap(member)
            return existing
        }

        val created = mutableMapOf<String, Any?>(
            "member" to cloneMutableMap(member),
            "state" to mutableMapOf<String, Any?>(),
            "tracks" to mutableListOf<Map<String, Any?>>(),
        )
        _mediaMembers.add(created)
        return created
    }

    private fun removeMediaMember(memberId: String) {
        _mediaMembers = _mediaMembers.filterTo(mutableListOf()) { entry ->
            val info = entry["member"] as? Map<String, Any?>
            info?.get("memberId") != memberId
        }
    }

    private fun upsertMediaTrack(
        mediaMember: MutableMap<String, Any?>,
        track: Map<String, Any?>,
    ) {
        val kind = track["kind"] as? String ?: return
        val trackId = track["trackId"] as? String
        val tracks = ((mediaMember["tracks"] as? List<Map<String, Any?>>) ?: emptyList()).toMutableList()

        val index = tracks.indexOfFirst { existing ->
            existing["kind"] == kind &&
                if (trackId != null) existing["trackId"] == trackId else existing["trackId"] == null
        }

        val snapshot = cloneMutableMap(track)
        if (index >= 0) {
            tracks[index] = snapshot
        } else {
            val filtered = tracks.filterTo(mutableListOf()) { existing ->
                !(trackId == null && existing["kind"] == kind && existing["trackId"] == null)
            }
            filtered.add(snapshot)
            mediaMember["tracks"] = filtered
            return
        }

        mediaMember["tracks"] = tracks
    }

    private fun removeMediaTrack(
        mediaMember: MutableMap<String, Any?>,
        track: Map<String, Any?>,
    ) {
        val kind = track["kind"] as? String ?: return
        val trackId = track["trackId"] as? String
        val tracks = ((mediaMember["tracks"] as? List<Map<String, Any?>>) ?: emptyList()).filterTo(mutableListOf()) { existing ->
            if (trackId != null) {
                !(existing["kind"] == kind && existing["trackId"] == trackId)
            } else {
                existing["kind"] != kind
            }
        }
        mediaMember["tracks"] = tracks
    }

    private fun mergeMediaState(
        mediaMember: MutableMap<String, Any?>,
        kind: String,
        partial: Map<String, Any?>,
    ) {
        val state = ((mediaMember["state"] as? Map<String, Any?>) ?: emptyMap()).toMutableMap()
        val current = ((state[kind] as? Map<String, Any?>) ?: emptyMap()).toMutableMap()
        val next = mutableMapOf<String, Any?>(
            "published" to ((partial["published"] as? Boolean) ?: (current["published"] as? Boolean) ?: false),
            "muted" to ((partial["muted"] as? Boolean) ?: (current["muted"] as? Boolean) ?: false),
        )

        val trackId = partial["trackId"] ?: current["trackId"]
        val deviceId = partial["deviceId"] ?: current["deviceId"]
        val publishedAt = partial["publishedAt"] ?: current["publishedAt"]
        val adminDisabled = partial["adminDisabled"] ?: current["adminDisabled"]

        if (trackId != null) next["trackId"] = trackId
        if (deviceId != null) next["deviceId"] = deviceId
        if (publishedAt != null) next["publishedAt"] = publishedAt
        if (adminDisabled != null) next["adminDisabled"] = adminDisabled

        state[kind] = next
        mediaMember["state"] = state
    }

    private fun normalizeMembers(value: Any?): List<MutableMap<String, Any?>> {
        return (value as? List<*>)?.mapNotNull { normalizeMember(it) } ?: emptyList()
    }

    private fun normalizeMember(value: Any?): MutableMap<String, Any?>? {
        val member = value as? Map<String, Any?> ?: return null
        val memberId = member["memberId"] as? String ?: return null
        val userId = member["userId"] as? String ?: return null

        return buildMap<String, Any?> {
            put("memberId", memberId)
            put("userId", userId)
            (member["connectionId"] as? String)?.let { put("connectionId", it) }
            (member["connectionCount"] as? Number)?.let { put("connectionCount", it.toInt()) }
            (member["role"] as? String)?.let { put("role", it) }
            put("state", normalizeState(member["state"]))
        }.toMutableMap()
    }

    private fun normalizeState(value: Any?): MutableMap<String, Any?> {
        val state = value as? Map<String, Any?> ?: emptyMap()
        return cloneMutableMap(state)
    }

    private fun normalizeMediaMembers(value: Any?): List<MutableMap<String, Any?>> {
        return (value as? List<*>)?.mapNotNull { normalizeMediaMember(it) } ?: emptyList()
    }

    private fun normalizeMediaMember(value: Any?): MutableMap<String, Any?>? {
        val entry = value as? Map<String, Any?> ?: return null
        val member = normalizeMember(entry["member"]) ?: return null
        return mutableMapOf(
            "member" to member,
            "state" to normalizeMediaState(entry["state"]),
            "tracks" to normalizeMediaTracks(entry["tracks"]).toMutableList(),
        )
    }

    private fun normalizeMediaState(value: Any?): MutableMap<String, Any?> {
        val state = value as? Map<String, Any?> ?: emptyMap()
        val normalized = mutableMapOf<String, Any?>()
        normalizeMediaKindState(state["audio"])?.let { normalized["audio"] = it }
        normalizeMediaKindState(state["video"])?.let { normalized["video"] = it }
        normalizeMediaKindState(state["screen"])?.let { normalized["screen"] = it }
        return normalized
    }

    private fun normalizeMediaKindState(value: Any?): MutableMap<String, Any?>? {
        val state = value as? Map<String, Any?> ?: return null
        val normalized = mutableMapOf<String, Any?>(
            "published" to (state["published"] == true),
            "muted" to (state["muted"] == true),
        )
        (state["trackId"] as? String)?.let { normalized["trackId"] = it }
        (state["deviceId"] as? String)?.let { normalized["deviceId"] = it }
        (state["publishedAt"] as? Number)?.let { normalized["publishedAt"] = it }
        if (state["adminDisabled"] != null) {
            normalized["adminDisabled"] = state["adminDisabled"] == true
        }
        return normalized
    }

    private fun normalizeMediaTracks(value: Any?): List<MutableMap<String, Any?>> {
        return (value as? List<*>)?.mapNotNull { normalizeMediaTrack(it) } ?: emptyList()
    }

    private fun normalizeMediaTrack(value: Any?): MutableMap<String, Any?>? {
        val track = value as? Map<String, Any?> ?: return null
        val kind = normalizeMediaKind(track["kind"]) ?: return null
        val normalized = mutableMapOf<String, Any?>(
            "kind" to kind,
            "muted" to (track["muted"] == true),
        )
        (track["trackId"] as? String)?.let { normalized["trackId"] = it }
        (track["deviceId"] as? String)?.let { normalized["deviceId"] = it }
        (track["publishedAt"] as? Number)?.let { normalized["publishedAt"] = it }
        if (track["adminDisabled"] != null) {
            normalized["adminDisabled"] = track["adminDisabled"] == true
        }
        return normalized
    }

    private fun normalizeMediaKind(value: Any?): String? {
        return when (value as? String) {
            "audio", "video", "screen" -> value
            else -> null
        }
    }

    private fun normalizeSignalMeta(value: Any?): MutableMap<String, Any?> {
        val meta = value as? Map<String, Any?> ?: return mutableMapOf()
        val normalized = mutableMapOf<String, Any?>()
        when (val memberId = meta["memberId"]) {
            is String -> normalized["memberId"] = memberId
            null -> Unit
        }
        when (val userId = meta["userId"]) {
            is String -> normalized["userId"] = userId
            null -> Unit
        }
        when (val connectionId = meta["connectionId"]) {
            is String -> normalized["connectionId"] = connectionId
            null -> Unit
        }
        (meta["sentAt"] as? Number)?.let { normalized["sentAt"] = it }
        if (meta["serverSent"] != null) {
            normalized["serverSent"] = meta["serverSent"] == true
        }
        return normalized
    }

    private fun normalizeLeaveReason(value: Any?): String {
        return when (value as? String) {
            "leave", "timeout", "kicked" -> value
            else -> "leave"
        }
    }
}

class RoomStateNamespace(private val client: RoomClient) {
    fun getShared(): Map<String, Any?> = client.getSharedState()

    fun getMine(): Map<String, Any?> = client.getPlayerState()

    fun onSharedChange(handler: StateHandler): Subscription = client.onSharedState(handler)

    fun onMineChange(handler: StateHandler): Subscription = client.onPlayerState(handler)

    suspend fun send(actionType: String, payload: Any? = null): Any? = client.send(actionType, payload)
}

class RoomMetaNamespace(private val client: RoomClient) {
    suspend fun get(): Map<String, Any?> = client.getMetadata()
}

class RoomSignalsNamespace(private val client: RoomClient) {
    suspend fun send(
        event: String,
        payload: Any? = null,
        options: Map<String, Any?> = emptyMap(),
    ) {
        client.sendSignal(event, payload, options)
    }

    suspend fun sendTo(
        memberId: String,
        event: String,
        payload: Any? = null,
    ) {
        client.sendSignal(event, payload, mapOf("memberId" to memberId))
    }

    fun on(event: String, handler: SignalHandler): Subscription = client.onSignal(event, handler)

    fun onAny(handler: AnySignalHandler): Subscription = client.onAnySignal(handler)
}

class RoomMembersNamespace(private val client: RoomClient) {
    fun list(): List<Map<String, Any?>> = client.listMembers()

    fun onSync(handler: MembersSyncHandler): Subscription = client.onMembersSync(handler)

    fun onJoin(handler: MemberHandler): Subscription = client.onMemberJoin(handler)

    fun onLeave(handler: MemberLeaveHandler): Subscription = client.onMemberLeave(handler)

    suspend fun setState(state: Map<String, Any?>) {
        client.sendMemberState(state)
    }

    suspend fun clearState() {
        client.clearMemberState()
    }

    fun onStateChange(handler: MemberStateHandler): Subscription = client.onMemberStateChange(handler)
}

class RoomAdminNamespace(private val client: RoomClient) {
    suspend fun kick(memberId: String) {
        client.sendAdmin("kick", memberId)
    }

    suspend fun mute(memberId: String) {
        client.sendAdmin("mute", memberId)
    }

    suspend fun block(memberId: String) {
        client.sendAdmin("block", memberId)
    }

    suspend fun setRole(memberId: String, role: String) {
        client.sendAdmin("setRole", memberId, mapOf("role" to role))
    }

    suspend fun disableVideo(memberId: String) {
        client.sendAdmin("disableVideo", memberId)
    }

    suspend fun stopScreenShare(memberId: String) {
        client.sendAdmin("stopScreenShare", memberId)
    }
}

class RoomMediaKindNamespace(
    private val client: RoomClient,
    private val kind: String,
) {
    suspend fun enable(payload: Map<String, Any?> = emptyMap()) {
        client.sendMedia("publish", kind, payload)
    }

    suspend fun disable() {
        client.sendMedia("unpublish", kind)
    }

    suspend fun setMuted(muted: Boolean) {
        client.sendMedia("mute", kind, mapOf("muted" to muted))
    }
}

class RoomScreenMediaNamespace(private val client: RoomClient) {
    suspend fun start(payload: Map<String, Any?> = emptyMap()) {
        client.sendMedia("publish", "screen", payload)
    }

    suspend fun stop() {
        client.sendMedia("unpublish", "screen")
    }
}

class RoomMediaDevicesNamespace(private val client: RoomClient) {
    suspend fun switch(payload: Map<String, Any?>) {
        client.switchMediaDevices(payload)
    }
}

class RoomMediaNamespace(private val client: RoomClient) {
    val audio = RoomMediaKindNamespace(client, "audio")
    val video = RoomMediaKindNamespace(client, "video")
    val screen = RoomScreenMediaNamespace(client)
    val devices = RoomMediaDevicesNamespace(client)

    fun list(): List<Map<String, Any?>> = client.listMediaMembers()

    fun onTrack(handler: MediaTrackHandler): Subscription = client.onMediaTrack(handler)

    fun onTrackRemoved(handler: MediaTrackHandler): Subscription = client.onMediaTrackRemoved(handler)

    fun onStateChange(handler: MediaStateHandler): Subscription = client.onMediaStateChange(handler)

    fun onDeviceChange(handler: MediaDeviceHandler): Subscription = client.onMediaDeviceChange(handler)
}

class RoomSessionNamespace(private val client: RoomClient) {
    fun onError(handler: ErrorHandler): Subscription = client.onError(handler)

    fun onKicked(handler: KickedHandler): Subscription = client.onKicked(handler)

    fun onReconnect(handler: ReconnectHandler): Subscription = client.onReconnect(handler)

    fun onConnectionStateChange(handler: ConnectionStateHandler): Subscription =
        client.onConnectionStateChange(handler)

    val connectionState: String
        get() = client.connectionState()

    val userId: String?
        get() = client.userId

    val connectionId: String?
        get() = client.connectionId
}

@Suppress("UNCHECKED_CAST")
private fun <T> cloneValue(value: T): T {
    val element = HttpClient.anyToJsonElement(value)
    return HttpClient.jsonElementToAny(element) as T
}

private fun cloneMutableMap(value: Map<String, Any?>): MutableMap<String, Any?> =
    cloneValue<Map<String, Any?>>(value).toMutableMap()

@Suppress("UNCHECKED_CAST")
private fun deepSet(obj: MutableMap<String, Any?>, path: String, value: Any?) {
    val dot = path.indexOf('.')
    if (dot < 0) {
        if (value == null) {
            obj.remove(path)
        } else {
            obj[path] = value
        }
        return
    }

    val head = path.substring(0, dot)
    val tail = path.substring(dot + 1)
    val nested = (obj[head] as? Map<String, Any?>)?.toMutableMap() ?: mutableMapOf()
    obj[head] = nested
    deepSet(nested, tail, value)
}
