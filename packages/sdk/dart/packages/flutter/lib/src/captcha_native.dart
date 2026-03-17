/// Turnstile captcha provider for Flutter native platforms.
///
/// Android, iOS, macOS, Windows, Linux — uses flutter_inappwebview.
/// Phase 1: HeadlessInAppWebView (invisible, handles 99% auto-pass).
/// Phase 2: InAppBrowser fallback (visible, for 1% interactive challenge).

import 'dart:async';
import 'dart:convert';
import 'dart:io' show Platform;
import 'package:http/http.dart' as http;
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:edgebase_core/src/http_client.dart' as core;
import 'package:edgebase_core/src/generated/api_core.dart';

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
        final res = await http.get(Uri.parse('$baseUrl/api/config'));
        if (res.statusCode != 200) return null;
        data = jsonDecode(res.body) as Map<String, dynamic>;
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

// ─── Turnstile HTML Template ───

String _turnstileHtml(String siteKey, String action) => '''
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async></script>
  <style>
    body { margin:0; display:flex; align-items:center; justify-content:center;
           min-height:100vh; background:transparent; font-family:system-ui; }
    .msg { color:#666; font-size:14px; text-align:center; padding:20px; }
  </style>
</head>
<body>
  <div id="cf-turnstile"></div>
  <div class="msg" id="msg">Verifying...</div>
  <script>
    function initTurnstile() {
      if (window.turnstile) {
        document.getElementById('msg').style.display = 'none';
        window.turnstile.render('#cf-turnstile', {
          sitekey: '$siteKey',
          action: '$action',
          appearance: 'interaction-only',
          callback: function(token) {
            window.flutter_inappwebview.callHandler('onToken', token);
          },
          'error-callback': function(err) {
            window.flutter_inappwebview.callHandler('onError', String(err));
          },
          'before-interactive-callback': function() {
            window.flutter_inappwebview.callHandler('onInteractive', 'show');
          },
          'after-interactive-callback': function() {
            window.flutter_inappwebview.callHandler('onInteractive', 'hide');
          },
          'timeout-callback': function() {
            window.flutter_inappwebview.callHandler('onError', 'timeout');
          }
        });
      } else {
        setTimeout(initTurnstile, 50);
      }
    }
    initTurnstile();
  </script>
</body>
</html>
''';

// ─── InAppBrowser for Interactive Challenge ───

class _TurnstileBrowser extends InAppBrowser {
  final Completer<String> _completer;

  _TurnstileBrowser(this._completer);

  @override
  void onWebViewCreated() {
    webViewController?.addJavaScriptHandler(
      handlerName: 'onToken',
      callback: (args) {
        if (!_completer.isCompleted) {
          _completer.complete(args[0].toString());
          close();
        }
      },
    );
    webViewController?.addJavaScriptHandler(
      handlerName: 'onError',
      callback: (args) {
        if (!_completer.isCompleted) {
          _completer.completeError(Exception('Turnstile error: ${args[0]}'));
          close();
        }
      },
    );
    webViewController?.addJavaScriptHandler(
      handlerName: 'onInteractive',
      callback: (_) {}, // Already visible in browser mode
    );
  }

  @override
  void onExit() {
    if (!_completer.isCompleted) {
      _completer.completeError(Exception('Turnstile browser closed'));
    }
  }
}

// ─── Token Acquisition ───

Future<String> _acquireCaptchaToken(String siteKey, String action) async {
  final completer = Completer<String>();
  bool disposed = false;
  HeadlessInAppWebView? headless;

  // Phase 1: HeadlessInAppWebView (invisible, auto-pass for 99% of users)
  headless = HeadlessInAppWebView(
    initialData: InAppWebViewInitialData(data: _turnstileHtml(siteKey, action)),
    initialSettings: InAppWebViewSettings(
      javaScriptEnabled: true,
    ),
    onWebViewCreated: (controller) {
      controller.addJavaScriptHandler(
        handlerName: 'onToken',
        callback: (args) {
          if (!completer.isCompleted) {
            completer.complete(args[0].toString());
          }
        },
      );
      controller.addJavaScriptHandler(
        handlerName: 'onError',
        callback: (args) {
          if (!completer.isCompleted) {
            completer.completeError(Exception('Turnstile error: ${args[0]}'));
          }
        },
      );
      controller.addJavaScriptHandler(
        handlerName: 'onInteractive',
        callback: (args) async {
          // Phase 2: Interactive challenge needed — open visible browser
          if (args[0] == 'show' && !completer.isCompleted) {
            if (!disposed) {
              disposed = true;
              try {
                await headless?.dispose();
              } catch (_) {}
            }
            final browser = _TurnstileBrowser(completer);
            await browser.openData(
              data: _turnstileHtml(siteKey, action),
              settings: InAppBrowserClassSettings(
                webViewSettings: InAppWebViewSettings(
                  javaScriptEnabled: true,
                  transparentBackground: true,
                ),
              ),
            );
          }
        },
      );
    },
  );

  await headless.run();

  // Wait with timeout
  try {
    return await completer.future.timeout(const Duration(seconds: 30));
  } on TimeoutException {
    throw Exception('Turnstile timeout');
  } finally {
    if (!disposed) {
      disposed = true;
      try {
        await headless.dispose();
      } catch (_) {}
    }
  }
}

// ─── Public API ───

/// Resolve captcha token: use provided token or auto-acquire via Turnstile.
///
/// - If [manualToken] is provided → return it (manual override).
/// - If siteKey is available → auto-acquire via Turnstile in WebView.
/// - If no siteKey (captcha not configured) → return null.
Future<String?> resolveCaptchaToken(String baseUrl, String action,
    [String? manualToken, core.HttpClient? httpClient]) async {
  if (manualToken != null) return manualToken;
  if (Platform.environment['EDGEBASE_DISABLE_AUTO_CAPTCHA'] == '1' ||
      Platform.environment.containsKey('FLUTTER_TEST')) {
    return null;
  }

  final siteKey = await _fetchSiteKey(baseUrl, httpClient);
  if (siteKey == null) return null;

  try {
    return await _acquireCaptchaToken(siteKey, action);
  } catch (_) {
    return null; // Turnstile failed — let server handle (failMode: open/closed)
  }
}
