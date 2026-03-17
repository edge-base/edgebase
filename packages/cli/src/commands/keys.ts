import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import { wranglerArgs, wranglerCommand } from '../lib/wrangler.js';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { raiseCliError } from '../lib/agent-contract.js';
import { isJson, isQuiet } from '../lib/cli-context.js';
import { listWranglerSecretNames } from '../lib/wrangler-secrets.js';

/**
 * `npx edgebase keys` — Manage Service Keys.
 *
 * - `keys list`   — Show current Service Key (masked)
 * - `keys rotate` — Rotate the root Service Key secret immediately
 */

/** Generate a cryptographically secure 64-character hex key */
export function generateServiceKey(): string {
  return randomBytes(32).toString('hex');
}

/** Mask a key for display: show prefix + last 4 chars */
export function maskKey(key: string): string {
  if (key.length <= 8) return '****';
  return `sk_${'*'.repeat(12)}${key.slice(-4)}`;
}

function extractCommandFailure(error: unknown): string {
  if (!(error instanceof Error)) return 'Command failed for an unknown reason.';
  const execError = error as Error & { stderr?: string | Buffer; stdout?: string | Buffer };
  if (typeof execError.stderr === 'string' && execError.stderr.trim()) return execError.stderr.trim();
  if (Buffer.isBuffer(execError.stderr) && execError.stderr.length > 0) {
    return execError.stderr.toString('utf-8').trim();
  }
  if (typeof execError.stdout === 'string' && execError.stdout.trim()) return execError.stdout.trim();
  if (Buffer.isBuffer(execError.stdout) && execError.stdout.length > 0) {
    return execError.stdout.toString('utf-8').trim();
  }
  return error.message;
}

/** Run wrangler secret put and pipe value via stdin. Throws on failure. */
function wranglerSecretPut(name: string, value: string): void {
  execFileSync(wranglerCommand(), wranglerArgs(['wrangler', 'secret', 'put', name]), {
    input: value,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/** Read .edgebase/secrets.json or return null */
function readSecretsJson(projectDir: string): Record<string, string> | null {
  const secretsPath = join(projectDir, '.edgebase', 'secrets.json');
  try {
    const raw = readFileSync(secretsPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Write .edgebase/secrets.json (creates directory if needed, chmod 0o600) */
function writeSecretsJson(projectDir: string, data: Record<string, string>): void {
  const edgebaseDir = join(projectDir, '.edgebase');
  if (!existsSync(edgebaseDir)) {
    mkdirSync(edgebaseDir, { recursive: true });
  }
  const secretsPath = join(edgebaseDir, 'secrets.json');
  writeFileSync(secretsPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  chmodSync(secretsPath, 0o600);
}

/** Exported for testing */
export const _internals = { readSecretsJson, writeSecretsJson };

export const keysCommand = new Command('keys')
  .description('Manage Service Keys');

keysCommand
  .command('list')
  .description('List Service Key (masked)')
  .action(async () => {
    const projectDir = process.cwd();

    // Try to read from .edgebase/secrets.json for local info
    const secrets = readSecretsJson(projectDir);
    if (secrets?.SERVICE_KEY) {
      const createdAt = secrets.SERVICE_KEY_CREATED_AT;
      const updatedAt = secrets.SERVICE_KEY_UPDATED_AT;

      if (isJson()) {
        console.log(JSON.stringify({
          status: 'success',
          serviceKey: {
            configured: true,
            source: 'local',
            masked: maskKey(secrets.SERVICE_KEY),
            ...(createdAt ? { createdAt } : {}),
            ...(updatedAt ? { updatedAt } : {}),
          },
        }));
        return;
      }

      console.log(chalk.blue('🔑 Service Key:'));
      console.log();
      console.log(chalk.green('  ✓ SERVICE_KEY:'), maskKey(secrets.SERVICE_KEY));

      if (createdAt) {
        const createdDate = new Date(createdAt);
        if (!isNaN(createdDate.getTime())) {
          console.log(chalk.dim(`    Created: ${createdDate.toISOString().slice(0, 10)}`));
        }
      }

      if (updatedAt) {
        const updatedDate = new Date(updatedAt);
        if (!isNaN(updatedDate.getTime())) {
          console.log(chalk.dim(`    Updated: ${updatedDate.toISOString().slice(0, 10)}`));
        }
      }
      return;
    }

    try {
      const secretNames = listWranglerSecretNames(projectDir);
      const configured = secretNames.has('SERVICE_KEY');

      if (isJson()) {
        console.log(JSON.stringify({
          status: 'success',
          serviceKey: {
            configured,
            source: 'cloudflare',
          },
        }));
        return;
      }

      console.log(chalk.blue('🔑 Service Key:'));
      console.log();
      console.log(chalk.dim('  .edgebase/secrets.json not found — checking via Wrangler...'));
      console.log();
      if (configured) {
        console.log(chalk.green('  ✓ SERVICE_KEY is configured (Cloudflare).'));
      } else {
        console.log(chalk.yellow('  ⚠ SERVICE_KEY not found.'));
        console.log(
          chalk.dim('    Run `npx edgebase deploy` to auto-generate or `npx edgebase keys rotate` to create.'),
        );
      }
    } catch (error) {
      raiseCliError({
        code: 'service_key_lookup_failed',
        message: extractCommandFailure(error),
        hint: 'Check your Wrangler login and project configuration, then retry.',
      });
    }
  });

keysCommand
  .command('rotate')
  .description('Rotate Service Key immediately')
  .action(async () => {
    const projectDir = process.cwd();
    const newKey = generateServiceKey();
    const rotatedAt = new Date().toISOString();

    if (!isQuiet()) {
      console.log(chalk.blue('🔄 Rotating Service Key...'));
      console.log();
    }

    // Step 1: Read current key from .edgebase/secrets.json
    const secrets = readSecretsJson(projectDir);
    const warnings: string[] = [];
    if (!secrets?.SERVICE_KEY && !isQuiet()) {
      console.log(chalk.yellow('  ⚠ .edgebase/secrets.json not found or no current key.'));
      console.log(chalk.yellow('    Proceeding with immediate replacement.'));
      console.log();
    }

    if (!isQuiet()) {
      console.log(chalk.dim('  Step 2/2: Setting new SERVICE_KEY...'));
    }
    try {
      wranglerSecretPut('SERVICE_KEY', newKey);
    } catch (error) {
      raiseCliError({
        code: 'service_key_rotation_failed',
        message: extractCommandFailure(error),
        hint: 'Check your Wrangler login and ensure the target Worker is available before retrying.',
      });
    }

    // Step 2: Update .edgebase/secrets.json
    if (!isQuiet()) {
      console.log(chalk.dim('  Updating .edgebase/secrets.json...'));
    }
    try {
      const updated: Record<string, string> = { ...secrets };
      updated.SERVICE_KEY = newKey;
      if (!updated.SERVICE_KEY_CREATED_AT) {
        updated.SERVICE_KEY_CREATED_AT = rotatedAt;
      }
      updated.SERVICE_KEY_UPDATED_AT = rotatedAt;
      writeSecretsJson(projectDir, updated);
      if (!isQuiet()) {
        console.log(chalk.dim('  Saved to .edgebase/secrets.json'));
      }
    } catch (err) {
      warnings.push(`Failed to update secrets.json: ${(err as Error).message}`);
      if (!isQuiet()) {
        console.log(chalk.yellow(`  ⚠ Failed to update secrets.json: ${(err as Error).message}`));
        console.log(chalk.yellow('    Key was rotated on Cloudflare but local secrets.json not updated.'));
      }
    }

    if (isJson()) {
      console.log(JSON.stringify({
        status: 'success',
        serviceKey: {
          masked: maskKey(newKey),
          value: newKey,
          rotatedAt,
          localSecretsUpdated: warnings.length === 0,
        },
        warnings,
      }));
      return;
    }

    console.log();
    console.log(chalk.green('✅ Service Key rotated.'));
    console.log(chalk.dim('  New key:'), maskKey(newKey));
    console.log(chalk.dim('  Full key (save securely):'), newKey);
  });

keysCommand
  .command('rotate-jwt')
  .description('Rotate JWT signing secrets with 28d grace period')
  .action(async () => {
    const projectDir = process.cwd();
    const rotatedAt = new Date().toISOString();

    if (!isQuiet()) {
      console.log(chalk.blue('🔑 Rotating JWT signing secrets (user + admin)...'));
      console.log();
    }

    const secrets = readSecretsJson(projectDir) || {};
    const warnings: string[] = [];

    // ─── User JWT ───
    const currentUserSecret = secrets.JWT_USER_SECRET;
    const newUserSecret = randomBytes(32).toString('hex');

    if (!isQuiet()) {
      console.log(chalk.dim('  [User JWT] Saving current secret as JWT_USER_SECRET_OLD...'));
    }
    if (currentUserSecret) {
      try {
        wranglerSecretPut('JWT_USER_SECRET_OLD', currentUserSecret);
        wranglerSecretPut('JWT_USER_SECRET_OLD_AT', rotatedAt);
      } catch (error) {
        raiseCliError({
          code: 'jwt_user_secret_rotation_failed',
          message: extractCommandFailure(error),
          hint: 'Check your Wrangler login and ensure the target Worker is available before retrying.',
        });
      }
    } else if (!isQuiet()) {
      console.log(chalk.yellow('  ⚠ No existing JWT_USER_SECRET — immediate replacement.'));
    }
    if (!isQuiet()) {
      console.log(chalk.dim('  [User JWT] Setting new JWT_USER_SECRET...'));
    }
    try {
      wranglerSecretPut('JWT_USER_SECRET', newUserSecret);
    } catch (error) {
      raiseCliError({
        code: 'jwt_user_secret_rotation_failed',
        message: extractCommandFailure(error),
        hint: 'Check your Wrangler login and ensure the target Worker is available before retrying.',
      });
    }

    // ─── Admin JWT ───
    const currentAdminSecret = secrets.JWT_ADMIN_SECRET;
    const newAdminSecret = randomBytes(32).toString('hex');

    if (!isQuiet()) {
      console.log(chalk.dim('  [Admin JWT] Saving current secret as JWT_ADMIN_SECRET_OLD...'));
    }
    if (currentAdminSecret) {
      try {
        wranglerSecretPut('JWT_ADMIN_SECRET_OLD', currentAdminSecret);
        wranglerSecretPut('JWT_ADMIN_SECRET_OLD_AT', rotatedAt);
      } catch (error) {
        raiseCliError({
          code: 'jwt_admin_secret_rotation_failed',
          message: extractCommandFailure(error),
          hint: 'Check your Wrangler login and ensure the target Worker is available before retrying.',
        });
      }
    }
    if (!isQuiet()) {
      console.log(chalk.dim('  [Admin JWT] Setting new JWT_ADMIN_SECRET...'));
    }
    try {
      wranglerSecretPut('JWT_ADMIN_SECRET', newAdminSecret);
    } catch (error) {
      raiseCliError({
        code: 'jwt_admin_secret_rotation_failed',
        message: extractCommandFailure(error),
        hint: 'Check your Wrangler login and ensure the target Worker is available before retrying.',
      });
    }

    // ─── Update secrets.json ───
    if (!isQuiet()) {
      console.log(chalk.dim('  Updating .edgebase/secrets.json...'));
    }
    try {
      const updated: Record<string, string> = { ...secrets };
      updated.JWT_USER_SECRET = newUserSecret;
      if (currentUserSecret) {
        updated.JWT_USER_SECRET_OLD = currentUserSecret;
        updated.JWT_USER_SECRET_OLD_AT = rotatedAt;
      }
      updated.JWT_ADMIN_SECRET = newAdminSecret;
      if (currentAdminSecret) {
        updated.JWT_ADMIN_SECRET_OLD = currentAdminSecret;
        updated.JWT_ADMIN_SECRET_OLD_AT = rotatedAt;
      }
      writeSecretsJson(projectDir, updated);
      if (!isQuiet()) {
        console.log(chalk.dim('  Saved to .edgebase/secrets.json'));
      }
    } catch (err) {
      warnings.push(`Failed to update secrets.json: ${(err as Error).message}`);
      if (!isQuiet()) {
        console.log(chalk.yellow(`  ⚠ Failed to update secrets.json: ${(err as Error).message}`));
      }
    }

    if (isJson()) {
      console.log(JSON.stringify({
        status: 'success',
        jwtSecrets: {
          rotatedAt,
          gracePeriodDays: 28,
          redeployRequired: true,
          localSecretsUpdated: warnings.length === 0,
        },
        warnings,
      }));
      return;
    }

    console.log();
    console.log(chalk.green('✅ JWT secrets rotated with 28d grace period.'));
    console.log(chalk.dim('  Previous secrets remain valid for 28 days (Refresh Token TTL).'));
    console.log(chalk.dim('  Access Tokens (15m TTL) expire naturally — no grace period needed.'));
    console.log(chalk.yellow('  ⚠ Redeploy required: npx edgebase deploy'));
  });
