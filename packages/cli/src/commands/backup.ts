import { Command } from 'commander';
import {
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
  readdirSync,
  statSync,
  rmSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, join, dirname, sep } from 'node:path';
import { createInterface } from 'node:readline';
import chalk from 'chalk';
import { isCliStructuredError, raiseCliError, raiseNeedsInput } from '../lib/agent-contract.js';
import { spin } from '../lib/spinner.js';
import { isJson, isNonInteractive } from '../lib/cli-context.js';
import { fetchWithTimeout } from '../lib/fetch-with-timeout.js';
import { npxCommand } from '../lib/npx.js';
import { resolveServiceKey, resolveServerUrl } from '../lib/resolve-options.js';

/**
 * `npx edgebase backup` — Portable backup & restore via Worker Admin API.
 *
 * - `backup create`  — Download all DO + D1 + optional R2/secrets as JSON (or tar.gz)
 * - `backup restore` — Restore from a backup file
 *
 * Backup JSON format v1.1:
 *   { version, timestamp, source, config?, secrets?, control, auth, databases, storage? }
 *
 * Authentication: Service Key via --service-key flag or EDGEBASE_SERVICE_KEY env var.
 * Target: Worker URL via --url flag or EDGEBASE_URL env var.
 */

// ─── API Client ───

interface BackupAPIOptions {
  url: string;
  serviceKey: string;
}

async function apiCall<T>(
  opts: BackupAPIOptions,
  path: string,
  method: 'GET' | 'POST' = 'POST',
  body?: unknown,
): Promise<T> {
  const url = `${opts.url.replace(/\/$/, '')}/admin/api/backup${path}`;
  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-EdgeBase-Service-Key': opts.serviceKey,
    },
  };
  if (body && method === 'POST') {
    init.body = JSON.stringify(body);
  }

  const resp = await fetchWithTimeout(url, init);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`API error (${resp.status}): ${text}`);
  }
  return resp.json() as Promise<T>;
}

async function apiBinary(
  opts: BackupAPIOptions,
  path: string,
): Promise<{ buffer: ArrayBuffer; contentType: string }> {
  const url = `${opts.url.replace(/\/$/, '')}/admin/api/backup${path}`;
  const resp = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'X-EdgeBase-Service-Key': opts.serviceKey },
  });
  if (!resp.ok) {
    throw new Error(`API error (${resp.status}): ${await resp.text()}`);
  }
  return {
    buffer: await resp.arrayBuffer(),
    contentType: resp.headers.get('content-type') || 'application/octet-stream',
  };
}

async function apiUpload(
  opts: BackupAPIOptions,
  path: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<void> {
  const url = `${opts.url.replace(/\/$/, '')}/admin/api/backup${path}`;
  const resp = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'X-EdgeBase-Service-Key': opts.serviceKey,
      'Content-Type': contentType,
    },
    body,
  });
  if (!resp.ok) {
    throw new Error(`API error (${resp.status}): ${await resp.text()}`);
  }
}

// ─── Types ───

interface DOInfo {
  doName: string;
  type: 'database' | 'auth';
  namespace: 'DATABASE' | 'AUTH';
}

interface DODump {
  doName: string;
  doType: 'database' | 'auth';
  schema?: Record<string, string>;
  tables: Record<string, unknown[]>;
  timestamp: string;
}

interface D1Dump {
  type: 'd1';
  tables: Record<string, unknown[]>;
  timestamp: string;
}

interface DataNamespaceDump {
  type: 'data';
  namespace: string;
  tables: Record<string, unknown[]>;
  tableOrder?: string[];
  timestamp: string;
}

interface StorageObject {
  key: string;
  size: number;
  etag: string;
  contentType: string;
}

/** v1.1 backup format — */
interface BackupFileV1_1 {
  version: '1.1';
  timestamp: string;
  source: string;
  config?: Record<string, unknown>;
  secrets?: Record<string, string>;
  control: {
    d1: Record<string, unknown[]>;
  };
  auth: {
    d1: Record<string, unknown[]>;
    shards: Record<string, DODump>;
  };
  databases: Record<string, DODump>;
  dataNamespaces?: Record<string, DataNamespaceDump>;
  storage?: {
    objects: StorageObject[];
  };
}

// ─── Helpers ───

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isObjectRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

function isUnknownArrayRecord(value: unknown): value is Record<string, unknown[]> {
  return isObjectRecord(value) && Object.values(value).every((entry) => Array.isArray(entry));
}

function isDODump(value: unknown): value is DODump {
  if (!isObjectRecord(value)) return false;
  if (typeof value.doName !== 'string') return false;
  if (value.doType !== 'database' && value.doType !== 'auth') return false;
  if (typeof value.timestamp !== 'string') return false;
  if (!isUnknownArrayRecord(value.tables)) return false;
  if (value.schema !== undefined && !isStringRecord(value.schema)) return false;
  return true;
}

function isDODumpRecord(value: unknown): value is Record<string, DODump> {
  return isObjectRecord(value) && Object.values(value).every((entry) => isDODump(entry));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isDataNamespaceDump(value: unknown): value is DataNamespaceDump {
  if (!isObjectRecord(value)) return false;
  if (value.type !== 'data') return false;
  if (typeof value.namespace !== 'string') return false;
  if (typeof value.timestamp !== 'string') return false;
  if (!isUnknownArrayRecord(value.tables)) return false;
  if (value.tableOrder !== undefined && !isStringArray(value.tableOrder)) return false;
  return true;
}

function isDataNamespaceDumpRecord(value: unknown): value is Record<string, DataNamespaceDump> {
  return isObjectRecord(value) && Object.values(value).every((entry) => isDataNamespaceDump(entry));
}

function isStorageObject(value: unknown): value is StorageObject {
  return (
    isObjectRecord(value) &&
    typeof value.key === 'string' &&
    typeof value.size === 'number' &&
    Number.isFinite(value.size) &&
    typeof value.etag === 'string' &&
    typeof value.contentType === 'string'
  );
}

function isStorageDump(value: unknown): value is NonNullable<BackupFileV1_1['storage']> {
  return (
    isObjectRecord(value) && Array.isArray(value.objects) && value.objects.every(isStorageObject)
  );
}

function assertBackupFileV1_1(raw: unknown): asserts raw is BackupFileV1_1 {
  if (!isObjectRecord(raw)) {
    throw new Error('Backup file must be a JSON object.');
  }

  if (raw.version !== '1.1') {
    throw new Error(`Unsupported backup version: ${String(raw.version ?? 'unknown')}`);
  }

  if (typeof raw.timestamp !== 'string' || raw.timestamp.length === 0) {
    throw new Error('Backup file is missing timestamp.');
  }

  if (typeof raw.source !== 'string' || raw.source.length === 0) {
    throw new Error('Backup file is missing source.');
  }

  if (!isObjectRecord(raw.control)) {
    throw new Error('Backup file is missing control metadata.');
  }

  if (!isUnknownArrayRecord(raw.control.d1)) {
    throw new Error('Backup file is missing control.d1.');
  }

  if (!isObjectRecord(raw.auth)) {
    throw new Error('Backup file is missing auth metadata.');
  }

  if (!isUnknownArrayRecord(raw.auth.d1)) {
    throw new Error('Backup file is missing auth.d1.');
  }

  if (!isDODumpRecord(raw.auth.shards)) {
    throw new Error('Backup file is missing auth.shards.');
  }

  if (!isDODumpRecord(raw.databases)) {
    throw new Error('Backup file is missing databases.');
  }

  if (raw.dataNamespaces !== undefined && !isDataNamespaceDumpRecord(raw.dataNamespaces)) {
    throw new Error('Backup file has invalid data namespace dumps.');
  }

  if (raw.config !== undefined && !isObjectRecord(raw.config)) {
    throw new Error('Backup file has invalid config metadata.');
  }

  if (raw.secrets !== undefined && !isStringRecord(raw.secrets)) {
    throw new Error('Backup file has invalid secrets metadata.');
  }

  if (raw.storage !== undefined && !isStorageDump(raw.storage)) {
    throw new Error('Backup file has invalid storage metadata.');
  }
}

function resolveOptions(options: { url?: string; serviceKey?: string }): BackupAPIOptions {
  const url = resolveServerUrl(options);
  const serviceKey = resolveServiceKey(options);
  return { url, serviceKey };
}

/**
 * Run async tasks with a concurrency limit.
 * Returns results in the same order as the input tasks.
 */
async function throttle<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < tasks.length) {
      const idx = nextIdx++;
      results[idx] = await tasks[idx]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Run async tasks with a concurrency limit and collect both fulfilled/rejected results.
 * Results stay aligned with the input task order.
 */
async function throttleSettled<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<Array<PromiseSettledResult<T>>> {
  const results: Array<PromiseSettledResult<T>> = new Array(tasks.length);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < tasks.length) {
      const idx = nextIdx++;
      try {
        results[idx] = {
          status: 'fulfilled',
          value: await tasks[idx](),
        };
      } catch (reason) {
        results[idx] = {
          status: 'rejected',
          reason,
        };
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function outputJson(payload: Record<string, unknown>): void {
  console.log(JSON.stringify(payload));
}

function logHuman(...args: unknown[]): void {
  if (!isJson()) console.log(...args);
}

function logHumanError(...args: unknown[]): void {
  if (!isJson()) console.error(...args);
}

function writeHuman(text: string): void {
  if (!isJson()) process.stdout.write(text);
}

function collectSettledFailures<T>(
  results: Array<PromiseSettledResult<T>>,
  labels: string[],
): string[] {
  const failures: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result?.status === 'rejected') {
      failures.push(`${labels[i] ?? `task-${i + 1}`}: ${errorMessage(result.reason)}`);
    }
  }
  return failures;
}

function summarizeFailures(stage: string, failures: string[], max = 3): string {
  if (failures.length === 0) return `${stage} failed.`;
  const preview = failures.slice(0, max).join('; ');
  const remaining = failures.length - Math.min(failures.length, max);
  return remaining > 0
    ? `${stage} failed (${failures.length} total): ${preview}; +${remaining} more`
    : `${stage} failed: ${preview}`;
}

function parseBackupFile(raw: unknown): BackupFileV1_1 {
  assertBackupFileV1_1(raw);
  return raw;
}

function resolveDirectDataNamespaceNames(config: Record<string, unknown> | undefined): string[] {
  if (!config || !isObjectRecord(config.databases)) {
    return [];
  }

  const namespaces: string[] = [];
  for (const [namespace, rawBlock] of Object.entries(config.databases)) {
    if (!isObjectRecord(rawBlock)) continue;
    if (!isObjectRecord(rawBlock.tables) || Object.keys(rawBlock.tables).length === 0) continue;

    const provider = typeof rawBlock.provider === 'string' ? rawBlock.provider : undefined;
    if (provider === 'd1' || provider === 'neon' || provider === 'postgres') {
      namespaces.push(namespace);
      continue;
    }

    if (provider === 'do') {
      continue;
    }

    if (rawBlock.instance !== undefined) {
      continue;
    }

    const access = isObjectRecord(rawBlock.access) ? rawBlock.access : null;
    if (access && (access.canCreate !== undefined || access.access !== undefined)) {
      continue;
    }

    namespaces.push(namespace);
  }

  return namespaces.sort();
}

interface DownloadSessionPaths {
  sessionDir: string;
  storageDir: string;
  manifestPath: string;
}

function resolveDownloadSessionPaths(
  edgebaseTmpDir: string,
  timestamp: string,
  resumeStorageDir?: string | null,
): DownloadSessionPaths {
  const sessionDir = resumeStorageDir
    ? dirname(resumeStorageDir)
    : join(edgebaseTmpDir, `backup-${timestamp}`);
  return {
    sessionDir,
    storageDir: join(sessionDir, 'storage'),
    manifestPath: join(sessionDir, 'manifest.json'),
  };
}

/** Parse .dev.vars file → key/value map */
function parseDevVars(filePath: string): Record<string, string> {
  const content = readFileSync(filePath, 'utf-8');
  const vars: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      vars[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
    }
  }
  return vars;
}

/** Read secrets from environment */
function readSecrets(projectDir: string): Record<string, string> | null {
  // Docker/Direct: .dev.vars
  const devVarsPath = join(projectDir, '.dev.vars');
  if (existsSync(devVarsPath)) {
    const vars = parseDevVars(devVarsPath);
    const secrets: Record<string, string> = {};
    const secretKeys = ['JWT_USER_SECRET', 'JWT_ADMIN_SECRET', 'SERVICE_KEY'];
    for (const key of secretKeys) {
      if (vars[key]) secrets[key] = vars[key];
    }
    if (Object.keys(secrets).length > 0) return secrets;
  }

  // Edge: .edgebase/secrets.json
  const secretsJsonPath = join(projectDir, '.edgebase', 'secrets.json');
  if (existsSync(secretsJsonPath)) {
    try {
      return JSON.parse(readFileSync(secretsJsonPath, 'utf-8'));
    } catch {
      // Invalid JSON, skip
    }
  }

  return null;
}

/** Write secrets to environment */
function writeSecrets(projectDir: string, secrets: Record<string, string>): void {
  const devVarsPath = join(projectDir, '.dev.vars');

  if (existsSync(devVarsPath)) {
    // Update existing .dev.vars
    const existing = parseDevVars(devVarsPath);
    const merged = { ...existing, ...secrets };
    const content = Object.entries(merged)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    writeFileSync(devVarsPath, `# EdgeBase secrets (auto-restored)\n${content}\n`);
  } else {
    // Create new .dev.vars
    const content = Object.entries(secrets)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    writeFileSync(devVarsPath, `# EdgeBase secrets (auto-restored)\n${content}\n`);
    chmodSync(devVarsPath, 0o600);
  }

  // Also update .edgebase/secrets.json for Edge environments
  const edgebaseDir = join(projectDir, '.edgebase');
  const secretsJsonPath = join(edgebaseDir, 'secrets.json');
  try {
    if (!existsSync(edgebaseDir)) {
      mkdirSync(edgebaseDir, { recursive: true });
    }
    // Merge with existing secrets.json if present
    let existing: Record<string, string> = {};
    if (existsSync(secretsJsonPath)) {
      try {
        existing = JSON.parse(readFileSync(secretsJsonPath, 'utf-8'));
      } catch {
        /* ignore */
      }
    }
    const merged = { ...existing, ...secrets };
    writeFileSync(secretsJsonPath, JSON.stringify(merged, null, 2));
    chmodSync(secretsJsonPath, 0o600);
  } catch {
    // Non-fatal: .edgebase/secrets.json update failed
  }
}

/** Interactive confirmation prompt */
async function confirmRestore(message: string): Promise<boolean> {
  if (!process.stdin.isTTY || isNonInteractive() || isJson()) {
    raiseNeedsInput({
      code: 'backup_restore_confirmation_required',
      field: 'yes',
      message:
        'Backup restore requires explicit confirmation before wiping and replacing target data.',
      hint: 'Review the backup summary, then rerun with --yes.',
      choices: [
        {
          label: 'Approve restore',
          value: 'yes',
          args: ['--yes'],
        },
      ],
    });
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'restore');
    });
  });
}

/** Y/N confirmation prompt */
async function confirmYN(message: string, defaultNonInteractive = false): Promise<boolean> {
  if (!process.stdin.isTTY || isNonInteractive() || isJson()) {
    return defaultNonInteractive;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(['y', 'yes'].includes(answer.trim().toLowerCase()));
    });
  });
}

/** R2 download manifest for resume support */
interface DownloadManifest {
  objects: Array<StorageObject & { status: 'pending' | 'done' }>;
  startedAt: string;
  completedCount: number;
}

/** Recursively collect all files in a directory */
function collectFiles(dir: string, base = dir): Array<{ path: string; rel: string }> {
  const results: Array<{ path: string; rel: string }> = [];
  if (!existsSync(dir)) return results;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath, base));
    } else {
      results.push({
        path: fullPath,
        rel: fullPath
          .slice(base.length + 1)
          .split(sep)
          .join('/'),
      });
    }
  }
  return results;
}

// ─── Cloudflare REST API DO Enumeration (Edge only,) ───

export interface CloudflareAPIOptions {
  accountId: string;
  apiToken: string;
}

interface CFDOInstance {
  id: string;
  hasStoredData: boolean;
}

/**
 * Enumerate all DO instances via Cloudflare REST API.
 * Returns hex IDs of DOs that have stored data.
 * Uses cursor pagination for large namespaces.
 */
export async function enumerateDOsViaCFAPI(
  cf: CloudflareAPIOptions,
  namespaceId: string,
): Promise<string[]> {
  const hexIds: string[] = [];
  let cursor: string | null = null;

  do {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    params.set('limit', '1000');

    const url = `https://api.cloudflare.com/client/v4/accounts/${cf.accountId}/workers/durable_objects/namespaces/${namespaceId}/objects?${params}`;
    const resp = await fetchWithTimeout(url, {
      headers: { Authorization: `Bearer ${cf.apiToken}` },
    });

    if (!resp.ok) {
      throw new Error(`CF API error (${resp.status}): ${await resp.text()}`);
    }

    const body = (await resp.json()) as {
      result: CFDOInstance[];
      result_info?: { cursor?: string };
    };

    for (const obj of body.result) {
      if (obj.hasStoredData) {
        hexIds.push(obj.id);
      }
    }

    cursor = body.result_info?.cursor ?? null;
  } while (cursor);

  return hexIds;
}

/**
 * Get all DO namespace IDs for this worker via Cloudflare REST API.
 * Returns array of { id, name, class } for each namespace.
 */
export async function getCFNamespaces(
  cf: CloudflareAPIOptions,
): Promise<Array<{ id: string; name: string; class: string }>> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${cf.accountId}/workers/durable_objects/namespaces`;
  const resp = await fetchWithTimeout(url, {
    headers: { Authorization: `Bearer ${cf.apiToken}` },
  });

  if (!resp.ok) {
    throw new Error(`CF API error (${resp.status}): ${await resp.text()}`);
  }

  const body = (await resp.json()) as {
    result: Array<{ id: string; name: string; class: string }>;
  };
  return body.result;
}

// ─── Commands ───

export const backupCommand = new Command('backup')
  .alias('bk')
  .description('Backup & restore database');

// ── backup create ──

backupCommand
  .command('create')
  .description('Create a full backup of all DO, D1, and optionally R2/secrets')
  .option('--url <url>', 'Worker URL (or EDGEBASE_URL env)')
  .option('--service-key <key>', 'Service Key (or EDGEBASE_SERVICE_KEY env)')
  .option('--output <path>', 'Output directory', './backup')
  .option('--include-secrets', 'Include JWT keys and Service Key in backup')
  .option('--include-storage', 'Include R2 storage files (creates .tar.gz archive)')
  .option(
    '--account-id <id>',
    'Cloudflare Account ID for Edge DO enumeration (or CLOUDFLARE_ACCOUNT_ID env)',
  )
  .option(
    '--api-token <token>',
    'Cloudflare API Token for Edge DO enumeration (or CLOUDFLARE_API_TOKEN env)',
  )
  .action(
    async (options: {
      url?: string;
      serviceKey?: string;
      output?: string;
      includeSecrets?: boolean;
      includeStorage?: boolean;
      accountId?: string;
      apiToken?: string;
    }) => {
      // Graceful shutdown on SIGINT
      const sigintHandler = () => {
        process.exit(130);
      };
      process.on('SIGINT', sigintHandler);

      const outputDir = resolve(options.output || './backup');
      const projectDir = resolve('.');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const isArchive = !!options.includeStorage;
      const backupJsonPath = join(outputDir, `edgebase-backup-${timestamp}.json`);
      const archivePath = join(outputDir, `edgebase-backup-${timestamp}.tar.gz`);
      let storageStageDir: string | null = null;
      let storageCleanupDir: string | null = null;
      let tarStagingDir: string | null = null;
      let totalRows = 0;
      let config: Record<string, unknown> | undefined;
      let dataNamespaces: Record<string, DataNamespaceDump> | undefined;

      try {
        const api = resolveOptions(options);

        if (!existsSync(outputDir)) {
          mkdirSync(outputDir, { recursive: true });
        }

        logHuman(chalk.blue('💾 Creating backup...'));
        if (options.includeSecrets) logHuman(chalk.yellow('  ⚡ Including secrets'));
        if (options.includeStorage) logHuman(chalk.yellow('  ⚡ Including R2 storage'));
        logHuman();

        // ── 1. List all DOs ──

        const enumSpinner = spin('Enumerating DOs...');

        const accountId = options.accountId || process.env.CLOUDFLARE_ACCOUNT_ID;
        const apiToken = options.apiToken || process.env.CLOUDFLARE_API_TOKEN;
        const isEdge = !!(accountId && apiToken);

        let listResult: { dos: DOInfo[]; total: number };
        try {
          if (isEdge) {
            // Edge mode: enumerate via Cloudflare REST API
            enumSpinner.text = 'Enumerating DOs via Cloudflare API (Edge mode)...';
            const cf: CloudflareAPIOptions = { accountId: accountId!, apiToken: apiToken! };
            const namespaces = await getCFNamespaces(cf);

            const allHexIds: string[] = [];
            for (const ns of namespaces) {
              const ids = await enumerateDOsViaCFAPI(cf, ns.id);
              allHexIds.push(...ids);
            }

            enumSpinner.text = `Found ${allHexIds.length} DO instances via CF API, resolving names...`;

            // Pass hex IDs to Worker for name resolution
            listResult = await apiCall<{ dos: DOInfo[]; total: number }>(api, '/list-dos', 'POST', {
              hexIds: allHexIds,
            });
          } else {
            // Config-scan mode: Worker enumerates via config + membership
            listResult = await apiCall<{ dos: DOInfo[]; total: number }>(
              api,
              '/list-dos',
              'POST',
              {},
            );
          }
          enumSpinner.succeed(`Found ${listResult.total} DO instances`);
        } catch (err) {
          enumSpinner.fail(`DO enumeration failed: ${errorMessage(err)}`);
          throw err;
        }

        // ── 2. Dump each DO (10-concurrent throttle) ──

        const control: BackupFileV1_1['control'] = { d1: {} };
        const auth: BackupFileV1_1['auth'] = { d1: {}, shards: {} };
        const databases: Record<string, DODump> = {};
        let dumped = 0;

        const dumpSpinner = spin('Dumping DOs...');
        const dumpTasks = listResult.dos.map((doInfo) => async () => {
          const idx = ++dumped;
          const progress = `[${idx}/${listResult.dos.length}]`;
          dumpSpinner.text = `${progress} Dumping ${doInfo.doName}...`;

          const dump = await apiCall<DODump>(api, '/dump-do', 'POST', {
            doName: doInfo.doName,
            type: doInfo.type,
          });

          if (doInfo.type === 'auth') {
            auth.shards[doInfo.doName] = dump;
          } else {
            databases[doInfo.doName] = dump;
          }

          return dump;
        });

        const dumpResults = await throttleSettled(dumpTasks, 10);
        const dumpFailures = collectSettledFailures(
          dumpResults,
          listResult.dos.map((doInfo) => doInfo.doName),
        );
        if (dumpFailures.length > 0) {
          dumpSpinner.fail(`DO dump failed for ${dumpFailures.length} instance(s)`);
          throw new Error(summarizeFailures('DO dump', dumpFailures));
        }

        totalRows = Object.values(databases).reduce(
          (sum, dump) =>
            sum + Object.values(dump.tables).reduce((tableSum, rows) => tableSum + rows.length, 0),
          0,
        );
        dumpSpinner.succeed(`Dumped ${listResult.dos.length} DOs (${totalRows} total rows)`);

        // ── 3. Dump D1 ──

        const controlSpinner = spin('Dumping internal control plane...');
        try {
          const controlDump = await apiCall<D1Dump>(api, '/dump-control-d1', 'POST');
          control.d1 = controlDump.tables;
          const rowCount = Object.values(controlDump.tables).reduce(
            (sum, rows) => sum + (rows as unknown[]).length,
            0,
          );
          controlSpinner.succeed(
            `Control D1: ${Object.keys(controlDump.tables).length} tables, ${rowCount} rows`,
          );
        } catch (err) {
          controlSpinner.fail(`Control D1 dump failed: ${errorMessage(err)}`);
          throw err;
        }

        const d1Spinner = spin('Dumping auth database...');
        try {
          const d1Dump = await apiCall<D1Dump>(api, '/dump-d1', 'POST');
          auth.d1 = d1Dump.tables;
          const rowCount = Object.values(d1Dump.tables).reduce(
            (sum, rows) => sum + (rows as unknown[]).length,
            0,
          );
          d1Spinner.succeed(`D1: ${Object.keys(d1Dump.tables).length} tables, ${rowCount} rows`);
        } catch (err) {
          d1Spinner.fail(`D1 dump failed: ${errorMessage(err)}`);
          throw err;
        }

        // ── 4. Secrets (optional) ──

        let secrets: Record<string, string> | undefined;
        if (options.includeSecrets) {
          const secretSpinner = spin('Collecting secrets...');
          secrets = readSecrets(projectDir) ?? undefined;
          if (secrets) {
            secretSpinner.succeed(`Collected ${Object.keys(secrets).length} secret keys`);
          } else {
            secretSpinner.warn('No secrets found (.dev.vars / .edgebase/secrets.json)');
          }
        }

        // ── 5. R2 Storage (optional) ──

        let storage: { objects: StorageObject[] } | undefined;
        // Check for existing incomplete download (resume support)
        const edgebaseTmpDir = join(projectDir, '.edgebase', 'tmp');

        if (options.includeStorage) {
          // Check for resumable incomplete download
          let resumeManifest: DownloadManifest | null = null;
          let resumeDir: string | null = null;

          if (existsSync(edgebaseTmpDir)) {
            const tmpDirs = readdirSync(edgebaseTmpDir)
              .filter((d) => d.startsWith('backup-'))
              .sort()
              .reverse();
            for (const dir of tmpDirs) {
              const manifestPath = join(edgebaseTmpDir, dir, 'manifest.json');
              if (existsSync(manifestPath)) {
                try {
                  const manifest = JSON.parse(
                    readFileSync(manifestPath, 'utf-8'),
                  ) as DownloadManifest;
                  const pending = manifest.objects.filter((o) => o.status === 'pending');
                  if (pending.length > 0) {
                    logHuman(
                      chalk.yellow(`  ⚠ Found incomplete R2 download from ${manifest.startedAt}`),
                    );
                    logHuman(
                      chalk.yellow(
                        `    ${pending.length} files remaining out of ${manifest.objects.length}`,
                      ),
                    );
                    const resume = await confirmYN('    Resume download? (y/N): ', false);
                    if (resume) {
                      resumeManifest = manifest;
                      resumeDir = join(edgebaseTmpDir, dir, 'storage');
                      break;
                    }
                  }
                } catch {
                  /* invalid manifest, skip */
                }
              }
            }
          }

          let objectList: StorageObject[];
          let totalBytes: number;
          let totalMB: string;
          const sessionPaths = resolveDownloadSessionPaths(edgebaseTmpDir, timestamp, resumeDir);

          if (resumeManifest && resumeDir) {
            // Resume mode
            objectList = resumeManifest.objects.map((o) => ({
              key: o.key,
              size: o.size,
              etag: o.etag,
              contentType: o.contentType,
            }));
            totalBytes = objectList.reduce((sum, obj) => sum + obj.size, 0);
            totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
          } else {
            // Fresh download
            const r2ListSpinner = spin('Listing R2 objects...');
            try {
              const storageList = await apiCall<{ objects: StorageObject[]; total: number }>(
                api,
                '/dump-storage?action=list',
              );
              objectList = storageList.objects;
              totalBytes = objectList.reduce((sum, obj) => sum + obj.size, 0);
              totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
              r2ListSpinner.succeed(`${storageList.total} R2 objects (${totalMB} MB)`);
            } catch (err) {
              r2ListSpinner.fail(`R2 listing failed: ${errorMessage(err)}`);
              throw err;
            }
          }

          storage = { objects: objectList };

          if (objectList.length > 0) {
            // R2 confirmation prompt (Gap 9)
            logHuman(chalk.yellow(`  ⚠ ${objectList.length} files, ${totalMB} MB to download.`));
            const proceed = await confirmYN(
              `  ${chalk.cyan('Proceed with R2 download?')} (y/N): `,
              true,
            );
            if (!proceed) {
              logHuman(chalk.yellow('  Skipping R2 storage download.'));
              storage = undefined;
            } else {
              storageStageDir = sessionPaths.storageDir;
              storageCleanupDir = sessionPaths.sessionDir;
              mkdirSync(sessionPaths.sessionDir, { recursive: true });
              mkdirSync(sessionPaths.storageDir, { recursive: true });

              // Create/update manifest for resume support (Gap 8)
              let manifest: DownloadManifest;
              if (resumeManifest) {
                manifest = resumeManifest;
              } else {
                manifest = {
                  objects: objectList.map((obj) => ({ ...obj, status: 'pending' as const })),
                  startedAt: new Date().toISOString(),
                  completedCount: 0,
                };
                writeFileSync(sessionPaths.manifestPath, JSON.stringify(manifest, null, 2));
              }

              const pendingObjects = manifest.objects.filter((obj) => obj.status === 'pending');
              let downloadedCount = manifest.completedCount;
              const totalToDownload = manifest.objects.length;

              const r2DownloadSpinner = spin('Downloading R2 files...');
              const downloadTasks = pendingObjects.map((manifestObj) => async () => {
                const idx = ++downloadedCount;
                r2DownloadSpinner.text = `[${idx}/${totalToDownload}] Downloading ${manifestObj.key}...`;

                const { buffer } = await apiBinary(
                  api,
                  `/dump-storage?action=get&key=${encodeURIComponent(manifestObj.key)}`,
                );

                const filePath = join(sessionPaths.storageDir, manifestObj.key);
                mkdirSync(dirname(filePath), { recursive: true });
                writeFileSync(filePath, Buffer.from(buffer));

                // Mark as done in manifest
                manifestObj.status = 'done';
                manifest.completedCount = downloadedCount;
                writeFileSync(sessionPaths.manifestPath, JSON.stringify(manifest, null, 2));
              });

              const downloadResults = await throttleSettled(downloadTasks, 5);
              const downloadFailures = collectSettledFailures(
                downloadResults,
                pendingObjects.map((obj) => obj.key),
              );
              if (downloadFailures.length > 0) {
                r2DownloadSpinner.fail(
                  `R2 download failed for ${downloadFailures.length} object(s)`,
                );
                throw new Error(summarizeFailures('R2 download', downloadFailures));
              }

              r2DownloadSpinner.succeed(`Downloaded ${totalToDownload} R2 files (${totalMB} MB)`);
            }
          }
        }

        // ── 6. Fetch config snapshot ──

        try {
          config = await apiCall<Record<string, unknown>>(api, '/config', 'GET');
        } catch {
          // Config endpoint may not exist on older servers
        }

        // ── 7. Dump D1/Postgres data namespaces ──

        const directNamespaceNames = resolveDirectDataNamespaceNames(config);
        if (directNamespaceNames.length > 0) {
          const dataSpinner = spin('Dumping data namespaces...');
          dataNamespaces = {};
          try {
            for (const namespace of directNamespaceNames) {
              const dump = await apiCall<DataNamespaceDump>(api, '/dump-data', 'POST', {
                namespace,
              });
              dataNamespaces[namespace] = dump;
              totalRows += Object.values(dump.tables).reduce((sum, rows) => sum + rows.length, 0);
            }
            dataSpinner.succeed(`Dumped ${directNamespaceNames.length} data namespace(s)`);
          } catch (err) {
            dataSpinner.fail(`Data namespace dump failed: ${errorMessage(err)}`);
            throw err;
          }
        }

        // ── 8. Build backup object ──

        const backup: BackupFileV1_1 = {
          version: '1.1',
          timestamp: new Date().toISOString(),
          source: isEdge
            ? 'cloudflare-edge'
            : api.url.includes('workers.dev')
              ? 'cloudflare-edge'
              : api.url.includes('localhost')
                ? 'local'
                : 'docker',
          control,
          auth,
          databases,
        };
        if (config) backup.config = config;
        if (dataNamespaces && Object.keys(dataNamespaces).length > 0) {
          backup.dataNamespaces = dataNamespaces;
        }
        if (secrets) backup.secrets = secrets;
        if (storage) backup.storage = storage;

        // ── 9. Write output ──

        let outputPath = backupJsonPath;
        if (isArchive && storageStageDir && existsSync(storageStageDir)) {
          // Create tar.gz with backup.json + storage/ files
          tarStagingDir = join(outputDir, `.tmp-tar-${timestamp}`);
          mkdirSync(tarStagingDir, { recursive: true });

          // Copy backup.json into tar staging dir
          writeFileSync(join(tarStagingDir, 'backup.json'), JSON.stringify(backup, null, 2));

          // Copy storage files into tar staging dir
          const storageDestDir = join(tarStagingDir, 'storage');
          mkdirSync(storageDestDir, { recursive: true });

          const storageFiles = collectFiles(storageStageDir);
          for (const file of storageFiles) {
            const dest = join(storageDestDir, file.rel);
            mkdirSync(dirname(dest), { recursive: true });
            writeFileSync(dest, readFileSync(file.path));
          }

          // Create tar.gz using shell tar (same pattern as deploy.ts)
          execFileSync(
            'tar',
            ['-czf', archivePath, '-C', tarStagingDir, 'backup.json', 'storage'],
            {
              stdio: 'pipe',
            },
          );

          // Cleanup tmp dirs
          if (storageCleanupDir) rmSync(storageCleanupDir, { recursive: true, force: true });
          rmSync(tarStagingDir, { recursive: true, force: true });
          tarStagingDir = null;

          chmodSync(archivePath, 0o600);
          outputPath = archivePath;

          logHuman();
          logHuman(chalk.green('✅ Backup complete!'));
          logHuman(chalk.dim(`  File: ${archivePath}`));
          logHuman(chalk.dim(`  Size: ${(statSync(archivePath).size / 1024).toFixed(1)} KB`));
        } else {
          // JSON-only backup
          writeFileSync(backupJsonPath, JSON.stringify(backup, null, 2), 'utf-8');
          chmodSync(backupJsonPath, 0o600);

          logHuman();
          logHuman(chalk.green('✅ Backup complete!'));
          logHuman(chalk.dim(`  File: ${backupJsonPath}`));
          logHuman(
            chalk.dim(
              `  Size: ${(Buffer.byteLength(JSON.stringify(backup)) / 1024).toFixed(1)} KB`,
            ),
          );
        }

        if (isJson()) {
          outputJson({
            status: 'success',
            file: outputPath,
            dos: Object.keys(databases).length,
            dataNamespaces: Object.keys(dataNamespaces ?? {}).length,
            rows: totalRows,
            timestamp,
          });
          return;
        }

        logHuman(chalk.dim(`  Auth shards: ${Object.keys(auth.shards).length}`));
        logHuman(chalk.dim(`  Database DOs: ${Object.keys(databases).length}`));
        if (dataNamespaces) {
          logHuman(chalk.dim(`  Data namespaces: ${Object.keys(dataNamespaces).length}`));
        }
        if (storage) logHuman(chalk.dim(`  R2 files: ${storage.objects.length}`));
        if (secrets) logHuman(chalk.dim(`  Secrets: ${Object.keys(secrets).length} keys`));
        logHuman();

        if (secrets) {
          logHuman(chalk.red.bold('⚠ This backup contains SECRETS. Store securely.'));
          logHuman(chalk.red('  File permissions set to 600.'));
        } else {
          logHuman(
            chalk.yellow('⚠'),
            'This backup may contain sensitive data (passwords, tokens).',
          );
          logHuman(chalk.yellow('  '), 'File permissions set to 600. Store securely.');
        }
      } catch (err) {
        if (isCliStructuredError(err)) throw err;

        if (existsSync(backupJsonPath)) rmSync(backupJsonPath, { force: true });
        if (existsSync(archivePath)) rmSync(archivePath, { force: true });
        if (tarStagingDir && existsSync(tarStagingDir)) {
          rmSync(tarStagingDir, { recursive: true, force: true });
        }

        logHuman();
        logHumanError(chalk.red(`✗ Backup failed: ${errorMessage(err)}`));
        raiseCliError({
          code: 'backup_create_failed',
          message: errorMessage(err),
        });
      } finally {
        process.off('SIGINT', sigintHandler);
      }
    },
  );

// ── backup restore ──

backupCommand
  .command('restore')
  .description('Restore from a backup file (JSON or tar.gz)')
  .requiredOption('--from <path>', 'Path to backup file (JSON or tar.gz)')
  .option('--url <url>', 'Worker URL (or EDGEBASE_URL env)')
  .option('--service-key <key>', 'Service Key (or EDGEBASE_SERVICE_KEY env)')
  .option('--yes', 'Skip confirmation prompt')
  .option('--skip-secrets', 'Skip restoring secrets even if present in backup')
  .option('--skip-storage', 'Skip restoring R2 storage even if present in backup')
  .option(
    '--account-id <id>',
    'Cloudflare Account ID for Edge DO enumeration (or CLOUDFLARE_ACCOUNT_ID env)',
  )
  .option(
    '--api-token <token>',
    'Cloudflare API Token for Edge DO enumeration (or CLOUDFLARE_API_TOKEN env)',
  )
  .action(
    async (options: {
      from: string;
      url?: string;
      serviceKey?: string;
      yes?: boolean;
      skipSecrets?: boolean;
      skipStorage?: boolean;
      accountId?: string;
      apiToken?: string;
    }) => {
      // Graceful shutdown on SIGINT
      const sigintHandler = () => {
        process.exit(130);
      };
      process.on('SIGINT', sigintHandler);

      const backupPath = resolve(options.from);
      const projectDir = resolve('.');
      let storageDirPath: string | null = null;
      let extractDirPath: string | null = null;

      try {
        if (!existsSync(backupPath)) {
          const message = `Backup file not found: ${backupPath}`;
          raiseCliError({
            code: 'backup_file_not_found',
            message,
            hint: 'Check the path passed to --from and retry.',
          });
        }

        const api = resolveOptions(options);

        logHuman(chalk.blue(`🔄 Restoring from: ${backupPath}`));
        logHuman();

        let backup: BackupFileV1_1;

        if (backupPath.endsWith('.tar.gz') || backupPath.endsWith('.tgz')) {
          extractDirPath = join(dirname(backupPath), `.tmp-restore-${Date.now()}`);
          mkdirSync(extractDirPath, { recursive: true });

          execFileSync('tar', ['-xzf', backupPath, '-C', extractDirPath], { stdio: 'pipe' });

          const jsonPath = join(extractDirPath, 'backup.json');
          if (!existsSync(jsonPath)) {
            throw new Error('backup.json not found in archive.');
          }

          backup = parseBackupFile(JSON.parse(readFileSync(jsonPath, 'utf-8')));

          const storageDir = join(extractDirPath, 'storage');
          if (existsSync(storageDir)) {
            storageDirPath = storageDir;
          }
        } else {
          backup = parseBackupFile(JSON.parse(readFileSync(backupPath, 'utf-8')));
        }

        const controlTableCount = Object.keys(backup.control.d1).length;
        const authShardCount = Object.keys(backup.auth.shards).length;
        const dbCount = Object.keys(backup.databases).length;
        const dataNamespaceCount = Object.keys(backup.dataNamespaces ?? {}).length;
        const d1TableCount = Object.keys(backup.auth.d1).length;
        const hasSecrets = !!backup.secrets && !options.skipSecrets;
        const hasStorage = (!!backup.storage || !!storageDirPath) && !options.skipStorage;

        if (hasStorage && !storageDirPath) {
          throw new Error(
            'Backup includes storage metadata but no extracted storage files were found. Restore from the .tar.gz archive or use --skip-storage.',
          );
        }

        logHuman(chalk.dim(`  Backup date: ${backup.timestamp}`));
        logHuman(chalk.dim(`  Source: ${backup.source}`));
        logHuman(chalk.dim(`  Control D1 tables: ${controlTableCount}`));
        logHuman(chalk.dim(`  Auth shards: ${authShardCount}`));
        logHuman(chalk.dim(`  Database DOs: ${dbCount}`));
        logHuman(chalk.dim(`  Data namespaces: ${dataNamespaceCount}`));
        logHuman(chalk.dim(`  D1 tables: ${d1TableCount}`));
        if (hasSecrets) {
          logHuman(chalk.dim(`  Secrets: ${Object.keys(backup.secrets!).length} keys`));
        }
        if (hasStorage) {
          const fileCount = backup.storage?.objects.length ?? collectFiles(storageDirPath!).length;
          logHuman(chalk.dim(`  R2 files: ${fileCount}`));
        }
        logHuman();

        if (hasSecrets && backup.secrets) {
          const backupDate = new Date(backup.timestamp);
          const ageMs = Date.now() - backupDate.getTime();
          const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
          const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
          const ageStr = ageDays > 0 ? `${ageDays} days ago` : `${ageHours} hours ago`;

          logHuman(chalk.yellow.bold('⚠ Secret Warning:'));
          logHuman(
            chalk.yellow(`  Backup secrets were created at ${backup.timestamp} (${ageStr}).`),
          );
          logHuman(
            chalk.yellow(
              '  Restoring these secrets will invalidate any JWTs issued after the backup.',
            ),
          );
          if (ageDays > 7) {
            logHuman(
              chalk.red('  ⚡ This backup is over 7 days old. Use caution when restoring secrets.'),
            );
          }
          logHuman();
        }

        if (!options.yes) {
          logHuman(chalk.red.bold('⚠ WARNING: This will WIPE and REPLACE all data at the target.'));
          logHuman(chalk.red(`  Target: ${api.url}`));
          logHuman();

          const confirmed = await confirmRestore(`  Type ${chalk.cyan('"restore"')} to confirm: `);
          if (!confirmed) {
            logHuman(chalk.yellow('  Aborted.'));
            return;
          }
          logHuman();
        }

        const restoreAccountId = options.accountId || process.env.CLOUDFLARE_ACCOUNT_ID;
        const restoreApiToken = options.apiToken || process.env.CLOUDFLARE_API_TOKEN;
        const isRestoreEdge = !!(restoreAccountId && restoreApiToken);
        let restoredSecrets = false;

        writeHuman(chalk.dim('  Restoring internal control plane...'));
        try {
          await apiCall(api, '/restore-control-d1', 'POST', { tables: backup.control.d1 });
          logHuman(chalk.green(' ✓'));
        } catch (err) {
          logHumanError(chalk.red(` ✗ ${errorMessage(err)}`));
          throw new Error(`CONTROL_DB restore failed: ${errorMessage(err)}`);
        }

        writeHuman(chalk.dim('  Restoring auth database...'));
        try {
          await apiCall(api, '/restore-d1', 'POST', { tables: backup.auth.d1 });
          logHuman(chalk.green(' ✓'));
        } catch (err) {
          logHumanError(chalk.red(` ✗ ${errorMessage(err)}`));
          throw new Error(`AUTH_DB restore failed: ${errorMessage(err)}`);
        }

        writeHuman(chalk.dim('  Checking for orphan DOs...'));
        let currentDOs: { dos: DOInfo[]; total: number };
        try {
          if (isRestoreEdge) {
            const cf: CloudflareAPIOptions = {
              accountId: restoreAccountId!,
              apiToken: restoreApiToken!,
            };
            const namespaces = await getCFNamespaces(cf);
            const allHexIds: string[] = [];
            for (const ns of namespaces) {
              const ids = await enumerateDOsViaCFAPI(cf, ns.id);
              allHexIds.push(...ids);
            }
            currentDOs = await apiCall<{ dos: DOInfo[]; total: number }>(api, '/list-dos', 'POST', {
              hexIds: allHexIds,
            });
          } else {
            currentDOs = await apiCall<{ dos: DOInfo[]; total: number }>(
              api,
              '/list-dos',
              'POST',
              {},
            );
          }
        } catch (err) {
          logHumanError(chalk.red(` ✗ ${errorMessage(err)}`));
          throw new Error(`Orphan DO enumeration failed: ${errorMessage(err)}`);
        }

        const backupDoNames = new Set([
          ...Object.keys(backup.auth.shards),
          ...Object.keys(backup.databases),
        ]);
        const orphans = currentDOs.dos.filter((item) => !backupDoNames.has(item.doName));
        if (orphans.length > 0) {
          const orphanFailures: string[] = [];
          let wiped = 0;
          for (const orphan of orphans) {
            try {
              await apiCall(api, '/wipe-do', 'POST', {
                doName: orphan.doName,
                type: orphan.type,
              });
              wiped++;
            } catch (err) {
              orphanFailures.push(`${orphan.doName}: ${errorMessage(err)}`);
            }
          }

          if (orphanFailures.length > 0) {
            logHumanError(chalk.red(` ✗ ${summarizeFailures('Orphan wipe', orphanFailures)}`));
            throw new Error(summarizeFailures('Orphan wipe', orphanFailures));
          }
          logHuman(chalk.green(` ✓ ${wiped} orphan DOs wiped`));
        } else {
          logHuman(chalk.green(' ✓ No orphans'));
        }

        const shardEntries = Object.entries(backup.auth.shards);
        if (shardEntries.length > 0) {
          let shardCount = 0;
          const shardTasks = shardEntries.map(([, doDump]) => async () => {
            shardCount++;
            writeHuman(
              `\r${chalk.dim(`  [${shardCount}/${shardEntries.length}] Restoring ${doDump.doName}...`)}`.padEnd(
                80,
              ),
            );
            await apiCall(api, '/restore-do', 'POST', {
              doName: doDump.doName,
              type: 'auth',
              tables: doDump.tables,
            });
          });

          const shardResults = await throttleSettled(shardTasks, 10);
          const shardFailures = collectSettledFailures(
            shardResults,
            shardEntries.map(([, doDump]) => doDump.doName),
          );
          if (shardFailures.length > 0) {
            logHumanError(
              `\r${chalk.red('✗')} ${summarizeFailures('Auth shard restore', shardFailures)}`.padEnd(
                80,
              ),
            );
            throw new Error(summarizeFailures('Auth shard restore', shardFailures));
          }
          logHuman(`\r${chalk.green('✓')} Restored ${shardEntries.length} Auth shards`.padEnd(80));
        }

        const dbEntries = Object.entries(backup.databases);
        if (dbEntries.length > 0) {
          let dbCount = 0;
          const dbTasks = dbEntries.map(([, doDump]) => async () => {
            dbCount++;
            writeHuman(
              `\r${chalk.dim(`  [${dbCount}/${dbEntries.length}] Restoring ${doDump.doName}...`)}`.padEnd(
                80,
              ),
            );
            await apiCall(api, '/restore-do', 'POST', {
              doName: doDump.doName,
              type: 'database',
              tables: doDump.tables,
            });
          });

          const dbResults = await throttleSettled(dbTasks, 10);
          const dbFailures = collectSettledFailures(
            dbResults,
            dbEntries.map(([, doDump]) => doDump.doName),
          );
          if (dbFailures.length > 0) {
            logHumanError(
              `\r${chalk.red('✗')} ${summarizeFailures('Database DO restore', dbFailures)}`.padEnd(
                80,
              ),
            );
            throw new Error(summarizeFailures('Database DO restore', dbFailures));
          }
          logHuman(`\r${chalk.green('✓')} Restored ${dbEntries.length} Database DOs`.padEnd(80));
        }

        const dataNamespaceEntries = Object.entries(backup.dataNamespaces ?? {});
        if (dataNamespaceEntries.length > 0) {
          let namespaceCount = 0;
          const namespaceTasks = dataNamespaceEntries.map(([, dump]) => async () => {
            namespaceCount++;
            writeHuman(
              `\r${chalk.dim(`  [${namespaceCount}/${dataNamespaceEntries.length}] Restoring data namespace ${dump.namespace}...`)}`.padEnd(
                80,
              ),
            );
            await apiCall(api, '/restore-data', 'POST', {
              namespace: dump.namespace,
              tables: dump.tables,
            });
          });

          const namespaceResults = await throttleSettled(namespaceTasks, 4);
          const namespaceFailures = collectSettledFailures(
            namespaceResults,
            dataNamespaceEntries.map(([, dump]) => dump.namespace),
          );
          if (namespaceFailures.length > 0) {
            logHumanError(
              `\r${chalk.red('✗')} ${summarizeFailures('Data namespace restore', namespaceFailures)}`.padEnd(
                80,
              ),
            );
            throw new Error(summarizeFailures('Data namespace restore', namespaceFailures));
          }
          logHuman(
            `\r${chalk.green('✓')} Restored ${dataNamespaceEntries.length} data namespace(s)`.padEnd(
              80,
            ),
          );
        }

        if (hasStorage && storageDirPath) {
          writeHuman(chalk.dim('  Wiping existing R2 storage...'));
          try {
            const wipeResult = await apiCall<{ deleted: number }>(
              api,
              '/restore-storage?action=wipe',
            );
            logHuman(chalk.green(` ✓ ${wipeResult.deleted} deleted`));
          } catch (err) {
            logHumanError(chalk.red(` ✗ ${errorMessage(err)}`));
            throw new Error(`R2 wipe failed: ${errorMessage(err)}`);
          }

          const filesToUpload = collectFiles(storageDirPath);
          if (filesToUpload.length > 0) {
            let uploadCount = 0;
            const uploadTasks = filesToUpload.map((file) => async () => {
              uploadCount++;
              writeHuman(
                `\r  [${uploadCount}/${filesToUpload.length}] Uploading ${file.rel}...`.padEnd(80),
              );

              const fileData = readFileSync(file.path);
              const meta = backup.storage?.objects.find((obj) => obj.key === file.rel);
              const contentType = meta?.contentType || 'application/octet-stream';

              await apiUpload(
                api,
                `/restore-storage?action=put&key=${encodeURIComponent(file.rel)}`,
                fileData,
                contentType,
              );
            });

            const uploadResults = await throttleSettled(uploadTasks, 5);
            const uploadFailures = collectSettledFailures(
              uploadResults,
              filesToUpload.map((file) => file.rel),
            );
            if (uploadFailures.length > 0) {
              logHumanError(
                `\r${chalk.red('✗')} ${summarizeFailures('R2 upload', uploadFailures)}`.padEnd(80),
              );
              throw new Error(summarizeFailures('R2 upload', uploadFailures));
            }
            logHuman(`\r${chalk.green('✓')} Uploaded ${filesToUpload.length} R2 files`.padEnd(80));
          }
        }

        writeHuman(chalk.dim('  Resyncing _users_public...'));
        try {
          const resyncResult = await apiCall<{
            ok: boolean;
            totalSynced: number;
            shards: Array<{ shardId: number; userCount: number }>;
          }>(api, '/resync-users-public', 'POST');
          logHuman(
            chalk.green(
              ` ✓ ${resyncResult.totalSynced} users synced from ${resyncResult.shards.length} shards`,
            ),
          );
        } catch (err) {
          logHuman(chalk.yellow(` ⚠ ${errorMessage(err)}`));
        }

        if (hasSecrets && backup.secrets) {
          writeHuman(chalk.dim('  Restoring secrets...'));
          try {
            writeSecrets(projectDir, backup.secrets);
            const targets = ['.dev.vars', '.edgebase/secrets.json'];
            const secretFailures: string[] = [];

            if (isRestoreEdge) {
              for (const [key, value] of Object.entries(backup.secrets)) {
                try {
                  execFileSync(npxCommand(), ['wrangler', 'secret', 'put', key], {
                    cwd: projectDir,
                    stdio: ['pipe', 'pipe', 'pipe'],
                    input: value,
                  });
                } catch (err) {
                  secretFailures.push(`${key}: ${errorMessage(err)}`);
                }
              }
              targets.push('Workers Secrets');
            }

            if (secretFailures.length > 0) {
              logHuman(
                chalk.yellow(
                  ` ⚠ Secrets were only partially restored: ${summarizeFailures('Workers Secrets sync', secretFailures)}`,
                ),
              );
            } else {
              restoredSecrets = true;
              logHuman(
                chalk.green(
                  ` ✓ ${Object.keys(backup.secrets).length} keys → ${targets.join(', ')}`,
                ),
              );
            }
          } catch (err) {
            logHuman(chalk.yellow(` ⚠ ${errorMessage(err)}`));
          }
        }

        logHuman();
        logHuman(chalk.green('✅ Restore complete!'));
        if (hasSecrets) {
          if (restoredSecrets) {
            logHuman(chalk.yellow('⚠'), 'Secrets restored. Existing JWT tokens remain valid.');
          } else {
            logHuman(
              chalk.yellow('⚠'),
              'Secrets were not fully restored. Re-login may be required.',
            );
          }
        } else {
          logHuman(chalk.yellow('⚠'), 'If JWT secrets differ, existing tokens will be invalid.');
        }
      } catch (err) {
        if (isCliStructuredError(err)) throw err;

        logHuman();
        logHumanError(chalk.red(`✗ Restore failed: ${errorMessage(err)}`));
        logHuman(
          chalk.yellow('⚠'),
          'Restore stopped before completion. Re-run from a clean target if needed.',
        );
        raiseCliError({
          code: 'backup_restore_failed',
          message: errorMessage(err),
          hint: 'Restore stopped before completion. Re-run from a clean target if needed.',
        });
      } finally {
        process.off('SIGINT', sigintHandler);
        if (extractDirPath && extractDirPath.includes('.tmp-restore-')) {
          rmSync(extractDirPath, { recursive: true, force: true });
        }
      }
    },
  );

/** Exported for testing */
export const _internals = {
  apiCall,
  apiBinary,
  apiUpload,
  parseDevVars,
  readSecrets,
  writeSecrets,
  collectFiles,
  resolveOptions,
  throttle,
  throttleSettled,
  errorMessage,
  outputJson,
  logHuman,
  logHumanError,
  writeHuman,
  collectSettledFailures,
  summarizeFailures,
  parseBackupFile,
  resolveDownloadSessionPaths,
  enumerateDOsViaCFAPI,
  getCFNamespaces,
};
