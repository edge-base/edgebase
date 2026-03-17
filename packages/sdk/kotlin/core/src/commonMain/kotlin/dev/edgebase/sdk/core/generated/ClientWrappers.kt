// Auto-generated client wrapper methods — DO NOT EDIT.
// Regenerate: npx tsx tools/sdk-codegen/generate.ts
// Source: wrapper-config.json + openapi.json (0.1.0)

package dev.edgebase.sdk.core.generated

/** Authentication wrapper methods */
open class GeneratedAuthMethods(protected val core: GeneratedDbApi) {

    /** Sign up with email and password */
    @Suppress("UNCHECKED_CAST")
    open suspend fun signUp(body: Map<String, Any?> = emptyMap()): Any? =
        core.authSignup(body)

    /** Sign in with email and password */
    @Suppress("UNCHECKED_CAST")
    open suspend fun signIn(body: Map<String, Any?> = emptyMap()): Any? =
        core.authSignin(body)

    /** Sign out and revoke refresh token */
    @Suppress("UNCHECKED_CAST")
    open suspend fun signOut(body: Map<String, Any?> = emptyMap()): Any? =
        core.authSignout(body)

    /** Sign in anonymously */
    @Suppress("UNCHECKED_CAST")
    open suspend fun signInAnonymously(body: Map<String, Any?> = emptyMap()): Any? =
        core.authSigninAnonymous(body)

    /** Send magic link to email */
    @Suppress("UNCHECKED_CAST")
    open suspend fun signInWithMagicLink(body: Map<String, Any?> = emptyMap()): Any? =
        core.authSigninMagicLink(body)

    /** Verify magic link token */
    @Suppress("UNCHECKED_CAST")
    open suspend fun verifyMagicLink(body: Map<String, Any?> = emptyMap()): Any? =
        core.authVerifyMagicLink(body)

    /** Send OTP SMS to phone number */
    @Suppress("UNCHECKED_CAST")
    open suspend fun signInWithPhone(body: Map<String, Any?> = emptyMap()): Any? =
        core.authSigninPhone(body)

    /** Verify phone OTP and create session */
    @Suppress("UNCHECKED_CAST")
    open suspend fun verifyPhone(body: Map<String, Any?> = emptyMap()): Any? =
        core.authVerifyPhone(body)

    /** Send OTP code to email */
    @Suppress("UNCHECKED_CAST")
    open suspend fun signInWithEmailOtp(body: Map<String, Any?> = emptyMap()): Any? =
        core.authSigninEmailOtp(body)

    /** Verify email OTP and create session */
    @Suppress("UNCHECKED_CAST")
    open suspend fun verifyEmailOtp(body: Map<String, Any?> = emptyMap()): Any? =
        core.authVerifyEmailOtp(body)

    /** Link phone number to existing account */
    @Suppress("UNCHECKED_CAST")
    open suspend fun linkWithPhone(body: Map<String, Any?> = emptyMap()): Any? =
        core.authLinkPhone(body)

    /** Verify OTP and link phone to account */
    @Suppress("UNCHECKED_CAST")
    open suspend fun verifyLinkPhone(body: Map<String, Any?> = emptyMap()): Any? =
        core.authVerifyLinkPhone(body)

    /** Link email and password to existing account */
    @Suppress("UNCHECKED_CAST")
    open suspend fun linkWithEmail(body: Map<String, Any?> = emptyMap()): Any? =
        core.authLinkEmail(body)

    /** Request email change with password confirmation */
    @Suppress("UNCHECKED_CAST")
    open suspend fun changeEmail(body: Map<String, Any?> = emptyMap()): Any? =
        core.authChangeEmail(body)

    /** Verify email change token */
    @Suppress("UNCHECKED_CAST")
    open suspend fun verifyEmailChange(body: Map<String, Any?> = emptyMap()): Any? =
        core.authVerifyEmailChange(body)

    /** Verify email address with token */
    @Suppress("UNCHECKED_CAST")
    open suspend fun verifyEmail(body: Map<String, Any?> = emptyMap()): Any? =
        core.authVerifyEmail(body)

    /** Request password reset email */
    @Suppress("UNCHECKED_CAST")
    open suspend fun requestPasswordReset(body: Map<String, Any?> = emptyMap()): Any? =
        core.authRequestPasswordReset(body)

    /** Reset password with token */
    @Suppress("UNCHECKED_CAST")
    open suspend fun resetPassword(body: Map<String, Any?> = emptyMap()): Any? =
        core.authResetPassword(body)

    /** Change password for authenticated user */
    @Suppress("UNCHECKED_CAST")
    open suspend fun changePassword(body: Map<String, Any?> = emptyMap()): Any? =
        core.authChangePassword(body)

    /** Get current authenticated user info */
    @Suppress("UNCHECKED_CAST")
    open suspend fun getMe(): Any? =
        core.authGetMe()

    /** Update user profile */
    @Suppress("UNCHECKED_CAST")
    open suspend fun updateProfile(body: Map<String, Any?> = emptyMap()): Any? =
        core.authUpdateProfile(body)

    /** List active sessions */
    @Suppress("UNCHECKED_CAST")
    open suspend fun listSessions(): Any? =
        core.authGetSessions()

    /** Delete a session */
    @Suppress("UNCHECKED_CAST")
    open suspend fun revokeSession(id: String): Any? =
        core.authDeleteSession(id)

    /** Enroll new TOTP factor */
    @Suppress("UNCHECKED_CAST")
    open suspend fun enrollTotp(): Any? =
        core.authMfaTotpEnroll()

    /** Confirm TOTP enrollment with code */
    @Suppress("UNCHECKED_CAST")
    open suspend fun verifyTotpEnrollment(body: Map<String, Any?> = emptyMap()): Any? =
        core.authMfaTotpVerify(body)

    /** Verify MFA code during signin */
    @Suppress("UNCHECKED_CAST")
    open suspend fun verifyTotp(body: Map<String, Any?> = emptyMap()): Any? =
        core.authMfaVerify(body)

    /** Use recovery code during MFA signin */
    @Suppress("UNCHECKED_CAST")
    open suspend fun useRecoveryCode(body: Map<String, Any?> = emptyMap()): Any? =
        core.authMfaRecovery(body)

    /** Disable TOTP factor */
    @Suppress("UNCHECKED_CAST")
    open suspend fun disableTotp(body: Map<String, Any?> = emptyMap()): Any? =
        core.authMfaTotpDelete(body)

    /** List MFA factors for authenticated user */
    @Suppress("UNCHECKED_CAST")
    open suspend fun listFactors(): Any? =
        core.authMfaFactors()

    /** Generate passkey registration options */
    @Suppress("UNCHECKED_CAST")
    open suspend fun passkeysRegisterOptions(): Any? =
        core.authPasskeysRegisterOptions()

    /** Verify and store passkey registration */
    @Suppress("UNCHECKED_CAST")
    open suspend fun passkeysRegister(body: Map<String, Any?> = emptyMap()): Any? =
        core.authPasskeysRegister(body)

    /** Generate passkey authentication options */
    @Suppress("UNCHECKED_CAST")
    open suspend fun passkeysAuthOptions(body: Map<String, Any?> = emptyMap()): Any? =
        core.authPasskeysAuthOptions(body)

    /** Authenticate with passkey */
    @Suppress("UNCHECKED_CAST")
    open suspend fun passkeysAuthenticate(body: Map<String, Any?> = emptyMap()): Any? =
        core.authPasskeysAuthenticate(body)

    /** List passkeys for authenticated user */
    @Suppress("UNCHECKED_CAST")
    open suspend fun passkeysList(): Any? =
        core.authPasskeysList()

    /** Delete a passkey */
    @Suppress("UNCHECKED_CAST")
    open suspend fun passkeysDelete(credentialId: String): Any? =
        core.authPasskeysDelete(credentialId)
}

/** Storage wrapper methods (bucket-scoped) */
open class GeneratedStorageMethods(protected val core: GeneratedDbApi) {

    /** Delete file */
    @Suppress("UNCHECKED_CAST")
    open suspend fun delete(bucket: String, key: String): Any? =
        core.deleteFile(bucket, key)

    /** Batch delete files */
    @Suppress("UNCHECKED_CAST")
    open suspend fun deleteMany(bucket: String, body: Map<String, Any?> = emptyMap()): Any? =
        core.deleteBatch(bucket, body)

    /** Check if file exists */
    open suspend fun exists(bucket: String, key: String): Boolean =
        core.checkFileExists(bucket, key)

    /** Get file metadata */
    @Suppress("UNCHECKED_CAST")
    open suspend fun getMetadata(bucket: String, key: String): Any? =
        core.getFileMetadata(bucket, key)

    /** Update file metadata */
    @Suppress("UNCHECKED_CAST")
    open suspend fun updateMetadata(bucket: String, key: String, body: Map<String, Any?> = emptyMap()): Any? =
        core.updateFileMetadata(bucket, key, body)

    /** Create signed download URL */
    @Suppress("UNCHECKED_CAST")
    open suspend fun createSignedUrl(bucket: String, body: Map<String, Any?> = emptyMap()): Any? =
        core.createSignedDownloadUrl(bucket, body)

    /** Batch create signed download URLs */
    @Suppress("UNCHECKED_CAST")
    open suspend fun createSignedUrls(bucket: String, body: Map<String, Any?> = emptyMap()): Any? =
        core.createSignedDownloadUrls(bucket, body)

    /** Create signed upload URL */
    @Suppress("UNCHECKED_CAST")
    open suspend fun createSignedUploadUrl(bucket: String, body: Map<String, Any?> = emptyMap()): Any? =
        core.createSignedUploadUrl(bucket, body)

    /** Start multipart upload */
    @Suppress("UNCHECKED_CAST")
    open suspend fun createMultipartUpload(bucket: String, body: Map<String, Any?> = emptyMap()): Any? =
        core.createMultipartUpload(bucket, body)

    /** Complete multipart upload */
    @Suppress("UNCHECKED_CAST")
    open suspend fun completeMultipartUpload(bucket: String, body: Map<String, Any?> = emptyMap()): Any? =
        core.completeMultipartUpload(bucket, body)

    /** Abort multipart upload */
    @Suppress("UNCHECKED_CAST")
    open suspend fun abortMultipartUpload(bucket: String, body: Map<String, Any?> = emptyMap()): Any? =
        core.abortMultipartUpload(bucket, body)
}

/** Analytics wrapper methods */
open class GeneratedAnalyticsMethods(protected val core: GeneratedDbApi) {

    /** Track custom events */
    @Suppress("UNCHECKED_CAST")
    open suspend fun track(body: Map<String, Any?> = emptyMap()): Any? =
        core.trackEvents(body)
}
