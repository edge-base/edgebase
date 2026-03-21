// RoomClient v2 — Client-side room connection for real-time multiplayer state.
//
//: Complete redesign from v1.
//   - 3 state areas: sharedState (all clients), playerState (per-player),
//     serverState (server-only, not sent)
//   - Client can only read + subscribe + send(). All writes are server-only.
//   - send() returns a Future resolved by requestId matching
//   - Subscription returns RoomSubscription with cancel()
//   - namespace + roomId identification (replaces single roomId)
//
// Usage:
//   final room = client.room('game', 'lobby-1');
//   await room.join();
//   room.onSharedState((state, changes) => print('shared: $state'));
//   final result = await room.send('SET_SCORE', {'score': 42});
//   room.leave();

import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:edgebase_core/src/generated/api_core.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:http/http.dart' as http;
import 'package:realtimekit_core_platform_interface/realtimekit_core_platform_interface.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'auth_refresh.dart';
import 'token_manager.dart';

part 'room_cloudflare_media.dart';
part 'room_p2p_media.dart';

const _roomExplicitLeaveCloseDelay = Duration(milliseconds: 40);

// ── Types ────────────────────────────────────────────────────────────────────

/// Options for RoomClient.
class RoomOptions {
  /// Auto-reconnect on disconnect (default: true).
  final bool autoReconnect;

  /// Max reconnect attempts (default: 10).
  final int maxReconnectAttempts;

  /// Base delay for reconnect backoff in ms (default: 1000).
  final int reconnectBaseDelay;

  /// Timeout for send() requests in ms (default: 10000).
  final int sendTimeout;

  const RoomOptions({
    this.autoReconnect = true,
    this.maxReconnectAttempts = 10,
    this.reconnectBaseDelay = 1000,
    this.sendTimeout = 10000,
  });
}

/// A subscription that can be cancelled.
class RoomSubscription {
  final void Function() _cancel;
  RoomSubscription(this._cancel);

  /// Cancel this subscription.
  void cancel() => _cancel();
}

/// Handler for shared/player state changes.
typedef StateHandler = void Function(
    Map<String, dynamic> state, Map<String, dynamic> changes);

/// Handler for server messages.
typedef MessageHandler = void Function(dynamic data);

/// Handler for errors.
typedef ErrorHandler = void Function(({String code, String message}) error);

/// Handler for kicked events.
typedef KickedHandler = void Function();

/// Handler for synced members.
typedef MembersSyncHandler = void Function(List<Map<String, dynamic>> members);

/// Handler for member events.
typedef MemberHandler = void Function(Map<String, dynamic> member);

/// Handler for member leave events.
typedef MemberLeaveHandler = void Function(
  Map<String, dynamic> member,
  String reason,
);

/// Handler for member state updates.
typedef MemberStateHandler = void Function(
  Map<String, dynamic> member,
  Map<String, dynamic> state,
);

/// Handler for signal events.
typedef SignalHandler = void Function(
  dynamic payload,
  Map<String, dynamic> meta,
);

/// Handler for any signal event.
typedef AnySignalHandler = void Function(
  String event,
  dynamic payload,
  Map<String, dynamic> meta,
);

/// Handler for media track events.
typedef MediaTrackHandler = void Function(
  Map<String, dynamic> track,
  Map<String, dynamic> member,
);

/// Handler for media state updates.
typedef MediaStateHandler = void Function(
  Map<String, dynamic> member,
  Map<String, dynamic> state,
);

/// Handler for media device updates.
typedef MediaDeviceHandler = void Function(
  Map<String, dynamic> member,
  Map<String, dynamic> change,
);
typedef RoomCloudflareRealtimeKitCreateSessionRequest = Map<String, dynamic>;
typedef RoomCloudflareRealtimeKitCreateSessionResponse = Map<String, dynamic>;
typedef RoomMediaTransportConnectPayload = Map<String, dynamic>;

class RoomMediaRemoteTrackEvent {
  final String kind;
  final Object? track;
  final Object? view;
  final String? providerSessionId;
  final String? participantId;
  final String? customParticipantId;
  final String? userId;
  final Map<String, dynamic>? participant;

  const RoomMediaRemoteTrackEvent({
    required this.kind,
    this.track,
    this.view,
    this.providerSessionId,
    this.participantId,
    this.customParticipantId,
    this.userId,
    this.participant,
  });
}

abstract class RoomMediaTransport {
  Future<String> connect([RoomMediaTransportConnectPayload? payload]);
  Future<Object?> enableAudio([Map<String, dynamic>? payload]);
  Future<Object?> enableVideo([Map<String, dynamic>? payload]);
  Future<Object?> startScreenShare([Map<String, dynamic>? payload]);
  Future<void> disableAudio();
  Future<void> disableVideo();
  Future<void> stopScreenShare();
  Future<void> setMuted(String kind, bool muted);
  Future<void> switchDevices(Map<String, dynamic> payload);
  RoomSubscription onRemoteTrack(
    void Function(RoomMediaRemoteTrackEvent event) handler,
  );
  String? getSessionId();
  Object? getPeerConnection();
  void destroy();
}

class RoomCloudflareRealtimeKitTransportOptions {
  final bool autoSubscribe;
  final String baseDomain;
  final RoomCloudflareRealtimeKitClientFactory? clientFactory;

  const RoomCloudflareRealtimeKitTransportOptions({
    this.autoSubscribe = true,
    this.baseDomain = 'dyte.io',
    this.clientFactory,
  });
}

abstract class RoomP2PMediaDevicesAdapter {
  Future<MediaStream> getUserMedia(Map<String, dynamic> mediaConstraints);
  Future<MediaStream> getDisplayMedia(Map<String, dynamic> mediaConstraints);
}

class RoomP2PMediaTransportOptions {
  final Map<String, dynamic>? rtcConfiguration;
  final Future<RTCPeerConnection> Function(
    Map<String, dynamic> configuration,
  )? peerConnectionFactory;
  final RoomP2PMediaDevicesAdapter? mediaDevices;
  final String signalPrefix;

  const RoomP2PMediaTransportOptions({
    this.rtcConfiguration,
    this.peerConnectionFactory,
    this.mediaDevices,
    this.signalPrefix = 'edgebase.media.p2p',
  });
}

class RoomMediaTransportOptions {
  final String provider;
  final RoomCloudflareRealtimeKitTransportOptions? cloudflareRealtimeKit;
  final RoomP2PMediaTransportOptions? p2p;

  const RoomMediaTransportOptions({
    this.provider = 'cloudflare_realtimekit',
    this.cloudflareRealtimeKit,
    this.p2p,
  });
}

/// Handler for reconnect lifecycle.
typedef ReconnectHandler = void Function(Map<String, dynamic> info);

/// Handler for connection state transitions.
typedef ConnectionStateHandler = void Function(String state);

// ── RoomClient v2 ────────────────────────────────────────────────────────────

/// Room client for ephemeral real-time state synchronisation (v2 protocol).
class RoomClient {
  final String _baseUrl;
  final TokenManager _tokenManager;
  final RoomOptions _options;

  /// Room namespace (e.g. 'game', 'chat').
  final String namespace;

  /// Room instance ID within the namespace.
  final String roomId;

  // ── State ──

  Map<String, dynamic> _sharedState = {};
  int _sharedVersion = 0;
  Map<String, dynamic> _playerState = {};
  int _playerVersion = 0;
  List<Map<String, dynamic>> _members = [];
  List<Map<String, dynamic>> _mediaMembers = [];
  String? _currentUserId;
  String? _currentConnectionId;
  String _connectionState = 'idle';
  Map<String, dynamic>? _reconnectInfo;

  // ── Connection ──

  WebSocketChannel? _channel;
  StreamSubscription<dynamic>? _subscription;
  bool _connected = false;
  bool _authenticated = false;
  bool _intentionallyLeft = false;
  bool _waitingForAuth = false;
  bool _joinRequested = false;
  int _reconnectAttempts = 0;
  Timer? _heartbeatTimer;
  Completer<void>? _authCompleter;
  StreamSubscription<TokenUser?>? _authStateSubscription;

  // ── Pending send() requests (requestId -> Completer + Timer) ──

  final Map<String, _PendingRequest> _pendingRequests = {};
  final Map<String, _PendingRequest> _pendingSignalRequests = {};
  final Map<String, _PendingRequest> _pendingAdminRequests = {};
  final Map<String, _PendingRequest> _pendingMemberStateRequests = {};
  final Map<String, _PendingRequest> _pendingMediaRequests = {};

  // ── Subscription handlers ──

  final List<StateHandler> _sharedStateHandlers = [];
  final List<StateHandler> _playerStateHandlers = [];
  final Map<String, List<MessageHandler>> _messageHandlers = {};
  final List<void Function(String messageType, dynamic data)>
      _allMessageHandlers = [];
  final List<ErrorHandler> _errorHandlers = [];
  final List<KickedHandler> _kickedHandlers = [];
  final List<MembersSyncHandler> _memberSyncHandlers = [];
  final List<MemberHandler> _memberJoinHandlers = [];
  final List<MemberLeaveHandler> _memberLeaveHandlers = [];
  final List<MemberStateHandler> _memberStateHandlers = [];
  final Map<String, List<SignalHandler>> _signalHandlers = {};
  final List<AnySignalHandler> _anySignalHandlers = [];
  final List<MediaTrackHandler> _mediaTrackHandlers = [];
  final List<MediaTrackHandler> _mediaTrackRemovedHandlers = [];
  final List<MediaStateHandler> _mediaStateHandlers = [];
  final List<MediaDeviceHandler> _mediaDeviceHandlers = [];
  final List<ReconnectHandler> _reconnectHandlers = [];
  final List<ConnectionStateHandler> _connectionStateHandlers = [];

  late final RoomStateNamespace state;
  late final RoomMetaNamespace meta;
  late final RoomSignalsNamespace signals;
  late final RoomMembersNamespace members;
  late final RoomAdminNamespace admin;
  late final RoomMediaNamespace media;
  late final RoomSessionNamespace session;

  RoomClient(
    this._baseUrl,
    this.namespace,
    this.roomId,
    this._tokenManager, {
    RoomOptions options = const RoomOptions(),
  }) : _options = options {
    state = RoomStateNamespace(this);
    meta = RoomMetaNamespace(this);
    signals = RoomSignalsNamespace(this);
    members = RoomMembersNamespace(this);
    admin = RoomAdminNamespace(this);
    media = RoomMediaNamespace(this);
    session = RoomSessionNamespace(this);
    _authStateSubscription = _tokenManager.onAuthStateChange.listen(
      _handleAuthStateChange,
    );
  }

  // ── State Accessors ──

  /// Get current shared state (read-only copy).
  Map<String, dynamic> getSharedState() =>
      Map<String, dynamic>.from(_sharedState);

  /// Get current player state (read-only copy).
  Map<String, dynamic> getPlayerState() =>
      Map<String, dynamic>.from(_playerState);

  // ── Metadata (HTTP, no WebSocket needed) ──

  /// Get room metadata without joining (HTTP GET).
  /// Returns developer-defined metadata set by room.setMetadata() on the server.
  Future<Map<String, dynamic>> getMetadata() {
    return RoomClient.getMetadataStatic(_baseUrl, namespace, roomId);
  }

  /// Static: Get room metadata without creating a RoomClient instance.
  /// Useful for lobby screens where you need room info before joining.
  static Future<Map<String, dynamic>> getMetadataStatic(
    String baseUrl,
    String namespace,
    String roomId,
  ) async {
    final url = '${baseUrl.replaceAll(RegExp(r'/$'), '')}'
        '${ApiPaths.GET_ROOM_METADATA}'
        '?namespace=${Uri.encodeComponent(namespace)}'
        '&id=${Uri.encodeComponent(roomId)}';
    final response = await http.get(Uri.parse(url));
    if (response.statusCode != 200) {
      throw Exception(
          'Failed to get room metadata: ${response.statusCode} ${response.reasonPhrase}');
    }
    return jsonDecode(response.body) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> _requestCloudflareRealtimeKitMedia(
    String path,
    String method, [
    Map<String, dynamic>? payload,
  ]) {
    return _requestRoomMedia('cloudflare_realtimekit', path, method, payload);
  }

  Future<Map<String, dynamic>> _requestRoomMedia(
    String providerPath,
    String path,
    String method, [
    Map<String, dynamic>? payload,
  ]) async {
    final token = await _tokenManager.getAccessToken(
      (refreshToken) => refreshAccessToken(_baseUrl, refreshToken),
    );
    if (token == null) {
      throw Exception('Authentication required');
    }

    final uri = Uri.parse(
      '${_baseUrl.replaceAll(RegExp(r'/$'), '')}/api/room/media/$providerPath/$path',
    ).replace(queryParameters: {
      'namespace': namespace,
      'id': roomId,
    });

    final headers = {
      'Authorization': 'Bearer $token',
      'Content-Type': 'application/json',
    };
    final response = switch (method) {
      'GET' => await http.get(uri, headers: headers),
      'PUT' => await http.put(
          uri,
          headers: headers,
          body: jsonEncode(payload ?? <String, dynamic>{}),
        ),
      _ => await http.post(
          uri,
          headers: headers,
          body: jsonEncode(payload ?? <String, dynamic>{}),
        ),
    };
    final decoded = response.body.isEmpty
        ? <String, dynamic>{}
        : (jsonDecode(response.body) as Map<String, dynamic>);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception(
        decoded['message'] ??
            'Room media request failed: ${response.statusCode}',
      );
    }

    return decoded;
  }

  // ── Connection Lifecycle ──

  /// Connect to the room, authenticate, and join.
  Future<void> join() async {
    _intentionallyLeft = false;
    _joinRequested = true;
    _setConnectionState(_reconnectInfo == null ? 'connecting' : 'reconnecting');
    if (_connected) return;
    await _establishConnection();
  }

  /// Leave the room and disconnect. Cleans up all pending requests.
  void leave() {
    _intentionallyLeft = true;
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;

    // Reject all pending send() requests
    for (final entry in _pendingRequests.entries) {
      entry.value.timer.cancel();
      entry.value.completer.completeError(
        Exception('Room left'),
      );
    }
    _pendingRequests.clear();
    _rejectPendingVoidRequests(_pendingSignalRequests, 'Room left');
    _rejectPendingVoidRequests(_pendingAdminRequests, 'Room left');
    _rejectPendingVoidRequests(_pendingMemberStateRequests, 'Room left');
    _rejectPendingVoidRequests(_pendingMediaRequests, 'Room left');

    final socket = _channel;
    if (socket != null) {
      _sendRaw({'type': 'leave'});
      unawaited(
        Future<void>.delayed(_roomExplicitLeaveCloseDelay, () async {
          await socket.sink.close();
        }),
      );
    }
    _subscription?.cancel();
    _channel = null;
    _connected = false;
    _authenticated = false;
    _joinRequested = false;
    _waitingForAuth = false;
    _sharedState = {};
    _sharedVersion = 0;
    _playerState = {};
    _playerVersion = 0;
    _members = [];
    _mediaMembers = [];
    _currentUserId = null;
    _currentConnectionId = null;
    _reconnectInfo = null;
    _setConnectionState('idle');
  }

  // ── Actions ──

  /// Send an action to the server.
  ///
  /// Returns a Future that resolves with the action result from the server.
  ///
  /// Example:
  /// ```dart
  /// final result = await room.send('SET_SCORE', {'score': 42});
  /// ```
  Future<dynamic> send(String actionType, [dynamic payload]) {
    if (!_connected || !_authenticated) {
      return Future.error(Exception('Not connected to room'));
    }

    final requestId = _generateRequestId();
    final completer = Completer<dynamic>();

    final timer = Timer(Duration(milliseconds: _options.sendTimeout), () {
      _pendingRequests.remove(requestId);
      if (!completer.isCompleted) {
        completer.completeError(
          Exception("Action '$actionType' timed out"),
        );
      }
    });

    _pendingRequests[requestId] = _PendingRequest(completer, timer);

    _sendRaw({
      'type': 'send',
      'actionType': actionType,
      'payload': payload ?? {},
      'requestId': requestId,
    });

    return completer.future;
  }

  // ── Subscriptions (v2 API) ──

  /// Subscribe to shared state changes.
  /// Called on full sync and on each shared_delta.
  RoomSubscription onSharedState(StateHandler handler) {
    _sharedStateHandlers.add(handler);
    return RoomSubscription(() {
      _sharedStateHandlers.remove(handler);
    });
  }

  /// Subscribe to player state changes.
  /// Called on full sync and on each player_delta.
  RoomSubscription onPlayerState(StateHandler handler) {
    _playerStateHandlers.add(handler);
    return RoomSubscription(() {
      _playerStateHandlers.remove(handler);
    });
  }

  /// Subscribe to messages of a specific type sent by room.sendMessage().
  ///
  /// Example:
  /// ```dart
  /// room.onMessage('game_over', (data) => print(data['winner']));
  /// ```
  RoomSubscription onMessage(String messageType, MessageHandler handler) {
    _messageHandlers.putIfAbsent(messageType, () => []);
    _messageHandlers[messageType]!.add(handler);
    return RoomSubscription(() {
      _messageHandlers[messageType]?.remove(handler);
    });
  }

  /// Subscribe to ALL messages regardless of type.
  RoomSubscription onAnyMessage(
      void Function(String messageType, dynamic data) handler) {
    _allMessageHandlers.add(handler);
    return RoomSubscription(() {
      _allMessageHandlers.remove(handler);
    });
  }

  /// Subscribe to errors.
  RoomSubscription onError(ErrorHandler handler) {
    _errorHandlers.add(handler);
    return RoomSubscription(() {
      _errorHandlers.remove(handler);
    });
  }

  /// Subscribe to kick events.
  RoomSubscription onKicked(KickedHandler handler) {
    _kickedHandlers.add(handler);
    return RoomSubscription(() {
      _kickedHandlers.remove(handler);
    });
  }

  RoomSubscription onMembersSync(MembersSyncHandler handler) {
    _memberSyncHandlers.add(handler);
    return RoomSubscription(() {
      _memberSyncHandlers.remove(handler);
    });
  }

  RoomSubscription onMemberJoin(MemberHandler handler) {
    _memberJoinHandlers.add(handler);
    return RoomSubscription(() {
      _memberJoinHandlers.remove(handler);
    });
  }

  RoomSubscription onMemberLeave(MemberLeaveHandler handler) {
    _memberLeaveHandlers.add(handler);
    return RoomSubscription(() {
      _memberLeaveHandlers.remove(handler);
    });
  }

  RoomSubscription onMemberStateChange(MemberStateHandler handler) {
    _memberStateHandlers.add(handler);
    return RoomSubscription(() {
      _memberStateHandlers.remove(handler);
    });
  }

  RoomSubscription onSignal(String event, SignalHandler handler) {
    _signalHandlers.putIfAbsent(event, () => []);
    _signalHandlers[event]!.add(handler);
    return RoomSubscription(() {
      _signalHandlers[event]?.remove(handler);
    });
  }

  RoomSubscription onAnySignal(AnySignalHandler handler) {
    _anySignalHandlers.add(handler);
    return RoomSubscription(() {
      _anySignalHandlers.remove(handler);
    });
  }

  RoomSubscription onMediaTrack(MediaTrackHandler handler) {
    _mediaTrackHandlers.add(handler);
    return RoomSubscription(() {
      _mediaTrackHandlers.remove(handler);
    });
  }

  RoomSubscription onMediaTrackRemoved(MediaTrackHandler handler) {
    _mediaTrackRemovedHandlers.add(handler);
    return RoomSubscription(() {
      _mediaTrackRemovedHandlers.remove(handler);
    });
  }

  RoomSubscription onMediaStateChange(MediaStateHandler handler) {
    _mediaStateHandlers.add(handler);
    return RoomSubscription(() {
      _mediaStateHandlers.remove(handler);
    });
  }

  RoomSubscription onMediaDeviceChange(MediaDeviceHandler handler) {
    _mediaDeviceHandlers.add(handler);
    return RoomSubscription(() {
      _mediaDeviceHandlers.remove(handler);
    });
  }

  RoomSubscription onReconnect(ReconnectHandler handler) {
    _reconnectHandlers.add(handler);
    return RoomSubscription(() {
      _reconnectHandlers.remove(handler);
    });
  }

  RoomSubscription onConnectionStateChange(ConnectionStateHandler handler) {
    _connectionStateHandlers.add(handler);
    return RoomSubscription(() {
      _connectionStateHandlers.remove(handler);
    });
  }

  List<Map<String, dynamic>> listMembers() => _cloneListOfMaps(_members);

  List<Map<String, dynamic>> listMediaMembers() =>
      _cloneListOfMaps(_mediaMembers);

  Future<void> sendSignal(
    String event, [
    dynamic payload,
    Map<String, dynamic>? options,
  ]) {
    if (!_connected || !_authenticated) {
      return Future.error(Exception('Not connected to room'));
    }

    final requestId = _generateRequestId();
    final completer = Completer<dynamic>();
    final timer = Timer(Duration(milliseconds: _options.sendTimeout), () {
      _pendingSignalRequests.remove(requestId);
      if (!completer.isCompleted) {
        completer.completeError(Exception("Signal '$event' timed out"));
      }
    });
    _pendingSignalRequests[requestId] = _PendingRequest(completer, timer);

    _sendRaw({
      'type': 'signal',
      'event': event,
      'payload': payload ?? {},
      if (options?['memberId'] != null) 'memberId': options!['memberId'],
      if (options?['includeSelf'] == true) 'includeSelf': true,
      'requestId': requestId,
    });

    return completer.future.then((_) => null);
  }

  Future<void> sendMemberState(Map<String, dynamic> state) {
    if (!_connected || !_authenticated) {
      return Future.error(Exception('Not connected to room'));
    }

    final requestId = _generateRequestId();
    final completer = Completer<dynamic>();
    final timer = Timer(Duration(milliseconds: _options.sendTimeout), () {
      _pendingMemberStateRequests.remove(requestId);
      if (!completer.isCompleted) {
        completer.completeError(Exception('Member state update timed out'));
      }
    });
    _pendingMemberStateRequests[requestId] = _PendingRequest(completer, timer);

    _sendRaw({
      'type': 'member_state',
      'state': state,
      'requestId': requestId,
    });

    return completer.future.then((_) => null);
  }

  Future<void> clearMemberState() {
    if (!_connected || !_authenticated) {
      return Future.error(Exception('Not connected to room'));
    }

    final requestId = _generateRequestId();
    final completer = Completer<dynamic>();
    final timer = Timer(Duration(milliseconds: _options.sendTimeout), () {
      _pendingMemberStateRequests.remove(requestId);
      if (!completer.isCompleted) {
        completer.completeError(Exception('Member state clear timed out'));
      }
    });
    _pendingMemberStateRequests[requestId] = _PendingRequest(completer, timer);

    _sendRaw({
      'type': 'member_state_clear',
      'requestId': requestId,
    });

    return completer.future.then((_) => null);
  }

  Future<void> sendAdmin(
    String operation,
    String memberId, [
    Map<String, dynamic>? payload,
  ]) {
    if (!_connected || !_authenticated) {
      return Future.error(Exception('Not connected to room'));
    }

    final requestId = _generateRequestId();
    final completer = Completer<dynamic>();
    final timer = Timer(Duration(milliseconds: _options.sendTimeout), () {
      _pendingAdminRequests.remove(requestId);
      if (!completer.isCompleted) {
        completer.completeError(Exception("Admin '$operation' timed out"));
      }
    });
    _pendingAdminRequests[requestId] = _PendingRequest(completer, timer);

    _sendRaw({
      'type': 'admin',
      'operation': operation,
      'memberId': memberId,
      if (payload != null) 'payload': payload,
      'requestId': requestId,
    });

    return completer.future.then((_) => null);
  }

  Future<void> sendMedia(
    String operation,
    String kind, [
    Map<String, dynamic>? payload,
  ]) {
    if (!_connected || !_authenticated) {
      return Future.error(Exception('Not connected to room'));
    }

    final requestId = _generateRequestId();
    final completer = Completer<dynamic>();
    final timer = Timer(Duration(milliseconds: _options.sendTimeout), () {
      _pendingMediaRequests.remove(requestId);
      if (!completer.isCompleted) {
        completer.completeError(
          Exception("Media '$operation:$kind' timed out"),
        );
      }
    });
    _pendingMediaRequests[requestId] = _PendingRequest(completer, timer);

    _sendRaw({
      'type': 'media',
      'operation': operation,
      'kind': kind,
      if (payload != null) 'payload': payload,
      'requestId': requestId,
    });

    return completer.future.then((_) => null);
  }

  Future<void> switchMediaDevices(Map<String, dynamic> payload) async {
    if (payload['audioInputId'] is String && payload['audioInputId'] != '') {
      await sendMedia('device', 'audio', {
        'deviceId': payload['audioInputId'],
      });
    }
    if (payload['videoInputId'] is String && payload['videoInputId'] != '') {
      await sendMedia('device', 'video', {
        'deviceId': payload['videoInputId'],
      });
    }
    if (payload['screenInputId'] is String && payload['screenInputId'] != '') {
      await sendMedia('device', 'screen', {
        'deviceId': payload['screenInputId'],
      });
    }
  }

  // ── Private: Connection ──

  Future<void> _establishConnection() async {
    final token = await _tokenManager.getAccessToken(
      (refreshToken) => refreshAccessToken(_baseUrl, refreshToken),
    );
    if (token == null || token.isEmpty) {
      _waitingForAuth = _joinRequested;
      return;
    }

    final wsUrl = _baseUrl
        .replaceFirst('https://', 'wss://')
        .replaceFirst('http://', 'ws://');
    try {
      _channel = WebSocketChannel.connect(
        Uri.parse(
            '$wsUrl/api/room?namespace=${Uri.encodeComponent(namespace)}&id=${Uri.encodeComponent(roomId)}'),
      );
    } catch (error) {
      throw Exception('Room WebSocket connection error: $error');
    }
    _connected = true;
    _reconnectAttempts = 0;

    _authCompleter = Completer<void>();

    _subscription = _channel!.stream.listen(
      (data) => _handleRaw(data as String),
      onDone: () {
        if (!_authenticated && !(_authCompleter?.isCompleted ?? true)) {
          _authCompleter?.completeError(
            Exception('Room WebSocket connection error'),
          );
        }
        _onDisconnected();
      },
      onError: (error) {
        if (!_authenticated && !(_authCompleter?.isCompleted ?? true)) {
          _authCompleter?.completeError(
            Exception('Room WebSocket connection error: $error'),
          );
        }
        _onDisconnected();
      },
      cancelOnError: true,
    );

    // Send auth
    _sendRaw({'type': 'auth', 'token': token});

    // Wait for auth_success
    await _authCompleter!.future.timeout(
      const Duration(seconds: 10),
      onTimeout: () => throw Exception('Room auth timeout'),
    );

    _startHeartbeat();
  }

  // ── Private: Message Handling ──

  void _handleRaw(String data) {
    late Map<String, dynamic> msg;
    try {
      msg = jsonDecode(data) as Map<String, dynamic>;
    } catch (_) {
      return;
    }
    final type = msg['type'] as String? ?? '';

    if (type == 'auth_success' || type == 'auth_refreshed') {
      _authenticated = true;
      _waitingForAuth = false;
      _currentUserId = msg['userId'] as String?;
      _currentConnectionId = msg['connectionId'] as String?;

      if (type == 'auth_success') {
        _sendRaw({
          'type': 'join',
          'lastSharedState': _sharedState,
          'lastSharedVersion': _sharedVersion,
          'lastPlayerState': _playerState,
          'lastPlayerVersion': _playerVersion,
        });
        if (!(_authCompleter?.isCompleted ?? true)) {
          _authCompleter?.complete();
        }
      }
      return;
    }

    if (type == 'error' && !_authenticated) {
      _waitingForAuth = _joinRequested;
      _authCompleter?.completeError(Exception(msg['message']));
      return;
    }

    // Dispatch message types
    switch (type) {
      case 'sync':
        _handleSync(msg);
        break;
      case 'shared_delta':
        _handleSharedDelta(msg);
        break;
      case 'player_delta':
        _handlePlayerDelta(msg);
        break;
      case 'action_result':
        _handleActionResult(msg);
        break;
      case 'action_error':
        _handleActionError(msg);
        break;
      case 'message':
        _handleServerMessage(msg);
        break;
      case 'signal':
        _handleSignal(msg);
        break;
      case 'signal_sent':
        _resolvePendingVoidRequest(_pendingSignalRequests, msg['requestId']);
        break;
      case 'signal_error':
        _rejectPendingVoidRequest(
          _pendingSignalRequests,
          msg['requestId'],
          msg['message'] as String? ?? 'Signal error',
        );
        break;
      case 'members_sync':
        _handleMembersSync(msg);
        break;
      case 'member_join':
        _handleMemberJoin(msg);
        break;
      case 'member_leave':
        _handleMemberLeave(msg);
        break;
      case 'member_state':
        _handleMemberState(msg);
        break;
      case 'member_state_error':
        _rejectPendingVoidRequest(
          _pendingMemberStateRequests,
          msg['requestId'],
          msg['message'] as String? ?? 'Member state error',
        );
        break;
      case 'admin_result':
        _resolvePendingVoidRequest(_pendingAdminRequests, msg['requestId']);
        break;
      case 'admin_error':
        _rejectPendingVoidRequest(
          _pendingAdminRequests,
          msg['requestId'],
          msg['message'] as String? ?? 'Admin error',
        );
        break;
      case 'media_sync':
        _handleMediaSync(msg);
        break;
      case 'media_track':
        _handleMediaTrack(msg);
        break;
      case 'media_track_removed':
        _handleMediaTrackRemoved(msg);
        break;
      case 'media_state':
        _handleMediaState(msg);
        break;
      case 'media_device':
        _handleMediaDevice(msg);
        break;
      case 'media_result':
        _resolvePendingVoidRequest(_pendingMediaRequests, msg['requestId']);
        break;
      case 'media_error':
        _rejectPendingVoidRequest(
          _pendingMediaRequests,
          msg['requestId'],
          msg['message'] as String? ?? 'Media error',
        );
        break;
      case 'kicked':
        _handleKicked();
        break;
      case 'error':
        _handleError(msg);
        break;
      case 'pong':
        // Heartbeat response - no action needed
        break;
    }
  }

  void _handleSync(Map<String, dynamic> msg) {
    _sharedState = msg['sharedState'] as Map<String, dynamic>? ?? {};
    _sharedVersion = msg['sharedVersion'] as int? ?? 0;
    _playerState = msg['playerState'] as Map<String, dynamic>? ?? {};
    _playerVersion = msg['playerVersion'] as int? ?? 0;
    _setConnectionState('connected');

    if (_reconnectInfo != null) {
      final reconnectInfo = Map<String, dynamic>.from(_reconnectInfo!);
      for (final handler in _reconnectHandlers) {
        handler(_cloneMap(reconnectInfo));
      }
      _reconnectInfo = null;
    }

    // Notify handlers with full state as changes
    for (final handler in _sharedStateHandlers) {
      handler(_sharedState, _sharedState);
    }
    for (final handler in _playerStateHandlers) {
      handler(_playerState, _playerState);
    }
  }

  void _handleSharedDelta(Map<String, dynamic> msg) {
    final delta = msg['delta'] as Map<String, dynamic>? ?? {};
    _sharedVersion = msg['version'] as int? ?? 0;

    // Apply delta to local state
    for (final entry in delta.entries) {
      _deepSet(_sharedState, entry.key, entry.value);
    }

    for (final handler in _sharedStateHandlers) {
      handler(_sharedState, delta);
    }
  }

  void _handlePlayerDelta(Map<String, dynamic> msg) {
    final delta = msg['delta'] as Map<String, dynamic>? ?? {};
    _playerVersion = msg['version'] as int? ?? 0;

    // Apply delta to local player state
    for (final entry in delta.entries) {
      _deepSet(_playerState, entry.key, entry.value);
    }

    for (final handler in _playerStateHandlers) {
      handler(_playerState, delta);
    }
  }

  void _handleActionResult(Map<String, dynamic> msg) {
    final requestId = msg['requestId'] as String?;
    if (requestId == null) return;
    final pending = _pendingRequests.remove(requestId);
    if (pending != null) {
      pending.timer.cancel();
      if (!pending.completer.isCompleted) {
        pending.completer.complete(msg['result']);
      }
    }
  }

  void _handleActionError(Map<String, dynamic> msg) {
    final requestId = msg['requestId'] as String?;
    if (requestId == null) return;
    final pending = _pendingRequests.remove(requestId);
    if (pending != null) {
      pending.timer.cancel();
      if (!pending.completer.isCompleted) {
        pending.completer.completeError(
          Exception(msg['message'] as String? ?? 'Action error'),
        );
      }
    }
  }

  void _handleServerMessage(Map<String, dynamic> msg) {
    final messageType = msg['messageType'] as String? ?? '';
    final data = msg['data'];

    // Type-specific handlers
    final handlers = _messageHandlers[messageType];
    if (handlers != null) {
      for (final handler in handlers) {
        handler(data);
      }
    }

    // All-message handlers
    for (final handler in _allMessageHandlers) {
      handler(messageType, data);
    }
  }

  void _handleSignal(Map<String, dynamic> msg) {
    final event = msg['event'] as String? ?? '';
    final payload = msg['payload'];
    final meta = _cloneMap(_asMap(msg['meta']));

    final handlers = _signalHandlers[event];
    if (handlers != null) {
      for (final handler in handlers) {
        handler(payload, _cloneMap(meta));
      }
    }
    for (final handler in _anySignalHandlers) {
      handler(event, payload, _cloneMap(meta));
    }
  }

  void _handleMembersSync(Map<String, dynamic> msg) {
    final nextMembers = _normalizeMembers(msg['members']);
    _members = nextMembers;
    _mergeMembersIntoMedia(nextMembers);

    for (final handler in _memberSyncHandlers) {
      handler(_cloneListOfMaps(_members));
    }
  }

  void _handleMemberJoin(Map<String, dynamic> msg) {
    final member = _normalizeMember(msg['member']);
    if (member == null) return;

    _upsertMember(member);
    for (final handler in _memberJoinHandlers) {
      handler(_cloneMap(member));
    }
  }

  void _handleMemberLeave(Map<String, dynamic> msg) {
    final member = _normalizeMember(msg['member']);
    if (member == null) return;

    _removeMember(member['memberId'] as String);
    final reason = msg['reason'] as String? ?? 'leave';
    for (final handler in _memberLeaveHandlers) {
      handler(_cloneMap(member), reason);
    }
  }

  void _handleMemberState(Map<String, dynamic> msg) {
    final member = _normalizeMember(msg['member']);
    if (member == null) return;
    final state = _cloneMap(_asMap(msg['state']));
    member['state'] = state;
    _upsertMember(member);

    _resolvePendingVoidRequest(_pendingMemberStateRequests, msg['requestId']);

    for (final handler in _memberStateHandlers) {
      handler(_cloneMap(member), _cloneMap(state));
    }
  }

  void _handleMediaSync(Map<String, dynamic> msg) {
    _mediaMembers = _normalizeMediaMembers(msg['members']);
    for (final mediaMember in _mediaMembers) {
      final member = _asMap(mediaMember['member']);
      if (member.isNotEmpty) {
        _upsertMember(_cloneMap(member));
      }
    }
  }

  void _handleMediaTrack(Map<String, dynamic> msg) {
    final member = _normalizeMember(msg['member']);
    final track = _normalizeTrack(msg['track']);
    if (member == null || track == null) return;

    final mediaMember = _ensureMediaMember(member);
    final tracks = _asListOfMaps(mediaMember['tracks']);
    final existingIndex = tracks.indexWhere(
      (entry) => entry['kind'] == track['kind'],
    );
    if (existingIndex >= 0) {
      tracks[existingIndex] = track;
    } else {
      tracks.add(track);
    }
    mediaMember['tracks'] = tracks;
    _setPublishedState(mediaMember, track, true);

    for (final handler in _mediaTrackHandlers) {
      handler(_cloneMap(track), _cloneMap(member));
    }
  }

  void _handleMediaTrackRemoved(Map<String, dynamic> msg) {
    final member = _normalizeMember(msg['member']);
    final track = _normalizeTrack(msg['track']);
    if (member == null || track == null) return;

    final mediaMember = _ensureMediaMember(member);
    final tracks = _asListOfMaps(mediaMember['tracks'])
      ..removeWhere((entry) => entry['kind'] == track['kind']);
    mediaMember['tracks'] = tracks;
    _setPublishedState(mediaMember, track, false);

    for (final handler in _mediaTrackRemovedHandlers) {
      handler(_cloneMap(track), _cloneMap(member));
    }
  }

  void _handleMediaState(Map<String, dynamic> msg) {
    final member = _normalizeMember(msg['member']);
    if (member == null) return;
    final state = _cloneMap(_asMap(msg['state']));
    final mediaMember = _ensureMediaMember(member);
    mediaMember['state'] = state;

    for (final handler in _mediaStateHandlers) {
      handler(_cloneMap(member), _cloneMap(state));
    }
  }

  void _handleMediaDevice(Map<String, dynamic> msg) {
    final member = _normalizeMember(msg['member']);
    if (member == null) return;
    final kind = msg['kind'] as String?;
    final deviceId = msg['deviceId'] as String?;
    if (kind == null || deviceId == null) return;

    final mediaMember = _ensureMediaMember(member);
    final state = _asMap(mediaMember['state']);
    final kindState = _asMap(state[kind]);
    kindState['deviceId'] = deviceId;
    state[kind] = kindState;
    mediaMember['state'] = state;

    final change = {
      'kind': kind,
      'deviceId': deviceId,
    };
    for (final handler in _mediaDeviceHandlers) {
      handler(_cloneMap(member), _cloneMap(change));
    }
  }

  void _handleKicked() {
    _setConnectionState('kicked');
    for (final handler in _kickedHandlers) {
      handler();
    }
    // Don't auto-reconnect after being kicked
    _intentionallyLeft = true;
  }

  void _handleError(Map<String, dynamic> msg) {
    for (final handler in _errorHandlers) {
      handler((
        code: msg['code'] as String? ?? '',
        message: msg['message'] as String? ?? '',
      ));
    }
  }

  // ── Private: Helpers ──

  void _sendRaw(Map<String, dynamic> msg) {
    if (_connected) {
      _channel?.sink.add(jsonEncode(msg));
    }
  }

  void _onDisconnected() {
    _connected = false;
    _authenticated = false;
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;
    _setConnectionState('disconnected');

    if (!_intentionallyLeft) {
      _rejectAllPendingRequests('WebSocket connection lost');
    }

    if (!_intentionallyLeft &&
        !_waitingForAuth &&
        _options.autoReconnect &&
        _reconnectAttempts < _options.maxReconnectAttempts) {
      _scheduleReconnect();
    }
  }

  void _scheduleReconnect() {
    final baseDelay =
        _options.reconnectBaseDelay * pow(2, _reconnectAttempts).toInt();
    final jitter = (baseDelay * 0.25 * Random().nextDouble()).round();
    final delay = baseDelay + jitter;
    _reconnectAttempts++;
    _reconnectInfo = {'attempt': _reconnectAttempts};
    _setConnectionState('reconnecting');
    Future.delayed(Duration(milliseconds: min(delay, 30000)), () {
      _establishConnection().catchError((_) {});
    });
  }

  void _startHeartbeat() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      if (_connected) _sendRaw({'type': 'ping'});
    });
  }

  /// Dispose the client, cleaning up all resources.
  void dispose() {
    leave();
    _authStateSubscription?.cancel();
    _sharedStateHandlers.clear();
    _playerStateHandlers.clear();
    _messageHandlers.clear();
    _allMessageHandlers.clear();
    _errorHandlers.clear();
    _kickedHandlers.clear();
    _memberSyncHandlers.clear();
    _memberJoinHandlers.clear();
    _memberLeaveHandlers.clear();
    _memberStateHandlers.clear();
    _signalHandlers.clear();
    _anySignalHandlers.clear();
    _mediaTrackHandlers.clear();
    _mediaTrackRemovedHandlers.clear();
    _mediaStateHandlers.clear();
    _mediaDeviceHandlers.clear();
    _reconnectHandlers.clear();
    _connectionStateHandlers.clear();
  }

  /// Destroy the room client, cleaning up all handlers and subscriptions.
  void destroy() {
    leave();
    _authStateSubscription?.cancel();
    _authStateSubscription = null;
    _sharedStateHandlers.clear();
    _playerStateHandlers.clear();
    _messageHandlers.clear();
    _allMessageHandlers.clear();
    _errorHandlers.clear();
    _kickedHandlers.clear();
    _memberSyncHandlers.clear();
    _memberJoinHandlers.clear();
    _memberLeaveHandlers.clear();
    _memberStateHandlers.clear();
    _signalHandlers.clear();
    _anySignalHandlers.clear();
    _mediaTrackHandlers.clear();
    _mediaTrackRemovedHandlers.clear();
    _mediaStateHandlers.clear();
    _mediaDeviceHandlers.clear();
    _reconnectHandlers.clear();
    _connectionStateHandlers.clear();
  }

  void _handleAuthStateChange(TokenUser? user) {
    if (user == null) {
      _rejectAllPendingRequests('Auth state lost');
      if (_channel != null) {
        final socket = _channel;
        _sendRaw({'type': 'leave'});
        _channel = null;
        _connected = false;
        _authenticated = false;
        _waitingForAuth = _joinRequested;
        _setConnectionState('auth_lost');
        unawaited(
          Future<void>.delayed(_roomExplicitLeaveCloseDelay, () async {
            await socket?.sink.close();
          }),
        );
        return;
      }
      _authenticated = false;
      _waitingForAuth = _joinRequested;
      _setConnectionState('auth_lost');
      return;
    }

    _waitingForAuth = false;
    if (_joinRequested && !_connected) {
      unawaited(_establishConnection());
      return;
    }

    if (_connected && !_authenticated) {
      _sendRaw({'type': 'auth', 'token': _tokenManager.accessToken ?? ''});
    }
  }

  void _setConnectionState(String nextState) {
    if (_connectionState == nextState) return;
    _connectionState = nextState;
    for (final handler in _connectionStateHandlers) {
      handler(nextState);
    }
  }

  void _resolvePendingVoidRequest(
    Map<String, _PendingRequest> pendingRequests,
    dynamic requestId,
  ) {
    if (requestId is! String) return;
    final pending = pendingRequests.remove(requestId);
    if (pending == null) return;
    pending.timer.cancel();
    if (!pending.completer.isCompleted) {
      pending.completer.complete(null);
    }
  }

  void _rejectPendingVoidRequest(
    Map<String, _PendingRequest> pendingRequests,
    dynamic requestId,
    String message,
  ) {
    if (requestId is! String) return;
    final pending = pendingRequests.remove(requestId);
    if (pending == null) return;
    pending.timer.cancel();
    if (!pending.completer.isCompleted) {
      pending.completer.completeError(Exception(message));
    }
  }

  void _rejectAllPendingRequests(String message) {
    for (final entry in _pendingRequests.entries) {
      entry.value.timer.cancel();
      if (!entry.value.completer.isCompleted) {
        entry.value.completer.completeError(Exception(message));
      }
    }
    _pendingRequests.clear();
    _rejectPendingVoidRequests(_pendingSignalRequests, message);
    _rejectPendingVoidRequests(_pendingAdminRequests, message);
    _rejectPendingVoidRequests(_pendingMemberStateRequests, message);
    _rejectPendingVoidRequests(_pendingMediaRequests, message);
  }

  void _rejectPendingVoidRequests(
    Map<String, _PendingRequest> pendingRequests,
    String message,
  ) {
    for (final pending in pendingRequests.values) {
      pending.timer.cancel();
      if (!pending.completer.isCompleted) {
        pending.completer.completeError(Exception(message));
      }
    }
    pendingRequests.clear();
  }

  void _upsertMember(Map<String, dynamic> member) {
    final memberId = member['memberId'] as String?;
    if (memberId == null || memberId.isEmpty) return;

    final index = _members.indexWhere((entry) => entry['memberId'] == memberId);
    if (index >= 0) {
      _members[index] = member;
    } else {
      _members.add(member);
    }
    _mergeMembersIntoMedia(_members);
  }

  void _removeMember(String memberId) {
    _members.removeWhere((member) => member['memberId'] == memberId);
    _mediaMembers.removeWhere(
      (mediaMember) => _asMap(mediaMember['member'])['memberId'] == memberId,
    );
  }

  Map<String, dynamic> _ensureMediaMember(Map<String, dynamic> member) {
    _upsertMember(member);
    final memberId = member['memberId'] as String;
    final index = _mediaMembers.indexWhere(
      (entry) => _asMap(entry['member'])['memberId'] == memberId,
    );
    if (index >= 0) {
      _mediaMembers[index]['member'] = _cloneMap(member);
      return _mediaMembers[index];
    }

    final mediaMember = <String, dynamic>{
      'member': _cloneMap(member),
      'state': <String, dynamic>{},
      'tracks': <Map<String, dynamic>>[],
    };
    _mediaMembers.add(mediaMember);
    return mediaMember;
  }

  void _mergeMembersIntoMedia(List<Map<String, dynamic>> members) {
    for (final member in members) {
      final memberId = member['memberId'] as String?;
      if (memberId == null) continue;
      final index = _mediaMembers.indexWhere(
        (entry) => _asMap(entry['member'])['memberId'] == memberId,
      );
      if (index >= 0) {
        _mediaMembers[index]['member'] = _cloneMap(member);
      }
    }
  }

  void _setPublishedState(
    Map<String, dynamic> mediaMember,
    Map<String, dynamic> track,
    bool published,
  ) {
    final kind = track['kind'] as String?;
    if (kind == null || kind.isEmpty) return;

    final state = _asMap(mediaMember['state']);
    final kindState = _asMap(state[kind]);
    kindState['published'] = published;
    kindState['muted'] = track['muted'] == true;
    if (published) {
      if (track['trackId'] != null) kindState['trackId'] = track['trackId'];
      if (track['deviceId'] != null) kindState['deviceId'] = track['deviceId'];
      if (track['publishedAt'] != null) {
        kindState['publishedAt'] = track['publishedAt'];
      }
      if (track['adminDisabled'] != null) {
        kindState['adminDisabled'] = track['adminDisabled'];
      }
    } else {
      kindState.remove('trackId');
      kindState.remove('publishedAt');
      kindState['adminDisabled'] = track['adminDisabled'] == true;
    }
    state[kind] = kindState;
    mediaMember['state'] = state;
  }

  static final _random = Random();

  static String _generateRequestId() {
    final timestamp = DateTime.now().millisecondsSinceEpoch;
    final suffix = _random.nextInt(0xFFFFFF).toRadixString(36);
    return 'req-$timestamp-$suffix';
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

void _deepSet(Map<String, dynamic> obj, String path, dynamic value) {
  final parts = path.split('.');
  Map<String, dynamic> current = obj;
  for (int i = 0; i < parts.length - 1; i++) {
    if (current[parts[i]] is! Map<String, dynamic>) {
      current[parts[i]] = <String, dynamic>{};
    }
    current = current[parts[i]] as Map<String, dynamic>;
  }
  final lastKey = parts.last;
  if (value == null) {
    current.remove(lastKey);
  } else {
    current[lastKey] = value;
  }
}

/// Internal helper for pending send() requests.
class _PendingRequest {
  final Completer<dynamic> completer;
  final Timer timer;
  _PendingRequest(this.completer, this.timer);
}

Map<String, dynamic> _cloneMap(Map<String, dynamic> value) {
  if (value.isEmpty) return <String, dynamic>{};
  return jsonDecode(jsonEncode(value)) as Map<String, dynamic>;
}

List<Map<String, dynamic>> _cloneListOfMaps(List<Map<String, dynamic>> value) {
  if (value.isEmpty) return <Map<String, dynamic>>[];
  return (jsonDecode(jsonEncode(value)) as List<dynamic>)
      .cast<Map<String, dynamic>>();
}

Map<String, dynamic> _asMap(dynamic value) {
  if (value is Map<String, dynamic>) {
    return Map<String, dynamic>.from(value);
  }
  if (value is Map) {
    return value.map(
      (key, mapValue) => MapEntry(key.toString(), mapValue),
    );
  }
  return <String, dynamic>{};
}

List<Map<String, dynamic>> _asListOfMaps(dynamic value) {
  if (value is! List) return <Map<String, dynamic>>[];
  return value.map((entry) => _asMap(entry)).toList();
}

Map<String, dynamic>? _normalizeMember(dynamic value) {
  final member = _asMap(value);
  final memberId = member['memberId'] as String?;
  final userId = member['userId'] as String?;
  if (memberId == null || userId == null) return null;
  return {
    'memberId': memberId,
    'userId': userId,
    if (member['connectionId'] != null) 'connectionId': member['connectionId'],
    if (member['connectionCount'] != null)
      'connectionCount': member['connectionCount'],
    if (member['role'] != null) 'role': member['role'],
    'state': _cloneMap(_asMap(member['state'])),
  };
}

List<Map<String, dynamic>> _normalizeMembers(dynamic value) {
  if (value is! List) return <Map<String, dynamic>>[];
  final members = <Map<String, dynamic>>[];
  for (final entry in value) {
    final member = _normalizeMember(entry);
    if (member != null) members.add(member);
  }
  return members;
}

Map<String, dynamic>? _normalizeTrack(dynamic value) {
  final track = _asMap(value);
  final kind = track['kind'] as String?;
  if (kind == null || kind.isEmpty) return null;
  return {
    'kind': kind,
    if (track['trackId'] != null) 'trackId': track['trackId'],
    if (track['deviceId'] != null) 'deviceId': track['deviceId'],
    'muted': track['muted'] == true,
    if (track['publishedAt'] != null) 'publishedAt': track['publishedAt'],
    if (track['adminDisabled'] != null) 'adminDisabled': track['adminDisabled'],
  };
}

List<Map<String, dynamic>> _normalizeTracks(dynamic value) {
  if (value is! List) return <Map<String, dynamic>>[];
  final tracks = <Map<String, dynamic>>[];
  for (final entry in value) {
    final track = _normalizeTrack(entry);
    if (track != null) tracks.add(track);
  }
  return tracks;
}

List<Map<String, dynamic>> _normalizeMediaMembers(dynamic value) {
  if (value is! List) return <Map<String, dynamic>>[];
  final mediaMembers = <Map<String, dynamic>>[];
  for (final entry in value) {
    final raw = _asMap(entry);
    final member = _normalizeMember(raw['member']);
    if (member == null) continue;
    mediaMembers.add({
      'member': member,
      'state': _cloneMap(_asMap(raw['state'])),
      'tracks': _normalizeTracks(raw['tracks']),
    });
  }
  return mediaMembers;
}

class RoomStateNamespace {
  final RoomClient _client;
  RoomStateNamespace(this._client);

  Map<String, dynamic> getShared() => _client.getSharedState();
  Map<String, dynamic> getMine() => _client.getPlayerState();
  RoomSubscription onSharedChange(StateHandler handler) =>
      _client.onSharedState(handler);
  RoomSubscription onMineChange(StateHandler handler) =>
      _client.onPlayerState(handler);
  Future<dynamic> send(String actionType, [dynamic payload]) =>
      _client.send(actionType, payload);
}

class RoomMetaNamespace {
  final RoomClient _client;
  RoomMetaNamespace(this._client);

  Future<Map<String, dynamic>> get() => _client.getMetadata();
}

class RoomSignalsNamespace {
  final RoomClient _client;
  RoomSignalsNamespace(this._client);

  Future<void> send(
    String event, [
    dynamic payload,
    Map<String, dynamic>? options,
  ]) =>
      _client.sendSignal(event, payload, options);

  Future<void> sendTo(
    String memberId,
    String event, [
    dynamic payload,
  ]) =>
      _client.sendSignal(event, payload, {'memberId': memberId});

  RoomSubscription on(String event, SignalHandler handler) =>
      _client.onSignal(event, handler);

  RoomSubscription onAny(AnySignalHandler handler) =>
      _client.onAnySignal(handler);
}

class RoomMembersNamespace {
  final RoomClient _client;
  RoomMembersNamespace(this._client);

  List<Map<String, dynamic>> list() => _client.listMembers();
  RoomSubscription onSync(MembersSyncHandler handler) =>
      _client.onMembersSync(handler);
  RoomSubscription onJoin(MemberHandler handler) =>
      _client.onMemberJoin(handler);
  RoomSubscription onLeave(MemberLeaveHandler handler) =>
      _client.onMemberLeave(handler);
  Future<void> setState(Map<String, dynamic> state) =>
      _client.sendMemberState(state);
  Future<void> clearState() => _client.clearMemberState();
  RoomSubscription onStateChange(MemberStateHandler handler) =>
      _client.onMemberStateChange(handler);
}

class RoomAdminNamespace {
  final RoomClient _client;
  RoomAdminNamespace(this._client);

  Future<void> kick(String memberId) => _client.sendAdmin('kick', memberId);
  Future<void> mute(String memberId) => _client.sendAdmin('mute', memberId);
  Future<void> block(String memberId) => _client.sendAdmin('block', memberId);
  Future<void> setRole(String memberId, String role) =>
      _client.sendAdmin('setRole', memberId, {'role': role});
  Future<void> disableVideo(String memberId) =>
      _client.sendAdmin('disableVideo', memberId);
  Future<void> stopScreenShare(String memberId) =>
      _client.sendAdmin('stopScreenShare', memberId);
}

class RoomMediaKindNamespace {
  final RoomClient _client;
  final String _kind;
  RoomMediaKindNamespace(this._client, this._kind);

  Future<void> enable([Map<String, dynamic>? payload]) =>
      _client.sendMedia('publish', _kind, payload);
  Future<void> disable() => _client.sendMedia('unpublish', _kind);
  Future<void> setMuted(bool muted) =>
      _client.sendMedia('mute', _kind, {'muted': muted});
}

class RoomScreenMediaNamespace {
  final RoomClient _client;
  RoomScreenMediaNamespace(this._client);

  Future<void> start([Map<String, dynamic>? payload]) =>
      _client.sendMedia('publish', 'screen', payload);
  Future<void> stop() => _client.sendMedia('unpublish', 'screen');
}

class RoomMediaDevicesNamespace {
  final RoomClient _client;
  RoomMediaDevicesNamespace(this._client);

  Future<void> switchInputs(Map<String, dynamic> payload) =>
      _client.switchMediaDevices(payload);
}

class RoomCloudflareRealtimeKitNamespace {
  final RoomClient _client;
  RoomCloudflareRealtimeKitNamespace(this._client);

  Future<RoomCloudflareRealtimeKitCreateSessionResponse> createSession([
    RoomCloudflareRealtimeKitCreateSessionRequest? payload,
  ]) =>
      _client._requestCloudflareRealtimeKitMedia(
        'session',
        'POST',
        payload,
      );
}

class RoomMediaNamespace {
  final RoomClient _client;
  late final RoomMediaKindNamespace audio;
  late final RoomMediaKindNamespace video;
  late final RoomScreenMediaNamespace screen;
  late final RoomMediaDevicesNamespace devices;
  late final RoomCloudflareRealtimeKitNamespace cloudflareRealtimeKit;

  RoomMediaNamespace(this._client) {
    audio = RoomMediaKindNamespace(_client, 'audio');
    video = RoomMediaKindNamespace(_client, 'video');
    screen = RoomScreenMediaNamespace(_client);
    devices = RoomMediaDevicesNamespace(_client);
    cloudflareRealtimeKit = RoomCloudflareRealtimeKitNamespace(_client);
  }

  RoomMediaTransport transport([RoomMediaTransportOptions? options]) {
    final resolved = options ?? const RoomMediaTransportOptions();
    switch (resolved.provider) {
      case 'cloudflare_realtimekit':
        return RoomCloudflareMediaTransport(
          _client,
          resolved.cloudflareRealtimeKit,
        );
      case 'p2p':
        return RoomP2PMediaTransport(
          _client,
          resolved.p2p,
        );
      default:
        throw UnsupportedError(
          'Unknown room media transport provider: ${resolved.provider}',
        );
    }
  }

  List<Map<String, dynamic>> list() => _client.listMediaMembers();
  RoomSubscription onTrack(MediaTrackHandler handler) =>
      _client.onMediaTrack(handler);
  RoomSubscription onTrackRemoved(MediaTrackHandler handler) =>
      _client.onMediaTrackRemoved(handler);
  RoomSubscription onStateChange(MediaStateHandler handler) =>
      _client.onMediaStateChange(handler);
  RoomSubscription onDeviceChange(MediaDeviceHandler handler) =>
      _client.onMediaDeviceChange(handler);
}

class RoomSessionNamespace {
  final RoomClient _client;
  RoomSessionNamespace(this._client);

  RoomSubscription onError(ErrorHandler handler) => _client.onError(handler);
  RoomSubscription onKicked(KickedHandler handler) => _client.onKicked(handler);
  RoomSubscription onReconnect(ReconnectHandler handler) =>
      _client.onReconnect(handler);
  RoomSubscription onConnectionStateChange(ConnectionStateHandler handler) =>
      _client.onConnectionStateChange(handler);

  String get connectionState => _client._connectionState;
  String? get userId => _client._currentUserId;
  String? get connectionId => _client._currentConnectionId;
}
