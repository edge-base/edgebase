/**
 * Tests for CLI logs command — detectWorkerName, filter parsing logic.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { _internals } from '../src/commands/logs.js';

const { detectWorkerName } = _internals;

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `eb-logs-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ======================================================================
// 1. detectWorkerName
// ======================================================================

describe('detectWorkerName', () => {
  it('extracts worker name from standard wrangler.toml', () => {
    writeFileSync(join(tmpDir, 'wrangler.toml'), `
name = "my-edgebase-app"
main = "src/index.ts"
compatibility_date = "2024-01-01"
`);
    expect(detectWorkerName(tmpDir)).toBe('my-edgebase-app');
  });

  it('extracts worker name with no spaces around =', () => {
    writeFileSync(join(tmpDir, 'wrangler.toml'), `name="compact-app"\nmain="src/index.ts"`);
    // The regex is: /^name\s*=\s*"([^"]+)"/m — requires name at start of line
    expect(detectWorkerName(tmpDir)).toBe('compact-app');
  });

  it('extracts worker name with extra spaces', () => {
    writeFileSync(join(tmpDir, 'wrangler.toml'), `name  =  "spacey-app"\n`);
    expect(detectWorkerName(tmpDir)).toBe('spacey-app');
  });

  it('returns null when wrangler.toml does not exist', () => {
    expect(detectWorkerName(tmpDir)).toBeNull();
  });

  it('returns null when wrangler.toml has no name field', () => {
    writeFileSync(join(tmpDir, 'wrangler.toml'), `
main = "src/index.ts"
compatibility_date = "2024-01-01"
`);
    expect(detectWorkerName(tmpDir)).toBeNull();
  });

  it('handles name with hyphens and numbers', () => {
    writeFileSync(join(tmpDir, 'wrangler.toml'), `name = "my-app-v2-prod"\n`);
    expect(detectWorkerName(tmpDir)).toBe('my-app-v2-prod');
  });

  it('uses first match when name appears in comments too', () => {
    writeFileSync(join(tmpDir, 'wrangler.toml'), `
# name = "commented-out"
name = "real-app"
# another name = "also-commented"
`);
    expect(detectWorkerName(tmpDir)).toBe('real-app');
  });
});

// ======================================================================
// 2. Filter parsing logic (inline tests for argument construction)
// ======================================================================

describe('Filter parsing', () => {
  /**
   * Replicates the filter parsing logic from logs.ts action handler
   * to test it in isolation.
   */
  function parseFilter(filter: string): string[] {
    const args: string[] = [];
    const parts = filter.split(':');
    if (parts.length === 2) {
      const [key, value] = parts;
      if (key === 'status') {
        args.push('--status', value);
      } else if (key === 'method') {
        args.push('--method', value);
      } else {
        args.push('--search', filter);
      }
    } else {
      args.push('--search', filter);
    }
    return args;
  }

  it('parses status filter "status:500"', () => {
    expect(parseFilter('status:500')).toEqual(['--status', '500']);
  });

  it('parses status filter "status:200"', () => {
    expect(parseFilter('status:200')).toEqual(['--status', '200']);
  });

  it('parses method filter "method:POST"', () => {
    expect(parseFilter('method:POST')).toEqual(['--method', 'POST']);
  });

  it('parses method filter "method:GET"', () => {
    expect(parseFilter('method:GET')).toEqual(['--method', 'GET']);
  });

  it('falls back to --search for unknown key:value pair', () => {
    expect(parseFilter('user:admin')).toEqual(['--search', 'user:admin']);
  });

  it('falls back to --search for plain text (no colon)', () => {
    expect(parseFilter('error')).toEqual(['--search', 'error']);
  });

  it('falls back to --search for multiple colons', () => {
    expect(parseFilter('time:12:30:00')).toEqual(['--search', 'time:12:30:00']);
  });
});
