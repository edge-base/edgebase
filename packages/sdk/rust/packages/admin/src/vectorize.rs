//! VectorizeClient — Vectorize index access for server-side use.
//! Note: Vectorize is Edge-only. In local/Docker, the server returns stub responses.

use std::collections::HashMap;
use std::sync::Arc;

use serde_json::Value;

use crate::generated::admin_api_core::GeneratedAdminApi;
use edgebase_core::error::Error;
use edgebase_core::http_client::HttpClient;

/// Client for a user-defined Vectorize index.
pub struct VectorizeClient {
    http: Arc<HttpClient>,
    pub(crate) index: String,
}

impl VectorizeClient {
    pub(crate) fn new(http: Arc<HttpClient>, index: &str) -> Self {
        Self {
            http,
            index: index.to_string(),
        }
    }

    fn core(&self) -> GeneratedAdminApi<'_> {
        GeneratedAdminApi::new(&self.http)
    }

    /// Insert or update vectors.
    /// Returns mutation result with `ok`, optional `count` and `mutationId`.
    pub async fn upsert(&self, vectors: &[Value]) -> Result<Value, Error> {
        let body = serde_json::json!({"action": "upsert", "vectors": vectors});
        self.core().vectorize_operation(&self.index, &body).await
    }

    /// Insert vectors (errors on duplicate ID — server returns 409).
    /// Returns mutation result with `ok`, optional `count` and `mutationId`.
    pub async fn insert(&self, vectors: &[Value]) -> Result<Value, Error> {
        let body = serde_json::json!({"action": "insert", "vectors": vectors});
        self.core().vectorize_operation(&self.index, &body).await
    }

    /// Search for similar vectors.
    pub async fn search(
        &self,
        vector: &[f64],
        top_k: usize,
        filter: Option<&Value>,
        namespace: Option<&str>,
        return_values: Option<bool>,
        return_metadata: Option<&str>,
    ) -> Result<Vec<HashMap<String, Value>>, Error> {
        let mut body = serde_json::json!({
            "action": "search",
            "vector": vector,
            "topK": top_k,
        });
        if let Some(f) = filter {
            body["filter"] = f.clone();
        }
        if let Some(ns) = namespace {
            body["namespace"] = serde_json::json!(ns);
        }
        if let Some(rv) = return_values {
            body["returnValues"] = serde_json::json!(rv);
        }
        if let Some(rm) = return_metadata {
            body["returnMetadata"] = serde_json::json!(rm);
        }
        let res: Value = self.core().vectorize_operation(&self.index, &body).await?;
        extract_matches(&res)
    }

    /// Search by an existing vector's ID (Vectorize v2 only).
    pub async fn query_by_id(
        &self,
        vector_id: &str,
        top_k: usize,
        filter: Option<&Value>,
        namespace: Option<&str>,
        return_values: Option<bool>,
        return_metadata: Option<&str>,
    ) -> Result<Vec<HashMap<String, Value>>, Error> {
        let mut body = serde_json::json!({
            "action": "queryById",
            "vectorId": vector_id,
            "topK": top_k,
        });
        if let Some(f) = filter {
            body["filter"] = f.clone();
        }
        if let Some(ns) = namespace {
            body["namespace"] = serde_json::json!(ns);
        }
        if let Some(rv) = return_values {
            body["returnValues"] = serde_json::json!(rv);
        }
        if let Some(rm) = return_metadata {
            body["returnMetadata"] = serde_json::json!(rm);
        }
        let res: Value = self.core().vectorize_operation(&self.index, &body).await?;
        extract_matches(&res)
    }

    /// Retrieve vectors by their IDs.
    pub async fn get_by_ids(&self, ids: &[&str]) -> Result<Vec<HashMap<String, Value>>, Error> {
        let body = serde_json::json!({"action": "getByIds", "ids": ids});
        let res: Value = self.core().vectorize_operation(&self.index, &body).await?;
        if let Some(vectors) = res.get("vectors").and_then(|v| v.as_array()) {
            Ok(vectors
                .iter()
                .filter_map(|v| {
                    v.as_object()
                        .map(|o| o.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
                })
                .collect())
        } else {
            Ok(vec![])
        }
    }

    /// Delete vectors by IDs.
    /// Returns mutation result with `ok`, optional `count` and `mutationId`.
    pub async fn delete(&self, ids: &[&str]) -> Result<Value, Error> {
        let body = serde_json::json!({"action": "delete", "ids": ids});
        self.core().vectorize_operation(&self.index, &body).await
    }

    /// Get index info (vector count, dimensions, metric).
    pub async fn describe(&self) -> Result<Value, Error> {
        let body = serde_json::json!({"action": "describe"});
        self.core().vectorize_operation(&self.index, &body).await
    }
}

fn extract_matches(res: &Value) -> Result<Vec<HashMap<String, Value>>, Error> {
    if let Some(matches) = res.get("matches").and_then(|v| v.as_array()) {
        Ok(matches
            .iter()
            .filter_map(|v| {
                v.as_object()
                    .map(|o| o.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
            })
            .collect())
    } else {
        Ok(vec![])
    }
}
