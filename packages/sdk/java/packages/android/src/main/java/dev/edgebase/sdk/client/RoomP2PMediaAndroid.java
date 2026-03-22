package dev.edgebase.sdk.client;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;

import dev.edgebase.sdk.core.RoomClient;

import java.lang.reflect.Array;
import java.lang.reflect.Constructor;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;

final class RoomP2PMediaAndroid {
    private static final String DOCS_URL = "https://edgebase.fun/docs/room/media";
    private static final String DEFAULT_SIGNAL_PREFIX = "edgebase.media.p2p";
    private static final List<String> DEFAULT_ICE_SERVERS = List.of("stun:stun.l.google.com:19302");
    private static volatile boolean installed = false;

    private RoomP2PMediaAndroid() {
    }

    static void maybeRegisterDefaultTransportFactory() {
        if (installed || !isRuntimeAvailable()) {
            return;
        }

        synchronized (RoomP2PMediaAndroid.class) {
            if (installed || !isRuntimeAvailable()) {
                return;
            }
            RoomClient.setDefaultP2PMediaTransportFactory(AndroidRoomP2PMediaTransport::new);
            installed = true;
        }
    }

    private static boolean isRuntimeAvailable() {
        return hasClass("realtimekit.org.webrtc.PeerConnectionFactory")
                && hasClass("realtimekit.org.webrtc.PeerConnection")
                && hasClass("realtimekit.org.webrtc.Camera2Enumerator")
                && hasClass("realtimekit.org.webrtc.SurfaceTextureHelper");
    }

    private static boolean hasClass(String className) {
        try {
            Class.forName(className);
            return true;
        } catch (Throwable ignored) {
            return false;
        }
    }

    private static final class AndroidRoomP2PMediaTransport implements RoomClient.RoomMediaTransport {
        private final RoomClient room;
        private final RoomClient.RoomP2PMediaTransportOptions options;
        private final WebRtcRuntime runtime = new WebRtcRuntime();
        private final Map<String, LocalTrackState> localTracks = new ConcurrentHashMap<>();
        private final Map<String, PeerState> peers = new ConcurrentHashMap<>();
        private final Map<String, PendingRemoteTrack> pendingRemoteTracks = new ConcurrentHashMap<>();
        private final Map<String, String> remoteTrackKinds = new ConcurrentHashMap<>();
        private final Set<String> emittedRemoteTracks = ConcurrentHashMap.newKeySet();
        private final Map<String, Consumer<RoomClient.RoomMediaRemoteTrackEvent>> remoteTrackHandlers =
                new ConcurrentHashMap<>();
        private final List<RoomClient.Subscription> subscriptions = new CopyOnWriteArrayList<>();
        private volatile String localMemberId;
        private volatile boolean connected;

        private AndroidRoomP2PMediaTransport(
                RoomClient room,
                RoomClient.RoomP2PMediaTransportOptions options
        ) {
            this.room = room;
            this.options = options == null ? new RoomClient.RoomP2PMediaTransportOptions() : options;
        }

        @Override
        public CompletableFuture<String> connect(Map<String, Object> payload) {
            return CompletableFuture.supplyAsync(() -> {
                if (connected && localMemberId != null) {
                    return localMemberId;
                }
                if (payload != null && payload.containsKey("sessionDescription")) {
                    throw new IllegalArgumentException(
                            "RoomP2PMediaTransport.connect() does not accept sessionDescription. " +
                                    "Use room.signals through the built-in transport instead."
                    );
                }

                runtime.ensureInitialized();
                Map<String, Object> currentMember = waitForCurrentMember();
                if (currentMember == null) {
                    throw new IllegalStateException("Join the room before connecting a P2P media transport.");
                }

                localMemberId = stringValue(currentMember.get("memberId"));
                if (localMemberId == null || localMemberId.isBlank()) {
                    throw new IllegalStateException("Current room member is missing memberId.");
                }

                connected = true;
                hydrateRemoteTrackKinds();
                attachRoomSubscriptions();

                try {
                    for (Map<String, Object> member : room.members.list()) {
                        String memberId = stringValue(member.get("memberId"));
                        if (memberId != null && !memberId.equals(localMemberId)) {
                            ensurePeer(memberId);
                        }
                    }
                } catch (RuntimeException error) {
                    rollbackConnectedState();
                    throw error;
                }

                return localMemberId;
            });
        }

        @Override
        public CompletableFuture<Object> enableAudio(Map<String, Object> payload) {
            return CompletableFuture.supplyAsync(() -> {
                CapturedTrack captured = runtime.captureAudioTrack(resolveDeviceId(payload, "deviceId"));
                String providerSessionId = ensureConnectedMemberId().join();
                rememberLocalTrack("audio", captured);

                LinkedHashMap<String, Object> nextPayload = payload == null ? new LinkedHashMap<>() : new LinkedHashMap<>(payload);
                nextPayload.put("trackId", runtime.trackId(captured.track));
                if (captured.deviceId != null) {
                    nextPayload.put("deviceId", captured.deviceId);
                }
                nextPayload.put("providerSessionId", providerSessionId);

                room.media.audio.enable(nextPayload).join();
                syncAllPeerSenders();
                return captured.track;
            });
        }

        @Override
        public CompletableFuture<Object> enableVideo(Map<String, Object> payload) {
            return CompletableFuture.supplyAsync(() -> {
                CapturedTrack captured = runtime.captureVideoTrack(resolveDeviceId(payload, "deviceId"));
                String providerSessionId = ensureConnectedMemberId().join();
                rememberLocalTrack("video", captured);

                LinkedHashMap<String, Object> nextPayload = payload == null ? new LinkedHashMap<>() : new LinkedHashMap<>(payload);
                nextPayload.put("trackId", runtime.trackId(captured.track));
                if (captured.deviceId != null) {
                    nextPayload.put("deviceId", captured.deviceId);
                }
                nextPayload.put("providerSessionId", providerSessionId);

                room.media.video.enable(nextPayload).join();
                syncAllPeerSenders();
                return captured.track;
            });
        }

        @Override
        public CompletableFuture<Object> startScreenShare(Map<String, Object> payload) {
            return CompletableFuture.supplyAsync(() -> {
                Intent screenCaptureIntent = payload != null && payload.get("screenCaptureIntent") instanceof Intent intent
                        ? intent
                        : null;
                if (screenCaptureIntent == null) {
                    throw new IllegalStateException(
                            "Java Android P2P screen sharing requires payload.screenCaptureIntent. See " + DOCS_URL
                    );
                }

                CapturedTrack captured = runtime.captureScreenTrack(screenCaptureIntent);
                String providerSessionId = ensureConnectedMemberId().join();
                rememberLocalTrack("screen", captured);

                LinkedHashMap<String, Object> nextPayload = payload == null ? new LinkedHashMap<>() : new LinkedHashMap<>(payload);
                nextPayload.put("trackId", runtime.trackId(captured.track));
                nextPayload.put("providerSessionId", providerSessionId);

                room.media.screen.start(nextPayload).join();
                syncAllPeerSenders();
                return captured.track;
            });
        }

        @Override
        public CompletableFuture<Void> disableAudio() {
            return CompletableFuture.runAsync(() -> {
                releaseLocalTrack("audio");
                syncAllPeerSenders();
                room.media.audio.disable().join();
            });
        }

        @Override
        public CompletableFuture<Void> disableVideo() {
            return CompletableFuture.runAsync(() -> {
                releaseLocalTrack("video");
                syncAllPeerSenders();
                room.media.video.disable().join();
            });
        }

        @Override
        public CompletableFuture<Void> stopScreenShare() {
            return CompletableFuture.runAsync(() -> {
                releaseLocalTrack("screen");
                syncAllPeerSenders();
                room.media.screen.stop().join();
            });
        }

        @Override
        public CompletableFuture<Void> setMuted(String kind, boolean muted) {
            return CompletableFuture.runAsync(() -> {
                LocalTrackState localTrack = localTracks.get(kind);
                if (localTrack != null) {
                    runtime.setTrackEnabled(localTrack.captured.track, !muted);
                }

                if ("audio".equals(kind)) {
                    room.media.audio.setMuted(muted).join();
                } else if ("video".equals(kind)) {
                    room.media.video.setMuted(muted).join();
                } else {
                    throw new UnsupportedOperationException("Unsupported mute kind: " + kind);
                }
            });
        }

        @Override
        public CompletableFuture<Void> switchDevices(Map<String, Object> payload) {
            return CompletableFuture.runAsync(() -> {
                boolean changed = false;
                String nextVideoInput = payload == null ? null : stringValue(payload.get("videoInputId"));
                if (nextVideoInput != null && localTracks.containsKey("video")) {
                    rememberLocalTrack("video", runtime.captureVideoTrack(nextVideoInput));
                    changed = true;
                }

                if (changed) {
                    syncAllPeerSenders();
                }
                room.media.devices.switchInputs(payload == null ? Map.of() : payload).join();
            });
        }

        @Override
        public RoomClient.Subscription onRemoteTrack(Consumer<RoomClient.RoomMediaRemoteTrackEvent> handler) {
            String key = UUID.randomUUID().toString();
            remoteTrackHandlers.put(key, handler);
            return () -> remoteTrackHandlers.remove(key);
        }

        @Override
        public String getSessionId() {
            return localMemberId;
        }

        @Override
        public Object getPeerConnection() {
            if (peers.size() != 1) {
                return null;
            }
            return peers.values().iterator().next().pc;
        }

        @Override
        public void destroy() {
            connected = false;
            localMemberId = null;
            subscriptions.forEach(RoomClient.Subscription::unsubscribe);
            subscriptions.clear();
            peers.values().forEach(this::destroyPeer);
            peers.clear();
            new ArrayList<>(localTracks.keySet()).forEach(this::releaseLocalTrack);
            pendingRemoteTracks.clear();
            remoteTrackKinds.clear();
            emittedRemoteTracks.clear();
            runtime.release();
        }

        private void attachRoomSubscriptions() {
            if (!subscriptions.isEmpty()) {
                return;
            }

            subscriptions.add(room.members.onJoin(member -> {
                String memberId = stringValue(member.get("memberId"));
                if (memberId != null && !memberId.equals(localMemberId)) {
                    CompletableFuture.runAsync(() -> ensurePeer(memberId));
                }
            }));
            subscriptions.add(room.members.onSync(members -> {
                Set<String> activeMemberIds = ConcurrentHashMap.newKeySet();
                for (Map<String, Object> member : members) {
                    String memberId = stringValue(member.get("memberId"));
                    if (memberId != null && !memberId.equals(localMemberId)) {
                        activeMemberIds.add(memberId);
                        CompletableFuture.runAsync(() -> ensurePeer(memberId));
                    }
                }
                for (String memberId : new ArrayList<>(peers.keySet())) {
                    if (!activeMemberIds.contains(memberId)) {
                        removeRemoteMember(memberId);
                    }
                }
            }));
            subscriptions.add(room.members.onLeave((member, reason) -> {
                String memberId = stringValue(member.get("memberId"));
                if (memberId == null) {
                    return;
                }
                removeRemoteMember(memberId);
            }));
            subscriptions.add(room.signals.on(offerEvent(), (payload, meta) ->
                    CompletableFuture.runAsync(() -> handleDescriptionSignal("offer", payload, meta))));
            subscriptions.add(room.signals.on(answerEvent(), (payload, meta) ->
                    CompletableFuture.runAsync(() -> handleDescriptionSignal("answer", payload, meta))));
            subscriptions.add(room.signals.on(iceEvent(), (payload, meta) ->
                    CompletableFuture.runAsync(() -> handleIceSignal(payload, meta))));
            subscriptions.add(room.media.onTrack((track, member) -> {
                String memberId = stringValue(member.get("memberId"));
                if (memberId != null && !memberId.equals(localMemberId)) {
                    CompletableFuture.runAsync(() -> ensurePeer(memberId));
                }
                rememberRemoteTrackKind(track, member);
            }));
            subscriptions.add(room.media.onTrackRemoved((track, member) -> {
                String memberId = stringValue(member.get("memberId"));
                String trackId = stringValue(track.get("trackId"));
                if (memberId == null || trackId == null) {
                    return;
                }
                String key = buildTrackKey(memberId, trackId);
                remoteTrackKinds.remove(key);
                emittedRemoteTracks.remove(key);
                pendingRemoteTracks.remove(key);
            }));
        }

        private Map<String, Object> waitForCurrentMember() {
            long timeoutMs = Math.max(0L, options.getCurrentMemberTimeoutMs());
            long startedAt = System.currentTimeMillis();
            while (System.currentTimeMillis() - startedAt < timeoutMs) {
                Map<String, Object> current = currentMember();
                if (current != null) {
                    return current;
                }
                try {
                    Thread.sleep(50L);
                } catch (InterruptedException error) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
            return currentMember();
        }

        private Map<String, Object> currentMember() {
            String userId = room.session.getUserId();
            if (userId == null || userId.isBlank()) {
                return null;
            }
            String connectionId = room.session.getConnectionId();
            if (connectionId != null) {
                for (Map<String, Object> member : room.members.list()) {
                    String memberUserId = stringValue(member.get("userId"));
                    String memberConnectionId = stringValue(member.get("connectionId"));
                    if (Objects.equals(memberUserId, userId) && Objects.equals(connectionId, memberConnectionId)) {
                        return member;
                    }
                }
            }
            for (Map<String, Object> member : room.members.list()) {
                String memberUserId = stringValue(member.get("userId"));
                if (Objects.equals(memberUserId, userId)) {
                    return member;
                }
            }
            return null;
        }

        private synchronized PeerState ensurePeer(String memberId) {
            PeerState existing = peers.get(memberId);
            if (existing != null) {
                syncPeerSenders(existing);
                return existing;
            }

            final PeerState[] holder = new PeerState[1];
            Object peerConnection = runtime.createPeerConnection(options, new PeerCallbacks() {
                @Override
                public void onIceCandidate(Map<String, Object> candidate) {
                    if (stringValue(candidate.get("candidate")) == null
                            || stringValue(candidate.get("candidate")).isBlank()) {
                        return;
                    }
                    room.signals.sendTo(memberId, iceEvent(), Map.of("candidate", candidate));
                }

                @Override
                public void onNegotiationNeeded() {
                    PeerState currentPeer = holder[0];
                    if (currentPeer != null) {
                        CompletableFuture.runAsync(() -> negotiatePeer(currentPeer));
                    }
                }

                @Override
                public void onTrack(Object track) {
                    String key = buildTrackKey(memberId, runtime.trackId(track));
                    String exactKind = remoteTrackKinds.get(key);
                    String fallbackKind = exactKind == null ? resolveFallbackRemoteTrackKind(memberId, track) : null;
                    String kind = exactKind != null ? exactKind : fallbackKind;
                    if (kind == null) {
                        String normalized = runtime.normalizeTrackKind(track);
                        if (!"audio".equals(normalized)) {
                            pendingRemoteTracks.put(key, new PendingRemoteTrack(memberId, track));
                            return;
                        }
                        kind = normalized;
                    }
                    emitRemoteTrack(memberId, track, kind);
                }
            });

            PeerState peer = new PeerState(
                    memberId,
                    peerConnection,
                    localMemberId != null && localMemberId.compareTo(memberId) > 0
            );
            holder[0] = peer;

            peers.put(memberId, peer);
            syncPeerSenders(peer);
            return peer;
        }

        private void negotiatePeer(PeerState peer) {
            if (!connected
                    || "closed".equals(runtime.connectionState(peer.pc))
                    || peer.makingOffer
                    || peer.isSettingRemoteAnswerPending
                    || !"stable".equals(runtime.signalingState(peer.pc))) {
                return;
            }

            try {
                peer.makingOffer = true;
                SessionDescriptionPayload offer = runtime.createOffer(peer.pc);
                runtime.setLocalDescription(peer.pc, offer);
                room.signals.sendTo(
                        peer.memberId,
                        offerEvent(),
                        Map.of("description", Map.of("type", offer.type, "sdp", offer.sdp))
                );
            } finally {
                peer.makingOffer = false;
            }
        }

        private void handleDescriptionSignal(
                String expectedType,
                Object payload,
                Map<String, Object> meta
        ) {
            String senderId = stringValue(meta.get("memberId"));
            if (senderId == null || senderId.isBlank() || senderId.equals(localMemberId)) {
                return;
            }

            SessionDescriptionPayload description = normalizeDescription(payload);
            if (description == null || !expectedType.equals(description.type)) {
                return;
            }

            PeerState peer = ensurePeer(senderId);
            boolean readyForOffer = !peer.makingOffer
                    && ("stable".equals(runtime.signalingState(peer.pc)) || peer.isSettingRemoteAnswerPending);
            boolean offerCollision = "offer".equals(description.type) && !readyForOffer;
            peer.ignoreOffer = !peer.polite && offerCollision;
            if (peer.ignoreOffer) {
                return;
            }

            try {
                peer.isSettingRemoteAnswerPending = "answer".equals(description.type);
                runtime.setRemoteDescription(peer.pc, description);
                peer.isSettingRemoteAnswerPending = false;
                flushPendingCandidates(peer);

                if ("offer".equals(description.type)) {
                    syncPeerSenders(peer);
                    SessionDescriptionPayload answer = runtime.createAnswer(peer.pc);
                    runtime.setLocalDescription(peer.pc, answer);
                    room.signals.sendTo(
                            senderId,
                            answerEvent(),
                            Map.of("description", Map.of("type", answer.type, "sdp", answer.sdp))
                    );
                }
            } catch (Throwable error) {
                peer.isSettingRemoteAnswerPending = false;
                throw error instanceof RuntimeException runtimeError
                        ? runtimeError
                        : new IllegalStateException(error);
            }
        }

        private void handleIceSignal(Object payload, Map<String, Object> meta) {
            String senderId = stringValue(meta.get("memberId"));
            if (senderId == null || senderId.isBlank() || senderId.equals(localMemberId)) {
                return;
            }

            Map<String, Object> candidate = normalizeIceCandidate(payload);
            if (candidate == null) {
                return;
            }

            PeerState peer = ensurePeer(senderId);
            if (runtime.getRemoteDescription(peer.pc) == null) {
                peer.pendingCandidates.add(candidate);
                return;
            }

            boolean added = runtime.addIceCandidate(peer.pc, candidate);
            if (!added && !peer.ignoreOffer) {
                peer.pendingCandidates.add(candidate);
            }
        }

        private void flushPendingCandidates(PeerState peer) {
            if (runtime.getRemoteDescription(peer.pc) == null || peer.pendingCandidates.isEmpty()) {
                return;
            }
            List<Map<String, Object>> pending = new ArrayList<>(peer.pendingCandidates);
            peer.pendingCandidates.clear();
            for (Map<String, Object> candidate : pending) {
                boolean added = runtime.addIceCandidate(peer.pc, candidate);
                if (!added && !peer.ignoreOffer) {
                    peer.pendingCandidates.add(candidate);
                }
            }
        }

        private void syncAllPeerSenders() {
            for (PeerState peer : new ArrayList<>(peers.values())) {
                syncPeerSenders(peer);
            }
        }

        private void syncPeerSenders(PeerState peer) {
            Set<String> activeKinds = ConcurrentHashMap.newKeySet();
            boolean changed = false;

            for (Map.Entry<String, LocalTrackState> entry : localTracks.entrySet()) {
                String kind = entry.getKey();
                LocalTrackState localTrack = entry.getValue();
                activeKinds.add(kind);
                Object sender = peer.senders.get(kind);
                if (sender != null) {
                    if (!Objects.equals(
                            runtime.trackId(runtime.senderTrack(sender)),
                            runtime.trackId(localTrack.captured.track)
                    )) {
                        runtime.replaceTrack(sender, localTrack.captured.track);
                        changed = true;
                    }
                } else {
                    peer.senders.put(kind, runtime.addTrack(peer.pc, localTrack.captured.track));
                    changed = true;
                }
            }

            for (Map.Entry<String, Object> entry : new ArrayList<>(peer.senders.entrySet())) {
                if (activeKinds.contains(entry.getKey())) {
                    continue;
                }
                runtime.removeTrack(peer.pc, entry.getValue());
                peer.senders.remove(entry.getKey());
                changed = true;
            }

            if (changed) {
                CompletableFuture.runAsync(() -> negotiatePeer(peer));
            }
        }

        private void hydrateRemoteTrackKinds() {
            remoteTrackKinds.clear();
            emittedRemoteTracks.clear();
            pendingRemoteTracks.clear();

            for (Map<String, Object> mediaMember : room.media.list()) {
                Map<String, Object> member = mapValue(mediaMember.get("member"));
                Object rawTracks = mediaMember.get("tracks");
                if (!(rawTracks instanceof List<?> tracks)) {
                    continue;
                }
                for (Object rawTrack : tracks) {
                    if (rawTrack instanceof Map<?, ?> track) {
                        @SuppressWarnings("unchecked")
                        Map<String, Object> castTrack = (Map<String, Object>) track;
                        rememberRemoteTrackKind(castTrack, member);
                    }
                }
            }
        }

        private void rememberRemoteTrackKind(Map<String, Object> track, Map<String, Object> member) {
            String trackId = stringValue(track.get("trackId"));
            String memberId = stringValue(member.get("memberId"));
            String kind = stringValue(track.get("kind"));
            if (trackId == null || memberId == null || kind == null || memberId.equals(localMemberId)) {
                return;
            }

            String key = buildTrackKey(memberId, trackId);
            remoteTrackKinds.put(key, kind);
            PendingRemoteTrack pending = pendingRemoteTracks.remove(key);
            if (pending != null) {
                emitRemoteTrack(memberId, pending.track, kind);
                return;
            }
            flushPendingRemoteTracks(memberId, kind);
        }

        private void emitRemoteTrack(String memberId, Object track, String kind) {
            String trackId = runtime.trackId(track);
            String key = buildTrackKey(memberId, trackId);
            if (!emittedRemoteTracks.add(key)) {
                return;
            }

            remoteTrackKinds.put(key, kind);
            Map<String, Object> participant = findMember(memberId);
            RoomClient.RoomMediaRemoteTrackEvent event = new RoomClient.RoomMediaRemoteTrackEvent(
                    kind,
                    track,
                    null,
                    trackId,
                    memberId,
                    memberId,
                    stringValue(participant.get("customParticipantId")),
                    stringValue(participant.get("userId")),
                    participant
            );
            for (Consumer<RoomClient.RoomMediaRemoteTrackEvent> handler : remoteTrackHandlers.values()) {
                handler.accept(event);
            }
        }

        private String resolveFallbackRemoteTrackKind(String memberId, Object track) {
            String normalized = runtime.normalizeTrackKind(track);
            if ("audio".equals(normalized)) {
                return normalized;
            }
            return getNextUnassignedPublishedVideoLikeKind(memberId);
        }

        private void flushPendingRemoteTracks(String memberId, String roomKind) {
            String expectedKind = "audio".equals(roomKind) ? "audio" : "video";
            for (Map.Entry<String, PendingRemoteTrack> entry : new ArrayList<>(pendingRemoteTracks.entrySet())) {
                PendingRemoteTrack pending = entry.getValue();
                if (!Objects.equals(pending.memberId, memberId)) {
                    continue;
                }
                if (!Objects.equals(runtime.normalizeTrackKind(pending.track), expectedKind)) {
                    continue;
                }
                pendingRemoteTracks.remove(entry.getKey());
                emitRemoteTrack(memberId, pending.track, roomKind);
                return;
            }
        }

        private List<String> getPublishedVideoLikeKinds(String memberId) {
            for (Map<String, Object> mediaMember : room.media.list()) {
                Map<String, Object> member = mapValue(mediaMember.get("member"));
                if (!Objects.equals(stringValue(member.get("memberId")), memberId)) {
                    continue;
                }
                Object rawTracks = mediaMember.get("tracks");
                if (!(rawTracks instanceof List<?> tracks)) {
                    return List.of();
                }
                List<String> kinds = new ArrayList<>();
                for (Object rawTrack : tracks) {
                    if (!(rawTrack instanceof Map<?, ?> track)) {
                        continue;
                    }
                    String kind = stringValue(track.get("kind"));
                    if (("video".equals(kind) || "screen".equals(kind))
                            && track.get("trackId") != null
                            && !kinds.contains(kind)) {
                        kinds.add(kind);
                    }
                }
                return kinds;
            }
            return List.of();
        }

        private String getNextUnassignedPublishedVideoLikeKind(String memberId) {
            List<String> publishedKinds = getPublishedVideoLikeKinds(memberId);
            if (publishedKinds.isEmpty()) {
                return null;
            }

            Set<String> assignedKinds = new LinkedHashSet<>();
            for (String key : emittedRemoteTracks) {
                if (!key.startsWith(memberId + ":")) {
                    continue;
                }
                String kind = remoteTrackKinds.get(key);
                if ("video".equals(kind) || "screen".equals(kind)) {
                    assignedKinds.add(kind);
                }
            }

            for (String kind : publishedKinds) {
                if (!assignedKinds.contains(kind)) {
                    return kind;
                }
            }
            return null;
        }

        private void rememberLocalTrack(String kind, CapturedTrack captured) {
            releaseLocalTrack(kind);
            localTracks.put(kind, new LocalTrackState(kind, captured));
        }

        private void releaseLocalTrack(String kind) {
            LocalTrackState localTrack = localTracks.remove(kind);
            if (localTrack == null) {
                return;
            }
            localTrack.captured.cleanup.run();
        }

        private CompletableFuture<String> ensureConnectedMemberId() {
            if (localMemberId != null) {
                return CompletableFuture.completedFuture(localMemberId);
            }
            return connect(Map.of());
        }

        private void removeRemoteMember(String memberId) {
            remoteTrackKinds.keySet().removeIf(key -> key.startsWith(memberId + ":"));
            emittedRemoteTracks.removeIf(key -> key.startsWith(memberId + ":"));
            pendingRemoteTracks.keySet().removeIf(key -> key.startsWith(memberId + ":"));
            closePeer(memberId);
        }

        private void rollbackConnectedState() {
            connected = false;
            localMemberId = null;
            subscriptions.forEach(RoomClient.Subscription::unsubscribe);
            subscriptions.clear();
            peers.values().forEach(this::destroyPeer);
            peers.clear();
            remoteTrackKinds.clear();
            emittedRemoteTracks.clear();
            pendingRemoteTracks.clear();
        }

        private void closePeer(String memberId) {
            PeerState peer = peers.remove(memberId);
            if (peer != null) {
                destroyPeer(peer);
            }
        }

        private void destroyPeer(PeerState peer) {
            runtime.closePeerConnection(peer.pc);
        }

        private String offerEvent() {
            return signalPrefix() + ".offer";
        }

        private String answerEvent() {
            return signalPrefix() + ".answer";
        }

        private String iceEvent() {
            return signalPrefix() + ".ice";
        }

        private String signalPrefix() {
            String prefix = options.getSignalPrefix();
            return prefix == null || prefix.isBlank() ? DEFAULT_SIGNAL_PREFIX : prefix;
        }

        private String resolveDeviceId(Map<String, Object> payload, String key) {
            String value = payload == null ? null : stringValue(payload.get(key));
            return value == null || value.isBlank() ? null : value;
        }

        private SessionDescriptionPayload normalizeDescription(Object payload) {
            Map<String, Object> map = mapValue(payload);
            Map<String, Object> description = mapValue(map.get("description"));
            String type = lowercase(stringValue(description.get("type")));
            String sdp = stringValue(description.get("sdp"));
            if (type == null || sdp == null) {
                return null;
            }
            if (!List.of("offer", "answer", "pranswer", "rollback").contains(type)) {
                return null;
            }
            return new SessionDescriptionPayload(type, sdp);
        }

        private Map<String, Object> normalizeIceCandidate(Object payload) {
            Map<String, Object> map = mapValue(payload);
            Map<String, Object> candidate = mapValue(map.get("candidate"));
            String candidateValue = stringValue(candidate.get("candidate"));
            if (candidateValue == null) {
                return null;
            }
            Integer sdpMLineIndex = numberToInt(candidate.get("sdpMLineIndex"));
            Map<String, Object> normalized = new LinkedHashMap<>();
            normalized.put("candidate", candidateValue);
            normalized.put("sdpMid", stringValue(candidate.get("sdpMid")));
            normalized.put("sdpMLineIndex", sdpMLineIndex == null ? 0 : sdpMLineIndex);
            return normalized;
        }

        private Map<String, Object> findMember(String memberId) {
            for (Map<String, Object> member : room.members.list()) {
                if (Objects.equals(stringValue(member.get("memberId")), memberId)) {
                    return member;
                }
            }
            return Map.of("memberId", memberId);
        }

        private String buildTrackKey(String memberId, String trackId) {
            return memberId + ":" + trackId;
        }
    }

    private interface PeerCallbacks {
        void onIceCandidate(Map<String, Object> candidate);
        void onNegotiationNeeded();
        void onTrack(Object track);
    }

    private static final class PeerState {
        private final String memberId;
        private final Object pc;
        private final boolean polite;
        private final Map<String, Object> senders = new ConcurrentHashMap<>();
        private final List<Map<String, Object>> pendingCandidates = Collections.synchronizedList(new ArrayList<>());
        private volatile boolean makingOffer;
        private volatile boolean ignoreOffer;
        private volatile boolean isSettingRemoteAnswerPending;

        private PeerState(String memberId, Object pc, boolean polite) {
            this.memberId = memberId;
            this.pc = pc;
            this.polite = polite;
        }
    }

    private static final class PendingRemoteTrack {
        private final String memberId;
        private final Object track;

        private PendingRemoteTrack(String memberId, Object track) {
            this.memberId = memberId;
            this.track = track;
        }
    }

    private static final class LocalTrackState {
        private final String kind;
        private final CapturedTrack captured;

        private LocalTrackState(String kind, CapturedTrack captured) {
            this.kind = kind;
            this.captured = captured;
        }
    }

    private static final class CapturedTrack {
        private final Object track;
        private final String deviceId;
        private final Runnable cleanup;

        private CapturedTrack(Object track, String deviceId, Runnable cleanup) {
            this.track = track;
            this.deviceId = deviceId;
            this.cleanup = cleanup;
        }
    }

    private static final class SessionDescriptionPayload {
        private final String type;
        private final String sdp;

        private SessionDescriptionPayload(String type, String sdp) {
            this.type = type;
            this.sdp = sdp;
        }
    }

    private static final class WebRtcRuntime {
        private volatile boolean initialized;
        private volatile Object peerConnectionFactory;
        private volatile Object eglBase;
        private volatile Context applicationContext;

        void ensureInitialized() {
            if (initialized) {
                return;
            }

            synchronized (this) {
                if (initialized) {
                    return;
                }

                Activity activity = AndroidActivityTracker.getCurrentActivity();
                if (activity == null) {
                    throw new IllegalStateException(
                            "EdgeBase room media transport requires a foreground Android Activity. " +
                                    "Call AndroidActivityTracker.initialize(context) during app startup. See " + DOCS_URL
                    );
                }

                applicationContext = activity.getApplicationContext();
                try {
                    Class<?> initOptionsClass = classFor("realtimekit.org.webrtc.PeerConnectionFactory$InitializationOptions");
                    Object initBuilder = invokeStatic(initOptionsClass, "builder", new Class<?>[]{Context.class}, applicationContext);
                    Object initOptions = invoke(initBuilder, "createInitializationOptions");
                    invokeStatic(
                            classFor("realtimekit.org.webrtc.PeerConnectionFactory"),
                            "initialize",
                            new Class<?>[]{initOptionsClass},
                            initOptions
                    );

                    Object builder = invokeStatic(classFor("realtimekit.org.webrtc.PeerConnectionFactory"), "builder");
                    peerConnectionFactory = invoke(builder, "createPeerConnectionFactory");
                    eglBase = invokeStatic(classFor("realtimekit.org.webrtc.EglBase"), "create");
                    initialized = true;
                } catch (Throwable error) {
                    throw new IllegalStateException(
                            "Failed to initialize the Android WebRTC runtime for EdgeBase room media. See " + DOCS_URL,
                            error
                    );
                }
            }
        }

        Object createPeerConnection(RoomClient.RoomP2PMediaTransportOptions options, PeerCallbacks callbacks) {
            ensureInitialized();
            try {
                Class<?> iceServerClass = classFor("realtimekit.org.webrtc.PeerConnection$IceServer");
                List<Object> iceServers = new ArrayList<>();
                for (RoomClient.RoomP2PIceServerOptions server : options.getRtcConfiguration().getIceServers()) {
                    List<String> urls = server.getUrls() == null || server.getUrls().isEmpty()
                            ? DEFAULT_ICE_SERVERS
                            : server.getUrls();
                    Constructor<?> constructor = iceServerClass.getConstructor(String.class, String.class, String.class);
                    iceServers.add(constructor.newInstance(
                            urls.get(0),
                            server.getUsername() == null ? "" : server.getUsername(),
                            server.getCredential() == null ? "" : server.getCredential()
                    ));
                }

                Class<?> rtcConfigClass = classFor("realtimekit.org.webrtc.PeerConnection$RTCConfiguration");
                Object rtcConfig = rtcConfigClass.getConstructor(List.class).newInstance(iceServers);
                Object observer = createPeerConnectionObserver(callbacks);
                return invoke(
                        peerConnectionFactory,
                        "createPeerConnection",
                        new Class<?>[]{rtcConfigClass, classFor("realtimekit.org.webrtc.PeerConnection$Observer")},
                        rtcConfig,
                        observer
                );
            } catch (Throwable error) {
                throw new IllegalStateException("Failed to create Android P2P peer connection.", error);
            }
        }

        CapturedTrack captureAudioTrack(String deviceId) {
            ensureInitialized();
            try {
                Object constraints = classFor("realtimekit.org.webrtc.MediaConstraints").getConstructor().newInstance();
                Object audioSource = invoke(
                        peerConnectionFactory,
                        "createAudioSource",
                        new Class<?>[]{classFor("realtimekit.org.webrtc.MediaConstraints")},
                        constraints
                );
                Object audioTrack = invoke(
                        peerConnectionFactory,
                        "createAudioTrack",
                        new Class<?>[]{String.class, classFor("realtimekit.org.webrtc.AudioSource")},
                        "edgebase-audio-" + UUID.randomUUID(),
                        audioSource
                );
                return new CapturedTrack(audioTrack, deviceId, () -> {
                    dispose(audioTrack);
                    dispose(audioSource);
                });
            } catch (Throwable error) {
                throw new IllegalStateException("Failed to capture Android audio track for P2P transport.", error);
            }
        }

        CapturedTrack captureVideoTrack(String deviceId) {
            ensureInitialized();
            try {
                Object capturer = createCameraCapturer(deviceId);
                Object videoSource = invoke(
                        peerConnectionFactory,
                        "createVideoSource",
                        new Class<?>[]{boolean.class},
                        false
                );
                Object eglContext = invoke(eglBase, "getEglBaseContext");
                Object helper = invokeStatic(
                        classFor("realtimekit.org.webrtc.SurfaceTextureHelper"),
                        "create",
                        new Class<?>[]{String.class, classFor("realtimekit.org.webrtc.EglBase$Context")},
                        "EdgeBaseP2PVideo",
                        eglContext
                );
                Object capturerObserver = invoke(videoSource, "getCapturerObserver");
                invoke(
                        capturer,
                        "initialize",
                        new Class<?>[]{
                                classFor("realtimekit.org.webrtc.SurfaceTextureHelper"),
                                Context.class,
                                classFor("realtimekit.org.webrtc.CapturerObserver")
                        },
                        helper,
                        applicationContext,
                        capturerObserver
                );
                invoke(capturer, "startCapture", new Class<?>[]{int.class, int.class, int.class}, 1280, 720, 30);
                Object videoTrack = invoke(
                        peerConnectionFactory,
                        "createVideoTrack",
                        new Class<?>[]{String.class, classFor("realtimekit.org.webrtc.VideoSource")},
                        "edgebase-video-" + UUID.randomUUID(),
                        videoSource
                );
                return new CapturedTrack(videoTrack, resolveCameraDeviceId(capturer, deviceId), () -> {
                    try {
                        invoke(capturer, "stopCapture");
                    } catch (Throwable ignored) {
                    }
                    dispose(capturer);
                    dispose(helper);
                    dispose(videoTrack);
                    dispose(videoSource);
                });
            } catch (Throwable error) {
                throw new IllegalStateException("Failed to capture Android video track for P2P transport.", error);
            }
        }

        CapturedTrack captureScreenTrack(Intent screenCaptureIntent) {
            ensureInitialized();
            try {
                Object capturer = classFor("realtimekit.org.webrtc.ScreenCapturerAndroid")
                        .getConstructor(Intent.class, classFor("android.media.projection.MediaProjection$Callback"))
                        .newInstance(screenCaptureIntent, null);
                Object videoSource = invoke(
                        peerConnectionFactory,
                        "createVideoSource",
                        new Class<?>[]{boolean.class},
                        true
                );
                Object eglContext = invoke(eglBase, "getEglBaseContext");
                Object helper = invokeStatic(
                        classFor("realtimekit.org.webrtc.SurfaceTextureHelper"),
                        "create",
                        new Class<?>[]{String.class, classFor("realtimekit.org.webrtc.EglBase$Context")},
                        "EdgeBaseP2PScreen",
                        eglContext
                );
                Object capturerObserver = invoke(videoSource, "getCapturerObserver");
                invoke(
                        capturer,
                        "initialize",
                        new Class<?>[]{
                                classFor("realtimekit.org.webrtc.SurfaceTextureHelper"),
                                Context.class,
                                classFor("realtimekit.org.webrtc.CapturerObserver")
                        },
                        helper,
                        applicationContext,
                        capturerObserver
                );
                invoke(capturer, "startCapture", new Class<?>[]{int.class, int.class, int.class}, 1280, 720, 15);
                Object videoTrack = invoke(
                        peerConnectionFactory,
                        "createVideoTrack",
                        new Class<?>[]{String.class, classFor("realtimekit.org.webrtc.VideoSource")},
                        "edgebase-screen-" + UUID.randomUUID(),
                        videoSource
                );
                return new CapturedTrack(videoTrack, null, () -> {
                    try {
                        invoke(capturer, "stopCapture");
                    } catch (Throwable ignored) {
                    }
                    dispose(capturer);
                    dispose(helper);
                    dispose(videoTrack);
                    dispose(videoSource);
                });
            } catch (Throwable error) {
                throw new IllegalStateException("Failed to capture Android screen-share track for P2P transport.", error);
            }
        }

        Object addTrack(Object peerConnection, Object track) {
            try {
                return invoke(
                        peerConnection,
                        "addTrack",
                        new Class<?>[]{classFor("realtimekit.org.webrtc.MediaStreamTrack"), List.class},
                        track,
                        List.of("edgebase-p2p")
                );
            } catch (Throwable error) {
                throw new IllegalStateException("Failed to add Android P2P track.", error);
            }
        }

        void replaceTrack(Object sender, Object track) {
            try {
                invoke(sender, "setTrack", new Class<?>[]{classFor("realtimekit.org.webrtc.MediaStreamTrack"), boolean.class}, track, false);
            } catch (Throwable error) {
                throw new IllegalStateException("Failed to replace Android P2P track.", error);
            }
        }

        Object senderTrack(Object sender) {
            return invoke(sender, "track");
        }

        void removeTrack(Object peerConnection, Object sender) {
            try {
                invoke(peerConnection, "removeTrack", new Class<?>[]{classFor("realtimekit.org.webrtc.RtpSender")}, sender);
            } catch (Throwable error) {
                throw new IllegalStateException("Failed to remove Android P2P track.", error);
            }
        }

        SessionDescriptionPayload createOffer(Object peerConnection) {
            return createSessionDescription(peerConnection, "createOffer");
        }

        SessionDescriptionPayload createAnswer(Object peerConnection) {
            return createSessionDescription(peerConnection, "createAnswer");
        }

        void setLocalDescription(Object peerConnection, SessionDescriptionPayload description) {
            completeSessionDescription(peerConnection, "setLocalDescription", description);
        }

        void setRemoteDescription(Object peerConnection, SessionDescriptionPayload description) {
            completeSessionDescription(peerConnection, "setRemoteDescription", description);
        }

        SessionDescriptionPayload getRemoteDescription(Object peerConnection) {
            Object description = invoke(peerConnection, "getRemoteDescription");
            return description == null ? null : fromSessionDescription(description);
        }

        boolean addIceCandidate(Object peerConnection, Map<String, Object> candidate) {
            try {
                Object nativeCandidate = buildIceCandidate(candidate);
                Object result = invoke(
                        peerConnection,
                        "addIceCandidate",
                        new Class<?>[]{classFor("realtimekit.org.webrtc.IceCandidate")},
                        nativeCandidate
                );
                return !(result instanceof Boolean value) || value;
            } catch (Throwable error) {
                return false;
            }
        }

        String connectionState(Object peerConnection) {
            Object state = invoke(peerConnection, "connectionState");
            return enumName(state);
        }

        String signalingState(Object peerConnection) {
            Object state = invoke(peerConnection, "signalingState");
            return enumName(state);
        }

        void closePeerConnection(Object peerConnection) {
            try {
                invoke(peerConnection, "close");
            } catch (Throwable ignored) {
            }
            dispose(peerConnection);
        }

        void setTrackEnabled(Object track, boolean enabled) {
            invoke(track, "setEnabled", new Class<?>[]{boolean.class}, enabled);
        }

        String trackId(Object track) {
            return stringValue(invoke(track, "id"));
        }

        String normalizeTrackKind(Object track) {
            String kind = lowercase(stringValue(invoke(track, "kind")));
            if ("audio".equals(kind)) {
                return "audio";
            }
            if ("video".equals(kind)) {
                return "video";
            }
            return null;
        }

        void release() {
            dispose(peerConnectionFactory);
            dispose(eglBase);
            peerConnectionFactory = null;
            eglBase = null;
            initialized = false;
        }

        private Object createCameraCapturer(String preferredDeviceId) throws Exception {
            Context context = applicationContext;
            Class<?> camera2EnumeratorClass = classFor("realtimekit.org.webrtc.Camera2Enumerator");
            Object enumerator;
            boolean supportsCamera2 = (Boolean) invokeStatic(
                    camera2EnumeratorClass,
                    "isSupported",
                    new Class<?>[]{Context.class},
                    context
            );
            if (supportsCamera2) {
                enumerator = camera2EnumeratorClass.getConstructor(Context.class).newInstance(context);
            } else {
                enumerator = classFor("realtimekit.org.webrtc.Camera1Enumerator")
                        .getConstructor(boolean.class)
                        .newInstance(false);
            }

            String deviceName = chooseCameraDevice(enumerator, preferredDeviceId);
            return invoke(
                    enumerator,
                    "createCapturer",
                    new Class<?>[]{String.class, classFor("realtimekit.org.webrtc.CameraVideoCapturer$CameraEventsHandler")},
                    deviceName,
                    null
            );
        }

        private String chooseCameraDevice(Object enumerator, String preferredDeviceId) {
            try {
                String[] deviceNames = (String[]) invoke(enumerator, "getDeviceNames");
                if (deviceNames == null || deviceNames.length == 0) {
                    throw new IllegalStateException("No Android camera devices are available for P2P video.");
                }
                if (preferredDeviceId != null) {
                    for (String deviceName : deviceNames) {
                        if (Objects.equals(deviceName, preferredDeviceId)) {
                            return deviceName;
                        }
                    }
                }
                for (String deviceName : deviceNames) {
                    Object frontFacing = invoke(
                            enumerator,
                            "isFrontFacing",
                            new Class<?>[]{String.class},
                            deviceName
                    );
                    if (frontFacing instanceof Boolean value && value) {
                        return deviceName;
                    }
                }
                return deviceNames[0];
            } catch (Throwable error) {
                throw new IllegalStateException("Failed to enumerate Android camera devices.", error);
            }
        }

        private String resolveCameraDeviceId(Object capturer, String preferredDeviceId) {
            return preferredDeviceId;
        }

        private Object createPeerConnectionObserver(PeerCallbacks callbacks) throws Exception {
            Class<?> observerClass = classFor("realtimekit.org.webrtc.PeerConnection$Observer");
            InvocationHandler handler = (proxy, method, args) -> {
                String name = method.getName();
                if ("onIceCandidate".equals(name) && args != null && args.length == 1 && args[0] != null) {
                    callbacks.onIceCandidate(iceCandidateToMap(args[0]));
                    return null;
                }
                if ("onRenegotiationNeeded".equals(name)) {
                    callbacks.onNegotiationNeeded();
                    return null;
                }
                if ("onAddTrack".equals(name) && args != null && args.length >= 1 && args[0] != null) {
                    Object receiver = args[0];
                    Object track = invoke(receiver, "track");
                    if (track != null) {
                        callbacks.onTrack(track);
                    }
                    return null;
                }
                if ("onTrack".equals(name) && args != null && args.length == 1 && args[0] != null) {
                    Object receiver = invoke(args[0], "getReceiver");
                    Object track = receiver == null ? null : invoke(receiver, "track");
                    if (track != null) {
                        callbacks.onTrack(track);
                    }
                }
                return null;
            };
            return Proxy.newProxyInstance(observerClass.getClassLoader(), new Class<?>[]{observerClass}, handler);
        }

        private SessionDescriptionPayload createSessionDescription(Object peerConnection, String methodName) {
            try {
                CompletableFuture<SessionDescriptionPayload> future = new CompletableFuture<>();
                Object observer = createSdpObserver(future);
                Object constraints = classFor("realtimekit.org.webrtc.MediaConstraints").getConstructor().newInstance();
                invoke(
                        peerConnection,
                        methodName,
                        new Class<?>[]{classFor("realtimekit.org.webrtc.SdpObserver"), classFor("realtimekit.org.webrtc.MediaConstraints")},
                        observer,
                        constraints
                );
                return future.join();
            } catch (Throwable error) {
                throw new IllegalStateException("Failed to " + methodName + " for Android P2P transport.", error);
            }
        }

        private void completeSessionDescription(
                Object peerConnection,
                String methodName,
                SessionDescriptionPayload description
        ) {
            try {
                CompletableFuture<Void> future = new CompletableFuture<>();
                Object observer = createSetSdpObserver(future);
                Object nativeDescription = buildSessionDescription(description);
                invoke(
                        peerConnection,
                        methodName,
                        new Class<?>[]{classFor("realtimekit.org.webrtc.SdpObserver"), classFor("realtimekit.org.webrtc.SessionDescription")},
                        observer,
                        nativeDescription
                );
                future.join();
            } catch (Throwable error) {
                throw new IllegalStateException("Failed to " + methodName + " for Android P2P transport.", error);
            }
        }

        private Object createSdpObserver(CompletableFuture<SessionDescriptionPayload> future) throws Exception {
            Class<?> observerClass = classFor("realtimekit.org.webrtc.SdpObserver");
            InvocationHandler handler = (proxy, method, args) -> {
                switch (method.getName()) {
                    case "onCreateSuccess" -> future.complete(fromSessionDescription(args[0]));
                    case "onCreateFailure", "onSetFailure" ->
                            future.completeExceptionally(new IllegalStateException(String.valueOf(args[0])));
                    case "onSetSuccess" -> {
                    }
                }
                return null;
            };
            return Proxy.newProxyInstance(observerClass.getClassLoader(), new Class<?>[]{observerClass}, handler);
        }

        private Object createSetSdpObserver(CompletableFuture<Void> future) throws Exception {
            Class<?> observerClass = classFor("realtimekit.org.webrtc.SdpObserver");
            InvocationHandler handler = (proxy, method, args) -> {
                switch (method.getName()) {
                    case "onSetSuccess" -> future.complete(null);
                    case "onCreateFailure", "onSetFailure" ->
                            future.completeExceptionally(new IllegalStateException(String.valueOf(args[0])));
                    case "onCreateSuccess" -> {
                    }
                }
                return null;
            };
            return Proxy.newProxyInstance(observerClass.getClassLoader(), new Class<?>[]{observerClass}, handler);
        }

        private Object buildSessionDescription(SessionDescriptionPayload description) throws Exception {
            Class<?> descriptionClass = classFor("realtimekit.org.webrtc.SessionDescription");
            Class<?> typeClass = classFor("realtimekit.org.webrtc.SessionDescription$Type");
            Object type = invokeStatic(typeClass, "fromCanonicalForm", new Class<?>[]{String.class}, description.type);
            return descriptionClass.getConstructor(typeClass, String.class).newInstance(type, description.sdp);
        }

        private SessionDescriptionPayload fromSessionDescription(Object description) {
            try {
                Class<?> typeClass = classFor("realtimekit.org.webrtc.SessionDescription$Type");
                Object typeValue = fieldValue(description, "type");
                String type = lowercase(stringValue(invoke(typeClass, typeValue, "canonicalForm")));
                String sdp = stringValue(fieldValue(description, "description"));
                return new SessionDescriptionPayload(type, sdp);
            } catch (Throwable error) {
                throw new IllegalStateException("Failed to parse Android session description.", error);
            }
        }

        private Object buildIceCandidate(Map<String, Object> candidate) throws Exception {
            return classFor("realtimekit.org.webrtc.IceCandidate")
                    .getConstructor(String.class, int.class, String.class)
                    .newInstance(
                            stringValue(candidate.get("sdpMid")),
                            numberToInt(candidate.get("sdpMLineIndex")) == null ? 0 : numberToInt(candidate.get("sdpMLineIndex")),
                            stringValue(candidate.get("candidate"))
                    );
        }

        private Map<String, Object> iceCandidateToMap(Object candidate) {
            Map<String, Object> map = new LinkedHashMap<>();
            map.put("candidate", stringValue(fieldValue(candidate, "sdp")));
            map.put("sdpMid", stringValue(fieldValue(candidate, "sdpMid")));
            map.put("sdpMLineIndex", numberToInt(fieldValue(candidate, "sdpMLineIndex")));
            return map;
        }
    }

    private static Class<?> classFor(String name) {
        try {
            return Class.forName(name);
        } catch (Throwable error) {
            throw new IllegalStateException("Missing required Android runtime class: " + name, error);
        }
    }

    private static Object invokeStatic(Class<?> target, String methodName, Class<?>[] parameterTypes, Object... args) {
        try {
            Method method = target.getMethod(methodName, parameterTypes);
            method.setAccessible(true);
            return method.invoke(null, args);
        } catch (NoSuchMethodException error) {
            throw new IllegalStateException("Missing static method " + target.getName() + "." + methodName, error);
        } catch (Throwable error) {
            throw new IllegalStateException("Failed to call static method " + target.getName() + "." + methodName, error);
        }
    }

    private static Object invokeStatic(Class<?> target, String methodName) {
        return invokeStatic(target, methodName, new Class<?>[0]);
    }

    private static Object invoke(Object target, String methodName, Class<?>[] parameterTypes, Object... args) {
        try {
            Method method = target.getClass().getMethod(methodName, parameterTypes);
            method.setAccessible(true);
            return method.invoke(target, args);
        } catch (NoSuchMethodException error) {
            throw new IllegalStateException("Missing method " + target.getClass().getName() + "." + methodName, error);
        } catch (Throwable error) {
            throw new IllegalStateException("Failed to call " + target.getClass().getName() + "." + methodName, error);
        }
    }

    private static Object invoke(Object target, String methodName) {
        return invoke(target, methodName, new Class<?>[0]);
    }

    private static Object invoke(Class<?> ignoredClass, Object target, String methodName) {
        return invoke(target, methodName, new Class<?>[0]);
    }

    private static Object fieldValue(Object target, String fieldName) {
        try {
            return target.getClass().getField(fieldName).get(target);
        } catch (Throwable error) {
            throw new IllegalStateException("Failed to read field " + target.getClass().getName() + "." + fieldName, error);
        }
    }

    private static void dispose(Object target) {
        if (target == null) {
            return;
        }
        try {
            Method method = target.getClass().getMethod("dispose");
            method.setAccessible(true);
            method.invoke(target);
        } catch (NoSuchMethodException ignored) {
        } catch (Throwable ignored) {
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> mapValue(Object value) {
        if (value instanceof Map<?, ?> map) {
            return (Map<String, Object>) map;
        }
        return Map.of();
    }

    private static String stringValue(Object value) {
        return value instanceof String string ? string : null;
    }

    private static Integer numberToInt(Object value) {
        return value instanceof Number number ? number.intValue() : null;
    }

    private static String lowercase(String value) {
        return value == null ? null : value.toLowerCase();
    }

    private static String enumName(Object value) {
        return value instanceof Enum<?> enumValue ? enumValue.name().toLowerCase() : null;
    }
}
