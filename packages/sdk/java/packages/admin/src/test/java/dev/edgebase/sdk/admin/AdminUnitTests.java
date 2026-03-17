package dev.edgebase.sdk.admin;

import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Java packages/admin SDK 단위 테스트 — AdminEdgeBase / AdminAuthClient / KvClient / D1Client / etc 구조 검증
 *
 * 실행: cd packages/sdk/java/packages/admin && ./gradlew test
 *
 * 원칙: 서버 불필요, 순수 클래스 구조 검증
 */

// ─── A. AdminEdgeBase 메서드 구조 ─────────────────────────────────────────────

class AdminEdgeBaseStructureTest {

    @Test
    void test_adminAuth_method_exists() throws NoSuchMethodException {
        assertNotNull(AdminEdgeBase.class.getMethod("adminAuth"));
    }

    @Test
    void test_storage_method_exists() throws NoSuchMethodException {
        assertNotNull(AdminEdgeBase.class.getMethod("storage"));
    }

    @Test
    void test_functions_method_exists() throws NoSuchMethodException {
        assertNotNull(AdminEdgeBase.class.getMethod("functions"));
    }

    @Test
    void test_analytics_method_exists() throws NoSuchMethodException {
        assertNotNull(AdminEdgeBase.class.getMethod("analytics"));
    }

    @Test
    void test_table_method_exists() throws NoSuchMethodException {
        assertNotNull(AdminEdgeBase.class.getMethod("table", String.class));
    }

    @Test
    void test_db_method_exists() throws NoSuchMethodException {
        assertNotNull(AdminEdgeBase.class.getMethod("db", String.class));
    }

    @Test
    void test_sql_method_exists() throws NoSuchMethodException {
        assertNotNull(AdminEdgeBase.class.getMethod("sql", String.class, String.class, List.class));
    }

    @Test
    void test_broadcast_method_exists() throws NoSuchMethodException {
        assertNotNull(AdminEdgeBase.class.getMethod("broadcast", String.class, String.class, Map.class));
    }

    @Test
    void test_kv_method_exists() throws NoSuchMethodException {
        assertNotNull(AdminEdgeBase.class.getMethod("kv", String.class));
    }

    @Test
    void test_d1_method_exists() throws NoSuchMethodException {
        assertNotNull(AdminEdgeBase.class.getMethod("d1", String.class));
    }

    @Test
    void test_vector_method_exists() throws NoSuchMethodException {
        assertNotNull(AdminEdgeBase.class.getMethod("vector", String.class));
    }

    @Test
    void test_push_method_exists() throws NoSuchMethodException {
        assertNotNull(AdminEdgeBase.class.getMethod("push"));
    }

    @Test
    void test_destroy_method_exists() throws NoSuchMethodException {
        assertNotNull(AdminEdgeBase.class.getMethod("destroy"));
    }

    @Test
    void test_setContext_method_exists() throws NoSuchMethodException {
        assertNotNull(AdminEdgeBase.class.getMethod("setContext", Map.class));
    }

    @Test
    void test_getContext_method_exists() throws NoSuchMethodException {
        assertNotNull(AdminEdgeBase.class.getMethod("getContext"));
    }

    @Test
    void test_sql_overload_without_params_exists() throws NoSuchMethodException {
        assertNotNull(AdminEdgeBase.class.getMethod("sql", String.class, String.class));
    }

    @Test
    void test_broadcast_overload_without_payload_exists() throws NoSuchMethodException {
        assertNotNull(AdminEdgeBase.class.getMethod("broadcast", String.class, String.class));
    }

    @Test
    void test_db_with_instanceId_method_exists() throws NoSuchMethodException {
        assertNotNull(AdminEdgeBase.class.getMethod("db", String.class, String.class));
    }

    @Test
    void test_db_returns_DbRef() {
        AdminEdgeBase admin = new AdminEdgeBase("http://localhost:8688", "test-sk", null);
        assertNotNull(admin.db("shared"));
        assertNotNull(admin.db("shared").table("posts"));
    }

    @Test
    void test_functions_returns_non_null() {
        AdminEdgeBase admin = new AdminEdgeBase("http://localhost:8688", "test-sk", null);
        assertNotNull(admin.functions());
    }

    @Test
    void test_analytics_returns_non_null() {
        AdminEdgeBase admin = new AdminEdgeBase("http://localhost:8688", "test-sk", null);
        assertNotNull(admin.analytics());
    }

}

// ─── B. AdminAuthClient 구조 ──────────────────────────────────────────────────

class AdminAuthClientStructureTest {

    @Test
    void test_getUser_method_exists() throws NoSuchMethodException {
        assertNotNull(AdminAuthClient.class.getMethod("getUser", String.class));
    }

    @Test
    void test_listUsers_method_exists() {
        boolean exists = Arrays.stream(AdminAuthClient.class.getMethods())
                .anyMatch(m -> m.getName().equals("listUsers"));
        assertTrue(exists);
    }

    @Test
    void test_createUser_method_exists() throws NoSuchMethodException {
        assertNotNull(AdminAuthClient.class.getMethod("createUser", Map.class));
    }

    @Test
    void test_updateUser_method_exists() throws NoSuchMethodException {
        assertNotNull(AdminAuthClient.class.getMethod("updateUser", String.class, Map.class));
    }

    @Test
    void test_deleteUser_method_exists() throws NoSuchMethodException {
        assertNotNull(AdminAuthClient.class.getMethod("deleteUser", String.class));
    }

    @Test
    void test_setCustomClaims_method_exists() throws NoSuchMethodException {
        assertNotNull(AdminAuthClient.class.getMethod("setCustomClaims", String.class, Map.class));
    }

    @Test
    void test_revokeAllSessions_method_exists() throws NoSuchMethodException {
        assertNotNull(AdminAuthClient.class.getMethod("revokeAllSessions", String.class));
    }

    @Test
    void test_listUsers_with_params_exists() throws NoSuchMethodException {
        assertNotNull(AdminAuthClient.class.getMethod("listUsers", Integer.class, String.class));
    }

    @Test
    void test_listUsers_no_args_exists() throws NoSuchMethodException {
        assertNotNull(AdminAuthClient.class.getMethod("listUsers"));
    }

    @Test
    void test_getUser_return_type_is_map() throws NoSuchMethodException {
        assertEquals(Map.class, AdminAuthClient.class.getMethod("getUser", String.class).getReturnType());
    }

    @Test
    void test_createUser_return_type_is_map() throws NoSuchMethodException {
        assertEquals(Map.class, AdminAuthClient.class.getMethod("createUser", Map.class).getReturnType());
    }

    @Test
    void test_deleteUser_return_type_is_void() throws NoSuchMethodException {
        assertEquals(void.class, AdminAuthClient.class.getMethod("deleteUser", String.class).getReturnType());
    }
}

// ─── C. KvClient 구조 ────────────────────────────────────────────────────────

class KvClientStructureTest {

    @Test
    void test_get_method_exists() throws NoSuchMethodException {
        assertNotNull(KvClient.class.getMethod("get", String.class));
    }

    @Test
    void test_set_method_exists() throws NoSuchMethodException {
        assertNotNull(KvClient.class.getMethod("set", String.class, String.class));
    }

    @Test
    void test_set_with_ttl_method_exists() throws NoSuchMethodException {
        assertNotNull(KvClient.class.getMethod("set", String.class, String.class, int.class));
    }

    @Test
    void test_delete_method_exists() throws NoSuchMethodException {
        assertNotNull(KvClient.class.getMethod("delete", String.class));
    }

    @Test
    void test_list_method_exists() throws NoSuchMethodException {
        assertNotNull(KvClient.class.getMethod("list"));
    }

    @Test
    void test_list_with_params_method_exists() throws NoSuchMethodException {
        assertNotNull(KvClient.class.getMethod("list", String.class, int.class, String.class));
    }

    @Test
    void test_get_returns_string() throws NoSuchMethodException {
        assertEquals(String.class, KvClient.class.getMethod("get", String.class).getReturnType());
    }

    @Test
    void test_set_returns_void() throws NoSuchMethodException {
        assertEquals(void.class, KvClient.class.getMethod("set", String.class, String.class).getReturnType());
    }
}

// ─── D. D1Client 구조 ────────────────────────────────────────────────────────

class D1ClientStructureTest {

    @Test
    void test_exec_method_exists() throws NoSuchMethodException {
        assertNotNull(D1Client.class.getMethod("exec", String.class));
    }

    @Test
    void test_exec_with_params_method_exists() throws NoSuchMethodException {
        assertNotNull(D1Client.class.getMethod("exec", String.class, List.class));
    }

    @Test
    void test_exec_returns_list() throws NoSuchMethodException {
        assertEquals(List.class, D1Client.class.getMethod("exec", String.class).getReturnType());
    }
}

// ─── E. VectorizeClient 구조 ─────────────────────────────────────────────────

class VectorizeClientStructureTest {

    @Test
    void test_upsert_method_exists() throws NoSuchMethodException {
        assertNotNull(VectorizeClient.class.getMethod("upsert", List.class));
    }

    @Test
    void test_search_with_all_params_exists() throws NoSuchMethodException {
        assertNotNull(VectorizeClient.class.getMethod("search", List.class, int.class, Map.class));
    }

    @Test
    void test_search_simple_exists() throws NoSuchMethodException {
        assertNotNull(VectorizeClient.class.getMethod("search", List.class));
    }

    @Test
    void test_delete_method_exists() throws NoSuchMethodException {
        assertNotNull(VectorizeClient.class.getMethod("delete", List.class));
    }

    @Test
    void test_upsert_returns_map() throws NoSuchMethodException {
        assertEquals(Map.class, VectorizeClient.class.getMethod("upsert", List.class).getReturnType());
    }

    @Test
    void test_search_returns_list() throws NoSuchMethodException {
        assertEquals(List.class,
                VectorizeClient.class.getMethod("search", List.class, int.class, Map.class).getReturnType());
    }

    @Test
    void test_insert_method_exists() throws NoSuchMethodException {
        assertNotNull(VectorizeClient.class.getMethod("insert", List.class));
    }

    @Test
    void test_queryById_method_exists() throws NoSuchMethodException {
        assertNotNull(VectorizeClient.class.getMethod("queryById", String.class, int.class, Map.class));
    }

    @Test
    void test_getByIds_method_exists() throws NoSuchMethodException {
        assertNotNull(VectorizeClient.class.getMethod("getByIds", List.class));
    }

    @Test
    void test_describe_method_exists() throws NoSuchMethodException {
        assertNotNull(VectorizeClient.class.getMethod("describe"));
    }

    @Test
    void test_insert_returns_map() throws NoSuchMethodException {
        assertEquals(Map.class, VectorizeClient.class.getMethod("insert", List.class).getReturnType());
    }

    @Test
    void test_getByIds_returns_list() throws NoSuchMethodException {
        assertEquals(List.class, VectorizeClient.class.getMethod("getByIds", List.class).getReturnType());
    }

    @Test
    void test_describe_returns_map() throws NoSuchMethodException {
        assertEquals(Map.class, VectorizeClient.class.getMethod("describe").getReturnType());
    }

    @Test
    void test_search_full_options_method_exists() throws NoSuchMethodException {
        assertNotNull(VectorizeClient.class.getMethod("search",
                List.class, int.class, Map.class, String.class, Boolean.class, String.class));
    }
}

// ─── F. PushClient 구조 ──────────────────────────────────────────────────────

class PushClientStructureTest {

    @Test
    void test_send_method_exists() throws NoSuchMethodException {
        assertNotNull(PushClient.class.getMethod("send", String.class, Map.class));
    }

    @Test
    void test_sendMany_method_exists() throws NoSuchMethodException {
        assertNotNull(PushClient.class.getMethod("sendMany", List.class, Map.class));
    }

    @Test
    void test_sendToToken_method_exists() throws NoSuchMethodException {
        assertNotNull(PushClient.class.getMethod("sendToToken", String.class, Map.class, String.class));
    }

    @Test
    void test_getTokens_method_exists() throws NoSuchMethodException {
        assertNotNull(PushClient.class.getMethod("getTokens", String.class));
    }

    @Test
    void test_getLogs_method_exists() throws NoSuchMethodException {
        assertNotNull(PushClient.class.getMethod("getLogs", String.class));
    }

    @Test
    void test_getLogs_with_limit_method_exists() throws NoSuchMethodException {
        assertNotNull(PushClient.class.getMethod("getLogs", String.class, int.class));
    }

    @Test
    void test_send_returns_map() throws NoSuchMethodException {
        assertEquals(Map.class, PushClient.class.getMethod("send", String.class, Map.class).getReturnType());
    }

    @Test
    void test_getTokens_returns_list() throws NoSuchMethodException {
        assertEquals(List.class, PushClient.class.getMethod("getTokens", String.class).getReturnType());
    }

    @Test
    void test_getLogs_returns_list() throws NoSuchMethodException {
        assertEquals(List.class, PushClient.class.getMethod("getLogs", String.class).getReturnType());
    }
}

// ─── G. AdminEdgeBase 인스턴스 검증 ──────────────────────────────────────────

class AdminEdgeBaseInstanceTest {

    @Test
    void test_constructor_does_not_throw() {
        assertDoesNotThrow(() -> new AdminEdgeBase("http://localhost:8688", "test-sk", null));
    }

    @Test
    void test_adminAuth_returns_non_null() {
        AdminEdgeBase admin = new AdminEdgeBase("http://localhost:8688", "test-sk", null);
        assertNotNull(admin.adminAuth());
    }

    @Test
    void test_storage_returns_non_null() {
        AdminEdgeBase admin = new AdminEdgeBase("http://localhost:8688", "test-sk", null);
        assertNotNull(admin.storage());
    }

    @Test
    void test_kv_returns_non_null() {
        AdminEdgeBase admin = new AdminEdgeBase("http://localhost:8688", "test-sk", null);
        assertNotNull(admin.kv("test"));
    }

    @Test
    void test_d1_returns_non_null() {
        AdminEdgeBase admin = new AdminEdgeBase("http://localhost:8688", "test-sk", null);
        assertNotNull(admin.d1("test"));
    }

    @Test
    void test_vector_returns_non_null() {
        AdminEdgeBase admin = new AdminEdgeBase("http://localhost:8688", "test-sk", null);
        assertNotNull(admin.vector("test"));
    }

    @Test
    void test_push_returns_non_null() {
        AdminEdgeBase admin = new AdminEdgeBase("http://localhost:8688", "test-sk", null);
        assertNotNull(admin.push());
    }

    @Test
    void test_db_returns_non_null() {
        AdminEdgeBase admin = new AdminEdgeBase("http://localhost:8688", "test-sk", null);
        assertNotNull(admin.db("shared"));
    }

    @Test
    void test_db_table_returns_non_null() {
        AdminEdgeBase admin = new AdminEdgeBase("http://localhost:8688", "test-sk", null);
        assertNotNull(admin.db("shared").table("posts"));
    }

    @Test
    void test_setContext_getContext() {
        AdminEdgeBase admin = new AdminEdgeBase("http://localhost:8688", "test-sk", null);
        admin.setContext(Map.of("tenant", "acme"));
        assertEquals("acme", admin.getContext().get("tenant"));
    }

    @Test
    void test_destroy_does_not_throw() {
        AdminEdgeBase admin = new AdminEdgeBase("http://localhost:8688", "test-sk", null);
        assertDoesNotThrow(admin::destroy);
    }

    @Test
    void test_trailing_slash_trimmed() {
        AdminEdgeBase admin = new AdminEdgeBase("http://localhost:8688/", "test-sk", null);
        assertNotNull(admin.adminAuth());
    }
}
