package dev.edgebase.sdk.core;

import dev.edgebase.sdk.core.generated.GeneratedDbApi;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Java packages/core SDK — E2E 테스트
 *
 * 전제: wrangler dev --port 8688 서버 실행 중 (Service Key 필요)
 *
 * 실행:
 * BASE_URL=http://localhost:8688 SERVICE_KEY=test-service-key-for-admin \
 * cd packages/sdk/java/packages/core && ./gradlew test
 *
 * 원칙: mock 금지, DbRef/TableRef 실서버 기반 (core는 admin 서버 SDK 역할)
 *
 * Note: java/packages/core는 admin-side 서버(Spring/Vert.x 등)에서 사용하는
 * core 라이브러리이므로 service key로 직접 접근.
 */
public class CoreE2ETest {

    private static final String BASE_URL = Optional.ofNullable(System.getenv("BASE_URL"))
            .orElse("http://localhost:8688");
    private static final String SK = Optional.ofNullable(System.getenv("SERVICE_KEY"))
            .orElse("test-service-key-for-admin");
    private static final String PREFIX = "java-core-e2e-" + System.currentTimeMillis();
    private static final List<String> CREATED_IDS = Collections.synchronizedList(new ArrayList<>());
    private static HttpClient httpClient;
    private static GeneratedDbApi core;
    private static DbRef dbRef;

    @BeforeAll
    static void setUp() {
        assumeServerAvailable();
        ContextManager cm = new ContextManager();
        TokenManager noOpTm = new TokenManager() {
            @Override
            public String getAccessToken() {
                return null;
            }

            @Override
            public String getRefreshToken() {
                return null;
            }

            @Override
            public void setTokens(String a, String r) {
            }

            @Override
            public void clearTokens() {
            }
        };
        httpClient = new HttpClient(BASE_URL, noOpTm, cm, SK, null);
        core = new GeneratedDbApi(httpClient);
        dbRef = new DbRef(core, "shared", null, null);
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
        if (dbRef == null) {
            return;
        }
        for (String id : CREATED_IDS) {
            try {
                dbRef.table("posts").doc(id).delete();
            } catch (Exception ignored) {
            }
        }
    }

    // ─── Helper ──────────────────────────────────────────────────────────────

    private String createPost(String suffix) {
        Map<String, Object> record = dbRef.table("posts").insert(Map.of("title", PREFIX + suffix));
        String id = (String) record.get("id");
        if (id != null) CREATED_IDS.add(id);
        return id;
    }

    // ─── 1. CRUD ─────────────────────────────────────────────────────────────

    @Test
    void test_insert_returns_id() {
        Map<String, Object> record = dbRef.table("posts").insert(Map.of("title", PREFIX + "-create"));
        String id = (String) record.get("id");
        assertNotNull(id);
        CREATED_IDS.add(id);
    }

    @Test
    void test_getOne_returns_record() {
        Map<String, Object> created = dbRef.table("posts").insert(Map.of("title", PREFIX + "-getone"));
        String id = (String) created.get("id");
        assertNotNull(id);
        CREATED_IDS.add(id);
        Map<String, Object> fetched = dbRef.table("posts").getOne(id);
        assertEquals(id, fetched.get("id"));
    }

    @Test
    void test_update_changes_title() {
        Map<String, Object> created = dbRef.table("posts").insert(Map.of("title", PREFIX + "-orig"));
        String id = (String) created.get("id");
        assertNotNull(id);
        CREATED_IDS.add(id);
        Map<String, Object> updated = dbRef.table("posts").doc(id).update(Map.of("title", PREFIX + "-upd"));
        assertEquals(PREFIX + "-upd", updated.get("title"));
    }

    @Test
    void test_delete_then_getOne_throws() {
        Map<String, Object> created = dbRef.table("posts").insert(Map.of("title", PREFIX + "-del"));
        String id = (String) created.get("id");
        assertNotNull(id);
        dbRef.table("posts").doc(id).delete();
        assertThrows(EdgeBaseError.class, () -> dbRef.table("posts").getOne(id));
    }

    @Test
    void test_insert_and_read_back_fields() {
        String title = PREFIX + "-readback-" + System.currentTimeMillis();
        Map<String, Object> record = dbRef.table("posts").insert(Map.of("title", title, "body", "content here"));
        String id = (String) record.get("id");
        CREATED_IDS.add(id);
        Map<String, Object> fetched = dbRef.table("posts").getOne(id);
        assertEquals(title, fetched.get("title"));
    }

    @Test
    void test_insert_with_special_characters() {
        String title = PREFIX + "-special-<>&\"'`!@#$%^*()";
        Map<String, Object> record = dbRef.table("posts").insert(Map.of("title", title));
        String id = (String) record.get("id");
        assertNotNull(id);
        CREATED_IDS.add(id);
        Map<String, Object> fetched = dbRef.table("posts").getOne(id);
        assertEquals(title, fetched.get("title"));
    }

    @Test
    void test_insert_with_cjk_characters() {
        String title = PREFIX + "-CJK-한국어-日本語-中文";
        Map<String, Object> record = dbRef.table("posts").insert(Map.of("title", title));
        String id = (String) record.get("id");
        assertNotNull(id);
        CREATED_IDS.add(id);
        Map<String, Object> fetched = dbRef.table("posts").getOne(id);
        assertEquals(title, fetched.get("title"));
    }

    @Test
    void test_insert_with_emoji() {
        String title = PREFIX + "-emoji-\uD83D\uDE00\uD83C\uDF89\uD83D\uDE80";
        Map<String, Object> record = dbRef.table("posts").insert(Map.of("title", title));
        String id = (String) record.get("id");
        assertNotNull(id);
        CREATED_IDS.add(id);
        Map<String, Object> fetched = dbRef.table("posts").getOne(id);
        assertEquals(title, fetched.get("title"));
    }

    @Test
    void test_update_multiple_fields() {
        Map<String, Object> created = dbRef.table("posts").insert(Map.of("title", PREFIX + "-multi-upd"));
        String id = (String) created.get("id");
        CREATED_IDS.add(id);
        Map<String, Object> updated = dbRef.table("posts").doc(id)
                .update(Map.of("title", PREFIX + "-multi-upd-v2", "body", "new body"));
        assertEquals(PREFIX + "-multi-upd-v2", updated.get("title"));
    }

    @Test
    void test_create_returns_createdAt() {
        Map<String, Object> record = dbRef.table("posts").insert(Map.of("title", PREFIX + "-ts"));
        String id = (String) record.get("id");
        CREATED_IDS.add(id);
        assertNotNull(record.get("createdAt"));
    }

    @Test
    void test_doc_ref_get() {
        String id = createPost("-docref-get");
        Map<String, Object> doc = dbRef.table("posts").doc(id).get();
        assertEquals(id, doc.get("id"));
    }

    @Test
    void test_doc_ref_delete_returns() {
        String id = createPost("-docref-del");
        Map<String, Object> result = dbRef.table("posts").doc(id).delete();
        // delete should complete without error
        assertNotNull(result);
    }

    // ─── 2. Query ────────────────────────────────────────────────────────────

    @Test
    void test_list_with_limit() {
        ListResult result = dbRef.table("posts").limit(3).getList();
        assertNotNull(result.getItems());
        assertTrue(result.getItems().size() <= 3);
    }

    @Test
    void test_where_filter_finds_record() {
        String unique = PREFIX + "-filter-" + System.currentTimeMillis();
        Map<String, Object> r = dbRef.table("posts").insert(Map.of("title", unique));
        String id = (String) r.get("id");
        assertNotNull(id);
        CREATED_IDS.add(id);
        ListResult list = dbRef.table("posts").where("title", "==", unique).getList();
        assertFalse(list.getItems().isEmpty());
    }

    @Test
    void test_count_returns_number() {
        int count = dbRef.table("posts").count();
        assertTrue(count >= 0);
    }

    @Test
    void test_orderBy_returns_list() {
        ListResult result = dbRef.table("posts").orderBy("createdAt", "desc").limit(5).getList();
        assertNotNull(result.getItems());
    }

    @Test
    void test_where_not_equal() {
        String unique = PREFIX + "-neq-" + System.currentTimeMillis();
        Map<String, Object> r = dbRef.table("posts").insert(Map.of("title", unique));
        CREATED_IDS.add((String) r.get("id"));
        ListResult list = dbRef.table("posts")
                .where("title", "!=", "nonexistent-title-xyz")
                .limit(3).getList();
        assertFalse(list.getItems().isEmpty());
    }

    @Test
    void test_where_contains_filter() {
        String unique = PREFIX + "-contains-" + System.currentTimeMillis();
        Map<String, Object> r = dbRef.table("posts").insert(Map.of("title", unique));
        CREATED_IDS.add((String) r.get("id"));
        ListResult list = dbRef.table("posts")
                .where("title", "contains", "contains")
                .limit(5).getList();
        assertFalse(list.getItems().isEmpty());
    }

    @Test
    void test_multiple_where_filters() {
        String unique = PREFIX + "-mwhere-" + System.currentTimeMillis();
        Map<String, Object> r = dbRef.table("posts").insert(Map.of("title", unique));
        CREATED_IDS.add((String) r.get("id"));
        ListResult list = dbRef.table("posts")
                .where("title", "==", unique)
                .where("id", "!=", "nonexistent")
                .getList();
        assertFalse(list.getItems().isEmpty());
    }

    @Test
    void test_or_filter() {
        String u1 = PREFIX + "-or1-" + System.currentTimeMillis();
        String u2 = PREFIX + "-or2-" + System.currentTimeMillis();
        Map<String, Object> r1 = dbRef.table("posts").insert(Map.of("title", u1));
        Map<String, Object> r2 = dbRef.table("posts").insert(Map.of("title", u2));
        CREATED_IDS.add((String) r1.get("id"));
        CREATED_IDS.add((String) r2.get("id"));
        ListResult list = dbRef.table("posts")
                .or(b -> b.where("title", "==", u1).where("title", "==", u2))
                .getList();
        assertTrue(list.getItems().size() >= 2);
    }

    @Test
    void test_orderBy_asc() {
        ListResult result = dbRef.table("posts").orderBy("createdAt", "asc").limit(3).getList();
        assertNotNull(result.getItems());
    }

    @Test
    void test_list_returns_total() {
        ListResult result = dbRef.table("posts").limit(1).getList();
        // total may be populated in offset mode
        assertNotNull(result.getItems());
    }

    @Test
    void test_count_with_filter() {
        String unique = PREFIX + "-cnt-" + System.currentTimeMillis();
        dbRef.table("posts").insert(Map.of("title", unique));
        int count = dbRef.table("posts").where("title", "==", unique).count();
        assertEquals(1, count);
        // cleanup
        ListResult lr = dbRef.table("posts").where("title", "==", unique).getList();
        lr.getItems().stream().map(r -> (String) r.get("id")).forEach(CREATED_IDS::add);
    }

    @Test
    void test_search_full_text() {
        String unique = PREFIX + "-fts-" + System.currentTimeMillis();
        Map<String, Object> r = dbRef.table("posts").insert(Map.of("title", unique));
        CREATED_IDS.add((String) r.get("id"));
        // FTS search via .search()
        ListResult list = dbRef.table("posts").search(unique).limit(5).getList();
        assertNotNull(list.getItems());
    }

    @Test
    void test_offset_pagination() {
        ListResult result = dbRef.table("posts").limit(2).offset(0).getList();
        assertNotNull(result.getItems());
        assertTrue(result.getItems().size() <= 2);
    }

    @Test
    void test_cursor_pagination_after() {
        // Create enough records, then paginate
        createPost("-cur1");
        createPost("-cur2");
        createPost("-cur3");
        ListResult first = dbRef.table("posts").limit(1).getList();
        assertNotNull(first.getItems());
        if (first.getCursor() != null) {
            ListResult second = dbRef.table("posts").limit(1).after(first.getCursor()).getList();
            assertNotNull(second.getItems());
        }
    }

    // ─── 3. Batch ────────────────────────────────────────────────────────────

    @Test
    void test_insertMany_returns_list() {
        List<Map<String, Object>> records = List.of(
                Map.of("title", PREFIX + "-batch-1"),
                Map.of("title", PREFIX + "-batch-2"),
                Map.of("title", PREFIX + "-batch-3"));
        List<Map<String, Object>> created = dbRef.table("posts").insertMany(records);
        assertEquals(3, created.size());
        created.stream().map(r -> (String) r.get("id")).filter(Objects::nonNull).forEach(CREATED_IDS::add);
    }

    @Test
    void test_insertMany_single_item() {
        List<Map<String, Object>> records = List.of(Map.of("title", PREFIX + "-batch-single"));
        List<Map<String, Object>> created = dbRef.table("posts").insertMany(records);
        assertEquals(1, created.size());
        created.stream().map(r -> (String) r.get("id")).filter(Objects::nonNull).forEach(CREATED_IDS::add);
    }

    @Test
    void test_insertMany_ten_items() {
        List<Map<String, Object>> records = new ArrayList<>();
        for (int i = 0; i < 10; i++) {
            records.add(Map.of("title", PREFIX + "-batch10-" + i));
        }
        List<Map<String, Object>> created = dbRef.table("posts").insertMany(records);
        assertEquals(10, created.size());
        created.stream().map(r -> (String) r.get("id")).filter(Objects::nonNull).forEach(CREATED_IDS::add);
    }

    @Test
    void test_updateMany_with_filter() {
        String tag = PREFIX + "-umany-" + System.currentTimeMillis();
        dbRef.table("posts").insert(Map.of("title", tag));
        dbRef.table("posts").insert(Map.of("title", tag));
        ListResult lr = dbRef.table("posts").where("title", "==", tag).getList();
        lr.getItems().stream().map(r -> (String) r.get("id")).forEach(CREATED_IDS::add);

        BatchResult br = dbRef.table("posts")
                .where("title", "==", tag)
                .updateMany(Map.of("body", "bulk-updated"));
        assertTrue(br.getTotalSucceeded() >= 2);
    }

    @Test
    void test_deleteMany_with_filter() {
        String tag = PREFIX + "-dmany-" + System.currentTimeMillis();
        dbRef.table("posts").insert(Map.of("title", tag));
        dbRef.table("posts").insert(Map.of("title", tag));

        BatchResult br = dbRef.table("posts")
                .where("title", "==", tag)
                .deleteMany();
        assertTrue(br.getTotalSucceeded() >= 2);
    }

    @Test
    void test_updateMany_requires_filter() {
        assertThrows(IllegalArgumentException.class,
                () -> dbRef.table("posts").updateMany(Map.of("body", "x")));
    }

    @Test
    void test_deleteMany_requires_filter() {
        assertThrows(IllegalArgumentException.class,
                () -> dbRef.table("posts").deleteMany());
    }

    // ─── 4. Upsert ───────────────────────────────────────────────────────────

    @Test
    void test_upsert_creates_new() {
        UpsertResult result = dbRef.table("posts").upsert(Map.of("title", PREFIX + "-upsert-new"));
        assertNotNull(result.getRecord().get("id"));
        CREATED_IDS.add((String) result.getRecord().get("id"));
    }

    @Test
    void test_upsert_returns_created_flag() {
        UpsertResult result = dbRef.table("posts").upsert(Map.of("title", PREFIX + "-upsert-flag"));
        assertNotNull(result.getRecord());
        CREATED_IDS.add((String) result.getRecord().get("id"));
    }

    @Test
    void test_upsertMany() {
        List<Map<String, Object>> records = List.of(
                Map.of("title", PREFIX + "-umany-1"),
                Map.of("title", PREFIX + "-umany-2"));
        List<Map<String, Object>> result = dbRef.table("posts").upsertMany(records);
        assertTrue(result.size() >= 2);
        result.stream().map(r -> (String) r.get("id")).filter(Objects::nonNull).forEach(CREATED_IDS::add);
    }

    // ─── 5. FieldOps ─────────────────────────────────────────────────────────

    @Test
    void test_fieldOps_increment() {
        Map<String, Object> data = new HashMap<>();
        data.put("title", PREFIX + "-incr");
        data.put("views", 10);
        Map<String, Object> created = dbRef.table("posts").insert(data);
        String id = (String) created.get("id");
        CREATED_IDS.add(id);
        dbRef.table("posts").doc(id).update(Map.of("views", FieldOps.increment(5)));
        Map<String, Object> fetched = dbRef.table("posts").getOne(id);
        // Should be 15
        Number views = (Number) fetched.get("views");
        assertNotNull(views);
        assertEquals(15, views.intValue());
    }

    @Test
    void test_fieldOps_increment_decimal() {
        Map<String, Object> data = new HashMap<>();
        data.put("title", PREFIX + "-incr-dec");
        data.put("score", 1.5);
        Map<String, Object> created = dbRef.table("posts").insert(data);
        String id = (String) created.get("id");
        CREATED_IDS.add(id);
        dbRef.table("posts").doc(id).update(Map.of("score", FieldOps.increment(0.5)));
        Map<String, Object> fetched = dbRef.table("posts").getOne(id);
        Number score = (Number) fetched.get("score");
        assertNotNull(score);
        assertEquals(2.0, score.doubleValue(), 0.01);
    }

    @Test
    void test_fieldOps_deleteField() {
        Map<String, Object> data = new HashMap<>();
        data.put("title", PREFIX + "-delfld");
        data.put("temp", "to-remove");
        Map<String, Object> created = dbRef.table("posts").insert(data);
        String id = (String) created.get("id");
        CREATED_IDS.add(id);
        dbRef.table("posts").doc(id).update(Map.of("temp", FieldOps.deleteField()));
        Map<String, Object> fetched = dbRef.table("posts").getOne(id);
        assertNull(fetched.get("temp"));
    }

    // ─── 6. Error ────────────────────────────────────────────────────────────

    @Test
    void test_getOne_nonexistent_throws() {
        assertThrows(EdgeBaseError.class, () -> dbRef.table("posts").getOne("nonexistent-java-core-99999"));
    }

    @Test
    void test_error_has_status_code() {
        try {
            dbRef.table("posts").getOne("nonexistent-java-core-88888");
            fail("Should have thrown");
        } catch (EdgeBaseError e) {
            assertTrue(e.getStatusCode() >= 400);
        }
    }

    @Test
    void test_error_has_message() {
        try {
            dbRef.table("posts").getOne("nonexistent-java-core-77777");
            fail("Should have thrown");
        } catch (EdgeBaseError e) {
            assertNotNull(e.getMessage());
            assertFalse(e.getMessage().isEmpty());
        }
    }

    // ─── 7. CompletableFuture 병렬 (언어특화) ─────────────────────────────────

    @Test
    void test_parallel_create_with_completableFuture() throws Exception {
        List<String> titles = List.of(PREFIX + "-par-1", PREFIX + "-par-2", PREFIX + "-par-3");
        List<CompletableFuture<Map<String, Object>>> futures = titles.stream()
                .map(t -> CompletableFuture.supplyAsync(() -> {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> r = dbRef.table("posts").insert(Map.of("title", t));
                    return r;
                })).toList();
        List<Map<String, Object>> results = CompletableFuture
                .allOf(futures.toArray(new CompletableFuture[0]))
                .thenApply(ignored -> futures.stream().map(CompletableFuture::join).toList())
                .get();
        assertEquals(3, results.size());
        results.stream().map(r -> (String) r.get("id")).filter(Objects::nonNull).forEach(CREATED_IDS::add);
    }

    @Test
    void test_parallel_read_with_completableFuture() throws Exception {
        String id1 = createPost("-pread-1");
        String id2 = createPost("-pread-2");
        CompletableFuture<Map<String, Object>> f1 = CompletableFuture
                .supplyAsync(() -> dbRef.table("posts").getOne(id1));
        CompletableFuture<Map<String, Object>> f2 = CompletableFuture
                .supplyAsync(() -> dbRef.table("posts").getOne(id2));
        CompletableFuture.allOf(f1, f2).get(10, TimeUnit.SECONDS);
        assertEquals(id1, f1.join().get("id"));
        assertEquals(id2, f2.join().get("id"));
    }

    @Test
    void test_completableFuture_allOf_five_creates() throws Exception {
        List<CompletableFuture<Map<String, Object>>> futures = new ArrayList<>();
        for (int i = 0; i < 5; i++) {
            final int idx = i;
            futures.add(CompletableFuture.supplyAsync(() ->
                    dbRef.table("posts").insert(Map.of("title", PREFIX + "-allof5-" + idx))));
        }
        CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).get(15, TimeUnit.SECONDS);
        for (CompletableFuture<Map<String, Object>> f : futures) {
            String id = (String) f.join().get("id");
            assertNotNull(id);
            CREATED_IDS.add(id);
        }
    }

    // ─── 8. ExecutorService (언어특화) ────────────────────────────────────────

    @Test
    void test_executorService_parallel_creates() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(3);
        List<java.util.concurrent.Future<Map<String, Object>>> futures = new ArrayList<>();
        for (int i = 0; i < 3; i++) {
            final int idx = i;
            futures.add(pool.submit(() ->
                    dbRef.table("posts").insert(Map.of("title", PREFIX + "-executor-" + idx))));
        }
        pool.shutdown();
        assertTrue(pool.awaitTermination(15, TimeUnit.SECONDS));
        for (var f : futures) {
            Map<String, Object> r = f.get();
            assertNotNull(r.get("id"));
            CREATED_IDS.add((String) r.get("id"));
        }
    }

    // ─── 9. Immutability (언어특화) ──────────────────────────────────────────

    @Test
    void test_filter_chain_immutability() {
        TableRef t1 = dbRef.table("posts");
        TableRef t2 = t1.where("status", "==", "published").limit(5).orderBy("createdAt", "desc");
        // Both references should be independent
        assertNotSame(t1, t2);
    }

    @Test
    void test_chaining_does_not_mutate_original() {
        TableRef base = dbRef.table("posts");
        TableRef filtered = base.where("title", "==", "X");
        TableRef limited = base.limit(10);
        assertNotSame(base, filtered);
        assertNotSame(base, limited);
        assertNotSame(filtered, limited);
    }

    @Test
    void test_deep_chain_immutability() {
        TableRef t = dbRef.table("posts")
                .where("title", "contains", "test")
                .orderBy("createdAt", "desc")
                .limit(20)
                .offset(0);
        // Original table should still be usable independently
        TableRef t2 = dbRef.table("posts").limit(1);
        assertNotSame(t, t2);
    }

    // ─── 10. Storage ─────────────────────────────────────────────────────────

    @Test
    void test_storage_upload_download_delete() {
        StorageClient storageClient = new StorageClient(httpClient);
        StorageBucket bucket = storageClient.bucket("test-bucket");
        String key = "java-core-e2e-" + System.currentTimeMillis() + ".txt";
        byte[] data = "Hello from Java Core E2E".getBytes(StandardCharsets.UTF_8);

        // Upload
        FileInfo info = bucket.upload(key, data, "text/plain");
        assertNotNull(info.getKey());

        // Download
        byte[] downloaded = bucket.download(key);
        assertEquals("Hello from Java Core E2E", new String(downloaded, StandardCharsets.UTF_8));

        // Delete
        bucket.delete(key);
    }

    @Test
    void test_storage_list() {
        StorageClient storageClient = new StorageClient(httpClient);
        StorageBucket bucket = storageClient.bucket("test-bucket");
        Map<String, Object> listResult = bucket.list();
        assertNotNull(listResult);
    }

    @Test
    void test_storage_upload_string() {
        StorageClient storageClient = new StorageClient(httpClient);
        StorageBucket bucket = storageClient.bucket("test-bucket");
        String key = "java-core-e2e-str-" + System.currentTimeMillis() + ".txt";
        FileInfo info = bucket.uploadString(key, "raw text content");
        assertNotNull(info.getKey());
        bucket.delete(key);
    }

    @Test
    void test_storage_signed_url() {
        StorageClient storageClient = new StorageClient(httpClient);
        StorageBucket bucket = storageClient.bucket("test-bucket");
        String key = "java-core-e2e-signed-" + System.currentTimeMillis() + ".txt";
        bucket.upload(key, "signed url test".getBytes(StandardCharsets.UTF_8), "text/plain");

        SignedUrlResult signed = bucket.createSignedUrl(key, "1h");
        assertNotNull(signed.getUrl());
        assertFalse(signed.getUrl().isEmpty());
        assertTrue(signed.getExpiresIn() > 0);

        bucket.delete(key);
    }

    @Test
    void test_storage_getUrl() {
        StorageClient storageClient = new StorageClient(httpClient);
        StorageBucket bucket = storageClient.bucket("test-bucket");
        String url = bucket.getUrl("test-file.txt");
        assertTrue(url.contains("test-bucket"));
        assertTrue(url.contains("test-file.txt"));
    }

    // ─── 11. checked exception handling (Java 언어특화) ──────────────────────

    @Test
    void test_checked_exception_wrapping() {
        // EdgeBaseError extends RuntimeException, so unchecked.
        // But we can demonstrate catching and re-wrapping:
        Exception wrapped = null;
        try {
            dbRef.table("posts").getOne("nonexistent-checked-xxx");
        } catch (EdgeBaseError e) {
            wrapped = new Exception("Wrapped: " + e.getMessage(), e);
        }
        assertNotNull(wrapped);
        assertTrue(wrapped.getCause() instanceof EdgeBaseError);
    }

    // ─── 12. Large payload ───────────────────────────────────────────────────

    @Test
    void test_insert_large_body() {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 1000; i++) {
            sb.append("Lorem ipsum dolor sit amet. ");
        }
        Map<String, Object> record = dbRef.table("posts").insert(
                Map.of("title", PREFIX + "-large", "body", sb.toString()));
        String id = (String) record.get("id");
        assertNotNull(id);
        CREATED_IDS.add(id);
        Map<String, Object> fetched = dbRef.table("posts").getOne(id);
        String body = (String) fetched.get("body");
        assertTrue(body.length() > 1000);
    }
}
