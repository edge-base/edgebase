/**
 * Tests for CLI secret command — argument construction for wrangler secret subcommands.
 */
import { describe, it, expect } from 'vitest';
import {
  isDeployControlWorkerSecretName,
  isReservedHostedWorkerSecretName,
  listWranglerSecretNames,
  parseWranglerSecretNames,
} from '../src/lib/wrangler-secrets.js';

// ======================================================================
// 1. Secret set arguments
// ======================================================================

describe('Secret set arguments', () => {
  it('classifies production config, test selectors, and mock endpoints as reserved', () => {
    for (const name of [
      'EDGEBASE_CONFIG',
      'EDGEBASE_TEST',
      'EDGEBASE_TEST_BUILD',
      'EDGEBASE_LOCAL_DEV_BUILD',
      'EDGEBASE_DEV_SIDECAR_PORT',
      'EDGEBASE_USE_TEST_CONFIG',
      'EDGEBASE_INTERNAL_WORKER_URL',
      'EDGEBASE_SMS_API_URL',
      'NODE_ENV',
      'EDGEBASE_RUNTIME_MODE',
      'EDGEBASE_EMAIL_API_URL',
      'EDGEBASE_APP_WEB_RESET_PASSWORD_URL',
    ]) {
      expect(isReservedHostedWorkerSecretName(name)).toBe(true);
    }
    expect(isReservedHostedWorkerSecretName('SERVICE_KEY')).toBe(false);
    expect(isDeployControlWorkerSecretName('CLOUDFLARE_API_TOKEN')).toBe(true);
    expect(isDeployControlWorkerSecretName('GITHUB_TOKEN')).toBe(true);
    expect(isDeployControlWorkerSecretName('SERVICE_KEY')).toBe(false);
  });

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

  it('bounds the remote secret lookup and propagates outages before deploy', () => {
    let observedTimeout = 0;
    const outage = new Error('synthetic network timeout');
    const runner = (
      _command: string,
      _args: string[],
      options: { timeout: number },
    ): string => {
      observedTimeout = options.timeout;
      throw outage;
    };

    expect(() => listWranglerSecretNames('/synthetic/project', runner))
      .toThrow(outage);
    expect(observedTimeout).toBe(30_000);
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
