import { Command } from 'commander';
import { spawn, execFileSync } from 'node:child_process';
import { wranglerArgs, wranglerCommand, wranglerHint } from '../lib/wrangler.js';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  unlinkSync,
} from 'node:fs';
import { dirname, relative, resolve, join, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import chalk from 'chalk';
import { loadConfigSafe } from '../lib/load-config.js';
import { resolveRateLimitBindings } from '../lib/rate-limit-bindings.js';
import {
  buildRouteName,
  detectExports,
  generateFunctionRegistry,
  scanFunctions,
  validateRouteNames,
} from '../lib/function-registry.js';
import {
  extractDatabases,
  generateTempWranglerToml,
  mergePluginTables,
  type ProvisionedBinding,
} from '../lib/deploy-shared.js';
import {
  buildSnapshot,
  loadSnapshot,
  saveSnapshot,
  detectDestructiveChanges,
  filterAutoPassChanges,
  handleDestructiveChanges,
  resetLocalDoState,
  detectProviderChanges,
  detectAuthProviderChange,
} from '../lib/schema-check.js';
import {
  dumpCurrentData,
  restoreToNewProvider,
  promptMigration,
  type DumpedData,
  type MigrationOptions,
} from '../lib/migrator.js';
import { isCliStructuredError, raiseCliError } from '../lib/agent-contract.js';
import { resolveServiceKey as resolveServiceKeyFromOptions } from '../lib/resolve-options.js';
import { parseDevVars, parseEnvFile } from '../lib/dev-sidecar.js';
import { ensureCloudflareAuth, ensureWranglerToml, resolveApiToken } from '../lib/cf-auth.js';
import { spin } from '../lib/spinner.js';
import { isJson, isNonInteractive, isQuiet } from '../lib/cli-context.js';
import { promptConfirm } from '../lib/prompts.js';
import {
  injectCaptchaSiteKey,
  provisionTurnstile,
  storeSecretIfMissing,
} from '../lib/turnstile-provision.js';
import { listWranglerSecretNames } from '../lib/wrangler-secrets.js';
import {
  findCloudflareResourceRecord,
  readCloudflareDeployManifest,
  writeCloudflareDeployManifest,
  type CloudflareResourceRecord,
} from '../lib/cloudflare-deploy-manifest.js';
import { parseWranglerResourceConfig } from '../lib/cloudflare-wrangler-resources.js';
import {
  buildLegacyManagedD1DatabaseName,
  buildManagedD1DatabaseName,
} from '../lib/managed-resource-names.js';
import { upsertEnvValue } from '../lib/neon.js';
import {
  resolveProjectWorkerName,
  resolveProjectWorkerUrl,
} from '../lib/project-runtime.js';
import {
  ensureRuntimeScaffold,
  getRuntimeServerSrcDir,
  INTERNAL_D1_BINDINGS,
  writeRuntimeConfigShim,
} from '../lib/runtime-scaffold.js';

const FULL_CONFIG_EVAL = { allowRegexFallback: false } as const;
const RELEASE_ENV_HEADER = '# EdgeBase production secrets';

type AuthEnvField = 'clientId' | 'clientSecret' | 'issuer' | 'scopes';
type AuthProviderInspection = {
  provider: string;
  devEnabled: boolean;
  releaseEnabled: boolean;
  summary: string;
  canCopyToRelease: boolean;
  requiredFields: AuthEnvField[];
  missingReleaseFields: AuthEnvField[];
  missingDevelopmentFields: AuthEnvField[];
  developmentValues: Partial<Record<AuthEnvField, string>>;
  releaseValues: Partial<Record<AuthEnvField, string>>;
};

export function extractWorkerUrlFromWranglerDeployOutput(output: string): string {
  const matches = [...output.matchAll(/https:\/\/[A-Za-z0-9.-]+\.workers\.dev/g)].map(
    (match) => match[0],
  );
  return matches.at(-1) ?? '';
}

function resolveWorkerUrlFromProject(projectDir: string): string {
  return resolveProjectWorkerUrl(projectDir);
}

function resolveWorkerNameFromProject(projectDir: string): string {
  return resolveProjectWorkerName(projectDir);
}

function resolveDeployedWorkerUrl(projectDir: string, deployOutput: string): string {
  return (
    extractWorkerUrlFromWranglerDeployOutput(deployOutput)
    || process.env.EDGEBASE_URL
    || resolveWorkerUrlFromProject(projectDir)
  );
}

export async function resolveAdminUrlFromRuntime(workerUrl: string): Promise<string | null> {
  if (!workerUrl) {
    return null;
  }

  try {
    const response = await fetch(workerUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(5_000),
      headers: { accept: 'application/json' },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      return location ? new URL(location, workerUrl).toString() : null;
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      return null;
    }

    const payload = await response.json() as { admin?: unknown } | null;
    if (typeof payload?.admin !== 'string' || payload.admin.length === 0) {
      return null;
    }

    return new URL(payload.admin, workerUrl).toString();
  } catch {
    return null;
  }
}

/**
 * `npx edgebase deploy` — Config bundling + functions bundling + wrangler deploy.
 * 1. Reads edgebase.config.ts
 * 2. Validates config
 * 3. Scans functions/ directory and generates Lazy Import registry
 * 4. Bundles config as JSON into Worker
 * 5. Runs wrangler deploy
 * 6. Sends warming request to db:_system DO
 */

/**
 * Validate config for known issues.
 */
export function validateConfig(
  config: Record<string, unknown>,
  warnings: string[],
  errors: string[],
): void {
  const SERVICE_KEY_KID_PATTERN = /^[A-Za-z0-9-]+$/;

  // ─── Check 0: Release mode warning ───
  if (!config.release) {
    warnings.push(
      'release is false — all resources are accessible without access rules. ' +
        'Set release: true in edgebase.config.ts before production deployment.',
    );
  }

  // ─── Check 1: Inline Service Key warning ───
  // Production deploys should use secretSource: 'dashboard' (Workers Secrets).
  // Inline secrets risk leaking via git commits.
  const serviceKeys = config.serviceKeys as
    | {
      keys?: Array<{
        kid?: string;
        tier?: string;
        secretSource?: string;
        secretRef?: string;
        inlineSecret?: string;
        constraints?: { tenant?: string; ipCidr?: string[] };
      }>;
    }
    | undefined;
  if (serviceKeys?.keys) {
    const seenKids = new Set<string>();
    for (const [index, key] of serviceKeys.keys.entries()) {
      if (!key.kid || typeof key.kid !== 'string') {
        errors.push(`serviceKeys.keys[${index}].kid is required and must be a string.`);
        continue;
      }

      if (!SERVICE_KEY_KID_PATTERN.test(key.kid)) {
        errors.push(
          `serviceKeys.keys[${index}].kid '${key.kid}' is invalid. ` +
            `Use letters, numbers, and hyphens only. ` +
            `Underscore is reserved by the structured key format 'jb_{kid}_{secret}'.`,
        );
      }

      if (seenKids.has(key.kid)) {
        errors.push(`Duplicate Service Key kid '${key.kid}'. Each serviceKeys.keys entry must be unique.`);
      } else {
        seenKids.add(key.kid);
      }

      if (key.secretSource === 'dashboard' && (!key.secretRef || typeof key.secretRef !== 'string')) {
        errors.push(
          `serviceKeys.keys[${index}] (${key.kid}): secretSource 'dashboard' requires a non-empty secretRef.`,
        );
      }

      if (key.secretSource === 'inline' && (!key.inlineSecret || typeof key.inlineSecret !== 'string')) {
        errors.push(
          `serviceKeys.keys[${index}] (${key.kid}): secretSource 'inline' requires a non-empty inlineSecret.`,
        );
      }
    }

    const inlineKeys = serviceKeys.keys.filter((k) => k.secretSource === 'inline');
    if (inlineKeys.length > 0) {
      const kids = inlineKeys.map((k) => k.kid ?? 'unknown').join(', ');
      warnings.push(
        `Service Key(s) [${kids}] use secretSource: 'inline' — ` +
          `inline secrets are stored in edgebase.config.ts and risk leaking via git. ` +
          `Use secretSource: 'dashboard' with Workers Secrets for production.`,
      );
    }

    const rootKeys = serviceKeys.keys.filter((k) => k.tier === 'root');
    if (
      rootKeys.length > 0
      && rootKeys.every((key) => !!key.constraints?.tenant || !!key.constraints?.ipCidr?.length)
    ) {
      warnings.push(
        'All root-tier Service Keys are request-scoped via tenant/ipCidr constraints. ' +
          'Internal EdgeBase self-calls for auth hooks, storage hooks, plugin migrations, and function admin helpers ' +
          'need at least one root-tier key without tenant/ipCidr constraints. Prefer a dedicated root key with secretRef: \'SERVICE_KEY\'.',
      );
    }
  }

  // ─── Check 2: Table name uniqueness across DB blocks (§18) ───
  // Different DB blocks must not share table names — this would cause DO routing collisions.
  const RESERVED_TOP_KEYS = new Set([
    'release',
    'storage',
    'rooms',
    'auth',
    'serviceKeys',
    'captcha',
    'email',
    'push',
    'plugins',
    'rateLimits',
    'functions',
    'databases',
  ]);
  const seenTables = new Map<string, string>(); // tableName → dbKey
  for (const [dbKey, dbBlock] of Object.entries(
    (config.databases as Record<string, unknown> | undefined) ?? {},
  )) {
    if (RESERVED_TOP_KEYS.has(dbKey)) continue;
    const tables = (dbBlock as Record<string, unknown>)?.tables;
    if (!tables || typeof tables !== 'object') continue;
    for (const tableName of Object.keys(tables as Record<string, unknown>)) {
      if (seenTables.has(tableName)) {
        errors.push(
          `Table name '${tableName}' is duplicated in DB block '${seenTables.get(tableName)}' and '${dbKey}'. ` +
            `Table names must be unique across all DB blocks.`,
        );
      } else {
        seenTables.set(tableName, dbKey);
      }
    }
  }
}

export function collectManagedCronSchedules(
  config: Record<string, unknown> | null | undefined,
): string[] {
  const cronSchedules: string[] = [];

  const maybeFunctions = config?.functions;
  if (maybeFunctions && typeof maybeFunctions === 'object') {
    const fns = maybeFunctions as Record<string, { trigger?: { type: string; cron?: string } }>;
    for (const fn of Object.values(fns)) {
      if (fn?.trigger?.type === 'schedule' && fn.trigger.cron && !cronSchedules.includes(fn.trigger.cron)) {
        cronSchedules.push(fn.trigger.cron);
      }
    }
  }

  const extraCrons = (
    (config?.cloudflare as { extraCrons?: unknown } | undefined)?.extraCrons
  );
  if (Array.isArray(extraCrons)) {
    for (const cron of extraCrons) {
      if (typeof cron === 'string' && !cronSchedules.includes(cron)) {
        cronSchedules.push(cron);
      }
    }
  }

  if (!cronSchedules.includes('0 3 * * *')) {
    cronSchedules.push('0 3 * * *');
  }

  return cronSchedules;
}

/** Exported for testing */
export const _internals = {
  buildRouteName,
  detectExports,
  scanFunctions,
  generateFunctionRegistry,
  validateRouteNames,
  mergePluginTables,
  provisionKvNamespaces,
  provisionD1Databases,
  provisionSingleInstanceD1Databases,
  buildMergedKvConfig,
  dedupeBindingConfigs,
  buildMergedD1Config,
  parseWranglerJsonOutput,
  parseHyperdriveListOutput,
  dedupeManifestResources,
  provisionVectorizeIndexes,
  generateTempWranglerToml,
  provisionTurnstile,
  storeSecretIfMissing,
  injectCaptchaSiteKey,
  extractDatabases,
  collectManagedCronSchedules,
  isPostgresProvider,
  isHyperdriveAlreadyExistsError,
  resolveAdminUrlFromRuntime,
  resolveReleaseSecretVars,
  inspectAuthEnv,
  collectAuthEnvWarnings,
  copyDevelopmentAuthProviderToRelease,
  resolveExistingR2BucketRecord,
};

// ─── KV/D1/Vectorize Auto-Provisioning ───

function dedupeBindingConfigs<T extends { binding: string }>(
  config: Record<string, T>,
): Record<string, T> {
  const deduped: Record<string, T> = {};
  const seenBindings = new Set<string>();

  for (const [name, value] of Object.entries(config)) {
    if (!value?.binding || seenBindings.has(value.binding)) continue;
    deduped[name] = value;
    seenBindings.add(value.binding);
  }

  return deduped;
}

function buildInternalKvConfig(): Record<string, { binding: string }> {
  return {
    internal: { binding: 'KV' },
  };
}

function buildMergedKvConfig(
  explicitKvConfig: Record<string, { binding: string }> | undefined,
): Record<string, { binding: string }> {
  const merged: Record<string, { binding: string }> = {};
  const add = (entries: Record<string, { binding: string }>) => {
    const deduped = dedupeBindingConfigs(entries);
    const existingBindings = new Set(Object.values(merged).map((entry) => entry.binding));

    for (const [name, value] of Object.entries(deduped)) {
      if (existingBindings.has(value.binding)) continue;
      merged[name] = value;
      existingBindings.add(value.binding);
    }
  };

  add(buildInternalKvConfig());
  if (explicitKvConfig) add(explicitKvConfig);

  return merged;
}

function parseWranglerJsonOutput<T>(output: string): T {
  const trimmed = output.trim();
  const candidates = [trimmed, trimmed.slice(trimmed.indexOf('[')), trimmed.slice(trimmed.indexOf('{'))]
    .filter((candidate, index, arr) => candidate && arr.indexOf(candidate) === index);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error('Unexpected Wrangler JSON output.');
}

function parseHyperdriveListOutput(output: string): Array<{ id: string; name: string }> {
  const trimmed = output.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    return parseWranglerJsonOutput(output);
  }

  const rows: Array<{ id: string; name: string }> = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim().startsWith('│')) {
      continue;
    }

    const cells = line
      .split('│')
      .slice(1, -1)
      .map((cell) => cell.trim());

    if (cells.length < 2) {
      continue;
    }

    const [id, name] = cells;
    if (id === 'id' || name === 'name' || !/^[a-f0-9]{32}$/i.test(id)) {
      continue;
    }

    rows.push({ id, name });
  }

  return rows;
}

function listHyperdriveConfigs(projectDir: string): Array<{ id: string; name: string }> {
  try {
    const output = execFileSync(
      wranglerCommand(),
      wranglerArgs(['wrangler', 'hyperdrive', 'list']),
      {
        cwd: projectDir,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    return parseHyperdriveListOutput(output);
  } catch {
    return [];
  }
}

function isHyperdriveAlreadyExistsError(message: string): boolean {
  return /already exists\s*\[code:\s*2017\]/i.test(message);
}

function isR2BucketAlreadyExistsError(message: string): boolean {
  return /bucket.+already exists|already own bucket|bucket named.+already exists/i.test(message);
}

/**
 * Diagnose common Cloudflare provisioning errors and return actionable hints.
 */
function diagnoseProvisioningError(
  resourceType: 'R2' | 'D1' | 'KV' | 'Hyperdrive' | 'Vectorize',
  errorMessage: string,
): string[] {
  const hints: string[] = [];
  // Strip ANSI escape codes before pattern matching
  const msg = errorMessage.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').toLowerCase();

  // R2 not enabled
  if (msg.includes('please enable r2') || msg.includes('code: 10042') || (msg.includes('r2') && msg.includes('enable'))) {
    hints.push('R2 is not enabled on your Cloudflare account.');
    hints.push('To enable: Cloudflare Dashboard → R2 Object Storage → Get Started');
    hints.push(`Or remove 'storage' from edgebase.config.ts if your app doesn't need file storage.`);
    return hints;
  }

  // Authentication / permission errors
  if (msg.includes('authentication error') || msg.includes('code: 10000')) {
    hints.push('Authentication failed — your Cloudflare token may have expired or lack permissions.');
    hints.push('Try: npx wrangler login');
    if (resourceType === 'D1') {
      hints.push('Ensure your API token has D1 edit permissions.');
    }
    return hints;
  }

  // Quota / limit errors
  if (msg.includes('quota') || msg.includes('limit') || msg.includes('exceeded') || msg.includes('maximum')) {
    hints.push(`You may have reached the ${resourceType} resource limit on your Cloudflare plan.`);
    hints.push('Check your plan limits: Cloudflare Dashboard → Workers & Pages → Plans');
    if (resourceType === 'D1') {
      hints.push('Free plan allows up to 10 D1 databases. Delete unused databases or upgrade your plan.');
    }
    return hints;
  }

  // Paid plan required
  if (msg.includes('paid') || msg.includes('upgrade') || msg.includes('subscription')) {
    hints.push(`${resourceType} may require a paid Workers plan.`);
    hints.push('Check: Cloudflare Dashboard → Workers & Pages → Plans');
    return hints;
  }

  // Network / timeout
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('econnrefused') || msg.includes('network') || msg.includes('fetch failed') || msg.includes('slow network')) {
    hints.push('Network error — check your internet connection and try again.');
    return hints;
  }

  return hints;
}

function toManifestResourceRecord(binding: ProvisionedBinding): CloudflareResourceRecord {
  return {
    type: binding.type,
    name: binding.name,
    binding: binding.binding,
    id: binding.id,
    managed: binding.managed ?? true,
    source: binding.source ?? 'existing',
  };
}

function dedupeManifestResources(resources: CloudflareResourceRecord[]): CloudflareResourceRecord[] {
  const seen = new Map<string, CloudflareResourceRecord>();

  for (const resource of resources) {
    const logicalName = resource.binding ?? resource.name;
    const key = [resource.type, logicalName].join(':');
    seen.set(key, resource);
  }

  return Array.from(seen.values());
}

function resolveExistingR2BucketRecord(
  existingRecord: CloudflareResourceRecord | null | undefined,
): Pick<CloudflareResourceRecord, 'managed' | 'source'> {
  if (existingRecord?.source === 'created') {
    return {
      managed: existingRecord.managed ?? true,
      source: 'created',
    };
  }

  return {
    managed: false,
    source: existingRecord?.source ?? 'existing',
  };
}

function provisionR2Buckets(
  projectDir: string,
  previousManifest: ReturnType<typeof readCloudflareDeployManifest>,
): CloudflareResourceRecord[] {
  const wranglerPath = join(projectDir, 'wrangler.toml');
  if (!existsSync(wranglerPath)) return [];

  const wranglerContent = readFileSync(wranglerPath, 'utf-8');
  const { r2Buckets } = parseWranglerResourceConfig(wranglerContent);
  const resources: CloudflareResourceRecord[] = [];

  for (const bucket of r2Buckets) {
    const existingRecord = findCloudflareResourceRecord(previousManifest, {
      type: 'r2_bucket',
      name: bucket.bucketName,
      binding: bucket.binding,
      id: bucket.bucketName,
    });
    const args = ['wrangler', 'r2', 'bucket', 'create', bucket.bucketName];
    if (bucket.jurisdiction) {
      args.push(`--jurisdiction=${bucket.jurisdiction}`);
    }

    try {
      execFileSync(wranglerCommand(), wranglerArgs(args), {
        cwd: projectDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      console.log(chalk.green('✓'), `R2 '${bucket.binding}': created → ${bucket.bucketName}`);
      resources.push({
        type: 'r2_bucket',
        name: bucket.bucketName,
        binding: bucket.binding,
        id: bucket.bucketName,
        managed: true,
        source: 'created',
        metadata: bucket.jurisdiction ? { jurisdiction: bucket.jurisdiction } : undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isR2BucketAlreadyExistsError(msg)) {
        const ownership = resolveExistingR2BucketRecord(existingRecord);
        console.log(chalk.dim(`  R2 '${bucket.binding}': already exists → ${bucket.bucketName}`));
        resources.push({
          type: 'r2_bucket',
          name: bucket.bucketName,
          binding: bucket.binding,
          id: bucket.bucketName,
          managed: ownership.managed,
          source: ownership.source,
          metadata: bucket.jurisdiction ? { jurisdiction: bucket.jurisdiction } : undefined,
        });
        continue;
      }
      console.log(chalk.red('✗'), `R2 '${bucket.binding}': provisioning failed — ${msg}`);
      const hints = diagnoseProvisioningError('R2', msg);
      for (const hint of hints) {
        console.log(chalk.dim(`    ${hint}`));
      }
    }
  }

  return resources;
}

/**
 * Provision KV namespaces declared in config.kv.
 * For each namespace: check if it exists via `wrangler kv namespace list`,
 * create if missing via `wrangler kv namespace create`.
 */
function provisionKvNamespaces(
  kvConfig: Record<string, { binding: string }>,
  projectDir: string,
): ProvisionedBinding[] {
  const bindings: ProvisionedBinding[] = [];
  const dedupedKvConfig = dedupeBindingConfigs(kvConfig);

  // Get existing KV namespaces
  let existingNamespaces: Array<{ title: string; id: string }> = [];
  try {
    const output = execFileSync(
      wranglerCommand(),
      wranglerArgs(['wrangler', 'kv', 'namespace', 'list']),
      {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    existingNamespaces = parseWranglerJsonOutput(output);
  } catch {
    // If listing fails, we'll try to create each one
  }

  for (const [name, config] of Object.entries(dedupedKvConfig)) {
    const bindingName = config.binding;
    // Convention: Wrangler uses Worker name prefix in title
    const existing = existingNamespaces.find(
      (ns) => ns.title.endsWith(`-${bindingName}`) || ns.title === bindingName,
    );

    if (existing) {
      console.log(
        chalk.dim(`  KV '${name}' (${bindingName}): already exists → ${existing.id.slice(0, 8)}…`),
      );
      bindings.push({
        type: 'kv_namespace',
        name,
        binding: bindingName,
        id: existing.id,
        managed: true,
        source: 'existing',
      });
    } else {
      // Create new KV namespace
      try {
        const output = execFileSync(
          wranglerCommand(),
          wranglerArgs(['wrangler', 'kv', 'namespace', 'create', bindingName]),
          {
            cwd: projectDir,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        );
        // Extract ID from output: "Add the following to your configuration file..."
        // "kv_namespaces = [{ binding = "...", id = "..." }]"
        const idMatch = output.match(/id\s*=\s*"([^"]+)"/);
        if (idMatch) {
          console.log(
            chalk.green('✓'),
            `KV '${name}' (${bindingName}): created → ${idMatch[1].slice(0, 8)}…`,
          );
          bindings.push({
            type: 'kv_namespace',
            name,
            binding: bindingName,
            id: idMatch[1],
            managed: true,
            source: 'created',
          });
        } else {
          console.log(
            chalk.yellow('⚠'),
            `KV '${name}': created but could not parse ID from wrangler output. Skipping managed binding registration.`,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(chalk.red('✗'), `KV '${name}': provisioning failed — ${msg}`);
        const hints = diagnoseProvisioningError('KV', msg);
        for (const hint of hints) {
          console.log(chalk.dim(`    ${hint}`));
        }
      }
    }
  }

  return bindings;
}

/**
 * Provision D1 databases declared in config.d1.
 * For each database: check via `wrangler d1 list`, create if missing.
 */
function provisionD1Databases(
  d1Config: Record<string, { binding: string }>,
  projectDir: string,
  options?: {
    previousManifest?: ReturnType<typeof readCloudflareDeployManifest>;
  },
): ProvisionedBinding[] {
  const bindings: ProvisionedBinding[] = [];
  const dedupedD1Config = dedupeBindingConfigs(d1Config);
  const workerName = resolveProjectWorkerName(projectDir) || 'edgebase';

  // Get existing D1 databases
  let existingDatabases: Array<{ name: string; uuid: string }> = [];
  try {
    const output = execFileSync(
      wranglerCommand(),
      wranglerArgs(['wrangler', 'd1', 'list', '--json']),
      {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    existingDatabases = parseWranglerJsonOutput(output);
  } catch {
    // If listing fails, we'll try to create each one
  }

  for (const [name, config] of Object.entries(dedupedD1Config)) {
    const bindingName = config.binding;
    const dbName = buildManagedD1DatabaseName(workerName, name);
    const legacyDbName = buildLegacyManagedD1DatabaseName(name);
    const allowLegacyReuse = !!findCloudflareResourceRecord(options?.previousManifest ?? null, {
      type: 'd1_database',
      name,
      binding: bindingName,
    });
    const existing = existingDatabases.find(
      (db) => db.name === dbName || (allowLegacyReuse && db.name === legacyDbName),
    );

    if (existing) {
      console.log(
        chalk.dim(
          `  D1 '${name}' (${bindingName}): already exists → ${existing.uuid.slice(0, 8)}…`,
        ),
      );
      bindings.push({
        type: 'd1_database',
        name,
        binding: bindingName,
        id: existing.uuid,
        managed: true,
        source: 'existing',
      });
    } else {
      try {
        const output = execFileSync(wranglerCommand(), wranglerArgs(['wrangler', 'd1', 'create', dbName]), {
          cwd: projectDir,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const idMatch = output.match(/database_id\s*=\s*"([^"]+)"/);
        if (idMatch) {
          console.log(
            chalk.green('✓'),
            `D1 '${name}' (${bindingName}): created → ${idMatch[1].slice(0, 8)}…`,
          );
          bindings.push({
            type: 'd1_database',
            name,
            binding: bindingName,
            id: idMatch[1],
            managed: true,
            source: 'created',
          });
        } else {
          console.log(
            chalk.yellow('⚠'),
            `D1 '${name}': created but could not parse ID. Skipping managed binding registration.`,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(chalk.red('✗'), `D1 '${name}': provisioning failed — ${msg}`);
        const hints = diagnoseProvisioningError('D1', msg);
        for (const hint of hints) {
          console.log(chalk.dim(`    ${hint}`));
        }
      }
    }
  }

  return bindings;
}

function provisionInternalD1Databases(
  projectDir: string,
  options?: {
    previousManifest?: ReturnType<typeof readCloudflareDeployManifest>;
  },
): ProvisionedBinding[] {
  const d1Config = buildInternalD1Config();
  return provisionD1Databases(d1Config, projectDir, options);
}

/**
 * Provision D1 databases for single-instance DB namespaces.
 * Same routing logic as server's shouldRouteToD1() — namespaces without
 * instance flag, DB-level access callbacks, and non-DO providers default to D1.
 *
 * Builds a D1 config map and delegates to provisionD1Databases().
 * Convention: binding = DB_D1_{NAMESPACE_UPPER}, database_name = edgebase-db-{namespace}
 */
interface DeployDbBlockMeta {
  provider?: string;
  connectionString?: string;
  instance?: boolean;
  access?: { canCreate?: unknown; access?: unknown };
  tables?: unknown;
}

function buildInternalD1Config(): Record<string, { binding: string }> {
  return Object.fromEntries(INTERNAL_D1_BINDINGS.map(({ name, binding }) => [name, { binding }]));
}

function isDynamicDbBlock(dbBlock: DeployDbBlockMeta): boolean {
  if (dbBlock.instance) return true;
  // loadConfigSafe() strips function values, so DB-level access often arrives
  // as an empty object. Presence still means "this namespace is dynamic".
  if (dbBlock.access && typeof dbBlock.access === 'object') return true;
  return false;
}

function isPostgresProvider(provider?: string): boolean {
  return provider === 'neon' || provider === 'postgres';
}

function buildSingleInstanceD1Config(
  databasesConfig: Record<string, DeployDbBlockMeta>,
): Record<string, { binding: string }> {
  const d1Map: Record<string, { binding: string }> = {};

  for (const [namespace, dbBlock] of Object.entries(databasesConfig)) {
    if (!dbBlock) continue;
    const provider = dbBlock.provider;
    if (provider === 'neon' || provider === 'postgres' || provider === 'do') continue;
    if (provider !== 'd1' && isDynamicDbBlock(dbBlock)) continue;
    d1Map[`db-${namespace}`] = { binding: `DB_D1_${namespace.toUpperCase()}` };
  }

  return d1Map;
}

function buildMergedD1Config(
  explicitD1Config: Record<string, { binding: string }> | undefined,
  databasesConfig: Record<string, DeployDbBlockMeta> | undefined,
): Record<string, { binding: string }> {
  const merged: Record<string, { binding: string }> = {};
  const add = (entries: Record<string, { binding: string }>) => {
    const deduped = dedupeBindingConfigs(entries);
    const existingBindings = new Set(Object.values(merged).map((entry) => entry.binding));

    for (const [name, value] of Object.entries(deduped)) {
      if (existingBindings.has(value.binding)) continue;
      merged[name] = value;
      existingBindings.add(value.binding);
    }
  };

  add(buildInternalD1Config());
  if (databasesConfig) add(buildSingleInstanceD1Config(databasesConfig));
  if (explicitD1Config) add(explicitD1Config);

  return merged;
}

function provisionSingleInstanceD1Databases(
  databasesConfig: Record<string, DeployDbBlockMeta>,
  projectDir: string,
  options?: {
    previousManifest?: ReturnType<typeof readCloudflareDeployManifest>;
  },
): ProvisionedBinding[] {
  const d1Map = buildSingleInstanceD1Config(databasesConfig);
  if (Object.keys(d1Map).length === 0) return [];
  return provisionD1Databases(d1Map, projectDir, options);
}

/**
 * Provision Vectorize indexes declared in config.vectorize.
 * For each index: check via `wrangler vectorize list`, create if missing.
 */
function provisionVectorizeIndexes(
  vectorizeConfig: Record<string, { dimensions?: number; metric?: string; binding?: string }>,
  projectDir: string,
): ProvisionedBinding[] {
  const bindings: ProvisionedBinding[] = [];

  // Get existing Vectorize indexes
  let existingIndexes: Array<{ name: string }> = [];
  try {
    const output = execFileSync(
      wranglerCommand(),
      wranglerArgs(['wrangler', 'vectorize', 'list', '--json']),
      {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    existingIndexes = parseWranglerJsonOutput(output);
  } catch {
    // Vectorize may not be available (free plan)
  }

  for (const [name, config] of Object.entries(vectorizeConfig)) {
    const bindingName = config.binding ?? `VECTORIZE_${name.toUpperCase()}`;
    const indexName = `edgebase-${name}`;
    const existing = existingIndexes.find((idx) => idx.name === indexName);

    if (existing) {
      console.log(chalk.dim(`  Vectorize '${name}' (${bindingName}): already exists`));
      bindings.push({
        type: 'vectorize',
        name,
        binding: bindingName,
        id: indexName,
        managed: true,
        source: 'existing',
      });
    } else {
      const dimensions = config.dimensions ?? 1536;
      const metric = config.metric ?? 'cosine';
      try {
        execFileSync(
          wranglerCommand(),
          wranglerArgs([
            'wrangler',
            'vectorize',
            'create',
            indexName,
            `--dimensions=${dimensions}`,
            `--metric=${metric}`,
          ]),
          {
            cwd: projectDir,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        );
        console.log(
          chalk.green('✓'),
          `Vectorize '${name}' (${bindingName}): created (${dimensions}d, ${metric})`,
        );
        bindings.push({
          type: 'vectorize',
          name,
          binding: bindingName,
          id: indexName,
          managed: true,
          source: 'created',
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(chalk.yellow('⚠'), `Vectorize '${name}': provisioning failed — ${msg}`);
        const vectorizeHints = diagnoseProvisioningError('Vectorize', msg);
        if (vectorizeHints.length > 0) {
          for (const hint of vectorizeHints) {
            console.log(chalk.dim(`    ${hint}`));
          }
        } else {
          console.log(chalk.dim('    Vectorize requires a paid Workers plan.'));
        }
      }
    }
  }

  return bindings;
}

/**
 * Read a single env value from a .env file by key.
 */
function readEnvValue(envPath: string, key: string): string | undefined {
  if (!existsSync(envPath)) return undefined;
  const content = readFileSync(envPath, 'utf-8');
  const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'));
  return match?.[1]?.trim();
}

function runProjectPostScaffoldHook(projectDir: string): void {
  const hookPath = join(projectDir, 'scripts', 'edgebase-post-scaffold.mjs');
  if (!existsSync(hookPath)) return;

  console.log(chalk.dim(`  Running project post-scaffold hook: ${basename(hookPath)}`));
  execFileSync(process.execPath, [hookPath, '--project-dir', projectDir], {
    cwd: projectDir,
    stdio: 'inherit',
  });
}

/**
 * Provision Hyperdrive configs for database blocks with provider='neon'|'postgres'.
 * For each DB block with non-DO provider: check if Hyperdrive config exists,
 * create if missing via `wrangler hyperdrive create`.
 * Connection string is read from .env.release (DB_POSTGRES_{NAMESPACE}_URL by default,
 * or the db block's custom connectionString env key when provided).
 *
 * Binding convention: DB_POSTGRES_{NAMESPACE_UPPER}
 * Hyperdrive name: edgebase-db-{namespace}
 */
function provisionProviderHyperdrives(
  databases: Record<string, DeployDbBlockMeta>,
  projectDir: string,
): ProvisionedBinding[] {
  const bindings: ProvisionedBinding[] = [];

  // Filter to PostgreSQL-backed DB blocks
  const pgBlocks = Object.entries(databases).filter(
    ([, block]) => isPostgresProvider(block.provider),
  );
  if (pgBlocks.length === 0) return bindings;

  // Get existing Hyperdrive configs
  let existingConfigs = listHyperdriveConfigs(projectDir);

  for (const [namespace, block] of pgBlocks) {
    const hdName = `edgebase-db-${namespace}`;
    const normalized = namespace.toUpperCase().replace(/-/g, '_');
    const bindingName = `DB_POSTGRES_${normalized}`;
    const existing = existingConfigs.find((c) => c.name === hdName);

    if (existing) {
      console.log(
        chalk.dim(
          `  Hyperdrive '${namespace}' (provider): already exists → ${existing.id.slice(0, 8)}…`,
        ),
      );
      bindings.push({
        type: 'hyperdrive',
        name: namespace,
        binding: bindingName,
        id: existing.id,
        managed: true,
        source: 'existing',
      });
      continue;
    }

    // Read connection string from .env.release
    const envReleasePath = join(projectDir, '.env.release');
    const secretKey = block.connectionString ?? `${bindingName}_URL`;
    const connectionString = readEnvValue(envReleasePath, secretKey);

    if (!connectionString) {
      const setupHint = block.provider === 'neon'
        ? `\n    Or run npx edgebase neon setup --namespace ${namespace}`
        : '';
      console.warn(
        chalk.yellow(
          `  ⚠ Hyperdrive '${namespace}' (provider): connection string not found.\n` +
            `    Add ${secretKey}=postgres://... to .env.release${setupHint}`,
        ),
      );
      continue;
    }

    // Create Hyperdrive config
    try {
      const output = execFileSync(
        wranglerCommand(),
        wranglerArgs(['wrangler', 'hyperdrive', 'create', hdName, `--connection-string=${connectionString}`]),
        { cwd: projectDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
      );

      // Parse ID from output
      const idMatch = output.match(/id\s*=\s*"?([a-f0-9-]+)"?/i);
      if (idMatch) {
        bindings.push({
          type: 'hyperdrive',
          name: namespace,
          binding: bindingName,
          id: idMatch[1],
          managed: true,
          source: 'created',
        });
        console.log(
          chalk.green('✓'),
          `Hyperdrive '${namespace}' (provider): created → ${idMatch[1].slice(0, 8)}…`,
        );
      } else {
        console.log(
          chalk.yellow('⚠'),
          `Hyperdrive '${namespace}' (provider): created but could not parse ID. Skipping managed binding registration.`,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isHyperdriveAlreadyExistsError(msg)) {
        const existingConfig = listHyperdriveConfigs(projectDir).find((config) => config.name === hdName);
        if (existingConfig) {
          console.log(
            chalk.dim(
              `  Hyperdrive '${namespace}' (provider): already exists → ${existingConfig.id.slice(0, 8)}…`,
            ),
          );
          bindings.push({
            type: 'hyperdrive',
            name: namespace,
            binding: bindingName,
            id: existingConfig.id,
            managed: true,
            source: 'existing',
          });
          existingConfigs = [...existingConfigs, existingConfig];
          continue;
        }
      }
      console.log(
        chalk.yellow('⚠'),
        `Hyperdrive '${namespace}' (provider): provisioning failed — ${msg}`,
      );
      const hints = diagnoseProvisioningError('Hyperdrive', msg);
      for (const hint of hints) {
        console.log(chalk.dim(`    ${hint}`));
      }
    }
  }

  return bindings;
}

/**
 * Provision Hyperdrive config for auth PostgreSQL when config.auth.provider is 'neon'|'postgres'.
 * Follows the same pattern as provisionProviderHyperdrives but for a single global auth binding.
 *
 * Binding name: AUTH_POSTGRES (matches getAuthPostgresBindingName() in server)
 * Hyperdrive name: edgebase-auth
 * Connection string: read from .env.release AUTH_POSTGRES_URL (or config.auth.connectionString)
 */
function provisionAuthPostgresHyperdrive(
  authConfig: { provider?: string; connectionString?: string },
  projectDir: string,
): ProvisionedBinding[] {
  const bindings: ProvisionedBinding[] = [];
  const provider = authConfig.provider;

  if (provider !== 'neon' && provider !== 'postgres') return bindings;

  const hdName = 'edgebase-auth';
  const bindingName = 'AUTH_POSTGRES';

  // Check existing Hyperdrive configs
  const existingConfigs = listHyperdriveConfigs(projectDir);

  const existing = existingConfigs.find((c) => c.name === hdName);
  if (existing) {
    console.log(
      chalk.dim(`  Hyperdrive 'auth' (${provider}): already exists → ${existing.id.slice(0, 8)}…`),
    );
    bindings.push({
      type: 'hyperdrive',
      name: 'auth',
      binding: bindingName,
      id: existing.id,
      managed: true,
      source: 'existing',
    });
    return bindings;
  }

  // Read connection string from .env.release
  const envReleasePath = join(projectDir, '.env.release');
  const secretKey = authConfig.connectionString ?? 'AUTH_POSTGRES_URL';
  const connectionString = readEnvValue(envReleasePath, secretKey);

  if (!connectionString) {
    const setupHint = provider === 'neon'
      ? '\n    Or run npx edgebase neon setup --auth'
      : '';
    console.warn(
      chalk.yellow(
        `  ⚠ Hyperdrive 'auth' (${provider}): connection string not found.\n` +
          `    Add ${secretKey}=postgres://... to .env.release${setupHint}`,
      ),
    );
    return bindings;
  }

  // Create Hyperdrive config
  try {
    const output = execFileSync(
      wranglerCommand(),
      wranglerArgs(['wrangler', 'hyperdrive', 'create', hdName, `--connection-string=${connectionString}`]),
      { cwd: projectDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );

    // Parse ID from output
    const idMatch = output.match(/id\s*=\s*"?([a-f0-9-]+)"?/i);
    if (idMatch) {
      bindings.push({
        type: 'hyperdrive',
        name: 'auth',
        binding: bindingName,
        id: idMatch[1],
        managed: true,
        source: 'created',
      });
      console.log(
        chalk.green('✓'),
        `Hyperdrive 'auth' (${provider}): created → ${idMatch[1].slice(0, 8)}…`,
      );
    } else {
      console.log(
        chalk.yellow('⚠'),
        `Hyperdrive 'auth' (${provider}): created but could not parse ID. Skipping managed binding registration.`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isHyperdriveAlreadyExistsError(msg)) {
      const existingConfig = listHyperdriveConfigs(projectDir).find((config) => config.name === hdName);
      if (existingConfig) {
        console.log(
          chalk.dim(`  Hyperdrive 'auth' (${provider}): already exists → ${existingConfig.id.slice(0, 8)}…`),
        );
        bindings.push({
          type: 'hyperdrive',
          name: 'auth',
          binding: bindingName,
          id: existingConfig.id,
          managed: true,
          source: 'existing',
        });
        return bindings;
      }
    }
    console.log(chalk.yellow('⚠'), `Hyperdrive 'auth' (${provider}): provisioning failed — ${msg}`);
    const hints = diagnoseProvisioningError('Hyperdrive', msg);
    for (const hint of hints) {
      console.log(chalk.dim(`    ${hint}`));
    }
  }

  return bindings;
}

export const deployCommand = new Command('deploy')
  .alias('dp')
  .description('Deploy to Cloudflare')
  .option('--dry-run', 'Validate config without deploying')
  .option(
    '--if-destructive <action>',
    'Action on destructive schema changes in CI/CD: reject (default) or reset',
    'reject',
  )
  .action(async (options: { dryRun?: boolean; ifDestructive?: string }) => {
    const projectDir = resolve('.');
    const configPath = join(projectDir, 'edgebase.config.ts');
    const isDryRun = !!options.dryRun;
    const isTTY = !!process.stdin.isTTY;

    if (!existsSync(configPath)) {
      raiseCliError({
        code: 'deploy_config_not_found',
        message: 'edgebase.config.ts not found.',
        hint: 'Run `npm create edgebase@latest my-app` first.',
      });
    }

    if (!isQuiet()) {
      console.log(chalk.blue(isDryRun ? '⚡ Validating EdgeBase deploy...' : '⚡ Deploying EdgeBase...'));
      console.log();
    }

    // ─── Functions Bundling ───
    // Plugin functions are registered at runtime from config.plugins[] (Explicit Import Pattern).
    // No auto-discovery needed — esbuild bundles plugin handlers via import graph.

    // Track function count for dry-run summary
    let functionsCount = 0;
    let functions: ReturnType<typeof scanFunctions> = [];

    const functionsDir = join(projectDir, 'functions');
    if (existsSync(functionsDir)) {
      functions = scanFunctions(functionsDir);
      validateRouteNames(functions);
      functionsCount = functions.length;
      if (functions.length === 0) {
        console.log(chalk.yellow('⚠'), 'functions/ directory exists but no .ts files found.');
      }
    }

    if (!isDryRun && isTTY && !isJson() && !isNonInteractive()) {
      await promptToSyncAuthReleaseEnv(projectDir);
    }

    const envReleasePath = join(projectDir, '.env.release');
    const releaseVars = existsSync(envReleasePath) ? parseEnvFile(envReleasePath) : {};
    for (const [key, value] of Object.entries(releaseVars)) {
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }

    // ─── Config Validation ───
    const warnings: string[] = [];
    const errors: string[] = [];
    let configJson: Record<string, unknown> | null = null;

    if (existsSync(configPath)) {
      try {
        configJson = loadConfigSafe(configPath, projectDir, FULL_CONFIG_EVAL);

        if (configJson) {
          validateConfig(configJson, warnings, errors);
        }
      } catch (err) {
        raiseCliError({
          code: 'deploy_config_evaluation_failed',
          message: `Failed to fully evaluate edgebase.config.ts: ${(err as Error).message}`,
          hint: 'Install missing config dependencies or fix runtime errors before deploy.',
        });
      }
    }

    warnings.push(...collectAuthEnvWarnings(projectDir));

    for (const w of warnings) {
      console.log(chalk.yellow('⚠'), w);
    }

    for (const e of errors) {
      console.log(chalk.red('✗'), e);
    }
    if (errors.length > 0) {
      raiseCliError({
        code: 'deploy_config_invalid',
        message: `${errors.length} config error(s) found. Fix them before deploying.`,
        hint: 'Docs: https://edgebase.fun/docs/getting-started/configuration',
        details: {
          errors,
        },
      });
    }

    // ─── Schema Destructive Change Detection ───
    let currentSnapshot: ReturnType<typeof buildSnapshot> | null = null;
    let hasSchemaSnapshot = false;
    if (configJson) {
      try {
        const databases = extractDatabases(configJson);
        if (databases && Object.keys(databases).length > 0) {
          const authProvider = (configJson.auth as { provider?: string } | undefined)?.provider;
          currentSnapshot = buildSnapshot(
            databases as Parameters<typeof buildSnapshot>[0],
            authProvider,
          );
          const savedSnapshot = loadSnapshot(projectDir);

          if (savedSnapshot) {
            hasSchemaSnapshot = true;
            let changes = detectDestructiveChanges(savedSnapshot, currentSnapshot);
            changes = filterAutoPassChanges(changes, savedSnapshot, currentSnapshot);

            if (changes.length > 0 && !isDryRun) {
              const isRelease = !!configJson.release;
              const result = await handleDestructiveChanges(
                changes,
                isRelease,
                isTTY,
                options.ifDestructive,
              );

              if (result.action === 'reset') {
                resetLocalDoState(projectDir);
                saveSnapshot(projectDir, currentSnapshot);
                console.log(chalk.green('✓'), 'Schema snapshot updated after DB reset');
              } else if (result.action === 'migration_guide') {
                raiseCliError({
                  code: 'deploy_cancelled_for_migration_guide',
                  message: 'Deploy cancelled after showing the migration guide.',
                  hint: 'Add a migration or rerun after choosing an explicit destructive-change strategy.',
                });
              }
            }
          } else if (!isDryRun) {
            // First deploy — create initial snapshot
            saveSnapshot(projectDir, currentSnapshot);
            console.log(
              chalk.green('✓'),
              'Initial schema snapshot created (edgebase-schema.lock.json)',
            );
          }
        }
      } catch (err) {
        if (isCliStructuredError(err)) throw err;
        raiseCliError({
          code: 'deploy_schema_detection_failed',
          message: `Schema change detection failed: ${err instanceof Error ? err.message : String(err)}`,
          hint: 'Delete edgebase-schema.lock.json to reset detection if needed. Docs: https://edgebase.fun/docs/cli/reference#deploy',
        });
      }
    }

    // ─── Provider Change Detection + Migration ───
    let pendingRestore: { dumped: DumpedData; serverUrl: string; serviceKey: string } | null = null;

    if (configJson && currentSnapshot) {
      const savedSnapshot = loadSnapshot(projectDir);
      if (savedSnapshot) {
        const providerChanges = detectProviderChanges(savedSnapshot, currentSnapshot);
        const authChange = detectAuthProviderChange(savedSnapshot, currentSnapshot);

        const allChanges = [...providerChanges];
        if (authChange) allChanges.push(authChange);

        if (allChanges.length > 0 && isDryRun) {
          if (!isJson()) {
            console.log();
            console.log(chalk.yellow('⚠ Database provider changes detected:'));
            for (const pc of allChanges) {
              console.log(chalk.yellow(`  • ${pc.namespace}: ${pc.oldProvider} → ${pc.newProvider}`));
            }
            console.log(chalk.yellow('  Dry-run skips dump/restore. Run `npx edgebase migrate` or deploy without --dry-run.'));
            console.log();
          }
        } else if (allChanges.length > 0 && (isTTY || isNonInteractive())) {
          const answer = await promptMigration(allChanges);

          if (answer === 'migrate') {
            // Resolve Worker URL from wrangler.toml (currently deployed Worker)
            let workerUrl = process.env.EDGEBASE_URL ?? '';
            if (!workerUrl) workerUrl = resolveProjectWorkerUrl(projectDir);

            if (!workerUrl) {
              raiseCliError({
                code: 'deploy_migration_url_required',
                message: 'Cannot determine Worker URL for migration.',
                hint: 'Set EDGEBASE_URL or ensure wrangler.toml has a name.',
              });
            }

            // Resolve service key (exits with guidance if not found)
            const serviceKey = resolveServiceKeyFromOptions({});

            // Determine scope and namespaces
            const dataNamespaces = providerChanges.map((pc) => pc.namespace);
            const scope: MigrationOptions['scope'] = authChange
              ? dataNamespaces.length > 0
                ? 'all'
                : 'auth'
              : 'data';

            console.log();
            console.log(chalk.blue('📦 Pre-deploy: Dumping data from current provider...'));
            try {
              const dumped = await dumpCurrentData({
                scope,
                namespaces: dataNamespaces.length > 0 ? dataNamespaces : undefined,
                serverUrl: workerUrl,
                serviceKey,
                dryRun: false,
              });
              pendingRestore = { dumped, serverUrl: workerUrl, serviceKey };
              console.log(chalk.green('✓'), 'Data dumped successfully. Proceeding with deploy...');
            } catch (err) {
              console.error(chalk.red('✗ Pre-deploy dump failed:'), (err as Error).message);
              console.error(chalk.dim('  Deploy will continue without migration.'));
              console.error(
                chalk.dim('  You can migrate manually later with `npx edgebase migrate`.'),
              );
              console.log();
            }
          }
        } else if (allChanges.length > 0) {
          // Non-TTY: show warning only
          console.log();
          console.log(chalk.yellow('⚠ Database provider changes detected:'));
          for (const pc of allChanges) {
            console.log(chalk.yellow(`  • ${pc.namespace}: ${pc.oldProvider} → ${pc.newProvider}`));
          }
          console.log();
          console.log(chalk.yellow('  Run `npx edgebase migrate` to migrate data interactively.'));
          console.log();
        }
      }
    }

    // TODO(future): Additional validations
    // - references validation against defined tables
    // - origin: '*' + credentials: true conflict (M10)

    if (options.dryRun) {
      if (isJson()) {
        const result: Record<string, unknown> = {
          status: 'dry-run',
          config: basename(configPath),
          functions: functionsCount,
          warnings: warnings.length,
          errors: 0,
        };
        if (hasSchemaSnapshot || currentSnapshot) result.schemaSnapshot = true;
        console.log(JSON.stringify(result));
        return;
      }

      console.log();
      console.log(chalk.blue('─── Dry Run: Deploy Preview ───'));
      console.log();
      console.log(chalk.green('✓'), `Config: ${basename(configPath)}`);
      if (functionsCount > 0) {
        console.log(chalk.green('✓'), `Functions validated: ${functionsCount} file(s)`);
      }
      if (warnings.length > 0) {
        console.log(chalk.yellow('⚠'), `Warnings: ${warnings.length}`);
      }
      if (hasSchemaSnapshot) {
        console.log(chalk.green('✓'), 'Schema snapshot: checked');
      } else if (currentSnapshot) {
        console.log(chalk.green('✓'), 'Schema snapshot: would be created on first deploy');
      }

      // Check for .env.release secrets
      const envReleasePath = join(projectDir, '.env.release');
      if (existsSync(envReleasePath)) {
        const envContent = readFileSync(envReleasePath, 'utf-8');
        const secretCount = envContent
          .split('\n')
          .filter((l) => l.trim() && !l.startsWith('#') && l.includes('=')).length;
        console.log(chalk.green('✓'), `Secrets: ${secretCount} from .env.release`);
      }

      console.log();
      console.log(chalk.dim('  Run without --dry-run to deploy.'));
      return;
    }

    // ─── Cloudflare Authentication Gate ───
    const cfAuth = await ensureCloudflareAuth(projectDir, isTTY);
    ensureWranglerToml(projectDir, cfAuth.accountId);
    ensureRuntimeScaffold(projectDir);
    writeRuntimeConfigShim(projectDir, releaseVars);
    runProjectPostScaffoldHook(projectDir);
    const previousManifest = readCloudflareDeployManifest(projectDir);
    console.log();

    const serverSrcDir = getRuntimeServerSrcDir(projectDir);
    const registryPath = join(serverSrcDir, '_functions-registry.ts');
    generateFunctionRegistry(functions, registryPath, {
      configImportPath: './generated-config.js',
      functionsImportBasePath: relative(dirname(registryPath), join(projectDir, 'functions')).replace(/\\/g, '/'),
    });

    if (functions.length > 0) {
      console.log(
        chalk.green('✓'),
        `Bundled ${functions.length} function(s):`,
        functions.map((f) => chalk.cyan(f.name)).join(', '),
      );
    } else {
      console.log(
        chalk.green('✓'),
        'Bundled 0 user function(s) — plugin functions remain available',
      );
    }

    // ─── Cron Schedule Extraction ───
    const cronSchedules = collectManagedCronSchedules(configJson);

    // ─── Cloudflare Resource Provisioning ───
    const provisionedBindings: ProvisionedBinding[] = [];
    const manifestResources: CloudflareResourceRecord[] = [];
    const rateLimitBindings = resolveRateLimitBindings(configJson ?? undefined);
    let tempWranglerPath: string | null = null;
    const provisionSpinner = spin('Provisioning Cloudflare resources...');

    manifestResources.push(...provisionR2Buckets(projectDir, previousManifest));

    if (configJson) {
      const kvCfg = configJson.kv as Record<string, { binding: string }> | undefined;
      const d1Cfg = configJson.d1 as Record<string, { binding: string }> | undefined;
      const vecCfg = configJson.vectorize as
        | Record<string, { dimensions?: number; metric?: string; binding?: string }>
        | undefined;
      const dbsCfg = configJson.databases as Record<string, DeployDbBlockMeta> | undefined;

      // Check for PostgreSQL-backed database blocks (Hyperdrive)
      const hasProviderDbs =
        dbsCfg && Object.values(dbsCfg).some((db) => isPostgresProvider(db.provider));

      // Check for auth PostgreSQL provider (Hyperdrive)
      const authCfg = configJson.auth as
        | { provider?: string; connectionString?: string }
        | undefined;
      const hasAuthPostgres = authCfg?.provider === 'neon' || authCfg?.provider === 'postgres';

      const mergedKvConfig = buildMergedKvConfig(kvCfg);
      if (Object.keys(mergedKvConfig).length > 0) {
        provisionedBindings.push(...provisionKvNamespaces(mergedKvConfig, projectDir));
      }
      const mergedD1Config = buildMergedD1Config(d1Cfg, dbsCfg);
      if (Object.keys(mergedD1Config).length > 0) {
        provisionedBindings.push(...provisionD1Databases(mergedD1Config, projectDir, { previousManifest }));
      }
      if (vecCfg && Object.keys(vecCfg).length > 0) {
        provisionedBindings.push(...provisionVectorizeIndexes(vecCfg, projectDir));
      }
      if (dbsCfg && hasProviderDbs) {
        provisionedBindings.push(...provisionProviderHyperdrives(dbsCfg, projectDir));
      }
      if (authCfg && hasAuthPostgres) {
        provisionedBindings.push(...provisionAuthPostgresHyperdrive(authCfg, projectDir));
      }
    } else {
      provisionedBindings.push(...provisionInternalD1Databases(projectDir, { previousManifest }));
    }

    manifestResources.push(...provisionedBindings.map(toManifestResourceRecord));

    // Generate temp wrangler.toml with bindings + cron triggers
    const wranglerPath = join(projectDir, 'wrangler.toml');
    if (
      existsSync(wranglerPath) &&
      (provisionedBindings.length > 0 || cronSchedules.length > 0 || rateLimitBindings.length > 0)
    ) {
      tempWranglerPath = generateTempWranglerToml(
        wranglerPath,
        {
          bindings: provisionedBindings,
          triggerMode: 'replace',
          managedCrons: cronSchedules,
          rateLimitBindings,
        },
      );
      if (tempWranglerPath) {
        console.log(
          chalk.green('✓'),
          `Generated temp wrangler.toml with ${provisionedBindings.length} resource binding(s)`,
        );
      }
    }

    provisionSpinner.succeed('Cloudflare resources provisioned');

    // Generate temp wrangler.toml for cron triggers even if no resource bindings
    if (!tempWranglerPath && (cronSchedules.length > 0 || rateLimitBindings.length > 0)) {
      const cronOnlyWranglerPath = join(projectDir, 'wrangler.toml');
      if (existsSync(cronOnlyWranglerPath)) {
        tempWranglerPath = generateTempWranglerToml(
          cronOnlyWranglerPath,
          {
            bindings: [],
            triggerMode: 'replace',
            managedCrons: cronSchedules,
            rateLimitBindings,
          },
        );
        if (tempWranglerPath) {
          if (rateLimitBindings.length > 0 && cronSchedules.length > 0) {
            console.log(
              chalk.green('✓'),
              'Generated temp wrangler.toml with rate-limit bindings and cron trigger(s)',
            );
          } else if (rateLimitBindings.length > 0) {
            console.log(chalk.green('✓'), 'Generated temp wrangler.toml with rate-limit bindings');
          } else {
            console.log(chalk.green('✓'), 'Generated temp wrangler.toml with cron trigger(s)');
          }
        }
      }
    }

    // Ensure the admin dashboard assets ship with deploys even for custom wrangler.toml
    // files that omitted the EdgeBase-managed [assets] block.
    if (!tempWranglerPath && existsSync(wranglerPath)) {
      tempWranglerPath = generateTempWranglerToml(wranglerPath, {
        bindings: [],
        triggerMode: 'preserve',
      });
      if (tempWranglerPath) {
        console.log(chalk.green('✓'), 'Generated temp wrangler.toml with admin assets binding');
      }
    }

    // ─── Turnstile Auto-Provisioning ───
    if (configJson) {
      const captchaCfg = configJson.captcha as
        | boolean
        | { siteKey: string; secretKey: string }
        | undefined;
      if (captchaCfg) {
        const turnstileResult = await provisionTurnstile(
          captchaCfg,
          projectDir,
          configJson,
          cfAuth.accountId,
        );
        if (turnstileResult) {
          // §28: Inject siteKey as CAPTCHA_SITE_KEY wrangler var (independent from bundled app config)
          const targetToml = tempWranglerPath ?? join(projectDir, 'wrangler.toml');
          injectCaptchaSiteKey(targetToml, turnstileResult.siteKey);

          if (turnstileResult.managed && turnstileResult.widgetName) {
            const previousTurnstile = findCloudflareResourceRecord(previousManifest, {
              type: 'turnstile_widget',
              name: turnstileResult.widgetName,
              id: turnstileResult.widgetName,
            });
            manifestResources.push({
              type: 'turnstile_widget',
              name: turnstileResult.widgetName,
              id: turnstileResult.widgetName,
              managed: previousTurnstile?.managed ?? true,
              source: turnstileResult.source,
              metadata: { siteKey: turnstileResult.siteKey },
            });
          }
        }
        console.log();
      }
    }

    // ─── Deploy ───
    const deployArgs = ['wrangler', 'deploy'];
    if (tempWranglerPath) {
      deployArgs.push('--config', tempWranglerPath);
      console.log(chalk.dim(`  Using generated config: ${tempWranglerPath}`));
    }
    if (!isQuiet()) console.log(chalk.dim('  Running wrangler deploy...'));

    // Wrap deploy in a promise so we can await post-deploy migration restore
    let deployExitCode: number;
    let deployOutput: string;
    try {
      ({ code: deployExitCode, output: deployOutput } = await new Promise<{
        code: number;
        output: string;
      }>((resolveDeploy, rejectDeploy) => {
        const wrangler = spawn(wranglerCommand(), wranglerArgs(deployArgs), {
          cwd: projectDir,
          stdio: ['inherit', 'pipe', 'pipe'],
        });
        let capturedDeployOutput = '';

        wrangler.stdout?.on('data', (chunk) => {
          const text = chunk.toString();
          capturedDeployOutput += text;
          process.stdout.write(text);
        });
        wrangler.stderr?.on('data', (chunk) => {
          const text = chunk.toString();
          capturedDeployOutput += text;
          process.stderr.write(text);
        });

        wrangler.on('error', (err) => {
          if (tempWranglerPath)
            try {
              unlinkSync(tempWranglerPath);
            } catch {
              /* ignore */
            }
          rejectDeploy(err);
        });

        wrangler.on('exit', (code) => {
          if (tempWranglerPath) {
            try {
              unlinkSync(tempWranglerPath);
            } catch {
              /* ignore */
            }
            console.log(chalk.dim('  Cleaned up temp wrangler.toml'));
          }
          resolveDeploy({ code: code ?? 1, output: capturedDeployOutput });
        });
      }));
    } catch (err) {
      raiseCliError({
        code: 'deploy_spawn_failed',
        message: `Deploy failed to start: ${(err as Error).message}`,
        hint: 'Check your Wrangler installation and Cloudflare authentication, then retry.',
      });
    }

    if (deployExitCode !== 0) {
      // Provide resource-specific hints when the final deploy step fails
      // Strip ANSI escape codes before matching error patterns
      const outputLower = deployOutput.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').toLowerCase();
      let deployHint = `Check Cloudflare auth (${wranglerHint(['wrangler', 'whoami'])}), inspect verbose deploy output (${wranglerHint(['wrangler', 'deploy', '--verbose'])}), or re-login (${wranglerHint(['wrangler', 'login'])}).`;
      if (outputLower.includes('please enable r2') || outputLower.includes('code: 10042')) {
        deployHint = `R2 is not enabled on your Cloudflare account. Enable it at: Cloudflare Dashboard → R2 Object Storage → Get Started. Or remove 'storage' from edgebase.config.ts if not needed.`;
      } else if (outputLower.includes('authentication error') || outputLower.includes('code: 10000')) {
        deployHint = `Authentication failed. Try: ${wranglerHint(['wrangler', 'login'])} to refresh your credentials.`;
      } else if (outputLower.includes('new_sqlite_classes') || outputLower.includes('code: 10097')) {
        deployHint = `Durable Objects migration error: Free plan requires all DO classes to use 'new_sqlite_classes' instead of 'new_classes' in wrangler.toml migrations. Update your [[migrations]] section or upgrade to a paid Workers plan.`;
      } else if (outputLower.includes('quota') || outputLower.includes('exceeded')) {
        deployHint = `You may have reached a resource limit on your Cloudflare plan. Check: Cloudflare Dashboard → Workers & Pages → Plans.`;
      }
      raiseCliError({
        code: 'deploy_failed',
        message: `Deploy failed with exit code: ${deployExitCode}`,
        hint: deployHint,
        details: {
          exitCode: deployExitCode,
        },
      }, deployExitCode);
    }

    const deployedWorkerUrl = resolveDeployedWorkerUrl(projectDir, deployOutput);
    const persistedManifestResources = dedupeManifestResources([
      ...(previousManifest?.resources ?? []),
      ...manifestResources,
    ]);
    const deployManifestPath = writeCloudflareDeployManifest(projectDir, {
      version: 2,
      deployedAt: new Date().toISOString(),
      accountId: cfAuth.accountId,
      worker: {
        name: resolveWorkerNameFromProject(projectDir),
        url: deployedWorkerUrl,
      },
      resources: persistedManifestResources,
    });
    if (!isJson()) {
      console.log(chalk.dim(`  Saved deploy manifest: ${deployManifestPath}`));
    }

    try {
      syncEnvSecrets(projectDir, { failOnError: true });
      ensureManagedWorkerSecrets(projectDir, cfAuth.accountId, { failOnError: true });
    } catch (err) {
      raiseCliError({
        code: 'deploy_secret_sync_failed',
        message: `Deploy completed but secret synchronization failed: ${(err as Error).message}`,
        hint: 'The Worker was deployed, but required runtime secrets were not fully applied.',
      });
    }

    // Store deploy manifest in KV for runtime self-destruct
    storeManifestInKv(projectDir, persistedManifestResources, cfAuth.accountId, {
      workerName: resolveWorkerNameFromProject(projectDir),
      workerUrl: deployedWorkerUrl,
    });

    const deployedAdminUrl = deployedWorkerUrl
      ? await resolveAdminUrlFromRuntime(deployedWorkerUrl)
      : null;

    // ─── Post-deploy: Success ───
    if (isJson()) {
      // Note: JSON output after migration below
      if (!pendingRestore) {
        console.log(JSON.stringify({
          status: 'success',
          url: deployedWorkerUrl,
          adminUrl: deployedAdminUrl,
        }));
      }
    } else {
      console.log();
      console.log(chalk.green('✅ Deployed successfully!'));

      // Show deployed URL summary
      if (deployedWorkerUrl) {
        console.log();
        console.log(chalk.dim(`  API:   ${deployedWorkerUrl}/api/...`));
        if (deployedAdminUrl) {
          console.log(chalk.dim(`  Admin: ${deployedAdminUrl}`));
        } else {
          console.log(chalk.dim('  Admin: not deployed'));
        }
      }
    }

    // ─── Post-deploy: Migration Restore ───
    if (pendingRestore) {
      console.log();
      console.log(chalk.blue('📥 Post-deploy: Restoring data to new provider...'));

      // Determine scope from dumped data
      const hasAuth = !!pendingRestore.dumped.auth;
      const hasData =
        !!pendingRestore.dumped.data && Object.keys(pendingRestore.dumped.data).length > 0;
      const scope: MigrationOptions['scope'] = hasAuth ? (hasData ? 'all' : 'auth') : 'data';

      try {
        await restoreToNewProvider(
          {
            scope,
            namespaces: hasData ? Object.keys(pendingRestore.dumped.data!) : undefined,
            serverUrl: pendingRestore.serverUrl,
            serviceKey: pendingRestore.serviceKey,
            dryRun: false,
          },
          pendingRestore.dumped,
        );
        console.log();
        console.log(chalk.green('✓ Data migration complete!'));
      } catch (err) {
        console.error();
        console.error(chalk.red('✗ Post-deploy restore failed:'), (err as Error).message);
        console.error(chalk.dim('  The deploy succeeded but data was not migrated.'));
        console.error(chalk.dim('  You can retry with: npx edgebase migrate'));
      }

      if (isJson()) {
        console.log(JSON.stringify({ status: 'success', url: deployedWorkerUrl, migrated: true }));
      }
    }

    // Save schema snapshot on successful deploy
    if (currentSnapshot) {
      try {
        saveSnapshot(projectDir, currentSnapshot);
        console.log(chalk.dim('  Schema snapshot updated (edgebase-schema.lock.json)'));
      } catch (err) {
        console.warn(
          chalk.yellow('⚠ Failed to save schema snapshot:'),
          err instanceof Error ? err.message : err,
        );
        console.warn(chalk.yellow('  Next deploy may not detect destructive changes correctly.'));
      }
    }
  });

// ─── Sync .env.release → Cloudflare Secrets ───

/**
 * If `.env.release` exists, parse it and bulk-upload all key-value pairs
 * to Cloudflare Workers Secrets via `wrangler secret bulk`.
 *
 * This runs before SERVICE_KEY auto-generation so user-defined secrets
 * are available first. SERVICE_KEY is excluded even if present in the file
 * (it is auto-managed by the deploy pipeline).
 */
function syncEnvSecrets(projectDir: string, options?: { failOnError?: boolean }): void {
  const envReleasePath = join(projectDir, '.env.release');
  if (!existsSync(envReleasePath)) return;

  const vars = resolveReleaseSecretVars(projectDir);
  // SERVICE_KEY is auto-managed — ignore if user accidentally included it
  delete vars['SERVICE_KEY'];
  const keys = Object.keys(vars);
  if (keys.length === 0) return;

  const s = spin('Syncing .env.release → Cloudflare Secrets...');

  try {
    execFileSync(wranglerCommand(), wranglerArgs(['wrangler', 'secret', 'bulk']), {
      cwd: projectDir,
      input: JSON.stringify(vars),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    s.succeed(`${keys.length} secret(s) synced: ${keys.join(', ')}`);
  } catch (err) {
    s.fail('Failed to sync .env.release secrets');
    console.error(chalk.dim('  Error: ' + ((err as Error).message?.split('\n')[0] ?? '')));
    console.error(chalk.dim(`  You can manually run: ${wranglerHint(['wrangler', 'secret', 'bulk'])} < .env.release`));
    if (options?.failOnError) throw err;
  }
}

function resolveReleaseSecretVars(projectDir: string): Record<string, string> {
  const envReleasePath = join(projectDir, '.env.release');
  if (!existsSync(envReleasePath)) return {};

  const vars = parseEnvFile(envReleasePath);
  for (const key of Object.keys(vars)) {
    const override = process.env[key];
    if (typeof override === 'string' && override.length > 0) {
      vars[key] = override;
    }
  }

  return vars;
}

function parseCsvEnv(value: string | undefined): string[] {
  return Array.from(
    new Set(
      (value ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

function normalizeAuthEnvSegment(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function getOAuthEnvKeys(provider: string): {
  clientId: string;
  clientSecret: string;
  issuer?: string;
  scopes?: string;
} {
  if (provider.startsWith('oidc:')) {
    const oidcName = normalizeAuthEnvSegment(provider.slice(5)) || 'CUSTOM';
    return {
      clientId: `EDGEBASE_OIDC_${oidcName}_CLIENT_ID`,
      clientSecret: `EDGEBASE_OIDC_${oidcName}_CLIENT_SECRET`,
      issuer: `EDGEBASE_OIDC_${oidcName}_ISSUER`,
      scopes: `EDGEBASE_OIDC_${oidcName}_SCOPES`,
    };
  }

  const providerName = normalizeAuthEnvSegment(provider) || 'CUSTOM';
  return {
    clientId: `EDGEBASE_OAUTH_${providerName}_CLIENT_ID`,
    clientSecret: `EDGEBASE_OAUTH_${providerName}_CLIENT_SECRET`,
  };
}

function getRequiredAuthFields(provider: string): AuthEnvField[] {
  return provider.startsWith('oidc:')
    ? ['clientId', 'clientSecret', 'issuer']
    : ['clientId', 'clientSecret'];
}

function getOptionalAuthFields(provider: string): AuthEnvField[] {
  return provider.startsWith('oidc:') ? ['scopes'] : [];
}

function getAuthFieldValues(
  vars: Record<string, string>,
  provider: string,
): Partial<Record<AuthEnvField, string>> {
  const envKeys = getOAuthEnvKeys(provider);
  const values: Partial<Record<AuthEnvField, string>> = {};

  if (vars[envKeys.clientId]) values.clientId = vars[envKeys.clientId];
  if (vars[envKeys.clientSecret]) values.clientSecret = vars[envKeys.clientSecret];
  if (envKeys.issuer && vars[envKeys.issuer]) values.issuer = vars[envKeys.issuer];
  if (envKeys.scopes && vars[envKeys.scopes]) values.scopes = vars[envKeys.scopes];

  return values;
}

function formatAuthFieldList(fields: AuthEnvField[]): string {
  return fields.join(', ');
}

function inspectAuthEnv(projectDir: string): AuthProviderInspection[] {
  const developmentVars = parseDevVars(projectDir);
  const releaseVars = resolveReleaseSecretVars(projectDir);

  const developmentProviders = parseCsvEnv(developmentVars.EDGEBASE_AUTH_ALLOWED_OAUTH_PROVIDERS);
  const releaseProviders = parseCsvEnv(releaseVars.EDGEBASE_AUTH_ALLOWED_OAUTH_PROVIDERS);
  const seenProviders = new Set<string>();
  const providers = [...developmentProviders, ...releaseProviders].filter((provider) => {
    if (seenProviders.has(provider)) return false;
    seenProviders.add(provider);
    return true;
  });

  const inspections: AuthProviderInspection[] = [];
  for (const provider of providers) {
    const devEnabled = developmentProviders.includes(provider);
    const releaseEnabled = releaseProviders.includes(provider);
    const requiredFields = getRequiredAuthFields(provider);
    const developmentValues = getAuthFieldValues(developmentVars, provider);
    const releaseValues = getAuthFieldValues(releaseVars, provider);
    const missingReleaseFields = requiredFields.filter((field) => !releaseValues[field]);
    const missingDevelopmentFields = requiredFields.filter((field) => !developmentValues[field]);

    const summaryParts: string[] = [];
    if (devEnabled && !releaseEnabled) {
      summaryParts.push('enabled in Development but disabled in Release');
    }
    if (releaseEnabled && missingReleaseFields.length > 0) {
      summaryParts.push(`enabled in Release but missing ${formatAuthFieldList(missingReleaseFields)}`);
    }
    if (summaryParts.length === 0) continue;

    const canCopyToRelease = devEnabled && !releaseEnabled
      ? requiredFields.every((field) => !!releaseValues[field] || !!developmentValues[field])
      : missingReleaseFields.every((field) => !!developmentValues[field]);

    if (!canCopyToRelease && missingDevelopmentFields.length > 0) {
      summaryParts.push(`Development is also missing ${formatAuthFieldList(missingDevelopmentFields)}`);
    }

    inspections.push({
      provider,
      devEnabled,
      releaseEnabled,
      summary: summaryParts.join('; '),
      canCopyToRelease,
      requiredFields,
      missingReleaseFields,
      missingDevelopmentFields,
      developmentValues,
      releaseValues,
    });
  }

  return inspections;
}

function collectAuthEnvWarnings(projectDir: string): string[] {
  const warnings: string[] = [];
  const inspections = inspectAuthEnv(projectDir);

  const devOnlyProviders = inspections
    .filter((inspection) => inspection.devEnabled && !inspection.releaseEnabled)
    .map((inspection) => inspection.provider);
  if (devOnlyProviders.length > 0) {
    warnings.push(
      `OAuth provider(s) enabled in Development but not Release: ${devOnlyProviders.join(', ')}. ` +
      'Deploy reads .env.release and Cloudflare Secrets only, so these providers will stay disabled in production.',
    );
  }

  const releaseProvidersMissingSecrets = inspections
    .filter((inspection) => inspection.releaseEnabled && inspection.missingReleaseFields.length > 0)
    .map((inspection) => `${inspection.provider} (${formatAuthFieldList(inspection.missingReleaseFields)})`);

  if (releaseProvidersMissingSecrets.length > 0) {
    warnings.push(
      `Release OAuth provider(s) are enabled but missing required secrets in .env.release: ${releaseProvidersMissingSecrets.join('; ')}.`,
    );
  }

  return warnings;
}

function copyDevelopmentAuthProviderToRelease(
  projectDir: string,
  inspection: AuthProviderInspection,
): { enabledInRelease: boolean; copiedFields: AuthEnvField[] } {
  const envReleasePath = join(projectDir, '.env.release');
  const releaseFileVars = existsSync(envReleasePath) ? parseEnvFile(envReleasePath) : {};
  const releaseAllowlist = parseCsvEnv(releaseFileVars.EDGEBASE_AUTH_ALLOWED_OAUTH_PROVIDERS);
  let enabledInRelease = false;

  if (!releaseAllowlist.includes(inspection.provider)) {
    releaseAllowlist.push(inspection.provider);
    upsertEnvValue(
      envReleasePath,
      'EDGEBASE_AUTH_ALLOWED_OAUTH_PROVIDERS',
      releaseAllowlist.join(','),
      RELEASE_ENV_HEADER,
    );
    enabledInRelease = true;
  }

  const envKeys = getOAuthEnvKeys(inspection.provider);
  const copiedFields: AuthEnvField[] = [];
  for (const field of [...inspection.requiredFields, ...getOptionalAuthFields(inspection.provider)]) {
    const envKey = field === 'clientId'
      ? envKeys.clientId
      : field === 'clientSecret'
        ? envKeys.clientSecret
        : field === 'issuer'
          ? envKeys.issuer
          : envKeys.scopes;
    if (!envKey) continue;

    const developmentValue = inspection.developmentValues[field];
    if (!developmentValue || inspection.releaseValues[field]) continue;

    upsertEnvValue(envReleasePath, envKey, developmentValue, RELEASE_ENV_HEADER);
    copiedFields.push(field);
  }

  return { enabledInRelease, copiedFields };
}

async function promptToSyncAuthReleaseEnv(projectDir: string): Promise<void> {
  const inspections = inspectAuthEnv(projectDir);
  if (inspections.length === 0) return;

  console.log();
  console.log(chalk.yellow('⚠ Auth release environment differences detected:'));
  for (const inspection of inspections) {
    const guidance = inspection.canCopyToRelease
      ? inspection.releaseEnabled
        ? 'The CLI can fill the missing Release values from Development.'
        : 'The CLI can enable this provider in Release and fill any missing values from Development.'
      : inspection.missingDevelopmentFields.length > 0
        ? `Development is missing ${formatAuthFieldList(inspection.missingDevelopmentFields)}, so the CLI cannot auto-copy it yet.`
        : 'The CLI cannot auto-copy this provider yet.';
    console.log(chalk.yellow(`  • ${inspection.provider}: ${inspection.summary}. ${guidance}`));
  }

  const actionableInspections = inspections.filter((inspection) => inspection.canCopyToRelease);
  if (actionableInspections.length === 0) {
    console.log();
    return;
  }

  console.log();
  const shouldReview = await promptConfirm(
    'Review these providers one by one and optionally copy Development values into Release now?',
    false,
  );
  if (!shouldReview) {
    console.log();
    return;
  }

  console.log();
  for (const inspection of actionableInspections) {
    const question = inspection.releaseEnabled
      ? `${inspection.provider}: copy the missing ${formatAuthFieldList(inspection.missingReleaseFields)} from Development into Release?`
      : `${inspection.provider}: enable this provider in Release and copy any missing values from Development?`;
    const shouldCopy = await promptConfirm(question, false);
    if (!shouldCopy) continue;

    const result = copyDevelopmentAuthProviderToRelease(projectDir, inspection);
    const changes: string[] = [];
    if (result.enabledInRelease) changes.push('enabled in Release');
    if (result.copiedFields.length > 0) {
      changes.push(`copied ${formatAuthFieldList(result.copiedFields)} to .env.release`);
    }
    if (changes.length === 0) {
      changes.push('Release already had the needed values, so no file changes were required');
    }
    console.log(chalk.green('✓'), `${inspection.provider}: ${changes.join('; ')}.`);
  }
  console.log();
}

function ensureManagedWorkerSecrets(
  projectDir: string,
  accountId: string,
  options?: { failOnError?: boolean },
): void {
  try {
    const secretNames = listWranglerSecretNames(projectDir);
    const edgebaseDir = join(projectDir, '.edgebase');
    const secretsJsonPath = join(edgebaseDir, 'secrets.json');
    if (!existsSync(edgebaseDir)) mkdirSync(edgebaseDir, { recursive: true });

    let existingSecrets: Record<string, string> = {};
    if (existsSync(secretsJsonPath)) {
      try {
        existingSecrets = JSON.parse(readFileSync(secretsJsonPath, 'utf-8'));
      } catch {
        /* ignore invalid JSON */
      }
    }

    const generatedAt = new Date().toISOString();
    const generatedSecrets: Array<{ name: string; value: string; spinnerLabel: string }> = [];

    if (!secretNames.has('SERVICE_KEY')) {
      generatedSecrets.push({
        name: 'SERVICE_KEY',
        value: randomBytes(32).toString('hex'),
        spinnerLabel: 'Generating Service Key...',
      });
    }
    if (!secretNames.has('JWT_USER_SECRET')) {
      generatedSecrets.push({
        name: 'JWT_USER_SECRET',
        value: randomBytes(32).toString('hex'),
        spinnerLabel: 'Generating JWT user secret...',
      });
    }
    if (!secretNames.has('JWT_ADMIN_SECRET')) {
      generatedSecrets.push({
        name: 'JWT_ADMIN_SECRET',
        value: randomBytes(32).toString('hex'),
        spinnerLabel: 'Generating JWT admin secret...',
      });
    }

    // Store CF credentials for self-destruct capability (dashboard "Delete App")
    try {
      const { token: apiToken } = resolveApiToken();
      if (!secretNames.has('CF_API_TOKEN')) {
        generatedSecrets.push({
          name: 'CF_API_TOKEN',
          value: apiToken,
          spinnerLabel: 'Storing CF API token for self-management...',
        });
      }
      if (!secretNames.has('CF_ACCOUNT_ID')) {
        generatedSecrets.push({
          name: 'CF_ACCOUNT_ID',
          value: accountId,
          spinnerLabel: 'Storing CF account ID...',
        });
      }
    } catch {
      // Non-fatal: self-destruct won't be available from dashboard
      if (!isQuiet()) {
        console.log(chalk.dim('  ⚠ Could not resolve CF API token — dashboard "Delete App" will be unavailable'));
      }
    }

    for (const secret of generatedSecrets) {
      const spinner = spin(secret.spinnerLabel);
      execFileSync(wranglerCommand(), wranglerArgs(['wrangler', 'secret', 'put', secret.name]), {
        cwd: projectDir,
        input: secret.value,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      spinner.succeed(`${secret.name} stored`);
      existingSecrets[secret.name] = secret.value;
      if (secret.name === 'SERVICE_KEY') {
        existingSecrets['SERVICE_KEY_CREATED_AT'] = generatedAt;
        existingSecrets['SERVICE_KEY_UPDATED_AT'] = generatedAt;
        console.log(chalk.dim('  Key: sk_' + '*'.repeat(12) + secret.value.slice(-4)));
      }
    }

    if (generatedSecrets.length > 0) {
      console.log();
      writeFileSync(secretsJsonPath, JSON.stringify(existingSecrets, null, 2), 'utf-8');
      chmodSync(secretsJsonPath, 0o600);
      console.log(chalk.dim('  Saved to .edgebase/secrets.json (backup-ready)'));
    }
  } catch (err) {
    if (options?.failOnError) throw err;
  }
}

/**
 * Store the deploy manifest in KV so the Worker can read it at runtime
 * for self-destruct ("Delete App" from dashboard).
 */
function storeManifestInKv(
  projectDir: string,
  resources: CloudflareResourceRecord[],
  accountId: string,
  worker: { workerName: string; workerUrl: string | null },
): void {
  // Find the internal KV namespace ID from manifest resources
  const kvResource = resources.find(
    (r) => r.type === 'kv_namespace' && (r.binding === 'KV' || r.name === 'internal'),
  );
  if (!kvResource?.id) {
    if (!isQuiet()) {
      console.log(chalk.dim('  ⚠ KV namespace ID not found — skipping manifest KV store'));
    }
    return;
  }

  const manifest = {
    version: 2,
    deployedAt: new Date().toISOString(),
    accountId,
    worker: {
      name: worker.workerName,
      url: worker.workerUrl,
    },
    resources,
  };

  try {
    execFileSync(
      wranglerCommand(),
      wranglerArgs([
        'wrangler', 'kv', 'key', 'put',
        '--namespace-id', kvResource.id,
        '--remote',
        '__edgebase_deploy_manifest',
        JSON.stringify(manifest),
      ]),
      {
        cwd: projectDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    if (!isQuiet()) {
      console.log(chalk.dim('  Deploy manifest stored in KV for runtime access'));
    }
  } catch {
    if (!isQuiet()) {
      console.log(chalk.dim('  ⚠ Could not store deploy manifest in KV — dashboard "Delete App" may not work'));
    }
  }
}
