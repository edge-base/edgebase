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

  it('adapts conflict clauses for semicolons, RETURNING, and unquoted tables', async () => {
    mockPgClient();
    const { adaptSqlDialect } = await import('../lib/auth-db-adapter.js');

    expect(adaptSqlDialect(
      'INSERT OR IGNORE INTO _meta (key, value) VALUES (?, ?);',
    )).toBe('INSERT INTO _meta (key, value) VALUES (?, ?) ON CONFLICT DO NOTHING');
    expect(adaptSqlDialect(
      'INSERT OR IGNORE INTO _meta (key, value) VALUES (?, ?) RETURNING key;',
    )).toBe('INSERT INTO _meta (key, value) VALUES (?, ?) ON CONFLICT DO NOTHING RETURNING key');
    expect(adaptSqlDialect(
      'INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?) RETURNING key;',
    )).toBe(
      'INSERT INTO _meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value RETURNING key',
    );
  });

  it('canonicalizes PostgreSQL lowercase auth columns and bigint counts', async () => {
    const pg = mockPgClient();
    pg.query.mockResolvedValueOnce({
      fields: [],
      rows: [{ userid: 'user-1', refreshtoken: 'refresh-1', createdat: 'now', cnt: '2' }],
      rowCount: 1,
    });
    const { PgAuthDb } = await import('../lib/auth-db-adapter.js');
    const db = new PgAuthDb('postgres://edgebase:test@localhost/auth');

    await expect(db.first('SELECT * FROM _sessions')).resolves.toEqual({
      userId: 'user-1',
      refreshToken: 'refresh-1',
      createdAt: 'now',
      cnt: 2,
    });
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

  it('uses one conditional D1 UPDATE as the admin-session rotation CAS', async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ meta: { changes: 1 } })
      .mockResolvedValueOnce({ meta: { changes: 0 } });
    const bind = vi.fn((..._params: unknown[]) => ({ run }));
    const prepare = vi.fn((_sql: string) => ({ bind }));
    const { D1AuthDb } = await import('../lib/auth-db-adapter.js');
    const db = new D1AuthDb({ prepare } as unknown as D1Database);

    const rotation = {
      sessionId: 'session-1',
      currentRefreshTokens: ['sha256:current', 'legacy-current'],
      nextRefreshToken: 'sha256:next',
      expiresAt: '2099-01-01',
    };
    await expect(db.compareAndSwapAdminSession(rotation)).resolves.toBe(true);
    await expect(db.compareAndSwapAdminSession(rotation)).resolves.toBe(false);
    expect(prepare).toHaveBeenCalledTimes(2);
    const sql = String(prepare.mock.calls[0]?.[0]);
    expect(sql).toContain('UPDATE _admin_sessions');
    expect(sql).toContain('refreshToken IN (?, ?)');
    expect(bind.mock.calls[0]).toEqual([
      'sha256:next',
      '2099-01-01',
      'session-1',
      'sha256:current',
      'legacy-current',
      expect.any(String),
    ]);
    expect(bind.mock.calls[0]).toHaveLength(6);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('uses UPDATE ... RETURNING for PostgreSQL admin-session CAS', async () => {
    const pg = mockPgClient();
    pg.query.mockResolvedValueOnce({ fields: [], rows: [{ id: 'session-1' }], rowCount: 1 });
    const { PgAuthDb } = await import('../lib/auth-db-adapter.js');
    const db = new PgAuthDb('postgres://edgebase:test@localhost/auth');

    await expect(db.compareAndSwapAdminSession({
      sessionId: 'session-1',
      currentRefreshTokens: ['sha256:current'],
      nextRefreshToken: 'sha256:next',
      expiresAt: '2099-01-01',
    })).resolves.toBe(true);
    expect(pg.query).toHaveBeenCalledOnce();
    expect(pg.query.mock.calls[0][0]).toContain('UPDATE _admin_sessions');
    expect(pg.query.mock.calls[0][0]).toContain('RETURNING id');
    expect(pg.query.mock.calls[0][0]).toContain('refreshToken IN ($4)');
  });

  it('uses one exact-token D1 UPDATE as the user-session rotation CAS', async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ meta: { changes: 1 } })
      .mockResolvedValueOnce({ meta: { changes: 0 } });
    const bind = vi.fn((..._params: unknown[]) => ({ run }));
    const prepare = vi.fn((_sql: string) => ({ bind }));
    const { D1AuthDb } = await import('../lib/auth-db-adapter.js');
    const db = new D1AuthDb({ prepare } as unknown as D1Database);
    const rotation = {
      sessionId: 'user-session-1',
      currentRefreshToken: 'refresh-current',
      nextRefreshToken: 'refresh-next',
      expiresAt: '2099-01-01',
      rotatedAt: '2026-07-10T00:00:00.000Z',
    };

    await expect(db.compareAndSwapUserSession(rotation)).resolves.toBe(true);
    await expect(db.compareAndSwapUserSession(rotation)).resolves.toBe(false);
    const sql = String(prepare.mock.calls[0]?.[0]);
    expect(sql).toContain('UPDATE _sessions');
    expect(sql).toContain('id = ? AND refreshToken = ? AND expiresAt > ?');
    expect(bind.mock.calls[0]).toEqual([
      'refresh-next',
      'refresh-current',
      '2026-07-10T00:00:00.000Z',
      '2099-01-01',
      '2026-07-10T00:00:00.000Z',
      'user-session-1',
      'refresh-current',
      expect.any(String),
    ]);
    expect(bind.mock.calls[0]).toHaveLength(8);
  });

  it('creates and prunes capped D1 sessions in one atomic batch', async () => {
    const statements: Array<{ sql: string; bindings: unknown[] }> = [];
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn((...bindings: unknown[]) => ({ sql, bindings, run: vi.fn() })),
    }));
    const batch = vi.fn(async (items: Array<{ sql: string; bindings: unknown[] }>) => {
      statements.push(...items);
      return [];
    });
    const { D1AuthDb } = await import('../lib/auth-db-adapter.js');
    const db = new D1AuthDb({ prepare, batch } as unknown as D1Database);

    await db.createSessionWithLimit({
      id: 'new-session',
      userId: 'user-1',
      refreshToken: 'refresh-new',
      previousRefreshToken: null,
      rotatedAt: null,
      expiresAt: '2099-01-01T00:00:00.000Z',
      createdAt: '2026-07-12T00:00:00.000Z',
      metadata: null,
    }, 1);

    expect(batch).toHaveBeenCalledOnce();
    expect(statements).toHaveLength(3);
    expect(statements[0].sql).toContain('expiresAt <= ?');
    expect(statements[1].sql).toContain('INSERT INTO _sessions');
    expect(statements[2].sql).toContain('LIMIT -1 OFFSET ?');
    expect(statements[2].bindings).toEqual(['user-1', 'new-session', 1]);
  });

  it('uses exact-token UPDATE ... RETURNING for PostgreSQL user-session CAS', async () => {
    const pg = mockPgClient();
    pg.query.mockResolvedValueOnce({ fields: [], rows: [{ id: 'user-session-1' }], rowCount: 1 });
    const { PgAuthDb } = await import('../lib/auth-db-adapter.js');
    const db = new PgAuthDb('postgres://edgebase:test@localhost/auth');

    await expect(db.compareAndSwapUserSession({
      sessionId: 'user-session-1',
      currentRefreshToken: 'refresh-current',
      nextRefreshToken: 'refresh-next',
      expiresAt: '2099-01-01',
      rotatedAt: '2026-07-10T00:00:00.000Z',
    })).resolves.toBe(true);
    expect(pg.query).toHaveBeenCalledOnce();
    expect(pg.query.mock.calls[0][0]).toContain('UPDATE _sessions');
    expect(pg.query.mock.calls[0][0]).toContain('refreshToken = $7');
    expect(pg.query.mock.calls[0][0]).toContain('RETURNING id');
  });
});
