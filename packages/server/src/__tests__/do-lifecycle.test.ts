/**
 * 서버 단위 테스트 — lib/do-router.ts (DO 라이프사이클)
 * 1-25 do-lifecycle.test.ts — 50개
 *
 * 실행: cd packages/server && npx vitest run src/__tests__/do-lifecycle.test.ts
 */

import { describe, it, expect, vi } from 'vitest';
import {
  getDbDoName,
  parseDbDoName,
  parseConfig,
  setConfig,
  getTablesInNamespace,
  findTableNamespace,
} from '../lib/do-router.js';
import type { EdgeBaseConfig } from '@edgebase-fun/shared';

// ─── A. getDbDoName ────────────────────────────────────────────────────────────

describe('getDbDoName', () => {
  it('static DB — no id → returns namespace', () => {
    expect(getDbDoName('shared')).toBe('shared');
  });

  it('dynamic DB — namespace:id', () => {
    expect(getDbDoName('workspace', 'ws-123')).toBe('workspace:ws-123');
  });

  it('user namespace with id', () => {
    expect(getDbDoName('user', 'uid-456')).toBe('user:uid-456');
  });

  it('throws when id contains colon', () => {
    expect(() => getDbDoName('workspace', 'bad:id')).toThrow(/:/);
  });

  it('throws for multiple colons in id', () => {
    expect(() => getDbDoName('ns', 'a:b:c')).toThrow();
  });

  it('empty id treated as no id → namespace only', () => {
    // empty string is falsy → returns namespace
    expect(getDbDoName('shared', '')).toBe('shared');
  });

  it('different namespaces produce different names', () => {
    const a = getDbDoName('workspace', 'same-id');
    const b = getDbDoName('team', 'same-id');
    expect(a).not.toBe(b);
  });

  it('same namespace+id is idempotent (deterministic)', () => {
    expect(getDbDoName('workspace', 'ws-99')).toBe(getDbDoName('workspace', 'ws-99'));
  });
});

// ─── B. parseDbDoName ────────────────────────────────────────────────────────

describe('parseDbDoName', () => {
  it('static DO name → namespace only', () => {
    const result = parseDbDoName('shared');
    expect(result.namespace).toBe('shared');
    expect(result.id).toBeUndefined();
  });

  it('namespace:id → both parsed', () => {
    const result = parseDbDoName('workspace:ws-456');
    expect(result.namespace).toBe('workspace');
    expect(result.id).toBe('ws-456');
  });

  it('user:uid format', () => {
    const result = parseDbDoName('user:uid-123');
    expect(result.namespace).toBe('user');
    expect(result.id).toBe('uid-123');
  });

  it('colon at start → namespace="" id=rest', () => {
    const result = parseDbDoName(':something');
    expect(result.namespace).toBe('');
  });

  it('multiple colons — only first split', () => {
    // colon index is first → namespace=a, id=b:c
    const result = parseDbDoName('a:b:c');
    expect(result.namespace).toBe('a');
    expect(result.id).toBe('b:c');
  });
});

// ─── C. parseConfig / setConfig ──────────────────────────────────────────────

describe('parseConfig', () => {
  async function loadFreshDoRouter() {
    vi.resetModules();
    return import('../lib/do-router.js');
  }

  it('fresh module returns empty object when no env or singleton', async () => {
    const fresh = await loadFreshDoRouter();
    expect(fresh.parseConfig({})).toEqual({});
  });

  it('fresh module ignores ad-hoc runtime input', async () => {
    const fresh = await loadFreshDoRouter();
    expect(fresh.parseConfig({ arbitrary: true })).toEqual({});
  });

  it('fresh module returns empty object on invalid-looking runtime input', async () => {
    const fresh = await loadFreshDoRouter();
    expect(fresh.parseConfig({ arbitrary: '{ bad json }' })).toEqual({});
  });

  it('fresh module returns empty object when runtime input is undefined', async () => {
    const fresh = await loadFreshDoRouter();
    expect(fresh.parseConfig({ arbitrary: undefined })).toEqual({});
  });

  it('fresh module reads EDGEBASE_CONFIG from request env', async () => {
    const fresh = await loadFreshDoRouter();
    expect(fresh.parseConfig({
      EDGEBASE_CONFIG: JSON.stringify({
        databases: {
          shared: {
            tables: {
              posts: {},
            },
          },
        },
      }),
    })).toEqual({
      databases: {
        shared: {
          tables: {
            posts: {},
          },
        },
      },
    });
  });
});

describe('setConfig', () => {
  it('injects config into singleton', () => {
    const cfg: EdgeBaseConfig = { databases: { shared: { tables: { posts: {} } } } };
    setConfig(cfg);
    const result = parseConfig({});
    // After setConfig, singleton takes priority
    expect(result).toBe(cfg);
    // Reset for other tests
    setConfig({} as EdgeBaseConfig);
  });

  it('request EDGEBASE_CONFIG overrides singleton when present', () => {
    setConfig({ databases: { shared: { tables: { posts: {} } } } } as EdgeBaseConfig);
    expect(parseConfig({
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
    setConfig({} as EdgeBaseConfig);
  });
});

// ─── D. getTablesInNamespace ──────────────────────────────────────────────────

describe('getTablesInNamespace', () => {
  const config: EdgeBaseConfig = {
    databases: {
      shared: {
        tables: { posts: {}, comments: {}, tags: {} },
      },
      workspace: {
        tables: { docs: {}, tasks: {} },
      },
    },
  };

  it('returns table names for namespace', () => {
    const tables = getTablesInNamespace('shared', config);
    expect(tables).toContain('posts');
    expect(tables).toContain('comments');
    expect(tables).toContain('tags');
  });

  it('returns tables for different namespace', () => {
    const tables = getTablesInNamespace('workspace', config);
    expect(tables).toContain('docs');
    expect(tables).toContain('tasks');
  });

  it('returns empty array for missing namespace', () => {
    expect(getTablesInNamespace('unknown', config)).toEqual([]);
  });

  it('returns empty array for config without databases', () => {
    expect(getTablesInNamespace('shared', {})).toEqual([]);
  });

  it('returns empty array when tables undefined', () => {
    const cfg: EdgeBaseConfig = { databases: { shared: {} as any } };
    expect(getTablesInNamespace('shared', cfg)).toEqual([]);
  });

  it('count matches table keys', () => {
    const tables = getTablesInNamespace('shared', config);
    expect(tables.length).toBe(3);
  });
});

// ─── E. findTableNamespace ────────────────────────────────────────────────────

describe('findTableNamespace', () => {
  const config: EdgeBaseConfig = {
    databases: {
      shared: {
        tables: { posts: {}, comments: {} },
      },
      workspace: {
        tables: { docs: {}, tasks: {} },
      },
    },
  };

  it('finds namespace for table in shared', () => {
    expect(findTableNamespace('posts', config)).toBe('shared');
  });

  it('finds namespace for table in workspace', () => {
    expect(findTableNamespace('docs', config)).toBe('workspace');
  });

  it('returns undefined for unknown table', () => {
    expect(findTableNamespace('unknown', config)).toBeUndefined();
  });

  it('returns undefined when config has no databases', () => {
    expect(findTableNamespace('posts', {})).toBeUndefined();
  });

  it('comments → shared', () => {
    expect(findTableNamespace('comments', config)).toBe('shared');
  });

  it('tasks → workspace', () => {
    expect(findTableNamespace('tasks', config)).toBe('workspace');
  });
});
