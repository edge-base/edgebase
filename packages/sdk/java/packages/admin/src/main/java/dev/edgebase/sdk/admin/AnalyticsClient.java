package dev.edgebase.sdk.admin;

import dev.edgebase.sdk.core.EdgeBaseError;
import dev.edgebase.sdk.core.generated.GeneratedClientWrappers;
import dev.edgebase.sdk.core.generated.GeneratedDbApi;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class AnalyticsClient {
    public static class AnalyticsEvent {
        public final String name;
        public final Map<String, ?> properties;
        public final Long timestamp;
        public final String userId;

        public AnalyticsEvent(String name) {
            this(name, Collections.emptyMap(), null, null);
        }

        public AnalyticsEvent(String name, Map<String, ?> properties, Long timestamp, String userId) {
            this.name = name;
            this.properties = properties;
            this.timestamp = timestamp;
            this.userId = userId;
        }
    }

    private final GeneratedClientWrappers.AnalyticsMethods methods;
    private final dev.edgebase.sdk.admin.generated.GeneratedAdminApi adminCore;

    public AnalyticsClient(GeneratedDbApi core, dev.edgebase.sdk.admin.generated.GeneratedAdminApi adminCore) {
        this.methods = new GeneratedClientWrappers.AnalyticsMethods(core);
        this.adminCore = adminCore;
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> overview() throws EdgeBaseError {
        Object result = adminCore.queryAnalytics(Map.of("metric", "overview"));
        return result instanceof Map<?, ?> map ? (Map<String, Object>) map : Collections.emptyMap();
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> overview(Map<String, String> options) throws EdgeBaseError {
        Object result = adminCore.queryAnalytics(buildQuery("overview", options));
        return result instanceof Map<?, ?> map ? (Map<String, Object>) map : Collections.emptyMap();
    }

    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> timeSeries() throws EdgeBaseError {
        return timeSeries(Collections.emptyMap());
    }

    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> timeSeries(Map<String, String> options) throws EdgeBaseError {
        Object result = adminCore.queryAnalytics(buildQuery("timeSeries", options));
        if (result instanceof Map<?, ?> map && map.get("timeSeries") instanceof List<?> list) {
            return (List<Map<String, Object>>) list;
        }
        return Collections.emptyList();
    }

    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> breakdown() throws EdgeBaseError {
        return breakdown(Collections.emptyMap());
    }

    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> breakdown(Map<String, String> options) throws EdgeBaseError {
        Object result = adminCore.queryAnalytics(buildQuery("breakdown", options));
        if (result instanceof Map<?, ?> map && map.get("breakdown") instanceof List<?> list) {
            return (List<Map<String, Object>>) list;
        }
        return Collections.emptyList();
    }

    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> topEndpoints() throws EdgeBaseError {
        return topEndpoints(Collections.emptyMap());
    }

    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> topEndpoints(Map<String, String> options) throws EdgeBaseError {
        Object result = adminCore.queryAnalytics(buildQuery("topEndpoints", options));
        if (result instanceof Map<?, ?> map && map.get("topItems") instanceof List<?> list) {
            return (List<Map<String, Object>>) list;
        }
        return Collections.emptyList();
    }

    public void track(String name) throws EdgeBaseError {
        track(name, Collections.emptyMap(), null);
    }

    public void track(String name, Map<String, ?> properties) throws EdgeBaseError {
        track(name, properties, null);
    }

    public void track(String name, Map<String, ?> properties, String userId) throws EdgeBaseError {
        trackBatch(Collections.singletonList(new AnalyticsEvent(name, properties, null, userId)));
    }

    public void trackBatch(List<AnalyticsEvent> events) throws EdgeBaseError {
        if (events == null || events.isEmpty()) {
            return;
        }

        List<Map<String, Object>> payloadEvents = new ArrayList<>();
        for (AnalyticsEvent event : events) {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("name", event.name);
            if (event.properties != null && !event.properties.isEmpty()) {
                payload.put("properties", event.properties);
            }
            if (event.userId != null && !event.userId.isEmpty()) {
                payload.put("userId", event.userId);
            }
            payload.put("timestamp", event.timestamp != null ? event.timestamp : System.currentTimeMillis());
            payloadEvents.add(payload);
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("events", payloadEvents);
        methods.track(body);
    }

    public Object queryEvents() throws EdgeBaseError {
        return queryEvents(Collections.emptyMap());
    }

    public Object queryEvents(Map<String, String> options) throws EdgeBaseError {
        return adminCore.queryCustomEvents(options);
    }

    public void destroy() {
        // Admin analytics calls are request-scoped; destroy is a compatibility no-op.
    }

    private Map<String, String> buildQuery(String metric, Map<String, String> options) {
        Map<String, String> query = new LinkedHashMap<>();
        query.put("metric", metric);
        if (options != null) {
            query.putAll(options);
        }
        return query;
    }
}
