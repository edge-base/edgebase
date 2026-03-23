import EdgeBaseCore
// Database live client — URLSessionWebSocketTask-based subscription transport.
//
// Mirrors JS SDK DatabaseLiveClient (packages/sdk/js/packages/web/src/database_live.ts):
// - WebSocket connection with message-based auth (not HTTP headers)
// - Collection subscriptions (AsyncStream<DbChange>)
// - Server-side filters & OR filters
// - auth_refreshed + revokedChannels handling
// - FILTER_RESYNC recovery after DO hibernation

import Foundation

// MARK: - Filter Types

/// Filter tuple for server-side filtering.
/// Mirrors JS SDK FilterTuple: [field, op, value].
public typealias DatabaseLiveFilterTuple = [Any]

/// Subscriber info for per-subscriber filter tracking.
/// Enables recomputeChannelFilters() pattern (see JS SDK PR #14).
private struct DatabaseLiveSubscriber {
    let id: Int
    let handler: (DbChange) -> Void
    let filters: [DatabaseLiveFilterTuple]?
    let orFilters: [DatabaseLiveFilterTuple]?
}

private func normalizeDatabaseLiveChannel(_ tableOrChannel: String) -> String {
    tableOrChannel.hasPrefix("dblive:") ? tableOrChannel : "dblive:\(tableOrChannel)"
}

private func channelTableName(_ channel: String) -> String {
    let parts = channel.split(separator: ":").map(String.init)
    switch parts.count {
    case ...1:
        return channel
    case 2:
        return parts[1]
    case 3:
        return parts[2]
    default:
        return parts[3]
    }
}

private func matchesDatabaseLiveChannel(_ channel: String, change: DbChange, messageChannel: String? = nil) -> Bool {
    if let messageChannel, !messageChannel.isEmpty {
        return channel == normalizeDatabaseLiveChannel(messageChannel)
    }
    let parts = channel.split(separator: ":").map(String.init)
    guard parts.first == "dblive" else { return false }
    switch parts.count {
    case 2:
        return parts[1] == change.table
    case 3:
        return parts[2] == change.table
    case 4:
        // Could be dblive:ns:table:docId or dblive:ns:instanceId:table
        if parts[2] == change.table && change.id == parts[3] { return true }
        return parts[3] == change.table
    default:
        return parts[3] == change.table && change.id == parts[4]
    }
}

// MARK: - Database Live Client

/// Database live client using URLSessionWebSocketTask for WebSocket communication.
///
/// Auth flow (CRITICAL —):
///   1. Open WebSocket connection (no HTTP Authorization header)
///   2. Send `{"type":"auth","token":"...","sdkVersion":"0.2.2"}` message
///   3. Wait for `auth_success` or `auth_refreshed` before sending subscribe messages
///   4. On `auth_refreshed`: parse `revokedChannels`, clean up, re-subscribe remaining
///
/// The server database live endpoint ignores HTTP headers and requires message-based auth.
final class DatabaseLiveClient: DatabaseLiveSubscribable, @unchecked Sendable {
    private let url: String
    private let tokenManager: TokenManager
    private var webSocketTask: URLSessionWebSocketTask?
    private let session: URLSession
    private var isConnected = false
    private var isAuthenticated = false
    private var shouldReconnect = true
    private var reconnectAttempts = 0
    private let maxReconnectAttempts = 10
    private let reconnectBaseDelay: TimeInterval = 1.0
    private var subscriptions: [String: [DatabaseLiveSubscriber]] = [:]
    private var nextSubscriberId = 0
    private var messageHandlers: [String: [(Any) -> Void]] = [:]
    private var waitingForAuth = false

    /// Server-side filters per channel for recovery after FILTER_RESYNC.
    private var channelFilters: [String: [DatabaseLiveFilterTuple]] = [:]
    /// Server-side OR filters per channel for recovery after FILTER_RESYNC.
    private var channelOrFilters: [String: [DatabaseLiveFilterTuple]] = [:]

    private let queue = DispatchQueue(label: "com.edgebase.dblive")
    private var heartbeatTimer: Timer?

    /// Continuation used during auth handshake to resolve the connect() async call.
    private var authContinuation: CheckedContinuation<Void, Error>?

    init(url: String, tokenManager: TokenManager, session: URLSession = .shared) {
        // Convert http(s) to ws(s) for WebSocket
        var wsUrl = url
        if wsUrl.hasPrefix("https://") {
            wsUrl = "wss://" + wsUrl.dropFirst("https://".count)
        } else if wsUrl.hasPrefix("http://") {
            wsUrl = "ws://" + wsUrl.dropFirst("http://".count)
        }
        // Remove trailing slash
        while wsUrl.hasSuffix("/") { wsUrl = String(wsUrl.dropLast()) }
        self.url = wsUrl
        self.tokenManager = tokenManager
        self.session = session

        Task { [weak self] in
            await tokenManager.onAuthStateChange { user in
                self?.handleAuthStateChange(user)
            }
        }
    }

    // MARK: - Public API

    /// Connect to WebSocket server and authenticate via message-based auth.
    ///
    /// Unlike the old implementation that used HTTP Authorization headers (which the server
    /// ignores), this sends a `type: 'auth'` WebSocket message after connection and waits
    /// for `auth_success` or `auth_refreshed` before allowing subscribe messages.
    ///
    /// - Parameter channel: Optional channel hint for the WS endpoint URL.
    func connect(channel: String? = nil) async throws {
        // If already connected and authenticated, just subscribe if a channel is given
        if isConnected && isAuthenticated {
            if let ch = channel {
                sendSubscribe(ch)
            }
            return
        }

        var wsUrlString = url + ApiPaths.CONNECT_DATABASE_SUBSCRIPTION
        if let ch = channel {
            wsUrlString += "?channel=\(ch.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ch)"
        }
        guard let wsURL = URL(string: wsUrlString) else {
            throw EdgeBaseError(statusCode: 0, message: "Invalid WebSocket URL: \(wsUrlString)")
        }

        // No HTTP Authorization header — server ignores it.
        // Auth is done via WebSocket message after connect.
        let request = URLRequest(url: wsURL)
        webSocketTask = session.webSocketTask(with: request)
        webSocketTask?.resume()
        isConnected = true
        reconnectAttempts = 0
        shouldReconnect = true

        // Authenticate via message-based auth
        do {
            try await authenticate()
            waitingForAuth = false
        } catch {
            handleAuthenticationFailure(error)
            throw error
        }

        // Start receiving messages (after auth handshake completes)
        Task { [weak self] in await self?.receiveMessages() }

        // Start heartbeat
        startHeartbeat()
    }

    /// Disconnect from WebSocket server.
    func disconnect() {
        shouldReconnect = false
        isConnected = false
        isAuthenticated = false
        waitingForAuth = false
        stopHeartbeat()
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        webSocketTask = nil
    }

    /// Subscribe to table changes.
    /// Returns an AsyncStream that yields DbChange events for the given table.
    ///
    /// This method ensures the WebSocket is connected and authenticated before
    /// sending the subscribe message to the server.
    func subscribe(_ tableName: String) -> AsyncStream<DbChange> {
        return subscribe(tableName, filters: nil, orFilters: nil)
    }

    /// Subscribe to table changes with server-side filters.
    ///
    /// - Parameters:
    ///   - tableName: Table name (e.g. "posts").
    ///   - filters: Server-side filter tuples, e.g. [["status", "==", "active"]].
    ///   - orFilters: Server-side OR filter tuples.
    /// - Returns: AsyncStream of DbChange events.
    func subscribe(
        _ tableName: String,
        filters: [DatabaseLiveFilterTuple]? = nil,
        orFilters: [DatabaseLiveFilterTuple]? = nil
    ) -> AsyncStream<DbChange> {
        let channel = normalizeDatabaseLiveChannel(tableName)

        return AsyncStream { continuation in
            let handler: (DbChange) -> Void = { change in
                continuation.yield(change)
            }

            let subscriberId = self.queue.sync { () -> Int in
                let id = self.nextSubscriberId
                self.nextSubscriberId += 1
                return id
            }

            let subscriber = DatabaseLiveSubscriber(
                id: subscriberId,
                handler: handler,
                filters: filters,
                orFilters: orFilters
            )

            self.queue.sync {
                if self.subscriptions[channel] == nil {
                    self.subscriptions[channel] = []
                }
                self.subscriptions[channel]?.append(subscriber)
                self.recomputeChannelFilters(channel)
            }

            Task { [weak self] in
                guard let self = self else { return }
                do {
                    try await self.connect(channel: channel)
                    self.sendSubscribe(channel)
                } catch {
                    continuation.finish()
                }
            }

            continuation.onTermination = { _ in
                self.queue.sync {
                    // Remove this specific subscriber by ID
                    self.subscriptions[channel]?.removeAll { $0.id == subscriberId }
                    // If no subscribers remain, clean up entirely
                    if self.subscriptions[channel]?.isEmpty == true {
                        self.subscriptions.removeValue(forKey: channel)
                        self.channelFilters.removeValue(forKey: channel)
                        self.channelOrFilters.removeValue(forKey: channel)
                    } else {
                        // Recompute filters from remaining subscribers and re-send subscribe
                        self.recomputeChannelFilters(channel)
                    }
                }
                if self.queue.sync(execute: { self.subscriptions[channel] == nil }) {
                    self.sendUnsubscribe(channel)
                } else {
                    self.sendSubscribe(channel)
                }
            }
        }
    }

    /// Unsubscribe from a table (DatabaseLiveSubscribable conformance).
    /// Removes all subscribers for the channel and sends unsubscribe.
    func unsubscribe(_ id: String) {
        let channel = normalizeDatabaseLiveChannel(id)
        queue.sync {
            subscriptions.removeValue(forKey: channel)
            channelFilters.removeValue(forKey: channel)
            channelOrFilters.removeValue(forKey: channel)
        }
        sendUnsubscribe(channel)
    }

    /// Subscribe to custom message types (presence, broadcast, etc.).
    func on(_ type: String, handler: @escaping (Any) -> Void) {
        queue.sync {
            if messageHandlers[type] == nil {
                messageHandlers[type] = []
            }
            messageHandlers[type]?.append(handler)
        }
    }

    /// Send raw message (requires authentication).
    func send(_ data: [String: Any]) async throws {
        guard isAuthenticated else {
            throw EdgeBaseError(statusCode: 0, message: "Not authenticated. Call connect() first.")
        }
        try await sendMessage(data)
    }

    // MARK: - Internal

    /// Send a JSON message through the WebSocket.
    func sendMessage(_ data: [String: Any]) async throws {
        guard isConnected, let ws = webSocketTask else {
            throw EdgeBaseError(statusCode: 0, message: "WebSocket not connected")
        }
        let jsonData = try JSONSerialization.data(withJSONObject: data)
        let message = URLSessionWebSocketTask.Message.string(String(data: jsonData, encoding: .utf8)!)
        try await ws.send(message)
    }

    // MARK: - Auth

    /// Authenticate via WebSocket message (not HTTP headers).
    ///
    /// Sends `{"type":"auth","token":"...","sdkVersion":"0.2.2"}` and waits for
    /// `auth_success` or `auth_refreshed` response from the server.
    ///
    /// On `auth_refreshed`: parses `revokedChannels`, removes them
    /// from subscriptions/channelFilters/channelOrFilters, then re-subscribes remaining.
    private func authenticate() async throws {
        guard let token = try await tokenManager.getAccessToken() else {
            let hasSession = await tokenManager.getRefreshToken() != nil
            let message = hasSession
                ? "DatabaseLive is waiting for an active access token."
                : "No access token available. Sign in first."
            throw EdgeBaseError(statusCode: 401, message: message)
        }

        // Send auth message (raw send — not through send() which requires isAuthenticated)
        let authMsg: [String: Any] = [
            "type": "auth",
            "token": token,
            "sdkVersion": "0.2.2"
        ]
        try await sendMessage(authMsg)

        // Wait for auth response by reading the next message directly
        // This blocks the receive loop from starting until auth completes
        guard let ws = webSocketTask else {
            throw EdgeBaseError(statusCode: 0, message: "WebSocket disconnected during auth")
        }

        let response = try await ws.receive()
        var json: [String: Any]?
        switch response {
        case .string(let text):
            if let data = text.data(using: .utf8) {
                json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            }
        case .data(let data):
            json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        @unknown default:
            break
        }

        guard let msg = json, let type = msg["type"] as? String else {
            throw EdgeBaseError(statusCode: 401, message: "Invalid auth response from server")
        }

        switch type {
        case "auth_success":
            isAuthenticated = true
            // Re-subscribe all tracked channels
            resubscribeAll()

        case "auth_refreshed":
            isAuthenticated = true
            //: Remove revoked channels before re-subscribing
            let revoked = msg["revokedChannels"] as? [String] ?? []
            if !revoked.isEmpty {
                handleRevokedChannels(revoked)
            }
            // Re-subscribe all remaining tracked channels
            resubscribeAll()

        case "error":
            let errorCode = msg["code"] as? String
            if errorCode == "NOT_AUTHENTICATED" {
                isAuthenticated = false
                Task { [weak self] in
                    try? await self?.authenticate()
                }
            }
            let errMsg = msg["message"] as? String ?? "Authentication failed"
            throw EdgeBaseError(statusCode: 401, message: errMsg)

        default:
            throw EdgeBaseError(statusCode: 401, message: "Unexpected auth response type: \(type)")
        }
    }

    // MARK: - Message Loop

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
                @unknown default:
                    break
                }
            } catch {
                isConnected = false
                isAuthenticated = false
                stopHeartbeat()
                if shouldReconnect && !waitingForAuth && reconnectAttempts < maxReconnectAttempts {
                    let baseDelay = min(reconnectBaseDelay * pow(2.0, Double(reconnectAttempts)), 30.0)
                    let jitter = Double.random(in: 0...(baseDelay * 0.25))
                    let delay = baseDelay + jitter
                    reconnectAttempts += 1
                    try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                    try? await connect()
                }
                return
            }
        }
    }

    private func handleMessage(_ json: [String: Any]) {
        let type = json["type"] as? String ?? ""

        switch type {
        case "db_change":
            let change = DbChange.fromJSON(json)
            let messageChannel = json["channel"] as? String
            queue.sync {
                for (channel, subscribers) in subscriptions where matchesDatabaseLiveChannel(channel, change: change, messageChannel: messageChannel) {
                    subscribers.forEach { $0.handler(change) }
                }
            }

        case "batch_changes":
            //: fan out batch changes to individual handlers
            guard let changes = json["changes"] as? [[String: Any]] else { return }
            let channelStr = json["channel"] as? String ?? ""
            let tableName = (json["table"] as? String) ?? channelTableName(channelStr)
            for c in changes {
                let change = DbChange(
                    type: c["event"] as? String ?? "UNKNOWN",
                    table: tableName,
                    id: c["docId"] as? String,
                    record: c["data"] as? [String: Any],
                    oldRecord: c["old_record"] as? [String: Any],
                    timestamp: c["timestamp"] as? String
                )
                queue.sync {
                    for (channel, subscribers) in subscriptions where matchesDatabaseLiveChannel(channel, change: change, messageChannel: channelStr) {
                        subscribers.forEach { $0.handler(change) }
                    }
                }
            }

        case "auth_refreshed":
            //: Server revoked channels after re-auth (mid-session refresh)
            let revoked = json["revokedChannels"] as? [String] ?? []
            if !revoked.isEmpty {
                handleRevokedChannels(revoked)
                // Dispatch subscription_revoked events so UI can react
                queue.sync {
                    if let handlers = messageHandlers["subscription_revoked"] {
                        for channel in revoked {
                            let event: [String: Any] = ["type": "subscription_revoked", "channel": channel]
                            handlers.forEach { $0(event) }
                        }
                    }
                }
            }

        case "FILTER_RESYNC":
            // Re-send all stored channel filters to server after DO hibernation
            resyncFilters()

        case "PRESENCE_RESYNC":
            // Dispatch to presence handlers
            queue.sync {
                messageHandlers["PRESENCE_RESYNC"]?.forEach { $0(json) }
            }

        case "error":
            queue.sync {
                messageHandlers["error"]?.forEach { $0(json) }
            }

        default:
            // Generic message type dispatch (presence_sync, presence_join, presence_leave, broadcast, etc.)
            queue.sync {
                messageHandlers[type]?.forEach { $0(json) }
            }
        }
    }

    // MARK: - Filter Recomputation

    /// Recompute channel-level filters from all active subscribers.
    /// Must be called inside queue.sync.
    private func recomputeChannelFilters(_ channel: String) {
        guard let subs = subscriptions[channel], !subs.isEmpty else {
            channelFilters.removeValue(forKey: channel)
            channelOrFilters.removeValue(forKey: channel)
            return
        }
        if let first = subs.first(where: { $0.filters != nil && !($0.filters!.isEmpty) }) {
            channelFilters[channel] = first.filters!
        } else {
            channelFilters.removeValue(forKey: channel)
        }
        if let first = subs.first(where: { $0.orFilters != nil && !($0.orFilters!.isEmpty) }) {
            channelOrFilters[channel] = first.orFilters!
        } else {
            channelOrFilters.removeValue(forKey: channel)
        }
    }

    // MARK: - Subscribe / Unsubscribe

    /// Send a subscribe message for a channel, including any stored filters.
    /// Only sends if authenticated.
    private func sendSubscribe(_ channel: String) {
        guard isAuthenticated else { return }
        var msg: [String: Any] = ["type": "subscribe", "channel": channel]
        queue.sync {
            if let filters = channelFilters[channel], !filters.isEmpty {
                msg["filters"] = filters
            }
            if let orFilters = channelOrFilters[channel], !orFilters.isEmpty {
                msg["orFilters"] = orFilters
            }
        }
        Task { [weak self] in
            try? await self?.sendMessage(msg)
        }
    }

    /// Send an unsubscribe message for a channel.
    private func sendUnsubscribe(_ channel: String) {
        guard isAuthenticated else { return }
        Task { [weak self] in
            try? await self?.sendMessage(["type": "unsubscribe", "channel": channel])
        }
    }

    /// Re-subscribe all tracked channels after (re-)authentication.
    /// Mirrors JS SDK `resubscribeAll()`.
    private func resubscribeAll() {
        let channels: [String] = queue.sync {
            Array(subscriptions.keys)
        }
        for channel in channels {
            sendSubscribe(channel)
        }
    }

    /// Re-send stored filters to server after FILTER_RESYNC.
    /// Mirrors JS SDK `resyncFilters()`.
    private func resyncFilters() {
        let filterEntries: [(String, [DatabaseLiveFilterTuple], [DatabaseLiveFilterTuple])] = queue.sync {
            channelFilters.map { channel, filters in
                let orFilters = channelOrFilters[channel] ?? []
                return (channel, filters, orFilters)
            }
        }
        for (channel, filters, orFilters) in filterEntries {
            guard !filters.isEmpty || !orFilters.isEmpty else { continue }
            var msg: [String: Any] = ["type": "subscribe", "channel": channel]
            if !filters.isEmpty { msg["filters"] = filters }
            if !orFilters.isEmpty { msg["orFilters"] = orFilters }
            Task { [weak self] in
                try? await self?.sendMessage(msg)
            }
        }
    }

    // MARK: - Revocation

    /// Handle revoked channels from `auth_refreshed` response.
    /// Removes subscriptions, filters, and OR filters for revoked channels.
    private func handleRevokedChannels(_ revokedChannels: [String]) {
        queue.sync {
            for channel in revokedChannels {
                let normalized = normalizeDatabaseLiveChannel(channel)
                subscriptions.removeValue(forKey: normalized)
                channelFilters.removeValue(forKey: normalized)
                channelOrFilters.removeValue(forKey: normalized)
            }
        }
    }

    private func refreshAuth() {
        Task { [weak self] in
            guard let self else { return }
            guard let token = try await self.tokenManager.getAccessToken() else { return }
            try? await self.sendMessage([
                "type": "auth",
                "token": token,
                "sdkVersion": "0.2.2",
            ])
        }
    }

    private func handleAuthStateChange(_ user: [String: Any]?) {
        if user != nil {
            if isConnected && isAuthenticated {
                refreshAuth()
                return
            }

            waitingForAuth = false
            let firstChannel = queue.sync { subscriptions.keys.first }
            if let firstChannel, !isConnected {
                reconnectAttempts = 0
                Task { try? await self.connect(channel: firstChannel) }
            }
            return
        }

        waitingForAuth = queue.sync { !subscriptions.isEmpty }
        isConnected = false
        isAuthenticated = false
        stopHeartbeat()
        webSocketTask?.cancel(with: .normalClosure, reason: "Signed out".data(using: .utf8))
        webSocketTask = nil
    }

    private func handleAuthenticationFailure(_ error: Error) {
        let statusCode = (error as? EdgeBaseError)?.statusCode
        waitingForAuth = statusCode == 401 && queue.sync { !subscriptions.isEmpty }
        isConnected = false
        isAuthenticated = false
        stopHeartbeat()
        webSocketTask?.cancel(with: .policyViolation, reason: error.localizedDescription.data(using: .utf8))
        webSocketTask = nil
    }

    // MARK: - Heartbeat

    private func startHeartbeat() {
        stopHeartbeat()
        DispatchQueue.main.async { [weak self] in
            self?.heartbeatTimer = Timer.scheduledTimer(withTimeInterval: 30.0, repeats: true) { [weak self] _ in
                guard let self = self, self.isConnected else { return }
                Task {
                    try? await self.sendMessage(["type": "ping"])
                }
            }
        }
    }

    private func stopHeartbeat() {
        heartbeatTimer?.invalidate()
        heartbeatTimer = nil
    }

    // MARK: - Destroy

    /// Destroy — clean up all resources.
    func destroy() {
        disconnect()
        queue.sync {
            subscriptions.removeAll()
            messageHandlers.removeAll()
            channelFilters.removeAll()
            channelOrFilters.removeAll()
        }
    }
}
