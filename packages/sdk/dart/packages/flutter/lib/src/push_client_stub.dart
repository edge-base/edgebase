import 'dart:async';

import 'package:edgebase_core/src/http_client.dart';
import 'package:edgebase_core/src/generated/api_core.dart';

/// Push notification platform type.
enum PushPlatform { ios, android, web, macos, windows }

/// Headless fallback for environments without Flutter plugin bindings.
class PushClient {
  final HttpClient _http;
  late final GeneratedDbApi _core = GeneratedDbApi(_http);
  final List<void Function(Map<String, dynamic>)> _messageListeners = [];
  final List<void Function(Map<String, dynamic>)> _openedAppListeners = [];
  Future<String> Function()? _tokenProvider;
  FutureOr<String> Function()? _permissionStatusProvider;
  Future<String> Function()? _permissionRequester;
  Future<void> Function(String topic)? _topicSubscriber;
  Future<void> Function(String topic)? _topicUnsubscriber;
  PushPlatform _platform = PushPlatform.web;
  String? _cachedDeviceId;
  String? _cachedToken;

  PushClient(this._http);

  void setTokenProvider(
    Future<String> Function() provider, {
    PushPlatform platform = PushPlatform.web,
  }) {
    _tokenProvider = provider;
    _platform = platform;
  }

  void setPermissionProvider({
    FutureOr<String> Function()? getPermissionStatus,
    Future<String> Function()? requestPermission,
  }) {
    _permissionStatusProvider = getPermissionStatus;
    _permissionRequester = requestPermission;
  }

  void setTopicProvider({
    required Future<void> Function(String topic) subscribe,
    required Future<void> Function(String topic) unsubscribe,
  }) {
    _topicSubscriber = subscribe;
    _topicUnsubscriber = unsubscribe;
  }

  Future<void> register({Map<String, dynamic>? metadata}) async {
    final permission = await requestPermission();
    if (permission != 'granted') return;
    final provider = _tokenProvider;
    if (provider == null) {
      throw UnsupportedError(
        'PushClient requires a token provider in headless mode. Call setTokenProvider() first.',
      );
    }
    final token = await provider();
    if (token.isEmpty) {
      throw StateError('PushClient token provider returned an empty token.');
    }
    if (_cachedToken == token && metadata == null) return;
    final deviceId = _cachedDeviceId ??= _generateDeviceId();
    final body = <String, dynamic>{
      'deviceId': deviceId,
      'token': token,
      'platform': _platform.name,
      'deviceInfo': _collectDeviceInfo(),
    };
    if (metadata != null) body['metadata'] = metadata;
    await _core.pushRegister(body);
    _cachedToken = token;
  }

  Future<void> unregister([String? deviceId]) async {
    await _core.pushUnregister(<String, dynamic>{
      'deviceId': deviceId ?? (_cachedDeviceId ??= _generateDeviceId()),
    });
    _cachedToken = null;
  }

  void onMessage(void Function(Map<String, dynamic> message) callback) {
    _messageListeners.add(callback);
  }

  void onMessageOpenedApp(
    void Function(Map<String, dynamic> message) callback,
  ) {
    _openedAppListeners.add(callback);
  }

  Future<String> getPermissionStatus() async {
    if (_permissionStatusProvider != null) {
      return await Future<String>.value(_permissionStatusProvider!.call());
    }
    return 'unsupported';
  }

  Future<void> subscribeTopic(String topic) async {
    final subscriber = _topicSubscriber;
    if (subscriber == null) {
      throw UnsupportedError(
        'PushClient requires a topic provider in headless mode. Call setTopicProvider() first.',
      );
    }
    await subscriber(topic);
  }

  Future<void> unsubscribeTopic(String topic) async {
    final unsubscriber = _topicUnsubscriber;
    if (unsubscriber == null) {
      throw UnsupportedError(
        'PushClient requires a topic provider in headless mode. Call setTopicProvider() first.',
      );
    }
    await unsubscriber(topic);
  }

  Future<String> requestPermission() async {
    if (_permissionRequester != null) {
      return await _permissionRequester!();
    }
    return 'unsupported';
  }

  void dispatchMessage(Map<String, dynamic> message) {
    for (final cb in _messageListeners) {
      cb(message);
    }
  }

  void dispatchMessageOpenedApp(Map<String, dynamic> message) {
    for (final cb in _openedAppListeners) {
      cb(message);
    }
  }

  String _generateDeviceId() => DateTime.now().microsecondsSinceEpoch.toString();

  Map<String, String> _collectDeviceInfo() => <String, String>{
        'name': 'dart-headless',
        'osVersion': 'headless',
        'locale': 'en-US',
      };
}
