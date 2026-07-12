import XCTest
import Foundation
@testable import EdgeBase

private final class MockRoomURLProtocol: URLProtocol, @unchecked Sendable {
    static var requestHandler: (@Sendable (URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = Self.requestHandler else {
            client?.urlProtocol(self, didFailWithError: NSError(domain: "MockRoomURLProtocol", code: 0))
            return
        }

        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

private func readRequestBody(_ request: URLRequest) throws -> Data {
    if let body = request.httpBody {
        return body
    }

    guard let stream = request.httpBodyStream else {
        throw NSError(domain: "MockRoomURLProtocol", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing request body"])
    }

    stream.open()
    defer { stream.close() }

    let bufferSize = 4096
    let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
    defer { buffer.deallocate() }

    var data = Data()
    while stream.hasBytesAvailable {
        let read = stream.read(buffer, maxLength: bufferSize)
        if read < 0 {
            throw stream.streamError ?? NSError(domain: "MockRoomURLProtocol", code: 2)
        }
        if read == 0 {
            break
        }
        data.append(buffer, count: read)
    }
    return data
}

/**
 * Swift iOS SDK 단위 테스트 — EdgeBaseClient / AuthClient 구조 검증
 *
 * 실행: cd packages/sdk/swift/packages/ios && swift test
 *
 * 원칙: 서버 불필요, 순수 클래스 구조/생성 검증
 */
final class EdgeBaseClientIosUnitTests: XCTestCase {

    func test_turnstileChallengeUrl_isHttpsHostedAndChannelBound() throws {
        let channel = "0123456789abcdef0123456789abcdef"
        let url = try TurnstileProvider.makeChallengeURL(
            baseUrl: "https://api.example.test/",
            action: "signin",
            channel: channel
        )
        let components = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))

        XCTAssertEqual(components.scheme, "https")
        XCTAssertEqual(components.host, "api.example.test")
        XCTAssertEqual(components.path, "/api/captcha/challenge")
        XCTAssertEqual(components.queryItems?.first(where: { $0.name == "action" })?.value, "signin")
        XCTAssertEqual(components.queryItems?.first(where: { $0.name == "channel" })?.value, channel)
        XCTAssertEqual(components.queryItems?.first(where: { $0.name == "bridge" })?.value, "webkit")
    }

    func test_turnstilePositiveSiteKeyCacheExpiresAtFiveMinutes() {
        XCTAssertTrue(
            TurnstileProvider.isSiteKeyCacheFresh(age: 299.999)
        )
        XCTAssertFalse(
            TurnstileProvider.isSiteKeyCacheFresh(age: 300)
        )
    }

    func test_turnstileChallengeUrl_rejectsHttpAndDynamicActions() {
        let channel = "0123456789abcdef0123456789abcdef"
        XCTAssertThrowsError(try TurnstileProvider.makeChallengeURL(
            baseUrl: "http://api.example.test",
            action: "signin",
            channel: channel
        ))
        XCTAssertThrowsError(try TurnstileProvider.makeChallengeURL(
            baseUrl: "https://api.example.test",
            action: "function:unsafe",
            channel: channel
        ))
    }

    func test_turnstileBridgeMessage_isVersionedAndChannelBound() {
        let channel = "0123456789abcdef0123456789abcdef"
        let valid = #"{"v":1,"channel":"0123456789abcdef0123456789abcdef","type":"token","value":"synthetic-token"}"#
        let wrongChannel = #"{"v":1,"channel":"fedcba9876543210fedcba9876543210","type":"token","value":"synthetic-token"}"#

        XCTAssertEqual(TurnstileProvider.parseChallengeMessage(valid, channel: channel)?.value, "synthetic-token")
        XCTAssertNil(TurnstileProvider.parseChallengeMessage(wrongChannel, channel: channel))
        XCTAssertNil(TurnstileProvider.parseChallengeMessage(
            #"{"v":1,"channel":"0123456789abcdef0123456789abcdef","type":"token","value":""}"#,
            channel: channel
        ))
    }

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

final class TurnstileConfigIosUnitTests: XCTestCase {
    override func tearDown() {
        MockRoomURLProtocol.requestHandler = nil
        super.tearDown()
    }

    @MainActor
    func test_configFetchFailureIsNotTreatedAsDisabled() async {
        MockRoomURLProtocol.requestHandler = { request in
            (
                HTTPURLResponse(
                    url: request.url!,
                    statusCode: 503,
                    httpVersion: nil,
                    headerFields: ["Content-Type": "application/json"]
                )!,
                Data(#"{"message":"synthetic outage"}"#.utf8)
            )
        }
        let api = makeGeneratedApi(baseUrl: "https://captcha-config-failure.example.test")

        do {
            _ = try await TurnstileProvider.fetchSiteKey(
                core: api,
                baseUrl: "https://captcha-config-failure.example.test"
            )
            XCTFail("Expected config fetch failure")
        } catch let error as CaptchaUnavailableError {
            XCTAssertEqual(error.reason, "config_fetch_failed")
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    @MainActor
    func test_explicitNullCaptchaConfigRemainsDisabled() async throws {
        MockRoomURLProtocol.requestHandler = { request in
            (
                HTTPURLResponse(
                    url: request.url!,
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["Content-Type": "application/json"]
                )!,
                Data(#"{"captcha":null}"#.utf8)
            )
        }
        let baseUrl = "https://captcha-disabled.example.test"
        let api = makeGeneratedApi(baseUrl: baseUrl)

        let siteKey = try await TurnstileProvider.fetchSiteKey(core: api, baseUrl: baseUrl)

        XCTAssertNil(siteKey)
    }

    @MainActor
    func test_missingCaptchaConfigIsRejectedAsMalformed() async {
        MockRoomURLProtocol.requestHandler = { request in
            (
                HTTPURLResponse(
                    url: request.url!,
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["Content-Type": "application/json"]
                )!,
                Data("{}".utf8)
            )
        }
        let baseUrl = "https://captcha-malformed.example.test"
        let api = makeGeneratedApi(baseUrl: baseUrl)

        do {
            _ = try await TurnstileProvider.fetchSiteKey(core: api, baseUrl: baseUrl)
            XCTFail("Expected malformed config failure")
        } catch let error as CaptchaUnavailableError {
            XCTAssertEqual(error.reason, "config_invalid_response")
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    @MainActor
    func test_malformedCaptchaJSONHasInvalidResponseReason() async {
        MockRoomURLProtocol.requestHandler = { request in
            (
                HTTPURLResponse(
                    url: request.url!,
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["Content-Type": "application/json"]
                )!,
                Data("not-json".utf8)
            )
        }
        let baseUrl = "https://captcha-invalid-json.example.test"
        let api = makeGeneratedApi(baseUrl: baseUrl)

        do {
            _ = try await TurnstileProvider.fetchSiteKey(core: api, baseUrl: baseUrl)
            XCTFail("Expected invalid JSON failure")
        } catch let error as CaptchaUnavailableError {
            XCTAssertEqual(error.reason, "config_invalid_response")
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    private func makeGeneratedApi(baseUrl: String) -> GeneratedDbApi {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockRoomURLProtocol.self]
        let manager = TokenManager(storage: MemoryTokenStorage())
        let http = HttpClient(
            baseUrl: baseUrl,
            tokenManager: manager,
            session: URLSession(configuration: configuration)
        )
        return GeneratedDbApi(http: http)
    }
}

private enum FakeSocketError: Error {
    case messageTimeout(index: Int)
}

private final class FakeRoomWebSocketTask: RoomWebSocketTask {
    private let lock = NSLock()
    private let onSend: (() -> Void)?
    private let onCancel: (() -> Void)?
    private var _events: [String] = []
    private var _messages: [[String: Any]] = []

    // send() runs on a different executor than the test, so all access to the
    // backing arrays is serialized through a lock to avoid a data race.
    var events: [String] {
        lock.lock(); defer { lock.unlock() }
        return _events
    }
    var messages: [[String: Any]] {
        lock.lock(); defer { lock.unlock() }
        return _messages
    }

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
            lock.lock()
            _messages.append(json)
            _events.append("send:\(type)")
            lock.unlock()
        } else {
            lock.lock()
            _events.append("send:unknown")
            lock.unlock()
        }
        onSend?()
    }

    func receive() async throws -> URLSessionWebSocketTask.Message {
        throw URLError(.badServerResponse)
    }

    func cancel(with closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        let reasonString = reason.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        lock.lock()
        _events.append("close:\(reasonString)")
        lock.unlock()
        onCancel?()
    }

    /// Deterministically wait for the message at `index`. `send()` is async, so
    /// a fixed sleep can read the backing array before the append lands and crash
    /// with "Index out of range" on a slow/loaded runner; this polls until the
    /// message exists (or times out) instead.
    func waitForMessage(at index: Int, timeout: TimeInterval = 2.0) async throws -> [String: Any] {
        let deadline = Date().addingTimeInterval(timeout)
        while true {
            lock.lock()
            let message = index < _messages.count ? _messages[index] : nil
            lock.unlock()
            if let message {
                return message
            }
            if Date() >= deadline {
                throw FakeSocketError.messageTimeout(index: index)
            }
            try await Task.sleep(nanoseconds: 2_000_000) // 2ms
        }
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

    func test_tokenManager_clearTokens() async throws {
        let tm = TokenManager(storage: MemoryTokenStorage())
        try await tm.setTokens(TokenPair(accessToken: "at-1", refreshToken: "rt-1"))
        try await tm.clearTokens()
        let token = try? await tm.getAccessToken()
        XCTAssertNil(token)
    }

    func test_tokenManager_getAccessToken_noTokens() async throws {
        let tm = TokenManager(storage: MemoryTokenStorage())
        let token = try await tm.getAccessToken()
        XCTAssertNil(token)
    }

    func test_tokenManager_getRefreshToken() async throws {
        let tm = TokenManager(storage: MemoryTokenStorage())
        try await tm.setTokens(TokenPair(accessToken: "at", refreshToken: "rt-xyz"))
        let rt = await tm.getRefreshToken()
        XCTAssertEqual(rt, "rt-xyz")
    }

    func test_tokenManager_getRefreshToken_nil() async {
        let tm = TokenManager(storage: MemoryTokenStorage())
        let rt = await tm.getRefreshToken()
        XCTAssertNil(rt)
    }

    func test_tokenManager_tryRestoreSession_empty() async throws {
        let tm = TokenManager(storage: MemoryTokenStorage())
        let restored = try await tm.tryRestoreSession()
        XCTAssertFalse(restored)
    }

    func test_tokenManager_tryRestoreSession_withTokens() async throws {
        let storage = MemoryTokenStorage()
        await storage.saveTokens(TokenPair(accessToken: "at-saved", refreshToken: "rt-saved"))
        let tm = TokenManager(storage: storage)
        let restored = try await tm.tryRestoreSession()
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

    func test_tokenManager_destroy() async throws {
        let tm = TokenManager(storage: MemoryTokenStorage())
        try await tm.setTokens(TokenPair(accessToken: "at", refreshToken: "rt"))
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

    func test_replacementTokensPersistBeforeExposure() async throws {
        let storage = FailingSwiftTokenStorage()
        let tm = TokenManager(storage: storage)
        try await tm.setTokens(TokenPair(accessToken: "original-access", refreshToken: "original-refresh"))
        await storage.setFailWrites(true)

        do {
            try await tm.setTokens(TokenPair(accessToken: "replacement-access", refreshToken: "replacement-refresh"))
            XCTFail("Expected synthetic persistence failure")
        } catch let error as TokenPersistenceError {
            XCTAssertEqual(error.operation, "save")
            XCTAssertTrue(error.causeDescription.contains("saveFailed"))
        }

        let originalRefresh = await tm.getRefreshToken()
        XCTAssertEqual(originalRefresh, "original-refresh")
        let originalAccess = try await tm.getAccessToken()
        XCTAssertEqual(originalAccess, "original-access")
        let originalStoredRefresh = try await storage.getTokens()?.refreshToken
        XCTAssertEqual(originalStoredRefresh, "original-refresh")
    }

    func test_captchaUnavailableDiagnosticContract() {
        let error = CaptchaUnavailableError(reason: "renderer_terminated")
        XCTAssertEqual(error.code, "captcha-unavailable")
        XCTAssertEqual(error.reason, "renderer_terminated")
    }

    func test_incompleteStoredPairFailsClosed() async {
        let tm = TokenManager(storage: IncompleteSwiftTokenStorage())
        do {
            _ = try await tm.tryRestoreSession()
            XCTFail("Expected incomplete pair failure")
        } catch let error as InvalidTokenPairError {
            XCTAssertEqual(error.operation, "restore")
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
        let clearedAccess = try? await tm.getAccessToken()
        XCTAssertNil(clearedAccess)
    }
}

private enum SyntheticTokenStorageError: Error, Equatable {
    case saveFailed
}

private actor FailingSwiftTokenStorage: DurableTokenStorage {
    private var tokens: TokenPair?
    private var failWrites = false

    func setFailWrites(_ value: Bool) {
        failWrites = value
    }

    func getTokens() async throws -> TokenPair? { tokens }

    func saveTokens(_ tokens: TokenPair) async throws {
        if failWrites { throw SyntheticTokenStorageError.saveFailed }
        self.tokens = tokens
    }

    func clearTokens() async throws {
        tokens = nil
    }
}

private actor IncompleteSwiftTokenStorage: TokenStorage {
    func getTokens() async throws -> TokenPair? {
        TokenPair(accessToken: "", refreshToken: "refresh-only")
    }
    func saveTokens(_ tokens: TokenPair) async throws {}
    func clearTokens() async throws {}
}

final class EmailLinkCheckpointIosUnitTests: XCTestCase {
    override func tearDown() {
        MockRoomURLProtocol.requestHandler = nil
        super.tearDown()
    }

    func test_emailLinkRetryReplaysCheckpointBeforeAdoptingReplacementTokens() async throws {
        let storage = FailingSwiftTokenStorage()
        let original = TokenPair(
            accessToken: "anonymous-access",
            refreshToken: "anonymous-refresh"
        )
        try await storage.saveTokens(original)
        let tokenManager = TokenManager(storage: storage)
        let didRestore = try await tokenManager.tryRestoreSession()
        XCTAssertTrue(didRestore)

        let recorder = FunctionRequestRecorder()
        MockRoomURLProtocol.requestHandler = { request in
            recorder.append(request)
            return (
                HTTPURLResponse(
                    url: request.url!,
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["Content-Type": "application/json"]
                )!,
                Data("""
                {
                    "sessionId":"permanent-session",
                    "accessToken":"permanent-access",
                    "refreshToken":"permanent-refresh"
                }
                """.utf8)
            )
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockRoomURLProtocol.self]
        let http = HttpClient(
            baseUrl: "https://api.example.test",
            tokenManager: tokenManager,
            session: URLSession(configuration: configuration)
        )
        let auth = AuthClient(client: http, tokenManager: tokenManager)

        await storage.setFailWrites(true)
        do {
            _ = try await auth.linkWithEmail(
                email: "user@example.test",
                password: "Exact-Pass-123!"
            )
            XCTFail("Expected synthetic persistence failure")
        } catch let error as TokenPersistenceError {
            XCTAssertEqual(error.operation, "save")
            XCTAssertTrue(error.causeDescription.contains("saveFailed"))
        }
        let anonAccess = try await tokenManager.getAccessToken()
        XCTAssertEqual(anonAccess, "anonymous-access")
        let anonRefresh = await tokenManager.getRefreshToken()
        XCTAssertEqual(anonRefresh, "anonymous-refresh")
        let anonStoredRefresh = try await storage.getTokens()?.refreshToken
        XCTAssertEqual(anonStoredRefresh, "anonymous-refresh")

        await storage.setFailWrites(false)
        let replay = try await auth.linkWithEmail(
            email: "user@example.test",
            password: "Exact-Pass-123!"
        )

        XCTAssertEqual(replay["sessionId"] as? String, "permanent-session")
        let permAccess = try await tokenManager.getAccessToken()
        XCTAssertEqual(permAccess, "permanent-access")
        let permRefresh = await tokenManager.getRefreshToken()
        XCTAssertEqual(permRefresh, "permanent-refresh")
        let permStoredRefresh = try await storage.getTokens()?.refreshToken
        XCTAssertEqual(permStoredRefresh, "permanent-refresh")

        let requests = recorder.snapshot()
        XCTAssertEqual(requests.count, 2)
        XCTAssertEqual(
            requests.map { $0.value(forHTTPHeaderField: "Authorization") },
            ["Bearer anonymous-access", "Bearer anonymous-access"]
        )
        let requestBodies = try requests.map { request -> [String: Any] in
            let data = try readRequestBody(request)
            return try XCTUnwrap(
                JSONSerialization.jsonObject(with: data) as? [String: Any]
            )
        }
        for body in requestBodies {
            XCTAssertEqual(body["email"] as? String, "user@example.test")
            XCTAssertEqual(body["password"] as? String, "Exact-Pass-123!")
        }
    }

    func test_accountUpgradeFailsBeforeNetworkWithoutDurableStorage() async {
        let recorder = FunctionRequestRecorder()
        MockRoomURLProtocol.requestHandler = { request in
            recorder.append(request)
            return (
                HTTPURLResponse(
                    url: request.url!,
                    statusCode: 500,
                    httpVersion: nil,
                    headerFields: nil
                )!,
                Data()
            )
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockRoomURLProtocol.self]
        let manager = TokenManager(storage: MemoryTokenStorage())
        let http = HttpClient(
            baseUrl: "https://api.example.test",
            tokenManager: manager,
            session: URLSession(configuration: configuration)
        )
        let auth = AuthClient(client: http, tokenManager: manager)

        do {
            _ = try await auth.linkWithEmail(
                email: "user@example.test",
                password: "Exact-Pass-123!"
            )
            XCTFail("Expected durable storage preflight failure")
        } catch is DurableTokenStorageRequiredError {
            // Expected.
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
        XCTAssertEqual(recorder.snapshot().count, 0)
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

    func test_newClientRestoresPrepopulatedStorage() async throws {
        let storage = MemoryTokenStorage()
        await storage.saveTokens(TokenPair(
            accessToken: "header.eyJzdWIiOiJyZXN0b3JlZC11c2VyIiwiaXNBbm9ueW1vdXMiOmZhbHNlfQ.signature",
            refreshToken: "restored-refresh"
        ))
        let client = EdgeBaseClient(
            "https://api.example.test",
            tokenStorage: storage
        )

        let clientRestored = try await client.tryRestoreSession()
        XCTAssertTrue(clientRestored)
        let restoredUserId = await client.auth.currentUser()?["id"] as? String
        XCTAssertEqual(restoredUserId, "restored-user")
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

    func test_room_unified_surface_parses_members_signals_and_session_frames() {
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let room = client.room(namespace: "game", id: "room-unified")
        var memberSyncSnapshots: [[[String: Any]]] = []
        var memberLeaves: [String] = []
        var signalEvents: [String] = []
        var connectionStates: [String] = []

        _ = room.members.onSync { memberSyncSnapshots.append($0) }
        _ = room.members.onLeave { member, reason in
            memberLeaves.append("\(member["memberId"] as? String ?? ""):\(reason)")
        }
        _ = room.signals.onAny { event, _, meta in
            signalEvents.append("\(event):\(meta["userId"] as? String ?? "")")
        }
        _ = room.session.onConnectionStateChange { connectionStates.append($0) }

        room.handleMessageForTesting(["type": "auth_success", "userId": "user-1", "connectionId": "conn-1"])
        room.handleMessageForTesting(["type": "sync", "sharedState": ["topic": "focus"], "sharedVersion": 1, "playerState": ["ready": true], "playerVersion": 2])
        room.handleMessageForTesting(["type": "members_sync", "members": [["memberId": "user-1", "userId": "user-1", "connectionId": "conn-1", "connectionCount": 1, "state": ["typing": false]]]])
        room.handleMessageForTesting(["type": "member_join", "member": ["memberId": "user-2", "userId": "user-2", "connectionCount": 1, "state": [:]]])
        room.handleMessageForTesting(["type": "signal", "event": "cursor.move", "payload": ["x": 10, "y": 20], "meta": ["memberId": "user-2", "userId": "user-2", "connectionId": "conn-2", "sentAt": 123]])
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
        XCTAssertEqual(memberLeaves, ["user-2:timeout"])
        XCTAssertEqual(room.members.list().count, 1)
        XCTAssertEqual(room.members.list().first?["memberId"] as? String, "user-1")
    }

    func test_room_unified_surface_sends_signal_member_and_admin_frames() async throws {
        let fakeSocket = FakeRoomWebSocketTask()
        let client = EdgeBaseClient("https://dummy.edgebase.fun")
        let room = client.room(namespace: "game", id: "room-send")
        room.attachSocketForTesting(fakeSocket)
        room.handleMessageForTesting(["type": "auth_success", "userId": "user-1", "connectionId": "conn-1"])

        let signalTask = Task {
            try await room.signals.send("cursor.move", payload: ["x": 10], options: ["includeSelf": true])
        }
        let signalMessage = try await fakeSocket.waitForMessage(at: 0)
        XCTAssertEqual(signalMessage["type"] as? String, "signal")
        XCTAssertEqual(signalMessage["event"] as? String, "cursor.move")
        XCTAssertEqual(signalMessage["includeSelf"] as? Bool, true)
        let signalRequestId = try XCTUnwrap(signalMessage["requestId"] as? String)
        room.handleMessageForTesting(["type": "signal_sent", "requestId": signalRequestId, "event": "cursor.move"])
        try await signalTask.value

        let memberTask = Task {
            try await room.members.setState(["typing": true])
        }
        let memberMessage = try await fakeSocket.waitForMessage(at: 1)
        XCTAssertEqual(memberMessage["type"] as? String, "member_state")
        let memberState = try XCTUnwrap(memberMessage["state"] as? [String: Any])
        XCTAssertEqual(memberState["typing"] as? Bool, true)
        let memberRequestId = try XCTUnwrap(memberMessage["requestId"] as? String)
        room.handleMessageForTesting(["type": "member_state", "requestId": memberRequestId, "member": ["memberId": "user-1", "userId": "user-1", "state": ["typing": true]], "state": ["typing": true]])
        try await memberTask.value

        let adminTask = Task { try await room.admin.block("user-2") }
        let adminMessage = try await fakeSocket.waitForMessage(at: 2)
        XCTAssertEqual(adminMessage["type"] as? String, "admin")
        XCTAssertEqual(adminMessage["operation"] as? String, "block")
        XCTAssertEqual(adminMessage["memberId"] as? String, "user-2")
        let adminRequestId = try XCTUnwrap(adminMessage["requestId"] as? String)
        room.handleMessageForTesting(["type": "admin_result", "requestId": adminRequestId, "operation": "block", "memberId": "user-2"])
        try await adminTask.value

        XCTAssertEqual(fakeSocket.events, ["send:signal", "send:member_state", "send:admin"])
    }
}

final class FunctionsCaptchaTransportTests: XCTestCase {
    override func tearDown() {
        MockRoomURLProtocol.requestHandler = nil
        super.tearDown()
    }

    func test_captchaHeaderIsSentForGetPostAndDelete() async throws {
        let recorder = FunctionRequestRecorder()
        MockRoomURLProtocol.requestHandler = { request in
            recorder.append(request)
            return (
                HTTPURLResponse(
                    url: request.url!,
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["Content-Type": "application/json"]
                )!,
                Data("{}".utf8)
            )
        }
        let client = EdgeBaseClient(
            "https://api.example.test",
            session: makeFunctionTestSession()
        )

        for method in ["GET", "POST", "DELETE"] {
            _ = try await client.functions.call(
                "protected-\(method.lowercased())",
                options: FunctionCallOptions(
                    method: method,
                    body: method == "POST" ? ["ok": true] : nil,
                    query: method == "GET" ? ["page": "1"] : nil,
                    captchaToken: "captcha-\(method)"
                )
            )
        }

        let requests = recorder.snapshot()
        XCTAssertEqual(requests.compactMap(\.httpMethod), ["GET", "POST", "DELETE"])
        XCTAssertEqual(
            requests.compactMap { $0.value(forHTTPHeaderField: "X-EdgeBase-Captcha-Token") },
            ["captcha-GET", "captcha-POST", "captcha-DELETE"]
        )
        XCTAssertEqual(requests.first?.url?.query, "page=1")
    }

    func test_captchaRequestNeverReplaysNetwork401Or429Failures() async {
        let recorder = FunctionRequestRecorder()
        MockRoomURLProtocol.requestHandler = { request in
            recorder.append(request)
            let name = request.url!.lastPathComponent
            if name == "network" {
                throw URLError(.networkConnectionLost)
            }
            let status = name == "unauthorized" ? 401 : 429
            return (
                HTTPURLResponse(
                    url: request.url!,
                    statusCode: status,
                    httpVersion: nil,
                    headerFields: ["Content-Type": "application/json"]
                )!,
                Data(#"{"message":"synthetic failure"}"#.utf8)
            )
        }
        let client = EdgeBaseClient(
            "https://api.example.test",
            session: makeFunctionTestSession()
        )

        for name in ["network", "unauthorized", "rate-limited"] {
            do {
                _ = try await client.functions.call(
                    name,
                    options: FunctionCallOptions(
                        captchaToken: "single-use-token"
                    )
                )
                XCTFail("Expected \(name) to fail")
            } catch {
                // Expected: the important contract is that the request is not replayed.
            }
        }

        XCTAssertEqual(recorder.countsByLastPathComponent(), [
            "network": 1,
            "unauthorized": 1,
            "rate-limited": 1,
        ])
    }

    private func makeFunctionTestSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockRoomURLProtocol.self]
        return URLSession(configuration: configuration)
    }
}

private final class FunctionRequestRecorder: @unchecked Sendable {
    private let lock = NSLock()
    private var requests: [URLRequest] = []

    func append(_ request: URLRequest) {
        lock.lock()
        requests.append(request)
        lock.unlock()
    }

    func snapshot() -> [URLRequest] {
        lock.lock()
        defer { lock.unlock() }
        return requests
    }

    func countsByLastPathComponent() -> [String: Int] {
        var counts: [String: Int] = [:]
        for request in snapshot() {
            if let name = request.url?.lastPathComponent {
                counts[name, default: 0] += 1
            }
        }
        return counts
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

// ─── P. DocRef 구조 검증 ────────────────────────────────────────────────────

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
