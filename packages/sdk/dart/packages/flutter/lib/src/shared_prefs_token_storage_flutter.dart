import 'package:shared_preferences/shared_preferences.dart';

import 'token_storage.dart';

/// SharedPreferences-backed refresh token storage for real Flutter runtimes.
class SharedPrefsTokenStorage implements TokenStorage {
  static const _key = 'edgebase:refresh-token';

  @override
  Future<String?> getRefreshToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_key);
  }

  @override
  Future<void> setRefreshToken(String token) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, token);
  }

  @override
  Future<void> clearRefreshToken() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_key);
  }
}
