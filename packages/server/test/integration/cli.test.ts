/**
 * cli.test.ts — 40개
 *
 * CLI-adjacent functionality tests.
 * CLI commands (packages/cli/src/commands/*) use Node.js APIs (child_process, fs)
 * that cannot run inside Miniflare. This file tests the pure-logic portions
 * by re-implementing or importing the testable functions:
 *
 *   1. generateTempWranglerToml: KV/D1/Vectorize binding injection, duplicate prevention,
 *      original content preservation, mixed bindings
 *   2. Schema DDL generation: CREATE TABLE, indexes, FTS5, auto-fields, foreign keys
 *   3. Schema destructive change detection: computeSchemaHashSync
 *   4. Config validation: validateConfig (table name uniqueness, inline key warnings)
 *   5. Migration utilities: getMaxMigrationVersion, generateMigrationSnippet
 *   6. Key generation: generateServiceKey pattern, maskKey
 *   7. Field validation: validateInsert, validateUpdate
 */
import { describe, it, expect } from 'vitest';
import {
  buildEffectiveSchema,
  generateCreateTableDDL,
  generateIndexDDL,
  generateFTS5DDL,
  generateFTS5Triggers,
  generateAddColumnDDL,
  computeSchemaHashSync,
  generateTableDDL,
} from '../../src/lib/schema.js';
import { validateInsert, validateUpdate } from '../../src/lib/validation.js';

// ─── Inline replicas of pure CLI functions (cannot import from packages/cli in Miniflare) ───

/** Replica of packages/cli/src/commands/deploy.ts → generateTempWranglerToml */
interface ProvisionedBinding {
  type: 'kv_namespace' | 'd1_database' | 'vectorize';
  name: string;
  binding: string;
  id: string;
}

function generateTempWranglerToml(
  originalContent: string,
  bindings: ProvisionedBinding[],
): string | null {
  if (bindings.length === 0) return null;

  const kvBindings = bindings.filter((b) => b.type === 'kv_namespace');
  const d1Bindings = bindings.filter((b) => b.type === 'd1_database');
  const vecBindings = bindings.filter((b) => b.type === 'vectorize');
  const d1BindingNames = new Set(d1Bindings.map((binding) => binding.binding));

  let sanitizedOriginal = originalContent;
  if (d1BindingNames.size > 0) {
    sanitizedOriginal = sanitizedOriginal.replace(
      /\n?\[\[d1_databases\]\][\s\S]*?(?=\n\[\[|\n\[|$)/g,
      (block) => {
        const bindingMatch = block.match(/^\s*binding\s*=\s*"([^"]+)"/m);
        if (bindingMatch && d1BindingNames.has(bindingMatch[1])) {
          return '';
        }
        return block;
      },
    );
  }

  const sections: string[] = [sanitizedOriginal, '', '# ─── Auto-provisioned bindings ───'];

  if (kvBindings.length > 0) {
    if (originalContent.includes('kv_namespaces')) {
      for (const b of kvBindings) {
        if (!originalContent.includes(`binding = "${b.binding}"`)) {
          sections.push(`\n[[kv_namespaces]]\nbinding = "${b.binding}"\nid = "${b.id}"`);
        }
      }
    } else {
      for (const b of kvBindings) {
        sections.push(`\n[[kv_namespaces]]\nbinding = "${b.binding}"\nid = "${b.id}"`);
      }
    }
  }

  if (d1Bindings.length > 0) {
    for (const b of d1Bindings) {
      sections.push(
        `\n[[d1_databases]]\nbinding = "${b.binding}"\ndatabase_name = "edgebase-${b.name}"\ndatabase_id = "${b.id}"`,
      );
    }
  }

  if (vecBindings.length > 0) {
    if (originalContent.includes('vectorize')) {
      for (const b of vecBindings) {
        if (!originalContent.includes(`binding = "${b.binding}"`)) {
          sections.push(`\n[[vectorize]]\nbinding = "${b.binding}"\nindex_name = "${b.id}"`);
        }
      }
    } else {
      for (const b of vecBindings) {
        sections.push(`\n[[vectorize]]\nbinding = "${b.binding}"\nindex_name = "${b.id}"`);
      }
    }
  }

  if (sections.length <= 3) return null;
  return sections.join('\n') + '\n';
}

/** Replica of packages/cli/src/commands/deploy.ts → validateConfig */
function validateConfig(
  config: Record<string, unknown>,
  warnings: string[],
  errors: string[],
): void {
  const SERVICE_KEY_KID_PATTERN = /^[A-Za-z0-9-]+$/;

  if (!config.release) {
    warnings.push(
      'release is false — all resources are accessible without rules. ' +
        'Set release: true in edgebase.config.ts before production deployment.',
    );
  }

  const serviceKeys = config.serviceKeys as
    | {
      keys?: Array<{
        kid?: string;
        tier?: string;
        secretSource?: string;
        secretRef?: string;
        inlineSecret?: string;
        constraints?: { tenant?: string; ipCidr?: string[] };
      }>;
    }
    | undefined;
  if (serviceKeys?.keys) {
    const seenKids = new Set<string>();
    for (const [index, key] of serviceKeys.keys.entries()) {
      if (!key.kid || typeof key.kid !== 'string') {
        errors.push(`serviceKeys.keys[${index}].kid is required and must be a string.`);
        continue;
      }

      if (!SERVICE_KEY_KID_PATTERN.test(key.kid)) {
        errors.push(
          `serviceKeys.keys[${index}].kid '${key.kid}' is invalid. ` +
            `Use letters, numbers, and hyphens only. ` +
            `Underscore is reserved by the structured key format 'jb_{kid}_{secret}'.`,
        );
      }

      if (seenKids.has(key.kid)) {
        errors.push(`Duplicate Service Key kid '${key.kid}'. Each serviceKeys.keys entry must be unique.`);
      } else {
        seenKids.add(key.kid);
      }

      if (key.secretSource === 'dashboard' && (!key.secretRef || typeof key.secretRef !== 'string')) {
        errors.push(
          `serviceKeys.keys[${index}] (${key.kid}): secretSource 'dashboard' requires a non-empty secretRef.`,
        );
      }

      if (key.secretSource === 'inline' && (!key.inlineSecret || typeof key.inlineSecret !== 'string')) {
        errors.push(
          `serviceKeys.keys[${index}] (${key.kid}): secretSource 'inline' requires a non-empty inlineSecret.`,
        );
      }
    }

    const inlineKeys = serviceKeys.keys.filter((k) => k.secretSource === 'inline');
    if (inlineKeys.length > 0) {
      const kids = inlineKeys.map((k) => k.kid ?? 'unknown').join(', ');
      warnings.push(
        `Service Key(s) [${kids}] use secretSource: 'inline' — ` +
          `inline secrets are stored in edgebase.config.ts and risk leaking via git. ` +
          `Use secretSource: 'dashboard' with Workers Secrets for production.`,
      );
    }

    const rootKeys = serviceKeys.keys.filter((k) => k.tier === 'root');
    if (
      rootKeys.length > 0
      && rootKeys.every((key) => !!key.constraints?.tenant || !!key.constraints?.ipCidr?.length)
    ) {
      warnings.push(
        'All root-tier Service Keys are request-scoped via tenant/ipCidr constraints. ' +
          'Internal EdgeBase self-calls for auth hooks, storage hooks, plugin migrations, and function admin helpers ' +
          'need at least one root-tier key without tenant/ipCidr constraints. Prefer a dedicated root key with secretRef: \'SERVICE_KEY\'.',
      );
    }
  }

  const RESERVED_TOP_KEYS = new Set([
    'release',
    'storage',
    'rooms',
    'auth',
    'serviceKeys',
    'captcha',
    'email',
    'push',
    'plugins',
    'enrichAuth',
    'rateLimits',
    'functions',
  ]);
  const seenTables = new Map<string, string>();
  for (const [dbKey, dbBlock] of Object.entries(config)) {
    if (RESERVED_TOP_KEYS.has(dbKey)) continue;
    const tables = (dbBlock as Record<string, unknown>)?.tables;
    if (!tables || typeof tables !== 'object') continue;
    for (const tableName of Object.keys(tables as Record<string, unknown>)) {
      if (seenTables.has(tableName)) {
        errors.push(
          `Table name '${tableName}' is duplicated in DB block '${seenTables.get(tableName)}' and '${dbKey}'. ` +
            `Table names must be unique across all DB blocks (§18).`,
        );
      } else {
        seenTables.set(tableName, dbKey);
      }
    }
  }
}

/** Replica of packages/cli/src/commands/migration.ts → getMaxMigrationVersion */
function getMaxMigrationVersion(configContent: string, tableName: string): number {
  const tableRegex = new RegExp(
    `${tableName}\\s*:\\s*\\{[\\s\\S]*?migrations\\s*:\\s*\\[([\\s\\S]*?)\\]`,
    'm',
  );
  const match = tableRegex.exec(configContent);
  if (!match) return 0;

  const versionRegex = /version\s*:\s*(\d+)/g;
  let maxVersion = 0;
  let vMatch;
  while ((vMatch = versionRegex.exec(match[1])) !== null) {
    const v = parseInt(vMatch[1], 10);
    if (v > maxVersion) maxVersion = v;
  }
  return maxVersion;
}

/** Replica of packages/cli/src/commands/migration.ts → generateMigrationSnippet */
function generateMigrationSnippet(version: number, name: string, tableName?: string): string {
  return `{
  version: ${version},
  description: '${name}',
  up: \`
    -- Write your SQL migration here
    -- Supported DDL: ALTER TABLE, CREATE INDEX, DROP COLUMN (SQLite 3.35.0+)
    -- RENAME COLUMN (SQLite 3.25.0+)
    -- Example:
    -- ALTER TABLE ${tableName ?? 'your_table'} ADD COLUMN newField TEXT DEFAULT '';
  \`,
},`;
}

/** Replica of packages/cli/src/commands/keys.ts → generateServiceKey */
function generateServiceKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Replica of packages/cli/src/commands/keys.ts → maskKey */
function maskKey(key: string): string {
  if (key.length <= 8) return '****';
  return `sk_${'*'.repeat(12)}${key.slice(-4)}`;
}

// ─── Test Data ───────────────────────────────────────────────────────────────

const MINIMAL_WRANGLER = `name = "edgebase-test"\nmain = "src/index.ts"\ncompatibility_date = "2025-02-10"`;

const WRANGLER_WITH_KV = `name = "edgebase-test"\nmain = "src/index.ts"\n\n[[kv_namespaces]]\nbinding = "KV"\nid = "existing-kv-id"`;

const WRANGLER_WITH_D1 = `name = "edgebase-test"\nmain = "src/index.ts"\n\n[[d1_databases]]\nbinding = "AUTH_DB"\ndatabase_name = "edgebase-auth"\ndatabase_id = "existing-d1-id"`;

// ─── 1. generateTempWranglerToml ─────────────────────────────────────────────

describe('1-01 cli — generateTempWranglerToml: KV bindings', () => {
  it('appends single KV binding to minimal wrangler.toml', () => {
    const result = generateTempWranglerToml(MINIMAL_WRANGLER, [
      { type: 'kv_namespace', name: 'cache', binding: 'CACHE_KV', id: 'kv-id-001' },
    ]);
    expect(result).not.toBeNull();
    expect(result).toContain(MINIMAL_WRANGLER);
    expect(result).toContain('binding = "CACHE_KV"');
    expect(result).toContain('id = "kv-id-001"');
    expect(result).toContain('[[kv_namespaces]]');
  });

  it('appends multiple KV bindings', () => {
    const result = generateTempWranglerToml(MINIMAL_WRANGLER, [
      { type: 'kv_namespace', name: 'cache', binding: 'CACHE_KV', id: 'kv-id-001' },
      { type: 'kv_namespace', name: 'sessions', binding: 'SESSIONS_KV', id: 'kv-id-002' },
    ]);
    expect(result).toContain('binding = "CACHE_KV"');
    expect(result).toContain('binding = "SESSIONS_KV"');
  });
});

describe('1-02 cli — generateTempWranglerToml: D1 bindings', () => {
  it('appends D1 binding with database_name and database_id', () => {
    const result = generateTempWranglerToml(MINIMAL_WRANGLER, [
      { type: 'd1_database', name: 'analytics', binding: 'ANALYTICS_DB', id: 'd1-id-001' },
    ]);
    expect(result).toContain('[[d1_databases]]');
    expect(result).toContain('binding = "ANALYTICS_DB"');
    expect(result).toContain('database_name = "edgebase-analytics"');
    expect(result).toContain('database_id = "d1-id-001"');
  });
});

describe('1-03 cli — generateTempWranglerToml: Vectorize bindings', () => {
  it('appends Vectorize binding with index_name', () => {
    const result = generateTempWranglerToml(MINIMAL_WRANGLER, [
      {
        type: 'vectorize',
        name: 'embeddings',
        binding: 'VECTORIZE_EMBEDDINGS',
        id: 'edgebase-embeddings',
      },
    ]);
    expect(result).toContain('[[vectorize]]');
    expect(result).toContain('binding = "VECTORIZE_EMBEDDINGS"');
    expect(result).toContain('index_name = "edgebase-embeddings"');
  });
});

describe('1-04 cli — generateTempWranglerToml: mixed bindings', () => {
  it('appends KV + D1 + Vectorize in a single pass', () => {
    const result = generateTempWranglerToml(MINIMAL_WRANGLER, [
      { type: 'kv_namespace', name: 'cache', binding: 'CACHE_KV', id: 'kv-001' },
      { type: 'd1_database', name: 'db', binding: 'USER_DB', id: 'd1-001' },
      { type: 'vectorize', name: 'search', binding: 'SEARCH_VEC', id: 'edgebase-search' },
    ]);
    expect(result).toContain('[[kv_namespaces]]');
    expect(result).toContain('[[d1_databases]]');
    expect(result).toContain('[[vectorize]]');
    expect(result).toContain('binding = "CACHE_KV"');
    expect(result).toContain('binding = "USER_DB"');
    expect(result).toContain('binding = "SEARCH_VEC"');
  });
});

describe('1-05 cli — generateTempWranglerToml: duplicate prevention', () => {
  it('skips KV binding when binding name already in original', () => {
    const result = generateTempWranglerToml(WRANGLER_WITH_KV, [
      { type: 'kv_namespace', name: 'existing', binding: 'KV', id: 'new-kv-id' },
    ]);
    // Binding "KV" already in original, so should not be duplicated
    expect(result).toBeNull();
  });

  it('adds new KV binding but skips existing one', () => {
    const result = generateTempWranglerToml(WRANGLER_WITH_KV, [
      { type: 'kv_namespace', name: 'existing', binding: 'KV', id: 'new-kv-id' },
      { type: 'kv_namespace', name: 'cache', binding: 'CACHE_KV', id: 'cache-kv-id' },
    ]);
    expect(result).not.toBeNull();
    expect(result).toContain('binding = "CACHE_KV"');
    // The original "KV" binding should NOT be duplicated
    const kvOccurrences = (result!.match(/binding = "KV"/g) || []).length;
    expect(kvOccurrences).toBe(1);
  });

  it('replaces D1 binding when binding name already exists in original', () => {
    const result = generateTempWranglerToml(WRANGLER_WITH_D1, [
      { type: 'd1_database', name: 'auth', binding: 'AUTH_DB', id: 'new-d1-id' },
      { type: 'd1_database', name: 'control', binding: 'CONTROL_DB', id: 'control-d1-id' },
    ]);
    expect(result).not.toBeNull();
    expect(result).toContain('database_id = "new-d1-id"');
    expect(result).toContain('binding = "CONTROL_DB"');
    expect(result).not.toContain('database_id = "existing-d1-id"');
  });
});

describe('1-06 cli — generateTempWranglerToml: original preservation', () => {
  it('returns null for empty bindings array', () => {
    const result = generateTempWranglerToml(MINIMAL_WRANGLER, []);
    expect(result).toBeNull();
  });

  it('original wrangler.toml content is fully preserved at the top', () => {
    const result = generateTempWranglerToml(MINIMAL_WRANGLER, [
      { type: 'kv_namespace', name: 'test', binding: 'TEST_KV', id: 'test-id' },
    ]);
    expect(result!.startsWith(MINIMAL_WRANGLER)).toBe(true);
  });

  it('includes auto-provisioned comment marker', () => {
    const result = generateTempWranglerToml(MINIMAL_WRANGLER, [
      { type: 'kv_namespace', name: 'test', binding: 'TEST_KV', id: 'test-id' },
    ]);
    expect(result).toContain('Auto-provisioned bindings');
  });
});

// ─── 2. Schema DDL Generation ────────────────────────────────────────────────

describe('2-01 cli — schema DDL: buildEffectiveSchema', () => {
  it('injects auto fields (id, createdAt, updatedAt) when schema is provided', () => {
    const effective = buildEffectiveSchema({
      title: { type: 'string', required: true },
    });
    expect(effective).toHaveProperty('id');
    expect(effective).toHaveProperty('createdAt');
    expect(effective).toHaveProperty('updatedAt');
    expect(effective).toHaveProperty('title');
  });

  it('returns only auto fields when schema is undefined (schemaless)', () => {
    const effective = buildEffectiveSchema(undefined);
    expect(Object.keys(effective)).toEqual(['id', 'createdAt', 'updatedAt']);
  });

  it('allows disabling auto fields with false', () => {
    const effective = buildEffectiveSchema({
      updatedAt: false,
      title: { type: 'string' },
    });
    expect(effective).not.toHaveProperty('updatedAt');
    expect(effective).toHaveProperty('id');
    expect(effective).toHaveProperty('title');
  });

  it('auto field type override is blocked', () => {
    const effective = buildEffectiveSchema({
      id: { type: 'number', primaryKey: true },
    });
    expect(effective.id.type).toBe('string'); // 타입 오버라이드 불가, auto-field 타입 유지
  });
});

describe('2-02 cli — schema DDL: generateCreateTableDDL', () => {
  it('generates valid CREATE TABLE with auto fields', () => {
    const ddl = generateCreateTableDDL('posts', {
      schema: {
        title: { type: 'string', required: true },
        views: { type: 'number', default: 0 },
      },
    });
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS "posts"');
    expect(ddl).toContain('"id" TEXT PRIMARY KEY');
    expect(ddl).toContain('"createdAt" TEXT');
    expect(ddl).toContain('"updatedAt" TEXT');
    expect(ddl).toContain('"title" TEXT NOT NULL');
    expect(ddl).toContain('"views" REAL DEFAULT 0');
  });

  it('generates DDL for schemaless table (auto fields only)', () => {
    const ddl = generateCreateTableDDL('notes', {});
    expect(ddl).toContain('"id" TEXT PRIMARY KEY');
    expect(ddl).toContain('"createdAt" TEXT');
    expect(ddl).toContain('"updatedAt" TEXT');
  });
});

describe('2-03 cli — schema DDL: generateIndexDDL', () => {
  it('generates single-field index', () => {
    const ddls = generateIndexDDL('posts', [{ fields: ['authorId'] }]);
    expect(ddls).toHaveLength(1);
    expect(ddls[0]).toContain('CREATE INDEX IF NOT EXISTS');
    expect(ddls[0]).toContain('"authorId"');
  });

  it('generates composite index', () => {
    const ddls = generateIndexDDL('posts', [{ fields: ['isPublished', 'createdAt'] }]);
    expect(ddls[0]).toContain('"isPublished", "createdAt"');
  });

  it('generates unique index', () => {
    const ddls = generateIndexDDL('users', [{ fields: ['email'], unique: true }]);
    expect(ddls[0]).toContain('CREATE UNIQUE INDEX');
  });
});

describe('2-04 cli — schema DDL: generateFTS5DDL', () => {
  it('generates FTS5 virtual table with trigram tokenizer', () => {
    const ddl = generateFTS5DDL('posts', ['title', 'content']);
    expect(ddl).toContain('CREATE VIRTUAL TABLE IF NOT EXISTS "posts_fts"');
    expect(ddl).toContain('USING fts5');
    expect(ddl).toContain('title, content');
    expect(ddl).toContain("content='posts'");
    expect(ddl).toContain("tokenize='trigram'");
  });
});

describe('2-05 cli — schema DDL: generateFTS5Triggers', () => {
  it('generates insert, delete, and update triggers', () => {
    const triggers = generateFTS5Triggers('posts', ['title', 'content']);
    expect(triggers).toHaveLength(3);
    expect(triggers[0]).toContain('AFTER INSERT');
    expect(triggers[1]).toContain('AFTER DELETE');
    expect(triggers[2]).toContain('AFTER UPDATE');
  });
});

describe('2-06 cli — schema DDL: generateAddColumnDDL', () => {
  it('generates ALTER TABLE ADD COLUMN statement', () => {
    const ddl = generateAddColumnDDL('posts', 'slug', { type: 'string' });
    expect(ddl).toContain('ALTER TABLE "posts" ADD COLUMN "slug" TEXT');
  });
});

describe('2-07 cli — schema DDL: foreign key references', () => {
  it('keeps auth user references logical-only for string-form FK', () => {
    const ddl = generateCreateTableDDL('posts', {
      schema: {
        authorId: { type: 'string', references: 'users' },
      },
    });
    expect(ddl).not.toContain('REFERENCES "users"("id")');
  });

  it('generates REFERENCES clause for object-form FK with onDelete', () => {
    const ddl = generateCreateTableDDL('posts', {
      schema: {
        categoryId: { type: 'string', references: { table: 'categories', onDelete: 'CASCADE' } },
      },
    });
    expect(ddl).toContain('REFERENCES "categories"("id")');
    expect(ddl).toContain('ON DELETE CASCADE');
  });
});

// ─── 3. Schema Destructive Change Detection ──────────────────────────────────

describe('3-01 cli — schema hash: computeSchemaHashSync', () => {
  it('produces consistent hash for same schema', () => {
    const config = { schema: { title: { type: 'string' as const } } };
    const hash1 = computeSchemaHashSync(config);
    const hash2 = computeSchemaHashSync(config);
    expect(hash1).toBe(hash2);
  });

  it('produces different hash when field is added', () => {
    const before = { schema: { title: { type: 'string' as const } } };
    const after = {
      schema: { title: { type: 'string' as const }, body: { type: 'text' as const } },
    };
    expect(computeSchemaHashSync(before)).not.toBe(computeSchemaHashSync(after));
  });

  it('produces different hash when field type changes', () => {
    const before = { schema: { count: { type: 'string' as const } } };
    const after = { schema: { count: { type: 'number' as const } } };
    expect(computeSchemaHashSync(before)).not.toBe(computeSchemaHashSync(after));
  });

  it('produces same hash regardless of key order', () => {
    const a = { schema: { title: { type: 'string' as const }, body: { type: 'text' as const } } };
    const b = { schema: { body: { type: 'text' as const }, title: { type: 'string' as const } } };
    expect(computeSchemaHashSync(a)).toBe(computeSchemaHashSync(b));
  });

  it('produces different hash when constraint changes (required)', () => {
    const before = { schema: { title: { type: 'string' as const } } };
    const after = { schema: { title: { type: 'string' as const, required: true } } };
    expect(computeSchemaHashSync(before)).not.toBe(computeSchemaHashSync(after));
  });

  it('ignores access/hooks — only hashes schema field', () => {
    const withAccess = {
      schema: { title: { type: 'string' as const } },
      access: { read: () => true },
    };
    const withoutAccess = { schema: { title: { type: 'string' as const } } };
    // access callbacks contain functions which serialize to undefined, so hashes should match
    expect(computeSchemaHashSync(withAccess)).toBe(computeSchemaHashSync(withoutAccess));
  });
});

// ─── 4. Config Validation ────────────────────────────────────────────────────

describe('4-01 cli — validateConfig: release mode warning', () => {
  it('warns when release is false', () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    validateConfig({ release: false }, warnings, errors);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('release is false');
  });

  it('no release warning when release is true', () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    validateConfig({ release: true }, warnings, errors);
    expect(warnings).toHaveLength(0);
  });
});

describe('4-02 cli — validateConfig: inline service key warning', () => {
  it('warns about inline secretSource', () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    validateConfig(
      {
        release: true,
        serviceKeys: { keys: [{ kid: 'sk-01', secretSource: 'inline' }] },
      },
      warnings,
      errors,
    );
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('inline');
    expect(warnings[0]).toContain('sk-01');
  });

  it('does not warn about dashboard secretSource', () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    validateConfig(
      {
        release: true,
        serviceKeys: { keys: [{ kid: 'sk-01', secretSource: 'dashboard' }] },
      },
      warnings,
      errors,
    );
    expect(warnings).toHaveLength(0);
  });

  it('errors when a service key kid contains underscores', () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    validateConfig(
      {
        release: true,
        serviceKeys: {
          keys: [{ kid: 'sk_01', secretSource: 'dashboard', secretRef: 'SERVICE_KEY' }],
        },
      },
      warnings,
      errors,
    );
    expect(errors[0]).toContain('Underscore is reserved');
  });

  it('warns when every root-tier key is request-scoped', () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    validateConfig(
      {
        release: true,
        serviceKeys: {
          keys: [
            {
              kid: 'tenant-root',
              tier: 'root',
              secretSource: 'dashboard',
              secretRef: 'SERVICE_KEY_TENANT',
              constraints: { tenant: 'workspace-123' },
            },
          ],
        },
      },
      warnings,
      errors,
    );
    expect(errors).toHaveLength(0);
    expect(warnings.some((warning) => warning.includes('All root-tier Service Keys are request-scoped'))).toBe(true);
  });
});

describe('4-03 cli — validateConfig: duplicate table names', () => {
  it('errors on duplicate table name across DB blocks', () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    validateConfig(
      {
        release: true,
        shared: { tables: { posts: {} } },
        analytics: { tables: { posts: {} } },
      },
      warnings,
      errors,
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('posts');
    expect(errors[0]).toContain('duplicated');
  });

  it('no error for unique table names across DB blocks', () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    validateConfig(
      {
        release: true,
        shared: { tables: { posts: {} } },
        analytics: { tables: { events: {} } },
      },
      warnings,
      errors,
    );
    expect(errors).toHaveLength(0);
  });

  it('ignores reserved top-level keys (auth, storage, etc.)', () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    validateConfig(
      {
        release: true,
        auth: { emailAuth: true },
        storage: { buckets: {} },
        shared: { tables: { posts: {} } },
      },
      warnings,
      errors,
    );
    expect(errors).toHaveLength(0);
  });
});

// ─── 5. Migration Utilities ──────────────────────────────────────────────────

describe('5-01 cli — getMaxMigrationVersion', () => {
  it('returns max version from config content', () => {
    const content = `
      categories: {
        schema: { name: { type: 'string' } },
        migrations: [
          { version: 2, up: 'ALTER TABLE categories ADD COLUMN slug TEXT;' },
          { version: 3, up: 'ALTER TABLE categories ADD COLUMN sortOrder REAL DEFAULT 0;' },
        ],
      },
    `;
    expect(getMaxMigrationVersion(content, 'categories')).toBe(3);
  });

  it('returns 0 when table has no migrations', () => {
    const content = `posts: { schema: { title: { type: 'string' } } }`;
    expect(getMaxMigrationVersion(content, 'posts')).toBe(0);
  });

  it('returns 0 when table is not found in content', () => {
    const content = `posts: { migrations: [ { version: 2, up: '...' } ] }`;
    expect(getMaxMigrationVersion(content, 'nonexistent')).toBe(0);
  });
});

describe('5-02 cli — generateMigrationSnippet', () => {
  it('generates snippet with correct version and description', () => {
    const snippet = generateMigrationSnippet(4, 'add-email-field', 'users');
    expect(snippet).toContain('version: 4');
    expect(snippet).toContain("description: 'add-email-field'");
    expect(snippet).toContain('ALTER TABLE users');
  });

  it('uses generic placeholder when no tableName provided', () => {
    const snippet = generateMigrationSnippet(2, 'initial');
    expect(snippet).toContain('ALTER TABLE your_table');
  });

  it('includes SQL migration comment guidance', () => {
    const snippet = generateMigrationSnippet(2, 'test');
    expect(snippet).toContain('Write your SQL migration here');
    expect(snippet).toContain('DROP COLUMN');
    expect(snippet).toContain('RENAME COLUMN');
  });
});

// ─── 6. Key Generation & Masking ─────────────────────────────────────────────

describe('6-01 cli — generateServiceKey', () => {
  it('generates 64-character hex string', () => {
    const key = generateServiceKey();
    expect(key).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(key)).toBe(true);
  });

  it('generates unique keys on each call', () => {
    const key1 = generateServiceKey();
    const key2 = generateServiceKey();
    expect(key1).not.toBe(key2);
  });
});

describe('6-02 cli — maskKey', () => {
  it('masks long keys showing sk_ prefix and last 4 chars', () => {
    const key = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    const masked = maskKey(key);
    expect(masked.startsWith('sk_')).toBe(true);
    expect(masked.endsWith('7890')).toBe(true);
    expect(masked).toContain('************');
  });

  it('returns **** for very short keys', () => {
    expect(maskKey('abcd')).toBe('****');
    expect(maskKey('abcdefgh')).toBe('****');
  });

  it('masks 9-char key correctly', () => {
    const masked = maskKey('123456789');
    expect(masked.startsWith('sk_')).toBe(true);
    expect(masked.endsWith('6789')).toBe(true);
  });
});

// ─── 7. Field Validation (CLI uses schema validation for deploy checks) ──────

describe('7-01 cli — validateInsert: required fields', () => {
  it('rejects missing required field', () => {
    const result = validateInsert(
      {},
      {
        title: { type: 'string', required: true },
      },
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveProperty('title');
  });

  it('accepts record with all required fields', () => {
    const result = validateInsert(
      { title: 'Hello' },
      {
        title: { type: 'string', required: true },
      },
    );
    expect(result.valid).toBe(true);
  });

  it('accepts missing optional field', () => {
    const result = validateInsert(
      {},
      {
        description: { type: 'text' },
      },
    );
    expect(result.valid).toBe(true);
  });
});

describe('7-02 cli — validateInsert: type checking', () => {
  it('rejects number when string expected', () => {
    const result = validateInsert(
      { title: 42 },
      {
        title: { type: 'string' },
      },
    );
    expect(result.valid).toBe(false);
    expect(result.errors.title).toContain('string');
  });

  it('rejects string when number expected', () => {
    const result = validateInsert(
      { count: 'five' },
      {
        count: { type: 'number' },
      },
    );
    expect(result.valid).toBe(false);
  });

  it('rejects non-boolean for boolean field', () => {
    const result = validateInsert(
      { active: 'yes' },
      {
        active: { type: 'boolean' },
      },
    );
    expect(result.valid).toBe(false);
  });
});

describe('7-03 cli — validateInsert: constraints', () => {
  it('rejects string shorter than min length', () => {
    const result = validateInsert(
      { title: 'ab' },
      {
        title: { type: 'string', min: 3 },
      },
    );
    expect(result.valid).toBe(false);
    expect(result.errors.title).toContain('at least 3');
  });

  it('rejects string longer than max length', () => {
    const result = validateInsert(
      { title: 'a'.repeat(201) },
      {
        title: { type: 'string', max: 200 },
      },
    );
    expect(result.valid).toBe(false);
  });

  it('rejects value not in enum', () => {
    const result = validateInsert(
      { status: 'unknown' },
      {
        status: { type: 'string', enum: ['draft', 'published'] },
      },
    );
    expect(result.valid).toBe(false);
    expect(result.errors.status).toContain('one of');
  });
});

describe('7-04 cli — validateInsert: unknown fields silently ignored', () => {
  it('accepts unknown fields (silently ignored at SQL layer)', () => {
    const result = validateInsert(
      { title: 'Hi', hackField: 'xss' },
      {
        title: { type: 'string' },
      },
    );
    expect(result.valid).toBe(true);
    expect(Object.keys(result.errors)).toHaveLength(0);
  });
});

describe('7-05 cli — validateInsert: schemaless mode', () => {
  it('accepts anything when schema is undefined', () => {
    const result = validateInsert({ anything: 'goes', count: 42 });
    expect(result.valid).toBe(true);
    expect(Object.keys(result.errors)).toHaveLength(0);
  });
});

describe('7-06 cli — validateUpdate: partial validation', () => {
  it('validates only provided fields', () => {
    const result = validateUpdate(
      { title: 'Updated Title' },
      {
        title: { type: 'string', required: true },
        content: { type: 'text', required: true },
      },
    );
    // content is not in the update data, so should not error
    expect(result.valid).toBe(true);
  });

  it('rejects null for required field in update', () => {
    const result = validateUpdate(
      { title: null },
      {
        title: { type: 'string', required: true },
      },
    );
    expect(result.valid).toBe(false);
  });
});

describe('7-07 cli — validateUpdate: field operators bypass', () => {
  it('accepts $op increment operator', () => {
    const result = validateUpdate(
      { views: { $op: 'increment', value: 1 } },
      {
        views: { type: 'number', default: 0 },
      },
    );
    expect(result.valid).toBe(true);
  });

  it('accepts $op deleteField operator', () => {
    const result = validateUpdate(
      { extra: { $op: 'deleteField' } },
      {
        extra: { type: 'string' },
      },
    );
    expect(result.valid).toBe(true);
  });
});

// ─── 8. generateTableDDL (combined DDL output) ──────────────────────────────

describe('8-01 cli — generateTableDDL: complete DDL output', () => {
  it('generates CREATE TABLE + indexes + FTS5 in order', () => {
    const ddls = generateTableDDL('posts', {
      schema: {
        title: { type: 'string', required: true },
        content: { type: 'text' },
      },
      indexes: [{ fields: ['createdAt'] }],
      fts: ['title', 'content'],
    });
    // Should have: CREATE TABLE + 1 index + 1 FTS5 virtual table + 3 triggers = 6
    expect(ddls.length).toBeGreaterThanOrEqual(5);
    expect(ddls[0]).toContain('CREATE TABLE IF NOT EXISTS "posts"');
    expect(ddls.some((d) => d.includes('CREATE INDEX'))).toBe(true);
    expect(ddls.some((d) => d.includes('CREATE VIRTUAL TABLE'))).toBe(true);
  });

  it('generates only CREATE TABLE for minimal config', () => {
    const ddls = generateTableDDL('simple', { schema: { name: { type: 'string' } } });
    expect(ddls).toHaveLength(1);
    expect(ddls[0]).toContain('CREATE TABLE');
  });
});
