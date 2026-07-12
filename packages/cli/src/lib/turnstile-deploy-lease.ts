import { randomBytes } from 'node:crypto';

const D1_LEASE_API_TIMEOUT_MS = 10_000;
const MAX_D1_LEASE_RESPONSE_BYTES = 64 * 1024;
const TURNSTILE_DEPLOY_LEASE_SECONDS = 20 * 60;
const LEASE_RESOURCE = 'managed-turnstile-deploy';

export interface TurnstileDeployLease {
  accountId: string;
  databaseId: string;
  owner: string;
  expiresAt: number;
}

interface D1QueryEnvelope {
  success?: boolean;
  result?: Array<{
    success?: boolean;
    results?: Array<Record<string, unknown>>;
  }>;
  errors?: Array<{ message?: string }>;
}

async function readBoundedJson(response: Response): Promise<D1QueryEnvelope> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_D1_LEASE_RESPONSE_BYTES) {
    throw new Error('D1 deploy-lease response exceeded 64 KiB.');
  }
  if (!response.body) throw new Error('D1 deploy-lease API returned an empty response.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_D1_LEASE_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('D1 deploy-lease response exceeded 64 KiB.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as D1QueryEnvelope;
  } catch {
    throw new Error('D1 deploy-lease API returned malformed JSON.');
  }
}

async function queryD1(
  accountId: string,
  databaseId: string,
  apiToken: string,
  sql: string,
  params: string[],
): Promise<Array<Record<string, unknown>>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), D1_LEASE_API_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`,
      {
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql, params }),
        signal: controller.signal,
      },
    );
    const body = await readBoundedJson(response);
    const queryResult = body.result?.[0];
    if (!response.ok || body.success !== true || queryResult?.success !== true) {
      const detail = body.errors?.map((error) => error.message).filter(Boolean).join(', ')
        || `HTTP ${response.status}`;
      throw new Error(`D1 deploy-lease query failed: ${detail}`);
    }
    return queryResult.results ?? [];
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('D1 deploy-lease request timed out after 10000ms.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function acquireTurnstileDeployLease(
  accountId: string,
  databaseId: string,
  apiToken: string,
): Promise<TurnstileDeployLease> {
  await queryD1(
    accountId,
    databaseId,
    apiToken,
    'CREATE TABLE IF NOT EXISTS _edgebase_deploy_leases ('
      + 'resource TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL)',
    [],
  );

  const owner = randomBytes(16).toString('hex');
  const rows = await queryD1(
    accountId,
    databaseId,
    apiToken,
    'INSERT INTO _edgebase_deploy_leases(resource, owner, expires_at) '
      + 'VALUES (?, ?, unixepoch() + CAST(? AS INTEGER)) '
      + 'ON CONFLICT(resource) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at '
      + 'WHERE _edgebase_deploy_leases.expires_at <= unixepoch() '
      + 'RETURNING owner, expires_at',
    [LEASE_RESOURCE, owner, String(TURNSTILE_DEPLOY_LEASE_SECONDS)],
  );
  const acquiredRow = rows.find((row) =>
    row.owner === owner && Number.isFinite(Number(row.expires_at)),
  );
  if (!acquiredRow) {
    throw new Error(
      'Another managed Turnstile deployment holds the remote lease. '
      + 'Wait for it to finish (or for the 20-minute crash lease to expire) and retry.',
    );
  }
  return { accountId, databaseId, owner, expiresAt: Number(acquiredRow.expires_at) * 1000 };
}

export async function renewTurnstileDeployLease(
  lease: TurnstileDeployLease,
  apiToken: string,
): Promise<TurnstileDeployLease> {
  const rows = await queryD1(
    lease.accountId,
    lease.databaseId,
    apiToken,
    'UPDATE _edgebase_deploy_leases '
      + 'SET expires_at = unixepoch() + CAST(? AS INTEGER) '
      + 'WHERE resource = ? AND owner = ? RETURNING owner, expires_at',
    [String(TURNSTILE_DEPLOY_LEASE_SECONDS), LEASE_RESOURCE, lease.owner],
  );
  const renewed = rows.find((row) =>
    row.owner === lease.owner && Number.isFinite(Number(row.expires_at)),
  );
  if (!renewed) {
    throw new Error('The managed Turnstile deploy lease expired or changed owner before publish.');
  }
  return { ...lease, expiresAt: Number(renewed.expires_at) * 1000 };
}

export async function releaseTurnstileDeployLease(
  lease: TurnstileDeployLease,
  apiToken: string,
): Promise<void> {
  await queryD1(
    lease.accountId,
    lease.databaseId,
    apiToken,
    'DELETE FROM _edgebase_deploy_leases WHERE resource = ? AND owner = ?',
    [LEASE_RESOURCE, lease.owner],
  );
}

export const _test = {
  queryD1,
  LEASE_RESOURCE,
  TURNSTILE_DEPLOY_LEASE_SECONDS,
};
