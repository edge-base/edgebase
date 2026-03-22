//! Auto-generated admin API Core — DO NOT EDIT.
//! Regenerate: npx tsx tools/sdk-codegen/generate.ts
//! Source: openapi.json (0.1.0)

use crate::Error;
use crate::HttpClient;
use serde_json::Value;

fn encode_path_param(value: &str) -> String {
    urlencoding::encode(value).into_owned()
}

/// Auto-generated API methods.
pub struct GeneratedAdminApi<'a> {
    http: &'a HttpClient,
}

impl<'a> GeneratedAdminApi<'a> {
    pub fn new(http: &'a HttpClient) -> Self {
        Self { http }
    }

    /// Get user by ID — GET /api/auth/admin/users/{id}
    pub async fn admin_auth_get_user(&self, id: &str) -> Result<Value, Error> {
        self.http.get(&format!("/api/auth/admin/users/{}", encode_path_param(id))).await
    }

    /// Update user by ID — PATCH /api/auth/admin/users/{id}
    pub async fn admin_auth_update_user(&self, id: &str, body: &Value) -> Result<Value, Error> {
        self.http.patch(&format!("/api/auth/admin/users/{}", encode_path_param(id)), body).await
    }

    /// Delete user by ID — DELETE /api/auth/admin/users/{id}
    pub async fn admin_auth_delete_user(&self, id: &str) -> Result<Value, Error> {
        self.http.delete(&format!("/api/auth/admin/users/{}", encode_path_param(id))).await
    }

    /// List users — GET /api/auth/admin/users
    pub async fn admin_auth_list_users(&self, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        self.http.get_with_query("/api/auth/admin/users", query).await
    }

    /// Create a new user — POST /api/auth/admin/users
    pub async fn admin_auth_create_user(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/auth/admin/users", body).await
    }

    /// Delete user MFA — DELETE /api/auth/admin/users/{id}/mfa
    pub async fn admin_auth_delete_user_mfa(&self, id: &str) -> Result<Value, Error> {
        self.http.delete(&format!("/api/auth/admin/users/{}/mfa", encode_path_param(id))).await
    }

    /// Set custom claims for user — PUT /api/auth/admin/users/{id}/claims
    pub async fn admin_auth_set_claims(&self, id: &str, body: &Value) -> Result<Value, Error> {
        self.http.put(&format!("/api/auth/admin/users/{}/claims", encode_path_param(id)), body).await
    }

    /// Revoke all sessions for user — POST /api/auth/admin/users/{id}/revoke
    pub async fn admin_auth_revoke_user_sessions(&self, id: &str) -> Result<Value, Error> {
        self.http.post(&format!("/api/auth/admin/users/{}/revoke", encode_path_param(id)), &Value::Null).await
    }

    /// Batch import users — POST /api/auth/admin/users/import
    pub async fn admin_auth_import_users(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/auth/admin/users/import", body).await
    }

    /// Broadcast to database live channel — POST /api/db/broadcast
    pub async fn database_live_broadcast(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/db/broadcast", body).await
    }

    /// Execute SQL via DatabaseDO — POST /api/sql
    pub async fn execute_sql(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/sql", body).await
    }

    /// Execute KV operation — POST /api/kv/{namespace}
    pub async fn kv_operation(&self, namespace: &str, body: &Value) -> Result<Value, Error> {
        self.http.post(&format!("/api/kv/{}", encode_path_param(namespace)), body).await
    }

    /// Execute raw SQL on D1 database — POST /api/d1/{database}
    pub async fn execute_d1_query(&self, database: &str, body: &Value) -> Result<Value, Error> {
        self.http.post(&format!("/api/d1/{}", encode_path_param(database)), body).await
    }

    /// Execute Vectorize operation — POST /api/vectorize/{index}
    pub async fn vectorize_operation(&self, index: &str, body: &Value) -> Result<Value, Error> {
        self.http.post(&format!("/api/vectorize/{}", encode_path_param(index)), body).await
    }

    /// Send push notification to user — POST /api/push/send
    pub async fn push_send(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/push/send", body).await
    }

    /// Send push to multiple users — POST /api/push/send-many
    pub async fn push_send_many(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/push/send-many", body).await
    }

    /// Send push to specific token — POST /api/push/send-to-token
    pub async fn push_send_to_token(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/push/send-to-token", body).await
    }

    /// Send push to topic — POST /api/push/send-to-topic
    pub async fn push_send_to_topic(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/push/send-to-topic", body).await
    }

    /// Broadcast push to all devices — POST /api/push/broadcast
    pub async fn push_broadcast(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/push/broadcast", body).await
    }

    /// Get push notification logs — GET /api/push/logs
    pub async fn get_push_logs(&self, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        self.http.get_with_query("/api/push/logs", query).await
    }

    /// Get registered push tokens — GET /api/push/tokens
    pub async fn get_push_tokens(&self, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        self.http.get_with_query("/api/push/tokens", query).await
    }

    /// Upsert a device token — PUT /api/push/tokens
    pub async fn put_push_tokens(&self, body: &Value) -> Result<Value, Error> {
        self.http.put("/api/push/tokens", body).await
    }

    /// Update device metadata — PATCH /api/push/tokens
    pub async fn patch_push_tokens(&self, body: &Value) -> Result<Value, Error> {
        self.http.patch("/api/push/tokens", body).await
    }

    /// Query request log metrics — GET /api/analytics/query
    pub async fn query_analytics(&self, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        self.http.get_with_query("/api/analytics/query", query).await
    }

    /// Query custom events — GET /api/analytics/events
    pub async fn query_custom_events(&self, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        self.http.get_with_query("/api/analytics/events", query).await
    }

    /// Check if admin setup is needed — GET /admin/api/setup/status
    pub async fn admin_setup_status(&self) -> Result<Value, Error> {
        self.http.get("/admin/api/setup/status").await
    }

    /// Create the first admin account — POST /admin/api/setup
    pub async fn admin_setup(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/admin/api/setup", body).await
    }

    /// Admin login — POST /admin/api/auth/login
    pub async fn admin_login(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/admin/api/auth/login", body).await
    }

    /// Rotate admin token — POST /admin/api/auth/refresh
    pub async fn admin_refresh(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/admin/api/auth/refresh", body).await
    }

    /// Reset admin password (Service Key required) — POST /admin/api/internal/reset-password
    pub async fn admin_reset_password(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/admin/api/internal/reset-password", body).await
    }

    /// List all tables from config — GET /admin/api/data/tables
    pub async fn admin_list_tables(&self) -> Result<Value, Error> {
        self.http.get("/admin/api/data/tables").await
    }

    /// List table records with pagination — GET /admin/api/data/tables/{name}/records
    pub async fn admin_get_table_records(&self, name: &str) -> Result<Value, Error> {
        self.http.get(&format!("/admin/api/data/tables/{}/records", encode_path_param(name))).await
    }

    /// Create a table record — POST /admin/api/data/tables/{name}/records
    pub async fn admin_create_table_record(&self, name: &str, body: &Value) -> Result<Value, Error> {
        self.http.post(&format!("/admin/api/data/tables/{}/records", encode_path_param(name)), body).await
    }

    /// Update a table record — PUT /admin/api/data/tables/{name}/records/{id}
    pub async fn admin_update_table_record(&self, name: &str, id: &str, body: &Value) -> Result<Value, Error> {
        self.http.put(&format!("/admin/api/data/tables/{}/records/{}", encode_path_param(name), encode_path_param(id)), body).await
    }

    /// Delete a table record — DELETE /admin/api/data/tables/{name}/records/{id}
    pub async fn admin_delete_table_record(&self, name: &str, id: &str) -> Result<Value, Error> {
        self.http.delete(&format!("/admin/api/data/tables/{}/records/{}", encode_path_param(name), encode_path_param(id))).await
    }

    /// List users via D1 index — GET /admin/api/data/users
    pub async fn admin_list_users(&self) -> Result<Value, Error> {
        self.http.get("/admin/api/data/users").await
    }

    /// Create a new user — POST /admin/api/data/users
    pub async fn admin_create_user(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/admin/api/data/users", body).await
    }

    /// Fetch a single user by ID — GET /admin/api/data/users/{id}
    pub async fn admin_get_user(&self, id: &str) -> Result<Value, Error> {
        self.http.get(&format!("/admin/api/data/users/{}", encode_path_param(id))).await
    }

    /// Update user status or role — PUT /admin/api/data/users/{id}
    pub async fn admin_update_user(&self, id: &str, body: &Value) -> Result<Value, Error> {
        self.http.put(&format!("/admin/api/data/users/{}", encode_path_param(id)), body).await
    }

    /// Delete a user completely — DELETE /admin/api/data/users/{id}
    pub async fn admin_delete_user(&self, id: &str) -> Result<Value, Error> {
        self.http.delete(&format!("/admin/api/data/users/{}", encode_path_param(id))).await
    }

    /// Fetch user profile with cache — GET /admin/api/data/users/{id}/profile
    pub async fn admin_get_user_profile(&self, id: &str) -> Result<Value, Error> {
        self.http.get(&format!("/admin/api/data/users/{}/profile", encode_path_param(id))).await
    }

    /// Revoke all user sessions — DELETE /admin/api/data/users/{id}/sessions
    pub async fn admin_delete_user_sessions(&self, id: &str) -> Result<Value, Error> {
        self.http.delete(&format!("/admin/api/data/users/{}/sessions", encode_path_param(id))).await
    }

    /// Cleanup anonymous user index — POST /admin/api/data/cleanup-anon
    pub async fn admin_cleanup_anon(&self) -> Result<Value, Error> {
        self.http.post("/admin/api/data/cleanup-anon", &Value::Null).await
    }

    /// List configured storage buckets — GET /admin/api/data/storage/buckets
    pub async fn admin_list_buckets(&self) -> Result<Value, Error> {
        self.http.get("/admin/api/data/storage/buckets").await
    }

    /// List objects in a storage bucket — GET /admin/api/data/storage/buckets/{name}/objects
    pub async fn admin_list_bucket_objects(&self, name: &str) -> Result<Value, Error> {
        self.http.get(&format!("/admin/api/data/storage/buckets/{}/objects", encode_path_param(name))).await
    }

    /// Get a storage object content — GET /admin/api/data/storage/buckets/{name}/objects/{key}
    pub async fn admin_get_bucket_object(&self, name: &str, key: &str) -> Result<Value, Error> {
        self.http.get(&format!("/admin/api/data/storage/buckets/{}/objects/{}", encode_path_param(name), encode_path_param(key))).await
    }

    /// Delete a storage object — DELETE /admin/api/data/storage/buckets/{name}/objects/{key}
    pub async fn admin_delete_bucket_object(&self, name: &str, key: &str) -> Result<Value, Error> {
        self.http.delete(&format!("/admin/api/data/storage/buckets/{}/objects/{}", encode_path_param(name), encode_path_param(key))).await
    }

    /// Get bucket statistics (total objects and size) — GET /admin/api/data/storage/buckets/{name}/stats
    pub async fn admin_get_bucket_stats(&self, name: &str) -> Result<Value, Error> {
        self.http.get(&format!("/admin/api/data/storage/buckets/{}/stats", encode_path_param(name))).await
    }

    /// Create a signed download URL for a storage object — POST /admin/api/data/storage/buckets/{name}/signed-url
    pub async fn admin_create_signed_url(&self, name: &str, body: &Value) -> Result<Value, Error> {
        self.http.post(&format!("/admin/api/data/storage/buckets/{}/signed-url", encode_path_param(name)), body).await
    }

    /// Get full schema structure from config — GET /admin/api/data/schema
    pub async fn admin_get_schema(&self) -> Result<Value, Error> {
        self.http.get("/admin/api/data/schema").await
    }

    /// List instance suggestions for a dynamic namespace — GET /admin/api/data/namespaces/{namespace}/instances
    pub async fn admin_list_namespace_instances(&self, namespace: &str, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        self.http.get_with_query(&format!("/admin/api/data/namespaces/{}/instances", encode_path_param(namespace)), query).await
    }

    /// Export table data as JSON — GET /admin/api/data/tables/{name}/export
    pub async fn admin_export_table(&self, name: &str) -> Result<Value, Error> {
        self.http.get(&format!("/admin/api/data/tables/{}/export", encode_path_param(name))).await
    }

    /// Get request logs — GET /admin/api/data/logs
    pub async fn admin_get_logs(&self) -> Result<Value, Error> {
        self.http.get("/admin/api/data/logs").await
    }

    /// Get live monitoring stats — GET /admin/api/data/monitoring
    pub async fn admin_get_monitoring(&self) -> Result<Value, Error> {
        self.http.get("/admin/api/data/monitoring").await
    }

    /// Get analytics dashboard data — GET /admin/api/data/analytics
    pub async fn admin_get_analytics(&self, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        self.http.get_with_query("/admin/api/data/analytics", query).await
    }

    /// Query analytics events for admin dashboard — GET /admin/api/data/analytics/events
    pub async fn admin_get_analytics_events(&self) -> Result<Value, Error> {
        self.http.get("/admin/api/data/analytics/events").await
    }

    /// Get project overview for dashboard home — GET /admin/api/data/overview
    pub async fn admin_get_overview(&self, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        self.http.get_with_query("/admin/api/data/overview", query).await
    }

    /// Get dev mode status and sidecar port — GET /admin/api/data/dev-info
    pub async fn admin_get_dev_info(&self) -> Result<Value, Error> {
        self.http.get("/admin/api/data/dev-info").await
    }

    /// Execute raw SQL query — POST /admin/api/data/sql
    pub async fn admin_execute_sql(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/admin/api/data/sql", body).await
    }

    /// Batch import records into a table — POST /admin/api/data/tables/{name}/import
    pub async fn admin_import_table(&self, name: &str, body: &Value) -> Result<Value, Error> {
        self.http.post(&format!("/admin/api/data/tables/{}/import", encode_path_param(name)), body).await
    }

    /// Evaluate access rules with simulated auth context — POST /admin/api/data/rules-test
    pub async fn admin_rules_test(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/admin/api/data/rules-test", body).await
    }

    /// List registered functions from config — GET /admin/api/data/functions
    pub async fn admin_list_functions(&self) -> Result<Value, Error> {
        self.http.get("/admin/api/data/functions").await
    }

    /// Get environment and config overview — GET /admin/api/data/config-info
    pub async fn admin_get_config_info(&self) -> Result<Value, Error> {
        self.http.get("/admin/api/data/config-info").await
    }

    /// Get recent request logs with filtering — GET /admin/api/data/logs/recent
    pub async fn admin_get_recent_logs(&self) -> Result<Value, Error> {
        self.http.get("/admin/api/data/logs/recent").await
    }

    /// Get OAuth provider config — GET /admin/api/data/auth/settings
    pub async fn admin_get_auth_settings(&self) -> Result<Value, Error> {
        self.http.get("/admin/api/data/auth/settings").await
    }

    /// Get email template and subject config — GET /admin/api/data/email/templates
    pub async fn admin_get_email_templates(&self) -> Result<Value, Error> {
        self.http.get("/admin/api/data/email/templates").await
    }

    /// Disable MFA for a user — DELETE /admin/api/data/users/{id}/mfa
    pub async fn admin_delete_user_mfa(&self, id: &str) -> Result<Value, Error> {
        self.http.delete(&format!("/admin/api/data/users/{}/mfa", encode_path_param(id))).await
    }

    /// Send password reset email for a user — POST /admin/api/data/users/{id}/send-password-reset
    pub async fn admin_send_password_reset(&self, id: &str) -> Result<Value, Error> {
        self.http.post(&format!("/admin/api/data/users/{}/send-password-reset", encode_path_param(id)), &Value::Null).await
    }

    /// Upload file to R2 storage — POST /admin/api/data/storage/buckets/{name}/upload
    pub async fn admin_upload_file(&self, name: &str, body: &Value) -> Result<Value, Error> {
        self.http.post(&format!("/admin/api/data/storage/buckets/{}/upload", encode_path_param(name)), body).await
    }

    /// List push tokens for a user — GET /admin/api/data/push/tokens
    pub async fn admin_get_push_tokens(&self) -> Result<Value, Error> {
        self.http.get("/admin/api/data/push/tokens").await
    }

    /// Get push notification logs — GET /admin/api/data/push/logs
    pub async fn admin_get_push_logs(&self) -> Result<Value, Error> {
        self.http.get("/admin/api/data/push/logs").await
    }

    /// Test send push notification — POST /admin/api/data/push/test-send
    pub async fn admin_test_push_send(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/admin/api/data/push/test-send", body).await
    }

    /// List Durable Objects for backup — POST /admin/api/data/backup/list-dos
    pub async fn admin_backup_list_dos(&self) -> Result<Value, Error> {
        self.http.post("/admin/api/data/backup/list-dos", &Value::Null).await
    }

    /// Dump a Durable Object for backup — POST /admin/api/data/backup/dump-do
    pub async fn admin_backup_dump_do(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/admin/api/data/backup/dump-do", body).await
    }

    /// Restore a Durable Object from backup — POST /admin/api/data/backup/restore-do
    pub async fn admin_backup_restore_do(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/admin/api/data/backup/restore-do", body).await
    }

    /// Dump D1 database for backup — POST /admin/api/data/backup/dump-d1
    pub async fn admin_backup_dump_d1(&self) -> Result<Value, Error> {
        self.http.post("/admin/api/data/backup/dump-d1", &Value::Null).await
    }

    /// Restore D1 database from backup — POST /admin/api/data/backup/restore-d1
    pub async fn admin_backup_restore_d1(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/admin/api/data/backup/restore-d1", body).await
    }

    /// Dump data namespace tables for admin-side migrations — POST /admin/api/data/backup/dump-data
    pub async fn admin_backup_dump_data(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/admin/api/data/backup/dump-data", body).await
    }

    /// Restore data namespace tables for admin-side migrations — POST /admin/api/data/backup/restore-data
    pub async fn admin_backup_restore_data(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/admin/api/data/backup/restore-data", body).await
    }

    /// Get backup config — GET /admin/api/data/backup/config
    pub async fn admin_backup_get_config(&self) -> Result<Value, Error> {
        self.http.get("/admin/api/data/backup/config").await
    }

    /// List admin accounts — GET /admin/api/data/admins
    pub async fn admin_list_admins(&self) -> Result<Value, Error> {
        self.http.get("/admin/api/data/admins").await
    }

    /// Create an admin account — POST /admin/api/data/admins
    pub async fn admin_create_admin(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/admin/api/data/admins", body).await
    }

    /// Delete an admin account — DELETE /admin/api/data/admins/{id}
    pub async fn admin_delete_admin(&self, id: &str) -> Result<Value, Error> {
        self.http.delete(&format!("/admin/api/data/admins/{}", encode_path_param(id))).await
    }

    /// Change admin password — PUT /admin/api/data/admins/{id}/password
    pub async fn admin_change_password(&self, id: &str, body: &Value) -> Result<Value, Error> {
        self.http.put(&format!("/admin/api/data/admins/{}/password", encode_path_param(id)), body).await
    }

    /// Delete all Cloudflare resources and the Worker itself (self-destruct) — POST /admin/api/data/destroy-app
    pub async fn admin_destroy_app(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/admin/api/data/destroy-app", body).await
    }

    /// List all DO instances — POST /admin/api/backup/list-dos
    pub async fn backup_list_dos(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/admin/api/backup/list-dos", body).await
    }

    /// Return parsed config snapshot — GET /admin/api/backup/config
    pub async fn backup_get_config(&self) -> Result<Value, Error> {
        self.http.get("/admin/api/backup/config").await
    }

    /// Remove plugin-prefixed tables and migration metadata — POST /admin/api/backup/cleanup-plugin
    pub async fn backup_cleanup_plugin(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/admin/api/backup/cleanup-plugin", body).await
    }

    /// Wipe a specific DO's data — POST /admin/api/backup/wipe-do
    pub async fn backup_wipe_do(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/admin/api/backup/wipe-do", body).await
    }

    /// Dump a specific DO's data — POST /admin/api/backup/dump-do
    pub async fn backup_dump_do(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/admin/api/backup/dump-do", body).await
    }

    /// Restore a specific DO's data — POST /admin/api/backup/restore-do
    pub async fn backup_restore_do(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/admin/api/backup/restore-do", body).await
    }

    /// Dump auth database tables — POST /admin/api/backup/dump-d1
    pub async fn backup_dump_d1(&self) -> Result<Value, Error> {
        self.http.post("/admin/api/backup/dump-d1", &Value::Null).await
    }

    /// Restore auth database tables — POST /admin/api/backup/restore-d1
    pub async fn backup_restore_d1(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/admin/api/backup/restore-d1", body).await
    }

    /// Dump control-plane D1 tables — POST /admin/api/backup/dump-control-d1
    pub async fn backup_dump_control_d1(&self) -> Result<Value, Error> {
        self.http.post("/admin/api/backup/dump-control-d1", &Value::Null).await
    }

    /// Restore control-plane D1 tables — POST /admin/api/backup/restore-control-d1
    pub async fn backup_restore_control_d1(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/admin/api/backup/restore-control-d1", body).await
    }

    /// Dump all tables from a data namespace — POST /admin/api/backup/dump-data
    pub async fn backup_dump_data(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/admin/api/backup/dump-data", body).await
    }

    /// Restore all tables into a data namespace — POST /admin/api/backup/restore-data
    pub async fn backup_restore_data(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/admin/api/backup/restore-data", body).await
    }

    /// Dump R2 storage (list or download) — POST /admin/api/backup/dump-storage
    pub async fn backup_dump_storage(&self, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        self.http.get_with_query("/admin/api/backup/dump-storage", query).await
    }

    /// Restore R2 storage (wipe or upload) — POST /admin/api/backup/restore-storage
    pub async fn backup_restore_storage(&self, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        self.http.get_with_query("/admin/api/backup/restore-storage", query).await
    }

    /// Resync _users_public from _users in AUTH_DB D1 — POST /admin/api/backup/resync-users-public
    pub async fn backup_resync_users_public(&self) -> Result<Value, Error> {
        self.http.post("/admin/api/backup/resync-users-public", &Value::Null).await
    }

    /// Export a single table as JSON — GET /admin/api/backup/export/{name}
    pub async fn backup_export_table(&self, name: &str, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        self.http.get_with_query(&format!("/admin/api/backup/export/{}", encode_path_param(name)), query).await
    }
}
