import { afterEach, describe, expect, it, vi } from 'vitest';

function mockPgClient() {
  const connect = vi.fn().mockResolvedValue(undefined);
  const query = vi.fn().mockResolvedValue({
    fields: [],
    rows: [],
    rowCount: 0,
  });
  const end = vi.fn().mockResolvedValue(undefined);
  const Client = vi.fn(() => ({
    connect,
    query,
    end,
  }));

  vi.doMock('pg', () => ({ Client }));

  return { Client, connect, query, end };
}

describe('auth db adapter', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doUnmock('pg');
  });

  it('resolves auth provider and custom connectionString from config by default', async () => {
    const pg = mockPgClient();
    const { resolveAuthDb } = await import('../lib/auth-db-adapter.js');

    const db = resolveAuthDb({
      EDGEBASE_CONFIG: {
        auth: {
          provider: 'postgres',
          connectionString: 'AUTH_CUSTOM_URL',
        },
      },
      AUTH_CUSTOM_URL: 'postgres://edgebase:test@localhost/auth-custom',
    });

    expect(db.dialect).toBe('postgres');
    await db.query('SELECT 1');
    expect(pg.Client).toHaveBeenCalledWith({
      connectionString: 'postgres://edgebase:test@localhost/auth-custom',
    });
  });

  it('explicit args still override config defaults', async () => {
    const pg = mockPgClient();
    const { resolveAuthDb } = await import('../lib/auth-db-adapter.js');

    const db = resolveAuthDb(
      {
        EDGEBASE_CONFIG: {
          auth: {
            provider: 'd1',
          },
        },
        AUTH_OVERRIDE_URL: 'postgres://edgebase:test@localhost/auth-override',
      },
      'postgres',
      'AUTH_OVERRIDE_URL',
    );

    expect(db.dialect).toBe('postgres');
    await db.query('SELECT 1');
    expect(pg.Client).toHaveBeenCalledWith({
      connectionString: 'postgres://edgebase:test@localhost/auth-override',
    });
  });
});
