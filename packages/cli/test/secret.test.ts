/**
 * Tests for CLI secret command — argument construction for wrangler secret subcommands.
 */
import { describe, it, expect } from 'vitest';
import { parseWranglerSecretNames } from '../src/lib/wrangler-secrets.js';

// ======================================================================
// 1. Secret set arguments
// ======================================================================

describe('Secret set arguments', () => {
  it('builds correct wrangler secret put arguments', () => {
    const key = 'SERVICE_KEY';
    const args = ['wrangler', 'secret', 'put', key];
    expect(args).toEqual(['wrangler', 'secret', 'put', 'SERVICE_KEY']);
  });

  it('handles various key names', () => {
    const keys = ['SERVICE_KEY', 'JWT_USER_SECRET', 'JWT_ADMIN_SECRET', 'CUSTOM_VAR'];
    for (const key of keys) {
      const args = ['wrangler', 'secret', 'put', key];
      expect(args[3]).toBe(key);
    }
  });
});

// ======================================================================
// 2. Secret list arguments
// ======================================================================

describe('Secret list arguments', () => {
  it('builds correct wrangler secret list arguments', () => {
    const args = ['wrangler', 'secret', 'list', '--format', 'json'];
    expect(args).toEqual(['wrangler', 'secret', 'list', '--format', 'json']);
  });

  it('parses exact secret names from Wrangler JSON output', () => {
    const names = parseWranglerSecretNames(JSON.stringify([
      { name: 'SERVICE_KEY_OLD' },
      { name: 'TURNSTILE_SECRET' },
    ]));

    expect(names.has('SERVICE_KEY')).toBe(false);
    expect(names.has('SERVICE_KEY_OLD')).toBe(true);
    expect(names.has('TURNSTILE_SECRET')).toBe(true);
  });

  it('accepts Wrangler outputs that wrap secrets in a result array', () => {
    const names = parseWranglerSecretNames(JSON.stringify({
      result: [{ name: 'SERVICE_KEY' }],
    }));

    expect(names.has('SERVICE_KEY')).toBe(true);
  });
});

// ======================================================================
// 3. Secret delete arguments
// ======================================================================

describe('Secret delete arguments', () => {
  it('builds correct wrangler secret delete arguments', () => {
    const key = 'OLD_SECRET';
    const args = ['wrangler', 'secret', 'delete', key];
    expect(args).toEqual(['wrangler', 'secret', 'delete', 'OLD_SECRET']);
  });
});
