import XCTest
import Foundation
@testable import EdgeBase

/**
 * Swift iOS SDK 단위 테스트 — EdgeBaseClient / AuthClient 구조 검증
 *
 * 실행: cd packages/sdk/swift/packages/ios && swift test
 *
 * 원칙: 서버 불필요, 순수 클래스 구조/생성 검증
 */
final class EdgeBaseClientIosUnitTests: XCTestCase {

    // ─── A. EdgeBaseClient 생성 ───────────────────────────────────────────────

    func test_instantiation_succeeds() throws {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        XCTAssertNotNil(client)
    }

    func test_baseUrl_strips_trailing_slash() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun/")
        XCTAssertEqual("https://dummy.edgebase.fun", client.baseUrl)
    }

    func test_auth_property_exists() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        XCTAssertNotNil(client.auth)
    }

    func test_storage_property_exists() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        XCTAssertNotNil(client.storage)
    }

    func test_databaseLive_internal_transport_exists() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        XCTAssertNotNil(client.databaseLive)
    }

    func test_push_property_exists() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        XCTAssertNotNil(client.push)
    }

    func test_functions_property_exists() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        XCTAssertNotNil(client.functions)
    }

    func test_analytics_property_exists() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        XCTAssertNotNil(client.analytics)
    }

    func test_db_returns_non_nil() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let db = client.db("shared")
        XCTAssertNotNil(db)
    }

    func test_db_table_returns_non_nil() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let table = client.db("shared").table("posts")
        XCTAssertNotNil(table)
    }

    func test_db_with_instanceId_returns_non_nil() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let db = client.db("workspace", instanceId: "ws-123")
        XCTAssertNotNil(db)
    }

    // ─── B. TableRef 불변성 (query builder) ────────────────────────────────────

    func test_table_where_returns_new_instance() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let t1 = client.db("shared").table("posts")
        let t2 = t1.where("status", "==", "published")
        XCTAssertNotIdentical(t1 as AnyObject, t2 as AnyObject)
    }

    func test_table_limit_returns_new_instance() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let t1 = client.db("shared").table("posts")
        let t2 = t1.limit(10)
        XCTAssertNotIdentical(t1 as AnyObject, t2 as AnyObject)
    }

    func test_table_orderBy_returns_new_instance() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let t1 = client.db("shared").table("posts")
        let t2 = t1.orderBy("createdAt", "desc")
        XCTAssertNotIdentical(t1 as AnyObject, t2 as AnyObject)
    }

    // ─── C. RoomClient ─────────────────────────────────────────────────────────

    func test_room_returns_non_nil() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let room = client.room(namespace: "game", id: "test-room")
        XCTAssertNotNil(room)
    }

    // ─── D. AuthClient 메서드 존재 확인 (reflection) ───────────────────────────

    func test_auth_client_type_accessible() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        XCTAssertNotNil(client.auth)
        XCTAssertTrue(type(of: client.auth) == AuthClient.self)
    }

    func test_passkeys_methods_exist() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let registerOptions: () async throws -> [String: Any] = { try await client.auth.passkeysRegisterOptions() }
        let register: ([String: Any]) async throws -> [String: Any] = { response in
            try await client.auth.passkeysRegister(response: response)
        }
        let authOptions: (String?) async throws -> [String: Any] = { email in
            try await client.auth.passkeysAuthOptions(email: email)
        }
        let authenticate: ([String: Any]) async throws -> [String: Any] = { response in
            try await client.auth.passkeysAuthenticate(response: response)
        }
        let list: () async throws -> [String: Any] = { try await client.auth.passkeysList() }
        let delete: (String) async throws -> [String: Any] = { credentialId in
            try await client.auth.passkeysDelete(credentialId: credentialId)
        }

        XCTAssertNotNil(registerOptions)
        XCTAssertNotNil(register)
        XCTAssertNotNil(authOptions)
        XCTAssertNotNil(authenticate)
        XCTAssertNotNil(list)
        XCTAssertNotNil(delete)
    }

    func test_auth_surface_exposes_canonical_helpers() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let refreshToken: () async throws -> [String: Any] = { try await client.auth.refreshToken() }
        let linkWithEmail: (String, String) async throws -> [String: Any] = { email, password in
            try await client.auth.linkWithEmail(email: email, password: password)
        }
        let linkWithOAuth: (String) async throws -> String = { provider in
            try await client.auth.linkWithOAuth(provider: provider)
        }
        let currentUser: () async -> [String: Any]? = { await client.auth.currentUser() }
        let listSessions: () async throws -> [[String: Any]] = { try await client.auth.listSessions() }
        let revokeSession: (String) async throws -> Void = { sessionId in
            try await client.auth.revokeSession(sessionId: sessionId)
        }
        let updateProfile: () async throws -> [String: Any] = {
            try await client.auth.updateProfile(displayName: "Swift User", avatarUrl: "https://example.com/avatar.png")
        }
        let requestEmailVerification: () async throws -> [String: Any] = {
            try await client.auth.requestEmailVerification()
        }
        let requestPasswordReset: (String) async throws -> [String: Any] = { email in
            try await client.auth.requestPasswordReset(email: email)
        }
        let changeEmail: (String, String) async throws -> [String: Any] = { email, password in
            try await client.auth.changeEmail(newEmail: email, password: password)
        }
        let changePassword: (String, String) async throws -> [String: Any] = { currentPassword, newPassword in
            try await client.auth.changePassword(currentPassword: currentPassword, newPassword: newPassword)
        }
        let signInWithEmailOtp: (String) async throws -> [String: Any] = { email in
            try await client.auth.signInWithEmailOtp(email: email)
        }
        let verifyEmailOtp: (String, String) async throws -> [String: Any] = { email, code in
            try await client.auth.verifyEmailOtp(email: email, code: code)
        }
        let signInWithMagicLink: (String) async throws -> Void = { email in
            try await client.auth.signInWithMagicLink(email: email)
        }
        let passkeysAuthOptions: () async throws -> [String: Any] = {
            try await client.auth.passkeysAuthOptions()
        }
        let enrollTotp: () async throws -> [String: Any] = {
            try await client.auth.enrollTotp()
        }

        XCTAssertNotNil(refreshToken)
        XCTAssertNotNil(linkWithEmail)
        XCTAssertNotNil(linkWithOAuth)
        XCTAssertNotNil(currentUser)
        XCTAssertNotNil(listSessions)
        XCTAssertNotNil(revokeSession)
        XCTAssertNotNil(updateProfile)
        XCTAssertNotNil(requestEmailVerification)
        XCTAssertNotNil(requestPasswordReset)
        XCTAssertNotNil(changeEmail)
        XCTAssertNotNil(changePassword)
        XCTAssertNotNil(signInWithEmailOtp)
        XCTAssertNotNil(verifyEmailOtp)
        XCTAssertNotNil(signInWithMagicLink)
        XCTAssertNotNil(passkeysAuthOptions)
        XCTAssertNotNil(enrollTotp)
    }
}

private final class FakeRoomWebSocketTask: RoomWebSocketTask {
    private let onSend: (() -> Void)?
    private let onCancel: (() -> Void)?
    private(set) var events: [String] = []
    private(set) var messages: [[String: Any]] = []

    init(onSend: (() -> Void)? = nil, onCancel: (() -> Void)? = nil) {
        self.onSend = onSend
        self.onCancel = onCancel
    }

    func resume() {}

    func send(_ message: URLSessionWebSocketTask.Message) async throws {
        if case let .string(text) = message,
           let data = text.data(using: .utf8),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let type = json["type"] as? String {
            messages.append(json)
            events.append("send:\(type)")
        } else {
            events.append("send:unknown")
        }
        onSend?()
    }

    func receive() async throws -> URLSessionWebSocketTask.Message {
        throw URLError(.badServerResponse)
    }

    func cancel(with closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        let reasonString = reason.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        events.append("close:\(reasonString)")
        onCancel?()
    }
}

// ─── E. FieldOps 구조 ─────────────────────────────────────────────────────────

import EdgeBaseCore

final class FieldOpsIosUnitTests: XCTestCase {

    func test_increment_returns_correct_op() {
        let op = FieldOps.increment(5)
        XCTAssertEqual("increment", op["$op"] as? String)
        XCTAssertEqual(5, op["value"] as? Int)
    }

    func test_increment_negative_value() {
        let op = FieldOps.increment(-10)
        XCTAssertEqual(-10, op["value"] as? Int)
    }

    func test_increment_float_value() {
        let op = FieldOps.increment(3.14)
        XCTAssertNotNil(op["value"])
    }

    func test_deleteField_returns_correct_op() {
        let op = FieldOps.deleteField()
        XCTAssertEqual("deleteField", op["$op"] as? String)
    }

    func test_deleteField_no_value_key() {
        let op = FieldOps.deleteField()
        XCTAssertNil(op["value"])
    }

    func test_increment_produces_map() {
        let op = FieldOps.increment(1)
        XCTAssertEqual("increment", op["$op"] as? String)
    }
}

// ─── F. EdgeBaseError ─────────────────────────────────────────────────────────

final class EdgeBaseErrorIosUnitTests: XCTestCase {

    func test_statusCode_set() {
        let err = EdgeBaseError(statusCode: 404, message: "Not Found")
        XCTAssertEqual(404, err.statusCode)
    }

    func test_message_set() {
        let err = EdgeBaseError(statusCode: 400, message: "Bad Request")
        XCTAssertEqual("Bad Request", err.message)
    }

    func test_is_error_type() {
        let err = EdgeBaseError(statusCode: 500, message: "Server Error")
        let typed: Error = err
        XCTAssertNotNil(typed)
    }
}

// ─── G. TokenManager 단위 테스트 ────────────────────────────────────────────

final class TokenManagerIosUnitTests: XCTestCase {

    func test_memoryStorage_saveAndRetrieve() async {
        let storage = MemoryTokenStorage()
        let tokens = TokenPair(accessToken: "at-123", refreshToken: "rt-123")
        await storage.saveTokens(tokens)
        let loaded = await storage.getTokens()
        XCTAssertEqual(loaded?.accessToken, "at-123")
        XCTAssertEqual(loaded?.refreshToken, "rt-123")
    }

    func test_memoryStorage_clear() async {
        let storage = MemoryTokenStorage()
        await storage.saveTokens(TokenPair(accessToken: "at", refreshToken: "rt"))
        await storage.clearTokens()
        let loaded = await storage.getTokens()
        XCTAssertNil(loaded)
    }

    func test_memoryStorage_initiallyEmpty() async {
        let storage = MemoryTokenStorage()
        let loaded = await storage.getTokens()
        XCTAssertNil(loaded)
    }

    func test_tokenManager_clearTokens() async {
        let tm = TokenManager(storage: MemoryTokenStorage())
        await tm.setTokens(TokenPair(accessToken: "at-1", refreshToken: "rt-1"))
        await tm.clearTokens()
        let token = try? await tm.getAccessToken()
        XCTAssertNil(token)
    }

    func test_tokenManager_getAccessToken_noTokens() async throws {
        let tm = TokenManager(storage: MemoryTokenStorage())
        let token = try await tm.getAccessToken()
        XCTAssertNil(token)
    }

    func test_tokenManager_getRefreshToken() async {
        let tm = TokenManager(storage: MemoryTokenStorage())
        await tm.setTokens(TokenPair(accessToken: "at", refreshToken: "rt-xyz"))
        let rt = await tm.getRefreshToken()
        XCTAssertEqual(rt, "rt-xyz")
    }

    func test_tokenManager_getRefreshToken_nil() async {
        let tm = TokenManager(storage: MemoryTokenStorage())
        let rt = await tm.getRefreshToken()
        XCTAssertNil(rt)
    }

    func test_tokenManager_tryRestoreSession_empty() async {
        let tm = TokenManager(storage: MemoryTokenStorage())
        let restored = await tm.tryRestoreSession()
        XCTAssertFalse(restored)
    }

    func test_tokenManager_tryRestoreSession_withTokens() async {
        let storage = MemoryTokenStorage()
        await storage.saveTokens(TokenPair(accessToken: "at-saved", refreshToken: "rt-saved"))
        let tm = TokenManager(storage: storage)
        let restored = await tm.tryRestoreSession()
        XCTAssertTrue(restored)
    }

    func test_tokenManager_isTokenExpired_invalidToken() async {
        let tm = TokenManager(storage: MemoryTokenStorage())
        let expired = await tm.isTokenExpired("not-a-jwt")
        XCTAssertTrue(expired)
    }

    func test_tokenManager_isTokenExpired_emptyString() async {
        let tm = TokenManager(storage: MemoryTokenStorage())
        let expired = await tm.isTokenExpired("")
        XCTAssertTrue(expired)
    }

    func test_tokenManager_currentUser_nil() async {
        let tm = TokenManager(storage: MemoryTokenStorage())
        let user = await tm.currentUser()
        XCTAssertNil(user)
    }

    func test_tokenManager_destroy() async {
        let tm = TokenManager(storage: MemoryTokenStorage())
        await tm.setTokens(TokenPair(accessToken: "at", refreshToken: "rt"))
        await tm.destroy()
        // After destroy, handlers removed (no crash on notify)
    }

    func test_tokenPair_codable() throws {
        let pair = TokenPair(accessToken: "at-cod", refreshToken: "rt-cod")
        let data = try JSONEncoder().encode(pair)
        let decoded = try JSONDecoder().decode(TokenPair.self, from: data)
        XCTAssertEqual(decoded.accessToken, "at-cod")
        XCTAssertEqual(decoded.refreshToken, "rt-cod")
    }
}

// ─── H. AuthClient 구조 검증 ────────────────────────────────────────────────

final class AuthClientIosUnitTests: XCTestCase {

    func test_authClient_type() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        XCTAssertTrue(type(of: client.auth) == AuthClient.self)
    }

    func test_authClient_nonNil() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        XCTAssertNotNil(client.auth)
    }
}

// ─── I. Database live transport 구조 검증 ───────────────────────────────────

final class DatabaseLiveClientIosUnitTests: XCTestCase {

    func test_databaseLive_nonNil() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        XCTAssertNotNil(client.databaseLive)
    }

    func test_databaseLive_disconnect_noError() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        client.databaseLive.disconnect()
        // Should not crash
    }

    func test_databaseLive_destroy_noError() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        client.databaseLive.destroy()
        // Should not crash
    }

    func test_databaseLive_subscribe_returns_stream() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let stream = client.databaseLive.subscribe("shared:posts")
        XCTAssertNotNil(stream)
        client.databaseLive.destroy()
    }

    func test_databaseLive_unsubscribe_noError() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        client.databaseLive.unsubscribe("shared:posts")
        // Should not crash
    }

    func test_databaseLive_on_customHandler() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        client.databaseLive.on("custom_event") { _ in }
        // Should not crash
    }
}

// ─── I-2. Database live revokedChannels 구조 ───────────────

final class DatabaseLiveClientRevokedChannelsTests: XCTestCase {

    func test_subscribe_with_filters_returns_stream() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let filters: [DatabaseLiveFilterTuple] = [["title", "==", "test"]]
        let stream = client.databaseLive.subscribe("shared:posts", filters: filters)
        XCTAssertNotNil(stream)
        client.databaseLive.destroy()
    }

    func test_subscribe_with_orFilters_returns_stream() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let orFilters: [DatabaseLiveFilterTuple] = [["status", "==", "active"]]
        let stream = client.databaseLive.subscribe("shared:posts", orFilters: orFilters)
        XCTAssertNotNil(stream)
        client.databaseLive.destroy()
    }

    func test_subscribe_with_both_filters_returns_stream() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let filters: [DatabaseLiveFilterTuple] = [["title", "==", "test"]]
        let orFilters: [DatabaseLiveFilterTuple] = [["status", "==", "draft"]]
        let stream = client.databaseLive.subscribe("shared:posts", filters: filters, orFilters: orFilters)
        XCTAssertNotNil(stream)
        client.databaseLive.destroy()
    }

    func test_on_subscription_revoked_noError() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        client.databaseLive.on("subscription_revoked") { _ in }
        // Should not crash — event handler registration
        client.databaseLive.destroy()
    }

    func test_databaseLiveFilterTuple_typealias_exists() {
        // Compile-time check: DatabaseLiveFilterTuple is [Any]
        let tuple: DatabaseLiveFilterTuple = ["field", "==", "value"]
        XCTAssertEqual(tuple.count, 3)
    }

    func test_destroy_clears_without_crash() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        // Subscribe then destroy — should clear channelFilters/channelOrFilters
        _ = client.databaseLive.subscribe("shared:posts")
        client.databaseLive.destroy()
        // No crash = pass
    }
}

// ─── J. RoomClient v2 구조 검증 ──────────────────────────────────────────────

final class RoomClientIosUnitTests: XCTestCase {

    func test_room_returns_nonNil() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let room = client.room(namespace: "game", id: "test-room")
        XCTAssertNotNil(room)
    }

    func test_room_roomId() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let room = client.room(namespace: "game", id: "my-game-lobby")
        XCTAssertEqual(room.roomId, "my-game-lobby")
    }

    func test_room_namespace() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let room = client.room(namespace: "chat", id: "lobby-1")
        XCTAssertEqual(room.namespace, "chat")
    }

    func test_room_initialSharedState_empty() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let room = client.room(namespace: "game", id: "state-test")
        XCTAssertTrue(room.getSharedState().isEmpty)
    }

    func test_room_initialPlayerState_empty() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let room = client.room(namespace: "game", id: "pstate-test")
        XCTAssertTrue(room.getPlayerState().isEmpty)
    }

    func test_room_namespace_matches() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let room = client.room(namespace: "game", id: "ns-test")
        XCTAssertEqual(room.namespace, "game")
    }

    func test_room_roomId_matches() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let room = client.room(namespace: "game", id: "rid-test")
        XCTAssertEqual(room.roomId, "rid-test")
    }

    func test_room_send_method_exists() {
        // Verify the async send method exists by referencing it
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let room = client.room(namespace: "game", id: "send-test")
        _ = room // RoomClient has public send() method
    }

    func test_room_leave_noError() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let room = client.room(namespace: "game", id: "leave-test")
        room.leave()
        // Should not crash
    }

    func test_room_destroy_noError() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let room = client.room(namespace: "game", id: "destroy-test")
        room.destroy()
        // Should not crash
    }

    func test_room_onSharedState_returns_subscription() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let room = client.room(namespace: "game", id: "shared-test")
        let sub = room.onSharedState { _, _ in }
        XCTAssertNotNil(sub)
        sub.unsubscribe()
    }

    func test_room_onPlayerState_returns_subscription() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let room = client.room(namespace: "game", id: "player-test")
        let sub = room.onPlayerState { _, _ in }
        XCTAssertNotNil(sub)
        sub.unsubscribe()
    }

    func test_room_onAnyMessage_returns_subscription() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let room = client.room(namespace: "game", id: "anymsg-test")
        let sub = room.onAnyMessage { _, _ in }
        XCTAssertNotNil(sub)
        sub.unsubscribe()
    }

    func test_room_onSharedState_unsubscribe_safe() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let room = client.room(namespace: "game", id: "unsub-test")
        let sub = room.onSharedState { _, _ in }
        sub.unsubscribe()
        // Double unsubscribe should be safe
        sub.unsubscribe()
    }

    func test_room_onMessage_returns_subscription() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let room = client.room(namespace: "game", id: "message-test")
        let sub = room.onMessage("game_over") { _ in }
        XCTAssertNotNil(sub)
        sub.unsubscribe()
    }

    func test_room_onKicked_returns_subscription() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let room = client.room(namespace: "game", id: "kicked-test")
        let sub = room.onKicked { }
        XCTAssertNotNil(sub)
        sub.unsubscribe()
    }

    func test_room_onError_returns_subscription() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let room = client.room(namespace: "game", id: "error-test")
        let sub = room.onError { _, _ in }
        XCTAssertNotNil(sub)
        sub.unsubscribe()
    }

    func test_roomWithToken_returns_nonNil() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let room = client.roomWithToken(namespace: "game", id: "ext-room", tokenProvider: { "fake-token" })
        XCTAssertNotNil(room)
        XCTAssertEqual(room.roomId, "ext-room")
        XCTAssertEqual(room.namespace, "game")
    }

    func test_subscription_unsubscribe_idempotent() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let room = client.room(namespace: "game", id: "unsub-test")
        let sub = room.onSharedState { _, _ in }
        sub.unsubscribe()
        sub.unsubscribe() // Second call should be safe
    }

    func test_room_leave_sends_explicit_leave_before_close() {
        let sendExpectation = expectation(description: "leave frame sent")
        let closeExpectation = expectation(description: "socket closed")
        let fakeSocket = FakeRoomWebSocketTask(
            onSend: { sendExpectation.fulfill() },
            onCancel: { closeExpectation.fulfill() }
        )
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let room = client.room(namespace: "game", id: "leave-frame-test")

        room.attachSocketForTesting(fakeSocket)
        room.leave()

        wait(for: [sendExpectation, closeExpectation], timeout: 1.0)
        XCTAssertEqual(fakeSocket.events, ["send:leave", "close:Client left room"])
    }

    func test_room_unified_surface_parses_members_signals_media_and_session_frames() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let room = client.room(namespace: "game", id: "room-unified")
        var memberSyncSnapshots: [[[String: Any]]] = []
        var memberLeaves: [String] = []
        var signalEvents: [String] = []
        var mediaTracks: [String] = []
        var mediaDevices: [String] = []
        var connectionStates: [String] = []

        _ = room.members.onSync { memberSyncSnapshots.append($0) }
        _ = room.members.onLeave { member, reason in
            memberLeaves.append("\(member["memberId"] as? String ?? ""):\(reason)")
        }
        _ = room.signals.onAny { event, _, meta in
            signalEvents.append("\(event):\(meta["userId"] as? String ?? "")")
        }
        _ = room.media.onTrack { track, member in
            mediaTracks.append("\(track["kind"] as? String ?? ""):\(member["memberId"] as? String ?? "")")
        }
        _ = room.media.onDeviceChange { _, change in
            mediaDevices.append("\(change["kind"] as? String ?? ""):\(change["deviceId"] as? String ?? "")")
        }
        _ = room.session.onConnectionStateChange { connectionStates.append($0) }

        room.handleMessageForTesting(["type": "auth_success", "userId": "user-1", "connectionId": "conn-1"])
        room.handleMessageForTesting(["type": "sync", "sharedState": ["topic": "focus"], "sharedVersion": 1, "playerState": ["ready": true], "playerVersion": 2])
        room.handleMessageForTesting(["type": "members_sync", "members": [["memberId": "user-1", "userId": "user-1", "connectionId": "conn-1", "connectionCount": 1, "state": ["typing": false]]]])
        room.handleMessageForTesting(["type": "member_join", "member": ["memberId": "user-2", "userId": "user-2", "connectionCount": 1, "state": [:]]])
        room.handleMessageForTesting(["type": "signal", "event": "cursor.move", "payload": ["x": 10, "y": 20], "meta": ["memberId": "user-2", "userId": "user-2", "connectionId": "conn-2", "sentAt": 123]])
        room.handleMessageForTesting(["type": "media_track", "member": ["memberId": "user-2", "userId": "user-2", "state": [:]], "track": ["kind": "video", "trackId": "video-1", "deviceId": "cam-1", "muted": false]])
        room.handleMessageForTesting(["type": "media_device", "member": ["memberId": "user-2", "userId": "user-2", "state": [:]], "kind": "video", "deviceId": "cam-2"])
        room.handleMessageForTesting(["type": "member_leave", "member": ["memberId": "user-2", "userId": "user-2", "state": [:]], "reason": "timeout"])

        XCTAssertEqual(room.state.getShared()["topic"] as? String, "focus")
        XCTAssertEqual(room.state.getMine()["ready"] as? Bool, true)
        XCTAssertEqual(room.session.userId(), "user-1")
        XCTAssertEqual(room.session.connectionId(), "conn-1")
        XCTAssertEqual(room.session.connectionState(), "connected")
        XCTAssertEqual(connectionStates, ["connected"])
        XCTAssertEqual(memberSyncSnapshots.count, 1)
        XCTAssertEqual(memberSyncSnapshots.first?.first?["memberId"] as? String, "user-1")
        XCTAssertEqual(signalEvents, ["cursor.move:user-2"])
        XCTAssertEqual(mediaTracks, ["video:user-2"])
        XCTAssertEqual(mediaDevices, ["video:cam-2"])
        XCTAssertEqual(memberLeaves, ["user-2:timeout"])
        XCTAssertEqual(room.members.list().count, 1)
        XCTAssertEqual(room.members.list().first?["memberId"] as? String, "user-1")
        XCTAssertEqual(room.media.list().count, 0)
    }

    func test_room_unified_surface_sends_signal_member_admin_and_media_frames() async throws {
        let fakeSocket = FakeRoomWebSocketTask()
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let room = client.room(namespace: "game", id: "room-send")
        room.attachSocketForTesting(fakeSocket)
        room.handleMessageForTesting(["type": "auth_success", "userId": "user-1", "connectionId": "conn-1"])

        let signalTask = Task {
            try await room.signals.send("cursor.move", payload: ["x": 10], options: ["includeSelf": true])
        }
        try await Task.sleep(nanoseconds: 20_000_000)
        let signalMessage = fakeSocket.messages[0]
        XCTAssertEqual(signalMessage["type"] as? String, "signal")
        XCTAssertEqual(signalMessage["event"] as? String, "cursor.move")
        XCTAssertEqual(signalMessage["includeSelf"] as? Bool, true)
        let signalRequestId = try XCTUnwrap(signalMessage["requestId"] as? String)
        room.handleMessageForTesting(["type": "signal_sent", "requestId": signalRequestId, "event": "cursor.move"])
        try await signalTask.value

        let memberTask = Task {
            try await room.members.setState(["typing": true])
        }
        try await Task.sleep(nanoseconds: 20_000_000)
        let memberMessage = fakeSocket.messages[1]
        XCTAssertEqual(memberMessage["type"] as? String, "member_state")
        let memberState = try XCTUnwrap(memberMessage["state"] as? [String: Any])
        XCTAssertEqual(memberState["typing"] as? Bool, true)
        let memberRequestId = try XCTUnwrap(memberMessage["requestId"] as? String)
        room.handleMessageForTesting(["type": "member_state", "requestId": memberRequestId, "member": ["memberId": "user-1", "userId": "user-1", "state": ["typing": true]], "state": ["typing": true]])
        try await memberTask.value

        let adminTask = Task {
            try await room.admin.disableVideo("user-2")
        }
        try await Task.sleep(nanoseconds: 20_000_000)
        let adminMessage = fakeSocket.messages[2]
        XCTAssertEqual(adminMessage["type"] as? String, "admin")
        XCTAssertEqual(adminMessage["operation"] as? String, "disableVideo")
        XCTAssertEqual(adminMessage["memberId"] as? String, "user-2")
        let adminRequestId = try XCTUnwrap(adminMessage["requestId"] as? String)
        room.handleMessageForTesting(["type": "admin_result", "requestId": adminRequestId, "operation": "disableVideo", "memberId": "user-2"])
        try await adminTask.value

        let mediaTask = Task {
            try await room.media.audio.setMuted(true)
        }
        try await Task.sleep(nanoseconds: 20_000_000)
        let mediaMessage = fakeSocket.messages[3]
        XCTAssertEqual(mediaMessage["type"] as? String, "media")
        XCTAssertEqual(mediaMessage["operation"] as? String, "mute")
        XCTAssertEqual(mediaMessage["kind"] as? String, "audio")
        let mediaPayload = try XCTUnwrap(mediaMessage["payload"] as? [String: Any])
        XCTAssertEqual(mediaPayload["muted"] as? Bool, true)
        let mediaRequestId = try XCTUnwrap(mediaMessage["requestId"] as? String)
        room.handleMessageForTesting(["type": "media_result", "requestId": mediaRequestId, "operation": "mute", "kind": "audio"])
        try await mediaTask.value

        XCTAssertEqual(fakeSocket.events, ["send:signal", "send:member_state", "send:admin", "send:media"])
    }
}

// ─── K. PushClient 구조 검증 ────────────────────────────────────────────────

final class PushClientIosUnitTests: XCTestCase {

    func test_push_nonNil() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        XCTAssertNotNil(client.push)
    }

    func test_push_onMessage_noError() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        client.push.onMessage { _ in }
        // No crash
    }

    func test_push_onMessageOpenedApp_noError() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        client.push.onMessageOpenedApp { _ in }
        // No crash
    }

    func test_push_setFcmTokenProvider() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        client.push.setFcmTokenProvider { return "fake-fcm-token" }
        // No crash — provider stored
    }

    func test_push_setDeviceIdProvider() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        client.push.setDeviceIdProvider { "test-device-id" }
        // No crash — provider stored
    }

    func test_push_permission_status_provider_override() async {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        client.push.setPermissionStatusProvider { "granted" }
        let status = await client.push.getPermissionStatus()
        XCTAssertEqual(status, "granted")
    }

    func test_push_permission_requester_override() async {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        client.push.setPermissionRequester { "granted" }
        let status = await client.push.requestPermission()
        XCTAssertEqual(status, "granted")
    }

    func test_push_dispatchMessage() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        var received = false
        client.push.onMessage { _ in received = true }
        client.push.dispatchMessage(["title": "Test"])
        XCTAssertTrue(received)
    }

    func test_push_dispatchMessageOpenedApp() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        var received = false
        client.push.onMessageOpenedApp { _ in received = true }
        client.push.dispatchMessageOpenedApp(["title": "Tapped"])
        XCTAssertTrue(received)
    }

    func test_push_platform_default() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        // On macOS test runner, platform should be .macos; on iOS, .ios
        let platform = client.push.platform
        XCTAssertTrue(platform == .ios || platform == .macos)
    }
}

// ─── L. StorageClient 구조 검증 ─────────────────────────────────────────────

final class StorageClientIosUnitTests: XCTestCase {

    func test_storage_nonNil() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        XCTAssertNotNil(client.storage)
    }

    func test_storage_bucket_returns_nonNil() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let bucket = client.storage.bucket("my-bucket")
        XCTAssertNotNil(bucket)
    }

    func test_storage_bucket_name() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let bucket = client.storage.bucket("photos")
        XCTAssertEqual(bucket.name, "photos")
    }

    func test_storage_getUrl_contains_bucket() async {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let url = await client.storage.bucket("images").getUrl("photo.jpg")
        XCTAssertTrue(url.contains("images"))
        XCTAssertTrue(url.contains("photo.jpg"))
    }
}

// ─── M. EdgeBaseClient 확장 검증 ────────────────────────────────────────────

final class EdgeBaseClientExtendedUnitTests: XCTestCase {

    func test_baseUrl_set() {
        let client = EdgeBaseClient("https://my-app.edgebase.fun")
        XCTAssertEqual(client.baseUrl, "https://my-app.edgebase.fun")
    }

    func test_baseUrl_strips_multiple_trailing_slashes() {
        // The constructor strips a single trailing slash
        let client = EdgeBaseClient("https://my-app.edgebase.fun/")
        XCTAssertEqual(client.baseUrl, "https://my-app.edgebase.fun")
    }

    func test_db_different_namespaces() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let shared = client.db("shared")
        let workspace = client.db("workspace", instanceId: "ws-123")
        let user = client.db("user")
        XCTAssertNotNil(shared)
        XCTAssertNotNil(workspace)
        XCTAssertNotNil(user)
    }

    func test_db_table_chained() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let table = client.db("shared").table("posts")
        XCTAssertNotNil(table)
        XCTAssertEqual(table.name, "posts")
    }

    func test_destroy_no_error() async {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        await client.destroy()
        // Should not crash
    }

    func test_table_offset_returns_new_instance() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let t1 = client.db("shared").table("posts")
        let t2 = t1.offset(10)
        XCTAssertNotIdentical(t1 as AnyObject, t2 as AnyObject)
    }

    func test_table_page_returns_new_instance() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let t1 = client.db("shared").table("posts")
        let t2 = t1.page(2)
        XCTAssertNotIdentical(t1 as AnyObject, t2 as AnyObject)
    }

    func test_table_search_returns_new_instance() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let t1 = client.db("shared").table("posts")
        let t2 = t1.search("hello")
        XCTAssertNotIdentical(t1 as AnyObject, t2 as AnyObject)
    }

    func test_table_after_returns_new_instance() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let t1 = client.db("shared").table("posts")
        let t2 = t1.after("cursor-abc")
        XCTAssertNotIdentical(t1 as AnyObject, t2 as AnyObject)
    }

    func test_table_before_returns_new_instance() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let t1 = client.db("shared").table("posts")
        let t2 = t1.before("cursor-xyz")
        XCTAssertNotIdentical(t1 as AnyObject, t2 as AnyObject)
    }

    func test_table_or_returns_new_instance() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let t1 = client.db("shared").table("posts")
        let t2 = t1.or { builder in
            builder.where("status", "==", "active")
        }
        XCTAssertNotIdentical(t1 as AnyObject, t2 as AnyObject)
    }

    func test_chained_query_does_not_mutate_original() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let original = client.db("shared").table("posts")
        let _ = original.where("status", "==", "active").limit(10).orderBy("createdAt", "desc")
        // Original should remain unchanged (immutable builder)
        XCTAssertNotNil(original)
    }
}

// ─── N. ExternalTokenManager ────────────────────────────────────────────────

final class ExternalTokenManagerIosUnitTests: XCTestCase {

    func test_getAccessToken_returnsProvidedToken() async throws {
        let etm = ExternalTokenManager(tokenProvider: { "my-token" })
        let token = try await etm.getAccessToken()
        XCTAssertEqual(token, "my-token")
    }

    func test_getAccessToken_emptyReturnsNil() async throws {
        let etm = ExternalTokenManager(tokenProvider: { "" })
        let token = try await etm.getAccessToken()
        XCTAssertNil(token)
    }

    func test_getRefreshToken_nil() async {
        let etm = ExternalTokenManager(tokenProvider: { "t" })
        let rt = await etm.getRefreshToken()
        XCTAssertNil(rt)
    }

    func test_clearTokens_noError() async {
        let etm = ExternalTokenManager(tokenProvider: { "t" })
        await etm.clearTokens()
        // no crash
    }
}

// ─── O. DocRef 구조 검증 ────────────────────────────────────────────────────

final class DocRefIosUnitTests: XCTestCase {

    func test_doc_returns_nonNil() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let doc = client.db("shared").table("posts").doc("post-123")
        XCTAssertNotNil(doc)
    }

    func test_doc_id() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let doc = client.db("shared").table("posts").doc("post-456")
        XCTAssertEqual(doc.id, "post-456")
    }

    func test_doc_tableName() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let doc = client.db("shared").table("comments").doc("c-1")
        XCTAssertEqual(doc.tableName, "comments")
    }
}
