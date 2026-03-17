/**
 * Auto-generated client wrapper methods — DO NOT EDIT.
 * Regenerate: npx tsx tools/sdk-codegen/generate.ts
 * Source: wrapper-config.json + openapi.json (0.1.0)
 *
 * These classes provide user-friendly method names that delegate
 * to GeneratedDbApi core methods. Extend or compose in hand-written
 * client code to add side effects (token management, etc.).
 */

import type { GeneratedDbApi } from './api-core.js';

/** Authentication wrapper methods */
export class GeneratedAuthMethods {
  constructor(protected core: GeneratedDbApi) {}

  /** Sign up with email and password */
  async signUp(body: unknown): Promise<unknown> {
    return this.core.authSignup(body);
  }

  /** Sign in with email and password */
  async signIn(body: unknown): Promise<unknown> {
    return this.core.authSignin(body);
  }

  /** Sign out and revoke refresh token */
  async signOut(body: unknown): Promise<unknown> {
    return this.core.authSignout(body);
  }

  /** Sign in anonymously */
  async signInAnonymously(body: unknown): Promise<unknown> {
    return this.core.authSigninAnonymous(body);
  }

  /** Send magic link to email */
  async signInWithMagicLink(body: unknown): Promise<unknown> {
    return this.core.authSigninMagicLink(body);
  }

  /** Verify magic link token */
  async verifyMagicLink(body: unknown): Promise<unknown> {
    return this.core.authVerifyMagicLink(body);
  }

  /** Send OTP SMS to phone number */
  async signInWithPhone(body: unknown): Promise<unknown> {
    return this.core.authSigninPhone(body);
  }

  /** Verify phone OTP and create session */
  async verifyPhone(body: unknown): Promise<unknown> {
    return this.core.authVerifyPhone(body);
  }

  /** Send OTP code to email */
  async signInWithEmailOtp(body: unknown): Promise<unknown> {
    return this.core.authSigninEmailOtp(body);
  }

  /** Verify email OTP and create session */
  async verifyEmailOtp(body: unknown): Promise<unknown> {
    return this.core.authVerifyEmailOtp(body);
  }

  /** Link phone number to existing account */
  async linkWithPhone(body: unknown): Promise<unknown> {
    return this.core.authLinkPhone(body);
  }

  /** Verify OTP and link phone to account */
  async verifyLinkPhone(body: unknown): Promise<unknown> {
    return this.core.authVerifyLinkPhone(body);
  }

  /** Link email and password to existing account */
  async linkWithEmail(body: unknown): Promise<unknown> {
    return this.core.authLinkEmail(body);
  }

  /** Request email change with password confirmation */
  async changeEmail(body: unknown): Promise<unknown> {
    return this.core.authChangeEmail(body);
  }

  /** Verify email change token */
  async verifyEmailChange(body: unknown): Promise<unknown> {
    return this.core.authVerifyEmailChange(body);
  }

  /** Verify email address with token */
  async verifyEmail(body: unknown): Promise<unknown> {
    return this.core.authVerifyEmail(body);
  }

  /** Request password reset email */
  async requestPasswordReset(body: unknown): Promise<unknown> {
    return this.core.authRequestPasswordReset(body);
  }

  /** Reset password with token */
  async resetPassword(body: unknown): Promise<unknown> {
    return this.core.authResetPassword(body);
  }

  /** Change password for authenticated user */
  async changePassword(body: unknown): Promise<unknown> {
    return this.core.authChangePassword(body);
  }

  /** Get current authenticated user info */
  async getMe(): Promise<unknown> {
    return this.core.authGetMe();
  }

  /** Update user profile */
  async updateProfile(body: unknown): Promise<unknown> {
    return this.core.authUpdateProfile(body);
  }

  /** List active sessions */
  async listSessions(): Promise<unknown> {
    return this.core.authGetSessions();
  }

  /** Delete a session */
  async revokeSession(id: string): Promise<unknown> {
    return this.core.authDeleteSession(id);
  }

  /** Enroll new TOTP factor */
  async enrollTotp(): Promise<unknown> {
    return this.core.authMfaTotpEnroll();
  }

  /** Confirm TOTP enrollment with code */
  async verifyTotpEnrollment(body: unknown): Promise<unknown> {
    return this.core.authMfaTotpVerify(body);
  }

  /** Verify MFA code during signin */
  async verifyTotp(body: unknown): Promise<unknown> {
    return this.core.authMfaVerify(body);
  }

  /** Use recovery code during MFA signin */
  async useRecoveryCode(body: unknown): Promise<unknown> {
    return this.core.authMfaRecovery(body);
  }

  /** Disable TOTP factor */
  async disableTotp(body: unknown): Promise<unknown> {
    return this.core.authMfaTotpDelete(body);
  }

  /** List MFA factors for authenticated user */
  async listFactors(): Promise<unknown> {
    return this.core.authMfaFactors();
  }

  /** Generate passkey registration options */
  async passkeysRegisterOptions(): Promise<unknown> {
    return this.core.authPasskeysRegisterOptions();
  }

  /** Verify and store passkey registration */
  async passkeysRegister(body: unknown): Promise<unknown> {
    return this.core.authPasskeysRegister(body);
  }

  /** Generate passkey authentication options */
  async passkeysAuthOptions(body: unknown): Promise<unknown> {
    return this.core.authPasskeysAuthOptions(body);
  }

  /** Authenticate with passkey */
  async passkeysAuthenticate(body: unknown): Promise<unknown> {
    return this.core.authPasskeysAuthenticate(body);
  }

  /** List passkeys for authenticated user */
  async passkeysList(): Promise<unknown> {
    return this.core.authPasskeysList();
  }

  /** Delete a passkey */
  async passkeysDelete(credentialId: string): Promise<unknown> {
    return this.core.authPasskeysDelete(credentialId);
  }

}

/** Storage wrapper methods (bucket-scoped) */
export class GeneratedStorageMethods {
  constructor(protected core: GeneratedDbApi) {}

  /** Delete file */
  async delete(bucket: string, key: string): Promise<unknown> {
    return this.core.deleteFile(bucket, key);
  }

  /** Batch delete files */
  async deleteMany(bucket: string, body: unknown): Promise<unknown> {
    return this.core.deleteBatch(bucket, body);
  }

  /** Check if file exists */
  async exists(bucket: string, key: string): Promise<boolean> {
    return this.core.checkFileExists(bucket, key);
  }

  /** Get file metadata */
  async getMetadata(bucket: string, key: string): Promise<unknown> {
    return this.core.getFileMetadata(bucket, key);
  }

  /** Update file metadata */
  async updateMetadata(bucket: string, key: string, body: unknown): Promise<unknown> {
    return this.core.updateFileMetadata(bucket, key, body);
  }

  /** Create signed download URL */
  async createSignedUrl(bucket: string, body: unknown): Promise<unknown> {
    return this.core.createSignedDownloadUrl(bucket, body);
  }

  /** Batch create signed download URLs */
  async createSignedUrls(bucket: string, body: unknown): Promise<unknown> {
    return this.core.createSignedDownloadUrls(bucket, body);
  }

  /** Create signed upload URL */
  async createSignedUploadUrl(bucket: string, body: unknown): Promise<unknown> {
    return this.core.createSignedUploadUrl(bucket, body);
  }

  /** Start multipart upload */
  async createMultipartUpload(bucket: string, body: unknown): Promise<unknown> {
    return this.core.createMultipartUpload(bucket, body);
  }

  /** Complete multipart upload */
  async completeMultipartUpload(bucket: string, body: unknown): Promise<unknown> {
    return this.core.completeMultipartUpload(bucket, body);
  }

  /** Abort multipart upload */
  async abortMultipartUpload(bucket: string, body: unknown): Promise<unknown> {
    return this.core.abortMultipartUpload(bucket, body);
  }

}

/** Analytics wrapper methods */
export class GeneratedAnalyticsMethods {
  constructor(protected core: GeneratedDbApi) {}

  /** Track custom events */
  async track(body: unknown): Promise<unknown> {
    return this.core.trackEvents(body);
  }

}
