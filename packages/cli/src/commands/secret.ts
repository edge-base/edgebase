import { Command } from 'commander';
import { execFileSync, spawn } from 'node:child_process';
import chalk from 'chalk';
import { raiseCliError, raiseNeedsInput } from '../lib/agent-contract.js';
import { isJson, isNonInteractive, isQuiet } from '../lib/cli-context.js';
import { wranglerArgs, wranglerCommand } from '../lib/wrangler.js';
import { parseWranglerSecretNames } from '../lib/wrangler-secrets.js';

interface CommandFailureDetails {
  message: string;
  stderr?: string;
  stdout?: string;
}

function extractCommandFailure(error: unknown): CommandFailureDetails {
  if (!(error instanceof Error)) {
    return { message: 'Command failed for an unknown reason.' };
  }

  const execError = error as Error & {
    stderr?: string | Buffer;
    stdout?: string | Buffer;
    status?: number;
  };
  const stderr = typeof execError.stderr === 'string'
    ? execError.stderr.trim()
    : Buffer.isBuffer(execError.stderr)
      ? execError.stderr.toString('utf-8').trim()
      : undefined;
  const stdout = typeof execError.stdout === 'string'
    ? execError.stdout.trim()
    : Buffer.isBuffer(execError.stdout)
      ? execError.stdout.toString('utf-8').trim()
      : undefined;

  return {
    message: stderr || stdout || error.message,
    ...(stderr ? { stderr } : {}),
    ...(stdout ? { stdout } : {}),
  };
}

function runWranglerSecretCommand(
  args: string[],
  options?: { input?: string; confirmationInput?: string },
): { stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(
      wranglerCommand(),
      wranglerArgs(args),
      {
        encoding: 'utf-8',
        input: options?.input ?? options?.confirmationInput,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    return { stdout, stderr: '' };
  } catch (error) {
    const details = extractCommandFailure(error);
    raiseCliError({
      code: 'secret_command_failed',
      message: details.message,
      hint: 'Check your Wrangler login and current project configuration, then retry.',
      details: {
        args,
        ...(details.stderr ? { stderr: details.stderr } : {}),
        ...(details.stdout ? { stdout: details.stdout } : {}),
      },
    });
  }
}

/**
 * `npx edgebase secret` — Manage Cloudflare Workers Secrets.
 * Wraps wrangler secret commands for consistent DX.
 */
export const secretCommand = new Command('secret')
  .description('Manage secrets (Workers Secrets)');

secretCommand
  .command('set <key>')
  .description('Set a secret value')
  .option('--value <value>', 'Secret value (skip interactive wrangler prompt)')
  .action(async (key: string, options: { value?: string }) => {
    if (!options.value && (!process.stdin.isTTY || isNonInteractive() || isJson())) {
      raiseNeedsInput({
        code: 'secret_value_required',
        field: 'value',
        message: `A value is required before secret '${key}' can be set non-interactively.`,
        hint: 'Rerun with --value <secret>.',
      });
    }

    if (!isQuiet()) {
      console.log(chalk.blue(`🔑 Setting secret: ${key}`));
      if (options.value) {
        console.log(chalk.dim('  Using value provided via --value.'));
      } else {
        console.log(chalk.dim('  Enter the secret value when prompted by wrangler.'));
      }
      console.log();
    }

    if (!options.value) {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(wranglerCommand(), wranglerArgs(['wrangler', 'secret', 'put', key]), {
          stdio: 'inherit',
        });
        proc.on('error', reject);
        proc.on('exit', (code) => {
          if (code === 0) {
            resolve();
            return;
          }
          reject(new Error(`Wrangler exited with code ${code ?? 1}.`));
        });
      }).catch((error) => {
        raiseCliError({
          code: 'secret_set_failed',
          message: error instanceof Error ? error.message : `Failed to set secret '${key}'.`,
          hint: 'Check your Wrangler login and secret permissions, then retry.',
        });
      });
    } else {
      runWranglerSecretCommand(['wrangler', 'secret', 'put', key], { input: options.value });
    }

    if (isJson()) {
      console.log(JSON.stringify({
        status: 'success',
        operation: 'set',
        key,
      }));
      return;
    }

    console.log(chalk.green(`✅ Secret '${key}' set successfully.`));
  });

secretCommand
  .command('list')
  .description('List all secrets')
  .action(async () => {
    const { stdout } = runWranglerSecretCommand(['wrangler', 'secret', 'list', '--format', 'json']);
    const secrets = Array.from(parseWranglerSecretNames(stdout)).sort();

    if (isJson()) {
      console.log(JSON.stringify({
        status: 'success',
        operation: 'list',
        secrets,
      }));
      return;
    }

    console.log(chalk.blue('🔑 Listing secrets...'));
    console.log();
    if (secrets.length === 0) {
      console.log(chalk.dim('  No Workers secrets found.'));
      return;
    }

    for (const name of secrets) {
      console.log(chalk.green('✓'), name);
    }
  });

secretCommand
  .command('delete <key>')
  .description('Delete a secret')
  .action(async (key: string) => {
    if (!isQuiet()) {
      console.log(chalk.blue(`🗑️  Deleting secret: ${key}`));
    }

    if (isJson() || isNonInteractive() || !process.stdin.isTTY) {
      runWranglerSecretCommand(['wrangler', 'secret', 'delete', key], { confirmationInput: 'y\n' });
    } else {
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(wranglerCommand(), wranglerArgs(['wrangler', 'secret', 'delete', key]), {
          stdio: 'inherit',
        });
        proc.on('error', reject);
        proc.on('exit', (code) => {
          if (code === 0) {
            resolve();
            return;
          }
          reject(new Error(`Wrangler exited with code ${code ?? 1}.`));
        });
      }).catch((error) => {
        raiseCliError({
          code: 'secret_delete_failed',
          message: error instanceof Error ? error.message : `Failed to delete secret '${key}'.`,
          hint: 'Check your Wrangler login, then retry the deletion.',
        });
      });
    }

    if (isJson()) {
      console.log(JSON.stringify({
        status: 'success',
        operation: 'delete',
        key,
      }));
      return;
    }

    console.log(chalk.green(`✅ Secret '${key}' deleted.`));
  });
