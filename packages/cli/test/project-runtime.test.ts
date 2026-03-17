import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readProjectWranglerContext,
  resolveLocalDevBindings,
  resolveManagedD1DatabaseName,
  resolveProjectWorkerName,
  resolveProjectWorkerUrl,
  resolveProjectWranglerPath,
} from '../src/lib/project-runtime.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `eb-project-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('resolveProjectWranglerPath', () => {
  it('prefers the project root wrangler.toml when present', () => {
    writeFileSync(join(tmpDir, 'wrangler.toml'), 'name = "root-worker"\n');
    mkdirSync(join(tmpDir, 'packages', 'server'), { recursive: true });
    writeFileSync(join(tmpDir, 'packages', 'server', 'wrangler.toml'), 'name = "server-worker"\n');

    expect(resolveProjectWranglerPath(tmpDir)).toBe(join(tmpDir, 'wrangler.toml'));
  });

  it('falls back to packages/server/wrangler.toml in monorepo setups', () => {
    mkdirSync(join(tmpDir, 'packages', 'server'), { recursive: true });
    writeFileSync(join(tmpDir, 'packages', 'server', 'wrangler.toml'), 'name = "server-worker"\n');

    expect(resolveProjectWranglerPath(tmpDir)).toBe(join(tmpDir, 'packages', 'server', 'wrangler.toml'));
  });
});

describe('project worker identity', () => {
  it('reads worker name and URL from wrangler.toml', () => {
    writeFileSync(join(tmpDir, 'wrangler.toml'), 'name = "edgebase"\n');

    expect(resolveProjectWorkerName(tmpDir)).toBe('edgebase');
    expect(resolveProjectWorkerUrl(tmpDir)).toBe('https://edgebase.workers.dev');
  });

  it('returns the wrangler directory for downstream wrangler commands', () => {
    mkdirSync(join(tmpDir, 'packages', 'server'), { recursive: true });
    writeFileSync(join(tmpDir, 'packages', 'server', 'wrangler.toml'), 'name = "server-worker"\n');

    expect(readProjectWranglerContext(tmpDir)).toMatchObject({
      path: join(tmpDir, 'packages', 'server', 'wrangler.toml'),
      dir: join(tmpDir, 'packages', 'server'),
      config: {
        workerName: 'server-worker',
      },
    });
  });
});

describe('resolveManagedD1DatabaseName', () => {
  it('prefers explicit wrangler D1 database names for internal bindings', () => {
    writeFileSync(
      join(tmpDir, 'wrangler.toml'),
      `
name = "edgebase"

[[d1_databases]]
binding = "AUTH_DB"
database_name = "edgebase-auth"
database_id = "local"
`,
    );

    expect(resolveManagedD1DatabaseName(tmpDir, 'AUTH_DB')).toBe('edgebase-auth');
  });

  it('derives missing single-instance D1 names from worker identity + config', () => {
    writeFileSync(
      join(tmpDir, 'wrangler.toml'),
      `
name = "edgebase"

[[d1_databases]]
binding = "AUTH_DB"
database_name = "edgebase-auth"
database_id = "local"
`,
    );

    expect(
      resolveManagedD1DatabaseName(
        tmpDir,
        'DB_D1_QA',
        {
          databases: {
            qa: {
              tables: {
                customers: {
                  schema: {
                    name: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      ),
    ).toBe('edgebase-db-qa');
  });
});

describe('resolveLocalDevBindings', () => {
  it('includes internal D1 bindings and single-instance namespaces only', () => {
    const bindings = resolveLocalDevBindings({
      databases: {
        shared: {
          tables: {
            posts: { schema: { title: { type: 'string' } } },
          },
        },
        cache: {
          provider: 'd1',
          tables: {
            entries: { schema: { key: { type: 'string' } } },
          },
        },
        workspace: {
          instance: true,
          tables: {
            posts: { schema: { title: { type: 'string' } } },
          },
        },
        logs: {
          provider: 'do',
          tables: {
            events: { schema: { name: { type: 'string' } } },
          },
        },
      },
    });

    expect(bindings).toEqual([
      { type: 'd1_database', name: 'auth', binding: 'AUTH_DB', id: 'local' },
      { type: 'd1_database', name: 'control', binding: 'CONTROL_DB', id: 'local' },
      { type: 'd1_database', name: 'db-shared', binding: 'DB_D1_SHARED', id: 'local' },
      { type: 'd1_database', name: 'db-cache', binding: 'DB_D1_CACHE', id: 'local' },
    ]);
  });
});
