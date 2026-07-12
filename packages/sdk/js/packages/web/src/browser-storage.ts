export interface BrowserStorageAdapter {
  /** Whether values survive a navigation/reload and are shared with peer tabs. */
  readonly isPersistent: boolean;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  /** Enumerate keys visible to this storage area. */
  keys(): string[];
}

interface BrowserStorageLike {
  readonly length?: number;
  key?(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isBrowserStorageLike(value: unknown): value is BrowserStorageLike {
  return Boolean(value)
    && typeof (value as BrowserStorageLike).getItem === 'function'
    && typeof (value as BrowserStorageLike).setItem === 'function'
    && typeof (value as BrowserStorageLike).removeItem === 'function';
}

function resolveBrowserStorageCandidate(): unknown {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const globalStorage = (globalThis as { localStorage?: unknown }).localStorage;
    if (isBrowserStorageLike(globalStorage)) {
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
    isPersistent: false,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    keys: () => [...store.keys()],
  };
}

function createPersistentStorage(candidate: BrowserStorageLike): BrowserStorageAdapter | null {
  const knownKeys = new Set<string>();
  const probeKey = `edgebase:storage-probe:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
  const probeValue = '1';
  try {
    candidate.setItem(probeKey, probeValue);
    if (candidate.getItem(probeKey) !== probeValue) {
      candidate.removeItem(probeKey);
      return null;
    }
    candidate.removeItem(probeKey);
    return {
      isPersistent: true,
      getItem: (key) => {
        const value = candidate.getItem(key);
        if (value !== null) knownKeys.add(key);
        return value;
      },
      setItem: (key, value) => {
        candidate.setItem(key, value);
        knownKeys.add(key);
      },
      removeItem: (key) => {
        candidate.removeItem(key);
        knownKeys.delete(key);
      },
      keys: () => {
        if (typeof candidate.length === 'number' && typeof candidate.key === 'function') {
          const result: string[] = [];
          for (let index = 0; index < candidate.length; index += 1) {
            const key = candidate.key(index);
            if (key !== null) result.push(key);
          }
          return result;
        }
        // Minimal storage mocks do not always implement the Storage key/length
        // surface. Exact-key OAuth consume remains safe; keep same-adapter
        // discovery useful without reintroducing a shared registry write.
        return [...knownKeys];
      },
    };
  } catch {
    try {
      candidate.removeItem(probeKey);
    } catch {
      // The candidate is unusable; the in-memory fallback below remains safe.
    }
    return null;
  }
}

export function createBrowserStorage(): BrowserStorageAdapter {
  const candidate = resolveBrowserStorageCandidate();
  if (isBrowserStorageLike(candidate)) {
    const persistent = createPersistentStorage(candidate);
    if (persistent) return persistent;
  }
  return createMemoryStorage();
}
