function normalizeManagedName(value: string, fallback = 'edgebase'): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return normalized || fallback;
}

function trimManagedName(value: string, maxLength: number, fallback = 'edgebase'): string {
  const normalized = normalizeManagedName(value, fallback);
  const trimmed = normalized.slice(0, maxLength).replace(/-+$/g, '');
  return trimmed || fallback.slice(0, maxLength);
}

function buildManagedCompositeName(
  prefix: string,
  suffix: string,
  maxLength: number,
  fallbackPrefix = 'edgebase',
  fallbackSuffix = 'resource',
): string {
  const normalizedSuffix = normalizeManagedName(suffix, fallbackSuffix);
  const reservedLength = normalizedSuffix.length + 1;
  const maxPrefixLength = Math.max(1, maxLength - reservedLength);
  const normalizedPrefix = trimManagedName(prefix, maxPrefixLength, fallbackPrefix);
  return `${normalizedPrefix}-${normalizedSuffix}`;
}

export function extractWranglerWorkerName(content: string): string {
  return content.match(/^name\s*=\s*"([^"]+)"/m)?.[1] ?? '';
}

export function buildManagedD1DatabaseName(workerName: string, resourceName: string): string {
  return buildManagedCompositeName(workerName, resourceName, 63, 'edgebase', 'database');
}

export function buildManagedWorkerName(workerName: string): string {
  return trimManagedName(workerName, 55, 'edgebase');
}

export function buildManagedR2BucketName(workerName: string, resourceName = 'storage'): string {
  return buildManagedCompositeName(workerName, resourceName, 63, 'edgebase', 'storage');
}

export function buildLegacyManagedD1DatabaseName(resourceName: string): string {
  return `edgebase-${normalizeManagedName(resourceName, 'database')}`;
}
