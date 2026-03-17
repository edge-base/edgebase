@_exported import EdgeBaseCore
import Foundation

/// Reference to a DB namespace block, returned by EdgeBaseClient.db().
/// Use .table(name) to get a TableRef for CRUD operations (#133 §2).
public final class DbRef: @unchecked Sendable {
    private let core: GeneratedDbApi
    private let databaseLive: DatabaseLiveClient
    private let namespace: String
    private let instanceId: String?

    init(_ core: GeneratedDbApi, databaseLive: DatabaseLiveClient, namespace: String, instanceId: String? = nil) {
        self.core = core
        self.databaseLive = databaseLive
        self.namespace = namespace
        self.instanceId = instanceId
    }

    /// Get a table reference for CRUD and database live operations.
    ///
    /// - Parameter name: Table name (e.g. "posts").
    /// - Returns: TableRef configured for the DB block + table.
    public func table(_ name: String) -> TableRef {
        return TableRef(core, name, databaseLive: databaseLive,
                             namespace: namespace, instanceId: instanceId)
    }
}

/// Main EdgeBase client entry point for iOS/macOS.
/// Named `EdgeBaseClient` to avoid collision with the `EdgeBase` module name.
///: client/server split, #122: Server→Admin rename, #133: db namespace.
///
/// Usage:
/// ```swift
/// let client = EdgeBaseClient("https://my-app.edgebase.fun")
/// let user = try await client.auth.signUp(email: "test@example.com", password: "pass123")
/// let posts = try await client.db("shared").table("posts").get()
/// ```
public final class EdgeBaseClient: @unchecked Sendable {
    public let baseUrl: String
    public let auth: AuthClient
    public let storage: StorageClient
    public let push: PushClient
    public let functions: FunctionsClient
    public let analytics: AnalyticsClient
    private let httpClient: HttpClient
    private let core: GeneratedDbApi
    private let _tokenManager: TokenManager
    let databaseLive: DatabaseLiveClient
    private var context: [String: Any] = [:]

    /// Initialize with base URL, optional token storage, and an optional custom URLSession.
    public init(_ url: String, tokenStorage: TokenStorage? = nil, session: URLSession = .shared) {
        self.baseUrl = url.hasSuffix("/") ? String(url.dropLast()) : url
        self._tokenManager = TokenManager(storage: tokenStorage ?? MemoryTokenStorage())
        self.httpClient = HttpClient(baseUrl: baseUrl, tokenManager: _tokenManager, session: session)
        self.core = GeneratedDbApi(http: httpClient)
        self.auth = AuthClient(client: httpClient, tokenManager: _tokenManager, core: core)
        self.storage = StorageClient(httpClient)
        self.push = PushClient(httpClient)
        self.databaseLive = DatabaseLiveClient(url: baseUrl, tokenManager: _tokenManager, session: session)
        self.functions = FunctionsClient(httpClient)
        self.analytics = AnalyticsClient(core: core)

        // Setup refresh callback
        Task {
            await _tokenManager.setRefreshCallback { [weak self] refreshToken in
                guard let self = self else { throw EdgeBaseError(statusCode: 0, message: "Client destroyed") }
                let result = try await self.httpClient.postPublic("/auth/refresh", ["refreshToken": refreshToken])
                guard let dict = result as? [String: Any],
                      let access = dict["accessToken"] as? String,
                      let refresh = dict["refreshToken"] as? String else {
                    throw EdgeBaseError(statusCode: 0, message: "Invalid refresh response")
                }
                return TokenPair(accessToken: access, refreshToken: refresh)
            }
        }
    }

    /// Select a DB block by namespace and optional instance ID (#133 §2).
    ///
    /// - Parameters:
    ///   - namespace: DB block key (e.g. "shared", "workspace", "user").
    ///   - instanceId: Instance ID for dynamic DOs (e.g. "ws-456"). Nil for static DBs.
    /// - Returns: DbRef — call `.table(name)` to get a TableRef.
    ///
    /// Usage:
    /// ```swift
    /// let posts = try await client.db("shared").table("posts").get()
    /// let docs  = try await client.db("workspace", instanceId: "ws-456").table("documents").get()
    /// ```
    public func db(_ namespace: String, instanceId: String? = nil) -> DbRef {
        return DbRef(core, databaseLive: databaseLive, namespace: namespace, instanceId: instanceId)
    }

    /// Create a RoomClient for the given namespace and room ID.
    ///
    /// - Parameters:
    ///   - namespace: Room namespace (e.g. "game", "chat").
    ///   - id: Room instance ID within the namespace (e.g. "lobby-1").
    ///   - options: Optional room configuration.
    /// - Returns: RoomClient instance (call `join()` to connect).
    public func room(namespace: String, id: String, options: RoomOptions = RoomOptions()) -> RoomClient {
        return RoomClient(baseUrl: baseUrl, namespace: namespace, roomId: id, tokenManager: _tokenManager, options: options, httpClient: httpClient)
    }

    /// Create a RoomClient using a custom token provider.
    ///
    /// - Parameters:
    ///   - namespace: Room namespace (e.g. "game", "chat").
    ///   - id: Room instance ID within the namespace.
    ///   - tokenProvider: Closure returning the access token.
    ///   - options: Optional room configuration.
    /// - Returns: RoomClient instance (call `join()` to connect).
    public func roomWithToken(namespace: String, id: String, tokenProvider: @escaping @Sendable () -> String, options: RoomOptions = RoomOptions()) -> RoomClient {
        let mgr = ExternalTokenManager(tokenProvider: tokenProvider)
        return RoomClient(baseUrl: baseUrl, namespace: namespace, roomId: id, tokenManager: mgr, options: options, httpClient: httpClient)
    }

    public func setLocale(_ locale: String?) async {
        await httpClient.setLocale(locale)
    }

    public func getLocale() async -> String? {
        await httpClient.getLocale()
    }

    public func setContext(_ context: [String: Any]) {
        self.context = context
    }

    public func getContext() -> [String: Any] {
        context
    }

    /// Destroy — clean up resources.
    public func destroy() async {
        analytics.destroy()
        await _tokenManager.destroy()
        databaseLive.destroy()
    }
}
