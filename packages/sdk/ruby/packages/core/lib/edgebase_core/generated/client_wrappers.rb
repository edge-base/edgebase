# frozen_string_literal: true

# Auto-generated client wrapper methods — DO NOT EDIT.
#
# Regenerate: npx tsx tools/sdk-codegen/generate.ts
# Source: wrapper-config.json + openapi.json (0.1.0)

module EdgebaseCore
  class GeneratedAuthMethods
    # Authentication wrapper methods

    def initialize(core)
      @core = core
    end

    # Sign up with email and password
    def sign_up(body = nil)
      @core.auth_signup(body)
    end

    # Sign in with email and password
    def sign_in(body = nil)
      @core.auth_signin(body)
    end

    # Sign out and revoke refresh token
    def sign_out(body = nil)
      @core.auth_signout(body)
    end

    # Sign in anonymously
    def sign_in_anonymously(body = nil)
      @core.auth_signin_anonymous(body)
    end

    # Send magic link to email
    def sign_in_with_magic_link(body = nil)
      @core.auth_signin_magic_link(body)
    end

    # Verify magic link token
    def verify_magic_link(body = nil)
      @core.auth_verify_magic_link(body)
    end

    # Send OTP SMS to phone number
    def sign_in_with_phone(body = nil)
      @core.auth_signin_phone(body)
    end

    # Verify phone OTP and create session
    def verify_phone(body = nil)
      @core.auth_verify_phone(body)
    end

    # Send OTP code to email
    def sign_in_with_email_otp(body = nil)
      @core.auth_signin_email_otp(body)
    end

    # Verify email OTP and create session
    def verify_email_otp(body = nil)
      @core.auth_verify_email_otp(body)
    end

    # Link phone number to existing account
    def link_with_phone(body = nil)
      @core.auth_link_phone(body)
    end

    # Verify OTP and link phone to account
    def verify_link_phone(body = nil)
      @core.auth_verify_link_phone(body)
    end

    # Link email and password to existing account
    def link_with_email(body = nil)
      @core.auth_link_email(body)
    end

    # Request email change with password confirmation
    def change_email(body = nil)
      @core.auth_change_email(body)
    end

    # Verify email change token
    def verify_email_change(body = nil)
      @core.auth_verify_email_change(body)
    end

    # Verify email address with token
    def verify_email(body = nil)
      @core.auth_verify_email(body)
    end

    # Request password reset email
    def request_password_reset(body = nil)
      @core.auth_request_password_reset(body)
    end

    # Reset password with token
    def reset_password(body = nil)
      @core.auth_reset_password(body)
    end

    # Change password for authenticated user
    def change_password(body = nil)
      @core.auth_change_password(body)
    end

    # Get current authenticated user info
    def get_me()
      @core.auth_get_me()
    end

    # Update user profile
    def update_profile(body = nil)
      @core.auth_update_profile(body)
    end

    # List active sessions
    def list_sessions()
      @core.auth_get_sessions()
    end

    # Delete a session
    def revoke_session(id)
      @core.auth_delete_session(id)
    end

    # Enroll new TOTP factor
    def enroll_totp()
      @core.auth_mfa_totp_enroll()
    end

    # Confirm TOTP enrollment with code
    def verify_totp_enrollment(body = nil)
      @core.auth_mfa_totp_verify(body)
    end

    # Verify MFA code during signin
    def verify_totp(body = nil)
      @core.auth_mfa_verify(body)
    end

    # Use recovery code during MFA signin
    def use_recovery_code(body = nil)
      @core.auth_mfa_recovery(body)
    end

    # Disable TOTP factor
    def disable_totp(body = nil)
      @core.auth_mfa_totp_delete(body)
    end

    # List MFA factors for authenticated user
    def list_factors()
      @core.auth_mfa_factors()
    end

    # Generate passkey registration options
    def passkeys_register_options()
      @core.auth_passkeys_register_options()
    end

    # Verify and store passkey registration
    def passkeys_register(body = nil)
      @core.auth_passkeys_register(body)
    end

    # Generate passkey authentication options
    def passkeys_auth_options(body = nil)
      @core.auth_passkeys_auth_options(body)
    end

    # Authenticate with passkey
    def passkeys_authenticate(body = nil)
      @core.auth_passkeys_authenticate(body)
    end

    # List passkeys for authenticated user
    def passkeys_list()
      @core.auth_passkeys_list()
    end

    # Delete a passkey
    def passkeys_delete(credential_id)
      @core.auth_passkeys_delete(credential_id)
    end
  end

  class GeneratedStorageMethods
    # Storage wrapper methods (bucket-scoped)

    def initialize(core)
      @core = core
    end

    # Delete file
    def delete(bucket, key)
      @core.delete_file(bucket, key)
    end

    # Batch delete files
    def delete_many(bucket, body = nil)
      @core.delete_batch(bucket, body)
    end

    # Check if file exists
    def exists(bucket, key)
      @core.check_file_exists(bucket, key)
    end

    # Get file metadata
    def get_metadata(bucket, key)
      @core.get_file_metadata(bucket, key)
    end

    # Update file metadata
    def update_metadata(bucket, key, body = nil)
      @core.update_file_metadata(bucket, key, body)
    end

    # Create signed download URL
    def create_signed_url(bucket, body = nil)
      @core.create_signed_download_url(bucket, body)
    end

    # Batch create signed download URLs
    def create_signed_urls(bucket, body = nil)
      @core.create_signed_download_urls(bucket, body)
    end

    # Create signed upload URL
    def create_signed_upload_url(bucket, body = nil)
      @core.create_signed_upload_url(bucket, body)
    end

    # Start multipart upload
    def create_multipart_upload(bucket, body = nil)
      @core.create_multipart_upload(bucket, body)
    end

    # Complete multipart upload
    def complete_multipart_upload(bucket, body = nil)
      @core.complete_multipart_upload(bucket, body)
    end

    # Abort multipart upload
    def abort_multipart_upload(bucket, body = nil)
      @core.abort_multipart_upload(bucket, body)
    end
  end

  class GeneratedAnalyticsMethods
    # Analytics wrapper methods

    def initialize(core)
      @core = core
    end

    # Track custom events
    def track(body = nil)
      @core.track_events(body)
    end
  end

end
