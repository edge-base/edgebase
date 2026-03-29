package dev.edgebase.sdk.core;

import org.json.JSONObject;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RoomClientLeaveTest {

    private static final class FakeRoomSocket implements RoomClient.RoomSocket {
        final List<String> events = new CopyOnWriteArrayList<>();
        final List<JSONObject> messages = new CopyOnWriteArrayList<>();
        final CountDownLatch leaveLifecycle = new CountDownLatch(2);

        @Override
        public void send(String msg) {
            JSONObject payload = new JSONObject(msg);
            messages.add(payload);
            events.add("send:" + payload.getString("type"));
            leaveLifecycle.countDown();
        }

        @Override
        public void close() {
            events.add("close");
            leaveLifecycle.countDown();
        }
    }

    @Test
    void leave_sends_explicit_leave_before_close() throws Exception {
        RoomClient room = new RoomClient("http://localhost:8688", "game", "room-1", () -> "token");
        FakeRoomSocket fakeSocket = new FakeRoomSocket();
        room.attachSocketForTesting(fakeSocket, true, true, true);

        room.leave();
        assertTrue(fakeSocket.leaveLifecycle.await(1, TimeUnit.SECONDS));

        assertEquals(List.of("send:leave", "close"), fakeSocket.events);
        room.destroy();
    }

    @Test
    void unified_surface_parses_members_signals_and_session_frames() {
        RoomClient room = new RoomClient("http://localhost:8688", "game", "room-1", () -> "token");
        List<List<Map<String, Object>>> memberSyncSnapshots = new ArrayList<>();
        List<String> memberLeaves = new ArrayList<>();
        List<String> signalEvents = new ArrayList<>();
        List<String> connectionStates = new ArrayList<>();

        room.members.onSync(members -> memberSyncSnapshots.add(members));
        room.members.onLeave((member, reason) -> memberLeaves.add(member.get("memberId") + ":" + reason));
        room.signals.onAny((event, payload, meta) -> signalEvents.add(event + ":" + meta.get("userId")));
        room.session.onConnectionStateChange(connectionStates::add);

        room.handleRawForTesting("{\"type\":\"auth_success\",\"userId\":\"user-1\",\"connectionId\":\"conn-1\"}");
        room.handleRawForTesting("{\"type\":\"sync\",\"sharedState\":{\"topic\":\"focus\"},\"sharedVersion\":1,\"playerState\":{\"ready\":true},\"playerVersion\":2}");
        room.handleRawForTesting("{\"type\":\"members_sync\",\"members\":[{\"memberId\":\"user-1\",\"userId\":\"user-1\",\"connectionId\":\"conn-1\",\"connectionCount\":1,\"state\":{\"typing\":false}}]}");
        room.handleRawForTesting("{\"type\":\"member_join\",\"member\":{\"memberId\":\"user-2\",\"userId\":\"user-2\",\"connectionCount\":1,\"state\":{}}}");
        room.handleRawForTesting("{\"type\":\"signal\",\"event\":\"cursor.move\",\"payload\":{\"x\":10,\"y\":20},\"meta\":{\"memberId\":\"user-2\",\"userId\":\"user-2\",\"connectionId\":\"conn-2\",\"sentAt\":123}}");
        room.handleRawForTesting("{\"type\":\"member_leave\",\"member\":{\"memberId\":\"user-2\",\"userId\":\"user-2\",\"state\":{}},\"reason\":\"timeout\"}");

        assertEquals(Map.of("topic", "focus"), room.state.getShared());
        assertEquals(Map.of("ready", true), room.state.getMine());
        assertEquals("user-1", room.session.getUserId());
        assertEquals("conn-1", room.session.getConnectionId());
        assertEquals("connected", room.session.getConnectionState());
        assertEquals(List.of("connected"), connectionStates);
        assertEquals(1, memberSyncSnapshots.size());
        assertEquals("user-1", memberSyncSnapshots.get(0).get(0).get("memberId"));
        assertEquals(List.of("cursor.move:user-2"), signalEvents);
        assertEquals(List.of("user-2:timeout"), memberLeaves);
        assertEquals(1, room.members.list().size());
        assertEquals("user-1", room.members.list().get(0).get("memberId"));

        room.destroy();
    }

    @Test
    void unified_surface_sends_signal_member_and_admin_frames() {
        RoomClient room = new RoomClient("http://localhost:8688", "game", "room-1", () -> "token");
        FakeRoomSocket fakeSocket = new FakeRoomSocket();
        room.attachSocketForTesting(fakeSocket, true, true, true);
        room.handleRawForTesting("{\"type\":\"auth_success\",\"userId\":\"user-1\",\"connectionId\":\"conn-1\"}");

        var signalFuture = room.signals.send("cursor.move", Map.of("x", 10), Map.of("includeSelf", true));
        JSONObject signalMessage = fakeSocket.messages.get(0);
        assertEquals("signal", signalMessage.getString("type"));
        assertEquals("cursor.move", signalMessage.getString("event"));
        assertTrue(signalMessage.getBoolean("includeSelf"));
        String signalRequestId = signalMessage.getString("requestId");
        room.handleRawForTesting("{\"type\":\"signal_sent\",\"requestId\":\"" + signalRequestId + "\",\"event\":\"cursor.move\"}");
        signalFuture.join();

        var memberStateFuture = room.members.setState(new LinkedHashMap<>(Map.of("typing", true)));
        JSONObject memberStateMessage = fakeSocket.messages.get(1);
        assertEquals("member_state", memberStateMessage.getString("type"));
        assertTrue(memberStateMessage.getJSONObject("state").getBoolean("typing"));
        String memberStateRequestId = memberStateMessage.getString("requestId");
        room.handleRawForTesting("{\"type\":\"member_state\",\"requestId\":\"" + memberStateRequestId + "\",\"member\":{\"memberId\":\"user-1\",\"userId\":\"user-1\",\"state\":{\"typing\":true}},\"state\":{\"typing\":true}}");
        memberStateFuture.join();

        var adminFuture = room.admin.block("user-2");
        JSONObject adminMessage = fakeSocket.messages.get(2);
        assertEquals("admin", adminMessage.getString("type"));
        assertEquals("block", adminMessage.getString("operation"));
        assertEquals("user-2", adminMessage.getString("memberId"));
        String adminRequestId = adminMessage.getString("requestId");
        room.handleRawForTesting("{\"type\":\"admin_result\",\"requestId\":\"" + adminRequestId + "\",\"operation\":\"block\",\"memberId\":\"user-2\"}");
        adminFuture.join();

        assertEquals(List.of("send:signal", "send:member_state", "send:admin"), fakeSocket.events);

        room.destroy();
    }
}
