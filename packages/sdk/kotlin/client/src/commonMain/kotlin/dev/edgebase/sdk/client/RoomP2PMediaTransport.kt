package dev.edgebase.sdk.client

import dev.edgebase.sdk.core.platformUuid
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val ROOM_P2P_DEFAULT_SIGNAL_PREFIX = "edgebase.media.p2p"
private const val ROOM_P2P_DEFAULT_MEMBER_READY_TIMEOUT_MS = 10_000L
private const val ROOM_P2P_DOCS_URL = "https://edgebase.fun/docs/room/media"

private val ROOM_P2P_DEFAULT_ICE_SERVERS = listOf(
    RoomP2PIceServerOptions(
        urls = listOf("stun:stun.l.google.com:19302"),
    ),
)

data class RoomP2PIceServerOptions(
    val urls: List<String>,
    val username: String? = null,
    val credential: String? = null,
)

data class RoomP2PRtcConfigurationOptions(
    val iceServers: List<RoomP2PIceServerOptions> = ROOM_P2P_DEFAULT_ICE_SERVERS,
)

internal fun interface RoomP2PMediaRuntimeFactory {
    fun create(): RoomP2PMediaRuntimeAdapter
}

data class RoomP2PMediaTransportOptions(
    val signalPrefix: String = ROOM_P2P_DEFAULT_SIGNAL_PREFIX,
    val rtcConfiguration: RoomP2PRtcConfigurationOptions = RoomP2PRtcConfigurationOptions(),
    val currentMemberTimeoutMs: Long = ROOM_P2P_DEFAULT_MEMBER_READY_TIMEOUT_MS,
)

internal var roomP2PMediaRuntimeFactoryOverride: RoomP2PMediaRuntimeFactory? = null

internal data class RoomP2PSessionDescription(
    val type: String,
    val sdp: String,
)

internal data class RoomP2PIceCandidate(
    val candidate: String,
    val sdpMid: String? = null,
    val sdpMLineIndex: Int = 0,
)

internal interface RoomP2PMediaTrackAdapter {
    val id: String
    val kind: String
    val deviceId: String?
    var enabled: Boolean
    fun stop()
    fun onEnded(handler: (() -> Unit)?)
    fun dispose()
    fun asAny(): Any?
}

internal interface RoomP2PMediaStreamAdapter {
    fun release()
    fun asAny(): Any?
}

internal data class RoomP2PCapturedTrack(
    val kind: String,
    val track: RoomP2PMediaTrackAdapter,
    val stream: RoomP2PMediaStreamAdapter,
    val stopOnCleanup: Boolean,
)

internal data class RoomP2PRemoteTrackPayload(
    val track: RoomP2PMediaTrackAdapter,
    val stream: RoomP2PMediaStreamAdapter,
)

internal interface RoomP2PRtpSenderAdapter {
    val track: RoomP2PMediaTrackAdapter?
    suspend fun replaceTrack(track: RoomP2PMediaTrackAdapter)
}

internal interface RoomP2PPeerConnectionAdapter {
    val connectionState: String
    val signalingState: String
    val localDescription: RoomP2PSessionDescription?
    val remoteDescription: RoomP2PSessionDescription?
    fun setIceCandidateHandler(handler: (suspend (RoomP2PIceCandidate) -> Unit)?)
    fun setNegotiationNeededHandler(handler: (suspend () -> Unit)?)
    fun setTrackHandler(handler: (suspend (RoomP2PRemoteTrackPayload) -> Unit)?)
    suspend fun createOffer(): RoomP2PSessionDescription
    suspend fun createAnswer(): RoomP2PSessionDescription
    suspend fun setLocalDescription(description: RoomP2PSessionDescription)
    suspend fun setRemoteDescription(description: RoomP2PSessionDescription)
    suspend fun addIceCandidate(candidate: RoomP2PIceCandidate): Boolean
    fun addTrack(track: RoomP2PMediaTrackAdapter, stream: RoomP2PMediaStreamAdapter): RoomP2PRtpSenderAdapter
    fun removeTrack(sender: RoomP2PRtpSenderAdapter): Boolean
    fun close()
    fun asAny(): Any?
}

internal interface RoomP2PMediaRuntimeAdapter {
    suspend fun createPeerConnection(configuration: RoomP2PRtcConfigurationOptions): RoomP2PPeerConnectionAdapter
    suspend fun captureUserMedia(kind: String, deviceId: String? = null): RoomP2PCapturedTrack?
    suspend fun captureDisplayMedia(): RoomP2PCapturedTrack?
    fun destroy() {}
}

private data class RoomP2PLocalTrackState(
    val kind: String,
    val track: RoomP2PMediaTrackAdapter,
    val stream: RoomP2PMediaStreamAdapter,
    val deviceId: String?,
    val stopOnCleanup: Boolean,
)

private data class RoomP2PPendingRemoteTrack(
    val memberId: String,
    val track: RoomP2PMediaTrackAdapter,
    val stream: RoomP2PMediaStreamAdapter,
)

private data class RoomP2PPeerState(
    val memberId: String,
    val pc: RoomP2PPeerConnectionAdapter,
    val polite: Boolean,
    val senders: MutableMap<String, RoomP2PRtpSenderAdapter> = mutableMapOf(),
    val pendingCandidates: MutableList<RoomP2PIceCandidate> = mutableListOf(),
    var makingOffer: Boolean = false,
    var ignoreOffer: Boolean = false,
    var isSettingRemoteAnswerPending: Boolean = false,
)

internal class RoomP2PMediaTransport(
    private val room: RoomClient,
    private val options: RoomP2PMediaTransportOptions = RoomP2PMediaTransportOptions(),
) : RoomMediaTransport {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val localTracks = mutableMapOf<String, RoomP2PLocalTrackState>()
    private val peers = mutableMapOf<String, RoomP2PPeerState>()
    private val pendingPeers = mutableMapOf<String, CompletableDeferred<RoomP2PPeerState>>()
    private val remoteTrackHandlers = linkedMapOf<String, (RoomMediaRemoteTrackEvent) -> Unit>()
    private val remoteTrackKinds = mutableMapOf<String, String>()
    private val emittedRemoteTracks = mutableSetOf<String>()
    private val pendingRemoteTracks = mutableMapOf<String, RoomP2PPendingRemoteTrack>()
    private val subscriptions = mutableListOf<Subscription>()
    private var runtime: RoomP2PMediaRuntimeAdapter? = null
    private var localMemberId: String? = null
    private var connected = false

    private val offerEvent: String
        get() = "${options.signalPrefix}.offer"

    private val answerEvent: String
        get() = "${options.signalPrefix}.answer"

    private val iceEvent: String
        get() = "${options.signalPrefix}.ice"

    override suspend fun connect(payload: RoomMediaTransportConnectPayload): String {
        localMemberId?.takeIf { connected }?.let { return it }

        if (payload.containsKey("sessionDescription")) {
            throw IllegalArgumentException(
                "RoomP2PMediaTransport.connect() does not accept sessionDescription. Use room.signals through the built-in transport instead.",
            )
        }

        resolveRuntime()
        val currentMember = waitForCurrentMember()
            ?: throw IllegalStateException("Join the room before connecting a P2P media transport.")

        localMemberId = currentMember["memberId"] as? String
            ?: throw IllegalStateException("Current room member is missing memberId.")
        connected = true
        hydrateRemoteTrackKinds()
        attachRoomSubscriptions()

        room.members.list().forEach { member ->
            val memberId = member["memberId"] as? String
            if (memberId != null && memberId != localMemberId) {
                ensurePeer(memberId)
            }
        }

        return localMemberId!!
    }

    override suspend fun enableAudio(payload: Map<String, Any?>): Any? {
        val captured = captureUserMediaTrack(
            kind = "audio",
            deviceId = resolveTrackDeviceId(payload, "deviceId"),
        ) ?: throw IllegalStateException("P2P transport could not create a local audio track.")

        val providerSessionId = ensureConnectedMemberId()
        rememberLocalTrack("audio", captured)
        room.media.audio.enable(
            buildMap {
                putAll(payload)
                put("trackId", captured.track.id)
                captured.track.deviceId?.let { put("deviceId", it) }
                put("providerSessionId", providerSessionId)
            },
        )
        syncAllPeerSenders()
        return captured.track.asAny()
    }

    override suspend fun enableVideo(payload: Map<String, Any?>): Any? {
        val captured = captureUserMediaTrack(
            kind = "video",
            deviceId = resolveTrackDeviceId(payload, "deviceId"),
        ) ?: throw IllegalStateException("P2P transport could not create a local video track.")

        val providerSessionId = ensureConnectedMemberId()
        rememberLocalTrack("video", captured)
        room.media.video.enable(
            buildMap {
                putAll(payload)
                put("trackId", captured.track.id)
                captured.track.deviceId?.let { put("deviceId", it) }
                put("providerSessionId", providerSessionId)
            },
        )
        syncAllPeerSenders()
        return captured.stream.asAny()
    }

    override suspend fun startScreenShare(payload: Map<String, Any?>): Any? {
        val captured = resolveRuntime().captureDisplayMedia()
            ?: throw IllegalStateException("P2P transport could not create a screen-share track.")

        captured.track.onEnded {
            scope.launch {
                runCatching { stopScreenShare() }
            }
        }

        val providerSessionId = ensureConnectedMemberId()
        rememberLocalTrack("screen", captured)
        room.media.screen.start(
            buildMap {
                putAll(payload)
                put("trackId", captured.track.id)
                captured.track.deviceId?.let { put("deviceId", it) }
                put("providerSessionId", providerSessionId)
            },
        )
        syncAllPeerSenders()
        return captured.stream.asAny()
    }

    override suspend fun disableAudio() {
        releaseLocalTrack("audio")
        syncAllPeerSenders()
        room.media.audio.disable()
    }

    override suspend fun disableVideo() {
        releaseLocalTrack("video")
        syncAllPeerSenders()
        room.media.video.disable()
    }

    override suspend fun stopScreenShare() {
        releaseLocalTrack("screen")
        syncAllPeerSenders()
        room.media.screen.stop()
    }

    override suspend fun setMuted(kind: String, muted: Boolean) {
        localTracks[kind]?.track?.enabled = !muted

        when (kind) {
            "audio" -> room.media.audio.setMuted(muted)
            "video" -> room.media.video.setMuted(muted)
            else -> throw UnsupportedOperationException("Unsupported mute kind: $kind")
        }
    }

    override suspend fun switchDevices(payload: Map<String, Any?>) {
        val audioInputId = payload["audioInputId"] as? String
        val videoInputId = payload["videoInputId"] as? String

        if (!audioInputId.isNullOrBlank() && localTracks.containsKey("audio")) {
            captureUserMediaTrack("audio", audioInputId)?.let { rememberLocalTrack("audio", it) }
        }
        if (!videoInputId.isNullOrBlank() && localTracks.containsKey("video")) {
            captureUserMediaTrack("video", videoInputId)?.let { rememberLocalTrack("video", it) }
        }

        syncAllPeerSenders()
        room.media.devices.switch(payload)
    }

    override fun onRemoteTrack(handler: (RoomMediaRemoteTrackEvent) -> Unit): Subscription {
        val key = platformUuid()
        remoteTrackHandlers[key] = handler
        return Subscription {
            remoteTrackHandlers.remove(key)
        }
    }

    override fun getSessionId(): String? = localMemberId

    override fun getPeerConnection(): Any? {
        return peers.values.singleOrNull()?.pc?.asAny()
    }

    override fun destroy() {
        connected = false
        localMemberId = null
        subscriptions.toList().forEach { it.unsubscribe() }
        subscriptions.clear()
        pendingPeers.values.forEach { it.cancel() }
        pendingPeers.clear()
        peers.values.toList().forEach(::destroyPeer)
        peers.clear()
        localTracks.keys.toList().forEach { kind ->
            releaseLocalTrack(kind)
        }
        remoteTrackKinds.clear()
        emittedRemoteTracks.clear()
        pendingRemoteTracks.clear()
        runtime?.destroy()
        runtime = null
        scope.cancel()
    }

    private fun attachRoomSubscriptions() {
        if (subscriptions.isNotEmpty()) return

        subscriptions += room.members.onJoin { member ->
            val memberId = member["memberId"] as? String
            if (memberId != null && memberId != localMemberId) {
                scope.launch { ensurePeer(memberId) }
            }
        }
        subscriptions += room.members.onSync { members ->
            members.forEach { member ->
                val memberId = member["memberId"] as? String
                if (memberId != null && memberId != localMemberId) {
                    scope.launch { ensurePeer(memberId) }
                }
            }
        }
        subscriptions += room.members.onLeave { member, _ ->
            val memberId = member["memberId"] as? String ?: return@onLeave
            remoteTrackKinds.keys.filter { it.startsWith("$memberId:") }.forEach(remoteTrackKinds::remove)
            emittedRemoteTracks.removeAll { it.startsWith("$memberId:") }
            pendingRemoteTracks.keys.filter { it.startsWith("$memberId:") }.forEach(pendingRemoteTracks::remove)
            closePeer(memberId)
        }
        subscriptions += room.signals.on(offerEvent) { payload, meta ->
            scope.launch { handleDescriptionSignal("offer", payload, meta) }
        }
        subscriptions += room.signals.on(answerEvent) { payload, meta ->
            scope.launch { handleDescriptionSignal("answer", payload, meta) }
        }
        subscriptions += room.signals.on(iceEvent) { payload, meta ->
            scope.launch { handleIceSignal(payload, meta) }
        }
        subscriptions += room.media.onTrack { track, member ->
            val memberId = member["memberId"] as? String
            if (memberId != null && memberId != localMemberId) {
                scope.launch { ensurePeer(memberId) }
            }
            rememberRemoteTrackKind(track, member)
        }
        subscriptions += room.media.onTrackRemoved { track, member ->
            val memberId = member["memberId"] as? String ?: return@onTrackRemoved
            val trackId = track["trackId"] as? String ?: return@onTrackRemoved
            val key = buildTrackKey(memberId, trackId)
            remoteTrackKinds.remove(key)
            emittedRemoteTracks.remove(key)
            pendingRemoteTracks.remove(key)
        }
    }

    private suspend fun waitForCurrentMember(): Map<String, Any?>? {
        val timeoutMs = options.currentMemberTimeoutMs.coerceAtLeast(0L)
        var waitedMs = 0L
        while (waitedMs < timeoutMs) {
            currentMember()?.let { return it }
            delay(50L)
            waitedMs += 50L
        }
        return currentMember()
    }

    private fun currentMember(): Map<String, Any?>? {
        val userId = room.session.userId ?: return null
        val connectionId = room.session.connectionId
        return room.members.list().firstOrNull { member ->
            val memberUserId = member["userId"] as? String
            val memberConnectionId = member["connectionId"] as? String
            memberUserId == userId && (connectionId == null || memberConnectionId == connectionId)
        }
    }

    private suspend fun ensurePeer(memberId: String): RoomP2PPeerState {
        peers[memberId]?.let {
            syncPeerSenders(it)
            return it
        }

        pendingPeers[memberId]?.let { return it.await() }

        val deferred = CompletableDeferred<RoomP2PPeerState>()
        pendingPeers[memberId] = deferred
        scope.async {
            try {
                val peerConnection = resolveRuntime().createPeerConnection(options.rtcConfiguration)
                val peer = RoomP2PPeerState(
                    memberId = memberId,
                    pc = peerConnection,
                    polite = (localMemberId?.compareTo(memberId) ?: 0) > 0,
                )

                peerConnection.setIceCandidateHandler { candidate ->
                    if (candidate.candidate.isBlank()) return@setIceCandidateHandler
                    room.signals.sendTo(
                        memberId,
                        iceEvent,
                        mapOf(
                            "candidate" to mapOf(
                                "candidate" to candidate.candidate,
                                "sdpMid" to candidate.sdpMid,
                                "sdpMLineIndex" to candidate.sdpMLineIndex,
                            ),
                        ),
                    )
                }

                peerConnection.setNegotiationNeededHandler {
                    negotiatePeer(peer)
                }

                peerConnection.setTrackHandler { payload ->
                    val key = buildTrackKey(memberId, payload.track.id)
                    val exactKind = remoteTrackKinds[key]
                    val fallbackKind = if (exactKind == null) {
                        resolveFallbackRemoteTrackKind(memberId, payload.track)
                    } else {
                        null
                    }
                    val kind = exactKind ?: fallbackKind ?: normalizeTrackKind(payload.track.kind)
                    if (
                        kind == null ||
                        (exactKind == null && fallbackKind == null && kind == "video" && payload.track.kind == "video")
                    ) {
                        pendingRemoteTracks[key] = RoomP2PPendingRemoteTrack(
                            memberId = memberId,
                            track = payload.track,
                            stream = payload.stream,
                        )
                        return@setTrackHandler
                    }

                    emitRemoteTrack(memberId, payload.track, payload.stream, kind)
                }

                peers[memberId] = peer
                pendingPeers.remove(memberId)
                syncPeerSenders(peer)
                deferred.complete(peer)
            } catch (error: Throwable) {
                pendingPeers.remove(memberId)
                deferred.completeExceptionally(error)
            }
        }
        return deferred.await()
    }

    private suspend fun negotiatePeer(peer: RoomP2PPeerState) {
        if (
            !connected ||
            peer.pc.connectionState == "closed" ||
            peer.makingOffer ||
            peer.isSettingRemoteAnswerPending ||
            peer.pc.signalingState != "stable"
        ) {
            return
        }

        try {
            peer.makingOffer = true
            val offer = peer.pc.createOffer()
            peer.pc.setLocalDescription(offer)
            room.signals.sendTo(
                peer.memberId,
                offerEvent,
                mapOf(
                    "description" to mapOf(
                        "type" to offer.type,
                        "sdp" to offer.sdp,
                    ),
                ),
            )
        } finally {
            peer.makingOffer = false
        }
    }

    private suspend fun handleDescriptionSignal(
        expectedType: String,
        payload: Any?,
        meta: Map<String, Any?>,
    ) {
        val senderId = (meta["memberId"] as? String)?.trim().orEmpty()
        if (senderId.isBlank() || senderId == localMemberId) return

        val description = normalizeDescription(payload) ?: return
        if (description.type != expectedType) return

        val peer = ensurePeer(senderId)
        val readyForOffer = !peer.makingOffer &&
            (peer.pc.signalingState == "stable" || peer.isSettingRemoteAnswerPending)
        val offerCollision = description.type == "offer" && !readyForOffer
        peer.ignoreOffer = !peer.polite && offerCollision
        if (peer.ignoreOffer) return

        try {
            peer.isSettingRemoteAnswerPending = description.type == "answer"
            peer.pc.setRemoteDescription(description)
            peer.isSettingRemoteAnswerPending = false
            flushPendingCandidates(peer)

            if (description.type == "offer") {
                syncPeerSenders(peer)
                val answer = peer.pc.createAnswer()
                peer.pc.setLocalDescription(answer)
                room.signals.sendTo(
                    senderId,
                    answerEvent,
                    mapOf(
                        "description" to mapOf(
                            "type" to answer.type,
                            "sdp" to answer.sdp,
                        ),
                    ),
                )
            }
        } catch (error: Throwable) {
            peer.isSettingRemoteAnswerPending = false
            throw error
        }
    }

    private suspend fun handleIceSignal(payload: Any?, meta: Map<String, Any?>) {
        val senderId = (meta["memberId"] as? String)?.trim().orEmpty()
        if (senderId.isBlank() || senderId == localMemberId) return

        val candidate = normalizeIceCandidate(payload) ?: return
        val peer = ensurePeer(senderId)
        if (peer.pc.remoteDescription == null) {
            peer.pendingCandidates += candidate
            return
        }

        val added = runCatching { peer.pc.addIceCandidate(candidate) }.getOrDefault(false)
        if (!added && !peer.ignoreOffer) {
            peer.pendingCandidates += candidate
        }
    }

    private suspend fun flushPendingCandidates(peer: RoomP2PPeerState) {
        if (peer.pc.remoteDescription == null || peer.pendingCandidates.isEmpty()) return

        val pending = peer.pendingCandidates.toList()
        peer.pendingCandidates.clear()
        pending.forEach { candidate ->
            val added = runCatching { peer.pc.addIceCandidate(candidate) }.getOrDefault(false)
            if (!added && !peer.ignoreOffer) {
                peer.pendingCandidates += candidate
            }
        }
    }

    private suspend fun syncAllPeerSenders() {
        peers.values.toList().forEach { peer ->
            syncPeerSenders(peer)
        }
    }

    private suspend fun syncPeerSenders(peer: RoomP2PPeerState) {
        val activeKinds = mutableSetOf<String>()
        var changed = false

        localTracks.forEach { (kind, localTrack) ->
            activeKinds += kind
            val sender = peer.senders[kind]
            if (sender != null) {
                if (sender.track?.id != localTrack.track.id) {
                    sender.replaceTrack(localTrack.track)
                    changed = true
                }
            } else {
                peer.senders[kind] = peer.pc.addTrack(localTrack.track, localTrack.stream)
                changed = true
            }
        }

        peer.senders.entries.toList().forEach { (kind, sender) ->
            if (activeKinds.contains(kind)) return@forEach
            runCatching { peer.pc.removeTrack(sender) }
            peer.senders.remove(kind)
            changed = true
        }

        if (changed) {
            scope.launch { negotiatePeer(peer) }
        }
    }

    private fun hydrateRemoteTrackKinds() {
        remoteTrackKinds.clear()
        emittedRemoteTracks.clear()
        pendingRemoteTracks.clear()

        room.media.list().forEach { mediaMember ->
            val member = mediaMember["member"] as? Map<String, Any?> ?: emptyMap()
            val tracks = mediaMember["tracks"] as? List<*> ?: emptyList<Any?>()
            tracks.filterIsInstance<Map<String, Any?>>().forEach { track ->
                rememberRemoteTrackKind(track, member)
            }
        }
    }

    private fun rememberRemoteTrackKind(track: Map<String, Any?>, member: Map<String, Any?>) {
        val trackId = track["trackId"] as? String ?: return
        val memberId = member["memberId"] as? String ?: return
        val kind = track["kind"] as? String ?: return
        if (memberId == localMemberId) return

        val key = buildTrackKey(memberId, trackId)
        remoteTrackKinds[key] = kind
        pendingRemoteTracks.remove(key)?.let { pending ->
            emitRemoteTrack(memberId, pending.track, pending.stream, kind)
            return
        }
        flushPendingRemoteTracks(memberId, kind)
    }

    private fun emitRemoteTrack(
        memberId: String,
        track: RoomP2PMediaTrackAdapter,
        stream: RoomP2PMediaStreamAdapter,
        kind: String,
    ) {
        val key = buildTrackKey(memberId, track.id)
        if (!emittedRemoteTracks.add(key)) return

        val participant = room.members.list().firstOrNull { it["memberId"] == memberId }
        val event = RoomMediaRemoteTrackEvent(
            kind = kind,
            track = track.asAny(),
            view = stream.asAny(),
            trackName = track.id,
            providerSessionId = memberId,
            participantId = memberId,
            customParticipantId = participant?.get("customParticipantId") as? String,
            userId = participant?.get("userId") as? String,
            participant = participant ?: mapOf("memberId" to memberId),
        )
        remoteTrackHandlers.values.toList().forEach { handler ->
            handler(event)
        }
    }

    private fun resolveFallbackRemoteTrackKind(
        memberId: String,
        track: RoomP2PMediaTrackAdapter,
    ): String? {
        val normalizedKind = normalizeTrackKind(track.kind) ?: return null
        if (normalizedKind == "audio") return normalizedKind

        val videoLikeKinds = getPublishedVideoLikeKinds(memberId)
        if (videoLikeKinds.size != 1) return null
        return videoLikeKinds.firstOrNull()
    }

    private fun flushPendingRemoteTracks(memberId: String, roomKind: String) {
        val expectedTrackKind = if (roomKind == "audio") "audio" else "video"
        if ((roomKind == "video" || roomKind == "screen") && getPublishedVideoLikeKinds(memberId).size != 1) {
            return
        }

        pendingRemoteTracks.entries.firstOrNull { (_, pending) ->
            pending.memberId == memberId && pending.track.kind == expectedTrackKind
        }?.let { (key, pending) ->
            pendingRemoteTracks.remove(key)
            emitRemoteTrack(memberId, pending.track, pending.stream, roomKind)
        }
    }

    private fun getPublishedVideoLikeKinds(memberId: String): List<String> {
        val mediaMember = room.media.list().firstOrNull { entry ->
            val member = entry["member"] as? Map<String, Any?>
            member?.get("memberId") == memberId
        } ?: return emptyList()

        val kinds = linkedSetOf<String>()
        val tracks = mediaMember["tracks"] as? List<*> ?: emptyList<Any?>()
        tracks.filterIsInstance<Map<String, Any?>>().forEach { track ->
            val kind = track["kind"] as? String
            if ((kind == "video" || kind == "screen") && track["trackId"] != null) {
                kinds += kind
            }
        }
        return kinds.toList()
    }

    private fun rememberLocalTrack(kind: String, captured: RoomP2PCapturedTrack) {
        releaseLocalTrack(kind)
        localTracks[kind] = RoomP2PLocalTrackState(
            kind = kind,
            track = captured.track,
            stream = captured.stream,
            deviceId = captured.track.deviceId,
            stopOnCleanup = captured.stopOnCleanup,
        )
    }

    private fun releaseLocalTrack(kind: String) {
        val localTrack = localTracks.remove(kind) ?: return
        localTrack.track.onEnded(null)
        if (localTrack.stopOnCleanup) {
            runCatching { localTrack.track.stop() }
        }
        runCatching { localTrack.stream.release() }
        localTrack.track.dispose()
    }

    private suspend fun captureUserMediaTrack(kind: String, deviceId: String?): RoomP2PCapturedTrack? {
        return resolveRuntime().captureUserMedia(kind, deviceId)
    }

    private suspend fun ensureConnectedMemberId(): String {
        return localMemberId ?: connect()
    }

    private fun closePeer(memberId: String) {
        pendingPeers.remove(memberId)?.cancel()
        peers.remove(memberId)?.let(::destroyPeer)
    }

    private fun destroyPeer(peer: RoomP2PPeerState) {
        peer.pc.setIceCandidateHandler(null)
        peer.pc.setNegotiationNeededHandler(null)
        peer.pc.setTrackHandler(null)
        runCatching { peer.pc.close() }
    }

    private fun resolveRuntime(): RoomP2PMediaRuntimeAdapter {
        runtime?.let { return it }
        val factory = roomP2PMediaRuntimeFactoryOverride ?: defaultP2PMediaRuntimeFactory()
            ?: throw UnsupportedOperationException(
                "P2P room media requires the edgebase-kotlin Android runtime. See $ROOM_P2P_DOCS_URL",
            )
        return factory.create().also { runtime = it }
    }

    private fun resolveTrackDeviceId(payload: Map<String, Any?>, key: String): String? {
        return (payload[key] as? String)?.takeIf { it.isNotBlank() }
    }

    private fun normalizeDescription(payload: Any?): RoomP2PSessionDescription? {
        val map = payload as? Map<*, *> ?: return null
        val description = map["description"] as? Map<*, *> ?: return null
        val type = (description["type"] as? String)?.lowercase() ?: return null
        val sdp = description["sdp"] as? String ?: return null
        if (type !in setOf("offer", "answer", "pranswer", "rollback")) return null
        return RoomP2PSessionDescription(type = type, sdp = sdp)
    }

    private fun normalizeIceCandidate(payload: Any?): RoomP2PIceCandidate? {
        val map = payload as? Map<*, *> ?: return null
        val candidate = map["candidate"] as? Map<*, *> ?: return null
        val candidateValue = candidate["candidate"] as? String ?: return null
        val sdpMid = candidate["sdpMid"] as? String
        val sdpMLineIndex = (candidate["sdpMLineIndex"] as? Number)?.toInt() ?: 0
        return RoomP2PIceCandidate(
            candidate = candidateValue,
            sdpMid = sdpMid,
            sdpMLineIndex = sdpMLineIndex,
        )
    }

    private fun normalizeTrackKind(kind: String): String? {
        return when (kind.lowercase()) {
            "audio" -> "audio"
            "video" -> "video"
            else -> null
        }
    }

    private fun buildTrackKey(memberId: String, trackId: String): String = "$memberId:$trackId"
}
