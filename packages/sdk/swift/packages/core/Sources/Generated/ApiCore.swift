// Auto-generated core API Core — DO NOT EDIT.
// Regenerate: npx tsx tools/sdk-codegen/generate.ts
// Source: openapi.json (0.1.0)

import Foundation

private func edgebaseEncodePathParam(_ value: String) -> String {
    var allowed = CharacterSet.alphanumerics
    allowed.insert(charactersIn: "-._~")
    return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
}

/// Auto-generated API methods.
public struct GeneratedDbApi {
    private let http: HttpClient

    public init(http: HttpClient) {
        self.http = http
    }

    /// Health check — GET /api/health
    public func getHealth() async throws -> Any {
        return try await http.get("/health")
    }

    /// Sign up with email and password — POST /api/auth/signup
    public func authSignup(_ body: [String: Any]) async throws -> Any {
        return try await http.post("/auth/signup", body)
    }

    /// Sign in with email and password — POST /api/auth/signin
    public func authSignin(_ body: [String: Any]) async throws -> Any {
        return try await http.post("/auth/signin", body)
    }

    /// Sign in anonymously — POST /api/auth/signin/anonymous
    public func authSigninAnonymous(_ body: [String: Any]) async throws -> Any {
        return try await http.post("/auth/signin/anonymous", body)
    }

    /// Send magic link to email — POST /api/auth/signin/magic-link
    public func authSigninMagicLink(_ body: [String: Any]) async throws -> Any {
        return try await http.post("/auth/signin/magic-link", body)
    }

    /// Verify magic link token — POST /api/auth/verify-magic-link
    public func authVerifyMagicLink(_ body: [String: Any]) async throws -> Any {
        return try await http.post("/auth/verify-magic-link", body)
    }

    /// Send OTP SMS to phone number — POST /api/auth/signin/phone
    public func authSigninPhone(_ body: [String: Any]) async throws -> Any {
        return try await http.post("/auth/signin/phone", body)
    }

    /// Verify phone OTP and create session — POST /api/auth/verify-phone
    public func authVerifyPhone(_ body: [String: Any]) async throws -> Any {
        return try await http.post("/auth/verify-phone", body)
    }

    /// Link phone number to existing account — POST /api/auth/link/phone
    public func authLinkPhone(_ body: [String: Any]) async throws -> Any {
        return try await http.post("/auth/link/phone", body)
    }

    /// Verify OTP and link phone to account — POST /api/auth/verify-link-phone
    public func authVerifyLinkPhone(_ body: [String: Any]) async throws -> Any {
        return try await http.post("/auth/verify-link-phone", body)
    }

    /// Send OTP code to email — POST /api/auth/signin/email-otp
    public func authSigninEmailOtp(_ body: [String: Any]) async throws -> Any {
        return try await http.post("/auth/signin/email-otp", body)
    }

    /// Verify email OTP and create session — POST /api/auth/verify-email-otp
    public func authVerifyEmailOtp(_ body: [String: Any]) async throws -> Any {
        return try await http.post("/auth/verify-email-otp", body)
    }

    /// Enroll new TOTP factor — POST /api/auth/mfa/totp/enroll
    public func authMfaTotpEnroll() async throws -> Any {
        return try await http.post("/auth/mfa/totp/enroll", [:])
    }

    /// Confirm TOTP enrollment with code — POST /api/auth/mfa/totp/verify
    public func authMfaTotpVerify(_ body: [String: Any]) async throws -> Any {
        return try await http.post("/auth/mfa/totp/verify", body)
    }

    /// Verify MFA code during signin — POST /api/auth/mfa/verify
    public func authMfaVerify(_ body: [String: Any]) async throws -> Any {
        return try await http.post("/auth/mfa/verify", body)
    }

    /// Use recovery code during MFA signin — POST /api/auth/mfa/recovery
    public func authMfaRecovery(_ body: [String: Any]) async throws -> Any {
        return try await http.post("/auth/mfa/recovery", body)
    }

    /// Disable TOTP factor — DELETE /api/auth/mfa/totp
    public func authMfaTotpDelete(_ body: [String: Any]) async throws -> Any {
        return try await http.delete("/auth/mfa/totp", body)
    }

    /// List MFA factors for authenticated user — GET /api/auth/mfa/factors
    public func authMfaFactors() async throws -> Any {
        return try await http.get("/auth/mfa/factors")
    }

    /// Refresh access token — POST /api/auth/refresh
    public func authRefresh(_ body: [String: Any]) async throws -> Any {
        return try await http.post("/auth/refresh", body)
    }

    /// Sign out and revoke refresh token — POST /api/auth/signout
    public func authSignout(_ body: [String: Any]) async throws -> Any {
        return try await http.post("/auth/signout", body)
    }

    /// Change password for authenticated user — POST /api/auth/change-password
    public func authChangePassword(_ body: [String: Any]) async throws -> Any {
        return try await http.post("/auth/change-password", body)
    }

    /// Request email change with password confirmation — POST /api/auth/change-email
    public func authChangeEmail(_ body: [String: Any]) async throws -> Any {
        return try await http.post("/auth/change-email", body)
    }

    /// Verify email change token — POST /api/auth/verify-email-change
    public func authVerifyEmailChange(_ body: [String: Any]) async throws -> Any {
        return try await http.post("/auth/verify-email-change", body)
    }

    /// Generate passkey registration options — POST /api/auth/passkeys/register-options
    public func authPasskeysRegisterOptions() async throws -> Any {
        return try await http.post("/auth/passkeys/register-options", [:])
    }

    /// Verify and store passkey registration — POST /api/auth/passkeys/register
    public func authPasskeysRegister(_ body: [String: Any]) async throws -> Any {
        return try await http.post("/auth/passkeys/register", body)
    }

    /// Generate passkey authentication options — POST /api/auth/passkeys/auth-options
    public func authPasskeysAuthOptions(_ body: [String: Any]) async throws -> Any {
        return try await http.post("/auth/passkeys/auth-options", body)
    }

    /// Authenticate with passkey — POST /api/auth/passkeys/authenticate
    public func authPasskeysAuthenticate(_ body: [String: Any]) async throws -> Any {
        return try await http.post("/auth/passkeys/authenticate", body)
    }

    /// List passkeys for authenticated user — GET /api/auth/passkeys
    public func authPasskeysList() async throws -> Any {
        return try await http.get("/auth/passkeys")
    }

    /// Delete a passkey — DELETE /api/auth/passkeys/{credentialId}
    public func authPasskeysDelete(_ credentialId: String) async throws -> Any {
        return try await http.delete("/auth/passkeys/\(edgebaseEncodePathParam(credentialId))")
    }

    /// Get current authenticated user info — GET /api/auth/me
    public func authGetMe() async throws -> Any {
        return try await http.get("/auth/me")
    }

    /// Update user profile — PATCH /api/auth/profile
    public func authUpdateProfile(_ body: [String: Any]) async throws -> Any {
        return try await http.patch("/auth/profile", body)
    }

    /// List active sessions — GET /api/auth/sessions
    public func authGetSessions() async throws -> Any {
        return try await http.get("/auth/sessions")
    }

    /// Delete a session — DELETE /api/auth/sessions/{id}
    public func authDeleteSession(_ id: String) async throws -> Any {
        return try await http.delete("/auth/sessions/\(edgebaseEncodePathParam(id))")
    }

    /// List linked sign-in identities for the current user — GET /api/auth/identities
    public func authGetIdentities() async throws -> Any {
        return try await http.get("/auth/identities")
    }

    /// Unlink a linked sign-in identity — DELETE /api/auth/identities/{identityId}
    public func authDeleteIdentity(_ identityId: String) async throws -> Any {
        return try await http.delete("/auth/identities/\(edgebaseEncodePathParam(identityId))")
    }

    /// Link email and password to existing account — POST /api/auth/link/email
    public func authLinkEmail(_ body: [String: Any]) async throws -> Any {
        return try await http.post("/auth/link/email", body)
    }

    /// Send a verification email to the current authenticated user — POST /api/auth/request-email-verification
    public func authRequestEmailVerification(_ body: [String: Any]) async throws -> Any {
        return try await http.post("/auth/request-email-verification", body)
    }

    /// Verify email address with token — POST /api/auth/verify-email
    public func authVerifyEmail(_ body: [String: Any]) async throws -> Any {
        return try await http.post("/auth/verify-email", body)
    }

    /// Request password reset email — POST /api/auth/request-password-reset
    public func authRequestPasswordReset(_ body: [String: Any]) async throws -> Any {
        return try await http.post("/auth/request-password-reset", body)
    }

    /// Reset password with token — POST /api/auth/reset-password
    public func authResetPassword(_ body: [String: Any]) async throws -> Any {
        return try await http.post("/auth/reset-password", body)
    }

    /// Start OAuth redirect — GET /api/auth/oauth/{provider}
    public func oauthRedirect(_ provider: String) async throws -> Any {
        return try await http.get("/auth/oauth/\(edgebaseEncodePathParam(provider))")
    }

    /// OAuth callback — GET /api/auth/oauth/{provider}/callback
    public func oauthCallback(_ provider: String) async throws -> Any {
        return try await http.get("/auth/oauth/\(edgebaseEncodePathParam(provider))/callback")
    }

    /// Start OAuth account linking — POST /api/auth/oauth/link/{provider}
    public func oauthLinkStart(_ provider: String) async throws -> Any {
        return try await http.post("/auth/oauth/link/\(edgebaseEncodePathParam(provider))", [:])
    }

    /// OAuth link callback — GET /api/auth/oauth/link/{provider}/callback
    public func oauthLinkCallback(_ provider: String) async throws -> Any {
        return try await http.get("/auth/oauth/link/\(edgebaseEncodePathParam(provider))/callback")
    }

    /// Count records in a single-instance table — GET /api/db/{namespace}/tables/{table}/count
    public func dbSingleCountRecords(_ namespace: String, _ table: String, query: [String: String]? = nil) async throws -> Any {
        return try await http.get("/db/\(edgebaseEncodePathParam(namespace))/tables/\(edgebaseEncodePathParam(table))/count", queryParams: query)
    }

    /// Search records in a single-instance table — GET /api/db/{namespace}/tables/{table}/search
    public func dbSingleSearchRecords(_ namespace: String, _ table: String, query: [String: String]? = nil) async throws -> Any {
        return try await http.get("/db/\(edgebaseEncodePathParam(namespace))/tables/\(edgebaseEncodePathParam(table))/search", queryParams: query)
    }

    /// Get a single record from a single-instance table — GET /api/db/{namespace}/tables/{table}/{id}
    public func dbSingleGetRecord(_ namespace: String, _ table: String, _ id: String, query: [String: String]? = nil) async throws -> Any {
        return try await http.get("/db/\(edgebaseEncodePathParam(namespace))/tables/\(edgebaseEncodePathParam(table))/\(edgebaseEncodePathParam(id))", queryParams: query)
    }

    /// Update a record in a single-instance table — PATCH /api/db/{namespace}/tables/{table}/{id}
    public func dbSingleUpdateRecord(_ namespace: String, _ table: String, _ id: String, _ body: [String: Any]) async throws -> Any {
        return try await http.patch("/db/\(edgebaseEncodePathParam(namespace))/tables/\(edgebaseEncodePathParam(table))/\(edgebaseEncodePathParam(id))", body)
    }

    /// Delete a record from a single-instance table — DELETE /api/db/{namespace}/tables/{table}/{id}
    public func dbSingleDeleteRecord(_ namespace: String, _ table: String, _ id: String) async throws -> Any {
        return try await http.delete("/db/\(edgebaseEncodePathParam(namespace))/tables/\(edgebaseEncodePathParam(table))/\(edgebaseEncodePathParam(id))")
    }

    /// List records from a single-instance table — GET /api/db/{namespace}/tables/{table}
    public func dbSingleListRecords(_ namespace: String, _ table: String, query: [String: String]? = nil) async throws -> Any {
        return try await http.get("/db/\(edgebaseEncodePathParam(namespace))/tables/\(edgebaseEncodePathParam(table))", queryParams: query)
    }

    /// Insert a record into a single-instance table — POST /api/db/{namespace}/tables/{table}
    public func dbSingleInsertRecord(_ namespace: String, _ table: String, _ body: [String: Any], query: [String: String]? = nil) async throws -> Any {
        return try await http.post("/db/\(edgebaseEncodePathParam(namespace))/tables/\(edgebaseEncodePathParam(table))", body, queryParams: query)
    }

    /// Batch insert records into a single-instance table — POST /api/db/{namespace}/tables/{table}/batch
    public func dbSingleBatchRecords(_ namespace: String, _ table: String, _ body: [String: Any], query: [String: String]? = nil) async throws -> Any {
        return try await http.post("/db/\(edgebaseEncodePathParam(namespace))/tables/\(edgebaseEncodePathParam(table))/batch", body, queryParams: query)
    }

    /// Batch update/delete records by filter in a single-instance table — POST /api/db/{namespace}/tables/{table}/batch-by-filter
    public func dbSingleBatchByFilter(_ namespace: String, _ table: String, _ body: [String: Any], query: [String: String]? = nil) async throws -> Any {
        return try await http.post("/db/\(edgebaseEncodePathParam(namespace))/tables/\(edgebaseEncodePathParam(table))/batch-by-filter", body, queryParams: query)
    }

    /// Count records in dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/count
    public func dbCountRecords(_ namespace: String, _ instanceId: String, _ table: String, query: [String: String]? = nil) async throws -> Any {
        return try await http.get("/db/\(edgebaseEncodePathParam(namespace))/\(edgebaseEncodePathParam(instanceId))/tables/\(edgebaseEncodePathParam(table))/count", queryParams: query)
    }

    /// Search records in dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/search
    public func dbSearchRecords(_ namespace: String, _ instanceId: String, _ table: String, query: [String: String]? = nil) async throws -> Any {
        return try await http.get("/db/\(edgebaseEncodePathParam(namespace))/\(edgebaseEncodePathParam(instanceId))/tables/\(edgebaseEncodePathParam(table))/search", queryParams: query)
    }

    /// Get single record from dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/{id}
    public func dbGetRecord(_ namespace: String, _ instanceId: String, _ table: String, _ id: String, query: [String: String]? = nil) async throws -> Any {
        return try await http.get("/db/\(edgebaseEncodePathParam(namespace))/\(edgebaseEncodePathParam(instanceId))/tables/\(edgebaseEncodePathParam(table))/\(edgebaseEncodePathParam(id))", queryParams: query)
    }

    /// Update record in dynamic table — PATCH /api/db/{namespace}/{instanceId}/tables/{table}/{id}
    public func dbUpdateRecord(_ namespace: String, _ instanceId: String, _ table: String, _ id: String, _ body: [String: Any]) async throws -> Any {
        return try await http.patch("/db/\(edgebaseEncodePathParam(namespace))/\(edgebaseEncodePathParam(instanceId))/tables/\(edgebaseEncodePathParam(table))/\(edgebaseEncodePathParam(id))", body)
    }

    /// Delete record from dynamic table — DELETE /api/db/{namespace}/{instanceId}/tables/{table}/{id}
    public func dbDeleteRecord(_ namespace: String, _ instanceId: String, _ table: String, _ id: String) async throws -> Any {
        return try await http.delete("/db/\(edgebaseEncodePathParam(namespace))/\(edgebaseEncodePathParam(instanceId))/tables/\(edgebaseEncodePathParam(table))/\(edgebaseEncodePathParam(id))")
    }

    /// List records from dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}
    public func dbListRecords(_ namespace: String, _ instanceId: String, _ table: String, query: [String: String]? = nil) async throws -> Any {
        return try await http.get("/db/\(edgebaseEncodePathParam(namespace))/\(edgebaseEncodePathParam(instanceId))/tables/\(edgebaseEncodePathParam(table))", queryParams: query)
    }

    /// Insert record into dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table}
    public func dbInsertRecord(_ namespace: String, _ instanceId: String, _ table: String, _ body: [String: Any], query: [String: String]? = nil) async throws -> Any {
        return try await http.post("/db/\(edgebaseEncodePathParam(namespace))/\(edgebaseEncodePathParam(instanceId))/tables/\(edgebaseEncodePathParam(table))", body, queryParams: query)
    }

    /// Batch insert records into dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table}/batch
    public func dbBatchRecords(_ namespace: String, _ instanceId: String, _ table: String, _ body: [String: Any], query: [String: String]? = nil) async throws -> Any {
        return try await http.post("/db/\(edgebaseEncodePathParam(namespace))/\(edgebaseEncodePathParam(instanceId))/tables/\(edgebaseEncodePathParam(table))/batch", body, queryParams: query)
    }

    /// Batch update/delete records by filter in dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table}/batch-by-filter
    public func dbBatchByFilter(_ namespace: String, _ instanceId: String, _ table: String, _ body: [String: Any], query: [String: String]? = nil) async throws -> Any {
        return try await http.post("/db/\(edgebaseEncodePathParam(namespace))/\(edgebaseEncodePathParam(instanceId))/tables/\(edgebaseEncodePathParam(table))/batch-by-filter", body, queryParams: query)
    }

    /// Check database live subscription WebSocket prerequisites — GET /api/db/connect-check
    public func checkDatabaseSubscriptionConnection(query: [String: String]? = nil) async throws -> Any {
        return try await http.get("/db/connect-check", queryParams: query)
    }

    /// Connect to database live subscriptions WebSocket — GET /api/db/subscribe
    public func connectDatabaseSubscription(query: [String: String]? = nil) async throws -> Any {
        return try await http.get("/db/subscribe", queryParams: query)
    }

    /// Get table schema — GET /api/schema
    public func getSchema() async throws -> Any {
        return try await http.get("/schema")
    }

    /// Upload file — POST /api/storage/{bucket}/upload
    public func uploadFile(_ bucket: String, _ body: [String: Any]) async throws -> Any {
        return try await http.post("/storage/\(edgebaseEncodePathParam(bucket))/upload", body)
    }

    /// Get file metadata — GET /api/storage/{bucket}/{key}/metadata
    public func getFileMetadata(_ bucket: String, _ key: String) async throws -> Any {
        return try await http.get("/storage/\(edgebaseEncodePathParam(bucket))/\(edgebaseEncodePathParam(key))/metadata")
    }

    /// Update file metadata — PATCH /api/storage/{bucket}/{key}/metadata
    public func updateFileMetadata(_ bucket: String, _ key: String, _ body: [String: Any]) async throws -> Any {
        return try await http.patch("/storage/\(edgebaseEncodePathParam(bucket))/\(edgebaseEncodePathParam(key))/metadata", body)
    }

    /// Check if file exists — HEAD /api/storage/{bucket}/{key}
    public func checkFileExists(_ bucket: String, _ key: String) async -> Bool {
        return await http.head("/storage/\(edgebaseEncodePathParam(bucket))/\(edgebaseEncodePathParam(key))")
    }

    /// Download file — GET /api/storage/{bucket}/{key}
    public func downloadFile(_ bucket: String, _ key: String) async throws -> Any {
        return try await http.get("/storage/\(edgebaseEncodePathParam(bucket))/\(edgebaseEncodePathParam(key))")
    }

    /// Delete file — DELETE /api/storage/{bucket}/{key}
    public func deleteFile(_ bucket: String, _ key: String) async throws -> Any {
        return try await http.delete("/storage/\(edgebaseEncodePathParam(bucket))/\(edgebaseEncodePathParam(key))")
    }

    /// Get uploaded parts — GET /api/storage/{bucket}/uploads/{uploadId}/parts
    public func getUploadParts(_ bucket: String, _ uploadId: String, query: [String: String]? = nil) async throws -> Any {
        return try await http.get("/storage/\(edgebaseEncodePathParam(bucket))/uploads/\(edgebaseEncodePathParam(uploadId))/parts", queryParams: query)
    }

    /// List files in bucket — GET /api/storage/{bucket}
    public func listFiles(_ bucket: String) async throws -> Any {
        return try await http.get("/storage/\(edgebaseEncodePathParam(bucket))")
    }

    /// Batch delete files — POST /api/storage/{bucket}/delete-batch
    public func deleteBatch(_ bucket: String, _ body: [String: Any]) async throws -> Any {
        return try await http.post("/storage/\(edgebaseEncodePathParam(bucket))/delete-batch", body)
    }

    /// Create signed download URL — POST /api/storage/{bucket}/signed-url
    public func createSignedDownloadUrl(_ bucket: String, _ body: [String: Any]) async throws -> Any {
        return try await http.post("/storage/\(edgebaseEncodePathParam(bucket))/signed-url", body)
    }

    /// Batch create signed download URLs — POST /api/storage/{bucket}/signed-urls
    public func createSignedDownloadUrls(_ bucket: String, _ body: [String: Any]) async throws -> Any {
        return try await http.post("/storage/\(edgebaseEncodePathParam(bucket))/signed-urls", body)
    }

    /// Create signed upload URL — POST /api/storage/{bucket}/signed-upload-url
    public func createSignedUploadUrl(_ bucket: String, _ body: [String: Any]) async throws -> Any {
        return try await http.post("/storage/\(edgebaseEncodePathParam(bucket))/signed-upload-url", body)
    }

    /// Start multipart upload — POST /api/storage/{bucket}/multipart/create
    public func createMultipartUpload(_ bucket: String, _ body: [String: Any]) async throws -> Any {
        return try await http.post("/storage/\(edgebaseEncodePathParam(bucket))/multipart/create", body)
    }

    /// Upload a part — POST /api/storage/{bucket}/multipart/upload-part
    public func uploadPart(_ bucket: String, _ body: [String: Any]) async throws -> Any {
        return try await http.post("/storage/\(edgebaseEncodePathParam(bucket))/multipart/upload-part", body)
    }

    /// Complete multipart upload — POST /api/storage/{bucket}/multipart/complete
    public func completeMultipartUpload(_ bucket: String, _ body: [String: Any]) async throws -> Any {
        return try await http.post("/storage/\(edgebaseEncodePathParam(bucket))/multipart/complete", body)
    }

    /// Abort multipart upload — POST /api/storage/{bucket}/multipart/abort
    public func abortMultipartUpload(_ bucket: String, _ body: [String: Any]) async throws -> Any {
        return try await http.post("/storage/\(edgebaseEncodePathParam(bucket))/multipart/abort", body)
    }

    /// Get public configuration — GET /api/config
    public func getConfig() async throws -> Any {
        return try await http.get("/config")
    }

    /// Register push token — POST /api/push/register
    public func pushRegister(_ body: [String: Any]) async throws -> Any {
        return try await http.post("/push/register", body)
    }

    /// Unregister push token — POST /api/push/unregister
    public func pushUnregister(_ body: [String: Any]) async throws -> Any {
        return try await http.post("/push/unregister", body)
    }

    /// Subscribe token to topic — POST /api/push/topic/subscribe
    public func pushTopicSubscribe(_ body: [String: Any]) async throws -> Any {
        return try await http.post("/push/topic/subscribe", body)
    }

    /// Unsubscribe token from topic — POST /api/push/topic/unsubscribe
    public func pushTopicUnsubscribe(_ body: [String: Any]) async throws -> Any {
        return try await http.post("/push/topic/unsubscribe", body)
    }

    /// Check room WebSocket connection prerequisites — GET /api/room/connect-check
    public func checkRoomConnection(query: [String: String]? = nil) async throws -> Any {
        return try await http.get("/room/connect-check", queryParams: query)
    }

    /// Connect to room WebSocket — GET /api/room
    public func connectRoom(query: [String: String]? = nil) async throws -> Any {
        return try await http.get("/room", queryParams: query)
    }

    /// Get room metadata — GET /api/room/metadata
    public func getRoomMetadata(query: [String: String]? = nil) async throws -> Any {
        return try await http.get("/room/metadata", queryParams: query)
    }

    /// Get the active room realtime media session — GET /api/room/media/realtime/session
    public func getRoomRealtimeSession(query: [String: String]? = nil) async throws -> Any {
        return try await http.get("/room/media/realtime/session", queryParams: query)
    }

    /// Create a room realtime media session — POST /api/room/media/realtime/session
    public func createRoomRealtimeSession(_ body: [String: Any], query: [String: String]? = nil) async throws -> Any {
        return try await http.post("/room/media/realtime/session", body, queryParams: query)
    }

    /// Generate TURN / ICE credentials for room realtime media — POST /api/room/media/realtime/turn
    public func createRoomRealtimeIceServers(_ body: [String: Any], query: [String: String]? = nil) async throws -> Any {
        return try await http.post("/room/media/realtime/turn", body, queryParams: query)
    }

    /// Add realtime media tracks to a room session — POST /api/room/media/realtime/tracks/new
    public func addRoomRealtimeTracks(_ body: [String: Any], query: [String: String]? = nil) async throws -> Any {
        return try await http.post("/room/media/realtime/tracks/new", body, queryParams: query)
    }

    /// Renegotiate a room realtime media session — PUT /api/room/media/realtime/renegotiate
    public func renegotiateRoomRealtimeSession(_ body: [String: Any], query: [String: String]? = nil) async throws -> Any {
        return try await http.put("/room/media/realtime/renegotiate", body, queryParams: query)
    }

    /// Close room realtime media tracks — PUT /api/room/media/realtime/tracks/close
    public func closeRoomRealtimeTracks(_ body: [String: Any], query: [String: String]? = nil) async throws -> Any {
        return try await http.put("/room/media/realtime/tracks/close", body, queryParams: query)
    }

    /// Create a room Cloudflare RealtimeKit session — POST /api/room/media/cloudflare_realtimekit/session
    public func createRoomCloudflareRealtimeKitSession(_ body: [String: Any], query: [String: String]? = nil) async throws -> Any {
        return try await http.post("/room/media/cloudflare_realtimekit/session", body, queryParams: query)
    }

    /// Track custom events — POST /api/analytics/track
    public func trackEvents(_ body: [String: Any]) async throws -> Any {
        return try await http.post("/analytics/track", body)
    }
}

// ─── Path Constants ────────────────────────────────────────────────────────

public enum ApiPaths {
    public static let ADMIN_LOGIN = "/admin/api/auth/login"
    public static let ADMIN_REFRESH = "/admin/api/auth/refresh"
    public static let BACKUP_CLEANUP_PLUGIN = "/admin/api/backup/cleanup-plugin"
    public static let BACKUP_GET_CONFIG = "/admin/api/backup/config"
    public static let BACKUP_DUMP_CONTROL_D1 = "/admin/api/backup/dump-control-d1"
    public static let BACKUP_DUMP_D1 = "/admin/api/backup/dump-d1"
    public static let BACKUP_DUMP_DATA = "/admin/api/backup/dump-data"
    public static let BACKUP_DUMP_DO = "/admin/api/backup/dump-do"
    public static let BACKUP_DUMP_STORAGE = "/admin/api/backup/dump-storage"
    public static func backupExportTable(_ name: String) -> String { "/admin/api/backup/export/\(name)" }
    public static let BACKUP_LIST_DOS = "/admin/api/backup/list-dos"
    public static let BACKUP_RESTORE_CONTROL_D1 = "/admin/api/backup/restore-control-d1"
    public static let BACKUP_RESTORE_D1 = "/admin/api/backup/restore-d1"
    public static let BACKUP_RESTORE_DATA = "/admin/api/backup/restore-data"
    public static let BACKUP_RESTORE_DO = "/admin/api/backup/restore-do"
    public static let BACKUP_RESTORE_STORAGE = "/admin/api/backup/restore-storage"
    public static let BACKUP_RESYNC_USERS_PUBLIC = "/admin/api/backup/resync-users-public"
    public static let BACKUP_WIPE_DO = "/admin/api/backup/wipe-do"
    public static let ADMIN_LIST_ADMINS = "/admin/api/data/admins"
    public static let ADMIN_CREATE_ADMIN = "/admin/api/data/admins"
    public static func adminDeleteAdmin(_ id: String) -> String { "/admin/api/data/admins/\(id)" }
    public static func adminChangePassword(_ id: String) -> String { "/admin/api/data/admins/\(id)/password" }
    public static let ADMIN_GET_ANALYTICS = "/admin/api/data/analytics"
    public static let ADMIN_GET_ANALYTICS_EVENTS = "/admin/api/data/analytics/events"
    public static let ADMIN_GET_AUTH_SETTINGS = "/admin/api/data/auth/settings"
    public static let ADMIN_BACKUP_GET_CONFIG = "/admin/api/data/backup/config"
    public static let ADMIN_BACKUP_DUMP_D1 = "/admin/api/data/backup/dump-d1"
    public static let ADMIN_BACKUP_DUMP_DATA = "/admin/api/data/backup/dump-data"
    public static let ADMIN_BACKUP_DUMP_DO = "/admin/api/data/backup/dump-do"
    public static let ADMIN_BACKUP_LIST_DOS = "/admin/api/data/backup/list-dos"
    public static let ADMIN_BACKUP_RESTORE_D1 = "/admin/api/data/backup/restore-d1"
    public static let ADMIN_BACKUP_RESTORE_DATA = "/admin/api/data/backup/restore-data"
    public static let ADMIN_BACKUP_RESTORE_DO = "/admin/api/data/backup/restore-do"
    public static let ADMIN_CLEANUP_ANON = "/admin/api/data/cleanup-anon"
    public static let ADMIN_GET_CONFIG_INFO = "/admin/api/data/config-info"
    public static let ADMIN_DESTROY_APP = "/admin/api/data/destroy-app"
    public static let ADMIN_GET_DEV_INFO = "/admin/api/data/dev-info"
    public static let ADMIN_GET_EMAIL_TEMPLATES = "/admin/api/data/email/templates"
    public static let ADMIN_LIST_FUNCTIONS = "/admin/api/data/functions"
    public static let ADMIN_GET_LOGS = "/admin/api/data/logs"
    public static let ADMIN_GET_RECENT_LOGS = "/admin/api/data/logs/recent"
    public static let ADMIN_GET_MONITORING = "/admin/api/data/monitoring"
    public static func adminListNamespaceInstances(_ namespace: String) -> String { "/admin/api/data/namespaces/\(namespace)/instances" }
    public static let ADMIN_GET_OVERVIEW = "/admin/api/data/overview"
    public static let ADMIN_GET_PUSH_LOGS = "/admin/api/data/push/logs"
    public static let ADMIN_TEST_PUSH_SEND = "/admin/api/data/push/test-send"
    public static let ADMIN_GET_PUSH_TOKENS = "/admin/api/data/push/tokens"
    public static let ADMIN_RULES_TEST = "/admin/api/data/rules-test"
    public static let ADMIN_GET_SCHEMA = "/admin/api/data/schema"
    public static let ADMIN_EXECUTE_SQL = "/admin/api/data/sql"
    public static let ADMIN_LIST_BUCKETS = "/admin/api/data/storage/buckets"
    public static func adminListBucketObjects(_ name: String) -> String { "/admin/api/data/storage/buckets/\(name)/objects" }
    public static func adminGetBucketObject(_ name: String, _ key: String) -> String { "/admin/api/data/storage/buckets/\(name)/objects/\(key)" }
    public static func adminDeleteBucketObject(_ name: String, _ key: String) -> String { "/admin/api/data/storage/buckets/\(name)/objects/\(key)" }
    public static func adminCreateSignedUrl(_ name: String) -> String { "/admin/api/data/storage/buckets/\(name)/signed-url" }
    public static func adminGetBucketStats(_ name: String) -> String { "/admin/api/data/storage/buckets/\(name)/stats" }
    public static func adminUploadFile(_ name: String) -> String { "/admin/api/data/storage/buckets/\(name)/upload" }
    public static let ADMIN_LIST_TABLES = "/admin/api/data/tables"
    public static func adminExportTable(_ name: String) -> String { "/admin/api/data/tables/\(name)/export" }
    public static func adminImportTable(_ name: String) -> String { "/admin/api/data/tables/\(name)/import" }
    public static func adminGetTableRecords(_ name: String) -> String { "/admin/api/data/tables/\(name)/records" }
    public static func adminCreateTableRecord(_ name: String) -> String { "/admin/api/data/tables/\(name)/records" }
    public static func adminUpdateTableRecord(_ name: String, _ id: String) -> String { "/admin/api/data/tables/\(name)/records/\(id)" }
    public static func adminDeleteTableRecord(_ name: String, _ id: String) -> String { "/admin/api/data/tables/\(name)/records/\(id)" }
    public static let ADMIN_LIST_USERS = "/admin/api/data/users"
    public static let ADMIN_CREATE_USER = "/admin/api/data/users"
    public static func adminGetUser(_ id: String) -> String { "/admin/api/data/users/\(id)" }
    public static func adminUpdateUser(_ id: String) -> String { "/admin/api/data/users/\(id)" }
    public static func adminDeleteUser(_ id: String) -> String { "/admin/api/data/users/\(id)" }
    public static func adminDeleteUserMfa(_ id: String) -> String { "/admin/api/data/users/\(id)/mfa" }
    public static func adminGetUserProfile(_ id: String) -> String { "/admin/api/data/users/\(id)/profile" }
    public static func adminSendPasswordReset(_ id: String) -> String { "/admin/api/data/users/\(id)/send-password-reset" }
    public static func adminDeleteUserSessions(_ id: String) -> String { "/admin/api/data/users/\(id)/sessions" }
    public static let ADMIN_RESET_PASSWORD = "/admin/api/internal/reset-password"
    public static let ADMIN_SETUP = "/admin/api/setup"
    public static let ADMIN_SETUP_STATUS = "/admin/api/setup/status"
    public static let QUERY_CUSTOM_EVENTS = "/api/analytics/events"
    public static let QUERY_ANALYTICS = "/api/analytics/query"
    public static let TRACK_EVENTS = "/api/analytics/track"
    public static let ADMIN_AUTH_LIST_USERS = "/api/auth/admin/users"
    public static let ADMIN_AUTH_CREATE_USER = "/api/auth/admin/users"
    public static func adminAuthGetUser(_ id: String) -> String { "/api/auth/admin/users/\(id)" }
    public static func adminAuthUpdateUser(_ id: String) -> String { "/api/auth/admin/users/\(id)" }
    public static func adminAuthDeleteUser(_ id: String) -> String { "/api/auth/admin/users/\(id)" }
    public static func adminAuthSetClaims(_ id: String) -> String { "/api/auth/admin/users/\(id)/claims" }
    public static func adminAuthDeleteUserMfa(_ id: String) -> String { "/api/auth/admin/users/\(id)/mfa" }
    public static func adminAuthRevokeUserSessions(_ id: String) -> String { "/api/auth/admin/users/\(id)/revoke" }
    public static let ADMIN_AUTH_IMPORT_USERS = "/api/auth/admin/users/import"
    public static let AUTH_CHANGE_EMAIL = "/api/auth/change-email"
    public static let AUTH_CHANGE_PASSWORD = "/api/auth/change-password"
    public static let AUTH_GET_IDENTITIES = "/api/auth/identities"
    public static func authDeleteIdentity(_ identityId: String) -> String { "/api/auth/identities/\(identityId)" }
    public static let AUTH_LINK_EMAIL = "/api/auth/link/email"
    public static let AUTH_LINK_PHONE = "/api/auth/link/phone"
    public static let AUTH_GET_ME = "/api/auth/me"
    public static let AUTH_MFA_FACTORS = "/api/auth/mfa/factors"
    public static let AUTH_MFA_RECOVERY = "/api/auth/mfa/recovery"
    public static let AUTH_MFA_TOTP_DELETE = "/api/auth/mfa/totp"
    public static let AUTH_MFA_TOTP_ENROLL = "/api/auth/mfa/totp/enroll"
    public static let AUTH_MFA_TOTP_VERIFY = "/api/auth/mfa/totp/verify"
    public static let AUTH_MFA_VERIFY = "/api/auth/mfa/verify"
    public static func oauthRedirect(_ provider: String) -> String { "/api/auth/oauth/\(provider)" }
    public static func oauthCallback(_ provider: String) -> String { "/api/auth/oauth/\(provider)/callback" }
    public static func oauthLinkStart(_ provider: String) -> String { "/api/auth/oauth/link/\(provider)" }
    public static func oauthLinkCallback(_ provider: String) -> String { "/api/auth/oauth/link/\(provider)/callback" }
    public static let AUTH_PASSKEYS_LIST = "/api/auth/passkeys"
    public static func authPasskeysDelete(_ credentialId: String) -> String { "/api/auth/passkeys/\(credentialId)" }
    public static let AUTH_PASSKEYS_AUTH_OPTIONS = "/api/auth/passkeys/auth-options"
    public static let AUTH_PASSKEYS_AUTHENTICATE = "/api/auth/passkeys/authenticate"
    public static let AUTH_PASSKEYS_REGISTER = "/api/auth/passkeys/register"
    public static let AUTH_PASSKEYS_REGISTER_OPTIONS = "/api/auth/passkeys/register-options"
    public static let AUTH_UPDATE_PROFILE = "/api/auth/profile"
    public static let AUTH_REFRESH = "/api/auth/refresh"
    public static let AUTH_REQUEST_EMAIL_VERIFICATION = "/api/auth/request-email-verification"
    public static let AUTH_REQUEST_PASSWORD_RESET = "/api/auth/request-password-reset"
    public static let AUTH_RESET_PASSWORD = "/api/auth/reset-password"
    public static let AUTH_GET_SESSIONS = "/api/auth/sessions"
    public static func authDeleteSession(_ id: String) -> String { "/api/auth/sessions/\(id)" }
    public static let AUTH_SIGNIN = "/api/auth/signin"
    public static let AUTH_SIGNIN_ANONYMOUS = "/api/auth/signin/anonymous"
    public static let AUTH_SIGNIN_EMAIL_OTP = "/api/auth/signin/email-otp"
    public static let AUTH_SIGNIN_MAGIC_LINK = "/api/auth/signin/magic-link"
    public static let AUTH_SIGNIN_PHONE = "/api/auth/signin/phone"
    public static let AUTH_SIGNOUT = "/api/auth/signout"
    public static let AUTH_SIGNUP = "/api/auth/signup"
    public static let AUTH_VERIFY_EMAIL = "/api/auth/verify-email"
    public static let AUTH_VERIFY_EMAIL_CHANGE = "/api/auth/verify-email-change"
    public static let AUTH_VERIFY_EMAIL_OTP = "/api/auth/verify-email-otp"
    public static let AUTH_VERIFY_LINK_PHONE = "/api/auth/verify-link-phone"
    public static let AUTH_VERIFY_MAGIC_LINK = "/api/auth/verify-magic-link"
    public static let AUTH_VERIFY_PHONE = "/api/auth/verify-phone"
    public static let GET_CONFIG = "/api/config"
    public static func executeD1Query(_ database: String) -> String { "/api/d1/\(database)" }
    public static func dbListRecords(_ namespace: String, _ instanceId: String, _ table: String) -> String { "/api/db/\(namespace)/\(instanceId)/tables/\(table)" }
    public static func dbInsertRecord(_ namespace: String, _ instanceId: String, _ table: String) -> String { "/api/db/\(namespace)/\(instanceId)/tables/\(table)" }
    public static func dbGetRecord(_ namespace: String, _ instanceId: String, _ table: String, _ id: String) -> String { "/api/db/\(namespace)/\(instanceId)/tables/\(table)/\(id)" }
    public static func dbUpdateRecord(_ namespace: String, _ instanceId: String, _ table: String, _ id: String) -> String { "/api/db/\(namespace)/\(instanceId)/tables/\(table)/\(id)" }
    public static func dbDeleteRecord(_ namespace: String, _ instanceId: String, _ table: String, _ id: String) -> String { "/api/db/\(namespace)/\(instanceId)/tables/\(table)/\(id)" }
    public static func dbBatchRecords(_ namespace: String, _ instanceId: String, _ table: String) -> String { "/api/db/\(namespace)/\(instanceId)/tables/\(table)/batch" }
    public static func dbBatchByFilter(_ namespace: String, _ instanceId: String, _ table: String) -> String { "/api/db/\(namespace)/\(instanceId)/tables/\(table)/batch-by-filter" }
    public static func dbCountRecords(_ namespace: String, _ instanceId: String, _ table: String) -> String { "/api/db/\(namespace)/\(instanceId)/tables/\(table)/count" }
    public static func dbSearchRecords(_ namespace: String, _ instanceId: String, _ table: String) -> String { "/api/db/\(namespace)/\(instanceId)/tables/\(table)/search" }
    public static func dbSingleListRecords(_ namespace: String, _ table: String) -> String { "/api/db/\(namespace)/tables/\(table)" }
    public static func dbSingleInsertRecord(_ namespace: String, _ table: String) -> String { "/api/db/\(namespace)/tables/\(table)" }
    public static func dbSingleGetRecord(_ namespace: String, _ table: String, _ id: String) -> String { "/api/db/\(namespace)/tables/\(table)/\(id)" }
    public static func dbSingleUpdateRecord(_ namespace: String, _ table: String, _ id: String) -> String { "/api/db/\(namespace)/tables/\(table)/\(id)" }
    public static func dbSingleDeleteRecord(_ namespace: String, _ table: String, _ id: String) -> String { "/api/db/\(namespace)/tables/\(table)/\(id)" }
    public static func dbSingleBatchRecords(_ namespace: String, _ table: String) -> String { "/api/db/\(namespace)/tables/\(table)/batch" }
    public static func dbSingleBatchByFilter(_ namespace: String, _ table: String) -> String { "/api/db/\(namespace)/tables/\(table)/batch-by-filter" }
    public static func dbSingleCountRecords(_ namespace: String, _ table: String) -> String { "/api/db/\(namespace)/tables/\(table)/count" }
    public static func dbSingleSearchRecords(_ namespace: String, _ table: String) -> String { "/api/db/\(namespace)/tables/\(table)/search" }
    public static let DATABASE_LIVE_BROADCAST = "/api/db/broadcast"
    public static let CHECK_DATABASE_SUBSCRIPTION_CONNECTION = "/api/db/connect-check"
    public static let CONNECT_DATABASE_SUBSCRIPTION = "/api/db/subscribe"
    public static let GET_HEALTH = "/api/health"
    public static func kvOperation(_ namespace: String) -> String { "/api/kv/\(namespace)" }
    public static let PUSH_BROADCAST = "/api/push/broadcast"
    public static let GET_PUSH_LOGS = "/api/push/logs"
    public static let PUSH_REGISTER = "/api/push/register"
    public static let PUSH_SEND = "/api/push/send"
    public static let PUSH_SEND_MANY = "/api/push/send-many"
    public static let PUSH_SEND_TO_TOKEN = "/api/push/send-to-token"
    public static let PUSH_SEND_TO_TOPIC = "/api/push/send-to-topic"
    public static let GET_PUSH_TOKENS = "/api/push/tokens"
    public static let PUT_PUSH_TOKENS = "/api/push/tokens"
    public static let PATCH_PUSH_TOKENS = "/api/push/tokens"
    public static let PUSH_TOPIC_SUBSCRIBE = "/api/push/topic/subscribe"
    public static let PUSH_TOPIC_UNSUBSCRIBE = "/api/push/topic/unsubscribe"
    public static let PUSH_UNREGISTER = "/api/push/unregister"
    public static let CONNECT_ROOM = "/api/room"
    public static let CHECK_ROOM_CONNECTION = "/api/room/connect-check"
    public static let CREATE_ROOM_CLOUDFLARE_REALTIME_KIT_SESSION = "/api/room/media/cloudflare_realtimekit/session"
    public static let RENEGOTIATE_ROOM_REALTIME_SESSION = "/api/room/media/realtime/renegotiate"
    public static let GET_ROOM_REALTIME_SESSION = "/api/room/media/realtime/session"
    public static let CREATE_ROOM_REALTIME_SESSION = "/api/room/media/realtime/session"
    public static let CLOSE_ROOM_REALTIME_TRACKS = "/api/room/media/realtime/tracks/close"
    public static let ADD_ROOM_REALTIME_TRACKS = "/api/room/media/realtime/tracks/new"
    public static let CREATE_ROOM_REALTIME_ICE_SERVERS = "/api/room/media/realtime/turn"
    public static let GET_ROOM_METADATA = "/api/room/metadata"
    public static let GET_SCHEMA = "/api/schema"
    public static let EXECUTE_SQL = "/api/sql"
    public static func listFiles(_ bucket: String) -> String { "/api/storage/\(bucket)" }
    public static func checkFileExists(_ bucket: String, _ key: String) -> String { "/api/storage/\(bucket)/\(key)" }
    public static func downloadFile(_ bucket: String, _ key: String) -> String { "/api/storage/\(bucket)/\(key)" }
    public static func deleteFile(_ bucket: String, _ key: String) -> String { "/api/storage/\(bucket)/\(key)" }
    public static func getFileMetadata(_ bucket: String, _ key: String) -> String { "/api/storage/\(bucket)/\(key)/metadata" }
    public static func updateFileMetadata(_ bucket: String, _ key: String) -> String { "/api/storage/\(bucket)/\(key)/metadata" }
    public static func deleteBatch(_ bucket: String) -> String { "/api/storage/\(bucket)/delete-batch" }
    public static func abortMultipartUpload(_ bucket: String) -> String { "/api/storage/\(bucket)/multipart/abort" }
    public static func completeMultipartUpload(_ bucket: String) -> String { "/api/storage/\(bucket)/multipart/complete" }
    public static func createMultipartUpload(_ bucket: String) -> String { "/api/storage/\(bucket)/multipart/create" }
    public static func uploadPart(_ bucket: String) -> String { "/api/storage/\(bucket)/multipart/upload-part" }
    public static func createSignedUploadUrl(_ bucket: String) -> String { "/api/storage/\(bucket)/signed-upload-url" }
    public static func createSignedDownloadUrl(_ bucket: String) -> String { "/api/storage/\(bucket)/signed-url" }
    public static func createSignedDownloadUrls(_ bucket: String) -> String { "/api/storage/\(bucket)/signed-urls" }
    public static func uploadFile(_ bucket: String) -> String { "/api/storage/\(bucket)/upload" }
    public static func getUploadParts(_ bucket: String, _ uploadId: String) -> String { "/api/storage/\(bucket)/uploads/\(uploadId)/parts" }
    public static func vectorizeOperation(_ index: String) -> String { "/api/vectorize/\(index)" }
}
