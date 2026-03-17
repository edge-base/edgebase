// EdgeBase Kotlin SDK — Authentication client (KMP).
//
// Full auth operations: signUp, signIn, signOut, OAuth, sessions, profile.
//: java.net.URLEncoder → platformUrlEncode() for KMP.

package dev.edgebase.sdk.client

import dev.edgebase.sdk.core.*
import dev.edgebase.sdk.core.generated.GeneratedDbApi

import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/**
 * Authentication client for EdgeBase.
 *
 * All HTTP calls delegate to [GeneratedDbApi] where possible.
 * Token management logic is preserved locally.
 *
 * Usage:
 * ```kotlin
 * client.auth.signUp(email = "user@example.com", password = "password")
 * client.auth.signIn(email = "user@example.com", password = "password")
 * ```
 */
class AuthClient(
    private val client: HttpClient,
    private val tokenManager: ClientTokenManager,
    private val core: GeneratedDbApi? = null
) {
    private val _authStateFlow = MutableSharedFlow<Map<String, Any?>?>(
        replay = 1,
        onBufferOverflow = BufferOverflow.DROP_OLDEST
    )

    init {
        tokenManager.setOnAuthStateChange { user ->
            _authStateFlow.tryEmit(user)
        }
    }

    /**
     * Stream of auth state changes.
     */
    val onAuthStateChange: SharedFlow<Map<String, Any?>?> = _authStateFlow.asSharedFlow()

    // MARK: - Authentication

    @Suppress("UNCHECKED_CAST")
    suspend fun signUp(
        email: String,
        password: String,
        data: Map<String, Any>? = null,
        /** Captcha token. */
        captchaToken: String? = null
    ): Map<String, Any?> {
        val body = mutableMapOf<String, Any?>("email" to email, "password" to password)
        if (data != null) body["data"] = data
        val resolved = resolveCaptchaToken(client, "signup", captchaToken)
        if (resolved != null) body["captchaToken"] = resolved
        val result = client.postPublic("/auth/signup", body) as Map<String, Any?>
        handleAuthResponse(result)
        return result
    }

    /**
     * Sign in with email and password.
     * If MFA is enabled, result will contain `mfaRequired=true`, `mfaTicket`, and `factors`.
     * @param captchaToken Captcha token.
     */
    @Suppress("UNCHECKED_CAST")
    suspend fun signIn(
        email: String,
        password: String,
        captchaToken: String? = null
    ): Map<String, Any?> {
        val body = mutableMapOf<String, Any?>("email" to email, "password" to password)
        val resolved = resolveCaptchaToken(client, "signin", captchaToken)
        if (resolved != null) body["captchaToken"] = resolved
        val result = client.postPublic("/auth/signin", body) as Map<String, Any?>
        // If MFA is required, return result without setting tokens
        if (result["mfaRequired"] == true) return result
        handleAuthResponse(result)
        return result
    }

    /** Sign in anonymously. [captchaToken] —. */
    @Suppress("UNCHECKED_CAST")
    suspend fun signInAnonymously(captchaToken: String? = null): Map<String, Any?> {
        val body = mutableMapOf<String, Any?>()
        val resolved = resolveCaptchaToken(client, "anonymous", captchaToken)
        if (resolved != null) body["captchaToken"] = resolved
        val result = client.postPublic("/auth/signin/anonymous", body) as Map<String, Any?>
        handleAuthResponse(result)
        return result
    }

    /**
     * Start OAuth sign-in flow. Returns the OAuth redirect URL.
     * @param captchaToken Captcha token.
     */
    fun signInWithOAuth(provider: String, captchaToken: String? = null): String {
        val base = "${client.baseUrl}/api/auth/oauth/${platformUrlEncode(provider)}"
        if (captchaToken != null) {
            return "$base?captcha_token=${platformUrlEncode(captchaToken)}"
        }
        return base
    }

    /** Send a magic link to the given email. [captchaToken] —. */
    suspend fun signInWithMagicLink(email: String, captchaToken: String? = null) {
        val body = mutableMapOf<String, Any?>("email" to email)
        val resolved = resolveCaptchaToken(client, "magic-link", captchaToken)
        if (resolved != null) body["captchaToken"] = resolved
        client.postPublic("/auth/signin/magic-link", body)
    }

    /** Verify a magic-link token and establish a session. */
    @Suppress("UNCHECKED_CAST")
    suspend fun verifyMagicLink(token: String): Map<String, Any?> {
        val result = client.postPublic("/auth/verify-magic-link", mapOf("token" to token)) as Map<String, Any?>
        handleAuthResponse(result)
        return result
    }

    // ── Phone / SMS Auth ──

    /** Send an SMS verification code to the given phone number. */
    suspend fun signInWithPhone(phone: String, captchaToken: String? = null) {
        val body = mutableMapOf<String, Any?>("phone" to phone)
        val resolved = resolveCaptchaToken(client, "phone", captchaToken)
        if (resolved != null) body["captchaToken"] = resolved
        client.postPublic("/auth/signin/phone", body)
    }

    /** Verify the SMS code and sign in. */
    @Suppress("UNCHECKED_CAST")
    suspend fun verifyPhone(phone: String, code: String): Map<String, Any?> {
        val result = client.postPublic("/auth/verify-phone", mapOf(
            "phone" to phone, "code" to code
        )) as Map<String, Any?>
        handleAuthResponse(result)
        return result
    }

    /** Link current account with a phone number. Sends an SMS code. */
    suspend fun linkWithPhone(phone: String) {
        if (core != null) {
            core.authLinkPhone(mapOf("phone" to phone))
        } else {
            client.post("/auth/link/phone", mapOf("phone" to phone))
        }
    }

    /** Verify phone link code. Completes phone linking for the current account. */
    suspend fun verifyLinkPhone(phone: String, code: String) {
        val body = mapOf<String, Any?>("phone" to phone, "code" to code)
        if (core != null) {
            core.authVerifyLinkPhone(body)
        } else {
            client.post("/auth/verify-link-phone", body)
        }
    }

    @Suppress("UNCHECKED_CAST")
    suspend fun linkWithEmail(email: String, password: String): Map<String, Any?> {
        val body = mapOf<String, Any?>("email" to email, "password" to password)
        val result = if (core != null) {
            core.authLinkEmail(body) as Map<String, Any?>
        } else {
            client.post("/auth/link/email", body) as Map<String, Any?>
        }
        handleAuthResponse(result)
        return result
    }

    /**
     * Link anonymous account to OAuth provider. Returns redirect URL.
     */
    @Suppress("UNCHECKED_CAST")
    suspend fun linkWithOAuth(provider: String, redirectUrl: String = ""): String {
        val body = mapOf<String, Any?>("redirectUrl" to redirectUrl)
        val result = if (core != null) {
            core.oauthLinkStart(provider) as Map<String, Any?>
        } else {
            client.post("/auth/oauth/link/${platformUrlEncode(provider)}", body) as Map<String, Any?>
        }
        return result["redirectUrl"] as? String ?: ""
    }

    suspend fun signOut() {
        // Auto-unregister push token
        try {
            val push = PushClient(client)
            push.unregister()
        } catch (_: Exception) {}

        try {
            val refreshToken = tokenManager.getRefreshToken()
            if (refreshToken != null) {
                if (core != null) {
                    core.authSignout(mapOf("refreshToken" to refreshToken))
                } else {
                    client.post("/auth/signout", mapOf("refreshToken" to refreshToken))
                }
            }
        } catch (_: Exception) {
            // Continue even if server call fails
        }
        tokenManager.clearTokens()
    }

    // MARK: - Session Management

    @Suppress("UNCHECKED_CAST")
    suspend fun listSessions(): List<Map<String, Any?>> {
        val result = if (core != null) {
            core.authGetSessions() as? Map<String, Any?>
        } else {
            client.get("/auth/sessions") as? Map<String, Any?>
        } ?: return emptyList()
        return (result["sessions"] as? List<Map<String, Any?>>) ?: emptyList()
    }

    suspend fun revokeSession(sessionId: String) {
        if (core != null) {
            core.authDeleteSession(sessionId)
        } else {
            client.delete("/auth/sessions/$sessionId")
        }
    }

    @Suppress("UNCHECKED_CAST")
    suspend fun listIdentities(): Map<String, Any?> {
        return if (core != null) {
            core.authGetIdentities() as Map<String, Any?>
        } else {
            client.get("/auth/identities") as Map<String, Any?>
        }
    }

    @Suppress("UNCHECKED_CAST")
    suspend fun unlinkIdentity(identityId: String): Map<String, Any?> {
        return if (core != null) {
            core.authDeleteIdentity(identityId) as Map<String, Any?>
        } else {
            client.delete("/auth/identities/${platformUrlEncode(identityId)}") as Map<String, Any?>
        }
    }

    // MARK: - Profile

    fun currentUser(): Map<String, Any?>? {
        return tokenManager.currentUser()
    }

    /** Fetch the current authenticated user. Delegates to [GeneratedDbApi.authGetMe]. */
    @Suppress("UNCHECKED_CAST")
    suspend fun getMe(): Map<String, Any?> {
        return if (core != null) {
            core.authGetMe() as Map<String, Any?>
        } else {
            client.get("/auth/me") as Map<String, Any?>
        }
    }

    @Suppress("UNCHECKED_CAST")
    suspend fun updateProfile(data: Map<String, Any>): Map<String, Any?> {
        val result = if (core != null) {
            core.authUpdateProfile(data) as Map<String, Any?>
        } else {
            client.patch("/auth/profile", data) as Map<String, Any?>
        }
        handleAuthResponse(result)
        return result
    }

    /** Convenience overload for common profile fields. */
    suspend fun updateProfile(displayName: String? = null, avatarUrl: String? = null): Map<String, Any?> {
        val data = mutableMapOf<String, Any>()
        if (!displayName.isNullOrBlank()) data["displayName"] = displayName
        if (!avatarUrl.isNullOrBlank()) data["avatarUrl"] = avatarUrl
        return updateProfile(data)
    }

    // MARK: - Email Verification / Password Reset

    suspend fun verifyEmail(token: String) {
        client.postPublic("/auth/verify-email", mapOf("token" to token))
    }

    suspend fun verifyEmailChange(token: String) {
        client.postPublic("/auth/verify-email-change", mapOf("token" to token))
    }

    suspend fun requestEmailVerification(redirectUrl: String? = null) {
        val body = mutableMapOf<String, Any?>()
        if (!redirectUrl.isNullOrBlank()) body["redirectUrl"] = redirectUrl
        if (core != null) {
            core.authRequestEmailVerification(body)
        } else {
            client.post("/auth/request-email-verification", body)
        }
    }

    /** @param captchaToken Captcha token. */
    suspend fun requestPasswordReset(email: String, captchaToken: String? = null) {
        val body = mutableMapOf<String, Any?>("email" to email)
        val resolved = resolveCaptchaToken(client, "password-reset", captchaToken)
        if (resolved != null) body["captchaToken"] = resolved
        client.postPublic("/auth/request-password-reset", body)
    }

    suspend fun resetPassword(token: String, newPassword: String) {
        client.postPublic("/auth/reset-password", mapOf(
            "token" to token,
            "newPassword" to newPassword
        ))
    }

    @Suppress("UNCHECKED_CAST")
    suspend fun changePassword(currentPassword: String, newPassword: String): Map<String, Any?> {
        val body = mapOf<String, Any?>("currentPassword" to currentPassword, "newPassword" to newPassword)
        val result = if (core != null) {
            core.authChangePassword(body) as Map<String, Any?>
        } else {
            client.post("/auth/change-password", body) as Map<String, Any?>
        }
        handleAuthResponse(result)
        return result
    }

    @Suppress("UNCHECKED_CAST")
    suspend fun changeEmail(newEmail: String, password: String, redirectUrl: String? = null): Map<String, Any?> {
        require(password.isNotBlank()) { "password is required for changeEmail" }
        val body = mutableMapOf<String, Any?>(
            "newEmail" to newEmail,
            "password" to password,
        )
        if (!redirectUrl.isNullOrBlank()) body["redirectUrl"] = redirectUrl
        return if (core != null) {
            core.authChangeEmail(body) as Map<String, Any?>
        } else {
            client.post("/auth/change-email", body) as Map<String, Any?>
        }
    }

    @Suppress("UNCHECKED_CAST")
    suspend fun refreshToken(): Map<String, Any?> {
        val refreshToken = tokenManager.getRefreshToken()
            ?: throw EdgeBaseError(0, "No refresh token available.")
        val result = client.postPublic(
            "/auth/refresh",
            mapOf("refreshToken" to refreshToken)
        ) as Map<String, Any?>
        handleAuthResponse(result)
        return result
    }

    // MARK: - Passkeys / WebAuthn REST layer

    @Suppress("UNCHECKED_CAST")
    suspend fun passkeysRegisterOptions(): Map<String, Any?> {
        return if (core != null) {
            core.authPasskeysRegisterOptions() as Map<String, Any?>
        } else {
            client.post("/auth/passkeys/register-options", emptyMap<String, Any>()) as Map<String, Any?>
        }
    }

    @Suppress("UNCHECKED_CAST")
    suspend fun passkeysRegister(response: Any?): Map<String, Any?> {
        val body = mapOf("response" to response)
        return if (core != null) {
            core.authPasskeysRegister(body) as Map<String, Any?>
        } else {
            client.post("/auth/passkeys/register", body) as Map<String, Any?>
        }
    }

    @Suppress("UNCHECKED_CAST")
    suspend fun passkeysAuthOptions(email: String? = null): Map<String, Any?> {
        val body = if (email.isNullOrBlank()) emptyMap() else mapOf("email" to email)
        return if (core != null) {
            core.authPasskeysAuthOptions(body) as Map<String, Any?>
        } else {
            client.postPublic("/auth/passkeys/auth-options", body) as Map<String, Any?>
        }
    }

    @Suppress("UNCHECKED_CAST")
    suspend fun passkeysAuthenticate(response: Any?): Map<String, Any?> {
        val body = mapOf("response" to response)
        val result = if (core != null) {
            core.authPasskeysAuthenticate(body) as Map<String, Any?>
        } else {
            client.postPublic("/auth/passkeys/authenticate", body) as Map<String, Any?>
        }
        handleAuthResponse(result)
        return result
    }

    @Suppress("UNCHECKED_CAST")
    suspend fun passkeysList(): Map<String, Any?> {
        return if (core != null) {
            core.authPasskeysList() as Map<String, Any?>
        } else {
            client.get("/auth/passkeys") as Map<String, Any?>
        }
    }

    @Suppress("UNCHECKED_CAST")
    suspend fun passkeysDelete(credentialId: String): Map<String, Any?> {
        return if (core != null) {
            core.authPasskeysDelete(credentialId) as Map<String, Any?>
        } else {
            client.delete("/auth/passkeys/$credentialId") as Map<String, Any?>
        }
    }

    // MARK: - MFA / TOTP

    /** MFA sub-namespace for TOTP enrollment, verification, and management. */
    val mfa = MfaClient()

    inner class MfaClient {
        /** Enroll TOTP — returns factorId, secret, qrCodeUri, and recoveryCodes. */
        @Suppress("UNCHECKED_CAST")
        suspend fun enrollTotp(): Map<String, Any?> {
            return if (core != null) {
                core.authMfaTotpEnroll() as Map<String, Any?>
            } else {
                client.post("/auth/mfa/totp/enroll", emptyMap<String, Any>()) as Map<String, Any?>
            }
        }

        /** Verify TOTP enrollment with factorId and a TOTP code. */
        suspend fun verifyTotpEnrollment(factorId: String, code: String) {
            if (core != null) {
                core.authMfaTotpVerify(mapOf("factorId" to factorId, "code" to code))
            } else {
                client.post("/auth/mfa/totp/verify", mapOf("factorId" to factorId, "code" to code))
            }
        }

        /**
         * Verify TOTP code during MFA challenge (after signIn returns mfaRequired).
         * Note: Uses postPublic (no auth) since user is mid-signin.
         */
        @Suppress("UNCHECKED_CAST")
        suspend fun verifyTotp(mfaTicket: String, code: String): Map<String, Any?> {
            // Public endpoint — user has no token yet during MFA challenge
            val result = client.postPublic("/auth/mfa/verify", mapOf(
                "mfaTicket" to mfaTicket, "code" to code
            )) as Map<String, Any?>
            handleAuthResponse(result)
            return result
        }

        /**
         * Use a recovery code during MFA challenge.
         * Note: Uses postPublic (no auth) since user is mid-signin.
         */
        @Suppress("UNCHECKED_CAST")
        suspend fun useRecoveryCode(mfaTicket: String, recoveryCode: String): Map<String, Any?> {
            // Public endpoint — user has no token yet during MFA challenge
            val result = client.postPublic("/auth/mfa/recovery", mapOf(
                "mfaTicket" to mfaTicket, "recoveryCode" to recoveryCode
            )) as Map<String, Any?>
            handleAuthResponse(result)
            return result
        }

        /** Disable TOTP for the current user. Requires password or TOTP code. */
        suspend fun disableTotp(password: String? = null, code: String? = null) {
            val body = mutableMapOf<String, Any?>()
            if (password != null) body["password"] = password
            if (code != null) body["code"] = code
            if (core != null) {
                core.authMfaTotpDelete(body)
            } else {
                client.delete("/auth/mfa/totp", body)
            }
        }

        /** List enrolled MFA factors for the current user. */
        @Suppress("UNCHECKED_CAST")
        suspend fun listFactors(): List<Map<String, Any?>> {
            val result = if (core != null) {
                core.authMfaFactors() as? Map<String, Any?>
            } else {
                client.get("/auth/mfa/factors") as? Map<String, Any?>
            } ?: return emptyList()
            return (result["factors"] as? List<Map<String, Any?>>) ?: emptyList()
        }
    }

    // MARK: - Internal

    private suspend fun handleAuthResponse(result: Map<String, Any?>) {
        val accessToken = result["accessToken"] as? String
        val refreshToken = result["refreshToken"] as? String
        if (accessToken != null && refreshToken != null) {
            tokenManager.setTokens(TokenPair(accessToken, refreshToken))
        }
    }

    suspend fun signInWithEmailOtp(email: String) {
        val body = mapOf<String, Any?>("email" to email)
        if (core != null) {
            core.authSigninEmailOtp(body)
        } else {
            client.post("/auth/signin/email-otp", body)
        }
    }
}
