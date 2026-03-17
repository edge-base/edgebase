/// Token management protocol for HttpClient.
/// Full implementation lives in edgebase (flutter) package.

class TokenPair {
  final String accessToken;
  final String refreshToken;
  TokenPair({required this.accessToken, required this.refreshToken});
}

typedef RefreshCallback = Future<TokenPair> Function(String refreshToken);

abstract class TokenManager {
  Future<String?> getAccessToken([RefreshCallback? refreshCallback]);
  Future<String?> getRefreshToken();
  Future<void> setTokens(String access, String refresh);
  Future<void> clearTokens();
}
