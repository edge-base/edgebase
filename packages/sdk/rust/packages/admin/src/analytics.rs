use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use edgebase_core::error::Error;
use edgebase_core::generated::api_core::GeneratedDbApi;
use edgebase_core::http_client::HttpClient;
use serde_json::{json, Value};

use crate::generated::admin_api_core::GeneratedAdminApi;

pub struct AnalyticsClient {
    http: Arc<HttpClient>,
}

impl AnalyticsClient {
    pub(crate) fn new(http: Arc<HttpClient>) -> Self {
        Self { http }
    }

    pub async fn overview(&self, options: Option<HashMap<String, String>>) -> Result<Value, Error> {
        self.admin_core()
            .query_analytics(&self.build_query("overview", options))
            .await
    }

    pub async fn time_series(&self, options: Option<HashMap<String, String>>) -> Result<Vec<Value>, Error> {
        let result = self
            .admin_core()
            .query_analytics(&self.build_query("timeSeries", options))
            .await?;
        Ok(extract_list(&result, "timeSeries"))
    }

    pub async fn breakdown(&self, options: Option<HashMap<String, String>>) -> Result<Vec<Value>, Error> {
        let result = self
            .admin_core()
            .query_analytics(&self.build_query("breakdown", options))
            .await?;
        Ok(extract_list(&result, "breakdown"))
    }

    pub async fn top_endpoints(&self, options: Option<HashMap<String, String>>) -> Result<Vec<Value>, Error> {
        let result = self
            .admin_core()
            .query_analytics(&self.build_query("topEndpoints", options))
            .await?;
        Ok(extract_list(&result, "topItems"))
    }

    pub async fn track(
        &self,
        name: &str,
        properties: Option<Value>,
        user_id: Option<&str>,
    ) -> Result<(), Error> {
        let mut event = serde_json::Map::new();
        event.insert("name".to_string(), Value::String(name.to_string()));
        event.insert("timestamp".to_string(), json!(current_time_millis()));
        if let Some(props) = properties {
            event.insert("properties".to_string(), props);
        }
        if let Some(user) = user_id {
            event.insert("userId".to_string(), Value::String(user.to_string()));
        }
        self.track_batch(vec![Value::Object(event)]).await
    }

    pub async fn track_batch(&self, events: Vec<Value>) -> Result<(), Error> {
        if events.is_empty() {
            return Ok(());
        }

        let normalized = events
            .into_iter()
            .map(|event| {
                if let Value::Object(mut map) = event {
                    map.entry("timestamp".to_string())
                        .or_insert_with(|| json!(current_time_millis()));
                    Value::Object(map)
                } else {
                    event
                }
            })
            .collect::<Vec<_>>();

        self.core()
            .track_events(&json!({ "events": normalized }))
            .await?;
        Ok(())
    }

    pub async fn query_events(&self, options: Option<HashMap<String, String>>) -> Result<Value, Error> {
        let params = options.unwrap_or_default();
        self.admin_core().query_custom_events(&params).await
    }

    fn core(&self) -> GeneratedDbApi<'_> {
        GeneratedDbApi::new(&self.http)
    }

    fn admin_core(&self) -> GeneratedAdminApi<'_> {
        GeneratedAdminApi::new(&self.http)
    }

    fn build_query(&self, metric: &str, options: Option<HashMap<String, String>>) -> HashMap<String, String> {
        let mut query = HashMap::from([("metric".to_string(), metric.to_string())]);
        if let Some(options) = options {
            query.extend(options);
        }
        query
    }
}

fn extract_list(result: &Value, field: &str) -> Vec<Value> {
    result
        .get(field)
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default()
}

fn current_time_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}
