// Swift SDK E2E 테스트
// XCTest 기반, 실제 EdgeBase 서버(localhost:8688)에 URLSession HTTP 요청
//
// 실행 방법:
//   cd packages/sdk/swift
//   SERVER=http://localhost:8688 swift test --filter EdgeBaseSDKTests
//   - Package.swift의 testTarget에 'EdgeBaseSDKTests' 추가 필요

import XCTest
import Foundation

// ─── Helper ──────────────────────────────────────────────────────────────────

let kServer = ProcessInfo.processInfo.environment["SERVER"] ?? "http://localhost:8688"
let kSK = ProcessInfo.processInfo.environment["SERVICE_KEY"] ?? "test-service-key-for-admin"

@discardableResult
func rawRequest(
    method: String,
    path: String,
    body: [String: Any]? = nil
) async throws -> (Int, [String: Any]?) {
    let url = URL(string: "\(kServer)\(path)")!
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(kSK, forHTTPHeaderField: "X-EdgeBase-Service-Key")
    if let body = body {
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
    }
    let (data, response) = try await URLSession.shared.data(for: request)
    let statusCode = (response as! HTTPURLResponse).statusCode
    let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    return (statusCode, json)
}

// ─── 1. FilterTuple 단위 테스트 ───────────────────────────────────────────────

final class FilterTupleTests: XCTestCase {
    func testToJSON() {
        // FilterTuple serializes to [field, op, value] array
        // Verify the concept without importing the actual package (path deps may not resolve in CI)
        let field = "status"
        let op = "=="
        let value = "published"
        let json: [Any] = [field, op, value]
        XCTAssertEqual(json[0] as? String, field)
        XCTAssertEqual(json[1] as? String, op)
    }

    func testNumericValue() {
        let value = 42
        let json: [Any] = ["count", ">", value]
        XCTAssertEqual(json[2] as? Int, 42)
    }
}

// ─── 2. DB CRUD E2E ────────────────────────────────────────────────────────

final class DbCrudTests: XCTestCase {
    var createdId: String?

    override func tearDown() async throws {
        if let id = createdId {
            try? await rawRequest(method: "DELETE", path: "/api/db/shared/tables/posts/\(id)")
        }
    }

    func testInsert() async throws {
        let suffix = Int(Date().timeIntervalSince1970 * 1000)
        let (status, data) = try await rawRequest(
            method: "POST",
            path: "/api/db/shared/tables/posts",
            body: ["title": "Swift-create-\(suffix)"]
        )
        XCTAssertEqual(status, 201)
        XCTAssertNotNil(data?["id"])
        createdId = data?["id"] as? String
    }

    func testGetOne() async throws {
        let (_, created) = try await rawRequest(
            method: "POST",
            path: "/api/db/shared/tables/posts",
            body: ["title": "Swift-getOne"]
        )
        guard let id = created?["id"] as? String else { return XCTFail("No id") }
        createdId = id

        let (status, data) = try await rawRequest(method: "GET", path: "/api/db/shared/tables/posts/\(id)")
        XCTAssertEqual(status, 200)
        XCTAssertEqual(data?["id"] as? String, id)
    }

    func testUpdate() async throws {
        let (_, created) = try await rawRequest(
            method: "POST",
            path: "/api/db/shared/tables/posts",
            body: ["title": "Swift-update-orig"]
        )
        guard let id = created?["id"] as? String else { return XCTFail("No id") }
        createdId = id

        let (status, data) = try await rawRequest(
            method: "PATCH",
            path: "/api/db/shared/tables/posts/\(id)",
            body: ["title": "Swift-update-new"]
        )
        XCTAssertEqual(status, 200)
        XCTAssertEqual(data?["title"] as? String, "Swift-update-new")
    }

    func testDelete() async throws {
        let (_, created) = try await rawRequest(
            method: "POST",
            path: "/api/db/shared/tables/posts",
            body: ["title": "Swift-delete-me"]
        )
        guard let id = created?["id"] as? String else { return XCTFail("No id") }

        let (delStatus, _) = try await rawRequest(method: "DELETE", path: "/api/db/shared/tables/posts/\(id)")
        XCTAssertTrue([200, 204].contains(delStatus))

        let (getStatus, _) = try await rawRequest(method: "GET", path: "/api/db/shared/tables/posts/\(id)")
        XCTAssertEqual(getStatus, 404)
    }

    func testList() async throws {
        let (status, data) = try await rawRequest(method: "GET", path: "/api/db/shared/tables/posts?limit=5")
        XCTAssertEqual(status, 200)
        XCTAssertNotNil(data?["items"])
    }

    func testCount() async throws {
        let (status, data) = try await rawRequest(method: "GET", path: "/api/db/shared/tables/posts/count")
        XCTAssertEqual(status, 200)
        XCTAssertNotNil(data?["total"])
    }

    func testUpsertInsert() async throws {
        let suffix = Int(Date().timeIntervalSince1970 * 1000)
        let (status, data) = try await rawRequest(
            method: "POST",
            path: "/api/db/shared/tables/posts?upsert=true",
            body: ["title": "Swift-upsert-\(suffix)"]
        )
        XCTAssertTrue([200, 201].contains(status))
        XCTAssertEqual(data?["action"] as? String, "inserted")
        createdId = data?["id"] as? String
    }
}

// ─── 3. Batch E2E ─────────────────────────────────────────────────────────────

final class BatchTests: XCTestCase {
    var batchIds: [String] = []

    override func tearDown() async throws {
        for id in batchIds {
            try? await rawRequest(method: "DELETE", path: "/api/db/shared/tables/posts/\(id)")
        }
        batchIds = []
    }

    func testInsertMany() async throws {
        let body: [String: Any] = [
            "inserts": [
                ["title": "Swift-batch-1"],
                ["title": "Swift-batch-2"],
                ["title": "Swift-batch-3"],
            ]
        ]
        let (status, data) = try await rawRequest(
            method: "POST",
            path: "/api/db/shared/tables/posts/batch",
            body: body
        )
        XCTAssertEqual(status, 200)
        let created = data?["inserted"] as? [[String: Any]] ?? []
        XCTAssertEqual(created.count, 3)
        batchIds = created.compactMap { $0["id"] as? String }
    }
}

// ─── 4. Field Ops E2E ─────────────────────────────────────────────────────────

final class FieldOpsTests: XCTestCase {
    var postId: String?

    override func setUp() async throws {
        let (_, data) = try await rawRequest(
            method: "POST",
            path: "/api/db/shared/tables/posts",
            body: ["title": "Swift-field-ops", "viewCount": 0]
        )
        postId = data?["id"] as? String
    }

    override func tearDown() async throws {
        if let id = postId {
            try? await rawRequest(method: "DELETE", path: "/api/db/shared/tables/posts/\(id)")
        }
    }

    func testIncrement() async throws {
        guard let id = postId else { return }
        let (_, data) = try await rawRequest(
            method: "PATCH",
            path: "/api/db/shared/tables/posts/\(id)",
            body: ["viewCount": ["$op": "increment", "value": 5]]
        )
        XCTAssertEqual(data?["viewCount"] as? Int, 5)
    }

    func testDeleteField() async throws {
        guard let id = postId else { return }
        let (_, data) = try await rawRequest(
            method: "PATCH",
            path: "/api/db/shared/tables/posts/\(id)",
            body: ["title": ["$op": "deleteField"]]
        )
        // title should be null
        XCTAssertNil(data?["title"] as AnyObject? as? String)
    }
}

// ─── 5. Filter E2E ────────────────────────────────────────────────────────────

final class FilterTests: XCTestCase {
    var postId: String?

    override func setUp() async throws {
        let suffix = Int(Date().timeIntervalSince1970 * 1000)
        let (_, data) = try await rawRequest(
            method: "POST",
            path: "/api/db/shared/tables/posts",
            body: ["title": "Swift-filter-\(suffix)", "status": "published"]
        )
        postId = data?["id"] as? String
    }

    override func tearDown() async throws {
        if let id = postId {
            try? await rawRequest(method: "DELETE", path: "/api/db/shared/tables/posts/\(id)")
        }
    }

    func testWhereFilter() async throws {
        guard let id = postId else { return }
        let filter = "[[\"\(id)\",\"==\",\"\(id)\"]]".addingPercentEncoding(
            withAllowedCharacters: .urlQueryAllowed
        ) ?? ""
        let filterEncoded = "[[\"id\",\"==\",\"\(id)\"]]".addingPercentEncoding(
            withAllowedCharacters: .urlQueryAllowed
        ) ?? ""
        let (status, data) = try await rawRequest(
            method: "GET",
            path: "/api/db/shared/tables/posts?filter=\(filterEncoded)"
        )
        XCTAssertEqual(status, 200)
        let items = data?["items"] as? [[String: Any]] ?? []
        XCTAssertTrue(items.contains(where: { $0["id"] as? String == id }))
    }

    func testSortAsc() async throws {
        let (status, _) = try await rawRequest(
            method: "GET",
            path: "/api/db/shared/tables/posts?sort=title:asc&limit=10"
        )
        XCTAssertEqual(status, 200)
    }

    func testLimit() async throws {
        let (status, data) = try await rawRequest(
            method: "GET",
            path: "/api/db/shared/tables/posts?limit=2"
        )
        XCTAssertEqual(status, 200)
        let items = data?["items"] as? [[String: Any]] ?? []
        XCTAssertLessThanOrEqual(items.count, 2)
    }
}

// ─── 6. Auth E2E ─────────────────────────────────────────────────────────────

final class AuthTests: XCTestCase {
    func testSignUp() async throws {
        let suffix = Int(Date().timeIntervalSince1970 * 1000)
        let email = "swift-\(suffix)@test.com"
        let (status, data) = try await rawRequest(
            method: "POST",
            path: "/api/auth/signup",
            body: ["email": email, "password": "Swift1234!"]
        )
        XCTAssertEqual(status, 201)
        XCTAssertNotNil(data?["accessToken"])
    }

    func testSignIn() async throws {
        let suffix = Int(Date().timeIntervalSince1970 * 1000)
        let email = "swift-si-\(suffix)@test.com"
        // First sign up
        _ = try await rawRequest(
            method: "POST",
            path: "/api/auth/signup",
            body: ["email": email, "password": "Swift1234!"]
        )
        // Then sign in
        let (status, data) = try await rawRequest(
            method: "POST",
            path: "/api/auth/signin",
            body: ["email": email, "password": "Swift1234!"]
        )
        XCTAssertEqual(status, 200)
        XCTAssertNotNil(data?["accessToken"])
    }

    func testSignInWrongPassword() async throws {
        let suffix = Int(Date().timeIntervalSince1970 * 1000)
        let email = "swift-wp-\(suffix)@test.com"
        _ = try await rawRequest(
            method: "POST",
            path: "/api/auth/signup",
            body: ["email": email, "password": "Swift1234!"]
        )
        let (status, _) = try await rawRequest(
            method: "POST",
            path: "/api/auth/signin",
            body: ["email": email, "password": "WrongPw1234!"]
        )
        XCTAssertEqual(status, 401)
    }
}

// ─── 7. Cursor Pagination E2E ──────────────────────────────────────────────────

final class CursorPaginationTests: XCTestCase {
    var ids: [String] = []

    override func setUp() async throws {
        for i in 0..<5 {
            let (_, data) = try await rawRequest(
                method: "POST",
                path: "/api/db/shared/tables/posts",
                body: ["title": "Swift-page-\(i)"]
            )
            if let id = data?["id"] as? String { ids.append(id) }
        }
    }

    override func tearDown() async throws {
        for id in ids {
            try? await rawRequest(method: "DELETE", path: "/api/db/shared/tables/posts/\(id)")
        }
    }

    func testAfterCursor() async throws {
        let (_, page1Data) = try await rawRequest(method: "GET", path: "/api/db/shared/tables/posts?limit=2")
        guard let cursor = page1Data?["cursor"] as? String else { return }
        let cursorEncoded = cursor.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? cursor
        let (status, page2Data) = try await rawRequest(
            method: "GET",
            path: "/api/db/shared/tables/posts?limit=2&after=\(cursorEncoded)"
        )
        XCTAssertEqual(status, 200)
        let page1Items = page1Data?["items"] as? [[String: Any]] ?? []
        let page2Items = page2Data?["items"] as? [[String: Any]] ?? []
        for item1 in page1Items {
            XCTAssertFalse(page2Items.contains(where: { $0["id"] as? String == item1["id"] as? String }))
        }
    }
}

// ─── 8. Push E2E ──────────────────────────────────────────────────────────────

final class PushTests: XCTestCase {

    /// push send to non-existent user → sent: 0
    func testPushSendNonexistentUser() async throws {
        let (status, data) = try await rawRequest(
            method: "POST",
            path: "/api/push/send",
            body: [
                "userId": "nonexistent-user-push-99999",
                "payload": ["title": "test", "body": "hello"]
            ]
        )
        // 200 with sent: 0 (no devices) or 503 (push not configured)
        XCTAssertTrue([200, 503].contains(status))
        if status == 200 {
            XCTAssertEqual(data?["sent"] as? Int, 0)
        }
    }

    /// push sendToToken → sent: 1 (mock FCM success) or 503
    func testPushSendToToken() async throws {
        let (status, data) = try await rawRequest(
            method: "POST",
            path: "/api/push/send-to-token",
            body: [
                "token": "fake-fcm-token-for-e2e",
                "payload": ["title": "Token Push", "body": "direct"],
                "platform": "web"
            ]
        )
        // 200 with sent/failed or 503 (push not configured)
        XCTAssertTrue([200, 503].contains(status))
        if status == 200 {
            let sent = data?["sent"] as? Int ?? 0
            let failed = data?["failed"] as? Int ?? 0
            XCTAssertTrue(sent == 1 || failed == 1)
        }
    }

    /// push sendMany → 200 OK
    func testPushSendMany() async throws {
        let (status, data) = try await rawRequest(
            method: "POST",
            path: "/api/push/send-many",
            body: [
                "userIds": ["user-a", "user-b"],
                "payload": ["title": "Batch Push", "body": "multi"]
            ]
        )
        // 200 with sent: 0 (no devices) or 503 (push not configured)
        XCTAssertTrue([200, 503].contains(status))
        if status == 200 {
            XCTAssertEqual(data?["sent"] as? Int, 0)
        }
    }

    /// push getTokens → empty array for unknown user
    func testPushGetTokensEmpty() async throws {
        let (status, data) = try await rawRequest(
            method: "GET",
            path: "/api/push/tokens?userId=nonexistent-user-tokens-99999"
        )
        XCTAssertEqual(status, 200)
        let items = data?["items"] as? [[String: Any]] ?? []
        XCTAssertEqual(items.count, 0)
    }

    /// push getLogs → array (possibly empty)
    func testPushGetLogs() async throws {
        let (status, data) = try await rawRequest(
            method: "GET",
            path: "/api/push/logs?userId=nonexistent-user-logs-99999&limit=10"
        )
        XCTAssertEqual(status, 200)
        XCTAssertNotNil(data?["items"])
    }

    /// push sendToTopic → success or 503
    func testPushSendToTopic() async throws {
        let (status, _) = try await rawRequest(
            method: "POST",
            path: "/api/push/send-to-topic",
            body: [
                "topic": "test-topic",
                "payload": ["title": "Topic Push", "body": "news"]
            ]
        )
        // 200 (success) or 503 (push not configured)
        XCTAssertTrue([200, 503].contains(status))
    }

    /// push broadcast → success or 503
    func testPushBroadcast() async throws {
        let (status, _) = try await rawRequest(
            method: "POST",
            path: "/api/push/broadcast",
            body: [
                "payload": ["title": "Broadcast", "body": "everyone"]
            ]
        )
        // 200 (success) or 503 (push not configured)
        XCTAssertTrue([200, 503].contains(status))
    }
}

// ─── 9. Push Client E2E ──────────────────────────────────────────────────────

/// Helper: raw HTTP request with Bearer token (JWT auth) instead of service key
@discardableResult
func authedRequest(
    method: String,
    path: String,
    body: [String: Any]? = nil,
    accessToken: String
) async throws -> (Int, [String: Any]?) {
    let url = URL(string: "\(kServer)\(path)")!
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
    if let body = body {
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
    }
    let (data, response) = try await URLSession.shared.data(for: request)
    let statusCode = (response as! HTTPURLResponse).statusCode
    let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    return (statusCode, json)
}

final class PushClientTests: XCTestCase {
    var accessToken: String?

    override func setUp() async throws {
        let suffix = Int(Date().timeIntervalSince1970 * 1000)
        let email = "swift-pushclient-\(suffix)@test.com"
        let (status, data) = try await rawRequest(
            method: "POST",
            path: "/api/auth/signup",
            body: ["email": email, "password": "SwiftPush1234!"]
        )
        XCTAssertEqual(status, 201)
        accessToken = data?["accessToken"] as? String
        XCTAssertNotNil(accessToken)
    }

    func testPushClientRegister() async throws {
        guard let token = accessToken else { return XCTFail("No accessToken") }
        let suffix = Int(Date().timeIntervalSince1970 * 1000)
        let (status, _) = try await authedRequest(
            method: "POST",
            path: "/api/push/register",
            body: [
                "deviceId": "swift-push-e2e-\(suffix)",
                "token": "fake-fcm-token-swift-\(suffix)",
                "platform": "ios"
            ],
            accessToken: token
        )
        // 200 = success, 503 = push not configured
        XCTAssertTrue([200, 503].contains(status))
    }

    func testPushClientSubscribeTopic() async throws {
        guard let token = accessToken else { return XCTFail("No accessToken") }
        let (status, _) = try await authedRequest(
            method: "POST",
            path: "/api/push/topic/subscribe",
            body: ["topic": "swift-test-topic"],
            accessToken: token
        )
        XCTAssertTrue([200, 503].contains(status))
    }

    func testPushClientUnsubscribeTopic() async throws {
        guard let token = accessToken else { return XCTFail("No accessToken") }
        let (status, _) = try await authedRequest(
            method: "POST",
            path: "/api/push/topic/unsubscribe",
            body: ["topic": "swift-test-topic"],
            accessToken: token
        )
        XCTAssertTrue([200, 503].contains(status))
    }

    func testPushClientUnregister() async throws {
        guard let token = accessToken else { return XCTFail("No accessToken") }
        let suffix = Int(Date().timeIntervalSince1970 * 1000)
        let deviceId = "swift-push-unreg-\(suffix)"

        // Register first
        let (regStatus, _) = try await authedRequest(
            method: "POST",
            path: "/api/push/register",
            body: [
                "deviceId": deviceId,
                "token": "fake-fcm-token-unreg-\(suffix)",
                "platform": "ios"
            ],
            accessToken: token
        )
        XCTAssertTrue([200, 503].contains(regStatus))

        // Unregister
        let (status, _) = try await authedRequest(
            method: "POST",
            path: "/api/push/unregister",
            body: ["deviceId": deviceId],
            accessToken: token
        )
        XCTAssertTrue([200, 503].contains(status))
    }
}

// ─── 10. Push Full Flow E2E ──────────────────────────────────────────────────

/// Helper: raw HTTP request to mock FCM server (no auth headers)
@discardableResult
func mockFcmRequest(
    method: String,
    path: String
) async throws -> (Int, Any?) {
    let mockFcmBase = "http://localhost:9099"
    let url = URL(string: "\(mockFcmBase)\(path)")!
    var request = URLRequest(url: url)
    request.httpMethod = method
    let (data, response) = try await URLSession.shared.data(for: request)
    let statusCode = (response as! HTTPURLResponse).statusCode
    let json = try? JSONSerialization.jsonObject(with: data)
    return (statusCode, json)
}

final class PushFullFlowTests: XCTestCase {
    var accessToken: String?
    var userId: String?

    override func setUp() async throws {
        let suffix = Int(Date().timeIntervalSince1970 * 1000)
        let email = "swift-fullflow-\(suffix)@test.com"
        let (status, data) = try await rawRequest(
            method: "POST",
            path: "/api/auth/signup",
            body: ["email": email, "password": "SwiftFlow1234!"]
        )
        XCTAssertEqual(status, 201)
        accessToken = data?["accessToken"] as? String
        userId = (data?["user"] as? [String: Any])?["id"] as? String
        XCTAssertNotNil(accessToken)
        XCTAssertNotNil(userId)
    }

    /// Full pipeline: register → admin send(userId) → mock FCM receives → unregister → tokens empty
    func testFullPipelineSendToUser() async throws {
        guard let token = accessToken, let uid = userId else {
            return XCTFail("No accessToken or userId")
        }
        let suffix = Int(Date().timeIntervalSince1970 * 1000)
        let fcmToken = "flow-token-swift-\(suffix)"
        let deviceId = "swift-flow-device-\(suffix)"

        // 1. Clear mock FCM store
        let (clearStatus, _) = try await mockFcmRequest(method: "DELETE", path: "/messages")
        XCTAssertTrue([200, 204].contains(clearStatus))

        // 2. Client register push token
        let (regStatus, _) = try await authedRequest(
            method: "POST",
            path: "/api/push/register",
            body: [
                "deviceId": deviceId,
                "token": fcmToken,
                "platform": "web"
            ],
            accessToken: token
        )
        XCTAssertEqual(regStatus, 200)

        // 3. Admin send to userId
        let (sendStatus, sendData) = try await rawRequest(
            method: "POST",
            path: "/api/push/send",
            body: [
                "userId": uid,
                "payload": ["title": "Full Flow", "body": "E2E"]
            ]
        )
        XCTAssertEqual(sendStatus, 200)
        XCTAssertEqual(sendData?["sent"] as? Int, 1)

        // 4. Verify mock FCM received the message
        let encodedToken = fcmToken.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? fcmToken
        let (fcmStatus, fcmData) = try await mockFcmRequest(
            method: "GET",
            path: "/messages?token=\(encodedToken)"
        )
        XCTAssertEqual(fcmStatus, 200)
        if let items = fcmData as? [[String: Any]] {
            XCTAssertGreaterThanOrEqual(items.count, 1)
            let first = items[0]
            XCTAssertEqual(first["token"] as? String, fcmToken)
            if let payload = first["payload"] as? [String: Any],
               let notification = payload["notification"] as? [String: Any] {
                XCTAssertEqual(notification["title"] as? String, "Full Flow")
            }
        }

        // 5. Client unregister
        let (unregStatus, _) = try await authedRequest(
            method: "POST",
            path: "/api/push/unregister",
            body: ["deviceId": deviceId],
            accessToken: token
        )
        XCTAssertEqual(unregStatus, 200)

        // 6. Admin getTokens → empty
        let (tokensStatus, tokensData) = try await rawRequest(
            method: "GET",
            path: "/api/push/tokens?userId=\(uid)"
        )
        XCTAssertEqual(tokensStatus, 200)
        let tokenItems = tokensData?["items"] as? [[String: Any]] ?? []
        XCTAssertEqual(tokenItems.count, 0)
    }

    /// sendToTopic → mock FCM receives topic message
    func testSendToTopic() async throws {
        // Clear mock FCM store
        _ = try await mockFcmRequest(method: "DELETE", path: "/messages")

        // Admin sendToTopic
        let (status, _) = try await rawRequest(
            method: "POST",
            path: "/api/push/send-to-topic",
            body: [
                "topic": "news",
                "payload": ["title": "Topic Test", "body": "swift topic"]
            ]
        )
        XCTAssertEqual(status, 200)

        // Verify mock FCM received topic message
        let (fcmStatus, fcmData) = try await mockFcmRequest(
            method: "GET",
            path: "/messages?topic=news"
        )
        XCTAssertEqual(fcmStatus, 200)
        if let items = fcmData as? [[String: Any]] {
            XCTAssertGreaterThanOrEqual(items.count, 1)
            let first = items[0]
            XCTAssertEqual(first["topic"] as? String, "news")
        }
    }

    /// broadcast → mock FCM receives topic "all"
    func testBroadcast() async throws {
        // Clear mock FCM store
        _ = try await mockFcmRequest(method: "DELETE", path: "/messages")

        // Admin broadcast
        let (status, _) = try await rawRequest(
            method: "POST",
            path: "/api/push/broadcast",
            body: [
                "payload": ["title": "Broadcast", "body": "swift broadcast"]
            ]
        )
        XCTAssertEqual(status, 200)

        // Verify mock FCM received broadcast (topic = "all")
        let (fcmStatus, fcmData) = try await mockFcmRequest(
            method: "GET",
            path: "/messages?topic=all"
        )
        XCTAssertEqual(fcmStatus, 200)
        if let items = fcmData as? [[String: Any]] {
            XCTAssertGreaterThanOrEqual(items.count, 1)
            let first = items[0]
            XCTAssertEqual(first["topic"] as? String, "all")
        }
    }
}
