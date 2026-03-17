/**
 * Adapter: HttpClient → HttpTransport
 *
 * Bridges the existing HttpClient (get/post/patch/delete methods) to the
 * HttpTransport interface used by Generated Core classes.
 *
 * Only needed for the JS SDK — other language SDKs have generated cores
 * that call HttpClient methods directly.
 */

import type { HttpClient } from './http.js';
import type { HttpTransport } from './generated/api-core.js';

export class HttpClientAdapter implements HttpTransport {
  constructor(private readonly client: HttpClient) {}

  async head(path: string): Promise<boolean> {
    return this.client.head(path);
  }

  async request<T>(
    method: string,
    path: string,
    options?: { query?: Record<string, string>; body?: unknown },
  ): Promise<T> {
    switch (method) {
      case 'GET':
        return this.client.get<T>(path, options?.query);
      case 'POST':
        if (options?.query && Object.keys(options.query).length > 0) {
          return this.client.postWithQuery<T>(path, options?.body, options.query);
        }
        return this.client.post<T>(path, options?.body);
      case 'PATCH':
        return this.client.patch<T>(path, options?.body);
      case 'PUT':
        return this.client.put<T>(path, options?.body);
      case 'DELETE':
        return this.client.delete<T>(path, options?.body);
      default:
        throw new Error(`Unsupported HTTP method: ${method}`);
    }
  }
}

/**
 * Public (unauthenticated) adapter: HttpClient → HttpTransport
 *
 * Uses `postPublic()` for POST requests (skipAuth = true) so that
 * signup, signin, and other public auth endpoints never trigger
 * token-refresh logic or inject stale auth headers.
 */
export class PublicHttpClientAdapter implements HttpTransport {
  constructor(private readonly client: HttpClient) {}

  async head(path: string): Promise<boolean> {
    return this.client.head(path);
  }

  async request<T>(
    method: string,
    path: string,
    options?: { query?: Record<string, string>; body?: unknown },
  ): Promise<T> {
    switch (method) {
      case 'GET':
        return this.client.get<T>(path, options?.query);
      case 'POST':
        return this.client.postPublic<T>(path, options?.body);
      case 'PATCH':
        return this.client.patch<T>(path, options?.body);
      case 'PUT':
        return this.client.put<T>(path, options?.body);
      case 'DELETE':
        return this.client.delete<T>(path, options?.body);
      default:
        throw new Error(`Unsupported HTTP method: ${method}`);
    }
  }
}
