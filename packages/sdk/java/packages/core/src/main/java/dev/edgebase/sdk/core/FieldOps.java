package dev.edgebase.sdk.core;

import java.util.HashMap;
import java.util.Map;

/** Field operation helpers for atomic updates. */
public final class FieldOps {
    private FieldOps() {}

    public static Map<String, Object> increment(Number value) {
        Map<String, Object> op = new HashMap<>();
        op.put("$op", "increment");
        op.put("value", value);
        return op;
    }

    public static Map<String, Object> deleteField() {
        Map<String, Object> op = new HashMap<>();
        op.put("$op", "deleteField");
        return op;
    }
}
