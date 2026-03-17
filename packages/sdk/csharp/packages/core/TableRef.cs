using System;
using System.Collections.Generic;
using System.Linq;
// EdgeBase C# Unity SDK — TableRef
//: URL 체계 /api/db/{namespace}/tables/{name} 전환.
// Unity 클라이언트 전용.
// All HTTP calls delegate to Generated Core (GeneratedDbApi).
// No hardcoded API paths — the core is the single source of truth.

using EdgeBase.Generated;

namespace EdgeBase
{

// ── 반환 타입 ──────────────────────────────────────────────────────────

/// <summary>컬렉션 목록 조회 결과.</summary>
public sealed class ListResult
{
    /// <summary>현재 페이지의 문서들.</summary>
    public System.Collections.Generic.List<System.Collections.Generic.Dictionary<string, object?>> Items { get; }
    /// <summary>전체 문서 수.</summary>
    public int Total { get; }
    /// <summary>커서 기반 페이지네이션의 다음 커서.</summary>
    public string? Cursor { get; }

    public ListResult(
        System.Collections.Generic.List<System.Collections.Generic.Dictionary<string, object?>> items,
        int total, string? cursor)
    {
        Items  = items;
        Total  = total;
        Cursor = cursor;
    }
}

/// <summary>Database live change payload.</summary>
public sealed class DbChange
{
    public string ChangeType { get; set; } = "";
    public string Table { get; set; } = "";
    public string DocId { get; set; } = "";
    public Dictionary<string, object?>? Data { get; set; }
    public string Timestamp { get; set; } = "";
}

// ── OrBuilder ────────────────────────────────────────────────────────

    /// <summary>OR 조건 빌더.</summary>
    public sealed class OrBuilder
    {
        private readonly System.Collections.Generic.List<object[]> _filters = new System.Collections.Generic.List<object[]>();

        public OrBuilder Where(string field, string op, object value)
        {
            _filters.Add(new object[] { field, op, value });
            return this;
        }

        public System.Collections.Generic.List<object[]> GetFilters() => _filters;
    }

// ── Core dispatch helpers ────────────────────────────────────────────

/// <summary>Static helper to dispatch GET-like calls to correct generated core method
/// based on single-instance vs dynamic (namespace+instanceId) DB.</summary>
internal static class CoreDispatch
{
    public static System.Threading.Tasks.Task<Dictionary<string, object?>> Get(
        GeneratedDbApi core, string method, string ns, string? instanceId,
        string table, string? id = null, Dictionary<string, string>? query = null)
    {
        var q = query ?? new Dictionary<string, string>();
        if (instanceId != null)
        {
            switch (method)
            {
                case "list":   return core.DbListRecordsAsync(ns, instanceId, table, q);
                case "get":    return core.DbGetRecordAsync(ns, instanceId, table, id!, q);
                case "count":  return core.DbCountRecordsAsync(ns, instanceId, table, q);
                case "search": return core.DbSearchRecordsAsync(ns, instanceId, table, q);
            }
        }
        switch (method)
        {
            case "list":   return core.DbSingleListRecordsAsync(ns, table, q);
            case "get":    return core.DbSingleGetRecordAsync(ns, table, id!, q);
            case "count":  return core.DbSingleCountRecordsAsync(ns, table, q);
            case "search": return core.DbSingleSearchRecordsAsync(ns, table, q);
        }
        throw new System.ArgumentException($"Unknown method: {method}");
    }

    public static System.Threading.Tasks.Task<Dictionary<string, object?>> Insert(
        GeneratedDbApi core, string ns, string? instanceId,
        string table, object body, Dictionary<string, string>? query = null)
    {
        var q = query ?? new Dictionary<string, string>();
        if (instanceId != null)
            return core.DbInsertRecordAsync(ns, instanceId, table, body, q);
        return core.DbSingleInsertRecordAsync(ns, table, body, q);
    }

    public static System.Threading.Tasks.Task<Dictionary<string, object?>> Update(
        GeneratedDbApi core, string ns, string? instanceId,
        string table, string id, object body)
    {
        if (instanceId != null)
            return core.DbUpdateRecordAsync(ns, instanceId, table, id, body);
        return core.DbSingleUpdateRecordAsync(ns, table, id, body);
    }

    public static System.Threading.Tasks.Task<Dictionary<string, object?>> Delete(
        GeneratedDbApi core, string ns, string? instanceId,
        string table, string id)
    {
        if (instanceId != null)
            return core.DbDeleteRecordAsync(ns, instanceId, table, id);
        return core.DbSingleDeleteRecordAsync(ns, table, id);
    }

    public static System.Threading.Tasks.Task<Dictionary<string, object?>> Batch(
        GeneratedDbApi core, string ns, string? instanceId,
        string table, object body, Dictionary<string, string>? query = null)
    {
        var q = query ?? new Dictionary<string, string>();
        if (instanceId != null)
            return core.DbBatchRecordsAsync(ns, instanceId, table, body, q);
        return core.DbSingleBatchRecordsAsync(ns, table, body, q);
    }

    public static System.Threading.Tasks.Task<Dictionary<string, object?>> BatchByFilter(
        GeneratedDbApi core, string ns, string? instanceId,
        string table, object body, Dictionary<string, string>? query = null)
    {
        var q = query ?? new Dictionary<string, string>();
        if (instanceId != null)
            return core.DbBatchByFilterAsync(ns, instanceId, table, body, q);
        return core.DbSingleBatchByFilterAsync(ns, table, body, q);
    }
}

// ── TableRef ──────────────────────────────────────────────────────

/// <summary>불변 쿼리 빌더 — EdgeBase 컬렉션 CRUD 및 쿼리.</summary>
public sealed class TableRef
{
    private static string BuildDatabaseLiveChannel(string ns, string? instanceId, string table, string? docId = null)
    {
        var channel = instanceId != null
            ? $"dblive:{ns}:{instanceId}:{table}"
            : $"dblive:{ns}:{table}";
        return docId != null ? $"{channel}:{docId}" : channel;
    }

    public string Name { get; }
    /// <summary>DB 블록 namespace: 'shared' | 'workspace' | 'user' | ... (#133 §2)</summary>
    private readonly string _namespace;
    /// <summary>dynamic DO의 instance ID (e.g. 'ws-456'). 정적 DB는 null.</summary>
    private readonly string? _instanceId;
    private readonly GeneratedDbApi _core;
    private readonly System.Collections.Generic.List<object[]> _filters = new System.Collections.Generic.List<object[]>();
    private readonly System.Collections.Generic.List<object[]> _orFilters = new System.Collections.Generic.List<object[]>(); //
    private readonly System.Collections.Generic.List<object[]> _sorts   = new System.Collections.Generic.List<object[]>();
    private int?    _limit;
    private int?    _offset;
    private int?    _page;
    private string? _search;
    private string? _after;
    private string? _before;
    private string? _docId;    // Doc(id) 모드
    private readonly Func<string, Action<DbChange>, IEnumerable<object[]>?, IEnumerable<object[]>?, System.Threading.Tasks.Task<IDisposable>>? _subscribeSnapshot;

    public TableRef(GeneratedDbApi core, string name)
        : this(core, name, "shared", null, null) { }

    public TableRef(
        GeneratedDbApi core,
        string name,
        string ns,
        string? instanceId,
        Func<string, Action<DbChange>, IEnumerable<object[]>?, IEnumerable<object[]>?, System.Threading.Tasks.Task<IDisposable>>? subscribeSnapshot = null)
    {
        _core = core;
        Name  = name;
        _namespace  = ns;
        _instanceId = instanceId;
        _subscribeSnapshot = subscribeSnapshot;
    }

    /// <summary>DB namespace + instance ID로 TableRef를 생성합니다.</summary>
    public static TableRef WithDb(
        GeneratedDbApi core,
        string name,
        string ns,
        string? instanceId = null,
        Func<string, Action<DbChange>, IEnumerable<object[]>?, IEnumerable<object[]>?, System.Threading.Tasks.Task<IDisposable>>? subscribeSnapshot = null)
        => new TableRef(core, name, ns, instanceId, subscribeSnapshot);

    private TableRef Clone()
    {
        var c = new TableRef(_core, Name, _namespace, _instanceId, _subscribeSnapshot)
        {
            _limit = _limit, _offset = _offset, _page = _page,
            _search = _search, _after = _after,
            _before = _before, _docId = _docId
        };
        c._filters.AddRange(_filters);
        c._orFilters.AddRange(_orFilters);
        c._sorts.AddRange(_sorts);
        return c;
    }

    // ── 쿼리 빌더 ────────────────────────────────────────────────────

    public TableRef Where(string field, string op, object value)
    { var c = Clone(); c._filters.Add(new object[] { field, op, value }); return c; }

    /// <summary>OR 조건을 추가합니다.</summary>
    public TableRef Or(System.Action<OrBuilder> builderAction)
    {
        var c = Clone();
        var builder = new OrBuilder();
        builderAction(builder);
        c._orFilters.AddRange(builder.GetFilters());
        return c;
    }

    public TableRef OrderBy(string field, string direction = "asc")
    { var c = Clone(); c._sorts.Add(new object[] { field, direction }); return c; }

    public TableRef Limit(int n)   { var c = Clone(); c._limit   = n;  return c; }
    public TableRef Offset(int n)  { var c = Clone(); c._offset  = n;  return c; }
    public TableRef Page(int n)    { var c = Clone(); c._page    = n;  return c; }
    public TableRef Search(string q){ var c = Clone(); c._search = q;  return c; }
    public TableRef After(string cur){ var c = Clone(); c._after = cur; return c; }
    public TableRef Before(string cur){ var c = Clone(); c._before = cur; return c; }

    /// <summary>특정 문서 ID에 대한 단건 작업 핸들을 반환합니다.</summary>
    public TableRef Doc(string id)  { var c = Clone(); c._docId  = id;  return c; }

    // ── 쿼리 파라미터 빌드 ──────────────────────────────────────────

    private Dictionary<string, string> BuildQueryParams()
    {
        Func<object, string> serialize = o => System.Text.Json.JsonSerializer.Serialize(o);
        var query = new Dictionary<string, string>();
        if (_filters.Count > 0) query["filter"] = serialize(_filters);
        if (_orFilters.Count > 0) query["orFilter"] = serialize(_orFilters);
        if (_sorts.Count > 0) query["sort"] = string.Join(",", _sorts.Select(s => s[0] + ":" + s[1]));
        if (_limit.HasValue)    query["limit"]  = _limit.ToString()!;
        if (_offset.HasValue)   query["offset"] = _offset.ToString()!;
        if (_page.HasValue)     query["page"]   = _page.ToString()!;
        if (_search != null)    query["search"] = _search;
        if (_after != null)     query["after"]  = _after;
        if (_before != null)    query["before"] = _before;
        return query;
    }

    // ── CRUD ──────────────────────────────────────────────────────────

    /// <summary>CancellationToken을 받는 GetListAsync 오버로드.</summary>
    public System.Threading.Tasks.Task<ListResult> GetListAsync(System.Threading.CancellationToken ct)
        => GetListAsync();

    /// <summary>현재 쿼리 빌더 상태로 목록을 조회합니다.</summary>
    public async System.Threading.Tasks.Task<ListResult> GetListAsync()
    {
        var query = BuildQueryParams();
        Dictionary<string, object?> raw;
        if (_search != null)
        {
            raw = await CoreDispatch.Get(_core, "search", _namespace, _instanceId, Name, query: query);
        }
        else
        {
            raw = await CoreDispatch.Get(_core, "list", _namespace, _instanceId, Name, query: query);
        }

        var items = new System.Collections.Generic.List<System.Collections.Generic.Dictionary<string, object?>>();

        if (raw.TryGetValue("items", out var it) &&
            it is System.Text.Json.JsonElement arr &&
            arr.ValueKind == System.Text.Json.JsonValueKind.Array)
        {
            foreach (var elem in arr.EnumerateArray())
            {
                var dict = System.Text.Json.JsonSerializer
                    .Deserialize<System.Collections.Generic.Dictionary<string, object?>>(
                        elem.GetRawText(),
                        new System.Text.Json.JsonSerializerOptions(
                            System.Text.Json.JsonSerializerDefaults.Web));
                if (dict != null) items.Add(dict);
            }
        }

        int total = 0;
        if (raw.TryGetValue("total", out var t) && t is System.Text.Json.JsonElement te)
            total = te.GetInt32();

        string? cursor = null;
        if (raw.TryGetValue("cursor", out var cu) &&
            cu is System.Text.Json.JsonElement ce &&
            ce.ValueKind == System.Text.Json.JsonValueKind.String)
            cursor = ce.GetString();

        return new ListResult(items, total, cursor);
    }


    /// <summary>현재 쿼리 조건에 맞는 첫 번째 문서를 반환합니다. 없으면 null.</summary>
    public async System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>?> GetFirstAsync()
    {
        var result = await Limit(1).GetListAsync();
        return result.Items.Count > 0 ? result.Items[0] : null;
    }

    /// <summary>문서 1건을 ID로 조회합니다.</summary>
    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>> GetOneAsync(string id) =>
        CoreDispatch.Get(_core, "get", _namespace, _instanceId, Name, id: id);


    /// <summary>새 문서를 생성합니다.</summary>
    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>> InsertAsync(
        System.Collections.Generic.Dictionary<string, object?> record) =>
        CoreDispatch.Insert(_core, _namespace, _instanceId, Name, record);

    /// <summary>문서를 ID로 수정합니다.</summary>
    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>> UpdateAsync(
        string id, System.Collections.Generic.Dictionary<string, object?> data) =>
        CoreDispatch.Update(_core, _namespace, _instanceId, Name, id, data);

    /// <summary>문서를 ID로 삭제합니다.</summary>
    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>> DeleteAsync(string id) =>
        CoreDispatch.Delete(_core, _namespace, _instanceId, Name, id);

    /// <summary>DB live 구독을 시작합니다. dispose 하면 해제됩니다.</summary>
    public async System.Threading.Tasks.Task<IDisposable> OnSnapshot(Action<DbChange> listener)
    {
        if (_subscribeSnapshot == null)
        {
            throw new System.NotSupportedException(
                "OnSnapshot() is not available in this SDK surface. Use the client SDK to open database-live subscriptions.");
        }

        var channel = BuildDatabaseLiveChannel(_namespace, _instanceId, Name, _docId);
        var filters = _docId == null && _filters.Count > 0 ? _filters : null;
        var orFilters = _docId == null && _orFilters.Count > 0 ? _orFilters : null;
        return await _subscribeSnapshot(channel, listener, filters, orFilters);
    }

    /// <summary>Upsert — 존재하면 수정, 없으면 생성합니다.</summary>
    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>> UpsertAsync(
        System.Collections.Generic.Dictionary<string, object?> record, string? conflictTarget = null)
    {
        var query = new Dictionary<string, string> { { "upsert", "true" } };
        if (conflictTarget != null)
            query["conflictTarget"] = conflictTarget;
        return CoreDispatch.Insert(_core, _namespace, _instanceId, Name, record, query);
    }

    /// <summary>현재 필터에 맞는 문서 수를 반환합니다.</summary>
    public async System.Threading.Tasks.Task<int> CountAsync()
    {
        var query = BuildQueryParams();
        var raw = await CoreDispatch.Get(_core, "count", _namespace, _instanceId, Name, query: query);
        return raw.TryGetValue("total", out var v) &&
               v is System.Text.Json.JsonElement e
               ? e.GetInt32() : 0;
    }

    // ── 배치 ──────────────────────────────────────────────────────────

    /// <summary>여러 문서를 한 번에 생성합니다.</summary>
    public async System.Threading.Tasks.Task<System.Collections.Generic.List<System.Collections.Generic.Dictionary<string, object?>>> InsertManyAsync(
        System.Collections.Generic.IEnumerable<System.Collections.Generic.Dictionary<string, object?>> records)
    {
        var raw = await CoreDispatch.Batch(_core, _namespace, _instanceId, Name, new { inserts = records });
        var result = new System.Collections.Generic.List<System.Collections.Generic.Dictionary<string, object?>>();
        if (raw.TryGetValue("inserted", out var it) &&
            it is System.Text.Json.JsonElement arr &&
            arr.ValueKind == System.Text.Json.JsonValueKind.Array)
        {
            foreach (var elem in arr.EnumerateArray())
            {
                var d = System.Text.Json.JsonSerializer
                    .Deserialize<System.Collections.Generic.Dictionary<string, object?>>(
                        elem.GetRawText(),
                        new System.Text.Json.JsonSerializerOptions(
                            System.Text.Json.JsonSerializerDefaults.Web));
                if (d != null) result.Add(d);
            }
        }
        return result;
    }

    /// <summary>여러 문서를 upsert합니다 (없으면 생성, 있으면 업데이트).</summary>
    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>> UpsertManyAsync(
        System.Collections.Generic.IEnumerable<System.Collections.Generic.Dictionary<string, object?>> records,
        string conflictTarget = "")
    {
        object body = new { inserts = records };
        var query = new Dictionary<string, string> { { "upsert", "true" } };
        if (!string.IsNullOrEmpty(conflictTarget))
            query["conflictTarget"] = conflictTarget;
        return CoreDispatch.Batch(_core, _namespace, _instanceId, Name, body, query);
    }

    /// <summary>현재 필터에 맞는 모든 문서를 수정합니다.</summary>
    public async System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>> UpdateManyAsync(
        System.Collections.Generic.Dictionary<string, object?> update)
    {
        if (_filters.Count == 0)
            throw new EdgeBaseException(400, "updateMany requires at least one where() filter");
        return await BatchByFilterAsync("update", update);
    }

    /// <summary>현재 필터에 맞는 모든 문서를 삭제합니다.</summary>
    public async System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>> DeleteManyAsync()
    {
        if (_filters.Count == 0)
            throw new EdgeBaseException(400, "deleteMany requires at least one where() filter");
        return await BatchByFilterAsync("delete", null);
    }

    private async System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>> BatchByFilterAsync(
        string action,
        System.Collections.Generic.Dictionary<string, object?>? update)
    {
        const int maxIterations = 100;
        var totalProcessed = 0;
        var totalSucceeded = 0;
        var errors = new System.Collections.Generic.List<System.Collections.Generic.Dictionary<string, object?>>();
        var filters = _filters.Count > 0 ? (object)_filters : new object[0];

        for (var chunkIndex = 0; chunkIndex < maxIterations; chunkIndex++)
        {
            try
            {
                var body = new System.Collections.Generic.Dictionary<string, object>
                {
                    { "action", action },
                    { "filter", filters },
                    { "limit", 500 }
                };
                if (_orFilters.Count > 0) body["orFilter"] = _orFilters;
                if (action == "update" && update != null) body["update"] = update;

                var raw = await CoreDispatch.BatchByFilter(_core, _namespace, _instanceId, Name, body);
                var processed = ExtractInt(raw, "processed");
                var succeeded = ExtractInt(raw, "succeeded");

                totalProcessed += processed;
                totalSucceeded += succeeded;

                if (processed == 0 || action == "update")
                    break;
            }
            catch (Exception error)
            {
                errors.Add(new System.Collections.Generic.Dictionary<string, object?>
                {
                    ["chunkIndex"] = chunkIndex,
                    ["chunkSize"] = 500,
                    ["error"] = error.Message
                });
                break;
            }
        }

        return new System.Collections.Generic.Dictionary<string, object?>
        {
            ["totalProcessed"] = totalProcessed,
            ["totalSucceeded"] = totalSucceeded,
            ["errors"] = errors
        };
    }

    private static int ExtractInt(System.Collections.Generic.Dictionary<string, object?> dict, string key)
    {
        if (!dict.TryGetValue(key, out var value) || value == null)
            return 0;
        if (value is System.Text.Json.JsonElement element && element.ValueKind == System.Text.Json.JsonValueKind.Number)
            return element.GetInt32();
        if (value is int i)
            return i;
        if (value is long l)
            return (int)l;
        if (value is double d)
            return (int)d;
        return 0;
    }
}
}
