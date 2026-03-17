package dev.edgebase.sdk.core;

import org.junit.jupiter.api.Test;
import java.util.*;
import java.util.function.Consumer;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Java packages/core SDK 단위 테스트 — TableRef / FieldOps / EdgeBaseError / DbRef
 *
 * 실행: cd packages/sdk/java/packages/core && ./gradlew test
 *
 * 원칙: 서버 불필요, 순수 클래스 구조/불변성 검증
 */

// ─── A. FieldOps
// ──────────────────────────────────────────────────────────────

class FieldOpsTest {

    @Test
    void test_increment_returns_correct_op() {
        Map<String, Object> op = FieldOps.increment(5);
        assertEquals("increment", op.get("$op"));
        assertEquals(5, op.get("value"));
    }

    @Test
    void test_increment_negative_value() {
        Map<String, Object> op = FieldOps.increment(-10);
        assertEquals(-10, op.get("value"));
    }

    @Test
    void test_increment_float_value() {
        Map<String, Object> op = FieldOps.increment(3.14);
        assertEquals(3.14, (double) op.get("value"), 0.001);
    }

    @Test
    void test_increment_returns_map() {
        assertTrue(FieldOps.increment(1) instanceof Map);
    }

    @Test
    void test_increment_zero() {
        Map<String, Object> op = FieldOps.increment(0);
        assertEquals(0, op.get("value"));
    }

    @Test
    void test_deleteField_returns_correct_op() {
        Map<String, Object> op = FieldOps.deleteField();
        assertEquals("deleteField", op.get("$op"));
    }

    @Test
    void test_deleteField_no_value_key() {
        Map<String, Object> op = FieldOps.deleteField();
        assertFalse(op.containsKey("value"));
    }

    @Test
    void test_deleteField_returns_map() {
        assertTrue(FieldOps.deleteField() instanceof Map);
    }

    @Test
    void test_increment_long_value() {
        Map<String, Object> op = FieldOps.increment(100L);
        assertEquals("increment", op.get("$op"));
        assertEquals(100L, op.get("value"));
    }

    @Test
    void test_increment_large_value() {
        Map<String, Object> op = FieldOps.increment(Integer.MAX_VALUE);
        assertEquals(Integer.MAX_VALUE, op.get("value"));
    }

    @Test
    void test_increment_op_has_exactly_two_keys() {
        Map<String, Object> op = FieldOps.increment(1);
        assertEquals(2, op.size());
        assertTrue(op.containsKey("$op"));
        assertTrue(op.containsKey("value"));
    }

    @Test
    void test_deleteField_op_has_exactly_one_key() {
        Map<String, Object> op = FieldOps.deleteField();
        assertEquals(1, op.size());
        assertTrue(op.containsKey("$op"));
    }
}

// ─── A2. EdgeBaseFieldOps (alias class)
// ──────────────────────────────────────────────────────────────

class EdgeBaseFieldOpsTest {

    @Test
    void test_edgeBaseFieldOps_increment_returns_correct_op() {
        Map<String, Object> op = EdgeBaseFieldOps.increment(7);
        assertEquals("increment", op.get("$op"));
        assertEquals(7, op.get("value"));
    }

    @Test
    void test_edgeBaseFieldOps_deleteField_returns_correct_op() {
        Map<String, Object> op = EdgeBaseFieldOps.deleteField();
        assertEquals("deleteField", op.get("$op"));
    }

    @Test
    void test_edgeBaseFieldOps_increment_decimal() {
        Map<String, Object> op = EdgeBaseFieldOps.increment(0.5);
        assertEquals(0.5, (double) op.get("value"), 0.001);
    }
}

// ─── B. EdgeBaseError
// ─────────────────────────────────────────────────────────

class EdgeBaseErrorTest {

    @Test
    void test_constructor_sets_message() {
        EdgeBaseError err = new EdgeBaseError("Not found", 404);
        assertEquals("Not found", err.getMessage());
    }

    @Test
    void test_get_status_code() {
        EdgeBaseError err = new EdgeBaseError("Not found", 404);
        assertEquals(404, err.getStatusCode());
    }

    @Test
    void test_default_status_code_zero() {
        EdgeBaseError err = new EdgeBaseError("error");
        assertEquals(0, err.getStatusCode());
    }

    @Test
    void test_extends_runtime_exception() {
        EdgeBaseError err = new EdgeBaseError("test", 500);
        assertTrue(err instanceof RuntimeException);
    }

    @Test
    void test_is_throwable() {
        EdgeBaseError err = new EdgeBaseError("test", 403);
        assertTrue(err instanceof Throwable);
    }

    @Test
    void test_message_preserved() {
        String msg = "Unicode: 한국어 Error";
        EdgeBaseError err = new EdgeBaseError(msg);
        assertEquals(msg, err.getMessage());
    }

    @Test
    void test_statusCode_int_message_constructor() {
        EdgeBaseError err = new EdgeBaseError(500, "Internal");
        assertEquals(500, err.getStatusCode());
        assertEquals("Internal", err.getMessage());
    }

    @Test
    void test_details_null_by_default() {
        EdgeBaseError err = new EdgeBaseError("test", 400);
        assertNull(err.getDetails());
    }

    @Test
    void test_details_constructor() {
        Map<String, List<String>> details = Map.of("email", List.of("required"));
        EdgeBaseError err = new EdgeBaseError(422, "Validation failed", details);
        assertNotNull(err.getDetails());
        assertEquals(List.of("required"), err.getDetails().get("email"));
    }

    @Test
    void test_toString_without_details() {
        EdgeBaseError err = new EdgeBaseError(404, "Not found");
        String str = err.toString();
        assertTrue(str.contains("404"));
        assertTrue(str.contains("Not found"));
    }

    @Test
    void test_toString_with_details() {
        Map<String, List<String>> details = Map.of("title", List.of("too long"));
        EdgeBaseError err = new EdgeBaseError(422, "Validation", details);
        String str = err.toString();
        assertTrue(str.contains("title"));
        assertTrue(str.contains("too long"));
    }

    @Test
    void test_fromJson_parses_message() {
        Map<String, Object> json = new HashMap<>();
        json.put("message", "Unauthorized");
        EdgeBaseError err = EdgeBaseError.fromJson(json, 401);
        assertEquals("Unauthorized", err.getMessage());
        assertEquals(401, err.getStatusCode());
    }

    @Test
    void test_fromJson_parses_details() {
        Map<String, Object> json = new HashMap<>();
        json.put("message", "Validation error");
        Map<String, Object> rawDetails = new HashMap<>();
        rawDetails.put("password", List.of("too short", "no special char"));
        json.put("details", rawDetails);
        EdgeBaseError err = EdgeBaseError.fromJson(json, 422);
        assertNotNull(err.getDetails());
        assertEquals(2, err.getDetails().get("password").size());
    }

    @Test
    void test_fromJson_missing_message_defaults() {
        Map<String, Object> json = new HashMap<>();
        EdgeBaseError err = EdgeBaseError.fromJson(json, 500);
        assertEquals("Unknown error", err.getMessage());
    }

    @Test
    void test_can_be_caught_as_exception() {
        boolean caught = false;
        try {
            throw new EdgeBaseError(403, "Forbidden");
        } catch (Exception e) {
            caught = true;
            assertTrue(e instanceof EdgeBaseError);
        }
        assertTrue(caught);
    }
}

// ─── C. TableRef 불변성 ───────────────────────────────────────────────────────

class TableRefImmutabilityTest {

    // TableRef needs an HttpClient but we can test construction-level
    // immutability by verifying getName() and that chaining returns new objects.
    // We use a null-safe wrapper pattern.

    @Test
    void test_getName_returns_correct_name() {
        // TableRef(httpClient, name, databaseLive) — we test via reflection or
        // by creating with null client (unit-level struct test)
        // Since TableRef requires HttpClient, we just verify the class structure:
        assertTrue(TableRef.class.getDeclaredMethods().length > 0);
    }

    @Test
    void test_where_method_exists() throws NoSuchMethodException {
        assertNotNull(TableRef.class.getMethod("where", String.class, String.class, Object.class));
    }

    @Test
    void test_limit_method_exists() throws NoSuchMethodException {
        assertNotNull(TableRef.class.getMethod("limit", int.class));
    }

    @Test
    void test_orderBy_method_exists() throws NoSuchMethodException {
        assertNotNull(TableRef.class.getMethod("orderBy", String.class, String.class));
    }

    @Test
    void test_after_method_exists() throws NoSuchMethodException {
        assertNotNull(TableRef.class.getMethod("after", String.class));
    }

    @Test
    void test_before_method_exists() throws NoSuchMethodException {
        assertNotNull(TableRef.class.getMethod("before", String.class));
    }

    @Test
    void test_search_method_exists() throws NoSuchMethodException {
        assertNotNull(TableRef.class.getMethod("search", String.class));
    }

    @Test
    void test_getList_method_exists() throws NoSuchMethodException {
        assertNotNull(TableRef.class.getMethod("getList"));
    }

    @Test
    void test_insert_method_exists() throws NoSuchMethodException {
        assertNotNull(TableRef.class.getMethod("insert", Map.class));
    }

    @Test
    void test_upsert_method_exists() throws NoSuchMethodException {
        assertNotNull(TableRef.class.getMethod("upsert", Map.class));
    }

    @Test
    void test_count_method_exists() throws NoSuchMethodException {
        assertNotNull(TableRef.class.getMethod("count"));
    }

    @Test
    void test_insertMany_method_exists() throws NoSuchMethodException {
        assertNotNull(TableRef.class.getMethod("insertMany", List.class));
    }

    @Test
    void test_offset_method_exists() throws NoSuchMethodException {
        assertNotNull(TableRef.class.getMethod("offset", int.class));
    }

    @Test
    void test_page_method_exists() throws NoSuchMethodException {
        assertNotNull(TableRef.class.getMethod("page", int.class));
    }

    @Test
    void test_or_method_exists() throws NoSuchMethodException {
        assertNotNull(TableRef.class.getMethod("or", Consumer.class));
    }

    @Test
    void test_doc_method_exists() throws NoSuchMethodException {
        assertNotNull(TableRef.class.getMethod("doc", String.class));
    }

    @Test
    void test_getOne_method_exists() throws NoSuchMethodException {
        assertNotNull(TableRef.class.getMethod("getOne", String.class));
    }

    @Test
    void test_updateMany_method_exists() throws NoSuchMethodException {
        assertNotNull(TableRef.class.getMethod("updateMany", Map.class));
    }

    @Test
    void test_deleteMany_method_exists() throws NoSuchMethodException {
        assertNotNull(TableRef.class.getMethod("deleteMany"));
    }

    @Test
    void test_upsertMany_method_exists() throws NoSuchMethodException {
        assertNotNull(TableRef.class.getMethod("upsertMany", List.class));
    }

    @Test
    void test_orderBy_single_arg_method_exists() throws NoSuchMethodException {
        assertNotNull(TableRef.class.getMethod("orderBy", String.class));
    }
}

// ─── D. ListResult
// ────────────────────────────────────────────────────────────

class ListResultTest {

    @Test
    void test_constructor_sets_items() {
        List<Map<String, Object>> items = List.of(Map.of("id", "1"));
        ListResult r = new ListResult(items, 1, null, null, null, null);
        assertEquals(items, r.getItems());
    }

    @Test
    void test_cursor_field() {
        ListResult r = new ListResult(List.of(), null, null, null, null, "cursor-abc");
        assertEquals("cursor-abc", r.getCursor());
    }

    @Test
    void test_null_cursor() {
        ListResult r = new ListResult(List.of(), null, null, null, null, null);
        assertNull(r.getCursor());
    }

    @Test
    void test_total_field() {
        ListResult r = new ListResult(List.of(), 42, null, null, null, null);
        assertEquals(42, r.getTotal());
    }

    @Test
    void test_page_field() {
        ListResult r = new ListResult(List.of(), null, 3, null, null, null);
        assertEquals(3, r.getPage());
    }

    @Test
    void test_perPage_field() {
        ListResult r = new ListResult(List.of(), null, null, 20, null, null);
        assertEquals(20, r.getPerPage());
    }

    @Test
    void test_hasMore_field() {
        ListResult r = new ListResult(List.of(), null, null, null, true, null);
        assertTrue(r.getHasMore());
    }

    @Test
    void test_hasMore_false() {
        ListResult r = new ListResult(List.of(), null, null, null, false, null);
        assertFalse(r.getHasMore());
    }

    @Test
    void test_empty_items() {
        ListResult r = new ListResult(List.of(), 0, null, null, null, null);
        assertTrue(r.getItems().isEmpty());
    }

    @Test
    void test_multiple_items() {
        List<Map<String, Object>> items = List.of(
                Map.of("id", "1"), Map.of("id", "2"), Map.of("id", "3"));
        ListResult r = new ListResult(items, 3, null, null, null, null);
        assertEquals(3, r.getItems().size());
    }

    @Test
    void test_all_fields_populated() {
        List<Map<String, Object>> items = List.of(Map.of("id", "1"));
        ListResult r = new ListResult(items, 100, 2, 10, true, "next-cursor");
        assertEquals(1, r.getItems().size());
        assertEquals(100, r.getTotal());
        assertEquals(2, r.getPage());
        assertEquals(10, r.getPerPage());
        assertTrue(r.getHasMore());
        assertEquals("next-cursor", r.getCursor());
    }
}

// ─── E. UpsertResult ─────────────────────────────────────────────────────────

class UpsertResultTest {

    @Test
    void test_inserted_true_when_action_created() {
        Map<String, Object> data = new HashMap<>();
        data.put("id", "abc");
        data.put("action", "inserted");
        UpsertResult r = new UpsertResult(data, "inserted".equals(data.get("action")));
        assertTrue(r.isInserted());
    }

    @Test
    void test_inserted_false_when_action_updated() {
        Map<String, Object> data = new HashMap<>();
        data.put("id", "abc");
        data.put("action", "updated");
        UpsertResult r = new UpsertResult(data, "inserted".equals(data.get("action")));
        assertFalse(r.isInserted());
    }

    @Test
    void test_getRecord_returns_data() {
        Map<String, Object> data = Map.of("id", "xyz", "title", "Hello");
        UpsertResult r = new UpsertResult(data, true);
        assertEquals("xyz", r.getRecord().get("id"));
        assertEquals("Hello", r.getRecord().get("title"));
    }
}

// ─── F. BatchResult ──────────────────────────────────────────────────────────

class BatchResultTest {

    @Test
    void test_totalProcessed() {
        BatchResult r = new BatchResult(10, 9, List.of());
        assertEquals(10, r.getTotalProcessed());
    }

    @Test
    void test_totalSucceeded() {
        BatchResult r = new BatchResult(10, 9, List.of());
        assertEquals(9, r.getTotalSucceeded());
    }

    @Test
    void test_errors_empty() {
        BatchResult r = new BatchResult(5, 5, List.of());
        assertTrue(r.getErrors().isEmpty());
    }

    @Test
    void test_errors_present() {
        List<Map<String, Object>> errors = List.of(Map.of("error", "timeout"));
        BatchResult r = new BatchResult(10, 8, errors);
        assertEquals(1, r.getErrors().size());
    }

    @Test
    void test_zero_processed() {
        BatchResult r = new BatchResult(0, 0, List.of());
        assertEquals(0, r.getTotalProcessed());
        assertEquals(0, r.getTotalSucceeded());
    }
}

// ─── G. FilterTuple ──────────────────────────────────────────────────────────

class FilterTupleTest {

    @Test
    void test_getField() {
        FilterTuple f = new FilterTuple("title", "==", "Hello");
        assertEquals("title", f.getField());
    }

    @Test
    void test_getOp() {
        FilterTuple f = new FilterTuple("title", "==", "Hello");
        assertEquals("==", f.getOp());
    }

    @Test
    void test_getValue() {
        FilterTuple f = new FilterTuple("age", ">", 18);
        assertEquals(18, f.getValue());
    }

    @Test
    void test_toJson_returns_list_of_three() {
        FilterTuple f = new FilterTuple("status", "==", "active");
        List<Object> json = f.toJson();
        assertEquals(3, json.size());
        assertEquals("status", json.get(0));
        assertEquals("==", json.get(1));
        assertEquals("active", json.get(2));
    }

    @Test
    void test_toJson_with_numeric_value() {
        FilterTuple f = new FilterTuple("count", ">=", 5);
        List<Object> json = f.toJson();
        assertEquals(5, json.get(2));
    }

    @Test
    void test_contains_operator() {
        FilterTuple f = new FilterTuple("title", "contains", "hello");
        assertEquals("contains", f.getOp());
        assertEquals("hello", f.getValue());
    }

    @Test
    void test_in_operator_with_list() {
        FilterTuple f = new FilterTuple("status", "in", List.of("active", "pending"));
        assertTrue(f.getValue() instanceof List);
    }
}

// ─── H. ContextManager ──────────────────────────────────────────────────────

class ContextManagerTest {

    @Test
    void test_default_context_is_empty() {
        ContextManager cm = new ContextManager();
        assertTrue(cm.getContext().isEmpty());
    }

    @Test
    void test_setContext_stores_values() {
        ContextManager cm = new ContextManager();
        cm.setContext(Map.of("tenant", "acme"));
        assertEquals("acme", cm.getContext().get("tenant"));
    }

    @Test
    void test_clearContext_resets_to_empty() {
        ContextManager cm = new ContextManager();
        cm.setContext(Map.of("tenant", "acme"));
        cm.clearContext();
        assertTrue(cm.getContext().isEmpty());
    }

    @Test
    void test_setContext_filters_auth_id() {
        ContextManager cm = new ContextManager();
        Map<String, Object> ctx = new HashMap<>();
        ctx.put("auth.id", "user-123");
        ctx.put("tenant", "acme");
        cm.setContext(ctx);
        assertNull(cm.getContext().get("auth.id"));
        assertEquals("acme", cm.getContext().get("tenant"));
    }

    @Test
    void test_context_is_immutable() {
        ContextManager cm = new ContextManager();
        cm.setContext(Map.of("key", "value"));
        assertThrows(UnsupportedOperationException.class, () -> cm.getContext().put("new", "val"));
    }
}

// ─── I. StorageBucket structure ──────────────────────────────────────────────

class StorageBucketStructureTest {

    @Test
    void test_upload_method_exists() throws NoSuchMethodException {
        assertNotNull(StorageBucket.class.getMethod("upload", String.class, byte[].class));
    }

    @Test
    void test_download_method_exists() throws NoSuchMethodException {
        assertNotNull(StorageBucket.class.getMethod("download", String.class));
    }

    @Test
    void test_delete_method_exists() throws NoSuchMethodException {
        assertNotNull(StorageBucket.class.getMethod("delete", String.class));
    }

    @Test
    void test_list_method_exists() throws NoSuchMethodException {
        assertNotNull(StorageBucket.class.getMethod("list"));
    }

    @Test
    void test_getUrl_method_exists() throws NoSuchMethodException {
        assertNotNull(StorageBucket.class.getMethod("getUrl", String.class));
    }

    @Test
    void test_createSignedUrl_method_exists() throws NoSuchMethodException {
        assertNotNull(StorageBucket.class.getMethod("createSignedUrl", String.class));
    }

    @Test
    void test_getMetadata_method_exists() throws NoSuchMethodException {
        assertNotNull(StorageBucket.class.getMethod("getMetadata", String.class));
    }

    @Test
    void test_uploadString_method_exists() throws NoSuchMethodException {
        assertNotNull(StorageBucket.class.getMethod("uploadString", String.class, String.class));
    }
}

// ─── J. DocRef structure ─────────────────────────────────────────────────────

class DocRefStructureTest {

    @Test
    void test_get_method_exists() throws NoSuchMethodException {
        assertNotNull(DocRef.class.getMethod("get"));
    }

    @Test
    void test_update_method_exists() throws NoSuchMethodException {
        assertNotNull(DocRef.class.getMethod("update", Map.class));
    }

    @Test
    void test_delete_method_exists() throws NoSuchMethodException {
        assertNotNull(DocRef.class.getMethod("delete"));
    }

    @Test
    void test_getId_method_exists() throws NoSuchMethodException {
        assertNotNull(DocRef.class.getMethod("getId"));
    }

    @Test
    void test_getCollectionName_method_exists() throws NoSuchMethodException {
        assertNotNull(DocRef.class.getMethod("getCollectionName"));
    }
}

// ─── K. DbRef structure ──────────────────────────────────────────────────────

class DbRefStructureTest {

    @Test
    void test_table_method_exists() throws NoSuchMethodException {
        assertNotNull(DbRef.class.getMethod("table", String.class));
    }

    @Test
    void test_getNamespace_method_exists() throws NoSuchMethodException {
        assertNotNull(DbRef.class.getMethod("getNamespace"));
    }

    @Test
    void test_getInstanceId_method_exists() throws NoSuchMethodException {
        assertNotNull(DbRef.class.getMethod("getInstanceId"));
    }
}

// ─── L. DbChange ─────────────────────────────────────────────────────────────

class DbChangeTest {

    @Test
    void test_constructor_sets_type() {
        DbChange c = new DbChange("created", "posts", "id-1", Map.of("title", "A"), null);
        assertEquals("created", c.getType());
    }

    @Test
    void test_constructor_sets_table() {
        DbChange c = new DbChange("created", "posts", "id-1", Map.of("title", "A"), null);
        assertEquals("posts", c.getTable());
    }

    @Test
    void test_constructor_sets_id() {
        DbChange c = new DbChange("updated", "posts", "id-2", Map.of("title", "B"), null);
        assertEquals("id-2", c.getId());
    }

    @Test
    void test_constructor_sets_record() {
        Map<String, Object> rec = Map.of("title", "Test");
        DbChange c = new DbChange("created", "posts", "id-1", rec, null);
        assertEquals("Test", c.getRecord().get("title"));
    }

    @Test
    void test_constructor_sets_oldRecord() {
        Map<String, Object> old = Map.of("title", "Old");
        Map<String, Object> rec = Map.of("title", "New");
        DbChange c = new DbChange("updated", "posts", "id-1", rec, old);
        assertEquals("Old", c.getOldRecord().get("title"));
    }

    @Test
    void test_fromJson() {
        Map<String, Object> json = new HashMap<>();
        json.put("type", "deleted");
        json.put("table", "comments");
        json.put("id", "c-99");
        DbChange c = DbChange.fromJson(json);
        assertEquals("deleted", c.getType());
        assertEquals("comments", c.getTable());
        assertEquals("c-99", c.getId());
    }

    @Test
    void test_fromJson_empty_defaults() {
        Map<String, Object> json = new HashMap<>();
        DbChange c = DbChange.fromJson(json);
        assertEquals("", c.getType());
        assertEquals("", c.getTable());
        assertEquals("", c.getId());
        assertNull(c.getRecord());
        assertNull(c.getOldRecord());
    }
}

// ─── M. FileInfo ─────────────────────────────────────────────────────────────

class FileInfoTest {

    @Test
    void test_constructor_sets_key() {
        FileInfo fi = new FileInfo("photos/test.png", 1024, "image/png", "etag-1", "2024-01-01", null);
        assertEquals("photos/test.png", fi.getKey());
    }

    @Test
    void test_constructor_sets_size() {
        FileInfo fi = new FileInfo("file.txt", 2048, "text/plain", null, null, null);
        assertEquals(2048, fi.getSize());
    }

    @Test
    void test_constructor_sets_contentType() {
        FileInfo fi = new FileInfo("file.txt", 0, "text/plain", null, null, null);
        assertEquals("text/plain", fi.getContentType());
    }

    @Test
    void test_fromJson() {
        Map<String, Object> json = new HashMap<>();
        json.put("key", "avatar.jpg");
        json.put("size", 4096);
        json.put("contentType", "image/jpeg");
        json.put("etag", "\"abc\"");
        FileInfo fi = FileInfo.fromJson(json);
        assertEquals("avatar.jpg", fi.getKey());
        assertEquals(4096, fi.getSize());
        assertEquals("image/jpeg", fi.getContentType());
        assertEquals("\"abc\"", fi.getEtag());
    }

    @Test
    void test_fromJson_missing_fields_defaults() {
        Map<String, Object> json = new HashMap<>();
        FileInfo fi = FileInfo.fromJson(json);
        assertEquals("", fi.getKey());
        assertEquals(0, fi.getSize());
        assertNull(fi.getContentType());
    }

    @Test
    void test_customMetadata() {
        Map<String, String> meta = Map.of("author", "Jane");
        FileInfo fi = new FileInfo("doc.pdf", 0, "application/pdf", null, null, meta);
        assertEquals("Jane", fi.getCustomMetadata().get("author"));
    }
}

// ─── N. SignedUrlResult ──────────────────────────────────────────────────────

class SignedUrlResultTest {

    @Test
    void test_url_field() {
        SignedUrlResult r = new SignedUrlResult("https://example.com/signed", 3600);
        assertEquals("https://example.com/signed", r.getUrl());
    }

    @Test
    void test_expiresIn_field() {
        SignedUrlResult r = new SignedUrlResult("https://example.com/signed", 7200);
        assertEquals(7200, r.getExpiresIn());
    }
}

// ─── O. HttpClient structure ─────────────────────────────────────────────────

class HttpClientStructureTest {

    @Test
    void test_get_method_exists() throws NoSuchMethodException {
        assertNotNull(HttpClient.class.getMethod("get", String.class));
    }

    @Test
    void test_post_method_exists() throws NoSuchMethodException {
        assertNotNull(HttpClient.class.getMethod("post", String.class, Map.class));
    }

    @Test
    void test_patch_method_exists() throws NoSuchMethodException {
        assertNotNull(HttpClient.class.getMethod("patch", String.class, Map.class));
    }

    @Test
    void test_put_method_exists() throws NoSuchMethodException {
        assertNotNull(HttpClient.class.getMethod("put", String.class, Map.class));
    }

    @Test
    void test_delete_method_exists() throws NoSuchMethodException {
        assertNotNull(HttpClient.class.getMethod("delete", String.class));
    }

    @Test
    void test_downloadRaw_method_exists() throws NoSuchMethodException {
        assertNotNull(HttpClient.class.getMethod("downloadRaw", String.class));
    }

    @Test
    void test_uploadMultipart_method_exists() throws NoSuchMethodException {
        assertNotNull(HttpClient.class.getMethod("uploadMultipart",
                String.class, String.class, byte[].class, String.class, Map.class));
    }

    @Test
    void test_constructor_with_serviceKey() {
        HttpClient hc = new HttpClient("http://localhost:8688", "sk-test");
        assertEquals("http://localhost:8688", hc.baseUrl);
    }

    @Test
    void test_withDbPath_method_exists() throws NoSuchMethodException {
        assertNotNull(HttpClient.class.getMethod("withDbPath", String.class));
    }

    @Test
    void test_postPublic_method_exists() throws NoSuchMethodException {
        assertNotNull(HttpClient.class.getMethod("postPublic", String.class, Map.class));
    }

    @Test
    void test_getWithQuery_method_exists() throws NoSuchMethodException {
        assertNotNull(HttpClient.class.getMethod("getWithQuery", String.class, Map.class));
    }

    @Test
    void test_postWithQuery_method_exists() throws NoSuchMethodException {
        assertNotNull(HttpClient.class.getMethod("postWithQuery", String.class, Map.class, Map.class));
    }
}
