using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Reflection;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using EdgeBase.Generated;
using Xunit;
// EdgeBase C# Unity SDK 단위 테스트 — EdgeBase (Unity) 클라이언트 구조 검증
//
// 실행: cd packages/sdk/csharp/packages/unity/tests && dotnet test
//
// 원칙: 서버 불필요, 순수 클래스 구조/생성 검증

namespace EdgeBase.Tests
{
    internal static class GeneratedOAuthCompatibilityCompileFixture
    {
        internal static void Compile(GeneratedDbApi api)
        {
            _ = api.OauthRedirectAsync("google", default);
            _ = api.OauthLinkStartAsync("google", default);
            _ = api.OauthRedirectWithQueryAsync("google", null, default);
            _ = api.OauthLinkStartWithBodyAsync("google", null, default);
        }
    }

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
        public void LinkWithOAuth_fails_explicitly_until_secure_callback_completion_exists()
        {
            using var client = new EdgeBase("https://dummy.edgebase.fun");
            Assert.Throws<NotSupportedException>(() =>
                client.Auth.LinkWithOAuth("google", "https://app.example.com/auth/callback"));
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
        private readonly string _body;
        private readonly int _statusCode;

        public string BaseUrl { get; }

        public MiniConfigServer(string siteKey)
            : this($"{{\"captcha\":{{\"siteKey\":\"{siteKey}\"}}}}", 200)
        {
        }

        public MiniConfigServer(string body, int statusCode)
        {
            _body = body;
            _statusCode = statusCode;
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

                        var response =
                            $"HTTP/1.1 {_statusCode} Synthetic\r\n" +
                            "Content-Type: application/json\r\n" +
                            $"Content-Length: {Encoding.UTF8.GetByteCount(_body)}\r\n" +
                            "Connection: close\r\n\r\n" +
                            _body;
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
        public async Task FetchSiteKeyAsync_does_not_treat_config_failure_as_disabled()
        {
            using var server = new MiniConfigServer("{\"message\":\"synthetic outage\"}", 503);
            var fetchMethod = typeof(TurnstileProvider).GetMethod(
                "FetchSiteKeyAsync",
                BindingFlags.NonPublic | BindingFlags.Static
            );
            Assert.NotNull(fetchMethod);

            var fetch = (Task<string?>)fetchMethod!.Invoke(null, new object[] { server.BaseUrl })!;
            var error = await Assert.ThrowsAsync<CaptchaUnavailableException>(async () => await fetch);

            Assert.Equal("config_fetch_failed", error.Reason);
        }

        [Fact]
        public async Task FetchSiteKeyAsync_preserves_explicit_disabled_config()
        {
            using var server = new MiniConfigServer("{\"captcha\":null}", 200);
            var fetchMethod = typeof(TurnstileProvider).GetMethod(
                "FetchSiteKeyAsync",
                BindingFlags.NonPublic | BindingFlags.Static
            );
            Assert.NotNull(fetchMethod);

            var fetch = (Task<string?>)fetchMethod!.Invoke(null, new object[] { server.BaseUrl })!;

            Assert.Null(await fetch);
        }

        [Fact]
        public async Task FetchSiteKeyAsync_rejects_missing_captcha_as_malformed()
        {
            using var server = new MiniConfigServer("{}", 200);
            var fetchMethod = typeof(TurnstileProvider).GetMethod(
                "FetchSiteKeyAsync",
                BindingFlags.NonPublic | BindingFlags.Static
            );
            Assert.NotNull(fetchMethod);

            var fetch = (Task<string?>)fetchMethod!.Invoke(null, new object[] { server.BaseUrl })!;
            var error = await Assert.ThrowsAsync<CaptchaUnavailableException>(async () => await fetch);

            Assert.Equal("config_invalid_response", error.Reason);
        }

        [Fact]
        public async Task FetchSiteKeyAsync_classifies_malformed_json()
        {
            using var server = new MiniConfigServer("not-json", 200);
            var fetchMethod = typeof(TurnstileProvider).GetMethod(
                "FetchSiteKeyAsync",
                BindingFlags.NonPublic | BindingFlags.Static
            );
            Assert.NotNull(fetchMethod);

            var fetch = (Task<string?>)fetchMethod!.Invoke(null, new object[] { server.BaseUrl })!;
            var error = await Assert.ThrowsAsync<CaptchaUnavailableException>(async () => await fetch);

            Assert.Equal("config_invalid_response", error.Reason);
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

        [Fact]
        public void BuildChallengeUrl_requires_https_origin_fixed_action_and_secure_channel()
        {
            const string channel = "0123456789abcdef0123456789abcdef";
            Assert.Equal(
                "https://api.example.test/api/captcha/challenge?action=signin&channel=" +
                    channel + "&bridge=unity",
                TurnstileProvider.BuildChallengeUrl("https://api.example.test", "signin", channel)
            );
            Assert.Throws<ArgumentException>(() =>
                TurnstileProvider.BuildChallengeUrl("http://api.example.test", "signin", channel));
            Assert.Throws<ArgumentException>(() =>
                TurnstileProvider.BuildChallengeUrl("https://api.example.test/path", "signin", channel));
            Assert.Throws<ArgumentException>(() =>
                TurnstileProvider.BuildChallengeUrl("https://api.example.test", "custom", channel));
            Assert.Throws<ArgumentException>(() =>
                TurnstileProvider.BuildChallengeUrl("https://api.example.test", "signin", "predictable"));
        }

        [Fact]
        public void ChallengeBridge_and_messages_are_bound_and_bounded()
        {
            const string channel = "0123456789abcdef0123456789abcdef";
            var original = TurnstileProvider.BuildChallengeUrl(
                "https://api.example.test",
                "signup",
                channel
            );
            Assert.EndsWith("&bridge=vuplex", TurnstileProvider.WithChallengeBridge(original, "vuplex"));
            Assert.Throws<ArgumentException>(() =>
                TurnstileProvider.WithChallengeBridge("https://evil.test/challenge?bridge=unity", "vuplex"));

            var valid = "{\"v\":1,\"channel\":\"" + channel +
                "\",\"type\":\"token\",\"value\":\"verified\"}";
            Assert.True(TurnstileProvider.TryParseChallengeMessage(
                valid, channel, out var type, out var value));
            Assert.Equal("token", type);
            Assert.Equal("verified", value);
            Assert.False(TurnstileProvider.TryParseChallengeMessage(
                valid, "fedcba9876543210fedcba9876543210", out _, out _));
            Assert.False(TurnstileProvider.TryParseChallengeMessage(
                "{\"v\":1,\"channel\":\"" + channel +
                    "\",\"type\":\"token\",\"value\":\"" + new string('x', 2049) + "\"}",
                channel,
                out _,
                out _
            ));
        }

        [Fact]
        public void Captcha_unavailable_has_stable_diagnostic_contract()
        {
            var error = new CaptchaUnavailableException("renderer_terminated");
            Assert.Equal("captcha-unavailable", error.Code);
            Assert.Equal("renderer_terminated", error.Reason);
            Assert.Equal(
                "challenge_origin_mismatch",
                TurnstileProvider.NormalizeFailureReason("origin mismatch")
            );
        }

        [Fact]
        public void Turnstile_positive_site_key_cache_expires_at_five_minutes()
        {
            var method = typeof(TurnstileProvider).GetMethod(
                "IsSiteKeyCacheFresh",
                BindingFlags.Static | BindingFlags.NonPublic
            );
            Assert.NotNull(method);
            var ttl = Stopwatch.Frequency * 300L;

            Assert.True((bool)method!.Invoke(null, new object[] { 0L, ttl - 1L })!);
            Assert.False((bool)method.Invoke(null, new object[] { 0L, ttl })!);
        }

        [Fact]
        public async Task WebGL_challenge_error_retries_once_and_exposes_second_failure()
        {
            var method = typeof(TurnstileProvider).GetMethod(
                "AcquireDirectCaptchaWithSingleSiteKeyRetryAsync",
                BindingFlags.Static | BindingFlags.NonPublic
            );
            Assert.NotNull(method);
            var acquireCount = 0;
            var refreshCount = 0;
            Func<string, Task<string>> acquire = _ =>
            {
                acquireCount += 1;
                return Task.FromException<string>(
                    new CaptchaUnavailableException("challenge_error")
                );
            };
            Func<Task<string?>> refresh = () =>
            {
                refreshCount += 1;
                return Task.FromResult<string?>("site-key-v2");
            };

            var task = (Task<string?>)method!.Invoke(
                null,
                new object[] { "site-key-v1", acquire, refresh }
            )!;
            var error = await Assert.ThrowsAsync<CaptchaUnavailableException>(
                async () => await task
            );

            Assert.Equal("challenge_error", error.Reason);
            Assert.Equal(2, acquireCount);
            Assert.Equal(1, refreshCount);
        }
    }

    public class AuthTokenPersistenceTests
    {
        [Fact]
        public async Task Replacement_tokens_are_persisted_before_exposure()
        {
            var storage = new FailingAuthTokenStorage();
            using var client = new EdgeBase("https://api.example.test", storage);
            client.Auth.SetAccessToken("original-access");

            var apply = typeof(AuthClient).GetMethod(
                "ApplyAuthTokensAsync",
                BindingFlags.Instance | BindingFlags.NonPublic
            );
            Assert.NotNull(apply);
            var replacement = new Dictionary<string, object?> {
                ["accessToken"] = "replacement-access",
                ["refreshToken"] = "replacement-refresh",
            };

            var task = (Task)apply!.Invoke(
                client.Auth,
                new object[] { replacement, false })!;
            var error = await Assert.ThrowsAsync<TokenPersistenceException>(async () => await task);

            Assert.Equal("save", error.Operation);
            Assert.Equal("original-access", client.Auth.GetAccessToken());
            Assert.Null(storage.Tokens);
        }

        [Fact]
        public async Task Email_link_retry_replays_checkpoint_before_adopting_replacement_tokens()
        {
            var requests = new List<(string Authorization, string Body)>();
            using var http = new JbHttpClient(
                "https://api.example.test",
                new CheckpointHttpHandler(async request =>
                {
                    requests.Add((
                        request.Headers.Authorization?.ToString() ?? "",
                        await request.Content!.ReadAsStringAsync()
                    ));
                    return new System.Net.Http.HttpResponseMessage(HttpStatusCode.OK)
                    {
                        Content = new System.Net.Http.StringContent(
                            "{\"sessionId\":\"permanent-session\"," +
                            "\"accessToken\":\"permanent-access\"," +
                            "\"refreshToken\":\"permanent-refresh\"}",
                            Encoding.UTF8,
                            "application/json")
                    };
                }));
            var storage = new CheckpointAuthTokenStorage(
                new AuthTokenPair("anonymous-access", "anonymous-refresh"));
            var auth = (AuthClient)Activator.CreateInstance(
                typeof(AuthClient),
                BindingFlags.Instance | BindingFlags.NonPublic,
                binder: null,
                args: new object?[] { http, storage },
                culture: null
            )!;
            auth.SetAccessToken("anonymous-access");
            http.SetRefreshToken("anonymous-refresh");

            storage.FailWrites = true;
            var firstError = await Assert.ThrowsAsync<TokenPersistenceException>(() =>
                auth.LinkWithEmailAsync("user@example.test", "Exact-Pass-123!"));
            Assert.Equal("save", firstError.Operation);
            Assert.Equal("anonymous-access", auth.GetAccessToken());
            Assert.Equal("anonymous-refresh", http.GetRefreshToken());
            Assert.Equal("anonymous-refresh", storage.Tokens?.RefreshToken);

            storage.FailWrites = false;
            var replay = await auth.LinkWithEmailAsync(
                "user@example.test",
                "Exact-Pass-123!");

            Assert.Equal("permanent-session", replay["sessionId"]?.ToString());
            Assert.Equal("permanent-access", auth.GetAccessToken());
            Assert.Equal("permanent-refresh", http.GetRefreshToken());
            Assert.Equal("permanent-refresh", storage.Tokens?.RefreshToken);
            Assert.Equal(2, requests.Count);
            Assert.All(requests, request =>
                Assert.Equal("Bearer anonymous-access", request.Authorization));
            Assert.Equal(requests[0].Body, requests[1].Body);
            using var requestBody = JsonDocument.Parse(requests[0].Body);
            Assert.Equal(
                "user@example.test",
                requestBody.RootElement.GetProperty("email").GetString());
            Assert.Equal(
                "Exact-Pass-123!",
                requestBody.RootElement.GetProperty("password").GetString());
        }

        [Fact]
        public async Task Account_upgrade_fails_before_network_without_durable_storage()
        {
            using var client = new EdgeBase("https://network-must-not-run.example.test");
            client.Auth.SetAccessToken("unclassifiable-anonymous-token");

            var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
                client.Auth.LinkWithEmailAsync(
                    "user@example.test",
                    "Exact-Pass-123!"));

            Assert.Contains("IDurableAuthTokenStorage", error.Message);
        }

        [Fact]
        public async Task New_client_restores_prepopulated_durable_tokens()
        {
            var storage = new CheckpointAuthTokenStorage(
                new AuthTokenPair("restored-access", "restored-refresh"));
            using var client = new EdgeBase("https://api.example.test", storage);

            Assert.True(await client.TryRestoreSessionAsync());
            Assert.Equal("restored-access", client.Auth.GetAccessToken());
        }

        [Fact]
        public async Task Incomplete_stored_pair_is_never_exposed()
        {
            var storage = new CheckpointAuthTokenStorage(
                new AuthTokenPair("", "refresh-only"));
            using var client = new EdgeBase("https://api.example.test", storage);

            var error = await Assert.ThrowsAsync<TokenPersistenceException>(() =>
                client.TryRestoreSessionAsync());

            Assert.Equal("load", error.Operation);
            Assert.Null(client.Auth.GetAccessToken());
        }

        private sealed class FailingAuthTokenStorage : IAuthTokenStorage
        {
            public AuthTokenPair? Tokens { get; private set; }

            public Task<AuthTokenPair?> LoadTokensAsync() => Task.FromResult(Tokens);

            public Task SaveTokensAsync(AuthTokenPair tokens) =>
                Task.FromException(new InvalidOperationException("synthetic persistence failure"));

            public Task ClearTokensAsync()
            {
                Tokens = null;
                return Task.CompletedTask;
            }
        }

        private sealed class CheckpointAuthTokenStorage : IDurableAuthTokenStorage
        {
            public AuthTokenPair? Tokens { get; private set; }
            public bool FailWrites { get; set; }

            public CheckpointAuthTokenStorage(AuthTokenPair initialTokens)
            {
                Tokens = initialTokens;
            }

            public Task<AuthTokenPair?> LoadTokensAsync() => Task.FromResult(Tokens);

            public Task SaveTokensAsync(AuthTokenPair tokens)
            {
                if (FailWrites)
                {
                    return Task.FromException(
                        new InvalidOperationException("synthetic persistence failure"));
                }
                Tokens = tokens;
                return Task.CompletedTask;
            }

            public Task ClearTokensAsync()
            {
                Tokens = null;
                return Task.CompletedTask;
            }
        }

        private sealed class CheckpointHttpHandler : System.Net.Http.HttpMessageHandler
        {
            private readonly Func<System.Net.Http.HttpRequestMessage,
                Task<System.Net.Http.HttpResponseMessage>> _handler;

            public CheckpointHttpHandler(
                Func<System.Net.Http.HttpRequestMessage,
                    Task<System.Net.Http.HttpResponseMessage>> handler)
            {
                _handler = handler;
            }

            protected override Task<System.Net.Http.HttpResponseMessage> SendAsync(
                System.Net.Http.HttpRequestMessage request,
                CancellationToken cancellationToken) => _handler(request);
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
        public void Unified_surface_exposes_the_six_supported_room_namespaces()
        {
            // Keep this list aligned with docs/docs/room/client-sdk.md and the
            // other SDKs. Media is not a Room v2 protocol namespace.
            Assert.NotNull(typeof(RoomClient).GetField("State"));
            Assert.NotNull(typeof(RoomClient).GetField("Meta"));
            Assert.NotNull(typeof(RoomClient).GetField("Signals"));
            Assert.NotNull(typeof(RoomClient).GetField("Members"));
            Assert.NotNull(typeof(RoomClient).GetField("Admin"));
            Assert.NotNull(typeof(RoomClient).GetField("Session"));
        }

        [Fact]
        public void Unified_surface_parses_members_signals_and_session_frames()
        {
            var room = new RoomClient("http://localhost", "game", "room-1", () => "token");
            var memberSyncSnapshots = new List<List<Dictionary<string, object?>>>();
            var memberLeaves = new List<string>();
            var signalEvents = new List<string>();
            var connectionStates = new List<string>();

            room.Members.OnSync(members => memberSyncSnapshots.Add(members));
            room.Members.OnLeave((member, reason) => memberLeaves.Add($"{member["memberId"]}:{reason}"));
            room.Signals.OnAny((eventName, payload, meta) => signalEvents.Add($"{eventName}:{meta["userId"]}"));
            room.Session.OnConnectionStateChange(connectionStates.Add);

            room.HandleRawForTesting("{\"type\":\"auth_success\",\"userId\":\"user-1\",\"connectionId\":\"conn-1\"}");
            room.HandleRawForTesting("{\"type\":\"sync\",\"sharedState\":{\"topic\":\"focus\"},\"sharedVersion\":1,\"playerState\":{\"ready\":true},\"playerVersion\":2}");
            room.HandleRawForTesting("{\"type\":\"members_sync\",\"members\":[{\"memberId\":\"user-1\",\"userId\":\"user-1\",\"connectionId\":\"conn-1\",\"connectionCount\":1,\"state\":{\"typing\":false}}]}");
            room.HandleRawForTesting("{\"type\":\"member_join\",\"member\":{\"memberId\":\"user-2\",\"userId\":\"user-2\",\"connectionCount\":1,\"state\":{}}}");
            room.HandleRawForTesting("{\"type\":\"signal\",\"event\":\"cursor.move\",\"payload\":{\"x\":10,\"y\":20},\"meta\":{\"memberId\":\"user-2\",\"userId\":\"user-2\",\"connectionId\":\"conn-2\",\"sentAt\":123}}");
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
            Assert.Equal(new[] { "user-2:timeout" }, memberLeaves);
            Assert.Single(room.Members.List());
            Assert.Equal("user-1", room.Members.List()[0]["memberId"]);

            room.Dispose();
        }

        [Fact]
        public async Task Unified_surface_sends_signal_member_and_admin_frames()
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

            var adminTask = room.Admin.Block("user-2");
            var adminMessage = fakeSocket.Messages[2];
            Assert.Equal("admin", adminMessage.GetProperty("type").GetString());
            Assert.Equal("block", adminMessage.GetProperty("operation").GetString());
            Assert.Equal("user-2", adminMessage.GetProperty("memberId").GetString());
            var adminRequestId = adminMessage.GetProperty("requestId").GetString();
            room.HandleRawForTesting($"{{\"type\":\"admin_result\",\"requestId\":\"{adminRequestId}\",\"operation\":\"block\",\"memberId\":\"user-2\"}}");
            await adminTask;

            Assert.Equal(new[] { "send:signal", "send:member_state", "send:admin" }, fakeSocket.Events);

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
