/**
 * 서버 단위 테스트 — lib/do-router.ts (config / DO 라우팅 유틸리티)
 * + 1-20 rate-limit.test.ts 관련 (service-key/rate-limit 유틸리티 포함)
 *
 * 실행: cd packages/server && npx vitest run src/__tests__/do-router.test.ts
 *
 * 테스트 대상:
 *   getDbDoName / parseDbDoName
 *   setConfig / parseConfig
 *   getTablesInNamespace / findTableNamespace
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getDbDoName,
  parseDbDoName,
  setConfig,
  parseConfig,
  getTablesInNamespace,
  findTableNamespace,
  formatDbTargetValidationIssue,
  callDO,
  callDOByHexId,
  isDynamicDbBlock,
  normalizeDbInstanceId,
  resolveDbTarget,
  shouldRouteToD1,
  getD1BindingName,
} from '../lib/do-router.js';

// ─── A. getDbDoName ──────────────────────────────────────────────────────────

describe('getDbDoName', () => {
  it('static namespace (no id) → returns namespace only', () => {
    expect(getDbDoName('shared')).toBe('shared');
  });

  it('dynamic namespace + id → namespace:id format', () => {
    expect(getDbDoName('workspace', 'ws-456')).toBe('workspace:ws-456');
  });

  it('user namespace', () => {
    expect(getDbDoName('user', 'user-123')).toBe('user:user-123');
  });

  it('id with colon → throws', () => {
    expect(() => getDbDoName('workspace', 'ws:bad')).toThrow();
  });

  it('error message mentions colon', () => {
    try {
      getDbDoName('workspace', 'ws:bad');
    } catch (err) {
      expect((err as Error).message).toContain(':');
    }
  });

  it('id with dash is fine', () => {
    expect(() => getDbDoName('workspace', 'ws-123')).not.toThrow();
  });

  it('empty id → treated as no id (static)', () => {
    // empty string is falsy
    expect(getDbDoName('shared', '')).toBe('shared');
  });

  it('undefined id → static DO name', () => {
    expect(getDbDoName('db')).toBe('db');
  });
});

// ─── B. parseDbDoName ────────────────────────────────────────────────────────

describe('parseDbDoName', () => {
  it('static name → { namespace, id: undefined }', () => {
    const result = parseDbDoName('shared');
    expect(result.namespace).toBe('shared');
    expect(result.id).toBeUndefined();
  });

  it('dynamic name → { namespace, id }', () => {
    const result = parseDbDoName('workspace:ws-456');
    expect(result.namespace).toBe('workspace');
    expect(result.id).toBe('ws-456');
  });

  it('only first colon separates (id may contain dash)', () => {
    const result = parseDbDoName('ns:my-id-123');
    expect(result.namespace).toBe('ns');
    expect(result.id).toBe('my-id-123');
  });

  it('round-trip: getDbDoName → parseDbDoName', () => {
    const doName = getDbDoName('user', 'user-abc');
    const parsed = parseDbDoName(doName);
    expect(parsed.namespace).toBe('user');
    expect(parsed.id).toBe('user-abc');
  });

  it('system name: db:_system → namespace=db, id=_system', () => {
    const result = parseDbDoName('db:_system');
    expect(result.namespace).toBe('db');
    expect(result.id).toBe('_system');
  });
});

// ─── C. setConfig / parseConfig ──────────────────────────────────────────────

describe('setConfig / parseConfig', () => {
  beforeEach(() => {
    // Reset singleton by re-setting empty config
    setConfig({});
    delete (globalThis as Record<string, unknown>).__EDGEBASE_RUNTIME_CONFIG__;
  });

  it('setConfig and parseConfig return same config', () => {
    const cfg = { databases: { shared: { tables: { posts: {} } } } } as any;
    setConfig(cfg);
    expect(parseConfig()).toEqual(cfg);
  });

  it('setConfig fails fast on normalization errors', () => {
    expect(() =>
      setConfig({
        databases: {
          shared: {
            tables: {
              'plugin-a/events': {},
            },
          },
        },
        plugins: [
          {
            name: 'plugin-a',
            pluginApiVersion: 1,
            config: {},
            tables: {
              events: {},
            },
          },
        ],
      } as any),
    ).toThrow('Plugin table collision');
  });

  it('singleton remains authoritative when runtime input is unrelated', () => {
    setConfig({ databases: { from: 'singleton' } } as any);
    const result = parseConfig({ ignored: true });
    expect((result as any).databases?.from).toBe('singleton');
  });

  it('empty singleton remains authoritative even when extra input is passed', () => {
    setConfig({} as any);
    const result = parseConfig({ ignored: { databases: { shared: { tables: { posts: {} } } } } });
    expect(result).toEqual({});
  });

  it('fresh module without startup config returns empty object', async () => {
    vi.resetModules();
    const fresh = await import('../lib/do-router.js');
    expect(fresh.parseConfig({ ignored: true })).toEqual({});
  });

  it('fresh module without startup config returns empty object', async () => {
    vi.resetModules();
    const fresh = await import('../lib/do-router.js');
    expect(fresh.parseConfig({ arbitrary: true })).toEqual({});
  });

  it('request-scoped EDGEBASE_CONFIG overrides singleton config', () => {
    setConfig({ databases: { from: 'singleton' } } as any);
    const result = parseConfig({
      EDGEBASE_CONFIG: JSON.stringify({
        databases: {
          shared: {
            tables: {
              posts: {},
            },
          },
        },
      }),
    });
    expect((result as any).databases?.shared?.tables?.posts).toEqual({});
    expect((result as any).databases?.from).toBeUndefined();
  });

  it('fresh module reads EDGEBASE_CONFIG when provided', async () => {
    vi.resetModules();
    const fresh = await import('../lib/do-router.js');
    expect(fresh.parseConfig({
      EDGEBASE_CONFIG: JSON.stringify({
        databases: {
          shared: {
            tables: {
              comments: {},
            },
          },
        },
      }),
    })).toEqual({
      databases: {
        shared: {
          tables: {
            comments: {},
          },
        },
      },
    });
  });

  it('fresh module can recover config from global runtime storage', async () => {
    const cfg = {
      storage: {
        buckets: {
          lab: {},
        },
      },
      serviceKeys: {
        keys: [
          {
            kid: 'test',
            tier: 'root',
            scopes: ['*'],
            secretSource: 'inline',
            inlineSecret: 'sk-test',
          },
        ],
      },
    } as any;

    setConfig(cfg);
    vi.resetModules();
    const fresh = await import('../lib/do-router.js');
    const result = fresh.parseConfig();

    expect((result as any).storage?.buckets?.lab).toEqual({});
    expect((result as any).serviceKeys?.keys?.[0]?.kid).toBe('test');
  });

  it('no singleton, no env → returns {}', () => {
    setConfig({} as any);
    const result = parseConfig();
    expect(result).toBeDefined();
  });
});

// ─── D. getTablesInNamespace ─────────────────────────────────────────────────

describe('getTablesInNamespace', () => {
  const config = {
    databases: {
      shared: {
        tables: {
          posts: {},
          users: {},
        },
      },
    },
  } as any;

  it('returns table names for namespace', () => {
    const tables = getTablesInNamespace('shared', config);
    expect(tables).toContain('posts');
    expect(tables).toContain('users');
  });

  it('unknown namespace → empty array', () => {
    const tables = getTablesInNamespace('unknown', config);
    expect(tables).toEqual([]);
  });

  it('no databases in config → empty array', () => {
    const tables = getTablesInNamespace('shared', {});
    expect(tables).toEqual([]);
  });

  it('no tables in namespace → empty array', () => {
    const tables = getTablesInNamespace('shared', {
      databases: { shared: {} },
    } as any);
    expect(tables).toEqual([]);
  });
});

// ─── E. findTableNamespace ────────────────────────────────────────────────────

describe('findTableNamespace', () => {
  const config = {
    databases: {
      shared: { tables: { posts: {}, comments: {} } },
      workspace: { tables: { workspaces: {}, members: {} } },
    },
  } as any;

  it('finds namespace for table in shared', () => {
    expect(findTableNamespace('posts', config)).toBe('shared');
  });

  it('finds namespace for table in workspace block', () => {
    expect(findTableNamespace('workspaces', config)).toBe('workspace');
  });

  it('unknown table → undefined', () => {
    expect(findTableNamespace('nonexistent', config)).toBeUndefined();
  });

  it('no databases → undefined', () => {
    expect(findTableNamespace('posts', {})).toBeUndefined();
  });

  it('comments in shared block', () => {
    expect(findTableNamespace('comments', config)).toBe('shared');
  });
});

// ─── F. Edge cases (mutation coverage) ────────────────────────────────────────

describe('getDbDoName — edge cases', () => {
  it('id with multiple colons → throws', () => {
    expect(() => getDbDoName('ns', 'a:b:c')).toThrow();
  });

  it('colon-only id → throws', () => {
    expect(() => getDbDoName('ns', ':')).toThrow();
  });

  it('namespace with special chars but no colon in id → ok', () => {
    expect(getDbDoName('my-ns', 'id_123')).toBe('my-ns:id_123');
  });
});

describe('parseDbDoName — edge cases', () => {
  it('colon at start → namespace="", id="foo"', () => {
    const result = parseDbDoName(':foo');
    expect(result.namespace).toBe('');
    expect(result.id).toBe('foo');
  });

  it('colon at end → namespace="foo", id=""', () => {
    const result = parseDbDoName('foo:');
    expect(result.namespace).toBe('foo');
    expect(result.id).toBe('');
  });

  it('multiple colons → first colon only', () => {
    const result = parseDbDoName('a:b:c');
    expect(result.namespace).toBe('a');
    expect(result.id).toBe('b:c');
  });

  it('single colon → namespace="", id=""', () => {
    const result = parseDbDoName(':');
    expect(result.namespace).toBe('');
    expect(result.id).toBe('');
  });

  it('empty string → { namespace: "" }', () => {
    const result = parseDbDoName('');
    expect(result.namespace).toBe('');
    expect(result.id).toBeUndefined();
  });
});

describe('getTablesInNamespace — edge cases', () => {
  it('namespace exists but tables is null → empty array', () => {
    const tables = getTablesInNamespace('shared', {
      databases: { shared: { tables: null } },
    } as any);
    expect(tables).toEqual([]);
  });

  it('returns exact keys (no prototype pollution)', () => {
    const config = {
      databases: {
        shared: {
          tables: Object.create(null, {
            posts: { value: {}, enumerable: true },
          }),
        },
      },
    } as any;
    const tables = getTablesInNamespace('shared', config);
    expect(tables).toEqual(['posts']);
  });
});

describe('findTableNamespace — edge cases', () => {
  it('tables is undefined in dbBlock → skip', () => {
    const config = {
      databases: { shared: {} },
    } as any;
    expect(findTableNamespace('posts', config)).toBeUndefined();
  });

  it('first match wins when table in multiple namespaces', () => {
    const config = {
      databases: {
        ns1: { tables: { shared_table: {} } },
        ns2: { tables: { shared_table: {} } },
      },
    } as any;
    const result = findTableNamespace('shared_table', config);
    // Object.entries iteration order → first entry wins
    expect(result).toBe('ns1');
  });

  it('__proto__ as table name → not found (prototype safety)', () => {
    const config = {
      databases: {
        shared: { tables: { posts: {} } },
      },
    } as any;
    expect(findTableNamespace('__proto__', config)).toBeUndefined();
  });
});

describe('parseConfig — edge cases', () => {
  it('fresh module with ignored runtime input still returns {}', async () => {
    vi.resetModules();
    const fresh = await import('../lib/do-router.js');
    const result = fresh.parseConfig({ ignored: '' });
    expect(result).toEqual({});
  });
});

// ─── H. callDO — mutation-killing ───────────────────────────────────────────
// Covers 36 no-coverage + 1 survived mutant in callDO/callDOByHexId

function createMockNamespace() {
  const fetchSpy = vi.fn(
    async (_url: string, _init?: RequestInit) => new Response('ok', { status: 200 }),
  );
  const mockStub = { fetch: fetchSpy };
  const mockId = { toString: () => 'mock-id' };
  const ns = {
    idFromName: vi.fn((_name: string) => mockId),
    idFromString: vi.fn((_hex: string) => mockId),
    get: vi.fn((_id: unknown) => mockStub),
  } as unknown as DurableObjectNamespace;
  return { ns, fetchSpy, mockStub, mockId };
}

/** Extract [url, init] from a fetch mock call with proper types. */
function mockCall(spy: ReturnType<typeof vi.fn>, index = 0) {
  const [url, init] = spy.mock.calls[index] as [string, RequestInit];
  const headers = init.headers as Record<string, string>;
  return { url, init, headers };
}

describe('callDO', () => {
  it('default GET request with correct URL and headers', async () => {
    const { ns, fetchSpy } = createMockNamespace();
    await callDO(ns, 'shared', '/api/tables');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const { url, init, headers } = mockCall(fetchSpy);
    expect(url).toBe('http://do/api/tables');
    expect(init.method).toBe('GET');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-DO-Name']).toBe('shared');
  });

  it('uses idFromName with the doName', async () => {
    const { ns } = createMockNamespace();
    await callDO(ns, 'workspace:ws-1', '/path');
    expect(ns.idFromName).toHaveBeenCalledWith('workspace:ws-1');
  });

  it('POST with body → body is JSON-stringified', async () => {
    const { ns, fetchSpy } = createMockNamespace();
    await callDO(ns, 'db', '/insert', {
      method: 'POST',
      body: { name: 'test', value: 42 },
    });

    const { init } = mockCall(fetchSpy);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ name: 'test', value: 42 }));
  });

  it('GET with body → body is NOT attached (GET semantics)', async () => {
    const { ns, fetchSpy } = createMockNamespace();
    await callDO(ns, 'db', '/read', {
      method: 'GET',
      body: { ignored: true },
    });

    const { init } = mockCall(fetchSpy);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });

  it('custom headers are merged with defaults', async () => {
    const { ns, fetchSpy } = createMockNamespace();
    await callDO(ns, 'db', '/path', {
      headers: { 'X-Custom': 'value', Authorization: 'Bearer tok' },
    });

    const { headers } = mockCall(fetchSpy);
    // Default headers preserved
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-DO-Name']).toBe('db');
    // Custom headers merged
    expect(headers['X-Custom']).toBe('value');
    expect(headers['Authorization']).toBe('Bearer tok');
  });

  it('custom header can override Content-Type', async () => {
    const { ns, fetchSpy } = createMockNamespace();
    await callDO(ns, 'db', '/path', {
      headers: { 'Content-Type': 'text/plain' },
    });

    const { headers } = mockCall(fetchSpy);
    // Spread puts custom header AFTER default → overrides
    expect(headers['Content-Type']).toBe('text/plain');
  });

  it('body undefined + non-GET method → no body in init', async () => {
    const { ns, fetchSpy } = createMockNamespace();
    await callDO(ns, 'db', '/delete', { method: 'DELETE' });

    const { init } = mockCall(fetchSpy);
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
  });

  it('returns the Response from stub.fetch', async () => {
    const { ns } = createMockNamespace();
    const response = await callDO(ns, 'db', '/test');
    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
  });

  it('no options → defaults to GET with default headers', async () => {
    const { ns, fetchSpy } = createMockNamespace();
    await callDO(ns, 'test', '/health');

    const { url, init, headers } = mockCall(fetchSpy);
    expect(url).toBe('http://do/health');
    expect(init.method).toBe('GET');
    expect(headers['X-DO-Name']).toBe('test');
  });

  it('PUT method with body → body included', async () => {
    const { ns, fetchSpy } = createMockNamespace();
    await callDO(ns, 'db', '/update', {
      method: 'PUT',
      body: { updated: true },
    });

    const { init } = mockCall(fetchSpy);
    expect(init.method).toBe('PUT');
    expect(init.body).toBe('{"updated":true}');
  });
});

// ─── I. callDOByHexId — mutation-killing ────────────────────────────────────

describe('callDOByHexId', () => {
  it('default GET request with correct URL', async () => {
    const { ns, fetchSpy } = createMockNamespace();
    await callDOByHexId(ns, 'abcd1234', '/backup');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const { url, init } = mockCall(fetchSpy);
    expect(url).toBe('http://do/backup');
    expect(init.method).toBe('GET');
  });

  it('uses idFromString (not idFromName)', async () => {
    const { ns } = createMockNamespace();
    await callDOByHexId(ns, 'deadbeef', '/path');
    expect(ns.idFromString).toHaveBeenCalledWith('deadbeef');
    expect(ns.idFromName).not.toHaveBeenCalled();
  });

  it('headers include Content-Type but NOT X-DO-Name', async () => {
    const { ns, fetchSpy } = createMockNamespace();
    await callDOByHexId(ns, 'hex123', '/path');

    const { headers } = mockCall(fetchSpy);
    expect(headers['Content-Type']).toBe('application/json');
    // callDOByHexId does NOT set X-DO-Name (unlike callDO)
    expect(headers['X-DO-Name']).toBeUndefined();
  });

  it('POST with body → JSON stringified', async () => {
    const { ns, fetchSpy } = createMockNamespace();
    await callDOByHexId(ns, 'hex', '/restore', {
      method: 'POST',
      body: { data: [1, 2, 3] },
    });

    const { init } = mockCall(fetchSpy);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ data: [1, 2, 3] }));
  });

  it('GET with body → body not attached', async () => {
    const { ns, fetchSpy } = createMockNamespace();
    await callDOByHexId(ns, 'hex', '/read', {
      method: 'GET',
      body: { skip: true },
    });

    const { init } = mockCall(fetchSpy);
    expect(init.body).toBeUndefined();
  });

  it('custom headers merged', async () => {
    const { ns, fetchSpy } = createMockNamespace();
    await callDOByHexId(ns, 'hex', '/path', {
      headers: { 'X-Token': 'abc' },
    });

    const { headers } = mockCall(fetchSpy);
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-Token']).toBe('abc');
  });

  it('DELETE without body → no body', async () => {
    const { ns, fetchSpy } = createMockNamespace();
    await callDOByHexId(ns, 'hex', '/remove', { method: 'DELETE' });

    const { init } = mockCall(fetchSpy);
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
  });

  it('returns the Response from stub.fetch', async () => {
    const { ns } = createMockNamespace();
    const response = await callDOByHexId(ns, 'hex', '/test');
    expect(response.status).toBe(200);
  });
});

// ─── J. shouldRouteToD1 ───────────────────────────────────────────────────────

describe('isDynamicDbBlock', () => {
  it('returns false for undefined db blocks', () => {
    expect(isDynamicDbBlock()).toBe(false);
  });

  it('returns false for single-instance db blocks without create/access semantics', () => {
    expect(isDynamicDbBlock({ tables: { posts: {} } } as any)).toBe(false);
  });

  it('returns true for db blocks with instance routing', () => {
    expect(isDynamicDbBlock({ instance: true, tables: {} } as any)).toBe(true);
  });

  it('returns true for db blocks with canCreate rules', () => {
    expect(isDynamicDbBlock({
      access: {
        canCreate: () => true,
      },
      tables: {},
    } as any)).toBe(true);
  });

  it('returns true for db blocks with access rules', () => {
    expect(isDynamicDbBlock({
      access: {
        access: () => true,
      },
      tables: {},
    } as any)).toBe(true);
  });
});

describe('normalizeDbInstanceId', () => {
  it('trims non-empty ids', () => {
    expect(normalizeDbInstanceId('  ws-1  ')).toBe('ws-1');
  });

  it('treats blank ids as undefined', () => {
    expect(normalizeDbInstanceId('   ')).toBeUndefined();
    expect(normalizeDbInstanceId(undefined)).toBeUndefined();
    expect(normalizeDbInstanceId(null)).toBeUndefined();
  });
});

describe('resolveDbTarget', () => {
  const config = {
    databases: {
      shared: { tables: { posts: {} } },
      workspace: { instance: true, tables: { members: {} } },
    },
  } as any;

  it('resolves single-instance namespaces without instance ids', () => {
    expect(resolveDbTarget(config, 'shared', undefined)).toEqual({
      ok: true,
      value: {
        namespace: 'shared',
        instanceId: undefined,
        dbBlock: config.databases.shared,
        dynamic: false,
      },
    });
  });

  it('rejects instance ids on single-instance namespaces', () => {
    const result = resolveDbTarget(config, 'shared', 'shadow');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue).toBe('instance_id_not_allowed');
    expect(formatDbTargetValidationIssue(result.issue, 'shared')).toBe(
      "instanceId is not allowed for single-instance namespace 'shared'",
    );
  });

  it('requires instance ids on dynamic namespaces', () => {
    const result = resolveDbTarget(config, 'workspace', undefined);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue).toBe('instance_id_required');
  });

  it('rejects ids containing colons', () => {
    const result = resolveDbTarget(config, 'workspace', 'ws:1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issue).toBe('instance_id_invalid');
  });

  it('returns not-found when the namespace is missing', () => {
    const result = resolveDbTarget(config, 'missing', undefined);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
    expect(result.issue).toBe('namespace_not_found');
  });
});

describe('shouldRouteToD1', () => {
  it('namespace not in config → false', () => {
    expect(shouldRouteToD1('unknown', {})).toBe(false);
  });

  it('explicit provider: "d1" → true', () => {
    expect(
      shouldRouteToD1('shared', {
        databases: { shared: { provider: 'd1', tables: { posts: {} } } },
      } as any),
    ).toBe(true);
  });

  it('explicit provider: "do" → false', () => {
    expect(
      shouldRouteToD1('shared', {
        databases: { shared: { provider: 'do', tables: { posts: {} } } },
      } as any),
    ).toBe(false);
  });

  it('explicit provider: "neon" → false', () => {
    expect(
      shouldRouteToD1('shared', {
        databases: { shared: { provider: 'neon', tables: { posts: {} } } },
      } as any),
    ).toBe(false);
  });

  it('explicit provider: "postgres" → false', () => {
    expect(
      shouldRouteToD1('shared', {
        databases: { shared: { provider: 'postgres', tables: { posts: {} } } },
      } as any),
    ).toBe(false);
  });

  it('instance: true → false (multi-tenant stays in DO)', () => {
    expect(
      shouldRouteToD1('workspace', {
        databases: { workspace: { instance: true, tables: { members: {} } } },
      } as any),
    ).toBe(false);
  });

  it('access.canCreate → false (multi-tenant)', () => {
    expect(
      shouldRouteToD1('workspace', {
        databases: { workspace: { access: { canCreate: 'auth.role == "admin"' }, tables: {} } },
      } as any),
    ).toBe(false);
  });

  it('access.access → false (multi-tenant)', () => {
    expect(
      shouldRouteToD1('workspace', {
        databases: { workspace: { access: { access: 'auth.role == "admin"' }, tables: {} } },
      } as any),
    ).toBe(false);
  });

  it('no provider, no instance, no access → auto-detect as D1', () => {
    expect(
      shouldRouteToD1('shared', {
        databases: { shared: { tables: { posts: {} } } },
      } as any),
    ).toBe(true);
  });

  it('empty databases block → false', () => {
    expect(shouldRouteToD1('shared', { databases: {} } as any)).toBe(false);
  });

  it('no databases at all → false', () => {
    expect(shouldRouteToD1('shared', {} as any)).toBe(false);
  });
});

// ─── K. getD1BindingName ──────────────────────────────────────────────────────

describe('getD1BindingName', () => {
  it('shared → DB_D1_SHARED', () => {
    expect(getD1BindingName('shared')).toBe('DB_D1_SHARED');
  });

  it('myData → DB_D1_MYDATA', () => {
    expect(getD1BindingName('myData')).toBe('DB_D1_MYDATA');
  });

  it('lowercase → uppercase', () => {
    expect(getD1BindingName('analytics')).toBe('DB_D1_ANALYTICS');
  });
});
