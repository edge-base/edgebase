import { afterEach, describe, expect, it, vi } from 'vitest';

function mockPgClient() {
  const connect = vi.fn().mockResolvedValue(undefined);
  const query = vi.fn();
  const end = vi.fn().mockResolvedValue(undefined);
  const Client = vi.fn(() => ({
    connect,
    query,
    end,
  }));

  vi.doMock('pg', () => ({ Client }));

  return { Client, connect, query, end };
}

describe('postgres executor helpers', () => {
  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doUnmock('pg');
  });

  it('executes a query and normalizes result metadata', async () => {
    const pg = mockPgClient();
    pg.query.mockResolvedValue({
      fields: [{ name: 'id' }, { name: 'title' }],
      rows: [{ id: 'post-1', title: 'Hello' }],
      rowCount: 1,
    });

    const { executePostgresQuery } = await import('../lib/postgres-executor.js');
    const result = await executePostgresQuery('postgres://edgebase:test@localhost/db', 'SELECT * FROM posts');

    expect(pg.Client).toHaveBeenCalledWith({ connectionString: 'postgres://edgebase:test@localhost/db' });
    expect(pg.connect).toHaveBeenCalledTimes(1);
    expect(pg.query).toHaveBeenCalledWith('SELECT * FROM posts', []);
    expect(pg.end).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      columns: ['id', 'title'],
      rows: [{ id: 'post-1', title: 'Hello' }],
      rowCount: 1,
    });
  });

  it('reuses a single client within withPostgresConnection and exposes a query helper', async () => {
    const pg = mockPgClient();
    pg.query.mockResolvedValue({
      fields: [{ name: 'id' }],
      rows: [{ id: 'row-1' }],
      rowCount: 1,
    });

    const {
      _resetPostgresPoolCache,
      getProviderBindingName,
      withPostgresConnection,
    } = await import('../lib/postgres-executor.js');

    await expect(_resetPostgresPoolCache()).resolves.toBeUndefined();
    expect(getProviderBindingName('tenant-app')).toBe('DB_POSTGRES_TENANT_APP');

    const result = await withPostgresConnection(
      'postgres://edgebase:test@localhost/db',
      async (query) => query('SELECT * FROM posts WHERE id = $1', ['row-1']),
    );

    expect(pg.Client).toHaveBeenCalledWith({ connectionString: 'postgres://edgebase:test@localhost/db' });
    expect(pg.connect).toHaveBeenCalledTimes(1);
    expect(pg.query).toHaveBeenCalledWith('SELECT * FROM posts WHERE id = $1', ['row-1']);
    expect(pg.end).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      columns: ['id'],
      rows: [{ id: 'row-1' }],
      rowCount: 1,
    });
  });
});
