/**
 * Tests for loadConfigSafe — config loading with tsx / esbuild / regex fallback chain.
 *
 * The function tries three strategies in order: tsx eval, esbuild bundle, regex.
 * When tsx is available (as in this test environment), Strategy 1 succeeds and
 * returns the raw JS config object. When only regex is available, the parser
 * extracts only canonical databases blocks. We test the public API behavior
 * regardless of which strategy wins.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfigSafe, parseConfigRegex } from '../src/lib/load-config.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `eb-loadcfg-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ======================================================================
// 1. Parses a valid databases config
// ======================================================================

describe('loadConfigSafe — databases block', () => {
  it('parses config with a databases block containing tables', () => {
    const configFile = join(tmpDir, 'edgebase.config.ts');
    writeFileSync(
      configFile,
      `
export default {
  databases: {
    main: {
      tables: {
        users: {
          schema: {
            name: { type: 'string', required: true },
            email: { type: 'string' },
          },
        },
        posts: {
          schema: {
            title: { type: 'string' },
            body: { type: 'text' },
          },
        },
      },
    },
  },
};
`,
      'utf-8',
    );

    const result = loadConfigSafe(configFile, tmpDir);

    expect(result).toHaveProperty('databases');
    const databases = result.databases as Record<string, { tables: Record<string, unknown> }>;
    expect(databases).toHaveProperty('main');
    expect(databases.main).toHaveProperty('tables');

    const tableNames = Object.keys(databases.main.tables);
    expect(tableNames).toContain('users');
    expect(tableNames).toContain('posts');
  });

  it('loads typed config files that import @edge-base/shared without falling back to regex', () => {
    const configDir = join(tmpDir, 'config');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, 'rate-limits.ts'),
      `
export const rateLimiting = {
  global: {
    requests: 42,
    windowSec: 60,
  },
};
`,
      'utf-8',
    );

    const configFile = join(tmpDir, 'edgebase.config.ts');
    writeFileSync(
      configFile,
      `
import { defineConfig } from '@edge-base/shared';
import { rateLimiting } from './config/rate-limits';

export default defineConfig({
  release: true,
  rateLimiting,
  cors: {
    origin: ['http://localhost:5174'],
  },
  databases: {
    shared: {
      tables: {
        posts: {
          schema: {
            title: { type: 'string', required: true },
          },
        },
      },
    },
  },
});
`,
      'utf-8',
    );

    const result = loadConfigSafe(configFile, tmpDir, { allowRegexFallback: false });

    expect(result.databases).toBeDefined();
    expect(result.release).toBe(true);
    expect(result.cors).toEqual({ origin: ['http://localhost:5174'] });
    expect(result.rateLimiting).toEqual({
      global: {
        requests: 42,
        windowSec: 60,
      },
    });
  });
});

// ======================================================================
// 2. Does not materialize flat top-level table configs
// ======================================================================

describe('loadConfigSafe — flat top-level tables', () => {
  it('does not materialize top-level tables into databases', () => {
    const configFile = join(tmpDir, 'edgebase.config.ts');
    writeFileSync(
      configFile,
      `
export default {
  todos: {
    schema: {
      title: { type: 'string' },
      done: { type: 'boolean' },
    },
  },
  projects: {
    schema: {
      name: { type: 'string' },
    },
  },
};
`,
      'utf-8',
    );

    const result = loadConfigSafe(configFile, tmpDir);

    expect(result).not.toHaveProperty('databases');
    expect(result).not.toHaveProperty('collections');

    if ('todos' in result) {
      // tsx/esbuild path returns the raw object as authored.
      expect(result).toHaveProperty('todos');
      expect(result).toHaveProperty('projects');

      const todos = result.todos as Record<string, unknown>;
      expect(todos).toHaveProperty('schema');
    } else {
      // Regex fallback only understands the canonical databases block.
      expect(result).toEqual({});
    }
  });
});

// ======================================================================
// 3. Throws on non-existent file
// ======================================================================

describe('loadConfigSafe — error handling', () => {
  it('throws when config file does not exist', () => {
    const missingFile = join(tmpDir, 'does-not-exist.config.ts');

    expect(() => loadConfigSafe(missingFile, tmpDir)).toThrow();
  });

  it('throws when full evaluation is required and execution fails', () => {
    const configFile = join(tmpDir, 'edgebase.config.ts');
    writeFileSync(
      configFile,
      `
const crash = () => {
  throw new Error('boom');
};

crash();

export default {
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
};
`,
      'utf-8',
    );

    expect(() => loadConfigSafe(configFile, tmpDir, { allowRegexFallback: false })).toThrow(
      /Failed to fully evaluate edgebase\.config\.ts.*boom/,
    );
  });
});

// ======================================================================
// 4. Returns empty result for config with no tables
// ======================================================================

describe('loadConfigSafe — empty config', () => {
  it('returns an object with no databases for a config without tables', () => {
    const configFile = join(tmpDir, 'edgebase.config.ts');
    writeFileSync(
      configFile,
      `
export default {
  projectName: 'my-app',
  region: 'us-east-1',
};
`,
      'utf-8',
    );

    const result = loadConfigSafe(configFile, tmpDir);

    // Whether tsx or regex, a config with only scalar values has no canonical tables.
    expect(result).not.toHaveProperty('databases');
    expect(result).not.toHaveProperty('collections');
    expect(typeof result).toBe('object');
    expect(result).not.toBeNull();
  });
});

// ======================================================================
// 5. Handles config with multiple tables across multiple database blocks
// ======================================================================

describe('loadConfigSafe — multiple databases', () => {
  it('parses config with multiple database blocks each containing tables', () => {
    const configFile = join(tmpDir, 'edgebase.config.ts');
    writeFileSync(
      configFile,
      `
export default {
  databases: {
    primary: {
      tables: {
        accounts: {
          schema: {
            username: { type: 'string' },
          },
        },
      },
    },
    analytics: {
      tables: {
        events: {
          schema: {
            name: { type: 'string' },
            payload: { type: 'json' },
          },
        },
        sessions: {
          schema: {
            token: { type: 'string' },
          },
        },
      },
    },
  },
};
`,
      'utf-8',
    );

    const result = loadConfigSafe(configFile, tmpDir);

    expect(result).toHaveProperty('databases');
    const databases = result.databases as Record<string, { tables: Record<string, unknown> }>;

    // primary DB
    expect(databases).toHaveProperty('primary');
    expect(Object.keys(databases.primary.tables)).toContain('accounts');

    // analytics DB
    expect(databases).toHaveProperty('analytics');
    const analyticsTables = Object.keys(databases.analytics.tables);
    expect(analyticsTables).toContain('events');
    expect(analyticsTables).toContain('sessions');
  });
});

// ======================================================================
// 6. Regex fallback — directly test parseConfigRegex
// ======================================================================

describe('parseConfigRegex — regex fallback path', () => {
  it('ignores flat top-level tables without a databases wrapper', () => {
    const configFile = join(tmpDir, 'edgebase.config.ts');
    writeFileSync(
      configFile,
      `
export default {
  users: {
    schema: {
      name: { type: 'string', required: true },
      age: { type: 'number' },
    },
  },
};
`,
      'utf-8',
    );

    const result = parseConfigRegex(configFile);

    expect(result).not.toHaveProperty('collections');
    expect(result).not.toHaveProperty('databases');
  });

  it('extracts schema fields from databases block with multiple tables', () => {
    const configFile = join(tmpDir, 'edgebase.config.ts');
    writeFileSync(
      configFile,
      `
export default {
  databases: {
    main: {
      tables: {
        users: {
          schema: {
            name: { type: 'string', required: true },
            email: { type: 'string' },
          },
        },
        posts: {
          schema: {
            title: { type: 'string' },
            body: { type: 'text' },
            authorId: { type: 'string', references: 'users' },
          },
        },
      },
    },
  },
};
`,
      'utf-8',
    );

    const result = parseConfigRegex(configFile);

    expect(result).toHaveProperty('databases');
    const databases = result.databases as Record<string, { tables: Record<string, { schema: Record<string, unknown> }> }>;
    const tables = databases.main.tables;

    // users table
    expect(tables.users.schema).toHaveProperty('name');
    expect(tables.users.schema).toHaveProperty('email');
    expect((tables.users.schema.name as { type: string; required: boolean }).required).toBe(true);

    // posts table — all 3 fields must be present
    expect(tables.posts.schema).toHaveProperty('title');
    expect(tables.posts.schema).toHaveProperty('body');
    expect(tables.posts.schema).toHaveProperty('authorId');
    expect((tables.posts.schema.authorId as { references: string }).references).toBe('users');
  });

  it('handles schema with many fields (not just the first one)', () => {
    const configFile = join(tmpDir, 'edgebase.config.ts');
    writeFileSync(
      configFile,
      `
export default {
  databases: {
    catalog: {
      tables: {
        products: {
          schema: {
            name: { type: 'string', required: true },
            price: { type: 'number', required: true },
            description: { type: 'text' },
            sku: { type: 'string' },
            active: { type: 'boolean' },
          },
        },
      },
    },
  },
};
`,
      'utf-8',
    );

    const result = parseConfigRegex(configFile);
    const databases = result.databases as Record<string, { tables: Record<string, { schema: Record<string, unknown> }> }>;
    const schema = databases.catalog.tables.products.schema;

    expect(Object.keys(schema)).toHaveLength(5);
    expect(schema).toHaveProperty('name');
    expect(schema).toHaveProperty('price');
    expect(schema).toHaveProperty('description');
    expect(schema).toHaveProperty('sku');
    expect(schema).toHaveProperty('active');
  });

  it('parses database blocks where access config appears before tables', () => {
    const configFile = join(tmpDir, 'edgebase.config.ts');
    writeFileSync(
      configFile,
      `
export default {
  databases: {
    shared: {
      tables: {
        profiles: {
          schema: {
            displayName: { type: 'string', required: true },
          },
        },
      },
    },
    server: {
      instance: true,
      access: {
        canCreate(auth) {
          return auth !== null;
        },
      },
      tables: {
        serverMessages: {
          schema: {
            channelId: { type: 'string', required: true },
            content: { type: 'text', required: true },
          },
        },
      },
    },
  },
};
`,
      'utf-8',
    );

    const result = parseConfigRegex(configFile);
    const databases = result.databases as Record<string, { tables: Record<string, { schema: Record<string, unknown> }> }>;

    expect(databases).toHaveProperty('shared');
    expect(databases).toHaveProperty('server');
    expect(databases.shared.tables).toHaveProperty('profiles');
    expect(databases.server.tables).toHaveProperty('serverMessages');
    expect(databases.server.tables.serverMessages.schema).toHaveProperty('channelId');
    expect(databases.server.tables.serverMessages.schema).toHaveProperty('content');
  });
});
