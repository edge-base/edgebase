/// Turnstile captcha provider for Flutter native platforms.
///
/// Android, iOS, macOS, Windows, Linux — uses flutter_inappwebview.
/// Phase 1: HeadlessInAppWebView (invisible, handles 99% auto-pass).
/// Phase 2: InAppBrowser fallback (visible, for 1% interactive challenge).

import 'dart:async';
import 'dart:convert';
import 'dart:io' show Platform;
import 'dart:math';
import 'package:http/http.dart' as http;
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:edgebase_core/src/http_client.dart' as core;
import 'package:edgebase_core/src/generated/api_core.dart';
import 'captcha_errors.dart';
import 'captcha_site_key_cache.dart';

// ─── Site Key Cache ───

final CaptchaSiteKeyCache _siteKeyCacheByBaseUrl = CaptchaSiteKeyCache();
final Map<String, Future<String?>> _siteKeyPromiseByBaseUrl = {};
const Duration _captchaConfigFetchTimeout = Duration(seconds: 10);

String _normalizeCaptchaBaseUrl(String baseUrl) =>
    baseUrl.trim().replaceFirst(RegExp(r'/+$'), '');

Future<String?> _fetchSiteKey(
  String baseUrl, [
  core.HttpClient? httpClient,
]) async {
  baseUrl = _normalizeCaptchaBaseUrl(baseUrl);
  final cachedSiteKey = _siteKeyCacheByBaseUrl.read(baseUrl);
  if (cachedSiteKey != null) return cachedSiteKey;
  final inflight = _siteKeyPromiseByBaseUrl[baseUrl];
  if (inflight != null) return inflight;

  final nextPromise = (() async {
    try {
      final Object? data;
      if (httpClient != null) {
        try {
          data = await GeneratedDbApi(httpClient).getConfig();
        } on FormatException catch (error) {
          throw CaptchaUnavailableException(
            'config_invalid_response',
            cause: error,
          );
        } catch (error) {
          throw CaptchaUnavailableException(
            'config_fetch_failed',
            cause: error,
          );
        }
      } else {
        final http.Response res;
        try {
          res = await http
              .get(Uri.parse('$baseUrl/api/config'))
              .timeout(_captchaConfigFetchTimeout);
        } catch (error) {
          throw CaptchaUnavailableException(
            'config_fetch_failed',
            cause: error,
          );
        }
        if (res.statusCode != 200) {
          throw CaptchaUnavailableException(
            'config_fetch_failed',
            cause: StateError(
              'GET /api/config returned HTTP ${res.statusCode}',
            ),
          );
        }
        try {
          data = jsonDecode(res.body);
        } catch (error) {
          throw CaptchaUnavailableException(
            'config_invalid_response',
            cause: error,
          );
        }
      }
      final nextKey = parseCaptchaSiteKeyConfig(data);
      if (nextKey != null) _siteKeyCacheByBaseUrl.write(baseUrl, nextKey);
      return nextKey;
    } finally {
      _siteKeyPromiseByBaseUrl.remove(baseUrl);
    }
  })();

  _siteKeyPromiseByBaseUrl[baseUrl] = nextPromise;
  return nextPromise;
}

Future<String?> debugFetchCaptchaSiteKey(
  String baseUrl, [
  core.HttpClient? httpClient,
]) =>
    _fetchSiteKey(baseUrl, httpClient);

const _captchaActions = {
  'signup',
  'signin',
  'anonymous',
  'magic-link',
  'phone',
  'password-reset',
  'oauth',
  'function',
};

Uri buildCaptchaChallengeUri(String baseUrl, String action, String channel) {
  final base = Uri.parse(baseUrl);
  if (base.scheme != 'https' ||
      base.host.isEmpty ||
      base.userInfo.isNotEmpty ||
      (base.path.isNotEmpty && base.path != '/') ||
      base.hasQuery ||
      base.hasFragment ||
      !_captchaActions.contains(action) ||
      !RegExp(r'^[A-Za-z0-9_-]{22,64}$').hasMatch(channel)) {
    throw ArgumentError(
      'Turnstile requires an HTTPS EdgeBase URL, fixed action, and secure channel.',
    );
  }
  return base.replace(
    path: '/api/captcha/challenge',
    queryParameters: {
      'action': action,
      'channel': channel,
      'bridge': 'flutter',
    },
    fragment: '',
  );
}

({String type, String value})? parseCaptchaBridgeMessage(
  Object? raw,
  String expectedChannel,
) {
  if (raw is! String || utf8.encode(raw).length > 4096) return null;
  try {
    final payload = jsonDecode(raw);
    if (payload is! Map<String, dynamic> ||
        payload['v'] != 1 ||
        payload['channel'] != expectedChannel ||
        payload['type'] is! String ||
        payload['value'] is! String) return null;
    final type = payload['type'] as String;
    final value = payload['value'] as String;
    if (type == 'token' && value.isNotEmpty && value.length <= 2048) {
      return (type: type, value: value);
    }
    if (type == 'error') {
      return (
        type: type,
        value: value.substring(0, value.length > 256 ? 256 : value.length),
      );
    }
    if (type == 'interactive' && (value == 'show' || value == 'hide')) {
      return (type: type, value: value);
    }
    if (type == 'ready' && value.length <= 32)
      return (type: type, value: value);
  } catch (_) {}
  return null;
}

String _secureChannel() {
  try {
    final random = Random.secure();
    return List<int>.generate(
      16,
      (_) => random.nextInt(256),
    ).map((value) => value.toRadixString(16).padLeft(2, '0')).join();
  } catch (error) {
    throw CaptchaUnavailableException(
      'secure_random_unavailable',
      cause: error,
    );
  }
}

// ─── InAppBrowser for Interactive Challenge ───

class _TurnstileBrowser extends InAppBrowser {
  final Completer<String> _completer;
  final String channel;
  final Uri challengeUri;

  _TurnstileBrowser(this._completer, this.channel, this.challengeUri);

  void _fail(String reason) {
    if (_completer.isCompleted) return;
    _completer.completeError(CaptchaUnavailableException(reason));
    unawaited(close());
  }

  @override
  void onBrowserCreated() {
    webViewController?.addJavaScriptHandler(
      handlerName: 'edgebaseCaptcha',
      callback: (args) {
        final message = parseCaptchaBridgeMessage(
          args.isNotEmpty ? args.first : null,
          channel,
        );
        if (message == null || _completer.isCompleted) return;
        if (message.type == 'token') {
          _completer.complete(message.value);
          close();
        } else if (message.type == 'error') {
          _fail(message.value);
        } else if (message.type == 'interactive' && message.value == 'show') {
          show();
        } else if (message.type == 'interactive' && message.value == 'hide') {
          hide();
        }
        return;
      },
    );
  }

  @override
  void onExit() {
    if (!_completer.isCompleted) {
      _completer.completeError(
        CaptchaUnavailableException('browser_closed'),
      );
    }
  }

  @override
  Future<NavigationActionPolicy?>? shouldOverrideUrlLoading(
    NavigationAction navigationAction,
  ) async {
    if (!navigationAction.isForMainFrame) return NavigationActionPolicy.ALLOW;
    final next = navigationAction.request.url;
    if (next != null && next.toString() == challengeUri.toString()) {
      return NavigationActionPolicy.ALLOW;
    }
    _fail('navigation_blocked');
    return NavigationActionPolicy.CANCEL;
  }

  @override
  void onReceivedError(WebResourceRequest request, WebResourceError error) {
    if (request.isForMainFrame == true) _fail('load_failed');
  }

  @override
  void onReceivedHttpError(
    WebResourceRequest request,
    WebResourceResponse errorResponse,
  ) {
    if (request.isForMainFrame == true) _fail('http_error');
  }

  @override
  void onLoadError(Uri? url, int code, String message) {
    if (url?.toString() == challengeUri.toString()) _fail('load_failed');
  }

  @override
  void onLoadHttpError(Uri? url, int statusCode, String description) {
    if (url?.toString() == challengeUri.toString()) _fail('http_error');
  }

  @override
  void onRenderProcessGone(RenderProcessGoneDetail detail) {
    _fail('renderer_terminated');
  }

  @override
  void onWebContentProcessDidTerminate() {
    _fail('renderer_terminated');
  }
}

// ─── Token Acquisition ───

Future<String> _acquireCaptchaToken(String baseUrl, String action) async {
  final completer = Completer<String>();
  final channel = _secureChannel();
  final uri = buildCaptchaChallengeUri(baseUrl, action, channel);
  final browser = _TurnstileBrowser(completer, channel, uri);
  await browser.openUrlRequest(
    urlRequest: URLRequest(url: WebUri(uri.toString())),
    settings: InAppBrowserClassSettings(
      browserSettings: InAppBrowserSettings(
        hidden: true,
        hideUrlBar: true,
        hideToolbarTop: true,
      ),
      webViewSettings: InAppWebViewSettings(
        javaScriptEnabled: true,
        domStorageEnabled: true,
        thirdPartyCookiesEnabled: true,
        sharedCookiesEnabled: true,
        transparentBackground: true,
        cacheEnabled: false,
        useShouldOverrideUrlLoading: true,
      ),
    ),
  );

  try {
    return await completer.future.timeout(const Duration(seconds: 30));
  } on TimeoutException {
    throw CaptchaUnavailableException('timeout');
  } finally {
    try {
      await browser.close();
    } catch (_) {}
  }
}

// ─── Public API ───

/// Resolve captcha token: use provided token or auto-acquire via Turnstile.
///
/// - If [manualToken] is provided → return it (manual override).
/// - If siteKey is available → auto-acquire via Turnstile in WebView.
/// - If no siteKey (captcha not configured) → return null.
Future<String?> resolveCaptchaToken(
  String baseUrl,
  String action, [
  String? manualToken,
  core.HttpClient? httpClient,
]) async {
  if (manualToken != null) return manualToken;
  if (Platform.environment['EDGEBASE_DISABLE_AUTO_CAPTCHA'] == '1' ||
      Platform.environment.containsKey('FLUTTER_TEST')) {
    return null;
  }

  final normalizedBaseUrl = _normalizeCaptchaBaseUrl(baseUrl);
  if (await _fetchSiteKey(normalizedBaseUrl, httpClient) == null) return null;

  try {
    return await _acquireCaptchaToken(normalizedBaseUrl, action);
  } on CaptchaUnavailableException {
    rethrow;
  } catch (error) {
    throw CaptchaUnavailableException('acquisition_failed', cause: error);
  }
}
