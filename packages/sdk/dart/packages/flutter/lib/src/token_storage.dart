/// Token storage primitives shared by Flutter and headless Dart runtimes.

abstract class TokenStorage {
  Future<String?> getRefreshToken();
  Future<void> setRefreshToken(String token);
  Future<void> clearRefreshToken();
}

/// In-memory storage — tokens are lost on app restart.
class MemoryTokenStorage implements TokenStorage {
  String? _refreshToken;

  @override
  Future<String?> getRefreshToken() async => _refreshToken;

  @override
  Future<void> setRefreshToken(String token) async {
    _refreshToken = token;
  }

  @override
  Future<void> clearRefreshToken() async {
    _refreshToken = null;
  }
}
