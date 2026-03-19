import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import chalk from 'chalk';
import { ensureCloudflareAuth, resolveApiToken } from './cf-auth.js';
import { isQuiet } from './cli-context.js';
import { writeLocalSecrets } from './local-secrets.js';
import { deriveProjectSlug } from './runtime-scaffold.js';
import { npxCommand } from './npx.js';

const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';

export const REALTIME_SECRET_NAMES = [
  'CF_REALTIME_APP_ID',
  'CF_REALTIME_APP_SECRET',
  'CF_REALTIME_TURN_KEY_ID',
  'CF_REALTIME_TURN_API_TOKEN',
] as const;

type RealtimeSecretName = (typeof REALTIME_SECRET_NAMES)[number];

interface CloudflareEnvelope<T> {
  success: boolean;
  result?: T;
  errors?: Array<{ code?: number; message?: string }>;
}

interface CloudflareRealtimeAppSummary {
  uid: string;
  name: string;
  created?: string;
  modified?: string;
}

interface CloudflareRealtimeApp extends CloudflareRealtimeAppSummary {
  secret?: string;
}

interface CloudflareTurnKeySummary {
  uid: string;
  name: string;
  created?: string;
  modified?: string;
}

interface CloudflareTurnKey extends CloudflareTurnKeySummary {
  key?: string;
}

export interface RealtimeProvisionOptions {
  projectDir: string;
  appName?: string;
  turnName?: string;
  forceCreateApp?: boolean;
  forceCreateTurn?: boolean;
  syncWorkersSecrets?: boolean;
}

export interface RealtimeProvisionResult {
  appId: string;
  appSecret: string;
  appName: string;
  appSource: 'local' | 'created';
  turnKeyId: string;
  turnApiToken: string;
  turnName: string;
  turnSource: 'local' | 'created';
  warnings?: string[];
}

function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  const values: Record<string, string> = {};
  const raw = readFileSync(filePath, 'utf-8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    values[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return values;
}

function readLocalSecretSnapshot(projectDir: string): Partial<Record<RealtimeSecretName, string>> {
  const fromJson = (() => {
    const filePath = join(projectDir, '.edgebase', 'secrets.json');
    if (!existsSync(filePath)) return {};
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, string>;
      return parsed;
    } catch {
      return {};
    }
  })();

  const merged = {
    ...parseEnvFile(join(projectDir, '.env.development')),
    ...parseEnvFile(join(projectDir, '.dev.vars')),
    ...fromJson,
  } as Record<string, string>;

  const snapshot: Partial<Record<RealtimeSecretName, string>> = {};
  for (const key of REALTIME_SECRET_NAMES) {
    if (typeof merged[key] === 'string' && merged[key]) {
      snapshot[key] = merged[key];
    }
  }
  return snapshot;
}

function readWranglerName(projectDir: string): string | null {
  const wranglerPath = join(projectDir, 'wrangler.toml');
  if (!existsSync(wranglerPath)) return null;
  const content = readFileSync(wranglerPath, 'utf-8');
  const match = content.match(/^name\s*=\s*"([^"]+)"/m);
  return match?.[1] ?? null;
}

function deriveManagedBaseName(projectDir: string): string {
  return readWranglerName(projectDir) ?? deriveProjectSlug(projectDir) ?? basename(projectDir);
}

function getDefaultRealtimeNames(projectDir: string): { appName: string; turnName: string } {
  const baseName = deriveManagedBaseName(projectDir);
  return {
    appName: `${baseName}-realtime`,
    turnName: `${baseName}-turn`,
  };
}

function toProvisionAuthError(error: unknown, tokenSource: 'env' | 'wrangler_oauth'): Error {
  if (!(error instanceof Error)) {
    return new Error('Cloudflare Realtime provisioning failed for an unknown reason.');
  }

  const msg = error.message.toLowerCase();

  // Calls/Realtime not enabled on the account
  if (msg.includes('not found') || msg.includes('not enabled') || msg.includes('code: 10042') || msg.includes('code: 7000') || msg.includes('does not have access')) {
    return new Error(
      'Cloudflare Calls (Realtime) does not appear to be enabled on your account.\n' +
      '    To enable: Cloudflare Dashboard → Calls → Get Started (beta signup may be required).\n' +
      '    Or remove "realtime" from edgebase.config.ts if your app doesn\'t need WebSocket/media features.\n' +
      '    Docs: https://developers.cloudflare.com/calls/',
    );
  }

  // Auth token lacks Calls permissions
  if (tokenSource === 'wrangler_oauth' && /authentication error/i.test(error.message)) {
    return new Error(
      'Cloudflare Calls/Realtime provisioning rejected the current wrangler OAuth token.\n' +
      '    Create a Cloudflare API token with Calls Write or Connectivity Admin permissions,\n' +
      '    export it as CLOUDFLARE_API_TOKEN, and rerun this command.',
    );
  }

  // Quota / plan limits
  if (msg.includes('quota') || msg.includes('limit') || msg.includes('exceeded')) {
    return new Error(
      `Cloudflare Calls provisioning failed due to account limits: ${error.message}\n` +
      '    Check your plan limits: Cloudflare Dashboard → Calls\n' +
      '    You may need to upgrade your plan or delete unused apps/keys.',
    );
  }

  return error;
}

async function cloudflareApi<T>(
  accountId: string,
  apiToken: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${CLOUDFLARE_API_BASE}/accounts/${accountId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const data = (await response.json().catch(() => ({}))) as CloudflareEnvelope<T>;
  if (!response.ok || !data.success || data.result === undefined) {
    const errorMessage = data.errors?.map((error) => error.message).filter(Boolean).join(', ');
    throw new Error(errorMessage || `Cloudflare API request failed (${response.status})`);
  }

  return data.result;
}

async function listRealtimeApps(
  accountId: string,
  apiToken: string,
): Promise<CloudflareRealtimeAppSummary[]> {
  return cloudflareApi<CloudflareRealtimeAppSummary[]>(accountId, apiToken, '/calls/apps');
}

async function createRealtimeApp(
  accountId: string,
  apiToken: string,
  name: string,
): Promise<CloudflareRealtimeApp> {
  return cloudflareApi<CloudflareRealtimeApp>(accountId, apiToken, '/calls/apps', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

async function listTurnKeys(
  accountId: string,
  apiToken: string,
): Promise<CloudflareTurnKeySummary[]> {
  return cloudflareApi<CloudflareTurnKeySummary[]>(accountId, apiToken, '/calls/turn_keys');
}

async function createTurnKey(
  accountId: string,
  apiToken: string,
  name: string,
): Promise<CloudflareTurnKey> {
  return cloudflareApi<CloudflareTurnKey>(accountId, apiToken, '/calls/turn_keys', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

function hasCompleteLocalSecrets(snapshot: Partial<Record<RealtimeSecretName, string>>): snapshot is Record<RealtimeSecretName, string> {
  return REALTIME_SECRET_NAMES.every((key) => typeof snapshot[key] === 'string' && snapshot[key]);
}

function putWorkersSecret(projectDir: string, secretName: string, value: string): void {
  execFileSync(npxCommand(), ['wrangler', 'secret', 'put', secretName], {
    cwd: projectDir,
    input: value,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function syncWorkersSecrets(
  projectDir: string,
  secrets: Record<RealtimeSecretName, string>,
): void {
  for (const [secretName, value] of Object.entries(secrets) as Array<[RealtimeSecretName, string]>) {
    putWorkersSecret(projectDir, secretName, value);
  }
}

export async function provisionRealtime(
  options: RealtimeProvisionOptions,
): Promise<RealtimeProvisionResult> {
  const existingSecrets = readLocalSecretSnapshot(options.projectDir);
  const names = getDefaultRealtimeNames(options.projectDir);
  const appName = options.appName?.trim() || names.appName;
  const turnName = options.turnName?.trim() || names.turnName;

  if (
    hasCompleteLocalSecrets(existingSecrets) &&
    !options.forceCreateApp &&
    !options.forceCreateTurn
  ) {
    return {
      appId: existingSecrets.CF_REALTIME_APP_ID,
      appSecret: existingSecrets.CF_REALTIME_APP_SECRET,
      appName,
      appSource: 'local',
      turnKeyId: existingSecrets.CF_REALTIME_TURN_KEY_ID,
      turnApiToken: existingSecrets.CF_REALTIME_TURN_API_TOKEN,
      turnName,
      turnSource: 'local',
    };
  }

  const auth = await ensureCloudflareAuth(options.projectDir, process.stdout.isTTY);
  const { token: apiToken, source: apiTokenSource } = resolveApiToken();

  try {
    let appId = existingSecrets.CF_REALTIME_APP_ID;
    let appSecret = existingSecrets.CF_REALTIME_APP_SECRET;
    let appSource: 'local' | 'created' = appId && appSecret ? 'local' : 'created';

    if (options.forceCreateApp || !appId || !appSecret) {
      if (!options.forceCreateApp) {
        const existingApp = (await listRealtimeApps(auth.accountId, apiToken))
          .find((candidate) => candidate.name === appName);
        if (existingApp && (!appId || !appSecret)) {
          throw new Error(
            `Realtime app '${appName}' already exists in Cloudflare, but its secret is not stored locally. ` +
            'Cloudflare does not return existing app secrets again. Use --force-create-app to mint a new app or restore CF_REALTIME_APP_SECRET locally.',
          );
        }
      }

      const createdApp = await createRealtimeApp(auth.accountId, apiToken, appName);
      if (!createdApp.uid || !createdApp.secret) {
        throw new Error('Cloudflare returned an incomplete Realtime app response.');
      }
      appId = createdApp.uid;
      appSecret = createdApp.secret;
      appSource = 'created';
    }

    let turnKeyId = existingSecrets.CF_REALTIME_TURN_KEY_ID;
    let turnApiToken = existingSecrets.CF_REALTIME_TURN_API_TOKEN;
    let turnSource: 'local' | 'created' = turnKeyId && turnApiToken ? 'local' : 'created';

    if (options.forceCreateTurn || !turnKeyId || !turnApiToken) {
      if (!options.forceCreateTurn) {
        const existingTurnKey = (await listTurnKeys(auth.accountId, apiToken))
          .find((candidate) => candidate.name === turnName);
        if (existingTurnKey && (!turnKeyId || !turnApiToken)) {
          throw new Error(
            `TURN key '${turnName}' already exists in Cloudflare, but its API token is not stored locally. ` +
            'Cloudflare does not return existing TURN key tokens again. Use --force-create-turn to mint a new TURN key or restore CF_REALTIME_TURN_API_TOKEN locally.',
          );
        }
      }

      const createdTurnKey = await createTurnKey(auth.accountId, apiToken, turnName);
      if (!createdTurnKey.uid || !createdTurnKey.key) {
        throw new Error('Cloudflare returned an incomplete TURN key response.');
      }
      turnKeyId = createdTurnKey.uid;
      turnApiToken = createdTurnKey.key;
      turnSource = 'created';
    }

    const secrets = {
      CF_REALTIME_APP_ID: appId!,
      CF_REALTIME_APP_SECRET: appSecret!,
      CF_REALTIME_TURN_KEY_ID: turnKeyId!,
      CF_REALTIME_TURN_API_TOKEN: turnApiToken!,
    } satisfies Record<RealtimeSecretName, string>;

    writeLocalSecrets(options.projectDir, secrets);

    if (options.syncWorkersSecrets !== false) {
      try {
        syncWorkersSecrets(options.projectDir, secrets);
      } catch (err) {
        const warning =
          `Realtime secrets were written locally, but syncing Workers secrets failed: ${
            err instanceof Error ? err.message : String(err)
          }`;
        if (!isQuiet()) {
          console.log(chalk.yellow('⚠'), warning);
          console.log(
            chalk.dim('  You can retry with `npx edgebase realtime provision` or set the secrets manually.'),
          );
        }

        return {
          appId: secrets.CF_REALTIME_APP_ID,
          appSecret: secrets.CF_REALTIME_APP_SECRET,
          appName,
          appSource,
          turnKeyId: secrets.CF_REALTIME_TURN_KEY_ID,
          turnApiToken: secrets.CF_REALTIME_TURN_API_TOKEN,
          turnName,
          turnSource,
          warnings: [
            warning,
            'You can retry with `npx edgebase realtime provision` or set the secrets manually.',
          ],
        };
      }
    }

    return {
      appId: secrets.CF_REALTIME_APP_ID,
      appSecret: secrets.CF_REALTIME_APP_SECRET,
      appName,
      appSource,
      turnKeyId: secrets.CF_REALTIME_TURN_KEY_ID,
      turnApiToken: secrets.CF_REALTIME_TURN_API_TOKEN,
      turnName,
      turnSource,
    };
  } catch (error) {
    throw toProvisionAuthError(error, apiTokenSource);
  }
}
