import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:edgebase_flutter/edgebase_flutter.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
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

    test('p2p connects, publishes local media, and emits remote video tracks',
        () async {
      final frames = <Map<String, dynamic>>[];
      final sockets = <WebSocket>[];

      server.listen((request) async {
        if (request.uri.path == '/api/room') {
          final ws = await WebSocketTransformer.upgrade(request);
          sockets.add(ws);
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
                    'memberId': 'member-local',
                    'userId': 'user-1',
                    'connectionId': 'conn-1',
                    'connectionCount': 1,
                    'state': <String, dynamic>{},
                  },
                  {
                    'memberId': 'member-remote',
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
            if (decoded['type'] == 'media') {
              ws.add(jsonEncode({
                'type': 'media_result',
                'operation': decoded['operation'],
                'kind': decoded['kind'],
                'requestId': decoded['requestId'],
                'result': {'ok': true},
              }));
              return;
            }

            if (decoded['type'] == 'signal') {
              ws.add(jsonEncode({
                'type': 'signal_sent',
                'requestId': decoded['requestId'],
              }));
            }
          });
          return;
        }

        request.response.statusCode = HttpStatus.notFound;
        await request.response.close();
      });

      final room = RoomClient(baseUrl, 'game', 'room-1', tokenManager);
      await room.join();

      final fakePeerConnection = _FakeRTCPeerConnection();
      final transport = room.media.transport(
        RoomMediaTransportOptions(
          provider: 'p2p',
          p2p: RoomP2PMediaTransportOptions(
            peerConnectionFactory: (_) async => fakePeerConnection,
            mediaDevices: _FakeP2PMediaDevicesAdapter(
              userMediaByKind: {
                'audio': _FakeMediaStream([
                  _FakeMediaStreamTrack(
                    'local-audio',
                    'audio',
                    settings: const {'deviceId': 'mic-1'},
                  ),
                ]),
                'video': _FakeMediaStream([
                  _FakeMediaStreamTrack(
                    'local-video',
                    'video',
                    settings: const {'deviceId': 'cam-1'},
                  ),
                ]),
              },
            ),
          ),
        ),
      );

      final remoteEvents = <RoomMediaRemoteTrackEvent>[];
      transport.onRemoteTrack(remoteEvents.add);

      final sessionId = await transport.connect({'name': 'Flutter User'});
      expect(sessionId, 'member-local');

      await transport.enableAudio({'deviceId': 'mic-1'});
      final localVideoView =
          await transport.enableVideo({'deviceId': 'cam-1'});

      expect(localVideoView, isA<_FakeMediaStream>());
      expect(
        frames
            .where((frame) => frame['type'] == 'media')
            .map((frame) => '${frame['operation']}:${frame['kind']}')
            .toList(),
        containsAll(['publish:audio', 'publish:video']),
      );
      expect(
        frames
            .where((frame) => frame['type'] == 'signal')
            .map((frame) => frame['event'])
            .toList(),
        contains('edgebase.media.p2p.offer'),
      );

      sockets.single.add(jsonEncode({
        'type': 'media_track',
        'member': {
          'memberId': 'member-remote',
          'userId': 'user-2',
          'connectionId': 'conn-2',
          'connectionCount': 1,
          'state': <String, dynamic>{},
        },
        'track': {
          'kind': 'video',
          'trackId': 'remote-video-track',
          'muted': false,
        },
      }));
      await Future<void>.delayed(const Duration(milliseconds: 20));

      fakePeerConnection.emitRemoteTrack(
        _FakeMediaStreamTrack('remote-video-track', 'video'),
      );
      await Future<void>.delayed(const Duration(milliseconds: 20));

      expect(remoteEvents, hasLength(1));
      expect(remoteEvents.single.kind, 'video');
      expect(remoteEvents.single.participantId, 'member-remote');
      expect(remoteEvents.single.view, isA<_FakeMediaStream>());

      room.leave();
      transport.destroy();
    });

    test('p2p answers remote offers and applies incoming ice candidates',
        () async {
      final frames = <Map<String, dynamic>>[];
      late WebSocket socket;

      server.listen((request) async {
        if (request.uri.path == '/api/room') {
          final ws = await WebSocketTransformer.upgrade(request);
          socket = ws;
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
                    'memberId': 'member-local',
                    'userId': 'user-1',
                    'connectionId': 'conn-1',
                    'connectionCount': 1,
                    'state': <String, dynamic>{},
                  },
                  {
                    'memberId': 'member-remote',
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
            if (decoded['type'] == 'signal') {
              ws.add(jsonEncode({
                'type': 'signal_sent',
                'requestId': decoded['requestId'],
              }));
            }
          });
          return;
        }

        request.response.statusCode = HttpStatus.notFound;
        await request.response.close();
      });

      final room = RoomClient(baseUrl, 'game', 'room-1', tokenManager);
      await room.join();

      final fakePeerConnection = _FakeRTCPeerConnection();
      final transport = room.media.transport(
        RoomMediaTransportOptions(
          provider: 'p2p',
          p2p: RoomP2PMediaTransportOptions(
            peerConnectionFactory: (_) async => fakePeerConnection,
            mediaDevices: _FakeP2PMediaDevicesAdapter(),
          ),
        ),
      );

      await transport.connect();
      socket.add(jsonEncode({
        'type': 'signal',
        'event': 'edgebase.media.p2p.offer',
        'meta': {'memberId': 'member-remote'},
        'payload': {
          'description': {
            'type': 'offer',
            'sdp': 'remote-offer-sdp',
          }
        },
      }));
      await Future<void>.delayed(const Duration(milliseconds: 20));
      socket.add(jsonEncode({
        'type': 'signal',
        'event': 'edgebase.media.p2p.ice',
        'meta': {'memberId': 'member-remote'},
        'payload': {
          'candidate': {
            'candidate': 'candidate:1 1 udp 1 127.0.0.1 9999 typ host',
            'sdpMid': '0',
            'sdpMLineIndex': 0,
          }
        },
      }));
      await Future<void>.delayed(const Duration(milliseconds: 20));

      expect(
        fakePeerConnection.remoteDescription?.type,
        'offer',
      );
      expect(
        fakePeerConnection.addedCandidates.map((candidate) => candidate.candidate),
        contains('candidate:1 1 udp 1 127.0.0.1 9999 typ host'),
      );
      expect(
        frames
            .where((frame) => frame['type'] == 'signal')
            .map((frame) => frame['event'])
            .toList(),
        contains('edgebase.media.p2p.answer'),
      );

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

class _FakeP2PMediaDevicesAdapter implements RoomP2PMediaDevicesAdapter {
  final Map<String, _FakeMediaStream> userMediaByKind;

  _FakeP2PMediaDevicesAdapter({
    Map<String, _FakeMediaStream>? userMediaByKind,
  }) : userMediaByKind = userMediaByKind ?? <String, _FakeMediaStream>{};

  @override
  Future<MediaStream> getDisplayMedia(
    Map<String, dynamic> mediaConstraints,
  ) async {
    return _FakeMediaStream(<MediaStreamTrack>[]);
  }

  @override
  Future<MediaStream> getUserMedia(Map<String, dynamic> mediaConstraints) async {
    if (mediaConstraints['audio'] != false) {
      return userMediaByKind['audio'] ??
          _FakeMediaStream(<MediaStreamTrack>[
            _FakeMediaStreamTrack('audio-track', 'audio'),
          ]);
    }

    return userMediaByKind['video'] ??
        _FakeMediaStream(<MediaStreamTrack>[
          _FakeMediaStreamTrack('video-track', 'video'),
        ]);
  }
}

class _FakeMediaStreamTrack extends MediaStreamTrack {
  @override
  final String? id;

  @override
  final String? kind;

  final Map<String, dynamic> settings;

  bool _enabled = true;

  _FakeMediaStreamTrack(
    this.id,
    this.kind, {
    this.settings = const <String, dynamic>{},
  });

  @override
  bool get enabled => _enabled;

  @override
  set enabled(bool b) => _enabled = b;

  @override
  String? get label => '';

  @override
  bool? get muted => false;

  @override
  Map<String, dynamic> getSettings() => Map<String, dynamic>.from(settings);

  @override
  Future<void> dispose() async {}

  @override
  Future<void> stop() async {
    onEnded?.call();
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      super.noSuchMethod(invocation);
}

class _FakeMediaStream extends MediaStream {
  final List<MediaStreamTrack> _tracks;

  _FakeMediaStream(List<MediaStreamTrack> tracks)
      : _tracks = List<MediaStreamTrack>.from(tracks),
        super(
          'stream-${tracks.isEmpty ? 'empty' : tracks.first.id}',
          'fake-stream',
        );

  @override
  bool? get active => _tracks.isNotEmpty;

  @override
  Future<void> addTrack(MediaStreamTrack track, {bool addToNative = true}) async {
    _tracks.add(track);
    onAddTrack?.call(track);
  }

  @override
  Future<MediaStream> clone() async => _FakeMediaStream(_tracks);

  @override
  Future<void> dispose() async {}

  @override
  Future<void> getMediaTracks() async {}

  @override
  List<MediaStreamTrack> getAudioTracks() =>
      _tracks.where((track) => track.kind == 'audio').toList();

  @override
  List<MediaStreamTrack> getTracks() =>
      List<MediaStreamTrack>.from(_tracks);

  @override
  List<MediaStreamTrack> getVideoTracks() =>
      _tracks.where((track) => track.kind == 'video').toList();

  @override
  Future<void> removeTrack(MediaStreamTrack track,
      {bool removeFromNative = true}) async {
    _tracks.remove(track);
    onRemoveTrack?.call(track);
  }
}

class _FakeRTCRtpSender extends RTCRtpSender {
  MediaStreamTrack? _track;

  _FakeRTCRtpSender(this._track);

  @override
  MediaStreamTrack? get track => _track;

  @override
  Future<void> replaceTrack(MediaStreamTrack? track) async {
    _track = track;
  }

  @override
  Future<void> dispose() async {}

  @override
  String get senderId => 'fake-sender';

  @override
  bool get ownsTrack => false;

  @override
  get dtmfSender => throw UnimplementedError();

  @override
  get parameters => throw UnimplementedError();

  @override
  Future<List<StatsReport>> getStats() async => <StatsReport>[];

  @override
  Future<bool> setParameters(RTCRtpParameters parameters) async => true;

  @override
  Future<void> setStreams(List<MediaStream> streams) async {}

  @override
  Future<void> setTrack(MediaStreamTrack? track,
      {bool takeOwnership = true}) async {
    _track = track;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      super.noSuchMethod(invocation);
}

class _FakeRTCPeerConnection extends RTCPeerConnection {
  final List<_FakeRTCRtpSender> _senders = <_FakeRTCRtpSender>[];
  final List<RTCIceCandidate> addedCandidates = <RTCIceCandidate>[];
  RTCSessionDescription? localDescription;
  RTCSessionDescription? remoteDescription;
  int _descriptionCounter = 0;
  RTCSignalingState? _signalingState = RTCSignalingState.RTCSignalingStateStable;
  RTCPeerConnectionState? _connectionState =
      RTCPeerConnectionState.RTCPeerConnectionStateNew;

  @override
  RTCPeerConnectionState? get connectionState => _connectionState;

  @override
  Map<String, dynamic> get getConfiguration => <String, dynamic>{};

  @override
  RTCIceConnectionState? get iceConnectionState => null;

  @override
  RTCIceGatheringState? get iceGatheringState => null;

  @override
  RTCSignalingState? get signalingState => _signalingState;

  @override
  Future<RTCRtpSender> addTrack(MediaStreamTrack track, [MediaStream? stream]) async {
    final sender = _FakeRTCRtpSender(track);
    _senders.add(sender);
    scheduleMicrotask(() {
      onRenegotiationNeeded?.call();
    });
    return sender;
  }

  @override
  Future<void> addCandidate(RTCIceCandidate candidate) async {
    addedCandidates.add(candidate);
  }

  @override
  Future<void> addStream(MediaStream stream) async {}

  @override
  Future<RTCDataChannel> createDataChannel(
    String label,
    RTCDataChannelInit dataChannelDict,
  ) async {
    throw UnimplementedError();
  }

  @override
  Future<RTCSessionDescription> createAnswer(
      [Map<String, dynamic> constraints = const <String, dynamic>{}]) async {
    _descriptionCounter += 1;
    return RTCSessionDescription(
      'answer-$_descriptionCounter',
      'answer',
    );
  }

  @override
  Future<RTCSessionDescription> createOffer(
      [Map<String, dynamic> constraints = const <String, dynamic>{}]) async {
    _descriptionCounter += 1;
    return RTCSessionDescription(
      'offer-$_descriptionCounter',
      'offer',
    );
  }

  @override
  createDtmfSender(MediaStreamTrack track) => throw UnimplementedError();

  @override
  Future<void> dispose() async {}

  void emitRemoteTrack(MediaStreamTrack track) {
    onTrack?.call(RTCTrackEvent(
      streams: <MediaStream>[_FakeMediaStream(<MediaStreamTrack>[track])],
      track: track,
    ));
  }

  @override
  Future<RTCSessionDescription?> getLocalDescription() async => localDescription;

  @override
  List<MediaStream?> getLocalStreams() => <MediaStream?>[];

  @override
  Future<RTCSessionDescription?> getRemoteDescription() async =>
      remoteDescription;

  @override
  List<MediaStream?> getRemoteStreams() => <MediaStream?>[];

  @override
  Future<List<RTCRtpReceiver>> getReceivers() async => <RTCRtpReceiver>[];

  @override
  Future<List<RTCRtpSender>> getSenders() async => _senders;

  @override
  Future<List<RTCRtpTransceiver>> getTransceivers() async =>
      <RTCRtpTransceiver>[];

  @override
  Future<List<StatsReport>> getStats([MediaStreamTrack? track]) async =>
      <StatsReport>[];

  @override
  Future<bool> removeTrack(RTCRtpSender sender) async {
    _senders.remove(sender);
    scheduleMicrotask(() {
      onRenegotiationNeeded?.call();
    });
    return true;
  }

  @override
  Future<void> removeStream(MediaStream stream) async {}

  @override
  Future<void> restartIce() async {}

  @override
  Future<void> setConfiguration(Map<String, dynamic> configuration) async {}

  @override
  Future<void> setLocalDescription(RTCSessionDescription description) async {
    localDescription = description;
    _signalingState = description.type == 'offer'
        ? RTCSignalingState.RTCSignalingStateHaveLocalOffer
        : RTCSignalingState.RTCSignalingStateStable;
  }

  @override
  Future<void> setRemoteDescription(RTCSessionDescription description) async {
    remoteDescription = description;
    _signalingState = description.type == 'offer'
        ? RTCSignalingState.RTCSignalingStateHaveRemoteOffer
        : RTCSignalingState.RTCSignalingStateStable;
  }

  @override
  Future<void> close() async {
    _connectionState = RTCPeerConnectionState.RTCPeerConnectionStateClosed;
  }

  @override
  Future<RTCRtpTransceiver> addTransceiver({
    MediaStreamTrack? track,
    RTCRtpMediaType? kind,
    RTCRtpTransceiverInit? init,
  }) async {
    throw UnimplementedError();
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      super.noSuchMethod(invocation);
}
