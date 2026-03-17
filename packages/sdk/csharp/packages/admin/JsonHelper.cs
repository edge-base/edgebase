using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
// EdgeBase C# Admin SDK — JSON 응답 파싱 헬퍼
// 서버 응답에서 중첩 객체/배열을 안전하게 추출.

namespace EdgeBase.Admin
{

/// <summary>서버 JSON 응답 파싱 유틸리티.</summary>
internal static class JsonHelper
{
    private static readonly JsonSerializerOptions JsonOpts =
        new JsonSerializerOptions(JsonSerializerDefaults.Web);

    /// <summary>응답에서 중첩 딕셔너리 추출 (예: { "user": {...} } → user 부분).</summary>
    internal static Dictionary<string, object?> ExtractNested(
        Dictionary<string, object?> dict, string key)
    {
        if (dict.TryGetValue(key, out var val) && val is JsonElement el
            && el.ValueKind == JsonValueKind.Object)
        {
            return MaterializeObject(el);
        }
        return dict;
    }

    /// <summary>응답에서 딕셔너리 배열 추출.</summary>
    internal static List<Dictionary<string, object?>> ExtractList(
        Dictionary<string, object?> dict, string key)
    {
        if (dict.TryGetValue(key, out var val) && val is JsonElement el
            && el.ValueKind == JsonValueKind.Array)
        {
            return el.EnumerateArray()
                .Where(item => item.ValueKind == JsonValueKind.Object)
                .Select(MaterializeObject)
                .ToList();
        }
        return new List<Dictionary<string, object?>>();
    }

    /// <summary>응답에서 문자열 추출.</summary>
    internal static string? ExtractString(Dictionary<string, object?> dict, string key)
    {
        if (dict.TryGetValue(key, out var val))
        {
            if (val is JsonElement el)
            {
                if (el.ValueKind == JsonValueKind.String) return el.GetString();
                if (el.ValueKind == JsonValueKind.Null) return null;
            }
            return val?.ToString();
        }
        return null;
    }

    /// <summary>응답에서 문자열 배열 추출.</summary>
    internal static List<string> ExtractStringList(
        Dictionary<string, object?> dict, string key)
    {
        if (dict.TryGetValue(key, out var val) && val is JsonElement el
            && el.ValueKind == JsonValueKind.Array)
        {
            var list = new List<string>();
            foreach (var item in el.EnumerateArray())
            {
                var s = item.GetString();
                if (s != null) list.Add(s);
            }
            return list;
        }
        return new List<string>();
    }

    /// <summary>응답에서 정수 추출.</summary>
    internal static int ExtractInt(Dictionary<string, object?> dict, string key)
    {
        if (dict.TryGetValue(key, out var val) && val is JsonElement el
            && el.ValueKind == JsonValueKind.Number)
        {
            return el.GetInt32();
        }
        return 0;
    }

    /// <summary>응답에서 VectorMatch 배열 추출.</summary>
    internal static List<VectorMatch> ExtractVectorMatches(
        Dictionary<string, object?> dict, string key)
    {
        if (dict.TryGetValue(key, out var val) && val is JsonElement el
            && el.ValueKind == JsonValueKind.Array)
        {
            var list = new List<VectorMatch>();
            foreach (var item in el.EnumerateArray())
            {
                var match = new VectorMatch();
                if (item.TryGetProperty("id", out var id))
                    match.Id = id.GetString() ?? "";
                if (item.TryGetProperty("score", out var score))
                    match.Score = score.GetDouble();
                if (item.TryGetProperty("values", out var vals)
                    && vals.ValueKind == JsonValueKind.Array)
                {
                    match.Values = ExtractDoubleArray(vals);
                }
                if (item.TryGetProperty("metadata", out var meta)
                    && meta.ValueKind == JsonValueKind.Object)
                {
                    match.Metadata = JsonSerializer.Deserialize<Dictionary<string, object?>>(
                        meta.GetRawText(), JsonOpts);
                }
                if (item.TryGetProperty("namespace", out var ns)
                    && ns.ValueKind == JsonValueKind.String)
                {
                    match.Namespace = ns.GetString();
                }
                list.Add(match);
            }
            return list;
        }
        return new List<VectorMatch>();
    }

    /// <summary>응답에서 VectorResult 배열 추출 (getByIds).</summary>
    internal static List<VectorResult> ExtractVectorResults(
        Dictionary<string, object?> dict, string key)
    {
        if (dict.TryGetValue(key, out var val) && val is JsonElement el
            && el.ValueKind == JsonValueKind.Array)
        {
            var list = new List<VectorResult>();
            foreach (var item in el.EnumerateArray())
            {
                var result = new VectorResult();
                if (item.TryGetProperty("id", out var id))
                    result.Id = id.GetString() ?? "";
                if (item.TryGetProperty("values", out var vals)
                    && vals.ValueKind == JsonValueKind.Array)
                {
                    result.Values = ExtractDoubleArray(vals);
                }
                if (item.TryGetProperty("metadata", out var meta)
                    && meta.ValueKind == JsonValueKind.Object)
                {
                    result.Metadata = JsonSerializer.Deserialize<Dictionary<string, object?>>(
                        meta.GetRawText(), JsonOpts);
                }
                if (item.TryGetProperty("namespace", out var ns)
                    && ns.ValueKind == JsonValueKind.String)
                {
                    result.Namespace = ns.GetString();
                }
                list.Add(result);
            }
            return list;
        }
        return new List<VectorResult>();
    }

    /// <summary>응답에서 IndexInfo 추출 (describe).</summary>
    internal static IndexInfo ExtractIndexInfo(Dictionary<string, object?> dict)
    {
        var info = new IndexInfo();
        if (dict.TryGetValue("vectorCount", out var vc) && vc is JsonElement vcEl
            && vcEl.ValueKind == JsonValueKind.Number)
            info.VectorCount = vcEl.GetInt64();
        if (dict.TryGetValue("dimensions", out var dim) && dim is JsonElement dimEl
            && dimEl.ValueKind == JsonValueKind.Number)
            info.Dimensions = dimEl.GetInt32();
        if (dict.TryGetValue("metric", out var m) && m is JsonElement mEl
            && mEl.ValueKind == JsonValueKind.String)
            info.Metric = mEl.GetString() ?? "";
        if (dict.TryGetValue("id", out var idVal) && idVal is JsonElement idEl
            && idEl.ValueKind == JsonValueKind.String)
            info.Id = idEl.GetString();
        if (dict.TryGetValue("name", out var nameVal) && nameVal is JsonElement nameEl
            && nameEl.ValueKind == JsonValueKind.String)
            info.Name = nameEl.GetString();
        return info;
    }

    private static double[] ExtractDoubleArray(JsonElement el)
    {
        var arr = new List<double>();
        foreach (var item in el.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Number) arr.Add(item.GetDouble());
        }
        return arr.ToArray();
    }

    private static Dictionary<string, object?> MaterializeObject(JsonElement element)
    {
        var result = new Dictionary<string, object?>();
        foreach (var prop in element.EnumerateObject())
        {
            result[prop.Name] = MaterializeValue(prop.Value);
        }
        return result;
    }

    private static List<object?> MaterializeArray(JsonElement element)
    {
        var result = new List<object?>();
        foreach (var item in element.EnumerateArray())
        {
            result.Add(MaterializeValue(item));
        }
        return result;
    }

    private static object? MaterializeValue(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Object => MaterializeObject(element),
        JsonValueKind.Array => MaterializeArray(element),
        JsonValueKind.String => element.GetString(),
        JsonValueKind.Number => element.TryGetInt64(out var i64)
            ? i64
            : element.TryGetDouble(out var dbl)
                ? dbl
                : element.GetRawText(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.Null => null,
        _ => element.GetRawText(),
    };
}
}
