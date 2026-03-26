// Swift SDK 단위 테스트 — XCTest
// packages/sdk/swift/packages/core/Tests/
//
// 테스트 대상: EdgeBaseCore 패키지
//   - FilterTuple (toJSON 직렬화, value String 변환)
//   - OrBuilder (where 체인, getFilters)
//   - ListResult (옵셔널 필드, items)
//   - UpsertResult (record/created)
//   - DbChange (fromJSON 파싱)
//   - EdgeBaseError (statusCode/message/errorDescription/fromJSON)
//   - EdgeBaseAuthError
//
// 빌드/실행:
//   cd packages/sdk/swift/packages/core
//   swift test --filter EdgeBaseCoreUnitTests
//
// Package.swift 설정 필요:
//   .testTarget(name: "EdgeBaseCoreUnitTests", dependencies: ["EdgeBaseCore"])

import XCTest
@testable import EdgeBaseCore

// ─── 1. FilterTuple ──────────────────────────────────────────────────────────

final class FilterTupleUnitTests: XCTestCase {
    func testToJSON_fieldsMatch() {
        let f = FilterTuple("status", "==", "published")
        let j = f.toJSON()
        XCTAssertEqual(j.count, 3)
        XCTAssertEqual(j[0] as? String, "status")
        XCTAssertEqual(j[1] as? String, "==")
        XCTAssertEqual(j[2] as? String, "published")
    }

    func testToJSON_numericValueConvertedToString() {
        let f = FilterTuple("views", ">", 100)
        let j = f.toJSON()
        // value is always stored as String for Sendable conformance
        XCTAssertEqual(j[2] as? String, "100")
    }

    func testConstructor_storesAllFields() {
        let f = FilterTuple("email", "contains", "@test.com")
        XCTAssertEqual(f.field, "email")
        XCTAssertEqual(f.op, "contains")
        XCTAssertEqual(f.value, "@test.com")
    }

    func testToJSON_boolValueString() {
        let f = FilterTuple("active", "==", true)
        let j = f.toJSON()
        XCTAssertEqual(j[2] as? String, "true")
    }

    func testToJSON_gtOperator() {
        let f = FilterTuple("age", ">=", 18)
        let j = f.toJSON()
        XCTAssertEqual(j[0] as? String, "age")
        XCTAssertEqual(j[1] as? String, ">=")
    }

    func testToJSON_inOperator() {
        let f = FilterTuple("role", "in", ["admin", "mod"])
        let j = f.toJSON()
        XCTAssertNotNil(j[2]) // serialized as string representation
    }
}

// ─── 2. OrBuilder ────────────────────────────────────────────────────────────

final class OrBuilderUnitTests: XCTestCase {
    func testWhereChain_addsFilter() {
        let or = OrBuilder()
        or.where("status", "==", "active")
        XCTAssertEqual(or.getFilters().count, 1)
    }

    func testWhereChain_multipleFilters() {
        let or = OrBuilder()
        or.where("status", "==", "active")
            .where("role", "==", "admin")
        XCTAssertEqual(or.getFilters().count, 2)
    }

    func testWhereChain_returnsBuilder() {
        let or = OrBuilder()
        let returned = or.where("status", "==", "active")
        XCTAssertTrue(returned === or) // same instance (returns Self)
    }

    func testGetFilters_empty() {
        let or = OrBuilder()
        XCTAssertEqual(or.getFilters().count, 0)
    }

    func testGetFilters_preservesOrder() {
        let or = OrBuilder()
        or.where("a", "==", "1").where("b", "==", "2")
        let filters = or.getFilters()
        XCTAssertEqual(filters[0].field, "a")
        XCTAssertEqual(filters[1].field, "b")
    }
}

// ─── 3. ListResult ───────────────────────────────────────────────────────────

final class ListResultUnitTests: XCTestCase {
    func testOffsetMode_allFieldsPopulated() {
        let r = ListResult(items: [], total: 100, page: 2, perPage: 20, hasMore: nil, cursor: nil)
        XCTAssertEqual(r.total, 100)
        XCTAssertEqual(r.page, 2)
        XCTAssertEqual(r.perPage, 20)
        XCTAssertNil(r.hasMore)
        XCTAssertNil(r.cursor)
    }

    func testCursorMode_hasMoreAndCursor() {
        let r = ListResult(items: [], total: nil, page: nil, perPage: nil, hasMore: true, cursor: "cursor-abc")
        XCTAssertNil(r.total)
        XCTAssertTrue(r.hasMore == true)
        XCTAssertEqual(r.cursor, "cursor-abc")
    }

    func testItems_populated() {
        let items: [[String: Any]] = [
            ["id": "1", "title": "Post 1"],
            ["id": "2", "title": "Post 2"],
        ]
        let r = ListResult(items: items, total: 2, page: 1, perPage: 20, hasMore: nil, cursor: nil)
        XCTAssertEqual(r.items.count, 2)
        XCTAssertEqual(r.items[0]["id"] as? String, "1")
    }

    func testItems_empty() {
        let r = ListResult(items: [], total: 0, page: 1, perPage: 20, hasMore: nil, cursor: nil)
        XCTAssertTrue(r.items.isEmpty)
    }

    func testHasMore_false() {
        let r = ListResult(items: [], total: 5, page: 1, perPage: 10, hasMore: false, cursor: nil)
        XCTAssertEqual(r.hasMore, false)
    }
}

// ─── 4. DbChange ─────────────────────────────────────────────────────────────

final class DbChangeUnitTests: XCTestCase {
    func testFromJSON_typeTableId() {
        let json: [String: Any] = ["type": "INSERT", "table": "posts", "id": "post-123"]
        let dc = DbChange.fromJSON(json)
        XCTAssertEqual(dc.type, "INSERT")
        XCTAssertEqual(dc.table, "posts")
        XCTAssertEqual(dc.id, "post-123")
    }

    func testFromJSON_missingType_defaults() {
        let json: [String: Any] = ["table": "posts"]
        let dc = DbChange.fromJSON(json)
        XCTAssertEqual(dc.type, "UNKNOWN")
    }

    func testFromJSON_missingTable_defaults() {
        let json: [String: Any] = ["type": "DELETE"]
        let dc = DbChange.fromJSON(json)
        XCTAssertEqual(dc.table, "")
    }

    func testFromJSON_record() {
        let json: [String: Any] = ["type": "UPDATE", "table": "posts", "record": ["title": "New"]]
        let dc = DbChange.fromJSON(json)
        XCTAssertEqual(dc.record?["title"] as? String, "New")
    }

    func testFromJSON_oldRecord() {
        let json: [String: Any] = ["type": "UPDATE", "table": "posts", "old_record": ["title": "Old"]]
        let dc = DbChange.fromJSON(json)
        XCTAssertEqual(dc.oldRecord?["title"] as? String, "Old")
    }

    func testDirectInit() {
        let dc = DbChange(type: "INSERT", table: "users", id: "u-1")
        XCTAssertEqual(dc.type, "INSERT")
        XCTAssertEqual(dc.id, "u-1")
        XCTAssertNil(dc.record)
    }
}

// ─── 5. EdgeBaseError ────────────────────────────────────────────────────────

final class EdgeBaseErrorUnitTests: XCTestCase {
    func testDirectInit_statusAndMessage() {
        let err = EdgeBaseError(statusCode: 404, message: "Not found")
        XCTAssertEqual(err.statusCode, 404)
        XCTAssertEqual(err.message, "Not found")
        XCTAssertNil(err.details)
    }

    func testErrorDescription_containsStatusCode() {
        let err = EdgeBaseError(statusCode: 400, message: "Validation failed")
        XCTAssertTrue(err.errorDescription?.contains("400") == true)
        XCTAssertTrue(err.errorDescription?.contains("Validation failed") == true)
    }

    func testErrorDescription_withDetails() {
        let err = EdgeBaseError(statusCode: 422, message: "Invalid", details: ["email": ["Required"]])
        XCTAssertTrue(err.errorDescription?.contains("email") == true)
    }

    func testFromJSON_messageField() throws {
        let json = "{\"message\": \"Record not found\"}".data(using: .utf8)!
        let err = EdgeBaseError.fromJSON(json, statusCode: 404)
        XCTAssertEqual(err.statusCode, 404)
        XCTAssertEqual(err.message, "Record not found")
    }

    func testFromJSON_errorField_fallback() throws {
        let json = "{\"error\": \"Unauthorized\"}".data(using: .utf8)!
        let err = EdgeBaseError.fromJSON(json, statusCode: 401)
        XCTAssertEqual(err.message, "Unauthorized")
    }

    func testFromJSON_invalidJSON_defaultMessage() throws {
        let json = "invalid-json".data(using: .utf8)!
        let err = EdgeBaseError.fromJSON(json, statusCode: 500)
        XCTAssertEqual(err.message, "Request failed with HTTP 500 and a non-JSON error response.")
    }

    func testFromJSON_withDetails() throws {
        let json = "{\"message\":\"Validation error\",\"details\":{\"email\":[\"Required\"]}}".data(using: .utf8)!
        let err = EdgeBaseError.fromJSON(json, statusCode: 422)
        XCTAssertEqual(err.details?["email"]?.first, "Required")
    }

    func testError_isErrorProtocol() {
        let err: Error = EdgeBaseError(statusCode: 500, message: "Server error")
        XCTAssertNotNil(err)
    }
}

// ─── 6. EdgeBaseAuthError ────────────────────────────────────────────────────

final class EdgeBaseAuthErrorUnitTests: XCTestCase {
    func testInit_statusAndMessage() {
        let err = EdgeBaseAuthError(statusCode: 401, message: "Token expired")
        XCTAssertEqual(err.statusCode, 401)
        XCTAssertEqual(err.message, "Token expired")
    }

    func testErrorDescription() {
        let err = EdgeBaseAuthError(statusCode: 403, message: "Forbidden")
        XCTAssertTrue(err.errorDescription?.contains("403") == true)
        XCTAssertTrue(err.errorDescription?.contains("Forbidden") == true)
    }

    func testAuthError_isErrorProtocol() {
        let err: Error = EdgeBaseAuthError(statusCode: 401, message: "Test")
        XCTAssertNotNil(err)
    }

    func testAuthError_statusCode_range() {
        for code in [400, 401, 403, 404, 500] {
            let err = EdgeBaseAuthError(statusCode: code, message: "msg")
            XCTAssertEqual(err.statusCode, code)
        }
    }
}

// ─── 7. UpsertResult ────────────────────────────────────────────────────────

final class UpsertResultUnitTests: XCTestCase {
    func testInserted_true() {
        let r = UpsertResult(record: ["id": "u-1", "name": "Test"], inserted: true)
        XCTAssertTrue(r.inserted)
        XCTAssertEqual(r.record["id"] as? String, "u-1")
    }

    func testInserted_false() {
        let r = UpsertResult(record: ["id": "u-1"], inserted: false)
        XCTAssertFalse(r.inserted)
    }

    func testRecord_containsFields() {
        let r = UpsertResult(record: ["id": "x", "title": "Hello", "views": 42], inserted: true)
        XCTAssertEqual(r.record["title"] as? String, "Hello")
        XCTAssertEqual(r.record["views"] as? Int, 42)
    }
}

// ─── 8. BatchResult ─────────────────────────────────────────────────────────

final class BatchResultUnitTests: XCTestCase {
    func testAllSuccess() {
        let br = BatchResult(totalProcessed: 10, totalSucceeded: 10, errors: [])
        XCTAssertEqual(br.totalProcessed, 10)
        XCTAssertEqual(br.totalSucceeded, 10)
        XCTAssertTrue(br.errors.isEmpty)
    }

    func testPartialFailure() {
        let br = BatchResult(totalProcessed: 10, totalSucceeded: 7,
                             errors: [["chunkIndex": 0, "error": "timeout"]])
        XCTAssertEqual(br.totalProcessed, 10)
        XCTAssertEqual(br.totalSucceeded, 7)
        XCTAssertEqual(br.errors.count, 1)
    }

    func testZeroProcessed() {
        let br = BatchResult(totalProcessed: 0, totalSucceeded: 0, errors: [])
        XCTAssertEqual(br.totalProcessed, 0)
    }
}

// ─── 9. StorageTypes ────────────────────────────────────────────────────────

final class StorageTypesUnitTests: XCTestCase {
    func testFileInfo_fromJSON_allFields() {
        let json: [String: Any] = [
            "key": "photos/cat.jpg",
            "size": 12345,
            "contentType": "image/jpeg",
            "etag": "abc123",
            "lastModified": "2024-01-01T00:00:00Z",
            "customMetadata": ["author": "test"],
        ]
        let fi = FileInfo.fromJSON(json)
        XCTAssertEqual(fi.key, "photos/cat.jpg")
        XCTAssertEqual(fi.size, 12345)
        XCTAssertEqual(fi.contentType, "image/jpeg")
        XCTAssertEqual(fi.etag, "abc123")
        XCTAssertEqual(fi.lastModified, "2024-01-01T00:00:00Z")
        XCTAssertEqual(fi.customMetadata?["author"], "test")
    }

    func testFileInfo_fromJSON_minimalFields() {
        let json: [String: Any] = ["key": "file.txt", "size": 0]
        let fi = FileInfo.fromJSON(json)
        XCTAssertEqual(fi.key, "file.txt")
        XCTAssertEqual(fi.size, 0)
        XCTAssertNil(fi.contentType)
        XCTAssertNil(fi.etag)
    }

    func testFileInfo_fromJSON_missingKey_defaults() {
        let json: [String: Any] = [:]
        let fi = FileInfo.fromJSON(json)
        XCTAssertEqual(fi.key, "")
        XCTAssertEqual(fi.size, 0)
    }

    func testFileListResult_populated() {
        let items = [FileInfo(key: "a.txt", size: 1), FileInfo(key: "b.txt", size: 2)]
        let result = FileListResult(items: items, hasMore: true, cursor: "next-page")
        XCTAssertEqual(result.items.count, 2)
        XCTAssertTrue(result.hasMore)
        XCTAssertEqual(result.cursor, "next-page")
    }

    func testFileListResult_empty() {
        let result = FileListResult(items: [], hasMore: false, cursor: nil)
        XCTAssertTrue(result.items.isEmpty)
        XCTAssertFalse(result.hasMore)
        XCTAssertNil(result.cursor)
    }

    func testSignedUrlResult_fields() {
        let r = SignedUrlResult(url: "https://example.com/signed", expiresIn: 3600)
        XCTAssertEqual(r.url, "https://example.com/signed")
        XCTAssertEqual(r.expiresIn, 3600)
    }
}

// ─── 10. FieldOps Extended ──────────────────────────────────────────────────

final class FieldOpsExtendedUnitTests: XCTestCase {
    func testIncrement_zero() {
        let op = FieldOps.increment(0)
        XCTAssertEqual(op["$op"] as? String, "increment")
        XCTAssertEqual(op["value"] as? Int, 0)
    }

    func testIncrement_largeValue() {
        let op = FieldOps.increment(999999)
        XCTAssertEqual(op["value"] as? Int, 999999)
    }

    func testIncrement_doubleValue() {
        let op = FieldOps.increment(2.5)
        XCTAssertEqual(op["$op"] as? String, "increment")
        XCTAssertEqual(op["value"] as? Double, 2.5)
    }

    func testDeleteField_opKey() {
        let op = FieldOps.deleteField()
        XCTAssertEqual(op["$op"] as? String, "deleteField")
        XCTAssertEqual(op.count, 1) // only $op, no value key
    }
}

// ─── 11. DbChange Extended ──────────────────────────────────────────────────

final class DbChangeExtendedUnitTests: XCTestCase {
    func testFromJSON_timestamp() {
        let json: [String: Any] = ["type": "INSERT", "table": "t", "timestamp": "2024-01-01T00:00:00Z"]
        let dc = DbChange.fromJSON(json)
        XCTAssertEqual(dc.timestamp, "2024-01-01T00:00:00Z")
    }

    func testFromJSON_noTimestamp() {
        let json: [String: Any] = ["type": "INSERT", "table": "t"]
        let dc = DbChange.fromJSON(json)
        XCTAssertNil(dc.timestamp)
    }

    func testDirectInit_withRecordAndOldRecord() {
        let dc = DbChange(type: "UPDATE", table: "posts", id: "p-1",
                           record: ["title": "New"], oldRecord: ["title": "Old"])
        XCTAssertEqual(dc.record?["title"] as? String, "New")
        XCTAssertEqual(dc.oldRecord?["title"] as? String, "Old")
    }

    func testFromJSON_emptyDict() {
        let dc = DbChange.fromJSON([:])
        XCTAssertEqual(dc.type, "UNKNOWN")
        XCTAssertEqual(dc.table, "")
        XCTAssertNil(dc.id)
    }
}

// ─── 12. EdgeBaseError Extended ─────────────────────────────────────────────

final class EdgeBaseErrorExtendedUnitTests: XCTestCase {
    func testFromJSON_multipleDetails() throws {
        let json = """
        {"message":"Validation error","details":{"email":["Required","Invalid format"],"name":["Too short"]}}
        """.data(using: .utf8)!
        let err = EdgeBaseError.fromJSON(json, statusCode: 422)
        XCTAssertEqual(err.details?["email"]?.count, 2)
        XCTAssertEqual(err.details?["name"]?.first, "Too short")
    }

    func testFromJSON_detailsAsStringValue() throws {
        let json = """
        {"message":"Error","details":{"field":"single error"}}
        """.data(using: .utf8)!
        let err = EdgeBaseError.fromJSON(json, statusCode: 422)
        XCTAssertEqual(err.details?["field"]?.first, "single error")
    }

    func testFromJSON_emptyDetails() throws {
        let json = """
        {"message":"Error","details":{}}
        """.data(using: .utf8)!
        let err = EdgeBaseError.fromJSON(json, statusCode: 400)
        XCTAssertNil(err.details) // empty details parsed as nil
    }

    func testErrorDescription_noDetails() {
        let err = EdgeBaseError(statusCode: 500, message: "Internal error")
        let desc = err.errorDescription!
        XCTAssertTrue(desc.contains("EdgeBaseError"))
        XCTAssertTrue(desc.contains("500"))
        XCTAssertTrue(desc.contains("Internal error"))
        XCTAssertFalse(desc.contains("("))
    }

    func testError_isSendable() {
        let err = EdgeBaseError(statusCode: 400, message: "Test")
        let sendable: any Sendable = err
        XCTAssertNotNil(sendable)
    }

    func testAuthError_isSendable() {
        let err = EdgeBaseAuthError(statusCode: 401, message: "Test")
        let sendable: any Sendable = err
        XCTAssertNotNil(sendable)
    }
}

// ─── 13. PushError ──────────────────────────────────────────────────────────

final class PushErrorUnitTests: XCTestCase {
    func testTokenProviderNotSet_errorDescription() {
        let err = PushError.tokenProviderNotSet
        XCTAssertNotNil(err.errorDescription)
        XCTAssertTrue(err.errorDescription!.contains("FCM"))
    }

    func testTokenEmpty_isError() {
        let err: Error = PushError.tokenEmpty
        XCTAssertNotNil(err)
    }

    func testTopicProviderNotSet_errorDescription() {
        let err = PushError.topicProviderNotSet
        XCTAssertNotNil(err.errorDescription)
        XCTAssertTrue(err.errorDescription!.contains("Topic"))
    }
}

// ─── 14. ListResult Extended ────────────────────────────────────────────────

final class ListResultExtendedUnitTests: XCTestCase {
    func testMixedMode_cursorAndTotal() {
        // Some APIs return both cursor and total
        let r = ListResult(items: [["id": "1"]], total: 50, page: nil, perPage: nil, hasMore: true, cursor: "c-1")
        XCTAssertEqual(r.total, 50)
        XCTAssertEqual(r.hasMore, true)
        XCTAssertEqual(r.cursor, "c-1")
    }

    func testSingleItem() {
        let r = ListResult(items: [["id": "only"]], total: 1, page: 1, perPage: 10, hasMore: false, cursor: nil)
        XCTAssertEqual(r.items.count, 1)
        XCTAssertEqual(r.items[0]["id"] as? String, "only")
    }

    func testLargeItemCount() {
        var items: [[String: Any]] = []
        for i in 0..<100 { items.append(["id": "item-\(i)"]) }
        let r = ListResult(items: items, total: 1000, page: 1, perPage: 100, hasMore: true, cursor: nil)
        XCTAssertEqual(r.items.count, 100)
    }
}
