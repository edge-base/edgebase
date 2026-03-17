// EdgeBase Errors
// Mirrors JS/Dart SDK error types.

import Foundation

/// Base error type for EdgeBase operations.
public struct EdgeBaseError: Error, LocalizedError, Sendable {
    public let statusCode: Int
    public let message: String
    public let details: [String: [String]]?

    public init(statusCode: Int, message: String, details: [String: [String]]? = nil) {
        self.statusCode = statusCode
        self.message = message
        self.details = details
    }

    public var errorDescription: String? {
        var desc = "EdgeBaseError [\(statusCode)]: \(message)"
        if let details = details, !details.isEmpty {
            let fieldErrors = details.map { "\($0.key): \($0.value.joined(separator: ", "))" }
            desc += " (\(fieldErrors.joined(separator: "; ")))"
        }
        return desc
    }

    /// Parse error from JSON response.
    public static func fromJSON(_ data: Data, statusCode: Int) -> EdgeBaseError {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return EdgeBaseError(statusCode: statusCode, message: "Unknown error")
        }

        let message = json["message"] as? String ?? json["error"] as? String ?? "Unknown error"

        var details: [String: [String]]? = nil
        if let fieldErrors = json["details"] as? [String: Any] {
            var parsed: [String: [String]] = [:]
            for (key, value) in fieldErrors {
                if let arr = value as? [String] {
                    parsed[key] = arr
                } else if let str = value as? String {
                    parsed[key] = [str]
                }
            }
            if !parsed.isEmpty { details = parsed }
        }

        return EdgeBaseError(statusCode: statusCode, message: message, details: details)
    }
}

/// Authentication-specific error.
public struct EdgeBaseAuthError: Error, LocalizedError, Sendable {
    public let statusCode: Int
    public let message: String

    public init(statusCode: Int, message: String) {
        self.statusCode = statusCode
        self.message = message
    }

    public var errorDescription: String? {
        "EdgeBaseAuthError [\(statusCode)]: \(message)"
    }
}
