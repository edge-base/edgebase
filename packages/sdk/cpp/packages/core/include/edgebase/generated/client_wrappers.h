// Auto-generated client wrapper methods — DO NOT EDIT.
// Regenerate: npx tsx tools/sdk-codegen/generate.ts
// Source: wrapper-config.json + openapi.json (0.1.0)

#pragma once

#include <string>
#include <map>

namespace client {

struct Result;
class GeneratedDbApi;

/// Authentication wrapper methods
class GeneratedAuthMethods {
public:
  explicit GeneratedAuthMethods(GeneratedDbApi& core) : core_(core) {}

  /// Sign up with email and password
  Result sign_up(const std::string& json_body) const;
  /// Sign in with email and password
  Result sign_in(const std::string& json_body) const;
  /// Sign out and revoke refresh token
  Result sign_out(const std::string& json_body) const;
  /// Sign in anonymously
  Result sign_in_anonymously(const std::string& json_body) const;
  /// Send magic link to email
  Result sign_in_with_magic_link(const std::string& json_body) const;
  /// Verify magic link token
  Result verify_magic_link(const std::string& json_body) const;
  /// Send OTP SMS to phone number
  Result sign_in_with_phone(const std::string& json_body) const;
  /// Verify phone OTP and create session
  Result verify_phone(const std::string& json_body) const;
  /// Send OTP code to email
  Result sign_in_with_email_otp(const std::string& json_body) const;
  /// Verify email OTP and create session
  Result verify_email_otp(const std::string& json_body) const;
  /// Link phone number to existing account
  Result link_with_phone(const std::string& json_body) const;
  /// Verify OTP and link phone to account
  Result verify_link_phone(const std::string& json_body) const;
  /// Link email and password to existing account
  Result link_with_email(const std::string& json_body) const;
  /// Request email change with password confirmation
  Result change_email(const std::string& json_body) const;
  /// Verify email change token
  Result verify_email_change(const std::string& json_body) const;
  /// Verify email address with token
  Result verify_email(const std::string& json_body) const;
  /// Request password reset email
  Result request_password_reset(const std::string& json_body) const;
  /// Reset password with token
  Result reset_password(const std::string& json_body) const;
  /// Change password for authenticated user
  Result change_password(const std::string& json_body) const;
  /// Get current authenticated user info
  Result get_me() const;
  /// Update user profile
  Result update_profile(const std::string& json_body) const;
  /// List active sessions
  Result list_sessions() const;
  /// Delete a session
  Result revoke_session(const std::string& id) const;
  /// Enroll new TOTP factor
  Result enroll_totp() const;
  /// Confirm TOTP enrollment with code
  Result verify_totp_enrollment(const std::string& json_body) const;
  /// Verify MFA code during signin
  Result verify_totp(const std::string& json_body) const;
  /// Use recovery code during MFA signin
  Result use_recovery_code(const std::string& json_body) const;
  /// Disable TOTP factor
  Result disable_totp(const std::string& json_body) const;
  /// List MFA factors for authenticated user
  Result list_factors() const;
  /// Generate passkey registration options
  Result passkeys_register_options() const;
  /// Verify and store passkey registration
  Result passkeys_register(const std::string& json_body) const;
  /// Generate passkey authentication options
  Result passkeys_auth_options(const std::string& json_body) const;
  /// Authenticate with passkey
  Result passkeys_authenticate(const std::string& json_body) const;
  /// List passkeys for authenticated user
  Result passkeys_list() const;
  /// Delete a passkey
  Result passkeys_delete(const std::string& credential_id) const;

private:
  GeneratedDbApi& core_;
};

/// Storage wrapper methods (bucket-scoped)
class GeneratedStorageMethods {
public:
  explicit GeneratedStorageMethods(GeneratedDbApi& core) : core_(core) {}

  /// Delete file
  Result delete(const std::string& bucket, const std::string& key) const;
  /// Batch delete files
  Result delete_many(const std::string& bucket, const std::string& json_body) const;
  /// Check if file exists
  bool exists(const std::string& bucket, const std::string& key) const;
  /// Get file metadata
  Result get_metadata(const std::string& bucket, const std::string& key) const;
  /// Update file metadata
  Result update_metadata(const std::string& bucket, const std::string& key, const std::string& json_body) const;
  /// Create signed download URL
  Result create_signed_url(const std::string& bucket, const std::string& json_body) const;
  /// Batch create signed download URLs
  Result create_signed_urls(const std::string& bucket, const std::string& json_body) const;
  /// Create signed upload URL
  Result create_signed_upload_url(const std::string& bucket, const std::string& json_body) const;
  /// Start multipart upload
  Result create_multipart_upload(const std::string& bucket, const std::string& json_body) const;
  /// Complete multipart upload
  Result complete_multipart_upload(const std::string& bucket, const std::string& json_body) const;
  /// Abort multipart upload
  Result abort_multipart_upload(const std::string& bucket, const std::string& json_body) const;

private:
  GeneratedDbApi& core_;
};

/// Analytics wrapper methods
class GeneratedAnalyticsMethods {
public:
  explicit GeneratedAnalyticsMethods(GeneratedDbApi& core) : core_(core) {}

  /// Track custom events
  Result track(const std::string& json_body) const;

private:
  GeneratedDbApi& core_;
};

} // namespace client
