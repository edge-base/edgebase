/**
 * functions-routing.test.ts — Unit tests for App Functions route pattern matching & middleware.
 *
 * Tests pure-logic functions in src/lib/functions.ts:
 *   - compileRoutePattern (tested indirectly via registerFunction + rebuildCompiledRoutes + matchRoute)
 *   - calculateSpecificity (tested indirectly via route ordering in matchRoute)
 *   - matchRoute: exact match, param extraction, method filtering, 405 detection
 *   - routeExistsForPath: path existence check regardless of method
 *   - registerMiddleware / getMiddlewareChain: middleware ordering by directory depth
 *   - wrapMethodExport: raw function vs. defineFunction object with captcha
 *
 * These tests manipulate module-level state (functionRegistry, compiledRoutes, middlewareRegistry).
 * Each describe block uses beforeEach to clear and rebuild state for isolation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerFunction,
  clearFunctionRegistry,
  rebuildCompiledRoutes,
  matchRoute,
  routeExistsForPath,
  registerMiddleware,
  clearMiddlewareRegistry,
  getMiddlewareChain,
  wrapMethodExport,
} from '../../src/lib/functions.js';

// Helper: create a minimal HTTP FunctionDefinition
function httpDef(method?: string, handler?: (ctx: unknown) => Promise<unknown>, path?: string) {
  return {
    trigger: {
      type: 'http' as const,
      method: method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | undefined,
      ...(path ? { path } : {}),
    },
    handler: handler ?? (async () => ({ ok: true })),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. compileRoutePattern — tested indirectly via matchRoute
// ═══════════════════════════════════════════════════════════════════════════

describe('compileRoutePattern — static routes', () => {
  beforeEach(() => {
    clearFunctionRegistry();
    clearMiddlewareRegistry();
  });

  it('matches simple static route', () => {
    registerFunction('hello', httpDef());
    rebuildCompiledRoutes();
    const result = matchRoute('hello', 'GET');
    expect(result).not.toBeNull();
    expect(result!.route.name).toBe('hello');
    expect(result!.params).toEqual({});
  });

  it('matches nested static route', () => {
    registerFunction('api/users/list', httpDef());
    rebuildCompiledRoutes();
    const result = matchRoute('api/users/list', 'GET');
    expect(result).not.toBeNull();
    expect(result!.route.name).toBe('api/users/list');
  });

  it('does not match partial path', () => {
    registerFunction('users', httpDef());
    rebuildCompiledRoutes();
    expect(matchRoute('users/extra', 'GET')).toBeNull();
  });

  it('does not match empty path against static route', () => {
    registerFunction('hello', httpDef());
    rebuildCompiledRoutes();
    expect(matchRoute('', 'GET')).toBeNull();
  });

  it('matches empty/root route', () => {
    registerFunction('', httpDef());
    rebuildCompiledRoutes();
    const result = matchRoute('', 'GET');
    expect(result).not.toBeNull();
    expect(result!.route.name).toBe('');
  });

  it('matches custom trigger.path instead of registry name', () => {
    registerFunction('reports/top-authors', httpDef('GET', undefined, '/analytics/top-authors'));
    rebuildCompiledRoutes();
    const result = matchRoute('analytics/top-authors', 'GET');
    expect(result).not.toBeNull();
    expect(result!.route.name).toBe('reports/top-authors');
    expect(result!.route.path).toBe('analytics/top-authors');
  });

  it('normalizes leading and trailing slashes in trigger.path', () => {
    registerFunction('hello', httpDef('GET', undefined, '/hello/'));
    rebuildCompiledRoutes();
    expect(matchRoute('hello', 'GET')).not.toBeNull();
  });

  it('extracts params from colon-style custom trigger.path', () => {
    registerFunction('shortlink/resolve', httpDef('GET', undefined, '/s/:code'));
    rebuildCompiledRoutes();
    const result = matchRoute('s/abc123', 'GET');
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ code: 'abc123' });
    expect(result!.route.path).toBe('s/:code');
  });
});

describe('compileRoutePattern — dynamic params', () => {
  beforeEach(() => {
    clearFunctionRegistry();
    clearMiddlewareRegistry();
  });

  it('matches single dynamic param', () => {
    registerFunction('users/[userId]', httpDef());
    rebuildCompiledRoutes();
    const result = matchRoute('users/abc123', 'GET');
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ userId: 'abc123' });
  });

  it('matches multiple dynamic params', () => {
    registerFunction('users/[userId]/posts/[postId]', httpDef());
    rebuildCompiledRoutes();
    const result = matchRoute('users/u1/posts/p2', 'GET');
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ userId: 'u1', postId: 'p2' });
  });

  it('does not match dynamic param with extra segment', () => {
    registerFunction('users/[userId]', httpDef());
    rebuildCompiledRoutes();
    expect(matchRoute('users/abc/extra', 'GET')).toBeNull();
  });

  it('does not match dynamic param with slash in segment', () => {
    registerFunction('users/[userId]', httpDef());
    rebuildCompiledRoutes();
    // The param pattern [^/]+ won't match a path containing a /
    expect(matchRoute('users/abc/def', 'GET')).toBeNull();
  });

  it('decodes URI-encoded param values', () => {
    registerFunction('search/[query]', httpDef());
    rebuildCompiledRoutes();
    const result = matchRoute('search/hello%20world', 'GET');
    expect(result).not.toBeNull();
    expect(result!.params.query).toBe('hello world');
  });

  it('extracts params from custom trigger.path', () => {
    registerFunction('shortlink/resolve', httpDef('GET', undefined, '/s/[code]'));
    rebuildCompiledRoutes();
    const result = matchRoute('s/eb-123', 'GET');
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ code: 'eb-123' });
  });
});

describe('compileRoutePattern — catch-all', () => {
  beforeEach(() => {
    clearFunctionRegistry();
    clearMiddlewareRegistry();
  });

  it('matches catch-all with single segment', () => {
    registerFunction('docs/[...slug]', httpDef());
    rebuildCompiledRoutes();
    const result = matchRoute('docs/intro', 'GET');
    expect(result).not.toBeNull();
    expect(result!.params.slug).toBe('intro');
  });

  it('matches catch-all with multiple segments', () => {
    registerFunction('docs/[...slug]', httpDef());
    rebuildCompiledRoutes();
    const result = matchRoute('docs/guides/getting-started/install', 'GET');
    expect(result).not.toBeNull();
    expect(result!.params.slug).toBe('guides/getting-started/install');
  });

  it('catch-all does NOT match empty trailing segment', () => {
    registerFunction('docs/[...slug]', httpDef());
    rebuildCompiledRoutes();
    // (.+) requires at least one character
    expect(matchRoute('docs/', 'GET')).toBeNull();
  });
});

describe('compileRoutePattern — nested paths', () => {
  beforeEach(() => {
    clearFunctionRegistry();
    clearMiddlewareRegistry();
  });

  it('matches deeply nested static path', () => {
    registerFunction('admin/settings/security/mfa', httpDef());
    rebuildCompiledRoutes();
    expect(matchRoute('admin/settings/security/mfa', 'GET')).not.toBeNull();
  });

  it('matches deeply nested path with mixed static and dynamic', () => {
    registerFunction('orgs/[orgId]/teams/[teamId]/members', httpDef());
    rebuildCompiledRoutes();
    const result = matchRoute('orgs/org-1/teams/team-2/members', 'GET');
    expect(result).not.toBeNull();
    expect(result!.params).toEqual({ orgId: 'org-1', teamId: 'team-2' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. calculateSpecificity — tested via route ordering
// ═══════════════════════════════════════════════════════════════════════════

describe('calculateSpecificity — static > dynamic > catch-all ordering', () => {
  beforeEach(() => {
    clearFunctionRegistry();
    clearMiddlewareRegistry();
  });

  it('static route wins over dynamic param at same depth', () => {
    // Register dynamic first, then static — static should still win
    registerFunction('[slug]', httpDef());
    registerFunction('about', httpDef());
    rebuildCompiledRoutes();
    const result = matchRoute('about', 'GET');
    expect(result).not.toBeNull();
    expect(result!.route.name).toBe('about');
  });

  it('dynamic param wins over catch-all', () => {
    registerFunction('docs/[...slug]', httpDef());
    registerFunction('docs/[docId]', httpDef());
    rebuildCompiledRoutes();
    // 'docs/intro' should match the dynamic [docId] before catch-all
    const result = matchRoute('docs/intro', 'GET');
    expect(result).not.toBeNull();
    expect(result!.route.name).toBe('docs/[docId]');
  });

  it('more specific (deeper) static route wins', () => {
    registerFunction('users', httpDef());
    registerFunction('users/list', httpDef());
    rebuildCompiledRoutes();
    const result = matchRoute('users/list', 'GET');
    expect(result).not.toBeNull();
    expect(result!.route.name).toBe('users/list');
  });

  it('static segment + dynamic is more specific than all-dynamic', () => {
    registerFunction('[a]/[b]', httpDef());
    registerFunction('users/[userId]', httpDef());
    rebuildCompiledRoutes();
    const result = matchRoute('users/abc', 'GET');
    expect(result).not.toBeNull();
    expect(result!.route.name).toBe('users/[userId]');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. matchRoute — method filtering and 405 detection
// ═══════════════════════════════════════════════════════════════════════════

describe('matchRoute — method filtering', () => {
  beforeEach(() => {
    clearFunctionRegistry();
    clearMiddlewareRegistry();
  });

  it('matches exact method', () => {
    registerFunction('users', httpDef('GET'));
    rebuildCompiledRoutes();
    const result = matchRoute('users', 'GET');
    expect(result).not.toBeNull();
  });

  it('rejects wrong method', () => {
    registerFunction('users', httpDef('GET'));
    rebuildCompiledRoutes();
    expect(matchRoute('users', 'POST')).toBeNull();
  });

  it('method matching is case-insensitive', () => {
    registerFunction('users', httpDef('GET'));
    rebuildCompiledRoutes();
    expect(matchRoute('users', 'get')).not.toBeNull();
  });

  it('null method (any) matches all HTTP methods', () => {
    registerFunction('wildcard', httpDef()); // no method → null → matches all
    rebuildCompiledRoutes();
    expect(matchRoute('wildcard', 'GET')).not.toBeNull();
    expect(matchRoute('wildcard', 'POST')).not.toBeNull();
    expect(matchRoute('wildcard', 'DELETE')).not.toBeNull();
  });

  it('multiple routes for same path with different methods', () => {
    clearFunctionRegistry();
    registerFunction('items', {
      trigger: { type: 'http', method: 'GET' },
      handler: async () => ({ method: 'get' }),
    });
    registerFunction('items', {
      trigger: { type: 'http', method: 'POST' },
      handler: async () => ({ method: 'post' }),
    });
    rebuildCompiledRoutes();
    expect(matchRoute('items', 'GET')).not.toBeNull();
    expect(matchRoute('items', 'POST')).not.toBeNull();
    expect(routeExistsForPath('items')).toBe(true);
  });

  it('allows same custom path for different methods', () => {
    registerFunction('links/list', httpDef('GET', undefined, '/links'));
    registerFunction('links/create', httpDef('POST', undefined, '/links'));
    rebuildCompiledRoutes();
    expect(matchRoute('links', 'GET')?.route.name).toBe('links/list');
    expect(matchRoute('links', 'POST')?.route.name).toBe('links/create');
  });

  it('rejects colliding custom paths for the same method', () => {
    registerFunction('reports/a', httpDef('GET', undefined, '/reports'));
    registerFunction('reports/b', httpDef('GET', undefined, '/reports/'));
    expect(() => rebuildCompiledRoutes()).toThrow(/HTTP route collision/);
  });
});

describe('matchRoute — param extraction', () => {
  beforeEach(() => {
    clearFunctionRegistry();
    clearMiddlewareRegistry();
  });

  it('extracts single param', () => {
    registerFunction('products/[id]', httpDef());
    rebuildCompiledRoutes();
    const result = matchRoute('products/prod-42', 'GET');
    expect(result!.params).toEqual({ id: 'prod-42' });
  });

  it('extracts multiple params from nested route', () => {
    registerFunction('users/[userId]/posts/[postId]/comments/[commentId]', httpDef());
    rebuildCompiledRoutes();
    const result = matchRoute('users/u1/posts/p2/comments/c3', 'GET');
    expect(result!.params).toEqual({ userId: 'u1', postId: 'p2', commentId: 'c3' });
  });

  it('catch-all extracts full remaining path', () => {
    registerFunction('files/[...path]', httpDef());
    rebuildCompiledRoutes();
    const result = matchRoute('files/a/b/c/d.txt', 'GET');
    expect(result!.params.path).toBe('a/b/c/d.txt');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. routeExistsForPath — 405 detection
// ═══════════════════════════════════════════════════════════════════════════

describe('routeExistsForPath — 405 detection', () => {
  beforeEach(() => {
    clearFunctionRegistry();
    clearMiddlewareRegistry();
  });

  it('returns true for registered path (any method)', () => {
    registerFunction('users', httpDef('GET'));
    rebuildCompiledRoutes();
    expect(routeExistsForPath('users')).toBe(true);
  });

  it('returns false for unregistered path', () => {
    registerFunction('users', httpDef());
    rebuildCompiledRoutes();
    expect(routeExistsForPath('posts')).toBe(false);
  });

  it('returns true for dynamic path match', () => {
    registerFunction('users/[userId]', httpDef('GET'));
    rebuildCompiledRoutes();
    expect(routeExistsForPath('users/abc')).toBe(true);
  });

  it('route exists but method mismatch -> routeExistsForPath still true', () => {
    // Route registered for GET only
    registerFunction('items', httpDef('GET'));
    rebuildCompiledRoutes();
    // matchRoute for POST returns null (method mismatch)
    expect(matchRoute('items', 'POST')).toBeNull();
    // but routeExistsForPath ignores method and returns true (for 405 detection)
    expect(routeExistsForPath('items')).toBe(true);
  });

  it('returns false after clearing registry and rebuilding', () => {
    registerFunction('hello', httpDef());
    rebuildCompiledRoutes();
    expect(routeExistsForPath('hello')).toBe(true);
    clearFunctionRegistry();
    rebuildCompiledRoutes();
    expect(routeExistsForPath('hello')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. getMiddlewareChain — root, nested directory, ordering
// ═══════════════════════════════════════════════════════════════════════════

describe('getMiddlewareChain — middleware ordering', () => {
  beforeEach(() => {
    clearFunctionRegistry();
    clearMiddlewareRegistry();
  });

  it('returns empty chain when no middleware registered', () => {
    const chain = getMiddlewareChain('users/list');
    expect(chain).toHaveLength(0);
  });

  it('returns root middleware for any function', () => {
    const rootMw = async () => ({ root: true });
    registerMiddleware('', rootMw);
    const chain = getMiddlewareChain('users/list');
    expect(chain).toHaveLength(1);
    expect(chain[0]).toBe(rootMw);
  });

  it('returns root + directory middleware in order', () => {
    const rootMw = async () => ({ root: true });
    const adminMw = async () => ({ admin: true });
    registerMiddleware('', rootMw);
    registerMiddleware('admin', adminMw);
    const chain = getMiddlewareChain('admin/users');
    expect(chain).toHaveLength(2);
    expect(chain[0]).toBe(rootMw);
    expect(chain[1]).toBe(adminMw);
  });

  it('returns nested middleware chain ordered root -> parent -> child', () => {
    const rootMw = async () => ({ level: 0 });
    const adminMw = async () => ({ level: 1 });
    const settingsMw = async () => ({ level: 2 });
    registerMiddleware('', rootMw);
    registerMiddleware('admin', adminMw);
    registerMiddleware('admin/settings', settingsMw);
    const chain = getMiddlewareChain('admin/settings/mfa');
    expect(chain).toHaveLength(3);
    expect(chain[0]).toBe(rootMw);
    expect(chain[1]).toBe(adminMw);
    expect(chain[2]).toBe(settingsMw);
  });

  it('skips directories without middleware', () => {
    const rootMw = async () => ({ root: true });
    const deepMw = async () => ({ deep: true });
    registerMiddleware('', rootMw);
    // No middleware for 'api' directory
    registerMiddleware('api/admin', deepMw);
    const chain = getMiddlewareChain('api/admin/users');
    expect(chain).toHaveLength(2);
    expect(chain[0]).toBe(rootMw);
    expect(chain[1]).toBe(deepMw);
  });

  it('root-level function only gets root middleware', () => {
    const rootMw = async () => ({ root: true });
    const adminMw = async () => ({ admin: true });
    registerMiddleware('', rootMw);
    registerMiddleware('admin', adminMw);
    // 'hello' is at root level — only root middleware applies
    const chain = getMiddlewareChain('hello');
    expect(chain).toHaveLength(1);
    expect(chain[0]).toBe(rootMw);
  });

  it('empty function name returns only root middleware', () => {
    const rootMw = async () => ({ root: true });
    registerMiddleware('', rootMw);
    const chain = getMiddlewareChain('');
    expect(chain).toHaveLength(1);
    expect(chain[0]).toBe(rootMw);
  });

  it('registerMiddleware accepts default export object', () => {
    const handler = async () => ({ middleware: true });
    registerMiddleware('', { default: handler });
    const chain = getMiddlewareChain('users');
    expect(chain).toHaveLength(1);
    expect(chain[0]).toBe(handler);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. wrapMethodExport — raw function and defineFunction object
// ═══════════════════════════════════════════════════════════════════════════

describe('wrapMethodExport', () => {
  it('wraps raw function into FunctionDefinition', () => {
    const fn = async () => ({ data: 'test' });
    const def = wrapMethodExport(fn, 'GET');
    expect(def.trigger).toEqual({ type: 'http', method: 'GET' });
    expect(def.handler).toBe(fn);
    expect(def.captcha).toBeUndefined();
  });

  it('wraps POST method', () => {
    const fn = async () => ({});
    const def = wrapMethodExport(fn, 'POST');
    expect(def.trigger).toEqual({ type: 'http', method: 'POST' });
  });

  it('wraps PUT method', () => {
    const fn = async () => ({});
    const def = wrapMethodExport(fn, 'PUT');
    expect(def.trigger).toEqual({ type: 'http', method: 'PUT' });
  });

  it('wraps DELETE method', () => {
    const fn = async () => ({});
    const def = wrapMethodExport(fn, 'DELETE');
    expect(def.trigger).toEqual({ type: 'http', method: 'DELETE' });
  });

  it('wraps PATCH method', () => {
    const fn = async () => ({});
    const def = wrapMethodExport(fn, 'PATCH');
    expect(def.trigger).toEqual({ type: 'http', method: 'PATCH' });
  });

  it('extracts handler from defineFunction object', () => {
    const fn = async () => ({ hello: 'world' });
    const def = wrapMethodExport({ handler: fn }, 'GET');
    expect(def.handler).toBe(fn);
  });

  it('extracts captcha flag from defineFunction object', () => {
    const fn = async () => ({});
    const def = wrapMethodExport({ handler: fn, captcha: true }, 'POST');
    expect(def.captcha).toBe(true);
    expect(def.trigger).toEqual({ type: 'http', method: 'POST' });
  });

  it('preserves trigger.path from defineFunction object', () => {
    const fn = async () => ({});
    const def = wrapMethodExport({ handler: fn, trigger: { path: '/custom/path' } }, 'GET');
    expect(def.trigger).toEqual({ type: 'http', method: 'GET', path: '/custom/path' });
  });

  it('prefers module-level trigger.path when provided by the registry', () => {
    const fn = async () => ({});
    const def = wrapMethodExport({ handler: fn, trigger: { path: '/stale-path' } }, 'GET', {
      path: '/fresh-path',
    });
    expect(def.trigger).toEqual({ type: 'http', method: 'GET', path: '/fresh-path' });
  });

  it('captcha false from defineFunction object', () => {
    const fn = async () => ({});
    const def = wrapMethodExport({ handler: fn, captcha: false }, 'POST');
    expect(def.captcha).toBe(false);
  });

  it('no captcha field when using raw function', () => {
    const fn = async () => ({});
    const def = wrapMethodExport(fn, 'GET');
    expect(def.captcha).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. rebuildCompiledRoutes — sorting and non-HTTP exclusion
// ═══════════════════════════════════════════════════════════════════════════

describe('rebuildCompiledRoutes', () => {
  beforeEach(() => {
    clearFunctionRegistry();
    clearMiddlewareRegistry();
  });

  it('skips non-HTTP trigger functions', () => {
    registerFunction('onInsert', {
      trigger: { type: 'db', table: 'posts', event: 'insert' },
      handler: async () => ({}),
    });
    registerFunction('hello', httpDef());
    rebuildCompiledRoutes();
    // Only HTTP function should be matchable
    expect(matchRoute('hello', 'GET')).not.toBeNull();
    expect(matchRoute('onInsert', 'GET')).toBeNull();
  });

  it('rebuilding clears previous routes', () => {
    registerFunction('old-route', httpDef());
    rebuildCompiledRoutes();
    expect(matchRoute('old-route', 'GET')).not.toBeNull();

    clearFunctionRegistry();
    registerFunction('new-route', httpDef());
    rebuildCompiledRoutes();
    expect(matchRoute('old-route', 'GET')).toBeNull();
    expect(matchRoute('new-route', 'GET')).not.toBeNull();
  });

  it('routes are sorted most-specific-first', () => {
    // Register in reverse specificity order
    registerFunction('[...slug]', httpDef());
    registerFunction('[id]', httpDef());
    registerFunction('about', httpDef());
    rebuildCompiledRoutes();
    // 'about' is static and should match itself (not the dynamic/catch-all)
    const result = matchRoute('about', 'GET');
    expect(result!.route.name).toBe('about');
  });
});
