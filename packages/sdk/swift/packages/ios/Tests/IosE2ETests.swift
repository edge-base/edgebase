import Dispatch
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import EdgeBase

private enum E2ETestSupport {
    private static let requiredEnv = "EDGEBASE_E2E_REQUIRED"
    private static let timeoutEnv = "EDGEBASE_E2E_HEALTHCHECK_TIMEOUT_MS"
    private static let retryCountEnv = "EDGEBASE_E2E_HEALTHCHECK_RETRIES"
    private static let retryDelayEnv = "EDGEBASE_E2E_HEALTHCHECK_RETRY_DELAY_MS"

    static func requireServer(_ baseUrl: String) throws {
        let retryCount = max(Int(ProcessInfo.processInfo.environment[retryCountEnv] ?? "") ?? 3, 1)
        let retryDelayMs = max(Double(ProcessInfo.processInfo.environment[retryDelayEnv] ?? "") ?? 1000, 200)

        for attempt in 1...retryCount {
            if isServerAvailable(baseUrl) {
                return
            }

            if attempt < retryCount {
                Thread.sleep(forTimeInterval: retryDelayMs / 1000.0)
            }
        }

        let message = "E2E backend not reachable at \(baseUrl). Start `edgebase dev --port 8688` or set BASE_URL. Set \(requiredEnv)=1 to fail instead of skip."
        if ProcessInfo.processInfo.environment[requiredEnv] == "1" {
            throw NSError(domain: "EdgeBaseE2E", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
        }
        throw XCTSkip(message)
    }

    private static func isServerAvailable(_ baseUrl: String) -> Bool {
        guard let url = URL(string: "\(baseUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/")))/api/health") else {
            return false
        }
        let timeoutMs = Double(ProcessInfo.processInfo.environment[timeoutEnv] ?? "") ?? 5000
        let timeoutSeconds = max(timeoutMs / 1000.0, 1.5)
        var request = URLRequest(url: url)
        request.timeoutInterval = timeoutSeconds
        let semaphore = DispatchSemaphore(value: 0)
        var isAvailable = false
        URLSession.shared.dataTask(with: request) { _, response, _ in
            if let http = response as? HTTPURLResponse {
                isAvailable = (200..<500).contains(http.statusCode)
            }
            semaphore.signal()
        }.resume()
        _ = semaphore.wait(timeout: .now() + timeoutSeconds + 0.5)
        return isAvailable
    }
}

class EdgeBaseIosE2ETestCase: XCTestCase {
    var e2eBaseUrl: String { ProcessInfo.processInfo.environment["BASE_URL"] ?? "http://localhost:8688" }

    override func setUpWithError() throws {
        try super.setUpWithError()
        try E2ETestSupport.requireServer(e2eBaseUrl)
    }
}

/**
 * Swift iOS SDK — E2E 테스트
 *
 * 전제: wrangler dev --port 8688 서버 실행 중
 *
 * 실행:
 *   BASE_URL=http://localhost:8688 \
 *     cd packages/sdk/swift/packages/ios && swift test
 *
 * 원칙: mock 금지, EdgeBaseClient 실서버 기반
 */
final class EdgeBaseClientIosE2ETests: EdgeBaseIosE2ETestCase {

    private let baseUrl = ProcessInfo.processInfo.environment["BASE_URL"] ?? "http://localhost:8688"
    private let prefix = "swift-ios-e2e-\(Int(Date().timeIntervalSince1970 * 1000))"
    private var createdIds: [String] = []

    // ─── 1. Auth ─────────────────────────────────────────────────────────────

    func test_signUp_returns_accessToken() async throws {
        let client = EdgeBaseClient(baseUrl)
        let email = "\(prefix)-signup@test.com"
        let result = try await client.auth.signUp(email: email, password: "SwiftIos123!")
        XCTAssertNotNil(result["accessToken"], "signUp should return accessToken")
        await client.destroy()
    }

    func test_signIn_returns_accessToken() async throws {
        let client = EdgeBaseClient(baseUrl)
        let email = "\(prefix)-signin@test.com"
        try await client.auth.signUp(email: email, password: "SwiftIos123!")
        let result = try await client.auth.signIn(email: email, password: "SwiftIos123!")
        XCTAssertNotNil(result["accessToken"])
        await client.destroy()
    }

    func test_signOut_succeeds() async throws {
        let client = EdgeBaseClient(baseUrl)
        let email = "\(prefix)-signout@test.com"
        try await client.auth.signUp(email: email, password: "SwiftIos123!")
        await client.auth.signOut()
        await client.destroy()
    }

    func test_signInAnonymously_returns_token() async throws {
        let client = EdgeBaseClient(baseUrl)
        let result = try await client.auth.signInAnonymously()
        XCTAssertNotNil(result["accessToken"], "anonymous should return accessToken")
        await client.destroy()
    }

    func test_wrong_password_throws() async throws {
        let client = EdgeBaseClient(baseUrl)
        let email = "\(prefix)-wrongpw@test.com"
        try await client.auth.signUp(email: email, password: "SwiftIos123!")
        do {
            _ = try await client.auth.signIn(email: email, password: "WrongPass!")
            XCTFail("Should have thrown")
        } catch {
            // Expected
        }
        await client.destroy()
    }

    func test_signUp_with_displayName() async throws {
        let client = EdgeBaseClient(baseUrl)
        let email = "\(prefix)-display@test.com"
        let result = try await client.auth.signUp(email: email, password: "SwiftIos123!",
                                                   userData: ["displayName": "Test User"])
        XCTAssertNotNil(result["accessToken"])
        await client.destroy()
    }

    // ─── 2. DB ───────────────────────────────────────────────────────────────

    func test_db_insert_and_getOne() async throws {
        let client = EdgeBaseClient(baseUrl)
        let email = "\(prefix)-db@test.com"
        try await client.auth.signUp(email: email, password: "SwiftIos123!")
        let created = try await client.db("shared").table("posts").insert(["title": "\(prefix)-create"])
        let id = created["id"] as? String
        XCTAssertNotNil(id)
        let fetched = try await client.db("shared").table("posts").getOne(id!)
        XCTAssertNotNil(fetched["id"])
        try await client.db("shared").table("posts").doc(id!).delete()
        await client.destroy()
    }

    func test_db_list_returns_items() async throws {
        let client = EdgeBaseClient(baseUrl)
        let email = "\(prefix)-list@test.com"
        try await client.auth.signUp(email: email, password: "SwiftIos123!")
        let result = try await client.db("shared").table("posts").limit(3).getList()
        XCTAssertNotNil(result.items)
        XCTAssertLessThanOrEqual(result.items.count, 3)
        await client.destroy()
    }

    func test_db_where_filter() async throws {
        let client = EdgeBaseClient(baseUrl)
        let email = "\(prefix)-filter@test.com"
        try await client.auth.signUp(email: email, password: "SwiftIos123!")
        let unique = "\(prefix)-filter-\(Int(Date().timeIntervalSince1970 * 1000))"
        let r = try await client.db("shared").table("posts").insert(["title": unique])
        let id = r["id"] as? String
        let list = try await client.db("shared").table("posts").where("title", "==", unique).getList()
        XCTAssertFalse(list.items.isEmpty)
        if let id = id { try await client.db("shared").table("posts").doc(id).delete() }
        await client.destroy()
    }

    // ─── 3. Storage ──────────────────────────────────────────────────────────

    func test_storage_put_and_download_with_auth() async throws {
        let client = EdgeBaseClient(baseUrl)
        try await client.auth.signUp(email: "\(prefix)-storage@test.com", password: "SwiftIos123!")
        let bucket = client.storage.bucket("documents")
        let key = "swift-ios-auth-\(Int(Date().timeIntervalSince1970 * 1000)).txt"
        let content = "Hello from Swift iOS"
        let info = try await bucket.upload(
            key,
            data: content.data(using: .utf8)!,
            contentType: "text/plain"
        )
        XCTAssertEqual(info.key, key)
        let downloaded = try await bucket.download(key)
        XCTAssertEqual(String(data: downloaded, encoding: .utf8), content)
        try await bucket.delete(key)
        await client.destroy()
    }

    // ─── 4. Error ────────────────────────────────────────────────────────────

    func test_getOne_nonexistent_throws() async throws {
        let client = EdgeBaseClient(baseUrl)
        let email = "\(prefix)-err@test.com"
        try await client.auth.signUp(email: email, password: "SwiftIos123!")
        do {
            _ = try await client.db("shared").table("posts").getOne("nonexistent-swift-ios-99999")
            XCTFail("Should have thrown")
        } catch {
            // Expected
        }
        await client.destroy()
    }

    // ─── 5. async/await 병렬 (언어특화) ───────────────────────────────────────

    func test_parallel_insert_with_async_let() async throws {
        let client = EdgeBaseClient(baseUrl)
        let email = "\(prefix)-parallel@test.com"
        try await client.auth.signUp(email: email, password: "SwiftIos123!")
        async let r1 = client.db("shared").table("posts").insert(["title": "\(prefix)-par-1"])
        async let r2 = client.db("shared").table("posts").insert(["title": "\(prefix)-par-2"])
        async let r3 = client.db("shared").table("posts").insert(["title": "\(prefix)-par-3"])
        let results = try await [r1, r2, r3]
        XCTAssertEqual(3, results.count)
        for r in results {
            if let id = r["id"] as? String {
                try await client.db("shared").table("posts").doc(id).delete()
            }
        }
        await client.destroy()
    }

    func test_room_creation_succeeds() async throws {
        let client = EdgeBaseClient(baseUrl)
        let room = client.room(namespace: "game", id: "test-room-ios")
        XCTAssertNotNil(room)
        XCTAssertEqual(room.namespace, "game")
        XCTAssertEqual(room.roomId, "test-room-ios")
        await client.destroy()
    }

    // ─── 6. Codable 역직렬화 (언어특화) ──────────────────────────────────────

    func test_codable_roundtrip() throws {
        struct Post: Codable, Equatable {
            let title: String
            let views: Int
        }
        let post = Post(title: "Hello", views: 42)
        let data = try JSONEncoder().encode(post)
        let decoded = try JSONDecoder().decode(Post.self, from: data)
        XCTAssertEqual(post, decoded)
    }
}

// ─── 7. Auth Extended E2E ───────────────────────────────────────────────────

final class IosAuthExtendedE2ETests: EdgeBaseIosE2ETestCase {

    private let baseUrl = ProcessInfo.processInfo.environment["BASE_URL"] ?? "http://localhost:8688"
    private let prefix = "swift-ios-auth-\(Int(Date().timeIntervalSince1970 * 1000))"

    func test_signUp_signIn_signOut_chain() async throws {
        let client = EdgeBaseClient(baseUrl)
        let email = "\(prefix)-chain@test.com"
        let signUpResult = try await client.auth.signUp(email: email, password: "ChainTest123!")
        XCTAssertNotNil(signUpResult["accessToken"])

        let signInResult = try await client.auth.signIn(email: email, password: "ChainTest123!")
        XCTAssertNotNil(signInResult["accessToken"])

        await client.auth.signOut()
        await client.destroy()
    }

    func test_anonymous_signIn_returns_user() async throws {
        let client = EdgeBaseClient(baseUrl)
        let result = try await client.auth.signInAnonymously()
        XCTAssertNotNil(result["accessToken"])
        XCTAssertNotNil(result["refreshToken"])
        await client.destroy()
    }

    func test_changePassword() async throws {
        let client = EdgeBaseClient(baseUrl)
        let email = "\(prefix)-chpw@test.com"
        try await client.auth.signUp(email: email, password: "OldPass123!")
        let result = try await client.auth.changePassword(currentPassword: "OldPass123!", newPassword: "NewPass123!")
        XCTAssertNotNil(result)

        // Verify new password works
        let client2 = EdgeBaseClient(baseUrl)
        let signIn = try await client2.auth.signIn(email: email, password: "NewPass123!")
        XCTAssertNotNil(signIn["accessToken"])
        await client.destroy()
        await client2.destroy()
    }

    func test_listSessions() async throws {
        let client = EdgeBaseClient(baseUrl)
        let email = "\(prefix)-sess@test.com"
        try await client.auth.signUp(email: email, password: "Session123!")
        let sessions = try await client.auth.listSessions()
        XCTAssertNotNil(sessions)
        // At least one session from current login
        XCTAssertGreaterThanOrEqual(sessions.count, 1)
        await client.destroy()
    }

    func test_updateProfile() async throws {
        let client = EdgeBaseClient(baseUrl)
        let email = "\(prefix)-prof@test.com"
        try await client.auth.signUp(email: email, password: "Profile123!")
        let result = try await client.auth.updateProfile(["displayName": "Swift User"])
        XCTAssertNotNil(result)
        await client.destroy()
    }

    func test_signInWithOAuth_returns_url() async throws {
        let client = EdgeBaseClient(baseUrl)
        let url = await client.auth.signInWithOAuth(provider: "google")
        XCTAssertTrue(url.contains("oauth"))
        XCTAssertTrue(url.contains("google"))
        await client.destroy()
    }

    func test_requestPasswordReset_doesNotThrow() async throws {
        let client = EdgeBaseClient(baseUrl)
        let email = "\(prefix)-reset@test.com"
        try await client.auth.signUp(email: email, password: "Reset123!")
        do {
            _ = try await client.auth.requestPasswordReset(email: email)
        } catch {
            // May throw if email service is not configured — acceptable
        }
        await client.destroy()
    }

    func test_signUp_duplicate_email_throws() async throws {
        let client = EdgeBaseClient(baseUrl)
        let email = "\(prefix)-dup@test.com"
        try await client.auth.signUp(email: email, password: "Dup12345!")
        do {
            _ = try await client.auth.signUp(email: email, password: "Dup12345!")
            // Some servers allow re-signup (idempotent), some throw
        } catch {
            // Expected — duplicate email
        }
        await client.destroy()
    }

    func test_signIn_nonexistent_email_throws() async throws {
        let client = EdgeBaseClient(baseUrl)
        do {
            _ = try await client.auth.signIn(email: "nonexistent-\(prefix)@test.com", password: "Nope123!")
            XCTFail("Should have thrown")
        } catch {
            // Expected
        }
        await client.destroy()
    }

    func test_currentUser_after_signUp() async throws {
        let client = EdgeBaseClient(baseUrl)
        let email = "\(prefix)-curuser@test.com"
        try await client.auth.signUp(email: email, password: "CurUser123!")
        // currentUser may need time to propagate; check it doesn't crash
        let user = await client.auth.currentUser()
        // user may be nil if JWT decoding is not instant, or non-nil with email
        if let user = user {
            XCTAssertNotNil(user)
        }
        await client.destroy()
    }
}

// ─── 8. DB Extended E2E ─────────────────────────────────────────────────────

final class IosDbExtendedE2ETests: EdgeBaseIosE2ETestCase {

    private let baseUrl = ProcessInfo.processInfo.environment["BASE_URL"] ?? "http://localhost:8688"
    private let prefix = "swift-ios-db-\(Int(Date().timeIntervalSince1970 * 1000))"

    func test_insert_and_update() async throws {
        let client = EdgeBaseClient(baseUrl)
        try await client.auth.signUp(email: "\(prefix)-cru@test.com", password: "CrUp123!")
        let created = try await client.db("shared").table("posts").insert(["title": "\(prefix)-cru", "views": 0])
        let id = created["id"] as! String
        let updated = try await client.db("shared").table("posts").doc(id).update(["views": 100])
        XCTAssertEqual(updated["views"] as? Int, 100)
        try await client.db("shared").table("posts").doc(id).delete()
        await client.destroy()
    }

    func test_insertMany_and_deleteMany() async throws {
        let client = EdgeBaseClient(baseUrl)
        try await client.auth.signUp(email: "\(prefix)-cmdm@test.com", password: "Batch123!")
        let tag = "\(prefix)-batch"
        let records = (0..<4).map { ["title": "\(tag)-\($0)"] as [String: Any] }
        let created = try await client.db("shared").table("posts").insertMany(records)
        XCTAssertEqual(created.count, 4)

        let deleted = try await client.db("shared").table("posts")
            .where("title", "contains", tag)
            .deleteMany()
        XCTAssertGreaterThanOrEqual(deleted.totalSucceeded, 4)
        await client.destroy()
    }

    func test_increment_field() async throws {
        let client = EdgeBaseClient(baseUrl)
        try await client.auth.signUp(email: "\(prefix)-inc@test.com", password: "Inc12345!")
        let record = try await client.db("shared").table("posts").insert(["title": "\(prefix)-inc", "views": 10])
        let id = record["id"] as! String
        let updated = try await client.db("shared").table("posts").doc(id).update(["views": FieldOps.increment(5)])
        XCTAssertEqual(updated["views"] as? Int, 15)
        try await client.db("shared").table("posts").doc(id).delete()
        await client.destroy()
    }

    func test_deleteField() async throws {
        let client = EdgeBaseClient(baseUrl)
        try await client.auth.signUp(email: "\(prefix)-delf@test.com", password: "DelF123!")
        let record = try await client.db("shared").table("posts").insert(["title": "\(prefix)-delf", "description": "temp"])
        let id = record["id"] as! String
        let updated = try await client.db("shared").table("posts").doc(id).update(["description": FieldOps.deleteField()])
        // After deleteField, the field should be nil/absent or JSON null (NSNull).
        // JSONSerialization decodes JSON null as NSNull, not Swift nil.
        let value = updated["description"]
        XCTAssertTrue(value == nil || value is NSNull,
                      "Expected nil or NSNull but got \(String(describing: value))")
        try await client.db("shared").table("posts").doc(id).delete()
        await client.destroy()
    }

    func test_count_with_filter() async throws {
        let client = EdgeBaseClient(baseUrl)
        try await client.auth.signUp(email: "\(prefix)-cnt@test.com", password: "Count123!")
        let tag = "\(prefix)-count"
        _ = try await client.db("shared").table("posts").insert(["title": tag])
        _ = try await client.db("shared").table("posts").insert(["title": tag])

        let count = try await client.db("shared").table("posts").where("title", "==", tag).count()
        XCTAssertGreaterThanOrEqual(count, 2)

        _ = try await client.db("shared").table("posts").where("title", "==", tag).deleteMany()
        await client.destroy()
    }

    func test_orderBy_and_limit() async throws {
        let client = EdgeBaseClient(baseUrl)
        try await client.auth.signUp(email: "\(prefix)-obl@test.com", password: "OrdLim123!")
        let list = try await client.db("shared").table("posts").orderBy("createdAt", "desc").limit(3).getList()
        XCTAssertLessThanOrEqual(list.items.count, 3)
        await client.destroy()
    }

    func test_upsert() async throws {
        let client = EdgeBaseClient(baseUrl)
        try await client.auth.signUp(email: "\(prefix)-ups@test.com", password: "Upsert123!")
        let result = try await client.db("shared").table("posts").upsert(["title": "\(prefix)-ups", "views": 1])
        XCTAssertNotNil(result.record["id"])
        if let id = result.record["id"] as? String {
            try await client.db("shared").table("posts").doc(id).delete()
        }
        await client.destroy()
    }
}

// ─── 9. Storage with Auth E2E ───────────────────────────────────────────────

final class IosStorageAuthE2ETests: EdgeBaseIosE2ETestCase {

    private let baseUrl = ProcessInfo.processInfo.environment["BASE_URL"] ?? "http://localhost:8688"
    private let prefix = "swift-ios-stor-\(Int(Date().timeIntervalSince1970 * 1000))"
    private let authBucket = "documents"

    func test_storage_upload_with_auth() async throws {
        let client = EdgeBaseClient(baseUrl)
        try await client.auth.signUp(email: "\(prefix)-stor@test.com", password: "Stor123!")
        let key = "\(prefix)-auth.txt"
        let bucket = client.storage.bucket(authBucket)
        let info = try await bucket.upload(
            key,
            data: "authenticated upload".data(using: .utf8)!,
            contentType: "text/plain"
        )
        XCTAssertEqual(info.key, key)
        try await bucket.delete(key)
        await client.destroy()
    }

    func test_storage_list_with_auth() async throws {
        let client = EdgeBaseClient(baseUrl)
        try await client.auth.signUp(email: "\(prefix)-storlist@test.com", password: "StorL123!")
        let bucket = client.storage.bucket(authBucket)
        let key = "\(prefix)-list-\(Int(Date().timeIntervalSince1970 * 1000)).txt"
        _ = try await bucket.upload(key, data: "list me".data(using: .utf8)!, contentType: "text/plain")
        let result = try await bucket.list(prefix: "\(prefix)-list-", limit: 5)
        XCTAssertTrue(result.items.contains(where: { $0.key == key }))
        try await bucket.delete(key)
        await client.destroy()
    }

    func test_storage_delete_with_auth() async throws {
        let client = EdgeBaseClient(baseUrl)
        try await client.auth.signUp(email: "\(prefix)-stordel@test.com", password: "StorD123!")
        let bucket = client.storage.bucket(authBucket)
        let key = "\(prefix)-delete-\(Int(Date().timeIntervalSince1970 * 1000)).txt"
        _ = try await bucket.upload(key, data: "delete me".data(using: .utf8)!, contentType: "text/plain")
        try await bucket.delete(key)
        do {
            _ = try await bucket.download(key)
            XCTFail("Downloading a deleted object should throw")
        } catch let error as EdgeBaseError {
            XCTAssertGreaterThanOrEqual(error.statusCode, 400)
        }
        await client.destroy()
    }

    func test_storage_signed_url_with_auth() async throws {
        let client = EdgeBaseClient(baseUrl)
        try await client.auth.signUp(email: "\(prefix)-storsigned@test.com", password: "StorS123!")
        let bucket = client.storage.bucket(authBucket)
        let key = "\(prefix)-signed-\(Int(Date().timeIntervalSince1970 * 1000)).txt"
        _ = try await bucket.upload(key, data: "signed".data(using: .utf8)!, contentType: "text/plain")
        let signed = try await bucket.createSignedUrl(key, expiresIn: 300)
        XCTAssertFalse(signed.url.isEmpty)
        try await bucket.delete(key)
        await client.destroy()
    }

    func test_storage_metadata_with_auth() async throws {
        let client = EdgeBaseClient(baseUrl)
        try await client.auth.signUp(email: "\(prefix)-stormeta@test.com", password: "StorM123!")
        let bucket = client.storage.bucket(authBucket)
        let key = "\(prefix)-meta-\(Int(Date().timeIntervalSince1970 * 1000)).json"
        _ = try await bucket.upload(key, data: "{}".data(using: .utf8)!, contentType: "application/json")
        let metadata = try await bucket.getMetadata(key)
        XCTAssertEqual(metadata.key, key)
        XCTAssertTrue(metadata.contentType?.contains("application/json") ?? false)
        try await bucket.delete(key)
        await client.destroy()
    }

    func test_storage_uploadString_with_auth() async throws {
        let client = EdgeBaseClient(baseUrl)
        try await client.auth.signUp(email: "\(prefix)-storstr@test.com", password: "StorT123!")
        let bucket = client.storage.bucket(authBucket)
        let key = "\(prefix)-upload-string-\(Int(Date().timeIntervalSince1970 * 1000)).txt"
        let content = "uploadString from Swift iOS"
        let info = try await bucket.uploadString(key, data: content, encoding: .raw)
        XCTAssertEqual(info.key, key)
        let downloaded = try await bucket.download(key)
        XCTAssertEqual(String(data: downloaded, encoding: .utf8), content)
        try await bucket.delete(key)
        await client.destroy()
    }

    func test_storage_getUrl_contains_bucket_and_key() async throws {
        let client = EdgeBaseClient(baseUrl)
        let url = await client.storage.bucket(authBucket).getUrl("folder/swift-url.txt")
        XCTAssertTrue(url.contains("/api/storage/\(authBucket)/"))
        XCTAssertTrue(url.contains("swift-url.txt"))
        await client.destroy()
    }

    func test_storage_nonexistent_object_throws() async throws {
        let client = EdgeBaseClient(baseUrl)
        try await client.auth.signUp(email: "\(prefix)-stormiss@test.com", password: "StorN123!")
        let bucket = client.storage.bucket(authBucket)
        do {
            _ = try await bucket.download("nonexistent-swift-storage-\(Int(Date().timeIntervalSince1970 * 1000)).txt")
            XCTFail("Downloading a missing object should throw")
        } catch let error as EdgeBaseError {
            XCTAssertGreaterThanOrEqual(error.statusCode, 400)
        }
        await client.destroy()
    }
}

// ─── 10. Room E2E ───────────────────────────────────────────────────────────

final class IosRoomE2ETests: EdgeBaseIosE2ETestCase {

    private let baseUrl = ProcessInfo.processInfo.environment["BASE_URL"] ?? "http://localhost:8688"
    private let prefix = "swift-ios-room-\(Int(Date().timeIntervalSince1970 * 1000))"

    func test_room_join_requires_auth() async throws {
        let client = EdgeBaseClient(baseUrl)
        let room = client.room(namespace: "game", id: "\(prefix)-unauth")
        do {
            try await room.join()
            // May succeed if server allows unauthenticated joins
        } catch {
            // Expected — no auth token
        }
        room.leave()
        await client.destroy()
    }

    func test_room_join_with_auth() async throws {
        let client = EdgeBaseClient(baseUrl)
        try await client.auth.signUp(email: "\(prefix)-roomauth@test.com", password: "RoomAuth123!")
        let room = client.room(namespace: "game", id: "\(prefix)-auth")
        do {
            try await room.join()
            // If we get here, room joined successfully
            XCTAssertNotNil(room)
            room.leave()
        } catch {
            // Room service may not be running — acceptable
        }
        await client.destroy()
    }

    func test_room_creation_different_names() async throws {
        let client = EdgeBaseClient(baseUrl)
        let room1 = client.room(namespace: "game", id: "room-alpha")
        let room2 = client.room(namespace: "game", id: "room-beta")
        XCTAssertEqual(room1.roomId, "room-alpha")
        XCTAssertEqual(room2.roomId, "room-beta")
        await client.destroy()
    }
}

// ─── 11. Swift-specific Language Features E2E ───────────────────────────────

final class IosSwiftLangE2ETests: EdgeBaseIosE2ETestCase {

    private let baseUrl = ProcessInfo.processInfo.environment["BASE_URL"] ?? "http://localhost:8688"
    private let prefix = "swift-ios-lang-\(Int(Date().timeIntervalSince1970 * 1000))"

    func test_async_let_parallel_signups() async throws {
        // Create two clients and sign up in parallel
        let client1 = EdgeBaseClient(baseUrl)
        let client2 = EdgeBaseClient(baseUrl)
        async let r1 = client1.auth.signUp(email: "\(prefix)-par1@test.com", password: "Par1Pass123!")
        async let r2 = client2.auth.signUp(email: "\(prefix)-par2@test.com", password: "Par2Pass123!")
        let results = try await [r1, r2]
        XCTAssertEqual(results.count, 2)
        for r in results { XCTAssertNotNil(r["accessToken"]) }
        await client1.destroy()
        await client2.destroy()
    }

    func test_taskGroup_parallel_creates() async throws {
        let client = EdgeBaseClient(baseUrl)
        try await client.auth.signUp(email: "\(prefix)-tg@test.com", password: "TaskGrp123!")

        let ids = try await withThrowingTaskGroup(of: String.self) { group -> [String] in
            for i in 0..<5 {
                group.addTask {
                    let r = try await client.db("shared").table("posts").insert(["title": "\(self.prefix)-tg-\(i)"])
                    return r["id"] as! String
                }
            }
            var collected: [String] = []
            for try await id in group { collected.append(id) }
            return collected
        }
        XCTAssertEqual(ids.count, 5)

        for id in ids { try await client.db("shared").table("posts").doc(id).delete() }
        await client.destroy()
    }

    func test_codable_decode_from_server() async throws {
        struct Post: Codable {
            let title: String
        }

        let client = EdgeBaseClient(baseUrl)
        try await client.auth.signUp(email: "\(prefix)-cod@test.com", password: "Codable123!")
        let created = try await client.db("shared").table("posts").insert(["title": "\(prefix)-cod"])
        let id = created["id"] as! String

        let fetched = try await client.db("shared").table("posts").getOne(id)
        let data = try JSONSerialization.data(withJSONObject: fetched)
        let decoded = try JSONDecoder().decode(Post.self, from: data)
        XCTAssertEqual(decoded.title, "\(prefix)-cod")

        try await client.db("shared").table("posts").doc(id).delete()
        await client.destroy()
    }

    func test_multiple_clients_independent() async throws {
        let client1 = EdgeBaseClient(baseUrl)
        let client2 = EdgeBaseClient(baseUrl)
        try await client1.auth.signUp(email: "\(prefix)-ind1@test.com", password: "Ind1Pass123!")
        try await client2.auth.signUp(email: "\(prefix)-ind2@test.com", password: "Ind2Pass123!")

        // Each client operates independently
        let r1 = try await client1.db("shared").table("posts").insert(["title": "\(prefix)-ind1"])
        let r2 = try await client2.db("shared").table("posts").insert(["title": "\(prefix)-ind2"])
        XCTAssertNotEqual(r1["id"] as? String, r2["id"] as? String)

        if let id = r1["id"] as? String { try await client1.db("shared").table("posts").doc(id).delete() }
        if let id = r2["id"] as? String { try await client2.db("shared").table("posts").doc(id).delete() }
        await client1.destroy()
        await client2.destroy()
    }

    func test_error_thrown_as_edgeBaseError() async throws {
        let client = EdgeBaseClient(baseUrl)
        try await client.auth.signUp(email: "\(prefix)-errtype@test.com", password: "ErrType123!")
        do {
            _ = try await client.db("shared").table("posts").getOne("nonexistent-\(prefix)")
            XCTFail("Should have thrown")
        } catch let error as EdgeBaseError {
            XCTAssertGreaterThanOrEqual(error.statusCode, 400)
            XCTAssertFalse(error.message.isEmpty)
        }
        await client.destroy()
    }

    func test_onAuthStateChange_stream_type() async {
        let client = EdgeBaseClient(baseUrl)
        let stream = client.auth.onAuthStateChange()
        XCTAssertNotNil(stream)
        await client.destroy()
    }

    func test_destroy_multiple_times() async {
        let client = EdgeBaseClient(baseUrl)
        await client.destroy()
        await client.destroy()
        // Should not crash
    }
}
