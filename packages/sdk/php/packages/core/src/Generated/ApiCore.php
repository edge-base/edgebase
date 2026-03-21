<?php

// Auto-generated core API Core — DO NOT EDIT.
// Regenerate: npx tsx tools/sdk-codegen/generate.ts
// Source: openapi.json (0.1.0)

declare(strict_types=1);

namespace EdgeBase\Core\Generated;

use EdgeBase\Core\HttpClient;

/**
 * Auto-generated API methods.
 */
class GeneratedDbApi
{
    protected HttpClient $http;

    public function __construct(HttpClient $http)
    {
        $this->http = $http;
    }

    public function http_client(): HttpClient
    {
        return $this->http;
    }

    /** Health check — GET /api/health */
    public function get_health(): mixed
    {
        return $this->http->get('/health');
    }

    /** Sign up with email and password — POST /api/auth/signup */
    public function auth_signup(mixed $body = null): mixed
    {
        return $this->http->post('/auth/signup', $body);
    }

    /** Sign in with email and password — POST /api/auth/signin */
    public function auth_signin(mixed $body = null): mixed
    {
        return $this->http->post('/auth/signin', $body);
    }

    /** Sign in anonymously — POST /api/auth/signin/anonymous */
    public function auth_signin_anonymous(mixed $body = null): mixed
    {
        return $this->http->post('/auth/signin/anonymous', $body);
    }

    /** Send magic link to email — POST /api/auth/signin/magic-link */
    public function auth_signin_magic_link(mixed $body = null): mixed
    {
        return $this->http->post('/auth/signin/magic-link', $body);
    }

    /** Verify magic link token — POST /api/auth/verify-magic-link */
    public function auth_verify_magic_link(mixed $body = null): mixed
    {
        return $this->http->post('/auth/verify-magic-link', $body);
    }

    /** Send OTP SMS to phone number — POST /api/auth/signin/phone */
    public function auth_signin_phone(mixed $body = null): mixed
    {
        return $this->http->post('/auth/signin/phone', $body);
    }

    /** Verify phone OTP and create session — POST /api/auth/verify-phone */
    public function auth_verify_phone(mixed $body = null): mixed
    {
        return $this->http->post('/auth/verify-phone', $body);
    }

    /** Link phone number to existing account — POST /api/auth/link/phone */
    public function auth_link_phone(mixed $body = null): mixed
    {
        return $this->http->post('/auth/link/phone', $body);
    }

    /** Verify OTP and link phone to account — POST /api/auth/verify-link-phone */
    public function auth_verify_link_phone(mixed $body = null): mixed
    {
        return $this->http->post('/auth/verify-link-phone', $body);
    }

    /** Send OTP code to email — POST /api/auth/signin/email-otp */
    public function auth_signin_email_otp(mixed $body = null): mixed
    {
        return $this->http->post('/auth/signin/email-otp', $body);
    }

    /** Verify email OTP and create session — POST /api/auth/verify-email-otp */
    public function auth_verify_email_otp(mixed $body = null): mixed
    {
        return $this->http->post('/auth/verify-email-otp', $body);
    }

    /** Enroll new TOTP factor — POST /api/auth/mfa/totp/enroll */
    public function auth_mfa_totp_enroll(): mixed
    {
        return $this->http->post('/auth/mfa/totp/enroll');
    }

    /** Confirm TOTP enrollment with code — POST /api/auth/mfa/totp/verify */
    public function auth_mfa_totp_verify(mixed $body = null): mixed
    {
        return $this->http->post('/auth/mfa/totp/verify', $body);
    }

    /** Verify MFA code during signin — POST /api/auth/mfa/verify */
    public function auth_mfa_verify(mixed $body = null): mixed
    {
        return $this->http->post('/auth/mfa/verify', $body);
    }

    /** Use recovery code during MFA signin — POST /api/auth/mfa/recovery */
    public function auth_mfa_recovery(mixed $body = null): mixed
    {
        return $this->http->post('/auth/mfa/recovery', $body);
    }

    /** Disable TOTP factor — DELETE /api/auth/mfa/totp */
    public function auth_mfa_totp_delete(mixed $body = null): mixed
    {
        return $this->http->delete('/auth/mfa/totp', $body);
    }

    /** List MFA factors for authenticated user — GET /api/auth/mfa/factors */
    public function auth_mfa_factors(): mixed
    {
        return $this->http->get('/auth/mfa/factors');
    }

    /** Refresh access token — POST /api/auth/refresh */
    public function auth_refresh(mixed $body = null): mixed
    {
        return $this->http->post('/auth/refresh', $body);
    }

    /** Sign out and revoke refresh token — POST /api/auth/signout */
    public function auth_signout(mixed $body = null): mixed
    {
        return $this->http->post('/auth/signout', $body);
    }

    /** Change password for authenticated user — POST /api/auth/change-password */
    public function auth_change_password(mixed $body = null): mixed
    {
        return $this->http->post('/auth/change-password', $body);
    }

    /** Request email change with password confirmation — POST /api/auth/change-email */
    public function auth_change_email(mixed $body = null): mixed
    {
        return $this->http->post('/auth/change-email', $body);
    }

    /** Verify email change token — POST /api/auth/verify-email-change */
    public function auth_verify_email_change(mixed $body = null): mixed
    {
        return $this->http->post('/auth/verify-email-change', $body);
    }

    /** Generate passkey registration options — POST /api/auth/passkeys/register-options */
    public function auth_passkeys_register_options(): mixed
    {
        return $this->http->post('/auth/passkeys/register-options');
    }

    /** Verify and store passkey registration — POST /api/auth/passkeys/register */
    public function auth_passkeys_register(mixed $body = null): mixed
    {
        return $this->http->post('/auth/passkeys/register', $body);
    }

    /** Generate passkey authentication options — POST /api/auth/passkeys/auth-options */
    public function auth_passkeys_auth_options(mixed $body = null): mixed
    {
        return $this->http->post('/auth/passkeys/auth-options', $body);
    }

    /** Authenticate with passkey — POST /api/auth/passkeys/authenticate */
    public function auth_passkeys_authenticate(mixed $body = null): mixed
    {
        return $this->http->post('/auth/passkeys/authenticate', $body);
    }

    /** List passkeys for authenticated user — GET /api/auth/passkeys */
    public function auth_passkeys_list(): mixed
    {
        return $this->http->get('/auth/passkeys');
    }

    /** Delete a passkey — DELETE /api/auth/passkeys/{credentialId} */
    public function auth_passkeys_delete(string $credential_id): mixed
    {
        return $this->http->delete('/auth/passkeys/' . rawurlencode($credential_id));
    }

    /** Get current authenticated user info — GET /api/auth/me */
    public function auth_get_me(): mixed
    {
        return $this->http->get('/auth/me');
    }

    /** Update user profile — PATCH /api/auth/profile */
    public function auth_update_profile(mixed $body = null): mixed
    {
        return $this->http->patch('/auth/profile', $body);
    }

    /** List active sessions — GET /api/auth/sessions */
    public function auth_get_sessions(): mixed
    {
        return $this->http->get('/auth/sessions');
    }

    /** Delete a session — DELETE /api/auth/sessions/{id} */
    public function auth_delete_session(string $id): mixed
    {
        return $this->http->delete('/auth/sessions/' . rawurlencode($id));
    }

    /** List linked sign-in identities for the current user — GET /api/auth/identities */
    public function auth_get_identities(): mixed
    {
        return $this->http->get('/auth/identities');
    }

    /** Unlink a linked sign-in identity — DELETE /api/auth/identities/{identityId} */
    public function auth_delete_identity(string $identity_id): mixed
    {
        return $this->http->delete('/auth/identities/' . rawurlencode($identity_id));
    }

    /** Link email and password to existing account — POST /api/auth/link/email */
    public function auth_link_email(mixed $body = null): mixed
    {
        return $this->http->post('/auth/link/email', $body);
    }

    /** Send a verification email to the current authenticated user — POST /api/auth/request-email-verification */
    public function auth_request_email_verification(mixed $body = null): mixed
    {
        return $this->http->post('/auth/request-email-verification', $body);
    }

    /** Verify email address with token — POST /api/auth/verify-email */
    public function auth_verify_email(mixed $body = null): mixed
    {
        return $this->http->post('/auth/verify-email', $body);
    }

    /** Request password reset email — POST /api/auth/request-password-reset */
    public function auth_request_password_reset(mixed $body = null): mixed
    {
        return $this->http->post('/auth/request-password-reset', $body);
    }

    /** Reset password with token — POST /api/auth/reset-password */
    public function auth_reset_password(mixed $body = null): mixed
    {
        return $this->http->post('/auth/reset-password', $body);
    }

    /** Start OAuth redirect — GET /api/auth/oauth/{provider} */
    public function oauth_redirect(string $provider): mixed
    {
        return $this->http->get('/auth/oauth/' . rawurlencode($provider));
    }

    /** OAuth callback — GET /api/auth/oauth/{provider}/callback */
    public function oauth_callback(string $provider): mixed
    {
        return $this->http->get('/auth/oauth/' . rawurlencode($provider) . '/callback');
    }

    /** Start OAuth account linking — POST /api/auth/oauth/link/{provider} */
    public function oauth_link_start(string $provider): mixed
    {
        return $this->http->post('/auth/oauth/link/' . rawurlencode($provider));
    }

    /** OAuth link callback — GET /api/auth/oauth/link/{provider}/callback */
    public function oauth_link_callback(string $provider): mixed
    {
        return $this->http->get('/auth/oauth/link/' . rawurlencode($provider) . '/callback');
    }

    /** Count records in dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/count */
    public function db_count_records(string $namespace, string $instance_id, string $table, array $query = []): mixed
    {
        return $this->http->get('/db/' . rawurlencode($namespace) . '/' . rawurlencode($instance_id) . '/tables/' . rawurlencode($table) . '/count', $query);
    }

    /** Search records in dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/search */
    public function db_search_records(string $namespace, string $instance_id, string $table, array $query = []): mixed
    {
        return $this->http->get('/db/' . rawurlencode($namespace) . '/' . rawurlencode($instance_id) . '/tables/' . rawurlencode($table) . '/search', $query);
    }

    /** Get single record from dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/{id} */
    public function db_get_record(string $namespace, string $instance_id, string $table, string $id, array $query = []): mixed
    {
        return $this->http->get('/db/' . rawurlencode($namespace) . '/' . rawurlencode($instance_id) . '/tables/' . rawurlencode($table) . '/' . rawurlencode($id), $query);
    }

    /** Update record in dynamic table — PATCH /api/db/{namespace}/{instanceId}/tables/{table}/{id} */
    public function db_update_record(string $namespace, string $instance_id, string $table, string $id, mixed $body = null): mixed
    {
        return $this->http->patch('/db/' . rawurlencode($namespace) . '/' . rawurlencode($instance_id) . '/tables/' . rawurlencode($table) . '/' . rawurlencode($id), $body);
    }

    /** Delete record from dynamic table — DELETE /api/db/{namespace}/{instanceId}/tables/{table}/{id} */
    public function db_delete_record(string $namespace, string $instance_id, string $table, string $id): mixed
    {
        return $this->http->delete('/db/' . rawurlencode($namespace) . '/' . rawurlencode($instance_id) . '/tables/' . rawurlencode($table) . '/' . rawurlencode($id));
    }

    /** List records from dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table} */
    public function db_list_records(string $namespace, string $instance_id, string $table, array $query = []): mixed
    {
        return $this->http->get('/db/' . rawurlencode($namespace) . '/' . rawurlencode($instance_id) . '/tables/' . rawurlencode($table), $query);
    }

    /** Insert record into dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table} */
    public function db_insert_record(string $namespace, string $instance_id, string $table, mixed $body = null, array $query = []): mixed
    {
        return $this->http->postWithQuery('/db/' . rawurlencode($namespace) . '/' . rawurlencode($instance_id) . '/tables/' . rawurlencode($table), $body, $query);
    }

    /** Batch insert records into dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table}/batch */
    public function db_batch_records(string $namespace, string $instance_id, string $table, mixed $body = null, array $query = []): mixed
    {
        return $this->http->postWithQuery('/db/' . rawurlencode($namespace) . '/' . rawurlencode($instance_id) . '/tables/' . rawurlencode($table) . '/batch', $body, $query);
    }

    /** Batch update/delete records by filter in dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table}/batch-by-filter */
    public function db_batch_by_filter(string $namespace, string $instance_id, string $table, mixed $body = null, array $query = []): mixed
    {
        return $this->http->postWithQuery('/db/' . rawurlencode($namespace) . '/' . rawurlencode($instance_id) . '/tables/' . rawurlencode($table) . '/batch-by-filter', $body, $query);
    }

    /** Check database live subscription WebSocket prerequisites — GET /api/db/connect-check */
    public function check_database_subscription_connection(array $query = []): mixed
    {
        return $this->http->get('/db/connect-check', $query);
    }

    /** Connect to database live subscriptions WebSocket — GET /api/db/subscribe */
    public function connect_database_subscription(array $query = []): mixed
    {
        return $this->http->get('/db/subscribe', $query);
    }

    /** Get table schema — GET /api/schema */
    public function get_schema(): mixed
    {
        return $this->http->get('/schema');
    }

    /** Upload file — POST /api/storage/{bucket}/upload */
    public function upload_file(string $bucket, mixed $body = null): mixed
    {
        return $this->http->post('/storage/' . rawurlencode($bucket) . '/upload', $body);
    }

    /** Get file metadata — GET /api/storage/{bucket}/{key}/metadata */
    public function get_file_metadata(string $bucket, string $key): mixed
    {
        return $this->http->get('/storage/' . rawurlencode($bucket) . '/' . rawurlencode($key) . '/metadata');
    }

    /** Update file metadata — PATCH /api/storage/{bucket}/{key}/metadata */
    public function update_file_metadata(string $bucket, string $key, mixed $body = null): mixed
    {
        return $this->http->patch('/storage/' . rawurlencode($bucket) . '/' . rawurlencode($key) . '/metadata', $body);
    }

    /** Check if file exists — HEAD /api/storage/{bucket}/{key} */
    public function check_file_exists(string $bucket, string $key): bool
    {
        return $this->http->head('/storage/' . rawurlencode($bucket) . '/' . rawurlencode($key));
    }

    /** Download file — GET /api/storage/{bucket}/{key} */
    public function download_file(string $bucket, string $key): mixed
    {
        return $this->http->get('/storage/' . rawurlencode($bucket) . '/' . rawurlencode($key));
    }

    /** Delete file — DELETE /api/storage/{bucket}/{key} */
    public function delete_file(string $bucket, string $key): mixed
    {
        return $this->http->delete('/storage/' . rawurlencode($bucket) . '/' . rawurlencode($key));
    }

    /** Get uploaded parts — GET /api/storage/{bucket}/uploads/{uploadId}/parts */
    public function get_upload_parts(string $bucket, string $upload_id, array $query = []): mixed
    {
        return $this->http->get('/storage/' . rawurlencode($bucket) . '/uploads/' . rawurlencode($upload_id) . '/parts', $query);
    }

    /** List files in bucket — GET /api/storage/{bucket} */
    public function list_files(string $bucket): mixed
    {
        return $this->http->get('/storage/' . rawurlencode($bucket));
    }

    /** Batch delete files — POST /api/storage/{bucket}/delete-batch */
    public function delete_batch(string $bucket, mixed $body = null): mixed
    {
        return $this->http->post('/storage/' . rawurlencode($bucket) . '/delete-batch', $body);
    }

    /** Create signed download URL — POST /api/storage/{bucket}/signed-url */
    public function create_signed_download_url(string $bucket, mixed $body = null): mixed
    {
        return $this->http->post('/storage/' . rawurlencode($bucket) . '/signed-url', $body);
    }

    /** Batch create signed download URLs — POST /api/storage/{bucket}/signed-urls */
    public function create_signed_download_urls(string $bucket, mixed $body = null): mixed
    {
        return $this->http->post('/storage/' . rawurlencode($bucket) . '/signed-urls', $body);
    }

    /** Create signed upload URL — POST /api/storage/{bucket}/signed-upload-url */
    public function create_signed_upload_url(string $bucket, mixed $body = null): mixed
    {
        return $this->http->post('/storage/' . rawurlencode($bucket) . '/signed-upload-url', $body);
    }

    /** Start multipart upload — POST /api/storage/{bucket}/multipart/create */
    public function create_multipart_upload(string $bucket, mixed $body = null): mixed
    {
        return $this->http->post('/storage/' . rawurlencode($bucket) . '/multipart/create', $body);
    }

    /** Upload a part — POST /api/storage/{bucket}/multipart/upload-part */
    public function upload_part(string $bucket, mixed $body = null): mixed
    {
        return $this->http->post('/storage/' . rawurlencode($bucket) . '/multipart/upload-part', $body);
    }

    /** Complete multipart upload — POST /api/storage/{bucket}/multipart/complete */
    public function complete_multipart_upload(string $bucket, mixed $body = null): mixed
    {
        return $this->http->post('/storage/' . rawurlencode($bucket) . '/multipart/complete', $body);
    }

    /** Abort multipart upload — POST /api/storage/{bucket}/multipart/abort */
    public function abort_multipart_upload(string $bucket, mixed $body = null): mixed
    {
        return $this->http->post('/storage/' . rawurlencode($bucket) . '/multipart/abort', $body);
    }

    /** Get public configuration — GET /api/config */
    public function get_config(): mixed
    {
        return $this->http->get('/config');
    }

    /** Register push token — POST /api/push/register */
    public function push_register(mixed $body = null): mixed
    {
        return $this->http->post('/push/register', $body);
    }

    /** Unregister push token — POST /api/push/unregister */
    public function push_unregister(mixed $body = null): mixed
    {
        return $this->http->post('/push/unregister', $body);
    }

    /** Subscribe token to topic — POST /api/push/topic/subscribe */
    public function push_topic_subscribe(mixed $body = null): mixed
    {
        return $this->http->post('/push/topic/subscribe', $body);
    }

    /** Unsubscribe token from topic — POST /api/push/topic/unsubscribe */
    public function push_topic_unsubscribe(mixed $body = null): mixed
    {
        return $this->http->post('/push/topic/unsubscribe', $body);
    }

    /** Check room WebSocket connection prerequisites — GET /api/room/connect-check */
    public function check_room_connection(array $query = []): mixed
    {
        return $this->http->get('/room/connect-check', $query);
    }

    /** Connect to room WebSocket — GET /api/room */
    public function connect_room(array $query = []): mixed
    {
        return $this->http->get('/room', $query);
    }

    /** Get room metadata — GET /api/room/metadata */
    public function get_room_metadata(array $query = []): mixed
    {
        return $this->http->get('/room/metadata', $query);
    }

    /** Get the active room realtime media session — GET /api/room/media/realtime/session */
    public function get_room_realtime_session(array $query = []): mixed
    {
        return $this->http->get('/room/media/realtime/session', $query);
    }

    /** Create a room realtime media session — POST /api/room/media/realtime/session */
    public function create_room_realtime_session(mixed $body = null, array $query = []): mixed
    {
        return $this->http->postWithQuery('/room/media/realtime/session', $body, $query);
    }

    /** Generate TURN / ICE credentials for room realtime media — POST /api/room/media/realtime/turn */
    public function create_room_realtime_ice_servers(mixed $body = null, array $query = []): mixed
    {
        return $this->http->postWithQuery('/room/media/realtime/turn', $body, $query);
    }

    /** Add realtime media tracks to a room session — POST /api/room/media/realtime/tracks/new */
    public function add_room_realtime_tracks(mixed $body = null, array $query = []): mixed
    {
        return $this->http->postWithQuery('/room/media/realtime/tracks/new', $body, $query);
    }

    /** Renegotiate a room realtime media session — PUT /api/room/media/realtime/renegotiate */
    public function renegotiate_room_realtime_session(mixed $body = null, array $query = []): mixed
    {
        return $this->http->putWithQuery('/room/media/realtime/renegotiate', $body, $query);
    }

    /** Close room realtime media tracks — PUT /api/room/media/realtime/tracks/close */
    public function close_room_realtime_tracks(mixed $body = null, array $query = []): mixed
    {
        return $this->http->putWithQuery('/room/media/realtime/tracks/close', $body, $query);
    }

    /** Track custom events — POST /api/analytics/track */
    public function track_events(mixed $body = null): mixed
    {
        return $this->http->post('/analytics/track', $body);
    }

    /** Count records in a single-instance table — GET /api/db/{namespace}/tables/{table}/count */
    public function db_single_count_records(string $namespace, string $table, array $query = []): mixed
    {
        return $this->http->get('/db/' . rawurlencode($namespace) . '/tables/' . rawurlencode($table) . '/count', $query);
    }

    /** Search records in a single-instance table — GET /api/db/{namespace}/tables/{table}/search */
    public function db_single_search_records(string $namespace, string $table, array $query = []): mixed
    {
        return $this->http->get('/db/' . rawurlencode($namespace) . '/tables/' . rawurlencode($table) . '/search', $query);
    }

    /** Get a single record from a single-instance table — GET /api/db/{namespace}/tables/{table}/{id} */
    public function db_single_get_record(string $namespace, string $table, string $id, array $query = []): mixed
    {
        return $this->http->get('/db/' . rawurlencode($namespace) . '/tables/' . rawurlencode($table) . '/' . rawurlencode($id), $query);
    }

    /** Update a record in a single-instance table — PATCH /api/db/{namespace}/tables/{table}/{id} */
    public function db_single_update_record(string $namespace, string $table, string $id, mixed $body = null): mixed
    {
        return $this->http->patch('/db/' . rawurlencode($namespace) . '/tables/' . rawurlencode($table) . '/' . rawurlencode($id), $body);
    }

    /** Delete a record from a single-instance table — DELETE /api/db/{namespace}/tables/{table}/{id} */
    public function db_single_delete_record(string $namespace, string $table, string $id): mixed
    {
        return $this->http->delete('/db/' . rawurlencode($namespace) . '/tables/' . rawurlencode($table) . '/' . rawurlencode($id));
    }

    /** List records from a single-instance table — GET /api/db/{namespace}/tables/{table} */
    public function db_single_list_records(string $namespace, string $table, array $query = []): mixed
    {
        return $this->http->get('/db/' . rawurlencode($namespace) . '/tables/' . rawurlencode($table), $query);
    }

    /** Insert a record into a single-instance table — POST /api/db/{namespace}/tables/{table} */
    public function db_single_insert_record(string $namespace, string $table, mixed $body = null, array $query = []): mixed
    {
        return $this->http->postWithQuery('/db/' . rawurlencode($namespace) . '/tables/' . rawurlencode($table), $body, $query);
    }

    /** Batch insert records into a single-instance table — POST /api/db/{namespace}/tables/{table}/batch */
    public function db_single_batch_records(string $namespace, string $table, mixed $body = null, array $query = []): mixed
    {
        return $this->http->postWithQuery('/db/' . rawurlencode($namespace) . '/tables/' . rawurlencode($table) . '/batch', $body, $query);
    }

    /** Batch update/delete records by filter in a single-instance table — POST /api/db/{namespace}/tables/{table}/batch-by-filter */
    public function db_single_batch_by_filter(string $namespace, string $table, mixed $body = null, array $query = []): mixed
    {
        return $this->http->postWithQuery('/db/' . rawurlencode($namespace) . '/tables/' . rawurlencode($table) . '/batch-by-filter', $body, $query);
    }

    /** Create a room Cloudflare RealtimeKit session — POST /api/room/media/cloudflare_realtimekit/session */
    public function create_room_cloudflare_realtime_kit_session(mixed $body = null, array $query = []): mixed
    {
        return $this->http->postWithQuery('/room/media/cloudflare_realtimekit/session', $body, $query);
    }
}

/**
 * Auto-generated path constants.
 */
final class ApiPaths
{
    public const ADMIN_LOGIN = '/admin/api/auth/login';
    public const ADMIN_REFRESH = '/admin/api/auth/refresh';
    public const BACKUP_CLEANUP_PLUGIN = '/admin/api/backup/cleanup-plugin';
    public const BACKUP_GET_CONFIG = '/admin/api/backup/config';
    public const BACKUP_DUMP_CONTROL_D1 = '/admin/api/backup/dump-control-d1';
    public const BACKUP_DUMP_D1 = '/admin/api/backup/dump-d1';
    public const BACKUP_DUMP_DATA = '/admin/api/backup/dump-data';
    public const BACKUP_DUMP_DO = '/admin/api/backup/dump-do';
    public const BACKUP_DUMP_STORAGE = '/admin/api/backup/dump-storage';

    public static function backup_export_table(string $name): string
    {
        return "/admin/api/backup/export/{$name}";
    }
    public const BACKUP_LIST_DOS = '/admin/api/backup/list-dos';
    public const BACKUP_RESTORE_CONTROL_D1 = '/admin/api/backup/restore-control-d1';
    public const BACKUP_RESTORE_D1 = '/admin/api/backup/restore-d1';
    public const BACKUP_RESTORE_DATA = '/admin/api/backup/restore-data';
    public const BACKUP_RESTORE_DO = '/admin/api/backup/restore-do';
    public const BACKUP_RESTORE_STORAGE = '/admin/api/backup/restore-storage';
    public const BACKUP_RESYNC_USERS_PUBLIC = '/admin/api/backup/resync-users-public';
    public const BACKUP_WIPE_DO = '/admin/api/backup/wipe-do';
    public const ADMIN_LIST_ADMINS = '/admin/api/data/admins';
    public const ADMIN_CREATE_ADMIN = '/admin/api/data/admins';

    public static function admin_delete_admin(string $id): string
    {
        return "/admin/api/data/admins/{$id}";
    }

    public static function admin_change_password(string $id): string
    {
        return "/admin/api/data/admins/{$id}/password";
    }
    public const ADMIN_GET_ANALYTICS = '/admin/api/data/analytics';
    public const ADMIN_GET_ANALYTICS_EVENTS = '/admin/api/data/analytics/events';
    public const ADMIN_GET_AUTH_SETTINGS = '/admin/api/data/auth/settings';
    public const ADMIN_BACKUP_GET_CONFIG = '/admin/api/data/backup/config';
    public const ADMIN_BACKUP_DUMP_D1 = '/admin/api/data/backup/dump-d1';
    public const ADMIN_BACKUP_DUMP_DO = '/admin/api/data/backup/dump-do';
    public const ADMIN_BACKUP_LIST_DOS = '/admin/api/data/backup/list-dos';
    public const ADMIN_BACKUP_RESTORE_D1 = '/admin/api/data/backup/restore-d1';
    public const ADMIN_BACKUP_RESTORE_DO = '/admin/api/data/backup/restore-do';
    public const ADMIN_CLEANUP_ANON = '/admin/api/data/cleanup-anon';
    public const ADMIN_GET_CONFIG_INFO = '/admin/api/data/config-info';
    public const ADMIN_GET_DEV_INFO = '/admin/api/data/dev-info';
    public const ADMIN_GET_EMAIL_TEMPLATES = '/admin/api/data/email/templates';
    public const ADMIN_LIST_FUNCTIONS = '/admin/api/data/functions';
    public const ADMIN_GET_LOGS = '/admin/api/data/logs';
    public const ADMIN_GET_RECENT_LOGS = '/admin/api/data/logs/recent';
    public const ADMIN_GET_MONITORING = '/admin/api/data/monitoring';
    public const ADMIN_GET_OVERVIEW = '/admin/api/data/overview';
    public const ADMIN_GET_PUSH_LOGS = '/admin/api/data/push/logs';
    public const ADMIN_TEST_PUSH_SEND = '/admin/api/data/push/test-send';
    public const ADMIN_GET_PUSH_TOKENS = '/admin/api/data/push/tokens';
    public const ADMIN_RULES_TEST = '/admin/api/data/rules-test';
    public const ADMIN_GET_SCHEMA = '/admin/api/data/schema';
    public const ADMIN_EXECUTE_SQL = '/admin/api/data/sql';
    public const ADMIN_LIST_BUCKETS = '/admin/api/data/storage/buckets';

    public static function admin_list_bucket_objects(string $name): string
    {
        return "/admin/api/data/storage/buckets/{$name}/objects";
    }

    public static function admin_get_bucket_object(string $name, string $key): string
    {
        return "/admin/api/data/storage/buckets/{$name}/objects/{$key}";
    }

    public static function admin_delete_bucket_object(string $name, string $key): string
    {
        return "/admin/api/data/storage/buckets/{$name}/objects/{$key}";
    }

    public static function admin_create_signed_url(string $name): string
    {
        return "/admin/api/data/storage/buckets/{$name}/signed-url";
    }

    public static function admin_get_bucket_stats(string $name): string
    {
        return "/admin/api/data/storage/buckets/{$name}/stats";
    }

    public static function admin_upload_file(string $name): string
    {
        return "/admin/api/data/storage/buckets/{$name}/upload";
    }
    public const ADMIN_LIST_TABLES = '/admin/api/data/tables';

    public static function admin_export_table(string $name): string
    {
        return "/admin/api/data/tables/{$name}/export";
    }

    public static function admin_import_table(string $name): string
    {
        return "/admin/api/data/tables/{$name}/import";
    }

    public static function admin_get_table_records(string $name): string
    {
        return "/admin/api/data/tables/{$name}/records";
    }

    public static function admin_create_table_record(string $name): string
    {
        return "/admin/api/data/tables/{$name}/records";
    }

    public static function admin_update_table_record(string $name, string $id): string
    {
        return "/admin/api/data/tables/{$name}/records/{$id}";
    }

    public static function admin_delete_table_record(string $name, string $id): string
    {
        return "/admin/api/data/tables/{$name}/records/{$id}";
    }
    public const ADMIN_LIST_USERS = '/admin/api/data/users';
    public const ADMIN_CREATE_USER = '/admin/api/data/users';

    public static function admin_get_user(string $id): string
    {
        return "/admin/api/data/users/{$id}";
    }

    public static function admin_update_user(string $id): string
    {
        return "/admin/api/data/users/{$id}";
    }

    public static function admin_delete_user(string $id): string
    {
        return "/admin/api/data/users/{$id}";
    }

    public static function admin_delete_user_mfa(string $id): string
    {
        return "/admin/api/data/users/{$id}/mfa";
    }

    public static function admin_get_user_profile(string $id): string
    {
        return "/admin/api/data/users/{$id}/profile";
    }

    public static function admin_send_password_reset(string $id): string
    {
        return "/admin/api/data/users/{$id}/send-password-reset";
    }

    public static function admin_delete_user_sessions(string $id): string
    {
        return "/admin/api/data/users/{$id}/sessions";
    }
    public const ADMIN_RESET_PASSWORD = '/admin/api/internal/reset-password';
    public const ADMIN_SETUP = '/admin/api/setup';
    public const ADMIN_SETUP_STATUS = '/admin/api/setup/status';
    public const QUERY_CUSTOM_EVENTS = '/api/analytics/events';
    public const QUERY_ANALYTICS = '/api/analytics/query';
    public const TRACK_EVENTS = '/api/analytics/track';
    public const ADMIN_AUTH_LIST_USERS = '/api/auth/admin/users';
    public const ADMIN_AUTH_CREATE_USER = '/api/auth/admin/users';

    public static function admin_auth_get_user(string $id): string
    {
        return "/api/auth/admin/users/{$id}";
    }

    public static function admin_auth_update_user(string $id): string
    {
        return "/api/auth/admin/users/{$id}";
    }

    public static function admin_auth_delete_user(string $id): string
    {
        return "/api/auth/admin/users/{$id}";
    }

    public static function admin_auth_set_claims(string $id): string
    {
        return "/api/auth/admin/users/{$id}/claims";
    }

    public static function admin_auth_delete_user_mfa(string $id): string
    {
        return "/api/auth/admin/users/{$id}/mfa";
    }

    public static function admin_auth_revoke_user_sessions(string $id): string
    {
        return "/api/auth/admin/users/{$id}/revoke";
    }
    public const ADMIN_AUTH_IMPORT_USERS = '/api/auth/admin/users/import';
    public const AUTH_CHANGE_EMAIL = '/api/auth/change-email';
    public const AUTH_CHANGE_PASSWORD = '/api/auth/change-password';
    public const AUTH_GET_IDENTITIES = '/api/auth/identities';

    public static function auth_delete_identity(string $identity_id): string
    {
        return "/api/auth/identities/{$identity_id}";
    }
    public const AUTH_LINK_EMAIL = '/api/auth/link/email';
    public const AUTH_LINK_PHONE = '/api/auth/link/phone';
    public const AUTH_GET_ME = '/api/auth/me';
    public const AUTH_MFA_FACTORS = '/api/auth/mfa/factors';
    public const AUTH_MFA_RECOVERY = '/api/auth/mfa/recovery';
    public const AUTH_MFA_TOTP_DELETE = '/api/auth/mfa/totp';
    public const AUTH_MFA_TOTP_ENROLL = '/api/auth/mfa/totp/enroll';
    public const AUTH_MFA_TOTP_VERIFY = '/api/auth/mfa/totp/verify';
    public const AUTH_MFA_VERIFY = '/api/auth/mfa/verify';

    public static function oauth_redirect(string $provider): string
    {
        return "/api/auth/oauth/{$provider}";
    }

    public static function oauth_callback(string $provider): string
    {
        return "/api/auth/oauth/{$provider}/callback";
    }

    public static function oauth_link_start(string $provider): string
    {
        return "/api/auth/oauth/link/{$provider}";
    }

    public static function oauth_link_callback(string $provider): string
    {
        return "/api/auth/oauth/link/{$provider}/callback";
    }
    public const AUTH_PASSKEYS_LIST = '/api/auth/passkeys';

    public static function auth_passkeys_delete(string $credential_id): string
    {
        return "/api/auth/passkeys/{$credential_id}";
    }
    public const AUTH_PASSKEYS_AUTH_OPTIONS = '/api/auth/passkeys/auth-options';
    public const AUTH_PASSKEYS_AUTHENTICATE = '/api/auth/passkeys/authenticate';
    public const AUTH_PASSKEYS_REGISTER = '/api/auth/passkeys/register';
    public const AUTH_PASSKEYS_REGISTER_OPTIONS = '/api/auth/passkeys/register-options';
    public const AUTH_UPDATE_PROFILE = '/api/auth/profile';
    public const AUTH_REFRESH = '/api/auth/refresh';
    public const AUTH_REQUEST_EMAIL_VERIFICATION = '/api/auth/request-email-verification';
    public const AUTH_REQUEST_PASSWORD_RESET = '/api/auth/request-password-reset';
    public const AUTH_RESET_PASSWORD = '/api/auth/reset-password';
    public const AUTH_GET_SESSIONS = '/api/auth/sessions';

    public static function auth_delete_session(string $id): string
    {
        return "/api/auth/sessions/{$id}";
    }
    public const AUTH_SIGNIN = '/api/auth/signin';
    public const AUTH_SIGNIN_ANONYMOUS = '/api/auth/signin/anonymous';
    public const AUTH_SIGNIN_EMAIL_OTP = '/api/auth/signin/email-otp';
    public const AUTH_SIGNIN_MAGIC_LINK = '/api/auth/signin/magic-link';
    public const AUTH_SIGNIN_PHONE = '/api/auth/signin/phone';
    public const AUTH_SIGNOUT = '/api/auth/signout';
    public const AUTH_SIGNUP = '/api/auth/signup';
    public const AUTH_VERIFY_EMAIL = '/api/auth/verify-email';
    public const AUTH_VERIFY_EMAIL_CHANGE = '/api/auth/verify-email-change';
    public const AUTH_VERIFY_EMAIL_OTP = '/api/auth/verify-email-otp';
    public const AUTH_VERIFY_LINK_PHONE = '/api/auth/verify-link-phone';
    public const AUTH_VERIFY_MAGIC_LINK = '/api/auth/verify-magic-link';
    public const AUTH_VERIFY_PHONE = '/api/auth/verify-phone';
    public const GET_CONFIG = '/api/config';

    public static function execute_d1_query(string $database): string
    {
        return "/api/d1/{$database}";
    }

    public static function db_list_records(string $namespace, string $instance_id, string $table): string
    {
        return "/api/db/{$namespace}/{$instance_id}/tables/{$table}";
    }

    public static function db_insert_record(string $namespace, string $instance_id, string $table): string
    {
        return "/api/db/{$namespace}/{$instance_id}/tables/{$table}";
    }

    public static function db_get_record(string $namespace, string $instance_id, string $table, string $id): string
    {
        return "/api/db/{$namespace}/{$instance_id}/tables/{$table}/{$id}";
    }

    public static function db_update_record(string $namespace, string $instance_id, string $table, string $id): string
    {
        return "/api/db/{$namespace}/{$instance_id}/tables/{$table}/{$id}";
    }

    public static function db_delete_record(string $namespace, string $instance_id, string $table, string $id): string
    {
        return "/api/db/{$namespace}/{$instance_id}/tables/{$table}/{$id}";
    }

    public static function db_batch_records(string $namespace, string $instance_id, string $table): string
    {
        return "/api/db/{$namespace}/{$instance_id}/tables/{$table}/batch";
    }

    public static function db_batch_by_filter(string $namespace, string $instance_id, string $table): string
    {
        return "/api/db/{$namespace}/{$instance_id}/tables/{$table}/batch-by-filter";
    }

    public static function db_count_records(string $namespace, string $instance_id, string $table): string
    {
        return "/api/db/{$namespace}/{$instance_id}/tables/{$table}/count";
    }

    public static function db_search_records(string $namespace, string $instance_id, string $table): string
    {
        return "/api/db/{$namespace}/{$instance_id}/tables/{$table}/search";
    }

    public static function db_single_list_records(string $namespace, string $table): string
    {
        return "/api/db/{$namespace}/tables/{$table}";
    }

    public static function db_single_insert_record(string $namespace, string $table): string
    {
        return "/api/db/{$namespace}/tables/{$table}";
    }

    public static function db_single_get_record(string $namespace, string $table, string $id): string
    {
        return "/api/db/{$namespace}/tables/{$table}/{$id}";
    }

    public static function db_single_update_record(string $namespace, string $table, string $id): string
    {
        return "/api/db/{$namespace}/tables/{$table}/{$id}";
    }

    public static function db_single_delete_record(string $namespace, string $table, string $id): string
    {
        return "/api/db/{$namespace}/tables/{$table}/{$id}";
    }

    public static function db_single_batch_records(string $namespace, string $table): string
    {
        return "/api/db/{$namespace}/tables/{$table}/batch";
    }

    public static function db_single_batch_by_filter(string $namespace, string $table): string
    {
        return "/api/db/{$namespace}/tables/{$table}/batch-by-filter";
    }

    public static function db_single_count_records(string $namespace, string $table): string
    {
        return "/api/db/{$namespace}/tables/{$table}/count";
    }

    public static function db_single_search_records(string $namespace, string $table): string
    {
        return "/api/db/{$namespace}/tables/{$table}/search";
    }
    public const DATABASE_LIVE_BROADCAST = '/api/db/broadcast';
    public const CHECK_DATABASE_SUBSCRIPTION_CONNECTION = '/api/db/connect-check';
    public const CONNECT_DATABASE_SUBSCRIPTION = '/api/db/subscribe';
    public const GET_HEALTH = '/api/health';

    public static function kv_operation(string $namespace): string
    {
        return "/api/kv/{$namespace}";
    }
    public const PUSH_BROADCAST = '/api/push/broadcast';
    public const GET_PUSH_LOGS = '/api/push/logs';
    public const PUSH_REGISTER = '/api/push/register';
    public const PUSH_SEND = '/api/push/send';
    public const PUSH_SEND_MANY = '/api/push/send-many';
    public const PUSH_SEND_TO_TOKEN = '/api/push/send-to-token';
    public const PUSH_SEND_TO_TOPIC = '/api/push/send-to-topic';
    public const GET_PUSH_TOKENS = '/api/push/tokens';
    public const PUT_PUSH_TOKENS = '/api/push/tokens';
    public const PATCH_PUSH_TOKENS = '/api/push/tokens';
    public const PUSH_TOPIC_SUBSCRIBE = '/api/push/topic/subscribe';
    public const PUSH_TOPIC_UNSUBSCRIBE = '/api/push/topic/unsubscribe';
    public const PUSH_UNREGISTER = '/api/push/unregister';
    public const CONNECT_ROOM = '/api/room';
    public const CHECK_ROOM_CONNECTION = '/api/room/connect-check';
    public const CREATE_ROOM_CLOUDFLARE_REALTIME_KIT_SESSION = '/api/room/media/cloudflare_realtimekit/session';
    public const RENEGOTIATE_ROOM_REALTIME_SESSION = '/api/room/media/realtime/renegotiate';
    public const GET_ROOM_REALTIME_SESSION = '/api/room/media/realtime/session';
    public const CREATE_ROOM_REALTIME_SESSION = '/api/room/media/realtime/session';
    public const CLOSE_ROOM_REALTIME_TRACKS = '/api/room/media/realtime/tracks/close';
    public const ADD_ROOM_REALTIME_TRACKS = '/api/room/media/realtime/tracks/new';
    public const CREATE_ROOM_REALTIME_ICE_SERVERS = '/api/room/media/realtime/turn';
    public const GET_ROOM_METADATA = '/api/room/metadata';
    public const GET_SCHEMA = '/api/schema';
    public const EXECUTE_SQL = '/api/sql';

    public static function list_files(string $bucket): string
    {
        return "/api/storage/{$bucket}";
    }

    public static function check_file_exists(string $bucket, string $key): string
    {
        return "/api/storage/{$bucket}/{$key}";
    }

    public static function download_file(string $bucket, string $key): string
    {
        return "/api/storage/{$bucket}/{$key}";
    }

    public static function delete_file(string $bucket, string $key): string
    {
        return "/api/storage/{$bucket}/{$key}";
    }

    public static function get_file_metadata(string $bucket, string $key): string
    {
        return "/api/storage/{$bucket}/{$key}/metadata";
    }

    public static function update_file_metadata(string $bucket, string $key): string
    {
        return "/api/storage/{$bucket}/{$key}/metadata";
    }

    public static function delete_batch(string $bucket): string
    {
        return "/api/storage/{$bucket}/delete-batch";
    }

    public static function abort_multipart_upload(string $bucket): string
    {
        return "/api/storage/{$bucket}/multipart/abort";
    }

    public static function complete_multipart_upload(string $bucket): string
    {
        return "/api/storage/{$bucket}/multipart/complete";
    }

    public static function create_multipart_upload(string $bucket): string
    {
        return "/api/storage/{$bucket}/multipart/create";
    }

    public static function upload_part(string $bucket): string
    {
        return "/api/storage/{$bucket}/multipart/upload-part";
    }

    public static function create_signed_upload_url(string $bucket): string
    {
        return "/api/storage/{$bucket}/signed-upload-url";
    }

    public static function create_signed_download_url(string $bucket): string
    {
        return "/api/storage/{$bucket}/signed-url";
    }

    public static function create_signed_download_urls(string $bucket): string
    {
        return "/api/storage/{$bucket}/signed-urls";
    }

    public static function upload_file(string $bucket): string
    {
        return "/api/storage/{$bucket}/upload";
    }

    public static function get_upload_parts(string $bucket, string $upload_id): string
    {
        return "/api/storage/{$bucket}/uploads/{$upload_id}/parts";
    }

    public static function vectorize_operation(string $index): string
    {
        return "/api/vectorize/{$index}";
    }
}
