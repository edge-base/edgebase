import EdgeBaseCore
// Token Manager — JWT token management with auto-refresh.
//
// Mirrors Dart SDK TokenManager with Swift idioms:
// - Keychain persistence via protocol (DI)
// - 30-second buffer preemptive refresh
// - Actor for thread-safe concurrent refresh deduplication

import Foundation

// MARK: - Token Storage Protocol (DI —)

/// Protocol for persistent token storage.
/// Default implementation uses Keychain. Override for testing.
public protocol TokenStorage: Sendable {
    func getTokens() async throws -> TokenPair?
    func saveTokens(_ tokens: TokenPair) async throws
    func clearTokens() async throws
}

/// Storage that survives process restart and reports failed writes.
public protocol DurableTokenStorage: TokenStorage {}

/// Token pair (access + refresh).
public struct TokenPair: Codable, Sendable {
    public let accessToken: String
    public let refreshToken: String

    public init(accessToken: String, refreshToken: String) {
        self.accessToken = accessToken
        self.refreshToken = refreshToken
    }
}

/// Callback type for refreshing tokens.
public typealias RefreshTokenCallback = @Sendable (String) async throws -> TokenPair

// MARK: - In-Memory Token Storage (for testing)

/// Simple in-memory token storage for testing.
public actor MemoryTokenStorage: TokenStorage {
    private var tokens: TokenPair?

    public init() {}

    public func getTokens() async -> TokenPair? { tokens }
    public func saveTokens(_ tokens: TokenPair) async { self.tokens = tokens }
    public func clearTokens() async { tokens = nil }
}

// MARK: - Keychain Token Storage

/// Keychain-based persistent token storage.
public final class KeychainTokenStorage: DurableTokenStorage, @unchecked Sendable {
    private let service: String
    private let accessGroup: String?
    private let queue = DispatchQueue(label: "com.edgebase.keychain")

    public init(service: String = "com.edgebase.tokens", accessGroup: String? = nil) {
        self.service = service
        self.accessGroup = accessGroup
    }

    public func getTokens() async throws -> TokenPair? {
        try queue.sync {
            var query = baseQuery()
            query[kSecReturnData as String] = true
            query[kSecMatchLimit as String] = kSecMatchLimitOne

            var result: AnyObject?
            let status = SecItemCopyMatching(query as CFDictionary, &result)
            if status == errSecItemNotFound { return nil }
            guard status == errSecSuccess else {
                throw KeychainTokenStorageError(operation: "read", status: status)
            }
            guard let data = result as? Data else {
                throw KeychainTokenStorageError(operation: "read-invalid-data", status: status)
            }
            do {
                return try JSONDecoder().decode(TokenPair.self, from: data)
            } catch {
                throw KeychainTokenStorageError(operation: "decode", status: errSecDecode)
            }
        }
    }

    public func saveTokens(_ tokens: TokenPair) async throws {
        try queue.sync {
            let data: Data
            do {
                data = try JSONEncoder().encode(tokens)
            } catch {
                throw KeychainTokenStorageError(operation: "encode", status: errSecParam)
            }

            let query = baseQuery()

            // Try update first, then add
            let updateAttrs: [String: Any] = [kSecValueData as String: data]
            let updateStatus = SecItemUpdate(query as CFDictionary, updateAttrs as CFDictionary)

            if updateStatus == errSecItemNotFound {
                var addQuery = query
                addQuery[kSecValueData as String] = data
                addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
                let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
                guard addStatus == errSecSuccess else {
                    throw KeychainTokenStorageError(operation: "add", status: addStatus)
                }
            } else if updateStatus != errSecSuccess {
                throw KeychainTokenStorageError(operation: "update", status: updateStatus)
            }
        }
    }

    public func clearTokens() async throws {
        try queue.sync {
            let query = baseQuery()
            let status = SecItemDelete(query as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else {
                throw KeychainTokenStorageError(operation: "delete", status: status)
            }
        }
    }

    private func baseQuery() -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "tokens",
        ]
        if let group = accessGroup {
            query[kSecAttrAccessGroup as String] = group
        }
        return query
    }
}

public struct KeychainTokenStorageError: Error, LocalizedError, Sendable, Equatable {
    public let operation: String
    public let status: OSStatus

    public var errorDescription: String? {
        "Apple Keychain \(operation) failed (OSStatus \(status))."
    }
}

public struct InvalidTokenPairError: Error, LocalizedError, Sendable, Equatable {
    public let operation: String
    public var errorDescription: String? {
        "EdgeBase token pair is incomplete during \(operation)."
    }
}

public struct DurableTokenStorageRequiredError: Error, LocalizedError, Sendable, Equatable {
    public init() {}
    public var errorDescription: String? {
        "Anonymous account upgrades require DurableTokenStorage so replacement tokens survive response loss or process termination."
    }
}

public struct TokenPersistenceError: Error, LocalizedError, Sendable, Equatable {
    public let operation: String
    public let causeDescription: String

    public init(operation: String, cause: Error) {
        self.operation = operation
        self.causeDescription = String(describing: cause)
    }

    public var errorDescription: String? {
        "Token persistence \(operation) failed before token adoption: \(causeDescription)"
    }
}

// MARK: - Token Manager

/// Manages access/refresh tokens with auto-refresh.
public actor TokenManager: TokenManageable {
    private let storage: TokenStorage
    private var currentTokens: TokenPair?
    private var refreshCallback: RefreshTokenCallback?
    private var refreshTask: Task<TokenPair, Error>?
    /// Bumped on every logout (clearTokens). An in-flight refresh compares the
    /// generation it started with against the current one; if they differ, a logout
    /// happened mid-refresh and the refreshed tokens must NOT resurrect the session.
    private var sessionGeneration = 0

    // Auth state change stream
    private var authStateHandlers: [(([String: Any]?) -> Void)] = []

    public init(storage: TokenStorage) {
        self.storage = storage
    }

    /// Set the refresh callback.
    public func setRefreshCallback(_ callback: @escaping RefreshTokenCallback) {
        self.refreshCallback = callback
    }

    /// Set tokens after login.
    public func setTokens(_ tokens: TokenPair) async throws {
        guard !tokens.accessToken.isEmpty, !tokens.refreshToken.isEmpty else {
            throw InvalidTokenPairError(operation: "save")
        }
        do {
            try await storage.saveTokens(tokens)
        } catch {
            throw TokenPersistenceError(operation: "save", cause: error)
        }
        currentTokens = tokens
        let user = decodeJWTPayload(tokens.accessToken)
        notifyAuthStateChange(user)
    }

    /// Clear tokens (logout).
    ///
    /// Cancels any in-flight refresh and bumps the session generation so a refresh
    /// that is already awaiting the network cannot re-persist tokens or emit a
    /// signed-in event after logout.
    public func clearTokens() async throws {
        sessionGeneration &+= 1
        refreshTask?.cancel()
        refreshTask = nil
        do {
            try await storage.clearTokens()
        } catch {
            throw TokenPersistenceError(operation: "clear", cause: error)
        }
        currentTokens = nil
        notifyAuthStateChange(nil)
    }

    /// Try to restore session from storage.
    /// Notifies auth state listeners on success (matches JS SDK auto-restore behavior).
    public func tryRestoreSession() async throws -> Bool {
        let stored: TokenPair?
        do {
            stored = try await storage.getTokens()
        } catch {
            throw TokenPersistenceError(operation: "load", cause: error)
        }
        if let tokens = stored {
            guard !tokens.accessToken.isEmpty, !tokens.refreshToken.isEmpty else {
                throw InvalidTokenPairError(operation: "restore")
            }
            currentTokens = tokens
            let user = decodeJWTPayload(tokens.accessToken)
            notifyAuthStateChange(user)
            return true
        }
        return false
    }

    /// Fail closed before an operation that can revoke the initiating session.
    public func requireDurableStorageForAccountUpgrade() throws {
        if storage is any DurableTokenStorage { return }
        if currentUser()?["isAnonymous"] as? Bool == false { return }
        throw DurableTokenStorageRequiredError()
    }

    /// Get valid access token, refreshing if needed.
    /// Includes 30-second buffer for preemptive refresh.

    /// Get current refresh token.
    public func getRefreshToken() -> String? {
        return currentTokens?.refreshToken
    }

    /// Get current user from cached access token (decoded JWT payload).
    public func currentUser() -> [String: Any]? {
        guard let token = currentTokens?.accessToken else { return nil }
        return decodeJWTPayload(token)
    }
    public func getAccessToken() async throws -> String? {
        return try await getAccessToken(forceRefresh: false)
    }

    /// Get valid access token, refreshing if needed.
    /// When `forceRefresh` is true, skip the local-expiry short-circuit and refresh
    /// unconditionally (used on a server 401 so the retry uses a freshly minted token
    /// instead of re-sending one the server already rejected).
    public func getAccessToken(forceRefresh: Bool) async throws -> String? {
        guard let tokens = currentTokens else { return nil }

        // Check if token is expired or will expire within 30s
        if !forceRefresh && !isTokenExpired(tokens.accessToken) {
            return tokens.accessToken
        }

        // Deduplicate concurrent refresh requests
        if let existingTask = refreshTask {
            let newTokens = try await existingTask.value
            return newTokens.accessToken
        }

        guard let refreshCb = refreshCallback else {
            return tokens.accessToken
        }

        let generation = sessionGeneration
        let refreshToken = tokens.refreshToken
        let task = Task<TokenPair, Error> { [weak self] in
            guard let self else {
                throw EdgeBaseError(statusCode: 401, message: "Token manager was released during refresh.")
            }
            let newTokens = try await refreshCb(refreshToken)
            // If a logout happened while we were awaiting the network, do NOT
            // resurrect the session by persisting tokens or firing signed-in events.
            let committed = try await self.commitRefreshedTokens(newTokens, generation: generation)
            guard committed else {
                throw EdgeBaseError(statusCode: 401, message: "Session was cleared during token refresh.")
            }
            return newTokens
        }
        refreshTask = task

        defer { refreshTask = nil }
        do {
            let newTokens = try await task.value
            return newTokens.accessToken
        } catch {
            try await handleRefreshFailure(error, generation: generation)
            throw error
        }
    }

    /// Persist refreshed tokens and emit a signed-in event, unless a logout has
    /// occurred since the refresh started. Returns false when the refresh is stale.
    private func commitRefreshedTokens(_ newTokens: TokenPair, generation: Int) async throws -> Bool {
        guard generation == sessionGeneration else { return false }
        guard !newTokens.accessToken.isEmpty, !newTokens.refreshToken.isEmpty else {
            throw InvalidTokenPairError(operation: "refresh")
        }
        do {
            try await storage.saveTokens(newTokens)
        } catch {
            throw TokenPersistenceError(operation: "save", cause: error)
        }
        guard generation == sessionGeneration else { return false }
        currentTokens = newTokens
        notifyAuthStateChange(decodeJWTPayload(newTokens.accessToken))
        return true
    }

    /// On a refresh failure with 401, clear the session (token revoked/expired),
    /// matching the JS reference. Other errors (network, 5xx) keep the session for
    /// retry. Skipped if a logout already advanced the generation.
    private func handleRefreshFailure(_ error: Error, generation: Int) async throws {
        guard (error as? EdgeBaseError)?.statusCode == 401 else { return }
        guard generation == sessionGeneration else { return }
        try await clearTokens()
    }

    /// Check if token is expired (with 30s buffer).
    public func isTokenExpired(_ token: String) -> Bool {
        guard let payload = decodeJWTPayload(token),
              let exp = payload["exp"] as? TimeInterval else {
            return true
        }
        // 30-second buffer for preemptive refresh
        return Date().timeIntervalSince1970 >= (exp - 30)
    }

    /// Register auth state change handler.
    /// If there is an active session, fires immediately with the current user
    /// (matches JS SDK behavior). Nil is not emitted on registration since it's
    /// the default state and would race with async Task-based callers like RoomClient.
    public func onAuthStateChange(_ handler: @escaping ([String: Any]?) -> Void) {
        authStateHandlers.append(handler)
        if let user = currentUser() {
            handler(user)
        }
    }

    /// Notify all auth state change handlers.
    private func notifyAuthStateChange(_ user: [String: Any]?) {
        for handler in authStateHandlers {
            handler(user)
        }
    }

    /// Decode JWT payload (base64url → JSON).
    private func decodeJWTPayload(_ token: String) -> [String: Any]? {
        let parts = token.split(separator: ".")
        guard parts.count >= 2 else { return nil }

        var base64 = String(parts[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")

        // Pad to multiple of 4
        while base64.count % 4 != 0 { base64.append("=") }

        guard let data = Data(base64Encoded: base64),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        var normalized = json
        if normalized["id"] == nil {
            normalized["id"] = normalized["sub"] ?? normalized["userId"]
        }
        if normalized["customClaims"] == nil, let custom = normalized["custom"] as? [String: Any] {
            normalized["customClaims"] = custom
        }
        return normalized
    }

    /// Destroy — clean up handlers.
    public func destroy() {
        authStateHandlers.removeAll()
        refreshTask?.cancel()
        refreshTask = nil
    }
}

// MARK: - External Token Manager (closure-based, for roomWithToken)

/// A TokenManageable that delegates token retrieval to a closure.
/// Used by EdgeBaseClient.roomWithToken to accept an external token provider.
public actor ExternalTokenManager: TokenManageable {
    private let provider: @Sendable () -> String

    public init(tokenProvider: @escaping @Sendable () -> String) {
        self.provider = tokenProvider
    }

    public func getAccessToken() async throws -> String? {
        let token = provider()
        return token.isEmpty ? nil : token
    }

    public func getRefreshToken() async -> String? { nil }
    public func clearTokens() async {}
}
