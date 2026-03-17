import 'token_storage.dart';

/// Headless fallback so the SDK can run on the Dart VM without Flutter engine.
class SharedPrefsTokenStorage implements TokenStorage {
  final MemoryTokenStorage _delegate = MemoryTokenStorage();

  @override
  Future<String?> getRefreshToken() => _delegate.getRefreshToken();

  @override
  Future<void> setRefreshToken(String token) => _delegate.setRefreshToken(token);

  @override
  Future<void> clearRefreshToken() => _delegate.clearRefreshToken();
}
