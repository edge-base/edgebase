"""Auto-generated admin API Core — DO NOT EDIT.

Regenerate: npx tsx tools/sdk-codegen/generate.ts
Source: openapi.json (0.1.0)
"""

from __future__ import annotations

import urllib.parse

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from edgebase_core.http_client import HttpClient


class GeneratedAdminApi:
    """Generated API methods — calls HttpClient internally."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def admin_auth_get_user(self, id: str) -> Any:
        """Get user by ID — GET /api/auth/admin/users/{id}"""
        return self._http.get(f"/auth/admin/users/{urllib.parse.quote(id, safe='')}")

    def admin_auth_update_user(self, id: str, body: Any) -> Any:
        """Update user by ID — PATCH /api/auth/admin/users/{id}"""
        return self._http.patch(f"/auth/admin/users/{urllib.parse.quote(id, safe='')}", body)

    def admin_auth_delete_user(self, id: str) -> Any:
        """Delete user by ID — DELETE /api/auth/admin/users/{id}"""
        return self._http.delete(f"/auth/admin/users/{urllib.parse.quote(id, safe='')}")

    def admin_auth_list_users(self, query: dict[str, str] | None = None) -> Any:
        """List users — GET /api/auth/admin/users"""
        return self._http.get("/auth/admin/users", params=query)

    def admin_auth_create_user(self, body: Any) -> Any:
        """Create a new user — POST /api/auth/admin/users"""
        return self._http.post("/auth/admin/users", body)

    def admin_auth_delete_user_mfa(self, id: str) -> Any:
        """Delete user MFA — DELETE /api/auth/admin/users/{id}/mfa"""
        return self._http.delete(f"/auth/admin/users/{urllib.parse.quote(id, safe='')}/mfa")

    def admin_auth_set_claims(self, id: str, body: Any) -> Any:
        """Set custom claims for user — PUT /api/auth/admin/users/{id}/claims"""
        return self._http.put(f"/auth/admin/users/{urllib.parse.quote(id, safe='')}/claims", body)

    def admin_auth_revoke_user_sessions(self, id: str) -> Any:
        """Revoke all sessions for user — POST /api/auth/admin/users/{id}/revoke"""
        return self._http.post(f"/auth/admin/users/{urllib.parse.quote(id, safe='')}/revoke")

    def admin_auth_import_users(self, body: Any) -> Any:
        """Batch import users — POST /api/auth/admin/users/import"""
        return self._http.post("/auth/admin/users/import", body)

    def database_live_broadcast(self, body: Any) -> Any:
        """Broadcast to database live channel — POST /api/db/broadcast"""
        return self._http.post("/db/broadcast", body)

    def execute_sql(self, body: Any) -> Any:
        """Execute SQL via DatabaseDO — POST /api/sql"""
        return self._http.post("/sql", body)

    def kv_operation(self, namespace: str, body: Any) -> Any:
        """Execute KV operation — POST /api/kv/{namespace}"""
        return self._http.post(f"/kv/{urllib.parse.quote(namespace, safe='')}", body)

    def execute_d1_query(self, database: str, body: Any) -> Any:
        """Execute raw SQL on D1 database — POST /api/d1/{database}"""
        return self._http.post(f"/d1/{urllib.parse.quote(database, safe='')}", body)

    def vectorize_operation(self, index: str, body: Any) -> Any:
        """Execute Vectorize operation — POST /api/vectorize/{index}"""
        return self._http.post(f"/vectorize/{urllib.parse.quote(index, safe='')}", body)

    def push_send(self, body: Any) -> Any:
        """Send push notification to user — POST /api/push/send"""
        return self._http.post("/push/send", body)

    def push_send_many(self, body: Any) -> Any:
        """Send push to multiple users — POST /api/push/send-many"""
        return self._http.post("/push/send-many", body)

    def push_send_to_token(self, body: Any) -> Any:
        """Send push to specific token — POST /api/push/send-to-token"""
        return self._http.post("/push/send-to-token", body)

    def push_send_to_topic(self, body: Any) -> Any:
        """Send push to topic — POST /api/push/send-to-topic"""
        return self._http.post("/push/send-to-topic", body)

    def push_broadcast(self, body: Any) -> Any:
        """Broadcast push to all devices — POST /api/push/broadcast"""
        return self._http.post("/push/broadcast", body)

    def get_push_logs(self, query: dict[str, str] | None = None) -> Any:
        """Get push notification logs — GET /api/push/logs"""
        return self._http.get("/push/logs", params=query)

    def get_push_tokens(self, query: dict[str, str] | None = None) -> Any:
        """Get registered push tokens — GET /api/push/tokens"""
        return self._http.get("/push/tokens", params=query)

    def put_push_tokens(self, body: Any) -> Any:
        """Upsert a device token — PUT /api/push/tokens"""
        return self._http.put("/push/tokens", body)

    def patch_push_tokens(self, body: Any) -> Any:
        """Update device metadata — PATCH /api/push/tokens"""
        return self._http.patch("/push/tokens", body)

    def query_analytics(self, query: dict[str, str] | None = None) -> Any:
        """Query request log metrics — GET /api/analytics/query"""
        return self._http.get("/analytics/query", params=query)

    def query_custom_events(self, query: dict[str, str] | None = None) -> Any:
        """Query custom events — GET /api/analytics/events"""
        return self._http.get("/analytics/events", params=query)

    def admin_setup_status(self) -> Any:
        """Check if admin setup is needed — GET /admin/api/setup/status"""
        return self._http.get("/admin/api/setup/status")

    def admin_setup(self, body: Any) -> Any:
        """Create the first admin account — POST /admin/api/setup"""
        return self._http.post("/admin/api/setup", body)

    def admin_login(self, body: Any) -> Any:
        """Admin login — POST /admin/api/auth/login"""
        return self._http.post("/admin/api/auth/login", body)

    def admin_refresh(self, body: Any) -> Any:
        """Rotate admin token — POST /admin/api/auth/refresh"""
        return self._http.post("/admin/api/auth/refresh", body)

    def admin_reset_password(self, body: Any) -> Any:
        """Reset admin password (Service Key required) — POST /admin/api/internal/reset-password"""
        return self._http.post("/admin/api/internal/reset-password", body)

    def admin_list_tables(self) -> Any:
        """List all tables from config — GET /admin/api/data/tables"""
        return self._http.get("/admin/api/data/tables")

    def admin_get_table_records(self, name: str) -> Any:
        """List table records with pagination — GET /admin/api/data/tables/{name}/records"""
        return self._http.get(f"/admin/api/data/tables/{urllib.parse.quote(name, safe='')}/records")

    def admin_create_table_record(self, name: str, body: Any) -> Any:
        """Create a table record — POST /admin/api/data/tables/{name}/records"""
        return self._http.post(f"/admin/api/data/tables/{urllib.parse.quote(name, safe='')}/records", body)

    def admin_update_table_record(self, name: str, id: str, body: Any) -> Any:
        """Update a table record — PUT /admin/api/data/tables/{name}/records/{id}"""
        return self._http.put(f"/admin/api/data/tables/{urllib.parse.quote(name, safe='')}/records/{urllib.parse.quote(id, safe='')}", body)

    def admin_delete_table_record(self, name: str, id: str) -> Any:
        """Delete a table record — DELETE /admin/api/data/tables/{name}/records/{id}"""
        return self._http.delete(f"/admin/api/data/tables/{urllib.parse.quote(name, safe='')}/records/{urllib.parse.quote(id, safe='')}")

    def admin_list_users(self) -> Any:
        """List users via D1 index — GET /admin/api/data/users"""
        return self._http.get("/admin/api/data/users")

    def admin_create_user(self, body: Any) -> Any:
        """Create a new user — POST /admin/api/data/users"""
        return self._http.post("/admin/api/data/users", body)

    def admin_get_user(self, id: str) -> Any:
        """Fetch a single user by ID — GET /admin/api/data/users/{id}"""
        return self._http.get(f"/admin/api/data/users/{urllib.parse.quote(id, safe='')}")

    def admin_update_user(self, id: str, body: Any) -> Any:
        """Update user status or role — PUT /admin/api/data/users/{id}"""
        return self._http.put(f"/admin/api/data/users/{urllib.parse.quote(id, safe='')}", body)

    def admin_delete_user(self, id: str) -> Any:
        """Delete a user completely — DELETE /admin/api/data/users/{id}"""
        return self._http.delete(f"/admin/api/data/users/{urllib.parse.quote(id, safe='')}")

    def admin_get_user_profile(self, id: str) -> Any:
        """Fetch user profile with cache — GET /admin/api/data/users/{id}/profile"""
        return self._http.get(f"/admin/api/data/users/{urllib.parse.quote(id, safe='')}/profile")

    def admin_delete_user_sessions(self, id: str) -> Any:
        """Revoke all user sessions — DELETE /admin/api/data/users/{id}/sessions"""
        return self._http.delete(f"/admin/api/data/users/{urllib.parse.quote(id, safe='')}/sessions")

    def admin_cleanup_anon(self) -> Any:
        """Cleanup anonymous user index — POST /admin/api/data/cleanup-anon"""
        return self._http.post("/admin/api/data/cleanup-anon")

    def admin_list_buckets(self) -> Any:
        """List configured storage buckets — GET /admin/api/data/storage/buckets"""
        return self._http.get("/admin/api/data/storage/buckets")

    def admin_list_bucket_objects(self, name: str) -> Any:
        """List objects in a storage bucket — GET /admin/api/data/storage/buckets/{name}/objects"""
        return self._http.get(f"/admin/api/data/storage/buckets/{urllib.parse.quote(name, safe='')}/objects")

    def admin_get_bucket_object(self, name: str, key: str) -> Any:
        """Get a storage object content — GET /admin/api/data/storage/buckets/{name}/objects/{key}"""
        return self._http.get(f"/admin/api/data/storage/buckets/{urllib.parse.quote(name, safe='')}/objects/{urllib.parse.quote(key, safe='')}")

    def admin_delete_bucket_object(self, name: str, key: str) -> Any:
        """Delete a storage object — DELETE /admin/api/data/storage/buckets/{name}/objects/{key}"""
        return self._http.delete(f"/admin/api/data/storage/buckets/{urllib.parse.quote(name, safe='')}/objects/{urllib.parse.quote(key, safe='')}")

    def admin_get_bucket_stats(self, name: str) -> Any:
        """Get bucket statistics (total objects and size) — GET /admin/api/data/storage/buckets/{name}/stats"""
        return self._http.get(f"/admin/api/data/storage/buckets/{urllib.parse.quote(name, safe='')}/stats")

    def admin_create_signed_url(self, name: str, body: Any) -> Any:
        """Create a signed download URL for a storage object — POST /admin/api/data/storage/buckets/{name}/signed-url"""
        return self._http.post(f"/admin/api/data/storage/buckets/{urllib.parse.quote(name, safe='')}/signed-url", body)

    def admin_get_schema(self) -> Any:
        """Get full schema structure from config — GET /admin/api/data/schema"""
        return self._http.get("/admin/api/data/schema")

    def admin_list_namespace_instances(self, namespace: str, query: dict[str, str] | None = None) -> Any:
        """List instance suggestions for a dynamic namespace — GET /admin/api/data/namespaces/{namespace}/instances"""
        return self._http.get(f"/admin/api/data/namespaces/{urllib.parse.quote(namespace, safe='')}/instances", params=query)

    def admin_export_table(self, name: str) -> Any:
        """Export table data as JSON — GET /admin/api/data/tables/{name}/export"""
        return self._http.get(f"/admin/api/data/tables/{urllib.parse.quote(name, safe='')}/export")

    def admin_get_logs(self) -> Any:
        """Get request logs — GET /admin/api/data/logs"""
        return self._http.get("/admin/api/data/logs")

    def admin_get_monitoring(self) -> Any:
        """Get live monitoring stats — GET /admin/api/data/monitoring"""
        return self._http.get("/admin/api/data/monitoring")

    def admin_get_analytics(self, query: dict[str, str] | None = None) -> Any:
        """Get analytics dashboard data — GET /admin/api/data/analytics"""
        return self._http.get("/admin/api/data/analytics", params=query)

    def admin_get_analytics_events(self) -> Any:
        """Query analytics events for admin dashboard — GET /admin/api/data/analytics/events"""
        return self._http.get("/admin/api/data/analytics/events")

    def admin_get_overview(self, query: dict[str, str] | None = None) -> Any:
        """Get project overview for dashboard home — GET /admin/api/data/overview"""
        return self._http.get("/admin/api/data/overview", params=query)

    def admin_get_dev_info(self) -> Any:
        """Get dev mode status and sidecar port — GET /admin/api/data/dev-info"""
        return self._http.get("/admin/api/data/dev-info")

    def admin_execute_sql(self, body: Any) -> Any:
        """Execute raw SQL query — POST /admin/api/data/sql"""
        return self._http.post("/admin/api/data/sql", body)

    def admin_import_table(self, name: str, body: Any) -> Any:
        """Batch import records into a table — POST /admin/api/data/tables/{name}/import"""
        return self._http.post(f"/admin/api/data/tables/{urllib.parse.quote(name, safe='')}/import", body)

    def admin_rules_test(self, body: Any) -> Any:
        """Evaluate access rules with simulated auth context — POST /admin/api/data/rules-test"""
        return self._http.post("/admin/api/data/rules-test", body)

    def admin_list_functions(self) -> Any:
        """List registered functions from config — GET /admin/api/data/functions"""
        return self._http.get("/admin/api/data/functions")

    def admin_get_config_info(self) -> Any:
        """Get environment and config overview — GET /admin/api/data/config-info"""
        return self._http.get("/admin/api/data/config-info")

    def admin_get_recent_logs(self) -> Any:
        """Get recent request logs with filtering — GET /admin/api/data/logs/recent"""
        return self._http.get("/admin/api/data/logs/recent")

    def admin_get_auth_settings(self) -> Any:
        """Get OAuth provider config — GET /admin/api/data/auth/settings"""
        return self._http.get("/admin/api/data/auth/settings")

    def admin_get_email_templates(self) -> Any:
        """Get email template and subject config — GET /admin/api/data/email/templates"""
        return self._http.get("/admin/api/data/email/templates")

    def admin_delete_user_mfa(self, id: str) -> Any:
        """Disable MFA for a user — DELETE /admin/api/data/users/{id}/mfa"""
        return self._http.delete(f"/admin/api/data/users/{urllib.parse.quote(id, safe='')}/mfa")

    def admin_send_password_reset(self, id: str) -> Any:
        """Send password reset email for a user — POST /admin/api/data/users/{id}/send-password-reset"""
        return self._http.post(f"/admin/api/data/users/{urllib.parse.quote(id, safe='')}/send-password-reset")

    def admin_upload_file(self, name: str, body: Any) -> Any:
        """Upload file to R2 storage — POST /admin/api/data/storage/buckets/{name}/upload"""
        return self._http.post(f"/admin/api/data/storage/buckets/{urllib.parse.quote(name, safe='')}/upload", body)

    def admin_get_push_tokens(self) -> Any:
        """List push tokens for a user — GET /admin/api/data/push/tokens"""
        return self._http.get("/admin/api/data/push/tokens")

    def admin_get_push_logs(self) -> Any:
        """Get push notification logs — GET /admin/api/data/push/logs"""
        return self._http.get("/admin/api/data/push/logs")

    def admin_test_push_send(self, body: Any) -> Any:
        """Test send push notification — POST /admin/api/data/push/test-send"""
        return self._http.post("/admin/api/data/push/test-send", body)

    def admin_backup_list_dos(self) -> Any:
        """List Durable Objects for backup — POST /admin/api/data/backup/list-dos"""
        return self._http.post("/admin/api/data/backup/list-dos")

    def admin_backup_dump_do(self, body: Any) -> Any:
        """Dump a Durable Object for backup — POST /admin/api/data/backup/dump-do"""
        return self._http.post("/admin/api/data/backup/dump-do", body)

    def admin_backup_restore_do(self, body: Any) -> Any:
        """Restore a Durable Object from backup — POST /admin/api/data/backup/restore-do"""
        return self._http.post("/admin/api/data/backup/restore-do", body)

    def admin_backup_dump_d1(self) -> Any:
        """Dump D1 database for backup — POST /admin/api/data/backup/dump-d1"""
        return self._http.post("/admin/api/data/backup/dump-d1")

    def admin_backup_restore_d1(self, body: Any) -> Any:
        """Restore D1 database from backup — POST /admin/api/data/backup/restore-d1"""
        return self._http.post("/admin/api/data/backup/restore-d1", body)

    def admin_backup_dump_data(self, body: Any) -> Any:
        """Dump data namespace tables for admin-side migrations — POST /admin/api/data/backup/dump-data"""
        return self._http.post("/admin/api/data/backup/dump-data", body)

    def admin_backup_restore_data(self, body: Any) -> Any:
        """Restore data namespace tables for admin-side migrations — POST /admin/api/data/backup/restore-data"""
        return self._http.post("/admin/api/data/backup/restore-data", body)

    def admin_backup_get_config(self) -> Any:
        """Get backup config — GET /admin/api/data/backup/config"""
        return self._http.get("/admin/api/data/backup/config")

    def admin_list_admins(self) -> Any:
        """List admin accounts — GET /admin/api/data/admins"""
        return self._http.get("/admin/api/data/admins")

    def admin_create_admin(self, body: Any) -> Any:
        """Create an admin account — POST /admin/api/data/admins"""
        return self._http.post("/admin/api/data/admins", body)

    def admin_delete_admin(self, id: str) -> Any:
        """Delete an admin account — DELETE /admin/api/data/admins/{id}"""
        return self._http.delete(f"/admin/api/data/admins/{urllib.parse.quote(id, safe='')}")

    def admin_change_password(self, id: str, body: Any) -> Any:
        """Change admin password — PUT /admin/api/data/admins/{id}/password"""
        return self._http.put(f"/admin/api/data/admins/{urllib.parse.quote(id, safe='')}/password", body)

    def admin_destroy_app(self, body: Any) -> Any:
        """Delete all Cloudflare resources and the Worker itself (self-destruct) — POST /admin/api/data/destroy-app"""
        return self._http.post("/admin/api/data/destroy-app", body)

    def backup_list_dos(self, body: Any) -> Any:
        """List all DO instances — POST /admin/api/backup/list-dos"""
        return self._http.post("/admin/api/backup/list-dos", body)

    def backup_get_config(self) -> Any:
        """Return parsed config snapshot — GET /admin/api/backup/config"""
        return self._http.get("/admin/api/backup/config")

    def backup_cleanup_plugin(self, body: Any) -> Any:
        """Remove plugin-prefixed tables and migration metadata — POST /admin/api/backup/cleanup-plugin"""
        return self._http.post("/admin/api/backup/cleanup-plugin", body)

    def backup_wipe_do(self, body: Any) -> Any:
        """Wipe a specific DO's data — POST /admin/api/backup/wipe-do"""
        return self._http.post("/admin/api/backup/wipe-do", body)

    def backup_dump_do(self, body: Any) -> Any:
        """Dump a specific DO's data — POST /admin/api/backup/dump-do"""
        return self._http.post("/admin/api/backup/dump-do", body)

    def backup_restore_do(self, body: Any) -> Any:
        """Restore a specific DO's data — POST /admin/api/backup/restore-do"""
        return self._http.post("/admin/api/backup/restore-do", body)

    def backup_dump_d1(self) -> Any:
        """Dump auth database tables — POST /admin/api/backup/dump-d1"""
        return self._http.post("/admin/api/backup/dump-d1")

    def backup_restore_d1(self, body: Any) -> Any:
        """Restore auth database tables — POST /admin/api/backup/restore-d1"""
        return self._http.post("/admin/api/backup/restore-d1", body)

    def backup_dump_control_d1(self) -> Any:
        """Dump control-plane D1 tables — POST /admin/api/backup/dump-control-d1"""
        return self._http.post("/admin/api/backup/dump-control-d1")

    def backup_restore_control_d1(self, body: Any) -> Any:
        """Restore control-plane D1 tables — POST /admin/api/backup/restore-control-d1"""
        return self._http.post("/admin/api/backup/restore-control-d1", body)

    def backup_dump_data(self, body: Any) -> Any:
        """Dump all tables from a data namespace — POST /admin/api/backup/dump-data"""
        return self._http.post("/admin/api/backup/dump-data", body)

    def backup_restore_data(self, body: Any) -> Any:
        """Restore all tables into a data namespace — POST /admin/api/backup/restore-data"""
        return self._http.post("/admin/api/backup/restore-data", body)

    def backup_dump_storage(self, query: dict[str, str] | None = None) -> Any:
        """Dump R2 storage (list or download) — POST /admin/api/backup/dump-storage"""
        return self._http.get("/admin/api/backup/dump-storage", params=query)

    def backup_restore_storage(self, query: dict[str, str] | None = None) -> Any:
        """Restore R2 storage (wipe or upload) — POST /admin/api/backup/restore-storage"""
        return self._http.get("/admin/api/backup/restore-storage", params=query)

    def backup_resync_users_public(self) -> Any:
        """Resync _users_public from _users in AUTH_DB D1 — POST /admin/api/backup/resync-users-public"""
        return self._http.post("/admin/api/backup/resync-users-public")

    def backup_export_table(self, name: str, query: dict[str, str] | None = None) -> Any:
        """Export a single table as JSON — GET /admin/api/backup/export/{name}"""
        return self._http.get(f"/admin/api/backup/export/{urllib.parse.quote(name, safe='')}", params=query)
