use edgebase_core::http_client::HttpClient;
use edgebase_core::table::TableRef;
use edgebase_core::storage::StorageClient;
use edgebase_core::Error;
use crate::generated::admin_api_core::GeneratedAdminApi;
use crate::admin_auth::AdminAuthClient;
use crate::analytics::AnalyticsClient;
use crate::kv::KvClient;
use crate::d1::D1Client;
use crate::functions::FunctionsClient;
use crate::vectorize::VectorizeClient;
use crate::push::PushClient;
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;

/// DB namespace block reference for table access (#133 §2).
pub struct DbRef {
    http: Arc<HttpClient>,
    ns: String,
    instance_id: Option<String>,
}

impl DbRef {
    /// Get a [TableRef] for the named table.
    pub fn table(&self, name: &str) -> TableRef {
        TableRef::with_db(Arc::clone(&self.http), name, &self.ns, self.instance_id.as_deref())
    }
}


/// Server-side EdgeBase client — requires Service Key.
pub struct EdgeBase {
    http: Arc<HttpClient>,
}

impl EdgeBase {
    /// Create a server-side SDK instance.
    pub fn server(base_url: &str, service_key: &str) -> Result<Self, Error> {
        let http = HttpClient::new(base_url, service_key)?;
        Ok(Self { http: Arc::new(http) })
    }

    /// Admin Auth operations (create/get/list/delete users).
    pub fn admin_auth(&self) -> AdminAuthClient {
        AdminAuthClient::new(Arc::clone(&self.http))
    }

    /// Select a DB block by namespace and optional instance ID (#133 §2).
    pub fn db(&self, ns: &str, instance_id: Option<&str>) -> DbRef {
        DbRef {
            http: Arc::clone(&self.http),
            ns: ns.to_string(),
            instance_id: instance_id.map(|s| s.to_string()),
        }
    }

    /// Storage operations.
    pub fn storage(&self) -> StorageClient {
        StorageClient::new(Arc::clone(&self.http))
    }

    /// Access a user-defined KV namespace.
    pub fn kv(&self, namespace: &str) -> KvClient {
        KvClient::new(Arc::clone(&self.http), namespace)
    }

    /// Access a user-defined D1 database.
    pub fn d1(&self, database: &str) -> D1Client {
        D1Client::new(Arc::clone(&self.http), database)
    }

    /// Access a user-defined Vectorize index.
    pub fn vector(&self, index: &str) -> VectorizeClient {
        VectorizeClient::new(Arc::clone(&self.http), index)
    }

    /// Push notification management.
    pub fn push(&self) -> PushClient {
        PushClient::new(Arc::clone(&self.http))
    }

    /// Call app functions with the admin service key.
    pub fn functions(&self) -> FunctionsClient {
        FunctionsClient::new(Arc::clone(&self.http))
    }

    /// Query analytics metrics and track custom events.
    pub fn analytics(&self) -> AnalyticsClient {
        AnalyticsClient::new(Arc::clone(&self.http))
    }

    fn core(&self) -> GeneratedAdminApi<'_> {
        GeneratedAdminApi::new(&self.http)
    }

    /// Raw SQL query     /// namespace: DB namespace ('shared' | 'workspace' | ...), id: instance ID for dynamic DOs.
    pub async fn sql<T: Serialize>(&self, namespace: &str, id: Option<&str>, query: &str, params: &[T]) -> Result<Value, Error> {
        if query.trim().is_empty() {
            return Err(Error::Api {
                status: 400,
                message: "Invalid sql() signature: query must be a non-empty string".to_string(),
            });
        }

        let serialized_params = serde_json::to_value(params)?;
        let mut body = serde_json::json!({
            "namespace": namespace,
            "sql": query,
            "params": serialized_params,
        });
        if let Some(id_val) = id {
            body["id"] = serde_json::Value::String(id_val.to_string());
        }
        self.core().execute_sql(&body).await
    }

    /// Server-side broadcast to a database-live channel.
    pub async fn broadcast(&self, channel: &str, event: &str, payload: Value) -> Result<Value, Error> {
        let body = serde_json::json!({
            "channel": channel,
            "event": event,
            "payload": payload,
        });
        self.core().database_live_broadcast(&body).await
    }

}
