import 'dart:io' as io;

import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';

String? platformEnvironmentValue(String key) => io.Platform.environment[key];

http.Client createDefaultHttpClient(Duration timeout) {
  final client = io.HttpClient()
    ..connectionTimeout = timeout
    ..idleTimeout = Duration.zero;
  return IOClient(client);
}
