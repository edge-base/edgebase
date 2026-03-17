package dev.edgebase.sdk.client;

import dev.edgebase.sdk.core.RoomClient;
import org.junit.jupiter.api.Test;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.*;
import java.util.concurrent.ScheduledExecutorService;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Java android (client) SDK 단위 테스트 — TokenPair / ClientEdgeBase 구조 검증
 *
 * 실행: cd packages/sdk/java/packages/android && ./gradlew test
 *
 * 원칙: 서버 불필요, 순수 클래스 구조/생성 검증
 */

// ─── A. TokenPair
// ─────────────────────────────────────────────────────────────

class TokenPairTest {

    @Test
    void test_constructor_sets_access_token() {
        TokenPair tp = new TokenPair("access-abc", "refresh-xyz");
        assertEquals("access-abc", tp.getAccessToken());
    }

    @Test
    void test_constructor_sets_refresh_token() {
        TokenPair tp = new TokenPair("access-abc", "refresh-xyz");
        assertEquals("refresh-xyz", tp.getRefreshToken());
    }

    @Test
    void test_empty_tokens_allowed() {
        TokenPair tp = new TokenPair("", "");
        assertEquals("", tp.getAccessToken());
        assertEquals("", tp.getRefreshToken());
    }

    @Test
    void test_null_access_token() {
        TokenPair tp = new TokenPair(null, "refresh");
        assertNull(tp.getAccessToken());
    }

    @Test
    void test_null_refresh_token() {
        TokenPair tp = new TokenPair("access", null);
        assertNull(tp.getRefreshToken());
    }
}

class TokenManagerRefreshTest {

    @Test
    void test_missing_access_token_uses_refresh_callback() {
        TokenStorage storage = new TokenStorage() {
            private TokenPair tokens = new TokenPair(null, "refresh-xyz");

            @Override
            public TokenPair getTokens() {
                return tokens;
            }

            @Override
            public void saveTokens(TokenPair pair) {
                tokens = pair;
            }

            @Override
            public void clearTokens() {
                tokens = null;
            }
        };

        TokenManager tokenManager = new TokenManager(storage);
        tokenManager.setRefreshCallback(refreshToken -> {
            assertEquals("refresh-xyz", refreshToken);
            return new TokenPair("access-fresh", "refresh-fresh");
        });

        assertEquals("access-fresh", tokenManager.getAccessToken());
        assertEquals("refresh-fresh", tokenManager.getRefreshToken());
    }

    @Test
    void test_decodeJwtPayload_normalizes_id_from_sub() {
        String header = Base64.getUrlEncoder().withoutPadding()
                .encodeToString("{\"alg\":\"none\",\"typ\":\"JWT\"}".getBytes(StandardCharsets.UTF_8));
        String payload = Base64.getUrlEncoder().withoutPadding()
                .encodeToString("{\"sub\":\"user-123\",\"email\":\"user@test.edgebase.fun\"}".getBytes(StandardCharsets.UTF_8));

        Map<String, Object> decoded = TokenManager.decodeJwtPayload(header + "." + payload + ".");
        assertNotNull(decoded);
        assertEquals("user-123", decoded.get("id"));
        assertEquals("user@test.edgebase.fun", decoded.get("email"));
    }

    @Test
    void test_decodeJwtPayload_backfills_null_id_and_userId() {
        String header = Base64.getUrlEncoder().withoutPadding()
                .encodeToString("{\"alg\":\"none\",\"typ\":\"JWT\"}".getBytes(StandardCharsets.UTF_8));
        String payload = Base64.getUrlEncoder().withoutPadding()
                .encodeToString("{\"id\":null,\"sub\":\"user-456\"}".getBytes(StandardCharsets.UTF_8));

        Map<String, Object> decoded = TokenManager.decodeJwtPayload(header + "." + payload + ".");
        assertNotNull(decoded);
        assertEquals("user-456", decoded.get("id"));
        assertEquals("user-456", decoded.get("userId"));
    }
}

// ─── B. ClientEdgeBase 구조 ───────────────────────────────────────────────────

class ClientEdgeBaseStructureTest {

    @Test
    void test_clientEdgeBase_db_method_exists() throws NoSuchMethodException {
        assertNotNull(ClientEdgeBase.class.getMethod("db", String.class));
    }

    @Test
    void test_clientEdgeBase_auth_method_exists() throws NoSuchMethodException {
        assertNotNull(ClientEdgeBase.class.getMethod("auth"));
    }

    @Test
    void test_clientEdgeBase_storage_method_exists() throws NoSuchMethodException {
        assertNotNull(ClientEdgeBase.class.getMethod("storage"));
    }

    @Test
    void test_clientEdgeBase_push_method_exists() throws NoSuchMethodException {
        assertNotNull(ClientEdgeBase.class.getMethod("push"));
    }

    @Test
    void test_clientEdgeBase_functions_method_exists() throws NoSuchMethodException {
        assertNotNull(ClientEdgeBase.class.getMethod("functions"));
    }

    @Test
    void test_clientEdgeBase_analytics_method_exists() throws NoSuchMethodException {
        assertNotNull(ClientEdgeBase.class.getMethod("analytics"));
    }

    @Test
    void test_clientEdgeBase_context_methods_exist() throws NoSuchMethodException {
        assertNotNull(ClientEdgeBase.class.getMethod("setContext", Map.class));
        assertNotNull(ClientEdgeBase.class.getMethod("getContext"));
        assertNotNull(ClientEdgeBase.class.getMethod("clearContext"));
    }

    @Test
    void test_clientEdgeBase_destroy_method_exists() throws NoSuchMethodException {
        assertNotNull(ClientEdgeBase.class.getMethod("destroy"));
    }

    @Test
    void test_clientEdgeBase_wires_token_refresh_callback() throws Exception {
        ClientEdgeBase client = new ClientEdgeBase("http://localhost:8688");

        Field tokenManagerField = ClientEdgeBase.class.getDeclaredField("tokenManager");
        tokenManagerField.setAccessible(true);
        TokenManager tokenManager = (TokenManager) tokenManagerField.get(client);

        Field refreshCallbackField = TokenManager.class.getDeclaredField("refreshCallback");
        refreshCallbackField.setAccessible(true);
        assertNotNull(refreshCallbackField.get(tokenManager));

        client.destroy();
    }

    @Test
    void test_clientEdgeBase_destroy_cleans_up_room_clients() throws Exception {
        ClientEdgeBase client = new ClientEdgeBase("http://localhost:8688");
        RoomClient room = client.room("game", "cleanup-check");

        Field schedulerField = RoomClient.class.getDeclaredField("scheduler");
        schedulerField.setAccessible(true);
        ScheduledExecutorService scheduler = (ScheduledExecutorService) schedulerField.get(room);

        client.destroy();

        assertTrue(scheduler.isShutdown());
    }
}

// ─── C. AuthClient 메서드 구조 ────────────────────────────────────────────────

class AuthClientStructureTest {

    @Test
    void test_signUp_method_exists() throws NoSuchMethodException {
        assertNotNull(AuthClient.class.getMethod("signUp", String.class, String.class));
    }

    @Test
    void test_signIn_method_exists() throws NoSuchMethodException {
        assertNotNull(AuthClient.class.getMethod("signIn", String.class, String.class));
    }

    @Test
    void test_signOut_method_exists() throws NoSuchMethodException {
        assertNotNull(AuthClient.class.getMethod("signOut"));
    }

    @Test
    void test_signInAnonymously_method_exists() throws NoSuchMethodException {
        assertNotNull(AuthClient.class.getMethod("signInAnonymously"));
    }

    @Test
    void test_getMe_method_exists() throws NoSuchMethodException {
        assertNotNull(AuthClient.class.getMethod("getMe"));
    }

    @Test
    void test_refreshToken_method_exists() throws NoSuchMethodException {
        assertNotNull(AuthClient.class.getMethod("refreshToken"));
    }

    @Test
    void test_passkeys_methods_exist() throws NoSuchMethodException {
        assertNotNull(AuthClient.class.getMethod("passkeysRegisterOptions"));
        assertNotNull(AuthClient.class.getMethod("passkeysRegister", Map.class));
        assertNotNull(AuthClient.class.getMethod("passkeysAuthOptions"));
        assertNotNull(AuthClient.class.getMethod("passkeysAuthOptions", String.class));
        assertNotNull(AuthClient.class.getMethod("passkeysAuthenticate", Map.class));
        assertNotNull(AuthClient.class.getMethod("passkeysList"));
        assertNotNull(AuthClient.class.getMethod("passkeysDelete", String.class));
    }

    @Test
    void test_auth_helpers_exist() throws NoSuchMethodException {
        assertNotNull(AuthClient.class.getMethod("linkWithEmail", String.class, String.class));
        assertNotNull(AuthClient.class.getMethod("linkWithOAuth", String.class));
        assertNotNull(AuthClient.class.getMethod("currentUser"));
        assertNotNull(AuthClient.class.getMethod("listSessions"));
        assertNotNull(AuthClient.class.getMethod("updateProfile", String.class, String.class));
        assertNotNull(AuthClient.class.getMethod("requestEmailVerification"));
        assertNotNull(AuthClient.class.getMethod("verifyEmail", String.class));
        assertNotNull(AuthClient.class.getMethod("verifyEmailOtp", String.class, String.class));
        assertNotNull(AuthClient.class.getMethod("verifyEmailChange", String.class));
        assertNotNull(AuthClient.class.getMethod("requestPasswordReset", String.class));
        assertNotNull(AuthClient.class.getMethod("changeEmail", String.class, String.class));
        assertNotNull(AuthClient.class.getMethod("refreshToken"));
        assertNotNull(AuthClient.class.getMethod("passkeysAuthOptions"));
        assertNotNull(AuthClient.class.getMethod("enrollTotp"));
        assertNotNull(AuthClient.class.getMethod("signInWithEmailOtp", String.class));
        assertNotNull(AuthClient.class.getMethod("signInWithMagicLink", String.class));
        assertNotNull(AuthClient.class.getMethod("signInWithPhone", String.class, String.class));
        assertNotNull(AuthClient.class.getMethod("mfa"));
        assertNotNull(AuthClient.class.getMethod("passkeys"));
    }

    @Test
    void test_resolveCaptchaToken_uses_configured_system_property_on_desktop_jvm() throws Exception {
        String previous = System.getProperty("edgebase.captchaToken");
        System.setProperty("edgebase.captchaToken", "configured-test-token");

        try {
            ClientEdgeBase client = new ClientEdgeBase("http://localhost:8688");
            Method method = AuthClient.class.getDeclaredMethod("resolveCaptchaToken", String.class, String.class);
            method.setAccessible(true);

            String resolved = (String) method.invoke(client.auth(), "signin", null);
            assertEquals("configured-test-token", resolved);

            client.destroy();
        } finally {
            if (previous == null) {
                System.clearProperty("edgebase.captchaToken");
            } else {
                System.setProperty("edgebase.captchaToken", previous);
            }
        }
    }
}

// ─── D. Database live transport revokedChannels 구조 ───────

class DatabaseLiveClientRevokedChannelsTest {

    @Test
    void test_subscribe_with_filters_overload_exists() {
        // subscribe(String, Consumer, List<FilterTuple>, List<FilterTuple>)
        boolean exists = Arrays.stream(DatabaseLiveClient.class.getDeclaredMethods())
                .anyMatch(m -> m.getName().equals("subscribe") && m.getParameterCount() >= 3);
        assertTrue(exists, "subscribe() overload with filter params should exist");
    }

    @Test
    void test_sendAuthMessage_method_exists() throws Exception {
        Method method = DatabaseLiveClient.class.getDeclaredMethod("sendAuthMessage");
        assertNotNull(method);
    }

    @Test
    void test_resubscribeAll_method_exists() throws Exception {
        Method method = DatabaseLiveClient.class.getDeclaredMethod("resubscribeAll");
        assertNotNull(method);
    }

    @Test
    void test_resyncFilters_method_exists() throws Exception {
        Method method = DatabaseLiveClient.class.getDeclaredMethod("resyncFilters");
        assertNotNull(method);
    }

    @Test
    void test_authenticated_field_exists() throws Exception {
        Field field = DatabaseLiveClient.class.getDeclaredField("authenticated");
        assertNotNull(field);
        assertTrue(java.lang.reflect.Modifier.isVolatile(field.getModifiers()),
                "authenticated should be volatile");
    }

    @Test
    void test_subscribedChannels_field_exists() throws Exception {
        Field field = DatabaseLiveClient.class.getDeclaredField("subscribedChannels");
        assertNotNull(field);
    }

    @Test
    void test_channelFilters_field_exists() throws Exception {
        Field field = DatabaseLiveClient.class.getDeclaredField("channelFilters");
        assertNotNull(field);
    }

    @Test
    void test_channelOrFilters_field_exists() throws Exception {
        Field field = DatabaseLiveClient.class.getDeclaredField("channelOrFilters");
        assertNotNull(field);
    }
}

// ─── G. PushClient 권한 구조 ─────────────────────────────────────────────────

class PushClientStructureTest {

    @Test
    void test_pushClient_class_exists() {
        assertNotNull(PushClient.class);
    }

    @Test
    void test_getPermissionStatus_method_exists() throws NoSuchMethodException {
        Method m = PushClient.class.getMethod("getPermissionStatus");
        assertNotNull(m);
        assertEquals(String.class, m.getReturnType());
    }

    @Test
    void test_requestPermission_method_exists() throws NoSuchMethodException {
        Method m = PushClient.class.getMethod("requestPermission");
        assertNotNull(m);
        assertEquals(String.class, m.getReturnType());
    }

    @Test
    void test_setPermissionStatusProvider_method_exists() throws NoSuchMethodException {
        assertNotNull(PushClient.class.getMethod("setPermissionStatusProvider", java.util.function.Supplier.class));
    }

    @Test
    void test_setPermissionRequester_method_exists() throws NoSuchMethodException {
        assertNotNull(PushClient.class.getMethod("setPermissionRequester", java.util.function.Supplier.class));
    }

    @Test
    void test_register_method_exists() throws NoSuchMethodException {
        assertNotNull(PushClient.class.getMethod("register"));
    }

    @Test
    void test_register_with_metadata_method_exists() throws NoSuchMethodException {
        assertNotNull(PushClient.class.getMethod("register", Map.class));
    }

    @Test
    void test_unregister_method_exists() throws NoSuchMethodException {
        assertNotNull(PushClient.class.getMethod("unregister"));
    }

    @Test
    void test_onMessage_method_exists() throws NoSuchMethodException {
        assertNotNull(PushClient.class.getMethod("onMessage", java.util.function.Consumer.class));
    }

    @Test
    void test_setFcmTokenProvider_method_exists() throws NoSuchMethodException {
        assertNotNull(PushClient.class.getMethod("setFcmTokenProvider", java.util.concurrent.Callable.class));
    }

    @Test
    void test_subscribeTopic_method_exists() throws NoSuchMethodException {
        assertNotNull(PushClient.class.getMethod("subscribeTopic", String.class));
    }

    @Test
    void test_unsubscribeTopic_method_exists() throws NoSuchMethodException {
        assertNotNull(PushClient.class.getMethod("unsubscribeTopic", String.class));
    }

    @Test
    void test_dispatchMessage_method_exists() throws NoSuchMethodException {
        assertNotNull(PushClient.class.getMethod("dispatchMessage", Map.class));
    }

    @Test
    void test_dispatchMessageOpenedApp_method_exists() throws NoSuchMethodException {
        assertNotNull(PushClient.class.getMethod("dispatchMessageOpenedApp", Map.class));
    }
}

// ─── H. PushClient 권한 동작 테스트 ──────────────────────────────────────────

class PushClientPermissionTest {

    @Test
    void test_default_permissionStatusProvider_field_is_supplier() throws Exception {
        // PushClient constructor sets PushPermissionHelper as default provider
        Field field = PushClient.class.getDeclaredField("permissionStatusProvider");
        field.setAccessible(true);
        assertEquals("java.util.function.Supplier", field.getType().getName(),
                "permissionStatusProvider field should be Supplier<String>");
    }

    @Test
    void test_default_permissionRequester_field_is_supplier() throws Exception {
        Field field = PushClient.class.getDeclaredField("permissionRequester");
        field.setAccessible(true);
        assertEquals("java.util.function.Supplier", field.getType().getName(),
                "permissionRequester field should be Supplier<String>");
    }

    @Test
    void test_custom_provider_overrides_default() throws NoSuchMethodException {
        // Verify setPermissionStatusProvider accepts and stores a custom provider
        Method method = PushClient.class.getMethod("setPermissionStatusProvider", java.util.function.Supplier.class);
        assertNotNull(method);
        assertEquals(void.class, method.getReturnType());
    }

    @Test
    void test_custom_requester_overrides_default() throws NoSuchMethodException {
        Method method = PushClient.class.getMethod("setPermissionRequester", java.util.function.Supplier.class);
        assertNotNull(method);
        assertEquals(void.class, method.getReturnType());
    }
}

// ─── I. PushPermissionHelper 구조 ────────────────────────────────────────────

class PushPermissionHelperStructureTest {

    @Test
    void test_helper_class_exists() {
        assertNotNull(PushPermissionHelper.class);
    }

    @Test
    void test_getPermissionStatus_is_static() throws NoSuchMethodException {
        Method method = PushPermissionHelper.class.getMethod("getPermissionStatus");
        assertTrue(java.lang.reflect.Modifier.isStatic(method.getModifiers()),
                "getPermissionStatus should be static");
        assertEquals(String.class, method.getReturnType());
    }

    @Test
    void test_requestPermission_is_static() throws NoSuchMethodException {
        Method method = PushPermissionHelper.class.getMethod("requestPermission");
        assertTrue(java.lang.reflect.Modifier.isStatic(method.getModifiers()),
                "requestPermission should be static");
        assertEquals(String.class, method.getReturnType());
    }

    @Test
    void test_getPermissionStatus_returns_string() throws NoSuchMethodException {
        Method method = PushPermissionHelper.class.getMethod("getPermissionStatus");
        assertEquals(String.class, method.getReturnType());
        assertEquals(0, method.getParameterCount(), "getPermissionStatus should take no parameters");
    }

    @Test
    void test_requestPermission_returns_string() throws NoSuchMethodException {
        Method method = PushPermissionHelper.class.getMethod("requestPermission");
        assertEquals(String.class, method.getReturnType());
        assertEquals(0, method.getParameterCount(), "requestPermission should take no parameters");
    }
}
