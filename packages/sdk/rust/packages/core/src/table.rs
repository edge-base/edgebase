//! EdgeBase Rust SDK — TableRef (immutable query builder)
//!
//! All HTTP calls delegate to Generated Core (api_core.rs).
//! No hardcoded API paths — the core is the single source of truth.

use crate::{Error, http_client::HttpClient};
use crate::generated::api_core::GeneratedDbApi;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;

type FilterTuple = (String, String, Value);

/// Unified list query result.
/// Returned by `TableRef::get_list()`.
#[derive(Debug, Clone)]
pub struct ListResult {
    pub items: Vec<Value>,
    pub total: Option<u64>,
    pub page: Option<u64>,
    pub per_page: Option<u64>,
    pub has_more: Option<bool>,
    pub cursor: Option<String>,
}

impl ListResult {
    pub fn from_value(v: Value) -> Self {
        let items = v.get("items")
            .and_then(|i| i.as_array())
            .cloned()
            .unwrap_or_default();
        Self {
            items,
            total: v.get("total").and_then(|t| t.as_u64()),
            page: v.get("page").and_then(|p| p.as_u64()),
            per_page: v.get("perPage").and_then(|p| p.as_u64()),
            has_more: v.get("hasMore").and_then(|h| h.as_bool()),
            cursor: v.get("cursor").and_then(|c| c.as_str()).map(|s| s.to_owned()),
        }
    }
}

/// Batch operation result.
#[derive(Debug, Clone)]
pub struct BatchResult {
    pub total_processed: u64,
    pub total_succeeded: u64,
    pub errors: Vec<Value>,
}

impl BatchResult {
    pub fn from_value(v: Value) -> Self {
        Self {
            total_processed: v.get("totalProcessed").and_then(|t| t.as_u64()).unwrap_or(0),
            total_succeeded: v.get("totalSucceeded").and_then(|t| t.as_u64()).unwrap_or(0),
            errors: v.get("errors")
                .and_then(|e| e.as_array())
                .cloned()
                .unwrap_or_default(),
        }
    }
}

/// Upsert operation result.
#[derive(Debug, Clone)]
pub struct UpsertResult {
    pub record: Value,
    pub inserted: bool,
}

impl UpsertResult {
    pub fn from_value(v: Value) -> Self {
        let inserted = v.get("action").and_then(|a| a.as_str()) == Some("inserted");
        Self { record: v, inserted }
    }
}

// ── Core dispatch helpers ────────────────────────────────────────────
// These mirror the JS SDK pattern: dispatch to single-instance vs dynamic based on instance_id.

/// Dispatch a GET-style table operation (list, get, count, search) to the correct generated core method.
async fn core_get(
    core: &GeneratedDbApi<'_>,
    method: &str,
    namespace: &str,
    instance_id: Option<&str>,
    table: &str,
    id: Option<&str>,
    query: &HashMap<String, String>,
) -> Result<Value, Error> {
    match instance_id {
        Some(iid) => {
            // Dynamic DB
            match method {
                "list" => core.db_list_records(namespace, iid, table, query).await,
                "get" => core.db_get_record(namespace, iid, table, id.unwrap(), query).await,
                "count" => core.db_count_records(namespace, iid, table, query).await,
                "search" => core.db_search_records(namespace, iid, table, query).await,
                _ => unreachable!("unknown core_get method: {}", method),
            }
        }
        None => {
            // Single-instance DB
            match method {
                "list" => core.db_single_list_records(namespace, table, query).await,
                "get" => core.db_single_get_record(namespace, table, id.unwrap(), query).await,
                "count" => core.db_single_count_records(namespace, table, query).await,
                "search" => core.db_single_search_records(namespace, table, query).await,
                _ => unreachable!("unknown core_get method: {}", method),
            }
        }
    }
}

/// Dispatch an insert to the correct generated core method.
async fn core_insert(
    core: &GeneratedDbApi<'_>,
    namespace: &str,
    instance_id: Option<&str>,
    table: &str,
    body: &Value,
    query: &HashMap<String, String>,
) -> Result<Value, Error> {
    match instance_id {
        Some(iid) => core.db_insert_record(namespace, iid, table, body, query).await,
        None => core.db_single_insert_record(namespace, table, body, query).await,
    }
}

/// Dispatch an update to the correct generated core method.
async fn core_update(
    core: &GeneratedDbApi<'_>,
    namespace: &str,
    instance_id: Option<&str>,
    table: &str,
    id: &str,
    body: &Value,
) -> Result<Value, Error> {
    match instance_id {
        Some(iid) => core.db_update_record(namespace, iid, table, id, body).await,
        None => core.db_single_update_record(namespace, table, id, body).await,
    }
}

/// Dispatch a delete to the correct generated core method.
async fn core_delete(
    core: &GeneratedDbApi<'_>,
    namespace: &str,
    instance_id: Option<&str>,
    table: &str,
    id: &str,
) -> Result<Value, Error> {
    match instance_id {
        Some(iid) => core.db_delete_record(namespace, iid, table, id).await,
        None => core.db_single_delete_record(namespace, table, id).await,
    }
}

/// Dispatch a batch insert to the correct generated core method.
async fn core_batch(
    core: &GeneratedDbApi<'_>,
    namespace: &str,
    instance_id: Option<&str>,
    table: &str,
    body: &Value,
    query: &HashMap<String, String>,
) -> Result<Value, Error> {
    match instance_id {
        Some(iid) => core.db_batch_records(namespace, iid, table, body, query).await,
        None => core.db_single_batch_records(namespace, table, body, query).await,
    }
}

/// Dispatch a batch-by-filter to the correct generated core method.
async fn core_batch_by_filter(
    core: &GeneratedDbApi<'_>,
    namespace: &str,
    instance_id: Option<&str>,
    table: &str,
    body: &Value,
    query: &HashMap<String, String>,
) -> Result<Value, Error> {
    match instance_id {
        Some(iid) => core.db_batch_by_filter(namespace, iid, table, body, query).await,
        None => core.db_single_batch_by_filter(namespace, table, body, query).await,
    }
}

/// Immutable query builder for a EdgeBase table.
///
/// ```rust,no_run,ignore,no_run
/// # async fn example(client: &edgebase_core::EdgeBase) -> Result<(), edgebase_core::Error> {
/// let result = client.table("posts")
///     .where_("status", "==", "published")
///     .or_(|q| q.where_("status", "==", "draft"))
///     .order_by("createdAt", "desc")
///     .limit(20)
///     .get_list()
///     .await?;
/// # Ok(())
/// # }
/// ```
#[derive(Clone)]
pub struct TableRef {
    http: Arc<HttpClient>,
    name: String,
    /// DB block namespace: 'shared' | 'workspace' | 'user' | ...
    namespace: String,
    /// DB instance ID for dynamic DOs (e.g. 'ws-456'). None for static DBs.
    instance_id: Option<String>,
    filters: Vec<FilterTuple>,
    or_filters: Vec<FilterTuple>,
    sorts: Vec<[String; 2]>,
    limit_val: Option<u32>,
    offset_val: Option<u32>,
    page_val: Option<u32>,
    search_val: Option<String>,
    after_val: Option<String>,
    before_val: Option<String>,
}

pub struct OrBuilder {
    pub filters: Vec<FilterTuple>,
}

impl OrBuilder {
    pub fn new() -> Self {
        Self { filters: vec![] }
    }

    pub fn where_<V: Serialize>(mut self, field: &str, op: &str, value: V) -> Self {
        self.filters.push((
            field.into(),
            op.into(),
            serde_json::to_value(value).unwrap_or(Value::Null),
        ));
        self
    }
}

impl TableRef {
    pub fn new(http: Arc<HttpClient>, name: &str) -> Self {
        Self::with_db(http, name, "shared", None)
    }

    /// Create a TableRef for a specific DB namespace + optional instance ID.
    pub fn with_db(http: Arc<HttpClient>, name: &str, namespace: &str, instance_id: Option<&str>) -> Self {
        Self {
            http,
            name: name.to_string(),
            namespace: namespace.to_string(),
            instance_id: instance_id.map(|s| s.to_string()),
            filters: vec![],
            or_filters: vec![],
            sorts: vec![],
            limit_val: None,
            offset_val: None,
            page_val: None,
            search_val: None,
            after_val: None,
            before_val: None,
        }
    }

    // ── Query Builder ────────────────────────────────────────────

    pub fn where_<V: Serialize>(self, field: &str, op: &str, value: V) -> Self {
        let mut c = self;
        c.filters.push((
            field.into(),
            op.into(),
            serde_json::to_value(value).unwrap_or(Value::Null),
        ));
        c
    }

    pub fn or_(self, builder_fn: impl FnOnce(OrBuilder) -> OrBuilder) -> Self {
        let mut c = self;
        let builder = builder_fn(OrBuilder::new());
        c.or_filters.extend(builder.filters);
        c
    }

    pub fn order_by(self, field: &str, direction: &str) -> Self {
        let mut c = self;
        c.sorts.push([field.into(), direction.into()]);
        c
    }

    pub fn limit(mut self, n: u32) -> Self { self.limit_val = Some(n); self }
    pub fn offset(mut self, n: u32) -> Self { self.offset_val = Some(n); self }
    pub fn page(mut self, n: u32) -> Self { self.page_val = Some(n); self }
    pub fn search(mut self, q: &str) -> Self { self.search_val = Some(q.into()); self }
    pub fn after(mut self, cursor: &str) -> Self { self.after_val = Some(cursor.into()); self }
    pub fn before(mut self, cursor: &str) -> Self { self.before_val = Some(cursor.into()); self }

    /// Collection name.
    pub fn name(&self) -> &str { &self.name }

    /// Create a temporary GeneratedDbApi for dispatching calls.
    fn core(&self) -> GeneratedDbApi<'_> {
        GeneratedDbApi::new(&self.http)
    }

    fn validate_query_state(&self) -> Result<(), Error> {
        let has_cursor = self.after_val.is_some() || self.before_val.is_some();
        let has_offset = self.offset_val.is_some() || self.page_val.is_some();
        if has_cursor && has_offset {
            return Err(Error::Api {
                status: 400,
                message: "Cannot use page()/offset() with after()/before() — choose offset or cursor pagination".to_string(),
            });
        }
        Ok(())
    }

    /// Instance ID as an Option<&str> for dispatch helpers.
    fn iid(&self) -> Option<&str> {
        self.instance_id.as_deref()
    }

    /// Build query parameters from current state as a HashMap.
    fn build_query_params(&self) -> HashMap<String, String> {
        let mut params = HashMap::new();
        if !self.filters.is_empty() {
            params.insert("filter".to_string(), serde_json::to_string(&self.filters).unwrap_or_default());
        }
        if !self.or_filters.is_empty() {
            params.insert("orFilter".to_string(), serde_json::to_string(&self.or_filters).unwrap_or_default());
        }
        if !self.sorts.is_empty() {
            let sort_str = self.sorts.iter()
                .map(|s| format!("{}:{}", s[0], s[1]))
                .collect::<Vec<_>>()
                .join(",");
            params.insert("sort".to_string(), sort_str);
        }
        if let Some(v) = self.limit_val   { params.insert("limit".to_string(), v.to_string()); }
        if let Some(v) = self.offset_val  { params.insert("offset".to_string(), v.to_string()); }
        if let Some(v) = self.page_val    { params.insert("page".to_string(), v.to_string()); }
        if let Some(ref v) = self.search_val { params.insert("search".to_string(), v.clone()); }
        if let Some(ref v) = self.after_val  { params.insert("after".to_string(), v.clone()); }
        if let Some(ref v) = self.before_val { params.insert("before".to_string(), v.clone()); }
        params
    }

    // ── CRUD ─────────────────────────────────────────────────────

    /// List documents matching current filters/sorts.
    pub async fn get_list(&self) -> Result<Value, Error> {
        self.validate_query_state()?;
        let query = self.build_query_params();
        let core = self.core();
        if self.search_val.is_some() {
            core_get(&core, "search", &self.namespace, self.iid(), &self.name, None, &query).await
        } else {
            core_get(&core, "list", &self.namespace, self.iid(), &self.name, None, &query).await
        }
    }

    /// Get the first record matching the current query conditions.
    /// Returns `Ok(Value::Null)` if no records match.
    pub async fn get_first(&self) -> Result<Value, Error> {
        let result = self.clone().limit(1).get_list().await?;
        let items = result.get("items").and_then(|i| i.as_array());
        match items.and_then(|arr| arr.first()) {
            Some(item) => Ok(item.clone()),
            None => Ok(Value::Null),
        }
    }

    /// Execute admin SQL scoped to this table's database namespace.
    pub async fn sql(&self, query: &str, params: &[Value]) -> Result<Vec<Value>, Error> {
        let mut body = json!({
            "namespace": self.namespace,
            "sql": query,
            "params": params,
        });
        if let Some(instance_id) = self.iid() {
            body["id"] = json!(instance_id);
        }
        let result = self.http.post("/api/sql", &body).await?;
        Ok(result
            .get("items")
            .and_then(|items| items.as_array())
            .cloned()
            .unwrap_or_default())
    }

    /// Fetch a single document by ID.
    pub async fn get_one(&self, id: &str) -> Result<Value, Error> {
        let core = self.core();
        let query = HashMap::new();
        core_get(&core, "get", &self.namespace, self.iid(), &self.name, Some(id), &query).await
    }

    /// Create a new document.
    pub async fn insert(&self, record: &Value) -> Result<Value, Error> {
        let core = self.core();
        let query = HashMap::new();
        core_insert(&core, &self.namespace, self.iid(), &self.name, record, &query).await
    }

    /// Update a document by ID.
    pub async fn update(&self, id: &str, data: &Value) -> Result<Value, Error> {
        let core = self.core();
        core_update(&core, &self.namespace, self.iid(), &self.name, id, data).await
    }

    /// Delete a document by ID.
    pub async fn delete(&self, id: &str) -> Result<Value, Error> {
        let core = self.core();
        core_delete(&core, &self.namespace, self.iid(), &self.name, id).await
    }

    /// Create or update a document.
    pub async fn upsert(&self, record: &Value, conflict_target: Option<&str>) -> Result<Value, Error> {
        let core = self.core();
        let mut query = HashMap::new();
        query.insert("upsert".to_string(), "true".to_string());
        if let Some(ct) = conflict_target {
            query.insert("conflictTarget".to_string(), ct.to_string());
        }
        core_insert(&core, &self.namespace, self.iid(), &self.name, record, &query).await
    }

    /// Count documents matching current filters.
    pub async fn count(&self) -> Result<u64, Error> {
        self.validate_query_state()?;
        let query = self.build_query_params();
        let core = self.core();
        let result = core_get(&core, "count", &self.namespace, self.iid(), &self.name, None, &query).await?;
        Ok(result.get("total").and_then(|v| v.as_u64()).unwrap_or(0))
    }

    // ── Batch ────────────────────────────────────────────────────

    /// Create multiple documents in server-side batches.
    pub async fn insert_many(&self, records: Vec<Value>) -> Result<Value, Error> {
        let core = self.core();
        let query = HashMap::new();
        if records.len() <= 500 {
            let body = json!({ "inserts": records });
            return core_batch(&core, &self.namespace, self.iid(), &self.name, &body, &query).await;
        }

        let mut inserted = Vec::new();
        for chunk in records.chunks(500) {
            let body = json!({ "inserts": chunk });
            let result = core_batch(&core, &self.namespace, self.iid(), &self.name, &body, &query).await?;
            inserted.extend(
                result
                    .get("inserted")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default(),
            );
        }
        Ok(json!({ "inserted": inserted }))
    }

    /// Upsert multiple documents in server-side batches.
    pub async fn upsert_many(&self, records: Vec<Value>, conflict_target: Option<&str>) -> Result<Value, Error> {
        let core = self.core();
        let mut query = HashMap::new();
        query.insert("upsert".to_string(), "true".to_string());
        if let Some(ct) = conflict_target {
            query.insert("conflictTarget".to_string(), ct.to_string());
        }
        if records.len() <= 500 {
            let body = json!({ "inserts": records });
            return core_batch(&core, &self.namespace, self.iid(), &self.name, &body, &query).await;
        }

        let mut inserted = Vec::new();
        for chunk in records.chunks(500) {
            let body = json!({ "inserts": chunk });
            let result = core_batch(&core, &self.namespace, self.iid(), &self.name, &body, &query).await?;
            inserted.extend(
                result
                    .get("inserted")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default(),
            );
        }
        Ok(json!({ "inserted": inserted }))
    }

    /// Update all documents matching current filters.
    pub async fn update_many(&self, update: &Value) -> Result<Value, Error> {
        if self.filters.is_empty() {
            return Err(Error::Api {
                status: 400,
                message: "update_many requires at least one where() filter".to_string(),
            });
        }
        let core = self.core();
        let mut body = json!({
            "action": "update",
            "filter": self.filters,
            "update": update
        });
        if !self.or_filters.is_empty() {
            body.as_object_mut().unwrap().insert("orFilter".to_string(), json!(self.or_filters));
        }
        let query = HashMap::new();
        core_batch_by_filter(&core, &self.namespace, self.iid(), &self.name, &body, &query).await
    }

    /// Delete all documents matching current filters.
    pub async fn delete_many(&self) -> Result<Value, Error> {
        if self.filters.is_empty() {
            return Err(Error::Api {
                status: 400,
                message: "delete_many requires at least one where() filter".to_string(),
            });
        }
        let core = self.core();
        let mut body = json!({
            "action": "delete",
            "filter": self.filters
        });
        if !self.or_filters.is_empty() {
            body.as_object_mut().unwrap().insert("orFilter".to_string(), json!(self.or_filters));
        }
        let query = HashMap::new();
        core_batch_by_filter(&core, &self.namespace, self.iid(), &self.name, &body, &query).await
    }

    /// Returns a document-scoped helper for record operations by id.
    pub fn doc(&self, id: &str) -> DocRef {
        DocRef {
            table: self.clone(),
            id: id.to_string(),
        }
    }
}

#[derive(Clone)]
pub struct DocRef {
    table: TableRef,
    id: String,
}

impl DocRef {
    pub async fn get(&self) -> Result<Value, Error> {
        self.table.get_one(&self.id).await
    }

    pub async fn update(&self, data: &Value) -> Result<Value, Error> {
        self.table.update(&self.id, data).await
    }

    pub async fn delete(&self) -> Result<Value, Error> {
        self.table.delete(&self.id).await
    }
}
