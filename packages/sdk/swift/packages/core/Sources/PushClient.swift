// PushClient — Push notification token management for iOS/macOS.
//
// FCM token provider pattern — app injects Firebase iOS SDK's token provider.
//
// Usage:
//   // In AppDelegate or setup:
//   client.push.setFcmTokenProvider { Messaging.messaging().fcmToken ?? "" }
//   client.push.setTopicProvider(
//     subscribe: { topic in try await Messaging.messaging().subscribe(toTopic: topic) },
//     unsubscribe: { topic in try await Messaging.messaging().unsubscribe(fromTopic: topic) }
//   )
//   // Then anywhere:
//   try await client.push.register()

import Foundation

#if canImport(UserNotifications)
import UserNotifications
#endif

#if canImport(UIKit)
import UIKit
#endif

#if canImport(AppKit)
import AppKit
#endif

/// Push notification platform type.
public enum PushPlatform: String, Sendable {
    case ios
    case android
    case web
    case macos
    case windows
}

/// Client-side push notification management.
/// Token acquisition delegated to app via setFcmTokenProvider() — Firebase iOS SDK provides the FCM token.
public final class PushClient: @unchecked Sendable {
    private let client: HttpClient?
    private var messageListeners: [(([String: Any]) -> Void)] = []
    private var openedAppListeners: [(([String: Any]) -> Void)] = []

    /// FCM token provider — set by app using Firebase iOS SDK.
    private var fcmTokenProvider: (() async throws -> String)?
    private var deviceIdProvider: (() -> String)?
    private var permissionStatusProvider: (() -> String)?
    private var permissionRequester: (() async -> String)?

    /// Topic subscription provider — set by app using Firebase iOS SDK.
    private var topicSubscriber: ((String) async throws -> Void)?
    private var topicUnsubscriber: ((String) async throws -> Void)?

    /// Platform override. Defaults to auto-detected (ios/macos).
    public var platform: PushPlatform = {
        #if os(iOS)
        return .ios
        #elseif os(macOS)
        return .macos
        #else
        return .ios
        #endif
    }()

    public init(_ client: HttpClient) {
        self.client = client
    }

    /// Internal init for unit tests — no network client.
    internal init() {
        self.client = nil
    }

    // MARK: - FCM Token Provider (FCM 일원화)

    /// Set the FCM token provider. Call during app setup with Firebase iOS SDK.
    /// Example: `client.push.setFcmTokenProvider { Messaging.messaging().fcmToken ?? "" }`
    public func setFcmTokenProvider(_ provider: @escaping () async throws -> String) {
        self.fcmTokenProvider = provider
    }

    /// Override device identity for headless or multi-device integrations.
    public func setDeviceIdProvider(_ provider: @escaping () -> String) {
        self.deviceIdProvider = provider
    }

    /// Override permission status lookup for headless or custom-platform integrations.
    public func setPermissionStatusProvider(_ provider: @escaping () -> String) {
        self.permissionStatusProvider = provider
    }

    /// Override permission request flow for headless or custom-platform integrations.
    public func setPermissionRequester(_ requester: @escaping () async -> String) {
        self.permissionRequester = requester
    }

    /// Set topic subscription providers. Call during app setup with Firebase iOS SDK.
    /// Example:
    /// ```
    /// client.push.setTopicProvider(
    ///   subscribe: { topic in try await Messaging.messaging().subscribe(toTopic: topic) },
    ///   unsubscribe: { topic in try await Messaging.messaging().unsubscribe(fromTopic: topic) }
    /// )
    /// ```
    public func setTopicProvider(
        subscribe: @escaping (String) async throws -> Void,
        unsubscribe: @escaping (String) async throws -> Void
    ) {
        self.topicSubscriber = subscribe
        self.topicUnsubscriber = unsubscribe
    }

    /// Subscribe to an FCM topic.
    public func subscribeTopic(_ topic: String) async throws {
        guard let subscriber = topicSubscriber else {
            throw PushError.topicProviderNotSet
        }
        try await subscriber(topic)
    }

    /// Unsubscribe from an FCM topic.
    public func unsubscribeTopic(_ topic: String) async throws {
        guard let unsubscriber = topicUnsubscriber else {
            throw PushError.topicProviderNotSet
        }
        try await unsubscriber(topic)
    }

    // MARK: - Device ID & Token Cache

    private static let deviceIdKey = "jb_push_device_id"
    private static let tokenCacheKey = "jb_push_token_cache"

    private func getOrCreateDeviceId() -> String {
        if let provider = deviceIdProvider {
            return provider()
        }
        if let existing = UserDefaults.standard.string(forKey: Self.deviceIdKey) {
            return existing
        }
        let id = UUID().uuidString
        UserDefaults.standard.set(id, forKey: Self.deviceIdKey)
        return id
    }

    private func getCachedToken() -> String? {
        UserDefaults.standard.string(forKey: Self.tokenCacheKey)
    }

    private func setCachedToken(_ token: String) {
        UserDefaults.standard.set(token, forKey: Self.tokenCacheKey)
    }

    private func clearCachedToken() {
        UserDefaults.standard.removeObject(forKey: Self.tokenCacheKey)
    }

    // MARK: - Register

    /// Register for push notifications.
    /// Requests permission, obtains FCM token via provider, caches and sends to server.
    /// Auto-collects deviceInfo (model, OS, locale). Skips network if token unchanged (§9).
    public func register(metadata: [String: Any]? = nil) async throws {
        // 1. Request permission
        let permStatus = await requestPermission()
        guard permStatus == "granted" else { return }

        // 2. Get FCM token via provider
        guard let provider = fcmTokenProvider else {
            throw PushError.tokenProviderNotSet
        }
        let token = try await provider()
        guard !token.isEmpty else {
            throw PushError.tokenEmpty
        }

        // 3. Check cache — skip if unchanged (§9), unless metadata provided
        if getCachedToken() == token && metadata == nil { return }

        // 4. Register with server — auto-collect deviceInfo
        let deviceId = getOrCreateDeviceId()
        var body: [String: Any] = [
            "deviceId": deviceId,
            "token": token,
            "platform": platform.rawValue,
            "deviceInfo": collectDeviceInfo(),
        ]
        if let meta = metadata {
            body["metadata"] = meta
        }
        let _ = try await client?.post("/push/register", body)
        setCachedToken(token)
    }

    /// Auto-collect device info.
    private func collectDeviceInfo() -> [String: String] {
        var info: [String: String] = [:]
        #if os(iOS) || os(tvOS)
        info["name"] = UIDevice.current.model
        info["osVersion"] = "iOS " + UIDevice.current.systemVersion
        #elseif os(macOS)
        let ver = ProcessInfo.processInfo.operatingSystemVersion
        info["name"] = "Mac"
        info["osVersion"] = "macOS \(ver.majorVersion).\(ver.minorVersion).\(ver.patchVersion)"
        #elseif os(watchOS)
        info["name"] = "Apple Watch"
        info["osVersion"] = "watchOS"
        #endif
        info["locale"] = Locale.current.identifier
        return info
    }

    /// Unregister the current device (or a specific device by ID).
    public func unregister(deviceId: String? = nil) async throws {
        let id = deviceId ?? getOrCreateDeviceId()
        let _ = try await client?.post("/push/unregister", ["deviceId": id])
        clearCachedToken()
    }

    // MARK: - Message listeners

    /// Listen for push messages in foreground.
    public func onMessage(_ callback: @escaping ([String: Any]) -> Void) {
        messageListeners.append(callback)
    }

    /// Listen for notification taps that opened the app.
    public func onMessageOpenedApp(_ callback: @escaping ([String: Any]) -> Void) {
        openedAppListeners.append(callback)
    }

    /// Get notification permission status via UNUserNotificationCenter.
    public func getPermissionStatus() async -> String {
        if let provider = permissionStatusProvider {
            return provider()
        }
        #if canImport(UserNotifications)
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            return "granted"
        case .denied:
            return "denied"
        default:
            return "notDetermined"
        }
        #else
        return "notDetermined"
        #endif
    }

    /// Request notification permission from the user.
    public func requestPermission() async -> String {
        if let requester = permissionRequester {
            return await requester()
        }
        #if canImport(UserNotifications)
        let center = UNUserNotificationCenter.current()
        do {
            let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
            return granted ? "granted" : "denied"
        } catch {
            return "denied"
        }
        #else
        return "denied"
        #endif
    }

    /// Dispatch a foreground message to registered listeners.
    public func dispatchMessage(_ message: [String: Any]) {
        for cb in messageListeners { cb(message) }
    }

    /// Dispatch a notification-opened event to registered listeners.
    public func dispatchMessageOpenedApp(_ message: [String: Any]) {
        for cb in openedAppListeners { cb(message) }
    }
}

/// Push-related errors.
public enum PushError: Error, LocalizedError {
    case tokenProviderNotSet
    case tokenEmpty
    case topicProviderNotSet

    public var errorDescription: String? {
        switch self {
        case .tokenProviderNotSet:
            return "FCM token provider not set. Call client.push.setFcmTokenProvider() first."
        case .tokenEmpty:
            return "FCM token provider returned empty token. Ensure Firebase is configured."
        case .topicProviderNotSet:
            return "Topic provider not set. Call client.push.setTopicProvider(subscribe:unsubscribe:) first."
        }
    }
}
