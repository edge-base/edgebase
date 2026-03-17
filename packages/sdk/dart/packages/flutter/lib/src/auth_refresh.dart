import 'dart:convert';

import 'package:edgebase_core/src/errors.dart';
import 'package:edgebase_core/src/token_manager.dart' as core;
import 'package:http/http.dart' as http;

Future<core.TokenPair> refreshAccessToken(
  String baseUrl,
  String refreshToken,
) async {
  late http.Response response;

  try {
    response = await http.post(
      Uri.parse('${baseUrl.replaceAll(RegExp(r'/$'), '')}/api/auth/refresh'),
      headers: const {'Content-Type': 'application/json'},
      body: jsonEncode({'refreshToken': refreshToken}),
    );
  } catch (error) {
    throw EdgeBaseError('Network error: $error');
  }

  final body = response.body.isEmpty
      ? null
      : jsonDecode(response.body) as Map<String, dynamic>;
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw EdgeBaseError(
      body?['message'] as String? ?? 'Failed to refresh access token.',
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
