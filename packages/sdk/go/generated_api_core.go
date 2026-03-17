// Auto-generated core API Core — DO NOT EDIT.
// Regenerate: npx tsx tools/sdk-codegen/generate.ts
// Source: openapi.json (0.1.0)

package edgebase

import (
	"context"
	"fmt"
	"net/url"
)

// GeneratedDbApi contains auto-generated API methods.
type GeneratedDbApi struct {
	client *HTTPClient
}

// NewGeneratedDbApi creates a new instance.
func NewGeneratedDbApi(client *HTTPClient) *GeneratedDbApi {
	return &GeneratedDbApi{client: client}
}

// GetHealth — Health check — GET /api/health
func (a *GeneratedDbApi) GetHealth(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Get(ctx, "/api/health")
}

// AuthSignup — Sign up with email and password — POST /api/auth/signup
func (a *GeneratedDbApi) AuthSignup(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/auth/signup", body)
}

// AuthSignin — Sign in with email and password — POST /api/auth/signin
func (a *GeneratedDbApi) AuthSignin(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/auth/signin", body)
}

// AuthSigninAnonymous — Sign in anonymously — POST /api/auth/signin/anonymous
func (a *GeneratedDbApi) AuthSigninAnonymous(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/auth/signin/anonymous", body)
}

// AuthSigninMagicLink — Send magic link to email — POST /api/auth/signin/magic-link
func (a *GeneratedDbApi) AuthSigninMagicLink(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/auth/signin/magic-link", body)
}

// AuthVerifyMagicLink — Verify magic link token — POST /api/auth/verify-magic-link
func (a *GeneratedDbApi) AuthVerifyMagicLink(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/auth/verify-magic-link", body)
}

// AuthSigninPhone — Send OTP SMS to phone number — POST /api/auth/signin/phone
func (a *GeneratedDbApi) AuthSigninPhone(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/auth/signin/phone", body)
}

// AuthVerifyPhone — Verify phone OTP and create session — POST /api/auth/verify-phone
func (a *GeneratedDbApi) AuthVerifyPhone(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/auth/verify-phone", body)
}

// AuthLinkPhone — Link phone number to existing account — POST /api/auth/link/phone
func (a *GeneratedDbApi) AuthLinkPhone(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/auth/link/phone", body)
}

// AuthVerifyLinkPhone — Verify OTP and link phone to account — POST /api/auth/verify-link-phone
func (a *GeneratedDbApi) AuthVerifyLinkPhone(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/auth/verify-link-phone", body)
}

// AuthSigninEmailOtp — Send OTP code to email — POST /api/auth/signin/email-otp
func (a *GeneratedDbApi) AuthSigninEmailOtp(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/auth/signin/email-otp", body)
}

// AuthVerifyEmailOtp — Verify email OTP and create session — POST /api/auth/verify-email-otp
func (a *GeneratedDbApi) AuthVerifyEmailOtp(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/auth/verify-email-otp", body)
}

// AuthMfaTotpEnroll — Enroll new TOTP factor — POST /api/auth/mfa/totp/enroll
func (a *GeneratedDbApi) AuthMfaTotpEnroll(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Post(ctx, "/api/auth/mfa/totp/enroll", nil)
}

// AuthMfaTotpVerify — Confirm TOTP enrollment with code — POST /api/auth/mfa/totp/verify
func (a *GeneratedDbApi) AuthMfaTotpVerify(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/auth/mfa/totp/verify", body)
}

// AuthMfaVerify — Verify MFA code during signin — POST /api/auth/mfa/verify
func (a *GeneratedDbApi) AuthMfaVerify(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/auth/mfa/verify", body)
}

// AuthMfaRecovery — Use recovery code during MFA signin — POST /api/auth/mfa/recovery
func (a *GeneratedDbApi) AuthMfaRecovery(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/auth/mfa/recovery", body)
}

// AuthMfaTotpDelete — Disable TOTP factor — DELETE /api/auth/mfa/totp
func (a *GeneratedDbApi) AuthMfaTotpDelete(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "DELETE", "/api/auth/mfa/totp", body)
}

// AuthMfaFactors — List MFA factors for authenticated user — GET /api/auth/mfa/factors
func (a *GeneratedDbApi) AuthMfaFactors(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Get(ctx, "/api/auth/mfa/factors")
}

// AuthRefresh — Refresh access token — POST /api/auth/refresh
func (a *GeneratedDbApi) AuthRefresh(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/auth/refresh", body)
}

// AuthSignout — Sign out and revoke refresh token — POST /api/auth/signout
func (a *GeneratedDbApi) AuthSignout(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/auth/signout", body)
}

// AuthChangePassword — Change password for authenticated user — POST /api/auth/change-password
func (a *GeneratedDbApi) AuthChangePassword(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/auth/change-password", body)
}

// AuthChangeEmail — Request email change with password confirmation — POST /api/auth/change-email
func (a *GeneratedDbApi) AuthChangeEmail(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/auth/change-email", body)
}

// AuthVerifyEmailChange — Verify email change token — POST /api/auth/verify-email-change
func (a *GeneratedDbApi) AuthVerifyEmailChange(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/auth/verify-email-change", body)
}

// AuthPasskeysRegisterOptions — Generate passkey registration options — POST /api/auth/passkeys/register-options
func (a *GeneratedDbApi) AuthPasskeysRegisterOptions(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Post(ctx, "/api/auth/passkeys/register-options", nil)
}

// AuthPasskeysRegister — Verify and store passkey registration — POST /api/auth/passkeys/register
func (a *GeneratedDbApi) AuthPasskeysRegister(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/auth/passkeys/register", body)
}

// AuthPasskeysAuthOptions — Generate passkey authentication options — POST /api/auth/passkeys/auth-options
func (a *GeneratedDbApi) AuthPasskeysAuthOptions(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/auth/passkeys/auth-options", body)
}

// AuthPasskeysAuthenticate — Authenticate with passkey — POST /api/auth/passkeys/authenticate
func (a *GeneratedDbApi) AuthPasskeysAuthenticate(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/auth/passkeys/authenticate", body)
}

// AuthPasskeysList — List passkeys for authenticated user — GET /api/auth/passkeys
func (a *GeneratedDbApi) AuthPasskeysList(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Get(ctx, "/api/auth/passkeys")
}

// AuthPasskeysDelete — Delete a passkey — DELETE /api/auth/passkeys/{credentialId}
func (a *GeneratedDbApi) AuthPasskeysDelete(ctx context.Context, credentialId string) (map[string]interface{}, error) {
	return a.client.Delete(ctx, fmt.Sprintf("/api/auth/passkeys/%s", url.PathEscape(credentialId)))
}

// AuthGetMe — Get current authenticated user info — GET /api/auth/me
func (a *GeneratedDbApi) AuthGetMe(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Get(ctx, "/api/auth/me")
}

// AuthUpdateProfile — Update user profile — PATCH /api/auth/profile
func (a *GeneratedDbApi) AuthUpdateProfile(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "PATCH", "/api/auth/profile", body)
}

// AuthGetSessions — List active sessions — GET /api/auth/sessions
func (a *GeneratedDbApi) AuthGetSessions(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Get(ctx, "/api/auth/sessions")
}

// AuthDeleteSession — Delete a session — DELETE /api/auth/sessions/{id}
func (a *GeneratedDbApi) AuthDeleteSession(ctx context.Context, id string) (map[string]interface{}, error) {
	return a.client.Delete(ctx, fmt.Sprintf("/api/auth/sessions/%s", url.PathEscape(id)))
}

// AuthGetIdentities — List linked sign-in identities for the current user — GET /api/auth/identities
func (a *GeneratedDbApi) AuthGetIdentities(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Get(ctx, "/api/auth/identities")
}

// AuthDeleteIdentity — Unlink a linked sign-in identity — DELETE /api/auth/identities/{identityId}
func (a *GeneratedDbApi) AuthDeleteIdentity(ctx context.Context, identityId string) (map[string]interface{}, error) {
	return a.client.Delete(ctx, fmt.Sprintf("/api/auth/identities/%s", url.PathEscape(identityId)))
}

// AuthLinkEmail — Link email and password to existing account — POST /api/auth/link/email
func (a *GeneratedDbApi) AuthLinkEmail(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/auth/link/email", body)
}

// AuthRequestEmailVerification — Send a verification email to the current authenticated user — POST /api/auth/request-email-verification
func (a *GeneratedDbApi) AuthRequestEmailVerification(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/auth/request-email-verification", body)
}

// AuthVerifyEmail — Verify email address with token — POST /api/auth/verify-email
func (a *GeneratedDbApi) AuthVerifyEmail(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/auth/verify-email", body)
}

// AuthRequestPasswordReset — Request password reset email — POST /api/auth/request-password-reset
func (a *GeneratedDbApi) AuthRequestPasswordReset(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/auth/request-password-reset", body)
}

// AuthResetPassword — Reset password with token — POST /api/auth/reset-password
func (a *GeneratedDbApi) AuthResetPassword(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/auth/reset-password", body)
}

// OauthRedirect — Start OAuth redirect — GET /api/auth/oauth/{provider}
func (a *GeneratedDbApi) OauthRedirect(ctx context.Context, provider string) (map[string]interface{}, error) {
	return a.client.Get(ctx, fmt.Sprintf("/api/auth/oauth/%s", url.PathEscape(provider)))
}

// OauthCallback — OAuth callback — GET /api/auth/oauth/{provider}/callback
func (a *GeneratedDbApi) OauthCallback(ctx context.Context, provider string) (map[string]interface{}, error) {
	return a.client.Get(ctx, fmt.Sprintf("/api/auth/oauth/%s/callback", url.PathEscape(provider)))
}

// OauthLinkStart — Start OAuth account linking — POST /api/auth/oauth/link/{provider}
func (a *GeneratedDbApi) OauthLinkStart(ctx context.Context, provider string) (map[string]interface{}, error) {
	return a.client.Post(ctx, fmt.Sprintf("/api/auth/oauth/link/%s", url.PathEscape(provider)), nil)
}

// OauthLinkCallback — OAuth link callback — GET /api/auth/oauth/link/{provider}/callback
func (a *GeneratedDbApi) OauthLinkCallback(ctx context.Context, provider string) (map[string]interface{}, error) {
	return a.client.Get(ctx, fmt.Sprintf("/api/auth/oauth/link/%s/callback", url.PathEscape(provider)))
}

// DbCountRecords — Count records in dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/count
func (a *GeneratedDbApi) DbCountRecords(ctx context.Context, namespace string, instanceId string, table string, query map[string]string) (map[string]interface{}, error) {
	return a.client.GetWithQuery(ctx, fmt.Sprintf("/api/db/%s/%s/tables/%s/count", url.PathEscape(namespace), url.PathEscape(instanceId), url.PathEscape(table)), query)
}

// DbSearchRecords — Search records in dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/search
func (a *GeneratedDbApi) DbSearchRecords(ctx context.Context, namespace string, instanceId string, table string, query map[string]string) (map[string]interface{}, error) {
	return a.client.GetWithQuery(ctx, fmt.Sprintf("/api/db/%s/%s/tables/%s/search", url.PathEscape(namespace), url.PathEscape(instanceId), url.PathEscape(table)), query)
}

// DbGetRecord — Get single record from dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/{id}
func (a *GeneratedDbApi) DbGetRecord(ctx context.Context, namespace string, instanceId string, table string, id string, query map[string]string) (map[string]interface{}, error) {
	return a.client.GetWithQuery(ctx, fmt.Sprintf("/api/db/%s/%s/tables/%s/%s", url.PathEscape(namespace), url.PathEscape(instanceId), url.PathEscape(table), url.PathEscape(id)), query)
}

// DbUpdateRecord — Update record in dynamic table — PATCH /api/db/{namespace}/{instanceId}/tables/{table}/{id}
func (a *GeneratedDbApi) DbUpdateRecord(ctx context.Context, namespace string, instanceId string, table string, id string, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "PATCH", fmt.Sprintf("/api/db/%s/%s/tables/%s/%s", url.PathEscape(namespace), url.PathEscape(instanceId), url.PathEscape(table), url.PathEscape(id)), body)
}

// DbDeleteRecord — Delete record from dynamic table — DELETE /api/db/{namespace}/{instanceId}/tables/{table}/{id}
func (a *GeneratedDbApi) DbDeleteRecord(ctx context.Context, namespace string, instanceId string, table string, id string) (map[string]interface{}, error) {
	return a.client.Delete(ctx, fmt.Sprintf("/api/db/%s/%s/tables/%s/%s", url.PathEscape(namespace), url.PathEscape(instanceId), url.PathEscape(table), url.PathEscape(id)))
}

// DbListRecords — List records from dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}
func (a *GeneratedDbApi) DbListRecords(ctx context.Context, namespace string, instanceId string, table string, query map[string]string) (map[string]interface{}, error) {
	return a.client.GetWithQuery(ctx, fmt.Sprintf("/api/db/%s/%s/tables/%s", url.PathEscape(namespace), url.PathEscape(instanceId), url.PathEscape(table)), query)
}

// DbInsertRecord — Insert record into dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table}
func (a *GeneratedDbApi) DbInsertRecord(ctx context.Context, namespace string, instanceId string, table string, body interface{}, query map[string]string) (map[string]interface{}, error) {
	return a.client.DoWithQuery(ctx, "POST", fmt.Sprintf("/api/db/%s/%s/tables/%s", url.PathEscape(namespace), url.PathEscape(instanceId), url.PathEscape(table)), body, query)
}

// DbBatchRecords — Batch insert records into dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table}/batch
func (a *GeneratedDbApi) DbBatchRecords(ctx context.Context, namespace string, instanceId string, table string, body interface{}, query map[string]string) (map[string]interface{}, error) {
	return a.client.DoWithQuery(ctx, "POST", fmt.Sprintf("/api/db/%s/%s/tables/%s/batch", url.PathEscape(namespace), url.PathEscape(instanceId), url.PathEscape(table)), body, query)
}

// DbBatchByFilter — Batch update/delete records by filter in dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table}/batch-by-filter
func (a *GeneratedDbApi) DbBatchByFilter(ctx context.Context, namespace string, instanceId string, table string, body interface{}, query map[string]string) (map[string]interface{}, error) {
	return a.client.DoWithQuery(ctx, "POST", fmt.Sprintf("/api/db/%s/%s/tables/%s/batch-by-filter", url.PathEscape(namespace), url.PathEscape(instanceId), url.PathEscape(table)), body, query)
}

// CheckDatabaseSubscriptionConnection — Check database live subscription WebSocket prerequisites — GET /api/db/connect-check
func (a *GeneratedDbApi) CheckDatabaseSubscriptionConnection(ctx context.Context, query map[string]string) (map[string]interface{}, error) {
	return a.client.GetWithQuery(ctx, "/api/db/connect-check", query)
}

// ConnectDatabaseSubscription — Connect to database live subscriptions WebSocket — GET /api/db/subscribe
func (a *GeneratedDbApi) ConnectDatabaseSubscription(ctx context.Context, query map[string]string) (map[string]interface{}, error) {
	return a.client.GetWithQuery(ctx, "/api/db/subscribe", query)
}

// GetSchema — Get table schema — GET /api/schema
func (a *GeneratedDbApi) GetSchema(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Get(ctx, "/api/schema")
}

// UploadFile — Upload file — POST /api/storage/{bucket}/upload
func (a *GeneratedDbApi) UploadFile(ctx context.Context, bucket string, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", fmt.Sprintf("/api/storage/%s/upload", url.PathEscape(bucket)), body)
}

// GetFileMetadata — Get file metadata — GET /api/storage/{bucket}/{key}/metadata
func (a *GeneratedDbApi) GetFileMetadata(ctx context.Context, bucket string, key string) (map[string]interface{}, error) {
	return a.client.Get(ctx, fmt.Sprintf("/api/storage/%s/%s/metadata", url.PathEscape(bucket), url.PathEscape(key)))
}

// UpdateFileMetadata — Update file metadata — PATCH /api/storage/{bucket}/{key}/metadata
func (a *GeneratedDbApi) UpdateFileMetadata(ctx context.Context, bucket string, key string, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "PATCH", fmt.Sprintf("/api/storage/%s/%s/metadata", url.PathEscape(bucket), url.PathEscape(key)), body)
}

// CheckFileExists — Check if file exists — HEAD /api/storage/{bucket}/{key}
func (a *GeneratedDbApi) CheckFileExists(ctx context.Context, bucket string, key string) (bool, error) {
	return a.client.Head(ctx, fmt.Sprintf("/api/storage/%s/%s", url.PathEscape(bucket), url.PathEscape(key)))
}

// DownloadFile — Download file — GET /api/storage/{bucket}/{key}
func (a *GeneratedDbApi) DownloadFile(ctx context.Context, bucket string, key string) (map[string]interface{}, error) {
	return a.client.Get(ctx, fmt.Sprintf("/api/storage/%s/%s", url.PathEscape(bucket), url.PathEscape(key)))
}

// DeleteFile — Delete file — DELETE /api/storage/{bucket}/{key}
func (a *GeneratedDbApi) DeleteFile(ctx context.Context, bucket string, key string) (map[string]interface{}, error) {
	return a.client.Delete(ctx, fmt.Sprintf("/api/storage/%s/%s", url.PathEscape(bucket), url.PathEscape(key)))
}

// GetUploadParts — Get uploaded parts — GET /api/storage/{bucket}/uploads/{uploadId}/parts
func (a *GeneratedDbApi) GetUploadParts(ctx context.Context, bucket string, uploadId string, query map[string]string) (map[string]interface{}, error) {
	return a.client.GetWithQuery(ctx, fmt.Sprintf("/api/storage/%s/uploads/%s/parts", url.PathEscape(bucket), url.PathEscape(uploadId)), query)
}

// ListFiles — List files in bucket — GET /api/storage/{bucket}
func (a *GeneratedDbApi) ListFiles(ctx context.Context, bucket string) (map[string]interface{}, error) {
	return a.client.Get(ctx, fmt.Sprintf("/api/storage/%s", url.PathEscape(bucket)))
}

// DeleteBatch — Batch delete files — POST /api/storage/{bucket}/delete-batch
func (a *GeneratedDbApi) DeleteBatch(ctx context.Context, bucket string, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", fmt.Sprintf("/api/storage/%s/delete-batch", url.PathEscape(bucket)), body)
}

// CreateSignedDownloadUrl — Create signed download URL — POST /api/storage/{bucket}/signed-url
func (a *GeneratedDbApi) CreateSignedDownloadUrl(ctx context.Context, bucket string, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", fmt.Sprintf("/api/storage/%s/signed-url", url.PathEscape(bucket)), body)
}

// CreateSignedDownloadUrls — Batch create signed download URLs — POST /api/storage/{bucket}/signed-urls
func (a *GeneratedDbApi) CreateSignedDownloadUrls(ctx context.Context, bucket string, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", fmt.Sprintf("/api/storage/%s/signed-urls", url.PathEscape(bucket)), body)
}

// CreateSignedUploadUrl — Create signed upload URL — POST /api/storage/{bucket}/signed-upload-url
func (a *GeneratedDbApi) CreateSignedUploadUrl(ctx context.Context, bucket string, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", fmt.Sprintf("/api/storage/%s/signed-upload-url", url.PathEscape(bucket)), body)
}

// CreateMultipartUpload — Start multipart upload — POST /api/storage/{bucket}/multipart/create
func (a *GeneratedDbApi) CreateMultipartUpload(ctx context.Context, bucket string, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", fmt.Sprintf("/api/storage/%s/multipart/create", url.PathEscape(bucket)), body)
}

// UploadPart — Upload a part — POST /api/storage/{bucket}/multipart/upload-part
func (a *GeneratedDbApi) UploadPart(ctx context.Context, bucket string, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", fmt.Sprintf("/api/storage/%s/multipart/upload-part", url.PathEscape(bucket)), body)
}

// CompleteMultipartUpload — Complete multipart upload — POST /api/storage/{bucket}/multipart/complete
func (a *GeneratedDbApi) CompleteMultipartUpload(ctx context.Context, bucket string, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", fmt.Sprintf("/api/storage/%s/multipart/complete", url.PathEscape(bucket)), body)
}

// AbortMultipartUpload — Abort multipart upload — POST /api/storage/{bucket}/multipart/abort
func (a *GeneratedDbApi) AbortMultipartUpload(ctx context.Context, bucket string, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", fmt.Sprintf("/api/storage/%s/multipart/abort", url.PathEscape(bucket)), body)
}

// GetConfig — Get public configuration — GET /api/config
func (a *GeneratedDbApi) GetConfig(ctx context.Context) (map[string]interface{}, error) {
	return a.client.Get(ctx, "/api/config")
}

// PushRegister — Register push token — POST /api/push/register
func (a *GeneratedDbApi) PushRegister(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/push/register", body)
}

// PushUnregister — Unregister push token — POST /api/push/unregister
func (a *GeneratedDbApi) PushUnregister(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/push/unregister", body)
}

// PushTopicSubscribe — Subscribe token to topic — POST /api/push/topic/subscribe
func (a *GeneratedDbApi) PushTopicSubscribe(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/push/topic/subscribe", body)
}

// PushTopicUnsubscribe — Unsubscribe token from topic — POST /api/push/topic/unsubscribe
func (a *GeneratedDbApi) PushTopicUnsubscribe(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/push/topic/unsubscribe", body)
}

// CheckRoomConnection — Check room WebSocket connection prerequisites — GET /api/room/connect-check
func (a *GeneratedDbApi) CheckRoomConnection(ctx context.Context, query map[string]string) (map[string]interface{}, error) {
	return a.client.GetWithQuery(ctx, "/api/room/connect-check", query)
}

// ConnectRoom — Connect to room WebSocket — GET /api/room
func (a *GeneratedDbApi) ConnectRoom(ctx context.Context, query map[string]string) (map[string]interface{}, error) {
	return a.client.GetWithQuery(ctx, "/api/room", query)
}

// GetRoomMetadata — Get room metadata — GET /api/room/metadata
func (a *GeneratedDbApi) GetRoomMetadata(ctx context.Context, query map[string]string) (map[string]interface{}, error) {
	return a.client.GetWithQuery(ctx, "/api/room/metadata", query)
}

// GetRoomRealtimeSession — Get the active room realtime media session — GET /api/room/media/realtime/session
func (a *GeneratedDbApi) GetRoomRealtimeSession(ctx context.Context, query map[string]string) (map[string]interface{}, error) {
	return a.client.GetWithQuery(ctx, "/api/room/media/realtime/session", query)
}

// CreateRoomRealtimeSession — Create a room realtime media session — POST /api/room/media/realtime/session
func (a *GeneratedDbApi) CreateRoomRealtimeSession(ctx context.Context, body interface{}, query map[string]string) (map[string]interface{}, error) {
	return a.client.DoWithQuery(ctx, "POST", "/api/room/media/realtime/session", body, query)
}

// CreateRoomRealtimeIceServers — Generate TURN / ICE credentials for room realtime media — POST /api/room/media/realtime/turn
func (a *GeneratedDbApi) CreateRoomRealtimeIceServers(ctx context.Context, body interface{}, query map[string]string) (map[string]interface{}, error) {
	return a.client.DoWithQuery(ctx, "POST", "/api/room/media/realtime/turn", body, query)
}

// AddRoomRealtimeTracks — Add realtime media tracks to a room session — POST /api/room/media/realtime/tracks/new
func (a *GeneratedDbApi) AddRoomRealtimeTracks(ctx context.Context, body interface{}, query map[string]string) (map[string]interface{}, error) {
	return a.client.DoWithQuery(ctx, "POST", "/api/room/media/realtime/tracks/new", body, query)
}

// RenegotiateRoomRealtimeSession — Renegotiate a room realtime media session — PUT /api/room/media/realtime/renegotiate
func (a *GeneratedDbApi) RenegotiateRoomRealtimeSession(ctx context.Context, body interface{}, query map[string]string) (map[string]interface{}, error) {
	return a.client.DoWithQuery(ctx, "PUT", "/api/room/media/realtime/renegotiate", body, query)
}

// CloseRoomRealtimeTracks — Close room realtime media tracks — PUT /api/room/media/realtime/tracks/close
func (a *GeneratedDbApi) CloseRoomRealtimeTracks(ctx context.Context, body interface{}, query map[string]string) (map[string]interface{}, error) {
	return a.client.DoWithQuery(ctx, "PUT", "/api/room/media/realtime/tracks/close", body, query)
}

// TrackEvents — Track custom events — POST /api/analytics/track
func (a *GeneratedDbApi) TrackEvents(ctx context.Context, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "POST", "/api/analytics/track", body)
}

// DbSingleCountRecords — Count records in a single-instance table — GET /api/db/{namespace}/tables/{table}/count
func (a *GeneratedDbApi) DbSingleCountRecords(ctx context.Context, namespace string, table string, query map[string]string) (map[string]interface{}, error) {
	return a.client.GetWithQuery(ctx, fmt.Sprintf("/api/db/%s/tables/%s/count", url.PathEscape(namespace), url.PathEscape(table)), query)
}

// DbSingleSearchRecords — Search records in a single-instance table — GET /api/db/{namespace}/tables/{table}/search
func (a *GeneratedDbApi) DbSingleSearchRecords(ctx context.Context, namespace string, table string, query map[string]string) (map[string]interface{}, error) {
	return a.client.GetWithQuery(ctx, fmt.Sprintf("/api/db/%s/tables/%s/search", url.PathEscape(namespace), url.PathEscape(table)), query)
}

// DbSingleGetRecord — Get a single record from a single-instance table — GET /api/db/{namespace}/tables/{table}/{id}
func (a *GeneratedDbApi) DbSingleGetRecord(ctx context.Context, namespace string, table string, id string, query map[string]string) (map[string]interface{}, error) {
	return a.client.GetWithQuery(ctx, fmt.Sprintf("/api/db/%s/tables/%s/%s", url.PathEscape(namespace), url.PathEscape(table), url.PathEscape(id)), query)
}

// DbSingleUpdateRecord — Update a record in a single-instance table — PATCH /api/db/{namespace}/tables/{table}/{id}
func (a *GeneratedDbApi) DbSingleUpdateRecord(ctx context.Context, namespace string, table string, id string, body interface{}) (map[string]interface{}, error) {
	return a.client.do(ctx, "PATCH", fmt.Sprintf("/api/db/%s/tables/%s/%s", url.PathEscape(namespace), url.PathEscape(table), url.PathEscape(id)), body)
}

// DbSingleDeleteRecord — Delete a record from a single-instance table — DELETE /api/db/{namespace}/tables/{table}/{id}
func (a *GeneratedDbApi) DbSingleDeleteRecord(ctx context.Context, namespace string, table string, id string) (map[string]interface{}, error) {
	return a.client.Delete(ctx, fmt.Sprintf("/api/db/%s/tables/%s/%s", url.PathEscape(namespace), url.PathEscape(table), url.PathEscape(id)))
}

// DbSingleListRecords — List records from a single-instance table — GET /api/db/{namespace}/tables/{table}
func (a *GeneratedDbApi) DbSingleListRecords(ctx context.Context, namespace string, table string, query map[string]string) (map[string]interface{}, error) {
	return a.client.GetWithQuery(ctx, fmt.Sprintf("/api/db/%s/tables/%s", url.PathEscape(namespace), url.PathEscape(table)), query)
}

// DbSingleInsertRecord — Insert a record into a single-instance table — POST /api/db/{namespace}/tables/{table}
func (a *GeneratedDbApi) DbSingleInsertRecord(ctx context.Context, namespace string, table string, body interface{}, query map[string]string) (map[string]interface{}, error) {
	return a.client.DoWithQuery(ctx, "POST", fmt.Sprintf("/api/db/%s/tables/%s", url.PathEscape(namespace), url.PathEscape(table)), body, query)
}

// DbSingleBatchRecords — Batch insert records into a single-instance table — POST /api/db/{namespace}/tables/{table}/batch
func (a *GeneratedDbApi) DbSingleBatchRecords(ctx context.Context, namespace string, table string, body interface{}, query map[string]string) (map[string]interface{}, error) {
	return a.client.DoWithQuery(ctx, "POST", fmt.Sprintf("/api/db/%s/tables/%s/batch", url.PathEscape(namespace), url.PathEscape(table)), body, query)
}

// DbSingleBatchByFilter — Batch update/delete records by filter in a single-instance table — POST /api/db/{namespace}/tables/{table}/batch-by-filter
func (a *GeneratedDbApi) DbSingleBatchByFilter(ctx context.Context, namespace string, table string, body interface{}, query map[string]string) (map[string]interface{}, error) {
	return a.client.DoWithQuery(ctx, "POST", fmt.Sprintf("/api/db/%s/tables/%s/batch-by-filter", url.PathEscape(namespace), url.PathEscape(table)), body, query)
}

// ─── Path Constants ────────────────────────────────────────────────────────

const (
	PathAdminLogin = "/admin/api/auth/login"
	PathAdminRefresh = "/admin/api/auth/refresh"
	PathBackupCleanupPlugin = "/admin/api/backup/cleanup-plugin"
	PathBackupGetConfig = "/admin/api/backup/config"
	PathBackupDumpControlD1 = "/admin/api/backup/dump-control-d1"
	PathBackupDumpD1 = "/admin/api/backup/dump-d1"
	PathBackupDumpData = "/admin/api/backup/dump-data"
	PathBackupDumpDO = "/admin/api/backup/dump-do"
	PathBackupDumpStorage = "/admin/api/backup/dump-storage"
	PathBackupListDOs = "/admin/api/backup/list-dos"
	PathBackupRestoreControlD1 = "/admin/api/backup/restore-control-d1"
	PathBackupRestoreD1 = "/admin/api/backup/restore-d1"
	PathBackupRestoreData = "/admin/api/backup/restore-data"
	PathBackupRestoreDO = "/admin/api/backup/restore-do"
	PathBackupRestoreStorage = "/admin/api/backup/restore-storage"
	PathBackupResyncUsersPublic = "/admin/api/backup/resync-users-public"
	PathBackupWipeDO = "/admin/api/backup/wipe-do"
	PathAdminListAdmins = "/admin/api/data/admins"
	PathAdminCreateAdmin = "/admin/api/data/admins"
	PathAdminGetAnalytics = "/admin/api/data/analytics"
	PathAdminGetAnalyticsEvents = "/admin/api/data/analytics/events"
	PathAdminGetAuthSettings = "/admin/api/data/auth/settings"
	PathAdminBackupGetConfig = "/admin/api/data/backup/config"
	PathAdminBackupDumpD1 = "/admin/api/data/backup/dump-d1"
	PathAdminBackupDumpDO = "/admin/api/data/backup/dump-do"
	PathAdminBackupListDOs = "/admin/api/data/backup/list-dos"
	PathAdminBackupRestoreD1 = "/admin/api/data/backup/restore-d1"
	PathAdminBackupRestoreDO = "/admin/api/data/backup/restore-do"
	PathAdminCleanupAnon = "/admin/api/data/cleanup-anon"
	PathAdminGetConfigInfo = "/admin/api/data/config-info"
	PathAdminGetDevInfo = "/admin/api/data/dev-info"
	PathAdminGetEmailTemplates = "/admin/api/data/email/templates"
	PathAdminListFunctions = "/admin/api/data/functions"
	PathAdminGetLogs = "/admin/api/data/logs"
	PathAdminGetRecentLogs = "/admin/api/data/logs/recent"
	PathAdminGetMonitoring = "/admin/api/data/monitoring"
	PathAdminGetOverview = "/admin/api/data/overview"
	PathAdminGetPushLogs = "/admin/api/data/push/logs"
	PathAdminTestPushSend = "/admin/api/data/push/test-send"
	PathAdminGetPushTokens = "/admin/api/data/push/tokens"
	PathAdminRulesTest = "/admin/api/data/rules-test"
	PathAdminGetSchema = "/admin/api/data/schema"
	PathAdminExecuteSql = "/admin/api/data/sql"
	PathAdminListBuckets = "/admin/api/data/storage/buckets"
	PathAdminListTables = "/admin/api/data/tables"
	PathAdminListUsers = "/admin/api/data/users"
	PathAdminCreateUser = "/admin/api/data/users"
	PathAdminResetPassword = "/admin/api/internal/reset-password"
	PathAdminSetup = "/admin/api/setup"
	PathAdminSetupStatus = "/admin/api/setup/status"
	PathQueryCustomEvents = "/api/analytics/events"
	PathQueryAnalytics = "/api/analytics/query"
	PathTrackEvents = "/api/analytics/track"
	PathAdminAuthListUsers = "/api/auth/admin/users"
	PathAdminAuthCreateUser = "/api/auth/admin/users"
	PathAdminAuthImportUsers = "/api/auth/admin/users/import"
	PathAuthChangeEmail = "/api/auth/change-email"
	PathAuthChangePassword = "/api/auth/change-password"
	PathAuthGetIdentities = "/api/auth/identities"
	PathAuthLinkEmail = "/api/auth/link/email"
	PathAuthLinkPhone = "/api/auth/link/phone"
	PathAuthGetMe = "/api/auth/me"
	PathAuthMfaFactors = "/api/auth/mfa/factors"
	PathAuthMfaRecovery = "/api/auth/mfa/recovery"
	PathAuthMfaTotpDelete = "/api/auth/mfa/totp"
	PathAuthMfaTotpEnroll = "/api/auth/mfa/totp/enroll"
	PathAuthMfaTotpVerify = "/api/auth/mfa/totp/verify"
	PathAuthMfaVerify = "/api/auth/mfa/verify"
	PathAuthPasskeysList = "/api/auth/passkeys"
	PathAuthPasskeysAuthOptions = "/api/auth/passkeys/auth-options"
	PathAuthPasskeysAuthenticate = "/api/auth/passkeys/authenticate"
	PathAuthPasskeysRegister = "/api/auth/passkeys/register"
	PathAuthPasskeysRegisterOptions = "/api/auth/passkeys/register-options"
	PathAuthUpdateProfile = "/api/auth/profile"
	PathAuthRefresh = "/api/auth/refresh"
	PathAuthRequestEmailVerification = "/api/auth/request-email-verification"
	PathAuthRequestPasswordReset = "/api/auth/request-password-reset"
	PathAuthResetPassword = "/api/auth/reset-password"
	PathAuthGetSessions = "/api/auth/sessions"
	PathAuthSignin = "/api/auth/signin"
	PathAuthSigninAnonymous = "/api/auth/signin/anonymous"
	PathAuthSigninEmailOtp = "/api/auth/signin/email-otp"
	PathAuthSigninMagicLink = "/api/auth/signin/magic-link"
	PathAuthSigninPhone = "/api/auth/signin/phone"
	PathAuthSignout = "/api/auth/signout"
	PathAuthSignup = "/api/auth/signup"
	PathAuthVerifyEmail = "/api/auth/verify-email"
	PathAuthVerifyEmailChange = "/api/auth/verify-email-change"
	PathAuthVerifyEmailOtp = "/api/auth/verify-email-otp"
	PathAuthVerifyLinkPhone = "/api/auth/verify-link-phone"
	PathAuthVerifyMagicLink = "/api/auth/verify-magic-link"
	PathAuthVerifyPhone = "/api/auth/verify-phone"
	PathGetConfig = "/api/config"
	PathDatabaseLiveBroadcast = "/api/db/broadcast"
	PathCheckDatabaseSubscriptionConnection = "/api/db/connect-check"
	PathConnectDatabaseSubscription = "/api/db/subscribe"
	PathGetHealth = "/api/health"
	PathPushBroadcast = "/api/push/broadcast"
	PathGetPushLogs = "/api/push/logs"
	PathPushRegister = "/api/push/register"
	PathPushSend = "/api/push/send"
	PathPushSendMany = "/api/push/send-many"
	PathPushSendToToken = "/api/push/send-to-token"
	PathPushSendToTopic = "/api/push/send-to-topic"
	PathGetPushTokens = "/api/push/tokens"
	PathPutPushTokens = "/api/push/tokens"
	PathPatchPushTokens = "/api/push/tokens"
	PathPushTopicSubscribe = "/api/push/topic/subscribe"
	PathPushTopicUnsubscribe = "/api/push/topic/unsubscribe"
	PathPushUnregister = "/api/push/unregister"
	PathConnectRoom = "/api/room"
	PathCheckRoomConnection = "/api/room/connect-check"
	PathRenegotiateRoomRealtimeSession = "/api/room/media/realtime/renegotiate"
	PathGetRoomRealtimeSession = "/api/room/media/realtime/session"
	PathCreateRoomRealtimeSession = "/api/room/media/realtime/session"
	PathCloseRoomRealtimeTracks = "/api/room/media/realtime/tracks/close"
	PathAddRoomRealtimeTracks = "/api/room/media/realtime/tracks/new"
	PathCreateRoomRealtimeIceServers = "/api/room/media/realtime/turn"
	PathGetRoomMetadata = "/api/room/metadata"
	PathGetSchema = "/api/schema"
	PathExecuteSql = "/api/sql"
)

// PathBackupExportTable builds the path for /admin/api/backup/export/{name}.
func PathBackupExportTable(name string) string {
	return "/admin/api/backup/export/" + name
}

// PathAdminDeleteAdmin builds the path for /admin/api/data/admins/{id}.
func PathAdminDeleteAdmin(id string) string {
	return "/admin/api/data/admins/" + id
}

// PathAdminChangePassword builds the path for /admin/api/data/admins/{id}/password.
func PathAdminChangePassword(id string) string {
	return "/admin/api/data/admins/" + id + "/password"
}

// PathAdminListBucketObjects builds the path for /admin/api/data/storage/buckets/{name}/objects.
func PathAdminListBucketObjects(name string) string {
	return "/admin/api/data/storage/buckets/" + name + "/objects"
}

// PathAdminGetBucketObject builds the path for /admin/api/data/storage/buckets/{name}/objects/{key}.
func PathAdminGetBucketObject(name string, key string) string {
	return "/admin/api/data/storage/buckets/" + name + "/objects/" + key
}

// PathAdminDeleteBucketObject builds the path for /admin/api/data/storage/buckets/{name}/objects/{key}.
func PathAdminDeleteBucketObject(name string, key string) string {
	return "/admin/api/data/storage/buckets/" + name + "/objects/" + key
}

// PathAdminCreateSignedUrl builds the path for /admin/api/data/storage/buckets/{name}/signed-url.
func PathAdminCreateSignedUrl(name string) string {
	return "/admin/api/data/storage/buckets/" + name + "/signed-url"
}

// PathAdminGetBucketStats builds the path for /admin/api/data/storage/buckets/{name}/stats.
func PathAdminGetBucketStats(name string) string {
	return "/admin/api/data/storage/buckets/" + name + "/stats"
}

// PathAdminUploadFile builds the path for /admin/api/data/storage/buckets/{name}/upload.
func PathAdminUploadFile(name string) string {
	return "/admin/api/data/storage/buckets/" + name + "/upload"
}

// PathAdminExportTable builds the path for /admin/api/data/tables/{name}/export.
func PathAdminExportTable(name string) string {
	return "/admin/api/data/tables/" + name + "/export"
}

// PathAdminImportTable builds the path for /admin/api/data/tables/{name}/import.
func PathAdminImportTable(name string) string {
	return "/admin/api/data/tables/" + name + "/import"
}

// PathAdminGetTableRecords builds the path for /admin/api/data/tables/{name}/records.
func PathAdminGetTableRecords(name string) string {
	return "/admin/api/data/tables/" + name + "/records"
}

// PathAdminCreateTableRecord builds the path for /admin/api/data/tables/{name}/records.
func PathAdminCreateTableRecord(name string) string {
	return "/admin/api/data/tables/" + name + "/records"
}

// PathAdminUpdateTableRecord builds the path for /admin/api/data/tables/{name}/records/{id}.
func PathAdminUpdateTableRecord(name string, id string) string {
	return "/admin/api/data/tables/" + name + "/records/" + id
}

// PathAdminDeleteTableRecord builds the path for /admin/api/data/tables/{name}/records/{id}.
func PathAdminDeleteTableRecord(name string, id string) string {
	return "/admin/api/data/tables/" + name + "/records/" + id
}

// PathAdminGetUser builds the path for /admin/api/data/users/{id}.
func PathAdminGetUser(id string) string {
	return "/admin/api/data/users/" + id
}

// PathAdminUpdateUser builds the path for /admin/api/data/users/{id}.
func PathAdminUpdateUser(id string) string {
	return "/admin/api/data/users/" + id
}

// PathAdminDeleteUser builds the path for /admin/api/data/users/{id}.
func PathAdminDeleteUser(id string) string {
	return "/admin/api/data/users/" + id
}

// PathAdminDeleteUserMfa builds the path for /admin/api/data/users/{id}/mfa.
func PathAdminDeleteUserMfa(id string) string {
	return "/admin/api/data/users/" + id + "/mfa"
}

// PathAdminGetUserProfile builds the path for /admin/api/data/users/{id}/profile.
func PathAdminGetUserProfile(id string) string {
	return "/admin/api/data/users/" + id + "/profile"
}

// PathAdminSendPasswordReset builds the path for /admin/api/data/users/{id}/send-password-reset.
func PathAdminSendPasswordReset(id string) string {
	return "/admin/api/data/users/" + id + "/send-password-reset"
}

// PathAdminDeleteUserSessions builds the path for /admin/api/data/users/{id}/sessions.
func PathAdminDeleteUserSessions(id string) string {
	return "/admin/api/data/users/" + id + "/sessions"
}

// PathAdminAuthGetUser builds the path for /api/auth/admin/users/{id}.
func PathAdminAuthGetUser(id string) string {
	return "/api/auth/admin/users/" + id
}

// PathAdminAuthUpdateUser builds the path for /api/auth/admin/users/{id}.
func PathAdminAuthUpdateUser(id string) string {
	return "/api/auth/admin/users/" + id
}

// PathAdminAuthDeleteUser builds the path for /api/auth/admin/users/{id}.
func PathAdminAuthDeleteUser(id string) string {
	return "/api/auth/admin/users/" + id
}

// PathAdminAuthSetClaims builds the path for /api/auth/admin/users/{id}/claims.
func PathAdminAuthSetClaims(id string) string {
	return "/api/auth/admin/users/" + id + "/claims"
}

// PathAdminAuthDeleteUserMfa builds the path for /api/auth/admin/users/{id}/mfa.
func PathAdminAuthDeleteUserMfa(id string) string {
	return "/api/auth/admin/users/" + id + "/mfa"
}

// PathAdminAuthRevokeUserSessions builds the path for /api/auth/admin/users/{id}/revoke.
func PathAdminAuthRevokeUserSessions(id string) string {
	return "/api/auth/admin/users/" + id + "/revoke"
}

// PathAuthDeleteIdentity builds the path for /api/auth/identities/{identityId}.
func PathAuthDeleteIdentity(identityId string) string {
	return "/api/auth/identities/" + identityId
}

// PathOauthRedirect builds the path for /api/auth/oauth/{provider}.
func PathOauthRedirect(provider string) string {
	return "/api/auth/oauth/" + provider
}

// PathOauthCallback builds the path for /api/auth/oauth/{provider}/callback.
func PathOauthCallback(provider string) string {
	return "/api/auth/oauth/" + provider + "/callback"
}

// PathOauthLinkStart builds the path for /api/auth/oauth/link/{provider}.
func PathOauthLinkStart(provider string) string {
	return "/api/auth/oauth/link/" + provider
}

// PathOauthLinkCallback builds the path for /api/auth/oauth/link/{provider}/callback.
func PathOauthLinkCallback(provider string) string {
	return "/api/auth/oauth/link/" + provider + "/callback"
}

// PathAuthPasskeysDelete builds the path for /api/auth/passkeys/{credentialId}.
func PathAuthPasskeysDelete(credentialId string) string {
	return "/api/auth/passkeys/" + credentialId
}

// PathAuthDeleteSession builds the path for /api/auth/sessions/{id}.
func PathAuthDeleteSession(id string) string {
	return "/api/auth/sessions/" + id
}

// PathExecuteD1Query builds the path for /api/d1/{database}.
func PathExecuteD1Query(database string) string {
	return "/api/d1/" + database
}

// PathDbListRecords builds the path for /api/db/{namespace}/{instanceId}/tables/{table}.
func PathDbListRecords(namespace string, instanceId string, table string) string {
	return "/api/db/" + namespace + "/" + instanceId + "/tables/" + table
}

// PathDbInsertRecord builds the path for /api/db/{namespace}/{instanceId}/tables/{table}.
func PathDbInsertRecord(namespace string, instanceId string, table string) string {
	return "/api/db/" + namespace + "/" + instanceId + "/tables/" + table
}

// PathDbGetRecord builds the path for /api/db/{namespace}/{instanceId}/tables/{table}/{id}.
func PathDbGetRecord(namespace string, instanceId string, table string, id string) string {
	return "/api/db/" + namespace + "/" + instanceId + "/tables/" + table + "/" + id
}

// PathDbUpdateRecord builds the path for /api/db/{namespace}/{instanceId}/tables/{table}/{id}.
func PathDbUpdateRecord(namespace string, instanceId string, table string, id string) string {
	return "/api/db/" + namespace + "/" + instanceId + "/tables/" + table + "/" + id
}

// PathDbDeleteRecord builds the path for /api/db/{namespace}/{instanceId}/tables/{table}/{id}.
func PathDbDeleteRecord(namespace string, instanceId string, table string, id string) string {
	return "/api/db/" + namespace + "/" + instanceId + "/tables/" + table + "/" + id
}

// PathDbBatchRecords builds the path for /api/db/{namespace}/{instanceId}/tables/{table}/batch.
func PathDbBatchRecords(namespace string, instanceId string, table string) string {
	return "/api/db/" + namespace + "/" + instanceId + "/tables/" + table + "/batch"
}

// PathDbBatchByFilter builds the path for /api/db/{namespace}/{instanceId}/tables/{table}/batch-by-filter.
func PathDbBatchByFilter(namespace string, instanceId string, table string) string {
	return "/api/db/" + namespace + "/" + instanceId + "/tables/" + table + "/batch-by-filter"
}

// PathDbCountRecords builds the path for /api/db/{namespace}/{instanceId}/tables/{table}/count.
func PathDbCountRecords(namespace string, instanceId string, table string) string {
	return "/api/db/" + namespace + "/" + instanceId + "/tables/" + table + "/count"
}

// PathDbSearchRecords builds the path for /api/db/{namespace}/{instanceId}/tables/{table}/search.
func PathDbSearchRecords(namespace string, instanceId string, table string) string {
	return "/api/db/" + namespace + "/" + instanceId + "/tables/" + table + "/search"
}

// PathDbSingleListRecords builds the path for /api/db/{namespace}/tables/{table}.
func PathDbSingleListRecords(namespace string, table string) string {
	return "/api/db/" + namespace + "/tables/" + table
}

// PathDbSingleInsertRecord builds the path for /api/db/{namespace}/tables/{table}.
func PathDbSingleInsertRecord(namespace string, table string) string {
	return "/api/db/" + namespace + "/tables/" + table
}

// PathDbSingleGetRecord builds the path for /api/db/{namespace}/tables/{table}/{id}.
func PathDbSingleGetRecord(namespace string, table string, id string) string {
	return "/api/db/" + namespace + "/tables/" + table + "/" + id
}

// PathDbSingleUpdateRecord builds the path for /api/db/{namespace}/tables/{table}/{id}.
func PathDbSingleUpdateRecord(namespace string, table string, id string) string {
	return "/api/db/" + namespace + "/tables/" + table + "/" + id
}

// PathDbSingleDeleteRecord builds the path for /api/db/{namespace}/tables/{table}/{id}.
func PathDbSingleDeleteRecord(namespace string, table string, id string) string {
	return "/api/db/" + namespace + "/tables/" + table + "/" + id
}

// PathDbSingleBatchRecords builds the path for /api/db/{namespace}/tables/{table}/batch.
func PathDbSingleBatchRecords(namespace string, table string) string {
	return "/api/db/" + namespace + "/tables/" + table + "/batch"
}

// PathDbSingleBatchByFilter builds the path for /api/db/{namespace}/tables/{table}/batch-by-filter.
func PathDbSingleBatchByFilter(namespace string, table string) string {
	return "/api/db/" + namespace + "/tables/" + table + "/batch-by-filter"
}

// PathDbSingleCountRecords builds the path for /api/db/{namespace}/tables/{table}/count.
func PathDbSingleCountRecords(namespace string, table string) string {
	return "/api/db/" + namespace + "/tables/" + table + "/count"
}

// PathDbSingleSearchRecords builds the path for /api/db/{namespace}/tables/{table}/search.
func PathDbSingleSearchRecords(namespace string, table string) string {
	return "/api/db/" + namespace + "/tables/" + table + "/search"
}

// PathKvOperation builds the path for /api/kv/{namespace}.
func PathKvOperation(namespace string) string {
	return "/api/kv/" + namespace
}

// PathListFiles builds the path for /api/storage/{bucket}.
func PathListFiles(bucket string) string {
	return "/api/storage/" + bucket
}

// PathCheckFileExists builds the path for /api/storage/{bucket}/{key}.
func PathCheckFileExists(bucket string, key string) string {
	return "/api/storage/" + bucket + "/" + key
}

// PathDownloadFile builds the path for /api/storage/{bucket}/{key}.
func PathDownloadFile(bucket string, key string) string {
	return "/api/storage/" + bucket + "/" + key
}

// PathDeleteFile builds the path for /api/storage/{bucket}/{key}.
func PathDeleteFile(bucket string, key string) string {
	return "/api/storage/" + bucket + "/" + key
}

// PathGetFileMetadata builds the path for /api/storage/{bucket}/{key}/metadata.
func PathGetFileMetadata(bucket string, key string) string {
	return "/api/storage/" + bucket + "/" + key + "/metadata"
}

// PathUpdateFileMetadata builds the path for /api/storage/{bucket}/{key}/metadata.
func PathUpdateFileMetadata(bucket string, key string) string {
	return "/api/storage/" + bucket + "/" + key + "/metadata"
}

// PathDeleteBatch builds the path for /api/storage/{bucket}/delete-batch.
func PathDeleteBatch(bucket string) string {
	return "/api/storage/" + bucket + "/delete-batch"
}

// PathAbortMultipartUpload builds the path for /api/storage/{bucket}/multipart/abort.
func PathAbortMultipartUpload(bucket string) string {
	return "/api/storage/" + bucket + "/multipart/abort"
}

// PathCompleteMultipartUpload builds the path for /api/storage/{bucket}/multipart/complete.
func PathCompleteMultipartUpload(bucket string) string {
	return "/api/storage/" + bucket + "/multipart/complete"
}

// PathCreateMultipartUpload builds the path for /api/storage/{bucket}/multipart/create.
func PathCreateMultipartUpload(bucket string) string {
	return "/api/storage/" + bucket + "/multipart/create"
}

// PathUploadPart builds the path for /api/storage/{bucket}/multipart/upload-part.
func PathUploadPart(bucket string) string {
	return "/api/storage/" + bucket + "/multipart/upload-part"
}

// PathCreateSignedUploadUrl builds the path for /api/storage/{bucket}/signed-upload-url.
func PathCreateSignedUploadUrl(bucket string) string {
	return "/api/storage/" + bucket + "/signed-upload-url"
}

// PathCreateSignedDownloadUrl builds the path for /api/storage/{bucket}/signed-url.
func PathCreateSignedDownloadUrl(bucket string) string {
	return "/api/storage/" + bucket + "/signed-url"
}

// PathCreateSignedDownloadUrls builds the path for /api/storage/{bucket}/signed-urls.
func PathCreateSignedDownloadUrls(bucket string) string {
	return "/api/storage/" + bucket + "/signed-urls"
}

// PathUploadFile builds the path for /api/storage/{bucket}/upload.
func PathUploadFile(bucket string) string {
	return "/api/storage/" + bucket + "/upload"
}

// PathGetUploadParts builds the path for /api/storage/{bucket}/uploads/{uploadId}/parts.
func PathGetUploadParts(bucket string, uploadId string) string {
	return "/api/storage/" + bucket + "/uploads/" + uploadId + "/parts"
}

// PathVectorizeOperation builds the path for /api/vectorize/{index}.
func PathVectorizeOperation(index string) string {
	return "/api/vectorize/" + index
}
