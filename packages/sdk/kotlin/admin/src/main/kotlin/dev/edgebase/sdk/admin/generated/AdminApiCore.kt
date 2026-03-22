// Auto-generated admin API Core — DO NOT EDIT.
// Regenerate: npx tsx tools/sdk-codegen/generate.ts
// Source: openapi.json (0.1.0)

package dev.edgebase.sdk.admin.generated

import dev.edgebase.sdk.core.HttpClient
import dev.edgebase.sdk.core.platformUrlEncode

/**
 * Auto-generated API methods.
 */
class GeneratedAdminApi(private val http: HttpClient) {

    /** Get user by ID — GET /api/auth/admin/users/{id} */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminAuthGetUser(id: String): Any? =
        http.get("/auth/admin/users/${platformUrlEncode(id)}")

    /** Update user by ID — PATCH /api/auth/admin/users/{id} */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminAuthUpdateUser(id: String, body: Map<String, Any?> = emptyMap()): Any? =
        http.patch("/auth/admin/users/${platformUrlEncode(id)}", body)

    /** Delete user by ID — DELETE /api/auth/admin/users/{id} */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminAuthDeleteUser(id: String): Any? =
        http.delete("/auth/admin/users/${platformUrlEncode(id)}")

    /** List users — GET /api/auth/admin/users */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminAuthListUsers(query: Map<String, String>? = null): Any? =
        http.get("/auth/admin/users", query)

    /** Create a new user — POST /api/auth/admin/users */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminAuthCreateUser(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/auth/admin/users", body)

    /** Delete user MFA — DELETE /api/auth/admin/users/{id}/mfa */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminAuthDeleteUserMfa(id: String): Any? =
        http.delete("/auth/admin/users/${platformUrlEncode(id)}/mfa")

    /** Set custom claims for user — PUT /api/auth/admin/users/{id}/claims */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminAuthSetClaims(id: String, body: Map<String, Any?> = emptyMap()): Any? =
        http.put("/auth/admin/users/${platformUrlEncode(id)}/claims", body)

    /** Revoke all sessions for user — POST /api/auth/admin/users/{id}/revoke */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminAuthRevokeUserSessions(id: String): Any? =
        http.post("/auth/admin/users/${platformUrlEncode(id)}/revoke")

    /** Batch import users — POST /api/auth/admin/users/import */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminAuthImportUsers(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/auth/admin/users/import", body)

    /** Broadcast to database live channel — POST /api/db/broadcast */
    @Suppress("UNCHECKED_CAST")
    suspend fun databaseLiveBroadcast(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/db/broadcast", body)

    /** Execute SQL via DatabaseDO — POST /api/sql */
    @Suppress("UNCHECKED_CAST")
    suspend fun executeSql(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/sql", body)

    /** Execute KV operation — POST /api/kv/{namespace} */
    @Suppress("UNCHECKED_CAST")
    suspend fun kvOperation(namespace: String, body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/kv/${platformUrlEncode(namespace)}", body)

    /** Execute raw SQL on D1 database — POST /api/d1/{database} */
    @Suppress("UNCHECKED_CAST")
    suspend fun executeD1Query(database: String, body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/d1/${platformUrlEncode(database)}", body)

    /** Execute Vectorize operation — POST /api/vectorize/{index} */
    @Suppress("UNCHECKED_CAST")
    suspend fun vectorizeOperation(index: String, body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/vectorize/${platformUrlEncode(index)}", body)

    /** Send push notification to user — POST /api/push/send */
    @Suppress("UNCHECKED_CAST")
    suspend fun pushSend(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/push/send", body)

    /** Send push to multiple users — POST /api/push/send-many */
    @Suppress("UNCHECKED_CAST")
    suspend fun pushSendMany(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/push/send-many", body)

    /** Send push to specific token — POST /api/push/send-to-token */
    @Suppress("UNCHECKED_CAST")
    suspend fun pushSendToToken(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/push/send-to-token", body)

    /** Send push to topic — POST /api/push/send-to-topic */
    @Suppress("UNCHECKED_CAST")
    suspend fun pushSendToTopic(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/push/send-to-topic", body)

    /** Broadcast push to all devices — POST /api/push/broadcast */
    @Suppress("UNCHECKED_CAST")
    suspend fun pushBroadcast(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/push/broadcast", body)

    /** Get push notification logs — GET /api/push/logs */
    @Suppress("UNCHECKED_CAST")
    suspend fun getPushLogs(query: Map<String, String>? = null): Any? =
        http.get("/push/logs", query)

    /** Get registered push tokens — GET /api/push/tokens */
    @Suppress("UNCHECKED_CAST")
    suspend fun getPushTokens(query: Map<String, String>? = null): Any? =
        http.get("/push/tokens", query)

    /** Upsert a device token — PUT /api/push/tokens */
    @Suppress("UNCHECKED_CAST")
    suspend fun putPushTokens(body: Map<String, Any?> = emptyMap()): Any? =
        http.put("/push/tokens", body)

    /** Update device metadata — PATCH /api/push/tokens */
    @Suppress("UNCHECKED_CAST")
    suspend fun patchPushTokens(body: Map<String, Any?> = emptyMap()): Any? =
        http.patch("/push/tokens", body)

    /** Query request log metrics — GET /api/analytics/query */
    @Suppress("UNCHECKED_CAST")
    suspend fun queryAnalytics(query: Map<String, String>? = null): Any? =
        http.get("/analytics/query", query)

    /** Query custom events — GET /api/analytics/events */
    @Suppress("UNCHECKED_CAST")
    suspend fun queryCustomEvents(query: Map<String, String>? = null): Any? =
        http.get("/analytics/events", query)

    /** Check if admin setup is needed — GET /admin/api/setup/status */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminSetupStatus(): Any? =
        http.get("/admin/api/setup/status")

    /** Create the first admin account — POST /admin/api/setup */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminSetup(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/admin/api/setup", body)

    /** Admin login — POST /admin/api/auth/login */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminLogin(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/admin/api/auth/login", body)

    /** Rotate admin token — POST /admin/api/auth/refresh */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminRefresh(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/admin/api/auth/refresh", body)

    /** Reset admin password (Service Key required) — POST /admin/api/internal/reset-password */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminResetPassword(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/admin/api/internal/reset-password", body)

    /** List all tables from config — GET /admin/api/data/tables */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminListTables(): Any? =
        http.get("/admin/api/data/tables")

    /** List table records with pagination — GET /admin/api/data/tables/{name}/records */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminGetTableRecords(name: String): Any? =
        http.get("/admin/api/data/tables/${platformUrlEncode(name)}/records")

    /** Create a table record — POST /admin/api/data/tables/{name}/records */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminCreateTableRecord(name: String, body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/admin/api/data/tables/${platformUrlEncode(name)}/records", body)

    /** Update a table record — PUT /admin/api/data/tables/{name}/records/{id} */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminUpdateTableRecord(name: String, id: String, body: Map<String, Any?> = emptyMap()): Any? =
        http.put("/admin/api/data/tables/${platformUrlEncode(name)}/records/${platformUrlEncode(id)}", body)

    /** Delete a table record — DELETE /admin/api/data/tables/{name}/records/{id} */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminDeleteTableRecord(name: String, id: String): Any? =
        http.delete("/admin/api/data/tables/${platformUrlEncode(name)}/records/${platformUrlEncode(id)}")

    /** List users via D1 index — GET /admin/api/data/users */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminListUsers(): Any? =
        http.get("/admin/api/data/users")

    /** Create a new user — POST /admin/api/data/users */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminCreateUser(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/admin/api/data/users", body)

    /** Fetch a single user by ID — GET /admin/api/data/users/{id} */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminGetUser(id: String): Any? =
        http.get("/admin/api/data/users/${platformUrlEncode(id)}")

    /** Update user status or role — PUT /admin/api/data/users/{id} */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminUpdateUser(id: String, body: Map<String, Any?> = emptyMap()): Any? =
        http.put("/admin/api/data/users/${platformUrlEncode(id)}", body)

    /** Delete a user completely — DELETE /admin/api/data/users/{id} */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminDeleteUser(id: String): Any? =
        http.delete("/admin/api/data/users/${platformUrlEncode(id)}")

    /** Fetch user profile with cache — GET /admin/api/data/users/{id}/profile */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminGetUserProfile(id: String): Any? =
        http.get("/admin/api/data/users/${platformUrlEncode(id)}/profile")

    /** Revoke all user sessions — DELETE /admin/api/data/users/{id}/sessions */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminDeleteUserSessions(id: String): Any? =
        http.delete("/admin/api/data/users/${platformUrlEncode(id)}/sessions")

    /** Cleanup anonymous user index — POST /admin/api/data/cleanup-anon */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminCleanupAnon(): Any? =
        http.post("/admin/api/data/cleanup-anon")

    /** List configured storage buckets — GET /admin/api/data/storage/buckets */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminListBuckets(): Any? =
        http.get("/admin/api/data/storage/buckets")

    /** List objects in a storage bucket — GET /admin/api/data/storage/buckets/{name}/objects */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminListBucketObjects(name: String): Any? =
        http.get("/admin/api/data/storage/buckets/${platformUrlEncode(name)}/objects")

    /** Get a storage object content — GET /admin/api/data/storage/buckets/{name}/objects/{key} */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminGetBucketObject(name: String, key: String): Any? =
        http.get("/admin/api/data/storage/buckets/${platformUrlEncode(name)}/objects/${platformUrlEncode(key)}")

    /** Delete a storage object — DELETE /admin/api/data/storage/buckets/{name}/objects/{key} */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminDeleteBucketObject(name: String, key: String): Any? =
        http.delete("/admin/api/data/storage/buckets/${platformUrlEncode(name)}/objects/${platformUrlEncode(key)}")

    /** Get bucket statistics (total objects and size) — GET /admin/api/data/storage/buckets/{name}/stats */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminGetBucketStats(name: String): Any? =
        http.get("/admin/api/data/storage/buckets/${platformUrlEncode(name)}/stats")

    /** Create a signed download URL for a storage object — POST /admin/api/data/storage/buckets/{name}/signed-url */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminCreateSignedUrl(name: String, body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/admin/api/data/storage/buckets/${platformUrlEncode(name)}/signed-url", body)

    /** Get full schema structure from config — GET /admin/api/data/schema */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminGetSchema(): Any? =
        http.get("/admin/api/data/schema")

    /** List instance suggestions for a dynamic namespace — GET /admin/api/data/namespaces/{namespace}/instances */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminListNamespaceInstances(namespace: String, query: Map<String, String>? = null): Any? =
        http.get("/admin/api/data/namespaces/${platformUrlEncode(namespace)}/instances", query)

    /** Export table data as JSON — GET /admin/api/data/tables/{name}/export */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminExportTable(name: String): Any? =
        http.get("/admin/api/data/tables/${platformUrlEncode(name)}/export")

    /** Get request logs — GET /admin/api/data/logs */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminGetLogs(): Any? =
        http.get("/admin/api/data/logs")

    /** Get live monitoring stats — GET /admin/api/data/monitoring */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminGetMonitoring(): Any? =
        http.get("/admin/api/data/monitoring")

    /** Get analytics dashboard data — GET /admin/api/data/analytics */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminGetAnalytics(query: Map<String, String>? = null): Any? =
        http.get("/admin/api/data/analytics", query)

    /** Query analytics events for admin dashboard — GET /admin/api/data/analytics/events */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminGetAnalyticsEvents(): Any? =
        http.get("/admin/api/data/analytics/events")

    /** Get project overview for dashboard home — GET /admin/api/data/overview */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminGetOverview(query: Map<String, String>? = null): Any? =
        http.get("/admin/api/data/overview", query)

    /** Get dev mode status and sidecar port — GET /admin/api/data/dev-info */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminGetDevInfo(): Any? =
        http.get("/admin/api/data/dev-info")

    /** Execute raw SQL query — POST /admin/api/data/sql */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminExecuteSql(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/admin/api/data/sql", body)

    /** Batch import records into a table — POST /admin/api/data/tables/{name}/import */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminImportTable(name: String, body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/admin/api/data/tables/${platformUrlEncode(name)}/import", body)

    /** Evaluate access rules with simulated auth context — POST /admin/api/data/rules-test */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminRulesTest(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/admin/api/data/rules-test", body)

    /** List registered functions from config — GET /admin/api/data/functions */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminListFunctions(): Any? =
        http.get("/admin/api/data/functions")

    /** Get environment and config overview — GET /admin/api/data/config-info */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminGetConfigInfo(): Any? =
        http.get("/admin/api/data/config-info")

    /** Get recent request logs with filtering — GET /admin/api/data/logs/recent */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminGetRecentLogs(): Any? =
        http.get("/admin/api/data/logs/recent")

    /** Get OAuth provider config — GET /admin/api/data/auth/settings */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminGetAuthSettings(): Any? =
        http.get("/admin/api/data/auth/settings")

    /** Get email template and subject config — GET /admin/api/data/email/templates */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminGetEmailTemplates(): Any? =
        http.get("/admin/api/data/email/templates")

    /** Disable MFA for a user — DELETE /admin/api/data/users/{id}/mfa */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminDeleteUserMfa(id: String): Any? =
        http.delete("/admin/api/data/users/${platformUrlEncode(id)}/mfa")

    /** Send password reset email for a user — POST /admin/api/data/users/{id}/send-password-reset */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminSendPasswordReset(id: String): Any? =
        http.post("/admin/api/data/users/${platformUrlEncode(id)}/send-password-reset")

    /** Upload file to R2 storage — POST /admin/api/data/storage/buckets/{name}/upload */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminUploadFile(name: String, body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/admin/api/data/storage/buckets/${platformUrlEncode(name)}/upload", body)

    /** List push tokens for a user — GET /admin/api/data/push/tokens */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminGetPushTokens(): Any? =
        http.get("/admin/api/data/push/tokens")

    /** Get push notification logs — GET /admin/api/data/push/logs */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminGetPushLogs(): Any? =
        http.get("/admin/api/data/push/logs")

    /** Test send push notification — POST /admin/api/data/push/test-send */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminTestPushSend(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/admin/api/data/push/test-send", body)

    /** List Durable Objects for backup — POST /admin/api/data/backup/list-dos */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminBackupListDOs(): Any? =
        http.post("/admin/api/data/backup/list-dos")

    /** Dump a Durable Object for backup — POST /admin/api/data/backup/dump-do */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminBackupDumpDO(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/admin/api/data/backup/dump-do", body)

    /** Restore a Durable Object from backup — POST /admin/api/data/backup/restore-do */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminBackupRestoreDO(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/admin/api/data/backup/restore-do", body)

    /** Dump D1 database for backup — POST /admin/api/data/backup/dump-d1 */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminBackupDumpD1(): Any? =
        http.post("/admin/api/data/backup/dump-d1")

    /** Restore D1 database from backup — POST /admin/api/data/backup/restore-d1 */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminBackupRestoreD1(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/admin/api/data/backup/restore-d1", body)

    /** Dump data namespace tables for admin-side migrations — POST /admin/api/data/backup/dump-data */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminBackupDumpData(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/admin/api/data/backup/dump-data", body)

    /** Restore data namespace tables for admin-side migrations — POST /admin/api/data/backup/restore-data */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminBackupRestoreData(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/admin/api/data/backup/restore-data", body)

    /** Get backup config — GET /admin/api/data/backup/config */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminBackupGetConfig(): Any? =
        http.get("/admin/api/data/backup/config")

    /** List admin accounts — GET /admin/api/data/admins */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminListAdmins(): Any? =
        http.get("/admin/api/data/admins")

    /** Create an admin account — POST /admin/api/data/admins */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminCreateAdmin(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/admin/api/data/admins", body)

    /** Delete an admin account — DELETE /admin/api/data/admins/{id} */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminDeleteAdmin(id: String): Any? =
        http.delete("/admin/api/data/admins/${platformUrlEncode(id)}")

    /** Change admin password — PUT /admin/api/data/admins/{id}/password */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminChangePassword(id: String, body: Map<String, Any?> = emptyMap()): Any? =
        http.put("/admin/api/data/admins/${platformUrlEncode(id)}/password", body)

    /** Delete all Cloudflare resources and the Worker itself (self-destruct) — POST /admin/api/data/destroy-app */
    @Suppress("UNCHECKED_CAST")
    suspend fun adminDestroyApp(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/admin/api/data/destroy-app", body)

    /** List all DO instances — POST /admin/api/backup/list-dos */
    @Suppress("UNCHECKED_CAST")
    suspend fun backupListDOs(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/admin/api/backup/list-dos", body)

    /** Return parsed config snapshot — GET /admin/api/backup/config */
    @Suppress("UNCHECKED_CAST")
    suspend fun backupGetConfig(): Any? =
        http.get("/admin/api/backup/config")

    /** Remove plugin-prefixed tables and migration metadata — POST /admin/api/backup/cleanup-plugin */
    @Suppress("UNCHECKED_CAST")
    suspend fun backupCleanupPlugin(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/admin/api/backup/cleanup-plugin", body)

    /** Wipe a specific DO's data — POST /admin/api/backup/wipe-do */
    @Suppress("UNCHECKED_CAST")
    suspend fun backupWipeDO(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/admin/api/backup/wipe-do", body)

    /** Dump a specific DO's data — POST /admin/api/backup/dump-do */
    @Suppress("UNCHECKED_CAST")
    suspend fun backupDumpDO(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/admin/api/backup/dump-do", body)

    /** Restore a specific DO's data — POST /admin/api/backup/restore-do */
    @Suppress("UNCHECKED_CAST")
    suspend fun backupRestoreDO(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/admin/api/backup/restore-do", body)

    /** Dump auth database tables — POST /admin/api/backup/dump-d1 */
    @Suppress("UNCHECKED_CAST")
    suspend fun backupDumpD1(): Any? =
        http.post("/admin/api/backup/dump-d1")

    /** Restore auth database tables — POST /admin/api/backup/restore-d1 */
    @Suppress("UNCHECKED_CAST")
    suspend fun backupRestoreD1(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/admin/api/backup/restore-d1", body)

    /** Dump control-plane D1 tables — POST /admin/api/backup/dump-control-d1 */
    @Suppress("UNCHECKED_CAST")
    suspend fun backupDumpControlD1(): Any? =
        http.post("/admin/api/backup/dump-control-d1")

    /** Restore control-plane D1 tables — POST /admin/api/backup/restore-control-d1 */
    @Suppress("UNCHECKED_CAST")
    suspend fun backupRestoreControlD1(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/admin/api/backup/restore-control-d1", body)

    /** Dump all tables from a data namespace — POST /admin/api/backup/dump-data */
    @Suppress("UNCHECKED_CAST")
    suspend fun backupDumpData(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/admin/api/backup/dump-data", body)

    /** Restore all tables into a data namespace — POST /admin/api/backup/restore-data */
    @Suppress("UNCHECKED_CAST")
    suspend fun backupRestoreData(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/admin/api/backup/restore-data", body)

    /** Dump R2 storage (list or download) — POST /admin/api/backup/dump-storage */
    @Suppress("UNCHECKED_CAST")
    suspend fun backupDumpStorage(query: Map<String, String>? = null): Any? =
        http.get("/admin/api/backup/dump-storage", query)

    /** Restore R2 storage (wipe or upload) — POST /admin/api/backup/restore-storage */
    @Suppress("UNCHECKED_CAST")
    suspend fun backupRestoreStorage(query: Map<String, String>? = null): Any? =
        http.get("/admin/api/backup/restore-storage", query)

    /** Resync _users_public from _users in AUTH_DB D1 — POST /admin/api/backup/resync-users-public */
    @Suppress("UNCHECKED_CAST")
    suspend fun backupResyncUsersPublic(): Any? =
        http.post("/admin/api/backup/resync-users-public")

    /** Export a single table as JSON — GET /admin/api/backup/export/{name} */
    @Suppress("UNCHECKED_CAST")
    suspend fun backupExportTable(name: String, query: Map<String, String>? = null): Any? =
        http.get("/admin/api/backup/export/${platformUrlEncode(name)}", query)
}
