//! EdgeBase Rust SDK — AdminAuthClient (server-only)

use crate::generated::admin_api_core::GeneratedAdminApi;
use edgebase_core::{Error, http_client::HttpClient};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;

/// Server-side user management — requires Service Key.
pub struct AdminAuthClient {
    http: Arc<HttpClient>,
}

impl AdminAuthClient {
    pub fn new(http: Arc<HttpClient>) -> Self { Self { http } }

    fn core(&self) -> GeneratedAdminApi<'_> {
        GeneratedAdminApi::new(&self.http)
    }

    pub async fn get_user(&self, user_id: &str) -> Result<HashMap<String, Value>, Error> {
        let v = self.core().admin_auth_get_user(user_id).await?;
        Ok(value_to_map(v))
    }

    /// List users with pagination. `cursor` is the ID of the last user from the previous page.
    pub async fn list_users(&self, limit: u32, cursor: Option<&str>) -> Result<Value, Error> {
        let mut query = HashMap::new();
        query.insert("limit".to_string(), limit.to_string());
        if let Some(c) = cursor {
            query.insert("cursor".to_string(), c.to_string());
        }
        self.core().admin_auth_list_users(&query).await
    }

    pub async fn create_user(&self, email: &str, password: &str) -> Result<HashMap<String, Value>, Error> {
        let body = json!({ "email": email, "password": password });
        let v = self.core().admin_auth_create_user(&body).await?;
        Ok(value_to_map(v))
    }

    pub async fn update_user(&self, user_id: &str, data: &Value) -> Result<HashMap<String, Value>, Error> {
        let v = self.core().admin_auth_update_user(user_id, data).await?;
        Ok(value_to_map(v))
    }

    pub async fn delete_user(&self, user_id: &str) -> Result<(), Error> {
        self.core().admin_auth_delete_user(user_id).await?;
        Ok(())
    }

    /// Set custom JWT claims for a user. Server uses PUT.
    pub async fn set_custom_claims(&self, user_id: &str, claims: serde_json::Value) -> Result<(), Error> {
        self.core().admin_auth_set_claims(user_id, &claims).await?;
        Ok(())
    }

    /// Revoke all active sessions for a user, forcing re-authentication.
    pub async fn revoke_all_sessions(&self, user_id: &str) -> Result<(), Error> {
        self.core().admin_auth_revoke_user_sessions(user_id).await?;
        Ok(())
    }

    /// Disable MFA for a user (admin operation via Service Key).
    /// Removes all MFA factors, allowing the user to sign in without MFA.
    pub async fn disable_mfa(&self, user_id: &str) -> Result<(), Error> {
        self.core().admin_auth_delete_user_mfa(user_id).await?;
        Ok(())
    }
}

fn value_to_map(v: Value) -> HashMap<String, Value> {
    match v {
        Value::Object(mut m) => {
            if let Some(Value::Object(user)) = m.remove("user") {
                return user.into_iter().collect();
            }
            m.into_iter().collect()
        }
        _ => HashMap::new(),
    }
}
