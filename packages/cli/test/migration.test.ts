/**
 * Tests for CLI migration command — getMaxMigrationVersion, resolveConfigPath.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { _internals } from '../src/commands/migration.js';

const { getMaxMigrationVersion, resolveConfigPath, generateMigrationSnippet } = _internals;

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `eb-migration-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ======================================================================
// 1. getMaxMigrationVersion
// ======================================================================

describe('getMaxMigrationVersion', () => {
  it('extracts max version from config with migrations', () => {
    const configContent = `
import { defineConfig } from 'edgebase';

export default defineConfig({
  databases: {
    shared: {
      tables: {
        posts: {
          schema: {
            title: { type: 'string', required: true },
          },
          migrations: [
            { version: 2, description: 'add slug', up: 'ALTER TABLE posts ADD COLUMN slug TEXT' },
            { version: 3, description: 'add views', up: 'ALTER TABLE posts ADD COLUMN views REAL DEFAULT 0' },
          ],
        },
      },
    },
  },
});
`;
    const configPath = join(tmpDir, 'edgebase.config.ts');
    writeFileSync(configPath, configContent);

    expect(getMaxMigrationVersion(configPath, 'posts')).toBe(3);
  });

  it('returns 0 when table has no migrations', () => {
    const configContent = `
import { defineConfig } from 'edgebase';

export default defineConfig({
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
`;
    const configPath = join(tmpDir, 'edgebase.config.ts');
    writeFileSync(configPath, configContent);

    expect(getMaxMigrationVersion(configPath, 'posts')).toBe(0);
  });

  it('returns 0 when table does not exist', () => {
    const configContent = `
import { defineConfig } from 'edgebase';

export default defineConfig({
  databases: {
    shared: {
      tables: {
        posts: {
          schema: {},
        },
      },
    },
  },
});
`;
    const configPath = join(tmpDir, 'edgebase.config.ts');
    writeFileSync(configPath, configContent);

    expect(getMaxMigrationVersion(configPath, 'nonexistent')).toBe(0);
  });

  it('handles single migration (version 2)', () => {
    const configContent = `
export default defineConfig({
  databases: {
    shared: {
      tables: {
        tasks: {
          schema: { title: { type: 'string' } },
          migrations: [
            { version: 2, description: 'add priority', up: 'ALTER TABLE tasks ADD COLUMN priority INTEGER DEFAULT 0' },
          ],
        },
      },
    },
  },
});
`;
    const configPath = join(tmpDir, 'edgebase.config.ts');
    writeFileSync(configPath, configContent);

    expect(getMaxMigrationVersion(configPath, 'tasks')).toBe(2);
  });

  it('finds max from non-sequential versions', () => {
    const configContent = `
export default defineConfig({
  databases: {
    shared: {
      tables: {
        items: {
          schema: {},
          migrations: [
            { version: 2, description: 'v2', up: '' },
            { version: 5, description: 'v5', up: '' },
            { version: 3, description: 'v3', up: '' },
          ],
        },
      },
    },
  },
});
`;
    const configPath = join(tmpDir, 'edgebase.config.ts');
    writeFileSync(configPath, configContent);

    expect(getMaxMigrationVersion(configPath, 'items')).toBe(5);
  });
});

// ======================================================================
// 2. resolveConfigPath
// ======================================================================

describe('resolveConfigPath', () => {
  it('finds edgebase.config.ts', () => {
    writeFileSync(join(tmpDir, 'edgebase.config.ts'), 'export default {}');
    expect(resolveConfigPath(tmpDir)).toBe(join(tmpDir, 'edgebase.config.ts'));
  });

  it('finds edgebase.config.js when .ts not present', () => {
    writeFileSync(join(tmpDir, 'edgebase.config.js'), 'module.exports = {}');
    expect(resolveConfigPath(tmpDir)).toBe(join(tmpDir, 'edgebase.config.js'));
  });

  it('prefers .ts over .js when both exist', () => {
    writeFileSync(join(tmpDir, 'edgebase.config.ts'), 'export default {}');
    writeFileSync(join(tmpDir, 'edgebase.config.js'), 'module.exports = {}');
    expect(resolveConfigPath(tmpDir)).toBe(join(tmpDir, 'edgebase.config.ts'));
  });

  it('returns null when neither file exists', () => {
    expect(resolveConfigPath(tmpDir)).toBeNull();
  });

  it('returns null for empty directory', () => {
    const emptyDir = join(tmpDir, 'empty');
    mkdirSync(emptyDir);
    expect(resolveConfigPath(emptyDir)).toBeNull();
  });
});

// ======================================================================
// 3. generateMigrationSnippet (migration create skeleton)
// ======================================================================

describe('generateMigrationSnippet', () => {
  it('generates snippet with correct version and table name', () => {
    const snippet = generateMigrationSnippet(3, 'add-slug', 'posts');
    expect(snippet).toContain('version: 3');
    expect(snippet).toContain("description: 'add-slug'");
    expect(snippet).toContain('ALTER TABLE posts ADD COLUMN');
  });

  it('generates generic snippet without table name', () => {
    const snippet = generateMigrationSnippet(2, 'initial-migration');
    expect(snippet).toContain('version: 2');
    expect(snippet).toContain("description: 'initial-migration'");
    expect(snippet).toContain('ALTER TABLE your_table ADD COLUMN');
  });

  it('handles single quotes in migration name', () => {
    const snippet = generateMigrationSnippet(2, "add 'status' field", 'posts');
    expect(snippet).toContain('version: 2');
    // Single quotes inside single-quoted string — currently unescaped
    // This is safe because the snippet is pasted into TS config, not executed
    expect(snippet).toContain("add 'status' field");
  });

  it('auto-calculates next version from config', () => {
    const configContent = `
export default defineConfig({
  databases: {
    shared: {
      tables: {
        posts: {
          schema: {},
          migrations: [
            { version: 2, description: 'v2', up: '' },
            { version: 3, description: 'v3', up: '' },
          ],
        },
      },
    },
  },
});
`;
    const configPath = join(tmpDir, 'edgebase.config.ts');
    writeFileSync(configPath, configContent);

    const maxVersion = getMaxMigrationVersion(configPath, 'posts');
    const nextVersion = maxVersion + 1;
    const snippet = generateMigrationSnippet(nextVersion, 'add-views', 'posts');
    expect(snippet).toContain('version: 4');
  });
});
