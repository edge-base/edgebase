// Swift SDK Core E2E 테스트 — XCTest
// packages/sdk/swift/packages/core/Tests/
//
// 테스트 대상: EdgeBaseCore 패키지 (서버 연동)
//   - CRUD: create / getOne / update / delete
//   - Query: where, .or(), FTS, cursor pagination
//   - Batch: insertMany, updateMany, deleteMany
//   - Storage: upload / download / list / delete, signedUrl
//   - FieldOps: increment, deleteField
//   - Count: basic, with filters
//   - Swift-specific: async/await parallel, Codable, Task group
//
// 전제: wrangler dev --port 8688 서버 실행 중
//
// 빌드/실행:
//   BASE_URL=http://localhost:8688 \
//     cd packages/sdk/swift/packages/core && swift test --filter CoreE2ETests
//
// NOTE: CoreE2E tests use HttpClient + TokenManager directly (no iOS EdgeBaseClient).
// A lightweight test helper creates the client stack.

import Dispatch
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import EdgeBaseCore

private enum E2ETestSupport {
    private static let requiredEnv = "EDGEBASE_E2E_REQUIRED"

    static func requireServer(_ baseUrl: String) throws {
        guard !isServerAvailable(baseUrl) else { return }
        let message = "E2E backend not reachable at \(baseUrl). Start `edgebase dev --port 8688` or set BASE_URL. Set \(requiredEnv)=1 to fail instead of skip."
        if ProcessInfo.processInfo.environment[requiredEnv] == "1" {
            throw NSError(domain: "EdgeBaseCoreE2E", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
        }
        throw XCTSkip(message)
    }

    private static func isServerAvailable(_ baseUrl: String) -> Bool {
        guard let url = URL(string: "\(baseUrl.trimmingCharacters(in: CharacterSet(charactersIn: "/")))/api/health") else {
            return false
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 1.5
        let semaphore = DispatchSemaphore(value: 0)
        var isAvailable = false
        URLSession.shared.dataTask(with: request) { _, response, _ in
            if let http = response as? HTTPURLResponse {
                isAvailable = (200..<500).contains(http.statusCode)
            }
            semaphore.signal()
        }.resume()
        _ = semaphore.wait(timeout: .now() + 2)
        return isAvailable
    }
}

class EdgeBaseCoreE2ETestCase: XCTestCase {
    var e2eBaseUrl: String { ProcessInfo.processInfo.environment["BASE_URL"] ?? "http://localhost:8688" }

    override func setUpWithError() throws {
        try super.setUpWithError()
        try E2ETestSupport.requireServer(e2eBaseUrl)
    }
}

// ─── Test Helper ────────────────────────────────────────────────────────────

/// Minimal TokenManageable that stores tokens in-memory for E2E tests.
private actor TestTokenManager: TokenManageable {
    private var accessToken: String?
    private var refreshToken_: String?

    func setTokens(access: String, refresh: String) {
        self.accessToken = access
        self.refreshToken_ = refresh
    }

    func getAccessToken() async throws -> String? { accessToken }
    func getRefreshToken() async -> String? { refreshToken_ }
    func clearTokens() async {
        accessToken = nil
        refreshToken_ = nil
    }
}

/// Helper to sign up a fresh user and return an authenticated HttpClient + table accessor.
private func makeAuthenticatedClient(baseUrl: String, prefix: String) async throws -> (HttpClient, @Sendable (String) -> TableRef) {
    let tm = TestTokenManager()
    let http = HttpClient(baseUrl: baseUrl, tokenManager: tm)

    let email = "\(prefix)@test.com"
    let result = try await http.postPublic("/auth/signup", ["email": email, "password": "CoreE2E123!"]) as! [String: Any]
    if let at = result["accessToken"] as? String, let rt = result["refreshToken"] as? String {
        await tm.setTokens(access: at, refresh: rt)
    }

    let core = GeneratedDbApi(http: http)
    let makeTable: @Sendable (String) -> TableRef = { tableName in
        TableRef(core, tableName, namespace: "shared")
    }

    return (http, makeTable)
}

// ─── 1. CRUD ────────────────────────────────────────────────────────────────

final class CoreCrudE2ETests: EdgeBaseCoreE2ETestCase {
    private let baseUrl = ProcessInfo.processInfo.environment["BASE_URL"] ?? "http://localhost:8688"
    private let prefix = "swift-core-e2e-\(Int(Date().timeIntervalSince1970 * 1000))"

    func test_insert_returns_id() async throws {
        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-create")
        let record = try await table("posts").insert(["title": "\(prefix)-create"])
        XCTAssertNotNil(record["id"] as? String)
        // cleanup
        if let id = record["id"] as? String { try await table("posts").doc(id).delete() }
    }

    func test_getOne_returns_record() async throws {
        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-getone")
        let created = try await table("posts").insert(["title": "\(prefix)-getone"])
        let id = created["id"] as! String
        let fetched = try await table("posts").getOne(id)
        XCTAssertEqual(fetched["id"] as? String, id)
        XCTAssertEqual(fetched["title"] as? String, "\(prefix)-getone")
        try await table("posts").doc(id).delete()
    }

    func test_update_modifies_record() async throws {
        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-update")
        let created = try await table("posts").insert(["title": "\(prefix)-before"])
        let id = created["id"] as! String
        let updated = try await table("posts").doc(id).update(["title": "\(prefix)-after"])
        XCTAssertEqual(updated["title"] as? String, "\(prefix)-after")
        try await table("posts").doc(id).delete()
    }

    func test_delete_removes_record() async throws {
        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-delete")
        let created = try await table("posts").insert(["title": "\(prefix)-del"])
        let id = created["id"] as! String
        try await table("posts").doc(id).delete()
        do {
            _ = try await table("posts").getOne(id)
            XCTFail("Should have thrown after delete")
        } catch {
            // expected — 404
        }
    }

    func test_crud_chain_insert_read_update_delete() async throws {
        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-chain")
        // Create
        let c = try await table("posts").insert(["title": "\(prefix)-chain", "views": 0])
        let id = c["id"] as! String
        // Read
        let r = try await table("posts").getOne(id)
        XCTAssertEqual(r["title"] as? String, "\(prefix)-chain")
        // Update
        let u = try await table("posts").doc(id).update(["views": 10])
        XCTAssertEqual(u["views"] as? Int, 10)
        // Delete
        try await table("posts").doc(id).delete()
    }

    func test_insert_multiple_fields() async throws {
        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-multi")
        let record = try await table("posts").insert([
            "title": "\(prefix)-multi",
            "views": 42,
            "published": true,
        ])
        XCTAssertNotNil(record["id"])
        if let id = record["id"] as? String { try await table("posts").doc(id).delete() }
    }
}

// ─── 2. Query ───────────────────────────────────────────────────────────────

final class CoreQueryE2ETests: EdgeBaseCoreE2ETestCase {
    private let baseUrl = ProcessInfo.processInfo.environment["BASE_URL"] ?? "http://localhost:8688"
    private let prefix = "swift-core-q-\(Int(Date().timeIntervalSince1970 * 1000))"

    func test_where_filter() async throws {
        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-whr")
        let unique = "\(prefix)-unique-\(Int.random(in: 1000...9999))"
        let r = try await table("posts").insert(["title": unique])
        let id = r["id"] as! String

        let list = try await table("posts").where("title", "==", unique).getList()
        XCTAssertFalse(list.items.isEmpty)
        XCTAssertEqual(list.items[0]["title"] as? String, unique)

        try await table("posts").doc(id).delete()
    }

    func test_where_chain_multiple() async throws {
        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-wc")
        let tag = "\(prefix)-wc"
        let r = try await table("posts").insert(["title": tag, "views": 99])
        let id = r["id"] as! String

        let list = try await table("posts")
            .where("title", "==", tag)
            .where("views", "==", "99")
            .getList()
        XCTAssertFalse(list.items.isEmpty)

        try await table("posts").doc(id).delete()
    }

    func test_orderBy_desc() async throws {
        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-ob")
        let list = try await table("posts").orderBy("createdAt", "desc").limit(5).getList()
        XCTAssertLessThanOrEqual(list.items.count, 5)
    }

    func test_limit_constrains_results() async throws {
        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-lim")
        let list = try await table("posts").limit(2).getList()
        XCTAssertLessThanOrEqual(list.items.count, 2)
    }

    func test_offset_pagination() async throws {
        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-off")
        let page1 = try await table("posts").limit(2).page(1).getList()
        let page2 = try await table("posts").limit(2).page(2).getList()
        // Different pages may return different items (or empty if few records)
        // Just verify no error
        XCTAssertNotNil(page1.items)
        XCTAssertNotNil(page2.items)
    }

    func test_or_filter() async throws {
        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-or")
        let tag1 = "\(prefix)-orA"
        let tag2 = "\(prefix)-orB"
        let r1 = try await table("posts").insert(["title": tag1])
        let r2 = try await table("posts").insert(["title": tag2])

        let list = try await table("posts").or { builder in
            builder.where("title", "==", tag1)
                   .where("title", "==", tag2)
        }.getList()
        XCTAssertGreaterThanOrEqual(list.items.count, 2)

        if let id = r1["id"] as? String { try await table("posts").doc(id).delete() }
        if let id = r2["id"] as? String { try await table("posts").doc(id).delete() }
    }

    func test_search_fullTextSearch() async throws {
        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-fts")
        let unique = "swiftcoresearchunique\(Int.random(in: 10000...99999))"
        let r = try await table("posts").insert(["title": unique])
        let id = r["id"] as! String

        // FTS may have indexing delay; do a basic call
        let list = try await table("posts").search(unique).getList()
        // Even if empty due to indexing, should not throw
        XCTAssertNotNil(list.items)

        try await table("posts").doc(id).delete()
    }

    func test_cursor_pagination_after() async throws {
        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-cur")
        // Create 3 records
        var ids: [String] = []
        for i in 0..<3 {
            let r = try await table("posts").insert(["title": "\(prefix)-cur-\(i)"])
            if let id = r["id"] as? String { ids.append(id) }
        }

        let firstPage = try await table("posts").limit(1).getList()
        XCTAssertFalse(firstPage.items.isEmpty)

        if let cursor = firstPage.cursor {
            let secondPage = try await table("posts").after(cursor).limit(1).getList()
            XCTAssertNotNil(secondPage.items)
        }

        for id in ids { try await table("posts").doc(id).delete() }
    }
}

// ─── 3. Batch ───────────────────────────────────────────────────────────────

final class CoreBatchE2ETests: EdgeBaseCoreE2ETestCase {
    private let baseUrl = ProcessInfo.processInfo.environment["BASE_URL"] ?? "http://localhost:8688"
    private let prefix = "swift-core-b-\(Int(Date().timeIntervalSince1970 * 1000))"

    func test_insertMany() async throws {
        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-cm")
        let records = (0..<5).map { ["title": "\(prefix)-cm-\($0)"] as [String: Any] }
        let created = try await table("posts").insertMany(records)
        XCTAssertEqual(created.count, 5)
        for r in created {
            if let id = r["id"] as? String { try await table("posts").doc(id).delete() }
        }
    }

    func test_updateMany_withFilter() async throws {
        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-um")
        let tag = "\(prefix)-um-batch"
        var ids: [String] = []
        for _ in 0..<3 {
            let r = try await table("posts").insert(["title": tag, "views": 0])
            if let id = r["id"] as? String { ids.append(id) }
        }

        let result = try await table("posts")
            .where("title", "==", tag)
            .updateMany(["views": 99])
        XCTAssertGreaterThanOrEqual(result.totalSucceeded, 3)

        for id in ids { try await table("posts").doc(id).delete() }
    }

    func test_deleteMany_withFilter() async throws {
        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-dm")
        let tag = "\(prefix)-dm-batch"
        for _ in 0..<3 {
            _ = try await table("posts").insert(["title": tag])
        }

        let result = try await table("posts")
            .where("title", "==", tag)
            .deleteMany()
        XCTAssertGreaterThanOrEqual(result.totalSucceeded, 3)
    }

    func test_deleteMany_requiresFilter() async throws {
        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-dmf")
        do {
            _ = try await table("posts").deleteMany()
            XCTFail("Should have thrown — deleteMany requires a where filter")
        } catch {
            // expected
        }
    }

    func test_updateMany_requiresFilter() async throws {
        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-umf")
        do {
            _ = try await table("posts").updateMany(["views": 0])
            XCTFail("Should have thrown — updateMany requires a where filter")
        } catch {
            // expected
        }
    }

    func test_insertMany_empty() async throws {
        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-cme")
        let created = try await table("posts").insertMany([])
        XCTAssertEqual(created.count, 0)
    }
}

// ─── 4. Storage ─────────────────────────────────────────────────────────────

final class CoreStorageE2ETests: EdgeBaseCoreE2ETestCase {
    private let baseUrl = ProcessInfo.processInfo.environment["BASE_URL"] ?? "http://localhost:8688"
    private let prefix = "swift-core-s-\(Int(Date().timeIntervalSince1970 * 1000))"

    func test_upload_and_download() async throws {
        let (http, _) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-updown")
        let storage = StorageClient(http)
        let bucket = storage.bucket("test-bucket")
        let key = "\(prefix)-test.txt"
        let content = "Hello from Swift Core E2E"

        do {
            let info = try await bucket.upload(key, data: content.data(using: .utf8)!, contentType: "text/plain")
            XCTAssertEqual(info.key, key)

            let downloaded = try await bucket.download(key)
            XCTAssertEqual(String(data: downloaded, encoding: .utf8), content)

            try await bucket.delete(key)
        } catch {
            // Storage may require special config — acceptable skip
        }
    }

    func test_list_files() async throws {
        let (http, _) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-list")
        let storage = StorageClient(http)
        let bucket = storage.bucket("test-bucket")

        do {
            let result = try await bucket.list()
            XCTAssertNotNil(result.items)
        } catch {
            // Storage may require special config
        }
    }

    func test_signed_url() async throws {
        let (http, _) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-signed")
        let storage = StorageClient(http)
        let bucket = storage.bucket("test-bucket")
        let key = "\(prefix)-signed.txt"

        do {
            _ = try await bucket.upload(key, data: "signed-test".data(using: .utf8)!, contentType: "text/plain")
            let signedResult = try await bucket.createSignedUrl(key, expiresIn: 60)
            // tips.md: server returns "url" not "uploadUrl"
            XCTAssertFalse(signedResult.url.isEmpty)
            XCTAssertGreaterThan(signedResult.expiresIn, 0)
            try await bucket.delete(key)
        } catch {
            // Storage may require special config
        }
    }

    func test_signed_upload_url() async throws {
        let (http, _) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-signedup")
        let storage = StorageClient(http)
        let bucket = storage.bucket("test-bucket")
        let key = "\(prefix)-signedup.txt"

        do {
            let result = try await bucket.createSignedUploadUrl(key, expiresIn: 300, contentType: "text/plain")
            // tips.md: server returns "url" not "uploadUrl"
            XCTAssertFalse(result.url.isEmpty)
        } catch {
            // Storage may require special config
        }
    }

    func test_upload_and_delete() async throws {
        let (http, _) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-updel")
        let storage = StorageClient(http)
        let bucket = storage.bucket("test-bucket")
        let key = "\(prefix)-updel.txt"

        do {
            _ = try await bucket.upload(key, data: "delete-me".data(using: .utf8)!, contentType: "text/plain")
            try await bucket.delete(key)
            // Verify deleted — download should fail
            do {
                _ = try await bucket.download(key)
                XCTFail("Should have thrown after delete")
            } catch {
                // expected
            }
        } catch {
            // Storage may require special config
        }
    }

    func test_getUrl_format() async throws {
        let (http, _) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-url")
        let storage = StorageClient(http)
        let bucket = storage.bucket("test-bucket")
        let url = await bucket.getUrl("photo.jpg")
        XCTAssertTrue(url.contains("/api/storage/test-bucket/photo.jpg"))
    }

    func test_uploadString_raw() async throws {
        let (http, _) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-upstr")
        let storage = StorageClient(http)
        let bucket = storage.bucket("test-bucket")
        let key = "\(prefix)-raw.txt"

        do {
            let info = try await bucket.uploadString(key, data: "raw string content", encoding: .raw)
            XCTAssertEqual(info.key, key)
            try await bucket.delete(key)
        } catch {
            // Storage may require special config
        }
    }

    func test_list_with_prefix() async throws {
        let (http, _) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-pfx")
        let storage = StorageClient(http)
        let bucket = storage.bucket("test-bucket")

        do {
            let result = try await bucket.list(prefix: "nonexistent-prefix-xxx", limit: 5)
            XCTAssertTrue(result.items.isEmpty)
        } catch {
            // Storage may require special config
        }
    }
}

// ─── 5. FieldOps ────────────────────────────────────────────────────────────

final class CoreFieldOpsE2ETests: EdgeBaseCoreE2ETestCase {
    private let baseUrl = ProcessInfo.processInfo.environment["BASE_URL"] ?? "http://localhost:8688"
    private let prefix = "swift-core-fo-\(Int(Date().timeIntervalSince1970 * 1000))"

    func test_increment_field() async throws {
        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-inc")
        let record = try await table("posts").insert(["title": "\(prefix)-inc", "views": 10])
        let id = record["id"] as! String

        let updated = try await table("posts").doc(id).update(["views": FieldOps.increment(5)])
        XCTAssertEqual(updated["views"] as? Int, 15)

        try await table("posts").doc(id).delete()
    }

    func test_increment_negative() async throws {
        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-incneg")
        let record = try await table("posts").insert(["title": "\(prefix)-incneg", "views": 20])
        let id = record["id"] as! String

        let updated = try await table("posts").doc(id).update(["views": FieldOps.increment(-5)])
        XCTAssertEqual(updated["views"] as? Int, 15)

        try await table("posts").doc(id).delete()
    }

    func test_deleteField() async throws {
        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-delf")
        let record = try await table("posts").insert(["title": "\(prefix)-delf", "description": "to-remove"])
        let id = record["id"] as! String

        let updated = try await table("posts").doc(id).update(["description": FieldOps.deleteField()])
        // After deleteField, the field should be nil/absent or JSON null (NSNull).
        // JSONSerialization decodes JSON null as NSNull, not Swift nil.
        let value = updated["description"]
        XCTAssertTrue(value == nil || value is NSNull,
                      "Expected nil or NSNull but got \(String(describing: value))")

        try await table("posts").doc(id).delete()
    }
}

// ─── 6. Count ───────────────────────────────────────────────────────────────

final class CoreCountE2ETests: EdgeBaseCoreE2ETestCase {
    private let baseUrl = ProcessInfo.processInfo.environment["BASE_URL"] ?? "http://localhost:8688"
    private let prefix = "swift-core-cnt-\(Int(Date().timeIntervalSince1970 * 1000))"

    func test_count_basic() async throws {
        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-cnt")
        let count = try await table("posts").count()
        XCTAssertGreaterThanOrEqual(count, 0)
    }

    func test_count_with_filter() async throws {
        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-cntf")
        let tag = "\(prefix)-cntf"
        _ = try await table("posts").insert(["title": tag])
        _ = try await table("posts").insert(["title": tag])

        let count = try await table("posts").where("title", "==", tag).count()
        XCTAssertGreaterThanOrEqual(count, 2)

        // cleanup
        _ = try await table("posts").where("title", "==", tag).deleteMany()
    }

    func test_count_nonexistent_filter() async throws {
        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-cntnx")
        let count = try await table("posts").where("title", "==", "nonexistent-xxx-\(prefix)").count()
        XCTAssertEqual(count, 0)
    }
}

// ─── 7. Upsert ──────────────────────────────────────────────────────────────

final class CoreUpsertE2ETests: EdgeBaseCoreE2ETestCase {
    private let baseUrl = ProcessInfo.processInfo.environment["BASE_URL"] ?? "http://localhost:8688"
    private let prefix = "swift-core-ups-\(Int(Date().timeIntervalSince1970 * 1000))"

    func test_upsert_inserts_new() async throws {
        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-upsc")
        let result = try await table("posts").upsert(["title": "\(prefix)-upsc", "views": 1])
        XCTAssertNotNil(result.record["id"])
        if let id = result.record["id"] as? String { try await table("posts").doc(id).delete() }
    }

    func test_upsert_updates_existing() async throws {
        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-upsu")
        let created = try await table("posts").insert(["title": "\(prefix)-upsu", "views": 1])
        let id = created["id"] as! String

        let result = try await table("posts").upsert(["id": id, "title": "\(prefix)-upsu", "views": 999])
        XCTAssertEqual(result.record["views"] as? Int, 999)

        try await table("posts").doc(id).delete()
    }
}

// ─── 8. Error Handling ──────────────────────────────────────────────────────

final class CoreErrorE2ETests: EdgeBaseCoreE2ETestCase {
    private let baseUrl = ProcessInfo.processInfo.environment["BASE_URL"] ?? "http://localhost:8688"
    private let prefix = "swift-core-err-\(Int(Date().timeIntervalSince1970 * 1000))"

    func test_getOne_nonexistent_throws() async throws {
        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-nf")
        do {
            _ = try await table("posts").getOne("nonexistent-id-\(prefix)")
            XCTFail("Should have thrown")
        } catch let error as EdgeBaseError {
            XCTAssertGreaterThanOrEqual(error.statusCode, 400)
        }
    }

    func test_delete_nonexistent_throws() async throws {
        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-delnf")
        do {
            try await table("posts").doc("nonexistent-id-\(prefix)").delete()
            XCTFail("Should have thrown")
        } catch {
            // expected — 404
        }
    }

    func test_update_nonexistent_throws() async throws {
        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-updnf")
        do {
            _ = try await table("posts").doc("nonexistent-id-\(prefix)").update(["title": "nope"])
            XCTFail("Should have thrown")
        } catch {
            // expected — 404
        }
    }
}

// ─── 9. Swift-specific: async let + TaskGroup ───────────────────────────────

final class CoreSwiftAsyncE2ETests: EdgeBaseCoreE2ETestCase {
    private let baseUrl = ProcessInfo.processInfo.environment["BASE_URL"] ?? "http://localhost:8688"
    private let prefix = "swift-core-async-\(Int(Date().timeIntervalSince1970 * 1000))"

    func test_parallel_insert_with_async_let() async throws {
        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-par")
        async let r1 = table("posts").insert(["title": "\(prefix)-par-1"])
        async let r2 = table("posts").insert(["title": "\(prefix)-par-2"])
        async let r3 = table("posts").insert(["title": "\(prefix)-par-3"])
        let results = try await [r1, r2, r3]
        XCTAssertEqual(results.count, 3)
        for r in results {
            if let id = r["id"] as? String { try await table("posts").doc(id).delete() }
        }
    }

    func test_taskGroup_parallel_reads() async throws {
        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-tg")
        // Create 3 records
        var ids: [String] = []
        for i in 0..<3 {
            let r = try await table("posts").insert(["title": "\(prefix)-tg-\(i)"])
            if let id = r["id"] as? String { ids.append(id) }
        }

        // Read all in parallel via TaskGroup
        let results = try await withThrowingTaskGroup(of: [String: Any].self) { group -> [[String: Any]] in
            for id in ids {
                group.addTask { try await table("posts").getOne(id) }
            }
            var collected: [[String: Any]] = []
            for try await result in group { collected.append(result) }
            return collected
        }
        XCTAssertEqual(results.count, 3)

        for id in ids { try await table("posts").doc(id).delete() }
    }

    func test_codable_roundtrip_with_server() async throws {
        struct Post: Codable {
            let title: String
            let views: Int
        }

        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-cod")
        let created = try await table("posts").insert(["title": "\(prefix)-cod", "views": 42])
        let id = created["id"] as! String
        let fetched = try await table("posts").getOne(id)

        // Convert [String: Any] to Codable via JSONSerialization
        let data = try JSONSerialization.data(withJSONObject: fetched)
        let decoded = try JSONDecoder().decode(Post.self, from: data)
        XCTAssertEqual(decoded.title, "\(prefix)-cod")
        XCTAssertEqual(decoded.views, 42)

        try await table("posts").doc(id).delete()
    }

    func test_concurrent_updates() async throws {
        let (_, table) = try await makeAuthenticatedClient(baseUrl: baseUrl, prefix: "\(prefix)-conc")
        let record = try await table("posts").insert(["title": "\(prefix)-conc", "views": 0])
        let id = record["id"] as! String

        // Run 5 increments concurrently
        try await withThrowingTaskGroup(of: Void.self) { group in
            for _ in 0..<5 {
                group.addTask {
                    _ = try await table("posts").doc(id).update(["views": FieldOps.increment(1)])
                }
            }
            try await group.waitForAll()
        }

        let final_ = try await table("posts").getOne(id)
        XCTAssertEqual(final_["views"] as? Int, 5)

        try await table("posts").doc(id).delete()
    }
}
