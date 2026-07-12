import { createHash } from 'node:crypto';

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
  return buildManagedWorkerResourceName(workerName, 'd1', resourceName);
}

export function buildManagedWorkerName(workerName: string): string {
  const normalized = normalizeManagedName(workerName, 'edgebase');
  if (normalized.length <= 55) return normalized;

  const digest = createHash('sha256').update(workerName).digest('hex').slice(0, 16);
  const prefix = normalized.slice(0, 38).replace(/-+$/g, '') || 'edgebase';
  return `${prefix}-${digest}`;
}

export function buildManagedR2BucketName(workerName: string, resourceName = 'storage'): string {
  return buildManagedWorkerResourceName(workerName, 'r2', resourceName);
}

/**
 * Build an account-global Cloudflare resource name that is deterministic for
 * one Worker while remaining isolated from every other Worker in the account.
 * The identity hash is always present so normalization/truncation cannot make
 * distinct Worker or logical names collide.
 */
export function buildManagedWorkerResourceName(
  workerName: string,
  resourceType: string,
  resourceName: string,
  maxLength = 63,
): string {
  // The shortest valid form is one readable character, a separator, and the
  // fixed 16-hex identity digest. Accepting 16 or 17 would silently return a
  // value longer than the caller's declared provider limit.
  if (!Number.isSafeInteger(maxLength) || maxLength < 18) {
    throw new Error('Managed Cloudflare resource names require a maximum length of at least 18.');
  }

  const identity = JSON.stringify([workerName, resourceType, resourceName]);
  const digest = createHash('sha256').update(identity).digest('hex').slice(0, 16);
  const readable = normalizeManagedName(
    `edgebase-${workerName}-${resourceType}-${resourceName}`,
    'edgebase-resource',
  );
  const prefixLength = maxLength - digest.length - 1;
  const prefix = readable.slice(0, prefixLength).replace(/-+$/g, '') || 'edgebase';
  return `${prefix}-${digest}`;
}

export function buildLegacyManagedD1DatabaseName(resourceName: string): string {
  return `edgebase-${normalizeManagedName(resourceName, 'database')}`;
}

export function buildLegacyWorkerScopedD1DatabaseName(
  workerName: string,
  resourceName: string,
): string {
  return buildManagedCompositeName(workerName, resourceName, 63, 'edgebase', 'database');
}

export function buildLegacyManagedR2BucketName(
  workerName: string,
  resourceName = 'storage',
): string {
  return buildManagedCompositeName(workerName, resourceName, 63, 'edgebase', 'storage');
}
