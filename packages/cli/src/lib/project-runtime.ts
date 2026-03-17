import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseWranglerResourceConfig, type WranglerResourceConfig } from './cloudflare-wrangler-resources.js';
import { extractDatabases } from './deploy-shared.js';
import { buildManagedD1DatabaseName } from './managed-resource-names.js';

const GENERIC_PROJECT_DIR_NAMES = new Set(['edgebase', 'server', 'backend', 'api', 'worker']);

interface ManagedDbBlockMeta {
  provider?: string;
  instance?: boolean;
  access?: { canCreate?: unknown; access?: unknown };
}

export interface ManagedD1BindingDescriptor {
  binding: string;
  resourceName: string;
  kind: 'internal' | 'database';
  namespace?: string;
}

export interface LocalDevBinding {
  type: 'd1_database';
  name: string;
  binding: string;
  id: string;
}

export interface ProjectWranglerContext {
  path: string | null;
  dir: string;
  config: WranglerResourceConfig | null;
}

export const INTERNAL_D1_BINDINGS = [
  { name: 'auth', binding: 'AUTH_DB' },
  { name: 'control', binding: 'CONTROL_DB' },
] as const;

export function deriveProjectSlug(projectDir: string): string {
  const normalizedProjectName = sanitizeNameSegment(resolve(projectDir).split(/[\\/]/).pop() ?? '');
  if (!normalizedProjectName) return 'edgebase';

  if (!GENERIC_PROJECT_DIR_NAMES.has(normalizedProjectName)) {
    return normalizedProjectName;
  }

  const normalizedParentName = sanitizeNameSegment(
    resolve(projectDir, '..').split(/[\\/]/).pop() ?? '',
  );
  if (normalizedParentName && normalizedParentName !== normalizedProjectName) {
    return `${normalizedParentName}-${normalizedProjectName}`;
  }

  return normalizedProjectName;
}

export function resolveProjectWranglerPath(projectDir: string): string | null {
  const normalizedProjectDir = resolve(projectDir);
  const directPath = join(normalizedProjectDir, 'wrangler.toml');
  if (existsSync(directPath)) return directPath;

  const monorepoServerPath = join(normalizedProjectDir, 'packages', 'server', 'wrangler.toml');
  if (existsSync(monorepoServerPath)) return monorepoServerPath;

  return null;
}

export function readProjectWranglerContext(projectDir: string): ProjectWranglerContext {
  const wranglerPath = resolveProjectWranglerPath(projectDir);
  if (!wranglerPath) {
    return {
      path: null,
      dir: resolve(projectDir),
      config: null,
    };
  }

  return {
    path: wranglerPath,
    dir: dirname(wranglerPath),
    config: parseWranglerResourceConfig(readFileSync(wranglerPath, 'utf-8')),
  };
}

export function resolveProjectWorkerName(
  projectDir: string,
  options?: { fallbackToProjectSlug?: boolean },
): string {
  const { config } = readProjectWranglerContext(projectDir);
  if (config?.workerName) return config.workerName;
  return options?.fallbackToProjectSlug ? deriveProjectSlug(projectDir) : '';
}

export function resolveProjectWorkerUrl(
  projectDir: string,
  options?: { fallbackToProjectSlug?: boolean },
): string {
  const workerName = resolveProjectWorkerName(projectDir, options);
  return workerName ? `https://${workerName}.workers.dev` : '';
}

export function resolveManagedD1BindingDescriptors(
  config?: Record<string, unknown>,
): ManagedD1BindingDescriptor[] {
  const descriptors: ManagedD1BindingDescriptor[] = INTERNAL_D1_BINDINGS.map(({ name, binding }) => ({
    binding,
    resourceName: name,
    kind: 'internal',
  }));

  const databases = extractDatabases(config ?? {});
  if (!databases) return descriptors;

  for (const [namespace, dbBlock] of Object.entries(databases)) {
    const meta = dbBlock as ManagedDbBlockMeta | null | undefined;
    if (!meta) continue;

    const provider = meta.provider;
    if (provider === 'neon' || provider === 'postgres' || provider === 'do') continue;
    if (provider !== 'd1' && isDynamicManagedDbBlock(meta)) continue;

    descriptors.push({
      binding: `DB_D1_${namespace.toUpperCase()}`,
      resourceName: `db-${namespace}`,
      kind: 'database',
      namespace,
    });
  }

  return descriptors;
}

export function resolveLocalDevBindings(config?: Record<string, unknown>): LocalDevBinding[] {
  return resolveManagedD1BindingDescriptors(config).map((descriptor) => ({
    type: 'd1_database',
    name: descriptor.resourceName,
    binding: descriptor.binding,
    id: 'local',
  }));
}

export function resolveManagedD1DatabaseName(
  projectDir: string,
  binding: string,
  config?: Record<string, unknown>,
): string | null {
  const { config: wranglerConfig } = readProjectWranglerContext(projectDir);
  const configuredDatabase = wranglerConfig?.d1Databases.find((database) => database.binding === binding);
  if (configuredDatabase?.databaseName) {
    return configuredDatabase.databaseName;
  }

  const descriptor = resolveManagedD1BindingDescriptors(config).find((entry) => entry.binding === binding);
  if (!descriptor) return null;

  const workerName = wranglerConfig?.workerName || deriveProjectSlug(projectDir);
  return buildManagedD1DatabaseName(workerName, descriptor.resourceName);
}

function isDynamicManagedDbBlock(dbBlock: ManagedDbBlockMeta): boolean {
  if (dbBlock.instance) return true;
  if (dbBlock.access && typeof dbBlock.access === 'object') return true;
  return false;
}

function sanitizeNameSegment(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!normalized) return '';
  return /^[a-z]/.test(normalized) ? normalized : `edgebase-${normalized}`;
}
