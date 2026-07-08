import EdgeBaseCore
// Auth Client — user authentication.
//
// Mirrors Dart SDK AuthClient:
// signUp / signIn / signOut / signInAnonymously
// OAuth / linkWithEmail / linkWithOAuth
// sessions / profile / email verify / password reset
// onAuthStateChange via AsyncStream

import Foundation

/// Authentication client for user operations.
public final class AuthClient: @unchecked Sendable {
    public struct PasskeysAuthOptions {
        public let email: String?

        public init(email: String? = nil) {
            self.email = email
        }

        var body: [String: Any] {
            var result: [String: Any] = [:]
            if let email, !email.isEmpty {
                result["email"] = email
            }
            return result
        }
    }

    private let client: HttpClient
    private let tokenManager: TokenManager
    private let core: GeneratedDbApi

    public init(client: HttpClient, tokenManager: TokenManager, core: GeneratedDbApi? = nil) {
        self.client = client
        self.tokenManager = tokenManager
        self.core = core ?? GeneratedDbApi(http: client)
    }

    // MARK: - Core Auth

    /// Sign up with email and password.
    /// - Parameter captchaToken: Captcha token.
    @discardableResult
    public func signUp(email: String, password: String, userData: [String: Any]? = nil, captchaToken: String? = nil) async throws -> [String: Any] {
        var body: [String: Any] = ["email": email, "password": password]
        if let userData = userData {
            body["data"] = userData
        }
        let resolved = await TurnstileProvider.resolveCaptchaToken(core: core, baseUrl: await client.baseUrl, action: "signup", manualToken: captchaToken)
        if let resolved { body["captchaToken"] = resolved }
        let result = try expectObject(await client.postPublic("/auth/signup", body))
        if let tokens = parseTokens(result) {
            await tokenManager.setTokens(tokens)
        }
        return result
    }

    /// Sign in with email and password.
    /// Returns dictionary that may contain `mfaRequired: true` if MFA is enabled.
    /// - Parameter captchaToken: Captcha token.
    public func signIn(email: String, password: String, captchaToken: String? = nil) async throws -> [String: Any] {
        var body: [String: Any] = ["email": email, "password": password]
        let resolved = await TurnstileProvider.resolveCaptchaToken(core: core, baseUrl: await client.baseUrl, action: "signin", manualToken: captchaToken)
        if let resolved { body["captchaToken"] = resolved }
        let result = try expectObject(await client.postPublic("/auth/signin", body))
        // If MFA is required, return the result without setting tokens
        if result["mfaRequired"] as? Bool == true {
            return result
        }
        if let tokens = parseTokens(result) {
            await tokenManager.setTokens(tokens)
        }
        return result
    }

    /// Sign out.
    public func signOut() async {
        // Auto-unregister push token
        do {
            let push = PushClient(client)
            try await push.unregister()
        } catch {}

        do {
            let refreshToken = await tokenManager.getRefreshToken()
            if let refreshToken = refreshToken {
                try await client.post("/auth/signout", ["refreshToken": refreshToken])
            }
        } catch {
            // Continue even if server call fails
        }
        await tokenManager.clearTokens()
    }

    /// Sign in anonymously.
    /// - Parameter captchaToken: Captcha token.
    public func signInAnonymously(captchaToken: String? = nil) async throws -> [String: Any] {
        var body: [String: Any] = [:]
        let resolved = await TurnstileProvider.resolveCaptchaToken(core: core, baseUrl: await client.baseUrl, action: "anonymous", manualToken: captchaToken)
        if let resolved { body["captchaToken"] = resolved }
        let result = try expectObject(await client.postPublic("/auth/signin/anonymous", body))
        if let tokens = parseTokens(result) {
            await tokenManager.setTokens(tokens)
        }
        return result
    }

    // MARK: - OAuth

    /// Start OAuth flow — returns the OAuth redirect URL.
    /// Open this URL in a browser (SFSafariViewController, etc.) to initiate.
    /// - Parameter captchaToken: Captcha token.
    public func signInWithOAuth(provider: String, captchaToken: String? = nil) async -> String {
        let encoded = provider.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? provider
        var url = await client.apiUrl("/auth/oauth/\(encoded)")
        if let captchaToken = captchaToken,
           let encodedToken = captchaToken.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
            url += "?captcha_token=\(encodedToken)"
        }
        return url
    }

    // MARK: - Magic Link

    /// Request a magic link sign-in email.
    /// - Parameter captchaToken: Captcha token.
    public func signInWithMagicLink(email: String, captchaToken: String? = nil) async throws {
        var body: [String: Any] = ["email": email]
        let resolved = await TurnstileProvider.resolveCaptchaToken(core: core, baseUrl: await client.baseUrl, action: "magic-link", manualToken: captchaToken)
        if let resolved { body["captchaToken"] = resolved }
        _ = try await client.postPublic("/auth/signin/magic-link", body)
    }

    /// Verify a magic link token and sign in.
    public func verifyMagicLink(token: String) async throws -> [String: Any] {
        let result = try expectObject(await client.postPublic("/auth/verify-magic-link", ["token": token]))
        if let tokens = parseTokens(result) {
            await tokenManager.setTokens(tokens)
        }
        return result
    }

    /// Verify an email OTP code and sign in.
    public func verifyEmailOtp(email: String, code: String) async throws -> [String: Any] {
        let result = try expectObject(await client.postPublic("/auth/verify-email-otp", [
            "email": email,
            "code": code,
        ]))
        if let tokens = parseTokens(result) {
            await tokenManager.setTokens(tokens)
        }
        return result
    }

    // MARK: - Phone / SMS Auth

    /// Send an SMS verification code to the given phone number.
    /// - Parameter captchaToken: Captcha token.
    public func signInWithPhone(phone: String, captchaToken: String? = nil) async throws {
        var body: [String: Any] = ["phone": phone]
        let resolved = await TurnstileProvider.resolveCaptchaToken(core: core, baseUrl: await client.baseUrl, action: "phone", manualToken: captchaToken)
        if let resolved { body["captchaToken"] = resolved }
        _ = try await client.postPublic("/auth/signin/phone", body)
    }

    /// Verify the SMS code and sign in.
    public func verifyPhone(phone: String, code: String) async throws -> [String: Any] {
        let result = try expectObject(await client.postPublic("/auth/verify-phone", [
            "phone": phone, "code": code
        ]))
        if let tokens = parseTokens(result) {
            await tokenManager.setTokens(tokens)
        }
        return result
    }

    /// Link current account with a phone number. Sends an SMS code.
    public func linkWithPhone(phone: String) async throws {
        _ = try await client.post("/auth/link/phone", ["phone": phone])
    }

    /// Verify phone link code. Completes phone linking for the current account.
    public func verifyLinkPhone(phone: String, code: String) async throws {
        _ = try await client.post("/auth/verify-link-phone", [
            "phone": phone, "code": code
        ])
    }

    /// Link current account with email.
    public func linkWithEmail(email: String, password: String) async throws -> [String: Any] {
        let body: [String: Any] = ["email": email, "password": password]
        let result = try expectObject(await client.post("/auth/link/email", body))
        if let tokens = parseTokens(result) {
            await tokenManager.setTokens(tokens)
        }
        return result
    }

    /// Link current account with OAuth provider. Returns redirect URL.
    public func linkWithOAuth(provider: String, redirectUrl: String = "") async throws -> String {
        let encoded = provider.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? provider
        let body: [String: Any] = ["redirectUrl": redirectUrl]
        let result = try expectObject(await client.post("/auth/oauth/link/\(encoded)", body))
        return (result["redirectUrl"] as? String) ?? ""
    }

    // MARK: - Sessions

    /// List active sessions.
    public func listSessions() async throws -> [[String: Any]] {
        let result = try await client.get("/auth/sessions")
        if let sessions = result as? [[String: Any]] {
            return sessions
        }
        if let dict = result as? [String: Any], let sessions = dict["sessions"] as? [[String: Any]] {
            return sessions
        }
        return []
    }

    /// Revoke a session by ID.
    public func revokeSession(_ sessionId: String) async throws {
        try await client.delete("/auth/sessions/\(sessionId)")
    }

    /// Compatibility overload with an external label.
    public func revokeSession(sessionId: String) async throws {
        try await revokeSession(sessionId)
    }

    /// List linked sign-in identities for the current user.
    public func listIdentities() async throws -> [String: Any] {
        return try expectObject(await core.authGetIdentities())
    }

    /// Unlink a linked OAuth identity by its identity ID.
    public func unlinkIdentity(_ identityId: String) async throws -> [String: Any] {
        let encoded = identityId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? identityId
        return try expectObject(await client.delete("/auth/identities/\(encoded)"))
    }

    // MARK: - Profile

    /// Update current user profile.
    public func updateProfile(_ data: [String: Any]) async throws -> [String: Any] {
        let result = try expectObject(await client.patch("/auth/profile", data))
        if let tokens = parseTokens(result) {
            await tokenManager.setTokens(tokens)
        }
        return result
    }

    /// Convenience overload for common profile fields.
    public func updateProfile(displayName: String? = nil, avatarUrl: String? = nil) async throws -> [String: Any] {
        var data: [String: Any] = [:]
        if let displayName, !displayName.isEmpty {
            data["displayName"] = displayName
        }
        if let avatarUrl, !avatarUrl.isEmpty {
            data["avatarUrl"] = avatarUrl
        }
        return try await updateProfile(data)
    }

    /// Get current user from token.
    public func currentUser() async -> [String: Any]? {
        return await tokenManager.currentUser()
    }

    // MARK: - Email Verification & Password Reset

    /// Request email verification.
    public func verifyEmail(token: String) async throws -> [String: Any] {
        return try expectObject(await client.postPublic("/auth/verify-email", ["token": token]))
    }

    /// Request a verification email for the current authenticated user.
    public func requestEmailVerification(redirectUrl: String? = nil) async throws -> [String: Any] {
        var body: [String: Any] = [:]
        if let redirectUrl, !redirectUrl.isEmpty {
            body["redirectUrl"] = redirectUrl
        }
        return try expectObject(await client.post("/auth/request-email-verification", body))
    }

    /// Verify a pending email change using the emailed token.
    public func verifyEmailChange(token: String) async throws -> [String: Any] {
        return try expectObject(await client.postPublic("/auth/verify-email-change", ["token": token]))
    }

    /// Request password reset email.
    /// - Parameter captchaToken: Captcha token.
    public func requestPasswordReset(email: String, captchaToken: String? = nil) async throws -> [String: Any] {
        var body: [String: Any] = ["email": email]
        let resolved = await TurnstileProvider.resolveCaptchaToken(core: core, baseUrl: await client.baseUrl, action: "password-reset", manualToken: captchaToken)
        if let resolved { body["captchaToken"] = resolved }
        return try expectObject(await client.postPublic("/auth/request-password-reset", body))
    }

    /// Reset password with token.
    public func resetPassword(token: String, newPassword: String) async throws -> [String: Any] {
        let body: [String: Any] = ["token": token, "newPassword": newPassword]
        return try expectObject(await client.postPublic("/auth/reset-password", body))
    }

    /// Change password for authenticated user.
    public func changePassword(currentPassword: String, newPassword: String) async throws -> [String: Any] {
        let body: [String: Any] = ["currentPassword": currentPassword, "newPassword": newPassword]
        let result = try expectObject(await client.post("/auth/change-password", body))
        if let tokens = parseTokens(result) {
            await tokenManager.setTokens(tokens)
        }
        return result
    }

    /// Request an email change for the current user.
    public func changeEmail(newEmail: String, password: String, redirectUrl: String? = nil) async throws -> [String: Any] {
        var body: [String: Any] = [
            "newEmail": newEmail,
            "password": password,
        ]
        if let redirectUrl, !redirectUrl.isEmpty {
            body["redirectUrl"] = redirectUrl
        }
        return try expectObject(await client.post("/auth/change-email", body))
    }

    /// Refresh the current session using the stored refresh token.
    public func refreshToken() async throws -> [String: Any] {
        guard let refreshToken = await tokenManager.getRefreshToken(),
              !refreshToken.isEmpty else {
            throw EdgeBaseError(statusCode: 0, message: "No refresh token available.")
        }
        let result = try expectObject(await client.postPublic("/auth/refresh", ["refreshToken": refreshToken]))
        if let tokens = parseTokens(result) {
            await tokenManager.setTokens(tokens)
        }
        return result
    }

    // MARK: - Auth State Change

    /// Stream of auth state changes using AsyncStream.
    /// Usage: `for await user in auth.onAuthStateChange { ... }`
    public func onAuthStateChange() -> AsyncStream<[String: Any]?> {
        AsyncStream { continuation in
            Task {
                await tokenManager.onAuthStateChange { user in
                    continuation.yield(user)
                }
            }
        }
    }

    // MARK: - Passkeys / WebAuthn REST layer

    public func passkeysRegisterOptions() async throws -> [String: Any] {
        try expectObject(await core.authPasskeysRegisterOptions())
    }

    public func passkeysRegister(response: [String: Any]) async throws -> [String: Any] {
        try expectObject(await core.authPasskeysRegister(["response": response]))
    }

    public func passkeysAuthOptions(email: String? = nil) async throws -> [String: Any] {
        try await passkeysAuthOptions(PasskeysAuthOptions(email: email))
    }

    public func passkeysAuthOptions(_ options: PasskeysAuthOptions) async throws -> [String: Any] {
        try expectObject(await core.authPasskeysAuthOptions(options.body))
    }

    public func passkeysAuthenticate(response: [String: Any]) async throws -> [String: Any] {
        let result = try expectObject(await core.authPasskeysAuthenticate(["response": response]))
        if let tokens = parseTokens(result) {
            await tokenManager.setTokens(tokens)
        }
        return result
    }

    public func passkeysList() async throws -> [String: Any] {
        try expectObject(await core.authPasskeysList())
    }

    public func passkeysDelete(credentialId: String) async throws -> [String: Any] {
        try expectObject(await core.authPasskeysDelete(credentialId))
    }

    // MARK: - MFA / TOTP

    /// Enroll TOTP — returns factorId, secret, qrCodeUri, and recoveryCodes.
    public func enrollTotp() async throws -> [String: Any] {
        return try expectObject(await client.post("/auth/mfa/totp/enroll", [:]))
    }

    /// Compatibility helper matching other SDKs.
    /// Verify TOTP enrollment with factorId and a TOTP code.
    public func verifyTotpEnrollment(factorId: String, code: String) async throws {
        _ = try await client.post("/auth/mfa/totp/verify", ["factorId": factorId, "code": code])
    }

    /// Verify TOTP code during MFA challenge (after signIn returns mfaRequired).
    public func verifyTotp(mfaTicket: String, code: String) async throws -> [String: Any] {
        let result = try expectObject(await client.postPublic("/auth/mfa/verify", [
            "mfaTicket": mfaTicket, "code": code
        ]))
        if let tokens = parseTokens(result) {
            await tokenManager.setTokens(tokens)
        }
        return result
    }

    /// Use a recovery code during MFA challenge.
    public func useRecoveryCode(mfaTicket: String, recoveryCode: String) async throws -> [String: Any] {
        let result = try expectObject(await client.postPublic("/auth/mfa/recovery", [
            "mfaTicket": mfaTicket, "recoveryCode": recoveryCode
        ]))
        if let tokens = parseTokens(result) {
            await tokenManager.setTokens(tokens)
        }
        return result
    }

    /// Disable TOTP for the current user. Requires password or TOTP code.
    public func disableTotp(password: String? = nil, code: String? = nil) async throws {
        var body: [String: Any] = [:]
        if let password = password { body["password"] = password }
        if let code = code { body["code"] = code }
        try await client.delete("/auth/mfa/totp", body)
    }

    /// List enrolled MFA factors for the current user.
    public func listFactors() async throws -> [[String: Any]] {
        let result = try await client.get("/auth/mfa/factors")
        if let dict = result as? [String: Any], let factors = dict["factors"] as? [[String: Any]] {
            return factors
        }
        return []
    }

    /// Request an OTP code for email sign-in.
    public func signInWithEmailOtp(email: String) async throws -> [String: Any] {
        try expectObject(await client.post("/auth/signin/email-otp", ["email": email]))
    }

    // MARK: - Internal

    /// Safely cast a decoded JSON response to an object, throwing on unexpected shapes
    /// (e.g. a bare array, string, or null) instead of crashing on a force-cast.
    private func expectObject(_ value: Any) throws -> [String: Any] {
        guard let object = value as? [String: Any] else {
            throw EdgeBaseError(statusCode: 0, message: "Unexpected auth response shape: expected a JSON object.")
        }
        return object
    }

    private func parseTokens(_ result: [String: Any]) -> TokenPair? {
        guard let accessToken = result["accessToken"] as? String,
              let refreshToken = result["refreshToken"] as? String else {
            return nil
        }
        return TokenPair(accessToken: accessToken, refreshToken: refreshToken)
    }
}
