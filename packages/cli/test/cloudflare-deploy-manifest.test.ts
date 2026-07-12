import {
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getCloudflareDeployManifestPath,
  normalizeCloudflareDeployManifest,
  readCloudflareDeployManifest,
  writeCloudflareDeployManifest,
  type CloudflareDeployManifest,
} from '../src/lib/cloudflare-deploy-manifest.js';

let projectDir: string;

function manifest(overrides: Partial<CloudflareDeployManifest> = {}): CloudflareDeployManifest {
  return {
    version: 2,
    deployedAt: '2026-07-12T00:00:00.000Z',
    accountId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    worker: {
      name: 'hanji-worker',
      url: 'https://hanji-worker.owner.workers.dev',
    },
    resources: [{
      type: 'kv_namespace',
      name: 'internal',
      binding: 'KV',
      id: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      managed: true,
      source: 'created',
    }],
    ...overrides,
  };
}

beforeEach(() => {
  projectDir = join(tmpdir(), `edgebase-manifest-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(projectDir, { recursive: true });
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe('Cloudflare deploy manifest trust boundary', () => {
  it('accepts only a regular manifest file and fails closed on a directory', () => {
    const manifestPath = getCloudflareDeployManifestPath(projectDir);
    mkdirSync(manifestPath, { recursive: true });

    expect(() => readCloudflareDeployManifest(projectDir)).toThrow(/manifest is invalid/i);
  });

  it.skipIf(process.platform === 'win32')('fails closed on a dangling manifest symlink', () => {
    const stateDir = join(projectDir, '.edgebase');
    mkdirSync(stateDir, { recursive: true });
    symlinkSync(join(stateDir, 'missing-manifest.json'), getCloudflareDeployManifestPath(projectDir));

    expect(() => readCloudflareDeployManifest(projectDir)).toThrow(/manifest is invalid/i);
  });

  it('normalizes an exact workers.dev origin and downgrades unproven URLs', () => {
    expect(normalizeCloudflareDeployManifest(manifest({
      worker: { name: 'hanji-worker', url: 'https://hanji-worker.owner.workers.dev/' },
    }))?.worker.url).toBe('https://hanji-worker.owner.workers.dev');

    for (const url of [
      'https://other-worker.owner.workers.dev',
      'https://hanji-worker.example.test',
      'http://hanji-worker.owner.workers.dev',
      'https://hanji-worker.owner.workers.dev/path',
    ]) {
      expect(normalizeCloudflareDeployManifest(manifest({
        worker: { name: 'hanji-worker', url },
      }))?.worker.url).toBe('');
    }
  });

  it('requires strict v2 ownership fields and rejects contradictory or unsafe records', () => {
    const base = manifest();
    const resource = base.resources[0]!;
    for (const invalidResource of [
      { ...resource, managed: undefined },
      { ...resource, source: undefined },
      { ...resource, id: undefined },
      { ...resource, binding: undefined },
      { ...resource, managed: true, source: 'manual' },
      { ...resource, managed: false, source: 'created' },
      { ...resource, id: '../other-account' },
      { ...resource, id: 'id%2Fescape' },
      { ...resource, name: 'bucket/name' },
      { ...resource, unexpected: true },
      { ...resource, metadata: { unsafe_key: Number.POSITIVE_INFINITY } },
      { ...resource, metadata: { unsafe_key: 'x'.repeat(8 * 1024 + 1) } },
      { ...resource, metadata: { resourceName: '--force' } },
      { ...resource, metadata: { jurisdiction: '../other' } },
      { ...resource, metadata: { hostnames: 'safe.example.com,*.unsafe.example.com' } },
      { ...resource, metadata: { legacyOwnershipUnverified: false } },
    ]) {
      expect(normalizeCloudflareDeployManifest({
        ...base,
        resources: [invalidResource],
      })).toBeNull();
    }

    expect(normalizeCloudflareDeployManifest({ ...base, accountId: 'abc123' })).toBeNull();
    expect(normalizeCloudflareDeployManifest({ ...base, deployedAt: undefined })).toBeNull();
    expect(normalizeCloudflareDeployManifest({ ...base, unexpected: true })).toBeNull();
    expect(normalizeCloudflareDeployManifest({
      ...base,
      worker: { ...base.worker, unexpected: true },
    })).toBeNull();
    expect(normalizeCloudflareDeployManifest({
      ...base,
      resources: [resource, { ...resource, binding: 'OTHER_KV' }],
    })).toBeNull();
  });

  it('treats exact v1 records as identity-only and rejects v2 ownership fields', () => {
    const legacy = {
      version: 1,
      deployedAt: '2026-01-01T00:00:00.000Z',
      accountId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      worker: { name: 'hanji-worker', url: 'https://hanji-worker.owner.workers.dev' },
      resources: [{
        type: 'r2_bucket',
        name: 'legacy-storage',
        binding: 'STORAGE',
        id: 'legacy-storage',
      }],
    };

    expect(normalizeCloudflareDeployManifest(legacy)?.resources[0]).toMatchObject({
      managed: false,
      source: 'existing',
      metadata: { legacyOwnershipUnverified: true },
    });
    expect(normalizeCloudflareDeployManifest({
      ...legacy,
      resources: [{ ...legacy.resources[0], managed: true, source: 'created' }],
    })).toBeNull();
    expect(normalizeCloudflareDeployManifest({ ...legacy, unexpected: true })).toBeNull();
  });

  it('writes atomically with private permissions and rejects invalid or oversized output', () => {
    const first = manifest();
    const path = writeCloudflareDeployManifest(projectDir, first);
    expect(readCloudflareDeployManifest(projectDir)).toEqual(first);
    if (process.platform !== 'win32') {
      expect(lstatSync(path).mode & 0o077).toBe(0);
    }

    expect(() => writeCloudflareDeployManifest(projectDir, {
      ...first,
      accountId: 'invalid',
    })).toThrow(/invalid Cloudflare deploy manifest/i);
    expect(readCloudflareDeployManifest(projectDir)).toEqual(first);

    const oversized = manifest({
      resources: Array.from({ length: 1_800 }, (_, index) => ({
        type: 'kv_namespace' as const,
        name: `resource-${index}`,
        binding: `KV_${index}`,
        id: `resource-${index}`,
        managed: true,
        source: 'created' as const,
        metadata: { hostnames: Array(10).fill('x'.repeat(253)).join(',') },
      })),
    });
    expect(() => writeCloudflareDeployManifest(projectDir, oversized)).toThrow(/larger than/i);
    expect(readCloudflareDeployManifest(projectDir)).toEqual(first);
    expect(readFileSync(path, 'utf8')).toContain('hanji-worker');
  });

  it('does not treat an oversized on-disk file as a missing manifest', () => {
    const manifestPath = getCloudflareDeployManifestPath(projectDir);
    mkdirSync(join(projectDir, '.edgebase'), { recursive: true });
    writeFileSync(manifestPath, ' '.repeat(4 * 1024 * 1024 + 1));

    expect(() => readCloudflareDeployManifest(projectDir)).toThrow(/manifest is invalid/i);
  });
});
