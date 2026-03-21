// HTTP Client — URLSession-based HTTP communication.
//
// Mirrors Dart SDK HttpClient:
// - Auth header injection
// - Automatic 401 retry with token refresh
// - Query parameter support
// - Error parsing
// #133/#136: ContextManager / X-EdgeBase-Context removed.

import Foundation

/// HTTP client for EdgeBase API communication.
public actor HttpClient {
    public let baseUrl: String
    private let session: URLSession
    private let tokenManager: TokenManager
    private let projectId: String?
    private var locale: String?

    public init(
        baseUrl: String,
        tokenManager: TokenManager,
        projectId: String? = nil,
        session: URLSession = .shared
    ) {
        self.baseUrl = baseUrl.hasSuffix("/") ? String(baseUrl.dropLast()) : baseUrl
        self.tokenManager = tokenManager
        self.projectId = projectId
        self.session = session
    }

    // MARK: - Public Methods

    /// GET request.
    public func get(_ path: String, queryParams: [String: String]? = nil) async throws -> Any {
        return try await request(method: "GET", path: path, queryParams: queryParams)
    }

    /// POST request.
    @discardableResult
    public func post(_ path: String, _ body: [String: Any]? = nil, queryParams: [String: String]? = nil) async throws -> Any {
        return try await request(method: "POST", path: path, body: body, queryParams: queryParams)
    }

    /// PATCH request.
    @discardableResult
    public func patch(_ path: String, _ body: [String: Any]) async throws -> Any {
        return try await request(method: "PATCH", path: path, body: body)
    }

    /// PUT request.
    @discardableResult
    public func put(_ path: String, _ body: [String: Any], queryParams: [String: String]? = nil) async throws -> Any {
        return try await request(method: "PUT", path: path, body: body, queryParams: queryParams)
    }

    /// DELETE request.
    @discardableResult
    public func delete(_ path: String) async throws -> Any {
        return try await request(method: "DELETE", path: path)
    }

    /// DELETE request with body.
    @discardableResult
    public func delete(_ path: String, _ body: [String: Any]) async throws -> Any {
        return try await request(method: "DELETE", path: path, body: body)
    }

    /// POST without auth (for signUp/signIn etc).
    @discardableResult
    public func postPublic(_ path: String, _ body: [String: Any]) async throws -> Any {
        return try await request(method: "POST", path: path, body: body, skipAuth: true)
    }

    /// GET raw response (for file downloads).
    public func getRaw(_ path: String, rateLimitAttempt: Int = 0) async throws -> Data {
        let url = buildURL(path: "/api\(path)")
        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        try await addAuthHeaders(&req)

        let (data, response) = try await session.data(for: req)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw EdgeBaseError(statusCode: 0, message: "Invalid response")
        }
        if httpResponse.statusCode == 429 && rateLimitAttempt < 3 {
            let retryAfter = httpResponse.value(forHTTPHeaderField: "Retry-After")
            var baseDelayMs: Double = 1000 * pow(2.0, Double(rateLimitAttempt))
            if let header = retryAfter, let seconds = Double(header), seconds > 0 { baseDelayMs = seconds * 1000 }
            let jitter = Double.random(in: 0...(baseDelayMs * 0.25))
            try await Task.sleep(nanoseconds: UInt64(min(baseDelayMs + jitter, 10000) * 1_000_000))
            return try await getRaw(path, rateLimitAttempt: rateLimitAttempt + 1)
        }
        if httpResponse.statusCode >= 400 {
            throw EdgeBaseError.fromJSON(data, statusCode: httpResponse.statusCode)
        }
        return data
    }

    /// POST multipart (for file uploads).
    @discardableResult
    public func postMultipart(
        _ path: String,
        fileData: Data,
        fileName: String,
        fieldName: String = "file",
        fileContentType: String = "application/octet-stream",
        fields: [String: String] = [:],
        rateLimitAttempt: Int = 0
    ) async throws -> Any {
        let url = buildURL(path: "/api\(path)")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        try await addAuthHeaders(&req)

        let boundary = UUID().uuidString
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        // Fields
        for (key, value) in fields {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(key)\"\r\n\r\n".data(using: .utf8)!)
            body.append("\(value)\r\n".data(using: .utf8)!)
        }
        // File
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"\(fieldName)\"; filename=\"\(fileName)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(fileContentType)\r\n\r\n".data(using: .utf8)!)
        body.append(fileData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)

        req.httpBody = body

        let (data, response) = try await session.data(for: req)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw EdgeBaseError(statusCode: 0, message: "Invalid response")
        }
        if httpResponse.statusCode == 429 && rateLimitAttempt < 3 {
            let retryAfter = httpResponse.value(forHTTPHeaderField: "Retry-After")
            var baseDelayMs: Double = 1000 * pow(2.0, Double(rateLimitAttempt))
            if let header = retryAfter, let seconds = Double(header), seconds > 0 { baseDelayMs = seconds * 1000 }
            let jitter = Double.random(in: 0...(baseDelayMs * 0.25))
            try await Task.sleep(nanoseconds: UInt64(min(baseDelayMs + jitter, 10000) * 1_000_000))
            return try await postMultipart(path, fileData: fileData, fileName: fileName, fieldName: fieldName, fileContentType: fileContentType, fields: fields, rateLimitAttempt: rateLimitAttempt + 1)
        }
        if httpResponse.statusCode >= 400 {
            throw EdgeBaseError.fromJSON(data, statusCode: httpResponse.statusCode)
        }
        return try JSONSerialization.jsonObject(with: data)
    }

    /// POST raw bytes (for multipart upload-part).
    @discardableResult
    public func postRaw(
        _ path: String,
        data: Data,
        contentType: String = "application/octet-stream",
        queryParams: [String: String]? = nil,
        rateLimitAttempt: Int = 0
    ) async throws -> Any {
        let url = buildURL(path: "/api\(path)", queryParams: queryParams)
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        try await addAuthHeaders(&req)
        req.setValue(contentType, forHTTPHeaderField: "Content-Type")
        req.httpBody = data

        let (responseData, response) = try await session.data(for: req)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw EdgeBaseError(statusCode: 0, message: "Invalid response")
        }
        if httpResponse.statusCode == 429 && rateLimitAttempt < 3 {
            let retryAfter = httpResponse.value(forHTTPHeaderField: "Retry-After")
            var baseDelayMs: Double = 1000 * pow(2.0, Double(rateLimitAttempt))
            if let header = retryAfter, let seconds = Double(header), seconds > 0 { baseDelayMs = seconds * 1000 }
            let jitter = Double.random(in: 0...(baseDelayMs * 0.25))
            try await Task.sleep(nanoseconds: UInt64(min(baseDelayMs + jitter, 10000) * 1_000_000))
            return try await postRaw(path, data: data, contentType: contentType, queryParams: queryParams, rateLimitAttempt: rateLimitAttempt + 1)
        }
        if httpResponse.statusCode >= 400 {
            throw EdgeBaseError.fromJSON(responseData, statusCode: httpResponse.statusCode)
        }
        return try JSONSerialization.jsonObject(with: responseData)
    }

    // MARK: - Retry Helpers

    private func retryDelay(retryAfterHeader: String?, attempt: Int) -> UInt64 {
        var baseDelayMs: Double = 1000 * pow(2.0, Double(attempt))
        if let header = retryAfterHeader, let seconds = Double(header), seconds > 0 {
            baseDelayMs = seconds * 1000
        }
        let jitter = Double.random(in: 0...(baseDelayMs * 0.25))
        return UInt64(min(baseDelayMs + jitter, 10000) * 1_000_000)
    }

    private func isRetryableTransportError(_ error: Error) -> Bool {
        let msg = String(describing: error).lowercased()
        return msg.contains("timeout") || msg.contains("timed out") ||
            msg.contains("connection") || msg.contains("reset") ||
            msg.contains("refused") || msg.contains("network")
    }

    // MARK: - Private

    private func request(
        method: String,
        path: String,
        body: [String: Any]? = nil,
        queryParams: [String: String]? = nil,
        skipAuth: Bool = false,
        isRetry: Bool = false,
        rateLimitAttempt: Int = 0
    ) async throws -> Any {
        let url = buildURL(path: "/api\(path)", queryParams: queryParams)
        var req = URLRequest(url: url)
        req.httpMethod = method

        if !skipAuth {
            try await addAuthHeaders(&req)
        }

        // #133/#136: X-EdgeBase-Context header removed. namespace+id are in the URL path.

        if let body = body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            if rateLimitAttempt < 2 && isRetryableTransportError(error) {
                try await Task.sleep(nanoseconds: UInt64(50_000_000 * (rateLimitAttempt + 1)))
                return try await request(method: method, path: path, body: body, queryParams: queryParams, skipAuth: skipAuth, isRetry: isRetry, rateLimitAttempt: rateLimitAttempt + 1)
            }
            throw error
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw EdgeBaseError(statusCode: 0, message: "Invalid response")
        }

        // 429 retry with Retry-After
        if httpResponse.statusCode == 429 && rateLimitAttempt < 3 {
            let retryAfter = httpResponse.value(forHTTPHeaderField: "Retry-After")
            let delay = retryDelay(retryAfterHeader: retryAfter, attempt: rateLimitAttempt)
            try await Task.sleep(nanoseconds: delay)
            return try await request(method: method, path: path, body: body, queryParams: queryParams, skipAuth: skipAuth, isRetry: isRetry, rateLimitAttempt: rateLimitAttempt + 1)
        }

        // 401 auto-retry with token refresh
        if httpResponse.statusCode == 401 && !isRetry && !skipAuth {
            _ = try await tokenManager.getAccessToken()
            return try await request(
                method: method, path: path, body: body,
                queryParams: queryParams, skipAuth: skipAuth, isRetry: true
            )
        }

        if httpResponse.statusCode >= 400 {
            throw EdgeBaseError.fromJSON(data, statusCode: httpResponse.statusCode)
        }

        if data.isEmpty {
            return NSNull()
        }

        do {
            return try JSONSerialization.jsonObject(with: data)
        } catch {
            throw EdgeBaseError(statusCode: httpResponse.statusCode, message: "Invalid JSON response body")
        }
    }

    /// Build a full public API URL for external use (e.g. file download links, OAuth redirects).
    /// The returned string is `{baseUrl}/api{path}`.
    public func apiUrl(_ path: String) -> String {
        return baseUrl + "/api" + path
    }

    public func setLocale(_ locale: String?) {
        self.locale = locale
    }

    public func getLocale() -> String? {
        locale
    }

    private func buildURL(path: String, queryParams: [String: String]? = nil) -> URL {
        var urlString = baseUrl + path
        if let params = queryParams, !params.isEmpty {
            let queryString = params.map { "\($0.key)=\($0.value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? $0.value)" }
                .joined(separator: "&")
            urlString += (urlString.contains("?") ? "&" : "?") + queryString
        }
        return URL(string: urlString)!
    }

    /// HEAD request — returns true if resource exists (2xx).
    public func head(_ path: String) async -> Bool {
        let url = buildURL(path: "/api\(path)")
        var req = URLRequest(url: url)
        req.httpMethod = "HEAD"
        do {
            try await addAuthHeaders(&req)
            let (_, response) = try await session.data(for: req)
            guard let httpResponse = response as? HTTPURLResponse else { return false }
            return httpResponse.statusCode >= 200 && httpResponse.statusCode < 300
        } catch {
            return false
        }
    }

    private func addAuthHeaders(_ request: inout URLRequest) async throws {
        if let token = try? await tokenManager.getAccessToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let projectId = projectId {
            request.setValue(projectId, forHTTPHeaderField: "X-EdgeBase-Project")
        }
        if let locale, !locale.isEmpty {
            request.setValue(locale, forHTTPHeaderField: "Accept-Language")
        }
    }
}
