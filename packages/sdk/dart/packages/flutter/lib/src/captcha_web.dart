/// Turnstile captcha provider for Flutter Web.
///
/// Loads Cloudflare Turnstile JS SDK directly in the browser DOM,
/// renders invisible widget, and shows centered modal overlay if interactive
/// challenge is needed. Mirrors JS SDK turnstile.ts behavior.
// ignore_for_file: avoid_web_libraries_in_flutter, deprecated_member_use, undefined_function, undefined_shown_name

import 'dart:async';
import 'dart:convert';
import 'dart:html' as html;
import 'package:edgebase_core/src/http_client.dart' as core;
import 'package:edgebase_core/src/generated/api_core.dart';
import 'package:js/js.dart' show allowInterop;
import 'package:js/js_util.dart'
    show callMethod, getProperty, hasProperty, jsify;

const _turnstileScriptUrl =
    'https://challenges.cloudflare.com/turnstile/v0/api.js';

// ─── Site Key Cache ───

final Map<String, String?> _siteKeyCacheByBaseUrl = {};
final Map<String, Future<String?>> _siteKeyPromiseByBaseUrl = {};

Future<String?> _fetchSiteKey(String baseUrl,
    [core.HttpClient? httpClient]) async {
  if (_siteKeyCacheByBaseUrl.containsKey(baseUrl)) {
    return _siteKeyCacheByBaseUrl[baseUrl];
  }
  final inflight = _siteKeyPromiseByBaseUrl[baseUrl];
  if (inflight != null) return inflight;

  final nextPromise = (() async {
    try {
      final Map<String, dynamic> data;
      if (httpClient != null) {
        data = await GeneratedDbApi(httpClient).getConfig()
            as Map<String, dynamic>;
      } else {
        final response =
            await html.HttpRequest.getString('$baseUrl/api/config');
        data = jsonDecode(response) as Map<String, dynamic>;
      }
      final captcha = data['captcha'] as Map<String, dynamic>?;
      final nextKey = captcha?['siteKey'] as String?;
      _siteKeyCacheByBaseUrl[baseUrl] = nextKey;
      return nextKey;
    } catch (_) {
      return null;
    } finally {
      _siteKeyPromiseByBaseUrl.remove(baseUrl);
    }
  })();

  _siteKeyPromiseByBaseUrl[baseUrl] = nextPromise;
  return nextPromise;
}

// ─── Script Loader ───

bool _scriptLoaded = false;
Completer<void>? _scriptLoadCompleter;

Future<void> _loadTurnstileScript() async {
  if (_scriptLoaded && hasProperty(html.window, 'turnstile')) return;
  if (_scriptLoadCompleter != null) return _scriptLoadCompleter!.future;

  _scriptLoadCompleter = Completer<void>();

  // Check if already in DOM
  if (html.document.querySelector('script[src^="$_turnstileScriptUrl"]') !=
      null) {
    await _waitForTurnstile();
    _scriptLoaded = true;
    _scriptLoadCompleter!.complete();
    _scriptLoadCompleter = null;
    return;
  }

  final script = html.ScriptElement()
    ..src = '$_turnstileScriptUrl?render=explicit'
    ..async = true;

  script.onLoad.listen((_) async {
    await _waitForTurnstile();
    _scriptLoaded = true;
    _scriptLoadCompleter?.complete();
    _scriptLoadCompleter = null;
  });

  script.onError.listen((_) {
    _scriptLoadCompleter
        ?.completeError(Exception('Failed to load Turnstile script'));
    _scriptLoadCompleter = null;
  });

  html.document.head!.append(script);
  return _scriptLoadCompleter!.future;
}

Future<void> _waitForTurnstile() async {
  while (!hasProperty(html.window, 'turnstile')) {
    await Future.delayed(const Duration(milliseconds: 50));
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
  html.document.body!.append(overlay);

  String? widgetId;

  void cleanup() {
    if (widgetId != null) {
      try {
        final turnstile = getProperty(html.window, 'turnstile');
        callMethod(turnstile, 'remove', [widgetId]);
      } catch (_) {}
    }
    overlay.remove();
  }

  final timer = Timer(Duration(milliseconds: timeoutMs), () {
    cleanup();
    if (!completer.isCompleted) {
      completer.completeError(Exception('Turnstile timeout'));
    }
  });

  final turnstile = getProperty(html.window, 'turnstile');
  widgetId = callMethod(turnstile, 'render', [
    container,
    jsify({
      'sitekey': siteKey,
      'action': action,
      'appearance': 'interaction-only',
      'callback': allowInterop((String token) {
        timer.cancel();
        cleanup();
        if (!completer.isCompleted) completer.complete(token);
      }),
      'error-callback': allowInterop((dynamic error) {
        timer.cancel();
        cleanup();
        if (!completer.isCompleted) {
          completer.completeError(Exception('Turnstile error: $error'));
        }
      }),
      'before-interactive-callback': allowInterop(() {
        overlay.style.display = 'flex';
      }),
      'after-interactive-callback': allowInterop(() {
        overlay.style.display = 'none';
      }),
      'timeout-callback': allowInterop(() {
        timer.cancel();
        cleanup();
        if (!completer.isCompleted) {
          completer.completeError(Exception('Turnstile challenge timed out'));
        }
      }),
    }),
  ]) as String?;

  return completer.future;
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

  final siteKey = await _fetchSiteKey(baseUrl, httpClient);
  if (siteKey == null) return null;

  try {
    return await _getCaptchaToken(siteKey, action);
  } catch (_) {
    return null; // Turnstile failed — let server handle (failMode: open/closed)
  }
}
