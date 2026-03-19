<?php

// Auto-generated client wrapper methods — DO NOT EDIT.
// Regenerate: npx tsx tools/sdk-codegen/generate.ts
// Source: wrapper-config.json + openapi.json (0.1.3)

declare(strict_types=1);

namespace EdgeBase\Core\Generated;

/** Authentication wrapper methods */
class GeneratedAuthMethods
{
    protected GeneratedDbApi $core;

    public function __construct(GeneratedDbApi $core)
    {
        $this->core = $core;
    }

    /** Sign up with email and password */
    public function sign_up(mixed $body = null): mixed
    {
        return $this->core->auth_signup($body);
    }

    /** Sign in with email and password */
    public function sign_in(mixed $body = null): mixed
    {
        return $this->core->auth_signin($body);
    }

    /** Sign out and revoke refresh token */
    public function sign_out(mixed $body = null): mixed
    {
        return $this->core->auth_signout($body);
    }

    /** Sign in anonymously */
    public function sign_in_anonymously(mixed $body = null): mixed
    {
        return $this->core->auth_signin_anonymous($body);
    }

    /** Send magic link to email */
    public function sign_in_with_magic_link(mixed $body = null): mixed
    {
        return $this->core->auth_signin_magic_link($body);
    }

    /** Verify magic link token */
    public function verify_magic_link(mixed $body = null): mixed
    {
        return $this->core->auth_verify_magic_link($body);
    }

    /** Send OTP SMS to phone number */
    public function sign_in_with_phone(mixed $body = null): mixed
    {
        return $this->core->auth_signin_phone($body);
    }

    /** Verify phone OTP and create session */
    public function verify_phone(mixed $body = null): mixed
    {
        return $this->core->auth_verify_phone($body);
    }

    /** Send OTP code to email */
    public function sign_in_with_email_otp(mixed $body = null): mixed
    {
        return $this->core->auth_signin_email_otp($body);
    }

    /** Verify email OTP and create session */
    public function verify_email_otp(mixed $body = null): mixed
    {
        return $this->core->auth_verify_email_otp($body);
    }

    /** Link phone number to existing account */
    public function link_with_phone(mixed $body = null): mixed
    {
        return $this->core->auth_link_phone($body);
    }

    /** Verify OTP and link phone to account */
    public function verify_link_phone(mixed $body = null): mixed
    {
        return $this->core->auth_verify_link_phone($body);
    }

    /** Link email and password to existing account */
    public function link_with_email(mixed $body = null): mixed
    {
        return $this->core->auth_link_email($body);
    }

    /** Request email change with password confirmation */
    public function change_email(mixed $body = null): mixed
    {
        return $this->core->auth_change_email($body);
    }

    /** Verify email change token */
    public function verify_email_change(mixed $body = null): mixed
    {
        return $this->core->auth_verify_email_change($body);
    }

    /** Verify email address with token */
    public function verify_email(mixed $body = null): mixed
    {
        return $this->core->auth_verify_email($body);
    }

    /** Request password reset email */
    public function request_password_reset(mixed $body = null): mixed
    {
        return $this->core->auth_request_password_reset($body);
    }

    /** Reset password with token */
    public function reset_password(mixed $body = null): mixed
    {
        return $this->core->auth_reset_password($body);
    }

    /** Change password for authenticated user */
    public function change_password(mixed $body = null): mixed
    {
        return $this->core->auth_change_password($body);
    }

    /** Get current authenticated user info */
    public function get_me(): mixed
    {
        return $this->core->auth_get_me();
    }

    /** Update user profile */
    public function update_profile(mixed $body = null): mixed
    {
        return $this->core->auth_update_profile($body);
    }

    /** List active sessions */
    public function list_sessions(): mixed
    {
        return $this->core->auth_get_sessions();
    }

    /** Delete a session */
    public function revoke_session(string $id): mixed
    {
        return $this->core->auth_delete_session($id);
    }

    /** Enroll new TOTP factor */
    public function enroll_totp(): mixed
    {
        return $this->core->auth_mfa_totp_enroll();
    }

    /** Confirm TOTP enrollment with code */
    public function verify_totp_enrollment(mixed $body = null): mixed
    {
        return $this->core->auth_mfa_totp_verify($body);
    }

    /** Verify MFA code during signin */
    public function verify_totp(mixed $body = null): mixed
    {
        return $this->core->auth_mfa_verify($body);
    }

    /** Use recovery code during MFA signin */
    public function use_recovery_code(mixed $body = null): mixed
    {
        return $this->core->auth_mfa_recovery($body);
    }

    /** Disable TOTP factor */
    public function disable_totp(mixed $body = null): mixed
    {
        return $this->core->auth_mfa_totp_delete($body);
    }

    /** List MFA factors for authenticated user */
    public function list_factors(): mixed
    {
        return $this->core->auth_mfa_factors();
    }

    /** Generate passkey registration options */
    public function passkeys_register_options(): mixed
    {
        return $this->core->auth_passkeys_register_options();
    }

    /** Verify and store passkey registration */
    public function passkeys_register(mixed $body = null): mixed
    {
        return $this->core->auth_passkeys_register($body);
    }

    /** Generate passkey authentication options */
    public function passkeys_auth_options(mixed $body = null): mixed
    {
        return $this->core->auth_passkeys_auth_options($body);
    }

    /** Authenticate with passkey */
    public function passkeys_authenticate(mixed $body = null): mixed
    {
        return $this->core->auth_passkeys_authenticate($body);
    }

    /** List passkeys for authenticated user */
    public function passkeys_list(): mixed
    {
        return $this->core->auth_passkeys_list();
    }

    /** Delete a passkey */
    public function passkeys_delete(string $credential_id): mixed
    {
        return $this->core->auth_passkeys_delete($credential_id);
    }
}

/** Storage wrapper methods (bucket-scoped) */
class GeneratedStorageMethods
{
    protected GeneratedDbApi $core;

    public function __construct(GeneratedDbApi $core)
    {
        $this->core = $core;
    }

    /** Delete file */
    public function delete(string $bucket, string $key): mixed
    {
        return $this->core->delete_file($bucket, $key);
    }

    /** Batch delete files */
    public function delete_many(string $bucket, mixed $body = null): mixed
    {
        return $this->core->delete_batch($bucket, $body);
    }

    /** Check if file exists */
    public function exists(string $bucket, string $key): bool
    {
        return $this->core->check_file_exists($bucket, $key);
    }

    /** Get file metadata */
    public function get_metadata(string $bucket, string $key): mixed
    {
        return $this->core->get_file_metadata($bucket, $key);
    }

    /** Update file metadata */
    public function update_metadata(string $bucket, string $key, mixed $body = null): mixed
    {
        return $this->core->update_file_metadata($bucket, $key, $body);
    }

    /** Create signed download URL */
    public function create_signed_url(string $bucket, mixed $body = null): mixed
    {
        return $this->core->create_signed_download_url($bucket, $body);
    }

    /** Batch create signed download URLs */
    public function create_signed_urls(string $bucket, mixed $body = null): mixed
    {
        return $this->core->create_signed_download_urls($bucket, $body);
    }

    /** Create signed upload URL */
    public function create_signed_upload_url(string $bucket, mixed $body = null): mixed
    {
        return $this->core->create_signed_upload_url($bucket, $body);
    }

    /** Start multipart upload */
    public function create_multipart_upload(string $bucket, mixed $body = null): mixed
    {
        return $this->core->create_multipart_upload($bucket, $body);
    }

    /** Complete multipart upload */
    public function complete_multipart_upload(string $bucket, mixed $body = null): mixed
    {
        return $this->core->complete_multipart_upload($bucket, $body);
    }

    /** Abort multipart upload */
    public function abort_multipart_upload(string $bucket, mixed $body = null): mixed
    {
        return $this->core->abort_multipart_upload($bucket, $body);
    }
}

/** Analytics wrapper methods */
class GeneratedAnalyticsMethods
{
    protected GeneratedDbApi $core;

    public function __construct(GeneratedDbApi $core)
    {
        $this->core = $core;
    }

    /** Track custom events */
    public function track(mixed $body = null): mixed
    {
        return $this->core->track_events($body);
    }
}
