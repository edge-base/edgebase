//! Atomic field operation helpers.
//!
//! ```rust,no_run,ignore,no_run
//! use edgebase_core::field_ops;
//! use serde_json::json;
//!
//! # async fn example(client: &edgebase_core::EdgeBase) -> Result<(), edgebase_core::Error> {
//! client.table("posts").update("id1", &json!({
//!     "views": field_ops::increment(1),
//!     "temp":  field_ops::delete_field(),
//! })).await?;
//! # Ok(())
//! # }
//! ```

use serde_json::{json, Value};

/// A field operation marker value (e.g. increment, deleteField).
/// Returned by [`increment`] and [`delete_field`]; passed in update bodies.
/// Named type to allow `pub use field_ops::FieldOps` in lib.rs.
pub type FieldOps = Value;

/// Increment a numeric field atomically.
/// Server interprets as: `field = COALESCE(field, 0) + n`.
pub fn increment(n: impl Into<f64>) -> Value {
    json!({ "$op": "increment", "value": n.into() })
}

/// Delete a field (set to NULL).
/// Server interprets as: `field = NULL`.
pub fn delete_field() -> Value {
    json!({ "$op": "deleteField" })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn increment_returns_correct_marker() {
        let marker = increment(1);
        assert_eq!(marker["$op"], "increment");
        assert_eq!(marker["value"], 1.0);
    }

    #[test]
    fn increment_negative() {
        let marker = increment(-5);
        assert_eq!(marker["value"], -5.0);
    }

    #[test]
    fn increment_float() {
        let marker = increment(1.5);
        assert_eq!(marker["value"], 1.5);
    }

    #[test]
    fn delete_field_returns_correct_marker() {
        let marker = delete_field();
        assert_eq!(marker["$op"], "deleteField");
        assert!(marker.get("value").is_none());
    }
}
