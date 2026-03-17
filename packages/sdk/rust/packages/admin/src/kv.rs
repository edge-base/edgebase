//! KvClient — KV namespace access for server-side use.

use std::collections::HashMap;
use std::sync::Arc;

use serde_json::Value;

use crate::generated::admin_api_core::GeneratedAdminApi;
use edgebase_core::error::Error;
use edgebase_core::http_client::HttpClient;

/// Client for a user-defined KV namespace.
pub struct KvClient {
    http: Arc<HttpClient>,
    pub(crate) namespace: String,
}

impl KvClient {
    pub(crate) fn new(http: Arc<HttpClient>, namespace: &str) -> Self {
        Self {
            http,
            namespace: namespace.to_string(),
        }
    }

    fn core(&self) -> GeneratedAdminApi<'_> {
        GeneratedAdminApi::new(&self.http)
    }

    /// Get a value by key. Returns None if not found.
    pub async fn get(&self, key: &str) -> Result<Option<String>, Error> {
        let body = serde_json::json!({"action": "get", "key": key});
        let res: serde_json::Value = self.core().kv_operation(&self.namespace, &body).await?;
        Ok(res.get("value").and_then(|v: &serde_json::Value| v.as_str()).map(|s: &str| s.to_string()))
    }

    /// Set a key-value pair with optional TTL in seconds.
    pub async fn set(&self, key: &str, value: &str, ttl: Option<u64>) -> Result<(), Error> {
        let mut body = serde_json::json!({"action": "set", "key": key, "value": value});
        if let Some(t) = ttl {
            body["ttl"] = serde_json::json!(t);
        }
        self.core().kv_operation(&self.namespace, &body).await?;
        Ok(())
    }

    /// Delete a key.
    pub async fn delete(&self, key: &str) -> Result<(), Error> {
        let body = serde_json::json!({"action": "delete", "key": key});
        self.core().kv_operation(&self.namespace, &body).await?;
        Ok(())
    }

    /// List keys with optional prefix, limit, and cursor.
    pub async fn list(
        &self,
        prefix: Option<&str>,
        limit: Option<u32>,
        cursor: Option<&str>,
    ) -> Result<HashMap<String, Value>, Error> {
        let mut body = serde_json::json!({"action": "list"});
        if let Some(p) = prefix { body["prefix"] = serde_json::json!(p); }
        if let Some(l) = limit { body["limit"] = serde_json::json!(l); }
        if let Some(c) = cursor { body["cursor"] = serde_json::json!(c); }
        let res: serde_json::Value = self.core().kv_operation(&self.namespace, &body).await?;
        if let Some(obj) = res.as_object() {
            Ok(obj.iter().map(|(k, v): (&String, &serde_json::Value)| (k.clone(), v.clone())).collect())
        } else {
            Ok(HashMap::new())
        }
    }
}
