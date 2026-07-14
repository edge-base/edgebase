/**
 * @edge-base/web — 단위 테스트
 *
 * 테스트 대상: src/token-manager.ts (TokenManager), src/match-filter.ts
 *
 * 실행: cd packages/sdk/js/packages/web && npx vitest run
 *
 * 원칙: 서버 불필요 — 순수 로직 (JWT decode, storage, auth state) 검증
 */

import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { TokenManager } from '../../src/token-manager.js';
import {
  fetchSiteKey,
  getCaptchaToken,
  resolveCaptchaToken,
  TurnstileError,
} from '../../src/turnstile.js';

// ─── JWT Helper ───────────────────────────────────────────────────────────────

/** Create a fake JWT with given payload (for testing only) */
function encodeBase64UrlJson(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function makeJwt(payload: Record<string, unknown>): string {
  const header = encodeBase64UrlJson({ alg: 'HS256', typ: 'JWT' });
  const body = encodeBase64UrlJson(payload);
  return `${header}.${body}.fakesig`;
}

function makeValidJwt(userId = 'u-123', extra: Record<string, unknown> = {}) {
  return makeJwt({
    sub: userId,
    email: 'test@example.com',
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...extra,
  });
}

function makeExpiredJwt(userId = 'u-expired') {
  return makeJwt({
    sub: userId,
    email: 'expired@example.com',
    exp: Math.floor(Date.now() / 1000) - 3600,
  });
}

type MockMessageEvent = { data: unknown };

class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = [];
  static messages: Array<{ name: string; data: unknown }> = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  private listeners = new Set<(event: MessageEvent) => void>();

  constructor(public name: string) {
    MockBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown): void {
    MockBroadcastChannel.messages.push({ name: this.name, data });
    for (const instance of MockBroadcastChannel.instances) {
      if (instance === this || instance.name !== this.name) continue;
      const event = { data } as MockMessageEvent as MessageEvent;
      instance.onmessage?.(event);
      for (const listener of instance.listeners) listener(event);
    }
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    if (type === 'message') this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void): void {
    if (type === 'message') this.listeners.delete(listener);
  }

  close(): void {
    MockBroadcastChannel.instances = MockBroadcastChannel.instances.filter((instance) => instance !== this);
  }

  static reset(): void {
    MockBroadcastChannel.instances = [];
    MockBroadcastChannel.messages = [];
  }
}

function installBrowserMocks(): void {
  const store = new Map<string, string>();
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  });
  vi.stubGlobal('BroadcastChannel', MockBroadcastChannel as unknown as typeof BroadcastChannel);
}

const DEFAULT_AUTH_PREFIX = `edgebase:${encodeURIComponent('http://localhost:8688')}`;
const pendingOAuthPrefix = `${DEFAULT_AUTH_PREFIX}:oauth-pending:`;
const pendingOAuthCompletionPrefix = `${DEFAULT_AUTH_PREFIX}:oauth-pending-completion:`;

function pendingOAuthKeys(store: Map<string, string>): string[] {
  return [...store.keys()]
    .filter((key) => key.startsWith(pendingOAuthPrefix))
    .sort();
}

function pendingOAuthNonces(store: Map<string, string>): string[] {
  return pendingOAuthKeys(store)
    .map((key) => key.slice(pendingOAuthPrefix.length));
}

function readPendingOAuthRecord(
  store: Map<string, string>,
  nonce: string,
): { version: number; createdAt: number; authEpoch: number } | null {
  const raw = store.get(`${pendingOAuthPrefix}${nonce}`);
  return raw ? JSON.parse(raw) as { version: number; createdAt: number; authEpoch: number } : null;
}

function createEnumerableStorageMock(
  store: Map<string, string>,
  onSet?: (key: string, value: string) => void,
) {
  return {
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
      onSet?.(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}

function installInvalidBrowserStorageMocks(): void {
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    localStorage: { broken: true },
  });
  vi.stubGlobal('localStorage', { broken: true });
  vi.stubGlobal('BroadcastChannel', MockBroadcastChannel as unknown as typeof BroadcastChannel);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  MockBroadcastChannel.reset();
});

interface TestTurnstileRenderOptions {
  sitekey?: string;
  callback?: (token: string) => void;
  'error-callback'?: (error: unknown) => void;
  'timeout-callback'?: () => void;
}

function installReadyTurnstile(
  render: (options: TestTurnstileRenderOptions) => string,
): { removedElements: ReturnType<typeof vi.fn>; removeWidget: ReturnType<typeof vi.fn> } {
  const removedElements = vi.fn();
  const makeElement = () => ({
    style: { cssText: '', display: '' },
    appendChild: vi.fn(),
    remove: removedElements,
  });
  const removeWidget = vi.fn();
  vi.stubGlobal('document', {
    querySelector: vi.fn(() => null),
    createElement: vi.fn(makeElement),
    head: { appendChild: vi.fn() },
    body: { appendChild: vi.fn() },
  });
  vi.stubGlobal('window', {
    turnstile: {
      render: vi.fn((_container: unknown, options: TestTurnstileRenderOptions) => render(options)),
      remove: removeWidget,
      reset: vi.fn(),
    },
  });
  return { removedElements, removeWidget };
}

describe('Turnstile backend isolation', () => {
  it('cleans the overlay and timeout when turnstile.render throws synchronously', async () => {
    vi.useFakeTimers();
    const removed = vi.fn();
    const appended: Array<{ remove: () => void }> = [];
    const makeElement = () => ({
      style: { cssText: '', display: '' },
      appendChild: vi.fn(),
      remove: removed,
    });
    vi.stubGlobal('document', {
      querySelector: vi.fn(() => null),
      createElement: vi.fn(makeElement),
      head: { appendChild: vi.fn() },
      body: { appendChild: vi.fn((element) => appended.push(element)) },
    });
    vi.stubGlobal('window', {
      turnstile: {
        render: vi.fn(() => { throw new Error('render failed synchronously'); }),
        remove: vi.fn(),
        reset: vi.fn(),
      },
    });

    await expect(getCaptchaToken('site-key', 'signin')).rejects.toMatchObject({
      name: 'TurnstileError',
      reason: 'render_error',
      message: 'render failed synchronously',
    });
    expect(appended).toHaveLength(1);
    expect(removed).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('removes a failed Turnstile script so a later call can retry', async () => {
    let currentScript: {
      src: string;
      async: boolean;
      defer: boolean;
      onload: (() => void) | null;
      onerror: (() => void) | null;
      remove: ReturnType<typeof vi.fn>;
    } | null = null;
    const scripts: NonNullable<typeof currentScript>[] = [];
    const createElement = vi.fn((tag: string) => {
      if (tag === 'script') {
        const script = {
          src: '',
          async: false,
          defer: false,
          onload: null as (() => void) | null,
          onerror: null as (() => void) | null,
          remove: vi.fn(() => {
            if (currentScript === script) currentScript = null;
          }),
        };
        return script;
      }
      return {
        style: { cssText: '', display: '' },
        appendChild: vi.fn(),
        remove: vi.fn(),
      };
    });
    vi.stubGlobal('document', {
      querySelector: vi.fn(() => currentScript),
      createElement,
      head: {
        appendChild: vi.fn((script: NonNullable<typeof currentScript>) => {
          currentScript = script;
          scripts.push(script);
        }),
      },
      body: { appendChild: vi.fn() },
    });
    const browserWindow: Window & typeof globalThis = {} as Window & typeof globalThis;
    vi.stubGlobal('window', browserWindow);

    const first = getCaptchaToken('site-key', 'signin');
    expect(scripts).toHaveLength(1);
    scripts[0]!.onerror?.();
    await expect(first).rejects.toMatchObject({
      reason: 'script_load_error',
      message: 'Failed to load Turnstile script',
    });
    expect(scripts[0]!.remove).toHaveBeenCalledTimes(1);

    const second = getCaptchaToken('site-key', 'signin');
    expect(scripts).toHaveLength(2);
    browserWindow.turnstile = {
      render: vi.fn((_container, options) => {
        queueMicrotask(() => options.callback?.('retry-token'));
        return 'retry-widget';
      }),
      remove: vi.fn(),
      reset: vi.fn(),
    };
    scripts[1]!.onload?.();
    await expect(second).resolves.toBe('retry-token');
  });

  it('bounds a script that never loads and removes the poisoned element', async () => {
    vi.useFakeTimers();
    const script = {
      src: '',
      async: false,
      defer: false,
      onload: null as (() => void) | null,
      onerror: null as (() => void) | null,
      remove: vi.fn(),
    };
    vi.stubGlobal('document', {
      querySelector: vi.fn(() => null),
      createElement: vi.fn(() => script),
      head: { appendChild: vi.fn() },
      body: { appendChild: vi.fn() },
    });
    vi.stubGlobal('window', {});

    const pending = getCaptchaToken('site-key', 'signin');
    const assertion = expect(pending).rejects.toThrow(
      'Turnstile script loaded but window.turnstile not available',
    );
    await vi.advanceTimersByTimeAsync(10_001);
    await assertion;
    expect(script.remove).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('cancels immediately while the shared provider script is still loading', async () => {
    const script = {
      src: '',
      async: false,
      defer: false,
      onload: null as (() => void) | null,
      onerror: null as (() => void) | null,
      remove: vi.fn(),
    };
    const appendOverlay = vi.fn();
    vi.stubGlobal('document', {
      querySelector: vi.fn(() => null),
      createElement: vi.fn(() => script),
      head: { appendChild: vi.fn() },
      body: { appendChild: appendOverlay },
    });
    vi.stubGlobal('window', {});
    const controller = new AbortController();

    const pending = getCaptchaToken('site-key', 'signin', 30_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ reason: 'cancelled' });
    expect(appendOverlay).not.toHaveBeenCalled();

    // Settle the shared loader so it cannot leak its own deadline into later tests.
    script.onerror?.();
    await Promise.resolve();
  });

  it('refreshes the direct site key and retries exactly once on challenge_error', async () => {
    const origin = `https://captcha-challenge-retry-${crypto.randomUUID()}.example`;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        captcha: { siteKey: 'stale-site-key' },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        captcha: { siteKey: 'fresh-site-key' },
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const seenSiteKeys: string[] = [];
    const { removedElements, removeWidget } = installReadyTurnstile((options) => {
      const call = seenSiteKeys.length;
      seenSiteKeys.push(options.sitekey ?? 'missing');
      queueMicrotask(() => {
        if (call === 0) options['error-callback']?.('110200');
        else options.callback?.('fresh-token');
      });
      return `widget-${call}`;
    });

    await expect(resolveCaptchaToken(origin, 'signin')).resolves.toBe('fresh-token');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(seenSiteKeys).toEqual(['stale-site-key', 'fresh-site-key']);
    expect(removeWidget).toHaveBeenCalledTimes(2);
    expect(removedElements).toHaveBeenCalledTimes(2);
  });

  it('exposes the second challenge_error without a third attempt and cleans both widgets', async () => {
    const origin = `https://captcha-challenge-fail-${crypto.randomUUID()}.example`;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        captcha: { siteKey: 'stale-site-key' },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        captcha: { siteKey: 'fresh-site-key' },
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    let renders = 0;
    const { removedElements, removeWidget } = installReadyTurnstile((options) => {
      const call = renders++;
      queueMicrotask(() => options['error-callback']?.(`challenge-${call}`));
      return `widget-${call}`;
    });

    await expect(resolveCaptchaToken(origin, 'signin')).rejects.toMatchObject({
      name: 'TurnstileError',
      reason: 'challenge_error',
      message: 'Turnstile error: challenge-1',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(renders).toBe(2);
    expect(removeWidget).toHaveBeenCalledTimes(2);
    expect(removedElements).toHaveBeenCalledTimes(2);
  });

  it('surfaces timeout and cancellation as typed terminal failures with DOM cleanup', async () => {
    vi.useFakeTimers();
    const { removedElements, removeWidget } = installReadyTurnstile(() => 'timeout-widget');
    const timedOut = getCaptchaToken('site-key', 'signin', 1_000);
    const timeoutAssertion = expect(timedOut).rejects.toMatchObject({
      reason: 'client_timeout',
    });
    await vi.advanceTimersByTimeAsync(1_001);
    await timeoutAssertion;
    expect(removeWidget).toHaveBeenCalledWith('timeout-widget');
    expect(removedElements).toHaveBeenCalledTimes(1);

    const controller = new AbortController();
    const cancelled = getCaptchaToken('site-key', 'signin', 30_000, controller.signal);
    await Promise.resolve();
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ reason: 'cancelled' });
    expect(removeWidget).toHaveBeenCalledWith('timeout-widget');
    // Cancellation won during the post-loader microtask, before a second
    // overlay/widget became observable; therefore there is nothing extra to remove.
    expect(removeWidget).toHaveBeenCalledTimes(1);
    expect(removedElements).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('does not swallow loader or render failures into an undefined token', async () => {
    installReadyTurnstile(() => { throw new Error('synthetic render failure'); });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      captcha: { siteKey: 'configured-key' },
    }), { status: 200 })));
    await expect(resolveCaptchaToken(
      `https://captcha-render-configured-${crypto.randomUUID()}.example`,
      'signin',
    )).rejects.toMatchObject({
      name: 'TurnstileError',
      reason: 'render_error',
      message: 'synthetic render failure',
    });
  });

  it('keys cached and in-flight site-key lookups by canonical backend origin', async () => {
    const unique = crypto.randomUUID();
    const apiA = `https://captcha-a-${unique}.example`;
    const apiB = `https://captcha-b-${unique}.example`;
    const fetchMock = vi.fn(async (input: string | URL) => {
      const origin = new URL(String(input)).origin;
      const siteKey = origin === apiA ? 'site-key-a' : 'site-key-b';
      return new Response(JSON.stringify({ captcha: { siteKey } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const [firstA, duplicateA, firstB] = await Promise.all([
      fetchSiteKey(`${apiA}/`),
      fetchSiteKey(`${apiA}:443`),
      fetchSiteKey(apiB),
    ]);

    expect([firstA, duplicateA, firstB]).toEqual(['site-key-a', 'site-key-a', 'site-key-b']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(fetchSiteKey(apiB)).resolves.toBe('site-key-b');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed or invalid CAPTCHA config without caching it', async () => {
    const origin = `https://captcha-recovery-${crypto.randomUUID()}.example`;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('{', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ captcha: {} }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        captcha: { siteKey: 42 },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        captcha: { siteKey: 'invalid site key!' },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        captcha: { siteKey: '  recovered-site-key  ' },
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(fetchSiteKey(origin)).rejects.toMatchObject({
        name: 'TurnstileError',
        reason: 'config_invalid_response',
      });
    }
    await expect(fetchSiteKey(origin)).resolves.toBe('recovered-site-key');
    await expect(fetchSiteKey(origin)).resolves.toBe('recovered-site-key');
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('rejects HTTP and network failures without caching them', async () => {
    const origin = `https://captcha-fetch-recovery-${crypto.randomUUID()}.example`;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('temporarily unavailable', { status: 503 }))
      .mockRejectedValueOnce(new TypeError('synthetic network failure'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        captcha: { siteKey: 'recovered-fetch-key' },
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSiteKey(origin)).rejects.toMatchObject({
      name: 'TurnstileError',
      reason: 'config_fetch_failed',
    });
    await expect(fetchSiteKey(origin)).rejects.toMatchObject({
      name: 'TurnstileError',
      reason: 'config_fetch_failed',
    });
    await expect(fetchSiteKey(origin)).resolves.toBe('recovered-fetch-key');
    await expect(fetchSiteKey(origin)).resolves.toBe('recovered-fetch-key');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('treats explicit captcha null as disabled without caching it', async () => {
    const origin = `https://captcha-disabled-${crypto.randomUUID()}.example`;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ captcha: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        captcha: { siteKey: 'enabled-after-null' },
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSiteKey(origin)).resolves.toBeNull();
    await expect(fetchSiteKey(origin)).resolves.toBe('enabled-after-null');
    await expect(fetchSiteKey(origin)).resolves.toBe('enabled-after-null');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refreshes a positive site key after the bounded rotation cache TTL', async () => {
    const origin = `https://captcha-ttl-${crypto.randomUUID()}.example`;
    let now = 2_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        captcha: { siteKey: 'site-key-before-rotation' },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        captcha: { siteKey: 'site-key-after-rotation' },
      }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSiteKey(origin)).resolves.toBe('site-key-before-rotation');
    now += 5 * 60 * 1000 - 1;
    await expect(fetchSiteKey(origin)).resolves.toBe('site-key-before-rotation');
    now += 2;
    await expect(fetchSiteKey(origin)).resolves.toBe('site-key-after-rotation');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// ─── A. TokenManager 초기 상태 ─────────────────────────────────────────────

describe('TokenManager — 초기 상태', () => {
  it('초기 getCurrentUser() === null', () => {
    const tm = new TokenManager('http://localhost:8688');
    expect(tm.getCurrentUser()).toBeNull();
    tm.destroy();
  });

  it('초기 getRefreshToken() === null', () => {
    const tm = new TokenManager('http://localhost:8688');
    expect(tm.getRefreshToken()).toBeNull();
    tm.destroy();
  });

  it('onAuthStateChange — 즉시 null로 호출', () => {
    const tm = new TokenManager('http://localhost:8688');
    const calls: (null | unknown)[] = [];
    const unsub = tm.onAuthStateChange((user) => calls.push(user));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBeNull();
    unsub();
    tm.destroy();
  });

  it('invalid localStorage shape falls back to memory storage', () => {
    installInvalidBrowserStorageMocks();
    const tm = new TokenManager('http://localhost:8688');
    const token = makeValidJwt('u-fallback');
    expect(() => tm.setTokens({ accessToken: token, refreshToken: token })).not.toThrow();
    expect(tm.getRefreshToken()).toBe(token);
    tm.destroy();
  });
});

// ─── B. setTokens / clearTokens ─────────────────────────────────────────────

describe('TokenManager — setTokens', () => {
  it('setTokens → getCurrentUser().id 반영', () => {
    const tm = new TokenManager('http://localhost:8688');
    const at = makeValidJwt('user-42');
    const rt = makeValidJwt('user-42');
    tm.setTokens({ accessToken: at, refreshToken: rt });
    expect(tm.getCurrentUser()?.id).toBe('user-42');
    tm.destroy();
  });

  it('setTokens → getCurrentUser().email 반영', () => {
    const tm = new TokenManager('http://localhost:8688');
    const at = makeValidJwt('user-email', { email: 'hello@world.com' });
    tm.setTokens({ accessToken: at, refreshToken: at });
    expect(tm.getCurrentUser()?.email).toBe('hello@world.com');
    tm.destroy();
  });

  it('setTokens → getRefreshToken() 반영', () => {
    const tm = new TokenManager('http://localhost:8688');
    const at = makeValidJwt('u-1');
    const rt = makeValidJwt('u-1');
    tm.setTokens({ accessToken: at, refreshToken: rt });
    expect(tm.getRefreshToken()).toBe(rt);
    tm.destroy();
  });

  it('setTokens → onAuthStateChange 호출', () => {
    const tm = new TokenManager('http://localhost:8688');
    const calls: unknown[] = [];
    const unsub = tm.onAuthStateChange((user) => calls.push(user));
    // initial call = 1
    const at = makeValidJwt('u-2');
    tm.setTokens({ accessToken: at, refreshToken: at });
    // should have been called again after setTokens
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect((calls[calls.length - 1] as { id: string })?.id).toBe('u-2');
    unsub();
    tm.destroy();
  });
});

describe('TokenManager — clearTokens', () => {
  it('clearTokens → getCurrentUser() === null', () => {
    const tm = new TokenManager('http://localhost:8688');
    const at = makeValidJwt('u-clear');
    tm.setTokens({ accessToken: at, refreshToken: at });
    tm.clearTokens();
    expect(tm.getCurrentUser()).toBeNull();
    tm.destroy();
  });

  it('clearTokens → getRefreshToken() === null', () => {
    const tm = new TokenManager('http://localhost:8688');
    const at = makeValidJwt('u-clear2');
    tm.setTokens({ accessToken: at, refreshToken: at });
    tm.clearTokens();
    expect(tm.getRefreshToken()).toBeNull();
    tm.destroy();
  });

  it('clearTokens → onAuthStateChange(null) 호출', () => {
    const tm = new TokenManager('http://localhost:8688');
    const calls: unknown[] = [];
    const at = makeValidJwt('u-clr');
    tm.setTokens({ accessToken: at, refreshToken: at });
    const unsub = tm.onAuthStateChange((user) => calls.push(user));
    tm.clearTokens();
    // Last call should be null
    expect(calls[calls.length - 1]).toBeNull();
    unsub();
    tm.destroy();
  });
});

describe('TokenManager — cross-tab sign-out', () => {
  it('isolates credentials, OAuth state, epochs, and locks by canonical base URL', () => {
    const store = new Map<string, string>();
    const legacyUnboundToken = makeValidJwt('legacy-unbound');
    store.set('edgebase:refresh-token', legacyUnboundToken);
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('localStorage', createEnumerableStorageMock(store));
    const first = new TokenManager('https://api-a.example.com');
    const second = new TokenManager('https://api-b.example.com');

    expect(first.getCurrentUser()).toBeNull();
    expect(second.getCurrentUser()).toBeNull();
    first.setTokens({
      accessToken: makeValidJwt('project-a'),
      refreshToken: makeValidJwt('project-a'),
    });
    second.setTokens({
      accessToken: makeValidJwt('project-b'),
      refreshToken: makeValidJwt('project-b'),
    });
    const firstNonce = first.markPendingOAuthRecovery();
    const secondNonce = second.markPendingOAuthRecovery();
    first.clearTokens();

    expect(first.getCurrentUser()).toBeNull();
    expect(second.getCurrentUser()?.id).toBe('project-b');
    expect(second.getRefreshToken()).toContain('.');
    expect([...store.keys()].some((key) => key.includes(encodeURIComponent('https://api-a.example.com')) && key.endsWith(firstNonce))).toBe(false);
    expect([...store.keys()].some((key) => key.includes(encodeURIComponent('https://api-b.example.com')) && key.endsWith(secondNonce))).toBe(true);
    expect(store.get('edgebase:refresh-token')).toBe(legacyUnboundToken);
    first.destroy();
    second.destroy();
  });

  it('clears peer tabs without rebroadcast loops', () => {
    installBrowserMocks();

    const accessToken = makeValidJwt('u-broadcast');
    const refreshToken = makeValidJwt('u-broadcast', {
      exp: Math.floor(Date.now() / 1000) + 7200,
    });

    const leader = new TokenManager('http://localhost:8688');
    const follower = new TokenManager('http://localhost:8688');

    leader.setTokens({ accessToken, refreshToken });
    follower.setTokens({ accessToken, refreshToken });

    leader.clearTokens();

    expect(follower.getCurrentUser()).toBeNull();
    const signedOutMessages = MockBroadcastChannel.messages.filter(
      (message) => (message.data as { type?: string })?.type === 'signed-out',
    );
    expect(signedOutMessages).toHaveLength(1);

    leader.destroy();
    follower.destroy();
  });

  it('fails waiting refresh requests immediately when another tab signs out', async () => {
    installBrowserMocks();

    const accessToken = makeExpiredJwt('u-broadcast');
    const refreshToken = makeValidJwt('u-broadcast', {
      exp: Math.floor(Date.now() / 1000) + 7200,
    });

    const leader = new TokenManager('http://localhost:8688');
    const follower = new TokenManager('http://localhost:8688');

    leader.setTokens({ accessToken, refreshToken });
    follower.setTokens({ accessToken, refreshToken });
    localStorage.setItem(`${DEFAULT_AUTH_PREFIX}:refresh-lock`, Date.now().toString());

    const pending = follower.getAccessToken(async () => {
      throw new Error('follower should wait for another tab');
    });

    leader.clearTokens();

    await expect(pending).rejects.toMatchObject({ code: 401 });

    leader.destroy();
    follower.destroy();
  });
});

describe('TokenManager — invalidateAccessToken', () => {
  it('drops only the access token when a refresh token still exists', () => {
    const tm = new TokenManager('http://localhost:8688');
    const at = makeValidJwt('u-refresh');
    const rt = makeValidJwt('u-refresh', {
      exp: Math.floor(Date.now() / 1000) + 7200,
    });
    tm.setTokens({ accessToken: at, refreshToken: rt });

    tm.invalidateAccessToken();

    expect(tm.currentAccessToken).toBeNull();
    expect(tm.getRefreshToken()).toBe(rt);
    expect(tm.getCurrentUser()?.id).toBe('u-refresh');
    tm.destroy();
  });

  it('clears cached user state when no refresh token remains', () => {
    const tm = new TokenManager('http://localhost:8688');
    tm.setAccessToken(makeValidJwt('u-access-only'));

    tm.invalidateAccessToken();

    expect(tm.currentAccessToken).toBeNull();
    expect(tm.getCurrentUser()).toBeNull();
    tm.destroy();
  });
});

// ─── C. onAuthStateChange — unsubscribe ───────────────────────────────────────

describe('TokenManager — onAuthStateChange unsubscribe', () => {
  it('unsub 후 → 더 이상 호출 안 됨', () => {
    const tm = new TokenManager('http://localhost:8688');
    let count = 0;
    const unsub = tm.onAuthStateChange(() => count++);
    const before = count;
    unsub();
    tm.setTokens({ accessToken: makeValidJwt('u-notsub'), refreshToken: makeValidJwt('u-notsub') });
    expect(count).toBe(before); // no more calls after unsub
    tm.destroy();
  });

  it('여러 리스너 등록 가능', () => {
    const tm = new TokenManager('http://localhost:8688');
    let count1 = 0;
    let count2 = 0;
    const unsub1 = tm.onAuthStateChange(() => count1++);
    const unsub2 = tm.onAuthStateChange(() => count2++);
    expect(count1).toBe(1);
    expect(count2).toBe(1);
    unsub1();
    unsub2();
    tm.destroy();
  });
});

// ─── D. destroy ───────────────────────────────────────────────────────────────

describe('TokenManager — destroy', () => {
  it('destroy() 후 authStateListeners 비워짐 (에러 없음)', () => {
    const tm = new TokenManager('http://localhost:8688');
    tm.onAuthStateChange(() => {});
    expect(() => tm.destroy()).not.toThrow();
  });

  it('destroy() 여러번 호출 가능', () => {
    const tm = new TokenManager('http://localhost:8688');
    expect(() => {
      tm.destroy();
      tm.destroy();
    }).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXPANDED TESTS — Phase 2 additions below
// ═══════════════════════════════════════════════════════════════════════════════

import { AuthClient } from '../../src/auth.js';
import { RoomClient, type RoomOptions } from '../../src/room.js';
import { matchesFilter } from '../../src/match-filter.js';
import { ClientAnalytics } from '../../src/analytics.js';
import { refreshAccessToken } from '../../src/auth-refresh.js';
import { ApiPaths, HttpClient, ContextManager, EdgeBaseError } from '@edge-base/core';

type RefreshLeaderElectionHarness = TokenManager & {
  refreshWithLeaderElection: (
    refreshToken: string,
    doRefresh: (refreshToken: string) => Promise<{ accessToken: string; refreshToken: string }>,
  ) => Promise<string>;
};

function tokenManagerHarness(tm: TokenManager): RefreshLeaderElectionHarness {
  return tm as unknown as RefreshLeaderElectionHarness;
}

describe('TokenManager — cross-tab refresh coordination', () => {
  it('does not refresh when another tab wins the localStorage lock race', async () => {
    installBrowserMocks();

    const staleAccessToken = makeExpiredJwt('u-lock-race');
    const refreshToken = makeValidJwt('u-lock-race', {
      exp: Math.floor(Date.now() / 1000) + 7200,
    });
    const refreshedAccessToken = makeValidJwt('u-lock-race-fresh');
    const refreshedRefreshToken = makeValidJwt('u-lock-race-fresh', {
      exp: Math.floor(Date.now() / 1000) + 7200,
    });
    const tm = new TokenManager('http://localhost:8688');
    tm.setTokens({ accessToken: staleAccessToken, refreshToken });

    const originalSetItem = localStorage.setItem.bind(localStorage);
    let overwroteLock = false;
    vi.spyOn(localStorage, 'setItem').mockImplementation((key: string, value: string) => {
      originalSetItem(key, value);
      if (key !== `${DEFAULT_AUTH_PREFIX}:refresh-lock` || overwroteLock) return;
      overwroteLock = true;
      originalSetItem(
        key,
        JSON.stringify({ ownerId: 'other-tab', timestamp: Date.now() }),
      );
      setTimeout(() => {
        const peer = new MockBroadcastChannel(`${DEFAULT_AUTH_PREFIX}:auth`);
        peer.postMessage({
          type: 'token-refreshed',
          accessToken: refreshedAccessToken,
          refreshToken: refreshedRefreshToken,
        });
        peer.close();
      }, 30);
    });

    const doRefresh = vi.fn(async () => {
      throw new Error('This tab should wait for the winning tab.');
    });

    await expect(tm.getAccessToken(doRefresh)).resolves.toBe(refreshedAccessToken);
    expect(doRefresh).not.toHaveBeenCalled();
    expect(tm.getRefreshToken()).toBe(refreshedRefreshToken);

    tm.destroy();
  });

  it('keeps a newer stored refresh token when a stale refresh request fails', async () => {
    installBrowserMocks();

    const staleRefreshToken = makeValidJwt('u-stale', {
      exp: Math.floor(Date.now() / 1000) + 7200,
    });
    const newerRefreshToken = makeValidJwt('u-newer', {
      exp: Math.floor(Date.now() / 1000) + 7200,
    });
    const tm = new TokenManager('http://localhost:8688');
    localStorage.setItem(`${DEFAULT_AUTH_PREFIX}:refresh-token`, staleRefreshToken);

    await expect(
      tokenManagerHarness(tm).refreshWithLeaderElection(staleRefreshToken, async () => {
        localStorage.setItem(`${DEFAULT_AUTH_PREFIX}:refresh-token`, newerRefreshToken);
        throw new EdgeBaseError(401, 'Refresh token reuse detected. Session revoked.');
      }),
    ).rejects.toMatchObject({ code: 401 });

    expect(localStorage.getItem(`${DEFAULT_AUTH_PREFIX}:refresh-token`)).toBe(newerRefreshToken);
    expect(
      MockBroadcastChannel.messages.filter(
        (message) => (message.data as { type?: string })?.type === 'signed-out',
      ),
    ).toHaveLength(0);

    tm.destroy();
  });
});

describe('TokenManager — no-BroadcastChannel fallback refresh-result', () => {
  function installFallbackMocks() {
    const store = new Map<string, string>();
    let storageListener: ((event: { key: string; newValue: string | null }) => void) | null = null;
    vi.stubGlobal('window', {
      addEventListener: (type: string, fn: (event: unknown) => void) => {
        if (type === 'storage') storageListener = fn as typeof storageListener;
      },
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });
    // No BroadcastChannel → the fallback (storage-event) path is exercised.
    vi.stubGlobal('BroadcastChannel', undefined);
    return {
      store,
      dispatch: (key: string, newValue: string | null) => storageListener?.({ key, newValue }),
    };
  }

  it('rejects a STALE parked result and consumes a FRESH one, clearing it immediately', () => {
    const { store, dispatch } = installFallbackMocks();
    const refreshToken = makeValidJwt('u-fallback', {
      exp: Math.floor(Date.now() / 1000) + 7200,
    });
    const tm = new TokenManager('http://localhost:8688');
    // Canonical refresh token is present (leader wrote it before signalling).
    store.set(`${DEFAULT_AUTH_PREFIX}:refresh-token`, refreshToken);

    // A stale result (older than the validity window) must NOT be trusted.
    const staleAccess = makeValidJwt('u-stale-access');
    const staleEntry = JSON.stringify({ accessToken: staleAccess, timestamp: Date.now() - 60_000 });
    store.set(`${DEFAULT_AUTH_PREFIX}:refresh-result`, staleEntry);
    dispatch(`${DEFAULT_AUTH_PREFIX}:refresh-result`, staleEntry);
    expect(tm.currentAccessToken).toBeNull();
    // Stale entry is left as-is (not consumed).
    expect(store.get(`${DEFAULT_AUTH_PREFIX}:refresh-result`)).toBe(staleEntry);

    // A fresh result IS consumed and cleared from storage immediately.
    const freshAccess = makeValidJwt('u-fresh-access');
    const freshEntry = JSON.stringify({ accessToken: freshAccess, timestamp: Date.now() });
    store.set(`${DEFAULT_AUTH_PREFIX}:refresh-result`, freshEntry);
    dispatch(`${DEFAULT_AUTH_PREFIX}:refresh-result`, freshEntry);
    expect(tm.currentAccessToken).toBe(freshAccess);
    expect(store.get(`${DEFAULT_AUTH_PREFIX}:refresh-result`)).toBeUndefined();

    tm.destroy();
  });
});

// ─── E. TokenManager — expired token handling ────────────────────────────────

describe('TokenManager — expired token', () => {
  it('expired JWT → getCurrentUser still returns user (decode only, no verify)', () => {
    const tm = new TokenManager('http://localhost:8688');
    const at = makeExpiredJwt('u-expired');
    tm.setTokens({ accessToken: at, refreshToken: at });
    // TokenManager decodes without verifying expiry for currentUser
    const user = tm.getCurrentUser();
    expect(user?.id).toBe('u-expired');
    tm.destroy();
  });

  it('setTokens with expired token fires onAuthStateChange', () => {
    const tm = new TokenManager('http://localhost:8688');
    const calls: unknown[] = [];
    const unsub = tm.onAuthStateChange((u) => calls.push(u));
    const at = makeExpiredJwt('u-exp2');
    tm.setTokens({ accessToken: at, refreshToken: at });
    expect(calls.length).toBeGreaterThanOrEqual(2);
    unsub();
    tm.destroy();
  });
});

// ─── F. TokenManager — token properties ──────────────────────────────────────

describe('TokenManager — token properties', () => {
  it('displayName from JWT payload', () => {
    const tm = new TokenManager('http://localhost:8688');
    const at = makeJwt({
      sub: 'u-dn',
      email: 'a@b.com',
      displayName: 'Alice',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    tm.setTokens({ accessToken: at, refreshToken: at });
    expect(tm.getCurrentUser()?.displayName).toBe('Alice');
    tm.destroy();
  });

  it('UTF-8 displayName from JWT payload', () => {
    const tm = new TokenManager('http://localhost:8688');
    const at = makeJwt({
      sub: 'u-ko',
      email: 'ko@example.com',
      displayName: '준강',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    tm.setTokens({ accessToken: at, refreshToken: at });
    expect(tm.getCurrentUser()?.displayName).toBe('준강');
    tm.destroy();
  });

  it('isAnonymous from JWT payload', () => {
    const tm = new TokenManager('http://localhost:8688');
    const at = makeJwt({
      sub: 'u-anon',
      isAnonymous: true,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    tm.setTokens({ accessToken: at, refreshToken: at });
    expect(tm.getCurrentUser()?.isAnonymous).toBe(true);
    tm.destroy();
  });

  it('role from JWT payload', () => {
    const tm = new TokenManager('http://localhost:8688');
    const at = makeJwt({
      sub: 'u-role',
      role: 'admin',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    tm.setTokens({ accessToken: at, refreshToken: at });
    expect(tm.getCurrentUser()?.role).toBe('admin');
    tm.destroy();
  });

  it('custom claims from JWT payload', () => {
    const tm = new TokenManager('http://localhost:8688');
    const at = makeJwt({
      sub: 'u-custom',
      custom: { tier: 'premium' },
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    tm.setTokens({ accessToken: at, refreshToken: at });
    expect(tm.getCurrentUser()?.custom?.tier).toBe('premium');
    tm.destroy();
  });

  it('overwriting tokens replaces user', () => {
    const tm = new TokenManager('http://localhost:8688');
    const at1 = makeValidJwt('u-first');
    tm.setTokens({ accessToken: at1, refreshToken: at1 });
    expect(tm.getCurrentUser()?.id).toBe('u-first');

    const at2 = makeValidJwt('u-second');
    tm.setTokens({ accessToken: at2, refreshToken: at2 });
    expect(tm.getCurrentUser()?.id).toBe('u-second');
    tm.destroy();
  });
});

// ─── G. TokenManager — multiple listeners ────────────────────────────────────

describe('TokenManager — multiple listeners', () => {
  it('each listener receives its own initial call', () => {
    const tm = new TokenManager('http://localhost:8688');
    const calls1: unknown[] = [];
    const calls2: unknown[] = [];
    const unsub1 = tm.onAuthStateChange((u) => calls1.push(u));
    const unsub2 = tm.onAuthStateChange((u) => calls2.push(u));
    expect(calls1).toHaveLength(1);
    expect(calls2).toHaveLength(1);
    unsub1();
    unsub2();
    tm.destroy();
  });

  it('setTokens notifies all active listeners', () => {
    const tm = new TokenManager('http://localhost:8688');
    let count1 = 0;
    let count2 = 0;
    const unsub1 = tm.onAuthStateChange(() => count1++);
    const unsub2 = tm.onAuthStateChange(() => count2++);
    const at = makeValidJwt('u-multi');
    tm.setTokens({ accessToken: at, refreshToken: at });
    expect(count1).toBeGreaterThanOrEqual(2);
    expect(count2).toBeGreaterThanOrEqual(2);
    unsub1();
    unsub2();
    tm.destroy();
  });

  it('unsubscribing one does not affect the other', () => {
    const tm = new TokenManager('http://localhost:8688');
    let count1 = 0;
    let count2 = 0;
    const unsub1 = tm.onAuthStateChange(() => count1++);
    const unsub2 = tm.onAuthStateChange(() => count2++);
    unsub1();
    const at = makeValidJwt('u-partial');
    tm.setTokens({ accessToken: at, refreshToken: at });
    expect(count1).toBe(1); // only initial
    expect(count2).toBeGreaterThanOrEqual(2); // initial + setTokens
    unsub2();
    tm.destroy();
  });
});

// ─── H. AuthClient — method existence ────────────────────────────────────────

describe('AuthClient — method signatures', () => {
  it('signUp is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm);
    expect(typeof auth.signUp).toBe('function');
    tm.destroy();
  });

  it('signIn is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm);
    expect(typeof auth.signIn).toBe('function');
    tm.destroy();
  });

  it('signOut is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm);
    expect(typeof auth.signOut).toBe('function');
    tm.destroy();
  });

  it('signInAnonymously is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm);
    expect(typeof auth.signInAnonymously).toBe('function');
    tm.destroy();
  });

  it('listSessions is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm);
    expect(typeof auth.listSessions).toBe('function');
    tm.destroy();
  });

  it('revokeSession is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm);
    expect(typeof auth.revokeSession).toBe('function');
    tm.destroy();
  });

  it('regenerateRecoveryCodes is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm);
    expect(typeof auth.mfa.regenerateRecoveryCodes).toBe('function');
    tm.destroy();
  });

  it('getCurrentSessionId decodes the refresh token jti', () => {
    const tm = new TokenManager('http://localhost:8688');
    tm.setTokens({
      accessToken: makeValidJwt('session-user'),
      refreshToken: makeValidJwt('session-user', { type: 'refresh', jti: 'sess-current' }),
    });
    expect(tm.getCurrentSessionId()).toBe('sess-current');
    tm.destroy();
  });

  it('updateProfile is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm);
    expect(typeof auth.updateProfile).toBe('function');
    tm.destroy();
  });

  it('verifyEmail is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm);
    expect(typeof auth.verifyEmail).toBe('function');
    tm.destroy();
  });

  it('changePassword is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm);
    expect(typeof auth.changePassword).toBe('function');
    tm.destroy();
  });

  it('onAuthStateChange is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm);
    expect(typeof auth.onAuthStateChange).toBe('function');
    tm.destroy();
  });

  it('currentUser is null initially', () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm);
    expect(auth.currentUser).toBeNull();
    tm.destroy();
  });

  it('signInWithOAuth is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm);
    expect(typeof auth.signInWithOAuth).toBe('function');
    tm.destroy();
  });

  it('linkWithEmail is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm);
    expect(typeof auth.linkWithEmail).toBe('function');
    tm.destroy();
  });

  it('requestPasswordReset is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm);
    expect(typeof auth.requestPasswordReset).toBe('function');
    tm.destroy();
  });

  it('resetPassword is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm);
    expect(typeof auth.resetPassword).toBe('function');
    tm.destroy();
  });
});

describe('AuthClient — OAuth flow helpers', () => {
  beforeEach(() => {
    // These tests exercise OAuth state handling, not CAPTCHA discovery. Model
    // an explicitly disabled server instead of relying on config fetch errors
    // being interpreted as `captcha: null`.
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname !== '/api/config') {
        throw new Error(`Unexpected network request in OAuth unit test: ${url.pathname}`);
      }
      return new Response(JSON.stringify({ captcha: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));
  });

  it('signInWithOAuth adds redirect_url and uses the browser callback route by default', async () => {
    const store = new Map<string, string>();
    const location = {
      href: 'http://localhost:4173/login',
      origin: 'http://localhost:4173',
    };
    vi.stubGlobal('window', {
      location,
      history: { replaceState: vi.fn() },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });

    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm, {} as any, {} as any);

    const result = await auth.signInWithOAuth('google');

    const startUrl = new URL(result.url);
    const recoveryNonce = startUrl.searchParams.get('oauth_recovery_nonce');
    expect(startUrl.origin).toBe('http://localhost:8688');
    expect(startUrl.pathname).toBe('/api/auth/oauth/google');
    expect(startUrl.searchParams.get('redirect_url')).toBe('http://localhost:4173/auth/callback');
    expect(recoveryNonce).toMatch(/^[0-9a-f]{64}$/);
    expect(readPendingOAuthRecord(store, recoveryNonce!)).toMatchObject({
      version: 1,
      authEpoch: 0,
    });
    expect(location.href).toBe(result.url);
    tm.destroy();
  });

  it('signInWithOAuth supports redirectUrl and captchaToken together', async () => {
    installBrowserMocks();
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm, {} as any, {} as any);

    const result = await auth.signInWithOAuth('google', {
      redirectUrl: 'http://localhost:4173/custom-callback',
      captchaToken: 'captcha-token-123',
      navigate: false,
    });

    const url = new URL(result.url);
    expect(url.pathname).toBe('/api/auth/oauth/google');
    expect(url.searchParams.get('captcha_token')).toBe('captcha-token-123');
    expect(url.searchParams.get('redirect_url')).toBe('http://localhost:4173/custom-callback');
    expect(url.searchParams.get('oauth_recovery_nonce')).toMatch(/^[0-9a-f]{64}$/);
    tm.destroy();
  });

  it('fails closed before navigation when secure OAuth nonce generation is unavailable', async () => {
    const location = {
      href: 'http://localhost:4173/login',
      origin: 'http://localhost:4173',
    };
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      location,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
    vi.stubGlobal('crypto', undefined);
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm, {} as any, {} as any);

    await expect(auth.signInWithOAuth('google')).rejects.toThrow(
      'Secure random generation is required to start OAuth.',
    );
    expect(location.href).toBe('http://localhost:4173/login');
    expect(pendingOAuthKeys(store)).toHaveLength(0);
    tm.destroy();
  });

  it('keeps normal memory fallback but refuses OAuth that cannot survive navigation', async () => {
    const location = {
      href: 'http://localhost:4173/login',
      origin: 'http://localhost:4173',
    };
    vi.stubGlobal('window', {
      location,
      localStorage: { unavailable: true },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('localStorage', { unavailable: true });
    const tm = new TokenManager('http://localhost:8688');
    tm.setTokens({
      accessToken: makeValidJwt('memory-user'),
      refreshToken: makeValidJwt('memory-user'),
    });
    expect(tm.getCurrentUser()?.id).toBe('memory-user');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm, {} as any, {} as any);

    await expect(auth.signInWithOAuth('google')).rejects.toThrow(
      'Persistent browser storage is required to start OAuth safely.',
    );
    expect(location.href).toBe('http://localhost:4173/login');
    tm.destroy();
  });

  it('signInWithOAuth supports redirectTo alias and can skip browser navigation', async () => {
    const store = new Map<string, string>();
    const location = {
      href: 'http://localhost:4173/login',
      origin: 'http://localhost:4173',
    };
    vi.stubGlobal('window', {
      location,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });

    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm, {} as any, {} as any);

    const result = await auth.signInWithOAuth('github', {
      redirectTo: 'http://localhost:4173/custom-callback',
      navigate: false,
    });

    const startUrl = new URL(result.url);
    expect(startUrl.pathname).toBe('/api/auth/oauth/github');
    expect(startUrl.searchParams.get('redirect_url')).toBe('http://localhost:4173/custom-callback');
    expect(startUrl.searchParams.get('oauth_recovery_nonce')).toMatch(/^[0-9a-f]{64}$/);
    expect(location.href).toBe('http://localhost:4173/login');
    tm.destroy();
  });

  it('binds account-linking callbacks to the same one-shot browser nonce', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      location: { href: 'http://localhost:4173/settings', origin: 'http://localhost:4173' },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
    const oauthLinkStart = vi.fn(async (
      _provider: string,
      _body: Record<string, unknown>,
    ) => ({
      redirectUrl: 'https://provider.example.com/authorize?state=server-state',
    }));

    const tm = new TokenManager('http://localhost:8688');
    tm.setTokens({
      accessToken: makeValidJwt('link-user'),
      refreshToken: makeValidJwt('link-user'),
    });
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm, { oauthLinkStart } as any, {} as any);

    await expect(auth.linkWithOAuth('google', {
      redirectUrl: 'http://localhost:4173/auth/callback',
      navigate: false,
    })).resolves.toEqual({
      redirectUrl: 'https://provider.example.com/authorize?state=server-state',
    });

    expect(oauthLinkStart).toHaveBeenCalledWith('google', expect.any(Object));
    const body = oauthLinkStart.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body.redirectUrl).toBe('http://localhost:4173/auth/callback');
    expect(body.oauthRecoveryNonce).toMatch(/^[0-9a-f]{64}$/);
    expect(readPendingOAuthRecord(store, body.oauthRecoveryNonce as string)).toMatchObject({
      version: 1,
      authEpoch: expect.any(Number),
    });
    tm.destroy();
  });

  it('accepts a correctly bound popup callback URL without navigating the opener', async () => {
    const location = {
      href: 'http://localhost:4173/login',
      origin: 'http://localhost:4173',
    };
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      location,
      history: { replaceState: vi.fn() },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
    const accessToken = makeValidJwt('popup-user');
    const refreshToken = makeValidJwt('popup-user', {
      exp: Math.floor(Date.now() / 1000) + 7200,
    });
    const corePublic = {
      authRefresh: vi.fn().mockResolvedValue({
        user: { id: 'popup-user' },
        accessToken,
        refreshToken,
      }),
    };
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm, {} as any, corePublic as any);

    const start = await auth.signInWithOAuth('google', { navigate: false });
    const recoveryNonce = new URL(start.url).searchParams.get('oauth_recovery_nonce')!;
    const result = await auth.handleOAuthCallback(
      `http://localhost:4173/auth/callback#access_token=${accessToken}&refresh_token=${refreshToken}&oauth_recovery_nonce=${recoveryNonce}`,
    );

    expect(result).toMatchObject({ user: { id: 'popup-user' } });
    expect(corePublic.authRefresh).toHaveBeenCalledWith({ refreshToken });
    expect(location.href).toBe('http://localhost:4173/login');
    expect(window.history.replaceState).not.toHaveBeenCalled();
    expect(tm.hasPendingOAuthRecovery()).toBe(false);
    tm.destroy();
  });

  it('accepts the first bound OAuth callback and invalidates sibling login flows after identity changes', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      location: { href: 'http://localhost:4173/login', origin: 'http://localhost:4173' },
      history: { replaceState: vi.fn() },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
    const accessA = makeValidJwt('flow-a');
    const refreshA = makeValidJwt('flow-a', { exp: Math.floor(Date.now() / 1000) + 7200 });
    const accessB = makeValidJwt('flow-b');
    const refreshB = makeValidJwt('flow-b', { exp: Math.floor(Date.now() / 1000) + 7200 });
    const authRefresh = vi.fn(async ({ refreshToken }: { refreshToken: string }) => {
      if (refreshToken === refreshA) {
        return { user: { id: 'flow-a' }, accessToken: accessA, refreshToken: refreshA };
      }
      if (refreshToken === refreshB) {
        return { user: { id: 'flow-b' }, accessToken: accessB, refreshToken: refreshB };
      }
      throw new Error('unexpected refresh token');
    });
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm, {} as any, { authRefresh } as any);

    const startA = await auth.signInWithOAuth('google', { navigate: false });
    const startB = await auth.signInWithOAuth('github', { navigate: false });
    const nonceA = new URL(startA.url).searchParams.get('oauth_recovery_nonce')!;
    const nonceB = new URL(startB.url).searchParams.get('oauth_recovery_nonce')!;
    expect(pendingOAuthNonces(store).sort()).toEqual([nonceA, nonceB].sort());
    const wrongNonce = nonceA === '0'.repeat(64) || nonceB === '0'.repeat(64)
      ? '1'.repeat(64)
      : '0'.repeat(64);

    await expect(auth.handleOAuthCallback(
      `http://localhost:4173/auth/callback#access_token=ignored&refresh_token=${refreshB}&oauth_recovery_nonce=${wrongNonce}`,
    )).resolves.toBeNull();
    expect(authRefresh).not.toHaveBeenCalled();
    expect(pendingOAuthKeys(store)).toHaveLength(2);

    await expect(auth.handleOAuthCallback(
      `http://localhost:4173/auth/callback#access_token=${accessB}&refresh_token=${refreshB}&oauth_recovery_nonce=${nonceB}`,
    )).resolves.toMatchObject({ user: { id: 'flow-b' } });
    expect(pendingOAuthNonces(store)).toEqual([]);

    await expect(auth.handleOAuthCallback(
      `http://localhost:4173/auth/callback#access_token=${accessA}&refresh_token=${refreshA}&oauth_recovery_nonce=${nonceA}`,
    )).resolves.toBeNull();
    expect(pendingOAuthKeys(store)).toHaveLength(0);
    expect(authRefresh).toHaveBeenCalledTimes(1);
    expect(auth.currentUser?.id).toBe('flow-b');
    tm.destroy();
  });

  it('bounds independent persistent OAuth flow records to the eight newest live entries', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
    const tm = new TokenManager('http://localhost:8688');
    const nonces = Array.from({ length: 10 }, () => tm.markPendingOAuthRecovery());
    expect(pendingOAuthKeys(store)).toHaveLength(8);
    expect(pendingOAuthNonces(store).sort()).toEqual(nonces.slice(-8).sort());
    const epoch = tm.captureAuthEpoch();
    expect(await tm.consumePendingOAuthRecovery(nonces[0], epoch)).toBe(false);
    expect(await tm.consumePendingOAuthRecovery(nonces[9], epoch)).toBe(true);
    expect(tm.hasPendingOAuthRecovery()).toBe(true);
    tm.destroy();
  });

  it('preserves interleaved peer starts because each flow owns a unique storage key', () => {
    const store = new Map<string, string>();
    let peer: TokenManager;
    let peerNonce = '';
    let insidePeerStart = false;
    const storage = createEnumerableStorageMock(store, (key) => {
      if (!key.startsWith(pendingOAuthPrefix) || insidePeerStart || !peer) return;
      insidePeerStart = true;
      peerNonce = peer.markPendingOAuthRecovery();
      insidePeerStart = false;
    });
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('localStorage', storage);
    const first = new TokenManager('http://localhost:8688');
    peer = new TokenManager('http://localhost:8688');

    const firstNonce = first.markPendingOAuthRecovery();

    expect(peerNonce).toMatch(/^[0-9a-f]{64}$/);
    expect(pendingOAuthNonces(store).sort()).toEqual([firstNonce, peerNonce].sort());
    first.destroy();
    peer.destroy();
  });

  it('serializes same-nonce consume with Web Locks and accepts it only once', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('localStorage', createEnumerableStorageMock(store));
    let lockTail = Promise.resolve();
    const lockRequest = vi.fn(<T>(
      _name: string,
      _options: { mode: 'exclusive' },
      callback: () => T | Promise<T>,
    ): Promise<T> => {
      const result = lockTail.then(callback);
      lockTail = result.then(() => undefined, () => undefined);
      return result;
    });
    vi.stubGlobal('navigator', { onLine: true, locks: { request: lockRequest } });
    const tm = new TokenManager('http://localhost:8688');
    const nonce = tm.markPendingOAuthRecovery();
    const epoch = tm.captureAuthEpoch();

    const consumed = await Promise.all([
      tm.consumePendingOAuthRecovery(nonce, epoch),
      tm.consumePendingOAuthRecovery(nonce, epoch),
    ]);

    expect(consumed.sort()).toEqual([false, true]);
    expect(lockRequest).toHaveBeenCalledTimes(2);
    expect(pendingOAuthKeys(store)).toHaveLength(0);
    tm.destroy();
  });

  it('claims same-nonce consume atomically across peers without Web Locks', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('localStorage', createEnumerableStorageMock(store));
    vi.stubGlobal('navigator', { onLine: true });
    const first = new TokenManager('http://localhost:8688');
    const second = new TokenManager('http://localhost:8688');
    const nonce = first.markPendingOAuthRecovery();
    const epoch = first.captureAuthEpoch();

    const consumed = await Promise.all([
      first.consumePendingOAuthRecovery(nonce, epoch),
      second.consumePendingOAuthRecovery(nonce, epoch),
    ]);

    expect(consumed.sort()).toEqual([false, true]);
    expect(pendingOAuthKeys(store)).toHaveLength(0);
    expect([...store.keys()].filter((key) => key.startsWith(`${DEFAULT_AUTH_PREFIX}:oauth-consume-lock:`))).toHaveLength(0);
    first.destroy();
    second.destroy();
  });

  it('deletes an exact stale flow when start, callback, and persisted auth epochs differ', async () => {
    const store = new Map<string, string>();
    const replaceState = vi.fn();
    const location = {
      href: 'http://localhost:4173/login',
      origin: 'http://localhost:4173',
    };
    vi.stubGlobal('window', {
      location,
      history: { state: { route: 'login' }, replaceState },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('document', { title: 'Epoch Callback' });
    vi.stubGlobal('localStorage', createEnumerableStorageMock(store));
    const authRefresh = vi.fn();
    const tm = new TokenManager('http://localhost:8688');
    const auth = new AuthClient(
      new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: new ContextManager() }),
      tm,
      {} as any,
      { authRefresh } as any,
    );
    const start = await auth.signInWithOAuth('google', { navigate: false });
    const nonce = new URL(start.url).searchParams.get('oauth_recovery_nonce')!;
    // Simulate an older bundle signing out: it advances the shared epoch but
    // does not know the new per-flow key to delete it.
    store.set(`${DEFAULT_AUTH_PREFIX}:auth-epoch`, '1');
    location.href = `http://localhost:4173/auth/callback#access_token=raw&refresh_token=raw-refresh&oauth_recovery_nonce=${nonce}`;

    await expect(auth.handleOAuthCallback()).resolves.toBeNull();

    expect(authRefresh).not.toHaveBeenCalled();
    expect(readPendingOAuthRecord(store, nonce)).toBeNull();
    expect(replaceState).toHaveBeenCalledWith(
      { route: 'login' },
      'Epoch Callback',
      '/auth/callback',
    );
    tm.destroy();
  });

  it('falls back to a clean location replacement and stops before storage or network', async () => {
    const store = new Map<string, string>();
    const replace = vi.fn();
    const location = {
      href: 'http://localhost:4173/login',
      origin: 'http://localhost:4173',
      replace,
    };
    vi.stubGlobal('window', {
      location,
      history: { state: { route: 'login' }, replaceState: vi.fn(() => { throw new Error('blocked'); }) },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('document', { title: 'Fallback Callback' });
    vi.stubGlobal('localStorage', createEnumerableStorageMock(store));
    const authRefresh = vi.fn();
    const tm = new TokenManager('http://localhost:8688');
    const auth = new AuthClient(
      new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: new ContextManager() }),
      tm,
      {} as any,
      { authRefresh } as any,
    );
    const start = await auth.signInWithOAuth('google', { navigate: false });
    const nonce = new URL(start.url).searchParams.get('oauth_recovery_nonce')!;
    location.href = `http://localhost:4173/auth/callback?keep=1#access_token=raw&refresh_token=raw-refresh&oauth_recovery_nonce=${nonce}&state=keep`;

    await expect(auth.handleOAuthCallback()).resolves.toBeNull();

    expect(replace).toHaveBeenCalledWith('/auth/callback?keep=1#state=keep');
    expect(readPendingOAuthRecord(store, nonce)).not.toBeNull();
    expect(authRefresh).not.toHaveBeenCalled();
    tm.destroy();
  });

  it('surfaces an explicit error when both callback URL scrub mechanisms fail', async () => {
    const store = new Map<string, string>();
    const location = {
      href: 'http://localhost:4173/auth/callback#access_token=raw',
      origin: 'http://localhost:4173',
      replace: vi.fn(() => { throw new Error('replace blocked'); }),
    };
    vi.stubGlobal('window', {
      location,
      history: { state: null, replaceState: vi.fn(() => { throw new Error('history blocked'); }) },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('document', { title: 'Blocked Callback' });
    vi.stubGlobal('localStorage', createEnumerableStorageMock(store));
    const tm = new TokenManager('http://localhost:8688');
    const auth = new AuthClient(
      new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: new ContextManager() }),
      tm,
      {} as any,
      {} as any,
    );

    await expect(auth.handleOAuthCallback()).rejects.toMatchObject({
      slug: 'oauth-callback-scrub-failed',
    });
    tm.destroy();
  });

  it('fails closed after scrubbing when exact pending-record removal fails', async () => {
    const store = new Map<string, string>();
    let failPendingRemoval = false;
    const baseStorage = createEnumerableStorageMock(store);
    const storage = {
      ...baseStorage,
      get length() { return store.size; },
      removeItem: (key: string) => {
        if (failPendingRemoval && key.startsWith(pendingOAuthPrefix)) {
          throw new Error('storage removal failed');
        }
        store.delete(key);
      },
    };
    const replaceState = vi.fn();
    const location = { href: 'http://localhost:4173/login', origin: 'http://localhost:4173' };
    vi.stubGlobal('window', {
      location,
      history: { state: { safe: true }, replaceState },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('document', { title: 'Storage Failure Callback' });
    vi.stubGlobal('localStorage', storage);
    const authRefresh = vi.fn();
    const tm = new TokenManager('http://localhost:8688');
    const auth = new AuthClient(
      new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: new ContextManager() }),
      tm,
      {} as any,
      { authRefresh } as any,
    );
    const start = await auth.signInWithOAuth('google', { navigate: false });
    const nonce = new URL(start.url).searchParams.get('oauth_recovery_nonce')!;
    const callbackUrl = `http://localhost:4173/auth/callback#access_token=raw&refresh_token=raw-refresh&oauth_recovery_nonce=${nonce}`;
    location.href = callbackUrl;
    failPendingRemoval = true;

    await expect(auth.handleOAuthCallback()).resolves.toBeNull();

    expect(replaceState).toHaveBeenCalledWith(
      { safe: true },
      'Storage Failure Callback',
      '/auth/callback',
    );
    expect(authRefresh).not.toHaveBeenCalled();

    failPendingRemoval = false;
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 11_000);
    location.href = callbackUrl;
    await expect(auth.handleOAuthCallback()).resolves.toBeNull();
    expect(authRefresh).not.toHaveBeenCalled();
    tm.destroy();
  });

  it('adopts no partial session when refresh-token persistence fails after scrub', async () => {
    const store = new Map<string, string>();
    let failRefreshPersistence = false;
    const baseStorage = createEnumerableStorageMock(store);
    const storage = {
      ...baseStorage,
      get length() { return store.size; },
      setItem: (key: string, value: string) => {
        if (failRefreshPersistence && key === `${DEFAULT_AUTH_PREFIX}:refresh-token`) {
          throw new Error('refresh token persistence failed');
        }
        store.set(key, value);
      },
    };
    const replaceState = vi.fn();
    const location = { href: 'http://localhost:4173/login', origin: 'http://localhost:4173' };
    vi.stubGlobal('window', {
      location,
      history: { state: { safe: true }, replaceState },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('document', { title: 'Persistence Failure Callback' });
    vi.stubGlobal('localStorage', storage);
    const validatedAccess = makeValidJwt('must-not-be-adopted');
    const validatedRefresh = makeValidJwt('must-not-be-adopted');
    const authRefresh = vi.fn().mockResolvedValue({
      user: { id: 'must-not-be-adopted' },
      accessToken: validatedAccess,
      refreshToken: validatedRefresh,
    });
    const tm = new TokenManager('http://localhost:8688');
    const auth = new AuthClient(
      new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: new ContextManager() }),
      tm,
      {} as any,
      { authRefresh } as any,
    );
    const start = await auth.signInWithOAuth('google', { navigate: false });
    const nonce = new URL(start.url).searchParams.get('oauth_recovery_nonce')!;
    location.href = `http://localhost:4173/auth/callback#access_token=raw&refresh_token=raw-refresh&oauth_recovery_nonce=${nonce}`;
    failRefreshPersistence = true;

    await expect(auth.handleOAuthCallback()).rejects.toMatchObject({
      slug: 'auth-session-persist-failed',
    });

    expect(replaceState).toHaveBeenCalledWith(
      { safe: true },
      'Persistence Failure Callback',
      '/auth/callback',
    );
    expect(authRefresh).toHaveBeenCalledTimes(1);
    expect(auth.currentUser).toBeNull();
    expect(tm.getRefreshToken()).toBeNull();
    tm.destroy();
  });

  it('retains a verified completion ticket in memory and sends no request when ticket persistence fails', async () => {
    const store = new Map<string, string>();
    let failCompletionPersistence = false;
    const storage = createEnumerableStorageMock(store);
    vi.stubGlobal('window', {
      location: { href: 'http://localhost:4173/login', origin: 'http://localhost:4173' },
      history: { replaceState: vi.fn() },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('localStorage', {
      ...storage,
      get length() { return store.size; },
      setItem: (key: string, value: string) => {
        if (failCompletionPersistence && key.startsWith(pendingOAuthCompletionPrefix)) {
          throw new Error('completion persistence failed');
        }
        store.set(key, value);
      },
    });
    const tm = new TokenManager('http://localhost:8688');
    const http = new HttpClient({
      baseUrl: 'http://localhost:8688',
      tokenManager: tm,
      contextManager: new ContextManager(),
    });
    const result = {
      user: { id: 'ticket-retry-user' },
      accessToken: makeValidJwt('ticket-retry-user'),
      refreshToken: makeValidJwt('ticket-retry-user'),
    };
    const exchange = vi.spyOn(http, 'postPublic').mockResolvedValue(result);
    const auth = new AuthClient(http, tm, {} as any, {} as any);
    const start = await auth.signInWithOAuth('google', { navigate: false });
    const nonce = new URL(start.url).searchParams.get('oauth_recovery_nonce')!;
    const ticket = 'a1'.repeat(32);
    failCompletionPersistence = true;

    await expect(auth.handleOAuthCallback(
      `http://localhost:4173/auth/callback#oauth_exchange_ticket=${ticket}&oauth_recovery_nonce=${nonce}`,
    )).rejects.toMatchObject({ slug: 'oauth-completion-persist-failed' });

    expect(exchange).not.toHaveBeenCalled();
    expect(tm.getPendingOAuthCompletion()).toMatchObject({ ticket, recoveryNonce: nonce });

    failCompletionPersistence = false;
    await expect(auth.handleOAuthCallback('http://localhost:4173/auth/callback'))
      .resolves.toMatchObject({ user: { id: 'ticket-retry-user' } });
    expect(exchange).toHaveBeenCalledTimes(1);
    expect(tm.getPendingOAuthCompletion()).toBeNull();
    tm.destroy();
  });

  it('retries an exactly-once server result when local refresh-token persistence fails', async () => {
    const store = new Map<string, string>();
    let failRefreshPersistence = false;
    const storage = createEnumerableStorageMock(store);
    vi.stubGlobal('window', {
      location: { href: 'http://localhost:4173/login', origin: 'http://localhost:4173' },
      history: { replaceState: vi.fn() },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('localStorage', {
      ...storage,
      get length() { return store.size; },
      setItem: (key: string, value: string) => {
        if (failRefreshPersistence && key === `${DEFAULT_AUTH_PREFIX}:refresh-token`) {
          throw new Error('refresh persistence failed');
        }
        store.set(key, value);
      },
    });
    const tm = new TokenManager('http://localhost:8688');
    const http = new HttpClient({
      baseUrl: 'http://localhost:8688',
      tokenManager: tm,
      contextManager: new ContextManager(),
    });
    const result = {
      user: { id: 'cached-completion-user' },
      accessToken: makeValidJwt('cached-completion-user'),
      refreshToken: makeValidJwt('cached-completion-user'),
    };
    const exchange = vi.spyOn(http, 'postPublic').mockResolvedValue(result);
    const auth = new AuthClient(http, tm, {} as any, {} as any);
    const start = await auth.signInWithOAuth('google', { navigate: false });
    const nonce = new URL(start.url).searchParams.get('oauth_recovery_nonce')!;
    const ticket = 'b2'.repeat(32);
    failRefreshPersistence = true;

    await expect(auth.handleOAuthCallback(
      `http://localhost:4173/auth/callback#oauth_exchange_ticket=${ticket}&oauth_recovery_nonce=${nonce}`,
    )).rejects.toMatchObject({ slug: 'auth-session-persist-failed' });
    expect(auth.currentUser).toBeNull();
    expect(tm.getPendingOAuthCompletion()).toMatchObject({ ticket });

    failRefreshPersistence = false;
    await expect(auth.handleOAuthCallback('http://localhost:4173/auth/callback'))
      .resolves.toMatchObject({ user: { id: 'cached-completion-user' } });
    expect(exchange).toHaveBeenCalledTimes(2);
    expect(exchange.mock.calls.map((call) => call[1])).toEqual([
      { ticket, oauthRecoveryNonce: nonce },
      { ticket, oauthRecoveryNonce: nonce },
    ]);
    expect(auth.currentUser?.id).toBe('cached-completion-user');
    tm.destroy();
  });

  it('uses a last-start winner for simultaneous completion tickets and leaves no reload adoption', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      location: { href: 'http://localhost:4173/login', origin: 'http://localhost:4173' },
      history: { replaceState: vi.fn() },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('localStorage', createEnumerableStorageMock(store));
    const tm = new TokenManager('http://localhost:8688');
    const http = new HttpClient({
      baseUrl: 'http://localhost:8688',
      tokenManager: tm,
      contextManager: new ContextManager(),
    });
    const ticketA = 'c3'.repeat(32);
    const ticketB = 'd4'.repeat(32);
    let resolveA!: (value: unknown) => void;
    const exchange = vi.spyOn(http, 'postPublic').mockImplementation(async (_path, body) => {
      const requestedTicket = (body as { ticket?: string }).ticket;
      if (requestedTicket === ticketA) {
        return await new Promise((resolve) => { resolveA = resolve; });
      }
      return {
        user: { id: 'winner-b' },
        accessToken: makeValidJwt('winner-b'),
        refreshToken: makeValidJwt('winner-b'),
      };
    });
    const auth = new AuthClient(http, tm, {} as any, {} as any);
    const startA = await auth.signInWithOAuth('google', { navigate: false });
    const startB = await auth.signInWithOAuth('github', { navigate: false });
    const nonceA = new URL(startA.url).searchParams.get('oauth_recovery_nonce')!;
    const nonceB = new URL(startB.url).searchParams.get('oauth_recovery_nonce')!;

    const callbackA = auth.handleOAuthCallback(
      `http://localhost:4173/auth/callback#oauth_exchange_ticket=${ticketA}&oauth_recovery_nonce=${nonceA}`,
    );
    await vi.waitFor(() => expect(exchange).toHaveBeenCalledTimes(1));
    const callbackB = auth.handleOAuthCallback(
      `http://localhost:4173/auth/callback#oauth_exchange_ticket=${ticketB}&oauth_recovery_nonce=${nonceB}`,
    );
    await vi.waitFor(() => expect(store.get(`${DEFAULT_AUTH_PREFIX}:auth-epoch`)).toBe('2'));
    resolveA({
      user: { id: 'superseded-a' },
      accessToken: makeValidJwt('superseded-a'),
      refreshToken: makeValidJwt('superseded-a'),
    });

    await expect(callbackA).resolves.toBeNull();
    await expect(callbackB).resolves.toMatchObject({ user: { id: 'winner-b' } });
    expect(exchange.mock.calls.map((call) => (call[1] as { ticket: string }).ticket))
      .toEqual([ticketA, ticketB]);
    expect(auth.currentUser?.id).toBe('winner-b');
    expect([...store.keys()].filter((key) => key.startsWith(pendingOAuthCompletionPrefix)))
      .toHaveLength(0);

    tm.destroy();
    const reloaded = new TokenManager('http://localhost:8688');
    const reloadedHttp = new HttpClient({
      baseUrl: 'http://localhost:8688',
      tokenManager: reloaded,
      contextManager: new ContextManager(),
    });
    const lateExchange = vi.spyOn(reloadedHttp, 'postPublic');
    const reloadedAuth = new AuthClient(reloadedHttp, reloaded, {} as any, {} as any);
    await Promise.resolve();
    expect(reloadedAuth.currentUser?.id).toBe('winner-b');
    expect(lateExchange).not.toHaveBeenCalled();
    reloaded.destroy();
  });

  it('clears only the new nonce when sign-in or link navigation assignment throws', async () => {
    const store = new Map<string, string>();
    let currentHref = 'http://localhost:4173/settings';
    const location = {
      origin: 'http://localhost:4173',
      get href() { return currentHref; },
      set href(_value: string) { throw new Error('navigation blocked'); },
    };
    vi.stubGlobal('window', {
      location,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('localStorage', createEnumerableStorageMock(store));
    const tm = new TokenManager('http://localhost:8688');
    const oauthLinkStart = vi.fn().mockResolvedValue({ redirectUrl: 'https://provider.example/authorize' });
    const auth = new AuthClient(
      new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: new ContextManager() }),
      tm,
      { oauthLinkStart } as any,
      {} as any,
    );

    await expect(auth.signInWithOAuth('google')).rejects.toThrow('navigation blocked');
    expect(pendingOAuthKeys(store)).toHaveLength(0);
    currentHref = 'http://localhost:4173/settings';
    await expect(auth.linkWithOAuth('github')).rejects.toThrow('navigation blocked');
    expect(pendingOAuthKeys(store)).toHaveLength(0);
    tm.destroy();
  });

  it('does not apply a body OAuth refresh that sign-out supersedes in flight', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      location: { href: 'http://localhost:4173/login', origin: 'http://localhost:4173' },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
    let resolveOAuthRefresh!: (value: unknown) => void;
    const authRefresh = vi.fn(() => new Promise((resolve) => {
      resolveOAuthRefresh = resolve;
    }));
    const authSignout = vi.fn().mockResolvedValue({ ok: true });
    const tm = new TokenManager('http://localhost:8688');
    const existingRefresh = makeValidJwt('existing-session', {
      exp: Math.floor(Date.now() / 1000) + 7200,
    });
    tm.setTokens({
      accessToken: makeValidJwt('existing-session'),
      refreshToken: existingRefresh,
    });
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm, { authSignout } as any, { authRefresh } as any);
    const start = await auth.signInWithOAuth('google', { navigate: false });
    const nonce = new URL(start.url).searchParams.get('oauth_recovery_nonce')!;
    const callbackPromise = auth.handleOAuthCallback(
      `http://localhost:4173/auth/callback#access_token=returned-access&refresh_token=returned-refresh&oauth_recovery_nonce=${nonce}`,
    );
    await vi.waitFor(() => expect(authRefresh).toHaveBeenCalledTimes(1));

    const signOut = auth.signOut();
    expect(pendingOAuthKeys(store)).toHaveLength(0);
    resolveOAuthRefresh({
      user: { id: 'late-oauth-user' },
      accessToken: makeValidJwt('late-oauth-user'),
      refreshToken: makeValidJwt('late-oauth-user'),
    });

    await expect(callbackPromise).resolves.toBeNull();
    await signOut;
    expect(authSignout).toHaveBeenCalledWith({ refreshToken: existingRefresh });
    expect(auth.currentUser).toBeNull();
    expect(tm.getRefreshToken()).toBeNull();
    tm.destroy();
  });

  it('does not apply a body OAuth refresh after a peer tab signs out', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      location: { href: 'http://localhost:4173/login', origin: 'http://localhost:4173' },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel as unknown as typeof BroadcastChannel);
    let resolveOAuthRefresh!: (value: unknown) => void;
    const authRefresh = vi.fn(() => new Promise((resolve) => {
      resolveOAuthRefresh = resolve;
    }));
    const leader = new TokenManager('http://localhost:8688');
    const follower = new TokenManager('http://localhost:8688');
    follower.setTokens({
      accessToken: makeValidJwt('shared-session'),
      refreshToken: makeValidJwt('shared-session'),
    });
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: follower, contextManager: cm });
    const auth = new AuthClient(http, follower, {} as any, { authRefresh } as any);
    const start = await auth.signInWithOAuth('google', { navigate: false });
    const nonce = new URL(start.url).searchParams.get('oauth_recovery_nonce')!;
    const callbackPromise = auth.handleOAuthCallback(
      `http://localhost:4173/auth/callback#access_token=returned-access&refresh_token=returned-refresh&oauth_recovery_nonce=${nonce}`,
    );
    await vi.waitFor(() => expect(authRefresh).toHaveBeenCalledTimes(1));

    leader.clearTokens();
    resolveOAuthRefresh({
      user: { id: 'late-peer-oauth' },
      accessToken: makeValidJwt('late-peer-oauth'),
      refreshToken: makeValidJwt('late-peer-oauth'),
    });

    await expect(callbackPromise).resolves.toBeNull();
    expect(auth.currentUser).toBeNull();
    expect(pendingOAuthKeys(store)).toHaveLength(0);
    leader.destroy();
    follower.destroy();
  });

  it('signInWithPhone forwards explicit captchaToken', async () => {
    const corePublic = {
      authSigninPhone: vi.fn().mockResolvedValue({}),
    };
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm, {} as any, corePublic as any);

    await auth.signInWithPhone({
      phone: '+821012345678',
      captchaToken: 'captcha-token-123',
    });

    expect(corePublic.authSigninPhone).toHaveBeenCalledWith({
      phone: '+821012345678',
      captchaToken: 'captcha-token-123',
    });
    tm.destroy();
  });

  it('refreshes a rotated CAPTCHA site key and retries an automatic auth request once', async () => {
    installBrowserMocks();
    const origin = `https://captcha-transition-${crypto.randomUUID()}.example`;
    const configFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ captcha: { siteKey: 'old-site-key' } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ captcha: { siteKey: 'new-site-key' } })));
    vi.stubGlobal('fetch', configFetch);

    const renderedSiteKeys: string[] = [];
    (globalThis.window as Window & typeof globalThis & { turnstile: NonNullable<Window['turnstile']> }).turnstile = {
      render: vi.fn((_container, options) => {
        renderedSiteKeys.push(options.sitekey);
        queueMicrotask(() => options.callback?.(`${options.sitekey}-token`));
        return `widget-${renderedSiteKeys.length}`;
      }),
      remove: vi.fn(),
      reset: vi.fn(),
    };
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({
        style: { cssText: '', display: '' },
        appendChild: vi.fn(),
        remove: vi.fn(),
      })),
      body: { appendChild: vi.fn() },
    });

    const captchaRejected = new EdgeBaseError(
      403,
      'Captcha verification failed.',
      { captcha_required: true } as never,
    );
    const corePublic = {
      authSigninPhone: vi.fn()
        .mockRejectedValueOnce(captchaRejected)
        .mockResolvedValueOnce({}),
    };
    const tm = new TokenManager(origin);
    const http = new HttpClient({
      baseUrl: origin,
      tokenManager: tm,
      contextManager: new ContextManager(),
    });
    const auth = new AuthClient(http, tm, {} as never, corePublic as never);

    await auth.signInWithPhone({ phone: '+821055501234' });

    expect(renderedSiteKeys).toEqual(['old-site-key', 'new-site-key']);
    expect(configFetch).toHaveBeenCalledTimes(2);
    expect(corePublic.authSigninPhone).toHaveBeenNthCalledWith(1, {
      phone: '+821055501234',
      captchaToken: 'old-site-key-token',
    });
    expect(corePublic.authSigninPhone).toHaveBeenNthCalledWith(2, {
      phone: '+821055501234',
      captchaToken: 'new-site-key-token',
    });
    tm.destroy();
  });

  it('never replays an explicit CAPTCHA token after a CAPTCHA rejection', async () => {
    const captchaRejected = new EdgeBaseError(
      403,
      'Captcha verification failed.',
      { captcha_required: true } as never,
    );
    const corePublic = {
      authSigninPhone: vi.fn().mockRejectedValue(captchaRejected),
    };
    const tm = new TokenManager('http://localhost:8688');
    const http = new HttpClient({
      baseUrl: 'http://localhost:8688',
      tokenManager: tm,
      contextManager: new ContextManager(),
    });
    const auth = new AuthClient(http, tm, {} as never, corePublic as never);

    await expect(auth.signInWithPhone({
      phone: '+821055501234',
      captchaToken: 'caller-owned-single-use-token',
    })).rejects.toBe(captchaRejected);
    expect(corePublic.authSigninPhone).toHaveBeenCalledOnce();
    tm.destroy();
  });

  it('verifyLinkPhone adopts an anonymous-upgrade replacement session and preserves permanent void', async () => {
    installBrowserMocks();
    const tm = new TokenManager('http://localhost:8688');
    const http = new HttpClient({
      baseUrl: 'http://localhost:8688',
      tokenManager: tm,
      contextManager: new ContextManager(),
    });
    const upgraded = {
      user: { id: 'web-phone-upgraded', isAnonymous: false },
      accessToken: makeValidJwt('web-phone-upgraded', { isAnonymous: false }),
      refreshToken: makeValidJwt('web-phone-upgraded', { isAnonymous: false }),
    };
    const core = {
      authVerifyLinkPhone: vi.fn()
        .mockResolvedValueOnce(upgraded)
        .mockResolvedValueOnce({ ok: true }),
    };
    const auth = new AuthClient(http, tm, core as any, {} as any);

    await expect(auth.verifyLinkPhone({ phone: '+821012345678', code: '123456' }))
      .resolves.toMatchObject({ user: { id: 'web-phone-upgraded' } });
    expect(auth.currentUser?.id).toBe('web-phone-upgraded');
    expect(tm.getRefreshToken()).toBe(upgraded.refreshToken);
    await expect(auth.verifyLinkPhone({ phone: '+821012345678', code: '654321' }))
      .resolves.toBeUndefined();
    expect(auth.currentUser?.id).toBe('web-phone-upgraded');
    tm.destroy();
  });

  it('linkWithEmail preserves the initiating session after response loss and adopts the exact recovered pair', async () => {
    installBrowserMocks();
    const tm = new TokenManager('http://localhost:8688');
    const initiatingRefreshToken = makeValidJwt('web-anonymous-email', {
      isAnonymous: true,
      exp: Math.floor(Date.now() / 1000) + 7_200,
    });
    tm.setTokens({
      accessToken: makeValidJwt('web-anonymous-email', { isAnonymous: true }),
      refreshToken: initiatingRefreshToken,
    });
    const http = new HttpClient({
      baseUrl: 'http://localhost:8688',
      tokenManager: tm,
      contextManager: new ContextManager(),
    });
    const recovered = {
      user: { id: 'web-email-recovered', email: 'recovered@example.com', isAnonymous: false },
      accessToken: makeValidJwt('web-email-recovered', { isAnonymous: false }),
      refreshToken: makeValidJwt('web-email-recovered', {
        isAnonymous: false,
        exp: Math.floor(Date.now() / 1000) + 7_200,
      }),
      sessionId: 'web-email-recovered-session',
    };
    const core = {
      authLinkEmail: vi.fn()
        .mockRejectedValueOnce(new Error('response lost after commit'))
        .mockResolvedValueOnce(recovered),
    };
    const auth = new AuthClient(http, tm, core as any, {} as any);
    const input = { email: 'Recovered@Example.com', password: 'EmailRecovery1234!' };

    await expect(auth.linkWithEmail(input)).rejects.toThrow('response lost after commit');
    expect(auth.currentUser?.id).toBe('web-anonymous-email');
    expect(tm.getRefreshToken()).toBe(initiatingRefreshToken);
    await expect(auth.linkWithEmail(input)).resolves.toEqual(recovered);
    expect(core.authLinkEmail).toHaveBeenNthCalledWith(1, input);
    expect(core.authLinkEmail).toHaveBeenNthCalledWith(2, input);
    expect(auth.currentUser?.id).toBe('web-email-recovered');
    expect(tm.getRefreshToken()).toBe(recovered.refreshToken);
    tm.destroy();
  });

  it('linkWithEmail adopts a recovered HttpOnly-cookie session without exposing its refresh credential', async () => {
    installBrowserMocks();
    const tm = new TokenManager('http://localhost:8688', {
      refreshTokenTransport: 'httpOnlyCookie',
    });
    tm.setTokens({
      accessToken: makeValidJwt('web-anonymous-email-cookie', { isAnonymous: true }),
      refreshToken: '',
    });
    const http = new HttpClient({
      baseUrl: 'http://localhost:8688',
      tokenManager: tm,
      contextManager: new ContextManager(),
      refreshTokenTransport: 'httpOnlyCookie',
    });
    const recovered = {
      user: { id: 'web-email-cookie-recovered', email: 'cookie@example.com', isAnonymous: false },
      accessToken: makeValidJwt('web-email-cookie-recovered', { isAnonymous: false }),
      sessionId: 'web-email-cookie-recovered-session',
      sessionTransport: 'cookie' as const,
    };
    const core = { authLinkEmail: vi.fn().mockResolvedValue(recovered) };
    const auth = new AuthClient(http, tm, core as any, {} as any);

    await expect(auth.linkWithEmail({
      email: 'cookie@example.com',
      password: 'CookieRecovery1234!',
    })).resolves.toMatchObject({
      user: { id: 'web-email-cookie-recovered' },
      refreshToken: '',
      sessionTransport: 'cookie',
    });
    expect(auth.currentUser?.id).toBe('web-email-cookie-recovered');
    expect(tm.getRefreshToken()).toBeNull();
    tm.destroy();
  });

  it('verifyLinkPhone adopts the exact replacement session when a response-loss retry recovers it', async () => {
    installBrowserMocks();
    const tm = new TokenManager('http://localhost:8688');
    tm.setTokens({
      accessToken: makeValidJwt('web-anonymous-phone', { isAnonymous: true }),
      refreshToken: 'web-anonymous-phone-refresh',
    });
    const http = new HttpClient({
      baseUrl: 'http://localhost:8688',
      tokenManager: tm,
      contextManager: new ContextManager(),
    });
    const recovered = {
      user: { id: 'web-phone-recovered', isAnonymous: false },
      accessToken: makeValidJwt('web-phone-recovered', { isAnonymous: false }),
      refreshToken: 'web-phone-recovered-refresh',
      sessionId: 'web-phone-recovered-session',
    };
    const core = {
      authVerifyLinkPhone: vi.fn()
        .mockRejectedValueOnce(new Error('response lost after commit'))
        .mockResolvedValueOnce(recovered),
    };
    const auth = new AuthClient(http, tm, core as any, {} as any);
    const input = { phone: '+821066666666', code: '777777' };

    await expect(auth.verifyLinkPhone(input)).rejects.toThrow('response lost after commit');
    await expect(auth.verifyLinkPhone(input)).resolves.toEqual(recovered);
    expect(core.authVerifyLinkPhone).toHaveBeenNthCalledWith(1, input);
    expect(core.authVerifyLinkPhone).toHaveBeenNthCalledWith(2, input);
    expect(auth.currentUser?.id).toBe('web-phone-recovered');
    expect(tm.getRefreshToken()).toBe(recovered.refreshToken);
    tm.destroy();
  });

  it('verifyLinkPhone adopts an anonymous-upgrade session carried by HttpOnly cookie transport', async () => {
    installBrowserMocks();
    const tm = new TokenManager('http://localhost:8688', {
      refreshTokenTransport: 'httpOnlyCookie',
    });
    const http = new HttpClient({
      baseUrl: 'http://localhost:8688',
      tokenManager: tm,
      contextManager: new ContextManager(),
      refreshTokenTransport: 'httpOnlyCookie',
    });
    const cookieResult = {
      ok: true,
      user: { id: 'web-phone-cookie-upgrade', isAnonymous: false },
      accessToken: makeValidJwt('web-phone-cookie-upgrade', {
        isAnonymous: false,
        sid: 'web-phone-cookie-session',
      }),
      sessionId: 'web-phone-cookie-session',
      sessionTransport: 'cookie',
    };
    const core = { authVerifyLinkPhone: vi.fn().mockResolvedValue(cookieResult) };
    const auth = new AuthClient(http, tm, core as any, {} as any);

    await expect(auth.verifyLinkPhone({ phone: '+821088888888', code: '999999' }))
      .resolves.toMatchObject({
        user: { id: 'web-phone-cookie-upgrade' },
        refreshToken: '',
        sessionTransport: 'cookie',
      });
    expect(auth.currentUser?.id).toBe('web-phone-cookie-upgrade');
    expect(tm.getRefreshToken()).toBeNull();
    tm.destroy();
  });

  it('handleOAuthCallback persists tokens and scrubs callback params from browser URL', async () => {
    const accessToken = makeValidJwt('oauth-user', { displayName: 'OAuth User' });
    const refreshToken = makeValidJwt('oauth-user', {
      exp: Math.floor(Date.now() / 1000) + 7200,
    });
    const replaceState = vi.fn();
    const store = new Map<string, string>();

    vi.stubGlobal('window', {
      location: {
        href: `http://localhost:4173/auth/callback?access_token=${encodeURIComponent(accessToken)}&refresh_token=${encodeURIComponent(refreshToken)}`,
        origin: 'http://localhost:4173',
      },
      history: { state: { route: 'callback-shell' }, replaceState },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });
    vi.stubGlobal('document', { title: 'OAuth Callback Test' });

    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const corePublic = {
      authRefresh: vi.fn().mockResolvedValue({
        user: { id: 'oauth-user', displayName: 'OAuth User' },
        accessToken,
        refreshToken,
      }),
    };
    const auth = new AuthClient(http, tm, {} as any, corePublic as any);

    const firstStart = await auth.signInWithOAuth('google', { navigate: false });
    const firstNonce = new URL(firstStart.url).searchParams.get('oauth_recovery_nonce')!;
    // An unrelated background refresh while a popup/redirect is in flight must
    // not cancel the nonce that the OAuth server already stored.
    tm.setTokens({
      accessToken: makeValidJwt('existing-session'),
      refreshToken: makeValidJwt('existing-session'),
    });
    expect(tm.hasPendingOAuthRecovery()).toBe(true);
    (window as unknown as { location: { href: string } }).location.href =
      `http://localhost:4173/auth/callback?access_token=${encodeURIComponent(accessToken)}&refresh_token=${encodeURIComponent(refreshToken)}&oauth_recovery_nonce=${firstNonce}`;
    const result = await auth.handleOAuthCallback();

    expect(result?.accessToken).toBe(accessToken);
    expect(result?.refreshToken).toBe(refreshToken);
    expect(result?.user.id).toBe('oauth-user');
    expect(auth.currentUser?.id).toBe('oauth-user');
    expect(auth.currentUser?.displayName).toBe('OAuth User');
    expect(tm.getRefreshToken()).toBe(refreshToken);
    expect(replaceState).toHaveBeenCalledWith(
      { route: 'callback-shell' },
      'OAuth Callback Test',
      '/auth/callback',
    );

    const secondStart = await auth.signInWithOAuth('google', { navigate: false });
    const secondNonce = new URL(secondStart.url).searchParams.get('oauth_recovery_nonce')!;
    (window as unknown as { location: { href: string } }).location.href =
      `http://localhost:4173/auth/callback?keep=query&access_token=query-stale#access_token=${encodeURIComponent(accessToken)}&refresh_token=${encodeURIComponent(refreshToken)}&oauth_recovery_nonce=${secondNonce}&state=keep-fragment`;
    const fragmentResult = await auth.handleOAuthCallback(window.location.href);

    expect(fragmentResult?.accessToken).toBe(accessToken);
    expect(fragmentResult?.refreshToken).toBe(refreshToken);
    expect(replaceState).toHaveBeenLastCalledWith(
      { route: 'callback-shell' },
      'OAuth Callback Test',
      '/auth/callback?keep=query#state=keep-fragment',
    );
    expect(corePublic.authRefresh).toHaveBeenCalledTimes(2);
    tm.destroy();
  });

  it('rejects unsolicited, nonce-mismatched, replayed, and server-rejected OAuth callback credentials', async () => {
    const attackerAccessToken = makeValidJwt('attacker');
    const attackerRefreshToken = makeValidJwt('attacker', {
      exp: Math.floor(Date.now() / 1000) + 7200,
    });
    const legitimateAccessToken = makeValidJwt('legitimate-user');
    const legitimateRefreshToken = makeValidJwt('legitimate-user', {
      exp: Math.floor(Date.now() / 1000) + 7200,
    });
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      location: {
        href: `http://localhost:4173/auth/callback?access_token=${attackerAccessToken}&refresh_token=${attackerRefreshToken}`,
        origin: 'http://localhost:4173',
      },
      history: { replaceState: vi.fn() },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('document', { title: 'OAuth Callback Test' });
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
    const corePublic = {
      authRefresh: vi.fn().mockResolvedValue({
        user: { id: 'legitimate-user' },
        accessToken: legitimateAccessToken,
        refreshToken: legitimateRefreshToken,
      }),
    };
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm, {} as any, corePublic as any);

    await expect(auth.handleOAuthCallback()).resolves.toBeNull();
    expect(corePublic.authRefresh).not.toHaveBeenCalled();
    expect(auth.currentUser).toBeNull();

    const boundStart = await auth.signInWithOAuth('google', { navigate: false });
    const legitimateNonce = new URL(boundStart.url).searchParams.get('oauth_recovery_nonce')!;
    const wrongNonce = legitimateNonce === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64);
    (window as unknown as { location: { href: string } }).location.href =
      `http://localhost:4173/auth/callback?access_token=${attackerAccessToken}&refresh_token=${attackerRefreshToken}&oauth_recovery_nonce=${wrongNonce}`;
    await expect(auth.handleOAuthCallback()).resolves.toBeNull();
    expect(corePublic.authRefresh).not.toHaveBeenCalled();
    expect(auth.currentUser).toBeNull();
    expect(tm.getRefreshToken()).toBeNull();
    expect(tm.hasPendingOAuthRecovery()).toBe(true);

    // The mismatched callback cannot cancel the legitimate flow.
    (window as unknown as { location: { href: string } }).location.href =
      `http://localhost:4173/auth/callback?access_token=${legitimateAccessToken}&refresh_token=${legitimateRefreshToken}&oauth_recovery_nonce=${legitimateNonce}`;
    await expect(auth.handleOAuthCallback()).resolves.toMatchObject({
      user: { id: 'legitimate-user' },
    });
    expect(corePublic.authRefresh).toHaveBeenCalledTimes(1);
    expect(corePublic.authRefresh).toHaveBeenCalledWith({ refreshToken: legitimateRefreshToken });
    expect(tm.hasPendingOAuthRecovery()).toBe(false);

    await expect(auth.handleOAuthCallback()).resolves.toBeNull();
    expect(corePublic.authRefresh).toHaveBeenCalledTimes(1);

    // A correctly bound callback still adopts nothing if the server rejects
    // its rotating refresh credential, and that failed exchange is one-shot.
    const rejectedStart = await auth.signInWithOAuth('google', { navigate: false });
    const rejectedNonce = new URL(rejectedStart.url).searchParams.get('oauth_recovery_nonce')!;
    corePublic.authRefresh.mockRejectedValueOnce(new Error('invalid refresh token'));
    (window as unknown as { location: { href: string } }).location.href =
      `http://localhost:4173/auth/callback?access_token=${attackerAccessToken}&refresh_token=${attackerRefreshToken}&oauth_recovery_nonce=${rejectedNonce}`;
    await expect(auth.handleOAuthCallback()).resolves.toBeNull();
    expect(corePublic.authRefresh).toHaveBeenCalledTimes(2);
    expect(corePublic.authRefresh).toHaveBeenLastCalledWith({ refreshToken: attackerRefreshToken });
    await expect(auth.handleOAuthCallback()).resolves.toBeNull();
    expect(corePublic.authRefresh).toHaveBeenCalledTimes(2);
    expect(auth.currentUser?.id).toBe('legitimate-user');
    tm.destroy();
  });

  it('keeps unrelated flows on missing/malformed callbacks and consumes a matched provider error', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      location: {
        href: 'http://localhost:4173/auth/callback',
        origin: 'http://localhost:4173',
      },
      history: { replaceState: vi.fn() },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal('document', { title: 'OAuth Callback Test' });
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
    const corePublic = { authRefresh: vi.fn() };
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const auth = new AuthClient(http, tm, {} as any, corePublic as any);

    const firstStart = await auth.signInWithOAuth('google', { navigate: false });
    const firstNonce = new URL(firstStart.url).searchParams.get('oauth_recovery_nonce')!;
    expect(tm.hasPendingOAuthRecovery()).toBe(true);
    await expect(auth.handleOAuthCallback()).resolves.toBeNull();
    expect(tm.hasPendingOAuthRecovery()).toBe(true);

    const secondStart = await auth.signInWithOAuth('google', { navigate: false });
    const secondNonce = new URL(secondStart.url).searchParams.get('oauth_recovery_nonce')!;
    expect(tm.hasPendingOAuthRecovery()).toBe(true);
    await expect(auth.handleOAuthCallback('http://[')).resolves.toBeNull();
    expect(tm.hasPendingOAuthRecovery()).toBe(true);

    const errorStart = await auth.signInWithOAuth('google', { navigate: false });
    const errorNonce = new URL(errorStart.url).searchParams.get('oauth_recovery_nonce')!;
    (window as unknown as { location: { href: string } }).location.href =
      `http://localhost:4173/auth/callback?keep=query#error=access_denied&error_description=Denied&oauth_recovery_nonce=${errorNonce}`;
    await expect(auth.handleOAuthCallback()).resolves.toBeNull();
    expect(tm.hasPendingOAuthRecovery()).toBe(true);
    expect(pendingOAuthNonces(store).sort()).toEqual([firstNonce, secondNonce].sort());
    expect(window.history.replaceState).toHaveBeenLastCalledWith(
      undefined,
      'OAuth Callback Test',
      '/auth/callback?keep=query',
    );
    expect(corePublic.authRefresh).not.toHaveBeenCalled();
    tm.destroy();
  });
});

describe('AuthClient — profile state sync', () => {
  it('updateProfile applies accessToken-only responses and keeps UTF-8 display names', async () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const initialToken = makeValidJwt('u-profile', { email: 'profile@test.com' });
    tm.setTokens({ accessToken: initialToken, refreshToken: initialToken });

    const updatedToken = makeJwt({
      sub: 'u-profile',
      email: 'profile@test.com',
      displayName: '준강',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const core = {
      authUpdateProfile: vi.fn().mockResolvedValue({
        user: {
          id: 'u-profile',
          email: 'profile@test.com',
          displayName: '준강',
          avatarUrl: 'https://example.com/avatar.png',
          emailVisibility: 'private',
        },
        accessToken: updatedToken,
      }),
    };
    const auth = new AuthClient(http, tm, core as any, {} as any);

    const user = await auth.updateProfile({ displayName: '준강' });

    expect(core.authUpdateProfile).toHaveBeenCalledWith({ displayName: '준강' });
    expect(user.displayName).toBe('준강');
    expect(user.avatarUrl).toBe('https://example.com/avatar.png');
    expect(auth.currentUser?.displayName).toBe('준강');
    expect(auth.currentUser?.avatarUrl).toBe('https://example.com/avatar.png');
    tm.destroy();
  });

  it('updateProfile applies user-only responses for non-token fields', async () => {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const initialToken = makeValidJwt('u-avatar', { email: 'avatar@test.com', displayName: 'Avatar User' });
    tm.setTokens({ accessToken: initialToken, refreshToken: initialToken });

    const core = {
      authUpdateProfile: vi.fn().mockResolvedValue({
        user: {
          id: 'u-avatar',
          email: 'avatar@test.com',
          displayName: 'Avatar User',
          avatarUrl: 'https://example.com/fresh-avatar.png',
        },
      }),
    };
    const auth = new AuthClient(http, tm, core as any, {} as any);

    const user = await auth.updateProfile({ avatarUrl: 'https://example.com/fresh-avatar.png' });

    expect(user.avatarUrl).toBe('https://example.com/fresh-avatar.png');
    expect(auth.currentUser?.avatarUrl).toBe('https://example.com/fresh-avatar.png');
    tm.destroy();
  });
});

// ─── J. RoomClient — construction & properties ──────────────────────────────

function createConnectedRoom(roomId = 'room-1') {
  const tm = new TokenManager('http://localhost:8688');
  tm.setTokens({
    accessToken: makeValidJwt(`room-${roomId}`),
    refreshToken: makeValidJwt(`room-${roomId}`),
  });
  const room = new RoomClient('http://localhost:8688', 'default', roomId, tm);
  const send = vi.fn();
  const close = vi.fn();

  (room as any).ws = { send, close, readyState: 1 } as WebSocket;
  (room as any).connected = true;
  (room as any).authenticated = true;

  return { room, tm, send, close };
}

describe('RoomClient — construction', () => {
  it('creation with roomId', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'test-room', tm);
    expect(room.roomId).toBe('test-room');
    tm.destroy();
  });

  it('initial shared state is empty object (v2: getSharedState)', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'room-1', tm);
    expect(room.getSharedState()).toEqual({});
    tm.destroy();
  });

  it('initial player state is empty object (v2: getPlayerState)', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'room-1', tm);
    expect(room.getPlayerState()).toEqual({});
    tm.destroy();
  });

  it('namespace is stored (v2: namespace + roomId identification)', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'game', 'room-1', tm);
    expect(room.namespace).toBe('game');
    tm.destroy();
  });

  it('getSharedState returns a snapshot (not a reference)', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'room-1', tm);
    const s1 = room.getSharedState();
    const s2 = room.getSharedState();
    expect(s1).toEqual(s2);
    expect(s1).not.toBe(s2); // different object references
    tm.destroy();
  });

  it('getPlayerState returns a snapshot (not a reference)', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'room-1', tm);
    const p1 = room.getPlayerState();
    const p2 = room.getPlayerState();
    expect(p1).toEqual(p2);
    expect(p1).not.toBe(p2); // different object references
    tm.destroy();
  });

  it('reconnects a pending join after auth arrives later', async () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'room-1', tm);
    const establishConnection = vi.fn().mockResolvedValue(undefined);

    (room as any).joinRequested = true;
    (room as any).establishConnection = establishConnection;

    tm.setTokens({
      accessToken: makeValidJwt('room-user'),
      refreshToken: makeValidJwt('room-user'),
    });

    await Promise.resolve();

    expect(establishConnection).toHaveBeenCalledTimes(1);
    tm.destroy();
  });

  it('reuses an in-flight room join when join() is called twice', async () => {
    const tm = new TokenManager('http://localhost:8688');
    tm.setTokens({
      accessToken: makeValidJwt('room-flight'),
      refreshToken: makeValidJwt('room-flight'),
    });
    const room = new RoomClient('http://localhost:8688', 'default', 'room-1', tm);
    let resolveConnection: (() => void) | undefined;
    const establishConnection = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveConnection = resolve;
        }),
    );

    (room as any).establishConnection = establishConnection;

    const first = room.join();
    const second = room.join();

    expect(establishConnection).toHaveBeenCalledTimes(1);

    resolveConnection?.();
    await Promise.all([first, second]);
    tm.destroy();
  });

  it('preserves reconnect backoff until the room receives an authoritative sync', async () => {
    class TestWebSocket {
      static latest: TestWebSocket | null = null;
      readyState = 0;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      send = vi.fn();

      constructor() {
        TestWebSocket.latest = this;
      }

      close(code = 1000, reason = '') {
        this.readyState = 3;
        this.onclose?.({ code, reason } as CloseEvent);
      }
    }
    vi.stubGlobal('WebSocket', TestWebSocket as unknown as typeof WebSocket);

    const tm = new TokenManager('http://localhost:8688');
    tm.setTokens({
      accessToken: makeValidJwt('room-backoff'),
      refreshToken: makeValidJwt('room-backoff'),
    });
    const room = new RoomClient('http://localhost:8688', 'default', 'room-backoff', tm);
    (room as any).reconnectAttempts = 3;
    (room as any).reconnectInfo = { attempt: 3 };

    const joining = room.join();
    const socket = TestWebSocket.latest;
    expect(socket).not.toBeNull();
    socket!.readyState = 1;
    socket!.onopen?.({} as Event);
    await vi.waitFor(() => expect(socket!.send).toHaveBeenCalled());
    socket!.onmessage?.({
      data: JSON.stringify({
        type: 'auth_success',
        userId: 'room-backoff',
        connectionId: 'conn-1',
      }),
    } as MessageEvent);
    await joining;

    // A proxy can accept the upgrade and still drop auth/join immediately.
    // That transport open must not restart the retry loop at one second.
    expect((room as any).reconnectAttempts).toBe(3);

    socket!.onmessage?.({
      data: JSON.stringify({
        type: 'sync',
        sharedState: {},
        sharedVersion: 1,
        playerState: {},
        playerVersion: 1,
      }),
    } as MessageEvent);
    expect((room as any).reconnectAttempts).toBe(0);

    room.destroy();
    tm.destroy();
  });

  it('does not start a second room connection while a socket is already connecting', async () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'room-1', tm);
    const establishConnection = vi.fn().mockResolvedValue(undefined);

    (room as any).joinRequested = true;
    (room as any).ws = { readyState: 0 } as WebSocket;
    (room as any).establishConnection = establishConnection;

    tm.setTokens({
      accessToken: makeValidJwt('room-connecting'),
      refreshToken: makeValidJwt('room-connecting'),
    });

    await Promise.resolve();

    expect(establishConnection).not.toHaveBeenCalled();
    tm.destroy();
  });

  it('refreshes the access token before room auth when only a refresh token is cached', async () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'room-1', tm);
    const nextAccessToken = makeValidJwt('room-refresh-user');
    const nextRefreshToken = makeValidJwt('room-refresh-user', { exp: Math.floor(Date.now() / 1000) + 7200 });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        accessToken: nextAccessToken,
        refreshToken: nextRefreshToken,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const send = vi.fn();
    const ws = {
      send,
      onmessage: null as ((event: MessageEvent) => void) | null,
      readyState: 1,
    } as unknown as WebSocket;

    tm.setTokens({
      accessToken: makeValidJwt('room-refresh-user'),
      refreshToken: makeValidJwt('room-refresh-user', { exp: Math.floor(Date.now() / 1000) + 7200 }),
    });
    (tm as any).accessToken = null;
    (room as any).ws = ws;
    (room as any).connected = true;

    const authPromise = (room as any).authenticate();
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1);
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:8688/api/auth/refresh',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(send).toHaveBeenCalledWith(JSON.stringify({ type: 'auth', token: nextAccessToken }));

    ws.onmessage?.({ data: JSON.stringify({ type: 'auth_success' }) } as MessageEvent);
    await authPromise;

    fetchSpy.mockRestore();
    tm.destroy();
  });

  it('supports anonymous room auth payloads when no access token exists', async () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'room-share', tm, {
      authPayload: {
        type: 'anonymous',
        subject: 'share:session-1',
        role: 'share_viewer',
        isAnonymous: true,
        meta: {
          roomShareToken: 'share-token-1',
        },
      },
    });
    const ws = {
      send: vi.fn(),
      onmessage: null as ((event: MessageEvent) => void) | null,
      readyState: 1,
    } as unknown as WebSocket;
    (room as any).ws = ws;
    (room as any).connected = true;

    const authPromise = (room as any).authenticate();
    await vi.waitFor(() => {
      expect(ws.send).toHaveBeenCalledTimes(1);
    });

    expect(ws.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'auth',
        token: null,
        authPayload: {
          type: 'anonymous',
          subject: 'share:session-1',
          role: 'share_viewer',
          isAnonymous: true,
          meta: {
            roomShareToken: 'share-token-1',
          },
        },
      }),
    );

    ws.onmessage?.({
      data: JSON.stringify({ type: 'auth_success', userId: 'share:session-1', connectionId: 'conn-1' }),
    } as MessageEvent);
    await authPromise;

    expect((room as any).authenticated).toBe(true);
    expect((room as any).joined).toBe(true);
    expect((room as any).currentUserId).toBe('share:session-1');
    tm.destroy();
  });

  it('keeps idle state when anonymous room auth payload is configured without a signed-in user', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'room-share', tm, {
      authPayload: {
        type: 'anonymous',
        subject: 'share:session-2',
      },
    });
    expect(room.getConnectionState()).toBe('idle');
    tm.destroy();
  });

  it('handles auth success that arrives in the same tick as the auth send', async () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'room-1', tm);
    const originalOnMessage = vi.fn();
    const ws = {
      onmessage: originalOnMessage as ((event: MessageEvent) => void) | null,
      readyState: 1,
      send: vi.fn((raw: string) => {
        const message = JSON.parse(raw) as Record<string, unknown>;
        if (message.type === 'auth') {
          expect(message).toMatchObject({ type: 'auth', token: expect.any(String) });
          ws.onmessage?.({ data: JSON.stringify({ type: 'auth_success' }) } as MessageEvent);
        }
      }),
    } as unknown as WebSocket;

    tm.setTokens({
      accessToken: makeValidJwt('room-race-user'),
      refreshToken: makeValidJwt('room-race-user'),
    });
    (room as any).ws = ws;
    (room as any).connected = true;

    await (room as any).authenticate();

    expect(originalOnMessage).not.toHaveBeenCalled();
    expect((room as any).authenticated).toBe(true);
    expect((room as any).joined).toBe(true);
    tm.destroy();
  });

  it('onSharedState emits fresh snapshots after shared deltas', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'room-1', tm);
    const handler = vi.fn();

    room.onSharedState(handler);

    (room as any).handleMessage(
      JSON.stringify({
        type: 'sync',
        sharedState: { readyCount: 0 },
        sharedVersion: 1,
        playerState: {},
        playerVersion: 0,
      }),
    );
    (room as any).handleMessage(
      JSON.stringify({
        type: 'shared_delta',
        delta: { readyCount: 1 },
        version: 2,
      }),
    );

    const firstState = handler.mock.calls[0]?.[0];
    const secondState = handler.mock.calls[1]?.[0];

    expect(firstState).toEqual({ readyCount: 0 });
    expect(secondState).toEqual({ readyCount: 1 });
    expect(secondState).not.toBe(firstState);
    tm.destroy();
  });

  it('onPlayerState emits fresh snapshots after player deltas', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'room-1', tm);
    const handler = vi.fn();

    room.onPlayerState(handler);

    (room as any).handleMessage(
      JSON.stringify({
        type: 'sync',
        sharedState: {},
        sharedVersion: 0,
        playerState: { ready: false },
        playerVersion: 1,
      }),
    );
    (room as any).handleMessage(
      JSON.stringify({
        type: 'player_delta',
        delta: { ready: true },
        version: 2,
      }),
    );

    const firstState = handler.mock.calls[0]?.[0];
    const secondState = handler.mock.calls[1]?.[0];

    expect(firstState).toEqual({ ready: false });
    expect(secondState).toEqual({ ready: true });
    expect(secondState).not.toBe(firstState);
    tm.destroy();
  });
});

describe('RoomClient — method signatures', () => {
  it('join is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'r1', tm);
    expect(typeof room.join).toBe('function');
    tm.destroy();
  });

  it('leave is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'r1', tm);
    expect(typeof room.leave).toBe('function');
    tm.destroy();
  });

  it('leave closes the socket with the explicit room leave code', () => {
    vi.useFakeTimers();
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'r1', tm);
    const send = vi.fn();
    const close = vi.fn();

    (room as any).ws = { close, send, readyState: 1 };
    (room as any).connected = true;
    room.leave();

    expect(send).toHaveBeenCalledWith(JSON.stringify({ type: 'leave' }));
    expect(close).toHaveBeenCalledWith(4005, 'Client left room');
    tm.destroy();
    vi.useRealTimers();
  });

  it('leave does not send after the socket has started closing', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'r1', tm);
    const send = vi.fn();
    const close = vi.fn();

    (room as any).ws = { close, send, readyState: 2 };
    (room as any).connected = true;
    room.leave();

    expect(send).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledWith(4005, 'Client left room');
    tm.destroy();
  });

  it.each([
    {
      name: 'action',
      invoke: (room: RoomClient) => room.send('SAVE'),
      pendingMap: 'pendingRequests',
    },
    {
      name: 'signal',
      invoke: (room: RoomClient) => room.signals.send('cursor'),
      pendingMap: 'pendingSignalRequests',
    },
    {
      name: 'member state',
      invoke: (room: RoomClient) => room.members.setState({ editing: true }),
      pendingMap: 'pendingMemberStateRequests',
    },
    {
      name: 'admin operation',
      invoke: (room: RoomClient) => room.admin.kick('member-1'),
      pendingMap: 'pendingAdminRequests',
    },
  ])('$name rejects immediately when the socket is closing', async ({ invoke, pendingMap }) => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'r1', tm, {
      sendTimeout: 60_000,
    });
    const send = vi.fn();

    (room as any).ws = { close: vi.fn(), send, readyState: 2 };
    (room as any).connected = true;
    (room as any).authenticated = true;

    await expect(invoke(room)).rejects.toThrow(/Room connection required/);
    expect(send).not.toHaveBeenCalled();
    expect((room as any)[pendingMap].size).toBe(0);
    tm.destroy();
  });

  it.each([
    {
      name: 'action',
      invoke: (room: RoomClient) => room.send('SAVE'),
      pendingMap: 'pendingRequests',
    },
    {
      name: 'signal',
      invoke: (room: RoomClient) => room.signals.send('cursor'),
      pendingMap: 'pendingSignalRequests',
    },
    {
      name: 'member state',
      invoke: (room: RoomClient) => room.members.setState({ editing: true }),
      pendingMap: 'pendingMemberStateRequests',
    },
    {
      name: 'admin operation',
      invoke: (room: RoomClient) => room.admin.kick('member-1'),
      pendingMap: 'pendingAdminRequests',
    },
  ])('$name clears its pending request when the socket closes during send', async ({ invoke, pendingMap }) => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'r1', tm, {
      sendTimeout: 60_000,
    });
    const send = vi.fn();
    let readyStateReads = 0;
    const socket = {
      close: vi.fn(),
      send,
      get readyState() {
        readyStateReads += 1;
        return readyStateReads === 1 ? 1 : 2;
      },
    };

    (room as any).ws = socket;
    (room as any).connected = true;
    (room as any).authenticated = true;

    await expect(invoke(room)).rejects.toThrow(/Room connection required/);
    expect(send).not.toHaveBeenCalled();
    expect((room as any)[pendingMap].size).toBe(0);
    tm.destroy();
  });

  it('send is a function (v2: replaces setState/patchState/sendAction)', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'r1', tm);
    expect(typeof room.send).toBe('function');
    tm.destroy();
  });

  it('getSharedState is a function (v2: read-only state accessor)', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'r1', tm);
    expect(typeof room.getSharedState).toBe('function');
    tm.destroy();
  });

  it('getPlayerState is a function (v2: per-player state accessor)', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'r1', tm);
    expect(typeof room.getPlayerState).toBe('function');
    tm.destroy();
  });

  it('onSharedState is a function (v2: replaces onSync)', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'r1', tm);
    expect(typeof room.onSharedState).toBe('function');
    tm.destroy();
  });

  it('onPlayerState is a function (v2: replaces onDelta)', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'r1', tm);
    expect(typeof room.onPlayerState).toBe('function');
    tm.destroy();
  });

  it('onMessage is a function (v2: replaces onEvent, type-specific)', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'r1', tm);
    expect(typeof room.onMessage).toBe('function');
    tm.destroy();
  });

  it('onAnyMessage is a function (v2: all messages regardless of type)', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'r1', tm);
    expect(typeof room.onAnyMessage).toBe('function');
    tm.destroy();
  });

  it('onError is a function', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'r1', tm);
    expect(typeof room.onError).toBe('function');
    tm.destroy();
  });

  it('onKicked is a function (v2: replaces onWarning)', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'r1', tm);
    expect(typeof room.onKicked).toBe('function');
    tm.destroy();
  });

  it('getMetadata is a function (v2: HTTP metadata without joining)', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'r1', tm);
    expect(typeof room.getMetadata).toBe('function');
    expect(typeof room.getSummary).toBe('function');
    expect(typeof room.checkConnection).toBe('function');
    tm.destroy();
  });
});

describe('RoomClient — rooms adapter APIs', () => {
  it('state/meta wrappers delegate to the underlying room methods', async () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'adapter-room', tm);
    const sendSpy = vi.spyOn(room, 'send').mockResolvedValue({ ok: true });
    const metadataSpy = vi.spyOn(room, 'getMetadata').mockResolvedValue({ stage: 'lobby' });
    const summarySpy = vi.spyOn(room, 'getSummary').mockResolvedValue({
      namespace: 'default',
      roomId: 'adapter-room',
      metadata: { stage: 'lobby' },
      occupancy: { activeMembers: 2, activeConnections: 3 },
      updatedAt: '2026-03-27T00:00:00.000Z',
    });

    (room as any)._sharedState = { score: 1 };
    (room as any)._playerState = { ready: true };

    expect(room.state.getShared()).toEqual({ score: 1 });
    expect(room.state.getMine()).toEqual({ ready: true });
    await expect(room.state.send('SET_READY', { ready: true })).resolves.toEqual({ ok: true });
    await expect(room.meta.get()).resolves.toEqual({ stage: 'lobby' });
    await expect(room.meta.summary()).resolves.toEqual({
      namespace: 'default',
      roomId: 'adapter-room',
      metadata: { stage: 'lobby' },
      occupancy: { activeMembers: 2, activeConnections: 3 },
      updatedAt: '2026-03-27T00:00:00.000Z',
    });

    expect(sendSpy).toHaveBeenCalledWith('SET_READY', { ready: true });
    expect(metadataSpy).toHaveBeenCalledTimes(1);
    expect(summarySpy).toHaveBeenCalledTimes(1);
    tm.destroy();
  });

  it('room summary and connect-check helpers call the expected public endpoints', async () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'adapter-room', tm);
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          namespace: 'default',
          roomId: 'adapter-room',
          metadata: { stage: 'lobby' },
          occupancy: { activeMembers: 2, activeConnections: 3 },
          updatedAt: '2026-03-27T00:00:00.000Z',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({
          ok: true,
          type: 'room_connect_ready',
          category: 'ready',
          message: 'Room WebSocket preflight passed',
          namespace: 'default',
          roomId: 'adapter-room',
          runtime: 'rooms',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    await expect(room.getSummary()).resolves.toEqual({
      namespace: 'default',
      roomId: 'adapter-room',
      metadata: { stage: 'lobby' },
      occupancy: { activeMembers: 2, activeConnections: 3 },
      updatedAt: '2026-03-27T00:00:00.000Z',
    });
    await expect(room.checkConnection()).resolves.toEqual({
      ok: true,
      type: 'room_connect_ready',
      category: 'ready',
      message: 'Room WebSocket preflight passed',
      namespace: 'default',
      roomId: 'adapter-room',
      runtime: 'rooms',
    });

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8688/api/room/summary?namespace=default&id=adapter-room',
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8688/api/room/connect-check?namespace=default&id=adapter-room',
    );
    tm.destroy();
  });

  it('room summary network failures explain which server was unreachable', async () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'adapter-room', tm);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8688'));

    await expect(room.getSummary()).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining('Failed to get room summary. Could not reach http://localhost:8688.'),
    });
    tm.destroy();
  });

  it('batch room summary helpers call the expected public endpoint', async () => {
    const { createClient } = await import('../../src/client.js');
    const client = createClient('http://localhost:8688');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        namespace: 'default',
        items: [
          {
            namespace: 'default',
            roomId: 'room-1',
            metadata: { stage: 'lobby' },
            occupancy: { activeMembers: 2, activeConnections: 3 },
            updatedAt: '2026-03-27T00:00:00.000Z',
          },
        ],
        deniedIds: ['room-2'],
        updatedAt: '2026-03-27T00:00:00.000Z',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(client.getRoomSummaries('default', ['room-1', 'room-2'])).resolves.toEqual({
      namespace: 'default',
      items: [
        {
          namespace: 'default',
          roomId: 'room-1',
          metadata: { stage: 'lobby' },
          occupancy: { activeMembers: 2, activeConnections: 3 },
          updatedAt: '2026-03-27T00:00:00.000Z',
        },
      ],
      deniedIds: ['room-2'],
      updatedAt: '2026-03-27T00:00:00.000Z',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:8688/api/room/summaries',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namespace: 'default', ids: ['room-1', 'room-2'] }),
      },
    );
    client.destroy();
  });

  it('connect-check reports incompatible payloads clearly', async () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'adapter-room', tm);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(room.checkConnection()).rejects.toMatchObject({
      status: 200,
      message: expect.stringContaining('may be out of sync'),
    });
    tm.destroy();
  });

  it('signals adapters send frames and fan out inbound signal events', async () => {
    const { room, tm, send } = createConnectedRoom('signals-room');
    const specificHandler = vi.fn();
    const anyHandler = vi.fn();

    room.signals.on('chat.ping', specificHandler);
    room.signals.onAny(anyHandler);

    (room as any).handleMessage(JSON.stringify({
      type: 'signal',
      event: 'chat.ping',
      payload: { body: 'hello' },
      meta: {
        memberId: 'member-2',
        userId: 'user-2',
        connectionId: 'conn-2',
        sentAt: 123,
      },
    }));

    expect(specificHandler).toHaveBeenCalledWith(
      { body: 'hello' },
      expect.objectContaining({
        memberId: 'member-2',
        userId: 'user-2',
        connectionId: 'conn-2',
        sentAt: 123,
      }),
    );
    expect(anyHandler).toHaveBeenCalledWith(
      'chat.ping',
      { body: 'hello' },
      expect.objectContaining({ memberId: 'member-2' }),
    );

    const sendPromise = room.signals.send('chat.announce', { body: 'broadcast' }, { includeSelf: true });
    const outbound = JSON.parse(send.mock.calls[0][0]) as Record<string, unknown>;
    expect(outbound).toMatchObject({
      type: 'signal',
      event: 'chat.announce',
      payload: { body: 'broadcast' },
      includeSelf: true,
    });

    (room as any).handleMessage(JSON.stringify({
      type: 'signal_sent',
      event: 'chat.announce',
      requestId: outbound.requestId,
    }));
    await sendPromise;

    const directPromise = room.signals.sendTo('member-2', 'chat.direct', { body: 'private' });
    const directOutbound = JSON.parse(send.mock.calls[1][0]) as Record<string, unknown>;
    expect(directOutbound).toMatchObject({
      type: 'signal',
      event: 'chat.direct',
      payload: { body: 'private' },
      memberId: 'member-2',
      includeSelf: false,
    });

    (room as any).handleMessage(JSON.stringify({
      type: 'signal_sent',
      event: 'chat.direct',
      requestId: directOutbound.requestId,
    }));
    await directPromise;
    tm.destroy();
  });

  it('treats generic NOT_AUTHENTICATED signal failures as auth loss and forces reconnect recovery', async () => {
    const { room, tm, send, close } = createConnectedRoom('signals-auth-loss');
    const states: string[] = [];
    room.session.onConnectionStateChange((state) => states.push(state));

    const sendPromise = room.signals.send('chat.announce', { body: 'broadcast' });
    const outbound = JSON.parse(send.mock.calls[0][0]) as Record<string, unknown>;
    expect(outbound.type).toBe('signal');

    (room as any).handleMessage(JSON.stringify({
      type: 'error',
      code: 'NOT_AUTHENTICATED',
      message: 'Authenticate first',
    }));

    await expect(sendPromise).rejects.toMatchObject({
      code: 401,
      message: 'Room authentication lost: Authenticate first',
    });
    expect(close).toHaveBeenCalledWith(4006, 'Room authentication lost: Authenticate first');
    expect(states).toContain('auth_lost');
    tm.destroy();
  });

  it('members adapters track sync/join/leave/state events with snapshot semantics', async () => {
    const { room, tm, send } = createConnectedRoom('members-room');
    const syncHandler = vi.fn();
    const joinHandler = vi.fn();
    const leaveHandler = vi.fn();
    const stateHandler = vi.fn();

    room.members.onSync(syncHandler);
    room.members.onJoin(joinHandler);
    room.members.onLeave(leaveHandler);
    room.members.onStateChange(stateHandler);

    (room as any).currentUserId = 'member-1';
    (room as any).handleMessage(JSON.stringify({
      type: 'members_sync',
      members: [
        {
          memberId: 'member-1',
          userId: 'member-1',
          connectionId: 'conn-1',
          connectionCount: 1,
          role: 'owner',
          state: { ready: true },
        },
      ],
    }));

    expect(syncHandler).toHaveBeenCalledWith([
      expect.objectContaining({
        memberId: 'member-1',
        state: { ready: true },
      }),
    ]);

    const listed = room.members.list();
    listed[0]!.state.ready = false;
    expect(room.members.list()).toEqual([
      expect.objectContaining({
        memberId: 'member-1',
        state: { ready: true },
      }),
    ]);

    (room as any).handleMessage(JSON.stringify({
      type: 'member_join',
      member: {
        memberId: 'member-2',
        userId: 'member-2',
        connectionId: 'conn-2',
        connectionCount: 1,
        state: { ready: false },
      },
    }));
    expect(joinHandler).toHaveBeenCalledWith(expect.objectContaining({ memberId: 'member-2' }));

    const setStatePromise = room.members.setState({ ready: false });
    const stateOutbound = JSON.parse(send.mock.calls[0][0]) as Record<string, unknown>;
    expect(stateOutbound).toMatchObject({
      type: 'member_state',
      state: { ready: false },
    });

    (room as any).handleMessage(JSON.stringify({
      type: 'member_state',
      requestId: stateOutbound.requestId,
      member: {
        memberId: 'member-1',
        userId: 'member-1',
        connectionId: 'conn-1',
        connectionCount: 1,
        state: { ready: false },
      },
      state: { ready: false },
    }));
    await setStatePromise;
    expect(stateHandler).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 'member-1', state: { ready: false } }),
      { ready: false },
    );

    const clearPromise = room.members.clearState();
    const clearOutbound = JSON.parse(send.mock.calls[1][0]) as Record<string, unknown>;
    expect(clearOutbound).toMatchObject({ type: 'member_state_clear' });

    (room as any).handleMessage(JSON.stringify({
      type: 'member_state',
      requestId: clearOutbound.requestId,
      member: {
        memberId: 'member-1',
        userId: 'member-1',
        connectionId: 'conn-1',
        connectionCount: 1,
        state: {},
      },
      state: {},
    }));
    await clearPromise;

    (room as any).handleMessage(JSON.stringify({
      type: 'member_leave',
      reason: 'timeout',
      member: {
        memberId: 'member-2',
        userId: 'member-2',
        connectionId: 'conn-2',
        connectionCount: 0,
        state: { ready: false },
      },
    }));
    expect(leaveHandler).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 'member-2' }),
      'timeout',
    );
    expect(room.members.list()).toEqual([
      expect.objectContaining({ memberId: 'member-1', state: {} }),
    ]);
    tm.destroy();
  });

  it('admin adapters send operations and resolve on admin_result', async () => {
    const { room, tm, send } = createConnectedRoom('admin-room');

    const kickPromise = room.admin.kick('member-2');
    const outbound = JSON.parse(send.mock.calls[0][0]) as Record<string, unknown>;
    expect(outbound).toMatchObject({
      type: 'admin',
      operation: 'kick',
      memberId: 'member-2',
      payload: {},
    });

    (room as any).handleMessage(JSON.stringify({
      type: 'admin_result',
      requestId: outbound.requestId,
    }));
    await kickPromise;
    tm.destroy();
  });

  it('session adapters emit connection state and reconnect callbacks', () => {
    vi.useFakeTimers();
    const { room, tm } = createConnectedRoom('session-room');
    const states: string[] = [];
    const reconnectHandler = vi.fn();

    room.session.onConnectionStateChange((state) => states.push(state));
    room.session.onReconnect(reconnectHandler);

    (room as any).setConnectionState('connecting');
    (room as any).scheduleReconnect();
    expect(states).toEqual(['connecting', 'reconnecting']);

    (room as any).handleMessage(JSON.stringify({
      type: 'sync',
      sharedState: {},
      sharedVersion: 1,
      playerState: {},
      playerVersion: 1,
    }));

    expect(states).toEqual(['connecting', 'reconnecting', 'connected']);
    expect(reconnectHandler).toHaveBeenCalledWith({ attempt: 1 });

    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    tm.destroy();
  });

  it('collab awareness uses namespaced member state and emits peer snapshots', async () => {
    const { room, tm, send } = createConnectedRoom('collab-awareness');
    (room as any).currentUserId = 'member-1';
    (room as any).currentConnectionId = 'conn-1';

    const collab = room.collab({ format: 'yjs', key: 'body' });
    const awarenessHandler = vi.fn();
    collab.awareness.onChange(awarenessHandler);

    (room as any).handleMessage(JSON.stringify({
      type: 'members_sync',
      members: [
        {
          memberId: 'member-1',
          userId: 'member-1',
          connectionId: 'conn-1',
          connectionCount: 1,
          role: 'owner',
          state: {
            __collab: {
              'yjs:body': { cursor: { line: 1 }, typing: true },
            },
          },
        },
        {
          memberId: 'member-2',
          userId: 'member-2',
          connectionId: 'conn-2',
          connectionCount: 1,
          role: 'member',
          state: {
            __collab: {
              'yjs:body': { cursor: { line: 2 }, typing: false },
            },
          },
        },
      ],
    }));

    expect(collab.awareness.getSelf()).toEqual(
      expect.objectContaining({
        memberId: 'member-1',
        isSelf: true,
        state: { cursor: { line: 1 }, typing: true },
      }),
    );
    expect(collab.awareness.getPeers()).toEqual([
      expect.objectContaining({
        memberId: 'member-2',
        isSelf: false,
        state: { cursor: { line: 2 }, typing: false },
      }),
    ]);
    expect(awarenessHandler).toHaveBeenCalledWith([
      expect.objectContaining({
        memberId: 'member-2',
        state: { cursor: { line: 2 }, typing: false },
      }),
    ]);

    const setLocalStatePromise = collab.awareness.setLocalState({ cursor: { line: 3 }, typing: true });
    const outbound = JSON.parse(send.mock.calls[0][0]) as Record<string, unknown>;
    expect(outbound).toMatchObject({
      type: 'member_state',
      state: {
        __collab: {
          'yjs:body': { cursor: { line: 3 }, typing: true },
        },
      },
    });

    (room as any).handleMessage(JSON.stringify({
      type: 'member_state',
      requestId: outbound.requestId,
      member: {
        memberId: 'member-1',
        userId: 'member-1',
        connectionId: 'conn-1',
        connectionCount: 1,
        role: 'owner',
        state: {
          __collab: {
            'yjs:body': { cursor: { line: 3 }, typing: true },
          },
        },
      },
      state: {
        __collab: {
          'yjs:body': { cursor: { line: 3 }, typing: true },
        },
      },
    }));
    await setLocalStatePromise;

    expect(collab.awareness.getSelf()).toEqual(
      expect.objectContaining({
        state: { cursor: { line: 3 }, typing: true },
      }),
    );
    tm.destroy();
  });

  it('collab status follows room connection state transitions', () => {
    const { room, tm } = createConnectedRoom('collab-status');
    const collab = room.collab({ format: 'yjs', key: 'body' });
    const statuses: string[] = [];

    collab.onStatusChange((status) => statuses.push(status));

    (room as any).setConnectionState('connecting');
    (room as any).setConnectionState('reconnecting');
    (room as any).setConnectionState('connected');
    (room as any).setConnectionState('auth_lost');

    expect(statuses).toEqual(['connecting', 'reconnecting', 'ready', 'degraded']);
    expect(collab.getStatus()).toBe('degraded');
    expect(collab.getMode()).toBe('editable');
    tm.destroy();
  });

  it('collab surfaces room reconnect attempts through the public API', () => {
    vi.useFakeTimers();
    const { room, tm } = createConnectedRoom('collab-reconnect');
    const collab = room.collab({ format: 'yjs', key: 'body' });
    const reconnectHandler = vi.fn();

    collab.onReconnect(reconnectHandler);

    (room as any).setConnectionState('connecting');
    (room as any).scheduleReconnect();

    expect(collab.getStatus()).toBe('reconnecting');

    (room as any).handleMessage(JSON.stringify({
      type: 'sync',
      sharedState: {},
      sharedVersion: 1,
      playerState: {},
      playerVersion: 1,
    }));

    expect(reconnectHandler).toHaveBeenCalledWith({ attempt: 1 });
    expect(collab.getStatus()).toBe('ready');
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    tm.destroy();
  });

  it('collab surfaces recovery failures from the room session', () => {
    vi.useFakeTimers();
    const tm = new TokenManager('http://localhost:8688');
    tm.setTokens({
      accessToken: makeValidJwt('room-collab-recovery'),
      refreshToken: makeValidJwt('room-collab-recovery'),
    });
    const room = new RoomClient('http://localhost:8688', 'default', 'collab-recovery', tm, {
      disconnectResetTimeoutMs: 25,
    });
    (room as any).ws = { send: vi.fn(), close: vi.fn(), readyState: 1 } as WebSocket;
    (room as any).connected = true;
    (room as any).authenticated = true;
    (room as any).joinRequested = true;

    const collab = room.collab({ format: 'yjs', key: 'body' });
    const recoveryHandler = vi.fn();
    collab.onRecoveryFailure(recoveryHandler);

    (room as any).setConnectionState('reconnecting');
    (room as any).scheduleDisconnectReset('reconnecting');
    vi.advanceTimersByTime(26);

    expect(recoveryHandler).toHaveBeenCalledWith({
      state: 'reconnecting',
      timeoutMs: 25,
    });
    vi.useRealTimers();
    tm.destroy();
  });

  it('collab exposes a yjs alias and explicit sync entrypoint', async () => {
    const { room, tm } = createConnectedRoom('collab-sync');
    (room as any).setConnectionState('connected');
    const collab = room.collab.yjs({ key: 'body' });
    const doc = {
      on: vi.fn(),
      off: vi.fn(),
    };

    collab.bind(doc as any);
    await expect(collab.sync()).resolves.toBeUndefined();

    expect(doc.on).toHaveBeenCalledWith('update', expect.any(Function));
    expect(collab.getStatus()).toBe('ready');
    tm.destroy();
  });

  it('collab mode and capability fingerprint follow collab member meta', () => {
    const { room, tm } = createConnectedRoom('collab-meta');
    (room as any).currentUserId = 'member-1';
    (room as any).currentConnectionId = 'conn-1';

    const collab = room.collab({ format: 'yjs', key: 'body', initialMode: 'editable' });
    const modes: string[] = [];
    const fingerprints: Array<string | null> = [];
    collab.onModeChange((mode) => modes.push(mode));
    collab.onCapabilityFingerprintChange((fingerprint) => fingerprints.push(fingerprint));

    (room as any).handleMessage(JSON.stringify({
      type: 'members_sync',
      members: [
        {
          memberId: 'member-1',
          userId: 'member-1',
          connectionId: 'conn-1',
          connectionCount: 1,
          role: 'owner',
          state: {
            __collab_meta: {
              'yjs:body': {
                mode: 'read_only',
                capabilityFingerprint: 'cap_v1_demo',
              },
            },
          },
        },
      ],
    }));

    expect(collab.getMode()).toBe('read_only');
    expect(collab.getCapabilityFingerprint()).toBe('cap_v1_demo');
    expect(modes).toEqual(['read_only']);
    expect(fingerprints).toEqual(['cap_v1_demo']);
    tm.destroy();
  });

  it('collab control signals override mode and capability fingerprint from the server', () => {
    const { room, tm } = createConnectedRoom('collab-control');
    const collab = room.collab({ format: 'yjs', key: 'body', initialMode: 'editable' });
    const modes: string[] = [];
    const fingerprints: Array<string | null> = [];

    collab.onModeChange((mode) => modes.push(mode));
    collab.onCapabilityFingerprintChange((fingerprint) => fingerprints.push(fingerprint));

    (room as any).handleMessage(JSON.stringify({
      type: 'signal',
      event: 'collab.control',
      payload: {
        format: 'yjs',
        key: 'body',
        mode: 'read_only',
        capabilityFingerprint: 'cap_live_v2',
      },
      meta: {
        memberId: 'server',
        userId: 'server',
        serverSent: true,
      },
    }));

    expect(collab.getMode()).toBe('read_only');
    expect(collab.getCapabilityFingerprint()).toBe('cap_live_v2');
    expect(modes).toEqual(['read_only']);
    expect(fingerprints).toEqual(['cap_live_v2']);
    tm.destroy();
  });

  it('collab requests a durable server sync when server sync is advertised', async () => {
    const { room, tm, send } = createConnectedRoom('collab-server-sync');
    (room as any).setConnectionState('connected');
    const collab = room.collab({ format: 'yjs', key: 'body', initialMode: 'editable', syncTimeoutMs: 50 });
    const yjs = await import('yjs');
    const doc = new yjs.Doc();

    await collab.join();
    collab.bind(doc as any);

    (room as any).handleMessage(JSON.stringify({
      type: 'signal',
      event: 'collab.control',
      payload: {
        format: 'yjs',
        key: 'body',
        mode: 'editable',
        capabilityFingerprint: 'cap_sync_v1',
        serverSync: true,
      },
      meta: {
        memberId: 'server',
        userId: 'server',
        serverSent: true,
      },
    }));

    await Promise.resolve();
    await Promise.resolve();

    const outbound = JSON.parse(send.mock.calls[0][0]) as Record<string, any>;
    expect(outbound).toMatchObject({
      type: 'signal',
      event: 'collab.sync_request',
      payload: {
        format: 'yjs',
        key: 'body',
      },
    });

    const sourceDoc = new yjs.Doc();
    sourceDoc.getMap('page').set('title', 'Server durable state');
    const updateBase64 = Buffer.from(yjs.encodeStateAsUpdate(sourceDoc)).toString('base64');

    (room as any).handleMessage(JSON.stringify({
      type: 'signal',
      event: 'collab.sync_response',
      payload: {
        format: 'yjs',
        key: 'body',
        requestId: outbound.payload.requestId,
        update: updateBase64,
        syncSource: 'server_durable',
      },
      meta: {
        memberId: 'server',
        userId: 'server',
        serverSent: true,
      },
    }));

    await vi.waitFor(() => {
      expect(doc.getMap('page').get('title')).toBe('Server durable state');
      expect(collab.getStatus()).toBe('ready');
    });
    tm.destroy();
  });

  it('collab keeps waiting for peer live sync after a server durable baseline when peers exist', async () => {
    const { room, tm, send } = createConnectedRoom('collab-server-peer-sync');
    (room as any).setConnectionState('connected');
    const collab = room.collab({ format: 'yjs', key: 'body', initialMode: 'editable', syncTimeoutMs: 5000 });
    const yjs = await import('yjs');
    const doc = new yjs.Doc();

    (room as any).currentUserId = 'member-1';
    (room as any).currentConnectionId = 'conn-1';
    (room as any).handleMessage(JSON.stringify({
      type: 'members_sync',
      members: [
        {
          memberId: 'member-1',
          userId: 'member-1',
          connectionId: 'conn-1',
          connectionCount: 1,
          role: 'owner',
          state: {
            __collab: {
              'yjs:body': { cursor: { line: 1 } },
            },
          },
        },
        {
          memberId: 'member-2',
          userId: 'member-2',
          connectionId: 'conn-2',
          connectionCount: 1,
          role: 'member',
          state: {
            __collab: {
              'yjs:body': { cursor: { line: 2 } },
            },
          },
        },
      ],
    }));

    await collab.join();
    collab.bind(doc as any);

    (room as any).handleMessage(JSON.stringify({
      type: 'signal',
      event: 'collab.control',
      payload: {
        format: 'yjs',
        key: 'body',
        mode: 'editable',
        capabilityFingerprint: 'cap_sync_v2',
        serverSync: true,
      },
      meta: {
        memberId: 'server',
        userId: 'server',
        serverSent: true,
      },
    }));

    await Promise.resolve();
    await Promise.resolve();

    const outbound = JSON.parse(send.mock.calls[0][0]) as Record<string, any>;
    const requestId = outbound.payload.requestId as string;

    const serverDoc = new yjs.Doc();
    serverDoc.getMap('page').set('title', 'Server durable state');
    const serverUpdateBase64 = Buffer.from(yjs.encodeStateAsUpdate(serverDoc)).toString('base64');

    (room as any).handleMessage(JSON.stringify({
      type: 'signal',
      event: 'collab.sync_response',
      payload: {
        format: 'yjs',
        key: 'body',
        requestId,
        update: serverUpdateBase64,
        syncSource: 'server_durable',
      },
      meta: {
        memberId: 'server',
        userId: 'server',
        serverSent: true,
      },
    }));

    await vi.waitFor(() => {
      expect(doc.getMap('page').get('title')).toBe('Server durable state');
      expect(collab.getStatus()).toBe('syncing');
    });

    const peerDoc = new yjs.Doc();
    yjs.applyUpdate(peerDoc, yjs.encodeStateAsUpdate(serverDoc));
    peerDoc.getMap('page').set('title', 'Peer live state');
    const peerUpdateBase64 = Buffer.from(yjs.encodeStateAsUpdate(peerDoc)).toString('base64');

    (room as any).handleMessage(JSON.stringify({
      type: 'signal',
      event: 'collab.sync_response',
      payload: {
        format: 'yjs',
        key: 'body',
        requestId,
        update: peerUpdateBase64,
        syncSource: 'peer_live',
      },
      meta: {
        memberId: 'member-2',
        userId: 'member-2',
        serverSent: false,
      },
    }));

    await vi.waitFor(() => {
      expect(doc.getMap('page').get('title')).toBe('Peer live state');
      expect(collab.getStatus()).toBe('ready');
    });
    tm.destroy();
  });
});

describe('refreshAccessToken', () => {
  it('includes the refresh URL when the auth server is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8688'));

    await expect(refreshAccessToken('http://localhost:8688', 'refresh-token')).rejects.toMatchObject({
      status: 0,
      message: expect.stringContaining('Auth session refresh could not reach http://localhost:8688/api/auth/refresh'),
    });
  });

  it('explains when the refresh response is missing tokens', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ accessToken: 'only-access-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(refreshAccessToken('http://localhost:8688', 'refresh-token')).rejects.toMatchObject({
      status: 500,
      message: 'Auth refresh succeeded but did not return both accessToken and refreshToken. Check the server auth configuration.',
    });
  });
});

// ─── K. RoomClient — options defaults ────────────────────────────────────────

describe('RoomClient — options defaults', () => {
  it('custom options accepted', () => {
    const tm = new TokenManager('http://localhost:8688');
    const room = new RoomClient('http://localhost:8688', 'default', 'r-opts', tm, {
      autoReconnect: false,
      maxReconnectAttempts: 5,
      reconnectBaseDelay: 2000,
    });
    expect(room.roomId).toBe('r-opts');
    tm.destroy();
  });
});

// ─── L. matchesFilter ────────────────────────────────────────────────────────

describe('matchesFilter — client-side filtering', () => {
  it('== match', () => {
    expect(matchesFilter({ status: 'active' }, [['status', '==', 'active']])).toBe(true);
  });

  it('== mismatch', () => {
    expect(matchesFilter({ status: 'inactive' }, [['status', '==', 'active']])).toBe(false);
  });

  it('!= match', () => {
    expect(matchesFilter({ status: 'active' }, [['status', '!=', 'inactive']])).toBe(true);
  });

  it('!= mismatch', () => {
    expect(matchesFilter({ status: 'active' }, [['status', '!=', 'active']])).toBe(false);
  });

  it('> match', () => {
    expect(matchesFilter({ count: 10 }, [['count', '>', 5]])).toBe(true);
  });

  it('> mismatch', () => {
    expect(matchesFilter({ count: 3 }, [['count', '>', 5]])).toBe(false);
  });

  it('>= exact', () => {
    expect(matchesFilter({ count: 5 }, [['count', '>=', 5]])).toBe(true);
  });

  it('< match', () => {
    expect(matchesFilter({ count: 3 }, [['count', '<', 5]])).toBe(true);
  });

  it('<= exact', () => {
    expect(matchesFilter({ count: 5 }, [['count', '<=', 5]])).toBe(true);
  });

  it('contains match', () => {
    expect(matchesFilter({ title: 'Hello World' }, [['title', 'contains', 'World']])).toBe(true);
  });

  it('contains mismatch', () => {
    expect(matchesFilter({ title: 'Hello' }, [['title', 'contains', 'World']])).toBe(false);
  });

  it('contains-any match', () => {
    expect(matchesFilter({ tags: ['draft', 'featured'] }, [['tags', 'contains-any', ['archived', 'featured']]])).toBe(true);
  });

  it('contains-any mismatch', () => {
    expect(matchesFilter({ tags: ['draft', 'featured'] }, [['tags', 'contains-any', ['archived', 'private']]])).toBe(false);
  });

  it('in match', () => {
    expect(matchesFilter({ status: 'draft' }, [['status', 'in', ['draft', 'archived']]])).toBe(true);
  });

  it('in mismatch', () => {
    expect(matchesFilter({ status: 'published' }, [['status', 'in', ['draft', 'archived']]])).toBe(false);
  });

  it('not in match', () => {
    expect(matchesFilter({ status: 'published' }, [['status', 'not in', ['draft', 'archived']]])).toBe(true);
  });

  it('not in mismatch', () => {
    expect(matchesFilter({ status: 'draft' }, [['status', 'not in', ['draft', 'archived']]])).toBe(false);
  });

  it('multiple filters — AND logic', () => {
    const doc = { status: 'active', count: 10 };
    expect(matchesFilter(doc, [
      ['status', '==', 'active'],
      ['count', '>', 5],
    ])).toBe(true);
  });

  it('multiple filters — one fails', () => {
    const doc = { status: 'active', count: 2 };
    expect(matchesFilter(doc, [
      ['status', '==', 'active'],
      ['count', '>', 5],
    ])).toBe(false);
  });

  it('empty filter array → true', () => {
    expect(matchesFilter({ any: 'thing' }, [])).toBe(true);
  });

  it('missing field → false for ==', () => {
    expect(matchesFilter({}, [['status', '==', 'active']])).toBe(false);
  });

  it('unknown tuple operator fails closed instead of throwing', () => {
    expect(matchesFilter({ status: 'active' }, [['status', 'startsWith', 'act']])).toBe(false);
  });
});

// ─── M. ClientEdgeBase — construction ────────────────────────────────────────

describe('ClientEdgeBase (createClient) — construction', () => {
  // Need to import createClient
  it('createClient returns ClientEdgeBase', async () => {
    const { createClient } = await import('../../src/client.js');
    const client = createClient('http://localhost:8688');
    expect(client).toBeTruthy();
    expect(client.auth).toBeTruthy();
    expect(client.storage).toBeTruthy();
    client.destroy();
  });

  it('db() returns DbRef', async () => {
    const { createClient } = await import('../../src/client.js');
    const client = createClient('http://localhost:8688');
    const db = client.db('shared');
    expect(db).toBeTruthy();
    client.destroy();
  });

  it('db().table() wires matchesFilter for database-live query subscriptions', async () => {
    const { createClient } = await import('../../src/client.js');
    const client = createClient('http://localhost:8688');
    const table = client.db('shared').table('posts') as { filterMatchFn?: unknown };
    expect(typeof table.filterMatchFn).toBe('function');
    client.destroy();
  });

  it('db().table() uses DatabaseLiveClient for database-live subscriptions', async () => {
    const { createClient } = await import('../../src/client.js');
    const client = createClient('http://localhost:8688');
    const table = client.db('shared').table('posts') as { databaseLiveClient?: unknown };
    expect(table.databaseLiveClient).toBeTruthy();
    expect((table.databaseLiveClient as { constructor?: { name?: string } }).constructor?.name).toBe('DatabaseLiveClient');
    client.destroy();
  });

  it('DatabaseLiveClient builds /api/db/subscribe WebSocket URLs', async () => {
    const { DatabaseLiveClient } = await import('../../src/database-live.js');
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const live = new DatabaseLiveClient('http://localhost:8688', tm, undefined, cm) as { buildWsUrl: (channel: string) => string; disconnect: () => void };
    expect(live.buildWsUrl('dblive:shared:posts')).toBe(
      'ws://localhost:8688/api/db/subscribe?channel=dblive%3Ashared%3Aposts',
    );
    live.disconnect();
    tm.destroy();
  });

  it('DatabaseLiveClient only waits for auth when no session is available', async () => {
    installBrowserMocks();
    const { DatabaseLiveClient } = await import('../../src/database-live.js');
    const { EdgeBaseError } = await import('@edge-base/core');
    const channel = 'dblive:shared:posts';

    const tmNoSession = new TokenManager('http://localhost:8688');
    const liveNoSession = new DatabaseLiveClient('http://localhost:8688', tmNoSession) as {
      connectedChannels: Set<string>;
      disconnect: () => void;
      handleAuthenticationFailure: (error: unknown) => void;
      scheduleReconnect: (channel: string) => void;
      waitingForAuth: boolean;
      ws: WebSocket | null;
    };
    liveNoSession.connectedChannels.add(channel);
    liveNoSession.ws = { close: vi.fn() } as unknown as WebSocket;
    const noSessionReconnect = vi.spyOn(liveNoSession, 'scheduleReconnect');
    liveNoSession.handleAuthenticationFailure(new EdgeBaseError(401, 'Auth failed'));
    expect(liveNoSession.waitingForAuth).toBe(true);
    expect(noSessionReconnect).not.toHaveBeenCalled();
    liveNoSession.disconnect();
    tmNoSession.destroy();

    const tmWithSession = new TokenManager('http://localhost:8688');
    const token = makeValidJwt('u-db-live');
    tmWithSession.setTokens({ accessToken: token, refreshToken: token });
    const liveWithSession = new DatabaseLiveClient('http://localhost:8688', tmWithSession) as {
      connectedChannels: Set<string>;
      disconnect: () => void;
      handleAuthenticationFailure: (error: unknown) => void;
      scheduleReconnect: (channel: string) => void;
      waitingForAuth: boolean;
      ws: WebSocket | null;
    };
    liveWithSession.connectedChannels.add(channel);
    liveWithSession.ws = { close: vi.fn() } as unknown as WebSocket;
    const withSessionReconnect = vi.spyOn(liveWithSession, 'scheduleReconnect');
    liveWithSession.handleAuthenticationFailure(new EdgeBaseError(401, 'Auth failed'));
    expect(liveWithSession.waitingForAuth).toBe(false);
    expect(withSessionReconnect).not.toHaveBeenCalled();
    liveWithSession.disconnect();
    tmWithSession.destroy();
  });

  it('room() returns RoomClient (v2: namespace + roomId)', async () => {
    const { createClient } = await import('../../src/client.js');
    const client = createClient('http://localhost:8688');
    const room = client.room('default', 'test-room');
    expect(room).toBeInstanceOf(RoomClient);
    expect(room.namespace).toBe('default');
    expect(room.roomId).toBe('test-room');
    client.destroy();
  });

  it('push.getPermissionStatus returns valid status', async () => {
    const { createClient } = await import('../../src/client.js');
    const client = createClient('http://localhost:8688');
    const status = client.push.getPermissionStatus();
    expect(['granted', 'denied', 'notDetermined']).toContain(status);
    client.destroy();
  });

  it('push.requestPermission is a function', async () => {
    const { createClient } = await import('../../src/client.js');
    const client = createClient('http://localhost:8688');
    expect(typeof client.push.requestPermission).toBe('function');
    client.destroy();
  });

  it('push.getPermissionStatus returns notDetermined when Notification API unavailable', async () => {
    // In vitest (node) env, global.Notification is undefined
    const { createClient } = await import('../../src/client.js');
    const client = createClient('http://localhost:8688');
    const status = client.push.getPermissionStatus();
    // Without browser Notification API, should return 'notDetermined'
    expect(status).toBe('notDetermined');
    client.destroy();
  });

  it('push.setTokenProvider is a function', async () => {
    const { createClient } = await import('../../src/client.js');
    const client = createClient('http://localhost:8688');
    expect(typeof client.push.setTokenProvider).toBe('function');
    client.destroy();
  });

  it('push.register throws without tokenProvider', async () => {
    const { createClient } = await import('../../src/client.js');
    const client = createClient('http://localhost:8688');
    await expect(client.push.register()).rejects.toThrow('Token provider not set');
    client.destroy();
  });

  it('push registration is project-scoped and concurrent first registration is exactly once', async () => {
    const store = new Map<string, string>();
    const localStorage = createEnumerableStorageMock(store);
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      localStorage,
    });
    vi.stubGlobal('localStorage', localStorage);
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel as unknown as typeof BroadcastChannel);
    vi.stubGlobal('Notification', {
      permission: 'granted',
      requestPermission: vi.fn(async () => 'granted'),
    });
    let uuidCounter = 1;
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => `00000000-0000-4000-8000-${String(uuidCounter++).padStart(12, '0')}`),
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const { createClient } = await import('../../src/client.js');
    const clientA = createClient('https://push-a.example.com');
    const clientB = createClient('https://push-b.example.com');
    clientA.push.setTokenProvider(async () => 'same-browser-token');
    clientB.push.setTokenProvider(async () => 'same-browser-token');

    await Promise.all([clientA.push.register(), clientA.push.register()]);
    await clientB.push.register();

    const registerCalls = fetchMock.mock.calls.filter(([input]) =>
      new URL(String(input)).pathname === '/api/push/register');
    expect(registerCalls).toHaveLength(2);
    const registrations = registerCalls.map(([, init]) => JSON.parse(String(init?.body)) as {
      deviceId: string;
      token: string;
    });
    expect(registrations.map((registration) => registration.token)).toEqual([
      'same-browser-token',
      'same-browser-token',
    ]);
    expect(registrations[0].deviceId).not.toBe(registrations[1].deviceId);
    clientA.destroy();
    clientB.destroy();
  });

  it('push registration fails closed before network without a browser CSPRNG', async () => {
    const store = new Map<string, string>();
    const localStorage = createEnumerableStorageMock(store);
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), localStorage });
    vi.stubGlobal('localStorage', localStorage);
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel as unknown as typeof BroadcastChannel);
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn(async () => 'granted') });
    vi.stubGlobal('crypto', undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { createClient } = await import('../../src/client.js');
    const client = createClient('https://push-no-crypto.example.com');
    client.push.setTokenProvider(async () => 'push-token');

    await expect(client.push.register()).rejects.toThrow('Secure random generation is required');
    expect(fetchMock).not.toHaveBeenCalled();
    client.destroy();
  });

  it('signOut clears auth before network and clears push cache only after combined cleanup succeeds', async () => {
    const store = new Map<string, string>();
    const localStorage = createEnumerableStorageMock(store);
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), localStorage });
    vi.stubGlobal('localStorage', localStorage);
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel as unknown as typeof BroadcastChannel);
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn(async () => 'granted') });
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => '11111111-1111-4111-8111-111111111111'),
    });
    let resolveSignOut!: (response: Response) => void;
    const signOutResponse = new Promise<Response>((resolve) => {
      resolveSignOut = resolve;
    });
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname === '/api/push/register') {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (pathname === '/api/auth/signout') return signOutResponse;
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { createClient } = await import('../../src/client.js');
    const client = createClient('https://push-signout.example.com');
    const tokenManager = (client as unknown as { tokenManager: TokenManager }).tokenManager;
    tokenManager.setTokens({
      accessToken: makeValidJwt('push-signout-user'),
      refreshToken: 'push-signout-refresh',
    });
    client.push.setTokenProvider(async () => 'push-signout-token');
    await client.push.register();
    const cacheKey = `eb_push:${encodeURIComponent('https://push-signout.example.com')}:token_cache`;
    expect(store.has(cacheKey)).toBe(true);

    const signOut = client.auth.signOut();
    expect(tokenManager.currentAccessToken).toBeNull();
    expect(tokenManager.getRefreshToken()).toBeNull();
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some(([input]) => new URL(String(input)).pathname === '/api/auth/signout')).toBe(true);
    });
    const signOutCall = fetchMock.mock.calls.find(([input]) =>
      new URL(String(input)).pathname === '/api/auth/signout')!;
    expect(JSON.parse(String(signOutCall[1]?.body))).toEqual({
      refreshToken: 'push-signout-refresh',
      pushDeviceId: 'web-11111111-1111-4111-8111-111111111111',
    });
    expect(store.has(cacheKey)).toBe(true);

    resolveSignOut(new Response(JSON.stringify({ ok: true, pushUnregistered: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    await signOut;
    expect(store.has(cacheKey)).toBe(false);
    client.destroy();
  });

  it('signOut retains the push cache when combined server cleanup is not confirmed', async () => {
    const store = new Map<string, string>();
    const localStorage = createEnumerableStorageMock(store);
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), localStorage });
    vi.stubGlobal('localStorage', localStorage);
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel as unknown as typeof BroadcastChannel);
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn(async () => 'granted') });
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => '22222222-2222-4222-8222-222222222222') });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const pathname = new URL(String(input)).pathname;
      return new Response(JSON.stringify(pathname === '/api/auth/signout'
        ? { code: 503, message: 'push cleanup unavailable' }
        : { ok: true }), {
        status: pathname === '/api/auth/signout' ? 503 : 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));
    const { createClient } = await import('../../src/client.js');
    const client = createClient('https://push-signout-failure.example.com');
    const tokenManager = (client as unknown as { tokenManager: TokenManager }).tokenManager;
    tokenManager.setTokens({
      accessToken: makeValidJwt('push-signout-failure-user'),
      refreshToken: 'push-signout-failure-refresh',
    });
    client.push.setTokenProvider(async () => 'push-signout-failure-token');
    await client.push.register();
    const cacheKey = `eb_push:${encodeURIComponent('https://push-signout-failure.example.com')}:token_cache`;

    await expect(client.auth.signOut()).rejects.toMatchObject({ slug: 'signout-pending' });
    expect(tokenManager.currentAccessToken).toBeNull();
    expect(store.has(cacheKey)).toBe(true);
    client.destroy();
  });

  it('push.onMessage and onMessageOpenedApp are functions', async () => {
    const { createClient } = await import('../../src/client.js');
    const client = createClient('http://localhost:8688');
    expect(typeof client.push.onMessage).toBe('function');
    expect(typeof client.push.onMessageOpenedApp).toBe('function');
    client.destroy();
  });

  it('analytics is a ClientAnalytics instance', async () => {
    const { createClient } = await import('../../src/client.js');
    const client = createClient('http://localhost:8688');
    expect(client.analytics).toBeTruthy();
    expect(client.analytics).toBeInstanceOf(ClientAnalytics);
    client.destroy();
  });

  it('destroy does not throw', async () => {
    const { createClient } = await import('../../src/client.js');
    const client = createClient('http://localhost:8688');
    expect(() => client.destroy()).not.toThrow();
  });

  it('createClient tolerates malformed browser localStorage', async () => {
    installInvalidBrowserStorageMocks();
    const { createClient } = await import('../../src/client.js');
    const client = createClient('http://localhost:8688');
    expect(client.storage).toBeTruthy();
    client.destroy();
  });
});

// ─── N. ClientAnalytics — method signatures & behavior ────────────────────────

describe('ClientAnalytics — method signatures', () => {
  function makeAnalytics() {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({ baseUrl: 'http://localhost:8688', tokenManager: tm, contextManager: cm });
    const analytics = new ClientAnalytics(http, 'http://localhost:8688');
    return { analytics, tm };
  }

  it('track is a function', () => {
    const { analytics, tm } = makeAnalytics();
    expect(typeof analytics.track).toBe('function');
    analytics.destroy();
    tm.destroy();
  });

  it('flush is a function', () => {
    const { analytics, tm } = makeAnalytics();
    expect(typeof analytics.flush).toBe('function');
    analytics.destroy();
    tm.destroy();
  });

  it('destroy is a function', () => {
    const { analytics, tm } = makeAnalytics();
    expect(typeof analytics.destroy).toBe('function');
    analytics.destroy();
    tm.destroy();
  });

  it('track does not throw', () => {
    const { analytics, tm } = makeAnalytics();
    expect(() => analytics.track('test_event')).not.toThrow();
    analytics.destroy();
    tm.destroy();
  });

  it('track with properties does not throw', () => {
    const { analytics, tm } = makeAnalytics();
    expect(() => analytics.track('test_event', { key: 'value', num: 42, flag: true })).not.toThrow();
    analytics.destroy();
    tm.destroy();
  });

  it('flush on empty queue resolves immediately', async () => {
    const { analytics, tm } = makeAnalytics();
    await expect(analytics.flush()).resolves.toBeUndefined();
    analytics.destroy();
    tm.destroy();
  });

  it('destroy after track does not throw', () => {
    const { analytics, tm } = makeAnalytics();
    analytics.track('event_1');
    analytics.track('event_2');
    expect(() => analytics.destroy()).not.toThrow();
    tm.destroy();
  });

  it('destroy multiple times does not throw', () => {
    const { analytics, tm } = makeAnalytics();
    expect(() => {
      analytics.destroy();
      analytics.destroy();
    }).not.toThrow();
    tm.destroy();
  });

  it('track after destroy does not throw', () => {
    const { analytics, tm } = makeAnalytics();
    analytics.destroy();
    // track after destroy should still work (queue only, no crash)
    expect(() => analytics.track('late_event')).not.toThrow();
    tm.destroy();
  });
});

describe('ClientAnalytics — lifecycle behavior', () => {
  function makeAnalyticsHarness() {
    const tm = new TokenManager('http://localhost:8688');
    const cm = new ContextManager();
    const http = new HttpClient({
      baseUrl: 'http://localhost:8688',
      tokenManager: tm,
      contextManager: cm,
    });
    const analytics = new ClientAnalytics(http, 'http://localhost:8688');
    return { analytics, http, tm };
  }

  it('flushes immediately when the batch threshold is reached', async () => {
    const { analytics, http, tm } = makeAnalyticsHarness();
    const postSpy = vi.spyOn(http, 'post').mockResolvedValue(undefined as never);

    for (let i = 0; i < 20; i++) {
      analytics.track(`event-${i}`, { idx: i });
    }
    await Promise.resolve();

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith(ApiPaths.TRACK_EVENTS, {
      events: expect.arrayContaining([
        expect.objectContaining({ name: 'event-0', properties: { idx: 0 } }),
      ]),
    });

    analytics.destroy();
    tm.destroy();
  });

  it('flushes queued events when the timer expires', async () => {
    vi.useFakeTimers();
    const { analytics, http, tm } = makeAnalyticsHarness();
    const postSpy = vi.spyOn(http, 'post').mockResolvedValue(undefined as never);

    analytics.track('timer-event', { source: 'timer' });
    await vi.advanceTimersByTimeAsync(5000);

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith(ApiPaths.TRACK_EVENTS, {
      events: [
        expect.objectContaining({ name: 'timer-event', properties: { source: 'timer' } }),
      ],
    });

    analytics.destroy();
    tm.destroy();
    vi.useRealTimers();
  });

  it('requeues failed flushes and retries on the next timer tick', async () => {
    vi.useFakeTimers();
    const { analytics, http, tm } = makeAnalyticsHarness();
    const postSpy = vi.spyOn(http, 'post')
      .mockRejectedValueOnce(new Error('temporary analytics failure'))
      .mockResolvedValue(undefined as never);

    analytics.track('retry-event');
    await analytics.flush();
    expect(postSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(postSpy).toHaveBeenCalledTimes(2);

    analytics.destroy();
    tm.destroy();
    vi.useRealTimers();
  });

  it('destroy sends the remaining queue with navigator.sendBeacon', () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal('window', { addEventListener, removeEventListener });
    vi.stubGlobal('document', { visibilityState: 'visible' });
    vi.stubGlobal('navigator', { sendBeacon });

    const { analytics, tm } = makeAnalyticsHarness();
    analytics.track('destroy-event', { path: '/pricing' });
    analytics.destroy();

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon).toHaveBeenCalledWith(
      'http://localhost:8688' + ApiPaths.TRACK_EVENTS,
      expect.any(Blob),
    );
    expect(removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(removeEventListener).toHaveBeenCalledWith('pagehide', expect.any(Function));

    tm.destroy();
  });

  it('visibilitychange hidden triggers a beacon flush', () => {
    const listeners = new Map<string, () => void>();
    const addEventListener = vi.fn((type: string, listener: () => void) => {
      listeners.set(type, listener);
    });
    const removeEventListener = vi.fn();
    const sendBeacon = vi.fn(() => true);
    const documentMock = { visibilityState: 'visible' };
    vi.stubGlobal('window', { addEventListener, removeEventListener });
    vi.stubGlobal('document', documentMock);
    vi.stubGlobal('navigator', { sendBeacon });

    const { analytics, tm } = makeAnalyticsHarness();
    analytics.track('hidden-event');
    documentMock.visibilityState = 'hidden';
    listeners.get('visibilitychange')?.();

    expect(sendBeacon).toHaveBeenCalledTimes(1);

    analytics.destroy();
    tm.destroy();
  });
});
