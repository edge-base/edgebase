using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using EdgeBase.Generated;
// EdgeBase C# Admin SDK — AdminAuth
// 서버사이드 유저 관리: CRUD, 커스텀 클레임, 세션 무효화.
// All HTTP calls delegate to Generated Admin Core (GeneratedAdminApi).
// No hardcoded API paths — the core is the single source of truth.

namespace EdgeBase.Admin
{

/// <summary>서버사이드 유저 관리 클라이언트.</summary>
public sealed class AdminAuthClient
{
    private readonly JbHttpClient _http;
    private readonly GeneratedAdminApi _adminCore;

    internal AdminAuthClient(JbHttpClient http)
    {
        _http = http;
        _adminCore = new GeneratedAdminApi(http);
    }

    /// <summary>유저 조회.</summary>
    public async Task<Dictionary<string, object?>> GetUserAsync(
        string userId, CancellationToken ct = default)
    {
        var result = await _adminCore.AdminAuthGetUserAsync(Uri.EscapeDataString(userId), ct);
        return JsonHelper.ExtractNested(result, "user");
    }

    /// <summary>유저 목록 조회 (커서 페이지네이션).</summary>
    public async Task<ListUsersResult> ListUsersAsync(
        int? limit = null, string? cursor = null, CancellationToken ct = default)
    {
        var query = new Dictionary<string, string>();
        if (limit.HasValue) query["limit"] = limit.Value.ToString();
        if (!string.IsNullOrEmpty(cursor)) query["cursor"] = cursor!;

        var result = await _adminCore.AdminAuthListUsersAsync(
            query.Count > 0 ? query : null, ct);
        return new ListUsersResult(
            JsonHelper.ExtractList(result, "users"),
            JsonHelper.ExtractString(result, "cursor"));
    }

    /// <summary>유저 생성 (서버사이드 가입).</summary>
    public async Task<Dictionary<string, object?>> CreateUserAsync(
        string email, string password, string? displayName = null, string? role = null,
        CancellationToken ct = default)
    {
        var body = new Dictionary<string, object?> { ["email"] = email, ["password"] = password };
        if (displayName != null) body["displayName"] = displayName;
        if (role != null) body["role"] = role;

        var result = await _adminCore.AdminAuthCreateUserAsync(body, ct);
        return JsonHelper.ExtractNested(result, "user");
    }

    /// <summary>유저 정보 수정.</summary>
    public async Task<Dictionary<string, object?>> UpdateUserAsync(
        string userId, Dictionary<string, object?> data, CancellationToken ct = default)
    {
        var result = await _adminCore.AdminAuthUpdateUserAsync(
            Uri.EscapeDataString(userId), data, ct);
        return JsonHelper.ExtractNested(result, "user");
    }

    /// <summary>유저 삭제.</summary>
    public Task<Dictionary<string, object?>> DeleteUserAsync(
        string userId, CancellationToken ct = default)
    {
        return _adminCore.AdminAuthDeleteUserAsync(Uri.EscapeDataString(userId), ct);
    }

    /// <summary>커스텀 클레임 설정 (다음 JWT 갱신 시 반영).</summary>
    public Task<Dictionary<string, object?>> SetCustomClaimsAsync(
        string userId, Dictionary<string, object?> claims, CancellationToken ct = default)
    {
        return _adminCore.AdminAuthSetClaimsAsync(
            Uri.EscapeDataString(userId), claims, ct);
    }

    /// <summary>유저의 전체 세션 무효화 (강제 재인증).</summary>
    public Task<Dictionary<string, object?>> RevokeAllSessionsAsync(
        string userId, CancellationToken ct = default)
    {
        return _adminCore.AdminAuthRevokeUserSessionsAsync(
            Uri.EscapeDataString(userId), ct);
    }

    /// <summary>유저의 MFA 비활성화 (관리자 전용, Service Key 필요).</summary>
    public Task<Dictionary<string, object?>> DisableMfaAsync(
        string userId, CancellationToken ct = default)
    {
        return _adminCore.AdminAuthDeleteUserMfaAsync(
            Uri.EscapeDataString(userId), ct);
    }
}

/// <summary>유저 목록 조회 결과.</summary>
public sealed class ListUsersResult
{
    public List<Dictionary<string, object?>> Users { get; }
    public string? Cursor { get; }

    public ListUsersResult(List<Dictionary<string, object?>> users, string? cursor)
    {
        Users  = users;
        Cursor = cursor;
    }
}
}
