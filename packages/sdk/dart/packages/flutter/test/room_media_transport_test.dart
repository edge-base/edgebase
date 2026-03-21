import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:edgebase_flutter/edgebase_flutter.dart';
import 'package:test/test.dart';

void main() {
  group('RoomMediaTransport', () {
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

    test('connects through the provider endpoint and joins the runtime client',
        () async {
      final requests = <Map<String, dynamic>>[];

      server.listen((request) async {
        if (request.uri.path == '/api/room') {
          final ws = await WebSocketTransformer.upgrade(request);
          ws.listen((message) {
            final decoded =
                jsonDecode(message as String) as Map<String, dynamic>;
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
                ],
              }));
              return;
            }
          });
          return;
        }

        if (request.uri.path ==
            '/api/room/media/cloudflare_realtimekit/session') {
          requests.add({
            'method': request.method,
            'auth': request.headers.value('authorization'),
            'query': request.uri.queryParameters,
            'body': jsonDecode(await utf8.decoder.bind(request).join())
                as Map<String, dynamic>,
          });
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
      await room.join();

      final fakeClient = _FakeCloudflareClientAdapter(
        joinedParticipants: [
          _participant(
            id: 'remote-1',
            userId: 'user-2',
            name: 'Remote User',
            videoEnabled: true,
          ),
        ],
      );

      final transport = room.media.transport(
        RoomMediaTransportOptions(
          cloudflareRealtimeKit: RoomCloudflareRealtimeKitTransportOptions(
            clientFactory: ({
              required authToken,
              displayName,
              enableAudio = false,
              enableVideo = false,
              baseDomain = 'dyte.io',
            }) async {
              expect(authToken, 'auth-token-1');
              expect(displayName, 'Flutter User');
              expect(enableAudio, isFalse);
              expect(enableVideo, isFalse);
              expect(baseDomain, 'dyte.io');
              return fakeClient;
            },
          ),
        ),
      );

      final remoteEvents = <RoomMediaRemoteTrackEvent>[];
      transport.onRemoteTrack(remoteEvents.add);

      final sessionId = await transport.connect({
        'name': 'Flutter User',
        'customParticipantId': 'flutter-user-1',
      });

      expect(sessionId, 'session-1');
      expect(fakeClient.joinCalled, isTrue);
      expect(requests, hasLength(1));
      expect(requests.single['method'], 'POST');
      expect(requests.single['query'], {
        'namespace': 'game',
        'id': 'room-1',
      });
      expect((requests.single['body'] as Map<String, dynamic>)['name'],
          'Flutter User');
      expect(
          (requests.single['body']
              as Map<String, dynamic>)['customParticipantId'],
          'flutter-user-1');
      expect(remoteEvents, hasLength(1));
      expect(remoteEvents.single.kind, 'video');
      expect(remoteEvents.single.participantId, 'remote-1');
      expect(remoteEvents.single.view, 'view:remote-1:video');

      room.leave();
      transport.destroy();
    });

    test('forwards local media operations and emits remote audio updates',
        () async {
      final frames = <Map<String, dynamic>>[];

      server.listen((request) async {
        if (request.uri.path == '/api/room') {
          final ws = await WebSocketTransformer.upgrade(request);
          ws.listen((message) {
            final decoded =
                jsonDecode(message as String) as Map<String, dynamic>;

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
                ],
              }));
              return;
            }

            frames.add(decoded);
            if (decoded['type'] == 'media') {
              ws.add(jsonEncode({
                'type': 'media_result',
                'operation': decoded['operation'],
                'kind': decoded['kind'],
                'requestId': decoded['requestId'],
                'result': {'ok': true},
              }));
            }
          });
          return;
        }

        if (request.uri.path ==
            '/api/room/media/cloudflare_realtimekit/session') {
          request.response.headers.contentType = ContentType.json;
          request.response.write(jsonEncode({
            'sessionId': 'session-2',
            'meetingId': 'meeting-2',
            'participantId': 'participant-2',
            'authToken': 'auth-token-2',
            'presetName': 'default',
          }));
          await request.response.close();
          return;
        }

        request.response.statusCode = HttpStatus.notFound;
        await request.response.close();
      });

      final room = RoomClient(baseUrl, 'game', 'room-1', tokenManager);
      await room.join();

      final fakeClient = _FakeCloudflareClientAdapter();
      final transport = room.media.transport(
        RoomMediaTransportOptions(
          cloudflareRealtimeKit: RoomCloudflareRealtimeKitTransportOptions(
            clientFactory: ({
              required authToken,
              displayName,
              enableAudio = false,
              enableVideo = false,
              baseDomain = 'dyte.io',
            }) async =>
                fakeClient,
          ),
        ),
      );

      final remoteEvents = <RoomMediaRemoteTrackEvent>[];
      transport.onRemoteTrack(remoteEvents.add);

      await transport.connect({'name': 'Flutter User'});
      expect(await transport.enableAudio({'deviceId': 'mic-1'}), 'self-handle');
      expect(await transport.enableVideo({'deviceId': 'cam-1'}),
          'view:self:video');
      await transport.switchDevices({
        'audioInputId': 'mic-2',
        'videoInputId': 'cam-2',
      });

      fakeClient.emitAudio(
        _participant(
          id: 'remote-audio',
          userId: 'user-2',
          name: 'Remote Voice',
          audioEnabled: true,
        ),
        true,
      );

      expect(fakeClient.enableAudioCalls, 1);
      expect(fakeClient.enableVideoCalls, 1);
      expect(fakeClient.selectedAudioDeviceId, 'mic-2');
      expect(fakeClient.selectedVideoDeviceId, 'cam-2');
      expect(
        frames
            .where((frame) => frame['type'] == 'media')
            .map((frame) => '${frame['operation']}:${frame['kind']}')
            .toList(),
        containsAll([
          'publish:audio',
          'publish:video',
          'device:audio',
          'device:video',
        ]),
      );
      final audioPublish = frames.firstWhere(
        (frame) => frame['type'] == 'media' && frame['kind'] == 'audio',
      );
      expect(
          (audioPublish['payload']
              as Map<String, dynamic>)['providerSessionId'],
          'participant-2');
      expect(remoteEvents, hasLength(1));
      expect(remoteEvents.single.kind, 'audio');
      expect(remoteEvents.single.participantId, 'remote-audio');
      expect(remoteEvents.single.view, isNull);

      room.leave();
      transport.destroy();
    });
  });
}

class _FakeCloudflareClientAdapter
    implements RoomCloudflareRealtimeKitClientAdapter {
  @override
  RoomCloudflareParticipantSnapshot localParticipant;

  @override
  List<RoomCloudflareParticipantSnapshot> joinedParticipants;

  final List<RoomCloudflareParticipantListener> _listeners =
      <RoomCloudflareParticipantListener>[];

  bool joinCalled = false;
  bool leaveCalled = false;
  int enableAudioCalls = 0;
  int enableVideoCalls = 0;
  int enableScreenShareCalls = 0;
  int disableAudioCalls = 0;
  int disableVideoCalls = 0;
  int disableScreenShareCalls = 0;
  String? selectedAudioDeviceId;
  String? selectedVideoDeviceId;

  _FakeCloudflareClientAdapter({
    RoomCloudflareParticipantSnapshot? localParticipant,
    List<RoomCloudflareParticipantSnapshot>? joinedParticipants,
  })  : localParticipant = localParticipant ??
            _participant(
              id: 'self-participant',
              userId: 'user-1',
              name: 'Self User',
              handle: 'self-handle',
            ),
        joinedParticipants =
            joinedParticipants ?? <RoomCloudflareParticipantSnapshot>[];

  @override
  Future<void> joinRoom() async {
    joinCalled = true;
  }

  @override
  Future<void> leaveRoom() async {
    leaveCalled = true;
  }

  @override
  Future<void> enableAudio() async {
    enableAudioCalls += 1;
  }

  @override
  Future<void> disableAudio() async {
    disableAudioCalls += 1;
  }

  @override
  Future<void> enableVideo() async {
    enableVideoCalls += 1;
  }

  @override
  Future<void> disableVideo() async {
    disableVideoCalls += 1;
  }

  @override
  Future<void> enableScreenShare() async {
    enableScreenShareCalls += 1;
  }

  @override
  Future<void> disableScreenShare() async {
    disableScreenShareCalls += 1;
  }

  @override
  Future<void> setAudioDevice(String deviceId) async {
    selectedAudioDeviceId = deviceId;
  }

  @override
  Future<void> setVideoDevice(String deviceId) async {
    selectedVideoDeviceId = deviceId;
  }

  @override
  Object? buildView(
    RoomCloudflareParticipantSnapshot participant,
    String kind, {
    bool isSelf = false,
  }) {
    if (kind == 'audio') {
      return null;
    }
    return isSelf ? 'view:self:$kind' : 'view:${participant.id}:$kind';
  }

  @override
  void addListener(RoomCloudflareParticipantListener listener) {
    _listeners.add(listener);
  }

  @override
  void removeListener(RoomCloudflareParticipantListener listener) {
    _listeners.remove(listener);
  }

  void emitAudio(RoomCloudflareParticipantSnapshot participant, bool enabled) {
    for (final listener in List.of(_listeners)) {
      listener.onAudioUpdate(participant, enabled);
    }
  }
}

RoomCloudflareParticipantSnapshot _participant({
  required String id,
  required String userId,
  required String name,
  String? customParticipantId,
  bool audioEnabled = false,
  bool videoEnabled = false,
  bool screenShareEnabled = false,
  Object? handle,
}) {
  return RoomCloudflareParticipantSnapshot(
    id: id,
    userId: userId,
    name: name,
    customParticipantId: customParticipantId,
    audioEnabled: audioEnabled,
    videoEnabled: videoEnabled,
    screenShareEnabled: screenShareEnabled,
    participantHandle: handle ?? 'participant:$id',
  );
}
