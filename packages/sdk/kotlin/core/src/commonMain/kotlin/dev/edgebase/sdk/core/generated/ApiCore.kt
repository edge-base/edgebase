// Auto-generated core API Core — DO NOT EDIT.
// Regenerate: npx tsx tools/sdk-codegen/generate.ts
// Source: openapi.json (0.1.0)

package dev.edgebase.sdk.core.generated

import dev.edgebase.sdk.core.HttpClient
import dev.edgebase.sdk.core.platformUrlEncode

/**
 * Auto-generated API methods.
 */
open class GeneratedDbApi(protected val http: HttpClient) {

    /** Expose the underlying HttpClient for adapter access. */
    val httpClient: HttpClient get() = http

    /** Health check — GET /api/health */
    @Suppress("UNCHECKED_CAST")
    suspend fun getHealth(): Any? =
        http.get("/health")

    /** Sign up with email and password — POST /api/auth/signup */
    @Suppress("UNCHECKED_CAST")
    suspend fun authSignup(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/auth/signup", body)

    /** Sign in with email and password — POST /api/auth/signin */
    @Suppress("UNCHECKED_CAST")
    suspend fun authSignin(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/auth/signin", body)

    /** Sign in anonymously — POST /api/auth/signin/anonymous */
    @Suppress("UNCHECKED_CAST")
    suspend fun authSigninAnonymous(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/auth/signin/anonymous", body)

    /** Send magic link to email — POST /api/auth/signin/magic-link */
    @Suppress("UNCHECKED_CAST")
    suspend fun authSigninMagicLink(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/auth/signin/magic-link", body)

    /** Verify magic link token — POST /api/auth/verify-magic-link */
    @Suppress("UNCHECKED_CAST")
    suspend fun authVerifyMagicLink(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/auth/verify-magic-link", body)

    /** Send OTP SMS to phone number — POST /api/auth/signin/phone */
    @Suppress("UNCHECKED_CAST")
    suspend fun authSigninPhone(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/auth/signin/phone", body)

    /** Verify phone OTP and create session — POST /api/auth/verify-phone */
    @Suppress("UNCHECKED_CAST")
    suspend fun authVerifyPhone(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/auth/verify-phone", body)

    /** Link phone number to existing account — POST /api/auth/link/phone */
    @Suppress("UNCHECKED_CAST")
    suspend fun authLinkPhone(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/auth/link/phone", body)

    /** Verify OTP and link phone to account — POST /api/auth/verify-link-phone */
    @Suppress("UNCHECKED_CAST")
    suspend fun authVerifyLinkPhone(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/auth/verify-link-phone", body)

    /** Send OTP code to email — POST /api/auth/signin/email-otp */
    @Suppress("UNCHECKED_CAST")
    suspend fun authSigninEmailOtp(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/auth/signin/email-otp", body)

    /** Verify email OTP and create session — POST /api/auth/verify-email-otp */
    @Suppress("UNCHECKED_CAST")
    suspend fun authVerifyEmailOtp(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/auth/verify-email-otp", body)

    /** Enroll new TOTP factor — POST /api/auth/mfa/totp/enroll */
    @Suppress("UNCHECKED_CAST")
    suspend fun authMfaTotpEnroll(): Any? =
        http.post("/auth/mfa/totp/enroll")

    /** Confirm TOTP enrollment with code — POST /api/auth/mfa/totp/verify */
    @Suppress("UNCHECKED_CAST")
    suspend fun authMfaTotpVerify(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/auth/mfa/totp/verify", body)

    /** Verify MFA code during signin — POST /api/auth/mfa/verify */
    @Suppress("UNCHECKED_CAST")
    suspend fun authMfaVerify(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/auth/mfa/verify", body)

    /** Use recovery code during MFA signin — POST /api/auth/mfa/recovery */
    @Suppress("UNCHECKED_CAST")
    suspend fun authMfaRecovery(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/auth/mfa/recovery", body)

    /** Disable TOTP factor — DELETE /api/auth/mfa/totp */
    @Suppress("UNCHECKED_CAST")
    suspend fun authMfaTotpDelete(body: Map<String, Any?> = emptyMap()): Any? =
        http.delete("/auth/mfa/totp", body)

    /** List MFA factors for authenticated user — GET /api/auth/mfa/factors */
    @Suppress("UNCHECKED_CAST")
    suspend fun authMfaFactors(): Any? =
        http.get("/auth/mfa/factors")

    /** Refresh access token — POST /api/auth/refresh */
    @Suppress("UNCHECKED_CAST")
    suspend fun authRefresh(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/auth/refresh", body)

    /** Sign out and revoke refresh token — POST /api/auth/signout */
    @Suppress("UNCHECKED_CAST")
    suspend fun authSignout(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/auth/signout", body)

    /** Change password for authenticated user — POST /api/auth/change-password */
    @Suppress("UNCHECKED_CAST")
    suspend fun authChangePassword(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/auth/change-password", body)

    /** Request email change with password confirmation — POST /api/auth/change-email */
    @Suppress("UNCHECKED_CAST")
    suspend fun authChangeEmail(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/auth/change-email", body)

    /** Verify email change token — POST /api/auth/verify-email-change */
    @Suppress("UNCHECKED_CAST")
    suspend fun authVerifyEmailChange(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/auth/verify-email-change", body)

    /** Generate passkey registration options — POST /api/auth/passkeys/register-options */
    @Suppress("UNCHECKED_CAST")
    suspend fun authPasskeysRegisterOptions(): Any? =
        http.post("/auth/passkeys/register-options")

    /** Verify and store passkey registration — POST /api/auth/passkeys/register */
    @Suppress("UNCHECKED_CAST")
    suspend fun authPasskeysRegister(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/auth/passkeys/register", body)

    /** Generate passkey authentication options — POST /api/auth/passkeys/auth-options */
    @Suppress("UNCHECKED_CAST")
    suspend fun authPasskeysAuthOptions(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/auth/passkeys/auth-options", body)

    /** Authenticate with passkey — POST /api/auth/passkeys/authenticate */
    @Suppress("UNCHECKED_CAST")
    suspend fun authPasskeysAuthenticate(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/auth/passkeys/authenticate", body)

    /** List passkeys for authenticated user — GET /api/auth/passkeys */
    @Suppress("UNCHECKED_CAST")
    suspend fun authPasskeysList(): Any? =
        http.get("/auth/passkeys")

    /** Delete a passkey — DELETE /api/auth/passkeys/{credentialId} */
    @Suppress("UNCHECKED_CAST")
    suspend fun authPasskeysDelete(credentialId: String): Any? =
        http.delete("/auth/passkeys/${platformUrlEncode(credentialId)}")

    /** Get current authenticated user info — GET /api/auth/me */
    @Suppress("UNCHECKED_CAST")
    suspend fun authGetMe(): Any? =
        http.get("/auth/me")

    /** Update user profile — PATCH /api/auth/profile */
    @Suppress("UNCHECKED_CAST")
    suspend fun authUpdateProfile(body: Map<String, Any?> = emptyMap()): Any? =
        http.patch("/auth/profile", body)

    /** List active sessions — GET /api/auth/sessions */
    @Suppress("UNCHECKED_CAST")
    suspend fun authGetSessions(): Any? =
        http.get("/auth/sessions")

    /** Delete a session — DELETE /api/auth/sessions/{id} */
    @Suppress("UNCHECKED_CAST")
    suspend fun authDeleteSession(id: String): Any? =
        http.delete("/auth/sessions/${platformUrlEncode(id)}")

    /** List linked sign-in identities for the current user — GET /api/auth/identities */
    @Suppress("UNCHECKED_CAST")
    suspend fun authGetIdentities(): Any? =
        http.get("/auth/identities")

    /** Unlink a linked sign-in identity — DELETE /api/auth/identities/{identityId} */
    @Suppress("UNCHECKED_CAST")
    suspend fun authDeleteIdentity(identityId: String): Any? =
        http.delete("/auth/identities/${platformUrlEncode(identityId)}")

    /** Link email and password to existing account — POST /api/auth/link/email */
    @Suppress("UNCHECKED_CAST")
    suspend fun authLinkEmail(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/auth/link/email", body)

    /** Send a verification email to the current authenticated user — POST /api/auth/request-email-verification */
    @Suppress("UNCHECKED_CAST")
    suspend fun authRequestEmailVerification(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/auth/request-email-verification", body)

    /** Verify email address with token — POST /api/auth/verify-email */
    @Suppress("UNCHECKED_CAST")
    suspend fun authVerifyEmail(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/auth/verify-email", body)

    /** Request password reset email — POST /api/auth/request-password-reset */
    @Suppress("UNCHECKED_CAST")
    suspend fun authRequestPasswordReset(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/auth/request-password-reset", body)

    /** Reset password with token — POST /api/auth/reset-password */
    @Suppress("UNCHECKED_CAST")
    suspend fun authResetPassword(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/auth/reset-password", body)

    /** Start OAuth redirect — GET /api/auth/oauth/{provider} */
    @Suppress("UNCHECKED_CAST")
    suspend fun oauthRedirect(provider: String): Any? =
        http.get("/auth/oauth/${platformUrlEncode(provider)}")

    /** OAuth callback — GET /api/auth/oauth/{provider}/callback */
    @Suppress("UNCHECKED_CAST")
    suspend fun oauthCallback(provider: String): Any? =
        http.get("/auth/oauth/${platformUrlEncode(provider)}/callback")

    /** Start OAuth account linking — POST /api/auth/oauth/link/{provider} */
    @Suppress("UNCHECKED_CAST")
    suspend fun oauthLinkStart(provider: String): Any? =
        http.post("/auth/oauth/link/${platformUrlEncode(provider)}")

    /** OAuth link callback — GET /api/auth/oauth/link/{provider}/callback */
    @Suppress("UNCHECKED_CAST")
    suspend fun oauthLinkCallback(provider: String): Any? =
        http.get("/auth/oauth/link/${platformUrlEncode(provider)}/callback")

    /** Count records in dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/count */
    @Suppress("UNCHECKED_CAST")
    suspend fun dbCountRecords(namespace: String, instanceId: String, table: String, query: Map<String, String>? = null): Any? =
        http.get("/db/${platformUrlEncode(namespace)}/${platformUrlEncode(instanceId)}/tables/${platformUrlEncode(table)}/count", query)

    /** Search records in dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/search */
    @Suppress("UNCHECKED_CAST")
    suspend fun dbSearchRecords(namespace: String, instanceId: String, table: String, query: Map<String, String>? = null): Any? =
        http.get("/db/${platformUrlEncode(namespace)}/${platformUrlEncode(instanceId)}/tables/${platformUrlEncode(table)}/search", query)

    /** Get single record from dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/{id} */
    @Suppress("UNCHECKED_CAST")
    suspend fun dbGetRecord(namespace: String, instanceId: String, table: String, id: String, query: Map<String, String>? = null): Any? =
        http.get("/db/${platformUrlEncode(namespace)}/${platformUrlEncode(instanceId)}/tables/${platformUrlEncode(table)}/${platformUrlEncode(id)}", query)

    /** Update record in dynamic table — PATCH /api/db/{namespace}/{instanceId}/tables/{table}/{id} */
    @Suppress("UNCHECKED_CAST")
    suspend fun dbUpdateRecord(namespace: String, instanceId: String, table: String, id: String, body: Map<String, Any?> = emptyMap()): Any? =
        http.patch("/db/${platformUrlEncode(namespace)}/${platformUrlEncode(instanceId)}/tables/${platformUrlEncode(table)}/${platformUrlEncode(id)}", body)

    /** Delete record from dynamic table — DELETE /api/db/{namespace}/{instanceId}/tables/{table}/{id} */
    @Suppress("UNCHECKED_CAST")
    suspend fun dbDeleteRecord(namespace: String, instanceId: String, table: String, id: String): Any? =
        http.delete("/db/${platformUrlEncode(namespace)}/${platformUrlEncode(instanceId)}/tables/${platformUrlEncode(table)}/${platformUrlEncode(id)}")

    /** List records from dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table} */
    @Suppress("UNCHECKED_CAST")
    suspend fun dbListRecords(namespace: String, instanceId: String, table: String, query: Map<String, String>? = null): Any? =
        http.get("/db/${platformUrlEncode(namespace)}/${platformUrlEncode(instanceId)}/tables/${platformUrlEncode(table)}", query)

    /** Insert record into dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table} */
    @Suppress("UNCHECKED_CAST")
    suspend fun dbInsertRecord(namespace: String, instanceId: String, table: String, body: Map<String, Any?> = emptyMap(), query: Map<String, String>? = null): Any? =
        http.postWithQuery("/db/${platformUrlEncode(namespace)}/${platformUrlEncode(instanceId)}/tables/${platformUrlEncode(table)}", body, query)

    /** Batch insert records into dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table}/batch */
    @Suppress("UNCHECKED_CAST")
    suspend fun dbBatchRecords(namespace: String, instanceId: String, table: String, body: Map<String, Any?> = emptyMap(), query: Map<String, String>? = null): Any? =
        http.postWithQuery("/db/${platformUrlEncode(namespace)}/${platformUrlEncode(instanceId)}/tables/${platformUrlEncode(table)}/batch", body, query)

    /** Batch update/delete records by filter in dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table}/batch-by-filter */
    @Suppress("UNCHECKED_CAST")
    suspend fun dbBatchByFilter(namespace: String, instanceId: String, table: String, body: Map<String, Any?> = emptyMap(), query: Map<String, String>? = null): Any? =
        http.postWithQuery("/db/${platformUrlEncode(namespace)}/${platformUrlEncode(instanceId)}/tables/${platformUrlEncode(table)}/batch-by-filter", body, query)

    /** Check database live subscription WebSocket prerequisites — GET /api/db/connect-check */
    @Suppress("UNCHECKED_CAST")
    suspend fun checkDatabaseSubscriptionConnection(query: Map<String, String>? = null): Any? =
        http.get("/db/connect-check", query)

    /** Connect to database live subscriptions WebSocket — GET /api/db/subscribe */
    @Suppress("UNCHECKED_CAST")
    suspend fun connectDatabaseSubscription(query: Map<String, String>? = null): Any? =
        http.get("/db/subscribe", query)

    /** Get table schema — GET /api/schema */
    @Suppress("UNCHECKED_CAST")
    suspend fun getSchema(): Any? =
        http.get("/schema")

    /** Upload file — POST /api/storage/{bucket}/upload */
    @Suppress("UNCHECKED_CAST")
    suspend fun uploadFile(bucket: String, body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/storage/${platformUrlEncode(bucket)}/upload", body)

    /** Get file metadata — GET /api/storage/{bucket}/{key}/metadata */
    @Suppress("UNCHECKED_CAST")
    suspend fun getFileMetadata(bucket: String, key: String): Any? =
        http.get("/storage/${platformUrlEncode(bucket)}/${platformUrlEncode(key)}/metadata")

    /** Update file metadata — PATCH /api/storage/{bucket}/{key}/metadata */
    @Suppress("UNCHECKED_CAST")
    suspend fun updateFileMetadata(bucket: String, key: String, body: Map<String, Any?> = emptyMap()): Any? =
        http.patch("/storage/${platformUrlEncode(bucket)}/${platformUrlEncode(key)}/metadata", body)

    /** Check if file exists — HEAD /api/storage/{bucket}/{key} */
    suspend fun checkFileExists(bucket: String, key: String): Boolean =
        http.head("/storage/${platformUrlEncode(bucket)}/${platformUrlEncode(key)}")

    /** Download file — GET /api/storage/{bucket}/{key} */
    @Suppress("UNCHECKED_CAST")
    suspend fun downloadFile(bucket: String, key: String): Any? =
        http.get("/storage/${platformUrlEncode(bucket)}/${platformUrlEncode(key)}")

    /** Delete file — DELETE /api/storage/{bucket}/{key} */
    @Suppress("UNCHECKED_CAST")
    suspend fun deleteFile(bucket: String, key: String): Any? =
        http.delete("/storage/${platformUrlEncode(bucket)}/${platformUrlEncode(key)}")

    /** Get uploaded parts — GET /api/storage/{bucket}/uploads/{uploadId}/parts */
    @Suppress("UNCHECKED_CAST")
    suspend fun getUploadParts(bucket: String, uploadId: String, query: Map<String, String>? = null): Any? =
        http.get("/storage/${platformUrlEncode(bucket)}/uploads/${platformUrlEncode(uploadId)}/parts", query)

    /** List files in bucket — GET /api/storage/{bucket} */
    @Suppress("UNCHECKED_CAST")
    suspend fun listFiles(bucket: String): Any? =
        http.get("/storage/${platformUrlEncode(bucket)}")

    /** Batch delete files — POST /api/storage/{bucket}/delete-batch */
    @Suppress("UNCHECKED_CAST")
    suspend fun deleteBatch(bucket: String, body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/storage/${platformUrlEncode(bucket)}/delete-batch", body)

    /** Create signed download URL — POST /api/storage/{bucket}/signed-url */
    @Suppress("UNCHECKED_CAST")
    suspend fun createSignedDownloadUrl(bucket: String, body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/storage/${platformUrlEncode(bucket)}/signed-url", body)

    /** Batch create signed download URLs — POST /api/storage/{bucket}/signed-urls */
    @Suppress("UNCHECKED_CAST")
    suspend fun createSignedDownloadUrls(bucket: String, body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/storage/${platformUrlEncode(bucket)}/signed-urls", body)

    /** Create signed upload URL — POST /api/storage/{bucket}/signed-upload-url */
    @Suppress("UNCHECKED_CAST")
    suspend fun createSignedUploadUrl(bucket: String, body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/storage/${platformUrlEncode(bucket)}/signed-upload-url", body)

    /** Start multipart upload — POST /api/storage/{bucket}/multipart/create */
    @Suppress("UNCHECKED_CAST")
    suspend fun createMultipartUpload(bucket: String, body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/storage/${platformUrlEncode(bucket)}/multipart/create", body)

    /** Upload a part — POST /api/storage/{bucket}/multipart/upload-part */
    @Suppress("UNCHECKED_CAST")
    suspend fun uploadPart(bucket: String, body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/storage/${platformUrlEncode(bucket)}/multipart/upload-part", body)

    /** Complete multipart upload — POST /api/storage/{bucket}/multipart/complete */
    @Suppress("UNCHECKED_CAST")
    suspend fun completeMultipartUpload(bucket: String, body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/storage/${platformUrlEncode(bucket)}/multipart/complete", body)

    /** Abort multipart upload — POST /api/storage/{bucket}/multipart/abort */
    @Suppress("UNCHECKED_CAST")
    suspend fun abortMultipartUpload(bucket: String, body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/storage/${platformUrlEncode(bucket)}/multipart/abort", body)

    /** Get public configuration — GET /api/config */
    @Suppress("UNCHECKED_CAST")
    suspend fun getConfig(): Any? =
        http.get("/config")

    /** Register push token — POST /api/push/register */
    @Suppress("UNCHECKED_CAST")
    suspend fun pushRegister(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/push/register", body)

    /** Unregister push token — POST /api/push/unregister */
    @Suppress("UNCHECKED_CAST")
    suspend fun pushUnregister(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/push/unregister", body)

    /** Subscribe token to topic — POST /api/push/topic/subscribe */
    @Suppress("UNCHECKED_CAST")
    suspend fun pushTopicSubscribe(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/push/topic/subscribe", body)

    /** Unsubscribe token from topic — POST /api/push/topic/unsubscribe */
    @Suppress("UNCHECKED_CAST")
    suspend fun pushTopicUnsubscribe(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/push/topic/unsubscribe", body)

    /** Check room WebSocket connection prerequisites — GET /api/room/connect-check */
    @Suppress("UNCHECKED_CAST")
    suspend fun checkRoomConnection(query: Map<String, String>? = null): Any? =
        http.get("/room/connect-check", query)

    /** Connect to room WebSocket — GET /api/room */
    @Suppress("UNCHECKED_CAST")
    suspend fun connectRoom(query: Map<String, String>? = null): Any? =
        http.get("/room", query)

    /** Get room metadata — GET /api/room/metadata */
    @Suppress("UNCHECKED_CAST")
    suspend fun getRoomMetadata(query: Map<String, String>? = null): Any? =
        http.get("/room/metadata", query)

    /** Get the active room realtime media session — GET /api/room/media/realtime/session */
    @Suppress("UNCHECKED_CAST")
    suspend fun getRoomRealtimeSession(query: Map<String, String>? = null): Any? =
        http.get("/room/media/realtime/session", query)

    /** Create a room realtime media session — POST /api/room/media/realtime/session */
    @Suppress("UNCHECKED_CAST")
    suspend fun createRoomRealtimeSession(body: Map<String, Any?> = emptyMap(), query: Map<String, String>? = null): Any? =
        http.postWithQuery("/room/media/realtime/session", body, query)

    /** Generate TURN / ICE credentials for room realtime media — POST /api/room/media/realtime/turn */
    @Suppress("UNCHECKED_CAST")
    suspend fun createRoomRealtimeIceServers(body: Map<String, Any?> = emptyMap(), query: Map<String, String>? = null): Any? =
        http.postWithQuery("/room/media/realtime/turn", body, query)

    /** Add realtime media tracks to a room session — POST /api/room/media/realtime/tracks/new */
    @Suppress("UNCHECKED_CAST")
    suspend fun addRoomRealtimeTracks(body: Map<String, Any?> = emptyMap(), query: Map<String, String>? = null): Any? =
        http.postWithQuery("/room/media/realtime/tracks/new", body, query)

    /** Renegotiate a room realtime media session — PUT /api/room/media/realtime/renegotiate */
    @Suppress("UNCHECKED_CAST")
    suspend fun renegotiateRoomRealtimeSession(body: Map<String, Any?> = emptyMap(), query: Map<String, String>? = null): Any? =
        http.putWithQuery("/room/media/realtime/renegotiate", body, query)

    /** Close room realtime media tracks — PUT /api/room/media/realtime/tracks/close */
    @Suppress("UNCHECKED_CAST")
    suspend fun closeRoomRealtimeTracks(body: Map<String, Any?> = emptyMap(), query: Map<String, String>? = null): Any? =
        http.putWithQuery("/room/media/realtime/tracks/close", body, query)

    /** Track custom events — POST /api/analytics/track */
    @Suppress("UNCHECKED_CAST")
    suspend fun trackEvents(body: Map<String, Any?> = emptyMap()): Any? =
        http.post("/analytics/track", body)

    /** Count records in a single-instance table — GET /api/db/{namespace}/tables/{table}/count */
    @Suppress("UNCHECKED_CAST")
    open suspend fun dbSingleCountRecords(namespace: String, table: String, query: Map<String, String>? = null): Any? =
        http.get("/db/${platformUrlEncode(namespace)}/tables/${platformUrlEncode(table)}/count", query)

    /** Search records in a single-instance table — GET /api/db/{namespace}/tables/{table}/search */
    @Suppress("UNCHECKED_CAST")
    open suspend fun dbSingleSearchRecords(namespace: String, table: String, query: Map<String, String>? = null): Any? =
        http.get("/db/${platformUrlEncode(namespace)}/tables/${platformUrlEncode(table)}/search", query)

    /** Get a single record from a single-instance table — GET /api/db/{namespace}/tables/{table}/{id} */
    @Suppress("UNCHECKED_CAST")
    open suspend fun dbSingleGetRecord(namespace: String, table: String, id: String, query: Map<String, String>? = null): Any? =
        http.get("/db/${platformUrlEncode(namespace)}/tables/${platformUrlEncode(table)}/${platformUrlEncode(id)}", query)

    /** Update a record in a single-instance table — PATCH /api/db/{namespace}/tables/{table}/{id} */
    @Suppress("UNCHECKED_CAST")
    open suspend fun dbSingleUpdateRecord(namespace: String, table: String, id: String, body: Map<String, Any?> = emptyMap()): Any? =
        http.patch("/db/${platformUrlEncode(namespace)}/tables/${platformUrlEncode(table)}/${platformUrlEncode(id)}", body)

    /** Delete a record from a single-instance table — DELETE /api/db/{namespace}/tables/{table}/{id} */
    @Suppress("UNCHECKED_CAST")
    open suspend fun dbSingleDeleteRecord(namespace: String, table: String, id: String): Any? =
        http.delete("/db/${platformUrlEncode(namespace)}/tables/${platformUrlEncode(table)}/${platformUrlEncode(id)}")

    /** List records from a single-instance table — GET /api/db/{namespace}/tables/{table} */
    @Suppress("UNCHECKED_CAST")
    open suspend fun dbSingleListRecords(namespace: String, table: String, query: Map<String, String>? = null): Any? =
        http.get("/db/${platformUrlEncode(namespace)}/tables/${platformUrlEncode(table)}", query)

    /** Insert a record into a single-instance table — POST /api/db/{namespace}/tables/{table} */
    @Suppress("UNCHECKED_CAST")
    open suspend fun dbSingleInsertRecord(namespace: String, table: String, body: Map<String, Any?> = emptyMap(), query: Map<String, String>? = null): Any? =
        http.postWithQuery("/db/${platformUrlEncode(namespace)}/tables/${platformUrlEncode(table)}", body, query)

    /** Batch insert records into a single-instance table — POST /api/db/{namespace}/tables/{table}/batch */
    @Suppress("UNCHECKED_CAST")
    open suspend fun dbSingleBatchRecords(namespace: String, table: String, body: Map<String, Any?> = emptyMap(), query: Map<String, String>? = null): Any? =
        http.postWithQuery("/db/${platformUrlEncode(namespace)}/tables/${platformUrlEncode(table)}/batch", body, query)

    /** Batch update/delete records by filter in a single-instance table — POST /api/db/{namespace}/tables/{table}/batch-by-filter */
    @Suppress("UNCHECKED_CAST")
    open suspend fun dbSingleBatchByFilter(namespace: String, table: String, body: Map<String, Any?> = emptyMap(), query: Map<String, String>? = null): Any? =
        http.postWithQuery("/db/${platformUrlEncode(namespace)}/tables/${platformUrlEncode(table)}/batch-by-filter", body, query)

    /** Create a room Cloudflare RealtimeKit session — POST /api/room/media/cloudflare_realtimekit/session */
    @Suppress("UNCHECKED_CAST")
    suspend fun createRoomCloudflareRealtimeKitSession(body: Map<String, Any?> = emptyMap(), query: Map<String, String>? = null): Any? =
        http.postWithQuery("/room/media/cloudflare_realtimekit/session", body, query)
}

/**
 * Auto-generated path constants.
 */
object ApiPaths {
    const val ADMIN_LOGIN = "/admin/api/auth/login"
    const val ADMIN_REFRESH = "/admin/api/auth/refresh"
    const val BACKUP_CLEANUP_PLUGIN = "/admin/api/backup/cleanup-plugin"
    const val BACKUP_GET_CONFIG = "/admin/api/backup/config"
    const val BACKUP_DUMP_CONTROL_D1 = "/admin/api/backup/dump-control-d1"
    const val BACKUP_DUMP_D1 = "/admin/api/backup/dump-d1"
    const val BACKUP_DUMP_DATA = "/admin/api/backup/dump-data"
    const val BACKUP_DUMP_DO = "/admin/api/backup/dump-do"
    const val BACKUP_DUMP_STORAGE = "/admin/api/backup/dump-storage"
    fun backupExportTable(name: String) = "/admin/api/backup/export/$name"
    const val BACKUP_LIST_DOS = "/admin/api/backup/list-dos"
    const val BACKUP_RESTORE_CONTROL_D1 = "/admin/api/backup/restore-control-d1"
    const val BACKUP_RESTORE_D1 = "/admin/api/backup/restore-d1"
    const val BACKUP_RESTORE_DATA = "/admin/api/backup/restore-data"
    const val BACKUP_RESTORE_DO = "/admin/api/backup/restore-do"
    const val BACKUP_RESTORE_STORAGE = "/admin/api/backup/restore-storage"
    const val BACKUP_RESYNC_USERS_PUBLIC = "/admin/api/backup/resync-users-public"
    const val BACKUP_WIPE_DO = "/admin/api/backup/wipe-do"
    const val ADMIN_LIST_ADMINS = "/admin/api/data/admins"
    const val ADMIN_CREATE_ADMIN = "/admin/api/data/admins"
    fun adminDeleteAdmin(id: String) = "/admin/api/data/admins/$id"
    fun adminChangePassword(id: String) = "/admin/api/data/admins/$id/password"
    const val ADMIN_GET_ANALYTICS = "/admin/api/data/analytics"
    const val ADMIN_GET_ANALYTICS_EVENTS = "/admin/api/data/analytics/events"
    const val ADMIN_GET_AUTH_SETTINGS = "/admin/api/data/auth/settings"
    const val ADMIN_BACKUP_GET_CONFIG = "/admin/api/data/backup/config"
    const val ADMIN_BACKUP_DUMP_D1 = "/admin/api/data/backup/dump-d1"
    const val ADMIN_BACKUP_DUMP_DO = "/admin/api/data/backup/dump-do"
    const val ADMIN_BACKUP_LIST_DOS = "/admin/api/data/backup/list-dos"
    const val ADMIN_BACKUP_RESTORE_D1 = "/admin/api/data/backup/restore-d1"
    const val ADMIN_BACKUP_RESTORE_DO = "/admin/api/data/backup/restore-do"
    const val ADMIN_CLEANUP_ANON = "/admin/api/data/cleanup-anon"
    const val ADMIN_GET_CONFIG_INFO = "/admin/api/data/config-info"
    const val ADMIN_GET_DEV_INFO = "/admin/api/data/dev-info"
    const val ADMIN_GET_EMAIL_TEMPLATES = "/admin/api/data/email/templates"
    const val ADMIN_LIST_FUNCTIONS = "/admin/api/data/functions"
    const val ADMIN_GET_LOGS = "/admin/api/data/logs"
    const val ADMIN_GET_RECENT_LOGS = "/admin/api/data/logs/recent"
    const val ADMIN_GET_MONITORING = "/admin/api/data/monitoring"
    const val ADMIN_GET_OVERVIEW = "/admin/api/data/overview"
    const val ADMIN_GET_PUSH_LOGS = "/admin/api/data/push/logs"
    const val ADMIN_TEST_PUSH_SEND = "/admin/api/data/push/test-send"
    const val ADMIN_GET_PUSH_TOKENS = "/admin/api/data/push/tokens"
    const val ADMIN_RULES_TEST = "/admin/api/data/rules-test"
    const val ADMIN_GET_SCHEMA = "/admin/api/data/schema"
    const val ADMIN_EXECUTE_SQL = "/admin/api/data/sql"
    const val ADMIN_LIST_BUCKETS = "/admin/api/data/storage/buckets"
    fun adminListBucketObjects(name: String) = "/admin/api/data/storage/buckets/$name/objects"
    fun adminGetBucketObject(name: String, key: String) = "/admin/api/data/storage/buckets/$name/objects/$key"
    fun adminDeleteBucketObject(name: String, key: String) = "/admin/api/data/storage/buckets/$name/objects/$key"
    fun adminCreateSignedUrl(name: String) = "/admin/api/data/storage/buckets/$name/signed-url"
    fun adminGetBucketStats(name: String) = "/admin/api/data/storage/buckets/$name/stats"
    fun adminUploadFile(name: String) = "/admin/api/data/storage/buckets/$name/upload"
    const val ADMIN_LIST_TABLES = "/admin/api/data/tables"
    fun adminExportTable(name: String) = "/admin/api/data/tables/$name/export"
    fun adminImportTable(name: String) = "/admin/api/data/tables/$name/import"
    fun adminGetTableRecords(name: String) = "/admin/api/data/tables/$name/records"
    fun adminCreateTableRecord(name: String) = "/admin/api/data/tables/$name/records"
    fun adminUpdateTableRecord(name: String, id: String) = "/admin/api/data/tables/$name/records/$id"
    fun adminDeleteTableRecord(name: String, id: String) = "/admin/api/data/tables/$name/records/$id"
    const val ADMIN_LIST_USERS = "/admin/api/data/users"
    const val ADMIN_CREATE_USER = "/admin/api/data/users"
    fun adminGetUser(id: String) = "/admin/api/data/users/$id"
    fun adminUpdateUser(id: String) = "/admin/api/data/users/$id"
    fun adminDeleteUser(id: String) = "/admin/api/data/users/$id"
    fun adminDeleteUserMfa(id: String) = "/admin/api/data/users/$id/mfa"
    fun adminGetUserProfile(id: String) = "/admin/api/data/users/$id/profile"
    fun adminSendPasswordReset(id: String) = "/admin/api/data/users/$id/send-password-reset"
    fun adminDeleteUserSessions(id: String) = "/admin/api/data/users/$id/sessions"
    const val ADMIN_RESET_PASSWORD = "/admin/api/internal/reset-password"
    const val ADMIN_SETUP = "/admin/api/setup"
    const val ADMIN_SETUP_STATUS = "/admin/api/setup/status"
    const val QUERY_CUSTOM_EVENTS = "/api/analytics/events"
    const val QUERY_ANALYTICS = "/api/analytics/query"
    const val TRACK_EVENTS = "/api/analytics/track"
    const val ADMIN_AUTH_LIST_USERS = "/api/auth/admin/users"
    const val ADMIN_AUTH_CREATE_USER = "/api/auth/admin/users"
    fun adminAuthGetUser(id: String) = "/api/auth/admin/users/$id"
    fun adminAuthUpdateUser(id: String) = "/api/auth/admin/users/$id"
    fun adminAuthDeleteUser(id: String) = "/api/auth/admin/users/$id"
    fun adminAuthSetClaims(id: String) = "/api/auth/admin/users/$id/claims"
    fun adminAuthDeleteUserMfa(id: String) = "/api/auth/admin/users/$id/mfa"
    fun adminAuthRevokeUserSessions(id: String) = "/api/auth/admin/users/$id/revoke"
    const val ADMIN_AUTH_IMPORT_USERS = "/api/auth/admin/users/import"
    const val AUTH_CHANGE_EMAIL = "/api/auth/change-email"
    const val AUTH_CHANGE_PASSWORD = "/api/auth/change-password"
    const val AUTH_GET_IDENTITIES = "/api/auth/identities"
    fun authDeleteIdentity(identityId: String) = "/api/auth/identities/$identityId"
    const val AUTH_LINK_EMAIL = "/api/auth/link/email"
    const val AUTH_LINK_PHONE = "/api/auth/link/phone"
    const val AUTH_GET_ME = "/api/auth/me"
    const val AUTH_MFA_FACTORS = "/api/auth/mfa/factors"
    const val AUTH_MFA_RECOVERY = "/api/auth/mfa/recovery"
    const val AUTH_MFA_TOTP_DELETE = "/api/auth/mfa/totp"
    const val AUTH_MFA_TOTP_ENROLL = "/api/auth/mfa/totp/enroll"
    const val AUTH_MFA_TOTP_VERIFY = "/api/auth/mfa/totp/verify"
    const val AUTH_MFA_VERIFY = "/api/auth/mfa/verify"
    fun oauthRedirect(provider: String) = "/api/auth/oauth/$provider"
    fun oauthCallback(provider: String) = "/api/auth/oauth/$provider/callback"
    fun oauthLinkStart(provider: String) = "/api/auth/oauth/link/$provider"
    fun oauthLinkCallback(provider: String) = "/api/auth/oauth/link/$provider/callback"
    const val AUTH_PASSKEYS_LIST = "/api/auth/passkeys"
    fun authPasskeysDelete(credentialId: String) = "/api/auth/passkeys/$credentialId"
    const val AUTH_PASSKEYS_AUTH_OPTIONS = "/api/auth/passkeys/auth-options"
    const val AUTH_PASSKEYS_AUTHENTICATE = "/api/auth/passkeys/authenticate"
    const val AUTH_PASSKEYS_REGISTER = "/api/auth/passkeys/register"
    const val AUTH_PASSKEYS_REGISTER_OPTIONS = "/api/auth/passkeys/register-options"
    const val AUTH_UPDATE_PROFILE = "/api/auth/profile"
    const val AUTH_REFRESH = "/api/auth/refresh"
    const val AUTH_REQUEST_EMAIL_VERIFICATION = "/api/auth/request-email-verification"
    const val AUTH_REQUEST_PASSWORD_RESET = "/api/auth/request-password-reset"
    const val AUTH_RESET_PASSWORD = "/api/auth/reset-password"
    const val AUTH_GET_SESSIONS = "/api/auth/sessions"
    fun authDeleteSession(id: String) = "/api/auth/sessions/$id"
    const val AUTH_SIGNIN = "/api/auth/signin"
    const val AUTH_SIGNIN_ANONYMOUS = "/api/auth/signin/anonymous"
    const val AUTH_SIGNIN_EMAIL_OTP = "/api/auth/signin/email-otp"
    const val AUTH_SIGNIN_MAGIC_LINK = "/api/auth/signin/magic-link"
    const val AUTH_SIGNIN_PHONE = "/api/auth/signin/phone"
    const val AUTH_SIGNOUT = "/api/auth/signout"
    const val AUTH_SIGNUP = "/api/auth/signup"
    const val AUTH_VERIFY_EMAIL = "/api/auth/verify-email"
    const val AUTH_VERIFY_EMAIL_CHANGE = "/api/auth/verify-email-change"
    const val AUTH_VERIFY_EMAIL_OTP = "/api/auth/verify-email-otp"
    const val AUTH_VERIFY_LINK_PHONE = "/api/auth/verify-link-phone"
    const val AUTH_VERIFY_MAGIC_LINK = "/api/auth/verify-magic-link"
    const val AUTH_VERIFY_PHONE = "/api/auth/verify-phone"
    const val GET_CONFIG = "/api/config"
    fun executeD1Query(database: String) = "/api/d1/$database"
    fun dbListRecords(namespace: String, instanceId: String, table: String) = "/api/db/$namespace/$instanceId/tables/$table"
    fun dbInsertRecord(namespace: String, instanceId: String, table: String) = "/api/db/$namespace/$instanceId/tables/$table"
    fun dbGetRecord(namespace: String, instanceId: String, table: String, id: String) = "/api/db/$namespace/$instanceId/tables/$table/$id"
    fun dbUpdateRecord(namespace: String, instanceId: String, table: String, id: String) = "/api/db/$namespace/$instanceId/tables/$table/$id"
    fun dbDeleteRecord(namespace: String, instanceId: String, table: String, id: String) = "/api/db/$namespace/$instanceId/tables/$table/$id"
    fun dbBatchRecords(namespace: String, instanceId: String, table: String) = "/api/db/$namespace/$instanceId/tables/$table/batch"
    fun dbBatchByFilter(namespace: String, instanceId: String, table: String) = "/api/db/$namespace/$instanceId/tables/$table/batch-by-filter"
    fun dbCountRecords(namespace: String, instanceId: String, table: String) = "/api/db/$namespace/$instanceId/tables/$table/count"
    fun dbSearchRecords(namespace: String, instanceId: String, table: String) = "/api/db/$namespace/$instanceId/tables/$table/search"
    fun dbSingleListRecords(namespace: String, table: String) = "/api/db/$namespace/tables/$table"
    fun dbSingleInsertRecord(namespace: String, table: String) = "/api/db/$namespace/tables/$table"
    fun dbSingleGetRecord(namespace: String, table: String, id: String) = "/api/db/$namespace/tables/$table/$id"
    fun dbSingleUpdateRecord(namespace: String, table: String, id: String) = "/api/db/$namespace/tables/$table/$id"
    fun dbSingleDeleteRecord(namespace: String, table: String, id: String) = "/api/db/$namespace/tables/$table/$id"
    fun dbSingleBatchRecords(namespace: String, table: String) = "/api/db/$namespace/tables/$table/batch"
    fun dbSingleBatchByFilter(namespace: String, table: String) = "/api/db/$namespace/tables/$table/batch-by-filter"
    fun dbSingleCountRecords(namespace: String, table: String) = "/api/db/$namespace/tables/$table/count"
    fun dbSingleSearchRecords(namespace: String, table: String) = "/api/db/$namespace/tables/$table/search"
    const val DATABASE_LIVE_BROADCAST = "/api/db/broadcast"
    const val CHECK_DATABASE_SUBSCRIPTION_CONNECTION = "/api/db/connect-check"
    const val CONNECT_DATABASE_SUBSCRIPTION = "/api/db/subscribe"
    const val GET_HEALTH = "/api/health"
    fun kvOperation(namespace: String) = "/api/kv/$namespace"
    const val PUSH_BROADCAST = "/api/push/broadcast"
    const val GET_PUSH_LOGS = "/api/push/logs"
    const val PUSH_REGISTER = "/api/push/register"
    const val PUSH_SEND = "/api/push/send"
    const val PUSH_SEND_MANY = "/api/push/send-many"
    const val PUSH_SEND_TO_TOKEN = "/api/push/send-to-token"
    const val PUSH_SEND_TO_TOPIC = "/api/push/send-to-topic"
    const val GET_PUSH_TOKENS = "/api/push/tokens"
    const val PUT_PUSH_TOKENS = "/api/push/tokens"
    const val PATCH_PUSH_TOKENS = "/api/push/tokens"
    const val PUSH_TOPIC_SUBSCRIBE = "/api/push/topic/subscribe"
    const val PUSH_TOPIC_UNSUBSCRIBE = "/api/push/topic/unsubscribe"
    const val PUSH_UNREGISTER = "/api/push/unregister"
    const val CONNECT_ROOM = "/api/room"
    const val CHECK_ROOM_CONNECTION = "/api/room/connect-check"
    const val CREATE_ROOM_CLOUDFLARE_REALTIME_KIT_SESSION = "/api/room/media/cloudflare_realtimekit/session"
    const val RENEGOTIATE_ROOM_REALTIME_SESSION = "/api/room/media/realtime/renegotiate"
    const val GET_ROOM_REALTIME_SESSION = "/api/room/media/realtime/session"
    const val CREATE_ROOM_REALTIME_SESSION = "/api/room/media/realtime/session"
    const val CLOSE_ROOM_REALTIME_TRACKS = "/api/room/media/realtime/tracks/close"
    const val ADD_ROOM_REALTIME_TRACKS = "/api/room/media/realtime/tracks/new"
    const val CREATE_ROOM_REALTIME_ICE_SERVERS = "/api/room/media/realtime/turn"
    const val GET_ROOM_METADATA = "/api/room/metadata"
    const val GET_SCHEMA = "/api/schema"
    const val EXECUTE_SQL = "/api/sql"
    fun listFiles(bucket: String) = "/api/storage/$bucket"
    fun checkFileExists(bucket: String, key: String) = "/api/storage/$bucket/$key"
    fun downloadFile(bucket: String, key: String) = "/api/storage/$bucket/$key"
    fun deleteFile(bucket: String, key: String) = "/api/storage/$bucket/$key"
    fun getFileMetadata(bucket: String, key: String) = "/api/storage/$bucket/$key/metadata"
    fun updateFileMetadata(bucket: String, key: String) = "/api/storage/$bucket/$key/metadata"
    fun deleteBatch(bucket: String) = "/api/storage/$bucket/delete-batch"
    fun abortMultipartUpload(bucket: String) = "/api/storage/$bucket/multipart/abort"
    fun completeMultipartUpload(bucket: String) = "/api/storage/$bucket/multipart/complete"
    fun createMultipartUpload(bucket: String) = "/api/storage/$bucket/multipart/create"
    fun uploadPart(bucket: String) = "/api/storage/$bucket/multipart/upload-part"
    fun createSignedUploadUrl(bucket: String) = "/api/storage/$bucket/signed-upload-url"
    fun createSignedDownloadUrl(bucket: String) = "/api/storage/$bucket/signed-url"
    fun createSignedDownloadUrls(bucket: String) = "/api/storage/$bucket/signed-urls"
    fun uploadFile(bucket: String) = "/api/storage/$bucket/upload"
    fun getUploadParts(bucket: String, uploadId: String) = "/api/storage/$bucket/uploads/$uploadId/parts"
    fun vectorizeOperation(index: String) = "/api/vectorize/$index"
}
