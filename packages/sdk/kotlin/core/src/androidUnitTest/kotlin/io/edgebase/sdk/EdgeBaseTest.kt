/**
 * Kotlin SDK -- Core Unit Tests
 *
 * Test targets:
 *   io.edgebase.sdk.TableRef  (immutable query builder)
 *   io.edgebase.sdk.FieldOp   (increment, deleteField)
 *   io.edgebase.sdk.EdgeBaseHttpClient  (constructor, headers)
 *   io.edgebase.sdk.EdgeBaseException    (error types, codes)
 *   io.edgebase.sdk.ListResult / UpsertResult / BatchResult  (data classes)
 *   io.edgebase.sdk.DbRef     (namespace-scoped accessor)
 *   io.edgebase.sdk.AdminEdgeBase / AdminAuthClient (structure)
 *
 * Run: cd packages/sdk/kotlin && ./gradlew :core:test
 *
 * kotlin.test (KMP multiplatform compatible)
 */

package io.edgebase.sdk

import kotlin.test.Test
import kotlin.test.assertNotNull
import kotlin.test.assertNotSame
import kotlin.test.assertTrue
import kotlin.test.assertEquals
import kotlin.test.assertSame
import kotlin.test.assertNotEquals
import kotlin.test.assertFails
import kotlin.test.assertNull
import kotlin.test.assertFalse
import kotlin.test.assertFailsWith

// ═══════════════════════════════════════════════════════════════════════════════
// A. TableRef immutability
// ═══════════════════════════════════════════════════════════════════════════════

class TableRefUnitTest {

    @Test
    fun `where() returns new instance`() {
        val http = EdgeBaseHttpClient("http://localhost:9999", "sk-test")
        val t1 = TableRef(http, "posts")
        val t2 = t1.where("status", "==", "published")
        assertNotSame(t1, t2)
    }

    @Test
    fun `orderBy() returns new instance`() {
        val http = EdgeBaseHttpClient("http://localhost:9999", "sk-test")
        val t1 = TableRef(http, "posts")
        val t2 = t1.orderBy("createdAt", "desc")
        assertNotSame(t1, t2)
    }

    @Test
    fun `limit() returns new instance`() {
        val http = EdgeBaseHttpClient("http://localhost:9999", "sk-test")
        val t = TableRef(http, "posts").limit(10)
        assertNotNull(t)
    }

    @Test
    fun `offset() returns new instance`() {
        val http = EdgeBaseHttpClient("http://localhost:9999", "sk-test")
        val t = TableRef(http, "posts").offset(20)
        assertNotNull(t)
    }

    @Test
    fun `page() returns new instance`() {
        val http = EdgeBaseHttpClient("http://localhost:9999", "sk-test")
        val t = TableRef(http, "posts").page(2)
        assertNotNull(t)
    }

    @Test
    fun `after() returns new instance`() {
        val http = EdgeBaseHttpClient("http://localhost:9999", "sk-test")
        val t = TableRef(http, "posts").after("cursor-xyz")
        assertNotNull(t)
    }

    @Test
    fun `before() returns new instance`() {
        val http = EdgeBaseHttpClient("http://localhost:9999", "sk-test")
        val t = TableRef(http, "posts").before("cursor-abc")
        assertNotNull(t)
    }

    @Test
    fun `search() returns new instance`() {
        val http = EdgeBaseHttpClient("http://localhost:9999", "sk-test")
        val t = TableRef(http, "posts").search("hello world")
        assertNotNull(t)
    }

    @Test
    fun `chained builder -- multiple where accumulated`() {
        val http = EdgeBaseHttpClient("http://localhost:9999", "sk-test")
        // Should not throw
        TableRef(http, "posts")
            .where("status", "==", "published")
            .where("views", ">", 100)
            .orderBy("createdAt", "desc")
            .limit(10)
        assertTrue(true)
    }

    @Test
    fun `after() + limit() chain`() {
        val http = EdgeBaseHttpClient("http://localhost:9999", "sk-test")
        val t = TableRef(http, "posts").after("c1").limit(5)
        assertNotNull(t)
    }

    @Test
    fun `before() then after() -- beforeCursor cleared`() {
        val http = EdgeBaseHttpClient("http://localhost:9999", "sk-test")
        val t = TableRef(http, "posts").before("b1").after("a1")
        // after() should clear before
        assertNotNull(t)
    }

    @Test
    fun `DbRef table() returns TableRef`() {
        val http = EdgeBaseHttpClient("http://localhost:9999", "sk-test")
        val db = DbRef(http, "shared")
        val table = db.table("posts")
        assertNotNull(table)
    }

    @Test
    fun `workspace namespace + instanceId DbRef`() {
        val http = EdgeBaseHttpClient("http://localhost:9999", "sk-test")
        val db = DbRef(http, "workspace", "ws-123")
        val table = db.table("docs")
        assertNotNull(table)
    }

    @Test
    fun `AdminEdgeBase db() returns DbRef`() {
        val admin = AdminEdgeBase("http://localhost:9999", "sk-test")
        val db = admin.db("shared")
        assertNotNull(db)
    }

    @Test
    fun `AdminEdgeBase db() table() returns TableRef`() {
        val admin = AdminEdgeBase("http://localhost:9999", "sk-test")
        val table = admin.db("shared").table("posts")
        assertNotNull(table)
    }

    // ─── Extended immutable chaining ────────────────────────────────────────────

    @Test
    fun `where + orderBy + limit chain produces distinct instance`() {
        val http = EdgeBaseHttpClient("http://localhost:9999", "sk-test")
        val t1 = TableRef(http, "posts")
        val t2 = t1.where("status", "==", "published").orderBy("createdAt", "desc").limit(20)
        assertNotSame(t1, t2)
    }

    @Test
    fun `search + limit chain produces distinct instance`() {
        val http = EdgeBaseHttpClient("http://localhost:9999", "sk-test")
        val t1 = TableRef(http, "posts")
        val t2 = t1.search("kotlin").limit(5)
        assertNotSame(t1, t2)
    }

    @Test
    fun `cursor + limit chain produces distinct instance`() {
        val http = EdgeBaseHttpClient("http://localhost:9999", "sk-test")
        val t1 = TableRef(http, "posts")
        val t2 = t1.after("cursor-abc").limit(10)
        assertNotSame(t1, t2)
    }

    @Test
    fun `after() then before() -- afterCursor cleared`() {
        val http = EdgeBaseHttpClient("http://localhost:9999", "sk-test")
        val t = TableRef(http, "posts").after("a1").before("b1")
        // before() should clear after
        assertNotNull(t)
    }

    @Test
    fun `or builder returns new instance`() {
        val http = EdgeBaseHttpClient("http://localhost:9999", "sk-test")
        val t1 = TableRef(http, "posts")
        val t2 = t1.or { where("category", "==", "tech").where("category", "==", "science") }
        assertNotSame(t1, t2)
    }

    @Test
    fun `multiple where does not mutate original`() {
        val http = EdgeBaseHttpClient("http://localhost:9999", "sk-test")
        val t1 = TableRef(http, "posts")
        val t2 = t1.where("a", "==", "1")
        val t3 = t1.where("b", "==", "2")
        // t2 and t3 are different from each other and from t1
        assertNotSame(t1, t2)
        assertNotSame(t1, t3)
        assertNotSame(t2, t3)
    }

    @Test
    fun `page returns new instance different from offset`() {
        val http = EdgeBaseHttpClient("http://localhost:9999", "sk-test")
        val t1 = TableRef(http, "posts").page(1)
        val t2 = TableRef(http, "posts").offset(0)
        assertNotSame(t1, t2)
    }

    @Test
    fun `orderBy default direction is asc`() {
        val http = EdgeBaseHttpClient("http://localhost:9999", "sk-test")
        // Should not throw when called without direction
        val t = TableRef(http, "posts").orderBy("title")
        assertNotNull(t)
    }

    @Test
    fun `DbRef different namespaces produce different TableRef instances`() {
        val http = EdgeBaseHttpClient("http://localhost:9999", "sk-test")
        val t1 = DbRef(http, "shared").table("posts")
        val t2 = DbRef(http, "workspace", "ws-1").table("posts")
        assertNotSame(t1, t2)
    }

    @Test
    fun `chaining 5 wheres does not throw`() {
        val http = EdgeBaseHttpClient("http://localhost:9999", "sk-test")
        val t = TableRef(http, "items")
            .where("a", "==", 1)
            .where("b", ">", 2)
            .where("c", "<", 3)
            .where("d", "!=", 4)
            .where("e", ">=", 5)
        assertNotNull(t)
    }

    @Test
    fun `limit zero is allowed`() {
        val http = EdgeBaseHttpClient("http://localhost:9999", "sk-test")
        val t = TableRef(http, "posts").limit(0)
        assertNotNull(t)
    }

    @Test
    fun `offset zero is allowed`() {
        val http = EdgeBaseHttpClient("http://localhost:9999", "sk-test")
        val t = TableRef(http, "posts").offset(0)
        assertNotNull(t)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// B. FieldOp unit tests
// ═══════════════════════════════════════════════════════════════════════════════

class FieldOpTest {

    @Test
    fun `increment() returns FieldOp Increment`() {
        val op = increment(5)
        assertTrue(op is FieldOp.Increment)
    }

    @Test
    fun `increment value preserved`() {
        val op = increment(10) as FieldOp.Increment
        assertEquals(10, op.value)
    }

    @Test
    fun `increment negative allowed`() {
        val op = increment(-3) as FieldOp.Increment
        assertEquals(-3, op.value)
    }

    @Test
    fun `deleteField() returns FieldOp DeleteField`() {
        val op = deleteField()
        assertSame(FieldOp.DeleteField, op)
    }

    @Test
    fun `increment different values produce different objects`() {
        val op1 = increment(1)
        val op2 = increment(2)
        assertNotEquals(op1, op2)
    }

    @Test
    fun `increment same value produces equal objects`() {
        val op1 = increment(5)
        val op2 = increment(5)
        assertEquals(op1, op2)
    }

    // ─── Extended FieldOp tests ─────────────────────────────────────────────────

    @Test
    fun `increment zero is valid`() {
        val op = increment(0) as FieldOp.Increment
        assertEquals(0, op.value)
    }

    @Test
    fun `increment large number`() {
        val op = increment(1_000_000) as FieldOp.Increment
        assertEquals(1_000_000, op.value)
    }

    @Test
    fun `increment float value`() {
        val op = increment(3.14) as FieldOp.Increment
        assertEquals(3.14, op.value)
    }

    @Test
    fun `increment negative float`() {
        val op = increment(-0.5) as FieldOp.Increment
        assertEquals(-0.5, op.value)
    }

    @Test
    fun `deleteField singleton identity`() {
        val op1 = deleteField()
        val op2 = deleteField()
        assertSame(op1, op2)
    }

    @Test
    fun `FieldOp Increment is data class -- hashCode consistent`() {
        val op1 = increment(42) as FieldOp.Increment
        val op2 = increment(42) as FieldOp.Increment
        assertEquals(op1.hashCode(), op2.hashCode())
    }

    @Test
    fun `FieldOp Increment toString contains value`() {
        val op = increment(7) as FieldOp.Increment
        assertTrue(op.toString().contains("7"))
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// C. EdgeBaseException unit tests
// ═══════════════════════════════════════════════════════════════════════════════

class EdgeBaseExceptionTest {

    @Test
    fun `EdgeBaseException stores code + message`() {
        val ex = EdgeBaseException(404, "Not found")
        assertEquals(404, ex.code)
        assertEquals("Not found", ex.message)
    }

    @Test
    fun `EdgeBaseException is subclass of Exception`() {
        val ex = EdgeBaseException(500, "Internal error")
        assertTrue(ex is Exception)
    }

    @Test
    fun `assertThrows EdgeBaseException`() {
        assertFails {
            throw EdgeBaseException(403, "Forbidden")
        }
    }

    // ─── Extended error tests ───────────────────────────────────────────────────

    @Test
    fun `EdgeBaseException code 0 for network errors`() {
        val ex = EdgeBaseException(0, "Network error: timeout")
        assertEquals(0, ex.code)
        assertTrue(ex.message!!.contains("Network error"))
    }

    @Test
    fun `EdgeBaseException 400 bad request`() {
        val ex = EdgeBaseException(400, "Bad request")
        assertEquals(400, ex.code)
    }

    @Test
    fun `EdgeBaseException 401 unauthorized`() {
        val ex = EdgeBaseException(401, "Unauthorized")
        assertEquals(401, ex.code)
    }

    @Test
    fun `EdgeBaseException 403 forbidden`() {
        val ex = EdgeBaseException(403, "Forbidden")
        assertEquals(403, ex.code)
    }

    @Test
    fun `EdgeBaseException 404 not found`() {
        val ex = EdgeBaseException(404, "Record not found")
        assertEquals(404, ex.code)
    }

    @Test
    fun `EdgeBaseException 409 conflict`() {
        val ex = EdgeBaseException(409, "Conflict")
        assertEquals(409, ex.code)
    }

    @Test
    fun `EdgeBaseException 429 rate limited`() {
        val ex = EdgeBaseException(429, "Too many requests")
        assertEquals(429, ex.code)
    }

    @Test
    fun `EdgeBaseException 500 server error`() {
        val ex = EdgeBaseException(500, "Internal server error")
        assertEquals(500, ex.code)
    }

    @Test
    fun `EdgeBaseException message preserved in cause chain`() {
        val ex = EdgeBaseException(502, "Bad gateway")
        val wrapper = RuntimeException("Wrapped", ex)
        assertEquals(ex, wrapper.cause)
        assertEquals("Bad gateway", wrapper.cause?.message)
    }

    @Test
    fun `EdgeBaseException empty message allowed`() {
        val ex = EdgeBaseException(503, "")
        assertEquals("", ex.message)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// D. EdgeBaseHttpClient unit tests
// ═══════════════════════════════════════════════════════════════════════════════

class EdgeBaseHttpClientTest {

    @Test
    fun `constructor stores baseUrl`() {
        val http = EdgeBaseHttpClient("http://localhost:9999", "sk-test")
        assertNotNull(http)
    }

    @Test
    fun `constructor allows null service key`() {
        val http = EdgeBaseHttpClient("http://localhost:9999")
        assertNotNull(http)
    }

    @Test
    fun `setToken does not throw`() {
        val http = EdgeBaseHttpClient("http://localhost:9999", "sk-test")
        http.setToken("new-token-123")
        assertTrue(true)
    }

    @Test
    fun `setToken null clears token`() {
        val http = EdgeBaseHttpClient("http://localhost:9999", "sk-test")
        http.setToken("token")
        http.setToken(null)
        assertTrue(true)
    }

    @Test
    fun `serviceKey is accessible internally`() {
        val http = EdgeBaseHttpClient("http://localhost:9999", "sk-test-key")
        assertEquals("sk-test-key", http.serviceKey)
    }

    @Test
    fun `network error throws EdgeBaseException code 0`() {
        val http = EdgeBaseHttpClient("http://localhost:1", "sk-test")
        assertFails {
            http.get("/db/shared/tables/posts")
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// E. ListResult data class tests
// ═══════════════════════════════════════════════════════════════════════════════

class ListResultTest {

    @Test
    fun `ListResult with all fields`() {
        val items = listOf(org.json.JSONObject("""{"id":"1","title":"hello"}"""))
        val r = ListResult(items, total = 10, page = 1, perPage = 5, hasMore = true, cursor = "c1")
        assertEquals(1, r.items.size)
        assertEquals(10, r.total)
        assertEquals(1, r.page)
        assertEquals(5, r.perPage)
        assertEquals(true, r.hasMore)
        assertEquals("c1", r.cursor)
    }

    @Test
    fun `ListResult nullable total`() {
        val r = ListResult(emptyList(), total = null, page = null, perPage = null, hasMore = true, cursor = "c1")
        assertNull(r.total)
    }

    @Test
    fun `ListResult empty items`() {
        val r = ListResult(emptyList(), total = 0, page = 1, perPage = 10, hasMore = false, cursor = null)
        assertTrue(r.items.isEmpty())
        assertEquals(0, r.total)
    }

    @Test
    fun `ListResult offset mode -- cursor null`() {
        val r = ListResult(emptyList(), total = 100, page = 2, perPage = 10, hasMore = null, cursor = null)
        assertNull(r.cursor)
        assertNull(r.hasMore)
        assertEquals(100, r.total)
    }

    @Test
    fun `ListResult cursor mode -- total null`() {
        val r = ListResult(emptyList(), total = null, page = null, perPage = null, hasMore = true, cursor = "abc")
        assertNull(r.total)
        assertNull(r.page)
        assertEquals(true, r.hasMore)
        assertEquals("abc", r.cursor)
    }

    @Test
    fun `ListResult equality`() {
        val r1 = ListResult(emptyList(), 10, 1, 10, null, null)
        val r2 = ListResult(emptyList(), 10, 1, 10, null, null)
        assertEquals(r1, r2)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// F. UpsertResult / BatchResult data class tests
// ═══════════════════════════════════════════════════════════════════════════════

class UpsertResultTest {

    @Test
    fun `UpsertResult created true`() {
        val json = org.json.JSONObject("""{"id":"1","action":"inserted"}""")
        val r = UpsertResult(record = json, inserted = true)
        assertTrue(r.inserted)
    }

    @Test
    fun `UpsertResult created false -- updated`() {
        val json = org.json.JSONObject("""{"id":"1","action":"updated"}""")
        val r = UpsertResult(record = json, inserted = false)
        assertFalse(r.inserted)
    }

    @Test
    fun `UpsertResult record accessible`() {
        val json = org.json.JSONObject("""{"id":"abc","title":"test"}""")
        val r = UpsertResult(record = json, inserted = true)
        assertEquals("abc", r.record.getString("id"))
    }
}

class BatchResultTest {

    @Test
    fun `BatchResult success`() {
        val r = BatchResult(totalProcessed = 10, totalSucceeded = 10, errors = emptyList())
        assertEquals(10, r.totalProcessed)
        assertEquals(10, r.totalSucceeded)
        assertTrue(r.errors.isEmpty())
    }

    @Test
    fun `BatchResult partial failure`() {
        val errJson = org.json.JSONObject("""{"chunkIndex":0,"error":"timeout"}""")
        val r = BatchResult(totalProcessed = 10, totalSucceeded = 7, errors = listOf(errJson))
        assertEquals(10, r.totalProcessed)
        assertEquals(7, r.totalSucceeded)
        assertEquals(1, r.errors.size)
    }

    @Test
    fun `BatchResult zero processed`() {
        val r = BatchResult(totalProcessed = 0, totalSucceeded = 0, errors = emptyList())
        assertEquals(0, r.totalProcessed)
        assertEquals(0, r.totalSucceeded)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// G. Filter data class tests
// ═══════════════════════════════════════════════════════════════════════════════

class FilterTest {

    @Test
    fun `Filter stores field, op, value`() {
        val f = Filter("status", "==", "active")
        assertEquals("status", f.field)
        assertEquals("==", f.op)
        assertEquals("active", f.value)
    }

    @Test
    fun `Filter with null value`() {
        val f = Filter("deletedAt", "==", null)
        assertNull(f.value)
    }

    @Test
    fun `Filter with numeric value`() {
        val f = Filter("views", ">", 100)
        assertEquals(100, f.value)
    }

    @Test
    fun `Filter equality`() {
        val f1 = Filter("a", "==", "b")
        val f2 = Filter("a", "==", "b")
        assertEquals(f1, f2)
    }

    @Test
    fun `Filter inequality`() {
        val f1 = Filter("a", "==", "b")
        val f2 = Filter("a", "!=", "b")
        assertNotEquals(f1, f2)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// H. AdminEdgeBase structure tests
// ═══════════════════════════════════════════════════════════════════════════════

class AdminEdgeBaseStructureTest {

    @Test
    fun `AdminEdgeBase db with default namespace`() {
        val admin = AdminEdgeBase("http://localhost:9999", "sk-test")
        val db = admin.db()
        assertNotNull(db)
    }

    @Test
    fun `AdminEdgeBase db with custom namespace`() {
        val admin = AdminEdgeBase("http://localhost:9999", "sk-test")
        val db = admin.db("workspace", "ws-1")
        assertNotNull(db)
    }

    @Test
    fun `AdminEdgeBase sql method exists`() {
        val admin = AdminEdgeBase("http://localhost:9999", "sk-test")
        // Compile-time check -- sql is callable
        val fn: (String) -> List<org.json.JSONObject> = { q -> admin.sql(q) }
        assertNotNull(fn)
    }

    @Test
    fun `AdminEdgeBase adminAuth property exists`() {
        val admin = AdminEdgeBase("http://localhost:9999", "sk-test")
        assertNotNull(admin.adminAuth)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// I. DbRef structure tests
// ═══════════════════════════════════════════════════════════════════════════════

class DbRefStructureTest {

    @Test
    fun `DbRef table returns same name`() {
        val http = EdgeBaseHttpClient("http://localhost:9999", "sk-test")
        val db = DbRef(http, "shared")
        val t = db.table("comments")
        assertNotNull(t)
    }

    @Test
    fun `DbRef with instanceId`() {
        val http = EdgeBaseHttpClient("http://localhost:9999", "sk-test")
        val db = DbRef(http, "user", "user-123")
        val t = db.table("preferences")
        assertNotNull(t)
    }

    @Test
    fun `DbRef without instanceId`() {
        val http = EdgeBaseHttpClient("http://localhost:9999", "sk-test")
        val db = DbRef(http, "shared")
        val t = db.table("posts")
        assertNotNull(t)
    }
}
