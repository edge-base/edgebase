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
    func getTokens() async -> TokenPair?
    func saveTokens(_ tokens: TokenPair) async
    func clearTokens() async
}

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
public final class KeychainTokenStorage: TokenStorage, @unchecked Sendable {
    private let service: String
    private let accessGroup: String?
    private let queue = DispatchQueue(label: "com.edgebase.keychain")

    public init(service: String = "com.edgebase.tokens", accessGroup: String? = nil) {
        self.service = service
        self.accessGroup = accessGroup
    }

    public func getTokens() async -> TokenPair? {
        queue.sync {
            var query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: "tokens",
                kSecReturnData as String: true,
                kSecMatchLimit as String: kSecMatchLimitOne,
            ]
            if let group = accessGroup {
                query[kSecAttrAccessGroup as String] = group
            }

            var result: AnyObject?
            let status = SecItemCopyMatching(query as CFDictionary, &result)
            guard status == errSecSuccess, let data = result as? Data else { return nil }
            return try? JSONDecoder().decode(TokenPair.self, from: data)
        }
    }

    public func saveTokens(_ tokens: TokenPair) async {
        queue.sync {
            guard let data = try? JSONEncoder().encode(tokens) else { return }

            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: "tokens",
            ]

            // Try update first, then add
            let updateAttrs: [String: Any] = [kSecValueData as String: data]
            let updateStatus = SecItemUpdate(query as CFDictionary, updateAttrs as CFDictionary)

            if updateStatus == errSecItemNotFound {
                var addQuery = query
                addQuery[kSecValueData as String] = data
                addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
                SecItemAdd(addQuery as CFDictionary, nil)
            }
        }
    }

    public func clearTokens() async {
        queue.sync {
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: service,
                kSecAttrAccount as String: "tokens",
            ]
            SecItemDelete(query as CFDictionary)
        }
    }
}

// MARK: - Token Manager

/// Manages access/refresh tokens with auto-refresh.
public actor TokenManager: TokenManageable {
    private let storage: TokenStorage
    private var currentTokens: TokenPair?
    private var refreshCallback: RefreshTokenCallback?
    private var refreshTask: Task<TokenPair, Error>?

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
    public func setTokens(_ tokens: TokenPair) async {
        currentTokens = tokens
        await storage.saveTokens(tokens)
        let user = decodeJWTPayload(tokens.accessToken)
        notifyAuthStateChange(user)
    }

    /// Clear tokens (logout).
    public func clearTokens() async {
        currentTokens = nil
        refreshTask = nil
        await storage.clearTokens()
        notifyAuthStateChange(nil)
    }

    /// Try to restore session from storage.
    public func tryRestoreSession() async -> Bool {
        if let tokens = await storage.getTokens() {
            currentTokens = tokens
            return true
        }
        return false
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
        guard let tokens = currentTokens else { return nil }

        // Check if token is expired or will expire within 30s
        if !isTokenExpired(tokens.accessToken) {
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

        let task = Task<TokenPair, Error> {
            let newTokens = try await refreshCb(tokens.refreshToken)
            await setTokens(newTokens)
            return newTokens
        }
        refreshTask = task

        defer { refreshTask = nil }
        let newTokens = try await task.value
        return newTokens.accessToken
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
    public func onAuthStateChange(_ handler: @escaping ([String: Any]?) -> Void) {
        authStateHandlers.append(handler)
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
