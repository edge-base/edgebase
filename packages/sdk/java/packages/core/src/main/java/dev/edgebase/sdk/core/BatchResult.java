// EdgeBase Java SDK — Batch operation result.
package dev.edgebase.sdk.core;

import java.util.List;
import java.util.Map;

/**
 * Batch operation result.
 */
public class BatchResult {
    private final int totalProcessed;
    private final int totalSucceeded;
    private final List<Map<String, Object>> errors;

    public BatchResult(int totalProcessed, int totalSucceeded, List<Map<String, Object>> errors) {
        this.totalProcessed = totalProcessed;
        this.totalSucceeded = totalSucceeded;
        this.errors = errors;
    }

    public int getTotalProcessed() {
        return totalProcessed;
    }

    public int getTotalSucceeded() {
        return totalSucceeded;
    }

    public List<Map<String, Object>> getErrors() {
        return errors;
    }
}
