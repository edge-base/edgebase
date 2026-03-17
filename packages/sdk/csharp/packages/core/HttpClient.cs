using System;
using System.Collections.Generic;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
#if UNITY_WEBGL && !UNITY_EDITOR
using UnityEngine.Networking;
#endif
// EdgeBase C# SDK — HTTP Client
// Client(Unity) + Admin(.NET) 공용 HTTP 래핑.
// Service Key 헤더 지원 (Admin SDK용,).
// System.Net.Http.HttpClient 래핑 (Unity 2021.3+ 지원, netstandard2.1).

namespace EdgeBase
{

public sealed class JbHttpClient : IDisposable
{
#if !(UNITY_WEBGL && !UNITY_EDITOR)
    private readonly System.Net.Http.HttpClient _http;
#endif
    public readonly string BaseUrl;
    private readonly JsonSerializerOptions _json =
        new JsonSerializerOptions(JsonSerializerDefaults.Web)
        { DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull };
    private string? _token;
    private string? _refreshToken;
    private string? _serviceKey;
    private string? _locale;
    private Dictionary<string, object>? _context;

    public JbHttpClient(string baseUrl)
    {
        BaseUrl = baseUrl.TrimEnd('/');
#if !(UNITY_WEBGL && !UNITY_EDITOR)
        _http = new System.Net.Http.HttpClient();
#endif
    }

    public void SetToken(string? token)         => _token = token;
    public string? GetToken()                   => _token;
    public void SetRefreshToken(string? token)  => _refreshToken = token;
    public string? GetRefreshToken()            => _refreshToken;
    /// <summary>Alias for GetToken() — used by DatabaseLiveClient.</summary>
    public string? GetAccessToken()             => _token;
    public void SetLocale(string? locale)       => _locale = locale;
    public string? GetLocale()                  => _locale;

    public void SetServiceKey(string? key)                 => _serviceKey = key;
    public void SetContext(Dictionary<string, object> ctx) => _context = ctx;
    public Dictionary<string, object>? GetContext()        => _context;

    private string? GetSerializedContextHeader()
    {
        if (_context == null || _context.Count == 0)
        {
            return null;
        }

        return JsonSerializer.Serialize(_context, _json);
    }

#if !(UNITY_WEBGL && !UNITY_EDITOR)
    private void ApplyHeaders(System.Net.Http.HttpRequestMessage req)
    {
        if (!string.IsNullOrEmpty(_serviceKey))
            req.Headers.TryAddWithoutValidation("X-EdgeBase-Service-Key", _serviceKey);
        if (!string.IsNullOrEmpty(_token))
            req.Headers.Authorization =
                new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", _token);
        if (!string.IsNullOrEmpty(_locale))
            req.Headers.TryAddWithoutValidation("Accept-Language", _locale);
    }

    private async Task<Dictionary<string, object?>> SendAsync(
        System.Net.Http.HttpRequestMessage req,
        CancellationToken ct = default,
        int _retryCount = 0)
    {
        ApplyHeaders(req);
        System.Net.Http.HttpResponseMessage resp;
        try
        {
            resp = await _http.SendAsync(req, ct);
        }
        catch (System.Net.Http.HttpRequestException ex)
        {
            // Network-level errors (connection refused, DNS failure, etc.)
            // must be wrapped as EdgeBaseException so callers can catch a single type.
            throw new EdgeBaseException(0, ex.Message, ex);
        }
        var body = await resp.Content.ReadAsStringAsync();
        // "worker restarted mid-request" means the request was NOT processed;
        // safe to retry once regardless of HTTP method.
        if (!resp.IsSuccessStatusCode && _retryCount < 1
            && body.Contains("worker restarted"))
        {
            var retry = new System.Net.Http.HttpRequestMessage(req.Method, req.RequestUri);
            if (req.Content != null)
                retry.Content = new System.Net.Http.StringContent(
                    await req.Content.ReadAsStringAsync(),
                    System.Text.Encoding.UTF8, "application/json");
            return await SendAsync(retry, ct, _retryCount + 1);
        }
        if (!resp.IsSuccessStatusCode)
            throw new EdgeBaseException((int)resp.StatusCode, body);
        if (string.IsNullOrWhiteSpace(body)) return new Dictionary<string, object?>();
        return System.Text.Json.JsonSerializer
            .Deserialize<Dictionary<string, object?>>(body, _json) ?? new Dictionary<string, object?>();
    }

    private Dictionary<string, object?> DeserializeBody(string body)
    {
        if (string.IsNullOrWhiteSpace(body))
        {
            return new Dictionary<string, object?>();
        }

        return JsonSerializer.Deserialize<Dictionary<string, object?>>(body, _json)
            ?? new Dictionary<string, object?>();
    }

    private string SerializeBody(object? body) =>
        JsonSerializer.Serialize(body ?? new { }, _json);
#else
    private void ApplyHeaders(UnityWebRequest req)
    {
        if (!string.IsNullOrEmpty(_serviceKey))
        {
            req.SetRequestHeader("X-EdgeBase-Service-Key", _serviceKey);
        }

        if (!string.IsNullOrEmpty(_token))
        {
            req.SetRequestHeader("Authorization", $"Bearer {_token}");
        }
        if (!string.IsNullOrEmpty(_locale))
        {
            req.SetRequestHeader("Accept-Language", _locale);
        }

    }

    private Dictionary<string, object?> DeserializeBody(string body)
    {
        if (string.IsNullOrWhiteSpace(body))
        {
            return new Dictionary<string, object?>();
        }

        return JsonSerializer.Deserialize<Dictionary<string, object?>>(body, _json)
            ?? new Dictionary<string, object?>();
    }

    private string SerializeBody(object? body) =>
        JsonSerializer.Serialize(body ?? new { }, _json);

    private static async Task AwaitUnityRequestAsync(UnityWebRequestAsyncOperation operation, CancellationToken ct)
    {
        while (!operation.isDone)
        {
            ct.ThrowIfCancellationRequested();
            await Task.Yield();
        }
    }

    private async Task<Dictionary<string, object?>> SendUnityJsonAsync(
        string method,
        string path,
        string? body = null,
        CancellationToken ct = default,
        int retryCount = 0)
    {
        using var req = new UnityWebRequest(BaseUrl + path, method)
        {
            downloadHandler = new DownloadHandlerBuffer()
        };

        if (body != null)
        {
            req.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(body));
            req.SetRequestHeader("Content-Type", "application/json");
        }

        ApplyHeaders(req);

        try
        {
            await AwaitUnityRequestAsync(req.SendWebRequest(), ct);
        }
        catch (Exception ex)
        {
            throw new EdgeBaseException(0, ex.Message, ex);
        }

        var responseBody = req.downloadHandler.text ?? string.Empty;
        if (req.result == UnityWebRequest.Result.ConnectionError)
        {
            throw new EdgeBaseException(0, req.error ?? "Network error");
        }

        if (req.responseCode < 200 || req.responseCode >= 300)
        {
            if (retryCount < 1 && responseBody.Contains("worker restarted"))
            {
                return await SendUnityJsonAsync(method, path, body, ct, retryCount + 1);
            }

            throw new EdgeBaseException((int)req.responseCode, responseBody);
        }

        return DeserializeBody(responseBody);
    }

    private async Task<byte[]> SendUnityBytesAsync(
        string method,
        string path,
        byte[]? body = null,
        string? contentType = null,
        CancellationToken ct = default)
    {
        using var req = new UnityWebRequest(BaseUrl + path, method)
        {
            downloadHandler = new DownloadHandlerBuffer()
        };

        if (body != null)
        {
            req.uploadHandler = new UploadHandlerRaw(body);
            if (!string.IsNullOrEmpty(contentType))
            {
                req.SetRequestHeader("Content-Type", contentType);
            }
        }

        ApplyHeaders(req);

        try
        {
            await AwaitUnityRequestAsync(req.SendWebRequest(), ct);
        }
        catch (Exception ex)
        {
            throw new EdgeBaseException(0, ex.Message, ex);
        }

        var responseBody = req.downloadHandler.text ?? string.Empty;
        if (req.result == UnityWebRequest.Result.ConnectionError)
        {
            throw new EdgeBaseException(0, req.error ?? "Network error");
        }

        if (req.responseCode < 200 || req.responseCode >= 300)
        {
            throw new EdgeBaseException((int)req.responseCode, responseBody);
        }

        return req.downloadHandler.data ?? Array.Empty<byte>();
    }

    private async Task<bool> SendUnityHeadAsync(string path, CancellationToken ct = default)
    {
        using var req = new UnityWebRequest(BaseUrl + path, "HEAD")
        {
            downloadHandler = new DownloadHandlerBuffer()
        };

        ApplyHeaders(req);

        try
        {
            await AwaitUnityRequestAsync(req.SendWebRequest(), ct);
        }
        catch (Exception ex)
        {
            throw new EdgeBaseException(0, ex.Message, ex);
        }

        if (req.result == UnityWebRequest.Result.ConnectionError)
        {
            throw new EdgeBaseException(0, req.error ?? "Network error");
        }

        return req.responseCode >= 200 && req.responseCode < 300;
    }
#endif

    public Task<Dictionary<string, object?>> GetAsync(string path,
        CancellationToken ct = default)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        return SendUnityJsonAsync("GET", path, null, ct);
#else
        var req = new System.Net.Http.HttpRequestMessage(
            System.Net.Http.HttpMethod.Get, BaseUrl + path);
        return SendAsync(req, ct);
#endif
    }

    public Task<Dictionary<string, object?>> PostAsync(string path,
        object? body = null, CancellationToken ct = default)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        return SendUnityJsonAsync("POST", path, SerializeBody(body), ct);
#else
        var req = new System.Net.Http.HttpRequestMessage(
            System.Net.Http.HttpMethod.Post, BaseUrl + path)
        {
            Content = new System.Net.Http.StringContent(
                System.Text.Json.JsonSerializer.Serialize(body ?? new { }, _json),
                System.Text.Encoding.UTF8, "application/json")
        };
        return SendAsync(req, ct);
#endif
    }

    public Task<Dictionary<string, object?>> PatchAsync(string path,
        object? body = null, CancellationToken ct = default)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        return SendUnityJsonAsync("PATCH", path, SerializeBody(body), ct);
#else
        var req = new System.Net.Http.HttpRequestMessage(
            new System.Net.Http.HttpMethod("PATCH"), BaseUrl + path)
        {
            Content = new System.Net.Http.StringContent(
                System.Text.Json.JsonSerializer.Serialize(body ?? new { }, _json),
                System.Text.Encoding.UTF8, "application/json")
        };
        return SendAsync(req, ct);
#endif
    }

    public Task<Dictionary<string, object?>> PutAsync(string path,
        object? body = null, CancellationToken ct = default)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        return SendUnityJsonAsync("PUT", path, SerializeBody(body), ct);
#else
        var req = new System.Net.Http.HttpRequestMessage(
            System.Net.Http.HttpMethod.Put, BaseUrl + path)
        {
            Content = new System.Net.Http.StringContent(
                System.Text.Json.JsonSerializer.Serialize(body ?? new { }, _json),
                System.Text.Encoding.UTF8, "application/json")
        };
        return SendAsync(req, ct);
#endif
    }

    public Task<Dictionary<string, object?>> DeleteAsync(string path,
        CancellationToken ct = default)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        return SendUnityJsonAsync("DELETE", path, null, ct);
#else
        var req = new System.Net.Http.HttpRequestMessage(
            System.Net.Http.HttpMethod.Delete, BaseUrl + path);
        return SendAsync(req, ct);
#endif
    }

    public Task<Dictionary<string, object?>> DeleteAsync(string path,
        object? body = null, CancellationToken ct = default)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        return SendUnityJsonAsync("DELETE", path, SerializeBody(body), ct);
#else
        var req = new System.Net.Http.HttpRequestMessage(
            System.Net.Http.HttpMethod.Delete, BaseUrl + path)
        {
            Content = new System.Net.Http.StringContent(
                System.Text.Json.JsonSerializer.Serialize(body ?? new { }, _json),
                System.Text.Encoding.UTF8, "application/json")
        };
        return SendAsync(req, ct);
#endif
    }

    /// <summary>HEAD request — returns true if resource exists (2xx).</summary>
    public async Task<bool> HeadAsync(string path,
        CancellationToken ct = default)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        return await SendUnityHeadAsync(path, ct);
#else
        var req = new System.Net.Http.HttpRequestMessage(
            System.Net.Http.HttpMethod.Head, BaseUrl + path);
        ApplyHeaders(req);
        var resp = await _http.SendAsync(req, ct);
        return resp.IsSuccessStatusCode;
#endif
    }

    public Task<Dictionary<string, object?>> GetWithQueryAsync(
        string path, Dictionary<string, string>? query = null,
        CancellationToken ct = default)
    {
        var url = path;
        if (query != null && query.Count > 0)
        {
            var parts = new System.Collections.Generic.List<string>();
            foreach (var kv in query)
                parts.Add($"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(kv.Value)}");
            url += "?" + string.Join("&", parts);
        }
        return GetAsync(url, ct);
    }

    public Task<Dictionary<string, object?>> PostAsyncWithQuery(
        string path, object? body = null, Dictionary<string, string>? query = null,
        CancellationToken ct = default)
    {
        var url = path;
        if (query != null && query.Count > 0)
        {
            var parts = new System.Collections.Generic.List<string>();
            foreach (var kv in query)
                parts.Add($"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(kv.Value)}");
            url += "?" + string.Join("&", parts);
        }
        return PostAsync(url, body, ct);
    }

    public Task<Dictionary<string, object?>> PutAsyncWithQuery(
        string path, object? body = null, Dictionary<string, string>? query = null,
        CancellationToken ct = default)
    {
        var url = path;
        if (query != null && query.Count > 0)
        {
            var parts = new System.Collections.Generic.List<string>();
            foreach (var kv in query)
                parts.Add($"{Uri.EscapeDataString(kv.Key)}={Uri.EscapeDataString(kv.Value)}");
            url += "?" + string.Join("&", parts);
        }
        return PutAsync(url, body, ct);
    }

    public async Task<Dictionary<string, object?>> UploadAsync(
        string path, string key, byte[] data, string contentType,
        CancellationToken ct = default)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        var formSections = new List<IMultipartFormSection>
        {
            new MultipartFormFileSection("file", data, key, contentType),
            new MultipartFormDataSection("key", key),
        };

        using var req = UnityWebRequest.Post(BaseUrl + path, formSections);
        req.downloadHandler = new DownloadHandlerBuffer();
        ApplyHeaders(req);

        try
        {
            await AwaitUnityRequestAsync(req.SendWebRequest(), ct);
        }
        catch (Exception ex)
        {
            throw new EdgeBaseException(0, ex.Message, ex);
        }

        var body = req.downloadHandler.text ?? string.Empty;
        if (req.result == UnityWebRequest.Result.ConnectionError)
        {
            throw new EdgeBaseException(0, req.error ?? "Network error");
        }

        if (req.responseCode < 200 || req.responseCode >= 300)
        {
            throw new EdgeBaseException((int)req.responseCode, body);
        }

        return DeserializeBody(body);
#else
        var form = new System.Net.Http.MultipartFormDataContent();
        var fileContent = new System.Net.Http.ByteArrayContent(data);
        fileContent.Headers.ContentType =
            System.Net.Http.Headers.MediaTypeHeaderValue.Parse(contentType);
        
        // C# 기본 Add(content, name, filename)은 filename*=utf-8 생성을 유발하여
        // Cloudflare Worker 파서에서 500 에러를 냄. 이를 피하고자 Header 수동 구성.
        fileContent.Headers.ContentDisposition = new System.Net.Http.Headers.ContentDispositionHeaderValue("form-data")
        {
            Name = "\"file\"",
            FileName = $"\"{key}\""
        };
        form.Add(fileContent);
        
        var keyContent = new System.Net.Http.StringContent(key);
        keyContent.Headers.ContentDisposition = new System.Net.Http.Headers.ContentDispositionHeaderValue("form-data")
        {
            Name = "\"key\""
        };
        form.Add(keyContent);

        var req = new System.Net.Http.HttpRequestMessage(
            System.Net.Http.HttpMethod.Post, BaseUrl + path) { Content = form };
        ApplyHeaders(req);
        var resp = await _http.SendAsync(req, ct);
        var body = await resp.Content.ReadAsStringAsync();
        if (!resp.IsSuccessStatusCode) throw new EdgeBaseException((int)resp.StatusCode, body);
        if (string.IsNullOrWhiteSpace(body)) return new Dictionary<string, object?>();
        return System.Text.Json.JsonSerializer
            .Deserialize<Dictionary<string, object?>>(body, _json) ?? new Dictionary<string, object?>();
#endif
    }

    /// <summary>POST raw bytes (for multipart upload-part).</summary>
    public async Task<Dictionary<string, object?>> PostBytesAsync(
        string path, byte[] data, string contentType = "application/octet-stream",
        CancellationToken ct = default)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        var bytes = await SendUnityBytesAsync("POST", path, data, contentType, ct);
        return DeserializeBody(Encoding.UTF8.GetString(bytes));
#else
        var content = new System.Net.Http.ByteArrayContent(data);
        content.Headers.ContentType =
            System.Net.Http.Headers.MediaTypeHeaderValue.Parse(contentType);
        var req = new System.Net.Http.HttpRequestMessage(
            System.Net.Http.HttpMethod.Post, BaseUrl + path) { Content = content };
        return await SendAsync(req, ct);
#endif
    }

    public async Task<byte[]> DownloadAsync(string path,
        CancellationToken ct = default)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        return await SendUnityBytesAsync("GET", path, null, null, ct);
#else
        var req = new System.Net.Http.HttpRequestMessage(
            System.Net.Http.HttpMethod.Get, BaseUrl + path);
        ApplyHeaders(req);
        var resp = await _http.SendAsync(req, ct);
        if (!resp.IsSuccessStatusCode)
        {
            var b = await resp.Content.ReadAsStringAsync();
            throw new EdgeBaseException((int)resp.StatusCode, b);
        }
        return await resp.Content.ReadAsByteArrayAsync();
#endif
    }

    public void Dispose()
    {
#if !(UNITY_WEBGL && !UNITY_EDITOR)
        _http.Dispose();
#endif
    }
}
}
