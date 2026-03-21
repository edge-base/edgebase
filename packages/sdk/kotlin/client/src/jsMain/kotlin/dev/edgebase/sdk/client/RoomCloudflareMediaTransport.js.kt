@file:Suppress("UnsafeCastFromDynamic", "unused")

package dev.edgebase.sdk.client

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.await
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlin.js.Promise
import kotlin.js.jsTypeOf
import kotlin.js.json
import kotlin.js.unsafeCast

private var realtimeKitModulePromise: Promise<dynamic>? = null

internal actual fun defaultCloudflareRealtimeKitClientFactory(): RoomCloudflareRealtimeKitClientFactory? {
    return RoomCloudflareRealtimeKitClientFactory { options ->
        val module = loadRealtimeKitModule().await()
        val factory = module.default ?: module
        val defaults = jsObject()
        defaults.audio = options.enableAudio
        defaults.video = options.enableVideo
        val initOptions = jsObject()
        initOptions.authToken = options.authToken
        initOptions.defaults = defaults
        initOptions.baseDomain = options.baseDomain

        val meeting = factory.init(initOptions).unsafeCast<Promise<dynamic>>().await()
        JsRoomCloudflareRealtimeKitClientAdapter(meeting)
    }
}

internal actual fun defaultP2PMediaRuntimeFactory(): RoomP2PMediaRuntimeFactory? {
    return RoomP2PMediaRuntimeFactory {
        JsRoomP2PMediaRuntimeAdapter()
    }
}

private fun loadRealtimeKitModule(): Promise<dynamic> {
    realtimeKitModulePromise?.let { return it }
    val promise = js("import('@cloudflare/realtimekit')").unsafeCast<Promise<dynamic>>()
    realtimeKitModulePromise = promise
    return promise
}

private class JsRoomCloudflareRealtimeKitClientAdapter(
    private val meeting: dynamic,
) : RoomCloudflareRealtimeKitClientAdapter {
    private val listeners = linkedMapOf<Int, RoomCloudflareParticipantListener>()
    private val participantListeners = linkedMapOf<String, JsParticipantListenerSet>()
    private var participantMapHandlersAttached = false

    private val onParticipantJoined: (dynamic) -> Unit = { participant ->
        attachParticipant(participant)
        val snapshot = snapshotFromMeetingParticipant(participant)
        listeners.values.toList().forEach { it.onParticipantJoin(snapshot) }
    }

    private val onParticipantLeft: (dynamic) -> Unit = { participant ->
        val snapshot = snapshotFromMeetingParticipant(participant)
        detachParticipant(dynamicString(participant.id) ?: snapshot.id)
        listeners.values.toList().forEach { it.onParticipantLeave(snapshot) }
    }

    private val onParticipantsCleared: () -> Unit = {
        clearParticipantListeners()
        listeners.values.toList().forEach { it.onParticipantsSync(emptyList()) }
    }

    private val onParticipantsUpdate: () -> Unit = {
        syncAllParticipants()
    }

    override suspend fun joinRoom() {
        if (hasFunction(meeting, "join")) {
            meeting.join().unsafeCast<Promise<dynamic>>().await()
        } else if (hasFunction(meeting, "joinRoom")) {
            meeting.joinRoom().unsafeCast<Promise<dynamic>>().await()
        } else {
            error("RealtimeKit browser client does not expose join()/joinRoom().")
        }
        attachParticipantMapListeners()
        listeners.values.toList().forEach { it.onParticipantsSync(joinedParticipants) }
    }

    override suspend fun leaveRoom() {
        detachParticipantMapListeners()
        clearParticipantListeners()
        if (hasFunction(meeting, "leave")) {
            meeting.leave().unsafeCast<Promise<dynamic>>().await()
        } else if (hasFunction(meeting, "leaveRoom")) {
            meeting.leaveRoom().unsafeCast<Promise<dynamic>>().await()
        }
    }

    override suspend fun enableAudio() {
        meeting.self.enableAudio().unsafeCast<Promise<dynamic>>().await()
    }

    override suspend fun disableAudio() {
        meeting.self.disableAudio().unsafeCast<Promise<dynamic>>().await()
    }

    override suspend fun enableVideo() {
        meeting.self.enableVideo().unsafeCast<Promise<dynamic>>().await()
    }

    override suspend fun disableVideo() {
        meeting.self.disableVideo().unsafeCast<Promise<dynamic>>().await()
    }

    override suspend fun enableScreenShare() {
        meeting.self.enableScreenShare().unsafeCast<Promise<dynamic>>().await()
    }

    override suspend fun disableScreenShare() {
        meeting.self.disableScreenShare().unsafeCast<Promise<dynamic>>().await()
    }

    override suspend fun setAudioDevice(deviceId: String) {
        val device = meeting.self.getDeviceById(deviceId, "audio").unsafeCast<Promise<dynamic>>().await()
        meeting.self.setDevice(device).unsafeCast<Promise<dynamic>>().await()
    }

    override suspend fun setVideoDevice(deviceId: String) {
        val device = meeting.self.getDeviceById(deviceId, "video").unsafeCast<Promise<dynamic>>().await()
        meeting.self.setDevice(device).unsafeCast<Promise<dynamic>>().await()
    }

    override val localParticipant: RoomCloudflareParticipantSnapshot
        get() = snapshotFromMeetingParticipant(meeting.self)

    override val joinedParticipants: List<RoomCloudflareParticipantSnapshot>
        get() = participantMapValues(participantMap()).map(::snapshotFromMeetingParticipant)

    override fun buildView(
        participant: RoomCloudflareParticipantSnapshot,
        kind: String,
        isSelf: Boolean,
    ): Any? {
        val handle = participant.participantHandle ?: return null
        val track = when (kind) {
            "video" -> if (isSelf) meeting.self.videoTrack else handle.unsafeCast<dynamic>().videoTrack
            "screen" -> if (isSelf) meeting.self.screenShareTracks?.video else handle.unsafeCast<dynamic>().screenShareTracks?.video
            else -> null
        } ?: return null

        return buildSingleTrackMediaStream(track)
    }

    override fun addListener(listener: RoomCloudflareParticipantListener) {
        listeners[listener.hashCode()] = listener
        if (participantMapHandlersAttached) {
            listener.onParticipantsSync(joinedParticipants)
        }
    }

    override fun removeListener(listener: RoomCloudflareParticipantListener) {
        listeners.remove(listener.hashCode())
    }

    private fun attachParticipantMapListeners() {
        if (participantMapHandlersAttached) return
        val map = participantMap() ?: return
        if (!hasFunction(map, "on")) return
        map.on("participantJoined", onParticipantJoined)
        map.on("participantLeft", onParticipantLeft)
        map.on("participantsCleared", onParticipantsCleared)
        map.on("participantsUpdate", onParticipantsUpdate)
        participantMapHandlersAttached = true
        syncAllParticipants()
    }

    private fun detachParticipantMapListeners() {
        if (!participantMapHandlersAttached) return
        val map = participantMap() ?: return
        if (!hasFunction(map, "off")) return
        map.off("participantJoined", onParticipantJoined)
        map.off("participantLeft", onParticipantLeft)
        map.off("participantsCleared", onParticipantsCleared)
        map.off("participantsUpdate", onParticipantsUpdate)
        participantMapHandlersAttached = false
    }

    private fun participantMap(): dynamic {
        val participants = meeting.participants ?: return null
        return participants.active ?: participants.joined
    }

    private fun syncAllParticipants() {
        participantMapValues(participantMap()).forEach(::attachParticipant)
        val snapshots = joinedParticipants
        listeners.values.toList().forEach { it.onParticipantsSync(snapshots) }
    }

    private fun attachParticipant(participant: dynamic) {
        val participantId = dynamicString(participant.id) ?: return
        if (participantId == dynamicString(meeting.self.id)) return

        participantListeners[participantId]?.let {
            syncParticipantTracks(participant)
            return
        }

        val listenerSet = JsParticipantListenerSet(
            participant = participant,
            onAudioUpdate = { payload ->
                val enabled = dynamicBoolean(payload?.audioEnabled, dynamicBoolean(participant.audioEnabled, false))
                val snapshot = snapshotFromMeetingParticipant(participant, audioEnabled = enabled)
                listeners.values.toList().forEach { it.onAudioUpdate(snapshot, enabled) }
            },
            onVideoUpdate = { payload ->
                val enabled = dynamicBoolean(payload?.videoEnabled, dynamicBoolean(participant.videoEnabled, false))
                val snapshot = snapshotFromMeetingParticipant(participant, videoEnabled = enabled)
                listeners.values.toList().forEach { it.onVideoUpdate(snapshot, enabled) }
            },
            onScreenShareUpdate = { payload ->
                val enabled = dynamicBoolean(payload?.screenShareEnabled, dynamicBoolean(participant.screenShareEnabled, false))
                val snapshot = snapshotFromMeetingParticipant(participant, screenShareEnabled = enabled)
                listeners.values.toList().forEach { it.onScreenShareUpdate(snapshot, enabled) }
            },
        )

        participant.on("audioUpdate", listenerSet.onAudioUpdate)
        participant.on("videoUpdate", listenerSet.onVideoUpdate)
        participant.on("screenShareUpdate", listenerSet.onScreenShareUpdate)
        participantListeners[participantId] = listenerSet
        syncParticipantTracks(participant)
    }

    private fun detachParticipant(participantId: String) {
        val listenerSet = participantListeners.remove(participantId) ?: return
        listenerSet.participant.off("audioUpdate", listenerSet.onAudioUpdate)
        listenerSet.participant.off("videoUpdate", listenerSet.onVideoUpdate)
        listenerSet.participant.off("screenShareUpdate", listenerSet.onScreenShareUpdate)
    }

    private fun clearParticipantListeners() {
        participantListeners.keys.toList().forEach(::detachParticipant)
    }

    private fun syncParticipantTracks(participant: dynamic) {
        val audioEnabled = dynamicBoolean(participant.audioEnabled, false)
        val videoEnabled = dynamicBoolean(participant.videoEnabled, false)
        val screenShareEnabled = dynamicBoolean(participant.screenShareEnabled, false)
        val baseSnapshot = snapshotFromMeetingParticipant(
            participant,
            audioEnabled = audioEnabled,
            videoEnabled = videoEnabled,
            screenShareEnabled = screenShareEnabled,
        )
        listeners.values.toList().forEach { listener ->
            listener.onAudioUpdate(baseSnapshot, audioEnabled)
            listener.onVideoUpdate(baseSnapshot, videoEnabled)
            listener.onScreenShareUpdate(baseSnapshot, screenShareEnabled)
        }
    }

    private fun snapshotFromMeetingParticipant(
        participant: dynamic,
        audioEnabled: Boolean? = null,
        videoEnabled: Boolean? = null,
        screenShareEnabled: Boolean? = null,
    ): RoomCloudflareParticipantSnapshot {
        return RoomCloudflareParticipantSnapshot(
            id = dynamicString(participant.id) ?: "",
            userId = dynamicString(participant.userId) ?: dynamicString(participant.id) ?: "",
            name = dynamicString(participant.name) ?: dynamicString(participant.userId) ?: dynamicString(participant.id) ?: "participant",
            picture = dynamicString(participant.picture),
            customParticipantId = dynamicString(participant.customParticipantId),
            audioEnabled = audioEnabled ?: dynamicBoolean(participant.audioEnabled, false),
            videoEnabled = videoEnabled ?: dynamicBoolean(participant.videoEnabled, false),
            screenShareEnabled = screenShareEnabled ?: dynamicBoolean(participant.screenShareEnabled, false),
            participantHandle = participant,
        )
    }
}

private data class JsParticipantListenerSet(
    val participant: dynamic,
    val onAudioUpdate: (dynamic) -> Unit,
    val onVideoUpdate: (dynamic) -> Unit,
    val onScreenShareUpdate: (dynamic) -> Unit,
)

private class JsRoomP2PMediaRuntimeAdapter : RoomP2PMediaRuntimeAdapter {
    override suspend fun createPeerConnection(
        configuration: RoomP2PRtcConfigurationOptions,
    ): RoomP2PPeerConnectionAdapter {
        val iceServers = configuration.iceServers.map { iceServer ->
            val next = jsObject()
            next.urls = iceServer.urls.toTypedArray()
            iceServer.username?.let { next.username = it }
            iceServer.credential?.let { next.credential = it }
            next
        }.toTypedArray()

        val rtcConfiguration = jsObject()
        rtcConfiguration.iceServers = iceServers

        return JsRoomP2PPeerConnectionAdapter(BrowserRTCPeerConnection(rtcConfiguration))
    }

    override suspend fun captureUserMedia(
        kind: String,
        deviceId: String?,
    ): RoomP2PCapturedTrack? {
        val mediaDevices = globalMediaDevices() ?: return null
        if (jsTypeOf(mediaDevices.getUserMedia) != "function") return null

        val constraints = jsObject()
        when (kind) {
            "audio" -> {
                constraints.audio = deviceId?.let(::exactDeviceConstraint) ?: true
                constraints.video = false
            }
            "video" -> {
                constraints.audio = false
                constraints.video = deviceId?.let(::exactDeviceConstraint) ?: true
            }
            else -> {
                constraints.audio = false
                constraints.video = false
            }
        }

        val stream = mediaDevices.getUserMedia(constraints).unsafeCast<Promise<dynamic>>().await()
        val track = firstTrack(stream, kind) ?: run {
            releaseMediaStream(stream)
            return null
        }

        return RoomP2PCapturedTrack(
            kind = kind,
            track = JsRoomP2PMediaTrackAdapter(track),
            stream = JsRoomP2PMediaStreamAdapter(stream),
            stopOnCleanup = true,
        )
    }

    override suspend fun captureDisplayMedia(): RoomP2PCapturedTrack? {
        val mediaDevices = globalMediaDevices() ?: return null
        if (jsTypeOf(mediaDevices.getDisplayMedia) != "function") return null

        val constraints = jsObject()
        constraints.video = true
        constraints.audio = false
        val stream = mediaDevices.getDisplayMedia(constraints).unsafeCast<Promise<dynamic>>().await()
        val track = firstTrack(stream, "video") ?: run {
            releaseMediaStream(stream)
            return null
        }

        return RoomP2PCapturedTrack(
            kind = "screen",
            track = JsRoomP2PMediaTrackAdapter(track),
            stream = JsRoomP2PMediaStreamAdapter(stream),
            stopOnCleanup = true,
        )
    }
}

private class JsRoomP2PPeerConnectionAdapter(
    private val peerConnection: BrowserRTCPeerConnection,
) : RoomP2PPeerConnectionAdapter {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var iceCandidateHandler: (suspend (RoomP2PIceCandidate) -> Unit)? = null
    private var negotiationNeededHandler: (suspend () -> Unit)? = null
    private var trackHandler: (suspend (RoomP2PRemoteTrackPayload) -> Unit)? = null

    init {
        peerConnection.onicecandidate = { event ->
            val candidate = event?.candidate
            if (candidate != null) {
                scope.launch {
                    val candidateValue = dynamicString(candidate.candidate) ?: return@launch
                    iceCandidateHandler?.invoke(
                        RoomP2PIceCandidate(
                            candidate = candidateValue,
                            sdpMid = dynamicString(candidate.sdpMid),
                            sdpMLineIndex = dynamicInt(candidate.sdpMLineIndex),
                        ),
                    )
                }
            }
        }
        peerConnection.onnegotiationneeded = {
            scope.launch {
                negotiationNeededHandler?.invoke()
            }
        }
        peerConnection.ontrack = { event ->
            val track = event?.track
            if (track != null) {
                val stream = event.streams?.unsafeCast<Array<dynamic>>()?.firstOrNull()
                    ?: buildSingleTrackMediaStream(track)
                scope.launch {
                    trackHandler?.invoke(
                        RoomP2PRemoteTrackPayload(
                            track = JsRoomP2PMediaTrackAdapter(track),
                            stream = JsRoomP2PMediaStreamAdapter(stream),
                        ),
                    )
                }
            }
        }
    }

    override val connectionState: String
        get() = peerConnection.connectionState

    override val signalingState: String
        get() = peerConnection.signalingState

    override val localDescription: RoomP2PSessionDescription?
        get() = peerConnection.localDescription?.let(::sessionDescriptionFromJs)

    override val remoteDescription: RoomP2PSessionDescription?
        get() = peerConnection.remoteDescription?.let(::sessionDescriptionFromJs)

    override fun setIceCandidateHandler(handler: (suspend (RoomP2PIceCandidate) -> Unit)?) {
        iceCandidateHandler = handler
    }

    override fun setNegotiationNeededHandler(handler: (suspend () -> Unit)?) {
        negotiationNeededHandler = handler
    }

    override fun setTrackHandler(handler: (suspend (RoomP2PRemoteTrackPayload) -> Unit)?) {
        trackHandler = handler
    }

    override suspend fun createOffer(): RoomP2PSessionDescription {
        val description = peerConnection.createOffer().unsafeCast<Promise<dynamic>>().await()
        return sessionDescriptionFromJs(description)
    }

    override suspend fun createAnswer(): RoomP2PSessionDescription {
        val description = peerConnection.createAnswer().unsafeCast<Promise<dynamic>>().await()
        return sessionDescriptionFromJs(description)
    }

    override suspend fun setLocalDescription(description: RoomP2PSessionDescription) {
        peerConnection.setLocalDescription(sessionDescriptionToJs(description)).unsafeCast<Promise<dynamic>>().await()
    }

    override suspend fun setRemoteDescription(description: RoomP2PSessionDescription) {
        peerConnection.setRemoteDescription(sessionDescriptionToJs(description)).unsafeCast<Promise<dynamic>>().await()
    }

    override suspend fun addIceCandidate(candidate: RoomP2PIceCandidate): Boolean {
        return runCatching {
            peerConnection.addIceCandidate(iceCandidateToJs(candidate)).unsafeCast<Promise<dynamic>>().await()
            true
        }.getOrDefault(false)
    }

    override fun addTrack(
        track: RoomP2PMediaTrackAdapter,
        stream: RoomP2PMediaStreamAdapter,
    ): RoomP2PRtpSenderAdapter {
        val sender = peerConnection.addTrack(
            (track as JsRoomP2PMediaTrackAdapter).track,
            (stream as JsRoomP2PMediaStreamAdapter).stream,
        )
        return JsRoomP2PRtpSenderAdapter(sender)
    }

    override fun removeTrack(sender: RoomP2PRtpSenderAdapter): Boolean {
        peerConnection.removeTrack((sender as JsRoomP2PRtpSenderAdapter).sender)
        return true
    }

    override fun close() {
        scope.cancel()
        peerConnection.onicecandidate = null
        peerConnection.onnegotiationneeded = null
        peerConnection.ontrack = null
        peerConnection.close()
    }

    override fun asAny(): Any? = peerConnection
}

private class JsRoomP2PRtpSenderAdapter(
    internal val sender: dynamic,
) : RoomP2PRtpSenderAdapter {
    override val track: RoomP2PMediaTrackAdapter?
        get() = sender.track?.let(::JsRoomP2PMediaTrackAdapter)

    override suspend fun replaceTrack(track: RoomP2PMediaTrackAdapter) {
        sender.replaceTrack((track as JsRoomP2PMediaTrackAdapter).track).unsafeCast<Promise<dynamic>>().await()
    }
}

private class JsRoomP2PMediaStreamAdapter(
    internal val stream: dynamic,
) : RoomP2PMediaStreamAdapter {
    override fun release() {
        releaseMediaStream(stream)
    }

    override fun asAny(): Any? = stream
}

private class JsRoomP2PMediaTrackAdapter(
    internal val track: dynamic,
) : RoomP2PMediaTrackAdapter {
    private var endedHandler: (() -> Unit)? = null
    private var endedListener: ((dynamic) -> Unit)? = null

    override val id: String
        get() = dynamicString(track.id) ?: ""

    override val kind: String
        get() = dynamicString(track.kind) ?: "video"

    override val deviceId: String?
        get() = dynamicString(track.getSettings?.invoke()?.deviceId)

    override var enabled: Boolean
        get() = dynamicBoolean(track.enabled, true)
        set(value) {
            track.enabled = value
        }

    override fun stop() {
        track.stop()
    }

    override fun onEnded(handler: (() -> Unit)?) {
        endedHandler = handler
        if (endedListener == null && handler != null) {
            val listener: (dynamic) -> Unit = {
                endedHandler?.invoke()
            }
            endedListener = listener
            if (hasFunction(track, "addEventListener")) {
                track.addEventListener("ended", listener)
            }
        }
    }

    override fun dispose() {
        val listener = endedListener ?: return
        if (hasFunction(track, "removeEventListener")) {
            track.removeEventListener("ended", listener)
        }
        endedListener = null
        endedHandler = null
    }

    override fun asAny(): Any? = track
}

@JsName("RTCPeerConnection")
private external class BrowserRTCPeerConnection(configuration: dynamic = definedExternally) {
    var onicecandidate: ((dynamic) -> Unit)?
    var onnegotiationneeded: (() -> Unit)?
    var ontrack: ((dynamic) -> Unit)?
    val connectionState: String
    val signalingState: String
    val localDescription: dynamic
    val remoteDescription: dynamic
    fun createOffer(): Promise<dynamic>
    fun createAnswer(): Promise<dynamic>
    fun setLocalDescription(description: dynamic): Promise<dynamic>
    fun setRemoteDescription(description: dynamic): Promise<dynamic>
    fun addIceCandidate(candidate: dynamic): Promise<dynamic>
    fun addTrack(track: dynamic, stream: dynamic): dynamic
    fun removeTrack(sender: dynamic)
    fun close()
}

@JsName("MediaStream")
private external class BrowserMediaStream(tracks: Array<dynamic> = definedExternally) {
    fun addTrack(track: dynamic)
    fun getAudioTracks(): Array<dynamic>
    fun getVideoTracks(): Array<dynamic>
}

private fun jsObject(): dynamic = js("({})")

private fun hasFunction(target: dynamic, name: String): Boolean {
    if (target == null) return false
    return jsTypeOf(target[name]) == "function"
}

private fun dynamicString(value: dynamic): String? {
    return when {
        value == null -> null
        else -> value.toString()
    }?.takeIf { it != "undefined" && it.isNotBlank() }
}

private fun dynamicBoolean(value: dynamic, fallback: Boolean): Boolean {
    return when (value) {
        null -> fallback
        is Boolean -> value
        else -> value.toString() == "true"
    }
}

private fun dynamicInt(value: dynamic): Int {
    return when (value) {
        null -> 0
        is Number -> value.toInt()
        else -> value.toString().toIntOrNull() ?: 0
    }
}

private fun participantMapValues(map: dynamic): List<dynamic> {
    if (map == null || !hasFunction(map, "values")) return emptyList()
    val iterator = map.values()
        val values = mutableListOf<dynamic>()
        while (true) {
            val next = iterator.next()
            if (dynamicBoolean(next?.done, false)) break
            values.add(next.value)
        }
        return values
    }

private fun globalMediaDevices(): dynamic {
    return js("globalThis.navigator && globalThis.navigator.mediaDevices")
}

private fun exactDeviceConstraint(deviceId: String): dynamic {
    val exact = jsObject()
    exact.exact = deviceId
    val value = jsObject()
    value.deviceId = exact
    return value
}

private fun firstTrack(stream: dynamic, kind: String): dynamic {
    val tracks = when (kind) {
        "audio" -> stream.getAudioTracks().unsafeCast<Array<dynamic>>()
        else -> stream.getVideoTracks().unsafeCast<Array<dynamic>>()
    }
    return tracks.firstOrNull()
}

private fun buildSingleTrackMediaStream(track: dynamic): dynamic {
    val stream = BrowserMediaStream()
    stream.addTrack(track)
    return stream
}

private fun releaseMediaStream(stream: dynamic) {
    val audioTracks = runCatching { stream.getAudioTracks().unsafeCast<Array<dynamic>>() }.getOrNull().orEmpty()
    val videoTracks = runCatching { stream.getVideoTracks().unsafeCast<Array<dynamic>>() }.getOrNull().orEmpty()
    (audioTracks + videoTracks).forEach { track ->
        runCatching { track.stop() }
    }
}

private fun sessionDescriptionFromJs(description: dynamic): RoomP2PSessionDescription {
    return RoomP2PSessionDescription(
        type = dynamicString(description.type) ?: "offer",
        sdp = dynamicString(description.sdp) ?: "",
    )
}

private fun sessionDescriptionToJs(description: RoomP2PSessionDescription): dynamic {
    return json(
        "type" to description.type,
        "sdp" to description.sdp,
    )
}

private fun iceCandidateToJs(candidate: RoomP2PIceCandidate): dynamic {
    val value = jsObject()
    value.candidate = candidate.candidate
    value.sdpMid = candidate.sdpMid
    value.sdpMLineIndex = candidate.sdpMLineIndex
    return value
}
