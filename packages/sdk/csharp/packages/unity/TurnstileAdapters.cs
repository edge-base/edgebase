// EdgeBase — Unity Turnstile WebView adapters.
//
// Built-in adapters for popular Unity WebView plugins.
// Automatically detects and registers the correct adapter at startup.
//
// ─── Supported Plugins ──────────────────────────────────────────────────────
//
// 1. Unity WebGL browser bridge — built-in, no extra plugin required
// 2. UniWebView (paid)          — define UNIWEBVIEW in Scripting Define Symbols
// 3. Vuplex 3D WebView (paid)   — define VUPLEX_WEBVIEW in Scripting Define Symbols
// 4. gree/unity-webview (free)  — define UNITY_WEBVIEW_GREE in Scripting Define Symbols
//
// ─── How it works ───────────────────────────────────────────────────────────
//
// 1. On app start, [RuntimeInitializeOnLoadMethod] auto-registers the adapter.
// 2. When signUp/signIn/etc. need a captcha token, the adapter:
//    a. Creates an off-screen WebView
//    b. Loads Turnstile HTML (from TurnstileProvider.GetTurnstileHtml)
//    c. Turnstile auto-passes invisibly for 99% of users
//    d. If interactive challenge needed, shows the WebView as overlay
//    e. Token received via JS bridge → returned to auth method
// 3. If no supported plugin is installed, falls back to TurnstileProvider.SetWebViewFactory().
//
// ─── Custom Plugin Support ──────────────────────────────────────────────────
//
// If your project uses a different WebView plugin, call SetWebViewFactory():
//
//   TurnstileProvider.SetWebViewFactory(async (siteKey, action) => {
//       var html = TurnstileProvider.GetTurnstileHtml(siteKey, action);
//       // Load html in your WebView, capture token from JS bridge
//       return token;
//   });

#if UNITY_5_3_OR_NEWER

using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using UnityEngine;

namespace EdgeBase
{

/// <summary>
/// Auto-registers the best available WebView adapter at startup.
/// </summary>
public static class TurnstileAdapters
{
    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    private static void AutoRegister()
    {
        // Skip if user already set a custom factory
        if (TurnstileProvider.HasWebViewFactory)
            return;

#if UNITY_WEBGL && !UNITY_EDITOR
        TurnstileProvider.SetWebViewFactory(WebGLBrowserAdapter.AcquireTokenAsync);
        Debug.Log("[EdgeBase] Turnstile: WebGL browser adapter registered.");
#elif (UNITY_ANDROID || UNITY_IOS) && !UNITY_EDITOR
        TurnstileProvider.SetWebViewFactory(NativeMobileTurnstileAdapter.AcquireTokenAsync);
        Debug.Log("[EdgeBase] Turnstile: built-in native mobile adapter registered.");
#elif UNIWEBVIEW
        TurnstileProvider.SetWebViewFactory(UniWebViewAdapter.AcquireTokenAsync);
        Debug.Log("[EdgeBase] Turnstile: UniWebView adapter registered.");
#elif VUPLEX_WEBVIEW
        TurnstileProvider.SetWebViewFactory(VuplexAdapter.AcquireTokenAsync);
        Debug.Log("[EdgeBase] Turnstile: Vuplex 3D WebView adapter registered.");
#elif UNITY_WEBVIEW_GREE
        TurnstileProvider.SetWebViewFactory(GreeWebViewAdapter.AcquireTokenAsync);
        Debug.Log("[EdgeBase] Turnstile: gree/unity-webview adapter registered.");
#else
        Debug.LogWarning(
            "[EdgeBase] Turnstile: No supported WebView plugin detected. " +
            "Use the built-in WebGL bridge in browser builds, or install UniWebView, " +
            "Vuplex, or gree/unity-webview for native targets. " +
            "You can also call TurnstileProvider.SetWebViewFactory() manually."
        );
#endif
    }
}

#if UNITY_WEBGL && !UNITY_EDITOR
internal static class WebGLBrowserAdapter
{
    private const float TimeoutSeconds = 30f;

    public static Task<string> AcquireTokenAsync(string siteKey, string action)
    {
        return WebGLTurnstileReceiver.RequestTokenAsync(siteKey, action, TimeoutSeconds);
    }
}

internal sealed class WebGLTurnstileReceiver : MonoBehaviour
{
    [DllImport("__Internal")] private static extern void EB_Turnstile_RequestToken(string gameObjectName, string requestId, string siteKey, string action);
    [DllImport("__Internal")] private static extern void EB_Turnstile_CancelTokenRequest(string requestId);

    [Serializable]
    private struct BridgeMessage
    {
        public string requestId;
        public string type;
        public string value;
    }

    private static WebGLTurnstileReceiver? _instance;
    private static readonly Dictionary<string, TaskCompletionSource<string>> Pending = new();
    private static readonly Dictionary<string, float> Deadlines = new();

    public static Task<string> RequestTokenAsync(string siteKey, string action, float timeoutSeconds)
    {
        var instance = EnsureInstance();
        var requestId = Guid.NewGuid().ToString("N");
        var completion = new TaskCompletionSource<string>();

        Pending[requestId] = completion;
        Deadlines[requestId] = Time.unscaledTime + timeoutSeconds;
        EB_Turnstile_RequestToken(instance.gameObject.name, requestId, siteKey, action);
        return completion.Task;
    }

    public void OnEdgeBaseCaptchaTokenMessage(string json)
    {
        var message = JsonUtility.FromJson<BridgeMessage>(json);
        if (string.IsNullOrEmpty(message.requestId))
        {
            Debug.LogWarning("[EdgeBase] Turnstile: missing request id from WebGL bridge.");
            return;
        }

        if (!Pending.TryGetValue(message.requestId, out var completion))
        {
            return;
        }

        if (message.type == "token")
        {
            completion.TrySetResult(message.value);
            ClearRequest(message.requestId);
            return;
        }

        if (message.type == "error")
        {
            completion.TrySetException(new Exception($"Turnstile error: {message.value}"));
            ClearRequest(message.requestId);
            return;
        }

        if (message.type == "debug")
        {
            Debug.Log($"[EdgeBase] Turnstile: {message.value}");
        }
    }

    private void Update()
    {
        if (Deadlines.Count == 0)
        {
            return;
        }

        var expired = new List<string>();
        foreach (var entry in Deadlines)
        {
            if (Time.unscaledTime >= entry.Value)
            {
                expired.Add(entry.Key);
            }
        }

        foreach (var requestId in expired)
        {
            if (Pending.TryGetValue(requestId, out var completion))
            {
                completion.TrySetException(new TimeoutException("Turnstile timeout"));
            }
            EB_Turnstile_CancelTokenRequest(requestId);
            ClearRequest(requestId);
        }
    }

    private static void ClearRequest(string requestId)
    {
        Pending.Remove(requestId);
        Deadlines.Remove(requestId);
    }

    private static WebGLTurnstileReceiver EnsureInstance()
    {
        if (_instance != null)
        {
            return _instance;
        }

        var go = new GameObject("EdgeBaseTurnstileWebGLReceiver");
        DontDestroyOnLoad(go);
        _instance = go.AddComponent<WebGLTurnstileReceiver>();
        return _instance;
    }
}
#endif

#if (UNITY_ANDROID || UNITY_IOS) && !UNITY_EDITOR
public static class NativeMobileTurnstileAdapter
{
    private const float TimeoutSeconds = 45f;

    public static Task<string> AcquireTokenAsync(string siteKey, string action)
    {
        return NativeTurnstileReceiver.RequestTokenAsync(siteKey, action, "interaction-only", TimeoutSeconds);
    }

    public static Task<string> AcquirePreviewTokenAsync(string siteKey, string action, string appearance = "always")
    {
        return NativeTurnstileReceiver.RequestTokenAsync(siteKey, action, appearance, TimeoutSeconds);
    }
}

internal sealed class NativeTurnstileReceiver : MonoBehaviour
{
#if UNITY_IOS
    [DllImport("__Internal")]
    private static extern void EB_Turnstile_RequestToken(
        [MarshalAs(UnmanagedType.LPUTF8Str)] string gameObjectName,
        [MarshalAs(UnmanagedType.LPUTF8Str)] string requestId,
        [MarshalAs(UnmanagedType.LPUTF8Str)] string html);

    [DllImport("__Internal")]
    private static extern void EB_Turnstile_CancelTokenRequest([MarshalAs(UnmanagedType.LPUTF8Str)] string requestId);
#endif

    [Serializable]
    private struct BridgeMessage
    {
        public string requestId;
        public string type;
        public string value;
    }

    private static readonly object Sync = new();
    private static NativeTurnstileReceiver? _instance;
    private static readonly Dictionary<string, TaskCompletionSource<string>> Pending = new();
    private static readonly Dictionary<string, DateTime> Deadlines = new();

    public static Task<string> RequestTokenAsync(string siteKey, string action, string appearance, float timeoutSeconds)
    {
        var html = TurnstileProvider.GetTurnstileHtml(siteKey, action, appearance);
        return RequestHtmlAsync(html, timeoutSeconds);
    }

    public static Task<string> RequestHtmlAsync(string html, float timeoutSeconds)
    {
        var instance = EnsureInstance();
        var requestId = Guid.NewGuid().ToString("N");
        var completion = new TaskCompletionSource<string>();

        lock (Sync)
        {
            Pending[requestId] = completion;
            Deadlines[requestId] = DateTime.UtcNow.AddSeconds(timeoutSeconds);
        }

        UnityMainThreadDispatcher.Enqueue(() => RequestNativeToken(instance.gameObject.name, requestId, html));
        return completion.Task;
    }

    public void OnEdgeBaseCaptchaTokenMessage(string json)
    {
        var message = JsonUtility.FromJson<BridgeMessage>(json);
        var requestId = message.requestId;
        if (string.IsNullOrEmpty(requestId))
        {
            lock (Sync)
            {
                if (Pending.Count == 1)
                {
                    foreach (var entry in Pending)
                    {
                        requestId = entry.Key;
                        break;
                    }
                }
            }
        }

        if (string.IsNullOrEmpty(requestId))
        {
            Debug.LogWarning("[EdgeBase] Turnstile: missing request id from native bridge.");
            return;
        }

        TaskCompletionSource<string>? completion;
        lock (Sync)
        {
            Pending.TryGetValue(requestId, out completion);
        }

        if (completion == null)
        {
            return;
        }

        switch (message.type)
        {
            case "token":
                completion.TrySetResult(message.value);
                ClearRequest(requestId);
                break;
            case "error":
                completion.TrySetException(new Exception($"Turnstile error: {message.value}"));
                ClearRequest(requestId);
                break;
            case "debug":
                Debug.Log($"[EdgeBase] Turnstile: {message.value}");
                break;
        }
    }

    private void Update()
    {
        List<string>? expired = null;

        lock (Sync)
        {
            if (Deadlines.Count == 0)
            {
                return;
            }

            foreach (var entry in Deadlines)
            {
                if (DateTime.UtcNow < entry.Value)
                {
                    continue;
                }

                expired ??= new List<string>();
                expired.Add(entry.Key);
            }
        }

        if (expired == null)
        {
            return;
        }

        foreach (var requestId in expired)
        {
            TaskCompletionSource<string>? completion;
            lock (Sync)
            {
                Pending.TryGetValue(requestId, out completion);
            }

            completion?.TrySetException(new TimeoutException("Turnstile timeout"));
            CancelNativeToken(requestId);
            ClearRequest(requestId);
        }
    }

    private static void RequestNativeToken(string gameObjectName, string requestId, string html)
    {
#if UNITY_ANDROID
        using var bridge = new AndroidJavaClass("dev.edgebase.unity.EdgeBaseTurnstileBridge");
        bridge.CallStatic("requestToken", gameObjectName, requestId, html);
#elif UNITY_IOS
        EB_Turnstile_RequestToken(gameObjectName, requestId, html);
#endif
    }

    private static void CancelNativeToken(string requestId)
    {
#if UNITY_ANDROID
        using var bridge = new AndroidJavaClass("dev.edgebase.unity.EdgeBaseTurnstileBridge");
        bridge.CallStatic("cancelTokenRequest", requestId);
#elif UNITY_IOS
        EB_Turnstile_CancelTokenRequest(requestId);
#endif
    }

    private static void ClearRequest(string requestId)
    {
        lock (Sync)
        {
            Pending.Remove(requestId);
            Deadlines.Remove(requestId);
        }
    }

    private static NativeTurnstileReceiver EnsureInstance()
    {
        if (_instance != null)
        {
            return _instance;
        }

        var go = new GameObject("EdgeBaseTurnstileNativeReceiver");
        DontDestroyOnLoad(go);
        _instance = go.AddComponent<NativeTurnstileReceiver>();
        return _instance;
    }
}
#else
public static class NativeMobileTurnstileAdapter
{
    public static Task<string> AcquireTokenAsync(string siteKey, string action)
    {
        return Task.FromException<string>(new PlatformNotSupportedException("Native mobile Turnstile is only available on Android and iOS players."));
    }

    public static Task<string> AcquirePreviewTokenAsync(string siteKey, string action, string appearance = "always")
    {
        return Task.FromException<string>(new PlatformNotSupportedException("Native mobile Turnstile is only available on Android and iOS players."));
    }
}
#endif

// ─── UniWebView Adapter ─────────────────────────────────────────────────────
// https://uniwebview.com — Most popular paid Unity WebView plugin.
// Define UNIWEBVIEW in Player Settings > Scripting Define Symbols.

#if UNIWEBVIEW
public static class UniWebViewAdapter
{
    public static async Task<string> AcquireTokenAsync(string siteKey, string action)
    {
        var tcs = new TaskCompletionSource<string>();
        string html = TurnstileProvider.GetTurnstileHtml(siteKey, action);

        // Must run on Unity main thread
        await RunOnMainThread(() =>
        {
            var go = new GameObject("EdgeBase_Turnstile");
            var webView = go.AddComponent<UniWebView>();

            // Start off-screen (invisible for 99% auto-pass)
            webView.Frame = new Rect(0, 0, 1, 1);
            webView.SetShowSpinnerWhileLoading(false);
            webView.SetBackgroundColor(Color.clear);

            // JS → Unity message handler
            webView.OnMessageReceived += (view, message) =>
            {
                // Messages arrive as uniwebview://action?token=xxx
                if (message.Path == "token" && !string.IsNullOrEmpty(message.Args["value"]))
                {
                    if (!tcs.Task.IsCompleted)
                        tcs.TrySetResult(message.Args["value"]);
                    CleanupWebView(go, webView);
                }
                else if (message.Path == "error")
                {
                    if (!tcs.Task.IsCompleted)
                        tcs.TrySetException(new Exception($"Turnstile error: {message.Args["value"]}"));
                    CleanupWebView(go, webView);
                }
                else if (message.Path == "interactive")
                {
                    if (message.Args["value"] == "show")
                    {
                        // Show WebView for user interaction
                        webView.Frame = new Rect(0, 0, Screen.width, Screen.height);
                        webView.Show();
                    }
                    else if (message.Args["value"] == "hide")
                    {
                        webView.Hide();
                    }
                }
            };

            // Load Turnstile HTML with UniWebView-compatible JS bridge
            string adaptedHtml = html
                .Replace(
                    "window.external.notify('token:'+t)",
                    "location.href='uniwebview://token?value='+encodeURIComponent(t)")
                .Replace(
                    "window.external.notify('error:'+e)",
                    "location.href='uniwebview://error?value='+encodeURIComponent(e)")
                .Replace(
                    "window.external.notify('interactive:show')",
                    "location.href='uniwebview://interactive?value=show'")
                .Replace(
                    "window.external.notify('interactive:hide')",
                    "location.href='uniwebview://interactive?value=hide'")
                .Replace(
                    "window.external.notify('error:timeout')",
                    "location.href='uniwebview://error?value=timeout'");

            webView.LoadHTMLString(adaptedHtml, "https://challenges.cloudflare.com");
            webView.Show(false); // Load in background

            // Timeout
            _ = Task.Delay(30000).ContinueWith(_ =>
            {
                if (!tcs.Task.IsCompleted)
                {
                    tcs.TrySetException(new TimeoutException("Turnstile timeout"));
                    RunOnMainThread(() => CleanupWebView(go, webView));
                }
            });
        });

        return await tcs.Task;
    }

    private static void CleanupWebView(GameObject go, UniWebView webView)
    {
        if (webView != null) webView.CleanCache();
        if (go != null) UnityEngine.Object.Destroy(go);
    }

    private static Task RunOnMainThread(Action action)
    {
        var tcs = new TaskCompletionSource<bool>();
        // Use Unity's UnitySynchronizationContext
        UnityMainThreadDispatcher.Enqueue(() =>
        {
            try { action(); tcs.SetResult(true); }
            catch (Exception ex) { tcs.SetException(ex); }
        });
        return tcs.Task;
    }
}
#endif

// ─── Vuplex 3D WebView Adapter ─────────────────────────────────────────────
// https://vuplex.com — Premium 3D WebView for Unity.
// Define VUPLEX_WEBVIEW in Player Settings > Scripting Define Symbols.

#if VUPLEX_WEBVIEW
public static class VuplexAdapter
{
    public static async Task<string> AcquireTokenAsync(string siteKey, string action)
    {
        var tcs = new TaskCompletionSource<string>();
        string html = TurnstileProvider.GetTurnstileHtml(siteKey, action);

        await RunOnMainThread(async () =>
        {
            // Create prefab-less CanvasWebViewPrefab or WebViewPrefab
            var go = new GameObject("EdgeBase_Turnstile");
            var webViewPrefab = go.AddComponent<Vuplex.WebView.CanvasWebViewPrefab>();
            await webViewPrefab.WaitUntilInitialized();

            var webView = webViewPrefab.WebView;

            // Start invisible (off-screen position)
            go.transform.position = new Vector3(9999, 9999, 9999);

            // Listen for JS messages via postMessage
            webView.MessageEmitted += (sender, e) =>
            {
                // e.Value is the JSON string from window.vuplex.postMessage()
                try
                {
                    var msg = JsonUtility.FromJson<VuplexMessage>(e.Value);
                    if (msg.type == "token" && !tcs.Task.IsCompleted)
                    {
                        tcs.TrySetResult(msg.value);
                        UnityEngine.Object.Destroy(go);
                    }
                    else if (msg.type == "error")
                    {
                        if (!tcs.Task.IsCompleted)
                            tcs.TrySetException(new Exception($"Turnstile error: {msg.value}"));
                        UnityEngine.Object.Destroy(go);
                    }
                    else if (msg.type == "interactive")
                    {
                        if (msg.value == "show")
                        {
                            go.transform.position = Vector3.zero; // Move to visible position
                        }
                        else if (msg.value == "hide")
                        {
                            go.transform.position = new Vector3(9999, 9999, 9999);
                        }
                    }
                }
                catch { /* ignore parse errors */ }
            };

            // Adapt HTML for Vuplex's JS bridge (window.vuplex.postMessage)
            string adaptedHtml = html
                .Replace(
                    "window.external.notify('token:'+t)",
                    "window.vuplex.postMessage(JSON.stringify({type:'token',value:t}))")
                .Replace(
                    "window.external.notify('error:'+e)",
                    "window.vuplex.postMessage(JSON.stringify({type:'error',value:String(e)}))")
                .Replace(
                    "window.external.notify('interactive:show')",
                    "window.vuplex.postMessage(JSON.stringify({type:'interactive',value:'show'}))")
                .Replace(
                    "window.external.notify('interactive:hide')",
                    "window.vuplex.postMessage(JSON.stringify({type:'interactive',value:'hide'}))")
                .Replace(
                    "window.external.notify('error:timeout')",
                    "window.vuplex.postMessage(JSON.stringify({type:'error',value:'timeout'}))");

            webView.LoadHtml(adaptedHtml);

            // Timeout
            _ = Task.Delay(30000).ContinueWith(_ =>
            {
                if (!tcs.Task.IsCompleted)
                {
                    tcs.TrySetException(new TimeoutException("Turnstile timeout"));
                    RunOnMainThread(() => UnityEngine.Object.Destroy(go));
                }
            });
        });

        return await tcs.Task;
    }

    [Serializable]
    private struct VuplexMessage
    {
        public string type;
        public string value;
    }

    private static Task RunOnMainThread(Action action)
    {
        var tcs = new TaskCompletionSource<bool>();
        UnityMainThreadDispatcher.Enqueue(() =>
        {
            try { action(); tcs.SetResult(true); }
            catch (Exception ex) { tcs.SetException(ex); }
        });
        return tcs.Task;
    }

    private static Task RunOnMainThread(Func<Task> action)
    {
        var tcs = new TaskCompletionSource<bool>();
        UnityMainThreadDispatcher.Enqueue(async () =>
        {
            try { await action(); tcs.SetResult(true); }
            catch (Exception ex) { tcs.SetException(ex); }
        });
        return tcs.Task;
    }
}
#endif

// ─── gree/unity-webview Adapter ─────────────────────────────────────────────
// https://github.com/gree/unity-webview — Popular free WebView plugin.
// Define UNITY_WEBVIEW_GREE in Player Settings > Scripting Define Symbols.

#if UNITY_WEBVIEW_GREE
public static class GreeWebViewAdapter
{
    public static async Task<string> AcquireTokenAsync(string siteKey, string action)
    {
        return await AcquireTokenAsync(siteKey, action, "interaction-only");
    }

    public static async Task<string> AcquirePreviewTokenAsync(string siteKey, string action, string appearance = "always")
    {
        return await AcquireTokenAsync(siteKey, action, appearance);
    }

    private static async Task<string> AcquireTokenAsync(string siteKey, string action, string appearance)
    {
        var tcs = new TaskCompletionSource<string>();
        string html = TurnstileProvider.GetTurnstileHtml(siteKey, action, appearance);
        var startVisible = string.Equals(appearance, "always", StringComparison.Ordinal);
        var useSeparateWindow =
#if UNITY_STANDALONE_OSX && !UNITY_EDITOR
            startVisible;
#else
            false;
#endif

        await RunOnMainThread(() =>
        {
            var go = new GameObject("EdgeBase_Turnstile");
            var webView = go.AddComponent<WebViewObject>();

            webView.Init(
                cb: (msg) =>
                {
                    // Messages arrive as "type:value" strings via Unity.call()
                    if (msg.StartsWith("token:") && !tcs.Task.IsCompleted)
                    {
                        tcs.TrySetResult(msg.Substring(6));
                        UnityEngine.Object.Destroy(go);
                    }
                    else if (msg.StartsWith("error:"))
                    {
                        if (!tcs.Task.IsCompleted)
                            tcs.TrySetException(new Exception($"Turnstile error: {msg.Substring(6)}"));
                        UnityEngine.Object.Destroy(go);
                    }
                    else if (msg == "interactive:show")
                    {
                        webView.SetVisibility(true);
                        webView.SetMargins(0, 0, 0, 0);
                    }
                    else if (msg == "interactive:hide" && !startVisible)
                    {
                        webView.SetVisibility(false);
                    }
                },
                transparent: true,
                enableWKWebView: true,
                separated: useSeparateWindow
            );

            webView.SetVisibility(startVisible);
            if (startVisible)
            {
                webView.SetMargins(0, 0, 0, 0);
            }

            // Adapt HTML for gree/unity-webview JS bridge (Unity.call)
            string adaptedHtml = html
                .Replace(
                    "window.external.notify('token:'+t)",
                    "Unity.call('token:'+t)")
                .Replace(
                    "window.external.notify('error:'+e)",
                    "Unity.call('error:'+String(e))")
                .Replace(
                    "window.external.notify('interactive:show')",
                    "Unity.call('interactive:show')")
                .Replace(
                    "window.external.notify('interactive:hide')",
                    "Unity.call('interactive:hide')")
                .Replace(
                    "window.external.notify('error:timeout')",
                    "Unity.call('error:timeout')");

            webView.LoadHTML(adaptedHtml, "https://challenges.cloudflare.com");

            // Timeout
            _ = Task.Delay(30000).ContinueWith(_ =>
            {
                if (!tcs.Task.IsCompleted)
                {
                    tcs.TrySetException(new TimeoutException("Turnstile timeout"));
                    RunOnMainThread(() => UnityEngine.Object.Destroy(go));
                }
            });
        });

        return await tcs.Task;
    }

    private static Task RunOnMainThread(Action action)
    {
        var tcs = new TaskCompletionSource<bool>();
        UnityMainThreadDispatcher.Enqueue(() =>
        {
            try { action(); tcs.SetResult(true); }
            catch (Exception ex) { tcs.SetException(ex); }
        });
        return tcs.Task;
    }
}
#endif

// ─── Main Thread Dispatcher ─────────────────────────────────────────────────
// Simple helper to dispatch work to Unity's main thread.
// Attach this MonoBehaviour to a persistent GameObject, or it auto-creates one.

public class UnityMainThreadDispatcher : MonoBehaviour
{
    private static UnityMainThreadDispatcher _instance;
    private static readonly System.Collections.Generic.Queue<Action> _queue =
        new System.Collections.Generic.Queue<Action>();

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
    private static void Initialize()
    {
        if (_instance != null) return;
        var go = new GameObject("EdgeBase_MainThreadDispatcher");
        DontDestroyOnLoad(go);
        _instance = go.AddComponent<UnityMainThreadDispatcher>();
    }

    public static void Enqueue(Action action)
    {
        lock (_queue) { _queue.Enqueue(action); }
    }

    private void Update()
    {
        lock (_queue)
        {
            while (_queue.Count > 0)
            {
                try { _queue.Dequeue()?.Invoke(); }
                catch (Exception e) { Debug.LogException(e); }
            }
        }
    }
}

}

#endif // UNITY_5_3_OR_NEWER
