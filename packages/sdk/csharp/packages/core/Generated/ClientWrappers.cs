// Auto-generated client wrapper methods — DO NOT EDIT.
// Regenerate: npx tsx tools/sdk-codegen/generate.ts
// Source: wrapper-config.json + openapi.json (0.1.0)

using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace EdgeBase.Generated
{

/// <summary>
/// Authentication wrapper methods
/// </summary>
public class GeneratedAuthMethods
{
    protected readonly GeneratedDbApi _core;

    public GeneratedAuthMethods(GeneratedDbApi core)
    {
        _core = core;
    }

    /// <summary>Sign up with email and password</summary>
    public virtual Task<Dictionary<string, object?>> SignUpAsync(object? body = null, CancellationToken ct = default)
        => _core.AuthSignupAsync(body, ct);

    /// <summary>Sign in with email and password</summary>
    public virtual Task<Dictionary<string, object?>> SignInAsync(object? body = null, CancellationToken ct = default)
        => _core.AuthSigninAsync(body, ct);

    /// <summary>Sign out and revoke refresh token</summary>
    public virtual Task<Dictionary<string, object?>> SignOutAsync(object? body = null, CancellationToken ct = default)
        => _core.AuthSignoutAsync(body, ct);

    /// <summary>Sign in anonymously</summary>
    public virtual Task<Dictionary<string, object?>> SignInAnonymouslyAsync(object? body = null, CancellationToken ct = default)
        => _core.AuthSigninAnonymousAsync(body, ct);

    /// <summary>Send magic link to email</summary>
    public virtual Task<Dictionary<string, object?>> SignInWithMagicLinkAsync(object? body = null, CancellationToken ct = default)
        => _core.AuthSigninMagicLinkAsync(body, ct);

    /// <summary>Verify magic link token</summary>
    public virtual Task<Dictionary<string, object?>> VerifyMagicLinkAsync(object? body = null, CancellationToken ct = default)
        => _core.AuthVerifyMagicLinkAsync(body, ct);

    /// <summary>Send OTP SMS to phone number</summary>
    public virtual Task<Dictionary<string, object?>> SignInWithPhoneAsync(object? body = null, CancellationToken ct = default)
        => _core.AuthSigninPhoneAsync(body, ct);

    /// <summary>Verify phone OTP and create session</summary>
    public virtual Task<Dictionary<string, object?>> VerifyPhoneAsync(object? body = null, CancellationToken ct = default)
        => _core.AuthVerifyPhoneAsync(body, ct);

    /// <summary>Send OTP code to email</summary>
    public virtual Task<Dictionary<string, object?>> SignInWithEmailOtpAsync(object? body = null, CancellationToken ct = default)
        => _core.AuthSigninEmailOtpAsync(body, ct);

    /// <summary>Verify email OTP and create session</summary>
    public virtual Task<Dictionary<string, object?>> VerifyEmailOtpAsync(object? body = null, CancellationToken ct = default)
        => _core.AuthVerifyEmailOtpAsync(body, ct);

    /// <summary>Link phone number to existing account</summary>
    public virtual Task<Dictionary<string, object?>> LinkWithPhoneAsync(object? body = null, CancellationToken ct = default)
        => _core.AuthLinkPhoneAsync(body, ct);

    /// <summary>Verify OTP and link phone to account</summary>
    public virtual Task<Dictionary<string, object?>> VerifyLinkPhoneAsync(object? body = null, CancellationToken ct = default)
        => _core.AuthVerifyLinkPhoneAsync(body, ct);

    /// <summary>Link email and password to existing account</summary>
    public virtual Task<Dictionary<string, object?>> LinkWithEmailAsync(object? body = null, CancellationToken ct = default)
        => _core.AuthLinkEmailAsync(body, ct);

    /// <summary>Request email change with password confirmation</summary>
    public virtual Task<Dictionary<string, object?>> ChangeEmailAsync(object? body = null, CancellationToken ct = default)
        => _core.AuthChangeEmailAsync(body, ct);

    /// <summary>Verify email change token</summary>
    public virtual Task<Dictionary<string, object?>> VerifyEmailChangeAsync(object? body = null, CancellationToken ct = default)
        => _core.AuthVerifyEmailChangeAsync(body, ct);

    /// <summary>Verify email address with token</summary>
    public virtual Task<Dictionary<string, object?>> VerifyEmailAsync(object? body = null, CancellationToken ct = default)
        => _core.AuthVerifyEmailAsync(body, ct);

    /// <summary>Request password reset email</summary>
    public virtual Task<Dictionary<string, object?>> RequestPasswordResetAsync(object? body = null, CancellationToken ct = default)
        => _core.AuthRequestPasswordResetAsync(body, ct);

    /// <summary>Reset password with token</summary>
    public virtual Task<Dictionary<string, object?>> ResetPasswordAsync(object? body = null, CancellationToken ct = default)
        => _core.AuthResetPasswordAsync(body, ct);

    /// <summary>Change password for authenticated user</summary>
    public virtual Task<Dictionary<string, object?>> ChangePasswordAsync(object? body = null, CancellationToken ct = default)
        => _core.AuthChangePasswordAsync(body, ct);

    /// <summary>Get current authenticated user info</summary>
    public virtual Task<Dictionary<string, object?>> GetMeAsync(CancellationToken ct = default)
        => _core.AuthGetMeAsync(ct);

    /// <summary>Update user profile</summary>
    public virtual Task<Dictionary<string, object?>> UpdateProfileAsync(object? body = null, CancellationToken ct = default)
        => _core.AuthUpdateProfileAsync(body, ct);

    /// <summary>List active sessions</summary>
    public virtual Task<Dictionary<string, object?>> ListSessionsAsync(CancellationToken ct = default)
        => _core.AuthGetSessionsAsync(ct);

    /// <summary>Delete a session</summary>
    public virtual Task<Dictionary<string, object?>> RevokeSessionAsync(string id, CancellationToken ct = default)
        => _core.AuthDeleteSessionAsync(id, ct);

    /// <summary>Enroll new TOTP factor</summary>
    public virtual Task<Dictionary<string, object?>> EnrollTotpAsync(CancellationToken ct = default)
        => _core.AuthMfaTotpEnrollAsync(ct);

    /// <summary>Confirm TOTP enrollment with code</summary>
    public virtual Task<Dictionary<string, object?>> VerifyTotpEnrollmentAsync(object? body = null, CancellationToken ct = default)
        => _core.AuthMfaTotpVerifyAsync(body, ct);

    /// <summary>Verify MFA code during signin</summary>
    public virtual Task<Dictionary<string, object?>> VerifyTotpAsync(object? body = null, CancellationToken ct = default)
        => _core.AuthMfaVerifyAsync(body, ct);

    /// <summary>Use recovery code during MFA signin</summary>
    public virtual Task<Dictionary<string, object?>> UseRecoveryCodeAsync(object? body = null, CancellationToken ct = default)
        => _core.AuthMfaRecoveryAsync(body, ct);

    /// <summary>Disable TOTP factor</summary>
    public virtual Task<Dictionary<string, object?>> DisableTotpAsync(object? body = null, CancellationToken ct = default)
        => _core.AuthMfaTotpDeleteAsync(body, ct);

    /// <summary>List MFA factors for authenticated user</summary>
    public virtual Task<Dictionary<string, object?>> ListFactorsAsync(CancellationToken ct = default)
        => _core.AuthMfaFactorsAsync(ct);

    /// <summary>Generate passkey registration options</summary>
    public virtual Task<Dictionary<string, object?>> PasskeysRegisterOptionsAsync(CancellationToken ct = default)
        => _core.AuthPasskeysRegisterOptionsAsync(ct);

    /// <summary>Verify and store passkey registration</summary>
    public virtual Task<Dictionary<string, object?>> PasskeysRegisterAsync(object? body = null, CancellationToken ct = default)
        => _core.AuthPasskeysRegisterAsync(body, ct);

    /// <summary>Generate passkey authentication options</summary>
    public virtual Task<Dictionary<string, object?>> PasskeysAuthOptionsAsync(object? body = null, CancellationToken ct = default)
        => _core.AuthPasskeysAuthOptionsAsync(body, ct);

    /// <summary>Authenticate with passkey</summary>
    public virtual Task<Dictionary<string, object?>> PasskeysAuthenticateAsync(object? body = null, CancellationToken ct = default)
        => _core.AuthPasskeysAuthenticateAsync(body, ct);

    /// <summary>List passkeys for authenticated user</summary>
    public virtual Task<Dictionary<string, object?>> PasskeysListAsync(CancellationToken ct = default)
        => _core.AuthPasskeysListAsync(ct);

    /// <summary>Delete a passkey</summary>
    public virtual Task<Dictionary<string, object?>> PasskeysDeleteAsync(string credentialId, CancellationToken ct = default)
        => _core.AuthPasskeysDeleteAsync(credentialId, ct);
}

/// <summary>
/// Storage wrapper methods (bucket-scoped)
/// </summary>
public class GeneratedStorageMethods
{
    protected readonly GeneratedDbApi _core;

    public GeneratedStorageMethods(GeneratedDbApi core)
    {
        _core = core;
    }

    /// <summary>Delete file</summary>
    public virtual Task<Dictionary<string, object?>> DeleteAsync(string bucket, string key, CancellationToken ct = default)
        => _core.DeleteFileAsync(bucket, key, ct);

    /// <summary>Batch delete files</summary>
    public virtual Task<Dictionary<string, object?>> DeleteManyAsync(string bucket, object? body = null, CancellationToken ct = default)
        => _core.DeleteBatchAsync(bucket, body, ct);

    /// <summary>Check if file exists</summary>
    public virtual Task<bool> ExistsAsync(string bucket, string key, CancellationToken ct = default)
        => _core.CheckFileExistsAsync(bucket, key, ct);

    /// <summary>Get file metadata</summary>
    public virtual Task<Dictionary<string, object?>> GetMetadataAsync(string bucket, string key, CancellationToken ct = default)
        => _core.GetFileMetadataAsync(bucket, key, ct);

    /// <summary>Update file metadata</summary>
    public virtual Task<Dictionary<string, object?>> UpdateMetadataAsync(string bucket, string key, object? body = null, CancellationToken ct = default)
        => _core.UpdateFileMetadataAsync(bucket, key, body, ct);

    /// <summary>Create signed download URL</summary>
    public virtual Task<Dictionary<string, object?>> CreateSignedUrlAsync(string bucket, object? body = null, CancellationToken ct = default)
        => _core.CreateSignedDownloadUrlAsync(bucket, body, ct);

    /// <summary>Batch create signed download URLs</summary>
    public virtual Task<Dictionary<string, object?>> CreateSignedUrlsAsync(string bucket, object? body = null, CancellationToken ct = default)
        => _core.CreateSignedDownloadUrlsAsync(bucket, body, ct);

    /// <summary>Create signed upload URL</summary>
    public virtual Task<Dictionary<string, object?>> CreateSignedUploadUrlAsync(string bucket, object? body = null, CancellationToken ct = default)
        => _core.CreateSignedUploadUrlAsync(bucket, body, ct);

    /// <summary>Start multipart upload</summary>
    public virtual Task<Dictionary<string, object?>> CreateMultipartUploadAsync(string bucket, object? body = null, CancellationToken ct = default)
        => _core.CreateMultipartUploadAsync(bucket, body, ct);

    /// <summary>Complete multipart upload</summary>
    public virtual Task<Dictionary<string, object?>> CompleteMultipartUploadAsync(string bucket, object? body = null, CancellationToken ct = default)
        => _core.CompleteMultipartUploadAsync(bucket, body, ct);

    /// <summary>Abort multipart upload</summary>
    public virtual Task<Dictionary<string, object?>> AbortMultipartUploadAsync(string bucket, object? body = null, CancellationToken ct = default)
        => _core.AbortMultipartUploadAsync(bucket, body, ct);
}

/// <summary>
/// Analytics wrapper methods
/// </summary>
public class GeneratedAnalyticsMethods
{
    protected readonly GeneratedDbApi _core;

    public GeneratedAnalyticsMethods(GeneratedDbApi core)
    {
        _core = core;
    }

    /// <summary>Track custom events</summary>
    public virtual Task<Dictionary<string, object?>> TrackAsync(object? body = null, CancellationToken ct = default)
        => _core.TrackEventsAsync(body, ct);
}

}
