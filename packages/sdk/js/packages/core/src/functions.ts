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
