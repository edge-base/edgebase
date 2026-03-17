// Auto-generated client wrapper methods — DO NOT EDIT.
// Regenerate: npx tsx tools/sdk-codegen/generate.ts
// Source: wrapper-config.json + openapi.json (0.1.0)

import 'api_core.dart';

/// Authentication wrapper methods
class GeneratedAuthMethods {
  final GeneratedDbApi _core;

  GeneratedAuthMethods(this._core);

  /// Sign up with email and password
  Future<dynamic> signUp(Object? body) async {
    return _core.authSignup(body);
  }

  /// Sign in with email and password
  Future<dynamic> signIn(Object? body) async {
    return _core.authSignin(body);
  }

  /// Sign out and revoke refresh token
  Future<dynamic> signOut(Object? body) async {
    return _core.authSignout(body);
  }

  /// Sign in anonymously
  Future<dynamic> signInAnonymously(Object? body) async {
    return _core.authSigninAnonymous(body);
  }

  /// Send magic link to email
  Future<dynamic> signInWithMagicLink(Object? body) async {
    return _core.authSigninMagicLink(body);
  }

  /// Verify magic link token
  Future<dynamic> verifyMagicLink(Object? body) async {
    return _core.authVerifyMagicLink(body);
  }

  /// Send OTP SMS to phone number
  Future<dynamic> signInWithPhone(Object? body) async {
    return _core.authSigninPhone(body);
  }

  /// Verify phone OTP and create session
  Future<dynamic> verifyPhone(Object? body) async {
    return _core.authVerifyPhone(body);
  }

  /// Send OTP code to email
  Future<dynamic> signInWithEmailOtp(Object? body) async {
    return _core.authSigninEmailOtp(body);
  }

  /// Verify email OTP and create session
  Future<dynamic> verifyEmailOtp(Object? body) async {
    return _core.authVerifyEmailOtp(body);
  }

  /// Link phone number to existing account
  Future<dynamic> linkWithPhone(Object? body) async {
    return _core.authLinkPhone(body);
  }

  /// Verify OTP and link phone to account
  Future<dynamic> verifyLinkPhone(Object? body) async {
    return _core.authVerifyLinkPhone(body);
  }

  /// Link email and password to existing account
  Future<dynamic> linkWithEmail(Object? body) async {
    return _core.authLinkEmail(body);
  }

  /// Request email change with password confirmation
  Future<dynamic> changeEmail(Object? body) async {
    return _core.authChangeEmail(body);
  }

  /// Verify email change token
  Future<dynamic> verifyEmailChange(Object? body) async {
    return _core.authVerifyEmailChange(body);
  }

  /// Verify email address with token
  Future<dynamic> verifyEmail(Object? body) async {
    return _core.authVerifyEmail(body);
  }

  /// Request password reset email
  Future<dynamic> requestPasswordReset(Object? body) async {
    return _core.authRequestPasswordReset(body);
  }

  /// Reset password with token
  Future<dynamic> resetPassword(Object? body) async {
    return _core.authResetPassword(body);
  }

  /// Change password for authenticated user
  Future<dynamic> changePassword(Object? body) async {
    return _core.authChangePassword(body);
  }

  /// Get current authenticated user info
  Future<dynamic> getMe() async {
    return _core.authGetMe();
  }

  /// Update user profile
  Future<dynamic> updateProfile(Object? body) async {
    return _core.authUpdateProfile(body);
  }

  /// List active sessions
  Future<dynamic> listSessions() async {
    return _core.authGetSessions();
  }

  /// Delete a session
  Future<dynamic> revokeSession(String id) async {
    return _core.authDeleteSession(id);
  }

  /// Enroll new TOTP factor
  Future<dynamic> enrollTotp() async {
    return _core.authMfaTotpEnroll();
  }

  /// Confirm TOTP enrollment with code
  Future<dynamic> verifyTotpEnrollment(Object? body) async {
    return _core.authMfaTotpVerify(body);
  }

  /// Verify MFA code during signin
  Future<dynamic> verifyTotp(Object? body) async {
    return _core.authMfaVerify(body);
  }

  /// Use recovery code during MFA signin
  Future<dynamic> useRecoveryCode(Object? body) async {
    return _core.authMfaRecovery(body);
  }

  /// Disable TOTP factor
  Future<dynamic> disableTotp(Object? body) async {
    return _core.authMfaTotpDelete(body);
  }

  /// List MFA factors for authenticated user
  Future<dynamic> listFactors() async {
    return _core.authMfaFactors();
  }

  /// Generate passkey registration options
  Future<dynamic> passkeysRegisterOptions() async {
    return _core.authPasskeysRegisterOptions();
  }

  /// Verify and store passkey registration
  Future<dynamic> passkeysRegister(Object? body) async {
    return _core.authPasskeysRegister(body);
  }

  /// Generate passkey authentication options
  Future<dynamic> passkeysAuthOptions(Object? body) async {
    return _core.authPasskeysAuthOptions(body);
  }

  /// Authenticate with passkey
  Future<dynamic> passkeysAuthenticate(Object? body) async {
    return _core.authPasskeysAuthenticate(body);
  }

  /// List passkeys for authenticated user
  Future<dynamic> passkeysList() async {
    return _core.authPasskeysList();
  }

  /// Delete a passkey
  Future<dynamic> passkeysDelete(String credentialId) async {
    return _core.authPasskeysDelete(credentialId);
  }
}

/// Storage wrapper methods (bucket-scoped)
class GeneratedStorageMethods {
  final GeneratedDbApi _core;

  GeneratedStorageMethods(this._core);

  /// Delete file
  Future<dynamic> delete(String bucket, String key) async {
    return _core.deleteFile(bucket, key);
  }

  /// Batch delete files
  Future<dynamic> deleteMany(String bucket, Object? body) async {
    return _core.deleteBatch(bucket, body);
  }

  /// Check if file exists
  Future<bool> exists(String bucket, String key) async {
    return _core.checkFileExists(bucket, key);
  }

  /// Get file metadata
  Future<dynamic> getMetadata(String bucket, String key) async {
    return _core.getFileMetadata(bucket, key);
  }

  /// Update file metadata
  Future<dynamic> updateMetadata(String bucket, String key, Object? body) async {
    return _core.updateFileMetadata(bucket, key, body);
  }

  /// Create signed download URL
  Future<dynamic> createSignedUrl(String bucket, Object? body) async {
    return _core.createSignedDownloadUrl(bucket, body);
  }

  /// Batch create signed download URLs
  Future<dynamic> createSignedUrls(String bucket, Object? body) async {
    return _core.createSignedDownloadUrls(bucket, body);
  }

  /// Create signed upload URL
  Future<dynamic> createSignedUploadUrl(String bucket, Object? body) async {
    return _core.createSignedUploadUrl(bucket, body);
  }

  /// Start multipart upload
  Future<dynamic> createMultipartUpload(String bucket, Object? body) async {
    return _core.createMultipartUpload(bucket, body);
  }

  /// Complete multipart upload
  Future<dynamic> completeMultipartUpload(String bucket, Object? body) async {
    return _core.completeMultipartUpload(bucket, body);
  }

  /// Abort multipart upload
  Future<dynamic> abortMultipartUpload(String bucket, Object? body) async {
    return _core.abortMultipartUpload(bucket, body);
  }
}

/// Analytics wrapper methods
class GeneratedAnalyticsMethods {
  final GeneratedDbApi _core;

  GeneratedAnalyticsMethods(this._core);

  /// Track custom events
  Future<dynamic> track(Object? body) async {
    return _core.trackEvents(body);
  }
}
