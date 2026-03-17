using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using EdgeBase.Generated;
// EdgeBase C# Admin SDK — 서버사이드 진입점
// Service Key 인증 기반. ASP.NET Core, Unity Server, .NET MAUI, Blazor 등에서 사용.
// All HTTP calls delegate to Generated Core (GeneratedDbApi / GeneratedAdminApi).
// No hardcoded API paths — the core is the single source of truth.
//: C# Admin SDK 추가

namespace EdgeBase.Admin
{

/// <summary>
/// EdgeBase Admin SDK 진입점.
/// Service Key를 사용하여 보안 규칙을 바이패스하고 서버사이드 관리 기능에 접근합니다.
/// </summary>
public sealed class AdminClient : IDisposable
{
    private readonly JbHttpClient _http;
    private readonly GeneratedDbApi _core;
    private readonly GeneratedAdminApi _adminCore;

    /// <summary>EdgeBase Admin 클라이언트 생성.</summary>
    /// <param name="url">EdgeBase 서버 URL (예: https://my-app.edgebase.fun)</param>
    /// <param name="serviceKey">Service Key (for example, Environment.GetEnvironmentVariable("EDGEBASE_SERVICE_KEY")).</param>
    public AdminClient(string url, string serviceKey)
    {
        if (string.IsNullOrWhiteSpace(url))
            throw new ArgumentException("url is required.", nameof(url));
        if (string.IsNullOrWhiteSpace(serviceKey))
            throw new ArgumentException("serviceKey is required.", nameof(serviceKey));

        _http = new JbHttpClient(url);
        _http.SetServiceKey(serviceKey);
        _core = new GeneratedDbApi(_http);
        _adminCore = new GeneratedAdminApi(_http);

        AdminAuth = new AdminAuthClient(_http);
        Storage   = new StorageClient(_http);
        Push      = new AdminPushClient(_http);
        Functions = new FunctionsClient(_http);
        Analytics = new AnalyticsClient(_core, _adminCore);
    }

    /// <summary>서버사이드 유저 관리 (CRUD, 커스텀 클레임, 세션 관리).</summary>
    public AdminAuthClient AdminAuth { get; }

    /// <summary>파일 스토리지 (R2 기반).</summary>
    public StorageClient Storage { get; }

    /// <summary>서버사이드 푸시 알림 발송.</summary>
    public AdminPushClient Push { get; }

    /// <summary>App Functions 호출.</summary>
    public FunctionsClient Functions { get; }

    /// <summary>요청 메트릭 조회 및 커스텀 이벤트 추적.</summary>
    public AnalyticsClient Analytics { get; }

    /// <summary>테이블 접근 (보안 규칙 바이패스).</summary>
    public TableRef Table(string name) => new TableRef(_core, name);

    /// <summary>DB 네임스페이스 + 인스턴스 ID로 TableRef를 반환합니다 (#133 §2).</summary>
    public DbRef Db(string ns, string? instanceId = null)
        => new DbRef(_core, ns, instanceId);

    /// <summary>하위 호환성 별칭 — Table() 사용 권장.</summary>
    [Obsolete("Use Table() instead.")]
    public TableRef Collection(string name) => Table(name);


    /// <summary>Raw SQL 실행 (DO SQLite).</summary>
    /// <param name="namespaceName">DB 네임스페이스 (namespace:id 형식 — 어떤 DO에서 실행할지 지정)</param>
    /// <param name="query">SQL 쿼리 (파라미터화 필수)</param>
    /// <param name="parameters">바인드 파라미터</param>
    public async Task<List<Dictionary<string, object?>>> SqlAsync(
        string namespaceName, string query, object[]? parameters = null,
        CancellationToken ct = default)
    {
        var parts = namespaceName.Split(':', 2);
        var body = new Dictionary<string, object?>
        {
            ["namespace"] = parts[0],
            ["sql"]       = query,
            ["params"]    = parameters ?? Array.Empty<object>()
        };
        if (parts.Length > 1)
            body["id"] = parts[1];
        var result = await _adminCore.ExecuteSqlAsync(body, ct);
        return JsonHelper.ExtractList(result, "rows");
    }

    /// <summary>서버사이드 Broadcast 발송 (REST 기반, WebSocket 아님).</summary>
    /// <param name="channel">채널 이름</param>
    /// <param name="eventName">이벤트 이름</param>
    /// <param name="payload">전송 데이터</param>
    public Task<Dictionary<string, object?>> BroadcastAsync(
        string channel, string eventName, object? payload = null,
        CancellationToken ct = default)
    {
        var body = new Dictionary<string, object?>
        {
            ["channel"] = channel,
            ["event"]   = eventName,
            ["payload"] = payload
        };
        return _adminCore.DatabaseLiveBroadcastAsync(body, ct);
    }

    /// <summary>KV 네임스페이스 접근 (#121).</summary>
    public KvClient Kv(string ns) => new KvClient(_http, ns);

    /// <summary>D1 데이터베이스 접근 (#121).</summary>
    public D1Client D1(string database) => new D1Client(_http, database);

    /// <summary>Vectorize 인덱스 접근 (#121).</summary>
    public VectorizeClient Vector(string index) => new VectorizeClient(_http, index);

    /// <summary>멀티테넌시 컨텍스트 설정 (#12).</summary>
    public void SetContext(Dictionary<string, object> ctx) => _http.SetContext(ctx);

    /// <summary>현재 컨텍스트 조회.</summary>
    public Dictionary<string, object>? GetContext() => _http.GetContext();

    public void Destroy() => Dispose();

    public void Dispose() => _http.Dispose();
}

/// <summary>DB namespace block reference for table access.</summary>
public sealed class DbRef
{
    private readonly GeneratedDbApi _core;
    private readonly string _ns;
    private readonly string? _instanceId;

    internal DbRef(GeneratedDbApi core, string ns, string? instanceId)
    {
        _core = core;
        _ns = ns;
        _instanceId = instanceId;
    }

    public TableRef Table(string name)
        => TableRef.WithDb(_core, name, _ns, _instanceId);
}
}
