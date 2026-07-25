/**
 * FunctionsClient — Call EdgeBase App Functions from client or admin SDK.
 *
 * Auth tokens are auto-injected via HttpClient. Errors are thrown as EdgeBaseError.
 *
 * @example
 * // Via client SDK
 * const { data } = await client.functions.post('users', { name: 'June' });
 *
 * // Via admin SDK
 * const users = await admin.functions.get('users');
 *
 * // With dynamic route params
 * const user = await client.functions.get('users/abc123/profile');
 */
import type { HttpClient } from './http.js';

// ─── Types ───

export interface FunctionCallOptions {
  /** HTTP method (defaults to 'POST'). */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Request body (ignored for GET). */
  body?: unknown;
  /** Query string parameters (appended to URL). */
  query?: Record<string, string>;
  /** Turnstile token for a function declared with `captcha: true`. */
  captchaToken?: string;
  /**
   * Optional deadline covering response headers and JSON body consumption.
   * For `callRaw()`, the deadline ends when the unread Response is handed to
   * the caller, which then owns stream consumption and cancellation.
   * A timed-out mutation may already have committed and is not retried.
   */
  timeoutMs?: number;
  /**
   * Optional caller cancellation signal. Cancellation covers authentication,
   * transport, retries, and JSON response consumption. `callRaw()` returns the
   * unread response while keeping its body bound to this signal.
   */
  signal?: AbortSignal;
}

// ─── FunctionsClient ───

export class FunctionsClient {
  private httpClient: HttpClient;

  constructor(httpClient: HttpClient) {
    this.httpClient = httpClient;
  }

  /**
   * Call a function by route path.
   *
   * @param name Function route path (e.g., 'hello', 'users/abc123/profile')
   * @param options HTTP method, body, and query options
   * @returns The function's return value
   *
   * @example
   * await client.functions.call('send-email', { method: 'POST', body: { to: 'user@test.com' } });
   */
  async call<T = unknown>(name: string, options?: FunctionCallOptions): Promise<T> {
    const method = options?.method ?? 'POST';
    const path = `/api/functions/${name}`;

    if (options?.signal) {
      return this.httpClient.requestFunction<T>(
        method,
        path,
        options.body,
        options.query,
        options.captchaToken,
        options.timeoutMs,
        options.signal,
      );
    }

    if (options?.captchaToken || options?.timeoutMs !== undefined) {
      return this.httpClient.requestFunction<T>(
        method,
        path,
        options.body,
        options.query,
        options.captchaToken,
        options.timeoutMs,
      );
    }

    switch (method) {
      case 'GET':
        return this.httpClient.get<T>(path, options?.query);
      case 'POST':
        return this.httpClient.post<T>(path, options?.body);
      case 'PUT':
        return this.httpClient.put<T>(path, options?.body);
      case 'PATCH':
        return this.httpClient.patch<T>(path, options?.body);
      case 'DELETE':
        return this.httpClient.delete<T>(path);
      default:
        return this.httpClient.post<T>(path, options?.body);
    }
  }

  /**
   * Call a function and return its exact successful Response without reading
   * the body. Use this for streaming or binary payloads. Non-success responses
   * still throw an EdgeBaseError through the ordinary Function transport.
   */
  async callRaw(name: string, options?: FunctionCallOptions): Promise<Response> {
    const method = options?.method ?? 'POST';
    if (options?.signal) {
      return this.httpClient.requestFunctionRaw(
        method,
        `/api/functions/${name}`,
        options.body,
        options.query,
        options.captchaToken,
        options.timeoutMs,
        options.signal,
      );
    }
    return this.httpClient.requestFunctionRaw(
      method,
      `/api/functions/${name}`,
      options?.body,
      options?.query,
      options?.captchaToken,
      options?.timeoutMs,
    );
  }

  /** GET /api/functions/{path} */
  async get<T = unknown>(path: string, query?: Record<string, string>): Promise<T> {
    return this.call<T>(path, { method: 'GET', query });
  }

  /** POST /api/functions/{path} */
  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.call<T>(path, { method: 'POST', body });
  }

  /** PUT /api/functions/{path} */
  async put<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.call<T>(path, { method: 'PUT', body });
  }

  /** PATCH /api/functions/{path} */
  async patch<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.call<T>(path, { method: 'PATCH', body });
  }

  /** DELETE /api/functions/{path} */
  async delete<T = unknown>(path: string): Promise<T> {
    return this.call<T>(path, { method: 'DELETE' });
  }
}
