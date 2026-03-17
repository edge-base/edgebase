"""Auto-generated client wrapper methods — DO NOT EDIT.

Regenerate: npx tsx tools/sdk-codegen/generate.ts
Source: wrapper-config.json + openapi.json (0.1.0)
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from edgebase_core.generated.api_core import GeneratedDbApi


class GeneratedAuthMethods:
    """Authentication wrapper methods"""

    def __init__(self, core: GeneratedDbApi) -> None:
        self._core = core

    def sign_up(self, body: Any = None) -> Any:
        """Sign up with email and password"""
        return self._core.auth_signup(body)

    def sign_in(self, body: Any = None) -> Any:
        """Sign in with email and password"""
        return self._core.auth_signin(body)

    def sign_out(self, body: Any = None) -> Any:
        """Sign out and revoke refresh token"""
        return self._core.auth_signout(body)

    def sign_in_anonymously(self, body: Any = None) -> Any:
        """Sign in anonymously"""
        return self._core.auth_signin_anonymous(body)

    def sign_in_with_magic_link(self, body: Any = None) -> Any:
        """Send magic link to email"""
        return self._core.auth_signin_magic_link(body)

    def verify_magic_link(self, body: Any = None) -> Any:
        """Verify magic link token"""
        return self._core.auth_verify_magic_link(body)

    def sign_in_with_phone(self, body: Any = None) -> Any:
        """Send OTP SMS to phone number"""
        return self._core.auth_signin_phone(body)

    def verify_phone(self, body: Any = None) -> Any:
        """Verify phone OTP and create session"""
        return self._core.auth_verify_phone(body)

    def sign_in_with_email_otp(self, body: Any = None) -> Any:
        """Send OTP code to email"""
        return self._core.auth_signin_email_otp(body)

    def verify_email_otp(self, body: Any = None) -> Any:
        """Verify email OTP and create session"""
        return self._core.auth_verify_email_otp(body)

    def link_with_phone(self, body: Any = None) -> Any:
        """Link phone number to existing account"""
        return self._core.auth_link_phone(body)

    def verify_link_phone(self, body: Any = None) -> Any:
        """Verify OTP and link phone to account"""
        return self._core.auth_verify_link_phone(body)

    def link_with_email(self, body: Any = None) -> Any:
        """Link email and password to existing account"""
        return self._core.auth_link_email(body)

    def change_email(self, body: Any = None) -> Any:
        """Request email change with password confirmation"""
        return self._core.auth_change_email(body)

    def verify_email_change(self, body: Any = None) -> Any:
        """Verify email change token"""
        return self._core.auth_verify_email_change(body)

    def verify_email(self, body: Any = None) -> Any:
        """Verify email address with token"""
        return self._core.auth_verify_email(body)

    def request_password_reset(self, body: Any = None) -> Any:
        """Request password reset email"""
        return self._core.auth_request_password_reset(body)

    def reset_password(self, body: Any = None) -> Any:
        """Reset password with token"""
        return self._core.auth_reset_password(body)

    def change_password(self, body: Any = None) -> Any:
        """Change password for authenticated user"""
        return self._core.auth_change_password(body)

    def get_me(self) -> Any:
        """Get current authenticated user info"""
        return self._core.auth_get_me()

    def update_profile(self, body: Any = None) -> Any:
        """Update user profile"""
        return self._core.auth_update_profile(body)

    def list_sessions(self) -> Any:
        """List active sessions"""
        return self._core.auth_get_sessions()

    def revoke_session(self, id: str) -> Any:
        """Delete a session"""
        return self._core.auth_delete_session(id)

    def enroll_totp(self) -> Any:
        """Enroll new TOTP factor"""
        return self._core.auth_mfa_totp_enroll()

    def verify_totp_enrollment(self, body: Any = None) -> Any:
        """Confirm TOTP enrollment with code"""
        return self._core.auth_mfa_totp_verify(body)

    def verify_totp(self, body: Any = None) -> Any:
        """Verify MFA code during signin"""
        return self._core.auth_mfa_verify(body)

    def use_recovery_code(self, body: Any = None) -> Any:
        """Use recovery code during MFA signin"""
        return self._core.auth_mfa_recovery(body)

    def disable_totp(self, body: Any = None) -> Any:
        """Disable TOTP factor"""
        return self._core.auth_mfa_totp_delete(body)

    def list_factors(self) -> Any:
        """List MFA factors for authenticated user"""
        return self._core.auth_mfa_factors()

    def passkeys_register_options(self) -> Any:
        """Generate passkey registration options"""
        return self._core.auth_passkeys_register_options()

    def passkeys_register(self, body: Any = None) -> Any:
        """Verify and store passkey registration"""
        return self._core.auth_passkeys_register(body)

    def passkeys_auth_options(self, body: Any = None) -> Any:
        """Generate passkey authentication options"""
        return self._core.auth_passkeys_auth_options(body)

    def passkeys_authenticate(self, body: Any = None) -> Any:
        """Authenticate with passkey"""
        return self._core.auth_passkeys_authenticate(body)

    def passkeys_list(self) -> Any:
        """List passkeys for authenticated user"""
        return self._core.auth_passkeys_list()

    def passkeys_delete(self, credential_id: str) -> Any:
        """Delete a passkey"""
        return self._core.auth_passkeys_delete(credential_id)


class GeneratedStorageMethods:
    """Storage wrapper methods (bucket-scoped)"""

    def __init__(self, core: GeneratedDbApi) -> None:
        self._core = core

    def delete(self, bucket: str, key: str) -> Any:
        """Delete file"""
        return self._core.delete_file(bucket, key)

    def delete_many(self, bucket: str, body: Any = None) -> Any:
        """Batch delete files"""
        return self._core.delete_batch(bucket, body)

    def exists(self, bucket: str, key: str) -> bool:
        """Check if file exists"""
        return self._core.check_file_exists(bucket, key)

    def get_metadata(self, bucket: str, key: str) -> Any:
        """Get file metadata"""
        return self._core.get_file_metadata(bucket, key)

    def update_metadata(self, bucket: str, key: str, body: Any = None) -> Any:
        """Update file metadata"""
        return self._core.update_file_metadata(bucket, key, body)

    def create_signed_url(self, bucket: str, body: Any = None) -> Any:
        """Create signed download URL"""
        return self._core.create_signed_download_url(bucket, body)

    def create_signed_urls(self, bucket: str, body: Any = None) -> Any:
        """Batch create signed download URLs"""
        return self._core.create_signed_download_urls(bucket, body)

    def create_signed_upload_url(self, bucket: str, body: Any = None) -> Any:
        """Create signed upload URL"""
        return self._core.create_signed_upload_url(bucket, body)

    def create_multipart_upload(self, bucket: str, body: Any = None) -> Any:
        """Start multipart upload"""
        return self._core.create_multipart_upload(bucket, body)

    def complete_multipart_upload(self, bucket: str, body: Any = None) -> Any:
        """Complete multipart upload"""
        return self._core.complete_multipart_upload(bucket, body)

    def abort_multipart_upload(self, bucket: str, body: Any = None) -> Any:
        """Abort multipart upload"""
        return self._core.abort_multipart_upload(bucket, body)


class GeneratedAnalyticsMethods:
    """Analytics wrapper methods"""

    def __init__(self, core: GeneratedDbApi) -> None:
        self._core = core

    def track(self, body: Any = None) -> Any:
        """Track custom events"""
        return self._core.track_events(body)

