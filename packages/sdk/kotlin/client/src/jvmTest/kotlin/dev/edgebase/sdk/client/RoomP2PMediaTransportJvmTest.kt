package dev.edgebase.sdk.client

import io.ktor.websocket.CloseReason
import io.ktor.websocket.Frame
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicReference
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

class RoomP2PMediaTransportJvmTest {
    private class FakeRoomSocketHandle : RoomSocketHandle {
        val events = CopyOnWriteArrayList<String>()
        val messages = CopyOnWriteArrayList<JsonObject>()

        override suspend fun send(frame: Frame) {
            val payload = frame.data.decodeToString()
            val message = Json.parseToJsonElement(payload).jsonObject
            messages += message
            val type = message["type"]?.jsonPrimitive?.content
            events += "send:$type"
        }

        override suspend fun close(reason: CloseReason) {
            events += "close:${reason.message}"
        }
    }

    private class FakeTrack(
        override val id: String,
        override val kind: String,
        override val deviceId: String? = null,
    ) : RoomP2PMediaTrackAdapter {
        private var endedHandler: (() -> Unit)? = null
        var stopped = false
        override var enabled: Boolean = true

        override fun stop() {
            stopped = true
            endedHandler?.invoke()
        }

        override fun onEnded(handler: (() -> Unit)?) {
            endedHandler = handler
        }

        override fun dispose() = Unit

        override fun asAny(): Any? = this
    }

    private class FakeStream(
        private val label: String,
    ) : RoomP2PMediaStreamAdapter {
        var released = false

        override fun release() {
            released = true
        }

        override fun asAny(): Any? = label
    }

    private class FakeSender(
        override var track: RoomP2PMediaTrackAdapter?,
    ) : RoomP2PRtpSenderAdapter {
        override suspend fun replaceTrack(track: RoomP2PMediaTrackAdapter) {
            this.track = track
        }
    }

    private class FakePeerConnection(
        private val label: String,
    ) : RoomP2PPeerConnectionAdapter {
        private var iceCandidateHandler: (suspend (RoomP2PIceCandidate) -> Unit)? = null
        private var negotiationNeededHandler: (suspend () -> Unit)? = null
        private var trackHandler: (suspend (RoomP2PRemoteTrackPayload) -> Unit)? = null
        private val senders = mutableListOf<FakeSender>()

        override var connectionState: String = "new"
        override var signalingState: String = "stable"
        override var localDescription: RoomP2PSessionDescription? = null
        override var remoteDescription: RoomP2PSessionDescription? = null

        var createOfferCount = 0
        var createAnswerCount = 0
        var closeCount = 0
        val addedTracks = mutableListOf<String>()
        val removedTracks = mutableListOf<String>()
        val iceCandidates = mutableListOf<RoomP2PIceCandidate>()

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
            createOfferCount += 1
            return RoomP2PSessionDescription("offer", "offer-$label-$createOfferCount")
        }

        override suspend fun createAnswer(): RoomP2PSessionDescription {
            createAnswerCount += 1
            return RoomP2PSessionDescription("answer", "answer-$label-$createAnswerCount")
        }

        override suspend fun setLocalDescription(description: RoomP2PSessionDescription) {
            localDescription = description
            signalingState = if (description.type == "offer") "have_local_offer" else "stable"
        }

        override suspend fun setRemoteDescription(description: RoomP2PSessionDescription) {
            remoteDescription = description
            signalingState = if (description.type == "offer") "have_remote_offer" else "stable"
        }

        override suspend fun addIceCandidate(candidate: RoomP2PIceCandidate): Boolean {
            iceCandidates += candidate
            return true
        }

        override fun addTrack(
            track: RoomP2PMediaTrackAdapter,
            stream: RoomP2PMediaStreamAdapter,
        ): RoomP2PRtpSenderAdapter {
            addedTracks += track.id
            return FakeSender(track).also(senders::add)
        }

        override fun removeTrack(sender: RoomP2PRtpSenderAdapter): Boolean {
            val fakeSender = sender as FakeSender
            fakeSender.track?.id?.let(removedTracks::add)
            senders.remove(fakeSender)
            return true
        }

        override fun close() {
            connectionState = "closed"
            closeCount += 1
        }

        override fun asAny(): Any? = this

        suspend fun emitRemoteTrack(trackId: String, kind: String, streamLabel: String = "remote-stream") {
            trackHandler?.invoke(
                RoomP2PRemoteTrackPayload(
                    track = FakeTrack(trackId, kind),
                    stream = FakeStream(streamLabel),
                ),
            )
        }

        suspend fun emitRemoteIceCandidate(candidate: String) {
            iceCandidateHandler?.invoke(RoomP2PIceCandidate(candidate))
        }

        suspend fun emitNegotiationNeeded() {
            negotiationNeededHandler?.invoke()
        }
    }

    private class FakeRuntime : RoomP2PMediaRuntimeAdapter {
        val peerConnections = mutableMapOf<String, FakePeerConnection>()
        var captureAudioCount = 0
        var captureVideoCount = 0
        var captureScreenCount = 0

        override suspend fun createPeerConnection(
            configuration: RoomP2PRtcConfigurationOptions,
        ): RoomP2PPeerConnectionAdapter {
            assertEquals("stun:stun.l.google.com:19302", configuration.iceServers.first().urls.first())
            return FakePeerConnection("peer-${peerConnections.size + 1}").also {
                peerConnections[it.asAny().hashCode().toString()] = it
            }
        }

        override suspend fun captureUserMedia(
            kind: String,
            deviceId: String?,
        ): RoomP2PCapturedTrack? {
            when (kind) {
                "audio" -> captureAudioCount += 1
                "video" -> captureVideoCount += 1
            }
            val track = FakeTrack(
                id = "$kind-local-${if (kind == "audio") captureAudioCount else captureVideoCount}",
                kind = kind,
                deviceId = deviceId,
            )
            return RoomP2PCapturedTrack(
                kind = kind,
                track = track,
                stream = FakeStream("$kind-stream"),
                stopOnCleanup = true,
            )
        }

        override suspend fun captureDisplayMedia(): RoomP2PCapturedTrack? {
            captureScreenCount += 1
            val track = FakeTrack(
                id = "screen-local-$captureScreenCount",
                kind = "video",
            )
            return RoomP2PCapturedTrack(
                kind = "screen",
                track = track,
                stream = FakeStream("screen-stream"),
                stopOnCleanup = true,
            )
        }
    }

    @Test
    fun p2pTransport_connects_and_publishes_local_audio() = runBlocking {
        val room = RoomClient(
            "http://localhost:8688",
            "media",
            "room-1",
            NoOpTokenManager(),
        )
        val socket = FakeRoomSocketHandle()
        room.attachSocketForTesting(socket)
        room.handleRawForTesting("""{"type":"auth_success","userId":"user-1","connectionId":"conn-1"}""")
        room.handleRawForTesting(
            """{"type":"members_sync","members":[{"memberId":"member-self","userId":"user-1","connectionId":"conn-1","state":{}},{"memberId":"member-remote","userId":"user-2","connectionId":"conn-2","state":{}}]}""",
        )

        val runtime = FakeRuntime()
        roomP2PMediaRuntimeFactoryOverride = RoomP2PMediaRuntimeFactory { runtime }
        val transport = room.media.transport(
            RoomMediaTransportOptions(
                provider = RoomMediaTransportProvider.p2p,
                p2p = RoomP2PMediaTransportOptions(),
            ),
        )

        assertEquals("member-self", transport.connect())

        val (thread, failure) = launchSuspend {
            transport.enableAudio()
        }
        val mediaMessage = waitForMessage(socket, 1)
        assertEquals("media", mediaMessage["type"]?.jsonPrimitive?.content)
        assertEquals("publish", mediaMessage["operation"]?.jsonPrimitive?.content)
        assertEquals("audio", mediaMessage["kind"]?.jsonPrimitive?.content)
        assertEquals(
            "member-self",
            mediaMessage["payload"]?.jsonObject?.get("providerSessionId")?.jsonPrimitive?.content,
        )
        val mediaRequestId = mediaMessage["requestId"]?.jsonPrimitive?.content ?: error("missing requestId")
        room.handleRawForTesting("""{"type":"media_result","requestId":"$mediaRequestId","operation":"publish","kind":"audio"}""")
        thread.join()
        failure.get()?.let { throw it }

        val signalMessage = waitForMessage(socket, 2)
        assertEquals("signal", signalMessage["type"]?.jsonPrimitive?.content)
        assertEquals("edgebase.media.p2p.offer", signalMessage["event"]?.jsonPrimitive?.content)
        assertNotNull(transport.getPeerConnection())

        transport.destroy()
        roomP2PMediaRuntimeFactoryOverride = null
        room.destroy()
    }

    @Test
    fun p2pTransport_emits_remote_tracks_once_room_media_kind_is_known() = runBlocking {
        val room = RoomClient(
            "http://localhost:8688",
            "media",
            "room-1",
            NoOpTokenManager(),
        )
        val socket = FakeRoomSocketHandle()
        room.attachSocketForTesting(socket)
        room.handleRawForTesting("""{"type":"auth_success","userId":"user-1","connectionId":"conn-1"}""")
        room.handleRawForTesting(
            """{"type":"members_sync","members":[{"memberId":"member-self","userId":"user-1","connectionId":"conn-1","state":{}},{"memberId":"member-remote","userId":"user-2","connectionId":"conn-2","customParticipantId":"remote-custom","state":{}}]}""",
        )
        room.handleRawForTesting(
            """{"type":"media_track","member":{"memberId":"member-remote","userId":"user-2","customParticipantId":"remote-custom","state":{}},"track":{"kind":"audio","trackId":"remote-audio","muted":false}}""",
        )

        val runtime = FakeRuntime()
        roomP2PMediaRuntimeFactoryOverride = RoomP2PMediaRuntimeFactory { runtime }
        val transport = room.media.transport(
            RoomMediaTransportOptions(
                provider = RoomMediaTransportProvider.p2p,
                p2p = RoomP2PMediaTransportOptions(),
            ),
        )
        val remoteEvents = mutableListOf<RoomMediaRemoteTrackEvent>()
        transport.onRemoteTrack { remoteEvents += it }

        transport.connect()
        val peer = transport.getPeerConnection() as? FakePeerConnection ?: error("expected fake peer connection")
        peer.emitRemoteTrack(trackId = "remote-audio", kind = "audio")

        assertEquals(1, remoteEvents.size)
        assertEquals("audio", remoteEvents.first().kind)
        assertEquals("member-remote", remoteEvents.first().participantId)
        assertEquals("remote-custom", remoteEvents.first().customParticipantId)

        transport.destroy()
        roomP2PMediaRuntimeFactoryOverride = null
        room.destroy()
    }

    private fun waitForMessage(socket: FakeRoomSocketHandle, index: Int): JsonObject {
        val deadline = System.currentTimeMillis() + 2_000L
        while (System.currentTimeMillis() < deadline) {
            if (socket.messages.size >= index) {
                return socket.messages[index - 1]
            }
            Thread.sleep(10L)
        }
        error("Timed out waiting for message #$index; events=${socket.events}; messages=${socket.messages}")
    }

    private fun launchSuspend(block: suspend () -> Unit): Pair<Thread, AtomicReference<Throwable?>> {
        val failure = AtomicReference<Throwable?>(null)
        val thread = Thread {
            try {
                runBlocking {
                    block()
                }
            } catch (t: Throwable) {
                failure.set(t)
            }
        }
        thread.start()
        return thread to failure
    }
}
