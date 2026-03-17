using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Xunit;
// EdgeBase C# Unity SDK 단위 테스트 — EdgeBase (Unity) 클라이언트 구조 검증
//
// 실행: cd packages/sdk/csharp/packages/unity/tests && dotnet test
//
// 원칙: 서버 불필요, 순수 클래스 구조/생성 검증

namespace EdgeBase.Tests
{
    // ─── A. EdgeBase (Unity) 생성 ────────────────────────────────────────────

    public class EdgeBaseUnityConstructorTests
    {
        [Fact]
        public void Instantiation_succeeds()
        {
            using var client = new EdgeBase("https://dummy.edgebase.fun");
            Assert.NotNull(client);
        }

        [Fact]
        public void CreateClient_factory_returns_instance()
        {
            using var client = EdgeBase.CreateClient("https://dummy.edgebase.fun");
            Assert.NotNull(client);
        }

        [Fact]
        public void BaseUrl_strips_trailing_slash()
        {
            using var client = new EdgeBase("https://dummy.edgebase.fun/");
            Assert.Equal("https://dummy.edgebase.fun", client.BaseUrl);
        }

        [Fact]
        public void Auth_property_exists()
        {
            using var client = new EdgeBase("https://dummy.edgebase.fun");
            Assert.NotNull(client.Auth);
        }

        [Fact]
        public void Storage_property_exists()
        {
            using var client = new EdgeBase("https://dummy.edgebase.fun");
            Assert.NotNull(client.Storage);
        }

        [Fact]
        public void Push_property_exists()
        {
            using var client = new EdgeBase("https://dummy.edgebase.fun");
            Assert.NotNull(client.Push);
        }

        [Fact]
        public void Functions_property_exists()
        {
            using var client = new EdgeBase("https://dummy.edgebase.fun");
            Assert.NotNull(client.Functions);
        }

        [Fact]
        public void Analytics_property_exists()
        {
            using var client = new EdgeBase("https://dummy.edgebase.fun");
            Assert.NotNull(client.Analytics);
        }

        [Fact]
        public void Context_methods_exist()
        {
            Assert.NotNull(typeof(EdgeBase).GetMethod("SetContext"));
            Assert.NotNull(typeof(EdgeBase).GetMethod("GetContext"));
            Assert.NotNull(typeof(EdgeBase).GetMethod("ClearContext"));
        }

        [Fact]
        public void Db_method_returns_non_null()
        {
            using var client = new EdgeBase("https://dummy.edgebase.fun");
            var db = client.Db("shared");
            Assert.NotNull(db);
        }

        [Fact]
        public void Db_table_returns_non_null()
        {
            using var client = new EdgeBase("https://dummy.edgebase.fun");
            var table = client.Db("shared").Table("posts");
            Assert.NotNull(table);
        }

        [Fact]
        public void Db_with_instanceId_returns_non_null()
        {
            using var client = new EdgeBase("https://dummy.edgebase.fun");
            var db = client.Db("workspace", "ws-123");
            Assert.NotNull(db);
        }

        [Fact]
        public void Implements_IDisposable()
        {
            var client = new EdgeBase("https://dummy.edgebase.fun");
            Assert.IsAssignableFrom<IDisposable>(client);
            client.Dispose();
        }

        [Fact]
        public void Destroy_alias_exists_and_is_safe()
        {
            var client = new EdgeBase("https://dummy.edgebase.fun");
            client.Destroy();
        }

        [Fact]
        public void Db_table_preserves_name()
        {
            using var client = new EdgeBase("https://dummy.edgebase.fun");
            var table = client.Db("shared").Table("users");
            Assert.Equal("users", table.Name);
        }

        [Fact]
        public void Multiple_Db_calls_return_independent_refs()
        {
            using var client = new EdgeBase("https://dummy.edgebase.fun");
            var db1 = client.Db("shared");
            var db2 = client.Db("workspace", "ws-1");
            Assert.NotSame(db1, db2);
        }
    }

    // ─── B. TableRef 메서드 구조 ──────────────────────────────────────────────

    public class UnityTableRefTests
    {
        [Fact]
        public void Where_method_exists()
        {
            var method = typeof(TableRef).GetMethod("Where");
            Assert.NotNull(method);
        }

        [Fact]
        public void Limit_method_exists()
        {
            var method = typeof(TableRef).GetMethod("Limit");
            Assert.NotNull(method);
        }

        [Fact]
        public void OrderBy_method_exists()
        {
            var method = typeof(TableRef).GetMethod("OrderBy");
            Assert.NotNull(method);
        }

        [Fact]
        public void GetListAsync_method_exists()
        {
            var hasMethod = typeof(TableRef).GetMethods().Any(m => m.Name == "GetListAsync");
            Assert.True(hasMethod);
        }

        [Fact]
        public void InsertAsync_method_exists()
        {
            var method = typeof(TableRef).GetMethod("InsertAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void CountAsync_method_exists()
        {
            var method = typeof(TableRef).GetMethod("CountAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void UpdateAsync_method_exists()
        {
            var method = typeof(TableRef).GetMethod("UpdateAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void DeleteAsync_method_exists()
        {
            var method = typeof(TableRef).GetMethod("DeleteAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void UpsertAsync_method_exists()
        {
            var method = typeof(TableRef).GetMethod("UpsertAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void InsertManyAsync_method_exists()
        {
            var method = typeof(TableRef).GetMethod("InsertManyAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void UpdateManyAsync_method_exists()
        {
            var method = typeof(TableRef).GetMethod("UpdateManyAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void DeleteManyAsync_method_exists()
        {
            var method = typeof(TableRef).GetMethod("DeleteManyAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void GetOneAsync_method_exists()
        {
            var method = typeof(TableRef).GetMethod("GetOneAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void Search_method_exists()
        {
            var method = typeof(TableRef).GetMethod("Search");
            Assert.NotNull(method);
        }

        [Fact]
        public void Or_method_exists()
        {
            var method = typeof(TableRef).GetMethod("Or");
            Assert.NotNull(method);
        }

        [Fact]
        public void Doc_method_exists()
        {
            var method = typeof(TableRef).GetMethod("Doc");
            Assert.NotNull(method);
        }

        [Fact]
        public void After_method_exists()
        {
            var method = typeof(TableRef).GetMethod("After");
            Assert.NotNull(method);
        }

        [Fact]
        public void Before_method_exists()
        {
            var method = typeof(TableRef).GetMethod("Before");
            Assert.NotNull(method);
        }

        [Fact]
        public void Offset_method_exists()
        {
            var method = typeof(TableRef).GetMethod("Offset");
            Assert.NotNull(method);
        }

        [Fact]
        public void Page_method_exists()
        {
            var method = typeof(TableRef).GetMethod("Page");
            Assert.NotNull(method);
        }

        [Fact]
        public void UpsertManyAsync_method_exists()
        {
            var method = typeof(TableRef).GetMethod("UpsertManyAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void WithDb_static_method_exists()
        {
            var method = typeof(TableRef).GetMethod("WithDb");
            Assert.NotNull(method);
        }
    }

    // ─── C. AuthClient (Unity) 메서드 구조 ────────────────────────────────────

    public class UnityAuthClientTests
    {
        [Fact]
        public void SignUpAsync_method_exists()
        {
            var method = typeof(AuthClient).GetMethod("SignUpAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void SignInAsync_method_exists()
        {
            var method = typeof(AuthClient).GetMethod("SignInAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void SignOutAsync_method_exists()
        {
            var method = typeof(AuthClient).GetMethod("SignOutAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void SignInAnonymouslyAsync_method_exists()
        {
            var method = typeof(AuthClient).GetMethod("SignInAnonymouslyAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void SignInWithOAuth_method_exists()
        {
            var method = typeof(AuthClient).GetMethod("SignInWithOAuth");
            Assert.NotNull(method);
        }

        [Fact]
        public void LinkWithEmailAsync_method_exists()
        {
            var method = typeof(AuthClient).GetMethod("LinkWithEmailAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void LinkWithOAuth_method_exists()
        {
            var method = typeof(AuthClient).GetMethod("LinkWithOAuth");
            Assert.NotNull(method);
        }

        [Fact]
        public void UpdateProfileAsync_method_exists()
        {
            var method = typeof(AuthClient).GetMethod("UpdateProfileAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void ListSessionsAsync_method_exists()
        {
            var method = typeof(AuthClient).GetMethod("ListSessionsAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void RevokeSessionAsync_method_exists()
        {
            var method = typeof(AuthClient).GetMethod("RevokeSessionAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void VerifyEmailAsync_method_exists()
        {
            var method = typeof(AuthClient).GetMethod("VerifyEmailAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void RequestPasswordResetAsync_method_exists()
        {
            var method = typeof(AuthClient).GetMethod("RequestPasswordResetAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void ResetPasswordAsync_method_exists()
        {
            var method = typeof(AuthClient).GetMethod("ResetPasswordAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void ChangePasswordAsync_method_exists()
        {
            var method = typeof(AuthClient).GetMethod("ChangePasswordAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void GetAccessToken_method_exists()
        {
            var method = typeof(AuthClient).GetMethod("GetAccessToken");
            Assert.NotNull(method);
        }

        [Fact]
        public void SetAccessToken_method_exists()
        {
            var method = typeof(AuthClient).GetMethod("SetAccessToken");
            Assert.NotNull(method);
        }

        [Fact]
        public void CurrentToken_property_exists()
        {
            var prop = typeof(AuthClient).GetProperty("CurrentToken");
            Assert.NotNull(prop);
        }

        [Fact]
        public void OnAuthStateChange_event_exists()
        {
            var ev = typeof(AuthClient).GetEvent("OnAuthStateChange");
            Assert.NotNull(ev);
        }

        [Fact]
        public void Passkeys_methods_exist()
        {
            Assert.NotNull(typeof(AuthClient).GetMethod("PasskeysRegisterOptionsAsync"));
            Assert.NotNull(typeof(AuthClient).GetMethod("PasskeysRegisterAsync"));
            Assert.NotNull(typeof(AuthClient).GetMethod("PasskeysAuthOptionsAsync", new[] { typeof(string), typeof(System.Threading.CancellationToken) }));
            Assert.NotNull(typeof(AuthClient).GetMethod("PasskeysAuthenticateAsync"));
            Assert.NotNull(typeof(AuthClient).GetMethod("PasskeysListAsync"));
            Assert.NotNull(typeof(AuthClient).GetMethod("PasskeysDeleteAsync"));
        }
    }

    internal sealed class MiniConfigServer : IDisposable
    {
        private readonly TcpListener _listener;
        private readonly CancellationTokenSource _cts = new();
        private readonly Task _serverTask;
        private readonly string _siteKey;

        public string BaseUrl { get; }

        public MiniConfigServer(string siteKey)
        {
            _siteKey = siteKey;
            _listener = new TcpListener(IPAddress.Loopback, 0);
            _listener.Start();
            BaseUrl = $"http://127.0.0.1:{((IPEndPoint)_listener.LocalEndpoint).Port}";
            _serverTask = Task.Run(RunAsync);
        }

        public void Dispose()
        {
            _cts.Cancel();
            _listener.Stop();
            try
            {
                _serverTask.GetAwaiter().GetResult();
            }
            catch
            {
                // Ignore shutdown races from the test server.
            }
        }

        private async Task RunAsync()
        {
            while (!_cts.IsCancellationRequested)
            {
                TcpClient? client = null;
                try
                {
                    client = await _listener.AcceptTcpClientAsync(_cts.Token);
                    using (client)
                    using (var stream = client.GetStream())
                    {
                        var buffer = new byte[4096];
                        var requestBuilder = new StringBuilder();
                        while (!requestBuilder.ToString().Contains("\r\n\r\n"))
                        {
                            var read = await stream.ReadAsync(buffer, 0, buffer.Length, _cts.Token);
                            if (read <= 0)
                            {
                                break;
                            }
                            requestBuilder.Append(Encoding.UTF8.GetString(buffer, 0, read));
                        }

                        var body = $"{{\"captcha\":{{\"siteKey\":\"{_siteKey}\"}}}}";
                        var response =
                            "HTTP/1.1 200 OK\r\n" +
                            "Content-Type: application/json\r\n" +
                            $"Content-Length: {Encoding.UTF8.GetByteCount(body)}\r\n" +
                            "Connection: close\r\n\r\n" +
                            body;
                        var bytes = Encoding.UTF8.GetBytes(response);
                        await stream.WriteAsync(bytes, 0, bytes.Length, _cts.Token);
                    }
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch (ObjectDisposedException)
                {
                    break;
                }
                finally
                {
                    client?.Dispose();
                }
            }
        }
    }

    public class TurnstileProviderTests
    {
        [Fact]
        public async Task FetchSiteKeyAsync_caches_per_baseUrl()
        {
            using var serverOne = new MiniConfigServer("site-key-one");
            using var serverTwo = new MiniConfigServer("site-key-two");

            var providerType = typeof(TurnstileProvider);
            var cacheField = providerType.GetField("_siteKeyCache", BindingFlags.NonPublic | BindingFlags.Static);
            Assert.NotNull(cacheField);
            var cache = cacheField!.GetValue(null);
            Assert.NotNull(cache);
            cacheField.FieldType.GetMethod("Clear")!.Invoke(cache, null);

            var fetchMethod = providerType.GetMethod("FetchSiteKeyAsync", BindingFlags.NonPublic | BindingFlags.Static);
            Assert.NotNull(fetchMethod);

            var fetchOne = (Task<string?>)fetchMethod!.Invoke(null, new object[] { serverOne.BaseUrl })!;
            var fetchTwo = (Task<string?>)fetchMethod.Invoke(null, new object[] { serverTwo.BaseUrl })!;

            Assert.Equal("site-key-one", await fetchOne);
            Assert.Equal("site-key-two", await fetchTwo);
        }

        [Fact]
        public void HasWebViewFactory_tracks_manual_registration()
        {
            var providerType = typeof(TurnstileProvider);
            var factoryField = providerType.GetField("_webViewFactory", BindingFlags.NonPublic | BindingFlags.Static);
            Assert.NotNull(factoryField);

            factoryField!.SetValue(null, null);
            Assert.False(TurnstileProvider.HasWebViewFactory);

            TurnstileProvider.SetWebViewFactory((_, _) => Task.FromResult("token"));
            Assert.True(TurnstileProvider.HasWebViewFactory);

            factoryField.SetValue(null, null);
        }
    }

    // ─── D. EdgeBaseException ─────────────────────────────────────────────────

    public class EdgeBaseExceptionTests
    {
        [Fact]
        public void Constructor_sets_status_code()
        {
            var ex = new EdgeBaseException(404, "Not Found");
            Assert.Equal(404, ex.StatusCode);
        }

        [Fact]
        public void Constructor_sets_message()
        {
            var ex = new EdgeBaseException(400, "Bad Request");
            Assert.Equal("Bad Request", ex.Message);
        }

        [Fact]
        public void Is_exception()
        {
            var ex = new EdgeBaseException(500, "Server Error");
            Assert.IsAssignableFrom<Exception>(ex);
        }
    }

    // ─── F. RoomClient v2 구조 테스트 ────────────────────────────────────────

    internal sealed class FakeRoomWebSocket : System.Net.WebSockets.WebSocket
    {
        private WebSocketState _state = WebSocketState.Open;
        public List<string> Events { get; } = new();
        public List<JsonElement> Messages { get; } = new();

        public override WebSocketCloseStatus? CloseStatus => WebSocketCloseStatus.NormalClosure;
        public override string? CloseStatusDescription => null;
        public override WebSocketState State => _state;
        public override string? SubProtocol => null;

        public override void Abort()
        {
            _state = WebSocketState.Aborted;
            Events.Add("abort");
        }

        public override Task CloseAsync(WebSocketCloseStatus closeStatus, string? statusDescription, CancellationToken cancellationToken)
        {
            _state = WebSocketState.Closed;
            Events.Add($"close:{statusDescription}");
            return Task.CompletedTask;
        }

        public override Task CloseOutputAsync(WebSocketCloseStatus closeStatus, string? statusDescription, CancellationToken cancellationToken)
            => CloseAsync(closeStatus, statusDescription, cancellationToken);

        public override void Dispose()
        {
            _state = WebSocketState.Closed;
        }

        public override Task<WebSocketReceiveResult> ReceiveAsync(ArraySegment<byte> buffer, CancellationToken cancellationToken)
            => Task.FromResult(new WebSocketReceiveResult(0, WebSocketMessageType.Close, true));

        public override Task SendAsync(ArraySegment<byte> buffer, WebSocketMessageType messageType, bool endOfMessage, CancellationToken cancellationToken)
        {
            var json = Encoding.UTF8.GetString(buffer.Array!, buffer.Offset, buffer.Count);
            using var doc = JsonDocument.Parse(json);
            Messages.Add(doc.RootElement.Clone());
            Events.Add($"send:{doc.RootElement.GetProperty("type").GetString()}");
            return Task.CompletedTask;
        }
    }

    public class RoomClientStructureTests
    {
        [Fact]
        public void Implements_IDisposable()
        {
            Assert.True(typeof(IDisposable).IsAssignableFrom(typeof(RoomClient)));
        }

        [Fact]
        public void Join_method_exists()
        {
            var method = typeof(RoomClient).GetMethod("Join");
            Assert.NotNull(method);
        }

        [Fact]
        public void Leave_method_exists()
        {
            var method = typeof(RoomClient).GetMethod("Leave");
            Assert.NotNull(method);
        }

        // ── v2 methods ───────────────────────────────────────────────

        [Fact]
        public void Send_method_exists()
        {
            var method = typeof(RoomClient).GetMethod("Send");
            Assert.NotNull(method);
        }

        [Fact]
        public void GetSharedState_method_exists()
        {
            var method = typeof(RoomClient).GetMethod("GetSharedState");
            Assert.NotNull(method);
        }

        [Fact]
        public void GetPlayerState_method_exists()
        {
            var method = typeof(RoomClient).GetMethod("GetPlayerState");
            Assert.NotNull(method);
        }

        [Fact]
        public void OnSharedState_method_exists()
        {
            var method = typeof(RoomClient).GetMethod("OnSharedState");
            Assert.NotNull(method);
        }

        [Fact]
        public void OnPlayerState_method_exists()
        {
            var method = typeof(RoomClient).GetMethod("OnPlayerState");
            Assert.NotNull(method);
        }

        [Fact]
        public void OnMessage_method_exists()
        {
            var method = typeof(RoomClient).GetMethod("OnMessage");
            Assert.NotNull(method);
        }

        [Fact]
        public void OnAnyMessage_method_exists()
        {
            var method = typeof(RoomClient).GetMethod("OnAnyMessage");
            Assert.NotNull(method);
        }

        [Fact]
        public void OnError_method_exists()
        {
            var method = typeof(RoomClient).GetMethod("OnError");
            Assert.NotNull(method);
        }

        [Fact]
        public void OnKicked_method_exists()
        {
            var method = typeof(RoomClient).GetMethod("OnKicked");
            Assert.NotNull(method);
        }

        // ── v2 fields ────────────────────────────────────────────────

        [Fact]
        public void Namespace_field_exists()
        {
            var field = typeof(RoomClient).GetField("Namespace");
            Assert.NotNull(field);
        }

        [Fact]
        public void RoomId_field_exists()
        {
            var field = typeof(RoomClient).GetField("RoomId");
            Assert.NotNull(field);
        }

        // ── v2 constructor ───────────────────────────────────────────

        [Fact]
        public void Constructor_initializes_empty_state()
        {
            var room = new RoomClient("http://localhost", "game", "test-room", () => null);
            Assert.NotNull(room.GetSharedState());
            Assert.Empty(room.GetSharedState());
            Assert.NotNull(room.GetPlayerState());
            Assert.Empty(room.GetPlayerState());
            Assert.Equal("game", room.Namespace);
            Assert.Equal("test-room", room.RoomId);
            room.Dispose();
        }

        // ── v2 subscription returns IDisposable ──────────────────────

        [Fact]
        public void OnSharedState_returns_IDisposable()
        {
            var room = new RoomClient("http://localhost", "game", "test-room", () => null);
            var sub = room.OnSharedState((state, changes) => { });
            Assert.IsAssignableFrom<IDisposable>(sub);
            sub.Dispose();
            room.Dispose();
        }

        [Fact]
        public void OnPlayerState_returns_IDisposable()
        {
            var room = new RoomClient("http://localhost", "game", "test-room", () => null);
            var sub = room.OnPlayerState((state, changes) => { });
            Assert.IsAssignableFrom<IDisposable>(sub);
            sub.Dispose();
            room.Dispose();
        }

        [Fact]
        public void OnMessage_returns_IDisposable()
        {
            var room = new RoomClient("http://localhost", "game", "test-room", () => null);
            var sub = room.OnMessage("test", data => { });
            Assert.IsAssignableFrom<IDisposable>(sub);
            sub.Dispose();
            room.Dispose();
        }

        [Fact]
        public void OnKicked_returns_IDisposable()
        {
            var room = new RoomClient("http://localhost", "game", "test-room", () => null);
            var sub = room.OnKicked(() => { });
            Assert.IsAssignableFrom<IDisposable>(sub);
            sub.Dispose();
            room.Dispose();
        }

        // ── v1 methods removed ───────────────────────────────────────

        [Fact]
        public void SetState_removed()
        {
            var method = typeof(RoomClient).GetMethod("SetState");
            Assert.Null(method);
        }

        [Fact]
        public void PatchState_removed()
        {
            var method = typeof(RoomClient).GetMethod("PatchState");
            Assert.Null(method);
        }

        [Fact]
        public void SendAction_removed()
        {
            var method = typeof(RoomClient).GetMethod("SendAction");
            Assert.Null(method);
        }

        [Fact]
        public void SendEvent_removed()
        {
            var method = typeof(RoomClient).GetMethod("SendEvent");
            Assert.Null(method);
        }

        [Fact]
        public void Leave_sends_explicit_leave_before_close()
        {
            var room = new RoomClient("http://localhost", "game", "test-room", () => "token");
            var fakeSocket = new FakeRoomWebSocket();
            room.AttachSocketForTesting(fakeSocket, connected: true, authenticated: true, joined: true);

            room.Leave();

            Assert.Equal(new[] { "send:leave", "close:Client left room" }, fakeSocket.Events);
            room.Dispose();
        }

        [Fact]
        public void Unified_surface_fields_exist()
        {
            Assert.NotNull(typeof(RoomClient).GetField("State"));
            Assert.NotNull(typeof(RoomClient).GetField("Meta"));
            Assert.NotNull(typeof(RoomClient).GetField("Signals"));
            Assert.NotNull(typeof(RoomClient).GetField("Members"));
            Assert.NotNull(typeof(RoomClient).GetField("Admin"));
            Assert.NotNull(typeof(RoomClient).GetField("Media"));
            Assert.NotNull(typeof(RoomClient).GetField("Session"));
        }

        [Fact]
        public void Unified_surface_parses_members_signals_media_and_session_frames()
        {
            var room = new RoomClient("http://localhost", "game", "room-1", () => "token");
            var memberSyncSnapshots = new List<List<Dictionary<string, object?>>>();
            var memberLeaves = new List<string>();
            var signalEvents = new List<string>();
            var mediaTracks = new List<string>();
            var mediaDevices = new List<string>();
            var connectionStates = new List<string>();

            room.Members.OnSync(members => memberSyncSnapshots.Add(members));
            room.Members.OnLeave((member, reason) => memberLeaves.Add($"{member["memberId"]}:{reason}"));
            room.Signals.OnAny((eventName, payload, meta) => signalEvents.Add($"{eventName}:{meta["userId"]}"));
            room.Media.OnTrack((track, member) => mediaTracks.Add($"{track["kind"]}:{member["memberId"]}"));
            room.Media.OnDeviceChange((member, change) => mediaDevices.Add($"{change["kind"]}:{change["deviceId"]}"));
            room.Session.OnConnectionStateChange(connectionStates.Add);

            room.HandleRawForTesting("{\"type\":\"auth_success\",\"userId\":\"user-1\",\"connectionId\":\"conn-1\"}");
            room.HandleRawForTesting("{\"type\":\"sync\",\"sharedState\":{\"topic\":\"focus\"},\"sharedVersion\":1,\"playerState\":{\"ready\":true},\"playerVersion\":2}");
            room.HandleRawForTesting("{\"type\":\"members_sync\",\"members\":[{\"memberId\":\"user-1\",\"userId\":\"user-1\",\"connectionId\":\"conn-1\",\"connectionCount\":1,\"state\":{\"typing\":false}}]}");
            room.HandleRawForTesting("{\"type\":\"member_join\",\"member\":{\"memberId\":\"user-2\",\"userId\":\"user-2\",\"connectionCount\":1,\"state\":{}}}");
            room.HandleRawForTesting("{\"type\":\"signal\",\"event\":\"cursor.move\",\"payload\":{\"x\":10,\"y\":20},\"meta\":{\"memberId\":\"user-2\",\"userId\":\"user-2\",\"connectionId\":\"conn-2\",\"sentAt\":123}}");
            room.HandleRawForTesting("{\"type\":\"media_track\",\"member\":{\"memberId\":\"user-2\",\"userId\":\"user-2\",\"state\":{}},\"track\":{\"kind\":\"video\",\"trackId\":\"video-1\",\"deviceId\":\"cam-1\",\"muted\":false}}");
            room.HandleRawForTesting("{\"type\":\"media_device\",\"member\":{\"memberId\":\"user-2\",\"userId\":\"user-2\",\"state\":{}},\"kind\":\"video\",\"deviceId\":\"cam-2\"}");
            room.HandleRawForTesting("{\"type\":\"member_leave\",\"member\":{\"memberId\":\"user-2\",\"userId\":\"user-2\",\"state\":{}},\"reason\":\"timeout\"}");

            Assert.Equal("focus", room.State.GetShared()["topic"]);
            Assert.Equal(true, room.State.GetMine()["ready"]);
            Assert.Equal("user-1", room.Session.GetUserId());
            Assert.Equal("conn-1", room.Session.GetConnectionId());
            Assert.Equal("connected", room.Session.GetConnectionState());
            Assert.Equal(new[] { "connected" }, connectionStates);
            Assert.Single(memberSyncSnapshots);
            Assert.Equal("user-1", memberSyncSnapshots[0][0]["memberId"]);
            Assert.Equal(new[] { "cursor.move:user-2" }, signalEvents);
            Assert.Equal(new[] { "video:user-2" }, mediaTracks);
            Assert.Equal(new[] { "video:cam-2" }, mediaDevices);
            Assert.Equal(new[] { "user-2:timeout" }, memberLeaves);
            Assert.Single(room.Members.List());
            Assert.Equal("user-1", room.Members.List()[0]["memberId"]);
            Assert.Empty(room.Media.List());

            room.Dispose();
        }

        [Fact]
        public async Task Unified_surface_sends_signal_member_admin_and_media_frames()
        {
            var room = new RoomClient("http://localhost", "game", "room-1", () => "token");
            var fakeSocket = new FakeRoomWebSocket();
            room.AttachSocketForTesting(fakeSocket, connected: true, authenticated: true, joined: true);
            room.HandleRawForTesting("{\"type\":\"auth_success\",\"userId\":\"user-1\",\"connectionId\":\"conn-1\"}");

            var signalTask = room.Signals.Send(
                "cursor.move",
                new Dictionary<string, object?> { ["x"] = 10 },
                new Dictionary<string, object?> { ["includeSelf"] = true }
            );
            var signalMessage = fakeSocket.Messages[0];
            Assert.Equal("signal", signalMessage.GetProperty("type").GetString());
            Assert.Equal("cursor.move", signalMessage.GetProperty("event").GetString());
            Assert.True(signalMessage.GetProperty("includeSelf").GetBoolean());
            var signalRequestId = signalMessage.GetProperty("requestId").GetString();
            room.HandleRawForTesting($"{{\"type\":\"signal_sent\",\"requestId\":\"{signalRequestId}\",\"event\":\"cursor.move\"}}");
            await signalTask;

            var memberStateTask = room.Members.SetState(new Dictionary<string, object?> { ["typing"] = true });
            var memberStateMessage = fakeSocket.Messages[1];
            Assert.Equal("member_state", memberStateMessage.GetProperty("type").GetString());
            Assert.True(memberStateMessage.GetProperty("state").GetProperty("typing").GetBoolean());
            var memberStateRequestId = memberStateMessage.GetProperty("requestId").GetString();
            room.HandleRawForTesting($"{{\"type\":\"member_state\",\"requestId\":\"{memberStateRequestId}\",\"member\":{{\"memberId\":\"user-1\",\"userId\":\"user-1\",\"state\":{{\"typing\":true}}}},\"state\":{{\"typing\":true}}}}");
            await memberStateTask;

            var adminTask = room.Admin.DisableVideo("user-2");
            var adminMessage = fakeSocket.Messages[2];
            Assert.Equal("admin", adminMessage.GetProperty("type").GetString());
            Assert.Equal("disableVideo", adminMessage.GetProperty("operation").GetString());
            Assert.Equal("user-2", adminMessage.GetProperty("memberId").GetString());
            var adminRequestId = adminMessage.GetProperty("requestId").GetString();
            room.HandleRawForTesting($"{{\"type\":\"admin_result\",\"requestId\":\"{adminRequestId}\",\"operation\":\"disableVideo\",\"memberId\":\"user-2\"}}");
            await adminTask;

            var mediaTask = room.Media.Audio.SetMuted(true);
            var mediaMessage = fakeSocket.Messages[3];
            Assert.Equal("media", mediaMessage.GetProperty("type").GetString());
            Assert.Equal("mute", mediaMessage.GetProperty("operation").GetString());
            Assert.Equal("audio", mediaMessage.GetProperty("kind").GetString());
            Assert.True(mediaMessage.GetProperty("payload").GetProperty("muted").GetBoolean());
            var mediaRequestId = mediaMessage.GetProperty("requestId").GetString();
            room.HandleRawForTesting($"{{\"type\":\"media_result\",\"requestId\":\"{mediaRequestId}\",\"operation\":\"mute\",\"kind\":\"audio\"}}");
            await mediaTask;

            Assert.Equal(new[] { "send:signal", "send:member_state", "send:admin", "send:media" }, fakeSocket.Events);

            room.Dispose();
        }
    }

    // ─── F-2. EdgeBase.Room() factory method test ─────────────────────────

    public class EdgeBaseRoomFactoryTests
    {
        [Fact]
        public void Room_method_exists()
        {
            var method = typeof(EdgeBase).GetMethod("Room");
            Assert.NotNull(method);
        }

        [Fact]
        public void Room_returns_RoomClient()
        {
            using var client = new EdgeBase("https://dummy.edgebase.fun");
            var room = client.Room("game", "lobby-1");
            Assert.NotNull(room);
            Assert.IsType<RoomClient>(room);
            Assert.Equal("game", room.Namespace);
            Assert.Equal("lobby-1", room.RoomId);
            room.Dispose();
        }
    }

    // ─── G. PushClient 구조 테스트 ─────────────────────────────────────────

    public class PushClientStructureTests : IDisposable
    {
        private readonly JbHttpClient _http;
        private readonly PushClient _push;

        public PushClientStructureTests()
        {
            _http = new JbHttpClient("https://dummy.edgebase.fun");
            _push = new PushClient(_http);
        }

        public void Dispose() => _http?.Dispose();

        [Fact]
        public void RegisterAsync_method_exists()
        {
            var method = typeof(PushClient).GetMethod("RegisterAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void UnregisterAsync_method_exists()
        {
            var method = typeof(PushClient).GetMethod("UnregisterAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void OnMessage_method_exists()
        {
            var method = typeof(PushClient).GetMethod("OnMessage");
            Assert.NotNull(method);
        }

        [Fact]
        public void OnMessageOpenedApp_method_exists()
        {
            var method = typeof(PushClient).GetMethod("OnMessageOpenedApp");
            Assert.NotNull(method);
        }

        [Fact]
        public void GetPermissionStatus_method_exists()
        {
            var method = typeof(PushClient).GetMethod("GetPermissionStatus");
            Assert.NotNull(method);
        }

        [Fact]
        public void RequestPermissionAsync_method_exists()
        {
            var method = typeof(PushClient).GetMethod("RequestPermissionAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void TokenProvider_property_exists()
        {
            Assert.NotNull(typeof(PushClient).GetProperty("TokenProvider"));
        }

        [Fact]
        public void DeviceInfoProvider_property_exists()
        {
            Assert.NotNull(typeof(PushClient).GetProperty("DeviceInfoProvider"));
        }

        [Fact]
        public void PermissionRequester_property_exists()
        {
            Assert.NotNull(typeof(PushClient).GetProperty("PermissionRequester"));
        }

        [Fact]
        public void Platform_property_exists()
        {
            Assert.NotNull(typeof(PushClient).GetProperty("Platform"));
        }

        [Fact]
        public void Platform_default_is_Android()
        {
            Assert.Equal(PushPlatform.Android, _push.Platform);
        }

        [Fact]
        public void TokenProvider_initially_null()
        {
            Assert.Null(_push.TokenProvider);
        }

        [Fact]
        public void DispatchMessage_fires_listeners()
        {
            var received = new List<Dictionary<string, object>>();
            _push.OnMessage(msg => received.Add(msg));
            _push.DispatchMessage(new Dictionary<string, object> { ["title"] = "Hello" });
            Assert.Single(received);
            Assert.Equal("Hello", received[0]["title"]);
        }

        [Fact]
        public void DispatchMessageOpenedApp_fires_listeners()
        {
            var received = new List<Dictionary<string, object>>();
            _push.OnMessageOpenedApp(msg => received.Add(msg));
            _push.DispatchMessageOpenedApp(new Dictionary<string, object> { ["action"] = "open" });
            Assert.Single(received);
        }

        [Fact]
        public void GetPermissionStatus_returns_notDetermined()
        {
            Assert.Equal("notDetermined", _push.GetPermissionStatus());
        }

        [Fact]
        public void RegisterAsync_throws_without_TokenProvider()
        {
            Assert.ThrowsAsync<InvalidOperationException>(() => _push.RegisterAsync());
        }

        [Fact]
        public void Multiple_OnMessage_listeners()
        {
            int count = 0;
            _push.OnMessage(_ => count++);
            _push.OnMessage(_ => count++);
            _push.DispatchMessage(new Dictionary<string, object>());
            Assert.Equal(2, count);
        }
    }

    // ─── J. DbChange 구조 테스트 ──────────────────────────────────────────

    public class DbChangeTests
    {
        [Fact]
        public void Default_values_are_empty()
        {
            var change = new DbChange();
            Assert.Equal("", change.ChangeType);
            Assert.Equal("", change.Table);
            Assert.Equal("", change.DocId);
            Assert.Null(change.Data);
            Assert.Equal("", change.Timestamp);
        }

        [Fact]
        public void Properties_can_be_set()
        {
            var change = new DbChange
            {
                ChangeType = "insert",
                Table = "posts",
                DocId = "abc",
                Timestamp = "2026-01-01",
                Data = new Dictionary<string, object?> { ["title"] = "test" }
            };
            Assert.Equal("insert", change.ChangeType);
            Assert.Equal("posts", change.Table);
            Assert.Equal("abc", change.DocId);
            Assert.NotNull(change.Data);
        }
    }

    // ─── N. PushPlatform enum 테스트 ──────────────────────────────────────

    public class PushPlatformTests
    {
        [Fact]
        public void Has_Ios_value()
        {
            Assert.Equal(0, (int)PushPlatform.Ios);
        }

        [Fact]
        public void Has_Android_value()
        {
            Assert.Equal(1, (int)PushPlatform.Android);
        }

        [Fact]
        public void Has_Web_value()
        {
            Assert.Equal(2, (int)PushPlatform.Web);
        }

        [Fact]
        public void Has_Macos_value()
        {
            Assert.Equal(3, (int)PushPlatform.Macos);
        }
    }

    // ─── O. FileInfo / FileListResult / SignedUrlResult ───────────────────

    public class StorageRecordTypeTests
    {
        [Fact]
        public void FileInfo_properties()
        {
            var fi = new FileInfo("test.png", 1024, "image/png", "2026-01-01");
            Assert.Equal("test.png", fi.Key);
            Assert.Equal(1024, fi.Size);
            Assert.Equal("image/png", fi.ContentType);
        }

        [Fact]
        public void FileListResult_properties()
        {
            var files = new List<FileInfo> { new("a.txt", 10, "text/plain", "2026-01-01") };
            var result = new FileListResult(files, "next-cursor");
            Assert.Single(result.Files);
            Assert.Equal("next-cursor", result.Cursor);
        }

        [Fact]
        public void SignedUrlResult_properties()
        {
            var r = new SignedUrlResult("https://example.com/signed", 1700000000);
            Assert.Equal("https://example.com/signed", r.Url);
            Assert.Equal(1700000000, r.ExpiresAt);
        }

        [Fact]
        public void FileInfo_optional_fields()
        {
            var fi = new FileInfo("key", 0, "ct", "ts", "etag-val", "uploader-1", null);
            Assert.Equal("etag-val", fi.Etag);
            Assert.Equal("uploader-1", fi.UploadedBy);
            Assert.Null(fi.CustomMetadata);
        }

        [Fact]
        public void FileInfo_with_custom_metadata()
        {
            var meta = new Dictionary<string, string> { ["author"] = "Alice" };
            var fi = new FileInfo("key", 0, "ct", "ts", CustomMetadata: meta);
            Assert.NotNull(fi.CustomMetadata);
            Assert.Equal("Alice", fi.CustomMetadata!["author"]);
        }

        [Fact]
        public void FileListResult_empty()
        {
            var result = new FileListResult(new List<FileInfo>(), null);
            Assert.Empty(result.Files);
            Assert.Null(result.Cursor);
        }
    }
}
