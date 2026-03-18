/// PushClient — Push notification management for Admin SDK.
///
/// ```dart
/// final result = await client.push.send('userId', {'title': 'Hello', 'body': 'World'});
/// final result = await client.push.sendMany(['u1', 'u2'], {'title': 'News'});
/// final logs = await client.push.getLogs('userId');
/// ```
import 'package:edgebase_core/src/http_client.dart';
import 'generated/admin_api_core.dart';

/// Client for push notification operations.
class PushClient {
  late final GeneratedAdminApi _core;

  PushClient(HttpClient http) : _core = GeneratedAdminApi(http);

  /// Send a push notification to a single user's devices.
  Future<Map<String, dynamic>> send(
    String userId,
    Map<String, dynamic> payload,
  ) async {
    final res = await _core.pushSend({
      'userId': userId,
      'payload': payload,
    });
    return res is Map<String, dynamic> ? res : {};
  }

  /// Send a push notification to multiple users (no limit — server chunks internally).
  Future<Map<String, dynamic>> sendMany(
    List<String> userIds,
    Map<String, dynamic> payload,
  ) async {
    final res = await _core.pushSendMany({
      'userIds': userIds,
      'payload': payload,
    });
    return res is Map<String, dynamic> ? res : {};
  }

  /// Send a push notification directly to a specific FCM token.
  Future<Map<String, dynamic>> sendToToken(
    String token,
    Map<String, dynamic> payload, {
    String? platform,
  }) async {
    final res = await _core.pushSendToToken({
      'token': token,
      'payload': payload,
      if (platform != null) 'platform': platform,
    });
    return res is Map<String, dynamic> ? res : {};
  }

  /// Get registered device tokens for a user — token values NOT exposed.
  Future<List<Map<String, dynamic>>> getTokens(String userId) async {
    final res = await _core.getPushTokens({'userId': userId});
    if (res is Map<String, dynamic> && res['items'] is List) {
      return (res['items'] as List)
          .whereType<Map<String, dynamic>>()
          .toList();
    }
    return [];
  }

  /// Get push send logs for a user (last 24 hours).
  Future<List<Map<String, dynamic>>> getLogs(
    String userId, {
    int? limit,
  }) async {
    final query = <String, String>{'userId': userId};
    if (limit != null) query['limit'] = limit.toString();
    final res = await _core.getPushLogs(query);
    if (res is Map<String, dynamic> && res['items'] is List) {
      return (res['items'] as List)
          .whereType<Map<String, dynamic>>()
          .toList();
    }
    return [];
  }

  /// Send a push notification to an FCM topic.
  Future<Map<String, dynamic>> sendToTopic(
    String topic,
    Map<String, dynamic> payload,
  ) async {
    final res = await _core.pushSendToTopic({
      'topic': topic,
      'payload': payload,
    });
    return res is Map<String, dynamic> ? res : {};
  }

  /// Broadcast a push notification to all devices via /topics/all.
  Future<Map<String, dynamic>> broadcast(
    Map<String, dynamic> payload,
  ) async {
    final res = await _core.pushBroadcast({
      'payload': payload,
    });
    return res is Map<String, dynamic> ? res : {};
  }
}
