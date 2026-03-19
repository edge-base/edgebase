// Auto-generated admin API Core — DO NOT EDIT.
// Regenerate: npx tsx tools/sdk-codegen/generate.ts
// Source: openapi.json (0.1.0)

using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace EdgeBase.Generated
{

/// <summary>
/// Auto-generated API methods.
/// </summary>
public class GeneratedAdminApi
{
    private readonly JbHttpClient _http;

    public GeneratedAdminApi(JbHttpClient http)
    {
        _http = http;
    }

    private static string EncodePathParam(string value)
        => Uri.EscapeDataString(value);

    /// <summary>Get user by ID — GET /api/auth/admin/users/{id}</summary>
    public Task<Dictionary<string, object?>> AdminAuthGetUserAsync(string id, CancellationToken ct = default)
        => _http.GetAsync($"/api/auth/admin/users/{EncodePathParam(id)}", ct);

    /// <summary>Update user by ID — PATCH /api/auth/admin/users/{id}</summary>
    public Task<Dictionary<string, object?>> AdminAuthUpdateUserAsync(string id, object? body = null, CancellationToken ct = default)
        => _http.PatchAsync($"/api/auth/admin/users/{EncodePathParam(id)}", body, ct);

    /// <summary>Delete user by ID — DELETE /api/auth/admin/users/{id}</summary>
    public Task<Dictionary<string, object?>> AdminAuthDeleteUserAsync(string id, CancellationToken ct = default)
        => _http.DeleteAsync($"/api/auth/admin/users/{EncodePathParam(id)}", ct);

    /// <summary>List users — GET /api/auth/admin/users</summary>
    public Task<Dictionary<string, object?>> AdminAuthListUsersAsync(Dictionary<string, string>? query = null, CancellationToken ct = default)
        => _http.GetWithQueryAsync("/api/auth/admin/users", query, ct);

    /// <summary>Create a new user — POST /api/auth/admin/users</summary>
    public Task<Dictionary<string, object?>> AdminAuthCreateUserAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/auth/admin/users", body, ct);

    /// <summary>Delete user MFA — DELETE /api/auth/admin/users/{id}/mfa</summary>
    public Task<Dictionary<string, object?>> AdminAuthDeleteUserMfaAsync(string id, CancellationToken ct = default)
        => _http.DeleteAsync($"/api/auth/admin/users/{EncodePathParam(id)}/mfa", ct);

    /// <summary>Set custom claims for user — PUT /api/auth/admin/users/{id}/claims</summary>
    public Task<Dictionary<string, object?>> AdminAuthSetClaimsAsync(string id, object? body = null, CancellationToken ct = default)
        => _http.PutAsync($"/api/auth/admin/users/{EncodePathParam(id)}/claims", body, ct);

    /// <summary>Revoke all sessions for user — POST /api/auth/admin/users/{id}/revoke</summary>
    public Task<Dictionary<string, object?>> AdminAuthRevokeUserSessionsAsync(string id, CancellationToken ct = default)
        => _http.PostAsync($"/api/auth/admin/users/{EncodePathParam(id)}/revoke", null, ct);

    /// <summary>Batch import users — POST /api/auth/admin/users/import</summary>
    public Task<Dictionary<string, object?>> AdminAuthImportUsersAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/auth/admin/users/import", body, ct);

    /// <summary>Broadcast to database live channel — POST /api/db/broadcast</summary>
    public Task<Dictionary<string, object?>> DatabaseLiveBroadcastAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/db/broadcast", body, ct);

    /// <summary>Execute SQL via DatabaseDO — POST /api/sql</summary>
    public Task<Dictionary<string, object?>> ExecuteSqlAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/sql", body, ct);

    /// <summary>Execute KV operation — POST /api/kv/{namespace}</summary>
    public Task<Dictionary<string, object?>> KvOperationAsync(string @namespace, object? body = null, CancellationToken ct = default)
        => _http.PostAsync($"/api/kv/{EncodePathParam(@namespace)}", body, ct);

    /// <summary>Execute raw SQL on D1 database — POST /api/d1/{database}</summary>
    public Task<Dictionary<string, object?>> ExecuteD1QueryAsync(string database, object? body = null, CancellationToken ct = default)
        => _http.PostAsync($"/api/d1/{EncodePathParam(database)}", body, ct);

    /// <summary>Execute Vectorize operation — POST /api/vectorize/{index}</summary>
    public Task<Dictionary<string, object?>> VectorizeOperationAsync(string index, object? body = null, CancellationToken ct = default)
        => _http.PostAsync($"/api/vectorize/{EncodePathParam(index)}", body, ct);

    /// <summary>Send push notification to user — POST /api/push/send</summary>
    public Task<Dictionary<string, object?>> PushSendAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/push/send", body, ct);

    /// <summary>Send push to multiple users — POST /api/push/send-many</summary>
    public Task<Dictionary<string, object?>> PushSendManyAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/push/send-many", body, ct);

    /// <summary>Send push to specific token — POST /api/push/send-to-token</summary>
    public Task<Dictionary<string, object?>> PushSendToTokenAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/push/send-to-token", body, ct);

    /// <summary>Send push to topic — POST /api/push/send-to-topic</summary>
    public Task<Dictionary<string, object?>> PushSendToTopicAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/push/send-to-topic", body, ct);

    /// <summary>Broadcast push to all devices — POST /api/push/broadcast</summary>
    public Task<Dictionary<string, object?>> PushBroadcastAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/push/broadcast", body, ct);

    /// <summary>Get push notification logs — GET /api/push/logs</summary>
    public Task<Dictionary<string, object?>> GetPushLogsAsync(Dictionary<string, string>? query = null, CancellationToken ct = default)
        => _http.GetWithQueryAsync("/api/push/logs", query, ct);

    /// <summary>Get registered push tokens — GET /api/push/tokens</summary>
    public Task<Dictionary<string, object?>> GetPushTokensAsync(Dictionary<string, string>? query = null, CancellationToken ct = default)
        => _http.GetWithQueryAsync("/api/push/tokens", query, ct);

    /// <summary>Upsert a device token — PUT /api/push/tokens</summary>
    public Task<Dictionary<string, object?>> PutPushTokensAsync(object? body = null, CancellationToken ct = default)
        => _http.PutAsync("/api/push/tokens", body, ct);

    /// <summary>Update device metadata — PATCH /api/push/tokens</summary>
    public Task<Dictionary<string, object?>> PatchPushTokensAsync(object? body = null, CancellationToken ct = default)
        => _http.PatchAsync("/api/push/tokens", body, ct);

    /// <summary>Query request log metrics — GET /api/analytics/query</summary>
    public Task<Dictionary<string, object?>> QueryAnalyticsAsync(Dictionary<string, string>? query = null, CancellationToken ct = default)
        => _http.GetWithQueryAsync("/api/analytics/query", query, ct);

    /// <summary>Query custom events — GET /api/analytics/events</summary>
    public Task<Dictionary<string, object?>> QueryCustomEventsAsync(Dictionary<string, string>? query = null, CancellationToken ct = default)
        => _http.GetWithQueryAsync("/api/analytics/events", query, ct);

    /// <summary>Check if admin setup is needed — GET /admin/api/setup/status</summary>
    public Task<Dictionary<string, object?>> AdminSetupStatusAsync(CancellationToken ct = default)
        => _http.GetAsync("/admin/api/setup/status", ct);

    /// <summary>Create the first admin account — POST /admin/api/setup</summary>
    public Task<Dictionary<string, object?>> AdminSetupAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/admin/api/setup", body, ct);

    /// <summary>Admin login — POST /admin/api/auth/login</summary>
    public Task<Dictionary<string, object?>> AdminLoginAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/admin/api/auth/login", body, ct);

    /// <summary>Rotate admin token — POST /admin/api/auth/refresh</summary>
    public Task<Dictionary<string, object?>> AdminRefreshAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/admin/api/auth/refresh", body, ct);

    /// <summary>Reset admin password (Service Key required) — POST /admin/api/internal/reset-password</summary>
    public Task<Dictionary<string, object?>> AdminResetPasswordAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/admin/api/internal/reset-password", body, ct);

    /// <summary>List all tables from config — GET /admin/api/data/tables</summary>
    public Task<Dictionary<string, object?>> AdminListTablesAsync(CancellationToken ct = default)
        => _http.GetAsync("/admin/api/data/tables", ct);

    /// <summary>List table records with pagination — GET /admin/api/data/tables/{name}/records</summary>
    public Task<Dictionary<string, object?>> AdminGetTableRecordsAsync(string name, CancellationToken ct = default)
        => _http.GetAsync($"/admin/api/data/tables/{EncodePathParam(name)}/records", ct);

    /// <summary>Create a table record — POST /admin/api/data/tables/{name}/records</summary>
    public Task<Dictionary<string, object?>> AdminCreateTableRecordAsync(string name, object? body = null, CancellationToken ct = default)
        => _http.PostAsync($"/admin/api/data/tables/{EncodePathParam(name)}/records", body, ct);

    /// <summary>Update a table record — PUT /admin/api/data/tables/{name}/records/{id}</summary>
    public Task<Dictionary<string, object?>> AdminUpdateTableRecordAsync(string name, string id, object? body = null, CancellationToken ct = default)
        => _http.PutAsync($"/admin/api/data/tables/{EncodePathParam(name)}/records/{EncodePathParam(id)}", body, ct);

    /// <summary>Delete a table record — DELETE /admin/api/data/tables/{name}/records/{id}</summary>
    public Task<Dictionary<string, object?>> AdminDeleteTableRecordAsync(string name, string id, CancellationToken ct = default)
        => _http.DeleteAsync($"/admin/api/data/tables/{EncodePathParam(name)}/records/{EncodePathParam(id)}", ct);

    /// <summary>List users via D1 index — GET /admin/api/data/users</summary>
    public Task<Dictionary<string, object?>> AdminListUsersAsync(CancellationToken ct = default)
        => _http.GetAsync("/admin/api/data/users", ct);

    /// <summary>Create a new user — POST /admin/api/data/users</summary>
    public Task<Dictionary<string, object?>> AdminCreateUserAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/admin/api/data/users", body, ct);

    /// <summary>Fetch a single user by ID — GET /admin/api/data/users/{id}</summary>
    public Task<Dictionary<string, object?>> AdminGetUserAsync(string id, CancellationToken ct = default)
        => _http.GetAsync($"/admin/api/data/users/{EncodePathParam(id)}", ct);

    /// <summary>Update user status or role — PUT /admin/api/data/users/{id}</summary>
    public Task<Dictionary<string, object?>> AdminUpdateUserAsync(string id, object? body = null, CancellationToken ct = default)
        => _http.PutAsync($"/admin/api/data/users/{EncodePathParam(id)}", body, ct);

    /// <summary>Delete a user completely — DELETE /admin/api/data/users/{id}</summary>
    public Task<Dictionary<string, object?>> AdminDeleteUserAsync(string id, CancellationToken ct = default)
        => _http.DeleteAsync($"/admin/api/data/users/{EncodePathParam(id)}", ct);

    /// <summary>Fetch user profile with cache — GET /admin/api/data/users/{id}/profile</summary>
    public Task<Dictionary<string, object?>> AdminGetUserProfileAsync(string id, CancellationToken ct = default)
        => _http.GetAsync($"/admin/api/data/users/{EncodePathParam(id)}/profile", ct);

    /// <summary>Revoke all user sessions — DELETE /admin/api/data/users/{id}/sessions</summary>
    public Task<Dictionary<string, object?>> AdminDeleteUserSessionsAsync(string id, CancellationToken ct = default)
        => _http.DeleteAsync($"/admin/api/data/users/{EncodePathParam(id)}/sessions", ct);

    /// <summary>Cleanup anonymous user index — POST /admin/api/data/cleanup-anon</summary>
    public Task<Dictionary<string, object?>> AdminCleanupAnonAsync(CancellationToken ct = default)
        => _http.PostAsync("/admin/api/data/cleanup-anon", null, ct);

    /// <summary>List configured storage buckets — GET /admin/api/data/storage/buckets</summary>
    public Task<Dictionary<string, object?>> AdminListBucketsAsync(CancellationToken ct = default)
        => _http.GetAsync("/admin/api/data/storage/buckets", ct);

    /// <summary>List objects in a storage bucket — GET /admin/api/data/storage/buckets/{name}/objects</summary>
    public Task<Dictionary<string, object?>> AdminListBucketObjectsAsync(string name, CancellationToken ct = default)
        => _http.GetAsync($"/admin/api/data/storage/buckets/{EncodePathParam(name)}/objects", ct);

    /// <summary>Get a storage object content — GET /admin/api/data/storage/buckets/{name}/objects/{key}</summary>
    public Task<Dictionary<string, object?>> AdminGetBucketObjectAsync(string name, string key, CancellationToken ct = default)
        => _http.GetAsync($"/admin/api/data/storage/buckets/{EncodePathParam(name)}/objects/{EncodePathParam(key)}", ct);

    /// <summary>Delete a storage object — DELETE /admin/api/data/storage/buckets/{name}/objects/{key}</summary>
    public Task<Dictionary<string, object?>> AdminDeleteBucketObjectAsync(string name, string key, CancellationToken ct = default)
        => _http.DeleteAsync($"/admin/api/data/storage/buckets/{EncodePathParam(name)}/objects/{EncodePathParam(key)}", ct);

    /// <summary>Get bucket statistics (total objects and size) — GET /admin/api/data/storage/buckets/{name}/stats</summary>
    public Task<Dictionary<string, object?>> AdminGetBucketStatsAsync(string name, CancellationToken ct = default)
        => _http.GetAsync($"/admin/api/data/storage/buckets/{EncodePathParam(name)}/stats", ct);

    /// <summary>Create a signed download URL for a storage object — POST /admin/api/data/storage/buckets/{name}/signed-url</summary>
    public Task<Dictionary<string, object?>> AdminCreateSignedUrlAsync(string name, object? body = null, CancellationToken ct = default)
        => _http.PostAsync($"/admin/api/data/storage/buckets/{EncodePathParam(name)}/signed-url", body, ct);

    /// <summary>Get full schema structure from config — GET /admin/api/data/schema</summary>
    public Task<Dictionary<string, object?>> AdminGetSchemaAsync(CancellationToken ct = default)
        => _http.GetAsync("/admin/api/data/schema", ct);

    /// <summary>Export table data as JSON — GET /admin/api/data/tables/{name}/export</summary>
    public Task<Dictionary<string, object?>> AdminExportTableAsync(string name, CancellationToken ct = default)
        => _http.GetAsync($"/admin/api/data/tables/{EncodePathParam(name)}/export", ct);

    /// <summary>Get request logs — GET /admin/api/data/logs</summary>
    public Task<Dictionary<string, object?>> AdminGetLogsAsync(CancellationToken ct = default)
        => _http.GetAsync("/admin/api/data/logs", ct);

    /// <summary>Get realtime monitoring stats — GET /admin/api/data/monitoring</summary>
    public Task<Dictionary<string, object?>> AdminGetMonitoringAsync(CancellationToken ct = default)
        => _http.GetAsync("/admin/api/data/monitoring", ct);

    /// <summary>Get analytics dashboard data — GET /admin/api/data/analytics</summary>
    public Task<Dictionary<string, object?>> AdminGetAnalyticsAsync(CancellationToken ct = default)
        => _http.GetAsync("/admin/api/data/analytics", ct);

    /// <summary>Query analytics events for admin dashboard — GET /admin/api/data/analytics/events</summary>
    public Task<Dictionary<string, object?>> AdminGetAnalyticsEventsAsync(CancellationToken ct = default)
        => _http.GetAsync("/admin/api/data/analytics/events", ct);

    /// <summary>Get project overview for dashboard home — GET /admin/api/data/overview</summary>
    public Task<Dictionary<string, object?>> AdminGetOverviewAsync(CancellationToken ct = default)
        => _http.GetAsync("/admin/api/data/overview", ct);

    /// <summary>Get dev mode status and sidecar port — GET /admin/api/data/dev-info</summary>
    public Task<Dictionary<string, object?>> AdminGetDevInfoAsync(CancellationToken ct = default)
        => _http.GetAsync("/admin/api/data/dev-info", ct);

    /// <summary>Execute raw SQL query — POST /admin/api/data/sql</summary>
    public Task<Dictionary<string, object?>> AdminExecuteSqlAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/admin/api/data/sql", body, ct);

    /// <summary>Batch import records into a table — POST /admin/api/data/tables/{name}/import</summary>
    public Task<Dictionary<string, object?>> AdminImportTableAsync(string name, object? body = null, CancellationToken ct = default)
        => _http.PostAsync($"/admin/api/data/tables/{EncodePathParam(name)}/import", body, ct);

    /// <summary>Evaluate access rules with simulated auth context — POST /admin/api/data/rules-test</summary>
    public Task<Dictionary<string, object?>> AdminRulesTestAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/admin/api/data/rules-test", body, ct);

    /// <summary>List registered functions from config — GET /admin/api/data/functions</summary>
    public Task<Dictionary<string, object?>> AdminListFunctionsAsync(CancellationToken ct = default)
        => _http.GetAsync("/admin/api/data/functions", ct);

    /// <summary>Get environment and config overview — GET /admin/api/data/config-info</summary>
    public Task<Dictionary<string, object?>> AdminGetConfigInfoAsync(CancellationToken ct = default)
        => _http.GetAsync("/admin/api/data/config-info", ct);

    /// <summary>Get recent request logs with filtering — GET /admin/api/data/logs/recent</summary>
    public Task<Dictionary<string, object?>> AdminGetRecentLogsAsync(CancellationToken ct = default)
        => _http.GetAsync("/admin/api/data/logs/recent", ct);

    /// <summary>Get OAuth provider config — GET /admin/api/data/auth/settings</summary>
    public Task<Dictionary<string, object?>> AdminGetAuthSettingsAsync(CancellationToken ct = default)
        => _http.GetAsync("/admin/api/data/auth/settings", ct);

    /// <summary>Get email template and subject config — GET /admin/api/data/email/templates</summary>
    public Task<Dictionary<string, object?>> AdminGetEmailTemplatesAsync(CancellationToken ct = default)
        => _http.GetAsync("/admin/api/data/email/templates", ct);

    /// <summary>Disable MFA for a user — DELETE /admin/api/data/users/{id}/mfa</summary>
    public Task<Dictionary<string, object?>> AdminDeleteUserMfaAsync(string id, CancellationToken ct = default)
        => _http.DeleteAsync($"/admin/api/data/users/{EncodePathParam(id)}/mfa", ct);

    /// <summary>Send password reset email for a user — POST /admin/api/data/users/{id}/send-password-reset</summary>
    public Task<Dictionary<string, object?>> AdminSendPasswordResetAsync(string id, CancellationToken ct = default)
        => _http.PostAsync($"/admin/api/data/users/{EncodePathParam(id)}/send-password-reset", null, ct);

    /// <summary>Upload file to R2 storage — POST /admin/api/data/storage/buckets/{name}/upload</summary>
    public Task<Dictionary<string, object?>> AdminUploadFileAsync(string name, object? body = null, CancellationToken ct = default)
        => _http.PostAsync($"/admin/api/data/storage/buckets/{EncodePathParam(name)}/upload", body, ct);

    /// <summary>List push tokens for a user — GET /admin/api/data/push/tokens</summary>
    public Task<Dictionary<string, object?>> AdminGetPushTokensAsync(CancellationToken ct = default)
        => _http.GetAsync("/admin/api/data/push/tokens", ct);

    /// <summary>Get push notification logs — GET /admin/api/data/push/logs</summary>
    public Task<Dictionary<string, object?>> AdminGetPushLogsAsync(CancellationToken ct = default)
        => _http.GetAsync("/admin/api/data/push/logs", ct);

    /// <summary>Test send push notification — POST /admin/api/data/push/test-send</summary>
    public Task<Dictionary<string, object?>> AdminTestPushSendAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/admin/api/data/push/test-send", body, ct);

    /// <summary>List Durable Objects for backup — POST /admin/api/data/backup/list-dos</summary>
    public Task<Dictionary<string, object?>> AdminBackupListDOsAsync(CancellationToken ct = default)
        => _http.PostAsync("/admin/api/data/backup/list-dos", null, ct);

    /// <summary>Dump a Durable Object for backup — POST /admin/api/data/backup/dump-do</summary>
    public Task<Dictionary<string, object?>> AdminBackupDumpDOAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/admin/api/data/backup/dump-do", body, ct);

    /// <summary>Restore a Durable Object from backup — POST /admin/api/data/backup/restore-do</summary>
    public Task<Dictionary<string, object?>> AdminBackupRestoreDOAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/admin/api/data/backup/restore-do", body, ct);

    /// <summary>Dump D1 database for backup — POST /admin/api/data/backup/dump-d1</summary>
    public Task<Dictionary<string, object?>> AdminBackupDumpD1Async(CancellationToken ct = default)
        => _http.PostAsync("/admin/api/data/backup/dump-d1", null, ct);

    /// <summary>Restore D1 database from backup — POST /admin/api/data/backup/restore-d1</summary>
    public Task<Dictionary<string, object?>> AdminBackupRestoreD1Async(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/admin/api/data/backup/restore-d1", body, ct);

    /// <summary>Get backup config — GET /admin/api/data/backup/config</summary>
    public Task<Dictionary<string, object?>> AdminBackupGetConfigAsync(CancellationToken ct = default)
        => _http.GetAsync("/admin/api/data/backup/config", ct);

    /// <summary>List admin accounts — GET /admin/api/data/admins</summary>
    public Task<Dictionary<string, object?>> AdminListAdminsAsync(CancellationToken ct = default)
        => _http.GetAsync("/admin/api/data/admins", ct);

    /// <summary>Create an admin account — POST /admin/api/data/admins</summary>
    public Task<Dictionary<string, object?>> AdminCreateAdminAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/admin/api/data/admins", body, ct);

    /// <summary>Delete an admin account — DELETE /admin/api/data/admins/{id}</summary>
    public Task<Dictionary<string, object?>> AdminDeleteAdminAsync(string id, CancellationToken ct = default)
        => _http.DeleteAsync($"/admin/api/data/admins/{EncodePathParam(id)}", ct);

    /// <summary>Change admin password — PUT /admin/api/data/admins/{id}/password</summary>
    public Task<Dictionary<string, object?>> AdminChangePasswordAsync(string id, object? body = null, CancellationToken ct = default)
        => _http.PutAsync($"/admin/api/data/admins/{EncodePathParam(id)}/password", body, ct);

    /// <summary>List all DO instances — POST /admin/api/backup/list-dos</summary>
    public Task<Dictionary<string, object?>> BackupListDOsAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/admin/api/backup/list-dos", body, ct);

    /// <summary>Return parsed config snapshot — GET /admin/api/backup/config</summary>
    public Task<Dictionary<string, object?>> BackupGetConfigAsync(CancellationToken ct = default)
        => _http.GetAsync("/admin/api/backup/config", ct);

    /// <summary>Remove plugin-prefixed tables and migration metadata — POST /admin/api/backup/cleanup-plugin</summary>
    public Task<Dictionary<string, object?>> BackupCleanupPluginAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/admin/api/backup/cleanup-plugin", body, ct);

    /// <summary>Wipe a specific DO's data — POST /admin/api/backup/wipe-do</summary>
    public Task<Dictionary<string, object?>> BackupWipeDOAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/admin/api/backup/wipe-do", body, ct);

    /// <summary>Dump a specific DO's data — POST /admin/api/backup/dump-do</summary>
    public Task<Dictionary<string, object?>> BackupDumpDOAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/admin/api/backup/dump-do", body, ct);

    /// <summary>Restore a specific DO's data — POST /admin/api/backup/restore-do</summary>
    public Task<Dictionary<string, object?>> BackupRestoreDOAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/admin/api/backup/restore-do", body, ct);

    /// <summary>Dump auth database tables — POST /admin/api/backup/dump-d1</summary>
    public Task<Dictionary<string, object?>> BackupDumpD1Async(CancellationToken ct = default)
        => _http.PostAsync("/admin/api/backup/dump-d1", null, ct);

    /// <summary>Restore auth database tables — POST /admin/api/backup/restore-d1</summary>
    public Task<Dictionary<string, object?>> BackupRestoreD1Async(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/admin/api/backup/restore-d1", body, ct);

    /// <summary>Dump control-plane D1 tables — POST /admin/api/backup/dump-control-d1</summary>
    public Task<Dictionary<string, object?>> BackupDumpControlD1Async(CancellationToken ct = default)
        => _http.PostAsync("/admin/api/backup/dump-control-d1", null, ct);

    /// <summary>Restore control-plane D1 tables — POST /admin/api/backup/restore-control-d1</summary>
    public Task<Dictionary<string, object?>> BackupRestoreControlD1Async(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/admin/api/backup/restore-control-d1", body, ct);

    /// <summary>Dump all tables from a data namespace — POST /admin/api/backup/dump-data</summary>
    public Task<Dictionary<string, object?>> BackupDumpDataAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/admin/api/backup/dump-data", body, ct);

    /// <summary>Restore all tables into a data namespace — POST /admin/api/backup/restore-data</summary>
    public Task<Dictionary<string, object?>> BackupRestoreDataAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/admin/api/backup/restore-data", body, ct);

    /// <summary>Dump R2 storage (list or download) — POST /admin/api/backup/dump-storage</summary>
    public Task<Dictionary<string, object?>> BackupDumpStorageAsync(Dictionary<string, string>? query = null, CancellationToken ct = default)
        => _http.GetWithQueryAsync("/admin/api/backup/dump-storage", query, ct);

    /// <summary>Restore R2 storage (wipe or upload) — POST /admin/api/backup/restore-storage</summary>
    public Task<Dictionary<string, object?>> BackupRestoreStorageAsync(Dictionary<string, string>? query = null, CancellationToken ct = default)
        => _http.GetWithQueryAsync("/admin/api/backup/restore-storage", query, ct);

    /// <summary>Resync _users_public from _users in AUTH_DB D1 — POST /admin/api/backup/resync-users-public</summary>
    public Task<Dictionary<string, object?>> BackupResyncUsersPublicAsync(CancellationToken ct = default)
        => _http.PostAsync("/admin/api/backup/resync-users-public", null, ct);

    /// <summary>Export a single table as JSON — GET /admin/api/backup/export/{name}</summary>
    public Task<Dictionary<string, object?>> BackupExportTableAsync(string name, Dictionary<string, string>? query = null, CancellationToken ct = default)
        => _http.GetWithQueryAsync($"/admin/api/backup/export/{EncodePathParam(name)}", query, ct);
}

}
