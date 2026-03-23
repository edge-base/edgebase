/**
 * Meta-test: export coverage scan.
 *
 * Verifies that every exported function/class/const in tested lib files
 * is referenced (imported or called) in at least one test file.
 *
 * Lib files without a dedicated test file are listed in UNTESTED_LIBS.
 * When you add a new test file for one of them, remove it from the list.
 */
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';

const LIB_DIR = resolve(fileURLToPath(new URL('../lib', import.meta.url)));
const TEST_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)));

// ─── Lib files that do NOT yet have dedicated tests ─────────────────────────
// Remove entries as tests are added — each removal is a net win.
const UNTESTED_LIBS = new Set([
  'analytics-adapter.ts',
  'analytics-query.ts',
  'auth-d1-service.ts',  // D1 auth service — used by auth-do + admin routes, tested via integration tests
  'auth-db-adapter.ts',  // Auth DB adapter (D1/PostgreSQL) — used by routes, tested via integration
  'control-db.ts',
  'd1-handler.ts',       // tested via integration tests only
  'do-retry.ts',
  'email-provider.ts',
  'email-translations.ts', // email i18n strings — used by auth email flows, tested via integration
  'functions.ts',
  'internal-transport.ts', // internal transport adapter — tested indirectly via functions-context tests
  'hono.ts',
  'log-writer.ts',
  'plugin-migrations.ts',
  'postgres-handler.ts',
  'postgres-schema-init.ts',
  'push-provider.ts',
  'database-live-emitter.ts', // internal helpers tested via integration tests only
  'sms-provider.ts',
  'version.ts',
]);

// ─── Exports in tested files that are not yet covered ───────────────────────
// These are known gaps. When you add a test for one, remove it here.
// Adding a NEW export without test coverage will fail CI.
const KNOWN_UNCOVERED_EXPORTS = new Set([
  'schemas.ts:listResponseSchema',
  'schemas.ts:errorResponseSchema',
  'schemas.ts:recordResponseSchema',
  'schemas.ts:successResponseSchema',
  'schemas.ts:healthResponseSchema',
  // OpenAPI route definition schemas — used by route files, not directly tested
  'schemas.ts:idParamSchema',
  'schemas.ts:nameParamSchema',
  'schemas.ts:bucketParamSchema',
  'schemas.ts:providerParamSchema',
  'schemas.ts:jsonResponseSchema',
  'schemas.ts:okResponseSchema',
  'schemas.ts:d1BodySchema',
  'schemas.ts:sqlBodySchema',
  'schemas.ts:kvBodySchema',
  'schemas.ts:vectorizeBodySchema',
  'schemas.ts:broadcastBodySchema',
  'schemas.ts:trackEventsBodySchema',
  // Admin management — used by admin routes, not yet directly tested
  'auth-d1.ts:listAdmins',
  'auth-d1.ts:deleteAdmin',
  // Database-live emitter and D1 handler — moved to UNTESTED_LIBS (integration-test only)
  // Auth D1 — _users_public helpers used by auth-do, admin routes, backup (tested via integration)
  'auth-d1.ts:upsertUserPublic',
  'auth-d1.ts:deleteUserPublic',
  'auth-d1.ts:batchDeleteUserPublic',
  'auth-d1.ts:getUserPublic',
  'auth-d1.ts:listUsersPublic',
  // Auth D1 — provider constants used by adapter tests, not directly referenced
  'auth-d1.ts:AUTH_PG_SCHEMA',
  'auth-d1.ts:AUTH_SHARD_COUNT',
]);

// ─── Extract named exports from a file ──────────────────────────────────────

function extractExports(source: string): string[] {
  const names: string[] = [];
  // export function foo / export async function foo
  for (const m of source.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)) {
    names.push(m[1]);
  }
  // export const foo / export let foo
  for (const m of source.matchAll(/export\s+(?:const|let)\s+(\w+)/g)) {
    names.push(m[1]);
  }
  // export class Foo
  for (const m of source.matchAll(/export\s+class\s+(\w+)/g)) {
    names.push(m[1]);
  }
  // export enum Foo
  for (const m of source.matchAll(/export\s+enum\s+(\w+)/g)) {
    names.push(m[1]);
  }
  return names;
}

// ─── Read all test file source at once ──────────────────────────────────────

function getAllTestSource(): string {
  const testFiles = readdirSync(TEST_DIR).filter((f) => f.endsWith('.test.ts'));
  return testFiles
    .map((f) => readFileSync(resolve(TEST_DIR, f), 'utf-8'))
    .join('\n');
}

/**
 * Check if a name is meaningfully referenced in test source.
 * Uses word-boundary matching to avoid false positives from substrings.
 */
function isReferenced(name: string, source: string): boolean {
  // Word boundary: the name appears as a standalone identifier
  const re = new RegExp(`\\b${name}\\b`);
  return re.test(source);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('export coverage scan', () => {
  const allTestSource = getAllTestSource();

  const testedLibFiles = readdirSync(LIB_DIR)
    .filter((f) => f.endsWith('.ts') && !UNTESTED_LIBS.has(f));

  it('untested lib count is tracked', () => {
    const allLibFiles = readdirSync(LIB_DIR).filter((f) => f.endsWith('.ts'));
    // If a file is in UNTESTED_LIBS but no longer exists, fail.
    for (const name of UNTESTED_LIBS) {
      expect(
        allLibFiles.includes(name),
        `UNTESTED_LIBS contains '${name}' but file does not exist. Remove it.`,
      ).toBe(true);
    }
    // Track: total = tested + untested. If you add a new lib file, decide where it goes.
    const expectedTotal = testedLibFiles.length + UNTESTED_LIBS.size;
    expect(
      allLibFiles.length,
      `New lib file detected. Add it to UNTESTED_LIBS or write tests for it.`,
    ).toBe(expectedTotal);
  });

  it('known uncovered exports are still valid', () => {
    // Ensure KNOWN_UNCOVERED_EXPORTS entries still match real exports.
    // If an export is removed or a test is added, this list must be updated.
    for (const entry of KNOWN_UNCOVERED_EXPORTS) {
      const [file, name] = entry.split(':');
      const filePath = resolve(LIB_DIR, file);
      const source = readFileSync(filePath, 'utf-8');
      const exports = extractExports(source);
      expect(
        exports.includes(name),
        `KNOWN_UNCOVERED_EXPORTS has '${entry}' but export '${name}' no longer exists in lib/${file}. Remove it.`,
      ).toBe(true);

      // Also check it's still NOT referenced (if it is, remove from list)
      // Use import-style check: the name must appear in an import or direct call context
      const importPattern = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from`);
      const directCallPattern = new RegExp(`\\b${name}\\s*\\(`);
      const isTestedNow = importPattern.test(allTestSource) || directCallPattern.test(allTestSource);
      expect(
        isTestedNow,
        `KNOWN_UNCOVERED_EXPORTS has '${entry}' but it IS imported/called in tests now. Remove it from the list.`,
      ).toBe(false);
    }
  });

  for (const libFile of testedLibFiles) {
    describe(`lib/${libFile}`, () => {
      const source = readFileSync(resolve(LIB_DIR, libFile), 'utf-8');
      const exports = extractExports(source);

      // Skip type/interface-only files
      if (exports.length === 0) return;

      for (const name of exports) {
        // Skip known uncovered exports
        if (KNOWN_UNCOVERED_EXPORTS.has(`${libFile}:${name}`)) continue;

        it(`export '${name}' is referenced in tests`, () => {
          expect(
            isReferenced(name, allTestSource),
            `Export '${name}' from lib/${libFile} is not referenced in any test file. Add a test or add to KNOWN_UNCOVERED_EXPORTS.`,
          ).toBe(true);
        });
      }
    });
  }
});
