part of 'room_client.dart';

const Duration _roomP2PDefaultMemberReadyTimeout = Duration(seconds: 10);
const List<Map<String, dynamic>> _roomP2PDefaultIceServers = <Map<String, dynamic>>[
  <String, dynamic>{'urls': 'stun:stun.l.google.com:19302'},
];

String _roomP2PTrackKey(String memberId, String trackId) =>
    '$memberId:$trackId';

Map<String, dynamic> _roomP2PExactDeviceConstraint(String deviceId) =>
    <String, dynamic>{
      'deviceId': <String, dynamic>{'exact': deviceId},
    };

String? _roomP2PNormalizeTrackKind(MediaStreamTrack track) {
  switch (track.kind) {
    case 'audio':
      return 'audio';
    case 'video':
      return 'video';
    default:
      return null;
  }
}

Map<String, dynamic> _roomP2PSerializeDescription(
  RTCSessionDescription description,
) {
  return <String, dynamic>{
    'type': description.type,
    if (description.sdp != null) 'sdp': description.sdp,
  };
}

Map<String, dynamic> _roomP2PSerializeCandidate(RTCIceCandidate candidate) {
  return <String, dynamic>{
    if (candidate.candidate != null) 'candidate': candidate.candidate,
    if (candidate.sdpMid != null) 'sdpMid': candidate.sdpMid,
    if (candidate.sdpMLineIndex != null)
      'sdpMLineIndex': candidate.sdpMLineIndex,
  };
}

class _RoomP2PDefaultMediaDevicesAdapter
    implements RoomP2PMediaDevicesAdapter {
  const _RoomP2PDefaultMediaDevicesAdapter();

  @override
  Future<MediaStream> getUserMedia(
    Map<String, dynamic> mediaConstraints,
  ) {
    return navigator.mediaDevices.getUserMedia(mediaConstraints);
  }

  @override
  Future<MediaStream> getDisplayMedia(
    Map<String, dynamic> mediaConstraints,
  ) {
    return navigator.mediaDevices.getDisplayMedia(mediaConstraints);
  }
}

class _RoomP2PLocalTrackState {
  final String kind;
  final MediaStreamTrack track;
  final MediaStream stream;
  final String? deviceId;
  final bool stopOnCleanup;

  const _RoomP2PLocalTrackState({
    required this.kind,
    required this.track,
    required this.stream,
    required this.deviceId,
    required this.stopOnCleanup,
  });
}

class _RoomP2PPendingRemoteTrack {
  final String memberId;
  final MediaStreamTrack track;
  final MediaStream stream;

  const _RoomP2PPendingRemoteTrack({
    required this.memberId,
    required this.track,
    required this.stream,
  });
}

class _RoomP2PPeerState {
  final String memberId;
  final RTCPeerConnection pc;
  final bool polite;
  final Map<String, RTCRtpSender> senders = <String, RTCRtpSender>{};
  final List<RTCIceCandidate> pendingCandidates = <RTCIceCandidate>[];
  bool makingOffer = false;
  bool ignoreOffer = false;
  bool isSettingRemoteAnswerPending = false;

  _RoomP2PPeerState({
    required this.memberId,
    required this.pc,
    required this.polite,
  });
}

class _RoomP2PSingleTrackStream extends MediaStream {
  final List<MediaStreamTrack> _tracks;

  _RoomP2PSingleTrackStream(MediaStreamTrack track)
      : _tracks = <MediaStreamTrack>[track],
        super('edgebase-p2p-${track.id ?? track.kind}', 'edgebase-p2p');

  @override
  bool? get active => _tracks.isNotEmpty;

  @override
  Future<void> addTrack(MediaStreamTrack track, {bool addToNative = true}) async {
    _tracks.add(track);
    onAddTrack?.call(track);
  }

  @override
  Future<MediaStream> clone() async {
    return _RoomP2PSingleTrackStream(_tracks.first);
  }

  @override
  Future<void> getMediaTracks() async {}

  @override
  List<MediaStreamTrack> getAudioTracks() =>
      _tracks.where((track) => track.kind == 'audio').toList();

  @override
  List<MediaStreamTrack> getTracks() => List<MediaStreamTrack>.from(_tracks);

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

class RoomP2PMediaTransport implements RoomMediaTransport {
  final RoomClient _room;
  final RoomP2PMediaTransportOptions _options;
  final Map<String, _RoomP2PLocalTrackState> _localTracks =
      <String, _RoomP2PLocalTrackState>{};
  final Map<String, _RoomP2PPeerState> _peers = <String, _RoomP2PPeerState>{};
  final Map<String, Future<_RoomP2PPeerState>> _pendingPeers =
      <String, Future<_RoomP2PPeerState>>{};
  final List<void Function(RoomMediaRemoteTrackEvent event)>
      _remoteTrackHandlers = <void Function(RoomMediaRemoteTrackEvent event)>[];
  final Map<String, String> _remoteTrackKinds = <String, String>{};
  final Set<String> _emittedRemoteTracks = <String>{};
  final Map<String, _RoomP2PPendingRemoteTrack> _pendingRemoteTracks =
      <String, _RoomP2PPendingRemoteTrack>{};
  final List<RoomSubscription> _subscriptions = <RoomSubscription>[];
  String? _localMemberId;
  bool _connected = false;

  RoomP2PMediaTransport(
    this._room, [
    RoomP2PMediaTransportOptions? options,
  ]) : _options = options ?? const RoomP2PMediaTransportOptions();

  String get _offerEvent => '${_options.signalPrefix}.offer';
  String get _answerEvent => '${_options.signalPrefix}.answer';
  String get _iceEvent => '${_options.signalPrefix}.ice';

  Map<String, dynamic> get _rtcConfiguration {
    final configured = _options.rtcConfiguration == null
        ? <String, dynamic>{}
        : Map<String, dynamic>.from(_options.rtcConfiguration!);
    final iceServers = configured['iceServers'];
    if (iceServers is List && iceServers.isNotEmpty) {
      return configured;
    }
    configured['iceServers'] = _roomP2PDefaultIceServers;
    return configured;
  }

  RoomP2PMediaDevicesAdapter get _mediaDevices =>
      _options.mediaDevices ?? const _RoomP2PDefaultMediaDevicesAdapter();

  Future<RTCPeerConnection> _createPeerConnection() {
    if (_options.peerConnectionFactory != null) {
      return _options.peerConnectionFactory!(_rtcConfiguration);
    }
    return createPeerConnection(_rtcConfiguration);
  }

  @override
  Future<String> connect([RoomMediaTransportConnectPayload? payload]) async {
    if (_connected && _localMemberId != null) {
      return _localMemberId!;
    }

    if (payload != null && payload.containsKey('sessionDescription')) {
      throw ArgumentError(
        'RoomP2PMediaTransport.connect() does not accept sessionDescription. Use room.signals through the built-in transport instead.',
      );
    }

    final currentMember = await _waitForCurrentMember();
    if (currentMember == null) {
      throw StateError('Join the room before connecting a P2P media transport.');
    }

    _localMemberId = currentMember['memberId'] as String?;
    _connected = true;
    _hydrateRemoteTrackKinds();
    _attachRoomSubscriptions();

    try {
      for (final member in _room.members.list()) {
        final memberId = member['memberId'] as String?;
        if (memberId != null && memberId != _localMemberId) {
          await _ensurePeer(memberId);
        }
      }
    } catch (error) {
      _rollbackConnectedState();
      rethrow;
    }

    return _localMemberId!;
  }

  @override
  Future<Object?> enableAudio([Map<String, dynamic>? payload]) async {
    final captured = await _captureUserMediaTrack(
      'audio',
      _resolveTrackConstraints(payload, 'deviceId'),
    );
    if (captured == null) {
      throw StateError('P2P transport could not create a local audio track.');
    }

    final providerSessionId = await _ensureConnectedMemberId();
    _rememberLocalTrack(
      'audio',
      captured.track,
      captured.stream,
      captured.deviceId,
      true,
    );
    await _room.media.audio.enable(<String, dynamic>{
      if (payload != null) ...payload,
      'trackId': captured.track.id,
      if (captured.deviceId != null) 'deviceId': captured.deviceId,
      'providerSessionId': providerSessionId,
    });
    await _syncAllPeerSenders();
    return captured.track;
  }

  @override
  Future<Object?> enableVideo([Map<String, dynamic>? payload]) async {
    final captured = await _captureUserMediaTrack(
      'video',
      _resolveTrackConstraints(payload, 'deviceId'),
    );
    if (captured == null) {
      throw StateError('P2P transport could not create a local video track.');
    }

    final providerSessionId = await _ensureConnectedMemberId();
    _rememberLocalTrack(
      'video',
      captured.track,
      captured.stream,
      captured.deviceId,
      true,
    );
    await _room.media.video.enable(<String, dynamic>{
      if (payload != null) ...payload,
      'trackId': captured.track.id,
      if (captured.deviceId != null) 'deviceId': captured.deviceId,
      'providerSessionId': providerSessionId,
    });
    await _syncAllPeerSenders();
    return captured.stream;
  }

  @override
  Future<Object?> startScreenShare([Map<String, dynamic>? payload]) async {
    final stream = await _mediaDevices.getDisplayMedia(<String, dynamic>{
      'video': true,
      'audio': false,
    });
    final track =
        stream.getVideoTracks().isNotEmpty ? stream.getVideoTracks().first : null;
    if (track == null) {
      throw StateError(
        'P2P transport could not create a screen-share track.',
      );
    }

    track.onEnded = () {
      unawaited(stopScreenShare());
    };

    final providerSessionId = await _ensureConnectedMemberId();
    _rememberLocalTrack(
      'screen',
      track,
      stream,
      _trackDeviceId(track),
      true,
    );
    await _room.media.screen.start(<String, dynamic>{
      if (payload != null) ...payload,
      'trackId': track.id,
      if (_trackDeviceId(track) != null) 'deviceId': _trackDeviceId(track),
      'providerSessionId': providerSessionId,
    });
    await _syncAllPeerSenders();
    return stream;
  }

  @override
  Future<void> disableAudio() async {
    await _releaseLocalTrack('audio');
    await _syncAllPeerSenders();
    await _room.media.audio.disable();
  }

  @override
  Future<void> disableVideo() async {
    await _releaseLocalTrack('video');
    await _syncAllPeerSenders();
    await _room.media.video.disable();
  }

  @override
  Future<void> stopScreenShare() async {
    await _releaseLocalTrack('screen');
    await _syncAllPeerSenders();
    await _room.media.screen.stop();
  }

  @override
  Future<void> setMuted(String kind, bool muted) async {
    final track = _localTracks[kind]?.track;
    if (track != null) {
      track.enabled = !muted;
    }

    switch (kind) {
      case 'audio':
        await _room.media.audio.setMuted(muted);
        return;
      case 'video':
        await _room.media.video.setMuted(muted);
        return;
      default:
        throw UnsupportedError('Unsupported mute kind: $kind');
    }
  }

  @override
  Future<void> switchDevices(Map<String, dynamic> payload) async {
    final audioInputId = payload['audioInputId'] as String?;
    final videoInputId = payload['videoInputId'] as String?;

    if (audioInputId != null && _localTracks.containsKey('audio')) {
      final captured = await _captureUserMediaTrack(
        'audio',
        _roomP2PExactDeviceConstraint(audioInputId),
      );
      if (captured != null) {
        _rememberLocalTrack(
          'audio',
          captured.track,
          captured.stream,
          audioInputId,
          true,
        );
      }
    }

    if (videoInputId != null && _localTracks.containsKey('video')) {
      final captured = await _captureUserMediaTrack(
        'video',
        _roomP2PExactDeviceConstraint(videoInputId),
      );
      if (captured != null) {
        _rememberLocalTrack(
          'video',
          captured.track,
          captured.stream,
          videoInputId,
          true,
        );
      }
    }

    await _syncAllPeerSenders();
    await _room.media.devices.switchInputs(payload);
  }

  @override
  RoomSubscription onRemoteTrack(
    void Function(RoomMediaRemoteTrackEvent event) handler,
  ) {
    _remoteTrackHandlers.add(handler);
    return RoomSubscription(() {
      _remoteTrackHandlers.remove(handler);
    });
  }

  @override
  String? getSessionId() => _localMemberId;

  @override
  Object? getPeerConnection() {
    if (_peers.length != 1) return null;
    return _peers.values.first.pc;
  }

  @override
  void destroy() {
    _connected = false;
    _localMemberId = null;
    for (final subscription in List<RoomSubscription>.from(_subscriptions)) {
      subscription.cancel();
    }
    _subscriptions.clear();
    for (final peer in _peers.values.toList()) {
      _destroyPeer(peer);
    }
    _peers.clear();
    _pendingPeers.clear();
    for (final kind in _localTracks.keys.toList()) {
      unawaited(_releaseLocalTrack(kind));
    }
    _remoteTrackKinds.clear();
    _emittedRemoteTracks.clear();
    _pendingRemoteTracks.clear();
  }

  Future<Map<String, dynamic>?> _waitForCurrentMember([
    Duration timeout = _roomP2PDefaultMemberReadyTimeout,
  ]) async {
    final deadline = DateTime.now().add(timeout);
    while (DateTime.now().isBefore(deadline)) {
      final current = _currentMember();
      if (current != null) {
        return current;
      }
      await Future<void>.delayed(const Duration(milliseconds: 50));
    }
    return _currentMember();
  }

  Map<String, dynamic>? _currentMember() {
    final userId = _room._currentUserId;
    final connectionId = _room._currentConnectionId;
    if (userId == null) return null;

    if (connectionId != null) {
      for (final member in _room.members.list()) {
        if (member['connectionId'] == connectionId) {
          return member;
        }
      }
    }

    for (final member in _room.members.list()) {
      if (member['userId'] == userId) {
        return member;
      }
    }
    return null;
  }

  void _attachRoomSubscriptions() {
    if (_subscriptions.isNotEmpty) return;

    _subscriptions.addAll(<RoomSubscription>[
      _room.members.onJoin((member) {
        final memberId = member['memberId'] as String?;
        if (memberId != null && memberId != _localMemberId) {
          unawaited(_ensurePeer(memberId));
        }
      }),
      _room.members.onSync((members) {
        final activeMemberIds = <String>{};
        for (final member in members) {
          final memberId = member['memberId'] as String?;
          if (memberId != null && memberId != _localMemberId) {
            activeMemberIds.add(memberId);
            unawaited(_ensurePeer(memberId));
          }
        }
        for (final memberId in _peers.keys.toList()) {
          if (!activeMemberIds.contains(memberId)) {
            _removeRemoteMember(memberId);
          }
        }
      }),
      _room.members.onLeave((member, _reason) {
        final memberId = member['memberId'] as String?;
        if (memberId == null) return;
        _removeRemoteMember(memberId);
      }),
      _room.signals.on(_offerEvent, (payload, meta) {
        unawaited(_handleDescriptionSignal('offer', payload, meta));
      }),
      _room.signals.on(_answerEvent, (payload, meta) {
        unawaited(_handleDescriptionSignal('answer', payload, meta));
      }),
      _room.signals.on(_iceEvent, (payload, meta) {
        unawaited(_handleIceSignal(payload, meta));
      }),
      _room.media.onTrack((track, member) {
        final memberId = member['memberId'] as String?;
        if (memberId != null && memberId != _localMemberId) {
          unawaited(_ensurePeer(memberId));
        }
        _rememberRemoteTrackKind(track, member);
      }),
      _room.media.onTrackRemoved((track, member) {
        final memberId = member['memberId'] as String?;
        final trackId = track['trackId'] as String?;
        if (memberId == null || trackId == null) return;
        final key = _roomP2PTrackKey(memberId, trackId);
        _remoteTrackKinds.remove(key);
        _emittedRemoteTracks.remove(key);
        _pendingRemoteTracks.remove(key);
      }),
    ]);
  }

  void _hydrateRemoteTrackKinds() {
    _remoteTrackKinds.clear();
    _emittedRemoteTracks.clear();
    _pendingRemoteTracks.clear();
    for (final mediaMember in _room.media.list()) {
      final member = _asMap(mediaMember['member']);
      final tracks = _asListOfMaps(mediaMember['tracks']);
      for (final track in tracks) {
        _rememberRemoteTrackKind(track, member);
      }
    }
  }

  void _rememberRemoteTrackKind(
    Map<String, dynamic> track,
    Map<String, dynamic> member,
  ) {
    final trackId = track['trackId'] as String?;
    final memberId = member['memberId'] as String?;
    final kind = track['kind'] as String?;
    if (trackId == null || memberId == null || kind == null) {
      return;
    }
    if (memberId == _localMemberId) {
      return;
    }

    final key = _roomP2PTrackKey(memberId, trackId);
    _remoteTrackKinds[key] = kind;
    final pending = _pendingRemoteTracks.remove(key);
    if (pending != null) {
      _emitRemoteTrack(memberId, pending.track, pending.stream, kind);
      return;
    }
    _flushPendingRemoteTracks(memberId, kind);
  }

  Future<_RoomP2PPeerState> _ensurePeer(String memberId) {
    final existing = _peers[memberId];
    if (existing != null) {
      unawaited(_syncPeerSenders(existing));
      return Future<_RoomP2PPeerState>.value(existing);
    }

    final pending = _pendingPeers[memberId];
    if (pending != null) {
      return pending;
    }

    final future = _createPeerConnection().then((pc) async {
      final peer = _RoomP2PPeerState(
        memberId: memberId,
        pc: pc,
        polite: _localMemberId != null && _localMemberId!.compareTo(memberId) > 0,
      );

      pc.onIceCandidate = (RTCIceCandidate candidate) {
        if ((candidate.candidate ?? '').isEmpty) {
          return;
        }
        unawaited(_room.signals.sendTo(memberId, _iceEvent, <String, dynamic>{
          'candidate': _roomP2PSerializeCandidate(candidate),
        }));
      };

      pc.onRenegotiationNeeded = () {
        unawaited(_negotiatePeer(peer));
      };

      pc.onTrack = (RTCTrackEvent event) {
        final stream = event.streams.isNotEmpty
            ? event.streams.first
            : _RoomP2PSingleTrackStream(event.track);
        final exactKind = event.track.id == null
            ? null
            : _remoteTrackKinds[_roomP2PTrackKey(memberId, event.track.id!)];
        final fallbackKind = exactKind == null
            ? _resolveFallbackRemoteTrackKind(memberId, event.track)
            : null;
        final kind =
            exactKind ?? fallbackKind ?? _roomP2PNormalizeTrackKind(event.track);

        if (kind == null ||
            (exactKind == null &&
                fallbackKind == null &&
                kind == 'video' &&
                event.track.kind == 'video')) {
          final trackId = event.track.id;
          if (trackId != null) {
            _pendingRemoteTracks[_roomP2PTrackKey(memberId, trackId)] =
                _RoomP2PPendingRemoteTrack(
              memberId: memberId,
              track: event.track,
              stream: stream,
            );
          }
          return;
        }

        _emitRemoteTrack(memberId, event.track, stream, kind);
      };

      _peers[memberId] = peer;
      _pendingPeers.remove(memberId);
      await _syncPeerSenders(peer);
      return peer;
    });

    _pendingPeers[memberId] = future;
    return future;
  }

  Future<void> _negotiatePeer(_RoomP2PPeerState peer) async {
    final signalingState = peer.pc.signalingState;
    if (!_connected ||
        peer.pc.connectionState == RTCPeerConnectionState.RTCPeerConnectionStateClosed ||
        peer.makingOffer ||
        peer.isSettingRemoteAnswerPending ||
        signalingState != RTCSignalingState.RTCSignalingStateStable) {
      return;
    }

    try {
      peer.makingOffer = true;
      final offer = await peer.pc.createOffer(<String, dynamic>{});
      await peer.pc.setLocalDescription(offer);
      await _room.signals.sendTo(peer.memberId, _offerEvent, <String, dynamic>{
        'description': _roomP2PSerializeDescription(offer),
      });
    } finally {
      peer.makingOffer = false;
    }
  }

  Future<void> _handleDescriptionSignal(
    String expectedType,
    dynamic payload,
    Map<String, dynamic> meta,
  ) async {
    final senderId = (meta['memberId'] as String?)?.trim();
    if (senderId == null || senderId.isEmpty || senderId == _localMemberId) {
      return;
    }

    final description = _normalizeDescription(payload);
    if (description == null || description.type != expectedType) {
      return;
    }

    final peer = await _ensurePeer(senderId);
    final readyForOffer = !peer.makingOffer &&
        (peer.pc.signalingState == RTCSignalingState.RTCSignalingStateStable ||
            peer.isSettingRemoteAnswerPending);
    final offerCollision = description.type == 'offer' && !readyForOffer;
    peer.ignoreOffer = !peer.polite && offerCollision;
    if (peer.ignoreOffer) {
      return;
    }

    try {
      peer.isSettingRemoteAnswerPending = description.type == 'answer';
      await peer.pc.setRemoteDescription(description);
      peer.isSettingRemoteAnswerPending = false;
      await _flushPendingCandidates(peer);

      if (description.type == 'offer') {
        await _syncPeerSenders(peer);
        final answer = await peer.pc.createAnswer(<String, dynamic>{});
        await peer.pc.setLocalDescription(answer);
        await _room.signals.sendTo(
          senderId,
          _answerEvent,
          <String, dynamic>{
            'description': _roomP2PSerializeDescription(answer),
          },
        );
      }
    } catch (_) {
      peer.isSettingRemoteAnswerPending = false;
      rethrow;
    }
  }

  Future<void> _handleIceSignal(
    dynamic payload,
    Map<String, dynamic> meta,
  ) async {
    final senderId = (meta['memberId'] as String?)?.trim();
    if (senderId == null || senderId.isEmpty || senderId == _localMemberId) {
      return;
    }

    final candidate = _normalizeCandidate(payload);
    if (candidate == null) {
      return;
    }

    final peer = await _ensurePeer(senderId);
    final remoteDescription = await peer.pc.getRemoteDescription();
    if (remoteDescription == null) {
      peer.pendingCandidates.add(candidate);
      return;
    }

    try {
      await peer.pc.addCandidate(candidate);
    } catch (_) {
      if (!peer.ignoreOffer) {
        peer.pendingCandidates.add(candidate);
      }
    }
  }

  Future<void> _flushPendingCandidates(_RoomP2PPeerState peer) async {
    final remoteDescription = await peer.pc.getRemoteDescription();
    if (remoteDescription == null || peer.pendingCandidates.isEmpty) {
      return;
    }

    final pending = List<RTCIceCandidate>.from(peer.pendingCandidates);
    peer.pendingCandidates.clear();
    for (final candidate in pending) {
      try {
        await peer.pc.addCandidate(candidate);
      } catch (_) {
        if (!peer.ignoreOffer) {
          peer.pendingCandidates.add(candidate);
        }
      }
    }
  }

  Future<void> _syncAllPeerSenders() async {
    for (final peer in _peers.values) {
      await _syncPeerSenders(peer);
    }
  }

  Future<void> _syncPeerSenders(_RoomP2PPeerState peer) async {
    final activeKinds = <String>{};
    var changed = false;

    for (final entry in _localTracks.entries) {
      final kind = entry.key;
      final localTrack = entry.value;
      activeKinds.add(kind);
      final sender = peer.senders[kind];
      if (sender != null) {
        if (sender.track != localTrack.track) {
          await sender.replaceTrack(localTrack.track);
          changed = true;
        }
        continue;
      }

      final addedSender = await peer.pc.addTrack(
        localTrack.track,
        localTrack.stream,
      );
      peer.senders[kind] = addedSender;
      changed = true;
    }

    for (final entry in peer.senders.entries.toList()) {
      final kind = entry.key;
      final sender = entry.value;
      if (activeKinds.contains(kind)) {
        continue;
      }
      try {
        await peer.pc.removeTrack(sender);
      } catch (_) {
        // Ignore duplicate removals during shutdown.
      }
      peer.senders.remove(kind);
      changed = true;
    }

    if (changed) {
      unawaited(_negotiatePeer(peer));
    }
  }

  void _emitRemoteTrack(
    String memberId,
    MediaStreamTrack track,
    MediaStream stream,
    String kind,
  ) {
    final trackId = track.id;
    if (trackId == null) return;
    final key = _roomP2PTrackKey(memberId, trackId);
    if (_emittedRemoteTracks.contains(key)) {
      return;
    }

    _emittedRemoteTracks.add(key);
    _remoteTrackKinds[key] = kind;
    final participant = _room.members
        .list()
        .cast<Map<String, dynamic>?>()
        .firstWhere(
          (member) => member?['memberId'] == memberId,
          orElse: () => null,
        );

    final event = RoomMediaRemoteTrackEvent(
      kind: kind,
      track: track,
      view: stream,
      providerSessionId: memberId,
      participantId: memberId,
      customParticipantId: participant?['customParticipantId'] as String?,
      userId: participant?['userId'] as String?,
      participant: participant == null ? null : _cloneMap(participant),
    );

    for (final handler in List.of(_remoteTrackHandlers)) {
      handler(event);
    }
  }

  String? _resolveFallbackRemoteTrackKind(
    String memberId,
    MediaStreamTrack track,
  ) {
    final normalized = _roomP2PNormalizeTrackKind(track);
    if (normalized == null) {
      return null;
    }
    if (normalized == 'audio') {
      return 'audio';
    }

    return _getNextUnassignedPublishedVideoLikeKind(memberId);
  }

  void _flushPendingRemoteTracks(String memberId, String roomKind) {
    final expectedTrackKind = roomKind == 'audio' ? 'audio' : 'video';
    for (final entry in _pendingRemoteTracks.entries.toList()) {
      final pending = entry.value;
      if (pending.memberId != memberId || pending.track.kind != expectedTrackKind) {
        continue;
      }
      _pendingRemoteTracks.remove(entry.key);
      _emitRemoteTrack(memberId, pending.track, pending.stream, roomKind);
      return;
    }
  }

  List<String> _getPublishedVideoLikeKinds(String memberId) {
    final mediaMember = _room.media.list().cast<Map<String, dynamic>?>().firstWhere(
          (entry) => _asMap(entry?['member'])['memberId'] == memberId,
          orElse: () => null,
        );
    if (mediaMember == null) {
      return <String>[];
    }

    final kinds = <String>{};
    for (final track in _asListOfMaps(mediaMember['tracks'])) {
      final kind = track['kind'] as String?;
      if ((kind == 'video' || kind == 'screen') && track['trackId'] != null) {
        kinds.add(kind!);
      }
    }

    return kinds.toList();
  }

  String? _getNextUnassignedPublishedVideoLikeKind(String memberId) {
    final publishedKinds = _getPublishedVideoLikeKinds(memberId);
    if (publishedKinds.isEmpty) {
      return null;
    }

    final assignedKinds = <String>{};
    for (final key in _emittedRemoteTracks) {
      if (!key.startsWith('$memberId:')) {
        continue;
      }
      final kind = _remoteTrackKinds[key];
      if (kind == 'video' || kind == 'screen') {
        assignedKinds.add(kind!);
      }
    }

    for (final kind in publishedKinds) {
      if (!assignedKinds.contains(kind)) {
        return kind;
      }
    }
    return null;
  }

  Future<_RoomP2PLocalTrackState?> _captureUserMediaTrack(
    String kind,
    dynamic constraints,
  ) async {
    if (constraints == false) {
      return null;
    }

    final stream = await _mediaDevices.getUserMedia(
      kind == 'audio'
          ? <String, dynamic>{'audio': constraints ?? true, 'video': false}
          : <String, dynamic>{'audio': false, 'video': constraints ?? true},
    );

    final track = kind == 'audio'
        ? (stream.getAudioTracks().isNotEmpty ? stream.getAudioTracks().first : null)
        : (stream.getVideoTracks().isNotEmpty ? stream.getVideoTracks().first : null);
    if (track == null) {
      await stream.dispose();
      return null;
    }

    return _RoomP2PLocalTrackState(
      kind: kind,
      track: track,
      stream: stream,
      deviceId: _trackDeviceId(track),
      stopOnCleanup: true,
    );
  }

  dynamic _resolveTrackConstraints(
    Map<String, dynamic>? payload,
    String deviceIdKey,
  ) {
    final deviceId = payload?[deviceIdKey] as String?;
    if (deviceId != null && deviceId.isNotEmpty) {
      return _roomP2PExactDeviceConstraint(deviceId);
    }
    return true;
  }

  String? _trackDeviceId(MediaStreamTrack track) {
    final settings = track.getSettings();
    final deviceId = settings['deviceId'];
    return deviceId is String && deviceId.isNotEmpty ? deviceId : null;
  }

  void _rememberLocalTrack(
    String kind,
    MediaStreamTrack track,
    MediaStream stream,
    String? deviceId,
    bool stopOnCleanup,
  ) {
    unawaited(_releaseLocalTrack(kind));
    _localTracks[kind] = _RoomP2PLocalTrackState(
      kind: kind,
      track: track,
      stream: stream,
      deviceId: deviceId,
      stopOnCleanup: stopOnCleanup,
    );
  }

  Future<void> _releaseLocalTrack(String kind) async {
    final local = _localTracks.remove(kind);
    if (local == null) return;
    if (local.stopOnCleanup) {
      await local.track.stop();
    }
    await local.stream.dispose();
  }

  Future<String> _ensureConnectedMemberId() async {
    if (_localMemberId != null) {
      return _localMemberId!;
    }
    return connect();
  }

  void _removeRemoteMember(String memberId) {
    _remoteTrackKinds.removeWhere((key, _value) => key.startsWith('$memberId:'));
    _emittedRemoteTracks.removeWhere((key) => key.startsWith('$memberId:'));
    _pendingRemoteTracks.removeWhere((key, _value) => key.startsWith('$memberId:'));
    _closePeer(memberId);
  }

  void _rollbackConnectedState() {
    _connected = false;
    _localMemberId = null;
    for (final subscription in List<RoomSubscription>.from(_subscriptions)) {
      subscription.cancel();
    }
    _subscriptions.clear();
    for (final peer in _peers.values.toList()) {
      _destroyPeer(peer);
    }
    _peers.clear();
    _pendingPeers.clear();
    _remoteTrackKinds.clear();
    _emittedRemoteTracks.clear();
    _pendingRemoteTracks.clear();
  }

  RTCSessionDescription? _normalizeDescription(dynamic payload) {
    if (payload is! Map) {
      return null;
    }
    final description = payload['description'];
    if (description is! Map) {
      return null;
    }
    final type = description['type'];
    if (type is! String || type.isEmpty) {
      return null;
    }
    final sdp = description['sdp'];
    return RTCSessionDescription(
      sdp is String ? sdp : null,
      type,
    );
  }

  RTCIceCandidate? _normalizeCandidate(dynamic payload) {
    if (payload is! Map) {
      return null;
    }
    final candidate = payload['candidate'];
    if (candidate is! Map) {
      return null;
    }
    final rawCandidate = candidate['candidate'];
    if (rawCandidate is! String || rawCandidate.isEmpty) {
      return null;
    }
    return RTCIceCandidate(
      rawCandidate,
      candidate['sdpMid'] as String?,
      candidate['sdpMLineIndex'] as int?,
    );
  }

  void _closePeer(String memberId) {
    final peer = _peers.remove(memberId);
    _pendingPeers.remove(memberId);
    if (peer == null) return;
    _destroyPeer(peer);
  }

  void _destroyPeer(_RoomP2PPeerState peer) {
    peer.pc.onIceCandidate = null;
    peer.pc.onRenegotiationNeeded = null;
    peer.pc.onTrack = null;
    unawaited(peer.pc.close());
    unawaited(peer.pc.dispose());
  }
}
