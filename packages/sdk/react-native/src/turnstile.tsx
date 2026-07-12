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
 *     baseUrl="https://api.example.com"
 *     action="signup"
 *     onToken={(token) => handleToken(token)}
 *     onError={(err) => handleError(err)}
 *   />
 *
 * Or use the helper hook:
 *   const { token, isLoading, error, reset } = useTurnstile({ baseUrl, action });
 */

import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import type { SecureRandomProvider } from './token-manager.js';

// ─── Types (minimal RN typings to avoid hard dep on @types/react-native) ───

interface StyleProp {
    [key: string]: unknown;
}

interface WebViewMessage {
    nativeEvent: { data: string };
}

interface WebViewNavigationRequest {
    url: string;
    isTopFrame?: boolean;
    mainDocumentURL?: string;
}

interface WebViewLoadError {
    nativeEvent?: { description?: string; statusCode?: number };
}

interface WebViewProps {
    source: { uri: string };
    style?: StyleProp;
    onMessage: (event: WebViewMessage) => void;
    testID?: string;
    javaScriptEnabled?: boolean;
    domStorageEnabled?: boolean;
    sharedCookiesEnabled?: boolean;
    thirdPartyCookiesEnabled?: boolean;
    applicationNameForUserAgent?: string;
    originWhitelist?: string[];
    onShouldStartLoadWithRequest?: (request: WebViewNavigationRequest) => boolean;
    onNavigationStateChange?: (state: { url: string }) => void;
    onError?: (event: WebViewLoadError) => void;
    onHttpError?: (event: WebViewLoadError) => void;
    onRenderProcessGone?: () => void;
    onContentProcessDidTerminate?: () => void;
    scrollEnabled?: boolean;
    showsHorizontalScrollIndicator?: boolean;
    showsVerticalScrollIndicator?: boolean;
}

type TurnstileAppearance = 'always' | 'execute' | 'interaction-only';
type TurnstileSize = 'normal' | 'compact' | 'flexible';
type TurnstileAction =
    | 'signup'
    | 'signin'
    | 'anonymous'
    | 'magic-link'
    | 'phone'
    | 'password-reset'
    | 'oauth'
    | 'function';

export type TurnstileErrorReason =
    | 'config_fetch_failed'
    | 'config_invalid_response';

/** A terminal native CAPTCHA configuration failure with a stable reason. */
export class TurnstileError extends Error {
    readonly reason: TurnstileErrorReason;

    constructor(reason: TurnstileErrorReason, message: string, options?: { cause?: unknown }) {
        super(message, options);
        this.name = 'TurnstileError';
        this.reason = reason;
    }
}

export interface TurnstileSecureCrypto {
    getRandomValues: (bytes: Uint8Array) => Uint8Array;
}

export type TurnstileGetRandomValues = (bytes: Uint8Array) => Uint8Array;

function normalizeCaptchaOrigin(baseUrl: string): string {
    let parsed: URL;
    try {
        parsed = new URL(baseUrl);
    } catch {
        throw new Error('TurnstileWebView baseUrl must be an absolute HTTP(S) origin.');
    }
    if (parsed.username || parsed.password || (parsed.pathname !== '' && parsed.pathname !== '/') || parsed.search || parsed.hash) {
        throw new Error('TurnstileWebView baseUrl must contain only an HTTP(S) origin.');
    }
    const loopback = parsed.hostname === 'localhost'
        || parsed.hostname === '127.0.0.1'
        || parsed.hostname === '[::1]';
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
        throw new Error('TurnstileWebView requires HTTPS (HTTP is allowed only for local loopback development).');
    }
    return parsed.origin;
}

function generateChallengeChannel(
    injected?: TurnstileGetRandomValues,
    secureCrypto?: TurnstileSecureCrypto,
): string {
    const random = injected
        ?? secureCrypto?.getRandomValues.bind(secureCrypto)
        ?? globalThis.crypto?.getRandomValues?.bind(globalThis.crypto);
    if (!random) {
        throw new Error('Secure random generation is required for TurnstileWebView.');
    }
    const bytes = new Uint8Array(32);
    const returned = random(bytes);
    if (!(returned instanceof Uint8Array) || returned.byteLength !== 32) {
        throw new Error('Secure random generation returned an invalid Turnstile channel.');
    }
    return Array.from(returned, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function resolveChallengeChannel(
    injected?: TurnstileGetRandomValues,
    secureCrypto?: TurnstileSecureCrypto,
    secureRandom?: SecureRandomProvider,
): Promise<string> {
    if (injected || secureCrypto) {
        return generateChallengeChannel(injected, secureCrypto);
    }
    if (secureRandom) {
        const bytes = await secureRandom(32);
        if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 32) {
            throw new Error('secureRandom must return exactly 32 bytes for a Turnstile channel.');
        }
        return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    }
    return generateChallengeChannel();
}

function buildChallengeUrl(
    baseUrl: string,
    action: string,
    appearance: TurnstileAppearance,
    size: TurnstileSize,
    channel: string,
): { origin: string; url: string } {
    const origin = normalizeCaptchaOrigin(baseUrl);
    const url = new URL('/api/captcha/challenge', origin);
    url.searchParams.set('action', action);
    url.searchParams.set('channel', channel);
    url.searchParams.set('bridge', 'rn');
    url.searchParams.set('appearance', appearance);
    url.searchParams.set('size', size);
    return { origin, url: url.toString() };
}

interface ChallengeBridgeMessage {
    type: 'token' | 'error' | 'interactive' | 'ready';
    value: string;
}

interface ChallengeTerminalState {
    channel: string;
    done: boolean;
}

type ChallengeDispatch =
    | { type: 'token'; value: string }
    | { type: 'error'; value: string }
    | { type: 'interactive'; value: 'show' };

function utf8Length(value: string): number {
    let length = 0;
    for (const character of value) {
        const codePoint = character.codePointAt(0) ?? 0;
        length += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
        if (length > 4096) return length;
    }
    return length;
}

function parseChallengeMessage(raw: string, channel: string): ChallengeBridgeMessage | null {
    try {
        if (utf8Length(raw) > 4096) return null;
        let parsed: unknown = JSON.parse(raw);
        if (typeof parsed === 'string') parsed = JSON.parse(parsed);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        const message = parsed as Record<string, unknown>;
        if (
            message.v !== 1
            || message.channel !== channel
            || !['token', 'error', 'interactive', 'ready'].includes(String(message.type))
        ) return null;
        const value = typeof message.value === 'string' ? message.value : '';
        if (message.type === 'token' && (value.length === 0 || value.length > 2048)) return null;
        if (message.type === 'ready' && value !== 'ready') return null;
        if (message.type === 'interactive' && value !== 'show' && value !== 'hide') return null;
        return {
            type: message.type as ChallengeBridgeMessage['type'],
            value: message.type === 'error' ? value.slice(0, 256) : value,
        };
    } catch {
        return null;
    }
}

function dispatchChallengeMessage(
    state: ChallengeTerminalState,
    channel: string,
    message: ChallengeBridgeMessage | null,
): ChallengeDispatch | null {
    if (!message || state.channel !== channel || state.done) return null;
    if (message.type === 'token') {
        state.done = true;
        return { type: 'token', value: message.value };
    }
    if (message.type === 'error') {
        state.done = true;
        return { type: 'error', value: message.value.slice(0, 256) || 'unknown' };
    }
    if (message.type === 'interactive' && message.value === 'show') {
        return { type: 'interactive', value: 'show' };
    }
    return null;
}

function parseChallengeMessageUrl(url: string, channel: string): ChallengeBridgeMessage | null {
    const prefix = 'edgebase://message/';
    if (!url.startsWith(prefix)) return null;
    try {
        return parseChallengeMessage(decodeURIComponent(url.slice(prefix.length)), channel);
    } catch {
        return null;
    }
}

function shouldAllowChallengeNavigation(
    request: WebViewNavigationRequest,
    challenge: { origin: string; url: string },
): boolean {
    let target: URL;
    try {
        target = new URL(request.url);
    } catch {
        return false;
    }
    if (target.toString() === challenge.url) return request.isTopFrame !== false;
    if (target.origin !== 'https://challenges.cloudflare.com') return false;

    // Cloudflare challenge frames are allowed only as descendants of the
    // fixed EdgeBase challenge document; they may never replace the main frame.
    if (request.isTopFrame === false) {
        if (!request.mainDocumentURL) return true;
        try {
            return new URL(request.mainDocumentURL).toString() === challenge.url;
        } catch {
            return false;
        }
    }
    return false;
}

function baseWebViewProps(
    challenge: { origin: string; url: string },
    channel: string,
): Pick<
    WebViewProps,
    | 'source'
    | 'javaScriptEnabled'
    | 'domStorageEnabled'
    | 'sharedCookiesEnabled'
    | 'thirdPartyCookiesEnabled'
    | 'applicationNameForUserAgent'
    | 'originWhitelist'
    | 'scrollEnabled'
    | 'showsHorizontalScrollIndicator'
    | 'showsVerticalScrollIndicator'
> & { key: string } {
    return {
        key: `edgebase-captcha-${channel}`,
        source: { uri: challenge.url },
        javaScriptEnabled: true,
        domStorageEnabled: true,
        sharedCookiesEnabled: true,
        thirdPartyCookiesEnabled: true,
        applicationNameForUserAgent: 'EdgeBaseReactNativeCaptcha/1.0',
        originWhitelist: [challenge.origin, 'https://challenges.cloudflare.com', 'edgebase://message/*'],
        scrollEnabled: false,
        showsHorizontalScrollIndicator: false,
        showsVerticalScrollIndicator: false,
    };
}

/** @internal Native challenge protocol helpers used by regression tests. */
export const _turnstileTest = {
    normalizeCaptchaOrigin,
    generateChallengeChannel,
    buildChallengeUrl,
    parseChallengeMessage,
    parseChallengeMessageUrl,
    dispatchChallengeMessage,
    shouldAllowChallengeNavigation,
    baseWebViewProps,
    resolveChallengeChannel,
    createTurnstileWebViewElement,
    fetchSiteKey,
    resetSiteKeyCache: (baseUrl?: string) => {
        if (baseUrl) invalidateSiteKeyCache(baseUrl);
        else cachedSiteKeys.clear();
    },
};

// ─── TurnstileWebView component ───

export interface TurnstileWebViewProps {
    /** EdgeBase server origin hosting the bound CAPTCHA challenge page. */
    baseUrl: string;
    action?: TurnstileAction;
    /** Called when Turnstile successfully issues a token */
    onToken: (token: string) => void;
    /** Called when Turnstile fails or times out */
    onError?: (error: string) => void;
    /** Called when an interactive challenge appears (show the WebView) */
    onInteractive?: () => void;
    /** Explicit CSPRNG provider for Hermes/runtime environments without global crypto. */
    secureCrypto?: TurnstileSecureCrypto;
    /** Direct CSPRNG injection; takes precedence over secureCrypto/global crypto. */
    getRandomValues?: TurnstileGetRandomValues;
    /** Pre-generated channel used by useTurnstile for async secureRandom providers. */
    challengeChannel?: string;
    /** Changing this value creates a new channel and remounts the WebView. */
    resetKey?: number;
    /** Terminal challenge timeout (default 30 seconds). */
    timeoutMs?: number;
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
    baseUrl,
    action = 'signin',
    onToken,
    onError,
    onInteractive,
    secureCrypto,
    getRandomValues,
    challengeChannel,
    resetKey = 0,
    timeoutMs = 30_000,
    appearance = 'interaction-only',
    size = 'normal',
    testID,
    style,
    WebViewComponent,
}: TurnstileWebViewProps): React.ReactElement {
    const channel = useMemo(
        () => {
            if (challengeChannel) {
                if (!/^[0-9a-f]{64}$/.test(challengeChannel)) {
                    throw new Error('TurnstileWebView challengeChannel must be 32-byte lowercase hexadecimal.');
                }
                return challengeChannel;
            }
            return generateChallengeChannel(getRandomValues, secureCrypto);
        },
        [baseUrl, action, appearance, size, resetKey, getRandomValues, secureCrypto, challengeChannel],
    );
    const challenge = useMemo(
        () => buildChallengeUrl(baseUrl, action, appearance, size, channel),
        [baseUrl, action, appearance, size, channel],
    );
    const terminalRef = useRef<ChallengeTerminalState>({ channel, done: false });
    if (terminalRef.current.channel !== channel) {
        terminalRef.current = { channel, done: false };
    }
    const onTokenRef = useRef(onToken);
    const onErrorRef = useRef(onError);
    const onInteractiveRef = useRef(onInteractive);
    onTokenRef.current = onToken;
    onErrorRef.current = onError;
    onInteractiveRef.current = onInteractive;

    const finishError = useCallback((error: string) => {
        const dispatched = dispatchChallengeMessage(terminalRef.current, channel, {
            type: 'error',
            value: error,
        });
        if (dispatched?.type === 'error') onErrorRef.current?.(dispatched.value);
    }, [channel]);

    const handleProtocolMessage = useCallback((message: ChallengeBridgeMessage | null) => {
        const dispatched = dispatchChallengeMessage(terminalRef.current, channel, message);
        if (dispatched?.type === 'token') {
            onTokenRef.current(dispatched.value);
        } else if (dispatched?.type === 'error') {
            onErrorRef.current?.(dispatched.value);
        } else if (dispatched?.type === 'interactive') {
            onInteractiveRef.current?.();
        }
    }, [channel]);

    useEffect(() => {
        if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
            finishError('invalid_timeout');
            return undefined;
        }
        const timer = setTimeout(() => finishError('timeout'), timeoutMs);
        return () => clearTimeout(timer);
    }, [channel, timeoutMs, finishError]);

    const handleMessage = useCallback(
        (event: WebViewMessage) => {
            handleProtocolMessage(parseChallengeMessage(event.nativeEvent.data, channel));
        },
        [channel, handleProtocolMessage],
    );

    const handleNavigation = useCallback((request: WebViewNavigationRequest): boolean => {
        const fallback = parseChallengeMessageUrl(request.url, channel);
        if (fallback) {
            handleProtocolMessage(fallback);
            return false;
        }
        return shouldAllowChallengeNavigation(request, challenge);
    }, [challenge, channel, handleProtocolMessage]);

    const handleNavigationState = useCallback(({ url }: { url: string }) => {
        handleProtocolMessage(parseChallengeMessageUrl(url, channel));
    }, [channel, handleProtocolMessage]);

    return React.createElement(WebViewComponent, {
        ...baseWebViewProps(challenge, channel),
        style: style ?? { width: 300, height: 65, backgroundColor: 'transparent' },
        onMessage: handleMessage,
        testID,
        onShouldStartLoadWithRequest: handleNavigation,
        onNavigationStateChange: handleNavigationState,
        onError: (event) => finishError(event.nativeEvent?.description ?? 'page_load_failed'),
        onHttpError: (event) => finishError(`http_${event.nativeEvent?.statusCode ?? 'error'}`),
        onRenderProcessGone: () => finishError('render_process_gone'),
        onContentProcessDidTerminate: () => finishError('content_process_terminated'),
    });
}

function createTurnstileWebViewElement(props: TurnstileWebViewProps): React.ReactElement {
    return React.createElement(TurnstileWebView, props);
}

// ─── useTurnstile hook ───

export interface UseTurnstileOptions {
    baseUrl: string;
    action?: TurnstileAction;
    secureCrypto?: TurnstileSecureCrypto;
    getRandomValues?: TurnstileGetRandomValues;
    /** Async/sync CSPRNG supplied through createClient({ secureRandom }). */
    secureRandom?: SecureRandomProvider;
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
    /** Pass to TurnstileWebView.resetKey so reset remounts the challenge. */
    resetKey: number;
    /** Manually set the token (for manual override flow) */
    setToken: (token: string) => void;
    /** Pass to TurnstileWebView.onToken for stateful integration */
    onToken: (token: string) => void;
    /** Pass to TurnstileWebView.onError for stateful integration */
    onError: (error: string) => void;
    /** Pass to TurnstileWebView.onInteractive for stateful integration */
    onInteractive: () => void;
    /** Ready-to-mount hosted challenge when WebViewComponent was supplied. */
    webView: React.ReactElement | null;
}

// Cache site keys per backend URL so separate dev servers do not share stale config.
const SITE_KEY_CACHE_TTL_MS = 5 * 60 * 1000;
const cachedSiteKeys = new Map<string, { value: string; expiresAt: number }>();
const siteKeyFetchPromises = new Map<string, Promise<string | null>>();

async function fetchSiteKey(baseUrl: string): Promise<string | null> {
    const origin = normalizeCaptchaOrigin(baseUrl);
    const cached = cachedSiteKeys.get(origin);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (cached) cachedSiteKeys.delete(origin);

    const inflight = siteKeyFetchPromises.get(origin);
    if (inflight) return inflight;

    const nextPromise = (async () => {
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const timeoutPromise = new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => {
                controller?.abort();
                reject(new TurnstileError(
                    'config_fetch_failed',
                    'Turnstile config request timed out.',
                ));
            }, 10_000);
        });
        try {
            let res: Response;
            try {
                res = await Promise.race([
                    fetch(`${origin}/api/config`, controller ? { signal: controller.signal } : undefined),
                    timeoutPromise,
                ]);
            } catch (cause) {
                if (cause instanceof TurnstileError) throw cause;
                throw new TurnstileError(
                    'config_fetch_failed',
                    'Failed to fetch CAPTCHA configuration.',
                    { cause },
                );
            }

            if (!res.ok) {
                throw new TurnstileError(
                    'config_fetch_failed',
                    `CAPTCHA configuration request failed with HTTP ${res.status}.`,
                );
            }

            let data: unknown;
            try {
                data = await Promise.race([res.json(), timeoutPromise]);
            } catch (cause) {
                if (cause instanceof TurnstileError) throw cause;
                if (controller?.signal.aborted) {
                    throw new TurnstileError(
                        'config_fetch_failed',
                        'Turnstile config request timed out.',
                        { cause },
                    );
                }
                throw new TurnstileError(
                    'config_invalid_response',
                    'CAPTCHA configuration returned malformed JSON.',
                    { cause },
                );
            }

            if (!data || typeof data !== 'object' || Array.isArray(data)) {
                throw new TurnstileError(
                    'config_invalid_response',
                    'CAPTCHA configuration response must be an object.',
                );
            }
            if (!Object.prototype.hasOwnProperty.call(data, 'captcha')) {
                throw new TurnstileError(
                    'config_invalid_response',
                    'CAPTCHA configuration response is missing captcha.',
                );
            }

            const captcha = (data as { captcha?: unknown }).captcha;
            if (captcha === null) return null;
            if (!captcha || typeof captcha !== 'object' || Array.isArray(captcha)) {
                throw new TurnstileError(
                    'config_invalid_response',
                    'CAPTCHA configuration must be null or an object.',
                );
            }

            const rawSiteKey = (captcha as { siteKey?: unknown }).siteKey;
            const nextKey = typeof rawSiteKey === 'string' ? rawSiteKey.trim() : '';
            if (!nextKey || nextKey.length > 256 || !/^[A-Za-z0-9_-]+$/.test(nextKey)) {
                throw new TurnstileError(
                    'config_invalid_response',
                    'CAPTCHA configuration contains an invalid siteKey.',
                );
            }
            cachedSiteKeys.set(origin, {
                value: nextKey,
                expiresAt: Date.now() + SITE_KEY_CACHE_TTL_MS,
            });
            return nextKey;
        } finally {
            if (timeout !== undefined) clearTimeout(timeout);
        }
    })().finally(() => {
        siteKeyFetchPromises.delete(origin);
    });

    siteKeyFetchPromises.set(origin, nextPromise);
    return nextPromise;
}

/** Clear cached native CAPTCHA config after a protected endpoint reports a stale token/key. */
export function invalidateSiteKeyCache(baseUrl: string): void {
    const origin = normalizeCaptchaOrigin(baseUrl);
    cachedSiteKeys.delete(origin);
    siteKeyFetchPromises.delete(origin);
}

export function useTurnstile({
    baseUrl,
    action = 'signin',
    secureCrypto,
    getRandomValues,
    secureRandom,
    WebViewComponent,
}: UseTurnstileOptions): UseTurnstileResult {
    const [token, setTokenState] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [needsInteraction, setNeedsInteraction] = useState(false);
    const [siteKey, setSiteKey] = useState<string | null>(null);
    const [resetKey, setResetKey] = useState(0);
    const [challengeChannel, setChallengeChannel] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setIsLoading(true);
        setError(null);
        fetchSiteKey(baseUrl).then((key) => {
            if (!cancelled) {
                setSiteKey(key);
                if (!key) setIsLoading(false); // No captcha configured — done immediately
            }
        }).catch((cause) => {
            if (!cancelled) {
                setSiteKey(null);
                setError(cause instanceof Error ? cause.message : String(cause));
                setIsLoading(false);
            }
        });
        return () => { cancelled = true; };
    }, [baseUrl, resetKey]);

    useEffect(() => {
        let cancelled = false;
        if (!WebViewComponent || !siteKey) {
            setChallengeChannel(null);
            return () => { cancelled = true; };
        }
        setChallengeChannel(null);
        resolveChallengeChannel(getRandomValues, secureCrypto, secureRandom)
            .then((channel) => {
                if (!cancelled) setChallengeChannel(channel);
            })
            .catch((cause) => {
                if (cancelled) return;
                setError(cause instanceof Error ? cause.message : String(cause));
                setIsLoading(false);
            });
        return () => { cancelled = true; };
    }, [WebViewComponent, siteKey, getRandomValues, secureCrypto, secureRandom, resetKey]);

    const reset = useCallback(() => {
        setTokenState(null);
        setError(null);
        setNeedsInteraction(false);
        setIsLoading(siteKey !== null);
        setResetKey((value) => value + 1);
    }, [siteKey]);

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

    const webView = useMemo(() => {
        if (!siteKey || !WebViewComponent || !challengeChannel) return null;
        return createTurnstileWebViewElement({
            baseUrl,
            action,
            secureCrypto,
            getRandomValues,
            challengeChannel,
            resetKey,
            WebViewComponent,
            onToken: handleToken,
            onError: handleError,
            onInteractive: handleInteractive,
        });
    }, [
        siteKey,
        WebViewComponent,
        challengeChannel,
        baseUrl,
        action,
        secureCrypto,
        getRandomValues,
        resetKey,
        handleToken,
        handleError,
        handleInteractive,
    ]);

    return {
        token,
        isLoading,
        error,
        needsInteraction,
        siteKey,
        reset,
        resetKey,
        setToken,
        onToken: handleToken,
        onError: handleError,
        onInteractive: handleInteractive,
        webView,
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
