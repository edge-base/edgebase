import { getDbDoName } from './do-router.js';

interface ExecuteDoSqlOptions {
  databaseNamespace: DurableObjectNamespace;
  namespace: string;
  id?: string;
  query: string;
  params?: unknown[];
  internal?: boolean;
}

interface SqlResultPayload {
  rows?: Record<string, unknown>[];
  items?: Record<string, unknown>[];
  results?: Record<string, unknown>[];
  message?: string;
}

function createSqlRequest(url: string, headers: Headers, query: string, params: unknown[]): Request {
  return new Request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, params }),
  });
}

function normalizeRows(payload: SqlResultPayload): Record<string, unknown>[] {
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.results)) return payload.results;
  return [];
}

export async function executeDoSql({
  databaseNamespace,
  namespace,
  id,
  query,
  params = [],
  internal = false,
}: ExecuteDoSqlOptions): Promise<Record<string, unknown>[]> {
  const doName = getDbDoName(namespace, id);
  const doId = databaseNamespace.idFromName(doName);
  const stub = databaseNamespace.get(doId);
  const url = 'http://do/internal/sql';
  const headers = new Headers({
    'Content-Type': 'application/json',
    'X-DO-Name': doName,
  });
  if (internal) {
    headers.set('X-EdgeBase-Internal', 'true');
  }

  let response = await stub.fetch(createSqlRequest(url, headers, query, params));

  if (response.status === 201) {
    const handshake = await response.clone().json().catch(() => null) as
      | { needsCreate?: boolean }
      | null;
    if (handshake?.needsCreate) {
      headers.set('X-DO-Create-Authorized', '1');
      response = await stub.fetch(createSqlRequest(url, headers, query, params));
    }
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({ message: 'SQL execution failed' })) as SqlResultPayload;
    throw new Error(err.message || 'SQL execution failed');
  }

  const payload = await response.json() as SqlResultPayload;
  return normalizeRows(payload);
}
