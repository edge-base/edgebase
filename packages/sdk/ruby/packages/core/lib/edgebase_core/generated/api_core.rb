# frozen_string_literal: true

# Auto-generated core API Core — DO NOT EDIT.
#
# Regenerate: npx tsx tools/sdk-codegen/generate.ts
# Source: openapi.json (0.1.0)

require "cgi"

module EdgebaseCore
  class GeneratedDbApi
    # Generated API methods — calls HttpClient internally.

    def initialize(http)
      @http = http
    end

    attr_reader :http

    # Health check — GET /api/health
    def get_health()
      @http.get("/health")
    end

    # Sign up with email and password — POST /api/auth/signup
    def auth_signup(body = nil)
      @http.post("/auth/signup", body)
    end

    # Sign in with email and password — POST /api/auth/signin
    def auth_signin(body = nil)
      @http.post("/auth/signin", body)
    end

    # Sign in anonymously — POST /api/auth/signin/anonymous
    def auth_signin_anonymous(body = nil)
      @http.post("/auth/signin/anonymous", body)
    end

    # Send magic link to email — POST /api/auth/signin/magic-link
    def auth_signin_magic_link(body = nil)
      @http.post("/auth/signin/magic-link", body)
    end

    # Verify magic link token — POST /api/auth/verify-magic-link
    def auth_verify_magic_link(body = nil)
      @http.post("/auth/verify-magic-link", body)
    end

    # Send OTP SMS to phone number — POST /api/auth/signin/phone
    def auth_signin_phone(body = nil)
      @http.post("/auth/signin/phone", body)
    end

    # Verify phone OTP and create session — POST /api/auth/verify-phone
    def auth_verify_phone(body = nil)
      @http.post("/auth/verify-phone", body)
    end

    # Link phone number to existing account — POST /api/auth/link/phone
    def auth_link_phone(body = nil)
      @http.post("/auth/link/phone", body)
    end

    # Verify OTP and link phone to account — POST /api/auth/verify-link-phone
    def auth_verify_link_phone(body = nil)
      @http.post("/auth/verify-link-phone", body)
    end

    # Send OTP code to email — POST /api/auth/signin/email-otp
    def auth_signin_email_otp(body = nil)
      @http.post("/auth/signin/email-otp", body)
    end

    # Verify email OTP and create session — POST /api/auth/verify-email-otp
    def auth_verify_email_otp(body = nil)
      @http.post("/auth/verify-email-otp", body)
    end

    # Enroll new TOTP factor — POST /api/auth/mfa/totp/enroll
    def auth_mfa_totp_enroll()
      @http.post("/auth/mfa/totp/enroll")
    end

    # Confirm TOTP enrollment with code — POST /api/auth/mfa/totp/verify
    def auth_mfa_totp_verify(body = nil)
      @http.post("/auth/mfa/totp/verify", body)
    end

    # Verify MFA code during signin — POST /api/auth/mfa/verify
    def auth_mfa_verify(body = nil)
      @http.post("/auth/mfa/verify", body)
    end

    # Use recovery code during MFA signin — POST /api/auth/mfa/recovery
    def auth_mfa_recovery(body = nil)
      @http.post("/auth/mfa/recovery", body)
    end

    # Disable TOTP factor — DELETE /api/auth/mfa/totp
    def auth_mfa_totp_delete(body = nil)
      @http.delete("/auth/mfa/totp", body)
    end

    # List MFA factors for authenticated user — GET /api/auth/mfa/factors
    def auth_mfa_factors()
      @http.get("/auth/mfa/factors")
    end

    # Refresh access token — POST /api/auth/refresh
    def auth_refresh(body = nil)
      @http.post("/auth/refresh", body)
    end

    # Sign out and revoke refresh token — POST /api/auth/signout
    def auth_signout(body = nil)
      @http.post("/auth/signout", body)
    end

    # Change password for authenticated user — POST /api/auth/change-password
    def auth_change_password(body = nil)
      @http.post("/auth/change-password", body)
    end

    # Request email change with password confirmation — POST /api/auth/change-email
    def auth_change_email(body = nil)
      @http.post("/auth/change-email", body)
    end

    # Verify email change token — POST /api/auth/verify-email-change
    def auth_verify_email_change(body = nil)
      @http.post("/auth/verify-email-change", body)
    end

    # Generate passkey registration options — POST /api/auth/passkeys/register-options
    def auth_passkeys_register_options()
      @http.post("/auth/passkeys/register-options")
    end

    # Verify and store passkey registration — POST /api/auth/passkeys/register
    def auth_passkeys_register(body = nil)
      @http.post("/auth/passkeys/register", body)
    end

    # Generate passkey authentication options — POST /api/auth/passkeys/auth-options
    def auth_passkeys_auth_options(body = nil)
      @http.post("/auth/passkeys/auth-options", body)
    end

    # Authenticate with passkey — POST /api/auth/passkeys/authenticate
    def auth_passkeys_authenticate(body = nil)
      @http.post("/auth/passkeys/authenticate", body)
    end

    # List passkeys for authenticated user — GET /api/auth/passkeys
    def auth_passkeys_list()
      @http.get("/auth/passkeys")
    end

    # Delete a passkey — DELETE /api/auth/passkeys/{credentialId}
    def auth_passkeys_delete(credential_id)
      @http.delete("/auth/passkeys/#{CGI.escape(credential_id).gsub('+', '%20')}")
    end

    # Get current authenticated user info — GET /api/auth/me
    def auth_get_me()
      @http.get("/auth/me")
    end

    # Update user profile — PATCH /api/auth/profile
    def auth_update_profile(body = nil)
      @http.patch("/auth/profile", body)
    end

    # List active sessions — GET /api/auth/sessions
    def auth_get_sessions()
      @http.get("/auth/sessions")
    end

    # Delete a session — DELETE /api/auth/sessions/{id}
    def auth_delete_session(id)
      @http.delete("/auth/sessions/#{CGI.escape(id).gsub('+', '%20')}")
    end

    # List linked sign-in identities for the current user — GET /api/auth/identities
    def auth_get_identities()
      @http.get("/auth/identities")
    end

    # Unlink a linked sign-in identity — DELETE /api/auth/identities/{identityId}
    def auth_delete_identity(identity_id)
      @http.delete("/auth/identities/#{CGI.escape(identity_id).gsub('+', '%20')}")
    end

    # Link email and password to existing account — POST /api/auth/link/email
    def auth_link_email(body = nil)
      @http.post("/auth/link/email", body)
    end

    # Send a verification email to the current authenticated user — POST /api/auth/request-email-verification
    def auth_request_email_verification(body = nil)
      @http.post("/auth/request-email-verification", body)
    end

    # Verify email address with token — POST /api/auth/verify-email
    def auth_verify_email(body = nil)
      @http.post("/auth/verify-email", body)
    end

    # Request password reset email — POST /api/auth/request-password-reset
    def auth_request_password_reset(body = nil)
      @http.post("/auth/request-password-reset", body)
    end

    # Reset password with token — POST /api/auth/reset-password
    def auth_reset_password(body = nil)
      @http.post("/auth/reset-password", body)
    end

    # Start OAuth redirect — GET /api/auth/oauth/{provider}
    def oauth_redirect(provider)
      @http.get("/auth/oauth/#{CGI.escape(provider).gsub('+', '%20')}")
    end

    # OAuth callback — GET /api/auth/oauth/{provider}/callback
    def oauth_callback(provider)
      @http.get("/auth/oauth/#{CGI.escape(provider).gsub('+', '%20')}/callback")
    end

    # Start OAuth account linking — POST /api/auth/oauth/link/{provider}
    def oauth_link_start(provider)
      @http.post("/auth/oauth/link/#{CGI.escape(provider).gsub('+', '%20')}")
    end

    # OAuth link callback — GET /api/auth/oauth/link/{provider}/callback
    def oauth_link_callback(provider)
      @http.get("/auth/oauth/link/#{CGI.escape(provider).gsub('+', '%20')}/callback")
    end

    # Count records in dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/count
    def db_count_records(namespace, instance_id, table, query: nil)
      @http.get("/db/#{CGI.escape(namespace).gsub('+', '%20')}/#{CGI.escape(instance_id).gsub('+', '%20')}/tables/#{CGI.escape(table).gsub('+', '%20')}/count", params: query)
    end

    # Search records in dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/search
    def db_search_records(namespace, instance_id, table, query: nil)
      @http.get("/db/#{CGI.escape(namespace).gsub('+', '%20')}/#{CGI.escape(instance_id).gsub('+', '%20')}/tables/#{CGI.escape(table).gsub('+', '%20')}/search", params: query)
    end

    # Get single record from dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/{id}
    def db_get_record(namespace, instance_id, table, id, query: nil)
      @http.get("/db/#{CGI.escape(namespace).gsub('+', '%20')}/#{CGI.escape(instance_id).gsub('+', '%20')}/tables/#{CGI.escape(table).gsub('+', '%20')}/#{CGI.escape(id).gsub('+', '%20')}", params: query)
    end

    # Update record in dynamic table — PATCH /api/db/{namespace}/{instanceId}/tables/{table}/{id}
    def db_update_record(namespace, instance_id, table, id, body = nil)
      @http.patch("/db/#{CGI.escape(namespace).gsub('+', '%20')}/#{CGI.escape(instance_id).gsub('+', '%20')}/tables/#{CGI.escape(table).gsub('+', '%20')}/#{CGI.escape(id).gsub('+', '%20')}", body)
    end

    # Delete record from dynamic table — DELETE /api/db/{namespace}/{instanceId}/tables/{table}/{id}
    def db_delete_record(namespace, instance_id, table, id)
      @http.delete("/db/#{CGI.escape(namespace).gsub('+', '%20')}/#{CGI.escape(instance_id).gsub('+', '%20')}/tables/#{CGI.escape(table).gsub('+', '%20')}/#{CGI.escape(id).gsub('+', '%20')}")
    end

    # List records from dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}
    def db_list_records(namespace, instance_id, table, query: nil)
      @http.get("/db/#{CGI.escape(namespace).gsub('+', '%20')}/#{CGI.escape(instance_id).gsub('+', '%20')}/tables/#{CGI.escape(table).gsub('+', '%20')}", params: query)
    end

    # Insert record into dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table}
    def db_insert_record(namespace, instance_id, table, body = nil, query: nil)
      @http.post("/db/#{CGI.escape(namespace).gsub('+', '%20')}/#{CGI.escape(instance_id).gsub('+', '%20')}/tables/#{CGI.escape(table).gsub('+', '%20')}", body, params: query)
    end

    # Batch insert records into dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table}/batch
    def db_batch_records(namespace, instance_id, table, body = nil, query: nil)
      @http.post("/db/#{CGI.escape(namespace).gsub('+', '%20')}/#{CGI.escape(instance_id).gsub('+', '%20')}/tables/#{CGI.escape(table).gsub('+', '%20')}/batch", body, params: query)
    end

    # Batch update/delete records by filter in dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table}/batch-by-filter
    def db_batch_by_filter(namespace, instance_id, table, body = nil, query: nil)
      @http.post("/db/#{CGI.escape(namespace).gsub('+', '%20')}/#{CGI.escape(instance_id).gsub('+', '%20')}/tables/#{CGI.escape(table).gsub('+', '%20')}/batch-by-filter", body, params: query)
    end

    # Check database live subscription WebSocket prerequisites — GET /api/db/connect-check
    def check_database_subscription_connection(query: nil)
      @http.get("/db/connect-check", params: query)
    end

    # Connect to database live subscriptions WebSocket — GET /api/db/subscribe
    def connect_database_subscription(query: nil)
      @http.get("/db/subscribe", params: query)
    end

    # Get table schema — GET /api/schema
    def get_schema()
      @http.get("/schema")
    end

    # Upload file — POST /api/storage/{bucket}/upload
    def upload_file(bucket, body = nil)
      @http.post("/storage/#{CGI.escape(bucket).gsub('+', '%20')}/upload", body)
    end

    # Get file metadata — GET /api/storage/{bucket}/{key}/metadata
    def get_file_metadata(bucket, key)
      @http.get("/storage/#{CGI.escape(bucket).gsub('+', '%20')}/#{CGI.escape(key).gsub('+', '%20')}/metadata")
    end

    # Update file metadata — PATCH /api/storage/{bucket}/{key}/metadata
    def update_file_metadata(bucket, key, body = nil)
      @http.patch("/storage/#{CGI.escape(bucket).gsub('+', '%20')}/#{CGI.escape(key).gsub('+', '%20')}/metadata", body)
    end

    # Check if file exists — HEAD /api/storage/{bucket}/{key}
    def check_file_exists(bucket, key)
      @http.head("/storage/#{CGI.escape(bucket).gsub('+', '%20')}/#{CGI.escape(key).gsub('+', '%20')}")
    end

    # Download file — GET /api/storage/{bucket}/{key}
    def download_file(bucket, key)
      @http.get("/storage/#{CGI.escape(bucket).gsub('+', '%20')}/#{CGI.escape(key).gsub('+', '%20')}")
    end

    # Delete file — DELETE /api/storage/{bucket}/{key}
    def delete_file(bucket, key)
      @http.delete("/storage/#{CGI.escape(bucket).gsub('+', '%20')}/#{CGI.escape(key).gsub('+', '%20')}")
    end

    # Get uploaded parts — GET /api/storage/{bucket}/uploads/{uploadId}/parts
    def get_upload_parts(bucket, upload_id, query: nil)
      @http.get("/storage/#{CGI.escape(bucket).gsub('+', '%20')}/uploads/#{CGI.escape(upload_id).gsub('+', '%20')}/parts", params: query)
    end

    # List files in bucket — GET /api/storage/{bucket}
    def list_files(bucket)
      @http.get("/storage/#{CGI.escape(bucket).gsub('+', '%20')}")
    end

    # Batch delete files — POST /api/storage/{bucket}/delete-batch
    def delete_batch(bucket, body = nil)
      @http.post("/storage/#{CGI.escape(bucket).gsub('+', '%20')}/delete-batch", body)
    end

    # Create signed download URL — POST /api/storage/{bucket}/signed-url
    def create_signed_download_url(bucket, body = nil)
      @http.post("/storage/#{CGI.escape(bucket).gsub('+', '%20')}/signed-url", body)
    end

    # Batch create signed download URLs — POST /api/storage/{bucket}/signed-urls
    def create_signed_download_urls(bucket, body = nil)
      @http.post("/storage/#{CGI.escape(bucket).gsub('+', '%20')}/signed-urls", body)
    end

    # Create signed upload URL — POST /api/storage/{bucket}/signed-upload-url
    def create_signed_upload_url(bucket, body = nil)
      @http.post("/storage/#{CGI.escape(bucket).gsub('+', '%20')}/signed-upload-url", body)
    end

    # Start multipart upload — POST /api/storage/{bucket}/multipart/create
    def create_multipart_upload(bucket, body = nil)
      @http.post("/storage/#{CGI.escape(bucket).gsub('+', '%20')}/multipart/create", body)
    end

    # Upload a part — POST /api/storage/{bucket}/multipart/upload-part
    def upload_part(bucket, body = nil)
      @http.post("/storage/#{CGI.escape(bucket).gsub('+', '%20')}/multipart/upload-part", body)
    end

    # Complete multipart upload — POST /api/storage/{bucket}/multipart/complete
    def complete_multipart_upload(bucket, body = nil)
      @http.post("/storage/#{CGI.escape(bucket).gsub('+', '%20')}/multipart/complete", body)
    end

    # Abort multipart upload — POST /api/storage/{bucket}/multipart/abort
    def abort_multipart_upload(bucket, body = nil)
      @http.post("/storage/#{CGI.escape(bucket).gsub('+', '%20')}/multipart/abort", body)
    end

    # Get public configuration — GET /api/config
    def get_config()
      @http.get("/config")
    end

    # Register push token — POST /api/push/register
    def push_register(body = nil)
      @http.post("/push/register", body)
    end

    # Unregister push token — POST /api/push/unregister
    def push_unregister(body = nil)
      @http.post("/push/unregister", body)
    end

    # Subscribe token to topic — POST /api/push/topic/subscribe
    def push_topic_subscribe(body = nil)
      @http.post("/push/topic/subscribe", body)
    end

    # Unsubscribe token from topic — POST /api/push/topic/unsubscribe
    def push_topic_unsubscribe(body = nil)
      @http.post("/push/topic/unsubscribe", body)
    end

    # Check room WebSocket connection prerequisites — GET /api/room/connect-check
    def check_room_connection(query: nil)
      @http.get("/room/connect-check", params: query)
    end

    # Connect to room WebSocket — GET /api/room
    def connect_room(query: nil)
      @http.get("/room", params: query)
    end

    # Get room metadata — GET /api/room/metadata
    def get_room_metadata(query: nil)
      @http.get("/room/metadata", params: query)
    end

    # Get the active room realtime media session — GET /api/room/media/realtime/session
    def get_room_realtime_session(query: nil)
      @http.get("/room/media/realtime/session", params: query)
    end

    # Create a room realtime media session — POST /api/room/media/realtime/session
    def create_room_realtime_session(body = nil, query: nil)
      @http.post("/room/media/realtime/session", body, params: query)
    end

    # Generate TURN / ICE credentials for room realtime media — POST /api/room/media/realtime/turn
    def create_room_realtime_ice_servers(body = nil, query: nil)
      @http.post("/room/media/realtime/turn", body, params: query)
    end

    # Add realtime media tracks to a room session — POST /api/room/media/realtime/tracks/new
    def add_room_realtime_tracks(body = nil, query: nil)
      @http.post("/room/media/realtime/tracks/new", body, params: query)
    end

    # Renegotiate a room realtime media session — PUT /api/room/media/realtime/renegotiate
    def renegotiate_room_realtime_session(body = nil, query: nil)
      @http.put("/room/media/realtime/renegotiate", body, params: query)
    end

    # Close room realtime media tracks — PUT /api/room/media/realtime/tracks/close
    def close_room_realtime_tracks(body = nil, query: nil)
      @http.put("/room/media/realtime/tracks/close", body, params: query)
    end

    # Track custom events — POST /api/analytics/track
    def track_events(body = nil)
      @http.post("/analytics/track", body)
    end

    # Count records in a single-instance table — GET /api/db/{namespace}/tables/{table}/count
    def db_single_count_records(namespace, table, query: nil)
      @http.get("/db/#{CGI.escape(namespace).gsub('+', '%20')}/tables/#{CGI.escape(table).gsub('+', '%20')}/count", params: query)
    end

    # Search records in a single-instance table — GET /api/db/{namespace}/tables/{table}/search
    def db_single_search_records(namespace, table, query: nil)
      @http.get("/db/#{CGI.escape(namespace).gsub('+', '%20')}/tables/#{CGI.escape(table).gsub('+', '%20')}/search", params: query)
    end

    # Get a single record from a single-instance table — GET /api/db/{namespace}/tables/{table}/{id}
    def db_single_get_record(namespace, table, id, query: nil)
      @http.get("/db/#{CGI.escape(namespace).gsub('+', '%20')}/tables/#{CGI.escape(table).gsub('+', '%20')}/#{CGI.escape(id).gsub('+', '%20')}", params: query)
    end

    # Update a record in a single-instance table — PATCH /api/db/{namespace}/tables/{table}/{id}
    def db_single_update_record(namespace, table, id, body = nil)
      @http.patch("/db/#{CGI.escape(namespace).gsub('+', '%20')}/tables/#{CGI.escape(table).gsub('+', '%20')}/#{CGI.escape(id).gsub('+', '%20')}", body)
    end

    # Delete a record from a single-instance table — DELETE /api/db/{namespace}/tables/{table}/{id}
    def db_single_delete_record(namespace, table, id)
      @http.delete("/db/#{CGI.escape(namespace).gsub('+', '%20')}/tables/#{CGI.escape(table).gsub('+', '%20')}/#{CGI.escape(id).gsub('+', '%20')}")
    end

    # List records from a single-instance table — GET /api/db/{namespace}/tables/{table}
    def db_single_list_records(namespace, table, query: nil)
      @http.get("/db/#{CGI.escape(namespace).gsub('+', '%20')}/tables/#{CGI.escape(table).gsub('+', '%20')}", params: query)
    end

    # Insert a record into a single-instance table — POST /api/db/{namespace}/tables/{table}
    def db_single_insert_record(namespace, table, body = nil, query: nil)
      @http.post("/db/#{CGI.escape(namespace).gsub('+', '%20')}/tables/#{CGI.escape(table).gsub('+', '%20')}", body, params: query)
    end

    # Batch insert records into a single-instance table — POST /api/db/{namespace}/tables/{table}/batch
    def db_single_batch_records(namespace, table, body = nil, query: nil)
      @http.post("/db/#{CGI.escape(namespace).gsub('+', '%20')}/tables/#{CGI.escape(table).gsub('+', '%20')}/batch", body, params: query)
    end

    # Batch update/delete records by filter in a single-instance table — POST /api/db/{namespace}/tables/{table}/batch-by-filter
    def db_single_batch_by_filter(namespace, table, body = nil, query: nil)
      @http.post("/db/#{CGI.escape(namespace).gsub('+', '%20')}/tables/#{CGI.escape(table).gsub('+', '%20')}/batch-by-filter", body, params: query)
    end
  end


  # Auto-generated path constants — DO NOT EDIT.
  module ApiPaths
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
    ADMIN_BACKUP_DUMP_DO = "/admin/api/data/backup/dump-do"
    ADMIN_BACKUP_LIST_DOS = "/admin/api/data/backup/list-dos"
    ADMIN_BACKUP_RESTORE_D1 = "/admin/api/data/backup/restore-d1"
    ADMIN_BACKUP_RESTORE_DO = "/admin/api/data/backup/restore-do"
    ADMIN_CLEANUP_ANON = "/admin/api/data/cleanup-anon"
    ADMIN_GET_CONFIG_INFO = "/admin/api/data/config-info"
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
    RENEGOTIATE_ROOM_REALTIME_SESSION = "/api/room/media/realtime/renegotiate"
    GET_ROOM_REALTIME_SESSION = "/api/room/media/realtime/session"
    CREATE_ROOM_REALTIME_SESSION = "/api/room/media/realtime/session"
    CLOSE_ROOM_REALTIME_TRACKS = "/api/room/media/realtime/tracks/close"
    ADD_ROOM_REALTIME_TRACKS = "/api/room/media/realtime/tracks/new"
    CREATE_ROOM_REALTIME_ICE_SERVERS = "/api/room/media/realtime/turn"
    GET_ROOM_METADATA = "/api/room/metadata"
    GET_SCHEMA = "/api/schema"
    EXECUTE_SQL = "/api/sql"

    def self.backup_export_table(name)
      "/admin/api/backup/export/#{name}"
    end

    def self.admin_delete_admin(id)
      "/admin/api/data/admins/#{id}"
    end

    def self.admin_change_password(id)
      "/admin/api/data/admins/#{id}/password"
    end

    def self.admin_list_bucket_objects(name)
      "/admin/api/data/storage/buckets/#{name}/objects"
    end

    def self.admin_get_bucket_object(name, key)
      "/admin/api/data/storage/buckets/#{name}/objects/#{key}"
    end

    def self.admin_delete_bucket_object(name, key)
      "/admin/api/data/storage/buckets/#{name}/objects/#{key}"
    end

    def self.admin_create_signed_url(name)
      "/admin/api/data/storage/buckets/#{name}/signed-url"
    end

    def self.admin_get_bucket_stats(name)
      "/admin/api/data/storage/buckets/#{name}/stats"
    end

    def self.admin_upload_file(name)
      "/admin/api/data/storage/buckets/#{name}/upload"
    end

    def self.admin_export_table(name)
      "/admin/api/data/tables/#{name}/export"
    end

    def self.admin_import_table(name)
      "/admin/api/data/tables/#{name}/import"
    end

    def self.admin_get_table_records(name)
      "/admin/api/data/tables/#{name}/records"
    end

    def self.admin_create_table_record(name)
      "/admin/api/data/tables/#{name}/records"
    end

    def self.admin_update_table_record(name, id)
      "/admin/api/data/tables/#{name}/records/#{id}"
    end

    def self.admin_delete_table_record(name, id)
      "/admin/api/data/tables/#{name}/records/#{id}"
    end

    def self.admin_get_user(id)
      "/admin/api/data/users/#{id}"
    end

    def self.admin_update_user(id)
      "/admin/api/data/users/#{id}"
    end

    def self.admin_delete_user(id)
      "/admin/api/data/users/#{id}"
    end

    def self.admin_delete_user_mfa(id)
      "/admin/api/data/users/#{id}/mfa"
    end

    def self.admin_get_user_profile(id)
      "/admin/api/data/users/#{id}/profile"
    end

    def self.admin_send_password_reset(id)
      "/admin/api/data/users/#{id}/send-password-reset"
    end

    def self.admin_delete_user_sessions(id)
      "/admin/api/data/users/#{id}/sessions"
    end

    def self.admin_auth_get_user(id)
      "/api/auth/admin/users/#{id}"
    end

    def self.admin_auth_update_user(id)
      "/api/auth/admin/users/#{id}"
    end

    def self.admin_auth_delete_user(id)
      "/api/auth/admin/users/#{id}"
    end

    def self.admin_auth_set_claims(id)
      "/api/auth/admin/users/#{id}/claims"
    end

    def self.admin_auth_delete_user_mfa(id)
      "/api/auth/admin/users/#{id}/mfa"
    end

    def self.admin_auth_revoke_user_sessions(id)
      "/api/auth/admin/users/#{id}/revoke"
    end

    def self.auth_delete_identity(identity_id)
      "/api/auth/identities/#{identity_id}"
    end

    def self.oauth_redirect(provider)
      "/api/auth/oauth/#{provider}"
    end

    def self.oauth_callback(provider)
      "/api/auth/oauth/#{provider}/callback"
    end

    def self.oauth_link_start(provider)
      "/api/auth/oauth/link/#{provider}"
    end

    def self.oauth_link_callback(provider)
      "/api/auth/oauth/link/#{provider}/callback"
    end

    def self.auth_passkeys_delete(credential_id)
      "/api/auth/passkeys/#{credential_id}"
    end

    def self.auth_delete_session(id)
      "/api/auth/sessions/#{id}"
    end

    def self.execute_d1_query(database)
      "/api/d1/#{database}"
    end

    def self.db_list_records(namespace, instance_id, table)
      "/api/db/#{namespace}/#{instance_id}/tables/#{table}"
    end

    def self.db_insert_record(namespace, instance_id, table)
      "/api/db/#{namespace}/#{instance_id}/tables/#{table}"
    end

    def self.db_get_record(namespace, instance_id, table, id)
      "/api/db/#{namespace}/#{instance_id}/tables/#{table}/#{id}"
    end

    def self.db_update_record(namespace, instance_id, table, id)
      "/api/db/#{namespace}/#{instance_id}/tables/#{table}/#{id}"
    end

    def self.db_delete_record(namespace, instance_id, table, id)
      "/api/db/#{namespace}/#{instance_id}/tables/#{table}/#{id}"
    end

    def self.db_batch_records(namespace, instance_id, table)
      "/api/db/#{namespace}/#{instance_id}/tables/#{table}/batch"
    end

    def self.db_batch_by_filter(namespace, instance_id, table)
      "/api/db/#{namespace}/#{instance_id}/tables/#{table}/batch-by-filter"
    end

    def self.db_count_records(namespace, instance_id, table)
      "/api/db/#{namespace}/#{instance_id}/tables/#{table}/count"
    end

    def self.db_search_records(namespace, instance_id, table)
      "/api/db/#{namespace}/#{instance_id}/tables/#{table}/search"
    end

    def self.db_single_list_records(namespace, table)
      "/api/db/#{namespace}/tables/#{table}"
    end

    def self.db_single_insert_record(namespace, table)
      "/api/db/#{namespace}/tables/#{table}"
    end

    def self.db_single_get_record(namespace, table, id)
      "/api/db/#{namespace}/tables/#{table}/#{id}"
    end

    def self.db_single_update_record(namespace, table, id)
      "/api/db/#{namespace}/tables/#{table}/#{id}"
    end

    def self.db_single_delete_record(namespace, table, id)
      "/api/db/#{namespace}/tables/#{table}/#{id}"
    end

    def self.db_single_batch_records(namespace, table)
      "/api/db/#{namespace}/tables/#{table}/batch"
    end

    def self.db_single_batch_by_filter(namespace, table)
      "/api/db/#{namespace}/tables/#{table}/batch-by-filter"
    end

    def self.db_single_count_records(namespace, table)
      "/api/db/#{namespace}/tables/#{table}/count"
    end

    def self.db_single_search_records(namespace, table)
      "/api/db/#{namespace}/tables/#{table}/search"
    end

    def self.kv_operation(namespace)
      "/api/kv/#{namespace}"
    end

    def self.list_files(bucket)
      "/api/storage/#{bucket}"
    end

    def self.check_file_exists(bucket, key)
      "/api/storage/#{bucket}/#{key}"
    end

    def self.download_file(bucket, key)
      "/api/storage/#{bucket}/#{key}"
    end

    def self.delete_file(bucket, key)
      "/api/storage/#{bucket}/#{key}"
    end

    def self.get_file_metadata(bucket, key)
      "/api/storage/#{bucket}/#{key}/metadata"
    end

    def self.update_file_metadata(bucket, key)
      "/api/storage/#{bucket}/#{key}/metadata"
    end

    def self.delete_batch(bucket)
      "/api/storage/#{bucket}/delete-batch"
    end

    def self.abort_multipart_upload(bucket)
      "/api/storage/#{bucket}/multipart/abort"
    end

    def self.complete_multipart_upload(bucket)
      "/api/storage/#{bucket}/multipart/complete"
    end

    def self.create_multipart_upload(bucket)
      "/api/storage/#{bucket}/multipart/create"
    end

    def self.upload_part(bucket)
      "/api/storage/#{bucket}/multipart/upload-part"
    end

    def self.create_signed_upload_url(bucket)
      "/api/storage/#{bucket}/signed-upload-url"
    end

    def self.create_signed_download_url(bucket)
      "/api/storage/#{bucket}/signed-url"
    end

    def self.create_signed_download_urls(bucket)
      "/api/storage/#{bucket}/signed-urls"
    end

    def self.upload_file(bucket)
      "/api/storage/#{bucket}/upload"
    end

    def self.get_upload_parts(bucket, upload_id)
      "/api/storage/#{bucket}/uploads/#{upload_id}/parts"
    end

    def self.vectorize_operation(index)
      "/api/vectorize/#{index}"
    end
  end

end
