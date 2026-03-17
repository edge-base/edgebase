export type DatabaseProvider = 'do' | 'd1' | 'neon' | 'postgres';

export interface TableTargetOptions {
  instanceId?: string | null;
  search?: string | null;
  tab?: string | null;
}

export function normalizeInstanceId(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function buildAdminRecordsPath(
  tableName: string,
  options: {
    instanceId?: string | null;
    params?: URLSearchParams | Record<string, string | number | undefined | null>;
  } = {},
): string {
  const path = `data/tables/${encodeURIComponent(tableName)}/records`;
  const searchParams = new URLSearchParams();
  const instanceId = normalizeInstanceId(options.instanceId);
  if (instanceId) {
    searchParams.set('instanceId', instanceId);
  }

  if (options.params instanceof URLSearchParams) {
    for (const [key, value] of options.params.entries()) {
      searchParams.set(key, value);
    }
  } else if (options.params) {
    for (const [key, value] of Object.entries(options.params)) {
      if (value !== undefined && value !== null && `${value}`.length > 0) {
        searchParams.set(key, `${value}`);
      }
    }
  }

  const query = searchParams.toString();
  return query ? `${path}?${query}` : path;
}

export function buildTableHref(
  basePath: string,
  tableName: string,
  options: TableTargetOptions = {},
): string {
  const url = new URL(
    `${basePath}/database/tables/${encodeURIComponent(tableName)}`,
    'http://edgebase.local',
  );
  const instanceId = normalizeInstanceId(options.instanceId);
  const search = options.search?.trim();
  const tab = options.tab?.trim();

  if (instanceId) {
    url.searchParams.set('instance', instanceId);
  }
  if (search) {
    url.searchParams.set('search', search);
  }
  if (tab && tab !== 'records') {
    url.searchParams.set('tab', tab);
  }

  return `${url.pathname}${url.search}`;
}
