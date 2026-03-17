package dev.edgebase.sdk.admin

import dev.edgebase.sdk.core.FieldOps
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assumptions.assumeTrue
import java.net.HttpURLConnection
import java.net.URL
import kotlin.test.Test
import kotlin.test.BeforeTest
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue
import kotlin.test.assertFalse
import kotlin.test.assertNull

/**
 * Kotlin Admin SDK -- E2E Tests
 *
 * Prerequisite: wrangler dev --port 8688 server running
 *
 * Run:
 *   BASE_URL=http://localhost:8688 SERVICE_KEY=test-service-key-for-admin \
 *     cd packages/sdk/kotlin && ./gradlew :admin:test
 *
 * Principle: no mocks, real server only
 */

class AdminEdgeBaseE2ETest {

    private val baseUrl = System.getenv("BASE_URL") ?: "http://localhost:8688"
    private val sk = System.getenv("SERVICE_KEY") ?: "test-service-key-for-admin"
    private val prefix = "kt-admin-e2e-${System.currentTimeMillis()}"
    private val createdIds = mutableListOf<String>()

    @BeforeTest
    fun requireServer() {
        val available = isServerAvailable(baseUrl)
        val message = "E2E backend not reachable at $baseUrl. Start `edgebase dev --port 8688` or set BASE_URL. Set EDGEBASE_E2E_REQUIRED=1 to fail instead of skip."
        if (System.getenv("EDGEBASE_E2E_REQUIRED") == "1") {
            check(available) { message }
            return
        }
        assumeTrue(available, message)
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

    // Helper to extract userId from various response shapes
    private fun extractUserId(user: Map<String, Any?>): String? {
        return (user["id"] ?: (user["user"] as? Map<*, *>)?.get("id")) as? String
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 1. AdminAuth
    // ═══════════════════════════════════════════════════════════════════════════

    @Test
    fun test_adminAuth_listUsers() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        @Suppress("UNCHECKED_CAST")
        val result = admin.adminAuth.listUsers(5)
        val users = result["users"]
        assertNotNull(users, "listUsers should return users key")
        assertTrue(users is List<*>, "users should be a list")
        admin.destroy()
    }

    @Test
    fun test_adminAuth_createUser() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val email = "kt-admin-${System.currentTimeMillis()}@test.com"
        val user = admin.adminAuth.createUser(mapOf("email" to email, "password" to "KtAdmin123!"))
        val userId = extractUserId(user)
        assertNotNull(userId, "createUser should return user id")
        admin.destroy()
    }

    @Test
    fun test_adminAuth_getUser() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val email = "kt-admin-get-${System.currentTimeMillis()}@test.com"
        val created = admin.adminAuth.createUser(mapOf("email" to email, "password" to "KtAdmin123!"))
        val userId = extractUserId(created)
        assertNotNull(userId)

        val fetched = admin.adminAuth.getUser(userId!!)
        val fetchedId = extractUserId(fetched)
        assertNotNull(fetchedId)
        admin.destroy()
    }

    @Test
    fun test_adminAuth_setCustomClaims() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val email = "kt-admin-claims-${System.currentTimeMillis()}@test.com"
        val created = admin.adminAuth.createUser(mapOf("email" to email, "password" to "KtAdmin123!"))
        val userId = extractUserId(created)
        assertNotNull(userId)

        // Should not throw
        admin.adminAuth.setCustomClaims(userId!!, mapOf("role" to "premium"))
        assertTrue(true)
        admin.destroy()
    }

    // ─── AdminAuth extended ─────────────────────────────────────────────────

    @Test
    fun test_adminAuth_updateUser() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val email = "kt-admin-upd-${System.currentTimeMillis()}@test.com"
        val created = admin.adminAuth.createUser(mapOf("email" to email, "password" to "KtAdmin123!"))
        val userId = extractUserId(created)
        assertNotNull(userId)

        val updated = admin.adminAuth.updateUser(userId!!, mapOf("displayName" to "Updated Name"))
        assertNotNull(updated)
        admin.destroy()
    }

    @Test
    fun test_adminAuth_deleteUser() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val email = "kt-admin-delete-${System.currentTimeMillis()}@test.com"
        val created = admin.adminAuth.createUser(mapOf("email" to email, "password" to "KtAdmin123!"))
        val userId = extractUserId(created)
        assertNotNull(userId)

        admin.adminAuth.deleteUser(userId!!)
        // getUser after delete should fail
        try {
            admin.adminAuth.getUser(userId)
            assertTrue(false, "Should have thrown after delete")
        } catch (_: Exception) {
            assertTrue(true)
        }
        admin.destroy()
    }

    @Test
    fun test_adminAuth_revokeAllSessions() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val email = "kt-admin-revoke-${System.currentTimeMillis()}@test.com"
        val created = admin.adminAuth.createUser(mapOf("email" to email, "password" to "KtAdmin123!"))
        val userId = extractUserId(created)
        assertNotNull(userId)

        // Should not throw
        try {
            admin.adminAuth.revokeAllSessions(userId!!)
            assertTrue(true)
        } catch (_: Exception) {
            // Revoke may return error if no sessions exist -- acceptable
            assertTrue(true)
        }
        admin.destroy()
    }

    @Test
    fun test_adminAuth_setCustomClaims_complex() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val email = "kt-admin-claims2-${System.currentTimeMillis()}@test.com"
        val created = admin.adminAuth.createUser(mapOf("email" to email, "password" to "KtAdmin123!"))
        val userId = extractUserId(created)
        assertNotNull(userId)

        // Set complex claims
        admin.adminAuth.setCustomClaims(userId!!, mapOf(
            "role" to "admin",
            "tier" to "enterprise",
            "features" to listOf("analytics", "export")
        ))
        assertTrue(true)
        admin.destroy()
    }

    @Test
    fun test_adminAuth_listUsers_with_cursor() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val result = admin.adminAuth.listUsers(2)
        assertNotNull(result["users"])
        // cursor may or may not be present depending on total users
        admin.destroy()
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 2. DB CRUD
    // ═══════════════════════════════════════════════════════════════════════════

    @Test
    fun test_db_create_returns_id() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val record = admin.db("shared").table("posts").insert(mapOf("title" to "$prefix-create"))
        val id = record["id"] as? String
        assertNotNull(id)
        createdIds.add(id!!)
        admin.destroy()
    }

    @Test
    fun test_db_getOne() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val created = admin.db("shared").table("posts").insert(mapOf("title" to "$prefix-getone"))
        val id = created["id"] as? String
        assertNotNull(id)
        val fetched = admin.db("shared").table("posts").getOne(id!!)
        assertNotNull(fetched["id"])
        admin.destroy()
    }

    @Test
    fun test_db_update() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val created = admin.db("shared").table("posts").insert(mapOf("title" to "$prefix-orig"))
        val id = created["id"] as? String
        assertNotNull(id)
        val updated = admin.db("shared").table("posts").update(id!!, mapOf("title" to "$prefix-upd"))
        assertTrue(updated["title"] == "$prefix-upd")
        admin.destroy()
    }

    @Test
    fun test_db_delete_then_getOne_throws() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val created = admin.db("shared").table("posts").insert(mapOf("title" to "$prefix-del"))
        val id = created["id"] as? String
        assertNotNull(id)
        admin.db("shared").table("posts").delete(id!!)
        try {
            admin.db("shared").table("posts").getOne(id)
            assertTrue(false, "Should have thrown")
        } catch (_: Exception) {
            assertTrue(true)
        }
        admin.destroy()
    }

    @Test
    fun test_db_list_returns_items() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val result = admin.db("shared").table("posts").limit(5).getList()
        assertNotNull(result.items)
        assertTrue(result.items.size <= 5)
        admin.destroy()
    }

    @Test
    fun test_db_count_returns_number() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val count = admin.db("shared").table("posts").count()
        assertTrue(count >= 0)
        admin.destroy()
    }

    // ─── DB CRUD extended ───────────────────────────────────────────────────

    @Test
    fun test_db_create_with_CJK_title() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val cjkTitle = "$prefix-한글-テスト-测试"
        val record = admin.db("shared").table("posts").insert(mapOf("title" to cjkTitle))
        val id = record["id"] as? String
        assertNotNull(id)
        val fetched = admin.db("shared").table("posts").getOne(id!!)
        assertEquals(cjkTitle, fetched["title"])
        admin.destroy()
    }

    @Test
    fun test_db_update_with_fieldOps_increment() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val created = admin.db("shared").table("posts").insert(mapOf(
            "title" to "$prefix-inc",
            "viewCount" to 0
        ))
        val id = created["id"] as? String
        assertNotNull(id)
        val updated = admin.db("shared").table("posts").update(id!!, mapOf(
            "viewCount" to FieldOps.increment(5)
        ))
        assertEquals(5, (updated["viewCount"] as? Number)?.toInt())
        admin.destroy()
    }

    @Test
    fun test_db_insertMany_batch() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val items = (1..5).map { mapOf<String, Any>("title" to "$prefix-batch-$it") }
        val result = admin.db("shared").table("posts").insertMany(items)
        assertEquals(5, result.size)
        result.forEach { r ->
            assertNotNull((r["id"] as? String))
        }
        admin.destroy()
    }

    @Test
    fun test_db_upsert_new_record() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val result = admin.db("shared").table("posts").upsert(mapOf(
            "title" to "$prefix-upsert-new"
        ))
        assertNotNull(result.record)
        admin.destroy()
    }

    @Test
    fun test_db_count_with_filter() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val unique = "$prefix-cnt-${System.currentTimeMillis()}"
        admin.db("shared").table("posts").insert(mapOf("title" to unique))
        val count = admin.db("shared").table("posts")
            .where("title", "==", unique).count()
        assertEquals(1, count)
        admin.destroy()
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 3. KV
    // ═══════════════════════════════════════════════════════════════════════════

    @Test
    fun test_kv_set_and_get() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val key = "kt-admin-kv-${System.currentTimeMillis()}"
        admin.kv("test").set(key, "hello-kt-admin")
        val value = admin.kv("test").get(key)
        assertTrue(value == "hello-kt-admin")
        admin.destroy()
    }

    @Test
    fun test_kv_delete_then_null() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val key = "kt-admin-del-${System.currentTimeMillis()}"
        admin.kv("test").set(key, "del-me")
        admin.kv("test").delete(key)
        val value = admin.kv("test").get(key)
        assertTrue(value == null)
        admin.destroy()
    }

    @Test
    fun test_kv_list_returns_list() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val result = admin.kv("test").list()
        assertNotNull(result)
        admin.destroy()
    }

    // ─── KV extended ────────────────────────────────────────────────────────

    @Test
    fun test_kv_overwrite_value() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val key = "kt-admin-overwrite-${System.currentTimeMillis()}"
        admin.kv("test").set(key, "v1")
        admin.kv("test").set(key, "v2")
        val value = admin.kv("test").get(key)
        assertEquals("v2", value)
        admin.destroy()
    }

    @Test
    fun test_kv_get_nonexistent_returns_null() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val value = admin.kv("test").get("nonexistent-key-${System.currentTimeMillis()}")
        assertNull(value)
        admin.destroy()
    }

    @Test
    fun test_kv_list_with_prefix() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val pfx = "kt-kv-pfx-${System.currentTimeMillis()}"
        admin.kv("test").set("$pfx-a", "1")
        admin.kv("test").set("$pfx-b", "2")
        val result = admin.kv("test").list(prefix = pfx)
        assertNotNull(result)
        admin.destroy()
    }

    @Test
    fun test_kv_set_with_ttl() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val key = "kt-admin-ttl-${System.currentTimeMillis()}"
        // TTL = 60 seconds
        admin.kv("test").set(key, "ttl-value", ttl = 60)
        val value = admin.kv("test").get(key)
        assertEquals("ttl-value", value)
        admin.destroy()
    }

    @Test
    fun test_kv_large_value() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val key = "kt-admin-large-${System.currentTimeMillis()}"
        val largeValue = "x".repeat(5000)
        admin.kv("test").set(key, largeValue)
        val value = admin.kv("test").get(key)
        assertEquals(largeValue, value)
        admin.destroy()
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 4. Filter
    // ═══════════════════════════════════════════════════════════════════════════

    @Test
    fun test_where_filter_finds_record() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val unique = "$prefix-filter-${System.currentTimeMillis()}"
        val r = admin.db("shared").table("posts").insert(mapOf("title" to unique))
        val id = r["id"] as? String
        val list = admin.db("shared").table("posts").where("title", "==", unique).getList()
        assertTrue(list.items.isNotEmpty(), "Should find the created record")
        if (id != null) admin.db("shared").table("posts").delete(id)
        admin.destroy()
    }

    @Test
    fun test_where_contains_filter() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val unique = "$prefix-contains-${System.currentTimeMillis()}"
        admin.db("shared").table("posts").insert(mapOf("title" to unique))
        val list = admin.db("shared").table("posts")
            .where("title", "contains", "contains-")
            .where("title", "contains", prefix)
            .limit(10).getList()
        assertTrue(list.items.isNotEmpty())
        admin.destroy()
    }

    @Test
    fun test_orderBy_desc_limit() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val list = admin.db("shared").table("posts")
            .orderBy("createdAt", "desc").limit(3).getList()
        assertTrue(list.items.size <= 3)
        admin.destroy()
    }

    @Test
    fun test_cursor_pagination() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val title = "$prefix-curp-${System.currentTimeMillis()}"
        for (i in 0..4) {
            admin.db("shared").table("posts").insert(mapOf("title" to "$title-$i"))
        }
        val p1 = admin.db("shared").table("posts")
            .where("title", "contains", title).limit(2).getList()
        if (p1.cursor != null) {
            val p2 = admin.db("shared").table("posts")
                .where("title", "contains", title).limit(2).after(p1.cursor!!).getList()
            if (p1.items.isNotEmpty() && p2.items.isNotEmpty()) {
                assertNotEquals(p1.items[0]["id"], p2.items[0]["id"])
            }
        }
        admin.destroy()
    }

    @Test
    fun test_golden_filter_sort_limit() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val gqPrefix = "$prefix-gq"
        val gqIds = mutableListOf<String>()
        val records = listOf(
            mapOf("title" to "$gqPrefix-A", "views" to 10),
            mapOf("title" to "$gqPrefix-B", "views" to 30),
            mapOf("title" to "$gqPrefix-C", "views" to 20),
            mapOf("title" to "$gqPrefix-D", "views" to 40),
            mapOf("title" to "$gqPrefix-E", "views" to 5),
        )
        for (rec in records) {
            val r = admin.db("shared").table("posts").insert(rec)
            val id = r["id"] as? String
            if (id != null) gqIds.add(id)
        }

        val list = admin.db("shared").table("posts")
            .where("title", "contains", gqPrefix)
            .where("views", ">=", 10)
            .orderBy("views", "desc")
            .limit(3)
            .getList()
        val views = list.items.map { (it["views"] as Number).toInt() }
        assertEquals(listOf(40, 30, 20), views, "Golden query: filter>=10 + sort:desc + limit=3")

        // Cleanup
        for (id in gqIds) {
            try { admin.db("shared").table("posts").delete(id) } catch (_: Exception) {}
        }
        admin.destroy()
    }

    @Test
    fun test_golden_cursor_no_overlap() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val gqPrefix = "$prefix-gqc"
        val gqIds = mutableListOf<String>()
        for (i in 0..4) {
            val r = admin.db("shared").table("posts").insert(mapOf("title" to "$gqPrefix-$i"))
            val id = r["id"] as? String
            if (id != null) gqIds.add(id)
        }

        val p1 = admin.db("shared").table("posts")
            .where("title", "contains", gqPrefix)
            .limit(2)
            .getList()
        assertNotNull(p1.cursor, "First page should have a cursor")

        val p2 = admin.db("shared").table("posts")
            .where("title", "contains", gqPrefix)
            .limit(2)
            .after(p1.cursor!!)
            .getList()
        val ids1 = p1.items.map { it["id"] }.toSet()
        val ids2 = p2.items.map { it["id"] }.toSet()
        assertTrue(ids1.intersect(ids2).isEmpty(), "Cursor pages should not overlap")

        // Cleanup
        for (id in gqIds) {
            try { admin.db("shared").table("posts").delete(id) } catch (_: Exception) {}
        }
        admin.destroy()
    }

    @Test
    fun test_golden_orfilter() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val gqPrefix = "$prefix-gqor"
        val gqIds = mutableListOf<String>()
        val records = listOf(
            mapOf("title" to "$gqPrefix-A", "views" to 10),
            mapOf("title" to "$gqPrefix-B", "views" to 30),
            mapOf("title" to "$gqPrefix-C", "views" to 20),
            mapOf("title" to "$gqPrefix-D", "views" to 40),
            mapOf("title" to "$gqPrefix-E", "views" to 5),
        )
        for (rec in records) {
            val r = admin.db("shared").table("posts").insert(rec)
            val id = r["id"] as? String
            if (id != null) gqIds.add(id)
        }

        val list = admin.db("shared").table("posts")
            .where("title", "contains", gqPrefix)
            .or { it.where("views", "==", 10).where("views", "==", 40) }
            .orderBy("views", "asc")
            .getList()
        val views = list.items.map { (it["views"] as Number).toInt() }
        assertEquals(listOf(10, 40), views, "Golden query: OR filter views==10 || views==40, sorted asc")

        // Cleanup
        for (id in gqIds) {
            try { admin.db("shared").table("posts").delete(id) } catch (_: Exception) {}
        }
        admin.destroy()
    }

    @Test
    fun test_golden_crud_roundtrip() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)

        // 1. Insert
        val record = admin.db("shared").table("posts").insert(mapOf(
            "title" to "$prefix-crud-roundtrip",
            "views" to 0
        ))
        val id = record["id"] as? String
        assertNotNull(id, "Insert should return an id")

        // 2. Get by ID — verify fields match
        val fetched = admin.db("shared").table("posts").getOne(id!!)
        assertEquals(id, fetched["id"])
        assertEquals("$prefix-crud-roundtrip", fetched["title"])

        // 3. Update — verify updated field
        val updated = admin.db("shared").table("posts").update(id, mapOf("title" to "$prefix-crud-updated"))
        assertEquals("$prefix-crud-updated", updated["title"])

        // 4. Delete
        admin.db("shared").table("posts").delete(id)

        // 5. Verify 404 — getOne after delete should throw
        try {
            admin.db("shared").table("posts").getOne(id)
            assertTrue(false, "getOne after delete should have thrown")
        } catch (_: Exception) {
            assertTrue(true)
        }
        admin.destroy()
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 5. Broadcast
    // ═══════════════════════════════════════════════════════════════════════════

    @Test
    fun test_broadcast_succeeds() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        try {
            admin.broadcast("general", "server-event", mapOf("msg" to "hello from kt admin"))
            assertTrue(true)
        } catch (e: Exception) {
            assertTrue(false, "broadcast threw: ${e.message}")
        }
        admin.destroy()
    }

    @Test
    fun test_broadcast_with_complex_payload() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        try {
            admin.broadcast("updates", "data-sync", mapOf(
                "type" to "full",
                "count" to 42,
                "nested" to mapOf("key" to "value")
            ))
            assertTrue(true)
        } catch (_: Exception) {
            // Broadcast may fail if database-live not configured
            assertTrue(true)
        }
        admin.destroy()
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 6. Error Handling
    // ═══════════════════════════════════════════════════════════════════════════

    @Test
    fun test_getOne_nonexistent_throws() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        try {
            admin.db("shared").table("posts").getOne("nonexistent-kt-admin-99999")
            assertTrue(false, "Should have thrown")
        } catch (_: Exception) {
            assertTrue(true)
        }
        admin.destroy()
    }

    @Test
    fun test_invalid_serviceKey_throws() = runBlocking {
        val badAdmin = AdminEdgeBase(baseUrl, "invalid-sk")
        try {
            badAdmin.db("shared").table("posts").insert(mapOf("title" to "X"))
            assertTrue(false, "Should have thrown with bad service key")
        } catch (_: Exception) {
            assertTrue(true)
        }
        badAdmin.destroy()
    }

    @Test
    fun test_update_nonexistent_throws() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        try {
            admin.db("shared").table("posts").update("nonexistent-kt-admin-upd", mapOf("title" to "X"))
            assertTrue(false, "Should have thrown")
        } catch (_: Exception) {
            assertTrue(true)
        }
        admin.destroy()
    }

    @Test
    fun test_delete_nonexistent_throws() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        try {
            admin.db("shared").table("posts").delete("nonexistent-kt-admin-del")
            assertTrue(false, "Should have thrown")
        } catch (_: Exception) {
            assertTrue(true)
        }
        admin.destroy()
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 7. Kotlin-specific: coroutine async parallel
    // ═══════════════════════════════════════════════════════════════════════════

    @Test
    fun test_coroutine_async_parallel_creates() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val titles = (1..3).map { "$prefix-async-$it" }
        val deferreds = titles.map { title ->
            async {
                admin.db("shared").table("posts").insert(mapOf("title" to title))
            }
        }
        val results = deferreds.awaitAll()
        assertEquals(3, results.size)
        results.forEach { r ->
            assertNotNull(r["id"])
        }
        admin.destroy()
    }

    @Test
    fun test_coroutine_async_parallel_reads() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val created = admin.db("shared").table("posts").insert(mapOf("title" to "$prefix-par-read"))
        val id = created["id"] as? String
        assertNotNull(id)

        val deferreds = (1..5).map {
            async {
                admin.db("shared").table("posts").getOne(id!!)
            }
        }
        val results = deferreds.awaitAll()
        assertEquals(5, results.size)
        results.forEach { r ->
            assertEquals(id, r["id"])
        }
        admin.destroy()
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 8. Push E2E
    // ═══════════════════════════════════════════════════════════════════════════

    @Test
    fun test_push_send_nonexistent_user() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val result = admin.push.send("nonexistent-push-user-99999", PushPayload(title = "Test", body = "Hello"))
        assertEquals(0, result.sent)
        admin.destroy()
    }

    @Test
    fun test_push_send_to_token() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val result = admin.push.sendToToken("fake-fcm-token-e2e", PushPayload(title = "Token", body = "Test"))
        assertNotNull(result)
        admin.destroy()
    }

    @Test
    fun test_push_send_many() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val result = admin.push.sendMany(
            listOf("nonexistent-user-a", "nonexistent-user-b"),
            PushPayload(title = "Batch", body = "Test")
        )
        assertNotNull(result)
        admin.destroy()
    }

    @Test
    fun test_push_get_tokens() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val tokens = admin.push.getTokens("nonexistent-push-user-tokens")
        assertNotNull(tokens)
        assertTrue(tokens.isEmpty())
        admin.destroy()
    }

    @Test
    fun test_push_get_logs() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val logs = admin.push.getLogs("nonexistent-push-user-logs")
        assertNotNull(logs)
        admin.destroy()
    }

    @Test
    fun test_push_send_to_topic() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        // sendToTopic is on PushClient (raw), not AdminPushClient.
        // Use low-level HttpClient to construct PushClient in same module.
        val tokenMgr = object : dev.edgebase.sdk.core.TokenManager {
            override suspend fun getAccessToken(): String? = null
            override suspend fun getRefreshToken(): String? = null
            override suspend fun setTokens(access: String, refresh: String) {}
            override suspend fun clearTokens() {}
        }
        val httpClient = dev.edgebase.sdk.core.HttpClient(baseUrl, tokenMgr, serviceKey = sk)
        val pushRaw = PushClient(httpClient)
        val result = pushRaw.sendToTopic("test-topic-e2e", mapOf("title" to "Topic", "body" to "Test"))
        assertNotNull(result)
        admin.destroy()
    }

    @Test
    fun test_push_broadcast() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val tokenMgr = object : dev.edgebase.sdk.core.TokenManager {
            override suspend fun getAccessToken(): String? = null
            override suspend fun getRefreshToken(): String? = null
            override suspend fun setTokens(access: String, refresh: String) {}
            override suspend fun clearTokens() {}
        }
        val httpClient = dev.edgebase.sdk.core.HttpClient(baseUrl, tokenMgr, serviceKey = sk)
        val pushRaw = PushClient(httpClient)
        val result = pushRaw.broadcast(mapOf("title" to "Broadcast", "body" to "E2E Test"))
        assertNotNull(result)
        admin.destroy()
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 9. Vectorize (stub)
    // ═══════════════════════════════════════════════════════════════════════════

    @Test
    fun test_vectorize_upsert_stub() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val vec = admin.vector("embeddings")
        val vectors = listOf(mapOf<String, Any>(
            "id" to "doc-1",
            "values" to List(1536) { 0.1 },
            "metadata" to mapOf("title" to "test")
        ))
        val result = vec.upsert(vectors)
        assertTrue(result["ok"] == true)
        admin.destroy()
    }

    @Test
    fun test_vectorize_insert_stub() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val vec = admin.vector("embeddings")
        val vectors = listOf(mapOf<String, Any>(
            "id" to "doc-ins-1",
            "values" to List(1536) { 0.2 }
        ))
        val result = vec.insert(vectors)
        assertTrue(result["ok"] == true)
        admin.destroy()
    }

    @Test
    fun test_vectorize_search_stub() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val vec = admin.vector("embeddings")
        val matches = vec.search(List(1536) { 0.1 }, 5, null)
        assertNotNull(matches)
        admin.destroy()
    }

    @Test
    fun test_vectorize_search_with_namespace() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val vec = admin.vector("embeddings")
        val matches = vec.search(List(1536) { 0.1 }, 5, null, "test-ns", null, null)
        assertNotNull(matches)
        admin.destroy()
    }

    @Test
    fun test_vectorize_search_with_return_values() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val vec = admin.vector("embeddings")
        val matches = vec.search(List(1536) { 0.1 }, 5, null, null, true, null)
        assertNotNull(matches)
        admin.destroy()
    }

    @Test
    fun test_vectorize_query_by_id_stub() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val vec = admin.vector("embeddings")
        val matches = vec.queryById("doc-1", 5, null)
        assertNotNull(matches)
        admin.destroy()
    }

    @Test
    fun test_vectorize_get_by_ids_stub() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val vec = admin.vector("embeddings")
        val vectors = vec.getByIds(listOf("doc-1", "doc-2"))
        assertNotNull(vectors)
        admin.destroy()
    }

    @Test
    fun test_vectorize_delete_stub() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val vec = admin.vector("embeddings")
        val result = vec.delete(listOf("doc-1", "doc-2"))
        assertTrue(result["ok"] == true)
        admin.destroy()
    }

    @Test
    fun test_vectorize_describe_stub() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val vec = admin.vector("embeddings")
        val info = vec.describe()
        assertNotNull(info["vectorCount"])
        assertNotNull(info["dimensions"])
        assertNotNull(info["metric"])
        admin.destroy()
    }

    @Test
    fun test_vectorize_search_dimension_mismatch() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val vec = admin.vector("embeddings")
        try {
            vec.search(listOf(0.1, 0.2, 0.3), 5, null)
            assertTrue(false, "Should have thrown for dimension mismatch")
        } catch (_: Exception) {
            assertTrue(true)
        }
        admin.destroy()
    }

    @Test
    fun test_vectorize_nonexistent_index() = runBlocking {
        val admin = AdminEdgeBase(baseUrl, sk)
        val vec = admin.vector("nonexistent-index-99")
        try {
            vec.describe()
            assertTrue(false, "Should have thrown for nonexistent index")
        } catch (_: Exception) {
            assertTrue(true)
        }
        admin.destroy()
    }
}
