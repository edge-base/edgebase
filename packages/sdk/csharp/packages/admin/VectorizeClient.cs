using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using EdgeBase.Generated;
// EdgeBase C# Admin SDK — Vectorize Client
// Cloudflare Vectorize 인덱스 접근. Service Key 전용.
// All HTTP calls delegate to Generated Admin Core (GeneratedAdminApi).
// No hardcoded API paths — the core is the single source of truth.

namespace EdgeBase.Admin
{

/// <summary>Vectorize 인덱스 클라이언트.</summary>
public sealed class VectorizeClient
{
    private readonly JbHttpClient _http;
    private readonly GeneratedAdminApi _adminCore;
    private readonly string _index;

    internal VectorizeClient(JbHttpClient http, string index)
    {
        _http      = http;
        _adminCore = new GeneratedAdminApi(http);
        _index     = index;
    }

    /// <summary>벡터 Upsert (삽입/갱신).</summary>
    public Task<Dictionary<string, object?>> UpsertAsync(
        VectorInput[] vectors, CancellationToken ct = default)
    {
        var body = new Dictionary<string, object?>
        {
            ["action"]  = "upsert",
            ["vectors"] = vectors
        };
        return _adminCore.VectorizeOperationAsync(Uri.EscapeDataString(_index), body, ct);
    }

    /// <summary>벡터 Insert (중복 ID 시 409 에러).</summary>
    public Task<Dictionary<string, object?>> InsertAsync(
        VectorInput[] vectors, CancellationToken ct = default)
    {
        var body = new Dictionary<string, object?>
        {
            ["action"]  = "insert",
            ["vectors"] = vectors
        };
        return _adminCore.VectorizeOperationAsync(Uri.EscapeDataString(_index), body, ct);
    }

    /// <summary>유사도 검색.</summary>
    /// <param name="vector">쿼리 벡터</param>
    /// <param name="topK">반환할 최대 결과 수</param>
    /// <param name="filter">메타데이터 필터 (선택)</param>
    /// <param name="ns">네임스페이스 (선택)</param>
    /// <param name="returnValues">벡터 값 반환 여부 (선택)</param>
    /// <param name="returnMetadata">메타데이터 반환 수준: all, indexed, none (선택)</param>
    public async Task<List<VectorMatch>> SearchAsync(
        double[] vector, int topK = 10,
        Dictionary<string, object?>? filter = null,
        string? ns = null,
        bool? returnValues = null,
        string? returnMetadata = null,
        CancellationToken ct = default)
    {
        var body = new Dictionary<string, object?>
        {
            ["action"] = "search",
            ["vector"] = vector,
            ["topK"]   = topK
        };
        if (filter != null) body["filter"] = filter;
        if (ns != null) body["namespace"] = ns;
        if (returnValues != null) body["returnValues"] = returnValues;
        if (returnMetadata != null) body["returnMetadata"] = returnMetadata;

        var result = await _adminCore.VectorizeOperationAsync(
            Uri.EscapeDataString(_index), body, ct);
        return JsonHelper.ExtractVectorMatches(result, "matches");
    }

    /// <summary>기존 벡터 ID로 유사도 검색 (Vectorize v2 전용).</summary>
    public async Task<List<VectorMatch>> QueryByIdAsync(
        string vectorId, int topK = 10,
        Dictionary<string, object?>? filter = null,
        string? ns = null,
        bool? returnValues = null,
        string? returnMetadata = null,
        CancellationToken ct = default)
    {
        var body = new Dictionary<string, object?>
        {
            ["action"]   = "queryById",
            ["vectorId"] = vectorId,
            ["topK"]     = topK
        };
        if (filter != null) body["filter"] = filter;
        if (ns != null) body["namespace"] = ns;
        if (returnValues != null) body["returnValues"] = returnValues;
        if (returnMetadata != null) body["returnMetadata"] = returnMetadata;

        var result = await _adminCore.VectorizeOperationAsync(
            Uri.EscapeDataString(_index), body, ct);
        return JsonHelper.ExtractVectorMatches(result, "matches");
    }

    /// <summary>ID로 벡터 조회.</summary>
    public async Task<List<VectorResult>> GetByIdsAsync(
        string[] ids, CancellationToken ct = default)
    {
        var body = new Dictionary<string, object?>
        {
            ["action"] = "getByIds",
            ["ids"]    = ids
        };
        var result = await _adminCore.VectorizeOperationAsync(
            Uri.EscapeDataString(_index), body, ct);
        return JsonHelper.ExtractVectorResults(result, "vectors");
    }

    /// <summary>벡터 삭제.</summary>
    public Task<Dictionary<string, object?>> DeleteAsync(
        string[] ids, CancellationToken ct = default)
    {
        var body = new Dictionary<string, object?>
        {
            ["action"] = "delete",
            ["ids"]    = ids
        };
        return _adminCore.VectorizeOperationAsync(Uri.EscapeDataString(_index), body, ct);
    }

    /// <summary>인덱스 정보 조회 (벡터 수, 차원, 메트릭).</summary>
    public async Task<IndexInfo> DescribeAsync(CancellationToken ct = default)
    {
        var body = new Dictionary<string, object?>
        {
            ["action"] = "describe"
        };
        var result = await _adminCore.VectorizeOperationAsync(
            Uri.EscapeDataString(_index), body, ct);
        return JsonHelper.ExtractIndexInfo(result);
    }
}

/// <summary>Upsert용 벡터 입력.</summary>
public sealed class VectorInput
{
    public string Id { get; set; } = "";
    public double[] Values { get; set; } = Array.Empty<double>();
    public Dictionary<string, object?>? Metadata { get; set; }
    public string? Namespace { get; set; }
}

/// <summary>검색 결과 벡터 매치.</summary>
public sealed class VectorMatch
{
    public string Id { get; set; } = "";
    public double Score { get; set; }
    public double[]? Values { get; set; }
    public Dictionary<string, object?>? Metadata { get; set; }
    public string? Namespace { get; set; }
}

/// <summary>getByIds 결과 벡터.</summary>
public sealed class VectorResult
{
    public string Id { get; set; } = "";
    public double[]? Values { get; set; }
    public Dictionary<string, object?>? Metadata { get; set; }
    public string? Namespace { get; set; }
}

/// <summary>describe 결과 인덱스 정보.</summary>
public sealed class IndexInfo
{
    public long VectorCount { get; set; }
    public int Dimensions { get; set; }
    public string Metric { get; set; } = "";
    public string? Id { get; set; }
    public string? Name { get; set; }
}
}
