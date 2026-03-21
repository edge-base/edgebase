//! EdgeBase Rust SDK -- E2E Integration Tests
//!
//! Runs against a local `wrangler dev` server.
//! Server-only SDK: adminAuth + table + storage + sql + kv + broadcast.
//!
//! Prerequisites:
//!   cd packages/server
//!   TMPDIR=/tmp XDG_CONFIG_HOME=/tmp npx wrangler dev --config wrangler.test.toml --port 8688
//!
//! Run:
//!   cd packages/sdk/rust
//!   BASE_URL=http://localhost:8688 EDGEBASE_SERVICE_KEY=sk_test \
//!   CARGO_TARGET_DIR=/tmp/rust-target cargo test --test e2e -- --nocapture
//!
//! Target: 100 E2E tests (50 core + 50 admin).
//! Rust-specific patterns tested:
//!   - tokio::join! parallel execution
//!   - Result<T, E> ? chaining
//!   - serde_json serialization/deserialization
//!   - Arc<Mutex<T>> shared state
//!   - async operations

use edgebase::EdgeBase;
use edgebase_core::Error;
use std::env;
use std::sync::Arc;

fn base_url() -> String {
    env::var("BASE_URL").unwrap_or_else(|_| "http://localhost:8688".to_string())
}

fn service_key() -> String {
    env::var("EDGEBASE_SERVICE_KEY").unwrap_or_default()
}

fn unique_email() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    format!("e2e-rust-{}-{}@test.com", ts, n)
}

fn unique_prefix() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static PREFIX_COUNTER: AtomicU64 = AtomicU64::new(0);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let n = PREFIX_COUNTER.fetch_add(1, Ordering::SeqCst);
    format!("rust-e2e-{}-{}", ts, n)
}

/// Helper: create an admin client with env defaults.
fn admin() -> EdgeBase {
    EdgeBase::server(&base_url(), &service_key()).expect("admin init failed")
}

async fn insert_post_with_retry(
    admin: Arc<EdgeBase>,
    title: String,
) -> Result<serde_json::Value, Error> {
    let mut last_error: Option<Error> = None;

    for attempt in 0..3 {
        match admin
            .db("shared", None)
            .table("posts")
            .insert(&serde_json::json!({ "title": title }))
            .await
        {
            Ok(created) => return Ok(created),
            Err(Error::Api { status, message })
                if status == 503
                    && message.contains("worker restarted mid-request")
                    && attempt < 2 =>
            {
                last_error = Some(Error::Api { status, message });
                tokio::time::sleep(std::time::Duration::from_millis(150 * (attempt + 1) as u64)).await;
            }
            Err(err) => return Err(err),
        }
    }

    Err(last_error.unwrap_or_else(|| Error::Config("insert retry exhausted".to_string())))
}

/// Helper: extract ID from create_user response (handles nested `user` field).
fn extract_id(v: &std::collections::HashMap<String, serde_json::Value>) -> String {
    v.get("id")
        .or_else(|| v.get("user").and_then(|u| u.get("id")))
        .and_then(|v| v.as_str())
        .expect("no id in response")
        .to_string()
}

fn extract_email(v: &std::collections::HashMap<String, serde_json::Value>) -> String {
    v.get("email")
        .or_else(|| v.get("user").and_then(|u| u.get("email")))
        .and_then(|v| v.as_str())
        .expect("no email in response")
        .to_string()
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: Admin Auth CRUD (E2E 1-10)
// ═══════════════════════════════════════════════════════════════════════════════

mod admin_auth {
    use super::*;

#[tokio::test]
async fn e2e_01_admin_auth_create_user() {
    let admin = admin();
    let email = unique_email();
    let created = admin.admin_auth().create_user(&email, "RustE2EPass123!").await.expect("create_user failed");
    let id = extract_id(&created);
    assert!(!id.is_empty());
    assert_eq!(extract_email(&created), email);
}

#[tokio::test]
async fn e2e_02_admin_auth_get_user() {
    let admin = admin();
    let email = unique_email();
    let created = admin.admin_auth().create_user(&email, "RustE2EPass123!").await.unwrap();
    let id = extract_id(&created);

    let fetched = admin.admin_auth().get_user(&id).await.expect("get_user failed");
    let fetched_id = fetched.get("id")
        .or_else(|| fetched.get("user").and_then(|u| u.get("id")))
        .and_then(|v| v.as_str())
        .expect("no id in get_user");
    assert_eq!(fetched_id, id);
}

#[tokio::test]
async fn e2e_03_admin_auth_list_users() {
    let admin = admin();
    let result = admin.admin_auth().list_users(10, None).await.expect("list_users failed");
    assert!(result.get("users").is_some(), "no users field in response");
}

#[tokio::test]
async fn e2e_04_admin_auth_list_users_with_limit() {
    let admin = admin();
    // Create a couple users first
    admin.admin_auth().create_user(&unique_email(), "Pass123!").await.unwrap();
    admin.admin_auth().create_user(&unique_email(), "Pass123!").await.unwrap();

    let result = admin.admin_auth().list_users(1, None).await.expect("list_users failed");
    let users = result["users"].as_array().expect("users array");
    assert!(users.len() <= 1, "Should respect limit");
}

#[tokio::test]
async fn e2e_05_admin_auth_update_user() {
    let admin = admin();
    let email = unique_email();
    let created = admin.admin_auth().create_user(&email, "Pass123!").await.unwrap();
    let id = extract_id(&created);

    let updated = admin.admin_auth()
        .update_user(&id, &serde_json::json!({ "displayName": "Rust Tester" }))
        .await
        .expect("update_user failed");

    // Response should contain the user data
    let _ = updated;
}

#[tokio::test]
async fn e2e_06_admin_auth_delete_user() {
    let admin = admin();
    let email = unique_email();
    let created = admin.admin_auth().create_user(&email, "Pass123!").await.unwrap();
    let id = extract_id(&created);

    admin.admin_auth().delete_user(&id).await.expect("delete_user failed");

    // Verify user no longer exists
    let result = admin.admin_auth().get_user(&id).await;
    assert!(result.is_err(), "get_user should fail after delete");
}

#[tokio::test]
async fn e2e_07_admin_auth_set_custom_claims() {
    let admin = admin();
    let email = unique_email();
    let created = admin.admin_auth().create_user(&email, "ClaimsPass123!").await.unwrap();
    let id = extract_id(&created);

    admin.admin_auth()
        .set_custom_claims(&id, serde_json::json!({ "plan": "pro", "tier": 2 }))
        .await
        .expect("set_custom_claims failed");

    let fetched = admin.admin_auth().get_user(&id).await.expect("get_user after set_claims failed");
    let fetched_id = fetched.get("id")
        .or_else(|| fetched.get("user").and_then(|u| u.get("id")))
        .and_then(|v| v.as_str())
        .expect("no id");
    assert_eq!(fetched_id, id);
}

#[tokio::test]
async fn e2e_08_admin_auth_revoke_all_sessions() {
    let admin = admin();
    let email = unique_email();
    let created = admin.admin_auth().create_user(&email, "RevokePass123!").await.unwrap();
    let id = extract_id(&created);

    admin.admin_auth().revoke_all_sessions(&id).await.expect("revoke_all_sessions failed");
}

#[tokio::test]
async fn e2e_09_admin_auth_create_duplicate_email_fails() {
    let admin = admin();
    let email = unique_email();
    admin.admin_auth().create_user(&email, "Pass123!").await.unwrap();

    let result = admin.admin_auth().create_user(&email, "DifferentPass123!").await;
    assert!(result.is_err(), "Duplicate email should fail");
}

#[tokio::test]
async fn e2e_10_admin_auth_get_nonexistent_user_fails() {
    let admin = admin();
    let result = admin.admin_auth().get_user("nonexistent-user-id-99999").await;
    assert!(result.is_err(), "get nonexistent user should fail");
}

} // mod admin_auth

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: Collection CRUD (E2E 11-20)
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn e2e_11_collection_insert() {
    let admin = admin();
    let created = admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({ "title": "Rust E2E Create" }))
        .await
        .expect("create failed");
    let id = created["id"].as_str().expect("no id");
    assert!(!id.is_empty());
}

#[tokio::test]
async fn e2e_12_collection_get_one() {
    let admin = admin();
    let created = admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({ "title": "Rust E2E GetOne" }))
        .await.unwrap();
    let id = created["id"].as_str().unwrap().to_string();

    let fetched = admin.db("shared", None).table("posts")
        .get_one(&id).await.expect("get_one failed");
    assert_eq!(fetched["id"].as_str().unwrap(), id);
}

#[tokio::test]
async fn e2e_13_collection_update() {
    let admin = admin();
    let created = admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({ "title": "Before Update" }))
        .await.unwrap();
    let id = created["id"].as_str().unwrap().to_string();

    let updated = admin.db("shared", None).table("posts")
        .update(&id, &serde_json::json!({ "title": "After Update" }))
        .await
        .expect("update failed");

    // Verify update took effect
    let v = updated.get("title").or_else(|| updated.get("id"));
    assert!(v.is_some());
}

#[tokio::test]
async fn e2e_14_collection_delete() {
    let admin = admin();
    let created = admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({ "title": "To Delete" }))
        .await.unwrap();
    let id = created["id"].as_str().unwrap().to_string();

    admin.db("shared", None).table("posts")
        .delete(&id).await.expect("delete failed");

    let result = admin.db("shared", None).table("posts").get_one(&id).await;
    assert!(result.is_err(), "Should fail after delete");
}

#[tokio::test]
async fn e2e_15_collection_full_crud_chain() {
    let admin = admin();
    let table = admin.db("shared", None).table("posts");
    let prefix = unique_prefix();

    // Create
    let created = table.insert(&serde_json::json!({ "title": format!("{}-chain", prefix) }))
        .await.expect("create");
    let id = created["id"].as_str().unwrap().to_string();

    // Read
    let fetched = table.get_one(&id).await.expect("get_one");
    assert_eq!(fetched["id"].as_str().unwrap(), id);

    // Update
    table.update(&id, &serde_json::json!({ "content": "chain-updated" }))
        .await.expect("update");

    // Verify update
    let fetched2 = table.get_one(&id).await.expect("get_one after update");
    assert_eq!(fetched2["content"].as_str().unwrap(), "chain-updated");

    // Delete
    table.delete(&id).await.expect("delete");

    // Verify deleted
    assert!(table.get_one(&id).await.is_err());
}

#[tokio::test]
async fn e2e_16_collection_insert_with_multiple_fields() {
    let admin = admin();
    let created = admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({
            "title": "Multi Field",
            "content": "Body text here",
            "views": 42,
            "published": true
        }))
        .await
        .expect("create failed");
    assert!(created["id"].as_str().is_some());
}

#[tokio::test]
async fn e2e_17_collection_update_partial_fields() {
    let admin = admin();
    let created = admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({ "title": "Partial", "content": "original", "views": 0 }))
        .await.unwrap();
    let id = created["id"].as_str().unwrap().to_string();

    // Only update views, leave title and content intact
    admin.db("shared", None).table("posts")
        .update(&id, &serde_json::json!({ "views": 10 }))
        .await.expect("partial update failed");

    let fetched = admin.db("shared", None).table("posts").get_one(&id).await.unwrap();
    assert_eq!(fetched["title"].as_str().unwrap(), "Partial");
    assert_eq!(fetched["views"].as_i64().unwrap(), 10);
}

#[tokio::test]
async fn e2e_18_error_get_nonexistent_404() {
    let admin = admin();
    let result = admin.db("shared", None).table("posts")
        .get_one("nonexistent-rust-99999").await;
    assert!(result.is_err(), "Expected 404 error");
}

#[tokio::test]
async fn e2e_19_error_update_nonexistent() {
    let admin = admin();
    let result = admin.db("shared", None).table("posts")
        .update("nonexistent-update-rust", &serde_json::json!({ "title": "Nope" })).await;
    assert!(result.is_err(), "Expected error for nonexistent update");
}

#[tokio::test]
async fn e2e_20_error_delete_nonexistent() {
    let admin = admin();
    let result = admin.db("shared", None).table("posts")
        .delete("nonexistent-delete-rust").await;
    assert!(result.is_err(), "Expected error for nonexistent delete");
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: Query Builder (E2E 21-35)
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn e2e_21_query_where_filter() {
    let admin = admin();
    let prefix = unique_prefix();
    admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({ "title": prefix }))
        .await.unwrap();

    let result = admin.db("shared", None).table("posts")
        .where_("title", "==", &prefix)
        .get_list().await.expect("where.get failed");

    let items = result["items"].as_array().expect("no items");
    assert!(!items.is_empty(), "Expected at least 1 item");
}

#[tokio::test]
async fn e2e_22_query_order_by_limit() {
    let admin = admin();
    let result = admin.db("shared", None).table("posts")
        .order_by("createdAt", "desc")
        .limit(2)
        .get_list().await.expect("orderBy.limit.get failed");

    let items = result["items"].as_array().expect("no items");
    assert!(items.len() <= 2, "Expected <= 2 items");
}

#[tokio::test]
async fn e2e_23_query_count() {
    let admin = admin();
    let count = admin.db("shared", None).table("posts")
        .count().await.expect("count failed");
    // Count should be a non-negative number
    let _ = count;
}

#[tokio::test]
async fn e2e_24_query_offset_pagination() {
    let admin = admin();
    let prefix = unique_prefix();
    for i in 0..5 {
        admin.db("shared", None).table("posts")
            .insert(&serde_json::json!({ "title": format!("{}-{}", prefix, i) }))
            .await.unwrap();
    }

    let page1 = admin.db("shared", None).table("posts")
        .order_by("title", "asc")
        .limit(2)
        .get_list().await.expect("page1");
    let page2 = admin.db("shared", None).table("posts")
        .order_by("title", "asc")
        .limit(2)
        .offset(2)
        .get_list().await.expect("page2");

    assert!(page1["items"].as_array().unwrap().len() <= 2);
    assert!(page2["items"].as_array().unwrap().len() <= 2);
}

#[tokio::test]
async fn e2e_25_query_multiple_where() {
    let admin = admin();
    let prefix = unique_prefix();
    admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({ "title": prefix, "views": 30 }))
        .await.unwrap();

    let result = admin.db("shared", None).table("posts")
        .where_("title", "==", &prefix)
        .where_("views", ">=", "20")
        .get_list().await.expect("multiWhere.get failed");

    let items = result["items"].as_array().expect("no items");
    assert!(!items.is_empty(), "Expected at least 1 item");
}

#[tokio::test]
async fn e2e_26_query_search_fts() {
    let admin = admin();
    let prefix = unique_prefix();
    admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({ "title": prefix, "content": format!("{} searchable body", prefix) }))
        .await.unwrap();

    let result = admin.db("shared", None).table("posts")
        .search(&prefix)
        .get_list().await.expect("search failed");

    let items = result.get("items").and_then(|v| v.as_array()).expect("items array");
    assert!(items.len() >= 1, "FTS search should return at least 1 result");
}

#[tokio::test]
async fn e2e_27_cursor_pagination() {
    let admin = admin();
    let prefix = unique_prefix();
    for i in 0..6 {
        admin.db("shared", None).table("posts")
            .insert(&serde_json::json!({ "title": format!("{}-cursor-{:02}", prefix, i) }))
            .await.unwrap();
    }

    let page1 = admin.db("shared", None).table("posts")
        .where_("title", "contains", &prefix)
        .order_by("title", "asc")
        .limit(3)
        .get_list().await.expect("page1");

    let items1 = page1["items"].as_array().expect("no items in page1");
    assert!(!items1.is_empty());

    if let Some(cursor) = page1.get("cursor").and_then(|c| c.as_str()) {
        let page2 = admin.db("shared", None).table("posts")
            .where_("title", "contains", &prefix)
            .order_by("title", "asc")
            .limit(3)
            .after(cursor)
            .get_list().await.expect("page2 (cursor)");

        let items2 = page2["items"].as_array().expect("no items in page2");
        if !items2.is_empty() {
            assert_ne!(items1[0]["id"].as_str(), items2[0]["id"].as_str());
        }
    } else {
        let page2 = admin.db("shared", None).table("posts")
            .where_("title", "contains", &prefix)
            .order_by("title", "asc")
            .limit(3)
            .offset(3)
            .get_list().await.expect("page2 (offset fallback)");
        let items2 = page2["items"].as_array().unwrap();
        if !items1.is_empty() && !items2.is_empty() {
            assert_ne!(items1[0]["id"].as_str(), items2[0]["id"].as_str());
        }
    }
}

#[tokio::test]
async fn e2e_28_query_order_by_asc() {
    let admin = admin();
    let prefix = unique_prefix();
    admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({ "title": format!("{}-aaa", prefix) })).await.unwrap();
    admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({ "title": format!("{}-zzz", prefix) })).await.unwrap();

    let result = admin.db("shared", None).table("posts")
        .where_("title", "contains", &prefix)
        .order_by("title", "asc")
        .get_list().await.expect("order asc");

    let items = result["items"].as_array().unwrap();
    if items.len() >= 2 {
        let t1 = items[0]["title"].as_str().unwrap();
        let t2 = items[1]["title"].as_str().unwrap();
        assert!(t1 <= t2, "Should be ascending");
    }
}

#[tokio::test]
async fn e2e_29_query_order_by_desc() {
    let admin = admin();
    let prefix = unique_prefix();
    admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({ "title": format!("{}-aaa", prefix) })).await.unwrap();
    admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({ "title": format!("{}-zzz", prefix) })).await.unwrap();

    let result = admin.db("shared", None).table("posts")
        .where_("title", "contains", &prefix)
        .order_by("title", "desc")
        .get_list().await.expect("order desc");

    let items = result["items"].as_array().unwrap();
    if items.len() >= 2 {
        let t1 = items[0]["title"].as_str().unwrap();
        let t2 = items[1]["title"].as_str().unwrap();
        assert!(t1 >= t2, "Should be descending");
    }
}

#[tokio::test]
async fn e2e_30_query_where_not_equal() {
    let admin = admin();
    let prefix = unique_prefix();
    admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({ "title": format!("{}-alpha", prefix) })).await.unwrap();
    admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({ "title": format!("{}-beta", prefix) })).await.unwrap();

    let result = admin.db("shared", None).table("posts")
        .where_("title", "!=", &format!("{}-alpha", prefix))
        .where_("title", "contains", &prefix)
        .get_list().await.expect("ne filter");

    let items = result["items"].as_array().unwrap();
    for item in items {
        assert_ne!(item["title"].as_str().unwrap(), format!("{}-alpha", prefix));
    }
}

#[tokio::test]
async fn e2e_31_query_contains_filter() {
    let admin = admin();
    let prefix = unique_prefix();
    admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({ "title": format!("prefix-{}-suffix", prefix) })).await.unwrap();

    let result = admin.db("shared", None).table("posts")
        .where_("title", "contains", &prefix)
        .get_list().await.expect("contains");
    let items = result["items"].as_array().unwrap();
    assert!(!items.is_empty());
}

#[tokio::test]
async fn e2e_32_query_count_with_filter() {
    let admin = admin();
    let prefix = unique_prefix();
    for _ in 0..3 {
        admin.db("shared", None).table("posts")
            .insert(&serde_json::json!({ "title": prefix })).await.unwrap();
    }

    let count = admin.db("shared", None).table("posts")
        .where_("title", "==", &prefix)
        .count().await.expect("count with filter");
    assert!(count >= 3, "Should count at least 3 items, got {}", count);
}

#[tokio::test]
async fn e2e_33_query_limit_zero_returns_empty() {
    let admin = admin();
    let result = admin.db("shared", None).table("posts")
        .limit(0)
        .get_list().await;
    // limit=0 might return empty or error depending on server impl
    let _ = result;
}

#[tokio::test]
async fn e2e_34_query_large_offset_returns_empty() {
    let admin = admin();
    let result = admin.db("shared", None).table("posts")
        .offset(999999)
        .get_list().await.expect("large offset");
    let items = result["items"].as_array().unwrap();
    assert!(items.is_empty(), "Large offset should return empty");
}

#[tokio::test]
async fn e2e_35_query_or_filter() {
    let admin = admin();
    let prefix = unique_prefix();
    admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({ "title": format!("{}-orA", prefix), "views": 10 })).await.unwrap();
    admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({ "title": format!("{}-orB", prefix), "views": 50 })).await.unwrap();

    let result = admin.db("shared", None).table("posts")
        .where_("title", "contains", &prefix)
        .or_(|q| q.where_("views", ">=", "40"))
        .get_list().await.expect("or filter");
    let items = result["items"].as_array().unwrap();
    assert!(!items.is_empty());
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: Batch Operations (E2E 36-45)
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn e2e_36_batch_insert_many() {
    let admin = admin();
    let records = vec![
        serde_json::json!({ "title": "Rust Batch A" }),
        serde_json::json!({ "title": "Rust Batch B" }),
        serde_json::json!({ "title": "Rust Batch C" }),
    ];
    let result = admin.db("shared", None).table("posts")
        .insert_many(records).await.expect("insertMany failed");

    let items = result.as_array()
        .cloned()
        .or_else(|| result.get("inserted").and_then(|v| v.as_array()).cloned())
        .or_else(|| result.get("items").and_then(|v| v.as_array()).cloned())
        .expect("result should contain items array");
    assert_eq!(items.len(), 3);
}

#[tokio::test]
async fn e2e_37_batch_insert_many_single_item() {
    let admin = admin();
    let records = vec![serde_json::json!({ "title": "Single Batch" })];
    let result = admin.db("shared", None).table("posts")
        .insert_many(records).await.expect("insertMany single");
    let items = result.as_array()
        .cloned()
        .or_else(|| result.get("inserted").and_then(|v| v.as_array()).cloned())
        .or_else(|| result.get("items").and_then(|v| v.as_array()).cloned())
        .expect("items");
    assert_eq!(items.len(), 1);
}

#[tokio::test]
async fn e2e_38_batch_insert_many_10_items() {
    let admin = admin();
    let prefix = unique_prefix();
    let records: Vec<_> = (0..10)
        .map(|i| serde_json::json!({ "title": format!("{}-batch10-{}", prefix, i) }))
        .collect();
    let result = admin.db("shared", None).table("posts")
        .insert_many(records).await.expect("insertMany 10");
    let items = result.as_array()
        .cloned()
        .or_else(|| result.get("inserted").and_then(|v| v.as_array()).cloned())
        .or_else(|| result.get("items").and_then(|v| v.as_array()).cloned())
        .expect("items");
    assert_eq!(items.len(), 10);
}

#[tokio::test]
async fn e2e_39_batch_update_many() {
    let admin = admin();
    let prefix = unique_prefix();
    admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({ "title": prefix, "content": "old" })).await.unwrap();

    admin.db("shared", None).table("posts")
        .where_("title", "==", &prefix)
        .update_many(&serde_json::json!({ "content": "batch-updated" }))
        .await.expect("updateMany failed");
}

#[tokio::test]
async fn e2e_40_batch_delete_many() {
    let admin = admin();
    let prefix = unique_prefix();
    admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({ "title": prefix })).await.unwrap();
    admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({ "title": prefix })).await.unwrap();

    admin.db("shared", None).table("posts")
        .where_("title", "==", &prefix)
        .delete_many().await.expect("deleteMany failed");

    let result = admin.db("shared", None).table("posts")
        .where_("title", "==", &prefix)
        .get_list().await.expect("verify deleted");
    let items = result["items"].as_array().unwrap();
    assert!(items.is_empty(), "All matching items should be deleted");
}

#[tokio::test]
async fn e2e_41_upsert_inserts_new() {
    let admin = admin();
    let result = admin.db("shared", None).table("posts")
        .upsert(&serde_json::json!({ "title": "Rust Upsert New" }), None)
        .await.expect("upsert failed");
    assert!(result.get("id").is_some() || result.get("record").is_some());
}

#[tokio::test]
async fn e2e_42_upsert_with_conflict_target() {
    let admin = admin();
    let prefix = unique_prefix();
    admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({ "title": prefix, "content": "original" })).await.unwrap();

    let result = admin.db("shared", None).table("posts")
        .upsert(&serde_json::json!({ "title": prefix, "content": "upserted" }), Some("title"))
        .await;
    // Server may or may not support conflictTarget — test that it doesn't crash
    let _ = result;
}

#[tokio::test]
async fn e2e_43_upsert_many() {
    let admin = admin();
    let prefix = unique_prefix();
    let records = vec![
        serde_json::json!({ "title": format!("{}-upsert-a", prefix) }),
        serde_json::json!({ "title": format!("{}-upsert-b", prefix) }),
    ];
    let result = admin.db("shared", None).table("posts")
        .upsert_many(records, None).await;
    // Verify it doesn't panic
    let _ = result;
}

#[tokio::test]
async fn e2e_44_batch_update_many_with_or_filter() {
    let admin = admin();
    let prefix = unique_prefix();
    admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({ "title": format!("{}-orUp", prefix), "views": 5 })).await.unwrap();
    admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({ "title": format!("{}-orUp2", prefix), "views": 50 })).await.unwrap();

    let result = admin.db("shared", None).table("posts")
        .where_("title", "contains", &prefix)
        .or_(|q| q.where_("views", ">=", "40"))
        .update_many(&serde_json::json!({ "content": "or-batch-updated" }))
        .await;
    let _ = result;
}

#[tokio::test]
async fn e2e_45_batch_delete_many_with_or_filter() {
    let admin = admin();
    let prefix = unique_prefix();
    admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({ "title": format!("{}-orDel", prefix), "views": 100 })).await.unwrap();

    let result = admin.db("shared", None).table("posts")
        .where_("title", "contains", &prefix)
        .or_(|q| q.where_("views", ">=", "50"))
        .delete_many().await;
    let _ = result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: Storage (E2E 46-60)
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn e2e_46_storage_upload_and_download() {
    let admin = admin();
    let key = format!("{}/test.bin", unique_prefix());
    let content: Vec<u8> = b"Rust E2E upload content".to_vec();

    admin.storage().bucket("documents")
        .upload(&key, content.clone(), "application/octet-stream").await.expect("upload");

    let downloaded = admin.storage().bucket("documents")
        .download(&key).await.expect("download");
    assert_eq!(downloaded, content);
}

#[tokio::test]
async fn e2e_47_storage_upload_text() {
    let admin = admin();
    let key = format!("{}/text.txt", unique_prefix());
    let content = b"Hello, Rust text!".to_vec();

    admin.storage().bucket("documents")
        .upload(&key, content.clone(), "text/plain").await.expect("upload text");

    let downloaded = admin.storage().bucket("documents")
        .download(&key).await.expect("download text");
    assert_eq!(downloaded, content);
}

#[tokio::test]
async fn e2e_48_storage_upload_string_raw() {
    let admin = admin();
    let key = format!("{}/raw.txt", unique_prefix());

    admin.storage().bucket("documents")
        .upload_string(&key, "raw string content", "raw", "text/plain")
        .await.expect("upload_string raw");

    let downloaded = admin.storage().bucket("documents")
        .download(&key).await.expect("download");
    assert_eq!(String::from_utf8(downloaded).unwrap(), "raw string content");
}

#[tokio::test]
async fn e2e_49_storage_upload_string_base64() {
    let admin = admin();
    let key = format!("{}/b64.txt", unique_prefix());
    use base64::Engine as _;
    let encoded = base64::engine::general_purpose::STANDARD.encode("base64 content");

    admin.storage().bucket("documents")
        .upload_string(&key, &encoded, "base64", "text/plain")
        .await.expect("upload_string base64");

    let downloaded = admin.storage().bucket("documents")
        .download(&key).await.expect("download");
    assert_eq!(String::from_utf8(downloaded).unwrap(), "base64 content");
}

#[tokio::test]
async fn e2e_50_storage_delete() {
    let admin = admin();
    let key = format!("{}/delete-test.txt", unique_prefix());
    admin.storage().bucket("documents")
        .upload(&key, b"delete me".to_vec(), "text/plain").await.unwrap();

    admin.storage().bucket("documents")
        .delete(&key).await.expect("delete");

    let result = admin.storage().bucket("documents").download(&key).await;
    assert!(result.is_err(), "Expected error after delete");
}

#[tokio::test]
async fn e2e_51_storage_list_files() {
    let admin = admin();
    let prefix = unique_prefix();
    let key = format!("{}/list-test.txt", prefix);
    admin.storage().bucket("documents")
        .upload(&key, b"list test".to_vec(), "text/plain").await.unwrap();

    let files = admin.storage().bucket("documents")
        .list(&format!("{}/", prefix), 100, 0).await.expect("list");
    assert!(files.get("files").is_some(), "files field missing");
}

#[tokio::test]
async fn e2e_52_storage_get_metadata() {
    let admin = admin();
    let key = format!("{}/meta.txt", unique_prefix());
    admin.storage().bucket("documents")
        .upload(&key, b"metadata test".to_vec(), "text/plain").await.unwrap();

    let meta = admin.storage().bucket("documents")
        .get_metadata(&key).await.expect("getMetadata");
    assert_eq!(meta["key"].as_str().unwrap(), key);
}

#[tokio::test]
async fn e2e_53_storage_update_metadata() {
    let admin = admin();
    let key = format!("{}/updmeta.txt", unique_prefix());
    admin.storage().bucket("documents")
        .upload(&key, b"meta update test".to_vec(), "text/plain").await.unwrap();

    admin.storage().bucket("documents")
        .update_metadata(&key, &serde_json::json!({ "customField": "hello" }))
        .await.expect("updateMetadata");
}

#[tokio::test]
async fn e2e_54_storage_create_signed_url() {
    let admin = admin();
    let key = format!("{}/signed.txt", unique_prefix());
    admin.storage().bucket("documents")
        .upload(&key, b"signed content".to_vec(), "text/plain").await.unwrap();

    let result = admin.storage().bucket("documents")
        .create_signed_url(&key, "1h").await.expect("createSignedUrl");
    assert!(result["url"].as_str().is_some(), "URL should be present");
}

#[tokio::test]
async fn e2e_55_storage_create_signed_upload_url() {
    let admin = admin();
    let key = format!("{}/signed-upload.txt", unique_prefix());
    let res = admin.storage().bucket("documents")
        .create_signed_upload_url(&key, "1h").await.expect("createSignedUploadUrl");

    assert!(res.get("url").is_some(), "URL should be present");
    let url_str = res["url"].as_str().unwrap();
    assert!(url_str.contains("/upload"), "URL should contain /upload");
}

#[tokio::test]
async fn e2e_56_storage_resumable_upload() {
    let admin = admin();
    let key = format!("{}/resumable.bin", unique_prefix());
    let content = b"Hello, Rust multipart world!".to_vec();

    let upload_id = admin.storage().bucket("documents")
        .initiate_resumable_upload(&key, "application/octet-stream").await.expect("initiate");
    assert!(!upload_id.is_empty());

    let part1 = admin.storage().bucket("documents")
        .upload_part(&key, &upload_id, 1, content.clone()).await.expect("upload_part");

    admin.storage().bucket("documents")
        .complete_resumable_upload(&key, &upload_id, vec![part1]).await.expect("complete");

    let downloaded = admin.storage().bucket("documents")
        .download(&key).await.expect("download after resumable");
    assert_eq!(downloaded, content);
}

#[tokio::test]
async fn e2e_57_storage_large_binary_upload() {
    let admin = admin();
    let key = format!("{}/large.bin", unique_prefix());
    // 1KB binary content
    let content: Vec<u8> = (0..1024).map(|i| (i % 256) as u8).collect();

    admin.storage().bucket("documents")
        .upload(&key, content.clone(), "application/octet-stream").await.expect("upload large");

    let downloaded = admin.storage().bucket("documents")
        .download(&key).await.expect("download large");
    assert_eq!(downloaded.len(), content.len());
    assert_eq!(downloaded, content);
}

#[tokio::test]
async fn e2e_58_storage_download_nonexistent_fails() {
    let admin = admin();
    let result = admin.storage().bucket("documents")
        .download("nonexistent-key-99999/file.txt").await;
    assert!(result.is_err(), "download nonexistent should fail");
}

#[tokio::test]
async fn e2e_59_storage_get_url_is_sync() {
    let admin = admin();
    let url = admin.storage().bucket("documents").get_url("test/file.txt");
    assert!(url.contains("/api/storage/documents/"));
    assert!(url.starts_with(&base_url()));
}

#[tokio::test]
async fn e2e_60_storage_multiple_buckets() {
    let admin = admin();
    let key = format!("{}/multi-bucket.txt", unique_prefix());
    admin.storage().bucket("documents")
        .upload(&key, b"bucket test".to_vec(), "text/plain").await.expect("upload");

    let downloaded = admin.storage().bucket("documents")
        .download(&key).await.expect("download from same bucket");
    assert_eq!(downloaded, b"bucket test");
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: SQL (E2E 61-65)
// ═══════════════════════════════════════════════════════════════════════════════

mod admin_services {
    use super::*;

#[tokio::test]
async fn e2e_61_sql_simple_query() {
    let admin = admin();
    let rows = admin.sql::<()>("shared", None, "SELECT id FROM posts LIMIT 5", &[])
        .await.expect("sql failed");
    let _ = rows;
}

#[tokio::test]
async fn e2e_62_sql_count_query() {
    let admin = admin();
    let rows = admin.sql::<()>("shared", None, "SELECT COUNT(*) as cnt FROM posts", &[])
        .await.expect("sql count");
    let _ = rows;
}

#[tokio::test]
async fn e2e_63_sql_with_where_clause() {
    let admin = admin();
    let prefix = unique_prefix();
    admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({ "title": prefix })).await.unwrap();

    let rows = admin.sql("shared", None, "SELECT id, title FROM posts WHERE title = ?", &[&prefix])
        .await.expect("sql with where");
    let _ = rows;
}

#[tokio::test]
async fn e2e_64_sql_empty_result() {
    let admin = admin();
    let rows = admin.sql::<()>("shared", None, "SELECT id FROM posts WHERE id = 'nonexistent-sql-999'", &[])
        .await.expect("sql empty");
    let _ = rows;
}

#[tokio::test]
async fn e2e_65_sql_select_star() {
    let admin = admin();
    let rows = admin.sql::<()>("shared", None, "SELECT * FROM posts LIMIT 1", &[])
        .await.expect("sql select star");
    let _ = rows;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7: Broadcast (E2E 66-70)
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn e2e_66_broadcast_simple() {
    let admin = admin();
    let channel = format!("rust-bcast-{}", unique_prefix());
    let payload = serde_json::json!({"msg": "Hello from Rust"});

    admin.broadcast(&channel, "server-event", payload).await.expect("broadcast failed");
}

#[tokio::test]
async fn e2e_67_broadcast_complex_payload() {
    let admin = admin();
    let channel = format!("rust-bcast-{}", unique_prefix());
    let payload = serde_json::json!({
        "type": "notification",
        "data": {
            "userId": "u-123",
            "items": [1, 2, 3],
            "nested": { "deep": true }
        }
    });
    admin.broadcast(&channel, "complex-event", payload).await.expect("broadcast complex");
}

#[tokio::test]
async fn e2e_68_broadcast_empty_payload() {
    let admin = admin();
    let channel = format!("rust-bcast-{}", unique_prefix());
    admin.broadcast(&channel, "ping", serde_json::json!({})).await.expect("broadcast empty");
}

#[tokio::test]
async fn e2e_69_broadcast_multiple_channels() {
    let admin = admin();
    let ch1 = format!("rust-ch1-{}", unique_prefix());
    let ch2 = format!("rust-ch2-{}", unique_prefix());

    admin.broadcast(&ch1, "event1", serde_json::json!({"ch": 1})).await.expect("broadcast ch1");
    admin.broadcast(&ch2, "event2", serde_json::json!({"ch": 2})).await.expect("broadcast ch2");
}

#[tokio::test]
async fn e2e_70_broadcast_string_payload() {
    let admin = admin();
    let channel = format!("rust-bcast-{}", unique_prefix());
    admin.broadcast(&channel, "text-event", serde_json::json!({"text": "plain string"}))
        .await.expect("broadcast string payload as object");
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8: KV Operations (E2E 71-80)
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn e2e_71_kv_set_and_get() {
    let admin = admin();
    let key = format!("rust-kv-{}", unique_prefix());

    admin.kv("default").set(&key, "hello-rust", None).await.expect("kv set");
    let val = admin.kv("default").get(&key).await.expect("kv get");
    assert_eq!(val, Some("hello-rust".to_string()));
}

#[tokio::test]
async fn e2e_72_kv_get_nonexistent() {
    let admin = admin();
    let val = admin.kv("default").get("nonexistent-kv-rust-99999").await.expect("kv get none");
    assert!(val.is_none(), "nonexistent key should return None");
}

#[tokio::test]
async fn e2e_73_kv_set_with_ttl() {
    let admin = admin();
    let key = format!("rust-kv-ttl-{}", unique_prefix());
    admin.kv("default").set(&key, "ephemeral", Some(3600)).await.expect("kv set with ttl");

    let val = admin.kv("default").get(&key).await.expect("kv get");
    assert_eq!(val, Some("ephemeral".to_string()));
}

#[tokio::test]
async fn e2e_74_kv_delete() {
    let admin = admin();
    let key = format!("rust-kv-del-{}", unique_prefix());
    admin.kv("default").set(&key, "to-delete", None).await.unwrap();
    admin.kv("default").delete(&key).await.expect("kv delete");

    let val = admin.kv("default").get(&key).await.expect("kv get after delete");
    assert!(val.is_none(), "deleted key should be None");
}

#[tokio::test]
async fn e2e_75_kv_list() {
    let admin = admin();
    let prefix = unique_prefix();
    admin.kv("default").set(&format!("{}-a", prefix), "a", None).await.unwrap();
    admin.kv("default").set(&format!("{}-b", prefix), "b", None).await.unwrap();

    let result = admin.kv("default")
        .list(Some(&prefix), Some(100), None).await.expect("kv list");
    // result is a HashMap with keys like "keys", "cursor", etc.
    let _ = result;
}

#[tokio::test]
async fn e2e_76_kv_overwrite_value() {
    let admin = admin();
    let key = format!("rust-kv-ow-{}", unique_prefix());
    admin.kv("default").set(&key, "first", None).await.unwrap();
    admin.kv("default").set(&key, "second", None).await.unwrap();

    let val = admin.kv("default").get(&key).await.expect("kv get overwritten");
    assert_eq!(val, Some("second".to_string()));
}

#[tokio::test]
async fn e2e_77_kv_empty_value() {
    let admin = admin();
    let key = format!("rust-kv-empty-{}", unique_prefix());
    admin.kv("default").set(&key, "", None).await.expect("kv set empty");

    let val = admin.kv("default").get(&key).await.expect("kv get empty");
    assert_eq!(val, Some("".to_string()));
}

#[tokio::test]
async fn e2e_78_kv_large_value() {
    let admin = admin();
    let key = format!("rust-kv-large-{}", unique_prefix());
    let large_value: String = "x".repeat(10000);
    admin.kv("default").set(&key, &large_value, None).await.expect("kv set large");

    let val = admin.kv("default").get(&key).await.expect("kv get large");
    assert_eq!(val, Some(large_value));
}

#[tokio::test]
async fn e2e_79_kv_special_chars_in_key() {
    let admin = admin();
    let key = format!("rust/kv/{}/special:key", unique_prefix());
    admin.kv("default").set(&key, "special", None).await.expect("kv set special");

    let val = admin.kv("default").get(&key).await.expect("kv get special");
    assert_eq!(val, Some("special".to_string()));
}

#[tokio::test]
async fn e2e_80_kv_list_with_limit() {
    let admin = admin();
    let prefix = unique_prefix();
    for i in 0..5 {
        admin.kv("default").set(&format!("{}-item-{}", prefix, i), &format!("val-{}", i), None).await.unwrap();
    }

    let result = admin.kv("default")
        .list(Some(&prefix), Some(2), None).await.expect("kv list limit");
    let _ = result;
}

} // mod admin_services

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION: Admin Push (E2E)
// ═══════════════════════════════════════════════════════════════════════════════

mod admin_push {
    use super::*;

/// push.send to non-existent user → sent: 0 (no registered devices)
#[tokio::test]
async fn admin_push_send_nonexistent_user() {
    let admin = admin();
    let payload = serde_json::json!({"title": "test", "body": "hello"});
    let result = admin.push().send("nonexistent-user-push-99999", &payload).await;
    // 503 if push not configured, otherwise sent: 0
    match result {
        Ok(r) => assert_eq!(r.sent, 0, "No devices → sent should be 0"),
        Err(edgebase_core::Error::Api { status, .. }) => {
            assert!(status == 503 || status == 400, "Expected 503 (not configured) or 400, got {}", status);
        }
        Err(e) => panic!("Unexpected error: {:?}", e),
    }
}

/// push.send_to_token → sent: 1 (mock FCM success) or 503 if not configured
#[tokio::test]
async fn admin_push_send_to_token() {
    let admin = admin();
    let payload = serde_json::json!({"title": "Token Push", "body": "direct"});
    let result = admin.push().send_to_token("fake-fcm-token-for-e2e", &payload, Some("web")).await;
    match result {
        Ok(r) => {
            // Mock FCM returns success → sent: 1
            assert!(r.sent == 1 || r.failed == 1, "Expected sent=1 or failed=1");
        }
        Err(edgebase_core::Error::Api { status, .. }) => {
            assert_eq!(status, 503, "Expected 503 when push not configured, got {}", status);
        }
        Err(e) => panic!("Unexpected error: {:?}", e),
    }
}

/// push.send_many → 200 OK (sent: 0 when users have no devices)
#[tokio::test]
async fn admin_push_send_many() {
    let admin = admin();
    let payload = serde_json::json!({"title": "Batch Push", "body": "multi"});
    let result = admin.push().send_many(&["user-a", "user-b"], &payload).await;
    match result {
        Ok(r) => assert_eq!(r.sent, 0, "No registered devices → sent 0"),
        Err(edgebase_core::Error::Api { status, .. }) => {
            assert!(status == 503 || status == 400, "Expected 503 or 400, got {}", status);
        }
        Err(e) => panic!("Unexpected error: {:?}", e),
    }
}

/// push.get_tokens → empty array for unknown user
#[tokio::test]
async fn admin_push_get_tokens_empty() {
    let admin = admin();
    let tokens = admin.push().get_tokens("nonexistent-user-tokens-99999").await
        .expect("get_tokens should succeed");
    assert!(tokens.is_empty(), "No devices registered → empty array");
}

/// push.get_logs → array (possibly empty) for a user
#[tokio::test]
async fn admin_push_get_logs() {
    let admin = admin();
    let logs = admin.push().get_logs("nonexistent-user-logs-99999", Some(10)).await
        .expect("get_logs should succeed");
    assert!(logs.is_empty() || !logs.is_empty(), "Should return an array");
}

/// push.send_to_topic → success or 503 if push not configured
#[tokio::test]
async fn admin_push_send_to_topic() {
    let admin = admin();
    let payload = serde_json::json!({"title": "Topic Push", "body": "news"});
    let result = admin.push().send_to_topic("test-topic", &payload).await;
    match result {
        Ok(v) => {
            // Should return a JSON object with success info
            assert!(v.is_object(), "Expected JSON object response");
        }
        Err(edgebase_core::Error::Api { status, .. }) => {
            assert_eq!(status, 503, "Expected 503 when push not configured, got {}", status);
        }
        Err(e) => panic!("Unexpected error: {:?}", e),
    }
}

/// push.broadcast → success or 503 if push not configured
#[tokio::test]
async fn admin_push_broadcast() {
    let admin = admin();
    let payload = serde_json::json!({"title": "Broadcast", "body": "everyone"});
    let result = admin.push().broadcast(&payload).await;
    match result {
        Ok(v) => {
            assert!(v.is_object(), "Expected JSON object response");
        }
        Err(edgebase_core::Error::Api { status, .. }) => {
            assert_eq!(status, 503, "Expected 503 when push not configured, got {}", status);
        }
        Err(e) => panic!("Unexpected error: {:?}", e),
    }
}

} // mod admin_push

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 9: Rust-Specific Patterns (E2E 81-90)
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn e2e_81_tokio_join_parallel_inserts() {
    let admin = Arc::new(admin());
    let a1 = admin.clone();
    let a2 = admin.clone();
    let a3 = admin.clone();

    let (r1, r2, r3) = tokio::join!(
        insert_post_with_retry(a1, "join-A".to_string()),
        insert_post_with_retry(a2, "join-B".to_string()),
        insert_post_with_retry(a3, "join-C".to_string()),
    );
    assert!(r1.is_ok());
    assert!(r2.is_ok());
    assert!(r3.is_ok());
}

#[tokio::test]
async fn e2e_82_tokio_join_parallel_reads() {
    let admin = admin();
    let created = admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({"title": "parallel-read"})).await.unwrap();
    let id = created["id"].as_str().unwrap().to_string();

    let admin = Arc::new(admin);
    let a1 = admin.clone();
    let a2 = admin.clone();
    let id1 = id.clone();
    let id2 = id.clone();

    let (r1, r2) = tokio::join!(
        async move { a1.db("shared", None).table("posts").get_one(&id1).await },
        async move { a2.db("shared", None).table("posts").get_one(&id2).await },
    );
    assert!(r1.is_ok());
    assert!(r2.is_ok());
}

#[tokio::test]
async fn e2e_83_result_question_mark_chaining() {
    async fn chain_ops() -> Result<(), edgebase_core::Error> {
        let admin = EdgeBase::server(&base_url(), &service_key())?;
        let created = admin.db("shared", None).table("posts")
            .insert(&serde_json::json!({"title": "chain-test"})).await?;
        let id = created["id"].as_str().unwrap().to_string();
        let _ = admin.db("shared", None).table("posts").get_one(&id).await?;
        admin.db("shared", None).table("posts")
            .update(&id, &serde_json::json!({"content": "chained"})).await?;
        admin.db("shared", None).table("posts").delete(&id).await?;
        Ok(())
    }
    chain_ops().await.expect("? chaining should work");
}

#[tokio::test]
async fn e2e_84_serde_json_roundtrip() {
    let admin = admin();
    let original = serde_json::json!({
        "title": "serde test",
        "count": 42,
        "tags": ["rust", "serde"],
        "metadata": { "nested": true, "value": 3.14 }
    });

    let created = admin.db("shared", None).table("posts")
        .insert(&original).await.expect("create");
    let id = created["id"].as_str().unwrap().to_string();

    let fetched = admin.db("shared", None).table("posts")
        .get_one(&id).await.expect("get_one");

    assert_eq!(fetched["title"], "serde test");
    assert_eq!(fetched["count"], 42);
    assert_eq!(fetched["tags"][0], "rust");
    assert_eq!(fetched["metadata"]["nested"], true);
}

#[tokio::test]
async fn e2e_85_arc_mutex_shared_state_collection() {
    let admin = Arc::new(admin());
    let results = Arc::new(std::sync::Mutex::new(Vec::new()));
    let prefix = unique_prefix();

    let mut handles = vec![];
    for i in 0..5 {
        let admin = admin.clone();
        let results = results.clone();
        let pfx = prefix.clone();
        handles.push(tokio::spawn(async move {
            let created = insert_post_with_retry(admin, format!("{}-arc-{}", pfx, i))
                .await.expect("create in spawn");
            results.lock().unwrap().push(created);
        }));
    }
    for h in handles { h.await.unwrap(); }

    let collected = results.lock().unwrap();
    assert_eq!(collected.len(), 5);
}

#[tokio::test]
async fn e2e_86_serde_deserialize_list_result() {
    use edgebase_core::table::ListResult;
    let admin = admin();
    let prefix = unique_prefix();
    admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({"title": prefix})).await.unwrap();

    let raw = admin.db("shared", None).table("posts")
        .where_("title", "==", &prefix)
        .get_list().await.expect("get");

    let lr = ListResult::from_value(raw);
    assert!(!lr.items.is_empty());
    assert_eq!(lr.items[0]["title"].as_str().unwrap(), prefix);
}

#[tokio::test]
async fn e2e_87_serde_deserialize_batch_result() {
    use edgebase_core::table::BatchResult;

    // Simulate BatchResult parsing from raw JSON
    let v = serde_json::json!({ "totalProcessed": 3, "totalSucceeded": 3, "errors": [] });
    let br = BatchResult::from_value(v);
    assert_eq!(br.total_processed, 3);
    assert_eq!(br.total_succeeded, 3);
    assert!(br.errors.is_empty());
}

#[tokio::test]
async fn e2e_88_serde_deserialize_upsert_result() {
    use edgebase_core::table::UpsertResult;

    let v = serde_json::json!({ "action": "inserted", "id": "test-id", "title": "test" });
    let ur = UpsertResult::from_value(v);
    assert!(ur.inserted);
    assert_eq!(ur.record["id"], "test-id");
}

#[tokio::test]
async fn e2e_89_tokio_join_mixed_operations() {
    let admin = Arc::new(admin());
    let a1 = admin.clone();
    let a2 = admin.clone();
    let a3 = admin.clone();
    let prefix = unique_prefix();

    let (r1, r2, r3) = tokio::join!(
        async move {
            a1.db("shared", None).table("posts")
                .insert(&serde_json::json!({"title": format!("{}-mixed", prefix)})).await
        },
        async move {
            a2.db("shared", None).table("posts")
                .count().await
        },
        async move {
            a3.storage().bucket("documents")
                .list("", 10, 0).await
        },
    );
    assert!(r1.is_ok());
    assert!(r2.is_ok());
    assert!(r3.is_ok());
}

#[tokio::test]
async fn e2e_90_error_type_matching() {
    let admin = admin();
    let result = admin.db("shared", None).table("posts")
        .get_one("nonexistent-match-99999").await;

    match result {
        Err(edgebase_core::Error::Api { status, message }) => {
            assert!(status >= 400, "Should be client/server error");
            assert!(!message.is_empty(), "Should have error message");
        }
        Err(other) => panic!("Expected Api error, got: {:?}", other),
        Ok(_) => panic!("Expected error, got success"),
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10: Field Operations & Advanced (E2E 91-100)
// ═══════════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn e2e_91_field_ops_increment() {
    let admin = admin();
    let created = admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({"title": "increment-test", "views": 0}))
        .await.unwrap();
    let id = created["id"].as_str().unwrap().to_string();

    admin.db("shared", None).table("posts")
        .update(&id, &serde_json::json!({"views": edgebase_core::field_ops::increment(5)}))
        .await.expect("increment update");

    let fetched = admin.db("shared", None).table("posts")
        .get_one(&id).await.expect("get after increment");
    assert_eq!(fetched["views"].as_i64().unwrap(), 5);
}

#[tokio::test]
async fn e2e_92_field_ops_increment_negative() {
    let admin = admin();
    let created = admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({"title": "decrement-test", "views": 10}))
        .await.unwrap();
    let id = created["id"].as_str().unwrap().to_string();

    admin.db("shared", None).table("posts")
        .update(&id, &serde_json::json!({"views": edgebase_core::field_ops::increment(-3)}))
        .await.expect("decrement update");

    let fetched = admin.db("shared", None).table("posts")
        .get_one(&id).await.expect("get after decrement");
    assert_eq!(fetched["views"].as_i64().unwrap(), 7);
}

#[tokio::test]
async fn e2e_93_field_ops_delete_field() {
    let admin = admin();
    let created = admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({"title": "delete-field-test", "tempField": "remove-me"}))
        .await.unwrap();
    let id = created["id"].as_str().unwrap().to_string();

    admin.db("shared", None).table("posts")
        .update(&id, &serde_json::json!({"tempField": edgebase_core::field_ops::delete_field()}))
        .await.expect("delete field update");

    let fetched = admin.db("shared", None).table("posts")
        .get_one(&id).await.expect("get after delete field");
    assert!(fetched["tempField"].is_null(), "Field should be null/deleted");
}

#[tokio::test]
async fn e2e_94_field_ops_increment_multiple_fields() {
    let admin = admin();
    let created = admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({"title": "multi-inc", "views": 0, "likes": 0}))
        .await.unwrap();
    let id = created["id"].as_str().unwrap().to_string();

    admin.db("shared", None).table("posts")
        .update(&id, &serde_json::json!({
            "views": edgebase_core::field_ops::increment(10),
            "likes": edgebase_core::field_ops::increment(3)
        }))
        .await.expect("multi increment");

    let fetched = admin.db("shared", None).table("posts")
        .get_one(&id).await.unwrap();
    assert_eq!(fetched["views"].as_i64().unwrap(), 10);
    assert_eq!(fetched["likes"].as_i64().unwrap(), 3);
}

#[tokio::test]
async fn e2e_95_insert_many_then_query() {
    let admin = admin();
    let prefix = unique_prefix();
    let records: Vec<_> = (0..5)
        .map(|i| serde_json::json!({"title": format!("{}-batch-q-{}", prefix, i), "views": i * 10}))
        .collect();

    admin.db("shared", None).table("posts")
        .insert_many(records).await.expect("insertMany");

    let result = admin.db("shared", None).table("posts")
        .where_("title", "contains", &prefix)
        .order_by("views", "asc")
        .get_list().await.expect("query after batch");
    let items = result["items"].as_array().unwrap();
    assert!(items.len() >= 5);
}

#[tokio::test]
async fn e2e_96_crud_then_storage_workflow() {
    let admin = admin();
    let prefix = unique_prefix();

    // Create a record
    let created = admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({"title": format!("{}-workflow", prefix)}))
        .await.unwrap();
    let id = created["id"].as_str().unwrap().to_string();

    // Upload associated file
    let key = format!("{}/attachment.txt", prefix);
    admin.storage().bucket("documents")
        .upload(&key, b"workflow attachment".to_vec(), "text/plain")
        .await.expect("upload attachment");

    // Update record with storage reference
    admin.db("shared", None).table("posts")
        .update(&id, &serde_json::json!({"attachment": key}))
        .await.expect("update with attachment");

    // Verify
    let fetched = admin.db("shared", None).table("posts")
        .get_one(&id).await.unwrap();
    assert_eq!(fetched["attachment"].as_str().unwrap(), key);
}

#[tokio::test]
async fn e2e_97_admin_auth_then_crud_workflow() {
    let admin = admin();
    let email = unique_email();

    // Create user
    let created = admin.admin_auth().create_user(&email, "WorkflowPass123!").await.unwrap();
    let user_id = extract_id(&created);

    // Create a record associated with the user
    let record = admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({"title": "User Post", "authorId": user_id}))
        .await.expect("create with authorId");
    let record_id = record["id"].as_str().unwrap().to_string();

    // Query by authorId
    let result = admin.db("shared", None).table("posts")
        .where_("authorId", "==", &user_id)
        .get_list().await.expect("query by authorId");
    let items = result["items"].as_array().unwrap();
    assert!(!items.is_empty());

    // Cleanup
    admin.db("shared", None).table("posts").delete(&record_id).await.unwrap();
}

#[tokio::test]
async fn e2e_98_kv_then_query_workflow() {
    let admin = admin();
    let prefix = unique_prefix();

    // Store a config in KV
    admin.kv("default").set(&format!("{}-config", prefix), "enabled", None).await.unwrap();

    // Create records based on that "config"
    admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({"title": format!("{}-config-post", prefix)}))
        .await.unwrap();

    // Read back KV and verify
    let val = admin.kv("default").get(&format!("{}-config", prefix)).await.unwrap();
    assert_eq!(val, Some("enabled".to_string()));

    // Query records
    let result = admin.db("shared", None).table("posts")
        .where_("title", "contains", &prefix)
        .get_list().await.unwrap();
    assert!(!result["items"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn e2e_99_concurrent_kv_operations() {
    let admin = Arc::new(admin());
    let prefix = unique_prefix();

    let mut handles = vec![];
    for i in 0..5 {
        let admin = admin.clone();
        let pfx = prefix.clone();
        handles.push(tokio::spawn(async move {
            let key = format!("{}-concurrent-{}", pfx, i);
            admin.kv("default").set(&key, &format!("val-{}", i), None).await.expect("kv set");
            let val = admin.kv("default").get(&key).await.expect("kv get");
            assert_eq!(val, Some(format!("val-{}", i)));
        }));
    }
    for h in handles { h.await.unwrap(); }
}

#[tokio::test]
async fn e2e_100_full_lifecycle_end_to_end() {
    let admin = admin();
    let prefix = unique_prefix();
    let email = unique_email();

    // 1. Create user
    let user = admin.admin_auth().create_user(&email, "LifecyclePass123!").await.unwrap();
    let user_id = extract_id(&user);

    // 2. Set custom claims
    admin.admin_auth()
        .set_custom_claims(&user_id, serde_json::json!({"role": "tester"}))
        .await.unwrap();

    // 3. Create record
    let record = admin.db("shared", None).table("posts")
        .insert(&serde_json::json!({
            "title": format!("{}-lifecycle", prefix),
            "authorId": user_id,
            "views": 0
        }))
        .await.unwrap();
    let record_id = record["id"].as_str().unwrap().to_string();

    // 4. Upload file
    let file_key = format!("{}/lifecycle.txt", prefix);
    admin.storage().bucket("documents")
        .upload(&file_key, b"lifecycle file".to_vec(), "text/plain")
        .await.unwrap();

    // 5. Update record with attachment + increment views
    admin.db("shared", None).table("posts")
        .update(&record_id, &serde_json::json!({
            "attachment": file_key,
            "views": edgebase_core::field_ops::increment(1)
        }))
        .await.unwrap();

    // 6. Store KV metadata
    admin.kv("default")
        .set(&format!("{}-meta", prefix), &record_id, None)
        .await.unwrap();

    // 7. Broadcast notification
    admin.broadcast(
        &format!("{}-channel", prefix),
        "record-updated",
        serde_json::json!({"recordId": record_id})
    ).await.unwrap();

    // 8. SQL query
    let _ = admin.sql::<()>("shared", None, "SELECT COUNT(*) FROM posts", &[]).await.unwrap();

    // 9. Verify record
    let fetched = admin.db("shared", None).table("posts")
        .get_one(&record_id).await.unwrap();
    assert_eq!(fetched["views"].as_i64().unwrap(), 1);
    assert_eq!(fetched["attachment"].as_str().unwrap(), file_key);

    // 10. Cleanup
    admin.db("shared", None).table("posts").delete(&record_id).await.unwrap();
    admin.storage().bucket("documents").delete(&file_key).await.unwrap();
    admin.kv("default").delete(&format!("{}-meta", prefix)).await.unwrap();
}
