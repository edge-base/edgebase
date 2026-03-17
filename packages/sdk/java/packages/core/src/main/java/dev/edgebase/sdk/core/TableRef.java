// EdgeBase Java SDK — Collection reference & document reference.
// Immutable query builder pattern with full CRUD, batch operations, and database-live.
//
// All HTTP calls delegate to GeneratedDbApi (generated core).
// No hardcoded API paths — the core is the single source of truth.
package dev.edgebase.sdk.core;

import com.google.gson.Gson;
import dev.edgebase.sdk.core.generated.GeneratedDbApi;

import java.util.*;

/**
 * Immutable table reference with query builder.
 *
 * <p>
 * All chaining methods return a new instance — safe for reference sharing.
 *
 * <p>
 * Usage:
 *
 * <pre>{@code
 * ListResult posts = client.db("shared").table("posts")
 *         .where("status", "==", "published")
 *         .orderBy("createdAt", "desc")
 *         .limit(20)
 *         .getList();
 * }</pre>
 */
public class TableRef {
    private static final Gson gson = new Gson();

    private static String buildDatabaseLiveChannel(String namespace, String instanceId, String table, String docId) {
        String base = instanceId != null
                ? "dblive:" + namespace + ":" + instanceId + ":" + table
                : "dblive:" + namespace + ":" + table;
        return docId != null ? base + ":" + docId : base;
    }

    private final GeneratedDbApi core;
    private final String name;
    private final String namespace;
    private final String instanceId;
    private final DatabaseLiveClient databaseLive;
    private final List<FilterTuple> filters;
    private final List<FilterTuple> orFilters;
    private final List<String[]> sorts;
    private final Integer limitValue;
    private final Integer offsetValue;
    private final Integer pageValue;
    private final String searchValue;
    private final String afterCursor;
    private final String beforeCursor;

    public TableRef(GeneratedDbApi core, String name, String namespace, String instanceId, DatabaseLiveClient databaseLive) {
        this(core, name, namespace, instanceId, databaseLive,
                Collections.emptyList(), Collections.emptyList(), Collections.emptyList(),
                null, null, null, null, null, null);
    }

    private TableRef(GeneratedDbApi core, String name, String namespace, String instanceId, DatabaseLiveClient databaseLive,
            List<FilterTuple> filters, List<FilterTuple> orFilters, List<String[]> sorts,
            Integer limitValue, Integer offsetValue, Integer pageValue,
            String searchValue,
            String afterCursor, String beforeCursor) {
        this.core = core;
        this.name = name;
        this.namespace = namespace;
        this.instanceId = instanceId;
        this.databaseLive = databaseLive;
        this.filters = filters;
        this.orFilters = orFilters;
        this.sorts = sorts;
        this.limitValue = limitValue;
        this.offsetValue = offsetValue;
        this.pageValue = pageValue;
        this.searchValue = searchValue;
        this.afterCursor = afterCursor;
        this.beforeCursor = beforeCursor;
    }

    public String getName() {
        return name;
    }

    // ─── Core dispatch helpers (static vs dynamic DB) ───

    /** Dispatch a GET-style read to the correct generated core method. */
    @SuppressWarnings("unchecked")
    private Object coreGet(String method, Map<String, String> query, String id) {
        if (instanceId != null) {
            // Dynamic DB
            return switch (method) {
                case "list" -> core.dbListRecords(namespace, instanceId, name, query);
                case "get" -> core.dbGetRecord(namespace, instanceId, name, id, query);
                case "count" -> core.dbCountRecords(namespace, instanceId, name, query);
                case "search" -> core.dbSearchRecords(namespace, instanceId, name, query);
                default -> throw new IllegalArgumentException("Unknown method: " + method);
            };
        }
        // Single-instance DB
        return switch (method) {
            case "list" -> core.dbSingleListRecords(namespace, name, query);
            case "get" -> core.dbSingleGetRecord(namespace, name, id, query);
            case "count" -> core.dbSingleCountRecords(namespace, name, query);
            case "search" -> core.dbSingleSearchRecords(namespace, name, query);
            default -> throw new IllegalArgumentException("Unknown method: " + method);
        };
    }

    private Object coreInsert(Map<String, ?> body, Map<String, String> query) {
        if (instanceId != null) {
            return core.dbInsertRecord(namespace, instanceId, name, body, query);
        }
        return core.dbSingleInsertRecord(namespace, name, body, query);
    }

    private Object coreUpdate(String id, Map<String, ?> body) {
        if (instanceId != null) {
            return core.dbUpdateRecord(namespace, instanceId, name, id, body);
        }
        return core.dbSingleUpdateRecord(namespace, name, id, body);
    }

    private Object coreDelete(String id) {
        if (instanceId != null) {
            return core.dbDeleteRecord(namespace, instanceId, name, id);
        }
        return core.dbSingleDeleteRecord(namespace, name, id);
    }

    private Object coreBatch(Map<String, ?> body, Map<String, String> query) {
        if (instanceId != null) {
            return core.dbBatchRecords(namespace, instanceId, name, body, query);
        }
        return core.dbSingleBatchRecords(namespace, name, body, query);
    }

    private Object coreBatchByFilter(Map<String, ?> body, Map<String, String> query) {
        if (instanceId != null) {
            return core.dbBatchByFilter(namespace, instanceId, name, body, query);
        }
        return core.dbSingleBatchByFilter(namespace, name, body, query);
    }

    // ─── Query Builder (immutable — returns new instances) ───

    public TableRef where(String field, String op, Object value) {
        List<FilterTuple> newFilters = new ArrayList<>(filters);
        newFilters.add(new FilterTuple(field, op, value));
        return cloneWith(newFilters, orFilters, sorts, limitValue, offsetValue, pageValue,
                searchValue, afterCursor, beforeCursor);
    }

    public static class OrBuilder {
        private final List<FilterTuple> filters = new ArrayList<>();

        public OrBuilder where(String field, String op, Object value) {
            filters.add(new FilterTuple(field, op, value));
            return this;
        }

        public List<FilterTuple> getFilters() {
            return filters;
        }
    }

    public TableRef or(java.util.function.Consumer<OrBuilder> builderFn) {
        OrBuilder builder = new OrBuilder();
        builderFn.accept(builder);
        List<FilterTuple> newOrFilters = new ArrayList<>(orFilters);
        newOrFilters.addAll(builder.getFilters());
        return cloneWith(filters, newOrFilters, sorts, limitValue, offsetValue, pageValue,
                searchValue, afterCursor, beforeCursor);
    }

    public TableRef orderBy(String field) {
        return orderBy(field, "asc");
    }

    public TableRef orderBy(String field, String direction) {
        List<String[]> newSorts = new ArrayList<>(sorts);
        newSorts.add(new String[] { field, direction });
        return cloneWith(filters, orFilters, newSorts, limitValue, offsetValue, pageValue,
                searchValue, afterCursor, beforeCursor);
    }

    public TableRef limit(int n) {
        return cloneWith(filters, orFilters, sorts, n, offsetValue, pageValue,
                searchValue, afterCursor, beforeCursor);
    }

    public TableRef offset(int n) {
        return cloneWith(filters, orFilters, sorts, limitValue, n, pageValue,
                searchValue, afterCursor, beforeCursor);
    }

    public TableRef page(int n) {
        return cloneWith(filters, orFilters, sorts, limitValue, offsetValue, n,
                searchValue, afterCursor, beforeCursor);
    }

    public TableRef search(String query) {
        return cloneWith(filters, orFilters, sorts, limitValue, offsetValue, pageValue,
                query, afterCursor, beforeCursor);
    }

    public TableRef after(String cursor) {
        return cloneWith(filters, orFilters, sorts, limitValue, offsetValue, pageValue,
                searchValue, cursor, null);
    }

    public TableRef before(String cursor) {
        return cloneWith(filters, orFilters, sorts, limitValue, offsetValue, pageValue,
                searchValue, null, cursor);
    }

    // ─── CRUD ───

    @SuppressWarnings("unchecked")
    public ListResult getList() {
        Map<String, String> params = buildQueryParams();
        Map<String, Object> json;
        if (searchValue != null) {
            params.put("search", searchValue);
            json = (Map<String, Object>) coreGet("search", params, null);
        } else {
            json = (Map<String, Object>) coreGet("list", params, null);
        }
        return new ListResult(
                (List<Map<String, Object>>) json.getOrDefault("items", Collections.emptyList()),
                json.get("total") instanceof Number ? ((Number) json.get("total")).intValue() : null,
                json.get("page") instanceof Number ? ((Number) json.get("page")).intValue() : null,
                json.get("perPage") instanceof Number ? ((Number) json.get("perPage")).intValue() : null,
                json.get("hasMore") instanceof Boolean ? (Boolean) json.get("hasMore") : null,
                (String) json.get("cursor"));
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> getOne(String id) {
        return doc(id).get();
    }

    /** Get the first record matching the current query conditions. Returns null if no match. */
    public Map<String, Object> getFirst() {
        ListResult result = limit(1).getList();
        return result.getItems().isEmpty() ? null : result.getItems().get(0);
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> insert(Map<String, Object> record) {
        return (Map<String, Object>) coreInsert(record, Collections.emptyMap());
    }

    @SuppressWarnings("unchecked")
    public UpsertResult upsert(Map<String, Object> record) {
        return upsert(record, null);
    }

    @SuppressWarnings("unchecked")
    public UpsertResult upsert(Map<String, Object> record, String conflictTarget) {
        Map<String, String> query = new LinkedHashMap<>();
        query.put("upsert", "true");
        if (conflictTarget != null) {
            query.put("conflictTarget", conflictTarget);
        }
        Map<String, Object> json = (Map<String, Object>) coreInsert(record, query);
        return new UpsertResult(json, "inserted".equals(json.get("action")));
    }

    @SuppressWarnings("unchecked")
    public int count() {
        Map<String, String> params = buildQueryParams();
        Map<String, Object> json = (Map<String, Object>) coreGet("count", params, null);
        return json.get("total") instanceof Number ? ((Number) json.get("total")).intValue() : 0;
    }

    // ─── Batch Operations ───

    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> insertMany(List<Map<String, Object>> records) {
        int chunkSize = 500;

        if (records.size() <= chunkSize) {
            Map<String, Object> json = (Map<String, Object>) coreBatch(
                    Map.of("inserts", records), Collections.emptyMap());
            return (List<Map<String, Object>>) json.getOrDefault("inserted", Collections.emptyList());
        }

        List<Map<String, Object>> allInserted = new ArrayList<>();
        for (int i = 0; i < records.size(); i += chunkSize) {
            List<Map<String, Object>> chunk = records.subList(i, Math.min(i + chunkSize, records.size()));
            Map<String, Object> json = (Map<String, Object>) coreBatch(
                    Map.of("inserts", chunk), Collections.emptyMap());
            List<Map<String, Object>> inserted = (List<Map<String, Object>>) json.getOrDefault("inserted",
                    Collections.emptyList());
            allInserted.addAll(inserted);
        }
        return allInserted;
    }

    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> upsertMany(List<Map<String, Object>> records) {
        return upsertMany(records, null);
    }

    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> upsertMany(List<Map<String, Object>> records, String conflictTarget) {
        int chunkSize = 500;
        Map<String, String> query = new LinkedHashMap<>();
        query.put("upsert", "true");
        if (conflictTarget != null) {
            query.put("conflictTarget", conflictTarget);
        }

        if (records.size() <= chunkSize) {
            Map<String, Object> json = (Map<String, Object>) coreBatch(
                    Map.of("inserts", records), query);
            return (List<Map<String, Object>>) json.getOrDefault("inserted", Collections.emptyList());
        }

        List<Map<String, Object>> allInserted = new ArrayList<>();
        for (int i = 0; i < records.size(); i += chunkSize) {
            List<Map<String, Object>> chunk = records.subList(i, Math.min(i + chunkSize, records.size()));
            Map<String, Object> json = (Map<String, Object>) coreBatch(
                    Map.of("inserts", chunk), query);
            List<Map<String, Object>> inserted = (List<Map<String, Object>>) json.getOrDefault("inserted",
                    Collections.emptyList());
            allInserted.addAll(inserted);
        }
        return allInserted;
    }

    public BatchResult updateMany(Map<String, Object> update) {
        if (filters.isEmpty())
            throw new IllegalArgumentException("updateMany requires at least one where() filter");
        return batchByFilter("update", update);
    }

    public BatchResult deleteMany() {
        if (filters.isEmpty())
            throw new IllegalArgumentException("deleteMany requires at least one where() filter");
        return batchByFilter("delete", null);
    }

    @SuppressWarnings("unchecked")
    private BatchResult batchByFilter(String action, Map<String, Object> update) {
        int maxIterations = 100;
        int totalProcessed = 0;
        int totalSucceeded = 0;
        List<Map<String, Object>> errors = new ArrayList<>();
        List<Object> filterJson = filters.stream().map(f -> (Object) f.toJson()).toList();

        for (int chunkIndex = 0; chunkIndex < maxIterations; chunkIndex++) {
            try {
                Map<String, Object> body = new HashMap<>();
                body.put("action", action);
                body.put("filter", filterJson);
                body.put("limit", 500);
                if (!orFilters.isEmpty()) {
                    body.put("orFilter", orFilters.stream().map(f -> (Object) f.toJson()).toList());
                }
                if ("update".equals(action) && update != null) {
                    body.put("update", update);
                }

                Map<String, Object> json = (Map<String, Object>) coreBatchByFilter(body, Collections.emptyMap());
                int processed = json.get("processed") instanceof Number
                        ? ((Number) json.get("processed")).intValue()
                        : 0;
                int succeeded = json.get("succeeded") instanceof Number
                        ? ((Number) json.get("succeeded")).intValue()
                        : 0;
                totalProcessed += processed;
                totalSucceeded += succeeded;

                if (processed == 0)
                    break;

                // For 'update', don't loop — updated records still match the filter,
                // so re-querying would process the same rows again (infinite loop).
                // Only 'delete' benefits from looping since deleted rows disappear.
                if ("update".equals(action))
                    break;
            } catch (Exception e) {
                errors.add(Map.of("chunkIndex", chunkIndex, "chunkSize", 500,
                        "error", e.getMessage() != null ? e.getMessage() : "Unknown error"));
                break;
            }
        }
        return new BatchResult(totalProcessed, totalSucceeded, errors);
    }

    // ─── Document Reference ───

    public DocRef doc(String id) {
        return new DocRef(core, namespace, instanceId, name, id, databaseLive);
    }

    // ─── DatabaseLive ─── 

    /**
     * Subscribe to table changes.
     * Only available when using client-side SDK (EdgeBase.client()).
     *
     * @param listener callback invoked for each change event
     * @return a Subscription that can be closed to unsubscribe
     */
    public DatabaseLiveClient.Subscription onSnapshot(java.util.function.Consumer<DbChange> listener) {
        if (databaseLive == null) {
            throw new UnsupportedOperationException(
                    "onSnapshot() is not available on the server SDK. Use EdgeBase.client() for database-live subscriptions.");
        }
        return databaseLive.subscribe(buildDatabaseLiveChannel(namespace, instanceId, name, null), change -> {
            if (matchesFilters(change.getRecord())) {
                listener.accept(change);
            }
        });
    }

    // ─── Internal ───

    private TableRef cloneWith(List<FilterTuple> filters, List<FilterTuple> orFilters, List<String[]> sorts,
            Integer limitValue, Integer offsetValue, Integer pageValue,
            String searchValue,
            String afterCursor, String beforeCursor) {
        return new TableRef(core, name, namespace, instanceId, databaseLive,
                filters, orFilters, sorts, limitValue,
                offsetValue, pageValue, searchValue,
                afterCursor, beforeCursor);
    }

    private Map<String, String> buildQueryParams() {
        boolean hasCursor = afterCursor != null || beforeCursor != null;
        boolean hasOffset = offsetValue != null || pageValue != null;
        if (hasCursor && hasOffset) {
            throw new IllegalArgumentException(
                    "Cannot use page()/offset() with after()/before() — choose offset or cursor pagination");
        }

        Map<String, String> params = new LinkedHashMap<>();
        if (!filters.isEmpty()) {
            List<Object> filterList = filters.stream().map(f -> (Object) f.toJson()).toList();
            params.put("filter", gson.toJson(filterList));
        }
        if (!orFilters.isEmpty()) {
            List<Object> orFilterList = orFilters.stream().map(f -> (Object) f.toJson()).toList();
            params.put("orFilter", gson.toJson(orFilterList));
        }
        if (!sorts.isEmpty()) {
            StringJoiner sj = new StringJoiner(",");
            for (String[] sort : sorts)
                sj.add(sort[0] + ":" + sort[1]);
            params.put("sort", sj.toString());
        }
        if (limitValue != null)
            params.put("limit", limitValue.toString());
        if (pageValue != null)
            params.put("page", pageValue.toString());
        if (offsetValue != null)
            params.put("offset", offsetValue.toString());
        if (afterCursor != null)
            params.put("after", afterCursor);
        if (beforeCursor != null)
            params.put("before", beforeCursor);
        return params;
    }

    private boolean matchesFilters(Map<String, Object> record) {
        if (record == null)
            return true;

        boolean andPass = filters.isEmpty() || filters.stream().allMatch(filter -> {
            Object fieldValue = record.get(filter.getField());
            return switch (filter.getOp()) {
                case "==" -> Objects.equals(fieldValue, filter.getValue());
                case "!=" -> !Objects.equals(fieldValue, filter.getValue());
                case ">" -> compareValues(fieldValue, filter.getValue()) > 0;
                case ">=" -> compareValues(fieldValue, filter.getValue()) >= 0;
                case "<" -> compareValues(fieldValue, filter.getValue()) < 0;
                case "<=" -> compareValues(fieldValue, filter.getValue()) <= 0;
                default -> true;
            };
        });
        if (!andPass)
            return false;

        if (!orFilters.isEmpty()) {
            boolean orPass = orFilters.stream().anyMatch(filter -> {
                Object fieldValue = record.get(filter.getField());
                return switch (filter.getOp()) {
                    case "==" -> Objects.equals(fieldValue, filter.getValue());
                    case "!=" -> !Objects.equals(fieldValue, filter.getValue());
                    case ">" -> compareValues(fieldValue, filter.getValue()) > 0;
                    case ">=" -> compareValues(fieldValue, filter.getValue()) >= 0;
                    case "<" -> compareValues(fieldValue, filter.getValue()) < 0;
                    case "<=" -> compareValues(fieldValue, filter.getValue()) <= 0;
                    default -> true;
                };
            });
            if (!orPass)
                return false;
        }

        return true;
    }

    @SuppressWarnings({ "unchecked", "rawtypes" })
    private int compareValues(Object a, Object b) {
        if (a == null && b == null)
            return 0;
        if (a == null)
            return -1;
        if (b == null)
            return 1;
        if (a instanceof Comparable && b instanceof Comparable) {
            return ((Comparable) a).compareTo(b);
        }
        return a.toString().compareTo(b.toString());
    }
}
