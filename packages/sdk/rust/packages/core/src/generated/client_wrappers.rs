//! Auto-generated client wrapper methods — DO NOT EDIT.
//! Regenerate: npx tsx tools/sdk-codegen/generate.ts
//! Source: wrapper-config.json + openapi.json (0.1.0)

use crate::Error;
use crate::generated::api_core::GeneratedDbApi;
use serde_json::Value;

/// Authentication wrapper methods
pub struct GeneratedAuthMethods<'a> {
    core: &'a GeneratedDbApi<'a>,
}

impl<'a> GeneratedAuthMethods<'a> {
    pub fn new(core: &'a GeneratedDbApi<'a>) -> Self {
        Self { core }
    }

    /// Sign up with email and password
    pub async fn sign_up(&self, body: &Value) -> Result<Value, Error> {
        self.core.auth_signup(body).await
    }

    /// Sign in with email and password
    pub async fn sign_in(&self, body: &Value) -> Result<Value, Error> {
        self.core.auth_signin(body).await
    }

    /// Sign out and revoke refresh token
    pub async fn sign_out(&self, body: &Value) -> Result<Value, Error> {
        self.core.auth_signout(body).await
    }

    /// Sign in anonymously
    pub async fn sign_in_anonymously(&self, body: &Value) -> Result<Value, Error> {
        self.core.auth_signin_anonymous(body).await
    }

    /// Send magic link to email
    pub async fn sign_in_with_magic_link(&self, body: &Value) -> Result<Value, Error> {
        self.core.auth_signin_magic_link(body).await
    }

    /// Verify magic link token
    pub async fn verify_magic_link(&self, body: &Value) -> Result<Value, Error> {
        self.core.auth_verify_magic_link(body).await
    }

    /// Send OTP SMS to phone number
    pub async fn sign_in_with_phone(&self, body: &Value) -> Result<Value, Error> {
        self.core.auth_signin_phone(body).await
    }

    /// Verify phone OTP and create session
    pub async fn verify_phone(&self, body: &Value) -> Result<Value, Error> {
        self.core.auth_verify_phone(body).await
    }

    /// Send OTP code to email
    pub async fn sign_in_with_email_otp(&self, body: &Value) -> Result<Value, Error> {
        self.core.auth_signin_email_otp(body).await
    }

    /// Verify email OTP and create session
    pub async fn verify_email_otp(&self, body: &Value) -> Result<Value, Error> {
        self.core.auth_verify_email_otp(body).await
    }

    /// Link phone number to existing account
    pub async fn link_with_phone(&self, body: &Value) -> Result<Value, Error> {
        self.core.auth_link_phone(body).await
    }

    /// Verify OTP and link phone to account
    pub async fn verify_link_phone(&self, body: &Value) -> Result<Value, Error> {
        self.core.auth_verify_link_phone(body).await
    }

    /// Link email and password to existing account
    pub async fn link_with_email(&self, body: &Value) -> Result<Value, Error> {
        self.core.auth_link_email(body).await
    }

    /// Request email change with password confirmation
    pub async fn change_email(&self, body: &Value) -> Result<Value, Error> {
        self.core.auth_change_email(body).await
    }

    /// Verify email change token
    pub async fn verify_email_change(&self, body: &Value) -> Result<Value, Error> {
        self.core.auth_verify_email_change(body).await
    }

    /// Verify email address with token
    pub async fn verify_email(&self, body: &Value) -> Result<Value, Error> {
        self.core.auth_verify_email(body).await
    }

    /// Request password reset email
    pub async fn request_password_reset(&self, body: &Value) -> Result<Value, Error> {
        self.core.auth_request_password_reset(body).await
    }

    /// Reset password with token
    pub async fn reset_password(&self, body: &Value) -> Result<Value, Error> {
        self.core.auth_reset_password(body).await
    }

    /// Change password for authenticated user
    pub async fn change_password(&self, body: &Value) -> Result<Value, Error> {
        self.core.auth_change_password(body).await
    }

    /// Get current authenticated user info
    pub async fn get_me(&self) -> Result<Value, Error> {
        self.core.auth_get_me().await
    }

    /// Update user profile
    pub async fn update_profile(&self, body: &Value) -> Result<Value, Error> {
        self.core.auth_update_profile(body).await
    }

    /// List active sessions
    pub async fn list_sessions(&self) -> Result<Value, Error> {
        self.core.auth_get_sessions().await
    }

    /// Delete a session
    pub async fn revoke_session(&self, id: &str) -> Result<Value, Error> {
        self.core.auth_delete_session(id).await
    }

    /// Enroll new TOTP factor
    pub async fn enroll_totp(&self) -> Result<Value, Error> {
        self.core.auth_mfa_totp_enroll().await
    }

    /// Confirm TOTP enrollment with code
    pub async fn verify_totp_enrollment(&self, body: &Value) -> Result<Value, Error> {
        self.core.auth_mfa_totp_verify(body).await
    }

    /// Verify MFA code during signin
    pub async fn verify_totp(&self, body: &Value) -> Result<Value, Error> {
        self.core.auth_mfa_verify(body).await
    }

    /// Use recovery code during MFA signin
    pub async fn use_recovery_code(&self, body: &Value) -> Result<Value, Error> {
        self.core.auth_mfa_recovery(body).await
    }

    /// Disable TOTP factor
    pub async fn disable_totp(&self, body: &Value) -> Result<Value, Error> {
        self.core.auth_mfa_totp_delete(body).await
    }

    /// List MFA factors for authenticated user
    pub async fn list_factors(&self) -> Result<Value, Error> {
        self.core.auth_mfa_factors().await
    }

    /// Generate passkey registration options
    pub async fn passkeys_register_options(&self) -> Result<Value, Error> {
        self.core.auth_passkeys_register_options().await
    }

    /// Verify and store passkey registration
    pub async fn passkeys_register(&self, body: &Value) -> Result<Value, Error> {
        self.core.auth_passkeys_register(body).await
    }

    /// Generate passkey authentication options
    pub async fn passkeys_auth_options(&self, body: &Value) -> Result<Value, Error> {
        self.core.auth_passkeys_auth_options(body).await
    }

    /// Authenticate with passkey
    pub async fn passkeys_authenticate(&self, body: &Value) -> Result<Value, Error> {
        self.core.auth_passkeys_authenticate(body).await
    }

    /// List passkeys for authenticated user
    pub async fn passkeys_list(&self) -> Result<Value, Error> {
        self.core.auth_passkeys_list().await
    }

    /// Delete a passkey
    pub async fn passkeys_delete(&self, credential_id: &str) -> Result<Value, Error> {
        self.core.auth_passkeys_delete(credential_id).await
    }
}

/// Storage wrapper methods (bucket-scoped)
pub struct GeneratedStorageMethods<'a> {
    core: &'a GeneratedDbApi<'a>,
}

impl<'a> GeneratedStorageMethods<'a> {
    pub fn new(core: &'a GeneratedDbApi<'a>) -> Self {
        Self { core }
    }

    /// Delete file
    pub async fn delete(&self, bucket: &str, key: &str) -> Result<Value, Error> {
        self.core.delete_file(bucket, key).await
    }

    /// Batch delete files
    pub async fn delete_many(&self, bucket: &str, body: &Value) -> Result<Value, Error> {
        self.core.delete_batch(bucket, body).await
    }

    /// Check if file exists
    pub async fn exists(&self, bucket: &str, key: &str) -> Result<bool, Error> {
        self.core.check_file_exists(bucket, key).await
    }

    /// Get file metadata
    pub async fn get_metadata(&self, bucket: &str, key: &str) -> Result<Value, Error> {
        self.core.get_file_metadata(bucket, key).await
    }

    /// Update file metadata
    pub async fn update_metadata(&self, bucket: &str, key: &str, body: &Value) -> Result<Value, Error> {
        self.core.update_file_metadata(bucket, key, body).await
    }

    /// Create signed download URL
    pub async fn create_signed_url(&self, bucket: &str, body: &Value) -> Result<Value, Error> {
        self.core.create_signed_download_url(bucket, body).await
    }

    /// Batch create signed download URLs
    pub async fn create_signed_urls(&self, bucket: &str, body: &Value) -> Result<Value, Error> {
        self.core.create_signed_download_urls(bucket, body).await
    }

    /// Create signed upload URL
    pub async fn create_signed_upload_url(&self, bucket: &str, body: &Value) -> Result<Value, Error> {
        self.core.create_signed_upload_url(bucket, body).await
    }

    /// Start multipart upload
    pub async fn create_multipart_upload(&self, bucket: &str, body: &Value) -> Result<Value, Error> {
        self.core.create_multipart_upload(bucket, body).await
    }

    /// Complete multipart upload
    pub async fn complete_multipart_upload(&self, bucket: &str, body: &Value) -> Result<Value, Error> {
        self.core.complete_multipart_upload(bucket, body).await
    }

    /// Abort multipart upload
    pub async fn abort_multipart_upload(&self, bucket: &str, body: &Value) -> Result<Value, Error> {
        self.core.abort_multipart_upload(bucket, body).await
    }
}

/// Analytics wrapper methods
pub struct GeneratedAnalyticsMethods<'a> {
    core: &'a GeneratedDbApi<'a>,
}

impl<'a> GeneratedAnalyticsMethods<'a> {
    pub fn new(core: &'a GeneratedDbApi<'a>) -> Self {
        Self { core }
    }

    /// Track custom events
    pub async fn track(&self, body: &Value) -> Result<Value, Error> {
        self.core.track_events(body).await
    }
}
