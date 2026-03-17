// Auto-generated client wrapper methods — DO NOT EDIT.
// Regenerate: npx tsx tools/sdk-codegen/generate.ts
// Source: wrapper-config.json + openapi.json (0.1.0)

package edgebase

import "context"

// GeneratedAuthMethods — Authentication wrapper methods
type GeneratedAuthMethods struct {
	Core *GeneratedDbApi
}

// SignUp — Sign up with email and password
func (w *GeneratedAuthMethods) SignUp(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return w.Core.AuthSignup(ctx, body)
}

// SignIn — Sign in with email and password
func (w *GeneratedAuthMethods) SignIn(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return w.Core.AuthSignin(ctx, body)
}

// SignOut — Sign out and revoke refresh token
func (w *GeneratedAuthMethods) SignOut(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return w.Core.AuthSignout(ctx, body)
}

// SignInAnonymously — Sign in anonymously
func (w *GeneratedAuthMethods) SignInAnonymously(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return w.Core.AuthSigninAnonymous(ctx, body)
}

// SignInWithMagicLink — Send magic link to email
func (w *GeneratedAuthMethods) SignInWithMagicLink(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return w.Core.AuthSigninMagicLink(ctx, body)
}

// VerifyMagicLink — Verify magic link token
func (w *GeneratedAuthMethods) VerifyMagicLink(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return w.Core.AuthVerifyMagicLink(ctx, body)
}

// SignInWithPhone — Send OTP SMS to phone number
func (w *GeneratedAuthMethods) SignInWithPhone(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return w.Core.AuthSigninPhone(ctx, body)
}

// VerifyPhone — Verify phone OTP and create session
func (w *GeneratedAuthMethods) VerifyPhone(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return w.Core.AuthVerifyPhone(ctx, body)
}

// SignInWithEmailOtp — Send OTP code to email
func (w *GeneratedAuthMethods) SignInWithEmailOtp(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return w.Core.AuthSigninEmailOtp(ctx, body)
}

// VerifyEmailOtp — Verify email OTP and create session
func (w *GeneratedAuthMethods) VerifyEmailOtp(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return w.Core.AuthVerifyEmailOtp(ctx, body)
}

// LinkWithPhone — Link phone number to existing account
func (w *GeneratedAuthMethods) LinkWithPhone(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return w.Core.AuthLinkPhone(ctx, body)
}

// VerifyLinkPhone — Verify OTP and link phone to account
func (w *GeneratedAuthMethods) VerifyLinkPhone(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return w.Core.AuthVerifyLinkPhone(ctx, body)
}

// LinkWithEmail — Link email and password to existing account
func (w *GeneratedAuthMethods) LinkWithEmail(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return w.Core.AuthLinkEmail(ctx, body)
}

// ChangeEmail — Request email change with password confirmation
func (w *GeneratedAuthMethods) ChangeEmail(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return w.Core.AuthChangeEmail(ctx, body)
}

// VerifyEmailChange — Verify email change token
func (w *GeneratedAuthMethods) VerifyEmailChange(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return w.Core.AuthVerifyEmailChange(ctx, body)
}

// VerifyEmail — Verify email address with token
func (w *GeneratedAuthMethods) VerifyEmail(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return w.Core.AuthVerifyEmail(ctx, body)
}

// RequestPasswordReset — Request password reset email
func (w *GeneratedAuthMethods) RequestPasswordReset(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return w.Core.AuthRequestPasswordReset(ctx, body)
}

// ResetPassword — Reset password with token
func (w *GeneratedAuthMethods) ResetPassword(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return w.Core.AuthResetPassword(ctx, body)
}

// ChangePassword — Change password for authenticated user
func (w *GeneratedAuthMethods) ChangePassword(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return w.Core.AuthChangePassword(ctx, body)
}

// GetMe — Get current authenticated user info
func (w *GeneratedAuthMethods) GetMe(ctx context.Context) (map[string]interface{}, error) {
	return w.Core.AuthGetMe(ctx)
}

// UpdateProfile — Update user profile
func (w *GeneratedAuthMethods) UpdateProfile(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return w.Core.AuthUpdateProfile(ctx, body)
}

// ListSessions — List active sessions
func (w *GeneratedAuthMethods) ListSessions(ctx context.Context) (map[string]interface{}, error) {
	return w.Core.AuthGetSessions(ctx)
}

// RevokeSession — Delete a session
func (w *GeneratedAuthMethods) RevokeSession(ctx context.Context, id string) (map[string]interface{}, error) {
	return w.Core.AuthDeleteSession(ctx, id)
}

// EnrollTotp — Enroll new TOTP factor
func (w *GeneratedAuthMethods) EnrollTotp(ctx context.Context) (map[string]interface{}, error) {
	return w.Core.AuthMfaTotpEnroll(ctx)
}

// VerifyTotpEnrollment — Confirm TOTP enrollment with code
func (w *GeneratedAuthMethods) VerifyTotpEnrollment(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return w.Core.AuthMfaTotpVerify(ctx, body)
}

// VerifyTotp — Verify MFA code during signin
func (w *GeneratedAuthMethods) VerifyTotp(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return w.Core.AuthMfaVerify(ctx, body)
}

// UseRecoveryCode — Use recovery code during MFA signin
func (w *GeneratedAuthMethods) UseRecoveryCode(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return w.Core.AuthMfaRecovery(ctx, body)
}

// DisableTotp — Disable TOTP factor
func (w *GeneratedAuthMethods) DisableTotp(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return w.Core.AuthMfaTotpDelete(ctx, body)
}

// ListFactors — List MFA factors for authenticated user
func (w *GeneratedAuthMethods) ListFactors(ctx context.Context) (map[string]interface{}, error) {
	return w.Core.AuthMfaFactors(ctx)
}

// PasskeysRegisterOptions — Generate passkey registration options
func (w *GeneratedAuthMethods) PasskeysRegisterOptions(ctx context.Context) (map[string]interface{}, error) {
	return w.Core.AuthPasskeysRegisterOptions(ctx)
}

// PasskeysRegister — Verify and store passkey registration
func (w *GeneratedAuthMethods) PasskeysRegister(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return w.Core.AuthPasskeysRegister(ctx, body)
}

// PasskeysAuthOptions — Generate passkey authentication options
func (w *GeneratedAuthMethods) PasskeysAuthOptions(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return w.Core.AuthPasskeysAuthOptions(ctx, body)
}

// PasskeysAuthenticate — Authenticate with passkey
func (w *GeneratedAuthMethods) PasskeysAuthenticate(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return w.Core.AuthPasskeysAuthenticate(ctx, body)
}

// PasskeysList — List passkeys for authenticated user
func (w *GeneratedAuthMethods) PasskeysList(ctx context.Context) (map[string]interface{}, error) {
	return w.Core.AuthPasskeysList(ctx)
}

// PasskeysDelete — Delete a passkey
func (w *GeneratedAuthMethods) PasskeysDelete(ctx context.Context, credentialId string) (map[string]interface{}, error) {
	return w.Core.AuthPasskeysDelete(ctx, credentialId)
}

// GeneratedStorageMethods — Storage wrapper methods (bucket-scoped)
type GeneratedStorageMethods struct {
	Core *GeneratedDbApi
}

// Delete — Delete file
func (w *GeneratedStorageMethods) Delete(ctx context.Context, bucket string, key string) (map[string]interface{}, error) {
	return w.Core.DeleteFile(ctx, bucket, key)
}

// DeleteMany — Batch delete files
func (w *GeneratedStorageMethods) DeleteMany(ctx context.Context, bucket string, body interface{}) (map[string]interface{}, error) {
	return w.Core.DeleteBatch(ctx, bucket, body)
}

// Exists — Check if file exists
func (w *GeneratedStorageMethods) Exists(ctx context.Context, bucket string, key string) (bool, error) {
	return w.Core.CheckFileExists(ctx, bucket, key)
}

// GetMetadata — Get file metadata
func (w *GeneratedStorageMethods) GetMetadata(ctx context.Context, bucket string, key string) (map[string]interface{}, error) {
	return w.Core.GetFileMetadata(ctx, bucket, key)
}

// UpdateMetadata — Update file metadata
func (w *GeneratedStorageMethods) UpdateMetadata(ctx context.Context, bucket string, key string, body interface{}) (map[string]interface{}, error) {
	return w.Core.UpdateFileMetadata(ctx, bucket, key, body)
}

// CreateSignedUrl — Create signed download URL
func (w *GeneratedStorageMethods) CreateSignedUrl(ctx context.Context, bucket string, body interface{}) (map[string]interface{}, error) {
	return w.Core.CreateSignedDownloadUrl(ctx, bucket, body)
}

// CreateSignedUrls — Batch create signed download URLs
func (w *GeneratedStorageMethods) CreateSignedUrls(ctx context.Context, bucket string, body interface{}) (map[string]interface{}, error) {
	return w.Core.CreateSignedDownloadUrls(ctx, bucket, body)
}

// CreateSignedUploadUrl — Create signed upload URL
func (w *GeneratedStorageMethods) CreateSignedUploadUrl(ctx context.Context, bucket string, body interface{}) (map[string]interface{}, error) {
	return w.Core.CreateSignedUploadUrl(ctx, bucket, body)
}

// CreateMultipartUpload — Start multipart upload
func (w *GeneratedStorageMethods) CreateMultipartUpload(ctx context.Context, bucket string, body interface{}) (map[string]interface{}, error) {
	return w.Core.CreateMultipartUpload(ctx, bucket, body)
}

// CompleteMultipartUpload — Complete multipart upload
func (w *GeneratedStorageMethods) CompleteMultipartUpload(ctx context.Context, bucket string, body interface{}) (map[string]interface{}, error) {
	return w.Core.CompleteMultipartUpload(ctx, bucket, body)
}

// AbortMultipartUpload — Abort multipart upload
func (w *GeneratedStorageMethods) AbortMultipartUpload(ctx context.Context, bucket string, body interface{}) (map[string]interface{}, error) {
	return w.Core.AbortMultipartUpload(ctx, bucket, body)
}

// GeneratedAnalyticsMethods — Analytics wrapper methods
type GeneratedAnalyticsMethods struct {
	Core *GeneratedDbApi
}

// Track — Track custom events
func (w *GeneratedAnalyticsMethods) Track(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return w.Core.TrackEvents(ctx, body)
}
