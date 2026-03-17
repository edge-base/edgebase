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
import kotlin.test.assertTrue

class RoomClientJvmTest {
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

        Thread.sleep(120L)

        assertEquals(
            listOf("send:leave", "close:Client disconnect"),
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
}
