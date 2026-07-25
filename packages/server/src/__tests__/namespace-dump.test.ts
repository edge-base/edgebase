import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineConfig } from '@edge-base/shared';
import { dumpNamespaceTables } from '../lib/namespace-dump.js';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  ensurePgSchema: vi.fn(),
}));

vi.mock('../lib/postgres-executor.js', () => ({
  ensureLocalDevPostgresSchema: vi.fn(),
  getLocalDevPostgresExecOptions: vi.fn(() => null),
  getProviderBindingName: vi.fn(() => 'DB_POSTGRES_SHARED'),
  withPostgresConnection: vi.fn(async (
    _connectionString: string,
    callback: (query: typeof mocks.query) => Promise<unknown>,
  ) => callback(mocks.query)),
}));

vi.mock('../lib/postgres-schema-init.js', () => ({
  ensurePgSchema: mocks.ensurePgSchema,
}));

describe('namespace dump helpers', () => {
  beforeEach(() => {
    mocks.query.mockReset();
    mocks.ensurePgSchema.mockReset();
  });

  it('throws when the requested namespace is missing from config', async () => {
    const config = defineConfig({
      databases: {
        shared: {
          tables: {
            posts: {
              schema: {
                title: { type: 'string' },
              },
            },
          },
        },
      },
    });

    await expect(
      dumpNamespaceTables({} as never, config, 'missing'),
    ).rejects.toMatchObject({
      code: 404,
      message: "Namespace 'missing' not found in config.",
    });
  });

  it('strips PostgreSQL FTS helper columns from exported table rows', async () => {
    const config = defineConfig({
      databases: {
        shared: {
          provider: 'postgres',
          tables: {
            posts: {
              schema: { title: { type: 'string' } },
              fts: ['title'],
            },
          },
        },
      },
    });
    mocks.query.mockResolvedValue({
      columns: ['id', 'title', '_fts', '_fts_text'],
      rows: [{ id: 'post-1', title: 'visible', _fts: 'vector', _fts_text: 'visible' }],
      rowCount: 1,
    });

    const dump = await dumpNamespaceTables({
      DB_POSTGRES_SHARED_URL: 'postgres://edgebase:test@localhost/shared',
    } as never, config, 'shared', { includeMeta: false });

    expect(dump.posts).toEqual([{ id: 'post-1', title: 'visible' }]);
    expect(mocks.ensurePgSchema).toHaveBeenCalledOnce();
  });
});
