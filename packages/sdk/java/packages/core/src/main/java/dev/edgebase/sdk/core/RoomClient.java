package dev.edgebase.sdk.core;

import dev.edgebase.sdk.core.generated.GeneratedDbApi;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.BiConsumer;
import java.util.function.Consumer;

/**
 * RoomClient v2 — Client-side room connection for real-time multiplayer state.
 *
 * <p>Complete redesign from v1.
 * <ul>
 *   <li>3 state areas: sharedState (all clients), playerState (per-player), serverState (server-only, not sent)</li>
 *   <li>Client can only read + subscribe + send(). All writes are server-only.</li>
 *   <li>send() returns a CompletableFuture resolved by requestId matching</li>
 *   <li>Subscription returns object with unsubscribe()</li>
 *   <li>namespace + roomId identification (replaces single roomId)</li>
 * </ul>
 */
@SuppressWarnings("deprecation")
public class RoomClient {
    private static final long ROOM_EXPLICIT_LEAVE_CLOSE_DELAY_MS = 40L;
    private static final String ROOM_MEDIA_DOCS_URL = "https://edgebase.fun/docs/room/media";
    private static volatile RoomCloudflareRealtimeKitClientFactory defaultCloudflareRealtimeKitClientFactory;
    private static volatile RoomP2PMediaTransportFactory defaultP2PMediaTransportFactory;

    interface RoomSocket {
        void send(String msg);
        void close();
    }

    @FunctionalInterface
    public interface Subscription {
        void unsubscribe();
    }

    @FunctionalInterface
    public interface Supplier<T> {
        T get();
    }

    @FunctionalInterface
    public interface AuthStateListenerRegistrar {
        void register(Consumer<Boolean> listener);
    }

    @FunctionalInterface
    public interface AnySignalHandler {
        void accept(String event, Object payload, Map<String, Object> meta);
    }

    public static final class RoomMediaRemoteTrackEvent {
        private final String kind;
        private final Object track;
        private final Object view;
        private final String trackName;
        private final String providerSessionId;
        private final String participantId;
        private final String customParticipantId;
        private final String userId;
        private final Map<String, Object> participant;

        public RoomMediaRemoteTrackEvent(
                String kind,
                Object track,
                Object view,
                String trackName,
                String providerSessionId,
                String participantId,
                String customParticipantId,
                String userId,
                Map<String, Object> participant
        ) {
            this.kind = kind;
            this.track = track;
            this.view = view;
            this.trackName = trackName;
            this.providerSessionId = providerSessionId;
            this.participantId = participantId;
            this.customParticipantId = customParticipantId;
            this.userId = userId;
            this.participant = participant == null ? Map.of() : Map.copyOf(participant);
        }

        public String getKind() { return kind; }
        public Object getTrack() { return track; }
        public Object getView() { return view; }
        public String getTrackName() { return trackName; }
        public String getProviderSessionId() { return providerSessionId; }
        public String getParticipantId() { return participantId; }
        public String getCustomParticipantId() { return customParticipantId; }
        public String getUserId() { return userId; }
        public Map<String, Object> getParticipant() { return participant; }
    }

    public interface RoomMediaTransport {
        CompletableFuture<String> connect(Map<String, Object> payload);
        default CompletableFuture<String> connect() { return connect(Map.of()); }
        CompletableFuture<Object> enableAudio(Map<String, Object> payload);
        default CompletableFuture<Object> enableAudio() { return enableAudio(Map.of()); }
        CompletableFuture<Object> enableVideo(Map<String, Object> payload);
        default CompletableFuture<Object> enableVideo() { return enableVideo(Map.of()); }
        CompletableFuture<Object> startScreenShare(Map<String, Object> payload);
        default CompletableFuture<Object> startScreenShare() { return startScreenShare(Map.of()); }
        CompletableFuture<Void> disableAudio();
        CompletableFuture<Void> disableVideo();
        CompletableFuture<Void> stopScreenShare();
        CompletableFuture<Void> setMuted(String kind, boolean muted);
        CompletableFuture<Void> switchDevices(Map<String, Object> payload);
        Subscription onRemoteTrack(Consumer<RoomMediaRemoteTrackEvent> handler);
        String getSessionId();
        Object getPeerConnection();
        void destroy();
    }

    public enum RoomMediaTransportProvider {
        CLOUDFLARE_REALTIMEKIT("cloudflare_realtimekit"),
        P2P("p2p");

        private final String wireName;

        RoomMediaTransportProvider(String wireName) {
            this.wireName = wireName;
        }

        public String wireName() {
            return wireName;
        }
    }

    public static final class RoomCloudflareRealtimeKitTransportOptions {
        private boolean autoSubscribe = true;
        private String baseDomain = "dyte.io";
        private RoomCloudflareRealtimeKitClientFactory clientFactory;

        public boolean isAutoSubscribe() {
            return autoSubscribe;
        }

        public RoomCloudflareRealtimeKitTransportOptions setAutoSubscribe(boolean autoSubscribe) {
            this.autoSubscribe = autoSubscribe;
            return this;
        }

        public String getBaseDomain() {
            return baseDomain;
        }

        public RoomCloudflareRealtimeKitTransportOptions setBaseDomain(String baseDomain) {
            this.baseDomain = baseDomain == null || baseDomain.isBlank() ? "dyte.io" : baseDomain;
            return this;
        }

        public RoomCloudflareRealtimeKitClientFactory getClientFactory() {
            return clientFactory;
        }

        public RoomCloudflareRealtimeKitTransportOptions setClientFactory(RoomCloudflareRealtimeKitClientFactory clientFactory) {
            this.clientFactory = clientFactory;
            return this;
        }
    }

    public static final class RoomP2PIceServerOptions {
        private List<String> urls = List.of("stun:stun.l.google.com:19302");
        private String username;
        private String credential;

        public List<String> getUrls() {
            return urls;
        }

        public RoomP2PIceServerOptions setUrls(List<String> urls) {
            this.urls = (urls == null || urls.isEmpty())
                    ? List.of("stun:stun.l.google.com:19302")
                    : List.copyOf(urls);
            return this;
        }

        public String getUsername() {
            return username;
        }

        public RoomP2PIceServerOptions setUsername(String username) {
            this.username = username;
            return this;
        }

        public String getCredential() {
            return credential;
        }

        public RoomP2PIceServerOptions setCredential(String credential) {
            this.credential = credential;
            return this;
        }
    }

    public static final class RoomP2PRtcConfigurationOptions {
        private List<RoomP2PIceServerOptions> iceServers = List.of(new RoomP2PIceServerOptions());

        public List<RoomP2PIceServerOptions> getIceServers() {
            return iceServers;
        }

        public RoomP2PRtcConfigurationOptions setIceServers(List<RoomP2PIceServerOptions> iceServers) {
            this.iceServers = (iceServers == null || iceServers.isEmpty())
                    ? List.of(new RoomP2PIceServerOptions())
                    : List.copyOf(iceServers);
            return this;
        }
    }

    public static final class RoomP2PMediaTransportOptions {
        private String signalPrefix = "edgebase.media.p2p";
        private RoomP2PRtcConfigurationOptions rtcConfiguration = new RoomP2PRtcConfigurationOptions();
        private long currentMemberTimeoutMs = 10_000L;
        private RoomP2PMediaTransportFactory transportFactory;

        public String getSignalPrefix() {
            return signalPrefix;
        }

        public RoomP2PMediaTransportOptions setSignalPrefix(String signalPrefix) {
            this.signalPrefix = signalPrefix == null || signalPrefix.isBlank()
                    ? "edgebase.media.p2p"
                    : signalPrefix;
            return this;
        }

        public RoomP2PRtcConfigurationOptions getRtcConfiguration() {
            return rtcConfiguration;
        }

        public RoomP2PMediaTransportOptions setRtcConfiguration(RoomP2PRtcConfigurationOptions rtcConfiguration) {
            this.rtcConfiguration = rtcConfiguration == null
                    ? new RoomP2PRtcConfigurationOptions()
                    : rtcConfiguration;
            return this;
        }

        public long getCurrentMemberTimeoutMs() {
            return currentMemberTimeoutMs;
        }

        public RoomP2PMediaTransportOptions setCurrentMemberTimeoutMs(long currentMemberTimeoutMs) {
            this.currentMemberTimeoutMs = Math.max(0L, currentMemberTimeoutMs);
            return this;
        }

        public RoomP2PMediaTransportFactory getTransportFactory() {
            return transportFactory;
        }

        public RoomP2PMediaTransportOptions setTransportFactory(RoomP2PMediaTransportFactory transportFactory) {
            this.transportFactory = transportFactory;
            return this;
        }
    }

    @FunctionalInterface
    public interface RoomP2PMediaTransportFactory {
        RoomMediaTransport create(RoomClient room, RoomP2PMediaTransportOptions options);
    }

    public static final class RoomMediaTransportOptions {
        private RoomMediaTransportProvider provider = RoomMediaTransportProvider.CLOUDFLARE_REALTIMEKIT;
        private RoomCloudflareRealtimeKitTransportOptions cloudflareRealtimeKit = new RoomCloudflareRealtimeKitTransportOptions();
        private RoomP2PMediaTransportOptions p2p = new RoomP2PMediaTransportOptions();

        public RoomMediaTransportProvider getProvider() {
            return provider;
        }

        public RoomMediaTransportOptions setProvider(RoomMediaTransportProvider provider) {
            this.provider = provider == null ? RoomMediaTransportProvider.CLOUDFLARE_REALTIMEKIT : provider;
            return this;
        }

        public RoomCloudflareRealtimeKitTransportOptions getCloudflareRealtimeKit() {
            return cloudflareRealtimeKit;
        }

        public RoomMediaTransportOptions setCloudflareRealtimeKit(RoomCloudflareRealtimeKitTransportOptions cloudflareRealtimeKit) {
            this.cloudflareRealtimeKit = cloudflareRealtimeKit == null
                    ? new RoomCloudflareRealtimeKitTransportOptions()
                    : cloudflareRealtimeKit;
            return this;
        }

        public RoomP2PMediaTransportOptions getP2P() {
            return p2p;
        }

        public RoomMediaTransportOptions setP2P(RoomP2PMediaTransportOptions p2p) {
            this.p2p = p2p == null ? new RoomP2PMediaTransportOptions() : p2p;
            return this;
        }
    }

    public static final class RoomCloudflareRealtimeKitClientFactoryOptions {
        private final String authToken;
        private final String displayName;
        private final boolean enableAudio;
        private final boolean enableVideo;
        private final String baseDomain;

        public RoomCloudflareRealtimeKitClientFactoryOptions(
                String authToken,
                String displayName,
                boolean enableAudio,
                boolean enableVideo,
                String baseDomain
        ) {
            this.authToken = authToken;
            this.displayName = displayName;
            this.enableAudio = enableAudio;
            this.enableVideo = enableVideo;
            this.baseDomain = baseDomain;
        }

        public String getAuthToken() { return authToken; }
        public String getDisplayName() { return displayName; }
        public boolean isEnableAudio() { return enableAudio; }
        public boolean isEnableVideo() { return enableVideo; }
        public String getBaseDomain() { return baseDomain; }
    }

    @FunctionalInterface
    public interface RoomCloudflareRealtimeKitClientFactory {
        CompletableFuture<RoomCloudflareRealtimeKitClientAdapter> create(
                RoomCloudflareRealtimeKitClientFactoryOptions options
        );
    }

    public static final class RoomCloudflareParticipantSnapshot {
        private final String id;
        private final String userId;
        private final String name;
        private final String picture;
        private final String customParticipantId;
        private final boolean audioEnabled;
        private final boolean videoEnabled;
        private final boolean screenShareEnabled;
        private final Object participantHandle;

        public RoomCloudflareParticipantSnapshot(
                String id,
                String userId,
                String name,
                String picture,
                String customParticipantId,
                boolean audioEnabled,
                boolean videoEnabled,
                boolean screenShareEnabled,
                Object participantHandle
        ) {
            this.id = id;
            this.userId = userId;
            this.name = name;
            this.picture = picture;
            this.customParticipantId = customParticipantId;
            this.audioEnabled = audioEnabled;
            this.videoEnabled = videoEnabled;
            this.screenShareEnabled = screenShareEnabled;
            this.participantHandle = participantHandle;
        }

        public String getId() { return id; }
        public String getUserId() { return userId; }
        public String getName() { return name; }
        public String getPicture() { return picture; }
        public String getCustomParticipantId() { return customParticipantId; }
        public boolean isAudioEnabled() { return audioEnabled; }
        public boolean isVideoEnabled() { return videoEnabled; }
        public boolean isScreenShareEnabled() { return screenShareEnabled; }
        public Object getParticipantHandle() { return participantHandle; }

        public Map<String, Object> toMap() {
            LinkedHashMap<String, Object> result = new LinkedHashMap<>();
            result.put("id", id);
            result.put("userId", userId);
            result.put("name", name);
            if (picture != null) result.put("picture", picture);
            if (customParticipantId != null) result.put("customParticipantId", customParticipantId);
            result.put("audioEnabled", audioEnabled);
            result.put("videoEnabled", videoEnabled);
            result.put("screenShareEnabled", screenShareEnabled);
            return result;
        }
    }

    public interface RoomCloudflareParticipantListener {
        default void onParticipantJoin(RoomCloudflareParticipantSnapshot participant) {}
        default void onParticipantLeave(RoomCloudflareParticipantSnapshot participant) {}
        default void onAudioUpdate(RoomCloudflareParticipantSnapshot participant, boolean enabled) {}
        default void onVideoUpdate(RoomCloudflareParticipantSnapshot participant, boolean enabled) {}
        default void onScreenShareUpdate(RoomCloudflareParticipantSnapshot participant, boolean enabled) {}
        default void onParticipantsSync(List<RoomCloudflareParticipantSnapshot> participants) {}
    }

    public interface RoomCloudflareRealtimeKitClientAdapter {
        CompletableFuture<Void> joinRoom();
        CompletableFuture<Void> leaveRoom();
        CompletableFuture<Void> enableAudio();
        CompletableFuture<Void> disableAudio();
        CompletableFuture<Void> enableVideo();
        CompletableFuture<Void> disableVideo();
        CompletableFuture<Void> enableScreenShare();
        CompletableFuture<Void> disableScreenShare();
        CompletableFuture<Void> setAudioDevice(String deviceId);
        CompletableFuture<Void> setVideoDevice(String deviceId);
        RoomCloudflareParticipantSnapshot getLocalParticipant();
        List<RoomCloudflareParticipantSnapshot> getJoinedParticipants();
        Object buildView(RoomCloudflareParticipantSnapshot participant, String kind, boolean isSelf);
        void addListener(RoomCloudflareParticipantListener listener);
        void removeListener(RoomCloudflareParticipantListener listener);
    }

    public static void setDefaultCloudflareRealtimeKitClientFactory(
            RoomCloudflareRealtimeKitClientFactory clientFactory
    ) {
        defaultCloudflareRealtimeKitClientFactory = clientFactory;
    }

    public static void setDefaultP2PMediaTransportFactory(
            RoomP2PMediaTransportFactory transportFactory
    ) {
        defaultP2PMediaTransportFactory = transportFactory;
    }

    /** Room namespace (e.g. 'game', 'chat'). */
    public final String namespace;
    /** Room instance ID within the namespace. */
    public final String roomId;

    public final RoomStateNamespace state;
    public final RoomMetaNamespace meta;
    public final RoomSignalsNamespace signals;
    public final RoomMembersNamespace members;
    public final RoomAdminNamespace admin;
    public final RoomMediaNamespace media;
    public final RoomSessionNamespace session;

    private final String baseUrl;
    private final HttpClient httpClient;
    private final Supplier<String> tokenSupplier;
    private final AuthStateListenerRegistrar authStateListenerRegistrar;
    private final int maxReconnectAttempts;
    private final long reconnectBaseDelayMs;
    private final long sendTimeoutMs;

    private final Object stateLock = new Object();
    private Map<String, Object> sharedState = new ConcurrentHashMap<>();
    private int sharedVersion = 0;
    private Map<String, Object> playerState = new ConcurrentHashMap<>();
    private int playerVersion = 0;
    private List<Map<String, Object>> roomMembers = new ArrayList<>();
    private List<Map<String, Object>> mediaMembers = new ArrayList<>();

    private RoomSocket ws;
    private boolean connected = false;
    private boolean authenticated = false;
    private boolean joined = false;
    private boolean intentionallyLeft = false;
    private int reconnectAttempts = 0;
    private boolean waitingForAuth = false;
    private boolean joinRequested = false;
    private ScheduledFuture<?> heartbeatFuture;
    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(1);
    private String userId;
    private String connectionId;
    private String connectionState = "idle";
    private Map<String, Object> reconnectInfo;

    private final ConcurrentHashMap<String, CompletableFuture<Object>> pendingRequests = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, CompletableFuture<Void>> pendingSignalRequests = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, CompletableFuture<Void>> pendingAdminRequests = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, CompletableFuture<Void>> pendingMemberStateRequests = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, CompletableFuture<Void>> pendingMediaRequests = new ConcurrentHashMap<>();

    private final List<BiConsumer<Map<String, Object>, Map<String, Object>>> sharedStateHandlers = new CopyOnWriteArrayList<>();
    private final List<BiConsumer<Map<String, Object>, Map<String, Object>>> playerStateHandlers = new CopyOnWriteArrayList<>();
    private final ConcurrentHashMap<String, List<Consumer<Object>>> messageHandlers = new ConcurrentHashMap<>();
    private final List<BiConsumer<String, Object>> allMessageHandlers = new CopyOnWriteArrayList<>();
    private final List<Consumer<Map<String, String>>> errorHandlers = new CopyOnWriteArrayList<>();
    private final List<Runnable> kickedHandlers = new CopyOnWriteArrayList<>();
    private volatile int lastCloseCode = 0;
    private final List<Consumer<List<Map<String, Object>>>> membersSyncHandlers = new CopyOnWriteArrayList<>();
    private final List<Consumer<Map<String, Object>>> memberJoinHandlers = new CopyOnWriteArrayList<>();
    private final List<BiConsumer<Map<String, Object>, String>> memberLeaveHandlers = new CopyOnWriteArrayList<>();
    private final List<BiConsumer<Map<String, Object>, Map<String, Object>>> memberStateHandlers = new CopyOnWriteArrayList<>();
    private final ConcurrentHashMap<String, List<BiConsumer<Object, Map<String, Object>>>> signalHandlers = new ConcurrentHashMap<>();
    private final List<AnySignalHandler> anySignalHandlers = new CopyOnWriteArrayList<>();
    private final List<BiConsumer<Map<String, Object>, Map<String, Object>>> mediaTrackHandlers = new CopyOnWriteArrayList<>();
    private final List<BiConsumer<Map<String, Object>, Map<String, Object>>> mediaTrackRemovedHandlers = new CopyOnWriteArrayList<>();
    private final List<BiConsumer<Map<String, Object>, Map<String, Object>>> mediaStateHandlers = new CopyOnWriteArrayList<>();
    private final List<BiConsumer<Map<String, Object>, Map<String, Object>>> mediaDeviceHandlers = new CopyOnWriteArrayList<>();
    private final List<Consumer<Map<String, Object>>> reconnectHandlers = new CopyOnWriteArrayList<>();
    private final List<Consumer<String>> connectionStateHandlers = new CopyOnWriteArrayList<>();

    public RoomClient(String baseUrl, String namespace, String roomId, Supplier<String> tokenSupplier) {
        this(baseUrl, null, namespace, roomId, tokenSupplier, null, 10, 1000L, 10000L);
    }

    public RoomClient(String baseUrl, HttpClient httpClient, String namespace, String roomId, Supplier<String> tokenSupplier) {
        this(baseUrl, httpClient, namespace, roomId, tokenSupplier, null, 10, 1000L, 10000L);
    }

    public RoomClient(
            String baseUrl,
            HttpClient httpClient,
            String namespace,
            String roomId,
            Supplier<String> tokenSupplier,
            AuthStateListenerRegistrar authStateListenerRegistrar
    ) {
        this(baseUrl, httpClient, namespace, roomId, tokenSupplier, authStateListenerRegistrar, 10, 1000L, 10000L);
    }

    public RoomClient(
            String baseUrl,
            String namespace,
            String roomId,
            Supplier<String> tokenSupplier,
            int maxReconnectAttempts,
            long reconnectBaseDelayMs,
            long sendTimeoutMs
    ) {
        this(baseUrl, null, namespace, roomId, tokenSupplier, null, maxReconnectAttempts, reconnectBaseDelayMs, sendTimeoutMs);
    }

    public RoomClient(
            String baseUrl,
            HttpClient httpClient,
            String namespace,
            String roomId,
            Supplier<String> tokenSupplier,
            int maxReconnectAttempts,
            long reconnectBaseDelayMs,
            long sendTimeoutMs
    ) {
        this(baseUrl, httpClient, namespace, roomId, tokenSupplier, null, maxReconnectAttempts, reconnectBaseDelayMs, sendTimeoutMs);
    }

    public RoomClient(
            String baseUrl,
            HttpClient httpClient,
            String namespace,
            String roomId,
            Supplier<String> tokenSupplier,
            AuthStateListenerRegistrar authStateListenerRegistrar,
            int maxReconnectAttempts,
            long reconnectBaseDelayMs,
            long sendTimeoutMs
    ) {
        this.baseUrl = baseUrl.replaceAll("/$", "");
        this.httpClient = httpClient;
        this.namespace = namespace;
        this.roomId = roomId;
        this.tokenSupplier = tokenSupplier;
        this.authStateListenerRegistrar = authStateListenerRegistrar;
        this.maxReconnectAttempts = maxReconnectAttempts;
        this.reconnectBaseDelayMs = reconnectBaseDelayMs;
        this.sendTimeoutMs = sendTimeoutMs;
        this.state = new RoomStateNamespace();
        this.meta = new RoomMetaNamespace();
        this.signals = new RoomSignalsNamespace();
        this.members = new RoomMembersNamespace();
        this.admin = new RoomAdminNamespace();
        this.media = new RoomMediaNamespace();
        this.session = new RoomSessionNamespace();
        if (authStateListenerRegistrar != null) {
            authStateListenerRegistrar.register(this::handleAuthStateChange);
        }
    }

    public Map<String, Object> getSharedState() {
        synchronized (stateLock) {
            return cloneMap(sharedState);
        }
    }

    public Map<String, Object> getPlayerState() {
        synchronized (stateLock) {
            return cloneMap(playerState);
        }
    }

    public List<Map<String, Object>> listMembers() {
        synchronized (stateLock) {
            return cloneMemberList(roomMembers);
        }
    }

    public List<Map<String, Object>> listMediaMembers() {
        synchronized (stateLock) {
            return cloneMemberList(mediaMembers);
        }
    }

    public String connectionState() {
        return connectionState;
    }

    public String userId() {
        return userId;
    }

    public String connectionId() {
        return connectionId;
    }

    void attachSocketForTesting(RoomSocket socket, boolean connected, boolean authenticated, boolean joined) {
        this.ws = socket;
        this.connected = connected;
        this.authenticated = authenticated;
        this.joined = joined;
    }

    void handleRawForTesting(String raw) {
        onMessage(raw);
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> getMetadata() {
        if (httpClient != null) {
            Map<String, String> query = new LinkedHashMap<>();
            query.put("namespace", namespace);
            query.put("id", roomId);
            GeneratedDbApi coreApi = new GeneratedDbApi(httpClient);
            Object result = coreApi.getRoomMetadata(query);
            if (result instanceof Map<?, ?> map) {
                return (Map<String, Object>) deepClone(map);
            }
            return new HashMap<>();
        }
        return getMetadata(baseUrl, namespace, roomId);
    }

    public static Map<String, Object> getMetadata(String baseUrl, String namespace, String roomId) {
        try {
            String url = baseUrl.replaceAll("/$", "") + GeneratedDbApi.ApiPaths.GET_ROOM_METADATA
                    + "?namespace=" + encodeURIComponent(namespace)
                    + "&id=" + encodeURIComponent(roomId);
            HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setRequestMethod("GET");
            conn.setRequestProperty("Accept", "application/json");

            int status = conn.getResponseCode();
            if (status != 200) {
                throw new EdgeBaseError(status, "Failed to get room metadata: " + status);
            }

            try (var in = conn.getInputStream()) {
                String body = new String(in.readAllBytes(), StandardCharsets.UTF_8);
                return jsonObjectToMap(new JSONObject(body));
            }
        } catch (EdgeBaseError e) {
            throw e;
        } catch (Exception e) {
            throw new EdgeBaseError(500, "Failed to get room metadata: " + e.getMessage());
        }
    }

    public CompletableFuture<Map<String, Object>> requestCloudflareRealtimeKitMedia(String path, String method, Map<String, Object> payload) {
        return CompletableFuture.supplyAsync(() ->
                requestRoomMedia("cloudflare_realtimekit", path, method, payload)
        );
    }

    public CompletableFuture<Map<String, Object>> requestCloudflareRealtimeKitMedia(String path, String method) {
        return requestCloudflareRealtimeKitMedia(path, method, new LinkedHashMap<>());
    }

    public Map<String, Object> requestRoomMedia(String providerPath, String path, String method, Map<String, Object> payload) {
        try {
            String token = tokenSupplier.get();
            if (token == null || token.isBlank()) {
                throw new EdgeBaseError(401, "Authentication required");
            }

            String url = baseUrl.replaceAll("/$", "") + "/api/room/media/" + providerPath + "/" + path
                    + "?namespace=" + encodeURIComponent(namespace)
                    + "&id=" + encodeURIComponent(roomId);

            HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setRequestMethod(method);
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("Authorization", "Bearer " + token);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setDoInput(true);
            if (!"GET".equals(method)) {
                conn.setDoOutput(true);
                byte[] body = new JSONObject(payload == null ? Map.of() : payload).toString().getBytes(StandardCharsets.UTF_8);
                conn.getOutputStream().write(body);
            }

            int status = conn.getResponseCode();
            byte[] bytes;
            try (var stream = status >= 400 ? conn.getErrorStream() : conn.getInputStream()) {
                bytes = stream == null ? new byte[0] : stream.readAllBytes();
            }
            String body = new String(bytes, StandardCharsets.UTF_8);
            if (status < 200 || status >= 300) {
                String message = "Room media request failed: " + status;
                if (!body.isBlank()) {
                    JSONObject errorJson = new JSONObject(body);
                    message = errorJson.optString("message", message);
                }
                throw new EdgeBaseError(status, message);
            }

            if (body.isBlank()) {
                return new LinkedHashMap<>();
            }
            return jsonObjectToMap(new JSONObject(body));
        } catch (EdgeBaseError e) {
            throw e;
        } catch (Exception e) {
            throw new EdgeBaseError(500, "Failed to request room media: " + e.getMessage());
        }
    }

    public void join() {
        intentionallyLeft = false;
        joinRequested = true;
        setConnectionState(reconnectInfo != null ? "reconnecting" : "connecting");
        if (!connected) {
            establish();
        }
    }

    public void leave() {
        intentionallyLeft = true;
        joinRequested = false;
        waitingForAuth = false;
        if (heartbeatFuture != null) {
            heartbeatFuture.cancel(true);
        }

        for (Map.Entry<String, CompletableFuture<Object>> entry : pendingRequests.entrySet()) {
            entry.getValue().completeExceptionally(new EdgeBaseError(499, "Room left"));
        }
        pendingRequests.clear();
        rejectPendingVoidRequests(pendingSignalRequests, new EdgeBaseError(499, "Room left"));
        rejectPendingVoidRequests(pendingAdminRequests, new EdgeBaseError(499, "Room left"));
        rejectPendingVoidRequests(pendingMemberStateRequests, new EdgeBaseError(499, "Room left"));
        rejectPendingVoidRequests(pendingMediaRequests, new EdgeBaseError(499, "Room left"));

        RoomSocket socket = ws;
        sendLeaveAndClose(socket);
        ws = null;
        connected = false;
        authenticated = false;
        joined = false;
        reconnectAttempts = 0;
        reconnectInfo = null;
        userId = null;
        connectionId = null;
        synchronized (stateLock) {
            sharedState = new ConcurrentHashMap<>();
            sharedVersion = 0;
            playerState = new ConcurrentHashMap<>();
            playerVersion = 0;
            roomMembers = new ArrayList<>();
            mediaMembers = new ArrayList<>();
        }
        setConnectionState("idle");
    }

    public CompletableFuture<Object> send(String actionType, Object payload) {
        if (!connected || !authenticated) {
            CompletableFuture<Object> future = new CompletableFuture<>();
            future.completeExceptionally(new EdgeBaseError(400, "Not connected to room"));
            return future;
        }

        String requestId = UUID.randomUUID().toString();
        CompletableFuture<Object> future = new CompletableFuture<Object>().orTimeout(sendTimeoutMs, TimeUnit.MILLISECONDS);
        future.whenComplete((result, error) -> pendingRequests.remove(requestId));

        pendingRequests.put(requestId, future);

        Map<String, Object> msg = new HashMap<>();
        msg.put("type", "send");
        msg.put("actionType", actionType);
        msg.put("payload", payload != null ? payload : Collections.emptyMap());
        msg.put("requestId", requestId);
        sendRaw(new JSONObject(msg));
        return future;
    }

    public CompletableFuture<Void> sendSignal(String event, Object payload, Map<String, Object> options) {
        if (!connected || !authenticated) {
            return CompletableFuture.failedFuture(new EdgeBaseError(400, "Not connected to room"));
        }
        String requestId = UUID.randomUUID().toString();
        CompletableFuture<Void> future = registerPendingVoid(pendingSignalRequests, requestId, "Signal '" + event + "' timed out");
        Map<String, Object> msg = new HashMap<>();
        msg.put("type", "signal");
        msg.put("event", event);
        msg.put("payload", payload != null ? payload : Collections.emptyMap());
        msg.put("requestId", requestId);
        if (options != null) {
            Object includeSelf = options.get("includeSelf");
            Object memberId = options.get("memberId");
            if (includeSelf instanceof Boolean) {
                msg.put("includeSelf", includeSelf);
            }
            if (memberId instanceof String) {
                msg.put("memberId", memberId);
            }
        }
        sendRaw(new JSONObject(msg));
        return future;
    }

    public CompletableFuture<Void> sendSignal(String event, Object payload) {
        return sendSignal(event, payload, Collections.emptyMap());
    }

    public CompletableFuture<Void> sendMemberState(Map<String, Object> state) {
        if (!connected || !authenticated) {
            return CompletableFuture.failedFuture(new EdgeBaseError(400, "Not connected to room"));
        }
        String requestId = UUID.randomUUID().toString();
        CompletableFuture<Void> future = registerPendingVoid(pendingMemberStateRequests, requestId, "Member state update timed out");
        Map<String, Object> msg = new HashMap<>();
        msg.put("type", "member_state");
        msg.put("state", state);
        msg.put("requestId", requestId);
        sendRaw(new JSONObject(msg));
        return future;
    }

    public CompletableFuture<Void> clearMemberState() {
        if (!connected || !authenticated) {
            return CompletableFuture.failedFuture(new EdgeBaseError(400, "Not connected to room"));
        }
        String requestId = UUID.randomUUID().toString();
        CompletableFuture<Void> future = registerPendingVoid(pendingMemberStateRequests, requestId, "Member state clear timed out");
        Map<String, Object> msg = new HashMap<>();
        msg.put("type", "member_state_clear");
        msg.put("requestId", requestId);
        sendRaw(new JSONObject(msg));
        return future;
    }

    public CompletableFuture<Void> sendAdmin(String operation, String memberId, Map<String, Object> payload) {
        if (!connected || !authenticated) {
            return CompletableFuture.failedFuture(new EdgeBaseError(400, "Not connected to room"));
        }
        String requestId = UUID.randomUUID().toString();
        CompletableFuture<Void> future = registerPendingVoid(pendingAdminRequests, requestId, "Admin operation '" + operation + "' timed out");
        Map<String, Object> msg = new HashMap<>();
        msg.put("type", "admin");
        msg.put("operation", operation);
        msg.put("memberId", memberId);
        msg.put("payload", payload != null ? payload : Collections.emptyMap());
        msg.put("requestId", requestId);
        sendRaw(new JSONObject(msg));
        return future;
    }

    public CompletableFuture<Void> sendAdmin(String operation, String memberId) {
        return sendAdmin(operation, memberId, Collections.emptyMap());
    }

    public CompletableFuture<Void> sendMedia(String operation, String kind, Map<String, Object> payload) {
        if (!connected || !authenticated) {
            return CompletableFuture.failedFuture(new EdgeBaseError(400, "Not connected to room"));
        }
        String requestId = UUID.randomUUID().toString();
        CompletableFuture<Void> future = registerPendingVoid(pendingMediaRequests, requestId, "Media operation '" + operation + "' timed out");
        Map<String, Object> msg = new HashMap<>();
        msg.put("type", "media");
        msg.put("operation", operation);
        msg.put("kind", kind);
        msg.put("payload", payload != null ? payload : Collections.emptyMap());
        msg.put("requestId", requestId);
        sendRaw(new JSONObject(msg));
        return future;
    }

    public CompletableFuture<Void> sendMedia(String operation, String kind) {
        return sendMedia(operation, kind, Collections.emptyMap());
    }

    public CompletableFuture<Void> switchMediaDevices(Map<String, Object> payload) {
        List<CompletableFuture<Void>> futures = new ArrayList<>();
        if (payload.get("audioInputId") instanceof String audioInputId) {
            futures.add(sendMedia("device", "audio", Map.of("deviceId", audioInputId)));
        }
        if (payload.get("videoInputId") instanceof String videoInputId) {
            futures.add(sendMedia("device", "video", Map.of("deviceId", videoInputId)));
        }
        if (payload.get("screenInputId") instanceof String screenInputId) {
            futures.add(sendMedia("device", "screen", Map.of("deviceId", screenInputId)));
        }
        return CompletableFuture.allOf(futures.toArray(CompletableFuture[]::new));
    }

    public Subscription onSharedState(BiConsumer<Map<String, Object>, Map<String, Object>> handler) {
        sharedStateHandlers.add(handler);
        return () -> sharedStateHandlers.remove(handler);
    }

    public Subscription onPlayerState(BiConsumer<Map<String, Object>, Map<String, Object>> handler) {
        playerStateHandlers.add(handler);
        return () -> playerStateHandlers.remove(handler);
    }

    public Subscription onMessage(String messageType, Consumer<Object> handler) {
        messageHandlers.computeIfAbsent(messageType, ignored -> new CopyOnWriteArrayList<>()).add(handler);
        return () -> {
            List<Consumer<Object>> handlers = messageHandlers.get(messageType);
            if (handlers != null) {
                handlers.remove(handler);
            }
        };
    }

    public Subscription onAnyMessage(BiConsumer<String, Object> handler) {
        allMessageHandlers.add(handler);
        return () -> allMessageHandlers.remove(handler);
    }

    public Subscription onError(Consumer<Map<String, String>> handler) {
        errorHandlers.add(handler);
        return () -> errorHandlers.remove(handler);
    }

    public Subscription onKicked(Runnable handler) {
        kickedHandlers.add(handler);
        return () -> kickedHandlers.remove(handler);
    }

    public Subscription onMembersSync(Consumer<List<Map<String, Object>>> handler) {
        membersSyncHandlers.add(handler);
        return () -> membersSyncHandlers.remove(handler);
    }

    public Subscription onMemberJoin(Consumer<Map<String, Object>> handler) {
        memberJoinHandlers.add(handler);
        return () -> memberJoinHandlers.remove(handler);
    }

    public Subscription onMemberLeave(BiConsumer<Map<String, Object>, String> handler) {
        memberLeaveHandlers.add(handler);
        return () -> memberLeaveHandlers.remove(handler);
    }

    public Subscription onMemberStateChange(BiConsumer<Map<String, Object>, Map<String, Object>> handler) {
        memberStateHandlers.add(handler);
        return () -> memberStateHandlers.remove(handler);
    }

    public Subscription onSignal(String event, BiConsumer<Object, Map<String, Object>> handler) {
        signalHandlers.computeIfAbsent(event, ignored -> new CopyOnWriteArrayList<>()).add(handler);
        return () -> {
            List<BiConsumer<Object, Map<String, Object>>> handlers = signalHandlers.get(event);
            if (handlers != null) {
                handlers.remove(handler);
            }
        };
    }

    public Subscription onAnySignal(AnySignalHandler handler) {
        anySignalHandlers.add(handler);
        return () -> anySignalHandlers.remove(handler);
    }

    public Subscription onMediaTrack(BiConsumer<Map<String, Object>, Map<String, Object>> handler) {
        mediaTrackHandlers.add(handler);
        return () -> mediaTrackHandlers.remove(handler);
    }

    public Subscription onMediaTrackRemoved(BiConsumer<Map<String, Object>, Map<String, Object>> handler) {
        mediaTrackRemovedHandlers.add(handler);
        return () -> mediaTrackRemovedHandlers.remove(handler);
    }

    public Subscription onMediaStateChange(BiConsumer<Map<String, Object>, Map<String, Object>> handler) {
        mediaStateHandlers.add(handler);
        return () -> mediaStateHandlers.remove(handler);
    }

    public Subscription onMediaDeviceChange(BiConsumer<Map<String, Object>, Map<String, Object>> handler) {
        mediaDeviceHandlers.add(handler);
        return () -> mediaDeviceHandlers.remove(handler);
    }

    public Subscription onReconnect(Consumer<Map<String, Object>> handler) {
        reconnectHandlers.add(handler);
        return () -> reconnectHandlers.remove(handler);
    }

    public Subscription onConnectionStateChange(Consumer<String> handler) {
        connectionStateHandlers.add(handler);
        return () -> connectionStateHandlers.remove(handler);
    }

    private String wsUrl() {
        String u = baseUrl.replace("https://", "wss://").replace("http://", "ws://");
        return u + GeneratedDbApi.ApiPaths.CONNECT_ROOM + "?namespace=" + encodeURIComponent(namespace) + "&id=" + encodeURIComponent(roomId);
    }

    private void establish() {
        setConnectionState(reconnectInfo != null ? "reconnecting" : "connecting");
        try {
            String token = tokenSupplier.get();
            if (token == null || token.isEmpty()) {
                boolean hasSession = authStateListenerRegistrar != null;
                throw new EdgeBaseError(401, hasSession
                        ? "Room is waiting for an active access token."
                        : "No access token available. Sign in first.");
            }
            WebSocketClientWrapper socket = new WebSocketClientWrapper(new URI(wsUrl()), this::onMessage, this::onClose);
            socket.connect();
            ws = socket;
            connected = true;
            reconnectAttempts = 0;
            sendRawUnauthenticated(new JSONObject(Map.of("type", "auth", "token", token)));
        } catch (Exception e) {
            handleAuthenticationFailure(e);
        }
    }

    private void onMessage(String raw) {
        JSONObject msg;
        try {
            msg = new JSONObject(raw);
        } catch (Exception ignored) {
            return;
        }

        String type = msg.optString("type");
        if ("auth_success".equals(type) || "auth_refreshed".equals(type)) {
            handleAuthSuccess(msg);
            if (!authenticated) {
                authenticated = true;
                waitingForAuth = false;

                synchronized (stateLock) {
                    Map<String, Object> joinMsg = new HashMap<>();
                    joinMsg.put("type", "join");
                    joinMsg.put("lastSharedState", cloneMap(sharedState));
                    joinMsg.put("lastSharedVersion", sharedVersion);
                    joinMsg.put("lastPlayerState", cloneMap(playerState));
                    joinMsg.put("lastPlayerVersion", playerVersion);
                    sendRaw(new JSONObject(joinMsg));
                }
                joined = true;
                startHeartbeat();
            }
            return;
        }

        switch (type) {
            case "sync" -> handleSync(msg);
            case "shared_delta" -> handleSharedDelta(msg);
            case "player_delta" -> handlePlayerDelta(msg);
            case "action_result" -> handleActionResult(msg);
            case "action_error" -> handleActionError(msg);
            case "message" -> handleServerMessage(msg);
            case "signal" -> handleSignalFrame(msg);
            case "signal_sent" -> resolvePendingVoidRequest(pendingSignalRequests, msg.optString("requestId", null));
            case "signal_error" -> rejectPendingVoidRequest(pendingSignalRequests, msg.optString("requestId", null),
                    new EdgeBaseError(400, msg.optString("message", "Signal send failed")));
            case "members_sync" -> handleMembersSync(msg);
            case "member_join" -> handleMemberJoinFrame(msg);
            case "member_leave" -> handleMemberLeaveFrame(msg);
            case "member_state" -> handleMemberStateFrame(msg);
            case "member_state_error" -> rejectPendingVoidRequest(pendingMemberStateRequests, msg.optString("requestId", null),
                    new EdgeBaseError(400, msg.optString("message", "Member state update failed")));
            case "admin_result" -> resolvePendingVoidRequest(pendingAdminRequests, msg.optString("requestId", null));
            case "admin_error" -> rejectPendingVoidRequest(pendingAdminRequests, msg.optString("requestId", null),
                    new EdgeBaseError(400, msg.optString("message", "Admin operation failed")));
            case "media_sync" -> handleMediaSync(msg);
            case "media_track" -> handleMediaTrackFrame(msg);
            case "media_track_removed" -> handleMediaTrackRemovedFrame(msg);
            case "media_state" -> handleMediaStateFrame(msg);
            case "media_device" -> handleMediaDeviceFrame(msg);
            case "media_result" -> resolvePendingVoidRequest(pendingMediaRequests, msg.optString("requestId", null));
            case "media_error" -> rejectPendingVoidRequest(pendingMediaRequests, msg.optString("requestId", null),
                    new EdgeBaseError(400, msg.optString("message", "Media operation failed")));
            case "kicked" -> handleKicked();
            case "error" -> handleError(msg);
            case "pong" -> {
                // Heartbeat response.
            }
            default -> {
                // Ignore unknown frames.
            }
        }
    }

    private void handleAuthSuccess(JSONObject msg) {
        String nextUserId = msg.optString("userId", null);
        String nextConnectionId = msg.optString("connectionId", null);
        if (nextUserId != null && !nextUserId.isEmpty()) {
            userId = nextUserId;
        }
        if (nextConnectionId != null && !nextConnectionId.isEmpty()) {
            connectionId = nextConnectionId;
        }
    }

    private void handleSync(JSONObject msg) {
        synchronized (stateLock) {
            sharedState = jsonObjectToMap(msg.optJSONObject("sharedState"));
            sharedVersion = msg.optInt("sharedVersion", 0);
            playerState = jsonObjectToMap(msg.optJSONObject("playerState"));
            playerVersion = msg.optInt("playerVersion", 0);
        }

        setConnectionState("connected");

        Map<String, Object> reconnectSnapshot = reconnectInfo != null ? cloneMap(reconnectInfo) : null;
        reconnectInfo = null;
        if (reconnectSnapshot != null) {
            for (Consumer<Map<String, Object>> handler : reconnectHandlers) {
                handler.accept(cloneMap(reconnectSnapshot));
            }
        }

        Map<String, Object> sharedSnapshot = getSharedState();
        Map<String, Object> playerSnapshot = getPlayerState();
        for (BiConsumer<Map<String, Object>, Map<String, Object>> handler : sharedStateHandlers) {
            handler.accept(cloneMap(sharedSnapshot), cloneMap(sharedSnapshot));
        }
        for (BiConsumer<Map<String, Object>, Map<String, Object>> handler : playerStateHandlers) {
            handler.accept(cloneMap(playerSnapshot), cloneMap(playerSnapshot));
        }
    }

    private void handleSharedDelta(JSONObject msg) {
        Map<String, Object> delta = jsonObjectToMap(msg.optJSONObject("delta"));
        synchronized (stateLock) {
            sharedVersion = msg.optInt("version", sharedVersion);
            for (Map.Entry<String, Object> entry : delta.entrySet()) {
                deepSet(sharedState, entry.getKey(), entry.getValue());
            }
        }

        Map<String, Object> sharedSnapshot = getSharedState();
        for (BiConsumer<Map<String, Object>, Map<String, Object>> handler : sharedStateHandlers) {
            handler.accept(cloneMap(sharedSnapshot), cloneMap(delta));
        }
    }

    private void handlePlayerDelta(JSONObject msg) {
        Map<String, Object> delta = jsonObjectToMap(msg.optJSONObject("delta"));
        synchronized (stateLock) {
            playerVersion = msg.optInt("version", playerVersion);
            for (Map.Entry<String, Object> entry : delta.entrySet()) {
                deepSet(playerState, entry.getKey(), entry.getValue());
            }
        }

        Map<String, Object> playerSnapshot = getPlayerState();
        for (BiConsumer<Map<String, Object>, Map<String, Object>> handler : playerStateHandlers) {
            handler.accept(cloneMap(playerSnapshot), cloneMap(delta));
        }
    }

    private void handleActionResult(JSONObject msg) {
        String requestId = msg.optString("requestId", null);
        if (requestId == null) {
            return;
        }
        CompletableFuture<Object> future = pendingRequests.remove(requestId);
        if (future != null) {
            future.complete(jsonValueToJava(msg.opt("result")));
        }
    }

    private void handleActionError(JSONObject msg) {
        String requestId = msg.optString("requestId", null);
        if (requestId == null) {
            return;
        }
        CompletableFuture<Object> future = pendingRequests.remove(requestId);
        if (future != null) {
            future.completeExceptionally(new EdgeBaseError(400, msg.optString("message", "Action error")));
        }
    }

    private void handleServerMessage(JSONObject msg) {
        String messageType = msg.optString("messageType", "");
        Object data = jsonValueToJava(msg.opt("data"));
        List<Consumer<Object>> handlers = messageHandlers.get(messageType);
        if (handlers != null) {
            for (Consumer<Object> handler : handlers) {
                handler.accept(deepClone(data));
            }
        }
        for (BiConsumer<String, Object> handler : allMessageHandlers) {
            handler.accept(messageType, deepClone(data));
        }
    }

    private void handleSignalFrame(JSONObject msg) {
        String event = msg.optString("event", "");
        if (event.isEmpty()) {
            return;
        }
        Object payload = jsonValueToJava(msg.opt("payload"));
        Map<String, Object> meta = normalizeSignalMeta(jsonValueToJava(msg.opt("meta")));

        List<BiConsumer<Object, Map<String, Object>>> handlers = signalHandlers.get(event);
        if (handlers != null) {
            for (BiConsumer<Object, Map<String, Object>> handler : handlers) {
                handler.accept(deepClone(payload), cloneMap(meta));
            }
        }
        for (AnySignalHandler handler : anySignalHandlers) {
            handler.accept(event, deepClone(payload), cloneMap(meta));
        }
    }

    private void handleMembersSync(JSONObject msg) {
        List<Map<String, Object>> normalized = normalizeMembers(jsonValueToJava(msg.opt("members")));
        synchronized (stateLock) {
            roomMembers = normalized;
            Set<String> memberIds = ConcurrentHashMap.newKeySet();
            for (Map<String, Object> member : roomMembers) {
                Object memberId = member.get("memberId");
                if (memberId instanceof String id) {
                    memberIds.add(id);
                }
            }

            List<Map<String, Object>> nextMediaMembers = new ArrayList<>();
            for (Map<String, Object> mediaMember : mediaMembers) {
                Map<String, Object> member = safeMap(mediaMember.get("member"));
                Object memberId = member.get("memberId");
                if (memberId instanceof String id && memberIds.contains(id)) {
                    nextMediaMembers.add(cloneMap(mediaMember));
                }
            }
            mediaMembers = nextMediaMembers;
            for (Map<String, Object> member : roomMembers) {
                syncMediaMemberInfo(member);
            }
        }

        List<Map<String, Object>> snapshot = listMembers();
        for (Consumer<List<Map<String, Object>>> handler : membersSyncHandlers) {
            handler.accept(cloneMemberList(snapshot));
        }
    }

    private void handleMemberJoinFrame(JSONObject msg) {
        Map<String, Object> member = normalizeMember(jsonValueToJava(msg.opt("member")));
        if (member == null) {
            return;
        }

        synchronized (stateLock) {
            upsertMember(member);
            syncMediaMemberInfo(member);
        }

        for (Consumer<Map<String, Object>> handler : memberJoinHandlers) {
            handler.accept(cloneMap(member));
        }
    }

    private void handleMemberLeaveFrame(JSONObject msg) {
        Map<String, Object> member = normalizeMember(jsonValueToJava(msg.opt("member")));
        if (member == null) {
            return;
        }

        String memberId = Objects.toString(member.get("memberId"), "");
        synchronized (stateLock) {
            removeMember(memberId);
            removeMediaMember(memberId);
        }

        String reason = normalizeLeaveReason(jsonValueToJava(msg.opt("reason")));
        for (BiConsumer<Map<String, Object>, String> handler : memberLeaveHandlers) {
            handler.accept(cloneMap(member), reason);
        }
    }

    private void handleMemberStateFrame(JSONObject msg) {
        Map<String, Object> member = normalizeMember(jsonValueToJava(msg.opt("member")));
        Map<String, Object> state = normalizeState(jsonValueToJava(msg.opt("state")));
        if (member == null) {
            return;
        }
        member.put("state", cloneMap(state));

        synchronized (stateLock) {
            upsertMember(member);
            syncMediaMemberInfo(member);
        }

        String requestId = msg.optString("requestId", null);
        if (requestId != null && Objects.equals(member.get("memberId"), userId)) {
            resolvePendingVoidRequest(pendingMemberStateRequests, requestId);
        }

        for (BiConsumer<Map<String, Object>, Map<String, Object>> handler : memberStateHandlers) {
            handler.accept(cloneMap(member), cloneMap(state));
        }
    }

    private void handleMediaSync(JSONObject msg) {
        List<Map<String, Object>> normalized = normalizeMediaMembers(jsonValueToJava(msg.opt("members")));
        synchronized (stateLock) {
            mediaMembers = normalized;
            for (Map<String, Object> member : roomMembers) {
                syncMediaMemberInfo(member);
            }
        }
    }

    private void handleMediaTrackFrame(JSONObject msg) {
        Map<String, Object> member = normalizeMember(jsonValueToJava(msg.opt("member")));
        Map<String, Object> track = normalizeMediaTrack(jsonValueToJava(msg.opt("track")));
        if (member == null || track == null) {
            return;
        }

        Map<String, Object> mediaMember;
        synchronized (stateLock) {
            mediaMember = ensureMediaMember(member);
            upsertMediaTrack(mediaMember, track);
            Map<String, Object> partial = new HashMap<>();
            partial.put("published", Boolean.TRUE);
            partial.put("muted", Boolean.TRUE.equals(track.get("muted")));
            partial.put("trackId", track.get("trackId"));
            partial.put("deviceId", track.get("deviceId"));
            partial.put("publishedAt", track.get("publishedAt"));
            partial.put("adminDisabled", track.get("adminDisabled"));
            mergeMediaState(mediaMember, Objects.toString(track.get("kind"), ""), partial);
        }

        Map<String, Object> memberSnapshot = cloneMap(safeMap(mediaMember.get("member")));
        Map<String, Object> trackSnapshot = cloneMap(track);
        for (BiConsumer<Map<String, Object>, Map<String, Object>> handler : mediaTrackHandlers) {
            handler.accept(trackSnapshot, memberSnapshot);
        }
    }

    private void handleMediaTrackRemovedFrame(JSONObject msg) {
        Map<String, Object> member = normalizeMember(jsonValueToJava(msg.opt("member")));
        Map<String, Object> track = normalizeMediaTrack(jsonValueToJava(msg.opt("track")));
        if (member == null || track == null) {
            return;
        }

        Map<String, Object> mediaMember;
        synchronized (stateLock) {
            mediaMember = ensureMediaMember(member);
            removeMediaTrack(mediaMember, track);
            String kind = Objects.toString(track.get("kind"), "");
            Map<String, Object> state = safeMap(mediaMember.get("state"));
            state = cloneMap(state);
            state.put(kind, new HashMap<>(Map.of(
                    "published", Boolean.FALSE,
                    "muted", Boolean.FALSE,
                    "adminDisabled", Boolean.FALSE
            )));
            mediaMember.put("state", state);
        }

        Map<String, Object> memberSnapshot = cloneMap(safeMap(mediaMember.get("member")));
        Map<String, Object> trackSnapshot = cloneMap(track);
        for (BiConsumer<Map<String, Object>, Map<String, Object>> handler : mediaTrackRemovedHandlers) {
            handler.accept(trackSnapshot, memberSnapshot);
        }
    }

    private void handleMediaStateFrame(JSONObject msg) {
        Map<String, Object> member = normalizeMember(jsonValueToJava(msg.opt("member")));
        if (member == null) {
            return;
        }

        Map<String, Object> mediaMember;
        synchronized (stateLock) {
            mediaMember = ensureMediaMember(member);
            mediaMember.put("state", normalizeMediaState(jsonValueToJava(msg.opt("state"))));
        }

        Map<String, Object> memberSnapshot = cloneMap(safeMap(mediaMember.get("member")));
        Map<String, Object> stateSnapshot = cloneMap(safeMap(mediaMember.get("state")));
        for (BiConsumer<Map<String, Object>, Map<String, Object>> handler : mediaStateHandlers) {
            handler.accept(memberSnapshot, stateSnapshot);
        }
    }

    private void handleMediaDeviceFrame(JSONObject msg) {
        Map<String, Object> member = normalizeMember(jsonValueToJava(msg.opt("member")));
        String kind = normalizeMediaKind(jsonValueToJava(msg.opt("kind")));
        String deviceId = msg.optString("deviceId", "");
        if (member == null || kind == null || deviceId.isEmpty()) {
            return;
        }

        Map<String, Object> mediaMember;
        synchronized (stateLock) {
            mediaMember = ensureMediaMember(member);
            mergeMediaState(mediaMember, kind, Map.of("deviceId", deviceId));
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> tracks = (List<Map<String, Object>>) mediaMember.get("tracks");
            List<Map<String, Object>> nextTracks = new ArrayList<>();
            for (Map<String, Object> track : tracks) {
                Map<String, Object> nextTrack = cloneMap(track);
                if (kind.equals(nextTrack.get("kind"))) {
                    nextTrack.put("deviceId", deviceId);
                }
                nextTracks.add(nextTrack);
            }
            mediaMember.put("tracks", nextTracks);
        }

        Map<String, Object> memberSnapshot = cloneMap(safeMap(mediaMember.get("member")));
        Map<String, Object> change = new HashMap<>();
        change.put("kind", kind);
        change.put("deviceId", deviceId);
        for (BiConsumer<Map<String, Object>, Map<String, Object>> handler : mediaDeviceHandlers) {
            handler.accept(memberSnapshot, cloneMap(change));
        }
    }

    private void handleKicked() {
        for (Runnable handler : kickedHandlers) {
            handler.run();
        }
        intentionallyLeft = true;
        joinRequested = false;
        reconnectInfo = null;
        setConnectionState("kicked");
    }

    private void handleError(JSONObject msg) {
        Map<String, String> err = Map.of(
                "code", msg.optString("code", ""),
                "message", msg.optString("message", "")
        );
        for (Consumer<Map<String, String>> handler : errorHandlers) {
            handler.accept(err);
        }
    }

    private void onClose() {
        if (heartbeatFuture != null) {
            heartbeatFuture.cancel(true);
        }
        connected = false;
        authenticated = false;
        joined = false;
        ws = null;
        if (!intentionallyLeft) {
            rejectAllPending(new EdgeBaseError(499, "WebSocket connection lost"));
        }
        if (lastCloseCode == 4004 && !"kicked".equals(connectionState)) {
            handleKicked();
        }
        lastCloseCode = 0;

        if (!intentionallyLeft && !waitingForAuth && reconnectAttempts < maxReconnectAttempts
                && !"kicked".equals(connectionState) && !"auth_lost".equals(connectionState)) {
            int attempt = reconnectAttempts + 1;
            long baseDelay = Math.min(reconnectBaseDelayMs * (1L << reconnectAttempts), 30000L);
            long jitter = (long) (baseDelay * 0.25 * Math.random());
            long delay = baseDelay + jitter;
            reconnectAttempts++;
            beginReconnectAttempt(attempt);
            scheduler.schedule(() -> {
                if (!joinRequested || waitingForAuth || connected) {
                    return;
                }
                establish();
            }, delay, TimeUnit.MILLISECONDS);
        } else if (!intentionallyLeft && !"kicked".equals(connectionState) && !"auth_lost".equals(connectionState)) {
            setConnectionState("disconnected");
        }
    }

    private void sendRaw(JSONObject msg) {
        if (connected && authenticated && ws != null) {
            sendRaw(ws, msg);
        }
    }

    private void sendRawUnauthenticated(JSONObject msg) {
        if (connected && ws != null) {
            sendRaw(ws, msg);
        }
    }

    private void sendRaw(RoomSocket socket, JSONObject msg) {
        if (socket != null) {
            socket.send(msg.toString());
        }
    }

    private void sendLeaveAndClose(RoomSocket socket) {
        if (socket == null) {
            return;
        }
        sendRaw(socket, new JSONObject(Map.of("type", "leave")));
        Thread closeThread = new Thread(() -> {
            try {
                Thread.sleep(ROOM_EXPLICIT_LEAVE_CLOSE_DELAY_MS);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            }
            try {
                socket.close();
            } catch (Exception ignored) {
                // Ignore close failures.
            }
        }, "edgebase-room-leave-close");
        closeThread.setDaemon(true);
        closeThread.start();
    }

    private void startHeartbeat() {
        if (heartbeatFuture != null) {
            heartbeatFuture.cancel(true);
        }
        heartbeatFuture = scheduler.scheduleAtFixedRate(
                () -> sendRaw(new JSONObject(Map.of("type", "ping"))),
                30, 30, TimeUnit.SECONDS
        );
    }

    private void handleAuthStateChange(Boolean signedIn) {
        if (Boolean.TRUE.equals(signedIn)) {
            if (connected && authenticated && ws != null) {
                String token = tokenSupplier.get();
                if (token != null && !token.isEmpty()) {
                    sendRawUnauthenticated(new JSONObject(Map.of("type", "auth", "token", token)));
                }
                return;
            }
            waitingForAuth = false;
            if (joinRequested && !connected) {
                reconnectAttempts = 0;
                establish();
            }
            return;
        }

        rejectAllPending(new EdgeBaseError(401, "Auth state lost"));
        waitingForAuth = joinRequested;
        reconnectInfo = null;
        setConnectionState("auth_lost");
        connected = false;
        authenticated = false;
        joined = false;
        if (heartbeatFuture != null) {
            heartbeatFuture.cancel(true);
        }
        RoomSocket socket = ws;
        ws = null;
        synchronized (stateLock) {
            roomMembers = new ArrayList<>();
            mediaMembers = new ArrayList<>();
        }
        userId = null;
        connectionId = null;
        sendLeaveAndClose(socket);
    }

    private void handleAuthenticationFailure(Exception error) {
        waitingForAuth = error instanceof EdgeBaseError
                && ((EdgeBaseError) error).getStatusCode() == 401
                && joinRequested;
        if (waitingForAuth) {
            reconnectInfo = null;
            setConnectionState("auth_lost");
        }
        connected = false;
        authenticated = false;
        joined = false;
        if (heartbeatFuture != null) {
            heartbeatFuture.cancel(true);
        }
        if (ws != null) {
            ws.close();
            ws = null;
        }
    }

    public void destroy() {
        leave();
        sharedStateHandlers.clear();
        playerStateHandlers.clear();
        messageHandlers.clear();
        allMessageHandlers.clear();
        errorHandlers.clear();
        kickedHandlers.clear();
        membersSyncHandlers.clear();
        memberJoinHandlers.clear();
        memberLeaveHandlers.clear();
        memberStateHandlers.clear();
        signalHandlers.clear();
        anySignalHandlers.clear();
        mediaTrackHandlers.clear();
        mediaTrackRemovedHandlers.clear();
        mediaStateHandlers.clear();
        mediaDeviceHandlers.clear();
        reconnectHandlers.clear();
        connectionStateHandlers.clear();
        scheduler.shutdownNow();
    }

    private CompletableFuture<Void> registerPendingVoid(
            ConcurrentHashMap<String, CompletableFuture<Void>> pending,
            String requestId,
            String timeoutMessage
    ) {
        CompletableFuture<Void> future = new CompletableFuture<>();
        ScheduledFuture<?> timeout = scheduler.schedule(() -> {
            if (pending.remove(requestId, future)) {
                future.completeExceptionally(new EdgeBaseError(408, timeoutMessage));
            }
        }, sendTimeoutMs, TimeUnit.MILLISECONDS);
        future.whenComplete((result, error) -> {
            pending.remove(requestId);
            timeout.cancel(true);
        });
        pending.put(requestId, future);
        return future;
    }

    private void resolvePendingVoidRequest(
            ConcurrentHashMap<String, CompletableFuture<Void>> pending,
            String requestId
    ) {
        if (requestId == null) {
            return;
        }
        CompletableFuture<Void> future = pending.remove(requestId);
        if (future != null) {
            future.complete(null);
        }
    }

    private void rejectPendingVoidRequest(
            ConcurrentHashMap<String, CompletableFuture<Void>> pending,
            String requestId,
            EdgeBaseError error
    ) {
        if (requestId == null) {
            return;
        }
        CompletableFuture<Void> future = pending.remove(requestId);
        if (future != null) {
            future.completeExceptionally(error);
        }
    }

    private void rejectPendingVoidRequests(
            ConcurrentHashMap<String, CompletableFuture<Void>> pending,
            EdgeBaseError error
    ) {
        for (Map.Entry<String, CompletableFuture<Void>> entry : pending.entrySet()) {
            entry.getValue().completeExceptionally(error);
        }
        pending.clear();
    }

    private void rejectAllPending(EdgeBaseError error) {
        for (CompletableFuture<Object> future : pendingRequests.values()) {
            future.completeExceptionally(error);
        }
        pendingRequests.clear();
        rejectPendingVoidRequests(pendingSignalRequests, error);
        rejectPendingVoidRequests(pendingAdminRequests, error);
        rejectPendingVoidRequests(pendingMemberStateRequests, error);
        rejectPendingVoidRequests(pendingMediaRequests, error);
    }

    private void setConnectionState(String next) {
        if (Objects.equals(connectionState, next)) {
            return;
        }
        connectionState = next;
        for (Consumer<String> handler : connectionStateHandlers) {
            handler.accept(next);
        }
    }

    private void beginReconnectAttempt(int attempt) {
        reconnectInfo = new HashMap<>();
        reconnectInfo.put("attempt", attempt);
        setConnectionState("reconnecting");
    }

    private void upsertMember(Map<String, Object> member) {
        String memberId = Objects.toString(member.get("memberId"), "");
        for (int i = 0; i < roomMembers.size(); i++) {
            if (Objects.equals(roomMembers.get(i).get("memberId"), memberId)) {
                roomMembers.set(i, cloneMap(member));
                return;
            }
        }
        roomMembers.add(cloneMap(member));
    }

    private void removeMember(String memberId) {
        roomMembers.removeIf(member -> Objects.equals(member.get("memberId"), memberId));
    }

    private void syncMediaMemberInfo(Map<String, Object> member) {
        String memberId = Objects.toString(member.get("memberId"), "");
        for (Map<String, Object> mediaMember : mediaMembers) {
            Map<String, Object> info = safeMap(mediaMember.get("member"));
            if (Objects.equals(info.get("memberId"), memberId)) {
                mediaMember.put("member", cloneMap(member));
                return;
            }
        }
    }

    private Map<String, Object> ensureMediaMember(Map<String, Object> member) {
        String memberId = Objects.toString(member.get("memberId"), "");
        for (Map<String, Object> mediaMember : mediaMembers) {
            Map<String, Object> info = safeMap(mediaMember.get("member"));
            if (Objects.equals(info.get("memberId"), memberId)) {
                mediaMember.put("member", cloneMap(member));
                return mediaMember;
            }
        }
        Map<String, Object> created = new HashMap<>();
        created.put("member", cloneMap(member));
        created.put("state", new HashMap<String, Object>());
        created.put("tracks", new ArrayList<Map<String, Object>>());
        mediaMembers.add(created);
        return created;
    }

    private void removeMediaMember(String memberId) {
        mediaMembers.removeIf(mediaMember -> {
            Map<String, Object> member = safeMap(mediaMember.get("member"));
            return Objects.equals(member.get("memberId"), memberId);
        });
    }

    @SuppressWarnings("unchecked")
    private void upsertMediaTrack(Map<String, Object> mediaMember, Map<String, Object> track) {
        String kind = Objects.toString(track.get("kind"), "");
        String trackId = track.get("trackId") instanceof String value ? value : null;
        List<Map<String, Object>> tracks = new ArrayList<>((List<Map<String, Object>>) mediaMember.get("tracks"));

        for (int i = 0; i < tracks.size(); i++) {
            Map<String, Object> existing = tracks.get(i);
            boolean sameTrack = Objects.equals(existing.get("kind"), kind)
                    && Objects.equals(existing.get("trackId"), trackId);
            if (sameTrack) {
                tracks.set(i, cloneMap(track));
                mediaMember.put("tracks", tracks);
                return;
            }
        }

        if (trackId == null) {
            tracks.removeIf(existing -> Objects.equals(existing.get("kind"), kind) && existing.get("trackId") == null);
        }
        tracks.add(cloneMap(track));
        mediaMember.put("tracks", tracks);
    }

    @SuppressWarnings("unchecked")
    private void removeMediaTrack(Map<String, Object> mediaMember, Map<String, Object> track) {
        String kind = Objects.toString(track.get("kind"), "");
        String trackId = track.get("trackId") instanceof String value ? value : null;
        List<Map<String, Object>> tracks = new ArrayList<>((List<Map<String, Object>>) mediaMember.get("tracks"));
        tracks.removeIf(existing -> trackId != null
                ? Objects.equals(existing.get("kind"), kind) && Objects.equals(existing.get("trackId"), trackId)
                : Objects.equals(existing.get("kind"), kind));
        mediaMember.put("tracks", tracks);
    }

    private void mergeMediaState(Map<String, Object> mediaMember, String kind, Map<String, Object> partial) {
        Map<String, Object> state = cloneMap(safeMap(mediaMember.get("state")));
        Map<String, Object> current = cloneMap(safeMap(state.get(kind)));

        Map<String, Object> next = new HashMap<>();
        next.put("published", partial.containsKey("published") ? partial.get("published") : current.getOrDefault("published", Boolean.FALSE));
        next.put("muted", partial.containsKey("muted") ? partial.get("muted") : current.getOrDefault("muted", Boolean.FALSE));

        Object trackId = partial.containsKey("trackId") ? partial.get("trackId") : current.get("trackId");
        Object deviceId = partial.containsKey("deviceId") ? partial.get("deviceId") : current.get("deviceId");
        Object publishedAt = partial.containsKey("publishedAt") ? partial.get("publishedAt") : current.get("publishedAt");
        Object adminDisabled = partial.containsKey("adminDisabled") ? partial.get("adminDisabled") : current.get("adminDisabled");

        if (trackId != null) next.put("trackId", trackId);
        if (deviceId != null) next.put("deviceId", deviceId);
        if (publishedAt != null) next.put("publishedAt", publishedAt);
        if (adminDisabled != null) next.put("adminDisabled", adminDisabled);

        state.put(kind, next);
        mediaMember.put("state", state);
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> normalizeMembers(Object value) {
        if (!(value instanceof List<?> list)) {
            return new ArrayList<>();
        }
        List<Map<String, Object>> normalized = new ArrayList<>();
        for (Object entry : list) {
            Map<String, Object> member = normalizeMember(entry);
            if (member != null) {
                normalized.add(member);
            }
        }
        return normalized;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> normalizeMember(Object value) {
        if (!(value instanceof Map<?, ?> rawMember)) {
            return null;
        }
        Object memberId = rawMember.get("memberId");
        Object userId = rawMember.get("userId");
        if (!(memberId instanceof String) || !(userId instanceof String)) {
            return null;
        }

        Map<String, Object> normalized = new HashMap<>();
        normalized.put("memberId", memberId);
        normalized.put("userId", userId);
        if (rawMember.get("connectionId") instanceof String connectionId) {
            normalized.put("connectionId", connectionId);
        }
        if (rawMember.get("connectionCount") instanceof Number connectionCount) {
            normalized.put("connectionCount", connectionCount.intValue());
        }
        if (rawMember.get("role") instanceof String role) {
            normalized.put("role", role);
        }
        normalized.put("state", normalizeState(rawMember.get("state")));
        return normalized;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> normalizeState(Object value) {
        if (!(value instanceof Map<?, ?> map)) {
            return new HashMap<>();
        }
        return (Map<String, Object>) deepClone(map);
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> normalizeMediaMembers(Object value) {
        if (!(value instanceof List<?> list)) {
            return new ArrayList<>();
        }
        List<Map<String, Object>> normalized = new ArrayList<>();
        for (Object entry : list) {
            Map<String, Object> mediaMember = normalizeMediaMember(entry);
            if (mediaMember != null) {
                normalized.add(mediaMember);
            }
        }
        return normalized;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> normalizeMediaMember(Object value) {
        if (!(value instanceof Map<?, ?> raw)) {
            return null;
        }
        Map<String, Object> member = normalizeMember(raw.get("member"));
        if (member == null) {
            return null;
        }
        Map<String, Object> normalized = new HashMap<>();
        normalized.put("member", member);
        normalized.put("state", normalizeMediaState(raw.get("state")));
        normalized.put("tracks", normalizeMediaTracks(raw.get("tracks")));
        return normalized;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> normalizeMediaState(Object value) {
        if (!(value instanceof Map<?, ?> raw)) {
            return new HashMap<>();
        }
        Map<String, Object> normalized = new HashMap<>();
        Map<String, Object> audio = normalizeMediaKindState(raw.get("audio"));
        Map<String, Object> video = normalizeMediaKindState(raw.get("video"));
        Map<String, Object> screen = normalizeMediaKindState(raw.get("screen"));
        if (audio != null) normalized.put("audio", audio);
        if (video != null) normalized.put("video", video);
        if (screen != null) normalized.put("screen", screen);
        return normalized;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> normalizeMediaKindState(Object value) {
        if (!(value instanceof Map<?, ?> raw)) {
            return null;
        }
        Map<String, Object> normalized = new HashMap<>();
        normalized.put("published", Boolean.TRUE.equals(raw.get("published")));
        normalized.put("muted", Boolean.TRUE.equals(raw.get("muted")));
        if (raw.get("trackId") instanceof String trackId) normalized.put("trackId", trackId);
        if (raw.get("deviceId") instanceof String deviceId) normalized.put("deviceId", deviceId);
        if (raw.get("publishedAt") instanceof Number publishedAt) normalized.put("publishedAt", publishedAt);
        if (raw.containsKey("adminDisabled")) normalized.put("adminDisabled", Boolean.TRUE.equals(raw.get("adminDisabled")));
        return normalized;
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> normalizeMediaTracks(Object value) {
        if (!(value instanceof List<?> list)) {
            return new ArrayList<>();
        }
        List<Map<String, Object>> normalized = new ArrayList<>();
        for (Object entry : list) {
            Map<String, Object> track = normalizeMediaTrack(entry);
            if (track != null) {
                normalized.add(track);
            }
        }
        return normalized;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> normalizeMediaTrack(Object value) {
        if (!(value instanceof Map<?, ?> raw)) {
            return null;
        }
        String kind = normalizeMediaKind(raw.get("kind"));
        if (kind == null) {
            return null;
        }
        Map<String, Object> normalized = new HashMap<>();
        normalized.put("kind", kind);
        normalized.put("muted", Boolean.TRUE.equals(raw.get("muted")));
        if (raw.get("trackId") instanceof String trackId) normalized.put("trackId", trackId);
        if (raw.get("deviceId") instanceof String deviceId) normalized.put("deviceId", deviceId);
        if (raw.get("publishedAt") instanceof Number publishedAt) normalized.put("publishedAt", publishedAt);
        if (raw.containsKey("adminDisabled")) normalized.put("adminDisabled", Boolean.TRUE.equals(raw.get("adminDisabled")));
        return normalized;
    }

    private String normalizeMediaKind(Object value) {
        if (value instanceof String kind && ("audio".equals(kind) || "video".equals(kind) || "screen".equals(kind))) {
            return kind;
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> normalizeSignalMeta(Object value) {
        if (!(value instanceof Map<?, ?> raw)) {
            return new HashMap<>();
        }
        Map<String, Object> normalized = new HashMap<>();
        if (raw.get("memberId") instanceof String memberId) normalized.put("memberId", memberId);
        if (raw.get("userId") instanceof String userId) normalized.put("userId", userId);
        if (raw.get("connectionId") instanceof String connectionId) normalized.put("connectionId", connectionId);
        if (raw.get("sentAt") instanceof Number sentAt) normalized.put("sentAt", sentAt);
        if (raw.containsKey("serverSent")) normalized.put("serverSent", Boolean.TRUE.equals(raw.get("serverSent")));
        return normalized;
    }

    private String normalizeLeaveReason(Object value) {
        if (value instanceof String reason && ("leave".equals(reason) || "timeout".equals(reason) || "kicked".equals(reason))) {
            return reason;
        }
        return "leave";
    }

    public final class RoomStateNamespace {
        public Map<String, Object> getShared() {
            return RoomClient.this.getSharedState();
        }

        public Map<String, Object> getMine() {
            return RoomClient.this.getPlayerState();
        }

        public Subscription onSharedChange(BiConsumer<Map<String, Object>, Map<String, Object>> handler) {
            return RoomClient.this.onSharedState(handler);
        }

        public Subscription onMineChange(BiConsumer<Map<String, Object>, Map<String, Object>> handler) {
            return RoomClient.this.onPlayerState(handler);
        }

        public CompletableFuture<Object> send(String actionType, Object payload) {
            return RoomClient.this.send(actionType, payload);
        }
    }

    public final class RoomMetaNamespace {
        public Map<String, Object> get() {
            return RoomClient.this.getMetadata();
        }
    }

    public final class RoomSignalsNamespace {
        public CompletableFuture<Void> send(String event, Object payload, Map<String, Object> options) {
            return RoomClient.this.sendSignal(event, payload, options);
        }

        public CompletableFuture<Void> send(String event, Object payload) {
            return RoomClient.this.sendSignal(event, payload);
        }

        public CompletableFuture<Void> sendTo(String memberId, String event, Object payload) {
            return RoomClient.this.sendSignal(event, payload, Map.of("memberId", memberId));
        }

        public Subscription on(String event, BiConsumer<Object, Map<String, Object>> handler) {
            return RoomClient.this.onSignal(event, handler);
        }

        public Subscription onAny(AnySignalHandler handler) {
            return RoomClient.this.onAnySignal(handler);
        }
    }

    public final class RoomMembersNamespace {
        public List<Map<String, Object>> list() {
            return RoomClient.this.listMembers();
        }

        public Subscription onSync(Consumer<List<Map<String, Object>>> handler) {
            return RoomClient.this.onMembersSync(handler);
        }

        public Subscription onJoin(Consumer<Map<String, Object>> handler) {
            return RoomClient.this.onMemberJoin(handler);
        }

        public Subscription onLeave(BiConsumer<Map<String, Object>, String> handler) {
            return RoomClient.this.onMemberLeave(handler);
        }

        public CompletableFuture<Void> setState(Map<String, Object> state) {
            return RoomClient.this.sendMemberState(state);
        }

        public CompletableFuture<Void> clearState() {
            return RoomClient.this.clearMemberState();
        }

        public Subscription onStateChange(BiConsumer<Map<String, Object>, Map<String, Object>> handler) {
            return RoomClient.this.onMemberStateChange(handler);
        }
    }

    public final class RoomAdminNamespace {
        public CompletableFuture<Void> kick(String memberId) {
            return RoomClient.this.sendAdmin("kick", memberId);
        }

        public CompletableFuture<Void> mute(String memberId) {
            return RoomClient.this.sendAdmin("mute", memberId);
        }

        public CompletableFuture<Void> block(String memberId) {
            return RoomClient.this.sendAdmin("block", memberId);
        }

        public CompletableFuture<Void> setRole(String memberId, String role) {
            return RoomClient.this.sendAdmin("setRole", memberId, Map.of("role", role));
        }

        public CompletableFuture<Void> disableVideo(String memberId) {
            return RoomClient.this.sendAdmin("disableVideo", memberId);
        }

        public CompletableFuture<Void> stopScreenShare(String memberId) {
            return RoomClient.this.sendAdmin("stopScreenShare", memberId);
        }
    }

    public final class RoomMediaKindNamespace {
        private final String kind;

        private RoomMediaKindNamespace(String kind) {
            this.kind = kind;
        }

        public CompletableFuture<Void> enable(Map<String, Object> payload) {
            return RoomClient.this.sendMedia("publish", kind, payload);
        }

        public CompletableFuture<Void> disable() {
            return RoomClient.this.sendMedia("unpublish", kind);
        }

        public CompletableFuture<Void> setMuted(boolean muted) {
            return RoomClient.this.sendMedia("mute", kind, Map.of("muted", muted));
        }
    }

    public final class RoomScreenMediaNamespace {
        public CompletableFuture<Void> start(Map<String, Object> payload) {
            return RoomClient.this.sendMedia("publish", "screen", payload);
        }

        public CompletableFuture<Void> stop() {
            return RoomClient.this.sendMedia("unpublish", "screen");
        }
    }

    public final class RoomMediaDevicesNamespace {
        public CompletableFuture<Void> switchInputs(Map<String, Object> payload) {
            return RoomClient.this.switchMediaDevices(payload);
        }
    }

    public final class RoomCloudflareRealtimeKitNamespace {
        public CompletableFuture<Map<String, Object>> createSession(Map<String, Object> payload) {
            return RoomClient.this.requestCloudflareRealtimeKitMedia("session", "POST", payload);
        }

        public CompletableFuture<Map<String, Object>> createSession() {
            return RoomClient.this.requestCloudflareRealtimeKitMedia("session", "POST");
        }
    }

    private final class RoomCloudflareMediaTransport implements RoomMediaTransport {
        private final RoomCloudflareRealtimeKitTransportOptions options;
        private final ConcurrentHashMap<String, Consumer<RoomMediaRemoteTrackEvent>> remoteTrackHandlers = new ConcurrentHashMap<>();
        private final Set<String> publishedRemoteKeys = ConcurrentHashMap.newKeySet();
        private volatile RoomCloudflareRealtimeKitClientAdapter client;
        private volatile String sessionId;
        private volatile String providerSessionId;
        private volatile RoomCloudflareParticipantListener participantListener;
        private volatile CompletableFuture<String> connectFuture;

        private RoomCloudflareMediaTransport(RoomCloudflareRealtimeKitTransportOptions options) {
            this.options = options == null ? new RoomCloudflareRealtimeKitTransportOptions() : options;
        }

        @Override
        public CompletableFuture<String> connect(Map<String, Object> payload) {
            if (sessionId != null) {
                return CompletableFuture.completedFuture(sessionId);
            }
            CompletableFuture<String> existingFuture = connectFuture;
            if (existingFuture != null) {
                return existingFuture;
            }

            CompletableFuture<String> createdFuture;
            synchronized (this) {
                if (sessionId != null) {
                    return CompletableFuture.completedFuture(sessionId);
                }
                if (connectFuture != null) {
                    return connectFuture;
                }

                Map<String, Object> requestPayload = payload == null ? Map.of() : payload;
                createdFuture = media.cloudflareRealtimeKit.createSession(requestPayload).thenCompose(session -> {
                String authToken = (String) session.get("authToken");
                if (authToken == null || authToken.isBlank()) {
                    return CompletableFuture.failedFuture(
                            new EdgeBaseError(500, "Cloudflare RealtimeKit session is missing authToken.")
                    );
                }

                return resolveClientFactory().create(
                        new RoomCloudflareRealtimeKitClientFactoryOptions(
                                authToken,
                                (String) requestPayload.get("name"),
                                false,
                                false,
                                options.getBaseDomain()
                        )
                ).thenCompose(nextClient -> {
                    client = nextClient;
                    sessionId = (String) session.get("sessionId");
                    providerSessionId = (String) session.get("participantId");

                    RoomCloudflareParticipantListener listener = new RoomCloudflareParticipantListener() {
                        @Override
                        public void onParticipantJoin(RoomCloudflareParticipantSnapshot participant) {
                            syncParticipant(participant);
                        }

                        @Override
                        public void onParticipantLeave(RoomCloudflareParticipantSnapshot participant) {
                            removeParticipant(participant);
                        }

                        @Override
                        public void onAudioUpdate(RoomCloudflareParticipantSnapshot participant, boolean enabled) {
                            emitParticipantKind(participant, "audio", enabled);
                        }

                        @Override
                        public void onVideoUpdate(RoomCloudflareParticipantSnapshot participant, boolean enabled) {
                            emitParticipantKind(participant, "video", enabled);
                        }

                        @Override
                        public void onScreenShareUpdate(RoomCloudflareParticipantSnapshot participant, boolean enabled) {
                            emitParticipantKind(participant, "screen", enabled);
                        }

                        @Override
                        public void onParticipantsSync(List<RoomCloudflareParticipantSnapshot> participants) {
                            syncParticipants(participants);
                        }
                    };
                    participantListener = listener;
                    nextClient.addListener(listener);

                    return nextClient.joinRoom()
                            .thenApply(ignored -> {
                                syncParticipants(nextClient.getJoinedParticipants());
                                return sessionId != null ? sessionId : (String) session.getOrDefault("sessionId", "");
                            })
                            .whenComplete((ignored, error) -> {
                                if (error != null) {
                                    nextClient.removeListener(listener);
                                    participantListener = null;
                                    client = null;
                                    sessionId = null;
                                    providerSessionId = null;
                                }
                            });
                });
            });
                connectFuture = createdFuture;
            }

            createdFuture.whenComplete((ignored, error) -> {
                if (connectFuture == createdFuture) {
                    connectFuture = null;
                }
            });
            return createdFuture;
        }

        @Override
        public CompletableFuture<Object> enableAudio(Map<String, Object> payload) {
            try {
                RoomCloudflareRealtimeKitClientAdapter client = requireClient();
                return client.enableAudio()
                        .thenCompose(ignored -> media.audio.enable(withProviderSession(payload)))
                        .thenApply(ignored -> client.getLocalParticipant().getParticipantHandle());
            } catch (RuntimeException error) {
                return CompletableFuture.failedFuture(error);
            }
        }

        @Override
        public CompletableFuture<Object> enableVideo(Map<String, Object> payload) {
            try {
                RoomCloudflareRealtimeKitClientAdapter client = requireClient();
                return client.enableVideo()
                        .thenCompose(ignored -> media.video.enable(withProviderSession(payload)))
                        .thenApply(ignored -> client.buildView(client.getLocalParticipant(), "video", true));
            } catch (RuntimeException error) {
                return CompletableFuture.failedFuture(error);
            }
        }

        @Override
        public CompletableFuture<Object> startScreenShare(Map<String, Object> payload) {
            try {
                RoomCloudflareRealtimeKitClientAdapter client = requireClient();
                return client.enableScreenShare()
                        .thenCompose(ignored -> media.screen.start(withProviderSession(payload)))
                        .thenApply(ignored -> client.buildView(client.getLocalParticipant(), "screen", true));
            } catch (RuntimeException error) {
                return CompletableFuture.failedFuture(error);
            }
        }

        @Override
        public CompletableFuture<Void> disableAudio() {
            RoomCloudflareRealtimeKitClientAdapter client = this.client;
            if (client == null) {
                return CompletableFuture.completedFuture(null);
            }
            return client.disableAudio().thenCompose(ignored -> media.audio.disable());
        }

        @Override
        public CompletableFuture<Void> disableVideo() {
            RoomCloudflareRealtimeKitClientAdapter client = this.client;
            if (client == null) {
                return CompletableFuture.completedFuture(null);
            }
            return client.disableVideo().thenCompose(ignored -> media.video.disable());
        }

        @Override
        public CompletableFuture<Void> stopScreenShare() {
            RoomCloudflareRealtimeKitClientAdapter client = this.client;
            if (client == null) {
                return CompletableFuture.completedFuture(null);
            }
            return client.disableScreenShare().thenCompose(ignored -> media.screen.stop());
        }

        @Override
        public CompletableFuture<Void> setMuted(String kind, boolean muted) {
            try {
                RoomCloudflareRealtimeKitClientAdapter client = requireClient();
                return switch (kind) {
                    case "audio" -> {
                        CompletableFuture<Void> providerFuture = muted
                                ? client.disableAudio()
                                : client.enableAudio();
                        yield providerFuture.thenCompose(ignored -> media.audio.setMuted(muted));
                    }
                    case "video" -> {
                        CompletableFuture<Void> providerFuture = muted
                                ? client.disableVideo()
                                : client.enableVideo();
                        yield providerFuture.thenCompose(ignored -> media.video.setMuted(muted));
                    }
                    default -> CompletableFuture.failedFuture(
                            new UnsupportedOperationException("Unsupported mute kind: " + kind)
                    );
                };
            } catch (RuntimeException error) {
                return CompletableFuture.failedFuture(error);
            }
        }

        @Override
        public CompletableFuture<Void> switchDevices(Map<String, Object> payload) {
            try {
                RoomCloudflareRealtimeKitClientAdapter client = requireClient();
                CompletableFuture<Void> chain = CompletableFuture.completedFuture(null);
                String audioInputId = payload == null ? null : (String) payload.get("audioInputId");
                String videoInputId = payload == null ? null : (String) payload.get("videoInputId");

                if (audioInputId != null && !audioInputId.isBlank()) {
                    chain = chain.thenCompose(ignored -> client.setAudioDevice(audioInputId));
                }
                if (videoInputId != null && !videoInputId.isBlank()) {
                    chain = chain.thenCompose(ignored -> client.setVideoDevice(videoInputId));
                }

                return chain.thenCompose(ignored -> media.devices.switchInputs(payload == null ? Map.of() : payload));
            } catch (RuntimeException error) {
                return CompletableFuture.failedFuture(error);
            }
        }

        @Override
        public Subscription onRemoteTrack(Consumer<RoomMediaRemoteTrackEvent> handler) {
            String key = UUID.randomUUID().toString();
            remoteTrackHandlers.put(key, handler);
            return () -> remoteTrackHandlers.remove(key);
        }

        @Override
        public String getSessionId() {
            return sessionId;
        }

        @Override
        public Object getPeerConnection() {
            return null;
        }

        @Override
        public void destroy() {
            RoomCloudflareRealtimeKitClientAdapter client = this.client;
            RoomCloudflareParticipantListener listener = participantListener;
            CompletableFuture<String> connectFuture = this.connectFuture;
            this.client = null;
            participantListener = null;
            sessionId = null;
            providerSessionId = null;
            this.connectFuture = null;
            publishedRemoteKeys.clear();
            if (connectFuture != null) {
                connectFuture.cancel(true);
            }

            if (client != null && listener != null) {
                client.removeListener(listener);
                client.leaveRoom();
            }
        }

        private RoomCloudflareRealtimeKitClientFactory resolveClientFactory() {
            if (options.getClientFactory() != null) {
                return options.getClientFactory();
            }
            if (defaultCloudflareRealtimeKitClientFactory != null) {
                return defaultCloudflareRealtimeKitClientFactory;
            }
            throw new UnsupportedOperationException(
                    "Cloudflare RealtimeKit room media requires either cloudflareRealtimeKit.clientFactory " +
                            "or the EdgeBase Android runtime package. See " + ROOM_MEDIA_DOCS_URL
            );
        }

        private RoomCloudflareRealtimeKitClientAdapter requireClient() {
            RoomCloudflareRealtimeKitClientAdapter current = client;
            if (current == null) {
                throw new IllegalStateException(
                        "Call room.media.transport().connect() before using media controls."
                );
            }
            return current;
        }

        private Map<String, Object> withProviderSession(Map<String, Object> payload) {
            LinkedHashMap<String, Object> result = new LinkedHashMap<>();
            if (payload != null) {
                result.putAll(payload);
            }
            if (providerSessionId != null) {
                result.put("providerSessionId", providerSessionId);
            }
            return result;
        }

        private void syncParticipants(List<RoomCloudflareParticipantSnapshot> participants) {
            for (RoomCloudflareParticipantSnapshot participant : participants) {
                syncParticipant(participant);
            }
        }

        private void syncParticipant(RoomCloudflareParticipantSnapshot participant) {
            emitParticipantKind(participant, "audio", participant.isAudioEnabled());
            emitParticipantKind(participant, "video", participant.isVideoEnabled());
            emitParticipantKind(participant, "screen", participant.isScreenShareEnabled());
        }

        private void removeParticipant(RoomCloudflareParticipantSnapshot participant) {
            publishedRemoteKeys.removeIf(key -> key.startsWith(participant.getId() + ":"));
        }

        private void emitParticipantKind(
                RoomCloudflareParticipantSnapshot participant,
                String kind,
                boolean enabled
        ) {
            String key = participant.getId() + ":" + kind;
            if (!enabled) {
                publishedRemoteKeys.remove(key);
                return;
            }
            if (!publishedRemoteKeys.add(key)) {
                return;
            }

            RoomMediaRemoteTrackEvent event = new RoomMediaRemoteTrackEvent(
                    kind,
                    participant.getParticipantHandle(),
                    client == null ? null : client.buildView(participant, kind, false),
                    null,
                    participant.getId(),
                    participant.getId(),
                    participant.getCustomParticipantId(),
                    participant.getUserId(),
                    participant.toMap()
            );
            for (Consumer<RoomMediaRemoteTrackEvent> handler : remoteTrackHandlers.values()) {
                handler.accept(event);
            }
        }
    }

    public final class RoomMediaNamespace {
        public final RoomMediaKindNamespace audio = new RoomMediaKindNamespace("audio");
        public final RoomMediaKindNamespace video = new RoomMediaKindNamespace("video");
        public final RoomScreenMediaNamespace screen = new RoomScreenMediaNamespace();
        public final RoomMediaDevicesNamespace devices = new RoomMediaDevicesNamespace();
        public final RoomCloudflareRealtimeKitNamespace cloudflareRealtimeKit = new RoomCloudflareRealtimeKitNamespace();

        public RoomMediaTransport transport() {
            return transport(new RoomMediaTransportOptions());
        }

        public RoomMediaTransport transport(RoomMediaTransportOptions options) {
            RoomMediaTransportOptions resolved = options == null ? new RoomMediaTransportOptions() : options;
            if (resolved.getProvider() == RoomMediaTransportProvider.CLOUDFLARE_REALTIMEKIT) {
                return new RoomCloudflareMediaTransport(resolved.getCloudflareRealtimeKit());
            }
            RoomP2PMediaTransportOptions p2pOptions =
                    resolved.getP2P() == null ? new RoomP2PMediaTransportOptions() : resolved.getP2P();
            if (p2pOptions.getTransportFactory() != null) {
                return p2pOptions.getTransportFactory().create(RoomClient.this, p2pOptions);
            }
            if (defaultP2PMediaTransportFactory != null) {
                return defaultP2PMediaTransportFactory.create(RoomClient.this, p2pOptions);
            }
            throw new UnsupportedOperationException(
                    "P2P room media requires either p2p.transportFactory or the EdgeBase Android runtime package. " +
                            "See " + ROOM_MEDIA_DOCS_URL
            );
        }

        public List<Map<String, Object>> list() {
            return RoomClient.this.listMediaMembers();
        }

        public Subscription onTrack(BiConsumer<Map<String, Object>, Map<String, Object>> handler) {
            return RoomClient.this.onMediaTrack(handler);
        }

        public Subscription onTrackRemoved(BiConsumer<Map<String, Object>, Map<String, Object>> handler) {
            return RoomClient.this.onMediaTrackRemoved(handler);
        }

        public Subscription onStateChange(BiConsumer<Map<String, Object>, Map<String, Object>> handler) {
            return RoomClient.this.onMediaStateChange(handler);
        }

        public Subscription onDeviceChange(BiConsumer<Map<String, Object>, Map<String, Object>> handler) {
            return RoomClient.this.onMediaDeviceChange(handler);
        }
    }

    public final class RoomSessionNamespace {
        public Subscription onError(Consumer<Map<String, String>> handler) {
            return RoomClient.this.onError(handler);
        }

        public Subscription onKicked(Runnable handler) {
            return RoomClient.this.onKicked(handler);
        }

        public Subscription onReconnect(Consumer<Map<String, Object>> handler) {
            return RoomClient.this.onReconnect(handler);
        }

        public Subscription onConnectionStateChange(Consumer<String> handler) {
            return RoomClient.this.onConnectionStateChange(handler);
        }

        public String getConnectionState() {
            return RoomClient.this.connectionState();
        }

        public String getUserId() {
            return RoomClient.this.userId();
        }

        public String getConnectionId() {
            return RoomClient.this.connectionId();
        }
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> jsonObjectToMap(JSONObject obj) {
        if (obj == null) {
            return new HashMap<>();
        }
        Map<String, Object> map = new HashMap<>();
        Iterator<String> keys = obj.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            map.put(key, jsonValueToJava(obj.get(key)));
        }
        return map;
    }

    private static List<Object> jsonArrayToList(JSONArray array) {
        if (array == null) {
            return new ArrayList<>();
        }
        List<Object> list = new ArrayList<>();
        for (int i = 0; i < array.length(); i++) {
            list.add(jsonValueToJava(array.get(i)));
        }
        return list;
    }

    private static Object jsonValueToJava(Object value) {
        if (value == null || value == JSONObject.NULL) {
            return null;
        }
        if (value instanceof JSONObject object) {
            return jsonObjectToMap(object);
        }
        if (value instanceof JSONArray array) {
            return jsonArrayToList(array);
        }
        return value;
    }

    @SuppressWarnings("unchecked")
    private static Object deepClone(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> clone = new HashMap<>();
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                Object key = entry.getKey();
                if (key instanceof String stringKey) {
                    clone.put(stringKey, deepClone(entry.getValue()));
                }
            }
            return clone;
        }
        if (value instanceof List<?> list) {
            List<Object> clone = new ArrayList<>();
            for (Object entry : list) {
                clone.add(deepClone(entry));
            }
            return clone;
        }
        return value;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> cloneMap(Map<String, Object> value) {
        return value == null ? new HashMap<>() : (Map<String, Object>) deepClone(value);
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> cloneMemberList(List<Map<String, Object>> value) {
        return value == null ? new ArrayList<>() : (List<Map<String, Object>>) deepClone(value);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> safeMap(Object value) {
        if (value instanceof Map<?, ?> map) {
            return (Map<String, Object>) map;
        }
        return new HashMap<>();
    }

    @SuppressWarnings("unchecked")
    private static void deepSet(Map<String, Object> obj, String path, Object value) {
        int dot = path.indexOf('.');
        if (dot < 0) {
            if (value == null) {
                obj.remove(path);
            } else {
                obj.put(path, value);
            }
            return;
        }
        String head = path.substring(0, dot);
        String tail = path.substring(dot + 1);
        Object nested = obj.get(head);
        Map<String, Object> nestedMap;
        if (nested instanceof Map<?, ?> map) {
            nestedMap = (Map<String, Object>) map;
        } else {
            nestedMap = new HashMap<>();
            obj.put(head, nestedMap);
        }
        deepSet(nestedMap, tail, value);
    }

    private static String encodeURIComponent(String s) {
        try {
            return java.net.URLEncoder.encode(s, StandardCharsets.UTF_8).replace("+", "%20");
        } catch (Exception ignored) {
            return s;
        }
    }

    private class WebSocketClientWrapper implements RoomSocket {
        private final URI uri;
        private final Consumer<String> onMessage;
        private final Runnable onClose;
        private final OkHttpClient client;
        private volatile WebSocket session;

        WebSocketClientWrapper(URI uri, Consumer<String> onMessage, Runnable onClose) {
            this.uri = uri;
            this.onMessage = onMessage;
            this.onClose = onClose;
            this.client = new OkHttpClient.Builder()
                    .readTimeout(0, TimeUnit.MILLISECONDS)
                    .build();
        }

        void connect() {
            CountDownLatch latch = new CountDownLatch(1);
            List<Throwable> failure = new CopyOnWriteArrayList<>();
            Request request = new Request.Builder().url(uri.toString()).build();
            client.newWebSocket(request, new WebSocketListener() {
                @Override
                public void onOpen(WebSocket webSocket, Response response) {
                    session = webSocket;
                    latch.countDown();
                }

                @Override
                public void onMessage(WebSocket webSocket, String text) {
                    onMessage.accept(text);
                }

                @Override
                public void onClosing(WebSocket webSocket, int code, String reason) {
                    lastCloseCode = code;
                    webSocket.close(1000, reason);
                    onClose.run();
                }

                @Override
                public void onClosed(WebSocket webSocket, int code, String reason) {
                    lastCloseCode = code;
                    onClose.run();
                }

                @Override
                public void onFailure(WebSocket webSocket, Throwable t, Response response) {
                    lastCloseCode = 0;
                    failure.add(t);
                    latch.countDown();
                    onClose.run();
                }
            });

            try {
                if (!latch.await(5, TimeUnit.SECONDS)) {
                    throw new EdgeBaseError(408, "Timed out opening room websocket");
                }
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                throw new EdgeBaseError(500, "Interrupted while opening room websocket");
            }

            if (!failure.isEmpty()) {
                Throwable error = failure.get(0);
                throw new EdgeBaseError(500, "Failed to connect room websocket: " + error.getMessage());
            }

            if (session == null) {
                throw new EdgeBaseError(500, "Room websocket did not open");
            }
        }

        @Override
        public void send(String msg) {
            WebSocket current = session;
            if (current != null) {
                current.send(msg);
            }
        }

        @Override
        public void close() {
            WebSocket current = session;
            if (current != null) {
                current.close(1000, "Client closed");
                session = null;
            }
            client.dispatcher().executorService().shutdown();
            client.connectionPool().evictAll();
            try {
                client.cache().close();
            } catch (IOException | NullPointerException ignored) {
                // Ignore missing cache.
            }
        }
    }
}
