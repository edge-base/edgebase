/**
 * @edgebase-fun/core — FunctionsClient unit tests.
 *
 * Tests:
 *   - FunctionsClient.call: URL construction, method routing, body/query forwarding
 *   - Shorthand methods: get, post, put, patch, delete
 *
 * Execution: cd packages/sdk/js/packages/core && npx vitest run
 *
 * Principle: No server needed — tests verify that FunctionsClient correctly delegates
 * to HttpClient methods with the right path, body, and query parameters.
 * HttpClient methods are spied on via vi.spyOn to verify call arguments.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpClient } from '../../src/http.js';
import { ContextManager } from '../../src/context.js';
import { FunctionsClient } from '../../src/functions.js';

// ─── Setup: Create a real HttpClient, spy on its methods ─────────────────────

let httpClient: HttpClient;
let functionsClient: FunctionsClient;

beforeEach(() => {
  const cm = new ContextManager();
  httpClient = new HttpClient({ baseUrl: 'http://localhost:8688', contextManager: cm });
  functionsClient = new FunctionsClient(httpClient);

  // Spy on all HttpClient methods so we can verify calls without making real requests
  vi.spyOn(httpClient, 'get').mockResolvedValue({ data: 'get-response' });
  vi.spyOn(httpClient, 'post').mockResolvedValue({ data: 'post-response' });
  vi.spyOn(httpClient, 'put').mockResolvedValue({ data: 'put-response' });
  vi.spyOn(httpClient, 'patch').mockResolvedValue({ data: 'patch-response' });
  vi.spyOn(httpClient, 'delete').mockResolvedValue({ data: 'delete-response' });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. FunctionsClient.call — URL construction
// ═══════════════════════════════════════════════════════════════════════════

describe('FunctionsClient.call — URL construction', () => {
  it('builds /api/functions/{name} path', async () => {
    await functionsClient.call('hello');
    expect(httpClient.post).toHaveBeenCalledWith('/api/functions/hello', undefined);
  });

  it('builds path for nested function name', async () => {
    await functionsClient.call('users/abc123/profile');
    expect(httpClient.post).toHaveBeenCalledWith('/api/functions/users/abc123/profile', undefined);
  });

  it('handles function name with special characters', async () => {
    await functionsClient.call('my-function');
    expect(httpClient.post).toHaveBeenCalledWith('/api/functions/my-function', undefined);
  });

  it('handles empty function name (root)', async () => {
    await functionsClient.call('');
    expect(httpClient.post).toHaveBeenCalledWith('/api/functions/', undefined);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. FunctionsClient.call — method routing
// ═══════════════════════════════════════════════════════════════════════════

describe('FunctionsClient.call — method routing', () => {
  it('defaults to POST when no method specified', async () => {
    await functionsClient.call('hello');
    expect(httpClient.post).toHaveBeenCalledTimes(1);
    expect(httpClient.get).not.toHaveBeenCalled();
  });

  it('routes to GET', async () => {
    await functionsClient.call('hello', { method: 'GET' });
    expect(httpClient.get).toHaveBeenCalledTimes(1);
    expect(httpClient.post).not.toHaveBeenCalled();
  });

  it('routes to POST', async () => {
    await functionsClient.call('hello', { method: 'POST', body: { data: 1 } });
    expect(httpClient.post).toHaveBeenCalledWith('/api/functions/hello', { data: 1 });
  });

  it('routes to PUT', async () => {
    await functionsClient.call('hello', { method: 'PUT', body: { update: true } });
    expect(httpClient.put).toHaveBeenCalledWith('/api/functions/hello', { update: true });
  });

  it('routes to PATCH', async () => {
    await functionsClient.call('hello', { method: 'PATCH', body: { partial: true } });
    expect(httpClient.patch).toHaveBeenCalledWith('/api/functions/hello', { partial: true });
  });

  it('routes to DELETE', async () => {
    await functionsClient.call('hello', { method: 'DELETE' });
    expect(httpClient.delete).toHaveBeenCalledWith('/api/functions/hello');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. FunctionsClient.call — body and query forwarding
// ═══════════════════════════════════════════════════════════════════════════

describe('FunctionsClient.call — body forwarding', () => {
  it('POST forwards body', async () => {
    const body = { name: 'June', age: 25 };
    await functionsClient.call('create-user', { method: 'POST', body });
    expect(httpClient.post).toHaveBeenCalledWith('/api/functions/create-user', body);
  });

  it('POST with undefined body', async () => {
    await functionsClient.call('hello', { method: 'POST' });
    expect(httpClient.post).toHaveBeenCalledWith('/api/functions/hello', undefined);
  });

  it('PUT forwards body', async () => {
    await functionsClient.call('update', { method: 'PUT', body: { status: 'active' } });
    expect(httpClient.put).toHaveBeenCalledWith('/api/functions/update', { status: 'active' });
  });

  it('PATCH forwards body', async () => {
    await functionsClient.call('patch-user', { method: 'PATCH', body: { email: 'new@test.com' } });
    expect(httpClient.patch).toHaveBeenCalledWith('/api/functions/patch-user', { email: 'new@test.com' });
  });

  it('GET ignores body (uses query instead)', async () => {
    const query = { page: '1', limit: '10' };
    await functionsClient.call('list', { method: 'GET', query });
    expect(httpClient.get).toHaveBeenCalledWith('/api/functions/list', query);
  });

  it('GET with query parameters', async () => {
    await functionsClient.call('search', { method: 'GET', query: { q: 'test', sort: 'desc' } });
    expect(httpClient.get).toHaveBeenCalledWith('/api/functions/search', { q: 'test', sort: 'desc' });
  });

  it('GET without query passes undefined', async () => {
    await functionsClient.call('hello', { method: 'GET' });
    expect(httpClient.get).toHaveBeenCalledWith('/api/functions/hello', undefined);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Shorthand methods — get, post, put, patch, delete
// ═══════════════════════════════════════════════════════════════════════════

describe('FunctionsClient.get', () => {
  it('delegates to call with method GET', async () => {
    await functionsClient.get('users');
    expect(httpClient.get).toHaveBeenCalledWith('/api/functions/users', undefined);
  });

  it('passes query parameters', async () => {
    await functionsClient.get('users', { page: '2' });
    expect(httpClient.get).toHaveBeenCalledWith('/api/functions/users', { page: '2' });
  });

  it('returns the response', async () => {
    const result = await functionsClient.get('users');
    expect(result).toEqual({ data: 'get-response' });
  });
});

describe('FunctionsClient.post', () => {
  it('delegates to call with method POST', async () => {
    await functionsClient.post('create', { name: 'test' });
    expect(httpClient.post).toHaveBeenCalledWith('/api/functions/create', { name: 'test' });
  });

  it('handles undefined body', async () => {
    await functionsClient.post('trigger');
    expect(httpClient.post).toHaveBeenCalledWith('/api/functions/trigger', undefined);
  });

  it('returns the response', async () => {
    const result = await functionsClient.post('create', { data: 1 });
    expect(result).toEqual({ data: 'post-response' });
  });
});

describe('FunctionsClient.put', () => {
  it('delegates to call with method PUT', async () => {
    await functionsClient.put('replace', { full: 'object' });
    expect(httpClient.put).toHaveBeenCalledWith('/api/functions/replace', { full: 'object' });
  });

  it('handles undefined body', async () => {
    await functionsClient.put('reset');
    expect(httpClient.put).toHaveBeenCalledWith('/api/functions/reset', undefined);
  });

  it('returns the response', async () => {
    const result = await functionsClient.put('update');
    expect(result).toEqual({ data: 'put-response' });
  });
});

describe('FunctionsClient.patch', () => {
  it('delegates to call with method PATCH', async () => {
    await functionsClient.patch('edit', { field: 'value' });
    expect(httpClient.patch).toHaveBeenCalledWith('/api/functions/edit', { field: 'value' });
  });

  it('handles undefined body', async () => {
    await functionsClient.patch('touch');
    expect(httpClient.patch).toHaveBeenCalledWith('/api/functions/touch', undefined);
  });

  it('returns the response', async () => {
    const result = await functionsClient.patch('edit');
    expect(result).toEqual({ data: 'patch-response' });
  });
});

describe('FunctionsClient.delete', () => {
  it('delegates to call with method DELETE', async () => {
    await functionsClient.delete('remove');
    expect(httpClient.delete).toHaveBeenCalledWith('/api/functions/remove');
  });

  it('works with nested path', async () => {
    await functionsClient.delete('users/abc/sessions');
    expect(httpClient.delete).toHaveBeenCalledWith('/api/functions/users/abc/sessions');
  });

  it('returns the response', async () => {
    const result = await functionsClient.delete('remove');
    expect(result).toEqual({ data: 'delete-response' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Return value propagation
// ═══════════════════════════════════════════════════════════════════════════

describe('FunctionsClient — return value propagation', () => {
  it('call returns whatever HttpClient returns', async () => {
    vi.spyOn(httpClient, 'post').mockResolvedValue({ users: [{ id: '1' }] });
    const result = await functionsClient.call('list-users');
    expect(result).toEqual({ users: [{ id: '1' }] });
  });

  it('call propagates typed response', async () => {
    interface UserResponse { id: string; name: string }
    vi.spyOn(httpClient, 'get').mockResolvedValue({ id: 'u1', name: 'June' });
    const result = await functionsClient.call<UserResponse>('get-user', { method: 'GET' });
    expect(result.id).toBe('u1');
    expect(result.name).toBe('June');
  });
});
