import 'dart:convert';

import 'package:edgebase_core/src/errors.dart';
import 'package:edgebase_core/src/token_manager.dart' as core;
import 'package:http/http.dart' as http;

String? _extractServerMessage(String? rawBody) {
  if (rawBody == null || rawBody.isEmpty) return null;
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
    // Ignore malformed response bodies and fall back to a synthesized message.
  }
  return null;
}

Future<core.TokenPair> refreshAccessToken(
  String baseUrl,
  String refreshToken,
) async {
  final refreshUrl = '${baseUrl.replaceAll(RegExp(r'/$'), '')}/api/auth/refresh';
  late http.Response response;

  try {
    response = await http.post(
      Uri.parse(refreshUrl),
      headers: const {'Content-Type': 'application/json'},
      body: jsonEncode({'refreshToken': refreshToken}),
    );
  } catch (error) {
    throw EdgeBaseError(
      'Auth session refresh could not reach $refreshUrl. Make sure the EdgeBase server is running and reachable. Cause: $error',
      statusCode: 0,
    );
  }

  final body = response.body.isEmpty
      ? null
      : jsonDecode(response.body) as Map<String, dynamic>;
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw EdgeBaseError(
      body?['message'] as String? ??
          _extractServerMessage(response.body) ??
          'Request failed with HTTP ${response.statusCode} and no error message from the server.',
      statusCode: response.statusCode,
    );
  }

  final accessToken = body?['accessToken'] as String?;
  final nextRefreshToken = body?['refreshToken'] as String?;
  if (accessToken == null || nextRefreshToken == null) {
    throw EdgeBaseError(
      'Invalid auth refresh response.',
      statusCode: response.statusCode,
    );
  }

  return core.TokenPair(
    accessToken: accessToken,
    refreshToken: nextRefreshToken,
  );
}
