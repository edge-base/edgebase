/// Turnstile captcha provider for Flutter Web.
///
/// Loads Cloudflare Turnstile JS SDK directly in the browser DOM,
/// renders invisible widget, and shows centered modal overlay if interactive
/// challenge is needed. Mirrors JS SDK turnstile.ts behavior.
// ignore_for_file: avoid_web_libraries_in_flutter, deprecated_member_use

import 'dart:async';
import 'dart:convert';
import 'dart:html' as html;
import 'dart:js_interop';
import 'dart:js_interop_unsafe';
import 'package:edgebase_core/src/http_client.dart' as core;
import 'package:edgebase_core/src/generated/api_core.dart';
import 'captcha_errors.dart';
import 'captcha_site_key_cache.dart';

const _turnstileScriptUrl =
    'https://challenges.cloudflare.com/turnstile/v0/api.js';

// ─── Site Key Cache ───

final CaptchaSiteKeyCache _siteKeyCacheByBaseUrl = CaptchaSiteKeyCache();
final Map<String, Future<String?>> _siteKeyPromiseByBaseUrl = {};
const Duration _captchaConfigFetchTimeout = Duration(seconds: 10);

String _normalizeCaptchaBaseUrl(String baseUrl) =>
    baseUrl.trim().replaceFirst(RegExp(r'/+$'), '');

Future<String?> _fetchSiteKey(String baseUrl,
    [core.HttpClient? httpClient]) async {
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
        final String response;
        try {
          response = await html.HttpRequest.getString('$baseUrl/api/config')
              .timeout(_captchaConfigFetchTimeout);
        } catch (error) {
          throw CaptchaUnavailableException(
            'config_fetch_failed',
            cause: error,
          );
        }
        try {
          data = jsonDecode(response);
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

// ─── Script Loader ───

bool _scriptLoaded = false;
Completer<void>? _scriptLoadCompleter;
const _turnstileReadyTimeout = Duration(seconds: 10);
const _ownedScriptAttribute = 'data-edgebase-turnstile-script';

bool _isTurnstileAvailable() {
  final window = JSObject.fromInteropObject(html.window);
  if (!window.has('turnstile')) return false;
  final turnstile = window['turnstile'];
  return turnstile != null &&
      turnstile.isA<JSObject>() &&
      (turnstile as JSObject).has('render');
}

Future<void> _loadTurnstileScript({
  Duration readyTimeout = _turnstileReadyTimeout,
}) {
  if (_scriptLoaded && !_isTurnstileAvailable()) {
    _scriptLoaded = false;
  }
  if (_isTurnstileAvailable()) {
    _scriptLoaded = true;
    return Future.value();
  }
  if (_scriptLoadCompleter != null) return _scriptLoadCompleter!.future;

  final completer = Completer<void>();
  _scriptLoadCompleter = completer;
  html.ScriptElement? ownedScript;
  StreamSubscription<html.Event>? errorSubscription;

  void resetLoader() {
    errorSubscription?.cancel();
    if (identical(_scriptLoadCompleter, completer)) {
      _scriptLoadCompleter = null;
    }
  }

  void succeed() {
    if (completer.isCompleted) return;
    _scriptLoaded = true;
    completer.complete();
    resetLoader();
  }

  void fail(String reason, [Object? cause]) {
    if (completer.isCompleted) return;
    _scriptLoaded = false;
    // Never delete a script owned by the host page. An element created by
    // this loader is removed after failure so the next request can retry.
    ownedScript?.remove();
    completer.completeError(
      CaptchaUnavailableException(reason, cause: cause),
    );
    resetLoader();
  }

  Future<void> waitUntilReady() async {
    try {
      await _waitForTurnstile(
        timeout: readyTimeout,
        shouldStop: () => completer.isCompleted,
      );
      if (completer.isCompleted) return;
      succeed();
    } on CaptchaUnavailableException catch (error) {
      fail(error.reason, error.cause);
    } catch (error) {
      fail('script_ready_failed', error);
    }
  }

  // Check if already in DOM
  final existing =
      html.document.querySelector('script[src^="$_turnstileScriptUrl"]');
  if (existing is html.ScriptElement) {
    if (existing.attributes[_ownedScriptAttribute] == 'true') {
      ownedScript = existing;
    }
    errorSubscription = existing.onError.listen((error) {
      fail('script_load_failed', error);
    });
    unawaited(waitUntilReady());
    return completer.future;
  }

  final script = html.ScriptElement()
    ..src = '$_turnstileScriptUrl?render=explicit'
    ..async = true
    ..attributes[_ownedScriptAttribute] = 'true';
  ownedScript = script;
  errorSubscription = script.onError.listen((error) {
    fail('script_load_failed', error);
  });

  html.document.head!.append(script);
  // Poll immediately as well as observing onError. This bounds scripts that
  // never emit load/error and scripts whose load event fired before adoption.
  unawaited(waitUntilReady());
  return completer.future;
}

Future<void> _waitForTurnstile({
  Duration timeout = _turnstileReadyTimeout,
  bool Function()? shouldStop,
}) async {
  final stopwatch = Stopwatch()..start();
  while (!_isTurnstileAvailable()) {
    if (shouldStop?.call() ?? false) return;
    final remaining = timeout - stopwatch.elapsed;
    if (remaining <= Duration.zero) {
      throw CaptchaUnavailableException('script_ready_timeout');
    }
    await Future.delayed(
      remaining < const Duration(milliseconds: 50)
          ? remaining
          : const Duration(milliseconds: 50),
    );
  }
}

// ─── Token Acquisition ───

Future<String> _getCaptchaToken(String siteKey, String action,
    {int timeoutMs = 30000}) async {
  await _loadTurnstileScript();

  final completer = Completer<String>();

  // Create overlay (hidden by default, shown only for interactive challenge)
  final overlay = html.DivElement()
    ..style.cssText =
        'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);'
            'display:none;align-items:center;justify-content:center;z-index:999999;';

  final container = html.DivElement()
    ..style.cssText =
        'background:#fff;border-radius:12px;padding:16px;box-shadow:0 4px 24px rgba(0,0,0,0.2);';

  overlay.append(container);
  overlay.classes.add('edgebase-captcha-overlay');
  html.document.body!.append(overlay);

  String? widgetId;
  var cleanedUp = false;

  void cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    if (widgetId != null) {
      try {
        final window = JSObject.fromInteropObject(html.window);
        final turnstile = window['turnstile'] as JSObject;
        turnstile.callMethod<JSAny?>('remove'.toJS, widgetId.toJS);
      } catch (_) {}
    }
    overlay.remove();
  }

  final timer = Timer(Duration(milliseconds: timeoutMs), () {
    if (!completer.isCompleted) {
      completer.completeError(CaptchaUnavailableException('timeout'));
    }
  });

  try {
    final window = JSObject.fromInteropObject(html.window);
    final turnstile = window['turnstile'] as JSObject;
    final options = JSObject()
      ..['sitekey'] = siteKey.toJS
      ..['action'] = action.toJS
      ..['appearance'] = 'interaction-only'.toJS
      ..['callback'] = ((JSString token) {
        if (!completer.isCompleted) completer.complete(token.toDart);
      }).toJS
      ..['error-callback'] = ((JSAny? error) {
        if (!completer.isCompleted) {
          completer.completeError(
            CaptchaUnavailableException(
              'challenge_error',
              cause: error?.dartify(),
            ),
          );
        }
      }).toJS
      ..['before-interactive-callback'] = (() {
        overlay.style.display = 'flex';
      }).toJS
      ..['after-interactive-callback'] = (() {
        overlay.style.display = 'none';
      }).toJS
      ..['timeout-callback'] = (() {
        if (!completer.isCompleted) {
          completer.completeError(
            CaptchaUnavailableException('challenge_timeout'),
          );
        }
      }).toJS;

    final result = turnstile.callMethod<JSAny?>(
      'render'.toJS,
      JSObject.fromInteropObject(container),
      options,
    );
    if (result == null || !result.isA<JSString>()) {
      throw StateError('Turnstile render returned an invalid widget id.');
    }
    widgetId = (result as JSString).toDart;

    return await completer.future;
  } on CaptchaUnavailableException {
    rethrow;
  } catch (error) {
    throw CaptchaUnavailableException('render_failed', cause: error);
  } finally {
    timer.cancel();
    cleanup();
  }
}

Future<String> _getTypedCaptchaToken(String siteKey, String action) async {
  try {
    return await _getCaptchaToken(siteKey, action);
  } on CaptchaUnavailableException {
    rethrow;
  } catch (error) {
    throw CaptchaUnavailableException('acquisition_failed', cause: error);
  }
}

Future<void> debugLoadTurnstileScript({
  Duration readyTimeout = _turnstileReadyTimeout,
}) =>
    _loadTurnstileScript(readyTimeout: readyTimeout);

Future<void> debugWaitForTurnstile({
  Duration timeout = _turnstileReadyTimeout,
}) =>
    _waitForTurnstile(timeout: timeout);

Future<String> debugGetCaptchaToken(
  String siteKey,
  String action, {
  int timeoutMs = 30000,
}) =>
    _getCaptchaToken(siteKey, action, timeoutMs: timeoutMs);

bool get debugTurnstileScriptLoadInFlight => _scriptLoadCompleter != null;

void debugResetTurnstileState() {
  _scriptLoaded = false;
  _scriptLoadCompleter = null;
  _siteKeyCacheByBaseUrl.clear();
  for (final script in html.document
      .querySelectorAll('script[$_ownedScriptAttribute="true"]')) {
    script.remove();
  }
  for (final overlay
      in html.document.querySelectorAll('.edgebase-captcha-overlay')) {
    overlay.remove();
  }
}

// ─── Public API ───

/// Resolve captcha token: use provided token or auto-acquire via Turnstile.
///
/// - If [manualToken] is provided → return it (manual override).
/// - If siteKey is available → auto-acquire via Turnstile widget.
/// - If no siteKey (captcha not configured) → return null.
Future<String?> resolveCaptchaToken(String baseUrl, String action,
    [String? manualToken, core.HttpClient? httpClient]) async {
  if (manualToken != null) return manualToken;

  final normalizedBaseUrl = _normalizeCaptchaBaseUrl(baseUrl);
  final siteKey = await _fetchSiteKey(normalizedBaseUrl, httpClient);
  if (siteKey == null) return null;

  return acquireDirectCaptchaWithSingleSiteKeyRetry(
    initialSiteKey: siteKey,
    acquire: (nextSiteKey) => _getTypedCaptchaToken(nextSiteKey, action),
    refreshSiteKey: () async {
      _siteKeyCacheByBaseUrl.remove(normalizedBaseUrl);
      return _fetchSiteKey(normalizedBaseUrl, httpClient);
    },
  );
}
