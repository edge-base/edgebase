/**
 * Unit tests for CLI keys command — pure functions + secrets.json I/O.
 * Tests generateServiceKey(), maskKey(), readSecretsJson(), writeSecretsJson().
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateServiceKey, maskKey, _internals } from '../src/commands/keys.js';

const { readSecretsJson, writeSecretsJson } = _internals;

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `eb-keys-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ======================================================================
// 1. generateServiceKey
// ======================================================================

describe('generateServiceKey', () => {
  it('returns 64-character hex string', () => {
    const key = generateServiceKey();
    expect(key).toHaveLength(64);
  });

  it('contains only hex characters [0-9a-f]', () => {
    const key = generateServiceKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates different keys on each call (randomness)', () => {
    const key1 = generateServiceKey();
    const key2 = generateServiceKey();
    expect(key1).not.toBe(key2);
  });

  it('generates 10 unique keys', () => {
    const keys = new Set(Array.from({ length: 10 }, () => generateServiceKey()));
    expect(keys.size).toBe(10);
  });
});

// ======================================================================
// 2. maskKey
// ======================================================================

describe('maskKey', () => {
  it('masks key with sk_ prefix and shows last 4 chars', () => {
    const key = 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
    const masked = maskKey(key);
    expect(masked).toMatch(/^sk_\*{12}7890$/);
    expect(masked).toBe('sk_************7890');
  });

  it('returns **** for short keys (≤8 chars)', () => {
    expect(maskKey('12345678')).toBe('****');
    expect(maskKey('abc')).toBe('****');
    expect(maskKey('')).toBe('****');
  });

  it('masks 9-char key correctly (boundary)', () => {
    const key = '123456789';
    const masked = maskKey(key);
    expect(masked).toBe('sk_************6789');
  });

  it('masks a real generated key', () => {
    const key = generateServiceKey();
    const masked = maskKey(key);
    expect(masked).toMatch(/^sk_\*{12}[0-9a-f]{4}$/);
    expect(masked.slice(-4)).toBe(key.slice(-4));
  });
});

// ======================================================================
// 3. readSecretsJson
// ======================================================================

describe('readSecretsJson', () => {
  it('returns null when .edgebase directory does not exist', () => {
    expect(readSecretsJson(tmpDir)).toBeNull();
  });

  it('returns null when secrets.json does not exist', () => {
    mkdirSync(join(tmpDir, '.edgebase'), { recursive: true });
    expect(readSecretsJson(tmpDir)).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    mkdirSync(join(tmpDir, '.edgebase'), { recursive: true });
    writeFileSync(join(tmpDir, '.edgebase', 'secrets.json'), '{invalid json');
    expect(readSecretsJson(tmpDir)).toBeNull();
  });

  it('reads valid secrets.json', () => {
    mkdirSync(join(tmpDir, '.edgebase'), { recursive: true });
    const data = { SERVICE_KEY: 'sk_test', JWT_USER_SECRET: 'jwt_u' };
    writeFileSync(join(tmpDir, '.edgebase', 'secrets.json'), JSON.stringify(data));

    const result = readSecretsJson(tmpDir);
    expect(result).toEqual(data);
  });

  it('reads empty JSON object', () => {
    mkdirSync(join(tmpDir, '.edgebase'), { recursive: true });
    writeFileSync(join(tmpDir, '.edgebase', 'secrets.json'), '{}');

    const result = readSecretsJson(tmpDir);
    expect(result).toEqual({});
  });

  it('reads secrets with current rotation metadata', () => {
    mkdirSync(join(tmpDir, '.edgebase'), { recursive: true });
    const data = {
      SERVICE_KEY: 'new_key',
      SERVICE_KEY_CREATED_AT: '2025-12-01T00:00:00Z',
      SERVICE_KEY_UPDATED_AT: '2026-01-01T00:00:00Z',
    };
    writeFileSync(join(tmpDir, '.edgebase', 'secrets.json'), JSON.stringify(data));

    const result = readSecretsJson(tmpDir);
    expect(result?.SERVICE_KEY).toBe('new_key');
    expect(result?.SERVICE_KEY_CREATED_AT).toBe('2025-12-01T00:00:00Z');
    expect(result?.SERVICE_KEY_UPDATED_AT).toBe('2026-01-01T00:00:00Z');
  });
});

// ======================================================================
// 4. writeSecretsJson
// ======================================================================

describe('writeSecretsJson', () => {
  it('creates .edgebase directory if it does not exist', () => {
    writeSecretsJson(tmpDir, { SERVICE_KEY: 'test' });
    expect(existsSync(join(tmpDir, '.edgebase'))).toBe(true);
  });

  it('writes secrets.json with correct content', () => {
    const data = { SERVICE_KEY: 'sk_write_test', JWT_USER_SECRET: 'jwt' };
    writeSecretsJson(tmpDir, data);

    const content = readFileSync(join(tmpDir, '.edgebase', 'secrets.json'), 'utf-8');
    const parsed = JSON.parse(content);
    expect(parsed).toEqual(data);
  });

  it('writes with chmod 0o600 (owner-only)', () => {
    writeSecretsJson(tmpDir, { SERVICE_KEY: 'test' });
    const stats = statSync(join(tmpDir, '.edgebase', 'secrets.json'));
    // 0o600 = 0o100600 (file) → octal mode 600
    const mode = stats.mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('overwrites existing secrets.json', () => {
    writeSecretsJson(tmpDir, { SERVICE_KEY: 'first' });
    writeSecretsJson(tmpDir, { SERVICE_KEY: 'second' });

    const result = readSecretsJson(tmpDir);
    expect(result?.SERVICE_KEY).toBe('second');
  });

  it('roundtrip: write → read', () => {
    const data = {
      SERVICE_KEY: 'sk_roundtrip',
      JWT_USER_SECRET: 'jwt_u',
      JWT_ADMIN_SECRET: 'jwt_a',
      SERVICE_KEY_CREATED_AT: '2026-01-01T00:00:00Z',
    };

    writeSecretsJson(tmpDir, data);
    const result = readSecretsJson(tmpDir);
    expect(result).toEqual(data);
  });

  it('writes pretty-printed JSON with trailing newline', () => {
    writeSecretsJson(tmpDir, { KEY: 'val' });
    const content = readFileSync(join(tmpDir, '.edgebase', 'secrets.json'), 'utf-8');
    expect(content).toContain('\n');
    expect(content.endsWith('\n')).toBe(true);
    // Pretty-printed = indented
    expect(content).toContain('  "KEY"');
  });
});
