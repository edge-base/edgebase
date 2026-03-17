// EdgeBase Java SDK — Upsert result.
package dev.edgebase.sdk.core;

import java.util.Map;

/**
 * Upsert result containing the record and whether it was created or updated.
 */
public class UpsertResult {
    private final Map<String, Object> record;
    private final boolean inserted;

    public UpsertResult(Map<String, Object> record, boolean inserted) {
        this.record = record;
        this.inserted = inserted;
    }

    public Map<String, Object> getRecord() {
        return record;
    }

    public boolean isInserted() {
        return inserted;
    }
}
