// PushClient — Push notification management for Unity.
//
// Unity can't directly use FirebaseMessaging from netstandard2.1,
// so the app provides tokens via callbacks. The SDK handles everything else:
// caching, deviceInfo, platform detection, and server registration.
//
// Usage in Unity:
//
//   // 1. Set platform (auto-detected from Unity's RuntimePlatform)
//   client.Push.Platform = PushPlatform.Ios;  // or Android, Macos, Web
//
//   // 2. Set token provider (from Firebase Unity SDK or native plugin)
//   client.Push.TokenProvider = async () => {
//       var task = FirebaseMessaging.GetTokenAsync();
//       await task;
//       return task.Result;
//   };
//
//   // 3. Set permission handler
//   client.Push.PermissionRequester = async () => "granted";  // Unity handles permission natively
//
//   // 4. Set device info (from Unity's SystemInfo)
//   client.Push.DeviceInfoProvider = () => new Dictionary<string, string> {
//       ["name"] = SystemInfo.deviceModel,
//       ["osVersion"] = SystemInfo.operatingSystem,
//       ["locale"] = Application.systemLanguage.ToString(),
//   };
//
//   // 5. Register — SDK handles caching, deviceId, server communication
//   await client.Push.RegisterAsync();
//   await client.Push.RegisterAsync(new Dictionary<string, object> { ["topic"] = "news" });

using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using EdgeBase.Generated;

namespace EdgeBase
{
    /// <summary>
    /// Supported push platforms (Windows/Linux excluded — use Web Push via browser).
    /// </summary>
    public enum PushPlatform
    {
        Ios,
        Android,
        Web,
        Macos
    }

    /// <summary>
    /// Client-side push notification management for Unity.
    /// <para>
    /// Supported platforms: Android (FCM), iOS (FCM), macOS (FCM), Web (FCM).
    /// Windows/Linux are not supported for native push — use Web Push (browser) instead.
    /// </para>
    /// <para>
    /// In Unity, set <see cref="TokenProvider"/> to supply the push token from
    /// Firebase Unity SDK or your native plugin. The SDK handles caching,
    /// device ID generation, deviceInfo gathering, and server registration.
    /// </para>
    /// </summary>
    public sealed class PushClient
    {
        private readonly JbHttpClient _http;
        private readonly List<Action<Dictionary<string, object>>> _messageListeners = new();
        private readonly List<Action<Dictionary<string, object>>> _openedAppListeners = new();

        // Internal cache
        private string? _cachedDeviceId;
        private string? _cachedToken;

        /// <summary>
        /// Token provider — set by app to supply native push token.
        /// <para>Android: <c>FirebaseMessaging.GetTokenAsync()</c></para>
        /// <para>iOS: FCM token from Firebase iOS SDK or native plugin</para>
        /// <para>Web: FCM token from Firebase JS SDK</para>
        /// </summary>
        public Func<Task<string>>? TokenProvider { get; set; }

        /// <summary>
        /// Device info provider — set from Unity's <c>SystemInfo</c>.
        /// Returns name, osVersion, locale.
        /// </summary>
        public Func<Dictionary<string, string>>? DeviceInfoProvider { get; set; }

        /// <summary>Override for platform-specific permission status check.</summary>
        public Func<string>? PermissionStatusProvider { get; set; }

        /// <summary>Override for platform-specific permission request.</summary>
        public Func<Task<string>>? PermissionRequester { get; set; }

        /// <summary>
        /// Topic subscription handler — set from Firebase Unity SDK.
        /// <para>Example: <c>client.Push.TopicSubscriber = topic => FirebaseMessaging.SubscribeAsync(topic);</c></para>
        /// </summary>
        public Func<string, Task>? TopicSubscriber { get; set; }

        /// <summary>
        /// Topic unsubscription handler — set from Firebase Unity SDK.
        /// <para>Example: <c>client.Push.TopicUnsubscriber = topic => FirebaseMessaging.UnsubscribeAsync(topic);</c></para>
        /// </summary>
        public Func<string, Task>? TopicUnsubscriber { get; set; }

        /// <summary>
        /// Push platform. Set based on Unity's <c>Application.platform</c>.
        /// <para>Example: <c>RuntimePlatform.Android → PushPlatform.Android</c></para>
        /// </summary>
        public PushPlatform Platform { get; set; } = PushPlatform.Android;

        public PushClient(JbHttpClient http)
        {
            _http = http;
        }

        private string GetOrCreateDeviceId()
        {
            _cachedDeviceId ??= Guid.NewGuid().ToString();
            return _cachedDeviceId;
        }

        /// <summary>
        /// Register for push notifications.
        /// Obtains token via <see cref="TokenProvider"/>, auto-collects deviceInfo,
        /// caches token, sends to server only on change (§9).
        /// </summary>
        public async Task RegisterAsync(Dictionary<string, object>? metadata = null)
        {
            // 1. Request permission
            var perm = await RequestPermissionAsync();
            if (perm != "granted") return;

            // 2. Get token from provider
            if (TokenProvider == null)
                throw new InvalidOperationException(
                    "TokenProvider not set. In Unity, set client.Push.TokenProvider = async () => await FirebaseMessaging.GetTokenAsync();");
            var token = await TokenProvider();

            // 3. Check cache — skip if unchanged (§9), unless metadata provided
            if (_cachedToken == token && metadata == null) return;

            // 4. Register with server — collect deviceInfo
            var deviceId = GetOrCreateDeviceId();
            var deviceInfo = DeviceInfoProvider?.Invoke() ?? new Dictionary<string, string>
            {
                ["osVersion"] = Environment.OSVersion.ToString(),
                ["locale"] = System.Globalization.CultureInfo.CurrentCulture.Name,
            };
            var body = new Dictionary<string, object>
            {
                ["deviceId"] = deviceId,
                ["token"] = token,
                ["platform"] = Platform.ToString().ToLowerInvariant(),
                ["deviceInfo"] = deviceInfo,
            };
            if (metadata != null) body["metadata"] = metadata;
            await _http.PostAsync(ApiPaths.PUSH_REGISTER, body);
            _cachedToken = token;
        }

        /// <summary>Unregister current device (or a specific device by ID).</summary>
        public async Task UnregisterAsync(string? deviceId = null)
        {
            var id = deviceId ?? GetOrCreateDeviceId();
            await _http.PostAsync(ApiPaths.PUSH_UNREGISTER,
                new Dictionary<string, object> { ["deviceId"] = id });
            _cachedToken = null;
        }

        /// <summary>Listen for push messages in foreground.</summary>
        public void OnMessage(Action<Dictionary<string, object>> callback)
        {
            _messageListeners.Add(callback);
        }

        /// <summary>Listen for notification taps that opened the app.</summary>
        public void OnMessageOpenedApp(Action<Dictionary<string, object>> callback)
        {
            _openedAppListeners.Add(callback);
        }

        /// <summary>
        /// Get notification permission status.
        /// Uses <see cref="PermissionStatusProvider"/> if set, otherwise returns "notDetermined".
        /// Set the provider from your Unity-specific code using the platform permission API.
        /// </summary>
        public string GetPermissionStatus()
        {
            if (PermissionStatusProvider != null)
                return PermissionStatusProvider.Invoke();
            return "notDetermined";
        }

        /// <summary>
        /// Request notification permission.
        /// Uses <see cref="PermissionRequester"/> if set, otherwise returns "granted"
        /// (Unity plugins typically handle permissions natively during token acquisition).
        /// </summary>
        public async Task<string> RequestPermissionAsync()
        {
            if (PermissionRequester != null)
                return await PermissionRequester.Invoke();
            // Unity handles permission natively — default to granted
            return "granted";
        }

        /// <summary>Dispatch a foreground message to registered listeners.</summary>
        public void DispatchMessage(Dictionary<string, object> message)
        {
            foreach (var cb in _messageListeners) cb(message);
        }

        /// <summary>Dispatch a notification-opened event to registered listeners.</summary>
        public void DispatchMessageOpenedApp(Dictionary<string, object> message)
        {
            foreach (var cb in _openedAppListeners) cb(message);
        }

        /// <summary>Subscribe to a push notification topic (FCM 일원화).</summary>
        public async Task SubscribeTopicAsync(string topic)
        {
            if (TopicSubscriber == null)
                throw new InvalidOperationException(
                    "TopicSubscriber not set. Set client.Push.TopicSubscriber = topic => FirebaseMessaging.SubscribeAsync(topic);");
            await TopicSubscriber(topic);
        }

        /// <summary>Unsubscribe from a push notification topic (FCM 일원화).</summary>
        public async Task UnsubscribeTopicAsync(string topic)
        {
            if (TopicUnsubscriber == null)
                throw new InvalidOperationException(
                    "TopicUnsubscriber not set. Set client.Push.TopicUnsubscriber = topic => FirebaseMessaging.UnsubscribeAsync(topic);");
            await TopicUnsubscriber(topic);
        }
    }
}
