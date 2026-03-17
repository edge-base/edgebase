using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Assert = Xunit.Assert;
using Fact = EdgeBase.Admin.Tests.E2EFactAttribute;
using EdgeBase.Admin;
// EdgeBase C# Admin SDK — E2E 테스트
//
// 전제: wrangler dev --port 8688 서버 실행 중
//
// 실행:
//   BASE_URL=http://localhost:8688 SERVICE_KEY=test-service-key-for-admin \
//     cd packages/sdk/csharp/packages/admin/tests && dotnet test
//
// 원칙: mock 금지, AdminClient 실서버 기반

namespace EdgeBase.Admin.Tests
{
    internal sealed class E2EFactAttribute : Xunit.FactAttribute
    {
        public E2EFactAttribute()
        {
            var baseUrl = Environment.GetEnvironmentVariable("BASE_URL") ?? "http://localhost:8688";
            if (Environment.GetEnvironmentVariable(E2ETestSupport.RequiredEnvName) == "1")
            {
                return;
            }

            if (!E2ETestSupport.IsServerAvailable(baseUrl))
            {
                Skip = E2ETestSupport.GetUnavailableMessage(baseUrl);
            }
        }
    }

    internal static class E2ETestSupport
    {
        internal const string RequiredEnvName = "EDGEBASE_E2E_REQUIRED";
        internal static string GetUnavailableMessage(string baseUrl) =>
            $"E2E backend not reachable at {baseUrl}. Start `edgebase dev --port 8688` or set BASE_URL. Set {RequiredEnvName}=1 to fail instead of skip.";

        internal static void RequireServer(string baseUrl)
        {
            if (IsServerAvailable(baseUrl))
            {
                return;
            }

            if (Environment.GetEnvironmentVariable(RequiredEnvName) == "1")
            {
                throw new InvalidOperationException(GetUnavailableMessage(baseUrl));
            }
        }

        internal static bool IsServerAvailable(string baseUrl)
        {
            try
            {
                using var client = new System.Net.Http.HttpClient { Timeout = TimeSpan.FromSeconds(2) };
                using var response = client.GetAsync($"{baseUrl.TrimEnd('/')}/api/health").GetAwaiter().GetResult();
                var statusCode = (int)response.StatusCode;
                return statusCode >= 200 && statusCode < 500;
            }
            catch
            {
                return false;
            }
        }
    }

    public class AdminE2ETests : IDisposable
    {
        private readonly string _baseUrl = Environment.GetEnvironmentVariable("BASE_URL") ?? "http://localhost:8688";
        private readonly string _sk = Environment.GetEnvironmentVariable("SERVICE_KEY") ?? "test-service-key-for-admin";
        private readonly string _prefix = $"cs-admin-e2e-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
        private readonly List<string> _createdIds = new();
        private readonly AdminClient _admin;

        public AdminE2ETests()
        {
            E2ETestSupport.RequireServer(_baseUrl);
            _admin = new AdminClient(_baseUrl, _sk);
        }

        public void Dispose()
        {
            foreach (var id in _createdIds)
            {
                try { _admin.Table("posts").DeleteAsync(id).Wait(); } catch { }
            }
            _admin.Dispose();
        }

        // ─── Helper ──────────────────────────────────────────────────────────

        /// <summary>Extracts a string "id" from a dict where values may be JsonElement.</summary>
        private static string? GetId(Dictionary<string, object?> dict)
        {
            if (!dict.TryGetValue("id", out var raw)) return null;
            if (raw is JsonElement el && el.ValueKind == JsonValueKind.String)
                return el.GetString();
            return raw as string;
        }

        /// <summary>Extracts a string value by key from a dict where values may be JsonElement.</summary>
        private static string? GetString(Dictionary<string, object?> dict, string key)
        {
            if (!dict.TryGetValue(key, out var raw)) return null;
            if (raw is JsonElement el && el.ValueKind == JsonValueKind.String)
                return el.GetString();
            return raw?.ToString();
        }

        // ═══════════════════════════════════════════════════════════════════════
        // 1. AdminAuth (~8)
        // ═══════════════════════════════════════════════════════════════════════

        [Fact]
        public async Task ListUsers_returns_users()
        {
            var result = await _admin.AdminAuth.ListUsersAsync(5);
            Assert.NotNull(result);
            Assert.NotNull(result.Users);
        }

        [Fact]
        public async Task CreateUser_returns_id()
        {
            var email = $"{_prefix}-create@test.com";
            var user = await _admin.AdminAuth.CreateUserAsync(email, "CsAdmin123!");
            Assert.NotNull(user);
            var userId = GetId(user);
            Assert.NotNull(userId);
        }

        [Fact]
        public async Task CreateUser_with_displayName_and_role()
        {
            var email = $"{_prefix}-create2@test.com";
            var user = await _admin.AdminAuth.CreateUserAsync(email, "CsAdmin123!",
                displayName: "Admin Tester", role: "moderator");
            Assert.NotNull(user);
            var userId = GetId(user);
            Assert.NotNull(userId);
        }

        [Fact]
        public async Task GetUser_returns_user()
        {
            var email = $"{_prefix}-getuser@test.com";
            var created = await _admin.AdminAuth.CreateUserAsync(email, "CsAdmin123!");
            var userId = GetId(created);
            Assert.NotNull(userId);
            var fetched = await _admin.AdminAuth.GetUserAsync(userId!);
            Assert.NotNull(fetched);
            // Verify fetched user has an id
            var fetchedId = GetId(fetched);
            Assert.Equal(userId, fetchedId);
        }

        [Fact]
        public async Task ListUsers_cursor_pagination()
        {
            // Create a few users first
            for (var i = 0; i < 3; i++)
            {
                await _admin.AdminAuth.CreateUserAsync(
                    $"{_prefix}-cursor-{i}@test.com", "CsAdmin123!");
            }
            var page1 = await _admin.AdminAuth.ListUsersAsync(2);
            Assert.NotNull(page1.Users);
            Assert.True(page1.Users.Count <= 2);
            // If cursor present, fetch next page
            if (page1.Cursor != null)
            {
                var page2 = await _admin.AdminAuth.ListUsersAsync(2, page1.Cursor);
                Assert.NotNull(page2.Users);
            }
        }

        [Fact]
        public async Task UpdateUser_changes_displayName()
        {
            var email = $"{_prefix}-upd@test.com";
            var created = await _admin.AdminAuth.CreateUserAsync(email, "CsAdmin123!");
            var userId = GetId(created);
            Assert.NotNull(userId);
            var updated = await _admin.AdminAuth.UpdateUserAsync(userId!,
                new Dictionary<string, object?> { ["displayName"] = "Updated Admin" });
            Assert.NotNull(updated);
        }

        [Fact]
        public async Task DeleteUser_succeeds()
        {
            var email = $"{_prefix}-delusr@test.com";
            var created = await _admin.AdminAuth.CreateUserAsync(email, "CsAdmin123!");
            var userId = GetId(created);
            Assert.NotNull(userId);
            var result = await _admin.AdminAuth.DeleteUserAsync(userId!);
            Assert.NotNull(result);
        }

        [Fact]
        public async Task SetCustomClaims_succeeds()
        {
            var email = $"{_prefix}-claims@test.com";
            var created = await _admin.AdminAuth.CreateUserAsync(email, "CsAdmin123!");
            var userId = GetId(created);
            Assert.NotNull(userId);
            await _admin.AdminAuth.SetCustomClaimsAsync(userId!,
                new Dictionary<string, object?> { ["role"] = "premium", ["tier"] = "gold" });
        }

        [Fact]
        public async Task RevokeAllSessions_succeeds()
        {
            var email = $"{_prefix}-revokeall@test.com";
            var created = await _admin.AdminAuth.CreateUserAsync(email, "CsAdmin123!");
            var userId = GetId(created);
            Assert.NotNull(userId);
            var result = await _admin.AdminAuth.RevokeAllSessionsAsync(userId!);
            Assert.NotNull(result);
        }

        [Fact]
        public async Task DuplicateEmail_createUser_throws()
        {
            var email = $"{_prefix}-dupuser@test.com";
            await _admin.AdminAuth.CreateUserAsync(email, "CsAdmin123!");
            await Assert.ThrowsAsync<EdgeBase.EdgeBaseException>(() =>
                _admin.AdminAuth.CreateUserAsync(email, "CsAdmin456!"));
        }

        // ═══════════════════════════════════════════════════════════════════════
        // 2. DB Admin (~5)
        // ═══════════════════════════════════════════════════════════════════════

        [Fact]
        public async Task Insert_returns_id()
        {
            var record = await _admin.Table("posts").InsertAsync(
                new Dictionary<string, object?> { ["title"] = $"{_prefix}-create" });
            var id = GetId(record);
            Assert.NotNull(id);
            _createdIds.Add(id!);
        }

        [Fact]
        public async Task List_returns_items()
        {
            var result = await _admin.Table("posts").Limit(3).GetListAsync();
            Assert.NotNull(result.Items);
            Assert.True(result.Items.Count <= 3);
        }

        [Fact]
        public async Task Count_returns_non_negative()
        {
            var count = await _admin.Table("posts").CountAsync();
            Assert.True(count >= 0);
        }

        [Fact]
        public async Task Update_modifies_record()
        {
            var record = await _admin.Table("posts").InsertAsync(
                new Dictionary<string, object?> { ["title"] = $"{_prefix}-before-upd" });
            var id = GetId(record);
            Assert.NotNull(id);
            _createdIds.Add(id!);

            var updated = await _admin.Table("posts").UpdateAsync(id!,
                new Dictionary<string, object?> { ["title"] = $"{_prefix}-after-upd" });
            Assert.NotNull(updated);

            var fetched = await _admin.Table("posts").GetOneAsync(id!);
            var fetchedTitle = GetString(fetched, "title");
            Assert.Equal($"{_prefix}-after-upd", fetchedTitle);
        }

        [Fact]
        public async Task Delete_lifecycle()
        {
            var record = await _admin.Table("posts").InsertAsync(
                new Dictionary<string, object?> { ["title"] = $"{_prefix}-to-del" });
            var id = GetId(record);
            Assert.NotNull(id);

            var deleted = await _admin.Table("posts").DeleteAsync(id!);
            Assert.NotNull(deleted);

            await Assert.ThrowsAsync<EdgeBase.EdgeBaseException>(() =>
                _admin.Table("posts").GetOneAsync(id!));
        }

        [Fact]
        public async Task Upsert_creates_when_new()
        {
            var result = await _admin.Table("posts").UpsertAsync(
                new Dictionary<string, object?> { ["title"] = $"{_prefix}-upsert-new" });
            var id = GetId(result);
            Assert.NotNull(id);
            _createdIds.Add(id!);
        }

        [Fact]
        public async Task Batch_insertMany_returns_all()
        {
            var records = new List<Dictionary<string, object?>>
            {
                new() { ["title"] = $"{_prefix}-batch-1" },
                new() { ["title"] = $"{_prefix}-batch-2" },
                new() { ["title"] = $"{_prefix}-batch-3" }
            };
            var created = await _admin.Table("posts").InsertManyAsync(records);
            Assert.Equal(3, created.Count);
            foreach (var r in created)
            {
                var id = GetId(r);
                if (id != null) _createdIds.Add(id);
            }
        }

        [Fact]
        public async Task GetOne_returns_record()
        {
            var record = await _admin.Table("posts").InsertAsync(
                new Dictionary<string, object?> { ["title"] = $"{_prefix}-getone" });
            var id = GetId(record);
            Assert.NotNull(id);
            _createdIds.Add(id!);

            var fetched = await _admin.Table("posts").GetOneAsync(id!);
            var fetchedTitle = GetString(fetched, "title");
            Assert.Equal($"{_prefix}-getone", fetchedTitle);
        }

        [Fact]
        public async Task Where_filter_finds_record()
        {
            var unique = $"{_prefix}-admfilter-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            var record = await _admin.Table("posts").InsertAsync(
                new Dictionary<string, object?> { ["title"] = unique });
            var id = GetId(record);
            if (id != null) _createdIds.Add(id);

            var list = await _admin.Table("posts")
                .Where("title", "==", unique).GetListAsync();
            Assert.NotEmpty(list.Items);
        }

        [Fact]
        public async Task OrderBy_and_limit()
        {
            var result = await _admin.Table("posts")
                .OrderBy("createdAt", "desc").Limit(2).GetListAsync();
            Assert.NotNull(result.Items);
            Assert.True(result.Items.Count <= 2);
        }

        [Fact]
        public async Task Golden_filter_sort_limit()
        {
            var gqPrefix = $"{_prefix}-gq";
            var viewValues = new[] { 10, 30, 20, 40, 5 };
            var labels = new[] { "A", "B", "C", "D", "E" };
            for (int i = 0; i < 5; i++)
            {
                var record = await _admin.Table("posts").InsertAsync(
                    new Dictionary<string, object?> { ["title"] = $"{gqPrefix}-{labels[i]}", ["views"] = viewValues[i] });
                var id = GetId(record);
                if (id != null) _createdIds.Add(id);
            }

            var list = await _admin.Table("posts")
                .Where("title", "contains", gqPrefix)
                .Where("views", ">=", 10)
                .OrderBy("views", "desc")
                .Limit(3)
                .GetListAsync();
            var views = list.Items.Select(item =>
            {
                if (!item.TryGetValue("views", out var v) || v == null) return 0;
                return v is JsonElement je ? je.GetInt32() : Convert.ToInt32(v);
            }).ToList();
            Assert.Equal(new List<int> { 40, 30, 20 }, views);
        }

        [Fact]
        public async Task Golden_cursor_no_overlap()
        {
            var gqPrefix = $"{_prefix}-gqc";
            for (int i = 0; i < 5; i++)
            {
                var record = await _admin.Table("posts").InsertAsync(
                    new Dictionary<string, object?> { ["title"] = $"{gqPrefix}-{i}" });
                var id = GetId(record);
                if (id != null) _createdIds.Add(id);
            }

            var p1 = await _admin.Table("posts")
                .Where("title", "contains", gqPrefix)
                .Limit(2)
                .GetListAsync();
            Assert.NotNull(p1.Cursor);

            var p2 = await _admin.Table("posts")
                .Where("title", "contains", gqPrefix)
                .Limit(2)
                .After(p1.Cursor!)
                .GetListAsync();

            var ids1 = p1.Items.Select(item => GetId(item)).ToHashSet();
            var ids2 = p2.Items.Select(item => GetId(item)).ToHashSet();
            ids1.IntersectWith(ids2);
            Assert.Empty(ids1);
        }

        [Fact]
        public async Task FieldOps_increment()
        {
            var record = await _admin.Table("posts").InsertAsync(
                new Dictionary<string, object?> { ["title"] = $"{_prefix}-inc", ["views"] = 0 });
            var id = GetId(record);
            Assert.NotNull(id);
            _createdIds.Add(id!);

            var updated = await _admin.Table("posts").UpdateAsync(id!,
                new Dictionary<string, object?> { ["views"] = FieldOps.Increment(10) });
            Assert.NotNull(updated);
        }

        [Fact]
        public async Task FieldOps_deleteField()
        {
            var record = await _admin.Table("posts").InsertAsync(
                new Dictionary<string, object?> { ["title"] = $"{_prefix}-delf", ["temp"] = "rm" });
            var id = GetId(record);
            Assert.NotNull(id);
            _createdIds.Add(id!);

            var updated = await _admin.Table("posts").UpdateAsync(id!,
                new Dictionary<string, object?> { ["temp"] = FieldOps.DeleteField() });
            Assert.NotNull(updated);
        }

        // ═══════════════════════════════════════════════════════════════════════
        // 3. KV (~8)
        // ═══════════════════════════════════════════════════════════════════════

        [Fact]
        public async Task Kv_set_get_delete()
        {
            var key = $"cs-admin-kv-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            await _admin.Kv("test").SetAsync(key, "hello-cs-admin");
            var val = await _admin.Kv("test").GetAsync(key);
            Assert.Equal("hello-cs-admin", val);
            await _admin.Kv("test").DeleteAsync(key);
            var afterDel = await _admin.Kv("test").GetAsync(key);
            Assert.Null(afterDel);
        }

        [Fact]
        public async Task Kv_list_keys()
        {
            var keyPrefix = $"cs-kv-list-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            await _admin.Kv("test").SetAsync($"{keyPrefix}-a", "val-a");
            await _admin.Kv("test").SetAsync($"{keyPrefix}-b", "val-b");

            var result = await _admin.Kv("test").ListAsync(prefix: keyPrefix);
            Assert.NotNull(result.Keys);
            Assert.True(result.Keys.Count >= 2);

            // Cleanup
            await _admin.Kv("test").DeleteAsync($"{keyPrefix}-a");
            await _admin.Kv("test").DeleteAsync($"{keyPrefix}-b");
        }

        [Fact]
        public async Task Kv_ttl_set()
        {
            var key = $"cs-kv-ttl-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            await _admin.Kv("test").SetAsync(key, "ttl-value", ttl: 60);
            var val = await _admin.Kv("test").GetAsync(key);
            Assert.Equal("ttl-value", val);
            // Cleanup
            await _admin.Kv("test").DeleteAsync(key);
        }

        [Fact]
        public async Task Kv_overwrite_value()
        {
            var key = $"cs-kv-overwrite-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            await _admin.Kv("test").SetAsync(key, "original");
            await _admin.Kv("test").SetAsync(key, "overwritten");
            var val = await _admin.Kv("test").GetAsync(key);
            Assert.Equal("overwritten", val);
            // Cleanup
            await _admin.Kv("test").DeleteAsync(key);
        }

        [Fact]
        public async Task Kv_long_key()
        {
            var longKey = $"cs-kv-longkey-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}-{new string('x', 100)}";
            await _admin.Kv("test").SetAsync(longKey, "long-key-value");
            var val = await _admin.Kv("test").GetAsync(longKey);
            Assert.Equal("long-key-value", val);
            // Cleanup
            await _admin.Kv("test").DeleteAsync(longKey);
        }

        [Fact]
        public async Task Kv_prefix_filter()
        {
            var prefix = $"cs-kv-pfx-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            await _admin.Kv("test").SetAsync($"{prefix}-one", "1");
            await _admin.Kv("test").SetAsync($"{prefix}-two", "2");
            await _admin.Kv("test").SetAsync("other-key-not-matching", "3");

            var result = await _admin.Kv("test").ListAsync(prefix: prefix);
            Assert.True(result.Keys.Count >= 2);
            Assert.All(result.Keys, k => Assert.StartsWith(prefix, k));

            // Cleanup
            await _admin.Kv("test").DeleteAsync($"{prefix}-one");
            await _admin.Kv("test").DeleteAsync($"{prefix}-two");
            try { await _admin.Kv("test").DeleteAsync("other-key-not-matching"); } catch { }
        }

        [Fact]
        public async Task Kv_parallel_writes()
        {
            var prefix = $"cs-kv-par-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            var tasks = Enumerable.Range(0, 5).Select(i =>
                _admin.Kv("test").SetAsync($"{prefix}-{i}", $"val-{i}")).ToArray();
            await Task.WhenAll(tasks);

            // Verify all written
            for (var i = 0; i < 5; i++)
            {
                var val = await _admin.Kv("test").GetAsync($"{prefix}-{i}");
                Assert.Equal($"val-{i}", val);
            }

            // Cleanup
            for (var i = 0; i < 5; i++)
            {
                await _admin.Kv("test").DeleteAsync($"{prefix}-{i}");
            }
        }

        [Fact]
        public async Task Kv_get_nonexistent_returns_null()
        {
            var val = await _admin.Kv("test").GetAsync($"nonexistent-kv-key-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}");
            Assert.Null(val);
        }

        // ═══════════════════════════════════════════════════════════════════════
        // 4. D1 (~4)
        // ═══════════════════════════════════════════════════════════════════════

        [Fact]
        public async Task D1_create_table_insert_select()
        {
            var tableName = $"test_cs_{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            // CREATE TABLE
            await _admin.D1("test").ExecAsync(
                $"CREATE TABLE IF NOT EXISTS {tableName} (id INTEGER PRIMARY KEY, name TEXT)");

            // INSERT
            await _admin.D1("test").ExecAsync(
                $"INSERT INTO {tableName} (id, name) VALUES (?, ?)",
                new object[] { 1, "Alice" });

            // SELECT
            var rows = await _admin.D1("test").ExecAsync($"SELECT * FROM {tableName}");
            Assert.NotEmpty(rows);

            // Cleanup
            await _admin.D1("test").ExecAsync($"DROP TABLE IF EXISTS {tableName}");
        }

        [Fact]
        public async Task D1_batch_inserts()
        {
            var tableName = $"test_batch_{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            await _admin.D1("test").ExecAsync(
                $"CREATE TABLE IF NOT EXISTS {tableName} (id INTEGER PRIMARY KEY, val TEXT)");

            for (var i = 0; i < 3; i++)
            {
                await _admin.D1("test").ExecAsync(
                    $"INSERT INTO {tableName} (id, val) VALUES (?, ?)",
                    new object[] { i + 1, $"item-{i}" });
            }

            var rows = await _admin.D1("test").ExecAsync($"SELECT * FROM {tableName}");
            Assert.True(rows.Count >= 3);

            // Cleanup
            await _admin.D1("test").ExecAsync($"DROP TABLE IF EXISTS {tableName}");
        }

        [Fact]
        public async Task D1_prepare_bind_params()
        {
            var tableName = $"test_bind_{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            await _admin.D1("test").ExecAsync(
                $"CREATE TABLE IF NOT EXISTS {tableName} (id INTEGER PRIMARY KEY, name TEXT, score REAL)");

            await _admin.D1("test").ExecAsync(
                $"INSERT INTO {tableName} (id, name, score) VALUES (?, ?, ?)",
                new object[] { 1, "Bob", 95.5 });

            var rows = await _admin.D1("test").ExecAsync(
                $"SELECT * FROM {tableName} WHERE score > ?",
                new object[] { 90.0 });
            Assert.NotEmpty(rows);

            // Cleanup
            await _admin.D1("test").ExecAsync($"DROP TABLE IF EXISTS {tableName}");
        }

        [Fact]
        public async Task D1_ddl_and_dml()
        {
            var tableName = $"test_ddl_{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            // DDL: create
            await _admin.D1("test").ExecAsync(
                $"CREATE TABLE IF NOT EXISTS {tableName} (id INTEGER PRIMARY KEY, status TEXT)");

            // DML: insert + update
            await _admin.D1("test").ExecAsync(
                $"INSERT INTO {tableName} (id, status) VALUES (?, ?)",
                new object[] { 1, "active" });
            await _admin.D1("test").ExecAsync(
                $"UPDATE {tableName} SET status = ? WHERE id = ?",
                new object[] { "inactive", 1 });

            var rows = await _admin.D1("test").ExecAsync(
                $"SELECT * FROM {tableName} WHERE id = ?",
                new object[] { 1 });
            Assert.NotEmpty(rows);

            // Cleanup
            await _admin.D1("test").ExecAsync($"DROP TABLE IF EXISTS {tableName}");
        }

        // ═══════════════════════════════════════════════════════════════════════
        // 5. SQL (DO SQLite) (~3)
        // ═══════════════════════════════════════════════════════════════════════

        [Fact]
        public async Task Sql_exec_select()
        {
            // First create a record via admin to ensure data exists
            var record = await _admin.Table("posts").InsertAsync(
                new Dictionary<string, object?> { ["title"] = $"{_prefix}-sql-sel" });
            var id = GetId(record);
            if (id != null) _createdIds.Add(id);

            var rows = await _admin.SqlAsync("shared", "SELECT * FROM posts LIMIT 5");
            Assert.NotNull(rows);
            Assert.True(rows.Count <= 5);
        }

        [Fact]
        public async Task Sql_exec_update()
        {
            var record = await _admin.Table("posts").InsertAsync(
                new Dictionary<string, object?> { ["title"] = $"{_prefix}-sql-upd" });
            var id = GetId(record);
            Assert.NotNull(id);
            _createdIds.Add(id!);

            var rows = await _admin.SqlAsync("shared",
                "UPDATE posts SET title = ? WHERE id = ?",
                new object[] { $"{_prefix}-sql-updated", id! });
            Assert.NotNull(rows);
        }

        [Fact]
        public async Task Sql_exec_delete()
        {
            var record = await _admin.Table("posts").InsertAsync(
                new Dictionary<string, object?> { ["title"] = $"{_prefix}-sql-del" });
            var id = GetId(record);
            Assert.NotNull(id);

            var rows = await _admin.SqlAsync("shared",
                "DELETE FROM posts WHERE id = ?",
                new object[] { id! });
            Assert.NotNull(rows);
        }

        // ═══════════════════════════════════════════════════════════════════════
        // 6. Error (~3)
        // ═══════════════════════════════════════════════════════════════════════

        [Fact]
        public async Task GetOne_nonexistent_throws()
        {
            await Assert.ThrowsAsync<EdgeBase.EdgeBaseException>(() =>
                _admin.Table("posts").GetOneAsync("nonexistent-cs-admin-99999"));
        }

        [Fact]
        public async Task Invalid_serviceKey_throws()
        {
            using var badAdmin = new AdminClient(_baseUrl, "invalid-sk");
            await Assert.ThrowsAsync<EdgeBase.EdgeBaseException>(() =>
                badAdmin.Table("posts").InsertAsync(
                    new Dictionary<string, object?> { ["title"] = "X" }));
        }

        [Fact]
        public async Task Invalid_serviceKey_on_kv_throws()
        {
            using var badAdmin = new AdminClient(_baseUrl, "invalid-sk");
            await Assert.ThrowsAsync<EdgeBase.EdgeBaseException>(() =>
                badAdmin.Kv("test").GetAsync("any-key"));
        }

        [Fact]
        public async Task Update_nonexistent_record_throws()
        {
            await Assert.ThrowsAsync<EdgeBase.EdgeBaseException>(() =>
                _admin.Table("posts").UpdateAsync("nonexistent-admin-99999",
                    new Dictionary<string, object?> { ["title"] = "X" }));
        }

        // ═══════════════════════════════════════════════════════════════════════
        // 7. C#-specific (~5)
        // ═══════════════════════════════════════════════════════════════════════

        [Fact]
        public async Task Parallel_create_with_WhenAll()
        {
            var titles = new[] { $"{_prefix}-par-1", $"{_prefix}-par-2", $"{_prefix}-par-3" };
            var tasks = Array.ConvertAll(titles, t =>
                _admin.Table("posts").InsertAsync(
                    new Dictionary<string, object?> { ["title"] = t }));
            var results = await Task.WhenAll(tasks);
            Assert.Equal(3, results.Length);
            foreach (var r in results)
            {
                var id = GetId(r);
                if (id != null) _createdIds.Add(id);
            }
        }

        [Fact]
        public async Task SystemTextJson_deserialization()
        {
            var record = await _admin.Table("posts").InsertAsync(
                new Dictionary<string, object?> { ["title"] = $"{_prefix}-json" });
            var id = GetId(record);
            Assert.NotNull(id);
            _createdIds.Add(id!);

            // Verify JsonElement handling
            var fetched = await _admin.Table("posts").GetOneAsync(id!);
            Assert.True(fetched.ContainsKey("id"));
            // Value should be extractable via our helper (JsonElement → string)
            var fetchedId = GetId(fetched);
            Assert.Equal(id, fetchedId);
        }

        [Fact]
        public async Task List_with_cancellation_token_succeeds()
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            var result = await _admin.Table("posts").Limit(2).GetListAsync(cts.Token);
            Assert.NotNull(result);
        }

        [Fact]
        public async Task Record_type_pattern_matching()
        {
            var record = await _admin.Table("posts").InsertAsync(
                new Dictionary<string, object?> { ["title"] = $"{_prefix}-record" });
            var id = GetId(record);
            Assert.NotNull(id);
            _createdIds.Add(id!);

            // Pattern match against dictionary entries
            var hasTitle = record.Any(kvp => kvp.Key == "title");
            Assert.True(hasTitle);
        }

        [Fact]
        public async Task EdgeBaseException_wrapping()
        {
            var ex = await Assert.ThrowsAsync<EdgeBase.EdgeBaseException>(() =>
                _admin.Table("posts").GetOneAsync("nonexistent-wrap-99999"));
            Assert.True(ex.StatusCode > 0);
            Assert.NotNull(ex.Message);
            Assert.NotEmpty(ex.Message);
        }

        // ═══════════════════════════════════════════════════════════════════════
        // 8. Additional operations
        // ═══════════════════════════════════════════════════════════════════════

        [Fact]
        public async Task Sequential_CRUD_lifecycle()
        {
            // Create
            var created = await _admin.Table("posts").InsertAsync(
                new Dictionary<string, object?> { ["title"] = $"{_prefix}-lifecycle" });
            var id = GetId(created);
            Assert.NotNull(id);

            // Read
            var fetched = await _admin.Table("posts").GetOneAsync(id!);
            Assert.NotNull(fetched);

            // Update
            var updated = await _admin.Table("posts").UpdateAsync(id!,
                new Dictionary<string, object?> { ["title"] = $"{_prefix}-lifecycle-updated" });
            Assert.NotNull(updated);

            // Verify update
            var verified = await _admin.Table("posts").GetOneAsync(id!);
            var verifiedTitle = GetString(verified, "title");
            Assert.Equal($"{_prefix}-lifecycle-updated", verifiedTitle);

            // Delete
            await _admin.Table("posts").DeleteAsync(id!);

            // Verify delete
            await Assert.ThrowsAsync<EdgeBase.EdgeBaseException>(() =>
                _admin.Table("posts").GetOneAsync(id!));
        }

        [Fact]
        public async Task Parallel_reads_with_WhenAll()
        {
            var tasks = new[]
            {
                _admin.Table("posts").Limit(1).GetListAsync(),
                _admin.Table("posts").Limit(2).GetListAsync(),
                _admin.Table("posts").Limit(3).GetListAsync()
            };
            var results = await Task.WhenAll(tasks);
            Assert.Equal(3, results.Length);
            foreach (var r in results)
            {
                Assert.NotNull(r.Items);
            }
        }

        [Fact]
        public async Task Special_characters_in_title()
        {
            var specialTitle = $"{_prefix}-special-!@#$%&*()";
            var record = await _admin.Table("posts").InsertAsync(
                new Dictionary<string, object?> { ["title"] = specialTitle });
            var id = GetId(record);
            Assert.NotNull(id);
            _createdIds.Add(id!);

            var fetched = await _admin.Table("posts").GetOneAsync(id!);
            var fetchedTitle = GetString(fetched, "title");
            Assert.Equal(specialTitle, fetchedTitle);
        }

        [Fact]
        public async Task Kv_delete_nonexistent_no_error()
        {
            // Deleting a key that doesn't exist should not throw
            var key = $"cs-kv-del-ne-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            var result = await _admin.Kv("test").DeleteAsync(key);
            Assert.NotNull(result);
        }

        [Fact]
        public Task AdminClient_constructor_rejects_empty_url()
        {
            Assert.Throws<ArgumentException>(() => new AdminClient("", _sk));
            return Task.CompletedTask;
        }

        [Fact]
        public Task AdminClient_constructor_rejects_empty_serviceKey()
        {
            Assert.Throws<ArgumentException>(() => new AdminClient(_baseUrl, ""));
            return Task.CompletedTask;
        }

        [Fact]
        public async Task Storage_upload_download_delete()
        {
            var key = $"admin-stor-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}.txt";
            var content = System.Text.Encoding.UTF8.GetBytes("Admin storage test");

            var uploadResult = await _admin.Storage.Bucket("test-bucket").UploadAsync(
                key, content, "text/plain");
            Assert.NotNull(uploadResult);

            var downloaded = await _admin.Storage.Bucket("test-bucket").DownloadAsync(key);
            Assert.Equal("Admin storage test", System.Text.Encoding.UTF8.GetString(downloaded));

            var deleteResult = await _admin.Storage.Bucket("test-bucket").DeleteAsync(key);
            Assert.NotNull(deleteResult);
        }

        [Fact]
        public async Task Storage_list_files()
        {
            var key = $"admin-list-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}.txt";
            await _admin.Storage.Bucket("test-bucket").UploadAsync(
                key, System.Text.Encoding.UTF8.GetBytes("list test"), "text/plain");

            var result = await _admin.Storage.Bucket("test-bucket").ListAsync(limit: 50);
            Assert.NotNull(result.Files);

            // Cleanup
            try { await _admin.Storage.Bucket("test-bucket").DeleteAsync(key); } catch { }
        }

        [Fact]
        public async Task Offset_pagination()
        {
            var result = await _admin.Table("posts")
                .Limit(2).Offset(0).GetListAsync();
            Assert.NotNull(result.Items);
            Assert.True(result.Items.Count <= 2);
        }

        [Fact]
        public async Task DeleteMany_by_filter()
        {
            var unique = $"{_prefix}-admdel-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            await _admin.Table("posts").InsertAsync(
                new Dictionary<string, object?> { ["title"] = $"{unique}-a" });
            await _admin.Table("posts").InsertAsync(
                new Dictionary<string, object?> { ["title"] = $"{unique}-b" });

            var result = await _admin.Table("posts")
                .Where("title", "contains", unique)
                .DeleteManyAsync();
            Assert.NotNull(result);
        }

        [Fact]
        public async Task UpdateMany_by_filter()
        {
            var unique = $"{_prefix}-admupd-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            var r = await _admin.Table("posts").InsertAsync(
                new Dictionary<string, object?> { ["title"] = $"{unique}-1" });
            var id = GetId(r);
            if (id != null) _createdIds.Add(id);

            var result = await _admin.Table("posts")
                .Where("title", "contains", unique)
                .UpdateManyAsync(new Dictionary<string, object?> { ["views"] = 100 });
            Assert.NotNull(result);
        }

        // ═══════════════════════════════════════════════════════════════════════
        // 9. Push Notifications (~7)
        // ═══════════════════════════════════════════════════════════════════════

        [Fact]
        public async Task PushSend_nonexistent_user_returns_zero_sent()
        {
            var payload = new Dictionary<string, object?> { ["title"] = "test", ["body"] = "hello" };
            try
            {
                var result = await _admin.Push.SendAsync("nonexistent-user-push-99999", payload);
                Assert.Equal(0, result.Sent);
            }
            catch (EdgeBase.EdgeBaseException ex) when (ex.StatusCode == 503)
            {
                // Push not configured on this server — acceptable
            }
        }

        [Fact]
        public async Task PushSendToToken_returns_result()
        {
            var payload = new Dictionary<string, object?> { ["title"] = "Token Push", ["body"] = "direct" };
            try
            {
                var result = await _admin.Push.SendToTokenAsync("fake-fcm-token-for-e2e", payload);
                // Mock FCM → sent: 1 or failed: 1
                Assert.True(result.Sent == 1 || result.Failed == 1);
            }
            catch (EdgeBase.EdgeBaseException ex) when (ex.StatusCode == 503)
            {
                // Push not configured — acceptable
            }
        }

        [Fact]
        public async Task PushSendMany_returns_ok()
        {
            var payload = new Dictionary<string, object?> { ["title"] = "Batch Push", ["body"] = "multi" };
            try
            {
                var result = await _admin.Push.SendManyAsync(
                    new[] { "user-a", "user-b" }, payload);
                Assert.Equal(0, result.Sent); // No registered devices
            }
            catch (EdgeBase.EdgeBaseException ex) when (ex.StatusCode == 503)
            {
                // Push not configured — acceptable
            }
        }

        [Fact]
        public async Task PushGetTokens_returns_empty_array()
        {
            var tokens = await _admin.Push.GetTokensAsync("nonexistent-user-tokens-99999");
            Assert.NotNull(tokens);
            Assert.Empty(tokens);
        }

        [Fact]
        public async Task PushGetLogs_returns_array()
        {
            var logs = await _admin.Push.GetLogsAsync("nonexistent-user-logs-99999", limit: 10);
            Assert.NotNull(logs);
            // May be empty, but should be a valid list
        }

        [Fact]
        public async Task PushSendToTopic_returns_result()
        {
            var payload = new Dictionary<string, object?> { ["title"] = "Topic Push", ["body"] = "news" };
            try
            {
                var result = await _admin.Push.SendToTopicAsync("test-topic", payload);
                Assert.NotNull(result);
            }
            catch (EdgeBase.EdgeBaseException ex) when (ex.StatusCode == 503)
            {
                // Push not configured — acceptable
            }
        }

        [Fact]
        public async Task PushBroadcast_returns_result()
        {
            var payload = new Dictionary<string, object?> { ["title"] = "Broadcast", ["body"] = "everyone" };
            try
            {
                var result = await _admin.Push.BroadcastAsync(payload);
                Assert.NotNull(result);
            }
            catch (EdgeBase.EdgeBaseException ex) when (ex.StatusCode == 503)
            {
                // Push not configured — acceptable
            }
        }

        // ═══════════════════════════════════════════════════════════════════════
        // Vectorize (stub)
        // ═══════════════════════════════════════════════════════════════════════

        [Fact]
        public async Task Vectorize_Upsert_stub()
        {
            var vec = _admin.Vector("embeddings");
            var vectors = new[] { new VectorInput { Id = "doc-1", Values = Enumerable.Repeat(0.1, 1536).ToArray() } };
            var result = await vec.UpsertAsync(vectors);
            Assert.NotNull(result);
            Assert.True(result.ContainsKey("ok"));
        }

        [Fact]
        public async Task Vectorize_Insert_stub()
        {
            var vec = _admin.Vector("embeddings");
            var vectors = new[] { new VectorInput { Id = "doc-ins-1", Values = Enumerable.Repeat(0.2, 1536).ToArray() } };
            var result = await vec.InsertAsync(vectors);
            Assert.NotNull(result);
            Assert.True(result.ContainsKey("ok"));
        }

        [Fact]
        public async Task Vectorize_Search_stub()
        {
            var vec = _admin.Vector("embeddings");
            var matches = await vec.SearchAsync(Enumerable.Repeat(0.1, 1536).ToArray(), topK: 5);
            Assert.NotNull(matches);
        }

        [Fact]
        public async Task Vectorize_Search_with_namespace()
        {
            var vec = _admin.Vector("embeddings");
            var matches = await vec.SearchAsync(Enumerable.Repeat(0.1, 1536).ToArray(), topK: 5, ns: "test-ns");
            Assert.NotNull(matches);
        }

        [Fact]
        public async Task Vectorize_Search_with_returnValues()
        {
            var vec = _admin.Vector("embeddings");
            var matches = await vec.SearchAsync(Enumerable.Repeat(0.1, 1536).ToArray(), topK: 5, returnValues: true);
            Assert.NotNull(matches);
        }

        [Fact]
        public async Task Vectorize_QueryById_stub()
        {
            var vec = _admin.Vector("embeddings");
            var matches = await vec.QueryByIdAsync("doc-1", topK: 5);
            Assert.NotNull(matches);
        }

        [Fact]
        public async Task Vectorize_GetByIds_stub()
        {
            var vec = _admin.Vector("embeddings");
            var vectors = await vec.GetByIdsAsync(new[] { "doc-1", "doc-2" });
            Assert.NotNull(vectors);
        }

        [Fact]
        public async Task Vectorize_Delete_stub()
        {
            var vec = _admin.Vector("embeddings");
            var result = await vec.DeleteAsync(new[] { "doc-1", "doc-2" });
            Assert.NotNull(result);
            Assert.True(result.ContainsKey("ok"));
        }

        [Fact]
        public async Task Vectorize_Describe_stub()
        {
            var vec = _admin.Vector("embeddings");
            var info = await vec.DescribeAsync();
            Assert.True(info.Dimensions > 0);
            Assert.NotNull(info.Metric);
        }

        [Fact]
        public async Task Vectorize_nonexistent_index_throws()
        {
            var vec = _admin.Vector("nonexistent-index-99");
            await Assert.ThrowsAnyAsync<Exception>(async () => await vec.DescribeAsync());
        }

        // ═══════════════════════════════════════════════════════════════════════
        // Golden Query — orFilter + CRUD round-trip
        // ═══════════════════════════════════════════════════════════════════════

        [Fact]
        public async Task Golden_orfilter()
        {
            var gqPrefix = $"{_prefix}-gor";
            var viewValues = new[] { 10, 30, 20, 40, 5 };
            var labels = new[] { "A", "B", "C", "D", "E" };
            for (int i = 0; i < 5; i++)
            {
                var record = await _admin.Table("posts").InsertAsync(
                    new Dictionary<string, object?> { ["title"] = $"{gqPrefix}-{labels[i]}", ["views"] = viewValues[i] });
                var id = GetId(record);
                if (id != null) _createdIds.Add(id);
            }

            // Or(q => q.Where("views","==",10).Where("views","==",40)) + OrderBy("views","asc") → [10, 40]
            var list = await _admin.Table("posts")
                .Where("title", "contains", gqPrefix)
                .Or(q => q.Where("views", "==", 10).Where("views", "==", 40))
                .OrderBy("views", "asc")
                .GetListAsync();
            var views = list.Items.Select(item =>
            {
                if (!item.TryGetValue("views", out var v) || v == null) return 0;
                return v is JsonElement je ? je.GetInt32() : Convert.ToInt32(v);
            }).ToList();
            Assert.Equal(new List<int> { 10, 40 }, views);
        }

        [Fact]
        public async Task Golden_crud_roundtrip()
        {
            // 1. Insert
            var record = await _admin.Table("posts").InsertAsync(
                new Dictionary<string, object?> { ["title"] = $"{_prefix}-crud-rt", ["body"] = "initial body", ["views"] = 0 });
            var id = GetId(record);
            Assert.NotNull(id);

            // 2. Get by ID — verify inserted data
            var got = await _admin.Table("posts").GetOneAsync(id!);
            Assert.Equal($"{_prefix}-crud-rt", GetString(got, "title"));
            Assert.Equal("initial body", GetString(got, "body"));

            // 3. Update
            var updated = await _admin.Table("posts").UpdateAsync(id!,
                new Dictionary<string, object?> { ["title"] = $"{_prefix}-crud-updated", ["views"] = 42 });
            Assert.Equal($"{_prefix}-crud-updated", GetString(updated, "title"));
            if (updated.TryGetValue("views", out var vRaw) && vRaw != null)
            {
                var views = vRaw is JsonElement je ? je.GetInt32() : Convert.ToInt32(vRaw);
                Assert.Equal(42, views);
            }

            // 4. Delete
            await _admin.Table("posts").DeleteAsync(id!);

            // 5. Verify exception on get after delete
            await Assert.ThrowsAnyAsync<Exception>(async () =>
                await _admin.Table("posts").GetOneAsync(id!));
        }
    }
}
