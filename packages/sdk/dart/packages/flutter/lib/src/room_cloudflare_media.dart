part of 'room_client.dart';

typedef RoomCloudflareRealtimeKitClientFactory
    = Future<RoomCloudflareRealtimeKitClientAdapter> Function({
  required String authToken,
  String? displayName,
  bool enableAudio,
  bool enableVideo,
  String baseDomain,
});

class RoomCloudflareParticipantSnapshot {
  final String id;
  final String userId;
  final String name;
  final String? picture;
  final String? customParticipantId;
  final bool audioEnabled;
  final bool videoEnabled;
  final bool screenShareEnabled;
  final Object participantHandle;

  const RoomCloudflareParticipantSnapshot({
    required this.id,
    required this.userId,
    required this.name,
    this.picture,
    this.customParticipantId,
    required this.audioEnabled,
    required this.videoEnabled,
    required this.screenShareEnabled,
    required this.participantHandle,
  });

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'userId': userId,
      'name': name,
      if (picture != null) 'picture': picture,
      if (customParticipantId != null)
        'customParticipantId': customParticipantId,
      'audioEnabled': audioEnabled,
      'videoEnabled': videoEnabled,
      'screenShareEnabled': screenShareEnabled,
    };
  }
}

abstract class RoomCloudflareParticipantListener {
  void onParticipantJoin(RoomCloudflareParticipantSnapshot participant) {}
  void onParticipantLeave(RoomCloudflareParticipantSnapshot participant) {}
  void onAudioUpdate(
    RoomCloudflareParticipantSnapshot participant,
    bool enabled,
  ) {}
  void onVideoUpdate(
    RoomCloudflareParticipantSnapshot participant,
    bool enabled,
  ) {}
  void onScreenShareUpdate(
    RoomCloudflareParticipantSnapshot participant,
    bool enabled,
  ) {}
  void onParticipantsSync(
      List<RoomCloudflareParticipantSnapshot> participants) {}
}

abstract class RoomCloudflareRealtimeKitClientAdapter {
  Future<void> joinRoom();
  Future<void> leaveRoom();
  Future<void> enableAudio();
  Future<void> disableAudio();
  Future<void> enableVideo();
  Future<void> disableVideo();
  Future<void> enableScreenShare();
  Future<void> disableScreenShare();
  Future<void> setAudioDevice(String deviceId);
  Future<void> setVideoDevice(String deviceId);
  RoomCloudflareParticipantSnapshot get localParticipant;
  List<RoomCloudflareParticipantSnapshot> get joinedParticipants;
  Object? buildView(
    RoomCloudflareParticipantSnapshot participant,
    String kind, {
    bool isSelf = false,
  });
  void addListener(RoomCloudflareParticipantListener listener);
  void removeListener(RoomCloudflareParticipantListener listener);
}

class RoomCloudflareMediaTransport implements RoomMediaTransport {
  final RoomClient _room;
  final RoomCloudflareRealtimeKitTransportOptions _options;
  final List<void Function(RoomMediaRemoteTrackEvent event)>
      _remoteTrackHandlers = [];
  final Set<String> _publishedRemoteKeys = <String>{};
  RoomCloudflareRealtimeKitClientAdapter? _client;
  String? _sessionId;
  String? _providerSessionId;
  RoomCloudflareParticipantListener? _participantListener;
  Future<String>? _connectFuture;

  RoomCloudflareMediaTransport(
    this._room, [
    RoomCloudflareRealtimeKitTransportOptions? options,
  ]) : _options = options ?? const RoomCloudflareRealtimeKitTransportOptions();

  @override
  Future<String> connect([RoomMediaTransportConnectPayload? payload]) async {
    if (_sessionId != null) {
      return _sessionId!;
    }
    final inFlight = _connectFuture;
    if (inFlight != null) {
      return inFlight;
    }

    final connectFuture = () async {
      final session =
          await _room.media.cloudflareRealtimeKit.createSession(payload);
      final client = await _resolveClientFactory().call(
        authToken: session['authToken'] as String,
        displayName: payload?['name'] as String?,
        enableAudio: false,
        enableVideo: false,
        baseDomain: _options.baseDomain,
      );

      _client = client;
      _sessionId = session['sessionId'] as String?;
      _providerSessionId = session['participantId'] as String?;
      _participantListener = _RoomCloudflareTransportParticipantListener(this);
      client.addListener(_participantListener!);

      try {
        await client.joinRoom();
        _syncParticipants(client.joinedParticipants);
        return _sessionId ?? session['sessionId'] as String;
      } catch (error) {
        client.removeListener(_participantListener!);
        _participantListener = null;
        _client = null;
        _sessionId = null;
        _providerSessionId = null;
        rethrow;
      }
    }();

    _connectFuture = connectFuture;
    try {
      return await connectFuture;
    } finally {
      if (identical(_connectFuture, connectFuture)) {
        _connectFuture = null;
      }
    }
  }

  @override
  Future<Object?> enableAudio([Map<String, dynamic>? payload]) async {
    final client = await _requireClient();
    await client.enableAudio();
    await _room.media.audio.enable(_withProviderSession(payload));
    return client.localParticipant.participantHandle;
  }

  @override
  Future<Object?> enableVideo([Map<String, dynamic>? payload]) async {
    final client = await _requireClient();
    await client.enableVideo();
    await _room.media.video.enable(_withProviderSession(payload));
    return client.buildView(client.localParticipant, 'video', isSelf: true);
  }

  @override
  Future<Object?> startScreenShare([Map<String, dynamic>? payload]) async {
    final client = await _requireClient();
    await client.enableScreenShare();
    await _room.media.screen.start(_withProviderSession(payload));
    return client.buildView(client.localParticipant, 'screen', isSelf: true);
  }

  @override
  Future<void> disableAudio() async {
    final client = await _requireClient();
    await client.disableAudio();
    await _room.media.audio.disable();
  }

  @override
  Future<void> disableVideo() async {
    final client = await _requireClient();
    await client.disableVideo();
    await _room.media.video.disable();
  }

  @override
  Future<void> stopScreenShare() async {
    final client = await _requireClient();
    await client.disableScreenShare();
    await _room.media.screen.stop();
  }

  @override
  Future<void> setMuted(String kind, bool muted) async {
    final client = await _requireClient();
    if (kind == 'audio') {
      if (muted) {
        await client.disableAudio();
      } else {
        await client.enableAudio();
      }
      await _room.media.audio.setMuted(muted);
      return;
    }

    if (kind == 'video') {
      if (muted) {
        await client.disableVideo();
      } else {
        await client.enableVideo();
      }
      await _room.media.video.setMuted(muted);
      return;
    }

    throw UnsupportedError('Unsupported mute kind: $kind');
  }

  @override
  Future<void> switchDevices(Map<String, dynamic> payload) async {
    final client = await _requireClient();
    final audioInputId = payload['audioInputId'] as String?;
    final videoInputId = payload['videoInputId'] as String?;

    if (audioInputId != null && audioInputId.isNotEmpty) {
      await client.setAudioDevice(audioInputId);
    }
    if (videoInputId != null && videoInputId.isNotEmpty) {
      await client.setVideoDevice(videoInputId);
    }

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
  String? getSessionId() => _sessionId;

  @override
  Object? getPeerConnection() => null;

  @override
  void destroy() {
    final client = _client;
    final participantListener = _participantListener;
    _client = null;
    _participantListener = null;
    _sessionId = null;
    _providerSessionId = null;
    _connectFuture = null;
    _publishedRemoteKeys.clear();

    if (client != null && participantListener != null) {
      client.removeListener(participantListener);
      unawaited(client.leaveRoom());
    }
  }

  RoomCloudflareRealtimeKitClientFactory _resolveClientFactory() {
    return _options.clientFactory ?? _defaultCloudflareRealtimeKitClientFactory;
  }

  Future<RoomCloudflareRealtimeKitClientAdapter> _requireClient() async {
    final client = _client;
    if (client == null) {
      throw StateError(
        'Call room.media.transport({ provider: \'cloudflare_realtimekit\' }).connect() before using media controls.',
      );
    }
    return client;
  }

  Map<String, dynamic> _withProviderSession(Map<String, dynamic>? payload) {
    return {
      if (payload != null) ...payload,
      if (_providerSessionId != null) 'providerSessionId': _providerSessionId,
    };
  }

  void _syncParticipants(List<RoomCloudflareParticipantSnapshot> participants) {
    for (final participant in participants) {
      _syncParticipant(participant);
    }
  }

  void _syncParticipant(RoomCloudflareParticipantSnapshot participant) {
    _emitParticipantKind(participant, 'audio', participant.audioEnabled);
    _emitParticipantKind(participant, 'video', participant.videoEnabled);
    _emitParticipantKind(participant, 'screen', participant.screenShareEnabled);
  }

  void _removeParticipant(RoomCloudflareParticipantSnapshot participant) {
    _publishedRemoteKeys.removeWhere(
      (key) => key.startsWith('${participant.id}:'),
    );
  }

  void _emitParticipantKind(
    RoomCloudflareParticipantSnapshot participant,
    String kind,
    bool enabled,
  ) {
    final key = '${participant.id}:$kind';
    if (!enabled) {
      _publishedRemoteKeys.remove(key);
      return;
    }
    if (!_publishedRemoteKeys.add(key)) {
      return;
    }

    final client = _client;
    final event = RoomMediaRemoteTrackEvent(
      kind: kind,
      track: participant.participantHandle,
      view: client?.buildView(participant, kind),
      providerSessionId: participant.id,
      participantId: participant.id,
      customParticipantId: participant.customParticipantId,
      userId: participant.userId,
      participant: participant.toMap(),
    );
    for (final handler in List.of(_remoteTrackHandlers)) {
      handler(event);
    }
  }
}

class _RoomCloudflareTransportParticipantListener
    extends RoomCloudflareParticipantListener {
  final RoomCloudflareMediaTransport _transport;

  _RoomCloudflareTransportParticipantListener(this._transport);

  @override
  void onParticipantJoin(RoomCloudflareParticipantSnapshot participant) {
    _transport._syncParticipant(participant);
  }

  @override
  void onParticipantLeave(RoomCloudflareParticipantSnapshot participant) {
    _transport._removeParticipant(participant);
  }

  @override
  void onAudioUpdate(
    RoomCloudflareParticipantSnapshot participant,
    bool enabled,
  ) {
    _transport._emitParticipantKind(participant, 'audio', enabled);
  }

  @override
  void onVideoUpdate(
    RoomCloudflareParticipantSnapshot participant,
    bool enabled,
  ) {
    _transport._emitParticipantKind(participant, 'video', enabled);
  }

  @override
  void onScreenShareUpdate(
    RoomCloudflareParticipantSnapshot participant,
    bool enabled,
  ) {
    _transport._emitParticipantKind(participant, 'screen', enabled);
  }

  @override
  void onParticipantsSync(
      List<RoomCloudflareParticipantSnapshot> participants) {
    _transport._syncParticipants(participants);
  }
}

Future<RoomCloudflareRealtimeKitClientAdapter>
    _defaultCloudflareRealtimeKitClientFactory({
  required String authToken,
  String? displayName,
  bool enableAudio = false,
  bool enableVideo = false,
  String baseDomain = 'dyte.io',
}) async {
  final platform = RtkClientPlatform.instance;
  await platform.init(
    RtkMeetingInfo(
      authToken: authToken,
      baseDomain: baseDomain,
      displayName: displayName ?? 'EdgeBase Flutter',
      enableAudio: enableAudio,
      enableVideo: enableVideo,
    ),
  );
  return _RtkPlatformCloudflareClientAdapter(platform);
}

class _RtkPlatformCloudflareClientAdapter
    implements RoomCloudflareRealtimeKitClientAdapter {
  final RtkClientPlatform _platform;
  final List<RoomCloudflareParticipantListener> _listeners =
      <RoomCloudflareParticipantListener>[];
  late final _RtkPlatformParticipantsListener _participantBridge =
      _RtkPlatformParticipantsListener(_listeners);

  _RtkPlatformCloudflareClientAdapter(this._platform);

  @override
  Future<void> joinRoom() async {
    _platform.addParticipantsEventListener(_participantBridge);
    await _platform.joinRoom();
  }

  @override
  Future<void> leaveRoom() async {
    _platform.removeParticipantsEventListener(_participantBridge);
    await _platform.leaveRoom();
    await _platform.cleanNativeParticipantsEventListener();
  }

  @override
  Future<void> enableAudio() => _waitForResult(
        (onResult) => _platform.localUser.enableAudio(onResult: onResult),
      );

  @override
  Future<void> disableAudio() => _waitForResult(
        (onResult) => _platform.localUser.disableAudio(onResult: onResult),
      );

  @override
  Future<void> enableVideo() => _waitForResult(
        (onResult) => _platform.localUser.enableVideo(onResult: onResult),
      );

  @override
  Future<void> disableVideo() => _waitForResult(
        (onResult) => _platform.localUser.disableVideo(onResult: onResult),
      );

  @override
  Future<void> enableScreenShare() async {
    _platform.localUser.enableScreenShare();
  }

  @override
  Future<void> disableScreenShare() async {
    _platform.localUser.disableScreenShare();
  }

  @override
  Future<void> setAudioDevice(String deviceId) async {
    final devices = await _platform.localUser.getAudioDevices();
    final device = devices.where((entry) => entry.id == deviceId).firstOrNull;
    if (device == null) {
      throw StateError('Unknown audio input device: $deviceId');
    }
    await _platform.localUser.setAudioDevice(device);
  }

  @override
  Future<void> setVideoDevice(String deviceId) async {
    final devices = await _platform.localUser.getVideoDevices();
    final device = devices.where((entry) => entry.id == deviceId).firstOrNull;
    if (device == null) {
      throw StateError('Unknown video input device: $deviceId');
    }
    await _platform.localUser.setVideoDevice(device);
  }

  @override
  RoomCloudflareParticipantSnapshot get localParticipant =>
      _snapshotFromMeetingParticipant(_platform.localUser);

  @override
  List<RoomCloudflareParticipantSnapshot> get joinedParticipants =>
      _platform.participants.joined
          .map(_snapshotFromMeetingParticipant)
          .toList(growable: false);

  @override
  Object? buildView(
    RoomCloudflareParticipantSnapshot participant,
    String kind, {
    bool isSelf = false,
  }) {
    if (kind == 'video') {
      if (isSelf) {
        return const VideoView(isSelfParticipant: true);
      }
      final handle = participant.participantHandle;
      if (handle is RtkMeetingParticipant) {
        return VideoView(meetingParticipant: handle);
      }
    }

    if (kind == 'screen') {
      final handle = participant.participantHandle;
      if (handle is RtkMeetingParticipant) {
        return ScreenshareView(handle);
      }
    }

    return null;
  }

  @override
  void addListener(RoomCloudflareParticipantListener listener) {
    _listeners.add(listener);
  }

  @override
  void removeListener(RoomCloudflareParticipantListener listener) {
    _listeners.remove(listener);
  }
}

class _RtkPlatformParticipantsListener extends RtkParticipantsEventListener {
  final List<RoomCloudflareParticipantListener> _listeners;

  _RtkPlatformParticipantsListener(this._listeners);

  @override
  void onParticipantJoin(RtkRemoteParticipant participant) {
    final snapshot = _snapshotFromMeetingParticipant(participant);
    for (final listener in List.of(_listeners)) {
      listener.onParticipantJoin(snapshot);
    }
  }

  @override
  void onParticipantLeave(RtkRemoteParticipant participant) {
    final snapshot = _snapshotFromMeetingParticipant(participant);
    for (final listener in List.of(_listeners)) {
      listener.onParticipantLeave(snapshot);
    }
  }

  @override
  void onAudioUpdate(RtkRemoteParticipant participant, bool isEnabled) {
    final snapshot = _snapshotFromMeetingParticipant(
      participant.copyWith(audioEnabled: isEnabled),
    );
    for (final listener in List.of(_listeners)) {
      listener.onAudioUpdate(snapshot, isEnabled);
    }
  }

  @override
  void onVideoUpdate(RtkRemoteParticipant participant, bool isEnabled) {
    final snapshot = _snapshotFromMeetingParticipant(
      participant.copyWith(videoEnabled: isEnabled),
    );
    for (final listener in List.of(_listeners)) {
      listener.onVideoUpdate(snapshot, isEnabled);
    }
  }

  @override
  void onScreenShareUpdate(RtkRemoteParticipant participant, bool isEnabled) {
    final snapshot = _snapshotFromMeetingParticipant(
      participant.copyWith(screenShareEnabled: isEnabled),
    );
    for (final listener in List.of(_listeners)) {
      listener.onScreenShareUpdate(snapshot, isEnabled);
    }
  }

  @override
  void onUpdate(RtkParticipants participants) {
    final snapshots = participants.joined
        .map(_snapshotFromMeetingParticipant)
        .toList(growable: false);
    for (final listener in List.of(_listeners)) {
      listener.onParticipantsSync(snapshots);
    }
  }
}

RoomCloudflareParticipantSnapshot _snapshotFromMeetingParticipant(
  RtkMeetingParticipant participant,
) {
  return RoomCloudflareParticipantSnapshot(
    id: participant.id,
    userId: participant.userId,
    name: participant.name,
    picture: participant.picture,
    customParticipantId: participant.customParticipantId,
    audioEnabled: participant.audioEnabled,
    videoEnabled: participant.videoEnabled,
    screenShareEnabled: participant.screenShareEnabled,
    participantHandle: participant,
  );
}

Future<void> _waitForResult(
  void Function(OnResult onResult) action,
) async {
  final completer = Completer<void>();
  action((error) {
    if (error != null) {
      completer.completeError(StateError(error.toString()));
      return;
    }
    if (!completer.isCompleted) {
      completer.complete();
    }
  });
  await completer.future.timeout(
    const Duration(seconds: 15),
    onTimeout: () => throw TimeoutException(
      'Timed out waiting for RealtimeKit media operation to complete.',
    ),
  );
}
