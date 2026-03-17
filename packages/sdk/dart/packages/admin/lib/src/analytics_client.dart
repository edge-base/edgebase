import 'package:edgebase_core/src/generated/api_core.dart';
import 'package:edgebase_core/src/generated/client_wrappers.dart';
import 'generated/admin_api_core.dart';

typedef AnalyticsProperties = Map<String, dynamic>;

class AnalyticsEvent {
  final String name;
  final AnalyticsProperties? properties;
  final int? timestamp;
  final String? userId;

  const AnalyticsEvent({
    required this.name,
    this.properties,
    this.timestamp,
    this.userId,
  });
}

class AnalyticsClient {
  final GeneratedAnalyticsMethods _methods;
  final GeneratedAdminApi _adminCore;

  AnalyticsClient(GeneratedDbApi core, this._adminCore) : _methods = GeneratedAnalyticsMethods(core);

  Future<Map<String, dynamic>> overview([Map<String, String>? options]) async {
    final raw = await _adminCore.queryAnalytics(_buildQuery('overview', options));
    return _asMap(raw);
  }

  Future<List<Map<String, dynamic>>> timeSeries([Map<String, String>? options]) async {
    final raw = await _adminCore.queryAnalytics(_buildQuery('timeSeries', options));
    return _extractList(_asMap(raw)['timeSeries']);
  }

  Future<List<Map<String, dynamic>>> breakdown([Map<String, String>? options]) async {
    final raw = await _adminCore.queryAnalytics(_buildQuery('breakdown', options));
    return _extractList(_asMap(raw)['breakdown']);
  }

  Future<List<Map<String, dynamic>>> topEndpoints([Map<String, String>? options]) async {
    final raw = await _adminCore.queryAnalytics(_buildQuery('topEndpoints', options));
    return _extractList(_asMap(raw)['topItems']);
  }

  Future<void> track(
    String name, [
    AnalyticsProperties? properties,
    String? userId,
  ]) async {
    await trackBatch([
      AnalyticsEvent(name: name, properties: properties, userId: userId),
    ]);
  }

  Future<void> trackBatch(List<AnalyticsEvent> events) async {
    if (events.isEmpty) return;
    await _methods.track({
      'events': events
          .map((event) => {
                'name': event.name,
                if (event.properties != null) 'properties': event.properties,
                if (event.userId != null) 'userId': event.userId,
                'timestamp': event.timestamp ?? DateTime.now().millisecondsSinceEpoch,
              })
          .toList(growable: false),
    });
  }

  Future<dynamic> queryEvents([Map<String, String>? options]) {
    return _adminCore.queryCustomEvents(options);
  }

  Map<String, String> _buildQuery(String metric, Map<String, String>? options) {
    return <String, String>{
      'metric': metric,
      ...?options,
    };
  }
}

Map<String, dynamic> _asMap(dynamic value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) {
    return value.map((key, entry) => MapEntry(key.toString(), entry));
  }
  return <String, dynamic>{};
}

List<Map<String, dynamic>> _extractList(dynamic value) {
  if (value is! List) return const [];
  return value
      .whereType<Map>()
      .map((item) => item.map((key, entry) => MapEntry(key.toString(), entry)))
      .toList(growable: false);
}
