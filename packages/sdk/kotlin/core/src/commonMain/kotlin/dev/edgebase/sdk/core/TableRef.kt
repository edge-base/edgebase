// EdgeBase Kotlin SDK — Collection reference & document reference.
//
// Immutable query builder pattern (M5 lesson: safe reference sharing).
// Supports full CRUD, batch operations, and Flow-based database-live subscriptions.
//: Dispatchers.IO → Dispatchers.Default for KMP.
//
// All HTTP calls delegate to Generated Core (ApiCore.kt).
// No hardcoded API paths — the core is the single source of truth.

package dev.edgebase.sdk.core

import dev.edgebase.sdk.core.generated.GeneratedDbApi
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.launch

// MARK: - Data types

/**
 * Filter tuple for query building.
 */
data class FilterTuple(
    val field: String,
    val op: String,
    val value: Any?
) {
    fun toJson(): List<Any?> = listOf(field, op, value)
}

/**
 * Builder for OR conditions.
 */
class OrBuilder {
    private val filters = mutableListOf<FilterTuple>()

    fun where(field: String, op: String, value: Any?): OrBuilder {
        filters.add(FilterTuple(field, op, value))
        return this
    }

    fun getFilters(): List<FilterTuple> = filters.toList()
}

/**
 * List query result — unified type for both offset and cursor pagination.
 *: SDK ListResult unification + cursor pagination support.
 *
 * Offset mode (default):  total/page/perPage are populated, hasMore/cursor are null.
 * Cursor mode (.after/.before): hasMore/cursor are populated, total/page/perPage are null.
 * Rules-filtered mode:    total is null, hasMore/cursor are populated.
 */
data class ListResult(
    val items: List<Map<String, Any?>>,
    val total: Int?,
    val page: Int?,
    val perPage: Int?,
    val hasMore: Boolean?,
    val cursor: String?
)

/**
 * Batch operation result.
 */
data class BatchResult(
    val totalProcessed: Int,
    val totalSucceeded: Int,
    val errors: List<Map<String, Any>> = emptyList()
)

/**
 * Upsert result.
 */
data class UpsertResult(val record: Map<String, Any?>, val inserted: Boolean)

/**
 * DatabaseLive database change event.
 */
data class DbChange(
    val event: String,
    val table: String,
    val id: String? = null,
    val record: Map<String, Any?>? = null,
    val oldRecord: Map<String, Any?>? = null
) {
    companion object {
        @Suppress("UNCHECKED_CAST")
        fun fromJson(json: Map<String, Any?>): DbChange = DbChange(
            event = json["changeType"] as? String ?: "",
            table = json["table"] as? String ?: "",
            id = json["docId"] as? String,
            record = json["data"] as? Map<String, Any?>,
            oldRecord = json["oldRecord"] as? Map<String, Any?>
        )
    }
}

// MARK: - Core dispatch helpers
// Route calls to the correct generated core method based on single-instance vs dynamic DB.

@Suppress("UNCHECKED_CAST")
private suspend fun coreList(
    core: GeneratedDbApi,
    namespace: String,
    instanceId: String?,
    table: String,
    query: Map<String, String>?
): Any? {
    return if (instanceId != null) {
        core.dbListRecords(namespace, instanceId, table, query)
    } else {
        core.dbSingleListRecords(namespace, table, query)
    }
}

@Suppress("UNCHECKED_CAST")
private suspend fun coreGet(
    core: GeneratedDbApi,
    namespace: String,
    instanceId: String?,
    table: String,
    id: String,
    query: Map<String, String>? = null
): Any? {
    return if (instanceId != null) {
        core.dbGetRecord(namespace, instanceId, table, id, query)
    } else {
        core.dbSingleGetRecord(namespace, table, id, query)
    }
}

@Suppress("UNCHECKED_CAST")
private suspend fun coreCount(
    core: GeneratedDbApi,
    namespace: String,
    instanceId: String?,
    table: String,
    query: Map<String, String>?
): Any? {
    return if (instanceId != null) {
        core.dbCountRecords(namespace, instanceId, table, query)
    } else {
        core.dbSingleCountRecords(namespace, table, query)
    }
}

@Suppress("UNCHECKED_CAST")
private suspend fun coreSearch(
    core: GeneratedDbApi,
    namespace: String,
    instanceId: String?,
    table: String,
    query: Map<String, String>?
): Any? {
    return if (instanceId != null) {
        core.dbSearchRecords(namespace, instanceId, table, query)
    } else {
        core.dbSingleSearchRecords(namespace, table, query)
    }
}

@Suppress("UNCHECKED_CAST")
private suspend fun coreInsert(
    core: GeneratedDbApi,
    namespace: String,
    instanceId: String?,
    table: String,
    body: Map<String, Any?>,
    query: Map<String, String>? = null
): Any? {
    return if (instanceId != null) {
        core.dbInsertRecord(namespace, instanceId, table, body, query)
    } else {
        core.dbSingleInsertRecord(namespace, table, body, query)
    }
}

@Suppress("UNCHECKED_CAST")
private suspend fun coreUpdate(
    core: GeneratedDbApi,
    namespace: String,
    instanceId: String?,
    table: String,
    id: String,
    body: Map<String, Any?>
): Any? {
    return if (instanceId != null) {
        core.dbUpdateRecord(namespace, instanceId, table, id, body)
    } else {
        core.dbSingleUpdateRecord(namespace, table, id, body)
    }
}

@Suppress("UNCHECKED_CAST")
private suspend fun coreDelete(
    core: GeneratedDbApi,
    namespace: String,
    instanceId: String?,
    table: String,
    id: String
): Any? {
    return if (instanceId != null) {
        core.dbDeleteRecord(namespace, instanceId, table, id)
    } else {
        core.dbSingleDeleteRecord(namespace, table, id)
    }
}

@Suppress("UNCHECKED_CAST")
private suspend fun coreBatch(
    core: GeneratedDbApi,
    namespace: String,
    instanceId: String?,
    table: String,
    body: Map<String, Any?>,
    query: Map<String, String>? = null
): Any? {
    return if (instanceId != null) {
        core.dbBatchRecords(namespace, instanceId, table, body, query)
    } else {
        core.dbSingleBatchRecords(namespace, table, body, query)
    }
}

@Suppress("UNCHECKED_CAST")
private suspend fun coreBatchByFilter(
    core: GeneratedDbApi,
    namespace: String,
    instanceId: String?,
    table: String,
    body: Map<String, Any?>,
    query: Map<String, String>? = null
): Any? {
    return if (instanceId != null) {
        core.dbBatchByFilter(namespace, instanceId, table, body, query)
    } else {
        core.dbSingleBatchByFilter(namespace, table, body, query)
    }
}

private fun buildDatabaseLiveChannel(
    namespace: String,
    instanceId: String?,
    table: String,
    docId: String? = null
): String {
    val base = if (instanceId != null) {
        "dblive:$namespace:$instanceId:$table"
    } else {
        "dblive:$namespace:$table"
    }
    return if (docId != null) "$base:$docId" else base
}

// MARK: - TableRef

/**
 * Immutable table reference with query builder.
 *
 * All chaining methods return a new instance — safe for reference sharing.
 * All HTTP calls delegate to [GeneratedDbApi] — no hardcoded API paths.
 *
 * Usage:
 * ```kotlin
 * val posts = client.db("shared").table("posts")
 *     .where("status", "==", "published")
 *     .orderBy("createdAt", "desc")
 *     .limit(20)
 *     .getList()
 * ```
 */
class TableRef(
    private val core: GeneratedDbApi,
    val name: String,
    private val databaseLive: DatabaseLiveClient?,
    private val namespace: String = "shared",
    private val instanceId: String? = null,
    private val filters: List<FilterTuple> = emptyList(),
    private val orFilters: List<FilterTuple> = emptyList(),
    private val sorts: List<Pair<String, String>> = emptyList(),
    private val limitValue: Int? = null,
    private val offsetValue: Int? = null,
    private val pageValue: Int? = null,
    private val searchValue: String? = null,
    private val afterCursor: String? = null,
    private val beforeCursor: String? = null
) {
    // MARK: - Query Builder (immutable — returns new instances)

    fun where(field: String, op: String, value: Any?): TableRef =
        clone(filters = filters + FilterTuple(field, op, value))

    /** Add OR conditions. */
    fun or(builderFn: (OrBuilder) -> Unit): TableRef {
        val builder = OrBuilder()
        builderFn(builder)
        return clone(orFilters = orFilters + builder.getFilters())
    }

    fun orderBy(field: String, direction: String = "asc"): TableRef =
        clone(sorts = sorts + (field to direction))

    fun limit(n: Int): TableRef = clone(limitValue = n)
    fun offset(n: Int): TableRef = clone(offsetValue = n)
    /** Set page number for offset pagination (1-based). */
    fun page(n: Int): TableRef = clone(pageValue = n)
    fun search(query: String): TableRef = clone(searchValue = query)

    /** Set cursor for forward pagination.
     * Fetches records with id > cursor. Mutually exclusive with offset(). */
    fun after(cursor: String): TableRef = clone(afterCursor = cursor, beforeCursor = null)

    /** Set cursor for backward pagination.
     * Fetches records with id < cursor. Mutually exclusive with offset(). */
    fun before(cursor: String): TableRef = clone(beforeCursor = cursor, afterCursor = null)

    // MARK: - CRUD

    /** List records. */
    @Suppress("UNCHECKED_CAST")
    suspend fun getList(): ListResult {
        val params = buildQueryParams()
        val json: Map<String, Any?> = if (searchValue != null) {
            params["search"] = searchValue!!
            coreSearch(core, namespace, instanceId, name, params) as Map<String, Any?>
        } else {
            coreList(core, namespace, instanceId, name, params) as Map<String, Any?>
        }
        return ListResult(
            items = (json["items"] as? List<Map<String, Any?>>) ?: emptyList(),
            total = (json["total"] as? Number)?.toInt(),
            page = (json["page"] as? Number)?.toInt(),
            perPage = (json["perPage"] as? Number)?.toInt(),
            hasMore = json["hasMore"] as? Boolean,
            cursor = json["cursor"] as? String
        )
    }

    /** Get a single record by ID — convenience shorthand for doc(id).get(). */
    @Suppress("UNCHECKED_CAST")
    suspend fun getOne(id: String): Map<String, Any?> = doc(id).get()

    /** Get the first record matching the current query conditions. Returns null if no match. */
    suspend fun getFirst(): Map<String, Any?>? {
        val result = limit(1).getList()
        return result.items.firstOrNull()
    }

    @Suppress("UNCHECKED_CAST")
    suspend fun insert(record: Map<String, Any?>): Map<String, Any?> {
        return coreInsert(core, namespace, instanceId, name, record) as Map<String, Any?>
    }

    /** Convenience: update a record by ID. Delegate to doc(id).update(data). */
    @Suppress("UNCHECKED_CAST")
    suspend fun update(id: String, data: Map<String, Any?>): Map<String, Any?> {
        return coreUpdate(core, namespace, instanceId, name, id, data) as Map<String, Any?>
    }

    /** Convenience: delete a record by ID. Delegate to doc(id).delete(). */
    suspend fun delete(id: String) {
        coreDelete(core, namespace, instanceId, name, id)
    }

    @Suppress("UNCHECKED_CAST")
    suspend fun upsert(record: Map<String, Any?>, conflictTarget: String? = null): UpsertResult {
        val query = mutableMapOf("upsert" to "true")
        if (conflictTarget != null) query["conflictTarget"] = conflictTarget
        val json = coreInsert(core, namespace, instanceId, name, record, query) as Map<String, Any?>
        return UpsertResult(
            record = json,
            inserted = json["action"] == "inserted"
        )
    }

    @Suppress("UNCHECKED_CAST")
    suspend fun count(): Int {
        val params = buildQueryParams()
        val json = coreCount(core, namespace, instanceId, name, params) as Map<String, Any?>
        return (json["total"] as? Number)?.toInt() ?: 0
    }

    // MARK: - Batch Operations

    /**
     * Batch create — auto-chunks into 500-item batches.
     * Each chunk is an independent all-or-nothing transaction.
     */
    @Suppress("UNCHECKED_CAST")
    suspend fun insertMany(records: List<Map<String, Any?>>): List<Map<String, Any?>> {
        val chunkSize = 500

        // Fast path: no chunking needed
        if (records.size <= chunkSize) {
            val json = coreBatch(core, namespace, instanceId, name,
                mapOf("inserts" to records)) as Map<String, Any?>
            return (json["inserted"] as? List<Map<String, Any?>>) ?: emptyList()
        }

        // Chunk into 500-item batches
        val allInserted = mutableListOf<Map<String, Any?>>()
        for (i in records.indices step chunkSize) {
            val chunk = records.subList(i, minOf(i + chunkSize, records.size))
            val json = coreBatch(core, namespace, instanceId, name,
                mapOf("inserts" to chunk)) as Map<String, Any?>
            allInserted.addAll((json["inserted"] as? List<Map<String, Any?>>) ?: emptyList())
        }
        return allInserted
    }

    /**
     * Batch upsert — auto-chunks into 500-item batches.
     */
    @Suppress("UNCHECKED_CAST")
    suspend fun upsertMany(records: List<Map<String, Any?>>, conflictTarget: String? = null): List<Map<String, Any?>> {
        val chunkSize = 500
        val query = mutableMapOf("upsert" to "true")
        if (conflictTarget != null) query["conflictTarget"] = conflictTarget

        // Fast path: no chunking needed
        if (records.size <= chunkSize) {
            val json = coreBatch(core, namespace, instanceId, name,
                mapOf("inserts" to records), query) as Map<String, Any?>
            return (json["inserted"] as? List<Map<String, Any?>>) ?: emptyList()
        }

        // Chunk into 500-item batches
        val allInserted = mutableListOf<Map<String, Any?>>()
        for (i in records.indices step chunkSize) {
            val chunk = records.subList(i, minOf(i + chunkSize, records.size))
            val json = coreBatch(core, namespace, instanceId, name,
                mapOf("inserts" to chunk), query) as Map<String, Any?>
            allInserted.addAll((json["inserted"] as? List<Map<String, Any?>>) ?: emptyList())
        }
        return allInserted
    }

    /**
     * Batch update matching records.
     * Uses query builder filters, processes 500 records per call, max 100 iterations.
     */
    suspend fun updateMany(update: Map<String, Any?>): BatchResult {
        require(filters.isNotEmpty()) { "updateMany requires at least one where() filter" }
        return batchByFilter("update", update)
    }

    /**
     * Batch delete matching records.
     * Uses query builder filters, processes 500 records per call, max 100 iterations.
     */
    suspend fun deleteMany(): BatchResult {
        require(filters.isNotEmpty()) { "deleteMany requires at least one where() filter" }
        return batchByFilter("delete", null)
    }

    /**
     * Internal: repeated batch-by-filter calls.
     */
    @Suppress("UNCHECKED_CAST")
    private suspend fun batchByFilter(action: String, update: Map<String, Any?>?): BatchResult {
        val maxIterations = 100
        var totalProcessed = 0
        var totalSucceeded = 0
        val errors = mutableListOf<Map<String, Any>>()
        val filterJson = filters.map { it.toJson() }

        for (chunkIndex in 0 until maxIterations) {
            try {
                val body = mutableMapOf<String, Any?>(
                    "action" to action,
                    "filter" to filterJson,
                    "limit" to 500
                )
                if (orFilters.isNotEmpty()) {
                    body["orFilter"] = orFilters.map { it.toJson() }
                }
                if (action == "update" && update != null) {
                    body["update"] = update
                }

                val json = coreBatchByFilter(core, namespace, instanceId, name, body) as Map<String, Any?>
                val processed = (json["processed"] as? Number)?.toInt() ?: 0
                val succeeded = (json["succeeded"] as? Number)?.toInt() ?: 0
                totalProcessed += processed
                totalSucceeded += succeeded

                if (processed == 0) break // No more matching records

                // For 'update', don't loop — updated records still match the filter,
                // so re-querying would process the same rows again (infinite loop).
                // Only 'delete' benefits from looping since deleted rows disappear.
                if (action == "update") break
            } catch (e: Exception) {
                errors.add(mapOf("chunkIndex" to chunkIndex, "chunkSize" to 500, "error" to (e.message ?: "Batch operation failed without an error message.")))
                break // Stop on error (partial failure)
            }
        }

        return BatchResult(totalProcessed = totalProcessed, totalSucceeded = totalSucceeded, errors = errors)
    }

    // MARK: - Document Reference

    fun doc(id: String): DocRef = DocRef(core, name, id, databaseLive, namespace, instanceId)

    // MARK: - DatabaseLive

    /**
     * Subscribe to table changes as a Flow.
     * Only available when using client-side SDK (EdgeBase.client()).
     */
    fun onSnapshot(): Flow<DbChange> {
        val rt = databaseLive ?: throw UnsupportedOperationException(
            "onSnapshot() is not available on the server SDK. Use EdgeBase.client() for database-live subscriptions."
        )
        return callbackFlow {
            val subscription = rt.subscribe(buildDatabaseLiveChannel(namespace, instanceId, name))
            //: Dispatchers.Default instead of Dispatchers.IO for KMP
            val scope = CoroutineScope(Dispatchers.Default)
            val job = scope.launch {
                subscription.collect { change ->
                    if (matchesFilters(change.record)) {
                        trySend(change)
                    }
                }
            }
            awaitClose { job.cancel() }
        }
    }

    // MARK: - Internal

    private fun clone(
        filters: List<FilterTuple> = this.filters,
        orFilters: List<FilterTuple> = this.orFilters,
        sorts: List<Pair<String, String>> = this.sorts,
        limitValue: Int? = this.limitValue,
        offsetValue: Int? = this.offsetValue,
        pageValue: Int? = this.pageValue,
        searchValue: String? = this.searchValue,
        afterCursor: String? = this.afterCursor,
        beforeCursor: String? = this.beforeCursor
    ) = TableRef(core, name, databaseLive, namespace, instanceId, filters, orFilters, sorts, limitValue, offsetValue, pageValue, searchValue, afterCursor, beforeCursor)

    private fun buildQueryParams(): MutableMap<String, String> {
        //: offset/cursor mutual exclusion
        val hasCursor = afterCursor != null || beforeCursor != null
        val hasOffset = offsetValue != null || pageValue != null
        require(!(hasCursor && hasOffset)) {
            "Cannot use page()/offset() with after()/before() — choose offset or cursor pagination"
        }

        val params = mutableMapOf<String, String>()
        if (filters.isNotEmpty()) {
            // Server expects JSON.parse(params.filter) — array of [field, op, value] tuples
            val filterElement = HttpClient.anyToJsonElement(filters.map { it.toJson() })
            params["filter"] = kotlinx.serialization.json.Json.encodeToString(
                kotlinx.serialization.json.JsonElement.serializer(), filterElement
            )
        }
        if (orFilters.isNotEmpty()) {
            val orFilterElement = HttpClient.anyToJsonElement(orFilters.map { it.toJson() })
            params["orFilter"] = kotlinx.serialization.json.Json.encodeToString(
                kotlinx.serialization.json.JsonElement.serializer(), orFilterElement
            )
        }
        if (sorts.isNotEmpty()) {
            params["sort"] = sorts.joinToString(",") { "${it.first}:${it.second}" }
        }
        limitValue?.let { params["limit"] = it.toString() }
        pageValue?.let { params["page"] = it.toString() }
        offsetValue?.let { params["offset"] = it.toString() }
        afterCursor?.let { params["after"] = it }
        beforeCursor?.let { params["before"] = it }
        return params
    }

    @Suppress("UNCHECKED_CAST")
    private fun matchesFilters(record: Map<String, Any?>?): Boolean {
        if (record == null) return true // Deletions always pass

        val andPass = filters.isEmpty() || filters.all { filter ->
            val fieldValue = record[filter.field]
            matchFilter(fieldValue, filter.op, filter.value)
        }
        if (!andPass) return false

        if (orFilters.isNotEmpty()) {
            val orPass = orFilters.any { filter ->
                val fieldValue = record[filter.field]
                matchFilter(fieldValue, filter.op, filter.value)
            }
            if (!orPass) return false
        }

        return true
    }

    private fun matchFilter(fieldValue: Any?, op: String, filterValue: Any?): Boolean {
        return when (op) {
            "==" -> fieldValue == filterValue
            "!=" -> fieldValue != filterValue
            ">" -> compareValues(fieldValue, filterValue) > 0
            ">=" -> compareValues(fieldValue, filterValue) >= 0
            "<" -> compareValues(fieldValue, filterValue) < 0
            "<=" -> compareValues(fieldValue, filterValue) <= 0
            "in" -> (filterValue as? List<*>)?.contains(fieldValue) ?: false
            "contains" -> (fieldValue as? List<*>)?.contains(filterValue) ?: (fieldValue as? String)?.contains(filterValue as? CharSequence ?: "") ?: false
            else -> true
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun compareValues(a: Any?, b: Any?): Int {
        if (a == null && b == null) return 0
        if (a == null) return -1
        if (b == null) return 1
        return when {
            a is Comparable<*> && b is Comparable<*> -> (a as Comparable<Any>).compareTo(b as Any)
            else -> a.toString().compareTo(b.toString())
        }
    }
}

// MARK: - DocRef

/**
 * Document reference for single-document operations.
 * All HTTP calls delegate to [GeneratedDbApi] — no hardcoded API paths.
 */
class DocRef(
    private val core: GeneratedDbApi,
    val tableName: String,
    val id: String,
    private val databaseLive: DatabaseLiveClient?,
    private val namespace: String = "shared",
    private val instanceId: String? = null
) {
    @Suppress("UNCHECKED_CAST")
    suspend fun get(): Map<String, Any?> {
        return coreGet(core, namespace, instanceId, tableName, id) as Map<String, Any?>
    }

    @Suppress("UNCHECKED_CAST")
    suspend fun update(data: Map<String, Any?>): Map<String, Any?> {
        return coreUpdate(core, namespace, instanceId, tableName, id, data) as Map<String, Any?>
    }

    @Suppress("UNCHECKED_CAST")
    suspend fun delete(): Map<String, Any?> {
        return coreDelete(core, namespace, instanceId, tableName, id) as Map<String, Any?>
    }

    /**
     * Subscribe to this document's changes as a Flow.
     * Only available when using client-side SDK (EdgeBase.client()).
     */
    fun onSnapshot(): Flow<DbChange> {
        val rt = databaseLive ?: throw UnsupportedOperationException(
            "onSnapshot() is not available on the server SDK. Use EdgeBase.client() for database-live subscriptions."
        )
        return callbackFlow {
            val subscription = rt.subscribe(buildDatabaseLiveChannel(namespace, instanceId, tableName, id))
            //: Dispatchers.Default instead of Dispatchers.IO for KMP
            val scope = CoroutineScope(Dispatchers.Default)
            val job = scope.launch {
                subscription.collect { change ->
                    trySend(change)
                }
            }
            awaitClose { job.cancel() }
        }
    }
}
