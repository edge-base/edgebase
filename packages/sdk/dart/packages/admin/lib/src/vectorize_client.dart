/// VectorizeClient — Vectorize index access for server-side use.
///
/// Note: Vectorize is Edge-only. In local/Docker, the server returns stub responses.
///
/// ```dart
/// await admin.vector('embeddings').upsert([
///   {'id': 'doc-1', 'values': [0.1, 0.2, 0.3]},
/// ]);
/// final results = await admin.vector('embeddings').search([0.1, 0.2], topK: 5);
/// ```
import 'package:edgebase_core/src/http_client.dart';
import 'generated/admin_api_core.dart';

/// Client for a user-defined Vectorize index.
class VectorizeClient {
  final HttpClient _http;
  final GeneratedAdminApi _core;
  final String _index;

  VectorizeClient(this._http, this._index) : _core = GeneratedAdminApi(_http);

  /// Insert or update vectors.
  /// Returns mutation result with `ok`, optional `count` and `mutationId`.
  Future<Map<String, dynamic>> upsert(List<Map<String, dynamic>> vectors) async {
    final res = await _core.vectorizeOperation(_index, {
      'action': 'upsert',
      'vectors': vectors,
    });
    return res is Map<String, dynamic> ? res : {};
  }

  /// Insert vectors (errors on duplicate ID — server returns 409).
  /// Returns mutation result with `ok`, optional `count` and `mutationId`.
  Future<Map<String, dynamic>> insert(List<Map<String, dynamic>> vectors) async {
    final res = await _core.vectorizeOperation(_index, {
      'action': 'insert',
      'vectors': vectors,
    });
    return res is Map<String, dynamic> ? res : {};
  }

  /// Search for similar vectors.
  Future<List<Map<String, dynamic>>> search(
    List<double> vector, {
    int topK = 10,
    Map<String, dynamic>? filter,
    String? namespace,
    bool? returnValues,
    String? returnMetadata,
  }) async {
    final body = <String, dynamic>{
      'action': 'search',
      'vector': vector,
      'topK': topK,
    };
    if (filter != null) body['filter'] = filter;
    if (namespace != null) body['namespace'] = namespace;
    if (returnValues != null) body['returnValues'] = returnValues;
    if (returnMetadata != null) body['returnMetadata'] = returnMetadata;
    final res = await _core.vectorizeOperation(_index, body);
    if (res is Map && res['matches'] is List) {
      return (res['matches'] as List).cast<Map<String, dynamic>>();
    }
    return [];
  }

  /// Search by an existing vector's ID (Vectorize v2 only).
  Future<List<Map<String, dynamic>>> queryById(
    String vectorId, {
    int topK = 10,
    Map<String, dynamic>? filter,
    String? namespace,
    bool? returnValues,
    String? returnMetadata,
  }) async {
    final body = <String, dynamic>{
      'action': 'queryById',
      'vectorId': vectorId,
      'topK': topK,
    };
    if (filter != null) body['filter'] = filter;
    if (namespace != null) body['namespace'] = namespace;
    if (returnValues != null) body['returnValues'] = returnValues;
    if (returnMetadata != null) body['returnMetadata'] = returnMetadata;
    final res = await _core.vectorizeOperation(_index, body);
    if (res is Map && res['matches'] is List) {
      return (res['matches'] as List).cast<Map<String, dynamic>>();
    }
    return [];
  }

  /// Retrieve vectors by their IDs.
  Future<List<Map<String, dynamic>>> getByIds(List<String> ids) async {
    final res = await _core.vectorizeOperation(_index, {
      'action': 'getByIds',
      'ids': ids,
    });
    if (res is Map && res['vectors'] is List) {
      return (res['vectors'] as List).cast<Map<String, dynamic>>();
    }
    return [];
  }

  /// Delete vectors by IDs.
  /// Returns mutation result with `ok`, optional `count` and `mutationId`.
  Future<Map<String, dynamic>> delete(List<String> ids) async {
    final res = await _core.vectorizeOperation(_index, {
      'action': 'delete',
      'ids': ids,
    });
    return res is Map<String, dynamic> ? res : {};
  }

  /// Get index info (vector count, dimensions, metric).
  Future<Map<String, dynamic>> describe() async {
    final res = await _core.vectorizeOperation(_index, {
      'action': 'describe',
    });
    return res is Map<String, dynamic> ? res : {};
  }
}
