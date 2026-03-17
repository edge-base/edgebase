// Auto-generated admin API Core — DO NOT EDIT.
// Regenerate: npx tsx tools/sdk-codegen/generate.ts
// Source: openapi.json (0.1.0)

package edgebase

import (
	"context"
	"fmt"
	"net/url"
)

// GeneratedAdminApi contains auto-generated API methods.
type GeneratedAdminApi struct {
	client *HTTPClient
}

// NewGeneratedAdminApi creates a new instance.
func NewGeneratedAdminApi(client *HTTPClient) *GeneratedAdminApi {
	return &GeneratedAdminApi{client: client}
}

// AdminAuthGetUser — Get user by ID — GET /api/auth/admin/users/{id}
func (a *GeneratedAdminApi) AdminAuthGetUser(ctx context.Context, id string) (map[string]interface{}, error) {
	return a.client.Get(ctx, fmt.Sprintf("/api/auth/admin/users/%s", url.PathEscape(id)))
}

// AdminAuthUpdateUser — Update user by ID — PATCH /api/auth/admin/users/{id}
func (a *GeneratedAdminApi) AdminAuthUpdateUser(ctx context.Context, id string, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "PATCH", fmt.Sprintf("/api/auth/admin/users/%s", url.PathEscape(id)), body)
}

// AdminAuthDeleteUser — Delete user by ID — DELETE /api/auth/admin/users/{id}
func (a *GeneratedAdminApi) AdminAuthDeleteUser(ctx context.Context, id string) (map[string]interface{}, error) {
	return a.client.Delete(ctx, fmt.Sprintf("/api/auth/admin/users/%s", url.PathEscape(id)))
}

// AdminAuthListUsers — List users — GET /api/auth/admin/users
func (a *GeneratedAdminApi) AdminAuthListUsers(ctx context.Context, query map[string]string) (map[string]interface{}, error) {
	return a.client.GetWithQuery(ctx, "/api/auth/admin/users", query)
}

// AdminAuthCreateUser — Create a new user — POST /api/auth/admin/users
func (a *GeneratedAdminApi) AdminAuthCreateUser(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/auth/admin/users", body)
}

// AdminAuthDeleteUserMfa — Delete user MFA — DELETE /api/auth/admin/users/{id}/mfa
func (a *GeneratedAdminApi) AdminAuthDeleteUserMfa(ctx context.Context, id string) (map[string]interface{}, error) {
	return a.client.Delete(ctx, fmt.Sprintf("/api/auth/admin/users/%s/mfa", url.PathEscape(id)))
}

// AdminAuthSetClaims — Set custom claims for user — PUT /api/auth/admin/users/{id}/claims
func (a *GeneratedAdminApi) AdminAuthSetClaims(ctx context.Context, id string, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "PUT", fmt.Sprintf("/api/auth/admin/users/%s/claims", url.PathEscape(id)), body)
}

// AdminAuthRevokeUserSessions — Revoke all sessions for user — POST /api/auth/admin/users/{id}/revoke
func (a *GeneratedAdminApi) AdminAuthRevokeUserSessions(ctx context.Context, id string) (map[string]interface{}, error) {
	return a.client.Post(ctx, fmt.Sprintf("/api/auth/admin/users/%s/revoke", url.PathEscape(id)), nil)
}

// AdminAuthImportUsers — Batch import users — POST /api/auth/admin/users/import
func (a *GeneratedAdminApi) AdminAuthImportUsers(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/auth/admin/users/import", body)
}

// DatabaseLiveBroadcast — Broadcast to database live channel — POST /api/db/broadcast
func (a *GeneratedAdminApi) DatabaseLiveBroadcast(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/db/broadcast", body)
}

// ExecuteSql — Execute SQL via DatabaseDO — POST /api/sql
func (a *GeneratedAdminApi) ExecuteSql(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/sql", body)
}

// KvOperation — Execute KV operation — POST /api/kv/{namespace}
func (a *GeneratedAdminApi) KvOperation(ctx context.Context, namespace string, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", fmt.Sprintf("/api/kv/%s", url.PathEscape(namespace)), body)
}

// ExecuteD1Query — Execute raw SQL on D1 database — POST /api/d1/{database}
func (a *GeneratedAdminApi) ExecuteD1Query(ctx context.Context, database string, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", fmt.Sprintf("/api/d1/%s", url.PathEscape(database)), body)
}

// VectorizeOperation — Execute Vectorize operation — POST /api/vectorize/{index}
func (a *GeneratedAdminApi) VectorizeOperation(ctx context.Context, index string, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", fmt.Sprintf("/api/vectorize/%s", url.PathEscape(index)), body)
}

// PushSend — Send push notification to user — POST /api/push/send
func (a *GeneratedAdminApi) PushSend(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/push/send", body)
}

// PushSendMany — Send push to multiple users — POST /api/push/send-many
func (a *GeneratedAdminApi) PushSendMany(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/push/send-many", body)
}

// PushSendToToken — Send push to specific token — POST /api/push/send-to-token
func (a *GeneratedAdminApi) PushSendToToken(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/push/send-to-token", body)
}

// PushSendToTopic — Send push to topic — POST /api/push/send-to-topic
func (a *GeneratedAdminApi) PushSendToTopic(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/push/send-to-topic", body)
}

// PushBroadcast — Broadcast push to all devices — POST /api/push/broadcast
func (a *GeneratedAdminApi) PushBroadcast(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/push/broadcast", body)
}

// GetPushLogs — Get push notification logs — GET /api/push/logs
func (a *GeneratedAdminApi) GetPushLogs(ctx context.Context, query map[string]string) (map[string]interface{}, error) {
	return a.client.GetWithQuery(ctx, "/api/push/logs", query)
}

// GetPushTokens — Get registered push tokens — GET /api/push/tokens
func (a *GeneratedAdminApi) GetPushTokens(ctx context.Context, query map[string]string) (map[string]interface{}, error) {
	return a.client.GetWithQuery(ctx, "/api/push/tokens", query)
}

// PutPushTokens — Upsert a device token — PUT /api/push/tokens
func (a *GeneratedAdminApi) PutPushTokens(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "PUT", "/api/push/tokens", body)
}

// PatchPushTokens — Update device metadata — PATCH /api/push/tokens
func (a *GeneratedAdminApi) PatchPushTokens(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "PATCH", "/api/push/tokens", body)
}

// QueryAnalytics — Query request log metrics — GET /api/analytics/query
func (a *GeneratedAdminApi) QueryAnalytics(ctx context.Context, query map[string]string) (map[string]interface{}, error) {
	return a.client.GetWithQuery(ctx, "/api/analytics/query", query)
}

// QueryCustomEvents — Query custom events — GET /api/analytics/events
func (a *GeneratedAdminApi) QueryCustomEvents(ctx context.Context, query map[string]string) (map[string]interface{}, error) {
	return a.client.GetWithQuery(ctx, "/api/analytics/events", query)
}

// AdminSetupStatus — Check if admin setup is needed — GET /admin/api/setup/status
func (a *GeneratedAdminApi) AdminSetupStatus(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Get(ctx, "/admin/api/setup/status")
}

// AdminSetup — Create the first admin account — POST /admin/api/setup
func (a *GeneratedAdminApi) AdminSetup(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/admin/api/setup", body)
}

// AdminLogin — Admin login — POST /admin/api/auth/login
func (a *GeneratedAdminApi) AdminLogin(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/admin/api/auth/login", body)
}

// AdminRefresh — Rotate admin token — POST /admin/api/auth/refresh
func (a *GeneratedAdminApi) AdminRefresh(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/admin/api/auth/refresh", body)
}

// AdminResetPassword — Reset admin password (Service Key required) — POST /admin/api/internal/reset-password
func (a *GeneratedAdminApi) AdminResetPassword(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/admin/api/internal/reset-password", body)
}

// AdminListTables — List all tables from config — GET /admin/api/data/tables
func (a *GeneratedAdminApi) AdminListTables(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Get(ctx, "/admin/api/data/tables")
}

// AdminGetTableRecords — List table records with pagination — GET /admin/api/data/tables/{name}/records
func (a *GeneratedAdminApi) AdminGetTableRecords(ctx context.Context, name string) (map[string]interface{}, error) {
	return a.client.Get(ctx, fmt.Sprintf("/admin/api/data/tables/%s/records", url.PathEscape(name)))
}

// AdminCreateTableRecord — Create a table record — POST /admin/api/data/tables/{name}/records
func (a *GeneratedAdminApi) AdminCreateTableRecord(ctx context.Context, name string, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", fmt.Sprintf("/admin/api/data/tables/%s/records", url.PathEscape(name)), body)
}

// AdminUpdateTableRecord — Update a table record — PUT /admin/api/data/tables/{name}/records/{id}
func (a *GeneratedAdminApi) AdminUpdateTableRecord(ctx context.Context, name string, id string, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "PUT", fmt.Sprintf("/admin/api/data/tables/%s/records/%s", url.PathEscape(name), url.PathEscape(id)), body)
}

// AdminDeleteTableRecord — Delete a table record — DELETE /admin/api/data/tables/{name}/records/{id}
func (a *GeneratedAdminApi) AdminDeleteTableRecord(ctx context.Context, name string, id string) (map[string]interface{}, error) {
	return a.client.Delete(ctx, fmt.Sprintf("/admin/api/data/tables/%s/records/%s", url.PathEscape(name), url.PathEscape(id)))
}

// AdminListUsers — List users via D1 index — GET /admin/api/data/users
func (a *GeneratedAdminApi) AdminListUsers(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Get(ctx, "/admin/api/data/users")
}

// AdminCreateUser — Create a new user — POST /admin/api/data/users
func (a *GeneratedAdminApi) AdminCreateUser(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/admin/api/data/users", body)
}

// AdminGetUser — Fetch a single user by ID — GET /admin/api/data/users/{id}
func (a *GeneratedAdminApi) AdminGetUser(ctx context.Context, id string) (map[string]interface{}, error) {
	return a.client.Get(ctx, fmt.Sprintf("/admin/api/data/users/%s", url.PathEscape(id)))
}

// AdminUpdateUser — Update user status or role — PUT /admin/api/data/users/{id}
func (a *GeneratedAdminApi) AdminUpdateUser(ctx context.Context, id string, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "PUT", fmt.Sprintf("/admin/api/data/users/%s", url.PathEscape(id)), body)
}

// AdminDeleteUser — Delete a user completely — DELETE /admin/api/data/users/{id}
func (a *GeneratedAdminApi) AdminDeleteUser(ctx context.Context, id string) (map[string]interface{}, error) {
	return a.client.Delete(ctx, fmt.Sprintf("/admin/api/data/users/%s", url.PathEscape(id)))
}

// AdminGetUserProfile — Fetch user profile with cache — GET /admin/api/data/users/{id}/profile
func (a *GeneratedAdminApi) AdminGetUserProfile(ctx context.Context, id string) (map[string]interface{}, error) {
	return a.client.Get(ctx, fmt.Sprintf("/admin/api/data/users/%s/profile", url.PathEscape(id)))
}

// AdminDeleteUserSessions — Revoke all user sessions — DELETE /admin/api/data/users/{id}/sessions
func (a *GeneratedAdminApi) AdminDeleteUserSessions(ctx context.Context, id string) (map[string]interface{}, error) {
	return a.client.Delete(ctx, fmt.Sprintf("/admin/api/data/users/%s/sessions", url.PathEscape(id)))
}

// AdminCleanupAnon — Cleanup anonymous user index — POST /admin/api/data/cleanup-anon
func (a *GeneratedAdminApi) AdminCleanupAnon(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Post(ctx, "/admin/api/data/cleanup-anon", nil)
}

// AdminListBuckets — List configured storage buckets — GET /admin/api/data/storage/buckets
func (a *GeneratedAdminApi) AdminListBuckets(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Get(ctx, "/admin/api/data/storage/buckets")
}

// AdminListBucketObjects — List objects in a storage bucket — GET /admin/api/data/storage/buckets/{name}/objects
func (a *GeneratedAdminApi) AdminListBucketObjects(ctx context.Context, name string) (map[string]interface{}, error) {
	return a.client.Get(ctx, fmt.Sprintf("/admin/api/data/storage/buckets/%s/objects", url.PathEscape(name)))
}

// AdminGetBucketObject — Get a storage object content — GET /admin/api/data/storage/buckets/{name}/objects/{key}
func (a *GeneratedAdminApi) AdminGetBucketObject(ctx context.Context, name string, key string) (map[string]interface{}, error) {
	return a.client.Get(ctx, fmt.Sprintf("/admin/api/data/storage/buckets/%s/objects/%s", url.PathEscape(name), url.PathEscape(key)))
}

// AdminDeleteBucketObject — Delete a storage object — DELETE /admin/api/data/storage/buckets/{name}/objects/{key}
func (a *GeneratedAdminApi) AdminDeleteBucketObject(ctx context.Context, name string, key string) (map[string]interface{}, error) {
	return a.client.Delete(ctx, fmt.Sprintf("/admin/api/data/storage/buckets/%s/objects/%s", url.PathEscape(name), url.PathEscape(key)))
}

// AdminGetBucketStats — Get bucket statistics (total objects and size) — GET /admin/api/data/storage/buckets/{name}/stats
func (a *GeneratedAdminApi) AdminGetBucketStats(ctx context.Context, name string) (map[string]interface{}, error) {
	return a.client.Get(ctx, fmt.Sprintf("/admin/api/data/storage/buckets/%s/stats", url.PathEscape(name)))
}

// AdminCreateSignedUrl — Create a signed download URL for a storage object — POST /admin/api/data/storage/buckets/{name}/signed-url
func (a *GeneratedAdminApi) AdminCreateSignedUrl(ctx context.Context, name string, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", fmt.Sprintf("/admin/api/data/storage/buckets/%s/signed-url", url.PathEscape(name)), body)
}

// AdminGetSchema — Get full schema structure from config — GET /admin/api/data/schema
func (a *GeneratedAdminApi) AdminGetSchema(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Get(ctx, "/admin/api/data/schema")
}

// AdminExportTable — Export table data as JSON — GET /admin/api/data/tables/{name}/export
func (a *GeneratedAdminApi) AdminExportTable(ctx context.Context, name string) (map[string]interface{}, error) {
	return a.client.Get(ctx, fmt.Sprintf("/admin/api/data/tables/%s/export", url.PathEscape(name)))
}

// AdminGetLogs — Get request logs — GET /admin/api/data/logs
func (a *GeneratedAdminApi) AdminGetLogs(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Get(ctx, "/admin/api/data/logs")
}

// AdminGetMonitoring — Get realtime monitoring stats — GET /admin/api/data/monitoring
func (a *GeneratedAdminApi) AdminGetMonitoring(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Get(ctx, "/admin/api/data/monitoring")
}

// AdminGetAnalytics — Get analytics dashboard data — GET /admin/api/data/analytics
func (a *GeneratedAdminApi) AdminGetAnalytics(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Get(ctx, "/admin/api/data/analytics")
}

// AdminGetAnalyticsEvents — Query analytics events for admin dashboard — GET /admin/api/data/analytics/events
func (a *GeneratedAdminApi) AdminGetAnalyticsEvents(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Get(ctx, "/admin/api/data/analytics/events")
}

// AdminGetOverview — Get project overview for dashboard home — GET /admin/api/data/overview
func (a *GeneratedAdminApi) AdminGetOverview(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Get(ctx, "/admin/api/data/overview")
}

// AdminGetDevInfo — Get dev mode status and sidecar port — GET /admin/api/data/dev-info
func (a *GeneratedAdminApi) AdminGetDevInfo(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Get(ctx, "/admin/api/data/dev-info")
}

// AdminExecuteSql — Execute raw SQL query — POST /admin/api/data/sql
func (a *GeneratedAdminApi) AdminExecuteSql(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/admin/api/data/sql", body)
}

// AdminImportTable — Batch import records into a table — POST /admin/api/data/tables/{name}/import
func (a *GeneratedAdminApi) AdminImportTable(ctx context.Context, name string, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", fmt.Sprintf("/admin/api/data/tables/%s/import", url.PathEscape(name)), body)
}

// AdminRulesTest — Evaluate access rules with simulated auth context — POST /admin/api/data/rules-test
func (a *GeneratedAdminApi) AdminRulesTest(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/admin/api/data/rules-test", body)
}

// AdminListFunctions — List registered functions from config — GET /admin/api/data/functions
func (a *GeneratedAdminApi) AdminListFunctions(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Get(ctx, "/admin/api/data/functions")
}

// AdminGetConfigInfo — Get environment and config overview — GET /admin/api/data/config-info
func (a *GeneratedAdminApi) AdminGetConfigInfo(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Get(ctx, "/admin/api/data/config-info")
}

// AdminGetRecentLogs — Get recent request logs with filtering — GET /admin/api/data/logs/recent
func (a *GeneratedAdminApi) AdminGetRecentLogs(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Get(ctx, "/admin/api/data/logs/recent")
}

// AdminGetAuthSettings — Get OAuth provider config — GET /admin/api/data/auth/settings
func (a *GeneratedAdminApi) AdminGetAuthSettings(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Get(ctx, "/admin/api/data/auth/settings")
}

// AdminGetEmailTemplates — Get email template and subject config — GET /admin/api/data/email/templates
func (a *GeneratedAdminApi) AdminGetEmailTemplates(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Get(ctx, "/admin/api/data/email/templates")
}

// AdminDeleteUserMfa — Disable MFA for a user — DELETE /admin/api/data/users/{id}/mfa
func (a *GeneratedAdminApi) AdminDeleteUserMfa(ctx context.Context, id string) (map[string]interface{}, error) {
	return a.client.Delete(ctx, fmt.Sprintf("/admin/api/data/users/%s/mfa", url.PathEscape(id)))
}

// AdminSendPasswordReset — Send password reset email for a user — POST /admin/api/data/users/{id}/send-password-reset
func (a *GeneratedAdminApi) AdminSendPasswordReset(ctx context.Context, id string) (map[string]interface{}, error) {
	return a.client.Post(ctx, fmt.Sprintf("/admin/api/data/users/%s/send-password-reset", url.PathEscape(id)), nil)
}

// AdminUploadFile — Upload file to R2 storage — POST /admin/api/data/storage/buckets/{name}/upload
func (a *GeneratedAdminApi) AdminUploadFile(ctx context.Context, name string, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", fmt.Sprintf("/admin/api/data/storage/buckets/%s/upload", url.PathEscape(name)), body)
}

// AdminGetPushTokens — List push tokens for a user — GET /admin/api/data/push/tokens
func (a *GeneratedAdminApi) AdminGetPushTokens(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Get(ctx, "/admin/api/data/push/tokens")
}

// AdminGetPushLogs — Get push notification logs — GET /admin/api/data/push/logs
func (a *GeneratedAdminApi) AdminGetPushLogs(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Get(ctx, "/admin/api/data/push/logs")
}

// AdminTestPushSend — Test send push notification — POST /admin/api/data/push/test-send
func (a *GeneratedAdminApi) AdminTestPushSend(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/admin/api/data/push/test-send", body)
}

// AdminBackupListDOs — List Durable Objects for backup — POST /admin/api/data/backup/list-dos
func (a *GeneratedAdminApi) AdminBackupListDOs(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Post(ctx, "/admin/api/data/backup/list-dos", nil)
}

// AdminBackupDumpDO — Dump a Durable Object for backup — POST /admin/api/data/backup/dump-do
func (a *GeneratedAdminApi) AdminBackupDumpDO(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/admin/api/data/backup/dump-do", body)
}

// AdminBackupRestoreDO — Restore a Durable Object from backup — POST /admin/api/data/backup/restore-do
func (a *GeneratedAdminApi) AdminBackupRestoreDO(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/admin/api/data/backup/restore-do", body)
}

// AdminBackupDumpD1 — Dump D1 database for backup — POST /admin/api/data/backup/dump-d1
func (a *GeneratedAdminApi) AdminBackupDumpD1(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Post(ctx, "/admin/api/data/backup/dump-d1", nil)
}

// AdminBackupRestoreD1 — Restore D1 database from backup — POST /admin/api/data/backup/restore-d1
func (a *GeneratedAdminApi) AdminBackupRestoreD1(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/admin/api/data/backup/restore-d1", body)
}

// AdminBackupGetConfig — Get backup config — GET /admin/api/data/backup/config
func (a *GeneratedAdminApi) AdminBackupGetConfig(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Get(ctx, "/admin/api/data/backup/config")
}

// AdminListAdmins — List admin accounts — GET /admin/api/data/admins
func (a *GeneratedAdminApi) AdminListAdmins(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Get(ctx, "/admin/api/data/admins")
}

// AdminCreateAdmin — Create an admin account — POST /admin/api/data/admins
func (a *GeneratedAdminApi) AdminCreateAdmin(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/admin/api/data/admins", body)
}

// AdminDeleteAdmin — Delete an admin account — DELETE /admin/api/data/admins/{id}
func (a *GeneratedAdminApi) AdminDeleteAdmin(ctx context.Context, id string) (map[string]interface{}, error) {
	return a.client.Delete(ctx, fmt.Sprintf("/admin/api/data/admins/%s", url.PathEscape(id)))
}

// AdminChangePassword — Change admin password — PUT /admin/api/data/admins/{id}/password
func (a *GeneratedAdminApi) AdminChangePassword(ctx context.Context, id string, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "PUT", fmt.Sprintf("/admin/api/data/admins/%s/password", url.PathEscape(id)), body)
}

// BackupListDOs — List all DO instances — POST /admin/api/backup/list-dos
func (a *GeneratedAdminApi) BackupListDOs(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/admin/api/backup/list-dos", body)
}

// BackupGetConfig — Return parsed config snapshot — GET /admin/api/backup/config
func (a *GeneratedAdminApi) BackupGetConfig(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Get(ctx, "/admin/api/backup/config")
}

// BackupCleanupPlugin — Remove plugin-prefixed tables and migration metadata — POST /admin/api/backup/cleanup-plugin
func (a *GeneratedAdminApi) BackupCleanupPlugin(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/admin/api/backup/cleanup-plugin", body)
}

// BackupWipeDO — Wipe a specific DO's data — POST /admin/api/backup/wipe-do
func (a *GeneratedAdminApi) BackupWipeDO(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/admin/api/backup/wipe-do", body)
}

// BackupDumpDO — Dump a specific DO's data — POST /admin/api/backup/dump-do
func (a *GeneratedAdminApi) BackupDumpDO(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/admin/api/backup/dump-do", body)
}

// BackupRestoreDO — Restore a specific DO's data — POST /admin/api/backup/restore-do
func (a *GeneratedAdminApi) BackupRestoreDO(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/admin/api/backup/restore-do", body)
}

// BackupDumpD1 — Dump auth database tables — POST /admin/api/backup/dump-d1
func (a *GeneratedAdminApi) BackupDumpD1(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Post(ctx, "/admin/api/backup/dump-d1", nil)
}

// BackupRestoreD1 — Restore auth database tables — POST /admin/api/backup/restore-d1
func (a *GeneratedAdminApi) BackupRestoreD1(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/admin/api/backup/restore-d1", body)
}

// BackupDumpControlD1 — Dump control-plane D1 tables — POST /admin/api/backup/dump-control-d1
func (a *GeneratedAdminApi) BackupDumpControlD1(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Post(ctx, "/admin/api/backup/dump-control-d1", nil)
}

// BackupRestoreControlD1 — Restore control-plane D1 tables — POST /admin/api/backup/restore-control-d1
func (a *GeneratedAdminApi) BackupRestoreControlD1(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/admin/api/backup/restore-control-d1", body)
}

// BackupDumpData — Dump all tables from a data namespace — POST /admin/api/backup/dump-data
func (a *GeneratedAdminApi) BackupDumpData(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/admin/api/backup/dump-data", body)
}

// BackupRestoreData — Restore all tables into a data namespace — POST /admin/api/backup/restore-data
func (a *GeneratedAdminApi) BackupRestoreData(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/admin/api/backup/restore-data", body)
}

// BackupDumpStorage — Dump R2 storage (list or download) — POST /admin/api/backup/dump-storage
func (a *GeneratedAdminApi) BackupDumpStorage(ctx context.Context, query map[string]string) (map[string]interface{}, error) {
	return a.client.GetWithQuery(ctx, "/admin/api/backup/dump-storage", query)
}

// BackupRestoreStorage — Restore R2 storage (wipe or upload) — POST /admin/api/backup/restore-storage
func (a *GeneratedAdminApi) BackupRestoreStorage(ctx context.Context, query map[string]string) (map[string]interface{}, error) {
	return a.client.GetWithQuery(ctx, "/admin/api/backup/restore-storage", query)
}

// BackupResyncUsersPublic — Resync _users_public from _users in AUTH_DB D1 — POST /admin/api/backup/resync-users-public
func (a *GeneratedAdminApi) BackupResyncUsersPublic(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Post(ctx, "/admin/api/backup/resync-users-public", nil)
}

// BackupExportTable — Export a single table as JSON — GET /admin/api/backup/export/{name}
func (a *GeneratedAdminApi) BackupExportTable(ctx context.Context, name string, query map[string]string) (map[string]interface{}, error) {
	return a.client.GetWithQuery(ctx, fmt.Sprintf("/admin/api/backup/export/%s", url.PathEscape(name)), query)
}
