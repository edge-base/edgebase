/**
 * deploy-routing.test.ts — Unit tests for file-system routing helpers in deploy.ts.
 *
 * Tests:
 *   - buildRouteName: index.ts stripping, group stripping, param preservation
 *   - detectExports: named exports (GET, POST, etc.), default exports, mixed
 *   - scanFunctions: file-system scanning with _middleware, groups, params
 *   - validateRouteNames: duplicate detection, middleware skipping
 *
 * Convention: vitest, tmpdir-based file system fixtures, cleanup in afterEach.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { _internals } from '../src/commands/deploy.js';

const { buildRouteName, detectExports, scanFunctions, validateRouteNames } = _internals;

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `eb-deploy-routing-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. buildRouteName
// ═══════════════════════════════════════════════════════════════════════════

describe('buildRouteName — index.ts stripping', () => {
  it('index.ts at root → empty string', () => {
    expect(buildRouteName('index.ts')).toBe('');
  });

  it('nested index.ts → parent directory path', () => {
    expect(buildRouteName('users/index.ts')).toBe('users');
  });

  it('deeply nested index.ts → parent path', () => {
    expect(buildRouteName('api/admin/index.ts')).toBe('api/admin');
  });
});

describe('buildRouteName — .ts extension stripping', () => {
  it('simple file → name without .ts', () => {
    expect(buildRouteName('hello.ts')).toBe('hello');
  });

  it('nested file → full path without .ts', () => {
    expect(buildRouteName('users/profile.ts')).toBe('users/profile');
  });
});

describe('buildRouteName — group stripping', () => {
  it('(group)/file.ts → file', () => {
    expect(buildRouteName('(auth)/login.ts')).toBe('login');
  });

  it('(group)/nested/file.ts → nested/file', () => {
    expect(buildRouteName('(admin)/users/list.ts')).toBe('users/list');
  });

  it('nested/(group)/file.ts → nested/file', () => {
    expect(buildRouteName('api/(v1)/hello.ts')).toBe('api/hello');
  });

  it('multiple groups stripped', () => {
    expect(buildRouteName('(auth)/(protected)/dashboard.ts')).toBe('dashboard');
  });

  it('group-only path → empty string', () => {
    // (groupName) as the entire remaining path after stripping .ts
    expect(buildRouteName('(root).ts')).toBe('');
  });

  it('group with index.ts → stripped to parent', () => {
    expect(buildRouteName('(auth)/index.ts')).toBe('');
  });
});

describe('buildRouteName — param preservation', () => {
  it('[param] segments preserved', () => {
    expect(buildRouteName('users/[userId].ts')).toBe('users/[userId]');
  });

  it('[...slug] segments preserved', () => {
    expect(buildRouteName('docs/[...slug].ts')).toBe('docs/[...slug]');
  });

  it('mixed static and dynamic', () => {
    expect(buildRouteName('users/[userId]/posts/[postId].ts'))
      .toBe('users/[userId]/posts/[postId]');
  });

  it('group + param combined', () => {
    expect(buildRouteName('(api)/users/[userId].ts')).toBe('users/[userId]');
  });

  it('nested index with param parent', () => {
    expect(buildRouteName('users/[userId]/index.ts')).toBe('users/[userId]');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. detectExports
// ═══════════════════════════════════════════════════════════════════════════

describe('detectExports — named exports', () => {
  it('detects export const GET', () => {
    const filePath = join(tmpDir, 'get-handler.ts');
    writeFileSync(filePath, `export const GET = async (ctx) => ({ hello: 'world' });`);
    const { methods, hasDefaultExport } = detectExports(filePath);
    expect(methods).toEqual(['GET']);
    expect(hasDefaultExport).toBe(false);
  });

  it('detects export function POST', () => {
    const filePath = join(tmpDir, 'post-handler.ts');
    writeFileSync(filePath, `export function POST(ctx) { return { ok: true }; }`);
    const { methods } = detectExports(filePath);
    expect(methods).toEqual(['POST']);
  });

  it('detects export async function GET', () => {
    const filePath = join(tmpDir, 'async-get-handler.ts');
    writeFileSync(filePath, `export async function GET(ctx) { return { ok: true }; }`);
    const { methods } = detectExports(filePath);
    expect(methods).toEqual(['GET']);
  });

  it('detects export let PUT', () => {
    const filePath = join(tmpDir, 'put-handler.ts');
    writeFileSync(filePath, `export let PUT = defineFunction(async (ctx) => {});`);
    const { methods } = detectExports(filePath);
    expect(methods).toEqual(['PUT']);
  });

  it('detects export var DELETE', () => {
    const filePath = join(tmpDir, 'delete-handler.ts');
    writeFileSync(filePath, `export var DELETE = async () => {};`);
    const { methods } = detectExports(filePath);
    expect(methods).toEqual(['DELETE']);
  });

  it('detects export const PATCH', () => {
    const filePath = join(tmpDir, 'patch-handler.ts');
    writeFileSync(filePath, `export const PATCH = defineFunction({ handler: async () => {}, captcha: true });`);
    const { methods } = detectExports(filePath);
    expect(methods).toEqual(['PATCH']);
  });

  it('detects multiple methods in one file', () => {
    const filePath = join(tmpDir, 'multi.ts');
    writeFileSync(filePath, [
      `export const GET = async () => {};`,
      `export const POST = async () => {};`,
      `export const DELETE = async () => {};`,
    ].join('\n'));
    const { methods } = detectExports(filePath);
    expect(methods.sort()).toEqual(['DELETE', 'GET', 'POST']);
  });

  it('does not detect non-method named exports', () => {
    const filePath = join(tmpDir, 'non-method.ts');
    writeFileSync(filePath, `export const handler = async () => {};\nexport const HELPER = 'not a method';`);
    const { methods } = detectExports(filePath);
    expect(methods).toEqual([]);
  });

  it('does not detect GETS or POSTING (partial match boundary)', () => {
    const filePath = join(tmpDir, 'boundary.ts');
    writeFileSync(filePath, `export const GETS = async () => {};\nexport const POSTING = async () => {};`);
    const { methods } = detectExports(filePath);
    expect(methods).toEqual([]);
  });
});

describe('detectExports — default exports', () => {
  it('detects export default function', () => {
    const filePath = join(tmpDir, 'default-fn.ts');
    writeFileSync(filePath, `export default function handler(ctx) { return {}; }`);
    const { hasDefaultExport } = detectExports(filePath);
    expect(hasDefaultExport).toBe(true);
  });

  it('detects export default object', () => {
    const filePath = join(tmpDir, 'default-obj.ts');
    writeFileSync(filePath, `export default defineFunction({ trigger: { type: 'http' }, handler: async () => {} });`);
    const { hasDefaultExport } = detectExports(filePath);
    expect(hasDefaultExport).toBe(true);
  });

  it('no default export', () => {
    const filePath = join(tmpDir, 'no-default.ts');
    writeFileSync(filePath, `export const GET = async () => {};`);
    const { hasDefaultExport } = detectExports(filePath);
    expect(hasDefaultExport).toBe(false);
  });
});

describe('detectExports — mixed exports', () => {
  it('detects both named methods and default export', () => {
    const filePath = join(tmpDir, 'mixed.ts');
    writeFileSync(filePath, [
      `export const GET = async () => {};`,
      `export const POST = async () => {};`,
      `export default function handler() {}`,
    ].join('\n'));
    const { methods, hasDefaultExport } = detectExports(filePath);
    expect(methods.sort()).toEqual(['GET', 'POST']);
    expect(hasDefaultExport).toBe(true);
  });

  it('detects module-level trigger export for method-based functions', () => {
    const filePath = join(tmpDir, 'triggered.ts');
    writeFileSync(filePath, [
      `export const trigger = { path: '/custom/:id' };`,
      `export const GET = async () => {};`,
    ].join('\n'));

    const { methods, hasTriggerExport } = detectExports(filePath);
    expect(methods).toEqual(['GET']);
    expect(hasTriggerExport).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. scanFunctions — file-system routing specifics
// ═══════════════════════════════════════════════════════════════════════════

describe('scanFunctions — _middleware handling', () => {
  it('detects root _middleware.ts', () => {
    const functionsDir = join(tmpDir, 'functions');
    mkdirSync(functionsDir);
    writeFileSync(join(functionsDir, '_middleware.ts'), 'export default async (ctx) => ctx;');
    writeFileSync(join(functionsDir, 'hello.ts'), 'export const GET = async () => {};');

    const results = scanFunctions(functionsDir);
    const mw = results.find(r => r.isMiddleware);
    expect(mw).toBeTruthy();
    expect(mw!.name).toBe('_middleware');
    expect(mw!.isMiddleware).toBe(true);
  });

  it('detects nested directory _middleware.ts', () => {
    const functionsDir = join(tmpDir, 'functions');
    mkdirSync(join(functionsDir, 'admin'), { recursive: true });
    writeFileSync(join(functionsDir, 'admin', '_middleware.ts'), 'export default async (ctx) => ctx;');
    writeFileSync(join(functionsDir, 'admin', 'users.ts'), 'export const GET = async () => {};');

    const results = scanFunctions(functionsDir);
    const mw = results.find(r => r.isMiddleware);
    expect(mw).toBeTruthy();
    expect(mw!.name).toBe('admin/_middleware');
    expect(mw!.relativePath).toBe('admin/_middleware.ts');
  });

  it('skips _ files that are not _middleware.ts', () => {
    const functionsDir = join(tmpDir, 'functions');
    mkdirSync(functionsDir);
    writeFileSync(join(functionsDir, '_helper.ts'), 'export const helper = () => {};');
    writeFileSync(join(functionsDir, '_utils.ts'), 'export const util = () => {};');
    writeFileSync(join(functionsDir, 'hello.ts'), 'export const GET = async () => {};');

    const results = scanFunctions(functionsDir);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('hello');
  });

  it('skips _ directories entirely', () => {
    const functionsDir = join(tmpDir, 'functions');
    mkdirSync(join(functionsDir, '_private'), { recursive: true });
    writeFileSync(join(functionsDir, '_private', 'secret.ts'), 'export const GET = async () => {};');
    writeFileSync(join(functionsDir, 'hello.ts'), 'export const GET = async () => {};');

    const results = scanFunctions(functionsDir);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('hello');
  });
});

describe('scanFunctions — group directories', () => {
  it('(group) directories are stripped from route name', () => {
    const functionsDir = join(tmpDir, 'functions');
    mkdirSync(join(functionsDir, '(auth)'), { recursive: true });
    writeFileSync(join(functionsDir, '(auth)', 'login.ts'), 'export const POST = async () => {};');

    const results = scanFunctions(functionsDir);
    const fn = results.find(r => !r.isMiddleware);
    expect(fn).toBeTruthy();
    expect(fn!.name).toBe('login');
  });
});

describe('scanFunctions — dynamic params', () => {
  it('[param] in directory name preserved', () => {
    const functionsDir = join(tmpDir, 'functions');
    mkdirSync(join(functionsDir, 'users', '[userId]'), { recursive: true });
    writeFileSync(join(functionsDir, 'users', '[userId]', 'profile.ts'), 'export const GET = async () => {};');

    const results = scanFunctions(functionsDir);
    const fn = results.find(r => !r.isMiddleware);
    expect(fn!.name).toBe('users/[userId]/profile');
  });

  it('[param] in file name preserved', () => {
    const functionsDir = join(tmpDir, 'functions');
    mkdirSync(join(functionsDir, 'users'), { recursive: true });
    writeFileSync(join(functionsDir, 'users', '[userId].ts'), 'export const GET = async () => {};');

    const results = scanFunctions(functionsDir);
    const fn = results.find(r => !r.isMiddleware);
    expect(fn!.name).toBe('users/[userId]');
  });

  it('[...slug] catch-all in file name preserved', () => {
    const functionsDir = join(tmpDir, 'functions');
    mkdirSync(join(functionsDir, 'docs'), { recursive: true });
    writeFileSync(join(functionsDir, 'docs', '[...slug].ts'), 'export const GET = async () => {};');

    const results = scanFunctions(functionsDir);
    const fn = results.find(r => !r.isMiddleware);
    expect(fn!.name).toBe('docs/[...slug]');
  });
});

describe('scanFunctions — index.ts handling', () => {
  it('index.ts at root yields empty route name', () => {
    const functionsDir = join(tmpDir, 'functions');
    mkdirSync(functionsDir);
    writeFileSync(join(functionsDir, 'index.ts'), 'export const GET = async () => {};');

    const results = scanFunctions(functionsDir);
    const fn = results.find(r => !r.isMiddleware);
    expect(fn!.name).toBe('');
  });

  it('index.ts in subdirectory yields directory path', () => {
    const functionsDir = join(tmpDir, 'functions');
    mkdirSync(join(functionsDir, 'users'), { recursive: true });
    writeFileSync(join(functionsDir, 'users', 'index.ts'), 'export const GET = async () => {};');

    const results = scanFunctions(functionsDir);
    const fn = results.find(r => !r.isMiddleware);
    expect(fn!.name).toBe('users');
  });
});

describe('scanFunctions — export detection', () => {
  it('detects method exports in scanned files', () => {
    const functionsDir = join(tmpDir, 'functions');
    mkdirSync(functionsDir);
    writeFileSync(join(functionsDir, 'users.ts'), [
      'export const GET = async () => {};',
      'export const POST = async () => {};',
    ].join('\n'));

    const results = scanFunctions(functionsDir);
    const fn = results.find(r => !r.isMiddleware);
    expect(fn!.methods.sort()).toEqual(['GET', 'POST']);
    expect(fn!.hasDefaultExport).toBe(false);
  });

  it('detects default export in scanned files', () => {
    const functionsDir = join(tmpDir, 'functions');
    mkdirSync(functionsDir);
    writeFileSync(join(functionsDir, 'webhook.ts'),
      'export default defineFunction({ trigger: { type: "http" }, handler: async () => {} });');

    const results = scanFunctions(functionsDir);
    const fn = results.find(r => !r.isMiddleware);
    expect(fn!.hasDefaultExport).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. validateRouteNames
// ═══════════════════════════════════════════════════════════════════════════

describe('validateRouteNames — duplicate detection', () => {
  it('no error for unique route names', () => {
    const functions = [
      { name: 'users', relativePath: 'users.ts', methods: ['GET'], hasDefaultExport: false, isMiddleware: false },
      { name: 'posts', relativePath: 'posts.ts', methods: ['GET'], hasDefaultExport: false, isMiddleware: false },
    ];
    expect(() => validateRouteNames(functions)).not.toThrow();
  });

  it('throws on duplicate route names', () => {
    const functions = [
      { name: 'users', relativePath: 'users.ts', methods: ['GET'], hasDefaultExport: false, isMiddleware: false },
      { name: 'users', relativePath: '(auth)/users.ts', methods: ['GET'], hasDefaultExport: false, isMiddleware: false },
    ];
    expect(() => validateRouteNames(functions)).toThrow(/Route name conflict/);
    expect(() => validateRouteNames(functions)).toThrow(/users/);
  });

  it('error message includes both conflicting file paths', () => {
    const functions = [
      { name: 'hello', relativePath: 'hello.ts', methods: ['GET'], hasDefaultExport: false, isMiddleware: false },
      { name: 'hello', relativePath: '(group)/hello.ts', methods: ['POST'], hasDefaultExport: false, isMiddleware: false },
    ];
    try {
      validateRouteNames(functions);
      expect.fail('Should have thrown');
    } catch (e: any) {
      expect(e.message).toContain('functions/hello.ts');
      expect(e.message).toContain('functions/(group)/hello.ts');
    }
  });

  it('empty route name (root index) conflict detected', () => {
    const functions = [
      { name: '', relativePath: 'index.ts', methods: ['GET'], hasDefaultExport: false, isMiddleware: false },
      { name: '', relativePath: '(group)/index.ts', methods: ['GET'], hasDefaultExport: false, isMiddleware: false },
    ];
    expect(() => validateRouteNames(functions)).toThrow(/Route name conflict/);
  });
});

describe('validateRouteNames — middleware skipping', () => {
  it('middleware entries are skipped during validation', () => {
    const functions = [
      { name: '_middleware', relativePath: '_middleware.ts', methods: [], hasDefaultExport: true, isMiddleware: true },
      { name: 'admin/_middleware', relativePath: 'admin/_middleware.ts', methods: [], hasDefaultExport: true, isMiddleware: true },
      { name: 'users', relativePath: 'users.ts', methods: ['GET'], hasDefaultExport: false, isMiddleware: false },
    ];
    expect(() => validateRouteNames(functions)).not.toThrow();
  });

  it('middleware with same name does not conflict (both skipped)', () => {
    // In practice, middleware names include their directory path and won't collide.
    // This test ensures the skip logic works regardless.
    const functions = [
      { name: '_middleware', relativePath: '_middleware.ts', methods: [], hasDefaultExport: true, isMiddleware: true },
      { name: '_middleware', relativePath: '(auth)/_middleware.ts', methods: [], hasDefaultExport: true, isMiddleware: true },
    ];
    expect(() => validateRouteNames(functions)).not.toThrow();
  });
});

describe('validateRouteNames — edge cases', () => {
  it('empty array is valid', () => {
    expect(() => validateRouteNames([])).not.toThrow();
  });

  it('single function is always valid', () => {
    const functions = [
      { name: 'hello', relativePath: 'hello.ts', methods: ['GET'], hasDefaultExport: false, isMiddleware: false },
    ];
    expect(() => validateRouteNames(functions)).not.toThrow();
  });
});
