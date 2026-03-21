package dev.edgebase.sdk.core;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.json.JSONObject;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
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

    private static final class FakeCloudflareClientAdapter implements RoomClient.RoomCloudflareRealtimeKitClientAdapter {
        final List<RoomClient.RoomCloudflareParticipantListener> listeners = new CopyOnWriteArrayList<>();
        RoomClient.RoomCloudflareParticipantSnapshot localParticipant;
        List<RoomClient.RoomCloudflareParticipantSnapshot> joinedParticipants;
        boolean joinCalled;
        boolean leaveCalled;
        int enableAudioCalls;
        int enableVideoCalls;
        int enableScreenShareCalls;
        int disableAudioCalls;
        int disableVideoCalls;
        int disableScreenShareCalls;
        String selectedAudioDeviceId;
        String selectedVideoDeviceId;

        FakeCloudflareClientAdapter() {
            this(
                    participant("self-participant", "user-1", "Self User", false, false, false, "self-handle"),
                    new ArrayList<>()
            );
        }

        FakeCloudflareClientAdapter(
                RoomClient.RoomCloudflareParticipantSnapshot localParticipant,
                List<RoomClient.RoomCloudflareParticipantSnapshot> joinedParticipants
        ) {
            this.localParticipant = localParticipant;
            this.joinedParticipants = joinedParticipants;
        }

        @Override
        public CompletableFuture<Void> joinRoom() {
            joinCalled = true;
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public CompletableFuture<Void> leaveRoom() {
            leaveCalled = true;
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public CompletableFuture<Void> enableAudio() {
            enableAudioCalls += 1;
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public CompletableFuture<Void> disableAudio() {
            disableAudioCalls += 1;
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public CompletableFuture<Void> enableVideo() {
            enableVideoCalls += 1;
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public CompletableFuture<Void> disableVideo() {
            disableVideoCalls += 1;
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public CompletableFuture<Void> enableScreenShare() {
            enableScreenShareCalls += 1;
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public CompletableFuture<Void> disableScreenShare() {
            disableScreenShareCalls += 1;
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public CompletableFuture<Void> setAudioDevice(String deviceId) {
            selectedAudioDeviceId = deviceId;
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public CompletableFuture<Void> setVideoDevice(String deviceId) {
            selectedVideoDeviceId = deviceId;
            return CompletableFuture.completedFuture(null);
        }

        @Override
        public RoomClient.RoomCloudflareParticipantSnapshot getLocalParticipant() {
            return localParticipant;
        }

        @Override
        public List<RoomClient.RoomCloudflareParticipantSnapshot> getJoinedParticipants() {
            return joinedParticipants;
        }

        @Override
        public Object buildView(RoomClient.RoomCloudflareParticipantSnapshot participant, String kind, boolean isSelf) {
            if ("audio".equals(kind)) {
                return null;
            }
            return isSelf ? "view:self:" + kind : "view:" + participant.getId() + ":" + kind;
        }

        @Override
        public void addListener(RoomClient.RoomCloudflareParticipantListener listener) {
            listeners.add(listener);
        }

        @Override
        public void removeListener(RoomClient.RoomCloudflareParticipantListener listener) {
            listeners.remove(listener);
        }

        void emitAudio(RoomClient.RoomCloudflareParticipantSnapshot participant, boolean enabled) {
            for (RoomClient.RoomCloudflareParticipantListener listener : List.copyOf(listeners)) {
                listener.onAudioUpdate(participant, enabled);
            }
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

    @Test
    void cloudflareRealtimeKitCreateSession_hits_provider_endpoint() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.setExecutor(Executors.newSingleThreadExecutor());
        server.createContext("/api/room/media/cloudflare_realtimekit/session", exchange -> {
            assertEquals("POST", exchange.getRequestMethod());
            assertEquals("Bearer token", exchange.getRequestHeaders().getFirst("Authorization"));
            assertEquals("media", exchange.getRequestURI().getQuery().contains("namespace=media") ? "media" : null);
            assertEquals("room-1", exchange.getRequestURI().getQuery().contains("id=room-1") ? "room-1" : null);

            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            JSONObject payload = new JSONObject(body);
            assertEquals("Java User", payload.getString("name"));
            assertEquals("java-user-1", payload.getString("customParticipantId"));

            writeResponse(exchange, 200, "{\"sessionId\":\"session-1\",\"meetingId\":\"meeting-1\",\"participantId\":\"participant-1\",\"authToken\":\"auth-token-1\",\"presetName\":\"default\"}");
        });
        server.start();
        try {
            String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
            RoomClient room = new RoomClient(baseUrl, "media", "room-1", () -> "token");
            Map<String, Object> result = room.media.cloudflareRealtimeKit.createSession(
                    Map.of("name", "Java User", "customParticipantId", "java-user-1")
            ).join();

            assertEquals("session-1", result.get("sessionId"));
            assertEquals("meeting-1", result.get("meetingId"));
            assertEquals("participant-1", result.get("participantId"));
            assertEquals("auth-token-1", result.get("authToken"));
            assertEquals("default", result.get("presetName"));

            room.destroy();
        } finally {
            server.stop(0);
        }
    }

    @Test
    void cloudflareRealtimeKitTransport_connects_and_emits_remote_tracks() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.setExecutor(Executors.newSingleThreadExecutor());
        server.createContext("/api/room/media/cloudflare_realtimekit/session", exchange -> {
            assertEquals("POST", exchange.getRequestMethod());
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            JSONObject payload = new JSONObject(body);
            assertEquals("Java User", payload.getString("name"));
            assertEquals("java-user-1", payload.getString("customParticipantId"));
            writeResponse(exchange, 200, "{\"sessionId\":\"session-2\",\"meetingId\":\"meeting-2\",\"participantId\":\"participant-2\",\"authToken\":\"auth-token-2\",\"presetName\":\"default\"}");
        });
        server.start();
        try {
            String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
            RoomClient room = new RoomClient(baseUrl, "media", "room-1", () -> "token");
            FakeCloudflareClientAdapter fakeClient = new FakeCloudflareClientAdapter(
                    participant("self-participant", "user-1", "Self User", false, false, false, "self-handle"),
                    List.of(participant("remote-1", "user-2", "Remote User", false, true, false, "participant:remote-1"))
            );
            RoomClient.RoomMediaTransport transport = room.media.transport(
                    new RoomClient.RoomMediaTransportOptions()
                            .setCloudflareRealtimeKit(
                                    new RoomClient.RoomCloudflareRealtimeKitTransportOptions()
                                            .setClientFactory(options -> {
                                                assertEquals("auth-token-2", options.getAuthToken());
                                                assertEquals("Java User", options.getDisplayName());
                                                assertEquals("dyte.io", options.getBaseDomain());
                                                return CompletableFuture.completedFuture(fakeClient);
                                            })
                            )
            );

            List<RoomClient.RoomMediaRemoteTrackEvent> remoteEvents = new ArrayList<>();
            transport.onRemoteTrack(remoteEvents::add);

            String sessionId = transport.connect(Map.of(
                    "name", "Java User",
                    "customParticipantId", "java-user-1"
            )).join();

            assertEquals("session-2", sessionId);
            assertTrue(fakeClient.joinCalled);
            assertEquals(1, remoteEvents.size());
            assertEquals("video", remoteEvents.get(0).getKind());
            assertEquals("remote-1", remoteEvents.get(0).getParticipantId());
            assertEquals("view:remote-1:video", remoteEvents.get(0).getView());

            transport.destroy();
            assertTrue(fakeClient.leaveCalled);
            room.destroy();
        } finally {
            server.stop(0);
        }
    }

    @Test
    void cloudflareRealtimeKitTransport_forwards_local_media_operations() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress(0), 0);
        server.setExecutor(Executors.newSingleThreadExecutor());
        server.createContext("/api/room/media/cloudflare_realtimekit/session", exchange -> {
            writeResponse(exchange, 200, "{\"sessionId\":\"session-3\",\"meetingId\":\"meeting-3\",\"participantId\":\"participant-3\",\"authToken\":\"auth-token-3\",\"presetName\":\"default\"}");
        });
        server.start();
        try {
            String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
            RoomClient room = new RoomClient(baseUrl, "media", "room-1", () -> "token");
            FakeRoomSocket fakeSocket = new FakeRoomSocket();
            room.attachSocketForTesting(fakeSocket, true, true, true);

            FakeCloudflareClientAdapter fakeClient = new FakeCloudflareClientAdapter();
            RoomClient.RoomMediaTransport transport = room.media.transport(
                    new RoomClient.RoomMediaTransportOptions()
                            .setCloudflareRealtimeKit(
                                    new RoomClient.RoomCloudflareRealtimeKitTransportOptions()
                                            .setClientFactory(options -> CompletableFuture.completedFuture(fakeClient))
                            )
            );

            transport.connect(Map.of("name", "Java User")).join();

            CompletableFuture<Object> audioFuture = transport.enableAudio(Map.of("deviceId", "mic-1"));
            JSONObject audioFrame = fakeSocket.messages.get(0);
            assertEquals("media", audioFrame.getString("type"));
            assertEquals("publish", audioFrame.getString("operation"));
            assertEquals("audio", audioFrame.getString("kind"));
            assertEquals("participant-3", audioFrame.getJSONObject("payload").getString("providerSessionId"));
            room.handleRawForTesting("{\"type\":\"media_result\",\"requestId\":\"" + audioFrame.getString("requestId") + "\",\"operation\":\"publish\",\"kind\":\"audio\"}");
            assertEquals("self-handle", audioFuture.join());

            CompletableFuture<Object> videoFuture = transport.enableVideo(Map.of("deviceId", "cam-1"));
            JSONObject videoFrame = fakeSocket.messages.get(1);
            assertEquals("video", videoFrame.getString("kind"));
            room.handleRawForTesting("{\"type\":\"media_result\",\"requestId\":\"" + videoFrame.getString("requestId") + "\",\"operation\":\"publish\",\"kind\":\"video\"}");
            assertEquals("view:self:video", videoFuture.join());

            CompletableFuture<Void> switchFuture = transport.switchDevices(Map.of(
                    "audioInputId", "mic-2",
                    "videoInputId", "cam-2"
            ));
            JSONObject audioDeviceFrame = fakeSocket.messages.get(2);
            JSONObject videoDeviceFrame = fakeSocket.messages.get(3);
            room.handleRawForTesting("{\"type\":\"media_result\",\"requestId\":\"" + audioDeviceFrame.getString("requestId") + "\",\"operation\":\"device\",\"kind\":\"audio\"}");
            room.handleRawForTesting("{\"type\":\"media_result\",\"requestId\":\"" + videoDeviceFrame.getString("requestId") + "\",\"operation\":\"device\",\"kind\":\"video\"}");
            switchFuture.join();

            assertEquals(1, fakeClient.enableAudioCalls);
            assertEquals(1, fakeClient.enableVideoCalls);
            assertEquals("mic-2", fakeClient.selectedAudioDeviceId);
            assertEquals("cam-2", fakeClient.selectedVideoDeviceId);

            transport.destroy();
            room.destroy();
        } finally {
            server.stop(0);
        }
    }

    @Test
    void p2p_transport_uses_registered_factory_when_available() {
        RoomClient room = new RoomClient("http://localhost:8688", "game", "room-1", () -> "token");
        AtomicReference<RoomClient.RoomP2PMediaTransportOptions> capturedOptions = new AtomicReference<>();
        RoomClient.RoomMediaTransport fakeTransport = new RoomClient.RoomMediaTransport() {
            @Override
            public CompletableFuture<String> connect(Map<String, Object> payload) {
                return CompletableFuture.completedFuture("member-self");
            }

            @Override
            public CompletableFuture<Object> enableAudio(Map<String, Object> payload) {
                return CompletableFuture.completedFuture(null);
            }

            @Override
            public CompletableFuture<Object> enableVideo(Map<String, Object> payload) {
                return CompletableFuture.completedFuture(null);
            }

            @Override
            public CompletableFuture<Object> startScreenShare(Map<String, Object> payload) {
                return CompletableFuture.completedFuture(null);
            }

            @Override
            public CompletableFuture<Void> disableAudio() {
                return CompletableFuture.completedFuture(null);
            }

            @Override
            public CompletableFuture<Void> disableVideo() {
                return CompletableFuture.completedFuture(null);
            }

            @Override
            public CompletableFuture<Void> stopScreenShare() {
                return CompletableFuture.completedFuture(null);
            }

            @Override
            public CompletableFuture<Void> setMuted(String kind, boolean muted) {
                return CompletableFuture.completedFuture(null);
            }

            @Override
            public CompletableFuture<Void> switchDevices(Map<String, Object> payload) {
                return CompletableFuture.completedFuture(null);
            }

            @Override
            public RoomClient.Subscription onRemoteTrack(java.util.function.Consumer<RoomClient.RoomMediaRemoteTrackEvent> handler) {
                return () -> {};
            }

            @Override
            public String getSessionId() {
                return "member-self";
            }

            @Override
            public Object getPeerConnection() {
                return null;
            }

            @Override
            public void destroy() {
            }
        };

        RoomClient.setDefaultP2PMediaTransportFactory((client, options) -> {
            capturedOptions.set(options);
            return fakeTransport;
        });

        try {
            RoomClient.RoomMediaTransport transport = room.media.transport(
                    new RoomClient.RoomMediaTransportOptions()
                            .setProvider(RoomClient.RoomMediaTransportProvider.P2P)
                            .setP2P(new RoomClient.RoomP2PMediaTransportOptions().setSignalPrefix("edgebase.custom.p2p"))
            );

            assertSame(fakeTransport, transport);
            assertEquals("edgebase.custom.p2p", capturedOptions.get().getSignalPrefix());
        } finally {
            RoomClient.setDefaultP2PMediaTransportFactory(null);
            room.destroy();
        }
    }

    private static void writeResponse(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }

    private static RoomClient.RoomCloudflareParticipantSnapshot participant(
            String id,
            String userId,
            String name,
            boolean audioEnabled,
            boolean videoEnabled,
            boolean screenShareEnabled,
            Object handle
    ) {
        return new RoomClient.RoomCloudflareParticipantSnapshot(
                id,
                userId,
                name,
                null,
                null,
                audioEnabled,
                videoEnabled,
                screenShareEnabled,
                handle
        );
    }
}
