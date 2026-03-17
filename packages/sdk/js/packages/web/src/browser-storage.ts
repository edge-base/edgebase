export interface BrowserStorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isBrowserStorageAdapter(value: unknown): value is BrowserStorageAdapter {
  return Boolean(value)
    && typeof (value as BrowserStorageAdapter).getItem === 'function'
    && typeof (value as BrowserStorageAdapter).setItem === 'function'
    && typeof (value as BrowserStorageAdapter).removeItem === 'function';
}

function resolveBrowserStorageCandidate(): unknown {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const globalStorage = (globalThis as { localStorage?: unknown }).localStorage;
    if (isBrowserStorageAdapter(globalStorage)) {
      return globalStorage;
    }
  } catch {
    return null;
  }

  try {
    return (window as Window & { localStorage?: unknown }).localStorage;
  } catch {
    return null;
  }
}

function createMemoryStorage(): BrowserStorageAdapter {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

export function createBrowserStorage(): BrowserStorageAdapter {
  const candidate = resolveBrowserStorageCandidate();
  return isBrowserStorageAdapter(candidate) ? candidate : createMemoryStorage();
}
