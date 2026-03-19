# frozen_string_literal: true

# Auto-generated admin API Core — DO NOT EDIT.
#
# Regenerate: npx tsx tools/sdk-codegen/generate.ts
# Source: openapi.json (0.1.3)

require "cgi"

module EdgebaseAdmin
  class GeneratedAdminApi
    # Generated API methods — calls HttpClient internally.

    def initialize(http)
      @http = http
    end

    # Get user by ID — GET /api/auth/admin/users/{id}
    def admin_auth_get_user(id)
      @http.get("/auth/admin/users/#{CGI.escape(id).gsub('+', '%20')}")
    end

    # Update user by ID — PATCH /api/auth/admin/users/{id}
    def admin_auth_update_user(id, body = nil)
      @http.patch("/auth/admin/users/#{CGI.escape(id).gsub('+', '%20')}", body)
    end

    # Delete user by ID — DELETE /api/auth/admin/users/{id}
    def admin_auth_delete_user(id)
      @http.delete("/auth/admin/users/#{CGI.escape(id).gsub('+', '%20')}")
    end

    # List users — GET /api/auth/admin/users
    def admin_auth_list_users(query: nil)
      @http.get("/auth/admin/users", params: query)
    end

    # Create a new user — POST /api/auth/admin/users
    def admin_auth_create_user(body = nil)
      @http.post("/auth/admin/users", body)
    end

    # Delete user MFA — DELETE /api/auth/admin/users/{id}/mfa
    def admin_auth_delete_user_mfa(id)
      @http.delete("/auth/admin/users/#{CGI.escape(id).gsub('+', '%20')}/mfa")
    end

    # Set custom claims for user — PUT /api/auth/admin/users/{id}/claims
    def admin_auth_set_claims(id, body = nil)
      @http.put("/auth/admin/users/#{CGI.escape(id).gsub('+', '%20')}/claims", body)
    end

    # Revoke all sessions for user — POST /api/auth/admin/users/{id}/revoke
    def admin_auth_revoke_user_sessions(id)
      @http.post("/auth/admin/users/#{CGI.escape(id).gsub('+', '%20')}/revoke")
    end

    # Batch import users — POST /api/auth/admin/users/import
    def admin_auth_import_users(body = nil)
      @http.post("/auth/admin/users/import", body)
    end

    # Broadcast to database live channel — POST /api/db/broadcast
    def database_live_broadcast(body = nil)
      @http.post("/db/broadcast", body)
    end

    # Execute SQL via DatabaseDO — POST /api/sql
    def execute_sql(body = nil)
      @http.post("/sql", body)
    end

    # Execute KV operation — POST /api/kv/{namespace}
    def kv_operation(namespace, body = nil)
      @http.post("/kv/#{CGI.escape(namespace).gsub('+', '%20')}", body)
    end

    # Execute raw SQL on D1 database — POST /api/d1/{database}
    def execute_d1_query(database, body = nil)
      @http.post("/d1/#{CGI.escape(database).gsub('+', '%20')}", body)
    end

    # Execute Vectorize operation — POST /api/vectorize/{index}
    def vectorize_operation(index, body = nil)
      @http.post("/vectorize/#{CGI.escape(index).gsub('+', '%20')}", body)
    end

    # Send push notification to user — POST /api/push/send
    def push_send(body = nil)
      @http.post("/push/send", body)
    end

    # Send push to multiple users — POST /api/push/send-many
    def push_send_many(body = nil)
      @http.post("/push/send-many", body)
    end

    # Send push to specific token — POST /api/push/send-to-token
    def push_send_to_token(body = nil)
      @http.post("/push/send-to-token", body)
    end

    # Send push to topic — POST /api/push/send-to-topic
    def push_send_to_topic(body = nil)
      @http.post("/push/send-to-topic", body)
    end

    # Broadcast push to all devices — POST /api/push/broadcast
    def push_broadcast(body = nil)
      @http.post("/push/broadcast", body)
    end

    # Get push notification logs — GET /api/push/logs
    def get_push_logs(query: nil)
      @http.get("/push/logs", params: query)
    end

    # Get registered push tokens — GET /api/push/tokens
    def get_push_tokens(query: nil)
      @http.get("/push/tokens", params: query)
    end

    # Upsert a device token — PUT /api/push/tokens
    def put_push_tokens(body = nil)
      @http.put("/push/tokens", body)
    end

    # Update device metadata — PATCH /api/push/tokens
    def patch_push_tokens(body = nil)
      @http.patch("/push/tokens", body)
    end

    # Query request log metrics — GET /api/analytics/query
    def query_analytics(query: nil)
      @http.get("/analytics/query", params: query)
    end

    # Query custom events — GET /api/analytics/events
    def query_custom_events(query: nil)
      @http.get("/analytics/events", params: query)
    end

    # Check if admin setup is needed — GET /admin/api/setup/status
    def admin_setup_status()
      @http.get("/admin/api/setup/status")
    end

    # Create the first admin account — POST /admin/api/setup
    def admin_setup(body = nil)
      @http.post("/admin/api/setup", body)
    end

    # Admin login — POST /admin/api/auth/login
    def admin_login(body = nil)
      @http.post("/admin/api/auth/login", body)
    end

    # Rotate admin token — POST /admin/api/auth/refresh
    def admin_refresh(body = nil)
      @http.post("/admin/api/auth/refresh", body)
    end

    # Reset admin password (Service Key required) — POST /admin/api/internal/reset-password
    def admin_reset_password(body = nil)
      @http.post("/admin/api/internal/reset-password", body)
    end

    # List all tables from config — GET /admin/api/data/tables
    def admin_list_tables()
      @http.get("/admin/api/data/tables")
    end

    # List table records with pagination — GET /admin/api/data/tables/{name}/records
    def admin_get_table_records(name)
      @http.get("/admin/api/data/tables/#{CGI.escape(name).gsub('+', '%20')}/records")
    end

    # Create a table record — POST /admin/api/data/tables/{name}/records
    def admin_create_table_record(name, body = nil)
      @http.post("/admin/api/data/tables/#{CGI.escape(name).gsub('+', '%20')}/records", body)
    end

    # Update a table record — PUT /admin/api/data/tables/{name}/records/{id}
    def admin_update_table_record(name, id, body = nil)
      @http.put("/admin/api/data/tables/#{CGI.escape(name).gsub('+', '%20')}/records/#{CGI.escape(id).gsub('+', '%20')}", body)
    end

    # Delete a table record — DELETE /admin/api/data/tables/{name}/records/{id}
    def admin_delete_table_record(name, id)
      @http.delete("/admin/api/data/tables/#{CGI.escape(name).gsub('+', '%20')}/records/#{CGI.escape(id).gsub('+', '%20')}")
    end

    # List users via D1 index — GET /admin/api/data/users
    def admin_list_users()
      @http.get("/admin/api/data/users")
    end

    # Create a new user — POST /admin/api/data/users
    def admin_create_user(body = nil)
      @http.post("/admin/api/data/users", body)
    end

    # Fetch a single user by ID — GET /admin/api/data/users/{id}
    def admin_get_user(id)
      @http.get("/admin/api/data/users/#{CGI.escape(id).gsub('+', '%20')}")
    end

    # Update user status or role — PUT /admin/api/data/users/{id}
    def admin_update_user(id, body = nil)
      @http.put("/admin/api/data/users/#{CGI.escape(id).gsub('+', '%20')}", body)
    end

    # Delete a user completely — DELETE /admin/api/data/users/{id}
    def admin_delete_user(id)
      @http.delete("/admin/api/data/users/#{CGI.escape(id).gsub('+', '%20')}")
    end

    # Fetch user profile with cache — GET /admin/api/data/users/{id}/profile
    def admin_get_user_profile(id)
      @http.get("/admin/api/data/users/#{CGI.escape(id).gsub('+', '%20')}/profile")
    end

    # Revoke all user sessions — DELETE /admin/api/data/users/{id}/sessions
    def admin_delete_user_sessions(id)
      @http.delete("/admin/api/data/users/#{CGI.escape(id).gsub('+', '%20')}/sessions")
    end

    # Cleanup anonymous user index — POST /admin/api/data/cleanup-anon
    def admin_cleanup_anon()
      @http.post("/admin/api/data/cleanup-anon")
    end

    # List configured storage buckets — GET /admin/api/data/storage/buckets
    def admin_list_buckets()
      @http.get("/admin/api/data/storage/buckets")
    end

    # List objects in a storage bucket — GET /admin/api/data/storage/buckets/{name}/objects
    def admin_list_bucket_objects(name)
      @http.get("/admin/api/data/storage/buckets/#{CGI.escape(name).gsub('+', '%20')}/objects")
    end

    # Get a storage object content — GET /admin/api/data/storage/buckets/{name}/objects/{key}
    def admin_get_bucket_object(name, key)
      @http.get("/admin/api/data/storage/buckets/#{CGI.escape(name).gsub('+', '%20')}/objects/#{CGI.escape(key).gsub('+', '%20')}")
    end

    # Delete a storage object — DELETE /admin/api/data/storage/buckets/{name}/objects/{key}
    def admin_delete_bucket_object(name, key)
      @http.delete("/admin/api/data/storage/buckets/#{CGI.escape(name).gsub('+', '%20')}/objects/#{CGI.escape(key).gsub('+', '%20')}")
    end

    # Get bucket statistics (total objects and size) — GET /admin/api/data/storage/buckets/{name}/stats
    def admin_get_bucket_stats(name)
      @http.get("/admin/api/data/storage/buckets/#{CGI.escape(name).gsub('+', '%20')}/stats")
    end

    # Create a signed download URL for a storage object — POST /admin/api/data/storage/buckets/{name}/signed-url
    def admin_create_signed_url(name, body = nil)
      @http.post("/admin/api/data/storage/buckets/#{CGI.escape(name).gsub('+', '%20')}/signed-url", body)
    end

    # Get full schema structure from config — GET /admin/api/data/schema
    def admin_get_schema()
      @http.get("/admin/api/data/schema")
    end

    # Export table data as JSON — GET /admin/api/data/tables/{name}/export
    def admin_export_table(name)
      @http.get("/admin/api/data/tables/#{CGI.escape(name).gsub('+', '%20')}/export")
    end

    # Get request logs — GET /admin/api/data/logs
    def admin_get_logs()
      @http.get("/admin/api/data/logs")
    end

    # Get realtime monitoring stats — GET /admin/api/data/monitoring
    def admin_get_monitoring()
      @http.get("/admin/api/data/monitoring")
    end

    # Get analytics dashboard data — GET /admin/api/data/analytics
    def admin_get_analytics()
      @http.get("/admin/api/data/analytics")
    end

    # Query analytics events for admin dashboard — GET /admin/api/data/analytics/events
    def admin_get_analytics_events()
      @http.get("/admin/api/data/analytics/events")
    end

    # Get project overview for dashboard home — GET /admin/api/data/overview
    def admin_get_overview()
      @http.get("/admin/api/data/overview")
    end

    # Get dev mode status and sidecar port — GET /admin/api/data/dev-info
    def admin_get_dev_info()
      @http.get("/admin/api/data/dev-info")
    end

    # Execute raw SQL query — POST /admin/api/data/sql
    def admin_execute_sql(body = nil)
      @http.post("/admin/api/data/sql", body)
    end

    # Batch import records into a table — POST /admin/api/data/tables/{name}/import
    def admin_import_table(name, body = nil)
      @http.post("/admin/api/data/tables/#{CGI.escape(name).gsub('+', '%20')}/import", body)
    end

    # Evaluate access rules with simulated auth context — POST /admin/api/data/rules-test
    def admin_rules_test(body = nil)
      @http.post("/admin/api/data/rules-test", body)
    end

    # List registered functions from config — GET /admin/api/data/functions
    def admin_list_functions()
      @http.get("/admin/api/data/functions")
    end

    # Get environment and config overview — GET /admin/api/data/config-info
    def admin_get_config_info()
      @http.get("/admin/api/data/config-info")
    end

    # Get recent request logs with filtering — GET /admin/api/data/logs/recent
    def admin_get_recent_logs()
      @http.get("/admin/api/data/logs/recent")
    end

    # Get OAuth provider config — GET /admin/api/data/auth/settings
    def admin_get_auth_settings()
      @http.get("/admin/api/data/auth/settings")
    end

    # Get email template and subject config — GET /admin/api/data/email/templates
    def admin_get_email_templates()
      @http.get("/admin/api/data/email/templates")
    end

    # Disable MFA for a user — DELETE /admin/api/data/users/{id}/mfa
    def admin_delete_user_mfa(id)
      @http.delete("/admin/api/data/users/#{CGI.escape(id).gsub('+', '%20')}/mfa")
    end

    # Send password reset email for a user — POST /admin/api/data/users/{id}/send-password-reset
    def admin_send_password_reset(id)
      @http.post("/admin/api/data/users/#{CGI.escape(id).gsub('+', '%20')}/send-password-reset")
    end

    # Upload file to R2 storage — POST /admin/api/data/storage/buckets/{name}/upload
    def admin_upload_file(name, body = nil)
      @http.post("/admin/api/data/storage/buckets/#{CGI.escape(name).gsub('+', '%20')}/upload", body)
    end

    # List push tokens for a user — GET /admin/api/data/push/tokens
    def admin_get_push_tokens()
      @http.get("/admin/api/data/push/tokens")
    end

    # Get push notification logs — GET /admin/api/data/push/logs
    def admin_get_push_logs()
      @http.get("/admin/api/data/push/logs")
    end

    # Test send push notification — POST /admin/api/data/push/test-send
    def admin_test_push_send(body = nil)
      @http.post("/admin/api/data/push/test-send", body)
    end

    # List Durable Objects for backup — POST /admin/api/data/backup/list-dos
    def admin_backup_list_dos()
      @http.post("/admin/api/data/backup/list-dos")
    end

    # Dump a Durable Object for backup — POST /admin/api/data/backup/dump-do
    def admin_backup_dump_do(body = nil)
      @http.post("/admin/api/data/backup/dump-do", body)
    end

    # Restore a Durable Object from backup — POST /admin/api/data/backup/restore-do
    def admin_backup_restore_do(body = nil)
      @http.post("/admin/api/data/backup/restore-do", body)
    end

    # Dump D1 database for backup — POST /admin/api/data/backup/dump-d1
    def admin_backup_dump_d1()
      @http.post("/admin/api/data/backup/dump-d1")
    end

    # Restore D1 database from backup — POST /admin/api/data/backup/restore-d1
    def admin_backup_restore_d1(body = nil)
      @http.post("/admin/api/data/backup/restore-d1", body)
    end

    # Get backup config — GET /admin/api/data/backup/config
    def admin_backup_get_config()
      @http.get("/admin/api/data/backup/config")
    end

    # List admin accounts — GET /admin/api/data/admins
    def admin_list_admins()
      @http.get("/admin/api/data/admins")
    end

    # Create an admin account — POST /admin/api/data/admins
    def admin_create_admin(body = nil)
      @http.post("/admin/api/data/admins", body)
    end

    # Delete an admin account — DELETE /admin/api/data/admins/{id}
    def admin_delete_admin(id)
      @http.delete("/admin/api/data/admins/#{CGI.escape(id).gsub('+', '%20')}")
    end

    # Change admin password — PUT /admin/api/data/admins/{id}/password
    def admin_change_password(id, body = nil)
      @http.put("/admin/api/data/admins/#{CGI.escape(id).gsub('+', '%20')}/password", body)
    end

    # List all DO instances — POST /admin/api/backup/list-dos
    def backup_list_dos(body = nil)
      @http.post("/admin/api/backup/list-dos", body)
    end

    # Return parsed config snapshot — GET /admin/api/backup/config
    def backup_get_config()
      @http.get("/admin/api/backup/config")
    end

    # Remove plugin-prefixed tables and migration metadata — POST /admin/api/backup/cleanup-plugin
    def backup_cleanup_plugin(body = nil)
      @http.post("/admin/api/backup/cleanup-plugin", body)
    end

    # Wipe a specific DO's data — POST /admin/api/backup/wipe-do
    def backup_wipe_do(body = nil)
      @http.post("/admin/api/backup/wipe-do", body)
    end

    # Dump a specific DO's data — POST /admin/api/backup/dump-do
    def backup_dump_do(body = nil)
      @http.post("/admin/api/backup/dump-do", body)
    end

    # Restore a specific DO's data — POST /admin/api/backup/restore-do
    def backup_restore_do(body = nil)
      @http.post("/admin/api/backup/restore-do", body)
    end

    # Dump auth database tables — POST /admin/api/backup/dump-d1
    def backup_dump_d1()
      @http.post("/admin/api/backup/dump-d1")
    end

    # Restore auth database tables — POST /admin/api/backup/restore-d1
    def backup_restore_d1(body = nil)
      @http.post("/admin/api/backup/restore-d1", body)
    end

    # Dump control-plane D1 tables — POST /admin/api/backup/dump-control-d1
    def backup_dump_control_d1()
      @http.post("/admin/api/backup/dump-control-d1")
    end

    # Restore control-plane D1 tables — POST /admin/api/backup/restore-control-d1
    def backup_restore_control_d1(body = nil)
      @http.post("/admin/api/backup/restore-control-d1", body)
    end

    # Dump all tables from a data namespace — POST /admin/api/backup/dump-data
    def backup_dump_data(body = nil)
      @http.post("/admin/api/backup/dump-data", body)
    end

    # Restore all tables into a data namespace — POST /admin/api/backup/restore-data
    def backup_restore_data(body = nil)
      @http.post("/admin/api/backup/restore-data", body)
    end

    # Dump R2 storage (list or download) — POST /admin/api/backup/dump-storage
    def backup_dump_storage(query: nil)
      @http.get("/admin/api/backup/dump-storage", params: query)
    end

    # Restore R2 storage (wipe or upload) — POST /admin/api/backup/restore-storage
    def backup_restore_storage(query: nil)
      @http.get("/admin/api/backup/restore-storage", params: query)
    end

    # Resync _users_public from _users in AUTH_DB D1 — POST /admin/api/backup/resync-users-public
    def backup_resync_users_public()
      @http.post("/admin/api/backup/resync-users-public")
    end

    # Export a single table as JSON — GET /admin/api/backup/export/{name}
    def backup_export_table(name, query: nil)
      @http.get("/admin/api/backup/export/#{CGI.escape(name).gsub('+', '%20')}", params: query)
    end
  end
end
