import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import chalk from 'chalk';
import { raiseCliError, raiseNeedsUserAction } from './agent-contract.js';
import { isJson, isNonInteractive } from './cli-context.js';
import { buildDefaultWranglerToml, deriveProjectSlug } from './runtime-scaffold.js';
import { wranglerArgs, wranglerCommand, wranglerHint } from './wrangler.js';

// ─── Types ───

export interface CloudflareAuth {
  accountId: string;
  accountName: string;
  authMethod: 'oauth' | 'api_token';
}

export interface CloudflareAccount {
  name: string;
  id: string;
}

// ─── Public API ───

/**
 * Full Auth Gate: check auth → login if needed → extract account_id.
 * Returns CloudflareAuth or exits the process on failure.
 *
 * Resolution order for account_id:
 *   1. CLOUDFLARE_ACCOUNT_ID env var
 *   2. .edgebase/cloudflare.json cache
 *   3. wrangler.toml account_id field
 *   4. wrangler whoami output
 */
export async function ensureCloudflareAuth(
  projectDir: string,
  isTTY: boolean,
): Promise<CloudflareAuth> {
  console.log(chalk.blue('☁️  Checking Cloudflare authentication...'));

  // 1. Check existing auth
  let auth = checkWranglerAuth(projectDir);

  if (auth) {
    console.log(
      chalk.green('✓'),
      `Authenticated as ${chalk.cyan(auth.accountName)} (${auth.accountId.slice(0, 8)}...)`,
    );
    return auth;
  }

  // 2. Not authenticated
  if (!isTTY || isNonInteractive() || isJson()) {
    raiseNeedsUserAction({
      code: 'cloudflare_login_required',
      message: 'Cloudflare authentication is required before this command can continue.',
      hint: 'Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID for automation, or complete a one-time wrangler login.',
      action: {
        type: 'open_browser',
        title: 'Cloudflare Login',
        message: 'This step opens the Cloudflare OAuth flow in a browser and requires the user to finish sign-in.',
        command: wranglerHint(['wrangler', 'login']),
        instructions: [
          'Run the login command in an interactive terminal, or provide CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID.',
          'After authentication succeeds, rerun the original EdgeBase command.',
        ],
      },
    });
  }

  // 3. Interactive: auto-trigger login
  console.log(chalk.yellow('⚠'), 'Not authenticated with Cloudflare.');
  console.log();
  const success = triggerWranglerLogin(projectDir);

  if (!success) {
    raiseCliError({
      code: 'cloudflare_login_failed',
      message: 'Cloudflare login failed.',
      hint: `Try running \`${wranglerHint(['wrangler', 'login'])}\` manually in an interactive terminal, then rerun the EdgeBase command.`,
    });
  }

  // 4. Re-check auth after login
  auth = checkWranglerAuth(projectDir);
  if (!auth) {
    raiseCliError({
      code: 'cloudflare_account_resolution_failed',
      message: 'Authentication completed but account info could not be resolved.',
      hint: `Run \`${wranglerHint(['wrangler', 'whoami'])}\` to verify the active account, then retry.`,
    });
  }

  console.log(
    chalk.green('✓'),
    `Authenticated as ${chalk.cyan(auth.accountName)} (${auth.accountId.slice(0, 8)}...)`,
  );

  // 5. Cache for future runs
  saveCachedAccountId(projectDir, auth.accountId, auth.accountName);

  return auth;
}

/**
 * Check if user is authenticated via `wrangler whoami`.
 * Returns parsed account info or null if not authenticated.
 *
 * Checks in order:
 *   1. CLOUDFLARE_ACCOUNT_ID env (+ verify via whoami if possible)
 *   2. Cached .edgebase/cloudflare.json
 *   3. wrangler.toml account_id
 *   4. wrangler whoami output
 */
export function checkWranglerAuth(projectDir: string): CloudflareAuth | null {
  // Quick path: env var provides account_id
  const envAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const envApiToken = process.env.CLOUDFLARE_API_TOKEN;

  if (envApiToken && envAccountId) {
    return {
      accountId: envAccountId,
      accountName: 'ENV',
      authMethod: 'api_token',
    };
  }

  // Try wrangler whoami to check actual auth status
  let whoamiOutput: string;
  try {
    whoamiOutput = execFileSync(wranglerCommand(), wranglerArgs(['wrangler', 'whoami']), {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
    });
  } catch {
    return null;
  }

  // Check for unauthenticated indicators
  if (
    whoamiOutput.includes('not authenticated') ||
    whoamiOutput.includes('No OAuth token') ||
    whoamiOutput.includes('no auth')
  ) {
    return null;
  }

  // Parse accounts from whoami output
  const accounts = parseWhoamiOutput(whoamiOutput);
  if (accounts.length === 0) return null;

  // Determine account_id (priority: env > cache > toml > whoami)
  let accountId = envAccountId ?? null;
  let accountName = accounts[0].name;

  if (!accountId) {
    // Check cache
    const cached = loadCachedAccountId(projectDir);
    if (cached) {
      // Verify cached id is still in the accounts list
      const match = accounts.find(a => a.id === cached);
      if (match) {
        accountId = match.id;
        accountName = match.name;
      }
    }
  }

  if (!accountId) {
    // Check wrangler.toml
    const tomlId = extractAccountIdFromToml(projectDir);
    if (tomlId) {
      const match = accounts.find(a => a.id === tomlId);
      if (match) {
        accountId = match.id;
        accountName = match.name;
      }
    }
  }

  if (!accountId) {
    // Use first account from whoami
    accountId = accounts[0].id;
    accountName = accounts[0].name;
  }

  return {
    accountId,
    accountName,
    authMethod: envApiToken ? 'api_token' : 'oauth',
  };
}

/**
 * Parse `wrangler whoami` table output to extract account names and IDs.
 *
 * Wrangler outputs a pipe-delimited table like:
 * ┌──────────────────┬──────────────────────────────────┐
 * │ Account Name     │ Account ID                       │
 * ├──────────────────┼──────────────────────────────────┤
 * │ John's Account   │ abcdef1234567890abcdef1234567890 │
 * └──────────────────┴──────────────────────────────────┘
 */
export function parseWhoamiOutput(output: string): CloudflareAccount[] {
  const accounts: CloudflareAccount[] = [];
  const lines = output.split('\n');

  for (const line of lines) {
    // Match 32-char hex strings (Cloudflare account IDs)
    const idMatch = line.match(/([0-9a-f]{32})/);
    if (!idMatch) continue;

    // Extract account name from the same row (pipe-delimited)
    const parts = line.split('│').map(s => s.trim()).filter(Boolean);
    const name = parts.length >= 2 ? parts[0] : 'Unknown';

    accounts.push({ name, id: idMatch[1] });
  }

  return accounts;
}

/**
 * Trigger `wrangler login` (browser OAuth flow).
 * Only works in interactive terminals. Blocks until complete.
 */
export function triggerWranglerLogin(projectDir: string, scopes?: string[]): boolean {
  console.log(chalk.blue('🔐 Opening Cloudflare login in browser...'));
  console.log(chalk.dim('  This opens Cloudflare OAuth in your browser and requires the user to finish sign-in.'));
  console.log(chalk.dim('  Return to the terminal after the browser flow completes.'));
  console.log();

  try {
    const args = ['wrangler', 'login'];
    if (scopes && scopes.length > 0) {
      args.push('--scopes', ...scopes);
    }
    execFileSync(wranglerCommand(), wranglerArgs(args), {
      cwd: projectDir,
      stdio: 'inherit',
      timeout: 120000, // 2 minute timeout for browser auth
    });
    console.log();
    return true;
  } catch {
    return false;
  }
}

/**
 * Default OAuth scopes requested by wrangler login.
 */
export const WRANGLER_DEFAULT_SCOPES = [
  'account:read',
  'user:read',
  'workers:write',
  'workers_kv:write',
  'workers_routes:write',
  'workers_scripts:write',
  'workers_tail:read',
  'd1:write',
  'pages:write',
  'zone:read',
  'ssl_certs:write',
  'ai:write',
  'queues:write',
];

/**
 * Re-login with additional scopes for Cloudflare Calls/Realtime provisioning.
 * `connectivity:admin` grants access to Calls App and TURN key management.
 */
export function triggerWranglerLoginWithCallsScope(projectDir: string): boolean {
  console.log(chalk.yellow('⚠'), 'Current OAuth token lacks Cloudflare Calls permissions.');
  console.log(chalk.blue('🔄 Re-authenticating with Calls/Realtime scope...'));
  console.log();

  return triggerWranglerLogin(projectDir, [
    ...WRANGLER_DEFAULT_SCOPES,
    'connectivity:admin',
  ]);
}

/**
 * Ensure wrangler.toml exists at project root with account_id.
 * - If exists: inject/update account_id
 * - If missing: create minimal template
 *
 * Returns the path to wrangler.toml.
 */
export function ensureWranglerToml(projectDir: string, accountId: string): string {
  const wranglerPath = join(projectDir, 'wrangler.toml');

  if (existsSync(wranglerPath)) {
    let content = readFileSync(wranglerPath, 'utf-8');

    if (/^account_id\s*=/m.test(content)) {
      // Update existing account_id
      content = content.replace(
        /^account_id\s*=\s*"[^"]*"/m,
        `account_id = "${accountId}"`,
      );
    } else {
      // Insert account_id after the name line (or at the top)
      const nameMatch = content.match(/^name\s*=\s*"[^"]*"\n/m);
      if (nameMatch && nameMatch.index !== undefined) {
        const insertPos = nameMatch.index + nameMatch[0].length;
        content =
          content.slice(0, insertPos) +
          `account_id = "${accountId}"\n` +
          content.slice(insertPos);
      } else {
        content = `account_id = "${accountId}"\n` + content;
      }
    }

    writeFileSync(wranglerPath, content, 'utf-8');
    console.log(chalk.green('✓'), 'wrangler.toml updated with account_id');
    return wranglerPath;
  }

  // No wrangler.toml — create minimal template
  const template = buildDefaultWranglerToml(accountId, deriveProjectSlug(projectDir))
    .replace('id = "local"', 'id = "placeholder"')
    .replace('database_id = "local"', 'database_id = "placeholder"');

  writeFileSync(wranglerPath, template, 'utf-8');
  console.log(chalk.green('✓'), 'wrangler.toml created with account_id');
  return wranglerPath;
}

/**
 * Load cached account_id from .edgebase/cloudflare.json.
 */
export function loadCachedAccountId(projectDir: string): string | null {
  const cachePath = join(projectDir, '.edgebase', 'cloudflare.json');
  if (!existsSync(cachePath)) return null;

  try {
    const data = JSON.parse(readFileSync(cachePath, 'utf-8'));
    return data.accountId ?? null;
  } catch {
    return null;
  }
}

/**
 * Save account_id to .edgebase/cloudflare.json.
 */
export function saveCachedAccountId(
  projectDir: string,
  accountId: string,
  accountName: string,
): void {
  const edgebaseDir = join(projectDir, '.edgebase');
  const cachePath = join(edgebaseDir, 'cloudflare.json');

  if (!existsSync(edgebaseDir)) {
    mkdirSync(edgebaseDir, { recursive: true });
  }

  writeFileSync(
    cachePath,
    JSON.stringify({ accountId, accountName, updatedAt: new Date().toISOString() }, null, 2),
    'utf-8',
  );
  chmodSync(cachePath, 0o600);
}

// ─── API Token Resolution ───

/**
 * Locate the wrangler config directory (varies by platform).
 */
function getWranglerConfigDir(): string {
  const legacyDir = join(homedir(), '.wrangler');
  if (existsSync(legacyDir)) return legacyDir;

  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Preferences', '.wrangler');
  }

  return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), '.wrangler');
}

/**
 * Read the OAuth token from wrangler's local config file.
 */
export function readWranglerOauthToken(): string | null {
  const environment = process.env.CLOUDFLARE_API_ENVIRONMENT === 'staging'
    ? 'staging'
    : 'default';
  const authConfigPath = join(getWranglerConfigDir(), 'config', `${environment}.toml`);
  if (!existsSync(authConfigPath)) return null;

  const raw = readFileSync(authConfigPath, 'utf-8');
  const oauthMatch = raw.match(/^oauth_token\s*=\s*"([^"]+)"/m);
  return oauthMatch?.[1] ?? null;
}

/**
 * Resolve a Cloudflare API token from env var or wrangler OAuth login.
 * Used by deploy (to store as Worker secret) and realtime provisioning.
 */
export function resolveApiToken(): { token: string; source: 'env' | 'wrangler_oauth' } {
  if (process.env.CLOUDFLARE_API_TOKEN) {
    return { token: process.env.CLOUDFLARE_API_TOKEN, source: 'env' };
  }

  const wranglerOauthToken = readWranglerOauthToken();
  if (wranglerOauthToken) {
    return { token: wranglerOauthToken, source: 'wrangler_oauth' };
  }

  throw new Error(
    'Could not resolve a Cloudflare API token. Set CLOUDFLARE_API_TOKEN or complete a wrangler login.',
  );
}

// ─── Internal Helpers ───

/**
 * Extract account_id from wrangler.toml.
 */
function extractAccountIdFromToml(projectDir: string): string | null {
  const wranglerPath = join(projectDir, 'wrangler.toml');
  if (!existsSync(wranglerPath)) return null;

  const content = readFileSync(wranglerPath, 'utf-8');
  const match = content.match(/^account_id\s*=\s*"([^"]+)"/m);
  return match?.[1] ?? null;
}
