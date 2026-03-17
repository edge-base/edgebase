import { Command } from 'commander';
import { execFileSync, spawn } from 'node:child_process';
import { wranglerArgs, wranglerCommand, wranglerHint } from '../lib/wrangler.js';
import { raiseCliError } from '../lib/agent-contract.js';
import { isJson, isQuiet } from '../lib/cli-context.js';
import { resolveProjectWorkerName } from '../lib/project-runtime.js';

/**
 * Detect the Worker name from wrangler.toml in the current directory.
 */
function detectWorkerName(cwd: string): string | null {
  return resolveProjectWorkerName(cwd) || null;
}

/**
 * Check if wrangler is available.
 */
function checkWrangler(): boolean {
  try {
    execFileSync(wranglerCommand(), wranglerArgs(['wrangler', '--version']), { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Exported for testing */
export const _internals = { detectWorkerName, checkWrangler };

// ─── Command ───

export const logsCommand = new Command('logs')
  .alias('l')
  .description('Stream real-time logs from deployed Worker (wraps wrangler tail)')
  .option('--format <format>', 'Output format: json or pretty', 'pretty')
  .option('--filter <filter>', 'Filter by status code or method (e.g., "status:500")')
  .option('--name <name>', 'Worker name (auto-detected from wrangler.toml)')
  .action((options: { format: string; filter?: string; name?: string }) => {
    const cwd = process.cwd();
    const format = isJson() && options.format === 'pretty' ? 'json' : options.format;

    if (!checkWrangler()) {
      raiseCliError({
        code: 'wrangler_unavailable',
        message: `Wrangler could not be started. Try: ${wranglerHint(['wrangler', '--version'])}`,
      });
    }

    const workerName = options.name ?? detectWorkerName(cwd);

    const args = ['wrangler', 'tail'];

    if (workerName) {
      args.push(workerName);
    }

    if (format === 'json') {
      args.push('--format', 'json');
    } else {
      args.push('--format', 'pretty');
    }

    if (options.filter) {
      // Parse filter: "status:500" → --status 500, "method:POST" → --method POST
      const parts = options.filter.split(':');
      if (parts.length === 2) {
        const [key, value] = parts;
        if (key === 'status') {
          args.push('--status', value);
        } else if (key === 'method') {
          args.push('--method', value);
        } else {
          args.push('--search', options.filter);
        }
      } else {
        args.push('--search', options.filter);
      }
    }

    if (!isQuiet()) {
      console.log(`📡 Starting log stream...`);
      if (workerName) {
        console.log(`   Worker: ${workerName}`);
      }
      console.log(`   Format: ${format}`);
      console.log(`   Press Ctrl+C to stop\n`);
    }

    const child = spawn(wranglerCommand(), wranglerArgs(args), {
      cwd,
      stdio: 'inherit',
    });

    return new Promise<void>((resolve, reject) => {
      child.on('error', (err) => {
        reject(err);
      });

      child.on('exit', (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`Log stream exited with code ${code ?? 1}.`));
      });
    }).catch((error) => {
      raiseCliError({
        code: 'logs_stream_failed',
        message: error instanceof Error ? error.message : 'Failed to start log stream.',
        hint: 'Check your Wrangler login and Worker name, then retry.',
      });
    });
  });
