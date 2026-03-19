// Collection reference with immutable query builder.
//
// Mirrors JS SDK TableRef with Dart idioms.
// M5 lesson: immutable query builder = safe reference sharing.
//
// All HTTP calls delegate to Generated Core (api_core.dart).
// No hardcoded API paths — the core is the single source of truth.

import 'dart:async';
import 'dart:convert';
import 'generated/api_core.dart';
import 'database_live_client.dart';

/// Sentinel value for distinguishing "not passed" from "null" in _clone().
const Object _sentinel = Object();

/// Query filter tuple.
class FilterTuple {
  final String field;
  final String operator;
  final dynamic value;

  FilterTuple(this.field, this.operator, this.value);

  List<dynamic> toJson() => [field, operator, value];
}

/// Builder for OR conditions.
class OrBuilder {
  final List<FilterTuple> _filters = [];

  OrBuilder where(String field, String operator, dynamic value) {
    _filters.add(FilterTuple(field, operator, value));
    return this;
  }

  List<FilterTuple> get filters => _filters;
}

/// List result — unified type for both offset and cursor pagination.
///: SDK ListResult unification + cursor pagination support.
///
/// Offset mode (default):  total/page/perPage are populated, hasMore/cursor are null.
/// Cursor mode (.after/.before): hasMore/cursor are populated, total/page/perPage are null.
/// Rules-filtered mode:    total is null, hasMore/cursor are populated.
class ListResult<T> {
  final List<T> items;
  final int? total;
  final int? page;
  final int? perPage;
  final bool? hasMore;
  final String? cursor;

  ListResult({
    required this.items,
    this.total,
    this.page,
    this.perPage,
    this.hasMore,
    this.cursor,
  });
}

/// Upsert result.
class UpsertResult {
  final Map<String, dynamic> record;
  final bool inserted;

  UpsertResult({required this.record, required this.inserted});
}

/// Batch operation result.
class BatchResult {
  final int totalProcessed;
  final int totalSucceeded;
  final List<Map<String, dynamic>> errors;

  BatchResult({
    required this.totalProcessed,
    required this.totalSucceeded,
    this.errors = const [],
  });
}

// ─── Core dispatch helpers ───
// Call the correct generated core method based on static vs dynamic DB.

Future<dynamic> _coreGet(
  GeneratedDbApi core,
  String method, // 'list' | 'get' | 'count' | 'search'
  String namespace,
  String? instanceId,
  String table, {
  String? id,
  Map<String, String>? query,
}) {
  final q = query;
  if (instanceId != null) {
    // Dynamic DB
    switch (method) {
      case 'list':
        return core.dbListRecords(namespace, instanceId, table, q);
      case 'get':
        return core.dbGetRecord(namespace, instanceId, table, id!, q);
      case 'count':
        return core.dbCountRecords(namespace, instanceId, table, q);
      case 'search':
        return core.dbSearchRecords(namespace, instanceId, table, q);
      default:
        throw StateError('Unknown coreGet method: $method');
    }
  }
  // Single-instance DB
  switch (method) {
    case 'list':
      return core.dbSingleListRecords(namespace, table, q);
    case 'get':
      return core.dbSingleGetRecord(namespace, table, id!, q);
    case 'count':
      return core.dbSingleCountRecords(namespace, table, q);
    case 'search':
      return core.dbSingleSearchRecords(namespace, table, q);
    default:
      throw StateError('Unknown coreGet method: $method');
  }
}

Future<dynamic> _coreInsert(
  GeneratedDbApi core,
  String namespace,
  String? instanceId,
  String table,
  Object? body, [
  Map<String, String>? query,
]) {
  final q = query ?? {};
  if (instanceId != null) {
    return core.dbInsertRecord(namespace, instanceId, table, body, q);
  }
  return core.dbSingleInsertRecord(namespace, table, body, q);
}

Future<dynamic> _coreUpdate(
  GeneratedDbApi core,
  String namespace,
  String? instanceId,
  String table,
  String id,
  Object? body,
) {
  if (instanceId != null) {
    return core.dbUpdateRecord(namespace, instanceId, table, id, body);
  }
  return core.dbSingleUpdateRecord(namespace, table, id, body);
}

Future<dynamic> _coreDelete(
  GeneratedDbApi core,
  String namespace,
  String? instanceId,
  String table,
  String id,
) {
  if (instanceId != null) {
    return core.dbDeleteRecord(namespace, instanceId, table, id);
  }
  return core.dbSingleDeleteRecord(namespace, table, id);
}

Future<dynamic> _coreBatch(
  GeneratedDbApi core,
  String namespace,
  String? instanceId,
  String table,
  Object? body, [
  Map<String, String>? query,
]) {
  final q = query ?? {};
  if (instanceId != null) {
    return core.dbBatchRecords(namespace, instanceId, table, body, q);
  }
  return core.dbSingleBatchRecords(namespace, table, body, q);
}

Future<dynamic> _coreBatchByFilter(
  GeneratedDbApi core,
  String namespace,
  String? instanceId,
  String table,
  Object? body, [
  Map<String, String>? query,
]) {
  final q = query ?? {};
  if (instanceId != null) {
    return core.dbBatchByFilter(namespace, instanceId, table, body, q);
  }
  return core.dbSingleBatchByFilter(namespace, table, body, q);
}

String _buildDatabaseLiveChannel(
  String namespace,
  String table,
  String? instanceId, [
  String? docId,
]) {
  final base = instanceId == null
      ? 'dblive:$namespace:$table'
      : 'dblive:$namespace:$instanceId:$table';
  return docId == null ? base : '$base:$docId';
}

/// Collection reference — immutable query builder + CRUD.
class TableRef<T> {
  final GeneratedDbApi _core;
  final DatabaseLiveClient? _databaseLive;
  final String name;
  final String _namespace;
  final String? _instanceId;
  final List<FilterTuple> _filters;
  final List<FilterTuple> _orFilters; //
  final List<List<String>> _sorts;
  final int? _limitCount;
  final int? _page;
  final int? _offset;
  final String? _search;
  final List<FilterTuple> _serverFilters;
  final String? _afterCursor;
  final String? _beforeCursor;

  TableRef(
    this._core,
    this.name, {
    String namespace = 'shared',
    String? instanceId,
    DatabaseLiveClient? databaseLive,
    List<FilterTuple>? filters,
    List<FilterTuple>? orFilters,
    List<List<String>>? sorts,
    int? limitCount,
    int? page,
    int? offset,
    String? search,
    List<FilterTuple>? serverFilters,
    String? afterCursor,
    String? beforeCursor,
  })  : _namespace = namespace,
        _instanceId = instanceId,
        _databaseLive = databaseLive,
        _filters = filters ?? [],
        _orFilters = orFilters ?? [],
        _sorts = sorts ?? [],
        _limitCount = limitCount,
        _page = page,
        _offset = offset,
        _search = search,
        _serverFilters = serverFilters ?? [],
        _afterCursor = afterCursor,
        _beforeCursor = beforeCursor;

  /// Clone with modifications (immutable builder, M5 lesson).
  TableRef<T> _clone({
    List<FilterTuple>? filters,
    List<FilterTuple>? orFilters,
    List<List<String>>? sorts,
    int? limitCount,
    int? page,
    int? offset,
    String? search,
    List<FilterTuple>? serverFilters,
    Object? afterCursor = _sentinel,
    Object? beforeCursor = _sentinel,
  }) {
    return TableRef<T>(
      _core,
      name,
      namespace: _namespace,
      instanceId: _instanceId,
      databaseLive: _databaseLive,
      filters: filters ?? _filters,
      orFilters: orFilters ?? _orFilters,
      sorts: sorts ?? _sorts,
      limitCount: limitCount ?? _limitCount,
      page: page ?? _page,
      offset: offset ?? _offset,
      search: search ?? _search,
      serverFilters: serverFilters ?? _serverFilters,
      afterCursor:
          afterCursor == _sentinel ? _afterCursor : afterCursor as String?,
      beforeCursor:
          beforeCursor == _sentinel ? _beforeCursor : beforeCursor as String?,
    );
  }

  // ─── Immutable Query Builder ───

  /// Add a filter condition.
  TableRef<T> where(String field, String operator, dynamic value) {
    final newFilters = List<FilterTuple>.from(_filters)
      ..add(FilterTuple(field, operator, value));
    return _clone(filters: newFilters);
  }

  /// Add OR conditions.
  TableRef<T> or(void Function(OrBuilder) builderFn) {
    final builder = OrBuilder();
    builderFn(builder);
    final newOrFilters = List<FilterTuple>.from(_orFilters)
      ..addAll(builder.filters);
    return _clone(orFilters: newOrFilters);
  }

  /// Add sort order (supports multiple — chained calls accumulate).
  /// Works both as positional (.orderBy('f', 'desc')) and named (.orderBy('f', direction: 'desc')).
  TableRef<T> orderBy(String field, {String direction = 'asc'}) {
    return _clone(sorts: [
      ..._sorts,
      [field, direction]
    ]);
  }

  /// Alias kept for backward compatibility.
  TableRef<T> orderByNamed(String field, {String direction = 'asc'}) {
    return orderBy(field, direction: direction);
  }

  /// Set limit.
  TableRef<T> limit(int count) {
    return _clone(limitCount: count);
  }

  /// Set page for pagination.
  TableRef<T> page(int pageNum) {
    return _clone(page: pageNum);
  }

  /// Set offset for pagination.
  TableRef<T> offset(int count) {
    return _clone(offset: count);
  }

  /// Full-text search.
  TableRef<T> search(String query) {
    return _clone(search: query);
  }

  /// Set cursor for forward pagination.
  /// Fetches records with id > cursor. Mutually exclusive with page()/offset().
  TableRef<T> after(String cursor) {
    return _clone(afterCursor: cursor, beforeCursor: null);
  }

  /// Set cursor for backward pagination.
  /// Fetches records with id < cursor. Mutually exclusive with page()/offset().
  TableRef<T> before(String cursor) {
    return _clone(beforeCursor: cursor, afterCursor: null);
  }

  /// Build query params map for generated core methods.
  Map<String, String> _buildQueryParams() {
    //: offset/cursor mutual exclusion
    final hasCursor = _afterCursor != null || _beforeCursor != null;
    final hasOffset = _offset != null || _page != null;
    if (hasCursor && hasOffset) {
      throw StateError(
        'Cannot use page()/offset() with after()/before() — choose offset or cursor pagination',
      );
    }

    final query = <String, String>{};
    if (_filters.isNotEmpty) {
      final filterJson = _filters.map((f) => f.toJson()).toList();
      query['filter'] = jsonEncode(filterJson);
    }
    if (_orFilters.isNotEmpty) {
      final orFilterJson = _orFilters.map((f) => f.toJson()).toList();
      query['orFilter'] = jsonEncode(orFilterJson);
    }
    if (_sorts.isNotEmpty) {
      query['sort'] = _sorts.map((s) => '${s[0]}:${s[1]}').join(',');
    }
    if (_limitCount != null) query['limit'] = '$_limitCount';
    if (_page != null) query['page'] = '$_page';
    if (_offset != null) query['offset'] = '$_offset';
    if (_afterCursor != null) query['after'] = _afterCursor!;
    if (_beforeCursor != null) query['before'] = _beforeCursor!;
    return query;
  }

  // ─── Read Operations ───

  /// Get list of records.
  Future<ListResult<Map<String, dynamic>>> getList() async {
    final query = _buildQueryParams();
    Map<String, dynamic> json;
    if (_search != null) {
      query['search'] = _search!;
      json = await _coreGet(
        _core,
        'search',
        _namespace,
        _instanceId,
        name,
        query: query,
      ) as Map<String, dynamic>;
    } else {
      json = await _coreGet(
        _core,
        'list',
        _namespace,
        _instanceId,
        name,
        query: query,
      ) as Map<String, dynamic>;
    }

    final items = (json['items'] as List<dynamic>)
        .map((e) => e as Map<String, dynamic>)
        .toList();

    return ListResult(
      items: items,
      total: json['total'] as int?,
      page: json['page'] as int?,
      perPage: json['perPage'] as int?,
      hasMore: json['hasMore'] as bool?,
      cursor: json['cursor'] as String?,
    );
  }

  /// Get a single record by ID.
  Future<Map<String, dynamic>> getOne(String id) async {
    final json = await _coreGet(
      _core,
      'get',
      _namespace,
      _instanceId,
      name,
      id: id,
      query: {},
    ) as Map<String, dynamic>;
    return json;
  }

  /// Get record count.
  Future<int> count() async {
    final query = _buildQueryParams();
    final json = await _coreGet(
      _core,
      'count',
      _namespace,
      _instanceId,
      name,
      query: query,
    ) as Map<String, dynamic>;
    return json['total'] as int;
  }

  /// Get the first record matching the current query conditions.
  /// Returns null if no records match.
  Future<Map<String, dynamic>?> getFirst() async {
    final result = await limit(1).getList();
    return result.items.isNotEmpty ? result.items.first : null;
  }

  /// Execute admin SQL scoped to this table's database namespace.
  ///
  /// This helper relies on the underlying HttpClient carrying admin credentials.
  Future<List<dynamic>> sql(String query, [List<dynamic>? params]) async {
    final body = <String, dynamic>{
      'namespace': _namespace,
      'sql': query,
      'params': params ?? const <dynamic>[],
    };
    if (_instanceId != null) {
      body['id'] = _instanceId;
    }
    final result = await _core.httpClient.post('/sql', body);
    if (result is Map<String, dynamic> && result['items'] is List) {
      return result['items'] as List<dynamic>;
    }
    return const <dynamic>[];
  }

  // ─── Document Reference ───

  /// Get a single document reference.
  DocRef doc(String id) => DocRef(_core, name, id,
      namespace: _namespace, instanceId: _instanceId, databaseLive: _databaseLive);

  // ─── Write Operations ───

  /// Insert a new record.
  Future<Map<String, dynamic>> insert(Map<String, dynamic> data) async {
    final json = await _coreInsert(_core, _namespace, _instanceId, name, data)
        as Map<String, dynamic>;
    return json;
  }

  /// Update a single record by id.
  Future<Map<String, dynamic>> update(
    String id,
    Map<String, dynamic> data,
  ) async {
    final json = await _coreUpdate(
      _core,
      _namespace,
      _instanceId,
      name,
      id,
      data,
    ) as Map<String, dynamic>;
    return json;
  }

  /// Delete a single record by id.
  Future<void> delete(String id) async {
    await _coreDelete(_core, _namespace, _instanceId, name, id);
  }

  /// Upsert a record.
  /// [conflictTarget] specifies the unique field to use for conflict detection.
  /// Defaults to 'id' (PK) if omitted.
  Future<UpsertResult> upsert(Map<String, dynamic> data,
      {String? conflictTarget}) async {
    final query = <String, String>{'upsert': 'true'};
    if (conflictTarget != null) query['conflictTarget'] = conflictTarget;
    final json =
        await _coreInsert(_core, _namespace, _instanceId, name, data, query)
            as Map<String, dynamic>;
    return UpsertResult(
      record: json,
      inserted: json['action'] == 'inserted',
    );
  }

  // ─── Batch Operations ───

  /// Insert multiple records at once.
  /// Auto-chunks into 500-item batches.
  /// Each chunk is an independent all-or-nothing transaction.
  Future<List<Map<String, dynamic>>> insertMany(
    List<Map<String, dynamic>> records,
  ) async {
    const chunkSize = 500;

    // Fast path: no chunking needed
    if (records.length <= chunkSize) {
      final json = await _coreBatch(
        _core,
        _namespace,
        _instanceId,
        name,
        {'inserts': records},
      ) as Map<String, dynamic>;
      return (json['inserted'] as List<dynamic>)
          .map((e) => e as Map<String, dynamic>)
          .toList();
    }

    // Chunk into 500-item batches
    final allCreated = <Map<String, dynamic>>[];
    for (var i = 0; i < records.length; i += chunkSize) {
      final chunk = records.sublist(
        i,
        i + chunkSize > records.length ? records.length : i + chunkSize,
      );
      final json = await _coreBatch(
        _core,
        _namespace,
        _instanceId,
        name,
        {'inserts': chunk},
      ) as Map<String, dynamic>;
      allCreated.addAll(
        (json['inserted'] as List<dynamic>)
            .map((e) => e as Map<String, dynamic>),
      );
    }
    return allCreated;
  }

  /// Batch upsert — insert or update multiple records.
  /// Auto-chunks into 500-item batches.
  Future<List<Map<String, dynamic>>> upsertMany(
    List<Map<String, dynamic>> records, {
    String? conflictTarget,
  }) async {
    const chunkSize = 500;
    final query = <String, String>{'upsert': 'true'};
    if (conflictTarget != null) query['conflictTarget'] = conflictTarget;

    // Fast path: no chunking needed
    if (records.length <= chunkSize) {
      final json = await _coreBatch(
        _core,
        _namespace,
        _instanceId,
        name,
        {'inserts': records},
        query,
      ) as Map<String, dynamic>;
      return (json['inserted'] as List<dynamic>)
          .map((e) => e as Map<String, dynamic>)
          .toList();
    }

    // Chunk into 500-item batches
    final allCreated = <Map<String, dynamic>>[];
    for (var i = 0; i < records.length; i += chunkSize) {
      final chunk = records.sublist(
        i,
        i + chunkSize > records.length ? records.length : i + chunkSize,
      );
      final json = await _coreBatch(
        _core,
        _namespace,
        _instanceId,
        name,
        {'inserts': chunk},
        query,
      ) as Map<String, dynamic>;
      allCreated.addAll(
        (json['inserted'] as List<dynamic>)
            .map((e) => e as Map<String, dynamic>),
      );
    }
    return allCreated;
  }

  /// Update all records matching current filters (batch-by-filter,).
  /// Processes 500 records per call, max 100 iterations.
  Future<BatchResult> updateMany(Map<String, dynamic> data) async {
    if (_filters.isEmpty) {
      throw StateError('updateMany requires at least one where() filter');
    }
    return _batchByFilter('update', data);
  }

  /// Alias for [updateMany] (legacy name).
  Future<BatchResult> updateByFilter(Map<String, dynamic> data) =>
      updateMany(data);

  /// Delete all records matching current filters (batch-by-filter,).
  /// Processes 500 records per call, max 100 iterations.
  Future<BatchResult> deleteMany() async {
    if (_filters.isEmpty) {
      throw StateError('deleteMany requires at least one where() filter');
    }
    return _batchByFilter('delete', null);
  }

  /// Alias for [deleteMany] (legacy name).
  Future<BatchResult> deleteByFilter() => deleteMany();

  /// Internal: repeated batch-by-filter calls.
  Future<BatchResult> _batchByFilter(
    String action,
    Map<String, dynamic>? update,
  ) async {
    const maxIterations = 100;
    var totalProcessed = 0;
    var totalSucceeded = 0;
    final errors = <Map<String, dynamic>>[];
    final filterJson = _filters.map((f) => f.toJson()).toList();
    final orFilterJson = _orFilters.map((f) => f.toJson()).toList();

    for (var chunkIndex = 0; chunkIndex < maxIterations; chunkIndex++) {
      final body = <String, dynamic>{
        'action': action,
        'filter': filterJson,
        if (orFilterJson.isNotEmpty) 'orFilter': orFilterJson,
        'limit': 500,
      };
      if (action == 'update' && update != null) {
        body['update'] = update;
      }

      try {
        final json = await _coreBatchByFilter(
          _core,
          _namespace,
          _instanceId,
          name,
          body,
        ) as Map<String, dynamic>;

        final processed = json['processed'] as int? ?? 0;
        final succeeded = json['succeeded'] as int? ?? 0;
        totalProcessed += processed;
        totalSucceeded += succeeded;

        if (processed == 0) break; // No more matching records

        // For 'update', don't loop — updated records still match the filter,
        // so re-querying would process the same rows again (infinite loop).
        // Only 'delete' benefits from looping since deleted rows disappear.
        if (action == 'update') break;
      } catch (e) {
        errors.add({
          'chunkIndex': chunkIndex,
          'chunkSize': 500,
          'error': e.toString()
        });
        break; // Stop on error (partial failure)
      }
    }

    return BatchResult(
      totalProcessed: totalProcessed,
      totalSucceeded: totalSucceeded,
      errors: errors,
    );
  }

  // ─── DatabaseLive ─── 

  /// Subscribe to table changes. Returns a Stream of [DbChange].
  ///
  /// Optionally filter changes client-side. Server-side filters
  /// can be set via the [serverFilters] parameter.
  ///
  /// ```dart
  /// final stream = client.table('posts')
  ///     .where('status', '==', 'published')
  ///     .onSnapshot();
  /// ```
  Stream<DbChange> onSnapshot({
    Map<String, dynamic>? filters,
    List<FilterTuple>? serverFilters,
  }) {
    if (_databaseLive == null) {
      throw StateError(
        'DatabaseLiveClient not available. '
        'Ensure the EdgeBase client is properly initialized.',
      );
    }

    final List<DatabaseLiveFilterTuple>? effectiveServerFilters =
        serverFilters != null && serverFilters.isNotEmpty
            ? serverFilters
                .map<DatabaseLiveFilterTuple>((filter) => filter.toJson())
                .toList()
            : (_filters.isEmpty
                ? null
                : _filters
                    .map<DatabaseLiveFilterTuple>((filter) => filter.toJson())
                    .toList());
    final List<DatabaseLiveFilterTuple>? effectiveServerOrFilters =
        _orFilters.isEmpty
            ? null
            : _orFilters
                .map<DatabaseLiveFilterTuple>((filter) => filter.toJson())
                .toList();

    final rawStream = _databaseLive!.subscribe(
      _buildDatabaseLiveChannel(_namespace, name, _instanceId),
      serverFilters: effectiveServerFilters,
      serverOrFilters: effectiveServerOrFilters,
    );

    // Apply client-side filtering based on `_filters` if any
    if (_filters.isEmpty &&
        _orFilters.isEmpty &&
        (filters == null || filters.isEmpty)) {
      return rawStream;
    }

    return rawStream.where((change) => _matchesFilters(change, filters));
  }

  /// Client-side filter matching (mirrors JS SDK match-filter.ts).
  bool _matchesFilters(DbChange change, Map<String, dynamic>? extraFilters) {
    final record = change.record;
    if (record == null) return true; // Deletions always pass through

    // Check query builder filters
    for (final f in _filters) {
      final fieldValue = record[f.field];
      if (!_matchFilter(fieldValue, f.operator, f.value)) return false;
    }

    // Check query builder OR filters
    if (_orFilters.isNotEmpty) {
      var orPass = false;
      for (final f in _orFilters) {
        final fieldValue = record[f.field];
        if (_matchFilter(fieldValue, f.operator, f.value)) {
          orPass = true;
          break;
        }
      }
      if (!orPass) return false;
    }

    // Check extra ad-hoc filters
    if (extraFilters != null) {
      for (final entry in extraFilters.entries) {
        if (record[entry.key] != entry.value) return false;
      }
    }

    return true;
  }

  /// Match a single filter condition.
  bool _matchFilter(dynamic fieldValue, String op, dynamic filterValue) {
    switch (op) {
      case '==':
        return fieldValue == filterValue;
      case '!=':
        return fieldValue != filterValue;
      case '>':
        return fieldValue is num &&
            filterValue is num &&
            fieldValue > filterValue;
      case '>=':
        return fieldValue is num &&
            filterValue is num &&
            fieldValue >= filterValue;
      case '<':
        return fieldValue is num &&
            filterValue is num &&
            fieldValue < filterValue;
      case '<=':
        return fieldValue is num &&
            filterValue is num &&
            fieldValue <= filterValue;
      case 'contains':
        if (fieldValue is String && filterValue is String) {
          return fieldValue.contains(filterValue);
        }
        if (fieldValue is List) return fieldValue.contains(filterValue);
        return false;
      case 'in':
        if (filterValue is List) return filterValue.contains(fieldValue);
        return false;
      default:
        return true; // Unknown ops pass through
    }
  }
}

/// Single document reference.
class DocRef {
  final GeneratedDbApi _core;
  final DatabaseLiveClient? _databaseLive;
  final String tableName;
  final String id;
  final String _namespace;
  final String? _instanceId;

  DocRef(
    this._core,
    this.tableName,
    this.id, {
    String namespace = 'shared',
    String? instanceId,
    DatabaseLiveClient? databaseLive,
  })  : _namespace = namespace,
        _instanceId = instanceId,
        _databaseLive = databaseLive;

  /// Get a single record.
  Future<Map<String, dynamic>> get() async {
    final json = await _coreGet(
      _core,
      'get',
      _namespace,
      _instanceId,
      tableName,
      id: id,
      query: {},
    ) as Map<String, dynamic>;
    return json;
  }

  /// Update a record.
  Future<Map<String, dynamic>> update(Map<String, dynamic> data) async {
    final json = await _coreUpdate(
      _core,
      _namespace,
      _instanceId,
      tableName,
      id,
      data,
    ) as Map<String, dynamic>;
    return json;
  }

  /// Delete a record.
  Future<void> delete() async {
    await _coreDelete(_core, _namespace, _instanceId, tableName, id);
  }

  /// Subscribe to this document's changes. Returns a Stream of [DbChange].
  ///
  /// ```dart
  /// final stream = client.table('posts').doc('abc').onSnapshot();
  /// stream.listen((change) => print(change.record));
  /// ```
  Stream<DbChange> onSnapshot() {
    if (_databaseLive == null) {
      throw StateError(
        'DatabaseLiveClient not available. '
        'Ensure the EdgeBase client is properly initialized.',
      );
    }

    return _databaseLive!
        .subscribe(
          _buildDatabaseLiveChannel(_namespace, tableName, _instanceId, id),
        )
        .where(
          (change) => change.id == id,
        );
  }
}

// ─── DbRef ───

/// DB namespace block reference for table access (#133 §2).
///
/// Obtained via `client.db('shared')` or `client.db('workspace', instanceId: 'ws-456')`.
class DbRef {
  final GeneratedDbApi _core;
  final DatabaseLiveClient? _databaseLive;
  final String _namespace;
  final String? _instanceId;

  DbRef(
    this._core,
    this._namespace, {
    String? instanceId,
    DatabaseLiveClient? databaseLive,
  })  : _instanceId = instanceId,
        _databaseLive = databaseLive;

  /// Get a [TableRef] for the named table.
  TableRef<T> table<T>(String name) {
    return TableRef<T>(
      _core,
      name,
      namespace: _namespace,
      instanceId: _instanceId,
      databaseLive: _databaseLive,
    );
  }
}
