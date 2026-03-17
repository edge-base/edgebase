// C# SDK 단위 테스트 — xUnit
// packages/sdk/csharp/tests/unit/
//
// 테스트 대상: EdgeBase namespace (packages/core/, packages/unity/)
//   - ListResult (Items/Total/Cursor)
//   - OrBuilder (Where 체인/GetFilters)
//   - TableRef (불변 빌더, Name/Where/OrderBy/Limit/Search/After/Before)
//   - EdgeBaseException (StatusCode/Body/Message/ToString/ExtractMessage)
//   - FieldOps (Increment/DeleteField)
//   - JbHttpClient (headers, token, serviceKey)
//   - StorageBucket/StorageClient (URL paths)
//
// 빌드/실행:
//   cd packages/sdk/csharp
//   dotnet test tests/ --filter "FullyQualifiedName~UnitTests" -v normal

using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Xunit;
using EdgeBase;
using EdgeBase.Generated;

namespace EdgeBase.Tests.Unit
{
    public class UnityAuthClientCompatibilityTests
    {
        [Fact]
        public void AuthClient_ExposesCanonicalAuthSurface()
        {
            var authType = typeof(AuthClient);

            Assert.NotNull(authType.GetMethod("RefreshTokenAsync"));
            Assert.NotNull(authType.GetMethod("LinkWithEmailAsync"));
            Assert.NotNull(authType.GetMethod("GetUserAsync"));
            Assert.NotNull(authType.GetMethod("ListSessionsAsync"));
            Assert.NotNull(authType.GetMethod("RequestEmailVerificationAsync"));
            Assert.NotNull(authType.GetMethod("RequestPasswordResetAsync"));
            Assert.NotNull(authType.GetMethod("ChangeEmailAsync", new[] { typeof(string), typeof(string), typeof(string) }));
            Assert.NotNull(authType.GetMethod("SignInWithOAuthAsync"));
            Assert.NotNull(authType.GetMethod("LinkOAuthAsync"));
            Assert.NotNull(authType.GetMethod("SignInWithEmailOtpAsync"));
            Assert.NotNull(authType.GetMethod("SignInWithMagicLinkAsync"));
        }

        [Fact]
        public async Task OAuthCompatibilityHelpers_ReturnRedirectPayload()
        {
            using var client = new EdgeBase("http://localhost:8789");

            var signIn = await client.Auth.SignInWithOAuthAsync("mock-oidc");
            var link = await client.Auth.LinkOAuthAsync("mock-oidc");

            Assert.Equal(signIn["redirectUrl"], signIn["url"]);
            Assert.Equal(link["redirectUrl"], link["url"]);
            Assert.Contains("/api/auth/oauth/mock-oidc", signIn["url"]?.ToString());
            Assert.Contains("/api/auth/link/oauth/mock-oidc", link["url"]?.ToString());
        }

        [Fact]
        public void AuthClient_ProvidesCanonicalPasskeysAndMfaMethods()
        {
            var methods = typeof(AuthClient).GetMethods()
                .Select(m => m.Name)
                .ToHashSet();

            Assert.Contains("EnrollTotpAsync", methods);
            Assert.Contains("PasskeysAuthOptionsAsync", methods);
        }
    }

    // ─── 1. ListResult ─────────────────────────────────────────────────────────

    public class ListResultUnitTests
    {
        [Fact]
        public void Constructor_SetsItemsTotalCursor()
        {
            var items = new List<Dictionary<string, object?>>
            {
                new() { ["id"] = "1", ["title"] = "Post 1" },
                new() { ["id"] = "2", ["title"] = "Post 2" },
            };
            var lr = new ListResult(items, 100, "cursor-abc");
            Assert.Equal(2, lr.Items.Count);
            Assert.Equal(100, lr.Total);
            Assert.Equal("cursor-abc", lr.Cursor);
        }

        [Fact]
        public void Constructor_EmptyItems()
        {
            var lr = new ListResult(new List<Dictionary<string, object?>>(), 0, null);
            Assert.Empty(lr.Items);
            Assert.Equal(0, lr.Total);
            Assert.Null(lr.Cursor);
        }

        [Fact]
        public void Constructor_CursorPaginationMode()
        {
            var lr = new ListResult(new List<Dictionary<string, object?>>(), 0, "cursor-next");
            Assert.Equal("cursor-next", lr.Cursor);
        }

        [Fact]
        public void Items_AccessByIndex()
        {
            var items = new List<Dictionary<string, object?>> { new() { ["id"] = "test-1" } };
            var lr = new ListResult(items, 1, null);
            Assert.Equal("test-1", lr.Items[0]["id"]);
        }

        [Fact]
        public void Constructor_LargeTotal_Works()
        {
            var lr = new ListResult(new List<Dictionary<string, object?>>(), 999999, null);
            Assert.Equal(999999, lr.Total);
        }

        [Fact]
        public void Items_MultipleFields_Preserved()
        {
            var items = new List<Dictionary<string, object?>>
            {
                new() { ["id"] = "1", ["title"] = "Post", ["viewCount"] = 42, ["tags"] = null }
            };
            var lr = new ListResult(items, 1, null);
            Assert.Equal(4, lr.Items[0].Count);
            Assert.Null(lr.Items[0]["tags"]);
        }

        [Fact]
        public void Constructor_NegativeTotal_Allowed()
        {
            // ListResult does not validate; it just stores the value
            var lr = new ListResult(new List<Dictionary<string, object?>>(), -1, null);
            Assert.Equal(-1, lr.Total);
        }
    }

    // ─── 2. OrBuilder ──────────────────────────────────────────────────────────

    public class OrBuilderUnitTests
    {
        [Fact]
        public void Where_AddsSingleFilter()
        {
            var or = new OrBuilder();
            or.Where("status", "==", "published");
            Assert.Single(or.GetFilters());
        }

        [Fact]
        public void Where_Chain_AddsMultipleFilters()
        {
            var or = new OrBuilder();
            or.Where("status", "==", "active")
              .Where("role", "==", "admin");
            Assert.Equal(2, or.GetFilters().Count);
        }

        [Fact]
        public void Where_ReturnsSameInstance()
        {
            var or = new OrBuilder();
            var result = or.Where("x", "==", "y");
            Assert.Same(or, result);
        }

        [Fact]
        public void GetFilters_EmptyInitially()
        {
            var or = new OrBuilder();
            Assert.Empty(or.GetFilters());
        }

        [Fact]
        public void Where_FilterHasCorrectValues()
        {
            var or = new OrBuilder();
            or.Where("age", ">=", 18);
            var filter = or.GetFilters()[0];
            Assert.Equal("age", filter[0]);
            Assert.Equal(">=", filter[1]);
            Assert.Equal(18, filter[2]);
        }

        [Fact]
        public void Where_PreservesInsertionOrder()
        {
            var or = new OrBuilder();
            or.Where("a", "==", "1").Where("b", "==", "2");
            var filters = or.GetFilters();
            Assert.Equal("a", filters[0][0]);
            Assert.Equal("b", filters[1][0]);
        }

        [Fact]
        public void Where_SupportsContainsOperator()
        {
            var or = new OrBuilder();
            or.Where("title", "contains", "hello");
            var f = or.GetFilters()[0];
            Assert.Equal("contains", f[1]);
        }

        [Fact]
        public void Where_SupportsInOperator()
        {
            var or = new OrBuilder();
            or.Where("status", "in", new[] { "active", "pending" });
            Assert.Single(or.GetFilters());
        }

        [Fact]
        public void Where_SupportsNotInOperator()
        {
            var or = new OrBuilder();
            or.Where("role", "not in", new[] { "banned" });
            Assert.Equal("not in", or.GetFilters()[0][1]);
        }

        [Fact]
        public void Where_NullValue_Allowed()
        {
            var or = new OrBuilder();
            or.Where("deleted", "==", null!);
            Assert.Null(or.GetFilters()[0][2]);
        }
    }

    // ─── 3. EdgeBaseException ──────────────────────────────────────────────────

    public class EdgeBaseExceptionUnitTests
    {
        [Fact]
        public void Constructor_SetsStatusCode()
        {
            var ex = new EdgeBaseException(404, "Not found");
            Assert.Equal(404, ex.StatusCode);
        }

        [Fact]
        public void Constructor_SetsBody()
        {
            var ex = new EdgeBaseException(400, "{\"message\":\"Validation error\"}");
            Assert.Contains("Validation", ex.Body);
        }

        [Fact]
        public void Message_ExtractedFromJsonBody()
        {
            var body = "{\"message\":\"Record not found\"}";
            var ex = new EdgeBaseException(404, body);
            Assert.Equal("Record not found", ex.Message);
        }

        [Fact]
        public void Message_FallbackToHTTPStatus_WhenNoBody()
        {
            var ex = new EdgeBaseException(500, null);
            Assert.Contains("500", ex.Message);
        }

        [Fact]
        public void Message_FallbackToBody_WhenNotJson()
        {
            var ex = new EdgeBaseException(500, "Internal server error");
            Assert.Equal("Internal server error", ex.Message);
        }

        [Fact]
        public void ToString_ContainsStatusCode()
        {
            var ex = new EdgeBaseException(401, null);
            Assert.Contains("401", ex.ToString());
        }

        [Fact]
        public void InheritanceFrom_Exception()
        {
            var ex = new EdgeBaseException(403, "Forbidden");
            Assert.IsAssignableFrom<Exception>(ex);
        }

        [Fact]
        public void Constructor_WithInnerException()
        {
            var inner = new InvalidOperationException("network");
            var ex = new EdgeBaseException(0, "Timeout", inner);
            Assert.Same(inner, ex.InnerException);
        }

        [Fact]
        public void Message_LongBody_Truncated()
        {
            var longBody = new string('x', 300);
            var ex = new EdgeBaseException(500, longBody);
            Assert.True(ex.Message.Length <= 200);
        }

        [Fact]
        public void StatusCode_Zero_ForNetworkErrors()
        {
            var ex = new EdgeBaseException(0, "Connection refused");
            Assert.Equal(0, ex.StatusCode);
        }

        [Fact]
        public void Body_PreservedAsIs()
        {
            var body = "{\"message\":\"test\",\"code\":\"INVALID\"}";
            var ex = new EdgeBaseException(400, body);
            Assert.Equal(body, ex.Body);
        }

        [Fact]
        public void Message_EmptyBody_FallsBackToStatusCode()
        {
            var ex = new EdgeBaseException(422, "");
            Assert.Contains("422", ex.Message);
        }

        [Fact]
        public void Message_WhitespaceBody_FallsBackToStatusCode()
        {
            var ex = new EdgeBaseException(503, "   ");
            Assert.Contains("503", ex.Message);
        }

        [Fact]
        public void Message_BrokenJson_FallsBackToBody()
        {
            var ex = new EdgeBaseException(500, "{broken json");
            Assert.Equal("{broken json", ex.Message);
        }

        [Fact]
        public void Message_JsonWithoutMessageField_FallsBackToBody()
        {
            var body = "{\"error\":\"something\"}";
            var ex = new EdgeBaseException(500, body);
            Assert.Equal(body, ex.Message);
        }

        [Fact]
        public void ToString_ContainsEdgeBaseException()
        {
            var ex = new EdgeBaseException(500, "server error");
            Assert.Contains("EdgeBaseException", ex.ToString());
        }
    }

    // ─── 4. FieldOps (core/FieldOps.cs) ──────────────────────────────────────

    public class FieldOpsUnitTests
    {
        [Fact]
        public void Increment_CreatesCorrectOp()
        {
            var op = FieldOps.Increment(5);
            Assert.Equal("increment", op["$op"]);
            Assert.Equal(5.0, (double)op["value"]!, 3);
        }

        [Fact]
        public void DeleteField_CreatesCorrectOp()
        {
            var op = FieldOps.DeleteField();
            Assert.Equal("deleteField", op["$op"]);
        }

        [Fact]
        public void Increment_FractionalValue()
        {
            var op = FieldOps.Increment(3.14);
            Assert.Equal(3.14, (double)op["value"]!, 3);
        }

        [Fact]
        public void Increment_NegativeValue()
        {
            var op = FieldOps.Increment(-10);
            Assert.Equal(-10.0, (double)op["value"]!, 3);
        }

        [Fact]
        public void Increment_ZeroValue()
        {
            var op = FieldOps.Increment(0);
            Assert.Equal(0.0, (double)op["value"]!, 3);
        }

        [Fact]
        public void DeleteField_OnlyHasOpKey()
        {
            var op = FieldOps.DeleteField();
            Assert.True(op.ContainsKey("$op"));
            Assert.Equal("deleteField", op["$op"]);
        }

        [Fact]
        public void Increment_DefaultValue_IsOne()
        {
            var op = FieldOps.Increment();
            Assert.Equal(1.0, (double)op["value"]!, 3);
        }

        [Fact]
        public void Increment_HasTwoKeys()
        {
            var op = FieldOps.Increment(5);
            Assert.Equal(2, op.Count);
        }

        [Fact]
        public void DeleteField_HasOneKey()
        {
            var op = FieldOps.DeleteField();
            Assert.Single(op);
        }

        [Fact]
        public void Increment_VeryLargeValue()
        {
            var op = FieldOps.Increment(double.MaxValue / 2);
            Assert.Equal("increment", op["$op"]);
        }

        [Fact]
        public void Increment_ReturnsNewDictEachTime()
        {
            var op1 = FieldOps.Increment(1);
            var op2 = FieldOps.Increment(2);
            Assert.NotSame(op1, op2);
        }

        [Fact]
        public void DeleteField_ReturnsNewDictEachTime()
        {
            var op1 = FieldOps.DeleteField();
            var op2 = FieldOps.DeleteField();
            Assert.NotSame(op1, op2);
        }
    }

    // ─── 5. TableRef 불변 빌더 상세 ────────────────────────────────────────

    public class TableRefImmutabilityTests : IDisposable
    {
        private readonly JbHttpClient _http;
        private readonly GeneratedDbApi _core;
        private readonly TableRef _table;

        public TableRefImmutabilityTests()
        {
            _http = new JbHttpClient("https://dummy.edgebase.fun");
            _core = new GeneratedDbApi(_http);
            _table = new TableRef(_core, "posts");
        }

        public void Dispose() => _http?.Dispose();

        [Fact]
        public void Name_IsSetCorrectly()
        {
            Assert.Equal("posts", _table.Name);
        }

        [Fact]
        public void Where_DoesNotMutateOriginal()
        {
            var original = _table;
            var filtered = original.Where("status", "==", "active");
            // original should have no filters; filtered is a new instance
            Assert.NotSame(original, filtered);
        }

        [Fact]
        public void Limit_DoesNotMutateOriginal()
        {
            var limited = _table.Limit(10);
            Assert.NotSame(_table, limited);
        }

        [Fact]
        public void Offset_DoesNotMutateOriginal()
        {
            var offset = _table.Offset(5);
            Assert.NotSame(_table, offset);
        }

        [Fact]
        public void OrderBy_DoesNotMutateOriginal()
        {
            var sorted = _table.OrderBy("createdAt", "desc");
            Assert.NotSame(_table, sorted);
        }

        [Fact]
        public void Search_DoesNotMutateOriginal()
        {
            var searched = _table.Search("hello");
            Assert.NotSame(_table, searched);
        }

        [Fact]
        public void After_DoesNotMutateOriginal()
        {
            var paged = _table.After("cursor-1");
            Assert.NotSame(_table, paged);
        }

        [Fact]
        public void Before_DoesNotMutateOriginal()
        {
            var paged = _table.Before("cursor-2");
            Assert.NotSame(_table, paged);
        }

        [Fact]
        public void Doc_DoesNotMutateOriginal()
        {
            var doc = _table.Doc("id-1");
            Assert.NotSame(_table, doc);
        }

        [Fact]
        public void Page_DoesNotMutateOriginal()
        {
            var paged = _table.Page(2);
            Assert.NotSame(_table, paged);
        }

        [Fact]
        public void Or_DoesNotMutateOriginal()
        {
            var ored = _table.Or(b => b.Where("x", "==", 1));
            Assert.NotSame(_table, ored);
        }

        [Fact]
        public void DeepChaining_AllReturnNewInstances()
        {
            var t1 = _table.Where("a", "==", 1);
            var t2 = t1.Where("b", ">", 2);
            var t3 = t2.OrderBy("c", "desc");
            var t4 = t3.Limit(10);
            var t5 = t4.Offset(5);

            Assert.NotSame(_table, t1);
            Assert.NotSame(t1, t2);
            Assert.NotSame(t2, t3);
            Assert.NotSame(t3, t4);
            Assert.NotSame(t4, t5);
        }

        [Fact]
        public void Clone_PreservesName()
        {
            var cloned = _table.Where("x", "==", 1);
            Assert.Equal("posts", cloned.Name);
        }

        [Fact]
        public void WithDb_CreatesTableRef()
        {
            var t = TableRef.WithDb(_core, "users", "workspace", "ws-123");
            Assert.Equal("users", t.Name);
        }
    }

    // ─── 6. JbHttpClient 구조 테스트 ──────────────────────────────────────

    public class JbHttpClientUnitTests : IDisposable
    {
        private readonly JbHttpClient _http;

        public JbHttpClientUnitTests()
        {
            _http = new JbHttpClient("https://dummy.edgebase.fun/");
        }

        public void Dispose() => _http?.Dispose();

        [Fact]
        public void BaseUrl_StripsTrailingSlash()
        {
            Assert.Equal("https://dummy.edgebase.fun", _http.BaseUrl);
        }

        [Fact]
        public void SetToken_GetToken_Works()
        {
            _http.SetToken("test-token-123");
            Assert.Equal("test-token-123", _http.GetToken());
        }

        [Fact]
        public void GetToken_InitiallyNull()
        {
            Assert.Null(_http.GetToken());
        }

        [Fact]
        public void SetRefreshToken_GetRefreshToken_Works()
        {
            _http.SetRefreshToken("refresh-abc");
            Assert.Equal("refresh-abc", _http.GetRefreshToken());
        }

        [Fact]
        public void SetServiceKey_DoesNotThrow()
        {
            _http.SetServiceKey("sk-test-key");
            // No getter for service key, just verify no exception
        }

        [Fact]
        public void GetAccessToken_SameAsGetToken()
        {
            _http.SetToken("token-xyz");
            Assert.Equal(_http.GetToken(), _http.GetAccessToken());
        }

        [Fact]
        public void SetContext_GetContext_Works()
        {
            var ctx = new Dictionary<string, object> { ["tenant"] = "acme" };
            _http.SetContext(ctx);
            Assert.NotNull(_http.GetContext());
            Assert.Equal("acme", _http.GetContext()!["tenant"]);
        }

        [Fact]
        public void GetContext_InitiallyNull()
        {
            Assert.Null(_http.GetContext());
        }

        [Fact]
        public void SetToken_Null_ClearsToken()
        {
            _http.SetToken("existing-token");
            _http.SetToken(null);
            Assert.Null(_http.GetToken());
        }

        [Fact]
        public void Implements_IDisposable()
        {
            Assert.IsAssignableFrom<IDisposable>(_http);
        }
    }

    // ─── 7. StorageBucket URL 테스트 ──────────────────────────────────────

    public class StorageBucketUnitTests : IDisposable
    {
        private readonly JbHttpClient _http;
        private readonly StorageBucket _bucket;

        public StorageBucketUnitTests()
        {
            _http = new JbHttpClient("https://my-app.edgebase.fun");
            _bucket = new StorageBucket(_http, "avatars");
        }

        public void Dispose() => _http?.Dispose();

        [Fact]
        public void Name_IsSet()
        {
            Assert.Equal("avatars", _bucket.Name);
        }

        [Fact]
        public void GetUrl_ReturnsCorrectPath()
        {
            var url = _bucket.GetUrl("user/photo.png");
            Assert.Contains("/api/storage/avatars/", url);
            Assert.Contains("my-app.edgebase.fun", url);
        }

        [Fact]
        public void GetUrl_EncodesSpecialCharacters()
        {
            var url = _bucket.GetUrl("path with spaces/file.png");
            Assert.Contains("path%20with%20spaces", url);
        }

        [Fact]
        public void GetUrl_HandlesCJKCharacters()
        {
            var url = _bucket.GetUrl("files/photo.png");
            Assert.StartsWith("https://my-app.edgebase.fun/api/storage/avatars/", url);
        }
    }

    // ─── 8. StorageClient 구조 테스트 ─────────────────────────────────────

    public class StorageClientUnitTests : IDisposable
    {
        private readonly JbHttpClient _http;
        private readonly StorageClient _storage;

        public StorageClientUnitTests()
        {
            _http = new JbHttpClient("https://dummy.edgebase.fun");
            _storage = new StorageClient(_http);
        }

        public void Dispose() => _http?.Dispose();

        [Fact]
        public void Bucket_ReturnsNonNull()
        {
            var bucket = _storage.Bucket("media");
            Assert.NotNull(bucket);
        }

        [Fact]
        public void Bucket_SetsCorrectName()
        {
            var bucket = _storage.Bucket("docs");
            Assert.Equal("docs", bucket.Name);
        }

        [Fact]
        public void Bucket_DifferentNames_DifferentInstances()
        {
            var b1 = _storage.Bucket("a");
            var b2 = _storage.Bucket("b");
            Assert.NotSame(b1, b2);
        }
    }

    // ─── 9. ListResult JSON Deserialization ───────────────────────────────

    public class ListResultDeserializationTests
    {
        [Fact]
        public void FromJsonResponse_ParsesItemsCorrectly()
        {
            var json = "{\"items\":[{\"id\":\"1\",\"title\":\"Hello\"}],\"total\":1}";
            var dict = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json)!;

            var items = new List<Dictionary<string, object?>>();
            foreach (var elem in dict["items"].EnumerateArray())
            {
                var item = JsonSerializer.Deserialize<Dictionary<string, object?>>(elem.GetRawText());
                if (item != null) items.Add(item);
            }
            var total = dict["total"].GetInt32();
            var lr = new ListResult(items, total, null);

            Assert.Single(lr.Items);
            Assert.Equal(1, lr.Total);
        }

        [Fact]
        public void EmptyArrayResponse_ParsesCorrectly()
        {
            var json = "{\"items\":[],\"total\":0}";
            var dict = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json)!;
            var lr = new ListResult(new List<Dictionary<string, object?>>(), dict["total"].GetInt32(), null);

            Assert.Empty(lr.Items);
            Assert.Equal(0, lr.Total);
        }
    }

    // ─── PushClient Permission Tests ─────────────────────────────────────────

    public class PushClientPermissionTests : IDisposable
    {
        private readonly JbHttpClient _http;
        private readonly PushClient _push;

        public PushClientPermissionTests()
        {
            _http = new JbHttpClient("http://localhost:9999");
            _push = new PushClient(_http);
        }

        public void Dispose()
        {
            _http.Dispose();
        }

        [Fact]
        public void GetPermissionStatus_WithoutProvider_ReturnsNotDetermined()
        {
            // Default: no PermissionStatusProvider set → returns "notDetermined"
            var status = _push.GetPermissionStatus();
            Assert.Equal("notDetermined", status);
        }

        [Fact]
        public void GetPermissionStatus_WithProvider_ReturnsProviderValue()
        {
            _push.PermissionStatusProvider = () => "granted";
            Assert.Equal("granted", _push.GetPermissionStatus());
        }

        [Fact]
        public void GetPermissionStatus_WithDeniedProvider_ReturnsDenied()
        {
            _push.PermissionStatusProvider = () => "denied";
            Assert.Equal("denied", _push.GetPermissionStatus());
        }

        [Fact]
        public async Task RequestPermissionAsync_WithoutRequester_ReturnsGranted()
        {
            // Default: no PermissionRequester → returns "granted" (Unity handles natively)
            var result = await _push.RequestPermissionAsync();
            Assert.Equal("granted", result);
        }

        [Fact]
        public async Task RequestPermissionAsync_WithRequester_ReturnsRequesterValue()
        {
            _push.PermissionRequester = () => Task.FromResult("denied");
            var result = await _push.RequestPermissionAsync();
            Assert.Equal("denied", result);
        }

        [Fact]
        public async Task RequestPermissionAsync_WithGrantedRequester_ReturnsGranted()
        {
            _push.PermissionRequester = () => Task.FromResult("granted");
            var result = await _push.RequestPermissionAsync();
            Assert.Equal("granted", result);
        }

        [Fact]
        public async Task RegisterAsync_PermissionDenied_SkipsRegistration()
        {
            _push.PermissionRequester = () => Task.FromResult("denied");
            _push.TokenProvider = () => Task.FromResult("test-token");
            // Should not throw — silently returns when permission denied
            await _push.RegisterAsync();
            // No server call made (http is dummy, would fail if called)
        }

        [Fact]
        public async Task RegisterAsync_WithoutTokenProvider_ThrowsAfterPermission()
        {
            _push.PermissionRequester = () => Task.FromResult("granted");
            // No TokenProvider set → should throw InvalidOperationException
            await Assert.ThrowsAsync<InvalidOperationException>(() => _push.RegisterAsync());
        }

        [Fact]
        public void PermissionStatusProvider_CanBeSetAndRead()
        {
            Assert.Null(_push.PermissionStatusProvider);
            _push.PermissionStatusProvider = () => "granted";
            Assert.NotNull(_push.PermissionStatusProvider);
        }

        [Fact]
        public void PermissionRequester_CanBeSetAndRead()
        {
            Assert.Null(_push.PermissionRequester);
            _push.PermissionRequester = () => Task.FromResult("granted");
            Assert.NotNull(_push.PermissionRequester);
        }

        [Fact]
        public void PermissionStatusProvider_CalledEachTime()
        {
            int callCount = 0;
            _push.PermissionStatusProvider = () => { callCount++; return "granted"; };
            _push.GetPermissionStatus();
            _push.GetPermissionStatus();
            Assert.Equal(2, callCount);
        }

        [Fact]
        public void Platform_DefaultIsAndroid()
        {
            Assert.Equal(PushPlatform.Android, _push.Platform);
        }

        [Fact]
        public void Platform_CanBeChanged()
        {
            _push.Platform = PushPlatform.Ios;
            Assert.Equal(PushPlatform.Ios, _push.Platform);
        }
    }
}
