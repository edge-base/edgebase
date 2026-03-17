/**
 * Turnstile CAPTCHA widget for React Native — WebView based.
 *
 * Supports all platforms:
 * - iOS: WKWebView via react-native-webview
 * - Android: android.webkit.WebView via react-native-webview
 *   (uses window.ReactNativeWebView.postMessage instead of window.postMessage)
 * - Web (React Native Web): Falls back to direct script injection
 *
 * Usage:
 *   <TurnstileWebView
 *     siteKey="your-site-key"
 *     action="signup"
 *     onToken={(token) => handleToken(token)}
 *     onError={(err) => handleError(err)}
 *   />
 *
 * Or use the helper hook:
 *   const { token, isLoading, error, reset } = useTurnstile({ baseUrl, action });
 */

import React, { useRef, useState, useCallback, useEffect } from 'react';

// ─── Types (minimal RN typings to avoid hard dep on @types/react-native) ───

interface StyleProp {
    [key: string]: unknown;
}

interface WebViewMessage {
    nativeEvent: { data: string };
}

interface WebViewProps {
    source: { html: string };
    style?: StyleProp;
    onMessage: (event: WebViewMessage) => void;
    testID?: string;
    javaScriptEnabled?: boolean;
    originWhitelist?: string[];
    scrollEnabled?: boolean;
    showsHorizontalScrollIndicator?: boolean;
    showsVerticalScrollIndicator?: boolean;
}

// ─── Turnstile HTML template ───
// Uses window.ReactNativeWebView.postMessage for Android compatibility.
// Falls back to window.postMessage for web environments.

type TurnstileAppearance = 'always' | 'execute' | 'interaction-only';
type TurnstileSize = 'normal' | 'compact' | 'flexible';

function buildTurnstileHtml(
    siteKey: string,
    action: string,
    appearance: TurnstileAppearance,
    size: TurnstileSize,
): string {
    return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="script-src 'unsafe-inline' https://challenges.cloudflare.com; style-src 'unsafe-inline';">
<style>
  html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
  #container { display: flex; align-items: center; justify-content: center; min-height: 65px; }
</style>
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" async defer></script>
<script>
  function sendToNative(data) {
    try {
      // Android/iOS via react-native-webview
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(data));
        return;
      }
      // React Native Web / fallback
      window.postMessage(JSON.stringify(data), '*');
    } catch(e) {}
  }

  function onTurnstileLoad() {
    turnstile.render('#container', {
      sitekey: ${JSON.stringify(siteKey)},
      action: ${JSON.stringify(action)},
      appearance: ${JSON.stringify(appearance)},
      size: ${JSON.stringify(size)},
      callback: function(token) {
        sendToNative({ type: 'captcha-token', token: token });
      },
      'error-callback': function(error) {
        sendToNative({ type: 'captcha-error', error: String(error) });
      },
      'before-interactive-callback': function() {
        sendToNative({ type: 'captcha-interactive' });
      },
      'after-interactive-callback': function() {
        sendToNative({ type: 'captcha-done' });
      },
      'timeout-callback': function() {
        sendToNative({ type: 'captcha-error', error: 'timeout' });
      }
    });
  }

  // Wait for Turnstile script to load
  var checkInterval = setInterval(function() {
    if (window.turnstile) {
      clearInterval(checkInterval);
      onTurnstileLoad();
    }
  }, 100);

  // Safety timeout — give up after 15 seconds
  setTimeout(function() {
    clearInterval(checkInterval);
    if (!window.turnstile) {
      sendToNative({ type: 'captcha-error', error: 'script_load_failed' });
    }
  }, 15000);
</script>
</head>
<body><div id="container"></div></body>
</html>`;
}

// ─── TurnstileWebView component ───

export interface TurnstileWebViewProps {
    siteKey: string;
    action?: string;
    /** Called when Turnstile successfully issues a token */
    onToken: (token: string) => void;
    /** Called when Turnstile fails or times out */
    onError?: (error: string) => void;
    /** Called when an interactive challenge appears (show the WebView) */
    onInteractive?: () => void;
    /** Turnstile appearance mode */
    appearance?: TurnstileAppearance;
    /** Turnstile widget size */
    size?: TurnstileSize;
    /** Test identifier forwarded to the underlying WebView shell */
    testID?: string;
    /** Style for the WebView container */
    style?: StyleProp;
    /** WebView component — inject from react-native-webview */
    WebViewComponent: React.ComponentType<WebViewProps>;
}

export function TurnstileWebView({
    siteKey,
    action = 'auth',
    onToken,
    onError,
    onInteractive,
    appearance = 'interaction-only',
    size = 'normal',
    testID,
    style,
    WebViewComponent,
}: TurnstileWebViewProps): React.ReactElement {
    const html = buildTurnstileHtml(siteKey, action, appearance, size);

    const handleMessage = useCallback(
        (event: WebViewMessage) => {
            try {
                // React Native WebView may double-stringify on some versions
                let raw = event.nativeEvent.data;
                if (typeof raw !== 'string') raw = JSON.stringify(raw);
                const msg = JSON.parse(raw) as { type: string; token?: string; error?: string };

                switch (msg.type) {
                    case 'captcha-token':
                        if (msg.token) onToken(msg.token);
                        break;
                    case 'captcha-error':
                        onError?.(msg.error ?? 'unknown');
                        break;
                    case 'captcha-interactive':
                        onInteractive?.();
                        break;
                    default:
                        break;
                }
            } catch {
                // Ignore non-JSON messages (e.g. React DevTools)
            }
        },
        [onToken, onError, onInteractive],
    );

    return React.createElement(WebViewComponent, {
        source: { html },
        style: style ?? { width: 300, height: 65, backgroundColor: 'transparent' },
        onMessage: handleMessage,
        testID,
        javaScriptEnabled: true,
        originWhitelist: ['*'],
        scrollEnabled: false,
        showsHorizontalScrollIndicator: false,
        showsVerticalScrollIndicator: false,
    });
}

// ─── useTurnstile hook ───

export interface UseTurnstileOptions {
    baseUrl: string;
    action?: string;
    /** Inject WebView component — pass require('react-native-webview').WebView */
    WebViewComponent?: React.ComponentType<WebViewProps>;
}

export interface UseTurnstileResult {
    /** Current captcha token (null until resolved) */
    token: string | null;
    /** True while waiting for Turnstile to issue a token */
    isLoading: boolean;
    /** Error message if Turnstile failed */
    error: string | null;
    /** True if interactive challenge is needed (show the WebView) */
    needsInteraction: boolean;
    /** The siteKey fetched from server (null if captcha not configured) */
    siteKey: string | null;
    /** Reset state — useful to retry after error */
    reset: () => void;
    /** Manually set the token (for manual override flow) */
    setToken: (token: string) => void;
    /** Pass to TurnstileWebView.onToken for stateful integration */
    onToken: (token: string) => void;
    /** Pass to TurnstileWebView.onError for stateful integration */
    onError: (error: string) => void;
    /** Pass to TurnstileWebView.onInteractive for stateful integration */
    onInteractive: () => void;
}

// Cache site keys per backend URL so separate dev servers do not share stale config.
const cachedSiteKeys = new Map<string, string | null>();
const siteKeyFetchPromises = new Map<string, Promise<string | null>>();

async function fetchSiteKey(baseUrl: string): Promise<string | null> {
    if (cachedSiteKeys.has(baseUrl)) return cachedSiteKeys.get(baseUrl) ?? null;

    const inflight = siteKeyFetchPromises.get(baseUrl);
    if (inflight) return inflight;

    const nextPromise = (async () => {
        try {
            const res = await fetch(`${baseUrl}/api/config`);
            if (!res.ok) return null;
            const data = (await res.json()) as { captcha?: { siteKey?: string } | null };
            const nextKey = data.captcha?.siteKey ?? null;
            cachedSiteKeys.set(baseUrl, nextKey);
            return nextKey;
        } catch {
            return null;
        } finally {
            siteKeyFetchPromises.delete(baseUrl);
        }
    })();

    siteKeyFetchPromises.set(baseUrl, nextPromise);
    return nextPromise;
}

export function useTurnstile({
    baseUrl,
    action = 'auth',
}: UseTurnstileOptions): UseTurnstileResult {
    const [token, setTokenState] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [needsInteraction, setNeedsInteraction] = useState(false);
    const [siteKey, setSiteKey] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setIsLoading(true);
        fetchSiteKey(baseUrl).then((key) => {
            if (!cancelled) {
                setSiteKey(key);
                if (!key) setIsLoading(false); // No captcha configured — done immediately
            }
        });
        return () => { cancelled = true; };
    }, [baseUrl]);

    const reset = useCallback(() => {
        setTokenState(null);
        setError(null);
        setNeedsInteraction(false);
        setIsLoading(true);
    }, []);

    const handleToken = useCallback((t: string) => {
        setTokenState(t);
        setIsLoading(false);
        setError(null);
        setNeedsInteraction(false);
    }, []);

    const handleError = useCallback((e: string) => {
        setError(e);
        setIsLoading(false);
    }, []);

    const handleInteractive = useCallback(() => {
        setNeedsInteraction(true);
    }, []);

    const setToken = useCallback((t: string) => {
        setTokenState(t);
        setIsLoading(false);
    }, []);

    return {
        token,
        isLoading,
        error,
        needsInteraction,
        siteKey,
        reset,
        setToken,
        onToken: handleToken,
        onError: handleError,
        onInteractive: handleInteractive,
    };
}

// ─── Platform detection helper ───

/**
 * Detect if we're running on React Native Web (browser) vs native.
 * Used internally to skip WebView when running on web platform.
 */
export function isPlatformWeb(): boolean {
    return typeof document !== 'undefined' && typeof navigator !== 'undefined'
        && !('ReactNativeWebView' in window);
}
