// Token management for EdgeBase SDK.
//
// Access Token: always in memory.
// Refresh Token: SharedPrefsTokenStorage (기본, 영구 저장)
// JS SDK의 localStorage 패턴과 동일 — 앱 재시작 후에도 세션 유지.

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

  /// Stream of auth state changes.
  /// Immediately emits the current user state on subscription (matches JS SDK),
  /// then streams subsequent changes.
  Stream<TokenUser?> get onAuthStateChange async* {
    yield _currentUser;
    yield* _authStateController.stream;
  }

  /// Check if the current access token is expired (with 30s buffer).
  bool get isTokenExpired {
    if (_accessTokenExp == null) return true;
    final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    return now >= (_accessTokenExp! - _expiryBufferSeconds);
  }

  /// Get the stored refresh token (implements core.TokenManager).
  @override
  Future<String?> getRefreshToken() => storage.getRefreshToken();

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
    final storedRefreshToken = await storage.getRefreshToken();
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
    _accessToken = accessToken;
    _currentUser = _decodeJwt(accessToken);
    _accessTokenExp = _extractExp(accessToken);
    await storage.setRefreshToken(refreshToken);
    if (!_isClosed) _authStateController.add(_currentUser);
  }

  /// Clear tokens on sign-out.
  Future<void> clearTokens() async {
    _accessToken = null;
    _accessTokenExp = null;
    _currentUser = null;
    await storage.clearRefreshToken();
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
    final refreshToken = await storage.getRefreshToken();
    if (refreshToken == null) return false;

    try {
      final pair = await refreshFn(refreshToken);
      await _applyTokens(
        accessToken: pair.accessToken,
        refreshToken: pair.refreshToken,
      );
      return true;
    } catch (_) {
      await clearTokens();
      return false;
    }
  }

  void destroy() {
    _isClosed = true;
    _authStateController.close();
  }
}
