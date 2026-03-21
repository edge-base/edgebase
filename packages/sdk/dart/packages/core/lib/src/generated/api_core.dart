// Auto-generated core API Core — DO NOT EDIT.
// Regenerate: npx tsx tools/sdk-codegen/generate.ts
// Source: openapi.json (0.1.0)

import '../http_client.dart';

/// Auto-generated API methods.
class GeneratedDbApi {
  final HttpClient _http;

  /// Expose the underlying HttpClient for subclass access.
  HttpClient get httpClient => _http;

  GeneratedDbApi(this._http);

  /// Health check — GET /api/health
  Future<dynamic> getHealth() async {
    return _http.get('/health', null);
  }

  /// Sign up with email and password — POST /api/auth/signup
  Future<dynamic> authSignup(Object? body) async {
    return _http.post('/auth/signup', body);
  }

  /// Sign in with email and password — POST /api/auth/signin
  Future<dynamic> authSignin(Object? body) async {
    return _http.post('/auth/signin', body);
  }

  /// Sign in anonymously — POST /api/auth/signin/anonymous
  Future<dynamic> authSigninAnonymous(Object? body) async {
    return _http.post('/auth/signin/anonymous', body);
  }

  /// Send magic link to email — POST /api/auth/signin/magic-link
  Future<dynamic> authSigninMagicLink(Object? body) async {
    return _http.post('/auth/signin/magic-link', body);
  }

  /// Verify magic link token — POST /api/auth/verify-magic-link
  Future<dynamic> authVerifyMagicLink(Object? body) async {
    return _http.post('/auth/verify-magic-link', body);
  }

  /// Send OTP SMS to phone number — POST /api/auth/signin/phone
  Future<dynamic> authSigninPhone(Object? body) async {
    return _http.post('/auth/signin/phone', body);
  }

  /// Verify phone OTP and create session — POST /api/auth/verify-phone
  Future<dynamic> authVerifyPhone(Object? body) async {
    return _http.post('/auth/verify-phone', body);
  }

  /// Link phone number to existing account — POST /api/auth/link/phone
  Future<dynamic> authLinkPhone(Object? body) async {
    return _http.post('/auth/link/phone', body);
  }

  /// Verify OTP and link phone to account — POST /api/auth/verify-link-phone
  Future<dynamic> authVerifyLinkPhone(Object? body) async {
    return _http.post('/auth/verify-link-phone', body);
  }

  /// Send OTP code to email — POST /api/auth/signin/email-otp
  Future<dynamic> authSigninEmailOtp(Object? body) async {
    return _http.post('/auth/signin/email-otp', body);
  }

  /// Verify email OTP and create session — POST /api/auth/verify-email-otp
  Future<dynamic> authVerifyEmailOtp(Object? body) async {
    return _http.post('/auth/verify-email-otp', body);
  }

  /// Enroll new TOTP factor — POST /api/auth/mfa/totp/enroll
  Future<dynamic> authMfaTotpEnroll() async {
    return _http.post('/auth/mfa/totp/enroll', {});
  }

  /// Confirm TOTP enrollment with code — POST /api/auth/mfa/totp/verify
  Future<dynamic> authMfaTotpVerify(Object? body) async {
    return _http.post('/auth/mfa/totp/verify', body);
  }

  /// Verify MFA code during signin — POST /api/auth/mfa/verify
  Future<dynamic> authMfaVerify(Object? body) async {
    return _http.post('/auth/mfa/verify', body);
  }

  /// Use recovery code during MFA signin — POST /api/auth/mfa/recovery
  Future<dynamic> authMfaRecovery(Object? body) async {
    return _http.post('/auth/mfa/recovery', body);
  }

  /// Disable TOTP factor — DELETE /api/auth/mfa/totp
  Future<dynamic> authMfaTotpDelete(Object? body) async {
    return _http.delete('/auth/mfa/totp', body);
  }

  /// List MFA factors for authenticated user — GET /api/auth/mfa/factors
  Future<dynamic> authMfaFactors() async {
    return _http.get('/auth/mfa/factors', null);
  }

  /// Refresh access token — POST /api/auth/refresh
  Future<dynamic> authRefresh(Object? body) async {
    return _http.post('/auth/refresh', body);
  }

  /// Sign out and revoke refresh token — POST /api/auth/signout
  Future<dynamic> authSignout(Object? body) async {
    return _http.post('/auth/signout', body);
  }

  /// Change password for authenticated user — POST /api/auth/change-password
  Future<dynamic> authChangePassword(Object? body) async {
    return _http.post('/auth/change-password', body);
  }

  /// Request email change with password confirmation — POST /api/auth/change-email
  Future<dynamic> authChangeEmail(Object? body) async {
    return _http.post('/auth/change-email', body);
  }

  /// Verify email change token — POST /api/auth/verify-email-change
  Future<dynamic> authVerifyEmailChange(Object? body) async {
    return _http.post('/auth/verify-email-change', body);
  }

  /// Generate passkey registration options — POST /api/auth/passkeys/register-options
  Future<dynamic> authPasskeysRegisterOptions() async {
    return _http.post('/auth/passkeys/register-options', {});
  }

  /// Verify and store passkey registration — POST /api/auth/passkeys/register
  Future<dynamic> authPasskeysRegister(Object? body) async {
    return _http.post('/auth/passkeys/register', body);
  }

  /// Generate passkey authentication options — POST /api/auth/passkeys/auth-options
  Future<dynamic> authPasskeysAuthOptions(Object? body) async {
    return _http.post('/auth/passkeys/auth-options', body);
  }

  /// Authenticate with passkey — POST /api/auth/passkeys/authenticate
  Future<dynamic> authPasskeysAuthenticate(Object? body) async {
    return _http.post('/auth/passkeys/authenticate', body);
  }

  /// List passkeys for authenticated user — GET /api/auth/passkeys
  Future<dynamic> authPasskeysList() async {
    return _http.get('/auth/passkeys', null);
  }

  /// Delete a passkey — DELETE /api/auth/passkeys/{credentialId}
  Future<dynamic> authPasskeysDelete(String credentialId) async {
    return _http.delete('/auth/passkeys/${Uri.encodeComponent(credentialId)}');
  }

  /// Get current authenticated user info — GET /api/auth/me
  Future<dynamic> authGetMe() async {
    return _http.get('/auth/me', null);
  }

  /// Update user profile — PATCH /api/auth/profile
  Future<dynamic> authUpdateProfile(Object? body) async {
    return _http.patch('/auth/profile', body);
  }

  /// List active sessions — GET /api/auth/sessions
  Future<dynamic> authGetSessions() async {
    return _http.get('/auth/sessions', null);
  }

  /// Delete a session — DELETE /api/auth/sessions/{id}
  Future<dynamic> authDeleteSession(String id) async {
    return _http.delete('/auth/sessions/${Uri.encodeComponent(id)}');
  }

  /// List linked sign-in identities for the current user — GET /api/auth/identities
  Future<dynamic> authGetIdentities() async {
    return _http.get('/auth/identities', null);
  }

  /// Unlink a linked sign-in identity — DELETE /api/auth/identities/{identityId}
  Future<dynamic> authDeleteIdentity(String identityId) async {
    return _http.delete('/auth/identities/${Uri.encodeComponent(identityId)}');
  }

  /// Link email and password to existing account — POST /api/auth/link/email
  Future<dynamic> authLinkEmail(Object? body) async {
    return _http.post('/auth/link/email', body);
  }

  /// Send a verification email to the current authenticated user — POST /api/auth/request-email-verification
  Future<dynamic> authRequestEmailVerification(Object? body) async {
    return _http.post('/auth/request-email-verification', body);
  }

  /// Verify email address with token — POST /api/auth/verify-email
  Future<dynamic> authVerifyEmail(Object? body) async {
    return _http.post('/auth/verify-email', body);
  }

  /// Request password reset email — POST /api/auth/request-password-reset
  Future<dynamic> authRequestPasswordReset(Object? body) async {
    return _http.post('/auth/request-password-reset', body);
  }

  /// Reset password with token — POST /api/auth/reset-password
  Future<dynamic> authResetPassword(Object? body) async {
    return _http.post('/auth/reset-password', body);
  }

  /// Start OAuth redirect — GET /api/auth/oauth/{provider}
  Future<dynamic> oauthRedirect(String provider) async {
    return _http.get('/auth/oauth/${Uri.encodeComponent(provider)}', null);
  }

  /// OAuth callback — GET /api/auth/oauth/{provider}/callback
  Future<dynamic> oauthCallback(String provider) async {
    return _http.get('/auth/oauth/${Uri.encodeComponent(provider)}/callback', null);
  }

  /// Start OAuth account linking — POST /api/auth/oauth/link/{provider}
  Future<dynamic> oauthLinkStart(String provider) async {
    return _http.post('/auth/oauth/link/${Uri.encodeComponent(provider)}', {});
  }

  /// OAuth link callback — GET /api/auth/oauth/link/{provider}/callback
  Future<dynamic> oauthLinkCallback(String provider) async {
    return _http.get('/auth/oauth/link/${Uri.encodeComponent(provider)}/callback', null);
  }

  /// Count records in a single-instance table — GET /api/db/{namespace}/tables/{table}/count
  Future<dynamic> dbSingleCountRecords(String namespace, String table, Map<String, String>? query) async {
    return _http.get('/db/${Uri.encodeComponent(namespace)}/tables/${Uri.encodeComponent(table)}/count', query);
  }

  /// Search records in a single-instance table — GET /api/db/{namespace}/tables/{table}/search
  Future<dynamic> dbSingleSearchRecords(String namespace, String table, Map<String, String>? query) async {
    return _http.get('/db/${Uri.encodeComponent(namespace)}/tables/${Uri.encodeComponent(table)}/search', query);
  }

  /// Get a single record from a single-instance table — GET /api/db/{namespace}/tables/{table}/{id}
  Future<dynamic> dbSingleGetRecord(String namespace, String table, String id, Map<String, String>? query) async {
    return _http.get('/db/${Uri.encodeComponent(namespace)}/tables/${Uri.encodeComponent(table)}/${Uri.encodeComponent(id)}', query);
  }

  /// Update a record in a single-instance table — PATCH /api/db/{namespace}/tables/{table}/{id}
  Future<dynamic> dbSingleUpdateRecord(String namespace, String table, String id, Object? body) async {
    return _http.patch('/db/${Uri.encodeComponent(namespace)}/tables/${Uri.encodeComponent(table)}/${Uri.encodeComponent(id)}', body);
  }

  /// Delete a record from a single-instance table — DELETE /api/db/{namespace}/tables/{table}/{id}
  Future<dynamic> dbSingleDeleteRecord(String namespace, String table, String id) async {
    return _http.delete('/db/${Uri.encodeComponent(namespace)}/tables/${Uri.encodeComponent(table)}/${Uri.encodeComponent(id)}');
  }

  /// List records from a single-instance table — GET /api/db/{namespace}/tables/{table}
  Future<dynamic> dbSingleListRecords(String namespace, String table, Map<String, String>? query) async {
    return _http.get('/db/${Uri.encodeComponent(namespace)}/tables/${Uri.encodeComponent(table)}', query);
  }

  /// Insert a record into a single-instance table — POST /api/db/{namespace}/tables/{table}
  Future<dynamic> dbSingleInsertRecord(String namespace, String table, Object? body, Map<String, String>? query) async {
    return _http.postWithQuery('/db/${Uri.encodeComponent(namespace)}/tables/${Uri.encodeComponent(table)}', body, query);
  }

  /// Batch insert records into a single-instance table — POST /api/db/{namespace}/tables/{table}/batch
  Future<dynamic> dbSingleBatchRecords(String namespace, String table, Object? body, Map<String, String>? query) async {
    return _http.postWithQuery('/db/${Uri.encodeComponent(namespace)}/tables/${Uri.encodeComponent(table)}/batch', body, query);
  }

  /// Batch update/delete records by filter in a single-instance table — POST /api/db/{namespace}/tables/{table}/batch-by-filter
  Future<dynamic> dbSingleBatchByFilter(String namespace, String table, Object? body, Map<String, String>? query) async {
    return _http.postWithQuery('/db/${Uri.encodeComponent(namespace)}/tables/${Uri.encodeComponent(table)}/batch-by-filter', body, query);
  }

  /// Count records in dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/count
  Future<dynamic> dbCountRecords(String namespace, String instanceId, String table, Map<String, String>? query) async {
    return _http.get('/db/${Uri.encodeComponent(namespace)}/${Uri.encodeComponent(instanceId)}/tables/${Uri.encodeComponent(table)}/count', query);
  }

  /// Search records in dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/search
  Future<dynamic> dbSearchRecords(String namespace, String instanceId, String table, Map<String, String>? query) async {
    return _http.get('/db/${Uri.encodeComponent(namespace)}/${Uri.encodeComponent(instanceId)}/tables/${Uri.encodeComponent(table)}/search', query);
  }

  /// Get single record from dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/{id}
  Future<dynamic> dbGetRecord(String namespace, String instanceId, String table, String id, Map<String, String>? query) async {
    return _http.get('/db/${Uri.encodeComponent(namespace)}/${Uri.encodeComponent(instanceId)}/tables/${Uri.encodeComponent(table)}/${Uri.encodeComponent(id)}', query);
  }

  /// Update record in dynamic table — PATCH /api/db/{namespace}/{instanceId}/tables/{table}/{id}
  Future<dynamic> dbUpdateRecord(String namespace, String instanceId, String table, String id, Object? body) async {
    return _http.patch('/db/${Uri.encodeComponent(namespace)}/${Uri.encodeComponent(instanceId)}/tables/${Uri.encodeComponent(table)}/${Uri.encodeComponent(id)}', body);
  }

  /// Delete record from dynamic table — DELETE /api/db/{namespace}/{instanceId}/tables/{table}/{id}
  Future<dynamic> dbDeleteRecord(String namespace, String instanceId, String table, String id) async {
    return _http.delete('/db/${Uri.encodeComponent(namespace)}/${Uri.encodeComponent(instanceId)}/tables/${Uri.encodeComponent(table)}/${Uri.encodeComponent(id)}');
  }

  /// List records from dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}
  Future<dynamic> dbListRecords(String namespace, String instanceId, String table, Map<String, String>? query) async {
    return _http.get('/db/${Uri.encodeComponent(namespace)}/${Uri.encodeComponent(instanceId)}/tables/${Uri.encodeComponent(table)}', query);
  }

  /// Insert record into dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table}
  Future<dynamic> dbInsertRecord(String namespace, String instanceId, String table, Object? body, Map<String, String>? query) async {
    return _http.postWithQuery('/db/${Uri.encodeComponent(namespace)}/${Uri.encodeComponent(instanceId)}/tables/${Uri.encodeComponent(table)}', body, query);
  }

  /// Batch insert records into dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table}/batch
  Future<dynamic> dbBatchRecords(String namespace, String instanceId, String table, Object? body, Map<String, String>? query) async {
    return _http.postWithQuery('/db/${Uri.encodeComponent(namespace)}/${Uri.encodeComponent(instanceId)}/tables/${Uri.encodeComponent(table)}/batch', body, query);
  }

  /// Batch update/delete records by filter in dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table}/batch-by-filter
  Future<dynamic> dbBatchByFilter(String namespace, String instanceId, String table, Object? body, Map<String, String>? query) async {
    return _http.postWithQuery('/db/${Uri.encodeComponent(namespace)}/${Uri.encodeComponent(instanceId)}/tables/${Uri.encodeComponent(table)}/batch-by-filter', body, query);
  }

  /// Check database live subscription WebSocket prerequisites — GET /api/db/connect-check
  Future<dynamic> checkDatabaseSubscriptionConnection(Map<String, String>? query) async {
    return _http.get('/db/connect-check', query);
  }

  /// Connect to database live subscriptions WebSocket — GET /api/db/subscribe
  Future<dynamic> connectDatabaseSubscription(Map<String, String>? query) async {
    return _http.get('/db/subscribe', query);
  }

  /// Get table schema — GET /api/schema
  Future<dynamic> getSchema() async {
    return _http.get('/schema', null);
  }

  /// Upload file — POST /api/storage/{bucket}/upload
  Future<dynamic> uploadFile(String bucket, Object? body) async {
    return _http.post('/storage/${Uri.encodeComponent(bucket)}/upload', body);
  }

  /// Get file metadata — GET /api/storage/{bucket}/{key}/metadata
  Future<dynamic> getFileMetadata(String bucket, String key) async {
    return _http.get('/storage/${Uri.encodeComponent(bucket)}/${Uri.encodeComponent(key)}/metadata', null);
  }

  /// Update file metadata — PATCH /api/storage/{bucket}/{key}/metadata
  Future<dynamic> updateFileMetadata(String bucket, String key, Object? body) async {
    return _http.patch('/storage/${Uri.encodeComponent(bucket)}/${Uri.encodeComponent(key)}/metadata', body);
  }

  /// Check if file exists — HEAD /api/storage/{bucket}/{key}
  Future<bool> checkFileExists(String bucket, String key) async {
    return _http.head('/storage/${Uri.encodeComponent(bucket)}/${Uri.encodeComponent(key)}');
  }

  /// Download file — GET /api/storage/{bucket}/{key}
  Future<dynamic> downloadFile(String bucket, String key) async {
    return _http.get('/storage/${Uri.encodeComponent(bucket)}/${Uri.encodeComponent(key)}', null);
  }

  /// Delete file — DELETE /api/storage/{bucket}/{key}
  Future<dynamic> deleteFile(String bucket, String key) async {
    return _http.delete('/storage/${Uri.encodeComponent(bucket)}/${Uri.encodeComponent(key)}');
  }

  /// Get uploaded parts — GET /api/storage/{bucket}/uploads/{uploadId}/parts
  Future<dynamic> getUploadParts(String bucket, String uploadId, Map<String, String>? query) async {
    return _http.get('/storage/${Uri.encodeComponent(bucket)}/uploads/${Uri.encodeComponent(uploadId)}/parts', query);
  }

  /// List files in bucket — GET /api/storage/{bucket}
  Future<dynamic> listFiles(String bucket) async {
    return _http.get('/storage/${Uri.encodeComponent(bucket)}', null);
  }

  /// Batch delete files — POST /api/storage/{bucket}/delete-batch
  Future<dynamic> deleteBatch(String bucket, Object? body) async {
    return _http.post('/storage/${Uri.encodeComponent(bucket)}/delete-batch', body);
  }

  /// Create signed download URL — POST /api/storage/{bucket}/signed-url
  Future<dynamic> createSignedDownloadUrl(String bucket, Object? body) async {
    return _http.post('/storage/${Uri.encodeComponent(bucket)}/signed-url', body);
  }

  /// Batch create signed download URLs — POST /api/storage/{bucket}/signed-urls
  Future<dynamic> createSignedDownloadUrls(String bucket, Object? body) async {
    return _http.post('/storage/${Uri.encodeComponent(bucket)}/signed-urls', body);
  }

  /// Create signed upload URL — POST /api/storage/{bucket}/signed-upload-url
  Future<dynamic> createSignedUploadUrl(String bucket, Object? body) async {
    return _http.post('/storage/${Uri.encodeComponent(bucket)}/signed-upload-url', body);
  }

  /// Start multipart upload — POST /api/storage/{bucket}/multipart/create
  Future<dynamic> createMultipartUpload(String bucket, Object? body) async {
    return _http.post('/storage/${Uri.encodeComponent(bucket)}/multipart/create', body);
  }

  /// Upload a part — POST /api/storage/{bucket}/multipart/upload-part
  Future<dynamic> uploadPart(String bucket, Object? body) async {
    return _http.post('/storage/${Uri.encodeComponent(bucket)}/multipart/upload-part', body);
  }

  /// Complete multipart upload — POST /api/storage/{bucket}/multipart/complete
  Future<dynamic> completeMultipartUpload(String bucket, Object? body) async {
    return _http.post('/storage/${Uri.encodeComponent(bucket)}/multipart/complete', body);
  }

  /// Abort multipart upload — POST /api/storage/{bucket}/multipart/abort
  Future<dynamic> abortMultipartUpload(String bucket, Object? body) async {
    return _http.post('/storage/${Uri.encodeComponent(bucket)}/multipart/abort', body);
  }

  /// Get public configuration — GET /api/config
  Future<dynamic> getConfig() async {
    return _http.get('/config', null);
  }

  /// Register push token — POST /api/push/register
  Future<dynamic> pushRegister(Object? body) async {
    return _http.post('/push/register', body);
  }

  /// Unregister push token — POST /api/push/unregister
  Future<dynamic> pushUnregister(Object? body) async {
    return _http.post('/push/unregister', body);
  }

  /// Subscribe token to topic — POST /api/push/topic/subscribe
  Future<dynamic> pushTopicSubscribe(Object? body) async {
    return _http.post('/push/topic/subscribe', body);
  }

  /// Unsubscribe token from topic — POST /api/push/topic/unsubscribe
  Future<dynamic> pushTopicUnsubscribe(Object? body) async {
    return _http.post('/push/topic/unsubscribe', body);
  }

  /// Check room WebSocket connection prerequisites — GET /api/room/connect-check
  Future<dynamic> checkRoomConnection(Map<String, String>? query) async {
    return _http.get('/room/connect-check', query);
  }

  /// Connect to room WebSocket — GET /api/room
  Future<dynamic> connectRoom(Map<String, String>? query) async {
    return _http.get('/room', query);
  }

  /// Get room metadata — GET /api/room/metadata
  Future<dynamic> getRoomMetadata(Map<String, String>? query) async {
    return _http.get('/room/metadata', query);
  }

  /// Get the active room realtime media session — GET /api/room/media/realtime/session
  Future<dynamic> getRoomRealtimeSession(Map<String, String>? query) async {
    return _http.get('/room/media/realtime/session', query);
  }

  /// Create a room realtime media session — POST /api/room/media/realtime/session
  Future<dynamic> createRoomRealtimeSession(Object? body, Map<String, String>? query) async {
    return _http.postWithQuery('/room/media/realtime/session', body, query);
  }

  /// Generate TURN / ICE credentials for room realtime media — POST /api/room/media/realtime/turn
  Future<dynamic> createRoomRealtimeIceServers(Object? body, Map<String, String>? query) async {
    return _http.postWithQuery('/room/media/realtime/turn', body, query);
  }

  /// Add realtime media tracks to a room session — POST /api/room/media/realtime/tracks/new
  Future<dynamic> addRoomRealtimeTracks(Object? body, Map<String, String>? query) async {
    return _http.postWithQuery('/room/media/realtime/tracks/new', body, query);
  }

  /// Renegotiate a room realtime media session — PUT /api/room/media/realtime/renegotiate
  Future<dynamic> renegotiateRoomRealtimeSession(Object? body, Map<String, String>? query) async {
    return _http.putWithQuery('/room/media/realtime/renegotiate', body, query);
  }

  /// Close room realtime media tracks — PUT /api/room/media/realtime/tracks/close
  Future<dynamic> closeRoomRealtimeTracks(Object? body, Map<String, String>? query) async {
    return _http.putWithQuery('/room/media/realtime/tracks/close', body, query);
  }

  /// Create a room Cloudflare RealtimeKit session — POST /api/room/media/cloudflare_realtimekit/session
  Future<dynamic> createRoomCloudflareRealtimeKitSession(Object? body, Map<String, String>? query) async {
    return _http.postWithQuery('/room/media/cloudflare_realtimekit/session', body, query);
  }

  /// Track custom events — POST /api/analytics/track
  Future<dynamic> trackEvents(Object? body) async {
    return _http.post('/analytics/track', body);
  }
}

// ─── Path Constants ────────────────────────────────────────────────────────

class ApiPaths {
  ApiPaths._();

  static const ADMIN_LOGIN = '/admin/api/auth/login';
  static const ADMIN_REFRESH = '/admin/api/auth/refresh';
  static const BACKUP_CLEANUP_PLUGIN = '/admin/api/backup/cleanup-plugin';
  static const BACKUP_GET_CONFIG = '/admin/api/backup/config';
  static const BACKUP_DUMP_CONTROL_D1 = '/admin/api/backup/dump-control-d1';
  static const BACKUP_DUMP_D1 = '/admin/api/backup/dump-d1';
  static const BACKUP_DUMP_DATA = '/admin/api/backup/dump-data';
  static const BACKUP_DUMP_DO = '/admin/api/backup/dump-do';
  static const BACKUP_DUMP_STORAGE = '/admin/api/backup/dump-storage';
  static String backupExportTable(String name) => '/admin/api/backup/export/$name';
  static const BACKUP_LIST_DOS = '/admin/api/backup/list-dos';
  static const BACKUP_RESTORE_CONTROL_D1 = '/admin/api/backup/restore-control-d1';
  static const BACKUP_RESTORE_D1 = '/admin/api/backup/restore-d1';
  static const BACKUP_RESTORE_DATA = '/admin/api/backup/restore-data';
  static const BACKUP_RESTORE_DO = '/admin/api/backup/restore-do';
  static const BACKUP_RESTORE_STORAGE = '/admin/api/backup/restore-storage';
  static const BACKUP_RESYNC_USERS_PUBLIC = '/admin/api/backup/resync-users-public';
  static const BACKUP_WIPE_DO = '/admin/api/backup/wipe-do';
  static const ADMIN_LIST_ADMINS = '/admin/api/data/admins';
  static const ADMIN_CREATE_ADMIN = '/admin/api/data/admins';
  static String adminDeleteAdmin(String id) => '/admin/api/data/admins/$id';
  static String adminChangePassword(String id) => '/admin/api/data/admins/$id/password';
  static const ADMIN_GET_ANALYTICS = '/admin/api/data/analytics';
  static const ADMIN_GET_ANALYTICS_EVENTS = '/admin/api/data/analytics/events';
  static const ADMIN_GET_AUTH_SETTINGS = '/admin/api/data/auth/settings';
  static const ADMIN_BACKUP_GET_CONFIG = '/admin/api/data/backup/config';
  static const ADMIN_BACKUP_DUMP_D1 = '/admin/api/data/backup/dump-d1';
  static const ADMIN_BACKUP_DUMP_DATA = '/admin/api/data/backup/dump-data';
  static const ADMIN_BACKUP_DUMP_DO = '/admin/api/data/backup/dump-do';
  static const ADMIN_BACKUP_LIST_DOS = '/admin/api/data/backup/list-dos';
  static const ADMIN_BACKUP_RESTORE_D1 = '/admin/api/data/backup/restore-d1';
  static const ADMIN_BACKUP_RESTORE_DATA = '/admin/api/data/backup/restore-data';
  static const ADMIN_BACKUP_RESTORE_DO = '/admin/api/data/backup/restore-do';
  static const ADMIN_CLEANUP_ANON = '/admin/api/data/cleanup-anon';
  static const ADMIN_GET_CONFIG_INFO = '/admin/api/data/config-info';
  static const ADMIN_DESTROY_APP = '/admin/api/data/destroy-app';
  static const ADMIN_GET_DEV_INFO = '/admin/api/data/dev-info';
  static const ADMIN_GET_EMAIL_TEMPLATES = '/admin/api/data/email/templates';
  static const ADMIN_LIST_FUNCTIONS = '/admin/api/data/functions';
  static const ADMIN_GET_LOGS = '/admin/api/data/logs';
  static const ADMIN_GET_RECENT_LOGS = '/admin/api/data/logs/recent';
  static const ADMIN_GET_MONITORING = '/admin/api/data/monitoring';
  static String adminListNamespaceInstances(String namespace) => '/admin/api/data/namespaces/$namespace/instances';
  static const ADMIN_GET_OVERVIEW = '/admin/api/data/overview';
  static const ADMIN_GET_PUSH_LOGS = '/admin/api/data/push/logs';
  static const ADMIN_TEST_PUSH_SEND = '/admin/api/data/push/test-send';
  static const ADMIN_GET_PUSH_TOKENS = '/admin/api/data/push/tokens';
  static const ADMIN_RULES_TEST = '/admin/api/data/rules-test';
  static const ADMIN_GET_SCHEMA = '/admin/api/data/schema';
  static const ADMIN_EXECUTE_SQL = '/admin/api/data/sql';
  static const ADMIN_LIST_BUCKETS = '/admin/api/data/storage/buckets';
  static String adminListBucketObjects(String name) => '/admin/api/data/storage/buckets/$name/objects';
  static String adminGetBucketObject(String name, String key) => '/admin/api/data/storage/buckets/$name/objects/$key';
  static String adminDeleteBucketObject(String name, String key) => '/admin/api/data/storage/buckets/$name/objects/$key';
  static String adminCreateSignedUrl(String name) => '/admin/api/data/storage/buckets/$name/signed-url';
  static String adminGetBucketStats(String name) => '/admin/api/data/storage/buckets/$name/stats';
  static String adminUploadFile(String name) => '/admin/api/data/storage/buckets/$name/upload';
  static const ADMIN_LIST_TABLES = '/admin/api/data/tables';
  static String adminExportTable(String name) => '/admin/api/data/tables/$name/export';
  static String adminImportTable(String name) => '/admin/api/data/tables/$name/import';
  static String adminGetTableRecords(String name) => '/admin/api/data/tables/$name/records';
  static String adminCreateTableRecord(String name) => '/admin/api/data/tables/$name/records';
  static String adminUpdateTableRecord(String name, String id) => '/admin/api/data/tables/$name/records/$id';
  static String adminDeleteTableRecord(String name, String id) => '/admin/api/data/tables/$name/records/$id';
  static const ADMIN_LIST_USERS = '/admin/api/data/users';
  static const ADMIN_CREATE_USER = '/admin/api/data/users';
  static String adminGetUser(String id) => '/admin/api/data/users/$id';
  static String adminUpdateUser(String id) => '/admin/api/data/users/$id';
  static String adminDeleteUser(String id) => '/admin/api/data/users/$id';
  static String adminDeleteUserMfa(String id) => '/admin/api/data/users/$id/mfa';
  static String adminGetUserProfile(String id) => '/admin/api/data/users/$id/profile';
  static String adminSendPasswordReset(String id) => '/admin/api/data/users/$id/send-password-reset';
  static String adminDeleteUserSessions(String id) => '/admin/api/data/users/$id/sessions';
  static const ADMIN_RESET_PASSWORD = '/admin/api/internal/reset-password';
  static const ADMIN_SETUP = '/admin/api/setup';
  static const ADMIN_SETUP_STATUS = '/admin/api/setup/status';
  static const QUERY_CUSTOM_EVENTS = '/api/analytics/events';
  static const QUERY_ANALYTICS = '/api/analytics/query';
  static const TRACK_EVENTS = '/api/analytics/track';
  static const ADMIN_AUTH_LIST_USERS = '/api/auth/admin/users';
  static const ADMIN_AUTH_CREATE_USER = '/api/auth/admin/users';
  static String adminAuthGetUser(String id) => '/api/auth/admin/users/$id';
  static String adminAuthUpdateUser(String id) => '/api/auth/admin/users/$id';
  static String adminAuthDeleteUser(String id) => '/api/auth/admin/users/$id';
  static String adminAuthSetClaims(String id) => '/api/auth/admin/users/$id/claims';
  static String adminAuthDeleteUserMfa(String id) => '/api/auth/admin/users/$id/mfa';
  static String adminAuthRevokeUserSessions(String id) => '/api/auth/admin/users/$id/revoke';
  static const ADMIN_AUTH_IMPORT_USERS = '/api/auth/admin/users/import';
  static const AUTH_CHANGE_EMAIL = '/api/auth/change-email';
  static const AUTH_CHANGE_PASSWORD = '/api/auth/change-password';
  static const AUTH_GET_IDENTITIES = '/api/auth/identities';
  static String authDeleteIdentity(String identityId) => '/api/auth/identities/$identityId';
  static const AUTH_LINK_EMAIL = '/api/auth/link/email';
  static const AUTH_LINK_PHONE = '/api/auth/link/phone';
  static const AUTH_GET_ME = '/api/auth/me';
  static const AUTH_MFA_FACTORS = '/api/auth/mfa/factors';
  static const AUTH_MFA_RECOVERY = '/api/auth/mfa/recovery';
  static const AUTH_MFA_TOTP_DELETE = '/api/auth/mfa/totp';
  static const AUTH_MFA_TOTP_ENROLL = '/api/auth/mfa/totp/enroll';
  static const AUTH_MFA_TOTP_VERIFY = '/api/auth/mfa/totp/verify';
  static const AUTH_MFA_VERIFY = '/api/auth/mfa/verify';
  static String oauthRedirect(String provider) => '/api/auth/oauth/$provider';
  static String oauthCallback(String provider) => '/api/auth/oauth/$provider/callback';
  static String oauthLinkStart(String provider) => '/api/auth/oauth/link/$provider';
  static String oauthLinkCallback(String provider) => '/api/auth/oauth/link/$provider/callback';
  static const AUTH_PASSKEYS_LIST = '/api/auth/passkeys';
  static String authPasskeysDelete(String credentialId) => '/api/auth/passkeys/$credentialId';
  static const AUTH_PASSKEYS_AUTH_OPTIONS = '/api/auth/passkeys/auth-options';
  static const AUTH_PASSKEYS_AUTHENTICATE = '/api/auth/passkeys/authenticate';
  static const AUTH_PASSKEYS_REGISTER = '/api/auth/passkeys/register';
  static const AUTH_PASSKEYS_REGISTER_OPTIONS = '/api/auth/passkeys/register-options';
  static const AUTH_UPDATE_PROFILE = '/api/auth/profile';
  static const AUTH_REFRESH = '/api/auth/refresh';
  static const AUTH_REQUEST_EMAIL_VERIFICATION = '/api/auth/request-email-verification';
  static const AUTH_REQUEST_PASSWORD_RESET = '/api/auth/request-password-reset';
  static const AUTH_RESET_PASSWORD = '/api/auth/reset-password';
  static const AUTH_GET_SESSIONS = '/api/auth/sessions';
  static String authDeleteSession(String id) => '/api/auth/sessions/$id';
  static const AUTH_SIGNIN = '/api/auth/signin';
  static const AUTH_SIGNIN_ANONYMOUS = '/api/auth/signin/anonymous';
  static const AUTH_SIGNIN_EMAIL_OTP = '/api/auth/signin/email-otp';
  static const AUTH_SIGNIN_MAGIC_LINK = '/api/auth/signin/magic-link';
  static const AUTH_SIGNIN_PHONE = '/api/auth/signin/phone';
  static const AUTH_SIGNOUT = '/api/auth/signout';
  static const AUTH_SIGNUP = '/api/auth/signup';
  static const AUTH_VERIFY_EMAIL = '/api/auth/verify-email';
  static const AUTH_VERIFY_EMAIL_CHANGE = '/api/auth/verify-email-change';
  static const AUTH_VERIFY_EMAIL_OTP = '/api/auth/verify-email-otp';
  static const AUTH_VERIFY_LINK_PHONE = '/api/auth/verify-link-phone';
  static const AUTH_VERIFY_MAGIC_LINK = '/api/auth/verify-magic-link';
  static const AUTH_VERIFY_PHONE = '/api/auth/verify-phone';
  static const GET_CONFIG = '/api/config';
  static String executeD1Query(String database) => '/api/d1/$database';
  static String dbListRecords(String namespace, String instanceId, String table) => '/api/db/$namespace/$instanceId/tables/$table';
  static String dbInsertRecord(String namespace, String instanceId, String table) => '/api/db/$namespace/$instanceId/tables/$table';
  static String dbGetRecord(String namespace, String instanceId, String table, String id) => '/api/db/$namespace/$instanceId/tables/$table/$id';
  static String dbUpdateRecord(String namespace, String instanceId, String table, String id) => '/api/db/$namespace/$instanceId/tables/$table/$id';
  static String dbDeleteRecord(String namespace, String instanceId, String table, String id) => '/api/db/$namespace/$instanceId/tables/$table/$id';
  static String dbBatchRecords(String namespace, String instanceId, String table) => '/api/db/$namespace/$instanceId/tables/$table/batch';
  static String dbBatchByFilter(String namespace, String instanceId, String table) => '/api/db/$namespace/$instanceId/tables/$table/batch-by-filter';
  static String dbCountRecords(String namespace, String instanceId, String table) => '/api/db/$namespace/$instanceId/tables/$table/count';
  static String dbSearchRecords(String namespace, String instanceId, String table) => '/api/db/$namespace/$instanceId/tables/$table/search';
  static String dbSingleListRecords(String namespace, String table) => '/api/db/$namespace/tables/$table';
  static String dbSingleInsertRecord(String namespace, String table) => '/api/db/$namespace/tables/$table';
  static String dbSingleGetRecord(String namespace, String table, String id) => '/api/db/$namespace/tables/$table/$id';
  static String dbSingleUpdateRecord(String namespace, String table, String id) => '/api/db/$namespace/tables/$table/$id';
  static String dbSingleDeleteRecord(String namespace, String table, String id) => '/api/db/$namespace/tables/$table/$id';
  static String dbSingleBatchRecords(String namespace, String table) => '/api/db/$namespace/tables/$table/batch';
  static String dbSingleBatchByFilter(String namespace, String table) => '/api/db/$namespace/tables/$table/batch-by-filter';
  static String dbSingleCountRecords(String namespace, String table) => '/api/db/$namespace/tables/$table/count';
  static String dbSingleSearchRecords(String namespace, String table) => '/api/db/$namespace/tables/$table/search';
  static const DATABASE_LIVE_BROADCAST = '/api/db/broadcast';
  static const CHECK_DATABASE_SUBSCRIPTION_CONNECTION = '/api/db/connect-check';
  static const CONNECT_DATABASE_SUBSCRIPTION = '/api/db/subscribe';
  static const GET_HEALTH = '/api/health';
  static String kvOperation(String namespace) => '/api/kv/$namespace';
  static const PUSH_BROADCAST = '/api/push/broadcast';
  static const GET_PUSH_LOGS = '/api/push/logs';
  static const PUSH_REGISTER = '/api/push/register';
  static const PUSH_SEND = '/api/push/send';
  static const PUSH_SEND_MANY = '/api/push/send-many';
  static const PUSH_SEND_TO_TOKEN = '/api/push/send-to-token';
  static const PUSH_SEND_TO_TOPIC = '/api/push/send-to-topic';
  static const GET_PUSH_TOKENS = '/api/push/tokens';
  static const PUT_PUSH_TOKENS = '/api/push/tokens';
  static const PATCH_PUSH_TOKENS = '/api/push/tokens';
  static const PUSH_TOPIC_SUBSCRIBE = '/api/push/topic/subscribe';
  static const PUSH_TOPIC_UNSUBSCRIBE = '/api/push/topic/unsubscribe';
  static const PUSH_UNREGISTER = '/api/push/unregister';
  static const CONNECT_ROOM = '/api/room';
  static const CHECK_ROOM_CONNECTION = '/api/room/connect-check';
  static const CREATE_ROOM_CLOUDFLARE_REALTIME_KIT_SESSION = '/api/room/media/cloudflare_realtimekit/session';
  static const RENEGOTIATE_ROOM_REALTIME_SESSION = '/api/room/media/realtime/renegotiate';
  static const GET_ROOM_REALTIME_SESSION = '/api/room/media/realtime/session';
  static const CREATE_ROOM_REALTIME_SESSION = '/api/room/media/realtime/session';
  static const CLOSE_ROOM_REALTIME_TRACKS = '/api/room/media/realtime/tracks/close';
  static const ADD_ROOM_REALTIME_TRACKS = '/api/room/media/realtime/tracks/new';
  static const CREATE_ROOM_REALTIME_ICE_SERVERS = '/api/room/media/realtime/turn';
  static const GET_ROOM_METADATA = '/api/room/metadata';
  static const GET_SCHEMA = '/api/schema';
  static const EXECUTE_SQL = '/api/sql';
  static String listFiles(String bucket) => '/api/storage/$bucket';
  static String checkFileExists(String bucket, String key) => '/api/storage/$bucket/$key';
  static String downloadFile(String bucket, String key) => '/api/storage/$bucket/$key';
  static String deleteFile(String bucket, String key) => '/api/storage/$bucket/$key';
  static String getFileMetadata(String bucket, String key) => '/api/storage/$bucket/$key/metadata';
  static String updateFileMetadata(String bucket, String key) => '/api/storage/$bucket/$key/metadata';
  static String deleteBatch(String bucket) => '/api/storage/$bucket/delete-batch';
  static String abortMultipartUpload(String bucket) => '/api/storage/$bucket/multipart/abort';
  static String completeMultipartUpload(String bucket) => '/api/storage/$bucket/multipart/complete';
  static String createMultipartUpload(String bucket) => '/api/storage/$bucket/multipart/create';
  static String uploadPart(String bucket) => '/api/storage/$bucket/multipart/upload-part';
  static String createSignedUploadUrl(String bucket) => '/api/storage/$bucket/signed-upload-url';
  static String createSignedDownloadUrl(String bucket) => '/api/storage/$bucket/signed-url';
  static String createSignedDownloadUrls(String bucket) => '/api/storage/$bucket/signed-urls';
  static String uploadFile(String bucket) => '/api/storage/$bucket/upload';
  static String getUploadParts(String bucket, String uploadId) => '/api/storage/$bucket/uploads/$uploadId/parts';
  static String vectorizeOperation(String index) => '/api/vectorize/$index';
}
