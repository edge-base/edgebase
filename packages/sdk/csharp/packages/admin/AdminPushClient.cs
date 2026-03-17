using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using EdgeBase.Generated;
// EdgeBase C# Admin SDK — Admin Push Client
// 서버사이드 푸시 알림 발송: send, sendMany, sendToToken, getTokens, getLogs.
// All HTTP calls delegate to Generated Admin Core (GeneratedAdminApi).
// No hardcoded API paths — the core is the single source of truth.

namespace EdgeBase.Admin
{

/// <summary>서버사이드 푸시 알림 발송 클라이언트.</summary>
public sealed class AdminPushClient
{
    private readonly JbHttpClient _http;
    private readonly GeneratedAdminApi _adminCore;

    internal AdminPushClient(JbHttpClient http)
    {
        _http = http;
        _adminCore = new GeneratedAdminApi(http);
    }

    /// <summary>특정 유저의 모든 디바이스에 푸시 발송.</summary>
    /// <returns>발송 결과 (sent, failed, removed)</returns>
    public async Task<PushResult> SendAsync(
        string userId, Dictionary<string, object?> payload,
        CancellationToken ct = default)
    {
        var body = new Dictionary<string, object?>
        {
            ["userId"]  = userId,
            ["payload"] = payload
        };
        var result = await _adminCore.PushSendAsync(body, ct);
        return PushResult.FromDict(result);
    }

    /// <summary>여러 유저에게 대량 발송.</summary>
    public async Task<PushResult> SendManyAsync(
        string[] userIds, Dictionary<string, object?> payload,
        CancellationToken ct = default)
    {
        var body = new Dictionary<string, object?>
        {
            ["userIds"] = userIds,
            ["payload"] = payload
        };
        var result = await _adminCore.PushSendManyAsync(body, ct);
        return PushResult.FromDict(result);
    }

    /// <summary>특정 디바이스 토큰에 발송.</summary>
    public async Task<PushResult> SendToTokenAsync(
        string token, Dictionary<string, object?> payload,
        string? platform = null, CancellationToken ct = default)
    {
        var body = new Dictionary<string, object?>
        {
            ["token"]    = token,
            ["payload"]  = payload,
            ["platform"] = platform ?? "web"
        };
        var result = await _adminCore.PushSendToTokenAsync(body, ct);
        return PushResult.FromDict(result);
    }

    /// <summary>유저의 등록된 디바이스 목록 조회 (토큰 값 미포함).</summary>
    public async Task<List<Dictionary<string, object?>>> GetTokensAsync(
        string userId, CancellationToken ct = default)
    {
        var query = new Dictionary<string, string> { ["userId"] = userId };
        var result = await _adminCore.GetPushTokensAsync(query, ct);
        var tokens = JsonHelper.ExtractList(result, "tokens");
        return tokens.Count > 0 ? tokens : JsonHelper.ExtractList(result, "items");
    }

    /// <summary>발송 로그 조회 (24시간 TTL).</summary>
    public async Task<List<Dictionary<string, object?>>> GetLogsAsync(
        string userId, int? limit = null, CancellationToken ct = default)
    {
        var query = new Dictionary<string, string> { ["userId"] = userId };
        if (limit.HasValue) query["limit"] = limit.Value.ToString();
        var result = await _adminCore.GetPushLogsAsync(query, ct);
        var logs = JsonHelper.ExtractList(result, "logs");
        return logs.Count > 0 ? logs : JsonHelper.ExtractList(result, "items");
    }

    /// <summary>FCM 토픽에 푸시 발송.</summary>
    public async Task<Dictionary<string, object?>> SendToTopicAsync(
        string topic, Dictionary<string, object?> payload,
        CancellationToken ct = default)
    {
        var body = new Dictionary<string, object?>
        {
            ["topic"]   = topic,
            ["payload"] = payload
        };
        return await _adminCore.PushSendToTopicAsync(body, ct);
    }

    /// <summary>전체 디바이스에 브로드캐스트.</summary>
    public async Task<Dictionary<string, object?>> BroadcastAsync(
        Dictionary<string, object?> payload,
        CancellationToken ct = default)
    {
        var body = new Dictionary<string, object?>
        {
            ["payload"] = payload
        };
        return await _adminCore.PushBroadcastAsync(body, ct);
    }
}

/// <summary>푸시 발송 결과.</summary>
public sealed class PushResult
{
    /// <summary>성공적으로 발송된 수.</summary>
    public int Sent { get; }
    /// <summary>발송 실패 수.</summary>
    public int Failed { get; }
    /// <summary>만료/삭제된 토큰 수 (자동 정리됨).</summary>
    public int Removed { get; }

    public PushResult(int sent, int failed, int removed)
    {
        Sent    = sent;
        Failed  = failed;
        Removed = removed;
    }

    internal static PushResult FromDict(Dictionary<string, object?> dict)
    {
        return new PushResult(
            JsonHelper.ExtractInt(dict, "sent"),
            JsonHelper.ExtractInt(dict, "failed"),
            JsonHelper.ExtractInt(dict, "removed"));
    }
}
}
