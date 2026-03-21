// HTTP client for EdgeBase API communication.
//
// Mirrors `@edge-base/sdk` HttpClient — handles auth headers, JSON
// serialization, error parsing, and automatic 401 retry with token refresh.

import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;
import 'package:http/http.dart' as http;
import 'errors.dart';
import 'token_manager.dart';
import 'context_manager.dart';
import 'http_client_platform_io.dart'
    if (dart.library.html) 'http_client_platform_web.dart' as platform;

class HttpClient {
  final String baseUrl;
  final String? serviceKey;
  final TokenManager? tokenManager;
  final ContextManager contextManager;
  final http.Client _client;
  final Duration _requestTimeout;
  String? _locale;

  factory HttpClient({
    required String baseUrl,
    TokenManager? tokenManager,
    required ContextManager contextManager,
    String? serviceKey,
    http.Client? client,
    Duration? requestTimeout,
  }) {
    final resolvedTimeout = requestTimeout ?? _resolveRequestTimeout();
    return HttpClient._internal(
      baseUrl: baseUrl,
      tokenManager: tokenManager,
      contextManager: contextManager,
      serviceKey: serviceKey,
      client: client ?? _createDefaultClient(resolvedTimeout),
      requestTimeout: resolvedTimeout,
    );
  }

  HttpClient._internal({
    required this.baseUrl,
    this.tokenManager,
    required this.contextManager,
    this.serviceKey,
    required http.Client client,
    required Duration requestTimeout,
  })  : _client = client,
        _requestTimeout = requestTimeout;

  static Duration _resolveRequestTimeout() {
    final raw = platform.platformEnvironmentValue('EDGEBASE_HTTP_TIMEOUT_MS');
    final milliseconds = raw == null ? null : int.tryParse(raw.trim());
    if (milliseconds != null && milliseconds > 0) {
      return Duration(milliseconds: milliseconds);
    }
    return const Duration(seconds: 30);
  }

  static http.Client _createDefaultClient(Duration timeout) =>
      platform.createDefaultHttpClient(timeout);

  /// Perform token refresh via HTTP.
  Future<TokenPair> _refreshToken(String refreshToken) async {
    final response = await _client
        .post(
          Uri.parse('$baseUrl/api/auth/refresh'),
          headers: {
            'Content-Type': 'application/json',
            'Connection': 'close',
          },
          body: jsonEncode({'refreshToken': refreshToken}),
        )
        .timeout(_requestTimeout);
    if (response.statusCode >= 200 && response.statusCode < 300) {
      final json = jsonDecode(response.body) as Map<String, dynamic>;
      return TokenPair(
        accessToken: json['accessToken'] as String,
        refreshToken: json['refreshToken'] as String,
      );
    }
    throw EdgeBaseError('Token refresh failed',
        statusCode: response.statusCode);
  }

  /// Headers with auth token and request metadata.
  Future<Map<String, String>> _buildHeaders({bool withAuth = true}) async {
    final headers = <String, String>{
      'Content-Type': 'application/json',
      'Connection': 'close',
    };

    if (serviceKey != null) {
      // Service-key requests must use the dedicated header so client-facing
      // /api routes do not try to parse the key as a user JWT.
      headers['X-EdgeBase-Service-Key'] = serviceKey!;
    } else if (withAuth) {
      try {
        final token = await tokenManager?.getAccessToken(_refreshToken);
        if (token != null) {
          headers['Authorization'] = 'Bearer $token';
        }
      } catch (_) {
        // Token refresh failed — proceed as unauthenticated
      }
    }
    if (_locale != null && _locale!.isNotEmpty) {
      headers['Accept-Language'] = _locale!;
    }
    return headers;
  }

  /// Set locale for i18n/auth email language and Accept-Language headers.
  void setLocale(String? locale) {
    _locale = locale;
  }

  /// Get the currently configured locale override.
  String? getLocale() => _locale;

  /// Parse response, throw [EdgeBaseError] on failure.
  dynamic _handleResponse(http.Response response) {
    if (response.statusCode >= 200 && response.statusCode < 300) {
      if (response.body.isEmpty || response.statusCode == 204) return null;
      return jsonDecode(response.body);
    }
    // Try parse error JSON
    try {
      final json = jsonDecode(response.body) as Map<String, dynamic>;
      throw EdgeBaseError.fromJson(json, response.statusCode);
    } catch (e) {
      if (e is EdgeBaseError) rethrow;
      throw EdgeBaseError(
        'Request failed with status ${response.statusCode}',
        statusCode: response.statusCode,
      );
    }
  }

  /// Core request method with automatic 401 retry, 429 retry, and transport retry.
  Future<dynamic> _request(
    String method,
    String path, {
    Object? body,
    bool skipAuth = false,
    Map<String, String>? query,
  }) async {
    final uri = _buildUri(path, query);
    final encoded = body != null ? jsonEncode(body) : null;

    for (var attempt = 0; attempt <= 3; attempt++) {
      final headers = await _buildHeaders(withAuth: !skipAuth);

      http.Response response;
      try {
        response = await _send(method, uri, headers, encoded);
      } on TimeoutException {
        if (attempt < 2) {
          await Future.delayed(Duration(milliseconds: 50 * (attempt + 1)));
          continue;
        }
        throw EdgeBaseError(
          'Request timeout after ${_requestTimeout.inMilliseconds}ms',
        );
      } catch (e) {
        if (e is EdgeBaseError) rethrow;
        if (attempt < 2 && _isRetryableTransportError(e)) {
          await Future.delayed(Duration(milliseconds: 50 * (attempt + 1)));
          continue;
        }
        throw EdgeBaseError('Network error: $e');
      }

      // 429 retry with Retry-After
      if (response.statusCode == 429 && attempt < 3) {
        await Future.delayed(_parseRetryAfter(response, attempt));
        continue;
      }

      // 401 auto-retry: refresh token and retry once
      if (response.statusCode == 401 && !skipAuth && serviceKey == null && attempt == 0) {
        try {
          final newHeaders = await _buildHeaders(withAuth: true);
          response = await _send(method, uri, newHeaders, encoded);
          if (response.statusCode >= 200 && response.statusCode < 300) {
            return _handleResponse(response);
          }
        } catch (_) {
          // Retry failed, fall through to original response handling
        }
      }

      return _handleResponse(response);
    }

    throw EdgeBaseError('Request failed after maximum retries');
  }

  /// Build URI with optional query parameters.
  Uri _buildUri(String path, Map<String, String>? query) {
    final base = Uri.parse('$baseUrl/api$path');
    if (query != null && query.isNotEmpty) {
      return base.replace(queryParameters: {
        ...base.queryParameters,
        ...query,
      });
    }
    return base;
  }

  /// Send HTTP request.
  Future<http.Response> _send(
    String method,
    Uri uri,
    Map<String, String> headers,
    String? body,
  ) async {
    Future<http.Response> request() {
      switch (method) {
        case 'GET':
          return _client.get(uri, headers: headers);
        case 'POST':
          return _client.post(uri, headers: headers, body: body);
        case 'PATCH':
          return _client.patch(uri, headers: headers, body: body);
        case 'PUT':
          return _client.put(uri, headers: headers, body: body);
        case 'DELETE':
          return _client.delete(uri, headers: headers, body: body);
        case 'HEAD':
          return _client.head(uri, headers: headers);
        default:
          throw EdgeBaseError('Unsupported HTTP method: $method');
      }
    }

    return request().timeout(_requestTimeout);
  }

  // ─── Public API (auth required) ───

  Future<dynamic> get(String path, [Map<String, String>? query]) =>
      _request('GET', path, query: query);

  Future<dynamic> post(String path, [Object? body]) =>
      _request('POST', path, body: body);

  Future<dynamic> postWithQuery(
    String path,
    Object? body, [
    Map<String, String>? query,
  ]) =>
      _request('POST', path, body: body, query: query);

  Future<dynamic> patch(String path, Object? body) =>
      _request('PATCH', path, body: body);

  Future<dynamic> put(String path, Object? body) =>
      _request('PUT', path, body: body);

  Future<dynamic> putWithQuery(
    String path,
    Object? body, [
    Map<String, String>? query,
  ]) =>
      _request('PUT', path, body: body, query: query);

  Future<dynamic> delete(String path, [Object? body]) =>
      _request('DELETE', path, body: body);

  // ─── Public API (no auth, for signup/signin) ───

  Future<dynamic> postPublic(String path, [Object? body]) =>
      _request('POST', path, body: body, skipAuth: true);

  /// Get auth headers (for raw fetch calls, e.g. file uploads).
  Future<Map<String, String>> getAuthHeaders() => _buildHeaders(withAuth: true);

  /// Get raw [http.Response] for advanced use (e.g. file download).
  Future<http.Response> getRaw(String path) async {
    final headers = await _buildHeaders();
    return _client
        .get(
          Uri.parse('$baseUrl/api$path'),
          headers: headers,
        )
        .timeout(_requestTimeout);
  }

  /// POST raw bytes (for multipart upload-part).
  Future<dynamic> postRaw(String path, List<int> data,
      {String contentType = 'application/octet-stream'}) async {
    final headers = await _buildHeaders();
    headers['Content-Type'] = contentType;
    final response = await _client
        .post(
          Uri.parse('$baseUrl/api$path'),
          headers: headers,
          body: data,
        )
        .timeout(_requestTimeout);
    return _handleResponse(response);
  }

  /// Send multipart request (for file uploads).
  Future<dynamic> postMultipart(
    String path,
    http.MultipartRequest request,
  ) async {
    final headers = await _buildHeaders();
    headers.remove('Content-Type'); // Let multipart set its own
    request.headers.addAll(headers);
    final streamedResponse =
        await _client.send(request).timeout(_requestTimeout);
    final response = await http.Response.fromStream(streamedResponse);
    return _handleResponse(response);
  }

  /// HEAD request — returns true if resource exists (2xx).
  Future<bool> head(String path) async {
    final uri = Uri.parse('$baseUrl/api$path');
    final headers = await _buildHeaders();
    try {
      final response =
          await _client.head(uri, headers: headers).timeout(_requestTimeout);
      return response.statusCode >= 200 && response.statusCode < 300;
    } catch (_) {
      return false;
    }
  }

  static Duration _parseRetryAfter(http.Response response, int attempt) {
    final header = response.headers['retry-after'];
    var baseMs = 1000 * (1 << attempt);
    if (header != null) {
      final seconds = int.tryParse(header);
      if (seconds != null && seconds > 0) baseMs = seconds * 1000;
    }
    final random = math.Random();
    final jitter = (baseMs * 0.25 * random.nextDouble()).round();
    return Duration(milliseconds: (baseMs + jitter).clamp(0, 10000));
  }

  static bool _isRetryableTransportError(Object error) {
    final msg = error.toString().toLowerCase();
    return msg.contains('timeout') || msg.contains('socket') ||
        msg.contains('connection') || msg.contains('reset') ||
        msg.contains('refused') || msg.contains('network');
  }

  void close() => _client.close();
}
