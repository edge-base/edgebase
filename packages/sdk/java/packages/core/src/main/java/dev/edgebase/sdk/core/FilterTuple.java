// EdgeBase Java SDK — Filter tuple for query building.
package dev.edgebase.sdk.core;

import java.util.Arrays;
import java.util.List;

/**
 * Filter tuple for query building: [field, operator, value].
 */
public class FilterTuple {
    private final String field;
    private final String op;
    private final Object value;

    public FilterTuple(String field, String op, Object value) {
        this.field = field;
        this.op = op;
        this.value = value;
    }

    public String getField() {
        return field;
    }

    public String getOp() {
        return op;
    }

    public Object getValue() {
        return value;
    }

    public List<Object> toJson() {
        return Arrays.asList(field, op, value);
    }
}
