// edgebase Flutter SDK — 단위 테스트
//
// 테스트 대상:
//   - SignUpOptions (필드 구성)
//   - SignInOptions (필드 구성)
//   - AuthResult (fromJson 파싱)
//   - Session (fromJson 파싱)
//   - UpdateProfileOptions (toJson nullable)
//   - EdgeBase.client factory
//   - ClientEdgeBase db/storage/auth/push/room 접근자
//
// 실행: cd packages/sdk/dart/packages/flutter && dart test test/flutter_unit_test.dart
//
// 원칙: 서버 불필요 — 순수 Dart 로직만 검증

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:test/test.dart';
import 'package:edgebase_flutter/edgebase_flutter.dart';
import 'package:edgebase_core/src/http_client.dart' as core_http;
import 'package:edgebase_core/src/token_manager.dart' as core_tokens;
import 'package:edgebase_flutter/src/database_live_client.dart';
import 'package:edgebase_flutter/src/captcha_native.dart';
import 'package:edgebase_flutter/src/captcha_site_key_cache.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

class _FailingReplacementTokenStorage implements DurableTokenStorage {
  StoredTokenPair? _pair;
  bool failReplacementWrite = false;

  String? get value => _pair?.refreshToken;

  @override
  Future<String?> getRefreshToken() async => _pair?.refreshToken;

  @override
  Future<void> setRefreshToken(String token) async {
    if (failReplacementWrite && token == 'permanent-refresh') {
      throw StateError('synthetic persistence failure');
    }
    _pair = StoredTokenPair(accessToken: null, refreshToken: token);
  }

  @override
  Future<void> clearRefreshToken() async {
    _pair = null;
  }

  @override
  Future<StoredTokenPair?> getTokenPair() async => _pair;

  @override
  Future<void> setTokenPair(StoredTokenPair pair) async {
    if (failReplacementWrite && pair.refreshToken == 'permanent-refresh') {
      throw StateError('synthetic persistence failure');
    }
    _pair = pair;
  }
}

void main() {
  group('Turnstile site key cache', () {
    test('positive entries expire at five minutes', () {
      var now = 0;
      final cache = CaptchaSiteKeyCache(nowMilliseconds: () => now);
      cache.write('https://api.example.test', 'site-key-v1');

      now = captchaSiteKeyCacheTtl.inMilliseconds - 1;
      expect(cache.read('https://api.example.test'), 'site-key-v1');

      now = captchaSiteKeyCacheTtl.inMilliseconds;
      expect(cache.read('https://api.example.test'), isNull);

      cache.write('https://api.example.test', 'site-key-v2');
      expect(cache.read('https://api.example.test'), 'site-key-v2');
    });

    test('only direct challenge_error is eligible for one fresh-key retry', () {
      expect(shouldRetryCaptchaWithFreshSiteKey('challenge_error'), isTrue);
      expect(shouldRetryCaptchaWithFreshSiteKey('timeout'), isFalse);
      expect(shouldRetryCaptchaWithFreshSiteKey('render_failed'), isFalse);
      expect(shouldRetryCaptchaWithFreshSiteKey('script_load_failed'), isFalse);
    });

    test('config fetch failure is not treated as captcha disabled', () async {
      final transport = MockClient((request) async =>
          http.Response('{"message":"synthetic outage"}', 503));
      final httpClient = core_http.HttpClient(
        baseUrl: 'https://captcha-config-failure.example.test',
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

    test('explicit null captcha config remains disabled', () async {
      final transport =
          MockClient((request) async => http.Response('{"captcha":null}', 200));
      final httpClient = core_http.HttpClient(
        baseUrl: 'https://captcha-disabled.example.test',
        contextManager: ContextManager(),
        client: transport,
      );

      expect(
        await debugFetchCaptchaSiteKey(httpClient.baseUrl, httpClient),
        isNull,
      );
      httpClient.close();
    });

    test('missing captcha config is rejected as malformed', () async {
      expect(
        () => parseCaptchaSiteKeyConfig(const <String, Object?>{}),
        throwsA(
          isA<CaptchaUnavailableException>().having(
            (error) => error.reason,
            'reason',
            'config_invalid_response',
          ),
        ),
      );
    });

    test('malformed captcha JSON has invalid-response reason', () async {
      final transport =
          MockClient((request) async => http.Response('not-json', 200));
      final httpClient = core_http.HttpClient(
        baseUrl: 'https://captcha-invalid-json.example.test',
        contextManager: ContextManager(),
        client: transport,
      );

      await expectLater(
        debugFetchCaptchaSiteKey(httpClient.baseUrl, httpClient),
        throwsA(
          isA<CaptchaUnavailableException>().having(
            (error) => error.reason,
            'reason',
            'config_invalid_response',
          ),
        ),
      );
      httpClient.close();
    });
  });

  group('Hosted Turnstile bridge', () {
    test('builds an HTTPS channel-bound challenge URI', () {
      const channel = '0123456789abcdef0123456789abcdef';
      final uri = buildCaptchaChallengeUri(
        'https://api.example.test/',
        'signin',
        channel,
      );
      expect(uri.scheme, 'https');
      expect(uri.host, 'api.example.test');
      expect(uri.path, '/api/captcha/challenge');
      expect(uri.queryParameters, {
        'action': 'signin',
        'channel': channel,
        'bridge': 'flutter',
      });
    });

    test('rejects HTTP origins and dynamic actions', () {
      const channel = '0123456789abcdef0123456789abcdef';
      expect(
        () => buildCaptchaChallengeUri(
          'http://api.example.test',
          'signin',
          channel,
        ),
        throwsArgumentError,
      );
      expect(
        () => buildCaptchaChallengeUri(
          'https://api.example.test',
          'function:unsafe',
          channel,
        ),
        throwsArgumentError,
      );
    });

    test('accepts only versioned messages for the expected channel', () {
      const channel = '0123456789abcdef0123456789abcdef';
      final valid = jsonEncode({
        'v': 1,
        'channel': channel,
        'type': 'token',
        'value': 'synthetic-token',
      });
      final wrong = jsonEncode({
        'v': 1,
        'channel': 'fedcba9876543210fedcba9876543210',
        'type': 'token',
        'value': 'synthetic-token',
      });
      expect(
        parseCaptchaBridgeMessage(valid, channel)?.value,
        'synthetic-token',
      );
      expect(parseCaptchaBridgeMessage(wrong, channel), isNull);
    });

    test('captcha unavailable exposes a stable diagnostic code and reason', () {
      final error = CaptchaUnavailableException('renderer_terminated');
      expect(error.code, 'captcha-unavailable');
      expect(error.reason, 'renderer_terminated');
    });
  });

  // ─── A. SignUpOptions ───────────────────────────────────────────────────────

  group('SignUpOptions', () {
    test('required fields stored', () {
      final opts = SignUpOptions(email: 'a@b.com', password: 'pass123');
      expect(opts.email, equals('a@b.com'));
      expect(opts.password, equals('pass123'));
    });

    test('data null by default', () {
      final opts = SignUpOptions(email: 'a@b.com', password: 'pass');
      expect(opts.data, isNull);
    });

    test('data provided', () {
      final opts = SignUpOptions(
        email: 'a@b.com',
        password: 'pass',
        data: {'displayName': 'Alice'},
      );
      expect(opts.data?['displayName'], equals('Alice'));
    });

    test('captchaToken null by default', () {
      final opts = SignUpOptions(email: 'a@b.com', password: 'pass');
      expect(opts.captchaToken, isNull);
    });

    test('captchaToken provided', () {
      final opts = SignUpOptions(
        email: 'a@b.com',
        password: 'pass',
        captchaToken: 'ct-123',
      );
      expect(opts.captchaToken, equals('ct-123'));
    });
  });

  // ─── B. SignInOptions ───────────────────────────────────────────────────────

  group('SignInOptions', () {
    test('fields stored', () {
      final opts = SignInOptions(email: 'x@y.com', password: 'pw');
      expect(opts.email, equals('x@y.com'));
      expect(opts.password, equals('pw'));
    });

    test('captchaToken null by default', () {
      final opts = SignInOptions(email: 'x@y.com', password: 'pw');
      expect(opts.captchaToken, isNull);
    });
  });

  // ─── C. Session.fromJson ───────────────────────────────────────────────────

  group('Session.fromJson', () {
    test('required fields', () {
      final s = Session.fromJson({
        'id': 's-1',
        'createdAt': '2024-01-01T00:00:00Z',
      });
      expect(s.id, equals('s-1'));
      expect(s.createdAt, equals('2024-01-01T00:00:00Z'));
    });

    test('nullable userAgent', () {
      final s = Session.fromJson({
        'id': 's-1',
        'createdAt': '2024-01-01',
        'userAgent': 'Mozilla',
      });
      expect(s.userAgent, equals('Mozilla'));
    });

    test('userAgent null when missing', () {
      final s = Session.fromJson({'id': 's-1', 'createdAt': '2024-01-01'});
      expect(s.userAgent, isNull);
    });

    test('ip field', () {
      final s = Session.fromJson({
        'id': 's-1',
        'createdAt': '2024-01-01',
        'ip': '1.2.3.4',
      });
      expect(s.ip, equals('1.2.3.4'));
    });
  });

  // ─── D. UpdateProfileOptions.toJson ────────────────────────────────────────

  group('UpdateProfileOptions.toJson', () {
    test('empty → empty map', () {
      final opts = UpdateProfileOptions();
      expect(opts.toJson(), isEmpty);
    });

    test('displayName only', () {
      final opts = UpdateProfileOptions(displayName: 'Bob');
      expect(opts.toJson()['displayName'], equals('Bob'));
      expect(opts.toJson().containsKey('avatarUrl'), isFalse);
    });

    test('avatarUrl only', () {
      final opts = UpdateProfileOptions(
        avatarUrl: 'https://cdn.test/avatar.png',
      );
      expect(opts.toJson()['avatarUrl'], equals('https://cdn.test/avatar.png'));
    });

    test('all fields', () {
      final opts = UpdateProfileOptions(
        displayName: 'Alice',
        avatarUrl: 'https://img.test/a.png',
        emailVisibility: 'public',
      );
      final json = opts.toJson();
      expect(json['displayName'], equals('Alice'));
      expect(json['avatarUrl'], equals('https://img.test/a.png'));
      expect(json['emailVisibility'], equals('public'));
    });
  });

  // ─── E. signInWithOAuth URL building ────────────────────────────────────────

  group('signInWithOAuth URL', () {
    test('basic provider URL construction', () {
      // Verify URL building logic (static, no HTTP call)
      final baseUrl = 'http://localhost:8688';
      final provider = 'google';
      final url = '$baseUrl/api/auth/oauth/${Uri.encodeComponent(provider)}';
      expect(url, contains('google'));
      expect(url, contains('/api/auth/oauth/'));
    });

    test('URL with captchaToken', () {
      const baseUrl = 'http://localhost:8688';
      const captchaToken = 'ct-abc-123';
      final base = '$baseUrl/api/auth/oauth/${Uri.encodeComponent('github')}';
      final url = '$base?captcha_token=${Uri.encodeComponent(captchaToken)}';
      expect(url, contains('captcha_token'));
      expect(url, contains('ct-abc-123'));
    });
  });

  group('Auth HTTP requests', () {
    late HttpServer server;
    late String baseUrl;

    setUp(() async {
      server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      baseUrl = 'http://${server.address.address}:${server.port}';
    });

    tearDown(() async {
      await server.close(force: true);
    });

    test('signInWithPhone forwards phone captcha token', () async {
      final requestSeen = Completer<void>();

      server.listen((request) async {
        if (request.uri.path == '/api/auth/signin/phone') {
          final payload = jsonDecode(await utf8.decoder.bind(request).join())
              as Map<String, dynamic>;
          expect(payload['phone'], equals('+821012345678'));
          expect(payload['captchaToken'], equals('ct-phone-123'));
          request.response
            ..statusCode = HttpStatus.ok
            ..headers.contentType = ContentType.json
            ..write('{}');
          await request.response.close();
          if (!requestSeen.isCompleted) requestSeen.complete();
          return;
        }

        request.response.statusCode = HttpStatus.notFound;
        await request.response.close();
      });

      final client = ClientEdgeBase(
        baseUrl,
        options: EdgeBaseClientOptions(tokenStorage: MemoryTokenStorage()),
      );
      await client.auth.signInWithPhone(
        phone: '+821012345678',
        captchaToken: 'ct-phone-123',
      );
      await requestSeen.future.timeout(const Duration(seconds: 5));
      client.destroy();
    });

    test('verifyEmailChange posts token to verify-email-change', () async {
      final requestSeen = Completer<void>();

      server.listen((request) async {
        if (request.uri.path == '/api/auth/verify-email-change') {
          final payload = jsonDecode(await utf8.decoder.bind(request).join())
              as Map<String, dynamic>;
          expect(payload['token'], equals('email-change-token'));
          request.response
            ..statusCode = HttpStatus.ok
            ..headers.contentType = ContentType.json
            ..write('{}');
          await request.response.close();
          if (!requestSeen.isCompleted) requestSeen.complete();
          return;
        }

        request.response.statusCode = HttpStatus.notFound;
        await request.response.close();
      });

      final client = ClientEdgeBase(
        baseUrl,
        options: EdgeBaseClientOptions(tokenStorage: MemoryTokenStorage()),
      );
      await client.auth.verifyEmailChange('email-change-token');
      await requestSeen.future.timeout(const Duration(seconds: 5));
      client.destroy();
    });

    test('verifyLinkPhone adopts anonymous upgrade replacement tokens',
        () async {
      String jwt(String id, bool anonymous) {
        String segment(Map<String, dynamic> value) => base64Url
            .encode(utf8.encode(jsonEncode(value)))
            .replaceAll('=', '');
        return '${segment({'alg': 'none'})}.${segment({
              'sub': id,
              'id': id,
              'isAnonymous': anonymous,
              'exp': DateTime.now()
                      .add(const Duration(hours: 1))
                      .millisecondsSinceEpoch ~/
                  1000,
            })}.signature';
      }

      server.listen((request) async {
        request.response.headers.contentType = ContentType.json;
        if (request.uri.path == '/api/auth/signin/anonymous') {
          request.response.write(jsonEncode({
            'accessToken': jwt('anonymous-user', true),
            'refreshToken': 'anonymous-refresh',
            'user': {'id': 'anonymous-user', 'isAnonymous': true},
          }));
        } else if (request.uri.path == '/api/auth/verify-link-phone') {
          request.response.write(jsonEncode({
            'ok': true,
            'accessToken': jwt('permanent-user', false),
            'refreshToken': 'permanent-refresh',
            'sessionId': 'permanent-session',
            'user': {'id': 'permanent-user', 'isAnonymous': false},
          }));
        } else {
          request.response.statusCode = HttpStatus.notFound;
          request.response.write('{}');
        }
        await request.response.close();
      });

      final client = ClientEdgeBase(
        baseUrl,
        options: EdgeBaseClientOptions(
          tokenStorage: _FailingReplacementTokenStorage(),
        ),
      );
      await client.auth.signInAnonymously();
      expect(client.auth.currentUser?.id, 'anonymous-user');
      await client.auth.verifyLinkPhone(phone: '+821012345678', code: '123456');
      expect(client.auth.currentUser?.id, 'permanent-user');
      expect(client.auth.currentUser?.isAnonymous, isFalse);
      client.destroy();
    });

    test(
      'verifyLinkPhone persists replacement before exposure and retry recovers',
      () async {
        String jwt(String id, bool anonymous) {
          String segment(Map<String, dynamic> value) => base64Url
              .encode(utf8.encode(jsonEncode(value)))
              .replaceAll('=', '');
          return '${segment({'alg': 'none'})}.${segment({
                'sub': id,
                'id': id,
                'isAnonymous': anonymous,
                'exp': DateTime.now()
                        .add(const Duration(hours: 1))
                        .millisecondsSinceEpoch ~/
                    1000,
              })}.signature';
        }

        server.listen((request) async {
          request.response.headers.contentType = ContentType.json;
          if (request.uri.path == '/api/auth/signin/anonymous') {
            request.response.write(jsonEncode({
              'accessToken': jwt('anonymous-user', true),
              'refreshToken': 'anonymous-refresh',
              'user': {'id': 'anonymous-user', 'isAnonymous': true},
            }));
          } else if (request.uri.path == '/api/auth/verify-link-phone') {
            // The authoritative operation is retry-safe: the same phone/code
            // returns the same replacement session after response/persistence loss.
            request.response.write(jsonEncode({
              'ok': true,
              'accessToken': jwt('permanent-user', false),
              'refreshToken': 'permanent-refresh',
              'sessionId': 'permanent-session',
              'user': {'id': 'permanent-user', 'isAnonymous': false},
            }));
          } else {
            request.response.statusCode = HttpStatus.notFound;
            request.response.write('{}');
          }
          await request.response.close();
        });

        final storage = _FailingReplacementTokenStorage();
        final client = ClientEdgeBase(
          baseUrl,
          options: EdgeBaseClientOptions(tokenStorage: storage),
        );
        await client.auth.signInAnonymously();
        expect(client.auth.currentUser?.id, 'anonymous-user');
        expect(storage.value, 'anonymous-refresh');

        storage.failReplacementWrite = true;
        await expectLater(
          client.auth.verifyLinkPhone(
            phone: '+821012345678',
            code: '123456',
          ),
          throwsA(isA<TokenPersistenceException>()),
        );
        expect(client.auth.currentUser?.id, 'anonymous-user');
        expect(storage.value, 'anonymous-refresh');

        storage.failReplacementWrite = false;
        await client.auth.verifyLinkPhone(
          phone: '+821012345678',
          code: '123456',
        );
        expect(client.auth.currentUser?.id, 'permanent-user');
        expect(storage.value, 'permanent-refresh');
        client.destroy();
      },
    );

    test(
      'linkWithEmail replays the checkpoint before adopting replacement tokens',
      () async {
        String jwt(String id, bool anonymous) {
          String segment(Map<String, dynamic> value) => base64Url
              .encode(utf8.encode(jsonEncode(value)))
              .replaceAll('=', '');
          return '${segment({'alg': 'none'})}.${segment({
                'sub': id,
                'id': id,
                'isAnonymous': anonymous,
                'exp': DateTime.now()
                        .add(const Duration(hours: 1))
                        .millisecondsSinceEpoch ~/
                    1000,
              })}.signature';
        }

        final anonymousAccess = jwt('anonymous-user', true);
        final permanentAccess = jwt('permanent-user', false);
        final linkBodies = <Map<String, dynamic>>[];
        final linkAuthorizationHeaders = <String?>[];

        server.listen((request) async {
          request.response.headers.contentType = ContentType.json;
          if (request.uri.path == '/api/auth/signin/anonymous') {
            request.response.write(jsonEncode({
              'accessToken': anonymousAccess,
              'refreshToken': 'anonymous-refresh',
              'user': {'id': 'anonymous-user', 'isAnonymous': true},
            }));
          } else if (request.uri.path == '/api/auth/link/email') {
            linkBodies.add(
              jsonDecode(await utf8.decoder.bind(request).join())
                  as Map<String, dynamic>,
            );
            linkAuthorizationHeaders.add(
              request.headers.value(HttpHeaders.authorizationHeader),
            );
            // The server's five-minute checkpoint replays this exact pair for
            // the same anonymous session, normalized email, and password.
            request.response.write(jsonEncode({
              'sessionId': 'permanent-session',
              'accessToken': permanentAccess,
              'refreshToken': 'permanent-refresh',
              'user': {'id': 'permanent-user', 'isAnonymous': false},
            }));
          } else {
            request.response.statusCode = HttpStatus.notFound;
            request.response.write('{}');
          }
          await request.response.close();
        });

        final storage = _FailingReplacementTokenStorage();
        final client = ClientEdgeBase(
          baseUrl,
          options: EdgeBaseClientOptions(tokenStorage: storage),
        );
        await client.auth.signInAnonymously();
        expect(client.auth.currentUser?.id, 'anonymous-user');
        expect(storage.value, 'anonymous-refresh');

        storage.failReplacementWrite = true;
        await expectLater(
          client.auth.linkWithEmail(
            email: 'user@example.test',
            password: 'Exact-Pass-123!',
          ),
          throwsA(isA<TokenPersistenceException>()),
        );
        expect(client.auth.currentUser?.id, 'anonymous-user');
        expect(storage.value, 'anonymous-refresh');

        storage.failReplacementWrite = false;
        final replay = await client.auth.linkWithEmail(
          email: 'user@example.test',
          password: 'Exact-Pass-123!',
        );

        expect(replay.accessToken, permanentAccess);
        expect(client.auth.currentUser?.id, 'permanent-user');
        expect(storage.value, 'permanent-refresh');
        expect(linkBodies, hasLength(2));
        expect(linkBodies[0], linkBodies[1]);
        expect(linkBodies[0], {
          'email': 'user@example.test',
          'password': 'Exact-Pass-123!',
        });
        expect(linkAuthorizationHeaders, [
          'Bearer $anonymousAccess',
          'Bearer $anonymousAccess',
        ]);
        client.destroy();
      },
    );

    test('account upgrade fails before network without durable pair storage',
        () async {
      var requests = 0;
      server.listen((request) async {
        requests += 1;
        request.response
          ..statusCode = HttpStatus.internalServerError
          ..write('{}');
        await request.response.close();
      });
      final client = ClientEdgeBase(
        baseUrl,
        options: EdgeBaseClientOptions(tokenStorage: MemoryTokenStorage()),
      );

      await expectLater(
        client.auth.linkWithEmail(
          email: 'user@example.test',
          password: 'Exact-Pass-123!',
        ),
        throwsA(isA<StateError>()),
      );

      expect(requests, 0);
      client.destroy();
    });
  });

  group('Functions CAPTCHA transport', () {
    test('sends the dedicated header for GET, POST, and DELETE', () async {
      final seen = <http.Request>[];
      final transport = MockClient((request) async {
        seen.add(request);
        return http.Response('{}', HttpStatus.ok, headers: {
          HttpHeaders.contentTypeHeader: ContentType.json.mimeType,
        });
      });
      final httpClient = core_http.HttpClient(
        baseUrl: 'https://api.example.test',
        tokenManager: _NoopCoreTokenManager(),
        contextManager: ContextManager(),
        client: transport,
      );
      final functions = FunctionsClient(httpClient);

      for (final method in ['GET', 'POST', 'DELETE']) {
        await functions.call(
          'protected-${method.toLowerCase()}',
          options: FunctionCallOptions(
            method: method,
            body: method == 'POST' ? const {'ok': true} : null,
            query: method == 'GET' ? const {'page': '1'} : null,
            captchaToken: 'captcha-$method',
          ),
        );
      }

      expect(seen.map((request) => request.method), ['GET', 'POST', 'DELETE']);
      expect(
        seen.map((request) => request.headers['X-EdgeBase-Captcha-Token']),
        ['captcha-GET', 'captcha-POST', 'captcha-DELETE'],
      );
      expect(seen.first.url.queryParameters['page'], '1');
      httpClient.close();
    });

    test('never replays network, 401, or 429 failures', () async {
      final attempts = <String, int>{};
      final transport = MockClient((request) async {
        final name = request.url.pathSegments.last;
        attempts[name] = (attempts[name] ?? 0) + 1;
        if (name == 'network') {
          throw const SocketException('synthetic connection reset');
        }
        final status = name == 'unauthorized'
            ? HttpStatus.unauthorized
            : HttpStatus.tooManyRequests;
        return http.Response(
          '{"message":"synthetic failure"}',
          status,
          headers: {HttpHeaders.contentTypeHeader: ContentType.json.mimeType},
        );
      });
      final httpClient = core_http.HttpClient(
        baseUrl: 'https://api.example.test',
        tokenManager: _NoopCoreTokenManager(),
        contextManager: ContextManager(),
        client: transport,
      );
      final functions = FunctionsClient(httpClient);

      for (final name in ['network', 'unauthorized', 'rate-limited']) {
        await expectLater(
          functions.call(
            name,
            options: const FunctionCallOptions(
              method: 'POST',
              captchaToken: 'single-use-token',
            ),
          ),
          throwsA(anything),
        );
      }

      expect(attempts, {
        'network': 1,
        'unauthorized': 1,
        'rate-limited': 1,
      });
      httpClient.close();
    });
  });

  // ─── F. DatabaseLiveClient revokedChannels 구조 ──────────────

  group('DatabaseLive FilterTuple', () {
    test('filter tuple is List<dynamic> with 3 elements', () {
      // FilterTuple = List<dynamic> — [field, operator, value]
      final List<dynamic> tuple = ['title', '==', 'test'];
      expect(tuple, isA<List<dynamic>>());
      expect(tuple.length, equals(3));
    });

    test('filter tuple nullable value', () {
      final List<dynamic> tuple = ['field', '!=', null];
      expect(tuple[0], equals('field'));
      expect(tuple[1], equals('!='));
      expect(tuple[2], isNull);
    });

    test('list of filter tuples', () {
      final List<List<dynamic>> filters = [
        ['title', '==', 'hello'],
        ['status', '!=', 'deleted'],
      ];
      expect(filters.length, equals(2));
      expect(filters[0][0], equals('title'));
      expect(filters[1][2], equals('deleted'));
    });
  });

  // ─── G. ClientEdgeBase public surface ─────────────────────────────────────

  group('ClientEdgeBase surface', () {
    test('functions and analytics getters exist', () {
      final client = ClientEdgeBase('http://localhost:8688');
      expect(client.functions, isNotNull);
      expect(client.analytics, isNotNull);
      client.destroy();
    });

    test('auth exposes passkeys methods', () {
      final client = ClientEdgeBase('http://localhost:8688');
      final registerOptions = client.auth.passkeysRegisterOptions;
      final register = client.auth.passkeysRegister;
      final authOptions = client.auth.passkeysAuthOptions;
      final authenticate = client.auth.passkeysAuthenticate;
      final list = client.auth.passkeysList;
      final delete = client.auth.passkeysDelete;

      expect(registerOptions, isNotNull);
      expect(register, isNotNull);
      expect(authOptions, isNotNull);
      expect(authenticate, isNotNull);
      expect(list, isNotNull);
      expect(delete, isNotNull);
      client.destroy();
    });
  });

  group('Token pair restart recovery', () {
    test('new manager restores the initiating access and refresh pair',
        () async {
      final storage = MemoryTokenStorage();
      final exp = DateTime.now().millisecondsSinceEpoch ~/ 1000 + 3600;
      final payload = base64Url
          .encode(utf8.encode(jsonEncode({
            'sub': 'anonymous-user',
            'isAnonymous': true,
            'exp': exp,
          })))
          .replaceAll('=', '');
      final access = 'eyJhbGciOiJub25lIn0.$payload.signature';
      final first =
          TokenManager(baseUrl: 'https://api.example.test', storage: storage);
      await first.setTokens(access, 'anonymous-refresh');
      first.destroy();

      var refreshCalls = 0;
      final restarted = TokenManager(
        baseUrl: 'https://api.example.test',
        storage: storage,
      );
      final restored = await restarted.tryRestoreSession((refresh) async {
        refreshCalls += 1;
        throw StateError('refresh must not replace a stored initiating pair');
      });

      expect(restored, isTrue);
      expect(refreshCalls, 0);
      expect(restarted.accessToken, access);
      expect(restarted.currentUser?.id, 'anonymous-user');
      expect(await restarted.getRefreshToken(), 'anonymous-refresh');
      restarted.destroy();
    });

    test('client restore surface adopts a stored pair without refresh',
        () async {
      final storage = MemoryTokenStorage();
      final payload = base64Url
          .encode(utf8.encode(jsonEncode({
            'sub': 'restored-user',
            'isAnonymous': false,
            'exp': DateTime.now().millisecondsSinceEpoch ~/ 1000 + 3600,
          })))
          .replaceAll('=', '');
      await storage.setTokenPair(StoredTokenPair(
        accessToken: 'eyJhbGciOiJub25lIn0.$payload.signature',
        refreshToken: 'restored-refresh',
      ));
      final client = ClientEdgeBase(
        'https://network-must-not-run.example.test',
        options: EdgeBaseClientOptions(tokenStorage: storage),
      );

      expect(await client.tryRestoreSession(), isTrue);
      expect(client.auth.currentUser?.id, 'restored-user');
      client.destroy();
    });

    test('incomplete stored pair is never exposed', () async {
      final storage = MemoryTokenStorage();
      await storage.setTokenPair(const StoredTokenPair(
        accessToken: '',
        refreshToken: 'refresh-only',
      ));
      final manager = TokenManager(
        baseUrl: 'https://api.example.test',
        storage: storage,
      );

      await expectLater(
        manager.tryRestoreSession((_) async =>
            throw StateError('refresh must not run for a stored pair')),
        throwsA(isA<InvalidTokenPairException>()),
      );
      expect(manager.accessToken, isNull);
      manager.destroy();
    });

    test('authenticated HTTP never swallows refresh persistence failure',
        () async {
      final storage = _FailingReplacementTokenStorage();
      final manager = TokenManager(
        baseUrl: 'https://api.example.test',
        storage: storage,
      );
      await manager.setTokens(
        'header.eyJzdWIiOiJhbm9ueW1vdXMiLCJleHAiOjB9.signature',
        'anonymous-refresh',
      );
      storage.failReplacementWrite = true;
      final paths = <String>[];
      final transport = MockClient((request) async {
        paths.add(request.url.path);
        if (request.url.path == '/api/auth/refresh') {
          return http.Response(
            jsonEncode({
              'accessToken': 'replacement-access',
              'refreshToken': 'permanent-refresh',
            }),
            HttpStatus.ok,
            headers: {
              HttpHeaders.contentTypeHeader: ContentType.json.mimeType,
            },
          );
        }
        return http.Response('{}', HttpStatus.ok);
      });
      final httpClient = core_http.HttpClient(
        baseUrl: 'https://api.example.test',
        tokenManager: manager,
        contextManager: ContextManager(),
        client: transport,
      );

      await expectLater(
        httpClient.get('/protected'),
        throwsA(isA<TokenPersistenceException>()),
      );

      expect(paths, ['/api/auth/refresh']);
      expect(manager.accessToken,
          'header.eyJzdWIiOiJhbm9ueW1vdXMiLCJleHAiOjB9.signature');
      expect(storage.value, 'anonymous-refresh');
      httpClient.close();
      manager.destroy();
    });
  });

  group('websocket auth refresh recovery', () {
    late HttpServer server;
    late String baseUrl;
    late MemoryTokenStorage storage;
    const refreshToken = 'stored-refresh-token';
    const accessToken = 'refreshed-access-token';

    setUp(() async {
      storage = MemoryTokenStorage();
      await storage.setRefreshToken(refreshToken);

      server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      baseUrl = 'http://${server.address.host}:${server.port}';
    });

    tearDown(() async {
      await server.close(force: true);
    });

    test('database-live connect refreshes a missing access token', () async {
      final refreshRequest = Completer<void>();
      final authMessage = Completer<Map<String, dynamic>>();
      WebSocket? socket;

      server.listen((request) async {
        if (request.uri.path == '/api/auth/refresh') {
          final payload = jsonDecode(await utf8.decoder.bind(request).join())
              as Map<String, dynamic>;
          expect(payload['refreshToken'], equals(refreshToken));
          request.response
            ..statusCode = HttpStatus.ok
            ..headers.contentType = ContentType.json
            ..write(
              jsonEncode({
                'accessToken': accessToken,
                'refreshToken': refreshToken,
              }),
            );
          await request.response.close();
          if (!refreshRequest.isCompleted) {
            refreshRequest.complete();
          }
          return;
        }

        if (request.uri.path == '/api/db/subscribe') {
          expect(
            request.uri.queryParameters['channel'],
            equals('dblive:shared:posts'),
          );
          socket = await WebSocketTransformer.upgrade(request);
          socket!.listen((message) {
            final decoded =
                jsonDecode(message as String) as Map<String, dynamic>;
            if (!authMessage.isCompleted) {
              authMessage.complete(decoded);
            }
            socket!.add(jsonEncode({'type': 'auth_success'}));
          });
          return;
        }

        request.response.statusCode = HttpStatus.notFound;
        await request.response.close();
      });

      final tokenManager = TokenManager(baseUrl: baseUrl, storage: storage);
      final databaseLive = DatabaseLiveClient(
        baseUrl,
        tokenManager,
        ContextManager(),
      );
      databaseLive.subscribe('posts');

      await refreshRequest.future.timeout(const Duration(seconds: 5));
      final auth = await authMessage.future.timeout(const Duration(seconds: 5));
      expect(auth['type'], equals('auth'));
      expect(auth['token'], equals(accessToken));

      databaseLive.disconnect();
      if (socket != null) {
        await socket!.close();
      }
    });

    test('client destroy disconnects active database-live sockets', () async {
      final authFrameSeen = Completer<void>();
      final socketClosed = Completer<void>();

      String buildJwt(String userId) {
        final exp = DateTime.now().millisecondsSinceEpoch ~/ 1000 + 3600;
        final payload = base64Url
            .encode(utf8.encode(jsonEncode({'sub': userId, 'exp': exp})))
            .replaceAll('=', '');
        return 'eyJhbGciOiJub25lIn0.$payload.sig';
      }

      server.listen((request) async {
        if (request.uri.path == '/api/auth/signup') {
          request.response
            ..statusCode = HttpStatus.ok
            ..headers.contentType = ContentType.json
            ..write(
              jsonEncode({
                'accessToken': buildJwt('user-destroy'),
                'refreshToken': 'refresh-destroy',
                'user': {'id': 'user-destroy', 'email': 'destroy@test.com'},
              }),
            );
          await request.response.close();
          return;
        }

        if (request.uri.path == '/api/db/subscribe') {
          final ws = await WebSocketTransformer.upgrade(request);
          ws.listen(
            (message) {
              final decoded =
                  jsonDecode(message as String) as Map<String, dynamic>;
              if (decoded['type'] == 'auth' && !authFrameSeen.isCompleted) {
                authFrameSeen.complete();
                ws.add(jsonEncode({'type': 'auth_success'}));
              }
            },
            onDone: () {
              if (!socketClosed.isCompleted) {
                socketClosed.complete();
              }
            },
          );
          return;
        }

        request.response.statusCode = HttpStatus.notFound;
        await request.response.close();
      });

      final client = ClientEdgeBase(
        baseUrl,
        options: EdgeBaseClientOptions(tokenStorage: MemoryTokenStorage()),
      );
      await client.auth.signUp(
        SignUpOptions(email: 'destroy@test.com', password: 'Destroy123!'),
      );
      final sub =
          client.db('shared').table('posts').onSnapshot().listen((_) {});

      await authFrameSeen.future.timeout(const Duration(seconds: 5));
      client.destroy();
      await socketClosed.future.timeout(const Duration(seconds: 5));
      await sub.cancel();
    });

    test('room join refreshes a missing access token', () async {
      final refreshRequest = Completer<void>();
      final authMessage = Completer<Map<String, dynamic>>();

      server.listen((request) async {
        if (request.uri.path == '/api/auth/refresh') {
          final payload = jsonDecode(await utf8.decoder.bind(request).join())
              as Map<String, dynamic>;
          expect(payload['refreshToken'], equals(refreshToken));
          request.response
            ..statusCode = HttpStatus.ok
            ..headers.contentType = ContentType.json
            ..write(
              jsonEncode({
                'accessToken': accessToken,
                'refreshToken': refreshToken,
              }),
            );
          await request.response.close();
          if (!refreshRequest.isCompleted) {
            refreshRequest.complete();
          }
          return;
        }

        if (request.uri.path == '/api/room') {
          final ws = await WebSocketTransformer.upgrade(request);
          ws.listen((message) {
            final decoded =
                jsonDecode(message as String) as Map<String, dynamic>;
            if (decoded['type'] == 'auth') {
              if (!authMessage.isCompleted) {
                authMessage.complete(decoded);
              }
              ws.add(jsonEncode({'type': 'auth_success'}));
              return;
            }

            if (decoded['type'] == 'join') {
              ws.add(
                jsonEncode({
                  'type': 'sync',
                  'sharedState': <String, dynamic>{},
                  'sharedVersion': 0,
                  'playerState': <String, dynamic>{},
                  'playerVersion': 0,
                }),
              );
            }
          });
          return;
        }

        request.response.statusCode = HttpStatus.notFound;
        await request.response.close();
      });

      final tokenManager = TokenManager(baseUrl: baseUrl, storage: storage);
      final room = RoomClient(baseUrl, 'game', 'room-1', tokenManager);

      final joinFuture = room.join();
      unawaited(joinFuture.catchError((_) {}));
      await refreshRequest.future.timeout(
        const Duration(seconds: 5),
        onTimeout: () => throw Exception('Room refresh request was not sent.'),
      );
      final auth = await authMessage.future.timeout(
        const Duration(seconds: 5),
        onTimeout: () => throw Exception('Room auth frame was not sent.'),
      );
      expect(auth['type'], equals('auth'));
      expect(auth['token'], equals(accessToken));

      room.leave();
    });

    test('room leave sends an explicit leave frame before close', () async {
      final events = <String>[];
      final socketClosed = Completer<void>();

      server.listen((request) async {
        if (request.uri.path == '/api/room') {
          final ws = await WebSocketTransformer.upgrade(request);
          ws.listen(
            (message) {
              final decoded =
                  jsonDecode(message as String) as Map<String, dynamic>;
              events.add('send:${decoded['type']}');

              if (decoded['type'] == 'auth') {
                ws.add(jsonEncode({'type': 'auth_success'}));
                return;
              }

              if (decoded['type'] == 'join') {
                ws.add(
                  jsonEncode({
                    'type': 'sync',
                    'sharedState': <String, dynamic>{},
                    'sharedVersion': 0,
                    'playerState': <String, dynamic>{},
                    'playerVersion': 0,
                  }),
                );
              }
            },
            onDone: () {
              events.add('close');
              if (!socketClosed.isCompleted) {
                socketClosed.complete();
              }
            },
          );
          return;
        }

        request.response.statusCode = HttpStatus.notFound;
        await request.response.close();
      });

      final tokenManager = TokenManager(
        baseUrl: baseUrl,
        storage: MemoryTokenStorage(),
      );
      final exp = DateTime.now().millisecondsSinceEpoch ~/ 1000 + 3600;
      final tokenPayload = base64Url
          .encode(utf8.encode(jsonEncode({'sub': 'user-1', 'exp': exp})))
          .replaceAll('=', '');
      final accessToken = 'eyJhbGciOiJub25lIn0.$tokenPayload.sig';
      await tokenManager.setTokens(accessToken, 'refresh-token');

      final room = RoomClient(baseUrl, 'game', 'room-1', tokenManager);
      await room.join();
      room.leave();

      await socketClosed.future.timeout(
        const Duration(seconds: 5),
        onTimeout: () => throw Exception('Room socket did not close.'),
      );

      expect(
        events.sublist(events.length - 2),
        equals(['send:leave', 'close']),
      );
    });
  });

  group('room unified surface', () {
    late HttpServer server;
    late String baseUrl;
    late TokenManager tokenManager;

    Future<void> setValidTokens() async {
      final exp = DateTime.now().millisecondsSinceEpoch ~/ 1000 + 3600;
      final tokenPayload = base64Url
          .encode(utf8.encode(jsonEncode({'sub': 'user-1', 'exp': exp})))
          .replaceAll('=', '');
      final accessToken = 'eyJhbGciOiJub25lIn0.$tokenPayload.sig';
      await tokenManager.setTokens(accessToken, 'refresh-token');
    }

    setUp(() async {
      server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      baseUrl = 'http://${server.address.host}:${server.port}';
      tokenManager = TokenManager(
        baseUrl: baseUrl,
        storage: MemoryTokenStorage(),
      );
      await setValidTokens();
    });

    tearDown(() async {
      await server.close(force: true);
    });

    test('parses signals, members, and session namespaces', () async {
      final memberSync = Completer<List<Map<String, dynamic>>>();
      final signalEvent = Completer<Map<String, dynamic>>();
      final connectionStates = <String>[];

      server.listen((request) async {
        if (request.uri.path != '/api/room') {
          request.response.statusCode = HttpStatus.notFound;
          await request.response.close();
          return;
        }

        final ws = await WebSocketTransformer.upgrade(request);
        ws.listen((message) async {
          final decoded = jsonDecode(message as String) as Map<String, dynamic>;

          if (decoded['type'] == 'auth') {
            ws.add(
              jsonEncode({
                'type': 'auth_success',
                'userId': 'user-1',
                'connectionId': 'conn-1',
              }),
            );
            return;
          }

          if (decoded['type'] == 'join') {
            ws.add(
              jsonEncode({
                'type': 'sync',
                'sharedState': {'phase': 'lobby'},
                'sharedVersion': 1,
                'playerState': {'ready': true},
                'playerVersion': 1,
              }),
            );
            ws.add(
              jsonEncode({
                'type': 'members_sync',
                'members': [
                  {
                    'memberId': 'user-1',
                    'userId': 'user-1',
                    'connectionId': 'conn-1',
                    'connectionCount': 1,
                    'state': {'cursor': 'x:1'},
                  },
                ],
              }),
            );
            ws.add(
              jsonEncode({
                'type': 'signal',
                'event': 'wave',
                'payload': {'from': 'server'},
                'meta': {'serverSent': true, 'sentAt': 123},
              }),
            );
          }
        });
      });

      final room = RoomClient(baseUrl, 'game', 'room-1', tokenManager);
      room.session.onConnectionStateChange(connectionStates.add);
      room.members.onSync((members) {
        if (!memberSync.isCompleted) {
          memberSync.complete(members);
        }
      });
      room.signals.on('wave', (payload, meta) {
        if (!signalEvent.isCompleted) {
          signalEvent.complete({'payload': payload, 'meta': meta});
        }
      });
      await room.join();

      expect(await memberSync.future.timeout(const Duration(seconds: 5)), [
        {
          'memberId': 'user-1',
          'userId': 'user-1',
          'connectionId': 'conn-1',
          'connectionCount': 1,
          'state': {'cursor': 'x:1'},
        },
      ]);
      final signal = await signalEvent.future.timeout(
        const Duration(seconds: 5),
      );
      expect(signal['payload'], {'from': 'server'});
      expect((signal['meta'] as Map<String, dynamic>)['serverSent'], isTrue);
      expect(room.state.getShared()['phase'], 'lobby');
      expect(room.state.getMine()['ready'], isTrue);
      expect(room.members.list().single['memberId'], 'user-1');
      expect(room.session.connectionState, 'connected');
      expect(connectionStates, containsAllInOrder(['connecting', 'connected']));

      room.leave();
    });

    test(
      'sends unified request frames for signals, members, and admin',
      () async {
        final frames = <Map<String, dynamic>>[];

        server.listen((request) async {
          if (request.uri.path != '/api/room') {
            request.response.statusCode = HttpStatus.notFound;
            await request.response.close();
            return;
          }

          final ws = await WebSocketTransformer.upgrade(request);
          ws.listen((message) {
            final decoded =
                jsonDecode(message as String) as Map<String, dynamic>;

            if (decoded['type'] == 'auth') {
              ws.add(
                jsonEncode({
                  'type': 'auth_success',
                  'userId': 'user-1',
                  'connectionId': 'conn-1',
                }),
              );
              return;
            }

            if (decoded['type'] == 'join') {
              ws.add(
                jsonEncode({
                  'type': 'sync',
                  'sharedState': <String, dynamic>{},
                  'sharedVersion': 0,
                  'playerState': <String, dynamic>{},
                  'playerVersion': 0,
                }),
              );
              ws.add(
                jsonEncode({
                  'type': 'members_sync',
                  'members': [
                    {
                      'memberId': 'user-1',
                      'userId': 'user-1',
                      'connectionId': 'conn-1',
                      'connectionCount': 1,
                      'state': <String, dynamic>{},
                    },
                    {
                      'memberId': 'user-2',
                      'userId': 'user-2',
                      'connectionId': 'conn-2',
                      'connectionCount': 1,
                      'state': <String, dynamic>{},
                    },
                  ],
                }),
              );
              return;
            }

            frames.add(decoded);
            switch (decoded['type']) {
              case 'signal':
                ws.add(
                  jsonEncode({
                    'type': 'signal_sent',
                    'event': decoded['event'],
                    'requestId': decoded['requestId'],
                  }),
                );
                break;
              case 'member_state':
                ws.add(
                  jsonEncode({
                    'type': 'member_state',
                    'member': {
                      'memberId': 'user-1',
                      'userId': 'user-1',
                      'connectionId': 'conn-1',
                      'connectionCount': 1,
                      'state': decoded['state'],
                    },
                    'state': decoded['state'],
                    'requestId': decoded['requestId'],
                  }),
                );
                break;
              case 'admin':
                ws.add(
                  jsonEncode({
                    'type': 'admin_result',
                    'operation': decoded['operation'],
                    'memberId': decoded['memberId'],
                    'requestId': decoded['requestId'],
                    'result': {'ok': true},
                  }),
                );
                break;
            }
          });
        });

        final room = RoomClient(baseUrl, 'game', 'room-1', tokenManager);
        await room.join();

        await room.signals.send('wave', {'value': 1}, {'includeSelf': true});
        await room.members.setState({'typing': true});
        await room.admin.setRole('user-2', 'moderator');
        expect(frames.map((entry) => entry['type']), [
          'signal',
          'member_state',
          'admin',
        ]);
        expect(frames[0]['event'], 'wave');
        expect(frames[0]['includeSelf'], isTrue);
        expect(frames[1]['state'], {'typing': true});
        expect(frames[2]['operation'], 'setRole');
        expect(
          (frames[2]['payload'] as Map<String, dynamic>)['role'],
          'moderator',
        );

        room.leave();
      },
    );
  });
}

final class _NoopCoreTokenManager implements core_tokens.TokenManager {
  @override
  Future<void> clearTokens() async {}

  @override
  Future<String?> getAccessToken(
          [core_tokens.RefreshCallback? refreshCallback]) async =>
      null;

  @override
  Future<String?> getRefreshToken() async => null;

  @override
  Future<void> setTokens(String access, String refresh) async {}
}
