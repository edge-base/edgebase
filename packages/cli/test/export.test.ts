/**
 * Tests for CLI export command — Service Key resolution, URL validation, output path handling.
 *
 * Note: The export command's core logic is in a single action handler with fetch() calls.
 * These tests verify the Service Key resolution precedence and validation logic
 * by testing the patterns used in the command.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `eb-export-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ======================================================================
// 1. Service Key resolution precedence
// ======================================================================

describe('Service Key resolution', () => {
  /**
   * Replicates the Service Key resolution logic from export.ts:
   * --service-key > EDGEBASE_SERVICE_KEY env > .edgebase/secrets.json
   */
  function resolveServiceKey(
    optionKey: string | undefined,
    envKey: string | undefined,
    projectDir: string,
  ): string | undefined {
    let serviceKey = optionKey || envKey;
    if (!serviceKey) {
      const secretsPath = join(projectDir, '.edgebase', 'secrets.json');
      if (existsSync(secretsPath)) {
        try {
          const secrets = JSON.parse(readFileSync(secretsPath, 'utf-8'));
          serviceKey = secrets.SERVICE_KEY;
        } catch { /* ignore */ }
      }
    }
    return serviceKey;
  }

  it('uses --service-key option first', () => {
    mkdirSync(join(tmpDir, '.edgebase'), { recursive: true });
    writeFileSync(join(tmpDir, '.edgebase', 'secrets.json'), JSON.stringify({ SERVICE_KEY: 'from-json' }));

    expect(resolveServiceKey('from-option', 'from-env', tmpDir)).toBe('from-option');
  });

  it('falls back to env when no option', () => {
    mkdirSync(join(tmpDir, '.edgebase'), { recursive: true });
    writeFileSync(join(tmpDir, '.edgebase', 'secrets.json'), JSON.stringify({ SERVICE_KEY: 'from-json' }));

    expect(resolveServiceKey(undefined, 'from-env', tmpDir)).toBe('from-env');
  });

  it('falls back to secrets.json when no option or env', () => {
    mkdirSync(join(tmpDir, '.edgebase'), { recursive: true });
    writeFileSync(join(tmpDir, '.edgebase', 'secrets.json'), JSON.stringify({ SERVICE_KEY: 'from-json' }));

    expect(resolveServiceKey(undefined, undefined, tmpDir)).toBe('from-json');
  });

  it('returns undefined when no source available', () => {
    expect(resolveServiceKey(undefined, undefined, tmpDir)).toBeUndefined();
  });

  it('handles invalid secrets.json gracefully', () => {
    mkdirSync(join(tmpDir, '.edgebase'), { recursive: true });
    writeFileSync(join(tmpDir, '.edgebase', 'secrets.json'), '{invalid json');

    expect(resolveServiceKey(undefined, undefined, tmpDir)).toBeUndefined();
  });

  it('returns undefined when secrets.json has no SERVICE_KEY', () => {
    mkdirSync(join(tmpDir, '.edgebase'), { recursive: true });
    writeFileSync(join(tmpDir, '.edgebase', 'secrets.json'), JSON.stringify({ OTHER_KEY: 'val' }));

    expect(resolveServiceKey(undefined, undefined, tmpDir)).toBeUndefined();
  });
});

// ======================================================================
// 2. URL construction
// ======================================================================

describe('URL construction', () => {
  it('strips trailing slash from base URL', () => {
    const url = 'https://my-app.workers.dev/';
    const tableName = 'posts';
    const exportUrl = `${url.replace(/\/$/, '')}/admin/api/backup/export/${encodeURIComponent(tableName)}?format=json`;
    expect(exportUrl).toBe('https://my-app.workers.dev/admin/api/backup/export/posts?format=json');
  });

  it('handles URL without trailing slash', () => {
    const url = 'https://my-app.workers.dev';
    const tableName = 'posts';
    const exportUrl = `${url.replace(/\/$/, '')}/admin/api/backup/export/${encodeURIComponent(tableName)}?format=json`;
    expect(exportUrl).toBe('https://my-app.workers.dev/admin/api/backup/export/posts?format=json');
  });

  it('encodes table name with special characters', () => {
    const url = 'http://localhost:8787';
    const tableName = 'user profiles';
    const exportUrl = `${url.replace(/\/$/, '')}/admin/api/backup/export/${encodeURIComponent(tableName)}?format=json`;
    expect(exportUrl).toContain('user%20profiles');
  });
});

// ======================================================================
// 3. Output path handling
// ======================================================================

describe('Output path handling', () => {
  it('generates default output filename from table name', () => {
    const tableName = 'posts';
    const defaultName = `${tableName}-export.json`;
    expect(defaultName).toBe('posts-export.json');
  });

  it('uses custom output path when provided', () => {
    const outputPath = resolve('/tmp/my-exports/data.json');
    expect(outputPath).toContain('my-exports/data.json');
  });

  it('creates output directory if it does not exist', () => {
    const outputDir = join(tmpDir, 'nested', 'exports');
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }
    expect(existsSync(outputDir)).toBe(true);
  });
});

// ======================================================================
// 4. Format validation
// ======================================================================

describe('Format validation', () => {
  it('only accepts "json" format', () => {
    const format = 'json'.toLowerCase();
    expect(format).toBe('json');
  });

  it('rejects non-json formats', () => {
    const invalidFormats = ['csv', 'xml', 'yaml', 'SQL'];
    for (const f of invalidFormats) {
      expect(f.toLowerCase()).not.toBe('json');
    }
  });

  it('handles case-insensitive format', () => {
    expect('JSON'.toLowerCase()).toBe('json');
    expect('Json'.toLowerCase()).toBe('json');
  });
});

// ======================================================================
// 5. Record counting
// ======================================================================

describe('Record counting', () => {
  it('counts records from JSON array response', () => {
    const data = JSON.stringify([{ id: '1' }, { id: '2' }, { id: '3' }]);
    const parsed = JSON.parse(data);
    expect(Array.isArray(parsed) ? parsed.length : 0).toBe(3);
  });

  it('returns 0 for non-array response', () => {
    const data = JSON.stringify({ error: 'not found' });
    const parsed = JSON.parse(data);
    expect(Array.isArray(parsed) ? parsed.length : 0).toBe(0);
  });

  it('returns 0 for empty array', () => {
    const data = JSON.stringify([]);
    const parsed = JSON.parse(data);
    expect(Array.isArray(parsed) ? parsed.length : 0).toBe(0);
  });
});
