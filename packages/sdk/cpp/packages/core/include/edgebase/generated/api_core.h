// Auto-generated core API Core — DO NOT EDIT.
// Regenerate: npx tsx tools/sdk-codegen/generate.ts
// Source: openapi.json (0.1.0)

#pragma once

#include <string>
#include <map>

namespace client {

struct Result;
class HttpClient;

/// Auto-generated API methods.
class GeneratedDbApi {
public:
  explicit GeneratedDbApi(HttpClient& http) : http_(http) {}
  virtual ~GeneratedDbApi() = default;
  HttpClient& getHttp() const { return http_; }

  /// Health check — GET /api/health
  Result get_health() const;
  /// Sign up with email and password — POST /api/auth/signup
  Result auth_signup(const std::string& json_body) const;
  /// Sign in with email and password — POST /api/auth/signin
  Result auth_signin(const std::string& json_body) const;
  /// Sign in anonymously — POST /api/auth/signin/anonymous
  Result auth_signin_anonymous(const std::string& json_body) const;
  /// Send magic link to email — POST /api/auth/signin/magic-link
  Result auth_signin_magic_link(const std::string& json_body) const;
  /// Verify magic link token — POST /api/auth/verify-magic-link
  Result auth_verify_magic_link(const std::string& json_body) const;
  /// Send OTP SMS to phone number — POST /api/auth/signin/phone
  Result auth_signin_phone(const std::string& json_body) const;
  /// Verify phone OTP and create session — POST /api/auth/verify-phone
  Result auth_verify_phone(const std::string& json_body) const;
  /// Link phone number to existing account — POST /api/auth/link/phone
  Result auth_link_phone(const std::string& json_body) const;
  /// Verify OTP and link phone to account — POST /api/auth/verify-link-phone
  Result auth_verify_link_phone(const std::string& json_body) const;
  /// Send OTP code to email — POST /api/auth/signin/email-otp
  Result auth_signin_email_otp(const std::string& json_body) const;
  /// Verify email OTP and create session — POST /api/auth/verify-email-otp
  Result auth_verify_email_otp(const std::string& json_body) const;
  /// Enroll new TOTP factor — POST /api/auth/mfa/totp/enroll
  Result auth_mfa_totp_enroll() const;
  /// Confirm TOTP enrollment with code — POST /api/auth/mfa/totp/verify
  Result auth_mfa_totp_verify(const std::string& json_body) const;
  /// Verify MFA code during signin — POST /api/auth/mfa/verify
  Result auth_mfa_verify(const std::string& json_body) const;
  /// Use recovery code during MFA signin — POST /api/auth/mfa/recovery
  Result auth_mfa_recovery(const std::string& json_body) const;
  /// Disable TOTP factor — DELETE /api/auth/mfa/totp
  Result auth_mfa_totp_delete(const std::string& json_body) const;
  /// List MFA factors for authenticated user — GET /api/auth/mfa/factors
  Result auth_mfa_factors() const;
  /// Refresh access token — POST /api/auth/refresh
  Result auth_refresh(const std::string& json_body) const;
  /// Sign out and revoke refresh token — POST /api/auth/signout
  Result auth_signout(const std::string& json_body) const;
  /// Change password for authenticated user — POST /api/auth/change-password
  Result auth_change_password(const std::string& json_body) const;
  /// Request email change with password confirmation — POST /api/auth/change-email
  Result auth_change_email(const std::string& json_body) const;
  /// Verify email change token — POST /api/auth/verify-email-change
  Result auth_verify_email_change(const std::string& json_body) const;
  /// Generate passkey registration options — POST /api/auth/passkeys/register-options
  Result auth_passkeys_register_options() const;
  /// Verify and store passkey registration — POST /api/auth/passkeys/register
  Result auth_passkeys_register(const std::string& json_body) const;
  /// Generate passkey authentication options — POST /api/auth/passkeys/auth-options
  Result auth_passkeys_auth_options(const std::string& json_body) const;
  /// Authenticate with passkey — POST /api/auth/passkeys/authenticate
  Result auth_passkeys_authenticate(const std::string& json_body) const;
  /// List passkeys for authenticated user — GET /api/auth/passkeys
  Result auth_passkeys_list() const;
  /// Delete a passkey — DELETE /api/auth/passkeys/{credentialId}
  Result auth_passkeys_delete(const std::string& credential_id) const;
  /// Get current authenticated user info — GET /api/auth/me
  Result auth_get_me() const;
  /// Update user profile — PATCH /api/auth/profile
  Result auth_update_profile(const std::string& json_body) const;
  /// List active sessions — GET /api/auth/sessions
  Result auth_get_sessions() const;
  /// Delete a session — DELETE /api/auth/sessions/{id}
  Result auth_delete_session(const std::string& id) const;
  /// List linked sign-in identities for the current user — GET /api/auth/identities
  Result auth_get_identities() const;
  /// Unlink a linked sign-in identity — DELETE /api/auth/identities/{identityId}
  Result auth_delete_identity(const std::string& identity_id) const;
  /// Link email and password to existing account — POST /api/auth/link/email
  Result auth_link_email(const std::string& json_body) const;
  /// Send a verification email to the current authenticated user — POST /api/auth/request-email-verification
  Result auth_request_email_verification(const std::string& json_body) const;
  /// Verify email address with token — POST /api/auth/verify-email
  Result auth_verify_email(const std::string& json_body) const;
  /// Request password reset email — POST /api/auth/request-password-reset
  Result auth_request_password_reset(const std::string& json_body) const;
  /// Reset password with token — POST /api/auth/reset-password
  Result auth_reset_password(const std::string& json_body) const;
  /// Start OAuth redirect — GET /api/auth/oauth/{provider}
  Result oauth_redirect(const std::string& provider) const;
  /// OAuth callback — GET /api/auth/oauth/{provider}/callback
  Result oauth_callback(const std::string& provider) const;
  /// Start OAuth account linking — POST /api/auth/oauth/link/{provider}
  Result oauth_link_start(const std::string& provider) const;
  /// OAuth link callback — GET /api/auth/oauth/link/{provider}/callback
  Result oauth_link_callback(const std::string& provider) const;
  /// Count records in a single-instance table — GET /api/db/{namespace}/tables/{table}/count
  virtual Result db_single_count_records(const std::string& namespace_, const std::string& table, const std::map<std::string, std::string>& query = {}) const;
  /// Search records in a single-instance table — GET /api/db/{namespace}/tables/{table}/search
  virtual Result db_single_search_records(const std::string& namespace_, const std::string& table, const std::map<std::string, std::string>& query = {}) const;
  /// Get a single record from a single-instance table — GET /api/db/{namespace}/tables/{table}/{id}
  virtual Result db_single_get_record(const std::string& namespace_, const std::string& table, const std::string& id, const std::map<std::string, std::string>& query = {}) const;
  /// Update a record in a single-instance table — PATCH /api/db/{namespace}/tables/{table}/{id}
  virtual Result db_single_update_record(const std::string& namespace_, const std::string& table, const std::string& id, const std::string& json_body) const;
  /// Delete a record from a single-instance table — DELETE /api/db/{namespace}/tables/{table}/{id}
  virtual Result db_single_delete_record(const std::string& namespace_, const std::string& table, const std::string& id) const;
  /// List records from a single-instance table — GET /api/db/{namespace}/tables/{table}
  virtual Result db_single_list_records(const std::string& namespace_, const std::string& table, const std::map<std::string, std::string>& query = {}) const;
  /// Insert a record into a single-instance table — POST /api/db/{namespace}/tables/{table}
  virtual Result db_single_insert_record(const std::string& namespace_, const std::string& table, const std::string& json_body, const std::map<std::string, std::string>& query = {}) const;
  /// Batch insert records into a single-instance table — POST /api/db/{namespace}/tables/{table}/batch
  virtual Result db_single_batch_records(const std::string& namespace_, const std::string& table, const std::string& json_body, const std::map<std::string, std::string>& query = {}) const;
  /// Batch update/delete records by filter in a single-instance table — POST /api/db/{namespace}/tables/{table}/batch-by-filter
  virtual Result db_single_batch_by_filter(const std::string& namespace_, const std::string& table, const std::string& json_body, const std::map<std::string, std::string>& query = {}) const;
  /// Count records in dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/count
  Result db_count_records(const std::string& namespace_, const std::string& instance_id, const std::string& table, const std::map<std::string, std::string>& query = {}) const;
  /// Search records in dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/search
  Result db_search_records(const std::string& namespace_, const std::string& instance_id, const std::string& table, const std::map<std::string, std::string>& query = {}) const;
  /// Get single record from dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/{id}
  Result db_get_record(const std::string& namespace_, const std::string& instance_id, const std::string& table, const std::string& id, const std::map<std::string, std::string>& query = {}) const;
  /// Update record in dynamic table — PATCH /api/db/{namespace}/{instanceId}/tables/{table}/{id}
  Result db_update_record(const std::string& namespace_, const std::string& instance_id, const std::string& table, const std::string& id, const std::string& json_body) const;
  /// Delete record from dynamic table — DELETE /api/db/{namespace}/{instanceId}/tables/{table}/{id}
  Result db_delete_record(const std::string& namespace_, const std::string& instance_id, const std::string& table, const std::string& id) const;
  /// List records from dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}
  Result db_list_records(const std::string& namespace_, const std::string& instance_id, const std::string& table, const std::map<std::string, std::string>& query = {}) const;
  /// Insert record into dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table}
  Result db_insert_record(const std::string& namespace_, const std::string& instance_id, const std::string& table, const std::string& json_body, const std::map<std::string, std::string>& query = {}) const;
  /// Batch insert records into dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table}/batch
  Result db_batch_records(const std::string& namespace_, const std::string& instance_id, const std::string& table, const std::string& json_body, const std::map<std::string, std::string>& query = {}) const;
  /// Batch update/delete records by filter in dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table}/batch-by-filter
  Result db_batch_by_filter(const std::string& namespace_, const std::string& instance_id, const std::string& table, const std::string& json_body, const std::map<std::string, std::string>& query = {}) const;
  /// Check database live subscription WebSocket prerequisites — GET /api/db/connect-check
  Result check_database_subscription_connection(const std::map<std::string, std::string>& query = {}) const;
  /// Connect to database live subscriptions WebSocket — GET /api/db/subscribe
  Result connect_database_subscription(const std::map<std::string, std::string>& query = {}) const;
  /// Get table schema — GET /api/schema
  Result get_schema() const;
  /// Upload file — POST /api/storage/{bucket}/upload
  Result upload_file(const std::string& bucket, const std::string& json_body) const;
  /// Get file metadata — GET /api/storage/{bucket}/{key}/metadata
  Result get_file_metadata(const std::string& bucket, const std::string& key) const;
  /// Update file metadata — PATCH /api/storage/{bucket}/{key}/metadata
  Result update_file_metadata(const std::string& bucket, const std::string& key, const std::string& json_body) const;
  /// Check if file exists — HEAD /api/storage/{bucket}/{key}
  bool check_file_exists(const std::string& bucket, const std::string& key) const;
  /// Download file — GET /api/storage/{bucket}/{key}
  Result download_file(const std::string& bucket, const std::string& key) const;
  /// Delete file — DELETE /api/storage/{bucket}/{key}
  Result delete_file(const std::string& bucket, const std::string& key) const;
  /// Get uploaded parts — GET /api/storage/{bucket}/uploads/{uploadId}/parts
  Result get_upload_parts(const std::string& bucket, const std::string& upload_id, const std::map<std::string, std::string>& query = {}) const;
  /// List files in bucket — GET /api/storage/{bucket}
  Result list_files(const std::string& bucket) const;
  /// Batch delete files — POST /api/storage/{bucket}/delete-batch
  Result delete_batch(const std::string& bucket, const std::string& json_body) const;
  /// Create signed download URL — POST /api/storage/{bucket}/signed-url
  Result create_signed_download_url(const std::string& bucket, const std::string& json_body) const;
  /// Batch create signed download URLs — POST /api/storage/{bucket}/signed-urls
  Result create_signed_download_urls(const std::string& bucket, const std::string& json_body) const;
  /// Create signed upload URL — POST /api/storage/{bucket}/signed-upload-url
  Result create_signed_upload_url(const std::string& bucket, const std::string& json_body) const;
  /// Start multipart upload — POST /api/storage/{bucket}/multipart/create
  Result create_multipart_upload(const std::string& bucket, const std::string& json_body) const;
  /// Upload a part — POST /api/storage/{bucket}/multipart/upload-part
  Result upload_part(const std::string& bucket, const std::string& json_body) const;
  /// Complete multipart upload — POST /api/storage/{bucket}/multipart/complete
  Result complete_multipart_upload(const std::string& bucket, const std::string& json_body) const;
  /// Abort multipart upload — POST /api/storage/{bucket}/multipart/abort
  Result abort_multipart_upload(const std::string& bucket, const std::string& json_body) const;
  /// Get public configuration — GET /api/config
  Result get_config() const;
  /// Register push token — POST /api/push/register
  Result push_register(const std::string& json_body) const;
  /// Unregister push token — POST /api/push/unregister
  Result push_unregister(const std::string& json_body) const;
  /// Subscribe token to topic — POST /api/push/topic/subscribe
  Result push_topic_subscribe(const std::string& json_body) const;
  /// Unsubscribe token from topic — POST /api/push/topic/unsubscribe
  Result push_topic_unsubscribe(const std::string& json_body) const;
  /// Check room WebSocket connection prerequisites — GET /api/room/connect-check
  Result check_room_connection(const std::map<std::string, std::string>& query = {}) const;
  /// Connect to room WebSocket — GET /api/room
  Result connect_room(const std::map<std::string, std::string>& query = {}) const;
  /// Get room metadata — GET /api/room/metadata
  Result get_room_metadata(const std::map<std::string, std::string>& query = {}) const;
  /// Get the active room realtime media session — GET /api/room/media/realtime/session
  Result get_room_realtime_session(const std::map<std::string, std::string>& query = {}) const;
  /// Create a room realtime media session — POST /api/room/media/realtime/session
  Result create_room_realtime_session(const std::string& json_body, const std::map<std::string, std::string>& query = {}) const;
  /// Generate TURN / ICE credentials for room realtime media — POST /api/room/media/realtime/turn
  Result create_room_realtime_ice_servers(const std::string& json_body, const std::map<std::string, std::string>& query = {}) const;
  /// Add realtime media tracks to a room session — POST /api/room/media/realtime/tracks/new
  Result add_room_realtime_tracks(const std::string& json_body, const std::map<std::string, std::string>& query = {}) const;
  /// Renegotiate a room realtime media session — PUT /api/room/media/realtime/renegotiate
  Result renegotiate_room_realtime_session(const std::string& json_body, const std::map<std::string, std::string>& query = {}) const;
  /// Close room realtime media tracks — PUT /api/room/media/realtime/tracks/close
  Result close_room_realtime_tracks(const std::string& json_body, const std::map<std::string, std::string>& query = {}) const;
  /// Create a room Cloudflare RealtimeKit session — POST /api/room/media/cloudflare_realtimekit/session
  Result create_room_cloudflare_realtime_kit_session(const std::string& json_body, const std::map<std::string, std::string>& query = {}) const;
  /// Track custom events — POST /api/analytics/track
  Result track_events(const std::string& json_body) const;

protected:
  HttpClient& http_;
};


/// Auto-generated path constants.
namespace ApiPaths {
  constexpr const char* ADMIN_LOGIN = "/admin/api/auth/login";
  constexpr const char* ADMIN_REFRESH = "/admin/api/auth/refresh";
  constexpr const char* BACKUP_CLEANUP_PLUGIN = "/admin/api/backup/cleanup-plugin";
  constexpr const char* BACKUP_GET_CONFIG = "/admin/api/backup/config";
  constexpr const char* BACKUP_DUMP_CONTROL_D1 = "/admin/api/backup/dump-control-d1";
  constexpr const char* BACKUP_DUMP_D1 = "/admin/api/backup/dump-d1";
  constexpr const char* BACKUP_DUMP_DATA = "/admin/api/backup/dump-data";
  constexpr const char* BACKUP_DUMP_DO = "/admin/api/backup/dump-do";
  constexpr const char* BACKUP_DUMP_STORAGE = "/admin/api/backup/dump-storage";
  inline std::string backup_export_table(const std::string& name) {
    return "/admin/api/backup/export/" + name;
  }
  constexpr const char* BACKUP_LIST_DOS = "/admin/api/backup/list-dos";
  constexpr const char* BACKUP_RESTORE_CONTROL_D1 = "/admin/api/backup/restore-control-d1";
  constexpr const char* BACKUP_RESTORE_D1 = "/admin/api/backup/restore-d1";
  constexpr const char* BACKUP_RESTORE_DATA = "/admin/api/backup/restore-data";
  constexpr const char* BACKUP_RESTORE_DO = "/admin/api/backup/restore-do";
  constexpr const char* BACKUP_RESTORE_STORAGE = "/admin/api/backup/restore-storage";
  constexpr const char* BACKUP_RESYNC_USERS_PUBLIC = "/admin/api/backup/resync-users-public";
  constexpr const char* BACKUP_WIPE_DO = "/admin/api/backup/wipe-do";
  constexpr const char* ADMIN_LIST_ADMINS = "/admin/api/data/admins";
  constexpr const char* ADMIN_CREATE_ADMIN = "/admin/api/data/admins";
  inline std::string admin_delete_admin(const std::string& id) {
    return "/admin/api/data/admins/" + id;
  }
  inline std::string admin_change_password(const std::string& id) {
    return "/admin/api/data/admins/" + id + "/password";
  }
  constexpr const char* ADMIN_GET_ANALYTICS = "/admin/api/data/analytics";
  constexpr const char* ADMIN_GET_ANALYTICS_EVENTS = "/admin/api/data/analytics/events";
  constexpr const char* ADMIN_GET_AUTH_SETTINGS = "/admin/api/data/auth/settings";
  constexpr const char* ADMIN_BACKUP_GET_CONFIG = "/admin/api/data/backup/config";
  constexpr const char* ADMIN_BACKUP_DUMP_D1 = "/admin/api/data/backup/dump-d1";
  constexpr const char* ADMIN_BACKUP_DUMP_DATA = "/admin/api/data/backup/dump-data";
  constexpr const char* ADMIN_BACKUP_DUMP_DO = "/admin/api/data/backup/dump-do";
  constexpr const char* ADMIN_BACKUP_LIST_DOS = "/admin/api/data/backup/list-dos";
  constexpr const char* ADMIN_BACKUP_RESTORE_D1 = "/admin/api/data/backup/restore-d1";
  constexpr const char* ADMIN_BACKUP_RESTORE_DATA = "/admin/api/data/backup/restore-data";
  constexpr const char* ADMIN_BACKUP_RESTORE_DO = "/admin/api/data/backup/restore-do";
  constexpr const char* ADMIN_CLEANUP_ANON = "/admin/api/data/cleanup-anon";
  constexpr const char* ADMIN_GET_CONFIG_INFO = "/admin/api/data/config-info";
  constexpr const char* ADMIN_DESTROY_APP = "/admin/api/data/destroy-app";
  constexpr const char* ADMIN_GET_DEV_INFO = "/admin/api/data/dev-info";
  constexpr const char* ADMIN_GET_EMAIL_TEMPLATES = "/admin/api/data/email/templates";
  constexpr const char* ADMIN_LIST_FUNCTIONS = "/admin/api/data/functions";
  constexpr const char* ADMIN_GET_LOGS = "/admin/api/data/logs";
  constexpr const char* ADMIN_GET_RECENT_LOGS = "/admin/api/data/logs/recent";
  constexpr const char* ADMIN_GET_MONITORING = "/admin/api/data/monitoring";
  inline std::string admin_list_namespace_instances(const std::string& namespace_) {
    return "/admin/api/data/namespaces/" + namespace_ + "/instances";
  }
  constexpr const char* ADMIN_GET_OVERVIEW = "/admin/api/data/overview";
  constexpr const char* ADMIN_GET_PUSH_LOGS = "/admin/api/data/push/logs";
  constexpr const char* ADMIN_TEST_PUSH_SEND = "/admin/api/data/push/test-send";
  constexpr const char* ADMIN_GET_PUSH_TOKENS = "/admin/api/data/push/tokens";
  constexpr const char* ADMIN_RULES_TEST = "/admin/api/data/rules-test";
  constexpr const char* ADMIN_GET_SCHEMA = "/admin/api/data/schema";
  constexpr const char* ADMIN_EXECUTE_SQL = "/admin/api/data/sql";
  constexpr const char* ADMIN_LIST_BUCKETS = "/admin/api/data/storage/buckets";
  inline std::string admin_list_bucket_objects(const std::string& name) {
    return "/admin/api/data/storage/buckets/" + name + "/objects";
  }
  inline std::string admin_get_bucket_object(const std::string& name, const std::string& key) {
    return "/admin/api/data/storage/buckets/" + name + "/objects/" + key;
  }
  inline std::string admin_delete_bucket_object(const std::string& name, const std::string& key) {
    return "/admin/api/data/storage/buckets/" + name + "/objects/" + key;
  }
  inline std::string admin_create_signed_url(const std::string& name) {
    return "/admin/api/data/storage/buckets/" + name + "/signed-url";
  }
  inline std::string admin_get_bucket_stats(const std::string& name) {
    return "/admin/api/data/storage/buckets/" + name + "/stats";
  }
  inline std::string admin_upload_file(const std::string& name) {
    return "/admin/api/data/storage/buckets/" + name + "/upload";
  }
  constexpr const char* ADMIN_LIST_TABLES = "/admin/api/data/tables";
  inline std::string admin_export_table(const std::string& name) {
    return "/admin/api/data/tables/" + name + "/export";
  }
  inline std::string admin_import_table(const std::string& name) {
    return "/admin/api/data/tables/" + name + "/import";
  }
  inline std::string admin_get_table_records(const std::string& name) {
    return "/admin/api/data/tables/" + name + "/records";
  }
  inline std::string admin_create_table_record(const std::string& name) {
    return "/admin/api/data/tables/" + name + "/records";
  }
  inline std::string admin_update_table_record(const std::string& name, const std::string& id) {
    return "/admin/api/data/tables/" + name + "/records/" + id;
  }
  inline std::string admin_delete_table_record(const std::string& name, const std::string& id) {
    return "/admin/api/data/tables/" + name + "/records/" + id;
  }
  constexpr const char* ADMIN_LIST_USERS = "/admin/api/data/users";
  constexpr const char* ADMIN_CREATE_USER = "/admin/api/data/users";
  inline std::string admin_get_user(const std::string& id) {
    return "/admin/api/data/users/" + id;
  }
  inline std::string admin_update_user(const std::string& id) {
    return "/admin/api/data/users/" + id;
  }
  inline std::string admin_delete_user(const std::string& id) {
    return "/admin/api/data/users/" + id;
  }
  inline std::string admin_delete_user_mfa(const std::string& id) {
    return "/admin/api/data/users/" + id + "/mfa";
  }
  inline std::string admin_get_user_profile(const std::string& id) {
    return "/admin/api/data/users/" + id + "/profile";
  }
  inline std::string admin_send_password_reset(const std::string& id) {
    return "/admin/api/data/users/" + id + "/send-password-reset";
  }
  inline std::string admin_delete_user_sessions(const std::string& id) {
    return "/admin/api/data/users/" + id + "/sessions";
  }
  constexpr const char* ADMIN_RESET_PASSWORD = "/admin/api/internal/reset-password";
  constexpr const char* ADMIN_SETUP = "/admin/api/setup";
  constexpr const char* ADMIN_SETUP_STATUS = "/admin/api/setup/status";
  constexpr const char* QUERY_CUSTOM_EVENTS = "/api/analytics/events";
  constexpr const char* QUERY_ANALYTICS = "/api/analytics/query";
  constexpr const char* TRACK_EVENTS = "/api/analytics/track";
  constexpr const char* ADMIN_AUTH_LIST_USERS = "/api/auth/admin/users";
  constexpr const char* ADMIN_AUTH_CREATE_USER = "/api/auth/admin/users";
  inline std::string admin_auth_get_user(const std::string& id) {
    return "/api/auth/admin/users/" + id;
  }
  inline std::string admin_auth_update_user(const std::string& id) {
    return "/api/auth/admin/users/" + id;
  }
  inline std::string admin_auth_delete_user(const std::string& id) {
    return "/api/auth/admin/users/" + id;
  }
  inline std::string admin_auth_set_claims(const std::string& id) {
    return "/api/auth/admin/users/" + id + "/claims";
  }
  inline std::string admin_auth_delete_user_mfa(const std::string& id) {
    return "/api/auth/admin/users/" + id + "/mfa";
  }
  inline std::string admin_auth_revoke_user_sessions(const std::string& id) {
    return "/api/auth/admin/users/" + id + "/revoke";
  }
  constexpr const char* ADMIN_AUTH_IMPORT_USERS = "/api/auth/admin/users/import";
  constexpr const char* AUTH_CHANGE_EMAIL = "/api/auth/change-email";
  constexpr const char* AUTH_CHANGE_PASSWORD = "/api/auth/change-password";
  constexpr const char* AUTH_GET_IDENTITIES = "/api/auth/identities";
  inline std::string auth_delete_identity(const std::string& identity_id) {
    return "/api/auth/identities/" + identity_id;
  }
  constexpr const char* AUTH_LINK_EMAIL = "/api/auth/link/email";
  constexpr const char* AUTH_LINK_PHONE = "/api/auth/link/phone";
  constexpr const char* AUTH_GET_ME = "/api/auth/me";
  constexpr const char* AUTH_MFA_FACTORS = "/api/auth/mfa/factors";
  constexpr const char* AUTH_MFA_RECOVERY = "/api/auth/mfa/recovery";
  constexpr const char* AUTH_MFA_TOTP_DELETE = "/api/auth/mfa/totp";
  constexpr const char* AUTH_MFA_TOTP_ENROLL = "/api/auth/mfa/totp/enroll";
  constexpr const char* AUTH_MFA_TOTP_VERIFY = "/api/auth/mfa/totp/verify";
  constexpr const char* AUTH_MFA_VERIFY = "/api/auth/mfa/verify";
  inline std::string oauth_redirect(const std::string& provider) {
    return "/api/auth/oauth/" + provider;
  }
  inline std::string oauth_callback(const std::string& provider) {
    return "/api/auth/oauth/" + provider + "/callback";
  }
  inline std::string oauth_link_start(const std::string& provider) {
    return "/api/auth/oauth/link/" + provider;
  }
  inline std::string oauth_link_callback(const std::string& provider) {
    return "/api/auth/oauth/link/" + provider + "/callback";
  }
  constexpr const char* AUTH_PASSKEYS_LIST = "/api/auth/passkeys";
  inline std::string auth_passkeys_delete(const std::string& credential_id) {
    return "/api/auth/passkeys/" + credential_id;
  }
  constexpr const char* AUTH_PASSKEYS_AUTH_OPTIONS = "/api/auth/passkeys/auth-options";
  constexpr const char* AUTH_PASSKEYS_AUTHENTICATE = "/api/auth/passkeys/authenticate";
  constexpr const char* AUTH_PASSKEYS_REGISTER = "/api/auth/passkeys/register";
  constexpr const char* AUTH_PASSKEYS_REGISTER_OPTIONS = "/api/auth/passkeys/register-options";
  constexpr const char* AUTH_UPDATE_PROFILE = "/api/auth/profile";
  constexpr const char* AUTH_REFRESH = "/api/auth/refresh";
  constexpr const char* AUTH_REQUEST_EMAIL_VERIFICATION = "/api/auth/request-email-verification";
  constexpr const char* AUTH_REQUEST_PASSWORD_RESET = "/api/auth/request-password-reset";
  constexpr const char* AUTH_RESET_PASSWORD = "/api/auth/reset-password";
  constexpr const char* AUTH_GET_SESSIONS = "/api/auth/sessions";
  inline std::string auth_delete_session(const std::string& id) {
    return "/api/auth/sessions/" + id;
  }
  constexpr const char* AUTH_SIGNIN = "/api/auth/signin";
  constexpr const char* AUTH_SIGNIN_ANONYMOUS = "/api/auth/signin/anonymous";
  constexpr const char* AUTH_SIGNIN_EMAIL_OTP = "/api/auth/signin/email-otp";
  constexpr const char* AUTH_SIGNIN_MAGIC_LINK = "/api/auth/signin/magic-link";
  constexpr const char* AUTH_SIGNIN_PHONE = "/api/auth/signin/phone";
  constexpr const char* AUTH_SIGNOUT = "/api/auth/signout";
  constexpr const char* AUTH_SIGNUP = "/api/auth/signup";
  constexpr const char* AUTH_VERIFY_EMAIL = "/api/auth/verify-email";
  constexpr const char* AUTH_VERIFY_EMAIL_CHANGE = "/api/auth/verify-email-change";
  constexpr const char* AUTH_VERIFY_EMAIL_OTP = "/api/auth/verify-email-otp";
  constexpr const char* AUTH_VERIFY_LINK_PHONE = "/api/auth/verify-link-phone";
  constexpr const char* AUTH_VERIFY_MAGIC_LINK = "/api/auth/verify-magic-link";
  constexpr const char* AUTH_VERIFY_PHONE = "/api/auth/verify-phone";
  constexpr const char* GET_CONFIG = "/api/config";
  inline std::string execute_d1_query(const std::string& database) {
    return "/api/d1/" + database;
  }
  inline std::string db_list_records(const std::string& namespace_, const std::string& instance_id, const std::string& table) {
    return "/api/db/" + namespace_ + "/" + instance_id + "/tables/" + table;
  }
  inline std::string db_insert_record(const std::string& namespace_, const std::string& instance_id, const std::string& table) {
    return "/api/db/" + namespace_ + "/" + instance_id + "/tables/" + table;
  }
  inline std::string db_get_record(const std::string& namespace_, const std::string& instance_id, const std::string& table, const std::string& id) {
    return "/api/db/" + namespace_ + "/" + instance_id + "/tables/" + table + "/" + id;
  }
  inline std::string db_update_record(const std::string& namespace_, const std::string& instance_id, const std::string& table, const std::string& id) {
    return "/api/db/" + namespace_ + "/" + instance_id + "/tables/" + table + "/" + id;
  }
  inline std::string db_delete_record(const std::string& namespace_, const std::string& instance_id, const std::string& table, const std::string& id) {
    return "/api/db/" + namespace_ + "/" + instance_id + "/tables/" + table + "/" + id;
  }
  inline std::string db_batch_records(const std::string& namespace_, const std::string& instance_id, const std::string& table) {
    return "/api/db/" + namespace_ + "/" + instance_id + "/tables/" + table + "/batch";
  }
  inline std::string db_batch_by_filter(const std::string& namespace_, const std::string& instance_id, const std::string& table) {
    return "/api/db/" + namespace_ + "/" + instance_id + "/tables/" + table + "/batch-by-filter";
  }
  inline std::string db_count_records(const std::string& namespace_, const std::string& instance_id, const std::string& table) {
    return "/api/db/" + namespace_ + "/" + instance_id + "/tables/" + table + "/count";
  }
  inline std::string db_search_records(const std::string& namespace_, const std::string& instance_id, const std::string& table) {
    return "/api/db/" + namespace_ + "/" + instance_id + "/tables/" + table + "/search";
  }
  inline std::string db_single_list_records(const std::string& namespace_, const std::string& table) {
    return "/api/db/" + namespace_ + "/tables/" + table;
  }
  inline std::string db_single_insert_record(const std::string& namespace_, const std::string& table) {
    return "/api/db/" + namespace_ + "/tables/" + table;
  }
  inline std::string db_single_get_record(const std::string& namespace_, const std::string& table, const std::string& id) {
    return "/api/db/" + namespace_ + "/tables/" + table + "/" + id;
  }
  inline std::string db_single_update_record(const std::string& namespace_, const std::string& table, const std::string& id) {
    return "/api/db/" + namespace_ + "/tables/" + table + "/" + id;
  }
  inline std::string db_single_delete_record(const std::string& namespace_, const std::string& table, const std::string& id) {
    return "/api/db/" + namespace_ + "/tables/" + table + "/" + id;
  }
  inline std::string db_single_batch_records(const std::string& namespace_, const std::string& table) {
    return "/api/db/" + namespace_ + "/tables/" + table + "/batch";
  }
  inline std::string db_single_batch_by_filter(const std::string& namespace_, const std::string& table) {
    return "/api/db/" + namespace_ + "/tables/" + table + "/batch-by-filter";
  }
  inline std::string db_single_count_records(const std::string& namespace_, const std::string& table) {
    return "/api/db/" + namespace_ + "/tables/" + table + "/count";
  }
  inline std::string db_single_search_records(const std::string& namespace_, const std::string& table) {
    return "/api/db/" + namespace_ + "/tables/" + table + "/search";
  }
  constexpr const char* DATABASE_LIVE_BROADCAST = "/api/db/broadcast";
  constexpr const char* CHECK_DATABASE_SUBSCRIPTION_CONNECTION = "/api/db/connect-check";
  constexpr const char* CONNECT_DATABASE_SUBSCRIPTION = "/api/db/subscribe";
  constexpr const char* GET_HEALTH = "/api/health";
  inline std::string kv_operation(const std::string& namespace_) {
    return "/api/kv/" + namespace_;
  }
  constexpr const char* PUSH_BROADCAST = "/api/push/broadcast";
  constexpr const char* GET_PUSH_LOGS = "/api/push/logs";
  constexpr const char* PUSH_REGISTER = "/api/push/register";
  constexpr const char* PUSH_SEND = "/api/push/send";
  constexpr const char* PUSH_SEND_MANY = "/api/push/send-many";
  constexpr const char* PUSH_SEND_TO_TOKEN = "/api/push/send-to-token";
  constexpr const char* PUSH_SEND_TO_TOPIC = "/api/push/send-to-topic";
  constexpr const char* GET_PUSH_TOKENS = "/api/push/tokens";
  constexpr const char* PUT_PUSH_TOKENS = "/api/push/tokens";
  constexpr const char* PATCH_PUSH_TOKENS = "/api/push/tokens";
  constexpr const char* PUSH_TOPIC_SUBSCRIBE = "/api/push/topic/subscribe";
  constexpr const char* PUSH_TOPIC_UNSUBSCRIBE = "/api/push/topic/unsubscribe";
  constexpr const char* PUSH_UNREGISTER = "/api/push/unregister";
  constexpr const char* CONNECT_ROOM = "/api/room";
  constexpr const char* CHECK_ROOM_CONNECTION = "/api/room/connect-check";
  constexpr const char* CREATE_ROOM_CLOUDFLARE_REALTIME_KIT_SESSION = "/api/room/media/cloudflare_realtimekit/session";
  constexpr const char* RENEGOTIATE_ROOM_REALTIME_SESSION = "/api/room/media/realtime/renegotiate";
  constexpr const char* GET_ROOM_REALTIME_SESSION = "/api/room/media/realtime/session";
  constexpr const char* CREATE_ROOM_REALTIME_SESSION = "/api/room/media/realtime/session";
  constexpr const char* CLOSE_ROOM_REALTIME_TRACKS = "/api/room/media/realtime/tracks/close";
  constexpr const char* ADD_ROOM_REALTIME_TRACKS = "/api/room/media/realtime/tracks/new";
  constexpr const char* CREATE_ROOM_REALTIME_ICE_SERVERS = "/api/room/media/realtime/turn";
  constexpr const char* GET_ROOM_METADATA = "/api/room/metadata";
  constexpr const char* GET_SCHEMA = "/api/schema";
  constexpr const char* EXECUTE_SQL = "/api/sql";
  inline std::string list_files(const std::string& bucket) {
    return "/api/storage/" + bucket;
  }
  inline std::string check_file_exists(const std::string& bucket, const std::string& key) {
    return "/api/storage/" + bucket + "/" + key;
  }
  inline std::string download_file(const std::string& bucket, const std::string& key) {
    return "/api/storage/" + bucket + "/" + key;
  }
  inline std::string delete_file(const std::string& bucket, const std::string& key) {
    return "/api/storage/" + bucket + "/" + key;
  }
  inline std::string get_file_metadata(const std::string& bucket, const std::string& key) {
    return "/api/storage/" + bucket + "/" + key + "/metadata";
  }
  inline std::string update_file_metadata(const std::string& bucket, const std::string& key) {
    return "/api/storage/" + bucket + "/" + key + "/metadata";
  }
  inline std::string delete_batch(const std::string& bucket) {
    return "/api/storage/" + bucket + "/delete-batch";
  }
  inline std::string abort_multipart_upload(const std::string& bucket) {
    return "/api/storage/" + bucket + "/multipart/abort";
  }
  inline std::string complete_multipart_upload(const std::string& bucket) {
    return "/api/storage/" + bucket + "/multipart/complete";
  }
  inline std::string create_multipart_upload(const std::string& bucket) {
    return "/api/storage/" + bucket + "/multipart/create";
  }
  inline std::string upload_part(const std::string& bucket) {
    return "/api/storage/" + bucket + "/multipart/upload-part";
  }
  inline std::string create_signed_upload_url(const std::string& bucket) {
    return "/api/storage/" + bucket + "/signed-upload-url";
  }
  inline std::string create_signed_download_url(const std::string& bucket) {
    return "/api/storage/" + bucket + "/signed-url";
  }
  inline std::string create_signed_download_urls(const std::string& bucket) {
    return "/api/storage/" + bucket + "/signed-urls";
  }
  inline std::string upload_file(const std::string& bucket) {
    return "/api/storage/" + bucket + "/upload";
  }
  inline std::string get_upload_parts(const std::string& bucket, const std::string& upload_id) {
    return "/api/storage/" + bucket + "/uploads/" + upload_id + "/parts";
  }
  inline std::string vectorize_operation(const std::string& index) {
    return "/api/vectorize/" + index;
  }
} // namespace ApiPaths

} // namespace client
