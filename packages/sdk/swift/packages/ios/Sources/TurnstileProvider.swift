import EdgeBaseCore
import Foundation
import Security
#if canImport(WebKit)
import WebKit
#endif

// Turnstile captcha provider for iOS/macOS using WKWebView.
//
// Automatically fetches the Turnstile siteKey from the server config
// and acquires a captcha token via an invisible WKWebView challenge.
// Falls back gracefully when no siteKey is configured or when running
// on platforms without WebKit.

public final class TurnstileProvider {

    // MARK: - Cached siteKey

    private static var cachedSiteKey: String?
    private static var cachedBaseUrl: String?
    private static var cachedSiteKeyAtUptime: TimeInterval?
    static let siteKeyCacheTTL: TimeInterval = 300

    static func isSiteKeyCacheFresh(age: TimeInterval) -> Bool {
        age >= 0 && age < siteKeyCacheTTL
    }

    // MARK: - Public API

    /// Resolve a captcha token for the given action.
    ///
    /// - Parameters:
    ///   - core: GeneratedDbApi instance for fetching config.
    ///   - baseUrl: The EdgeBase project URL (used as cache key).
    ///   - action: Turnstile action string (e.g. "signup", "signin").
    ///   - manualToken: If the caller already has a token, it is returned as-is.
    /// - Returns: A captcha token string, or `nil` if captcha is not configured.
    public static func resolveCaptchaToken(core: GeneratedDbApi, baseUrl: String, action: String, manualToken: String? = nil) async throws -> String? {
        // If a manual token was provided, use it directly.
        if let manualToken = manualToken, !manualToken.isEmpty {
            return manualToken
        }
        let environment = ProcessInfo.processInfo.environment

        if let injectedToken = environment["EDGEBASE_TEST_CAPTCHA_TOKEN"], !injectedToken.isEmpty {
            return injectedToken
        }

        let isTestRunner = environment["XCTestConfigurationFilePath"] != nil ||
            environment["XCTestBundlePath"] != nil ||
            environment["SWIFT_TESTING_ENABLED"] != nil
        let isMockHarness = environment["TEST_MODE"] == "mock" &&
            (environment["EDGEBASE_URL"] != nil || environment["MOCK_SERVER_URL"] != nil)

        if isTestRunner || isMockHarness {
            return "test-captcha-token"
        }

        if environment["EDGEBASE_DISABLE_AUTO_CAPTCHA"] == "1" {
            return nil
        }

        // Fetch the siteKey from the server config (cached).
        guard try await fetchSiteKey(core: core, baseUrl: baseUrl) != nil else {
            return nil
        }

        // Acquire a token via WKWebView.
        do {
            return try await acquireToken(baseUrl: baseUrl, action: action)
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as TurnstileError {
            throw CaptchaUnavailableError(reason: error.reason, underlyingDescription: error.localizedDescription)
        } catch {
            throw CaptchaUnavailableError(reason: "acquisition_failed", underlyingDescription: String(describing: error))
        }
    }

    // MARK: - Fetch siteKey

    /// Fetch the Turnstile siteKey via `GeneratedDbApi.getConfig()`.
    /// A positive result is cached per baseUrl for five minutes so long-running
    /// clients pick up hostname/site-key rotation.
    @MainActor
    public static func fetchSiteKey(core: GeneratedDbApi, baseUrl: String) async throws -> String? {
        let now = ProcessInfo.processInfo.systemUptime
        if let cached = cachedSiteKey,
           cachedBaseUrl == baseUrl,
           let cachedAt = cachedSiteKeyAtUptime,
           isSiteKeyCacheFresh(age: now - cachedAt) {
            return cached
        }
        cachedSiteKey = nil
        cachedBaseUrl = nil
        cachedSiteKeyAtUptime = nil

        let result: Any
        do {
            result = try await core.getConfig()
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as EdgeBaseError
            where (200..<300).contains(error.statusCode) &&
                error.message == "Invalid JSON response body" {
            throw CaptchaUnavailableError(
                reason: "config_invalid_response",
                underlyingDescription: error.localizedDescription
            )
        } catch {
            throw CaptchaUnavailableError(
                reason: "config_fetch_failed",
                underlyingDescription: String(describing: error)
            )
        }

        guard let json = result as? [String: Any] else {
            throw CaptchaUnavailableError(reason: "config_invalid_response")
        }
        guard let captchaValue = json["captcha"] else {
            throw CaptchaUnavailableError(reason: "config_invalid_response")
        }
        if captchaValue is NSNull {
            return nil
        }
        guard let captcha = captchaValue as? [String: Any] else {
            throw CaptchaUnavailableError(reason: "config_invalid_response")
        }
        guard let siteKeyValue = captcha["siteKey"], !(siteKeyValue is NSNull) else {
            throw CaptchaUnavailableError(reason: "config_invalid_response")
        }
        guard let siteKey = siteKeyValue as? String else {
            throw CaptchaUnavailableError(reason: "config_invalid_response")
        }
        guard !siteKey.isEmpty, siteKey.utf8.count <= 512 else {
            throw CaptchaUnavailableError(reason: "config_invalid_response")
        }
        cachedBaseUrl = baseUrl
        cachedSiteKey = siteKey
        cachedSiteKeyAtUptime = ProcessInfo.processInfo.systemUptime
        return siteKey
    }

    // MARK: - Acquire token via WKWebView

#if canImport(WebKit)
    /// Acquire a Turnstile token by rendering the challenge in a WKWebView.
    /// Must run on the main actor because WKWebView is a UI component.
    @MainActor
    public static func acquireToken(baseUrl: String, action: String) async throws -> String {
        let channel = try makeChallengeChannel()
        let challengeURL = try makeChallengeURL(baseUrl: baseUrl, action: action, channel: channel)
        let holder = TurnstileHandlerHolder()
        return try await withTaskCancellationHandler(operation: {
            try Task.checkCancellation()
            defer { holder.handler = nil }
            return try await withCheckedThrowingContinuation { continuation in
            let handler = TurnstileMessageHandler(
                channel: channel,
                expectedURL: challengeURL,
                continuation: continuation
            )
            holder.handler = handler

            let config = WKWebViewConfiguration()
            let controller = WKUserContentController()
            controller.add(handler, name: "edgebaseCaptcha")
            config.userContentController = controller
            config.websiteDataStore = .default()

            let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 400, height: 300), configuration: config)
            #if os(iOS)
            webView.backgroundColor = .clear
            webView.scrollView.isScrollEnabled = false
            #elseif os(macOS)
            webView.setValue(false, forKey: "drawsBackground")
            #endif

            handler.webView = webView
            handler.controller = controller
            webView.navigationDelegate = handler

            var request = URLRequest(url: challengeURL)
            request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
            request.timeoutInterval = 30
            webView.load(request)

            // Timeout after 30 seconds.
            let timeoutTask = Task {
                try await Task.sleep(nanoseconds: 30_000_000_000)
                handler.fail(with: TurnstileError.timeout)
            }
            handler.timeoutTask = timeoutTask
            if Task.isCancelled { handler.fail(with: CancellationError()) }
        }
        }, onCancel: {
            Task { @MainActor in holder.handler?.fail(with: CancellationError()) }
        })
    }
#else
    /// Stub for platforms without WebKit — always throws.
    public static func acquireToken(baseUrl: String, action: String) async throws -> String {
        throw TurnstileError.unsupportedPlatform
    }
#endif

    static func makeChallengeChannel() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 16)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw TurnstileError.secureRandomUnavailable
        }
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    static func makeChallengeURL(baseUrl: String, action: String, channel: String) throws -> URL {
        let allowedActions = Set([
            "signup", "signin", "anonymous", "magic-link", "phone",
            "password-reset", "oauth", "function",
        ])
        guard allowedActions.contains(action),
              channel.range(of: "^[A-Za-z0-9_-]{22,64}$", options: .regularExpression) != nil,
              var components = URLComponents(string: baseUrl),
              components.scheme?.lowercased() == "https",
              components.host != nil,
              components.user == nil,
              components.password == nil,
              components.path.isEmpty || components.path == "/",
              components.query == nil,
              components.fragment == nil else {
            throw TurnstileError.invalidChallengeURL
        }
        components.path = "/api/captcha/challenge"
        components.queryItems = [
            URLQueryItem(name: "action", value: action),
            URLQueryItem(name: "channel", value: channel),
            URLQueryItem(name: "bridge", value: "webkit"),
        ]
        components.fragment = nil
        guard let url = components.url else { throw TurnstileError.invalidChallengeURL }
        return url
    }

    static func parseChallengeMessage(_ raw: String, channel: String) -> (type: String, value: String)? {
        guard let data = raw.data(using: .utf8), data.count <= 4096,
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              payload["v"] as? Int == 1,
              payload["channel"] as? String == channel,
              let type = payload["type"] as? String,
              let value = payload["value"] as? String else { return nil }
        switch type {
        case "token" where !value.isEmpty && value.count <= 2048:
            return (type, value)
        case "error":
            return (type, String(value.prefix(256)))
        case "interactive" where value == "show" || value == "hide":
            return (type, value)
        case "ready" where value.count <= 32:
            return (type, value)
        default:
            return nil
        }
    }
}

// MARK: - Errors

public enum TurnstileError: Error, LocalizedError {
    case timeout
    case challengeFailed(String)
    case missingTemplate
    case unsupportedPlatform
    case invalidChallengeURL
    case secureRandomUnavailable

    public var reason: String {
        switch self {
        case .timeout: return "timeout"
        case .challengeFailed(let reason): return reason
        case .missingTemplate: return "template_missing"
        case .unsupportedPlatform: return "unsupported_platform"
        case .invalidChallengeURL: return "invalid_challenge_url"
        case .secureRandomUnavailable: return "secure_random_unavailable"
        }
    }

    public var errorDescription: String? {
        switch self {
        case .timeout:
            return "Turnstile captcha timed out after 30 seconds."
        case .challengeFailed(let reason):
            return "Turnstile challenge failed: \(reason)"
        case .missingTemplate:
            return "Turnstile overlay template is missing from the Swift package bundle."
        case .unsupportedPlatform:
            return "Turnstile is not supported on this platform (WebKit unavailable)."
        case .invalidChallengeURL:
            return "Turnstile requires a valid EdgeBase HTTPS base URL and fixed action."
        case .secureRandomUnavailable:
            return "Turnstile could not create a secure bridge channel."
        }
    }
}

/// A local CAPTCHA runtime failure, distinct from a server auth rejection.
public struct CaptchaUnavailableError: Error, LocalizedError, Sendable, Equatable {
    public let code = "captcha-unavailable"
    public let reason: String
    public let underlyingDescription: String?

    public init(reason: String, underlyingDescription: String? = nil) {
        self.reason = reason
        self.underlyingDescription = underlyingDescription
    }

    public var errorDescription: String? {
        if let underlyingDescription, !underlyingDescription.isEmpty {
            return "CAPTCHA unavailable: \(reason) (\(underlyingDescription))"
        }
        return "CAPTCHA unavailable: \(reason)"
    }
}

// MARK: - WKScriptMessageHandler

#if canImport(WebKit)
@MainActor
private final class TurnstileHandlerHolder {
    var handler: TurnstileMessageHandler?
}

@MainActor
private final class TurnstileMessageHandler: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    private var continuation: CheckedContinuation<String, Error>?
    private let channel: String
    private let expectedURL: URL
    var webView: WKWebView?
    weak var controller: WKUserContentController?
    var timeoutTask: Task<Void, Error>?

    init(
        channel: String,
        expectedURL: URL,
        continuation: CheckedContinuation<String, Error>
    ) {
        self.channel = channel
        self.expectedURL = expectedURL
        self.continuation = continuation
        super.init()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "edgebaseCaptcha" else { return }
        guard message.frameInfo.isMainFrame else {
            fail(with: TurnstileError.challengeFailed("origin_frame_mismatch"))
            return
        }
        guard message.frameInfo.securityOrigin.protocol.lowercased() == expectedURL.scheme?.lowercased(),
              message.frameInfo.securityOrigin.host.lowercased() == expectedURL.host?.lowercased(),
              message.frameInfo.securityOrigin.port == (expectedURL.port ?? 0) else {
            fail(with: TurnstileError.challengeFailed("origin_mismatch"))
            return
        }
        guard let raw = message.body as? String,
              let parsed = TurnstileProvider.parseChallengeMessage(raw, channel: channel) else { return }

        switch parsed.type {
        case "token":
            succeed(with: parsed.value)
        case "error":
            fail(with: TurnstileError.challengeFailed(parsed.value))
        case "interactive":
            handleInteractive(parsed.value)
        case "ready":
            break
        default: break
        }
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        let targetsMainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        if targetsMainFrame, navigationAction.request.url != expectedURL {
            decisionHandler(.cancel)
            fail(with: TurnstileError.challengeFailed("unexpected_navigation"))
            return
        }
        decisionHandler(.allow)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        if navigationResponse.isForMainFrame,
           let response = navigationResponse.response as? HTTPURLResponse,
           !(200...299).contains(response.statusCode) {
            decisionHandler(.cancel)
            fail(with: TurnstileError.challengeFailed("challenge_http_\(response.statusCode)"))
            return
        }
        decisionHandler(.allow)
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        fail(with: TurnstileError.challengeFailed("challenge_load_failed"))
    }

    func webView(
        _ webView: WKWebView,
        didFail navigation: WKNavigation!,
        withError error: Error
    ) {
        fail(with: TurnstileError.challengeFailed("challenge_load_failed"))
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        fail(with: TurnstileError.challengeFailed("challenge_renderer_terminated"))
    }

    private func succeed(with token: String) {
        guard continuation != nil else { return }
        timeoutTask?.cancel()
        timeoutTask = nil
        cleanup()
        continuation?.resume(returning: token)
        continuation = nil
    }

    func fail(with error: Error) {
        guard continuation != nil else { return }
        timeoutTask?.cancel()
        timeoutTask = nil
        cleanup()
        continuation?.resume(throwing: error)
        continuation = nil
    }

    private func handleInteractive(_ value: String) {
        guard let webView = webView else { return }

        if value == "show" {
            // Add the WebView as an overlay on the key window so the user
            // can interact with the challenge.
            #if os(iOS)
            if let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene,
               let keyWindow = scene.windows.first(where: { $0.isKeyWindow }) {
                webView.frame = keyWindow.bounds
                webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
                keyWindow.addSubview(webView)
            }
            #elseif os(macOS)
            if let keyWindow = NSApplication.shared.keyWindow {
                webView.frame = keyWindow.contentView?.bounds ?? keyWindow.frame
                webView.autoresizingMask = [.width, .height]
                keyWindow.contentView?.addSubview(webView)
            }
            #endif
        } else if value == "hide" {
            webView.removeFromSuperview()
        }
    }

    private func cleanup() {
        controller?.removeScriptMessageHandler(forName: "edgebaseCaptcha")
        webView?.navigationDelegate = nil
        webView?.stopLoading()
        #if os(iOS)
        webView?.removeFromSuperview()
        #elseif os(macOS)
        webView?.removeFromSuperview()
        #endif
        webView = nil
    }
}
#endif
