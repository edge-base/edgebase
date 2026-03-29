"""Auto-generated core API Core — DO NOT EDIT.

Regenerate: npx tsx tools/sdk-codegen/generate.ts
Source: openapi.json (0.1.0)
"""

from __future__ import annotations

import urllib.parse

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from edgebase_core.http_client import HttpClient


class GeneratedDbApi:
    """Generated API methods — calls HttpClient internally."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def get_health(self) -> Any:
        """Health check — GET /api/health"""
        return self._http.get("/health")

    def auth_signup(self, body: Any) -> Any:
        """Sign up with email and password — POST /api/auth/signup"""
        return self._http.post("/auth/signup", body)

    def auth_signin(self, body: Any) -> Any:
        """Sign in with email and password — POST /api/auth/signin"""
        return self._http.post("/auth/signin", body)

    def auth_signin_anonymous(self, body: Any) -> Any:
        """Sign in anonymously — POST /api/auth/signin/anonymous"""
        return self._http.post("/auth/signin/anonymous", body)

    def auth_signin_magic_link(self, body: Any) -> Any:
        """Send magic link to email — POST /api/auth/signin/magic-link"""
        return self._http.post("/auth/signin/magic-link", body)

    def auth_verify_magic_link(self, body: Any) -> Any:
        """Verify magic link token — POST /api/auth/verify-magic-link"""
        return self._http.post("/auth/verify-magic-link", body)

    def auth_signin_phone(self, body: Any) -> Any:
        """Send OTP SMS to phone number — POST /api/auth/signin/phone"""
        return self._http.post("/auth/signin/phone", body)

    def auth_verify_phone(self, body: Any) -> Any:
        """Verify phone OTP and create session — POST /api/auth/verify-phone"""
        return self._http.post("/auth/verify-phone", body)

    def auth_link_phone(self, body: Any) -> Any:
        """Link phone number to existing account — POST /api/auth/link/phone"""
        return self._http.post("/auth/link/phone", body)

    def auth_verify_link_phone(self, body: Any) -> Any:
        """Verify OTP and link phone to account — POST /api/auth/verify-link-phone"""
        return self._http.post("/auth/verify-link-phone", body)

    def auth_signin_email_otp(self, body: Any) -> Any:
        """Send OTP code to email — POST /api/auth/signin/email-otp"""
        return self._http.post("/auth/signin/email-otp", body)

    def auth_verify_email_otp(self, body: Any) -> Any:
        """Verify email OTP and create session — POST /api/auth/verify-email-otp"""
        return self._http.post("/auth/verify-email-otp", body)

    def auth_mfa_totp_enroll(self) -> Any:
        """Enroll new TOTP factor — POST /api/auth/mfa/totp/enroll"""
        return self._http.post("/auth/mfa/totp/enroll")

    def auth_mfa_totp_verify(self, body: Any) -> Any:
        """Confirm TOTP enrollment with code — POST /api/auth/mfa/totp/verify"""
        return self._http.post("/auth/mfa/totp/verify", body)

    def auth_mfa_verify(self, body: Any) -> Any:
        """Verify MFA code during signin — POST /api/auth/mfa/verify"""
        return self._http.post("/auth/mfa/verify", body)

    def auth_mfa_recovery(self, body: Any) -> Any:
        """Use recovery code during MFA signin — POST /api/auth/mfa/recovery"""
        return self._http.post("/auth/mfa/recovery", body)

    def auth_mfa_totp_delete(self, body: Any) -> Any:
        """Disable TOTP factor — DELETE /api/auth/mfa/totp"""
        return self._http.delete("/auth/mfa/totp", body)

    def auth_mfa_factors(self) -> Any:
        """List MFA factors for authenticated user — GET /api/auth/mfa/factors"""
        return self._http.get("/auth/mfa/factors")

    def auth_refresh(self, body: Any) -> Any:
        """Refresh access token — POST /api/auth/refresh"""
        return self._http.post("/auth/refresh", body)

    def auth_signout(self, body: Any) -> Any:
        """Sign out and revoke refresh token — POST /api/auth/signout"""
        return self._http.post("/auth/signout", body)

    def auth_change_password(self, body: Any) -> Any:
        """Change password for authenticated user — POST /api/auth/change-password"""
        return self._http.post("/auth/change-password", body)

    def auth_change_email(self, body: Any) -> Any:
        """Request email change with password confirmation — POST /api/auth/change-email"""
        return self._http.post("/auth/change-email", body)

    def auth_verify_email_change(self, body: Any) -> Any:
        """Verify email change token — POST /api/auth/verify-email-change"""
        return self._http.post("/auth/verify-email-change", body)

    def auth_passkeys_register_options(self) -> Any:
        """Generate passkey registration options — POST /api/auth/passkeys/register-options"""
        return self._http.post("/auth/passkeys/register-options")

    def auth_passkeys_register(self, body: Any) -> Any:
        """Verify and store passkey registration — POST /api/auth/passkeys/register"""
        return self._http.post("/auth/passkeys/register", body)

    def auth_passkeys_auth_options(self, body: Any) -> Any:
        """Generate passkey authentication options — POST /api/auth/passkeys/auth-options"""
        return self._http.post("/auth/passkeys/auth-options", body)

    def auth_passkeys_authenticate(self, body: Any) -> Any:
        """Authenticate with passkey — POST /api/auth/passkeys/authenticate"""
        return self._http.post("/auth/passkeys/authenticate", body)

    def auth_passkeys_list(self) -> Any:
        """List passkeys for authenticated user — GET /api/auth/passkeys"""
        return self._http.get("/auth/passkeys")

    def auth_passkeys_delete(self, credential_id: str) -> Any:
        """Delete a passkey — DELETE /api/auth/passkeys/{credentialId}"""
        return self._http.delete(f"/auth/passkeys/{urllib.parse.quote(credential_id, safe='')}")

    def auth_get_me(self) -> Any:
        """Get current authenticated user info — GET /api/auth/me"""
        return self._http.get("/auth/me")

    def auth_update_profile(self, body: Any) -> Any:
        """Update user profile — PATCH /api/auth/profile"""
        return self._http.patch("/auth/profile", body)

    def auth_get_sessions(self) -> Any:
        """List active sessions — GET /api/auth/sessions"""
        return self._http.get("/auth/sessions")

    def auth_delete_session(self, id: str) -> Any:
        """Delete a session — DELETE /api/auth/sessions/{id}"""
        return self._http.delete(f"/auth/sessions/{urllib.parse.quote(id, safe='')}")

    def auth_get_identities(self) -> Any:
        """List linked sign-in identities for the current user — GET /api/auth/identities"""
        return self._http.get("/auth/identities")

    def auth_delete_identity(self, identity_id: str) -> Any:
        """Unlink a linked sign-in identity — DELETE /api/auth/identities/{identityId}"""
        return self._http.delete(f"/auth/identities/{urllib.parse.quote(identity_id, safe='')}")

    def auth_link_email(self, body: Any) -> Any:
        """Link email and password to existing account — POST /api/auth/link/email"""
        return self._http.post("/auth/link/email", body)

    def auth_request_email_verification(self, body: Any) -> Any:
        """Send a verification email to the current authenticated user — POST /api/auth/request-email-verification"""
        return self._http.post("/auth/request-email-verification", body)

    def auth_verify_email(self, body: Any) -> Any:
        """Verify email address with token — POST /api/auth/verify-email"""
        return self._http.post("/auth/verify-email", body)

    def auth_request_password_reset(self, body: Any) -> Any:
        """Request password reset email — POST /api/auth/request-password-reset"""
        return self._http.post("/auth/request-password-reset", body)

    def auth_reset_password(self, body: Any) -> Any:
        """Reset password with token — POST /api/auth/reset-password"""
        return self._http.post("/auth/reset-password", body)

    def oauth_redirect(self, provider: str) -> Any:
        """Start OAuth redirect — GET /api/auth/oauth/{provider}"""
        return self._http.get(f"/auth/oauth/{urllib.parse.quote(provider, safe='')}")

    def oauth_callback(self, provider: str) -> Any:
        """OAuth callback — GET /api/auth/oauth/{provider}/callback"""
        return self._http.get(f"/auth/oauth/{urllib.parse.quote(provider, safe='')}/callback")

    def oauth_link_start(self, provider: str) -> Any:
        """Start OAuth account linking — POST /api/auth/oauth/link/{provider}"""
        return self._http.post(f"/auth/oauth/link/{urllib.parse.quote(provider, safe='')}")

    def oauth_link_callback(self, provider: str) -> Any:
        """OAuth link callback — GET /api/auth/oauth/link/{provider}/callback"""
        return self._http.get(f"/auth/oauth/link/{urllib.parse.quote(provider, safe='')}/callback")

    def db_single_count_records(self, namespace: str, table: str, query: dict[str, str] | None = None) -> Any:
        """Count records in a single-instance table — GET /api/db/{namespace}/tables/{table}/count"""
        return self._http.get(f"/db/{urllib.parse.quote(namespace, safe='')}/tables/{urllib.parse.quote(table, safe='')}/count", params=query)

    def db_single_search_records(self, namespace: str, table: str, query: dict[str, str] | None = None) -> Any:
        """Search records in a single-instance table — GET /api/db/{namespace}/tables/{table}/search"""
        return self._http.get(f"/db/{urllib.parse.quote(namespace, safe='')}/tables/{urllib.parse.quote(table, safe='')}/search", params=query)

    def db_single_get_record(self, namespace: str, table: str, id: str, query: dict[str, str] | None = None) -> Any:
        """Get a single record from a single-instance table — GET /api/db/{namespace}/tables/{table}/{id}"""
        return self._http.get(f"/db/{urllib.parse.quote(namespace, safe='')}/tables/{urllib.parse.quote(table, safe='')}/{urllib.parse.quote(id, safe='')}", params=query)

    def db_single_update_record(self, namespace: str, table: str, id: str, body: Any) -> Any:
        """Update a record in a single-instance table — PATCH /api/db/{namespace}/tables/{table}/{id}"""
        return self._http.patch(f"/db/{urllib.parse.quote(namespace, safe='')}/tables/{urllib.parse.quote(table, safe='')}/{urllib.parse.quote(id, safe='')}", body)

    def db_single_delete_record(self, namespace: str, table: str, id: str) -> Any:
        """Delete a record from a single-instance table — DELETE /api/db/{namespace}/tables/{table}/{id}"""
        return self._http.delete(f"/db/{urllib.parse.quote(namespace, safe='')}/tables/{urllib.parse.quote(table, safe='')}/{urllib.parse.quote(id, safe='')}")

    def db_single_list_records(self, namespace: str, table: str, query: dict[str, str] | None = None) -> Any:
        """List records from a single-instance table — GET /api/db/{namespace}/tables/{table}"""
        return self._http.get(f"/db/{urllib.parse.quote(namespace, safe='')}/tables/{urllib.parse.quote(table, safe='')}", params=query)

    def db_single_insert_record(self, namespace: str, table: str, body: Any, query: dict[str, str] | None = None) -> Any:
        """Insert a record into a single-instance table — POST /api/db/{namespace}/tables/{table}"""
        return self._http.post(f"/db/{urllib.parse.quote(namespace, safe='')}/tables/{urllib.parse.quote(table, safe='')}", body, params=query)

    def db_single_batch_records(self, namespace: str, table: str, body: Any, query: dict[str, str] | None = None) -> Any:
        """Batch insert records into a single-instance table — POST /api/db/{namespace}/tables/{table}/batch"""
        return self._http.post(f"/db/{urllib.parse.quote(namespace, safe='')}/tables/{urllib.parse.quote(table, safe='')}/batch", body, params=query)

    def db_single_batch_by_filter(self, namespace: str, table: str, body: Any, query: dict[str, str] | None = None) -> Any:
        """Batch update/delete records by filter in a single-instance table — POST /api/db/{namespace}/tables/{table}/batch-by-filter"""
        return self._http.post(f"/db/{urllib.parse.quote(namespace, safe='')}/tables/{urllib.parse.quote(table, safe='')}/batch-by-filter", body, params=query)

    def db_count_records(self, namespace: str, instance_id: str, table: str, query: dict[str, str] | None = None) -> Any:
        """Count records in dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/count"""
        return self._http.get(f"/db/{urllib.parse.quote(namespace, safe='')}/{urllib.parse.quote(instance_id, safe='')}/tables/{urllib.parse.quote(table, safe='')}/count", params=query)

    def db_search_records(self, namespace: str, instance_id: str, table: str, query: dict[str, str] | None = None) -> Any:
        """Search records in dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/search"""
        return self._http.get(f"/db/{urllib.parse.quote(namespace, safe='')}/{urllib.parse.quote(instance_id, safe='')}/tables/{urllib.parse.quote(table, safe='')}/search", params=query)

    def db_get_record(self, namespace: str, instance_id: str, table: str, id: str, query: dict[str, str] | None = None) -> Any:
        """Get single record from dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/{id}"""
        return self._http.get(f"/db/{urllib.parse.quote(namespace, safe='')}/{urllib.parse.quote(instance_id, safe='')}/tables/{urllib.parse.quote(table, safe='')}/{urllib.parse.quote(id, safe='')}", params=query)

    def db_update_record(self, namespace: str, instance_id: str, table: str, id: str, body: Any) -> Any:
        """Update record in dynamic table — PATCH /api/db/{namespace}/{instanceId}/tables/{table}/{id}"""
        return self._http.patch(f"/db/{urllib.parse.quote(namespace, safe='')}/{urllib.parse.quote(instance_id, safe='')}/tables/{urllib.parse.quote(table, safe='')}/{urllib.parse.quote(id, safe='')}", body)

    def db_delete_record(self, namespace: str, instance_id: str, table: str, id: str) -> Any:
        """Delete record from dynamic table — DELETE /api/db/{namespace}/{instanceId}/tables/{table}/{id}"""
        return self._http.delete(f"/db/{urllib.parse.quote(namespace, safe='')}/{urllib.parse.quote(instance_id, safe='')}/tables/{urllib.parse.quote(table, safe='')}/{urllib.parse.quote(id, safe='')}")

    def db_list_records(self, namespace: str, instance_id: str, table: str, query: dict[str, str] | None = None) -> Any:
        """List records from dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}"""
        return self._http.get(f"/db/{urllib.parse.quote(namespace, safe='')}/{urllib.parse.quote(instance_id, safe='')}/tables/{urllib.parse.quote(table, safe='')}", params=query)

    def db_insert_record(self, namespace: str, instance_id: str, table: str, body: Any, query: dict[str, str] | None = None) -> Any:
        """Insert record into dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table}"""
        return self._http.post(f"/db/{urllib.parse.quote(namespace, safe='')}/{urllib.parse.quote(instance_id, safe='')}/tables/{urllib.parse.quote(table, safe='')}", body, params=query)

    def db_batch_records(self, namespace: str, instance_id: str, table: str, body: Any, query: dict[str, str] | None = None) -> Any:
        """Batch insert records into dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table}/batch"""
        return self._http.post(f"/db/{urllib.parse.quote(namespace, safe='')}/{urllib.parse.quote(instance_id, safe='')}/tables/{urllib.parse.quote(table, safe='')}/batch", body, params=query)

    def db_batch_by_filter(self, namespace: str, instance_id: str, table: str, body: Any, query: dict[str, str] | None = None) -> Any:
        """Batch update/delete records by filter in dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table}/batch-by-filter"""
        return self._http.post(f"/db/{urllib.parse.quote(namespace, safe='')}/{urllib.parse.quote(instance_id, safe='')}/tables/{urllib.parse.quote(table, safe='')}/batch-by-filter", body, params=query)

    def check_database_subscription_connection(self, query: dict[str, str] | None = None) -> Any:
        """Check database live subscription WebSocket prerequisites — GET /api/db/connect-check"""
        return self._http.get("/db/connect-check", params=query)

    def connect_database_subscription(self, query: dict[str, str] | None = None) -> Any:
        """Connect to database live subscriptions WebSocket — GET /api/db/subscribe"""
        return self._http.get("/db/subscribe", params=query)

    def get_schema(self) -> Any:
        """Get table schema — GET /api/schema"""
        return self._http.get("/schema")

    def upload_file(self, bucket: str, body: Any) -> Any:
        """Upload file — POST /api/storage/{bucket}/upload"""
        return self._http.post(f"/storage/{urllib.parse.quote(bucket, safe='')}/upload", body)

    def get_file_metadata(self, bucket: str, key: str) -> Any:
        """Get file metadata — GET /api/storage/{bucket}/{key}/metadata"""
        return self._http.get(f"/storage/{urllib.parse.quote(bucket, safe='')}/{urllib.parse.quote(key, safe='')}/metadata")

    def update_file_metadata(self, bucket: str, key: str, body: Any) -> Any:
        """Update file metadata — PATCH /api/storage/{bucket}/{key}/metadata"""
        return self._http.patch(f"/storage/{urllib.parse.quote(bucket, safe='')}/{urllib.parse.quote(key, safe='')}/metadata", body)

    def check_file_exists(self, bucket: str, key: str) -> bool:
        """Check if file exists — HEAD /api/storage/{bucket}/{key}"""
        return self._http.head(f"/storage/{urllib.parse.quote(bucket, safe='')}/{urllib.parse.quote(key, safe='')}")

    def download_file(self, bucket: str, key: str) -> Any:
        """Download file — GET /api/storage/{bucket}/{key}"""
        return self._http.get(f"/storage/{urllib.parse.quote(bucket, safe='')}/{urllib.parse.quote(key, safe='')}")

    def delete_file(self, bucket: str, key: str) -> Any:
        """Delete file — DELETE /api/storage/{bucket}/{key}"""
        return self._http.delete(f"/storage/{urllib.parse.quote(bucket, safe='')}/{urllib.parse.quote(key, safe='')}")

    def get_upload_parts(self, bucket: str, upload_id: str, query: dict[str, str] | None = None) -> Any:
        """Get uploaded parts — GET /api/storage/{bucket}/uploads/{uploadId}/parts"""
        return self._http.get(f"/storage/{urllib.parse.quote(bucket, safe='')}/uploads/{urllib.parse.quote(upload_id, safe='')}/parts", params=query)

    def list_files(self, bucket: str) -> Any:
        """List files in bucket — GET /api/storage/{bucket}"""
        return self._http.get(f"/storage/{urllib.parse.quote(bucket, safe='')}")

    def delete_batch(self, bucket: str, body: Any) -> Any:
        """Batch delete files — POST /api/storage/{bucket}/delete-batch"""
        return self._http.post(f"/storage/{urllib.parse.quote(bucket, safe='')}/delete-batch", body)

    def create_signed_download_url(self, bucket: str, body: Any) -> Any:
        """Create signed download URL — POST /api/storage/{bucket}/signed-url"""
        return self._http.post(f"/storage/{urllib.parse.quote(bucket, safe='')}/signed-url", body)

    def create_signed_download_urls(self, bucket: str, body: Any) -> Any:
        """Batch create signed download URLs — POST /api/storage/{bucket}/signed-urls"""
        return self._http.post(f"/storage/{urllib.parse.quote(bucket, safe='')}/signed-urls", body)

    def create_signed_upload_url(self, bucket: str, body: Any) -> Any:
        """Create signed upload URL — POST /api/storage/{bucket}/signed-upload-url"""
        return self._http.post(f"/storage/{urllib.parse.quote(bucket, safe='')}/signed-upload-url", body)

    def create_multipart_upload(self, bucket: str, body: Any) -> Any:
        """Start multipart upload — POST /api/storage/{bucket}/multipart/create"""
        return self._http.post(f"/storage/{urllib.parse.quote(bucket, safe='')}/multipart/create", body)

    def upload_part(self, bucket: str, body: Any) -> Any:
        """Upload a part — POST /api/storage/{bucket}/multipart/upload-part"""
        return self._http.post(f"/storage/{urllib.parse.quote(bucket, safe='')}/multipart/upload-part", body)

    def complete_multipart_upload(self, bucket: str, body: Any) -> Any:
        """Complete multipart upload — POST /api/storage/{bucket}/multipart/complete"""
        return self._http.post(f"/storage/{urllib.parse.quote(bucket, safe='')}/multipart/complete", body)

    def abort_multipart_upload(self, bucket: str, body: Any) -> Any:
        """Abort multipart upload — POST /api/storage/{bucket}/multipart/abort"""
        return self._http.post(f"/storage/{urllib.parse.quote(bucket, safe='')}/multipart/abort", body)

    def get_config(self) -> Any:
        """Get public configuration — GET /api/config"""
        return self._http.get("/config")

    def push_register(self, body: Any) -> Any:
        """Register push token — POST /api/push/register"""
        return self._http.post("/push/register", body)

    def push_unregister(self, body: Any) -> Any:
        """Unregister push token — POST /api/push/unregister"""
        return self._http.post("/push/unregister", body)

    def push_topic_subscribe(self, body: Any) -> Any:
        """Subscribe token to topic — POST /api/push/topic/subscribe"""
        return self._http.post("/push/topic/subscribe", body)

    def push_topic_unsubscribe(self, body: Any) -> Any:
        """Unsubscribe token from topic — POST /api/push/topic/unsubscribe"""
        return self._http.post("/push/topic/unsubscribe", body)

    def check_room_connection(self, query: dict[str, str] | None = None) -> Any:
        """Check room WebSocket connection prerequisites — GET /api/room/connect-check"""
        return self._http.get("/room/connect-check", params=query)

    def connect_room(self, query: dict[str, str] | None = None) -> Any:
        """Connect to room WebSocket — GET /api/room"""
        return self._http.get("/room", params=query)

    def get_room_metadata(self, query: dict[str, str] | None = None) -> Any:
        """Get room metadata — GET /api/room/metadata"""
        return self._http.get("/room/metadata", params=query)

    def track_events(self, body: Any) -> Any:
        """Track custom events — POST /api/analytics/track"""
        return self._http.post("/analytics/track", body)


class ApiPaths:
    """Auto-generated path constants — DO NOT EDIT."""

    ADMIN_LOGIN = "/admin/api/auth/login"
    ADMIN_REFRESH = "/admin/api/auth/refresh"
    BACKUP_CLEANUP_PLUGIN = "/admin/api/backup/cleanup-plugin"
    BACKUP_GET_CONFIG = "/admin/api/backup/config"
    BACKUP_DUMP_CONTROL_D1 = "/admin/api/backup/dump-control-d1"
    BACKUP_DUMP_D1 = "/admin/api/backup/dump-d1"
    BACKUP_DUMP_DATA = "/admin/api/backup/dump-data"
    BACKUP_DUMP_DO = "/admin/api/backup/dump-do"
    BACKUP_DUMP_STORAGE = "/admin/api/backup/dump-storage"
    BACKUP_LIST_DOS = "/admin/api/backup/list-dos"
    BACKUP_RESTORE_CONTROL_D1 = "/admin/api/backup/restore-control-d1"
    BACKUP_RESTORE_D1 = "/admin/api/backup/restore-d1"
    BACKUP_RESTORE_DATA = "/admin/api/backup/restore-data"
    BACKUP_RESTORE_DO = "/admin/api/backup/restore-do"
    BACKUP_RESTORE_STORAGE = "/admin/api/backup/restore-storage"
    BACKUP_RESYNC_USERS_PUBLIC = "/admin/api/backup/resync-users-public"
    BACKUP_WIPE_DO = "/admin/api/backup/wipe-do"
    ADMIN_LIST_ADMINS = "/admin/api/data/admins"
    ADMIN_CREATE_ADMIN = "/admin/api/data/admins"
    ADMIN_GET_ANALYTICS = "/admin/api/data/analytics"
    ADMIN_GET_ANALYTICS_EVENTS = "/admin/api/data/analytics/events"
    ADMIN_GET_AUTH_SETTINGS = "/admin/api/data/auth/settings"
    ADMIN_BACKUP_GET_CONFIG = "/admin/api/data/backup/config"
    ADMIN_BACKUP_DUMP_D1 = "/admin/api/data/backup/dump-d1"
    ADMIN_BACKUP_DUMP_DATA = "/admin/api/data/backup/dump-data"
    ADMIN_BACKUP_DUMP_DO = "/admin/api/data/backup/dump-do"
    ADMIN_BACKUP_LIST_DOS = "/admin/api/data/backup/list-dos"
    ADMIN_BACKUP_RESTORE_D1 = "/admin/api/data/backup/restore-d1"
    ADMIN_BACKUP_RESTORE_DATA = "/admin/api/data/backup/restore-data"
    ADMIN_BACKUP_RESTORE_DO = "/admin/api/data/backup/restore-do"
    ADMIN_CLEANUP_ANON = "/admin/api/data/cleanup-anon"
    ADMIN_GET_CONFIG_INFO = "/admin/api/data/config-info"
    ADMIN_DESTROY_APP = "/admin/api/data/destroy-app"
    ADMIN_GET_DEV_INFO = "/admin/api/data/dev-info"
    ADMIN_GET_EMAIL_TEMPLATES = "/admin/api/data/email/templates"
    ADMIN_LIST_FUNCTIONS = "/admin/api/data/functions"
    ADMIN_GET_LOGS = "/admin/api/data/logs"
    ADMIN_GET_RECENT_LOGS = "/admin/api/data/logs/recent"
    ADMIN_GET_MONITORING = "/admin/api/data/monitoring"
    ADMIN_GET_OVERVIEW = "/admin/api/data/overview"
    ADMIN_GET_PUSH_LOGS = "/admin/api/data/push/logs"
    ADMIN_TEST_PUSH_SEND = "/admin/api/data/push/test-send"
    ADMIN_GET_PUSH_TOKENS = "/admin/api/data/push/tokens"
    ADMIN_RULES_TEST = "/admin/api/data/rules-test"
    ADMIN_GET_SCHEMA = "/admin/api/data/schema"
    ADMIN_EXECUTE_SQL = "/admin/api/data/sql"
    ADMIN_LIST_BUCKETS = "/admin/api/data/storage/buckets"
    ADMIN_LIST_TABLES = "/admin/api/data/tables"
    ADMIN_LIST_USERS = "/admin/api/data/users"
    ADMIN_CREATE_USER = "/admin/api/data/users"
    ADMIN_RESET_PASSWORD = "/admin/api/internal/reset-password"
    ADMIN_SETUP = "/admin/api/setup"
    ADMIN_SETUP_STATUS = "/admin/api/setup/status"
    QUERY_CUSTOM_EVENTS = "/api/analytics/events"
    QUERY_ANALYTICS = "/api/analytics/query"
    TRACK_EVENTS = "/api/analytics/track"
    ADMIN_AUTH_LIST_USERS = "/api/auth/admin/users"
    ADMIN_AUTH_CREATE_USER = "/api/auth/admin/users"
    ADMIN_AUTH_IMPORT_USERS = "/api/auth/admin/users/import"
    AUTH_CHANGE_EMAIL = "/api/auth/change-email"
    AUTH_CHANGE_PASSWORD = "/api/auth/change-password"
    AUTH_GET_IDENTITIES = "/api/auth/identities"
    AUTH_LINK_EMAIL = "/api/auth/link/email"
    AUTH_LINK_PHONE = "/api/auth/link/phone"
    AUTH_GET_ME = "/api/auth/me"
    AUTH_MFA_FACTORS = "/api/auth/mfa/factors"
    AUTH_MFA_RECOVERY = "/api/auth/mfa/recovery"
    AUTH_MFA_TOTP_DELETE = "/api/auth/mfa/totp"
    AUTH_MFA_TOTP_ENROLL = "/api/auth/mfa/totp/enroll"
    AUTH_MFA_TOTP_VERIFY = "/api/auth/mfa/totp/verify"
    AUTH_MFA_VERIFY = "/api/auth/mfa/verify"
    AUTH_PASSKEYS_LIST = "/api/auth/passkeys"
    AUTH_PASSKEYS_AUTH_OPTIONS = "/api/auth/passkeys/auth-options"
    AUTH_PASSKEYS_AUTHENTICATE = "/api/auth/passkeys/authenticate"
    AUTH_PASSKEYS_REGISTER = "/api/auth/passkeys/register"
    AUTH_PASSKEYS_REGISTER_OPTIONS = "/api/auth/passkeys/register-options"
    AUTH_UPDATE_PROFILE = "/api/auth/profile"
    AUTH_REFRESH = "/api/auth/refresh"
    AUTH_REQUEST_EMAIL_VERIFICATION = "/api/auth/request-email-verification"
    AUTH_REQUEST_PASSWORD_RESET = "/api/auth/request-password-reset"
    AUTH_RESET_PASSWORD = "/api/auth/reset-password"
    AUTH_GET_SESSIONS = "/api/auth/sessions"
    AUTH_SIGNIN = "/api/auth/signin"
    AUTH_SIGNIN_ANONYMOUS = "/api/auth/signin/anonymous"
    AUTH_SIGNIN_EMAIL_OTP = "/api/auth/signin/email-otp"
    AUTH_SIGNIN_MAGIC_LINK = "/api/auth/signin/magic-link"
    AUTH_SIGNIN_PHONE = "/api/auth/signin/phone"
    AUTH_SIGNOUT = "/api/auth/signout"
    AUTH_SIGNUP = "/api/auth/signup"
    AUTH_VERIFY_EMAIL = "/api/auth/verify-email"
    AUTH_VERIFY_EMAIL_CHANGE = "/api/auth/verify-email-change"
    AUTH_VERIFY_EMAIL_OTP = "/api/auth/verify-email-otp"
    AUTH_VERIFY_LINK_PHONE = "/api/auth/verify-link-phone"
    AUTH_VERIFY_MAGIC_LINK = "/api/auth/verify-magic-link"
    AUTH_VERIFY_PHONE = "/api/auth/verify-phone"
    GET_CONFIG = "/api/config"
    DATABASE_LIVE_BROADCAST = "/api/db/broadcast"
    CHECK_DATABASE_SUBSCRIPTION_CONNECTION = "/api/db/connect-check"
    CONNECT_DATABASE_SUBSCRIPTION = "/api/db/subscribe"
    GET_HEALTH = "/api/health"
    PUSH_BROADCAST = "/api/push/broadcast"
    GET_PUSH_LOGS = "/api/push/logs"
    PUSH_REGISTER = "/api/push/register"
    PUSH_SEND = "/api/push/send"
    PUSH_SEND_MANY = "/api/push/send-many"
    PUSH_SEND_TO_TOKEN = "/api/push/send-to-token"
    PUSH_SEND_TO_TOPIC = "/api/push/send-to-topic"
    GET_PUSH_TOKENS = "/api/push/tokens"
    PUT_PUSH_TOKENS = "/api/push/tokens"
    PATCH_PUSH_TOKENS = "/api/push/tokens"
    PUSH_TOPIC_SUBSCRIBE = "/api/push/topic/subscribe"
    PUSH_TOPIC_UNSUBSCRIBE = "/api/push/topic/unsubscribe"
    PUSH_UNREGISTER = "/api/push/unregister"
    CONNECT_ROOM = "/api/room"
    CHECK_ROOM_CONNECTION = "/api/room/connect-check"
    GET_ROOM_METADATA = "/api/room/metadata"
    GET_SCHEMA = "/api/schema"
    EXECUTE_SQL = "/api/sql"

    @staticmethod
    def backup_export_table(name: str) -> str:
        return f"/admin/api/backup/export/{name}"

    @staticmethod
    def admin_delete_admin(id: str) -> str:
        return f"/admin/api/data/admins/{id}"

    @staticmethod
    def admin_change_password(id: str) -> str:
        return f"/admin/api/data/admins/{id}/password"

    @staticmethod
    def admin_list_namespace_instances(namespace: str) -> str:
        return f"/admin/api/data/namespaces/{namespace}/instances"

    @staticmethod
    def admin_list_bucket_objects(name: str) -> str:
        return f"/admin/api/data/storage/buckets/{name}/objects"

    @staticmethod
    def admin_get_bucket_object(name: str, key: str) -> str:
        return f"/admin/api/data/storage/buckets/{name}/objects/{key}"

    @staticmethod
    def admin_delete_bucket_object(name: str, key: str) -> str:
        return f"/admin/api/data/storage/buckets/{name}/objects/{key}"

    @staticmethod
    def admin_create_signed_url(name: str) -> str:
        return f"/admin/api/data/storage/buckets/{name}/signed-url"

    @staticmethod
    def admin_get_bucket_stats(name: str) -> str:
        return f"/admin/api/data/storage/buckets/{name}/stats"

    @staticmethod
    def admin_upload_file(name: str) -> str:
        return f"/admin/api/data/storage/buckets/{name}/upload"

    @staticmethod
    def admin_export_table(name: str) -> str:
        return f"/admin/api/data/tables/{name}/export"

    @staticmethod
    def admin_import_table(name: str) -> str:
        return f"/admin/api/data/tables/{name}/import"

    @staticmethod
    def admin_get_table_records(name: str) -> str:
        return f"/admin/api/data/tables/{name}/records"

    @staticmethod
    def admin_create_table_record(name: str) -> str:
        return f"/admin/api/data/tables/{name}/records"

    @staticmethod
    def admin_update_table_record(name: str, id: str) -> str:
        return f"/admin/api/data/tables/{name}/records/{id}"

    @staticmethod
    def admin_delete_table_record(name: str, id: str) -> str:
        return f"/admin/api/data/tables/{name}/records/{id}"

    @staticmethod
    def admin_get_user(id: str) -> str:
        return f"/admin/api/data/users/{id}"

    @staticmethod
    def admin_update_user(id: str) -> str:
        return f"/admin/api/data/users/{id}"

    @staticmethod
    def admin_delete_user(id: str) -> str:
        return f"/admin/api/data/users/{id}"

    @staticmethod
    def admin_delete_user_mfa(id: str) -> str:
        return f"/admin/api/data/users/{id}/mfa"

    @staticmethod
    def admin_get_user_profile(id: str) -> str:
        return f"/admin/api/data/users/{id}/profile"

    @staticmethod
    def admin_send_password_reset(id: str) -> str:
        return f"/admin/api/data/users/{id}/send-password-reset"

    @staticmethod
    def admin_delete_user_sessions(id: str) -> str:
        return f"/admin/api/data/users/{id}/sessions"

    @staticmethod
    def admin_auth_get_user(id: str) -> str:
        return f"/api/auth/admin/users/{id}"

    @staticmethod
    def admin_auth_update_user(id: str) -> str:
        return f"/api/auth/admin/users/{id}"

    @staticmethod
    def admin_auth_delete_user(id: str) -> str:
        return f"/api/auth/admin/users/{id}"

    @staticmethod
    def admin_auth_set_claims(id: str) -> str:
        return f"/api/auth/admin/users/{id}/claims"

    @staticmethod
    def admin_auth_delete_user_mfa(id: str) -> str:
        return f"/api/auth/admin/users/{id}/mfa"

    @staticmethod
    def admin_auth_revoke_user_sessions(id: str) -> str:
        return f"/api/auth/admin/users/{id}/revoke"

    @staticmethod
    def auth_delete_identity(identity_id: str) -> str:
        return f"/api/auth/identities/{identity_id}"

    @staticmethod
    def oauth_redirect(provider: str) -> str:
        return f"/api/auth/oauth/{provider}"

    @staticmethod
    def oauth_callback(provider: str) -> str:
        return f"/api/auth/oauth/{provider}/callback"

    @staticmethod
    def oauth_link_start(provider: str) -> str:
        return f"/api/auth/oauth/link/{provider}"

    @staticmethod
    def oauth_link_callback(provider: str) -> str:
        return f"/api/auth/oauth/link/{provider}/callback"

    @staticmethod
    def auth_passkeys_delete(credential_id: str) -> str:
        return f"/api/auth/passkeys/{credential_id}"

    @staticmethod
    def auth_delete_session(id: str) -> str:
        return f"/api/auth/sessions/{id}"

    @staticmethod
    def execute_d1_query(database: str) -> str:
        return f"/api/d1/{database}"

    @staticmethod
    def db_list_records(namespace: str, instance_id: str, table: str) -> str:
        return f"/api/db/{namespace}/{instance_id}/tables/{table}"

    @staticmethod
    def db_insert_record(namespace: str, instance_id: str, table: str) -> str:
        return f"/api/db/{namespace}/{instance_id}/tables/{table}"

    @staticmethod
    def db_get_record(namespace: str, instance_id: str, table: str, id: str) -> str:
        return f"/api/db/{namespace}/{instance_id}/tables/{table}/{id}"

    @staticmethod
    def db_update_record(namespace: str, instance_id: str, table: str, id: str) -> str:
        return f"/api/db/{namespace}/{instance_id}/tables/{table}/{id}"

    @staticmethod
    def db_delete_record(namespace: str, instance_id: str, table: str, id: str) -> str:
        return f"/api/db/{namespace}/{instance_id}/tables/{table}/{id}"

    @staticmethod
    def db_batch_records(namespace: str, instance_id: str, table: str) -> str:
        return f"/api/db/{namespace}/{instance_id}/tables/{table}/batch"

    @staticmethod
    def db_batch_by_filter(namespace: str, instance_id: str, table: str) -> str:
        return f"/api/db/{namespace}/{instance_id}/tables/{table}/batch-by-filter"

    @staticmethod
    def db_count_records(namespace: str, instance_id: str, table: str) -> str:
        return f"/api/db/{namespace}/{instance_id}/tables/{table}/count"

    @staticmethod
    def db_search_records(namespace: str, instance_id: str, table: str) -> str:
        return f"/api/db/{namespace}/{instance_id}/tables/{table}/search"

    @staticmethod
    def db_single_list_records(namespace: str, table: str) -> str:
        return f"/api/db/{namespace}/tables/{table}"

    @staticmethod
    def db_single_insert_record(namespace: str, table: str) -> str:
        return f"/api/db/{namespace}/tables/{table}"

    @staticmethod
    def db_single_get_record(namespace: str, table: str, id: str) -> str:
        return f"/api/db/{namespace}/tables/{table}/{id}"

    @staticmethod
    def db_single_update_record(namespace: str, table: str, id: str) -> str:
        return f"/api/db/{namespace}/tables/{table}/{id}"

    @staticmethod
    def db_single_delete_record(namespace: str, table: str, id: str) -> str:
        return f"/api/db/{namespace}/tables/{table}/{id}"

    @staticmethod
    def db_single_batch_records(namespace: str, table: str) -> str:
        return f"/api/db/{namespace}/tables/{table}/batch"

    @staticmethod
    def db_single_batch_by_filter(namespace: str, table: str) -> str:
        return f"/api/db/{namespace}/tables/{table}/batch-by-filter"

    @staticmethod
    def db_single_count_records(namespace: str, table: str) -> str:
        return f"/api/db/{namespace}/tables/{table}/count"

    @staticmethod
    def db_single_search_records(namespace: str, table: str) -> str:
        return f"/api/db/{namespace}/tables/{table}/search"

    @staticmethod
    def kv_operation(namespace: str) -> str:
        return f"/api/kv/{namespace}"

    @staticmethod
    def list_files(bucket: str) -> str:
        return f"/api/storage/{bucket}"

    @staticmethod
    def check_file_exists(bucket: str, key: str) -> str:
        return f"/api/storage/{bucket}/{key}"

    @staticmethod
    def download_file(bucket: str, key: str) -> str:
        return f"/api/storage/{bucket}/{key}"

    @staticmethod
    def delete_file(bucket: str, key: str) -> str:
        return f"/api/storage/{bucket}/{key}"

    @staticmethod
    def get_file_metadata(bucket: str, key: str) -> str:
        return f"/api/storage/{bucket}/{key}/metadata"

    @staticmethod
    def update_file_metadata(bucket: str, key: str) -> str:
        return f"/api/storage/{bucket}/{key}/metadata"

    @staticmethod
    def delete_batch(bucket: str) -> str:
        return f"/api/storage/{bucket}/delete-batch"

    @staticmethod
    def abort_multipart_upload(bucket: str) -> str:
        return f"/api/storage/{bucket}/multipart/abort"

    @staticmethod
    def complete_multipart_upload(bucket: str) -> str:
        return f"/api/storage/{bucket}/multipart/complete"

    @staticmethod
    def create_multipart_upload(bucket: str) -> str:
        return f"/api/storage/{bucket}/multipart/create"

    @staticmethod
    def upload_part(bucket: str) -> str:
        return f"/api/storage/{bucket}/multipart/upload-part"

    @staticmethod
    def create_signed_upload_url(bucket: str) -> str:
        return f"/api/storage/{bucket}/signed-upload-url"

    @staticmethod
    def create_signed_download_url(bucket: str) -> str:
        return f"/api/storage/{bucket}/signed-url"

    @staticmethod
    def create_signed_download_urls(bucket: str) -> str:
        return f"/api/storage/{bucket}/signed-urls"

    @staticmethod
    def upload_file(bucket: str) -> str:
        return f"/api/storage/{bucket}/upload"

    @staticmethod
    def get_upload_parts(bucket: str, upload_id: str) -> str:
        return f"/api/storage/{bucket}/uploads/{upload_id}/parts"

    @staticmethod
    def vectorize_operation(index: str) -> str:
        return f"/api/vectorize/{index}"
