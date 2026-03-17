function normalizeManagedName(value: string, fallback = 'edgebase'): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return normalized || fallback;
}

export function extractWranglerWorkerName(content: string): string {
  return content.match(/^name\s*=\s*"([^"]+)"/m)?.[1] ?? '';
}

export function buildManagedD1DatabaseName(workerName: string, resourceName: string): string {
  return `${normalizeManagedName(workerName)}-${normalizeManagedName(resourceName, 'database')}`;
}

export function buildLegacyManagedD1DatabaseName(resourceName: string): string {
  return `edgebase-${normalizeManagedName(resourceName, 'database')}`;
}
