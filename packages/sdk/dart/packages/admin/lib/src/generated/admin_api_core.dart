// Auto-generated admin API Core — DO NOT EDIT.
// Regenerate: npx tsx tools/sdk-codegen/generate.ts
// Source: openapi.json (0.1.0)

import 'package:edgebase_core/src/http_client.dart';

/// Auto-generated API methods.
class GeneratedAdminApi {
  final HttpClient _http;

  /// Expose the underlying HttpClient for subclass access.
  HttpClient get httpClient => _http;

  GeneratedAdminApi(this._http);

  /// Get user by ID — GET /api/auth/admin/users/{id}
  Future<dynamic> adminAuthGetUser(String id) async {
    return _http.get('/auth/admin/users/${Uri.encodeComponent(id)}', null);
  }

  /// Update user by ID — PATCH /api/auth/admin/users/{id}
  Future<dynamic> adminAuthUpdateUser(String id, Object? body) async {
    return _http.patch('/auth/admin/users/${Uri.encodeComponent(id)}', body);
  }

  /// Delete user by ID — DELETE /api/auth/admin/users/{id}
  Future<dynamic> adminAuthDeleteUser(String id) async {
    return _http.delete('/auth/admin/users/${Uri.encodeComponent(id)}');
  }

  /// List users — GET /api/auth/admin/users
  Future<dynamic> adminAuthListUsers(Map<String, String>? query) async {
    return _http.get('/auth/admin/users', query);
  }

  /// Create a new user — POST /api/auth/admin/users
  Future<dynamic> adminAuthCreateUser(Object? body) async {
    return _http.post('/auth/admin/users', body);
  }

  /// Delete user MFA — DELETE /api/auth/admin/users/{id}/mfa
  Future<dynamic> adminAuthDeleteUserMfa(String id) async {
    return _http.delete('/auth/admin/users/${Uri.encodeComponent(id)}/mfa');
  }

  /// Set custom claims for user — PUT /api/auth/admin/users/{id}/claims
  Future<dynamic> adminAuthSetClaims(String id, Object? body) async {
    return _http.put('/auth/admin/users/${Uri.encodeComponent(id)}/claims', body);
  }

  /// Revoke all sessions for user — POST /api/auth/admin/users/{id}/revoke
  Future<dynamic> adminAuthRevokeUserSessions(String id) async {
    return _http.post('/auth/admin/users/${Uri.encodeComponent(id)}/revoke', {});
  }

  /// Batch import users — POST /api/auth/admin/users/import
  Future<dynamic> adminAuthImportUsers(Object? body) async {
    return _http.post('/auth/admin/users/import', body);
  }

  /// Broadcast to database live channel — POST /api/db/broadcast
  Future<dynamic> databaseLiveBroadcast(Object? body) async {
    return _http.post('/db/broadcast', body);
  }

  /// Execute SQL via DatabaseDO — POST /api/sql
  Future<dynamic> executeSql(Object? body) async {
    return _http.post('/sql', body);
  }

  /// Execute KV operation — POST /api/kv/{namespace}
  Future<dynamic> kvOperation(String namespace, Object? body) async {
    return _http.post('/kv/${Uri.encodeComponent(namespace)}', body);
  }

  /// Execute raw SQL on D1 database — POST /api/d1/{database}
  Future<dynamic> executeD1Query(String database, Object? body) async {
    return _http.post('/d1/${Uri.encodeComponent(database)}', body);
  }

  /// Execute Vectorize operation — POST /api/vectorize/{index}
  Future<dynamic> vectorizeOperation(String index, Object? body) async {
    return _http.post('/vectorize/${Uri.encodeComponent(index)}', body);
  }

  /// Send push notification to user — POST /api/push/send
  Future<dynamic> pushSend(Object? body) async {
    return _http.post('/push/send', body);
  }

  /// Send push to multiple users — POST /api/push/send-many
  Future<dynamic> pushSendMany(Object? body) async {
    return _http.post('/push/send-many', body);
  }

  /// Send push to specific token — POST /api/push/send-to-token
  Future<dynamic> pushSendToToken(Object? body) async {
    return _http.post('/push/send-to-token', body);
  }

  /// Send push to topic — POST /api/push/send-to-topic
  Future<dynamic> pushSendToTopic(Object? body) async {
    return _http.post('/push/send-to-topic', body);
  }

  /// Broadcast push to all devices — POST /api/push/broadcast
  Future<dynamic> pushBroadcast(Object? body) async {
    return _http.post('/push/broadcast', body);
  }

  /// Get push notification logs — GET /api/push/logs
  Future<dynamic> getPushLogs(Map<String, String>? query) async {
    return _http.get('/push/logs', query);
  }

  /// Get registered push tokens — GET /api/push/tokens
  Future<dynamic> getPushTokens(Map<String, String>? query) async {
    return _http.get('/push/tokens', query);
  }

  /// Upsert a device token — PUT /api/push/tokens
  Future<dynamic> putPushTokens(Object? body) async {
    return _http.put('/push/tokens', body);
  }

  /// Update device metadata — PATCH /api/push/tokens
  Future<dynamic> patchPushTokens(Object? body) async {
    return _http.patch('/push/tokens', body);
  }

  /// Query request log metrics — GET /api/analytics/query
  Future<dynamic> queryAnalytics(Map<String, String>? query) async {
    return _http.get('/analytics/query', query);
  }

  /// Query custom events — GET /api/analytics/events
  Future<dynamic> queryCustomEvents(Map<String, String>? query) async {
    return _http.get('/analytics/events', query);
  }

  /// Check if admin setup is needed — GET /admin/api/setup/status
  Future<dynamic> adminSetupStatus() async {
    return _http.get('/admin/api/setup/status', null);
  }

  /// Create the first admin account — POST /admin/api/setup
  Future<dynamic> adminSetup(Object? body) async {
    return _http.post('/admin/api/setup', body);
  }

  /// Admin login — POST /admin/api/auth/login
  Future<dynamic> adminLogin(Object? body) async {
    return _http.post('/admin/api/auth/login', body);
  }

  /// Rotate admin token — POST /admin/api/auth/refresh
  Future<dynamic> adminRefresh(Object? body) async {
    return _http.post('/admin/api/auth/refresh', body);
  }

  /// Reset admin password (Service Key required) — POST /admin/api/internal/reset-password
  Future<dynamic> adminResetPassword(Object? body) async {
    return _http.post('/admin/api/internal/reset-password', body);
  }

  /// List all tables from config — GET /admin/api/data/tables
  Future<dynamic> adminListTables() async {
    return _http.get('/admin/api/data/tables', null);
  }

  /// List table records with pagination — GET /admin/api/data/tables/{name}/records
  Future<dynamic> adminGetTableRecords(String name) async {
    return _http.get('/admin/api/data/tables/${Uri.encodeComponent(name)}/records', null);
  }

  /// Create a table record — POST /admin/api/data/tables/{name}/records
  Future<dynamic> adminCreateTableRecord(String name, Object? body) async {
    return _http.post('/admin/api/data/tables/${Uri.encodeComponent(name)}/records', body);
  }

  /// Update a table record — PUT /admin/api/data/tables/{name}/records/{id}
  Future<dynamic> adminUpdateTableRecord(String name, String id, Object? body) async {
    return _http.put('/admin/api/data/tables/${Uri.encodeComponent(name)}/records/${Uri.encodeComponent(id)}', body);
  }

  /// Delete a table record — DELETE /admin/api/data/tables/{name}/records/{id}
  Future<dynamic> adminDeleteTableRecord(String name, String id) async {
    return _http.delete('/admin/api/data/tables/${Uri.encodeComponent(name)}/records/${Uri.encodeComponent(id)}');
  }

  /// List users via D1 index — GET /admin/api/data/users
  Future<dynamic> adminListUsers() async {
    return _http.get('/admin/api/data/users', null);
  }

  /// Create a new user — POST /admin/api/data/users
  Future<dynamic> adminCreateUser(Object? body) async {
    return _http.post('/admin/api/data/users', body);
  }

  /// Fetch a single user by ID — GET /admin/api/data/users/{id}
  Future<dynamic> adminGetUser(String id) async {
    return _http.get('/admin/api/data/users/${Uri.encodeComponent(id)}', null);
  }

  /// Update user status or role — PUT /admin/api/data/users/{id}
  Future<dynamic> adminUpdateUser(String id, Object? body) async {
    return _http.put('/admin/api/data/users/${Uri.encodeComponent(id)}', body);
  }

  /// Delete a user completely — DELETE /admin/api/data/users/{id}
  Future<dynamic> adminDeleteUser(String id) async {
    return _http.delete('/admin/api/data/users/${Uri.encodeComponent(id)}');
  }

  /// Fetch user profile with cache — GET /admin/api/data/users/{id}/profile
  Future<dynamic> adminGetUserProfile(String id) async {
    return _http.get('/admin/api/data/users/${Uri.encodeComponent(id)}/profile', null);
  }

  /// Revoke all user sessions — DELETE /admin/api/data/users/{id}/sessions
  Future<dynamic> adminDeleteUserSessions(String id) async {
    return _http.delete('/admin/api/data/users/${Uri.encodeComponent(id)}/sessions');
  }

  /// Cleanup anonymous user index — POST /admin/api/data/cleanup-anon
  Future<dynamic> adminCleanupAnon() async {
    return _http.post('/admin/api/data/cleanup-anon', {});
  }

  /// List configured storage buckets — GET /admin/api/data/storage/buckets
  Future<dynamic> adminListBuckets() async {
    return _http.get('/admin/api/data/storage/buckets', null);
  }

  /// List objects in a storage bucket — GET /admin/api/data/storage/buckets/{name}/objects
  Future<dynamic> adminListBucketObjects(String name) async {
    return _http.get('/admin/api/data/storage/buckets/${Uri.encodeComponent(name)}/objects', null);
  }

  /// Get a storage object content — GET /admin/api/data/storage/buckets/{name}/objects/{key}
  Future<dynamic> adminGetBucketObject(String name, String key) async {
    return _http.get('/admin/api/data/storage/buckets/${Uri.encodeComponent(name)}/objects/${Uri.encodeComponent(key)}', null);
  }

  /// Delete a storage object — DELETE /admin/api/data/storage/buckets/{name}/objects/{key}
  Future<dynamic> adminDeleteBucketObject(String name, String key) async {
    return _http.delete('/admin/api/data/storage/buckets/${Uri.encodeComponent(name)}/objects/${Uri.encodeComponent(key)}');
  }

  /// Get bucket statistics (total objects and size) — GET /admin/api/data/storage/buckets/{name}/stats
  Future<dynamic> adminGetBucketStats(String name) async {
    return _http.get('/admin/api/data/storage/buckets/${Uri.encodeComponent(name)}/stats', null);
  }

  /// Create a signed download URL for a storage object — POST /admin/api/data/storage/buckets/{name}/signed-url
  Future<dynamic> adminCreateSignedUrl(String name, Object? body) async {
    return _http.post('/admin/api/data/storage/buckets/${Uri.encodeComponent(name)}/signed-url', body);
  }

  /// Get full schema structure from config — GET /admin/api/data/schema
  Future<dynamic> adminGetSchema() async {
    return _http.get('/admin/api/data/schema', null);
  }

  /// List instance suggestions for a dynamic namespace — GET /admin/api/data/namespaces/{namespace}/instances
  Future<dynamic> adminListNamespaceInstances(String namespace, Map<String, String>? query) async {
    return _http.get('/admin/api/data/namespaces/${Uri.encodeComponent(namespace)}/instances', query);
  }

  /// Export table data as JSON — GET /admin/api/data/tables/{name}/export
  Future<dynamic> adminExportTable(String name) async {
    return _http.get('/admin/api/data/tables/${Uri.encodeComponent(name)}/export', null);
  }

  /// Get request logs — GET /admin/api/data/logs
  Future<dynamic> adminGetLogs() async {
    return _http.get('/admin/api/data/logs', null);
  }

  /// Get live monitoring stats — GET /admin/api/data/monitoring
  Future<dynamic> adminGetMonitoring() async {
    return _http.get('/admin/api/data/monitoring', null);
  }

  /// Get analytics dashboard data — GET /admin/api/data/analytics
  Future<dynamic> adminGetAnalytics(Map<String, String>? query) async {
    return _http.get('/admin/api/data/analytics', query);
  }

  /// Query analytics events for admin dashboard — GET /admin/api/data/analytics/events
  Future<dynamic> adminGetAnalyticsEvents() async {
    return _http.get('/admin/api/data/analytics/events', null);
  }

  /// Get project overview for dashboard home — GET /admin/api/data/overview
  Future<dynamic> adminGetOverview(Map<String, String>? query) async {
    return _http.get('/admin/api/data/overview', query);
  }

  /// Get dev mode status and sidecar port — GET /admin/api/data/dev-info
  Future<dynamic> adminGetDevInfo() async {
    return _http.get('/admin/api/data/dev-info', null);
  }

  /// Execute raw SQL query — POST /admin/api/data/sql
  Future<dynamic> adminExecuteSql(Object? body) async {
    return _http.post('/admin/api/data/sql', body);
  }

  /// Batch import records into a table — POST /admin/api/data/tables/{name}/import
  Future<dynamic> adminImportTable(String name, Object? body) async {
    return _http.post('/admin/api/data/tables/${Uri.encodeComponent(name)}/import', body);
  }

  /// Evaluate access rules with simulated auth context — POST /admin/api/data/rules-test
  Future<dynamic> adminRulesTest(Object? body) async {
    return _http.post('/admin/api/data/rules-test', body);
  }

  /// List registered functions from config — GET /admin/api/data/functions
  Future<dynamic> adminListFunctions() async {
    return _http.get('/admin/api/data/functions', null);
  }

  /// Get environment and config overview — GET /admin/api/data/config-info
  Future<dynamic> adminGetConfigInfo() async {
    return _http.get('/admin/api/data/config-info', null);
  }

  /// Get recent request logs with filtering — GET /admin/api/data/logs/recent
  Future<dynamic> adminGetRecentLogs() async {
    return _http.get('/admin/api/data/logs/recent', null);
  }

  /// Get OAuth provider config — GET /admin/api/data/auth/settings
  Future<dynamic> adminGetAuthSettings() async {
    return _http.get('/admin/api/data/auth/settings', null);
  }

  /// Get email template and subject config — GET /admin/api/data/email/templates
  Future<dynamic> adminGetEmailTemplates() async {
    return _http.get('/admin/api/data/email/templates', null);
  }

  /// Disable MFA for a user — DELETE /admin/api/data/users/{id}/mfa
  Future<dynamic> adminDeleteUserMfa(String id) async {
    return _http.delete('/admin/api/data/users/${Uri.encodeComponent(id)}/mfa');
  }

  /// Send password reset email for a user — POST /admin/api/data/users/{id}/send-password-reset
  Future<dynamic> adminSendPasswordReset(String id) async {
    return _http.post('/admin/api/data/users/${Uri.encodeComponent(id)}/send-password-reset', {});
  }

  /// Upload file to R2 storage — POST /admin/api/data/storage/buckets/{name}/upload
  Future<dynamic> adminUploadFile(String name, Object? body) async {
    return _http.post('/admin/api/data/storage/buckets/${Uri.encodeComponent(name)}/upload', body);
  }

  /// List push tokens for a user — GET /admin/api/data/push/tokens
  Future<dynamic> adminGetPushTokens() async {
    return _http.get('/admin/api/data/push/tokens', null);
  }

  /// Get push notification logs — GET /admin/api/data/push/logs
  Future<dynamic> adminGetPushLogs() async {
    return _http.get('/admin/api/data/push/logs', null);
  }

  /// Test send push notification — POST /admin/api/data/push/test-send
  Future<dynamic> adminTestPushSend(Object? body) async {
    return _http.post('/admin/api/data/push/test-send', body);
  }

  /// List Durable Objects for backup — POST /admin/api/data/backup/list-dos
  Future<dynamic> adminBackupListDOs() async {
    return _http.post('/admin/api/data/backup/list-dos', {});
  }

  /// Dump a Durable Object for backup — POST /admin/api/data/backup/dump-do
  Future<dynamic> adminBackupDumpDO(Object? body) async {
    return _http.post('/admin/api/data/backup/dump-do', body);
  }

  /// Restore a Durable Object from backup — POST /admin/api/data/backup/restore-do
  Future<dynamic> adminBackupRestoreDO(Object? body) async {
    return _http.post('/admin/api/data/backup/restore-do', body);
  }

  /// Dump D1 database for backup — POST /admin/api/data/backup/dump-d1
  Future<dynamic> adminBackupDumpD1() async {
    return _http.post('/admin/api/data/backup/dump-d1', {});
  }

  /// Restore D1 database from backup — POST /admin/api/data/backup/restore-d1
  Future<dynamic> adminBackupRestoreD1(Object? body) async {
    return _http.post('/admin/api/data/backup/restore-d1', body);
  }

  /// Dump data namespace tables for admin-side migrations — POST /admin/api/data/backup/dump-data
  Future<dynamic> adminBackupDumpData(Object? body) async {
    return _http.post('/admin/api/data/backup/dump-data', body);
  }

  /// Restore data namespace tables for admin-side migrations — POST /admin/api/data/backup/restore-data
  Future<dynamic> adminBackupRestoreData(Object? body) async {
    return _http.post('/admin/api/data/backup/restore-data', body);
  }

  /// Get backup config — GET /admin/api/data/backup/config
  Future<dynamic> adminBackupGetConfig() async {
    return _http.get('/admin/api/data/backup/config', null);
  }

  /// List admin accounts — GET /admin/api/data/admins
  Future<dynamic> adminListAdmins() async {
    return _http.get('/admin/api/data/admins', null);
  }

  /// Create an admin account — POST /admin/api/data/admins
  Future<dynamic> adminCreateAdmin(Object? body) async {
    return _http.post('/admin/api/data/admins', body);
  }

  /// Delete an admin account — DELETE /admin/api/data/admins/{id}
  Future<dynamic> adminDeleteAdmin(String id) async {
    return _http.delete('/admin/api/data/admins/${Uri.encodeComponent(id)}');
  }

  /// Change admin password — PUT /admin/api/data/admins/{id}/password
  Future<dynamic> adminChangePassword(String id, Object? body) async {
    return _http.put('/admin/api/data/admins/${Uri.encodeComponent(id)}/password', body);
  }

  /// Delete all Cloudflare resources and the Worker itself (self-destruct) — POST /admin/api/data/destroy-app
  Future<dynamic> adminDestroyApp(Object? body) async {
    return _http.post('/admin/api/data/destroy-app', body);
  }

  /// List all DO instances — POST /admin/api/backup/list-dos
  Future<dynamic> backupListDOs(Object? body) async {
    return _http.post('/admin/api/backup/list-dos', body);
  }

  /// Return parsed config snapshot — GET /admin/api/backup/config
  Future<dynamic> backupGetConfig() async {
    return _http.get('/admin/api/backup/config', null);
  }

  /// Remove plugin-prefixed tables and migration metadata — POST /admin/api/backup/cleanup-plugin
  Future<dynamic> backupCleanupPlugin(Object? body) async {
    return _http.post('/admin/api/backup/cleanup-plugin', body);
  }

  /// Wipe a specific DO's data — POST /admin/api/backup/wipe-do
  Future<dynamic> backupWipeDO(Object? body) async {
    return _http.post('/admin/api/backup/wipe-do', body);
  }

  /// Dump a specific DO's data — POST /admin/api/backup/dump-do
  Future<dynamic> backupDumpDO(Object? body) async {
    return _http.post('/admin/api/backup/dump-do', body);
  }

  /// Restore a specific DO's data — POST /admin/api/backup/restore-do
  Future<dynamic> backupRestoreDO(Object? body) async {
    return _http.post('/admin/api/backup/restore-do', body);
  }

  /// Dump auth database tables — POST /admin/api/backup/dump-d1
  Future<dynamic> backupDumpD1() async {
    return _http.post('/admin/api/backup/dump-d1', {});
  }

  /// Restore auth database tables — POST /admin/api/backup/restore-d1
  Future<dynamic> backupRestoreD1(Object? body) async {
    return _http.post('/admin/api/backup/restore-d1', body);
  }

  /// Dump control-plane D1 tables — POST /admin/api/backup/dump-control-d1
  Future<dynamic> backupDumpControlD1() async {
    return _http.post('/admin/api/backup/dump-control-d1', {});
  }

  /// Restore control-plane D1 tables — POST /admin/api/backup/restore-control-d1
  Future<dynamic> backupRestoreControlD1(Object? body) async {
    return _http.post('/admin/api/backup/restore-control-d1', body);
  }

  /// Dump all tables from a data namespace — POST /admin/api/backup/dump-data
  Future<dynamic> backupDumpData(Object? body) async {
    return _http.post('/admin/api/backup/dump-data', body);
  }

  /// Restore all tables into a data namespace — POST /admin/api/backup/restore-data
  Future<dynamic> backupRestoreData(Object? body) async {
    return _http.post('/admin/api/backup/restore-data', body);
  }

  /// Dump R2 storage (list or download) — POST /admin/api/backup/dump-storage
  Future<dynamic> backupDumpStorage(Map<String, String>? query) async {
    return _http.get('/admin/api/backup/dump-storage', query);
  }

  /// Restore R2 storage (wipe or upload) — POST /admin/api/backup/restore-storage
  Future<dynamic> backupRestoreStorage(Map<String, String>? query) async {
    return _http.get('/admin/api/backup/restore-storage', query);
  }

  /// Resync _users_public from _users in AUTH_DB D1 — POST /admin/api/backup/resync-users-public
  Future<dynamic> backupResyncUsersPublic() async {
    return _http.post('/admin/api/backup/resync-users-public', {});
  }

  /// Export a single table as JSON — GET /admin/api/backup/export/{name}
  Future<dynamic> backupExportTable(String name, Map<String, String>? query) async {
    return _http.get('/admin/api/backup/export/${Uri.encodeComponent(name)}', query);
  }
}
