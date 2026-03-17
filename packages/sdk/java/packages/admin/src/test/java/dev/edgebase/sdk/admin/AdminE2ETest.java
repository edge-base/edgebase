package dev.edgebase.sdk.admin;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.net.HttpURLConnection;
import java.net.URL;
import java.util.*;
import java.util.concurrent.CompletableFuture;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Java packages/admin SDK — E2E 테스트
 *
 * 전제: wrangler dev --port 8688 서버 실행 중
 *
 * 실행:
 * BASE_URL=http://localhost:8688 SERVICE_KEY=test-service-key-for-admin \
 * cd packages/sdk/java/packages/admin && ./gradlew test
 *
 * 원칙: mock 금지, AdminEdgeBase 실서버 기반
 */
public class AdminE2ETest {

    private static final String BASE_URL = Optional.ofNullable(System.getenv("BASE_URL"))
            .orElse("http://localhost:8688");
    private static final String SK = Optional.ofNullable(System.getenv("SERVICE_KEY"))
            .orElse("test-service-key-for-admin");
    private static final String PREFIX = "java-admin-e2e-" + System.currentTimeMillis();
    private static final List<String> CREATED_IDS = new ArrayList<>();
    private static AdminEdgeBase admin;

    @BeforeAll
    static void setUp() {
        assumeServerAvailable();
        admin = new AdminEdgeBase(BASE_URL, SK, null);
    }

    private static void assumeServerAvailable() {
        boolean available = isServerAvailable();
        String message = "E2E backend not reachable at " + BASE_URL
                + ". Start `edgebase dev --port 8688` or set BASE_URL. Set EDGEBASE_E2E_REQUIRED=1 to fail instead of skip.";
        if ("1".equals(System.getenv("EDGEBASE_E2E_REQUIRED"))) {
            if (!available) {
                throw new AssertionError(message);
            }
            return;
        }
        Assumptions.assumeTrue(available, message);
    }

    private static boolean isServerAvailable() {
        try {
            HttpURLConnection connection = (HttpURLConnection) new URL(BASE_URL.replaceAll("/+$", "") + "/api/health").openConnection();
            connection.setConnectTimeout(1500);
            connection.setReadTimeout(1500);
            connection.setRequestMethod("GET");
            int statusCode = connection.getResponseCode();
            return statusCode >= 200 && statusCode < 500;
        } catch (Exception ignored) {
            return false;
        }
    }

    @AfterAll
    static void tearDown() {
        if (admin == null) {
            return;
        }
        for (String id : CREATED_IDS) {
            try {
                admin.db("shared").table("posts").doc(id).delete();
            } catch (Exception ignored) {
            }
        }
        admin.destroy();
    }

    // ─── 1. AdminAuth ─────────────────────────────────────────────────────────

    @Test
    void test_listUsers_returns_users() {
        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) admin.adminAuth().listUsers(5, null);
        assertNotNull(result.get("users"));
        assertTrue(result.get("users") instanceof List);
    }

    @Test
    void test_createUser_returns_id() {
        String email = PREFIX + "-create@test.com";
        @SuppressWarnings("unchecked")
        Map<String, Object> user = (Map<String, Object>) admin.adminAuth().createUser(
                Map.of("email", email, "password", "JavaAdmin123!"));
        String userId = (String) (user.get("id") != null ? user.get("id")
                : (user.get("user") instanceof Map ? ((Map<?, ?>) user.get("user")).get("id") : null));
        assertNotNull(userId);
    }

    @Test
    void test_getUser_returns_user() {
        String email = PREFIX + "-getuser@test.com";
        @SuppressWarnings("unchecked")
        Map<String, Object> created = (Map<String, Object>) admin.adminAuth().createUser(
                Map.of("email", email, "password", "JavaAdmin123!"));
        String userId = (String) (created.get("id") != null ? created.get("id")
                : (created.get("user") instanceof Map ? ((Map<?, ?>) created.get("user")).get("id") : null));
        assertNotNull(userId);

        @SuppressWarnings("unchecked")
        Map<String, Object> fetched = (Map<String, Object>) admin.adminAuth().getUser(userId);
        assertNotNull(fetched.get("id") != null ? fetched.get("id") : (fetched.get("user")));
    }

    @Test
    void test_setCustomClaims_succeeds() {
        String email = PREFIX + "-claims@test.com";
        @SuppressWarnings("unchecked")
        Map<String, Object> created = (Map<String, Object>) admin.adminAuth().createUser(
                Map.of("email", email, "password", "JavaAdmin123!"));
        String userId = (String) (created.get("id") != null ? created.get("id")
                : (created.get("user") instanceof Map ? ((Map<?, ?>) created.get("user")).get("id") : null));
        assertNotNull(userId);
        assertDoesNotThrow(() -> admin.adminAuth().setCustomClaims(userId, Map.of("role", "premium")));
    }

    // ─── 2. DB CRUD ──────────────────────────────────────────────────────────

    @Test
    void test_db_create_returns_id() {
        @SuppressWarnings("unchecked")
        Map<String, Object> r = (Map<String, Object>) admin.db("shared").table("posts")
                .insert(Map.of("title", PREFIX + "-create"));
        String id = (String) r.get("id");
        assertNotNull(id);
        CREATED_IDS.add(id);
    }

    @Test
    void test_db_getOne_returns_record() {
        @SuppressWarnings("unchecked")
        Map<String, Object> created = (Map<String, Object>) admin.db("shared").table("posts")
                .insert(Map.of("title", PREFIX + "-getone"));
        String id = (String) created.get("id");
        assertNotNull(id);
        CREATED_IDS.add(id);
        @SuppressWarnings("unchecked")
        Map<String, Object> fetched = (Map<String, Object>) admin.db("shared").table("posts").getOne(id);
        assertEquals(id, fetched.get("id"));
    }

    @Test
    void test_db_update() {
        @SuppressWarnings("unchecked")
        Map<String, Object> created = (Map<String, Object>) admin.db("shared").table("posts")
                .insert(Map.of("title", PREFIX + "-orig"));
        String id = (String) created.get("id");
        CREATED_IDS.add(id);
        @SuppressWarnings("unchecked")
        Map<String, Object> updated = (Map<String, Object>) admin.db("shared").table("posts")
                .doc(id).update(Map.of("title", PREFIX + "-upd"));
        assertEquals(PREFIX + "-upd", updated.get("title"));
    }

    @Test
    void test_db_count_returns_number() {
        int count = admin.db("shared").table("posts").count();
        assertTrue(count >= 0);
    }

    @Test
    void test_db_list_limit() {
        dev.edgebase.sdk.core.ListResult result = admin.db("shared").table("posts").limit(3).getList();
        assertNotNull(result.getItems());
        assertTrue(result.getItems().size() <= 3);
    }

    @Test
    void test_golden_filter_sort_limit() {
        String gqPrefix = PREFIX + "-gq";
        List<String> gqIds = new ArrayList<>();
        int[] viewValues = {10, 30, 20, 40, 5};
        String[] labels = {"A", "B", "C", "D", "E"};
        for (int i = 0; i < 5; i++) {
            @SuppressWarnings("unchecked")
            Map<String, Object> r = (Map<String, Object>) admin.db("shared").table("posts")
                    .insert(Map.of("title", gqPrefix + "-" + labels[i], "views", viewValues[i]));
            String id = (String) r.get("id");
            gqIds.add(id);
            CREATED_IDS.add(id);
        }

        dev.edgebase.sdk.core.ListResult list = admin.db("shared").table("posts")
                .where("title", "contains", gqPrefix)
                .where("views", ">=", 10)
                .orderBy("views", "desc")
                .limit(3)
                .getList();
        List<Integer> views = new ArrayList<>();
        for (Object item : list.getItems()) {
            @SuppressWarnings("unchecked")
            Map<String, Object> m = (Map<String, Object>) item;
            views.add(((Number) m.get("views")).intValue());
        }
        assertEquals(List.of(40, 30, 20), views, "Golden query: filter>=10 + sort:desc + limit=3");
    }

    @Test
    void test_golden_cursor_no_overlap() {
        String gqPrefix = PREFIX + "-gqc";
        List<String> gqIds = new ArrayList<>();
        for (int i = 0; i < 5; i++) {
            @SuppressWarnings("unchecked")
            Map<String, Object> r = (Map<String, Object>) admin.db("shared").table("posts")
                    .insert(Map.of("title", gqPrefix + "-" + i));
            gqIds.add((String) r.get("id"));
            CREATED_IDS.add((String) r.get("id"));
        }

        dev.edgebase.sdk.core.ListResult p1 = admin.db("shared").table("posts")
                .where("title", "contains", gqPrefix)
                .limit(2)
                .getList();
        assertNotNull(p1.getCursor(), "First page should have cursor");

        dev.edgebase.sdk.core.ListResult p2 = admin.db("shared").table("posts")
                .where("title", "contains", gqPrefix)
                .limit(2)
                .after(p1.getCursor())
                .getList();

        Set<String> ids1 = new HashSet<>();
        for (Object item : p1.getItems()) {
            @SuppressWarnings("unchecked")
            Map<String, Object> m = (Map<String, Object>) item;
            ids1.add((String) m.get("id"));
        }
        Set<String> ids2 = new HashSet<>();
        for (Object item : p2.getItems()) {
            @SuppressWarnings("unchecked")
            Map<String, Object> m = (Map<String, Object>) item;
            ids2.add((String) m.get("id"));
        }
        ids1.retainAll(ids2);
        assertTrue(ids1.isEmpty(), "Cursor pages should not overlap");
    }

    @Test
    void test_golden_orfilter() {
        String gqPrefix = PREFIX + "-gqor";
        List<String> gqIds = new ArrayList<>();
        int[] viewValues = {10, 30, 20, 40, 5};
        String[] labels = {"A", "B", "C", "D", "E"};
        for (int i = 0; i < 5; i++) {
            @SuppressWarnings("unchecked")
            Map<String, Object> r = (Map<String, Object>) admin.db("shared").table("posts")
                    .insert(Map.of("title", gqPrefix + "-" + labels[i], "views", viewValues[i]));
            String id = (String) r.get("id");
            gqIds.add(id);
            CREATED_IDS.add(id);
        }

        dev.edgebase.sdk.core.ListResult list = admin.db("shared").table("posts")
                .where("title", "contains", gqPrefix)
                .or(b -> b.where("views", "==", 10).where("views", "==", 40))
                .orderBy("views", "asc")
                .getList();
        List<Integer> views = new ArrayList<>();
        for (Object item : list.getItems()) {
            @SuppressWarnings("unchecked")
            Map<String, Object> m = (Map<String, Object>) item;
            views.add(((Number) m.get("views")).intValue());
        }
        assertEquals(List.of(10, 40), views, "Golden query: OR filter views==10 || views==40, sorted asc");
    }

    @Test
    void test_golden_crud_roundtrip() {
        // 1. Insert
        @SuppressWarnings("unchecked")
        Map<String, Object> record = (Map<String, Object>) admin.db("shared").table("posts")
                .insert(Map.of("title", PREFIX + "-crud-roundtrip", "views", 0));
        String id = (String) record.get("id");
        assertNotNull(id, "Insert should return an id");
        CREATED_IDS.add(id);

        // 2. Get by ID — verify fields match
        @SuppressWarnings("unchecked")
        Map<String, Object> fetched = (Map<String, Object>) admin.db("shared").table("posts").getOne(id);
        assertEquals(id, fetched.get("id"));
        assertEquals(PREFIX + "-crud-roundtrip", fetched.get("title"));

        // 3. Update — verify updated field
        @SuppressWarnings("unchecked")
        Map<String, Object> updated = (Map<String, Object>) admin.db("shared").table("posts")
                .doc(id).update(Map.of("title", PREFIX + "-crud-updated"));
        assertEquals(PREFIX + "-crud-updated", updated.get("title"));

        // 4. Delete
        admin.db("shared").table("posts").doc(id).delete();

        // 5. Verify exception — getOne after delete should throw
        assertThrows(dev.edgebase.sdk.core.EdgeBaseError.class,
                () -> admin.db("shared").table("posts").getOne(id));
    }

    // ─── 3. KV ───────────────────────────────────────────────────────────────

    @Test
    void test_kv_set_get_delete() {
        String key = "java-admin-kv-" + System.currentTimeMillis();
        admin.kv("test").set(key, "hello-java-admin");
        Object val = admin.kv("test").get(key);
        assertEquals("hello-java-admin", val);
        admin.kv("test").delete(key);
        Object afterDel = admin.kv("test").get(key);
        assertNull(afterDel);
    }

    // ─── 4. SQL ──────────────────────────────────────────────────────────────

    @Test
    void test_raw_sql_select() {
        List<Object> rows = admin.sql("shared", "SELECT 1 AS val", List.of());
        assertNotNull(rows);
    }

    // ─── 5. Broadcast ────────────────────────────────────────────────────────

    @Test
    void test_broadcast_succeeds() {
        assertDoesNotThrow(
                () -> admin.broadcast("general", "server-event", Map.of("msg", "hello from java admin E2E")));
    }

    // ─── 6. Error ────────────────────────────────────────────────────────────

    @Test
    void test_getOne_nonexistent_throws() {
        assertThrows(dev.edgebase.sdk.core.EdgeBaseError.class,
                () -> admin.db("shared").table("posts").getOne("nonexistent-java-admin-99999"));
    }

    @Test
    void test_invalid_serviceKey_throws() {
        AdminEdgeBase badAdmin = new AdminEdgeBase(BASE_URL, "invalid-sk", null);
        assertThrows(dev.edgebase.sdk.core.EdgeBaseError.class,
                () -> badAdmin.db("shared").table("posts").insert(Map.of("title", "X")));
    }

    // ─── 7. CompletableFuture 병렬 (언어특화) ─────────────────────────────────

    @Test
    void test_parallel_create_completableFuture() throws Exception {
        List<String> titles = List.of(PREFIX + "-par-1", PREFIX + "-par-2", PREFIX + "-par-3");
        List<CompletableFuture<Map<String, Object>>> futures = titles.stream()
                .map(t -> CompletableFuture.supplyAsync(() -> {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> r = (Map<String, Object>) admin.db("shared").table("posts")
                            .insert(Map.of("title", t));
                    return r;
                })).toList();
        List<Map<String, Object>> results = CompletableFuture
                .allOf(futures.toArray(new CompletableFuture[0]))
                .thenApply(ignored -> futures.stream().map(CompletableFuture::join).toList())
                .get();
        assertEquals(3, results.size());
        results.stream().map(r -> (String) r.get("id")).filter(Objects::nonNull).forEach(CREATED_IDS::add);
    }

    // ─── 8. Push E2E ────────────────────────────────────────────────────────

    @Test
    void test_push_send_nonexistent_user() {
        Map<String, Object> result = admin.push().send(
                "nonexistent-push-user-99999",
                Map.of("title", "Test", "body", "Hello"));
        assertNotNull(result);
        assertEquals(0, ((Number) result.getOrDefault("sent", 0)).intValue());
    }

    @Test
    void test_push_send_to_token() {
        Map<String, Object> result = admin.push().sendToToken(
                "fake-fcm-token-e2e",
                Map.of("title", "Token", "body", "Test"),
                "web");
        assertNotNull(result);
        assertTrue(result.containsKey("sent"));
    }

    @Test
    void test_push_send_many() {
        Map<String, Object> result = admin.push().sendMany(
                List.of("nonexistent-user-a", "nonexistent-user-b"),
                Map.of("title", "Batch", "body", "Test"));
        assertNotNull(result);
    }

    @Test
    void test_push_get_tokens() {
        List<Map<String, Object>> tokens = admin.push().getTokens("nonexistent-push-user-tokens");
        assertNotNull(tokens);
    }

    @Test
    void test_push_get_logs() {
        List<Map<String, Object>> logs = admin.push().getLogs("nonexistent-push-user-logs");
        assertNotNull(logs);
    }

    @Test
    void test_push_send_to_topic() {
        Map<String, Object> result = admin.push().sendToTopic(
                "test-topic-e2e",
                Map.of("title", "Topic", "body", "Test"));
        assertNotNull(result);
    }

    @Test
    void test_push_broadcast() {
        Map<String, Object> result = admin.push().broadcast(
                Map.of("title", "Broadcast", "body", "E2E Test"));
        assertNotNull(result);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Vectorize (stub)
    // ═══════════════════════════════════════════════════════════════════════════

    @Test
    void test_vectorize_upsert_stub() {
        var vec = admin.vector("embeddings");
        double[] values = new double[1536];
        java.util.Arrays.fill(values, 0.1);
        List<Double> valuesList = new ArrayList<>();
        for (double v : values) valuesList.add(v);
        var vectors = List.of(Map.<String, Object>of(
                "id", "doc-1",
                "values", valuesList,
                "metadata", Map.of("title", "test")));
        var result = vec.upsert(vectors);
        assertTrue((Boolean) result.get("ok"));
    }

    @Test
    void test_vectorize_insert_stub() {
        var vec = admin.vector("embeddings");
        List<Double> values = new ArrayList<>();
        for (int i = 0; i < 1536; i++) values.add(0.2);
        var vectors = List.of(Map.<String, Object>of("id", "doc-ins-1", "values", values));
        var result = vec.insert(vectors);
        assertTrue((Boolean) result.get("ok"));
    }

    @Test
    void test_vectorize_search_stub() {
        var vec = admin.vector("embeddings");
        List<Double> queryVec = new ArrayList<>();
        for (int i = 0; i < 1536; i++) queryVec.add(0.1);
        var matches = vec.search(queryVec, 5, null);
        assertNotNull(matches);
        assertTrue(matches instanceof List);
    }

    @Test
    void test_vectorize_search_with_namespace() {
        var vec = admin.vector("embeddings");
        List<Double> queryVec = new ArrayList<>();
        for (int i = 0; i < 1536; i++) queryVec.add(0.1);
        var matches = vec.search(queryVec, 5, null, "test-ns", null, null);
        assertNotNull(matches);
    }

    @Test
    void test_vectorize_query_by_id_stub() {
        var vec = admin.vector("embeddings");
        var matches = vec.queryById("doc-1", 5, null);
        assertNotNull(matches);
        assertTrue(matches instanceof List);
    }

    @Test
    void test_vectorize_get_by_ids_stub() {
        var vec = admin.vector("embeddings");
        var vectors = vec.getByIds(List.of("doc-1", "doc-2"));
        assertNotNull(vectors);
        assertTrue(vectors instanceof List);
    }

    @Test
    void test_vectorize_delete_stub() {
        var vec = admin.vector("embeddings");
        var result = vec.delete(List.of("doc-1", "doc-2"));
        assertTrue((Boolean) result.get("ok"));
    }

    @Test
    void test_vectorize_describe_stub() {
        var vec = admin.vector("embeddings");
        var info = vec.describe();
        assertNotNull(info.get("vectorCount"));
        assertNotNull(info.get("dimensions"));
        assertNotNull(info.get("metric"));
    }

    @Test
    void test_vectorize_search_dimension_mismatch() {
        var vec = admin.vector("embeddings");
        assertThrows(Exception.class, () -> vec.search(List.of(0.1, 0.2, 0.3), 5, null));
    }

    @Test
    void test_vectorize_nonexistent_index() {
        var vec = admin.vector("nonexistent-index-99");
        assertThrows(Exception.class, vec::describe);
    }
}
