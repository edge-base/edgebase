/// Token storage primitives shared by Flutter and headless Dart runtimes.

class StoredTokenPair {
  final String? accessToken;
  final String refreshToken;

  const StoredTokenPair({
    required this.accessToken,
    required this.refreshToken,
  });
}

abstract class TokenStorage {
  Future<String?> getRefreshToken();
  Future<void> setRefreshToken(String token);
  Future<void> clearRefreshToken();
}

/// Optional atomic access/refresh pair capability for source compatibility
/// with legacy refresh-only TokenStorage implementations.
abstract interface class AtomicTokenPairStorage {
  Future<StoredTokenPair?> getTokenPair();
  Future<void> setTokenPair(StoredTokenPair pair);
}

/// Pair storage that survives process restart and reports failed writes.
abstract interface class DurableTokenStorage
    implements TokenStorage, AtomicTokenPairStorage {}

/// In-memory storage — tokens are lost on app restart.
class MemoryTokenStorage implements TokenStorage, AtomicTokenPairStorage {
  StoredTokenPair? _tokens;

  @override
  Future<String?> getRefreshToken() async => _tokens?.refreshToken;

  @override
  Future<void> setRefreshToken(String token) async {
    _tokens = StoredTokenPair(accessToken: null, refreshToken: token);
  }

  @override
  Future<void> clearRefreshToken() async {
    _tokens = null;
  }

  @override
  Future<StoredTokenPair?> getTokenPair() async => _tokens;

  @override
  Future<void> setTokenPair(StoredTokenPair pair) async {
    _tokens = pair;
  }
}
