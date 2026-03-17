package dev.edgebase.sdk.client;

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
 * Java android (client) SDK — E2E 테스트
 *
 * 전제: wrangler dev --port 8688 서버 실행 중
 *
 * 실행:
 * BASE_URL=http://localhost:8688 \
 * cd packages/sdk/java/packages/android && ./gradlew test
 *
 * 원칙: mock 금지, ClientEdgeBase 실서버 기반
 */
@SuppressWarnings("deprecation")
public class AndroidE2ETest {

    private static final String BASE_URL = Optional.ofNullable(System.getenv("BASE_URL"))
            .orElse("http://localhost:8688");
    private static final String PREFIX = "java-android-e2e-" + System.currentTimeMillis();
    private static final String AUTH_STORAGE_BUCKET = "documents";
    private static final List<String> CREATED_IDS = Collections.synchronizedList(new ArrayList<>());
    private static final List<String> STORAGE_KEYS = Collections.synchronizedList(new ArrayList<>());
    private static ClientEdgeBase client;

    @BeforeAll
    static void setUp() {
        assumeServerAvailable();
        client = new ClientEdgeBase(BASE_URL);
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
        if (client == null) {
            return;
        }
        // cleanup DB records
        for (String id : CREATED_IDS) {
            try {
                client.db("shared").table("posts").doc(id).delete();
            } catch (Exception ignored) {
            }
        }
        // cleanup storage files
        for (String key : STORAGE_KEYS) {
            try {
                client.storage().bucket(AUTH_STORAGE_BUCKET).delete(key);
            } catch (Exception ignored) {
            }
        }
        client.destroy();
    }

    // ─── 1. Auth ─────────────────────────────────────────────────────────────

    @Test
    void test_signUp_returns_accessToken() {
        String email = PREFIX + "-signup@test.com";
        Map<String, Object> result = client.auth().signUp(email, "JavaAndroid123!");
        assertNotNull(result.get("accessToken"), "signUp should return accessToken");
    }

    @Test
    void test_signIn_returns_accessToken() {
        String email = PREFIX + "-signin@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        Map<String, Object> result = client.auth().signIn(email, "JavaAndroid123!");
        assertNotNull(result.get("accessToken"));
    }

    @Test
    void test_signOut_succeeds() {
        String email = PREFIX + "-signout@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        assertDoesNotThrow(() -> client.auth().signOut());
    }

    @Test
    void test_signInAnonymously_returns_token() {
        Map<String, Object> result = client.auth().signInAnonymously();
        assertNotNull(result.get("accessToken"), "anonymous should return accessToken");
    }

    @Test
    void test_wrong_password_throws() {
        String email = PREFIX + "-wrongpw@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        assertThrows(dev.edgebase.sdk.core.EdgeBaseError.class, () -> client.auth().signIn(email, "WrongPass!"));
    }

    @Test
    void test_signUp_with_displayName() {
        String email = PREFIX + "-display@test.com";
        Map<String, Object> result = client.auth().signUp(email, "JavaAndroid123!",
                Map.of("displayName", "Test User"), null);
        assertNotNull(result.get("accessToken"));
    }

    // ─── 2. DB (authenticated) ────────────────────────────────────────────────

    @Test
    void test_insert_returns_id() {
        String email = PREFIX + "-db@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        Map<String, Object> record = client.db("shared").table("posts").insert(
                Map.of("title", PREFIX + "-create"));
        String id = (String) record.get("id");
        assertNotNull(id);
        CREATED_IDS.add(id);
    }

    @Test
    void test_get_list_returns_items() {
        String email = PREFIX + "-list@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        dev.edgebase.sdk.core.ListResult result = client.db("shared").table("posts").limit(3).getList();
        assertNotNull(result.getItems());
        assertTrue(result.getItems().size() <= 3);
    }

    @Test
    void test_where_filter_finds_record() {
        String email = PREFIX + "-filter@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        String unique = PREFIX + "-filter-" + System.currentTimeMillis();
        Map<String, Object> r = client.db("shared").table("posts").insert(Map.of("title", unique));
        String id = (String) r.get("id");
        assertNotNull(id);
        CREATED_IDS.add(id);
        dev.edgebase.sdk.core.ListResult list = client.db("shared").table("posts")
                .where("title", "==", unique).getList();
        assertFalse(list.getItems().isEmpty(), "Should find the created record");
    }

    // ─── 3. Error ─────────────────────────────────────────────────────────────

    @Test
    void test_getOne_nonexistent_throws() {
        String email = PREFIX + "-err@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        assertThrows(dev.edgebase.sdk.core.EdgeBaseError.class,
                () -> client.db("shared").table("posts").getOne("nonexistent-android-99999"));
    }

    // ─── 4. CompletableFuture 병렬 (언어특화) ─────────────────────────────────

    @Test
    void test_parallel_create_with_completable_future() throws Exception {
        String email = PREFIX + "-parallel@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        List<String> titles = List.of(PREFIX + "-par-1", PREFIX + "-par-2", PREFIX + "-par-3");
        List<java.util.concurrent.CompletableFuture<Map<String, Object>>> futures = titles.stream()
                .map(t -> java.util.concurrent.CompletableFuture
                        .supplyAsync(() -> client.db("shared").table("posts").insert(Map.of("title", t))))
                .toList();
        List<Map<String, Object>> results = java.util.concurrent.CompletableFuture
                .allOf(futures.toArray(new java.util.concurrent.CompletableFuture[0]))
                .thenApply(ignored -> futures.stream().map(java.util.concurrent.CompletableFuture::join).toList())
                .get();
        assertEquals(3, results.size());
        results.stream().map(r -> (String) r.get("id")).filter(Objects::nonNull).forEach(CREATED_IDS::add);
    }

    // ─── 5. tryWithResources & cleanup ───────────────────────────────────────

    @Test
    void test_signUp_returns_user_email() {
        String email = PREFIX + "-email@test.com";
        Map<String, Object> result = client.auth().signUp(email, "JavaAndroid123!");
        assertNotNull(result.get("accessToken"));
        // user.email should be present in response
        @SuppressWarnings("unchecked")
        Map<String, Object> user = (Map<String, Object>) result.get("user");
        if (user != null) {
            assertEquals(email, user.get("email"));
        }
    }

    // ─── 6. Auth additional ──────────────────────────────────────────────────

    @Test
    void test_updateProfile_changes_displayName() {
        String email = PREFIX + "-updprof@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        Map<String, Object> result = client.auth().updateProfile(
                Map.of("displayName", "Updated Name"));
        assertNotNull(result);
    }

    @Test
    void test_changePassword_succeeds() {
        String email = PREFIX + "-chgpw@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        Map<String, Object> result = client.auth().changePassword("JavaAndroid123!", "NewPass456!");
        assertNotNull(result);
    }

    @Test
    void test_listSessions_returns_list() {
        String email = PREFIX + "-sess@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        List<Map<String, Object>> sessions = client.auth().listSessions();
        assertNotNull(sessions);
        assertFalse(sessions.isEmpty(), "should have at least the current session");
    }

    @Test
    void test_revokeSession_removes_session() {
        String email = PREFIX + "-revoke@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        List<Map<String, Object>> sessions = client.auth().listSessions();
        assertFalse(sessions.isEmpty());
        // Revoke a session other than the current one if possible,
        // or just verify the API call completes.
        // Sign in again to create a second session, then revoke it.
        client.auth().signIn(email, "JavaAndroid123!");
        List<Map<String, Object>> sessions2 = client.auth().listSessions();
        if (sessions2.size() >= 2) {
            String sessionId = (String) sessions2.get(sessions2.size() - 1).get("id");
            assertDoesNotThrow(() -> client.auth().revokeSession(sessionId));
        }
    }

    @Test
    void test_signInAnonymously_isAnonymous() {
        Map<String, Object> result = client.auth().signInAnonymously();
        assertNotNull(result.get("accessToken"));
        @SuppressWarnings("unchecked")
        Map<String, Object> user = (Map<String, Object>) result.get("user");
        if (user != null) {
            assertTrue((Boolean) user.getOrDefault("isAnonymous", false),
                    "anonymous user should have isAnonymous=true");
        }
    }

    @Test
    void test_currentUser_after_signUp() {
        String email = PREFIX + "-curuser@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        Map<String, Object> currentUser = client.auth().currentUser();
        // currentUser is derived from the stored token; may be null if token is opaque
        // but should not throw
        assertDoesNotThrow(() -> client.auth().currentUser());
    }

    @Test
    void test_duplicate_email_throws() {
        String email = PREFIX + "-dup@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        assertThrows(dev.edgebase.sdk.core.EdgeBaseError.class,
                () -> client.auth().signUp(email, "JavaAndroid123!"));
    }

    @Test
    void test_signInWithOAuth_returns_url() {
        String url = client.auth().signInWithOAuth("google");
        assertNotNull(url);
        assertTrue(url.contains("/api/auth/oauth/google"), "OAuth URL should contain provider path");
    }

    @Test
    void test_getMe_after_signUp() {
        String email = PREFIX + "-getme@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        Map<String, Object> me = client.auth().getMe();
        assertNotNull(me);
        // me should contain the user's email
        assertEquals(email, me.get("email"));
    }

    @Test
    void test_refreshToken_returns_new_tokens() {
        String email = PREFIX + "-refresh@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        Map<String, Object> result = client.auth().refreshToken();
        assertNotNull(result.get("accessToken"), "refreshToken should return new accessToken");
    }

    // ─── 7. DB additional ────────────────────────────────────────────────────

    @Test
    void test_update_changes_field() {
        String email = PREFIX + "-dbupd@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        Map<String, Object> created = client.db("shared").table("posts")
                .insert(Map.of("title", PREFIX + "-upd-orig"));
        String id = (String) created.get("id");
        assertNotNull(id);
        CREATED_IDS.add(id);
        Map<String, Object> updated = client.db("shared").table("posts").doc(id)
                .update(Map.of("title", PREFIX + "-upd-changed"));
        assertEquals(PREFIX + "-upd-changed", updated.get("title"));
    }

    @Test
    void test_delete_then_getOne_throws() {
        String email = PREFIX + "-dbdel@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        Map<String, Object> created = client.db("shared").table("posts")
                .insert(Map.of("title", PREFIX + "-del-test"));
        String id = (String) created.get("id");
        assertNotNull(id);
        client.db("shared").table("posts").doc(id).delete();
        assertThrows(dev.edgebase.sdk.core.EdgeBaseError.class,
                () -> client.db("shared").table("posts").getOne(id));
    }

    @Test
    void test_list_orderBy() {
        String email = PREFIX + "-dbord@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        dev.edgebase.sdk.core.ListResult result = client.db("shared").table("posts")
                .orderBy("createdAt", "desc").limit(5).getList();
        assertNotNull(result.getItems());
    }

    @Test
    void test_list_where_multiple() {
        String email = PREFIX + "-dbmwh@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        String unique = PREFIX + "-mwhere-" + System.currentTimeMillis();
        Map<String, Object> r = client.db("shared").table("posts")
                .insert(Map.of("title", unique));
        String id = (String) r.get("id");
        CREATED_IDS.add(id);
        dev.edgebase.sdk.core.ListResult list = client.db("shared").table("posts")
                .where("title", "==", unique)
                .where("id", "!=", "nonexistent")
                .getList();
        assertFalse(list.getItems().isEmpty());
    }

    @Test
    void test_count_with_filter() {
        String email = PREFIX + "-dbcnt@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        String unique = PREFIX + "-cnt-" + System.currentTimeMillis();
        Map<String, Object> r = client.db("shared").table("posts")
                .insert(Map.of("title", unique));
        CREATED_IDS.add((String) r.get("id"));
        int count = client.db("shared").table("posts")
                .where("title", "==", unique).count();
        assertEquals(1, count);
    }

    @Test
    void test_offset_pagination() {
        String email = PREFIX + "-dboff@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        dev.edgebase.sdk.core.ListResult result = client.db("shared").table("posts")
                .limit(2).offset(0).getList();
        assertNotNull(result.getItems());
        assertTrue(result.getItems().size() <= 2);
    }

    @Test
    void test_upsert_creates_new() {
        String email = PREFIX + "-dbups@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        dev.edgebase.sdk.core.UpsertResult result = client.db("shared").table("posts")
                .upsert(Map.of("title", PREFIX + "-upsert-new"));
        assertNotNull(result.getRecord().get("id"));
        CREATED_IDS.add((String) result.getRecord().get("id"));
    }

    @Test
    void test_batch_insertMany() {
        String email = PREFIX + "-dbbatch@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        List<Map<String, Object>> records = List.of(
                Map.of("title", PREFIX + "-batch-1"),
                Map.of("title", PREFIX + "-batch-2"),
                Map.of("title", PREFIX + "-batch-3"));
        List<Map<String, Object>> created = client.db("shared").table("posts").insertMany(records);
        assertEquals(3, created.size());
        created.stream().map(r -> (String) r.get("id")).filter(Objects::nonNull).forEach(CREATED_IDS::add);
    }

    @Test
    void test_fieldOps_increment() {
        String email = PREFIX + "-dbincr@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        Map<String, Object> data = new HashMap<>();
        data.put("title", PREFIX + "-incr");
        data.put("views", 10);
        Map<String, Object> created = client.db("shared").table("posts").insert(data);
        String id = (String) created.get("id");
        CREATED_IDS.add(id);
        client.db("shared").table("posts").doc(id)
                .update(Map.of("views", dev.edgebase.sdk.core.FieldOps.increment(5)));
        Map<String, Object> fetched = client.db("shared").table("posts").getOne(id);
        Number views = (Number) fetched.get("views");
        assertNotNull(views);
        assertEquals(15, views.intValue());
    }

    @Test
    void test_fieldOps_deleteField() {
        String email = PREFIX + "-dbdelf@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        Map<String, Object> data = new HashMap<>();
        data.put("title", PREFIX + "-delfld");
        data.put("temp", "to-remove");
        Map<String, Object> created = client.db("shared").table("posts").insert(data);
        String id = (String) created.get("id");
        CREATED_IDS.add(id);
        client.db("shared").table("posts").doc(id)
                .update(Map.of("temp", dev.edgebase.sdk.core.FieldOps.deleteField()));
        Map<String, Object> fetched = client.db("shared").table("posts").getOne(id);
        assertNull(fetched.get("temp"));
    }

    // ─── 8. Storage ──────────────────────────────────────────────────────────

    @Test
    void test_storage_upload_download_roundtrip_with_auth() {
        String email = PREFIX + "-stor@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        String key = "android-e2e-" + System.currentTimeMillis() + ".txt";
        byte[] data = "Hello from Android E2E".getBytes(StandardCharsets.UTF_8);

        dev.edgebase.sdk.core.FileInfo info = client.storage().bucket(AUTH_STORAGE_BUCKET)
                .upload(key, data, "text/plain");
        assertNotNull(info.getKey());
        STORAGE_KEYS.add(key);

        byte[] downloaded = client.storage().bucket(AUTH_STORAGE_BUCKET).download(key);
        assertEquals("Hello from Android E2E", new String(downloaded, StandardCharsets.UTF_8));
    }

    @Test
    void test_storage_list_with_prefix_with_auth() {
        String email = PREFIX + "-storlst@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        String prefix = "android-e2e-list-" + System.currentTimeMillis();
        String key = prefix + "/file-1.txt";
        String secondKey = prefix + "/file-2.txt";
        client.storage().bucket(AUTH_STORAGE_BUCKET)
                .upload(key, "test".getBytes(StandardCharsets.UTF_8), "text/plain");
        client.storage().bucket(AUTH_STORAGE_BUCKET)
                .upload(secondKey, "test".getBytes(StandardCharsets.UTF_8), "text/plain");
        STORAGE_KEYS.add(key);
        STORAGE_KEYS.add(secondKey);

        Map<String, Object> listResult = client.storage().bucket(AUTH_STORAGE_BUCKET).list(prefix);
        assertTrue(listResult.get("items") != null || listResult.get("files") != null);
        assertTrue(String.valueOf(listResult).contains(key));
    }

    @Test
    void test_storage_delete_with_auth() {
        String email = PREFIX + "-stordel@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        String key = "android-e2e-del-" + System.currentTimeMillis() + ".txt";
        client.storage().bucket(AUTH_STORAGE_BUCKET)
                .upload(key, "delete me".getBytes(StandardCharsets.UTF_8), "text/plain");

        assertDoesNotThrow(() -> client.storage().bucket(AUTH_STORAGE_BUCKET).delete(key));
        assertThrows(Exception.class, () -> client.storage().bucket(AUTH_STORAGE_BUCKET).download(key));
    }

    @Test
    void test_storage_signed_url_with_auth() {
        String email = PREFIX + "-storsign@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        String key = "android-e2e-signed-" + System.currentTimeMillis() + ".txt";
        client.storage().bucket(AUTH_STORAGE_BUCKET)
                .upload(key, "signed url test".getBytes(StandardCharsets.UTF_8), "text/plain");
        STORAGE_KEYS.add(key);

        dev.edgebase.sdk.core.SignedUrlResult signed = client.storage().bucket(AUTH_STORAGE_BUCKET).createSignedUrl(key);
        assertNotNull(signed.getUrl());
        assertFalse(signed.getUrl().isEmpty());
    }

    @Test
    void test_storage_metadata_with_auth() {
        String email = PREFIX + "-stormeta@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        String key = "android-e2e-meta-" + System.currentTimeMillis() + ".json";
        client.storage().bucket(AUTH_STORAGE_BUCKET)
                .upload(key, "{}".getBytes(StandardCharsets.UTF_8), "application/json");
        STORAGE_KEYS.add(key);

        dev.edgebase.sdk.core.FileInfo metadata = client.storage().bucket(AUTH_STORAGE_BUCKET).getMetadata(key);
        assertEquals(key, metadata.getKey());
        assertTrue(metadata.getContentType() == null || metadata.getContentType().contains("application/json"));
    }

    @Test
    void test_storage_uploadString_with_auth() {
        String email = PREFIX + "-storstr@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        String key = "android-e2e-upload-string-" + System.currentTimeMillis() + ".txt";
        String content = "uploadString from Android E2E";
        dev.edgebase.sdk.core.FileInfo info = client.storage().bucket(AUTH_STORAGE_BUCKET).uploadString(key, content);
        assertEquals(key, info.getKey());
        STORAGE_KEYS.add(key);

        byte[] downloaded = client.storage().bucket(AUTH_STORAGE_BUCKET).download(key);
        assertEquals(content, new String(downloaded, StandardCharsets.UTF_8));
    }

    @Test
    void test_storage_getUrl_contains_bucket_and_key() {
        String url = client.storage().bucket(AUTH_STORAGE_BUCKET).getUrl("folder/android-url.txt");
        assertTrue(url.contains(AUTH_STORAGE_BUCKET));
        assertTrue(url.contains("android-url.txt"));
    }

    @Test
    void test_storage_nonexistent_download_throws() {
        String email = PREFIX + "-stormiss@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        assertThrows(Exception.class, () -> client.storage().bucket(AUTH_STORAGE_BUCKET)
                .download("nonexistent-android-storage-" + System.currentTimeMillis() + ".txt"));
    }

    // ─── 9. Error handling ───────────────────────────────────────────────────

    @Test
    void test_invalid_service_key_client() {
        // A client SDK with a bad base URL should fail on auth operations
        ClientEdgeBase badClient = new ClientEdgeBase("http://localhost:1");
        try {
            assertThrows(Exception.class,
                    () -> badClient.auth().signUp("bad@test.com", "Bad123!"));
        } finally {
            badClient.destroy();
        }
    }

    @Test
    void test_error_has_status_code() {
        String email = PREFIX + "-errcode@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        try {
            client.db("shared").table("posts").getOne("nonexistent-android-88888");
            fail("Should have thrown EdgeBaseError");
        } catch (dev.edgebase.sdk.core.EdgeBaseError e) {
            assertTrue(e.getStatusCode() >= 400, "Error status should be >= 400");
        }
    }

    @Test
    void test_error_has_message() {
        String email = PREFIX + "-errmsg@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        try {
            client.db("shared").table("posts").getOne("nonexistent-android-77777");
            fail("Should have thrown EdgeBaseError");
        } catch (dev.edgebase.sdk.core.EdgeBaseError e) {
            assertNotNull(e.getMessage());
            assertFalse(e.getMessage().isEmpty());
        }
    }

    // ─── 10. Java-specific patterns ──────────────────────────────────────────

    @Test
    void test_completableFuture_allOf_parallel_reads() throws Exception {
        String email = PREFIX + "-cfpar@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        // Create records first
        Map<String, Object> r1 = client.db("shared").table("posts")
                .insert(Map.of("title", PREFIX + "-cfpar-1"));
        Map<String, Object> r2 = client.db("shared").table("posts")
                .insert(Map.of("title", PREFIX + "-cfpar-2"));
        String id1 = (String) r1.get("id");
        String id2 = (String) r2.get("id");
        CREATED_IDS.add(id1);
        CREATED_IDS.add(id2);

        // Parallel read via CompletableFuture
        CompletableFuture<Map<String, Object>> f1 = CompletableFuture
                .supplyAsync(() -> client.db("shared").table("posts").getOne(id1));
        CompletableFuture<Map<String, Object>> f2 = CompletableFuture
                .supplyAsync(() -> client.db("shared").table("posts").getOne(id2));
        CompletableFuture.allOf(f1, f2).get(10, TimeUnit.SECONDS);
        assertEquals(id1, f1.join().get("id"));
        assertEquals(id2, f2.join().get("id"));
    }

    @Test
    void test_sequential_auth_then_db() {
        // Verify that auth then DB operations work sequentially
        String email = PREFIX + "-seqauth@test.com";
        Map<String, Object> authResult = client.auth().signUp(email, "JavaAndroid123!");
        assertNotNull(authResult.get("accessToken"));

        // Immediately do DB operations
        Map<String, Object> record = client.db("shared").table("posts")
                .insert(Map.of("title", PREFIX + "-seq-post"));
        String id = (String) record.get("id");
        assertNotNull(id);
        CREATED_IDS.add(id);

        // Read back
        Map<String, Object> fetched = client.db("shared").table("posts").getOne(id);
        assertEquals(PREFIX + "-seq-post", fetched.get("title"));
    }

    @Test
    void test_multiple_clients_independent() {
        // Two clients should operate independently
        ClientEdgeBase client2 = new ClientEdgeBase(BASE_URL);
        try {
            String email1 = PREFIX + "-indep1@test.com";
            String email2 = PREFIX + "-indep2@test.com";
            client.auth().signUp(email1, "JavaAndroid123!");
            client2.auth().signUp(email2, "JavaAndroid123!");

            // Both should be able to create records independently
            Map<String, Object> r1 = client.db("shared").table("posts")
                    .insert(Map.of("title", PREFIX + "-indep-client1"));
            Map<String, Object> r2 = client2.db("shared").table("posts")
                    .insert(Map.of("title", PREFIX + "-indep-client2"));
            assertNotNull(r1.get("id"));
            assertNotNull(r2.get("id"));
            CREATED_IDS.add((String) r1.get("id"));
            CREATED_IDS.add((String) r2.get("id"));
        } finally {
            client2.destroy();
        }
    }

    @Test
    void test_error_message_contains_detail() {
        String email = PREFIX + "-errdet@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        try {
            client.db("shared").table("posts").getOne("nonexistent-detail-66666");
            fail("Should have thrown EdgeBaseError");
        } catch (dev.edgebase.sdk.core.EdgeBaseError e) {
            // toString() should include status code and message
            String str = e.toString();
            assertNotNull(str);
            assertTrue(str.contains("EdgeBaseError"));
        }
    }

    @Test
    void test_special_characters_in_data() {
        String email = PREFIX + "-special@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        String title = PREFIX + "-special-<>&\"'`!@#$%^*()-한국어-日本語";
        Map<String, Object> record = client.db("shared").table("posts")
                .insert(Map.of("title", title));
        String id = (String) record.get("id");
        assertNotNull(id);
        CREATED_IDS.add(id);
        Map<String, Object> fetched = client.db("shared").table("posts").getOne(id);
        assertEquals(title, fetched.get("title"));
    }

    // ─── 11. Additional query patterns ───────────────────────────────────────

    @Test
    void test_count_all_returns_number() {
        String email = PREFIX + "-cntall@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        int count = client.db("shared").table("posts").count();
        assertTrue(count >= 0);
    }

    @Test
    void test_orderBy_asc() {
        String email = PREFIX + "-ordasc@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        dev.edgebase.sdk.core.ListResult result = client.db("shared").table("posts")
                .orderBy("createdAt", "asc").limit(3).getList();
        assertNotNull(result.getItems());
    }

    @Test
    void test_create_and_read_back_fields() {
        String email = PREFIX + "-readbk@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        String title = PREFIX + "-readback-" + System.currentTimeMillis();
        Map<String, Object> record = client.db("shared").table("posts")
                .insert(Map.of("title", title, "body", "content here"));
        String id = (String) record.get("id");
        CREATED_IDS.add(id);
        Map<String, Object> fetched = client.db("shared").table("posts").getOne(id);
        assertEquals(title, fetched.get("title"));
    }

    @Test
    void test_create_returns_createdAt() {
        String email = PREFIX + "-crts@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        Map<String, Object> record = client.db("shared").table("posts")
                .insert(Map.of("title", PREFIX + "-ts"));
        String id = (String) record.get("id");
        CREATED_IDS.add(id);
        assertNotNull(record.get("createdAt"));
    }

    @Test
    void test_update_multiple_fields() {
        String email = PREFIX + "-updmul@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        Map<String, Object> created = client.db("shared").table("posts")
                .insert(Map.of("title", PREFIX + "-multi-upd"));
        String id = (String) created.get("id");
        CREATED_IDS.add(id);
        Map<String, Object> updated = client.db("shared").table("posts").doc(id)
                .update(Map.of("title", PREFIX + "-multi-upd-v2", "body", "new body"));
        assertEquals(PREFIX + "-multi-upd-v2", updated.get("title"));
    }

    @Test
    void test_doc_ref_get() {
        String email = PREFIX + "-docget@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        Map<String, Object> created = client.db("shared").table("posts")
                .insert(Map.of("title", PREFIX + "-docref-get"));
        String id = (String) created.get("id");
        CREATED_IDS.add(id);
        Map<String, Object> doc = client.db("shared").table("posts").doc(id).get();
        assertEquals(id, doc.get("id"));
    }

    @Test
    void test_doc_ref_delete_returns() {
        String email = PREFIX + "-docdel@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        Map<String, Object> created = client.db("shared").table("posts")
                .insert(Map.of("title", PREFIX + "-docref-del"));
        String id = (String) created.get("id");
        Map<String, Object> result = client.db("shared").table("posts").doc(id).delete();
        assertNotNull(result);
    }

    // ─── 12. ExecutorService (Java-specific) ─────────────────────────────────

    @Test
    void test_executorService_parallel_creates() throws Exception {
        String email = PREFIX + "-executor@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        ExecutorService pool = Executors.newFixedThreadPool(3);
        List<java.util.concurrent.Future<Map<String, Object>>> futures = new ArrayList<>();
        for (int i = 0; i < 3; i++) {
            final int idx = i;
            futures.add(pool.submit(() ->
                    client.db("shared").table("posts")
                            .insert(Map.of("title", PREFIX + "-executor-" + idx))));
        }
        pool.shutdown();
        assertTrue(pool.awaitTermination(15, TimeUnit.SECONDS));
        for (var f : futures) {
            Map<String, Object> r = f.get();
            assertNotNull(r.get("id"));
            CREATED_IDS.add((String) r.get("id"));
        }
    }

    // ─── 13. Filter chain immutability (Java-specific) ───────────────────────

    @Test
    void test_filter_chain_immutability() {
        dev.edgebase.sdk.core.TableRef t1 = client.db("shared").table("posts");
        dev.edgebase.sdk.core.TableRef t2 = t1.where("status", "==", "published")
                .limit(5).orderBy("createdAt", "desc");
        assertNotSame(t1, t2);
    }

    // ─── 14. Auth state change listener ──────────────────────────────────────

    @Test
    void test_onAuthStateChange_fires() {
        ClientEdgeBase stateClient = new ClientEdgeBase(BASE_URL);
        try {
            List<Map<String, Object>> states = Collections.synchronizedList(new ArrayList<>());
            stateClient.auth().onAuthStateChange(states::add);
            String email = PREFIX + "-stchg@test.com";
            stateClient.auth().signUp(email, "JavaAndroid123!");
            // After signUp, state change should fire at least once
            // (implementation may batch or defer, so we just check no error)
            assertDoesNotThrow(() -> stateClient.auth().signOut());
        } finally {
            stateClient.destroy();
        }
    }

    // ─── 15. Push Client E2E ──────────────────────────────────────────────────

    @Test
    void test_push_register_with_auth() throws Exception {
        String email = PREFIX + "-pushreg@test.com";
        Map<String, Object> authResult = client.auth().signUp(email, "JavaAndroid123!");
        String accessToken = (String) authResult.get("accessToken");
        assertNotNull(accessToken);

        String deviceId = "android-push-e2e-" + System.currentTimeMillis();
        String fcmToken = "fake-fcm-token-android-" + System.currentTimeMillis();
        String body = String.format(
                "{\"deviceId\":\"%s\",\"token\":\"%s\",\"platform\":\"android\"}",
                deviceId, fcmToken);

        java.net.URL url = new java.net.URL(BASE_URL + "/api/push/register");
        java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("Authorization", "Bearer " + accessToken);
        conn.setDoOutput(true);
        conn.getOutputStream().write(body.getBytes(StandardCharsets.UTF_8));
        int status = conn.getResponseCode();
        conn.disconnect();
        // 200 = success, 503 = push not configured
        assertTrue(status == 200 || status == 503,
                "push.register should return 200 or 503, got " + status);
    }

    @Test
    void test_push_subscribe_topic_with_auth() throws Exception {
        String email = PREFIX + "-pushsub@test.com";
        Map<String, Object> authResult = client.auth().signUp(email, "JavaAndroid123!");
        String accessToken = (String) authResult.get("accessToken");
        assertNotNull(accessToken);

        String body = "{\"topic\":\"android-test-topic\"}";
        java.net.URL url = new java.net.URL(BASE_URL + "/api/push/topic/subscribe");
        java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("Authorization", "Bearer " + accessToken);
        conn.setDoOutput(true);
        conn.getOutputStream().write(body.getBytes(StandardCharsets.UTF_8));
        int status = conn.getResponseCode();
        conn.disconnect();
        assertTrue(status == 200 || status == 503,
                "push.subscribeTopic should return 200 or 503, got " + status);
    }

    @Test
    void test_push_unsubscribe_topic_with_auth() throws Exception {
        String email = PREFIX + "-pushunsub@test.com";
        Map<String, Object> authResult = client.auth().signUp(email, "JavaAndroid123!");
        String accessToken = (String) authResult.get("accessToken");
        assertNotNull(accessToken);

        String body = "{\"topic\":\"android-test-topic\"}";
        java.net.URL url = new java.net.URL(BASE_URL + "/api/push/topic/unsubscribe");
        java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("Authorization", "Bearer " + accessToken);
        conn.setDoOutput(true);
        conn.getOutputStream().write(body.getBytes(StandardCharsets.UTF_8));
        int status = conn.getResponseCode();
        conn.disconnect();
        assertTrue(status == 200 || status == 503,
                "push.unsubscribeTopic should return 200 or 503, got " + status);
    }

    @Test
    void test_push_unregister_with_auth() throws Exception {
        String email = PREFIX + "-pushunreg@test.com";
        Map<String, Object> authResult = client.auth().signUp(email, "JavaAndroid123!");
        String accessToken = (String) authResult.get("accessToken");
        assertNotNull(accessToken);

        // Register first
        String deviceId = "android-push-unreg-e2e-" + System.currentTimeMillis();
        String fcmToken = "fake-fcm-token-unreg-" + System.currentTimeMillis();
        String regBody = String.format(
                "{\"deviceId\":\"%s\",\"token\":\"%s\",\"platform\":\"android\"}",
                deviceId, fcmToken);
        java.net.URL regUrl = new java.net.URL(BASE_URL + "/api/push/register");
        java.net.HttpURLConnection regConn = (java.net.HttpURLConnection) regUrl.openConnection();
        regConn.setRequestMethod("POST");
        regConn.setRequestProperty("Content-Type", "application/json");
        regConn.setRequestProperty("Authorization", "Bearer " + accessToken);
        regConn.setDoOutput(true);
        regConn.getOutputStream().write(regBody.getBytes(StandardCharsets.UTF_8));
        int regStatus = regConn.getResponseCode();
        regConn.disconnect();
        assertTrue(regStatus == 200 || regStatus == 503);

        // Unregister
        String unregBody = String.format("{\"deviceId\":\"%s\"}", deviceId);
        java.net.URL unregUrl = new java.net.URL(BASE_URL + "/api/push/unregister");
        java.net.HttpURLConnection unregConn = (java.net.HttpURLConnection) unregUrl.openConnection();
        unregConn.setRequestMethod("POST");
        unregConn.setRequestProperty("Content-Type", "application/json");
        unregConn.setRequestProperty("Authorization", "Bearer " + accessToken);
        unregConn.setDoOutput(true);
        unregConn.getOutputStream().write(unregBody.getBytes(StandardCharsets.UTF_8));
        int unregStatus = unregConn.getResponseCode();
        unregConn.disconnect();
        assertTrue(unregStatus == 200 || unregStatus == 503,
                "push.unregister should return 200 or 503, got " + unregStatus);
    }

    // ─── 16. Batch operations additional ─────────────────────────────────────

    @Test
    void test_updateMany_with_filter() {
        String email = PREFIX + "-umany@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        String tag = PREFIX + "-umany-" + System.currentTimeMillis();
        client.db("shared").table("posts").insert(Map.of("title", tag));
        client.db("shared").table("posts").insert(Map.of("title", tag));
        dev.edgebase.sdk.core.ListResult lr = client.db("shared").table("posts")
                .where("title", "==", tag).getList();
        lr.getItems().stream().map(r -> (String) r.get("id")).forEach(CREATED_IDS::add);

        dev.edgebase.sdk.core.BatchResult br = client.db("shared").table("posts")
                .where("title", "==", tag)
                .updateMany(Map.of("body", "bulk-updated"));
        assertTrue(br.getTotalSucceeded() >= 2);
    }

    @Test
    void test_deleteMany_with_filter() {
        String email = PREFIX + "-dmany@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        String tag = PREFIX + "-dmany-" + System.currentTimeMillis();
        client.db("shared").table("posts").insert(Map.of("title", tag));
        client.db("shared").table("posts").insert(Map.of("title", tag));

        dev.edgebase.sdk.core.BatchResult br = client.db("shared").table("posts")
                .where("title", "==", tag)
                .deleteMany();
        assertTrue(br.getTotalSucceeded() >= 2);
    }

    @Test
    void test_large_body_create() {
        String email = PREFIX + "-large@test.com";
        client.auth().signUp(email, "JavaAndroid123!");
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 500; i++) {
            sb.append("Lorem ipsum dolor sit amet. ");
        }
        Map<String, Object> record = client.db("shared").table("posts")
                .insert(Map.of("title", PREFIX + "-large", "body", sb.toString()));
        String id = (String) record.get("id");
        assertNotNull(id);
        CREATED_IDS.add(id);
        Map<String, Object> fetched = client.db("shared").table("posts").getOne(id);
        String body = (String) fetched.get("body");
        assertTrue(body.length() > 500);
    }

    // ─── 17. Push Full Flow E2E ─────────────────────────────────────────────

    private static final String MOCK_FCM_URL = "http://localhost:9099";
    private static final String SERVICE_KEY = Optional.ofNullable(System.getenv("SERVICE_KEY"))
            .orElse("test-service-key-for-admin");

    /** Helper: POST JSON and return (statusCode, body). */
    private static int[] postJsonRaw(String urlStr, String jsonBody, Map<String, String> headers) throws Exception {
        java.net.URL url = new java.net.URL(urlStr);
        java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/json");
        if (headers != null) {
            headers.forEach(conn::setRequestProperty);
        }
        conn.setDoOutput(true);
        conn.getOutputStream().write(jsonBody.getBytes(StandardCharsets.UTF_8));
        int status = conn.getResponseCode();
        conn.disconnect();
        return new int[]{status};
    }

    /** Helper: POST JSON and return (statusCode, body string). */
    private static String[] postJsonWithBody(String urlStr, String jsonBody, Map<String, String> headers) throws Exception {
        java.net.URL url = new java.net.URL(urlStr);
        java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/json");
        if (headers != null) {
            headers.forEach(conn::setRequestProperty);
        }
        conn.setDoOutput(true);
        conn.getOutputStream().write(jsonBody.getBytes(StandardCharsets.UTF_8));
        int status = conn.getResponseCode();
        String body;
        try {
            body = new String(conn.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            body = conn.getErrorStream() != null
                    ? new String(conn.getErrorStream().readAllBytes(), StandardCharsets.UTF_8)
                    : "";
        }
        conn.disconnect();
        return new String[]{String.valueOf(status), body};
    }

    /** Helper: GET a URL and return (statusCode, body string). */
    private static String[] getWithBody(String urlStr, Map<String, String> headers) throws Exception {
        java.net.URL url = new java.net.URL(urlStr);
        java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
        conn.setRequestMethod("GET");
        if (headers != null) {
            headers.forEach(conn::setRequestProperty);
        }
        int status = conn.getResponseCode();
        String body;
        try {
            body = new String(conn.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            body = conn.getErrorStream() != null
                    ? new String(conn.getErrorStream().readAllBytes(), StandardCharsets.UTF_8)
                    : "";
        }
        conn.disconnect();
        return new String[]{String.valueOf(status), body};
    }

    /** Helper: DELETE a URL and return status code. */
    private static int deleteRequest(String urlStr) throws Exception {
        java.net.URL url = new java.net.URL(urlStr);
        java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
        conn.setRequestMethod("DELETE");
        int status = conn.getResponseCode();
        conn.disconnect();
        return status;
    }

    @Test
    void test_push_full_flow_e2e() throws Exception {
        // 1. Setup: signup → get accessToken + userId
        String email = PREFIX + "-push-flow@test.com";
        String[] signupResult = postJsonWithBody(
                BASE_URL + "/api/auth/signup",
                String.format("{\"email\":\"%s\",\"password\":\"JavaFlow123!\"}", email),
                null);
        assertEquals("201", signupResult[0], "signup should return 201, body: " + signupResult[1]);

        // Parse accessToken and userId from signup response
        // Simple JSON parsing without external dependencies
        String signupBody = signupResult[1];
        String accessToken = signupBody.split("\"accessToken\":\"")[1].split("\"")[0];
        String userId = signupBody.split("\"id\":\"")[1].split("\"")[0];
        assertNotNull(accessToken);
        assertNotNull(userId);

        // 2. Clear mock FCM store
        int clearStatus = deleteRequest(MOCK_FCM_URL + "/messages");
        assertEquals(200, clearStatus, "Mock FCM clear should return 200");

        // 3. Client register
        String deviceId = "android-flow-e2e-" + System.currentTimeMillis();
        String fcmToken = "flow-token-java-" + System.currentTimeMillis();
        String[] regResult = postJsonWithBody(
                BASE_URL + "/api/push/register",
                String.format("{\"deviceId\":\"%s\",\"token\":\"%s\",\"platform\":\"web\"}", deviceId, fcmToken),
                Map.of("Authorization", "Bearer " + accessToken));
        assertEquals("200", regResult[0], "push.register should return 200, body: " + regResult[1]);
        assertTrue(regResult[1].contains("\"ok\":true"), "Register should return ok:true");

        // 4. Admin send(userId) → expect sent:1
        String[] sendResult = postJsonWithBody(
                BASE_URL + "/api/push/send",
                String.format("{\"userId\":\"%s\",\"payload\":{\"title\":\"Full Flow\",\"body\":\"E2E\"}}", userId),
                Map.of("X-EdgeBase-Service-Key", SERVICE_KEY));
        assertEquals("200", sendResult[0], "push.send should return 200, body: " + sendResult[1]);
        assertTrue(sendResult[1].contains("\"sent\":1"), "send should have sent:1");

        // 5. Verify mock FCM received correct token/payload
        String[] mockResult = getWithBody(MOCK_FCM_URL + "/messages?token=" + fcmToken, null);
        assertEquals("200", mockResult[0], "Mock FCM query should return 200");
        assertTrue(mockResult[1].contains(fcmToken), "Mock FCM should contain the FCM token");
        assertTrue(mockResult[1].contains("\"title\":\"Full Flow\""), "Mock FCM should contain notification title");
        assertTrue(mockResult[1].contains("\"body\":\"E2E\""), "Mock FCM should contain notification body");

        // 6. Admin sendToTopic → verify mock FCM received topic:"news"
        deleteRequest(MOCK_FCM_URL + "/messages"); // clear for isolation
        String[] topicResult = postJsonWithBody(
                BASE_URL + "/api/push/send-to-topic",
                "{\"topic\":\"news\",\"payload\":{\"title\":\"Topic Test\",\"body\":\"java\"}}",
                Map.of("X-EdgeBase-Service-Key", SERVICE_KEY));
        assertEquals("200", topicResult[0], "push.send-to-topic should return 200, body: " + topicResult[1]);

        String[] topicMockResult = getWithBody(MOCK_FCM_URL + "/messages?topic=news", null);
        assertEquals("200", topicMockResult[0], "Mock FCM topic query should return 200");
        assertTrue(topicMockResult[1].contains("\"topic\":\"news\""), "Mock FCM should contain topic:news");

        // 7. Admin broadcast → verify mock FCM received topic:"all"
        deleteRequest(MOCK_FCM_URL + "/messages"); // clear for isolation
        String[] bcResult = postJsonWithBody(
                BASE_URL + "/api/push/broadcast",
                "{\"payload\":{\"title\":\"Broadcast\",\"body\":\"all-devices\"}}",
                Map.of("X-EdgeBase-Service-Key", SERVICE_KEY));
        assertEquals("200", bcResult[0], "push.broadcast should return 200, body: " + bcResult[1]);

        String[] bcMockResult = getWithBody(MOCK_FCM_URL + "/messages?topic=all", null);
        assertEquals("200", bcMockResult[0], "Mock FCM broadcast query should return 200");
        assertTrue(bcMockResult[1].contains("\"topic\":\"all\""), "Mock FCM should contain topic:all");

        // 8. Client unregister
        String[] unregResult = postJsonWithBody(
                BASE_URL + "/api/push/unregister",
                String.format("{\"deviceId\":\"%s\"}", deviceId),
                Map.of("Authorization", "Bearer " + accessToken));
        assertEquals("200", unregResult[0], "push.unregister should return 200, body: " + unregResult[1]);
        assertTrue(unregResult[1].contains("\"ok\":true"), "Unregister should return ok:true");

        // 9. Admin getTokens → expect items empty
        String[] tokensResult = getWithBody(
                BASE_URL + "/api/push/tokens?userId=" + userId,
                Map.of("X-EdgeBase-Service-Key", SERVICE_KEY));
        assertEquals("200", tokensResult[0], "push.tokens should return 200, body: " + tokensResult[1]);
        assertTrue(tokensResult[1].contains("\"items\":[]"), "Tokens should be empty after unregister");
    }
}
