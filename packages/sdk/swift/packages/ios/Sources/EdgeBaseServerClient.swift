// EdgeBaseServerClient.swift — Server-side (admin) EdgeBase client for Swift.
//
// Used only in E2E tests that require admin privileges.
// Authenticates using a service key (Bearer token).
//: client/server split, #122: Admin rename.

import EdgeBaseCore
import Foundation

/// Server-side EdgeBase client authenticated with a service key.
/// Use this for admin operations (createUser, getUser etc.) in test/server environments.
public final class EdgeBaseServerClient: @unchecked Sendable {
    public let adminAuth: AdminAuthClient
    private let http: AdminHttpClient

    public init(_ baseUrl: String, serviceKey: String) {
        self.http = AdminHttpClient(baseUrl: baseUrl, serviceKey: serviceKey)
        self.adminAuth = AdminAuthClient(http: http)
    }

    /// Get a table reference via a DB namespace (for admin CRUD).
    public func db(_ namespace: String, instanceId: String? = nil) -> AdminDbRef {
        AdminDbRef(http: http, namespace: namespace, instanceId: instanceId)
    }

    /// Destroy — cleanup resources (noop for admin client, included for API symmetry).
    public func destroy() async {
        // Admin client uses no persistent connections; nothing to clean up.
    }
}

// MARK: - AdminHttpClient (service key based, no token refresh)

/// Minimal HTTP client that injects a service key as the Authorization header.
public actor AdminHttpClient {
    public let baseUrl: String
    private let serviceKey: String
    private let session: URLSession

    init(baseUrl: String, serviceKey: String, session: URLSession = .shared) {
        self.baseUrl = baseUrl.hasSuffix("/") ? String(baseUrl.dropLast()) : baseUrl
        self.serviceKey = serviceKey
        self.session = session
    }

    public func get(_ path: String, queryParams: [String: String]? = nil) async throws -> Any {
        try await request(method: "GET", path: path, queryParams: queryParams)
    }

    public func post(_ path: String, _ body: [String: Any]? = nil) async throws -> Any {
        try await request(method: "POST", path: path, body: body)
    }

    public func patch(_ path: String, _ body: [String: Any]) async throws -> Any {
        try await request(method: "PATCH", path: path, body: body)
    }

    public func put(_ path: String, _ body: [String: Any]) async throws -> Any {
        try await request(method: "PUT", path: path, body: body)
    }

    public func delete(_ path: String) async throws -> Any {
        try await request(method: "DELETE", path: path)
    }

    private func request(
        method: String,
        path: String,
        body: [String: Any]? = nil,
        queryParams: [String: String]? = nil
    ) async throws -> Any {
        var urlString = baseUrl + "/api\(path)"
        if let params = queryParams, !params.isEmpty {
            let query = params.map { "\($0.key)=\($0.value)" }.joined(separator: "&")
            urlString += "?" + query
        }
        guard let url = URL(string: urlString) else {
            throw EdgeBaseError(statusCode: 0, message: "Invalid URL: \(urlString)")
        }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("Bearer \(serviceKey)", forHTTPHeaderField: "Authorization")
        if let body = body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await session.data(for: req)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw EdgeBaseError(statusCode: 0, message: "Invalid response")
        }
        if httpResponse.statusCode >= 400 {
            throw EdgeBaseError.fromJSON(data, statusCode: httpResponse.statusCode)
        }
        if data.isEmpty { return [:] as [String: Any] }
        return try JSONSerialization.jsonObject(with: data)
    }
}

// MARK: - AdminAuthClient

/// Admin authentication operations (requires service key).
public final class AdminAuthClient: @unchecked Sendable {
    private let http: AdminHttpClient

    init(http: AdminHttpClient) {
        self.http = http
    }

    /// Create a new user (admin).
    public func createUser(email: String, password: String, userData: [String: Any]? = nil) async throws -> [String: Any] {
        var body: [String: Any] = ["email": email, "password": password]
        if let extra = userData { body.merge(extra) { _, new in new } }
        let result = try await http.post("/auth/admin/users", body)
        // Server responds with { user: {...}, accessToken?: ... }
        // Extract the user sub-dictionary to match other SDK behaviour.
        if let wrapper = result as? [String: Any], let user = wrapper["user"] as? [String: Any] {
            return user
        }
        return result as? [String: Any] ?? [:]
    }

    /// Get a user by ID (admin).
    public func getUser(_ id: String) async throws -> [String: Any] {
        let result = try await http.get("/auth/admin/users/\(id)")
        // Server responds with { user: {...} }
        if let wrapper = result as? [String: Any], let user = wrapper["user"] as? [String: Any] {
            return user
        }
        return result as? [String: Any] ?? [:]
    }

    /// List users (admin).
    public func listUsers(limit: Int = 100, offset: Int? = nil) async throws -> [String: Any] {
        var params: [String: String] = ["limit": "\(limit)"]
        if let offset = offset { params["offset"] = "\(offset)" }
        let result = try await http.get("/auth/admin/users", queryParams: params)
        return result as? [String: Any] ?? [:]
    }

    /// Delete a user by ID (admin).
    public func deleteUser(_ id: String) async throws {
        _ = try await http.delete("/auth/admin/users/\(id)")
    }

    /// Set custom claims for a user (admin).
    ///
    /// Custom claims are merged into the user's JWT on next token refresh.
    /// - Parameters:
    ///   - id: User ID.
    ///   - claims: Key-value pairs to set as custom claims.
    public func setCustomClaims(_ id: String, claims: [String: Any]) async throws {
        _ = try await http.put("/auth/admin/users/\(id)/claims", claims)
    }
}

// MARK: - AdminDbRef

/// DB block reference for admin table access.
public final class AdminDbRef: @unchecked Sendable {
    private let http: AdminHttpClient
    private let namespace: String
    private let instanceId: String?

    init(http: AdminHttpClient, namespace: String, instanceId: String? = nil) {
        self.http = http
        self.namespace = namespace
        self.instanceId = instanceId
    }

    public func table(_ name: String) -> AdminTableRef {
        AdminTableRef(http: http, namespace: namespace, instanceId: instanceId, tableName: name)
    }
}

// MARK: - AdminTableRef

/// Admin table reference for CRUD operations.
public final class AdminTableRef: @unchecked Sendable {
    private let http: AdminHttpClient
    private let namespace: String
    private let instanceId: String?
    private let tableName: String
    private var filters: [(String, String, String)] = []

    init(http: AdminHttpClient, namespace: String, instanceId: String?, tableName: String) {
        self.http = http
        self.namespace = namespace
        self.instanceId = instanceId
        self.tableName = tableName
    }

    private var basePath: String {
        if let id = instanceId {
            return "/db/\(namespace)/\(id)/tables/\(tableName)"
        }
        return "/db/\(namespace)/tables/\(tableName)"
    }

    public func `where`(_ field: String, _ op: String, _ value: String) -> AdminTableRef {
        let ref = AdminTableRef(http: http, namespace: namespace, instanceId: instanceId, tableName: tableName)
        ref.filters = filters + [(field, op, value)]
        return ref
    }

    public func get() async throws -> ListResult {
        var params: [String: String] = [:]
        for (i, filter) in filters.enumerated() {
            params["filter[\(i)][field]"] = filter.0
            params["filter[\(i)][op]"] = filter.1
            params["filter[\(i)][value]"] = filter.2
        }
        let result = try await http.get(basePath, queryParams: params.isEmpty ? nil : params)
        guard let dict = result as? [String: Any] else { return ListResult(items: []) }
        let rawItems = dict["items"] as? [[String: Any]] ?? []
        return ListResult(items: rawItems)
    }
}

/// Basic list result for admin queries.
public struct ListResult {
    public let items: [[String: Any]]
}
