package dev.edgebase.sdk.client

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import io.ktor.websocket.CloseReason
import io.ktor.websocket.Frame
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.net.InetSocketAddress
import java.nio.charset.StandardCharsets
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertSame
import kotlin.test.assertTrue

class RoomClientJvmTest {
    private class FakeCloudflareClientAdapter(
        override var localParticipant: RoomCloudflareParticipantSnapshot = RoomCloudflareParticipantSnapshot(
            id = "participant-self",
            userId = "user-self",
            name = "Self",
            audioEnabled = false,
            videoEnabled = false,
            screenShareEnabled = false,
            participantHandle = "handle:self",
        ),
        override var joinedParticipants: List<RoomCloudflareParticipantSnapshot> = emptyList(),
    ) : RoomCloudflareRealtimeKitClientAdapter {
        var joinCallCount = 0
        var leaveCallCount = 0
        var enableAudioCallCount = 0
        var disableAudioCallCount = 0
        var enableVideoCallCount = 0
        var disableVideoCallCount = 0
        var enableScreenShareCallCount = 0
        var disableScreenShareCallCount = 0
        val selectedAudioDevices = mutableListOf<String>()
        val selectedVideoDevices = mutableListOf<String>()
        private val listeners = linkedSetOf<RoomCloudflareParticipantListener>()

        override suspend fun joinRoom() {
            joinCallCount += 1
        }

        override suspend fun leaveRoom() {
            leaveCallCount += 1
        }

        override suspend fun enableAudio() {
            enableAudioCallCount += 1
        }

        override suspend fun disableAudio() {
            disableAudioCallCount += 1
        }

        override suspend fun enableVideo() {
            enableVideoCallCount += 1
        }

        override suspend fun disableVideo() {
            disableVideoCallCount += 1
        }

        override suspend fun enableScreenShare() {
            enableScreenShareCallCount += 1
        }

        override suspend fun disableScreenShare() {
            disableScreenShareCallCount += 1
        }

        override suspend fun setAudioDevice(deviceId: String) {
            selectedAudioDevices += deviceId
        }

        override suspend fun setVideoDevice(deviceId: String) {
            selectedVideoDevices += deviceId
        }

        override fun buildView(
            participant: RoomCloudflareParticipantSnapshot,
            kind: String,
            isSelf: Boolean,
        ): Any? = "view:${participant.id}:$kind:${if (isSelf) "self" else "remote"}"

        override fun addListener(listener: RoomCloudflareParticipantListener) {
            listeners += listener
        }

        override fun removeListener(listener: RoomCloudflareParticipantListener) {
            listeners -= listener
        }

        fun emitAudio(participant: RoomCloudflareParticipantSnapshot, enabled: Boolean) {
            listeners.forEach { it.onAudioUpdate(participant, enabled) }
        }
    }

    private class FakeP2PTransport : RoomMediaTransport {
        override suspend fun connect(payload: RoomMediaTransportConnectPayload): String = "desktop-member"
        override suspend fun enableAudio(payload: Map<String, Any?>): Any? = "audio"
        override suspend fun enableVideo(payload: Map<String, Any?>): Any? = "video"
        override suspend fun startScreenShare(payload: Map<String, Any?>): Any? = "screen"
        override suspend fun disableAudio() = Unit
        override suspend fun disableVideo() = Unit
        override suspend fun stopScreenShare() = Unit
        override suspend fun setMuted(kind: String, muted: Boolean) = Unit
        override suspend fun switchDevices(payload: Map<String, Any?>) = Unit
        override fun onRemoteTrack(handler: (RoomMediaRemoteTrackEvent) -> Unit): Subscription = Subscription {}
        override fun getSessionId(): String? = "desktop-member"
        override fun getPeerConnection(): Any? = null
        override fun destroy() = Unit
    }

    private class FakeRoomSocketHandle : RoomSocketHandle {
        val events = CopyOnWriteArrayList<String>()
        val messages = CopyOnWriteArrayList<JsonObject>()

        override suspend fun send(frame: Frame) {
            val payload = frame.data.decodeToString()
            val message = Json.parseToJsonElement(payload).jsonObject
            messages += message
            val type = message["type"]
                ?.jsonPrimitive
                ?.content
            events += "send:$type"
        }

        override suspend fun close(reason: CloseReason) {
            events += "close:${reason.message}"
        }
    }

    @Test
    fun leave_sends_explicit_leave_before_close() {
        val room = RoomClient(
            "http://localhost:8688",
            "game",
            "room-1",
            NoOpTokenManager(),
        )
        val fakeSocket = FakeRoomSocketHandle()

        room.attachSocketForTesting(fakeSocket)
        room.leave()

        val expectedEvents = listOf("send:leave", "close:Client disconnect")
        val deadline = System.currentTimeMillis() + 2_000L
        while (System.currentTimeMillis() < deadline && fakeSocket.events != expectedEvents) {
            Thread.sleep(10L)
        }

        assertEquals(
            expectedEvents,
            fakeSocket.events,
        )

        room.destroy()
    }

    @Test
    fun unified_surface_parses_members_signals_media_and_session_frames() {
        val room = RoomClient(
            "http://localhost:8688",
            "game",
            "room-1",
            NoOpTokenManager(),
        )
        val membersSnapshots = mutableListOf<List<Map<String, Any?>>>()
        val memberLeaves = mutableListOf<Pair<String, String>>()
        val signalEvents = mutableListOf<Triple<String, Any?, Map<String, Any?>>>()
        val mediaTracks = mutableListOf<Pair<Map<String, Any?>, Map<String, Any?>>>()
        val mediaDevices = mutableListOf<Pair<Map<String, Any?>, Map<String, Any?>>>()
        val connectionStates = mutableListOf<String>()

        room.members.onSync { members -> membersSnapshots += members }
        room.members.onLeave { member, reason ->
            memberLeaves += (member["memberId"] as String) to reason
        }
        room.signals.onAny { event, payload, meta ->
            signalEvents += Triple(event, payload, meta)
        }
        room.media.onTrack { track, member ->
            mediaTracks += track to member
        }
        room.media.onDeviceChange { member, change ->
            mediaDevices += member to change
        }
        room.session.onConnectionStateChange { state ->
            connectionStates += state
        }

        room.handleRawForTesting(
            """{"type":"auth_success","userId":"user-1","connectionId":"conn-1"}""",
        )
        room.handleRawForTesting(
            """{"type":"sync","sharedState":{"topic":"focus"},"sharedVersion":1,"playerState":{"ready":true},"playerVersion":2}""",
        )
        room.handleRawForTesting(
            """{"type":"members_sync","members":[{"memberId":"user-1","userId":"user-1","connectionId":"conn-1","connectionCount":1,"state":{"typing":false}}]}""",
        )
        room.handleRawForTesting(
            """{"type":"member_join","member":{"memberId":"user-2","userId":"user-2","connectionCount":1,"state":{}}}""",
        )
        room.handleRawForTesting(
            """{"type":"signal","event":"cursor.move","payload":{"x":10,"y":20},"meta":{"memberId":"user-2","userId":"user-2","connectionId":"conn-2","sentAt":123}}""",
        )
        room.handleRawForTesting(
            """{"type":"media_track","member":{"memberId":"user-2","userId":"user-2","state":{}},"track":{"kind":"video","trackId":"video-1","deviceId":"cam-1","muted":false}}""",
        )
        room.handleRawForTesting(
            """{"type":"media_device","member":{"memberId":"user-2","userId":"user-2","state":{}},"kind":"video","deviceId":"cam-2"}""",
        )
        room.handleRawForTesting(
            """{"type":"member_leave","member":{"memberId":"user-2","userId":"user-2","state":{}},"reason":"timeout"}""",
        )

        assertEquals(mapOf("topic" to "focus"), room.state.getShared())
        assertEquals(mapOf("ready" to true), room.state.getMine())
        assertEquals("user-1", room.session.userId)
        assertEquals("conn-1", room.session.connectionId)
        assertEquals("connected", room.session.connectionState)
        assertEquals(listOf("connected"), connectionStates)
        assertEquals(1, membersSnapshots.size)
        assertEquals("user-1", membersSnapshots.first().first()["memberId"])
        assertEquals(1, signalEvents.size)
        assertEquals("cursor.move", signalEvents.first().first)
        assertEquals("user-2", signalEvents.first().third["userId"])
        assertEquals(1, mediaTracks.size)
        assertEquals("video", mediaTracks.first().first["kind"])
        assertEquals("user-2", mediaTracks.first().second["memberId"])
        assertEquals(1, mediaDevices.size)
        assertEquals("cam-2", mediaDevices.first().second["deviceId"])
        assertEquals(listOf("user-2" to "timeout"), memberLeaves)
        assertEquals(1, room.members.list().size)
        assertEquals("user-1", room.members.list().first()["memberId"])
        assertEquals(0, room.media.list().size)

        room.destroy()
    }

    @Test
    fun unified_surface_sends_signal_member_admin_and_media_frames() = runBlocking {
        val room = RoomClient(
            "http://localhost:8688",
            "game",
            "room-1",
            NoOpTokenManager(),
        )
        val fakeSocket = FakeRoomSocketHandle()
        room.attachSocketForTesting(fakeSocket)
        room.handleRawForTesting(
            """{"type":"auth_success","userId":"user-1","connectionId":"conn-1"}""",
        )

        val (signalThread, signalFailure) = launchSuspend {
            room.signals.send("cursor.move", mapOf("x" to 10), mapOf("includeSelf" to true))
        }
        val signalMessage = waitForMessage(fakeSocket, 1)
        assertEquals("signal", signalMessage["type"]?.jsonPrimitive?.content)
        assertEquals("cursor.move", signalMessage["event"]?.jsonPrimitive?.content)
        assertEquals("true", signalMessage["includeSelf"]?.jsonPrimitive?.content)
        val signalRequestId = signalMessage["requestId"]?.jsonPrimitive?.content ?: error("missing signal requestId")
        room.handleRawForTesting("""{"type":"signal_sent","requestId":"$signalRequestId","event":"cursor.move"}""")
        signalThread.join()
        signalFailure.get()?.let { throw it }

        val (memberStateThread, memberStateFailure) = launchSuspend {
            room.members.setState(mapOf("typing" to true))
        }
        val memberStateMessage = waitForMessage(fakeSocket, 2)
        assertEquals("member_state", memberStateMessage["type"]?.jsonPrimitive?.content)
        assertEquals("true", memberStateMessage["state"]?.jsonObject?.get("typing")?.jsonPrimitive?.content)
        val memberStateRequestId = memberStateMessage["requestId"]?.jsonPrimitive?.content ?: error("missing member_state requestId")
        room.handleRawForTesting(
            """{"type":"member_state","requestId":"$memberStateRequestId","member":{"memberId":"user-1","userId":"user-1","state":{"typing":true}},"state":{"typing":true}}""",
        )
        memberStateThread.join()
        memberStateFailure.get()?.let { throw it }

        val (adminThread, adminFailure) = launchSuspend {
            room.admin.disableVideo("user-2")
        }
        val adminMessage = waitForMessage(fakeSocket, 3)
        assertEquals("admin", adminMessage["type"]?.jsonPrimitive?.content)
        assertEquals("disableVideo", adminMessage["operation"]?.jsonPrimitive?.content)
        assertEquals("user-2", adminMessage["memberId"]?.jsonPrimitive?.content)
        val adminRequestId = adminMessage["requestId"]?.jsonPrimitive?.content ?: error("missing admin requestId")
        room.handleRawForTesting(
            """{"type":"admin_result","requestId":"$adminRequestId","operation":"disableVideo","memberId":"user-2"}""",
        )
        adminThread.join()
        adminFailure.get()?.let { throw it }

        val (mediaThread, mediaFailure) = launchSuspend {
            room.media.audio.setMuted(true)
        }
        val mediaMessage = waitForMessage(fakeSocket, 4)
        assertEquals("media", mediaMessage["type"]?.jsonPrimitive?.content)
        assertEquals("mute", mediaMessage["operation"]?.jsonPrimitive?.content)
        assertEquals("audio", mediaMessage["kind"]?.jsonPrimitive?.content)
        assertEquals("true", mediaMessage["payload"]?.jsonObject?.get("muted")?.jsonPrimitive?.content)
        val mediaRequestId = mediaMessage["requestId"]?.jsonPrimitive?.content ?: error("missing media requestId")
        room.handleRawForTesting(
            """{"type":"media_result","requestId":"$mediaRequestId","operation":"mute","kind":"audio"}""",
        )
        mediaThread.join()
        mediaFailure.get()?.let { throw it }

        assertTrue(fakeSocket.events.containsAll(listOf("send:signal", "send:member_state", "send:admin", "send:media")))

        room.destroy()
    }

    @Test
    fun cloudflareRealtimeKitCreateSession_hits_provider_endpoint() = runBlocking {
        val server = HttpServer.create(InetSocketAddress(0), 0)
        server.executor = Executors.newSingleThreadExecutor()
        server.createContext("/api/room/media/cloudflare_realtimekit/session") { exchange ->
            assertEquals("POST", exchange.requestMethod)
            assertEquals("Bearer token", exchange.requestHeaders.getFirst("Authorization"))
            val query = exchange.requestURI.query ?: ""
            assertTrue(query.contains("namespace=media"))
            assertTrue(query.contains("id=room-1"))

            val body = exchange.requestBody.readBytes().toString(StandardCharsets.UTF_8)
            val payload = Json.parseToJsonElement(body).jsonObject
            assertEquals("Kotlin User", payload["name"]?.jsonPrimitive?.content)
            assertEquals("kotlin-user-1", payload["customParticipantId"]?.jsonPrimitive?.content)

            writeJsonResponse(
                exchange,
                """{"sessionId":"session-1","meetingId":"meeting-1","participantId":"participant-1","authToken":"auth-token-1","presetName":"default"}""",
            )
        }
        server.start()
        try {
            val tokenManager = ClientTokenManager(MemoryTokenStorage())
            tokenManager.setTokens(TokenPair("token", "refresh-token"))
            val room = RoomClient(
                "http://127.0.0.1:${server.address.port}",
                "media",
                "room-1",
                tokenManager,
            )
            val result = room.media.cloudflareRealtimeKit.createSession(
                mapOf(
                    "name" to "Kotlin User",
                    "customParticipantId" to "kotlin-user-1",
                ),
            )

            assertEquals("session-1", result["sessionId"])
            assertEquals("meeting-1", result["meetingId"])
            assertEquals("participant-1", result["participantId"])
            assertEquals("auth-token-1", result["authToken"])
            assertEquals("default", result["presetName"])

            room.destroy()
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun cloudflareRealtimeKitTransport_connects_and_emits_remote_tracks() = runBlocking {
        val server = HttpServer.create(InetSocketAddress(0), 0)
        server.executor = Executors.newSingleThreadExecutor()
        server.createContext("/api/room/media/cloudflare_realtimekit/session") { exchange ->
            assertEquals("POST", exchange.requestMethod)
            assertEquals("Bearer token", exchange.requestHeaders.getFirst("Authorization"))
            val query = exchange.requestURI.query ?: ""
            assertTrue(query.contains("namespace=media"))
            assertTrue(query.contains("id=room-1"))

            val body = exchange.requestBody.readBytes().toString(StandardCharsets.UTF_8)
            val payload = Json.parseToJsonElement(body).jsonObject
            assertEquals("Kotlin User", payload["name"]?.jsonPrimitive?.content)
            assertEquals("kotlin-user-1", payload["customParticipantId"]?.jsonPrimitive?.content)

            writeJsonResponse(
                exchange,
                """{"sessionId":"session-transport-1","meetingId":"meeting-1","participantId":"participant-1","authToken":"auth-token-1","presetName":"default"}""",
            )
        }
        server.start()
        try {
            val tokenManager = ClientTokenManager(MemoryTokenStorage())
            tokenManager.setTokens(TokenPair("token", "refresh-token"))
            val room = RoomClient(
                "http://127.0.0.1:${server.address.port}",
                "media",
                "room-1",
                tokenManager,
            )

            val remoteParticipant = RoomCloudflareParticipantSnapshot(
                id = "remote-1",
                userId = "user-2",
                name = "Remote User",
                customParticipantId = "remote-custom-1",
                audioEnabled = false,
                videoEnabled = true,
                screenShareEnabled = false,
                participantHandle = "handle:remote-1",
            )
            val fakeClient = FakeCloudflareClientAdapter(
                joinedParticipants = listOf(remoteParticipant),
            )
            val remoteEvents = mutableListOf<RoomMediaRemoteTrackEvent>()

            val transport = room.media.transport(
                RoomMediaTransportOptions(
                    cloudflareRealtimeKit = RoomCloudflareRealtimeKitTransportOptions(
                        clientFactory = RoomCloudflareRealtimeKitClientFactory { options ->
                            assertEquals("auth-token-1", options.authToken)
                            assertEquals("Kotlin User", options.displayName)
                            assertEquals(false, options.enableAudio)
                            assertEquals(false, options.enableVideo)
                            assertEquals("dyte.io", options.baseDomain)
                            fakeClient
                        },
                    ),
                ),
            )
            transport.onRemoteTrack { remoteEvents += it }

            val sessionId = transport.connect(
                mapOf(
                    "name" to "Kotlin User",
                    "customParticipantId" to "kotlin-user-1",
                ),
            )

            assertEquals("session-transport-1", sessionId)
            assertEquals(1, fakeClient.joinCallCount)
            assertEquals("session-transport-1", transport.getSessionId())
            assertEquals(1, remoteEvents.size)
            assertEquals("video", remoteEvents.first().kind)
            assertEquals("remote-1", remoteEvents.first().participantId)
            assertEquals("remote-custom-1", remoteEvents.first().customParticipantId)
            assertEquals("view:remote-1:video:remote", remoteEvents.first().view)

            room.destroy()
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun cloudflareRealtimeKitTransport_forwards_local_media_operations() = runBlocking {
        val server = HttpServer.create(InetSocketAddress(0), 0)
        server.executor = Executors.newSingleThreadExecutor()
        server.createContext("/api/room/media/cloudflare_realtimekit/session") { exchange ->
            writeJsonResponse(
                exchange,
                """{"sessionId":"session-transport-2","meetingId":"meeting-2","participantId":"participant-2","authToken":"auth-token-2","presetName":"default"}""",
            )
        }
        server.start()
        try {
            val tokenManager = ClientTokenManager(MemoryTokenStorage())
            tokenManager.setTokens(TokenPair("token", "refresh-token"))
            val room = RoomClient(
                "http://127.0.0.1:${server.address.port}",
                "media",
                "room-1",
                tokenManager,
            )
            val fakeSocket = FakeRoomSocketHandle()
            room.attachSocketForTesting(fakeSocket)

            val fakeClient = FakeCloudflareClientAdapter()
            val transport = room.media.transport(
                RoomMediaTransportOptions(
                    cloudflareRealtimeKit = RoomCloudflareRealtimeKitTransportOptions(
                        clientFactory = RoomCloudflareRealtimeKitClientFactory { fakeClient },
                    ),
                ),
            )

            transport.connect(mapOf("name" to "Kotlin User"))

            val (audioThread, audioFailure) = launchSuspend {
                transport.enableAudio()
            }
            val audioMessage = waitForMessage(fakeSocket, 1)
            assertEquals("media", audioMessage["type"]?.jsonPrimitive?.content)
            assertEquals("publish", audioMessage["operation"]?.jsonPrimitive?.content)
            assertEquals("audio", audioMessage["kind"]?.jsonPrimitive?.content)
            assertEquals(
                "participant-2",
                audioMessage["payload"]?.jsonObject?.get("providerSessionId")?.jsonPrimitive?.content,
            )
            val audioRequestId = audioMessage["requestId"]?.jsonPrimitive?.content ?: error("missing audio requestId")
            room.handleRawForTesting(
                """{"type":"media_result","requestId":"$audioRequestId","operation":"publish","kind":"audio"}""",
            )
            audioThread.join()
            audioFailure.get()?.let { throw it }

            val (videoThread, videoFailure) = launchSuspend {
                transport.enableVideo()
            }
            val videoMessage = waitForMessage(fakeSocket, 2)
            assertEquals("media", videoMessage["type"]?.jsonPrimitive?.content)
            assertEquals("publish", videoMessage["operation"]?.jsonPrimitive?.content)
            assertEquals("video", videoMessage["kind"]?.jsonPrimitive?.content)
            assertEquals(
                "participant-2",
                videoMessage["payload"]?.jsonObject?.get("providerSessionId")?.jsonPrimitive?.content,
            )
            val videoRequestId = videoMessage["requestId"]?.jsonPrimitive?.content ?: error("missing video requestId")
            room.handleRawForTesting(
                """{"type":"media_result","requestId":"$videoRequestId","operation":"publish","kind":"video"}""",
            )
            videoThread.join()
            videoFailure.get()?.let { throw it }

            assertEquals(1, fakeClient.enableAudioCallCount)
            assertEquals(1, fakeClient.enableVideoCallCount)

            transport.destroy()
            Thread.sleep(80L)
            assertEquals(1, fakeClient.leaveCallCount)

            room.destroy()
        } finally {
            server.stop(0)
        }
    }

    @Test
    fun p2pTransport_uses_explicit_transport_factory_on_jvm() {
        val room = RoomClient(
            "http://localhost:8688",
            "media",
            "room-1",
            NoOpTokenManager(),
        )
        val fakeTransport = FakeP2PTransport()

        val transport = room.media.transport(
            RoomMediaTransportOptions(
                provider = RoomMediaTransportProvider.p2p,
                p2p = RoomP2PMediaTransportOptions(
                    transportFactory = RoomP2PMediaTransportFactory { providedRoom, options ->
                        assertSame(room, providedRoom)
                        assertEquals("desktop.signal", options.signalPrefix)
                        fakeTransport
                    },
                    signalPrefix = "desktop.signal",
                ),
            ),
        )

        assertSame(fakeTransport, transport)
        room.destroy()
    }

    private fun waitForMessage(socket: FakeRoomSocketHandle, index: Int): JsonObject {
        val deadline = System.currentTimeMillis() + 2000L
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

    private fun writeJsonResponse(exchange: HttpExchange, body: String) {
        val bytes = body.toByteArray(StandardCharsets.UTF_8)
        exchange.responseHeaders.add("Content-Type", "application/json")
        exchange.sendResponseHeaders(200, bytes.size.toLong())
        exchange.responseBody.use { output ->
            output.write(bytes)
        }
    }
}
