// RoomClient.cs — v2 real-time room connection.
// Unity / C# SDK.
//
// v2 changes from v1:
//   - 3 state areas: sharedState (all clients), playerState (per-player), serverState (server-only, not sent)
//   - Client can only read + subscribe + Send(). All writes are server-only.
//   - Send() returns Task<object?> resolved by requestId matching
//   - Subscription returns IDisposable (unsubscribe by calling Dispose)
//   - namespace + roomId identification (replaces single roomId)

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
#if !UNITY_WEBGL || UNITY_EDITOR
using System.Net.WebSockets;
#else
using System.Runtime.InteropServices;
#endif

namespace EdgeBase
{
    /// <summary>
    /// RoomClient v2 manages a WebSocket connection to a single EdgeBase Room.
    /// Create via <c>client.Room("namespace", "room-id")</c>.
    /// </summary>
    public class RoomClient : IDisposable
    {
        private const int RoomExplicitLeaveCloseDelayMs = 40;
        private const int AuthTimeoutMs = 10_000;

        /// <summary>Room namespace (e.g. "game", "chat").</summary>
        public readonly string Namespace;

        /// <summary>Room instance ID within the namespace.</summary>
        public readonly string RoomId;

        public readonly RoomStateNamespace State;
        public readonly RoomMetaNamespace Meta;
        public readonly RoomSignalsNamespace Signals;
        public readonly RoomMembersNamespace Members;
        public readonly RoomAdminNamespace Admin;
        public readonly RoomMediaNamespace Media;
        public readonly RoomSessionNamespace Session;

        // Lower-case aliases to match the additive unified room shape used in other SDKs.
        public RoomStateNamespace state => State;
        public RoomMetaNamespace meta => Meta;
        public RoomSignalsNamespace signals => Signals;
        public RoomMembersNamespace members => Members;
        public RoomAdminNamespace admin => Admin;
        public RoomMediaNamespace media => Media;
        public RoomSessionNamespace session => Session;

        private readonly string _baseUrl;
        private readonly Func<string?> _tokenGetter;
        private readonly int _maxReconnectAttempts;
        private readonly int _reconnectBaseDelayMs;
        private readonly int _sendTimeoutMs;
        private readonly int _connectionTimeoutMs;

        private Dictionary<string, object?> _sharedState = new();
        private int _sharedVersion;
        private Dictionary<string, object?> _playerState = new();
        private int _playerVersion;
        private List<Dictionary<string, object?>> _roomMembers = new();
        private List<Dictionary<string, object?>> _mediaMembers = new();

#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] private static extern int JB_WebSocket_Create(string url, Action<string> onMsg, Action onClose);
        [DllImport("__Internal")] private static extern void JB_WebSocket_Send(int id, string msg);
        [DllImport("__Internal")] private static extern void JB_WebSocket_Close(int id);
        [DllImport("__Internal")] private static extern int JB_WebSocket_IsOpen(int id);
        private int _wsId = -1;
#else
        private WebSocket? _ws;
#endif
        private bool _connected;
        private bool _authenticated;
        private bool _joined;
        private bool _intentionallyLeft;
        private bool _joinRequested;
        private int _reconnectAttempts;
        private CancellationTokenSource _cts = new();
        private Timer? _heartbeatTimer;
        private Task? _connectingTask;
        private string? _userId;
        private string? _connectionId;
        private string _connectionState = "idle";
        private Dictionary<string, object?>? _reconnectInfo;

        private readonly ConcurrentDictionary<string, PendingRequest> _pendingRequests = new();
        private readonly ConcurrentDictionary<string, PendingVoidRequest> _pendingSignalRequests = new();
        private readonly ConcurrentDictionary<string, PendingVoidRequest> _pendingAdminRequests = new();
        private readonly ConcurrentDictionary<string, PendingVoidRequest> _pendingMemberStateRequests = new();
        private readonly ConcurrentDictionary<string, PendingVoidRequest> _pendingMediaRequests = new();

        private readonly List<Action<Dictionary<string, object?>, Dictionary<string, object?>>> _sharedStateHandlers = new();
        private readonly List<Action<Dictionary<string, object?>, Dictionary<string, object?>>> _playerStateHandlers = new();
        private readonly Dictionary<string, List<Action<object?>>> _messageHandlers = new();
        private readonly List<Action<string, object?>> _allMessageHandlers = new();
        private readonly List<Action<Dictionary<string, string>>> _errorHandlers = new();
        private readonly List<Action> _kickedHandlers = new();
        private int? _lastCloseStatusCode;
        private readonly List<Action<List<Dictionary<string, object?>>>> _membersSyncHandlers = new();
        private readonly List<Action<Dictionary<string, object?>>> _memberJoinHandlers = new();
        private readonly List<Action<Dictionary<string, object?>, string>> _memberLeaveHandlers = new();
        private readonly List<Action<Dictionary<string, object?>, Dictionary<string, object?>>> _memberStateHandlers = new();
        private readonly Dictionary<string, List<Action<object?, Dictionary<string, object?>>>> _signalHandlers = new();
        private readonly List<Action<string, object?, Dictionary<string, object?>>> _anySignalHandlers = new();
        private readonly List<Action<Dictionary<string, object?>, Dictionary<string, object?>>> _mediaTrackHandlers = new();
        private readonly List<Action<Dictionary<string, object?>, Dictionary<string, object?>>> _mediaTrackRemovedHandlers = new();
        private readonly List<Action<Dictionary<string, object?>, Dictionary<string, object?>>> _mediaStateHandlers = new();
        private readonly List<Action<Dictionary<string, object?>, Dictionary<string, object?>>> _mediaDeviceHandlers = new();
        private readonly List<Action<Dictionary<string, object?>>> _reconnectHandlers = new();
        private readonly List<Action<string>> _connectionStateHandlers = new();

        private sealed class PendingRequest
        {
            public TaskCompletionSource<object?> Tcs { get; }
            public CancellationTokenSource TimeoutCts { get; }
            public CancellationTokenRegistration Registration { get; set; }

            public PendingRequest(TaskCompletionSource<object?> tcs, CancellationTokenSource timeoutCts)
            {
                Tcs = tcs;
                TimeoutCts = timeoutCts;
            }
        }

        private sealed class PendingVoidRequest
        {
            public TaskCompletionSource<bool> Tcs { get; }
            public CancellationTokenSource TimeoutCts { get; }
            public CancellationTokenRegistration Registration { get; set; }

            public PendingVoidRequest(TaskCompletionSource<bool> tcs, CancellationTokenSource timeoutCts)
            {
                Tcs = tcs;
                TimeoutCts = timeoutCts;
            }
        }

        public RoomClient(
            string baseUrl,
            string namespaceName,
            string roomId,
            Func<string?> tokenGetter,
            int maxReconnectAttempts = 10,
            int reconnectBaseDelayMs = 1000,
            int sendTimeoutMs = 10000,
            int connectionTimeoutMs = 15000
        )
        {
            _baseUrl = baseUrl.TrimEnd('/');
            Namespace = namespaceName;
            RoomId = roomId;
            _tokenGetter = tokenGetter;
            _maxReconnectAttempts = maxReconnectAttempts;
            _reconnectBaseDelayMs = reconnectBaseDelayMs;
            _sendTimeoutMs = sendTimeoutMs;
            _connectionTimeoutMs = connectionTimeoutMs;

            State = new RoomStateNamespace(this);
            Meta = new RoomMetaNamespace(this);
            Signals = new RoomSignalsNamespace(this);
            Members = new RoomMembersNamespace(this);
            Admin = new RoomAdminNamespace(this);
            Media = new RoomMediaNamespace(this);
            Session = new RoomSessionNamespace(this);
        }

        /// <summary>Get current shared state (read-only snapshot).</summary>
        public Dictionary<string, object?> GetSharedState() => CloneDict(_sharedState);

        /// <summary>Get current player state (read-only snapshot).</summary>
        public Dictionary<string, object?> GetPlayerState() => CloneDict(_playerState);

        public List<Dictionary<string, object?>> ListMembers() => CloneDictList(_roomMembers);

        public List<Dictionary<string, object?>> ListMediaMembers() => CloneDictList(_mediaMembers);

        public string ConnectionState() => _connectionState;

        public string? UserId() => _userId;

        public string? ConnectionId() => _connectionId;

#if !UNITY_WEBGL || UNITY_EDITOR
        public void AttachSocketForTesting(WebSocket socket, bool connected = true, bool authenticated = true, bool joined = true)
        {
            _ws = socket;
            _connected = connected;
            _authenticated = authenticated;
            _joined = joined;
        }
#endif

        public void HandleRawForTesting(string raw)
        {
            var message = ParseMessage(raw);
            if (message != null)
            {
                HandleMessage(message);
            }
        }

        /// <summary>
        /// Get room metadata without joining (HTTP GET).
        /// Returns developer-defined metadata set by room.setMetadata() on the server.
        /// </summary>
        public Task<Dictionary<string, object?>> GetMetadata()
        {
            return GetMetadata(_baseUrl, Namespace, RoomId);
        }

        /// <summary>
        /// Static: Get room metadata without creating a RoomClient instance.
        /// Useful for lobby screens where you need room info before joining.
        /// </summary>
        public static async Task<Dictionary<string, object?>> GetMetadata(string baseUrl, string namespaceName, string roomId)
        {
            var url = $"{baseUrl.TrimEnd('/')}/api/room/metadata?namespace={Uri.EscapeDataString(namespaceName)}&id={Uri.EscapeDataString(roomId)}";
            using var client = new HttpClient();
            var response = await client.GetAsync(url);
            if (!response.IsSuccessStatusCode)
            {
                throw new EdgeBaseException((int)response.StatusCode, $"Failed to get room metadata: {response.StatusCode}");
            }

            var body = await response.Content.ReadAsStringAsync();
            return JsonSerializer.Deserialize<Dictionary<string, object?>>(body) ?? new Dictionary<string, object?>();
        }

        /// <summary>Connect to the room, authenticate, and join.</summary>
        public async Task Join()
        {
            _intentionallyLeft = false;
            _joinRequested = true;
            if (_connected)
            {
                if (_connectingTask != null)
                {
                    await _connectingTask;
                }
                return;
            }

            SetConnectionState(_reconnectInfo != null ? "reconnecting" : "connecting");
            _connectingTask = EstablishConnection();
            try
            {
                await _connectingTask;
            }
            finally
            {
                _connectingTask = null;
            }
        }

        /// <summary>Leave the room and disconnect. Cancels all pending Send() requests.</summary>
        public void Leave()
        {
            _intentionallyLeft = true;
            _joinRequested = false;
            StopHeartbeat();

            RejectPendingRequests(new EdgeBaseException(499, "Room left"));

#if UNITY_WEBGL && !UNITY_EDITOR
            if (_wsId >= 0)
            {
                try
                {
                    JB_WebSocket_Send(_wsId, JsonSerializer.Serialize(new Dictionary<string, object?> { ["type"] = "leave" }));
                    Task.Delay(RoomExplicitLeaveCloseDelayMs).GetAwaiter().GetResult();
                }
                catch { }
                JB_WebSocket_Close(_wsId);
                _wsId = -1;
            }
#else
            var socket = _ws;
            if (socket != null)
            {
                try
                {
                    if (socket.State == WebSocketState.Open)
                    {
                        SendRaw(new Dictionary<string, object?> { ["type"] = "leave" }).GetAwaiter().GetResult();
                        Task.Delay(RoomExplicitLeaveCloseDelayMs).GetAwaiter().GetResult();
                    }
                }
                catch { }

                try
                {
                    if (socket.State == WebSocketState.Open || socket.State == WebSocketState.CloseReceived)
                    {
                        socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Client left room", CancellationToken.None)
                            .GetAwaiter()
                            .GetResult();
                    }
                    else
                    {
                        socket.Abort();
                    }
                }
                catch { }
                _ws = null;
            }
#endif

            if (!_cts.IsCancellationRequested)
            {
                _cts.Cancel();
            }
            _cts.Dispose();
            _cts = new CancellationTokenSource();

            _connected = false;
            _authenticated = false;
            _joined = false;
            _sharedState = new();
            _sharedVersion = 0;
            _playerState = new();
            _playerVersion = 0;
            _roomMembers = new();
            _mediaMembers = new();
            _userId = null;
            _connectionId = null;
            _reconnectInfo = null;
            SetConnectionState("disconnected");
        }

        public void Destroy() => Leave();

        /// <summary>
        /// Send an action to the server. Returns a Task resolved with the server result.
        /// Uses requestId + TaskCompletionSource for matching.
        /// </summary>
        public Task<object?> Send(string actionType, object? payload = null)
        {
            EnsureReady();

            var requestId = Guid.NewGuid().ToString();
            var tcs = new TaskCompletionSource<object?>(TaskCreationOptions.RunContinuationsAsynchronously);
            var timeoutCts = new CancellationTokenSource(_sendTimeoutMs);

            var pending = new PendingRequest(tcs, timeoutCts);
            pending.Registration = timeoutCts.Token.Register(() =>
            {
                if (_pendingRequests.TryRemove(requestId, out var removed))
                {
                    removed.Tcs.TrySetException(new EdgeBaseException(408, $"Action '{actionType}' timed out"));
                    removed.TimeoutCts.Dispose();
                }
            });

            _pendingRequests[requestId] = pending;
            _ = SendRaw(new Dictionary<string, object?>
            {
                ["type"] = "send",
                ["actionType"] = actionType,
                ["payload"] = payload ?? new Dictionary<string, object?>(),
                ["requestId"] = requestId,
            });
            return tcs.Task;
        }

        public Task SendSignal(string eventName, object? payload = null, Dictionary<string, object?>? options = null)
        {
            var message = new Dictionary<string, object?>
            {
                ["type"] = "signal",
                ["event"] = eventName,
                ["payload"] = payload ?? new Dictionary<string, object?>(),
            };
            if (options != null)
            {
                if (options.TryGetValue("includeSelf", out var includeSelf))
                {
                    message["includeSelf"] = ToBool(includeSelf);
                }
                if (options.TryGetValue("memberId", out var memberId) && memberId != null)
                {
                    message["memberId"] = memberId;
                }
            }
            return SendVoidRequest(message, _pendingSignalRequests, $"Signal '{eventName}' timed out");
        }

        public Task SendMemberState(Dictionary<string, object?> state)
        {
            return SendVoidRequest(
                new Dictionary<string, object?>
                {
                    ["type"] = "member_state",
                    ["state"] = state,
                },
                _pendingMemberStateRequests,
                "Member state update timed out"
            );
        }

        public Task ClearMemberState()
        {
            return SendVoidRequest(
                new Dictionary<string, object?>
                {
                    ["type"] = "member_state_clear",
                },
                _pendingMemberStateRequests,
                "Member state update timed out"
            );
        }

        public Task SendAdmin(string operation, string memberId, object? payload = null)
        {
            return SendVoidRequest(
                new Dictionary<string, object?>
                {
                    ["type"] = "admin",
                    ["operation"] = operation,
                    ["memberId"] = memberId,
                    ["payload"] = payload ?? new Dictionary<string, object?>(),
                },
                _pendingAdminRequests,
                $"Admin operation '{operation}' timed out"
            );
        }

        public Task SendMedia(string operation, string kind, object? payload = null)
        {
            return SendVoidRequest(
                new Dictionary<string, object?>
                {
                    ["type"] = "media",
                    ["operation"] = operation,
                    ["kind"] = kind,
                    ["payload"] = payload ?? new Dictionary<string, object?>(),
                },
                _pendingMediaRequests,
                $"Media operation '{operation}' timed out"
            );
        }

        public async Task SwitchMediaDevices(Dictionary<string, object?> payload)
        {
            var tasks = new List<Task>();
            if (payload.TryGetValue("audioInputId", out var audioInputId) && audioInputId is string audioId && !string.IsNullOrWhiteSpace(audioId))
            {
                tasks.Add(SendMedia("device", "audio", new Dictionary<string, object?> { ["deviceId"] = audioId }));
            }
            if (payload.TryGetValue("videoInputId", out var videoInputId) && videoInputId is string videoId && !string.IsNullOrWhiteSpace(videoId))
            {
                tasks.Add(SendMedia("device", "video", new Dictionary<string, object?> { ["deviceId"] = videoId }));
            }
            if (payload.TryGetValue("screenInputId", out var screenInputId) && screenInputId is string screenId && !string.IsNullOrWhiteSpace(screenId))
            {
                tasks.Add(SendMedia("device", "screen", new Dictionary<string, object?> { ["deviceId"] = screenId }));
            }

            await Task.WhenAll(tasks);
        }

        public IDisposable OnSharedState(Action<Dictionary<string, object?>, Dictionary<string, object?>> handler)
            => AddSubscription(_sharedStateHandlers, handler);

        public IDisposable OnPlayerState(Action<Dictionary<string, object?>, Dictionary<string, object?>> handler)
            => AddSubscription(_playerStateHandlers, handler);

        public IDisposable OnMessage(string messageType, Action<object?> handler)
        {
            if (!_messageHandlers.TryGetValue(messageType, out var handlers))
            {
                handlers = new List<Action<object?>>();
                _messageHandlers[messageType] = handlers;
            }
            handlers.Add(handler);
            return new Unsubscriber(() =>
            {
                if (_messageHandlers.TryGetValue(messageType, out var list))
                {
                    list.Remove(handler);
                }
            });
        }

        public IDisposable OnAnyMessage(Action<string, object?> handler)
            => AddSubscription(_allMessageHandlers, handler);

        public IDisposable OnError(Action<Dictionary<string, string>> handler)
            => AddSubscription(_errorHandlers, handler);

        public IDisposable OnKicked(Action handler)
            => AddSubscription(_kickedHandlers, handler);

        private IDisposable OnSignal(string eventName, Action<object?, Dictionary<string, object?>> handler)
        {
            if (!_signalHandlers.TryGetValue(eventName, out var handlers))
            {
                handlers = new List<Action<object?, Dictionary<string, object?>>>();
                _signalHandlers[eventName] = handlers;
            }
            handlers.Add(handler);
            return new Unsubscriber(() =>
            {
                if (_signalHandlers.TryGetValue(eventName, out var list))
                {
                    list.Remove(handler);
                }
            });
        }

        private IDisposable OnAnySignal(Action<string, object?, Dictionary<string, object?>> handler)
            => AddSubscription(_anySignalHandlers, handler);

        private IDisposable OnMembersSync(Action<List<Dictionary<string, object?>>> handler)
            => AddSubscription(_membersSyncHandlers, handler);

        private IDisposable OnMemberJoin(Action<Dictionary<string, object?>> handler)
            => AddSubscription(_memberJoinHandlers, handler);

        private IDisposable OnMemberLeave(Action<Dictionary<string, object?>, string> handler)
            => AddSubscription(_memberLeaveHandlers, handler);

        private IDisposable OnMemberStateChange(Action<Dictionary<string, object?>, Dictionary<string, object?>> handler)
            => AddSubscription(_memberStateHandlers, handler);

        private IDisposable OnReconnect(Action<Dictionary<string, object?>> handler)
            => AddSubscription(_reconnectHandlers, handler);

        private IDisposable OnConnectionStateChange(Action<string> handler)
            => AddSubscription(_connectionStateHandlers, handler);

        private IDisposable OnMediaTrack(Action<Dictionary<string, object?>, Dictionary<string, object?>> handler)
            => AddSubscription(_mediaTrackHandlers, handler);

        private IDisposable OnMediaTrackRemoved(Action<Dictionary<string, object?>, Dictionary<string, object?>> handler)
            => AddSubscription(_mediaTrackRemovedHandlers, handler);

        private IDisposable OnMediaStateChange(Action<Dictionary<string, object?>, Dictionary<string, object?>> handler)
            => AddSubscription(_mediaStateHandlers, handler);

        private IDisposable OnMediaDeviceChange(Action<Dictionary<string, object?>, Dictionary<string, object?>> handler)
            => AddSubscription(_mediaDeviceHandlers, handler);

        private async Task EstablishConnection()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            throw new PlatformNotSupportedException("WebGL Room not yet implemented in v2");
#else
            _cts = new CancellationTokenSource();
            var socket = new ClientWebSocket();
            try
            {
                using var connectCts = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token);
                connectCts.CancelAfter(_connectionTimeoutMs);
                try
                {
                    await socket.ConnectAsync(new Uri(WsUrl()), connectCts.Token);
                }
                catch (OperationCanceledException) when (!_cts.Token.IsCancellationRequested)
                {
                    throw new EdgeBaseException(408,
                        $"Room WebSocket connection timed out after {_connectionTimeoutMs}ms. Is the server running?");
                }
                _ws = socket;
                _connected = true;
                _reconnectAttempts = 0;
                StartHeartbeat();

                var token = _tokenGetter();
                if (string.IsNullOrWhiteSpace(token))
                {
                    throw new EdgeBaseException(401, "No access token available. Sign in first.");
                }
                await SendRaw(new Dictionary<string, object?> { ["type"] = "auth", ["token"] = token });

                var authTimeout = new CancellationTokenSource(AuthTimeoutMs);
                using var linked = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token, authTimeout.Token);
                while (!_authenticated && !linked.Token.IsCancellationRequested)
                {
                    var raw = await ReadMessage(linked.Token);
                    if (raw == null)
                    {
                        break;
                    }

                    var message = ParseMessage(raw);
                    if (message == null)
                    {
                        continue;
                    }

                    HandleMessage(message);
                    if (_authenticated)
                    {
                        await SendRaw(new Dictionary<string, object?>
                        {
                            ["type"] = "join",
                            ["lastSharedState"] = CloneDict(_sharedState),
                            ["lastSharedVersion"] = _sharedVersion,
                            ["lastPlayerState"] = CloneDict(_playerState),
                            ["lastPlayerVersion"] = _playerVersion,
                        });
                        break;
                    }

                    if (GetString(message, "type") == "error")
                    {
                        throw new EdgeBaseException(401, GetString(message, "message"));
                    }
                }

                _ = Task.Run(ReceiveLoop, _cts.Token);
            }
            catch (Exception ex)
            {
                _connected = false;
                _authenticated = false;
                _joined = false;
                StopHeartbeat();

#if !UNITY_WEBGL || UNITY_EDITOR
                try
                {
                    socket.Abort();
                    socket.Dispose();
                }
                catch { }
                _ws = null;
#else
                if (_wsId >= 0)
                {
                    try { JB_WebSocket_Close(_wsId); } catch { }
                    _wsId = -1;
                }
#endif

                if (!_intentionallyLeft)
                {
                    if (ex is EdgeBaseException edgeBaseError && edgeBaseError.StatusCode == 401)
                    {
                        SetConnectionState("auth_lost");
                    }
                    else if (_connectionState == "kicked")
                    {
                        SetConnectionState("kicked");
                    }
                    else
                    {
                        _ = ScheduleReconnect();
                    }
                }
                throw;
            }
#endif
        }

        private async Task ReceiveLoop()
        {
            try
            {
                while (_connected && !_cts.IsCancellationRequested)
                {
                    var raw = await ReadMessage(_cts.Token);
                    if (raw == null)
                    {
                        break;
                    }
                    var message = ParseMessage(raw);
                    if (message != null)
                    {
                        HandleMessage(message);
                    }
                }
            }
            catch { }

            _connected = false;
            _authenticated = false;
            _joined = false;
            StopHeartbeat();
            if (_lastCloseStatusCode == 4004 && _connectionState != "kicked")
            {
                HandleKicked();
            }
            _lastCloseStatusCode = null;
            if (!_intentionallyLeft)
            {
                await ScheduleReconnect();
            }
            else if (_connectionState != "kicked" && _connectionState != "auth_lost")
            {
                SetConnectionState("disconnected");
            }
        }

        private async Task<string?> ReadMessage(CancellationToken ct)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            return null;
#else
            if (_ws == null)
            {
                return null;
            }

            var buffer = new byte[65536];
            var builder = new StringBuilder();
            WebSocketReceiveResult result;
            do
            {
                result = await _ws.ReceiveAsync(new ArraySegment<byte>(buffer), ct);
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    _lastCloseStatusCode = result.CloseStatus.HasValue ? (int)result.CloseStatus.Value : (int?)null;
                    return null;
                }
                builder.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));
            } while (!result.EndOfMessage);
            return builder.ToString();
#endif
        }

        private void HandleMessage(Dictionary<string, object?> msg)
        {
            var type = GetString(msg, "type");
            switch (type)
            {
                case "auth_success":
                case "auth_refreshed":
                    HandleAuthAck(msg);
                    break;
                case "sync":
                    HandleSync(msg);
                    break;
                case "shared_delta":
                    HandleSharedDelta(msg);
                    break;
                case "player_delta":
                    HandlePlayerDelta(msg);
                    break;
                case "action_result":
                    HandleActionResult(msg);
                    break;
                case "action_error":
                    HandleActionError(msg);
                    break;
                case "message":
                    HandleServerMessage(msg);
                    break;
                case "signal":
                    HandleSignalFrame(msg);
                    break;
                case "signal_sent":
                    ResolvePendingVoid(_pendingSignalRequests, GetString(msg, "requestId"));
                    break;
                case "signal_error":
                    RejectPendingVoid(_pendingSignalRequests, GetString(msg, "requestId"), GetString(msg, "message"), 400);
                    break;
                case "members_sync":
                    HandleMembersSync(msg);
                    break;
                case "member_join":
                    HandleMemberJoinFrame(msg);
                    break;
                case "member_leave":
                    HandleMemberLeaveFrame(msg);
                    break;
                case "member_state":
                    HandleMemberStateFrame(msg);
                    break;
                case "member_state_error":
                    RejectPendingVoid(_pendingMemberStateRequests, GetString(msg, "requestId"), GetString(msg, "message"), 400);
                    break;
                case "media_sync":
                    HandleMediaSync(msg);
                    break;
                case "media_track":
                    HandleMediaTrackFrame(msg);
                    break;
                case "media_track_removed":
                    HandleMediaTrackRemovedFrame(msg);
                    break;
                case "media_state":
                    HandleMediaStateFrame(msg);
                    break;
                case "media_device":
                    HandleMediaDeviceFrame(msg);
                    break;
                case "media_result":
                    ResolvePendingVoid(_pendingMediaRequests, GetString(msg, "requestId"));
                    break;
                case "media_error":
                    RejectPendingVoid(_pendingMediaRequests, GetString(msg, "requestId"), GetString(msg, "message"), 400);
                    break;
                case "admin_result":
                    ResolvePendingVoid(_pendingAdminRequests, GetString(msg, "requestId"));
                    break;
                case "admin_error":
                    RejectPendingVoid(_pendingAdminRequests, GetString(msg, "requestId"), GetString(msg, "message"), 400);
                    break;
                case "kicked":
                    HandleKicked();
                    break;
                case "error":
                    HandleError(msg);
                    break;
                case "pong":
                    break;
            }
        }

        private void HandleAuthAck(Dictionary<string, object?> msg)
        {
            _authenticated = true;
            _userId = GetNullableString(msg, "userId") ?? _userId;
            _connectionId = GetNullableString(msg, "connectionId") ?? _connectionId;
        }

        private void HandleSync(Dictionary<string, object?> msg)
        {
            _sharedState = GetDict(msg, "sharedState");
            _sharedVersion = GetInt(msg, "sharedVersion");
            _playerState = GetDict(msg, "playerState");
            _playerVersion = GetInt(msg, "playerVersion");
            _joined = true;

            var reconnectInfo = _reconnectInfo;
            _reconnectInfo = null;
            SetConnectionState("connected");

            var sharedSnapshot = CloneDict(_sharedState);
            var playerSnapshot = CloneDict(_playerState);
            foreach (var handler in _sharedStateHandlers.ToArray())
            {
                handler(sharedSnapshot, CloneDict(sharedSnapshot));
            }
            foreach (var handler in _playerStateHandlers.ToArray())
            {
                handler(playerSnapshot, CloneDict(playerSnapshot));
            }

            if (reconnectInfo != null)
            {
                var infoSnapshot = CloneDict(reconnectInfo);
                foreach (var handler in _reconnectHandlers.ToArray())
                {
                    handler(infoSnapshot);
                }
            }
        }

        private void HandleSharedDelta(Dictionary<string, object?> msg)
        {
            var delta = GetDict(msg, "delta");
            _sharedVersion = GetInt(msg, "version");
            foreach (var item in delta)
            {
                DeepSet(_sharedState, item.Key, item.Value);
            }
            var sharedSnapshot = CloneDict(_sharedState);
            var deltaSnapshot = CloneDict(delta);
            foreach (var handler in _sharedStateHandlers.ToArray())
            {
                handler(sharedSnapshot, deltaSnapshot);
            }
        }

        private void HandlePlayerDelta(Dictionary<string, object?> msg)
        {
            var delta = GetDict(msg, "delta");
            _playerVersion = GetInt(msg, "version");
            foreach (var item in delta)
            {
                DeepSet(_playerState, item.Key, item.Value);
            }
            var playerSnapshot = CloneDict(_playerState);
            var deltaSnapshot = CloneDict(delta);
            foreach (var handler in _playerStateHandlers.ToArray())
            {
                handler(playerSnapshot, deltaSnapshot);
            }
        }

        private void HandleActionResult(Dictionary<string, object?> msg)
        {
            var requestId = GetString(msg, "requestId");
            if (_pendingRequests.TryRemove(requestId, out var pending))
            {
                pending.Registration.Dispose();
                pending.TimeoutCts.Dispose();
                msg.TryGetValue("result", out var result);
                pending.Tcs.TrySetResult(CloneValue(result));
            }
        }

        private void HandleActionError(Dictionary<string, object?> msg)
        {
            var requestId = GetString(msg, "requestId");
            if (_pendingRequests.TryRemove(requestId, out var pending))
            {
                pending.Registration.Dispose();
                pending.TimeoutCts.Dispose();
                pending.Tcs.TrySetException(new EdgeBaseException(400, GetString(msg, "message")));
            }
        }

        private void HandleServerMessage(Dictionary<string, object?> msg)
        {
            var messageType = GetString(msg, "messageType");
            msg.TryGetValue("data", out var data);
            data = CloneValue(data);

            if (_messageHandlers.TryGetValue(messageType, out var handlers))
            {
                foreach (var handler in handlers.ToArray())
                {
                    handler(data);
                }
            }

            foreach (var handler in _allMessageHandlers.ToArray())
            {
                handler(messageType, data);
            }
        }

        private void HandleMembersSync(Dictionary<string, object?> msg)
        {
            _roomMembers = GetDictList(msg, "members");
            SyncMediaMembersWithRoomMembers();
            var snapshot = CloneDictList(_roomMembers);
            foreach (var handler in _membersSyncHandlers.ToArray())
            {
                handler(CloneDictList(snapshot));
            }
        }

        private void HandleMemberJoinFrame(Dictionary<string, object?> msg)
        {
            var member = GetDict(msg, "member");
            if (member.Count == 0)
            {
                return;
            }
            UpsertRoomMember(member);
            var snapshot = CloneDict(member);
            foreach (var handler in _memberJoinHandlers.ToArray())
            {
                handler(CloneDict(snapshot));
            }
        }

        private void HandleMemberLeaveFrame(Dictionary<string, object?> msg)
        {
            var member = GetDict(msg, "member");
            var memberId = GetNullableString(member, "memberId") ?? GetNullableString(member, "userId");
            var reason = GetString(msg, "reason");
            if (!string.IsNullOrWhiteSpace(memberId))
            {
                _roomMembers.RemoveAll(item => GetNullableString(item, "memberId") == memberId);
                _mediaMembers.RemoveAll(item =>
                {
                    var mediaMember = GetDict(item, "member");
                    return GetNullableString(mediaMember, "memberId") == memberId;
                });
            }

            var snapshot = CloneDict(member);
            foreach (var handler in _memberLeaveHandlers.ToArray())
            {
                handler(CloneDict(snapshot), reason);
            }
        }

        private void HandleMemberStateFrame(Dictionary<string, object?> msg)
        {
            var member = GetDict(msg, "member");
            var state = GetDict(msg, "state");
            if (state.Count == 0 && member.TryGetValue("state", out var memberStateObj) && memberStateObj is Dictionary<string, object?> memberState)
            {
                state = CloneDict(memberState);
            }

            if (member.Count > 0)
            {
                UpsertRoomMember(member);
            }

            var requestId = GetNullableString(msg, "requestId");
            if (!string.IsNullOrWhiteSpace(requestId))
            {
                ResolvePendingVoid(_pendingMemberStateRequests, requestId);
            }

            var memberSnapshot = CloneDict(member);
            var stateSnapshot = CloneDict(state);
            foreach (var handler in _memberStateHandlers.ToArray())
            {
                handler(CloneDict(memberSnapshot), CloneDict(stateSnapshot));
            }
        }

        private void HandleSignalFrame(Dictionary<string, object?> msg)
        {
            var eventName = GetString(msg, "event");
            msg.TryGetValue("payload", out var payload);
            var payloadSnapshot = CloneValue(payload);
            var meta = GetDict(msg, "meta");

            if (_signalHandlers.TryGetValue(eventName, out var handlers))
            {
                foreach (var handler in handlers.ToArray())
                {
                    handler(CloneValue(payloadSnapshot), CloneDict(meta));
                }
            }

            foreach (var handler in _anySignalHandlers.ToArray())
            {
                handler(eventName, CloneValue(payloadSnapshot), CloneDict(meta));
            }
        }

        private void HandleMediaSync(Dictionary<string, object?> msg)
        {
            _mediaMembers = GetDictList(msg, "members");
            SyncMediaMembersWithRoomMembers();
        }

        private void HandleMediaTrackFrame(Dictionary<string, object?> msg)
        {
            var member = GetDict(msg, "member");
            var track = GetDict(msg, "track");
            if (member.Count == 0 || track.Count == 0)
            {
                return;
            }

            var mediaMember = EnsureMediaMember(member);
            if (!mediaMember.TryGetValue("tracks", out var tracksObject) || tracksObject is not List<object?> tracks)
            {
                tracks = new List<object?>();
                mediaMember["tracks"] = tracks;
            }

            var trackId = GetNullableString(track, "trackId");
            var kind = GetNullableString(track, "kind");
            var replaced = false;
            for (var index = 0; index < tracks.Count; index++)
            {
                if (tracks[index] is Dictionary<string, object?> existing)
                {
                    var existingTrackId = GetNullableString(existing, "trackId");
                    var existingKind = GetNullableString(existing, "kind");
                    if ((!string.IsNullOrWhiteSpace(trackId) && existingTrackId == trackId) ||
                        (string.IsNullOrWhiteSpace(trackId) && !string.IsNullOrWhiteSpace(kind) && existingKind == kind))
                    {
                        tracks[index] = CloneDict(track);
                        replaced = true;
                        break;
                    }
                }
            }

            if (!replaced)
            {
                tracks.Add(CloneDict(track));
            }

            var trackSnapshot = CloneDict(track);
            var memberSnapshot = CloneDict(member);
            foreach (var handler in _mediaTrackHandlers.ToArray())
            {
                handler(CloneDict(trackSnapshot), CloneDict(memberSnapshot));
            }
        }

        private void HandleMediaTrackRemovedFrame(Dictionary<string, object?> msg)
        {
            var member = GetDict(msg, "member");
            var track = GetDict(msg, "track");
            if (member.Count == 0 || track.Count == 0)
            {
                return;
            }

            var mediaMember = EnsureMediaMember(member);
            if (mediaMember.TryGetValue("tracks", out var tracksObject) && tracksObject is List<object?> tracks)
            {
                var trackId = GetNullableString(track, "trackId");
                var kind = GetNullableString(track, "kind");
                tracks.RemoveAll(item =>
                {
                    if (item is not Dictionary<string, object?> existing)
                    {
                        return false;
                    }
                    var existingTrackId = GetNullableString(existing, "trackId");
                    var existingKind = GetNullableString(existing, "kind");
                    return (!string.IsNullOrWhiteSpace(trackId) && existingTrackId == trackId) ||
                           (string.IsNullOrWhiteSpace(trackId) && !string.IsNullOrWhiteSpace(kind) && existingKind == kind);
                });
            }

            var trackSnapshot = CloneDict(track);
            var memberSnapshot = CloneDict(member);
            foreach (var handler in _mediaTrackRemovedHandlers.ToArray())
            {
                handler(CloneDict(trackSnapshot), CloneDict(memberSnapshot));
            }
        }

        private void HandleMediaStateFrame(Dictionary<string, object?> msg)
        {
            var member = GetDict(msg, "member");
            var state = GetDict(msg, "state");
            if (member.Count == 0)
            {
                return;
            }

            var mediaMember = EnsureMediaMember(member);
            mediaMember["state"] = CloneDict(state);
            var memberSnapshot = CloneDict(member);
            var stateSnapshot = CloneDict(state);
            foreach (var handler in _mediaStateHandlers.ToArray())
            {
                handler(CloneDict(memberSnapshot), CloneDict(stateSnapshot));
            }
        }

        private void HandleMediaDeviceFrame(Dictionary<string, object?> msg)
        {
            var member = GetDict(msg, "member");
            if (member.Count == 0)
            {
                return;
            }

            EnsureMediaMember(member);
            var change = new Dictionary<string, object?>
            {
                ["kind"] = GetString(msg, "kind"),
                ["deviceId"] = GetString(msg, "deviceId"),
            };

            var memberSnapshot = CloneDict(member);
            var changeSnapshot = CloneDict(change);
            foreach (var handler in _mediaDeviceHandlers.ToArray())
            {
                handler(CloneDict(memberSnapshot), CloneDict(changeSnapshot));
            }
        }

        private void HandleKicked()
        {
            _intentionallyLeft = true;
            SetConnectionState("kicked");
            foreach (var handler in _kickedHandlers.ToArray())
            {
                handler();
            }
        }

        private void HandleError(Dictionary<string, object?> msg)
        {
            var error = new Dictionary<string, string>
            {
                ["code"] = GetString(msg, "code"),
                ["message"] = GetString(msg, "message"),
            };
            foreach (var handler in _errorHandlers.ToArray())
            {
                handler(new Dictionary<string, string>(error));
            }
        }

        private string WsUrl()
        {
            var url = _baseUrl.Replace("https://", "wss://").Replace("http://", "ws://");
            return $"{url}/api/room?namespace={Uri.EscapeDataString(Namespace)}&id={Uri.EscapeDataString(RoomId)}";
        }

        private async Task SendRaw(Dictionary<string, object?> msg)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            if (_wsId >= 0)
            {
                JB_WebSocket_Send(_wsId, JsonSerializer.Serialize(msg));
            }
#else
            if (_ws == null || _ws.State != WebSocketState.Open)
            {
                return;
            }
            var json = JsonSerializer.Serialize(msg);
            var bytes = Encoding.UTF8.GetBytes(json);
            await _ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, _cts.Token);
#endif
        }

        private void StartHeartbeat()
        {
            _heartbeatTimer?.Dispose();
            _heartbeatTimer = new Timer(async _ =>
            {
                if (_connected && _authenticated)
                {
                    await SendRaw(new Dictionary<string, object?> { ["type"] = "ping" });
                }
            }, null, TimeSpan.FromSeconds(30), TimeSpan.FromSeconds(30));
        }

        private void StopHeartbeat()
        {
            _heartbeatTimer?.Dispose();
            _heartbeatTimer = null;
        }

        private async Task ScheduleReconnect()
        {
            if (_intentionallyLeft || _reconnectAttempts >= _maxReconnectAttempts)
            {
                if (!_intentionallyLeft && _connectionState != "kicked" && _connectionState != "auth_lost")
                {
                    SetConnectionState("disconnected");
                }
                return;
            }

            var attempt = _reconnectAttempts + 1;
            _reconnectAttempts = attempt;
            _reconnectInfo = new Dictionary<string, object?> { ["attempt"] = attempt };
            SetConnectionState("reconnecting");
            var delay = Math.Min(_reconnectBaseDelayMs * (int)Math.Pow(2, attempt - 1), 30_000);
            await Task.Delay(delay);
            if (!_joinRequested)
            {
                return;
            }
            try
            {
                await Join();
            }
            catch
            {
                if (!_intentionallyLeft)
                {
                    await ScheduleReconnect();
                }
            }
        }

        private void EnsureReady()
        {
            if (!_connected || !_authenticated)
            {
                throw new EdgeBaseException(400, "Not connected to room");
            }
        }

        private Task SendVoidRequest(
            Dictionary<string, object?> payload,
            ConcurrentDictionary<string, PendingVoidRequest> pendingStore,
            string timeoutMessage
        )
        {
            EnsureReady();

            var requestId = Guid.NewGuid().ToString();
            var tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            var timeoutCts = new CancellationTokenSource(_sendTimeoutMs);
            var pending = new PendingVoidRequest(tcs, timeoutCts);
            pending.Registration = timeoutCts.Token.Register(() =>
            {
                if (pendingStore.TryRemove(requestId, out var removed))
                {
                    removed.Tcs.TrySetException(new EdgeBaseException(408, timeoutMessage));
                    removed.TimeoutCts.Dispose();
                }
            });

            pendingStore[requestId] = pending;
            payload["requestId"] = requestId;
            _ = SendRaw(payload);
            return tcs.Task;
        }

        private void RejectPendingRequests(Exception error)
        {
            foreach (var item in _pendingRequests)
            {
                if (_pendingRequests.TryRemove(item.Key, out var pending))
                {
                    pending.Registration.Dispose();
                    pending.TimeoutCts.Dispose();
                    pending.Tcs.TrySetException(error);
                }
            }
            RejectPendingVoidRequests(_pendingSignalRequests, error);
            RejectPendingVoidRequests(_pendingAdminRequests, error);
            RejectPendingVoidRequests(_pendingMemberStateRequests, error);
            RejectPendingVoidRequests(_pendingMediaRequests, error);
        }

        private static void RejectPendingVoidRequests(ConcurrentDictionary<string, PendingVoidRequest> store, Exception error)
        {
            foreach (var item in store)
            {
                if (store.TryRemove(item.Key, out var pending))
                {
                    pending.Registration.Dispose();
                    pending.TimeoutCts.Dispose();
                    pending.Tcs.TrySetException(error);
                }
            }
        }

        private static void ResolvePendingVoid(ConcurrentDictionary<string, PendingVoidRequest> store, string requestId)
        {
            if (string.IsNullOrWhiteSpace(requestId))
            {
                return;
            }
            if (store.TryRemove(requestId, out var pending))
            {
                pending.Registration.Dispose();
                pending.TimeoutCts.Dispose();
                pending.Tcs.TrySetResult(true);
            }
        }

        private static void RejectPendingVoid(
            ConcurrentDictionary<string, PendingVoidRequest> store,
            string requestId,
            string message,
            int statusCode
        )
        {
            if (string.IsNullOrWhiteSpace(requestId))
            {
                return;
            }
            if (store.TryRemove(requestId, out var pending))
            {
                pending.Registration.Dispose();
                pending.TimeoutCts.Dispose();
                pending.Tcs.TrySetException(new EdgeBaseException(statusCode, message));
            }
        }

        private void UpsertRoomMember(Dictionary<string, object?> member)
        {
            var memberId = GetNullableString(member, "memberId") ?? GetNullableString(member, "userId");
            if (string.IsNullOrWhiteSpace(memberId))
            {
                return;
            }

            var index = _roomMembers.FindIndex(item =>
                string.Equals(GetNullableString(item, "memberId"), memberId, StringComparison.Ordinal));
            if (index >= 0)
            {
                _roomMembers[index] = CloneDict(member);
            }
            else
            {
                _roomMembers.Add(CloneDict(member));
            }
        }

        private void SyncMediaMembersWithRoomMembers()
        {
            _mediaMembers.RemoveAll(item =>
            {
                var member = GetDict(item, "member");
                var memberId = GetNullableString(member, "memberId");
                return !string.IsNullOrWhiteSpace(memberId) &&
                       !_roomMembers.Exists(roomMember => GetNullableString(roomMember, "memberId") == memberId);
            });
        }

        private Dictionary<string, object?> EnsureMediaMember(Dictionary<string, object?> member)
        {
            var memberId = GetNullableString(member, "memberId") ?? GetNullableString(member, "userId");
            if (string.IsNullOrWhiteSpace(memberId))
            {
                return new Dictionary<string, object?>();
            }

            var index = _mediaMembers.FindIndex(item =>
            {
                var existingMember = GetDict(item, "member");
                return GetNullableString(existingMember, "memberId") == memberId;
            });

            if (index >= 0)
            {
                var existing = _mediaMembers[index];
                existing["member"] = CloneDict(member);
                if (!existing.ContainsKey("state"))
                {
                    existing["state"] = new Dictionary<string, object?>();
                }
                if (!existing.TryGetValue("tracks", out var tracks) || tracks is not List<object?>)
                {
                    existing["tracks"] = new List<object?>();
                }
                return existing;
            }

            var created = new Dictionary<string, object?>
            {
                ["member"] = CloneDict(member),
                ["state"] = new Dictionary<string, object?>(),
                ["tracks"] = new List<object?>(),
            };
            _mediaMembers.Add(created);
            return created;
        }

        private void SetConnectionState(string state)
        {
            if (_connectionState == state)
            {
                return;
            }
            _connectionState = state;
            foreach (var handler in _connectionStateHandlers.ToArray())
            {
                handler(state);
            }
        }

        private static IDisposable AddSubscription<T>(List<T> list, T handler)
        {
            list.Add(handler);
            return new Unsubscriber(() => list.Remove(handler));
        }

        private static void DeepSet(Dictionary<string, object?> obj, string path, object? value)
        {
            var dot = path.IndexOf('.');
            if (dot < 0)
            {
                if (value == null)
                {
                    obj.Remove(path);
                }
                else
                {
                    obj[path] = CloneValue(value);
                }
                return;
            }

            var head = path[..dot];
            var tail = path[(dot + 1)..];
            if (!obj.TryGetValue(head, out var nested) || nested is not Dictionary<string, object?> nestedDict)
            {
                nestedDict = new Dictionary<string, object?>();
                obj[head] = nestedDict;
            }
            DeepSet(nestedDict, tail, value);
        }

        private static Dictionary<string, object?>? ParseMessage(string raw)
        {
            try
            {
                using var document = JsonDocument.Parse(raw);
                return JsonElementToObject(document.RootElement) as Dictionary<string, object?>;
            }
            catch
            {
                return null;
            }
        }

        private static object? JsonElementToObject(JsonElement element)
        {
            switch (element.ValueKind)
            {
                case JsonValueKind.Object:
                    var dict = new Dictionary<string, object?>();
                    foreach (var property in element.EnumerateObject())
                    {
                        dict[property.Name] = JsonElementToObject(property.Value);
                    }
                    return dict;
                case JsonValueKind.Array:
                    var list = new List<object?>();
                    foreach (var item in element.EnumerateArray())
                    {
                        list.Add(JsonElementToObject(item));
                    }
                    return list;
                case JsonValueKind.String:
                    return element.GetString();
                case JsonValueKind.Number:
                    if (element.TryGetInt64(out var longValue))
                    {
                        return longValue >= int.MinValue && longValue <= int.MaxValue ? (object)(int)longValue : longValue;
                    }
                    if (element.TryGetDouble(out var doubleValue))
                    {
                        return doubleValue;
                    }
                    return null;
                case JsonValueKind.True:
                case JsonValueKind.False:
                    return element.GetBoolean();
                case JsonValueKind.Null:
                case JsonValueKind.Undefined:
                    return null;
                default:
                    return element.ToString();
            }
        }

        private static Dictionary<string, object?> GetDict(Dictionary<string, object?> source, string key)
        {
            if (!source.TryGetValue(key, out var value) || value == null)
            {
                return new Dictionary<string, object?>();
            }
            return value switch
            {
                Dictionary<string, object?> dict => CloneDict(dict),
                JsonElement element when JsonElementToObject(element) is Dictionary<string, object?> parsed => parsed,
                _ => new Dictionary<string, object?>(),
            };
        }

        private static List<Dictionary<string, object?>> GetDictList(Dictionary<string, object?> source, string key)
        {
            if (!source.TryGetValue(key, out var value) || value == null)
            {
                return new List<Dictionary<string, object?>>();
            }
            if (value is List<object?> rawList)
            {
                var result = new List<Dictionary<string, object?>>();
                foreach (var item in rawList)
                {
                    if (item is Dictionary<string, object?> dict)
                    {
                        result.Add(CloneDict(dict));
                    }
                }
                return result;
            }
            if (value is List<Dictionary<string, object?>> dictList)
            {
                return CloneDictList(dictList);
            }
            return new List<Dictionary<string, object?>>();
        }

        private static string GetString(Dictionary<string, object?> source, string key)
        {
            return GetNullableString(source, key) ?? string.Empty;
        }

        private static string? GetNullableString(Dictionary<string, object?> source, string key)
        {
            if (!source.TryGetValue(key, out var value) || value == null)
            {
                return null;
            }
            return value switch
            {
                string text => text,
                JsonElement element when element.ValueKind == JsonValueKind.String => element.GetString(),
                _ => value.ToString(),
            };
        }

        private static int GetInt(Dictionary<string, object?> source, string key)
        {
            if (!source.TryGetValue(key, out var value) || value == null)
            {
                return 0;
            }

            return value switch
            {
                int intValue => intValue,
                long longValue => (int)longValue,
                double doubleValue => (int)doubleValue,
                JsonElement element when element.TryGetInt32(out var intValue) => intValue,
                JsonElement element when element.TryGetInt64(out var longValue) => (int)longValue,
                _ => int.TryParse(value.ToString(), out var parsed) ? parsed : 0,
            };
        }

        private static bool ToBool(object? value)
        {
            return value switch
            {
                bool boolValue => boolValue,
                JsonElement element when element.ValueKind == JsonValueKind.True => true,
                JsonElement element when element.ValueKind == JsonValueKind.False => false,
                string text when bool.TryParse(text, out var parsed) => parsed,
                _ => false,
            };
        }

        private static Dictionary<string, object?> CloneDict(Dictionary<string, object?> source)
        {
            var copy = new Dictionary<string, object?>(StringComparer.Ordinal);
            foreach (var item in source)
            {
                copy[item.Key] = CloneValue(item.Value);
            }
            return copy;
        }

        private static List<Dictionary<string, object?>> CloneDictList(List<Dictionary<string, object?>> source)
        {
            var copy = new List<Dictionary<string, object?>>(source.Count);
            foreach (var item in source)
            {
                copy.Add(CloneDict(item));
            }
            return copy;
        }

        private static object? CloneValue(object? value)
        {
            switch (value)
            {
                case null:
                    return null;
                case Dictionary<string, object?> dict:
                    return CloneDict(dict);
                case List<Dictionary<string, object?>> dictList:
                    return CloneDictList(dictList);
                case List<object?> list:
                    var copy = new List<object?>(list.Count);
                    foreach (var item in list)
                    {
                        copy.Add(CloneValue(item));
                    }
                    return copy;
                case JsonElement element:
                    return JsonElementToObject(element);
                default:
                    return value;
            }
        }

        public void Dispose() => Leave();

        private sealed class Unsubscriber : IDisposable
        {
            private Action? _unsubscribe;

            public Unsubscriber(Action unsubscribe)
            {
                _unsubscribe = unsubscribe;
            }

            public void Dispose()
            {
                _unsubscribe?.Invoke();
                _unsubscribe = null;
            }
        }

        public sealed class RoomStateNamespace
        {
            private readonly RoomClient _room;

            internal RoomStateNamespace(RoomClient room) => _room = room;

            public Dictionary<string, object?> GetShared() => _room.GetSharedState();

            public Dictionary<string, object?> GetMine() => _room.GetPlayerState();

            public IDisposable OnSharedChange(Action<Dictionary<string, object?>, Dictionary<string, object?>> handler)
                => _room.OnSharedState(handler);

            public IDisposable OnMineChange(Action<Dictionary<string, object?>, Dictionary<string, object?>> handler)
                => _room.OnPlayerState(handler);

            public Task<object?> Send(string actionType, object? payload = null) => _room.Send(actionType, payload);
        }

        public sealed class RoomMetaNamespace
        {
            private readonly RoomClient _room;

            internal RoomMetaNamespace(RoomClient room) => _room = room;

            public Task<Dictionary<string, object?>> Get() => _room.GetMetadata();
        }

        public sealed class RoomSignalsNamespace
        {
            private readonly RoomClient _room;

            internal RoomSignalsNamespace(RoomClient room) => _room = room;

            public Task Send(string eventName, object? payload = null, Dictionary<string, object?>? options = null)
                => _room.SendSignal(eventName, payload, options);

            public Task SendTo(string memberId, string eventName, object? payload = null)
                => _room.SendSignal(eventName, payload, new Dictionary<string, object?> { ["memberId"] = memberId });

            public IDisposable On(string eventName, Action<object?, Dictionary<string, object?>> handler)
                => _room.OnSignal(eventName, handler);

            public IDisposable OnAny(Action<string, object?, Dictionary<string, object?>> handler)
                => _room.OnAnySignal(handler);
        }

        public sealed class RoomMembersNamespace
        {
            private readonly RoomClient _room;

            internal RoomMembersNamespace(RoomClient room) => _room = room;

            public List<Dictionary<string, object?>> List() => _room.ListMembers();

            public IDisposable OnSync(Action<List<Dictionary<string, object?>>> handler) => _room.OnMembersSync(handler);

            public IDisposable OnJoin(Action<Dictionary<string, object?>> handler) => _room.OnMemberJoin(handler);

            public IDisposable OnLeave(Action<Dictionary<string, object?>, string> handler) => _room.OnMemberLeave(handler);

            public Task SetState(Dictionary<string, object?> state) => _room.SendMemberState(state);

            public Task ClearState() => _room.ClearMemberState();

            public IDisposable OnStateChange(Action<Dictionary<string, object?>, Dictionary<string, object?>> handler)
                => _room.OnMemberStateChange(handler);
        }

        public sealed class RoomAdminNamespace
        {
            private readonly RoomClient _room;

            internal RoomAdminNamespace(RoomClient room) => _room = room;

            public Task Kick(string memberId) => _room.SendAdmin("kick", memberId);

            public Task Mute(string memberId) => _room.SendAdmin("mute", memberId);

            public Task Block(string memberId) => _room.SendAdmin("block", memberId);

            public Task SetRole(string memberId, string role)
                => _room.SendAdmin("setRole", memberId, new Dictionary<string, object?> { ["role"] = role });

            public Task DisableVideo(string memberId) => _room.SendAdmin("disableVideo", memberId);

            public Task StopScreenShare(string memberId) => _room.SendAdmin("stopScreenShare", memberId);
        }

        public sealed class RoomMediaKindNamespace
        {
            private readonly RoomClient _room;
            private readonly string _kind;

            internal RoomMediaKindNamespace(RoomClient room, string kind)
            {
                _room = room;
                _kind = kind;
            }

            public Task Enable(Dictionary<string, object?>? payload = null) => _room.SendMedia("publish", _kind, payload);

            public Task Disable() => _room.SendMedia("unpublish", _kind);

            public Task SetMuted(bool muted)
                => _room.SendMedia("mute", _kind, new Dictionary<string, object?> { ["muted"] = muted });
        }

        public sealed class RoomScreenMediaNamespace
        {
            private readonly RoomClient _room;

            internal RoomScreenMediaNamespace(RoomClient room) => _room = room;

            public Task Start(Dictionary<string, object?>? payload = null) => _room.SendMedia("publish", "screen", payload);

            public Task Stop() => _room.SendMedia("unpublish", "screen");
        }

        public sealed class RoomMediaDevicesNamespace
        {
            private readonly RoomClient _room;

            internal RoomMediaDevicesNamespace(RoomClient room) => _room = room;

            public Task Switch(Dictionary<string, object?> payload) => _room.SwitchMediaDevices(payload);
        }

        public sealed class RoomMediaTransportOptions
        {
            public string Provider { get; set; } = "cloudflare_realtimekit";
            public Dictionary<string, object?>? CloudflareRealtimeKit { get; set; }
            public Dictionary<string, object?>? P2P { get; set; }

            public string provider
            {
                get => Provider;
                set => Provider = value;
            }

            public Dictionary<string, object?>? cloudflareRealtimeKit
            {
                get => CloudflareRealtimeKit;
                set => CloudflareRealtimeKit = value;
            }

            public Dictionary<string, object?>? p2p
            {
                get => P2P;
                set => P2P = value;
            }
        }

        public sealed class RoomMediaTransportUnavailableException : PlatformNotSupportedException
        {
            public string Provider { get; }
            public string DocumentationUrl { get; }

            internal RoomMediaTransportUnavailableException(string provider)
                : base(RoomMediaNamespace.BuildTransportUnavailableMessage(provider))
            {
                Provider = provider;
                DocumentationUrl = RoomMediaNamespace.DocumentationUrl;
            }
        }

        public sealed class RoomCloudflareRealtimeKitNamespace
        {
            private readonly RoomClient _room;

            internal RoomCloudflareRealtimeKitNamespace(RoomClient room) => _room = room;

            public Task<Dictionary<string, object?>> CreateSession(Dictionary<string, object?>? payload = null)
                => Task.FromException<Dictionary<string, object?>>(
                    RoomMediaNamespace.CreateTransportUnavailableException("cloudflare_realtimekit"));

            public Task<Dictionary<string, object?>> createSession(Dictionary<string, object?>? payload = null)
                => CreateSession(payload);
        }

        public sealed class RoomMediaTransport : IDisposable
        {
            public const string DocumentationUrl = RoomMediaNamespace.DocumentationUrl;

            public string Provider { get; }

            internal RoomMediaTransport(string provider)
            {
                Provider = string.IsNullOrWhiteSpace(provider) ? "cloudflare_realtimekit" : provider;
            }

            public Task<string> Connect(Dictionary<string, object?>? payload = null)
                => Unsupported<string>();

            public Task<object?> EnableAudio(object? constraints = null)
                => Unsupported<object?>();

            public Task<object?> EnableVideo(object? constraints = null)
                => Unsupported<object?>();

            public Task<object?> StartScreenShare(object? constraints = null)
                => Unsupported<object?>();

            public Task DisableAudio()
                => Unsupported();

            public Task DisableVideo()
                => Unsupported();

            public Task StopScreenShare()
                => Unsupported();

            public Task SetMuted(string kind, bool muted)
                => Unsupported();

            public Task SwitchDevices(Dictionary<string, object?> payload)
                => Unsupported();

            public IDisposable OnRemoteTrack(Action<Dictionary<string, object?>> handler)
                => throw RoomMediaNamespace.CreateTransportUnavailableException(Provider);

            public string? GetSessionId() => null;

            public object? GetPeerConnection() => null;

            public void Destroy()
            {
            }

            public void Dispose() => Destroy();

            public Task<string> connect(Dictionary<string, object?>? payload = null)
                => Connect(payload);

            public Task<object?> enableAudio(object? constraints = null)
                => EnableAudio(constraints);

            public Task<object?> enableVideo(object? constraints = null)
                => EnableVideo(constraints);

            public Task<object?> startScreenShare(object? constraints = null)
                => StartScreenShare(constraints);

            public Task disableAudio()
                => DisableAudio();

            public Task disableVideo()
                => DisableVideo();

            public Task stopScreenShare()
                => StopScreenShare();

            public Task setMuted(string kind, bool muted)
                => SetMuted(kind, muted);

            public Task switchDevices(Dictionary<string, object?> payload)
                => SwitchDevices(payload);

            public IDisposable onRemoteTrack(Action<Dictionary<string, object?>> handler)
                => OnRemoteTrack(handler);

            public string? getSessionId() => GetSessionId();

            public object? getPeerConnection() => GetPeerConnection();

            public void destroy() => Destroy();

            private Task Unsupported()
                => Task.FromException(RoomMediaNamespace.CreateTransportUnavailableException(Provider));

            private Task<T> Unsupported<T>()
                => Task.FromException<T>(RoomMediaNamespace.CreateTransportUnavailableException(Provider));
        }

        public sealed class RoomMediaNamespace
        {
            private readonly RoomClient _room;
            public const string DocumentationUrl = "https://edgebase.fun/docs/room/media";

            internal RoomMediaNamespace(RoomClient room)
            {
                _room = room;
                Audio = new RoomMediaKindNamespace(room, "audio");
                Video = new RoomMediaKindNamespace(room, "video");
                Screen = new RoomScreenMediaNamespace(room);
                Devices = new RoomMediaDevicesNamespace(room);
                CloudflareRealtimeKit = new RoomCloudflareRealtimeKitNamespace(room);
            }

            public RoomMediaKindNamespace Audio { get; }
            public RoomMediaKindNamespace Video { get; }
            public RoomScreenMediaNamespace Screen { get; }
            public RoomMediaDevicesNamespace Devices { get; }
            public RoomCloudflareRealtimeKitNamespace CloudflareRealtimeKit { get; }

            public RoomMediaKindNamespace audio => Audio;
            public RoomMediaKindNamespace video => Video;
            public RoomScreenMediaNamespace screen => Screen;
            public RoomMediaDevicesNamespace devices => Devices;
            public RoomCloudflareRealtimeKitNamespace cloudflareRealtimeKit => CloudflareRealtimeKit;

            public List<Dictionary<string, object?>> List() => _room.ListMediaMembers();

            public IDisposable OnTrack(Action<Dictionary<string, object?>, Dictionary<string, object?>> handler)
                => _room.OnMediaTrack(handler);

            public IDisposable OnTrackRemoved(Action<Dictionary<string, object?>, Dictionary<string, object?>> handler)
                => _room.OnMediaTrackRemoved(handler);

            public IDisposable OnStateChange(Action<Dictionary<string, object?>, Dictionary<string, object?>> handler)
                => _room.OnMediaStateChange(handler);

            public IDisposable OnDeviceChange(Action<Dictionary<string, object?>, Dictionary<string, object?>> handler)
                => _room.OnMediaDeviceChange(handler);

            public RoomMediaTransport Transport(RoomMediaTransportOptions? options = null)
                => new RoomMediaTransport(options?.Provider ?? "cloudflare_realtimekit");

            public RoomMediaTransport transport(RoomMediaTransportOptions? options = null)
                => Transport(options);

            internal static string BuildTransportUnavailableMessage(string provider)
                => $"Room media transport provider '{provider}' is not available yet in EdgeBase.Unity. See {DocumentationUrl}";

            internal static RoomMediaTransportUnavailableException CreateTransportUnavailableException(string provider)
                => new(provider);
        }

        public sealed class RoomSessionNamespace
        {
            private readonly RoomClient _room;

            internal RoomSessionNamespace(RoomClient room) => _room = room;

            public IDisposable OnError(Action<Dictionary<string, string>> handler) => _room.OnError(handler);

            public IDisposable OnKicked(Action handler) => _room.OnKicked(handler);

            public IDisposable OnReconnect(Action<Dictionary<string, object?>> handler) => _room.OnReconnect(handler);

            public IDisposable OnConnectionStateChange(Action<string> handler) => _room.OnConnectionStateChange(handler);

            public string? GetUserId() => _room.UserId();

            public string? GetConnectionId() => _room.ConnectionId();

            public string GetConnectionState() => _room.ConnectionState();
        }
    }
}
