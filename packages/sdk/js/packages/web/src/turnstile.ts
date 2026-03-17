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

let scriptLoaded = false;
let scriptLoading: Promise<void> | null = null;

/** Load Turnstile JS SDK (idempotent). */
function loadTurnstileScript(): Promise<void> {
  if (scriptLoaded && window.turnstile) return Promise.resolve();
  if (scriptLoading) return scriptLoading;

  scriptLoading = new Promise<void>((resolve, reject) => {
    // Check if already in DOM
    if (document.querySelector(`script[src^="${TURNSTILE_SCRIPT_URL}"]`)) {
      const check = () => {
        if (window.turnstile) { scriptLoaded = true; resolve(); }
        else setTimeout(check, 50);
      };
      check();
      return;
    }

    const script = document.createElement('script');
    script.src = `${TURNSTILE_SCRIPT_URL}?render=explicit`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      const check = () => {
        if (window.turnstile) { scriptLoaded = true; resolve(); }
        else setTimeout(check, 50);
      };
      check();
    };
    script.onerror = () => {
      scriptLoading = null;
      reject(new Error('Failed to load Turnstile script'));
    };
    document.head.appendChild(script);
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
): Promise<string> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('Turnstile is only available in browser environments');
  }

  await loadTurnstileScript();

  if (!window.turnstile) {
    throw new Error('Turnstile failed to initialize');
  }

  return new Promise<string>((resolve, reject) => {
    const { container, show, hide, destroy } = createOverlay();

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Turnstile timeout'));
    }, timeoutMs);

    let widgetId: string | undefined;

    const cleanup = () => {
      clearTimeout(timer);
      if (widgetId && window.turnstile) {
        try { window.turnstile.remove(widgetId); } catch { /* ignore */ }
      }
      destroy();
    };

    widgetId = window.turnstile!.render(container, {
      sitekey: siteKey,
      action,
      appearance: 'interaction-only',
      callback: (token: string) => {
        cleanup();
        resolve(token);
      },
      'error-callback': (error: unknown) => {
        cleanup();
        reject(new Error(`Turnstile error: ${error}`));
      },
      'before-interactive-callback': () => {
        show();
      },
      'after-interactive-callback': () => {
        hide();
      },
      'timeout-callback': () => {
        cleanup();
        reject(new Error('Turnstile challenge timed out'));
      },
    });
  });
}

// ─── Site Key Cache ───

let siteKeyCache: string | null = null;
let siteKeyPromise: Promise<string | null> | null = null;

/**
 * Fetch captcha siteKey from GET /api/config (cached).
 * Returns null if captcha is not configured on server.
 */
export async function fetchSiteKey(baseUrl: string): Promise<string | null> {
  if (siteKeyCache !== null) return siteKeyCache;
  if (siteKeyPromise) return siteKeyPromise;

  siteKeyPromise = (async () => {
    try {
      const res = await fetch(`${baseUrl}/api/config`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { captcha?: { siteKey?: string } | null };
      siteKeyCache = data.captcha?.siteKey ?? null;
      return siteKeyCache;
    } catch {
      return null;
    } finally {
      siteKeyPromise = null;
    }
  })();

  return siteKeyPromise;
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

  // Auto-acquire token via Turnstile
  try {
    return await getCaptchaToken(siteKey, action);
  } catch {
    // Turnstile failed — let server handle (failMode: open/closed)
    return undefined;
  }
}
