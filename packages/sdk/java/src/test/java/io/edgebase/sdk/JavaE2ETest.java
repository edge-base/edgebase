/**
 * Java SDK — E2E 테스트
 *
 * 전제: wrangler dev --port 8688 로컬 서버 실행 중
 *
 * 실행:
 *   BASE_URL=http://localhost:8688 SERVICE_KEY=test-service-key-for-admin \
 *     cd packages/sdk/java && mvn test -Dtest=JavaE2ETest
 *
 * JUnit5 + CompletableFuture + Gson 사용
 */

package io.edgebase.sdk;

import com.google.gson.JsonObject;
import org.junit.jupiter.api.*;
import static org.junit.jupiter.api.Assertions.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.*;
import java.util.concurrent.*;

@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class JavaE2ETest {

    static String BASE_URL = System.getenv("BASE_URL") != null ? System.getenv("BASE_URL") : "http://localhost:8688";
    static String SERVICE_KEY = System.getenv("SERVICE_KEY") != null ? System.getenv("SERVICE_KEY")
            : "test-service-key-for-admin";
    static String PREFIX = "java-e2e-" + System.currentTimeMillis();
    List<String> createdIds = new ArrayList<>();
    AdminEdgeBase admin;

    @BeforeAll
    void setup() {
        assumeServerAvailable();
        admin = new AdminEdgeBase(BASE_URL, SERVICE_KEY);
    }

    private void assumeServerAvailable() {
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

    private boolean isServerAvailable() {
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
    void cleanup() {
        if (admin == null) {
            return;
        }
        for (String id : createdIds) {
            try {
                admin.db("shared").table("posts").delete(id);
            } catch (Exception ignored) {
            }
        }
        admin.shutdown();
    }

    // ─── 1. DB CRUD ───────────────────────────────────────────────────────────

    @Test
    void create_idReturned() {
        var r = admin.db("shared").table("posts").insert(Map.of("title", PREFIX + "-create"));
        assertTrue(r.has("id"));
        createdIds.add(r.get("id").getAsString());
    }

    @Test
    void getOne_recordReturned() {
        var created = admin.db("shared").table("posts").insert(Map.of("title", PREFIX + "-getOne"));
        String id = created.get("id").getAsString();
        createdIds.add(id);
        var fetched = admin.db("shared").table("posts").getOne(id);
        assertEquals(id, fetched.get("id").getAsString());
    }

    @Test
    void update_titleChanged() {
        var created = admin.db("shared").table("posts").insert(Map.of("title", PREFIX + "-orig"));
        String id = created.get("id").getAsString();
        createdIds.add(id);
        var updated = admin.db("shared").table("posts").update(id, Map.of("title", PREFIX + "-updated"));
        assertEquals(PREFIX + "-updated", updated.get("title").getAsString());
    }

    @Test
    void delete_getOneThrows() {
        var created = admin.db("shared").table("posts").insert(Map.of("title", PREFIX + "-del"));
        String id = created.get("id").getAsString();
        admin.db("shared").table("posts").delete(id);
        assertThrows(EdgeBaseException.class, () -> admin.db("shared").table("posts").getOne(id));
    }

    @Test
    void getList_returnsItems() {
        var result = admin.db("shared").table("posts").limit(5).getList();
        assertNotNull(result.items);
        assertTrue(result.items.size() <= 5);
    }

    @Test
    void count_returnsNumber() {
        int count = admin.db("shared").table("posts").count();
        assertTrue(count >= 0);
    }

    // ─── 2. Filter ────────────────────────────────────────────────────────────

    @Test
    void whereFilter_findsRecord() {
        String unique = PREFIX + "-filter-" + System.nanoTime();
        var r = admin.db("shared").table("posts").insert(Map.of("title", unique));
        createdIds.add(r.get("id").getAsString());
        var list = admin.db("shared").table("posts").where("title", "==", unique).getList();
        assertFalse(list.items.isEmpty());
        assertEquals(unique, list.items.get(0).get("title").getAsString());
    }

    @Test
    void orderByLimit_maxN() {
        var list = admin.db("shared").table("posts").orderBy("createdAt", "desc").limit(3).getList();
        assertTrue(list.items.size() <= 3);
    }

    @Test
    void offsetPagination_page1NotEqualPage2() {
        String title = PREFIX + "-page";
        for (int i = 0; i < 5; i++) {
            var r = admin.db("shared").table("posts").insert(Map.of("title", title + "-" + i));
            createdIds.add(r.get("id").getAsString());
        }
        var p1 = admin.db("shared").table("posts")
                .where("title", "contains", title).orderBy("title", "asc").limit(2).getList();
        var p2 = admin.db("shared").table("posts")
                .where("title", "contains", title).orderBy("title", "asc").limit(2).offset(2).getList();
        if (!p1.items.isEmpty() && !p2.items.isEmpty()) {
            assertNotEquals(p1.items.get(0).get("id").getAsString(), p2.items.get(0).get("id").getAsString());
        }
    }

    // ─── 3. Batch ─────────────────────────────────────────────────────────────

    @Test
    void insertMany_nItems() {
        List<Map<String, Object>> items = List.of(
                Map.of("title", PREFIX + "-batch-1"),
                Map.of("title", PREFIX + "-batch-2"),
                Map.of("title", PREFIX + "-batch-3"));
        var result = admin.db("shared").table("posts").insertMany(items);
        assertEquals(3, result.size());
        for (var r : result)
            createdIds.add(r.get("id").getAsString());
    }

    // ─── 4. Upsert ────────────────────────────────────────────────────────────

    @Test
    void upsert_newRecord_actionCreated() {
        var r = admin.db("shared").table("posts").upsert(Map.of("title", PREFIX + "-upsert"), null);
        assertEquals("inserted", r.has("action") ? r.get("action").getAsString() : "");
        createdIds.add(r.get("id").getAsString());
    }

    // ─── 5. FieldOps ─────────────────────────────────────────────────────────

    @Test
    void increment_viewCountIncreases() {
        var created = admin.db("shared").table("posts").insert(Map.of("title", PREFIX + "-inc", "viewCount", 0));
        String id = created.get("id").getAsString();
        createdIds.add(id);
        Map<String, Object> updateData = new HashMap<>();
        updateData.put("viewCount", FieldOp.increment(5));
        var updated = admin.db("shared").table("posts").update(id, updateData);
        assertEquals(5, updated.has("viewCount") ? updated.get("viewCount").getAsInt() : 0);
    }

    // ─── 6. AdminAuth ─────────────────────────────────────────────────────────

    @Test
    void adminAuth_createUser() {
        String email = "java-auth-" + System.currentTimeMillis() + "@test.com";
        var r = admin.adminAuth.createUser(email, "JavaE2EPass123!");
        // user.id or id
        String userId = r.has("id") ? r.get("id").getAsString()
                : (r.has("user") && r.get("user").isJsonObject()
                        ? r.get("user").getAsJsonObject().get("id").getAsString()
                        : "");
        assertFalse(userId.isEmpty());
    }

    @Test
    void adminAuth_listUsers() {
        var r = admin.adminAuth.listUsers(10);
        assertTrue(r.has("users"));
    }

    // ─── 7. Error Handling ────────────────────────────────────────────────────

    @Test
    void getOne_nonExistent_throws() {
        assertThrows(EdgeBaseException.class, () -> admin.db("shared").table("posts").getOne("nonexistent-java-99999"));
    }

    @Test
    void update_nonExistent_throws() {
        assertThrows(EdgeBaseException.class,
                () -> admin.db("shared").table("posts").update("nonexistent-java-upd", Map.of("title", "X")));
    }

    // ─── 8. CompletableFuture — Java 언어특화 ────────────────────────────────

    @Test
    void completableFuture_parallel3Requests() throws Exception {
        List<CompletableFuture<JsonObject>> futures = new ArrayList<>();
        for (int i = 0; i < 3; i++) {
            final int idx = i;
            futures.add(admin.insertAsync(admin.db("shared"), "posts", Map.of("title", PREFIX + "-cf-" + idx)));
        }
        CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).get(10, TimeUnit.SECONDS);
        for (var f : futures) {
            var r = f.get();
            assertTrue(r.has("id"));
            createdIds.add(r.get("id").getAsString());
        }
    }

    @Test
    void executorService_concurrentRequests() throws Exception {
        ExecutorService exec = Executors.newFixedThreadPool(3);
        List<Future<JsonObject>> futures = new ArrayList<>();
        for (int i = 0; i < 3; i++) {
            final int idx = i;
            futures.add(exec
                    .submit(() -> admin.db("shared").table("posts").insert(Map.of("title", PREFIX + "-exec-" + idx))));
        }
        for (var f : futures) {
            var r = f.get(10, TimeUnit.SECONDS);
            createdIds.add(r.get("id").getAsString());
        }
        exec.shutdown();
        assertEquals(3, futures.size());
    }
}
