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
        let id = json["id"] as? String
        return DbChange(
            type: json["type"] as? String ?? "UNKNOWN",
            table: json["table"] as? String ?? "",
            id: id,
            record: json["record"] as? [String: Any],
            oldRecord: json["old_record"] as? [String: Any],
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
    func getRefreshToken() async -> String?
    func clearTokens() async
}

/// Type alias for backward compatibility with existing Core code.
public typealias TokenManager = any TokenManageable
