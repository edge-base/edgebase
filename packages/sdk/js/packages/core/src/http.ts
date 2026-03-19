/**
 * HTTP client with automatic auth token injection and error handling
 */

import type { ContextManager } from './context.js';
import { parseErrorResponse, networkError } from './errors.js';
import type { ITokenManager, ITokenPair } from './types.js';

export interface HttpClientOptions {
  baseUrl: string;
  serviceKey?: string;
  tokenManager?: ITokenManager;  // Optional: AdminEdgeBase doesn't use ITokenManager
  contextManager: ContextManager;
}

export class HttpClient {
  private baseUrl: string;
  private serviceKey?: string;
  private tokenManager?: ITokenManager;
  private locale?: string;

  constructor(options: HttpClientOptions) {
    if (!options.baseUrl || typeof options.baseUrl !== 'string') {
      throw new Error(`[EdgeBase] HttpClient requires a valid baseUrl string, got: ${String(options.baseUrl)}`);
    }
    this.baseUrl = options.baseUrl.replace(/\/$/, ''); // strip trailing slash
    this.serviceKey = options.serviceKey;
    this.tokenManager = options.tokenManager;

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

    // Auth token — if refresh fails, proceed without auth (graceful degradation)
    if (!skipAuth && this.tokenManager) {
      try {
        const token = await this.tokenManager.getAccessToken((refreshToken) =>
          this.refreshToken(refreshToken),
        );
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
      } catch {
        // Token refresh failed — proceed as unauthenticated.
        // In release: false mode the server allows anonymous access.
        // In release: true mode, downstream will return 401 as expected.
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
    const response = await fetch(`${this.baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw parseErrorResponse(response.status, body);
    }

    const data = (await response.json()) as ITokenPair;
    return data;
  }

  /** Core request method */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: { skipAuth?: boolean; query?: Record<string, string> } = {},
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, value);
        }
      }
    }

    const headers = await this.buildHeaders(options.skipAuth);
    if (body === undefined) {
      delete headers['Content-Type'];
    }
    const fetchOptions: RequestInit = { method, headers };
    if (body !== undefined) {
      fetchOptions.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(url.toString(), fetchOptions);
    } catch (err) {
      throw networkError(
        `Network error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }

    // Handle 401 with one forced token refresh retry.
    if (response.status === 401 && !options.skipAuth && !this.serviceKey) {
      try {
        this.tokenManager?.invalidateAccessToken();
        const newHeaders = await this.buildHeaders(false);
        if (body === undefined) {
          delete newHeaders['Content-Type'];
        }
        const retryOptions: RequestInit = { method, headers: newHeaders };
        if (body !== undefined) {
          retryOptions.body = JSON.stringify(body);
        }
        const retryResponse = await fetch(url.toString(), retryOptions);
        if (retryResponse.ok) {
          if (retryResponse.status === 204) return undefined as T;
          return (await retryResponse.json()) as T;
        }
        // If retry also fails, fall through to error handling below
        response = retryResponse;
      } catch {
        // retry failed, use original response
      }
    }

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw parseErrorResponse(response.status, errorBody);
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
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
