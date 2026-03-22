package dev.edgebase.sdk.client

import com.shepeliev.webrtckmp.IceCandidate
import com.shepeliev.webrtckmp.IceServer
import com.shepeliev.webrtckmp.MediaDevices
import com.shepeliev.webrtckmp.MediaStream
import com.shepeliev.webrtckmp.MediaStreamTrack
import com.shepeliev.webrtckmp.MediaStreamTrackKind
import com.shepeliev.webrtckmp.MediaStreamTrackState
import com.shepeliev.webrtckmp.PeerConnection
import com.shepeliev.webrtckmp.RtcConfiguration
import com.shepeliev.webrtckmp.RtpSender
import com.shepeliev.webrtckmp.SessionDescription
import com.shepeliev.webrtckmp.SessionDescriptionType
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch

internal actual fun defaultP2PMediaRuntimeFactory(): RoomP2PMediaRuntimeFactory? {
    return RoomP2PMediaRuntimeFactory {
        AndroidRoomP2PMediaRuntimeAdapter()
    }
}

private class AndroidRoomP2PMediaRuntimeAdapter : RoomP2PMediaRuntimeAdapter {
    private val mediaDevices: MediaDevices = MediaDevices.Companion

    override suspend fun createPeerConnection(
        configuration: RoomP2PRtcConfigurationOptions,
    ): RoomP2PPeerConnectionAdapter {
        val nativeConfiguration = RtcConfiguration(
            iceServers = configuration.iceServers.map { iceServer ->
                IceServer(
                    urls = iceServer.urls,
                    username = iceServer.username ?: "",
                    password = iceServer.credential ?: "",
                )
            },
        )
        return AndroidRoomP2PPeerConnectionAdapter(PeerConnection(nativeConfiguration))
    }

    override suspend fun captureUserMedia(
        kind: String,
        deviceId: String?,
    ): RoomP2PCapturedTrack? {
        val stream = mediaDevices.getUserMedia {
            when (kind) {
                "audio" -> {
                    if (deviceId != null) {
                        audio { deviceId(deviceId) }
                    } else {
                        audio(true)
                    }
                    video(false)
                }
                "video" -> {
                    audio(false)
                    if (deviceId != null) {
                        video { deviceId(deviceId) }
                    } else {
                        video(true)
                    }
                }
                else -> {
                    audio(false)
                    video(false)
                }
            }
        }

        val trackKind = when (kind) {
            "audio" -> MediaStreamTrackKind.Audio
            "video" -> MediaStreamTrackKind.Video
            else -> null
        } ?: return null

        val track = when (trackKind) {
            MediaStreamTrackKind.Audio -> stream.firstTrack(MediaStreamTrackKind.Audio)
            MediaStreamTrackKind.Video -> stream.firstTrack(MediaStreamTrackKind.Video)
        }
            ?: run {
                stream.release()
                return null
            }

        return RoomP2PCapturedTrack(
            kind = kind,
            track = AndroidRoomP2PMediaTrackAdapter(track),
            stream = AndroidRoomP2PMediaStreamAdapter(stream),
            stopOnCleanup = true,
        )
    }

    override suspend fun captureDisplayMedia(): RoomP2PCapturedTrack? {
        val supported = mediaDevices.supportsDisplayMedia()
        if (!supported) return null

        val stream = mediaDevices.getDisplayMedia()
        val track = stream.firstTrack(MediaStreamTrackKind.Video)
            ?: run {
                stream.release()
                return null
            }

        return RoomP2PCapturedTrack(
            kind = "screen",
            track = AndroidRoomP2PMediaTrackAdapter(track),
            stream = AndroidRoomP2PMediaStreamAdapter(stream),
            stopOnCleanup = true,
        )
    }
}

private class AndroidRoomP2PPeerConnectionAdapter(
    private val peerConnection: PeerConnection,
) : RoomP2PPeerConnectionAdapter {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val peerEvents: Flow<Any?> = resolvePeerEvents(peerConnection)
    private var iceCandidateHandler: (suspend (RoomP2PIceCandidate) -> Unit)? = null
    private var negotiationNeededHandler: (suspend () -> Unit)? = null
    private var trackHandler: (suspend (RoomP2PRemoteTrackPayload) -> Unit)? = null

    init {
        scope.launch {
            peerEvents.collectLatest { event ->
                if (event != null) {
                    handlePeerEvent(event)
                }
            }
        }
    }

    override val connectionState: String
        get() = peerConnection.connectionState.name.lowercase()

    override val signalingState: String
        get() = peerConnection.signalingState.name.lowercase()

    override val localDescription: RoomP2PSessionDescription?
        get() = peerConnection.localDescription?.toEdgeBase()

    override val remoteDescription: RoomP2PSessionDescription?
        get() = peerConnection.remoteDescription?.toEdgeBase()

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
        return peerConnection.createOffer(com.shepeliev.webrtckmp.OfferAnswerOptions()).toEdgeBase()
    }

    override suspend fun createAnswer(): RoomP2PSessionDescription {
        return peerConnection.createAnswer(com.shepeliev.webrtckmp.OfferAnswerOptions()).toEdgeBase()
    }

    override suspend fun setLocalDescription(description: RoomP2PSessionDescription) {
        peerConnection.setLocalDescription(description.toNative())
    }

    override suspend fun setRemoteDescription(description: RoomP2PSessionDescription) {
        peerConnection.setRemoteDescription(description.toNative())
    }

    override suspend fun addIceCandidate(candidate: RoomP2PIceCandidate): Boolean {
        return peerConnection.addIceCandidate(
            IceCandidate(
                candidate.sdpMid ?: "",
                candidate.sdpMLineIndex,
                candidate.candidate,
            ),
        )
    }

    override fun addTrack(
        track: RoomP2PMediaTrackAdapter,
        stream: RoomP2PMediaStreamAdapter,
    ): RoomP2PRtpSenderAdapter {
        val nativeTrack = (track as AndroidRoomP2PMediaTrackAdapter).track
        val nativeStream = (stream as AndroidRoomP2PMediaStreamAdapter).stream
        return AndroidRoomP2PRtpSenderAdapter(peerConnection.addTrack(nativeTrack, nativeStream))
    }

    override fun removeTrack(sender: RoomP2PRtpSenderAdapter): Boolean {
        val nativeSender = sender as AndroidRoomP2PRtpSenderAdapter
        return peerConnection.removeTrack(nativeSender.sender)
    }

    override fun close() {
        scope.cancel()
        peerConnection.close()
    }

    override fun asAny(): Any? = peerConnection

    private suspend fun handlePeerEvent(event: Any) {
        when (event.javaClass.simpleName) {
            "NewIceCandidate" -> {
                val candidate = invokeGetter(event, "getCandidate") ?: return
                iceCandidateHandler?.invoke(
                    RoomP2PIceCandidate(
                        candidate = invokeGetter(candidate, "getCandidate") as? String ?: return,
                        sdpMid = invokeGetter(candidate, "getSdpMid") as? String,
                        sdpMLineIndex = (invokeGetter(candidate, "getSdpMLineIndex") as? Number)?.toInt() ?: 0,
                    ),
                )
            }
            "NegotiationNeeded" -> {
                negotiationNeededHandler?.invoke()
            }
            "Track" -> {
                val trackEvent = invokeGetter(event, "getTrackEvent") ?: return
                val track = invokeGetter(trackEvent, "getTrack") as? MediaStreamTrack ?: return
                val streamList = (invokeGetter(trackEvent, "getStreams") as? List<*>)
                    ?.filterIsInstance<MediaStream>()
                    .orEmpty()
                val stream = streamList.firstOrNull()?.let(::AndroidRoomP2PMediaStreamAdapter)
                    ?: AndroidRoomP2PMediaStreamAdapter(
                        MediaStream().apply { addTrack(track) },
                    )
                trackHandler?.invoke(
                    RoomP2PRemoteTrackPayload(
                        track = AndroidRoomP2PMediaTrackAdapter(track),
                        stream = stream,
                    ),
                )
            }
        }
    }
}

private class AndroidRoomP2PRtpSenderAdapter(
    internal val sender: RtpSender,
) : RoomP2PRtpSenderAdapter {
    override val track: RoomP2PMediaTrackAdapter?
        get() = sender.track?.let(::AndroidRoomP2PMediaTrackAdapter)

    override suspend fun replaceTrack(track: RoomP2PMediaTrackAdapter) {
        sender.replaceTrack((track as AndroidRoomP2PMediaTrackAdapter).track)
    }
}

private class AndroidRoomP2PMediaStreamAdapter(
    internal val stream: MediaStream,
) : RoomP2PMediaStreamAdapter {
    override fun release() {
        stream.release()
    }

    override fun asAny(): Any? = stream
}

private class AndroidRoomP2PMediaTrackAdapter(
    internal val track: MediaStreamTrack,
) : RoomP2PMediaTrackAdapter {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var endedObserverInstalled = false
    private var endedHandler: (() -> Unit)? = null

    override val id: String
        get() = track.id

    override val kind: String
        get() = when (track.kind) {
            MediaStreamTrackKind.Audio -> "audio"
            MediaStreamTrackKind.Video -> "video"
            else -> "video"
        }

    override val deviceId: String?
        get() = track.settings.deviceId?.takeIf { it.isNotBlank() }

    override var enabled: Boolean
        get() = track.enabled
        set(value) {
            track.enabled = value
        }

    override fun stop() {
        track.stop()
    }

    override fun onEnded(handler: (() -> Unit)?) {
        endedHandler = handler
        if (handler == null || endedObserverInstalled) return
        endedObserverInstalled = true
        scope.launch {
            track.state.collectLatest { state ->
                if (state is MediaStreamTrackState.Ended) {
                    endedHandler?.invoke()
                }
            }
        }
    }

    override fun dispose() {
        scope.cancel()
    }

    override fun asAny(): Any? = track
}

private fun resolvePeerEvents(peerConnection: PeerConnection): Flow<Any?> {
    val getter = peerConnection.javaClass.methods.firstOrNull { method ->
        method.name.startsWith("getPeerConnectionEvent$")
    } ?: throw IllegalStateException("PeerConnection event flow is unavailable in the bundled WebRTC runtime.")

    @Suppress("UNCHECKED_CAST")
    return getter.invoke(peerConnection) as? Flow<Any?>
        ?: throw IllegalStateException("PeerConnection event flow returned an unexpected type.")
}

private fun invokeGetter(target: Any, name: String): Any? {
    val method = target.javaClass.methods.firstOrNull { it.name == name } ?: return null
    return method.invoke(target)
}

private fun SessionDescription.toEdgeBase(): RoomP2PSessionDescription {
    return RoomP2PSessionDescription(
        type = when (type) {
            SessionDescriptionType.Offer -> "offer"
            SessionDescriptionType.Answer -> "answer"
            SessionDescriptionType.Pranswer -> "pranswer"
            SessionDescriptionType.Rollback -> "rollback"
        },
        sdp = sdp,
    )
}

private fun RoomP2PSessionDescription.toNative(): SessionDescription {
    return SessionDescription(
        type = when (type.lowercase()) {
            "offer" -> SessionDescriptionType.Offer
            "answer" -> SessionDescriptionType.Answer
            "pranswer" -> SessionDescriptionType.Pranswer
            "rollback" -> SessionDescriptionType.Rollback
            else -> SessionDescriptionType.Offer
        },
        sdp = sdp,
    )
}

private fun MediaStream.firstTrack(kind: MediaStreamTrackKind): MediaStreamTrack? {
    return tracks.firstOrNull { it.kind == kind }
}
