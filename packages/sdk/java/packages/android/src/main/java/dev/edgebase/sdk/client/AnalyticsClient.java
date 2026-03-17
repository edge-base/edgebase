package dev.edgebase.sdk.client;

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

        public AnalyticsEvent(String name) {
            this(name, Collections.emptyMap(), null);
        }

        public AnalyticsEvent(String name, Map<String, ?> properties, Long timestamp) {
            this.name = name;
            this.properties = properties;
            this.timestamp = timestamp;
        }
    }

    private final GeneratedClientWrappers.AnalyticsMethods methods;

    public AnalyticsClient(GeneratedDbApi core) {
        this.methods = new GeneratedClientWrappers.AnalyticsMethods(core);
    }

    public void track(String name) throws EdgeBaseError {
        track(name, Collections.emptyMap());
    }

    public void track(String name, Map<String, ?> properties) throws EdgeBaseError {
        trackBatch(Collections.singletonList(new AnalyticsEvent(name, properties, null)));
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
            payload.put("timestamp", event.timestamp != null ? event.timestamp : System.currentTimeMillis());
            payloadEvents.add(payload);
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("events", payloadEvents);
        methods.track(body);
    }

    public void flush() {
        // Java client sends analytics immediately, so flush is a compatibility no-op.
    }

    public void destroy() {
        // No retained listeners/resources in the Java implementation.
    }
}
