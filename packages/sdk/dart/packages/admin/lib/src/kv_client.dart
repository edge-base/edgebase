/// KvClient — KV namespace access for server-side use.
///
/// ```dart
/// final kv = admin.kv('cache');
/// await kv.set('key', 'value', ttl: 300);
/// final val = await kv.get('key');
/// ```
import 'package:edgebase_core/src/http_client.dart';
import 'generated/admin_api_core.dart';

/// Client for a user-defined KV namespace.
class KvClient {
  final GeneratedAdminApi _core;
  final String _namespace;

  KvClient(HttpClient http, this._namespace) : _core = GeneratedAdminApi(http);

  /// Get a value by key. Returns null if not found.
  Future<String?> get(String key) async {
    final res = await _core.kvOperation(_namespace, {
      'action': 'get',
      'key': key,
    });
    return res is Map ? res['value'] as String? : null;
  }

  /// Set a key-value pair with optional TTL in seconds.
  Future<void> set(String key, String value, {int? ttl}) async {
    final body = <String, dynamic>{
      'action': 'set',
      'key': key,
      'value': value,
    };
    if (ttl != null) body['ttl'] = ttl;
    await _core.kvOperation(_namespace, body);
  }

  /// Delete a key.
  Future<void> delete(String key) async {
    await _core.kvOperation(_namespace, {
      'action': 'delete',
      'key': key,
    });
  }

  /// List keys with optional prefix, limit, and cursor.
  Future<Map<String, dynamic>> list({
    String? prefix,
    int? limit,
    String? cursor,
  }) async {
    final body = <String, dynamic>{'action': 'list'};
    if (prefix != null) body['prefix'] = prefix;
    if (limit != null) body['limit'] = limit;
    if (cursor != null) body['cursor'] = cursor;
    final res = await _core.kvOperation(_namespace, body);
    return res is Map<String, dynamic> ? res : {};
  }
}
