import 'package:http/browser_client.dart';
import 'package:http/http.dart' as http;

String? platformEnvironmentValue(String key) {
  const timeout = String.fromEnvironment('EDGEBASE_HTTP_TIMEOUT_MS');
  if (key == 'EDGEBASE_HTTP_TIMEOUT_MS' && timeout.isNotEmpty) {
    return timeout;
  }
  return null;
}

http.Client createDefaultHttpClient(Duration timeout) {
  final client = BrowserClient();
  client.withCredentials = false;
  return client;
}
