import { execFileSync } from 'node:child_process';
import { wranglerArgs, wranglerCommand } from './wrangler.js';

type WranglerSecretListRunner = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    encoding: 'utf-8';
    stdio: ['ignore', 'pipe', 'ignore'];
    timeout: number;
  },
) => string;

interface WranglerSecretListEntry {
  name?: unknown;
}

export const RESERVED_HOSTED_WORKER_SECRET_NAMES = [
  'EDGEBASE_CONFIG',
  'EDGEBASE_TEST',
  'EDGEBASE_TEST_BUILD',
  'EDGEBASE_LOCAL_DEV_BUILD',
  'EDGEBASE_DEV_SIDECAR_PORT',
  'EDGEBASE_INTERNAL_WORKER_URL',
  'EDGEBASE_EMAIL_API_URL',
  'EDGEBASE_SMS_API_URL',
  'EDGEBASE_APP_WEB_VERIFY_EMAIL_URL',
  'EDGEBASE_APP_WEB_RESET_PASSWORD_URL',
  'EDGEBASE_APP_WEB_MAGIC_LINK_URL',
  'EDGEBASE_APP_WEB_CHANGE_EMAIL_URL',
  'EDGEBASE_USE_TEST_CONFIG',
  'VITEST',
  'VITEST_WORKER_ID',
  'VITEST_POOL_ID',
  'NODE_ENV',
  'EDGEBASE_RUNTIME_MODE',
] as const;

export const DEPLOY_CONTROL_WORKER_SECRET_NAMES = [
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'EDGEBASE_SELF_DESTRUCT_CF_TOKEN',
  'EDGEBASE_STORE_CF_TOKEN',
  'NEON_API_KEY',
  'NPM_TOKEN',
  'NODE_AUTH_TOKEN',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'CF_API_TOKEN',
  'CF_ACCOUNT_ID',
] as const;

export function isReservedHostedWorkerSecretName(name: string): boolean {
  return (RESERVED_HOSTED_WORKER_SECRET_NAMES as readonly string[]).includes(name);
}

export function isDeployControlWorkerSecretName(name: string): boolean {
  return (DEPLOY_CONTROL_WORKER_SECRET_NAMES as readonly string[]).includes(name);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseWranglerSecretNames(output: string): Set<string> {
  const parsed = JSON.parse(output) as unknown;
  const entries = Array.isArray(parsed)
    ? parsed
    : isObject(parsed) && Array.isArray(parsed.result)
      ? parsed.result
      : null;

  if (!entries) {
    throw new Error('Unexpected Wrangler secret list format.');
  }

  const names = new Set<string>();
  for (const entry of entries as WranglerSecretListEntry[]) {
    if (typeof entry?.name === 'string') {
      names.add(entry.name);
    }
  }

  return names;
}

export function listWranglerSecretNames(
  projectDir: string,
  runner?: WranglerSecretListRunner,
): Set<string> {
  const run = runner ?? ((command, args, options) => execFileSync(command, args, options));
  const output = run(
    wranglerCommand(),
    wranglerArgs(['wrangler', 'secret', 'list', '--format', 'json']),
    {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 30_000,
    },
  );

  return parseWranglerSecretNames(output);
}
