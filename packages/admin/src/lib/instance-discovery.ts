export interface InstanceDiscoveryMeta {
  source: 'manual' | 'table' | 'function';
  targetLabel?: string;
  placeholder?: string;
  helperText?: string;
}

export interface InstanceDiscoveryItem {
  id: string;
  label?: string;
  description?: string;
}

interface StoredInstanceHistory {
  [namespace: string]: Array<{
    id: string;
    label?: string;
    description?: string;
    lastUsedAt: number;
  }>;
}

const STORAGE_KEY = 'edgebase_admin_recent_instances';
const MAX_RECENT_PER_NAMESPACE = 6;

function readStore(): StoredInstanceHistory {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredInstanceHistory;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(next: StoredInstanceHistory): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage write failures in the dashboard.
  }
}

function normalizeItem(item: InstanceDiscoveryItem): InstanceDiscoveryItem | null {
  const id = item.id.trim();
  if (!id) return null;
  return {
    id,
    label: item.label?.trim() || undefined,
    description: item.description?.trim() || undefined,
  };
}

export function getRecentInstances(namespace: string): InstanceDiscoveryItem[] {
  const store = readStore();
  const items = store[namespace] ?? [];
  return items
    .slice()
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    .map(({ id, label, description }) => ({ id, label, description }));
}

export function rememberRecentInstance(namespace: string, item: InstanceDiscoveryItem): void {
  const normalized = normalizeItem(item);
  if (!normalized) return;

  const store = readStore();
  const current = store[namespace] ?? [];
  const next = [
    {
      ...normalized,
      lastUsedAt: Date.now(),
    },
    ...current.filter((entry) => entry.id !== normalized.id),
  ].slice(0, MAX_RECENT_PER_NAMESPACE);

  writeStore({
    ...store,
    [namespace]: next,
  });
}
