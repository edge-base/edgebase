/// PushClient — Push notification management for Flutter.
///
/// Auto-acquires push token via FirebaseMessaging (Android: FCM, iOS: APNs).
/// Developer only needs google-services.json (Android) / GoogleService-Info.plist (iOS).
///
/// ```dart
/// await client.push.register();                       // auto token
/// await client.push.register(metadata: {'topic': 'news'}); // with metadata
/// ```
import 'dart:async';
import 'dart:io' show Platform;
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:edgebase_core/src/http_client.dart';
import 'package:edgebase_core/src/generated/api_core.dart';

/// Push notification platform type.
enum PushPlatform { ios, android, web, macos, windows }

/// Client-side push notification management.
/// Auto-acquires token via FirebaseMessaging — no tokenProvider needed.
class PushClient {
  final GeneratedDbApi _core;
  final List<void Function(Map<String, dynamic>)> _messageListeners = [];
  final List<void Function(Map<String, dynamic>)> _openedAppListeners = [];
  Future<String> Function()? _tokenProvider;
  FutureOr<String> Function()? _permissionStatusProvider;
  Future<String> Function()? _permissionRequester;
  Future<void> Function(String topic)? _topicSubscriber;
  Future<void> Function(String topic)? _topicUnsubscriber;
  PushPlatform? _platformOverride;

  // Internal cache
  String? _cachedDeviceId;
  String? _cachedToken;

  PushClient(HttpClient http) : _core = GeneratedDbApi(http) {
    // Auto-listen for foreground messages
    FirebaseMessaging.onMessage.listen((RemoteMessage message) {
      final msg = <String, dynamic>{
        'title': message.notification?.title,
        'body': message.notification?.body,
        'data': message.data,
      };
      for (final cb in _messageListeners) { cb(msg); }
    });

    // Auto-listen for notification taps
    FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
      final msg = <String, dynamic>{
        'title': message.notification?.title,
        'body': message.notification?.body,
        'data': message.data,
      };
      for (final cb in _openedAppListeners) { cb(msg); }
    });
  }

  /// Override token acquisition for headless or custom-platform integrations.
  void setTokenProvider(
    Future<String> Function() provider, {
    PushPlatform platform = PushPlatform.web,
  }) {
    _tokenProvider = provider;
    _platformOverride = platform;
  }

  /// Override permission status/request flows for headless or custom-platform integrations.
  void setPermissionProvider({
    FutureOr<String> Function()? getPermissionStatus,
    Future<String> Function()? requestPermission,
  }) {
    _permissionStatusProvider = getPermissionStatus;
    _permissionRequester = requestPermission;
  }

  /// Override topic subscription plumbing for headless or custom-platform integrations.
  void setTopicProvider({
    required Future<void> Function(String topic) subscribe,
    required Future<void> Function(String topic) unsubscribe,
  }) {
    _topicSubscriber = subscribe;
    _topicUnsubscriber = unsubscribe;
  }

  String _getOrCreateDeviceId() {
    _cachedDeviceId ??= _generateUuid();
    return _cachedDeviceId!;
  }

  String _generateUuid() {
    final r = DateTime.now().microsecondsSinceEpoch;
    return '${r.toRadixString(16).padLeft(12, '0')}-${r.hashCode.toRadixString(16).padLeft(8, '0')}';
  }

  PushPlatform _detectPlatform() {
    if (_platformOverride != null) return _platformOverride!;
    try {
      if (Platform.isIOS) return PushPlatform.ios;
      if (Platform.isAndroid) return PushPlatform.android;
      if (Platform.isMacOS) return PushPlatform.macos;
      if (Platform.isWindows) return PushPlatform.windows;
    } catch (_) {
      // Platform not available (web)
    }
    return PushPlatform.web;
  }

  /// Register for push notifications.
  /// Auto-acquires token via FirebaseMessaging (FCM on Android, APNs on iOS).
  /// Caches token, sends to server only on change (§9).
  Future<void> register({Map<String, dynamic>? metadata}) async {
    // 1. Request permission
    final perm = await requestPermission();
    if (perm != 'granted') return;

    // 2. Get token from FirebaseMessaging — auto handles Android (FCM) + iOS (APNs)
    final token = _tokenProvider != null
        ? await _tokenProvider!()
        : await FirebaseMessaging.instance.getToken();
    if (token == null || token.isEmpty) {
      throw StateError('Failed to get push token. Ensure Firebase is configured.');
    }

    // 3. Check cache — skip if unchanged (§9), unless metadata provided
    if (_cachedToken == token && metadata == null) return;

    // 4. Register with server — auto-collect deviceInfo
    final deviceId = _getOrCreateDeviceId();
    final deviceInfo = _collectDeviceInfo();
    final body = <String, dynamic>{
      'deviceId': deviceId,
      'token': token,
      'platform': _detectPlatform().name,
      'deviceInfo': deviceInfo,
    };
    if (metadata != null) body['metadata'] = metadata;
    await _core.pushRegister(body);
    _cachedToken = token;
  }

  Map<String, String> _collectDeviceInfo() {
    final info = <String, String>{};
    try {
      info['osVersion'] = '${Platform.operatingSystem} ${Platform.operatingSystemVersion}';
      info['locale'] = Platform.localeName;
    } catch (_) {
      info['osVersion'] = 'web';
    }
    return info;
  }

  /// Unregister current device (or a specific device by ID).
  Future<void> unregister([String? deviceId]) async {
    final id = deviceId ?? _getOrCreateDeviceId();
    await _core.pushUnregister({'deviceId': id});
    _cachedToken = null;
  }

  /// Listen for push messages in foreground.
  void onMessage(void Function(Map<String, dynamic> message) callback) {
    _messageListeners.add(callback);
  }

  /// Listen for notification taps that opened the app.
  void onMessageOpenedApp(void Function(Map<String, dynamic> message) callback) {
    _openedAppListeners.add(callback);
  }

  /// Get notification permission status.
  Future<String> getPermissionStatus() async {
    if (_permissionStatusProvider != null) {
      return await Future<String>.value(_permissionStatusProvider!.call());
    }
    final settings = await FirebaseMessaging.instance.getNotificationSettings();
    switch (settings.authorizationStatus) {
      case AuthorizationStatus.authorized:
      case AuthorizationStatus.provisional:
        return 'granted';
      case AuthorizationStatus.denied:
        return 'denied';
      default:
        return 'notDetermined';
    }
  }

  /// Subscribe to an FCM topic.
  /// Uses Firebase SDK directly — mobile only.
  Future<void> subscribeTopic(String topic) async {
    if (_topicSubscriber != null) {
      await _topicSubscriber!(topic);
      return;
    }
    await FirebaseMessaging.instance.subscribeToTopic(topic);
  }

  /// Unsubscribe from an FCM topic.
  Future<void> unsubscribeTopic(String topic) async {
    if (_topicUnsubscriber != null) {
      await _topicUnsubscriber!(topic);
      return;
    }
    await FirebaseMessaging.instance.unsubscribeFromTopic(topic);
  }

  /// Request notification permission from the user.
  Future<String> requestPermission() async {
    if (_permissionRequester != null) {
      return await _permissionRequester!();
    }
    final settings = await FirebaseMessaging.instance.requestPermission(
      alert: true,
      badge: true,
      sound: true,
    );
    return settings.authorizationStatus == AuthorizationStatus.authorized ||
           settings.authorizationStatus == AuthorizationStatus.provisional
        ? 'granted'
        : 'denied';
  }

  /// Dispatch a foreground message to registered listeners.
  void dispatchMessage(Map<String, dynamic> message) {
    for (final cb in _messageListeners) {
      cb(message);
    }
  }

  /// Dispatch a notification-opened event to registered listeners.
  void dispatchMessageOpenedApp(Map<String, dynamic> message) {
    for (final cb in _openedAppListeners) {
      cb(message);
    }
  }
}
