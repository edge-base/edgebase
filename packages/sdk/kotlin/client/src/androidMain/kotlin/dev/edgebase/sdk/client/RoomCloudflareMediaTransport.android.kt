package dev.edgebase.sdk.client

import com.cloudflare.realtimekit.RealtimeKitClient
import com.cloudflare.realtimekit.RealtimeKitMeetingBuilder
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
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal actual fun defaultCloudflareRealtimeKitClientFactory(): RoomCloudflareRealtimeKitClientFactory? {
    return RoomCloudflareRealtimeKitClientFactory { options ->
        val activity = AndroidActivityTracker.getCurrentActivity()
            ?: throw IllegalStateException(
                "EdgeBase room media transport requires a foreground Android Activity. " +
                "Call AndroidActivityTracker.initContext(context) if auto-detection is unavailable.",
            )

        val meeting = RealtimeKitMeetingBuilder.build(activity)
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

        AndroidRoomCloudflareRealtimeKitClientAdapter(meeting)
    }
}

private class AndroidRoomCloudflareRealtimeKitClientAdapter(
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
