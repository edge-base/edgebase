import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type CloudflareResourceType =
  | 'kv_namespace'
  | 'd1_database'
  | 'vectorize'
  | 'hyperdrive'
  | 'r2_bucket'
  | 'turnstile_widget';

export interface CloudflareResourceRecord {
  type: CloudflareResourceType;
  name: string;
  binding?: string;
  id?: string;
  managed?: boolean;
  source?: 'created' | 'existing' | 'wrangler' | 'manual';
  metadata?: Record<string, string | number | boolean | null>;
}

export interface CloudflareDeployManifest {
  version: 2;
  deployedAt: string;
  accountId: string;
  worker: {
    name: string;
    url: string;
  };
  resources: CloudflareResourceRecord[];
}

interface LegacyProvisionedBinding {
  type?: unknown;
  name?: unknown;
  binding?: unknown;
  id?: unknown;
}

interface LegacyCloudflareDeployManifest {
  version?: unknown;
  deployedAt?: unknown;
  accountId?: unknown;
  worker?: {
    name?: unknown;
    url?: unknown;
  };
  resources?: unknown;
}

function isResourceType(value: unknown): value is CloudflareResourceType {
  return value === 'kv_namespace'
    || value === 'd1_database'
    || value === 'vectorize'
    || value === 'hyperdrive'
    || value === 'r2_bucket'
    || value === 'turnstile_widget';
}

function normalizeResourceRecord(value: unknown): CloudflareResourceRecord | null {
  if (!value || typeof value !== 'object') return null;

  const resource = value as Record<string, unknown>;
  if (!isResourceType(resource.type) || typeof resource.name !== 'string') return null;

  const metadata =
    resource.metadata && typeof resource.metadata === 'object' && !Array.isArray(resource.metadata)
      ? Object.fromEntries(
          Object.entries(resource.metadata).filter(([, entry]) =>
            entry === null
            || typeof entry === 'string'
            || typeof entry === 'number'
            || typeof entry === 'boolean',
          ),
        )
      : undefined;

  return {
    type: resource.type,
    name: resource.name,
    binding: typeof resource.binding === 'string' ? resource.binding : undefined,
    id: typeof resource.id === 'string' ? resource.id : undefined,
    managed: typeof resource.managed === 'boolean' ? resource.managed : true,
    source:
      resource.source === 'created'
      || resource.source === 'existing'
      || resource.source === 'wrangler'
      || resource.source === 'manual'
        ? resource.source
        : undefined,
    metadata,
  };
}

function normalizeLegacyResource(value: LegacyProvisionedBinding): CloudflareResourceRecord | null {
  if (!isResourceType(value.type) || typeof value.name !== 'string') return null;

  return {
    type: value.type,
    name: value.name,
    binding: typeof value.binding === 'string' ? value.binding : undefined,
    id: typeof value.id === 'string' ? value.id : undefined,
    managed: true,
    source: 'existing',
  };
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function normalizeCloudflareDeployManifest(
  raw: unknown,
): CloudflareDeployManifest | null {
  if (!isStringRecord(raw)) return null;

  const worker = isStringRecord(raw.worker) ? raw.worker : {};
  const resourcesRaw = Array.isArray(raw.resources) ? raw.resources : [];
  const resources =
    raw.version === 1
      ? resourcesRaw
          .map((entry) => normalizeLegacyResource(entry as LegacyProvisionedBinding))
          .filter((entry): entry is CloudflareResourceRecord => entry !== null)
      : resourcesRaw
          .map((entry) => normalizeResourceRecord(entry))
          .filter((entry): entry is CloudflareResourceRecord => entry !== null);

  if (typeof raw.accountId !== 'string') return null;

  return {
    version: 2,
    deployedAt: typeof raw.deployedAt === 'string' ? raw.deployedAt : new Date(0).toISOString(),
    accountId: raw.accountId,
    worker: {
      name: typeof worker.name === 'string' ? worker.name : '',
      url: typeof worker.url === 'string' ? worker.url : '',
    },
    resources,
  };
}

export function getCloudflareDeployManifestPath(projectDir: string): string {
  return join(projectDir, '.edgebase', 'cloudflare-deploy-manifest.json');
}

export function readCloudflareDeployManifest(projectDir: string): CloudflareDeployManifest | null {
  const manifestPath = getCloudflareDeployManifestPath(projectDir);
  if (!existsSync(manifestPath)) return null;

  try {
    const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as LegacyCloudflareDeployManifest;
    return normalizeCloudflareDeployManifest(raw);
  } catch {
    return null;
  }
}

export function writeCloudflareDeployManifest(
  projectDir: string,
  manifest: CloudflareDeployManifest,
): string {
  const manifestPath = getCloudflareDeployManifestPath(projectDir);
  mkdirSync(join(projectDir, '.edgebase'), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  return manifestPath;
}

export function findCloudflareResourceRecord(
  manifest: CloudflareDeployManifest | null,
  candidate: Pick<CloudflareResourceRecord, 'type' | 'name' | 'binding' | 'id'>,
): CloudflareResourceRecord | null {
  if (!manifest) return null;

  return (
    manifest.resources.find((resource) =>
      resource.type === candidate.type
      && (
        (!!candidate.id && resource.id === candidate.id)
        || (!!candidate.binding && !!resource.binding && resource.binding === candidate.binding)
        || resource.name === candidate.name
      ),
    ) ?? null
  );
}
