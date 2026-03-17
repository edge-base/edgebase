package dev.edgebase.sdk.core;

import org.json.JSONObject;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RoomClientLeaveTest {

    private static final class FakeRoomSocket implements RoomClient.RoomSocket {
        final List<String> events = new CopyOnWriteArrayList<>();
        final List<JSONObject> messages = new CopyOnWriteArrayList<>();

        @Override
        public void send(String msg) {
            JSONObject payload = new JSONObject(msg);
            messages.add(payload);
            events.add("send:" + payload.getString("type"));
        }

        @Override
        public void close() {
            events.add("close");
        }
    }

    @Test
    void leave_sends_explicit_leave_before_close() throws Exception {
        RoomClient room = new RoomClient("http://localhost:8688", "game", "room-1", () -> "token");
        FakeRoomSocket fakeSocket = new FakeRoomSocket();
        room.attachSocketForTesting(fakeSocket, true, true, true);

        room.leave();
        Thread.sleep(100L);

        assertEquals(List.of("send:leave", "close"), fakeSocket.events);
        room.destroy();
    }

    @Test
    void unified_surface_parses_members_signals_media_and_session_frames() {
        RoomClient room = new RoomClient("http://localhost:8688", "game", "room-1", () -> "token");
        List<List<Map<String, Object>>> memberSyncSnapshots = new ArrayList<>();
        List<String> memberLeaves = new ArrayList<>();
        List<String> signalEvents = new ArrayList<>();
        List<String> mediaTracks = new ArrayList<>();
        List<String> mediaDevices = new ArrayList<>();
        List<String> connectionStates = new ArrayList<>();

        room.members.onSync(members -> memberSyncSnapshots.add(members));
        room.members.onLeave((member, reason) -> memberLeaves.add(member.get("memberId") + ":" + reason));
        room.signals.onAny((event, payload, meta) -> signalEvents.add(event + ":" + meta.get("userId")));
        room.media.onTrack((track, member) -> mediaTracks.add(track.get("kind") + ":" + member.get("memberId")));
        room.media.onDeviceChange((member, change) -> mediaDevices.add(change.get("kind") + ":" + change.get("deviceId")));
        room.session.onConnectionStateChange(connectionStates::add);

        room.handleRawForTesting("{\"type\":\"auth_success\",\"userId\":\"user-1\",\"connectionId\":\"conn-1\"}");
        room.handleRawForTesting("{\"type\":\"sync\",\"sharedState\":{\"topic\":\"focus\"},\"sharedVersion\":1,\"playerState\":{\"ready\":true},\"playerVersion\":2}");
        room.handleRawForTesting("{\"type\":\"members_sync\",\"members\":[{\"memberId\":\"user-1\",\"userId\":\"user-1\",\"connectionId\":\"conn-1\",\"connectionCount\":1,\"state\":{\"typing\":false}}]}");
        room.handleRawForTesting("{\"type\":\"member_join\",\"member\":{\"memberId\":\"user-2\",\"userId\":\"user-2\",\"connectionCount\":1,\"state\":{}}}");
        room.handleRawForTesting("{\"type\":\"signal\",\"event\":\"cursor.move\",\"payload\":{\"x\":10,\"y\":20},\"meta\":{\"memberId\":\"user-2\",\"userId\":\"user-2\",\"connectionId\":\"conn-2\",\"sentAt\":123}}");
        room.handleRawForTesting("{\"type\":\"media_track\",\"member\":{\"memberId\":\"user-2\",\"userId\":\"user-2\",\"state\":{}},\"track\":{\"kind\":\"video\",\"trackId\":\"video-1\",\"deviceId\":\"cam-1\",\"muted\":false}}");
        room.handleRawForTesting("{\"type\":\"media_device\",\"member\":{\"memberId\":\"user-2\",\"userId\":\"user-2\",\"state\":{}},\"kind\":\"video\",\"deviceId\":\"cam-2\"}");
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
        assertEquals(List.of("video:user-2"), mediaTracks);
        assertEquals(List.of("video:cam-2"), mediaDevices);
        assertEquals(List.of("user-2:timeout"), memberLeaves);
        assertEquals(1, room.members.list().size());
        assertEquals("user-1", room.members.list().get(0).get("memberId"));
        assertEquals(0, room.media.list().size());

        room.destroy();
    }

    @Test
    void unified_surface_sends_signal_member_admin_and_media_frames() {
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

        var adminFuture = room.admin.disableVideo("user-2");
        JSONObject adminMessage = fakeSocket.messages.get(2);
        assertEquals("admin", adminMessage.getString("type"));
        assertEquals("disableVideo", adminMessage.getString("operation"));
        assertEquals("user-2", adminMessage.getString("memberId"));
        String adminRequestId = adminMessage.getString("requestId");
        room.handleRawForTesting("{\"type\":\"admin_result\",\"requestId\":\"" + adminRequestId + "\",\"operation\":\"disableVideo\",\"memberId\":\"user-2\"}");
        adminFuture.join();

        var mediaFuture = room.media.audio.setMuted(true);
        JSONObject mediaMessage = fakeSocket.messages.get(3);
        assertEquals("media", mediaMessage.getString("type"));
        assertEquals("mute", mediaMessage.getString("operation"));
        assertEquals("audio", mediaMessage.getString("kind"));
        assertTrue(mediaMessage.getJSONObject("payload").getBoolean("muted"));
        String mediaRequestId = mediaMessage.getString("requestId");
        room.handleRawForTesting("{\"type\":\"media_result\",\"requestId\":\"" + mediaRequestId + "\",\"operation\":\"mute\",\"kind\":\"audio\"}");
        mediaFuture.join();

        assertEquals(List.of("send:signal", "send:member_state", "send:admin", "send:media"), fakeSocket.events);

        room.destroy();
    }
}
