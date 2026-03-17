using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Assert = Xunit.Assert;
using Fact = EdgeBase.Tests.E2EFactAttribute;
// EdgeBase C# Unity SDK — E2E 테스트
//
// 전제: wrangler dev --port 8688 서버 실행 중
//
// 실행:
//   BASE_URL=http://localhost:8688 \
//     cd packages/sdk/csharp/packages/unity/tests && dotnet test
//
// 원칙: mock 금지, EdgeBase(Unity) 실서버 기반

namespace EdgeBase.Tests
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
                using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
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

    public class UnityE2ETests : IDisposable
    {
        private readonly string _baseUrl = Environment.GetEnvironmentVariable("BASE_URL") ?? "http://localhost:8688";
        private readonly string _prefix = $"cs-unity-e2e-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
        private readonly List<string> _createdIds = new();
        private readonly EdgeBase _client;

        public UnityE2ETests()
        {
            E2ETestSupport.RequireServer(_baseUrl);
            _client = new EdgeBase(_baseUrl);
        }

        public void Dispose()
        {
            foreach (var id in _createdIds)
            {
                try { _client.Db("shared").Table("posts").DeleteAsync(id).Wait(); } catch { }
            }
            _client.Dispose();
        }

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
        // 1. Auth (~10)
        // ═══════════════════════════════════════════════════════════════════════

        [Fact]
        public async Task SignUp_returns_accessToken()
        {
            var email = $"{_prefix}-signup@test.com";
            var result = await _client.Auth.SignUpAsync(email, "CsUnity123!");
            Assert.NotNull(result.GetValueOrDefault("accessToken"));
        }

        [Fact]
        public async Task SignIn_returns_accessToken()
        {
            var email = $"{_prefix}-signin@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var result = await _client.Auth.SignInAsync(email, "CsUnity123!");
            Assert.NotNull(result.GetValueOrDefault("accessToken"));
        }

        [Fact]
        public async Task SignOut_succeeds()
        {
            var email = $"{_prefix}-signout@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            await _client.Auth.SignOutAsync(); // Should not throw
        }

        [Fact]
        public async Task SignInAnonymously_returns_token()
        {
            var result = await _client.Auth.SignInAnonymouslyAsync();
            Assert.NotNull(result.GetValueOrDefault("accessToken"));
        }

        [Fact]
        public async Task WrongPassword_throws()
        {
            var email = $"{_prefix}-wrongpw@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            await Assert.ThrowsAsync<EdgeBaseException>(() =>
                _client.Auth.SignInAsync(email, "WrongPass!"));
        }

        [Fact]
        public async Task UpdateProfile_changes_displayName()
        {
            var email = $"{_prefix}-profile@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var result = await _client.Auth.UpdateProfileAsync(
                new Dictionary<string, object?> { ["displayName"] = "Unity Tester" });
            Assert.NotNull(result);
        }

        [Fact]
        public async Task ChangePassword_then_signIn_with_new()
        {
            var email = $"{_prefix}-chgpw@test.com";
            await _client.Auth.SignUpAsync(email, "OldPass123!");
            await _client.Auth.ChangePasswordAsync("OldPass123!", "NewPass456!");
            var result = await _client.Auth.SignInAsync(email, "NewPass456!");
            Assert.NotNull(result.GetValueOrDefault("accessToken"));
        }

        [Fact]
        public async Task ListSessions_returns_sessions()
        {
            var email = $"{_prefix}-sess@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var result = await _client.Auth.ListSessionsAsync();
            Assert.NotNull(result);
            // sessions should be present as an array in the result
            Assert.True(result.ContainsKey("sessions"));
        }

        [Fact]
        public async Task RevokeSession_succeeds()
        {
            var email = $"{_prefix}-revoke@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var sessResult = await _client.Auth.ListSessionsAsync();
            if (sessResult.TryGetValue("sessions", out var sessRaw) &&
                sessRaw is JsonElement sessArr &&
                sessArr.ValueKind == JsonValueKind.Array &&
                sessArr.GetArrayLength() > 0)
            {
                var firstSess = sessArr[0];
                var sessId = firstSess.GetProperty("id").GetString()!;
                var revokeResult = await _client.Auth.RevokeSessionAsync(sessId);
                Assert.NotNull(revokeResult);
            }
        }

        [Fact]
        public async Task CurrentUser_has_token_after_signIn()
        {
            var email = $"{_prefix}-current@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var token = _client.Auth.GetAccessToken();
            Assert.NotNull(token);
            Assert.NotEmpty(token!);
        }

        [Fact]
        public async Task DuplicateEmail_signup_throws()
        {
            var email = $"{_prefix}-dup@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            // Create a fresh client to avoid token state interference
            using var client2 = new EdgeBase(_baseUrl);
            await Assert.ThrowsAsync<EdgeBaseException>(() =>
                client2.Auth.SignUpAsync(email, "CsUnity456!"));
        }

        [Fact]
        public Task SignInWithOAuth_returns_url()
        {
            var url = _client.Auth.SignInWithOAuth("google", "https://example.com/callback");
            Assert.Contains("/api/auth/oauth/google", url);
            Assert.Contains("redirectUrl=", url);
            return Task.CompletedTask;
        }

        [Fact]
        public async Task SignUp_with_displayName_data()
        {
            var email = $"{_prefix}-data@test.com";
            var result = await _client.Auth.SignUpAsync(email, "CsUnity123!",
                new Dictionary<string, object?> { ["displayName"] = "Unity User" });
            Assert.NotNull(result.GetValueOrDefault("accessToken"));
        }

        // ═══════════════════════════════════════════════════════════════════════
        // 2. DB CRUD (~10)
        // ═══════════════════════════════════════════════════════════════════════

        [Fact]
        public async Task Insert_returns_id()
        {
            var email = $"{_prefix}-db@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var record = await _client.Db("shared").Table("posts").InsertAsync(
                new Dictionary<string, object?> { ["title"] = $"{_prefix}-insert" });
            var id = GetId(record);
            Assert.NotNull(id);
            _createdIds.Add(id!);
        }

        [Fact]
        public async Task List_returns_items()
        {
            var email = $"{_prefix}-list@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var result = await _client.Db("shared").Table("posts").Limit(3).GetListAsync();
            Assert.NotNull(result.Items);
            Assert.True(result.Items.Count <= 3);
        }

        [Fact]
        public async Task Where_filter_finds_record()
        {
            var email = $"{_prefix}-filter@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var unique = $"{_prefix}-filter-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            var r = await _client.Db("shared").Table("posts").InsertAsync(
                new Dictionary<string, object?> { ["title"] = unique });
            var id = GetId(r);
            if (id != null) _createdIds.Add(id);
            var list = await _client.Db("shared").Table("posts").Where("title", "==", unique).GetListAsync();
            Assert.NotEmpty(list.Items);
        }

        [Fact]
        public async Task Update_modifies_record()
        {
            var email = $"{_prefix}-update@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var record = await _client.Db("shared").Table("posts").InsertAsync(
                new Dictionary<string, object?> { ["title"] = $"{_prefix}-before-update" });
            var id = GetId(record);
            Assert.NotNull(id);
            _createdIds.Add(id!);

            var updated = await _client.Db("shared").Table("posts").UpdateAsync(id!,
                new Dictionary<string, object?> { ["title"] = $"{_prefix}-after-update" });
            Assert.NotNull(updated);
        }

        [Fact]
        public async Task Delete_lifecycle_insert_then_delete()
        {
            var email = $"{_prefix}-del@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var record = await _client.Db("shared").Table("posts").InsertAsync(
                new Dictionary<string, object?> { ["title"] = $"{_prefix}-to-delete" });
            var id = GetId(record);
            Assert.NotNull(id);

            var deleted = await _client.Db("shared").Table("posts").DeleteAsync(id!);
            Assert.NotNull(deleted);

            // Verify it's gone
            await Assert.ThrowsAsync<EdgeBaseException>(() =>
                _client.Db("shared").Table("posts").GetOneAsync(id!));
        }

        [Fact]
        public async Task OrderBy_returns_sorted()
        {
            var email = $"{_prefix}-order@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var result = await _client.Db("shared").Table("posts")
                .OrderBy("createdAt", "desc").Limit(2).GetListAsync();
            Assert.NotNull(result.Items);
            Assert.True(result.Items.Count <= 2);
        }

        [Fact]
        public async Task Count_returns_non_negative()
        {
            var email = $"{_prefix}-count@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var count = await _client.Db("shared").Table("posts").CountAsync();
            Assert.True(count >= 0);
        }

        [Fact]
        public async Task Batch_insertMany_returns_all()
        {
            var email = $"{_prefix}-batch@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var records = new List<Dictionary<string, object?>>
            {
                new() { ["title"] = $"{_prefix}-batch-1" },
                new() { ["title"] = $"{_prefix}-batch-2" },
                new() { ["title"] = $"{_prefix}-batch-3" }
            };
            var created = await _client.Db("shared").Table("posts").InsertManyAsync(records);
            Assert.Equal(3, created.Count);
            foreach (var r in created)
            {
                var id = GetId(r);
                if (id != null) _createdIds.Add(id);
            }
        }

        [Fact]
        public async Task Upsert_inserts_when_new()
        {
            var email = $"{_prefix}-upsert@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var result = await _client.Db("shared").Table("posts").UpsertAsync(
                new Dictionary<string, object?> { ["title"] = $"{_prefix}-upsert-new" });
            var id = GetId(result);
            Assert.NotNull(id);
            _createdIds.Add(id!);
        }

        [Fact]
        public async Task FieldOps_increment_updates_field()
        {
            var email = $"{_prefix}-inc@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var record = await _client.Db("shared").Table("posts").InsertAsync(
                new Dictionary<string, object?> { ["title"] = $"{_prefix}-increment", ["views"] = 0 });
            var id = GetId(record);
            Assert.NotNull(id);
            _createdIds.Add(id!);

            var updated = await _client.Db("shared").Table("posts").UpdateAsync(id!,
                new Dictionary<string, object?> { ["views"] = FieldOps.Increment(5) });
            Assert.NotNull(updated);
        }

        [Fact]
        public async Task FieldOps_deleteField_removes_field()
        {
            var email = $"{_prefix}-delf@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var record = await _client.Db("shared").Table("posts").InsertAsync(
                new Dictionary<string, object?> { ["title"] = $"{_prefix}-delfield", ["temp"] = "remove-me" });
            var id = GetId(record);
            Assert.NotNull(id);
            _createdIds.Add(id!);

            var updated = await _client.Db("shared").Table("posts").UpdateAsync(id!,
                new Dictionary<string, object?> { ["temp"] = FieldOps.DeleteField() });
            Assert.NotNull(updated);
        }

        [Fact]
        public async Task Where_multiple_conditions()
        {
            var email = $"{_prefix}-multi@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var unique = $"{_prefix}-multi-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            var record = await _client.Db("shared").Table("posts").InsertAsync(
                new Dictionary<string, object?> { ["title"] = unique, ["views"] = 42 });
            var id = GetId(record);
            if (id != null) _createdIds.Add(id);

            var list = await _client.Db("shared").Table("posts")
                .Where("title", "==", unique)
                .Where("views", "==", 42)
                .GetListAsync();
            Assert.NotEmpty(list.Items);
        }

        [Fact]
        public async Task Offset_pagination()
        {
            var email = $"{_prefix}-offset@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var result = await _client.Db("shared").Table("posts")
                .Limit(2).Offset(0).GetListAsync();
            Assert.NotNull(result.Items);
            Assert.True(result.Items.Count <= 2);
        }

        // ═══════════════════════════════════════════════════════════════════════
        // 3. Storage (~5)
        // ═══════════════════════════════════════════════════════════════════════

        [Fact]
        public async Task Storage_upload_and_download_with_auth()
        {
            var email = $"{_prefix}-stor@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var key = $"unity-e2e-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}.txt";
            var content = System.Text.Encoding.UTF8.GetBytes("Hello from Unity E2E");

            var uploadResult = await _client.Storage.Bucket("test-bucket").UploadAsync(
                key, content, "text/plain");
            Assert.NotNull(uploadResult);

            var downloaded = await _client.Storage.Bucket("test-bucket").DownloadAsync(key);
            Assert.Equal("Hello from Unity E2E", System.Text.Encoding.UTF8.GetString(downloaded));

            // Cleanup
            try { await _client.Storage.Bucket("test-bucket").DeleteAsync(key); } catch { }
        }

        [Fact]
        public async Task Storage_list_files()
        {
            var email = $"{_prefix}-storlist@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var key = $"unity-list-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}.txt";
            await _client.Storage.Bucket("test-bucket").UploadAsync(
                key, System.Text.Encoding.UTF8.GetBytes("list test"), "text/plain");

            var result = await _client.Storage.Bucket("test-bucket").ListAsync(limit: 50);
            Assert.NotNull(result.Files);

            // Cleanup
            try { await _client.Storage.Bucket("test-bucket").DeleteAsync(key); } catch { }
        }

        [Fact]
        public async Task Storage_delete_file()
        {
            var email = $"{_prefix}-stordel@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var key = $"unity-del-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}.txt";
            await _client.Storage.Bucket("test-bucket").UploadAsync(
                key, System.Text.Encoding.UTF8.GetBytes("delete me"), "text/plain");

            var deleteResult = await _client.Storage.Bucket("test-bucket").DeleteAsync(key);
            Assert.NotNull(deleteResult);
        }

        [Fact]
        public async Task Storage_signed_url()
        {
            var email = $"{_prefix}-storsign@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var key = $"unity-signed-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}.txt";
            await _client.Storage.Bucket("test-bucket").UploadAsync(
                key, System.Text.Encoding.UTF8.GetBytes("signed url test"), "text/plain");

            var signed = await _client.Storage.Bucket("test-bucket").CreateSignedUrlAsync(key, 3600);
            Assert.NotNull(signed.Url);
            Assert.NotEmpty(signed.Url);

            // Cleanup
            try { await _client.Storage.Bucket("test-bucket").DeleteAsync(key); } catch { }
        }

        [Fact]
        public async Task Storage_metadata()
        {
            var email = $"{_prefix}-stormeta@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var key = $"unity-meta-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}.txt";
            await _client.Storage.Bucket("test-bucket").UploadAsync(
                key, System.Text.Encoding.UTF8.GetBytes("metadata test"), "text/plain");

            var meta = await _client.Storage.Bucket("test-bucket").GetMetadataAsync(key);
            Assert.NotNull(meta);

            // Cleanup
            try { await _client.Storage.Bucket("test-bucket").DeleteAsync(key); } catch { }
        }

        // ═══════════════════════════════════════════════════════════════════════
        // 4. Error (~3)
        // ═══════════════════════════════════════════════════════════════════════

        [Fact]
        public async Task GetOne_nonexistent_throws()
        {
            var email = $"{_prefix}-err@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            await Assert.ThrowsAsync<EdgeBaseException>(() =>
                _client.Db("shared").Table("posts").GetOneAsync("nonexistent-unity-99999"));
        }

        [Fact]
        public async Task Invalid_auth_token_throws()
        {
            using var badClient = new EdgeBase(_baseUrl);
            badClient.Auth.SetAccessToken("invalid-token-xyz");
            await Assert.ThrowsAsync<EdgeBaseException>(() =>
                badClient.Db("shared").Table("posts").Limit(1).GetListAsync());
        }

        [Fact]
        public async Task Insert_missing_required_field_handled()
        {
            var email = $"{_prefix}-missing@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            // Create with empty body — server may still accept it or throw
            // We verify the SDK doesn't crash unexpectedly
            try
            {
                var result = await _client.Db("shared").Table("posts").InsertAsync(
                    new Dictionary<string, object?>());
                // If it succeeds, clean up
                var id = GetId(result);
                if (id != null) _createdIds.Add(id);
            }
            catch (EdgeBaseException)
            {
                // Expected if server requires fields
            }
        }

        [Fact]
        public async Task Update_nonexistent_throws()
        {
            var email = $"{_prefix}-upderr@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            await Assert.ThrowsAsync<EdgeBaseException>(() =>
                _client.Db("shared").Table("posts").UpdateAsync("nonexistent-id-99999",
                    new Dictionary<string, object?> { ["title"] = "X" }));
        }

        // ═══════════════════════════════════════════════════════════════════════
        // 5. C#-specific (~5)
        // ═══════════════════════════════════════════════════════════════════════

        [Fact]
        public async Task Parallel_insert_with_WhenAll()
        {
            var email = $"{_prefix}-parallel@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var titles = new[] { $"{_prefix}-par-1", $"{_prefix}-par-2", $"{_prefix}-par-3" };
            var tasks = Array.ConvertAll(titles, t =>
                _client.Db("shared").Table("posts").InsertAsync(
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
        public async Task CancellationToken_list_succeeds()
        {
            var email = $"{_prefix}-cancel@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            var result = await _client.Db("shared").Table("posts").Limit(2).GetListAsync(cts.Token);
            Assert.NotNull(result);
            Assert.True(result.Items.Count <= 2);
        }

        [Fact]
        public async Task Sequential_operations_insert_read_update_delete()
        {
            var email = $"{_prefix}-seq@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var table = _client.Db("shared").Table("posts");

            // Create
            var created = await table.InsertAsync(
                new Dictionary<string, object?> { ["title"] = $"{_prefix}-seq-item" });
            var id = GetId(created);
            Assert.NotNull(id);

            // Read
            var fetched = await table.GetOneAsync(id!);
            Assert.NotNull(fetched);

            // Update
            var updated = await table.UpdateAsync(id!,
                new Dictionary<string, object?> { ["title"] = $"{_prefix}-seq-updated" });
            Assert.NotNull(updated);

            // Delete
            await table.DeleteAsync(id!);

            // Verify deleted
            await Assert.ThrowsAsync<EdgeBaseException>(() => table.GetOneAsync(id!));
        }

        [Fact]
        public async Task LINQ_style_chain_query()
        {
            var email = $"{_prefix}-linq@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");

            // Chain: Where → OrderBy → Limit → GetAsync (immutable builder)
            var result = await _client.Db("shared").Table("posts")
                .Where("title", "!=", "nonexistent-value")
                .OrderBy("createdAt", "desc")
                .Limit(5)
                .GetListAsync();
            Assert.NotNull(result.Items);
            Assert.True(result.Items.Count <= 5);
        }

        [Fact]
        public async Task Special_characters_in_title()
        {
            var email = $"{_prefix}-special@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var specialTitle = $"{_prefix}-special-!@#$%&*()";
            var record = await _client.Db("shared").Table("posts").InsertAsync(
                new Dictionary<string, object?> { ["title"] = specialTitle });
            var id = GetId(record);
            Assert.NotNull(id);
            _createdIds.Add(id!);

            var fetched = await _client.Db("shared").Table("posts").GetOneAsync(id!);
            var fetchedTitle = GetString(fetched, "title");
            Assert.Equal(specialTitle, fetchedTitle);
        }

        // ═══════════════════════════════════════════════════════════════════════
        // 6. Room/DatabaseLive structure verification (~5)
        // ═══════════════════════════════════════════════════════════════════════

        [Fact]
        public void TableRef_exposes_database_live_subscription()
        {
            var method = typeof(TableRef).GetMethod("OnSnapshot");
            Assert.NotNull(method);
        }

        [Fact]
        public Task Storage_bucket_getUrl_format()
        {
            var url = _client.Storage.Bucket("test-bucket").GetUrl("test-key.txt");
            Assert.Contains("/api/storage/test-bucket/", url);
            Assert.Contains("test-key.txt", url);
            return Task.CompletedTask;
        }

        [Fact]
        public Task Db_ref_returns_tableRef()
        {
            var table = _client.Db("shared").Table("posts");
            Assert.NotNull(table);
            Assert.Equal("posts", table.Name);
            return Task.CompletedTask;
        }

        [Fact]
        public async Task Auth_onAuthStateChange_fires()
        {
            using var client = new EdgeBase(_baseUrl);
            var stateChanged = false;
            client.Auth.OnAuthStateChange += (_) => { stateChanged = true; };

            var email = $"{_prefix}-event@test.com";
            await client.Auth.SignUpAsync(email, "CsUnity123!");
            Assert.True(stateChanged);
        }

        [Fact]
        public async Task LinkWithEmail_after_anonymous()
        {
            using var client = new EdgeBase(_baseUrl);
            var anonResult = await client.Auth.SignInAnonymouslyAsync();
            Assert.NotNull(anonResult.GetValueOrDefault("accessToken"));

            var linkEmail = $"{_prefix}-link-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}@test.com";
            var linkResult = await client.Auth.LinkWithEmailAsync(linkEmail, "LinkPass123!");
            Assert.NotNull(linkResult.GetValueOrDefault("accessToken"));

            // Verify can sign in with linked email
            using var client2 = new EdgeBase(_baseUrl);
            var signInResult = await client2.Auth.SignInAsync(linkEmail, "LinkPass123!");
            Assert.NotNull(signInResult.GetValueOrDefault("accessToken"));
        }

        // ═══════════════════════════════════════════════════════════════════════
        // 7. Additional DB queries
        // ═══════════════════════════════════════════════════════════════════════

        [Fact]
        public async Task GetOne_returns_record_by_id()
        {
            var email = $"{_prefix}-getone@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var record = await _client.Db("shared").Table("posts").InsertAsync(
                new Dictionary<string, object?> { ["title"] = $"{_prefix}-getone" });
            var id = GetId(record);
            Assert.NotNull(id);
            _createdIds.Add(id!);

            var fetched = await _client.Db("shared").Table("posts").GetOneAsync(id!);
            Assert.NotNull(fetched);
            var fetchedTitle = GetString(fetched, "title");
            Assert.Equal($"{_prefix}-getone", fetchedTitle);
        }

        [Fact]
        public async Task Where_contains_filter()
        {
            var email = $"{_prefix}-contains@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var unique = $"{_prefix}-containsval-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            var record = await _client.Db("shared").Table("posts").InsertAsync(
                new Dictionary<string, object?> { ["title"] = unique });
            var id = GetId(record);
            if (id != null) _createdIds.Add(id);

            var list = await _client.Db("shared").Table("posts")
                .Where("title", "contains", "containsval").GetListAsync();
            Assert.NotEmpty(list.Items);
        }

        [Fact]
        public async Task DeleteMany_by_filter()
        {
            var email = $"{_prefix}-delmany@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var unique = $"{_prefix}-delmany-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            // Create 2 records
            await _client.Db("shared").Table("posts").InsertAsync(
                new Dictionary<string, object?> { ["title"] = $"{unique}-a" });
            await _client.Db("shared").Table("posts").InsertAsync(
                new Dictionary<string, object?> { ["title"] = $"{unique}-b" });

            var result = await _client.Db("shared").Table("posts")
                .Where("title", "contains", unique)
                .DeleteManyAsync();
            Assert.NotNull(result);
        }

        [Fact]
        public async Task UpdateMany_by_filter()
        {
            var email = $"{_prefix}-updmany@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var unique = $"{_prefix}-updmany-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            var r1 = await _client.Db("shared").Table("posts").InsertAsync(
                new Dictionary<string, object?> { ["title"] = $"{unique}-1" });
            var id = GetId(r1);
            if (id != null) _createdIds.Add(id);

            var result = await _client.Db("shared").Table("posts")
                .Where("title", "contains", unique)
                .UpdateManyAsync(new Dictionary<string, object?> { ["views"] = 99 });
            Assert.NotNull(result);
        }

        [Fact]
        public async Task Or_filter_query()
        {
            var email = $"{_prefix}-orfilter@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var unique = $"{_prefix}-or-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            var r = await _client.Db("shared").Table("posts").InsertAsync(
                new Dictionary<string, object?> { ["title"] = unique });
            var id = GetId(r);
            if (id != null) _createdIds.Add(id);

            var result = await _client.Db("shared").Table("posts")
                .Or(b => b.Where("title", "==", unique).Where("title", "==", "nonexistent"))
                .GetListAsync();
            Assert.NotNull(result);
        }

        [Fact]
        public async Task Search_query_returns_results()
        {
            var email = $"{_prefix}-search@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var unique = $"{_prefix}-searchval-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            var r = await _client.Db("shared").Table("posts").InsertAsync(
                new Dictionary<string, object?> { ["title"] = unique });
            var id = GetId(r);
            if (id != null) _createdIds.Add(id);

            var result = await _client.Db("shared").Table("posts")
                .Search(unique).Limit(5).GetListAsync();
            Assert.NotNull(result.Items);
        }

        [Fact]
        public async Task Page_pagination()
        {
            var email = $"{_prefix}-page@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var result = await _client.Db("shared").Table("posts")
                .Page(1).Limit(3).GetListAsync();
            Assert.NotNull(result.Items);
            Assert.True(result.Items.Count <= 3);
        }

        // ═══════════════════════════════════════════════════════════════════════
        // 8. Additional Auth flows
        // ═══════════════════════════════════════════════════════════════════════

        [Fact]
        public async Task SignUp_signIn_signOut_full_chain()
        {
            using var client = new EdgeBase(_baseUrl);
            var email = $"{_prefix}-chain-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}@test.com";

            // signup
            var signup = await client.Auth.SignUpAsync(email, "ChainPass123!");
            Assert.NotNull(signup.GetValueOrDefault("accessToken"));

            // signin
            var signin = await client.Auth.SignInAsync(email, "ChainPass123!");
            Assert.NotNull(signin.GetValueOrDefault("accessToken"));

            // signout
            await client.Auth.SignOutAsync();
            Assert.Null(client.Auth.GetAccessToken());
        }

        [Fact]
        public async Task Multiple_signIns_different_clients()
        {
            var email = $"{_prefix}-multisign@test.com";
            using var c1 = new EdgeBase(_baseUrl);
            using var c2 = new EdgeBase(_baseUrl);

            await c1.Auth.SignUpAsync(email, "CsUnity123!");
            var r1 = await c1.Auth.SignInAsync(email, "CsUnity123!");
            var r2 = await c2.Auth.SignInAsync(email, "CsUnity123!");

            Assert.NotNull(r1.GetValueOrDefault("accessToken"));
            Assert.NotNull(r2.GetValueOrDefault("accessToken"));
        }

        [Fact]
        public async Task Storage_upload_string()
        {
            var email = $"{_prefix}-storstr@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var key = $"unity-str-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}.txt";

            var uploadResult = await _client.Storage.Bucket("test-bucket").UploadStringAsync(
                key, "Hello string upload", "raw", "text/plain");
            Assert.NotNull(uploadResult);

            var downloaded = await _client.Storage.Bucket("test-bucket").DownloadAsync(key);
            Assert.Equal("Hello string upload", System.Text.Encoding.UTF8.GetString(downloaded));

            // Cleanup
            try { await _client.Storage.Bucket("test-bucket").DeleteAsync(key); } catch { }
        }

        [Fact]
        public async Task Parallel_reads_with_WhenAll()
        {
            var email = $"{_prefix}-parread@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");

            var tasks = new[]
            {
                _client.Db("shared").Table("posts").Limit(1).GetListAsync(),
                _client.Db("shared").Table("posts").Limit(2).GetListAsync(),
                _client.Db("shared").Table("posts").Limit(3).GetListAsync()
            };
            var results = await Task.WhenAll(tasks);
            Assert.Equal(3, results.Length);
            foreach (var r in results)
            {
                Assert.NotNull(r.Items);
            }
        }

        [Fact]
        public async Task EdgeBaseException_has_status_code()
        {
            var email = $"{_prefix}-excstatus@test.com";
            await _client.Auth.SignUpAsync(email, "CsUnity123!");
            var ex = await Assert.ThrowsAsync<EdgeBaseException>(() =>
                _client.Db("shared").Table("posts").GetOneAsync("nonexistent-check-status"));
            Assert.True(ex.StatusCode > 0);
        }

        [Fact]
        public async Task Dispose_then_new_client()
        {
            var client1 = new EdgeBase(_baseUrl);
            var email = $"{_prefix}-dispose@test.com";
            await client1.Auth.SignUpAsync(email, "CsUnity123!");
            client1.Dispose();

            // Create a new client and verify it works
            using var client2 = new EdgeBase(_baseUrl);
            var result = await client2.Auth.SignInAsync(email, "CsUnity123!");
            Assert.NotNull(result.GetValueOrDefault("accessToken"));
        }

        // ═══════════════════════════════════════════════════════════════════════
        // 9. Push Client E2E (raw HTTP)
        // ═══════════════════════════════════════════════════════════════════════

        /// <summary>Helper: POST JSON via raw HttpClient, returns (statusCode, body).</summary>
        private static async Task<(int StatusCode, string Body)> PostJsonRaw(
            string url, string json, string? bearerToken = null)
        {
            using var httpClient = new System.Net.Http.HttpClient();
            var request = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            };
            if (bearerToken != null)
                request.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", bearerToken);
            var response = await httpClient.SendAsync(request);
            var body = await response.Content.ReadAsStringAsync();
            return ((int)response.StatusCode, body);
        }

        [Fact]
        public async Task Push_register_returns_200()
        {
            // Sign up to get an access token
            var email = $"{_prefix}-push-reg@test.com";
            var signupRes = await PostJsonRaw(
                $"{_baseUrl}/api/auth/signup",
                JsonSerializer.Serialize(new { email, password = "CsPush123!" }));
            Assert.Equal(201, signupRes.StatusCode);
            var signupData = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(signupRes.Body)!;
            var accessToken = signupData["accessToken"].GetString()!;

            var deviceId = $"cs-push-e2e-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            var fcmToken = $"fake-fcm-token-cs-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";

            var (code, body) = await PostJsonRaw(
                $"{_baseUrl}/api/push/register",
                JsonSerializer.Serialize(new { deviceId, token = fcmToken, platform = "ios" }),
                accessToken);
            Assert.Equal(200, code);
            Assert.Contains("\"ok\":true", body);
        }

        [Fact]
        public async Task Push_sdk_register_unregister_round_trip()
        {
            var email = $"{_prefix}-push-sdk@test.com";
            var signup = await _client.Auth.SignUpAsync(email, "CsPushSdk123!");

            string? userId = null;
            if (signup.TryGetValue("user", out var userValue))
            {
                if (userValue is Dictionary<string, object?> userMap)
                {
                    userId = GetId(userMap);
                }
                else if (userValue is JsonElement userElement
                    && userElement.ValueKind == JsonValueKind.Object
                    && userElement.TryGetProperty("id", out var nestedId))
                {
                    userId = nestedId.GetString();
                }
            }
            userId ??= GetString(signup, "userId");
            Assert.False(string.IsNullOrWhiteSpace(userId));

            _client.Push.PermissionStatusProvider = () => "granted";
            _client.Push.PermissionRequester = () => Task.FromResult("granted");
            _client.Push.Platform = PushPlatform.Web;

            var token = $"sdk-push-token-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            _client.Push.TokenProvider = () => Task.FromResult(token);
            await _client.Push.RegisterAsync();

            var (tokensCode, tokensBody) = await GetRaw(
                $"{_baseUrl}/api/push/tokens?userId={userId}",
                ServiceKey);
            Assert.Equal(200, tokensCode);
            Assert.Contains(token, tokensBody);

            using var tokensDoc = JsonDocument.Parse(tokensBody);
            var items = tokensDoc.RootElement.GetProperty("items");
            Assert.Single(items.EnumerateArray());
            var deviceId = items[0].GetProperty("deviceId").GetString();
            Assert.False(string.IsNullOrWhiteSpace(deviceId));

            await _client.Push.UnregisterAsync(deviceId);

            var (afterCode, afterBody) = await GetRaw(
                $"{_baseUrl}/api/push/tokens?userId={userId}",
                ServiceKey);
            Assert.Equal(200, afterCode);
            Assert.Contains("\"items\":[]", afterBody);
        }

        [Fact]
        public async Task Push_subscribeTopic_returns_200_or_503()
        {
            var email = $"{_prefix}-push-sub@test.com";
            var signupRes = await PostJsonRaw(
                $"{_baseUrl}/api/auth/signup",
                JsonSerializer.Serialize(new { email, password = "CsPush123!" }));
            var signupData = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(signupRes.Body)!;
            var accessToken = signupData["accessToken"].GetString()!;

            // Register a device first so topic subscribe has tokens
            var deviceId = $"cs-push-sub-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            var fcmToken = $"fake-fcm-sub-cs-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            await PostJsonRaw(
                $"{_baseUrl}/api/push/register",
                JsonSerializer.Serialize(new { deviceId, token = fcmToken, platform = "ios" }),
                accessToken);

            var (code, _) = await PostJsonRaw(
                $"{_baseUrl}/api/push/topic/subscribe",
                JsonSerializer.Serialize(new { topic = "test-topic-cs" }),
                accessToken);
            // 503 = push not configured (no FCM creds), acceptable in test env
            Assert.True(code == 200 || code == 503, $"Expected 200 or 503, got {code}");
        }

        [Fact]
        public async Task Push_unsubscribeTopic_returns_200_or_503()
        {
            var email = $"{_prefix}-push-unsub@test.com";
            var signupRes = await PostJsonRaw(
                $"{_baseUrl}/api/auth/signup",
                JsonSerializer.Serialize(new { email, password = "CsPush123!" }));
            var signupData = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(signupRes.Body)!;
            var accessToken = signupData["accessToken"].GetString()!;

            // Register a device first
            var deviceId = $"cs-push-unsub-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            var fcmToken = $"fake-fcm-unsub-cs-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            await PostJsonRaw(
                $"{_baseUrl}/api/push/register",
                JsonSerializer.Serialize(new { deviceId, token = fcmToken, platform = "ios" }),
                accessToken);

            var (code, _) = await PostJsonRaw(
                $"{_baseUrl}/api/push/topic/unsubscribe",
                JsonSerializer.Serialize(new { topic = "test-topic-cs" }),
                accessToken);
            // 503 = push not configured (no FCM creds), acceptable in test env
            Assert.True(code == 200 || code == 503, $"Expected 200 or 503, got {code}");
        }

        [Fact]
        public async Task Push_unregister_returns_200()
        {
            var email = $"{_prefix}-push-unreg@test.com";
            var signupRes = await PostJsonRaw(
                $"{_baseUrl}/api/auth/signup",
                JsonSerializer.Serialize(new { email, password = "CsPush123!" }));
            var signupData = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(signupRes.Body)!;
            var accessToken = signupData["accessToken"].GetString()!;

            var deviceId = $"cs-push-unreg-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            var fcmToken = $"fake-fcm-unreg-cs-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";

            // Register first
            await PostJsonRaw(
                $"{_baseUrl}/api/push/register",
                JsonSerializer.Serialize(new { deviceId, token = fcmToken, platform = "ios" }),
                accessToken);

            // Unregister
            var (code, body) = await PostJsonRaw(
                $"{_baseUrl}/api/push/unregister",
                JsonSerializer.Serialize(new { deviceId }),
                accessToken);
            Assert.Equal(200, code);
            Assert.Contains("\"ok\":true", body);
        }

        // ═══════════════════════════════════════════════════════════════════════
        // 10. Push Full Flow E2E
        // ═══════════════════════════════════════════════════════════════════════

        private static readonly string MockFcmUrl = "http://localhost:9099";
        private static readonly string ServiceKey =
            Environment.GetEnvironmentVariable("SERVICE_KEY") ?? "test-service-key-for-admin";

        /// <summary>Helper: GET a URL and return (statusCode, body).</summary>
        private static async Task<(int StatusCode, string Body)> GetRaw(
            string url, string? serviceKeyHeader = null)
        {
            using var httpClient = new System.Net.Http.HttpClient();
            var request = new HttpRequestMessage(HttpMethod.Get, url);
            if (serviceKeyHeader != null)
                request.Headers.Add("X-EdgeBase-Service-Key", serviceKeyHeader);
            var response = await httpClient.SendAsync(request);
            var body = await response.Content.ReadAsStringAsync();
            return ((int)response.StatusCode, body);
        }

        /// <summary>Helper: DELETE a URL.</summary>
        private static async Task<int> DeleteRaw(string url)
        {
            using var httpClient = new System.Net.Http.HttpClient();
            var response = await httpClient.DeleteAsync(url);
            return (int)response.StatusCode;
        }

        /// <summary>Helper: POST JSON with service key header.</summary>
        private static async Task<(int StatusCode, string Body)> PostJsonWithServiceKey(
            string url, string json, string serviceKeyValue)
        {
            using var httpClient = new System.Net.Http.HttpClient();
            var request = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            };
            request.Headers.Add("X-EdgeBase-Service-Key", serviceKeyValue);
            var response = await httpClient.SendAsync(request);
            var body = await response.Content.ReadAsStringAsync();
            return ((int)response.StatusCode, body);
        }

        [Fact]
        public async Task Push_full_flow_e2e()
        {
            // 1. Setup: signup → get accessToken + userId
            var email = $"{_prefix}-push-flow@test.com";
            var signupRes = await PostJsonRaw(
                $"{_baseUrl}/api/auth/signup",
                JsonSerializer.Serialize(new { email, password = "CsFlow123!" }));
            Assert.Equal(201, signupRes.StatusCode);
            var signupData = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(signupRes.Body)!;
            var accessToken = signupData["accessToken"].GetString()!;
            var userObj = signupData["user"];
            var userId = userObj.GetProperty("id").GetString()!;
            Assert.NotEmpty(accessToken);
            Assert.NotEmpty(userId);

            // 2. Clear mock FCM store
            var clearStatus = await DeleteRaw($"{MockFcmUrl}/messages");
            Assert.Equal(200, clearStatus);

            // 3. Client register
            var deviceId = $"cs-flow-e2e-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            var fcmToken = $"flow-token-cs-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            var (regCode, regBody) = await PostJsonRaw(
                $"{_baseUrl}/api/push/register",
                JsonSerializer.Serialize(new { deviceId, token = fcmToken, platform = "web" }),
                accessToken);
            Assert.Equal(200, regCode);
            Assert.Contains("\"ok\":true", regBody);

            // 4. Admin send(userId) → expect sent:1
            var (sendCode, sendBody) = await PostJsonWithServiceKey(
                $"{_baseUrl}/api/push/send",
                JsonSerializer.Serialize(new { userId, payload = new { title = "Full Flow", body = "E2E" } }),
                ServiceKey);
            Assert.Equal(200, sendCode);
            Assert.Contains("\"sent\":1", sendBody);

            // 5. Verify mock FCM received correct token/payload
            var (mockCode, mockBody) = await GetRaw($"{MockFcmUrl}/messages?token={fcmToken}");
            Assert.Equal(200, mockCode);
            Assert.Contains(fcmToken, mockBody);
            Assert.Contains("\"title\":\"Full Flow\"", mockBody);
            Assert.Contains("\"body\":\"E2E\"", mockBody);

            // 6. Admin sendToTopic → verify mock FCM received topic:"news"
            await DeleteRaw($"{MockFcmUrl}/messages"); // clear for isolation
            var (topicCode, topicBody) = await PostJsonWithServiceKey(
                $"{_baseUrl}/api/push/send-to-topic",
                JsonSerializer.Serialize(new { topic = "news", payload = new { title = "Topic Test", body = "cs" } }),
                ServiceKey);
            Assert.Equal(200, topicCode);

            var (topicMockCode, topicMockBody) = await GetRaw($"{MockFcmUrl}/messages?topic=news");
            Assert.Equal(200, topicMockCode);
            Assert.Contains("\"topic\":\"news\"", topicMockBody);

            // 7. Admin broadcast → verify mock FCM received topic:"all"
            await DeleteRaw($"{MockFcmUrl}/messages"); // clear for isolation
            var (bcCode, bcBody) = await PostJsonWithServiceKey(
                $"{_baseUrl}/api/push/broadcast",
                JsonSerializer.Serialize(new { payload = new { title = "Broadcast", body = "all-devices" } }),
                ServiceKey);
            Assert.Equal(200, bcCode);

            var (bcMockCode, bcMockBody) = await GetRaw($"{MockFcmUrl}/messages?topic=all");
            Assert.Equal(200, bcMockCode);
            Assert.Contains("\"topic\":\"all\"", bcMockBody);

            // 8. Client unregister
            var (unregCode, unregBody) = await PostJsonRaw(
                $"{_baseUrl}/api/push/unregister",
                JsonSerializer.Serialize(new { deviceId }),
                accessToken);
            Assert.Equal(200, unregCode);
            Assert.Contains("\"ok\":true", unregBody);

            // 9. Admin getTokens → expect items empty
            var (tokensCode, tokensBody) = await GetRaw(
                $"{_baseUrl}/api/push/tokens?userId={userId}",
                ServiceKey);
            Assert.Equal(200, tokensCode);
            Assert.Contains("\"items\":[]", tokensBody);
        }
    }
}
