using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using System.Collections.Concurrent;
using System.Threading;
using System.Threading.Tasks;

namespace EdgeBase
{

/// <summary>CAPTCHA is configured but the local runtime could not produce a token.</summary>
public sealed class CaptchaUnavailableException : Exception
{
    public const string ErrorCode = "captcha-unavailable";
    public string Code => ErrorCode;
    public string Reason { get; }

    public CaptchaUnavailableException(string reason, Exception? innerException = null)
        : base($"CAPTCHA unavailable: {reason}", innerException)
    {
        Reason = reason;
    }
}

/// <summary>
/// Turnstile captcha provider for Unity.
/// Fetches siteKey from /api/config and auto-acquires token via WebView.
/// </summary>
public static class TurnstileProvider
{
    private const long SiteKeyCacheTtlSeconds = 300;
    private static readonly ConcurrentDictionary<string, CachedSiteKey> _siteKeyCache = new();

    private sealed class CachedSiteKey
    {
        public CachedSiteKey(string value, long cachedAtTimestamp)
        {
            Value = value;
            CachedAtTimestamp = cachedAtTimestamp;
        }

        public string Value { get; }
        public long CachedAtTimestamp { get; }
    }

    private static bool IsSiteKeyCacheFresh(long cachedAtTimestamp, long nowTimestamp)
    {
        var age = nowTimestamp - cachedAtTimestamp;
        return age >= 0 && age < Stopwatch.Frequency * SiteKeyCacheTtlSeconds;
    }

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

#if UNITY_WEBGL && !UNITY_EDITOR
        return await AcquireDirectCaptchaWithSingleSiteKeyRetryAsync(
            siteKey,
            nextSiteKey => AcquireTypedTokenAsync(baseUrl, action, nextSiteKey),
            async () =>
            {
                _siteKeyCache.TryRemove(NormalizeBaseUrl(baseUrl), out _);
                return await FetchSiteKeyAsync(baseUrl);
            }
        );
#else
        return await AcquireTypedTokenAsync(baseUrl, action, siteKey);
#endif
    }

    private static async Task<string> AcquireTypedTokenAsync(
        string baseUrl,
        string action,
        string siteKey)
    {
        try
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            // WebGL executes on the application's real browser origin, so the
            // browser adapter uses the public site key directly.
            if (_webViewFactory == null)
                throw new InvalidOperationException("No WebView factory configured for Turnstile");
            return await _webViewFactory(siteKey, action);
#else
            return await AcquireTokenAsync(baseUrl, action);
#endif
        }
        catch (CaptchaUnavailableException)
        {
            throw;
        }
        catch (Exception error)
        {
            throw new CaptchaUnavailableException("acquisition_failed", error);
        }
    }

    private static bool ShouldRetryWithFreshSiteKey(string reason) =>
        string.Equals(reason, "challenge_error", StringComparison.Ordinal);

    private static async Task<string?> AcquireDirectCaptchaWithSingleSiteKeyRetryAsync(
        string initialSiteKey,
        Func<string, Task<string>> acquire,
        Func<Task<string?>> refreshSiteKey)
    {
        try
        {
            return await acquire(initialSiteKey);
        }
        catch (CaptchaUnavailableException error) when (ShouldRetryWithFreshSiteKey(error.Reason))
        {
            var refreshedSiteKey = await refreshSiteKey();
            if (refreshedSiteKey == null) return null;
            // Intentionally no recursive retry: the second failure is the
            // authoritative diagnostic exposed to the caller.
            return await acquire(refreshedSiteKey);
        }
    }

    private static async Task<string?> FetchSiteKeyAsync(string baseUrl)
    {
        var normalizedBaseUrl = NormalizeBaseUrl(baseUrl);
        if (_siteKeyCache.TryGetValue(normalizedBaseUrl, out var cachedSiteKey) &&
            IsSiteKeyCacheFresh(cachedSiteKey.CachedAtTimestamp, Stopwatch.GetTimestamp()))
        {
            return cachedSiteKey.Value;
        }

        try
        {
            using var http = new JbHttpClient(normalizedBaseUrl);
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            var payload = await http.GetAsync("/api/config", timeout.Token);
            if (!payload.TryGetValue("captcha", out var captchaValue))
                throw new CaptchaUnavailableException("config_invalid_response");
            if (captchaValue == null)
            {
                return null;
            }
            if (captchaValue is not JsonElement captcha)
                throw new CaptchaUnavailableException("config_invalid_response");
            if (captcha.ValueKind == JsonValueKind.Null)
                return null;
            if (captcha.ValueKind != JsonValueKind.Object)
                throw new CaptchaUnavailableException("config_invalid_response");
            if (!captcha.TryGetProperty("siteKey", out var siteKeyElement))
                throw new CaptchaUnavailableException("config_invalid_response");
            if (siteKeyElement.ValueKind != JsonValueKind.String)
                throw new CaptchaUnavailableException("config_invalid_response");

            var siteKey = siteKeyElement.GetString();
            if (string.IsNullOrWhiteSpace(siteKey) || siteKey.Length > 512)
                throw new CaptchaUnavailableException("config_invalid_response");
            _siteKeyCache[normalizedBaseUrl] = new CachedSiteKey(
                siteKey,
                Stopwatch.GetTimestamp()
            );
            return siteKey;
        }
        catch (CaptchaUnavailableException)
        {
            throw;
        }
        catch (JsonException error)
        {
            throw new CaptchaUnavailableException("config_invalid_response", error);
        }
        catch (Exception error)
        {
            throw new CaptchaUnavailableException("config_fetch_failed", error);
        }
    }

    private static string NormalizeBaseUrl(string baseUrl) => baseUrl.TrimEnd('/');

    private static async Task<string> AcquireTokenAsync(string baseUrl, string action)
    {
        if (_webViewFactory != null)
        {
            var randomBytes = new byte[16];
            try
            {
                using var random = RandomNumberGenerator.Create();
                random.GetBytes(randomBytes);
            }
            catch (Exception error)
            {
                throw new CaptchaUnavailableException("secure_random_unavailable", error);
            }
            var channel = BitConverter.ToString(randomBytes).Replace("-", "").ToLowerInvariant();
            return await _webViewFactory(BuildChallengeUrl(baseUrl, action, channel), channel);
        }

        throw new CaptchaUnavailableException("webview_adapter_unavailable");
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
    /// <para>Native/desktop factories receive (hostedChallengeUrl, channel). A WebGL
    /// build receives (siteKey, action), because it executes on the browser origin.</para>
    /// <para>Built-in adapters (UniWebView, Vuplex, gree) auto-register via TurnstileAdapters.
    /// Only call this manually if using an unsupported WebView plugin.</para>
    /// </summary>
    public static void SetWebViewFactory(Func<string, string, Task<string>> factory)
    {
        _webViewFactory = factory;
    }

    /// <summary>
    /// Build the registered EdgeBase HTTPS challenge URL for a native WebView.
    /// </summary>
    public static string BuildChallengeUrl(
        string baseUrl,
        string action,
        string channel,
        string bridge = "unity")
    {
        var allowedActions = new HashSet<string>(StringComparer.Ordinal) {
            "signup", "signin", "anonymous", "magic-link", "phone",
            "password-reset", "oauth", "function",
        };
        if (!Uri.TryCreate(NormalizeBaseUrl(baseUrl), UriKind.Absolute, out var uri) ||
            uri.Scheme != Uri.UriSchemeHttps || !string.IsNullOrEmpty(uri.UserInfo) ||
            uri.AbsolutePath != "/" || !string.IsNullOrEmpty(uri.Query) ||
            !string.IsNullOrEmpty(uri.Fragment) || !allowedActions.Contains(action) ||
            channel.Length < 22 || channel.Length > 64 ||
            channel.Any(ch => !(
                (ch >= 'a' && ch <= 'z') ||
                (ch >= 'A' && ch <= 'Z') ||
                (ch >= '0' && ch <= '9') || ch == '_' || ch == '-')) ||
            bridge is not ("unity" or "vuplex" or "uri" or "uniwebview"))
        {
            throw new ArgumentException("Turnstile requires an origin-only HTTPS EdgeBase URL, fixed action, and secure channel.");
        }
        return $"{uri.GetLeftPart(UriPartial.Authority)}/api/captcha/challenge" +
            $"?action={action}&channel={channel}&bridge={bridge}";
    }

    /// <summary>Switch a provider-generated URL to a supported SDK bridge.</summary>
    public static string WithChallengeBridge(string challengeUrl, string bridge)
    {
        const string defaultSuffix = "&bridge=unity";
        if (bridge is not ("unity" or "vuplex" or "uri" or "uniwebview") ||
            !challengeUrl.EndsWith(defaultSuffix, StringComparison.Ordinal) ||
            !Uri.TryCreate(challengeUrl, UriKind.Absolute, out var uri) ||
            uri.Scheme != Uri.UriSchemeHttps ||
            uri.AbsolutePath != "/api/captcha/challenge")
        {
            throw new ArgumentException("Invalid EdgeBase CAPTCHA challenge URL or bridge.");
        }
        return challengeUrl[..^defaultSuffix.Length] + "&bridge=" + bridge;
    }

    public static bool TryParseChallengeMessage(
        string json,
        string expectedChannel,
        out string type,
        out string value)
    {
        type = "";
        value = "";
        if (string.IsNullOrEmpty(json) || System.Text.Encoding.UTF8.GetByteCount(json) > 4096)
            return false;
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object ||
                !root.TryGetProperty("v", out var version) || version.GetInt32() != 1 ||
                !root.TryGetProperty("channel", out var channel) || channel.GetString() != expectedChannel ||
                !root.TryGetProperty("type", out var typeElement) ||
                !root.TryGetProperty("value", out var valueElement)) return false;
            type = typeElement.GetString() ?? "";
            value = valueElement.GetString() ?? "";
            if (type == "token") return value.Length is > 0 and <= 2048;
            if (type == "error") { value = value[..Math.Min(value.Length, 256)]; return true; }
            if (type == "interactive") return value is "show" or "hide";
            return type == "ready" && value.Length <= 32;
        }
        catch
        {
            type = "";
            value = "";
            return false;
        }
    }

    /// <summary>Normalize an untrusted bridge error into a bounded diagnostic reason.</summary>
    public static string NormalizeFailureReason(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return "challenge_error";
        var normalized = new string(value
            .ToLowerInvariant()
            .Select(ch => char.IsLetterOrDigit(ch) || ch is '_' or '-' ? ch : '_')
            .Take(128)
            .ToArray());
        return string.IsNullOrEmpty(normalized) ? "challenge_error" : $"challenge_{normalized}";
    }
}

}
