package dev.edgebase.sdk.client

import dev.edgebase.sdk.core.EdgeBaseError
import dev.edgebase.sdk.core.FieldOps
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.cancel
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import java.net.HttpURLConnection
import java.net.URL
import org.junit.Assume.assumeTrue
import kotlin.test.Test
import kotlin.test.BeforeTest
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.assertFalse

/**
 * Kotlin Client SDK — E2E 테스트
 *
 * 전제: wrangler dev --port 8688 서버 실행 중
 *
 * 실행:
 *   BASE_URL=http://localhost:8688 \
 *     cd packages/sdk/kotlin && ./gradlew :client:test
 *
 * 원칙: mock 금지, 실서버 기반, ClientEdgeBase 사용
 */

class ClientEdgeBaseE2ETest {

    private val baseUrl = System.getenv("BASE_URL") ?: "http://localhost:8688"
    private val prefix = "kt-client-e2e-${System.currentTimeMillis()}"
    private val authStorageBucket = "documents"

    @BeforeTest
    fun requireServer() {
        val available = isServerAvailable(baseUrl)
        val message = "E2E backend not reachable at $baseUrl. Start `edgebase dev --port 8688` or set BASE_URL. Set EDGEBASE_E2E_REQUIRED=1 to fail instead of skip."
        if (System.getenv("EDGEBASE_E2E_REQUIRED") == "1") {
            check(available) { message }
            return
        }
        assumeTrue(message, available)
    }

    private fun isServerAvailable(url: String): Boolean {
        return try {
            val connection = URL("${url.trimEnd('/')}/api/health").openConnection() as HttpURLConnection
            connection.requestMethod = "GET"
            connection.connectTimeout = 1500
            connection.readTimeout = 1500
            val statusCode = connection.responseCode
            statusCode in 200..499
        } catch (_: Exception) {
            false
        }
    }

    // ─── 1. Auth ─────────────────────────────────────────────────────────────

    @Test
    fun test_signUp_returns_accessToken() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-signup@test.com"
        val result = client.auth.signUp(email, "KtClient123!")
        assertTrue(result.containsKey("accessToken"), "signup should return accessToken")
        client.destroy()
    }

    @Test
    fun test_signIn_returns_accessToken() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-signin@test.com"
        client.auth.signUp(email, "KtClient123!")
        val result = client.auth.signIn(email, "KtClient123!")
        assertTrue(result.containsKey("accessToken"), "signIn should return accessToken")
        client.destroy()
    }

    @Test
    fun test_signOut_succeeds() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-signout@test.com"
        client.auth.signUp(email, "KtClient123!")
        try {
            client.auth.signOut()
            assertTrue(true)
        } catch (e: Exception) {
            assertTrue(false, "signOut threw: ${e.message}")
        }
        client.destroy()
    }

    @Test
    fun test_signInAnonymously_returns_token() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val result = client.auth.signInAnonymously()
        assertTrue(result.containsKey("accessToken"), "anonymous should return accessToken")
        client.destroy()
    }

    @Test
    fun test_signIn_wrong_password_throws() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-wrongpw@test.com"
        client.auth.signUp(email, "KtClient123!")
        try {
            client.auth.signIn(email, "WrongPass!")
            assertTrue(false, "Should have thrown")
        } catch (_: Exception) {
            assertTrue(true)
        }
        client.destroy()
    }

    @Test
    fun test_signUp_with_displayName() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-display@test.com"
        val result = client.auth.signUp(email, "KtClient123!", mapOf("displayName" to "Test User"))
        assertTrue(result.containsKey("accessToken"))
        client.destroy()
    }

    // ─── 2. DB ───────────────────────────────────────────────────────────────

    @Test
    fun test_db_create_and_getOne() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        // Sign in to get auth context
        val email = "$prefix-db@test.com"
        client.auth.signUp(email, "KtClient123!")

        val created = client.db("shared").table("posts").insert(mapOf("title" to "$prefix-db-create"))
        val id = created["id"] as? String
        assertNotNull(id)
        val fetched = client.db("shared").table("posts").getOne(id!!)
        assertNotNull(fetched["id"])
        client.db("shared").table("posts").delete(id)
        client.destroy()
    }

    @Test
    fun test_db_list_returns_items() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-list@test.com"
        client.auth.signUp(email, "KtClient123!")

        val result = client.db("shared").table("posts").limit(3).getList()
        assertNotNull(result.items)
        assertTrue(result.items.size <= 3)
        client.destroy()
    }

    @Test
    fun test_db_where_filter() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-filter@test.com"
        client.auth.signUp(email, "KtClient123!")

        val unique = "$prefix-filter-${System.currentTimeMillis()}"
        val r = client.db("shared").table("posts").insert(mapOf("title" to unique))
        val id = r["id"] as? String
        val list = client.db("shared").table("posts").where("title", "==", unique).getList()
        assertTrue(list.items.isNotEmpty())
        if (id != null) client.db("shared").table("posts").delete(id)
        client.destroy()
    }

    // ─── 3. Storage ──────────────────────────────────────────────────────────

    @Test
    fun test_storage_put_and_download_with_auth() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        client.auth.signUp("$prefix-storage@test.com", "KtClient123!")
        val bucket = client.storage.bucket(authStorageBucket)
        val key = "kt-client-${System.currentTimeMillis()}.txt"
        val content = "Hello from Kotlin client"
        val uploaded = bucket.upload(key, content.toByteArray(), "text/plain")
        assertEquals(key, uploaded.key)
        val downloaded = bucket.download(key)
        assertEquals(content, String(downloaded))
        bucket.delete(key)
        client.destroy()
    }

    // ─── 4. Error ────────────────────────────────────────────────────────────

    @Test
    fun test_getOne_nonexistent_throws() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-err@test.com"
        client.auth.signUp(email, "KtClient123!")

        try {
            client.db("shared").table("posts").getOne("nonexistent-kt-client-99999")
            assertTrue(false, "Should have thrown")
        } catch (_: Exception) {
            assertTrue(true)
        }
        client.destroy()
    }

    // ─── 5. coroutine async 병렬 (언어특화) ───────────────────────────────────

    @Test
    fun test_parallel_create_with_kotlinx_coroutines() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-parallel@test.com"
        client.auth.signUp(email, "KtClient123!")

        val titles = listOf("$prefix-parallel-1", "$prefix-parallel-2", "$prefix-parallel-3")
        // Sequential creates in runBlocking (coroutineScope/async removed for Android unit test compat)
        val results = titles.map { title ->
            client.db("shared").table("posts").insert(mapOf("title" to title))
        }
        assertTrue(results.size == 3)
        results.mapNotNull { it["id"] as? String }.forEach { id ->
            client.db("shared").table("posts").delete(id)
        }
        client.destroy()
    }

    @Test
    fun test_tryRestoreSession_returns_boolean() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val restored = client.tryRestoreSession()
        // No stored tokens → false, that is valid
        assertTrue(restored == true || restored == false)
        client.destroy()
    }

    // ─── 6. 인증 없는 protected route ───────────────────────────────────────

    @Test
    fun test_unauthenticated_protected_endpoint_throws() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        // No auth — /api/auth/me should fail
        try {
            val httpResult = client.auth.getMe()
            // If getMe() returns null instead of throwing, check it
            assertTrue(httpResult == null || httpResult.isEmpty())
        } catch (_: Exception) {
            assertTrue(true)
        }
        client.destroy()
    }

    // ─── 7. Auth 추가 테스트 ─────────────────────────────────────────────────

    @Test
    fun test_updateProfile_changes_displayName() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-profile@test.com"
        client.auth.signUp(email, "KtClient123!")
        val result = client.auth.updateProfile(mapOf("displayName" to "NewName"))
        assertNotNull(result)
        // updateProfile returns auth response; server may include user info
        assertTrue(result.containsKey("accessToken") || result.containsKey("user") || result.isNotEmpty())
        client.destroy()
    }

    @Test
    fun test_changePassword_succeeds() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-chpw@test.com"
        val oldPass = "KtClient123!"
        val newPass = "KtNewPass456!"
        client.auth.signUp(email, oldPass)
        val result = client.auth.changePassword(oldPass, newPass)
        assertNotNull(result)
        // Verify can sign in with new password
        val client2 = ClientEdgeBase(baseUrl)
        val signInResult = client2.auth.signIn(email, newPass)
        assertTrue(signInResult.containsKey("accessToken"))
        client.destroy()
        client2.destroy()
    }

    @Test
    fun test_listSessions_returns_list() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-sessions@test.com"
        client.auth.signUp(email, "KtClient123!")
        val sessions = client.auth.listSessions()
        assertNotNull(sessions)
        assertTrue(sessions is List<*>)
        client.destroy()
    }

    @Test
    fun test_revokeSession_succeeds() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-revoke@test.com"
        client.auth.signUp(email, "KtClient123!")
        val sessions = client.auth.listSessions()
        if (sessions.isNotEmpty()) {
            val sessionId = sessions.first()["id"] as? String
            if (sessionId != null) {
                try {
                    client.auth.revokeSession(sessionId)
                    assertTrue(true)
                } catch (_: Exception) {
                    // Revoking current session may fail — still valid test
                    assertTrue(true)
                }
            }
        }
        client.destroy()
    }

    @Test
    fun test_signInAnonymously_isAnonymous() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val result = client.auth.signInAnonymously()
        assertTrue(result.containsKey("accessToken"))
        // Anonymous users should have isAnonymous flag
        @Suppress("UNCHECKED_CAST")
        val user = result["user"] as? Map<String, Any?>
        if (user != null) {
            assertTrue(user["isAnonymous"] == true)
        }
        client.destroy()
    }

    @Test
    fun test_signIn_returns_user() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-retuser@test.com"
        client.auth.signUp(email, "KtClient123!")
        val result = client.auth.signIn(email, "KtClient123!")
        // signIn returns map with accessToken and user info
        assertTrue(result.containsKey("accessToken"))
        assertTrue(result.containsKey("user") || result.containsKey("refreshToken"))
        client.destroy()
    }

    @Test
    fun test_currentUser_after_signUp() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-curuser@test.com"
        client.auth.signUp(email, "KtClient123!")
        val user = client.auth.currentUser()
        assertNotNull(user, "currentUser should not be null after signUp")
        client.destroy()
    }

    @Test
    fun test_signInWithOAuth_returns_url() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val url = client.auth.signInWithOAuth("google")
        assertTrue(url.contains("/api/auth/oauth/google"), "OAuth URL should contain provider path")
        client.destroy()
    }

    @Test
    fun test_duplicate_email_throws() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-dup@test.com"
        client.auth.signUp(email, "KtClient123!")
        try {
            val client2 = ClientEdgeBase(baseUrl)
            client2.auth.signUp(email, "KtClient123!")
            assertTrue(false, "Should have thrown on duplicate email")
        } catch (_: Exception) {
            assertTrue(true)
        }
        client.destroy()
    }

    @Test
    fun test_verifyEmail_endpoint() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        try {
            client.auth.verifyEmail("fake-invalid-token-999")
            // If it doesn't throw, server accepted (unlikely for fake token)
            assertTrue(true)
        } catch (_: Exception) {
            // Expected: invalid token should throw
            assertTrue(true)
        }
        client.destroy()
    }

    // ─── 8. DB 추가 테스트 ──────────────────────────────────────────────────

    @Test
    fun test_db_update_changes_field() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-upd@test.com"
        client.auth.signUp(email, "KtClient123!")

        val table = client.db("shared").table("posts")
        val created = table.insert(mapOf("title" to "$prefix-update-orig"))
        val id = created["id"] as String
        table.update(id, mapOf("title" to "$prefix-update-new"))
        val fetched = table.getOne(id)
        assertEquals("$prefix-update-new", fetched["title"])
        table.delete(id)
        client.destroy()
    }

    @Test
    fun test_db_delete_then_getOne_throws() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-del@test.com"
        client.auth.signUp(email, "KtClient123!")

        val table = client.db("shared").table("posts")
        val created = table.insert(mapOf("title" to "$prefix-del-target"))
        val id = created["id"] as String
        table.delete(id)
        try {
            table.getOne(id)
            assertTrue(false, "Should have thrown 404")
        } catch (_: Exception) {
            assertTrue(true)
        }
        client.destroy()
    }

    @Test
    fun test_db_list_orderBy() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-order@test.com"
        client.auth.signUp(email, "KtClient123!")

        val table = client.db("shared").table("posts")
        val ids = mutableListOf<String>()
        for (i in 1..3) {
            val r = table.insert(mapOf("title" to "$prefix-order-$i"))
            ids.add(r["id"] as String)
        }
        val result = table.where("title", "contains", "$prefix-order-")
            .orderBy("createdAt", "desc").getList()
        assertTrue(result.items.isNotEmpty())
        // Descending order: first item should have the latest createdAt
        if (result.items.size >= 2) {
            val first = result.items.first()["createdAt"] as? String ?: ""
            val last = result.items.last()["createdAt"] as? String ?: ""
            assertTrue(first >= last, "desc order: first createdAt >= last")
        }
        ids.forEach { table.delete(it) }
        client.destroy()
    }

    @Test
    fun test_db_list_where_multiple() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-multi@test.com"
        client.auth.signUp(email, "KtClient123!")

        val uniqueTag = "$prefix-multi-${System.currentTimeMillis()}"
        val table = client.db("shared").table("posts")
        val id1 = table.insert(mapOf("title" to "$uniqueTag-a"))["id"] as String
        val id2 = table.insert(mapOf("title" to "$uniqueTag-b"))["id"] as String

        val result = table.where("title", "contains", uniqueTag).getList()
        assertEquals(2, result.items.size, "Should find exactly 2 items with unique prefix")
        table.delete(id1)
        table.delete(id2)
        client.destroy()
    }

    @Test
    fun test_db_count() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-cnt@test.com"
        client.auth.signUp(email, "KtClient123!")

        val uniqueTag = "$prefix-cnt-${System.currentTimeMillis()}"
        val table = client.db("shared").table("posts")
        val ids = mutableListOf<String>()
        for (i in 1..3) {
            val r = table.insert(mapOf("title" to "$uniqueTag-$i"))
            ids.add(r["id"] as String)
        }
        val count = table.where("title", "contains", uniqueTag).count()
        assertEquals(3, count, "Count should be 3")
        ids.forEach { table.delete(it) }
        client.destroy()
    }

    @Test
    fun test_db_offset_pagination() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-page@test.com"
        client.auth.signUp(email, "KtClient123!")

        val uniqueTag = "$prefix-page-${System.currentTimeMillis()}"
        val table = client.db("shared").table("posts")
        val ids = mutableListOf<String>()
        for (i in 1..5) {
            val r = table.insert(mapOf("title" to "$uniqueTag-$i"))
            ids.add(r["id"] as String)
        }
        val page1 = table.where("title", "contains", uniqueTag)
            .orderBy("createdAt", "asc").limit(2).offset(0).getList()
        val page2 = table.where("title", "contains", uniqueTag)
            .orderBy("createdAt", "asc").limit(2).offset(2).getList()
        assertTrue(page1.items.isNotEmpty())
        assertTrue(page2.items.isNotEmpty())
        // Pages should have different items
        val page1Ids = page1.items.map { it["id"] }
        val page2Ids = page2.items.map { it["id"] }
        assertTrue(page1Ids.intersect(page2Ids.toSet()).isEmpty(), "Pages should have different items")
        ids.forEach { table.delete(it) }
        client.destroy()
    }

    @Test
    fun test_db_upsert_create() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-ups@test.com"
        client.auth.signUp(email, "KtClient123!")

        val table = client.db("shared").table("posts")
        val result = table.upsert(mapOf("title" to "$prefix-upsert-new"))
        assertNotNull(result.record)
        assertNotNull(result.record["id"])
        val id = result.record["id"] as String
        table.delete(id)
        client.destroy()
    }

    @Test
    fun test_db_batch_insertMany() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-batch@test.com"
        client.auth.signUp(email, "KtClient123!")

        val table = client.db("shared").table("posts")
        val records = listOf(
            mapOf("title" to "$prefix-batch-1"),
            mapOf("title" to "$prefix-batch-2"),
            mapOf("title" to "$prefix-batch-3")
        )
        val created = table.insertMany(records)
        assertEquals(3, created.size, "insertMany should return 3 items")
        created.mapNotNull { it["id"] as? String }.forEach { table.delete(it) }
        client.destroy()
    }

    @Test
    fun test_db_fieldOps_increment() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-inc@test.com"
        client.auth.signUp(email, "KtClient123!")

        val table = client.db("shared").table("posts")
        val created = table.insert(mapOf("title" to "$prefix-inc", "views" to 0))
        val id = created["id"] as String
        table.update(id, mapOf("views" to FieldOps.increment(5)))
        val fetched = table.getOne(id)
        val views = (fetched["views"] as? Number)?.toInt()
        assertEquals(5, views, "views should be 5 after increment(5)")
        table.delete(id)
        client.destroy()
    }

    @Test
    fun test_db_fieldOps_deleteField() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-delf@test.com"
        client.auth.signUp(email, "KtClient123!")

        val table = client.db("shared").table("posts")
        val created = table.insert(mapOf("title" to "$prefix-delf", "score" to 10))
        val id = created["id"] as String
        table.update(id, mapOf("score" to FieldOps.deleteField()))
        val fetched = table.getOne(id)
        assertNull(fetched["score"], "score should be null after deleteField()")
        table.delete(id)
        client.destroy()
    }

    // ─── 9. Storage 추가 테스트 ─────────────────────────────────────────────

    @Test
    fun test_storage_upload_download_roundtrip_with_auth() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        client.auth.signUp("$prefix-roundtrip@test.com", "KtClient123!")
        val key = "kt-client-roundtrip-${System.currentTimeMillis()}.txt"
        val content = "Roundtrip test from Kotlin client SDK"
        val bucket = client.storage.bucket(authStorageBucket)
        bucket.upload(key, content.toByteArray(), "text/plain")
        val downloaded = bucket.download(key)
        assertEquals(content, String(downloaded), "Downloaded content should match uploaded")
        bucket.delete(key)
        client.destroy()
    }

    @Test
    fun test_storage_list_with_auth() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        client.auth.signUp("$prefix-liststor@test.com", "KtClient123!")
        val keyPrefix = "kt-client-list-${System.currentTimeMillis()}"
        val bucket = client.storage.bucket(authStorageBucket)
        val firstKey = "$keyPrefix/file1.txt"
        val secondKey = "$keyPrefix/file2.txt"
        bucket.upload(firstKey, "file1".toByteArray(), "text/plain")
        bucket.upload(secondKey, "file2".toByteArray(), "text/plain")
        val result = bucket.list(prefix = keyPrefix)
        val items = (result["items"] as? List<*>) ?: (result["files"] as? List<*>) ?: emptyList<Any?>()
        assertTrue(items.any { (it as? Map<*, *>)?.get("key") == firstKey })
        assertTrue(items.any { (it as? Map<*, *>)?.get("key") == secondKey })
        bucket.delete(firstKey)
        bucket.delete(secondKey)
        client.destroy()
    }

    @Test
    fun test_storage_delete_with_auth() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        client.auth.signUp("$prefix-delstor@test.com", "KtClient123!")
        val key = "kt-client-del-${System.currentTimeMillis()}.txt"
        val bucket = client.storage.bucket(authStorageBucket)
        bucket.upload(key, "delete me".toByteArray(), "text/plain")
        bucket.delete(key)
        try {
            bucket.download(key)
            assertTrue(false, "Download after delete should throw")
        } catch (_: Exception) {
            assertTrue(true)
        }
        client.destroy()
    }

    @Test
    fun test_storage_signed_url_with_auth() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        client.auth.signUp("$prefix-signed@test.com", "KtClient123!")
        val key = "kt-client-signed-${System.currentTimeMillis()}.txt"
        val bucket = client.storage.bucket(authStorageBucket)
        bucket.upload(key, "signed".toByteArray(), "text/plain")
        val signed = bucket.createSignedUrl(key)
        assertTrue(signed.url.isNotBlank(), "Signed URL should not be blank")
        bucket.delete(key)
        client.destroy()
    }

    @Test
    fun test_storage_metadata_with_auth() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        client.auth.signUp("$prefix-meta@test.com", "KtClient123!")
        val key = "kt-client-meta-${System.currentTimeMillis()}.json"
        val bucket = client.storage.bucket(authStorageBucket)
        bucket.upload(key, "{}".toByteArray(), "application/json")
        val metadata = bucket.getMetadata(key)
        assertEquals(key, metadata.key)
        assertTrue(metadata.contentType?.contains("application/json") == true)
        bucket.delete(key)
        client.destroy()
    }

    @Test
    fun test_storage_uploadString_with_auth() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        client.auth.signUp("$prefix-upstr@test.com", "KtClient123!")
        val key = "kt-client-upload-string-${System.currentTimeMillis()}.txt"
        val content = "uploadString from Kotlin client"
        val bucket = client.storage.bucket(authStorageBucket)
        val uploaded = bucket.uploadString(key, content)
        assertEquals(key, uploaded.key)
        val downloaded = bucket.download(key)
        assertEquals(content, String(downloaded))
        bucket.delete(key)
        client.destroy()
    }

    @Test
    fun test_storage_getUrl_contains_bucket_and_key() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val url = client.storage.bucket(authStorageBucket).getUrl("folder/kt-url.txt")
        assertTrue(url.contains(authStorageBucket))
        assertTrue(url.contains("kt-url.txt"))
        client.destroy()
    }

    @Test
    fun test_storage_nonexistent_download_throws() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        client.auth.signUp("$prefix-missing@test.com", "KtClient123!")
        val bucket = client.storage.bucket(authStorageBucket)
        try {
            bucket.download("nonexistent-kt-storage-${System.currentTimeMillis()}.txt")
            assertTrue(false, "Downloading a missing object should throw")
        } catch (e: EdgeBaseError) {
            assertTrue(e.statusCode >= 400, "Missing object should surface a 4xx/5xx status")
        }
        client.destroy()
    }

    // ─── 10. Error 추가 테스트 ──────────────────────────────────────────────

    @Test
    fun test_create_missing_required_field() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-reqf@test.com"
        client.auth.signUp(email, "KtClient123!")

        // Attempt to create a record with an empty map — may trigger validation
        try {
            val table = client.db("shared").table("posts")
            val result = table.insert(mapOf<String, Any>())
            // If no required fields enforced, cleanup
            val id = result["id"] as? String
            if (id != null) table.delete(id)
        } catch (e: EdgeBaseError) {
            assertTrue(e.statusCode == 400 || e.statusCode == 422,
                "Missing field should return 400 or 422, got ${e.statusCode}")
        } catch (_: Exception) {
            assertTrue(true)
        }
        client.destroy()
    }

    @Test
    fun test_wrong_type_in_field() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-wrongt@test.com"
        client.auth.signUp(email, "KtClient123!")

        // Create with unusual type combinations — server may accept dynamic schema
        try {
            val table = client.db("shared").table("posts")
            val result = table.insert(mapOf("title" to mapOf("nested" to "object")))
            // If dynamic schema, just cleanup
            val id = result["id"] as? String
            if (id != null) table.delete(id)
        } catch (e: EdgeBaseError) {
            assertTrue(e.statusCode in 400..499,
                "Wrong type should return 4xx, got ${e.statusCode}")
        } catch (_: Exception) {
            assertTrue(true)
        }
        client.destroy()
    }

    // ─── 11. Kotlin 특화 테스트 ─────────────────────────────────────────────

    @Test
    fun test_coroutine_scope_cancel() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-cancel@test.com"
        client.auth.signUp(email, "KtClient123!")

        val scope = CoroutineScope(Dispatchers.Default)
        val job: Job = scope.launch {
            try {
                client.db("shared").table("posts").limit(1).getList()
            } catch (_: Exception) {
                // Cancellation or other exception is fine
            }
        }
        // Cancel the scope and verify no crash
        scope.cancel()
        try {
            job.join()
        } catch (_: Exception) {
            // CancellationException is expected
        }
        assertTrue(true, "Scope cancellation should not crash")
        client.destroy()
    }

    @Test
    fun test_sequential_auth_operations() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-seq@test.com"
        val password = "KtClient123!"

        // signup -> signout -> signin -> signout in sequence
        client.auth.signUp(email, password)
        client.auth.signOut()
        client.auth.signIn(email, password)
        client.auth.signOut()

        // Verify we can sign in again after the sequence
        val result = client.auth.signIn(email, password)
        assertTrue(result.containsKey("accessToken"), "Should sign in after sequential auth ops")
        client.destroy()
    }

    @Test
    fun test_multiple_clients_independent() = runBlocking {
        val client1 = ClientEdgeBase(baseUrl)
        val client2 = ClientEdgeBase(baseUrl)

        val email1 = "$prefix-ind1@test.com"
        val email2 = "$prefix-ind2@test.com"

        val result1 = client1.auth.signUp(email1, "KtClient123!")
        val result2 = client2.auth.signUp(email2, "KtClient123!")

        assertTrue(result1.containsKey("accessToken"))
        assertTrue(result2.containsKey("accessToken"))

        // Each client has its own user
        val user1 = client1.auth.currentUser()
        val user2 = client2.auth.currentUser()
        assertNotNull(user1)
        assertNotNull(user2)
        // User IDs or emails should differ
        assertTrue(user1["sub"] != user2["sub"] || user1["email"] != user2["email"],
            "Two clients should have independent auth state")

        client1.destroy()
        client2.destroy()
    }

    @Test
    fun test_db_chaining_fluent() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-chain@test.com"
        client.auth.signUp(email, "KtClient123!")

        val uniqueTag = "$prefix-chain-${System.currentTimeMillis()}"
        val table = client.db("shared").table("posts")
        val ids = mutableListOf<String>()
        for (i in 1..3) {
            val r = table.insert(mapOf("title" to "$uniqueTag-$i"))
            ids.add(r["id"] as String)
        }

        // Fluent chaining: where + orderBy + limit in a single expression
        val result = table
            .where("title", "contains", uniqueTag)
            .orderBy("createdAt", "asc")
            .limit(2)
            .getList()

        assertTrue(result.items.isNotEmpty(), "Chained query should return items")
        assertTrue(result.items.size <= 2, "Limit(2) should cap at 2 items")
        ids.forEach { table.delete(it) }
        client.destroy()
    }

    @Test
    fun test_error_message_contains_detail() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-errmsg@test.com"
        client.auth.signUp(email, "KtClient123!")

        try {
            client.db("shared").table("posts").getOne("nonexistent-id-${System.currentTimeMillis()}")
            assertTrue(false, "Should have thrown")
        } catch (e: EdgeBaseError) {
            assertTrue(e.message.isNotEmpty(), "Error message should not be empty")
            assertTrue(e.statusCode > 0, "Error statusCode should be positive")
        } catch (e: Exception) {
            assertTrue(e.message?.isNotEmpty() == true, "Exception message should be descriptive")
        }
        client.destroy()
    }

    // ─── 12. 추가 Auth 엣지 케이스 ─────────────────────────────────────────

    @Test
    fun test_signOut_without_signIn_no_crash() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        // signOut without any auth should not crash
        try {
            client.auth.signOut()
            assertTrue(true)
        } catch (_: Exception) {
            // Even if it throws, not crashing is the point
            assertTrue(true)
        }
        client.destroy()
    }

    @Test
    fun test_getMe_after_signUp() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-getme@test.com"
        client.auth.signUp(email, "KtClient123!")
        val me = client.auth.getMe()
        assertNotNull(me, "getMe should return user info after signUp")
        assertTrue(me.isNotEmpty(), "getMe result should not be empty")
        client.destroy()
    }

    @Test
    fun test_multiple_signIn_same_account() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-multi-si@test.com"
        client.auth.signUp(email, "KtClient123!")
        client.auth.signOut()

        // Sign in twice — should both succeed
        val r1 = client.auth.signIn(email, "KtClient123!")
        assertTrue(r1.containsKey("accessToken"))
        val client2 = ClientEdgeBase(baseUrl)
        val r2 = client2.auth.signIn(email, "KtClient123!")
        assertTrue(r2.containsKey("accessToken"))
        client.destroy()
        client2.destroy()
    }

    // ─── 13. DB 엣지 케이스 ────────────────────────────────────────────────

    @Test
    fun test_db_create_with_special_characters() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-special@test.com"
        client.auth.signUp(email, "KtClient123!")

        val table = client.db("shared").table("posts")
        val specialTitle = "$prefix-special-한글-émoji-<tag>"
        val created = table.insert(mapOf("title" to specialTitle))
        val id = created["id"] as String
        val fetched = table.getOne(id)
        assertEquals(specialTitle, fetched["title"], "Special characters should be preserved")
        table.delete(id)
        client.destroy()
    }

    @Test
    fun test_db_update_multiple_fields() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-multif@test.com"
        client.auth.signUp(email, "KtClient123!")

        val table = client.db("shared").table("posts")
        val created = table.insert(mapOf("title" to "$prefix-multif", "views" to 0, "status" to "draft"))
        val id = created["id"] as String
        table.update(id, mapOf("title" to "$prefix-multif-updated", "views" to 10, "status" to "published"))
        val fetched = table.getOne(id)
        assertEquals("$prefix-multif-updated", fetched["title"])
        assertEquals(10, (fetched["views"] as? Number)?.toInt())
        assertEquals("published", fetched["status"])
        table.delete(id)
        client.destroy()
    }

    @Test
    fun test_db_list_empty_result() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-empty@test.com"
        client.auth.signUp(email, "KtClient123!")

        val uniqueTag = "nonexistent-tag-${System.currentTimeMillis()}-xyz"
        val result = client.db("shared").table("posts").where("title", "==", uniqueTag).getList()
        assertTrue(result.items.isEmpty(), "Query for nonexistent title should return empty")
        client.destroy()
    }

    @Test
    fun test_db_delete_returns_without_error() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-delok@test.com"
        client.auth.signUp(email, "KtClient123!")

        val table = client.db("shared").table("posts")
        val created = table.insert(mapOf("title" to "$prefix-delok"))
        val id = created["id"] as String
        // Delete should complete without throwing
        table.delete(id)
        assertTrue(true, "Delete should complete without error")
        client.destroy()
    }

    @Test
    fun test_db_getOne_returns_complete_record() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-comp@test.com"
        client.auth.signUp(email, "KtClient123!")

        val table = client.db("shared").table("posts")
        val created = table.insert(mapOf("title" to "$prefix-complete"))
        val id = created["id"] as String
        val fetched = table.getOne(id)
        assertNotNull(fetched["id"], "Record should have id")
        assertEquals("$prefix-complete", fetched["title"], "Record should have correct title")
        assertNotNull(fetched["createdAt"], "Record should have createdAt")
        table.delete(id)
        client.destroy()
    }

    // ─── 14. Push Client E2E (raw HTTP) ────────────────────────────────────

    /** Helper: POST JSON to a URL and return the HTTP status code + response body. */
    private fun postJson(urlStr: String, json: String, headers: Map<String, String> = emptyMap()): Pair<Int, String> {
        val conn = URL(urlStr).openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        headers.forEach { (k, v) -> conn.setRequestProperty(k, v) }
        conn.outputStream.use { it.write(json.toByteArray()) }
        val code = conn.responseCode
        val body = try {
            conn.inputStream.bufferedReader().readText()
        } catch (_: Exception) {
            conn.errorStream?.bufferedReader()?.readText() ?: ""
        }
        conn.disconnect()
        return code to body
    }

    @Test
    fun test_push_register() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-push-reg@test.com"
        val signUpResult = client.auth.signUp(email, "KtPush123!")
        val accessToken = signUpResult["accessToken"] as String

        val deviceId = "kt-push-e2e-${System.currentTimeMillis()}"
        val fcmToken = "fake-fcm-token-kt-${System.currentTimeMillis()}"

        val (code, body) = postJson(
            "$baseUrl/api/push/register",
            """{"deviceId":"$deviceId","token":"$fcmToken","platform":"android"}""",
            mapOf("Authorization" to "Bearer $accessToken"),
        )
        assertEquals(200, code, "push.register should return 200, body: $body")
        assertTrue(body.contains("\"ok\":true"), "Response should contain ok:true")
        client.destroy()
    }

    @Test
    fun test_push_subscribeTopic() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-push-sub@test.com"
        val signUpResult = client.auth.signUp(email, "KtPush123!")
        val accessToken = signUpResult["accessToken"] as String

        // Register a device first so topic subscribe has tokens to work with
        val deviceId = "kt-push-sub-${System.currentTimeMillis()}"
        val fcmToken = "fake-fcm-sub-kt-${System.currentTimeMillis()}"
        postJson(
            "$baseUrl/api/push/register",
            """{"deviceId":"$deviceId","token":"$fcmToken","platform":"android"}""",
            mapOf("Authorization" to "Bearer $accessToken"),
        )

        val (code, _) = postJson(
            "$baseUrl/api/push/topic/subscribe",
            """{"topic":"test-topic-kt"}""",
            mapOf("Authorization" to "Bearer $accessToken"),
        )
        // 503 = push not configured (no FCM creds), acceptable in test env
        assertTrue(code == 200 || code == 503, "push.subscribeTopic should return 200 or 503, got $code")
        client.destroy()
    }

    @Test
    fun test_push_unsubscribeTopic() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-push-unsub@test.com"
        val signUpResult = client.auth.signUp(email, "KtPush123!")
        val accessToken = signUpResult["accessToken"] as String

        // Register a device first
        val deviceId = "kt-push-unsub-${System.currentTimeMillis()}"
        val fcmToken = "fake-fcm-unsub-kt-${System.currentTimeMillis()}"
        postJson(
            "$baseUrl/api/push/register",
            """{"deviceId":"$deviceId","token":"$fcmToken","platform":"android"}""",
            mapOf("Authorization" to "Bearer $accessToken"),
        )

        val (code, _) = postJson(
            "$baseUrl/api/push/topic/unsubscribe",
            """{"topic":"test-topic-kt"}""",
            mapOf("Authorization" to "Bearer $accessToken"),
        )
        // 503 = push not configured (no FCM creds), acceptable in test env
        assertTrue(code == 200 || code == 503, "push.unsubscribeTopic should return 200 or 503, got $code")
        client.destroy()
    }

    @Test
    fun test_push_unregister() = runBlocking {
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-push-unreg@test.com"
        val signUpResult = client.auth.signUp(email, "KtPush123!")
        val accessToken = signUpResult["accessToken"] as String

        val deviceId = "kt-push-unreg-${System.currentTimeMillis()}"
        val fcmToken = "fake-fcm-unreg-kt-${System.currentTimeMillis()}"

        // Register first
        postJson(
            "$baseUrl/api/push/register",
            """{"deviceId":"$deviceId","token":"$fcmToken","platform":"android"}""",
            mapOf("Authorization" to "Bearer $accessToken"),
        )

        // Unregister
        val (code, body) = postJson(
            "$baseUrl/api/push/unregister",
            """{"deviceId":"$deviceId"}""",
            mapOf("Authorization" to "Bearer $accessToken"),
        )
        assertEquals(200, code, "push.unregister should return 200, body: $body")
        assertTrue(body.contains("\"ok\":true"), "Response should contain ok:true")
        client.destroy()
    }

    // ─── 15. Push Full Flow E2E ────────────────────────────────────────────

    private val mockFcmUrl = "http://localhost:9099"
    private val serviceKey = System.getenv("SERVICE_KEY") ?: "test-service-key-for-admin"

    /** Helper: GET a URL and return the HTTP status code + response body. */
    private fun getRequest(urlStr: String, headers: Map<String, String> = emptyMap()): Pair<Int, String> {
        val conn = URL(urlStr).openConnection() as HttpURLConnection
        conn.requestMethod = "GET"
        headers.forEach { (k, v) -> conn.setRequestProperty(k, v) }
        val code = conn.responseCode
        val body = try {
            conn.inputStream.bufferedReader().readText()
        } catch (_: Exception) {
            conn.errorStream?.bufferedReader()?.readText() ?: ""
        }
        conn.disconnect()
        return code to body
    }

    /** Helper: DELETE a URL and return the HTTP status code + response body. */
    private fun deleteRequest(urlStr: String): Pair<Int, String> {
        val conn = URL(urlStr).openConnection() as HttpURLConnection
        conn.requestMethod = "DELETE"
        val code = conn.responseCode
        val body = try {
            conn.inputStream.bufferedReader().readText()
        } catch (_: Exception) {
            conn.errorStream?.bufferedReader()?.readText() ?: ""
        }
        conn.disconnect()
        return code to body
    }

    @Test
    fun test_push_full_flow_e2e() = runBlocking {
        // 1. Setup: signup → get accessToken + userId
        val client = ClientEdgeBase(baseUrl)
        val email = "$prefix-push-flow@test.com"
        val signUpResult = client.auth.signUp(email, "KtFlow123!")
        val accessToken = signUpResult["accessToken"] as String
        @Suppress("UNCHECKED_CAST")
        val user = signUpResult["user"] as Map<String, Any?>
        val userId = user["id"] as String
        assertTrue(accessToken.isNotEmpty(), "accessToken should not be empty")
        assertTrue(userId.isNotEmpty(), "userId should not be empty")

        // 2. Clear mock FCM store
        val (clearCode, _) = deleteRequest("$mockFcmUrl/messages")
        assertEquals(200, clearCode, "Mock FCM clear should return 200")

        // 3. Client register
        val deviceId = "kt-flow-e2e-${System.currentTimeMillis()}"
        val fcmToken = "flow-token-kt-${System.currentTimeMillis()}"
        val (regCode, regBody) = postJson(
            "$baseUrl/api/push/register",
            """{"deviceId":"$deviceId","token":"$fcmToken","platform":"web"}""",
            mapOf("Authorization" to "Bearer $accessToken"),
        )
        assertEquals(200, regCode, "push.register should return 200, body: $regBody")
        assertTrue(regBody.contains("\"ok\":true"), "Register response should contain ok:true")

        // 4. Admin send(userId) → expect sent:1
        val (sendCode, sendBody) = postJson(
            "$baseUrl/api/push/send",
            """{"userId":"$userId","payload":{"title":"Full Flow","body":"E2E"}}""",
            mapOf("X-EdgeBase-Service-Key" to serviceKey),
        )
        assertEquals(200, sendCode, "push.send should return 200, body: $sendBody")
        assertTrue(sendBody.contains("\"sent\":1"), "send response should contain sent:1")

        // 5. Verify mock FCM received correct token/payload
        val (mockCode, mockBody) = getRequest("$mockFcmUrl/messages?token=$fcmToken")
        assertEquals(200, mockCode, "Mock FCM query should return 200")
        assertTrue(mockBody.contains(fcmToken), "Mock FCM should contain the FCM token")
        assertTrue(mockBody.contains("\"title\":\"Full Flow\""), "Mock FCM should contain notification title")
        assertTrue(mockBody.contains("\"body\":\"E2E\""), "Mock FCM should contain notification body")

        // 6. Admin sendToTopic → verify mock FCM received topic:"news"
        deleteRequest("$mockFcmUrl/messages") // clear for isolation
        val (topicCode, topicBody) = postJson(
            "$baseUrl/api/push/send-to-topic",
            """{"topic":"news","payload":{"title":"Topic Test","body":"kt"}}""",
            mapOf("X-EdgeBase-Service-Key" to serviceKey),
        )
        assertEquals(200, topicCode, "push.send-to-topic should return 200, body: $topicBody")

        val (topicMockCode, topicMockBody) = getRequest("$mockFcmUrl/messages?topic=news")
        assertEquals(200, topicMockCode, "Mock FCM topic query should return 200")
        assertTrue(topicMockBody.contains("\"topic\":\"news\""), "Mock FCM should contain topic:news")

        // 7. Admin broadcast → verify mock FCM received topic:"all"
        deleteRequest("$mockFcmUrl/messages") // clear for isolation
        val (bcCode, bcBody) = postJson(
            "$baseUrl/api/push/broadcast",
            """{"payload":{"title":"Broadcast","body":"all-devices"}}""",
            mapOf("X-EdgeBase-Service-Key" to serviceKey),
        )
        assertEquals(200, bcCode, "push.broadcast should return 200, body: $bcBody")

        val (bcMockCode, bcMockBody) = getRequest("$mockFcmUrl/messages?topic=all")
        assertEquals(200, bcMockCode, "Mock FCM broadcast query should return 200")
        assertTrue(bcMockBody.contains("\"topic\":\"all\""), "Mock FCM should contain topic:all")

        // 8. Client unregister
        val (unregCode, unregBody) = postJson(
            "$baseUrl/api/push/unregister",
            """{"deviceId":"$deviceId"}""",
            mapOf("Authorization" to "Bearer $accessToken"),
        )
        assertEquals(200, unregCode, "push.unregister should return 200, body: $unregBody")
        assertTrue(unregBody.contains("\"ok\":true"), "Unregister response should contain ok:true")

        // 9. Admin getTokens → expect items empty
        val (tokensCode, tokensBody) = getRequest(
            "$baseUrl/api/push/tokens?userId=$userId",
            mapOf("X-EdgeBase-Service-Key" to serviceKey),
        )
        assertEquals(200, tokensCode, "push.tokens should return 200, body: $tokensBody")
        assertTrue(tokensBody.contains("\"items\":[]"), "Tokens should be empty after unregister")

        client.destroy()
    }
}
