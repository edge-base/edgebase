using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using EdgeBase.Generated;
// EdgeBase C# Admin SDK — D1 Client
// Cloudflare D1 데이터베이스 Raw SQL 실행. Service Key 전용.
// All HTTP calls delegate to Generated Admin Core (GeneratedAdminApi).
// No hardcoded API paths — the core is the single source of truth.

namespace EdgeBase.Admin
{

/// <summary>D1 데이터베이스 클라이언트.</summary>
public sealed class D1Client
{
    private readonly JbHttpClient _http;
    private readonly GeneratedAdminApi _adminCore;
    private readonly string _database;

    internal D1Client(JbHttpClient http, string database)
    {
        _http      = http;
        _adminCore = new GeneratedAdminApi(http);
        _database  = database;
    }

    /// <summary>SQL 쿼리 실행.</summary>
    /// <param name="query">SQL 쿼리 (? 바인드 변수 사용)</param>
    /// <param name="parameters">바인드 파라미터</param>
    /// <returns>결과 행 목록</returns>
    public async Task<List<Dictionary<string, object?>>> ExecAsync(
        string query, object[]? parameters = null, CancellationToken ct = default)
    {
        var body = new Dictionary<string, object?>
        {
            ["query"]  = query,
            ["params"] = parameters ?? Array.Empty<object>()
        };
        var result = await _adminCore.ExecuteD1QueryAsync(
            Uri.EscapeDataString(_database), body, ct);
        return JsonHelper.ExtractList(result, "results");
    }
}
}
