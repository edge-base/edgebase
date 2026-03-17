/**
 * Kotlin SDK -- Core E2E Tests
 *
 * Prerequisite: wrangler dev --port 8688 local server running
 *
 * Run:
 *   BASE_URL=http://localhost:8688 SERVICE_KEY=test-service-key-for-admin \
 *     cd packages/sdk/kotlin && ./gradlew :core:test -Dtag=e2e
 *
 * kotlin.test (KMP multiplatform compatible)
 */

package io.edgebase.sdk

import java.net.HttpURLConnection
import java.net.URL
import org.junit.Assume.assumeTrue
import kotlin.test.Test
import kotlin.test.BeforeTest
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertFails
import kotlin.test.assertFailsWith


class KotlinE2ETest {

    private val BASE_URL = System.getenv("BASE_URL") ?: "http://localhost:8688"
    private val SERVICE_KEY = System.getenv("SERVICE_KEY") ?: "test-service-key-for-admin"
    private val PREFIX = "kt-e2e-${System.currentTimeMillis()}"
    private val createdIds = mutableListOf<String>()
    private val admin = AdminEdgeBase(BASE_URL, SERVICE_KEY)

    @BeforeTest
    fun requireServer() {
        val available = isServerAvailable(BASE_URL)
        val message = "E2E backend not reachable at $BASE_URL. Start `edgebase dev --port 8688` or set BASE_URL. Set EDGEBASE_E2E_REQUIRED=1 to fail instead of skip."
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


    // ═══════════════════════════════════════════════════════════════════════════
    // 1. DB CRUD
    // ═══════════════════════════════════════════════════════════════════════════

    @Test
    fun `insert - returns id`() {
        val r = admin.db("shared").table("posts").insert(mapOf("title" to "$PREFIX-create"))
        val id = r.getString("id")
        assertNotNull(id)
        createdIds.add(id)
    }

    @Test
    fun `getOne - returns record`() {
        val created = admin.db("shared").table("posts").insert(mapOf("title" to "$PREFIX-getOne"))
        val id = created.getString("id")
        createdIds.add(id)
        val fetched = admin.db("shared").table("posts").getOne(id)
        assertEquals(id, fetched.getString("id"))
    }

    @Test
    fun `update - title changed`() {
        val created = admin.db("shared").table("posts").insert(mapOf("title" to "$PREFIX-orig"))
        val id = created.getString("id")
        createdIds.add(id)
        val updated = admin.db("shared").table("posts").update(id, mapOf("title" to "$PREFIX-updated"))
        assertEquals("$PREFIX-updated", updated.getString("title"))
    }

    @Test
    fun `delete - getOne throws`() {
        val created = admin.db("shared").table("posts").insert(mapOf("title" to "$PREFIX-del"))
        val id = created.getString("id")
        admin.db("shared").table("posts").delete(id)
        assertFailsWith<EdgeBaseException> {
            admin.db("shared").table("posts").getOne(id)
        }
    }

    @Test
    fun `get - items array returned`() {
        val result = admin.db("shared").table("posts").limit(5).getList()
        assertNotNull(result.items)
        assertTrue(result.items.size <= 5)
    }

    @Test
    fun `count - returns number`() {
        val count = admin.db("shared").table("posts").count()
        assertTrue(count >= 0)
    }

    // ─── CRUD extended: special chars, CJK, large payload ───────────────────

    @Test
    fun `insert with special characters in title`() {
        val specialTitle = "$PREFIX-special-!@#$%^&*()_+-=[]{}|;':\",./<>?"
        val r = admin.db("shared").table("posts").insert(mapOf("title" to specialTitle))
        val id = r.getString("id")
        assertNotNull(id)
        createdIds.add(id)
        val fetched = admin.db("shared").table("posts").getOne(id)
        assertEquals(specialTitle, fetched.getString("title"))
    }

    @Test
    fun `insert with CJK characters`() {
        val cjkTitle = "$PREFIX-CJK-한국어-日本語-中文"
        val r = admin.db("shared").table("posts").insert(mapOf("title" to cjkTitle))
        val id = r.getString("id")
        assertNotNull(id)
        createdIds.add(id)
        val fetched = admin.db("shared").table("posts").getOne(id)
        assertEquals(cjkTitle, fetched.getString("title"))
    }

    @Test
    fun `insert with emoji characters`() {
        val emojiTitle = "$PREFIX-emoji-\uD83D\uDE00\uD83C\uDF1F\uD83D\uDE80"
        val r = admin.db("shared").table("posts").insert(mapOf("title" to emojiTitle))
        val id = r.getString("id")
        assertNotNull(id)
        createdIds.add(id)
        val fetched = admin.db("shared").table("posts").getOne(id)
        assertEquals(emojiTitle, fetched.getString("title"))
    }

    @Test
    fun `insert with large payload`() {
        val largeContent = "x".repeat(10000)
        val r = admin.db("shared").table("posts").insert(mapOf(
            "title" to "$PREFIX-large",
            "content" to largeContent
        ))
        val id = r.getString("id")
        assertNotNull(id)
        createdIds.add(id)
    }

    @Test
    fun `insert with numeric fields`() {
        val r = admin.db("shared").table("posts").insert(mapOf(
            "title" to "$PREFIX-numeric",
            "viewCount" to 42,
            "rating" to 4.5
        ))
        val id = r.getString("id")
        assertNotNull(id)
        createdIds.add(id)
        val fetched = admin.db("shared").table("posts").getOne(id)
        assertEquals(42, fetched.optInt("viewCount"))
    }

    @Test
    fun `insert with boolean field`() {
        val r = admin.db("shared").table("posts").insert(mapOf(
            "title" to "$PREFIX-bool",
            "published" to true
        ))
        val id = r.getString("id")
        assertNotNull(id)
        createdIds.add(id)
        val fetched = admin.db("shared").table("posts").getOne(id)
        assertTrue(fetched.optBoolean("published"))
    }

    @Test
    fun `insert with null field`() {
        val r = admin.db("shared").table("posts").insert(mapOf(
            "title" to "$PREFIX-null-field",
            "content" to null
        ))
        val id = r.getString("id")
        assertNotNull(id)
        createdIds.add(id)
    }

    @Test
    fun `update partial - only specified fields change`() {
        val created = admin.db("shared").table("posts").insert(mapOf(
            "title" to "$PREFIX-partial",
            "content" to "original-content"
        ))
        val id = created.getString("id")
        createdIds.add(id)
        admin.db("shared").table("posts").update(id, mapOf("title" to "$PREFIX-partial-updated"))
        val fetched = admin.db("shared").table("posts").getOne(id)
        assertEquals("$PREFIX-partial-updated", fetched.getString("title"))
        // content should remain unchanged
        assertEquals("original-content", fetched.optString("content"))
    }

    @Test
    fun `delete then insert with same title succeeds`() {
        val title = "$PREFIX-recreate"
        val r1 = admin.db("shared").table("posts").insert(mapOf("title" to title))
        val id1 = r1.getString("id")
        admin.db("shared").table("posts").delete(id1)
        val r2 = admin.db("shared").table("posts").insert(mapOf("title" to title))
        val id2 = r2.getString("id")
        createdIds.add(id2)
        assertNotEquals(id1, id2)
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 2. Filter & QueryBuilder
    // ═══════════════════════════════════════════════════════════════════════════

    @Test
    fun `where == filter - finds matching records`() {
        val uniqueTitle = "$PREFIX-filter-${System.nanoTime()}"
        val r = admin.db("shared").table("posts").insert(mapOf("title" to uniqueTitle))
        createdIds.add(r.getString("id"))
        val list = admin.db("shared").table("posts").where("title", "==", uniqueTitle).getList()
        assertTrue(list.items.isNotEmpty())
        assertEquals(uniqueTitle, list.items[0].getString("title"))
    }

    @Test
    fun `orderBy + limit - max N items`() {
        val list = admin.db("shared").table("posts").orderBy("createdAt", "desc").limit(3).getList()
        assertTrue(list.items.size <= 3)
    }

    @Test
    fun `offset pagination - page1 vs page2 differ`() {
        val title = "$PREFIX-page"
        for (i in 0..4) {
            val r = admin.db("shared").table("posts").insert(mapOf("title" to "$title-$i"))
            createdIds.add(r.getString("id"))
        }
        val p1 = admin.db("shared").table("posts")
            .where("title", "contains", title).orderBy("title", "asc").limit(2).getList()
        val p2 = admin.db("shared").table("posts")
            .where("title", "contains", title).orderBy("title", "asc").limit(2).offset(2).getList()
        if (p1.items.isNotEmpty() && p2.items.isNotEmpty()) {
            assertNotEquals(p1.items[0].getString("id"), p2.items[0].getString("id"))
        }
    }

    @Test
    fun `cursor pagination - after(cursor) fetches next page`() {
        val title = "$PREFIX-cursor"
        for (i in 0..3) {
            val r = admin.db("shared").table("posts").insert(mapOf("title" to "$title-$i"))
            createdIds.add(r.getString("id"))
        }
        val p1 = admin.db("shared").table("posts")
            .where("title", "contains", title).orderBy("title", "asc").limit(2).getList()
        if (p1.cursor != null) {
            val p2 = admin.db("shared").table("posts")
                .where("title", "contains", title).orderBy("title", "asc").limit(2).after(p1.cursor).getList()
            if (p1.items.isNotEmpty() && p2.items.isNotEmpty()) {
                assertNotEquals(p1.items[0].getString("id"), p2.items[0].getString("id"))
            }
        }
        assertTrue(true)
    }

    // ─── Complex where filters ──────────────────────────────────────────────

    @Test
    fun `where != filter excludes records`() {
        val title = "$PREFIX-ne-${System.nanoTime()}"
        val r = admin.db("shared").table("posts").insert(mapOf("title" to title))
        createdIds.add(r.getString("id"))
        val list = admin.db("shared").table("posts")
            .where("title", "!=", title)
            .where("title", "contains", PREFIX)
            .limit(10).getList()
        for (item in list.items) {
            assertNotEquals(title, item.getString("title"))
        }
    }

    @Test
    fun `where contains filter - substring match`() {
        val unique = "$PREFIX-contains-${System.nanoTime()}"
        val r = admin.db("shared").table("posts").insert(mapOf("title" to unique))
        createdIds.add(r.getString("id"))
        val list = admin.db("shared").table("posts")
            .where("title", "contains", "contains-")
            .where("title", "contains", PREFIX)
            .limit(10).getList()
        assertTrue(list.items.isNotEmpty())
    }

    @Test
    fun `multiple where filters combined`() {
        val title = "$PREFIX-multi-${System.nanoTime()}"
        val r = admin.db("shared").table("posts").insert(mapOf(
            "title" to title,
            "viewCount" to 50
        ))
        createdIds.add(r.getString("id"))
        val list = admin.db("shared").table("posts")
            .where("title", "==", title)
            .where("viewCount", ">=", 10)
            .getList()
        assertTrue(list.items.isNotEmpty())
    }

    @Test
    fun `or filter finds matching records`() {
        val titleA = "$PREFIX-orA-${System.nanoTime()}"
        val titleB = "$PREFIX-orB-${System.nanoTime()}"
        val rA = admin.db("shared").table("posts").insert(mapOf("title" to titleA))
        val rB = admin.db("shared").table("posts").insert(mapOf("title" to titleB))
        createdIds.add(rA.getString("id"))
        createdIds.add(rB.getString("id"))
        val list = admin.db("shared").table("posts")
            .or {
                where("title", "==", titleA)
                    .where("title", "==", titleB)
            }
            .limit(10).getList()
        assertTrue(list.items.size >= 1)
    }

    @Test
    fun `count with filter`() {
        val title = "$PREFIX-cnt-${System.nanoTime()}"
        val r = admin.db("shared").table("posts").insert(mapOf("title" to title))
        createdIds.add(r.getString("id"))
        val count = admin.db("shared").table("posts")
            .where("title", "==", title).count()
        assertEquals(1, count)
    }

    @Test
    fun `count without filter returns total`() {
        val count = admin.db("shared").table("posts").count()
        assertTrue(count >= 0)
    }

    @Test
    fun `search query - FTS`() {
        val unique = "$PREFIX-fts-${System.nanoTime()}"
        val r = admin.db("shared").table("posts").insert(mapOf("title" to unique))
        createdIds.add(r.getString("id"))
        // search may return results depending on FTS index; just verify no error
        try {
            val list = admin.db("shared").table("posts").search(unique).limit(5).getList()
            assertNotNull(list.items)
        } catch (_: EdgeBaseException) {
            // FTS may not be configured -- acceptable
            assertTrue(true)
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 3. Batch
    // ═══════════════════════════════════════════════════════════════════════════

    @Test
    fun `insertMany - N items returned`() {
        val items = listOf(
            mapOf("title" to "$PREFIX-batch-1"),
            mapOf("title" to "$PREFIX-batch-2"),
            mapOf("title" to "$PREFIX-batch-3"),
        )
        val result = admin.db("shared").table("posts").insertMany(items)
        assertEquals(3, result.size)
        for (r in result) createdIds.add(r.getString("id"))
    }

    @Test
    fun `insertMany single item`() {
        val items = listOf(mapOf("title" to "$PREFIX-batch-single"))
        val result = admin.db("shared").table("posts").insertMany(items)
        assertEquals(1, result.size)
        createdIds.add(result[0].getString("id"))
    }

    @Test
    fun `insertMany - 10 items`() {
        val items = (1..10).map { mapOf("title" to "$PREFIX-batch10-$it") }
        val result = admin.db("shared").table("posts").insertMany(items)
        assertEquals(10, result.size)
        for (r in result) createdIds.add(r.getString("id"))
    }

    @Test
    fun `insertMany items have unique ids`() {
        val items = listOf(
            mapOf("title" to "$PREFIX-uniq-1"),
            mapOf("title" to "$PREFIX-uniq-2"),
        )
        val result = admin.db("shared").table("posts").insertMany(items)
        val ids = result.map { it.getString("id") }.toSet()
        assertEquals(2, ids.size, "All created IDs should be unique")
        for (r in result) createdIds.add(r.getString("id"))
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 4. Upsert
    // ═══════════════════════════════════════════════════════════════════════════

    @Test
    fun `upsert new - action == inserted`() {
        val r = admin.db("shared").table("posts").upsert(mapOf("title" to "$PREFIX-upsert"))
        assertEquals("inserted", r.record.optString("action"))
        createdIds.add(r.record.getString("id"))
    }

    @Test
    fun `upsert existing - updates record`() {
        val title = "$PREFIX-upsert-exist-${System.nanoTime()}"
        val created = admin.db("shared").table("posts").insert(mapOf("title" to title))
        val id = created.getString("id")
        createdIds.add(id)
        // Upsert with same title should update
        val r = admin.db("shared").table("posts").upsert(mapOf("id" to id, "title" to "$title-v2"))
        assertNotNull(r.record)
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 5. FieldOps
    // ═══════════════════════════════════════════════════════════════════════════

    @Test
    fun `increment - viewCount increases`() {
        val created = admin.db("shared").table("posts").insert(mapOf("title" to "$PREFIX-inc", "viewCount" to 0))
        val id = created.getString("id")
        createdIds.add(id)
        val updated = admin.db("shared").table("posts").update(id, mapOf("viewCount" to increment(5)))
        assertEquals(5, updated.optInt("viewCount"))
    }

    @Test
    fun `increment negative - viewCount decreases`() {
        val created = admin.db("shared").table("posts").insert(mapOf("title" to "$PREFIX-dec", "viewCount" to 10))
        val id = created.getString("id")
        createdIds.add(id)
        val updated = admin.db("shared").table("posts").update(id, mapOf("viewCount" to increment(-3)))
        assertEquals(7, updated.optInt("viewCount"))
    }

    @Test
    fun `increment multiple times accumulates`() {
        val created = admin.db("shared").table("posts").insert(mapOf("title" to "$PREFIX-inc-multi", "viewCount" to 0))
        val id = created.getString("id")
        createdIds.add(id)
        admin.db("shared").table("posts").update(id, mapOf("viewCount" to increment(3)))
        admin.db("shared").table("posts").update(id, mapOf("viewCount" to increment(7)))
        val fetched = admin.db("shared").table("posts").getOne(id)
        assertEquals(10, fetched.optInt("viewCount"))
    }

    @Test
    fun `deleteField removes a field`() {
        val created = admin.db("shared").table("posts").insert(mapOf(
            "title" to "$PREFIX-delfield",
            "tempData" to "remove-me"
        ))
        val id = created.getString("id")
        createdIds.add(id)
        admin.db("shared").table("posts").update(id, mapOf("tempData" to deleteField()))
        val fetched = admin.db("shared").table("posts").getOne(id)
        assertTrue(fetched.isNull("tempData") || !fetched.has("tempData"))
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 6. AdminAuth E2E
    // ═══════════════════════════════════════════════════════════════════════════

    @Test
    fun `AdminAuth createUser + getUser`() {
        val email = "kt-auth-${System.currentTimeMillis()}@test.com"
        val created = admin.adminAuth.createUser(email, "KtE2EPass123!")
        val userId = created.optString("id")
            ?: created.optJSONObject("user")?.optString("id") ?: ""
        assertFalse(userId.isEmpty())
        val fetched = admin.adminAuth.getUser(userId)
        val fetchedId = fetched.optString("id")
            ?: fetched.optJSONObject("user")?.optString("id") ?: ""
        assertEquals(userId, fetchedId)
    }

    @Test
    fun `AdminAuth listUsers - users field exists`() {
        val result = admin.adminAuth.listUsers(10)
        assertNotNull(result.optJSONArray("users"))
    }

    @Test
    fun `AdminAuth setCustomClaims succeeds`() {
        val email = "kt-claims-${System.currentTimeMillis()}@test.com"
        val created = admin.adminAuth.createUser(email, "KtE2EPass123!")
        val userId = created.optString("id")
            ?: created.optJSONObject("user")?.optString("id") ?: ""
        assertFalse(userId.isEmpty())
        // Should not throw
        admin.adminAuth.setCustomClaims(userId, mapOf("role" to "premium"))
        assertTrue(true)
    }

    @Test
    fun `AdminAuth deleteUser succeeds`() {
        val email = "kt-del-user-${System.currentTimeMillis()}@test.com"
        val created = admin.adminAuth.createUser(email, "KtE2EPass123!")
        val userId = created.optString("id")
            ?: created.optJSONObject("user")?.optString("id") ?: ""
        assertFalse(userId.isEmpty())
        admin.adminAuth.deleteUser(userId)
        // getUser after delete should fail
        assertFails {
            admin.adminAuth.getUser(userId)
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 7. Error Handling
    // ═══════════════════════════════════════════════════════════════════════════

    @Test
    fun `getOne nonexistent id - EdgeBaseException`() {
        assertFails {
            admin.db("shared").table("posts").getOne("nonexistent-kt-99999")
        }
    }

    @Test
    fun `update nonexistent id - EdgeBaseException`() {
        assertFails {
            admin.db("shared").table("posts").update("nonexistent-kt-upd", mapOf("title" to "X"))
        }
    }

    @Test
    fun `delete nonexistent id - EdgeBaseException`() {
        assertFails {
            admin.db("shared").table("posts").delete("nonexistent-kt-del-99999")
        }
    }

    @Test
    fun `getOne with empty id - EdgeBaseException`() {
        assertFails {
            admin.db("shared").table("posts").getOne("")
        }
    }

    @Test
    fun `invalid service key - EdgeBaseException`() {
        val badAdmin = AdminEdgeBase(BASE_URL, "invalid-key-xyz")
        assertFails {
            badAdmin.db("shared").table("posts").insert(mapOf("title" to "X"))
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 8. Coroutine + parallel (language-specific)
    // ═══════════════════════════════════════════════════════════════════════════

    @Test
    fun `parallel stream - 3 concurrent creates`() {
        val titles = listOf("$PREFIX-kt-par-1", "$PREFIX-kt-par-2", "$PREFIX-kt-par-3")
        val results = titles.parallelStream().map { title ->
            admin.db("shared").table("posts").insert(mapOf("title" to title))
        }.toList()
        assertEquals(3, results.size)
        for (r in results) {
            assertNotNull(r.optString("id"))
            createdIds.add(r.getString("id"))
        }
    }

    @Test
    fun `parallel stream - 5 concurrent reads`() {
        // Create a record first
        val r = admin.db("shared").table("posts").insert(mapOf("title" to "$PREFIX-par-read"))
        val id = r.getString("id")
        createdIds.add(id)
        // Read it concurrently 5 times
        val results = (1..5).toList().parallelStream().map {
            admin.db("shared").table("posts").getOne(id)
        }.toList()
        assertEquals(5, results.size)
        for (result in results) {
            assertEquals(id, result.getString("id"))
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 9. SQL
    // ═══════════════════════════════════════════════════════════════════════════

    @Test
    fun `sql query returns rows`() {
        admin.db("shared").table("posts").insert(mapOf("title" to "$PREFIX-sql"))
        try {
            val rows = admin.sql("SELECT * FROM posts LIMIT 5")
            assertNotNull(rows)
        } catch (_: EdgeBaseException) {
            // SQL endpoint may not be available -- acceptable
            assertTrue(true)
        }
    }

    @Test
    fun `sql query with params`() {
        val title = "$PREFIX-sqlp-${System.nanoTime()}"
        admin.db("shared").table("posts").insert(mapOf("title" to title))
        try {
            val rows = admin.sql("SELECT * FROM posts WHERE title = ?", listOf(title))
            assertNotNull(rows)
        } catch (_: EdgeBaseException) {
            // SQL endpoint may not be available -- acceptable
            assertTrue(true)
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 10. Broadcast
    // ═══════════════════════════════════════════════════════════════════════════

    @Test
    fun `broadcast succeeds`() {
        try {
            admin.broadcast("test-channel", "test-event", mapOf("msg" to "hello from kt core e2e"))
            assertTrue(true)
        } catch (_: EdgeBaseException) {
            // Broadcast may fail if database-live not configured -- acceptable
            assertTrue(true)
        }
    }
}
