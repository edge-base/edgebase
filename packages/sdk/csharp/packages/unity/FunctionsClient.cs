using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace EdgeBase
{
    public sealed class FunctionCallOptions
    {
        public string Method { get; set; } = "POST";
        public object? Body { get; set; }
        public Dictionary<string, string>? Query { get; set; }
    }

    public sealed class FunctionsClient
    {
        private readonly JbHttpClient _http;

        internal FunctionsClient(JbHttpClient http)
        {
            _http = http;
        }

        public Task<Dictionary<string, object?>> CallAsync(
            string path,
            FunctionCallOptions? options = null,
            CancellationToken ct = default)
        {
            var resolved = options ?? new FunctionCallOptions();
            var normalizedPath = $"/api/functions/{path.TrimStart('/')}";

            return resolved.Method.ToUpperInvariant() switch
            {
                "GET" => _http.GetWithQueryAsync(normalizedPath, resolved.Query, ct),
                "PUT" => _http.PutAsync(normalizedPath, resolved.Body, ct),
                "PATCH" => _http.PatchAsync(normalizedPath, resolved.Body, ct),
                "DELETE" => _http.DeleteAsync(normalizedPath, ct),
                _ => _http.PostAsync(normalizedPath, resolved.Body, ct),
            };
        }

        public Task<Dictionary<string, object?>> GetAsync(
            string path,
            Dictionary<string, string>? query = null,
            CancellationToken ct = default) =>
            CallAsync(path, new FunctionCallOptions { Method = "GET", Query = query }, ct);

        public Task<Dictionary<string, object?>> PostAsync(
            string path,
            object? body = null,
            CancellationToken ct = default) =>
            CallAsync(path, new FunctionCallOptions { Method = "POST", Body = body }, ct);

        public Task<Dictionary<string, object?>> PutAsync(
            string path,
            object? body = null,
            CancellationToken ct = default) =>
            CallAsync(path, new FunctionCallOptions { Method = "PUT", Body = body }, ct);

        public Task<Dictionary<string, object?>> PatchAsync(
            string path,
            object? body = null,
            CancellationToken ct = default) =>
            CallAsync(path, new FunctionCallOptions { Method = "PATCH", Body = body }, ct);

        public Task<Dictionary<string, object?>> DeleteAsync(
            string path,
            CancellationToken ct = default) =>
            CallAsync(path, new FunctionCallOptions { Method = "DELETE" }, ct);
    }
}
