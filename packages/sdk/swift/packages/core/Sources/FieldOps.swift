// Field Operations — atomic field helpers.
//
// Mirrors JS SDK field-ops.ts — uses $op key for server op-parser.ts.
// - increment(n) for atomic counter increments
// - deleteField() for field removal

import Foundation

/// Increment marker for atomic field operations.
/// Usage: `doc.update(["views": FieldOps.increment(1)])`
public enum FieldOps {
    /// Create an increment marker.
    /// Server interprets this as an atomic increment.
    public static func increment(_ value: Double = 1) -> [String: Any] {
        return ["$op": "increment", "value": value]
    }

    /// Create an integer increment marker.
    public static func increment(_ value: Int) -> [String: Any] {
        return ["$op": "increment", "value": value]
    }

    /// Create a delete-field marker.
    /// Server interprets this as field removal.
    public static func deleteField() -> [String: Any] {
        return ["$op": "deleteField"]
    }
}
