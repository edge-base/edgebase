import type {
  AdminInstanceDiscovery,
  AdminInstanceDiscoveryContext,
  AdminInstanceDiscoveryOption,
  EdgeBaseConfig,
} from '@edge-base/shared';
import { executeProviderAwareSql } from './provider-aware-sql.js';
import type { Env } from '../types.js';

export interface AdminDbQueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

export interface AdminInstanceDiscoveryMetadata {
  source: 'manual' | 'table' | 'function';
  targetLabel?: string;
  placeholder?: string;
  helperText?: string;
}

interface ExecuteAdminDbQueryOptions {
  env: Env;
  config: EdgeBaseConfig;
  namespace: string;
  id?: string;
  sql: string;
  params?: unknown[];
}

interface ResolveAdminInstanceOptions {
  env: Env;
  config: EdgeBaseConfig;
  namespace: string;
  query?: string;
  limit?: number;
}

function isDynamicDbBlock(
  dbBlock:
    | {
        instance?: boolean;
        access?: {
          canCreate?: unknown;
          access?: unknown;
        };
      }
    | undefined,
): boolean {
  if (!dbBlock) return false;
  return !!(dbBlock.instance || dbBlock.access?.canCreate || dbBlock.access?.access);
}

function defaultManualDiscovery(): AdminInstanceDiscoveryMetadata {
  return {
    source: 'manual',
    targetLabel: 'Target',
    placeholder: 'Target ID',
    helperText: 'Enter a target ID to browse records and run queries for this table.',
  };
}

export function serializeAdminInstanceDiscovery(
  discovery?: AdminInstanceDiscovery,
  options: { fallbackManual?: boolean } = {},
): AdminInstanceDiscoveryMetadata | undefined {
  if (!discovery) {
    return options.fallbackManual ? defaultManualDiscovery() : undefined;
  }
  return {
    source: discovery.source,
    targetLabel: discovery.targetLabel,
    placeholder: discovery.placeholder,
    helperText: discovery.helperText,
  };
}

function clampLimit(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(100, Math.trunc(value ?? fallback)));
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function placeholder(index: number, usesPostgres: boolean): string {
  return usesPostgres ? `$${index}` : '?';
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function normalizeDiscoveryItems(
  items: AdminInstanceDiscoveryOption[],
): AdminInstanceDiscoveryOption[] {
  const seen = new Set<string>();
  const normalized: AdminInstanceDiscoveryOption[] = [];
  for (const item of items) {
    const id = `${item.id ?? ''}`.trim();
    if (!id || id.includes(':') || seen.has(id)) continue;
    seen.add(id);
    normalized.push({
      id,
      label: item.label?.trim() || undefined,
      description: item.description?.trim() || undefined,
    });
  }
  return normalized;
}

export async function executeAdminDbQuery({
  env,
  config,
  namespace,
  id,
  sql,
  params = [],
}: ExecuteAdminDbQueryOptions): Promise<AdminDbQueryResult> {
  return executeProviderAwareSql(
    {
      env,
      config,
      databaseNamespace: env.DATABASE,
    },
    namespace,
    id,
    sql,
    params,
  );
}

export async function resolveAdminInstanceOptions({
  env,
  config,
  namespace,
  query = '',
  limit,
}: ResolveAdminInstanceOptions): Promise<{
  discovery: AdminInstanceDiscoveryMetadata;
  items: AdminInstanceDiscoveryOption[];
}> {
  const dbBlock = config.databases?.[namespace];
  if (!dbBlock) {
    throw new Error(`Namespace not found: ${namespace}`);
  }
  if (!isDynamicDbBlock(dbBlock)) {
    throw new Error(`Namespace '${namespace}' is not dynamic.`);
  }

  const discovery = dbBlock.admin?.instances;
  const metadata = serializeAdminInstanceDiscovery(discovery, { fallbackManual: true })!;
  const normalizedQuery = query.trim();
  const requestedLimit = clampLimit(limit, 12);

  if (!discovery || discovery.source === 'manual') {
    return { discovery: metadata, items: [] };
  }

  if (discovery.source === 'function') {
    const ctx: AdminInstanceDiscoveryContext = {
      namespace,
      query: normalizedQuery,
      limit: requestedLimit,
      admin: {
        sql: async (targetNamespace, sql, options = {}) => {
          const result = await executeAdminDbQuery({
            env,
            config,
            namespace: targetNamespace,
            id: options.id,
            sql,
            params: options.params ?? [],
          });
          return result.rows;
        },
      },
    };
    const items = await Promise.resolve(discovery.resolve(ctx));
    return {
      discovery: metadata,
      items: normalizeDiscoveryItems(Array.isArray(items) ? items : []),
    };
  }

  const sourceNamespace = discovery.namespace;
  const sourceLimit = clampLimit(discovery.limit, 12);
  const effectiveLimit = Math.min(requestedLimit, sourceLimit);
  const sourceDbBlock = config.databases?.[sourceNamespace];
  const usesPostgres = Boolean(
    sourceDbBlock &&
    !isDynamicDbBlock(sourceDbBlock) &&
    (sourceDbBlock.provider === 'neon' || sourceDbBlock.provider === 'postgres'),
  );
  const idField = discovery.idField ?? 'id';
  const labelField = discovery.labelField;
  const descriptionField = discovery.descriptionField;
  const orderBy = discovery.orderBy ?? labelField ?? idField;
  const searchFields = uniqueStrings(discovery.searchFields ?? [idField, labelField]);
  const aliasId = '__edgebase_id';
  const aliasLabel = '__edgebase_label';
  const aliasDescription = '__edgebase_description';
  const selectParts = [`${quoteIdentifier(idField)} AS ${quoteIdentifier(aliasId)}`];
  if (labelField) {
    selectParts.push(`${quoteIdentifier(labelField)} AS ${quoteIdentifier(aliasLabel)}`);
  }
  if (descriptionField) {
    selectParts.push(
      `${quoteIdentifier(descriptionField)} AS ${quoteIdentifier(aliasDescription)}`,
    );
  }

  const params: unknown[] = [];
  let sql = `SELECT ${selectParts.join(', ')} FROM ${quoteIdentifier(discovery.table)}`;
  if (normalizedQuery && searchFields.length > 0) {
    const likeValue = `%${normalizedQuery.toLowerCase()}%`;
    const predicates = searchFields.map((field) => {
      params.push(likeValue);
      return `LOWER(CAST(${quoteIdentifier(field)} AS TEXT)) LIKE ${placeholder(params.length, usesPostgres)}`;
    });
    sql += ` WHERE ${predicates.join(' OR ')}`;
  }
  sql += ` ORDER BY ${quoteIdentifier(orderBy)} ASC`;
  params.push(effectiveLimit);
  sql += ` LIMIT ${placeholder(params.length, usesPostgres)}`;

  const result = await executeAdminDbQuery({
    env,
    config,
    namespace: sourceNamespace,
    sql,
    params,
  });

  const items = normalizeDiscoveryItems(
    result.rows.map((row) => ({
      id: `${row[aliasId] ?? ''}`,
      label: row[aliasLabel] == null ? undefined : `${row[aliasLabel]}`,
      description: row[aliasDescription] == null ? undefined : `${row[aliasDescription]}`,
    })),
  );

  return {
    discovery: metadata,
    items,
  };
}
