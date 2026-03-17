using System.Collections.Generic;
using EdgeBase.Generated;
// EdgeBase C# Unity SDK — StorageClient
// Upload, download, delete, list, metadata, signed URLs.
// Unity 클라이언트 전용 — 서버 기능 없음.
// JSON API calls delegate to Generated Core (GeneratedDbApi).
// Binary upload/download operations remain as direct HTTP.

namespace EdgeBase
{

// ── 반환 타입 모델 ────────────────────────────────────────────────────

/// <summary>스토리지 파일 정보.</summary>
public sealed record FileInfo(
    string Key,
    long   Size,
    string ContentType,
    string UpdatedAt,
    string Etag          = "",
    string UploadedBy    = "",
    System.Collections.Generic.Dictionary<string, string>? CustomMetadata = null
);

/// <summary>List 결과.</summary>
public sealed record FileListResult(System.Collections.Generic.List<FileInfo> Files,
                                    string? Cursor);

/// <summary>서명 URL 결과.</summary>
public sealed record SignedUrlResult(string Url, long ExpiresAt);

// ── StorageClient ─────────────────────────────────────────────────────

/// <summary>Unity 스토리지 클라이언트 — 버킷 접근.</summary>
public sealed class StorageClient
{
    private readonly JbHttpClient _http;
    public StorageClient(JbHttpClient http) => _http = http;

    /// <summary>버킷 핸들을 반환합니다.</summary>
    public StorageBucket Bucket(string name) => new StorageBucket(_http, name);
}

/// <summary>단일 스토리지 버킷에 대한 작업.</summary>
public sealed class StorageBucket
{
    private readonly JbHttpClient _http;
    private readonly GeneratedDbApi _core;
    private readonly System.Text.Json.JsonSerializerOptions _json =
        new System.Text.Json.JsonSerializerOptions(
            System.Text.Json.JsonSerializerDefaults.Web);

    public string Name { get; }

    public StorageBucket(JbHttpClient http, string name)
    {
        _http = http;
        _core = new GeneratedDbApi(http);
        Name  = name;
    }

    private string EscKey(string key) => System.Uri.EscapeDataString(key);

    /// <summary>파일의 공개 URL을 반환합니다 (네트워크 요청 없음).</summary>
    public string GetUrl(string key) =>
        $"{_http.BaseUrl}{ApiPaths.DownloadFile(Name, EscKey(key))}";

    // ── 업로드 ────────────────────────────────────────────────────────
    // Binary upload uses multipart/form-data — must remain direct HTTP.

    /// <summary>바이트 배열을 multipart/form-data로 업로드합니다.</summary>
    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>> UploadAsync(
        string key, byte[] data, string contentType = "application/octet-stream") =>
        _http.UploadAsync(ApiPaths.UploadFile(Name), key, data, contentType);

    /// <summary>문자열을 지정된 인코딩으로 디코딩 후 업로드합니다.</summary>
    /// <param name="encoding">raw, base64, base64url, data_url 중 하나. 기본값 raw (UTF-8).</param>
    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>> UploadStringAsync(
        string key, string content, string encoding = "raw", string contentType = "text/plain")
    {
        byte[] data;
        var ct = contentType;
        switch (encoding)
        {
            case "base64":
                data = System.Convert.FromBase64String(content);
                break;
            case "base64url":
                var b64 = content.Replace('-', '+').Replace('_', '/');
                switch (b64.Length % 4)
                {
                    case 2: b64 += "=="; break;
                    case 3: b64 += "="; break;
                }
                data = System.Convert.FromBase64String(b64);
                break;
            case "data_url":
                var commaIdx = content.IndexOf(',');
                if (commaIdx >= 0)
                {
                    var header = content.Substring(0, commaIdx);
                    // Extract MIME type: data:mime/type;base64
                    if (header.StartsWith("data:"))
                    {
                        var mimeEnd = header.IndexOf(';');
                        if (mimeEnd > 5) ct = header.Substring(5, mimeEnd - 5);
                    }
                    data = System.Convert.FromBase64String(content.Substring(commaIdx + 1));
                }
                else
                {
                    data = System.Text.Encoding.UTF8.GetBytes(content);
                }
                break;
            default: // "raw"
                data = System.Text.Encoding.UTF8.GetBytes(content);
                break;
        }
        return _http.UploadAsync(ApiPaths.UploadFile(Name), key, data, ct);
    }

    // ── 다운로드 ──────────────────────────────────────────────────────
    // Binary download returns byte[] — must remain direct HTTP.

    /// <summary>파일 바이트를 다운로드합니다.</summary>
    public System.Threading.Tasks.Task<byte[]> DownloadAsync(string key) =>
        _http.DownloadAsync(ApiPaths.DownloadFile(Name, EscKey(key)));

    // ── 삭제 ──────────────────────────────────────────────────────────

    /// <summary>파일을 삭제합니다.</summary>
    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>> DeleteAsync(
        string key) => _core.DeleteFileAsync(Name, key);

    // ── 목록 ──────────────────────────────────────────────────────────

    /// <summary>버킷 내 파일 목록을 반환합니다.</summary>
    public async System.Threading.Tasks.Task<FileListResult> ListAsync(
        string? prefix = null, int limit = 100, int offset = 0)
    {
        // ListFilesAsync doesn't support query params, so use direct HTTP with query string.
        var qs = new System.Text.StringBuilder("?");
        if (!string.IsNullOrEmpty(prefix))
            qs.Append($"prefix={System.Uri.EscapeDataString(prefix!)}&");
        qs.Append($"limit={limit}&offset={offset}");

        var raw = await _http.GetAsync(ApiPaths.ListFiles(Name) + qs);
        var files = new System.Collections.Generic.List<FileInfo>();

        if (raw.TryGetValue("files", out var f) &&
            f is System.Text.Json.JsonElement arr &&
            arr.ValueKind == System.Text.Json.JsonValueKind.Array)
        {
            foreach (var item in arr.EnumerateArray())
            {
                System.Collections.Generic.Dictionary<string, string>? customMeta = null;
                if (item.TryGetProperty("customMetadata", out var cm) &&
                    cm.ValueKind == System.Text.Json.JsonValueKind.Object)
                {
                    customMeta = new System.Collections.Generic.Dictionary<string, string>();
                    foreach (var prop in cm.EnumerateObject())
                        customMeta[prop.Name] = prop.Value.GetString() ?? "";
                }
                files.Add(new FileInfo(
                    Key:           item.TryGetProperty("key",         out var k)  ? k.GetString()  ?? "" : "",
                    Size:          item.TryGetProperty("size",        out var s)  ? s.GetInt64()        : 0,
                    ContentType:   item.TryGetProperty("contentType", out var ctt) ? ctt.GetString() ?? "" : "",
                    UpdatedAt:     item.TryGetProperty("updatedAt",   out var u)  ? u.GetString()  ?? "" : "",
                    Etag:          item.TryGetProperty("etag",        out var e)  ? e.GetString()  ?? "" : "",
                    UploadedBy:    item.TryGetProperty("uploadedBy",  out var ub) ? ub.GetString() ?? "" : "",
                    CustomMetadata: customMeta
                ));
            }
        }

        string? cursor = null;
        if (raw.TryGetValue("cursor", out var c) &&
            c is System.Text.Json.JsonElement ce &&
            ce.ValueKind == System.Text.Json.JsonValueKind.String)
            cursor = ce.GetString();

        return new FileListResult(files, cursor);
    }

    // ── 메타데이터 ────────────────────────────────────────────────────

    /// <summary>파일 메타데이터를 조회합니다.</summary>
    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>> GetMetadataAsync(
        string key) => _core.GetFileMetadataAsync(Name, key);

    /// <summary>파일 메타데이터를 수정합니다.</summary>
    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>> UpdateMetadataAsync(
        string key, System.Collections.Generic.Dictionary<string, object?> metadata) =>
        _core.UpdateFileMetadataAsync(Name, key, metadata);

    // ── 서명 URL ──────────────────────────────────────────────────────

    /// <summary>서명된 다운로드 URL을 생성합니다.</summary>
    public async System.Threading.Tasks.Task<SignedUrlResult> CreateSignedUrlAsync(
        string key, int expiresIn = 3600)
    {
        var raw = await _core.CreateSignedDownloadUrlAsync(Name,
            new { key, expiresIn = expiresIn.ToString() + "s" });
        var url     = raw.TryGetValue("url", out var u) ? u?.ToString() ?? "" : "";

        long expires = 0;
        if (raw.TryGetValue("expiresAt", out var e) && e is System.Text.Json.JsonElement je)
        {
            if (je.ValueKind == System.Text.Json.JsonValueKind.Number)
                expires = je.GetInt64();
            else if (je.ValueKind == System.Text.Json.JsonValueKind.String && long.TryParse(je.GetString(), out var parsedE))
                expires = parsedE;
        }

        return new SignedUrlResult(url, expires);
    }

    /// <summary>여러 파일에 대한 서명된 다운로드 URL을 한 번에 생성합니다.</summary>
    public async System.Threading.Tasks.Task<System.Collections.Generic.List<SignedUrlResult>> CreateSignedUrlsAsync(
        System.Collections.Generic.IEnumerable<string> keys, int expiresIn = 3600,
        System.Threading.CancellationToken ct = default)
    {
        var raw = await _core.CreateSignedDownloadUrlsAsync(Name,
            new { keys, expiresIn = expiresIn.ToString() + "s" }, ct);
        var results = new System.Collections.Generic.List<SignedUrlResult>();
        if (raw.TryGetValue("urls", out var urlsObj) &&
            urlsObj is System.Text.Json.JsonElement urls &&
            urls.ValueKind == System.Text.Json.JsonValueKind.Array)
        {
            foreach (var item in urls.EnumerateArray())
            {
                var url = item.TryGetProperty("url", out var u) ? u.GetString() ?? "" : "";
                long expires = 0;
                if (item.TryGetProperty("expiresAt", out var e))
                {
                    if (e.ValueKind == System.Text.Json.JsonValueKind.Number)
                        expires = e.GetInt64();
                    else if (e.ValueKind == System.Text.Json.JsonValueKind.String &&
                             long.TryParse(e.GetString(), out var parsed))
                        expires = parsed;
                }
                results.Add(new SignedUrlResult(url, expires));
            }
        }
        return results;
    }

    /// <summary>서명된 업로드 URL을 생성합니다 (클라이언트 직접 업로드용).</summary>
    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>> CreateSignedUploadUrlAsync(
        string key, int expiresIn = 3600) =>
        _core.CreateSignedUploadUrlAsync(Name,
            new { key, expiresIn = expiresIn.ToString() + "s" });

    /// <summary>파일 존재 여부를 HEAD 요청으로 확인합니다.</summary>
    public System.Threading.Tasks.Task<bool> ExistsAsync(
        string key, System.Threading.CancellationToken ct = default) =>
        _core.CheckFileExistsAsync(Name, key, ct);

    /// <summary>진행 중인 resumable 업로드의 완료된 파트를 조회합니다.</summary>
    public async System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>> GetUploadPartsAsync(
        string key, string uploadId, System.Threading.CancellationToken ct = default)
    {
        var raw = await _core.GetUploadPartsAsync(
            Name,
            uploadId,
            new System.Collections.Generic.Dictionary<string, string> { ["key"] = key },
            ct);
        raw["uploadId"] = raw.TryGetValue("uploadId", out var existingUploadId) ? existingUploadId : uploadId;
        raw["key"] = raw.TryGetValue("key", out var existingKey) ? existingKey : key;
        raw["parts"] = raw.TryGetValue("parts", out var parts) ? parts : new System.Collections.Generic.List<object>();
        return raw;
    }

    // ── Resumable Upload ──────────────────────────────────────────────

    /// <summary>Resumable 업로드를 시작합니다. 업로드 ID를 반환합니다.</summary>
    public async System.Threading.Tasks.Task<string> InitiateResumableUploadAsync(
        string key, string? contentType = null)
    {
        var body = new Dictionary<string, object?> { ["key"] = key };
        if (contentType != null) body["contentType"] = contentType;
        var raw = await _core.CreateMultipartUploadAsync(Name, body);
        return raw.TryGetValue("uploadId", out var id) ? id?.ToString() ?? "" : "";
    }

    /// <summary>멀티파트 업로드 파트를 전송합니다. { partNumber, etag } 를 반환합니다.</summary>
    /// Keep as direct HTTP — binary part upload.
    public System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>> UploadPartAsync(
        string key, string uploadId, byte[] chunk, int partNumber)
    {
        var qs = $"?uploadId={System.Uri.EscapeDataString(uploadId)}" +
                 $"&partNumber={partNumber}" +
                 $"&key={EscKey(key)}";
        return _http.PostBytesAsync(ApiPaths.UploadPart(Name) + qs, chunk);
    }

    /// <summary>Resumable 업로드 청크를 전송합니다. 마지막 청크이면 완료 후 결과를 반환합니다.</summary>
    public async System.Threading.Tasks.Task<System.Collections.Generic.Dictionary<string, object?>?> ResumeUploadAsync(
        string key, string uploadId, byte[] chunk, int offset, bool isLastChunk = false)
    {
        var partNumber = offset + 1; // R2 partNumber is 1-based
        var part = await UploadPartAsync(key, uploadId, chunk, partNumber);
        if (isLastChunk)
        {
            return await _core.CompleteMultipartUploadAsync(Name,
                new { uploadId, key, parts = new[] { part } });
        }
        return part;
    }
}
}
