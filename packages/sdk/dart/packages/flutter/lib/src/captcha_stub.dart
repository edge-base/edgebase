/// Stub implementation — compile-time fallback for conditional import.
/// Should never run at runtime (web uses captcha_web.dart, native uses captcha_native.dart).

import 'package:edgebase_core/src/http_client.dart' as core;

/// Resolve captcha token: pass-through only (no auto-acquire on unsupported platform).
Future<String?> resolveCaptchaToken(String baseUrl, String action, [String? manualToken, core.HttpClient? httpClient]) async {
  return manualToken;
}
