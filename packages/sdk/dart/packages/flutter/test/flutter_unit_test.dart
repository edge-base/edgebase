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
import 'package:edgebase_core/src/context_manager.dart';
import 'package:edgebase_flutter/src/auth_client.dart';
import 'package:edgebase_flutter/src/database_live_client.dart';

void main() {
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
          email: 'a@b.com', password: 'pass', captchaToken: 'ct-123');
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
      final s =
          Session.fromJson({'id': 's-1', 'createdAt': '2024-01-01T00:00:00Z'});
      expect(s.id, equals('s-1'));
      expect(s.createdAt, equals('2024-01-01T00:00:00Z'));
    });

    test('nullable userAgent', () {
      final s = Session.fromJson(
          {'id': 's-1', 'createdAt': '2024-01-01', 'userAgent': 'Mozilla'});
      expect(s.userAgent, equals('Mozilla'));
    });

    test('userAgent null when missing', () {
      final s = Session.fromJson({'id': 's-1', 'createdAt': '2024-01-01'});
      expect(s.userAgent, isNull);
    });

    test('ip field', () {
      final s = Session.fromJson(
          {'id': 's-1', 'createdAt': '2024-01-01', 'ip': '1.2.3.4'});
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
      final opts =
          UpdateProfileOptions(avatarUrl: 'https://cdn.test/avatar.png');
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
  });

  // ─── F. DatabaseLiveClient revokedChannels 구조 ──────────────

  group('DatabaseLive FilterTuple', () {
    test('filter tuple is List<dynamic> with 3 elements', () {
      // FilterTuple = List<dynamic> — [field, operator, value]
      final List<dynamic> tuple = ['title', '==', 'test'];
      expect(tuple, isA<List>());
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
            ..write(jsonEncode({
              'accessToken': accessToken,
              'refreshToken': refreshToken,
            }));
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
          socket!.listen(
            (message) {
              final decoded =
                  jsonDecode(message as String) as Map<String, dynamic>;
              if (!authMessage.isCompleted) {
                authMessage.complete(decoded);
              }
              socket!.add(jsonEncode({'type': 'auth_success'}));
            },
          );
          return;
        }

        request.response.statusCode = HttpStatus.notFound;
        await request.response.close();
      });

      final tokenManager = TokenManager(baseUrl: baseUrl, storage: storage);
      final databaseLive = DatabaseLiveClient(baseUrl, tokenManager, ContextManager());
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
            ..write(jsonEncode({
              'accessToken': buildJwt('user-destroy'),
              'refreshToken': 'refresh-destroy',
              'user': {'id': 'user-destroy', 'email': 'destroy@test.com'},
            }));
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
            ..write(jsonEncode({
              'accessToken': accessToken,
              'refreshToken': refreshToken,
            }));
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
              ws.add(jsonEncode({
                'type': 'sync',
                'sharedState': <String, dynamic>{},
                'sharedVersion': 0,
                'playerState': <String, dynamic>{},
                'playerVersion': 0,
              }));
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
                ws.add(jsonEncode({
                  'type': 'sync',
                  'sharedState': <String, dynamic>{},
                  'sharedVersion': 0,
                  'playerState': <String, dynamic>{},
                  'playerVersion': 0,
                }));
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

      final tokenManager =
          TokenManager(baseUrl: baseUrl, storage: MemoryTokenStorage());
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
      tokenManager =
          TokenManager(baseUrl: baseUrl, storage: MemoryTokenStorage());
      await setValidTokens();
    });

    tearDown(() async {
      await server.close(force: true);
    });

    test('parses signals, members, media, and session namespaces', () async {
      final memberSync = Completer<List<Map<String, dynamic>>>();
      final signalEvent = Completer<Map<String, dynamic>>();
      final mediaTrack = Completer<Map<String, dynamic>>();
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
            ws.add(jsonEncode({
              'type': 'auth_success',
              'userId': 'user-1',
              'connectionId': 'conn-1',
            }));
            return;
          }

          if (decoded['type'] == 'join') {
            ws.add(jsonEncode({
              'type': 'sync',
              'sharedState': {'phase': 'lobby'},
              'sharedVersion': 1,
              'playerState': {'ready': true},
              'playerVersion': 1,
            }));
            ws.add(jsonEncode({
              'type': 'members_sync',
              'members': [
                {
                  'memberId': 'user-1',
                  'userId': 'user-1',
                  'connectionId': 'conn-1',
                  'connectionCount': 1,
                  'state': {'cursor': 'x:1'},
                }
              ],
            }));
            ws.add(jsonEncode({
              'type': 'media_sync',
              'members': [
                {
                  'member': {
                    'memberId': 'user-1',
                    'userId': 'user-1',
                    'connectionId': 'conn-1',
                    'connectionCount': 1,
                    'state': {'cursor': 'x:1'},
                  },
                  'state': {
                    'audio': {
                      'published': true,
                      'muted': false,
                      'trackId': 'audio-1',
                    }
                  },
                  'tracks': [
                    {
                      'kind': 'audio',
                      'trackId': 'audio-1',
                      'muted': false,
                    }
                  ],
                }
              ],
            }));
            ws.add(jsonEncode({
              'type': 'signal',
              'event': 'wave',
              'payload': {'from': 'server'},
              'meta': {
                'serverSent': true,
                'sentAt': 123,
              },
            }));
            ws.add(jsonEncode({
              'type': 'media_track',
              'member': {
                'memberId': 'user-1',
                'userId': 'user-1',
                'connectionId': 'conn-1',
                'connectionCount': 1,
                'state': {'cursor': 'x:1'},
              },
              'track': {
                'kind': 'video',
                'trackId': 'video-1',
                'muted': true,
              },
            }));
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
          signalEvent.complete({
            'payload': payload,
            'meta': meta,
          });
        }
      });
      room.media.onTrack((track, member) {
        if (!mediaTrack.isCompleted) {
          mediaTrack.complete({
            'track': track,
            'member': member,
          });
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
        }
      ]);
      final signal =
          await signalEvent.future.timeout(const Duration(seconds: 5));
      expect(signal['payload'], {'from': 'server'});
      expect((signal['meta'] as Map<String, dynamic>)['serverSent'], isTrue);
      final track = await mediaTrack.future.timeout(const Duration(seconds: 5));
      expect((track['track'] as Map<String, dynamic>)['trackId'], 'video-1');
      expect(room.state.getShared()['phase'], 'lobby');
      expect(room.state.getMine()['ready'], isTrue);
      expect(room.members.list().single['memberId'], 'user-1');
      expect(room.media.list().single['tracks'], isNotEmpty);
      expect(room.session.connectionState, 'connected');
      expect(connectionStates, containsAllInOrder(['connecting', 'connected']));

      room.leave();
    });

    test('sends unified request frames for signals, members, admin, and media',
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
          final decoded = jsonDecode(message as String) as Map<String, dynamic>;

          if (decoded['type'] == 'auth') {
            ws.add(jsonEncode({
              'type': 'auth_success',
              'userId': 'user-1',
              'connectionId': 'conn-1',
            }));
            return;
          }

          if (decoded['type'] == 'join') {
            ws.add(jsonEncode({
              'type': 'sync',
              'sharedState': <String, dynamic>{},
              'sharedVersion': 0,
              'playerState': <String, dynamic>{},
              'playerVersion': 0,
            }));
            ws.add(jsonEncode({
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
            }));
            return;
          }

          frames.add(decoded);
          switch (decoded['type']) {
            case 'signal':
              ws.add(jsonEncode({
                'type': 'signal_sent',
                'event': decoded['event'],
                'requestId': decoded['requestId'],
              }));
              break;
            case 'member_state':
              ws.add(jsonEncode({
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
              }));
              break;
            case 'admin':
              ws.add(jsonEncode({
                'type': 'admin_result',
                'operation': decoded['operation'],
                'memberId': decoded['memberId'],
                'requestId': decoded['requestId'],
                'result': {'ok': true},
              }));
              break;
            case 'media':
              ws.add(jsonEncode({
                'type': 'media_result',
                'operation': decoded['operation'],
                'kind': decoded['kind'],
                'requestId': decoded['requestId'],
                'result': {'ok': true},
              }));
              break;
          }
        });
      });

      final room = RoomClient(baseUrl, 'game', 'room-1', tokenManager);
      await room.join();

      await room.signals.send('wave', {'value': 1}, {'includeSelf': true});
      await room.members.setState({'typing': true});
      await room.admin.setRole('user-2', 'moderator');
      await room.media.audio.enable({'deviceId': 'mic-1'});

      expect(frames.map((entry) => entry['type']), [
        'signal',
        'member_state',
        'admin',
        'media',
      ]);
      expect(frames[0]['event'], 'wave');
      expect(frames[0]['includeSelf'], isTrue);
      expect(frames[1]['state'], {'typing': true});
      expect(frames[2]['operation'], 'setRole');
      expect(
          (frames[2]['payload'] as Map<String, dynamic>)['role'], 'moderator');
      expect(frames[3]['operation'], 'publish');
      expect(frames[3]['kind'], 'audio');

      room.leave();
    });

    test('creates a cloudflare realtimekit session through the provider endpoint',
        () async {
      server.listen((request) async {
        if (request.uri.path == '/api/room/media/cloudflare_realtimekit/session') {
          expect(request.method, 'POST');
          expect(
            request.headers.value('authorization'),
            startsWith('Bearer '),
          );
          expect(request.uri.queryParameters['namespace'], 'game');
          expect(request.uri.queryParameters['id'], 'room-1');

          final body = await utf8.decoder.bind(request).join();
          final decoded = jsonDecode(body) as Map<String, dynamic>;
          expect(decoded['name'], 'Flutter User');
          expect(decoded['customParticipantId'], 'flutter-user-1');

          request.response.headers.contentType = ContentType.json;
          request.response.write(jsonEncode({
            'sessionId': 'session-1',
            'meetingId': 'meeting-1',
            'participantId': 'participant-1',
            'authToken': 'auth-token-1',
            'presetName': 'default',
          }));
          await request.response.close();
          return;
        }

        request.response.statusCode = HttpStatus.notFound;
        await request.response.close();
      });

      final room = RoomClient(baseUrl, 'game', 'room-1', tokenManager);
      final session = await room.media.cloudflareRealtimeKit.createSession({
        'name': 'Flutter User',
        'customParticipantId': 'flutter-user-1',
      });

      expect(session['sessionId'], 'session-1');
      expect(session['meetingId'], 'meeting-1');
      expect(session['participantId'], 'participant-1');
      expect(session['authToken'], 'auth-token-1');
      expect(session['presetName'], 'default');
    });
  });
}
