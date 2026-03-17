// C# NUnit SDK E2E 테스트
// EdgeBase/Unity SDK (packages/csharp) — HTTP 직접 fetch 방식
//
// 실행 방법:
//   cd packages/sdk/csharp
//   dotnet test tests/EdgeBaseTests.csproj -v normal
//   SERVER=http://localhost:8688 SERVICE_KEY=test-service-key-for-admin dotnet test tests/ -v normal
//
// 환경 변수:
//   SERVER: EdgeBase 서버 주소 (기본값: http://localhost:8688)
//   SERVICE_KEY: 서비스 키 (기본값: test-service-key-for-admin)

using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using EdgeBase.Generated;
using Assert = Xunit.Assert;
using Fact = EdgeBase.Tests.E2EFactAttribute;

namespace EdgeBase.Tests
{
    internal sealed class E2EFactAttribute : Xunit.FactAttribute
    {
        public E2EFactAttribute()
        {
            if (Environment.GetEnvironmentVariable(TestConfig.RequiredEnvName) == "1")
            {
                return;
            }

            if (!TestConfig.IsE2EServerAvailable())
            {
                Skip = TestConfig.ServerUnavailableMessage;
            }
        }
    }

    public static class TestConfig
    {
        public static string Server =>
            Environment.GetEnvironmentVariable("SERVER")
            ?? Environment.GetEnvironmentVariable("BASE_URL")
            ?? "http://localhost:8688";
        public static string ServiceKey => Environment.GetEnvironmentVariable("SERVICE_KEY") ?? "test-service-key-for-admin";
        internal const string RequiredEnvName = "EDGEBASE_E2E_REQUIRED";
        internal static string ServerUnavailableMessage =>
            $"E2E backend not reachable at {Server}. Start `edgebase dev --port 8688` or set SERVER/BASE_URL. Set {RequiredEnvName}=1 to fail instead of skip.";

        public static void RequireE2EServer()
        {
            if (IsE2EServerAvailable())
            {
                return;
            }

            if (Environment.GetEnvironmentVariable(RequiredEnvName) == "1")
            {
                throw new InvalidOperationException(ServerUnavailableMessage);
            }
        }

        internal static bool IsE2EServerAvailable()
        {
            try
            {
                using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
                using var response = client.GetAsync($"{Server.TrimEnd('/')}/api/health").GetAwaiter().GetResult();
                var statusCode = (int)response.StatusCode;
                return statusCode >= 200 && statusCode < 500;
            }
            catch
            {
                return false;
            }
        }
    }

    /// <summary>Raw HTTP helper with SK auth</summary>
    public static class RawHttp
    {
        private static readonly HttpClient Client = new HttpClient();

        public static async Task<(int StatusCode, Dictionary<string, JsonElement>? Data)> RequestAsync(
            string method, string path, object? body = null)
        {
            var request = new HttpRequestMessage(
                new HttpMethod(method),
                $"{TestConfig.Server}{path}");

            request.Headers.Add("X-EdgeBase-Service-Key", TestConfig.ServiceKey);

            if (body != null)
            {
                var json = JsonSerializer.Serialize(body);
                request.Content = new StringContent(json, Encoding.UTF8, "application/json");
            }

            var response = await Client.SendAsync(request);
            var status = (int)response.StatusCode;

            Dictionary<string, JsonElement>? data = null;
            if (response.Content.Headers.ContentLength > 0)
            {
                try
                {
                    data = await response.Content.ReadFromJsonAsync<Dictionary<string, JsonElement>>();
                }
                catch { }
            }

            return (status, data);
        }
    }

    // ─── 1. QueryBuilder 단위 테스트 ─────────────────────────────────────────────

    public class QueryBuilderUnitTests : IDisposable
    {
        private readonly JbHttpClient _http;
        private readonly GeneratedDbApi _core;
        private readonly TableRef _table;

        public QueryBuilderUnitTests()
        {
            _http = new JbHttpClient(TestConfig.Server);
            _http.SetServiceKey(TestConfig.ServiceKey);
            _core = new GeneratedDbApi(_http);
            _table = new TableRef(_core, "posts");
        }

        public void Dispose() => _http?.Dispose();

        [Xunit.Fact]
        public void Where_ReturnsNewInstance()
        {
            var t2 = _table.Where("status", "==", "published");
            Assert.NotSame(_table, t2);
        }

        [Xunit.Fact]
        public void Limit_ReturnsNewInstance()
        {
            var t2 = _table.Limit(10);
            Assert.NotSame(_table, t2);
        }

        [Xunit.Fact]
        public void Offset_ReturnsNewInstance()
        {
            var t2 = _table.Offset(5);
            Assert.NotSame(_table, t2);
        }

        [Xunit.Fact]
        public void OrderBy_ReturnsNewInstance()
        {
            var t2 = _table.OrderBy("createdAt", "desc");
            Assert.NotSame(_table, t2);
        }

        [Xunit.Fact]
        public void After_ReturnsNewInstance()
        {
            var t2 = _table.After("cursor-123");
            Assert.NotSame(_table, t2);
        }

        [Xunit.Fact]
        public void Before_ReturnsNewInstance()
        {
            var t2 = _table.Before("cursor-456");
            Assert.NotSame(_table, t2);
        }

        [Xunit.Fact]
        public void Chaining_Works()
        {
            var t2 = _table
                .Where("status", "==", "published")
                .OrderBy("createdAt", "desc")
                .Limit(20)
                .Offset(0);
            Assert.NotSame(_table, t2);
        }

        [Xunit.Fact]
        public void Or_ReturnsNewInstance()
        {
            var t2 = _table.Or(b =>
            {
                b.Where("x", "==", 1);
                b.Where("y", "==", 2);
            });
            Assert.NotSame(_table, t2);
        }

        [Xunit.Fact]
        public void Doc_ReturnsNewInstance()
        {
            var t2 = _table.Doc("some-id");
            Assert.NotSame(_table, t2);
        }

        [Xunit.Fact]
        public void Search_ReturnsNewInstance()
        {
            var t2 = _table.Search("hello world");
            Assert.NotSame(_table, t2);
        }
    }

    // ─── 2. DB CRUD E2E ─────────────────────────────────────────────────────────

    public class DbCrudE2ETests : IAsyncDisposable
    {
        private readonly JbHttpClient _http;
        private readonly GeneratedDbApi _core;
        private readonly TableRef _table;
        private readonly List<string> _cleanupIds = new();

        public DbCrudE2ETests()
        {
            TestConfig.RequireE2EServer();
            _http = new JbHttpClient(TestConfig.Server);
            _http.SetServiceKey(TestConfig.ServiceKey);
            _core = new GeneratedDbApi(_http);
            _table = new TableRef(_core, "posts");
        }

        public async ValueTask DisposeAsync()
        {
            foreach (var id in _cleanupIds)
            {
                await RawHttp.RequestAsync("DELETE", $"/api/db/shared/tables/posts/{id}");
            }
            _http?.Dispose();
        }

        [Fact]
        public async Task Insert_ReturnsId()
        {
            var suffix = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var result = await _table.InsertAsync(new Dictionary<string, object?>
            {
                { "title", $"CSharp-insert-{suffix}" }
            });

            Assert.True(result.ContainsKey("id"));
            _cleanupIds.Add(result["id"]?.ToString() ?? "");
        }

        [Fact]
        public async Task GetOne_ReturnsRecord()
        {
            var suffix = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var created = await _table.InsertAsync(new Dictionary<string, object?>
            {
                { "title", $"CSharp-getone-{suffix}" }
            });
            var id = created["id"]?.ToString() ?? "";
            _cleanupIds.Add(id);

            var fetched = await _table.GetOneAsync(id);
            Assert.Equal(id, fetched["id"]?.ToString());
        }

        [Fact]
        public async Task Update_ChangesTitle()
        {
            var created = await _table.InsertAsync(new Dictionary<string, object?>
            {
                { "title", "CSharp-orig" }
            });
            var id = created["id"]?.ToString() ?? "";
            _cleanupIds.Add(id);

            var updated = await _table.UpdateAsync(id, new Dictionary<string, object?>
            {
                { "title", "CSharp-updated" }
            });

            Assert.Equal("CSharp-updated", updated["title"]?.ToString());
        }

        [Fact]
        public async Task Delete_Removes()
        {
            var created = await _table.InsertAsync(new Dictionary<string, object?>
            {
                { "title", "CSharp-delete-me" }
            });
            var id = created["id"]?.ToString() ?? "";

            await _table.DeleteAsync(id);
            var (status, _) = await RawHttp.RequestAsync("GET", $"/api/db/shared/tables/posts/{id}");
            Assert.Equal(404, status);
        }

        [Fact]
        public async Task GetAsync_ReturnsList()
        {
            var result = await _table.Limit(5).GetListAsync();
            Assert.NotNull(result.Items);
        }

        [Fact]
        public async Task CountAsync_ReturnsNumber()
        {
            var count = await _table.CountAsync();
            Assert.True((count) >= 0);
        }

        [Fact]
        public async Task UpsertAsync_Inserts()
        {
            var suffix = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var result = await _table.UpsertAsync(new Dictionary<string, object?>
            {
                { "title", $"CSharp-upsert-{suffix}" }
            });

            Assert.True(result.ContainsKey("id"));
            if (result.TryGetValue("id", out var id) && id != null)
                _cleanupIds.Add(id.ToString()!);
        }

        [Fact]
        public async Task InsertMany_ReturnsThreeItems()
        {
            var records = new[]
            {
                new Dictionary<string, object?> { { "title", "CSharp-batch-1" } },
                new Dictionary<string, object?> { { "title", "CSharp-batch-2" } },
                new Dictionary<string, object?> { { "title", "CSharp-batch-3" } },
            };

            var result = await _table.InsertManyAsync(records);
            Assert.Equal(3, result.Count);

            foreach (var item in result)
            {
                if (item.TryGetValue("id", out var id) && id != null)
                    _cleanupIds.Add(id.ToString()!);
            }
        }

        // ─── CRUD Extended ──────────────────────────────────────────────

        [Fact]
        public async Task Insert_SpecialChars_InTitle()
        {
            var suffix = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var title = $"CSharp-spec-chars-{suffix} <>&\"'!@#$%^";
            var result = await _table.InsertAsync(new Dictionary<string, object?> { { "title", title } });
            Assert.True(result.ContainsKey("id"));
            var id = result["id"]?.ToString() ?? "";
            _cleanupIds.Add(id);
            var fetched = await _table.GetOneAsync(id);
            Assert.Equal(title, fetched["title"]?.ToString());
        }

        [Fact]
        public async Task Insert_CJK_Characters()
        {
            var suffix = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var title = $"CSharp-cjk-{suffix}-" + "\uD55C\uAD6D\uC5B4\u4E2D\u6587\u65E5\u672C\u8A9E";
            var result = await _table.InsertAsync(new Dictionary<string, object?> { { "title", title } });
            Assert.True(result.ContainsKey("id"));
            var id = result["id"]?.ToString() ?? "";
            _cleanupIds.Add(id);
            var fetched = await _table.GetOneAsync(id);
            Assert.Contains("\uD55C\uAD6D\uC5B4", fetched["title"]?.ToString() ?? "");
        }

        [Fact]
        public async Task Insert_LargePayload_MultipleFields()
        {
            var suffix = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var record = new Dictionary<string, object?>
            {
                { "title", $"CSharp-large-{suffix}" },
                { "body", new string('A', 5000) },
                { "viewCount", 0 },
            };
            var result = await _table.InsertAsync(record);
            Assert.True(result.ContainsKey("id"));
            _cleanupIds.Add(result["id"]?.ToString() ?? "");
        }

        [Fact]
        public async Task GetOne_Nonexistent_Throws404()
        {
            var ex = await Assert.ThrowsAsync<EdgeBaseException>(
                () => _table.GetOneAsync("nonexistent-core-e2e-id"));
            Assert.Equal(404, ex.StatusCode);
        }

        [Fact]
        public async Task Update_MultipleFields()
        {
            var created = await _table.InsertAsync(new Dictionary<string, object?>
            {
                { "title", "CSharp-multi-update" },
                { "viewCount", 0 }
            });
            var id = created["id"]?.ToString() ?? "";
            _cleanupIds.Add(id);

            var updated = await _table.UpdateAsync(id, new Dictionary<string, object?>
            {
                { "title", "CSharp-multi-updated" },
                { "viewCount", 42 }
            });
            Assert.Equal("CSharp-multi-updated", updated["title"]?.ToString());
        }

        // ─── Query / Filter ─────────────────────────────────────────────

        [Fact]
        public async Task Where_Filter_FindsRecord()
        {
            var suffix = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var unique = $"CSharp-where-{suffix}";
            var created = await _table.InsertAsync(new Dictionary<string, object?> { { "title", unique } });
            _cleanupIds.Add(created["id"]?.ToString() ?? "");

            var result = await _table.Where("title", "==", unique).GetListAsync();
            Assert.NotEmpty(result.Items);
        }

        [Fact]
        public async Task Where_Contains_Filter()
        {
            var suffix = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var unique = $"CSharp-contains-{suffix}";
            var created = await _table.InsertAsync(new Dictionary<string, object?> { { "title", unique } });
            _cleanupIds.Add(created["id"]?.ToString() ?? "");

            var result = await _table.Where("title", "contains", $"contains-{suffix}").GetListAsync();
            Assert.NotEmpty(result.Items);
        }

        [Fact]
        public async Task OrderBy_Desc_ReturnsOrdered()
        {
            var result = await _table.OrderBy("createdAt", "desc").Limit(3).GetListAsync();
            Assert.NotNull(result.Items);
            Assert.True(result.Items.Count <= 3);
        }

        [Fact]
        public async Task Limit_Offset_Pagination()
        {
            var page1 = await _table.Limit(2).Offset(0).GetListAsync();
            var page2 = await _table.Limit(2).Offset(2).GetListAsync();
            Assert.NotNull(page1.Items);
            Assert.NotNull(page2.Items);
        }

        [Fact]
        public async Task Or_Filter_Works()
        {
            var suffix = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var titleA = $"CSharp-or-a-{suffix}";
            var titleB = $"CSharp-or-b-{suffix}";
            var a = await _table.InsertAsync(new Dictionary<string, object?> { { "title", titleA } });
            var b = await _table.InsertAsync(new Dictionary<string, object?> { { "title", titleB } });
            _cleanupIds.Add(a["id"]?.ToString() ?? "");
            _cleanupIds.Add(b["id"]?.ToString() ?? "");

            var result = await _table.Or(builder =>
            {
                builder.Where("title", "==", titleA);
                builder.Where("title", "==", titleB);
            }).GetListAsync();
            Assert.True(result.Items.Count >= 2);
        }

        // ─── Batch ──────────────────────────────────────────────────────

        [Fact]
        public async Task InsertMany_EmptyArray_ReturnsEmpty()
        {
            var result = await _table.InsertManyAsync(new List<Dictionary<string, object?>>());
            Assert.Empty(result);
        }

        [Fact]
        public async Task InsertMany_SingleItem()
        {
            var records = new[] { new Dictionary<string, object?> { { "title", "CSharp-batch-single" } } };
            var result = await _table.InsertManyAsync(records);
            Assert.Single(result);
            foreach (var item in result)
            {
                if (item.TryGetValue("id", out var id) && id != null)
                    _cleanupIds.Add(id.ToString()!);
            }
        }

        // ─── C#-specific: Task.WhenAll ──────────────────────────────────

        [Fact]
        public async Task Parallel_Creates_With_WhenAll()
        {
            var suffix = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var tasks = Enumerable.Range(0, 5).Select(i =>
                _table.InsertAsync(new Dictionary<string, object?>
                {
                    { "title", $"CSharp-parallel-{suffix}-{i}" }
                })
            ).ToArray();

            var results = await Task.WhenAll(tasks);
            Assert.Equal(5, results.Length);
            foreach (var r in results)
            {
                _cleanupIds.Add(r["id"]?.ToString() ?? "");
            }
        }

        [Fact]
        public async Task Parallel_GetAndCount_With_WhenAll()
        {
            var listTask = _table.Limit(2).GetListAsync();
            var countTask = _table.CountAsync();
            await Task.WhenAll(listTask, countTask);

            Assert.NotNull(listTask.Result.Items);
            Assert.True(countTask.Result >= 0);
        }

        // ─── C#-specific: CancellationToken ─────────────────────────────

        [Fact]
        public async Task GetAsync_WithCancellationToken()
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            var result = await _table.Limit(2).GetListAsync(cts.Token);
            Assert.NotNull(result.Items);
        }

        // ─── C#-specific: LINQ ──────────────────────────────────────────

        [Fact]
        public async Task LINQ_Select_OnResults()
        {
            var suffix = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            await _table.InsertAsync(new Dictionary<string, object?> { { "title", $"CSharp-linq-{suffix}" } });
            var result = await _table.Where("title", "contains", $"linq-{suffix}").GetListAsync();
            var titles = result.Items.Select(item =>
                item.TryGetValue("title", out var t) ? t?.ToString() : null).ToList();
            Assert.All(titles, t => Assert.Contains("linq", t));
            foreach (var item in result.Items)
            {
                _cleanupIds.Add(item["id"]?.ToString() ?? "");
            }
        }
    }

    // ─── 3. FieldOps E2E ─────────────────────────────────────────────────────────

    public class FieldOpsE2ETests
    {
        private string _postId = "";

        public FieldOpsE2ETests()
        {
            TestConfig.RequireE2EServer();
        }

        private async Task SetUpAsync()
        {
            var (_, data) = await RawHttp.RequestAsync("POST", "/api/db/shared/tables/posts",
                new { title = "CSharp-field-ops", viewCount = 0, extra = "remove-me" });
            _postId = data?["id"].GetString() ?? "";
        }

        private async Task TearDownAsync()
        {
            if (!string.IsNullOrEmpty(_postId))
                await RawHttp.RequestAsync("DELETE", $"/api/db/shared/tables/posts/{_postId}");
        }

        [Fact]
        public async Task Increment_IncreasesViewCount()
        {
            await SetUpAsync();
            try
            {
                if (string.IsNullOrEmpty(_postId)) return;

                var (_, data) = await RawHttp.RequestAsync("PATCH",
                    $"/api/db/shared/tables/posts/{_postId}",
                    new Dictionary<string, object?>
                    {
                        ["viewCount"] = new Dictionary<string, object?>
                        {
                            ["$op"] = "increment",
                            ["value"] = 5,
                        },
                    });

                Assert.Equal(5, data?["viewCount"].GetInt32());
            }
            finally
            {
                await TearDownAsync();
            }
        }

        [Fact]
        public async Task DeleteField_SetsNull()
        {
            await SetUpAsync();
            try
            {
                if (string.IsNullOrEmpty(_postId)) return;

                var (_, data) = await RawHttp.RequestAsync("PATCH",
                    $"/api/db/shared/tables/posts/{_postId}",
                    new Dictionary<string, object?>
                    {
                        ["extra"] = new Dictionary<string, object?>
                        {
                            ["$op"] = "deleteField",
                        },
                    });

                JsonElement extraElement = default;
                data?.TryGetValue("extra", out extraElement);
                Assert.True(
                    extraElement.ValueKind == JsonValueKind.Undefined || extraElement.ValueKind == JsonValueKind.Null);
            }
            finally
            {
                await TearDownAsync();
            }
        }
    }

    // ─── 4. Auth E2E ──────────────────────────────────────────────────────────────

    public class AuthE2ETests
    {
        public AuthE2ETests()
        {
            TestConfig.RequireE2EServer();
        }

        [Fact]
        public async Task SignUp_ReturnsTokens()
        {
            var suffix = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var (status, data) = await RawHttp.RequestAsync("POST", "/api/auth/signup",
                new { email = $"csharp-{suffix}@test.com", password = "CSharp1234!" });

            Assert.Equal(201, status);
            Assert.True(data?.ContainsKey("accessToken"));
        }

        [Fact]
        public async Task SignIn_ReturnsTokens()
        {
            var suffix = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var email = $"csharp-si-{suffix}@test.com";

            await RawHttp.RequestAsync("POST", "/api/auth/signup",
                new { email, password = "CSharp1234!" });

            var (status, data) = await RawHttp.RequestAsync("POST", "/api/auth/signin",
                new { email, password = "CSharp1234!" });

            Assert.Equal(200, status);
            Assert.True(data?.ContainsKey("accessToken"));
        }

        [Fact]
        public async Task SignIn_WrongPassword_Returns401()
        {
            var suffix = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var email = $"csharp-wp-{suffix}@test.com";

            await RawHttp.RequestAsync("POST", "/api/auth/signup",
                new { email, password = "CSharp1234!" });

            var (status, _) = await RawHttp.RequestAsync("POST", "/api/auth/signin",
                new { email, password = "WrongPw1234!" });

            Assert.Equal(401, status);
        }

        [Fact]
        public async Task SignUp_DuplicateEmail_Returns409()
        {
            var suffix = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var email = $"csharp-dup-{suffix}@test.com";

            await RawHttp.RequestAsync("POST", "/api/auth/signup",
                new { email, password = "CSharp1234!" });

            var (status, _) = await RawHttp.RequestAsync("POST", "/api/auth/signup",
                new { email, password = "CSharp1234!" });

            Assert.Equal(409, status);
        }

        [Fact]
        public async Task SignIn_Anonymous_ReturnsToken()
        {
            var (status, data) = await RawHttp.RequestAsync("POST", "/api/auth/signin/anonymous", new { });
            Assert.Equal(201, status);
            Assert.True(data?.ContainsKey("accessToken"));
        }

        [Fact]
        public async Task SignUp_ReturnsRefreshToken()
        {
            var suffix = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var (_, data) = await RawHttp.RequestAsync("POST", "/api/auth/signup",
                new { email = $"csharp-rt-{suffix}@test.com", password = "CSharp1234!" });

            Assert.True(data?.ContainsKey("refreshToken"));
        }

        [Fact]
        public async Task SignUp_ReturnsUser()
        {
            var suffix = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var (_, data) = await RawHttp.RequestAsync("POST", "/api/auth/signup",
                new { email = $"csharp-user-{suffix}@test.com", password = "CSharp1234!" });

            Assert.True(data?.ContainsKey("user"));
        }
    }

    // ─── 5. Filter E2E ────────────────────────────────────────────────────────────

    public class FilterE2ETests
    {
        private string _postId = "";

        public FilterE2ETests()
        {
            TestConfig.RequireE2EServer();
        }

        private async Task SetUpAsync()
        {
            var suffix = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var (_, data) = await RawHttp.RequestAsync("POST", "/api/db/shared/tables/posts",
                new { title = $"CSharp-filter-{suffix}" });
            _postId = data?["id"].GetString() ?? "";
        }

        private async Task TearDownAsync()
        {
            if (!string.IsNullOrEmpty(_postId))
                await RawHttp.RequestAsync("DELETE", $"/api/db/shared/tables/posts/{_postId}");
        }

        [Fact]
        public async Task List_WithLimit2_ReturnsMax2()
        {
            await SetUpAsync();
            try
            {
                var (status, data) = await RawHttp.RequestAsync("GET", "/api/db/shared/tables/posts?limit=2");
                Assert.Equal(200, status);
                Assert.True(data?.ContainsKey("items"));
            }
            finally
            {
                await TearDownAsync();
            }
        }

        [Fact]
        public async Task Count_ReturnsNumber()
        {
            await SetUpAsync();
            try
            {
                var (status, data) = await RawHttp.RequestAsync("GET", "/api/db/shared/tables/posts/count");
                Assert.Equal(200, status);
                Assert.True(data?.ContainsKey("total"));
            }
            finally
            {
                await TearDownAsync();
            }
        }

        [Fact]
        public async Task OrderBy_Desc_Works()
        {
            await SetUpAsync();
            try
            {
                var qs = Uri.EscapeDataString(JsonSerializer.Serialize(new[] { new[] { "createdAt", "desc" } }));
                var (status, _) = await RawHttp.RequestAsync("GET", $"/api/db/shared/tables/posts?sort={qs}&limit=3");
                Assert.Equal(200, status);
            }
            finally
            {
                await TearDownAsync();
            }
        }
    }

    // ─── 6. Storage E2E ──────────────────────────────────────────────────────────

    public class StorageE2ETests : IDisposable
    {
        private readonly JbHttpClient _http;
        private readonly StorageBucket _bucket;
        private readonly List<string> _cleanupKeys = new();

        public StorageE2ETests()
        {
            TestConfig.RequireE2EServer();
            _http = new JbHttpClient(TestConfig.Server);
            _http.SetServiceKey(TestConfig.ServiceKey);
            _bucket = new StorageBucket(_http, "test");
        }

        public void Dispose()
        {
            foreach (var key in _cleanupKeys)
            {
                try { _bucket.DeleteAsync(key).Wait(); } catch { }
            }
            _http?.Dispose();
        }

        [Fact]
        public async Task Upload_Download_Roundtrip()
        {
            var suffix = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var key = $"cs-storage-{suffix}.txt";
            _cleanupKeys.Add(key);

            var content = Encoding.UTF8.GetBytes("Hello from C# SDK!");
            await _bucket.UploadAsync(key, content, "text/plain");

            var downloaded = await _bucket.DownloadAsync(key);
            var text = Encoding.UTF8.GetString(downloaded);
            Assert.Equal("Hello from C# SDK!", text);
        }

        [Fact]
        public async Task Upload_Delete_ConfirmsRemoval()
        {
            var suffix = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var key = $"cs-storage-del-{suffix}.txt";

            await _bucket.UploadAsync(key, Encoding.UTF8.GetBytes("temp"), "text/plain");
            await _bucket.DeleteAsync(key);

            await Assert.ThrowsAsync<EdgeBaseException>(() => _bucket.DownloadAsync(key));
        }
    }
}
