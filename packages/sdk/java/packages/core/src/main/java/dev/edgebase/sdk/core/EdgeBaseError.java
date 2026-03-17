// EdgeBase Java SDK — Error types.
package dev.edgebase.sdk.core;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * General EdgeBase API error.
 *
 * <p>
 * Contains HTTP status code, message, and optional field-level validation
 * details.
 */
public class EdgeBaseError extends RuntimeException {
    private final int statusCode;
    private final Map<String, List<String>> details;

    public EdgeBaseError(int statusCode, String message) {
        this(statusCode, message, null);
    }

    /** Convenience overload: (message, statusCode) — matches test usage */
    public EdgeBaseError(String message, int statusCode) {
        this(statusCode, message, null);
    }

    /** Convenience overload: (message only) — statusCode defaults to 0 */
    public EdgeBaseError(String message) {
        this(0, message, null);
    }

    public EdgeBaseError(int statusCode, String message, Map<String, List<String>> details) {
        super(message);
        this.statusCode = statusCode;
        this.details = details;
    }

    public int getStatusCode() {
        return statusCode;
    }

    public Map<String, List<String>> getDetails() {
        return details;
    }

    @Override
    public String toString() {
        String base = "EdgeBaseError(" + statusCode + "): " + getMessage();
        if (details == null || details.isEmpty())
            return base;
        String fieldInfo = details.entrySet().stream()
                .map(e -> e.getKey() + ": " + String.join(", ", e.getValue()))
                .collect(Collectors.joining(", "));
        return base + " [" + fieldInfo + "]";
    }

    @SuppressWarnings("unchecked")
    public static EdgeBaseError fromJson(Map<String, Object> json, int statusCode) {
        String message = json.containsKey("message") ? String.valueOf(json.get("message")) : "Unknown error";
        Map<String, Object> rawDetails = (Map<String, Object>) json.get("details");
        Map<String, List<String>> details = null;
        if (rawDetails != null) {
            details = rawDetails.entrySet().stream().collect(Collectors.toMap(
                    Map.Entry::getKey,
                    e -> {
                        if (e.getValue() instanceof List) {
                            return ((List<?>) e.getValue()).stream()
                                    .map(String::valueOf).collect(Collectors.toList());
                        }
                        return List.of(String.valueOf(e.getValue()));
                    }));
        }
        return new EdgeBaseError(statusCode, message, details);
    }
}
