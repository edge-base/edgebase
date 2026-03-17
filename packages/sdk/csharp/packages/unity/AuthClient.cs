using System;
using System.Collections.Generic;
using System.Text.Json;
using EdgeBase.Generated;
// EdgeBase C# Unity SDK — AuthClient
// Unity 클라이언트 전용 인증 — signUp, signIn, signOut, signInAnonymously,
// signInWithMagicLink, verifyMagicLink, signInWithOAuth, linkWithEmail, linkWithOAuth,
// updateProfile, verifyEmail, requestPasswordReset,
// resetPassword, changePassword, listSessions, revokeSession.
// All HTTP calls delegate to Generated Core (GeneratedDbApi).
// No hardcoded API paths — the core is the single source of truth.

namespace EdgeBase
{

/// <summary>
/// Unity 클라이언트 전용 Auth 클라이언트.
/// <para>현재 사용자 토큰을 내부에서 관리합니다.</para>
/// </summary>
public sealed class AuthClient
{
    public sealed class PasskeysAuthOptions
    {
        public string? Email { get; set; }

        internal Dictionary<string, object?> ToBody()
        {
            var body = new Dictionary<string, object?>();
            if (!string.IsNullOrEmpty(Email))
            {
                body["email"] = Email;
            }
            return body;
        }
    }

    private readonly JbHttpClient _http;
    private readonly GeneratedDbApi _core;
    private readonly GeneratedAuthMethods _authMethods;
    private static readonly JsonSerializerOptions JsonOpts =
        new JsonSerializerOptions(JsonSerializerDefaults.Web);

    /// <summary>현재 엑세스 토큰 (로그인 상태면 비어있지 않음).</summary>
    public string? CurrentToken { get; private set; }

    /// <summary>
    /// Auth 상태가 변경될 때 발생합니다 (signIn, signUp, signOut, token restore).
    /// <para>이벤트 인자는 현재 사용자 정보 Dictionary (로그아웃 시 null).</para>
    /// </summary>
    public event Action<Dictionary<string, object?>?>? OnAuthStateChange;

    internal AuthClient(JbHttpClient http)
    {
        _http = http;
        _core = new GeneratedDbApi(http);
        _authMethods = new GeneratedAuthMethods(_core);
    }

    // ── 내부 토큰 적용 ────────────────────────────────────────────
    private void ApplyToken(string? token, Dictionary<string, object?>? user = null)
    {
        CurrentToken = token;
        _http.SetToken(token);
        OnAuthStateChange?.Invoke(user);
    }

    private void ApplyAuthTokens(Dictionary<string, object?> result)
    {
        ApplyToken(result.TryGetValue("accessToken", out var t) ? t?.ToString() : null, result);
        _http.SetRefreshToken(result.TryGetValue("refreshToken", out var rt) ? rt?.ToString() : null);
    }

    // ── Sign Up / In / Out ────────────────────────────────────────

    /// <summary>이메일+비밀번호로 회원가입합니다.</summary>
    /// <param name="captchaToken">Captcha token. null이면 전송하지 않습니다.</param>
    public async System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        SignUpAsync(string email, string password,
            System.Collections.Generic.Dictionary<string, object?>? userData = null,
            string? captchaToken = null)
    {
        var body = new Dictionary<string, object?> { ["email"] = email, ["password"] = password };
        if (userData != null) body["data"] = userData;
        //: auto-acquire captcha token
        var resolved = await TurnstileProvider.ResolveCaptchaTokenAsync(_http.BaseUrl, "signup", captchaToken);
        if (resolved != null) body["captchaToken"] = resolved;
        var result = await _core.AuthSignupAsync(body);
        ApplyAuthTokens(result);
        return result;
    }

    /// <summary>이메일+비밀번호로 로그인합니다. MFA가 활성화된 경우 mfaRequired=true를 포함한 결과를 반환합니다.</summary>
    /// <param name="captchaToken">Captcha token.</param>
    public async System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        SignInAsync(string email, string password, string? captchaToken = null)
    {
        var body = new Dictionary<string, object?> { ["email"] = email, ["password"] = password };
        //: auto-acquire captcha token
        var resolved = await TurnstileProvider.ResolveCaptchaTokenAsync(_http.BaseUrl, "signin", captchaToken);
        if (resolved != null) body["captchaToken"] = resolved;
        var result = await _core.AuthSigninAsync(body);
        // If MFA is required, return result without setting tokens
        if (result.TryGetValue("mfaRequired", out var mfa) && mfa is true)
            return result;
        ApplyAuthTokens(result);
        return result;
    }

    /// <summary>리프레시 토큰으로 세션을 갱신합니다.</summary>
    public async System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        RefreshTokenAsync(System.Threading.CancellationToken ct = default)
    {
        var refreshToken = _http.GetRefreshToken();
        var body = string.IsNullOrEmpty(refreshToken)
            ? null
            : new Dictionary<string, object?> { ["refreshToken"] = refreshToken };
        var result = await _core.AuthRefreshAsync(body, ct);
        ApplyAuthTokens(result);
        return result;
    }

    /// <summary>로그아웃합니다.</summary>
    public async System.Threading.Tasks.Task SignOutAsync()
    {
        // Auto-unregister push token
        try
        {
            var push = new PushClient(_http);
            await push.UnregisterAsync();
        }
        catch { }

        try
        {
            var refreshToken = _http.GetRefreshToken();
            await _core.AuthSignoutAsync(new { refreshToken });
        }
        finally
        {
            ApplyToken(null, null);
            _http.SetRefreshToken(null);
        }
    }

    /// <summary>익명 로그인합니다.</summary>
    /// <param name="captchaToken">Captcha token.</param>
    public async System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        SignInAnonymouslyAsync(string? captchaToken = null)
    {
        var body = new Dictionary<string, object?>{};
        //: auto-acquire captcha token
        var resolved = await TurnstileProvider.ResolveCaptchaTokenAsync(_http.BaseUrl, "anonymous", captchaToken);
        if (resolved != null) body["captchaToken"] = resolved;
        var result = await _core.AuthSigninAnonymousAsync(body.Count > 0 ? body : null);
        ApplyAuthTokens(result);
        return result;
    }

    /// <summary>현재 인증된 사용자 정보를 반환합니다.</summary>
    public async System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        GetUserAsync(System.Threading.CancellationToken ct = default) =>
        ExtractNested(await _core.AuthGetMeAsync(ct), "user");

    // ── OAuth ─────────────────────────────────────────────────────

    /// <summary>OAuth 로그인 시작 URL을 반환합니다 (브라우저/WebView에서 열기).</summary>
    /// <param name="captchaToken">Captcha token.</param>
    public string SignInWithOAuth(string provider, string redirectUrl = "", string? captchaToken = null)
    {
        // URL construction only — no HTTP call, so no delegation needed.
        var qs = string.IsNullOrEmpty(redirectUrl)
            ? ""
            : $"?redirectUrl={System.Uri.EscapeDataString(redirectUrl)}";
        var url = $"{_http.BaseUrl}/api/auth/oauth/{provider}{qs}";
        if (captchaToken != null)
        {
            var sep = string.IsNullOrEmpty(qs) ? "?" : "&";
            url += $"{sep}captcha_token={System.Uri.EscapeDataString(captchaToken)}";
        }
        return url;
    }

    /// <summary>OAuth 로그인 시작 URL을 객체 형태로 반환합니다.</summary>
    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        SignInWithOAuthAsync(string provider, string redirectUrl = "", string? captchaToken = null)
    {
        var url = SignInWithOAuth(provider, redirectUrl, captchaToken);
        return System.Threading.Tasks.Task.FromResult(new Dictionary<string, object?>
        {
            ["url"] = url,
            ["redirectUrl"] = url,
        });
    }

    // ── Magic Link ──────────────────────────────────────────────

    /// <summary>매직 링크 이메일을 전송합니다 (로그인용).</summary>
    /// <param name="captchaToken">Captcha token.</param>
    public async System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        SignInWithMagicLinkAsync(string email, string? captchaToken = null)
    {
        var body = new Dictionary<string, object?> { ["email"] = email };
        //: auto-acquire captcha token
        var resolved = await TurnstileProvider.ResolveCaptchaTokenAsync(_http.BaseUrl, "magic-link", captchaToken);
        if (resolved != null) body["captchaToken"] = resolved;
        return await _core.AuthSigninMagicLinkAsync(body);
    }

    /// <summary>매직 링크 토큰을 검증하고 로그인합니다.</summary>
    public async System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        VerifyMagicLinkAsync(string token)
    {
        var result = await _core.AuthVerifyMagicLinkAsync(new { token });
        ApplyAuthTokens(result);
        return result;
    }

    // ── Phone / SMS Auth ──────────────────────────────────────────

    /// <summary>SMS 인증 코드를 전송합니다 (로그인용).</summary>
    public async System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        SignInWithPhoneAsync(string phone, string? captchaToken = null)
    {
        var body = new Dictionary<string, object?> { ["phone"] = phone };
        var resolved = await TurnstileProvider.ResolveCaptchaTokenAsync(_http.BaseUrl, "phone", captchaToken);
        if (resolved != null) body["captchaToken"] = resolved;
        return await _core.AuthSigninPhoneAsync(body);
    }

    /// <summary>SMS 코드를 검증하고 로그인합니다.</summary>
    public async System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        VerifyPhoneAsync(string phone, string code)
    {
        var body = new Dictionary<string, object?> { ["phone"] = phone, ["code"] = code };
        var result = await _core.AuthVerifyPhoneAsync(body);
        ApplyAuthTokens(result);
        return result;
    }

    /// <summary>이메일 OTP 코드를 전송합니다.</summary>
    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        SignInWithEmailOtpAsync(string email, System.Threading.CancellationToken ct = default) =>
        _authMethods.SignInWithEmailOtpAsync(new Dictionary<string, object?> { ["email"] = email }, ct);

    /// <summary>이메일 OTP 코드를 검증하고 로그인합니다.</summary>
    public async System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        VerifyEmailOtpAsync(string email, string code, System.Threading.CancellationToken ct = default)
    {
        var result = await _authMethods.VerifyEmailOtpAsync(
            new Dictionary<string, object?> { ["email"] = email, ["code"] = code }, ct);
        ApplyAuthTokens(result);
        return result;
    }

    /// <summary>현재 계정에 전화번호를 연결합니다. SMS 코드를 전송합니다.</summary>
    public async System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        LinkWithPhoneAsync(string phone)
    {
        var body = new Dictionary<string, object?> { ["phone"] = phone };
        return await _core.AuthLinkPhoneAsync(body);
    }

    /// <summary>전화번호 연결 코드를 검증합니다.</summary>
    public async System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        VerifyLinkPhoneAsync(string phone, string code)
    {
        var body = new Dictionary<string, object?> { ["phone"] = phone, ["code"] = code };
        return await _core.AuthVerifyLinkPhoneAsync(body);
    }

    /// <summary>익명 계정을 이메일/비밀번호 계정으로 연결합니다.</summary>
    public async System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        LinkWithEmailAsync(string email, string password)
    {
        var result = await _core.AuthLinkEmailAsync(new { email, password });
        if (result.ContainsKey("accessToken")) ApplyAuthTokens(result);
        return result;
    }

    /// <summary>익명 계정을 OAuth 제공자에 연결합니다. 리다이렉트 URL 반환.</summary>
    public string LinkWithOAuth(string provider, string redirectUrl = "")
    {
        // URL construction only — no HTTP call, so no delegation needed.
        var qs = string.IsNullOrEmpty(redirectUrl)
            ? ""
            : $"?redirectUrl={System.Uri.EscapeDataString(redirectUrl)}";
        return $"{_http.BaseUrl}/api/auth/link/oauth/{provider}{qs}";
    }

    /// <summary>OAuth 연결 시작 URL을 객체 형태로 반환합니다.</summary>
    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        LinkOAuthAsync(string provider, string redirectUrl = "")
    {
        var url = LinkWithOAuth(provider, redirectUrl);
        return System.Threading.Tasks.Task.FromResult(new Dictionary<string, object?>
        {
            ["url"] = url,
            ["redirectUrl"] = url,
        });
    }

    // ── Profile ───────────────────────────────────────────────────

    /// <summary>프로필(displayName 또는 avatarUrl)을 수정합니다.</summary>
    public async System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        UpdateProfileAsync(System.Collections.Generic.Dictionary<string, object?> data)
    {
        var result = await _core.AuthUpdateProfileAsync(data);
        if (result.ContainsKey("accessToken")) ApplyAuthTokens(result);
        return result;
    }

    // ── Session Management ────────────────────────────────────────

    /// <summary>현재 사용자의 활성 세션 목록을 반환합니다.</summary>
    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        ListSessionsAsync() => _core.AuthGetSessionsAsync();

    /// <summary>특정 세션을 만료시킵니다.</summary>
    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        RevokeSessionAsync(string sessionId) =>
        _core.AuthDeleteSessionAsync(sessionId);

    /// <summary>현재 사용자의 연결된 로그인 identity 목록을 반환합니다.</summary>
    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        ListIdentitiesAsync(System.Threading.CancellationToken ct = default) =>
        _core.AuthGetIdentitiesAsync(ct);

    /// <summary>연결된 OAuth identity를 해제합니다.</summary>
    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        UnlinkIdentityAsync(string identityId, System.Threading.CancellationToken ct = default) =>
        _core.AuthDeleteIdentityAsync(identityId, ct);

    // ── Email Verification ────────────────────────────────────────

    /// <summary>이메일 인증을 완료합니다.</summary>
    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        VerifyEmailAsync(string token) =>
        _core.AuthVerifyEmailAsync(new { token });

    /// <summary>이메일 변경 인증을 완료합니다.</summary>
    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        VerifyEmailChangeAsync(string token) =>
        _core.AuthVerifyEmailChangeAsync(new { token });

    /// <summary>이메일 인증 메일을 요청합니다.</summary>
    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        RequestEmailVerificationAsync(string? redirectUrl = null)
    {
        var body = string.IsNullOrEmpty(redirectUrl)
            ? null
            : new Dictionary<string, object?> { ["redirectUrl"] = redirectUrl };
        return _core.AuthRequestEmailVerificationAsync(body);
    }

    // ── Password Reset ────────────────────────────────────────────

    /// <summary>비밀번호 재설정 이메일을 요청합니다.</summary>
    /// <param name="captchaToken">Captcha token.</param>
    public async System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        RequestPasswordResetAsync(string email, string? captchaToken = null)
    {
        var body = new Dictionary<string, object?> { ["email"] = email };
        //: auto-acquire captcha token
        var resolved = await TurnstileProvider.ResolveCaptchaTokenAsync(_http.BaseUrl, "password-reset", captchaToken);
        if (resolved != null) body["captchaToken"] = resolved;
        return await _core.AuthRequestPasswordResetAsync(body);
    }

    /// <summary>재설정 토큰으로 비밀번호를 변경합니다.</summary>
    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        ResetPasswordAsync(string token, string newPassword) =>
        _core.AuthResetPasswordAsync(new { token, newPassword });

    // ── Change Password ───────────────────────────────────────────

    /// <summary>현재 비밀번호를 확인 후 변경합니다 (익명 계정은 불가).</summary>
    public async System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        ChangePasswordAsync(string currentPassword, string newPassword)
    {
        var result = await _core.AuthChangePasswordAsync(
            new { currentPassword, newPassword });
        if (result.ContainsKey("accessToken")) ApplyAuthTokens(result);
        return result;
    }

    /// <summary>현재 사용자 이메일 변경을 요청합니다.</summary>
    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        ChangeEmailAsync(string newEmail, string? password = null, string? redirectUrl = null)
    {
        var body = new Dictionary<string, object?> { ["newEmail"] = newEmail };
        if (!string.IsNullOrEmpty(password)) body["password"] = password;
        if (!string.IsNullOrEmpty(redirectUrl)) body["redirectUrl"] = redirectUrl;
        return _core.AuthChangeEmailAsync(body);
    }

    // ── Passkeys / WebAuthn REST layer ─────────────────────────────

    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        PasskeysRegisterOptionsAsync(System.Threading.CancellationToken ct = default) =>
        _authMethods.PasskeysRegisterOptionsAsync(ct: ct);

    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        PasskeysRegisterAsync(object response, System.Threading.CancellationToken ct = default) =>
        _authMethods.PasskeysRegisterAsync(new { response }, ct);

    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        PasskeysAuthOptionsAsync(string? email = null, System.Threading.CancellationToken ct = default) =>
        PasskeysAuthOptionsAsync(new PasskeysAuthOptions { Email = email }, ct);

    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        PasskeysAuthOptionsAsync(PasskeysAuthOptions options, System.Threading.CancellationToken ct = default) =>
        _authMethods.PasskeysAuthOptionsAsync(options.ToBody(), ct);

    public async System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        PasskeysAuthenticateAsync(object response, System.Threading.CancellationToken ct = default)
    {
        var result = await _authMethods.PasskeysAuthenticateAsync(new { response }, ct);
        ApplyAuthTokens(result);
        return result;
    }

    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        PasskeysListAsync(System.Threading.CancellationToken ct = default) =>
        _authMethods.PasskeysListAsync(ct);

    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        PasskeysDeleteAsync(string credentialId, System.Threading.CancellationToken ct = default) =>
        _authMethods.PasskeysDeleteAsync(credentialId, ct);

    // ── MFA / TOTP ─────────────────────────────────────────────────

    /// <summary>TOTP 등록 — factorId, secret, qrCodeUri, recoveryCodes를 반환합니다.</summary>
    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        EnrollTotpAsync() =>
        _core.AuthMfaTotpEnrollAsync();

    /// <summary>TOTP 등록 확인 — factorId와 TOTP 코드로 검증합니다.</summary>
    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        VerifyTotpEnrollmentAsync(string factorId, string code) =>
        _core.AuthMfaTotpVerifyAsync(new { factorId, code });

    /// <summary>MFA 챌린지 중 TOTP 코드 검증 (signIn이 mfaRequired를 반환한 후).</summary>
    public async System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        VerifyTotpAsync(string mfaTicket, string code)
    {
        var result = await _core.AuthMfaVerifyAsync(
            new { mfaTicket, code });
        ApplyToken(result.TryGetValue("accessToken", out var t) ? t?.ToString() : null, result);
        _http.SetRefreshToken(result.TryGetValue("refreshToken", out var rt) ? rt?.ToString() : null);
        return result;
    }

    /// <summary>MFA 챌린지 중 복구 코드 사용.</summary>
    public async System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        UseRecoveryCodeAsync(string mfaTicket, string recoveryCode)
    {
        var result = await _core.AuthMfaRecoveryAsync(
            new { mfaTicket, recoveryCode });
        ApplyToken(result.TryGetValue("accessToken", out var t) ? t?.ToString() : null, result);
        _http.SetRefreshToken(result.TryGetValue("refreshToken", out var rt) ? rt?.ToString() : null);
        return result;
    }

    /// <summary>현재 사용자의 TOTP 비활성화. 비밀번호 또는 TOTP 코드 필요.</summary>
    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        DisableTotpAsync(string? password = null, string? code = null)
    {
        var body = new Dictionary<string, object?>();
        if (password != null) body["password"] = password;
        if (code != null) body["code"] = code;
        return _core.AuthMfaTotpDeleteAsync(body.Count == 0 ? null : body);
    }

    /// <summary>현재 사용자의 등록된 MFA factor 목록 조회.</summary>
    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>>
        ListFactorsAsync() =>
        _core.AuthMfaFactorsAsync();

    // ── Helpers ───────────────────────────────────────────────────

    /// <summary>현재 엑세스 토큰 반환 (미로그인 시 null).</summary>
    public string? GetAccessToken() => CurrentToken;

    /// <summary>앱 재시작 시 저장된 토큰으로 복원 (Unity PlayerPrefs 활용 가능).</summary>
    public void SetAccessToken(string? token) => ApplyToken(token);

    private static Dictionary<string, object?> ExtractNested(Dictionary<string, object?> dict, string key)
    {
        if (dict.TryGetValue(key, out var value) && value is JsonElement element
            && element.ValueKind == JsonValueKind.Object)
        {
            return JsonSerializer.Deserialize<Dictionary<string, object?>>(
                element.GetRawText(), JsonOpts) ?? new Dictionary<string, object?>();
        }
        return dict;
    }

    private static List<Dictionary<string, object?>> ExtractList(Dictionary<string, object?> dict, string key)
    {
        if (dict.TryGetValue(key, out var value) && value is JsonElement element
            && element.ValueKind == JsonValueKind.Array)
        {
            return JsonSerializer.Deserialize<List<Dictionary<string, object?>>>(
                element.GetRawText(), JsonOpts) ?? new List<Dictionary<string, object?>>();
        }
        return new List<Dictionary<string, object?>>();
    }
}
}
