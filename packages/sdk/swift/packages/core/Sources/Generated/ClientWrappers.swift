// Auto-generated client wrapper methods — DO NOT EDIT.
// Regenerate: npx tsx tools/sdk-codegen/generate.ts
// Source: wrapper-config.json + openapi.json (0.1.0)

import Foundation

/// Authentication wrapper methods
public struct GeneratedAuthMethods {
    public let core: GeneratedDbApi

    public init(core: GeneratedDbApi) {
        self.core = core
    }

    /// Sign up with email and password
    public func signUp(_ body: [String: Any]) async throws -> Any {
        return try await core.authSignup(body)
    }

    /// Sign in with email and password
    public func signIn(_ body: [String: Any]) async throws -> Any {
        return try await core.authSignin(body)
    }

    /// Sign out and revoke refresh token
    public func signOut(_ body: [String: Any]) async throws -> Any {
        return try await core.authSignout(body)
    }

    /// Sign in anonymously
    public func signInAnonymously(_ body: [String: Any]) async throws -> Any {
        return try await core.authSigninAnonymous(body)
    }

    /// Send magic link to email
    public func signInWithMagicLink(_ body: [String: Any]) async throws -> Any {
        return try await core.authSigninMagicLink(body)
    }

    /// Verify magic link token
    public func verifyMagicLink(_ body: [String: Any]) async throws -> Any {
        return try await core.authVerifyMagicLink(body)
    }

    /// Send OTP SMS to phone number
    public func signInWithPhone(_ body: [String: Any]) async throws -> Any {
        return try await core.authSigninPhone(body)
    }

    /// Verify phone OTP and create session
    public func verifyPhone(_ body: [String: Any]) async throws -> Any {
        return try await core.authVerifyPhone(body)
    }

    /// Send OTP code to email
    public func signInWithEmailOtp(_ body: [String: Any]) async throws -> Any {
        return try await core.authSigninEmailOtp(body)
    }

    /// Verify email OTP and create session
    public func verifyEmailOtp(_ body: [String: Any]) async throws -> Any {
        return try await core.authVerifyEmailOtp(body)
    }

    /// Link phone number to existing account
    public func linkWithPhone(_ body: [String: Any]) async throws -> Any {
        return try await core.authLinkPhone(body)
    }

    /// Verify OTP and link phone to account
    public func verifyLinkPhone(_ body: [String: Any]) async throws -> Any {
        return try await core.authVerifyLinkPhone(body)
    }

    /// Link email and password to existing account
    public func linkWithEmail(_ body: [String: Any]) async throws -> Any {
        return try await core.authLinkEmail(body)
    }

    /// Request email change with password confirmation
    public func changeEmail(_ body: [String: Any]) async throws -> Any {
        return try await core.authChangeEmail(body)
    }

    /// Verify email change token
    public func verifyEmailChange(_ body: [String: Any]) async throws -> Any {
        return try await core.authVerifyEmailChange(body)
    }

    /// Verify email address with token
    public func verifyEmail(_ body: [String: Any]) async throws -> Any {
        return try await core.authVerifyEmail(body)
    }

    /// Request password reset email
    public func requestPasswordReset(_ body: [String: Any]) async throws -> Any {
        return try await core.authRequestPasswordReset(body)
    }

    /// Reset password with token
    public func resetPassword(_ body: [String: Any]) async throws -> Any {
        return try await core.authResetPassword(body)
    }

    /// Change password for authenticated user
    public func changePassword(_ body: [String: Any]) async throws -> Any {
        return try await core.authChangePassword(body)
    }

    /// Get current authenticated user info
    public func getMe() async throws -> Any {
        return try await core.authGetMe()
    }

    /// Update user profile
    public func updateProfile(_ body: [String: Any]) async throws -> Any {
        return try await core.authUpdateProfile(body)
    }

    /// List active sessions
    public func listSessions() async throws -> Any {
        return try await core.authGetSessions()
    }

    /// Delete a session
    public func revokeSession(_ id: String) async throws -> Any {
        return try await core.authDeleteSession(id)
    }

    /// Enroll new TOTP factor
    public func enrollTotp() async throws -> Any {
        return try await core.authMfaTotpEnroll()
    }

    /// Confirm TOTP enrollment with code
    public func verifyTotpEnrollment(_ body: [String: Any]) async throws -> Any {
        return try await core.authMfaTotpVerify(body)
    }

    /// Verify MFA code during signin
    public func verifyTotp(_ body: [String: Any]) async throws -> Any {
        return try await core.authMfaVerify(body)
    }

    /// Use recovery code during MFA signin
    public func useRecoveryCode(_ body: [String: Any]) async throws -> Any {
        return try await core.authMfaRecovery(body)
    }

    /// Disable TOTP factor
    public func disableTotp(_ body: [String: Any]) async throws -> Any {
        return try await core.authMfaTotpDelete(body)
    }

    /// List MFA factors for authenticated user
    public func listFactors() async throws -> Any {
        return try await core.authMfaFactors()
    }

    /// Generate passkey registration options
    public func passkeysRegisterOptions() async throws -> Any {
        return try await core.authPasskeysRegisterOptions()
    }

    /// Verify and store passkey registration
    public func passkeysRegister(_ body: [String: Any]) async throws -> Any {
        return try await core.authPasskeysRegister(body)
    }

    /// Generate passkey authentication options
    public func passkeysAuthOptions(_ body: [String: Any]) async throws -> Any {
        return try await core.authPasskeysAuthOptions(body)
    }

    /// Authenticate with passkey
    public func passkeysAuthenticate(_ body: [String: Any]) async throws -> Any {
        return try await core.authPasskeysAuthenticate(body)
    }

    /// List passkeys for authenticated user
    public func passkeysList() async throws -> Any {
        return try await core.authPasskeysList()
    }

    /// Delete a passkey
    public func passkeysDelete(_ credentialId: String) async throws -> Any {
        return try await core.authPasskeysDelete(credentialId)
    }
}

/// Storage wrapper methods (bucket-scoped)
public struct GeneratedStorageMethods {
    public let core: GeneratedDbApi

    public init(core: GeneratedDbApi) {
        self.core = core
    }

    /// Delete file
    public func delete(_ bucket: String, _ key: String) async throws -> Any {
        return try await core.deleteFile(bucket, key)
    }

    /// Batch delete files
    public func deleteMany(_ bucket: String, _ body: [String: Any]) async throws -> Any {
        return try await core.deleteBatch(bucket, body)
    }

    /// Check if file exists
    public func exists(_ bucket: String, _ key: String) async -> Bool {
        return await core.checkFileExists(bucket, key)
    }

    /// Get file metadata
    public func getMetadata(_ bucket: String, _ key: String) async throws -> Any {
        return try await core.getFileMetadata(bucket, key)
    }

    /// Update file metadata
    public func updateMetadata(_ bucket: String, _ key: String, _ body: [String: Any]) async throws -> Any {
        return try await core.updateFileMetadata(bucket, key, body)
    }

    /// Create signed download URL
    public func createSignedUrl(_ bucket: String, _ body: [String: Any]) async throws -> Any {
        return try await core.createSignedDownloadUrl(bucket, body)
    }

    /// Batch create signed download URLs
    public func createSignedUrls(_ bucket: String, _ body: [String: Any]) async throws -> Any {
        return try await core.createSignedDownloadUrls(bucket, body)
    }

    /// Create signed upload URL
    public func createSignedUploadUrl(_ bucket: String, _ body: [String: Any]) async throws -> Any {
        return try await core.createSignedUploadUrl(bucket, body)
    }

    /// Start multipart upload
    public func createMultipartUpload(_ bucket: String, _ body: [String: Any]) async throws -> Any {
        return try await core.createMultipartUpload(bucket, body)
    }

    /// Complete multipart upload
    public func completeMultipartUpload(_ bucket: String, _ body: [String: Any]) async throws -> Any {
        return try await core.completeMultipartUpload(bucket, body)
    }

    /// Abort multipart upload
    public func abortMultipartUpload(_ bucket: String, _ body: [String: Any]) async throws -> Any {
        return try await core.abortMultipartUpload(bucket, body)
    }
}

/// Analytics wrapper methods
public struct GeneratedAnalyticsMethods {
    public let core: GeneratedDbApi

    public init(core: GeneratedDbApi) {
        self.core = core
    }

    /// Track custom events
    public func track(_ body: [String: Any]) async throws -> Any {
        return try await core.trackEvents(body)
    }
}
