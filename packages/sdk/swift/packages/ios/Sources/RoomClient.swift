import EdgeBaseCore
// RoomClient v2 — Client-side room connection for real-time multiplayer state.
//
// Complete redesign from v1:
//   - 3 state areas: sharedState (all clients), playerState (per-player), serverState (server-only, not sent)
//   - Client can only read + subscribe + send(). All writes are server-only.
//   - send() returns via async/await, resolved by requestId matching
//   - Subscription object with unsubscribe()
//   - namespace + roomId identification (replaces single roomId)
//
// Usage:
//   let room = client.room(namespace: "game", id: "lobby-1")
//   try await room.join()
//   let sub = room.onSharedState { state, changes in print(state) }
//   let result = try await room.send("SET_SCORE", payload: ["score": 42])
//   sub.unsubscribe()
//   room.leave()

import Foundation

private let roomExplicitLeaveCloseDelayNs: UInt64 = 40_000_000

protocol RoomWebSocketTask: AnyObject {
    func resume()
    func send(_ message: URLSessionWebSocketTask.Message) async throws
    func receive() async throws -> URLSessionWebSocketTask.Message
    func cancel(with closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?)
}

extension URLSessionWebSocketTask: RoomWebSocketTask {}

// MARK: - Subscription

/// A subscription handle returned by on*() methods. Call unsubscribe() to remove the handler.
public final class Subscription: @unchecked Sendable {
    private let _unsubscribe: () -> Void
    private var active = true

    init(_ unsubscribe: @escaping () -> Void) {
        self._unsubscribe = unsubscribe
    }

    /// Remove this handler. Safe to call multiple times.
    public func unsubscribe() {
        guard active else { return }
        active = false
        _unsubscribe()
    }
}

// MARK: - RoomOptions

/// Options for RoomClient configuration.
public struct RoomOptions: Sendable {
    /// Auto-reconnect on disconnect (default: true)
    public var autoReconnect: Bool
    /// Max reconnect attempts (default: 10)
    public var maxReconnectAttempts: Int
    /// Base delay for reconnect backoff in seconds (default: 1.0)
    public var reconnectBaseDelay: TimeInterval
    /// Timeout for send() requests in seconds (default: 10.0)
    public var sendTimeout: TimeInterval

    public init(
        autoReconnect: Bool = true,
        maxReconnectAttempts: Int = 10,
        reconnectBaseDelay: TimeInterval = 1.0,
        sendTimeout: TimeInterval = 10.0
    ) {
        self.autoReconnect = autoReconnect
        self.maxReconnectAttempts = maxReconnectAttempts
        self.reconnectBaseDelay = reconnectBaseDelay
        self.sendTimeout = sendTimeout
    }
}

// MARK: - RoomClient v2

public final class RoomClient: @unchecked Sendable {
    /// Room namespace (e.g. "game", "chat")
    public let namespace: String
    /// Room instance ID within the namespace
    public let roomId: String

    // MARK: - State (private backing, public getters)

    private var _sharedState: [String: Any] = [:]
    private var _sharedVersion: Int = 0
    private var _playerState: [String: Any] = [:]
    private var _playerVersion: Int = 0
    private var _members: [[String: Any]] = []
    private var _mediaMembers: [[String: Any]] = []

    // MARK: - Connection state

    private let baseUrl: String
    private let httpClient: HttpClient?
    private let tokenManager: any TokenManageable
    private let options: RoomOptions

    private var webSocketTask: (any RoomWebSocketTask)?
    private let urlSession: URLSession
    private var isConnected = false
    private var isAuthenticated = false
    private var isJoined = false
    private var intentionallyLeft = false
    private var reconnectAttempts = 0
    private var heartbeatTimer: Timer?
    private var waitingForAuth = false
    private var joinRequested = false
    private var currentUserId: String?
    private var currentConnectionId: String?
    private var currentConnectionState = "idle"
    private var reconnectInfo: [String: Any]?

    // MARK: - Thread safety

    private let queue = DispatchQueue(label: "com.edgebase.room.v2", attributes: .concurrent)

    // MARK: - Pending send() requests (requestId -> continuation)

    private var pendingRequests: [String: PendingRequest] = [:]
    private var pendingSignalRequests: [String: PendingVoidRequest] = [:]
    private var pendingAdminRequests: [String: PendingVoidRequest] = [:]
    private var pendingMemberStateRequests: [String: PendingVoidRequest] = [:]
    private var pendingMediaRequests: [String: PendingVoidRequest] = [:]

    private struct PendingRequest {
        let continuation: CheckedContinuation<Any?, Error>
        let timeoutTask: Task<Void, Never>
    }

    private struct PendingVoidRequest {
        let continuation: CheckedContinuation<Void, Error>
        let timeoutTask: Task<Void, Never>
    }

    // MARK: - Subscription handlers

    private var sharedStateHandlers: [ObjectIdentifier: ([String: Any], [String: Any]) -> Void] = [:]
    private var playerStateHandlers: [ObjectIdentifier: ([String: Any], [String: Any]) -> Void] = [:]
    private var messageHandlers: [String: [ObjectIdentifier: (Any?) -> Void]] = [:]
    private var allMessageHandlers: [ObjectIdentifier: (String, Any?) -> Void] = [:]
    private var errorHandlers: [ObjectIdentifier: (String, String) -> Void] = [:]
    private var kickedHandlers: [ObjectIdentifier: () -> Void] = [:]
    private var membersSyncHandlers: [UUID: ([[String: Any]]) -> Void] = [:]
    private var memberJoinHandlers: [UUID: ([String: Any]) -> Void] = [:]
    private var memberLeaveHandlers: [UUID: ([String: Any], String) -> Void] = [:]
    private var memberStateHandlers: [UUID: ([String: Any], [String: Any]) -> Void] = [:]
    private var signalHandlers: [String: [UUID: (Any?, [String: Any]) -> Void]] = [:]
    private var anySignalHandlers: [UUID: (String, Any?, [String: Any]) -> Void] = [:]
    private var mediaTrackHandlers: [UUID: ([String: Any], [String: Any]) -> Void] = [:]
    private var mediaTrackRemovedHandlers: [UUID: ([String: Any], [String: Any]) -> Void] = [:]
    private var mediaStateHandlers: [UUID: ([String: Any], [String: Any]) -> Void] = [:]
    private var mediaDeviceHandlers: [UUID: ([String: Any], [String: Any]) -> Void] = [:]
    private var reconnectHandlers: [UUID: ([String: Any]) -> Void] = [:]
    private var connectionStateHandlers: [UUID: (String) -> Void] = [:]

    public lazy var state = RoomStateNamespace(room: self)
    public lazy var meta = RoomMetaNamespace(room: self)
    public lazy var signals = RoomSignalsNamespace(room: self)
    public lazy var members = RoomMembersNamespace(room: self)
    public lazy var admin = RoomAdminNamespace(room: self)
    public lazy var media = RoomMediaNamespace(room: self)
    public lazy var session = RoomSessionNamespace(room: self)

    // MARK: - Init

    public init(
        baseUrl: String,
        namespace: String,
        roomId: String,
        tokenManager: any TokenManageable,
        options: RoomOptions = RoomOptions(),
        session: URLSession = .shared,
        httpClient: HttpClient? = nil
    ) {
        self.baseUrl = baseUrl
        self.namespace = namespace
        self.roomId = roomId
        self.tokenManager = tokenManager
        self.options = options
        self.urlSession = session
        self.httpClient = httpClient

        if let managedTokenManager = tokenManager as? TokenManager {
            Task { [weak self] in
                await managedTokenManager.onAuthStateChange { user in
                    self?.handleAuthStateChange(user)
                }
            }
        }
    }

    func attachSocketForTesting(
        _ socket: any RoomWebSocketTask,
        isConnected: Bool = true,
        isAuthenticated: Bool = true,
        isJoined: Bool = true
    ) {
        webSocketTask = socket
        self.isConnected = isConnected
        self.isAuthenticated = isAuthenticated
        self.isJoined = isJoined
    }

    func handleMessageForTesting(_ json: [String: Any]) {
        handleMessage(json)
    }

    // MARK: - State Accessors

    /// Get current shared state (snapshot copy).
    public func getSharedState() -> [String: Any] {
        return queue.sync { _sharedState }
    }

    /// Get current player state (snapshot copy).
    public func getPlayerState() -> [String: Any] {
        return queue.sync { _playerState }
    }

    public func listMembers() -> [[String: Any]] {
        return queue.sync { _members.map(cloneRecord) }
    }

    public func listMediaMembers() -> [[String: Any]] {
        return queue.sync { _mediaMembers.map(cloneRecord) }
    }

    public func userId() -> String? {
        currentUserId
    }

    public func connectionId() -> String? {
        currentConnectionId
    }

    public func connectionState() -> String {
        currentConnectionState
    }

    // MARK: - Metadata (HTTP, no WebSocket needed)

    /// Get room metadata without joining (HTTP GET).
    /// Returns developer-defined metadata set by room.setMetadata() on the server.
    /// Delegates to generated core getRoomMetadata() when HttpClient is available;
    /// falls back to static method with raw URL for backward compatibility.
    public func getMetadata() async throws -> [String: Any] {
        if let httpClient = httpClient {
            let core = GeneratedDbApi(http: httpClient)
            let result = try await core.getRoomMetadata(query: [
                "namespace": namespace,
                "id": roomId
            ])
            guard let json = result as? [String: Any] else {
                throw EdgeBaseError(statusCode: 0, message: "Invalid room metadata response")
            }
            return json
        }
        return try await RoomClient.getMetadata(baseUrl: baseUrl, namespace: namespace, roomId: roomId, session: urlSession)
    }

    /// Static: Get room metadata without creating a RoomClient instance.
    /// Useful for lobby screens where you need room info before joining.
    /// When httpClient is provided, delegates to generated core getRoomMetadata();
    /// otherwise builds raw URL for standalone usage without SDK client.
    public static func getMetadata(
        baseUrl: String,
        namespace: String,
        roomId: String,
        session: URLSession = .shared,
        httpClient: HttpClient? = nil
    ) async throws -> [String: Any] {
        if let httpClient = httpClient {
            let core = GeneratedDbApi(http: httpClient)
            let result = try await core.getRoomMetadata(query: [
                "namespace": namespace,
                "id": roomId
            ])
            guard let json = result as? [String: Any] else {
                throw EdgeBaseError(statusCode: 0, message: "Invalid room metadata response")
            }
            return json
        }

        // Raw URL fallback for standalone usage without SDK HttpClient.
        let trimmedUrl = baseUrl.hasSuffix("/") ? String(baseUrl.dropLast()) : baseUrl
        let ns = namespace.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? namespace
        let id = roomId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? roomId
        let urlString = "\(trimmedUrl)/api/room/metadata?namespace=\(ns)&id=\(id)"

        guard let url = URL(string: urlString) else {
            throw EdgeBaseError(statusCode: 0, message: "Invalid room metadata URL")
        }

        let (data, response) = try await session.data(from: url)
        if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode != 200 {
            throw EdgeBaseError(statusCode: httpResponse.statusCode, message: "Failed to get room metadata: \(httpResponse.statusCode)")
        }

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw EdgeBaseError(statusCode: 0, message: "Invalid room metadata response")
        }
        return json
    }

    // MARK: - Connection Lifecycle

    /// Connect to the room, authenticate, and join.
    public func join() async throws {
        intentionallyLeft = false
        joinRequested = true
        setConnectionState(reconnectInfo == nil ? "connecting" : "reconnecting")
        guard webSocketTask == nil || !isConnected else { return }
        try await establishConnection()
    }

    /// Leave the room and disconnect. Cancels all pending send() requests.
    public func leave() {
        intentionallyLeft = true
        joinRequested = false
        waitingForAuth = false
        stopHeartbeat()

        // Reject all pending send() requests
        queue.sync(flags: .barrier) {
            for (_, pending) in pendingRequests {
                pending.timeoutTask.cancel()
                pending.continuation.resume(throwing: EdgeBaseError(statusCode: 499, message: "Room left"))
            }
            pendingRequests.removeAll()
            rejectPendingVoidRequests(&pendingSignalRequests, message: "Room left")
            rejectPendingVoidRequests(&pendingAdminRequests, message: "Room left")
            rejectPendingVoidRequests(&pendingMemberStateRequests, message: "Room left")
            rejectPendingVoidRequests(&pendingMediaRequests, message: "Room left")
        }

        let socket = webSocketTask
        if let socket {
            sendLeaveAndClose(socket, reason: "Client left room")
        }
        webSocketTask = nil
        isConnected = false
        isAuthenticated = false
        isJoined = false

        queue.sync(flags: .barrier) {
            _sharedState = [:]
            _sharedVersion = 0
            _playerState = [:]
            _playerVersion = 0
            _members = []
            _mediaMembers = []
        }
        currentUserId = nil
        currentConnectionId = nil
        reconnectInfo = nil
        setConnectionState("disconnected")
    }

    // MARK: - send() — async/await with requestId matching

    /// Send an action to the server and await the result.
    ///
    /// Uses requestId matching: generates a UUID, stores a continuation,
    /// resolves on `action_result`, throws on `action_error`, times out after `sendTimeout`.
    ///
    /// - Parameters:
    ///   - actionType: The action type string (e.g. "SET_SCORE").
    ///   - payload: Optional payload data.
    /// - Returns: The result value from the server (may be nil).
    /// - Throws: `EdgeBaseError` on timeout, error response, or not connected.
    @discardableResult
    public func send(_ actionType: String, payload: Any? = nil) async throws -> Any? {
        guard webSocketTask != nil, isConnected, isAuthenticated else {
            throw EdgeBaseError(statusCode: 400, message: "Not connected to room")
        }

        let requestId = UUID().uuidString

        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Any?, Error>) in
            let timeoutTask = Task { [weak self, options] in
                try? await Task.sleep(nanoseconds: UInt64(options.sendTimeout * 1_000_000_000))
                guard !Task.isCancelled else { return }
                self?.queue.sync(flags: .barrier) {
                    if let pending = self?.pendingRequests.removeValue(forKey: requestId) {
                        pending.continuation.resume(throwing: EdgeBaseError(
                            statusCode: 408,
                            message: "Action '\(actionType)' timed out"
                        ))
                    }
                }
            }

            queue.sync(flags: .barrier) {
                pendingRequests[requestId] = PendingRequest(
                    continuation: continuation,
                    timeoutTask: timeoutTask
                )
            }

            let msg: [String: Any] = [
                "type": "send",
                "actionType": actionType,
                "payload": payload ?? [:] as [String: Any],
                "requestId": requestId,
            ]

            Task {
                try? await self.sendRaw(msg)
            }
        }
    }

    public func sendSignal(_ event: String, payload: Any? = nil, options: [String: Any] = [:]) async throws {
        var message: [String: Any] = [
            "type": "signal",
            "event": event,
            "payload": payload ?? [:] as [String: Any],
            "includeSelf": (options["includeSelf"] as? Bool) == true,
        ]
        if let memberId = options["memberId"] as? String {
            message["memberId"] = memberId
        }
        try await sendVoidRequest(message, store: \.pendingSignalRequests, timeoutMessage: "Signal '\(event)' timed out")
    }

    public func sendMemberState(_ state: [String: Any]) async throws {
        try await sendVoidRequest(
            [
                "type": "member_state",
                "state": state,
            ],
            store: \.pendingMemberStateRequests,
            timeoutMessage: "Member state update timed out"
        )
    }

    public func clearMemberState() async throws {
        try await sendVoidRequest(
            [
                "type": "member_state_clear",
            ],
            store: \.pendingMemberStateRequests,
            timeoutMessage: "Member state update timed out"
        )
    }

    public func sendAdmin(_ operation: String, memberId: String, payload: [String: Any] = [:]) async throws {
        try await sendVoidRequest(
            [
                "type": "admin",
                "operation": operation,
                "memberId": memberId,
                "payload": payload,
            ],
            store: \.pendingAdminRequests,
            timeoutMessage: "Admin operation '\(operation)' timed out"
        )
    }

    public func sendMedia(_ operation: String, kind: String, payload: [String: Any] = [:]) async throws {
        try await sendVoidRequest(
            [
                "type": "media",
                "operation": operation,
                "kind": kind,
                "payload": payload,
            ],
            store: \.pendingMediaRequests,
            timeoutMessage: "Media operation '\(operation)' timed out"
        )
    }

    public func switchMediaDevices(_ payload: [String: Any]) async throws {
        if let audioInputId = payload["audioInputId"] as? String, !audioInputId.isEmpty {
            try await sendMedia("device", kind: "audio", payload: ["deviceId": audioInputId])
        }
        if let videoInputId = payload["videoInputId"] as? String, !videoInputId.isEmpty {
            try await sendMedia("device", kind: "video", payload: ["deviceId": videoInputId])
        }
        if let screenInputId = payload["screenInputId"] as? String, !screenInputId.isEmpty {
            try await sendMedia("device", kind: "screen", payload: ["deviceId": screenInputId])
        }
    }

    // MARK: - Subscriptions (v2 API)

    /// Subscribe to shared state changes.
    /// Handler receives (fullState, changes) on full sync and each shared_delta.
    @discardableResult
    public func onSharedState(_ handler: @escaping ([String: Any], [String: Any]) -> Void) -> Subscription {
        let key = ObjectIdentifier(handler as AnyObject)
        queue.sync(flags: .barrier) { sharedStateHandlers[key] = handler }
        return Subscription { [weak self] in
            self?.queue.sync(flags: .barrier) { _ = self?.sharedStateHandlers.removeValue(forKey: key) }
        }
    }

    /// Subscribe to player state changes.
    /// Handler receives (fullState, changes) on full sync and each player_delta.
    @discardableResult
    public func onPlayerState(_ handler: @escaping ([String: Any], [String: Any]) -> Void) -> Subscription {
        let key = ObjectIdentifier(handler as AnyObject)
        queue.sync(flags: .barrier) { playerStateHandlers[key] = handler }
        return Subscription { [weak self] in
            self?.queue.sync(flags: .barrier) { _ = self?.playerStateHandlers.removeValue(forKey: key) }
        }
    }

    /// Subscribe to messages of a specific type sent by room.sendMessage().
    @discardableResult
    public func onMessage(_ type: String, handler: @escaping (Any?) -> Void) -> Subscription {
        let key = ObjectIdentifier(handler as AnyObject)
        queue.sync(flags: .barrier) {
            if messageHandlers[type] == nil { messageHandlers[type] = [:] }
            messageHandlers[type]?[key] = handler
        }
        return Subscription { [weak self] in
            self?.queue.sync(flags: .barrier) { _ = self?.messageHandlers[type]?.removeValue(forKey: key) }
        }
    }

    /// Subscribe to ALL messages regardless of type.
    @discardableResult
    public func onAnyMessage(_ handler: @escaping (String, Any?) -> Void) -> Subscription {
        let key = ObjectIdentifier(handler as AnyObject)
        queue.sync(flags: .barrier) { allMessageHandlers[key] = handler }
        return Subscription { [weak self] in
            self?.queue.sync(flags: .barrier) { _ = self?.allMessageHandlers.removeValue(forKey: key) }
        }
    }

    /// Subscribe to error events.
    @discardableResult
    public func onError(_ handler: @escaping (_ code: String, _ message: String) -> Void) -> Subscription {
        let key = ObjectIdentifier(handler as AnyObject)
        queue.sync(flags: .barrier) { errorHandlers[key] = handler }
        return Subscription { [weak self] in
            self?.queue.sync(flags: .barrier) { _ = self?.errorHandlers.removeValue(forKey: key) }
        }
    }

    /// Subscribe to kick events. Auto-reconnect is disabled after being kicked.
    @discardableResult
    public func onKicked(_ handler: @escaping () -> Void) -> Subscription {
        let key = ObjectIdentifier(handler as AnyObject)
        queue.sync(flags: .barrier) { kickedHandlers[key] = handler }
        return Subscription { [weak self] in
            self?.queue.sync(flags: .barrier) { _ = self?.kickedHandlers.removeValue(forKey: key) }
        }
    }

    @discardableResult
    func onMembersSync(_ handler: @escaping ([[String: Any]]) -> Void) -> Subscription {
        let key = UUID()
        queue.sync(flags: .barrier) { membersSyncHandlers[key] = handler }
        return Subscription { [weak self] in
            self?.queue.sync(flags: .barrier) { _ = self?.membersSyncHandlers.removeValue(forKey: key) }
        }
    }

    @discardableResult
    func onMemberJoin(_ handler: @escaping ([String: Any]) -> Void) -> Subscription {
        let key = UUID()
        queue.sync(flags: .barrier) { memberJoinHandlers[key] = handler }
        return Subscription { [weak self] in
            self?.queue.sync(flags: .barrier) { _ = self?.memberJoinHandlers.removeValue(forKey: key) }
        }
    }

    @discardableResult
    func onMemberLeave(_ handler: @escaping ([String: Any], String) -> Void) -> Subscription {
        let key = UUID()
        queue.sync(flags: .barrier) { memberLeaveHandlers[key] = handler }
        return Subscription { [weak self] in
            self?.queue.sync(flags: .barrier) { _ = self?.memberLeaveHandlers.removeValue(forKey: key) }
        }
    }

    @discardableResult
    func onMemberStateChange(_ handler: @escaping ([String: Any], [String: Any]) -> Void) -> Subscription {
        let key = UUID()
        queue.sync(flags: .barrier) { memberStateHandlers[key] = handler }
        return Subscription { [weak self] in
            self?.queue.sync(flags: .barrier) { _ = self?.memberStateHandlers.removeValue(forKey: key) }
        }
    }

    @discardableResult
    func onSignal(_ event: String, handler: @escaping (Any?, [String: Any]) -> Void) -> Subscription {
        let key = UUID()
        queue.sync(flags: .barrier) {
            if signalHandlers[event] == nil { signalHandlers[event] = [:] }
            signalHandlers[event]?[key] = handler
        }
        return Subscription { [weak self] in
            self?.queue.sync(flags: .barrier) { _ = self?.signalHandlers[event]?.removeValue(forKey: key) }
        }
    }

    @discardableResult
    func onAnySignal(_ handler: @escaping (String, Any?, [String: Any]) -> Void) -> Subscription {
        let key = UUID()
        queue.sync(flags: .barrier) { anySignalHandlers[key] = handler }
        return Subscription { [weak self] in
            self?.queue.sync(flags: .barrier) { _ = self?.anySignalHandlers.removeValue(forKey: key) }
        }
    }

    @discardableResult
    func onMediaTrack(_ handler: @escaping ([String: Any], [String: Any]) -> Void) -> Subscription {
        let key = UUID()
        queue.sync(flags: .barrier) { mediaTrackHandlers[key] = handler }
        return Subscription { [weak self] in
            self?.queue.sync(flags: .barrier) { _ = self?.mediaTrackHandlers.removeValue(forKey: key) }
        }
    }

    @discardableResult
    func onMediaTrackRemoved(_ handler: @escaping ([String: Any], [String: Any]) -> Void) -> Subscription {
        let key = UUID()
        queue.sync(flags: .barrier) { mediaTrackRemovedHandlers[key] = handler }
        return Subscription { [weak self] in
            self?.queue.sync(flags: .barrier) { _ = self?.mediaTrackRemovedHandlers.removeValue(forKey: key) }
        }
    }

    @discardableResult
    func onMediaStateChange(_ handler: @escaping ([String: Any], [String: Any]) -> Void) -> Subscription {
        let key = UUID()
        queue.sync(flags: .barrier) { mediaStateHandlers[key] = handler }
        return Subscription { [weak self] in
            self?.queue.sync(flags: .barrier) { _ = self?.mediaStateHandlers.removeValue(forKey: key) }
        }
    }

    @discardableResult
    func onMediaDeviceChange(_ handler: @escaping ([String: Any], [String: Any]) -> Void) -> Subscription {
        let key = UUID()
        queue.sync(flags: .barrier) { mediaDeviceHandlers[key] = handler }
        return Subscription { [weak self] in
            self?.queue.sync(flags: .barrier) { _ = self?.mediaDeviceHandlers.removeValue(forKey: key) }
        }
    }

    @discardableResult
    func onReconnect(_ handler: @escaping ([String: Any]) -> Void) -> Subscription {
        let key = UUID()
        queue.sync(flags: .barrier) { reconnectHandlers[key] = handler }
        return Subscription { [weak self] in
            self?.queue.sync(flags: .barrier) { _ = self?.reconnectHandlers.removeValue(forKey: key) }
        }
    }

    @discardableResult
    func onConnectionStateChange(_ handler: @escaping (String) -> Void) -> Subscription {
        let key = UUID()
        queue.sync(flags: .barrier) { connectionStateHandlers[key] = handler }
        return Subscription { [weak self] in
            self?.queue.sync(flags: .barrier) { _ = self?.connectionStateHandlers.removeValue(forKey: key) }
        }
    }

    // MARK: - Private: Connection

    private func buildWsUrl() -> String {
        var wsUrl = baseUrl
        if wsUrl.hasPrefix("https://") { wsUrl = "wss://" + wsUrl.dropFirst("https://".count) }
        else if wsUrl.hasPrefix("http://") { wsUrl = "ws://" + wsUrl.dropFirst("http://".count) }
        while wsUrl.hasSuffix("/") { wsUrl = String(wsUrl.dropLast()) }

        let ns = namespace.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? namespace
        let id = roomId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? roomId
        return "\(wsUrl)/api/room?namespace=\(ns)&id=\(id)"
    }

    private func establishConnection() async throws {
        guard let url = URL(string: buildWsUrl()) else {
            throw EdgeBaseError(statusCode: 0, message: "Invalid Room WebSocket URL")
        }
        let socket = urlSession.webSocketTask(with: url)
        webSocketTask = socket
        socket.resume()
        isConnected = true
        reconnectAttempts = 0

        do {
            try await authenticate()
            waitingForAuth = false
        } catch {
            handleAuthenticationFailure(error)
            throw error
        }

        Task { await receiveMessages() }
        startHeartbeat()
    }

    private func authenticate() async throws {
        guard let token = try await tokenManager.getAccessToken() else {
            let hasSession = await tokenManager.getRefreshToken() != nil
            let message = hasSession
                ? "Room is waiting for an active access token."
                : "No access token available. Sign in first."
            throw EdgeBaseError(statusCode: 401, message: message)
        }

        try await sendRaw(["type": "auth", "token": token])

        // Wait for auth_success
        guard let ws = webSocketTask else {
            throw EdgeBaseError(statusCode: 500, message: "WebSocket task is nil")
        }
        let response = try await ws.receive()
        if case .string(let text) = response,
           let data = text.data(using: .utf8),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            let msgType = json["type"] as? String ?? ""
            if msgType == "auth_success" || msgType == "auth_refreshed" {
                isAuthenticated = true
                currentUserId = json["userId"] as? String ?? currentUserId
                currentConnectionId = json["connectionId"] as? String ?? currentConnectionId

                // Send join with last known state for eviction recovery (v2: shared + player)
                let joinMsg: [String: Any] = queue.sync {
                    return [
                        "type": "join",
                        "lastSharedState": _sharedState,
                        "lastSharedVersion": _sharedVersion,
                        "lastPlayerState": _playerState,
                        "lastPlayerVersion": _playerVersion,
                    ]
                }
                try? await sendRaw(joinMsg)
                isJoined = true
                return
            }
            let errMsg = json["message"] as? String ?? "Unknown auth error"
            throw EdgeBaseError(statusCode: 401, message: errMsg)
        }
        throw EdgeBaseError(statusCode: 401, message: "Room auth timeout")
    }

    // MARK: - Private: Message Handling

    private func receiveMessages() async {
        guard let ws = webSocketTask else { return }
        while isConnected {
            do {
                let message = try await ws.receive()
                switch message {
                case .string(let text):
                    if let data = text.data(using: .utf8),
                       let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                        handleMessage(json)
                    }
                case .data(let data):
                    if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                        handleMessage(json)
                    }
                @unknown default: break
                }
            } catch {
                isConnected = false
                isAuthenticated = false
                isJoined = false
                if let task = ws as? URLSessionWebSocketTask,
                   task.closeCode.rawValue == 4004,
                   currentConnectionState != "kicked" {
                    handleKicked()
                }
                if !intentionallyLeft && !waitingForAuth && options.autoReconnect && reconnectAttempts < options.maxReconnectAttempts {
                    reconnectInfo = ["attempt": reconnectAttempts + 1]
                    setConnectionState("reconnecting")
                    let delay = min(options.reconnectBaseDelay * pow(2.0, Double(reconnectAttempts)), 30.0)
                    reconnectAttempts += 1
                    try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                    try? await establishConnection()
                } else if !intentionallyLeft && currentConnectionState != "kicked" && currentConnectionState != "auth_lost" {
                    setConnectionState("disconnected")
                }
                return
            }
        }
    }

    private func handleMessage(_ json: [String: Any]) {
        let msgType = json["type"] as? String ?? ""

        switch msgType {
        case "auth_success", "auth_refreshed":
            handleAuthAck(json)
        case "sync":
            handleSync(json)
        case "shared_delta":
            handleSharedDelta(json)
        case "player_delta":
            handlePlayerDelta(json)
        case "action_result":
            handleActionResult(json)
        case "action_error":
            handleActionError(json)
        case "message":
            handleServerMessage(json)
        case "signal":
            handleSignalFrame(json)
        case "signal_sent":
            resolvePendingVoid(\.pendingSignalRequests, requestId: json["requestId"] as? String)
        case "signal_error":
            rejectPendingVoid(\.pendingSignalRequests, requestId: json["requestId"] as? String, message: json["message"] as? String ?? "Signal error")
        case "members_sync":
            handleMembersSync(json)
        case "member_join":
            handleMemberJoin(json)
        case "member_leave":
            handleMemberLeave(json)
        case "member_state":
            handleMemberState(json)
        case "member_state_error":
            rejectPendingVoid(\.pendingMemberStateRequests, requestId: json["requestId"] as? String, message: json["message"] as? String ?? "Member state error")
        case "media_sync":
            handleMediaSync(json)
        case "media_track":
            handleMediaTrack(json)
        case "media_track_removed":
            handleMediaTrackRemoved(json)
        case "media_state":
            handleMediaState(json)
        case "media_device":
            handleMediaDevice(json)
        case "media_result":
            resolvePendingVoid(\.pendingMediaRequests, requestId: json["requestId"] as? String)
        case "media_error":
            rejectPendingVoid(\.pendingMediaRequests, requestId: json["requestId"] as? String, message: json["message"] as? String ?? "Media error")
        case "admin_result":
            resolvePendingVoid(\.pendingAdminRequests, requestId: json["requestId"] as? String)
        case "admin_error":
            rejectPendingVoid(\.pendingAdminRequests, requestId: json["requestId"] as? String, message: json["message"] as? String ?? "Admin error")
        case "kicked":
            handleKicked()
        case "error":
            handleError(json)
        case "pong":
            break // Heartbeat response -- no action needed
        default:
            break
        }
    }

    private func handleSync(_ json: [String: Any]) {
        let pendingReconnect = reconnectInfo
        queue.sync(flags: .barrier) {
            _sharedState = json["sharedState"] as? [String: Any] ?? [:]
            _sharedVersion = json["sharedVersion"] as? Int ?? 0
            _playerState = json["playerState"] as? [String: Any] ?? [:]
            _playerVersion = json["playerVersion"] as? Int ?? 0
        }

        let sharedState = queue.sync { _sharedState }
        let playerState = queue.sync { _playerState }
        reconnectInfo = nil
        setConnectionState("connected")

        // Notify handlers with full state as changes (same as JS SDK)
        queue.sync {
            for handler in sharedStateHandlers.values { handler(sharedState, sharedState) }
            for handler in playerStateHandlers.values { handler(playerState, playerState) }
            if let pendingReconnect {
                for handler in reconnectHandlers.values { handler(pendingReconnect) }
            }
        }
    }

    private func handleSharedDelta(_ json: [String: Any]) {
        let delta = json["delta"] as? [String: Any] ?? [:]

        queue.sync(flags: .barrier) {
            _sharedVersion = json["version"] as? Int ?? _sharedVersion
            for (path, value) in delta {
                deepSet(&_sharedState, path: path, value: value)
            }
        }

        let state = queue.sync { _sharedState }
        queue.sync {
            for handler in sharedStateHandlers.values { handler(state, delta) }
        }
    }

    private func handlePlayerDelta(_ json: [String: Any]) {
        let delta = json["delta"] as? [String: Any] ?? [:]

        queue.sync(flags: .barrier) {
            _playerVersion = json["version"] as? Int ?? _playerVersion
            for (path, value) in delta {
                deepSet(&_playerState, path: path, value: value)
            }
        }

        let state = queue.sync { _playerState }
        queue.sync {
            for handler in playerStateHandlers.values { handler(state, delta) }
        }
    }

    private func handleActionResult(_ json: [String: Any]) {
        let requestId = json["requestId"] as? String ?? ""
        queue.sync(flags: .barrier) {
            if let pending = pendingRequests.removeValue(forKey: requestId) {
                pending.timeoutTask.cancel()
                pending.continuation.resume(returning: json["result"])
            }
        }
    }

    private func handleActionError(_ json: [String: Any]) {
        let requestId = json["requestId"] as? String ?? ""
        let message = json["message"] as? String ?? "Action error"
        queue.sync(flags: .barrier) {
            if let pending = pendingRequests.removeValue(forKey: requestId) {
                pending.timeoutTask.cancel()
                pending.continuation.resume(throwing: EdgeBaseError(statusCode: 400, message: message))
            }
        }
    }

    private func handleServerMessage(_ json: [String: Any]) {
        let messageType = json["messageType"] as? String ?? ""
        let data = json["data"]

        queue.sync {
            // Type-specific handlers
            if let handlers = messageHandlers[messageType] {
                for handler in handlers.values { handler(data) }
            }
            // All-message handlers
            for handler in allMessageHandlers.values { handler(messageType, data) }
        }
    }

    private func handleAuthAck(_ json: [String: Any]) {
        isAuthenticated = true
        currentUserId = json["userId"] as? String ?? currentUserId
        currentConnectionId = json["connectionId"] as? String ?? currentConnectionId
    }

    private func handleKicked() {
        queue.sync { for handler in kickedHandlers.values { handler() } }
        // Don't auto-reconnect after being kicked
        intentionallyLeft = true
        joinRequested = false
        setConnectionState("kicked")
    }

    private func handleError(_ json: [String: Any]) {
        let code = json["code"] as? String ?? ""
        let message = json["message"] as? String ?? ""
        queue.sync { for handler in errorHandlers.values { handler(code, message) } }
    }

    private func handleMembersSync(_ json: [String: Any]) {
        let members = (json["members"] as? [[String: Any]] ?? []).map(cloneRecord)
        queue.sync(flags: .barrier) {
            _members = members
            _mediaMembers.removeAll { mediaMember in
                guard let member = mediaMember["member"] as? [String: Any],
                      let memberId = member["memberId"] as? String else { return false }
                return !members.contains(where: { ($0["memberId"] as? String) == memberId })
            }
            for handler in membersSyncHandlers.values { handler(members) }
        }
    }

    private func handleMemberJoin(_ json: [String: Any]) {
        guard let member = json["member"] as? [String: Any] else { return }
        let memberCopy = cloneRecord(member)
        queue.sync(flags: .barrier) {
            upsertMember(memberCopy)
            for handler in memberJoinHandlers.values { handler(memberCopy) }
        }
    }

    private func handleMemberLeave(_ json: [String: Any]) {
        guard let member = json["member"] as? [String: Any] else { return }
        let memberCopy = cloneRecord(member)
        let reason = json["reason"] as? String ?? ""
        queue.sync(flags: .barrier) {
            let memberId = memberCopy["memberId"] as? String ?? memberCopy["userId"] as? String
            if let memberId {
                _members.removeAll { ($0["memberId"] as? String ?? $0["userId"] as? String) == memberId }
                _mediaMembers.removeAll { ($0["member"] as? [String: Any])?["memberId"] as? String == memberId }
            }
            for handler in memberLeaveHandlers.values { handler(memberCopy, reason) }
        }
    }

    private func handleMemberState(_ json: [String: Any]) {
        let member = cloneRecord(json["member"] as? [String: Any] ?? [:])
        let state = cloneRecord((json["state"] as? [String: Any]) ?? (member["state"] as? [String: Any] ?? [:]))
        if let requestId = json["requestId"] as? String {
            resolvePendingVoid(\.pendingMemberStateRequests, requestId: requestId)
        }
        queue.sync(flags: .barrier) {
            if !member.isEmpty { upsertMember(member) }
            for handler in memberStateHandlers.values { handler(member, state) }
        }
    }

    private func handleSignalFrame(_ json: [String: Any]) {
        let event = json["event"] as? String ?? ""
        let payload = json["payload"]
        let meta = cloneRecord(json["meta"] as? [String: Any] ?? [:])
        queue.sync {
            if let handlers = signalHandlers[event] {
                for handler in handlers.values { handler(payload, meta) }
            }
            for handler in anySignalHandlers.values { handler(event, payload, meta) }
        }
    }

    private func handleMediaSync(_ json: [String: Any]) {
        let members = (json["members"] as? [[String: Any]] ?? []).map(cloneRecord)
        queue.sync(flags: .barrier) {
            _mediaMembers = members
        }
    }

    private func handleMediaTrack(_ json: [String: Any]) {
        guard let member = json["member"] as? [String: Any],
              let track = json["track"] as? [String: Any] else { return }
        let memberCopy = cloneRecord(member)
        let trackCopy = cloneRecord(track)
        queue.sync(flags: .barrier) {
            upsertMediaTrack(member: memberCopy, track: trackCopy)
            for handler in mediaTrackHandlers.values { handler(trackCopy, memberCopy) }
        }
    }

    private func handleMediaTrackRemoved(_ json: [String: Any]) {
        guard let member = json["member"] as? [String: Any],
              let track = json["track"] as? [String: Any] else { return }
        let memberCopy = cloneRecord(member)
        let trackCopy = cloneRecord(track)
        queue.sync(flags: .barrier) {
            removeMediaTrack(member: memberCopy, track: trackCopy)
            for handler in mediaTrackRemovedHandlers.values { handler(trackCopy, memberCopy) }
        }
    }

    private func handleMediaState(_ json: [String: Any]) {
        guard let member = json["member"] as? [String: Any] else { return }
        let memberCopy = cloneRecord(member)
        let state = cloneRecord(json["state"] as? [String: Any] ?? [:])
        queue.sync(flags: .barrier) {
            let index = ensureMediaMember(memberCopy)
            _mediaMembers[index]["state"] = state
            for handler in mediaStateHandlers.values { handler(memberCopy, state) }
        }
    }

    private func handleMediaDevice(_ json: [String: Any]) {
        guard let member = json["member"] as? [String: Any] else { return }
        let memberCopy = cloneRecord(member)
        let change: [String: Any] = [
            "kind": json["kind"] as? String ?? "",
            "deviceId": json["deviceId"] as? String ?? "",
        ]
        queue.sync(flags: .barrier) {
            _ = ensureMediaMember(memberCopy)
            for handler in mediaDeviceHandlers.values { handler(memberCopy, change) }
        }
    }

    // MARK: - Private: Helpers

    private func sendVoidRequest(
        _ msg: [String: Any],
        store: ReferenceWritableKeyPath<RoomClient, [String: PendingVoidRequest]>,
        timeoutMessage: String
    ) async throws {
        guard webSocketTask != nil, isConnected, isAuthenticated else {
            throw EdgeBaseError(statusCode: 400, message: "Not connected to room")
        }

        let requestId = UUID().uuidString
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let timeoutTask = Task { [weak self, options] in
                try? await Task.sleep(nanoseconds: UInt64(options.sendTimeout * 1_000_000_000))
                guard !Task.isCancelled else { return }
                self?.queue.sync(flags: .barrier) {
                    if let pending = self?[keyPath: store].removeValue(forKey: requestId) {
                        pending.continuation.resume(throwing: EdgeBaseError(statusCode: 408, message: timeoutMessage))
                    }
                }
            }

            queue.sync(flags: .barrier) {
                self[keyPath: store][requestId] = PendingVoidRequest(
                    continuation: continuation,
                    timeoutTask: timeoutTask
                )
            }

            var payload = msg
            payload["requestId"] = requestId
            Task { try? await self.sendRaw(payload) }
        }
    }

    private func resolvePendingVoid(_ store: ReferenceWritableKeyPath<RoomClient, [String: PendingVoidRequest]>, requestId: String?) {
        guard let requestId else { return }
        if let pending = queue.sync(flags: .barrier, execute: { self[keyPath: store].removeValue(forKey: requestId) }) {
            pending.timeoutTask.cancel()
            pending.continuation.resume()
        }
    }

    private func rejectPendingVoid(
        _ store: ReferenceWritableKeyPath<RoomClient, [String: PendingVoidRequest]>,
        requestId: String?,
        message: String
    ) {
        guard let requestId else { return }
        if let pending = queue.sync(flags: .barrier, execute: { self[keyPath: store].removeValue(forKey: requestId) }) {
            pending.timeoutTask.cancel()
            pending.continuation.resume(throwing: EdgeBaseError(statusCode: 400, message: message))
        }
    }

    private func rejectPendingVoidRequests(_ store: inout [String: PendingVoidRequest], message: String) {
        for (_, pending) in store {
            pending.timeoutTask.cancel()
            pending.continuation.resume(throwing: EdgeBaseError(statusCode: 499, message: message))
        }
        store.removeAll()
    }

    private func upsertMember(_ member: [String: Any]) {
        let memberId = (member["memberId"] as? String) ?? (member["userId"] as? String)
        guard let memberId else { return }
        if let index = _members.firstIndex(where: { (($0["memberId"] as? String) ?? ($0["userId"] as? String)) == memberId }) {
            _members[index] = member
        } else {
            _members.append(member)
        }
    }

    private func ensureMediaMember(_ member: [String: Any]) -> Int {
        let memberId = (member["memberId"] as? String) ?? (member["userId"] as? String)
        if let memberId,
           let index = _mediaMembers.firstIndex(where: { (($0["member"] as? [String: Any])?["memberId"] as? String) == memberId }) {
            _mediaMembers[index]["member"] = member
            if _mediaMembers[index]["state"] == nil { _mediaMembers[index]["state"] = [String: Any]() }
            if _mediaMembers[index]["tracks"] == nil { _mediaMembers[index]["tracks"] = [[String: Any]]() }
            return index
        }

        let created: [String: Any] = [
            "member": member,
            "state": [String: Any](),
            "tracks": [[String: Any]](),
        ]
        _mediaMembers.append(created)
        return _mediaMembers.count - 1
    }

    private func upsertMediaTrack(member: [String: Any], track: [String: Any]) {
        let index = ensureMediaMember(member)
        var mediaMember = _mediaMembers[index]
        var tracks = mediaMember["tracks"] as? [[String: Any]] ?? []
        let trackId = track["trackId"] as? String
        let kind = track["kind"] as? String
        if let existingIndex = tracks.firstIndex(where: { existing in
            if let trackId { return (existing["trackId"] as? String) == trackId }
            return (existing["kind"] as? String) == kind
        }) {
            tracks[existingIndex] = track
        } else {
            tracks.append(track)
        }
        mediaMember["tracks"] = tracks
        _mediaMembers[index] = mediaMember
    }

    private func removeMediaTrack(member: [String: Any], track: [String: Any]) {
        let memberId = member["memberId"] as? String
        guard let index = _mediaMembers.firstIndex(where: { (($0["member"] as? [String: Any])?["memberId"] as? String) == memberId }) else {
            return
        }

        var mediaMember = _mediaMembers[index]
        var tracks = mediaMember["tracks"] as? [[String: Any]] ?? []
        let trackId = track["trackId"] as? String
        let kind = track["kind"] as? String
        tracks.removeAll { existing in
            if let trackId { return (existing["trackId"] as? String) == trackId }
            return (existing["kind"] as? String) == kind
        }
        mediaMember["tracks"] = tracks
        _mediaMembers[index] = mediaMember
    }

    private func setConnectionState(_ nextState: String) {
        guard currentConnectionState != nextState else { return }
        currentConnectionState = nextState
        queue.sync {
            for handler in connectionStateHandlers.values { handler(nextState) }
        }
    }

    private func sendRaw(_ msg: [String: Any]) async throws {
        guard let ws = webSocketTask, isConnected else { return }
        try await sendRaw(on: ws, msg)
    }

    private func sendRaw(on ws: any RoomWebSocketTask, _ msg: [String: Any]) async throws {
        let data = try JSONSerialization.data(withJSONObject: msg)
        let text = String(data: data, encoding: .utf8)!
        try await ws.send(.string(text))
    }

    private func sendLeaveAndClose(_ ws: any RoomWebSocketTask, reason: String) {
        Task {
            try? await sendRaw(on: ws, ["type": "leave"])
            try? await Task.sleep(nanoseconds: roomExplicitLeaveCloseDelayNs)
            ws.cancel(with: .normalClosure, reason: reason.data(using: .utf8))
        }
    }

    private func startHeartbeat() {
        stopHeartbeat()
        DispatchQueue.main.async { [weak self] in
            self?.heartbeatTimer = Timer.scheduledTimer(withTimeInterval: 30.0, repeats: true) { [weak self] _ in
                Task { try? await self?.sendRaw(["type": "ping"]) }
            }
        }
    }

    private func stopHeartbeat() {
        heartbeatTimer?.invalidate()
        heartbeatTimer = nil
    }

    private func refreshAuth() {
        Task { [weak self] in
            guard let self else { return }
            guard let token = try await self.tokenManager.getAccessToken() else { return }
            try? await self.sendRaw(["type": "auth", "token": token])
        }
    }

    private func handleAuthStateChange(_ user: [String: Any]?) {
        if user != nil {
            if isConnected && isAuthenticated {
                refreshAuth()
                return
            }

            waitingForAuth = false
            if joinRequested && !isConnected {
                reconnectAttempts = 0
                Task { try? await self.establishConnection() }
            }
            return
        }

        waitingForAuth = joinRequested
        isConnected = false
        isAuthenticated = false
        isJoined = false
        stopHeartbeat()
        let socket = webSocketTask
        webSocketTask = nil
        if let socket {
            sendLeaveAndClose(socket, reason: "Signed out")
        }
    }

    private func handleAuthenticationFailure(_ error: Error) {
        let statusCode = (error as? EdgeBaseError)?.statusCode
        waitingForAuth = statusCode == 401 && joinRequested
        isConnected = false
        isAuthenticated = false
        isJoined = false
        stopHeartbeat()
        webSocketTask?.cancel(with: .policyViolation, reason: error.localizedDescription.data(using: .utf8))
        webSocketTask = nil
    }

    // MARK: - Destroy

    /// Tear down the room client and clean up all resources.
    public func destroy() {
        leave()
        queue.sync(flags: .barrier) {
            sharedStateHandlers.removeAll()
            playerStateHandlers.removeAll()
            messageHandlers.removeAll()
            allMessageHandlers.removeAll()
            errorHandlers.removeAll()
            kickedHandlers.removeAll()
            membersSyncHandlers.removeAll()
            memberJoinHandlers.removeAll()
            memberLeaveHandlers.removeAll()
            memberStateHandlers.removeAll()
            signalHandlers.removeAll()
            anySignalHandlers.removeAll()
            mediaTrackHandlers.removeAll()
            mediaTrackRemovedHandlers.removeAll()
            mediaStateHandlers.removeAll()
            mediaDeviceHandlers.removeAll()
            reconnectHandlers.removeAll()
            connectionStateHandlers.removeAll()
        }
    }
}

// MARK: - Deep Set Helper

private func deepSet(_ obj: inout [String: Any], path: String, value: Any) {
    let parts = path.split(separator: ".").map(String.init)
    guard !parts.isEmpty else { return }
    if parts.count == 1 {
        if value is NSNull {
            obj.removeValue(forKey: parts[0])
        } else {
            obj[parts[0]] = value
        }
        return
    }
    var nested = obj[parts[0]] as? [String: Any] ?? [:]
    let remainingPath = parts.dropFirst().joined(separator: ".")
    deepSet(&nested, path: remainingPath, value: value)
    obj[parts[0]] = nested
}

private func cloneValue(_ value: Any) -> Any {
    if let dict = value as? [String: Any] {
        return cloneRecord(dict)
    }
    if let array = value as? [[String: Any]] {
        return array.map(cloneRecord)
    }
    if let array = value as? [Any] {
        return array.map { cloneValue($0) }
    }
    return value
}

private func cloneRecord(_ value: [String: Any]) -> [String: Any] {
    var copy: [String: Any] = [:]
    for (key, item) in value {
        copy[key] = cloneValue(item)
    }
    return copy
}

public final class RoomStateNamespace: @unchecked Sendable {
    private unowned let room: RoomClient

    init(room: RoomClient) {
        self.room = room
    }

    public func getShared() -> [String: Any] { room.getSharedState() }
    public func getMine() -> [String: Any] { room.getPlayerState() }
    public func onSharedChange(_ handler: @escaping ([String: Any], [String: Any]) -> Void) -> Subscription { room.onSharedState(handler) }
    public func onMineChange(_ handler: @escaping ([String: Any], [String: Any]) -> Void) -> Subscription { room.onPlayerState(handler) }
    public func send(_ actionType: String, payload: Any? = nil) async throws -> Any? { try await room.send(actionType, payload: payload) }
}

public final class RoomMetaNamespace: @unchecked Sendable {
    private unowned let room: RoomClient

    init(room: RoomClient) {
        self.room = room
    }

    public func get() async throws -> [String: Any] { try await room.getMetadata() }
}

public final class RoomSignalsNamespace: @unchecked Sendable {
    private unowned let room: RoomClient

    init(room: RoomClient) {
        self.room = room
    }

    public func send(_ event: String, payload: Any? = nil, options: [String: Any] = [:]) async throws {
        try await room.sendSignal(event, payload: payload, options: options)
    }

    public func sendTo(memberId: String, event: String, payload: Any? = nil) async throws {
        try await room.sendSignal(event, payload: payload, options: ["memberId": memberId])
    }

    public func on(_ event: String, handler: @escaping (Any?, [String: Any]) -> Void) -> Subscription {
        room.onSignal(event, handler: handler)
    }

    public func onAny(_ handler: @escaping (String, Any?, [String: Any]) -> Void) -> Subscription {
        room.onAnySignal(handler)
    }
}

public final class RoomMembersNamespace: @unchecked Sendable {
    private unowned let room: RoomClient

    init(room: RoomClient) {
        self.room = room
    }

    public func list() -> [[String: Any]] { room.listMembers() }
    public func onSync(_ handler: @escaping ([[String: Any]]) -> Void) -> Subscription { room.onMembersSync(handler) }
    public func onJoin(_ handler: @escaping ([String: Any]) -> Void) -> Subscription { room.onMemberJoin(handler) }
    public func onLeave(_ handler: @escaping ([String: Any], String) -> Void) -> Subscription { room.onMemberLeave(handler) }
    public func setState(_ state: [String: Any]) async throws { try await room.sendMemberState(state) }
    public func clearState() async throws { try await room.clearMemberState() }
    public func onStateChange(_ handler: @escaping ([String: Any], [String: Any]) -> Void) -> Subscription { room.onMemberStateChange(handler) }
}

public final class RoomAdminNamespace: @unchecked Sendable {
    private unowned let room: RoomClient

    init(room: RoomClient) {
        self.room = room
    }

    public func kick(_ memberId: String) async throws { try await room.sendAdmin("kick", memberId: memberId) }
    public func mute(_ memberId: String) async throws { try await room.sendAdmin("mute", memberId: memberId) }
    public func block(_ memberId: String) async throws { try await room.sendAdmin("block", memberId: memberId) }
    public func setRole(_ memberId: String, role: String) async throws { try await room.sendAdmin("setRole", memberId: memberId, payload: ["role": role]) }
    public func disableVideo(_ memberId: String) async throws { try await room.sendAdmin("disableVideo", memberId: memberId) }
    public func stopScreenShare(_ memberId: String) async throws { try await room.sendAdmin("stopScreenShare", memberId: memberId) }
}

public final class RoomMediaKindNamespace: @unchecked Sendable {
    private unowned let room: RoomClient
    private let kind: String

    init(room: RoomClient, kind: String) {
        self.room = room
        self.kind = kind
    }

    public func enable(_ payload: [String: Any] = [:]) async throws { try await room.sendMedia("publish", kind: kind, payload: payload) }
    public func disable() async throws { try await room.sendMedia("unpublish", kind: kind) }
    public func setMuted(_ muted: Bool) async throws { try await room.sendMedia("mute", kind: kind, payload: ["muted": muted]) }
}

public final class RoomScreenMediaNamespace: @unchecked Sendable {
    private unowned let room: RoomClient

    init(room: RoomClient) {
        self.room = room
    }

    public func start(_ payload: [String: Any] = [:]) async throws { try await room.sendMedia("publish", kind: "screen", payload: payload) }
    public func stop() async throws { try await room.sendMedia("unpublish", kind: "screen") }
}

public final class RoomMediaDevicesNamespace: @unchecked Sendable {
    private unowned let room: RoomClient

    init(room: RoomClient) {
        self.room = room
    }

    public func `switch`(_ payload: [String: Any]) async throws { try await room.switchMediaDevices(payload) }
}

public final class RoomMediaNamespace: @unchecked Sendable {
    private unowned let room: RoomClient

    init(room: RoomClient) {
        self.room = room
        audio = RoomMediaKindNamespace(room: room, kind: "audio")
        video = RoomMediaKindNamespace(room: room, kind: "video")
        screen = RoomScreenMediaNamespace(room: room)
        devices = RoomMediaDevicesNamespace(room: room)
    }

    public let audio: RoomMediaKindNamespace
    public let video: RoomMediaKindNamespace
    public let screen: RoomScreenMediaNamespace
    public let devices: RoomMediaDevicesNamespace

    public func list() -> [[String: Any]] { room.listMediaMembers() }
    public func onTrack(_ handler: @escaping ([String: Any], [String: Any]) -> Void) -> Subscription { room.onMediaTrack(handler) }
    public func onTrackRemoved(_ handler: @escaping ([String: Any], [String: Any]) -> Void) -> Subscription { room.onMediaTrackRemoved(handler) }
    public func onStateChange(_ handler: @escaping ([String: Any], [String: Any]) -> Void) -> Subscription { room.onMediaStateChange(handler) }
    public func onDeviceChange(_ handler: @escaping ([String: Any], [String: Any]) -> Void) -> Subscription { room.onMediaDeviceChange(handler) }
}

public final class RoomSessionNamespace: @unchecked Sendable {
    private unowned let room: RoomClient

    init(room: RoomClient) {
        self.room = room
    }

    public func onError(_ handler: @escaping (String, String) -> Void) -> Subscription { room.onError(handler) }
    public func onKicked(_ handler: @escaping () -> Void) -> Subscription { room.onKicked(handler) }
    public func onReconnect(_ handler: @escaping ([String: Any]) -> Void) -> Subscription { room.onReconnect(handler) }
    public func onConnectionStateChange(_ handler: @escaping (String) -> Void) -> Subscription { room.onConnectionStateChange(handler) }
    public func userId() -> String? { room.userId() }
    public func connectionId() -> String? { room.connectionId() }
    public func connectionState() -> String { room.connectionState() }
}
