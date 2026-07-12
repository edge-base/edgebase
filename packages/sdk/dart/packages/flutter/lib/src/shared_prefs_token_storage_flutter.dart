import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'token_storage.dart';

/// SharedPreferences-backed refresh token storage for real Flutter runtimes.
class SharedPrefsTokenStorage implements DurableTokenStorage {
  static const _pairKey = 'edgebase:token-pair';
  static const _legacyRefreshKey = 'edgebase:refresh-token';

  @override
  Future<String?> getRefreshToken() async {
    return (await getTokenPair())?.refreshToken;
  }

  @override
  Future<void> setRefreshToken(String token) async {
    final existing = await getTokenPair();
    await setTokenPair(StoredTokenPair(
      accessToken: existing?.accessToken,
      refreshToken: token,
    ));
  }

  @override
  Future<StoredTokenPair?> getTokenPair() async {
    final prefs = await SharedPreferences.getInstance();
    final encoded = prefs.getString(_pairKey);
    if (encoded != null) {
      final value = jsonDecode(encoded) as Map<String, dynamic>;
      final refresh = value['refreshToken'] as String?;
      if (refresh == null || refresh.isEmpty) {
        throw const FormatException('Stored EdgeBase token pair is incomplete.');
      }
      return StoredTokenPair(
        accessToken: value['accessToken'] as String?,
        refreshToken: refresh,
      );
    }

    final legacyRefresh = prefs.getString(_legacyRefreshKey);
    return legacyRefresh == null
        ? null
        : StoredTokenPair(accessToken: null, refreshToken: legacyRefresh);
  }

  @override
  Future<void> setTokenPair(StoredTokenPair pair) async {
    if (pair.refreshToken.isEmpty ||
        (pair.accessToken != null && pair.accessToken!.isEmpty)) {
      throw ArgumentError('Token pairs must not contain empty values.');
    }
    final prefs = await SharedPreferences.getInstance();
    final persisted = await prefs.setString(_pairKey, jsonEncode({
      'accessToken': pair.accessToken,
      'refreshToken': pair.refreshToken,
    }));
    if (!persisted) {
      throw StateError('SharedPreferences rejected the token-pair write.');
    }
    // The authoritative pair is already durable; legacy cleanup is best effort.
    await prefs.remove(_legacyRefreshKey);
  }

  @override
  Future<void> clearRefreshToken() async {
    final prefs = await SharedPreferences.getInstance();
    final pairCleared = await prefs.remove(_pairKey);
    final legacyCleared = await prefs.remove(_legacyRefreshKey);
    if ((!pairCleared && prefs.containsKey(_pairKey)) ||
        (!legacyCleared && prefs.containsKey(_legacyRefreshKey))) {
      throw StateError('SharedPreferences rejected the token-pair deletion.');
    }
  }
}
