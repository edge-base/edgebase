// Auto-generated admin API Core — DO NOT EDIT.
// Regenerate: npx tsx tools/sdk-codegen/generate.ts
// Source: openapi.json (0.1.0)

package dev.edgebase.sdk.admin.generated;

import dev.edgebase.sdk.core.HttpClient;
import dev.edgebase.sdk.core.EdgeBaseError;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * Auto-generated API methods.
 */
public class GeneratedAdminApi {
    private final HttpClient http;

    public GeneratedAdminApi(HttpClient http) {
        this.http = http;
    }

    private static String encodePathParam(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
    }

    /** Get user by ID — GET /api/auth/admin/users/{id} */
    public Object adminAuthGetUser(String id) throws EdgeBaseError {
        return http.get("/auth/admin/users/" + encodePathParam(id));
    }

    /** Update user by ID — PATCH /api/auth/admin/users/{id} */
    public Object adminAuthUpdateUser(String id, Map<String, ?> body) throws EdgeBaseError {
        return http.patch("/auth/admin/users/" + encodePathParam(id), body);
    }

    /** Delete user by ID — DELETE /api/auth/admin/users/{id} */
    public Object adminAuthDeleteUser(String id) throws EdgeBaseError {
        return http.delete("/auth/admin/users/" + encodePathParam(id));
    }

    /** List users — GET /api/auth/admin/users */
    public Object adminAuthListUsers(Map<String, String> query) throws EdgeBaseError {
        return http.getWithQuery("/auth/admin/users", query);
    }

    /** Create a new user — POST /api/auth/admin/users */
    public Object adminAuthCreateUser(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/auth/admin/users", body);
    }

    /** Delete user MFA — DELETE /api/auth/admin/users/{id}/mfa */
    public Object adminAuthDeleteUserMfa(String id) throws EdgeBaseError {
        return http.delete("/auth/admin/users/" + encodePathParam(id) + "/mfa");
    }

    /** Set custom claims for user — PUT /api/auth/admin/users/{id}/claims */
    public Object adminAuthSetClaims(String id, Map<String, ?> body) throws EdgeBaseError {
        return http.put("/auth/admin/users/" + encodePathParam(id) + "/claims", body);
    }

    /** Revoke all sessions for user — POST /api/auth/admin/users/{id}/revoke */
    public Object adminAuthRevokeUserSessions(String id) throws EdgeBaseError {
        return http.post("/auth/admin/users/" + encodePathParam(id) + "/revoke", null);
    }

    /** Batch import users — POST /api/auth/admin/users/import */
    public Object adminAuthImportUsers(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/auth/admin/users/import", body);
    }

    /** Broadcast to database live channel — POST /api/db/broadcast */
    public Object databaseLiveBroadcast(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/db/broadcast", body);
    }

    /** Execute SQL via DatabaseDO — POST /api/sql */
    public Object executeSql(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/sql", body);
    }

    /** Execute KV operation — POST /api/kv/{namespace} */
    public Object kvOperation(String namespace, Map<String, ?> body) throws EdgeBaseError {
        return http.post("/kv/" + encodePathParam(namespace), body);
    }

    /** Execute raw SQL on D1 database — POST /api/d1/{database} */
    public Object executeD1Query(String database, Map<String, ?> body) throws EdgeBaseError {
        return http.post("/d1/" + encodePathParam(database), body);
    }

    /** Execute Vectorize operation — POST /api/vectorize/{index} */
    public Object vectorizeOperation(String index, Map<String, ?> body) throws EdgeBaseError {
        return http.post("/vectorize/" + encodePathParam(index), body);
    }

    /** Send push notification to user — POST /api/push/send */
    public Object pushSend(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/push/send", body);
    }

    /** Send push to multiple users — POST /api/push/send-many */
    public Object pushSendMany(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/push/send-many", body);
    }

    /** Send push to specific token — POST /api/push/send-to-token */
    public Object pushSendToToken(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/push/send-to-token", body);
    }

    /** Send push to topic — POST /api/push/send-to-topic */
    public Object pushSendToTopic(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/push/send-to-topic", body);
    }

    /** Broadcast push to all devices — POST /api/push/broadcast */
    public Object pushBroadcast(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/push/broadcast", body);
    }

    /** Get push notification logs — GET /api/push/logs */
    public Object getPushLogs(Map<String, String> query) throws EdgeBaseError {
        return http.getWithQuery("/push/logs", query);
    }

    /** Get registered push tokens — GET /api/push/tokens */
    public Object getPushTokens(Map<String, String> query) throws EdgeBaseError {
        return http.getWithQuery("/push/tokens", query);
    }

    /** Upsert a device token — PUT /api/push/tokens */
    public Object putPushTokens(Map<String, ?> body) throws EdgeBaseError {
        return http.put("/push/tokens", body);
    }

    /** Update device metadata — PATCH /api/push/tokens */
    public Object patchPushTokens(Map<String, ?> body) throws EdgeBaseError {
        return http.patch("/push/tokens", body);
    }

    /** Query request log metrics — GET /api/analytics/query */
    public Object queryAnalytics(Map<String, String> query) throws EdgeBaseError {
        return http.getWithQuery("/analytics/query", query);
    }

    /** Query custom events — GET /api/analytics/events */
    public Object queryCustomEvents(Map<String, String> query) throws EdgeBaseError {
        return http.getWithQuery("/analytics/events", query);
    }

    /** Check if admin setup is needed — GET /admin/api/setup/status */
    public Object adminSetupStatus() throws EdgeBaseError {
        return http.get("/admin/api/setup/status");
    }

    /** Create the first admin account — POST /admin/api/setup */
    public Object adminSetup(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/admin/api/setup", body);
    }

    /** Admin login — POST /admin/api/auth/login */
    public Object adminLogin(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/admin/api/auth/login", body);
    }

    /** Rotate admin token — POST /admin/api/auth/refresh */
    public Object adminRefresh(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/admin/api/auth/refresh", body);
    }

    /** Reset admin password (Service Key required) — POST /admin/api/internal/reset-password */
    public Object adminResetPassword(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/admin/api/internal/reset-password", body);
    }

    /** List all tables from config — GET /admin/api/data/tables */
    public Object adminListTables() throws EdgeBaseError {
        return http.get("/admin/api/data/tables");
    }

    /** List table records with pagination — GET /admin/api/data/tables/{name}/records */
    public Object adminGetTableRecords(String name) throws EdgeBaseError {
        return http.get("/admin/api/data/tables/" + encodePathParam(name) + "/records");
    }

    /** Create a table record — POST /admin/api/data/tables/{name}/records */
    public Object adminCreateTableRecord(String name, Map<String, ?> body) throws EdgeBaseError {
        return http.post("/admin/api/data/tables/" + encodePathParam(name) + "/records", body);
    }

    /** Update a table record — PUT /admin/api/data/tables/{name}/records/{id} */
    public Object adminUpdateTableRecord(String name, String id, Map<String, ?> body) throws EdgeBaseError {
        return http.put("/admin/api/data/tables/" + encodePathParam(name) + "/records/" + encodePathParam(id), body);
    }

    /** Delete a table record — DELETE /admin/api/data/tables/{name}/records/{id} */
    public Object adminDeleteTableRecord(String name, String id) throws EdgeBaseError {
        return http.delete("/admin/api/data/tables/" + encodePathParam(name) + "/records/" + encodePathParam(id));
    }

    /** List users via D1 index — GET /admin/api/data/users */
    public Object adminListUsers() throws EdgeBaseError {
        return http.get("/admin/api/data/users");
    }

    /** Create a new user — POST /admin/api/data/users */
    public Object adminCreateUser(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/admin/api/data/users", body);
    }

    /** Fetch a single user by ID — GET /admin/api/data/users/{id} */
    public Object adminGetUser(String id) throws EdgeBaseError {
        return http.get("/admin/api/data/users/" + encodePathParam(id));
    }

    /** Update user status or role — PUT /admin/api/data/users/{id} */
    public Object adminUpdateUser(String id, Map<String, ?> body) throws EdgeBaseError {
        return http.put("/admin/api/data/users/" + encodePathParam(id), body);
    }

    /** Delete a user completely — DELETE /admin/api/data/users/{id} */
    public Object adminDeleteUser(String id) throws EdgeBaseError {
        return http.delete("/admin/api/data/users/" + encodePathParam(id));
    }

    /** Fetch user profile with cache — GET /admin/api/data/users/{id}/profile */
    public Object adminGetUserProfile(String id) throws EdgeBaseError {
        return http.get("/admin/api/data/users/" + encodePathParam(id) + "/profile");
    }

    /** Revoke all user sessions — DELETE /admin/api/data/users/{id}/sessions */
    public Object adminDeleteUserSessions(String id) throws EdgeBaseError {
        return http.delete("/admin/api/data/users/" + encodePathParam(id) + "/sessions");
    }

    /** Cleanup anonymous user index — POST /admin/api/data/cleanup-anon */
    public Object adminCleanupAnon() throws EdgeBaseError {
        return http.post("/admin/api/data/cleanup-anon", null);
    }

    /** List configured storage buckets — GET /admin/api/data/storage/buckets */
    public Object adminListBuckets() throws EdgeBaseError {
        return http.get("/admin/api/data/storage/buckets");
    }

    /** List objects in a storage bucket — GET /admin/api/data/storage/buckets/{name}/objects */
    public Object adminListBucketObjects(String name) throws EdgeBaseError {
        return http.get("/admin/api/data/storage/buckets/" + encodePathParam(name) + "/objects");
    }

    /** Get a storage object content — GET /admin/api/data/storage/buckets/{name}/objects/{key} */
    public Object adminGetBucketObject(String name, String key) throws EdgeBaseError {
        return http.get("/admin/api/data/storage/buckets/" + encodePathParam(name) + "/objects/" + encodePathParam(key));
    }

    /** Delete a storage object — DELETE /admin/api/data/storage/buckets/{name}/objects/{key} */
    public Object adminDeleteBucketObject(String name, String key) throws EdgeBaseError {
        return http.delete("/admin/api/data/storage/buckets/" + encodePathParam(name) + "/objects/" + encodePathParam(key));
    }

    /** Get bucket statistics (total objects and size) — GET /admin/api/data/storage/buckets/{name}/stats */
    public Object adminGetBucketStats(String name) throws EdgeBaseError {
        return http.get("/admin/api/data/storage/buckets/" + encodePathParam(name) + "/stats");
    }

    /** Create a signed download URL for a storage object — POST /admin/api/data/storage/buckets/{name}/signed-url */
    public Object adminCreateSignedUrl(String name, Map<String, ?> body) throws EdgeBaseError {
        return http.post("/admin/api/data/storage/buckets/" + encodePathParam(name) + "/signed-url", body);
    }

    /** Get full schema structure from config — GET /admin/api/data/schema */
    public Object adminGetSchema() throws EdgeBaseError {
        return http.get("/admin/api/data/schema");
    }

    /** Export table data as JSON — GET /admin/api/data/tables/{name}/export */
    public Object adminExportTable(String name) throws EdgeBaseError {
        return http.get("/admin/api/data/tables/" + encodePathParam(name) + "/export");
    }

    /** Get request logs — GET /admin/api/data/logs */
    public Object adminGetLogs() throws EdgeBaseError {
        return http.get("/admin/api/data/logs");
    }

    /** Get realtime monitoring stats — GET /admin/api/data/monitoring */
    public Object adminGetMonitoring() throws EdgeBaseError {
        return http.get("/admin/api/data/monitoring");
    }

    /** Get analytics dashboard data — GET /admin/api/data/analytics */
    public Object adminGetAnalytics() throws EdgeBaseError {
        return http.get("/admin/api/data/analytics");
    }

    /** Query analytics events for admin dashboard — GET /admin/api/data/analytics/events */
    public Object adminGetAnalyticsEvents() throws EdgeBaseError {
        return http.get("/admin/api/data/analytics/events");
    }

    /** Get project overview for dashboard home — GET /admin/api/data/overview */
    public Object adminGetOverview() throws EdgeBaseError {
        return http.get("/admin/api/data/overview");
    }

    /** Get dev mode status and sidecar port — GET /admin/api/data/dev-info */
    public Object adminGetDevInfo() throws EdgeBaseError {
        return http.get("/admin/api/data/dev-info");
    }

    /** Execute raw SQL query — POST /admin/api/data/sql */
    public Object adminExecuteSql(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/admin/api/data/sql", body);
    }

    /** Batch import records into a table — POST /admin/api/data/tables/{name}/import */
    public Object adminImportTable(String name, Map<String, ?> body) throws EdgeBaseError {
        return http.post("/admin/api/data/tables/" + encodePathParam(name) + "/import", body);
    }

    /** Evaluate access rules with simulated auth context — POST /admin/api/data/rules-test */
    public Object adminRulesTest(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/admin/api/data/rules-test", body);
    }

    /** List registered functions from config — GET /admin/api/data/functions */
    public Object adminListFunctions() throws EdgeBaseError {
        return http.get("/admin/api/data/functions");
    }

    /** Get environment and config overview — GET /admin/api/data/config-info */
    public Object adminGetConfigInfo() throws EdgeBaseError {
        return http.get("/admin/api/data/config-info");
    }

    /** Get recent request logs with filtering — GET /admin/api/data/logs/recent */
    public Object adminGetRecentLogs() throws EdgeBaseError {
        return http.get("/admin/api/data/logs/recent");
    }

    /** Get OAuth provider config — GET /admin/api/data/auth/settings */
    public Object adminGetAuthSettings() throws EdgeBaseError {
        return http.get("/admin/api/data/auth/settings");
    }

    /** Get email template and subject config — GET /admin/api/data/email/templates */
    public Object adminGetEmailTemplates() throws EdgeBaseError {
        return http.get("/admin/api/data/email/templates");
    }

    /** Disable MFA for a user — DELETE /admin/api/data/users/{id}/mfa */
    public Object adminDeleteUserMfa(String id) throws EdgeBaseError {
        return http.delete("/admin/api/data/users/" + encodePathParam(id) + "/mfa");
    }

    /** Send password reset email for a user — POST /admin/api/data/users/{id}/send-password-reset */
    public Object adminSendPasswordReset(String id) throws EdgeBaseError {
        return http.post("/admin/api/data/users/" + encodePathParam(id) + "/send-password-reset", null);
    }

    /** Upload file to R2 storage — POST /admin/api/data/storage/buckets/{name}/upload */
    public Object adminUploadFile(String name, Map<String, ?> body) throws EdgeBaseError {
        return http.post("/admin/api/data/storage/buckets/" + encodePathParam(name) + "/upload", body);
    }

    /** List push tokens for a user — GET /admin/api/data/push/tokens */
    public Object adminGetPushTokens() throws EdgeBaseError {
        return http.get("/admin/api/data/push/tokens");
    }

    /** Get push notification logs — GET /admin/api/data/push/logs */
    public Object adminGetPushLogs() throws EdgeBaseError {
        return http.get("/admin/api/data/push/logs");
    }

    /** Test send push notification — POST /admin/api/data/push/test-send */
    public Object adminTestPushSend(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/admin/api/data/push/test-send", body);
    }

    /** List Durable Objects for backup — POST /admin/api/data/backup/list-dos */
    public Object adminBackupListDOs() throws EdgeBaseError {
        return http.post("/admin/api/data/backup/list-dos", null);
    }

    /** Dump a Durable Object for backup — POST /admin/api/data/backup/dump-do */
    public Object adminBackupDumpDO(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/admin/api/data/backup/dump-do", body);
    }

    /** Restore a Durable Object from backup — POST /admin/api/data/backup/restore-do */
    public Object adminBackupRestoreDO(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/admin/api/data/backup/restore-do", body);
    }

    /** Dump D1 database for backup — POST /admin/api/data/backup/dump-d1 */
    public Object adminBackupDumpD1() throws EdgeBaseError {
        return http.post("/admin/api/data/backup/dump-d1", null);
    }

    /** Restore D1 database from backup — POST /admin/api/data/backup/restore-d1 */
    public Object adminBackupRestoreD1(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/admin/api/data/backup/restore-d1", body);
    }

    /** Get backup config — GET /admin/api/data/backup/config */
    public Object adminBackupGetConfig() throws EdgeBaseError {
        return http.get("/admin/api/data/backup/config");
    }

    /** List admin accounts — GET /admin/api/data/admins */
    public Object adminListAdmins() throws EdgeBaseError {
        return http.get("/admin/api/data/admins");
    }

    /** Create an admin account — POST /admin/api/data/admins */
    public Object adminCreateAdmin(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/admin/api/data/admins", body);
    }

    /** Delete an admin account — DELETE /admin/api/data/admins/{id} */
    public Object adminDeleteAdmin(String id) throws EdgeBaseError {
        return http.delete("/admin/api/data/admins/" + encodePathParam(id));
    }

    /** Change admin password — PUT /admin/api/data/admins/{id}/password */
    public Object adminChangePassword(String id, Map<String, ?> body) throws EdgeBaseError {
        return http.put("/admin/api/data/admins/" + encodePathParam(id) + "/password", body);
    }

    /** List all DO instances — POST /admin/api/backup/list-dos */
    public Object backupListDOs(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/admin/api/backup/list-dos", body);
    }

    /** Return parsed config snapshot — GET /admin/api/backup/config */
    public Object backupGetConfig() throws EdgeBaseError {
        return http.get("/admin/api/backup/config");
    }

    /** Remove plugin-prefixed tables and migration metadata — POST /admin/api/backup/cleanup-plugin */
    public Object backupCleanupPlugin(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/admin/api/backup/cleanup-plugin", body);
    }

    /** Wipe a specific DO's data — POST /admin/api/backup/wipe-do */
    public Object backupWipeDO(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/admin/api/backup/wipe-do", body);
    }

    /** Dump a specific DO's data — POST /admin/api/backup/dump-do */
    public Object backupDumpDO(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/admin/api/backup/dump-do", body);
    }

    /** Restore a specific DO's data — POST /admin/api/backup/restore-do */
    public Object backupRestoreDO(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/admin/api/backup/restore-do", body);
    }

    /** Dump auth database tables — POST /admin/api/backup/dump-d1 */
    public Object backupDumpD1() throws EdgeBaseError {
        return http.post("/admin/api/backup/dump-d1", null);
    }

    /** Restore auth database tables — POST /admin/api/backup/restore-d1 */
    public Object backupRestoreD1(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/admin/api/backup/restore-d1", body);
    }

    /** Dump control-plane D1 tables — POST /admin/api/backup/dump-control-d1 */
    public Object backupDumpControlD1() throws EdgeBaseError {
        return http.post("/admin/api/backup/dump-control-d1", null);
    }

    /** Restore control-plane D1 tables — POST /admin/api/backup/restore-control-d1 */
    public Object backupRestoreControlD1(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/admin/api/backup/restore-control-d1", body);
    }

    /** Dump all tables from a data namespace — POST /admin/api/backup/dump-data */
    public Object backupDumpData(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/admin/api/backup/dump-data", body);
    }

    /** Restore all tables into a data namespace — POST /admin/api/backup/restore-data */
    public Object backupRestoreData(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/admin/api/backup/restore-data", body);
    }

    /** Dump R2 storage (list or download) — POST /admin/api/backup/dump-storage */
    public Object backupDumpStorage(Map<String, String> query) throws EdgeBaseError {
        return http.getWithQuery("/admin/api/backup/dump-storage", query);
    }

    /** Restore R2 storage (wipe or upload) — POST /admin/api/backup/restore-storage */
    public Object backupRestoreStorage(Map<String, String> query) throws EdgeBaseError {
        return http.getWithQuery("/admin/api/backup/restore-storage", query);
    }

    /** Resync _users_public from _users in AUTH_DB D1 — POST /admin/api/backup/resync-users-public */
    public Object backupResyncUsersPublic() throws EdgeBaseError {
        return http.post("/admin/api/backup/resync-users-public", null);
    }

    /** Export a single table as JSON — GET /admin/api/backup/export/{name} */
    public Object backupExportTable(String name, Map<String, String> query) throws EdgeBaseError {
        return http.getWithQuery("/admin/api/backup/export/" + encodePathParam(name), query);
    }
}
