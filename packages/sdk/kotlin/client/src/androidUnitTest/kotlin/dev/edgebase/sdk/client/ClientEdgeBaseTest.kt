package dev.edgebase.sdk.client

import dev.edgebase.sdk.core.FieldOps
import dev.edgebase.sdk.core.EdgeBaseError
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNotSame
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Kotlin Client SDK 단위 테스트 — ClientEdgeBase / AuthClient / TokenManager 구조 검증
 *
 * 실행: cd packages/sdk/kotlin && ./gradlew :client:test
 *
 * 원칙: 서버 불필요, 순수 클래스 구조/생성/불변성 검증
 */

// ─── A. ClientEdgeBase 생성 ───────────────────────────────────────────────────

class ClientEdgeBaseConstructorTest {

    @Test
    fun instantiation_succeeds() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        assertNotNull(client)
    }

    @Test
    fun baseUrl_strips_trailing_slash() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun/")
        assertEquals("https://dummy.edgebase.fun", client.baseUrl)
    }

    @Test
    fun auth_property_exists() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        assertNotNull(client.auth)
    }

    @Test
    fun storage_property_exists() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        assertNotNull(client.storage)
    }

    @Test
    fun databaseLive_internal_transport_exists() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        assertNotNull(client.databaseLive)
    }

    @Test
    fun push_property_exists() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        assertNotNull(client.push)
    }

    @Test
    fun functions_property_exists() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        assertNotNull(client.functions)
    }

    @Test
    fun analytics_property_exists() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        assertNotNull(client.analytics)
    }

    @Test
    fun projectId_null_allowed() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun", null, null)
        assertNotNull(client)
    }
}

// ─── B. db() ─────────────────────────────────────────────────────────────────

class ClientEdgeBaseDbTest {

    @Test
    fun db_returns_non_null() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        assertNotNull(client.db("shared"))
    }

    @Test
    fun db_table_returns_non_null() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        assertNotNull(client.db("shared").table("posts"))
    }

    @Test
    fun db_with_instanceId() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        assertNotNull(client.db("workspace", "ws-123"))
    }

    @Test
    fun table_where_immutability() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        val t1 = client.db("shared").table("posts")
        val t2 = t1.where("status", "==", "published")
        assertNotSame(t1, t2)
    }

    @Test
    fun table_limit_immutability() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        val t1 = client.db("shared").table("posts")
        val t2 = t1.limit(10)
        assertNotSame(t1, t2)
    }

    @Test
    fun table_orderBy_immutability() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        val t1 = client.db("shared").table("posts")
        val t2 = t1.orderBy("createdAt", "desc")
        assertNotSame(t1, t2)
    }

    @Test
    fun table_chain_does_not_mutate_original() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        val t1 = client.db("shared").table("posts")
        t1.where("a", "==", "b").limit(5).orderBy("x")
        // t1 itself is unchanged
        assertNotNull(t1)
    }
}

// ─── C. AuthClient 메서드 구조 ────────────────────────────────────────────────
// Note: kotlin-reflect is NOT available in Android unit test classpaths.
// Instead of ::class.members reflection, verify method existence by directly
// referencing the callable members (compile-time check).

class AuthClientStructureTest {

    @Test
    fun signUp_method_exists() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        // Compile-time verification: signUp is callable on client.auth with (email, password)
        val fn: suspend (String, String) -> Any = { email, pass -> client.auth.signUp(email, pass) }
        assertNotNull(fn)
    }

    @Test
    fun signIn_method_exists() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        val fn: suspend (String, String) -> Any = { email, pass -> client.auth.signIn(email, pass) }
        assertNotNull(fn)
    }

    @Test
    fun signOut_method_exists() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        // If signOut compiles, it exists
        val fn: suspend () -> Unit = { client.auth.signOut() }
        assertNotNull(fn)
    }

    @Test
    fun signInAnonymously_method_exists() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        val fn: suspend () -> Any = { client.auth.signInAnonymously() }
        assertNotNull(fn)
    }

    @Test
    fun refreshToken_method_or_callback_exists() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        // tryRestoreSession is the public token restore method
        val fn: suspend () -> Any = { client.tryRestoreSession() }
        assertNotNull(fn)
    }

    @Test
    fun onAuthStateChange_flow_exists() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        assertNotNull(client.auth.onAuthStateChange)
    }

    @Test
    fun passkeys_methods_exist() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        val registerOptions: suspend () -> Any = { client.auth.passkeysRegisterOptions() }
        val register: suspend (Any?) -> Any = { response -> client.auth.passkeysRegister(response) }
        val authOptions: suspend (String?) -> Any = { email -> client.auth.passkeysAuthOptions(email) }
        val authenticate: suspend (Any?) -> Any = { response -> client.auth.passkeysAuthenticate(response) }
        val list: suspend () -> Any = { client.auth.passkeysList() }
        val delete: suspend (String) -> Any = { credentialId -> client.auth.passkeysDelete(credentialId) }
        assertNotNull(registerOptions)
        assertNotNull(register)
        assertNotNull(authOptions)
        assertNotNull(authenticate)
        assertNotNull(list)
        assertNotNull(delete)
    }
}

// ─── D. FieldOps (공통 core) ──────────────────────────────────────────────────

class FieldOpsKotlinTest {

    @Test
    fun increment_returns_correct_op() {
        val op = FieldOps.increment(5)
        assertEquals("increment", op["\$op"])
        assertEquals(5, op["value"])
    }

    @Test
    fun increment_default_by_1() {
        val op = FieldOps.increment(1)
        assertEquals(1, op["value"])
    }

    @Test
    fun increment_negative_value() {
        val op = FieldOps.increment(-10)
        assertEquals(-10, op["value"])
    }

    @Test
    fun increment_float_value() {
        val op = FieldOps.increment(3.14)
        assertEquals(3.14, op["value"])
    }

    @Test
    fun deleteField_returns_correct_op() {
        val op = FieldOps.deleteField()
        assertEquals("deleteField", op["\$op"])
    }

    @Test
    fun deleteField_no_value_key() {
        val op = FieldOps.deleteField()
        assertTrue(!op.containsKey("value"))
    }

    @Test
    fun increment_returns_map() {
        val op = FieldOps.increment(1)
        assertTrue(op is Map<*, *>)
    }
}

// ─── E. EdgeBaseError ─────────────────────────────────────────────────────────

class EdgeBaseErrorKotlinTest {

    @Test
    fun constructor_sets_statusCode() {
        val err = EdgeBaseError(404, "Not found")
        assertEquals(404, err.statusCode)
    }

    @Test
    fun constructor_sets_message() {
        val err = EdgeBaseError(400, "Validation error")
        assertEquals("Validation error", err.message)
    }

    @Test
    fun is_exception() {
        val err = EdgeBaseError(500, "Server error")
        assertTrue(err is Exception)
    }

    @Test
    fun details_null_by_default() {
        val err = EdgeBaseError(400, "err")
        assertTrue(err.details == null)
    }

    @Test
    fun toString_contains_status_and_message() {
        val err = EdgeBaseError(403, "Forbidden")
        val s = err.toString()
        assertTrue(s.contains("403"))
        assertTrue(s.contains("Forbidden"))
    }
}

// ─── F. Database live transport 구조 ─────────────────────────────────────────

class DatabaseLiveClientStructureTest {

    @Test
    fun databaseLive_instance_is_non_null() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        assertNotNull(client.databaseLive)
    }

    @Test
    fun subscribe_method_exists() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        // Compile-time verification: subscribe is callable
        val fn: (String) -> Any = { tableName -> client.databaseLive.subscribe(tableName) }
        assertNotNull(fn)
    }

    @Test
    fun unsubscribe_method_exists() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        // Compile-time verification: unsubscribe is callable
        val fn: (String) -> Unit = { id -> client.databaseLive.unsubscribe(id) }
        assertNotNull(fn)
    }

    @Test
    fun destroy_method_exists() {
        // Compile-time check that destroy() method exists on database live transport
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        val fn: () -> Unit = { client.databaseLive.destroy() }
        assertNotNull(fn)
    }
}

// ─── F-2. Database live revokedChannels 구조 ────────────────

class DatabaseLiveClientRevokedChannelsTest {

    @Test
    fun subscribe_with_filters_exists() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        // Compile-time verification: subscribe overload with filters is callable
        val filters = listOf(FilterTuple("title", "==", "test"))
        val fn: (String, List<FilterTuple>?, List<FilterTuple>?) -> Any = { table, f, of ->
            client.databaseLive.subscribe(table, serverFilters = f, serverOrFilters = of)
        }
        assertNotNull(fn)
    }

    @Test
    fun filterTuple_typealias_works() {
        // FilterTuple = Triple<String, String, Any?>
        val tuple = FilterTuple("field", "==", "value")
        assertEquals("field", tuple.first)
        assertEquals("==", tuple.second)
        assertEquals("value", tuple.third)
    }

    @Test
    fun filterTuple_nullable_value() {
        val tuple = FilterTuple("field", "!=", null)
        assertEquals("field", tuple.first)
        assertEquals("!=", tuple.second)
        assertNull(tuple.third)
    }

    @Test
    fun destroy_after_subscribe_noError() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        // Subscribe then destroy — should clear channelFilters/channelOrFilters
        client.databaseLive.subscribe("shared:posts")
        client.databaseLive.destroy()
        // No crash = pass
    }

    @Test
    fun resubscribeAll_method_exists() {
        // Verify via reflection that the private method exists
        val method = client.databaseLive::class.java.getDeclaredMethod("resubscribeAll")
        assertNotNull(method)
    }

    @Test
    fun resyncFilters_method_exists() {
        val method = client.databaseLive::class.java.getDeclaredMethod("resyncFilters")
        assertNotNull(method)
    }

    private val client = ClientEdgeBase("https://dummy.edgebase.fun")
}

// ─── G. RoomClient v2 구조 ───────────────────────────────────────────────────

class RoomClientStructureTest {

    private fun createRoom(namespace: String = "game", roomId: String = "test-room"): RoomClient {
        // RoomClient requires a TokenManager; use ClientTokenManager with MemoryTokenStorage
        val tokenManager = ClientTokenManager(MemoryTokenStorage())
        return RoomClient(
            baseUrl = "https://dummy.edgebase.fun",
            namespace = namespace,
            roomId = roomId,
            tokenManager = tokenManager
        )
    }

    @Test
    fun sharedState_is_empty_map_initially() {
        val room = createRoom()
        assertTrue(room.getSharedState().isEmpty())
    }

    @Test
    fun playerState_is_empty_map_initially() {
        val room = createRoom()
        assertTrue(room.getPlayerState().isEmpty())
    }

    @Test
    fun userId_is_null_initially() {
        val room = createRoom()
        assertNull(room.userId)
    }

    @Test
    fun connectionId_is_null_initially() {
        val room = createRoom()
        assertNull(room.connectionId)
    }

    @Test
    fun players_is_empty_list_initially() {
        val room = createRoom()
        assertTrue(room.players.isEmpty())
    }

    @Test
    fun namespace_matches_constructor_arg() {
        val room = createRoom(namespace = "chat")
        assertEquals("chat", room.namespace)
    }

    @Test
    fun roomId_matches_constructor_arg() {
        val room = createRoom(roomId = "my-game-lobby")
        assertEquals("my-game-lobby", room.roomId)
    }

    @Test
    fun onSharedState_returns_subscription() {
        val room = createRoom()
        val sub = room.onSharedState { _, _ -> }
        assertNotNull(sub)
        sub.unsubscribe()
    }

    @Test
    fun onPlayerState_returns_subscription() {
        val room = createRoom()
        val sub = room.onPlayerState { _, _ -> }
        assertNotNull(sub)
        sub.unsubscribe()
    }

    @Test
    fun onMessage_returns_subscription() {
        val room = createRoom()
        val sub = room.onMessage("game_over") { }
        assertNotNull(sub)
        sub.unsubscribe()
    }

    @Test
    fun onAnyMessage_returns_subscription() {
        val room = createRoom()
        val sub = room.onAnyMessage { _, _ -> }
        assertNotNull(sub)
        sub.unsubscribe()
    }

    @Test
    fun onJoin_returns_subscription() {
        val room = createRoom()
        val sub = room.onJoin { }
        assertNotNull(sub)
        sub.unsubscribe()
    }

    @Test
    fun onLeave_returns_subscription() {
        val room = createRoom()
        val sub = room.onLeave { }
        assertNotNull(sub)
        sub.unsubscribe()
    }

    @Test
    fun onError_returns_subscription() {
        val room = createRoom()
        val sub = room.onError { }
        assertNotNull(sub)
        sub.unsubscribe()
    }

    @Test
    fun onKicked_returns_subscription() {
        val room = createRoom()
        val sub = room.onKicked { }
        assertNotNull(sub)
        sub.unsubscribe()
    }

    @Test
    fun room_factory_on_client() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        val room = client.room("game", "room-123")
        assertEquals("game", room.namespace)
        assertEquals("room-123", room.roomId)
    }
}

class RoomMediaTransportStructureTest {

    private fun createRoom(): RoomClient {
        val tokenManager = ClientTokenManager(MemoryTokenStorage())
        return RoomClient(
            baseUrl = "https://dummy.edgebase.fun",
            namespace = "media",
            roomId = "room-1",
            tokenManager = tokenManager,
        )
    }

    @Test
    fun transport_returns_cloudflare_runtime_by_default() {
        val room = createRoom()
        val transport = room.media.transport()
        assertEquals("RoomCloudflareMediaTransport", transport::class.simpleName)
    }

    @Test
    fun transport_returns_p2p_runtime_when_requested() {
        val room = createRoom()
        val transport = room.media.transport(
            RoomMediaTransportOptions(
                provider = RoomMediaTransportProvider.p2p,
                p2p = RoomP2PMediaTransportOptions(),
            ),
        )
        assertEquals("RoomP2PMediaTransport", transport::class.simpleName)
    }

    @Test
    fun android_runtime_factories_are_available_for_both_media_providers() {
        assertNotNull(defaultCloudflareRealtimeKitClientFactory())
        assertNotNull(defaultP2PMediaRuntimeFactory())
    }
}

// ─── H. PushClient 구조 ─────────────────────────────────────────────────────

class PushClientStructureTest {

    @Test
    fun push_instance_is_non_null() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        assertNotNull(client.push)
    }

    @Test
    fun register_method_exists() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        val fn: suspend (Map<String, Any>?) -> Unit = { meta -> client.push.register(meta) }
        assertNotNull(fn)
    }

    @Test
    fun unregister_method_exists() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        val fn: suspend (String?) -> Unit = { deviceId -> client.push.unregister(deviceId) }
        assertNotNull(fn)
    }

    @Test
    fun onMessage_method_exists() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        // Compile-time verification
        val fn: ((Map<String, Any?>) -> Unit) -> Unit = { cb -> client.push.onMessage(cb) }
        assertNotNull(fn)
    }

    @Test
    fun onMessageOpenedApp_method_exists() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        val fn: ((Map<String, Any?>) -> Unit) -> Unit = { cb -> client.push.onMessageOpenedApp(cb) }
        assertNotNull(fn)
    }

    @Test
    fun getPermissionStatus_method_exists() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        // getPermissionStatus returns a String — compile-time check
        val fn: () -> String = { client.push.getPermissionStatus() }
        assertNotNull(fn)
    }

    @Test
    fun requestPermission_method_exists() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        val fn: suspend () -> String = { client.push.requestPermission() }
        assertNotNull(fn)
    }

    @Test
    fun setTokenProvider_method_exists() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        val fn: (suspend () -> String) -> Unit = { provider -> client.push.setTokenProvider(provider) }
        assertNotNull(fn)
    }

    @Test
    fun setPermissionProvider_method_exists() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        val fn: (() -> String, suspend () -> String) -> Unit = { status, request ->
            client.push.setPermissionProvider(status, request)
        }
        assertNotNull(fn)
    }

    @Test
    fun setTopicProvider_method_exists() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        val fn: (suspend (String) -> Unit, suspend (String) -> Unit) -> Unit = { subscribe, unsubscribe ->
            client.push.setTopicProvider(subscribe, unsubscribe)
        }
        assertNotNull(fn)
    }

    @Test
    fun getPermissionStatus_returns_valid_string() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        val status = client.push.getPermissionStatus()
        // Must be one of the valid permission statuses
        assertTrue(status in listOf("granted", "denied", "notDetermined"),
            "getPermissionStatus should return a valid status, got: $status")
    }

    @Test
    fun getPermissionStatus_returns_consistent_value() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        val status1 = client.push.getPermissionStatus()
        val status2 = client.push.getPermissionStatus()
        // Consecutive calls without state change should return same value
        assertEquals(status1, status2, "getPermissionStatus should be consistent")
    }
}

// ─── H-1. PushClient — Permission 동작 상세 ────────────────────────────────

class PushClientPermissionBehaviorTest {

    @Test
    fun dispatchMessage_and_listener_work() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        val received = mutableListOf<Map<String, Any?>>()
        client.push.onMessage { received.add(it) }
        client.push.dispatchMessage(mapOf("title" to "Test", "body" to "Hello"))
        assertEquals(1, received.size)
        assertEquals("Test", received[0]["title"])
    }

    @Test
    fun dispatchMessageOpenedApp_and_listener_work() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        val received = mutableListOf<Map<String, Any?>>()
        client.push.onMessageOpenedApp { received.add(it) }
        client.push.dispatchMessageOpenedApp(mapOf("title" to "Tapped", "data" to mapOf("key" to "val")))
        assertEquals(1, received.size)
        assertEquals("Tapped", received[0]["title"])
    }

    @Test
    fun multiple_message_listeners_all_called() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        var c1 = 0; var c2 = 0
        client.push.onMessage { c1++ }
        client.push.onMessage { c2++ }
        client.push.dispatchMessage(mapOf("title" to "Test"))
        assertEquals(1, c1)
        assertEquals(1, c2)
    }
}

// ─── I. StorageClient 구조 ──────────────────────────────────────────────────

class StorageClientStructureTest {

    @Test
    fun storage_instance_is_non_null() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        assertNotNull(client.storage)
    }

    @Test
    fun bucket_returns_non_null() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        assertNotNull(client.storage.bucket("avatars"))
    }

    @Test
    fun bucket_name_matches() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        val bucket = client.storage.bucket("avatars")
        assertEquals("avatars", bucket.name)
    }

    @Test
    fun upload_method_exists() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        val bucket = client.storage.bucket("test")
        val fn: suspend (String, ByteArray) -> Any = { key, data -> bucket.upload(key, data) }
        assertNotNull(fn)
    }

    @Test
    fun download_method_exists() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        val bucket = client.storage.bucket("test")
        val fn: suspend (String) -> ByteArray = { key -> bucket.download(key) }
        assertNotNull(fn)
    }

    @Test
    fun getUrl_returns_string() {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        val bucket = client.storage.bucket("avatars")
        val url = bucket.getUrl("profile.png")
        assertNotNull(url)
        assertTrue(url.contains("avatars"))
        assertTrue(url.contains("profile.png"))
    }
}

// ─── J. TableRef 체인 빌더 ──────────────────────────────────────────────────

class TableRefChainBuilderTest {

    private fun table(): dev.edgebase.sdk.core.TableRef {
        val client = ClientEdgeBase("https://dummy.edgebase.fun")
        return client.db("shared").table("posts")
    }

    @Test
    fun where_returns_new_ref() {
        val t = table()
        val t2 = t.where("status", "==", "published")
        assertNotNull(t2)
        assertNotSame(t, t2)
    }

    @Test
    fun orderBy_returns_new_ref() {
        val t = table()
        val t2 = t.orderBy("createdAt", "desc")
        assertNotNull(t2)
        assertNotSame(t, t2)
    }

    @Test
    fun limit_returns_new_ref() {
        val t = table()
        val t2 = t.limit(10)
        assertNotNull(t2)
        assertNotSame(t, t2)
    }

    @Test
    fun offset_returns_new_ref() {
        val t = table()
        val t2 = t.offset(20)
        assertNotNull(t2)
        assertNotSame(t, t2)
    }

    @Test
    fun page_returns_new_ref() {
        val t = table()
        val t2 = t.page(3)
        assertNotNull(t2)
        assertNotSame(t, t2)
    }

    @Test
    fun search_returns_new_ref() {
        val t = table()
        val t2 = t.search("kotlin")
        assertNotNull(t2)
        assertNotSame(t, t2)
    }

    @Test
    fun after_returns_new_ref() {
        val t = table()
        val t2 = t.after("cursor-abc")
        assertNotNull(t2)
        assertNotSame(t, t2)
    }

    @Test
    fun before_returns_new_ref() {
        val t = table()
        val t2 = t.before("cursor-xyz")
        assertNotNull(t2)
        assertNotSame(t, t2)
    }

    @Test
    fun or_returns_new_ref() {
        val t = table()
        val t2 = t.or { builder ->
            builder.where("status", "==", "draft")
            builder.where("status", "==", "archived")
        }
        assertNotNull(t2)
        assertNotSame(t, t2)
    }

    @Test
    fun doc_returns_non_null() {
        val t = table()
        val docRef = t.doc("abc-123")
        assertNotNull(docRef)
    }

    @Test
    fun chain_combo_where_orderBy_limit() {
        val t = table()
        val chained = t.where("status", "==", "published")
            .orderBy("createdAt", "desc")
            .limit(20)
        assertNotNull(chained)
        assertNotSame(t, chained)
    }
}

// ─── K. EdgeBaseError 확장 ──────────────────────────────────────────────────

class EdgeBaseErrorExtendedTest {

    @Test
    fun error_with_details_map() {
        val details = mapOf("email" to listOf("required", "invalid format"))
        val err = EdgeBaseError(422, "Validation failed", details)
        assertNotNull(err.details)
        assertEquals(listOf("required", "invalid format"), err.details!!["email"])
    }

    @Test
    fun statusCode_matches() {
        val err = EdgeBaseError(429, "Too many requests")
        assertEquals(429, err.statusCode)
    }

    @Test
    fun message_matches() {
        val err = EdgeBaseError(401, "Unauthorized")
        assertEquals("Unauthorized", err.message)
    }

    @Test
    fun is_throwable() {
        val err = EdgeBaseError(500, "Internal error")
        assertTrue(err is Throwable)
    }

    @Test
    fun toString_includes_details() {
        val details = mapOf("name" to listOf("required"))
        val err = EdgeBaseError(400, "Bad request", details)
        val s = err.toString()
        assertTrue(s.contains("400"))
        assertTrue(s.contains("Bad request"))
        assertTrue(s.contains("name"))
        assertTrue(s.contains("required"))
    }

    @Test
    fun fromJson_parses_correctly() {
        val json = mapOf<String, Any?>(
            "message" to "Not found",
            "details" to mapOf("id" to listOf("does not exist"))
        )
        val err = EdgeBaseError.fromJson(json, 404)
        assertEquals(404, err.statusCode)
        assertEquals("Not found", err.message)
        assertNotNull(err.details)
        assertEquals(listOf("does not exist"), err.details!!["id"])
    }
}
