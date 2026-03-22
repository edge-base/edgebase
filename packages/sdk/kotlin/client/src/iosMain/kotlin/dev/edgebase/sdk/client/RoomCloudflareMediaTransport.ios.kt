package dev.edgebase.sdk.client

import com.cloudflare.realtimekit.RealtimeKitClient
import com.cloudflare.realtimekit.RealtimeKitiOSClientBuilder
import com.cloudflare.realtimekit.RtkMeetingParticipant
import com.cloudflare.realtimekit.errors.MeetingError
import com.cloudflare.realtimekit.media.AudioDevice
import com.cloudflare.realtimekit.media.VideoDevice
import com.cloudflare.realtimekit.models.RtkMeetingInfo
import com.cloudflare.realtimekit.participants.RtkParticipants
import com.cloudflare.realtimekit.participants.RtkParticipantsEventListener
import com.cloudflare.realtimekit.participants.RtkRemoteParticipant
import com.cloudflare.realtimekit.self.errors.AudioError
import com.cloudflare.realtimekit.self.errors.VideoError
import com.shepeliev.webrtckmp.IceCandidate
import com.shepeliev.webrtckmp.IceServer
import com.shepeliev.webrtckmp.MediaDevices
import com.shepeliev.webrtckmp.MediaStream
import com.shepeliev.webrtckmp.MediaStreamTrack
import com.shepeliev.webrtckmp.MediaStreamTrackKind
import com.shepeliev.webrtckmp.OfferAnswerOptions
import com.shepeliev.webrtckmp.PeerConnection
import com.shepeliev.webrtckmp.RtcConfiguration
import com.shepeliev.webrtckmp.RtpSender
import com.shepeliev.webrtckmp.SessionDescription
import com.shepeliev.webrtckmp.SessionDescriptionType
import com.shepeliev.webrtckmp.VideoTrack
import com.shepeliev.webrtckmp.onEnded
import com.shepeliev.webrtckmp.onIceCandidate
import com.shepeliev.webrtckmp.onNegotiationNeeded
import com.shepeliev.webrtckmp.onTrack
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal actual fun defaultCloudflareRealtimeKitClientFactory(): RoomCloudflareRealtimeKitClientFactory? {
    return RoomCloudflareRealtimeKitClientFactory { options ->
        val meeting = RealtimeKitiOSClientBuilder().build()
        val meetingInfo = RtkMeetingInfo(
            authToken = options.authToken,
            enableAudio = options.enableAudio,
            enableVideo = options.enableVideo,
            baseDomain = options.baseDomain,
        )

        suspendCancellableCoroutine<Unit> { continuation ->
            meeting.init(
                meetingInfo,
                onSuccess = {
                    if (continuation.isActive) continuation.resume(Unit)
                },
                onFailure = { error ->
                    if (continuation.isActive) {
                        continuation.resumeWithException(
                            IllegalStateException("RealtimeKit init failed: ${error.message ?: error.toString()}"),
                        )
                    }
                },
            )
        }

        IosRoomCloudflareRealtimeKitClientAdapter(meeting)
    }
}

internal actual fun defaultP2PMediaRuntimeFactory(): RoomP2PMediaRuntimeFactory? {
    return RoomP2PMediaRuntimeFactory {
        IosRoomP2PMediaRuntimeAdapter()
    }
}

private class IosRoomCloudflareRealtimeKitClientAdapter(
    private val meeting: RealtimeKitClient,
) : RoomCloudflareRealtimeKitClientAdapter {
    private val listeners = linkedMapOf<Int, RoomCloudflareParticipantListener>()
    private val participantBridge = object : RtkParticipantsEventListener {
        override fun onParticipantJoin(participant: RtkRemoteParticipant) {
            val snapshot = snapshotFromMeetingParticipant(participant)
            listeners.values.toList().forEach { it.onParticipantJoin(snapshot) }
        }

        override fun onParticipantLeave(participant: RtkRemoteParticipant) {
            val snapshot = snapshotFromMeetingParticipant(participant)
            listeners.values.toList().forEach { it.onParticipantLeave(snapshot) }
        }

        override fun onAudioUpdate(participant: RtkRemoteParticipant, isEnabled: Boolean) {
            val snapshot = snapshotFromMeetingParticipant(participant, audioEnabled = isEnabled)
            listeners.values.toList().forEach { it.onAudioUpdate(snapshot, isEnabled) }
        }

        override fun onVideoUpdate(participant: RtkRemoteParticipant, isEnabled: Boolean) {
            val snapshot = snapshotFromMeetingParticipant(participant, videoEnabled = isEnabled)
            listeners.values.toList().forEach { it.onVideoUpdate(snapshot, isEnabled) }
        }

        override fun onScreenShareUpdate(participant: RtkRemoteParticipant, isEnabled: Boolean) {
            val snapshot = snapshotFromMeetingParticipant(participant, screenShareEnabled = isEnabled)
            listeners.values.toList().forEach { it.onScreenShareUpdate(snapshot, isEnabled) }
        }

        override fun onUpdate(participants: RtkParticipants) {
            val snapshots = participants.joined.map(::snapshotFromMeetingParticipant)
            listeners.values.toList().forEach { it.onParticipantsSync(snapshots) }
        }
    }

    override suspend fun joinRoom() {
        meeting.addParticipantsEventListener(participantBridge)
        suspendCancellableCoroutine<Unit> { continuation ->
            meeting.joinRoom(
                onSuccess = {
                    if (continuation.isActive) continuation.resume(Unit)
                },
                onFailure = { error ->
                    if (continuation.isActive) {
                        continuation.resumeWithException(
                            IllegalStateException("RealtimeKit joinRoom failed: ${error.message ?: error.toString()}"),
                        )
                    }
                },
            )
        }
    }

    override suspend fun leaveRoom() {
        meeting.removeParticipantsEventListener(participantBridge)
        suspendCancellableCoroutine<Unit> { continuation ->
            meeting.leaveRoom(
                onSuccess = {
                    if (continuation.isActive) continuation.resume(Unit)
                },
                onFailure = { error ->
                    if (continuation.isActive) {
                        continuation.resumeWithException(
                            IllegalStateException("RealtimeKit leaveRoom failed: ${error.message ?: error.toString()}"),
                        )
                    }
                },
            )
        }
    }

    override suspend fun enableAudio() {
        waitForResult<AudioError>("enableAudio") { onResult ->
            meeting.localUser.enableAudio(onResult)
        }
    }

    override suspend fun disableAudio() {
        waitForResult<AudioError>("disableAudio") { onResult ->
            meeting.localUser.disableAudio(onResult)
        }
    }

    override suspend fun enableVideo() {
        waitForResult<VideoError>("enableVideo") { onResult ->
            meeting.localUser.enableVideo(onResult)
        }
    }

    override suspend fun disableVideo() {
        waitForResult<VideoError>("disableVideo") { onResult ->
            meeting.localUser.disableVideo(onResult)
        }
    }

    override suspend fun enableScreenShare() {
        val error = meeting.localUser.enableScreenShare()
        if (error != null) {
            throw IllegalStateException("RealtimeKit enableScreenShare failed: $error")
        }
    }

    override suspend fun disableScreenShare() {
        meeting.localUser.disableScreenShare()
    }

    override suspend fun setAudioDevice(deviceId: String) {
        val device = meeting.localUser.getAudioDevices().firstOrNull { it.id == deviceId }
            ?: throw IllegalStateException("Unknown audio input device: $deviceId")
        meeting.localUser.setAudioDevice(device)
    }

    override suspend fun setVideoDevice(deviceId: String) {
        val device = meeting.localUser.getVideoDevices().firstOrNull { it.id == deviceId }
            ?: throw IllegalStateException("Unknown video input device: $deviceId")
        meeting.localUser.setVideoDevice(device)
    }

    override val localParticipant: RoomCloudflareParticipantSnapshot
        get() = snapshotFromMeetingParticipant(meeting.localUser)

    override val joinedParticipants: List<RoomCloudflareParticipantSnapshot>
        get() = meeting.participants.joined.map(::snapshotFromMeetingParticipant)

    override fun buildView(
        participant: RoomCloudflareParticipantSnapshot,
        kind: String,
        isSelf: Boolean,
    ): Any? {
        val participantHandle = participant.participantHandle as? RtkMeetingParticipant ?: return null
        return when (kind) {
            "video" -> if (isSelf) meeting.localUser.getSelfPreview() else participantHandle.getVideoView()
            "screen" -> participantHandle.getScreenShareVideoView()
            else -> null
        }
    }

    override fun addListener(listener: RoomCloudflareParticipantListener) {
        listeners[listener.hashCode()] = listener
    }

    override fun removeListener(listener: RoomCloudflareParticipantListener) {
        listeners.remove(listener.hashCode())
    }

    private fun snapshotFromMeetingParticipant(
        participant: RtkMeetingParticipant,
        audioEnabled: Boolean? = null,
        videoEnabled: Boolean? = null,
        screenShareEnabled: Boolean? = null,
    ): RoomCloudflareParticipantSnapshot {
        return RoomCloudflareParticipantSnapshot(
            id = participant.id,
            userId = participant.userId,
            name = participant.name,
            picture = participant.picture,
            customParticipantId = participant.customParticipantId,
            audioEnabled = audioEnabled ?: participant.audioEnabled,
            videoEnabled = videoEnabled ?: participant.videoEnabled,
            screenShareEnabled = screenShareEnabled ?: participant.screenShareEnabled,
            participantHandle = participant,
        )
    }

    private suspend fun <T> waitForResult(
        label: String,
        action: ((T?) -> Unit) -> Unit,
    ) {
        suspendCancellableCoroutine<Unit> { continuation ->
            action { error ->
                if (error != null) {
                    continuation.resumeWithException(
                        IllegalStateException("RealtimeKit $label failed: $error"),
                    )
                } else if (continuation.isActive) {
                    continuation.resume(Unit)
                }
            }
        }
    }
}

private class IosRoomP2PMediaRuntimeAdapter : RoomP2PMediaRuntimeAdapter {
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
        return IosRoomP2PPeerConnectionAdapter(PeerConnection(nativeConfiguration))
    }

    override suspend fun captureUserMedia(
        kind: String,
        deviceId: String?,
    ): RoomP2PCapturedTrack? {
        val stream = MediaDevices.getUserMedia {
            when (kind) {
                "audio" -> {
                    if (deviceId != null) {
                        audio { deviceId(deviceId) }
                    } else {
                        audio()
                    }
                    video(false)
                }
                "video" -> {
                    audio(false)
                    if (deviceId != null) {
                        video { deviceId(deviceId) }
                    } else {
                        video()
                    }
                }
                else -> {
                    audio(false)
                    video(false)
                }
            }
        }

        val track = when (kind) {
            "audio" -> stream.firstTrack(MediaStreamTrackKind.Audio)
            "video" -> stream.firstTrack(MediaStreamTrackKind.Video)
            else -> null
        } ?: run {
            stream.release()
            return null
        }

        return RoomP2PCapturedTrack(
            kind = kind,
            track = IosRoomP2PMediaTrackAdapter(track),
            stream = IosRoomP2PMediaStreamAdapter(stream),
            stopOnCleanup = true,
        )
    }

    override suspend fun captureDisplayMedia(): RoomP2PCapturedTrack? {
        val supported = MediaDevices.supportsDisplayMedia()
        if (!supported) return null

        val stream = MediaDevices.getDisplayMedia()
        val track = stream.firstTrack(MediaStreamTrackKind.Video) ?: run {
            stream.release()
            return null
        }

        return RoomP2PCapturedTrack(
            kind = "screen",
            track = IosRoomP2PMediaTrackAdapter(track),
            stream = IosRoomP2PMediaStreamAdapter(stream),
            stopOnCleanup = true,
        )
    }
}

private class IosRoomP2PPeerConnectionAdapter(
    private val peerConnection: PeerConnection,
) : RoomP2PPeerConnectionAdapter {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var iceCandidateHandler: (suspend (RoomP2PIceCandidate) -> Unit)? = null
    private var negotiationNeededHandler: (suspend () -> Unit)? = null
    private var trackHandler: (suspend (RoomP2PRemoteTrackPayload) -> Unit)? = null

    init {
        scope.launch {
            peerConnection.onIceCandidate.collectLatest { candidate ->
                iceCandidateHandler?.invoke(
                    RoomP2PIceCandidate(
                        candidate = candidate.candidate,
                        sdpMid = candidate.sdpMid,
                        sdpMLineIndex = candidate.sdpMLineIndex,
                    ),
                )
            }
        }
        scope.launch {
            peerConnection.onNegotiationNeeded.collectLatest {
                negotiationNeededHandler?.invoke()
            }
        }
        scope.launch {
            peerConnection.onTrack.collectLatest { event ->
                val track = event.track ?: return@collectLatest
                val stream = event.streams.firstOrNull()?.let(::IosRoomP2PMediaStreamAdapter)
                    ?: IosRoomP2PMediaStreamAdapter(
                        MediaStream().apply { addTrack(track) },
                    )
                trackHandler?.invoke(
                    RoomP2PRemoteTrackPayload(
                        track = IosRoomP2PMediaTrackAdapter(track),
                        stream = stream,
                    ),
                )
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
        return peerConnection.createOffer(OfferAnswerOptions()).toEdgeBase()
    }

    override suspend fun createAnswer(): RoomP2PSessionDescription {
        return peerConnection.createAnswer(OfferAnswerOptions()).toEdgeBase()
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
                sdpMid = candidate.sdpMid ?: "",
                sdpMLineIndex = candidate.sdpMLineIndex,
                candidate = candidate.candidate,
            ),
        )
    }

    override fun addTrack(
        track: RoomP2PMediaTrackAdapter,
        stream: RoomP2PMediaStreamAdapter,
    ): RoomP2PRtpSenderAdapter {
        val nativeTrack = (track as IosRoomP2PMediaTrackAdapter).track
        val nativeStream = (stream as IosRoomP2PMediaStreamAdapter).stream
        return IosRoomP2PRtpSenderAdapter(peerConnection.addTrack(nativeTrack, nativeStream))
    }

    override fun removeTrack(sender: RoomP2PRtpSenderAdapter): Boolean {
        val nativeSender = sender as IosRoomP2PRtpSenderAdapter
        return peerConnection.removeTrack(nativeSender.sender)
    }

    override fun close() {
        scope.cancel()
        peerConnection.close()
    }

    override fun asAny(): Any? = peerConnection
}

private class IosRoomP2PRtpSenderAdapter(
    internal val sender: RtpSender,
) : RoomP2PRtpSenderAdapter {
    override val track: RoomP2PMediaTrackAdapter?
        get() = sender.track?.let(::IosRoomP2PMediaTrackAdapter)

    override suspend fun replaceTrack(track: RoomP2PMediaTrackAdapter) {
        sender.replaceTrack((track as IosRoomP2PMediaTrackAdapter).track)
    }
}

private class IosRoomP2PMediaStreamAdapter(
    internal val stream: MediaStream,
) : RoomP2PMediaStreamAdapter {
    override fun release() {
        stream.release()
    }

    override fun asAny(): Any? = stream
}

private class IosRoomP2PMediaTrackAdapter(
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
            track.onEnded.collectLatest {
                endedHandler?.invoke()
            }
        }
    }

    override fun dispose() {
        scope.cancel()
    }

    override fun asAny(): Any? = track
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
