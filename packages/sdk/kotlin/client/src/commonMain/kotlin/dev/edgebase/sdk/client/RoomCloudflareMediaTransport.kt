package dev.edgebase.sdk.client

import dev.edgebase.sdk.core.EdgeBaseError
import dev.edgebase.sdk.core.platformUuid
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

private const val ROOM_MEDIA_DOCS_URL = "https://edgebase.fun/docs/room/media"

typealias RoomMediaTransportConnectPayload = Map<String, Any?>

data class RoomMediaRemoteTrackEvent(
    val kind: String,
    val track: Any?,
    val view: Any? = null,
    val trackName: String? = null,
    val providerSessionId: String? = null,
    val participantId: String? = null,
    val customParticipantId: String? = null,
    val userId: String? = null,
    val participant: Map<String, Any?> = emptyMap(),
)

interface RoomMediaTransport {
    suspend fun connect(payload: RoomMediaTransportConnectPayload = emptyMap()): String
    suspend fun enableAudio(payload: Map<String, Any?> = emptyMap()): Any?
    suspend fun enableVideo(payload: Map<String, Any?> = emptyMap()): Any?
    suspend fun startScreenShare(payload: Map<String, Any?> = emptyMap()): Any?
    suspend fun disableAudio()
    suspend fun disableVideo()
    suspend fun stopScreenShare()
    suspend fun setMuted(kind: String, muted: Boolean)
    suspend fun switchDevices(payload: Map<String, Any?>)
    fun onRemoteTrack(handler: (RoomMediaRemoteTrackEvent) -> Unit): Subscription
    fun getSessionId(): String?
    fun getPeerConnection(): Any?
    fun destroy()
}

enum class RoomMediaTransportProvider {
    cloudflare_realtimekit,
    p2p,
}

data class RoomCloudflareRealtimeKitTransportOptions(
    val autoSubscribe: Boolean = true,
    val baseDomain: String = "dyte.io",
    val clientFactory: RoomCloudflareRealtimeKitClientFactory? = null,
)

data class RoomMediaTransportOptions(
    val provider: RoomMediaTransportProvider = RoomMediaTransportProvider.cloudflare_realtimekit,
    val cloudflareRealtimeKit: RoomCloudflareRealtimeKitTransportOptions? = null,
    val p2p: RoomP2PMediaTransportOptions? = null,
)

data class RoomCloudflareRealtimeKitClientFactoryOptions(
    val authToken: String,
    val displayName: String? = null,
    val enableAudio: Boolean = false,
    val enableVideo: Boolean = false,
    val baseDomain: String = "dyte.io",
)

fun interface RoomCloudflareRealtimeKitClientFactory {
    suspend fun create(options: RoomCloudflareRealtimeKitClientFactoryOptions): RoomCloudflareRealtimeKitClientAdapter
}

data class RoomCloudflareParticipantSnapshot(
    val id: String,
    val userId: String,
    val name: String,
    val picture: String? = null,
    val customParticipantId: String? = null,
    val audioEnabled: Boolean,
    val videoEnabled: Boolean,
    val screenShareEnabled: Boolean,
    val participantHandle: Any? = null,
) {
    fun toMap(): Map<String, Any?> {
        return buildMap {
            put("id", id)
            put("userId", userId)
            put("name", name)
            picture?.let { put("picture", it) }
            customParticipantId?.let { put("customParticipantId", it) }
            put("audioEnabled", audioEnabled)
            put("videoEnabled", videoEnabled)
            put("screenShareEnabled", screenShareEnabled)
        }
    }
}

interface RoomCloudflareParticipantListener {
    fun onParticipantJoin(participant: RoomCloudflareParticipantSnapshot) {}
    fun onParticipantLeave(participant: RoomCloudflareParticipantSnapshot) {}
    fun onAudioUpdate(participant: RoomCloudflareParticipantSnapshot, enabled: Boolean) {}
    fun onVideoUpdate(participant: RoomCloudflareParticipantSnapshot, enabled: Boolean) {}
    fun onScreenShareUpdate(participant: RoomCloudflareParticipantSnapshot, enabled: Boolean) {}
    fun onParticipantsSync(participants: List<RoomCloudflareParticipantSnapshot>) {}
}

interface RoomCloudflareRealtimeKitClientAdapter {
    suspend fun joinRoom()
    suspend fun leaveRoom()
    suspend fun enableAudio()
    suspend fun disableAudio()
    suspend fun enableVideo()
    suspend fun disableVideo()
    suspend fun enableScreenShare()
    suspend fun disableScreenShare()
    suspend fun setAudioDevice(deviceId: String)
    suspend fun setVideoDevice(deviceId: String)
    val localParticipant: RoomCloudflareParticipantSnapshot
    val joinedParticipants: List<RoomCloudflareParticipantSnapshot>
    fun buildView(
        participant: RoomCloudflareParticipantSnapshot,
        kind: String,
        isSelf: Boolean = false,
    ): Any?
    fun addListener(listener: RoomCloudflareParticipantListener)
    fun removeListener(listener: RoomCloudflareParticipantListener)
}

internal expect fun defaultCloudflareRealtimeKitClientFactory(): RoomCloudflareRealtimeKitClientFactory?
internal expect fun defaultP2PMediaRuntimeFactory(): RoomP2PMediaRuntimeFactory?

internal class RoomCloudflareMediaTransport(
    private val room: RoomClient,
    private val options: RoomCloudflareRealtimeKitTransportOptions = RoomCloudflareRealtimeKitTransportOptions(),
) : RoomMediaTransport {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val remoteTrackHandlers = linkedMapOf<String, (RoomMediaRemoteTrackEvent) -> Unit>()
    private val publishedRemoteKeys = mutableSetOf<String>()
    private var client: RoomCloudflareRealtimeKitClientAdapter? = null
    private var sessionId: String? = null
    private var providerSessionId: String? = null
    private var participantListener: RoomCloudflareParticipantListener? = null

    override suspend fun connect(payload: RoomMediaTransportConnectPayload): String {
        sessionId?.let { return it }

        val session = room.media.cloudflareRealtimeKit.createSession(payload)
        val authToken = session["authToken"] as? String
            ?: throw EdgeBaseError(500, "Cloudflare RealtimeKit session is missing authToken.")

        val nextClient = resolveClientFactory().create(
            RoomCloudflareRealtimeKitClientFactoryOptions(
                authToken = authToken,
                displayName = payload["name"] as? String,
                enableAudio = false,
                enableVideo = false,
                baseDomain = options.baseDomain,
            ),
        )

        client = nextClient
        sessionId = session["sessionId"] as? String
        providerSessionId = session["participantId"] as? String

        val listener = object : RoomCloudflareParticipantListener {
            override fun onParticipantJoin(participant: RoomCloudflareParticipantSnapshot) {
                syncParticipant(participant)
            }

            override fun onParticipantLeave(participant: RoomCloudflareParticipantSnapshot) {
                removeParticipant(participant)
            }

            override fun onAudioUpdate(participant: RoomCloudflareParticipantSnapshot, enabled: Boolean) {
                emitParticipantKind(participant, "audio", enabled)
            }

            override fun onVideoUpdate(participant: RoomCloudflareParticipantSnapshot, enabled: Boolean) {
                emitParticipantKind(participant, "video", enabled)
            }

            override fun onScreenShareUpdate(participant: RoomCloudflareParticipantSnapshot, enabled: Boolean) {
                emitParticipantKind(participant, "screen", enabled)
            }

            override fun onParticipantsSync(participants: List<RoomCloudflareParticipantSnapshot>) {
                syncParticipants(participants)
            }
        }

        participantListener = listener
        nextClient.addListener(listener)

        return try {
            nextClient.joinRoom()
            syncParticipants(nextClient.joinedParticipants)
            sessionId ?: (session["sessionId"] as? String) ?: ""
        } catch (error: Throwable) {
            nextClient.removeListener(listener)
            participantListener = null
            client = null
            sessionId = null
            providerSessionId = null
            throw error
        }
    }

    override suspend fun enableAudio(payload: Map<String, Any?>): Any? {
        val client = requireClient()
        client.enableAudio()
        room.media.audio.enable(withProviderSession(payload))
        return client.localParticipant.participantHandle
    }

    override suspend fun enableVideo(payload: Map<String, Any?>): Any? {
        val client = requireClient()
        client.enableVideo()
        room.media.video.enable(withProviderSession(payload))
        return client.buildView(client.localParticipant, "video", isSelf = true)
    }

    override suspend fun startScreenShare(payload: Map<String, Any?>): Any? {
        val client = requireClient()
        client.enableScreenShare()
        room.media.screen.start(withProviderSession(payload))
        return client.buildView(client.localParticipant, "screen", isSelf = true)
    }

    override suspend fun disableAudio() {
        val client = client ?: return
        client.disableAudio()
        room.media.audio.disable()
    }

    override suspend fun disableVideo() {
        val client = client ?: return
        client.disableVideo()
        room.media.video.disable()
    }

    override suspend fun stopScreenShare() {
        val client = client ?: return
        client.disableScreenShare()
        room.media.screen.stop()
    }

    override suspend fun setMuted(kind: String, muted: Boolean) {
        when (kind) {
            "audio" -> {
                if (muted) {
                    disableAudio()
                } else {
                    enableAudio(mapOf("providerSessionId" to providerSessionId))
                }
            }
            "video" -> {
                if (muted) {
                    disableVideo()
                } else {
                    enableVideo(mapOf("providerSessionId" to providerSessionId))
                }
            }
            else -> throw UnsupportedOperationException("Unsupported mute kind: $kind")
        }
    }

    override suspend fun switchDevices(payload: Map<String, Any?>) {
        val client = requireClient()
        (payload["audioInputId"] as? String)
            ?.takeIf { it.isNotBlank() }
            ?.let { client.setAudioDevice(it) }
        (payload["videoInputId"] as? String)
            ?.takeIf { it.isNotBlank() }
            ?.let { client.setVideoDevice(it) }
        room.media.devices.switch(payload)
    }

    override fun onRemoteTrack(handler: (RoomMediaRemoteTrackEvent) -> Unit): Subscription {
        val key = platformUuid()
        remoteTrackHandlers[key] = handler
        return Subscription {
            remoteTrackHandlers.remove(key)
        }
    }

    override fun getSessionId(): String? = sessionId

    override fun getPeerConnection(): Any? = null

    override fun destroy() {
        val client = client
        val listener = participantListener
        this.client = null
        participantListener = null
        sessionId = null
        providerSessionId = null
        publishedRemoteKeys.clear()

        if (client != null && listener != null) {
            client.removeListener(listener)
            scope.launch {
                runCatching { client.leaveRoom() }
            }
        }
    }

    private fun resolveClientFactory(): RoomCloudflareRealtimeKitClientFactory {
        return options.clientFactory
            ?: defaultCloudflareRealtimeKitClientFactory()
            ?: throw UnsupportedOperationException(
                "Cloudflare RealtimeKit room media transport is unavailable on this platform. See $ROOM_MEDIA_DOCS_URL",
            )
    }

    private fun requireClient(): RoomCloudflareRealtimeKitClientAdapter {
        return client
            ?: throw IllegalStateException(
                "Call room.media.transport().connect() before using media controls.",
            )
    }

    private fun withProviderSession(payload: Map<String, Any?>): Map<String, Any?> {
        return buildMap {
            putAll(payload)
            providerSessionId?.let { put("providerSessionId", it) }
        }
    }

    private fun syncParticipants(participants: List<RoomCloudflareParticipantSnapshot>) {
        participants.forEach(::syncParticipant)
    }

    private fun syncParticipant(participant: RoomCloudflareParticipantSnapshot) {
        emitParticipantKind(participant, "audio", participant.audioEnabled)
        emitParticipantKind(participant, "video", participant.videoEnabled)
        emitParticipantKind(participant, "screen", participant.screenShareEnabled)
    }

    private fun removeParticipant(participant: RoomCloudflareParticipantSnapshot) {
        publishedRemoteKeys.removeAll { it.startsWith("${participant.id}:") }
    }

    private fun emitParticipantKind(
        participant: RoomCloudflareParticipantSnapshot,
        kind: String,
        enabled: Boolean,
    ) {
        val key = "${participant.id}:$kind"
        if (!enabled) {
            publishedRemoteKeys.remove(key)
            return
        }
        if (!publishedRemoteKeys.add(key)) {
            return
        }

        val event = RoomMediaRemoteTrackEvent(
            kind = kind,
            track = participant.participantHandle,
            view = client?.buildView(participant, kind),
            providerSessionId = participant.id,
            participantId = participant.id,
            customParticipantId = participant.customParticipantId,
            userId = participant.userId,
            participant = participant.toMap(),
        )

        remoteTrackHandlers.values.toList().forEach { handler ->
            handler(event)
        }
    }
}

internal class UnsupportedRoomMediaTransport(
    private val provider: RoomMediaTransportProvider,
) : RoomMediaTransport {
    override suspend fun connect(payload: RoomMediaTransportConnectPayload): String = throw unsupported()
    override suspend fun enableAudio(payload: Map<String, Any?>): Any? = throw unsupported()
    override suspend fun enableVideo(payload: Map<String, Any?>): Any? = throw unsupported()
    override suspend fun startScreenShare(payload: Map<String, Any?>): Any? = throw unsupported()
    override suspend fun disableAudio(): Unit = throw unsupported()
    override suspend fun disableVideo(): Unit = throw unsupported()
    override suspend fun stopScreenShare(): Unit = throw unsupported()
    override suspend fun setMuted(kind: String, muted: Boolean): Unit = throw unsupported()
    override suspend fun switchDevices(payload: Map<String, Any?>): Unit = throw unsupported()
    override fun onRemoteTrack(handler: (RoomMediaRemoteTrackEvent) -> Unit): Subscription = Subscription {}
    override fun getSessionId(): String? = null
    override fun getPeerConnection(): Any? = null
    override fun destroy() {}

    private fun unsupported(): UnsupportedOperationException {
        return UnsupportedOperationException(
            "${provider.name} room media transport is not yet available in edgebase-kotlin. See $ROOM_MEDIA_DOCS_URL",
        )
    }
}
