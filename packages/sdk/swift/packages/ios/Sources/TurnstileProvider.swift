import EdgeBaseCore
import Foundation
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

    // MARK: - Public API

    /// Resolve a captcha token for the given action.
    ///
    /// - Parameters:
    ///   - core: GeneratedDbApi instance for fetching config.
    ///   - baseUrl: The EdgeBase project URL (used as cache key).
    ///   - action: Turnstile action string (e.g. "signup", "signin").
    ///   - manualToken: If the caller already has a token, it is returned as-is.
    /// - Returns: A captcha token string, or `nil` if captcha is not configured.
    public static func resolveCaptchaToken(core: GeneratedDbApi, baseUrl: String, action: String, manualToken: String? = nil) async -> String? {
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
        guard let siteKey = await fetchSiteKey(core: core, baseUrl: baseUrl) else {
            return nil
        }

        // Acquire a token via WKWebView.
        do {
            let token = try await acquireToken(siteKey: siteKey, action: action)
            return token
        } catch {
            return nil
        }
    }

    // MARK: - Fetch siteKey

    /// Fetch the Turnstile siteKey via `GeneratedDbApi.getConfig()`.
    /// The result is cached per baseUrl so we only hit the network once.
    public static func fetchSiteKey(core: GeneratedDbApi, baseUrl: String) async -> String? {
        // Return cached value if the baseUrl has not changed.
        if let cached = cachedSiteKey, cachedBaseUrl == baseUrl {
            return cached
        }

        do {
            let result = try await core.getConfig()
            if let json = result as? [String: Any],
               let captcha = json["captcha"] as? [String: Any],
               let siteKey = captcha["siteKey"] as? String, !siteKey.isEmpty {
                cachedBaseUrl = baseUrl
                cachedSiteKey = siteKey
                return siteKey
            }
        } catch {
            // Network or parsing error — captcha is unavailable.
        }

        return nil
    }

    // MARK: - Acquire token via WKWebView

#if canImport(WebKit)
    /// Acquire a Turnstile token by rendering the challenge in a WKWebView.
    /// Must run on the main actor because WKWebView is a UI component.
    @MainActor
    public static func acquireToken(siteKey: String, action: String) async throws -> String {
        return try await withCheckedThrowingContinuation { continuation in
            let handler = TurnstileMessageHandler(continuation: continuation)

            let config = WKWebViewConfiguration()
            let controller = WKUserContentController()
            controller.add(handler, name: "onToken")
            controller.add(handler, name: "onError")
            controller.add(handler, name: "onInteractive")
            config.userContentController = controller

            let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 400, height: 300), configuration: config)
            #if os(iOS)
            webView.backgroundColor = .clear
            webView.scrollView.isScrollEnabled = false
            #elseif os(macOS)
            webView.setValue(false, forKey: "drawsBackground")
            #endif

            handler.webView = webView

            guard let overlayURL = Self.turnstileOverlayURL(siteKey: siteKey, action: action) else {
                continuation.resume(throwing: TurnstileError.missingTemplate)
                return
            }
            webView.loadFileURL(overlayURL, allowingReadAccessTo: overlayURL.deletingLastPathComponent())

            // Timeout after 30 seconds.
            let timeoutTask = Task {
                try await Task.sleep(nanoseconds: 30_000_000_000)
                handler.fail(with: TurnstileError.timeout)
            }
            handler.timeoutTask = timeoutTask
        }
    }
#else
    /// Stub for platforms without WebKit — always throws.
    public static func acquireToken(siteKey: String, action: String) async throws -> String {
        throw TurnstileError.unsupportedPlatform
    }
#endif

    // MARK: - HTML template

    private static func turnstileOverlayURL(siteKey: String, action: String) -> URL? {
        guard let resourceURL = Bundle.module.url(forResource: "TurnstileOverlay", withExtension: "html") else {
            return nil
        }
        var components = URLComponents(url: resourceURL, resolvingAgainstBaseURL: false)
        components?.queryItems = [
            URLQueryItem(name: "siteKey", value: siteKey),
            URLQueryItem(name: "action", value: action),
            URLQueryItem(name: "appearance", value: "interaction-only"),
        ]
        return components?.url
    }
}

// MARK: - Errors

public enum TurnstileError: Error, LocalizedError {
    case timeout
    case challengeFailed(String)
    case missingTemplate
    case unsupportedPlatform

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
        }
    }
}

// MARK: - WKScriptMessageHandler

#if canImport(WebKit)
private final class TurnstileMessageHandler: NSObject, WKScriptMessageHandler {
    private var continuation: CheckedContinuation<String, Error>?
    var webView: WKWebView?
    var timeoutTask: Task<Void, Error>?

    init(continuation: CheckedContinuation<String, Error>) {
        self.continuation = continuation
        super.init()
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        let value = message.body as? String ?? ""

        switch message.name {
        case "onToken":
            succeed(with: value)
        case "onError":
            fail(with: TurnstileError.challengeFailed(value))
        case "onInteractive":
            handleInteractive(value)
        default:
            break
        }
    }

    private func succeed(with token: String) {
        timeoutTask?.cancel()
        removeWebView()
        continuation?.resume(returning: token)
        continuation = nil
    }

    func fail(with error: Error) {
        guard continuation != nil else { return }
        timeoutTask?.cancel()
        removeWebView()
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
            removeWebView()
        }
    }

    private func removeWebView() {
        #if os(iOS)
        webView?.removeFromSuperview()
        #elseif os(macOS)
        webView?.removeFromSuperview()
        #endif
    }
}
#endif
