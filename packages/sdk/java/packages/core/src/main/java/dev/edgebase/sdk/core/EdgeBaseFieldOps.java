// EdgeBase Java SDK — Field operation helpers.
package dev.edgebase.sdk.core;

import java.util.HashMap;
import java.util.Map;

/**
 * Field operation helpers for atomic updates.
 *
 * <p>
 * Usage:
 * 
 * <pre>{@code
 * docRef.update(Map.of("views", EdgeBaseFieldOps.increment(1)));
 * docRef.update(Map.of("temp", EdgeBaseFieldOps.deleteField()));
 * }</pre>
 */
public final class EdgeBaseFieldOps {
    private EdgeBaseFieldOps() {
    }

    /**
     * Atomically increment a numeric field.
     */
    public static Map<String, Object> increment(Number value) {
        Map<String, Object> op = new HashMap<>();
        op.put("$op", "increment");
        op.put("value", value);
        return op;
    }

    /**
     * Mark a field for deletion.
     */
    public static Map<String, Object> deleteField() {
        Map<String, Object> op = new HashMap<>();
        op.put("$op", "deleteField");
        return op;
    }
}
