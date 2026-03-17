using System;
using System.Collections.Generic;
using System.Reflection;
using Xunit;
using EdgeBase.Admin;
// EdgeBase C# Admin SDK 단위 테스트 — AdminClient / AdminAuthClient / KvClient / D1Client /
//                                      VectorizeClient / AdminPushClient / BroadcastAsync 구조 검증
//
// 실행: cd packages/sdk/csharp/packages/admin/tests && dotnet test
//
// 원칙: 서버 불필요, 순수 클래스 구조 검증

namespace EdgeBase.Admin.Tests
{
    // ─── A. AdminClient 생성 ──────────────────────────────────────────────────

    public class AdminClientConstructorUnitTests
    {
        [Fact]
        public void Constructor_requires_url()
        {
            Assert.Throws<ArgumentException>(() => new AdminClient("", "sk-test"));
        }

        [Fact]
        public void Constructor_requires_serviceKey()
        {
            Assert.Throws<ArgumentException>(() => new AdminClient("https://dummy.edgebase.fun", ""));
        }

        [Fact]
        public void Instantiation_succeeds()
        {
            using var admin = new AdminClient("https://dummy.edgebase.fun", "sk-test");
            Assert.NotNull(admin);
        }

        [Fact]
        public void AdminAuth_property_exists()
        {
            using var admin = new AdminClient("https://dummy.edgebase.fun", "sk-test");
            Assert.NotNull(admin.AdminAuth);
        }

        [Fact]
        public void Storage_property_exists()
        {
            using var admin = new AdminClient("https://dummy.edgebase.fun", "sk-test");
            Assert.NotNull(admin.Storage);
        }

        [Fact]
        public void Push_property_exists()
        {
            using var admin = new AdminClient("https://dummy.edgebase.fun", "sk-test");
            Assert.NotNull(admin.Push);
        }

        [Fact]
        public void Functions_property_exists()
        {
            using var admin = new AdminClient("https://dummy.edgebase.fun", "sk-test");
            Assert.NotNull(admin.Functions);
        }

        [Fact]
        public void Analytics_property_exists()
        {
            using var admin = new AdminClient("https://dummy.edgebase.fun", "sk-test");
            Assert.NotNull(admin.Analytics);
        }

        [Fact]
        public void Table_method_exists()
        {
            var method = typeof(AdminClient).GetMethod("Table");
            Assert.NotNull(method);
        }

        [Fact]
        public void Db_method_exists()
        {
            var method = typeof(AdminClient).GetMethod("Db");
            Assert.NotNull(method);
        }

        [Fact]
        public void Kv_method_exists()
        {
            var method = typeof(AdminClient).GetMethod("Kv");
            Assert.NotNull(method);
        }

        [Fact]
        public void D1_method_exists()
        {
            var method = typeof(AdminClient).GetMethod("D1");
            Assert.NotNull(method);
        }

        [Fact]
        public void Vector_method_exists()
        {
            var method = typeof(AdminClient).GetMethod("Vector");
            Assert.NotNull(method);
        }

        [Fact]
        public void SqlAsync_method_exists()
        {
            var method = typeof(AdminClient).GetMethod("SqlAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void BroadcastAsync_method_exists()
        {
            var method = typeof(AdminClient).GetMethod("BroadcastAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void Destroy_method_exists()
        {
            var method = typeof(AdminClient).GetMethod("Destroy");
            Assert.NotNull(method);
        }

        [Fact]
        public void SetContext_method_exists()
        {
            var method = typeof(AdminClient).GetMethod("SetContext");
            Assert.NotNull(method);
        }

        [Fact]
        public void GetContext_method_exists()
        {
            var method = typeof(AdminClient).GetMethod("GetContext");
            Assert.NotNull(method);
        }

        [Fact]
        public void Implements_IDisposable()
        {
            Assert.True(typeof(IDisposable).IsAssignableFrom(typeof(AdminClient)));
        }

        [Fact]
        public void Table_returns_non_null()
        {
            using var admin = new AdminClient("https://dummy.edgebase.fun", "sk-test");
            var table = admin.Table("posts");
            Assert.NotNull(table);
        }

        [Fact]
        public void Kv_returns_non_null()
        {
            using var admin = new AdminClient("https://dummy.edgebase.fun", "sk-test");
            var kv = admin.Kv("test-ns");
            Assert.NotNull(kv);
        }

        [Fact]
        public void D1_returns_non_null()
        {
            using var admin = new AdminClient("https://dummy.edgebase.fun", "sk-test");
            var d1 = admin.D1("my-db");
            Assert.NotNull(d1);
        }

        [Fact]
        public void Vector_returns_non_null()
        {
            using var admin = new AdminClient("https://dummy.edgebase.fun", "sk-test");
            var vec = admin.Vector("my-index");
            Assert.NotNull(vec);
        }

        [Fact]
        public void Analytics_returns_non_null()
        {
            using var admin = new AdminClient("https://dummy.edgebase.fun", "sk-test");
            Assert.NotNull(admin.Analytics);
        }

        [Fact]
        public void Constructor_null_url_throws()
        {
            Assert.Throws<ArgumentException>(() => new AdminClient(null!, "sk-test"));
        }

        [Fact]
        public void Constructor_null_serviceKey_throws()
        {
            Assert.Throws<ArgumentException>(() => new AdminClient("https://dummy.edgebase.fun", null!));
        }

        [Fact]
        public void Constructor_whitespace_url_throws()
        {
            Assert.Throws<ArgumentException>(() => new AdminClient("   ", "sk-test"));
        }

        [Fact]
        public void Constructor_whitespace_serviceKey_throws()
        {
            Assert.Throws<ArgumentException>(() => new AdminClient("https://dummy.edgebase.fun", "  "));
        }

        [Fact]
        public void SetContext_and_GetContext_roundtrip()
        {
            using var admin = new AdminClient("https://dummy.edgebase.fun", "sk-test");
            admin.SetContext(new Dictionary<string, object> { ["tenantId"] = "acme" });
            var ctx = admin.GetContext();
            Assert.NotNull(ctx);
            Assert.Equal("acme", ctx!["tenantId"]);
        }

        [Fact]
        public void GetContext_initially_null()
        {
            using var admin = new AdminClient("https://dummy.edgebase.fun", "sk-test");
            Assert.Null(admin.GetContext());
        }
    }

    // ─── B. AdminAuthClient 메서드 구조 ──────────────────────────────────────

    public class AdminAuthClientUnitTests
    {
        [Fact]
        public void CreateUserAsync_method_exists()
        {
            var method = typeof(AdminAuthClient).GetMethod("CreateUserAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void GetUserAsync_method_exists()
        {
            var method = typeof(AdminAuthClient).GetMethod("GetUserAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void ListUsersAsync_method_exists()
        {
            var method = typeof(AdminAuthClient).GetMethod("ListUsersAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void UpdateUserAsync_method_exists()
        {
            var method = typeof(AdminAuthClient).GetMethod("UpdateUserAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void DeleteUserAsync_method_exists()
        {
            var method = typeof(AdminAuthClient).GetMethod("DeleteUserAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void SetCustomClaimsAsync_method_exists()
        {
            var method = typeof(AdminAuthClient).GetMethod("SetCustomClaimsAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void RevokeAllSessionsAsync_method_exists()
        {
            var method = typeof(AdminAuthClient).GetMethod("RevokeAllSessionsAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void CreateUserAsync_accepts_optional_params()
        {
            var method = typeof(AdminAuthClient).GetMethod("CreateUserAsync");
            Assert.NotNull(method);
            var parameters = method!.GetParameters();
            // email, password, displayName?, role?, ct
            Assert.True(parameters.Length >= 2);
        }

        [Fact]
        public void All_methods_return_Task()
        {
            foreach (var method in typeof(AdminAuthClient).GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
            {
                Assert.True(method.ReturnType.IsGenericType ||
                             method.ReturnType == typeof(System.Threading.Tasks.Task),
                    $"Method {method.Name} should return Task or Task<T>");
            }
        }
    }

    // ─── C. KvClient 구조 ─────────────────────────────────────────────────────

    public class KvClientStructureUnitTests
    {
        [Fact]
        public void SetAsync_method_exists()
        {
            var method = typeof(KvClient).GetMethod("SetAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void GetAsync_method_exists()
        {
            var method = typeof(KvClient).GetMethod("GetAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void DeleteAsync_method_exists()
        {
            var method = typeof(KvClient).GetMethod("DeleteAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void ListAsync_method_exists()
        {
            var method = typeof(KvClient).GetMethod("ListAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void SetAsync_supports_ttl_parameter()
        {
            var method = typeof(KvClient).GetMethod("SetAsync");
            Assert.NotNull(method);
            var parameters = method!.GetParameters();
            var ttlParam = Array.Find(parameters, p => p.Name == "ttl");
            Assert.NotNull(ttlParam);
        }

        [Fact]
        public void ListAsync_supports_prefix_parameter()
        {
            var method = typeof(KvClient).GetMethod("ListAsync");
            Assert.NotNull(method);
            var parameters = method!.GetParameters();
            var prefixParam = Array.Find(parameters, p => p.Name == "prefix");
            Assert.NotNull(prefixParam);
        }
    }

    // ─── D. D1Client 구조 ─────────────────────────────────────────────────────

    public class D1ClientStructureUnitTests
    {
        [Fact]
        public void ExecAsync_method_exists()
        {
            var method = typeof(D1Client).GetMethod("ExecAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void ExecAsync_supports_parameters()
        {
            var method = typeof(D1Client).GetMethod("ExecAsync");
            Assert.NotNull(method);
            var parameters = method!.GetParameters();
            // query, parameters?, ct
            Assert.True(parameters.Length >= 1);
        }
    }

    // ─── E. VectorizeClient 구조 ──────────────────────────────────────────────

    public class VectorizeClientStructureUnitTests
    {
        [Fact]
        public void UpsertAsync_method_exists()
        {
            var method = typeof(VectorizeClient).GetMethod("UpsertAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void SearchAsync_method_exists()
        {
            var method = typeof(VectorizeClient).GetMethod("SearchAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void DeleteAsync_method_exists()
        {
            var method = typeof(VectorizeClient).GetMethod("DeleteAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void InsertAsync_method_exists()
        {
            var method = typeof(VectorizeClient).GetMethod("InsertAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void QueryByIdAsync_method_exists()
        {
            var method = typeof(VectorizeClient).GetMethod("QueryByIdAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void GetByIdsAsync_method_exists()
        {
            var method = typeof(VectorizeClient).GetMethod("GetByIdsAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void DescribeAsync_method_exists()
        {
            var method = typeof(VectorizeClient).GetMethod("DescribeAsync");
            Assert.NotNull(method);
        }
    }

    // ─── F. AdminPushClient 구조 ──────────────────────────────────────────────

    public class AdminPushClientStructureUnitTests
    {
        [Fact]
        public void SendAsync_method_exists()
        {
            var method = typeof(AdminPushClient).GetMethod("SendAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void SendManyAsync_method_exists()
        {
            var method = typeof(AdminPushClient).GetMethod("SendManyAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void SendToTokenAsync_method_exists()
        {
            var method = typeof(AdminPushClient).GetMethod("SendToTokenAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void GetTokensAsync_method_exists()
        {
            var method = typeof(AdminPushClient).GetMethod("GetTokensAsync");
            Assert.NotNull(method);
        }

        [Fact]
        public void GetLogsAsync_method_exists()
        {
            var method = typeof(AdminPushClient).GetMethod("GetLogsAsync");
            Assert.NotNull(method);
        }
    }

    // ─── G. PushResult 구조 ────────────────────────────────────────────────────

    public class PushResultUnitTests
    {
        [Fact]
        public void Constructor_sets_all_fields()
        {
            var r = new PushResult(10, 2, 1);
            Assert.Equal(10, r.Sent);
            Assert.Equal(2, r.Failed);
            Assert.Equal(1, r.Removed);
        }

        [Fact]
        public void Zero_values_work()
        {
            var r = new PushResult(0, 0, 0);
            Assert.Equal(0, r.Sent);
            Assert.Equal(0, r.Failed);
            Assert.Equal(0, r.Removed);
        }
    }

    // ─── H. ListUsersResult 구조 ──────────────────────────────────────────────

    public class ListUsersResultUnitTests
    {
        [Fact]
        public void Constructor_sets_users_and_cursor()
        {
            var users = new List<Dictionary<string, object?>>
            {
                new() { ["id"] = "u1" },
                new() { ["id"] = "u2" },
            };
            var result = new ListUsersResult(users, "cursor-next");
            Assert.Equal(2, result.Users.Count);
            Assert.Equal("cursor-next", result.Cursor);
        }

        [Fact]
        public void Constructor_null_cursor()
        {
            var result = new ListUsersResult(new List<Dictionary<string, object?>>(), null);
            Assert.Empty(result.Users);
            Assert.Null(result.Cursor);
        }
    }

    // ─── I. KvListResult 구조 ─────────────────────────────────────────────────

    public class KvListResultUnitTests
    {
        [Fact]
        public void Constructor_sets_keys_and_cursor()
        {
            var keys = new List<string> { "k1", "k2", "k3" };
            var result = new KvListResult(keys, "next");
            Assert.Equal(3, result.Keys.Count);
            Assert.Equal("next", result.Cursor);
        }

        [Fact]
        public void Constructor_empty_keys()
        {
            var result = new KvListResult(new List<string>(), null);
            Assert.Empty(result.Keys);
            Assert.Null(result.Cursor);
        }
    }

    // ─── J. VectorInput / VectorMatch 구조 ────────────────────────────────────

    public class VectorTypesUnitTests
    {
        [Fact]
        public void VectorInput_default_values()
        {
            var v = new VectorInput();
            Assert.Equal("", v.Id);
            Assert.Empty(v.Values);
            Assert.Null(v.Metadata);
        }

        [Fact]
        public void VectorInput_set_values()
        {
            var v = new VectorInput
            {
                Id = "vec-1",
                Values = new[] { 0.1, 0.2, 0.3 },
                Metadata = new Dictionary<string, object?> { ["category"] = "test" }
            };
            Assert.Equal("vec-1", v.Id);
            Assert.Equal(3, v.Values.Length);
            Assert.NotNull(v.Metadata);
        }

        [Fact]
        public void VectorMatch_default_values()
        {
            var m = new VectorMatch();
            Assert.Equal("", m.Id);
            Assert.Equal(0.0, m.Score);
            Assert.Null(m.Metadata);
        }

        [Fact]
        public void VectorMatch_set_values()
        {
            var m = new VectorMatch
            {
                Id = "match-1",
                Score = 0.95,
                Metadata = new Dictionary<string, object?> { ["label"] = "cat" }
            };
            Assert.Equal("match-1", m.Id);
            Assert.Equal(0.95, m.Score, 3);
        }
    }
}
