/**
 * Tests for CLI deploy command — validateConfig, scanFunctions, generateFunctionRegistry, mergePluginTables, extractDatabases.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateConfig, _internals } from '../src/commands/deploy.js';
import { resolveRateLimitBindings } from '../src/lib/rate-limit-bindings.js';
import type {
  CloudflareDeployManifest,
  CloudflareResourceRecord,
} from '../src/lib/cloudflare-deploy-manifest.js';
import {
  buildLegacyManagedR2BucketName,
  buildLegacyWorkerScopedD1DatabaseName,
  buildManagedD1DatabaseName,
  buildManagedR2BucketName,
} from '../src/lib/managed-resource-names.js';

const {
  scanFunctions,
  generateFunctionRegistry,
  mergePluginTables,
  extractDatabases,
  inspectAuthEnv,
  collectAuthEnvWarnings,
  copyDevelopmentAuthProviderToRelease,
  isPostgresProvider,
  isHyperdriveAlreadyExistsError,
  parseKvNamespaceListOutput,
  parseD1DatabaseListOutput,
  parseVectorizeIndexListOutput,
  parseHyperdriveListOutput,
  listHyperdriveConfigs,
  provisionR2Buckets,
  provisionKvNamespaces,
  provisionD1Databases,
  provisionVectorizeIndexes,
  provisionProviderHyperdrives,
  provisionAuthPostgresHyperdrive,
  createHyperdriveConfigViaApi,
  assertRequiredBindingCoverage,
  buildManagedWorkerResourceName,
  scopePreviousManifestToAccount,
  resolveAdminUrlFromRuntime,
  resolveReleaseSecretVars,
  resolveExistingR2BucketRecord,
  isValidCloudflareAccountId,
  isValidHyperdriveConfigName,
  classifyRemoteWorkerLookupFailure,
  remoteWorkerExists,
  scavengeStaleDeploySecrets,
  registerDeploySecretCleanup,
  registerDeploySubprocessTimeout,
  prepareAtomicDeploySecrets,
  extractWorkerVersionIdFromWranglerDeployOutput,
  runProjectPostScaffoldHook,
} = _internals;

let tmpDir: string;

function manifestWithResource(
  resource: CloudflareResourceRecord,
  workerName = 'synthetic-worker',
): CloudflareDeployManifest {
  return {
    version: 2,
    deployedAt: '2026-01-01T00:00:00.000Z',
    accountId: '9def174e0c9c444685b8c773d076ce4b',
    worker: { name: workerName, url: `https://${workerName}.example.test` },
    resources: [resource],
  };
}

beforeEach(() => {
  tmpDir = join(tmpdir(), `eb-deploy-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ======================================================================
// 1. validateConfig — Edge cases
// ======================================================================

describe('validateConfig — Edge cases', () => {
  it('rejects inline CAPTCHA secrets in release config so they cannot enter the bundle', () => {
    const warnings: string[] = [];
    const errors: string[] = [];

    validateConfig({
      release: true,
      baseUrl: 'https://api.example.test',
      captcha: {
        siteKey: 'synthetic-site-key',
        secretKey: 'must-not-be-bundled',
        hostnames: ['api.example.test'],
      },
    }, warnings, errors);

    expect(errors).toContainEqual(expect.stringMatching(/must not embed captcha\.secretKey/i));
  });

  it('rejects CAPTCHA fail-open for a cloud deployment', () => {
    const warnings: string[] = [];
    const errors: string[] = [];

    validateConfig({
      release: false,
      captcha: {
        siteKey: 'synthetic-site-key',
        hostnames: ['api.example.test'],
        failMode: 'open',
      },
    }, warnings, errors);

    expect(errors).toContainEqual(expect.stringMatching(/trusted local-development runtime/i));
  });

  it('empty tables object', () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    validateConfig(
      {
        release: true,
        databases: { shared: { tables: {} } },
      },
      warnings,
      errors,
    );
    expect(warnings).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it('config without tables key', () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    validateConfig(
      {
        release: true,
      },
      warnings,
      errors,
    );
    expect(warnings).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it('does not warn for non-view tables with write rules', () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    validateConfig(
      {
        release: true,
        databases: {
          shared: {
            tables: {
              posts: {
                access: { insert: 'true', update: 'true', delete: 'true' },
              },
            },
          },
        },
      },
      warnings,
      errors,
    );

    expect(warnings).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
});

describe('version-bound deploy secrets', () => {
  it('bounds a project post-scaffold hook and reports an actionable timeout', () => {
    const scriptsDir = join(tmpDir, 'scripts');
    mkdirSync(scriptsDir, { recursive: true });
    writeFileSync(join(scriptsDir, 'edgebase-post-scaffold.mjs'), '// synthetic hook\n');
    const runner = vi.fn(() => {
      throw Object.assign(new Error('spawnSync node ETIMEDOUT'), { code: 'ETIMEDOUT' });
    });

    expect(() => runProjectPostScaffoldHook(tmpDir, runner)).toThrow(
      /post-scaffold hook exceeded 5 minutes.*bounded and non-interactive/i,
    );
    expect(runner).toHaveBeenCalledWith(
      process.execPath,
      [join(scriptsDir, 'edgebase-post-scaffold.mjs'), '--project-dir', tmpDir],
      { cwd: tmpDir, stdio: 'inherit', timeout: 5 * 60_000 },
    );
  });

  it('skips the post-scaffold runner when the project hook is absent', () => {
    const runner = vi.fn();
    expect(() => runProjectPostScaffoldHook(tmpDir, runner)).not.toThrow();
    expect(runner).not.toHaveBeenCalled();
  });

  it('extracts only a canonical Wrangler Worker version id for finalization ownership', () => {
    expect(extractWorkerVersionIdFromWranglerDeployOutput([
      'Uploaded synthetic-worker',
      'Current Version ID: 11111111-2222-4333-8444-555555555555',
    ].join('\n'))).toBe('11111111-2222-4333-8444-555555555555');
    expect(extractWorkerVersionIdFromWranglerDeployOutput(
      'Worker Version ID: 11111111-2222-3333-4444-not-a-uuid',
    )).toBeNull();
  });

  it('terminates a hung Wrangler deploy before the Turnstile in-flight grace expires', async () => {
    vi.useFakeTimers();
    const kill = vi.fn(() => true);
    const onTimeout = vi.fn();
    const dispose = registerDeploySubprocessTimeout({ kill }, onTimeout);

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith('SIGTERM');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(kill).toHaveBeenLastCalledWith('SIGKILL');

    dispose();
    vi.useRealTimers();
  });

  it('scavenges dead-owner files and registers signal/exit cleanup for the live file', () => {
    const edgebaseDir = join(tmpDir, '.edgebase');
    mkdirSync(edgebaseDir, { recursive: true });
    const stale = join(edgebaseDir, '.deploy-secrets-99999999-aaaaaaaaaaaa.json');
    const live = join(edgebaseDir, `.deploy-secrets-${process.pid}-bbbbbbbbbbbb.json`);
    writeFileSync(stale, '{"secret":"synthetic"}', { mode: 0o600 });
    writeFileSync(live, '{"secret":"synthetic"}', { mode: 0o600 });

    expect(scavengeStaleDeploySecrets(edgebaseDir)).toContain(stale);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(live)).toBe(true);

    const beforeExit = process.listenerCount('exit');
    const beforeSigint = process.listenerCount('SIGINT');
    const beforeSigterm = process.listenerCount('SIGTERM');
    const dispose = registerDeploySecretCleanup(live);
    expect(process.listenerCount('exit')).toBe(beforeExit + 1);
    expect(process.listenerCount('SIGINT')).toBe(beforeSigint + 1);
    expect(process.listenerCount('SIGTERM')).toBe(beforeSigterm + 1);
    dispose();
    expect(existsSync(live)).toBe(false);
    expect(process.listenerCount('exit')).toBe(beforeExit);
    expect(process.listenerCount('SIGINT')).toBe(beforeSigint);
    expect(process.listenerCount('SIGTERM')).toBe(beforeSigterm);
  });

  it('uses remote Worker authority so a fresh CI checkout preserves deployed secrets', () => {
    const calls: string[][] = [];
    const runner = (_command: string, args: string[]) => {
      calls.push(args);
      return JSON.stringify({ id: 'synthetic-deployment' });
    };

    expect(remoteWorkerExists(tmpDir, 'synthetic-worker', runner)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(expect.arrayContaining([
      'deployments', 'status', '--name', 'synthetic-worker', '--json',
    ]));
  });

  it('distinguishes an absent Worker from transient/auth lookup failures', () => {
    expect(classifyRemoteWorkerLookupFailure(
      Object.assign(new Error('Worker "synthetic-worker" not found.'), { stderr: '[code: 10090]' }),
    )).toBe('absent');
    expect(classifyRemoteWorkerLookupFailure(
      new Error('The Worker synthetic-worker has no deployments.'),
    )).toBe('exists-without-deployment');
    expect(classifyRemoteWorkerLookupFailure(new Error('network timeout'))).toBe('unknown');

    const absentRunner = () => {
      throw Object.assign(new Error('Worker not found'), { stderr: '[code: 10092]' });
    };
    const outageRunner = () => { throw new Error('network timeout'); };
    expect(remoteWorkerExists(tmpDir, 'synthetic-worker', absentRunner)).toBe(false);
    expect(() => remoteWorkerExists(tmpDir, 'synthetic-worker', outageRunner))
      .toThrow(/Cannot determine whether Worker/i);
  });

  it('prepares first-deploy secrets in one mode-0600 file without persisting Turnstile', () => {
    writeFileSync(join(tmpDir, '.env.release'), [
      'SYNTHETIC_SECRET=from-release-env',
      'SERVICE_KEY=must-be-ignored',
      'EDGEBASE_RUNTIME_MODE=must-not-be-secret',
    ].join('\n'));

    const secretsPath = prepareAtomicDeploySecrets(
      tmpDir,
      '0123456789abcdef0123456789abcdef',
      false,
      {
        storeCfCredentials: false,
        turnstileSecret: 'synthetic-turnstile-secret',
      },
    );

    expect(secretsPath).toBeTruthy();
    const payload = JSON.parse(readFileSync(secretsPath!, 'utf8')) as Record<string, string>;
    expect(payload).toMatchObject({
      SYNTHETIC_SECRET: 'from-release-env',
      TURNSTILE_SECRET: 'synthetic-turnstile-secret',
    });
    expect(payload.SERVICE_KEY).not.toBe('must-be-ignored');
    expect(payload.SERVICE_KEY).toHaveLength(64);
    expect(payload.JWT_USER_SECRET).toHaveLength(64);
    expect(payload.JWT_ADMIN_SECRET).toHaveLength(64);
    expect(payload).not.toHaveProperty('EDGEBASE_RUNTIME_MODE');
    expect(statSync(secretsPath!).mode & 0o777).toBe(0o600);

    const persisted = JSON.parse(
      readFileSync(join(tmpDir, '.edgebase', 'secrets.json'), 'utf8'),
    ) as Record<string, string>;
    expect(persisted.SERVICE_KEY).toBe(payload.SERVICE_KEY);
    expect(persisted).not.toHaveProperty('TURNSTILE_SECRET');
  });

});

describe('provider classification', () => {
  const emptyHyperdriveTable = [
    '┌────┬────┐',
    '│ id │ name │',
    '└────┴────┘',
  ].join('\n');

  it('treats only neon/postgres as Hyperdrive-backed providers', () => {
    expect(isPostgresProvider('neon')).toBe(true);
    expect(isPostgresProvider('postgres')).toBe(true);
    expect(isPostgresProvider('d1')).toBe(false);
    expect(isPostgresProvider('do')).toBe(false);
    expect(isPostgresProvider(undefined)).toBe(false);
  });

  it('recognizes wrangler hyperdrive create idempotency errors', () => {
    expect(
      isHyperdriveAlreadyExistsError(
        'A Hyperdrive config with the given name already exists [code: 2017]',
      ),
    ).toBe(true);
    expect(isHyperdriveAlreadyExistsError('network timeout')).toBe(false);
  });

  it('parses wrangler hyperdrive list table output', () => {
    const output = `
┌────┬────┐
│ id                               │ name                │
├────┼────┤
│ 9def174e0c9c444685b8c773d076ce4b │ edgebase-db-shared  │
│ 0ee0b621f3ab4b9dae1734f95c27ef8a │ edgebase-auth       │
└────┴────┘
`;

    expect(parseHyperdriveListOutput(output)).toEqual([
      { id: '9def174e0c9c444685b8c773d076ce4b', name: 'edgebase-db-shared' },
      { id: '0ee0b621f3ab4b9dae1734f95c27ef8a', name: 'edgebase-auth' },
    ]);
  });

  it('accepts only bounded Cloudflare account ids and Hyperdrive names', () => {
    expect(isValidCloudflareAccountId('9def174e0c9c444685b8c773d076ce4b')).toBe(true);
    expect(isValidCloudflareAccountId('../accounts/attacker')).toBe(false);
    expect(isValidCloudflareAccountId('9def174e0c9c444685b8c773d076ce4b/extra')).toBe(false);
    expect(isValidHyperdriveConfigName('edgebase-db-shared_1')).toBe(true);
    expect(isValidHyperdriveConfigName('../edgebase-db')).toBe(false);
    expect(isValidHyperdriveConfigName(`edgebase-${'x'.repeat(64)}`)).toBe(false);
  });

  it('fails closed when Hyperdrive listing cannot be verified', () => {
    expect(parseHyperdriveListOutput([
      '⛅️ wrangler 4.103.0',
      '-------------------',
      '📋 Listing Hyperdrive configs',
    ].join('\n'))).toEqual([]);
    expect(() => listHyperdriveConfigs(tmpDir, () => {
      throw new Error('synthetic network timeout');
    })).toThrow(/could not be verified.*network timeout/i);
    expect(() => parseHyperdriveListOutput('')).toThrow(/empty/i);
    expect(() => parseHyperdriveListOutput('{}')).toThrow(/list JSON shape/i);
  });

  it('requires provider and auth PostgreSQL connection strings before deploy', async () => {
    const runner = () => emptyHyperdriveTable;
    await expect(provisionProviderHyperdrives(
      { primary: { provider: 'postgres' } },
      tmpDir,
      '9def174e0c9c444685b8c773d076ce4b',
      { runner },
    )).rejects.toThrow(/DB_POSTGRES_PRIMARY.*missing connection string/i);
    await expect(provisionAuthPostgresHyperdrive(
      { provider: 'neon' },
      tmpDir,
      '9def174e0c9c444685b8c773d076ce4b',
      { runner },
    )).rejects.toThrow(/AUTH_POSTGRES.*missing connection string/i);
  });

  it('aborts when Hyperdrive create fails or an already-exists result cannot be resolved', async () => {
    writeFileSync(join(tmpDir, '.env.release'), [
      'DB_POSTGRES_PRIMARY_URL=postgres://user:password@db.example.test/app',
      'AUTH_POSTGRES_URL=postgres://user:password@db.example.test/auth',
    ].join('\n'));
    const runner = () => emptyHyperdriveTable;

    await expect(provisionProviderHyperdrives(
      { primary: { provider: 'postgres' } },
      tmpDir,
      '9def174e0c9c444685b8c773d076ce4b',
      {
        runner,
        createConfig: async () => ({ status: 'error', message: 'synthetic API outage' }),
      },
    )).rejects.toThrow(/DB_POSTGRES_PRIMARY.*API outage/i);

    await expect(provisionAuthPostgresHyperdrive(
      { provider: 'postgres' },
      tmpDir,
      '9def174e0c9c444685b8c773d076ce4b',
      {
        runner,
        createConfig: async () => ({ status: 'exists', message: 'already exists [code: 2017]' }),
      },
    )).rejects.toThrow(/AUTH_POSTGRES.*already exists/i);
  });

  it('bounds the secret-bearing Hyperdrive request and forbids redirects', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      success: true,
      result: { id: '9def174e0c9c444685b8c773d076ce4b' },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(createHyperdriveConfigViaApi(
      'edgebase-db-primary',
      'postgres://user:synthetic-password@db.example.test/app',
      '9def174e0c9c444685b8c773d076ce4b',
      { fetchImpl, apiToken: 'synthetic-api-token' },
    )).resolves.toEqual({
      status: 'created',
      id: '9def174e0c9c444685b8c773d076ce4b',
    });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe(
      'https://api.cloudflare.com/client/v4/accounts/9def174e0c9c444685b8c773d076ce4b/hyperdrive/configs',
    );
    expect(String(url)).not.toContain('synthetic-password');
    expect(init?.redirect).toBe('error');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects oversized Hyperdrive API responses', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(
      JSON.stringify({ padding: 'x'.repeat(128) }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));

    await expect(createHyperdriveConfigViaApi(
      'edgebase-db-primary',
      'postgres://user:synthetic-password@db.example.test/app',
      '9def174e0c9c444685b8c773d076ce4b',
      {
        fetchImpl,
        apiToken: 'synthetic-api-token',
        maxResponseBytes: 32,
      },
    )).resolves.toMatchObject({
      status: 'error',
      message: expect.stringMatching(/exceeded 32 bytes/i),
    });
  });

  it('aborts a hung Hyperdrive API request at the configured deadline', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(init.signal?.reason ?? new Error('aborted'));
        }, { once: true });
      }));
      const result = createHyperdriveConfigViaApi(
        'edgebase-db-primary',
        'postgres://user:synthetic-password@db.example.test/app',
        '9def174e0c9c444685b8c773d076ce4b',
        { fetchImpl, apiToken: 'synthetic-api-token', timeoutMs: 25 },
      );

      await vi.advanceTimersByTimeAsync(25);
      await expect(result).resolves.toMatchObject({
        status: 'error',
        message: expect.stringMatching(/timed out after 25ms/i),
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Cloudflare resource provisioning fail-closed', () => {
  it('builds stable, bounded, character-safe names that isolate Workers', () => {
    const longWorker = `worker-${'a'.repeat(100)}`;
    const longResource = `resource_${'b'.repeat(100)}`;
    const first = buildManagedWorkerResourceName(longWorker, 'hyperdrive', longResource);
    const repeated = buildManagedWorkerResourceName(longWorker, 'hyperdrive', longResource);
    const otherWorker = buildManagedWorkerResourceName(
      `${longWorker}-other`,
      'hyperdrive',
      longResource,
    );

    expect(first).toBe(repeated);
    expect(first).not.toBe(otherWorker);
    expect(first.length).toBeLessThanOrEqual(63);
    expect(first).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
    expect(buildManagedWorkerResourceName('worker', 'kv', 'cache', 18)).toHaveLength(18);
    expect(() => buildManagedWorkerResourceName('worker', 'kv', 'cache', 17))
      .toThrow(/maximum length of at least 18/);

    const longPrefix = `worker-${'x'.repeat(80)}`;
    const d1First = buildManagedD1DatabaseName(`${longPrefix}-one`, 'auth');
    const d1Second = buildManagedD1DatabaseName(`${longPrefix}-two`, 'auth');
    const r2First = buildManagedR2BucketName(`${longPrefix}-one`);
    const r2Second = buildManagedR2BucketName(`${longPrefix}-two`);
    expect(d1First).not.toBe(d1Second);
    expect(r2First).not.toBe(r2Second);
    for (const name of [d1First, d1Second, r2First, r2Second]) {
      expect(name).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
      expect(name.length).toBeLessThanOrEqual(63);
    }
  });

  it('does not let a deploy manifest from another Cloudflare account prove legacy ownership', () => {
    const manifest = manifestWithResource({
      type: 'kv_namespace',
      name: 'cache',
      binding: 'CACHE_KV',
      id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    expect(scopePreviousManifestToAccount(
      manifest,
      '9def174e0c9c444685b8c773d076ce4b',
    )).toBe(manifest);
    expect(scopePreviousManifestToAccount(
      manifest,
      'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    )).toBeNull();
  });

  it('isolates new KV namespaces and reuses a legacy namespace only with manifest proof', () => {
    writeFileSync(join(tmpDir, 'wrangler.toml'), 'name = "worker-alpha"\n');
    const legacyId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const createdId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const listOutput = JSON.stringify([{ title: 'CACHE_KV', id: legacyId }]);
    const freshCalls: string[][] = [];
    const freshRunner = (args: string[]) => {
      freshCalls.push(args);
      return args.includes('list')
        ? listOutput
        : `kv_namespaces = [{ id = "${createdId}" }]`;
    };

    expect(provisionKvNamespaces(
      { cache: { binding: 'CACHE_KV' } },
      tmpDir,
      {},
      freshRunner,
    )).toMatchObject([{ id: createdId, source: 'created' }]);
    const scopedName = buildManagedWorkerResourceName('worker-alpha', 'kv', 'CACHE_KV');
    expect(freshCalls[1]).toEqual([
      'wrangler', 'kv', 'namespace', 'create', scopedName,
    ]);

    const legacyRunner = vi.fn(() => listOutput);
    const previousManifest = manifestWithResource({
      type: 'kv_namespace',
      name: 'cache',
      binding: 'CACHE_KV',
      id: legacyId,
      managed: true,
      source: 'created',
    }, 'worker-alpha');
    expect(provisionKvNamespaces(
      { cache: { binding: 'CACHE_KV' } },
      tmpDir,
      { previousManifest },
      legacyRunner,
    )).toMatchObject([{ id: legacyId, managed: true, source: 'created' }]);
    expect(legacyRunner).toHaveBeenCalledTimes(1);

    const manualManifest = manifestWithResource({
      type: 'kv_namespace',
      name: 'cache',
      binding: 'CACHE_KV',
      id: legacyId,
      managed: false,
      source: 'manual',
    }, 'worker-alpha');
    expect(provisionKvNamespaces(
      { cache: { binding: 'CACHE_KV' } },
      tmpDir,
      { previousManifest: manualManifest },
      () => listOutput,
    )).toMatchObject([{ id: legacyId, managed: false, source: 'existing' }]);
  });

  it('isolates new Vectorize indexes and gates legacy reuse on the manifest', () => {
    writeFileSync(join(tmpDir, 'wrangler.toml'), 'name = "worker-alpha"\n');
    const listOutput = JSON.stringify([{ name: 'edgebase-search' }]);
    const freshCalls: string[][] = [];
    const freshRunner = (args: string[]) => {
      freshCalls.push(args);
      return args.includes('list') ? listOutput : '';
    };

    const fresh = provisionVectorizeIndexes(
      { search: { binding: 'SEARCH_INDEX' } },
      tmpDir,
      {},
      freshRunner,
    );
    const scopedName = buildManagedWorkerResourceName('worker-alpha', 'vectorize', 'search');
    expect(fresh).toMatchObject([{ id: scopedName, source: 'created' }]);
    expect(freshCalls[1]).toContain(scopedName);

    const legacyRunner = vi.fn(() => listOutput);
    const previousManifest = manifestWithResource({
      type: 'vectorize',
      name: 'search',
      binding: 'SEARCH_INDEX',
      id: 'edgebase-search',
      managed: true,
      source: 'created',
    }, 'worker-alpha');
    expect(provisionVectorizeIndexes(
      { search: { binding: 'SEARCH_INDEX' } },
      tmpDir,
      { previousManifest },
      legacyRunner,
    )).toMatchObject([{ id: 'edgebase-search', managed: true, source: 'created' }]);
    expect(legacyRunner).toHaveBeenCalledTimes(1);
  });

  it('isolates new Hyperdrive configs and gates legacy reuse on the manifest', async () => {
    writeFileSync(join(tmpDir, 'wrangler.toml'), 'name = "worker-alpha"\n');
    writeFileSync(
      join(tmpDir, '.env.release'),
      'DB_POSTGRES_PRIMARY_URL=postgres://user:password@db.example.test/app\n',
    );
    const legacyId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const createdId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const listOutput = [
      '┌────┬────┐',
      '│ id │ name │',
      `│ ${legacyId} │ edgebase-db-primary │`,
      '└────┴────┘',
    ].join('\n');
    const createFresh = vi.fn(async () => ({ status: 'created' as const, id: createdId }));

    await expect(provisionProviderHyperdrives(
      { primary: { provider: 'postgres' } },
      tmpDir,
      '9def174e0c9c444685b8c773d076ce4b',
      { runner: () => listOutput, createConfig: createFresh },
    )).resolves.toMatchObject([{ id: createdId, source: 'created' }]);
    expect(createFresh).toHaveBeenCalledWith(
      buildManagedWorkerResourceName('worker-alpha', 'hyperdrive', 'db-primary'),
      'postgres://user:password@db.example.test/app',
      '9def174e0c9c444685b8c773d076ce4b',
    );

    const previousManifest = manifestWithResource({
      type: 'hyperdrive',
      name: 'primary',
      binding: 'DB_POSTGRES_PRIMARY',
      id: legacyId,
      managed: true,
      source: 'created',
    }, 'worker-alpha');
    const createLegacy = vi.fn(async () => ({ status: 'error' as const, message: 'must not run' }));
    await expect(provisionProviderHyperdrives(
      { primary: { provider: 'postgres' } },
      tmpDir,
      '9def174e0c9c444685b8c773d076ce4b',
      {
        runner: () => listOutput,
        createConfig: createLegacy,
        previousManifest,
      },
    )).resolves.toMatchObject([{ id: legacyId, managed: true, source: 'created' }]);
    expect(createLegacy).not.toHaveBeenCalled();
  });

  it('applies the same worker isolation and manifest gate to auth Hyperdrive', async () => {
    writeFileSync(join(tmpDir, 'wrangler.toml'), 'name = "worker-alpha"\n');
    writeFileSync(
      join(tmpDir, '.env.release'),
      'AUTH_POSTGRES_URL=postgres://user:password@db.example.test/auth\n',
    );
    const legacyId = 'cccccccccccccccccccccccccccccccc';
    const createdId = 'dddddddddddddddddddddddddddddddd';
    const listOutput = [
      '┌────┬────┐',
      '│ id │ name │',
      `│ ${legacyId} │ edgebase-auth │`,
      '└────┴────┘',
    ].join('\n');
    const createFresh = vi.fn(async () => ({ status: 'created' as const, id: createdId }));

    await expect(provisionAuthPostgresHyperdrive(
      { provider: 'postgres' },
      tmpDir,
      '9def174e0c9c444685b8c773d076ce4b',
      { runner: () => listOutput, createConfig: createFresh },
    )).resolves.toMatchObject([{ id: createdId, source: 'created' }]);
    expect(createFresh).toHaveBeenCalledWith(
      buildManagedWorkerResourceName('worker-alpha', 'hyperdrive', 'auth'),
      'postgres://user:password@db.example.test/auth',
      '9def174e0c9c444685b8c773d076ce4b',
    );

    const previousManifest = manifestWithResource({
      type: 'hyperdrive',
      name: 'auth',
      binding: 'AUTH_POSTGRES',
      id: legacyId,
      managed: true,
      source: 'created',
    }, 'worker-alpha');
    const createLegacy = vi.fn(async () => ({ status: 'error' as const, message: 'must not run' }));
    await expect(provisionAuthPostgresHyperdrive(
      { provider: 'postgres' },
      tmpDir,
      '9def174e0c9c444685b8c773d076ce4b',
      {
        runner: () => listOutput,
        createConfig: createLegacy,
        previousManifest,
      },
    )).resolves.toMatchObject([{ id: legacyId, managed: true, source: 'created' }]);
    expect(createLegacy).not.toHaveBeenCalled();
  });

  it('creates hashed D1 names and reuses a legacy truncation only with manifest proof', () => {
    writeFileSync(join(tmpDir, 'wrangler.toml'), 'name = "worker-alpha"\n');
    const legacyId = '11111111-2222-4333-8444-555555555555';
    const createdId = '66666666-7777-4888-8999-aaaaaaaaaaaa';
    const legacyName = buildLegacyWorkerScopedD1DatabaseName('worker-alpha', 'app');
    const listOutput = JSON.stringify([{ name: legacyName, uuid: legacyId }]);
    const freshCalls: string[][] = [];
    const freshRunner = (args: string[]) => {
      freshCalls.push(args);
      return args.includes('list')
        ? listOutput
        : `database_id = "${createdId}"`;
    };
    const scopedName = buildManagedD1DatabaseName('worker-alpha', 'app');

    expect(provisionD1Databases(
      { app: { binding: 'APP_DB' } },
      tmpDir,
      undefined,
      freshRunner,
    )).toMatchObject([{
      id: createdId,
      resourceName: scopedName,
      source: 'created',
    }]);
    expect(freshCalls[1]).toEqual(['wrangler', 'd1', 'create', scopedName]);

    const previousManifest = manifestWithResource({
      type: 'd1_database',
      name: 'app',
      binding: 'APP_DB',
      id: legacyId,
      managed: true,
      source: 'created',
    }, 'worker-alpha');
    const legacyRunner = vi.fn(() => listOutput);
    const legacyBindings = provisionD1Databases(
      { app: { binding: 'APP_DB' } },
      tmpDir,
      { previousManifest },
      legacyRunner,
    );
    expect(legacyBindings).toMatchObject([{
      id: legacyId,
      resourceName: legacyName,
      managed: true,
      source: 'created',
    }]);
    expect(legacyRunner).toHaveBeenCalledTimes(1);

    const generatedWrangler = generateTempWranglerToml(join(tmpDir, 'wrangler.toml'), {
      bindings: legacyBindings,
    });
    expect(generatedWrangler).not.toBeNull();
    expect(readFileSync(generatedWrangler!, 'utf-8')).toContain(
      `database_name = "${legacyName}"`,
    );
    rmSync(generatedWrangler!);
  });

  it('requires manifest proof before a managed legacy R2 bucket can be reused', () => {
    const workerName = 'worker-alpha';
    const legacyName = buildLegacyManagedR2BucketName(workerName);
    writeFileSync(join(tmpDir, 'wrangler.toml'), [
      `name = "${workerName}"`,
      '[[r2_buckets]]',
      'binding = "STORAGE"',
      `bucket_name = "${legacyName}"`,
    ].join('\n'));

    const untrustedRunner = vi.fn(() => {
      throw new Error('bucket already exists');
    });
    expect(() => provisionR2Buckets(tmpDir, null, untrustedRunner))
      .toThrow(/Legacy R2 bucket.*without a current-account deploy manifest/i);
    expect(untrustedRunner).not.toHaveBeenCalled();

    const previousManifest = manifestWithResource({
      type: 'r2_bucket',
      name: legacyName,
      binding: 'STORAGE',
      id: legacyName,
      managed: true,
      source: 'created',
    }, workerName);
    const trustedRunner = vi.fn(() => {
      throw new Error('bucket already exists');
    });
    expect(provisionR2Buckets(tmpDir, previousManifest, trustedRunner)).toMatchObject([{
      name: legacyName,
      binding: 'STORAGE',
      managed: true,
      source: 'created',
    }]);
    expect(trustedRunner).toHaveBeenCalledTimes(1);

    const scopedName = buildManagedR2BucketName(workerName);
    writeFileSync(join(tmpDir, 'wrangler.toml'), [
      `name = "${workerName}"`,
      '[[r2_buckets]]',
      'binding = "STORAGE"',
      `bucket_name = "${scopedName}"`,
    ].join('\n'));
    expect(provisionR2Buckets(tmpDir, null, () => {
      throw new Error('bucket already exists');
    })).toMatchObject([{
      name: scopedName,
      binding: 'STORAGE',
      managed: true,
      source: 'existing',
    }]);
  });

  it('rejects malformed requested bindings before any remote mutation', () => {
    const runner = vi.fn(() => '[]');
    expect(() => provisionKvNamespaces(
      { broken: {} as { binding: string } },
      tmpDir,
      {},
      runner,
    )).toThrow(/must declare a non-empty binding/i);
    expect(() => provisionVectorizeIndexes(
      { broken: { binding: '' } },
      tmpDir,
      {},
      runner,
    )).toThrow(/must resolve to a non-empty binding/i);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it('validates every Wrangler list as an array with resource-specific fields', () => {
    expect(parseKvNamespaceListOutput(JSON.stringify([
      { title: 'synthetic-cache', id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    ]))).toHaveLength(1);
    expect(parseD1DatabaseListOutput(JSON.stringify([
      { name: 'synthetic-db', uuid: '11111111-2222-4333-8444-555555555555' },
    ]))).toHaveLength(1);
    expect(parseVectorizeIndexListOutput('[{"name":"edgebase-search"}]')).toHaveLength(1);

    expect(() => parseKvNamespaceListOutput('0')).toThrow(/KV namespace list shape/i);
    expect(() => parseD1DatabaseListOutput('{}')).toThrow(/D1 database list shape/i);
    expect(() => parseVectorizeIndexListOutput('[{"name":0}]'))
      .toThrow(/Vectorize index list shape/i);
  });

  it('does not create after KV, D1, or Vectorize list failure or malformed output', () => {
    const failedListRunner = vi.fn(() => {
      throw new Error('synthetic authentication failure');
    });
    expect(() => provisionKvNamespaces(
      { cache: { binding: 'CACHE_KV' } },
      tmpDir,
      {},
      failedListRunner,
    ))
      .toThrow(/existing-namespace list.*authentication failure/i);
    expect(failedListRunner).toHaveBeenCalledTimes(1);

    const malformedD1Runner = vi.fn(() => '{}');
    expect(() => provisionD1Databases(
      { app: { binding: 'APP_DB' } },
      tmpDir,
      undefined,
      malformedD1Runner,
    )).toThrow(/existing-database list.*D1 database list shape/i);
    expect(malformedD1Runner).toHaveBeenCalledTimes(1);

    const malformedVectorRunner = vi.fn(() => '0');
    expect(() => provisionVectorizeIndexes(
      { search: { binding: 'SEARCH_INDEX' } },
      tmpDir,
      {},
      malformedVectorRunner,
    )).toThrow(/existing-index list.*Vectorize index list shape/i);
    expect(malformedVectorRunner).toHaveBeenCalledTimes(1);
  });

  it('aborts on R2, KV, D1, and Vectorize create failures', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    writeFileSync(join(tmpDir, 'wrangler.toml'), [
      'name = "synthetic-worker"',
      '[[r2_buckets]]',
      'binding = "STORAGE"',
      'bucket_name = "synthetic-storage"',
    ].join('\n'));
    expect(() => provisionR2Buckets(tmpDir, null, () => {
      throw new Error('synthetic R2 quota failure');
    })).toThrow(/Required R2 binding 'STORAGE'.*quota failure/i);

    const createFailure = (args: string[]) => {
      if (args.includes('list')) return '[]';
      throw new Error('synthetic create failure');
    };
    expect(() => provisionKvNamespaces(
      { cache: { binding: 'CACHE_KV' } },
      tmpDir,
      {},
      createFailure,
    )).toThrow(/Required KV binding 'CACHE_KV'.*create failure/i);
    expect(() => provisionD1Databases(
      { app: { binding: 'APP_DB' } },
      tmpDir,
      undefined,
      createFailure,
    )).toThrow(/Required D1 binding 'APP_DB'.*create failure/i);
    expect(() => provisionVectorizeIndexes(
      { search: { binding: 'SEARCH_INDEX' } },
      tmpDir,
      {},
      createFailure,
    )).toThrow(/Required Vectorize binding 'SEARCH_INDEX'.*create failure/i);
  });

  it('aborts when Wrangler reports KV or D1 create success without a valid id', () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const missingIdRunner = (args: string[]) => args.includes('list')
      ? '[]'
      : 'Resource created, but no binding metadata was returned.';
    expect(() => provisionKvNamespaces(
      { cache: { binding: 'CACHE_KV' } },
      tmpDir,
      {},
      missingIdRunner,
    )).toThrow(/valid KV namespace id/i);
    expect(() => provisionD1Databases(
      { app: { binding: 'APP_DB' } },
      tmpDir,
      undefined,
      missingIdRunner,
    )).toThrow(/valid D1 database id/i);
  });

  it('guards against any future provisioning path returning partial binding coverage', () => {
    expect(() => assertRequiredBindingCoverage(
      'synthetic',
      ['FIRST_BINDING', 'SECOND_BINDING'],
      [{ binding: 'FIRST_BINDING' }],
    )).toThrow(/SECOND_BINDING.*Deployment aborted/i);
  });
});

describe('resolveExistingR2BucketRecord', () => {
  it('normalizes stale existing buckets back to unmanaged ownership', () => {
    expect(
      resolveExistingR2BucketRecord({
        type: 'r2_bucket',
        name: 'edgebase-storage',
        binding: 'STORAGE',
        id: 'edgebase-storage',
        managed: true,
        source: 'existing',
      }),
    ).toEqual({
      managed: false,
      source: 'existing',
    });
  });

  it('preserves ownership for buckets the suite originally created', () => {
    expect(
      resolveExistingR2BucketRecord({
        type: 'r2_bucket',
        name: 'suite-storage',
        binding: 'STORAGE',
        id: 'suite-storage',
        managed: true,
        source: 'created',
      }),
    ).toEqual({
      managed: true,
      source: 'created',
    });
  });
});

describe('resolveAdminUrlFromRuntime', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns null when runtime reports no admin dashboard', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ name: 'EdgeBase API', docs: '/openapi.json', admin: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;

    await expect(resolveAdminUrlFromRuntime('https://example.workers.dev')).resolves.toBeNull();
  });

  it('resolves relative admin URL from runtime payload', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ admin: '/admin' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;

    await expect(resolveAdminUrlFromRuntime('https://example.workers.dev')).resolves.toBe(
      'https://example.workers.dev/admin',
    );
  });

  it('uses redirect location when runtime sends one', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: {
          location: 'https://admin.example.com',
        },
      })) as typeof fetch;

    await expect(resolveAdminUrlFromRuntime('https://example.workers.dev')).resolves.toBe(
      'https://admin.example.com/',
    );
  });
});

describe('resolveReleaseSecretVars', () => {
  it('prefers explicit shell env over .env.release values for matching keys', () => {
    const envPath = join(tmpDir, '.env.release');
    writeFileSync(envPath, [
      'MOCK_SERVER_URL=https://old-tunnel.example.com',
      'EDGEBASE_EMAIL_API_URL=https://old-tunnel.example.com/email',
      'EDGEBASE_RUNTIME_MODE=self-hosted',
      'UNCHANGED=value-from-file',
    ].join('\n'));

    const previousMock = process.env.MOCK_SERVER_URL;
    const previousEmail = process.env.EDGEBASE_EMAIL_API_URL;
    process.env.MOCK_SERVER_URL = 'https://new-tunnel.example.com';
    process.env.EDGEBASE_EMAIL_API_URL = 'https://new-tunnel.example.com/email';

    try {
      expect(resolveReleaseSecretVars(tmpDir)).toEqual({
        MOCK_SERVER_URL: 'https://new-tunnel.example.com',
        EDGEBASE_EMAIL_API_URL: 'https://new-tunnel.example.com/email',
        UNCHANGED: 'value-from-file',
      });
    } finally {
      if (previousMock === undefined) delete process.env.MOCK_SERVER_URL;
      else process.env.MOCK_SERVER_URL = previousMock;
      if (previousEmail === undefined) delete process.env.EDGEBASE_EMAIL_API_URL;
      else process.env.EDGEBASE_EMAIL_API_URL = previousEmail;
    }
  });
});

describe('collectAuthEnvWarnings', () => {
  it('warns when a provider is enabled only in development', () => {
    writeFileSync(join(tmpDir, '.env.development'), [
      'EDGEBASE_AUTH_ALLOWED_OAUTH_PROVIDERS=google,discord',
      'EDGEBASE_OAUTH_GOOGLE_CLIENT_ID=gid',
      'EDGEBASE_OAUTH_GOOGLE_CLIENT_SECRET=gsecret',
      'EDGEBASE_OAUTH_DISCORD_CLIENT_ID=did',
      'EDGEBASE_OAUTH_DISCORD_CLIENT_SECRET=dsecret',
      '',
    ].join('\n'));
    writeFileSync(join(tmpDir, '.env.release'), [
      'EDGEBASE_AUTH_ALLOWED_OAUTH_PROVIDERS=google',
      'EDGEBASE_OAUTH_GOOGLE_CLIENT_ID=rgid',
      'EDGEBASE_OAUTH_GOOGLE_CLIENT_SECRET=rgsecret',
      '',
    ].join('\n'));

    expect(collectAuthEnvWarnings(tmpDir)).toEqual(expect.arrayContaining([
      expect.stringContaining('OAuth provider(s) enabled in Development but not Release: discord'),
    ]));
  });

  it('warns when a release-enabled provider is missing required secrets', () => {
    writeFileSync(join(tmpDir, '.env.release'), [
      'EDGEBASE_AUTH_ALLOWED_OAUTH_PROVIDERS=google,discord,oidc:custom',
      'EDGEBASE_OAUTH_GOOGLE_CLIENT_ID=rgid',
      'EDGEBASE_OAUTH_GOOGLE_CLIENT_SECRET=rgsecret',
      'EDGEBASE_OIDC_CUSTOM_CLIENT_ID=oidc-id',
      'EDGEBASE_OIDC_CUSTOM_CLIENT_SECRET=oidc-secret',
      '',
    ].join('\n'));

    expect(collectAuthEnvWarnings(tmpDir)).toEqual(expect.arrayContaining([
      expect.stringContaining(
        'Release OAuth provider(s) are enabled but missing required secrets in .env.release: discord (clientId, clientSecret); oidc:custom (issuer).',
      ),
    ]));
  });
});

describe('auth release sync helpers', () => {
  it('inspects provider mismatches and marks copyable ones', () => {
    writeFileSync(join(tmpDir, '.env.development'), [
      'EDGEBASE_AUTH_ALLOWED_OAUTH_PROVIDERS=google,discord',
      'EDGEBASE_OAUTH_GOOGLE_CLIENT_ID=gid',
      'EDGEBASE_OAUTH_GOOGLE_CLIENT_SECRET=gsecret',
      'EDGEBASE_OAUTH_DISCORD_CLIENT_ID=did',
      'EDGEBASE_OAUTH_DISCORD_CLIENT_SECRET=dsecret',
      '',
    ].join('\n'));
    writeFileSync(join(tmpDir, '.env.release'), [
      'EDGEBASE_AUTH_ALLOWED_OAUTH_PROVIDERS=google',
      'EDGEBASE_OAUTH_GOOGLE_CLIENT_ID=rgid',
      'EDGEBASE_OAUTH_GOOGLE_CLIENT_SECRET=rgsecret',
      '',
    ].join('\n'));

    expect(inspectAuthEnv(tmpDir)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        provider: 'discord',
        devEnabled: true,
        releaseEnabled: false,
        canCopyToRelease: true,
      }),
    ]));
  });

  it('copies a development-only provider into .env.release without overwriting existing release values', () => {
    writeFileSync(join(tmpDir, '.env.development'), [
      'EDGEBASE_AUTH_ALLOWED_OAUTH_PROVIDERS=discord',
      'EDGEBASE_OAUTH_DISCORD_CLIENT_ID=did',
      'EDGEBASE_OAUTH_DISCORD_CLIENT_SECRET=dsecret',
      '',
    ].join('\n'));
    writeFileSync(join(tmpDir, '.env.release'), [
      'EDGEBASE_AUTH_ALLOWED_OAUTH_PROVIDERS=',
      'EDGEBASE_OAUTH_DISCORD_CLIENT_ID=release-did',
      '',
    ].join('\n'));

    const discordInspection = inspectAuthEnv(tmpDir).find((entry) => entry.provider === 'discord');
    expect(discordInspection).toBeTruthy();

    const result = copyDevelopmentAuthProviderToRelease(tmpDir, discordInspection!);
    expect(result).toEqual({
      enabledInRelease: true,
      copiedFields: ['clientSecret'],
    });

    const releaseEnv = readFileSync(join(tmpDir, '.env.release'), 'utf-8');
    expect(releaseEnv).toContain('EDGEBASE_AUTH_ALLOWED_OAUTH_PROVIDERS=discord');
    expect(releaseEnv).toContain('EDGEBASE_OAUTH_DISCORD_CLIENT_ID=release-did');
    expect(releaseEnv).toContain('EDGEBASE_OAUTH_DISCORD_CLIENT_SECRET=dsecret');
  });
});

// ======================================================================
// 2. validateConfig — Inline Service Key warning
// ======================================================================

describe('validateConfig — Inline Service Key warning', () => {
  it('warns when config has inline secretSource keys', () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    validateConfig(
      {
        release: true,
        serviceKeys: {
          keys: [
            {
              kid: 'local-dev',
              tier: 'root',
              scopes: ['*'],
              secretSource: 'inline',
              inlineSecret: 'sk_test',
            },
          ],
        },
      },
      warnings,
      errors,
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('local-dev');
    expect(warnings[0]).toContain("secretSource: 'inline'");
    expect(warnings[0]).toContain('dashboard');
    expect(errors).toHaveLength(0);
  });

  it('no warning when all keys use dashboard secretSource', () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    validateConfig(
      {
        release: true,
        serviceKeys: {
          keys: [
            {
              kid: 'prod-key',
              tier: 'root',
              scopes: ['*'],
              secretSource: 'dashboard',
              secretRef: 'SERVICE_KEY_PROD',
            },
          ],
        },
      },
      warnings,
      errors,
    );

    expect(warnings).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it('warns for multiple inline keys — lists all kids', () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    validateConfig(
      {
        release: true,
        serviceKeys: {
          keys: [
            {
              kid: 'dev1',
              tier: 'root',
              scopes: ['*'],
              secretSource: 'inline',
              inlineSecret: 'sk1',
            },
            {
              kid: 'prod',
              tier: 'root',
              scopes: ['*'],
              secretSource: 'dashboard',
              secretRef: 'SK_PROD',
            },
            {
              kid: 'dev2',
              tier: 'scoped',
              scopes: ['kv:*'],
              secretSource: 'inline',
              inlineSecret: 'sk2',
            },
          ],
        },
      },
      warnings,
      errors,
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('dev1');
    expect(warnings[0]).toContain('dev2');
    // 'prod' key should not be listed (it uses 'dashboard')
    // Note: we check for the kid format '[dev1, dev2]' to avoid matching 'production' in the message
    expect(warnings[0]).toMatch(/\[dev1, dev2\]/);
    expect(warnings[0]).not.toMatch(/\bprod\b/);
  });

  it('no warning when serviceKeys is absent', () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    validateConfig(
      {
        release: true,
      },
      warnings,
      errors,
    );

    expect(warnings).toHaveLength(0);
  });

  it('no warning when serviceKeys.keys is empty', () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    validateConfig(
      {
        release: true,
        serviceKeys: { keys: [] },
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
          keys: [
            {
              kid: 'local_dev',
              tier: 'root',
              scopes: ['*'],
              secretSource: 'dashboard',
              secretRef: 'SERVICE_KEY_LOCAL',
            },
          ],
        },
      },
      warnings,
      errors,
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('local_dev');
    expect(errors[0]).toContain('Underscore is reserved');
  });

  it('errors when service key kids are duplicated', () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    validateConfig(
      {
        release: true,
        serviceKeys: {
          keys: [
            {
              kid: 'backend',
              tier: 'root',
              scopes: ['*'],
              secretSource: 'dashboard',
              secretRef: 'SERVICE_KEY_BACKEND',
            },
            {
              kid: 'backend',
              tier: 'scoped',
              scopes: ['db:table:posts:read'],
              secretSource: 'dashboard',
              secretRef: 'SERVICE_KEY_ANALYTICS',
            },
          ],
        },
      },
      warnings,
      errors,
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Duplicate Service Key kid 'backend'");
  });

  it('errors when dashboard keys omit secretRef', () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    validateConfig(
      {
        release: true,
        serviceKeys: {
          keys: [
            {
              kid: 'backend',
              tier: 'root',
              scopes: ['*'],
              secretSource: 'dashboard',
            },
          ],
        },
      },
      warnings,
      errors,
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('requires a non-empty secretRef');
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
              scopes: ['*'],
              secretSource: 'dashboard',
              secretRef: 'SERVICE_KEY_TENANT',
              constraints: { tenant: 'workspace-123' },
            },
            {
              kid: 'ip-root',
              tier: 'root',
              scopes: ['*'],
              secretSource: 'dashboard',
              secretRef: 'SERVICE_KEY_IP',
              constraints: { ipCidr: ['10.0.0.0/8'] },
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

// ======================================================================
// 3. scanFunctions
// ======================================================================

describe('scanFunctions', () => {
  it('finds .ts files in flat directory', () => {
    const functionsDir = join(tmpDir, 'functions');
    mkdirSync(functionsDir);
    writeFileSync(join(functionsDir, 'onUserCreated.ts'), 'export default {}');
    writeFileSync(join(functionsDir, 'onPostPublished.ts'), 'export default {}');

    const results = scanFunctions(functionsDir);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.name).sort()).toEqual(['onPostPublished', 'onUserCreated']);
  });

  it('finds .ts files in nested directories', () => {
    const functionsDir = join(tmpDir, 'functions');
    mkdirSync(join(functionsDir, 'auth'), { recursive: true });
    writeFileSync(join(functionsDir, 'auth', 'onLogin.ts'), 'export default {}');
    writeFileSync(join(functionsDir, 'setup.ts'), 'export default {}');

    const results = scanFunctions(functionsDir);
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.name === 'auth/onLogin')?.relativePath).toBe('auth/onLogin.ts');
  });

  it('skips files starting with underscore', () => {
    const functionsDir = join(tmpDir, 'functions');
    mkdirSync(functionsDir);
    writeFileSync(join(functionsDir, '_helper.ts'), 'export default {}');
    writeFileSync(join(functionsDir, 'onEvent.ts'), 'export default {}');

    const results = scanFunctions(functionsDir);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('onEvent');
  });

  it('skips non-.ts files', () => {
    const functionsDir = join(tmpDir, 'functions');
    mkdirSync(functionsDir);
    writeFileSync(join(functionsDir, 'readme.md'), '# README');
    writeFileSync(join(functionsDir, 'config.json'), '{}');
    writeFileSync(join(functionsDir, 'onEvent.ts'), 'export default {}');

    const results = scanFunctions(functionsDir);
    expect(results).toHaveLength(1);
  });

  it('returns empty array for empty directory', () => {
    const functionsDir = join(tmpDir, 'functions');
    mkdirSync(functionsDir);

    const results = scanFunctions(functionsDir);
    expect(results).toHaveLength(0);
  });

  it('uses forward slashes in relative paths (cross-platform)', () => {
    const functionsDir = join(tmpDir, 'functions');
    mkdirSync(join(functionsDir, 'deep', 'nested'), { recursive: true });
    writeFileSync(join(functionsDir, 'deep', 'nested', 'handler.ts'), 'export default {}');

    const results = scanFunctions(functionsDir);
    expect(results[0].relativePath).toBe('deep/nested/handler.ts');
    expect(results[0].relativePath).not.toContain('\\');
  });
});

// ======================================================================
// 4. generateFunctionRegistry
// ======================================================================

describe('generateFunctionRegistry', () => {
  it('generates registry file with imports and registrations', () => {
    const outputPath = join(tmpDir, 'src', '_functions-registry.ts');
    mkdirSync(join(tmpDir, 'src'), { recursive: true });

    const functions = [
      {
        name: 'onUserCreated',
        relativePath: 'onUserCreated.ts',
        methods: [],
        hasDefaultExport: true,
        isMiddleware: false,
      },
      {
        name: 'onPostPublished',
        relativePath: 'onPostPublished.ts',
        methods: [],
        hasDefaultExport: true,
        isMiddleware: false,
      },
    ];

    generateFunctionRegistry(functions, outputPath);

    expect(existsSync(outputPath)).toBe(true);
    const content = readFileSync(outputPath, 'utf-8');

    expect(content).toContain('Auto-generated function registry');
    expect(content).toMatch(
      /import onUserCreated_module from '\.\.\/(?:\.\.\/)*functions\/onUserCreated\.ts'/,
    );
    expect(content).toMatch(
      /import onPostPublished_module from '\.\.\/(?:\.\.\/)*functions\/onPostPublished\.ts'/,
    );
    expect(content).toContain("registerFunction('onUserCreated', wrapMethodExport(onUserCreated_module, '*'));");
    expect(content).toContain("registerFunction('onPostPublished', wrapMethodExport(onPostPublished_module, '*'));");
    expect(content).toContain("import { parseConfig } from './lib/do-router.js'");
    expect(content).toContain('const keepBundled = [config, registerMiddleware, RoomsDO];');
    expect(content).toContain('const resolvedConfig = parseConfig();');
    expect(content).toContain('export function initFunctionRegistry()');
  });

  it('generates empty registry for no functions', () => {
    const outputPath = join(tmpDir, 'src', '_functions-registry.ts');
    mkdirSync(join(tmpDir, 'src'), { recursive: true });

    generateFunctionRegistry([], outputPath);

    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toContain('initFunctionRegistry');
    // No user function imports — only plugin registration boilerplate
    expect(content).not.toMatch(/from '\.\.\/(?:\.\.\/)*functions\//);
  });

  it('wires module-level trigger metadata for method exports', () => {
    const outputPath = join(tmpDir, 'src', '_functions-registry.ts');
    mkdirSync(join(tmpDir, 'src'), { recursive: true });

    const functions = [
      {
        name: 'custom-alias',
        relativePath: 'custom-alias.ts',
        methods: ['GET'],
        hasDefaultExport: false,
        hasTriggerExport: true,
        isMiddleware: false,
      },
    ];

    generateFunctionRegistry(functions, outputPath);

    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toMatch(
      /import \* as custom_alias_module from '\.\.\/(?:\.\.\/)*functions\/custom-alias\.ts'/,
    );
    expect(content).toContain(
      "registerFunction('custom-alias', wrapMethodExport(custom_alias_module.GET, 'GET', custom_alias_module.trigger));",
    );
  });

  it('does not reference module.trigger when a file has no trigger export', () => {
    const outputPath = join(tmpDir, 'src', '_functions-registry.ts');
    mkdirSync(join(tmpDir, 'src'), { recursive: true });

    const functions = [
      {
        name: 'echo',
        relativePath: 'echo.ts',
        methods: ['GET'],
        hasDefaultExport: false,
        hasTriggerExport: false,
        isMiddleware: false,
      },
    ];

    generateFunctionRegistry(functions, outputPath);

    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toContain("registerFunction('echo', wrapMethodExport(echo_module.GET, 'GET'));");
    expect(content).not.toContain("echo_module.trigger");
  });

  it('handles nested function paths', () => {
    const outputPath = join(tmpDir, 'src', '_functions-registry.ts');
    mkdirSync(join(tmpDir, 'src'), { recursive: true });

    const functions = [
      {
        name: 'auth/onLogin',
        relativePath: 'auth/onLogin.ts',
        methods: [],
        hasDefaultExport: true,
        isMiddleware: false,
      },
    ];

    generateFunctionRegistry(functions, outputPath);

    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toMatch(
      /import auth_onLogin_module from '\.\.\/(?:\.\.\/)*functions\/auth\/onLogin\.ts'/,
    );
  });

  it('sanitizes function names with special characters', () => {
    const outputPath = join(tmpDir, 'src', '_functions-registry.ts');
    mkdirSync(join(tmpDir, 'src'), { recursive: true });

    const functions = [
      {
        name: 'on-user-created',
        relativePath: 'on-user-created.ts',
        methods: [],
        hasDefaultExport: true,
        isMiddleware: false,
      },
    ];

    generateFunctionRegistry(functions, outputPath);

    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toContain('import on_user_created_module');
    expect(content).toContain("registerFunction('on-user-created'");
  });

  it('creates output directory if it does not exist', () => {
    const outputPath = join(tmpDir, 'deep', 'nested', 'src', '_functions-registry.ts');

    generateFunctionRegistry([], outputPath);

    expect(existsSync(outputPath)).toBe(true);
  });

  it('emits blocking storage hook events in the storage trigger set', () => {
    const outputPath = join(tmpDir, 'src', '_functions-registry.ts');
    mkdirSync(join(tmpDir, 'src'), { recursive: true });

    generateFunctionRegistry([], outputPath);

    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toContain("'beforeUpload'");
    expect(content).toContain("'beforeDownload'");
    expect(content).toContain("'beforeDelete'");
  });

  it('supports runtime-scaffold config imports for deploy/dev registries', () => {
    const outputPath = join(tmpDir, 'src', '_functions-registry.ts');
    mkdirSync(join(tmpDir, 'src'), { recursive: true });

    generateFunctionRegistry([], outputPath, { configImportPath: './generated-config.js' });

    const content = readFileSync(outputPath, 'utf-8');
    expect(content).toContain("import config from './generated-config.js'");
  });
});

// ======================================================================
// 5. mergePluginTables (Explicit Import Pattern)
// ======================================================================

describe('mergePluginTables', () => {
  it('merges plugin tables into shared db block by default', () => {
    const databases: Record<string, { tables?: Record<string, unknown> }> = {
      shared: { tables: { posts: { schema: {} } } },
    };
    const plugins = [
      {
        name: 'plugin-stripe',
        config: {},
        tables: { customers: { schema: { userId: { type: 'string' } } } },
      },
    ];

    mergePluginTables(databases, plugins as any);

    expect(databases.shared.tables).toHaveProperty('plugin-stripe/customers');
    expect(databases.shared.tables!['plugin-stripe/customers']).toEqual({
      schema: { userId: { type: 'string' } },
    });
    // Original tables preserved
    expect(databases.shared.tables).toHaveProperty('posts');
  });

  it('uses custom dbBlock when specified', () => {
    const databases: Record<string, { tables?: Record<string, unknown> }> = {
      shared: { tables: {} },
    };
    const plugins = [
      {
        name: 'plugin-analytics',
        config: {},
        dbBlock: 'analytics',
        tables: { events: { schema: {} } },
      },
    ];

    mergePluginTables(databases, plugins as any);

    expect(databases).toHaveProperty('analytics');
    expect(databases.analytics.tables).toHaveProperty('plugin-analytics/events');
    // shared untouched
    expect(Object.keys(databases.shared.tables!)).toHaveLength(0);
  });

  it('creates db block if it does not exist', () => {
    const databases: Record<string, { tables?: Record<string, unknown> }> = {};
    const plugins = [{ name: 'plugin-cache', config: {}, tables: { entries: { schema: {} } } }];

    mergePluginTables(databases, plugins as any);

    expect(databases).toHaveProperty('shared');
    expect(databases.shared.tables).toHaveProperty('plugin-cache/entries');
  });

  it('handles multiple plugins', () => {
    const databases: Record<string, { tables?: Record<string, unknown> }> = {
      shared: { tables: {} },
    };
    const plugins = [
      {
        name: 'plugin-stripe',
        config: {},
        tables: { customers: { schema: {} }, subscriptions: { schema: {} } },
      },
      { name: 'plugin-analytics', config: {}, tables: { events: { schema: {} } } },
    ];

    mergePluginTables(databases, plugins as any);

    expect(databases.shared.tables).toHaveProperty('plugin-stripe/customers');
    expect(databases.shared.tables).toHaveProperty('plugin-stripe/subscriptions');
    expect(databases.shared.tables).toHaveProperty('plugin-analytics/events');
  });

  it('does nothing for plugins without tables', () => {
    const databases: Record<string, { tables?: Record<string, unknown> }> = {
      shared: { tables: { posts: {} } },
    };
    const plugins = [{ name: 'plugin-no-tables', config: {} }];

    mergePluginTables(databases, plugins as any);

    expect(Object.keys(databases.shared.tables!)).toEqual(['posts']);
  });

  it('does nothing for empty plugins array', () => {
    const databases: Record<string, { tables?: Record<string, unknown> }> = {
      shared: { tables: { posts: {} } },
    };

    mergePluginTables(databases, []);

    expect(Object.keys(databases.shared.tables!)).toEqual(['posts']);
  });

  it('extractDatabases includes plugin tables even when only plugins define them', () => {
    const databases = extractDatabases({
      plugins: [
        {
          name: 'plugin-analytics',
          pluginApiVersion: 1,
          config: {},
          tables: {
            events: {
              access: { read: 'true' },
              handlers: { hooks: { beforeInsert: 'return data;' } },
            },
          },
        },
      ],
    });

    expect(databases.shared.tables).toHaveProperty('plugin-analytics/events');
    expect(databases.shared.tables!['plugin-analytics/events']).toMatchObject({
      access: { read: 'true' },
      handlers: { hooks: { beforeInsert: 'return data;' } },
    });
  });
});

// ======================================================================
// 6. generateTempWranglerToml
// ======================================================================

const {
  generateTempWranglerToml,
  collectManagedCronSchedules,
  buildMergedKvConfig,
  buildMergedD1Config,
  parseWranglerJsonOutput,
  dedupeManifestResources,
} = _internals;

describe('generateTempWranglerToml', () => {
  it('owns the runtime mode variable without clobbering other root vars', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(
      wranglerPath,
      [
        'name = "my-worker"',
        '',
        '[vars]',
        'EXISTING = "kept"',
        'EDGEBASE_RUNTIME_MODE = "self-hosted"',
        '',
        '[assets]',
        'directory = "./public"',
      ].join('\n'),
    );

    const result = generateTempWranglerToml(wranglerPath, {
      bindings: [],
      runtimeMode: 'cloudflare',
    });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    expect(content).toContain('EXISTING = "kept"');
    expect(content).toContain('EDGEBASE_RUNTIME_MODE = "cloudflare"');
    expect(content).not.toContain('EDGEBASE_RUNTIME_MODE = "self-hosted"');
    expect(content.match(/EDGEBASE_RUNTIME_MODE/g)).toHaveLength(1);
    rmSync(result!);
  });

  it('injects EdgeBase assets when no assets block is present', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(wranglerPath, 'name = "my-worker"\n');

    const result = generateTempWranglerToml(wranglerPath, { bindings: [] });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    expect(content).toContain('[assets]');
    expect(content).toContain('directory = ".edgebase/runtime/server/app-assets"');
    expect(content).toContain('binding = "ASSETS"');
    expect(content).toContain('run_worker_first = true');

    rmSync(result!);
  });

  it('leaves unrelated custom assets blocks untouched when no other changes are needed', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(
      wranglerPath,
      [
        'name = "my-worker"',
        '',
        '[assets]',
        'directory = "./public"',
      ].join('\n'),
    );

    const result = generateTempWranglerToml(wranglerPath, { bindings: [] });

    expect(result).toBeNull();
  });

  it('forces worker-first routing for EdgeBase assets blocks even without extra bindings', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(
      wranglerPath,
      [
        'name = "my-worker"',
        '',
        '[assets]',
        'directory = ".edgebase/runtime/server/admin-build"',
        'binding = "ASSETS"',
      ].join('\n'),
    );

    const result = generateTempWranglerToml(wranglerPath, { bindings: [] });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    expect(content).toContain('[assets]');
    expect(content).toContain('directory = ".edgebase/runtime/server/app-assets"');
    expect(content).toContain('run_worker_first = true');

    rmSync(result!);
  });

  it('rewrites disabled worker-first routing for EdgeBase assets blocks', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(
      wranglerPath,
      [
        'name = "my-worker"',
        '',
        '[assets]',
        'directory = ".edgebase/runtime/server/admin-build"',
        'binding = "ASSETS"',
        'run_worker_first = false',
      ].join('\n'),
    );

    const result = generateTempWranglerToml(wranglerPath, { bindings: [] });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    expect(content).toContain('directory = ".edgebase/runtime/server/app-assets"');
    expect(content).toContain('run_worker_first = true');
    expect(content).not.toContain('run_worker_first = false');

    rmSync(result!);
  });

  it('generates temp toml with KV binding', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(wranglerPath, 'name = "my-worker"\n');

    const result = generateTempWranglerToml(wranglerPath, {
      bindings: [
        { type: 'kv_namespace', name: 'cache', binding: 'CACHE_KV', id: 'abc123' },
      ],
    });

    expect(result).not.toBeNull();
    expect(result).toContain(join(tmpDir, '.wrangler.generated.'));
    const content = readFileSync(result!, 'utf-8');
    expect(content).toContain('name = "my-worker"');
    expect(content).toContain('[[kv_namespaces]]');
    expect(content).toContain('binding = "CACHE_KV"');
    expect(content).toContain('id = "abc123"');

    // Clean up
    rmSync(result!);
  });

  it('generates temp toml with D1 binding', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(wranglerPath, 'name = "my-worker"\n');

    const result = generateTempWranglerToml(wranglerPath, {
      bindings: [
        { type: 'd1_database', name: 'analytics', binding: 'ANALYTICS_DB', id: 'db-uuid-123' },
      ],
    });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    expect(content).toContain('[[d1_databases]]');
    expect(content).toContain('binding = "ANALYTICS_DB"');
    expect(content).toContain(
      `database_name = "${buildManagedD1DatabaseName('my-worker', 'analytics')}"`,
    );
    expect(content).toContain('database_id = "db-uuid-123"');

    rmSync(result!);
  });

  it('generates temp toml with Vectorize binding', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(wranglerPath, 'name = "my-worker"\n');

    const result = generateTempWranglerToml(wranglerPath, {
      bindings: [
        {
          type: 'vectorize',
          name: 'embeddings',
          binding: 'VECTORIZE_EMBEDDINGS',
          id: 'edgebase-embeddings',
        },
      ],
    });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    expect(content).toContain('[[vectorize]]');
    expect(content).toContain('binding = "VECTORIZE_EMBEDDINGS"');
    expect(content).toContain('index_name = "edgebase-embeddings"');

    rmSync(result!);
  });

  it('generates temp toml with mixed KV + D1 + Vectorize bindings', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(wranglerPath, 'name = "my-worker"\n');

    const result = generateTempWranglerToml(wranglerPath, {
      bindings: [
        { type: 'kv_namespace', name: 'cache', binding: 'CACHE_KV', id: 'kv-id' },
        { type: 'd1_database', name: 'analytics', binding: 'ANALYTICS_DB', id: 'db-id' },
        { type: 'vectorize', name: 'embeddings', binding: 'VEC_EMB', id: 'edgebase-embeddings' },
      ],
    });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    expect(content).toContain('[[kv_namespaces]]');
    expect(content).toContain('[[d1_databases]]');
    expect(content).toContain('[[vectorize]]');
    // All three bindings present
    expect(content).toContain('binding = "CACHE_KV"');
    expect(content).toContain('binding = "ANALYTICS_DB"');
    expect(content).toContain('binding = "VEC_EMB"');

    rmSync(result!);
  });

  it('replaces existing KV bindings when the same binding is reprovisioned', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(
      wranglerPath,
      [
        'name = "my-worker"',
        '',
        '[[kv_namespaces]]',
        'binding = "CACHE_KV"',
        'id = "existing-id"',
      ].join('\n'),
    );

    const result = generateTempWranglerToml(wranglerPath, {
      bindings: [
        { type: 'kv_namespace', name: 'cache', binding: 'CACHE_KV', id: 'new-id' },
      ],
    });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    expect(content).toContain('binding = "CACHE_KV"');
    expect(content).toContain('id = "new-id"');
    expect(content).not.toContain('id = "existing-id"');

    rmSync(result!);
  });

  it('replaces existing D1 bindings when the same binding is reprovisioned', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(
      wranglerPath,
      [
        'name = "my-worker"',
        '',
        '[[d1_databases]]',
        'binding = "AUTH_DB"',
        'database_name = "edgebase-auth"',
        'database_id = "local"',
      ].join('\n'),
    );

    const result = generateTempWranglerToml(wranglerPath, {
      bindings: [
        { type: 'd1_database', name: 'auth', binding: 'AUTH_DB', id: 'cloud-auth-id' },
        { type: 'd1_database', name: 'control', binding: 'CONTROL_DB', id: 'cloud-control-id' },
      ],
    });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    expect(content).toContain('database_id = "cloud-auth-id"');
    expect(content).toContain('binding = "CONTROL_DB"');
    expect(content).not.toContain('database_id = "local"');

    rmSync(result!);
  });

  it('preserves original wrangler.toml content', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    const original = [
      'name = "edgebase-worker"',
      'compatibility_date = "2024-01-01"',
      '',
      '[[kv_namespaces]]',
      'binding = "KV"',
      'id = "internal-kv-id"',
    ].join('\n');
    writeFileSync(wranglerPath, original);

    const result = generateTempWranglerToml(wranglerPath, {
      bindings: [
        { type: 'kv_namespace', name: 'cache', binding: 'USER_CACHE', id: 'user-cache-id' },
      ],
    });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    // Original content preserved at the top
    expect(content).toContain('name = "edgebase-worker"');
    expect(content).toContain('binding = "KV"');
    expect(content).toContain('id = "internal-kv-id"');
    // New binding appended
    expect(content).toContain('binding = "USER_CACHE"');
    expect(content).toContain('id = "user-cache-id"');
    // Auto-provisioned comment
    expect(content).toContain('Auto-provisioned bindings');

    rmSync(result!);
  });

  it('handles multiple KV bindings', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(wranglerPath, 'name = "my-worker"\n');

    const result = generateTempWranglerToml(wranglerPath, {
      bindings: [
        { type: 'kv_namespace', name: 'cache', binding: 'CACHE_KV', id: 'cache-id' },
        { type: 'kv_namespace', name: 'sessions', binding: 'SESSIONS_KV', id: 'sessions-id' },
      ],
    });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    // Both KV namespaces present
    const kvCount = (content.match(/\[\[kv_namespaces\]\]/g) || []).length;
    expect(kvCount).toBe(2);
    expect(content).toContain('binding = "CACHE_KV"');
    expect(content).toContain('binding = "SESSIONS_KV"');

    rmSync(result!);
  });

  it('handles multiple D1 databases', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(wranglerPath, 'name = "my-worker"\n');

    const result = generateTempWranglerToml(wranglerPath, {
      bindings: [
        { type: 'd1_database', name: 'analytics', binding: 'ANALYTICS_DB', id: 'db1' },
        { type: 'd1_database', name: 'logs', binding: 'LOGS_DB', id: 'db2' },
      ],
    });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    const d1Count = (content.match(/\[\[d1_databases\]\]/g) || []).length;
    expect(d1Count).toBe(2);
    expect(content).toContain(
      `database_name = "${buildManagedD1DatabaseName('my-worker', 'analytics')}"`,
    );
    expect(content).toContain(
      `database_name = "${buildManagedD1DatabaseName('my-worker', 'logs')}"`,
    );

    rmSync(result!);
  });

  it('generates temp toml with rate-limit bindings only', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(wranglerPath, 'name = "my-worker"\n');

    const result = generateTempWranglerToml(wranglerPath, {
      bindings: [],
      rateLimitBindings: [
        { binding: 'DB_RATE_LIMITER', namespaceId: '2002', limit: 250, period: 60 },
      ],
    });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    expect(content).toContain('[[unsafe.bindings]]');
    expect(content).toContain('name = "DB_RATE_LIMITER"');
    expect(content).toContain('namespace_id = "2002"');
    expect(content).toContain('simple = { limit = 250, period = 60 }');

    rmSync(result!);
  });

  it('replaces existing built-in rate-limit bindings with generated values', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(
      wranglerPath,
      [
        'name = "my-worker"',
        '',
        '[[unsafe.bindings]]',
        'name = "DB_RATE_LIMITER"',
        'type = "ratelimit"',
        'namespace_id = "1002"',
        'simple = { limit = 10000000, period = 60 }',
      ].join('\n'),
    );

    const result = generateTempWranglerToml(wranglerPath, {
      bindings: [],
      rateLimitBindings: [
        { binding: 'DB_RATE_LIMITER', namespaceId: '9999', limit: 25, period: 10 },
      ],
    });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    expect(content).toContain('namespace_id = "9999"');
    expect(content).toContain('simple = { limit = 25, period = 10 }');
    expect(content).not.toContain('simple = { limit = 10000000, period = 60 }');

    rmSync(result!);
  });

  it('replaces existing triggers with the generated cron schedules', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(
      wranglerPath,
      [
        'name = "my-worker"',
        '',
        '[triggers]',
        'crons = ["0 * * * *"]',
      ].join('\n'),
    );

    const result = generateTempWranglerToml(wranglerPath, {
      bindings: [],
      triggerMode: 'replace',
      managedCrons: ['*/5 * * * *'],
    });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    expect(content).toContain('crons = ["*/5 * * * *"]');
    expect(content).not.toContain('crons = ["0 * * * *"]');

    rmSync(result!);
  });

  it('preserves existing triggers by default when only bindings are appended', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(
      wranglerPath,
      [
        'name = "my-worker"',
        '',
        '[triggers]',
        'crons = ["0 * * * *"]',
      ].join('\n'),
    );

    const result = generateTempWranglerToml(wranglerPath, {
      bindings: [
        { type: 'kv_namespace', name: 'cache', binding: 'CACHE_KV', id: 'cache-id' },
      ],
    });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    expect(content).toContain('crons = ["0 * * * *"]');
    expect(content).toContain('binding = "CACHE_KV"');

    rmSync(result!);
  });

  it('rewrites triggers only when explicitly replacing the managed cron set', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(
      wranglerPath,
      [
        'name = "my-worker"',
        '',
        '[triggers]',
        'crons = ["0 * * * *"]',
      ].join('\n'),
    );

    const result = generateTempWranglerToml(wranglerPath, {
      bindings: [],
      triggerMode: 'replace',
      managedCrons: [],
    });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    expect(content).toContain('[triggers]');
    expect(content).toContain('crons = []');
    expect(content).not.toContain('crons = ["0 * * * *"]');

    rmSync(result!);
  });

  it('dedupes duplicate KV bindings by binding name', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(wranglerPath, 'name = "my-worker"\n');

    const result = generateTempWranglerToml(wranglerPath, {
      bindings: [
        { type: 'kv_namespace', name: 'lab', binding: 'KV', id: 'kv-id' },
        { type: 'kv_namespace', name: 'test', binding: 'KV', id: 'kv-id' },
      ],
    });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    expect((content.match(/\[\[kv_namespaces\]\]/g) || []).length).toBe(1);

    rmSync(result!);
  });

  it('dedupes duplicate D1 bindings by binding name', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(wranglerPath, 'name = "my-worker"\n');

    const result = generateTempWranglerToml(wranglerPath, {
      bindings: [
        { type: 'd1_database', name: 'analytics', binding: 'DB_D1_SHARED', id: 'db-id' },
        { type: 'd1_database', name: 'test', binding: 'DB_D1_SHARED', id: 'db-id' },
      ],
    });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    expect((content.match(/\[\[d1_databases\]\]/g) || []).length).toBe(1);

    rmSync(result!);
  });

  it('normalizes legacy assets blocks that use Windows-style separators', () => {
    const wranglerPath = join(tmpDir, 'wrangler.toml');
    writeFileSync(
      wranglerPath,
      [
        'name = "my-worker"',
        '',
        '[assets]',
        'directory = ".edgebase\\\\runtime\\\\server\\\\admin-build"',
        'binding = "ASSETS"',
      ].join('\n'),
    );

    const result = generateTempWranglerToml(wranglerPath, { bindings: [] });

    expect(result).not.toBeNull();
    const content = readFileSync(result!, 'utf-8');
    expect(content).toContain('directory = ".edgebase/runtime/server/app-assets"');
    expect(content).toContain('run_worker_first = true');

    rmSync(result!);
  });
});

describe('collectManagedCronSchedules', () => {
  it('combines schedule triggers, cloudflare.extraCrons, and the system cron without duplicates', () => {
    const crons = collectManagedCronSchedules({
      functions: {
        nightly: { trigger: { type: 'schedule', cron: '0 2 * * *' } },
        duplicate: { trigger: { type: 'schedule', cron: '0 2 * * *' } },
        httpHandler: { trigger: { type: 'http' } },
      },
      cloudflare: {
        extraCrons: ['15 * * * *', '0 2 * * *', '15 * * * *'],
      },
    });

    expect(crons).toEqual(['0 2 * * *', '15 * * * *', '0 3 * * *']);
  });

  it('returns the system cron when no config-defined schedules exist', () => {
    expect(collectManagedCronSchedules(undefined)).toEqual(['0 3 * * *']);
  });
});

describe('dedupeManifestResources', () => {
  it('keeps only the latest logical resource for the same binding', () => {
    const resources = dedupeManifestResources([
      { type: 'd1_database', name: 'db-shared', binding: 'DB_D1_SHARED', id: 'stale-id' },
      { type: 'd1_database', name: 'db-shared', binding: 'DB_D1_SHARED', id: 'fresh-id' },
    ]);

    expect(resources).toEqual([
      { type: 'd1_database', name: 'db-shared', binding: 'DB_D1_SHARED', id: 'fresh-id' },
    ]);
  });
});

describe('buildMergedD1Config', () => {
  it('prefers internal and single-instance bindings over duplicate explicit d1 bindings', () => {
    const merged = buildMergedD1Config(
      {
        analytics: { binding: 'DB_D1_SHARED' },
        test: { binding: 'DB_D1_SHARED' },
      },
      {
        shared: {},
      },
    );

    expect(merged).toHaveProperty('auth');
    expect(merged).toHaveProperty('control');
    expect(merged).toHaveProperty('db-shared');
    expect(merged['db-shared']).toEqual({ binding: 'DB_D1_SHARED' });
    expect(merged).not.toHaveProperty('analytics');
    expect(merged).not.toHaveProperty('test');
  });
});

describe('buildMergedKvConfig', () => {
  it('always includes the internal KV binding and dedupes explicit duplicates', () => {
    const merged = buildMergedKvConfig({
      cache: { binding: 'CACHE_KV' },
      duplicateInternal: { binding: 'KV' },
      duplicateCache: { binding: 'CACHE_KV' },
    });

    expect(merged).toHaveProperty('internal');
    expect(merged.internal).toEqual({ binding: 'KV' });
    expect(merged).toHaveProperty('cache');
    expect(merged.cache).toEqual({ binding: 'CACHE_KV' });
    expect(merged).not.toHaveProperty('duplicateInternal');
    expect(merged).not.toHaveProperty('duplicateCache');
  });
});

describe('parseWranglerJsonOutput', () => {
  it('parses pure JSON output', () => {
    expect(parseWranglerJsonOutput('[{"name":"edgebase-embeddings"}]')).toEqual([
      { name: 'edgebase-embeddings' },
    ]);
  });

  it('parses JSON output with Wrangler banner lines before the payload', () => {
    const output = [
      '📋 Listing Vectorize indexes...',
      '[{"name":"edgebase-embeddings","config":{"dimensions":1536}}]',
    ].join('\n');

    expect(parseWranglerJsonOutput(output)).toEqual([
      { name: 'edgebase-embeddings', config: { dimensions: 1536 } },
    ]);
  });
});

describe('resolveRateLimitBindings', () => {
  it('returns built-in defaults when config is absent', () => {
    const bindings = resolveRateLimitBindings();
    expect(bindings).toHaveLength(8);
    expect(bindings.find((binding) => binding.group === 'db')).toMatchObject({
      binding: 'DB_RATE_LIMITER',
      namespaceId: '1002',
      limit: 10000000,
      period: 60,
    });
  });

  it('applies binding overrides from config', () => {
    const bindings = resolveRateLimitBindings({
      rateLimiting: {
        db: {
          requests: 100,
          window: '60s',
          binding: {
            limit: 250,
            period: 10,
            namespaceId: '4242',
          },
        },
      },
    });

    expect(bindings.find((binding) => binding.group === 'db')).toMatchObject({
      namespaceId: '4242',
      limit: 250,
      period: 10,
    });
  });

  it('omits bindings that are explicitly disabled', () => {
    const bindings = resolveRateLimitBindings({
      rateLimiting: {
        authSignin: {
          requests: 10,
          window: '60s',
          binding: {
            enabled: false,
          },
        },
      },
    });

    expect(bindings.find((binding) => binding.group === 'authSignin')).toBeUndefined();
    expect(bindings.find((binding) => binding.group === 'db')).toBeDefined();
  });
});
