//! Auto-generated core API Core — DO NOT EDIT.
//! Regenerate: npx tsx tools/sdk-codegen/generate.ts
//! Source: openapi.json (0.1.0)

use crate::Error;
use crate::HttpClient;
use serde_json::Value;

fn encode_path_param(value: &str) -> String {
    urlencoding::encode(value).into_owned()
}

/// Auto-generated API methods.
pub struct GeneratedDbApi<'a> {
    http: &'a HttpClient,
}

impl<'a> GeneratedDbApi<'a> {
    pub fn new(http: &'a HttpClient) -> Self {
        Self { http }
    }

    /// Health check — GET /api/health
    pub async fn get_health(&self) -> Result<Value, Error> {
        self.http.get("/api/health").await
    }

    /// Sign up with email and password — POST /api/auth/signup
    pub async fn auth_signup(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/auth/signup", body).await
    }

    /// Sign in with email and password — POST /api/auth/signin
    pub async fn auth_signin(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/auth/signin", body).await
    }

    /// Sign in anonymously — POST /api/auth/signin/anonymous
    pub async fn auth_signin_anonymous(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/auth/signin/anonymous", body).await
    }

    /// Send magic link to email — POST /api/auth/signin/magic-link
    pub async fn auth_signin_magic_link(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/auth/signin/magic-link", body).await
    }

    /// Verify magic link token — POST /api/auth/verify-magic-link
    pub async fn auth_verify_magic_link(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/auth/verify-magic-link", body).await
    }

    /// Send OTP SMS to phone number — POST /api/auth/signin/phone
    pub async fn auth_signin_phone(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/auth/signin/phone", body).await
    }

    /// Verify phone OTP and create session — POST /api/auth/verify-phone
    pub async fn auth_verify_phone(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/auth/verify-phone", body).await
    }

    /// Link phone number to existing account — POST /api/auth/link/phone
    pub async fn auth_link_phone(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/auth/link/phone", body).await
    }

    /// Verify OTP and link phone to account — POST /api/auth/verify-link-phone
    pub async fn auth_verify_link_phone(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/auth/verify-link-phone", body).await
    }

    /// Send OTP code to email — POST /api/auth/signin/email-otp
    pub async fn auth_signin_email_otp(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/auth/signin/email-otp", body).await
    }

    /// Verify email OTP and create session — POST /api/auth/verify-email-otp
    pub async fn auth_verify_email_otp(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/auth/verify-email-otp", body).await
    }

    /// Enroll new TOTP factor — POST /api/auth/mfa/totp/enroll
    pub async fn auth_mfa_totp_enroll(&self) -> Result<Value, Error> {
        self.http.post("/api/auth/mfa/totp/enroll", &Value::Null).await
    }

    /// Confirm TOTP enrollment with code — POST /api/auth/mfa/totp/verify
    pub async fn auth_mfa_totp_verify(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/auth/mfa/totp/verify", body).await
    }

    /// Verify MFA code during signin — POST /api/auth/mfa/verify
    pub async fn auth_mfa_verify(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/auth/mfa/verify", body).await
    }

    /// Use recovery code during MFA signin — POST /api/auth/mfa/recovery
    pub async fn auth_mfa_recovery(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/auth/mfa/recovery", body).await
    }

    /// Disable TOTP factor — DELETE /api/auth/mfa/totp
    pub async fn auth_mfa_totp_delete(&self, body: &Value) -> Result<Value, Error> {
        self.http.delete_with_body("/api/auth/mfa/totp", body).await
    }

    /// List MFA factors for authenticated user — GET /api/auth/mfa/factors
    pub async fn auth_mfa_factors(&self) -> Result<Value, Error> {
        self.http.get("/api/auth/mfa/factors").await
    }

    /// Refresh access token — POST /api/auth/refresh
    pub async fn auth_refresh(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/auth/refresh", body).await
    }

    /// Sign out and revoke refresh token — POST /api/auth/signout
    pub async fn auth_signout(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/auth/signout", body).await
    }

    /// Change password for authenticated user — POST /api/auth/change-password
    pub async fn auth_change_password(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/auth/change-password", body).await
    }

    /// Request email change with password confirmation — POST /api/auth/change-email
    pub async fn auth_change_email(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/auth/change-email", body).await
    }

    /// Verify email change token — POST /api/auth/verify-email-change
    pub async fn auth_verify_email_change(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/auth/verify-email-change", body).await
    }

    /// Generate passkey registration options — POST /api/auth/passkeys/register-options
    pub async fn auth_passkeys_register_options(&self) -> Result<Value, Error> {
        self.http.post("/api/auth/passkeys/register-options", &Value::Null).await
    }

    /// Verify and store passkey registration — POST /api/auth/passkeys/register
    pub async fn auth_passkeys_register(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/auth/passkeys/register", body).await
    }

    /// Generate passkey authentication options — POST /api/auth/passkeys/auth-options
    pub async fn auth_passkeys_auth_options(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/auth/passkeys/auth-options", body).await
    }

    /// Authenticate with passkey — POST /api/auth/passkeys/authenticate
    pub async fn auth_passkeys_authenticate(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/auth/passkeys/authenticate", body).await
    }

    /// List passkeys for authenticated user — GET /api/auth/passkeys
    pub async fn auth_passkeys_list(&self) -> Result<Value, Error> {
        self.http.get("/api/auth/passkeys").await
    }

    /// Delete a passkey — DELETE /api/auth/passkeys/{credentialId}
    pub async fn auth_passkeys_delete(&self, credential_id: &str) -> Result<Value, Error> {
        self.http.delete(&format!("/api/auth/passkeys/{}", encode_path_param(credential_id))).await
    }

    /// Get current authenticated user info — GET /api/auth/me
    pub async fn auth_get_me(&self) -> Result<Value, Error> {
        self.http.get("/api/auth/me").await
    }

    /// Update user profile — PATCH /api/auth/profile
    pub async fn auth_update_profile(&self, body: &Value) -> Result<Value, Error> {
        self.http.patch("/api/auth/profile", body).await
    }

    /// List active sessions — GET /api/auth/sessions
    pub async fn auth_get_sessions(&self) -> Result<Value, Error> {
        self.http.get("/api/auth/sessions").await
    }

    /// Delete a session — DELETE /api/auth/sessions/{id}
    pub async fn auth_delete_session(&self, id: &str) -> Result<Value, Error> {
        self.http.delete(&format!("/api/auth/sessions/{}", encode_path_param(id))).await
    }

    /// List linked sign-in identities for the current user — GET /api/auth/identities
    pub async fn auth_get_identities(&self) -> Result<Value, Error> {
        self.http.get("/api/auth/identities").await
    }

    /// Unlink a linked sign-in identity — DELETE /api/auth/identities/{identityId}
    pub async fn auth_delete_identity(&self, identity_id: &str) -> Result<Value, Error> {
        self.http.delete(&format!("/api/auth/identities/{}", encode_path_param(identity_id))).await
    }

    /// Link email and password to existing account — POST /api/auth/link/email
    pub async fn auth_link_email(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/auth/link/email", body).await
    }

    /// Send a verification email to the current authenticated user — POST /api/auth/request-email-verification
    pub async fn auth_request_email_verification(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/auth/request-email-verification", body).await
    }

    /// Verify email address with token — POST /api/auth/verify-email
    pub async fn auth_verify_email(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/auth/verify-email", body).await
    }

    /// Request password reset email — POST /api/auth/request-password-reset
    pub async fn auth_request_password_reset(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/auth/request-password-reset", body).await
    }

    /// Reset password with token — POST /api/auth/reset-password
    pub async fn auth_reset_password(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/auth/reset-password", body).await
    }

    /// Start OAuth redirect — GET /api/auth/oauth/{provider}
    pub async fn oauth_redirect(&self, provider: &str) -> Result<Value, Error> {
        self.http.get(&format!("/api/auth/oauth/{}", encode_path_param(provider))).await
    }

    /// OAuth callback — GET /api/auth/oauth/{provider}/callback
    pub async fn oauth_callback(&self, provider: &str) -> Result<Value, Error> {
        self.http.get(&format!("/api/auth/oauth/{}/callback", encode_path_param(provider))).await
    }

    /// Start OAuth account linking — POST /api/auth/oauth/link/{provider}
    pub async fn oauth_link_start(&self, provider: &str) -> Result<Value, Error> {
        self.http.post(&format!("/api/auth/oauth/link/{}", encode_path_param(provider)), &Value::Null).await
    }

    /// OAuth link callback — GET /api/auth/oauth/link/{provider}/callback
    pub async fn oauth_link_callback(&self, provider: &str) -> Result<Value, Error> {
        self.http.get(&format!("/api/auth/oauth/link/{}/callback", encode_path_param(provider))).await
    }

    /// Count records in a single-instance table — GET /api/db/{namespace}/tables/{table}/count
    pub async fn db_single_count_records(&self, namespace: &str, table: &str, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        self.http.get_with_query(&format!("/api/db/{}/tables/{}/count", encode_path_param(namespace), encode_path_param(table)), query).await
    }

    /// Search records in a single-instance table — GET /api/db/{namespace}/tables/{table}/search
    pub async fn db_single_search_records(&self, namespace: &str, table: &str, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        self.http.get_with_query(&format!("/api/db/{}/tables/{}/search", encode_path_param(namespace), encode_path_param(table)), query).await
    }

    /// Get a single record from a single-instance table — GET /api/db/{namespace}/tables/{table}/{id}
    pub async fn db_single_get_record(&self, namespace: &str, table: &str, id: &str, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        self.http.get_with_query(&format!("/api/db/{}/tables/{}/{}", encode_path_param(namespace), encode_path_param(table), encode_path_param(id)), query).await
    }

    /// Update a record in a single-instance table — PATCH /api/db/{namespace}/tables/{table}/{id}
    pub async fn db_single_update_record(&self, namespace: &str, table: &str, id: &str, body: &Value) -> Result<Value, Error> {
        self.http.patch(&format!("/api/db/{}/tables/{}/{}", encode_path_param(namespace), encode_path_param(table), encode_path_param(id)), body).await
    }

    /// Delete a record from a single-instance table — DELETE /api/db/{namespace}/tables/{table}/{id}
    pub async fn db_single_delete_record(&self, namespace: &str, table: &str, id: &str) -> Result<Value, Error> {
        self.http.delete(&format!("/api/db/{}/tables/{}/{}", encode_path_param(namespace), encode_path_param(table), encode_path_param(id))).await
    }

    /// List records from a single-instance table — GET /api/db/{namespace}/tables/{table}
    pub async fn db_single_list_records(&self, namespace: &str, table: &str, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        self.http.get_with_query(&format!("/api/db/{}/tables/{}", encode_path_param(namespace), encode_path_param(table)), query).await
    }

    /// Insert a record into a single-instance table — POST /api/db/{namespace}/tables/{table}
    pub async fn db_single_insert_record(&self, namespace: &str, table: &str, body: &Value, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        self.http.post_with_query(&format!("/api/db/{}/tables/{}", encode_path_param(namespace), encode_path_param(table)), body, query).await
    }

    /// Batch insert records into a single-instance table — POST /api/db/{namespace}/tables/{table}/batch
    pub async fn db_single_batch_records(&self, namespace: &str, table: &str, body: &Value, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        self.http.post_with_query(&format!("/api/db/{}/tables/{}/batch", encode_path_param(namespace), encode_path_param(table)), body, query).await
    }

    /// Batch update/delete records by filter in a single-instance table — POST /api/db/{namespace}/tables/{table}/batch-by-filter
    pub async fn db_single_batch_by_filter(&self, namespace: &str, table: &str, body: &Value, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        self.http.post_with_query(&format!("/api/db/{}/tables/{}/batch-by-filter", encode_path_param(namespace), encode_path_param(table)), body, query).await
    }

    /// Count records in dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/count
    pub async fn db_count_records(&self, namespace: &str, instance_id: &str, table: &str, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        self.http.get_with_query(&format!("/api/db/{}/{}/tables/{}/count", encode_path_param(namespace), encode_path_param(instance_id), encode_path_param(table)), query).await
    }

    /// Search records in dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/search
    pub async fn db_search_records(&self, namespace: &str, instance_id: &str, table: &str, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        self.http.get_with_query(&format!("/api/db/{}/{}/tables/{}/search", encode_path_param(namespace), encode_path_param(instance_id), encode_path_param(table)), query).await
    }

    /// Get single record from dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/{id}
    pub async fn db_get_record(&self, namespace: &str, instance_id: &str, table: &str, id: &str, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        self.http.get_with_query(&format!("/api/db/{}/{}/tables/{}/{}", encode_path_param(namespace), encode_path_param(instance_id), encode_path_param(table), encode_path_param(id)), query).await
    }

    /// Update record in dynamic table — PATCH /api/db/{namespace}/{instanceId}/tables/{table}/{id}
    pub async fn db_update_record(&self, namespace: &str, instance_id: &str, table: &str, id: &str, body: &Value) -> Result<Value, Error> {
        self.http.patch(&format!("/api/db/{}/{}/tables/{}/{}", encode_path_param(namespace), encode_path_param(instance_id), encode_path_param(table), encode_path_param(id)), body).await
    }

    /// Delete record from dynamic table — DELETE /api/db/{namespace}/{instanceId}/tables/{table}/{id}
    pub async fn db_delete_record(&self, namespace: &str, instance_id: &str, table: &str, id: &str) -> Result<Value, Error> {
        self.http.delete(&format!("/api/db/{}/{}/tables/{}/{}", encode_path_param(namespace), encode_path_param(instance_id), encode_path_param(table), encode_path_param(id))).await
    }

    /// List records from dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}
    pub async fn db_list_records(&self, namespace: &str, instance_id: &str, table: &str, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        self.http.get_with_query(&format!("/api/db/{}/{}/tables/{}", encode_path_param(namespace), encode_path_param(instance_id), encode_path_param(table)), query).await
    }

    /// Insert record into dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table}
    pub async fn db_insert_record(&self, namespace: &str, instance_id: &str, table: &str, body: &Value, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        self.http.post_with_query(&format!("/api/db/{}/{}/tables/{}", encode_path_param(namespace), encode_path_param(instance_id), encode_path_param(table)), body, query).await
    }

    /// Batch insert records into dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table}/batch
    pub async fn db_batch_records(&self, namespace: &str, instance_id: &str, table: &str, body: &Value, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        self.http.post_with_query(&format!("/api/db/{}/{}/tables/{}/batch", encode_path_param(namespace), encode_path_param(instance_id), encode_path_param(table)), body, query).await
    }

    /// Batch update/delete records by filter in dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table}/batch-by-filter
    pub async fn db_batch_by_filter(&self, namespace: &str, instance_id: &str, table: &str, body: &Value, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        self.http.post_with_query(&format!("/api/db/{}/{}/tables/{}/batch-by-filter", encode_path_param(namespace), encode_path_param(instance_id), encode_path_param(table)), body, query).await
    }

    /// Check database live subscription WebSocket prerequisites — GET /api/db/connect-check
    pub async fn check_database_subscription_connection(&self, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        self.http.get_with_query("/api/db/connect-check", query).await
    }

    /// Connect to database live subscriptions WebSocket — GET /api/db/subscribe
    pub async fn connect_database_subscription(&self, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        self.http.get_with_query("/api/db/subscribe", query).await
    }

    /// Get table schema — GET /api/schema
    pub async fn get_schema(&self) -> Result<Value, Error> {
        self.http.get("/api/schema").await
    }

    /// Upload file — POST /api/storage/{bucket}/upload
    pub async fn upload_file(&self, bucket: &str, body: &Value) -> Result<Value, Error> {
        self.http.post(&format!("/api/storage/{}/upload", encode_path_param(bucket)), body).await
    }

    /// Get file metadata — GET /api/storage/{bucket}/{key}/metadata
    pub async fn get_file_metadata(&self, bucket: &str, key: &str) -> Result<Value, Error> {
        self.http.get(&format!("/api/storage/{}/{}/metadata", encode_path_param(bucket), encode_path_param(key))).await
    }

    /// Update file metadata — PATCH /api/storage/{bucket}/{key}/metadata
    pub async fn update_file_metadata(&self, bucket: &str, key: &str, body: &Value) -> Result<Value, Error> {
        self.http.patch(&format!("/api/storage/{}/{}/metadata", encode_path_param(bucket), encode_path_param(key)), body).await
    }

    /// Check if file exists — HEAD /api/storage/{bucket}/{key}
    pub async fn check_file_exists(&self, bucket: &str, key: &str) -> Result<bool, Error> {
        self.http.head(&format!("/api/storage/{}/{}", encode_path_param(bucket), encode_path_param(key))).await
    }

    /// Download file — GET /api/storage/{bucket}/{key}
    pub async fn download_file(&self, bucket: &str, key: &str) -> Result<Value, Error> {
        self.http.get(&format!("/api/storage/{}/{}", encode_path_param(bucket), encode_path_param(key))).await
    }

    /// Delete file — DELETE /api/storage/{bucket}/{key}
    pub async fn delete_file(&self, bucket: &str, key: &str) -> Result<Value, Error> {
        self.http.delete(&format!("/api/storage/{}/{}", encode_path_param(bucket), encode_path_param(key))).await
    }

    /// Get uploaded parts — GET /api/storage/{bucket}/uploads/{uploadId}/parts
    pub async fn get_upload_parts(&self, bucket: &str, upload_id: &str, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        self.http.get_with_query(&format!("/api/storage/{}/uploads/{}/parts", encode_path_param(bucket), encode_path_param(upload_id)), query).await
    }

    /// List files in bucket — GET /api/storage/{bucket}
    pub async fn list_files(&self, bucket: &str) -> Result<Value, Error> {
        self.http.get(&format!("/api/storage/{}", encode_path_param(bucket))).await
    }

    /// Batch delete files — POST /api/storage/{bucket}/delete-batch
    pub async fn delete_batch(&self, bucket: &str, body: &Value) -> Result<Value, Error> {
        self.http.post(&format!("/api/storage/{}/delete-batch", encode_path_param(bucket)), body).await
    }

    /// Create signed download URL — POST /api/storage/{bucket}/signed-url
    pub async fn create_signed_download_url(&self, bucket: &str, body: &Value) -> Result<Value, Error> {
        self.http.post(&format!("/api/storage/{}/signed-url", encode_path_param(bucket)), body).await
    }

    /// Batch create signed download URLs — POST /api/storage/{bucket}/signed-urls
    pub async fn create_signed_download_urls(&self, bucket: &str, body: &Value) -> Result<Value, Error> {
        self.http.post(&format!("/api/storage/{}/signed-urls", encode_path_param(bucket)), body).await
    }

    /// Create signed upload URL — POST /api/storage/{bucket}/signed-upload-url
    pub async fn create_signed_upload_url(&self, bucket: &str, body: &Value) -> Result<Value, Error> {
        self.http.post(&format!("/api/storage/{}/signed-upload-url", encode_path_param(bucket)), body).await
    }

    /// Start multipart upload — POST /api/storage/{bucket}/multipart/create
    pub async fn create_multipart_upload(&self, bucket: &str, body: &Value) -> Result<Value, Error> {
        self.http.post(&format!("/api/storage/{}/multipart/create", encode_path_param(bucket)), body).await
    }

    /// Upload a part — POST /api/storage/{bucket}/multipart/upload-part
    pub async fn upload_part(&self, bucket: &str, body: &Value) -> Result<Value, Error> {
        self.http.post(&format!("/api/storage/{}/multipart/upload-part", encode_path_param(bucket)), body).await
    }

    /// Complete multipart upload — POST /api/storage/{bucket}/multipart/complete
    pub async fn complete_multipart_upload(&self, bucket: &str, body: &Value) -> Result<Value, Error> {
        self.http.post(&format!("/api/storage/{}/multipart/complete", encode_path_param(bucket)), body).await
    }

    /// Abort multipart upload — POST /api/storage/{bucket}/multipart/abort
    pub async fn abort_multipart_upload(&self, bucket: &str, body: &Value) -> Result<Value, Error> {
        self.http.post(&format!("/api/storage/{}/multipart/abort", encode_path_param(bucket)), body).await
    }

    /// Get public configuration — GET /api/config
    pub async fn get_config(&self) -> Result<Value, Error> {
        self.http.get("/api/config").await
    }

    /// Register push token — POST /api/push/register
    pub async fn push_register(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/push/register", body).await
    }

    /// Unregister push token — POST /api/push/unregister
    pub async fn push_unregister(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/push/unregister", body).await
    }

    /// Subscribe token to topic — POST /api/push/topic/subscribe
    pub async fn push_topic_subscribe(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/push/topic/subscribe", body).await
    }

    /// Unsubscribe token from topic — POST /api/push/topic/unsubscribe
    pub async fn push_topic_unsubscribe(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/push/topic/unsubscribe", body).await
    }

    /// Check room WebSocket connection prerequisites — GET /api/room/connect-check
    pub async fn check_room_connection(&self, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        self.http.get_with_query("/api/room/connect-check", query).await
    }

    /// Connect to room WebSocket — GET /api/room
    pub async fn connect_room(&self, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        self.http.get_with_query("/api/room", query).await
    }

    /// Get room metadata — GET /api/room/metadata
    pub async fn get_room_metadata(&self, query: &std::collections::HashMap<String, String>) -> Result<Value, Error> {
        self.http.get_with_query("/api/room/metadata", query).await
    }

    /// Track custom events — POST /api/analytics/track
    pub async fn track_events(&self, body: &Value) -> Result<Value, Error> {
        self.http.post("/api/analytics/track", body).await
    }
}

// ─── Path Constants ────────────────────────────────────────────────────────

pub struct ApiPaths;

impl ApiPaths {
    pub const ADMIN_LOGIN: &'static str = "/admin/api/auth/login";
    pub const ADMIN_REFRESH: &'static str = "/admin/api/auth/refresh";
    pub const BACKUP_CLEANUP_PLUGIN: &'static str = "/admin/api/backup/cleanup-plugin";
    pub const BACKUP_GET_CONFIG: &'static str = "/admin/api/backup/config";
    pub const BACKUP_DUMP_CONTROL_D1: &'static str = "/admin/api/backup/dump-control-d1";
    pub const BACKUP_DUMP_D1: &'static str = "/admin/api/backup/dump-d1";
    pub const BACKUP_DUMP_DATA: &'static str = "/admin/api/backup/dump-data";
    pub const BACKUP_DUMP_DO: &'static str = "/admin/api/backup/dump-do";
    pub const BACKUP_DUMP_STORAGE: &'static str = "/admin/api/backup/dump-storage";
    pub fn backup_export_table(name: &str) -> String {
        format!("/admin/api/backup/export/{}", name)
    }
    pub const BACKUP_LIST_DOS: &'static str = "/admin/api/backup/list-dos";
    pub const BACKUP_RESTORE_CONTROL_D1: &'static str = "/admin/api/backup/restore-control-d1";
    pub const BACKUP_RESTORE_D1: &'static str = "/admin/api/backup/restore-d1";
    pub const BACKUP_RESTORE_DATA: &'static str = "/admin/api/backup/restore-data";
    pub const BACKUP_RESTORE_DO: &'static str = "/admin/api/backup/restore-do";
    pub const BACKUP_RESTORE_STORAGE: &'static str = "/admin/api/backup/restore-storage";
    pub const BACKUP_RESYNC_USERS_PUBLIC: &'static str = "/admin/api/backup/resync-users-public";
    pub const BACKUP_WIPE_DO: &'static str = "/admin/api/backup/wipe-do";
    pub const ADMIN_LIST_ADMINS: &'static str = "/admin/api/data/admins";
    pub const ADMIN_CREATE_ADMIN: &'static str = "/admin/api/data/admins";
    pub fn admin_delete_admin(id: &str) -> String {
        format!("/admin/api/data/admins/{}", id)
    }
    pub fn admin_change_password(id: &str) -> String {
        format!("/admin/api/data/admins/{}/password", id)
    }
    pub const ADMIN_GET_ANALYTICS: &'static str = "/admin/api/data/analytics";
    pub const ADMIN_GET_ANALYTICS_EVENTS: &'static str = "/admin/api/data/analytics/events";
    pub const ADMIN_GET_AUTH_SETTINGS: &'static str = "/admin/api/data/auth/settings";
    pub const ADMIN_BACKUP_GET_CONFIG: &'static str = "/admin/api/data/backup/config";
    pub const ADMIN_BACKUP_DUMP_D1: &'static str = "/admin/api/data/backup/dump-d1";
    pub const ADMIN_BACKUP_DUMP_DATA: &'static str = "/admin/api/data/backup/dump-data";
    pub const ADMIN_BACKUP_DUMP_DO: &'static str = "/admin/api/data/backup/dump-do";
    pub const ADMIN_BACKUP_LIST_DOS: &'static str = "/admin/api/data/backup/list-dos";
    pub const ADMIN_BACKUP_RESTORE_D1: &'static str = "/admin/api/data/backup/restore-d1";
    pub const ADMIN_BACKUP_RESTORE_DATA: &'static str = "/admin/api/data/backup/restore-data";
    pub const ADMIN_BACKUP_RESTORE_DO: &'static str = "/admin/api/data/backup/restore-do";
    pub const ADMIN_CLEANUP_ANON: &'static str = "/admin/api/data/cleanup-anon";
    pub const ADMIN_GET_CONFIG_INFO: &'static str = "/admin/api/data/config-info";
    pub const ADMIN_DESTROY_APP: &'static str = "/admin/api/data/destroy-app";
    pub const ADMIN_GET_DEV_INFO: &'static str = "/admin/api/data/dev-info";
    pub const ADMIN_GET_EMAIL_TEMPLATES: &'static str = "/admin/api/data/email/templates";
    pub const ADMIN_LIST_FUNCTIONS: &'static str = "/admin/api/data/functions";
    pub const ADMIN_GET_LOGS: &'static str = "/admin/api/data/logs";
    pub const ADMIN_GET_RECENT_LOGS: &'static str = "/admin/api/data/logs/recent";
    pub const ADMIN_GET_MONITORING: &'static str = "/admin/api/data/monitoring";
    pub fn admin_list_namespace_instances(namespace: &str) -> String {
        format!("/admin/api/data/namespaces/{}/instances", namespace)
    }
    pub const ADMIN_GET_OVERVIEW: &'static str = "/admin/api/data/overview";
    pub const ADMIN_GET_PUSH_LOGS: &'static str = "/admin/api/data/push/logs";
    pub const ADMIN_TEST_PUSH_SEND: &'static str = "/admin/api/data/push/test-send";
    pub const ADMIN_GET_PUSH_TOKENS: &'static str = "/admin/api/data/push/tokens";
    pub const ADMIN_RULES_TEST: &'static str = "/admin/api/data/rules-test";
    pub const ADMIN_GET_SCHEMA: &'static str = "/admin/api/data/schema";
    pub const ADMIN_EXECUTE_SQL: &'static str = "/admin/api/data/sql";
    pub const ADMIN_LIST_BUCKETS: &'static str = "/admin/api/data/storage/buckets";
    pub fn admin_list_bucket_objects(name: &str) -> String {
        format!("/admin/api/data/storage/buckets/{}/objects", name)
    }
    pub fn admin_get_bucket_object(name: &str, key: &str) -> String {
        format!("/admin/api/data/storage/buckets/{}/objects/{}", name, key)
    }
    pub fn admin_delete_bucket_object(name: &str, key: &str) -> String {
        format!("/admin/api/data/storage/buckets/{}/objects/{}", name, key)
    }
    pub fn admin_create_signed_url(name: &str) -> String {
        format!("/admin/api/data/storage/buckets/{}/signed-url", name)
    }
    pub fn admin_get_bucket_stats(name: &str) -> String {
        format!("/admin/api/data/storage/buckets/{}/stats", name)
    }
    pub fn admin_upload_file(name: &str) -> String {
        format!("/admin/api/data/storage/buckets/{}/upload", name)
    }
    pub const ADMIN_LIST_TABLES: &'static str = "/admin/api/data/tables";
    pub fn admin_export_table(name: &str) -> String {
        format!("/admin/api/data/tables/{}/export", name)
    }
    pub fn admin_import_table(name: &str) -> String {
        format!("/admin/api/data/tables/{}/import", name)
    }
    pub fn admin_get_table_records(name: &str) -> String {
        format!("/admin/api/data/tables/{}/records", name)
    }
    pub fn admin_create_table_record(name: &str) -> String {
        format!("/admin/api/data/tables/{}/records", name)
    }
    pub fn admin_update_table_record(name: &str, id: &str) -> String {
        format!("/admin/api/data/tables/{}/records/{}", name, id)
    }
    pub fn admin_delete_table_record(name: &str, id: &str) -> String {
        format!("/admin/api/data/tables/{}/records/{}", name, id)
    }
    pub const ADMIN_LIST_USERS: &'static str = "/admin/api/data/users";
    pub const ADMIN_CREATE_USER: &'static str = "/admin/api/data/users";
    pub fn admin_get_user(id: &str) -> String {
        format!("/admin/api/data/users/{}", id)
    }
    pub fn admin_update_user(id: &str) -> String {
        format!("/admin/api/data/users/{}", id)
    }
    pub fn admin_delete_user(id: &str) -> String {
        format!("/admin/api/data/users/{}", id)
    }
    pub fn admin_delete_user_mfa(id: &str) -> String {
        format!("/admin/api/data/users/{}/mfa", id)
    }
    pub fn admin_get_user_profile(id: &str) -> String {
        format!("/admin/api/data/users/{}/profile", id)
    }
    pub fn admin_send_password_reset(id: &str) -> String {
        format!("/admin/api/data/users/{}/send-password-reset", id)
    }
    pub fn admin_delete_user_sessions(id: &str) -> String {
        format!("/admin/api/data/users/{}/sessions", id)
    }
    pub const ADMIN_RESET_PASSWORD: &'static str = "/admin/api/internal/reset-password";
    pub const ADMIN_SETUP: &'static str = "/admin/api/setup";
    pub const ADMIN_SETUP_STATUS: &'static str = "/admin/api/setup/status";
    pub const QUERY_CUSTOM_EVENTS: &'static str = "/api/analytics/events";
    pub const QUERY_ANALYTICS: &'static str = "/api/analytics/query";
    pub const TRACK_EVENTS: &'static str = "/api/analytics/track";
    pub const ADMIN_AUTH_LIST_USERS: &'static str = "/api/auth/admin/users";
    pub const ADMIN_AUTH_CREATE_USER: &'static str = "/api/auth/admin/users";
    pub fn admin_auth_get_user(id: &str) -> String {
        format!("/api/auth/admin/users/{}", id)
    }
    pub fn admin_auth_update_user(id: &str) -> String {
        format!("/api/auth/admin/users/{}", id)
    }
    pub fn admin_auth_delete_user(id: &str) -> String {
        format!("/api/auth/admin/users/{}", id)
    }
    pub fn admin_auth_set_claims(id: &str) -> String {
        format!("/api/auth/admin/users/{}/claims", id)
    }
    pub fn admin_auth_delete_user_mfa(id: &str) -> String {
        format!("/api/auth/admin/users/{}/mfa", id)
    }
    pub fn admin_auth_revoke_user_sessions(id: &str) -> String {
        format!("/api/auth/admin/users/{}/revoke", id)
    }
    pub const ADMIN_AUTH_IMPORT_USERS: &'static str = "/api/auth/admin/users/import";
    pub const AUTH_CHANGE_EMAIL: &'static str = "/api/auth/change-email";
    pub const AUTH_CHANGE_PASSWORD: &'static str = "/api/auth/change-password";
    pub const AUTH_GET_IDENTITIES: &'static str = "/api/auth/identities";
    pub fn auth_delete_identity(identity_id: &str) -> String {
        format!("/api/auth/identities/{}", identity_id)
    }
    pub const AUTH_LINK_EMAIL: &'static str = "/api/auth/link/email";
    pub const AUTH_LINK_PHONE: &'static str = "/api/auth/link/phone";
    pub const AUTH_GET_ME: &'static str = "/api/auth/me";
    pub const AUTH_MFA_FACTORS: &'static str = "/api/auth/mfa/factors";
    pub const AUTH_MFA_RECOVERY: &'static str = "/api/auth/mfa/recovery";
    pub const AUTH_MFA_TOTP_DELETE: &'static str = "/api/auth/mfa/totp";
    pub const AUTH_MFA_TOTP_ENROLL: &'static str = "/api/auth/mfa/totp/enroll";
    pub const AUTH_MFA_TOTP_VERIFY: &'static str = "/api/auth/mfa/totp/verify";
    pub const AUTH_MFA_VERIFY: &'static str = "/api/auth/mfa/verify";
    pub fn oauth_redirect(provider: &str) -> String {
        format!("/api/auth/oauth/{}", provider)
    }
    pub fn oauth_callback(provider: &str) -> String {
        format!("/api/auth/oauth/{}/callback", provider)
    }
    pub fn oauth_link_start(provider: &str) -> String {
        format!("/api/auth/oauth/link/{}", provider)
    }
    pub fn oauth_link_callback(provider: &str) -> String {
        format!("/api/auth/oauth/link/{}/callback", provider)
    }
    pub const AUTH_PASSKEYS_LIST: &'static str = "/api/auth/passkeys";
    pub fn auth_passkeys_delete(credential_id: &str) -> String {
        format!("/api/auth/passkeys/{}", credential_id)
    }
    pub const AUTH_PASSKEYS_AUTH_OPTIONS: &'static str = "/api/auth/passkeys/auth-options";
    pub const AUTH_PASSKEYS_AUTHENTICATE: &'static str = "/api/auth/passkeys/authenticate";
    pub const AUTH_PASSKEYS_REGISTER: &'static str = "/api/auth/passkeys/register";
    pub const AUTH_PASSKEYS_REGISTER_OPTIONS: &'static str = "/api/auth/passkeys/register-options";
    pub const AUTH_UPDATE_PROFILE: &'static str = "/api/auth/profile";
    pub const AUTH_REFRESH: &'static str = "/api/auth/refresh";
    pub const AUTH_REQUEST_EMAIL_VERIFICATION: &'static str = "/api/auth/request-email-verification";
    pub const AUTH_REQUEST_PASSWORD_RESET: &'static str = "/api/auth/request-password-reset";
    pub const AUTH_RESET_PASSWORD: &'static str = "/api/auth/reset-password";
    pub const AUTH_GET_SESSIONS: &'static str = "/api/auth/sessions";
    pub fn auth_delete_session(id: &str) -> String {
        format!("/api/auth/sessions/{}", id)
    }
    pub const AUTH_SIGNIN: &'static str = "/api/auth/signin";
    pub const AUTH_SIGNIN_ANONYMOUS: &'static str = "/api/auth/signin/anonymous";
    pub const AUTH_SIGNIN_EMAIL_OTP: &'static str = "/api/auth/signin/email-otp";
    pub const AUTH_SIGNIN_MAGIC_LINK: &'static str = "/api/auth/signin/magic-link";
    pub const AUTH_SIGNIN_PHONE: &'static str = "/api/auth/signin/phone";
    pub const AUTH_SIGNOUT: &'static str = "/api/auth/signout";
    pub const AUTH_SIGNUP: &'static str = "/api/auth/signup";
    pub const AUTH_VERIFY_EMAIL: &'static str = "/api/auth/verify-email";
    pub const AUTH_VERIFY_EMAIL_CHANGE: &'static str = "/api/auth/verify-email-change";
    pub const AUTH_VERIFY_EMAIL_OTP: &'static str = "/api/auth/verify-email-otp";
    pub const AUTH_VERIFY_LINK_PHONE: &'static str = "/api/auth/verify-link-phone";
    pub const AUTH_VERIFY_MAGIC_LINK: &'static str = "/api/auth/verify-magic-link";
    pub const AUTH_VERIFY_PHONE: &'static str = "/api/auth/verify-phone";
    pub const GET_CONFIG: &'static str = "/api/config";
    pub fn execute_d1_query(database: &str) -> String {
        format!("/api/d1/{}", database)
    }
    pub fn db_list_records(namespace: &str, instance_id: &str, table: &str) -> String {
        format!("/api/db/{}/{}/tables/{}", namespace, instance_id, table)
    }
    pub fn db_insert_record(namespace: &str, instance_id: &str, table: &str) -> String {
        format!("/api/db/{}/{}/tables/{}", namespace, instance_id, table)
    }
    pub fn db_get_record(namespace: &str, instance_id: &str, table: &str, id: &str) -> String {
        format!("/api/db/{}/{}/tables/{}/{}", namespace, instance_id, table, id)
    }
    pub fn db_update_record(namespace: &str, instance_id: &str, table: &str, id: &str) -> String {
        format!("/api/db/{}/{}/tables/{}/{}", namespace, instance_id, table, id)
    }
    pub fn db_delete_record(namespace: &str, instance_id: &str, table: &str, id: &str) -> String {
        format!("/api/db/{}/{}/tables/{}/{}", namespace, instance_id, table, id)
    }
    pub fn db_batch_records(namespace: &str, instance_id: &str, table: &str) -> String {
        format!("/api/db/{}/{}/tables/{}/batch", namespace, instance_id, table)
    }
    pub fn db_batch_by_filter(namespace: &str, instance_id: &str, table: &str) -> String {
        format!("/api/db/{}/{}/tables/{}/batch-by-filter", namespace, instance_id, table)
    }
    pub fn db_count_records(namespace: &str, instance_id: &str, table: &str) -> String {
        format!("/api/db/{}/{}/tables/{}/count", namespace, instance_id, table)
    }
    pub fn db_search_records(namespace: &str, instance_id: &str, table: &str) -> String {
        format!("/api/db/{}/{}/tables/{}/search", namespace, instance_id, table)
    }
    pub fn db_single_list_records(namespace: &str, table: &str) -> String {
        format!("/api/db/{}/tables/{}", namespace, table)
    }
    pub fn db_single_insert_record(namespace: &str, table: &str) -> String {
        format!("/api/db/{}/tables/{}", namespace, table)
    }
    pub fn db_single_get_record(namespace: &str, table: &str, id: &str) -> String {
        format!("/api/db/{}/tables/{}/{}", namespace, table, id)
    }
    pub fn db_single_update_record(namespace: &str, table: &str, id: &str) -> String {
        format!("/api/db/{}/tables/{}/{}", namespace, table, id)
    }
    pub fn db_single_delete_record(namespace: &str, table: &str, id: &str) -> String {
        format!("/api/db/{}/tables/{}/{}", namespace, table, id)
    }
    pub fn db_single_batch_records(namespace: &str, table: &str) -> String {
        format!("/api/db/{}/tables/{}/batch", namespace, table)
    }
    pub fn db_single_batch_by_filter(namespace: &str, table: &str) -> String {
        format!("/api/db/{}/tables/{}/batch-by-filter", namespace, table)
    }
    pub fn db_single_count_records(namespace: &str, table: &str) -> String {
        format!("/api/db/{}/tables/{}/count", namespace, table)
    }
    pub fn db_single_search_records(namespace: &str, table: &str) -> String {
        format!("/api/db/{}/tables/{}/search", namespace, table)
    }
    pub const DATABASE_LIVE_BROADCAST: &'static str = "/api/db/broadcast";
    pub const CHECK_DATABASE_SUBSCRIPTION_CONNECTION: &'static str = "/api/db/connect-check";
    pub const CONNECT_DATABASE_SUBSCRIPTION: &'static str = "/api/db/subscribe";
    pub const GET_HEALTH: &'static str = "/api/health";
    pub fn kv_operation(namespace: &str) -> String {
        format!("/api/kv/{}", namespace)
    }
    pub const PUSH_BROADCAST: &'static str = "/api/push/broadcast";
    pub const GET_PUSH_LOGS: &'static str = "/api/push/logs";
    pub const PUSH_REGISTER: &'static str = "/api/push/register";
    pub const PUSH_SEND: &'static str = "/api/push/send";
    pub const PUSH_SEND_MANY: &'static str = "/api/push/send-many";
    pub const PUSH_SEND_TO_TOKEN: &'static str = "/api/push/send-to-token";
    pub const PUSH_SEND_TO_TOPIC: &'static str = "/api/push/send-to-topic";
    pub const GET_PUSH_TOKENS: &'static str = "/api/push/tokens";
    pub const PUT_PUSH_TOKENS: &'static str = "/api/push/tokens";
    pub const PATCH_PUSH_TOKENS: &'static str = "/api/push/tokens";
    pub const PUSH_TOPIC_SUBSCRIBE: &'static str = "/api/push/topic/subscribe";
    pub const PUSH_TOPIC_UNSUBSCRIBE: &'static str = "/api/push/topic/unsubscribe";
    pub const PUSH_UNREGISTER: &'static str = "/api/push/unregister";
    pub const CONNECT_ROOM: &'static str = "/api/room";
    pub const CHECK_ROOM_CONNECTION: &'static str = "/api/room/connect-check";
    pub const GET_ROOM_METADATA: &'static str = "/api/room/metadata";
    pub const GET_SCHEMA: &'static str = "/api/schema";
    pub const EXECUTE_SQL: &'static str = "/api/sql";
    pub fn list_files(bucket: &str) -> String {
        format!("/api/storage/{}", bucket)
    }
    pub fn check_file_exists(bucket: &str, key: &str) -> String {
        format!("/api/storage/{}/{}", bucket, key)
    }
    pub fn download_file(bucket: &str, key: &str) -> String {
        format!("/api/storage/{}/{}", bucket, key)
    }
    pub fn delete_file(bucket: &str, key: &str) -> String {
        format!("/api/storage/{}/{}", bucket, key)
    }
    pub fn get_file_metadata(bucket: &str, key: &str) -> String {
        format!("/api/storage/{}/{}/metadata", bucket, key)
    }
    pub fn update_file_metadata(bucket: &str, key: &str) -> String {
        format!("/api/storage/{}/{}/metadata", bucket, key)
    }
    pub fn delete_batch(bucket: &str) -> String {
        format!("/api/storage/{}/delete-batch", bucket)
    }
    pub fn abort_multipart_upload(bucket: &str) -> String {
        format!("/api/storage/{}/multipart/abort", bucket)
    }
    pub fn complete_multipart_upload(bucket: &str) -> String {
        format!("/api/storage/{}/multipart/complete", bucket)
    }
    pub fn create_multipart_upload(bucket: &str) -> String {
        format!("/api/storage/{}/multipart/create", bucket)
    }
    pub fn upload_part(bucket: &str) -> String {
        format!("/api/storage/{}/multipart/upload-part", bucket)
    }
    pub fn create_signed_upload_url(bucket: &str) -> String {
        format!("/api/storage/{}/signed-upload-url", bucket)
    }
    pub fn create_signed_download_url(bucket: &str) -> String {
        format!("/api/storage/{}/signed-url", bucket)
    }
    pub fn create_signed_download_urls(bucket: &str) -> String {
        format!("/api/storage/{}/signed-urls", bucket)
    }
    pub fn upload_file(bucket: &str) -> String {
        format!("/api/storage/{}/upload", bucket)
    }
    pub fn get_upload_parts(bucket: &str, upload_id: &str) -> String {
        format!("/api/storage/{}/uploads/{}/parts", bucket, upload_id)
    }
    pub fn vectorize_operation(index: &str) -> String {
        format!("/api/vectorize/{}", index)
    }
}
