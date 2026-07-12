/**
 * Turnstile captcha provider for browser environments.
 *
 * Automatically loads Cloudflare Turnstile JS SDK, renders invisible widget,
 * and returns a captcha token. If interactive challenge is needed, shows
 * a centered modal overlay automatically.
 *
 * Usage (internal — called by AuthClient):
 *   const token = await getCaptchaToken(siteKey, 'signup');
 */

// Turnstile global type
declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: {
          sitekey: string;
          action?: string;
          callback?: (token: string) => void;
          'error-callback'?: (error: unknown) => void;
          'before-interactive-callback'?: () => void;
          'after-interactive-callback'?: () => void;
          'timeout-callback'?: () => void;
          appearance?: 'always' | 'execute' | 'interaction-only';
          size?: 'normal' | 'compact' | 'flexible';
        },
      ) => string;
      remove: (widgetId: string) => void;
      reset: (widgetId: string) => void;
    };
  }
}

const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

export type TurnstileErrorReason =
  | 'config_fetch_failed'
  | 'config_invalid_response'
  | 'environment_unavailable'
  | 'script_load_error'
  | 'script_timeout'
  | 'initialization_error'
  | 'render_error'
  | 'challenge_error'
  | 'challenge_timeout'
  | 'client_timeout'
  | 'cancelled';

/** A terminal browser challenge failure with a stable machine-readable reason. */
export class TurnstileError extends Error {
  readonly reason: TurnstileErrorReason;

  constructor(reason: TurnstileErrorReason, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TurnstileError';
    this.reason = reason;
  }
}

let scriptLoaded = false;
let scriptLoading: Promise<void> | null = null;

/** Load Turnstile JS SDK (idempotent). */
function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) {
    scriptLoaded = true;
    return Promise.resolve();
  }
  if (scriptLoading) return scriptLoading;

  scriptLoading = new Promise<void>((resolve, reject) => {
    const POLL_TIMEOUT_MS = 10_000;
    const POLL_INTERVAL_MS = 50;
    let settled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let script: HTMLScriptElement | null = null;

    const clearWaiters = () => {
      if (pollTimer) clearTimeout(pollTimer);
      if (deadlineTimer) clearTimeout(deadlineTimer);
      if (script) {
        script.onload = null;
        script.onerror = null;
      }
    };
    const fail = (reason: TurnstileErrorReason, message: string) => {
      if (settled) return;
      settled = true;
      clearWaiters();
      scriptLoaded = false;
      // A script that did not initialize the expected global is unusable. It
      // must not poison every later call through querySelector reuse.
      script?.remove();
      scriptLoading = null;
      reject(new TurnstileError(reason, message));
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      clearWaiters();
      scriptLoaded = true;
      scriptLoading = null;
      resolve();
    };
    const pollForTurnstile = () => {
      if (settled) return;
      if (window.turnstile) {
        succeed();
        return;
      }
      pollTimer = setTimeout(pollForTurnstile, POLL_INTERVAL_MS);
    };

    // Check if already in DOM
    script = document.querySelector<HTMLScriptElement>(
      `script[src^="${TURNSTILE_SCRIPT_URL}"]`,
    );
    let created = false;
    if (!script) {
      script = document.createElement('script');
      script.src = `${TURNSTILE_SCRIPT_URL}?render=explicit`;
      script.async = true;
      script.defer = true;
      created = true;
    }
    script.onload = pollForTurnstile;
    script.onerror = () => fail('script_load_error', 'Failed to load Turnstile script');
    deadlineTimer = setTimeout(
      () => fail(
        'script_timeout',
        'Turnstile script loaded but window.turnstile not available',
      ),
      POLL_TIMEOUT_MS,
    );
    if (created) document.head.appendChild(script);
    pollForTurnstile();
  });

  return scriptLoading;
}

/** Create modal overlay for interactive challenge. Hidden by default. */
function createOverlay(): { overlay: HTMLDivElement; container: HTMLDivElement; show: () => void; hide: () => void; destroy: () => void } {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:none;align-items:center;justify-content:center;z-index:999999;';

  const container = document.createElement('div');
  container.style.cssText = 'background:#fff;border-radius:12px;padding:16px;box-shadow:0 4px 24px rgba(0,0,0,0.2);';
  overlay.appendChild(container);

  document.body.appendChild(overlay);

  return {
    overlay,
    container,
    show: () => { overlay.style.display = 'flex'; },
    hide: () => { overlay.style.display = 'none'; },
    destroy: () => { overlay.remove(); },
  };
}

/**
 * Get a Turnstile captcha token for the given action.
 *
 * - Loads Turnstile JS SDK if needed (cached)
 * - Renders invisible widget → auto-passes for 99% of users
 * - If interactive challenge needed → shows centered modal overlay automatically
 * - Returns the token string
 *
 * @param siteKey - Turnstile site key from GET /api/config
 * @param action - Action name (e.g. 'signup', 'signin', 'anonymous')
 * @param timeoutMs - Timeout in ms (default: 30000)
 */
export async function getCaptchaToken(
  siteKey: string,
  action: string,
  timeoutMs = 30000,
  signal?: AbortSignal,
): Promise<string> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new TurnstileError(
      'environment_unavailable',
      'Turnstile is only available in browser environments',
    );
  }
  if (signal?.aborted) throw new TurnstileError('cancelled', 'Turnstile challenge cancelled');

  const loading = loadTurnstileScript();
  if (signal) {
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => reject(new TurnstileError(
        'cancelled',
        'Turnstile challenge cancelled',
      ));
      signal.addEventListener('abort', onAbort, { once: true });
      loading.then(resolve, reject).finally(() => {
        signal.removeEventListener('abort', onAbort);
      });
    });
  } else {
    await loading;
  }

  if (signal?.aborted) throw new TurnstileError('cancelled', 'Turnstile challenge cancelled');

  if (!window.turnstile) {
    throw new TurnstileError('initialization_error', 'Turnstile failed to initialize');
  }

  return new Promise<string>((resolve, reject) => {
    const { container, show, hide, destroy } = createOverlay();

    let widgetId: string | undefined;
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (widgetId && window.turnstile) {
        try { window.turnstile.remove(widgetId); } catch { /* ignore */ }
      }
      destroy();
    };
    const succeed = (token: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(token);
    };
    const fail = (error: TurnstileError) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => fail(new TurnstileError(
      'cancelled',
      'Turnstile challenge cancelled',
    ));

    const timer = setTimeout(() => {
      fail(new TurnstileError('client_timeout', 'Turnstile timeout'));
    }, timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const renderedWidgetId = window.turnstile!.render(container, {
        sitekey: siteKey,
        action,
        appearance: 'interaction-only',
        callback: (token: string) => {
          succeed(token);
        },
        'error-callback': (error: unknown) => {
          fail(new TurnstileError('challenge_error', `Turnstile error: ${String(error)}`));
        },
        'before-interactive-callback': () => {
          show();
        },
        'after-interactive-callback': () => {
          hide();
        },
        'timeout-callback': () => {
          fail(new TurnstileError(
            'challenge_timeout',
            'Turnstile challenge timed out',
          ));
        },
      });
      widgetId = renderedWidgetId;
      // Defensive cleanup for a provider/test adapter that invokes a terminal
      // callback synchronously before render() returns its widget id.
      if (settled && window.turnstile) {
        try { window.turnstile.remove(widgetId); } catch { /* ignore */ }
        widgetId = undefined;
      }
    } catch (error) {
      fail(new TurnstileError(
        'render_error',
        error instanceof Error ? error.message : String(error),
        { cause: error },
      ));
    }
  });
}

// ─── Site Key Cache ───

const SITE_KEY_CACHE_TTL_MS = 5 * 60 * 1000;
const siteKeyCache = new Map<string, { value: string; expiresAt: number }>();
const siteKeyPromises = new Map<string, Promise<string | null>>();

function canonicalBackendOrigin(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('EdgeBase baseUrl must use HTTP(S).');
  }
  return parsed.origin;
}

/**
 * Fetch captcha siteKey from GET /api/config (cached).
 * Returns null if captcha is not configured on server.
 */
export async function fetchSiteKey(baseUrl: string): Promise<string | null> {
  const origin = canonicalBackendOrigin(baseUrl);
  const cached = siteKeyCache.get(origin);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) siteKeyCache.delete(origin);
  const existing = siteKeyPromises.get(origin);
  if (existing) return existing;

  const promise = (async () => {
    let res: Response;
    try {
      res = await fetch(`${origin}/api/config`, {
        signal: AbortSignal.timeout(3000),
      });
    } catch (cause) {
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
      data = await res.json();
    } catch (cause) {
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
    const siteKey = typeof rawSiteKey === 'string' ? rawSiteKey.trim() : '';
    if (!siteKey || siteKey.length > 256 || !/^[A-Za-z0-9_-]+$/.test(siteKey)) {
      throw new TurnstileError(
        'config_invalid_response',
        'CAPTCHA configuration contains an invalid siteKey.',
      );
    }

    siteKeyCache.set(origin, {
      value: siteKey,
      expiresAt: Date.now() + SITE_KEY_CACHE_TTL_MS,
    });
    return siteKey;
  })().finally(() => {
    siteKeyPromises.delete(origin);
  });

  siteKeyPromises.set(origin, promise);
  return promise;
}

/** Clear a backend's cached CAPTCHA configuration after a rotation signal. */
export function invalidateSiteKeyCache(baseUrl: string): void {
  const origin = canonicalBackendOrigin(baseUrl);
  siteKeyCache.delete(origin);
  siteKeyPromises.delete(origin);
}

/**
 * Resolve captcha token: use provided token or auto-acquire via Turnstile.
 *
 * - If captchaToken is provided → return it (manual override)
 * - If siteKey is available → auto-acquire via Turnstile widget
 * - If no siteKey (captcha not configured) → return undefined
 */
export async function resolveCaptchaToken(
  baseUrl: string,
  action: string,
  captchaToken?: string,
): Promise<string | undefined> {
  // Manual override — skip built-in widget
  if (captchaToken) return captchaToken;

  // Fetch siteKey (cached)
  const siteKey = await fetchSiteKey(baseUrl);
  if (!siteKey) return undefined; // Captcha not configured on server

  // Auto-acquire token via Turnstile. Only a provider challenge error can
  // indicate that the directly fetched site key rotated before render. Refresh
  // config and retry that acquisition exactly once; loader/render/timeout/
  // cancellation failures are terminal and retain their typed reason.
  try {
    return await getCaptchaToken(siteKey, action);
  } catch (error) {
    if (!(error instanceof TurnstileError) || error.reason !== 'challenge_error') throw error;
    invalidateSiteKeyCache(baseUrl);
    const replacementSiteKey = await fetchSiteKey(baseUrl);
    if (!replacementSiteKey) throw error;
    return getCaptchaToken(replacementSiteKey, action);
  }
}
