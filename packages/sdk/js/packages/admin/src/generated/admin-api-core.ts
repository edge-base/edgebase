/**
 * Auto-generated admin API Core — DO NOT EDIT.
 * Regenerate: npx tsx tools/sdk-codegen/generate.ts
 * Source: openapi.json (0.1.0)
 */

// ─── Interface ─────────────────────────────────────────────────────────────

export interface GeneratedAdminApi {
  /** Get user by ID — GET /api/auth/admin/users/{id} */
  adminAuthGetUser(id: string): Promise<unknown>;
  /** Update user by ID — PATCH /api/auth/admin/users/{id} */
  adminAuthUpdateUser(id: string, body: unknown): Promise<unknown>;
  /** Delete user by ID — DELETE /api/auth/admin/users/{id} */
  adminAuthDeleteUser(id: string): Promise<unknown>;
  /** List users — GET /api/auth/admin/users */
  adminAuthListUsers(query: Record<string, string>): Promise<unknown>;
  /** Create a new user — POST /api/auth/admin/users */
  adminAuthCreateUser(body: unknown): Promise<unknown>;
  /** Delete user MFA — DELETE /api/auth/admin/users/{id}/mfa */
  adminAuthDeleteUserMfa(id: string): Promise<unknown>;
  /** Set custom claims for user — PUT /api/auth/admin/users/{id}/claims */
  adminAuthSetClaims(id: string, body: unknown): Promise<unknown>;
  /** Revoke all sessions for user — POST /api/auth/admin/users/{id}/revoke */
  adminAuthRevokeUserSessions(id: string): Promise<unknown>;
  /** Batch import users — POST /api/auth/admin/users/import */
  adminAuthImportUsers(body: unknown): Promise<unknown>;
  /** Broadcast to database live channel — POST /api/db/broadcast */
  databaseLiveBroadcast(body: unknown): Promise<unknown>;
  /** Execute SQL via DatabaseDO — POST /api/sql */
  executeSql(body: unknown): Promise<unknown>;
  /** Execute KV operation — POST /api/kv/{namespace} */
  kvOperation(namespace: string, body: unknown): Promise<unknown>;
  /** Execute raw SQL on D1 database — POST /api/d1/{database} */
  executeD1Query(database: string, body: unknown): Promise<unknown>;
  /** Execute Vectorize operation — POST /api/vectorize/{index} */
  vectorizeOperation(index: string, body: unknown): Promise<unknown>;
  /** Send push notification to user — POST /api/push/send */
  pushSend(body: unknown): Promise<unknown>;
  /** Send push to multiple users — POST /api/push/send-many */
  pushSendMany(body: unknown): Promise<unknown>;
  /** Send push to specific token — POST /api/push/send-to-token */
  pushSendToToken(body: unknown): Promise<unknown>;
  /** Send push to topic — POST /api/push/send-to-topic */
  pushSendToTopic(body: unknown): Promise<unknown>;
  /** Broadcast push to all devices — POST /api/push/broadcast */
  pushBroadcast(body: unknown): Promise<unknown>;
  /** Get push notification logs — GET /api/push/logs */
  getPushLogs(query: Record<string, string>): Promise<unknown>;
  /** Get registered push tokens — GET /api/push/tokens */
  getPushTokens(query: Record<string, string>): Promise<unknown>;
  /** Upsert a device token — PUT /api/push/tokens */
  putPushTokens(body: unknown): Promise<unknown>;
  /** Update device metadata — PATCH /api/push/tokens */
  patchPushTokens(body: unknown): Promise<unknown>;
  /** Query request log metrics — GET /api/analytics/query */
  queryAnalytics(query: Record<string, string>): Promise<unknown>;
  /** Query custom events — GET /api/analytics/events */
  queryCustomEvents(query: Record<string, string>): Promise<unknown>;
  /** Check if admin setup is needed — GET /admin/api/setup/status */
  adminSetupStatus(): Promise<unknown>;
  /** Create the first admin account — POST /admin/api/setup */
  adminSetup(body: unknown): Promise<unknown>;
  /** Admin login — POST /admin/api/auth/login */
  adminLogin(body: unknown): Promise<unknown>;
  /** Rotate admin token — POST /admin/api/auth/refresh */
  adminRefresh(body: unknown): Promise<unknown>;
  /** Reset admin password (Service Key required) — POST /admin/api/internal/reset-password */
  adminResetPassword(body: unknown): Promise<unknown>;
  /** List all tables from config — GET /admin/api/data/tables */
  adminListTables(): Promise<unknown>;
  /** List table records with pagination — GET /admin/api/data/tables/{name}/records */
  adminGetTableRecords(name: string): Promise<unknown>;
  /** Create a table record — POST /admin/api/data/tables/{name}/records */
  adminCreateTableRecord(name: string, body: unknown): Promise<unknown>;
  /** Update a table record — PUT /admin/api/data/tables/{name}/records/{id} */
  adminUpdateTableRecord(name: string, id: string, body: unknown): Promise<unknown>;
  /** Delete a table record — DELETE /admin/api/data/tables/{name}/records/{id} */
  adminDeleteTableRecord(name: string, id: string): Promise<unknown>;
  /** List users via D1 index — GET /admin/api/data/users */
  adminListUsers(): Promise<unknown>;
  /** Create a new user — POST /admin/api/data/users */
  adminCreateUser(body: unknown): Promise<unknown>;
  /** Fetch a single user by ID — GET /admin/api/data/users/{id} */
  adminGetUser(id: string): Promise<unknown>;
  /** Update user status or role — PUT /admin/api/data/users/{id} */
  adminUpdateUser(id: string, body: unknown): Promise<unknown>;
  /** Delete a user completely — DELETE /admin/api/data/users/{id} */
  adminDeleteUser(id: string): Promise<unknown>;
  /** Fetch user profile with cache — GET /admin/api/data/users/{id}/profile */
  adminGetUserProfile(id: string): Promise<unknown>;
  /** Revoke all user sessions — DELETE /admin/api/data/users/{id}/sessions */
  adminDeleteUserSessions(id: string): Promise<unknown>;
  /** Cleanup anonymous user index — POST /admin/api/data/cleanup-anon */
  adminCleanupAnon(): Promise<unknown>;
  /** List configured storage buckets — GET /admin/api/data/storage/buckets */
  adminListBuckets(): Promise<unknown>;
  /** List objects in a storage bucket — GET /admin/api/data/storage/buckets/{name}/objects */
  adminListBucketObjects(name: string): Promise<unknown>;
  /** Get a storage object content — GET /admin/api/data/storage/buckets/{name}/objects/{key} */
  adminGetBucketObject(name: string, key: string): Promise<unknown>;
  /** Delete a storage object — DELETE /admin/api/data/storage/buckets/{name}/objects/{key} */
  adminDeleteBucketObject(name: string, key: string): Promise<unknown>;
  /** Get bucket statistics (total objects and size) — GET /admin/api/data/storage/buckets/{name}/stats */
  adminGetBucketStats(name: string): Promise<unknown>;
  /** Create a signed download URL for a storage object — POST /admin/api/data/storage/buckets/{name}/signed-url */
  adminCreateSignedUrl(name: string, body: unknown): Promise<unknown>;
  /** Get full schema structure from config — GET /admin/api/data/schema */
  adminGetSchema(): Promise<unknown>;
  /** Export table data as JSON — GET /admin/api/data/tables/{name}/export */
  adminExportTable(name: string): Promise<unknown>;
  /** Get request logs — GET /admin/api/data/logs */
  adminGetLogs(): Promise<unknown>;
  /** Get realtime monitoring stats — GET /admin/api/data/monitoring */
  adminGetMonitoring(): Promise<unknown>;
  /** Get analytics dashboard data — GET /admin/api/data/analytics */
  adminGetAnalytics(): Promise<unknown>;
  /** Query analytics events for admin dashboard — GET /admin/api/data/analytics/events */
  adminGetAnalyticsEvents(): Promise<unknown>;
  /** Get project overview for dashboard home — GET /admin/api/data/overview */
  adminGetOverview(): Promise<unknown>;
  /** Get dev mode status and sidecar port — GET /admin/api/data/dev-info */
  adminGetDevInfo(): Promise<unknown>;
  /** Execute raw SQL query — POST /admin/api/data/sql */
  adminExecuteSql(body: unknown): Promise<unknown>;
  /** Batch import records into a table — POST /admin/api/data/tables/{name}/import */
  adminImportTable(name: string, body: unknown): Promise<unknown>;
  /** Evaluate access rules with simulated auth context — POST /admin/api/data/rules-test */
  adminRulesTest(body: unknown): Promise<unknown>;
  /** List registered functions from config — GET /admin/api/data/functions */
  adminListFunctions(): Promise<unknown>;
  /** Get environment and config overview — GET /admin/api/data/config-info */
  adminGetConfigInfo(): Promise<unknown>;
  /** Get recent request logs with filtering — GET /admin/api/data/logs/recent */
  adminGetRecentLogs(): Promise<unknown>;
  /** Get OAuth provider config — GET /admin/api/data/auth/settings */
  adminGetAuthSettings(): Promise<unknown>;
  /** Get email template and subject config — GET /admin/api/data/email/templates */
  adminGetEmailTemplates(): Promise<unknown>;
  /** Disable MFA for a user — DELETE /admin/api/data/users/{id}/mfa */
  adminDeleteUserMfa(id: string): Promise<unknown>;
  /** Send password reset email for a user — POST /admin/api/data/users/{id}/send-password-reset */
  adminSendPasswordReset(id: string): Promise<unknown>;
  /** Upload file to R2 storage — POST /admin/api/data/storage/buckets/{name}/upload */
  adminUploadFile(name: string, body: unknown): Promise<unknown>;
  /** List push tokens for a user — GET /admin/api/data/push/tokens */
  adminGetPushTokens(): Promise<unknown>;
  /** Get push notification logs — GET /admin/api/data/push/logs */
  adminGetPushLogs(): Promise<unknown>;
  /** Test send push notification — POST /admin/api/data/push/test-send */
  adminTestPushSend(body: unknown): Promise<unknown>;
  /** List Durable Objects for backup — POST /admin/api/data/backup/list-dos */
  adminBackupListDOs(): Promise<unknown>;
  /** Dump a Durable Object for backup — POST /admin/api/data/backup/dump-do */
  adminBackupDumpDO(body: unknown): Promise<unknown>;
  /** Restore a Durable Object from backup — POST /admin/api/data/backup/restore-do */
  adminBackupRestoreDO(body: unknown): Promise<unknown>;
  /** Dump D1 database for backup — POST /admin/api/data/backup/dump-d1 */
  adminBackupDumpD1(): Promise<unknown>;
  /** Restore D1 database from backup — POST /admin/api/data/backup/restore-d1 */
  adminBackupRestoreD1(body: unknown): Promise<unknown>;
  /** Get backup config — GET /admin/api/data/backup/config */
  adminBackupGetConfig(): Promise<unknown>;
  /** List admin accounts — GET /admin/api/data/admins */
  adminListAdmins(): Promise<unknown>;
  /** Create an admin account — POST /admin/api/data/admins */
  adminCreateAdmin(body: unknown): Promise<unknown>;
  /** Delete an admin account — DELETE /admin/api/data/admins/{id} */
  adminDeleteAdmin(id: string): Promise<unknown>;
  /** Change admin password — PUT /admin/api/data/admins/{id}/password */
  adminChangePassword(id: string, body: unknown): Promise<unknown>;
  /** List all DO instances — POST /admin/api/backup/list-dos */
  backupListDOs(body: unknown): Promise<unknown>;
  /** Return parsed config snapshot — GET /admin/api/backup/config */
  backupGetConfig(): Promise<unknown>;
  /** Remove plugin-prefixed tables and migration metadata — POST /admin/api/backup/cleanup-plugin */
  backupCleanupPlugin(body: unknown): Promise<unknown>;
  /** Wipe a specific DO's data — POST /admin/api/backup/wipe-do */
  backupWipeDO(body: unknown): Promise<unknown>;
  /** Dump a specific DO's data — POST /admin/api/backup/dump-do */
  backupDumpDO(body: unknown): Promise<unknown>;
  /** Restore a specific DO's data — POST /admin/api/backup/restore-do */
  backupRestoreDO(body: unknown): Promise<unknown>;
  /** Dump auth database tables — POST /admin/api/backup/dump-d1 */
  backupDumpD1(): Promise<unknown>;
  /** Restore auth database tables — POST /admin/api/backup/restore-d1 */
  backupRestoreD1(body: unknown): Promise<unknown>;
  /** Dump control-plane D1 tables — POST /admin/api/backup/dump-control-d1 */
  backupDumpControlD1(): Promise<unknown>;
  /** Restore control-plane D1 tables — POST /admin/api/backup/restore-control-d1 */
  backupRestoreControlD1(body: unknown): Promise<unknown>;
  /** Dump all tables from a data namespace — POST /admin/api/backup/dump-data */
  backupDumpData(body: unknown): Promise<unknown>;
  /** Restore all tables into a data namespace — POST /admin/api/backup/restore-data */
  backupRestoreData(body: unknown): Promise<unknown>;
  /** Dump R2 storage (list or download) — POST /admin/api/backup/dump-storage */
  backupDumpStorage(query: Record<string, string>): Promise<unknown>;
  /** Restore R2 storage (wipe or upload) — POST /admin/api/backup/restore-storage */
  backupRestoreStorage(query: Record<string, string>): Promise<unknown>;
  /** Resync _users_public from _users in AUTH_DB D1 — POST /admin/api/backup/resync-users-public */
  backupResyncUsersPublic(): Promise<unknown>;
  /** Export a single table as JSON — GET /admin/api/backup/export/{name} */
  backupExportTable(name: string, query: Record<string, string>): Promise<unknown>;
}

// ─── Implementation ────────────────────────────────────────────────────────

export interface HttpTransport {
  request<T>(method: string, path: string, options?: {
    query?: Record<string, string>;
    body?: unknown;
  }): Promise<T>;
}

export class DefaultAdminApi implements GeneratedAdminApi {
  constructor(private readonly transport: HttpTransport) {}

  async adminAuthGetUser(id: string): Promise<unknown> {
    return this.transport.request('GET', `/api/auth/admin/users/${id}`);
  }

  async adminAuthUpdateUser(id: string, body: unknown): Promise<unknown> {
    return this.transport.request('PATCH', `/api/auth/admin/users/${id}`, { body });
  }

  async adminAuthDeleteUser(id: string): Promise<unknown> {
    return this.transport.request('DELETE', `/api/auth/admin/users/${id}`);
  }

  async adminAuthListUsers(query: Record<string, string>): Promise<unknown> {
    return this.transport.request('GET', '/api/auth/admin/users', { query });
  }

  async adminAuthCreateUser(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/auth/admin/users', { body });
  }

  async adminAuthDeleteUserMfa(id: string): Promise<unknown> {
    return this.transport.request('DELETE', `/api/auth/admin/users/${id}/mfa`);
  }

  async adminAuthSetClaims(id: string, body: unknown): Promise<unknown> {
    return this.transport.request('PUT', `/api/auth/admin/users/${id}/claims`, { body });
  }

  async adminAuthRevokeUserSessions(id: string): Promise<unknown> {
    return this.transport.request('POST', `/api/auth/admin/users/${id}/revoke`);
  }

  async adminAuthImportUsers(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/auth/admin/users/import', { body });
  }

  async databaseLiveBroadcast(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/db/broadcast', { body });
  }

  async executeSql(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/sql', { body });
  }

  async kvOperation(namespace: string, body: unknown): Promise<unknown> {
    return this.transport.request('POST', `/api/kv/${namespace}`, { body });
  }

  async executeD1Query(database: string, body: unknown): Promise<unknown> {
    return this.transport.request('POST', `/api/d1/${database}`, { body });
  }

  async vectorizeOperation(index: string, body: unknown): Promise<unknown> {
    return this.transport.request('POST', `/api/vectorize/${index}`, { body });
  }

  async pushSend(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/push/send', { body });
  }

  async pushSendMany(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/push/send-many', { body });
  }

  async pushSendToToken(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/push/send-to-token', { body });
  }

  async pushSendToTopic(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/push/send-to-topic', { body });
  }

  async pushBroadcast(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/api/push/broadcast', { body });
  }

  async getPushLogs(query: Record<string, string>): Promise<unknown> {
    return this.transport.request('GET', '/api/push/logs', { query });
  }

  async getPushTokens(query: Record<string, string>): Promise<unknown> {
    return this.transport.request('GET', '/api/push/tokens', { query });
  }

  async putPushTokens(body: unknown): Promise<unknown> {
    return this.transport.request('PUT', '/api/push/tokens', { body });
  }

  async patchPushTokens(body: unknown): Promise<unknown> {
    return this.transport.request('PATCH', '/api/push/tokens', { body });
  }

  async queryAnalytics(query: Record<string, string>): Promise<unknown> {
    return this.transport.request('GET', '/api/analytics/query', { query });
  }

  async queryCustomEvents(query: Record<string, string>): Promise<unknown> {
    return this.transport.request('GET', '/api/analytics/events', { query });
  }

  async adminSetupStatus(): Promise<unknown> {
    return this.transport.request('GET', '/admin/api/setup/status');
  }

  async adminSetup(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/admin/api/setup', { body });
  }

  async adminLogin(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/admin/api/auth/login', { body });
  }

  async adminRefresh(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/admin/api/auth/refresh', { body });
  }

  async adminResetPassword(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/admin/api/internal/reset-password', { body });
  }

  async adminListTables(): Promise<unknown> {
    return this.transport.request('GET', '/admin/api/data/tables');
  }

  async adminGetTableRecords(name: string): Promise<unknown> {
    return this.transport.request('GET', `/admin/api/data/tables/${name}/records`);
  }

  async adminCreateTableRecord(name: string, body: unknown): Promise<unknown> {
    return this.transport.request('POST', `/admin/api/data/tables/${name}/records`, { body });
  }

  async adminUpdateTableRecord(name: string, id: string, body: unknown): Promise<unknown> {
    return this.transport.request('PUT', `/admin/api/data/tables/${name}/records/${id}`, { body });
  }

  async adminDeleteTableRecord(name: string, id: string): Promise<unknown> {
    return this.transport.request('DELETE', `/admin/api/data/tables/${name}/records/${id}`);
  }

  async adminListUsers(): Promise<unknown> {
    return this.transport.request('GET', '/admin/api/data/users');
  }

  async adminCreateUser(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/admin/api/data/users', { body });
  }

  async adminGetUser(id: string): Promise<unknown> {
    return this.transport.request('GET', `/admin/api/data/users/${id}`);
  }

  async adminUpdateUser(id: string, body: unknown): Promise<unknown> {
    return this.transport.request('PUT', `/admin/api/data/users/${id}`, { body });
  }

  async adminDeleteUser(id: string): Promise<unknown> {
    return this.transport.request('DELETE', `/admin/api/data/users/${id}`);
  }

  async adminGetUserProfile(id: string): Promise<unknown> {
    return this.transport.request('GET', `/admin/api/data/users/${id}/profile`);
  }

  async adminDeleteUserSessions(id: string): Promise<unknown> {
    return this.transport.request('DELETE', `/admin/api/data/users/${id}/sessions`);
  }

  async adminCleanupAnon(): Promise<unknown> {
    return this.transport.request('POST', '/admin/api/data/cleanup-anon');
  }

  async adminListBuckets(): Promise<unknown> {
    return this.transport.request('GET', '/admin/api/data/storage/buckets');
  }

  async adminListBucketObjects(name: string): Promise<unknown> {
    return this.transport.request('GET', `/admin/api/data/storage/buckets/${name}/objects`);
  }

  async adminGetBucketObject(name: string, key: string): Promise<unknown> {
    return this.transport.request('GET', `/admin/api/data/storage/buckets/${name}/objects/${key}`);
  }

  async adminDeleteBucketObject(name: string, key: string): Promise<unknown> {
    return this.transport.request('DELETE', `/admin/api/data/storage/buckets/${name}/objects/${key}`);
  }

  async adminGetBucketStats(name: string): Promise<unknown> {
    return this.transport.request('GET', `/admin/api/data/storage/buckets/${name}/stats`);
  }

  async adminCreateSignedUrl(name: string, body: unknown): Promise<unknown> {
    return this.transport.request('POST', `/admin/api/data/storage/buckets/${name}/signed-url`, { body });
  }

  async adminGetSchema(): Promise<unknown> {
    return this.transport.request('GET', '/admin/api/data/schema');
  }

  async adminExportTable(name: string): Promise<unknown> {
    return this.transport.request('GET', `/admin/api/data/tables/${name}/export`);
  }

  async adminGetLogs(): Promise<unknown> {
    return this.transport.request('GET', '/admin/api/data/logs');
  }

  async adminGetMonitoring(): Promise<unknown> {
    return this.transport.request('GET', '/admin/api/data/monitoring');
  }

  async adminGetAnalytics(): Promise<unknown> {
    return this.transport.request('GET', '/admin/api/data/analytics');
  }

  async adminGetAnalyticsEvents(): Promise<unknown> {
    return this.transport.request('GET', '/admin/api/data/analytics/events');
  }

  async adminGetOverview(): Promise<unknown> {
    return this.transport.request('GET', '/admin/api/data/overview');
  }

  async adminGetDevInfo(): Promise<unknown> {
    return this.transport.request('GET', '/admin/api/data/dev-info');
  }

  async adminExecuteSql(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/admin/api/data/sql', { body });
  }

  async adminImportTable(name: string, body: unknown): Promise<unknown> {
    return this.transport.request('POST', `/admin/api/data/tables/${name}/import`, { body });
  }

  async adminRulesTest(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/admin/api/data/rules-test', { body });
  }

  async adminListFunctions(): Promise<unknown> {
    return this.transport.request('GET', '/admin/api/data/functions');
  }

  async adminGetConfigInfo(): Promise<unknown> {
    return this.transport.request('GET', '/admin/api/data/config-info');
  }

  async adminGetRecentLogs(): Promise<unknown> {
    return this.transport.request('GET', '/admin/api/data/logs/recent');
  }

  async adminGetAuthSettings(): Promise<unknown> {
    return this.transport.request('GET', '/admin/api/data/auth/settings');
  }

  async adminGetEmailTemplates(): Promise<unknown> {
    return this.transport.request('GET', '/admin/api/data/email/templates');
  }

  async adminDeleteUserMfa(id: string): Promise<unknown> {
    return this.transport.request('DELETE', `/admin/api/data/users/${id}/mfa`);
  }

  async adminSendPasswordReset(id: string): Promise<unknown> {
    return this.transport.request('POST', `/admin/api/data/users/${id}/send-password-reset`);
  }

  async adminUploadFile(name: string, body: unknown): Promise<unknown> {
    return this.transport.request('POST', `/admin/api/data/storage/buckets/${name}/upload`, { body });
  }

  async adminGetPushTokens(): Promise<unknown> {
    return this.transport.request('GET', '/admin/api/data/push/tokens');
  }

  async adminGetPushLogs(): Promise<unknown> {
    return this.transport.request('GET', '/admin/api/data/push/logs');
  }

  async adminTestPushSend(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/admin/api/data/push/test-send', { body });
  }

  async adminBackupListDOs(): Promise<unknown> {
    return this.transport.request('POST', '/admin/api/data/backup/list-dos');
  }

  async adminBackupDumpDO(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/admin/api/data/backup/dump-do', { body });
  }

  async adminBackupRestoreDO(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/admin/api/data/backup/restore-do', { body });
  }

  async adminBackupDumpD1(): Promise<unknown> {
    return this.transport.request('POST', '/admin/api/data/backup/dump-d1');
  }

  async adminBackupRestoreD1(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/admin/api/data/backup/restore-d1', { body });
  }

  async adminBackupGetConfig(): Promise<unknown> {
    return this.transport.request('GET', '/admin/api/data/backup/config');
  }

  async adminListAdmins(): Promise<unknown> {
    return this.transport.request('GET', '/admin/api/data/admins');
  }

  async adminCreateAdmin(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/admin/api/data/admins', { body });
  }

  async adminDeleteAdmin(id: string): Promise<unknown> {
    return this.transport.request('DELETE', `/admin/api/data/admins/${id}`);
  }

  async adminChangePassword(id: string, body: unknown): Promise<unknown> {
    return this.transport.request('PUT', `/admin/api/data/admins/${id}/password`, { body });
  }

  async backupListDOs(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/admin/api/backup/list-dos', { body });
  }

  async backupGetConfig(): Promise<unknown> {
    return this.transport.request('GET', '/admin/api/backup/config');
  }

  async backupCleanupPlugin(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/admin/api/backup/cleanup-plugin', { body });
  }

  async backupWipeDO(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/admin/api/backup/wipe-do', { body });
  }

  async backupDumpDO(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/admin/api/backup/dump-do', { body });
  }

  async backupRestoreDO(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/admin/api/backup/restore-do', { body });
  }

  async backupDumpD1(): Promise<unknown> {
    return this.transport.request('POST', '/admin/api/backup/dump-d1');
  }

  async backupRestoreD1(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/admin/api/backup/restore-d1', { body });
  }

  async backupDumpControlD1(): Promise<unknown> {
    return this.transport.request('POST', '/admin/api/backup/dump-control-d1');
  }

  async backupRestoreControlD1(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/admin/api/backup/restore-control-d1', { body });
  }

  async backupDumpData(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/admin/api/backup/dump-data', { body });
  }

  async backupRestoreData(body: unknown): Promise<unknown> {
    return this.transport.request('POST', '/admin/api/backup/restore-data', { body });
  }

  async backupDumpStorage(query: Record<string, string>): Promise<unknown> {
    return this.transport.request('POST', '/admin/api/backup/dump-storage', { query });
  }

  async backupRestoreStorage(query: Record<string, string>): Promise<unknown> {
    return this.transport.request('POST', '/admin/api/backup/restore-storage', { query });
  }

  async backupResyncUsersPublic(): Promise<unknown> {
    return this.transport.request('POST', '/admin/api/backup/resync-users-public');
  }

  async backupExportTable(name: string, query: Record<string, string>): Promise<unknown> {
    return this.transport.request('GET', `/admin/api/backup/export/${name}`, { query });
  }

}
