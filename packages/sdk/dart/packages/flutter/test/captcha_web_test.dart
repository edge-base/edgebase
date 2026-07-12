// ignore_for_file: deprecated_member_use

@TestOn('browser')

import 'dart:async';
import 'dart:html' as html;
import 'dart:js_interop';
import 'dart:js_interop_unsafe';

import 'package:edgebase_core/src/context_manager.dart';
import 'package:edgebase_core/src/http_client.dart' as core_http;
import 'package:edgebase_flutter/src/captcha_errors.dart';
import 'package:edgebase_flutter/src/captcha_site_key_cache.dart';
import 'package:edgebase_flutter/src/captcha_web.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:test/test.dart';

void main() {
  setUp(() {
    debugResetTurnstileState();
    JSObject.fromInteropObject(html.window)['turnstile'] = null;
  });

  tearDown(() {
    debugResetTurnstileState();
    JSObject.fromInteropObject(html.window)['turnstile'] = null;
  });

  test('script readiness polling is bounded', () async {
    final stopwatch = Stopwatch()..start();

    await expectLater(
      debugWaitForTurnstile(timeout: const Duration(milliseconds: 30)),
      throwsA(
        isA<CaptchaUnavailableException>().having(
          (error) => error.reason,
          'reason',
          'script_ready_timeout',
        ),
      ),
    );

    expect(stopwatch.elapsed, lessThan(const Duration(seconds: 1)));
  });

  test('config fetch failure is not treated as captcha disabled', () async {
    final transport = MockClient((request) async =>
        http.Response('{"message":"synthetic outage"}', 503));
    final httpClient = core_http.HttpClient(
      baseUrl: 'https://captcha-web-config-failure.example.test',
      contextManager: ContextManager(),
      client: transport,
    );

    await expectLater(
      debugFetchCaptchaSiteKey(httpClient.baseUrl, httpClient),
      throwsA(
        isA<CaptchaUnavailableException>().having(
          (error) => error.reason,
          'reason',
          'config_fetch_failed',
        ),
      ),
    );
    httpClient.close();
  });

  test('owned failed script is removed and loader can retry', () async {
    final firstFuture = debugLoadTurnstileScript(
      readyTimeout: const Duration(seconds: 1),
    );
    final firstScript = html.document.querySelector(
      'script[data-edgebase-turnstile-script="true"]',
    );
    expect(firstScript, isNotNull);

    final firstExpectation = expectLater(
      firstFuture,
      throwsA(
        isA<CaptchaUnavailableException>().having(
          (error) => error.reason,
          'reason',
          'script_load_failed',
        ),
      ),
    );
    firstScript!.dispatchEvent(html.Event('error'));
    await firstExpectation;

    expect(firstScript.parentNode, isNull);
    expect(debugTurnstileScriptLoadInFlight, isFalse);

    final retryFuture = debugLoadTurnstileScript(
      readyTimeout: const Duration(seconds: 1),
    );
    final retryScript = html.document.querySelector(
      'script[data-edgebase-turnstile-script="true"]',
    );
    expect(retryScript, isNotNull);
    expect(identical(retryScript, firstScript), isFalse);

    final retryExpectation = expectLater(
      retryFuture,
      throwsA(isA<CaptchaUnavailableException>()),
    );
    retryScript!.dispatchEvent(html.Event('error'));
    await retryExpectation;
    expect(debugTurnstileScriptLoadInFlight, isFalse);
  });

  test('synchronous render failure removes overlay and cancels timeout',
      () async {
    void failRender(JSAny? container, JSAny? options) {
      throw StateError('synthetic synchronous render failure');
    }

    final turnstile = JSObject()
      ..['render'] = failRender.toJS
      ..['remove'] = ((JSAny? widgetId) {}).toJS;
    JSObject.fromInteropObject(html.window)['turnstile'] = turnstile;

    await expectLater(
      debugGetCaptchaToken(
        'synthetic-site-key',
        'signin',
        timeoutMs: 50,
      ),
      throwsA(
        isA<CaptchaUnavailableException>().having(
          (error) => error.reason,
          'reason',
          'render_failed',
        ),
      ),
    );

    expect(
      html.document.querySelectorAll('.edgebase-captcha-overlay'),
      isEmpty,
    );
    // A leaked timer would attempt to complete the same future after 50 ms.
    await Future<void>.delayed(const Duration(milliseconds: 80));
    expect(
      html.document.querySelectorAll('.edgebase-captcha-overlay'),
      isEmpty,
    );
  });

  test('challenge error retries once with a fresh key and cleans both widgets',
      () async {
    var renderCount = 0;
    var removeCount = 0;
    JSString failChallenge(JSAny? container, JSAny? options) {
      renderCount += 1;
      final callback = (options as JSObject)['error-callback'] as JSFunction;
      Timer.run(
        () => callback.callAsFunction(null, 'invalid-sitekey'.toJS),
      );
      return 'widget-$renderCount'.toJS;
    }

    final turnstile = JSObject()
      ..['render'] = failChallenge.toJS
      ..['remove'] = ((JSAny? widgetId) {
        removeCount += 1;
      }).toJS;
    JSObject.fromInteropObject(html.window)['turnstile'] = turnstile;

    var refreshCount = 0;
    await expectLater(
      acquireDirectCaptchaWithSingleSiteKeyRetry(
        initialSiteKey: 'site-key-v1',
        acquire: (siteKey) => debugGetCaptchaToken(
          siteKey,
          'signin',
          timeoutMs: 1000,
        ),
        refreshSiteKey: () async {
          refreshCount += 1;
          return 'site-key-v2';
        },
      ),
      throwsA(
        isA<CaptchaUnavailableException>().having(
          (error) => error.reason,
          'reason',
          'challenge_error',
        ),
      ),
    );

    expect(refreshCount, 1);
    expect(renderCount, 2);
    expect(removeCount, 2);
    expect(
      html.document.querySelectorAll('.edgebase-captcha-overlay'),
      isEmpty,
    );
    expect(debugTurnstileScriptLoadInFlight, isFalse);
  });
}
