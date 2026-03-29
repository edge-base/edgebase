// Auto-generated core API Core — DO NOT EDIT.
// Regenerate: npx tsx tools/sdk-codegen/generate.ts
// Source: openapi.json (0.1.0)

using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace EdgeBase.Generated
{

/// <summary>
/// Auto-generated API methods.
/// </summary>
public class GeneratedDbApi
{
    private readonly JbHttpClient _http;

    public GeneratedDbApi(JbHttpClient http)
    {
        _http = http;
    }

    private static string EncodePathParam(string value)
        => Uri.EscapeDataString(value);

    /// <summary>Health check — GET /api/health</summary>
    public Task<Dictionary<string, object?>> GetHealthAsync(CancellationToken ct = default)
        => _http.GetAsync("/api/health", ct);

    /// <summary>Sign up with email and password — POST /api/auth/signup</summary>
    public Task<Dictionary<string, object?>> AuthSignupAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/auth/signup", body, ct);

    /// <summary>Sign in with email and password — POST /api/auth/signin</summary>
    public Task<Dictionary<string, object?>> AuthSigninAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/auth/signin", body, ct);

    /// <summary>Sign in anonymously — POST /api/auth/signin/anonymous</summary>
    public Task<Dictionary<string, object?>> AuthSigninAnonymousAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/auth/signin/anonymous", body, ct);

    /// <summary>Send magic link to email — POST /api/auth/signin/magic-link</summary>
    public Task<Dictionary<string, object?>> AuthSigninMagicLinkAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/auth/signin/magic-link", body, ct);

    /// <summary>Verify magic link token — POST /api/auth/verify-magic-link</summary>
    public Task<Dictionary<string, object?>> AuthVerifyMagicLinkAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/auth/verify-magic-link", body, ct);

    /// <summary>Send OTP SMS to phone number — POST /api/auth/signin/phone</summary>
    public Task<Dictionary<string, object?>> AuthSigninPhoneAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/auth/signin/phone", body, ct);

    /// <summary>Verify phone OTP and create session — POST /api/auth/verify-phone</summary>
    public Task<Dictionary<string, object?>> AuthVerifyPhoneAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/auth/verify-phone", body, ct);

    /// <summary>Link phone number to existing account — POST /api/auth/link/phone</summary>
    public Task<Dictionary<string, object?>> AuthLinkPhoneAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/auth/link/phone", body, ct);

    /// <summary>Verify OTP and link phone to account — POST /api/auth/verify-link-phone</summary>
    public Task<Dictionary<string, object?>> AuthVerifyLinkPhoneAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/auth/verify-link-phone", body, ct);

    /// <summary>Send OTP code to email — POST /api/auth/signin/email-otp</summary>
    public Task<Dictionary<string, object?>> AuthSigninEmailOtpAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/auth/signin/email-otp", body, ct);

    /// <summary>Verify email OTP and create session — POST /api/auth/verify-email-otp</summary>
    public Task<Dictionary<string, object?>> AuthVerifyEmailOtpAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/auth/verify-email-otp", body, ct);

    /// <summary>Enroll new TOTP factor — POST /api/auth/mfa/totp/enroll</summary>
    public Task<Dictionary<string, object?>> AuthMfaTotpEnrollAsync(CancellationToken ct = default)
        => _http.PostAsync("/api/auth/mfa/totp/enroll", null, ct);

    /// <summary>Confirm TOTP enrollment with code — POST /api/auth/mfa/totp/verify</summary>
    public Task<Dictionary<string, object?>> AuthMfaTotpVerifyAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/auth/mfa/totp/verify", body, ct);

    /// <summary>Verify MFA code during signin — POST /api/auth/mfa/verify</summary>
    public Task<Dictionary<string, object?>> AuthMfaVerifyAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/auth/mfa/verify", body, ct);

    /// <summary>Use recovery code during MFA signin — POST /api/auth/mfa/recovery</summary>
    public Task<Dictionary<string, object?>> AuthMfaRecoveryAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/auth/mfa/recovery", body, ct);

    /// <summary>Disable TOTP factor — DELETE /api/auth/mfa/totp</summary>
    public Task<Dictionary<string, object?>> AuthMfaTotpDeleteAsync(object? body = null, CancellationToken ct = default)
        => _http.DeleteAsync("/api/auth/mfa/totp", body, ct);

    /// <summary>List MFA factors for authenticated user — GET /api/auth/mfa/factors</summary>
    public Task<Dictionary<string, object?>> AuthMfaFactorsAsync(CancellationToken ct = default)
        => _http.GetAsync("/api/auth/mfa/factors", ct);

    /// <summary>Refresh access token — POST /api/auth/refresh</summary>
    public Task<Dictionary<string, object?>> AuthRefreshAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/auth/refresh", body, ct);

    /// <summary>Sign out and revoke refresh token — POST /api/auth/signout</summary>
    public Task<Dictionary<string, object?>> AuthSignoutAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/auth/signout", body, ct);

    /// <summary>Change password for authenticated user — POST /api/auth/change-password</summary>
    public Task<Dictionary<string, object?>> AuthChangePasswordAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/auth/change-password", body, ct);

    /// <summary>Request email change with password confirmation — POST /api/auth/change-email</summary>
    public Task<Dictionary<string, object?>> AuthChangeEmailAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/auth/change-email", body, ct);

    /// <summary>Verify email change token — POST /api/auth/verify-email-change</summary>
    public Task<Dictionary<string, object?>> AuthVerifyEmailChangeAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/auth/verify-email-change", body, ct);

    /// <summary>Generate passkey registration options — POST /api/auth/passkeys/register-options</summary>
    public Task<Dictionary<string, object?>> AuthPasskeysRegisterOptionsAsync(CancellationToken ct = default)
        => _http.PostAsync("/api/auth/passkeys/register-options", null, ct);

    /// <summary>Verify and store passkey registration — POST /api/auth/passkeys/register</summary>
    public Task<Dictionary<string, object?>> AuthPasskeysRegisterAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/auth/passkeys/register", body, ct);

    /// <summary>Generate passkey authentication options — POST /api/auth/passkeys/auth-options</summary>
    public Task<Dictionary<string, object?>> AuthPasskeysAuthOptionsAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/auth/passkeys/auth-options", body, ct);

    /// <summary>Authenticate with passkey — POST /api/auth/passkeys/authenticate</summary>
    public Task<Dictionary<string, object?>> AuthPasskeysAuthenticateAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/auth/passkeys/authenticate", body, ct);

    /// <summary>List passkeys for authenticated user — GET /api/auth/passkeys</summary>
    public Task<Dictionary<string, object?>> AuthPasskeysListAsync(CancellationToken ct = default)
        => _http.GetAsync("/api/auth/passkeys", ct);

    /// <summary>Delete a passkey — DELETE /api/auth/passkeys/{credentialId}</summary>
    public Task<Dictionary<string, object?>> AuthPasskeysDeleteAsync(string credentialId, CancellationToken ct = default)
        => _http.DeleteAsync($"/api/auth/passkeys/{EncodePathParam(credentialId)}", ct);

    /// <summary>Get current authenticated user info — GET /api/auth/me</summary>
    public Task<Dictionary<string, object?>> AuthGetMeAsync(CancellationToken ct = default)
        => _http.GetAsync("/api/auth/me", ct);

    /// <summary>Update user profile — PATCH /api/auth/profile</summary>
    public Task<Dictionary<string, object?>> AuthUpdateProfileAsync(object? body = null, CancellationToken ct = default)
        => _http.PatchAsync("/api/auth/profile", body, ct);

    /// <summary>List active sessions — GET /api/auth/sessions</summary>
    public Task<Dictionary<string, object?>> AuthGetSessionsAsync(CancellationToken ct = default)
        => _http.GetAsync("/api/auth/sessions", ct);

    /// <summary>Delete a session — DELETE /api/auth/sessions/{id}</summary>
    public Task<Dictionary<string, object?>> AuthDeleteSessionAsync(string id, CancellationToken ct = default)
        => _http.DeleteAsync($"/api/auth/sessions/{EncodePathParam(id)}", ct);

    /// <summary>List linked sign-in identities for the current user — GET /api/auth/identities</summary>
    public Task<Dictionary<string, object?>> AuthGetIdentitiesAsync(CancellationToken ct = default)
        => _http.GetAsync("/api/auth/identities", ct);

    /// <summary>Unlink a linked sign-in identity — DELETE /api/auth/identities/{identityId}</summary>
    public Task<Dictionary<string, object?>> AuthDeleteIdentityAsync(string identityId, CancellationToken ct = default)
        => _http.DeleteAsync($"/api/auth/identities/{EncodePathParam(identityId)}", ct);

    /// <summary>Link email and password to existing account — POST /api/auth/link/email</summary>
    public Task<Dictionary<string, object?>> AuthLinkEmailAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/auth/link/email", body, ct);

    /// <summary>Send a verification email to the current authenticated user — POST /api/auth/request-email-verification</summary>
    public Task<Dictionary<string, object?>> AuthRequestEmailVerificationAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/auth/request-email-verification", body, ct);

    /// <summary>Verify email address with token — POST /api/auth/verify-email</summary>
    public Task<Dictionary<string, object?>> AuthVerifyEmailAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/auth/verify-email", body, ct);

    /// <summary>Request password reset email — POST /api/auth/request-password-reset</summary>
    public Task<Dictionary<string, object?>> AuthRequestPasswordResetAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/auth/request-password-reset", body, ct);

    /// <summary>Reset password with token — POST /api/auth/reset-password</summary>
    public Task<Dictionary<string, object?>> AuthResetPasswordAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/auth/reset-password", body, ct);

    /// <summary>Start OAuth redirect — GET /api/auth/oauth/{provider}</summary>
    public Task<Dictionary<string, object?>> OauthRedirectAsync(string provider, CancellationToken ct = default)
        => _http.GetAsync($"/api/auth/oauth/{EncodePathParam(provider)}", ct);

    /// <summary>OAuth callback — GET /api/auth/oauth/{provider}/callback</summary>
    public Task<Dictionary<string, object?>> OauthCallbackAsync(string provider, CancellationToken ct = default)
        => _http.GetAsync($"/api/auth/oauth/{EncodePathParam(provider)}/callback", ct);

    /// <summary>Start OAuth account linking — POST /api/auth/oauth/link/{provider}</summary>
    public Task<Dictionary<string, object?>> OauthLinkStartAsync(string provider, CancellationToken ct = default)
        => _http.PostAsync($"/api/auth/oauth/link/{EncodePathParam(provider)}", null, ct);

    /// <summary>OAuth link callback — GET /api/auth/oauth/link/{provider}/callback</summary>
    public Task<Dictionary<string, object?>> OauthLinkCallbackAsync(string provider, CancellationToken ct = default)
        => _http.GetAsync($"/api/auth/oauth/link/{EncodePathParam(provider)}/callback", ct);

    /// <summary>Count records in a single-instance table — GET /api/db/{namespace}/tables/{table}/count</summary>
    public Task<Dictionary<string, object?>> DbSingleCountRecordsAsync(string @namespace, string table, Dictionary<string, string>? query = null, CancellationToken ct = default)
        => _http.GetWithQueryAsync($"/api/db/{EncodePathParam(@namespace)}/tables/{EncodePathParam(table)}/count", query, ct);

    /// <summary>Search records in a single-instance table — GET /api/db/{namespace}/tables/{table}/search</summary>
    public Task<Dictionary<string, object?>> DbSingleSearchRecordsAsync(string @namespace, string table, Dictionary<string, string>? query = null, CancellationToken ct = default)
        => _http.GetWithQueryAsync($"/api/db/{EncodePathParam(@namespace)}/tables/{EncodePathParam(table)}/search", query, ct);

    /// <summary>Get a single record from a single-instance table — GET /api/db/{namespace}/tables/{table}/{id}</summary>
    public Task<Dictionary<string, object?>> DbSingleGetRecordAsync(string @namespace, string table, string id, Dictionary<string, string>? query = null, CancellationToken ct = default)
        => _http.GetWithQueryAsync($"/api/db/{EncodePathParam(@namespace)}/tables/{EncodePathParam(table)}/{EncodePathParam(id)}", query, ct);

    /// <summary>Update a record in a single-instance table — PATCH /api/db/{namespace}/tables/{table}/{id}</summary>
    public Task<Dictionary<string, object?>> DbSingleUpdateRecordAsync(string @namespace, string table, string id, object? body = null, CancellationToken ct = default)
        => _http.PatchAsync($"/api/db/{EncodePathParam(@namespace)}/tables/{EncodePathParam(table)}/{EncodePathParam(id)}", body, ct);

    /// <summary>Delete a record from a single-instance table — DELETE /api/db/{namespace}/tables/{table}/{id}</summary>
    public Task<Dictionary<string, object?>> DbSingleDeleteRecordAsync(string @namespace, string table, string id, CancellationToken ct = default)
        => _http.DeleteAsync($"/api/db/{EncodePathParam(@namespace)}/tables/{EncodePathParam(table)}/{EncodePathParam(id)}", ct);

    /// <summary>List records from a single-instance table — GET /api/db/{namespace}/tables/{table}</summary>
    public Task<Dictionary<string, object?>> DbSingleListRecordsAsync(string @namespace, string table, Dictionary<string, string>? query = null, CancellationToken ct = default)
        => _http.GetWithQueryAsync($"/api/db/{EncodePathParam(@namespace)}/tables/{EncodePathParam(table)}", query, ct);

    /// <summary>Insert a record into a single-instance table — POST /api/db/{namespace}/tables/{table}</summary>
    public Task<Dictionary<string, object?>> DbSingleInsertRecordAsync(string @namespace, string table, object? body = null, Dictionary<string, string>? query = null, CancellationToken ct = default)
        => _http.PostAsyncWithQuery($"/api/db/{EncodePathParam(@namespace)}/tables/{EncodePathParam(table)}", body, query, ct);

    /// <summary>Batch insert records into a single-instance table — POST /api/db/{namespace}/tables/{table}/batch</summary>
    public Task<Dictionary<string, object?>> DbSingleBatchRecordsAsync(string @namespace, string table, object? body = null, Dictionary<string, string>? query = null, CancellationToken ct = default)
        => _http.PostAsyncWithQuery($"/api/db/{EncodePathParam(@namespace)}/tables/{EncodePathParam(table)}/batch", body, query, ct);

    /// <summary>Batch update/delete records by filter in a single-instance table — POST /api/db/{namespace}/tables/{table}/batch-by-filter</summary>
    public Task<Dictionary<string, object?>> DbSingleBatchByFilterAsync(string @namespace, string table, object? body = null, Dictionary<string, string>? query = null, CancellationToken ct = default)
        => _http.PostAsyncWithQuery($"/api/db/{EncodePathParam(@namespace)}/tables/{EncodePathParam(table)}/batch-by-filter", body, query, ct);

    /// <summary>Count records in dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/count</summary>
    public Task<Dictionary<string, object?>> DbCountRecordsAsync(string @namespace, string instanceId, string table, Dictionary<string, string>? query = null, CancellationToken ct = default)
        => _http.GetWithQueryAsync($"/api/db/{EncodePathParam(@namespace)}/{EncodePathParam(instanceId)}/tables/{EncodePathParam(table)}/count", query, ct);

    /// <summary>Search records in dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/search</summary>
    public Task<Dictionary<string, object?>> DbSearchRecordsAsync(string @namespace, string instanceId, string table, Dictionary<string, string>? query = null, CancellationToken ct = default)
        => _http.GetWithQueryAsync($"/api/db/{EncodePathParam(@namespace)}/{EncodePathParam(instanceId)}/tables/{EncodePathParam(table)}/search", query, ct);

    /// <summary>Get single record from dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}/{id}</summary>
    public Task<Dictionary<string, object?>> DbGetRecordAsync(string @namespace, string instanceId, string table, string id, Dictionary<string, string>? query = null, CancellationToken ct = default)
        => _http.GetWithQueryAsync($"/api/db/{EncodePathParam(@namespace)}/{EncodePathParam(instanceId)}/tables/{EncodePathParam(table)}/{EncodePathParam(id)}", query, ct);

    /// <summary>Update record in dynamic table — PATCH /api/db/{namespace}/{instanceId}/tables/{table}/{id}</summary>
    public Task<Dictionary<string, object?>> DbUpdateRecordAsync(string @namespace, string instanceId, string table, string id, object? body = null, CancellationToken ct = default)
        => _http.PatchAsync($"/api/db/{EncodePathParam(@namespace)}/{EncodePathParam(instanceId)}/tables/{EncodePathParam(table)}/{EncodePathParam(id)}", body, ct);

    /// <summary>Delete record from dynamic table — DELETE /api/db/{namespace}/{instanceId}/tables/{table}/{id}</summary>
    public Task<Dictionary<string, object?>> DbDeleteRecordAsync(string @namespace, string instanceId, string table, string id, CancellationToken ct = default)
        => _http.DeleteAsync($"/api/db/{EncodePathParam(@namespace)}/{EncodePathParam(instanceId)}/tables/{EncodePathParam(table)}/{EncodePathParam(id)}", ct);

    /// <summary>List records from dynamic table — GET /api/db/{namespace}/{instanceId}/tables/{table}</summary>
    public Task<Dictionary<string, object?>> DbListRecordsAsync(string @namespace, string instanceId, string table, Dictionary<string, string>? query = null, CancellationToken ct = default)
        => _http.GetWithQueryAsync($"/api/db/{EncodePathParam(@namespace)}/{EncodePathParam(instanceId)}/tables/{EncodePathParam(table)}", query, ct);

    /// <summary>Insert record into dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table}</summary>
    public Task<Dictionary<string, object?>> DbInsertRecordAsync(string @namespace, string instanceId, string table, object? body = null, Dictionary<string, string>? query = null, CancellationToken ct = default)
        => _http.PostAsyncWithQuery($"/api/db/{EncodePathParam(@namespace)}/{EncodePathParam(instanceId)}/tables/{EncodePathParam(table)}", body, query, ct);

    /// <summary>Batch insert records into dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table}/batch</summary>
    public Task<Dictionary<string, object?>> DbBatchRecordsAsync(string @namespace, string instanceId, string table, object? body = null, Dictionary<string, string>? query = null, CancellationToken ct = default)
        => _http.PostAsyncWithQuery($"/api/db/{EncodePathParam(@namespace)}/{EncodePathParam(instanceId)}/tables/{EncodePathParam(table)}/batch", body, query, ct);

    /// <summary>Batch update/delete records by filter in dynamic table — POST /api/db/{namespace}/{instanceId}/tables/{table}/batch-by-filter</summary>
    public Task<Dictionary<string, object?>> DbBatchByFilterAsync(string @namespace, string instanceId, string table, object? body = null, Dictionary<string, string>? query = null, CancellationToken ct = default)
        => _http.PostAsyncWithQuery($"/api/db/{EncodePathParam(@namespace)}/{EncodePathParam(instanceId)}/tables/{EncodePathParam(table)}/batch-by-filter", body, query, ct);

    /// <summary>Check database live subscription WebSocket prerequisites — GET /api/db/connect-check</summary>
    public Task<Dictionary<string, object?>> CheckDatabaseSubscriptionConnectionAsync(Dictionary<string, string>? query = null, CancellationToken ct = default)
        => _http.GetWithQueryAsync("/api/db/connect-check", query, ct);

    /// <summary>Connect to database live subscriptions WebSocket — GET /api/db/subscribe</summary>
    public Task<Dictionary<string, object?>> ConnectDatabaseSubscriptionAsync(Dictionary<string, string>? query = null, CancellationToken ct = default)
        => _http.GetWithQueryAsync("/api/db/subscribe", query, ct);

    /// <summary>Get table schema — GET /api/schema</summary>
    public Task<Dictionary<string, object?>> GetSchemaAsync(CancellationToken ct = default)
        => _http.GetAsync("/api/schema", ct);

    /// <summary>Upload file — POST /api/storage/{bucket}/upload</summary>
    public Task<Dictionary<string, object?>> UploadFileAsync(string bucket, object? body = null, CancellationToken ct = default)
        => _http.PostAsync($"/api/storage/{EncodePathParam(bucket)}/upload", body, ct);

    /// <summary>Get file metadata — GET /api/storage/{bucket}/{key}/metadata</summary>
    public Task<Dictionary<string, object?>> GetFileMetadataAsync(string bucket, string key, CancellationToken ct = default)
        => _http.GetAsync($"/api/storage/{EncodePathParam(bucket)}/{EncodePathParam(key)}/metadata", ct);

    /// <summary>Update file metadata — PATCH /api/storage/{bucket}/{key}/metadata</summary>
    public Task<Dictionary<string, object?>> UpdateFileMetadataAsync(string bucket, string key, object? body = null, CancellationToken ct = default)
        => _http.PatchAsync($"/api/storage/{EncodePathParam(bucket)}/{EncodePathParam(key)}/metadata", body, ct);

    /// <summary>Check if file exists — HEAD /api/storage/{bucket}/{key}</summary>
    public Task<bool> CheckFileExistsAsync(string bucket, string key, CancellationToken ct = default)
        => _http.HeadAsync($"/api/storage/{EncodePathParam(bucket)}/{EncodePathParam(key)}", ct);

    /// <summary>Download file — GET /api/storage/{bucket}/{key}</summary>
    public Task<Dictionary<string, object?>> DownloadFileAsync(string bucket, string key, CancellationToken ct = default)
        => _http.GetAsync($"/api/storage/{EncodePathParam(bucket)}/{EncodePathParam(key)}", ct);

    /// <summary>Delete file — DELETE /api/storage/{bucket}/{key}</summary>
    public Task<Dictionary<string, object?>> DeleteFileAsync(string bucket, string key, CancellationToken ct = default)
        => _http.DeleteAsync($"/api/storage/{EncodePathParam(bucket)}/{EncodePathParam(key)}", ct);

    /// <summary>Get uploaded parts — GET /api/storage/{bucket}/uploads/{uploadId}/parts</summary>
    public Task<Dictionary<string, object?>> GetUploadPartsAsync(string bucket, string uploadId, Dictionary<string, string>? query = null, CancellationToken ct = default)
        => _http.GetWithQueryAsync($"/api/storage/{EncodePathParam(bucket)}/uploads/{EncodePathParam(uploadId)}/parts", query, ct);

    /// <summary>List files in bucket — GET /api/storage/{bucket}</summary>
    public Task<Dictionary<string, object?>> ListFilesAsync(string bucket, CancellationToken ct = default)
        => _http.GetAsync($"/api/storage/{EncodePathParam(bucket)}", ct);

    /// <summary>Batch delete files — POST /api/storage/{bucket}/delete-batch</summary>
    public Task<Dictionary<string, object?>> DeleteBatchAsync(string bucket, object? body = null, CancellationToken ct = default)
        => _http.PostAsync($"/api/storage/{EncodePathParam(bucket)}/delete-batch", body, ct);

    /// <summary>Create signed download URL — POST /api/storage/{bucket}/signed-url</summary>
    public Task<Dictionary<string, object?>> CreateSignedDownloadUrlAsync(string bucket, object? body = null, CancellationToken ct = default)
        => _http.PostAsync($"/api/storage/{EncodePathParam(bucket)}/signed-url", body, ct);

    /// <summary>Batch create signed download URLs — POST /api/storage/{bucket}/signed-urls</summary>
    public Task<Dictionary<string, object?>> CreateSignedDownloadUrlsAsync(string bucket, object? body = null, CancellationToken ct = default)
        => _http.PostAsync($"/api/storage/{EncodePathParam(bucket)}/signed-urls", body, ct);

    /// <summary>Create signed upload URL — POST /api/storage/{bucket}/signed-upload-url</summary>
    public Task<Dictionary<string, object?>> CreateSignedUploadUrlAsync(string bucket, object? body = null, CancellationToken ct = default)
        => _http.PostAsync($"/api/storage/{EncodePathParam(bucket)}/signed-upload-url", body, ct);

    /// <summary>Start multipart upload — POST /api/storage/{bucket}/multipart/create</summary>
    public Task<Dictionary<string, object?>> CreateMultipartUploadAsync(string bucket, object? body = null, CancellationToken ct = default)
        => _http.PostAsync($"/api/storage/{EncodePathParam(bucket)}/multipart/create", body, ct);

    /// <summary>Upload a part — POST /api/storage/{bucket}/multipart/upload-part</summary>
    public Task<Dictionary<string, object?>> UploadPartAsync(string bucket, object? body = null, CancellationToken ct = default)
        => _http.PostAsync($"/api/storage/{EncodePathParam(bucket)}/multipart/upload-part", body, ct);

    /// <summary>Complete multipart upload — POST /api/storage/{bucket}/multipart/complete</summary>
    public Task<Dictionary<string, object?>> CompleteMultipartUploadAsync(string bucket, object? body = null, CancellationToken ct = default)
        => _http.PostAsync($"/api/storage/{EncodePathParam(bucket)}/multipart/complete", body, ct);

    /// <summary>Abort multipart upload — POST /api/storage/{bucket}/multipart/abort</summary>
    public Task<Dictionary<string, object?>> AbortMultipartUploadAsync(string bucket, object? body = null, CancellationToken ct = default)
        => _http.PostAsync($"/api/storage/{EncodePathParam(bucket)}/multipart/abort", body, ct);

    /// <summary>Get public configuration — GET /api/config</summary>
    public Task<Dictionary<string, object?>> GetConfigAsync(CancellationToken ct = default)
        => _http.GetAsync("/api/config", ct);

    /// <summary>Register push token — POST /api/push/register</summary>
    public Task<Dictionary<string, object?>> PushRegisterAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/push/register", body, ct);

    /// <summary>Unregister push token — POST /api/push/unregister</summary>
    public Task<Dictionary<string, object?>> PushUnregisterAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/push/unregister", body, ct);

    /// <summary>Subscribe token to topic — POST /api/push/topic/subscribe</summary>
    public Task<Dictionary<string, object?>> PushTopicSubscribeAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/push/topic/subscribe", body, ct);

    /// <summary>Unsubscribe token from topic — POST /api/push/topic/unsubscribe</summary>
    public Task<Dictionary<string, object?>> PushTopicUnsubscribeAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/push/topic/unsubscribe", body, ct);

    /// <summary>Check room WebSocket connection prerequisites — GET /api/room/connect-check</summary>
    public Task<Dictionary<string, object?>> CheckRoomConnectionAsync(Dictionary<string, string>? query = null, CancellationToken ct = default)
        => _http.GetWithQueryAsync("/api/room/connect-check", query, ct);

    /// <summary>Connect to room WebSocket — GET /api/room</summary>
    public Task<Dictionary<string, object?>> ConnectRoomAsync(Dictionary<string, string>? query = null, CancellationToken ct = default)
        => _http.GetWithQueryAsync("/api/room", query, ct);

    /// <summary>Get room metadata — GET /api/room/metadata</summary>
    public Task<Dictionary<string, object?>> GetRoomMetadataAsync(Dictionary<string, string>? query = null, CancellationToken ct = default)
        => _http.GetWithQueryAsync("/api/room/metadata", query, ct);

    /// <summary>Track custom events — POST /api/analytics/track</summary>
    public Task<Dictionary<string, object?>> TrackEventsAsync(object? body = null, CancellationToken ct = default)
        => _http.PostAsync("/api/analytics/track", body, ct);
}


/// <summary>
/// Auto-generated path constants.
/// </summary>
public static class ApiPaths
{
    public const string ADMIN_LOGIN = "/admin/api/auth/login";
    public const string ADMIN_REFRESH = "/admin/api/auth/refresh";
    public const string BACKUP_CLEANUP_PLUGIN = "/admin/api/backup/cleanup-plugin";
    public const string BACKUP_GET_CONFIG = "/admin/api/backup/config";
    public const string BACKUP_DUMP_CONTROL_D1 = "/admin/api/backup/dump-control-d1";
    public const string BACKUP_DUMP_D1 = "/admin/api/backup/dump-d1";
    public const string BACKUP_DUMP_DATA = "/admin/api/backup/dump-data";
    public const string BACKUP_DUMP_DO = "/admin/api/backup/dump-do";
    public const string BACKUP_DUMP_STORAGE = "/admin/api/backup/dump-storage";
    public static string BackupExportTable(string name) => $"/admin/api/backup/export/{name}";
    public const string BACKUP_LIST_DOS = "/admin/api/backup/list-dos";
    public const string BACKUP_RESTORE_CONTROL_D1 = "/admin/api/backup/restore-control-d1";
    public const string BACKUP_RESTORE_D1 = "/admin/api/backup/restore-d1";
    public const string BACKUP_RESTORE_DATA = "/admin/api/backup/restore-data";
    public const string BACKUP_RESTORE_DO = "/admin/api/backup/restore-do";
    public const string BACKUP_RESTORE_STORAGE = "/admin/api/backup/restore-storage";
    public const string BACKUP_RESYNC_USERS_PUBLIC = "/admin/api/backup/resync-users-public";
    public const string BACKUP_WIPE_DO = "/admin/api/backup/wipe-do";
    public const string ADMIN_LIST_ADMINS = "/admin/api/data/admins";
    public const string ADMIN_CREATE_ADMIN = "/admin/api/data/admins";
    public static string AdminDeleteAdmin(string id) => $"/admin/api/data/admins/{id}";
    public static string AdminChangePassword(string id) => $"/admin/api/data/admins/{id}/password";
    public const string ADMIN_GET_ANALYTICS = "/admin/api/data/analytics";
    public const string ADMIN_GET_ANALYTICS_EVENTS = "/admin/api/data/analytics/events";
    public const string ADMIN_GET_AUTH_SETTINGS = "/admin/api/data/auth/settings";
    public const string ADMIN_BACKUP_GET_CONFIG = "/admin/api/data/backup/config";
    public const string ADMIN_BACKUP_DUMP_D1 = "/admin/api/data/backup/dump-d1";
    public const string ADMIN_BACKUP_DUMP_DATA = "/admin/api/data/backup/dump-data";
    public const string ADMIN_BACKUP_DUMP_DO = "/admin/api/data/backup/dump-do";
    public const string ADMIN_BACKUP_LIST_DOS = "/admin/api/data/backup/list-dos";
    public const string ADMIN_BACKUP_RESTORE_D1 = "/admin/api/data/backup/restore-d1";
    public const string ADMIN_BACKUP_RESTORE_DATA = "/admin/api/data/backup/restore-data";
    public const string ADMIN_BACKUP_RESTORE_DO = "/admin/api/data/backup/restore-do";
    public const string ADMIN_CLEANUP_ANON = "/admin/api/data/cleanup-anon";
    public const string ADMIN_GET_CONFIG_INFO = "/admin/api/data/config-info";
    public const string ADMIN_DESTROY_APP = "/admin/api/data/destroy-app";
    public const string ADMIN_GET_DEV_INFO = "/admin/api/data/dev-info";
    public const string ADMIN_GET_EMAIL_TEMPLATES = "/admin/api/data/email/templates";
    public const string ADMIN_LIST_FUNCTIONS = "/admin/api/data/functions";
    public const string ADMIN_GET_LOGS = "/admin/api/data/logs";
    public const string ADMIN_GET_RECENT_LOGS = "/admin/api/data/logs/recent";
    public const string ADMIN_GET_MONITORING = "/admin/api/data/monitoring";
    public static string AdminListNamespaceInstances(string @namespace) => $"/admin/api/data/namespaces/{@namespace}/instances";
    public const string ADMIN_GET_OVERVIEW = "/admin/api/data/overview";
    public const string ADMIN_GET_PUSH_LOGS = "/admin/api/data/push/logs";
    public const string ADMIN_TEST_PUSH_SEND = "/admin/api/data/push/test-send";
    public const string ADMIN_GET_PUSH_TOKENS = "/admin/api/data/push/tokens";
    public const string ADMIN_RULES_TEST = "/admin/api/data/rules-test";
    public const string ADMIN_GET_SCHEMA = "/admin/api/data/schema";
    public const string ADMIN_EXECUTE_SQL = "/admin/api/data/sql";
    public const string ADMIN_LIST_BUCKETS = "/admin/api/data/storage/buckets";
    public static string AdminListBucketObjects(string name) => $"/admin/api/data/storage/buckets/{name}/objects";
    public static string AdminGetBucketObject(string name, string key) => $"/admin/api/data/storage/buckets/{name}/objects/{key}";
    public static string AdminDeleteBucketObject(string name, string key) => $"/admin/api/data/storage/buckets/{name}/objects/{key}";
    public static string AdminCreateSignedUrl(string name) => $"/admin/api/data/storage/buckets/{name}/signed-url";
    public static string AdminGetBucketStats(string name) => $"/admin/api/data/storage/buckets/{name}/stats";
    public static string AdminUploadFile(string name) => $"/admin/api/data/storage/buckets/{name}/upload";
    public const string ADMIN_LIST_TABLES = "/admin/api/data/tables";
    public static string AdminExportTable(string name) => $"/admin/api/data/tables/{name}/export";
    public static string AdminImportTable(string name) => $"/admin/api/data/tables/{name}/import";
    public static string AdminGetTableRecords(string name) => $"/admin/api/data/tables/{name}/records";
    public static string AdminCreateTableRecord(string name) => $"/admin/api/data/tables/{name}/records";
    public static string AdminUpdateTableRecord(string name, string id) => $"/admin/api/data/tables/{name}/records/{id}";
    public static string AdminDeleteTableRecord(string name, string id) => $"/admin/api/data/tables/{name}/records/{id}";
    public const string ADMIN_LIST_USERS = "/admin/api/data/users";
    public const string ADMIN_CREATE_USER = "/admin/api/data/users";
    public static string AdminGetUser(string id) => $"/admin/api/data/users/{id}";
    public static string AdminUpdateUser(string id) => $"/admin/api/data/users/{id}";
    public static string AdminDeleteUser(string id) => $"/admin/api/data/users/{id}";
    public static string AdminDeleteUserMfa(string id) => $"/admin/api/data/users/{id}/mfa";
    public static string AdminGetUserProfile(string id) => $"/admin/api/data/users/{id}/profile";
    public static string AdminSendPasswordReset(string id) => $"/admin/api/data/users/{id}/send-password-reset";
    public static string AdminDeleteUserSessions(string id) => $"/admin/api/data/users/{id}/sessions";
    public const string ADMIN_RESET_PASSWORD = "/admin/api/internal/reset-password";
    public const string ADMIN_SETUP = "/admin/api/setup";
    public const string ADMIN_SETUP_STATUS = "/admin/api/setup/status";
    public const string QUERY_CUSTOM_EVENTS = "/api/analytics/events";
    public const string QUERY_ANALYTICS = "/api/analytics/query";
    public const string TRACK_EVENTS = "/api/analytics/track";
    public const string ADMIN_AUTH_LIST_USERS = "/api/auth/admin/users";
    public const string ADMIN_AUTH_CREATE_USER = "/api/auth/admin/users";
    public static string AdminAuthGetUser(string id) => $"/api/auth/admin/users/{id}";
    public static string AdminAuthUpdateUser(string id) => $"/api/auth/admin/users/{id}";
    public static string AdminAuthDeleteUser(string id) => $"/api/auth/admin/users/{id}";
    public static string AdminAuthSetClaims(string id) => $"/api/auth/admin/users/{id}/claims";
    public static string AdminAuthDeleteUserMfa(string id) => $"/api/auth/admin/users/{id}/mfa";
    public static string AdminAuthRevokeUserSessions(string id) => $"/api/auth/admin/users/{id}/revoke";
    public const string ADMIN_AUTH_IMPORT_USERS = "/api/auth/admin/users/import";
    public const string AUTH_CHANGE_EMAIL = "/api/auth/change-email";
    public const string AUTH_CHANGE_PASSWORD = "/api/auth/change-password";
    public const string AUTH_GET_IDENTITIES = "/api/auth/identities";
    public static string AuthDeleteIdentity(string identityId) => $"/api/auth/identities/{identityId}";
    public const string AUTH_LINK_EMAIL = "/api/auth/link/email";
    public const string AUTH_LINK_PHONE = "/api/auth/link/phone";
    public const string AUTH_GET_ME = "/api/auth/me";
    public const string AUTH_MFA_FACTORS = "/api/auth/mfa/factors";
    public const string AUTH_MFA_RECOVERY = "/api/auth/mfa/recovery";
    public const string AUTH_MFA_TOTP_DELETE = "/api/auth/mfa/totp";
    public const string AUTH_MFA_TOTP_ENROLL = "/api/auth/mfa/totp/enroll";
    public const string AUTH_MFA_TOTP_VERIFY = "/api/auth/mfa/totp/verify";
    public const string AUTH_MFA_VERIFY = "/api/auth/mfa/verify";
    public static string OauthRedirect(string provider) => $"/api/auth/oauth/{provider}";
    public static string OauthCallback(string provider) => $"/api/auth/oauth/{provider}/callback";
    public static string OauthLinkStart(string provider) => $"/api/auth/oauth/link/{provider}";
    public static string OauthLinkCallback(string provider) => $"/api/auth/oauth/link/{provider}/callback";
    public const string AUTH_PASSKEYS_LIST = "/api/auth/passkeys";
    public static string AuthPasskeysDelete(string credentialId) => $"/api/auth/passkeys/{credentialId}";
    public const string AUTH_PASSKEYS_AUTH_OPTIONS = "/api/auth/passkeys/auth-options";
    public const string AUTH_PASSKEYS_AUTHENTICATE = "/api/auth/passkeys/authenticate";
    public const string AUTH_PASSKEYS_REGISTER = "/api/auth/passkeys/register";
    public const string AUTH_PASSKEYS_REGISTER_OPTIONS = "/api/auth/passkeys/register-options";
    public const string AUTH_UPDATE_PROFILE = "/api/auth/profile";
    public const string AUTH_REFRESH = "/api/auth/refresh";
    public const string AUTH_REQUEST_EMAIL_VERIFICATION = "/api/auth/request-email-verification";
    public const string AUTH_REQUEST_PASSWORD_RESET = "/api/auth/request-password-reset";
    public const string AUTH_RESET_PASSWORD = "/api/auth/reset-password";
    public const string AUTH_GET_SESSIONS = "/api/auth/sessions";
    public static string AuthDeleteSession(string id) => $"/api/auth/sessions/{id}";
    public const string AUTH_SIGNIN = "/api/auth/signin";
    public const string AUTH_SIGNIN_ANONYMOUS = "/api/auth/signin/anonymous";
    public const string AUTH_SIGNIN_EMAIL_OTP = "/api/auth/signin/email-otp";
    public const string AUTH_SIGNIN_MAGIC_LINK = "/api/auth/signin/magic-link";
    public const string AUTH_SIGNIN_PHONE = "/api/auth/signin/phone";
    public const string AUTH_SIGNOUT = "/api/auth/signout";
    public const string AUTH_SIGNUP = "/api/auth/signup";
    public const string AUTH_VERIFY_EMAIL = "/api/auth/verify-email";
    public const string AUTH_VERIFY_EMAIL_CHANGE = "/api/auth/verify-email-change";
    public const string AUTH_VERIFY_EMAIL_OTP = "/api/auth/verify-email-otp";
    public const string AUTH_VERIFY_LINK_PHONE = "/api/auth/verify-link-phone";
    public const string AUTH_VERIFY_MAGIC_LINK = "/api/auth/verify-magic-link";
    public const string AUTH_VERIFY_PHONE = "/api/auth/verify-phone";
    public const string GET_CONFIG = "/api/config";
    public static string ExecuteD1Query(string database) => $"/api/d1/{database}";
    public static string DbListRecords(string @namespace, string instanceId, string table) => $"/api/db/{@namespace}/{instanceId}/tables/{table}";
    public static string DbInsertRecord(string @namespace, string instanceId, string table) => $"/api/db/{@namespace}/{instanceId}/tables/{table}";
    public static string DbGetRecord(string @namespace, string instanceId, string table, string id) => $"/api/db/{@namespace}/{instanceId}/tables/{table}/{id}";
    public static string DbUpdateRecord(string @namespace, string instanceId, string table, string id) => $"/api/db/{@namespace}/{instanceId}/tables/{table}/{id}";
    public static string DbDeleteRecord(string @namespace, string instanceId, string table, string id) => $"/api/db/{@namespace}/{instanceId}/tables/{table}/{id}";
    public static string DbBatchRecords(string @namespace, string instanceId, string table) => $"/api/db/{@namespace}/{instanceId}/tables/{table}/batch";
    public static string DbBatchByFilter(string @namespace, string instanceId, string table) => $"/api/db/{@namespace}/{instanceId}/tables/{table}/batch-by-filter";
    public static string DbCountRecords(string @namespace, string instanceId, string table) => $"/api/db/{@namespace}/{instanceId}/tables/{table}/count";
    public static string DbSearchRecords(string @namespace, string instanceId, string table) => $"/api/db/{@namespace}/{instanceId}/tables/{table}/search";
    public static string DbSingleListRecords(string @namespace, string table) => $"/api/db/{@namespace}/tables/{table}";
    public static string DbSingleInsertRecord(string @namespace, string table) => $"/api/db/{@namespace}/tables/{table}";
    public static string DbSingleGetRecord(string @namespace, string table, string id) => $"/api/db/{@namespace}/tables/{table}/{id}";
    public static string DbSingleUpdateRecord(string @namespace, string table, string id) => $"/api/db/{@namespace}/tables/{table}/{id}";
    public static string DbSingleDeleteRecord(string @namespace, string table, string id) => $"/api/db/{@namespace}/tables/{table}/{id}";
    public static string DbSingleBatchRecords(string @namespace, string table) => $"/api/db/{@namespace}/tables/{table}/batch";
    public static string DbSingleBatchByFilter(string @namespace, string table) => $"/api/db/{@namespace}/tables/{table}/batch-by-filter";
    public static string DbSingleCountRecords(string @namespace, string table) => $"/api/db/{@namespace}/tables/{table}/count";
    public static string DbSingleSearchRecords(string @namespace, string table) => $"/api/db/{@namespace}/tables/{table}/search";
    public const string DATABASE_LIVE_BROADCAST = "/api/db/broadcast";
    public const string CHECK_DATABASE_SUBSCRIPTION_CONNECTION = "/api/db/connect-check";
    public const string CONNECT_DATABASE_SUBSCRIPTION = "/api/db/subscribe";
    public const string GET_HEALTH = "/api/health";
    public static string KvOperation(string @namespace) => $"/api/kv/{@namespace}";
    public const string PUSH_BROADCAST = "/api/push/broadcast";
    public const string GET_PUSH_LOGS = "/api/push/logs";
    public const string PUSH_REGISTER = "/api/push/register";
    public const string PUSH_SEND = "/api/push/send";
    public const string PUSH_SEND_MANY = "/api/push/send-many";
    public const string PUSH_SEND_TO_TOKEN = "/api/push/send-to-token";
    public const string PUSH_SEND_TO_TOPIC = "/api/push/send-to-topic";
    public const string GET_PUSH_TOKENS = "/api/push/tokens";
    public const string PUT_PUSH_TOKENS = "/api/push/tokens";
    public const string PATCH_PUSH_TOKENS = "/api/push/tokens";
    public const string PUSH_TOPIC_SUBSCRIBE = "/api/push/topic/subscribe";
    public const string PUSH_TOPIC_UNSUBSCRIBE = "/api/push/topic/unsubscribe";
    public const string PUSH_UNREGISTER = "/api/push/unregister";
    public const string CONNECT_ROOM = "/api/room";
    public const string CHECK_ROOM_CONNECTION = "/api/room/connect-check";
    public const string GET_ROOM_METADATA = "/api/room/metadata";
    public const string GET_SCHEMA = "/api/schema";
    public const string EXECUTE_SQL = "/api/sql";
    public static string ListFiles(string bucket) => $"/api/storage/{bucket}";
    public static string CheckFileExists(string bucket, string key) => $"/api/storage/{bucket}/{key}";
    public static string DownloadFile(string bucket, string key) => $"/api/storage/{bucket}/{key}";
    public static string DeleteFile(string bucket, string key) => $"/api/storage/{bucket}/{key}";
    public static string GetFileMetadata(string bucket, string key) => $"/api/storage/{bucket}/{key}/metadata";
    public static string UpdateFileMetadata(string bucket, string key) => $"/api/storage/{bucket}/{key}/metadata";
    public static string DeleteBatch(string bucket) => $"/api/storage/{bucket}/delete-batch";
    public static string AbortMultipartUpload(string bucket) => $"/api/storage/{bucket}/multipart/abort";
    public static string CompleteMultipartUpload(string bucket) => $"/api/storage/{bucket}/multipart/complete";
    public static string CreateMultipartUpload(string bucket) => $"/api/storage/{bucket}/multipart/create";
    public static string UploadPart(string bucket) => $"/api/storage/{bucket}/multipart/upload-part";
    public static string CreateSignedUploadUrl(string bucket) => $"/api/storage/{bucket}/signed-upload-url";
    public static string CreateSignedDownloadUrl(string bucket) => $"/api/storage/{bucket}/signed-url";
    public static string CreateSignedDownloadUrls(string bucket) => $"/api/storage/{bucket}/signed-urls";
    public static string UploadFile(string bucket) => $"/api/storage/{bucket}/upload";
    public static string GetUploadParts(string bucket, string uploadId) => $"/api/storage/{bucket}/uploads/{uploadId}/parts";
    public static string VectorizeOperation(string index) => $"/api/vectorize/{index}";
}

}
