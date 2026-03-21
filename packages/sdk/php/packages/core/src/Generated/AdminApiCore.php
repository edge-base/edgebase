<?php

// Auto-generated admin API Core — DO NOT EDIT.
// Regenerate: npx tsx tools/sdk-codegen/generate.ts
// Source: openapi.json (0.1.0)

declare(strict_types=1);

namespace EdgeBase\Core\Generated;

use EdgeBase\Core\HttpClient;

/**
 * Auto-generated API methods.
 */
class GeneratedAdminApi
{
    private HttpClient $http;

    public function __construct(HttpClient $http)
    {
        $this->http = $http;
    }

    /** Get user by ID — GET /api/auth/admin/users/{id} */
    public function admin_auth_get_user(string $id): mixed
    {
        return $this->http->get('/auth/admin/users/' . rawurlencode($id));
    }

    /** Update user by ID — PATCH /api/auth/admin/users/{id} */
    public function admin_auth_update_user(string $id, mixed $body = null): mixed
    {
        return $this->http->patch('/auth/admin/users/' . rawurlencode($id), $body);
    }

    /** Delete user by ID — DELETE /api/auth/admin/users/{id} */
    public function admin_auth_delete_user(string $id): mixed
    {
        return $this->http->delete('/auth/admin/users/' . rawurlencode($id));
    }

    /** List users — GET /api/auth/admin/users */
    public function admin_auth_list_users(array $query = []): mixed
    {
        return $this->http->get('/auth/admin/users', $query);
    }

    /** Create a new user — POST /api/auth/admin/users */
    public function admin_auth_create_user(mixed $body = null): mixed
    {
        return $this->http->post('/auth/admin/users', $body);
    }

    /** Delete user MFA — DELETE /api/auth/admin/users/{id}/mfa */
    public function admin_auth_delete_user_mfa(string $id): mixed
    {
        return $this->http->delete('/auth/admin/users/' . rawurlencode($id) . '/mfa');
    }

    /** Set custom claims for user — PUT /api/auth/admin/users/{id}/claims */
    public function admin_auth_set_claims(string $id, mixed $body = null): mixed
    {
        return $this->http->put('/auth/admin/users/' . rawurlencode($id) . '/claims', $body);
    }

    /** Revoke all sessions for user — POST /api/auth/admin/users/{id}/revoke */
    public function admin_auth_revoke_user_sessions(string $id): mixed
    {
        return $this->http->post('/auth/admin/users/' . rawurlencode($id) . '/revoke');
    }

    /** Batch import users — POST /api/auth/admin/users/import */
    public function admin_auth_import_users(mixed $body = null): mixed
    {
        return $this->http->post('/auth/admin/users/import', $body);
    }

    /** Broadcast to database live channel — POST /api/db/broadcast */
    public function database_live_broadcast(mixed $body = null): mixed
    {
        return $this->http->post('/db/broadcast', $body);
    }

    /** Execute SQL via DatabaseDO — POST /api/sql */
    public function execute_sql(mixed $body = null): mixed
    {
        return $this->http->post('/sql', $body);
    }

    /** Execute KV operation — POST /api/kv/{namespace} */
    public function kv_operation(string $namespace, mixed $body = null): mixed
    {
        return $this->http->post('/kv/' . rawurlencode($namespace), $body);
    }

    /** Execute raw SQL on D1 database — POST /api/d1/{database} */
    public function execute_d1_query(string $database, mixed $body = null): mixed
    {
        return $this->http->post('/d1/' . rawurlencode($database), $body);
    }

    /** Execute Vectorize operation — POST /api/vectorize/{index} */
    public function vectorize_operation(string $index, mixed $body = null): mixed
    {
        return $this->http->post('/vectorize/' . rawurlencode($index), $body);
    }

    /** Send push notification to user — POST /api/push/send */
    public function push_send(mixed $body = null): mixed
    {
        return $this->http->post('/push/send', $body);
    }

    /** Send push to multiple users — POST /api/push/send-many */
    public function push_send_many(mixed $body = null): mixed
    {
        return $this->http->post('/push/send-many', $body);
    }

    /** Send push to specific token — POST /api/push/send-to-token */
    public function push_send_to_token(mixed $body = null): mixed
    {
        return $this->http->post('/push/send-to-token', $body);
    }

    /** Send push to topic — POST /api/push/send-to-topic */
    public function push_send_to_topic(mixed $body = null): mixed
    {
        return $this->http->post('/push/send-to-topic', $body);
    }

    /** Broadcast push to all devices — POST /api/push/broadcast */
    public function push_broadcast(mixed $body = null): mixed
    {
        return $this->http->post('/push/broadcast', $body);
    }

    /** Get push notification logs — GET /api/push/logs */
    public function get_push_logs(array $query = []): mixed
    {
        return $this->http->get('/push/logs', $query);
    }

    /** Get registered push tokens — GET /api/push/tokens */
    public function get_push_tokens(array $query = []): mixed
    {
        return $this->http->get('/push/tokens', $query);
    }

    /** Upsert a device token — PUT /api/push/tokens */
    public function put_push_tokens(mixed $body = null): mixed
    {
        return $this->http->put('/push/tokens', $body);
    }

    /** Update device metadata — PATCH /api/push/tokens */
    public function patch_push_tokens(mixed $body = null): mixed
    {
        return $this->http->patch('/push/tokens', $body);
    }

    /** Query request log metrics — GET /api/analytics/query */
    public function query_analytics(array $query = []): mixed
    {
        return $this->http->get('/analytics/query', $query);
    }

    /** Query custom events — GET /api/analytics/events */
    public function query_custom_events(array $query = []): mixed
    {
        return $this->http->get('/analytics/events', $query);
    }

    /** Check if admin setup is needed — GET /admin/api/setup/status */
    public function admin_setup_status(): mixed
    {
        return $this->http->get('/admin/api/setup/status');
    }

    /** Create the first admin account — POST /admin/api/setup */
    public function admin_setup(mixed $body = null): mixed
    {
        return $this->http->post('/admin/api/setup', $body);
    }

    /** Admin login — POST /admin/api/auth/login */
    public function admin_login(mixed $body = null): mixed
    {
        return $this->http->post('/admin/api/auth/login', $body);
    }

    /** Rotate admin token — POST /admin/api/auth/refresh */
    public function admin_refresh(mixed $body = null): mixed
    {
        return $this->http->post('/admin/api/auth/refresh', $body);
    }

    /** Reset admin password (Service Key required) — POST /admin/api/internal/reset-password */
    public function admin_reset_password(mixed $body = null): mixed
    {
        return $this->http->post('/admin/api/internal/reset-password', $body);
    }

    /** List all tables from config — GET /admin/api/data/tables */
    public function admin_list_tables(): mixed
    {
        return $this->http->get('/admin/api/data/tables');
    }

    /** List table records with pagination — GET /admin/api/data/tables/{name}/records */
    public function admin_get_table_records(string $name): mixed
    {
        return $this->http->get('/admin/api/data/tables/' . rawurlencode($name) . '/records');
    }

    /** Create a table record — POST /admin/api/data/tables/{name}/records */
    public function admin_create_table_record(string $name, mixed $body = null): mixed
    {
        return $this->http->post('/admin/api/data/tables/' . rawurlencode($name) . '/records', $body);
    }

    /** Update a table record — PUT /admin/api/data/tables/{name}/records/{id} */
    public function admin_update_table_record(string $name, string $id, mixed $body = null): mixed
    {
        return $this->http->put('/admin/api/data/tables/' . rawurlencode($name) . '/records/' . rawurlencode($id), $body);
    }

    /** Delete a table record — DELETE /admin/api/data/tables/{name}/records/{id} */
    public function admin_delete_table_record(string $name, string $id): mixed
    {
        return $this->http->delete('/admin/api/data/tables/' . rawurlencode($name) . '/records/' . rawurlencode($id));
    }

    /** List users via D1 index — GET /admin/api/data/users */
    public function admin_list_users(): mixed
    {
        return $this->http->get('/admin/api/data/users');
    }

    /** Create a new user — POST /admin/api/data/users */
    public function admin_create_user(mixed $body = null): mixed
    {
        return $this->http->post('/admin/api/data/users', $body);
    }

    /** Fetch a single user by ID — GET /admin/api/data/users/{id} */
    public function admin_get_user(string $id): mixed
    {
        return $this->http->get('/admin/api/data/users/' . rawurlencode($id));
    }

    /** Update user status or role — PUT /admin/api/data/users/{id} */
    public function admin_update_user(string $id, mixed $body = null): mixed
    {
        return $this->http->put('/admin/api/data/users/' . rawurlencode($id), $body);
    }

    /** Delete a user completely — DELETE /admin/api/data/users/{id} */
    public function admin_delete_user(string $id): mixed
    {
        return $this->http->delete('/admin/api/data/users/' . rawurlencode($id));
    }

    /** Fetch user profile with cache — GET /admin/api/data/users/{id}/profile */
    public function admin_get_user_profile(string $id): mixed
    {
        return $this->http->get('/admin/api/data/users/' . rawurlencode($id) . '/profile');
    }

    /** Revoke all user sessions — DELETE /admin/api/data/users/{id}/sessions */
    public function admin_delete_user_sessions(string $id): mixed
    {
        return $this->http->delete('/admin/api/data/users/' . rawurlencode($id) . '/sessions');
    }

    /** Cleanup anonymous user index — POST /admin/api/data/cleanup-anon */
    public function admin_cleanup_anon(): mixed
    {
        return $this->http->post('/admin/api/data/cleanup-anon');
    }

    /** List configured storage buckets — GET /admin/api/data/storage/buckets */
    public function admin_list_buckets(): mixed
    {
        return $this->http->get('/admin/api/data/storage/buckets');
    }

    /** List objects in a storage bucket — GET /admin/api/data/storage/buckets/{name}/objects */
    public function admin_list_bucket_objects(string $name): mixed
    {
        return $this->http->get('/admin/api/data/storage/buckets/' . rawurlencode($name) . '/objects');
    }

    /** Get a storage object content — GET /admin/api/data/storage/buckets/{name}/objects/{key} */
    public function admin_get_bucket_object(string $name, string $key): mixed
    {
        return $this->http->get('/admin/api/data/storage/buckets/' . rawurlencode($name) . '/objects/' . rawurlencode($key));
    }

    /** Delete a storage object — DELETE /admin/api/data/storage/buckets/{name}/objects/{key} */
    public function admin_delete_bucket_object(string $name, string $key): mixed
    {
        return $this->http->delete('/admin/api/data/storage/buckets/' . rawurlencode($name) . '/objects/' . rawurlencode($key));
    }

    /** Get bucket statistics (total objects and size) — GET /admin/api/data/storage/buckets/{name}/stats */
    public function admin_get_bucket_stats(string $name): mixed
    {
        return $this->http->get('/admin/api/data/storage/buckets/' . rawurlencode($name) . '/stats');
    }

    /** Create a signed download URL for a storage object — POST /admin/api/data/storage/buckets/{name}/signed-url */
    public function admin_create_signed_url(string $name, mixed $body = null): mixed
    {
        return $this->http->post('/admin/api/data/storage/buckets/' . rawurlencode($name) . '/signed-url', $body);
    }

    /** Get full schema structure from config — GET /admin/api/data/schema */
    public function admin_get_schema(): mixed
    {
        return $this->http->get('/admin/api/data/schema');
    }

    /** List instance suggestions for a dynamic namespace — GET /admin/api/data/namespaces/{namespace}/instances */
    public function admin_list_namespace_instances(string $namespace, array $query = []): mixed
    {
        return $this->http->get('/admin/api/data/namespaces/' . rawurlencode($namespace) . '/instances', $query);
    }

    /** Export table data as JSON — GET /admin/api/data/tables/{name}/export */
    public function admin_export_table(string $name): mixed
    {
        return $this->http->get('/admin/api/data/tables/' . rawurlencode($name) . '/export');
    }

    /** Get request logs — GET /admin/api/data/logs */
    public function admin_get_logs(): mixed
    {
        return $this->http->get('/admin/api/data/logs');
    }

    /** Get live monitoring stats — GET /admin/api/data/monitoring */
    public function admin_get_monitoring(): mixed
    {
        return $this->http->get('/admin/api/data/monitoring');
    }

    /** Get analytics dashboard data — GET /admin/api/data/analytics */
    public function admin_get_analytics(array $query = []): mixed
    {
        return $this->http->get('/admin/api/data/analytics', $query);
    }

    /** Query analytics events for admin dashboard — GET /admin/api/data/analytics/events */
    public function admin_get_analytics_events(): mixed
    {
        return $this->http->get('/admin/api/data/analytics/events');
    }

    /** Get project overview for dashboard home — GET /admin/api/data/overview */
    public function admin_get_overview(array $query = []): mixed
    {
        return $this->http->get('/admin/api/data/overview', $query);
    }

    /** Get dev mode status and sidecar port — GET /admin/api/data/dev-info */
    public function admin_get_dev_info(): mixed
    {
        return $this->http->get('/admin/api/data/dev-info');
    }

    /** Execute raw SQL query — POST /admin/api/data/sql */
    public function admin_execute_sql(mixed $body = null): mixed
    {
        return $this->http->post('/admin/api/data/sql', $body);
    }

    /** Batch import records into a table — POST /admin/api/data/tables/{name}/import */
    public function admin_import_table(string $name, mixed $body = null): mixed
    {
        return $this->http->post('/admin/api/data/tables/' . rawurlencode($name) . '/import', $body);
    }

    /** Evaluate access rules with simulated auth context — POST /admin/api/data/rules-test */
    public function admin_rules_test(mixed $body = null): mixed
    {
        return $this->http->post('/admin/api/data/rules-test', $body);
    }

    /** List registered functions from config — GET /admin/api/data/functions */
    public function admin_list_functions(): mixed
    {
        return $this->http->get('/admin/api/data/functions');
    }

    /** Get environment and config overview — GET /admin/api/data/config-info */
    public function admin_get_config_info(): mixed
    {
        return $this->http->get('/admin/api/data/config-info');
    }

    /** Get recent request logs with filtering — GET /admin/api/data/logs/recent */
    public function admin_get_recent_logs(): mixed
    {
        return $this->http->get('/admin/api/data/logs/recent');
    }

    /** Get OAuth provider config — GET /admin/api/data/auth/settings */
    public function admin_get_auth_settings(): mixed
    {
        return $this->http->get('/admin/api/data/auth/settings');
    }

    /** Get email template and subject config — GET /admin/api/data/email/templates */
    public function admin_get_email_templates(): mixed
    {
        return $this->http->get('/admin/api/data/email/templates');
    }

    /** Disable MFA for a user — DELETE /admin/api/data/users/{id}/mfa */
    public function admin_delete_user_mfa(string $id): mixed
    {
        return $this->http->delete('/admin/api/data/users/' . rawurlencode($id) . '/mfa');
    }

    /** Send password reset email for a user — POST /admin/api/data/users/{id}/send-password-reset */
    public function admin_send_password_reset(string $id): mixed
    {
        return $this->http->post('/admin/api/data/users/' . rawurlencode($id) . '/send-password-reset');
    }

    /** Upload file to R2 storage — POST /admin/api/data/storage/buckets/{name}/upload */
    public function admin_upload_file(string $name, mixed $body = null): mixed
    {
        return $this->http->post('/admin/api/data/storage/buckets/' . rawurlencode($name) . '/upload', $body);
    }

    /** List push tokens for a user — GET /admin/api/data/push/tokens */
    public function admin_get_push_tokens(): mixed
    {
        return $this->http->get('/admin/api/data/push/tokens');
    }

    /** Get push notification logs — GET /admin/api/data/push/logs */
    public function admin_get_push_logs(): mixed
    {
        return $this->http->get('/admin/api/data/push/logs');
    }

    /** Test send push notification — POST /admin/api/data/push/test-send */
    public function admin_test_push_send(mixed $body = null): mixed
    {
        return $this->http->post('/admin/api/data/push/test-send', $body);
    }

    /** List Durable Objects for backup — POST /admin/api/data/backup/list-dos */
    public function admin_backup_list_dos(): mixed
    {
        return $this->http->post('/admin/api/data/backup/list-dos');
    }

    /** Dump a Durable Object for backup — POST /admin/api/data/backup/dump-do */
    public function admin_backup_dump_do(mixed $body = null): mixed
    {
        return $this->http->post('/admin/api/data/backup/dump-do', $body);
    }

    /** Restore a Durable Object from backup — POST /admin/api/data/backup/restore-do */
    public function admin_backup_restore_do(mixed $body = null): mixed
    {
        return $this->http->post('/admin/api/data/backup/restore-do', $body);
    }

    /** Dump D1 database for backup — POST /admin/api/data/backup/dump-d1 */
    public function admin_backup_dump_d1(): mixed
    {
        return $this->http->post('/admin/api/data/backup/dump-d1');
    }

    /** Restore D1 database from backup — POST /admin/api/data/backup/restore-d1 */
    public function admin_backup_restore_d1(mixed $body = null): mixed
    {
        return $this->http->post('/admin/api/data/backup/restore-d1', $body);
    }

    /** Dump data namespace tables for admin-side migrations — POST /admin/api/data/backup/dump-data */
    public function admin_backup_dump_data(mixed $body = null): mixed
    {
        return $this->http->post('/admin/api/data/backup/dump-data', $body);
    }

    /** Restore data namespace tables for admin-side migrations — POST /admin/api/data/backup/restore-data */
    public function admin_backup_restore_data(mixed $body = null): mixed
    {
        return $this->http->post('/admin/api/data/backup/restore-data', $body);
    }

    /** Get backup config — GET /admin/api/data/backup/config */
    public function admin_backup_get_config(): mixed
    {
        return $this->http->get('/admin/api/data/backup/config');
    }

    /** List admin accounts — GET /admin/api/data/admins */
    public function admin_list_admins(): mixed
    {
        return $this->http->get('/admin/api/data/admins');
    }

    /** Create an admin account — POST /admin/api/data/admins */
    public function admin_create_admin(mixed $body = null): mixed
    {
        return $this->http->post('/admin/api/data/admins', $body);
    }

    /** Delete an admin account — DELETE /admin/api/data/admins/{id} */
    public function admin_delete_admin(string $id): mixed
    {
        return $this->http->delete('/admin/api/data/admins/' . rawurlencode($id));
    }

    /** Change admin password — PUT /admin/api/data/admins/{id}/password */
    public function admin_change_password(string $id, mixed $body = null): mixed
    {
        return $this->http->put('/admin/api/data/admins/' . rawurlencode($id) . '/password', $body);
    }

    /** Delete all Cloudflare resources and the Worker itself (self-destruct) — POST /admin/api/data/destroy-app */
    public function admin_destroy_app(mixed $body = null): mixed
    {
        return $this->http->post('/admin/api/data/destroy-app', $body);
    }

    /** List all DO instances — POST /admin/api/backup/list-dos */
    public function backup_list_dos(mixed $body = null): mixed
    {
        return $this->http->post('/admin/api/backup/list-dos', $body);
    }

    /** Return parsed config snapshot — GET /admin/api/backup/config */
    public function backup_get_config(): mixed
    {
        return $this->http->get('/admin/api/backup/config');
    }

    /** Remove plugin-prefixed tables and migration metadata — POST /admin/api/backup/cleanup-plugin */
    public function backup_cleanup_plugin(mixed $body = null): mixed
    {
        return $this->http->post('/admin/api/backup/cleanup-plugin', $body);
    }

    /** Wipe a specific DO's data — POST /admin/api/backup/wipe-do */
    public function backup_wipe_do(mixed $body = null): mixed
    {
        return $this->http->post('/admin/api/backup/wipe-do', $body);
    }

    /** Dump a specific DO's data — POST /admin/api/backup/dump-do */
    public function backup_dump_do(mixed $body = null): mixed
    {
        return $this->http->post('/admin/api/backup/dump-do', $body);
    }

    /** Restore a specific DO's data — POST /admin/api/backup/restore-do */
    public function backup_restore_do(mixed $body = null): mixed
    {
        return $this->http->post('/admin/api/backup/restore-do', $body);
    }

    /** Dump auth database tables — POST /admin/api/backup/dump-d1 */
    public function backup_dump_d1(): mixed
    {
        return $this->http->post('/admin/api/backup/dump-d1');
    }

    /** Restore auth database tables — POST /admin/api/backup/restore-d1 */
    public function backup_restore_d1(mixed $body = null): mixed
    {
        return $this->http->post('/admin/api/backup/restore-d1', $body);
    }

    /** Dump control-plane D1 tables — POST /admin/api/backup/dump-control-d1 */
    public function backup_dump_control_d1(): mixed
    {
        return $this->http->post('/admin/api/backup/dump-control-d1');
    }

    /** Restore control-plane D1 tables — POST /admin/api/backup/restore-control-d1 */
    public function backup_restore_control_d1(mixed $body = null): mixed
    {
        return $this->http->post('/admin/api/backup/restore-control-d1', $body);
    }

    /** Dump all tables from a data namespace — POST /admin/api/backup/dump-data */
    public function backup_dump_data(mixed $body = null): mixed
    {
        return $this->http->post('/admin/api/backup/dump-data', $body);
    }

    /** Restore all tables into a data namespace — POST /admin/api/backup/restore-data */
    public function backup_restore_data(mixed $body = null): mixed
    {
        return $this->http->post('/admin/api/backup/restore-data', $body);
    }

    /** Dump R2 storage (list or download) — POST /admin/api/backup/dump-storage */
    public function backup_dump_storage(array $query = []): mixed
    {
        return $this->http->get('/admin/api/backup/dump-storage', $query);
    }

    /** Restore R2 storage (wipe or upload) — POST /admin/api/backup/restore-storage */
    public function backup_restore_storage(array $query = []): mixed
    {
        return $this->http->get('/admin/api/backup/restore-storage', $query);
    }

    /** Resync _users_public from _users in AUTH_DB D1 — POST /admin/api/backup/resync-users-public */
    public function backup_resync_users_public(): mixed
    {
        return $this->http->post('/admin/api/backup/resync-users-public');
    }

    /** Export a single table as JSON — GET /admin/api/backup/export/{name} */
    public function backup_export_table(string $name, array $query = []): mixed
    {
        return $this->http->get('/admin/api/backup/export/' . rawurlencode($name), $query);
    }
}
