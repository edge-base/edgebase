/**
 * HTTP client with automatic auth token injection and error handling
 */

import type { ContextManager } from './context.js';
import { parseErrorResponse, networkError, requestTimeoutError } from './errors.js';
import type { ITokenManager, ITokenPair } from './types.js';

const COOKIE_AUTH_REQUEST_TIMEOUT_MS = 15_000;
const MAX_ERROR_RESPONSE_BYTES = 64 * 1024;

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

function abortReason(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) return signal.reason;
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal);
}

function waitForPromiseOrAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  throwIfAborted(signal);

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(abortReason(signal)));

    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      value => finish(() => resolve(value)),
      error => finish(() => reject(error)),
    );
  });
}

async function readBoundedErrorBody(
  response: Response,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!response.body) return null;
  const declaredLength = Number(response.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ERROR_RESPONSE_BYTES) {
    await response.body.cancel().catch(() => {});
    return null;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let overflow = false;
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      throwIfAborted(signal);
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_ERROR_RESPONSE_BYTES) {
        overflow = true;
        await reader.cancel().catch(() => {});
        break;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (overflow || totalBytes === 0) return null;

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes).trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** Sleep for given milliseconds while retaining caller cancellation. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise(resolve => setTimeout(resolve, ms));
  throwIfAborted(signal);

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function combineSignals(first: AbortSignal, second: AbortSignal): AbortSignal {
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([first, second]);
  }

  const controller = new AbortController();
  const forwardAbort = (source: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(abortReason(source));
  };
  if (first.aborted) {
    forwardAbort(first);
  } else {
    first.addEventListener('abort', () => forwardAbort(first), { once: true });
  }
  if (second.aborted) {
    forwardAbort(second);
  } else {
    second.addEventListener('abort', () => forwardAbort(second), { once: true });
  }
  return controller.signal;
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

interface HttpRequestOptions {
  skipAuth?: boolean;
  query?: Record<string, string>;
  captchaToken?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Return a successful response before reading its caller-owned body. */
  preserveSuccessfulBody?: boolean;
}

function validateFunctionCaptchaToken(captchaToken?: string): void {
  if (
    captchaToken !== undefined
    && (typeof captchaToken !== 'string' || captchaToken.length === 0 || captchaToken.length > 2048)
  ) {
    throw new Error('captchaToken must be a non-empty string of at most 2048 characters.');
  }
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
  private async buildHeaders(
    skipAuth = false,
    signal?: AbortSignal,
  ): Promise<Record<string, string>> {
    throwIfAborted(signal);
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
      const token = await waitForPromiseOrAbort(
        Promise.resolve(
          this.tokenManager.getAccessToken((refreshToken) => this.refreshToken(refreshToken)),
        ),
        signal,
      );
      throwIfAborted(signal);
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
    preserveSuccessfulBody = false,
    callerSignal?: AbortSignal,
  ): Promise<Response> {
    throwIfAborted(callerSignal);
    const url = new URL(input, this.baseUrl);
    const shouldBoundCookieAuth = this.refreshTokenTransport === 'httpOnlyCookie'
      && /(?:^|\/)api\/auth(?:\/|$)/.test(url.pathname)
      && String(init.method ?? 'GET').toUpperCase() === 'POST';
    const timeoutMs = shouldBoundCookieAuth
      ? Math.min(requestTimeoutMs ?? COOKIE_AUTH_REQUEST_TIMEOUT_MS, COOKIE_AUTH_REQUEST_TIMEOUT_MS)
      : requestTimeoutMs;
    if (timeoutMs === undefined) {
      const fetchOptions = callerSignal ? { ...init, signal: callerSignal } : init;
      return waitForPromiseOrAbort(fetch(input, fetchOptions), callerSignal);
    }

    const controller = new AbortController();
    const requestSignal = callerSignal
      ? combineSignals(callerSignal, controller.signal)
      : controller.signal;
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<Response>((_resolve, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        controller.abort(new RequestTimeoutError(timeoutMs));
        reject(new RequestTimeoutError(timeoutMs));
      }, timeoutMs);
    });

    try {
      return await waitForPromiseOrAbort(Promise.race([
        (async () => {
          const response = await fetch(input, { ...init, signal: requestSignal });
          // Raw callers own successful response consumption. Returning here
          // preserves the exact Response and its unread stream while still
          // applying the deadline until response headers arrive. Errors keep
          // the ordinary bounded body-read path so they can be normalized.
          if (preserveSuccessfulBody && response.ok) return response;
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
      ]), callerSignal);
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
  private async requestResponse(
    method: string,
    path: string,
    body?: unknown,
    options: HttpRequestOptions = {},
  ): Promise<Response> {
    throwIfAborted(options.signal);
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
      throwIfAborted(options.signal);
      let refreshFailure: Error | null = null;
      const headers = await this.buildHeaders(options.skipAuth, options.signal);
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
          options.preserveSuccessfulBody,
          options.signal,
        );
      } catch (err) {
        throwIfAborted(options.signal);
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
          await sleep(50 * (attempt + 1), options.signal);
          continue;
        }
        throw networkError(
          `${requestLabel} could not reach ${this.baseUrl}. Make sure the EdgeBase server is running and the URL is correct.`,
          { cause: err },
        );
      }

      throwIfAborted(options.signal);

      // 429 retry with Retry-After header and exponential backoff + jitter
      if (response.status === 429 && attempt < maxRetries) {
        const delay = parseRetryAfter(response.headers.get('Retry-After'), attempt);
        await sleep(delay, options.signal);
        continue;
      }

      // Handle 401 with one forced token refresh retry.
      if (
        response.status === 401
        && !options.skipAuth
        && !this.serviceKey
        && !options.captchaToken
      ) {
        throwIfAborted(options.signal);
        // Route the refresh through the token manager's SAME deduped /
        // leader-elected path (via getAccessToken) rather than calling
        // refreshToken() directly. Otherwise concurrent 401s — and multiple
        // tabs — each fire POST /auth/refresh with the same rotating token,
        // and all but one lose the rotation race.
        let refreshedAccessToken: string | null = null;
        this.tokenManager?.invalidateAccessToken();
        try {
          const refreshPromise = Promise.resolve(
            this.tokenManager?.getAccessToken((refreshToken) => this.refreshToken(refreshToken))
              ?? null,
          );
          refreshedAccessToken = (await waitForPromiseOrAbort(
            refreshPromise,
            options.signal,
          )) ?? null;
          if (!refreshedAccessToken) {
            refreshFailure = new Error('No refresh token was available.');
          }
        } catch (error) {
          throwIfAborted(options.signal);
          refreshFailure = error instanceof Error
            ? error
            : new Error(String(error));
        }

        try {
          const newHeaders = await this.buildHeaders(true, options.signal);
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
            options.preserveSuccessfulBody,
            options.signal,
          );
          if (retryResponse.ok) {
            return retryResponse;
          }
          response = retryResponse;
        } catch (error) {
          throwIfAborted(options.signal);
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
        let errorBody: unknown = null;
        try {
          errorBody = await readBoundedErrorBody(response, options.signal);
        } catch (error) {
          throwIfAborted(options.signal);
          void error;
        }
        throwIfAborted(options.signal);
        const parsed = parseErrorResponse(response.status, errorBody);
        if (response.status === 401 && refreshFailure) {
          parsed.message = `${parsed.message} Token refresh also failed: ${refreshFailure.message}`;
        }
        throw parsed;
      }

      return response;
    }

    // Should not reach here
    throw networkError(
      `${requestLabel} failed after ${maxRetries + 1} attempts. The server may be unavailable or repeatedly rate-limiting requests.`,
    );
  }

  /** Core JSON request method layered on the shared response transport. */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: HttpRequestOptions = {},
  ): Promise<T> {
    const response = await this.requestResponse(method, path, body, options);
    if (response.status === 204) return undefined as T;
    try {
      const value = (await response.json()) as T;
      throwIfAborted(options.signal);
      return value;
    } catch (error) {
      throwIfAborted(options.signal);
      throw error;
    }
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
    signal?: AbortSignal,
  ): Promise<T> {
    validateFunctionCaptchaToken(captchaToken);
    return this.request<T>(method, path, method === 'GET' ? undefined : body, {
      query,
      captchaToken,
      timeoutMs,
      signal,
    });
  }

  /**
   * App Function request that returns an exact successful Response without
   * reading its body. An explicit deadline applies until response headers are
   * handed to the caller; stream consumption and cancellation are then owned
   * by the caller.
   */
  async requestFunctionRaw(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    query?: Record<string, string>,
    captchaToken?: string,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<Response> {
    validateFunctionCaptchaToken(captchaToken);
    return this.requestResponse(method, path, method === 'GET' ? undefined : body, {
      query,
      captchaToken,
      timeoutMs,
      signal,
      preserveSuccessfulBody: true,
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
