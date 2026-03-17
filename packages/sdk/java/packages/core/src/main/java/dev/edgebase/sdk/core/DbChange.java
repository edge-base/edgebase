package dev.edgebase.sdk.core;

import java.util.Map;

/** Database change event from database-live subscription. */
public class DbChange {
    private final String type;
    private final String table;
    private final String id;
    private final Map<String, Object> record;
    private final Map<String, Object> oldRecord;

    public DbChange(String type, String table, String id, Map<String, Object> record,
            Map<String, Object> oldRecord) {
        this.type = type;
        this.table = table;
        this.id = id;
        this.record = record;
        this.oldRecord = oldRecord;
    }

    public String getType() {
        return type;
    }

    public String getTable() {
        return table;
    }

    public String getId() {
        return id;
    }

    public Map<String, Object> getRecord() {
        return record;
    }

    public Map<String, Object> getOldRecord() {
        return oldRecord;
    }

    @SuppressWarnings("unchecked")
    public static DbChange fromJson(Map<String, Object> json) {
        return new DbChange(
                (String) json.getOrDefault("type", ""),
                (String) json.getOrDefault("table", ""),
                (String) json.getOrDefault("id", ""),
                json.containsKey("record") ? (Map<String, Object>) json.get("record") : null,
                json.containsKey("oldRecord") ? (Map<String, Object>) json.get("oldRecord") : null);
    }
}
