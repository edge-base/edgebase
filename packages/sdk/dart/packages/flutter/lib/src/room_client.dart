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
import 'package:edgebase_core/src/errors.dart';
import 'package:http/http.dart' as http;
import 'package:web_socket_channel/web_socket_channel.dart';
import 'auth_refresh.dart';
import 'token_manager.dart';

const _roomExplicitLeaveCloseDelay = Duration(milliseconds: 40);

String? _extractRoomServerMessage(String rawBody) {
  if (rawBody.isEmpty) return null;
  try {
    final decoded = jsonDecode(rawBody);
    if (decoded is Map<String, dynamic>) {
      for (final key in ['message', 'error', 'detail']) {
        final value = decoded[key];
        if (value is String && value.trim().isNotEmpty) {
          return value.trim();
        }
      }
    }
  } catch (_) {
    // Ignore malformed response bodies and fall back to synthesized messages.
  }
  return null;
}

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
  final List<ReconnectHandler> _reconnectHandlers = [];
  final List<ConnectionStateHandler> _connectionStateHandlers = [];

  late final RoomStateNamespace state;
  late final RoomMetaNamespace meta;
  late final RoomSignalsNamespace signals;
  late final RoomMembersNamespace members;
  late final RoomAdminNamespace admin;
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
    final trimmedBaseUrl = baseUrl.replaceAll(RegExp(r'/$'), '');
    final url = '$trimmedBaseUrl'
        '${ApiPaths.GET_ROOM_METADATA}'
        '?namespace=${Uri.encodeComponent(namespace)}'
        '&id=${Uri.encodeComponent(roomId)}';
    late http.Response response;
    try {
      response = await http.get(Uri.parse(url));
    } catch (error) {
      throw EdgeBaseError(
        'Room metadata request could not reach $url. Make sure the EdgeBase server is running and reachable. Cause: $error',
        statusCode: 0,
      );
    }
    if (response.statusCode != 200) {
      throw Exception(
        _extractRoomServerMessage(response.body) ??
            "Failed to load room metadata for '$roomId' in namespace '$namespace' (HTTP ${response.statusCode}${response.reasonPhrase == null || response.reasonPhrase!.isEmpty ? '' : ' ${response.reasonPhrase}'}).",
      );
    }
    return jsonDecode(response.body) as Map<String, dynamic>;
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
      return Future.error(Exception(
        'Not connected to room. Call room.join() and wait for the room to connect before sending actions or signals.',
      ));
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

  Future<void> sendSignal(
    String event, [
    dynamic payload,
    Map<String, dynamic>? options,
  ]) {
    if (!_connected || !_authenticated) {
      return Future.error(Exception(
        'Not connected to room. Call room.join() and wait for the room to connect before sending actions or signals.',
      ));
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
      return Future.error(Exception(
        'Not connected to room. Call room.join() and wait for the room to connect before sending actions or signals.',
      ));
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
      return Future.error(Exception(
        'Not connected to room. Call room.join() and wait for the room to connect before sending actions or signals.',
      ));
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
      return Future.error(Exception(
        'Not connected to room. Call room.join() and wait for the room to connect before sending actions or signals.',
      ));
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
  }

  void _removeMember(String memberId) {
    _members.removeWhere((member) => member['memberId'] == memberId);
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
  Future<void> block(String memberId) => _client.sendAdmin('block', memberId);
  Future<void> setRole(String memberId, String role) =>
      _client.sendAdmin('setRole', memberId, {'role': role});
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
