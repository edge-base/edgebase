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
// 2. Native and desktop adapters load the app-owned HTTPS challenge endpoint in
//    a persistent WebView and validate a per-request channel on every message.
// 3. WebGL renders the widget on the application's actual browser origin.
// 3. If no supported plugin is installed, falls back to TurnstileProvider.SetWebViewFactory().
//
// ─── Custom Plugin Support ──────────────────────────────────────────────────
//
// If your project uses a different WebView plugin, call SetWebViewFactory():
//
//   TurnstileProvider.SetWebViewFactory(async (challengeUrl, channel) => {
//       // Load challengeUrl, validate channel in the versioned JSON bridge.
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
            completion.TrySetException(new CaptchaUnavailableException(
                TurnstileProvider.NormalizeFailureReason(message.value)));
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
                completion.TrySetException(new CaptchaUnavailableException("timeout"));
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

    public static Task<string> AcquireTokenAsync(string challengeUrl, string channel)
    {
        return NativeTurnstileReceiver.RequestTokenAsync(challengeUrl, channel, TimeoutSeconds);
    }
}

internal sealed class NativeTurnstileReceiver : MonoBehaviour
{
#if UNITY_IOS
    [DllImport("__Internal")]
    private static extern void EB_Turnstile_RequestToken(
        [MarshalAs(UnmanagedType.LPUTF8Str)] string gameObjectName,
        [MarshalAs(UnmanagedType.LPUTF8Str)] string requestId,
        [MarshalAs(UnmanagedType.LPUTF8Str)] string challengeUrl,
        [MarshalAs(UnmanagedType.LPUTF8Str)] string channel);

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

    public static Task<string> RequestTokenAsync(
        string challengeUrl,
        string channel,
        float timeoutSeconds)
    {
        var instance = EnsureInstance();
        var requestId = Guid.NewGuid().ToString("N");
        var completion = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);

        lock (Sync)
        {
            Pending[requestId] = completion;
            Deadlines[requestId] = DateTime.UtcNow.AddSeconds(timeoutSeconds);
        }

        UnityMainThreadDispatcher.Enqueue(() => RequestNativeToken(
            instance.gameObject.name,
            requestId,
            challengeUrl,
            channel));
        return completion.Task;
    }

    public void OnEdgeBaseCaptchaTokenMessage(string json)
    {
        var message = JsonUtility.FromJson<BridgeMessage>(json);
        var requestId = message.requestId;
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
                completion.TrySetException(new CaptchaUnavailableException(
                    TurnstileProvider.NormalizeFailureReason(message.value)));
                ClearRequest(requestId);
                break;
            case "interactive":
            case "ready":
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

            completion?.TrySetException(new CaptchaUnavailableException("timeout"));
            CancelNativeToken(requestId);
            ClearRequest(requestId);
        }
    }

    private static void RequestNativeToken(
        string gameObjectName,
        string requestId,
        string challengeUrl,
        string channel)
    {
#if UNITY_ANDROID
        using var bridge = new AndroidJavaClass("dev.edgebase.unity.EdgeBaseTurnstileBridge");
        bridge.CallStatic("requestToken", gameObjectName, requestId, challengeUrl, channel);
#elif UNITY_IOS
        EB_Turnstile_RequestToken(gameObjectName, requestId, challengeUrl, channel);
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
    public static Task<string> AcquireTokenAsync(string challengeUrl, string channel)
    {
        return Task.FromException<string>(new CaptchaUnavailableException("unsupported_platform"));
    }
}
#endif

// ─── UniWebView Adapter ─────────────────────────────────────────────────────
// https://uniwebview.com — Most popular paid Unity WebView plugin.
// Define UNIWEBVIEW in Player Settings > Scripting Define Symbols.

#if UNIWEBVIEW
public static class UniWebViewAdapter
{
    public static async Task<string> AcquireTokenAsync(string challengeUrl, string channel)
    {
        var tcs = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        var hostedUrl = TurnstileProvider.WithChallengeBridge(challengeUrl, "uniwebview");

        await RunOnMainThread(() =>
        {
            var go = new GameObject("EdgeBase_Turnstile");
            var webView = go.AddComponent<UniWebView>();
            var finished = 0;

            Action cleanup = () =>
            {
                if (System.Threading.Interlocked.Exchange(ref finished, 1) != 0) return;
                if (webView != null) webView.Stop();
                if (go != null) UnityEngine.Object.Destroy(go);
            };

            webView.Frame = new Rect(0, 0, 1, 1);
            webView.SetShowSpinnerWhileLoading(false);
            webView.SetBackgroundColor(Color.clear);

            webView.OnMessageReceived += (view, message) =>
            {
                if (message.Path != "message" || !message.Args.ContainsKey("value")) return;
                var json = message.Args["value"];
                if (!TurnstileProvider.TryParseChallengeMessage(json, channel, out var type, out var value)) return;
                if (type == "token")
                {
                    if (tcs.TrySetResult(value)) cleanup();
                }
                else if (type == "error")
                {
                    if (tcs.TrySetException(new CaptchaUnavailableException(
                        TurnstileProvider.NormalizeFailureReason(value)))) cleanup();
                }
                else if (type == "interactive")
                {
                    if (value == "show")
                    {
                        webView.Frame = new Rect(0, 0, Screen.width, Screen.height);
                        webView.Show();
                    }
                    else
                    {
                        webView.Hide();
                    }
                }
            };

            webView.Load(hostedUrl);
            webView.Show(false);

            _ = Task.Delay(30000).ContinueWith(_ =>
            {
                if (tcs.TrySetException(new CaptchaUnavailableException("timeout")))
                {
                    RunOnMainThread(cleanup);
                }
            });
        });

        return await tcs.Task;
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
    public static async Task<string> AcquireTokenAsync(string challengeUrl, string channel)
    {
        var tcs = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        var hostedUrl = TurnstileProvider.WithChallengeBridge(challengeUrl, "vuplex");

        await RunOnMainThread(async () =>
        {
            var go = new GameObject("EdgeBase_Turnstile");
            var webViewPrefab = go.AddComponent<Vuplex.WebView.CanvasWebViewPrefab>();
            await webViewPrefab.WaitUntilInitialized();
            var webView = webViewPrefab.WebView;
            go.transform.position = new Vector3(9999, 9999, 9999);
            var finished = 0;
            Action cleanup = () =>
            {
                if (System.Threading.Interlocked.Exchange(ref finished, 1) != 0) return;
                if (go != null) UnityEngine.Object.Destroy(go);
            };

            webView.MessageEmitted += (sender, e) =>
            {
                if (!TurnstileProvider.TryParseChallengeMessage(e.Value, channel, out var type, out var value)) return;
                if (type == "token")
                {
                    if (tcs.TrySetResult(value)) cleanup();
                }
                else if (type == "error")
                {
                    if (tcs.TrySetException(new CaptchaUnavailableException(
                        TurnstileProvider.NormalizeFailureReason(value)))) cleanup();
                }
                else if (type == "interactive")
                {
                    go.transform.position = value == "show"
                        ? Vector3.zero
                        : new Vector3(9999, 9999, 9999);
                }
            };

            webView.LoadUrl(hostedUrl);

            _ = Task.Delay(30000).ContinueWith(_ =>
            {
                if (tcs.TrySetException(new CaptchaUnavailableException("timeout")))
                {
                    RunOnMainThread(cleanup);
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
    public static async Task<string> AcquireTokenAsync(string challengeUrl, string channel)
    {
        var tcs = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);

        await RunOnMainThread(() =>
        {
            var go = new GameObject("EdgeBase_Turnstile");
            var webView = go.AddComponent<WebViewObject>();
            var finished = 0;
            Action cleanup = () =>
            {
                if (System.Threading.Interlocked.Exchange(ref finished, 1) != 0) return;
                if (go != null) UnityEngine.Object.Destroy(go);
            };

            webView.Init(
                cb: (msg) =>
                {
                    if (!TurnstileProvider.TryParseChallengeMessage(msg, channel, out var type, out var value)) return;
                    if (type == "token")
                    {
                        if (tcs.TrySetResult(value)) cleanup();
                    }
                    else if (type == "error")
                    {
                        if (tcs.TrySetException(new CaptchaUnavailableException(
                            TurnstileProvider.NormalizeFailureReason(value)))) cleanup();
                    }
                    else if (type == "interactive" && value == "show")
                    {
                        webView.SetVisibility(true);
                        webView.SetMargins(0, 0, 0, 0);
                    }
                    else if (type == "interactive")
                    {
                        webView.SetVisibility(false);
                    }
                },
                transparent: true,
                enableWKWebView: true,
                separated: false
            );

            webView.SetVisibility(false);
            webView.LoadURL(challengeUrl);

            _ = Task.Delay(30000).ContinueWith(_ =>
            {
                if (tcs.TrySetException(new CaptchaUnavailableException("timeout")))
                {
                    RunOnMainThread(cleanup);
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
