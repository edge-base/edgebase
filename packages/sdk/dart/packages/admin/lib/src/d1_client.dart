/// D1Client — D1 database access for server-side use.
///
/// ```dart
/// final rows = await admin.d1('analytics').exec(
///   'SELECT * FROM events WHERE type = ?', ['click'],
/// );
/// ```
import 'package:edgebase_core/src/http_client.dart';
import 'generated/admin_api_core.dart';

/// Client for a user-defined D1 database.
class D1Client {
  final GeneratedAdminApi _core;
  final String _database;

  D1Client(HttpClient http, this._database) : _core = GeneratedAdminApi(http);

  /// Execute a SQL query. Use ? placeholders for bind parameters.
  /// All SQL is allowed (DDL included).
  Future<List<dynamic>> exec(String query, [List<dynamic>? params]) async {
    final body = <String, dynamic>{'query': query};
    if (params != null) body['params'] = params;
    final res = await _core.executeD1Query(_database, body);
    if (res is Map<Object?, Object?> && res['results'] is List) {
      return res['results'] as List;
    }
    return [];
  }

  /// Alias for exec() to match SDK parity across runtimes.
  Future<List<dynamic>> query(String query, [List<dynamic>? params]) => exec(query, params);
}
