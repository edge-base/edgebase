using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;

namespace EdgeBase
{

/// <summary>
/// Turnstile captcha provider for Unity.
/// Fetches siteKey from /api/config and auto-acquires token via WebView.
/// </summary>
public static class TurnstileProvider
{
    private static readonly Dictionary<string, string> _siteKeyCache = new();

    /// <summary>
    /// Resolve captcha token: use provided token or auto-acquire via Turnstile.
    /// </summary>
    /// <param name="baseUrl">Server base URL</param>
    /// <param name="action">Action name (signup, signin, anonymous, password-reset)</param>
    /// <param name="manualToken">Optional manual token override</param>
    /// <returns>Captcha token or null if not configured</returns>
    public static async Task<string?> ResolveCaptchaTokenAsync(
        string baseUrl, string action, string? manualToken = null)
    {
        if (!string.IsNullOrEmpty(manualToken)) return manualToken;

        var injectedToken = Environment.GetEnvironmentVariable("EDGEBASE_TEST_CAPTCHA_TOKEN");
        if (!string.IsNullOrEmpty(injectedToken))
        {
            return injectedToken;
        }

        var isTestRunner =
            !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("XUNIT_TEST_RUNNING")) ||
            !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("NUNIT_TEST_CONTEXT")) ||
            !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("DOTNET_TEST_CONTEXT")) ||
            AppDomain.CurrentDomain
                .GetAssemblies()
                .Any(a => a.GetName().Name?.Contains("testhost", StringComparison.OrdinalIgnoreCase) == true);
        var isMockHarness =
            string.Equals(Environment.GetEnvironmentVariable("TEST_MODE"), "mock", StringComparison.OrdinalIgnoreCase) &&
            (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("EDGEBASE_URL")) ||
             !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("MOCK_SERVER_URL")));

        if (isTestRunner || isMockHarness)
        {
            return "test-captcha-token";
        }

        if (Environment.GetEnvironmentVariable("EDGEBASE_DISABLE_AUTO_CAPTCHA") == "1")
        {
            return null;
        }

        var siteKey = await FetchSiteKeyAsync(baseUrl);
        if (siteKey == null) return null;

        try
        {
            return await AcquireTokenAsync(siteKey, action);
        }
        catch
        {
            return null; // Turnstile failed — let server handle (failMode)
        }
    }

    private static async Task<string?> FetchSiteKeyAsync(string baseUrl)
    {
        var normalizedBaseUrl = NormalizeBaseUrl(baseUrl);
        if (_siteKeyCache.TryGetValue(normalizedBaseUrl, out var cachedSiteKey))
        {
            return cachedSiteKey;
        }

        try
        {
            using var http = new JbHttpClient(normalizedBaseUrl);
            var payload = await http.GetAsync("/api/config");
            if (payload.TryGetValue("captcha", out var captchaValue) &&
                captchaValue is JsonElement captcha &&
                captcha.ValueKind == JsonValueKind.Object &&
                captcha.TryGetProperty("siteKey", out var siteKeyElement))
            {
                var siteKey = siteKeyElement.GetString();
                if (!string.IsNullOrEmpty(siteKey))
                {
                    _siteKeyCache[normalizedBaseUrl] = siteKey;
                }
                return siteKey;
            }
        }
        catch { /* ignore */ }
        return null;
    }

    private static string NormalizeBaseUrl(string baseUrl) => baseUrl.TrimEnd('/');

    private static async Task<string> AcquireTokenAsync(string siteKey, string action)
    {
        // Unity WebView integration point.
        // In Unity, this would use a WebView plugin to load Turnstile HTML.
        // The WebView renders Turnstile invisibly, captures token via JS bridge.
        //
        // For now, use a TaskCompletionSource pattern that WebView callbacks can complete.
        // Unity developers should call TurnstileProvider.SetWebViewFactory() to provide
        // their WebView implementation.

        if (_webViewFactory != null)
        {
            return await _webViewFactory(siteKey, action);
        }

        // Fallback: return null if no WebView factory configured
        throw new InvalidOperationException("No WebView factory configured for Turnstile");
    }

    // ── WebView Factory (pluggable for Unity) ──

    private static Func<string, string, Task<string>>? _webViewFactory;

    /// <summary>
    /// Whether a WebView factory has been configured (by adapter or manually).
    /// Used by TurnstileAdapters to avoid overriding a custom factory.
    /// </summary>
    public static bool HasWebViewFactory => _webViewFactory != null;

    /// <summary>
    /// Set the WebView factory for acquiring Turnstile tokens.
    /// Called once during app initialization.
    /// <para>The factory receives (siteKey, action) and returns a captcha token.</para>
    /// <para>Built-in adapters (UniWebView, Vuplex, gree) auto-register via TurnstileAdapters.
    /// Only call this manually if using an unsupported WebView plugin.</para>
    /// </summary>
    public static void SetWebViewFactory(Func<string, string, Task<string>> factory)
    {
        _webViewFactory = factory;
    }

    /// <summary>
    /// Generate the Turnstile HTML for loading in a WebView.
    /// The HTML communicates via window.external.notify() or a custom scheme.
    /// </summary>
    public static string GetTurnstileHtml(
        string siteKey, string action, string appearance = "interaction-only") =>
        "<!DOCTYPE html><html><head>" +
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
        "<script src=\"https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit\" async></script>" +
        "<style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:transparent}</style>" +
        "</head><body><div id=\"cf-turnstile\"></div><script>" +
        "function init(){if(window.turnstile){window.turnstile.render('#cf-turnstile',{" +
        $"sitekey:'{siteKey}',action:'{action}',appearance:'{appearance}'," +
        "callback:function(t){try{window.external.notify('token:'+t)}catch(e){window.location='edgebase://token/'+t}}," +
        "'error-callback':function(e){try{window.external.notify('error:'+e)}catch(ex){window.location='edgebase://error/'+e}}," +
        "'before-interactive-callback':function(){try{window.external.notify('interactive:show')}catch(e){window.location='edgebase://interactive/show'}}," +
        "'after-interactive-callback':function(){try{window.external.notify('interactive:hide')}catch(e){window.location='edgebase://interactive/hide'}}," +
        "'timeout-callback':function(){try{window.external.notify('error:timeout')}catch(e){window.location='edgebase://error/timeout'}}" +
        "})}else{setTimeout(init,50)}}init();" +
        "</script></body></html>";
}

}
