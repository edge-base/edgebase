/**
 * CLI: `npx edgebase admin` — Admin management commands
 *
 * Subcommands:
 *   reset-password — Reset admin password via Service Key or Cloudflare D1 direct access
 */
import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import chalk from 'chalk';
import { fetchWithTimeout } from '../lib/fetch-with-timeout.js';
import { resolveOptionalServiceKey, resolveServerUrl } from '../lib/resolve-options.js';
import {
  isCliStructuredError,
  raiseCliError,
  raiseNeedsInput,
} from '../lib/agent-contract.js';
import { ensureCloudflareAuth } from '../lib/cf-auth.js';
import { isJson, isQuiet } from '../lib/cli-context.js';
import {
  readProjectWranglerContext,
  resolveManagedD1DatabaseName,
} from '../lib/project-runtime.js';
import { wranglerCommand, wranglerArgs } from '../lib/wrangler.js';
import {
  ensureBootstrapAdmin,
  normalizeAdminEmail,
  promptValue,
} from '../lib/admin-bootstrap.js';

const HASH_ITERATIONS = 100_000;
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;

function toBase64(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString('base64');
}

async function hashPassword(password: string): Promise<string> {
  const salt = webcrypto.getRandomValues(new Uint8Array(SALT_LENGTH));

  const keyMaterial = await webcrypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const hash = await webcrypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: HASH_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_LENGTH * 8,
  );

  return `pbkdf2:sha256:${HASH_ITERATIONS}:${toBase64(salt.buffer)}:${toBase64(hash)}`;
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

export function toSqliteStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

interface ResetPasswordResult {
  mode: 'service_key' | 'd1_direct';
  email: string;
  url?: string;
  local?: boolean;
  dbName?: string;
  sessionsRevoked: boolean;
}

async function resetViaD1Direct(
  projectDir: string,
  email: string,
  newPassword: string,
  local: boolean,
): Promise<ResetPasswordResult> {
  if (!local) {
    const isTTY = Boolean(process.stdout.isTTY);
    await ensureCloudflareAuth(projectDir, isTTY);
  }

  const dbName = resolveManagedD1DatabaseName(projectDir, 'AUTH_DB');
  if (!dbName) {
    raiseCliError({
      code: 'auth_db_not_found',
      message: 'Could not resolve AUTH_DB for this EdgeBase project.',
      hint: 'Check your edgebase.config.ts and wrangler.toml, then retry.',
    });
  }

  const configDir = readProjectWranglerContext(projectDir).dir;
  const localFlag = local ? ['--local'] : [];

  if (!isQuiet()) {
    console.log('🔄 Hashing password...');
  }
  const passwordHash = await hashPassword(newPassword);
  const now = new Date().toISOString();

  if (!isQuiet()) {
    console.log('🔍 Checking admin account...');
  }
  const normalizedEmail = email.trim().toLowerCase();

  try {
    const checkOutput = execFileSync(
      wranglerCommand(),
      wranglerArgs([
        'wrangler', 'd1', 'execute', dbName,
        ...localFlag,
        '--command', `SELECT id, email FROM _admins WHERE LOWER(TRIM(email)) = ${toSqliteStringLiteral(normalizedEmail)}`,
        '--json',
      ]),
      {
        cwd: configDir,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30000,
      },
    );

    const results = JSON.parse(checkOutput);
    const rows = results?.[0]?.results ?? [];

    if (rows.length === 0) {
      raiseCliError({
        code: 'admin_not_found',
        message: `No admin found with email: ${email}`,
        field: 'email',
        hint: 'Check the admin email address and retry.',
      });
    }

    const adminId = rows[0].id;

    if (!isQuiet()) {
      console.log('🔄 Resetting password...');
    }
    execFileSync(
      wranglerCommand(),
      wranglerArgs([
        'wrangler', 'd1', 'execute', dbName,
        ...localFlag,
        '--command', `UPDATE _admins SET passwordHash = ${toSqliteStringLiteral(passwordHash)}, updatedAt = ${toSqliteStringLiteral(now)} WHERE id = ${toSqliteStringLiteral(adminId)}`,
      ]),
      {
        cwd: configDir,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30000,
      },
    );

    execFileSync(
      wranglerCommand(),
      wranglerArgs([
        'wrangler', 'd1', 'execute', dbName,
        ...localFlag,
        '--command', `DELETE FROM _admin_sessions WHERE adminId = ${toSqliteStringLiteral(adminId)}`,
      ]),
      {
        cwd: configDir,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30000,
      },
    );

    return {
      mode: 'd1_direct',
      email,
      local,
      dbName,
      sessionsRevoked: true,
    };
  } catch (error) {
    if (isCliStructuredError(error)) throw error;

    const message = extractCommandFailure(error);
    if (message.includes('no such table')) {
      raiseCliError({
        code: 'auth_db_not_initialized',
        message: 'Auth database not initialized. Deploy your project first.',
      });
    }

    raiseCliError({
      code: 'admin_password_reset_failed',
      message: `D1 operation failed: ${message}`,
      hint: 'Check your Wrangler login, D1 permissions, and project configuration, then retry.',
    });
  }
}

export const adminCommand = new Command('admin')
  .description('Admin management commands');

adminCommand
  .command('bootstrap')
  .description('Create the first admin account using a Service Key')
  .option('--url <url>', 'Worker URL (default: EDGEBASE_URL or http://localhost:8787)')
  .option('--service-key <key>', 'Service Key (or set EDGEBASE_SERVICE_KEY env)')
  .option('--email <email>', 'Bootstrap admin email')
  .option('--password-file <path>', 'Read bootstrap admin password from a file')
  .option('--password-stdin', 'Read bootstrap admin password from stdin')
  .action(async (options: {
    url?: string;
    serviceKey?: string;
    email?: string;
    passwordFile?: string;
    passwordStdin?: boolean;
  }) => {
    const serviceKey = resolveOptionalServiceKey(options);
    if (!serviceKey) {
      raiseNeedsInput({
        code: 'service_key_required',
        field: 'serviceKey',
        message: 'Service Key required for bootstrap admin creation.',
        hint: 'Provide --service-key <key>, set EDGEBASE_SERVICE_KEY, or deploy once so .edgebase/secrets.json is populated.',
      });
    }

    const url = resolveServerUrl({ url: options.url }, false) || 'http://localhost:8787';
    const email = options.email
      ? normalizeAdminEmail(options.email)
      : await promptValue('Bootstrap admin email: ', false, {
        field: 'bootstrapAdminEmail',
        hint: 'Rerun with --email <email>.',
        message: 'A bootstrap admin email is required before setup can continue.',
      });

    if (!isQuiet()) {
      console.log('\n🔄 Checking admin bootstrap status...');
    }

    const result = await ensureBootstrapAdmin({
      url,
      serviceKey,
      email,
      passwordFile: options.passwordFile,
      passwordStdin: options.passwordStdin,
      emailPromptHint: 'Rerun with --email <email>.',
      passwordPromptHint: 'Use --password-file <path> or pipe the password with --password-stdin in CI/CD.',
      emailRequiredMessage: 'A bootstrap admin email is required before setup can continue.',
      passwordRequiredMessage: 'A bootstrap admin password is required before setup can continue.',
    });

    if (isJson()) {
      console.log(JSON.stringify({
        status: 'success',
        action: result.status,
        url,
        ...(result.status === 'created'
          ? { admin: result.admin }
          : result.status === 'already-configured'
            ? { admin: result.admin, admins: result.admins }
            : { admins: result.admins, requestedEmail: result.requestedEmail }),
      }));
      return;
    }

    if (result.status === 'created') {
      console.log(chalk.green('✅'), `Bootstrap admin created for ${result.admin.email}.`);
      return;
    }

    if (result.status === 'already-configured') {
      console.log(chalk.green('✓'), `Bootstrap admin already configured for ${result.admin.email}.`);
      return;
    }

    const knownAdmins = result.admins.map((admin) => admin.email).join(', ');
    console.log(chalk.yellow('⚠'), 'Admin accounts already exist, so bootstrap was skipped.');
    console.log(chalk.dim(`  Existing admins: ${knownAdmins}`));
    if (result.requestedEmail) {
      console.log(chalk.dim(`  Requested bootstrap email: ${result.requestedEmail}`));
    }
    console.log(chalk.dim('  Add or rotate admins from the dashboard settings or the admin API instead of re-running bootstrap.'));
  });

adminCommand
  .command('reset-password')
  .description('Reset admin password')
  .option('--url <url>', 'Worker URL (default: EDGEBASE_URL or http://localhost:8787)')
  .option('--service-key <key>', 'Service Key (or set EDGEBASE_SERVICE_KEY env)')
  .option('--email <email>', 'Admin email (skip interactive prompt)')
  .option('--password <password>', 'New password (skip interactive prompt)')
  .option('--local', 'Use local D1 database (for local dev)')
  .action(async (options: { url?: string; serviceKey?: string; email?: string; password?: string; local?: boolean }) => {
    const email = options.email ?? await promptValue('Admin email: ', false, {
      field: 'email',
      hint: 'Rerun with --email <email>.',
      message: 'An admin email is required before password reset can continue.',
    });
    const newPassword = options.password ?? await promptValue('New password (min 8 chars): ', true, {
      field: 'password',
      hint: 'Rerun with --password <password>.',
      message: 'A new password is required before password reset can continue.',
    });

    if (!email) {
      raiseNeedsInput({
        code: 'admin_email_required',
        field: 'email',
        message: 'An admin email is required before password reset can continue.',
        hint: 'Rerun with --email <email>.',
      });
    }

    if (!newPassword) {
      raiseNeedsInput({
        code: 'admin_password_required',
        field: 'password',
        message: 'A new password is required before password reset can continue.',
        hint: 'Rerun with --password <password>.',
      });
    }

    if (newPassword.length < 8) {
      raiseCliError({
        code: 'admin_password_too_short',
        field: 'password',
        message: 'Password must be at least 8 characters.',
        hint: 'Choose a password with at least 8 characters and rerun the command.',
      });
    }

    const serviceKey = resolveOptionalServiceKey(options);

    if (serviceKey) {
      const url = resolveServerUrl({ url: options.url }, false) || 'http://localhost:8787';
      if (!isQuiet()) {
        console.log('\n🔄 Resetting admin password...');
      }

      try {
        const resp = await fetchWithTimeout(`${url}/admin/api/internal/reset-password`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-EdgeBase-Service-Key': serviceKey,
          },
          body: JSON.stringify({ email, newPassword }),
        });

        const data = await resp.json() as { ok?: boolean; message?: string; code?: number };

        if (!resp.ok || !data.ok) {
          const failureMessage = data.message || 'Unknown admin API error. Check the worker response or logs.';
          raiseCliError({
            code: 'admin_password_reset_failed',
            message: `Failed: ${failureMessage} (${data.code || resp.status})`,
            hint: 'Check that the Worker is reachable and the service key has admin privileges.',
          });
        }

        const result: ResetPasswordResult = {
          mode: 'service_key',
          email,
          url,
          sessionsRevoked: true,
        };

        if (isJson()) {
          console.log(JSON.stringify({
            status: 'success',
            ...result,
          }));
          return;
        }

        console.log(chalk.green('✅'), 'Password reset successfully. All admin sessions have been revoked.');
        return;
      } catch (error) {
        if (isCliStructuredError(error)) throw error;
        raiseCliError({
          code: 'admin_connection_failed',
          message: `Connection failed: ${(error as Error).message}`,
          hint: 'Make sure the Worker is running and the URL is correct.',
        });
      }
    }

    const local = Boolean(options.local);
    if (!isQuiet()) {
      console.log(chalk.dim(`\n  No Service Key found. Using ${local ? 'local' : 'Cloudflare'} D1 direct access...\n`));
    }
    const projectDir = process.cwd();
    const result = await resetViaD1Direct(projectDir, email, newPassword, local);

    if (isJson()) {
      console.log(JSON.stringify({
        status: 'success',
        ...result,
      }));
      return;
    }

    console.log(chalk.green('✅'), 'Password reset successfully. All admin sessions have been revoked.');
  });
