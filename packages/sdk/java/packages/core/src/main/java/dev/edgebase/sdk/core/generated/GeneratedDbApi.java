// Auto-generated core API Core — DO NOT EDIT.
// Regenerate: npx tsx tools/sdk-codegen/generate.ts
// Source: openapi.json (0.1.0)

package dev.edgebase.sdk.core.generated;

import dev.edgebase.sdk.core.HttpClient;
import dev.edgebase.sdk.core.EdgeBaseError;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * Auto-generated API methods.
 */
public class GeneratedDbApi {
    private final HttpClient http;

    public GeneratedDbApi(HttpClient http) {
        this.http = http;
    }

    private static String encodePathParam(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
    }

    /** Health check — GET /api/health */
    public Object getHealth() throws EdgeBaseError {
        return http.get("/health");
    }

    /** Sign up with email and password — POST /api/auth/signup */
    public Object authSignup(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/auth/signup", body);
    }

    /** Sign in with email and password — POST /api/auth/signin */
    public Object authSignin(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/auth/signin", body);
    }

    /** Sign in anonymously — POST /api/auth/signin/anonymous */
    public Object authSigninAnonymous(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/auth/signin/anonymous", body);
    }

    /** Send magic link to email — POST /api/auth/signin/magic-link */
    public Object authSigninMagicLink(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/auth/signin/magic-link", body);
    }

    /** Verify magic link token — POST /api/auth/verify-magic-link */
    public Object authVerifyMagicLink(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/auth/verify-magic-link", body);
    }

    /** Send OTP SMS to phone number — POST /api/auth/signin/phone */
    public Object authSigninPhone(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/auth/signin/phone", body);
    }

    /** Verify phone OTP and create session — POST /api/auth/verify-phone */
    public Object authVerifyPhone(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/auth/verify-phone", body);
    }

    /** Link phone number to existing account — POST /api/auth/link/phone */
    public Object authLinkPhone(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/auth/link/phone", body);
    }

    /** Verify OTP and link phone to account — POST /api/auth/verify-link-phone */
    public Object authVerifyLinkPhone(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/auth/verify-link-phone", body);
    }

    /** Send OTP code to email — POST /api/auth/signin/email-otp */
    public Object authSigninEmailOtp(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/auth/signin/email-otp", body);
    }

    /** Verify email OTP and create session — POST /api/auth/verify-email-otp */
    public Object authVerifyEmailOtp(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/auth/verify-email-otp", body);
    }

    /** Enroll new TOTP factor — POST /api/auth/mfa/totp/enroll */
    public Object authMfaTotpEnroll() throws EdgeBaseError {
        return http.post("/auth/mfa/totp/enroll", null);
    }

    /** Confirm TOTP enrollment with code — POST /api/auth/mfa/totp/verify */
    public Object authMfaTotpVerify(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/auth/mfa/totp/verify", body);
    }

    /** Verify MFA code during signin — POST /api/auth/mfa/verify */
    public Object authMfaVerify(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/auth/mfa/verify", body);
    }

    /** Use recovery code during MFA signin — POST /api/auth/mfa/recovery */
    public Object authMfaRecovery(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/auth/mfa/recovery", body);
    }

    /** Disable TOTP factor — DELETE /api/auth/mfa/totp */
    public Object authMfaTotpDelete(Map<String, ?> body) throws EdgeBaseError {
        return http.delete("/auth/mfa/totp", body);
    }

    /** List MFA factors for authenticated user — GET /api/auth/mfa/factors */
    public Object authMfaFactors() throws EdgeBaseError {
        return http.get("/auth/mfa/factors");
    }

    /** Refresh access token — POST /api/auth/refresh */
    public Object authRefresh(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/auth/refresh", body);
    }

    /** Sign out and revoke refresh token — POST /api/auth/signout */
    public Object authSignout(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/auth/signout", body);
    }

    /** Change password for authenticated user — POST /api/auth/change-password */
    public Object authChangePassword(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/auth/change-password", body);
    }

    /** Request email change with password confirmation — POST /api/auth/change-email */
    public Object authChangeEmail(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/auth/change-email", body);
    }

    /** Verify email change token — POST /api/auth/verify-email-change */
    public Object authVerifyEmailChange(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/auth/verify-email-change", body);
    }

    /** Generate passkey registration options — POST /api/auth/passkeys/register-options */
    public Object authPasskeysRegisterOptions() throws EdgeBaseError {
        return http.post("/auth/passkeys/register-options", null);
    }

    /** Verify and store passkey registration — POST /api/auth/passkeys/register */
    public Object authPasskeysRegister(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/auth/passkeys/register", body);
    }

    /** Generate passkey authentication options — POST /api/auth/passkeys/auth-options */
    public Object authPasskeysAuthOptions(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/auth/passkeys/auth-options", body);
    }

    /** Authenticate with passkey — POST /api/auth/passkeys/authenticate */
    public Object authPasskeysAuthenticate(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/auth/passkeys/authenticate", body);
    }

    /** List passkeys for authenticated user — GET /api/auth/passkeys */
    public Object authPasskeysList() throws EdgeBaseError {
        return http.get("/auth/passkeys");
    }

    /** Delete a passkey — DELETE /api/auth/passkeys/{credentialId} */
    public Object authPasskeysDelete(String credentialId) throws EdgeBaseError {
        return http.delete("/auth/passkeys/" + encodePathParam(credentialId));
    }

    /** Get current authenticated user info — GET /api/auth/me */
    public Object authGetMe() throws EdgeBaseError {
        return http.get("/auth/me");
    }

    /** Update user profile — PATCH /api/auth/profile */
    public Object authUpdateProfile(Map<String, ?> body) throws EdgeBaseError {
        return http.patch("/auth/profile", body);
    }

    /** List active sessions — GET /api/auth/sessions */
    public Object authGetSessions() throws EdgeBaseError {
        return http.get("/auth/sessions");
    }

    /** Delete a session — DELETE /api/auth/sessions/{id} */
    public Object authDeleteSession(String id) throws EdgeBaseError {
        return http.delete("/auth/sessions/" + encodePathParam(id));
    }

    /** List linked sign-in identities for the current user — GET /api/auth/identities */
    public Object authGetIdentities() throws EdgeBaseError {
        return http.get("/auth/identities");
    }

    /** Unlink a linked sign-in identity — DELETE /api/auth/identities/{identityId} */
    public Object authDeleteIdentity(String identityId) throws EdgeBaseError {
        return http.delete("/auth/identities/" + encodePathParam(identityId));
    }

    /** Link email and password to existing account — POST /api/auth/link/email */
    public Object authLinkEmail(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/auth/link/email", body);
    }

    /** Send a verification email to the current authenticated user — POST /api/auth/request-email-verification */
    public Object authRequestEmailVerification(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/auth/request-email-verification", body);
    }

    /** Verify email address with token — POST /api/auth/verify-email */
    public Object authVerifyEmail(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/auth/verify-email", body);
    }

    /** Request password reset email — POST /api/auth/request-password-reset */
    public Object authRequestPasswordReset(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/auth/request-password-reset", body);
    }

    /** Reset password with token — POST /api/auth/reset-password */
    public Object authResetPassword(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/auth/reset-password", body);
    }

    /** Start OAuth redirect — GET /api/auth/oauth/{provider} */
    public Object oauthRedirect(String provider) throws EdgeBaseError {
        return http.get("/auth/oauth/" + encodePathParam(provider));
    }

    /** OAuth callback — GET /api/auth/oauth/{provider}/callback */
    public Object oauthCallback(String provider) throws EdgeBaseError {
        return http.get("/auth/oauth/" + encodePathParam(provider) + "/callback");
    }

    /** Start OAuth account linking — POST /api/auth/oauth/link/{provider} */
    public Object oauthLinkStart(String provider) throws EdgeBaseError {
        return http.post("/auth/oauth/link/" + encodePathParam(provider), null);
    }

    /** OAuth link callback — GET /api/auth/oauth/link/{provider}/callback */
    public Object oauthLinkCallback(String provider) throws EdgeBaseError {
        return http.get("/auth/oauth/link/" + encodePathParam(provider) + "/callback");
    }

    /** Count records in dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/count */
    public Object dbCountRecords(String namespace, String instanceId, String table, Map<String, String> query) throws EdgeBaseError {
        return http.getWithQuery("/db/" + encodePathParam(namespace) + "/" + encodePathParam(instanceId) + "/tables/" + encodePathParam(table) + "/count", query);
    }

    /** Search records in dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/search */
    public Object dbSearchRecords(String namespace, String instanceId, String table, Map<String, String> query) throws EdgeBaseError {
        return http.getWithQuery("/db/" + encodePathParam(namespace) + "/" + encodePathParam(instanceId) + "/tables/" + encodePathParam(table) + "/search", query);
    }

    /** Get single record from dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/{id} */
    public Object dbGetRecord(String namespace, String instanceId, String table, String id, Map<String, String> query) throws EdgeBaseError {
        return http.getWithQuery("/db/" + encodePathParam(namespace) + "/" + encodePathParam(instanceId) + "/tables/" + encodePathParam(table) + "/" + encodePathParam(id), query);
    }

    /** Update record in dynamic table — PATCH /api/db/{namespace}/{instanceId}/tables/{table}/{id} */
    public Object dbUpdateRecord(String namespace, String instanceId, String table, String id, Map<String, ?> body) throws EdgeBaseError {
        return http.patch("/db/" + encodePathParam(namespace) + "/" + encodePathParam(instanceId) + "/tables/" + encodePathParam(table) + "/" + encodePathParam(id), body);
    }

    /** Delete record from dynamic table — DELETE /api/db/{namespace}/{instanceId}/tables/{table}/{id} */
    public Object dbDeleteRecord(String namespace, String instanceId, String table, String id) throws EdgeBaseError {
        return http.delete("/db/" + encodePathParam(namespace) + "/" + encodePathParam(instanceId) + "/tables/" + encodePathParam(table) + "/" + encodePathParam(id));
    }

    /** List records from dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table} */
    public Object dbListRecords(String namespace, String instanceId, String table, Map<String, String> query) throws EdgeBaseError {
        return http.getWithQuery("/db/" + encodePathParam(namespace) + "/" + encodePathParam(instanceId) + "/tables/" + encodePathParam(table), query);
    }

    /** Insert record into dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table} */
    public Object dbInsertRecord(String namespace, String instanceId, String table, Map<String, ?> body, Map<String, String> query) throws EdgeBaseError {
        return http.postWithQuery("/db/" + encodePathParam(namespace) + "/" + encodePathParam(instanceId) + "/tables/" + encodePathParam(table), body, query);
    }

    /** Batch insert records into dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table}/batch */
    public Object dbBatchRecords(String namespace, String instanceId, String table, Map<String, ?> body, Map<String, String> query) throws EdgeBaseError {
        return http.postWithQuery("/db/" + encodePathParam(namespace) + "/" + encodePathParam(instanceId) + "/tables/" + encodePathParam(table) + "/batch", body, query);
    }

    /** Batch update/delete records by filter in dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table}/batch-by-filter */
    public Object dbBatchByFilter(String namespace, String instanceId, String table, Map<String, ?> body, Map<String, String> query) throws EdgeBaseError {
        return http.postWithQuery("/db/" + encodePathParam(namespace) + "/" + encodePathParam(instanceId) + "/tables/" + encodePathParam(table) + "/batch-by-filter", body, query);
    }

    /** Check database live subscription WebSocket prerequisites — GET /api/db/connect-check */
    public Object checkDatabaseSubscriptionConnection(Map<String, String> query) throws EdgeBaseError {
        return http.getWithQuery("/db/connect-check", query);
    }

    /** Connect to database live subscriptions WebSocket — GET /api/db/subscribe */
    public Object connectDatabaseSubscription(Map<String, String> query) throws EdgeBaseError {
        return http.getWithQuery("/db/subscribe", query);
    }

    /** Get table schema — GET /api/schema */
    public Object getSchema() throws EdgeBaseError {
        return http.get("/schema");
    }

    /** Upload file — POST /api/storage/{bucket}/upload */
    public Object uploadFile(String bucket, Map<String, ?> body) throws EdgeBaseError {
        return http.post("/storage/" + encodePathParam(bucket) + "/upload", body);
    }

    /** Get file metadata — GET /api/storage/{bucket}/{key}/metadata */
    public Object getFileMetadata(String bucket, String key) throws EdgeBaseError {
        return http.get("/storage/" + encodePathParam(bucket) + "/" + encodePathParam(key) + "/metadata");
    }

    /** Update file metadata — PATCH /api/storage/{bucket}/{key}/metadata */
    public Object updateFileMetadata(String bucket, String key, Map<String, ?> body) throws EdgeBaseError {
        return http.patch("/storage/" + encodePathParam(bucket) + "/" + encodePathParam(key) + "/metadata", body);
    }

    /** Check if file exists — HEAD /api/storage/{bucket}/{key} */
    public boolean checkFileExists(String bucket, String key) throws EdgeBaseError {
        return http.head("/storage/" + encodePathParam(bucket) + "/" + encodePathParam(key));
    }

    /** Download file — GET /api/storage/{bucket}/{key} */
    public Object downloadFile(String bucket, String key) throws EdgeBaseError {
        return http.get("/storage/" + encodePathParam(bucket) + "/" + encodePathParam(key));
    }

    /** Delete file — DELETE /api/storage/{bucket}/{key} */
    public Object deleteFile(String bucket, String key) throws EdgeBaseError {
        return http.delete("/storage/" + encodePathParam(bucket) + "/" + encodePathParam(key));
    }

    /** Get uploaded parts — GET /api/storage/{bucket}/uploads/{uploadId}/parts */
    public Object getUploadParts(String bucket, String uploadId, Map<String, String> query) throws EdgeBaseError {
        return http.getWithQuery("/storage/" + encodePathParam(bucket) + "/uploads/" + encodePathParam(uploadId) + "/parts", query);
    }

    /** List files in bucket — GET /api/storage/{bucket} */
    public Object listFiles(String bucket) throws EdgeBaseError {
        return http.get("/storage/" + encodePathParam(bucket));
    }

    /** Batch delete files — POST /api/storage/{bucket}/delete-batch */
    public Object deleteBatch(String bucket, Map<String, ?> body) throws EdgeBaseError {
        return http.post("/storage/" + encodePathParam(bucket) + "/delete-batch", body);
    }

    /** Create signed download URL — POST /api/storage/{bucket}/signed-url */
    public Object createSignedDownloadUrl(String bucket, Map<String, ?> body) throws EdgeBaseError {
        return http.post("/storage/" + encodePathParam(bucket) + "/signed-url", body);
    }

    /** Batch create signed download URLs — POST /api/storage/{bucket}/signed-urls */
    public Object createSignedDownloadUrls(String bucket, Map<String, ?> body) throws EdgeBaseError {
        return http.post("/storage/" + encodePathParam(bucket) + "/signed-urls", body);
    }

    /** Create signed upload URL — POST /api/storage/{bucket}/signed-upload-url */
    public Object createSignedUploadUrl(String bucket, Map<String, ?> body) throws EdgeBaseError {
        return http.post("/storage/" + encodePathParam(bucket) + "/signed-upload-url", body);
    }

    /** Start multipart upload — POST /api/storage/{bucket}/multipart/create */
    public Object createMultipartUpload(String bucket, Map<String, ?> body) throws EdgeBaseError {
        return http.post("/storage/" + encodePathParam(bucket) + "/multipart/create", body);
    }

    /** Upload a part — POST /api/storage/{bucket}/multipart/upload-part */
    public Object uploadPart(String bucket, Map<String, ?> body) throws EdgeBaseError {
        return http.post("/storage/" + encodePathParam(bucket) + "/multipart/upload-part", body);
    }

    /** Complete multipart upload — POST /api/storage/{bucket}/multipart/complete */
    public Object completeMultipartUpload(String bucket, Map<String, ?> body) throws EdgeBaseError {
        return http.post("/storage/" + encodePathParam(bucket) + "/multipart/complete", body);
    }

    /** Abort multipart upload — POST /api/storage/{bucket}/multipart/abort */
    public Object abortMultipartUpload(String bucket, Map<String, ?> body) throws EdgeBaseError {
        return http.post("/storage/" + encodePathParam(bucket) + "/multipart/abort", body);
    }

    /** Get public configuration — GET /api/config */
    public Object getConfig() throws EdgeBaseError {
        return http.get("/config");
    }

    /** Register push token — POST /api/push/register */
    public Object pushRegister(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/push/register", body);
    }

    /** Unregister push token — POST /api/push/unregister */
    public Object pushUnregister(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/push/unregister", body);
    }

    /** Subscribe token to topic — POST /api/push/topic/subscribe */
    public Object pushTopicSubscribe(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/push/topic/subscribe", body);
    }

    /** Unsubscribe token from topic — POST /api/push/topic/unsubscribe */
    public Object pushTopicUnsubscribe(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/push/topic/unsubscribe", body);
    }

    /** Check room WebSocket connection prerequisites — GET /api/room/connect-check */
    public Object checkRoomConnection(Map<String, String> query) throws EdgeBaseError {
        return http.getWithQuery("/room/connect-check", query);
    }

    /** Connect to room WebSocket — GET /api/room */
    public Object connectRoom(Map<String, String> query) throws EdgeBaseError {
        return http.getWithQuery("/room", query);
    }

    /** Get room metadata — GET /api/room/metadata */
    public Object getRoomMetadata(Map<String, String> query) throws EdgeBaseError {
        return http.getWithQuery("/room/metadata", query);
    }

    /** Get the active room realtime media session — GET /api/room/media/realtime/session */
    public Object getRoomRealtimeSession(Map<String, String> query) throws EdgeBaseError {
        return http.getWithQuery("/room/media/realtime/session", query);
    }

    /** Create a room realtime media session — POST /api/room/media/realtime/session */
    public Object createRoomRealtimeSession(Map<String, ?> body, Map<String, String> query) throws EdgeBaseError {
        return http.postWithQuery("/room/media/realtime/session", body, query);
    }

    /** Generate TURN / ICE credentials for room realtime media — POST /api/room/media/realtime/turn */
    public Object createRoomRealtimeIceServers(Map<String, ?> body, Map<String, String> query) throws EdgeBaseError {
        return http.postWithQuery("/room/media/realtime/turn", body, query);
    }

    /** Add realtime media tracks to a room session — POST /api/room/media/realtime/tracks/new */
    public Object addRoomRealtimeTracks(Map<String, ?> body, Map<String, String> query) throws EdgeBaseError {
        return http.postWithQuery("/room/media/realtime/tracks/new", body, query);
    }

    /** Renegotiate a room realtime media session — PUT /api/room/media/realtime/renegotiate */
    public Object renegotiateRoomRealtimeSession(Map<String, ?> body, Map<String, String> query) throws EdgeBaseError {
        return http.putWithQuery("/room/media/realtime/renegotiate", body, query);
    }

    /** Close room realtime media tracks — PUT /api/room/media/realtime/tracks/close */
    public Object closeRoomRealtimeTracks(Map<String, ?> body, Map<String, String> query) throws EdgeBaseError {
        return http.putWithQuery("/room/media/realtime/tracks/close", body, query);
    }

    /** Track custom events — POST /api/analytics/track */
    public Object trackEvents(Map<String, ?> body) throws EdgeBaseError {
        return http.post("/analytics/track", body);
    }

    /** Count records in a single-instance table — GET /api/db/{namespace}/tables/{table}/count */
    public Object dbSingleCountRecords(String namespace, String table, Map<String, String> query) throws EdgeBaseError {
        return http.getWithQuery("/db/" + encodePathParam(namespace) + "/tables/" + encodePathParam(table) + "/count", query);
    }

    /** Search records in a single-instance table — GET /api/db/{namespace}/tables/{table}/search */
    public Object dbSingleSearchRecords(String namespace, String table, Map<String, String> query) throws EdgeBaseError {
        return http.getWithQuery("/db/" + encodePathParam(namespace) + "/tables/" + encodePathParam(table) + "/search", query);
    }

    /** Get a single record from a single-instance table — GET /api/db/{namespace}/tables/{table}/{id} */
    public Object dbSingleGetRecord(String namespace, String table, String id, Map<String, String> query) throws EdgeBaseError {
        return http.getWithQuery("/db/" + encodePathParam(namespace) + "/tables/" + encodePathParam(table) + "/" + encodePathParam(id), query);
    }

    /** Update a record in a single-instance table — PATCH /api/db/{namespace}/tables/{table}/{id} */
    public Object dbSingleUpdateRecord(String namespace, String table, String id, Map<String, ?> body) throws EdgeBaseError {
        return http.patch("/db/" + encodePathParam(namespace) + "/tables/" + encodePathParam(table) + "/" + encodePathParam(id), body);
    }

    /** Delete a record from a single-instance table — DELETE /api/db/{namespace}/tables/{table}/{id} */
    public Object dbSingleDeleteRecord(String namespace, String table, String id) throws EdgeBaseError {
        return http.delete("/db/" + encodePathParam(namespace) + "/tables/" + encodePathParam(table) + "/" + encodePathParam(id));
    }

    /** List records from a single-instance table — GET /api/db/{namespace}/tables/{table} */
    public Object dbSingleListRecords(String namespace, String table, Map<String, String> query) throws EdgeBaseError {
        return http.getWithQuery("/db/" + encodePathParam(namespace) + "/tables/" + encodePathParam(table), query);
    }

    /** Insert a record into a single-instance table — POST /api/db/{namespace}/tables/{table} */
    public Object dbSingleInsertRecord(String namespace, String table, Map<String, ?> body, Map<String, String> query) throws EdgeBaseError {
        return http.postWithQuery("/db/" + encodePathParam(namespace) + "/tables/" + encodePathParam(table), body, query);
    }

    /** Batch insert records into a single-instance table — POST /api/db/{namespace}/tables/{table}/batch */
    public Object dbSingleBatchRecords(String namespace, String table, Map<String, ?> body, Map<String, String> query) throws EdgeBaseError {
        return http.postWithQuery("/db/" + encodePathParam(namespace) + "/tables/" + encodePathParam(table) + "/batch", body, query);
    }

    /** Batch update/delete records by filter in a single-instance table — POST /api/db/{namespace}/tables/{table}/batch-by-filter */
    public Object dbSingleBatchByFilter(String namespace, String table, Map<String, ?> body, Map<String, String> query) throws EdgeBaseError {
        return http.postWithQuery("/db/" + encodePathParam(namespace) + "/tables/" + encodePathParam(table) + "/batch-by-filter", body, query);
    }

    /** Create a room Cloudflare RealtimeKit session — POST /api/room/media/cloudflare_realtimekit/session */
    public Object createRoomCloudflareRealtimeKitSession(Map<String, ?> body, Map<String, String> query) throws EdgeBaseError {
        return http.postWithQuery("/room/media/cloudflare_realtimekit/session", body, query);
    }

    /**
     * Auto-generated path constants.
     */
    public static final class ApiPaths {
        private ApiPaths() {}

        public static final String ADMIN_LOGIN = "/admin/api/auth/login";
        public static final String ADMIN_REFRESH = "/admin/api/auth/refresh";
        public static final String BACKUP_CLEANUP_PLUGIN = "/admin/api/backup/cleanup-plugin";
        public static final String BACKUP_GET_CONFIG = "/admin/api/backup/config";
        public static final String BACKUP_DUMP_CONTROL_D1 = "/admin/api/backup/dump-control-d1";
        public static final String BACKUP_DUMP_D1 = "/admin/api/backup/dump-d1";
        public static final String BACKUP_DUMP_DATA = "/admin/api/backup/dump-data";
        public static final String BACKUP_DUMP_DO = "/admin/api/backup/dump-do";
        public static final String BACKUP_DUMP_STORAGE = "/admin/api/backup/dump-storage";
        public static String backupExportTable(String name) {
            return "/admin/api/backup/export/" + name;
        }
        public static final String BACKUP_LIST_DOS = "/admin/api/backup/list-dos";
        public static final String BACKUP_RESTORE_CONTROL_D1 = "/admin/api/backup/restore-control-d1";
        public static final String BACKUP_RESTORE_D1 = "/admin/api/backup/restore-d1";
        public static final String BACKUP_RESTORE_DATA = "/admin/api/backup/restore-data";
        public static final String BACKUP_RESTORE_DO = "/admin/api/backup/restore-do";
        public static final String BACKUP_RESTORE_STORAGE = "/admin/api/backup/restore-storage";
        public static final String BACKUP_RESYNC_USERS_PUBLIC = "/admin/api/backup/resync-users-public";
        public static final String BACKUP_WIPE_DO = "/admin/api/backup/wipe-do";
        public static final String ADMIN_LIST_ADMINS = "/admin/api/data/admins";
        public static final String ADMIN_CREATE_ADMIN = "/admin/api/data/admins";
        public static String adminDeleteAdmin(String id) {
            return "/admin/api/data/admins/" + id;
        }
        public static String adminChangePassword(String id) {
            return "/admin/api/data/admins/" + id + "/password";
        }
        public static final String ADMIN_GET_ANALYTICS = "/admin/api/data/analytics";
        public static final String ADMIN_GET_ANALYTICS_EVENTS = "/admin/api/data/analytics/events";
        public static final String ADMIN_GET_AUTH_SETTINGS = "/admin/api/data/auth/settings";
        public static final String ADMIN_BACKUP_GET_CONFIG = "/admin/api/data/backup/config";
        public static final String ADMIN_BACKUP_DUMP_D1 = "/admin/api/data/backup/dump-d1";
        public static final String ADMIN_BACKUP_DUMP_DO = "/admin/api/data/backup/dump-do";
        public static final String ADMIN_BACKUP_LIST_DOS = "/admin/api/data/backup/list-dos";
        public static final String ADMIN_BACKUP_RESTORE_D1 = "/admin/api/data/backup/restore-d1";
        public static final String ADMIN_BACKUP_RESTORE_DO = "/admin/api/data/backup/restore-do";
        public static final String ADMIN_CLEANUP_ANON = "/admin/api/data/cleanup-anon";
        public static final String ADMIN_GET_CONFIG_INFO = "/admin/api/data/config-info";
        public static final String ADMIN_GET_DEV_INFO = "/admin/api/data/dev-info";
        public static final String ADMIN_GET_EMAIL_TEMPLATES = "/admin/api/data/email/templates";
        public static final String ADMIN_LIST_FUNCTIONS = "/admin/api/data/functions";
        public static final String ADMIN_GET_LOGS = "/admin/api/data/logs";
        public static final String ADMIN_GET_RECENT_LOGS = "/admin/api/data/logs/recent";
        public static final String ADMIN_GET_MONITORING = "/admin/api/data/monitoring";
        public static final String ADMIN_GET_OVERVIEW = "/admin/api/data/overview";
        public static final String ADMIN_GET_PUSH_LOGS = "/admin/api/data/push/logs";
        public static final String ADMIN_TEST_PUSH_SEND = "/admin/api/data/push/test-send";
        public static final String ADMIN_GET_PUSH_TOKENS = "/admin/api/data/push/tokens";
        public static final String ADMIN_RULES_TEST = "/admin/api/data/rules-test";
        public static final String ADMIN_GET_SCHEMA = "/admin/api/data/schema";
        public static final String ADMIN_EXECUTE_SQL = "/admin/api/data/sql";
        public static final String ADMIN_LIST_BUCKETS = "/admin/api/data/storage/buckets";
        public static String adminListBucketObjects(String name) {
            return "/admin/api/data/storage/buckets/" + name + "/objects";
        }
        public static String adminGetBucketObject(String name, String key) {
            return "/admin/api/data/storage/buckets/" + name + "/objects/" + key;
        }
        public static String adminDeleteBucketObject(String name, String key) {
            return "/admin/api/data/storage/buckets/" + name + "/objects/" + key;
        }
        public static String adminCreateSignedUrl(String name) {
            return "/admin/api/data/storage/buckets/" + name + "/signed-url";
        }
        public static String adminGetBucketStats(String name) {
            return "/admin/api/data/storage/buckets/" + name + "/stats";
        }
        public static String adminUploadFile(String name) {
            return "/admin/api/data/storage/buckets/" + name + "/upload";
        }
        public static final String ADMIN_LIST_TABLES = "/admin/api/data/tables";
        public static String adminExportTable(String name) {
            return "/admin/api/data/tables/" + name + "/export";
        }
        public static String adminImportTable(String name) {
            return "/admin/api/data/tables/" + name + "/import";
        }
        public static String adminGetTableRecords(String name) {
            return "/admin/api/data/tables/" + name + "/records";
        }
        public static String adminCreateTableRecord(String name) {
            return "/admin/api/data/tables/" + name + "/records";
        }
        public static String adminUpdateTableRecord(String name, String id) {
            return "/admin/api/data/tables/" + name + "/records/" + id;
        }
        public static String adminDeleteTableRecord(String name, String id) {
            return "/admin/api/data/tables/" + name + "/records/" + id;
        }
        public static final String ADMIN_LIST_USERS = "/admin/api/data/users";
        public static final String ADMIN_CREATE_USER = "/admin/api/data/users";
        public static String adminGetUser(String id) {
            return "/admin/api/data/users/" + id;
        }
        public static String adminUpdateUser(String id) {
            return "/admin/api/data/users/" + id;
        }
        public static String adminDeleteUser(String id) {
            return "/admin/api/data/users/" + id;
        }
        public static String adminDeleteUserMfa(String id) {
            return "/admin/api/data/users/" + id + "/mfa";
        }
        public static String adminGetUserProfile(String id) {
            return "/admin/api/data/users/" + id + "/profile";
        }
        public static String adminSendPasswordReset(String id) {
            return "/admin/api/data/users/" + id + "/send-password-reset";
        }
        public static String adminDeleteUserSessions(String id) {
            return "/admin/api/data/users/" + id + "/sessions";
        }
        public static final String ADMIN_RESET_PASSWORD = "/admin/api/internal/reset-password";
        public static final String ADMIN_SETUP = "/admin/api/setup";
        public static final String ADMIN_SETUP_STATUS = "/admin/api/setup/status";
        public static final String QUERY_CUSTOM_EVENTS = "/api/analytics/events";
        public static final String QUERY_ANALYTICS = "/api/analytics/query";
        public static final String TRACK_EVENTS = "/api/analytics/track";
        public static final String ADMIN_AUTH_LIST_USERS = "/api/auth/admin/users";
        public static final String ADMIN_AUTH_CREATE_USER = "/api/auth/admin/users";
        public static String adminAuthGetUser(String id) {
            return "/api/auth/admin/users/" + id;
        }
        public static String adminAuthUpdateUser(String id) {
            return "/api/auth/admin/users/" + id;
        }
        public static String adminAuthDeleteUser(String id) {
            return "/api/auth/admin/users/" + id;
        }
        public static String adminAuthSetClaims(String id) {
            return "/api/auth/admin/users/" + id + "/claims";
        }
        public static String adminAuthDeleteUserMfa(String id) {
            return "/api/auth/admin/users/" + id + "/mfa";
        }
        public static String adminAuthRevokeUserSessions(String id) {
            return "/api/auth/admin/users/" + id + "/revoke";
        }
        public static final String ADMIN_AUTH_IMPORT_USERS = "/api/auth/admin/users/import";
        public static final String AUTH_CHANGE_EMAIL = "/api/auth/change-email";
        public static final String AUTH_CHANGE_PASSWORD = "/api/auth/change-password";
        public static final String AUTH_GET_IDENTITIES = "/api/auth/identities";
        public static String authDeleteIdentity(String identityId) {
            return "/api/auth/identities/" + identityId;
        }
        public static final String AUTH_LINK_EMAIL = "/api/auth/link/email";
        public static final String AUTH_LINK_PHONE = "/api/auth/link/phone";
        public static final String AUTH_GET_ME = "/api/auth/me";
        public static final String AUTH_MFA_FACTORS = "/api/auth/mfa/factors";
        public static final String AUTH_MFA_RECOVERY = "/api/auth/mfa/recovery";
        public static final String AUTH_MFA_TOTP_DELETE = "/api/auth/mfa/totp";
        public static final String AUTH_MFA_TOTP_ENROLL = "/api/auth/mfa/totp/enroll";
        public static final String AUTH_MFA_TOTP_VERIFY = "/api/auth/mfa/totp/verify";
        public static final String AUTH_MFA_VERIFY = "/api/auth/mfa/verify";
        public static String oauthRedirect(String provider) {
            return "/api/auth/oauth/" + provider;
        }
        public static String oauthCallback(String provider) {
            return "/api/auth/oauth/" + provider + "/callback";
        }
        public static String oauthLinkStart(String provider) {
            return "/api/auth/oauth/link/" + provider;
        }
        public static String oauthLinkCallback(String provider) {
            return "/api/auth/oauth/link/" + provider + "/callback";
        }
        public static final String AUTH_PASSKEYS_LIST = "/api/auth/passkeys";
        public static String authPasskeysDelete(String credentialId) {
            return "/api/auth/passkeys/" + credentialId;
        }
        public static final String AUTH_PASSKEYS_AUTH_OPTIONS = "/api/auth/passkeys/auth-options";
        public static final String AUTH_PASSKEYS_AUTHENTICATE = "/api/auth/passkeys/authenticate";
        public static final String AUTH_PASSKEYS_REGISTER = "/api/auth/passkeys/register";
        public static final String AUTH_PASSKEYS_REGISTER_OPTIONS = "/api/auth/passkeys/register-options";
        public static final String AUTH_UPDATE_PROFILE = "/api/auth/profile";
        public static final String AUTH_REFRESH = "/api/auth/refresh";
        public static final String AUTH_REQUEST_EMAIL_VERIFICATION = "/api/auth/request-email-verification";
        public static final String AUTH_REQUEST_PASSWORD_RESET = "/api/auth/request-password-reset";
        public static final String AUTH_RESET_PASSWORD = "/api/auth/reset-password";
        public static final String AUTH_GET_SESSIONS = "/api/auth/sessions";
        public static String authDeleteSession(String id) {
            return "/api/auth/sessions/" + id;
        }
        public static final String AUTH_SIGNIN = "/api/auth/signin";
        public static final String AUTH_SIGNIN_ANONYMOUS = "/api/auth/signin/anonymous";
        public static final String AUTH_SIGNIN_EMAIL_OTP = "/api/auth/signin/email-otp";
        public static final String AUTH_SIGNIN_MAGIC_LINK = "/api/auth/signin/magic-link";
        public static final String AUTH_SIGNIN_PHONE = "/api/auth/signin/phone";
        public static final String AUTH_SIGNOUT = "/api/auth/signout";
        public static final String AUTH_SIGNUP = "/api/auth/signup";
        public static final String AUTH_VERIFY_EMAIL = "/api/auth/verify-email";
        public static final String AUTH_VERIFY_EMAIL_CHANGE = "/api/auth/verify-email-change";
        public static final String AUTH_VERIFY_EMAIL_OTP = "/api/auth/verify-email-otp";
        public static final String AUTH_VERIFY_LINK_PHONE = "/api/auth/verify-link-phone";
        public static final String AUTH_VERIFY_MAGIC_LINK = "/api/auth/verify-magic-link";
        public static final String AUTH_VERIFY_PHONE = "/api/auth/verify-phone";
        public static final String GET_CONFIG = "/api/config";
        public static String executeD1Query(String database) {
            return "/api/d1/" + database;
        }
        public static String dbListRecords(String namespace, String instanceId, String table) {
            return "/api/db/" + namespace + "/" + instanceId + "/tables/" + table;
        }
        public static String dbInsertRecord(String namespace, String instanceId, String table) {
            return "/api/db/" + namespace + "/" + instanceId + "/tables/" + table;
        }
        public static String dbGetRecord(String namespace, String instanceId, String table, String id) {
            return "/api/db/" + namespace + "/" + instanceId + "/tables/" + table + "/" + id;
        }
        public static String dbUpdateRecord(String namespace, String instanceId, String table, String id) {
            return "/api/db/" + namespace + "/" + instanceId + "/tables/" + table + "/" + id;
        }
        public static String dbDeleteRecord(String namespace, String instanceId, String table, String id) {
            return "/api/db/" + namespace + "/" + instanceId + "/tables/" + table + "/" + id;
        }
        public static String dbBatchRecords(String namespace, String instanceId, String table) {
            return "/api/db/" + namespace + "/" + instanceId + "/tables/" + table + "/batch";
        }
        public static String dbBatchByFilter(String namespace, String instanceId, String table) {
            return "/api/db/" + namespace + "/" + instanceId + "/tables/" + table + "/batch-by-filter";
        }
        public static String dbCountRecords(String namespace, String instanceId, String table) {
            return "/api/db/" + namespace + "/" + instanceId + "/tables/" + table + "/count";
        }
        public static String dbSearchRecords(String namespace, String instanceId, String table) {
            return "/api/db/" + namespace + "/" + instanceId + "/tables/" + table + "/search";
        }
        public static String dbSingleListRecords(String namespace, String table) {
            return "/api/db/" + namespace + "/tables/" + table;
        }
        public static String dbSingleInsertRecord(String namespace, String table) {
            return "/api/db/" + namespace + "/tables/" + table;
        }
        public static String dbSingleGetRecord(String namespace, String table, String id) {
            return "/api/db/" + namespace + "/tables/" + table + "/" + id;
        }
        public static String dbSingleUpdateRecord(String namespace, String table, String id) {
            return "/api/db/" + namespace + "/tables/" + table + "/" + id;
        }
        public static String dbSingleDeleteRecord(String namespace, String table, String id) {
            return "/api/db/" + namespace + "/tables/" + table + "/" + id;
        }
        public static String dbSingleBatchRecords(String namespace, String table) {
            return "/api/db/" + namespace + "/tables/" + table + "/batch";
        }
        public static String dbSingleBatchByFilter(String namespace, String table) {
            return "/api/db/" + namespace + "/tables/" + table + "/batch-by-filter";
        }
        public static String dbSingleCountRecords(String namespace, String table) {
            return "/api/db/" + namespace + "/tables/" + table + "/count";
        }
        public static String dbSingleSearchRecords(String namespace, String table) {
            return "/api/db/" + namespace + "/tables/" + table + "/search";
        }
        public static final String DATABASE_LIVE_BROADCAST = "/api/db/broadcast";
        public static final String CHECK_DATABASE_SUBSCRIPTION_CONNECTION = "/api/db/connect-check";
        public static final String CONNECT_DATABASE_SUBSCRIPTION = "/api/db/subscribe";
        public static final String GET_HEALTH = "/api/health";
        public static String kvOperation(String namespace) {
            return "/api/kv/" + namespace;
        }
        public static final String PUSH_BROADCAST = "/api/push/broadcast";
        public static final String GET_PUSH_LOGS = "/api/push/logs";
        public static final String PUSH_REGISTER = "/api/push/register";
        public static final String PUSH_SEND = "/api/push/send";
        public static final String PUSH_SEND_MANY = "/api/push/send-many";
        public static final String PUSH_SEND_TO_TOKEN = "/api/push/send-to-token";
        public static final String PUSH_SEND_TO_TOPIC = "/api/push/send-to-topic";
        public static final String GET_PUSH_TOKENS = "/api/push/tokens";
        public static final String PUT_PUSH_TOKENS = "/api/push/tokens";
        public static final String PATCH_PUSH_TOKENS = "/api/push/tokens";
        public static final String PUSH_TOPIC_SUBSCRIBE = "/api/push/topic/subscribe";
        public static final String PUSH_TOPIC_UNSUBSCRIBE = "/api/push/topic/unsubscribe";
        public static final String PUSH_UNREGISTER = "/api/push/unregister";
        public static final String CONNECT_ROOM = "/api/room";
        public static final String CHECK_ROOM_CONNECTION = "/api/room/connect-check";
        public static final String CREATE_ROOM_CLOUDFLARE_REALTIME_KIT_SESSION = "/api/room/media/cloudflare_realtimekit/session";
        public static final String RENEGOTIATE_ROOM_REALTIME_SESSION = "/api/room/media/realtime/renegotiate";
        public static final String GET_ROOM_REALTIME_SESSION = "/api/room/media/realtime/session";
        public static final String CREATE_ROOM_REALTIME_SESSION = "/api/room/media/realtime/session";
        public static final String CLOSE_ROOM_REALTIME_TRACKS = "/api/room/media/realtime/tracks/close";
        public static final String ADD_ROOM_REALTIME_TRACKS = "/api/room/media/realtime/tracks/new";
        public static final String CREATE_ROOM_REALTIME_ICE_SERVERS = "/api/room/media/realtime/turn";
        public static final String GET_ROOM_METADATA = "/api/room/metadata";
        public static final String GET_SCHEMA = "/api/schema";
        public static final String EXECUTE_SQL = "/api/sql";
        public static String listFiles(String bucket) {
            return "/api/storage/" + bucket;
        }
        public static String checkFileExists(String bucket, String key) {
            return "/api/storage/" + bucket + "/" + key;
        }
        public static String downloadFile(String bucket, String key) {
            return "/api/storage/" + bucket + "/" + key;
        }
        public static String deleteFile(String bucket, String key) {
            return "/api/storage/" + bucket + "/" + key;
        }
        public static String getFileMetadata(String bucket, String key) {
            return "/api/storage/" + bucket + "/" + key + "/metadata";
        }
        public static String updateFileMetadata(String bucket, String key) {
            return "/api/storage/" + bucket + "/" + key + "/metadata";
        }
        public static String deleteBatch(String bucket) {
            return "/api/storage/" + bucket + "/delete-batch";
        }
        public static String abortMultipartUpload(String bucket) {
            return "/api/storage/" + bucket + "/multipart/abort";
        }
        public static String completeMultipartUpload(String bucket) {
            return "/api/storage/" + bucket + "/multipart/complete";
        }
        public static String createMultipartUpload(String bucket) {
            return "/api/storage/" + bucket + "/multipart/create";
        }
        public static String uploadPart(String bucket) {
            return "/api/storage/" + bucket + "/multipart/upload-part";
        }
        public static String createSignedUploadUrl(String bucket) {
            return "/api/storage/" + bucket + "/signed-upload-url";
        }
        public static String createSignedDownloadUrl(String bucket) {
            return "/api/storage/" + bucket + "/signed-url";
        }
        public static String createSignedDownloadUrls(String bucket) {
            return "/api/storage/" + bucket + "/signed-urls";
        }
        public static String uploadFile(String bucket) {
            return "/api/storage/" + bucket + "/upload";
        }
        public static String getUploadParts(String bucket, String uploadId) {
            return "/api/storage/" + bucket + "/uploads/" + uploadId + "/parts";
        }
        public static String vectorizeOperation(String index) {
            return "/api/vectorize/" + index;
        }
    }
}
