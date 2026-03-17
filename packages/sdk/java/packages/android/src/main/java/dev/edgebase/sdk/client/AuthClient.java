// EdgeBase Java SDK — Authentication client.
// Full auth operations: signUp, signIn, signOut, OAuth, sessions, profile.
package dev.edgebase.sdk.client;

import dev.edgebase.sdk.core.*;
import dev.edgebase.sdk.core.generated.GeneratedClientWrappers;
import dev.edgebase.sdk.core.generated.GeneratedDbApi;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.function.Consumer;

/**
 * Authentication client for EdgeBase.
 *
 * <p>
 * Usage:
 * 
 * <pre>{@code
 * client.auth().signUp("user@example.com", "password");
 * client.auth().signIn("user@example.com", "password");
 * }</pre>
 */
public class AuthClient {
    public static class PasskeysAuthOptions {
        private final String email;

        public PasskeysAuthOptions() {
            this(null);
        }

        public PasskeysAuthOptions(String email) {
            this.email = email;
        }

        Map<String, Object> toBody() {
            Map<String, Object> body = new HashMap<>();
            if (email != null && !email.isEmpty()) {
                body.put("email", email);
            }
            return body;
        }
    }

    private final HttpClient client;
    private final TokenManager tokenManager;
    private final GeneratedClientWrappers.AuthMethods authMethods;

    private Runnable onBeforeSignOutCallback;

    AuthClient(HttpClient client, TokenManager tokenManager, GeneratedDbApi core) {
        this.client = client;
        this.tokenManager = tokenManager;
        this.authMethods = new GeneratedClientWrappers.AuthMethods(core);
    }

    public void onBeforeSignOut(Runnable callback) {
        this.onBeforeSignOutCallback = callback;
    }

    // ─── Authentication ───

    public Map<String, Object> signUp(String email, String password) {
        return signUp(email, password, null, null);
    }

    public Map<String, Object> signUp(String email, String password, Map<String, Object> data) {
        return signUp(email, password, data, null);
    }

    /** @param captchaToken Captcha token. May be null. */
    @SuppressWarnings("unchecked")
    public Map<String, Object> signUp(String email, String password, Map<String, Object> data, String captchaToken) {
        Map<String, Object> body = new HashMap<>();
        body.put("email", email);
        body.put("password", password);
        if (data != null)
            body.put("data", data);
        //: auto-acquire captcha token
        String resolved = resolveCaptchaToken("signup", captchaToken);
        if (resolved != null)
            body.put("captchaToken", resolved);
        Map<String, Object> result = (Map<String, Object>) client.postPublic("/auth/signup", body);
        handleAuthResponse(result);
        return result;
    }

    public Map<String, Object> signIn(String email, String password) {
        return signIn(email, password, null);
    }

    /**
     * Sign in with email and password.
     * If MFA is enabled, result will contain "mfaRequired"=true, "mfaTicket", and "factors".
     * @param captchaToken Captcha token. May be null.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> signIn(String email, String password, String captchaToken) {
        Map<String, Object> body = new HashMap<>();
        body.put("email", email);
        body.put("password", password);
        //: auto-acquire captcha token
        String resolved = resolveCaptchaToken("signin", captchaToken);
        if (resolved != null)
            body.put("captchaToken", resolved);
        Map<String, Object> result = (Map<String, Object>) client.postPublic("/auth/signin", body);
        // If MFA is required, return result without setting tokens
        if (Boolean.TRUE.equals(result.get("mfaRequired")))
            return result;
        handleAuthResponse(result);
        return result;
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> signInAnonymously() {
        return signInAnonymously(null);
    }

    /** @param captchaToken Captcha token. May be null. */
    @SuppressWarnings("unchecked")
    public Map<String, Object> signInAnonymously(String captchaToken) {
        Map<String, Object> body = new HashMap<>();
        //: auto-acquire captcha token
        String resolved = resolveCaptchaToken("anonymous", captchaToken);
        if (resolved != null)
            body.put("captchaToken", resolved);
        Map<String, Object> result = (Map<String, Object>) client.postPublic("/auth/signin/anonymous", body);
        handleAuthResponse(result);
        return result;
    }

    /**
     * Start OAuth sign-in flow. Returns the OAuth redirect URL.
     */
    public String signInWithOAuth(String provider) {
        return signInWithOAuth(provider, null);
    }

    /** @param captchaToken Captcha token. May be null. */
    public String signInWithOAuth(String provider, String captchaToken) {
        // Build URL using HttpClient's baseUrl + API prefix (avoids hardcoded /api/)
        String base = client.getApiBaseUrl() + "/auth/oauth/" +
                URLEncoder.encode(provider, StandardCharsets.UTF_8);
        if (captchaToken != null) {
            return base + "?captcha_token=" + URLEncoder.encode(captchaToken, StandardCharsets.UTF_8);
        }
        return base;
    }

    /**
     * Send a magic link sign-in email.
     *
     * @param email the recipient email address
     */
    public void signInWithMagicLink(String email) {
        signInWithMagicLink(email, null);
    }

    /**
     * Send a magic link sign-in email.
     *
     * @param email        the recipient email address
     * @param captchaToken Captcha token. May be null.
     */
    public void signInWithMagicLink(String email, String captchaToken) {
        Map<String, Object> body = new HashMap<>();
        body.put("email", email);
        //: auto-acquire captcha token
        String resolved = resolveCaptchaToken("magic-link", captchaToken);
        if (resolved != null)
            body.put("captchaToken", resolved);
        client.postPublic("/auth/signin/magic-link", body);
    }

    /**
     * Verify a magic link token and complete sign-in.
     *
     * @param token the magic link token from the email
     * @return auth result containing accessToken, refreshToken, and user
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> verifyMagicLink(String token) {
        Map<String, Object> body = new HashMap<>();
        body.put("token", token);
        Map<String, Object> result = (Map<String, Object>) client.postPublic("/auth/verify-magic-link", body);
        handleAuthResponse(result);
        return result;
    }

    // ─── Phone / SMS Auth ───

    /**
     * Send an SMS verification code to the given phone number.
     *
     * @param phone the phone number to send the code to
     */
    public void signInWithPhone(String phone) {
        signInWithPhone(phone, null);
    }

    /** @param captchaToken Captcha token. May be null. */
    public void signInWithPhone(String phone, String captchaToken) {
        Map<String, Object> body = new HashMap<>();
        body.put("phone", phone);
        String resolved = resolveCaptchaToken("phone", captchaToken);
        if (resolved != null)
            body.put("captchaToken", resolved);
        client.postPublic("/auth/signin/phone", body);
    }

    /**
     * Verify the SMS code and complete sign-in.
     *
     * @param phone the phone number
     * @param code  the verification code received via SMS
     * @return auth result containing accessToken, refreshToken, and user
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> verifyPhone(String phone, String code) {
        Map<String, Object> body = new HashMap<>();
        body.put("phone", phone);
        body.put("code", code);
        Map<String, Object> result = (Map<String, Object>) client.postPublic("/auth/verify-phone", body);
        handleAuthResponse(result);
        return result;
    }

    /**
     * Link current account with a phone number. Sends an SMS code.
     *
     * @param phone the phone number to link
     */
    public void linkWithPhone(String phone) {
        Map<String, Object> body = new HashMap<>();
        body.put("phone", phone);
        client.post("/auth/link/phone", body);
    }

    /**
     * Verify phone link code. Completes phone linking for the current account.
     *
     * @param phone the phone number
     * @param code  the verification code received via SMS
     */
    public void verifyLinkPhone(String phone, String code) {
        Map<String, Object> body = new HashMap<>();
        body.put("phone", phone);
        body.put("code", code);
        client.post("/auth/verify-link-phone", body);
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> linkWithEmail(String email, String password) {
        Map<String, Object> body = new HashMap<>();
        body.put("email", email);
        body.put("password", password);
        Map<String, Object> result = (Map<String, Object>) client.post("/auth/link/email", body);
        handleAuthResponse(result);
        return result;
    }

    @SuppressWarnings("unchecked")
    public String linkWithOAuth(String provider, String redirectUrl) {
        Map<String, Object> body = new HashMap<>();
        body.put("redirectUrl", redirectUrl != null ? redirectUrl : "");
        Map<String, Object> result = (Map<String, Object>) client.post(
                "/auth/oauth/link/" + URLEncoder.encode(provider, StandardCharsets.UTF_8), body);
        return (String) result.getOrDefault("redirectUrl", "");
    }

    public String linkWithOAuth(String provider) {
        return linkWithOAuth(provider, "");
    }

    public void signOut() {
        if (onBeforeSignOutCallback != null) {
            try {
                onBeforeSignOutCallback.run();
            } catch (Exception ignored) {
            }
        }
        try {
            String refreshToken = tokenManager.getRefreshToken();
            if (refreshToken != null) {
                client.post("/auth/signout", Map.of("refreshToken", refreshToken));
            }
        } catch (Exception ignored) {
            // Continue even if server call fails
        }
        tokenManager.clearTokens();
    }

    // ─── Session Management ───

    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> listSessions() {
        Map<String, Object> result = (Map<String, Object>) client.get("/auth/sessions");
        if (result == null)
            return Collections.emptyList();
        List<Map<String, Object>> sessions = (List<Map<String, Object>>) result.get("sessions");
        return sessions != null ? sessions : Collections.emptyList();
    }

    public void revokeSession(String sessionId) {
        client.delete("/auth/sessions/" + sessionId);
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> listIdentities() {
        return (Map<String, Object>) client.get("/auth/identities");
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> unlinkIdentity(String identityId) {
        return (Map<String, Object>) client.delete("/auth/identities/" + URLEncoder.encode(identityId, StandardCharsets.UTF_8));
    }

    // ─── Profile ───

    public Map<String, Object> currentUser() {
        return tokenManager.currentUser();
    }

    /** Fetch the current authenticated user from /api/auth/me. */
    @SuppressWarnings("unchecked")
    public Map<String, Object> getMe() {
        Map<String, Object> result = (Map<String, Object>) client.get("/auth/me");
        // Server returns { user: { ... } } — unwrap the user field
        if (result != null && result.containsKey("user")) {
            Object user = result.get("user");
            if (user instanceof Map) {
                return (Map<String, Object>) user;
            }
        }
        return result;
    }

    /** Manually refresh the access token using the stored refresh token. */
    @SuppressWarnings("unchecked")
    public Map<String, Object> refreshToken() {
        String storedRefresh = tokenManager.getRefreshToken();
        if (storedRefresh == null) {
            throw new EdgeBaseError(401, "No refresh token available");
        }
        Map<String, Object> body = new HashMap<>();
        body.put("refreshToken", storedRefresh);
        Map<String, Object> result = (Map<String, Object>) client.postPublic("/auth/refresh", body);
        handleAuthResponse(result);
        return result;
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> updateProfile(Map<String, Object> data) {
        Map<String, Object> result = (Map<String, Object>) client.patch("/auth/profile", data);
        handleAuthResponse(result);
        return result;
    }

    /** Convenience overload for common profile fields. */
    public Map<String, Object> updateProfile(String displayName, String avatarUrl) {
        Map<String, Object> body = new HashMap<>();
        if (displayName != null && !displayName.isEmpty())
            body.put("displayName", displayName);
        if (avatarUrl != null && !avatarUrl.isEmpty())
            body.put("avatarUrl", avatarUrl);
        return updateProfile(body);
    }

    // ─── Email Verification / Password Reset ───

    public void verifyEmail(String token) {
        client.postPublic("/auth/verify-email", Map.of("token", token));
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> verifyEmailOtp(String email, String code) {
        Map<String, Object> result = (Map<String, Object>) client.postPublic("/auth/verify-email-otp", Map.of(
                "email", email,
                "code", code));
        handleAuthResponse(result);
        return result;
    }

    public void verifyEmailChange(String token) {
        client.postPublic("/auth/verify-email-change", Map.of("token", token));
    }

    public void requestEmailVerification() {
        requestEmailVerification(null);
    }

    public void requestEmailVerification(String redirectUrl) {
        Map<String, Object> body = new HashMap<>();
        if (redirectUrl != null && !redirectUrl.isEmpty()) {
            body.put("redirectUrl", redirectUrl);
        }
        client.post("/auth/request-email-verification", body);
    }

    public void requestPasswordReset(String email) {
        requestPasswordReset(email, null);
    }

    /** @param captchaToken Captcha token. May be null. */
    public void requestPasswordReset(String email, String captchaToken) {
        Map<String, Object> body = new HashMap<>();
        body.put("email", email);
        //: auto-acquire captcha token
        String resolved = resolveCaptchaToken("password-reset", captchaToken);
        if (resolved != null)
            body.put("captchaToken", resolved);
        client.postPublic("/auth/request-password-reset", body);
    }

    public void resetPassword(String token, String newPassword) {
        Map<String, Object> body = new HashMap<>();
        body.put("token", token);
        body.put("newPassword", newPassword);
        client.postPublic("/auth/reset-password", body);
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> changePassword(String currentPassword, String newPassword) {
        Map<String, Object> body = new HashMap<>();
        body.put("currentPassword", currentPassword);
        body.put("newPassword", newPassword);
        Map<String, Object> result = (Map<String, Object>) client.post("/auth/change-password", body);
        handleAuthResponse(result);
        return result;
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> changeEmail(String newEmail, String password) {
        return changeEmail(newEmail, password, null);
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> changeEmail(String newEmail, String password, String redirectUrl) {
        if (password == null || password.isEmpty()) {
            throw new IllegalArgumentException("password is required for changeEmail");
        }
        Map<String, Object> body = new HashMap<>();
        body.put("newEmail", newEmail);
        body.put("password", password);
        if (redirectUrl != null && !redirectUrl.isEmpty()) {
            body.put("redirectUrl", redirectUrl);
        }
        return (Map<String, Object>) client.post("/auth/change-email", body);
    }

    // ─── Auth State ───

    /**
     * Set a listener for auth state changes.
     */
    public void onAuthStateChange(Consumer<Map<String, Object>> listener) {
        tokenManager.setOnAuthStateChange(listener);
    }

    // ─── Passkeys / WebAuthn REST layer ───

    @SuppressWarnings("unchecked")
    public Map<String, Object> passkeysRegisterOptions() {
        return (Map<String, Object>) authMethods.passkeysRegisterOptions();
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> passkeysRegister(Map<String, ?> response) {
        return (Map<String, Object>) authMethods.passkeysRegister(Map.of("response", response));
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> passkeysAuthOptions() {
        return passkeysAuthOptions((String) null);
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> passkeysAuthOptions(String email) {
        return (Map<String, Object>) authMethods.passkeysAuthOptions(new PasskeysAuthOptions(email).toBody());
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> passkeysAuthOptions(PasskeysAuthOptions options) {
        return (Map<String, Object>) authMethods.passkeysAuthOptions(options != null ? options.toBody() : Collections.emptyMap());
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> passkeysAuthenticate(Map<String, ?> response) {
        Map<String, Object> result = (Map<String, Object>) authMethods.passkeysAuthenticate(Map.of("response", response));
        handleAuthResponse(result);
        return result;
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> passkeysList() {
        return (Map<String, Object>) authMethods.passkeysList();
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> passkeysDelete(String credentialId) {
        return (Map<String, Object>) authMethods.passkeysDelete(credentialId);
    }

    // ─── MFA / TOTP ───

    /** Enroll TOTP — returns factorId, secret, qrCodeUri, and recoveryCodes. */
    @SuppressWarnings("unchecked")
    public Map<String, Object> enrollTotp() {
        return (Map<String, Object>) client.post("/auth/mfa/totp/enroll", new HashMap<>());
    }

    /** Verify TOTP enrollment with factorId and a TOTP code. */
    public void verifyTotpEnrollment(String factorId, String code) {
        Map<String, Object> body = new HashMap<>();
        body.put("factorId", factorId);
        body.put("code", code);
        client.post("/auth/mfa/totp/verify", body);
    }

    /** Verify TOTP code during MFA challenge (after signIn returns mfaRequired). */
    @SuppressWarnings("unchecked")
    public Map<String, Object> verifyTotp(String mfaTicket, String code) {
        Map<String, Object> body = new HashMap<>();
        body.put("mfaTicket", mfaTicket);
        body.put("code", code);
        Map<String, Object> result = (Map<String, Object>) client.postPublic("/auth/mfa/verify", body);
        handleAuthResponse(result);
        return result;
    }

    /** Use a recovery code during MFA challenge. */
    @SuppressWarnings("unchecked")
    public Map<String, Object> useRecoveryCode(String mfaTicket, String recoveryCode) {
        Map<String, Object> body = new HashMap<>();
        body.put("mfaTicket", mfaTicket);
        body.put("recoveryCode", recoveryCode);
        Map<String, Object> result = (Map<String, Object>) client.postPublic("/auth/mfa/recovery", body);
        handleAuthResponse(result);
        return result;
    }

    /** Disable TOTP for the current user. Requires password or TOTP code. */
    public void disableTotp(String password, String code) {
        Map<String, Object> body = new HashMap<>();
        if (password != null)
            body.put("password", password);
        if (code != null)
            body.put("code", code);
        client.delete("/auth/mfa/totp", body);
    }

    public void disableTotp() {
        disableTotp(null, null);
    }

    /** List enrolled MFA factors for the current user. */
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> listFactors() {
        Map<String, Object> result = (Map<String, Object>) client.get("/auth/mfa/factors");
        if (result == null)
            return Collections.emptyList();
        List<Map<String, Object>> factors = (List<Map<String, Object>>) result.get("factors");
        return factors != null ? factors : Collections.emptyList();
    }

    public void signInWithEmailOtp(String email) {
        client.post("/auth/signin/email-otp", Map.of("email", email));
    }

    private final PasskeysNamespace passkeysNamespace = new PasskeysNamespace();
    private final MfaNamespace mfaNamespace = new MfaNamespace();

    public PasskeysNamespace passkeys() {
        return passkeysNamespace;
    }

    public MfaNamespace mfa() {
        return mfaNamespace;
    }

    public final class PasskeysNamespace {
    }

    public final class MfaNamespace {
    }

    // ─── Internal ───

    private void handleAuthResponse(Map<String, Object> result) {
        if (result == null)
            return;
        String accessToken = (String) result.get("accessToken");
        String refreshToken = (String) result.get("refreshToken");
        if (accessToken != null && refreshToken != null) {
            tokenManager.setTokens(new TokenPair(accessToken, refreshToken));
        }
    }

    private String resolveCaptchaToken(String action, String manualToken) {
        if (manualToken != null) {
            return manualToken;
        }
        String configuredToken = configuredCaptchaToken();
        if (configuredToken != null) {
            return configuredToken;
        }
        if (isAutoCaptchaDisabled() || !isAndroidRuntime()) {
            return null;
        }
        try {
            return TurnstileProvider.resolveCaptchaToken(client.baseUrl, action, null);
        } catch (Throwable ignored) {
            return null;
        }
    }

    private static boolean isAutoCaptchaDisabled() {
        String env = System.getenv("EDGEBASE_DISABLE_AUTO_CAPTCHA");
        if (env != null && !env.isBlank() && !"0".equals(env) && !"false".equalsIgnoreCase(env)) {
            return true;
        }
        String prop = System.getProperty("edgebase.disableAutoCaptcha");
        return prop != null && !prop.isBlank() && !"0".equals(prop) && !"false".equalsIgnoreCase(prop);
    }

    private static String configuredCaptchaToken() {
        String prop = firstNonBlank(
                System.getProperty("edgebase.captchaToken"),
                System.getProperty("EDGEBASE_CAPTCHA_TOKEN"));
        if (prop != null) {
            return prop;
        }

        return firstNonBlank(
                System.getenv("EDGEBASE_CAPTCHA_TOKEN"),
                System.getenv("EDGEBASE_TEST_CAPTCHA_TOKEN"));
    }

    private static String firstNonBlank(String... values) {
        for (String value : values) {
            if (value != null && !value.isBlank()) {
                return value;
            }
        }
        return null;
    }

    private static boolean isAndroidRuntime() {
        try {
            Class.forName("android.os.Build");
            return true;
        } catch (Throwable ignored) {
            return false;
        }
    }
}
