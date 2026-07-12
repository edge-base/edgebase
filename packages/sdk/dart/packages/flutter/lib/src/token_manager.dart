// Token management for EdgeBase SDK.
//
// Access + refresh tokens are persisted as one pair so a response-loss restart
// can replay an anonymous-account upgrade checkpoint safely.

import 'dart:async';
import 'dart:convert';
import 'package:edgebase_core/src/token_manager.dart' as core;
import 'package:edgebase_core/src/errors.dart';

import 'shared_prefs_token_storage_stub.dart'
    if (dart.library.ui) 'shared_prefs_token_storage_flutter.dart';
import 'token_storage.dart';

export 'token_storage.dart';

/// User info extracted from JWT.
class TokenUser {
  final String id;
  final String? email;
  final String? displayName;
  final String? avatarUrl;
  final bool? emailVerified;
  final bool? isAnonymous;
  final Map<String, dynamic>? customClaims;

  TokenUser({
    required this.id,
    this.email,
    this.displayName,
    this.avatarUrl,
    this.emailVerified,
    this.isAnonymous,
    this.customClaims,
  });

  factory TokenUser.fromJwtPayload(Map<String, dynamic> payload) {
    return TokenUser(
      id: payload['sub'] as String,
      email: payload['email'] as String?,
      displayName: payload['displayName'] as String?,
      avatarUrl: payload['avatarUrl'] as String?,
      emailVerified: payload['emailVerified'] as bool?,
      isAnonymous: payload['isAnonymous'] as bool?,
      customClaims: payload['customClaims'] as Map<String, dynamic>?,
    );
  }
}

/// Token pair returned from refresh.
class TokenPair {
  final String accessToken;
  final String refreshToken;
  TokenPair({required this.accessToken, required this.refreshToken});
}

/// Callback type for performing token refresh via HTTP.
typedef RefreshTokenCallback = Future<TokenPair> Function(String refreshToken);

/// Persistent token storage failed before a new session could be exposed.
class TokenPersistenceException implements Exception {
  final String operation;
  final Object cause;
  final StackTrace causeStackTrace;

  TokenPersistenceException(
    this.operation,
    this.cause,
    this.causeStackTrace,
  );

  @override
  String toString() =>
      'TokenPersistenceException: $operation failed before token adoption: $cause';
}

class InvalidTokenPairException implements Exception {
  final String operation;
  const InvalidTokenPairException(this.operation);

  @override
  String toString() =>
      'InvalidTokenPairException: incomplete token pair during $operation';
}

/// Token manager — handles Access/Refresh tokens and auth state.
/// Implements core.TokenManager so it can be used with HttpClient and other
/// core components that accept the abstract interface.
class TokenManager implements core.TokenManager {
  final String baseUrl;
  final TokenStorage storage;
  String? _accessToken;
  int? _accessTokenExp; // JWT exp claim (seconds since epoch)
  TokenUser? _currentUser;
  final _authStateController = StreamController<TokenUser?>.broadcast();
  bool _isRefreshing = false;
  bool _isClosed = false;  // guards against add-after-close
  Completer<String?>? _refreshCompleter;

  /// Buffer in seconds before actual expiry to trigger preemptive refresh.
  static const int _expiryBufferSeconds = 30;

  TokenManager({
    required this.baseUrl,
    TokenStorage? storage,
  }) : storage = storage ?? SharedPrefsTokenStorage();

  /// Current access token (in memory only).
  String? get accessToken => _accessToken;

  /// Current user parsed from JWT.
  TokenUser? get currentUser => _currentUser;

  /// Broadcast stream of auth state changes.
  /// Use [currentUser] for the initial state — the stream only emits on
  /// subsequent changes (matching the Firebase/Dart convention).
  Stream<TokenUser?> get onAuthStateChange => _authStateController.stream;

  /// Check if the current access token is expired (with 30s buffer).
  bool get isTokenExpired {
    if (_accessTokenExp == null) return true;
    final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    return now >= (_accessTokenExp! - _expiryBufferSeconds);
  }

  /// Get the stored refresh token (implements core.TokenManager).
  @override
  Future<String?> getRefreshToken() async =>
      (await _loadStoredPair())?.refreshToken;

  /// Get a valid access token, refreshing if needed.
  /// Implements core.TokenManager with optional RefreshCallback.
  @override
  Future<String?> getAccessToken([core.RefreshCallback? refreshCallback]) async {
    // If we have a valid (non-expired) token, return it immediately
    if (_accessToken != null && !isTokenExpired) {
      return _accessToken;
    }

    if (refreshCallback == null) return _accessToken;

    // If already refreshing, wait for that to complete
    if (_isRefreshing && _refreshCompleter != null) {
      return _refreshCompleter!.future;
    }

    // Try to refresh
    final storedRefreshToken = (await _loadStoredPair())?.refreshToken;
    if (storedRefreshToken == null) return _accessToken;

    _isRefreshing = true;
    _refreshCompleter = Completer<String?>();

    try {
      final pair = await refreshCallback(storedRefreshToken);
      await _applyTokens(
        accessToken: pair.accessToken,
        refreshToken: pair.refreshToken,
      );
      _refreshCompleter!.complete(_accessToken);
      return _accessToken;
    } catch (e) {
      if (e is TokenPersistenceException || e is InvalidTokenPairException) {
        final completion = _refreshCompleter!;
        // Attach a handler for the initiating caller while still propagating
        // the same failure to any concurrent refresh waiters.
        unawaited(completion.future.catchError((_) => null));
        final failureStack = e is TokenPersistenceException
            ? e.causeStackTrace
            : StackTrace.current;
        completion.completeError(e, failureStack);
        rethrow;
      }
      // 401 means token revoked/expired — clear session (matches JS SDK).
      // Other errors (network, 5xx) keep session for retry.
      if (e is EdgeBaseError && e.statusCode == 401) {
        await clearTokens();
        _refreshCompleter!.complete(null);
        return null;
      }
      _refreshCompleter!.complete(_accessToken);
      return _accessToken;
    } finally {
      _isRefreshing = false;
      _refreshCompleter = null;
    }
  }

  /// Set tokens (core.TokenManager interface: positional args).
  @override
  Future<void> setTokens(String access, String refresh) =>
      _applyTokens(accessToken: access, refreshToken: refresh);

  /// Internal helper: applies token pair with named params.
  Future<void> _applyTokens({
    required String accessToken,
    required String refreshToken,
  }) async {
    if (accessToken.isEmpty || refreshToken.isEmpty) {
      throw const InvalidTokenPairException('save');
    }
    final nextUser = _decodeJwt(accessToken);
    final nextExpiration = _extractExp(accessToken);
    try {
      if (storage is AtomicTokenPairStorage) {
        await (storage as AtomicTokenPairStorage).setTokenPair(StoredTokenPair(
          accessToken: accessToken,
          refreshToken: refreshToken,
        ));
      } else {
        await storage.setRefreshToken(refreshToken);
      }
    } catch (error, stackTrace) {
      throw TokenPersistenceException('save', error, stackTrace);
    }
    // Persist-before-expose: a failed refresh-token write must never leave a
    // new access token or user visible only in memory.
    _accessToken = accessToken;
    _currentUser = nextUser;
    _accessTokenExp = nextExpiration;
    if (!_isClosed) _authStateController.add(_currentUser);
  }

  void _adoptStoredTokens(StoredTokenPair pair) {
    final accessToken = pair.accessToken;
    if (accessToken == null ||
        accessToken.isEmpty ||
        pair.refreshToken.isEmpty) {
      throw const InvalidTokenPairException('restore');
    }
    _accessToken = accessToken;
    _currentUser = _decodeJwt(accessToken);
    _accessTokenExp = _extractExp(accessToken);
    if (!_isClosed) _authStateController.add(_currentUser);
  }

  Future<StoredTokenPair?> _loadStoredPair() async {
    try {
      if (storage is AtomicTokenPairStorage) {
        return await (storage as AtomicTokenPairStorage).getTokenPair();
      }
      final refreshToken = await storage.getRefreshToken();
      return refreshToken == null
          ? null
          : StoredTokenPair(accessToken: null, refreshToken: refreshToken);
    } catch (error, stackTrace) {
      throw TokenPersistenceException('load', error, stackTrace);
    }
  }

  /// Fail closed before an operation that can revoke the initiating session.
  void requireDurableStorageForAccountUpgrade() {
    if (storage is DurableTokenStorage || currentUser?.isAnonymous == false) {
      return;
    }
    throw StateError(
      'Anonymous account upgrades require durable access/refresh pair storage '
      'so replacement tokens survive response loss or process termination.',
    );
  }

  /// Clear tokens on sign-out.
  Future<void> clearTokens() async {
    try {
      await storage.clearRefreshToken();
    } catch (error, stackTrace) {
      throw TokenPersistenceException('clear', error, stackTrace);
    }
    _accessToken = null;
    _accessTokenExp = null;
    _currentUser = null;
    if (!_isClosed) _authStateController.add(null);
  }

  /// Decode JWT payload (no verification — server is source of truth).
  TokenUser? _decodeJwt(String jwt) {
    try {
      final parts = jwt.split('.');
      if (parts.length != 3) return null;
      final payload = parts[1];
      final normalized = base64Url.normalize(payload);
      final decoded = utf8.decode(base64Url.decode(normalized));
      final json = jsonDecode(decoded) as Map<String, dynamic>;
      return TokenUser.fromJwtPayload(json);
    } catch (_) {
      return null;
    }
  }

  /// Extract exp claim from JWT.
  int? _extractExp(String jwt) {
    try {
      final parts = jwt.split('.');
      if (parts.length != 3) return null;
      final payload = parts[1];
      final normalized = base64Url.normalize(payload);
      final decoded = utf8.decode(base64Url.decode(normalized));
      final json = jsonDecode(decoded) as Map<String, dynamic>;
      return json['exp'] as int?;
    } catch (_) {
      return null;
    }
  }

  /// Try to restore session from stored refresh token.
  Future<bool> tryRestoreSession(RefreshTokenCallback refreshFn) async {
    final stored = await _loadStoredPair();
    if (stored == null) return false;

    if (stored.accessToken != null) {
      _adoptStoredTokens(stored);
      return true;
    }

    try {
      final pair = await refreshFn(stored.refreshToken);
      await _applyTokens(
        accessToken: pair.accessToken,
        refreshToken: pair.refreshToken,
      );
      return true;
    } catch (error) {
      if (error is TokenPersistenceException ||
          error is InvalidTokenPairException) {
        rethrow;
      }
      await clearTokens();
      return false;
    }
  }

  void destroy() {
    _isClosed = true;
    _authStateController.close();
  }
}
