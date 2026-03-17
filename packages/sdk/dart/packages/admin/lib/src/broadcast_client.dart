// BroadcastClient — server-side DatabaseLive broadcast.
//
// Sends a message to a DatabaseLive channel from the Admin SDK.
// Requires a Service Key for authentication.
//
// ```dart
// await admin.broadcast('chat-room-1', 'new-message', payload: {'text': 'hello'});
// ```
import 'package:edgebase_core/src/http_client.dart';
import 'generated/admin_api_core.dart';

/// Client for server-side DatabaseLive broadcast.
class BroadcastClient {
  final HttpClient _http;
  late final GeneratedAdminApi _core;

  BroadcastClient(this._http) : _core = GeneratedAdminApi(_http);

  /// Broadcast a message to a DatabaseLive channel from the server.
  ///
  /// - [channel]: DatabaseLive channel name (e.g. `'chat-room-1'`)
  /// - [event]: Event type string (e.g. `'new-message'`)
  /// - [payload]: Optional JSON-serializable payload
  Future<void> send(
    String channel,
    String event, {
    Map<String, dynamic>? payload,
  }) async {
    final body = <String, dynamic>{
      'channel': channel,
      'event': event,
    };
    if (payload != null) body['payload'] = payload;
    await _core.databaseLiveBroadcast(body);
  }
}
