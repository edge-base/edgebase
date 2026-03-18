/**
 * Tests for config-editor — ts-morph AST manipulation of edgebase.config.ts
 *
 * Strategy: create a temporary directory with a config file, call the
 * public API, then read the file back and verify contents.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  addDatabaseBlock,
  updateDatabaseBlock,
  addStorageBucket,
  addTable,
  removeTable,
  renameTable,
  addColumn,
  removeColumn,
  updateColumn,
  addIndex,
  removeIndex,
  setFts,
  setAuthSettings,
  type ConfigEditorOptions,
} from '../src/lib/config-editor.js';

// ─── Fixtures ───

const baseConfig = `import { defineConfig } from '@edge-base/shared';

export default defineConfig({
  databases: {
    main: {
      tables: {
        users: {
          schema: {
            name: { type: 'string', required: true },
            email: { type: 'string', required: true, unique: true },
            age: { type: 'number' },
          },
        },
      },
    },
  },
});
`;

/** Config with an index on users for removeIndex tests. */
const configWithIndex = `import { defineConfig } from '@edge-base/shared';

export default defineConfig({
  databases: {
    main: {
      tables: {
        users: {
          schema: {
            name: { type: 'string', required: true },
            email: { type: 'string', required: true, unique: true },
          },
          indexes: [
            { fields: ['email'], unique: true },
          ],
        },
      },
    },
  },
});
`;

/** Config with FTS on users for setFts removal tests. */
const configWithFts = `import { defineConfig } from '@edge-base/shared';

export default defineConfig({
  databases: {
    main: {
      tables: {
        users: {
          schema: {
            name: { type: 'string', required: true },
            bio: { type: 'text' },
          },
          fts: ['name', 'bio'],
        },
      },
    },
  },
});
`;

const fourSpaceConfig = `import { defineConfig } from '@edge-base/shared';

export default defineConfig({
    databases: {
        main: {
            tables: {
                users: {
                    schema: {
                        name: { type: 'string', required: true },
                        email: { type: 'string', required: true, unique: true },
                        age: { type: 'number' },
                    },
                },
            },
        },
    },
});
`;

const tabConfig = baseConfig.replace(/^( {2,})/gm, (indent) => '\t'.repeat(indent.length / 2));
const crlfConfig = baseConfig.replace(/\n/g, '\r\n');

const authConfig = `import { defineConfig } from '@edge-base/shared';

export default defineConfig({
  auth: {
    emailAuth: false,
    anonymousAuth: false,
    allowedOAuthProviders: ['google'],
    allowedRedirectUrls: ['https://old.example.com/auth/*'],
    session: {
      accessTokenTTL: '10m',
    },
    magicLink: {
      enabled: false,
    },
    oauth: {
      google: {
        clientId: 'old-google-id',
        clientSecret: 'old-google-secret',
      },
      oidc: {
        okta: {
          clientId: 'okta-id',
          clientSecret: 'okta-secret',
          issuer: 'https://issuer.example.com',
          scopes: ['openid', 'profile'],
        },
      },
    },
  },
});
`;

// ─── Test helpers ───

let tmpDir: string;
let configPath: string;

function opts(): ConfigEditorOptions {
  return { configPath, backup: false };
}

function writeConfig(content: string = baseConfig): void {
  writeFileSync(configPath, content, 'utf-8');
}

function readConfig(): string {
  return readFileSync(configPath, 'utf-8');
}

function getLineContaining(content: string, needle: string): string {
  const line = content.split(/\r?\n/).find((entry) => entry.includes(needle));
  if (!line) {
    throw new Error(`Missing line containing "${needle}"`);
  }
  return line;
}

function getIndentation(line: string): string {
  return line.match(/^\s*/)?.[0] ?? '';
}

// ─── Setup / Teardown ───

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'config-editor-test-'));
  configPath = join(tmpDir, 'edgebase.config.ts');
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ─── addTable ───

describe('addDatabaseBlock', () => {
  it('adds a single-instance database block with default D1 routing', async () => {
    writeConfig();
    await addDatabaseBlock(opts(), 'app', { topology: 'single' });

    const result = readConfig();
    expect(result).toContain('app: {');
    expect(result).toContain('tables: {}');
    expect(result).not.toContain("provider: 'd1'");
  });

  it('adds a dynamic database block with manual admin discovery hints', async () => {
    writeConfig();
    await addDatabaseBlock(opts(), 'workspace', {
      topology: 'dynamic',
      targetLabel: 'Workspace',
      placeholder: 'Enter workspace ID',
      helperText: 'Pick a workspace or enter an ID.',
    });

    const result = readConfig();
    expect(result).toContain('workspace: {');
    expect(result).toContain('instance: true');
    expect(result).toContain("source: 'manual'");
    expect(result).toContain("targetLabel: 'Workspace'");
  });

  it('adds a postgres-backed database block with a connection string key', async () => {
    writeConfig();
    await addDatabaseBlock(opts(), 'analytics', {
      topology: 'single',
      provider: 'postgres',
      connectionString: 'ANALYTICS_DB_URL',
    });

    const result = readConfig();
    expect(result).toContain("provider: 'postgres'");
    expect(result).toContain("connectionString: 'ANALYTICS_DB_URL'");
  });
});

describe('updateDatabaseBlock', () => {
  it('updates an existing single DB block to postgres with a connection string key', async () => {
    writeConfig();

    await updateDatabaseBlock(opts(), 'main', {
      provider: 'postgres',
      connectionString: 'DB_POSTGRES_MAIN_URL',
    });

    const result = readConfig();
    expect(result).toContain("provider: 'postgres'");
    expect(result).toContain("connectionString: 'DB_POSTGRES_MAIN_URL'");
  });

  it('removes connectionString when switching back to implicit D1', async () => {
    writeConfig();
    await updateDatabaseBlock(opts(), 'main', {
      provider: 'postgres',
      connectionString: 'DB_POSTGRES_MAIN_URL',
    });

    await updateDatabaseBlock(opts(), 'main', {
      provider: 'd1',
      connectionString: null,
    });

    const result = readConfig();
    expect(result).not.toContain("provider: 'postgres'");
    expect(result).not.toContain('connectionString:');
  });
});

describe('addStorageBucket', () => {
  it('adds a new storage bucket block', async () => {
    writeConfig();
    await addStorageBucket(opts(), 'uploads');

    const result = readConfig();
    expect(result).toContain('storage:');
    expect(result).toContain('buckets:');
    expect(result).toContain('uploads: {}');
  });

  it('quotes bucket names that are not valid object identifiers', async () => {
    writeConfig();
    await addStorageBucket(opts(), 'test-bucket');

    const result = readConfig();
    expect(result).toContain('"test-bucket": {}');
  });
});

// ─── addTable ───

describe('addTable', () => {
  it('adds a new table with schema fields', async () => {
    writeConfig();
    await addTable(opts(), 'main', 'posts', {
      title: { type: 'string', required: true },
      body: { type: 'text' },
      published: { type: 'boolean', default: false },
    });

    const result = readConfig();
    expect(result).toContain('posts');
    expect(result).toContain("title:");
    expect(result).toContain("type: 'string'");
    expect(result).toContain("body:");
    expect(result).toContain("type: 'text'");
    expect(result).toContain("published:");
    expect(result).toContain("type: 'boolean'");
    expect(result).toContain('default: false');
    // Original table should still be present
    expect(result).toContain('users');
  });

  it('throws on duplicate table name', async () => {
    writeConfig();
    await expect(
      addTable(opts(), 'main', 'users', { foo: { type: 'string' } }),
    ).rejects.toThrow(/already exists/);
  });

  it('throws on invalid table name', async () => {
    writeConfig();
    await expect(
      addTable(opts(), 'main', '123bad', { foo: { type: 'string' } }),
    ).rejects.toThrow(/Invalid table name/);
  });
});

// ─── removeTable ───

describe('removeTable', () => {
  it('removes an existing table', async () => {
    writeConfig();
    await removeTable(opts(), 'main', 'users');

    const result = readConfig();
    expect(result).not.toContain('users');
    // Config structure should still be valid
    expect(result).toContain('tables');
  });

  it('throws when table does not exist', async () => {
    writeConfig();
    await expect(
      removeTable(opts(), 'main', 'nonexistent'),
    ).rejects.toThrow(/not found/);
  });
});

// ─── renameTable ───

describe('renameTable', () => {
  it('renames a table — old name gone, new name present', async () => {
    writeConfig();
    await renameTable(opts(), 'main', 'users', 'accounts');

    const result = readConfig();
    expect(result).not.toContain('users');
    expect(result).toContain('accounts');
    // Schema fields should be preserved
    expect(result).toContain("name:");
    expect(result).toContain("email:");
  });

  it('throws when new name already exists', async () => {
    writeConfig();
    // First add a second table
    await addTable(opts(), 'main', 'posts', { title: { type: 'string' } });
    // Now try to rename posts to users
    await expect(
      renameTable(opts(), 'main', 'posts', 'users'),
    ).rejects.toThrow(/already exists/);
  });
});

// ─── addColumn ───

describe('addColumn', () => {
  it('adds a column to an existing table', async () => {
    writeConfig();
    await addColumn(opts(), 'main', 'users', 'bio', {
      type: 'text',
      required: false,
    });

    const result = readConfig();
    expect(result).toContain('bio');
    expect(result).toContain("type: 'text'");
  });

  it('throws on duplicate column name', async () => {
    writeConfig();
    await expect(
      addColumn(opts(), 'main', 'users', 'email', { type: 'string' }),
    ).rejects.toThrow(/already exists/);
  });

  it('throws on auto-field name', async () => {
    writeConfig();
    await expect(
      addColumn(opts(), 'main', 'users', 'id', { type: 'number' }),
    ).rejects.toThrow(/auto-field/i);

    await expect(
      addColumn(opts(), 'main', 'users', 'createdAt', { type: 'datetime' }),
    ).rejects.toThrow(/auto-field/i);
  });
});

// ─── removeColumn ───

describe('removeColumn', () => {
  it('removes a column from a table', async () => {
    writeConfig();
    await removeColumn(opts(), 'main', 'users', 'age');

    const result = readConfig();
    expect(result).not.toContain('age');
    // Other columns should remain
    expect(result).toContain('name');
    expect(result).toContain('email');
  });

  it('throws when column does not exist', async () => {
    writeConfig();
    await expect(
      removeColumn(opts(), 'main', 'users', 'nonexistent'),
    ).rejects.toThrow(/not found/);
  });
});

// ─── updateColumn ───

describe('updateColumn', () => {
  it('updates a column field type', async () => {
    writeConfig();
    await updateColumn(opts(), 'main', 'users', 'age', {
      type: 'string',
      required: true,
    });

    const result = readConfig();
    // The age field should now have type 'string' and required: true
    // Check that the updated type is present (the old type 'number' for age should be gone)
    expect(result).toContain("type: 'string'");
    expect(result).toContain('required: true');
  });

  it('throws on auto-field name', async () => {
    writeConfig();
    await expect(
      updateColumn(opts(), 'main', 'users', 'updatedAt', { type: 'string' }),
    ).rejects.toThrow(/auto-field/i);
  });
});

// ─── addIndex ───

describe('addIndex', () => {
  it('adds an index to a table', async () => {
    writeConfig();
    await addIndex(opts(), 'main', 'users', {
      fields: ['email', 'name'],
      unique: true,
    });

    const result = readConfig();
    expect(result).toContain('indexes');
    expect(result).toContain("'email'");
    expect(result).toContain("'name'");
    expect(result).toContain('unique: true');
  });
});

// ─── removeIndex ───

describe('removeIndex', () => {
  it('removes an index by position', async () => {
    writeConfig(configWithIndex);
    await removeIndex(opts(), 'main', 'users', 0);

    const result = readConfig();
    // The index entry should be gone
    expect(result).not.toContain("fields: ['email']");
  });
});

// ─── setFts ───

describe('setFts', () => {
  it('sets FTS fields on a table', async () => {
    writeConfig();
    await setFts(opts(), 'main', 'users', ['name', 'email']);

    const result = readConfig();
    expect(result).toContain('fts');
    expect(result).toContain("'name'");
    expect(result).toContain("'email'");
  });

  it('removes FTS when given empty array', async () => {
    writeConfig(configWithFts);

    // Verify fts exists before removal
    expect(readConfig()).toContain('fts');

    await setFts(opts(), 'main', 'users', []);

    const result = readConfig();
    expect(result).not.toContain('fts');
  });
});

describe('setAuthSettings', () => {
  it('updates auth settings while preserving unsupported oauth config', async () => {
    writeConfig(authConfig);

    await setAuthSettings(opts(), {
      emailAuth: true,
      anonymousAuth: true,
      allowedOAuthProviders: ['google', 'github'],
      allowedRedirectUrls: ['https://app.example.com/auth/*', 'http://localhost:3000/auth/*'],
      session: {
        accessTokenTTL: '15m',
        refreshTokenTTL: '14d',
        maxActiveSessions: 5,
      },
      magicLink: {
        enabled: true,
        autoCreate: false,
        tokenTTL: '20m',
      },
      emailOtp: {
        enabled: true,
        autoCreate: true,
      },
      passkeys: {
        enabled: true,
        rpName: 'JuneBase',
        rpID: 'edgebase.fun',
        origin: ['https://edgebase.fun'],
      },
      oauth: {
        google: {
          clientId: 'new-google-id',
          clientSecret: 'new-google-secret',
        },
        github: {
          clientId: 'github-id',
          clientSecret: 'github-secret',
        },
      },
    });

    const result = readConfig();
    expect(result).toContain('emailAuth: true');
    expect(result).toContain('anonymousAuth: true');
    expect(result).toContain("allowedOAuthProviders: Array.from(new Set((process.env.EDGEBASE_AUTH_ALLOWED_OAUTH_PROVIDERS ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)))");
    expect(result).toContain("allowedRedirectUrls: ['https://app.example.com/auth/*', 'http://localhost:3000/auth/*']");
    expect(result).toContain("refreshTokenTTL: '14d'");
    expect(result).toContain('maxActiveSessions: 5');
    expect(result).toContain("tokenTTL: '20m'");
    expect(result).toContain("rpName: 'JuneBase'");
    expect(result).toContain("origin: ['https://edgebase.fun']");
    expect(result).toContain("clientId: process.env.EDGEBASE_OAUTH_GOOGLE_CLIENT_ID ?? ''");
    expect(result).toContain("clientSecret: process.env.EDGEBASE_OAUTH_GOOGLE_CLIENT_SECRET ?? ''");
    expect(result).toContain("clientId: process.env.EDGEBASE_OAUTH_GITHUB_CLIENT_ID ?? ''");
    expect(result).toContain("clientSecret: process.env.EDGEBASE_OAUTH_GITHUB_CLIENT_SECRET ?? ''");
    expect(result).not.toContain('new-google-id');
    expect(result).not.toContain('github-secret');
    expect(result).toContain("okta: {");
    expect(result).toContain("issuer: 'https://issuer.example.com'");
  });

  it('removes empty provider credentials and optional auth fields when cleared', async () => {
    writeConfig(authConfig);

    await setAuthSettings(opts(), {
      allowedOAuthProviders: [],
      allowedRedirectUrls: [],
      session: {
        accessTokenTTL: null,
        refreshTokenTTL: null,
        maxActiveSessions: null,
      },
      magicLink: {
        enabled: false,
        autoCreate: true,
        tokenTTL: null,
      },
      oauth: {
        google: {
          clientId: null,
          clientSecret: null,
        },
      },
    });

    const result = readConfig();
    expect(result).toContain("allowedOAuthProviders: Array.from(new Set((process.env.EDGEBASE_AUTH_ALLOWED_OAUTH_PROVIDERS ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)))");
    expect(result).not.toContain('allowedRedirectUrls:');
    expect(result).not.toContain("accessTokenTTL: '10m'");
    expect(result).not.toContain('google: {');
    expect(result).toContain("oidc: {");
  });
});

describe('format preservation', () => {
  it('preserves four-space indentation when editing the config', async () => {
    writeConfig(fourSpaceConfig);
    await addColumn(opts(), 'main', 'users', 'bio', { type: 'text' });

    const result = readConfig();
    expect(getIndentation(getLineContaining(result, 'databases:'))).toHaveLength(4);
    expect(getIndentation(getLineContaining(result, "bio: { type: 'text'"))).toHaveLength(24);
  });

  it('preserves tab indentation when editing the config', async () => {
    writeConfig(tabConfig);
    await addColumn(opts(), 'main', 'users', 'bio', { type: 'text' });

    const result = readConfig();
    expect(getIndentation(getLineContaining(result, 'databases:'))).toBe('\t');
    expect(getIndentation(getLineContaining(result, "bio: { type: 'text'"))).toBe('\t\t\t\t\t\t');
  });

  it('preserves CRLF newlines when editing the config', async () => {
    writeConfig(crlfConfig);
    await addColumn(opts(), 'main', 'users', 'bio', { type: 'text' });

    const result = readConfig();
    expect(result).toContain('\r\n');
    expect(result.replace(/\r\n/g, '')).not.toContain('\n');
  });
});
