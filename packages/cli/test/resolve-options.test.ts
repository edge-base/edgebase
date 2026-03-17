/**
 * Tests for resolve-options.ts — shared CLI option resolution utilities.
 *
 * Covers resolveServiceKey and resolveServerUrl with all fallback paths
 * and structured input requirements when required values are missing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ''),
}));

import { resolveOptionalServiceKey, resolveServiceKey, resolveServerUrl } from '../src/lib/resolve-options.js';
import { setContext } from '../src/lib/cli-context.js';

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);

beforeEach(() => {
  delete process.env.EDGEBASE_SERVICE_KEY;
  delete process.env.EDGEBASE_URL;
  setContext({ verbose: false, quiet: false, json: false, nonInteractive: false });
  mockedExistsSync.mockReturnValue(false);
  mockedReadFileSync.mockReturnValue('');
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ======================================================================
// resolveServiceKey
// ======================================================================

describe('resolveServiceKey', () => {
  it('returns flag value when --service-key is provided', () => {
    const key = resolveServiceKey({ serviceKey: 'flag-key-123' });
    expect(key).toBe('flag-key-123');
  });

  it('falls back to EDGEBASE_SERVICE_KEY env when no flag', () => {
    process.env.EDGEBASE_SERVICE_KEY = 'env-key-456';
    const key = resolveServiceKey({});
    expect(key).toBe('env-key-456');
  });

  it('falls back to .edgebase/secrets.json when no flag or env', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(JSON.stringify({ SERVICE_KEY: 'secrets-key-789' }));
    const key = resolveServiceKey({});
    expect(key).toBe('secrets-key-789');
  });

  it('throws a structured input requirement when no source provides a key', () => {
    expect(() => resolveServiceKey({})).toThrowError('Service Key required.');

    try {
      resolveServiceKey({});
    } catch (error) {
      expect(error).toMatchObject({
        payload: expect.objectContaining({
          status: 'needs_input',
          code: 'service_key_required',
          field: 'serviceKey',
        }),
      });
    }
  });

  it('keeps the same structured input requirement in json mode', () => {
    setContext({ json: true, quiet: false, verbose: false, nonInteractive: false });

    try {
      resolveServiceKey({});
    } catch (error) {
      expect(error).toMatchObject({
        payload: expect.objectContaining({
          status: 'needs_input',
          code: 'service_key_required',
        }),
      });
    }
  });
});

describe('resolveOptionalServiceKey', () => {
  it('returns undefined when no source provides a key', () => {
    expect(resolveOptionalServiceKey({})).toBeUndefined();
  });

  it('resolves from env without forcing an exit', () => {
    process.env.EDGEBASE_SERVICE_KEY = 'env-key-optional';
    expect(resolveOptionalServiceKey({})).toBe('env-key-optional');
  });
});

// ======================================================================
// resolveServerUrl
// ======================================================================

describe('resolveServerUrl', () => {
  it('returns flag value with trailing slash stripped', () => {
    const url = resolveServerUrl({ url: 'https://example.workers.dev/' });
    expect(url).toBe('https://example.workers.dev');
  });

  it('falls back to EDGEBASE_URL env with trailing slash stripped', () => {
    process.env.EDGEBASE_URL = 'https://env.workers.dev/';
    const url = resolveServerUrl({});
    expect(url).toBe('https://env.workers.dev');
  });

  it('throws a structured input requirement when required=true and nothing found', () => {
    expect(() => resolveServerUrl({}, true)).toThrowError('Worker URL required.');

    try {
      resolveServerUrl({}, true);
    } catch (error) {
      expect(error).toMatchObject({
        payload: expect.objectContaining({
          status: 'needs_input',
          code: 'worker_url_required',
          field: 'url',
        }),
      });
    }
  });

  it('keeps the same structured input requirement for missing URLs in json mode', () => {
    setContext({ json: true, quiet: false, verbose: false, nonInteractive: false });

    try {
      resolveServerUrl({}, true);
    } catch (error) {
      expect(error).toMatchObject({
        payload: expect.objectContaining({
          status: 'needs_input',
          code: 'worker_url_required',
        }),
      });
    }
  });

  it('returns empty string when required=false and nothing found', () => {
    const url = resolveServerUrl({}, false);
    expect(url).toBe('');
  });
});
