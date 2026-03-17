/**
 * Tests for CLI seed command — seed file validation, format checks, URL handling.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { _internals } from '../src/commands/seed.js';

const { buildSeedTableBasePath, inferDefaultSeedNamespace, listSeedNamespaces, resolveSeedTarget } = _internals;

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `eb-seed-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ======================================================================
// 1. Seed file validation
// ======================================================================

describe('Seed file validation', () => {
  it('detects missing seed file', () => {
    const seedPath = resolve(tmpDir, 'edgebase.seed.json');
    expect(existsSync(seedPath)).toBe(false);
  });

  it('detects valid seed file exists', () => {
    const seedPath = join(tmpDir, 'edgebase.seed.json');
    writeFileSync(seedPath, JSON.stringify({ posts: [] }));
    expect(existsSync(seedPath)).toBe(true);
  });

  it('parses valid JSON seed file', () => {
    const seedData = {
      posts: [
        { title: 'Hello', content: 'World' },
        { title: 'Second', content: 'Post' },
      ],
      comments: [{ body: 'Nice post!' }],
    };

    const seedPath = join(tmpDir, 'edgebase.seed.json');
    writeFileSync(seedPath, JSON.stringify(seedData));

    const parsed = JSON.parse(readFileSync(seedPath, 'utf-8'));
    expect(parsed.posts).toHaveLength(2);
    expect(parsed.comments).toHaveLength(1);
  });

  it('throws on invalid JSON', () => {
    const seedPath = join(tmpDir, 'edgebase.seed.json');
    writeFileSync(seedPath, '{invalid json content');

    expect(() => JSON.parse(readFileSync(seedPath, 'utf-8'))).toThrow();
  });
});

// ======================================================================
// 2. Seed data format validation
// ======================================================================

describe('Seed data format', () => {
  it('valid format: object with table keys → arrays', () => {
    const seed = {
      posts: [{ title: 'Hello' }],
      comments: [{ body: 'Nice!' }],
    };

    for (const [key, value] of Object.entries(seed)) {
      expect(typeof key).toBe('string');
      expect(Array.isArray(value)).toBe(true);
    }
  });

  it('detects non-array values', () => {
    const seed: Record<string, unknown> = {
      posts: [{ title: 'Hello' }],
      comments: 'not an array',
    };

    expect(Array.isArray(seed.posts)).toBe(true);
    expect(Array.isArray(seed.comments)).toBe(false);
  });

  it('handles empty tables', () => {
    const seed = { posts: [], comments: [] };
    expect(seed.posts).toHaveLength(0);
    expect(seed.comments).toHaveLength(0);
  });

  it('handles empty object (no tables)', () => {
    const seed = {};
    expect(Object.keys(seed)).toHaveLength(0);
  });

  it('handles records with various field types', () => {
    const seed = {
      posts: [
        {
          title: 'Hello',
          views: 42,
          published: true,
          metadata: { tags: ['a', 'b'] },
          createdAt: '2024-01-01T00:00:00Z',
        },
      ],
    };

    const record = seed.posts[0];
    expect(typeof record.title).toBe('string');
    expect(typeof record.views).toBe('number');
    expect(typeof record.published).toBe('boolean');
    expect(typeof record.metadata).toBe('object');
    expect(typeof record.createdAt).toBe('string');
  });

  it('handles unicode data in seed records', () => {
    const seed = {
      posts: [{ title: '한글 제목', content: '日本語の内容 🎉' }],
    };

    const json = JSON.stringify(seed);
    const parsed = JSON.parse(json);
    expect(parsed.posts[0].title).toBe('한글 제목');
    expect(parsed.posts[0].content).toBe('日本語の内容 🎉');
  });
});

// ======================================================================
// 3. URL handling
// ======================================================================

describe('URL handling', () => {
  it('strips trailing slash from base URL', () => {
    const url = 'http://localhost:8787/';
    expect(url.replace(/\/$/, '')).toBe('http://localhost:8787');
  });

  it('preserves URL without trailing slash', () => {
    const url = 'http://localhost:8787';
    expect(url.replace(/\/$/, '')).toBe('http://localhost:8787');
  });

  it('constructs table API URL correctly', () => {
    const baseUrl = 'http://localhost:8787';
    const tablePath = buildSeedTableBasePath('shared');
    expect(`${baseUrl}${tablePath}/posts`).toBe(
      'http://localhost:8787/api/db/shared/tables/posts',
    );
  });

  it('constructs health check URL correctly', () => {
    const baseUrl = 'http://localhost:8787';
    expect(`${baseUrl}/api/health`).toBe('http://localhost:8787/api/health');
  });

  it('constructs dynamic namespace API paths with an instance id', () => {
    expect(buildSeedTableBasePath('workspace', 'ws-123')).toBe(
      '/api/db/workspace/ws-123/tables',
    );
  });
});

// ======================================================================
// 4. Service Key header
// ======================================================================

describe('Service Key header', () => {
  it('includes Service Key header when provided', () => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const serviceKey = 'sk_test_key';
    if (serviceKey) {
      headers['X-EdgeBase-Service-Key'] = serviceKey;
    }
    expect(headers['X-EdgeBase-Service-Key']).toBe('sk_test_key');
  });

  it('does not include Service Key header when not provided', () => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const serviceKey: string | undefined = undefined;
    if (serviceKey) {
      headers['X-EdgeBase-Service-Key'] = serviceKey;
    }
    expect(headers['X-EdgeBase-Service-Key']).toBeUndefined();
  });
});

// ======================================================================
// 5. Custom seed file path
// ======================================================================

describe('Custom seed file path', () => {
  it('resolves default seed file path', () => {
    const cwd = tmpDir;
    const file = 'edgebase.seed.json';
    const seedPath = resolve(cwd, file);
    expect(seedPath).toBe(join(tmpDir, 'edgebase.seed.json'));
  });

  it('resolves custom seed file path', () => {
    const cwd = tmpDir;
    const file = 'data/my-seed.json';
    const seedPath = resolve(cwd, file);
    expect(seedPath).toBe(join(tmpDir, 'data', 'my-seed.json'));
  });

  it('resolves absolute seed file path', () => {
    const seedPath = resolve(tmpDir, '/absolute/path/seed.json');
    expect(seedPath).toBe('/absolute/path/seed.json');
  });
});

describe('Seed namespace resolution', () => {
  it('infers the only single-instance namespace from config', () => {
    const config = {
      databases: {
        app: { tables: { posts: {} } },
        workspace: { instance: true, tables: { docs: {} } },
      },
    };

    expect(inferDefaultSeedNamespace(config)).toBe('app');
    expect(listSeedNamespaces(config)).toEqual(['app', 'workspace']);
  });

  it('requires an explicit namespace when multiple single-instance blocks exist', () => {
    const config = {
      databases: {
        app: { tables: { posts: {} } },
        catalog: { tables: { products: {} } },
      },
    };

    expect(() => resolveSeedTarget({}, config)).toThrow(/Use `--namespace <name>`/);
  });

  it('requires an instance id for dynamic blocks', () => {
    const config = {
      databases: {
        workspace: { instance: true, tables: { docs: {} } },
      },
    };

    expect(() => resolveSeedTarget({ namespace: 'workspace' }, config)).toThrow(/requires an instance id/);
  });

  it('accepts dynamic targets when namespace and instance id are both provided', () => {
    const config = {
      databases: {
        workspace: { instance: true, tables: { docs: {} } },
      },
    };

    expect(resolveSeedTarget({ namespace: 'workspace', id: 'ws-123' }, config)).toEqual({
      namespace: 'workspace',
      instanceId: 'ws-123',
    });
  });
});
