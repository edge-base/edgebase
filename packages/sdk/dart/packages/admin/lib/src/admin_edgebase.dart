// EdgeBase Dart Admin SDK — Server-side entry point.
//
// Usage:
//   final admin = AdminEdgeBase('https://my-app.edgebase.fun', serviceKey: 'sk-...');
//   final user = await admin.adminAuth.createUser(email: '...', password: '...');
//   final rows = await admin.db('shared').table('posts').getList();
//
//: Client/server split. #122: Server→Admin rename.

import 'package:edgebase_core/src/http_client.dart';
import 'package:edgebase_core/src/context_manager.dart';
import 'package:edgebase_core/src/generated/api_core.dart';
import 'package:edgebase_core/src/table_ref.dart';
import 'package:edgebase_core/src/storage_client.dart';
import 'package:edgebase_core/src/token_manager.dart' as core;
import 'generated/admin_api_core.dart';
import 'admin_auth_client.dart';
import 'kv_client.dart';
import 'd1_client.dart';
import 'vectorize_client.dart';
import 'push_client.dart';
import 'functions_client.dart';
import 'analytics_client.dart';

/// Admin-side EdgeBase SDK.
///
/// Exposes: adminAuth, db, storage, kv, d1, vector, broadcast, push, sql, destroy.
/// Does NOT expose: auth, database-live (client-only).
///
/// Usage:
/// ```dart
/// final admin = AdminEdgeBase('https://my-app.edgebase.fun', serviceKey: 'sk-...');
/// await admin.adminAuth.createUser(email: 'foo@example.com', password: 'pass123');
/// final result = await admin.db('shared').table('posts').getList();
/// ```
class AdminEdgeBase {
  late final HttpClient _httpClient;
  late final GeneratedDbApi _dbApi;
  late final GeneratedAdminApi _adminCore;
  late final AdminAuthClient adminAuth;
  late final StorageClient storage;
  late final PushClient push;
  late final FunctionsClient functions;
  late final AnalyticsClient analytics;

  AdminEdgeBase(String url, {String? serviceKey, String? projectId}) {
    final baseUrl = url.replaceAll(RegExp(r'/$'), '');
    final contextManager = ContextManager();

    // No-op token manager — admin uses service key, not user tokens.
    final noOpTokenManager = _NoOpTokenManager();

    _httpClient = HttpClient(
      baseUrl: baseUrl,
      tokenManager: noOpTokenManager,
      contextManager: contextManager,
      serviceKey: serviceKey,
    );

    _dbApi = GeneratedDbApi(_httpClient);
    _adminCore = GeneratedAdminApi(_httpClient);
    adminAuth = AdminAuthClient(_httpClient, serviceKey != null && serviceKey.isNotEmpty);
    storage = StorageClient(_httpClient);
    push = PushClient(_httpClient);
    functions = FunctionsClient(_httpClient);
    analytics = AnalyticsClient(_dbApi, _adminCore);
  }

  /// The underlying HttpClient (for advanced use).
  HttpClient get httpClient => _httpClient;

  /// Select a DB namespace block (#133 §2).
  DbRef db(String namespace, {String? instanceId}) {
    return DbRef(_dbApi, namespace, instanceId: instanceId);
  }

  /// Access a user-defined KV namespace.
  KvClient kv(String namespace) => KvClient(_httpClient, namespace);

  /// Access a user-defined D1 database.
  D1Client d1(String database) => D1Client(_httpClient, database);

  /// Access a user-defined Vectorize index.
  VectorizeClient vector(String index) => VectorizeClient(_httpClient, index);

  /// Positional third arg (payload) for convenience.
  Future<void> broadcast(
    String channel,
    String event, [
    Map<String, dynamic>? payload,
  ]) async {
    final body = <String, dynamic>{
      'channel': channel,
      'event': event,
    };
    if (payload != null) body['payload'] = payload;
    await _adminCore.databaseLiveBroadcast(body);
  }

  /// Execute a raw SQL query against a DB namespace.
  ///
  /// [namespace] — DB namespace (e.g. 'shared')
  /// [instanceId] — optional Durable Object instance ID
  /// [sql] — raw SQL query string
  /// [params] — positional bind parameters
  Future<List<Map<String, dynamic>>> sql(
    String namespace,
    String? instanceId,
    String sql, [
    List<dynamic>? params,
  ]) async {
    final res = await _adminCore.executeSql({
      'namespace': namespace,
      if (instanceId != null) 'id': instanceId,
      'sql': sql,
      if (params != null) 'params': params,
    });
    if (res is List) {
      return res.whereType<Map<String, dynamic>>().toList();
    }
    if (res is Map<String, dynamic> && res['rows'] is List) {
      return (res['rows'] as List).whereType<Map<String, dynamic>>().toList();
    }
    return [];
  }

  /// Set isolateBy context.
  void setContext(Map<String, dynamic> context) {
    _httpClient.contextManager.setContext(context);
  }

  /// Destroy the client, cleaning up resources.
  void destroy() {
    // No-op for admin client (stateless HTTP)
  }
}

/// A no-op TokenManager for admin (service key handles auth).
class _NoOpTokenManager implements core.TokenManager {
  @override
  Future<String?> getAccessToken([core.RefreshCallback? refreshCallback]) async => null;

  @override
  Future<String?> getRefreshToken() async => null;

  @override
  Future<void> setTokens(String access, String refresh) async {}

  @override
  Future<void> clearTokens() async {}
}
