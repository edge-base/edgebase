import 'package:edgebase_core/src/generated/client_wrappers.dart';
import 'package:edgebase_core/src/generated/api_core.dart';

typedef AnalyticsProperties = Map<String, dynamic>;

class AnalyticsEvent {
  final String name;
  final AnalyticsProperties? properties;
  final int? timestamp;

  const AnalyticsEvent({
    required this.name,
    this.properties,
    this.timestamp,
  });
}

class ClientAnalytics {
  final GeneratedAnalyticsMethods _methods;

  ClientAnalytics(GeneratedDbApi core) : _methods = GeneratedAnalyticsMethods(core);

  Future<void> track(String name, [AnalyticsProperties? properties]) async {
    await trackBatch([AnalyticsEvent(name: name, properties: properties)]);
  }

  Future<void> trackBatch(List<AnalyticsEvent> events) async {
    if (events.isEmpty) return;
    await _methods.track({
      'events': events
          .map((event) => {
                'name': event.name,
                if (event.properties != null) 'properties': event.properties,
                'timestamp': event.timestamp ?? DateTime.now().millisecondsSinceEpoch,
              })
          .toList(growable: false),
    });
  }

  Future<void> flush() async {}

  void destroy() {}
}
