import 'package:edgebase_core/src/http_client.dart';

class FunctionCallOptions {
  final String method;
  final Object? body;
  final Map<String, String>? query;

  const FunctionCallOptions({
    this.method = 'POST',
    this.body,
    this.query,
  });
}

class FunctionsClient {
  final HttpClient _httpClient;

  FunctionsClient(this._httpClient);

  Future<dynamic> call(String path, {FunctionCallOptions options = const FunctionCallOptions()}) {
    final normalizedMethod = options.method.toUpperCase();
    final normalizedPath = '/functions/$path';

    switch (normalizedMethod) {
      case 'GET':
        return _httpClient.get(normalizedPath, options.query);
      case 'PUT':
        return _httpClient.put(normalizedPath, options.body);
      case 'PATCH':
        return _httpClient.patch(normalizedPath, options.body);
      case 'DELETE':
        return _httpClient.delete(normalizedPath);
      case 'POST':
      default:
        return _httpClient.post(normalizedPath, options.body);
    }
  }

  Future<dynamic> get(String path, {Map<String, String>? query}) {
    return call(path, options: FunctionCallOptions(method: 'GET', query: query));
  }

  Future<dynamic> post(String path, [Object? body]) {
    return call(path, options: FunctionCallOptions(method: 'POST', body: body));
  }

  Future<dynamic> put(String path, [Object? body]) {
    return call(path, options: FunctionCallOptions(method: 'PUT', body: body));
  }

  Future<dynamic> patch(String path, [Object? body]) {
    return call(path, options: FunctionCallOptions(method: 'PATCH', body: body));
  }

  Future<dynamic> delete(String path) {
    return call(path, options: const FunctionCallOptions(method: 'DELETE'));
  }
}
