// EdgeBase C# SDK — Database live transport
//
// WebSocket-based subscriptions with auto-reconnect.
// Supports: DB subscriptions.
// Implements: auth_refreshed + revokedChannels handling.
//
// Usage:
//   // DB 구독
//   var unsub = await client.Db("shared").Table("posts").OnSnapshot(...);

using System;
using System.Collections.Generic;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using EdgeBase.Generated;

namespace EdgeBase
{

// ─── DatabaseLiveClient ───

/// <summary>
/// Internal database live transport for EdgeBase (Unity).
/// </summary>
internal sealed class DatabaseLiveClient : IDisposable
{
    private readonly string _baseUrl;
    private readonly JbHttpClient _http;
    private readonly AuthClient? _auth;

    private ClientWebSocket? _ws;
    private CancellationTokenSource _cts = new();
    private bool _disposed;
    private bool _shouldReconnect = true;
    private int _reconnectAttempts;
    private bool _waitingForAuth;

    private readonly List<Action<Dictionary<string, object?>>> _messageHandlers = new();
    private readonly object _lock = new();

    /// Tracked subscriptions for resubscribeAll.
    private readonly HashSet<string> _subscribedChannels = new();
    /// Server-side filters per channel for recovery after FILTER_RESYNC.
    private readonly Dictionary<string, List<object[]>> _channelFilters = new();
    /// Server-side OR filters per channel for recovery after FILTER_RESYNC.
    private readonly Dictionary<string, List<object[]>> _channelOrFilters = new();

    internal DatabaseLiveClient(string baseUrl, JbHttpClient http, AuthClient? auth = null)
    {
        _baseUrl = baseUrl;
        _http    = http;
        _auth    = auth;
        if (_auth != null)
        {
            _auth.OnAuthStateChange += HandleAuthStateChange;
        }
    }

    private static string NormalizeDatabaseLiveChannel(string tableOrChannel)
        => tableOrChannel.StartsWith("dblive:", StringComparison.Ordinal) ? tableOrChannel : "dblive:" + tableOrChannel;

    private static string ChannelTableName(string channel)
    {
        var parts = channel.Split(':');
        return parts.Length switch
        {
            <= 1 => channel,
            2 => parts[1],
            3 => parts[2],
            _ => parts[3],
        };
    }

    private static bool MatchesDatabaseLiveChannel(string channel, DbChange change, string? messageChannel = null)
    {
        if (!string.IsNullOrWhiteSpace(messageChannel))
        {
            return string.Equals(channel, NormalizeDatabaseLiveChannel(messageChannel), StringComparison.Ordinal);
        }

        var parts = channel.Split(':');
        if (parts.Length == 0 || parts[0] != "dblive") return false;
        return parts.Length switch
        {
            2 => parts[1] == change.Table,
            3 => parts[2] == change.Table,
            4 => (parts[2] == change.Table && parts[3] == change.DocId) || parts[3] == change.Table,
            _ => parts[3] == change.Table && parts[4] == change.DocId,
        };
    }

    // ─── Connection ───

    private string BuildWsUrl(string? channel = null)
    {
        var url = _baseUrl.TrimEnd('/');
        url = url.Replace("https://", "wss://").Replace("http://", "ws://");
        var channelParam = channel != null ? $"?channel={Uri.EscapeDataString(channel)}" : "";
        return url + ApiPaths.CONNECT_DATABASE_SUBSCRIPTION + channelParam;
    }

    private async Task EnsureConnectedAsync(string? channel = null)
    {
        if (_ws?.State == WebSocketState.Open) return;
        await ConnectAsync(channel).ConfigureAwait(false);
    }

    private bool _authenticated;

    private async Task ConnectAsync(string? channel = null)
    {
        _ws?.Dispose();
        _ws = new ClientWebSocket();
        _cts = new CancellationTokenSource();
        _authenticated = false;

        try
        {
            await _ws.ConnectAsync(new Uri(BuildWsUrl(channel)), _cts.Token).ConfigureAwait(false);

            // Send WS auth message — DatabaseLiveDO requires type:"auth" to set meta.authenticated=true.
            // HTTP Authorization header is NOT processed by the DO for auth.
            var token = _http.GetAccessToken();
            if (!string.IsNullOrEmpty(token))
            {
                var authMsg = JsonSerializer.Serialize(new Dictionary<string, object?>
                {
                    ["type"]       = "auth",
                    ["token"]      = token,
                    ["sdkVersion"] = "0.2.7",
                });
                var authBytes = Encoding.UTF8.GetBytes(authMsg);
                await _ws.SendAsync(new ArraySegment<byte>(authBytes), WebSocketMessageType.Text, true, _cts.Token).ConfigureAwait(false);

                // Wait for auth_success or auth_refreshed response (up to 5s)
                var buf   = new byte[8192];
                var deadline = DateTime.UtcNow.AddSeconds(5);
                while (DateTime.UtcNow < deadline && _ws.State == WebSocketState.Open)
                {
                    using var cts2 = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token);
                    cts2.CancelAfter(TimeSpan.FromSeconds(5));
                    try
                    {
                        var res = await _ws.ReceiveAsync(new ArraySegment<byte>(buf), cts2.Token).ConfigureAwait(false);
                        var raw = Encoding.UTF8.GetString(buf, 0, res.Count);
                        var msg = JsonSerializer.Deserialize<Dictionary<string, object?>>(raw);
                        if (msg != null)
                        {
                            DispatchMessage(raw);
                            var t = msg.TryGetValue("type", out var tv) ? tv?.ToString() : null;
                            if (t == "auth_success")
                            {
                                _authenticated = true;
                                _reconnectAttempts = 0;
                                _waitingForAuth = false;
                                ResubscribeAll();
                                break;
                            }
                            if (t == "auth_refreshed")
                            {
                                _authenticated = true;
                                _reconnectAttempts = 0;
                                _waitingForAuth = false;
                                // Handle revokedChannels
                                HandleRevokedChannels(msg);
                                ResubscribeAll();
                                break;
                            }
                            if (t == "error") break; // auth failed
                        }
                    }
                    catch { break; }
                }
            }
            else
            {
                HandleAuthenticationFailure();
                return;
            }

            _ = ReceiveLoopAsync();
        }
        catch (Exception)
        {
            // Auto-reconnect handled externally if needed
        }
    }

    private async Task ReceiveLoopAsync()
    {
        var buf = new byte[8192];
        while (_ws?.State == WebSocketState.Open && !_cts.Token.IsCancellationRequested)
        {
            try
            {
                var result = await _ws.ReceiveAsync(new ArraySegment<byte>(buf), _cts.Token).ConfigureAwait(false);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    await TryReconnectAsync().ConfigureAwait(false);
                    return;
                }
                var json = Encoding.UTF8.GetString(buf, 0, result.Count);
                DispatchMessage(json);
            }
            catch (Exception)
            {
                if (_shouldReconnect) await TryReconnectAsync().ConfigureAwait(false);
                return;
            }
        }
    }

    private async Task TryReconnectAsync()
    {
        if (!_shouldReconnect || _disposed || _waitingForAuth) return;
        _authenticated = false;
        var delay = Math.Min(1000 * (int)Math.Pow(2, _reconnectAttempts), 30000);
        _reconnectAttempts++;
        await Task.Delay(delay).ConfigureAwait(false);
        await ConnectAsync().ConfigureAwait(false);
    }

    private void DispatchMessage(string raw)
    {
        Dictionary<string, object?>? msg;
        try { msg = JsonSerializer.Deserialize<Dictionary<string, object?>>(raw); }
        catch { return; }
        if (msg == null) return;

        // Handle auth_refreshed at runtime
        var msgType = msg.TryGetValue("type", out var typeVal) ? typeVal?.ToString() : null;
        if (msgType == "auth_refreshed")
        {
            HandleRevokedChannels(msg);
            // Dispatch subscription_revoked events to app listeners
            var revoked = ExtractRevokedChannels(msg);
            if (revoked.Count > 0)
            {
                List<Action<Dictionary<string, object?>>> handlers;
                lock (_lock) { handlers = new List<Action<Dictionary<string, object?>>>(_messageHandlers); }
                foreach (var ch in revoked)
                {
                    var evt = new Dictionary<string, object?> { ["type"] = "subscription_revoked", ["channel"] = ch };
                    foreach (var h in handlers) h(evt);
                }
            }
            return;
        }

        // Handle FILTER_RESYNC — server woke from hibernation
        if (msgType == "FILTER_RESYNC")
        {
            ResyncFilters();
            return;
        }

        List<Action<Dictionary<string, object?>>> allHandlers;
        lock (_lock) { allHandlers = new List<Action<Dictionary<string, object?>>>(_messageHandlers); }
        foreach (var h in allHandlers) h(msg);
    }

    // ───: revokedChannels handling ───

    private void HandleRevokedChannels(Dictionary<string, object?> msg)
    {
        var revoked = ExtractRevokedChannels(msg);
        lock (_lock)
        {
            foreach (var ch in revoked)
            {
                var normalized = NormalizeDatabaseLiveChannel(ch);
                _subscribedChannels.Remove(normalized);
                _channelFilters.Remove(normalized);
                _channelOrFilters.Remove(normalized);
            }
        }
    }

    private static List<string> ExtractRevokedChannels(Dictionary<string, object?> msg)
    {
        var result = new List<string>();
        if (msg.TryGetValue("revokedChannels", out var val) && val is JsonElement arr && arr.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in arr.EnumerateArray())
            {
                var s = item.GetString();
                if (s != null) result.Add(s);
            }
        }
        return result;
    }

    // ─── ResubscribeAll / ResyncFilters ───

    private void ResubscribeAll()
    {
        List<string> channels;
        lock (_lock) { channels = new List<string>(_subscribedChannels); }
        foreach (var channel in channels)
        {
            SendSubscribe(channel);
        }
    }

    private void SendSubscribe(string channel)
    {
        if (!_authenticated || _ws?.State != WebSocketState.Open) return;
        var msg = new Dictionary<string, object?> { ["type"] = "subscribe", ["channel"] = channel };
        lock (_lock)
        {
            if (_channelFilters.TryGetValue(channel, out var filters) && filters.Count > 0)
                msg["filters"] = filters;
            if (_channelOrFilters.TryGetValue(channel, out var orFilters) && orFilters.Count > 0)
                msg["orFilters"] = orFilters;
        }
        var json = JsonSerializer.Serialize(msg);
        var bytes = Encoding.UTF8.GetBytes(json);
        _ = _ws!.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, _cts.Token);
    }

    private void ResyncFilters()
    {
        Dictionary<string, List<object[]>> filters;
        Dictionary<string, List<object[]>> orFilters;
        lock (_lock)
        {
            filters = new Dictionary<string, List<object[]>>(_channelFilters);
            orFilters = new Dictionary<string, List<object[]>>(_channelOrFilters);
        }
        foreach (var channel in filters.Keys)
        {
            var f = filters.GetValueOrDefault(channel) ?? new List<object[]>();
            var of = orFilters.GetValueOrDefault(channel) ?? new List<object[]>();
            if (f.Count > 0 || of.Count > 0)
            {
                var msg = new Dictionary<string, object?> { ["type"] = "subscribe", ["channel"] = channel };
                if (f.Count > 0) msg["filters"] = f;
                if (of.Count > 0) msg["orFilters"] = of;
                var json = JsonSerializer.Serialize(msg);
                var bytes = Encoding.UTF8.GetBytes(json);
                _ = _ws?.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, _cts.Token);
            }
        }
    }

    // ─── Send ───

    internal async Task SendAsync(Dictionary<string, object?> message)
    {
        await EnsureConnectedAsync().ConfigureAwait(false);
        if (_ws?.State != WebSocketState.Open) return;
        var json = JsonSerializer.Serialize(message);
        var bytes = Encoding.UTF8.GetBytes(json);
        await _ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, _cts.Token).ConfigureAwait(false);
    }

    // ─── Message handler registry ───

    internal IDisposable AddMessageHandler(Action<Dictionary<string, object?>> handler)
    {
        lock (_lock) { _messageHandlers.Add(handler); }
        return new Disposable(() => { lock (_lock) { _messageHandlers.Remove(handler); } });
    }

    // ─── OnSnapshot ───

    /// <summary>
    /// Subscribe to DB table changes.
    /// Returns an IDisposable — dispose to unsubscribe.
    /// </summary>
    public async Task<IDisposable> OnSnapshot(
        string tableName,
        Action<DbChange> handler,
        IEnumerable<object[]>? filters = null,
        IEnumerable<object[]>? orFilters = null)
    {
        var channel = NormalizeDatabaseLiveChannel(tableName);
        await EnsureConnectedAsync(channel).ConfigureAwait(false);

        lock (_lock)
        {
            _subscribedChannels.Add(channel);

            if (filters != null)
            {
                var filterList = new List<object[]>();
                foreach (var filter in filters)
                {
                    filterList.Add((object[])filter.Clone());
                }
                _channelFilters[channel] = filterList;
            }
            else
            {
                _channelFilters.Remove(channel);
            }

            if (orFilters != null)
            {
                var orFilterList = new List<object[]>();
                foreach (var filter in orFilters)
                {
                    orFilterList.Add((object[])filter.Clone());
                }
                _channelOrFilters[channel] = orFilterList;
            }
            else
            {
                _channelOrFilters.Remove(channel);
            }
        }
        SendSubscribe(channel);

        return AddMessageHandler(msg =>
        {
            if (msg.TryGetValue("type", out var t) && t?.ToString() == "db_change")
            {
                var change = new DbChange
                {
                    ChangeType = msg.TryGetValue("changeType", out var ct) ? ct?.ToString() ?? "" : "",
                    Table      = msg.TryGetValue("table", out var tbl) ? tbl?.ToString() ?? "" : "",
                    DocId      = msg.TryGetValue("docId", out var did) ? did?.ToString() ?? "" : "",
                    Timestamp  = msg.TryGetValue("timestamp", out var ts) ? ts?.ToString() ?? "" : "",
                    Data       = msg.TryGetValue("data", out var d) ? d as Dictionary<string, object?> : null,
                };
                var messageChannel = msg.TryGetValue("channel", out var ch) ? ch?.ToString() : null;
                if (MatchesDatabaseLiveChannel(channel, change, messageChannel))
                {
                    handler(change);
                }
            }
            else if (msg.TryGetValue("type", out t) && t?.ToString() == "batch_changes"
                && msg.TryGetValue("changes", out var rawChanges)
                && rawChanges is JsonElement changes
                && changes.ValueKind == JsonValueKind.Array)
            {
                var fallbackTable = msg.TryGetValue("table", out var tableObj) && tableObj != null
                    ? tableObj.ToString() ?? ""
                    : ChannelTableName(channel);
                foreach (var item in changes.EnumerateArray())
                {
                    var change = new DbChange
                    {
                        ChangeType = item.TryGetProperty("event", out var evt) ? evt.GetString() ?? "" : "",
                        Table = fallbackTable,
                        DocId = item.TryGetProperty("docId", out var docId) ? docId.GetString() ?? "" : "",
                        Timestamp = item.TryGetProperty("timestamp", out var timestamp) ? timestamp.GetString() ?? "" : "",
                        Data = item.TryGetProperty("data", out var data) && data.ValueKind == JsonValueKind.Object
                            ? JsonSerializer.Deserialize<Dictionary<string, object?>>(data.GetRawText())
                            : null,
                    };
                    var messageChannel = msg.TryGetValue("channel", out var ch) ? ch?.ToString() : null;
                    if (MatchesDatabaseLiveChannel(channel, change, messageChannel))
                    {
                        handler(change);
                    }
                }
            }
        });
    }

    // ─── Cleanup ───

    /// <summary>Disconnect WebSocket and release resources.</summary>
    public void Destroy()
    {
        if (_disposed) return;
        _disposed = true;
        _shouldReconnect = false;
        _authenticated = false;
        _cts.Cancel();
        try
        {
            if (_ws?.State == WebSocketState.Open)
            {
                _ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "Client destroyed", CancellationToken.None)
                    .GetAwaiter().GetResult();
            }
        }
        catch (ObjectDisposedException) { /* already disposed */ }
        catch (WebSocketException) { /* connection was never established */ }
        _ws?.Dispose();
        _ws = null;
        lock (_lock)
        {
            _subscribedChannels.Clear();
            _channelFilters.Clear();
            _channelOrFilters.Clear();
        }
        if (_auth != null)
        {
            _auth.OnAuthStateChange -= HandleAuthStateChange;
        }
    }

    /// <inheritdoc/>
    public void Dispose() => Destroy();

    // ─── Helper ───

    private sealed class Disposable : IDisposable
    {
        private readonly Action _action;
        public Disposable(Action action) => _action = action;
        public void Dispose() => _action();
    }

    private void RefreshAuth()
    {
        var token = _http.GetAccessToken();
        if (string.IsNullOrEmpty(token) || _ws?.State != WebSocketState.Open) return;
        var json = JsonSerializer.Serialize(new Dictionary<string, object?>
        {
            ["type"] = "auth",
            ["token"] = token,
            ["sdkVersion"] = "0.2.7",
        });
        var bytes = Encoding.UTF8.GetBytes(json);
        _ = _ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, _cts.Token);
    }

    private void HandleAuthStateChange(Dictionary<string, object?>? user)
    {
        if (user != null)
        {
            if (_ws?.State == WebSocketState.Open && _authenticated)
            {
                RefreshAuth();
                return;
            }

            _waitingForAuth = false;
            if (_subscribedChannels.Count > 0 && _ws?.State != WebSocketState.Open)
            {
                var firstChannel = default(string);
                lock (_lock)
                {
                    foreach (var channel in _subscribedChannels)
                    {
                        firstChannel = channel;
                        break;
                    }
                }
                if (firstChannel != null)
                {
                    _ = ConnectAsync(firstChannel);
                }
            }
            return;
        }

        _waitingForAuth = _subscribedChannels.Count > 0;
        _authenticated = false;
        _ws?.Abort();
        _ws?.Dispose();
        _ws = null;
    }

    private void HandleAuthenticationFailure()
    {
        var hasSession = !string.IsNullOrEmpty(_http.GetRefreshToken());
        _waitingForAuth = _subscribedChannels.Count > 0 && !hasSession;
        _authenticated = false;
        _ws?.Abort();
        _ws?.Dispose();
        _ws = null;

        // Attempt reconnection with fresh token if subscriptions are active
        if (_subscribedChannels.Count > 0 && hasSession)
        {
            _waitingForAuth = false;
            _ = TryReconnectAsync();
        }
    }
}
}
