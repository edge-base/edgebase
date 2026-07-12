import { Command } from 'commander';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { wranglerArgs, wranglerCommand, wranglerHint } from '../lib/wrangler.js';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { resolve, join, basename } from 'node:path';
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
  isSafeWorkerBindingName,
  mergePluginTables,
  RUNTIME_PROCESS_ENV_COMPATIBILITY_FLAGS,
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
import { isCliStructuredError, raiseCliError, raiseNeedsInput } from '../lib/agent-contract.js';
import {
  resolveOptionalServiceKey,
  resolveServiceKey as resolveServiceKeyFromOptions,
} from '../lib/resolve-options.js';
import { parseDevVars, parseEnvFile } from '../lib/dev-sidecar.js';
import { ensureCloudflareAuth, ensureWranglerToml, resolveApiToken } from '../lib/cf-auth.js';
import { spin } from '../lib/spinner.js';
import { isJson, isNonInteractive, isQuiet } from '../lib/cli-context.js';
import { promptConfirm } from '../lib/prompts.js';
import {
  cleanupLegacyTurnstileWidgets,
  finalizeTurnstileProvision,
  injectCaptchaSiteKey,
  provisionTurnstile,
  type TurnstileProvisionResult,
} from '../lib/turnstile-provision.js';
import {
  acquireTurnstileDeployLease,
  renewTurnstileDeployLease,
  releaseTurnstileDeployLease,
  type TurnstileDeployLease,
} from '../lib/turnstile-deploy-lease.js';
import {
  DEPLOY_CONTROL_WORKER_SECRET_NAMES,
  listWranglerSecretNames,
  RESERVED_HOSTED_WORKER_SECRET_NAMES,
} from '../lib/wrangler-secrets.js';
import {
  assertCloudflareAccountContinuity,
  findCloudflareResourceRecord,
  normalizeProvenCloudflareWorkerOrigin,
  readCloudflareDeployManifest,
  writeCloudflareDeployManifest,
  type CloudflareResourceRecord,
} from '../lib/cloudflare-deploy-manifest.js';
import { parseWranglerResourceConfig } from '../lib/cloudflare-wrangler-resources.js';
import {
  buildLegacyManagedR2BucketName,
  buildLegacyManagedD1DatabaseName,
  buildLegacyWorkerScopedD1DatabaseName,
  buildManagedD1DatabaseName,
  buildManagedR2BucketName,
  buildManagedWorkerResourceName,
} from '../lib/managed-resource-names.js';
import { upsertEnvValue } from '../lib/neon.js';
import {
  resolveProjectWorkerName,
  resolveProjectWorkerUrl,
} from '../lib/project-runtime.js';
import {
  INTERNAL_D1_BINDINGS,
} from '../lib/runtime-scaffold.js';
import { createAppBundle } from '../lib/app-bundle.js';
import {
  ensureBootstrapAdmin,
  normalizeAdminEmail,
  promptValue,
  validateAdminEmail,
  type EnsureBootstrapAdminResult,
} from '../lib/admin-bootstrap.js';

const FULL_CONFIG_EVAL = { allowRegexFallback: false } as const;
const RELEASE_ENV_HEADER = '# EdgeBase production secrets';
const ANSI_ESCAPE_REGEX = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[a-zA-Z]`, 'g');
const DEPLOY_SUBPROCESS_TIMEOUT_MS = 10 * 60 * 1000;
const DEPLOY_SUBPROCESS_FORCE_KILL_DELAY_MS = 5_000;
const WRANGLER_RESOURCE_COMMAND_TIMEOUT_MS = 30_000;
const HYPERDRIVE_API_TIMEOUT_MS = 10_000;
const HYPERDRIVE_API_RESPONSE_MAX_BYTES = 64 * 1024;
const PROJECT_POST_SCAFFOLD_HOOK_TIMEOUT_MS = 5 * 60_000;
const PERSISTED_SECRETS_MAX_BYTES = 64 * 1024;
const PERSISTED_SECRETS_MAX_ENTRIES = 256;
const PERSISTED_SECRET_VALUE_MAX_BYTES = 16 * 1024;
const MANAGED_SECRET_NAMES = ['SERVICE_KEY', 'JWT_USER_SECRET', 'JWT_ADMIN_SECRET'] as const;

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
  const matches = [...output.matchAll(/https:\/\/[^\s<>"'`]+/g)].map((match) => match[0]);
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    try {
      if (new URL(matches[index]).hostname.toLowerCase().endsWith('.workers.dev')) {
        return matches[index];
      }
    } catch {
      // Ignore malformed URL-like output and keep scanning older candidates.
    }
  }
  return '';
}

export function extractWorkerVersionIdFromWranglerDeployOutput(output: string): string | null {
  const normalized = output.replace(ANSI_ESCAPE_REGEX, '');
  const matches = [...normalized.matchAll(
    /(?:Current|Worker)\s+Version ID:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
  )];
  return matches.at(-1)?.[1] ?? null;
}

export function registerDeploySubprocessTimeout(
  child: Pick<ChildProcess, 'kill'>,
  onTimeout: () => void,
  timeoutMs = DEPLOY_SUBPROCESS_TIMEOUT_MS,
): () => void {
  let active = true;
  let forceKillTimer: NodeJS.Timeout | undefined;
  const timeout = setTimeout(() => {
    if (!active) return;
    onTimeout();
    child.kill('SIGTERM');
    forceKillTimer = setTimeout(() => {
      if (active) child.kill('SIGKILL');
    }, DEPLOY_SUBPROCESS_FORCE_KILL_DELAY_MS);
  }, timeoutMs);
  timeout.unref?.();

  return () => {
    if (!active) return;
    active = false;
    clearTimeout(timeout);
    if (forceKillTimer) clearTimeout(forceKillTimer);
  };
}

type RemoteWorkerLookupRunner = (
  command: string,
  args: string[],
  options: { cwd: string; encoding: 'utf-8'; stdio: ['ignore', 'pipe', 'pipe']; timeout: number },
) => string;

function commandFailureText(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error ?? '');
  const record = error as { message?: unknown; stdout?: unknown; stderr?: unknown };
  return [record.message, record.stdout, record.stderr]
    .map((value) => Buffer.isBuffer(value) ? value.toString('utf8') : String(value ?? ''))
    .join('\n');
}

export function classifyRemoteWorkerLookupFailure(
  error: unknown,
): 'absent' | 'exists-without-deployment' | 'unknown' {
  const message = commandFailureText(error);
  if (/\bhas no deployments\b/i.test(message)) return 'exists-without-deployment';
  if (
    /\b(?:10090|10092)\b/.test(message)
    || /\bWorker\b[^\n]*(?:not found|does not exist)/i.test(message)
  ) return 'absent';
  return 'unknown';
}

/**
 * Remote Cloudflare state is authoritative. A local deploy manifest is
 * intentionally gitignored and is commonly absent in CI, so using it to infer
 * a first deploy would rotate SERVICE_KEY/JWT secrets on every fresh checkout.
 */
export function remoteWorkerExists(
  projectDir: string,
  workerName: string,
  runner?: RemoteWorkerLookupRunner,
): boolean {
  const run = runner ?? ((command, args, options) => execFileSync(command, args, options));
  try {
    run(
      wranglerCommand(),
      wranglerArgs(['wrangler', 'deployments', 'status', '--name', workerName, '--json']),
      {
        cwd: projectDir,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
      },
    );
    return true;
  } catch (error) {
    const state = classifyRemoteWorkerLookupFailure(error);
    if (state === 'absent') return false;
    if (state === 'exists-without-deployment') return true;
    throw new Error(
      `Cannot determine whether Worker '${workerName}' already exists: ${commandFailureText(error).split('\n')[0]}`,
    );
  }
}

const TEMP_DEPLOY_SECRET_PATTERN = /^\.deploy-secrets-(\d+)-[0-9a-f]{12}\.json$/;

function removeTempDeploySecretFile(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Already removed or never created.
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function scavengeStaleDeploySecrets(edgebaseDir: string): string[] {
  if (!existsSync(edgebaseDir)) return [];
  const removed: string[] = [];
  const now = Date.now();
  for (const entry of readdirSync(edgebaseDir)) {
    const match = entry.match(TEMP_DEPLOY_SECRET_PATTERN);
    if (!match) continue;
    const path = join(edgebaseDir, entry);
    const ownerPid = Number(match[1]);
    let oldEnoughToOverridePidReuse = false;
    try {
      oldEnoughToOverridePidReuse = now - statSync(path).mtimeMs > 24 * 60 * 60 * 1000;
    } catch {
      continue;
    }
    if (processIsAlive(ownerPid) && !oldEnoughToOverridePidReuse) continue;
    removeTempDeploySecretFile(path);
    if (!existsSync(path)) removed.push(path);
  }
  return removed;
}

/** Register synchronous cleanup for normal completion, parent exit, and the
 * catchable termination signals. Signal forwarding preserves conventional
 * 130/143 exit behavior after the secret file is removed. */
export function registerDeploySecretCleanup(path: string): () => void {
  let active = true;
  const cleanupFile = () => {
    if (!active) return;
    removeTempDeploySecretFile(path);
  };
  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  const unregister = () => {
    process.off('exit', cleanupFile);
    for (const [signal, handler] of signalHandlers) process.off(signal, handler);
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    const handler = () => {
      cleanupFile();
      active = false;
      unregister();
      process.kill(process.pid, signal);
    };
    signalHandlers.set(signal, handler);
    process.once(signal, handler);
  }
  process.once('exit', cleanupFile);

  return () => {
    if (!active) return;
    cleanupFile();
    active = false;
    unregister();
  };
}

function resolveWorkerNameFromProject(projectDir: string): string {
  return resolveProjectWorkerName(projectDir);
}

function resolveDeployedWorkerUrl(projectDir: string, deployOutput: string): string {
  // Only Wrangler's response proves which Worker was just published. A stale
  // global EDGEBASE_URL or a guessed workers.dev hostname can belong to a
  // different account/project and must never become destructive manifest
  // authority. Keep the URL empty when Wrangler does not report one.
  const workerName = resolveWorkerNameFromProject(projectDir);
  return normalizeProvenCloudflareWorkerOrigin(
    workerName,
    extractWorkerUrlFromWranglerDeployOutput(deployOutput),
  );
}

function createDeployAppBundle(projectDir: string, outputDir: string) {
  // Release values are runtime secrets, not build-time source. In particular,
  // never pass .env.release through CreateAppBundleOptions.injectedEnv because
  // that option intentionally writes literal values into generated-config.ts
  // for local development bundles.
  return createAppBundle(projectDir, {
    outputDir,
    overwrite: true,
  });
}

function reservedHostedRuntimeNames(names: Iterable<string>): string[] {
  const present = new Set(names);
  return RESERVED_HOSTED_WORKER_SECRET_NAMES.filter((name) => present.has(name));
}

function assertNoReservedReleaseSecretVars(vars: Record<string, string>): void {
  const reserved = reservedHostedRuntimeNames(Object.keys(vars));
  if (reserved.length === 0) return;

  throw new Error(
    `.env.release must not define protected hosted runtime binding(s): ${reserved.join(', ')}. `
    + 'Production config and email action URLs are bundled from edgebase.config.ts; test/mock endpoint overrides are local-only. '
    + 'Remove those exact entries; they are never valid production secrets.',
  );
}

function assertNoDeployOnlyReleaseSecretVars(vars: Record<string, string>): void {
  const present = new Set(Object.keys(vars));
  const forbidden = DEPLOY_CONTROL_WORKER_SECRET_NAMES.filter((name) => present.has(name));
  if (forbidden.length === 0) return;

  throw new Error(
    `.env.release must not define deploy/control credential(s): ${forbidden.join(', ')}. `
    + 'Pass deployment credentials through the CLI process environment instead. They are not Worker application secrets.',
  );
}

function assertNoActiveHostedDeployProcessOverrides(
  processEnv: Record<string, string | undefined>,
): void {
  const enabled = (name: string) => {
    const value = processEnv[name]?.trim().toLowerCase();
    return value === '1' || value === 'true';
  };
  const nonEmpty = (name: string) => (processEnv[name]?.trim().length ?? 0) > 0;
  const active: string[] = [];
  if (nonEmpty('EDGEBASE_CONFIG')) active.push('EDGEBASE_CONFIG');
  if (enabled('EDGEBASE_TEST')) active.push('EDGEBASE_TEST');
  if (nonEmpty('EDGEBASE_TEST_BUILD')) active.push('EDGEBASE_TEST_BUILD');
  if (nonEmpty('EDGEBASE_LOCAL_DEV_BUILD')) active.push('EDGEBASE_LOCAL_DEV_BUILD');
  if (nonEmpty('EDGEBASE_DEV_SIDECAR_PORT')) active.push('EDGEBASE_DEV_SIDECAR_PORT');
  if (nonEmpty('EDGEBASE_INTERNAL_WORKER_URL')) active.push('EDGEBASE_INTERNAL_WORKER_URL');
  if (nonEmpty('EDGEBASE_EMAIL_API_URL')) active.push('EDGEBASE_EMAIL_API_URL');
  if (nonEmpty('EDGEBASE_SMS_API_URL')) active.push('EDGEBASE_SMS_API_URL');
  if (enabled('EDGEBASE_USE_TEST_CONFIG')) active.push('EDGEBASE_USE_TEST_CONFIG');
  if (enabled('VITEST')) active.push('VITEST');
  if (nonEmpty('VITEST_WORKER_ID')) active.push('VITEST_WORKER_ID');
  if (nonEmpty('VITEST_POOL_ID')) active.push('VITEST_POOL_ID');
  if (processEnv.NODE_ENV?.trim().toLowerCase() === 'test') active.push('NODE_ENV');
  if (
    nonEmpty('EDGEBASE_RUNTIME_MODE')
    && processEnv.EDGEBASE_RUNTIME_MODE?.trim() !== 'cloudflare'
  ) active.push('EDGEBASE_RUNTIME_MODE');
  if (active.length === 0) return;

  throw new Error(
    `Hosted deploy cannot run with active local/test config override(s): ${active.join(', ')}. `
    + 'Unset them (NODE_ENV=production is allowed) and rerun so config evaluation and bundling use production authority.',
  );
}

function assertNoDeployOnlyRemoteWorkerSecrets(
  secretNames: Set<string>,
  allowMappedSelfDestructCredentials: boolean,
): void {
  const present = new Set(secretNames);
  const forbidden = DEPLOY_CONTROL_WORKER_SECRET_NAMES.filter((name) => {
    if (
      allowMappedSelfDestructCredentials
      && (name === 'CF_API_TOKEN' || name === 'CF_ACCOUNT_ID')
    ) return false;
    return present.has(name);
  });
  if (forbidden.length === 0) return;

  throw new Error(
    `The existing Worker still has deploy/control credential secret(s): ${forbidden.join(', ')}. `
    + 'Verify the Worker, then remove only those exact secrets with:\n  '
    + forbidden.map((name) => `npx edgebase secret delete ${name}`).join('\n  ')
    + '\nEdgeBase never deletes live secrets implicitly.',
  );
}

function assertNoReservedRemoteWorkerSecrets(secretNames: Set<string>): void {
  const reserved = reservedHostedRuntimeNames(secretNames);
  if (reserved.length === 0) return;

  const commands = reserved
    .map((name) => `npx edgebase secret delete ${name}`)
    .join('\n  ');
  throw new Error(
    `The existing Worker still has reserved legacy secret(s): ${reserved.join(', ')}. `
    + 'They can override the bundled release config or enable test-only behavior, so deploy stopped before publishing. '
    + `After verifying this is the intended Worker, remove only those exact secrets explicitly:\n  ${commands}\n`
    + 'Then rerun deploy. EdgeBase will not delete live Worker secrets implicitly.',
  );
}

function resolveCloudflareEmailBinding(
  config: Record<string, unknown> | null | undefined,
): string | undefined {
  const email = config?.email;
  if (!email || typeof email !== 'object' || Array.isArray(email)) return undefined;
  const emailConfig = email as { provider?: unknown; binding?: unknown };
  if (emailConfig.provider !== 'cloudflare') return undefined;

  const binding = emailConfig.binding ?? 'EMAIL';
  if (!isSafeWorkerBindingName(binding)) {
    throw new Error(
      'email.binding for provider "cloudflare" must be a JavaScript identifier '
      + 'such as EMAIL or TRANSACTIONAL_EMAIL.',
    );
  }
  if (reservedHostedRuntimeNames([binding]).length > 0) {
    throw new Error(
      `email.binding '${binding}' is reserved for EdgeBase runtime integrity and cannot be used as a send_email binding.`,
    );
  }
  return binding;
}

function assertReleasePostDeployWorkerUrl(
  config: Record<string, unknown> | null,
  deployedWorkerUrl: string,
): void {
  if (config?.release !== true || deployedWorkerUrl) return;

  raiseCliError({
    code: 'deploy_post_publish_url_unproven',
    message: 'Worker deploy succeeded, but Wrangler did not report a verifiable workers.dev URL. Bootstrap admin and post-deploy verification were not run.',
    hint: 'Verify the published Worker and its HTTPS URL in Cloudflare, run `npx edgebase admin bootstrap --url <worker-url>` to complete admin setup, then rerun deploy. The local deploy manifest was preserved without treating an unverified URL as authority.',
    details: {
      workerPublished: true,
      bootstrapAdminVerified: false,
    },
  });
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

  // ─── Check 0b: Wildcard CORS in release mode ───
  // A wildcard origin lets any site call the API; unsafe for authenticated
  // production apps. Warn (don't hard-fail) when deploying a release build.
  if (config.release === true) {
    const cors = config.cors as { origin?: unknown } | undefined;
    const origin = cors?.origin;
    const hasWildcard = origin === '*'
      || (Array.isArray(origin) && origin.some((entry) => entry === '*'));
    if (hasWildcard) {
      warnings.push(
        "cors.origin is '*' with release: true — any website can call your API. " +
          'Set cors.origin to your production frontend origin(s) before deploying to production.',
      );
    }
  }

  const captcha = config.captcha;
  if (
    captcha
    && typeof captcha === 'object'
    && !Array.isArray(captcha)
    && (captcha as { failMode?: unknown }).failMode === 'open'
  ) {
    errors.push(
      'captcha.failMode="open" is restricted to the trusted local-development runtime. '
      + 'Cloud deployments must use failMode: "closed" (or omit failMode).',
    );
  }
  if (
    config.release === true
    && captcha
    && typeof captcha === 'object'
    && !Array.isArray(captcha)
    && Object.prototype.hasOwnProperty.call(captcha, 'secretKey')
  ) {
    errors.push(
      'Release CAPTCHA must not embed captcha.secretKey in edgebase.config.ts. '
      + 'Remove it and set TURNSTILE_SECRET in .env.release or Workers Secrets.',
    );
  }

  try {
    resolveCloudflareEmailBinding(config);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Invalid Cloudflare email binding.');
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
  buildManagedWorkerResourceName,
  parseWranglerJsonOutput,
  parseKvNamespaceListOutput,
  parseD1DatabaseListOutput,
  parseVectorizeIndexListOutput,
  parseHyperdriveListOutput,
  listHyperdriveConfigs,
  dedupeManifestResources,
  provisionR2Buckets,
  provisionVectorizeIndexes,
  provisionProviderHyperdrives,
  provisionAuthPostgresHyperdrive,
  createHyperdriveConfigViaApi,
  readBoundedJsonResponse,
  assertRequiredBindingCoverage,
  scopePreviousManifestToAccount,
  assertCloudflareAccountContinuity,
  assertWorkerIdentityContinuity,
  createDeployAppBundle,
  assertReleasePostDeployWorkerUrl,
  resolveDeployedWorkerUrl,
  assertNoReservedReleaseSecretVars,
  assertNoDeployOnlyReleaseSecretVars,
  assertNoDeployOnlyRemoteWorkerSecrets,
  assertNoActiveHostedDeployProcessOverrides,
  assertNoReservedRemoteWorkerSecrets,
  resolveCloudflareEmailBinding,
  generateTempWranglerToml,
  provisionTurnstile,
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
  isValidCloudflareAccountId,
  isValidHyperdriveConfigName,
  classifyRemoteWorkerLookupFailure,
  remoteWorkerExists,
  scavengeStaleDeploySecrets,
  registerDeploySecretCleanup,
  registerDeploySubprocessTimeout,
  prepareAtomicDeploySecrets,
  extractWorkerVersionIdFromWranglerDeployOutput,
  runProjectPostScaffoldHook,
};

// ─── KV/D1/Vectorize Auto-Provisioning ───

function dedupeBindingConfigs<T extends { binding: string }>(
  config: Record<string, T>,
): Record<string, T> {
  const deduped: Record<string, T> = {};
  const seenBindings = new Set<string>();

  for (const [name, value] of Object.entries(config)) {
    if (!value || typeof value.binding !== 'string' || !value.binding.trim()) {
      throw new Error(`Resource '${name}' must declare a non-empty binding.`);
    }
    if (seenBindings.has(value.binding)) continue;
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

function parseWranglerJsonOutput(output: string): unknown {
  const trimmed = output.replace(ANSI_ESCAPE_REGEX, '').trim();
  const candidates = [trimmed];
  for (const opening of ['[', '{']) {
    const start = trimmed.indexOf(opening);
    if (start >= 0) candidates.push(trimmed.slice(start));
  }
  const uniqueCandidates = candidates.filter(
    (candidate, index, all) => candidate.length > 0 && all.indexOf(candidate) === index,
  );

  for (const candidate of uniqueCandidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error('Unexpected Wrangler JSON output.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isBoundedNonEmptyString(value: unknown, maxLength = 512): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function isCloudflareResourceId(value: unknown): value is string {
  return typeof value === 'string' && (
    /^[a-f0-9]{32}$/i.test(value)
    || /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
  );
}

function parseKvNamespaceListOutput(output: string): Array<{ title: string; id: string }> {
  const parsed = parseWranglerJsonOutput(output);
  if (!Array.isArray(parsed) || !parsed.every((item) =>
    isRecord(item)
    && isBoundedNonEmptyString(item.title)
    && typeof item.id === 'string'
    && /^[a-f0-9]{32}$/i.test(item.id)
  )) {
    throw new Error('Unexpected Wrangler KV namespace list shape.');
  }
  return parsed as Array<{ title: string; id: string }>;
}

function parseD1DatabaseListOutput(output: string): Array<{ name: string; uuid: string }> {
  const parsed = parseWranglerJsonOutput(output);
  if (!Array.isArray(parsed) || !parsed.every((item) =>
    isRecord(item)
    && isBoundedNonEmptyString(item.name)
    && isCloudflareResourceId(item.uuid)
  )) {
    throw new Error('Unexpected Wrangler D1 database list shape.');
  }
  return parsed as Array<{ name: string; uuid: string }>;
}

function parseVectorizeIndexListOutput(output: string): Array<{ name: string }> {
  const parsed = parseWranglerJsonOutput(output);
  if (!Array.isArray(parsed) || !parsed.every((item) =>
    isRecord(item) && isBoundedNonEmptyString(item.name)
  )) {
    throw new Error('Unexpected Wrangler Vectorize index list shape.');
  }
  return parsed as Array<{ name: string }>;
}

function parseHyperdriveListOutput(output: string): Array<{ id: string; name: string }> {
  const normalized = output.replace(ANSI_ESCAPE_REGEX, '');
  const trimmed = normalized.trim();
  if (!trimmed) throw new Error('Unexpected empty Wrangler Hyperdrive list output.');

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = parseWranglerJsonOutput(normalized);
    if (!Array.isArray(parsed) || !parsed.every((item) =>
      isRecord(item)
      && typeof item.id === 'string'
      && /^[a-f0-9]{32}$/i.test(item.id)
      && isBoundedNonEmptyString(item.name)
    )) {
      throw new Error('Unexpected Wrangler Hyperdrive list JSON shape.');
    }
    return parsed as Array<{ id: string; name: string }>;
  }

  const rows: Array<{ id: string; name: string }> = [];
  let sawHeader = false;
  for (const line of normalized.split(/\r?\n/)) {
    if (!line.trim().startsWith('│')) {
      continue;
    }

    const cells = line
      .split('│')
      .slice(1, -1)
      .map((cell) => cell.trim());

    if (cells.length < 2) throw new Error('Unexpected Wrangler Hyperdrive table row.');

    const [id, name] = cells;
    if (id.toLowerCase() === 'id' && name.toLowerCase() === 'name') {
      sawHeader = true;
      continue;
    }

    if (!/^[a-f0-9]{32}$/i.test(id) || !isBoundedNonEmptyString(name)) {
      throw new Error('Unexpected Wrangler Hyperdrive table row shape.');
    }

    rows.push({ id, name });
  }

  if (!sawHeader) {
    const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const sawListBanner = lines.some((line) => line === '📋 Listing Hyperdrive configs');
    const unknownLines = lines.filter((line) =>
      line !== '📋 Listing Hyperdrive configs'
      && !/wrangler\s+\d+\.\d+\.\d+/i.test(line)
      && !/^-+$/.test(line)
    );
    if (sawListBanner && unknownLines.length === 0) return [];
    throw new Error('Unexpected Wrangler Hyperdrive list table.');
  }
  return rows;
}

type WranglerResourceRunner = (
  args: string[],
  options: {
    cwd: string;
    stdio: ['ignore' | 'pipe', 'pipe', 'ignore' | 'pipe'];
  },
) => string;

type ResourceProvisionOptions = {
  previousManifest?: ReturnType<typeof readCloudflareDeployManifest>;
};

const runWranglerResourceCommand: WranglerResourceRunner = (args, options) =>
  execFileSync(
    wranglerCommand(),
    wranglerArgs(args),
    {
      cwd: options.cwd,
      encoding: 'utf-8',
      stdio: options.stdio,
      timeout: WRANGLER_RESOURCE_COMMAND_TIMEOUT_MS,
    },
  );

function provisioningFailureDetail(error: unknown): string {
  const lines = commandFailureText(error)
    .replace(ANSI_ESCAPE_REGEX, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return [...new Set(lines)].join(' | ').slice(0, 500) || 'unknown error';
}

function assertRequiredBindingCoverage(
  resourceType: string,
  expectedBindings: Iterable<string>,
  bindings: Array<{ binding?: string }>,
): void {
  const actual = new Set(bindings.map((binding) => binding.binding).filter(Boolean));
  const missing = [...expectedBindings].filter((binding) => !actual.has(binding));
  if (missing.length > 0) {
    throw new Error(
      `Required ${resourceType} binding(s) were not provisioned: ${missing.join(', ')}. Deployment aborted.`,
    );
  }
}

function findPreviousManifestBinding(
  manifest: ReturnType<typeof readCloudflareDeployManifest>,
  type: CloudflareResourceRecord['type'],
  binding: string,
): CloudflareResourceRecord | null {
  return manifest?.resources.find((resource) =>
    resource.type === type && resource.binding === binding,
  ) ?? null;
}

function scopePreviousManifestToAccount(
  manifest: ReturnType<typeof readCloudflareDeployManifest>,
  accountId: string,
): ReturnType<typeof readCloudflareDeployManifest> {
  return manifest?.accountId.toLowerCase() === accountId.toLowerCase() ? manifest : null;
}

function assertWorkerIdentityContinuity(
  previousManifest: ReturnType<typeof readCloudflareDeployManifest>,
  currentWorkerName: string,
  allowWorkerRename: boolean,
): void {
  const previousWorkerName = previousManifest?.worker.name.trim();
  const currentName = currentWorkerName.trim();
  if (
    !previousWorkerName
    || previousWorkerName.toLowerCase() === currentName.toLowerCase()
    || allowWorkerRename
  ) return;

  throw new Error(
    `Cloudflare Worker identity changed from '${previousWorkerName}' to '${currentName}'. `
    + 'Deploying under a new Worker name creates separate Durable Object storage and can make existing data appear lost. '
    + 'Migrate or intentionally retire the previous Worker and its managed resources first, then rerun with '
    + '--allow-worker-rename to acknowledge the new isolated Worker identity.',
  );
}

function resolveExistingManagedBindingOwnership(
  previousRecord: CloudflareResourceRecord | null,
): Pick<ProvisionedBinding, 'managed' | 'source'> {
  return {
    managed: previousRecord?.managed ?? true,
    source: previousRecord?.source === 'created' ? 'created' : 'existing',
  };
}

function matchPreviousOwnership(
  previousRecord: CloudflareResourceRecord | null,
  existingId: string,
  legacyNameMatched: boolean,
): CloudflareResourceRecord | null {
  if (!previousRecord) return null;
  return previousRecord.id
    ? (previousRecord.id === existingId ? previousRecord : null)
    : (legacyNameMatched ? previousRecord : null);
}

function listHyperdriveConfigs(
  projectDir: string,
  runner: WranglerResourceRunner = runWranglerResourceCommand,
): Array<{ id: string; name: string }> {
  try {
    const output = runner(['wrangler', 'hyperdrive', 'list'], {
      cwd: projectDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return parseHyperdriveListOutput(output);
  } catch (err) {
    throw new Error(
      'Cannot safely provision required Hyperdrive configs because the existing-config list '
      + `could not be verified: ${provisioningFailureDetail(err)}`,
    );
  }
}

function isHyperdriveAlreadyExistsError(message: string): boolean {
  return /already exists\s*\[code:\s*2017\]/i.test(message);
}

interface HyperdriveOrigin {
  scheme: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/**
 * Parse a Postgres connection string into Hyperdrive origin fields so the
 * password can be sent in a request body instead of on the command line.
 */
function parsePostgresConnectionString(connectionString: string): HyperdriveOrigin | null {
  try {
    const url = new URL(connectionString);
    const scheme = url.protocol.replace(/:$/, '');
    if (scheme !== 'postgres' && scheme !== 'postgresql') return null;
    const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
    if (!url.hostname || !database) return null;
    return {
      scheme: 'postgres',
      host: url.hostname,
      port: url.port ? Number(url.port) : 5432,
      database,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    };
  } catch {
    return null;
  }
}

type HyperdriveCreateResult =
  | { status: 'created'; id: string }
  | { status: 'exists'; message: string }
  | { status: 'error'; message: string };

function isValidCloudflareAccountId(value: string): boolean {
  return /^[a-f0-9]{32}$/i.test(value);
}

function isValidHyperdriveConfigName(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?$/i.test(value);
}

async function readBoundedJsonResponse(
  response: Response,
  maxBytes = HYPERDRIVE_API_RESPONSE_MAX_BYTES,
): Promise<unknown> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error('Hyperdrive API response limit is invalid.');
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    throw new Error(`Hyperdrive API response exceeded ${maxBytes} bytes.`);
  }
  if (!response.body) throw new Error('Hyperdrive API returned an empty response body.');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`Hyperdrive API response exceeded ${maxBytes} bytes.`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  if (!text.trim()) throw new Error('Hyperdrive API returned an empty response body.');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('Hyperdrive API returned malformed JSON.');
  }
}

type HyperdriveApiOptions = {
  fetchImpl?: typeof fetch;
  apiToken?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

/**
 * Create a Hyperdrive config via the Cloudflare REST API. The connection string
 * (which contains the database password) is sent in the JSON request body, not
 * as a `wrangler hyperdrive create --connection-string=…` CLI argument that
 * would be visible to other users via `ps`/`/proc`.
 */
async function createHyperdriveConfigViaApi(
  hdName: string,
  connectionString: string,
  accountId: string,
  options: HyperdriveApiOptions = {},
): Promise<HyperdriveCreateResult> {
  if (!isValidCloudflareAccountId(accountId)) {
    return { status: 'error', message: 'Cloudflare account id must be exactly 32 hexadecimal characters.' };
  }
  if (!isValidHyperdriveConfigName(hdName)) {
    return { status: 'error', message: 'Hyperdrive config name contains unsupported characters or length.' };
  }
  const origin = parsePostgresConnectionString(connectionString);
  if (!origin) {
    return { status: 'error', message: 'Could not parse the Postgres connection string (expected postgres://…).' };
  }

  let apiToken: string;
  try {
    apiToken = options.apiToken ?? resolveApiToken().token;
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? HYPERDRIVE_API_TIMEOUT_MS;
  const timeout = setTimeout(
    () => controller.abort(new Error(`Hyperdrive API request timed out after ${timeoutMs}ms.`)),
    timeoutMs,
  );
  timeout.unref?.();

  try {
    // Sending the explicitly configured database origin (including its
    // password) to Cloudflare's fixed Hyperdrive endpoint is the purpose of
    // this user-requested provisioning action. It is never sent elsewhere.
    const resp = await (options.fetchImpl ?? fetch)( // lgtm[js/file-access-to-http]
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/hyperdrive/configs`,
      {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: hdName, origin }),
      },
    );
    const json = await readBoundedJsonResponse(
      resp,
      options.maxResponseBytes ?? HYPERDRIVE_API_RESPONSE_MAX_BYTES,
    );
    if (!isRecord(json)) {
      return { status: 'error', message: `Hyperdrive API returned an invalid response shape (HTTP ${resp.status}).` };
    }

    const result = isRecord(json.result) ? json.result : null;
    if (
      resp.ok
      && json.success === true
      && result
      && typeof result.id === 'string'
      && /^[a-f0-9]{32}$/i.test(result.id)
    ) {
      return { status: 'created', id: result.id };
    }

    const errors = Array.isArray(json.errors)
      ? json.errors.filter(isRecord)
      : [];
    const message = errors
      .map((error) => isBoundedNonEmptyString(error.message, 1_000) ? error.message : null)
      .filter((value): value is string => !!value)
      .join('; ')
      || `Hyperdrive API returned HTTP ${resp.status}`;
    if (errors.some((error) => error.code === 2017) || isHyperdriveAlreadyExistsError(message)) {
      return { status: 'exists', message };
    }
    return { status: 'error', message };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timeout);
  }
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
  const msg = errorMessage.replace(ANSI_ESCAPE_REGEX, '').toLowerCase();

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
    metadata: binding.resourceName ? { resourceName: binding.resourceName } : undefined,
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
  runner: WranglerResourceRunner = runWranglerResourceCommand,
): CloudflareResourceRecord[] {
  const wranglerPath = join(projectDir, 'wrangler.toml');
  if (!existsSync(wranglerPath)) return [];

  const wranglerContent = readFileSync(wranglerPath, 'utf-8');
  const { r2Buckets } = parseWranglerResourceConfig(wranglerContent);
  const resources: CloudflareResourceRecord[] = [];
  const workerName = resolveProjectWorkerName(projectDir) || 'edgebase';

  for (const bucket of r2Buckets) {
    const manifestRecord = findPreviousManifestBinding(
      previousManifest,
      'r2_bucket',
      bucket.binding,
    );
    const existingRecord = manifestRecord && (
      manifestRecord.id === bucket.bucketName || manifestRecord.name === bucket.bucketName
    ) ? manifestRecord : null;
    const scopedDefaultName = buildManagedR2BucketName(workerName);
    const legacyDefaultName = buildLegacyManagedR2BucketName(workerName);
    const isScopedDefault = bucket.binding === 'STORAGE' && bucket.bucketName === scopedDefaultName;
    const isLegacyDefault = bucket.binding === 'STORAGE' && bucket.bucketName === legacyDefaultName;
    if (isLegacyDefault && !existingRecord) {
      throw new Error(
        `Legacy R2 bucket '${bucket.bucketName}' cannot be reused or created without a current-account `
        + `deploy manifest proving binding '${bucket.binding}'. Regenerate the managed wrangler.toml `
        + 'or restore .edgebase/cloudflare-deploy-manifest.json before deploying.',
      );
    }
    const args = ['wrangler', 'r2', 'bucket', 'create', bucket.bucketName];
    if (bucket.jurisdiction) {
      args.push(`--jurisdiction=${bucket.jurisdiction}`);
    }

    try {
      runner(args, {
        cwd: projectDir,
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
      const msg = commandFailureText(err);
      if (isR2BucketAlreadyExistsError(msg)) {
        const ownership = isScopedDefault
          ? resolveExistingManagedBindingOwnership(existingRecord)
          : resolveExistingR2BucketRecord(existingRecord);
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
      throw new Error(
        `Required R2 binding '${bucket.binding}' could not be provisioned: ${provisioningFailureDetail(err)}`,
      );
    }
  }

  assertRequiredBindingCoverage('R2', r2Buckets.map((bucket) => bucket.binding), resources);
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
  options: ResourceProvisionOptions = {},
  runner: WranglerResourceRunner = runWranglerResourceCommand,
): ProvisionedBinding[] {
  const bindings: ProvisionedBinding[] = [];
  const dedupedKvConfig = dedupeBindingConfigs(kvConfig);
  const workerName = resolveProjectWorkerName(projectDir) || 'edgebase';

  // Get existing KV namespaces
  let existingNamespaces: Array<{ title: string; id: string }>;
  try {
    const output = runner(['wrangler', 'kv', 'namespace', 'list'], {
      cwd: projectDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    existingNamespaces = parseKvNamespaceListOutput(output);
  } catch (err) {
    throw new Error(
      'Cannot safely provision required KV namespaces because the existing-namespace list '
      + `could not be verified: ${provisioningFailureDetail(err)}`,
    );
  }

  for (const [name, config] of Object.entries(dedupedKvConfig)) {
    const bindingName = config.binding;
    const namespaceTitle = buildManagedWorkerResourceName(workerName, 'kv', bindingName);
    const previousRecord = findPreviousManifestBinding(
      options.previousManifest ?? null,
      'kv_namespace',
      bindingName,
    );
    const legacyTitles = new Set([bindingName, `${workerName}-${bindingName}`]);
    const existing = existingNamespaces.find(
      (namespace) => namespace.title === namespaceTitle,
    ) ?? (previousRecord
      ? existingNamespaces.find((namespace) =>
          previousRecord.id
            ? namespace.id === previousRecord.id
            : legacyTitles.has(namespace.title),
        )
      : undefined);

    const existingNamespace = existing;

    if (existingNamespace) {
      const ownershipRecord = matchPreviousOwnership(
        previousRecord,
        existingNamespace.id,
        legacyTitles.has(existingNamespace.title),
      );
      const ownership = resolveExistingManagedBindingOwnership(ownershipRecord);
      console.log(
        chalk.dim(`  KV '${name}' (${bindingName}): already exists → ${existingNamespace.id.slice(0, 8)}…`),
      );
      bindings.push({
        type: 'kv_namespace',
        name,
        binding: bindingName,
        id: existingNamespace.id,
        managed: ownership.managed,
        source: ownership.source,
      });
    } else {
      // Create new KV namespace
      try {
        const output = runner(['wrangler', 'kv', 'namespace', 'create', namespaceTitle], {
          cwd: projectDir,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        // Extract ID from output: "Add the following to your configuration file..."
        // "kv_namespaces = [{ binding = "...", id = "..." }]"
        const idMatch = output.match(/id\s*=\s*"([^"]+)"/);
        if (!idMatch || !/^[a-f0-9]{32}$/i.test(idMatch[1])) {
          throw new Error('Wrangler reported success without a valid KV namespace id.');
        }
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
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(chalk.red('✗'), `KV '${name}': provisioning failed — ${msg}`);
        const hints = diagnoseProvisioningError('KV', msg);
        for (const hint of hints) {
          console.log(chalk.dim(`    ${hint}`));
        }
        throw new Error(
          `Required KV binding '${bindingName}' could not be provisioned: ${provisioningFailureDetail(err)}`,
        );
      }
    }
  }

  assertRequiredBindingCoverage(
    'KV',
    Object.values(dedupedKvConfig).map((config) => config.binding),
    bindings,
  );
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
  runner: WranglerResourceRunner = runWranglerResourceCommand,
): ProvisionedBinding[] {
  const bindings: ProvisionedBinding[] = [];
  const dedupedD1Config = dedupeBindingConfigs(d1Config);
  const workerName = resolveProjectWorkerName(projectDir) || 'edgebase';

  // Get existing D1 databases
  let existingDatabases: Array<{ name: string; uuid: string }>;
  try {
    const output = runner(['wrangler', 'd1', 'list', '--json'], {
      cwd: projectDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    existingDatabases = parseD1DatabaseListOutput(output);
  } catch (err) {
    throw new Error(
      'Cannot safely provision required D1 databases because the existing-database list '
      + `could not be verified: ${provisioningFailureDetail(err)}`,
    );
  }

  for (const [name, config] of Object.entries(dedupedD1Config)) {
    const bindingName = config.binding;
    const dbName = buildManagedD1DatabaseName(workerName, name);
    const legacyDbName = buildLegacyManagedD1DatabaseName(name);
    const legacyWorkerDbName = buildLegacyWorkerScopedD1DatabaseName(workerName, name);
    const previousRecord = findPreviousManifestBinding(
      options?.previousManifest ?? null,
      'd1_database',
      bindingName,
    );
    const existing = existingDatabases.find(
      (db) => db.name === dbName
        || (!!previousRecord && (
          previousRecord.id
            ? db.uuid === previousRecord.id
            : db.name === legacyDbName || db.name === legacyWorkerDbName
        )),
    );

    if (existing) {
      const ownershipRecord = matchPreviousOwnership(
        previousRecord,
        existing.uuid,
        existing.name === legacyDbName || existing.name === legacyWorkerDbName,
      );
      const ownership = resolveExistingManagedBindingOwnership(ownershipRecord);
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
        resourceName: existing.name,
        managed: ownership.managed,
        source: ownership.source,
      });
    } else {
      try {
        const output = runner(['wrangler', 'd1', 'create', dbName], {
          cwd: projectDir,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const idMatch = output.match(/database_id\s*=\s*"([^"]+)"/);
        if (!idMatch || !isCloudflareResourceId(idMatch[1])) {
          throw new Error('Wrangler reported success without a valid D1 database id.');
        }
        console.log(
          chalk.green('✓'),
          `D1 '${name}' (${bindingName}): created → ${idMatch[1].slice(0, 8)}…`,
        );
        bindings.push({
          type: 'd1_database',
          name,
          binding: bindingName,
          id: idMatch[1],
          resourceName: dbName,
          managed: true,
          source: 'created',
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(chalk.red('✗'), `D1 '${name}': provisioning failed — ${msg}`);
        const hints = diagnoseProvisioningError('D1', msg);
        for (const hint of hints) {
          console.log(chalk.dim(`    ${hint}`));
        }
        throw new Error(
          `Required D1 binding '${bindingName}' could not be provisioned: ${provisioningFailureDetail(err)}`,
        );
      }
    }
  }

  assertRequiredBindingCoverage(
    'D1',
    Object.values(dedupedD1Config).map((config) => config.binding),
    bindings,
  );
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
  options: ResourceProvisionOptions = {},
  runner: WranglerResourceRunner = runWranglerResourceCommand,
): ProvisionedBinding[] {
  const bindings: ProvisionedBinding[] = [];
  const workerName = resolveProjectWorkerName(projectDir) || 'edgebase';

  // Get existing Vectorize indexes
  let existingIndexes: Array<{ name: string }>;
  try {
    const output = runner(['wrangler', 'vectorize', 'list', '--json'], {
      cwd: projectDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    existingIndexes = parseVectorizeIndexListOutput(output);
  } catch (err) {
    throw new Error(
      'Cannot safely provision required Vectorize indexes because the existing-index list '
      + `could not be verified: ${provisioningFailureDetail(err)}`,
    );
  }

  for (const [name, config] of Object.entries(vectorizeConfig)) {
    if (!config || typeof config !== 'object') {
      throw new Error(`Vectorize resource '${name}' must be an object.`);
    }
    const bindingName = config.binding ?? `VECTORIZE_${name.toUpperCase()}`;
    if (typeof bindingName !== 'string' || !bindingName.trim()) {
      throw new Error(`Vectorize resource '${name}' must resolve to a non-empty binding.`);
    }
    const indexName = buildManagedWorkerResourceName(workerName, 'vectorize', name);
    const previousRecord = findPreviousManifestBinding(
      options.previousManifest ?? null,
      'vectorize',
      bindingName,
    );
    const legacyIndexName = `edgebase-${name}`;
    const existing = existingIndexes.find((index) => index.name === indexName)
      ?? (previousRecord
        ? existingIndexes.find((index) =>
            previousRecord.id
              ? index.name === previousRecord.id
              : index.name === legacyIndexName,
          )
        : undefined);

    if (existing) {
      const ownershipRecord = matchPreviousOwnership(
        previousRecord,
        existing.name,
        existing.name === legacyIndexName,
      );
      const ownership = resolveExistingManagedBindingOwnership(ownershipRecord);
      console.log(chalk.dim(`  Vectorize '${name}' (${bindingName}): already exists`));
      bindings.push({
        type: 'vectorize',
        name,
        binding: bindingName,
        id: existing.name,
        managed: ownership.managed,
        source: ownership.source,
      });
    } else {
      const dimensions = config.dimensions ?? 1536;
      const metric = config.metric ?? 'cosine';
      try {
        runner(
          [
            'wrangler',
            'vectorize',
            'create',
            indexName,
            `--dimensions=${dimensions}`,
            `--metric=${metric}`,
          ],
          {
            cwd: projectDir,
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
        throw new Error(
          `Required Vectorize binding '${bindingName}' could not be provisioned: ${provisioningFailureDetail(err)}`,
        );
      }
    }
  }

  assertRequiredBindingCoverage(
    'Vectorize',
    Object.entries(vectorizeConfig).map(
      ([name, config]) => config.binding ?? `VECTORIZE_${name.toUpperCase()}`,
    ),
    bindings,
  );
  return bindings;
}

/**
 * Read a single env value from a .env file by key.
 */
function readEnvValue(envPath: string, key: string): string | undefined {
  if (!existsSync(envPath)) return undefined;
  const value = parseEnvFile(envPath)[key];
  return value?.trim() || undefined;
}

type PostScaffoldHookRunner = (
  command: string,
  args: string[],
  options: { cwd: string; stdio: 'inherit'; timeout: number },
) => unknown;

export function runProjectPostScaffoldHook(
  projectDir: string,
  runner: PostScaffoldHookRunner = (command, args, options) =>
    execFileSync(command, args, options),
): void {
  const hookPath = join(projectDir, 'scripts', 'edgebase-post-scaffold.mjs');
  if (!existsSync(hookPath)) return;

  console.log(chalk.dim(`  Running project post-scaffold hook: ${basename(hookPath)}`));
  try {
    runner(process.execPath, [hookPath, '--project-dir', projectDir], {
      cwd: projectDir,
      stdio: 'inherit',
      timeout: PROJECT_POST_SCAFFOLD_HOOK_TIMEOUT_MS,
    });
  } catch (error) {
    const failure = error as { code?: unknown; signal?: unknown; message?: unknown };
    if (
      failure.code === 'ETIMEDOUT'
      || failure.signal === 'SIGTERM'
      || /timed?\s*out/i.test(String(failure.message ?? ''))
    ) {
      throw new Error(
        'Project post-scaffold hook exceeded 5 minutes and was terminated. '
        + 'Make scripts/edgebase-post-scaffold.mjs bounded and non-interactive, then retry.',
      );
    }
    throw new Error(
      `Project post-scaffold hook failed: ${String(failure.message ?? error)}`,
    );
  }
}

/**
 * Provision Hyperdrive configs for database blocks with provider='neon'|'postgres'.
 * For each DB block with non-DO provider: check if Hyperdrive config exists,
 * create if missing via `wrangler hyperdrive create`.
 * Connection string is read from .env.release (DB_POSTGRES_{NAMESPACE}_URL by default,
 * or the db block's custom connectionString env key when provided).
 *
 * Binding convention: DB_POSTGRES_{NAMESPACE_UPPER}
 * Hyperdrive name: deterministic Worker-scoped managed name
 */
async function provisionProviderHyperdrives(
  databases: Record<string, DeployDbBlockMeta>,
  projectDir: string,
  accountId: string,
  dependencies: {
    runner?: WranglerResourceRunner;
    createConfig?: typeof createHyperdriveConfigViaApi;
    previousManifest?: ReturnType<typeof readCloudflareDeployManifest>;
  } = {},
): Promise<ProvisionedBinding[]> {
  const bindings: ProvisionedBinding[] = [];
  const workerName = resolveProjectWorkerName(projectDir) || 'edgebase';

  // Filter to PostgreSQL-backed DB blocks
  const pgBlocks = Object.entries(databases).filter(
    ([, block]) => isPostgresProvider(block.provider),
  );
  if (pgBlocks.length === 0) return bindings;

  // Get existing Hyperdrive configs
  const runner = dependencies.runner ?? runWranglerResourceCommand;
  const createConfig = dependencies.createConfig ?? createHyperdriveConfigViaApi;
  let existingConfigs = listHyperdriveConfigs(projectDir, runner);

  for (const [namespace, block] of pgBlocks) {
    const hdName = buildManagedWorkerResourceName(workerName, 'hyperdrive', `db-${namespace}`);
    const legacyHdName = `edgebase-db-${namespace}`;
    const normalized = namespace.toUpperCase().replace(/-/g, '_');
    const bindingName = `DB_POSTGRES_${normalized}`;
    const previousRecord = findPreviousManifestBinding(
      dependencies.previousManifest ?? null,
      'hyperdrive',
      bindingName,
    );
    const findExisting = (configs: Array<{ id: string; name: string }>) =>
      configs.find((config) => config.name === hdName)
      ?? (previousRecord
        ? configs.find((config) =>
            previousRecord.id
              ? config.id === previousRecord.id
              : config.name === legacyHdName,
          )
        : undefined);
    const existing = findExisting(existingConfigs);

    if (existing) {
      const ownershipRecord = matchPreviousOwnership(
        previousRecord,
        existing.id,
        existing.name === legacyHdName,
      );
      const ownership = resolveExistingManagedBindingOwnership(ownershipRecord);
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
        managed: ownership.managed,
        source: ownership.source,
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
      throw new Error(
        `Required Hyperdrive binding '${bindingName}' is missing connection string ${secretKey}. Deployment aborted.`,
      );
    }

    // Create Hyperdrive config (connection string sent in the API request
    // body, never on argv).
    const result = await createConfig(hdName, connectionString, accountId);

    if (result.status === 'created' && /^[a-f0-9]{32}$/i.test(result.id)) {
      bindings.push({
        type: 'hyperdrive',
        name: namespace,
        binding: bindingName,
        id: result.id,
        managed: true,
        source: 'created',
      });
      console.log(
        chalk.green('✓'),
        `Hyperdrive '${namespace}' (provider): created → ${result.id.slice(0, 8)}…`,
      );
      continue;
    }

    if (result.status === 'exists') {
      const existingConfig = findExisting(listHyperdriveConfigs(projectDir, runner));
      if (existingConfig) {
        const ownershipRecord = matchPreviousOwnership(
          previousRecord,
          existingConfig.id,
          existingConfig.name === legacyHdName,
        );
        const ownership = resolveExistingManagedBindingOwnership(ownershipRecord);
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
          managed: ownership.managed,
          source: ownership.source,
        });
        existingConfigs = [...existingConfigs, existingConfig];
        continue;
      }
    }

    const failureMessage = result.status === 'created'
      ? 'Hyperdrive API returned an invalid config id.'
      : result.message;
    console.log(
      chalk.yellow('⚠'),
      `Hyperdrive '${namespace}' (provider): provisioning failed — ${failureMessage}`,
    );
    const hints = diagnoseProvisioningError('Hyperdrive', failureMessage);
    for (const hint of hints) {
      console.log(chalk.dim(`    ${hint}`));
    }
    throw new Error(
      `Required Hyperdrive binding '${bindingName}' could not be provisioned: ${failureMessage}`,
    );
  }

  assertRequiredBindingCoverage(
    'Hyperdrive',
    pgBlocks.map(([namespace]) =>
      `DB_POSTGRES_${namespace.toUpperCase().replace(/-/g, '_')}`,
    ),
    bindings,
  );
  return bindings;
}

/**
 * Provision Hyperdrive config for auth PostgreSQL when config.auth.provider is 'neon'|'postgres'.
 * Follows the same pattern as provisionProviderHyperdrives but for a single global auth binding.
 *
 * Binding name: AUTH_POSTGRES (matches getAuthPostgresBindingName() in server)
 * Hyperdrive name: deterministic Worker-scoped managed name
 * Connection string: read from .env.release AUTH_POSTGRES_URL (or config.auth.connectionString)
 */
async function provisionAuthPostgresHyperdrive(
  authConfig: { provider?: string; connectionString?: string },
  projectDir: string,
  accountId: string,
  dependencies: {
    runner?: WranglerResourceRunner;
    createConfig?: typeof createHyperdriveConfigViaApi;
    previousManifest?: ReturnType<typeof readCloudflareDeployManifest>;
  } = {},
): Promise<ProvisionedBinding[]> {
  const bindings: ProvisionedBinding[] = [];
  const provider = authConfig.provider;

  if (provider !== 'neon' && provider !== 'postgres') return bindings;

  const workerName = resolveProjectWorkerName(projectDir) || 'edgebase';
  const hdName = buildManagedWorkerResourceName(workerName, 'hyperdrive', 'auth');
  const legacyHdName = 'edgebase-auth';
  const bindingName = 'AUTH_POSTGRES';

  // Check existing Hyperdrive configs
  const runner = dependencies.runner ?? runWranglerResourceCommand;
  const createConfig = dependencies.createConfig ?? createHyperdriveConfigViaApi;
  const existingConfigs = listHyperdriveConfigs(projectDir, runner);
  const previousRecord = findPreviousManifestBinding(
    dependencies.previousManifest ?? null,
    'hyperdrive',
    bindingName,
  );
  const findExisting = (configs: Array<{ id: string; name: string }>) =>
    configs.find((config) => config.name === hdName)
    ?? (previousRecord
      ? configs.find((config) =>
          previousRecord.id
            ? config.id === previousRecord.id
            : config.name === legacyHdName,
        )
      : undefined);

  const existing = findExisting(existingConfigs);
  if (existing) {
    const ownershipRecord = matchPreviousOwnership(
      previousRecord,
      existing.id,
      existing.name === legacyHdName,
    );
    const ownership = resolveExistingManagedBindingOwnership(ownershipRecord);
    console.log(
      chalk.dim(`  Hyperdrive 'auth' (${provider}): already exists → ${existing.id.slice(0, 8)}…`),
    );
    bindings.push({
      type: 'hyperdrive',
      name: 'auth',
      binding: bindingName,
      id: existing.id,
      managed: ownership.managed,
      source: ownership.source,
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
    throw new Error(
      `Required Hyperdrive binding '${bindingName}' is missing connection string ${secretKey}. Deployment aborted.`,
    );
  }

  // Create Hyperdrive config (connection string sent in the API request body,
  // never on argv).
  const result = await createConfig(hdName, connectionString, accountId);

  if (result.status === 'created' && /^[a-f0-9]{32}$/i.test(result.id)) {
    bindings.push({
      type: 'hyperdrive',
      name: 'auth',
      binding: bindingName,
      id: result.id,
      managed: true,
      source: 'created',
    });
    console.log(
      chalk.green('✓'),
      `Hyperdrive 'auth' (${provider}): created → ${result.id.slice(0, 8)}…`,
    );
    return bindings;
  }

  if (result.status === 'exists') {
    const existingConfig = findExisting(listHyperdriveConfigs(projectDir, runner));
    if (existingConfig) {
      const ownershipRecord = matchPreviousOwnership(
        previousRecord,
        existingConfig.id,
        existingConfig.name === legacyHdName,
      );
      const ownership = resolveExistingManagedBindingOwnership(ownershipRecord);
      console.log(
        chalk.dim(`  Hyperdrive 'auth' (${provider}): already exists → ${existingConfig.id.slice(0, 8)}…`),
      );
      bindings.push({
        type: 'hyperdrive',
        name: 'auth',
        binding: bindingName,
        id: existingConfig.id,
        managed: ownership.managed,
        source: ownership.source,
      });
      return bindings;
    }
  }

  const failureMessage = result.status === 'created'
    ? 'Hyperdrive API returned an invalid config id.'
    : result.message;
  console.log(chalk.yellow('⚠'), `Hyperdrive 'auth' (${provider}): provisioning failed — ${failureMessage}`);
  const hints = diagnoseProvisioningError('Hyperdrive', failureMessage);
  for (const hint of hints) {
    console.log(chalk.dim(`    ${hint}`));
  }

  throw new Error(
    `Required Hyperdrive binding '${bindingName}' could not be provisioned: ${failureMessage}`,
  );
}

export const deployCommand = new Command('deploy')
  .alias('dp')
  .description('Deploy to Cloudflare')
  .option('--dry-run', 'Validate config without deploying')
  .option(
    '--allow-worker-rename',
    'Acknowledge that a changed Worker name creates separate Durable Object storage',
  )
  .option(
    '--allow-account-change',
    'Acknowledge that a changed Cloudflare account creates separate storage and resources',
  )
  .option('--bootstrap-admin-email <email>', 'Bootstrap admin email to ensure for release deployments')
  .option('--bootstrap-admin-password-file <path>', 'Read the bootstrap admin password from a file')
  .option('--bootstrap-admin-password-stdin', 'Read the bootstrap admin password from stdin')
  .option(
    '--if-destructive <action>',
    'Action on destructive schema changes in CI/CD: reject (default) or reset',
    'reject',
  )
  .action(async (options: {
    dryRun?: boolean;
    allowWorkerRename?: boolean;
    allowAccountChange?: boolean;
    ifDestructive?: string;
    bootstrapAdminEmail?: string;
    bootstrapAdminPasswordFile?: string;
    bootstrapAdminPasswordStdin?: boolean;
  }) => {
    const projectDir = resolve('.');
    const configPath = join(projectDir, 'edgebase.config.ts');
    const isDryRun = !!options.dryRun;
    const isTTY = !!process.stdin.isTTY;
    let bootstrapAdminEmail = options.bootstrapAdminEmail
      ? normalizeAdminEmail(options.bootstrapAdminEmail)
      : '';

    if (!existsSync(configPath)) {
      raiseCliError({
        code: 'deploy_config_not_found',
        message: 'edgebase.config.ts not found.',
        hint: 'Run `npm create edgebase@latest my-app` first.',
      });
    }

    // The local manifest and Worker identity are safety authority even for a
    // dry run. Inspect them before hooks, bundling, or any Cloudflare call so
    // corruption/renames cannot produce a false-green preview.
    const storedPreviousManifest = readCloudflareDeployManifest(projectDir);
    assertWorkerIdentityContinuity(
      storedPreviousManifest,
      resolveWorkerNameFromProject(projectDir),
      options.allowWorkerRename === true,
    );

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
    try {
      assertNoReservedReleaseSecretVars(releaseVars);
      assertNoDeployOnlyReleaseSecretVars(releaseVars);
    } catch (error) {
      raiseCliError({
        code: 'deploy_reserved_release_secret',
        message: error instanceof Error ? error.message : 'Reserved release secret detected.',
        hint: 'Remove the entries named in the error from .env.release. Keep deploy/control credentials in the CLI process environment and production behavior in edgebase.config.ts.',
      });
    }
    try {
      assertNoActiveHostedDeployProcessOverrides(process.env);
    } catch (error) {
      raiseCliError({
        code: 'deploy_process_override_active',
        message: error instanceof Error ? error.message : 'Active local/test hosted deploy override detected.',
        hint: 'Unset the named local/test environment variables and rerun deploy. NODE_ENV=production is allowed.',
      });
    }
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

    if (
      !isDryRun
      && configJson?.release === true
      && !bootstrapAdminEmail
    ) {
      if (isTTY && !isJson() && !isNonInteractive()) {
        bootstrapAdminEmail = normalizeAdminEmail(await promptValue('Bootstrap admin email: ', false, {
          field: 'bootstrapAdminEmail',
          hint: 'Rerun with --bootstrap-admin-email <email>.',
          message: 'A bootstrap admin email is required for release deployments.',
        }));
      } else {
        raiseNeedsInput({
          code: 'bootstrap_admin_email_required',
          field: 'bootstrapAdminEmail',
          message: 'A bootstrap admin email is required for release deployments.',
          hint: 'Provide --bootstrap-admin-email <email> when running non-interactively.',
        });
      }
    }
    if (bootstrapAdminEmail) {
      validateAdminEmail(bootstrapAdminEmail);
    }

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

    const cloudflareEmailBinding = resolveCloudflareEmailBinding(configJson);
    const selfDestructCfg = configJson?.selfDestruct as { enabled?: boolean } | undefined;
    const storeCfCredentials = selfDestructCfg?.enabled === true
      || process.env.EDGEBASE_STORE_CF_TOKEN === '1';

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
    // Note: wildcard CORS in release mode is warned about in validateConfig().

    if (options.dryRun) {
      const dryRunBundle = createDeployAppBundle(
        projectDir,
        join('.edgebase', 'targets', 'deploy-app-dry-run'),
      );

      if (isJson()) {
        const result: Record<string, unknown> = {
          status: 'dry-run',
          config: basename(configPath),
          functions: functionsCount,
          warnings: warnings.length,
          errors: 0,
          bundleDir: dryRunBundle.outputDir,
          frontend: dryRunBundle.manifest.frontend,
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
      console.log(chalk.green('✓'), `Deploy bundle: ${dryRunBundle.outputDir}`);
      console.log(
        chalk.green('✓'),
        dryRunBundle.manifest.frontend.enabled
          ? `Frontend bundle: enabled at ${dryRunBundle.manifest.frontend.mountPath ?? '/'}`
          : 'Frontend bundle: disabled',
      );
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
    assertCloudflareAccountContinuity(
      storedPreviousManifest,
      cfAuth.accountId,
      options.allowAccountChange === true,
    );
    ensureWranglerToml(projectDir, cfAuth.accountId);
    assertWorkerIdentityContinuity(
      storedPreviousManifest,
      resolveWorkerNameFromProject(projectDir),
      options.allowWorkerRename === true,
    );
    runProjectPostScaffoldHook(projectDir);
    const deployBundle = createDeployAppBundle(
      projectDir,
      join('.edgebase', 'targets', 'deploy-app'),
    );
    const deployRuntimeDir = deployBundle.outputDir;
    const deployWranglerPath = join(deployRuntimeDir, 'wrangler.toml');
    const postHookPreviousManifest = readCloudflareDeployManifest(projectDir);
    assertCloudflareAccountContinuity(
      postHookPreviousManifest,
      cfAuth.accountId,
      options.allowAccountChange === true,
    );
    const previousManifest = scopePreviousManifestToAccount(
      postHookPreviousManifest,
      cfAuth.accountId,
    );
    const currentWorkerName = resolveWorkerNameFromProject(projectDir);
    assertWorkerIdentityContinuity(
      previousManifest,
      currentWorkerName,
      options.allowWorkerRename === true,
    );
    let workerAlreadyDeployed = remoteWorkerExists(
      projectDir,
      currentWorkerName,
    );
    if (workerAlreadyDeployed) {
      try {
        const remoteSecretNames = listWranglerSecretNames(projectDir);
        assertNoReservedRemoteWorkerSecrets(remoteSecretNames);
        assertNoDeployOnlyRemoteWorkerSecrets(remoteSecretNames, storeCfCredentials);
      } catch (error) {
        raiseCliError({
          code: 'deploy_reserved_remote_secret',
          message: error instanceof Error ? error.message : 'Reserved remote Worker secret detected.',
          hint: 'Inspect `npx edgebase secret list`, verify the Worker identity, and run the exact `npx edgebase secret delete <name>` commands shown before retrying.',
        });
      }
    }
    console.log();

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
    let tempDeploySecretsPath: string | null = null;
    let disposeTempDeploySecretCleanup: (() => void) | null = null;
    let turnstileSecret: string | undefined;
    let turnstileProvision: TurnstileProvisionResult | null = null;
    let turnstileDeployLease: TurnstileDeployLease | null = null;
    const renewManagedTurnstileLease = async () => {
      if (!turnstileDeployLease) {
        throw new Error('Managed Turnstile mutation requires an active remote deploy lease.');
      }
      const apiToken = process.env.CLOUDFLARE_API_TOKEN;
      if (!apiToken) throw new Error('CLOUDFLARE_API_TOKEN is required to renew the deploy lease.');
      turnstileDeployLease = await renewTurnstileDeployLease(
        turnstileDeployLease,
        apiToken,
      );
    };
    const releaseManagedTurnstileLease = async () => {
      if (!turnstileDeployLease) return;
      const lease = turnstileDeployLease;
      const apiToken = process.env.CLOUDFLARE_API_TOKEN;
      if (!apiToken) throw new Error('CLOUDFLARE_API_TOKEN disappeared before deploy-lease release.');
      await releaseTurnstileDeployLease(lease, apiToken);
      if (turnstileDeployLease === lease) turnstileDeployLease = null;
    };
    const provisionSpinner = spin('Provisioning Cloudflare resources...');
    const wranglerPath = deployWranglerPath;

    try {
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
          provisionedBindings.push(...provisionKvNamespaces(
            mergedKvConfig,
            projectDir,
            { previousManifest },
          ));
        }
        const mergedD1Config = buildMergedD1Config(d1Cfg, dbsCfg);
        if (Object.keys(mergedD1Config).length > 0) {
          provisionedBindings.push(...provisionD1Databases(mergedD1Config, projectDir, { previousManifest }));
        }
        if (vecCfg && Object.keys(vecCfg).length > 0) {
          provisionedBindings.push(...provisionVectorizeIndexes(
            vecCfg,
            projectDir,
            { previousManifest },
          ));
        }
        if (dbsCfg && hasProviderDbs) {
          provisionedBindings.push(...await provisionProviderHyperdrives(
            dbsCfg,
            projectDir,
            cfAuth.accountId,
            { previousManifest },
          ));
        }
        if (authCfg && hasAuthPostgres) {
          provisionedBindings.push(...await provisionAuthPostgresHyperdrive(
            authCfg,
            projectDir,
            cfAuth.accountId,
            { previousManifest },
          ));
        }
      } else {
        provisionedBindings.push(...provisionInternalD1Databases(projectDir, { previousManifest }));
      }

      manifestResources.push(...provisionedBindings.map(toManifestResourceRecord));

      // Generate temp wrangler.toml with bindings + cron triggers
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
            sendEmailBinding: cloudflareEmailBinding,
            runtimeMode: 'cloudflare',
            requiredCompatibilityFlags: RUNTIME_PROCESS_ENV_COMPATIBILITY_FLAGS,
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
    } catch (err) {
      provisionSpinner.fail('Cloudflare resource provisioning failed');
      throw err;
    }

    // Generate temp wrangler.toml for cron triggers even if no resource bindings
    if (!tempWranglerPath && (cronSchedules.length > 0 || rateLimitBindings.length > 0)) {
      const cronOnlyWranglerPath = deployWranglerPath;
      if (existsSync(cronOnlyWranglerPath)) {
        tempWranglerPath = generateTempWranglerToml(
          cronOnlyWranglerPath,
          {
            bindings: [],
            triggerMode: 'replace',
            managedCrons: cronSchedules,
            rateLimitBindings,
            sendEmailBinding: cloudflareEmailBinding,
            runtimeMode: 'cloudflare',
            requiredCompatibilityFlags: RUNTIME_PROCESS_ENV_COMPATIBILITY_FLAGS,
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
        sendEmailBinding: cloudflareEmailBinding,
        runtimeMode: 'cloudflare',
        requiredCompatibilityFlags: RUNTIME_PROCESS_ENV_COMPATIBILITY_FLAGS,
      });
      if (tempWranglerPath) {
        console.log(chalk.green('✓'), 'Generated temp wrangler.toml with admin assets binding');
      }
    }

    // ─── Turnstile Auto-Provisioning ───
    if (configJson) {
      const captchaCfg = configJson.captcha as
        | boolean
        | { siteKey: string; secretKey?: string; hostnames?: string[] }
        | undefined;
      if (captchaCfg) {
        try {
          if (captchaCfg === true) {
            const controlDb = provisionedBindings.find((binding) =>
              binding.type === 'd1_database' && binding.binding === 'CONTROL_DB',
            );
            const apiToken = process.env.CLOUDFLARE_API_TOKEN;
            if (!controlDb || !apiToken) {
              throw new Error(
                'Managed CAPTCHA requires the provisioned CONTROL_DB and a '
                + 'CLOUDFLARE_API_TOKEN with D1 Write plus Turnstile Edit permissions.',
              );
            }
            turnstileDeployLease = await acquireTurnstileDeployLease(
              cfAuth.accountId,
              controlDb.id,
              apiToken,
            );
            // The pre-provisioning lookup may be stale after waiting for the
            // distributed lease. Re-read remote authority while holding it so
            // first-deploy secret preparation cannot overwrite a deploy that
            // completed immediately before this owner acquired the lease.
            workerAlreadyDeployed = remoteWorkerExists(
              projectDir,
              resolveWorkerNameFromProject(projectDir),
            );
          }
          turnstileProvision = await provisionTurnstile(
            captchaCfg,
            projectDir,
            configJson,
            cfAuth.accountId,
            renewManagedTurnstileLease,
          );
          if (!turnstileProvision) {
            throw new Error('CAPTCHA runtime configuration could not be provisioned.');
          }
          if (turnstileDeployLease) {
            const apiToken = process.env.CLOUDFLARE_API_TOKEN;
            if (!apiToken) throw new Error('CLOUDFLARE_API_TOKEN is required to renew the deploy lease.');
            turnstileDeployLease = await renewTurnstileDeployLease(
              turnstileDeployLease,
              apiToken,
            );
          }

          // The site key and exact hostname allowlist are public runtime vars;
          // the paired secret is synchronized as a Workers secret below.
          const targetToml = tempWranglerPath ?? deployWranglerPath;
          injectCaptchaSiteKey(
            targetToml,
            turnstileProvision.siteKey,
            turnstileProvision.hostnames,
          );
          turnstileSecret = turnstileProvision.secretKey;
        } catch (err) {
          try {
            await releaseManagedTurnstileLease();
          } catch {
            // The bounded remote lease expires after a crashed/failed deploy.
          }
          raiseCliError({
            code: 'captcha_provision_failed',
            message: `CAPTCHA provisioning failed: ${(err as Error).message}`,
            hint: 'Deployment was aborted before publishing. Configure 1-10 exact '
              + 'hostnames and valid Turnstile credentials, then retry.',
          });
        }

        if (turnstileProvision.managed && turnstileProvision.widgetName) {
          const previousTurnstile = findCloudflareResourceRecord(previousManifest, {
            type: 'turnstile_widget',
            name: turnstileProvision.widgetName,
            id: turnstileProvision.widgetName,
          });
          manifestResources.push({
            type: 'turnstile_widget',
            name: turnstileProvision.widgetName,
            id: turnstileProvision.widgetName,
            managed: previousTurnstile?.managed ?? true,
            source: turnstileProvision.source,
            metadata: {
              siteKey: turnstileProvision.siteKey,
              hostnames: turnstileProvision.hostnames.join(','),
            },
          });
        }
        console.log();
      }
    }

    // ─── Atomic version-bound secret preparation ───
    // Wrangler's --secrets-file binds secret updates to the same Worker version
    // as the public config/code upload. This prevents both first-deploy gaps and
    // redeploy windows where a new Turnstile site key is paired with an old
    // secret (or the old Worker suddenly receives a rotated secret).
    try {
      tempDeploySecretsPath = prepareAtomicDeploySecrets(
        projectDir,
        cfAuth.accountId,
        workerAlreadyDeployed,
        { storeCfCredentials, turnstileSecret },
      );
      if (tempDeploySecretsPath) {
        disposeTempDeploySecretCleanup = registerDeploySecretCleanup(tempDeploySecretsPath);
      }
    } catch (err) {
      try {
        await releaseManagedTurnstileLease();
      } catch {
        // Expiry is the crash-safe fallback.
      }
      raiseCliError({
        code: 'deploy_secret_prepare_failed',
        message: `Secret preparation failed before deploy: ${(err as Error).message}`,
        hint: 'Aborted before publishing — the previous live version is unchanged. '
          + 'Fix Cloudflare auth/secrets and re-run `npx edgebase deploy`.',
      });
    }

    // ─── Deploy ───
    const deployArgs = ['wrangler', 'deploy'];
    if (tempWranglerPath) {
      deployArgs.push('--config', tempWranglerPath);
      console.log(chalk.dim(`  Using generated config: ${tempWranglerPath}`));
    }
    if (tempDeploySecretsPath) {
      deployArgs.push('--secrets-file', tempDeploySecretsPath);
      console.log(chalk.dim('  Applying runtime secrets atomically with the Worker version'));
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
          cwd: deployRuntimeDir,
          stdio: ['inherit', 'pipe', 'pipe'],
        });
        let capturedDeployOutput = '';
        const disposeDeployTimeout = registerDeploySubprocessTimeout(wrangler, () => {
          const timeoutMessage = '\nWrangler deploy exceeded 10 minutes and was terminated.\n';
          capturedDeployOutput += timeoutMessage;
          process.stderr.write(timeoutMessage);
        });

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
          disposeDeployTimeout();
          if (tempWranglerPath)
            try {
              unlinkSync(tempWranglerPath);
            } catch {
              /* ignore */
            }
          disposeTempDeploySecretCleanup?.();
          rejectDeploy(err);
        });

        wrangler.on('exit', (code) => {
          disposeDeployTimeout();
          if (tempWranglerPath) {
            try {
              unlinkSync(tempWranglerPath);
            } catch {
              /* ignore */
            }
            console.log(chalk.dim('  Cleaned up temp wrangler.toml'));
          }
          if (tempDeploySecretsPath) {
            disposeTempDeploySecretCleanup?.();
            console.log(chalk.dim('  Removed temporary deploy secrets file'));
          }
          resolveDeploy({ code: code ?? 1, output: capturedDeployOutput });
        });
      }));
    } catch (err) {
      try {
        await releaseManagedTurnstileLease();
      } catch {
        // Expiry is the crash-safe fallback.
      }
      raiseCliError({
        code: 'deploy_spawn_failed',
        message: `Deploy failed to start: ${(err as Error).message}`,
        hint: 'Check your Wrangler installation and Cloudflare authentication, then retry.',
      });
    }

    if (deployExitCode !== 0) {
      // Provide resource-specific hints when the final deploy step fails
      // Strip ANSI escape codes before matching error patterns
      const outputLower = deployOutput.replace(ANSI_ESCAPE_REGEX, '').toLowerCase();
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
      try {
        await releaseManagedTurnstileLease();
      } catch {
        // Expiry is the crash-safe fallback.
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

    try {
      if (turnstileDeployLease) {
        // Assert ownership immediately after Wrangler returns. The process may
        // have been suspended beyond the bounded lease while the child deploy
        // completed; a lost owner must leave the safe staged union untouched.
        await renewManagedTurnstileLease();
      }
      await finalizeTurnstileProvision(
        turnstileProvision,
        cfAuth.accountId,
        extractWorkerVersionIdFromWranglerDeployOutput(deployOutput),
        turnstileDeployLease ? renewManagedTurnstileLease : undefined,
      );
      await releaseManagedTurnstileLease();
    } catch (err) {
      try {
        await releaseManagedTurnstileLease();
      } catch {
        // The original finalization/lease error is more actionable; expiry is bounded.
      }
      raiseCliError({
        code: 'captcha_hostname_finalize_failed',
        message: `Worker deploy succeeded, but managed CAPTCHA finalization failed: ${(err as Error).message}`,
        hint: 'The staged old∪new hostname union was left safe. Resolve the live Worker version or D1/Turnstile API access, then rerun deploy.',
      });
    }

    const deployedWorkerUrl = resolveDeployedWorkerUrl(projectDir, deployOutput);
    let persistedManifestResources = dedupeManifestResources([
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
      const retiredTurnstileWidgets = await cleanupLegacyTurnstileWidgets(
        turnstileProvision,
        cfAuth.accountId,
      );
      if (retiredTurnstileWidgets.length > 0) {
        const retiredNames = new Set(retiredTurnstileWidgets.map((widget) => widget.name));
        persistedManifestResources = persistedManifestResources.filter((resource) =>
          resource.type !== 'turnstile_widget' || !retiredNames.has(resource.name),
        );
        writeCloudflareDeployManifest(projectDir, {
          version: 2,
          deployedAt: new Date().toISOString(),
          accountId: cfAuth.accountId,
          worker: {
            name: resolveWorkerNameFromProject(projectDir),
            url: deployedWorkerUrl,
          },
          resources: persistedManifestResources,
        });
        if (!isQuiet()) {
          console.log(
            chalk.green('✓'),
            `Removed ${retiredTurnstileWidgets.length} legacy Turnstile widget(s)`,
          );
        }
      }
    } catch (err) {
      raiseCliError({
        code: 'captcha_legacy_widget_cleanup_failed',
        message: `Worker deploy succeeded, but legacy Turnstile widget cleanup failed: ${(err as Error).message}`,
        hint: 'No live/recent widget was deleted. Fix Cloudflare API access and re-run deploy before the account reaches its widget quota.',
      });
    }

    // Store deploy manifest in KV for runtime self-destruct
    storeManifestInKv(projectDir, persistedManifestResources, cfAuth.accountId, {
      workerName: resolveWorkerNameFromProject(projectDir),
      workerUrl: deployedWorkerUrl,
    });

    // The Worker is already published and the local/KV identity manifests have
    // been preserved at this point. A release still cannot be reported as
    // successful until Wrangler proves the concrete URL used for bootstrap and
    // admin verification.
    assertReleasePostDeployWorkerUrl(configJson, deployedWorkerUrl);

    let bootstrapAdminResult: EnsureBootstrapAdminResult | null = null;
    if (configJson?.release === true && deployedWorkerUrl) {
      const serviceKey = resolveOptionalServiceKey({});
      if (!serviceKey) {
        raiseCliError({
          code: 'bootstrap_admin_service_key_missing',
          message: 'Deploy succeeded, but no Service Key was available for bootstrap admin setup.',
          hint: 'Check .edgebase/secrets.json or set EDGEBASE_SERVICE_KEY, then run `npx edgebase admin bootstrap --url <worker-url>`.',
        });
      }

      if (!isQuiet()) {
        console.log(chalk.dim('  Ensuring bootstrap admin...'));
      }

      bootstrapAdminResult = await ensureBootstrapAdmin({
        url: deployedWorkerUrl,
        serviceKey,
        email: bootstrapAdminEmail,
        passwordFile: options.bootstrapAdminPasswordFile,
        passwordStdin: options.bootstrapAdminPasswordStdin,
        emailPromptHint: 'Rerun with --bootstrap-admin-email <email>.',
        emailRequiredMessage: 'A bootstrap admin email is required for release deployments.',
        passwordPromptHint: 'Use --bootstrap-admin-password-file <path> or pipe the password with --bootstrap-admin-password-stdin in CI/CD.',
        passwordRequiredMessage: 'A bootstrap admin password is required to create the first admin account.',
      });
    }

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
          ...(bootstrapAdminResult ? { bootstrapAdmin: bootstrapAdminResult.status } : {}),
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

      if (bootstrapAdminResult?.status === 'created') {
        console.log(chalk.green('✓'), `Bootstrap admin created for ${bootstrapAdminResult.admin.email}`);
      } else if (bootstrapAdminResult?.status === 'already-configured') {
        console.log(chalk.green('✓'), `Bootstrap admin already configured for ${bootstrapAdminResult.admin.email}`);
      } else if (bootstrapAdminResult?.status === 'skipped-existing') {
        const knownAdmins = bootstrapAdminResult.admins.map((admin) => admin.email).join(', ');
        console.log(chalk.yellow('⚠'), 'Admin bootstrap skipped because admin accounts already exist.');
        console.log(chalk.dim(`  Existing admins: ${knownAdmins}`));
        if (bootstrapAdminResult.requestedEmail) {
          console.log(chalk.dim(`  Requested bootstrap email: ${bootstrapAdminResult.requestedEmail}`));
        }
        console.log(chalk.dim('  Add or rotate admins from the dashboard settings or with `npx edgebase admin bootstrap`/admin APIs instead of reusing deploy bootstrap.'));
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
        console.log(JSON.stringify({
          status: 'success',
          url: deployedWorkerUrl,
          migrated: true,
          ...(bootstrapAdminResult ? { bootstrapAdmin: bootstrapAdminResult.status } : {}),
        }));
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

// ─── Version-bound deploy secrets ───

function readPersistedSecretsFile(path: string): Record<string, string> {
  const pathStats = lstatSync(path);
  if (pathStats.isSymbolicLink() || !pathStats.isFile()) {
    throw new Error('.edgebase/secrets.json must be a regular file and must not be a symbolic link.');
  }
  if (pathStats.size > PERSISTED_SECRETS_MAX_BYTES) {
    throw new Error('.edgebase/secrets.json exceeds the 64 KiB safety limit.');
  }

  const noFollow = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
  let fd: number | null = null;
  let raw = '';
  try {
    fd = openSync(path, fsConstants.O_RDONLY | noFollow);
    const openedStats = fstatSync(fd);
    if (
      !openedStats.isFile()
      || openedStats.dev !== pathStats.dev
      || openedStats.ino !== pathStats.ino
      || openedStats.size > PERSISTED_SECRETS_MAX_BYTES
    ) {
      throw new Error('.edgebase/secrets.json changed while it was being validated.');
    }
    fchmodSync(fd, 0o600);
    raw = readFileSync(fd, 'utf-8');
    if (Buffer.byteLength(raw, 'utf-8') > PERSISTED_SECRETS_MAX_BYTES) {
      throw new Error('.edgebase/secrets.json exceeds the 64 KiB safety limit.');
    }
    // Enforce the private mode after the read too, including no-change deploys.
    fchmodSync(fd, 0o600);
  } finally {
    if (fd !== null) {
      try {
        fchmodSync(fd, 0o600);
      } finally {
        closeSync(fd);
      }
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('Cannot prepare deployment with invalid .edgebase/secrets.json JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('.edgebase/secrets.json must contain one JSON object of string values.');
  }

  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length > PERSISTED_SECRETS_MAX_ENTRIES) {
    throw new Error('.edgebase/secrets.json contains too many entries.');
  }
  const secrets: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) || typeof value !== 'string') {
      throw new Error('.edgebase/secrets.json must use bounded environment-style names and string values only.');
    }
    if (Buffer.byteLength(value, 'utf-8') > PERSISTED_SECRET_VALUE_MAX_BYTES) {
      throw new Error(`.edgebase/secrets.json value for ${name} exceeds the safety limit.`);
    }
    secrets[name] = value;
  }
  return secrets;
}

function writePersistedSecretsFile(path: string, secrets: Record<string, string>): void {
  const tempPath = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  let fd: number | null = null;
  try {
    fd = openSync(
      tempPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
      0o600,
    );
    writeFileSync(fd, JSON.stringify(secrets, null, 2), 'utf-8');
    fchmodSync(fd, 0o600);
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(tempPath, path);
    chmodSync(path, 0o600);
  } catch (error) {
    if (fd !== null) closeSync(fd);
    try {
      unlinkSync(tempPath);
    } catch {
      // The temp file may already have been renamed or never created.
    }
    throw error;
  }
}

function isReusableManagedSecret(value: unknown, alreadyUsed: Set<string>): value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value)) return false;
  const normalized = value.toLowerCase();
  if (/^0{64}$/.test(normalized)) return false;
  if (new Set(normalized).size < 8) return false;
  return !alreadyUsed.has(normalized);
}

function generateIndependentManagedSecret(alreadyUsed: Set<string>): string {
  let candidate = '';
  do {
    candidate = randomBytes(32).toString('hex');
  } while (!isReusableManagedSecret(candidate, alreadyUsed));
  return candidate;
}

/**
 * Build a short-lived Wrangler --secrets-file. Wrangler applies this file to
 * the exact version uploaded by `wrangler deploy`, so code/public vars and
 * rotated credentials become visible together. Omitted secrets are retained
 * by Wrangler, which lets existing deployments keep secrets whose plaintext is
 * intentionally unavailable to the CLI.
 */
function prepareAtomicDeploySecrets(
  projectDir: string,
  accountId: string,
  workerAlreadyDeployed: boolean,
  options: {
    storeCfCredentials: boolean;
    turnstileSecret?: string;
    /** Internal test seam; production always queries Wrangler. */
    remoteSecretNames?: Set<string>;
  },
): string | null {
  const vars = resolveReleaseSecretVars(projectDir);
  assertNoReservedReleaseSecretVars(vars);
  const secretNames = workerAlreadyDeployed
    ? (options.remoteSecretNames ?? listWranglerSecretNames(projectDir))
    : new Set<string>();
  assertNoReservedRemoteWorkerSecrets(secretNames);
  assertNoDeployOnlyRemoteWorkerSecrets(secretNames, options.storeCfCredentials);

  // SERVICE_KEY is CLI-owned. Runtime trust mode is a non-secret Wrangler var.
  delete vars['SERVICE_KEY'];
  delete vars['EDGEBASE_RUNTIME_MODE'];

  const edgebaseDir = join(projectDir, '.edgebase');
  const secretsJsonPath = join(edgebaseDir, 'secrets.json');
  if (!existsSync(edgebaseDir)) mkdirSync(edgebaseDir, { recursive: true });
  scavengeStaleDeploySecrets(edgebaseDir);

  let persistedSecrets: Record<string, string> = {};
  if (existsSync(secretsJsonPath)) {
    persistedSecrets = readPersistedSecretsFile(secretsJsonPath);
  }

  let persistedSecretsChanged = false;
  const generatedAt = new Date().toISOString();
  const usedManagedSecrets = new Set<string>();
  const ensureManagedSecret = (name: typeof MANAGED_SECRET_NAMES[number]) => {
    const persisted = persistedSecrets[name];
    const hasReusablePersisted = isReusableManagedSecret(persisted, usedManagedSecrets);
    const remoteAlreadyHasSecret = secretNames.has(name);
    const explicitVersionSecret = typeof vars[name] === 'string' && vars[name].length > 0;

    if (remoteAlreadyHasSecret && !explicitVersionSecret && !hasReusablePersisted) {
      throw new Error(
        `Cannot safely deploy over existing remote ${name}: .edgebase/secrets.json does not contain its valid authoritative local value. `
        + 'Restore the private secrets file from the deployment backup, or use an explicit credential rotation/recovery flow before publishing. '
        + 'EdgeBase will not invent a different local value while retaining an unknown live Worker secret.',
      );
    }

    if (remoteAlreadyHasSecret && !explicitVersionSecret && hasReusablePersisted) {
      usedManagedSecrets.add(persisted.toLowerCase());
      return;
    }

    // An explicit version-bound JWT secret is deployment authority and does
    // not need a second CLI-owned plaintext copy. SERVICE_KEY is stripped
    // above, so it always follows the local authority/recovery rule.
    if (explicitVersionSecret) return;

    const reusable = hasReusablePersisted
      ? persisted.toLowerCase()
      : generateIndependentManagedSecret(usedManagedSecrets);
    usedManagedSecrets.add(reusable);
    if (persisted !== reusable) {
      persistedSecrets[name] = reusable;
      persistedSecretsChanged = true;
    }
    if (!secretNames.has(name) && !vars[name]) vars[name] = reusable;
    if (name === 'SERVICE_KEY' && !persistedSecrets['SERVICE_KEY_CREATED_AT']) {
      persistedSecrets['SERVICE_KEY_CREATED_AT'] = generatedAt;
      persistedSecrets['SERVICE_KEY_UPDATED_AT'] = generatedAt;
      persistedSecretsChanged = true;
    }
  };

  for (const name of MANAGED_SECRET_NAMES) ensureManagedSecret(name);

  if (options.turnstileSecret) {
    vars['TURNSTILE_SECRET'] = options.turnstileSecret;
  }

  if (options.storeCfCredentials) {
    const explicitToken = process.env.EDGEBASE_SELF_DESTRUCT_CF_TOKEN
      || process.env.CLOUDFLARE_API_TOKEN;
    if (explicitToken) {
      if (!secretNames.has('CF_API_TOKEN')) vars['CF_API_TOKEN'] = explicitToken;
      if (!secretNames.has('CF_ACCOUNT_ID')) vars['CF_ACCOUNT_ID'] = accountId;
    } else if (!isQuiet()) {
      console.log(chalk.yellow('  ⚠ Self-management enabled but no explicit Cloudflare token provided.'));
      console.log(chalk.dim('    Set EDGEBASE_SELF_DESTRUCT_CF_TOKEN (or CLOUDFLARE_API_TOKEN) to a scoped token.'));
    }
  }

  // Strip plaintext copies written by legacy CLI versions.
  if (Object.prototype.hasOwnProperty.call(persistedSecrets, 'CF_API_TOKEN')) {
    delete persistedSecrets['CF_API_TOKEN'];
    persistedSecretsChanged = true;
  }
  if (persistedSecretsChanged) {
    writePersistedSecretsFile(secretsJsonPath, persistedSecrets);
  }

  const names = Object.keys(vars).sort();
  if (names.length === 0) return null;
  const secretsPath = join(
    edgebaseDir,
    `.deploy-secrets-${process.pid}-${randomBytes(6).toString('hex')}.json`,
  );
  writeFileSync(
    secretsPath,
    JSON.stringify(vars),
    { encoding: 'utf-8', mode: 0o600 },
  );
  chmodSync(secretsPath, 0o600);
  if (!isQuiet()) {
    console.log(chalk.green('✓'), `Prepared ${names.length} version-bound Worker secret(s)`);
  }
  return secretsPath;
}

function resolveReleaseSecretVars(projectDir: string): Record<string, string> {
  const envReleasePath = join(projectDir, '.env.release');
  if (!existsSync(envReleasePath)) return {};

  const vars = parseEnvFile(envReleasePath);
  assertNoReservedReleaseSecretVars(vars);
  assertNoDeployOnlyReleaseSecretVars(vars);
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
        timeout: WRANGLER_RESOURCE_COMMAND_TIMEOUT_MS,
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
