import { describe, expect, it } from 'vitest';
import {
  normalizeCloudflareDeployManifest,
} from '../src/lib/cloudflare-deploy-manifest.js';
import { parseWranglerResourceConfig } from '../src/lib/cloudflare-wrangler-resources.js';
import { _internals as destroyInternals } from '../src/commands/destroy.js';

describe('parseWranglerResourceConfig', () => {
  it('extracts worker name and R2 bucket metadata', () => {
    const config = parseWranglerResourceConfig(`
name = "room-realtime-suite-edgebase"

[[r2_buckets]]
binding = "STORAGE"
bucket_name = "room-realtime-suite-edgebase-storage"
jurisdiction = "eu"
`);

    expect(config.workerName).toBe('room-realtime-suite-edgebase');
    expect(config.r2Buckets).toEqual([
      {
        binding: 'STORAGE',
        bucketName: 'room-realtime-suite-edgebase-storage',
        jurisdiction: 'eu',
      },
    ]);
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
      accountId: 'abc123',
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
      accountId: 'abc123',
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
          managed: true,
          source: 'existing',
        },
      ],
    });
  });
});

describe('mergeDestroyResources', () => {
  it('promotes wrangler-declared R2 buckets into managed destroy targets', () => {
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
      managed: true,
      source: 'existing',
      metadata: {},
    });
  });

  it('merges vectorize indexes from wrangler.toml when manifest has none', () => {
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

  it('merges hyperdrive configs from wrangler.toml when manifest has none', () => {
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
});
