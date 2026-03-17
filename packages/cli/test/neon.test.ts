import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { _internals } from '../src/commands/neon.js';
import {
  getDefaultPostgresEnvKey,
  parseNeonBranches,
  parseNeonOrganizations,
  parseNeonProject,
  parseNeonProjects,
  parseNeonConnectionString,
  parseNeonNamedItems,
  removeEnvValue,
  upsertEnvValue,
} from '../src/lib/neon.js';

const {
  listNeonSetupTargets,
  normalizePgIdentifier,
  normalizeProjectName,
  resolveNeonSetupTarget,
} = _internals;

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `eb-neon-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('neon helpers', () => {
  it('builds the default DB env key from namespace', () => {
    expect(getDefaultPostgresEnvKey('shared')).toBe('DB_POSTGRES_SHARED_URL');
    expect(getDefaultPostgresEnvKey('my-app')).toBe('DB_POSTGRES_MY_APP_URL');
  });

  it('normalizes project and postgres identifiers', () => {
    expect(normalizeProjectName('My App / Shared')).toBe('my-app-shared');
    expect(normalizePgIdentifier('My App / Shared')).toBe('my_app_shared');
    expect(normalizePgIdentifier('123data')).toBe('eb_123data');
  });

  it('extracts a connection string from common neonctl json output shapes', () => {
    expect(parseNeonConnectionString(JSON.stringify({
      uri: 'postgres://user:pass@host/db?sslmode=require',
    }))).toBe('postgres://user:pass@host/db?sslmode=require');

    expect(parseNeonConnectionString(JSON.stringify({
      data: {
        connection_string: 'postgresql://user:pass@host/db?sslmode=require',
      },
    }))).toBe('postgresql://user:pass@host/db?sslmode=require');
  });

  it('extracts a connection string from raw output when neonctl returns plain text', () => {
    expect(parseNeonConnectionString('\npostgres://user:pass@host/db\n')).toBe(
      'postgres://user:pass@host/db',
    );
  });

  it('parses neon branch list output', () => {
    expect(parseNeonBranches(JSON.stringify([
      { id: 'br-1', name: 'production', default: true },
      { id: 'br-2', name: 'preview' },
    ]))).toEqual([
      { id: 'br-1', name: 'production', default: true, primary: false },
      { id: 'br-2', name: 'preview', default: false, primary: false },
    ]);
  });

  it('parses neon organization and project output', () => {
    expect(parseNeonOrganizations(JSON.stringify([
      { id: 'org-1', name: 'June', handle: 'june-org' },
    ]))).toEqual([
      { id: 'org-1', name: 'June', handle: 'june-org' },
    ]);

    expect(parseNeonProjects(JSON.stringify([
      { id: 'prj-1', name: 'edgebase-app', org_id: 'org-1' },
    ]))).toEqual([
      { id: 'prj-1', name: 'edgebase-app', orgId: 'org-1' },
    ]);

    expect(parseNeonProject(JSON.stringify({
      id: 'prj-1',
      name: 'edgebase-app',
      org_id: 'org-1',
    }))).toEqual({
      id: 'prj-1',
      name: 'edgebase-app',
      orgId: 'org-1',
    });

    expect(parseNeonProject(JSON.stringify({
      project: {
        id: 'prj-2',
        name: 'edgebase-app-nested',
        owner_id: 'org-2',
      },
    }))).toEqual({
      id: 'prj-2',
      name: 'edgebase-app-nested',
      orgId: 'org-2',
    });
  });

  it('parses named resource lists', () => {
    expect(parseNeonNamedItems(JSON.stringify([
      { name: 'edgebase_shared' },
      { name: 'edgebase_auth' },
    ]))).toEqual(['edgebase_shared', 'edgebase_auth']);
  });

  it('upserts env values without removing unrelated lines', () => {
    const filePath = join(tmpDir, '.env.release');
    writeFileSync(filePath, '# comment\nJWT_USER_SECRET=keep\n', 'utf-8');

    upsertEnvValue(filePath, 'DB_POSTGRES_SHARED_URL', 'postgres://next', '# header');

    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('# comment');
    expect(content).toContain('JWT_USER_SECRET=keep');
    expect(content).toContain('DB_POSTGRES_SHARED_URL=postgres://next');
  });

  it('removes env values without touching unrelated lines', () => {
    const filePath = join(tmpDir, '.env.development');
    writeFileSync(filePath, '# comment\nJWT_USER_SECRET=keep\nEDGEBASE_OAUTH_GOOGLE_CLIENT_ID=gid\n', 'utf-8');

    removeEnvValue(filePath, 'EDGEBASE_OAUTH_GOOGLE_CLIENT_ID');

    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('# comment');
    expect(content).toContain('JWT_USER_SECRET=keep');
    expect(content).not.toContain('EDGEBASE_OAUTH_GOOGLE_CLIENT_ID=gid');
  });
});

describe('neon target resolution', () => {
  it('lists auth and database neon targets', () => {
    const config = {
      auth: {
        provider: 'postgres',
        connectionString: 'AUTH_DB_URL',
      },
      databases: {
        shared: {
          provider: 'postgres',
        },
        app: {
          provider: 'd1',
        },
      },
    };

    expect(listNeonSetupTargets(config)).toEqual([
      { kind: 'auth', label: 'auth', envKey: 'AUTH_DB_URL' },
      {
        kind: 'database',
        label: 'shared',
        namespace: 'shared',
        envKey: 'DB_POSTGRES_SHARED_URL',
      },
    ]);
  });

  it('resolves auth and namespace targets explicitly', () => {
    const config = {
      auth: {
        provider: 'postgres',
      },
      databases: {
        shared: {
          provider: 'postgres',
          connectionString: 'SHARED_DB_URL',
        },
      },
    };

    expect(resolveNeonSetupTarget({ auth: true }, config)).toEqual({
      kind: 'auth',
      label: 'auth',
      envKey: 'AUTH_POSTGRES_URL',
    });
    expect(resolveNeonSetupTarget({ namespace: 'shared' }, config)).toEqual({
      kind: 'database',
      label: 'shared',
      namespace: 'shared',
      envKey: 'SHARED_DB_URL',
    });
  });

  it('auto-selects the only neon target', () => {
    expect(resolveNeonSetupTarget({}, {
      databases: {
        shared: {
          provider: 'postgres',
        },
      },
    })).toEqual({
      kind: 'database',
      label: 'shared',
      namespace: 'shared',
      envKey: 'DB_POSTGRES_SHARED_URL',
    });
  });

  it('requires a neon-configured target', () => {
    expect(() => resolveNeonSetupTarget({ namespace: 'shared' }, {
      databases: {
        shared: {
          provider: 'd1',
        },
      },
    })).toThrow(/provider: 'postgres'/);

    expect(() => resolveNeonSetupTarget({ auth: true }, {
      auth: {
        provider: 'd1',
      },
    })).toThrow(/auth\.provider/);
  });
});
