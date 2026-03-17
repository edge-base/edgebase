// Storage Client — bucket-based file management.
//
// Mirrors JS SDK StorageClient — bucket-based file management:
// upload, uploadString, download, delete, list, getUrl, getMetadata,
// updateMetadata, createSignedUrl, createSignedUploadUrl, resumeUpload.

import Foundation

// MARK: - Types

/// File info from server.
public struct FileInfo: Sendable {
    public let key: String
    public let size: Int
    public let contentType: String?
    public let etag: String?
    public let lastModified: String?
    public let customMetadata: [String: String]?

    public init(
        key: String, size: Int, contentType: String? = nil,
        etag: String? = nil, lastModified: String? = nil,
        customMetadata: [String: String]? = nil
    ) {
        self.key = key
        self.size = size
        self.contentType = contentType
        self.etag = etag
        self.lastModified = lastModified
        self.customMetadata = customMetadata
    }

    public static func fromJSON(_ json: [String: Any]) -> FileInfo {
        FileInfo(
            key: json["key"] as? String ?? "",
            size: json["size"] as? Int ?? 0,
            contentType: json["contentType"] as? String,
            etag: json["etag"] as? String,
            lastModified: json["lastModified"] as? String,
            customMetadata: (json["customMetadata"] as? [String: String])
        )
    }
}

/// File list result.
public struct FileListResult: Sendable {
    public let items: [FileInfo]
    public let hasMore: Bool
    public let cursor: String?

    public init(items: [FileInfo], hasMore: Bool, cursor: String?) {
        self.items = items
        self.hasMore = hasMore
        self.cursor = cursor
    }
}

/// Signed URL result.
public struct SignedUrlResult: Sendable {
    public let url: String
    public let expiresIn: Int

    public init(url: String, expiresIn: Int) {
        self.url = url
        self.expiresIn = expiresIn
    }
}

/// String encoding type for uploadString.
public enum StringEncoding: Sendable {
    case raw, base64, base64url, dataUrl
}

// MARK: - Storage Client

/// Storage client — access file storage by bucket name.
public final class StorageClient: @unchecked Sendable {
    private let client: HttpClient

    public init(_ client: HttpClient) {
        self.client = client
    }

    /// Get a bucket reference.
    public func bucket(_ name: String) -> StorageBucket {
        StorageBucket(client, name)
    }
}

// MARK: - Storage Bucket

/// Single bucket operations.
public final class StorageBucket: @unchecked Sendable {
    private let client: HttpClient
    public let name: String

    public init(_ client: HttpClient, _ name: String) {
        self.client = client
        self.name = name
    }

    /// Upload a file from Data.
    @discardableResult
    public func upload(
        _ key: String,
        data: Data,
        contentType: String? = nil,
        customMetadata: [String: String]? = nil
    ) async throws -> FileInfo {
        var fields: [String: String] = ["key": key]
        if let ct = contentType { fields["contentType"] = ct }
        if let meta = customMetadata {
            for (k, v) in meta { fields["metadata[\(k)]"] = v }
        }
        let json = try await client.postMultipart(
            "/storage/\(name)/upload",
            fileData: data,
            fileName: key,
            fileContentType: contentType ?? "application/octet-stream",
            fields: fields
        ) as! [String: Any]
        return FileInfo.fromJSON(json)
    }

    /// Upload a string with specified encoding.
    public func uploadString(
        _ key: String,
        data: String,
        encoding: StringEncoding = .raw,
        contentType: String? = nil,
        customMetadata: [String: String]? = nil
    ) async throws -> FileInfo {
        var bytes: Data
        var ct = contentType

        switch encoding {
        case .raw:
            bytes = data.data(using: .utf8)!
            ct = ct ?? "text/plain"
        case .base64:
            guard let d = Data(base64Encoded: data) else {
                throw EdgeBaseError(statusCode: 400, message: "Invalid base64 data")
            }
            bytes = d
        case .base64url:
            var base64 = data
                .replacingOccurrences(of: "-", with: "+")
                .replacingOccurrences(of: "_", with: "/")
            while base64.count % 4 != 0 { base64.append("=") }
            guard let d = Data(base64Encoded: base64) else {
                throw EdgeBaseError(statusCode: 400, message: "Invalid base64url data")
            }
            bytes = d
        case .dataUrl:
            guard let commaIdx = data.firstIndex(of: ",") else {
                throw EdgeBaseError(statusCode: 400, message: "Invalid data URL")
            }
            let header = String(data[data.startIndex..<commaIdx])
            let body = String(data[data.index(after: commaIdx)...])
            // Extract content type
            if ct == nil, let range = header.range(of: #"data:([^;,]+)"#, options: .regularExpression) {
                ct = String(header[range]).replacingOccurrences(of: "data:", with: "")
            }
            ct = ct ?? "application/octet-stream"
            if header.contains(";base64") {
                guard let d = Data(base64Encoded: body) else {
                    throw EdgeBaseError(statusCode: 400, message: "Invalid data URL base64")
                }
                bytes = d
            } else {
                bytes = body.removingPercentEncoding?.data(using: .utf8) ?? body.data(using: .utf8)!
            }
        }

        return try await upload(key, data: bytes, contentType: ct, customMetadata: customMetadata)
    }

    /// Download a file as Data.
    public func download(_ key: String) async throws -> Data {
        try await client.getRaw("/storage/\(name)/\(key.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? key)")
    }

    /// Delete a file.
    public func delete(_ key: String) async throws {
        try await client.delete("/storage/\(name)/\(key.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? key)")
    }

    /// Get file public URL.
    public func getUrl(_ key: String) async -> String {
        let encodedKey = key.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? key
        return await client.apiUrl("/storage/\(name)/\(encodedKey)")
    }

    /// Get file metadata.
    public func getMetadata(_ key: String) async throws -> FileInfo {
        let json = try await client.get("/storage/\(name)/\(key.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? key)/metadata") as! [String: Any]
        return FileInfo.fromJSON(json)
    }

    /// Update file metadata.
    /// CONCEPT.md: `await bucket.updateMetadata("report.pdf", [...])`
    public func updateMetadata(_ key: String, metadata: [String: Any]) async throws -> FileInfo {
        let json = try await client.patch("/storage/\(name)/\(key.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? key)/metadata", metadata) as! [String: Any]
        return FileInfo.fromJSON(json)
    }

    /// Create a signed download URL (time-limited).
    public func createSignedUrl(_ key: String, expiresIn: Int = 3600) async throws -> SignedUrlResult {
        let json = try await client.post(
            "/storage/\(name)/signed-url",
            ["key": key, "expiresIn": "\(expiresIn)s"]
        ) as! [String: Any]
        return SignedUrlResult(
            url: json["url"] as! String,
            expiresIn: json["expiresIn"] as? Int ?? expiresIn
        )
    }

    public func createSignedUrls(_ keys: [String], expiresIn: Int = 3600) async throws -> [SignedUrlResult] {
        let json = try await client.post(
            "/storage/\(name)/signed-urls",
            ["keys": keys, "expiresIn": "\(expiresIn)s"]
        ) as! [String: Any]
        let urls = json["urls"] as? [[String: Any]] ?? []
        return urls.map { item in
            SignedUrlResult(
                url: item["url"] as? String ?? "",
                expiresIn: item["expiresIn"] as? Int ?? expiresIn
            )
        }
    }

    /// Create a signed upload URL (client-side direct upload).
    public func createSignedUploadUrl(
        _ key: String,
        expiresIn: Int = 3600,
        contentType: String? = nil
    ) async throws -> SignedUrlResult {
        var body: [String: Any] = ["key": key, "expiresIn": "\(expiresIn)s"]
        if let ct = contentType { body["contentType"] = ct }
        let json = try await client.post(
            "/storage/\(name)/signed-upload-url",
            body
        ) as! [String: Any]
        return SignedUrlResult(
            url: json["url"] as! String,
            expiresIn: json["expiresIn"] as? Int ?? expiresIn
        )
    }

    public func exists(_ key: String) async -> Bool {
        let encodedKey = key.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? key
        return await client.head("/storage/\(name)/\(encodedKey)")
    }

    public func getUploadParts(_ key: String, uploadId: String) async throws -> [String: Any] {
        let json = try await client.get(
            "/storage/\(name)/uploads/\(uploadId)/parts",
            queryParams: ["key": key]
        ) as! [String: Any]
        return [
            "uploadId": json["uploadId"] ?? uploadId,
            "key": json["key"] ?? key,
            "parts": json["parts"] ?? []
        ]
    }


    /// Initiate a resumable upload.

    public func initiateResumableUpload(_ key: String, contentType: String? = nil) async throws -> String {
        var body: [String: Any] = ["key": key]
        if let ct = contentType { body["contentType"] = ct }
        let json = try await client.post("/storage/\(name)/multipart/create", body) as! [String: Any]
        return json["uploadId"] as! String
    }

    /// Upload a chunk for a resumable upload.
    public func resumeUpload(
        _ key: String,
        uploadId: String,
        chunk: Data,
        offset: Int,
        isLastChunk: Bool = false
    ) async throws -> FileInfo? {
        let partNumber = offset + 1
        let part = try await client.postRaw(
            "/storage/\(name)/multipart/upload-part",
            data: chunk,
            queryParams: [
                "uploadId": uploadId,
                "partNumber": String(partNumber),
                "key": key,
            ]
        ) as! [String: Any]

        if isLastChunk {
            let json = try await client.post(
                "/storage/\(name)/multipart/complete",
                [
                    "uploadId": uploadId,
                    "key": key,
                    "parts": [part],
                ]
            ) as! [String: Any]
            return FileInfo.fromJSON(json)
        }
        return nil
    }

    /// List files in bucket.
    public func list(prefix: String? = nil, limit: Int? = nil, cursor: String? = nil) async throws -> FileListResult {
        var params: [String: String] = [:]
        if let p = prefix { params["prefix"] = p }
        if let l = limit { params["limit"] = String(l) }
        if let c = cursor { params["cursor"] = c }

        let json = try await client.get("/storage/\(name)", queryParams: params.isEmpty ? nil : params) as! [String: Any]
        let rawItems = json["files"] as? [[String: Any]] ?? json["items"] as? [[String: Any]] ?? []
        let items = rawItems.map { FileInfo.fromJSON($0) }
        return FileListResult(
            items: items,
            hasMore: json["hasMore"] as? Bool ?? false,
            cursor: json["cursor"] as? String
        )
    }
}
