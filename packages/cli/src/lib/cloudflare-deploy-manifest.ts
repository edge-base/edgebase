import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
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

const MAX_CLOUDFLARE_DEPLOY_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_CLOUDFLARE_DEPLOY_MANIFEST_RESOURCES = 10_000;
const MAX_CLOUDFLARE_DEPLOY_METADATA_STRING_BYTES = 8 * 1024;

function hasOnlyOwnKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function boundedTrimmedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}

function isCloudflareSafeManifestIdentifier(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
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
  if (!hasOnlyOwnKeys(resource, [
    'type',
    'name',
    'binding',
    'id',
    'managed',
    'source',
    'metadata',
  ])) return null;
  const name = boundedTrimmedString(resource.name, 512);
  if (!isResourceType(resource.type) || !name) return null;
  const binding = resource.binding === undefined
    ? undefined
    : boundedTrimmedString(resource.binding, 128);
  const id = resource.id === undefined ? undefined : boundedTrimmedString(resource.id, 512);
  if (
    binding === null
    || id === null
    || !isCloudflareSafeManifestIdentifier(name)
    || (binding !== undefined && !/^[A-Za-z][A-Za-z0-9_]*$/.test(binding))
    || (id !== undefined && !isCloudflareSafeManifestIdentifier(id))
  ) return null;
  if (typeof resource.managed !== 'boolean') return null;
  if (
    resource.source !== 'created'
    && resource.source !== 'existing'
    && resource.source !== 'wrangler'
    && resource.source !== 'manual'
  ) return null;
  if (resource.source === 'manual' && resource.managed !== false) return null;
  if (resource.source === 'created' && resource.managed !== true) return null;
  if (
    resource.metadata !== undefined
    && (
      !resource.metadata
      || typeof resource.metadata !== 'object'
      || Array.isArray(resource.metadata)
    )
  ) return null;

  const metadataEntries = Object.entries(resource.metadata ?? {});
  const allowedMetadataKeys = new Set([
    'resourceName',
    'jurisdiction',
    'siteKey',
    'hostnames',
    'legacyOwnershipUnverified',
  ]);
  if (
    metadataEntries.length > 128
    || metadataEntries.some(([key, entry]) =>
      key.length === 0
      || key.length > 256
      || !/^[A-Za-z][A-Za-z0-9_]*$/.test(key)
      || !allowedMetadataKeys.has(key)
      || !(
        entry === null
        || (
          typeof entry === 'string'
          && Buffer.byteLength(entry, 'utf8') <= MAX_CLOUDFLARE_DEPLOY_METADATA_STRING_BYTES
        )
        || (typeof entry === 'number' && Number.isFinite(entry))
        || typeof entry === 'boolean'
      ),
    )
  ) return null;
  const siteKey = (resource.metadata as Record<string, unknown> | undefined)?.siteKey;
  if (
    siteKey !== undefined
    && (
      typeof siteKey !== 'string'
      || siteKey.length === 0
      || siteKey.length > 256
      || !isCloudflareSafeManifestIdentifier(siteKey)
    )
  ) return null;
  for (const key of ['resourceName', 'jurisdiction'] as const) {
    const identifier = (resource.metadata as Record<string, unknown> | undefined)?.[key];
    if (
      identifier !== undefined
      && (typeof identifier !== 'string' || !isCloudflareSafeManifestIdentifier(identifier))
    ) return null;
  }
  const hostnames = (resource.metadata as Record<string, unknown> | undefined)?.hostnames;
  if (hostnames !== undefined) {
    if (typeof hostnames !== 'string') return null;
    const entries = hostnames.split(',');
    if (
      entries.length === 0
      || entries.length > 10
      || entries.some((hostname) =>
        hostname.length === 0
        || hostname.length > 253
        || !/^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(hostname)
      )
    ) return null;
  }
  const legacyOwnershipUnverified = (
    resource.metadata as Record<string, unknown> | undefined
  )?.legacyOwnershipUnverified;
  if (
    legacyOwnershipUnverified !== undefined
    && legacyOwnershipUnverified !== true
  ) return null;
  const metadata = metadataEntries.length ? Object.fromEntries(metadataEntries) : undefined;

  return {
    type: resource.type,
    name,
    binding,
    id,
    managed: resource.managed,
    source: resource.source,
    metadata,
  };
}

function normalizeLegacyResource(value: LegacyProvisionedBinding): CloudflareResourceRecord | null {
  const record = value as LegacyProvisionedBinding & Record<string, unknown>;
  if (!hasOnlyOwnKeys(record, ['type', 'name', 'binding', 'id'])) return null;
  const name = boundedTrimmedString(value.name, 512);
  const binding = value.binding === undefined ? undefined : boundedTrimmedString(value.binding, 128);
  const id = value.id === undefined ? undefined : boundedTrimmedString(value.id, 512);
  if (
    !isResourceType(value.type)
    || !name
    || binding === null
    || id === null
    || !isCloudflareSafeManifestIdentifier(name)
    || (binding !== undefined && !/^[A-Za-z][A-Za-z0-9_]*$/.test(binding))
    || (id !== undefined && !isCloudflareSafeManifestIdentifier(id))
  ) return null;

  return {
    type: value.type,
    name,
    binding,
    id,
    // A v1 manifest proves identity but did not record whether EdgeBase
    // created the resource. Never turn that absence into delete authority.
    managed: false,
    source: 'existing',
    metadata: { legacyOwnershipUnverified: true },
  };
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Return a Worker URL only when the value proves the exact name-bound
 * workers.dev HTTPS origin. Custom domains and URLs with path/query/auth/port
 * are not sufficient identity authority for bootstrap or destructive flows.
 */
export function normalizeProvenCloudflareWorkerOrigin(
  workerName: string,
  value: unknown,
): string {
  if (typeof value !== 'string' || value.length > 2_048) return '';
  const candidate = value.trim();
  if (!candidate) return '';

  try {
    const parsed = new URL(candidate);
    const hostname = parsed.hostname.toLowerCase();
    if (
      parsed.protocol !== 'https:'
      || parsed.username
      || parsed.password
      || parsed.port
      || parsed.pathname !== '/'
      || parsed.search
      || parsed.hash
      || !hostname.endsWith('.workers.dev')
      || hostname.split('.')[0] !== workerName.trim().toLowerCase()
    ) return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

export function normalizeCloudflareDeployManifest(
  raw: unknown,
): CloudflareDeployManifest | null {
  if (!isStringRecord(raw)) return null;

  if (raw.version !== 1 && raw.version !== 2) return null;
  if (!hasOnlyOwnKeys(raw, ['version', 'deployedAt', 'accountId', 'worker', 'resources'])) return null;
  if (!isStringRecord(raw.worker) || !Array.isArray(raw.resources)) return null;
  if (!hasOnlyOwnKeys(raw.worker, ['name', 'url'])) return null;
  if (raw.resources.length > MAX_CLOUDFLARE_DEPLOY_MANIFEST_RESOURCES) return null;
  const accountId = boundedTrimmedString(raw.accountId, 128);
  const workerName = boundedTrimmedString(raw.worker.name, 255);
  if (
    !accountId
    || !/^[0-9a-f]{32}$/i.test(accountId)
    || !workerName
    || !isCloudflareSafeManifestIdentifier(workerName)
  ) return null;
  if (typeof raw.worker.url !== 'string' || raw.worker.url.length > 2_048) return null;
  // Older manifests could contain an EDGEBASE_URL custom domain. Keep their
  // account/Worker/resource identity proof, but downgrade any URL that is not
  // a name-bound workers.dev origin so it never becomes bootstrap or delete
  // authority without an explicit, separately verified override.
  const workerUrl = normalizeProvenCloudflareWorkerOrigin(workerName, raw.worker.url);
  if (
    raw.deployedAt !== undefined
    && (typeof raw.deployedAt !== 'string' || raw.deployedAt.length > 128)
  ) return null;
  if (
    raw.version === 2
    && (
      typeof raw.deployedAt !== 'string'
      || !Number.isFinite(Date.parse(raw.deployedAt))
      || new Date(raw.deployedAt).toISOString() !== raw.deployedAt
    )
  ) return null;

  const resourcesRaw = raw.resources;
  const resources =
    raw.version === 1
      ? resourcesRaw
          .map((entry) => normalizeLegacyResource(entry as LegacyProvisionedBinding))
          .filter((entry): entry is CloudflareResourceRecord => entry !== null)
      : resourcesRaw
          .map((entry) => normalizeResourceRecord(entry))
          .filter((entry): entry is CloudflareResourceRecord => entry !== null);
  if (resources.length !== resourcesRaw.length) return null;
  const logicalResources = new Set<string>();
  const physicalResources = new Set<string>();
  for (const resource of resources) {
    if (raw.version === 2) {
      if (!resource.id) return null;
      if (resource.type !== 'turnstile_widget' && !resource.binding) return null;
    }
    const logicalName = resource.binding ?? resource.name;
    const key = `${resource.type}:${logicalName}`;
    if (logicalResources.has(key)) return null;
    logicalResources.add(key);
    if (resource.id) {
      const physicalKey = `${resource.type}:${resource.id}`;
      if (physicalResources.has(physicalKey)) return null;
      physicalResources.add(physicalKey);
    }
  }

  return {
    version: 2,
    deployedAt: typeof raw.deployedAt === 'string' ? raw.deployedAt : new Date(0).toISOString(),
    accountId,
    worker: {
      name: workerName,
      url: workerUrl,
    },
    resources,
  };
}

export function getCloudflareDeployManifestPath(projectDir: string): string {
  return join(projectDir, '.edgebase', 'cloudflare-deploy-manifest.json');
}

export function readCloudflareDeployManifest(projectDir: string): CloudflareDeployManifest | null {
  const manifestPath = getCloudflareDeployManifestPath(projectDir);
  let pathStat;
  try {
    pathStat = lstatSync(manifestPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(
      `Cloudflare deploy manifest cannot be inspected at ${manifestPath}. Restore a regular file from backup before continuing.`,
    );
  }

  try {
    if (!pathStat.isFile() || pathStat.isSymbolicLink()) {
      throw new Error('manifest path is not a regular file');
    }
    if (pathStat.size > MAX_CLOUDFLARE_DEPLOY_MANIFEST_BYTES) {
      throw new Error('manifest is too large');
    }
    const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as LegacyCloudflareDeployManifest;
    const manifest = normalizeCloudflareDeployManifest(raw);
    if (manifest) return manifest;
  } catch {
    // Fall through to the same fail-closed recovery guidance as a structurally
    // invalid but syntactically valid manifest.
  }
  throw new Error(
    `Cloudflare deploy manifest is invalid at ${manifestPath}. Restore a valid copy from backup, `
      + 'or remove it only if you intentionally accept a first deploy with no prior Worker or resource identity proof.',
  );
}

export function assertCloudflareAccountContinuity(
  previousManifest: CloudflareDeployManifest | null,
  currentAccountId: string,
  allowAccountChange: boolean,
  operation: 'deploy' | 'destroy' = 'deploy',
): void {
  const previousAccountId = previousManifest?.accountId.trim();
  const currentId = currentAccountId.trim();
  if (
    !previousAccountId
    || previousAccountId.toLowerCase() === currentId.toLowerCase()
    || allowAccountChange
  ) return;

  const guidance = operation === 'destroy'
    ? 'Authenticate to the recorded account before destroying these resources.'
    : 'Select the previous account or intentionally migrate/retire it first, then rerun with --allow-account-change to acknowledge the new isolated account identity.';
  throw new Error(
    `Cloudflare account identity changed from '${previousAccountId}' to '${currentId}'. `
    + 'Using another account creates separate Worker, Durable Object, and managed resource storage and can make existing data appear lost or target unrelated resources. '
    + guidance,
  );
}

export function writeCloudflareDeployManifest(
  projectDir: string,
  manifest: CloudflareDeployManifest,
): string {
  const manifestPath = getCloudflareDeployManifestPath(projectDir);
  mkdirSync(join(projectDir, '.edgebase'), { recursive: true });
  const normalized = normalizeCloudflareDeployManifest(manifest);
  if (!normalized) {
    throw new Error('Refusing to write an invalid Cloudflare deploy manifest.');
  }
  const serialized = JSON.stringify(normalized, null, 2) + '\n';
  if (Buffer.byteLength(serialized, 'utf8') > MAX_CLOUDFLARE_DEPLOY_MANIFEST_BYTES) {
    throw new Error(
      `Refusing to write a Cloudflare deploy manifest larger than ${MAX_CLOUDFLARE_DEPLOY_MANIFEST_BYTES} bytes.`,
    );
  }
  const tempPath = `${manifestPath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(tempPath, serialized, {
      encoding: 'utf-8',
      flag: 'wx',
      mode: 0o600,
    });
    chmodSync(tempPath, 0o600);
    renameSync(tempPath, manifestPath);
    chmodSync(manifestPath, 0o600);
  } finally {
    try {
      unlinkSync(tempPath);
    } catch {
      // Rename succeeded or best-effort cleanup is sufficient.
    }
  }
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
