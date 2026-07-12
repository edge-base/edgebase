import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeCloudflareDeployManifest,
} from '../src/lib/cloudflare-deploy-manifest.js';
import { parseWranglerResourceConfig } from '../src/lib/cloudflare-wrangler-resources.js';
import { _internals as destroyInternals } from '../src/commands/destroy.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseWranglerResourceConfig', () => {
  it('extracts worker name and R2 bucket metadata', () => {
    const config = parseWranglerResourceConfig(`
name = "room-realtime-suite-edgebase"
account_id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

[[r2_buckets]]
binding = "STORAGE"
bucket_name = "room-realtime-suite-edgebase-storage"
jurisdiction = "eu"
`);

    expect(config.workerName).toBe('room-realtime-suite-edgebase');
    expect(config.accountId).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(config.r2Buckets).toEqual([
      {
        binding: 'STORAGE',
        bucketName: 'room-realtime-suite-edgebase-storage',
        jurisdiction: 'eu',
      },
    ]);
  });

  it('accepts an indented TOML literal string for the top-level Worker name', () => {
    const config = parseWranglerResourceConfig([
      "   name = 'literal-worker'",
      '[env.staging]',
      'name = "must-not-shadow-root"',
    ].join('\n'));

    expect(config.workerName).toBe('literal-worker');
  });

  it('extracts vectorize indexes from wrangler.toml', () => {
    const config = parseWranglerResourceConfig(`
name = "my-worker"

[[vectorize]]
binding = "VECTORIZE_EMBEDDINGS"
index_name = "edgebase-embeddings"

[[vectorize]]
binding = "VECTORIZE_SEARCH"
index_name = "edgebase-search"
`);

    expect(config.vectorizeIndexes).toEqual([
      { binding: 'VECTORIZE_EMBEDDINGS', indexName: 'edgebase-embeddings' },
      { binding: 'VECTORIZE_SEARCH', indexName: 'edgebase-search' },
    ]);
  });

  it('extracts hyperdrive configs from wrangler.toml', () => {
    const config = parseWranglerResourceConfig(`
name = "my-worker"

[[hyperdrive]]
binding = "DB_POSTGRES"
id = "hd-abc123"

[[hyperdrive]]
binding = "AUTH_POSTGRES"
id = "hd-def456"
`);

    expect(config.hyperdriveConfigs).toEqual([
      { binding: 'DB_POSTGRES', id: 'hd-abc123' },
      { binding: 'AUTH_POSTGRES', id: 'hd-def456' },
    ]);
  });
});

describe('normalizeCloudflareDeployManifest', () => {
  it('upgrades legacy v1 manifests to v2 resource records', () => {
    const manifest = normalizeCloudflareDeployManifest({
      version: 1,
      deployedAt: '2026-03-10T00:00:00.000Z',
      accountId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      worker: {
        name: 'example-worker',
        url: 'https://example-worker.workers.dev',
      },
      resources: [
        { type: 'kv_namespace', name: 'internal', binding: 'KV', id: 'ns-1' },
      ],
    });

    expect(manifest).toEqual({
      version: 2,
      deployedAt: '2026-03-10T00:00:00.000Z',
      accountId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      worker: {
        name: 'example-worker',
        url: 'https://example-worker.workers.dev',
      },
      resources: [
        {
          type: 'kv_namespace',
          name: 'internal',
          binding: 'KV',
          id: 'ns-1',
          managed: false,
          source: 'existing',
          metadata: { legacyOwnershipUnverified: true },
        },
      ],
    });
  });

  it('rejects corrupted ownership metadata instead of defaulting it to managed', () => {
    const base = {
      version: 2,
      deployedAt: '2026-03-10T00:00:00.000Z',
      accountId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      worker: { name: 'example-worker', url: 'https://example-worker.workers.dev' },
    };
    expect(normalizeCloudflareDeployManifest({
      ...base,
      resources: [{ type: 'r2_bucket', name: 'storage', managed: 'false' }],
    })).toBeNull();
    expect(normalizeCloudflareDeployManifest({
      ...base,
      resources: [{ type: 'r2_bucket', name: 'storage', source: 'guessed' }],
    })).toBeNull();
    expect(normalizeCloudflareDeployManifest({
      ...base,
      resources: [{ type: 'unknown', name: 'storage' }],
    })).toBeNull();
  });
});

describe('destroy account continuity', () => {
  it('refuses to target manifest resources through a different authenticated account', () => {
    const manifest = normalizeCloudflareDeployManifest({
      version: 2,
      deployedAt: '2026-03-10T00:00:00.000Z',
      accountId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      worker: { name: 'example-worker', url: 'https://example-worker.workers.dev' },
      resources: [],
    });
    expect(manifest).not.toBeNull();
    expect(() => destroyInternals.assertCloudflareAccountContinuity(
      manifest,
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      false,
      'destroy',
    )).toThrow(/target unrelated resources.*Authenticate to the recorded account/is);
  });

  it('requires an exact, matching account proof for untracked cleanup', () => {
    const accountId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    expect(destroyInternals.resolveUntrackedDestroyAccountId(undefined, accountId)).toBe(accountId);
    expect(destroyInternals.resolveUntrackedDestroyAccountId(accountId.toUpperCase(), accountId))
      .toBe(accountId.toUpperCase());
    expect(destroyInternals.resolveUntrackedDestroyAccountId(undefined, 'local')).toBeUndefined();
    expect(() => destroyInternals.resolveUntrackedDestroyAccountId('abc123', accountId))
      .toThrow(/exact 32-hex/i);
    expect(() => destroyInternals.resolveUntrackedDestroyAccountId(
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      accountId,
    )).toThrow(/does not match.*wrangler\.toml/i);
  });

  it('never turns a missing manifest into a destroy no-op without acknowledgement', () => {
    expect(() => destroyInternals.assertDestroyManifestAuthority(
      null,
      false,
      '/synthetic/.edgebase/cloudflare-deploy-manifest.json',
    )).toThrow(/requires a trusted Cloudflare deploy manifest/i);
    expect(() => destroyInternals.assertDestroyManifestAuthority(
      null,
      true,
      '/synthetic/.edgebase/cloudflare-deploy-manifest.json',
    )).not.toThrow();
  });

  it('percent-encodes Cloudflare resource ids in deletion API paths', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const accountId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    await destroyInternals.deleteD1Database(
      accountId,
      'synthetic-token',
      'db/../escape?#',
    );
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/db%2F..%2Fescape%3F%23`,
    );

    await destroyInternals.deleteTurnstileWidget(
      accountId,
      'synthetic-token',
      {
        type: 'turnstile_widget',
        name: 'synthetic-widget',
        id: 'synthetic-widget',
        managed: true,
        source: 'created',
        metadata: { siteKey: 'site/key?#' },
      },
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/challenges/widgets/site%2Fkey%3F%23`,
    );
  });
});

describe('destroy Worker URL authority', () => {
  const manifest = {
    version: 2 as const,
    deployedAt: '2026-03-10T00:00:00.000Z',
    accountId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    worker: {
      name: 'example-worker',
      url: 'https://example-worker.owner.workers.dev',
    },
    resources: [],
  };

  it('uses the manifest URL and rejects a mismatched explicit target by default', () => {
    expect(destroyInternals.resolveDestroyWorkerUrl(manifest, {})).toBe(
      'https://example-worker.owner.workers.dev',
    );
    expect(() => destroyInternals.resolveDestroyWorkerUrl(manifest, {
      url: 'https://unrelated-worker.owner.workers.dev',
    })).toThrow(/does not match the deploy manifest/);
  });

  it('requires a separate acknowledgement when the manifest has no proven URL', () => {
    const withoutUrl = { ...manifest, worker: { ...manifest.worker, url: '' } };
    expect(() => destroyInternals.resolveDestroyWorkerUrl(withoutUrl, {
      url: 'https://example-worker.custom.example',
    })).toThrow(/no proven Worker URL/);
    expect(destroyInternals.resolveDestroyWorkerUrl(withoutUrl, {
      url: 'https://example-worker.custom.example/',
      allowWorkerUrlOverride: true,
    })).toBe('https://example-worker.custom.example');
  });
});

describe('mergeDestroyResources', () => {
  it('treats Cloudflare "could not be found" responses as already deleted', () => {
    expect(
      destroyInternals.isAlreadyDeletedError('A request to the Cloudflare API failed: could not be found'),
    ).toBe(true);
  });

  it('detects non-empty R2 bucket deletion conflicts', () => {
    expect(
      destroyInternals.isR2BucketNotEmptyError('The bucket you tried to delete (storage) is not empty [code: 10008]'),
    ).toBe(true);
  });

  it('preserves unmanaged R2 buckets recorded in the manifest', () => {
    const resources = destroyInternals.mergeDestroyResources(
      {
        version: 2,
        deployedAt: '2026-03-10T00:00:00.000Z',
        accountId: 'abc123',
        worker: { name: 'example-worker', url: 'https://example-worker.workers.dev' },
        resources: [
          {
            type: 'r2_bucket',
            name: 'example-worker-storage',
            binding: 'STORAGE',
            id: 'example-worker-storage',
            managed: false,
            source: 'existing',
          },
        ],
      },
      `
name = "example-worker"

[[r2_buckets]]
binding = "STORAGE"
bucket_name = "example-worker-storage"
`,
    );

    expect(resources).toContainEqual({
      type: 'r2_bucket',
      name: 'example-worker-storage',
      binding: 'STORAGE',
      id: 'example-worker-storage',
      managed: false,
      source: 'existing',
      metadata: {},
    });
  });

  it('merges vectorize indexes from wrangler.toml only with explicit untracked-resource acknowledgement', () => {
    const resources = destroyInternals.mergeDestroyResources(
      {
        version: 2,
        deployedAt: '2026-03-10T00:00:00.000Z',
        accountId: 'abc123',
        worker: { name: 'example-worker', url: 'https://example-worker.workers.dev' },
        resources: [],
      },
      `
name = "example-worker"

[[vectorize]]
binding = "VECTORIZE_EMBEDDINGS"
index_name = "edgebase-embeddings"
      `,
      true,
    );

    expect(resources).toContainEqual({
      type: 'vectorize',
      name: 'edgebase-embeddings',
      binding: 'VECTORIZE_EMBEDDINGS',
      id: 'edgebase-embeddings',
      managed: true,
      source: 'wrangler',
    });
  });

  it('merges hyperdrive configs from wrangler.toml only with explicit untracked-resource acknowledgement', () => {
    const resources = destroyInternals.mergeDestroyResources(
      {
        version: 2,
        deployedAt: '2026-03-10T00:00:00.000Z',
        accountId: 'abc123',
        worker: { name: 'example-worker', url: 'https://example-worker.workers.dev' },
        resources: [],
      },
      `
name = "example-worker"

[[hyperdrive]]
binding = "DB_POSTGRES"
id = "hd-abc123"
      `,
      true,
    );

    expect(resources).toContainEqual({
      type: 'hyperdrive',
      name: 'DB_POSTGRES',
      binding: 'DB_POSTGRES',
      id: 'hd-abc123',
      managed: true,
      source: 'wrangler',
    });
  });

  it('skips vectorize/hyperdrive from wrangler when manifest already tracks them', () => {
    const resources = destroyInternals.mergeDestroyResources(
      {
        version: 2,
        deployedAt: '2026-03-10T00:00:00.000Z',
        accountId: 'abc123',
        worker: { name: 'example-worker', url: 'https://example-worker.workers.dev' },
        resources: [
          { type: 'vectorize', name: 'edgebase-embeddings', binding: 'VECTORIZE_EMBEDDINGS', id: 'edgebase-embeddings', managed: true, source: 'created' },
          { type: 'hyperdrive', name: 'DB_POSTGRES', binding: 'DB_POSTGRES', id: 'hd-abc123', managed: true, source: 'created' },
        ],
      },
      `
name = "example-worker"

[[vectorize]]
binding = "VECTORIZE_EMBEDDINGS"
index_name = "edgebase-embeddings"

[[hyperdrive]]
binding = "DB_POSTGRES"
id = "hd-abc123"
`,
    );

    const vecResources = resources.filter((r) => r.type === 'vectorize');
    const hdResources = resources.filter((r) => r.type === 'hyperdrive');
    expect(vecResources).toHaveLength(1);
    expect(hdResources).toHaveLength(1);
    expect(vecResources[0]?.source).toBe('created');
    expect(hdResources[0]?.source).toBe('created');
  });

  it('normalizes wrangler placeholder D1 and KV identifiers', () => {
    const resources = destroyInternals.mergeDestroyResources(
      {
        version: 2,
        deployedAt: '2026-03-10T00:00:00.000Z',
        accountId: 'abc123',
        worker: { name: 'example-worker', url: 'https://example-worker.workers.dev' },
        resources: [],
      },
      `
name = "example-worker"

[[kv_namespaces]]
binding = "KV"
id = "local"

[[d1_databases]]
binding = "AUTH_DB"
database_name = "edgebase-auth"
database_id = "local"
      `,
      true,
    );

    expect(resources).toContainEqual({
      type: 'kv_namespace',
      name: 'internal',
      binding: 'KV',
      id: undefined,
      managed: true,
      source: 'wrangler',
    });
    expect(resources).toContainEqual({
      type: 'd1_database',
      name: 'auth',
      binding: 'AUTH_DB',
      id: undefined,
      managed: true,
      source: 'wrangler',
    });
  });

  it('never grants delete authority to wrangler-only resources by default', () => {
    const resources = destroyInternals.mergeDestroyResources(
      {
        version: 2,
        deployedAt: '2026-03-10T00:00:00.000Z',
        accountId: 'abc123',
        worker: { name: 'example-worker', url: 'https://example-worker.workers.dev' },
        resources: [],
      },
      `
name = "example-worker"
[[r2_buckets]]
binding = "STORAGE"
bucket_name = "manual-storage"
[[kv_namespaces]]
binding = "KV"
id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
`,
    );

    expect(resources).toEqual([]);
  });

  it('rejects option-like and path-like wrangler identifiers during untracked recovery', () => {
    const baseManifest = {
      version: 2 as const,
      deployedAt: '2026-03-10T00:00:00.000Z',
      accountId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      worker: { name: 'example-worker', url: 'https://example-worker.owner.workers.dev' },
      resources: [],
    };
    for (const config of [
      `[[r2_buckets]]\nbinding = "STORAGE"\nbucket_name = "--force"`,
      `[[d1_databases]]\nbinding = "AUTH_DB"\ndatabase_name = "../other"\ndatabase_id = "local"`,
      `[[kv_namespaces]]\nbinding = "KV"\nid = "namespace/other"`,
      `[[vectorize]]\nbinding = "VECTOR"\nindex_name = "--all"`,
      `[[hyperdrive]]\nbinding = "DB"\nid = "config/other"`,
    ]) {
      expect(() => destroyInternals.mergeDestroyResources(baseManifest, config, true))
        .toThrow(/unsafe/i);
    }
  });

  it('does not duplicate or promote an unmanaged R2 record that omitted a legacy id', () => {
    const resources = destroyInternals.mergeDestroyResources(
      {
        version: 2,
        deployedAt: '2026-03-10T00:00:00.000Z',
        accountId: 'abc123',
        worker: { name: 'example-worker', url: 'https://example-worker.workers.dev' },
        resources: [{
          type: 'r2_bucket',
          name: 'example-worker-storage',
          binding: 'STORAGE',
          managed: false,
          source: 'existing',
        }],
      },
      `
name = "example-worker"
[[r2_buckets]]
binding = "STORAGE"
bucket_name = "example-worker-storage"
`,
    );

    expect(resources).toHaveLength(1);
    expect(resources[0]).toMatchObject({
      name: 'example-worker-storage',
      managed: false,
      source: 'existing',
    });
  });

  it('keeps v1 ownership untrusted unless legacy cleanup is explicitly acknowledged', () => {
    const legacy = normalizeCloudflareDeployManifest({
      version: 1,
      accountId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      worker: { name: 'example-worker', url: 'https://example-worker.workers.dev' },
      resources: [{
        type: 'r2_bucket',
        name: 'legacy-storage',
        binding: 'STORAGE',
        id: 'legacy-storage',
      }],
    });
    expect(legacy).not.toBeNull();
    expect(destroyInternals.mergeDestroyResources(legacy, null)[0]?.managed).toBe(false);
    expect(destroyInternals.mergeDestroyResources(legacy, null, true)[0]?.managed).toBe(true);
  });
});
