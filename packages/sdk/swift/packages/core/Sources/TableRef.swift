// Collection Reference — immutable query builder + CRUD.
//
// All HTTP calls delegate to GeneratedDbApi (Generated/ApiCore.swift).
// No hardcoded API paths — the generated core is the single source of truth.
//
// Mirrors JS SDK table.ts with Swift idioms:
// - Struct-based immutable builder for safe reference sharing (M5 lesson)
// - async/await for all operations
// - AsyncStream for database-live subscriptions
// - CONCEPT.md batch methods: insertMany/upsertMany/updateMany/deleteMany

import Foundation

// MARK: - Types

/// Query filter tuple.
/// value is stored as String (JSON-serialized) for Sendable conformance in Swift 6.
public struct FilterTuple: Sendable {
    public let field: String
    public let op: String
    public let value: String  // Always String-encoded for Sendable safety

    public init(_ field: String, _ op: String, _ value: Any) {
        self.field = field
        self.op = op
        self.value = "\(value)"
    }

    public func toJSON() -> [Any] {
        [field, op, value]
    }
}

/// Builder for OR conditions.
public final class OrBuilder: @unchecked Sendable {
    private var filters: [FilterTuple] = []

    public init() {}

    @discardableResult
    public func `where`(_ field: String, _ op: String, _ value: Any) -> Self {
        filters.append(FilterTuple(field, op, value))
        return self
    }

    public func getFilters() -> [FilterTuple] {
        return filters
    }
}

/// List result — unified type for both offset and cursor pagination.
///: SDK ListResult unification + cursor pagination support.
///
/// Offset mode (default):  total/page/perPage are populated, hasMore/cursor are nil.
/// Cursor mode (.after/.before): hasMore/cursor are populated, total/page/perPage are nil.
/// Rules-filtered mode:    total is nil, hasMore/cursor are populated.
public struct ListResult: @unchecked Sendable {
    public let items: [[String: Any]]
    public let total: Int?
    public let page: Int?
    public let perPage: Int?
    public let hasMore: Bool?
    public let cursor: String?

    public init(items: [[String: Any]], total: Int?, page: Int?, perPage: Int?,
                hasMore: Bool?, cursor: String?) {
        self.items = items
        self.total = total
        self.page = page
        self.perPage = perPage
        self.hasMore = hasMore
        self.cursor = cursor
    }

}

/// Upsert result.
public struct UpsertResult: @unchecked Sendable {
    public let record: [String: Any]
    public let inserted: Bool

    public init(record: [String: Any], inserted: Bool) {
        self.record = record
        self.inserted = inserted
    }
}

/// Batch operation result.
public struct BatchResult: @unchecked Sendable {
    public let totalProcessed: Int
    public let totalSucceeded: Int
    public let errors: [[String: Any]]

    public init(totalProcessed: Int, totalSucceeded: Int, errors: [[String: Any]]) {
        self.totalProcessed = totalProcessed
        self.totalSucceeded = totalSucceeded
        self.errors = errors
    }
}

// MARK: - Core Dispatch Helpers

/// Route to the correct generated core method based on single-instance vs dynamic DB.
/// These mirror the JS SDK's coreGet/coreInsert/coreUpdate/coreDelete/coreBatch/coreBatchByFilter.

private func coreList(
    _ core: GeneratedDbApi, namespace: String, instanceId: String?, table: String,
    query: [String: String]?
) async throws -> Any {
    if let id = instanceId {
        return try await core.dbListRecords(namespace, id, table, query: query)
    }
    return try await core.dbSingleListRecords(namespace, table, query: query)
}

private func coreSearch(
    _ core: GeneratedDbApi, namespace: String, instanceId: String?, table: String,
    query: [String: String]?
) async throws -> Any {
    if let id = instanceId {
        return try await core.dbSearchRecords(namespace, id, table, query: query)
    }
    return try await core.dbSingleSearchRecords(namespace, table, query: query)
}

private func coreCount(
    _ core: GeneratedDbApi, namespace: String, instanceId: String?, table: String,
    query: [String: String]?
) async throws -> Any {
    if let id = instanceId {
        return try await core.dbCountRecords(namespace, id, table, query: query)
    }
    return try await core.dbSingleCountRecords(namespace, table, query: query)
}

private func coreGetRecord(
    _ core: GeneratedDbApi, namespace: String, instanceId: String?, table: String,
    recordId: String, query: [String: String]?
) async throws -> Any {
    if let id = instanceId {
        return try await core.dbGetRecord(namespace, id, table, recordId, query: query)
    }
    return try await core.dbSingleGetRecord(namespace, table, recordId, query: query)
}

private func coreInsert(
    _ core: GeneratedDbApi, namespace: String, instanceId: String?, table: String,
    body: [String: Any], query: [String: String]?
) async throws -> Any {
    if let id = instanceId {
        return try await core.dbInsertRecord(namespace, id, table, body, query: query)
    }
    return try await core.dbSingleInsertRecord(namespace, table, body, query: query)
}

private func coreUpdate(
    _ core: GeneratedDbApi, namespace: String, instanceId: String?, table: String,
    recordId: String, body: [String: Any]
) async throws -> Any {
    if let id = instanceId {
        return try await core.dbUpdateRecord(namespace, id, table, recordId, body)
    }
    return try await core.dbSingleUpdateRecord(namespace, table, recordId, body)
}

private func coreDeleteRecord(
    _ core: GeneratedDbApi, namespace: String, instanceId: String?, table: String,
    recordId: String
) async throws -> Any {
    if let id = instanceId {
        return try await core.dbDeleteRecord(namespace, id, table, recordId)
    }
    return try await core.dbSingleDeleteRecord(namespace, table, recordId)
}

private func coreBatch(
    _ core: GeneratedDbApi, namespace: String, instanceId: String?, table: String,
    body: [String: Any], query: [String: String]?
) async throws -> Any {
    if let id = instanceId {
        return try await core.dbBatchRecords(namespace, id, table, body, query: query)
    }
    return try await core.dbSingleBatchRecords(namespace, table, body, query: query)
}

private func coreBatchByFilter(
    _ core: GeneratedDbApi, namespace: String, instanceId: String?, table: String,
    body: [String: Any], query: [String: String]?
) async throws -> Any {
    if let id = instanceId {
        return try await core.dbBatchByFilter(namespace, id, table, body, query: query)
    }
    return try await core.dbSingleBatchByFilter(namespace, table, body, query: query)
}

private func buildDatabaseLiveChannel(
    namespace: String,
    instanceId: String?,
    table: String,
    docId: String? = nil
) -> String {
    let base = instanceId != nil
        ? "dblive:\(namespace):\(instanceId!):\(table)"
        : "dblive:\(namespace):\(table)"
    if let docId {
        return "\(base):\(docId)"
    }
    return base
}

// MARK: - Collection Reference

/// Collection reference — immutable query builder + CRUD.
/// Every chaining method returns a new instance (M5 lesson: safe reference sharing).
public final class TableRef: @unchecked Sendable {
    private let core: GeneratedDbApi
    private let databaseLive: DatabaseLiveClient?
    public let name: String
    /// DB block namespace: 'shared' | 'workspace' | 'user' | ... (#133 §2)
    private let namespace: String
    /// Dynamic DO instance ID (e.g. 'ws-456'). Nil for static DBs.
    private let instanceId: String?
    private let filters: [FilterTuple]
    private let orFilters: [FilterTuple] //
    private let sorts: [[String]]
    private let limitCount: Int?
    private let pageNum: Int?
    private let offsetCount: Int?
    private let searchQuery: String?
    private let afterCursorValue: String?
    private let beforeCursorValue: String?

    public init(
        _ core: GeneratedDbApi,
        _ name: String,
        databaseLive: DatabaseLiveClient? = nil,
        namespace: String = "shared",
        instanceId: String? = nil,
        filters: [FilterTuple] = [],
        orFilters: [FilterTuple] = [],
        sorts: [[String]] = [],
        limitCount: Int? = nil,
        pageNum: Int? = nil,
        offsetCount: Int? = nil,
        searchQuery: String? = nil,
        afterCursor: String? = nil,
        beforeCursor: String? = nil
    ) {
        self.core = core
        self.name = name
        self.databaseLive = databaseLive
        self.namespace = namespace
        self.instanceId = instanceId
        self.filters = filters
        self.orFilters = orFilters
        self.sorts = sorts
        self.limitCount = limitCount
        self.pageNum = pageNum
        self.offsetCount = offsetCount
        self.searchQuery = searchQuery
        self.afterCursorValue = afterCursor
        self.beforeCursorValue = beforeCursor
    }

    /// Clone with modifications (immutable builder).
    private func clone(
        filters: [FilterTuple]? = nil,
        orFilters: [FilterTuple]? = nil,
        sorts: [[String]]? = nil,
        limitCount: Int?? = nil,
        pageNum: Int?? = nil,
        offsetCount: Int?? = nil,
        searchQuery: String?? = nil,
        afterCursor: String?? = nil,
        beforeCursor: String?? = nil
    ) -> TableRef {
        TableRef(
            core, name,
            databaseLive: databaseLive,
            namespace: namespace,
            instanceId: instanceId,
            filters: filters ?? self.filters,
            orFilters: orFilters ?? self.orFilters,
            sorts: sorts ?? self.sorts,
            limitCount: limitCount ?? self.limitCount,
            pageNum: pageNum ?? self.pageNum,
            offsetCount: offsetCount ?? self.offsetCount,
            searchQuery: searchQuery ?? self.searchQuery,
            afterCursor: afterCursor ?? self.afterCursorValue,
            beforeCursor: beforeCursor ?? self.beforeCursorValue
        )
    }

    // MARK: - Immutable Query Builder

    /// Add a filter condition.
    public func `where`(_ field: String, _ op: String, _ value: Any) -> TableRef {
        var newFilters = filters
        newFilters.append(FilterTuple(field, op, value))
        return clone(filters: newFilters)
    }

    /// Add OR conditions.
    public func or(_ builderFn: (OrBuilder) -> Void) -> TableRef {
        let builder = OrBuilder()
        builderFn(builder)
        var newOrFilters = orFilters
        newOrFilters.append(contentsOf: builder.getFilters())
        return clone(orFilters: newOrFilters)
    }

    /// Add sort order (supports multiple — chained calls accumulate).
    public func orderBy(_ field: String, _ direction: String = "asc") -> TableRef {
        clone(sorts: sorts + [[field, direction]])
    }

    /// Set limit.
    public func limit(_ count: Int) -> TableRef {
        clone(limitCount: .some(count))
    }

    /// Set page for pagination.
    public func page(_ num: Int) -> TableRef {
        clone(pageNum: .some(num))
    }

    /// Set offset for pagination.
    public func offset(_ count: Int) -> TableRef {
        clone(offsetCount: .some(count))
    }


    /// Full-text search.
    public func search(_ query: String) -> TableRef {
        clone(searchQuery: .some(query))
    }

    /// Set cursor for forward pagination.
    /// Fetches records with id > cursor. Mutually exclusive with page()/offset().
    public func after(_ cursor: String) -> TableRef {
        clone(afterCursor: .some(cursor), beforeCursor: .some(nil))
    }

    /// Set cursor for backward pagination.
    /// Fetches records with id < cursor. Mutually exclusive with page()/offset().
    public func before(_ cursor: String) -> TableRef {
        clone(afterCursor: .some(nil), beforeCursor: .some(cursor))
    }

    /// Build query params as a dictionary for the generated core.
    private func buildQueryParams() -> [String: String] {
        //: offset/cursor mutual exclusion
        let hasCursor = afterCursorValue != nil || beforeCursorValue != nil
        let hasOffset = offsetCount != nil || pageNum != nil
        precondition(!(hasCursor && hasOffset),
            "Cannot use page()/offset() with after()/before() — choose offset or cursor pagination")

        var params: [String: String] = [:]
        if !filters.isEmpty {
            let filterArray = filters.map { $0.toJSON() }
            if let data = try? JSONSerialization.data(withJSONObject: filterArray),
               let jsonStr = String(data: data, encoding: .utf8) {
                params["filter"] = jsonStr
            }
        }
        if !orFilters.isEmpty {
            let orArray = orFilters.map { $0.toJSON() }
            if let data = try? JSONSerialization.data(withJSONObject: orArray),
               let jsonStr = String(data: data, encoding: .utf8) {
                params["orFilter"] = jsonStr
            }
        }
        if !sorts.isEmpty {
            params["sort"] = sorts.map { "\($0[0]):\($0[1])" }.joined(separator: ",")
        }
        if let limit = limitCount { params["limit"] = "\(limit)" }
        if let page = pageNum { params["page"] = "\(page)" }
        if let offset = offsetCount { params["offset"] = "\(offset)" }
        if let ac = afterCursorValue { params["after"] = ac }
        if let bc = beforeCursorValue { params["before"] = bc }
        return params
    }

    // MARK: - Read Operations

    /// Get list of records.
    public func getList() async throws -> ListResult {
        var query = buildQueryParams()
        let json: [String: Any]
        if let search = searchQuery {
            query["search"] = search
            json = try await coreSearch(core, namespace: namespace, instanceId: instanceId, table: name, query: query) as! [String: Any]
        } else {
            json = try await coreList(core, namespace: namespace, instanceId: instanceId, table: name, query: query) as! [String: Any]
        }
        let items = (json["items"] as? [[String: Any]]) ?? []
        return ListResult(
            items: items,
            total: json["total"] as? Int,
            page: json["page"] as? Int,
            perPage: json["perPage"] as? Int,
            hasMore: json["hasMore"] as? Bool,
            cursor: json["cursor"] as? String
        )
    }

    /// JS-compatible alias that returns the raw list payload shape.
    /// This keeps one-app scenarios aligned across SDKs while preserving
    /// `getList()` as the typed Swift-first API.
    public func get() async throws -> [String: Any] {
        let result = try await getList()
        var json: [String: Any] = ["items": result.items]
        if let total = result.total { json["total"] = total }
        if let page = result.page { json["page"] = page }
        if let perPage = result.perPage { json["perPage"] = perPage }
        if let hasMore = result.hasMore { json["hasMore"] = hasMore }
        if let cursor = result.cursor { json["cursor"] = cursor }
        return json
    }

    /// Get record count.
    public func count() async throws -> Int {
        let query = buildQueryParams()
        let json = try await coreCount(core, namespace: namespace, instanceId: instanceId, table: name, query: query) as! [String: Any]
        return json["total"] as! Int
    }

    // MARK: - Document Reference

    /// Get a single document reference.
    public func doc(_ id: String) -> DocRef {
        DocRef(core, namespace: namespace, instanceId: instanceId, tableName: name, id: id, databaseLive: databaseLive)
    }

    /// Get a single record by ID — convenience shorthand for doc(id).get().
    public func getOne(_ id: String) async throws -> [String: Any] {
        try await doc(id).get()
    }

    /// Get the first record matching the current query conditions.
    /// Returns nil if no records match.
    public func getFirst() async throws -> [String: Any]? {
        let result = try await limit(1).getList()
        return result.items.first
    }

    // MARK: - Write Operations

    /// Insert a new record.
    public func insert(_ data: [String: Any]) async throws -> [String: Any] {
        try await coreInsert(core, namespace: namespace, instanceId: instanceId, table: name, body: data, query: nil) as! [String: Any]
    }

    /// Upsert a record.
    /// - Parameter conflictTarget: unique field for conflict detection (defaults to "id")
    public func upsert(_ data: [String: Any], conflictTarget: String? = nil) async throws -> UpsertResult {
        var query: [String: String] = ["upsert": "true"]
        if let ct = conflictTarget { query["conflictTarget"] = ct }
        let json = try await coreInsert(core, namespace: namespace, instanceId: instanceId, table: name, body: data, query: query) as! [String: Any]
        return UpsertResult(
            record: json,
            inserted: (json["action"] as? String) == "inserted"
        )
    }

    // MARK: - Batch Operations

    /// Insert multiple records at once.
    /// Auto-chunks into 500-item batches.
    /// Each chunk is an independent all-or-nothing transaction.
    public func insertMany(_ records: [[String: Any]]) async throws -> [[String: Any]] {
        let chunkSize = 500

        // Fast path: no chunking needed
        if records.count <= chunkSize {
            let json = try await coreBatch(core, namespace: namespace, instanceId: instanceId, table: name, body: ["inserts": records], query: nil) as! [String: Any]
            return (json["inserted"] as? [[String: Any]]) ?? []
        }

        // Chunk into 500-item batches
        var allInserted: [[String: Any]] = []
        var i = 0
        while i < records.count {
            let end = min(i + chunkSize, records.count)
            let chunk = Array(records[i..<end])
            let json = try await coreBatch(core, namespace: namespace, instanceId: instanceId, table: name, body: ["inserts": chunk], query: nil) as! [String: Any]
            allInserted.append(contentsOf: (json["inserted"] as? [[String: Any]]) ?? [])
            i += chunkSize
        }
        return allInserted
    }

    /// Batch upsert — insert or update multiple records.
    /// Auto-chunks into 500-item batches.
    public func upsertMany(_ records: [[String: Any]], conflictTarget: String? = nil) async throws -> [[String: Any]] {
        let chunkSize = 500
        var query: [String: String] = ["upsert": "true"]
        if let ct = conflictTarget { query["conflictTarget"] = ct }

        // Fast path: no chunking needed
        if records.count <= chunkSize {
            let json = try await coreBatch(core, namespace: namespace, instanceId: instanceId, table: name, body: ["inserts": records], query: query) as! [String: Any]
            return (json["inserted"] as? [[String: Any]]) ?? []
        }

        // Chunk into 500-item batches
        var allInserted: [[String: Any]] = []
        var i = 0
        while i < records.count {
            let end = min(i + chunkSize, records.count)
            let chunk = Array(records[i..<end])
            let json = try await coreBatch(core, namespace: namespace, instanceId: instanceId, table: name, body: ["inserts": chunk], query: query) as! [String: Any]
            allInserted.append(contentsOf: (json["inserted"] as? [[String: Any]]) ?? [])
            i += chunkSize
        }
        return allInserted
    }

    /// Update all records matching current filters (batch-by-filter,).
    /// Processes 500 records per call, max 100 iterations.
    public func updateMany(_ data: [String: Any]) async throws -> BatchResult {
        guard !filters.isEmpty else {
            throw EdgeBaseError(statusCode: 400, message: "updateMany requires at least one where() filter")
        }
        return try await batchByFilterLoop(action: "update", update: data)
    }

    /// Legacy alias for updateMany.
    public func updateByFilter(_ data: [String: Any]) async throws -> BatchResult {
        try await updateMany(data)
    }

    /// Delete all records matching current filters (batch-by-filter,).
    /// Processes 500 records per call, max 100 iterations.
    public func deleteMany() async throws -> BatchResult {
        guard !filters.isEmpty else {
            throw EdgeBaseError(statusCode: 400, message: "deleteMany requires at least one where() filter")
        }
        return try await batchByFilterLoop(action: "delete", update: nil)
    }

    /// Legacy alias for deleteMany.
    public func deleteByFilter() async throws -> BatchResult {
        try await deleteMany()
    }

    /// Internal: repeated batch-by-filter calls.
    private func batchByFilterLoop(action: String, update: [String: Any]?) async throws -> BatchResult {
        let maxIterations = 100
        var totalProcessed = 0
        var totalSucceeded = 0
        var errors: [[String: Any]] = []
        let filterJSON = filters.map { $0.toJSON() }

        for chunkIndex in 0..<maxIterations {
            var body: [String: Any] = [
                "action": action,
                "filter": filterJSON,
                "limit": 500
            ]
            if !orFilters.isEmpty {
                body["orFilter"] = orFilters.map { $0.toJSON() }
            }
            if action == "update", let update = update {
                body["update"] = update
            }

            do {
                let json = try await coreBatchByFilter(
                    core, namespace: namespace, instanceId: instanceId,
                    table: name, body: body, query: nil
                ) as! [String: Any]

                let processed = json["processed"] as? Int ?? 0
                let succeeded = json["succeeded"] as? Int ?? 0
                totalProcessed += processed
                totalSucceeded += succeeded

                if processed == 0 { break } // No more matching records

                // For 'update', don't loop — updated records still match the filter,
                // so re-querying would process the same rows again (infinite loop).
                // Only 'delete' benefits from looping since deleted rows disappear.
                if action == "update" { break }
            } catch {
                errors.append(["chunkIndex": chunkIndex, "chunkSize": 500, "error": error.localizedDescription])
                break // Stop on error (partial failure)
            }
        }

        return BatchResult(
            totalProcessed: totalProcessed,
            totalSucceeded: totalSucceeded,
            errors: errors
        )
    }

    // MARK: - DatabaseLive

    /// Subscribe to table changes. Returns AsyncStream of DbChange.
    ///
    /// ```swift
    /// for await change in client.table("posts")
    ///     .where("status", "==", "published")
    ///     .onSnapshot() {
    ///     print(change.record)
    /// }
    /// ```
    public func onSnapshot() -> AsyncStream<DbChange> {
        guard let databaseLive = databaseLive else {
            fatalError("DatabaseLiveClient not available. Ensure EdgeBase is properly initialized.")
        }

        let rawStream = databaseLive.subscribe(buildDatabaseLiveChannel(namespace: namespace, instanceId: instanceId, table: name))

        if filters.isEmpty && orFilters.isEmpty {
            return rawStream
        }

        // Apply client-side filtering
        let capturedFilters = filters
        let capturedOrFilters = orFilters
        return AsyncStream { continuation in
            Task {
                for await change in rawStream {
                    if matchesFilters(change, filters: capturedFilters, orFilters: capturedOrFilters) {
                        continuation.yield(change)
                    }
                }
                continuation.finish()
            }
        }
    }

    /// Client-side filter matching.
    private func matchesFilters(_ change: DbChange, filters: [FilterTuple], orFilters: [FilterTuple]) -> Bool {
        guard let record = change.record else { return true } // Deletions pass

        let andPass = filters.allSatisfy { f in
            let fieldValue = record[f.field]
            return matchFilter(fieldValue, f.op, f.value)
        }
        if !andPass { return false }

        if !orFilters.isEmpty {
            return orFilters.contains { f in
                let fieldValue = record[f.field]
                return matchFilter(fieldValue, f.op, f.value)
            }
        }
        return true
    }

    private func matchFilter(_ fieldValue: Any?, _ op: String, _ filterValue: Any) -> Bool {
        switch op {
        case "==": return "\(fieldValue ?? "nil")" == "\(filterValue)"
        case "!=": return "\(fieldValue ?? "nil")" != "\(filterValue)"
        case ">":
            guard let fv = fieldValue as? Double, let cv = filterValue as? Double else { return false }
            return fv > cv
        case ">=":
            guard let fv = fieldValue as? Double, let cv = filterValue as? Double else { return false }
            return fv >= cv
        case "<":
            guard let fv = fieldValue as? Double, let cv = filterValue as? Double else { return false }
            return fv < cv
        case "<=":
            guard let fv = fieldValue as? Double, let cv = filterValue as? Double else { return false }
            return fv <= cv
        case "contains":
            if let fv = fieldValue as? String, let cv = filterValue as? String {
                return fv.contains(cv)
            }
            if let fv = fieldValue as? [Any] {
                return fv.contains(where: { "\($0)" == "\(filterValue)" })
            }
            return false
        case "in":
            if let cv = filterValue as? [Any] {
                return cv.contains(where: { "\($0)" == "\(fieldValue ?? "nil")" })
            }
            return false
        default:
            return true
        }
    }
}

// MARK: - Document Reference

/// Single document reference.
public final class DocRef: @unchecked Sendable {
    private let core: GeneratedDbApi
    private let databaseLive: DatabaseLiveClient?
    public let tableName: String
    public let id: String
    private let namespace: String
    private let instanceId: String?

    public init(_ core: GeneratedDbApi, namespace: String = "shared", instanceId: String? = nil,
                tableName: String, id: String, databaseLive: DatabaseLiveClient? = nil) {
        self.core = core
        self.tableName = tableName
        self.id = id
        self.databaseLive = databaseLive
        self.namespace = namespace
        self.instanceId = instanceId
    }

    /// Get a single record.
    public func get() async throws -> [String: Any] {
        try await coreGetRecord(core, namespace: namespace, instanceId: instanceId, table: tableName, recordId: id, query: nil) as! [String: Any]
    }

    /// Update a record.
    public func update(_ data: [String: Any]) async throws -> [String: Any] {
        try await coreUpdate(core, namespace: namespace, instanceId: instanceId, table: tableName, recordId: id, body: data) as! [String: Any]
    }

    /// Delete a record.
    public func delete() async throws {
        _ = try await coreDeleteRecord(core, namespace: namespace, instanceId: instanceId, table: tableName, recordId: id)
    }

    /// Subscribe to this document's changes.
    public func onSnapshot() -> AsyncStream<DbChange> {
        guard let databaseLive = databaseLive else {
            fatalError("DatabaseLiveClient not available.")
        }

        let rawStream = databaseLive.subscribe(buildDatabaseLiveChannel(namespace: namespace, instanceId: instanceId, table: tableName, docId: id))
        return AsyncStream { continuation in
            Task {
                for await change in rawStream {
                    continuation.yield(change)
                }
                continuation.finish()
            }
        }
    }
}
