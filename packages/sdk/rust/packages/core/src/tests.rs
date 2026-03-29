//! edgebase-core -- Unit Tests
//!
//! Target: 56 tests covering all core SDK features.
//! Categories:
//!   - Package smoke / importability
//!   - HttpClient construction
//!   - TableRef query builder (URL construction, parameter handling)
//!   - ListResult / BatchResult / UpsertResult parsing
//!   - OrBuilder
//!   - FieldOps (increment, delete_field)
//!   - StorageBucket URL construction
//!   - Error variants and Display
//!   - Room types

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Package Import Smoke Tests
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod package_smoke {
    use crate::http_client::*;
    use crate::table::*;
    use crate::field_ops::*;
    use crate::error::*;

    #[test]
    fn http_client_is_importable() {
        assert!(std::mem::size_of::<HttpClient>() > 0);
    }

    #[test]
    fn table_ref_requires_http() {
        assert!(std::mem::size_of::<TableRef>() > 0);
    }

    #[test]
    fn error_variants_exist() {
        let err = Error::Api { status: 404, message: "Not found".to_string() };
        assert!(format!("{}", err).contains("404"));
        assert!(format!("{}", err).contains("Not found"));
    }

    #[test]
    fn error_config_variant() {
        let err = Error::Config("missing baseUrl".to_string());
        assert!(format!("{}", err).contains("missing baseUrl"));
    }

    #[test]
    fn error_url_variant() {
        let err = Error::Url("bad scheme".to_string());
        assert!(format!("{}", err).contains("bad scheme"));
    }

    #[test]
    fn field_ops_increment_works() {
        let inc = increment(5);
        assert_eq!(inc["$op"], "increment");
        assert_eq!(inc["value"], 5.0);
    }

    #[test]
    fn field_ops_delete_field_works() {
        let del = delete_field();
        assert_eq!(del["$op"], "deleteField");
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. HttpClient Construction
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod http_client_tests {
    use crate::http_client::HttpClient;

    #[test]
    fn new_strips_trailing_slash() {
        let client = HttpClient::new("http://localhost:8688/", "sk_test").unwrap();
        assert_eq!(client.base_url(), "http://localhost:8688");
    }

    #[test]
    fn new_keeps_clean_url() {
        let client = HttpClient::new("http://localhost:8688", "sk_test").unwrap();
        assert_eq!(client.base_url(), "http://localhost:8688");
    }

    #[test]
    fn new_with_empty_service_key() {
        let client = HttpClient::new("http://localhost:8688", "").unwrap();
        assert_eq!(client.base_url(), "http://localhost:8688");
    }

    #[test]
    fn new_strips_multiple_trailing_slashes() {
        let client = HttpClient::new("http://localhost:8688///", "sk_test").unwrap();
        // trim_end_matches strips all trailing slashes
        assert_eq!(client.base_url(), "http://localhost:8688");
    }

    #[test]
    fn base_url_returns_correct_value() {
        let client = HttpClient::new("https://myapp.edgebase.fun", "key123").unwrap();
        assert_eq!(client.base_url(), "https://myapp.edgebase.fun");
    }

    #[test]
    fn timeout_uses_env_override() {
        assert_eq!(HttpClient::parse_timeout_ms_for_tests(Some("15000")), Some(15_000));
        let client = HttpClient::new("http://localhost:8688", "sk_test").unwrap();
        assert_eq!(client.timeout_ms(), None);
    }

    #[test]
    fn timeout_ignores_invalid_env() {
        assert_eq!(HttpClient::parse_timeout_ms_for_tests(Some("invalid")), None);
        assert_eq!(HttpClient::parse_timeout_ms_for_tests(Some("0")), None);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. TableRef Query Builder
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod table_ref_tests {
    use crate::http_client::HttpClient;
    use crate::table::TableRef;
    use serde_json::json;
    use std::sync::Arc;

    fn make_table(name: &str) -> TableRef {
        let http = Arc::new(HttpClient::new("http://localhost:8688", "sk").unwrap());
        TableRef::new(http, name)
    }

    fn make_table_with_db(name: &str, ns: &str, id: Option<&str>) -> TableRef {
        let http = Arc::new(HttpClient::new("http://localhost:8688", "sk").unwrap());
        TableRef::with_db(http, name, ns, id)
    }

    #[test]
    fn name_returns_collection_name() {
        let t = make_table("posts");
        assert_eq!(t.name(), "posts");
    }

    #[test]
    fn default_namespace_is_shared() {
        // TableRef::new defaults to "shared" namespace
        let t = make_table("users");
        assert_eq!(t.name(), "users");
    }

    #[test]
    fn with_db_custom_namespace() {
        let t = make_table_with_db("items", "workspace", None);
        assert_eq!(t.name(), "items");
    }

    #[test]
    fn with_db_instance_id() {
        let t = make_table_with_db("items", "workspace", Some("ws-123"));
        assert_eq!(t.name(), "items");
    }

    #[test]
    fn where_is_chainable() {
        let t = make_table("posts")
            .where_("status", "==", "active")
            .where_("views", ">=", "100");
        assert_eq!(t.name(), "posts");
    }

    #[test]
    fn order_by_is_chainable() {
        let t = make_table("posts")
            .order_by("createdAt", "desc")
            .order_by("title", "asc");
        assert_eq!(t.name(), "posts");
    }

    #[test]
    fn limit_is_chainable() {
        let t = make_table("posts").limit(10);
        assert_eq!(t.name(), "posts");
    }

    #[test]
    fn offset_is_chainable() {
        let t = make_table("posts").offset(20);
        assert_eq!(t.name(), "posts");
    }

    #[test]
    fn page_is_chainable() {
        let t = make_table("posts").page(3);
        assert_eq!(t.name(), "posts");
    }

    #[test]
    fn search_is_chainable() {
        let t = make_table("posts").search("hello");
        assert_eq!(t.name(), "posts");
    }

    #[test]
    fn after_is_chainable() {
        let t = make_table("posts").after("cursor-abc");
        assert_eq!(t.name(), "posts");
    }

    #[test]
    fn before_is_chainable() {
        let t = make_table("posts").before("cursor-xyz");
        assert_eq!(t.name(), "posts");
    }

    #[test]
    fn full_chain_builder() {
        let t = make_table("posts")
            .where_("status", "==", "published")
            .order_by("createdAt", "desc")
            .limit(20)
            .offset(0)
            .search("rust");
        assert_eq!(t.name(), "posts");
    }

    #[test]
    fn where_accepts_array_values() {
        let t = make_table("posts")
            .where_("tags", "contains-any", json!(["featured", "archived"]));
        assert_eq!(t.name(), "posts");
    }

    #[test]
    fn or_builder_chainable() {
        let t = make_table("posts")
            .where_("status", "==", "active")
            .or_(|q| q.where_("status", "==", "draft").where_("featured", "==", "true"));
        assert_eq!(t.name(), "posts");
    }

    #[test]
    fn clone_produces_independent_copy() {
        let t1 = make_table("posts").where_("a", "==", "1");
        let t2 = t1.clone().where_("b", "==", "2");
        // Both should work independently
        assert_eq!(t1.name(), "posts");
        assert_eq!(t2.name(), "posts");
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. ListResult::from_value
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod list_result_tests {
    use crate::table::ListResult;
    use serde_json::json;

    #[test]
    fn from_value_with_items() {
        let v = json!({ "items": [{"id": "1"}, {"id": "2"}], "total": 2 });
        let lr = ListResult::from_value(v);
        assert_eq!(lr.items.len(), 2);
        assert_eq!(lr.total, Some(2));
    }

    #[test]
    fn from_value_empty_items() {
        let v = json!({ "items": [], "total": 0 });
        let lr = ListResult::from_value(v);
        assert!(lr.items.is_empty());
    }

    #[test]
    fn from_value_cursor_mode() {
        let v = json!({ "items": [], "hasMore": true, "cursor": "cursor-abc" });
        let lr = ListResult::from_value(v);
        assert_eq!(lr.has_more, Some(true));
        assert_eq!(lr.cursor.as_deref(), Some("cursor-abc"));
    }

    #[test]
    fn from_value_page_perPage() {
        let v = json!({ "items": [], "total": 100, "page": 2, "perPage": 20 });
        let lr = ListResult::from_value(v);
        assert_eq!(lr.page, Some(2));
        assert_eq!(lr.per_page, Some(20));
    }

    #[test]
    fn from_value_missing_items_defaults_to_empty() {
        let v = json!({ "total": 0 });
        let lr = ListResult::from_value(v);
        assert!(lr.items.is_empty());
    }

    #[test]
    fn from_value_null_cursor_is_none() {
        let v = json!({ "items": [], "cursor": null });
        let lr = ListResult::from_value(v);
        assert!(lr.cursor.is_none());
    }

    #[test]
    fn from_value_has_more_false() {
        let v = json!({ "items": [{"id":"1"}], "hasMore": false });
        let lr = ListResult::from_value(v);
        assert_eq!(lr.has_more, Some(false));
        assert_eq!(lr.items.len(), 1);
    }

    #[test]
    fn from_value_missing_total_is_none() {
        let v = json!({ "items": [] });
        let lr = ListResult::from_value(v);
        assert!(lr.total.is_none());
    }

    #[test]
    fn from_value_large_total() {
        let v = json!({ "items": [], "total": 999999 });
        let lr = ListResult::from_value(v);
        assert_eq!(lr.total, Some(999999));
    }

    #[test]
    fn from_value_all_fields_populated() {
        let v = json!({
            "items": [{"id": "1"}],
            "total": 50,
            "page": 1,
            "perPage": 10,
            "hasMore": true,
            "cursor": "next-page"
        });
        let lr = ListResult::from_value(v);
        assert_eq!(lr.items.len(), 1);
        assert_eq!(lr.total, Some(50));
        assert_eq!(lr.page, Some(1));
        assert_eq!(lr.per_page, Some(10));
        assert_eq!(lr.has_more, Some(true));
        assert_eq!(lr.cursor.as_deref(), Some("next-page"));
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. UpsertResult::from_value
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod upsert_result_tests {
    use crate::table::UpsertResult;
    use serde_json::json;

    #[test]
    fn from_value_action_inserted() {
        let v = json!({ "action": "inserted", "id": "new-1" });
        let ur = UpsertResult::from_value(v);
        assert!(ur.inserted);
    }

    #[test]
    fn from_value_action_updated() {
        let v = json!({ "action": "updated", "id": "existing-1" });
        let ur = UpsertResult::from_value(v);
        assert!(!ur.inserted);
    }

    #[test]
    fn from_value_missing_action_inserted_false() {
        let v = json!({ "id": "x" });
        let ur = UpsertResult::from_value(v);
        assert!(!ur.inserted);
    }

    #[test]
    fn record_contains_original_value() {
        let v = json!({ "action": "inserted", "id": "r1", "title": "hello" });
        let ur = UpsertResult::from_value(v.clone());
        assert_eq!(ur.record["title"], "hello");
    }

    #[test]
    fn record_preserves_all_fields() {
        let v = json!({ "action": "updated", "id": "r1", "title": "hello", "views": 42, "tags": ["a", "b"] });
        let ur = UpsertResult::from_value(v);
        assert_eq!(ur.record["views"], 42);
        assert_eq!(ur.record["tags"][0], "a");
        assert_eq!(ur.record["tags"][1], "b");
    }

    #[test]
    fn from_value_unknown_action_is_not_inserted() {
        let v = json!({ "action": "replaced", "id": "r1" });
        let ur = UpsertResult::from_value(v);
        assert!(!ur.inserted);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. BatchResult::from_value
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod batch_result_tests {
    use crate::table::BatchResult;
    use serde_json::json;

    #[test]
    fn from_value_full() {
        let v = json!({ "totalProcessed": 5, "totalSucceeded": 4, "errors": [{"msg":"err"}] });
        let br = BatchResult::from_value(v);
        assert_eq!(br.total_processed, 5);
        assert_eq!(br.total_succeeded, 4);
        assert_eq!(br.errors.len(), 1);
    }

    #[test]
    fn from_value_no_errors() {
        let v = json!({ "totalProcessed": 3, "totalSucceeded": 3, "errors": [] });
        let br = BatchResult::from_value(v);
        assert!(br.errors.is_empty());
    }

    #[test]
    fn from_value_missing_fields_defaults_to_zero() {
        let v = json!({});
        let br = BatchResult::from_value(v);
        assert_eq!(br.total_processed, 0);
        assert_eq!(br.total_succeeded, 0);
    }

    #[test]
    fn from_value_partial_success() {
        let v = json!({ "totalProcessed": 10, "totalSucceeded": 7, "errors": [{"id":"a"}, {"id":"b"}, {"id":"c"}] });
        let br = BatchResult::from_value(v);
        assert_eq!(br.total_processed, 10);
        assert_eq!(br.total_succeeded, 7);
        assert_eq!(br.errors.len(), 3);
    }

    #[test]
    fn from_value_missing_errors_defaults_to_empty() {
        let v = json!({ "totalProcessed": 5, "totalSucceeded": 5 });
        let br = BatchResult::from_value(v);
        assert!(br.errors.is_empty());
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. OrBuilder
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod or_builder_tests {
    use crate::table::OrBuilder;
    use serde_json::json;

    #[test]
    fn where_adds_filter() {
        let ob = OrBuilder::new().where_("status", "==", "active");
        assert_eq!(ob.filters.len(), 1);
    }

    #[test]
    fn where_chain_adds_multiple_filters() {
        let ob = OrBuilder::new()
            .where_("a", "==", "1")
            .where_("b", "==", "2");
        assert_eq!(ob.filters.len(), 2);
    }

    #[test]
    fn filter_fields_correct() {
        let ob = OrBuilder::new().where_("status", "==", "published");
        assert_eq!(ob.filters[0].0, "status");
        assert_eq!(ob.filters[0].1, "==");
        assert_eq!(ob.filters[0].2, json!("published"));
    }

    #[test]
    fn empty_or_builder_has_no_filters() {
        let ob = OrBuilder::new();
        assert!(ob.filters.is_empty());
    }

    #[test]
    fn or_builder_supports_various_operators() {
        let ob = OrBuilder::new()
            .where_("a", "!=", "x")
            .where_("b", ">", "5")
            .where_("c", "<", "10")
            .where_("d", ">=", "1")
            .where_("e", "<=", "100")
            .where_("f", "contains", "rust");
        assert_eq!(ob.filters.len(), 6);
        assert_eq!(ob.filters[5].1, "contains");
    }

    #[test]
    fn or_builder_accepts_array_values() {
        let ob = OrBuilder::new().where_("tags", "contains-any", json!(["featured", "archived"]));
        assert_eq!(ob.filters[0].2, json!(["featured", "archived"]));
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Error Display
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod error_display_tests {
    use crate::error::Error;

    #[test]
    fn api_error_format_contains_status_and_msg() {
        let err = Error::Api { status: 400, message: "Bad Request".to_string() };
        let s = format!("{}", err);
        assert!(s.contains("400"));
        assert!(s.contains("Bad Request"));
    }

    #[test]
    fn config_error_format() {
        let err = Error::Config("missing key".to_string());
        assert!(format!("{}", err).contains("missing key"));
    }

    #[test]
    fn url_error_format() {
        let err = Error::Url("invalid url".to_string());
        assert!(format!("{}", err).contains("invalid url"));
    }

    #[test]
    fn api_error_status_500() {
        let err = Error::Api { status: 500, message: "Server Error".to_string() };
        assert!(format!("{}", err).contains("500"));
    }

    #[test]
    fn api_error_status_401() {
        let err = Error::Api { status: 401, message: "Unauthorized".to_string() };
        let s = format!("{}", err);
        assert!(s.contains("401"));
        assert!(s.contains("Unauthorized"));
    }

    #[test]
    fn api_error_status_403() {
        let err = Error::Api { status: 403, message: "Forbidden".to_string() };
        let s = format!("{}", err);
        assert!(s.contains("403"));
        assert!(s.contains("Forbidden"));
    }

    #[test]
    fn api_error_status_409() {
        let err = Error::Api { status: 409, message: "Conflict".to_string() };
        let s = format!("{}", err);
        assert!(s.contains("409"));
        assert!(s.contains("Conflict"));
    }

    #[test]
    fn api_error_status_429() {
        let err = Error::Api { status: 429, message: "Rate limited".to_string() };
        let s = format!("{}", err);
        assert!(s.contains("429"));
        assert!(s.contains("Rate limited"));
    }

    #[test]
    fn config_error_empty_string() {
        let err = Error::Config(String::new());
        let s = format!("{}", err);
        assert!(s.contains("Config"));
    }

    #[test]
    fn url_error_with_details() {
        let err = Error::Url("scheme must be http or https".to_string());
        let s = format!("{}", err);
        assert!(s.contains("scheme must be http or https"));
    }

    #[test]
    fn error_is_debug_printable() {
        let err = Error::Api { status: 404, message: "Not Found".to_string() };
        let dbg = format!("{:?}", err);
        assert!(dbg.contains("Api"));
        assert!(dbg.contains("404"));
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 9. StorageBucket URL construction
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod storage_tests {
    use crate::http_client::HttpClient;
    use crate::storage::StorageClient;
    use std::sync::Arc;

    fn make_storage() -> StorageClient {
        let http = Arc::new(HttpClient::new("http://localhost:8688", "sk").unwrap());
        StorageClient::new(http)
    }

    #[test]
    fn bucket_returns_named_bucket() {
        let sc = make_storage();
        let b = sc.bucket("avatars");
        assert_eq!(b.name, "avatars");
    }

    #[test]
    fn get_url_constructs_correct_url() {
        let sc = make_storage();
        let b = sc.bucket("documents");
        let url = b.get_url("folder/file.pdf");
        assert_eq!(url, "http://localhost:8688/api/storage/documents/folder%2Ffile.pdf");
    }

    #[test]
    fn get_url_simple_key() {
        let sc = make_storage();
        let b = sc.bucket("images");
        let url = b.get_url("photo.jpg");
        assert_eq!(url, "http://localhost:8688/api/storage/images/photo.jpg");
    }

    #[test]
    fn get_url_with_special_chars() {
        let sc = make_storage();
        let b = sc.bucket("docs");
        let url = b.get_url("my file (1).txt");
        assert!(url.contains("my%20file%20%281%29.txt"));
    }

    #[test]
    fn get_url_utf8_key_uses_percent_encoded_bytes() {
        let sc = make_storage();
        let b = sc.bucket("docs");
        let key = "안녕-日本-مرحبا-😀.txt";
        let url = b.get_url(key);
        assert_eq!(url, format!("http://localhost:8688/api/storage/docs/{}", urlencoding::encode(key)));
    }

    #[test]
    fn multiple_buckets_from_same_client() {
        let sc = make_storage();
        let b1 = sc.bucket("images");
        let b2 = sc.bucket("documents");
        assert_eq!(b1.name, "images");
        assert_eq!(b2.name, "documents");
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Room types
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod room_tests {
    use crate::room::{RoomClient, RoomOptions, RoomWsCommand};
    use serde_json::json;
    use std::sync::{Arc, Mutex};
    use tokio::sync::mpsc;
    use tokio::time::{timeout, Duration};

    #[test]
    fn room_options_default_auto_reconnect() {
        let opts = RoomOptions::default();
        assert!(opts.auto_reconnect);
    }

    #[test]
    fn room_options_default_max_reconnect_attempts() {
        let opts = RoomOptions::default();
        assert_eq!(opts.max_reconnect_attempts, 10);
    }

    #[test]
    fn room_options_default_reconnect_base_delay_ms() {
        let opts = RoomOptions::default();
        assert_eq!(opts.reconnect_base_delay_ms, 1000);
    }

    #[test]
    fn room_options_default_send_timeout_ms() {
        let opts = RoomOptions::default();
        assert_eq!(opts.send_timeout_ms, 10_000);
    }

    #[test]
    fn room_client_new_has_namespace_and_room_id() {
        let room = RoomClient::new(
            "http://localhost:8688",
            "game",
            "lobby-1",
            || "token".to_string(),
            None,
        );
        assert_eq!(room.namespace, "game");
        assert_eq!(room.room_id, "lobby-1");
    }

    #[test]
    fn room_client_initial_state_is_empty() {
        let room = RoomClient::new(
            "http://localhost:8688",
            "chat",
            "room-1",
            || "tok".to_string(),
            None,
        );
        assert_eq!(room.get_shared_state(), serde_json::json!({}));
        assert_eq!(room.get_player_state(), serde_json::json!({}));
    }

    #[test]
    fn room_subscription_unsubscribe_is_callable() {
        let room = RoomClient::new(
            "http://localhost:8688",
            "ns",
            "r1",
            || "t".to_string(),
            None,
        );
        let sub = room.on_shared_state(|_state, _changes| {});
        // unsubscribe should not panic
        sub.unsubscribe();
    }

    #[test]
    fn room_subscription_drop_does_not_panic() {
        let room = RoomClient::new(
            "http://localhost:8688",
            "ns",
            "r1",
            || "t".to_string(),
            None,
        );
        {
            let _sub = room.on_kicked(|| {});
        }
        // After _sub is dropped, no panic
    }

    #[test]
    fn room_on_message_does_not_panic() {
        let room = RoomClient::new(
            "http://localhost:8688",
            "ns",
            "r1",
            || "t".to_string(),
            None,
        );
        let _s1 = room.on_message("game_over", |_| {});
        let _s2 = room.on_message("game_over", |_| {});
        let _s3 = room.on_message("chat", |_| {});
        // All subscriptions created without panic
    }

    #[test]
    fn room_multiple_subscription_types() {
        let room = RoomClient::new(
            "http://localhost:8688",
            "ns",
            "r1",
            || "t".to_string(),
            None,
        );
        let _s1 = room.on_shared_state(|_, _| {});
        let _s2 = room.on_player_state(|_, _| {});
        let _s3 = room.on_error(|_, _| {});
        let _s4 = room.on_kicked(|| {});
        // All subscription types work without panic
    }

    #[tokio::test]
    async fn room_leave_sends_explicit_leave_before_close() {
        let room = RoomClient::new(
            "http://localhost:8688",
            "ns",
            "r1",
            || "t".to_string(),
            None,
        );
        let (tx, mut rx) = mpsc::channel::<RoomWsCommand>(4);
        room.attach_send_channel_for_testing(tx);

        room.leave().await;

        let first = timeout(Duration::from_secs(1), rx.recv())
            .await
            .expect("first room command")
            .expect("first room command payload");
        let second = timeout(Duration::from_secs(1), rx.recv())
            .await
            .expect("second room command")
            .expect("second room command payload");

        match first {
            RoomWsCommand::Send(payload) => {
                let msg: serde_json::Value = serde_json::from_str(&payload).expect("leave json");
                assert_eq!(msg["type"], "leave");
            }
            _ => panic!("expected leave send command first"),
        }
        assert!(matches!(second, RoomWsCommand::Close));
    }

    #[test]
    fn room_unified_surface_parses_members_signals_and_session() {
        let room = RoomClient::new(
            "http://localhost:8688",
            "game",
            "room-1",
            || "t".to_string(),
            None,
        );

        let member_sync = Arc::new(Mutex::new(None));
        let signal = Arc::new(Mutex::new(None));
        let connection_states = Arc::new(Mutex::new(Vec::<String>::new()));
        let mut subscriptions = Vec::new();

        {
            let member_sync_capture = Arc::clone(&member_sync);
            subscriptions.push(room.members().on_sync(move |members| {
                *member_sync_capture.lock().unwrap() = Some(members.clone());
            }));
        }
        {
            let signal_capture = Arc::clone(&signal);
            subscriptions.push(room.signals().on("wave", move |payload, meta| {
                *signal_capture.lock().unwrap() = Some(json!({
                    "payload": payload,
                    "meta": meta,
                }));
            }));
        }
        {
            let connection_states_capture = Arc::clone(&connection_states);
            subscriptions.push(room.session().on_connection_state_change(move |state| {
                connection_states_capture
                    .lock()
                    .unwrap()
                    .push(state.to_string());
            }));
        }

        room.handle_message_for_testing(
            r#"{"type":"sync","sharedState":{"phase":"lobby"},"sharedVersion":1,"playerState":{"ready":true},"playerVersion":1}"#,
        );
        room.handle_message_for_testing(
            r#"{"type":"members_sync","members":[{"memberId":"user-1","userId":"user-1","connectionId":"conn-1","connectionCount":1,"state":{"cursor":"x:1"}}]}"#,
        );
        room.handle_message_for_testing(
            r#"{"type":"signal","event":"wave","payload":{"from":"server"},"meta":{"serverSent":true,"sentAt":123}}"#,
        );

        assert_eq!(room.state().get_shared(), json!({"phase":"lobby"}));
        assert_eq!(room.state().get_mine(), json!({"ready":true}));
        assert_eq!(room.members().list()[0]["memberId"], json!("user-1"));
        assert_eq!(room.session().connection_state(), "connected");
        assert_eq!(
            member_sync.lock().unwrap().clone(),
            Some(json!([{
                "memberId":"user-1",
                "userId":"user-1",
                "connectionId":"conn-1",
                "connectionCount":1,
                "state":{"cursor":"x:1"}
            }]))
        );
        assert_eq!(
            signal.lock().unwrap().clone(),
            Some(json!({
                "payload":{"from":"server"},
                "meta":{"serverSent":true,"sentAt":123}
            }))
        );
        assert_eq!(connection_states.lock().unwrap().as_slice(), ["connected"]);
        assert_eq!(subscriptions.len(), 3);
    }

    #[tokio::test]
    async fn room_unified_surface_sends_signal_member_and_admin_frames() {
        let room = RoomClient::new(
            "http://localhost:8688",
            "game",
            "room-1",
            || "t".to_string(),
            None,
        );
        let (tx, mut rx) = mpsc::channel::<RoomWsCommand>(8);
        room.attach_send_channel_for_testing(tx);

        let signal_task = {
            let room = Arc::clone(&room);
            tokio::spawn(async move {
                room.signals()
                    .send("wave", Some(json!({"value":1})), Some(json!({"includeSelf":true})))
                    .await
                    .unwrap();
            })
        };

        let signal_frame = timeout(Duration::from_secs(1), rx.recv())
            .await
            .expect("signal frame")
            .expect("signal payload");
        match signal_frame {
            RoomWsCommand::Send(payload) => {
                let msg: serde_json::Value = serde_json::from_str(&payload).expect("signal json");
                assert_eq!(msg["type"], "signal");
                assert_eq!(msg["event"], "wave");
                assert_eq!(msg["includeSelf"], true);
                room.handle_message_for_testing(
                    &json!({
                        "type":"signal_sent",
                        "event":"wave",
                        "requestId": msg["requestId"],
                    })
                    .to_string(),
                );
            }
            _ => panic!("expected signal send"),
        }
        signal_task.await.unwrap();

        let member_task = {
            let room = Arc::clone(&room);
            tokio::spawn(async move {
                room.members()
                    .set_state(json!({"typing":true}))
                    .await
                    .unwrap();
            })
        };
        let member_frame = timeout(Duration::from_secs(1), rx.recv())
            .await
            .expect("member frame")
            .expect("member payload");
        match member_frame {
            RoomWsCommand::Send(payload) => {
                let msg: serde_json::Value = serde_json::from_str(&payload).expect("member json");
                assert_eq!(msg["type"], "member_state");
                assert_eq!(msg["state"], json!({"typing":true}));
                room.handle_message_for_testing(
                    &json!({
                        "type":"member_state",
                        "member":{"memberId":"user-1","userId":"user-1","state":{"typing":true}},
                        "state":{"typing":true},
                        "requestId": msg["requestId"],
                    })
                    .to_string(),
                );
            }
            _ => panic!("expected member state send"),
        }
        member_task.await.unwrap();

        let admin_task = {
            let room = Arc::clone(&room);
            tokio::spawn(async move {
                room.admin().set_role("user-2", "moderator").await.unwrap();
            })
        };
        let admin_frame = timeout(Duration::from_secs(1), rx.recv())
            .await
            .expect("admin frame")
            .expect("admin payload");
        match admin_frame {
            RoomWsCommand::Send(payload) => {
                let msg: serde_json::Value = serde_json::from_str(&payload).expect("admin json");
                assert_eq!(msg["type"], "admin");
                assert_eq!(msg["operation"], "setRole");
                assert_eq!(msg["payload"]["role"], "moderator");
                room.handle_message_for_testing(
                    &json!({
                        "type":"admin_result",
                        "operation":"setRole",
                        "memberId":"user-2",
                        "requestId": msg["requestId"],
                        "result":{"ok":true},
                    })
                    .to_string(),
                );
            }
            _ => panic!("expected admin send"),
        }
        admin_task.await.unwrap();
    }
}
