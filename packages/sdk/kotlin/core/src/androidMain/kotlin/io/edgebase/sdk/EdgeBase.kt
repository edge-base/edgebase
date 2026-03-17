/**
 * EdgeBase Kotlin SDK — Core 소스
 *
 * 서버 API 스펙 기준 작성 (JS SDK, Python SDK 참고)
 *
 * Used by: core + client + admin
 * 의존성: OkHttp, kotlinx-coroutines, kotlinx-serialization-json
 */

package io.edgebase.sdk

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

// ─── Data types ───────────────────────────────────────────────────────────────

data class ListResult(
    val items: List<JSONObject>,
    val total: Int?,
    val page: Int?,
    val perPage: Int?,
    val hasMore: Boolean?,
    val cursor: String?,
)

data class UpsertResult(
    val record: JSONObject,
    val inserted: Boolean,
)

data class BatchResult(
    val totalProcessed: Int,
    val totalSucceeded: Int,
    val errors: List<JSONObject>,
)

// ─── FieldOp ──────────────────────────────────────────────────────────────────

sealed class FieldOp {
    data class Increment(val value: Number) : FieldOp()
    object DeleteField : FieldOp()
}

fun increment(n: Number): FieldOp = FieldOp.Increment(n)
fun deleteField(): FieldOp = FieldOp.DeleteField

// ─── HttpClient ───────────────────────────────────────────────────────────────

class EdgeBaseHttpClient(
    private val baseUrl: String,
    serviceKey: String? = null,
    private var accessToken: String? = null,
) {
    private val client = OkHttpClient()
    private val JSON_MT = "application/json; charset=utf-8".toMediaType()
    internal var serviceKey: String? = serviceKey

    private fun buildHeaders(): Headers {
        val builder = Headers.Builder()
        builder.add("Content-Type", "application/json")
        serviceKey?.let { builder.add("X-EdgeBase-Service-Key", it) }
        accessToken?.let { builder.add("Authorization", "Bearer $it") }
        return builder.build()
    }

    fun setToken(token: String?) { accessToken = token }

    private fun serializeBody(data: Map<String, Any?>): String {
        val json = JSONObject()
        for ((k, v) in data) {
            when (v) {
                is FieldOp.Increment -> json.put(k, JSONObject().put("\$op", "increment").put("value", v.value))
                is FieldOp.DeleteField -> json.put(k, JSONObject().put("\$op", "deleteField"))
                else -> json.put(k, v)
            }
        }
        return json.toString()
    }

    private fun buildUrl(path: String): String = "$baseUrl/api$path"

    fun get(path: String, query: Map<String, String> = emptyMap()): JSONObject {
        val urlBuilder = buildUrl(path).toHttpUrl().newBuilder()
        for ((k, v) in query) urlBuilder.addQueryParameter(k, v)
        val req = Request.Builder().url(urlBuilder.build()).headers(buildHeaders()).get().build()
        return execute(req)
    }

    fun post(path: String, body: Map<String, Any?> = emptyMap()): JSONObject {
        val reqBody = serializeBody(body).toRequestBody(JSON_MT)
        val req = Request.Builder().url(buildUrl(path)).headers(buildHeaders()).post(reqBody).build()
        return execute(req)
    }

    fun postRaw(path: String, bodyStr: String): JSONObject {
        val reqBody = bodyStr.toRequestBody(JSON_MT)
        val req = Request.Builder().url(buildUrl(path)).headers(buildHeaders()).post(reqBody).build()
        return execute(req)
    }

    fun patch(path: String, body: Map<String, Any?>): JSONObject {
        val reqBody = serializeBody(body).toRequestBody(JSON_MT)
        val req = Request.Builder().url(buildUrl(path)).headers(buildHeaders()).patch(reqBody).build()
        return execute(req)
    }

    fun put(path: String, body: Map<String, Any?> = emptyMap()): JSONObject {
        val reqBody = serializeBody(body).toRequestBody(JSON_MT)
        val req = Request.Builder().url(buildUrl(path)).headers(buildHeaders()).put(reqBody).build()
        return execute(req)
    }

    fun delete(path: String): JSONObject {
        val req = Request.Builder().url(buildUrl(path)).headers(buildHeaders()).delete().build()
        return execute(req)
    }

    private fun execute(req: Request): JSONObject {
        val resp = try {
            client.newCall(req).execute()
        } catch (e: java.io.IOException) {
            throw EdgeBaseException(0, "Network error: ${e.message}")
        }
        resp.use {
            val bodyStr = it.body?.string() ?: ""
            if (!it.isSuccessful) {
                val errJson = runCatching { JSONObject(bodyStr) }.getOrDefault(JSONObject())
                val msg = errJson.optString("message", "HTTP ${it.code}")
                throw EdgeBaseException(it.code, msg)
            }
            if (bodyStr.isEmpty()) return JSONObject()
            // Safely parse success body — non-JSON responses (e.g. HTML error pages)
            // would cause JSONException (RuntimeException) without this guard
            return runCatching { JSONObject(bodyStr) }.getOrElse {
                throw EdgeBaseException(0, "Invalid JSON response: $bodyStr")
            }
        }
    }
}

// ─── EdgeBaseException ────────────────────────────────────────────────────────

class EdgeBaseException(val code: Int, message: String) : Exception(message)

// ─── Filter / Sort ────────────────────────────────────────────────────────────

data class Filter(val field: String, val op: String, val value: Any?)

// ─── TableRef (immutable query builder) ──────────────────────────────────────

class TableRef(
    private val http: EdgeBaseHttpClient,
    private val tableName: String,
    private val namespace: String = "shared",
    private val instanceId: String? = null,
    private val filters: List<Filter> = emptyList(),
    private val orFilters: List<Filter> = emptyList(),
    private val sorts: List<Pair<String, String>> = emptyList(),
    private val limitVal: Int? = null,
    private val offsetVal: Int? = null,
    private val pageVal: Int? = null,
    private val afterCursor: String? = null,
    private val beforeCursor: String? = null,
    private val searchQuery: String? = null,
) {
    private fun basePath(): String {
        return if (instanceId != null)
            "/db/$namespace/$instanceId/tables/$tableName"
        else
            "/db/$namespace/tables/$tableName"
    }

    private fun buildQuery(): Map<String, String> {
        val q = mutableMapOf<String, String>()
        if (filters.isNotEmpty()) {
            q["filter"] = JSONArray(filters.map { JSONArray(listOf(it.field, it.op, it.value)) }).toString()
        }
        if (orFilters.isNotEmpty()) {
            q["orFilter"] = JSONArray(orFilters.map { JSONArray(listOf(it.field, it.op, it.value)) }).toString()
        }
        if (sorts.isNotEmpty()) {
            q["sort"] = sorts.joinToString(",") { "${it.first}:${it.second}" }
        }
        limitVal?.let { q["limit"] = it.toString() }
        offsetVal?.let { q["offset"] = it.toString() }
        pageVal?.let { q["page"] = it.toString() }
        afterCursor?.let { q["after"] = it }
        beforeCursor?.let { q["before"] = it }
        return q
    }

    fun where(field: String, op: String, value: Any?) =
        copy(filters = filters + Filter(field, op, value))

    fun or(builder: TableRef.() -> TableRef): TableRef {
        val sub = TableRef(http, tableName, namespace, instanceId).builder()
        return copy(orFilters = orFilters + sub.filters)
    }

    fun orderBy(field: String, direction: String = "asc") =
        copy(sorts = sorts + Pair(field, direction))

    fun limit(n: Int) = copy(limitVal = n)
    fun offset(n: Int) = copy(offsetVal = n)
    fun page(n: Int) = copy(pageVal = n)
    fun after(cursor: String) = copy(afterCursor = cursor, beforeCursor = null)
    fun before(cursor: String) = copy(beforeCursor = cursor, afterCursor = null)
    fun search(q: String) = copy(searchQuery = q)

    private fun copy(
        filters: List<Filter> = this.filters,
        orFilters: List<Filter> = this.orFilters,
        sorts: List<Pair<String, String>> = this.sorts,
        limitVal: Int? = this.limitVal,
        offsetVal: Int? = this.offsetVal,
        pageVal: Int? = this.pageVal,
        afterCursor: String? = this.afterCursor,
        beforeCursor: String? = this.beforeCursor,
        searchQuery: String? = this.searchQuery,
    ) = TableRef(http, tableName, namespace, instanceId,
        filters, orFilters, sorts, limitVal, offsetVal, pageVal,
        afterCursor, beforeCursor, searchQuery)

    // CRUD
    /** List records with filters, sorting, and pagination. */
    fun getList(): ListResult {
        return get()
    }

    fun get(): ListResult {
        val path = if (searchQuery != null) "${basePath()}/search" else basePath()
        val query = buildQuery().toMutableMap()
        searchQuery?.let { query["search"] = it }
        val data = http.get(path, query)
        return ListResult(
            items = (0 until (data.optJSONArray("items")?.length() ?: 0))
                .map { data.getJSONArray("items").getJSONObject(it) },
            total = if (data.has("total") && !data.isNull("total")) data.getInt("total") else null,
            page = if (data.has("page") && !data.isNull("page")) data.getInt("page") else null,
            perPage = if (data.has("perPage") && !data.isNull("perPage")) data.getInt("perPage") else null,
            hasMore = if (data.has("hasMore") && !data.isNull("hasMore")) data.getBoolean("hasMore") else null,
            cursor = if (data.has("cursor") && !data.isNull("cursor")) data.getString("cursor") else null,
        )
    }

    fun getOne(id: String): JSONObject = http.get("${basePath()}/$id")

    fun insert(body: Map<String, Any?>): JSONObject = http.post(basePath(), body)

    fun update(id: String, data: Map<String, Any?>): JSONObject = http.patch("${basePath()}/$id", data)

    fun delete(id: String) { http.delete("${basePath()}/$id") }

    fun upsert(data: Map<String, Any?>, conflictTarget: String? = null): UpsertResult {
        var path = "${ basePath() }?upsert=true"
        conflictTarget?.let { path += "&conflictTarget=$it" }
        val result = http.postRaw(path, JSONObject(data.mapValues { (_, v) ->
            when (v) {
                is FieldOp.Increment -> JSONObject().put("\$op", "increment").put("value", v.value)
                is FieldOp.DeleteField -> JSONObject().put("\$op", "deleteField")
                else -> v
            }
        }).toString())
        return UpsertResult(record = result, inserted = result.optString("action") == "inserted")
    }

    fun count(): Int {
        val data = http.get("${basePath()}/count", buildQuery())
        return data.optInt("total", 0)
    }

    fun insertMany(items: List<Map<String, Any?>>): List<JSONObject> {
        val inserts = JSONArray(items.map { JSONObject(it) })
        val body = """{"inserts":$inserts}"""
        val result = http.postRaw("${basePath()}/batch", body)
        val inserted = result.optJSONArray("inserted") ?: return emptyList()
        return (0 until inserted.length()).map { inserted.getJSONObject(it) }
    }
}

// ─── DbRef ────────────────────────────────────────────────────────────────────

class DbRef(
    private val http: EdgeBaseHttpClient,
    private val namespace: String,
    private val instanceId: String? = null,
) {
    fun table(name: String) = TableRef(http, name, namespace, instanceId)
}

// ─── AdminAuthClient ─────────────────────────────────────────────────────────

class AdminAuthClient(private val http: EdgeBaseHttpClient) {
    // Paths are relative — EdgeBaseHttpClient.buildUrl() prepends /api.
    fun createUser(email: String, password: String): JSONObject {
        val result = http.post("/auth/admin/users", mapOf("email" to email, "password" to password))
        // Server returns { user: {...} } — unwrap
        return if (result.has("user")) result.getJSONObject("user") else result
    }

    fun listUsers(limit: Int = 50): JSONObject =
        http.get("/auth/admin/users", mapOf("limit" to limit.toString()))

    fun getUser(userId: String): JSONObject {
        val result = http.get("/auth/admin/users/$userId")
        // Server returns { user: {...} } — unwrap
        return if (result.has("user")) result.getJSONObject("user") else result
    }

    fun setCustomClaims(userId: String, claims: Map<String, Any?>): Unit {
        http.put("/auth/admin/users/$userId/claims", claims)
    }

    fun deleteUser(userId: String) { http.delete("/auth/admin/users/$userId") }
}

// ─── AdminClient (server-side entry point) ────────────────────────────────────

class AdminEdgeBase(baseUrl: String, serviceKey: String) {
    private val http = EdgeBaseHttpClient(baseUrl, serviceKey)

    val adminAuth = AdminAuthClient(http)

    fun db(namespace: String = "shared", instanceId: String? = null) =
        DbRef(http, namespace, instanceId)

    fun sql(query: String, params: List<Any?> = emptyList(), namespace: String = "shared", instanceId: String? = null): List<JSONObject> {
        val body: MutableMap<String, Any?> = mutableMapOf(
            "namespace" to namespace,
            "sql" to query,
            "params" to params,
        )
        instanceId?.let { body["id"] = it }
        val result = http.post("/sql", body)
        val rows = result.optJSONArray("rows") ?: return emptyList()
        return (0 until rows.length()).map { rows.getJSONObject(it) }
    }

    fun broadcast(channel: String, event: String, payload: Map<String, Any?>) {
        http.post("/db/broadcast", mapOf(
            "channel" to channel,
            "event" to event,
            "payload" to payload,
        ))
    }
}
