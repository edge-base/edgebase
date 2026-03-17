/**
 * Schema state store.
 *
 * Fetches the full schema from GET /admin/api/data/schema and provides
 * a derived store that groups tables by namespace.
 */

import { writable, derived, get } from 'svelte/store';
import { api } from '$lib/api';
import type { SchemaField, IndexConfig } from '$lib/constants';
import { buildAdminRecordsPath } from '$lib/database-target';

// ── Types ───────────────────────────────────────────────

export interface TableDef {
  namespace: string;
  /** Database provider after EdgeBase routing rules are applied. */
  provider?: 'do' | 'd1' | 'neon' | 'postgres';
  /** Dynamic namespaces require an instanceId before data access. */
  dynamic?: boolean;
  /** Admin hint for how to discover instance IDs on dynamic namespaces. */
  instanceDiscovery?: {
    source: 'manual' | 'table' | 'function';
    targetLabel?: string;
    placeholder?: string;
    helperText?: string;
  };
  fields: Record<string, SchemaField>;
  indexes?: IndexConfig[];
  fts?: string[];
}

export type Schema = Record<string, TableDef>;

export interface NamespaceDef {
  provider?: 'do' | 'd1' | 'neon' | 'postgres';
  dynamic?: boolean;
  instanceDiscovery?: {
    source: 'manual' | 'table' | 'function';
    targetLabel?: string;
    placeholder?: string;
    helperText?: string;
  };
}

export interface SchemaState {
  schema: Schema;
  namespaces: Record<string, NamespaceDef>;
  loading: boolean;
  error: string | null;
}

// ── Store ───────────────────────────────────────────────

const store = writable<SchemaState>({
  schema: {},
  namespaces: {},
  loading: false,
  error: null,
});

function deriveNamespacesFromSchema(schema: Schema): Record<string, NamespaceDef> {
  const namespaces: Record<string, NamespaceDef> = {};

  for (const table of Object.values(schema)) {
    if (!table.namespace) continue;
    namespaces[table.namespace] = {
      provider: table.provider,
      dynamic: table.dynamic,
      instanceDiscovery: table.instanceDiscovery,
    };
  }

  return namespaces;
}

/**
 * Fetch schema from the server and update the store.
 */
async function loadSchema(options: { silent?: boolean } = {}): Promise<Schema | null> {
  if (!options.silent) {
    store.update((s) => ({ ...s, loading: true, error: null }));
  }

  try {
    const data = await api.fetch<{ schema: Schema; namespaces?: Record<string, NamespaceDef> }>('data/schema');
    store.set({
      schema: data.schema,
      namespaces: data.namespaces ?? deriveNamespacesFromSchema(data.schema),
      loading: false,
      error: null,
    });
    return data.schema;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load schema';
    store.update((s) => ({ ...s, loading: false, error: message }));
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSchema(
  predicate: (schema: Schema) => boolean,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    timeoutMessage?: string;
  } = {},
): Promise<Schema> {
  const {
    timeoutMs = 5000,
    intervalMs = 250,
    timeoutMessage = 'Schema update did not propagate in time.',
  } = options;

  const initialSchema = get(store).schema;
  if (predicate(initialSchema)) {
    return initialSchema;
  }

  const deadline = Date.now() + timeoutMs;
  let lastError: Error | null = null;

  while (Date.now() < deadline) {
    const schema = await loadSchema({ silent: true });
    if (schema && predicate(schema)) {
      return schema;
    }
    if (!schema) {
      lastError = new Error(get(store).error || timeoutMessage);
    }
    await sleep(intervalMs);
  }

  throw lastError ?? new Error(timeoutMessage);
}

async function waitForTableReady(
  tableName: string,
  options: {
    namespace?: string;
    timeoutMs?: number;
    intervalMs?: number;
    timeoutMessage?: string;
  } = {},
): Promise<void> {
  const {
    namespace,
    timeoutMs = 5000,
    intervalMs = 250,
    timeoutMessage = `Table "${tableName}" did not become ready in time.`,
  } = options;

  await waitForSchema(
    (schema) => {
      const table = schema[tableName];
      return Boolean(table && (!namespace || table.namespace === namespace));
    },
    { timeoutMs, intervalMs, timeoutMessage },
  );

  const deadline = Date.now() + timeoutMs;
  let lastError: Error | null = null;

  while (Date.now() < deadline) {
    try {
      const currentTable = get(store).schema[tableName];
      if (currentTable?.dynamic) {
        return;
      }
      await api.fetch(buildAdminRecordsPath(tableName, { params: { limit: 1 } }));
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(`Table "${tableName}" is not ready yet.`);
    }
    await sleep(intervalMs);
  }

  throw lastError ?? new Error(timeoutMessage);
}

async function waitForNamespaceReady(
  namespace: string,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    timeoutMessage?: string;
  } = {},
): Promise<void> {
  const {
    timeoutMs = 5000,
    intervalMs = 250,
    timeoutMessage = `Database block "${namespace}" did not become ready in time.`,
  } = options;

  const hasNamespace = (): boolean => {
    const state = get(store);
    return Boolean(
      state.namespaces[namespace]
      || deriveNamespacesFromSchema(state.schema)[namespace],
    );
  };

  if (hasNamespace()) {
    return;
  }

  const deadline = Date.now() + timeoutMs;
  let lastError: Error | null = null;

  while (Date.now() < deadline) {
    const schema = await loadSchema({ silent: true });
    if (schema && hasNamespace()) {
      return;
    }
    if (!schema) {
      lastError = new Error(get(store).error || timeoutMessage);
    }
    await sleep(intervalMs);
  }

  throw lastError ?? new Error(timeoutMessage);
}

// ── Derived: tables grouped by namespace ────────────────

export interface TableEntry {
  name: string;
  def: TableDef;
}

export const tablesByNamespace = derived(store, ($state) => {
  const groups: Record<string, TableEntry[]> = {};

  for (const [tableName, tableDef] of Object.entries($state.schema)) {
    const ns = tableDef.namespace || 'default';
    if (!groups[ns]) {
      groups[ns] = [];
    }
    groups[ns].push({ name: tableName, def: tableDef });
  }

  // Sort tables within each namespace alphabetically
  for (const entries of Object.values(groups)) {
    entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  return groups;
});

export const namespaceDefs = derived(store, ($state) => {
  const namespaces = { ...$state.namespaces };

  for (const [namespace, meta] of Object.entries(deriveNamespacesFromSchema($state.schema))) {
    namespaces[namespace] ??= meta;
  }

  return namespaces;
});

export const namespaceNames = derived(namespaceDefs, ($namespaces) => {
  return Object.keys($namespaces).sort();
});

/**
 * Derived list of all table names, sorted.
 */
export const tableNames = derived(store, ($state) => {
  return Object.keys($state.schema).sort();
});

// ── Export ───────────────────────────────────────────────

export const schemaStore = {
  subscribe: store.subscribe,
  loadSchema,
  waitForSchema,
  waitForNamespaceReady,
  waitForTableReady,
};
