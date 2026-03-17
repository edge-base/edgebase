import EdgeBaseCore
import Foundation

public struct FunctionCallOptions {
    public let method: String
    public let body: [String: Any]?
    public let query: [String: String]?

    public init(method: String = "POST", body: [String: Any]? = nil, query: [String: String]? = nil) {
        self.method = method
        self.body = body
        self.query = query
    }
}

public final class FunctionsClient {
    private let httpClient: HttpClient

    init(_ httpClient: HttpClient) {
        self.httpClient = httpClient
    }

    public func call(_ path: String, options: FunctionCallOptions = FunctionCallOptions()) async throws -> Any {
        let normalizedPath = "/functions/\(path)"
        switch options.method.uppercased() {
        case "GET":
            return try await httpClient.get(normalizedPath, queryParams: options.query)
        case "PUT":
            return try await httpClient.put(normalizedPath, options.body ?? [:])
        case "PATCH":
            return try await httpClient.patch(normalizedPath, options.body ?? [:])
        case "DELETE":
            return try await httpClient.delete(normalizedPath)
        case "POST":
            fallthrough
        default:
            return try await httpClient.post(normalizedPath, options.body ?? [:])
        }
    }

    public func get(_ path: String, query: [String: String]? = nil) async throws -> Any {
        try await call(path, options: FunctionCallOptions(method: "GET", query: query))
    }

    public func post(_ path: String, body: [String: Any] = [:]) async throws -> Any {
        try await call(path, options: FunctionCallOptions(method: "POST", body: body))
    }

    public func put(_ path: String, body: [String: Any] = [:]) async throws -> Any {
        try await call(path, options: FunctionCallOptions(method: "PUT", body: body))
    }

    public func patch(_ path: String, body: [String: Any] = [:]) async throws -> Any {
        try await call(path, options: FunctionCallOptions(method: "PATCH", body: body))
    }

    public func delete(_ path: String) async throws -> Any {
        try await call(path, options: FunctionCallOptions(method: "DELETE"))
    }
}
