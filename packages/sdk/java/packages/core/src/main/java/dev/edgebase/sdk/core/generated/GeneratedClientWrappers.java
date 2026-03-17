// Auto-generated client wrapper methods — DO NOT EDIT.
// Regenerate: npx tsx tools/sdk-codegen/generate.ts
// Source: wrapper-config.json + openapi.json (0.1.0)

package dev.edgebase.sdk.core.generated;

import dev.edgebase.sdk.core.EdgeBaseError;

import java.util.Map;

/**
 * Auto-generated client wrapper methods.
 */
public class GeneratedClientWrappers {

    /** Authentication wrapper methods */
    public static class AuthMethods {
        protected final GeneratedDbApi core;

        public AuthMethods(GeneratedDbApi core) {
            this.core = core;
        }

        /** Sign up with email and password */
        public Object signUp(Map<String, ?> body) throws EdgeBaseError {
            return core.authSignup(body);
        }

        /** Sign in with email and password */
        public Object signIn(Map<String, ?> body) throws EdgeBaseError {
            return core.authSignin(body);
        }

        /** Sign out and revoke refresh token */
        public Object signOut(Map<String, ?> body) throws EdgeBaseError {
            return core.authSignout(body);
        }

        /** Sign in anonymously */
        public Object signInAnonymously(Map<String, ?> body) throws EdgeBaseError {
            return core.authSigninAnonymous(body);
        }

        /** Send magic link to email */
        public Object signInWithMagicLink(Map<String, ?> body) throws EdgeBaseError {
            return core.authSigninMagicLink(body);
        }

        /** Verify magic link token */
        public Object verifyMagicLink(Map<String, ?> body) throws EdgeBaseError {
            return core.authVerifyMagicLink(body);
        }

        /** Send OTP SMS to phone number */
        public Object signInWithPhone(Map<String, ?> body) throws EdgeBaseError {
            return core.authSigninPhone(body);
        }

        /** Verify phone OTP and create session */
        public Object verifyPhone(Map<String, ?> body) throws EdgeBaseError {
            return core.authVerifyPhone(body);
        }

        /** Send OTP code to email */
        public Object signInWithEmailOtp(Map<String, ?> body) throws EdgeBaseError {
            return core.authSigninEmailOtp(body);
        }

        /** Verify email OTP and create session */
        public Object verifyEmailOtp(Map<String, ?> body) throws EdgeBaseError {
            return core.authVerifyEmailOtp(body);
        }

        /** Link phone number to existing account */
        public Object linkWithPhone(Map<String, ?> body) throws EdgeBaseError {
            return core.authLinkPhone(body);
        }

        /** Verify OTP and link phone to account */
        public Object verifyLinkPhone(Map<String, ?> body) throws EdgeBaseError {
            return core.authVerifyLinkPhone(body);
        }

        /** Link email and password to existing account */
        public Object linkWithEmail(Map<String, ?> body) throws EdgeBaseError {
            return core.authLinkEmail(body);
        }

        /** Request email change with password confirmation */
        public Object changeEmail(Map<String, ?> body) throws EdgeBaseError {
            return core.authChangeEmail(body);
        }

        /** Verify email change token */
        public Object verifyEmailChange(Map<String, ?> body) throws EdgeBaseError {
            return core.authVerifyEmailChange(body);
        }

        /** Verify email address with token */
        public Object verifyEmail(Map<String, ?> body) throws EdgeBaseError {
            return core.authVerifyEmail(body);
        }

        /** Request password reset email */
        public Object requestPasswordReset(Map<String, ?> body) throws EdgeBaseError {
            return core.authRequestPasswordReset(body);
        }

        /** Reset password with token */
        public Object resetPassword(Map<String, ?> body) throws EdgeBaseError {
            return core.authResetPassword(body);
        }

        /** Change password for authenticated user */
        public Object changePassword(Map<String, ?> body) throws EdgeBaseError {
            return core.authChangePassword(body);
        }

        /** Get current authenticated user info */
        public Object getMe() throws EdgeBaseError {
            return core.authGetMe();
        }

        /** Update user profile */
        public Object updateProfile(Map<String, ?> body) throws EdgeBaseError {
            return core.authUpdateProfile(body);
        }

        /** List active sessions */
        public Object listSessions() throws EdgeBaseError {
            return core.authGetSessions();
        }

        /** Delete a session */
        public Object revokeSession(String id) throws EdgeBaseError {
            return core.authDeleteSession(id);
        }

        /** Enroll new TOTP factor */
        public Object enrollTotp() throws EdgeBaseError {
            return core.authMfaTotpEnroll();
        }

        /** Confirm TOTP enrollment with code */
        public Object verifyTotpEnrollment(Map<String, ?> body) throws EdgeBaseError {
            return core.authMfaTotpVerify(body);
        }

        /** Verify MFA code during signin */
        public Object verifyTotp(Map<String, ?> body) throws EdgeBaseError {
            return core.authMfaVerify(body);
        }

        /** Use recovery code during MFA signin */
        public Object useRecoveryCode(Map<String, ?> body) throws EdgeBaseError {
            return core.authMfaRecovery(body);
        }

        /** Disable TOTP factor */
        public Object disableTotp(Map<String, ?> body) throws EdgeBaseError {
            return core.authMfaTotpDelete(body);
        }

        /** List MFA factors for authenticated user */
        public Object listFactors() throws EdgeBaseError {
            return core.authMfaFactors();
        }

        /** Generate passkey registration options */
        public Object passkeysRegisterOptions() throws EdgeBaseError {
            return core.authPasskeysRegisterOptions();
        }

        /** Verify and store passkey registration */
        public Object passkeysRegister(Map<String, ?> body) throws EdgeBaseError {
            return core.authPasskeysRegister(body);
        }

        /** Generate passkey authentication options */
        public Object passkeysAuthOptions(Map<String, ?> body) throws EdgeBaseError {
            return core.authPasskeysAuthOptions(body);
        }

        /** Authenticate with passkey */
        public Object passkeysAuthenticate(Map<String, ?> body) throws EdgeBaseError {
            return core.authPasskeysAuthenticate(body);
        }

        /** List passkeys for authenticated user */
        public Object passkeysList() throws EdgeBaseError {
            return core.authPasskeysList();
        }

        /** Delete a passkey */
        public Object passkeysDelete(String credentialId) throws EdgeBaseError {
            return core.authPasskeysDelete(credentialId);
        }
    }

    /** Storage wrapper methods (bucket-scoped) */
    public static class StorageMethods {
        protected final GeneratedDbApi core;

        public StorageMethods(GeneratedDbApi core) {
            this.core = core;
        }

        /** Delete file */
        public Object delete(String bucket, String key) throws EdgeBaseError {
            return core.deleteFile(bucket, key);
        }

        /** Batch delete files */
        public Object deleteMany(String bucket, Map<String, ?> body) throws EdgeBaseError {
            return core.deleteBatch(bucket, body);
        }

        /** Check if file exists */
        public boolean exists(String bucket, String key) throws EdgeBaseError {
            return core.checkFileExists(bucket, key);
        }

        /** Get file metadata */
        public Object getMetadata(String bucket, String key) throws EdgeBaseError {
            return core.getFileMetadata(bucket, key);
        }

        /** Update file metadata */
        public Object updateMetadata(String bucket, String key, Map<String, ?> body) throws EdgeBaseError {
            return core.updateFileMetadata(bucket, key, body);
        }

        /** Create signed download URL */
        public Object createSignedUrl(String bucket, Map<String, ?> body) throws EdgeBaseError {
            return core.createSignedDownloadUrl(bucket, body);
        }

        /** Batch create signed download URLs */
        public Object createSignedUrls(String bucket, Map<String, ?> body) throws EdgeBaseError {
            return core.createSignedDownloadUrls(bucket, body);
        }

        /** Create signed upload URL */
        public Object createSignedUploadUrl(String bucket, Map<String, ?> body) throws EdgeBaseError {
            return core.createSignedUploadUrl(bucket, body);
        }

        /** Start multipart upload */
        public Object createMultipartUpload(String bucket, Map<String, ?> body) throws EdgeBaseError {
            return core.createMultipartUpload(bucket, body);
        }

        /** Complete multipart upload */
        public Object completeMultipartUpload(String bucket, Map<String, ?> body) throws EdgeBaseError {
            return core.completeMultipartUpload(bucket, body);
        }

        /** Abort multipart upload */
        public Object abortMultipartUpload(String bucket, Map<String, ?> body) throws EdgeBaseError {
            return core.abortMultipartUpload(bucket, body);
        }
    }

    /** Analytics wrapper methods */
    public static class AnalyticsMethods {
        protected final GeneratedDbApi core;

        public AnalyticsMethods(GeneratedDbApi core) {
            this.core = core;
        }

        /** Track custom events */
        public Object track(Map<String, ?> body) throws EdgeBaseError {
            return core.trackEvents(body);
        }
    }

}
