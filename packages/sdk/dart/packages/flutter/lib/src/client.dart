// EdgeBase Dart SDK — Client-side entry point.
//
// Wraps AuthClient, db, storage, database live, push, room into a single entry point.
//: client/server split (no admin APIs here).
//
// Usage:
//   final client = EdgeBase.client('https://my-project.edgebase.fun');
//   await client.auth.signUp(SignUpOptions(email: 'a@b.com', password: 'pass'));
//   final posts = await client.db('shared').table('posts').getList();

import 'package:edgebase_core/src/http_client.dart';
import 'package:edgebase_core/src/context_manager.dart';
import 'package:edgebase_core/src/generated/api_core.dart';
import 'package:edgebase_core/src/storage_client.dart';
import 'package:edgebase_core/src/table_ref.dart';
import 'analytics_client.dart';
import 'auth_client.dart';
import 'functions_client.dart';
import 'database_live_client.dart';
import 'push_client_stub.dart' if (dart.library.ui) 'push_client.dart';
import 'room_client.dart';
import 'token_manager.dart';

/// Options for creating a client-side EdgeBase instance.
class EdgeBaseClientOptions {
  /// Custom token storage (defaults to SharedPrefsTokenStorage).
  final TokenStorage? tokenStorage;

  const EdgeBaseClientOptions({this.tokenStorage});
}

/// Backwards-compatible alias for [EdgeBaseClientOptions].
typedef JuneClientOptions = EdgeBaseClientOptions;

/// Client-side EdgeBase SDK entry point.
///
/// Exposes: auth, db, storage, push, room, setContext, destroy.
/// Does NOT expose: adminAuth, sql (admin-only).
///
/// Usage:
///   final client = EdgeBase.client('https://my-project.edgebase.fun');
///   await client.auth.signUp(SignUpOptions(email: 'a@b.com', password: 'pass'));
///   final posts = await client.db('shared').table('posts').getList();
class ClientEdgeBase {
  final HttpClient _httpClient;
  final GeneratedDbApi _dbApi;
  final TokenManager _tokenManager;
  final ContextManager _contextManager;
  final DatabaseLiveClient _databaseLive;
  final StorageClient _storage;
  final AuthClient _auth;
  final PushClient _push;
  final FunctionsClient _functions;
  final ClientAnalytics _analytics;
  final String _baseUrl;

  ClientEdgeBase._(
    this._httpClient,
    this._dbApi,
    this._tokenManager,
    this._contextManager,
    this._databaseLive,
    this._storage,
    this._auth,
    this._push,
    this._functions,
    this._analytics,
    this._baseUrl,
  );

  factory ClientEdgeBase(
    String url, {
    EdgeBaseClientOptions? options,
  }) {
    final baseUrl = url.replaceAll(RegExp(r'/$'), '');
    final contextManager = ContextManager();
    final tokenManager = TokenManager(
      baseUrl: baseUrl,
      storage: options?.tokenStorage,
    );

    final httpClient = HttpClient(
      baseUrl: baseUrl,
      tokenManager: tokenManager,
      contextManager: contextManager,
    );

    final dbApi = GeneratedDbApi(httpClient);
    final databaseLive = DatabaseLiveClient(baseUrl, tokenManager, contextManager);
    final storage = StorageClient(httpClient);
    final auth = AuthClient(httpClient, tokenManager);
    final push = PushClient(httpClient);
    final functions = FunctionsClient(httpClient);
    final analytics = ClientAnalytics(dbApi);

    return ClientEdgeBase._(
      httpClient,
      dbApi,
      tokenManager,
      contextManager,
      databaseLive,
      storage,
      auth,
      push,
      functions,
      analytics,
      baseUrl,
    );
  }

  /// Authentication client.
  AuthClient get auth => _auth;

  /// Storage client.
  StorageClient get storage => _storage;

  /// Push notification client.
  PushClient get push => _push;

  /// App Functions helper.
  FunctionsClient get functions => _functions;

  /// Client analytics helper.
  ClientAnalytics get analytics => _analytics;

  /// Select a DB namespace block (#133 §2).
  DbRef db(String namespace, {String? instanceId}) {
    return DbRef(
      _dbApi,
      namespace,
      instanceId: instanceId,
      databaseLive: _databaseLive,
    );
  }

  /// Get a Room client for the given namespace and room ID.
  RoomClient room(String namespace, String roomId) =>
      RoomClient(_baseUrl, namespace, roomId, _tokenManager);

  /// Set legacy isolateBy context state. HTTP DB routing uses db(namespace, instanceId).
  void setContext(Map<String, dynamic> context) {
    _contextManager.setContext(context);
  }

  /// Set locale for auth email i18n and Accept-Language headers.
  void setLocale(String? locale) {
    _httpClient.setLocale(locale);
  }

  /// Get the currently configured locale override.
  String? getLocale() => _httpClient.getLocale();

  /// Get current legacy isolateBy context state.
  Map<String, dynamic> getContext() => _contextManager.getContext();

  /// Destroy the client, cleaning up resources.
  void destroy() {
    _databaseLive.disconnect();
    _analytics.destroy();
    _tokenManager.destroy();
    _httpClient.close();
  }
}

/// Convenience entry point with static factory methods.
class EdgeBase {
  EdgeBase._();

  /// Create a client-side SDK instance.
  static ClientEdgeBase client(
    String url, {
    EdgeBaseClientOptions? options,
  }) {
    return ClientEdgeBase(url, options: options);
  }
}
