import 'captcha_errors.dart';

const captchaSiteKeyCacheTtl = Duration(minutes: 5);

final Stopwatch _captchaSiteKeyClock = Stopwatch()..start();

int _defaultNowMilliseconds() => _captchaSiteKeyClock.elapsedMilliseconds;

class CaptchaSiteKeyCache {
  CaptchaSiteKeyCache({
    this.ttl = captchaSiteKeyCacheTtl,
    int Function()? nowMilliseconds,
  }) : _nowMilliseconds = nowMilliseconds ?? _defaultNowMilliseconds;

  final Duration ttl;
  final int Function() _nowMilliseconds;
  final Map<String, ({String value, int cachedAtMilliseconds})> _entries = {};

  String? read(String baseUrl) {
    final entry = _entries[baseUrl];
    if (entry == null) return null;
    final age = _nowMilliseconds() - entry.cachedAtMilliseconds;
    if (age >= 0 && age < ttl.inMilliseconds) return entry.value;
    _entries.remove(baseUrl);
    return null;
  }

  void write(String baseUrl, String siteKey) {
    if (siteKey.trim().isEmpty) return;
    _entries[baseUrl] = (
      value: siteKey,
      cachedAtMilliseconds: _nowMilliseconds(),
    );
  }

  void remove(String baseUrl) => _entries.remove(baseUrl);

  void clear() => _entries.clear();
}

bool shouldRetryCaptchaWithFreshSiteKey(String reason) =>
    reason == 'challenge_error';

String? parseCaptchaSiteKeyConfig(Object? payload) {
  if (payload is! Map) {
    throw CaptchaUnavailableException('config_invalid_response');
  }
  if (!payload.containsKey('captcha')) {
    throw CaptchaUnavailableException('config_invalid_response');
  }
  final captcha = payload['captcha'];
  if (captcha == null) return null;
  if (captcha is! Map) {
    throw CaptchaUnavailableException('config_invalid_response');
  }
  if (!captcha.containsKey('siteKey')) {
    throw CaptchaUnavailableException('config_invalid_response');
  }
  final siteKey = captcha['siteKey'];
  if (siteKey is! String) {
    throw CaptchaUnavailableException('config_invalid_response');
  }
  if (siteKey.trim().isEmpty || siteKey.length > 512) {
    throw CaptchaUnavailableException('config_invalid_response');
  }
  return siteKey;
}

Future<String?> acquireDirectCaptchaWithSingleSiteKeyRetry({
  required String initialSiteKey,
  required Future<String> Function(String siteKey) acquire,
  required Future<String?> Function() refreshSiteKey,
}) async {
  try {
    return await acquire(initialSiteKey);
  } on CaptchaUnavailableException catch (error) {
    if (!shouldRetryCaptchaWithFreshSiteKey(error.reason)) rethrow;
    final refreshedSiteKey = await refreshSiteKey();
    if (refreshedSiteKey == null) return null;
    return acquire(refreshedSiteKey);
  }
}
