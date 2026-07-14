/**
 * HTTP client with automatic auth token injection and error handling
 */

import type { ContextManager } from './context.js';
import { parseErrorResponse, networkError, requestTimeoutError } from './errors.js';
import type { ITokenManager, ITokenPair } from './types.js';

const COOKIE_AUTH_REQUEST_TIMEOUT_MS = 15_000;

class RequestTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Request timed out after ${timeoutMs}ms.`);
    this.name = 'RequestTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/** Parse Retry-After header and calculate delay with exponential backoff + jitter */
function parseRetryAfter(header: string | null, attempt: number): number {
  let baseDelay = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
  if (header) {
    const seconds = Number(header);
    if (!isNaN(seconds) && seconds > 0) {
      baseDelay = seconds * 1000;
    }
  }
  const jitter = Math.random() * baseDelay * 0.25;
  return Math.min(baseDelay + jitter, 10000);
}

/** Check if error is a retryable network error */
function isRetryableNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes('fetch') || msg.includes('network') ||
    msg.includes('timeout') || msg.includes('econnreset') ||
    msg.includes('econnrefused') || msg.includes('socket') ||
    msg.includes('abort');
}

/** Sleep for given milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface HttpClientOptions {
  baseUrl: string;
  serviceKey?: string;
  tokenManager?: ITokenManager;  // Optional: AdminEdgeBase doesn't use ITokenManager
  contextManager: ContextManager;
  /**
   * Transport used for browser refresh sessions. The default `body` mode keeps
   * the existing SDK contract. `httpOnlyCookie` opts auth endpoints into the
   * server-managed refresh cookie protocol without changing bearer access-token
   * authentication for the rest of the API.
   */
  refreshTokenTransport?: 'body' | 'httpOnlyCookie';
  /**
   * Optional default deadline for JSON API requests, including response-body
   * consumption. Undefined preserves the unbounded legacy behavior. A timed
   * out mutation has an unknown outcome and is never transport-retried.
   */
  requestTimeoutMs?: number;
}

export class HttpClient {
  private baseUrl: string;
  private serviceKey?: string;
  private tokenManager?: ITokenManager;
  private locale?: string;
  private refreshTokenTransport: 'body' | 'httpOnlyCookie';
  private requestTimeoutMs?: number;

  constructor(options: HttpClientOptions) {
    if (!options.baseUrl || typeof options.baseUrl !== 'string') {
      throw new Error(`[EdgeBase] HttpClient requires a valid baseUrl string, got: ${String(options.baseUrl)}`);
    }
    this.baseUrl = options.baseUrl.replace(/\/$/, ''); // strip trailing slash
    this.serviceKey = options.serviceKey;
    this.tokenManager = options.tokenManager;
    this.refreshTokenTransport = options.refreshTokenTransport ?? 'body';
    if (
      options.requestTimeoutMs !== undefined
      && (!Number.isFinite(options.requestTimeoutMs) || options.requestTimeoutMs <= 0)
    ) {
      throw new Error('[EdgeBase] requestTimeoutMs must be a finite number greater than 0.');
    }
    this.requestTimeoutMs = options.requestTimeoutMs;

    // — warn if Service Key is used in a browser context
    if (this.serviceKey && typeof window !== 'undefined') {
      console.warn(
        '[EdgeBase] ⚠️ Service Key detected in browser context! ' +
        'Service Keys have full admin access and must NEVER be used in client-side code. ' +
        'Move this to a server-side environment (Node.js, Edge Function, etc.).',
      );
    }
  }

  /**
   * Set locale for i18n. Auth emails will be sent in this language.
   * Also sent as Accept-Language header on all requests.
   * Pass undefined to clear (falls back to user's stored locale on server).
   */
  setLocale(locale: string | undefined): void {
    this.locale = locale;
  }

  /** Get the currently set locale */
  getLocale(): string | undefined {
    return this.locale;
  }

  /** Build headers for a request */
  private async buildHeaders(skipAuth = false): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Service Key header
    if (this.serviceKey) {
      headers['X-EdgeBase-Service-Key'] = this.serviceKey;
    }

    // Auth token. A refresh FAILURE (as opposed to "no session") must NOT be
    // swallowed into an anonymous request — silently downgrading an
    // authenticated call to anonymous can return the wrong data or perform an
    // action as the wrong principal. getAccessToken returns null when there is
    // genuinely no session (proceed anonymously); it throws when a refresh was
    // required and failed — we surface that.
    if (!skipAuth && this.tokenManager) {
      const token = await this.tokenManager.getAccessToken((refreshToken) =>
        this.refreshToken(refreshToken),
      );
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    // Locale header (i18n — auth emails will be sent in this language)
    if (this.locale) {
      headers['Accept-Language'] = this.locale;
    }

    return headers;
  }

  /** Perform token refresh */
  private async refreshToken(refreshToken: string): Promise<ITokenPair> {
    const useCookie = this.refreshTokenTransport === 'httpOnlyCookie';
    const refreshUrl = `${this.baseUrl}/api/auth/refresh`;
    let response: Response;
    try {
      response = await this.fetchWithRequestTimeout(refreshUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(useCookie ? { 'X-EdgeBase-Auth-Transport': 'cookie' } : {}),
        },
        ...(useCookie ? { credentials: 'include' as const } : {}),
        body: JSON.stringify(refreshToken ? { refreshToken } : {}),
      });
    } catch (error) {
      throw networkError(
        `Auth session refresh could not reach ${refreshUrl}. Make sure the EdgeBase server is running and reachable.`,
        { cause: error },
      );
    }

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw parseErrorResponse(response.status, body);
    }

    const data = (await response.json()) as Partial<ITokenPair>;
    if (!data.accessToken || (!useCookie && !data.refreshToken)) {
      throw parseErrorResponse(500, {
        message: useCookie
          ? 'Auth refresh succeeded but did not return an accessToken.'
          : 'Auth refresh succeeded but did not return both accessToken and refreshToken.',
      });
    }
    return {
      accessToken: data.accessToken,
      // Cookie mode deliberately has no JavaScript-readable refresh token. The
      // empty value is an internal compatibility sentinel for ITokenPair; the
      // cookie-aware TokenManager never persists or broadcasts it.
      refreshToken: data.refreshToken ?? '',
    };
  }

  /**
   * Bound cookie-mutating auth requests so an unresponsive connection cannot
   * retain the cross-tab refresh lock forever. Aborting also prevents a late
   * Set-Cookie response from racing a subsequent sign-out.
   */
  private async fetchWithRequestTimeout(
    input: string,
    init: RequestInit,
    requestTimeoutMs?: number,
  ): Promise<Response> {
    const url = new URL(input, this.baseUrl);
    const shouldBoundCookieAuth = this.refreshTokenTransport === 'httpOnlyCookie'
      && /(?:^|\/)api\/auth(?:\/|$)/.test(url.pathname)
      && String(init.method ?? 'GET').toUpperCase() === 'POST';
    const timeoutMs = shouldBoundCookieAuth
      ? Math.min(requestTimeoutMs ?? COOKIE_AUTH_REQUEST_TIMEOUT_MS, COOKIE_AUTH_REQUEST_TIMEOUT_MS)
      : requestTimeoutMs;
    if (timeoutMs === undefined) return fetch(input, init);

    const controller = new AbortController();
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<Response>((_resolve, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new RequestTimeoutError(timeoutMs));
      }, timeoutMs);
    });

    try {
      return await Promise.race([
        (async () => {
          const response = await fetch(input, { ...init, signal: controller.signal });
          // Keep the timeout alive through body consumption. Some proxies can
          // deliver 200 headers and then stall the JSON stream indefinitely.
          const bytes = await response.arrayBuffer();
          return new Response(bytes.byteLength > 0 ? bytes : null, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        })(),
        timeoutPromise,
      ]);
    } catch (error) {
      if (timedOut) throw new RequestTimeoutError(timeoutMs);
      throw error;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  private applyAuthTransport(
    url: URL,
    headers: Record<string, string>,
    fetchOptions: RequestInit,
  ): void {
    if (
      this.refreshTokenTransport !== 'httpOnlyCookie'
      || !/(?:^|\/)api\/auth(?:\/|$)/.test(url.pathname)
      || String(fetchOptions.method ?? 'GET').toUpperCase() !== 'POST'
    ) {
      return;
    }
    headers['X-EdgeBase-Auth-Transport'] = 'cookie';
    fetchOptions.credentials = 'include';
  }

  /** Core request method with 429 retry, transport retry, and 401 token refresh */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: {
      skipAuth?: boolean;
      query?: Record<string, string>;
      captchaToken?: string;
      timeoutMs?: number;
    } = {},
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);
    const requestLabel = `${method.toUpperCase()} ${url.pathname}`;
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, value);
        }
      }
    }

    // Turnstile tokens are single-use. Once a protected request leaves the
    // client, transport/HTTP failure cannot prove whether the server consumed
    // it, so automatic replay would be ambiguous and potentially duplicate a
    // function side effect.
    const maxRetries = options.captchaToken ? 0 : 3;
    const methodUpper = method.toUpperCase();
    const requestTimeoutMs = options.timeoutMs ?? this.requestTimeoutMs;
    if (
      requestTimeoutMs !== undefined
      && (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0)
    ) {
      throw new Error('[EdgeBase] timeoutMs must be a finite number greater than 0.');
    }

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let refreshFailure: Error | null = null;
      const headers = await this.buildHeaders(options.skipAuth);
      if (options.captchaToken) {
        headers['X-EdgeBase-Captcha-Token'] = options.captchaToken;
      }
      if (body === undefined) {
        delete headers['Content-Type'];
      }
      const fetchOptions: RequestInit = { method, headers };
      this.applyAuthTransport(url, headers, fetchOptions);
      if (body !== undefined) {
        fetchOptions.body = JSON.stringify(body);
      }

      let response: Response;
      try {
        response = await this.fetchWithRequestTimeout(
          url.toString(),
          fetchOptions,
          requestTimeoutMs,
        );
      } catch (err) {
        if (err instanceof RequestTimeoutError) {
          const unknownOutcome = methodUpper === 'GET'
            ? ''
            : ' The server may still have committed this mutation; confirm its state before retrying.';
          throw requestTimeoutError(
            `${requestLabel} timed out after ${err.timeoutMs}ms.${unknownOutcome}`,
          );
        }
        // Only safe reads are replayed after an ambiguous transport failure.
        // POST/PATCH/PUT/DELETE may already have committed before the connection
        // failed, so automatic retry could duplicate a side effect.
        if (
          attempt < 2
          && methodUpper === 'GET'
          && !options.captchaToken
          && isRetryableNetworkError(err)
        ) {
          await sleep(50 * (attempt + 1));
          continue;
        }
        throw networkError(
          `${requestLabel} could not reach ${this.baseUrl}. Make sure the EdgeBase server is running and the URL is correct.`,
          { cause: err },
        );
      }

      // 429 retry with Retry-After header and exponential backoff + jitter
      if (response.status === 429 && attempt < maxRetries) {
        const delay = parseRetryAfter(response.headers.get('Retry-After'), attempt);
        await sleep(delay);
        continue;
      }

      // Handle 401 with one forced token refresh retry.
      if (
        response.status === 401
        && !options.skipAuth
        && !this.serviceKey
        && !options.captchaToken
      ) {
        // Route the refresh through the token manager's SAME deduped /
        // leader-elected path (via getAccessToken) rather than calling
        // refreshToken() directly. Otherwise concurrent 401s — and multiple
        // tabs — each fire POST /auth/refresh with the same rotating token,
        // and all but one lose the rotation race.
        let refreshedAccessToken: string | null = null;
        this.tokenManager?.invalidateAccessToken();
        try {
          refreshedAccessToken = (await this.tokenManager?.getAccessToken((refreshToken) =>
            this.refreshToken(refreshToken),
          )) ?? null;
          if (!refreshedAccessToken) {
            refreshFailure = new Error('No refresh token was available.');
          }
        } catch (error) {
          refreshFailure = error instanceof Error
            ? error
            : new Error(String(error));
        }

        try {
          const newHeaders = await this.buildHeaders(true);
          if (options.captchaToken) {
            newHeaders['X-EdgeBase-Captcha-Token'] = options.captchaToken;
          }
          // Reuse the token from the single refresh above — do NOT call
          // getAccessToken again here (that could trigger a second refresh).
          if (refreshedAccessToken) {
            newHeaders['Authorization'] = `Bearer ${refreshedAccessToken}`;
          }
          if (body === undefined) {
            delete newHeaders['Content-Type'];
          }
          const retryOptions: RequestInit = { method, headers: newHeaders };
          this.applyAuthTransport(url, newHeaders, retryOptions);
          if (body !== undefined) {
            retryOptions.body = JSON.stringify(body);
          }
          const retryResponse = await this.fetchWithRequestTimeout(
            url.toString(),
            retryOptions,
            requestTimeoutMs,
          );
          if (retryResponse.ok) {
            if (retryResponse.status === 204) return undefined as T;
            return (await retryResponse.json()) as T;
          }
          response = retryResponse;
        } catch (error) {
          if (error instanceof RequestTimeoutError) {
            const unknownOutcome = methodUpper === 'GET'
              ? ''
              : ' The server may still have committed this mutation; confirm its state before retrying.';
            throw requestTimeoutError(
              `${requestLabel} timed out after ${error.timeoutMs}ms while retrying after a 401 response.${unknownOutcome}`,
            );
          }
          throw networkError(
            `${requestLabel} could not reach ${this.baseUrl} while retrying after a 401 response. Make sure the EdgeBase server is running and the URL is correct.`,
            { cause: error },
          );
        }
      }

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        const parsed = parseErrorResponse(response.status, errorBody);
        if (response.status === 401 && refreshFailure) {
          parsed.message = `${parsed.message} Token refresh also failed: ${refreshFailure.message}`;
        }
        throw parsed;
      }

      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    }

    // Should not reach here
    throw networkError(
      `${requestLabel} failed after ${maxRetries + 1} attempts. The server may be unavailable or repeatedly rate-limiting requests.`,
    );
  }

  /** GET request */
  async get<T>(path: string, query?: Record<string, string>): Promise<T> {
    return this.request<T>('GET', path, undefined, { query });
  }

  /** POST request */
  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  /** POST request with query params (e.g. ?upsert=true) */
  async postWithQuery<T>(
    path: string,
    body: unknown,
    query: Record<string, string>,
  ): Promise<T> {
    return this.request<T>('POST', path, body, { query });
  }

  /** PATCH request */
  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  /** PUT request */
  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  /** DELETE request */
  async delete<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('DELETE', path, body);
  }

  /** App Function request with a Turnstile token in the dedicated header. */
  async requestFunction<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    query?: Record<string, string>,
    captchaToken?: string,
    timeoutMs?: number,
  ): Promise<T> {
    if (
      captchaToken !== undefined
      && (typeof captchaToken !== 'string' || captchaToken.length === 0 || captchaToken.length > 2048)
    ) {
      throw new Error('captchaToken must be a non-empty string of at most 2048 characters.');
    }
    return this.request<T>(method, path, method === 'GET' ? undefined : body, {
      query,
      captchaToken,
      timeoutMs,
    });
  }

  /** POST request without auth (for signup, signin) */
  async postPublic<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body, { skipAuth: true });
  }

  /** Get auth headers (for raw fetch calls, e.g. file uploads) */
  async getAuthHeaders(): Promise<Record<string, string>> {
    return this.buildHeaders(false);
  }

  /** Get base URL */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /** Raw GET request (returns Response, for file downloads) */
  async getRaw(path: string): Promise<Response> {
    const url = new URL(path, this.baseUrl);
    const headers = await this.buildHeaders(false);
    const response = await fetch(url.toString(), { method: 'GET', headers });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw parseErrorResponse(response.status, body);
    }
    return response;
  }

  /** Raw HEAD request (returns Response, for existence checks) */
  async headRaw(path: string): Promise<Response> {
    const url = new URL(path, this.baseUrl);
    const headers = await this.buildHeaders(false);
    const response = await fetch(url.toString(), { method: 'HEAD', headers });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw parseErrorResponse(response.status, body);
    }
    return response;
  }

  /** HEAD request — returns true if resource exists (2xx), false otherwise */
  async head(path: string): Promise<boolean> {
    const url = new URL(path, this.baseUrl);
    const headers = await this.buildHeaders(false);
    try {
      const response = await fetch(url.toString(), { method: 'HEAD', headers });
      return response.ok;
    } catch {
      return false;
    }
  }
}
