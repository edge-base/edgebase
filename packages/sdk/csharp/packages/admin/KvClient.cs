using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using EdgeBase.Generated;
// EdgeBase C# Admin SDK — KV Client
// Cloudflare KV 네임스페이스 접근. Service Key 전용.
// All HTTP calls delegate to Generated Admin Core (GeneratedAdminApi).
// No hardcoded API paths — the core is the single source of truth.

namespace EdgeBase.Admin
{

/// <summary>KV 네임스페이스 클라이언트.</summary>
public sealed class KvClient
{
    private readonly JbHttpClient _http;
    private readonly GeneratedAdminApi _adminCore;
    private readonly string _namespace;

    internal KvClient(JbHttpClient http, string ns)
    {
        _http      = http;
        _adminCore = new GeneratedAdminApi(http);
        _namespace = ns;
    }

    /// <summary>키 값 조회.</summary>
    public async Task<string?> GetAsync(string key, CancellationToken ct = default)
    {
        var body = new Dictionary<string, object?> { ["action"] = "get", ["key"] = key };
        var result = await _adminCore.KvOperationAsync(Uri.EscapeDataString(_namespace), body, ct);
        return JsonHelper.ExtractString(result, "value");
    }

    /// <summary>키 값 설정.</summary>
    /// <param name="key">키</param>
    /// <param name="value">값</param>
    /// <param name="ttl">TTL (초). null이면 영구 저장.</param>
    public Task<Dictionary<string, object?>> SetAsync(
        string key, string value, int? ttl = null, CancellationToken ct = default)
    {
        var body = new Dictionary<string, object?>
        {
            ["action"] = "set",
            ["key"]    = key,
            ["value"]  = value
        };
        if (ttl.HasValue) body["ttl"] = ttl.Value;
        return _adminCore.KvOperationAsync(Uri.EscapeDataString(_namespace), body, ct);
    }

    /// <summary>키 삭제.</summary>
    public Task<Dictionary<string, object?>> DeleteAsync(
        string key, CancellationToken ct = default)
    {
        var body = new Dictionary<string, object?> { ["action"] = "delete", ["key"] = key };
        return _adminCore.KvOperationAsync(Uri.EscapeDataString(_namespace), body, ct);
    }

    /// <summary>키 목록 조회.</summary>
    public async Task<KvListResult> ListAsync(
        string? prefix = null, int? limit = null, string? cursor = null,
        CancellationToken ct = default)
    {
        var body = new Dictionary<string, object?> { ["action"] = "list" };
        if (prefix != null) body["prefix"] = prefix;
        if (limit.HasValue) body["limit"] = limit.Value;
        if (cursor != null) body["cursor"] = cursor;

        var result = await _adminCore.KvOperationAsync(Uri.EscapeDataString(_namespace), body, ct);
        return new KvListResult(
            JsonHelper.ExtractStringList(result, "keys"),
            JsonHelper.ExtractString(result, "cursor"));
    }
}

/// <summary>KV 목록 조회 결과.</summary>
public sealed class KvListResult
{
    public List<string> Keys { get; }
    public string? Cursor { get; }

    public KvListResult(List<string> keys, string? cursor)
    {
        Keys   = keys;
        Cursor = cursor;
    }
}
}
