// Database live client for WebSocket-based subscriptions.
//
// Uses `web_socket_channel` for cross-platform WebSocket support.
// Mirrors the JS SDK database live transport with Dart Streams.
// Features: subscribe, onSnapshot, server-side filters.

import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'package:web_socket_channel/web_socket_channel.dart';
import 'token_manager.dart';
import 'auth_refresh.dart';
import 'package:edgebase_core/src/context_manager.dart';
import 'package:edgebase_core/src/database_live_client.dart' as core;

// Re-export core.DbChange and core.ChangeType so users can import from the flutter package.
export 'package:edgebase_core/src/database_live_client.dart'
    show DbChange, ChangeType;

/// Maps server changeType string to core.ChangeType enum.
core.ChangeType _parseChangeType(String ct) {
  switch (ct) {
    case 'added':
      return core.ChangeType.create;
    case 'modified':
      return core.ChangeType.update;
    case 'removed':
      return core.ChangeType.delete;
    default:
      return core.ChangeType.update;
  }
}

/// Parse a db_change WS message to core.DbChange.
core.DbChange _dbChangeFromJson(Map<String, dynamic> json) {
  final changeType = (json['changeType'] as String?) ?? '';
  return core.DbChange(
    type: _parseChangeType(changeType),
    table: (json['table'] as String?) ?? '',
    id: (json['docId'] as String?) ?? '',
    record: json['data'] as Map<String, dynamic>?,
    oldRecord: json['oldRecord'] as Map<String, dynamic>?,
  );
}

String _normalizeDatabaseLiveChannel(String tableOrChannel) {
  if (tableOrChannel.startsWith('dblive:')) {
    return tableOrChannel;
  }
  final parts = tableOrChannel.split(':');
  if (parts.length == 1) {
    return 'dblive:shared:$tableOrChannel';
  }
  return 'dblive:$tableOrChannel';
}

String _channelTableName(String channel) {
  final parts = channel.split(':');
  if (parts.length <= 1) return channel;
  if (parts.length == 2) return parts[1];
  if (parts.length == 3) return parts[2];
  return parts[3];
}

bool _matchesDatabaseLiveChannel(
  String channel,
  core.DbChange change, [
  String? messageChannel,
]) {
  if (messageChannel != null && messageChannel.isNotEmpty) {
    return channel == _normalizeDatabaseLiveChannel(messageChannel);
  }

  final parts = channel.split(':');
  if (parts.isEmpty || parts.first != 'dblive') return false;
  if (parts.length == 2) return parts[1] == change.table;
  if (parts.length == 3) return parts[2] == change.table;
  if (parts.length == 4) {
    // Could be dblive:ns:table:docId or dblive:ns:instanceId:table
    if (parts[2] == change.table && parts[3] == change.id) return true;
    if (parts[3] == change.table) return true;
    return false;
  }
  return parts[3] == change.table && parts[4] == change.id;
}

/// DatabaseLive options.
class DatabaseLiveOptions {
  final Duration reconnectDelay;
  final int maxReconnectAttempts;

  DatabaseLiveOptions({
    this.reconnectDelay = const Duration(seconds: 1),
    this.maxReconnectAttempts = 10,
  });
}

/// Message handler callback.
typedef MessageHandler = void Function(Map<String, dynamic> message);

/// Filter tuple for server-side filtering.
typedef FilterTuple = List<dynamic>;

/// Per-subscriber filter info for recomputeChannelFilters() pattern (see JS SDK PR #14).
class _DatabaseLiveSubscriber {
  final int id;
  final List<FilterTuple>? filters;
  final List<FilterTuple>? orFilters;
  _DatabaseLiveSubscriber({required this.id, this.filters, this.orFilters});
}

/// DatabaseLive client — WebSocket connection with auto-reconnect.
/// Implements: auth_refreshed + revokedChannels handling.
class DatabaseLiveClient implements core.DatabaseLiveClient {
  final String _baseUrl;
  final TokenManager _tokenManager;
  final ContextManager _contextManager;
  final DatabaseLiveOptions _options;

  WebSocketChannel? _channel;
  bool _connected = false;
  bool _authenticated = false;
  int _reconnectAttempts = 0;
  Timer? _reconnectTimer;
  final _messageController = StreamController<Map<String, dynamic>>.broadcast();
  final _subscriptions = <String, StreamController<core.DbChange>>{};
  final _messageHandlers = <String, List<MessageHandler>>{};

  /// Server-side filters per channel for recovery after FILTER_RESYNC.
  final _channelFilters = <String, List<FilterTuple>>{};

  /// Server-side OR filters per channel for recovery after FILTER_RESYNC.
  final _channelOrFilters = <String, List<FilterTuple>>{};

  /// Per-subscriber filter tracking for recomputeChannelFilters() pattern.
  final _channelSubscribers = <String, List<_DatabaseLiveSubscriber>>{};
  int _nextSubscriberId = 0;

  StreamSubscription<TokenUser?>? _authStateSubscription;
  bool _waitingForAuth = false;

  DatabaseLiveClient(
    this._baseUrl,
    this._tokenManager,
    this._contextManager, {
    DatabaseLiveOptions? options,
  }) : _options = options ?? DatabaseLiveOptions() {
    _authStateSubscription = _tokenManager.onAuthStateChange.listen(
      _handleAuthStateChange,
    );
  }

  /// Whether currently connected.
  bool get isConnected => _connected;

  /// Raw message stream (for advanced use).
  Stream<Map<String, dynamic>> get messages => _messageController.stream;

  String? _currentChannel;
  bool _shouldReconnect = true;

  Uri _buildWebSocketUri(String wsUrl) {
    final channelParam = _currentChannel != null
        ? '?channel=${Uri.encodeComponent(_currentChannel!)}'
        : '';
    return Uri.parse('$wsUrl/api/db/subscribe$channelParam');
  }

  /// Connect to the database live WebSocket endpoint.
  /// [channel] is the channel name to connect to (e.g. 'dblive:posts').
  Future<void> connect({String? channel}) async {
    if (channel != null) _currentChannel = channel;
    if (_connected) {
      if (_authenticated && channel != null) {
        _sendSubscribe(channel);
      }
      return;
    }

    final token = await _tokenManager.getAccessToken(
      (refreshToken) => refreshAccessToken(_baseUrl, refreshToken),
    );
    if (token == null || token.isEmpty) {
      _waitingForAuth = _subscriptions.isNotEmpty;
      return;
    }

    final wsUrl = _baseUrl
        .replaceFirst('https://', 'wss://')
        .replaceFirst('http://', 'ws://');

    _channel = WebSocketChannel.connect(_buildWebSocketUri(wsUrl));

    // Send auth message
    final ctx = _contextManager.getContext();
    _channel!.sink.add(jsonEncode({
      'type': 'auth',
      'token': token,
      'sdkVersion': '0.2.0',
      if (ctx.isNotEmpty) 'context': ctx,
    }));

    _connected = true;
    _authenticated = false;
    _waitingForAuth = false;
    _reconnectAttempts = 0;

    _channel!.stream.listen(
      (data) {
        try {
          final json = jsonDecode(data as String) as Map<String, dynamic>;
          _messageController.add(json);
          _handleMessage(json);
        } catch (_) {}
      },
      onDone: () {
        _connected = false;
        _authenticated = false;
        if (_shouldReconnect && !_waitingForAuth) _tryReconnect();
      },
      onError: (_) {
        _connected = false;
        _authenticated = false;
        if (_shouldReconnect && !_waitingForAuth) _tryReconnect();
      },
    );
  }

  void _handleMessage(Map<String, dynamic> json) {
    final type = json['type'] as String?;

    // auth_success: initial authentication completed
    if (type == 'auth_success') {
      _authenticated = true;
      _waitingForAuth = false;
      _resubscribeAll();
      return;
    }

    // auth_refreshed: re-auth completed — handle revokedChannels
    if (type == 'auth_refreshed') {
      _authenticated = true;
      _waitingForAuth = false;
      final revoked =
          (json['revokedChannels'] as List<dynamic>?)?.cast<String>() ?? [];
      for (final channel in revoked) {
        _subscriptions[channel]?.close();
        _subscriptions.remove(channel);
        _channelSubscribers.remove(channel);
        _channelFilters.remove(channel);
        _channelOrFilters.remove(channel);
      }
      // Dispatch subscription_revoked events to app listeners
      if (revoked.isNotEmpty &&
          _messageHandlers.containsKey('subscription_revoked')) {
        for (final channel in revoked) {
          for (final handler in _messageHandlers['subscription_revoked']!) {
            handler({'type': 'subscription_revoked', 'channel': channel});
          }
        }
      }
      _resubscribeAll();
      return;
    }

    // FILTER_RESYNC: server woke from hibernation — re-send stored filters
    if (type == 'FILTER_RESYNC') {
      _resyncFilters();
      return;
    }

    if (type == 'db_change') {
      final change = _dbChangeFromJson(json);
      final messageChannel = json['channel'] as String?;
      for (final entry in _subscriptions.entries) {
        if (_matchesDatabaseLiveChannel(entry.key, change, messageChannel)) {
          entry.value.add(change);
        }
      }
      return;
    }

    if (type == 'batch_changes') {
      final changes = json['changes'] as List<dynamic>?;
      final messageChannel = json['channel'] as String?;
      final fallbackTable = (json['table'] as String?) ??
          (messageChannel == null ? '' : _channelTableName(messageChannel));
      if (changes == null) return;
      for (final raw in changes) {
        if (raw is! Map<String, dynamic>) continue;
        final change = core.DbChange(
          type: _parseChangeType((raw['event'] as String?) ?? ''),
          table: fallbackTable,
          id: raw['docId'] as String?,
          record: raw['data'] as Map<String, dynamic>?,
          oldRecord: raw['oldRecord'] as Map<String, dynamic>?,
        );
        for (final entry in _subscriptions.entries) {
          if (_matchesDatabaseLiveChannel(entry.key, change, messageChannel)) {
            entry.value.add(change);
          }
        }
      }
      return;
    }

    if (type == 'error') {
      final code = json['code'] as String?;
      if (code == 'AUTH_FAILED' || code == 'NOT_AUTHENTICATED') {
        _handleAuthenticationFailure();
      }
    }

    // Dispatch to registered message handlers
    if (type != null && _messageHandlers.containsKey(type)) {
      for (final handler in _messageHandlers[type]!) {
        handler(json);
      }
    }
  }

  void _tryReconnect() {
    if (_reconnectAttempts >= _options.maxReconnectAttempts) return;
    _reconnectTimer?.cancel();
    final baseDelay = _options.reconnectDelay * math.pow(2, _reconnectAttempts).toInt();
    final jitter = (baseDelay.inMilliseconds * 0.25 * math.Random().nextDouble()).round();
    final cappedDelay = Duration(milliseconds: math.min(baseDelay.inMilliseconds + jitter, 30000));
    _reconnectTimer = Timer(cappedDelay, () {
      _reconnectAttempts++;
      connect(channel: _currentChannel);
    });
  }

  /// Subscribe to table changes. Returns a Stream of [core.DbChange].
  ///
  /// [serverFilters] and [serverOrFilters] are server-side filter conditions.
  @override
  Stream<core.DbChange> subscribe(
    String tableName, {
    List<FilterTuple>? serverFilters,
    List<FilterTuple>? serverOrFilters,
  }) {
    final channel = _normalizeDatabaseLiveChannel(tableName);
    if (!_subscriptions.containsKey(channel)) {
      _subscriptions[channel] = StreamController<core.DbChange>.broadcast();
    }

    // Create per-subscriber filter tracking
    final subscriberId = _nextSubscriberId++;
    final subscriber = _DatabaseLiveSubscriber(
      id: subscriberId,
      filters: serverFilters,
      orFilters: serverOrFilters,
    );
    _channelSubscribers.putIfAbsent(channel, () => []);
    _channelSubscribers[channel]!.add(subscriber);

    // Recompute channel-level filters from all subscribers
    _recomputeChannelFilters(channel);

    // Connect with channel parameter (server requires it)
    connect(channel: channel);

    // Send subscribe message with filters
    if (_authenticated) {
      _sendSubscribe(channel);
    }

    return _subscriptions[channel]!.stream;
  }

  /// Unsubscribe from table changes.
  /// Removes all subscribers for the channel.
  @override
  void unsubscribe(String tableName) {
    final channel = _normalizeDatabaseLiveChannel(tableName);
    if (_connected) {
      _channel?.sink.add(jsonEncode({
        'type': 'unsubscribe',
        'channel': channel,
      }));
    }
    _subscriptions[channel]?.close();
    _subscriptions.remove(channel);
    _channelSubscribers.remove(channel);
    _channelFilters.remove(channel);
    _channelOrFilters.remove(channel);
  }

  /// Unsubscribe a specific subscriber by ID.
  /// If other subscribers remain, recomputes filters and re-sends subscribe.
  /// If none remain, sends unsubscribe and cleans up.
  void unsubscribeById(String tableName, int subscriberId) {
    final channel = _normalizeDatabaseLiveChannel(tableName);
    _channelSubscribers[channel]?.removeWhere((s) => s.id == subscriberId);
    if (_channelSubscribers[channel]?.isEmpty ?? true) {
      // No subscribers remain — clean up and unsubscribe
      _channelSubscribers.remove(channel);
      _channelFilters.remove(channel);
      _channelOrFilters.remove(channel);
      if (_connected) {
        _channel?.sink.add(jsonEncode({
          'type': 'unsubscribe',
          'channel': channel,
        }));
      }
      _subscriptions[channel]?.close();
      _subscriptions.remove(channel);
    } else {
      // Other subscribers remain — recompute filters and re-send subscribe
      _recomputeChannelFilters(channel);
      if (_authenticated) {
        _sendSubscribe(channel);
      }
    }
  }

  /// Listen for specific message types.
  /// Returns an unsubscribe function.
  void Function() on(String messageType, MessageHandler handler) {
    _messageHandlers.putIfAbsent(messageType, () => []);
    _messageHandlers[messageType]!.add(handler);
    return () {
      _messageHandlers[messageType]?.remove(handler);
    };
  }

  /// Send a message through the WebSocket.
  void send(Map<String, dynamic> message) {
    if (_connected && _channel != null) {
      _channel!.sink.add(jsonEncode(message));
    }
  }

  /// Send subscribe message for a channel with stored filters.
  void _sendSubscribe(String channel) {
    if (!_authenticated || _channel == null) return;
    final msg = <String, dynamic>{'type': 'subscribe', 'channel': channel};
    final filters = _channelFilters[channel];
    final orFilters = _channelOrFilters[channel];
    if (filters != null && filters.isNotEmpty) msg['filters'] = filters;
    if (orFilters != null && orFilters.isNotEmpty) msg['orFilters'] = orFilters;
    _channel!.sink.add(jsonEncode(msg));
  }

  /// Recompute channel-level filters from all active subscribers.
  /// Implements the JS SDK PR #14 pattern to prevent filter overwrite bugs.
  void _recomputeChannelFilters(String channel) {
    final subs = _channelSubscribers[channel];
    if (subs == null || subs.isEmpty) {
      _channelFilters.remove(channel);
      _channelOrFilters.remove(channel);
      return;
    }
    bool foundFilters = false;
    bool foundOrFilters = false;
    for (final s in subs) {
      if (!foundFilters && s.filters != null && s.filters!.isNotEmpty) {
        _channelFilters[channel] = s.filters!;
        foundFilters = true;
      }
      if (!foundOrFilters && s.orFilters != null && s.orFilters!.isNotEmpty) {
        _channelOrFilters[channel] = s.orFilters!;
        foundOrFilters = true;
      }
      if (foundFilters && foundOrFilters) break;
    }
    if (!foundFilters) _channelFilters.remove(channel);
    if (!foundOrFilters) _channelOrFilters.remove(channel);
  }

  /// Re-subscribe to all tracked channels after auth.
  void _resubscribeAll() {
    for (final channel in _subscriptions.keys) {
      _sendSubscribe(channel);
    }
  }

  /// Re-send stored filters to server after FILTER_RESYNC.
  void _resyncFilters() {
    for (final channel in _channelFilters.keys) {
      final filters = _channelFilters[channel] ?? [];
      final orFilters = _channelOrFilters[channel] ?? [];
      if (filters.isNotEmpty || orFilters.isNotEmpty) {
        final msg = <String, dynamic>{'type': 'subscribe', 'channel': channel};
        if (filters.isNotEmpty) msg['filters'] = filters;
        if (orFilters.isNotEmpty) msg['orFilters'] = orFilters;
        _channel?.sink.add(jsonEncode(msg));
      }
    }
  }

  /// Disconnect WebSocket.
  void disconnect() {
    _shouldReconnect = false;
    _reconnectTimer?.cancel();
    _channel?.sink.close();
    _connected = false;
    _authenticated = false;
    for (final ctrl in _subscriptions.values) {
      ctrl.close();
    }
    _subscriptions.clear();
    _channelSubscribers.clear();
    _channelFilters.clear();
    _channelOrFilters.clear();
    _messageHandlers.clear();
    _authStateSubscription?.cancel();
    _messageController.close();
  }

  void _handleAuthStateChange(TokenUser? user) {
    if (user == null) {
      _authenticated = false;
      _waitingForAuth = _subscriptions.isNotEmpty;
      if (_channel != null) {
        final socket = _channel;
        _channel = null;
        _connected = false;
        socket?.sink.close();
      }
      return;
    }

    _waitingForAuth = false;
    if (_connected && _authenticated) {
      _refreshAuth();
      return;
    }

    final firstChannel =
        _subscriptions.keys.isEmpty ? null : _subscriptions.keys.first;
    if (firstChannel != null) {
      unawaited(connect(channel: firstChannel));
    }
  }

  void _handleAuthenticationFailure() {
    _authenticated = false;
    _waitingForAuth = _subscriptions.isNotEmpty;
    // Attempt reconnection with fresh token if subscriptions are active
    if (_subscriptions.isNotEmpty) {
      _channel?.sink.close();
      _connected = false;
      _channel = null;
      _tryReconnect();
    }
  }

  void _refreshAuth() {
    if (!_connected || _channel == null) return;
    final token = _tokenManager.accessToken;
    if (token == null || token.isEmpty) {
      _handleAuthenticationFailure();
      return;
    }
    final ctx = _contextManager.getContext();
    _channel!.sink.add(jsonEncode({
      'type': 'auth',
      'token': token,
      'sdkVersion': '0.2.0',
      if (ctx.isNotEmpty) 'context': ctx,
    }));
  }
}
