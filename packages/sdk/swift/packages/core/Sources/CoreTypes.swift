// CoreTypes.swift — Protocol stubs for types defined in EdgeBase (Client) module.
// These allow EdgeBaseCore to compile independently.

import Foundation

/// Database change event from a database-live subscription.
///
/// Payload dictionaries are JSON-derived and manually bridged from Foundation,
/// so sendability is guaranteed by the decoding boundary rather than the type system.
public struct DbChange: @unchecked Sendable {
    public let type: String
    public let table: String
    public let id: String?
    public let record: [String: Any]?
    public let oldRecord: [String: Any]?
    public let timestamp: String?

    public init(type: String, table: String, id: String? = nil,
                record: [String: Any]? = nil, oldRecord: [String: Any]? = nil,
                timestamp: String? = nil) {
        self.type = type
        self.table = table
        self.id = id
        self.record = record
        self.oldRecord = oldRecord
        self.timestamp = timestamp
    }

    public static func fromJSON(_ json: [String: Any]) -> DbChange {
        // Database Live's WebSocket envelope uses changeType/docId/data, while
        // callers may also decode the normalized type/id/record representation.
        let id = (json["docId"] as? String) ?? (json["id"] as? String)
        return DbChange(
            type: (json["changeType"] as? String) ?? (json["type"] as? String) ?? "UNKNOWN",
            table: json["table"] as? String ?? "",
            id: id,
            record: (json["data"] as? [String: Any]) ?? (json["record"] as? [String: Any]),
            oldRecord: (json["oldRecord"] as? [String: Any]) ?? (json["old_record"] as? [String: Any]),
            timestamp: json["timestamp"] as? String
        )
    }
}

/// Minimal protocol for database-live subscriptions.
public protocol DatabaseLiveSubscribable: AnyObject, Sendable {
    func subscribe(_ tableName: String) -> AsyncStream<DbChange>
    func unsubscribe(_ id: String)
}

/// Type alias for backward compatibility with existing Core code.
public typealias DatabaseLiveClient = any DatabaseLiveSubscribable

/// Minimal protocol for token management.
public protocol TokenManageable: Sendable {
    func getAccessToken() async throws -> String?
    /// Get a valid access token. When `forceRefresh` is true, bypass the local
    /// expiry short-circuit and refresh unconditionally (used on a server 401 so a
    /// retry does not re-send a token the server has already rejected).
    func getAccessToken(forceRefresh: Bool) async throws -> String?
    func getRefreshToken() async -> String?
    func clearTokens() async throws
}

public extension TokenManageable {
    /// Default: fall back to the cached-token path. Conformers that support refresh
    /// (e.g. the client TokenManager) override this to actually force a refresh.
    func getAccessToken(forceRefresh: Bool) async throws -> String? {
        try await getAccessToken()
    }
}

/// Type alias for backward compatibility with existing Core code.
public typealias TokenManager = any TokenManageable
