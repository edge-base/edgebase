/**
 * EdgeBase Java SDK — AdminEdgeBase
 *
 * BUG-005 수정: org.json 제거 → Gson(com.google.gson) 기반으로 재작성
 *
 * 의존성 (build.gradle에 이미 포함):
 *   com.squareup.okhttp3:okhttp:4.12.0
 *   com.google.code.gson:gson:2.11.0
 */

package io.edgebase.sdk;

import com.google.gson.*;
import okhttp3.*;

import java.io.IOException;
import java.util.*;
import java.util.concurrent.*;

// ─── SharedGson ───────────────────────────────────────────────────────────────

class SharedGson {
    static final Gson GSON = new Gson();
}

// ─── EdgeBaseException
// ────────────────────────────────────────────────────────

class EdgeBaseException extends RuntimeException {
    final int code;

    EdgeBaseException(int code, String message) {
        super(message);
        this.code = code;
    }
}

// ─── FieldOp helpers ─────────────────────────────────────────────────────────

class FieldOp {
    final String op;
    final Number value;

    private FieldOp(String op, Number value) {
        this.op = op;
        this.value = value;
    }

    static FieldOp increment(Number n) {
        return new FieldOp("increment", n);
    }

    static FieldOp deleteField() {
        return new FieldOp("deleteField", null);
    }
}

// ─── ListResult
// ───────────────────────────────────────────────────────────────

class ListResult {
    final List<JsonObject> items;
    final Integer total;
    final Integer page;
    final Integer perPage;
    final Boolean hasMore;
    final String cursor;

    ListResult(List<JsonObject> items, Integer total, Integer page,
            Integer perPage, Boolean hasMore, String cursor) {
        this.items = items;
        this.total = total;
        this.page = page;
        this.perPage = perPage;
        this.hasMore = hasMore;
        this.cursor = cursor;
    }
}

// ─── HttpClient
// ───────────────────────────────────────────────────────────────

class EdgeBaseHttpClient {
    private final OkHttpClient client;
    private final String baseUrl;
    private final String apiPrefix;
    private final String serviceKey;
    private volatile String accessToken;

    private static final MediaType JSON_MT = MediaType.parse("application/json; charset=utf-8");

    EdgeBaseHttpClient(String baseUrl, String serviceKey) {
        this(baseUrl, serviceKey, "/api");
    }

    EdgeBaseHttpClient(String baseUrl, String serviceKey, String apiPrefix) {
        this.client = new OkHttpClient();
        this.baseUrl = baseUrl.replaceAll("/$", "");
        this.apiPrefix = apiPrefix;
        this.serviceKey = serviceKey;
    }

    void setToken(String token) {
        this.accessToken = token;
    }

    private Headers buildHeaders() {
        Headers.Builder b = new Headers.Builder();
        b.add("Content-Type", "application/json");
        if (serviceKey != null && !serviceKey.isEmpty())
            b.add("X-EdgeBase-Service-Key", serviceKey);
        if (accessToken != null && !accessToken.isEmpty())
            b.add("Authorization", "Bearer " + accessToken);
        return b.build();
    }

    private static String serializeBody(Map<String, Object> data) {
        JsonObject root = new JsonObject();
        for (Map.Entry<String, Object> e : data.entrySet()) {
            Object v = e.getValue();
            if (v instanceof FieldOp) {
                FieldOp f = (FieldOp) v;
                JsonObject op = new JsonObject();
                op.addProperty("$op", f.op);
                if (f.value != null)
                    op.addProperty("value", f.value.doubleValue());
                root.add(e.getKey(), op);
            } else if (v instanceof String) {
                root.addProperty(e.getKey(), (String) v);
            } else if (v instanceof Number) {
                root.addProperty(e.getKey(), (Number) v);
            } else if (v instanceof Boolean) {
                root.addProperty(e.getKey(), (Boolean) v);
            } else if (v == null) {
                root.add(e.getKey(), JsonNull.INSTANCE);
            } else {
                root.add(e.getKey(), SharedGson.GSON.toJsonTree(v));
            }
        }
        return root.toString();
    }

    JsonObject get(String path, Map<String, String> query) {
        HttpUrl.Builder urlBuilder = Objects.requireNonNull(HttpUrl.parse(baseUrl + apiPrefix + path)).newBuilder();
        if (query != null) {
            for (Map.Entry<String, String> e : query.entrySet()) {
                urlBuilder.addQueryParameter(e.getKey(), e.getValue());
            }
        }
        Request req = new Request.Builder().url(urlBuilder.build()).headers(buildHeaders()).get().build();
        return execute(req);
    }

    JsonObject post(String path, Map<String, Object> body) {
        RequestBody rb = RequestBody.create(serializeBody(body), JSON_MT);
        Request req = new Request.Builder().url(baseUrl + apiPrefix + path).headers(buildHeaders()).post(rb).build();
        return execute(req);
    }

    JsonObject postRaw(String path, String bodyStr) {
        RequestBody rb = RequestBody.create(bodyStr, JSON_MT);
        Request req = new Request.Builder().url(baseUrl + apiPrefix + path).headers(buildHeaders()).post(rb).build();
        return execute(req);
    }

    JsonObject patch(String path, Map<String, Object> body) {
        RequestBody rb = RequestBody.create(serializeBody(body), JSON_MT);
        Request req = new Request.Builder().url(baseUrl + apiPrefix + path).headers(buildHeaders()).patch(rb).build();
        return execute(req);
    }

    JsonObject delete(String path) {
        Request req = new Request.Builder().url(baseUrl + apiPrefix + path).headers(buildHeaders()).delete().build();
        return execute(req);
    }

    private JsonObject execute(Request req) {
        try (Response resp = client.newCall(req).execute()) {
            String bodyStr = resp.body() != null ? resp.body().string() : "";
            if (!resp.isSuccessful()) {
                String msg = "HTTP " + resp.code();
                try {
                    JsonObject errJson = JsonParser.parseString(bodyStr).getAsJsonObject();
                    if (errJson.has("message"))
                        msg = errJson.get("message").getAsString();
                } catch (Exception ignored) {
                }
                throw new EdgeBaseException(resp.code(), msg);
            }
            if (bodyStr.isEmpty())
                return new JsonObject();
            JsonElement el = JsonParser.parseString(bodyStr);
            return el.isJsonObject() ? el.getAsJsonObject() : new JsonObject();
        } catch (IOException e) {
            throw new EdgeBaseException(0, "Network error: " + e.getMessage());
        }
    }
}

// ─── TableRef (immutable query builder) ──────────────────────────────────────

class TableRef {
    private final EdgeBaseHttpClient http;
    private final String tableName;
    private final String namespace;
    private final String instanceId;
    private final List<Object[]> filters;
    private final List<Object[]> orFilters;
    private final List<String[]> sorts;
    private final Integer limitVal;
    private final Integer offsetVal;
    private final Integer pageVal;
    private final String afterCursor;
    private final String beforeCursor;
    private final String searchQuery;

    TableRef(EdgeBaseHttpClient http, String tableName, String namespace, String instanceId,
            List<Object[]> filters, List<Object[]> orFilters, List<String[]> sorts,
            Integer limitVal, Integer offsetVal, Integer pageVal,
            String afterCursor, String beforeCursor, String searchQuery) {
        this.http = http;
        this.tableName = tableName;
        this.namespace = namespace;
        this.instanceId = instanceId;
        this.filters = filters;
        this.orFilters = orFilters;
        this.sorts = sorts;
        this.limitVal = limitVal;
        this.offsetVal = offsetVal;
        this.pageVal = pageVal;
        this.afterCursor = afterCursor;
        this.beforeCursor = beforeCursor;
        this.searchQuery = searchQuery;
    }

    TableRef(EdgeBaseHttpClient http, String tableName) {
        this(http, tableName, "shared", null, new ArrayList<>(), new ArrayList<>(),
                new ArrayList<>(), null, null, null, null, null, null);
    }

    private String basePath() {
        return instanceId != null
                ? "/db/" + namespace + "/" + instanceId + "/tables/" + tableName
                : "/db/" + namespace + "/tables/" + tableName;
    }

    private Map<String, String> buildQuery() {
        Map<String, String> q = new LinkedHashMap<>();
        if (!filters.isEmpty()) {
            JsonArray arr = new JsonArray();
            for (Object[] f : filters) {
                JsonArray tuple = new JsonArray();
                tuple.add(String.valueOf(f[0]));
                tuple.add(String.valueOf(f[1]));
                tuple.add(SharedGson.GSON.toJsonTree(f[2]));
                arr.add(tuple);
            }
            q.put("filter", arr.toString());
        }
        if (!orFilters.isEmpty()) {
            JsonArray arr = new JsonArray();
            for (Object[] f : orFilters) {
                JsonArray tuple = new JsonArray();
                tuple.add(String.valueOf(f[0]));
                tuple.add(String.valueOf(f[1]));
                tuple.add(SharedGson.GSON.toJsonTree(f[2]));
                arr.add(tuple);
            }
            q.put("orFilter", arr.toString());
        }
        if (!sorts.isEmpty()) {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < sorts.size(); i++) {
                if (i > 0)
                    sb.append(",");
                sb.append(sorts.get(i)[0]).append(":").append(sorts.get(i)[1]);
            }
            q.put("sort", sb.toString());
        }
        if (limitVal != null)
            q.put("limit", limitVal.toString());
        if (offsetVal != null)
            q.put("offset", offsetVal.toString());
        if (pageVal != null)
            q.put("page", pageVal.toString());
        if (afterCursor != null)
            q.put("after", afterCursor);
        if (beforeCursor != null)
            q.put("before", beforeCursor);
        return q;
    }

    private TableRef copyWith(List<Object[]> filters, List<Object[]> orFilters, List<String[]> sorts,
            Integer limitVal, Integer offsetVal, Integer pageVal,
            String afterCursor, String beforeCursor, String searchQuery) {
        return new TableRef(http, tableName, namespace, instanceId, filters, orFilters, sorts,
                limitVal, offsetVal, pageVal, afterCursor, beforeCursor, searchQuery);
    }

    TableRef where(String field, String op, Object value) {
        List<Object[]> f = new ArrayList<>(filters);
        f.add(new Object[] { field, op, value });
        return copyWith(f, orFilters, sorts, limitVal, offsetVal, pageVal, afterCursor, beforeCursor, searchQuery);
    }

    TableRef orderBy(String field, String direction) {
        List<String[]> s = new ArrayList<>(sorts);
        s.add(new String[] { field, direction });
        return copyWith(filters, orFilters, s, limitVal, offsetVal, pageVal, afterCursor, beforeCursor, searchQuery);
    }

    TableRef limit(int n) {
        return copyWith(filters, orFilters, sorts, n, offsetVal, pageVal, afterCursor, beforeCursor, searchQuery);
    }

    TableRef offset(int n) {
        return copyWith(filters, orFilters, sorts, limitVal, n, pageVal, afterCursor, beforeCursor, searchQuery);
    }

    TableRef page(int n) {
        return copyWith(filters, orFilters, sorts, limitVal, offsetVal, n, afterCursor, beforeCursor, searchQuery);
    }

    TableRef after(String cursor) {
        return copyWith(filters, orFilters, sorts, limitVal, offsetVal, pageVal, cursor, null, searchQuery);
    }

    TableRef before(String cursor) {
        return copyWith(filters, orFilters, sorts, limitVal, offsetVal, pageVal, null, cursor, searchQuery);
    }

    TableRef search(String q) {
        return copyWith(filters, orFilters, sorts, limitVal, offsetVal, pageVal, afterCursor, beforeCursor, q);
    }

    // CRUD

    ListResult getList() {
        String path = searchQuery != null ? basePath() + "/search" : basePath();
        Map<String, String> query = buildQuery();
        if (searchQuery != null)
            query.put("search", searchQuery);
        JsonObject data = http.get(path, query);
        List<JsonObject> items = new ArrayList<>();
        if (data.has("items") && data.get("items").isJsonArray()) {
            data.get("items").getAsJsonArray().forEach(el -> {
                if (el.isJsonObject())
                    items.add(el.getAsJsonObject());
            });
        }
        return new ListResult(
                items,
                data.has("total") && !data.get("total").isJsonNull() ? data.get("total").getAsInt() : null,
                data.has("page") && !data.get("page").isJsonNull() ? data.get("page").getAsInt() : null,
                data.has("perPage") && !data.get("perPage").isJsonNull() ? data.get("perPage").getAsInt() : null,
                data.has("hasMore") && !data.get("hasMore").isJsonNull() ? data.get("hasMore").getAsBoolean() : null,
                data.has("cursor") && !data.get("cursor").isJsonNull() ? data.get("cursor").getAsString() : null);
    }

    JsonObject getOne(String id) {
        return http.get(basePath() + "/" + id, null);
    }

    JsonObject insert(Map<String, Object> body) {
        return http.post(basePath(), body);
    }

    JsonObject update(String id, Map<String, Object> data) {
        return http.patch(basePath() + "/" + id, data);
    }

    void delete(String id) {
        http.delete(basePath() + "/" + id);
    }

    JsonObject upsert(Map<String, Object> data, String conflictTarget) {
        String path = basePath() + "?upsert=true";
        if (conflictTarget != null)
            path += "&conflictTarget=" + conflictTarget;
        return http.postRaw(path, buildFieldOpsJson(data));
    }

    int count() {
        JsonObject r = http.get(basePath() + "/count", buildQuery());
        return r.has("total") ? r.get("total").getAsInt() : 0;
    }

    List<JsonObject> insertMany(List<Map<String, Object>> items) {
        JsonArray arr = new JsonArray();
        for (Map<String, Object> item : items) {
            arr.add(SharedGson.GSON.toJsonTree(item));
        }
        JsonObject payload = new JsonObject();
        payload.add("inserts", arr);
        JsonObject result = http.postRaw(basePath() + "/batch", payload.toString());
        List<JsonObject> out = new ArrayList<>();
        if (result.has("inserted") && result.get("inserted").isJsonArray()) {
            result.get("inserted").getAsJsonArray().forEach(el -> {
                if (el.isJsonObject())
                    out.add(el.getAsJsonObject());
            });
        }
        return out;
    }

    private String buildFieldOpsJson(Map<String, Object> data) {
        JsonObject root = new JsonObject();
        for (Map.Entry<String, Object> e : data.entrySet()) {
            Object v = e.getValue();
            if (v instanceof FieldOp) {
                FieldOp f = (FieldOp) v;
                JsonObject op = new JsonObject();
                op.addProperty("$op", f.op);
                if (f.value != null)
                    op.addProperty("value", f.value.doubleValue());
                root.add(e.getKey(), op);
            } else if (v instanceof String) {
                root.addProperty(e.getKey(), (String) v);
            } else if (v instanceof Number) {
                root.addProperty(e.getKey(), (Number) v);
            } else if (v instanceof Boolean) {
                root.addProperty(e.getKey(), (Boolean) v);
            } else if (v == null) {
                root.add(e.getKey(), JsonNull.INSTANCE);
            } else {
                root.add(e.getKey(), SharedGson.GSON.toJsonTree(v));
            }
        }
        return root.toString();
    }
}

// ─── DbRef ───────────────────────────────────────────────────────────────────

class DbRef {
    private final EdgeBaseHttpClient http;
    private final String namespace;
    private final String instanceId;

    DbRef(EdgeBaseHttpClient http, String namespace, String instanceId) {
        this.http = http;
        this.namespace = namespace;
        this.instanceId = instanceId;
    }

    TableRef table(String name) {
        return new TableRef(http, name, namespace, instanceId,
                new ArrayList<>(), new ArrayList<>(), new ArrayList<>(),
                null, null, null, null, null, null);
    }
}

// ─── AdminAuthClient ─────────────────────────────────────────────────────────

class AdminAuthClient {
    private final EdgeBaseHttpClient http;

    AdminAuthClient(EdgeBaseHttpClient http) {
        this.http = http;
    }

    JsonObject createUser(String email, String password) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("email", email);
        body.put("password", password);
        return http.post("/auth/signup", body);
    }

    JsonObject listUsers(int limit) {
        return http.get("/auth/users", Collections.singletonMap("limit", String.valueOf(limit)));
    }

    JsonObject getUser(String userId) {
        return http.get("/auth/users/" + userId, null);
    }

    void deleteUser(String userId) {
        http.delete("/auth/users/" + userId);
    }
}

// ─── AdminEdgeBase
// ────────────────────────────────────────────────────────────

public class AdminEdgeBase {
    private final EdgeBaseHttpClient http;
    public final AdminAuthClient adminAuth;
    private final ExecutorService executor;

    public AdminEdgeBase(String baseUrl, String serviceKey) {
        this.http = new EdgeBaseHttpClient(baseUrl, serviceKey);
        this.adminAuth = new AdminAuthClient(http);
        this.executor = Executors.newCachedThreadPool();
    }

    public DbRef db(String namespace, String instanceId) {
        return new DbRef(http, namespace, instanceId);
    }

    public DbRef db(String namespace) {
        return db(namespace, null);
    }

    /** CompletableFuture 비동기 래퍼 (언어특화 Java) */
    public CompletableFuture<JsonObject> insertAsync(DbRef db, String tableName, Map<String, Object> data) {
        return CompletableFuture.supplyAsync(() -> db.table(tableName).insert(data), executor);
    }

    public void shutdown() {
        executor.shutdown();
        try {
            executor.awaitTermination(5, TimeUnit.SECONDS);
        } catch (InterruptedException ignored) {
        }
    }
}
