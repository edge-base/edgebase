//! D1Client — D1 database access for server-side use.

use std::collections::HashMap;
use std::sync::Arc;

use serde_json::Value;

use crate::generated::admin_api_core::GeneratedAdminApi;
use edgebase_core::error::Error;
use edgebase_core::http_client::HttpClient;

/// Client for a user-defined D1 database.
pub struct D1Client {
    http: Arc<HttpClient>,
    pub(crate) database: String,
}

impl D1Client {
    pub(crate) fn new(http: Arc<HttpClient>, database: &str) -> Self {
        Self {
            http,
            database: database.to_string(),
        }
    }

    fn core(&self) -> GeneratedAdminApi<'_> {
        GeneratedAdminApi::new(&self.http)
    }

    /// Execute a SQL query. Use ? placeholders for bind parameters.
    /// All SQL is allowed (DDL included).
    pub async fn exec(&self, query: &str, params: &[Value]) -> Result<Vec<HashMap<String, Value>>, Error> {
        let body = serde_json::json!({
            "query": query,
            "params": params,
        });
        let res: serde_json::Value = self.core().execute_d1_query(&self.database, &body).await?;
        if let Some(results) = res.get("results").and_then(|v: &serde_json::Value| v.as_array()) {
            Ok(results
                .iter()
                .filter_map(|v: &serde_json::Value| {
                    v.as_object()
                        .map(|o: &serde_json::Map<String, serde_json::Value>| o.iter().map(|(k, v): (&String, &serde_json::Value)| (k.clone(), v.clone())).collect::<HashMap<String, serde_json::Value>>())
                })
                .collect())
        } else {
            Ok(vec![])
        }
    }

    /// Alias for exec() to match SDK parity across runtimes.
    pub async fn query(&self, query: &str, params: &[Value]) -> Result<Vec<HashMap<String, Value>>, Error> {
        self.exec(query, params).await
    }
}
