//! PushClient — Push notification management for Admin SDK.

use std::sync::Arc;

use serde_json::Value;

use crate::generated::admin_api_core::GeneratedAdminApi;
use edgebase_core::error::Error;
use edgebase_core::http_client::HttpClient;

/// Result of a push send operation.
#[derive(Debug, Default)]
pub struct PushResult {
    pub sent: i64,
    pub failed: i64,
    pub removed: i64,
}

/// Client for push notification operations.
pub struct PushClient {
    http: Arc<HttpClient>,
}

impl PushClient {
    pub(crate) fn new(http: Arc<HttpClient>) -> Self {
        Self { http }
    }

    fn core(&self) -> GeneratedAdminApi<'_> {
        GeneratedAdminApi::new(&self.http)
    }

    /// Send a push notification to a single user's devices.
    pub async fn send(&self, user_id: &str, payload: &Value) -> Result<PushResult, Error> {
        let body = serde_json::json!({
            "userId": user_id,
            "payload": payload,
        });
        let res: Value = self.core().push_send(&body).await?;
        Ok(parse_push_result(&res))
    }

    /// Send a push notification to multiple users (no limit — server chunks internally).
    pub async fn send_many(&self, user_ids: &[&str], payload: &Value) -> Result<PushResult, Error> {
        let body = serde_json::json!({
            "userIds": user_ids,
            "payload": payload,
        });
        let res: Value = self.core().push_send_many(&body).await?;
        Ok(parse_push_result(&res))
    }

    /// Send a push notification to a specific device token.
    pub async fn send_to_token(&self, token: &str, payload: &Value, platform: Option<&str>) -> Result<PushResult, Error> {
        let body = serde_json::json!({
            "token": token,
            "payload": payload,
            "platform": platform.unwrap_or("web"),
        });
        let res: Value = self.core().push_send_to_token(&body).await?;
        Ok(parse_push_result(&res))
    }

    /// Get registered device tokens for a user — token values NOT exposed.
    pub async fn get_tokens(&self, user_id: &str) -> Result<Vec<Value>, Error> {
        let mut query = std::collections::HashMap::new();
        query.insert("userId".to_string(), user_id.to_string());
        let res: Value = self.core().get_push_tokens(&query).await?;
        if let Some(items) = res.get("items").and_then(|v| v.as_array()) {
            Ok(items.clone())
        } else {
            Ok(Vec::new())
        }
    }

    /// Get push send logs for a user (last 24 hours).
    pub async fn get_logs(&self, user_id: &str, limit: Option<u32>) -> Result<Vec<Value>, Error> {
        let mut query = std::collections::HashMap::new();
        query.insert("userId".to_string(), user_id.to_string());
        if let Some(l) = limit {
            query.insert("limit".to_string(), l.to_string());
        }
        let res: Value = self.core().get_push_logs(&query).await?;
        if let Some(items) = res.get("items").and_then(|v| v.as_array()) {
            Ok(items.clone())
        } else {
            Ok(Vec::new())
        }
    }

    /// Send a push notification to an FCM topic.
    pub async fn send_to_topic(&self, topic: &str, payload: &Value) -> Result<Value, Error> {
        let body = serde_json::json!({
            "topic": topic,
            "payload": payload,
        });
        self.core().push_send_to_topic(&body).await
    }

    /// Broadcast a push notification to all devices via /topics/all.
    pub async fn broadcast(&self, payload: &Value) -> Result<Value, Error> {
        let body = serde_json::json!({
            "payload": payload,
        });
        self.core().push_broadcast(&body).await
    }
}

fn parse_push_result(v: &Value) -> PushResult {
    PushResult {
        sent: v.get("sent").and_then(|v| v.as_i64()).unwrap_or(0),
        failed: v.get("failed").and_then(|v| v.as_i64()).unwrap_or(0),
        removed: v.get("removed").and_then(|v| v.as_i64()).unwrap_or(0),
    }
}
