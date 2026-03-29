package dev.edgebase.sdk.client

import io.ktor.websocket.CloseReason
import io.ktor.websocket.Frame
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.test.Test
import kotlin.test.assertEquals

class RoomClientJvmTest {
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

        assertEquals(expectedEvents, fakeSocket.events)

        room.destroy()
    }
}
