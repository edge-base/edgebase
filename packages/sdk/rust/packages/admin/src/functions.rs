use std::collections::HashMap;
use std::sync::Arc;

use edgebase_core::error::Error;
use edgebase_core::http_client::HttpClient;
use serde_json::Value;

pub struct FunctionsClient {
    http: Arc<HttpClient>,
}

impl FunctionsClient {
    pub(crate) fn new(http: Arc<HttpClient>) -> Self {
        Self { http }
    }

    pub async fn call(
        &self,
        path: &str,
        method: &str,
        body: Option<&Value>,
        query: Option<&HashMap<String, String>>,
    ) -> Result<Value, Error> {
        let normalized_path = format!("/api/functions/{}", path.trim_start_matches('/'));

        match method.to_uppercase().as_str() {
            "GET" => {
                let params = query.cloned().unwrap_or_default();
                self.http.get_with_query(&normalized_path, &params).await
            }
            "PUT" => self.http.put(&normalized_path, body.unwrap_or(&Value::Null)).await,
            "PATCH" => self.http.patch(&normalized_path, body.unwrap_or(&Value::Null)).await,
            "DELETE" => self.http.delete(&normalized_path).await,
            _ => self.http.post(&normalized_path, body.unwrap_or(&Value::Null)).await,
        }
    }

    pub async fn get(&self, path: &str, query: Option<&HashMap<String, String>>) -> Result<Value, Error> {
        self.call(path, "GET", None, query).await
    }

    pub async fn post(&self, path: &str, body: Option<&Value>) -> Result<Value, Error> {
        self.call(path, "POST", body, None).await
    }

    pub async fn put(&self, path: &str, body: Option<&Value>) -> Result<Value, Error> {
        self.call(path, "PUT", body, None).await
    }

    pub async fn patch(&self, path: &str, body: Option<&Value>) -> Result<Value, Error> {
        self.call(path, "PATCH", body, None).await
    }

    pub async fn delete(&self, path: &str) -> Result<Value, Error> {
        self.call(path, "DELETE", None, None).await
    }
}
