import { Command } from 'commander';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import chalk from 'chalk';
import { isCliStructuredError, raiseCliError } from '../lib/agent-contract.js';
import { spin } from '../lib/spinner.js';
import { isJson, isQuiet } from '../lib/cli-context.js';
import { promptText } from '../lib/prompts.js';
import { fetchWithTimeout } from '../lib/fetch-with-timeout.js';
import { resolveServiceKey, resolveServerUrl } from '../lib/resolve-options.js';

/**
 * `npx edgebase export` — Export table data as JSON.
 *
 * - `--format json` (only JSON supported)
 * - `--table <name>` — Required: specific table to export
 * - `--output <path>` — Output file path
 * - `--url <url>` — Server URL (or EDGEBASE_URL env)
 * - `--service-key <key>` — Service Key (or EDGEBASE_SERVICE_KEY env, or .edgebase/secrets.json)
 *
 * Uses Service Key authentication to call the backup export API endpoint.
 * Authentication/URL resolution follows the same pattern as `backup` command.
 */
export const exportCommand = new Command('export')
  .description('Export table data as JSON')
  .option('--format <type>', 'Export format (only "json" supported)', 'json')
  .option('--table <name>', 'Table to export')
  .option('--output <path>', 'Output file path')
  .option('--url <url>', 'Server URL (or EDGEBASE_URL env)')
  .option('--service-key <key>', 'Service Key (or EDGEBASE_SERVICE_KEY env)')
  .action(async (options: { format: string; table?: string; output?: string; url?: string; serviceKey?: string }) => {
    const format = options.format.toLowerCase();

    if (format !== 'json') {
      raiseCliError({
        code: 'export_format_unsupported',
        field: 'format',
        message: `Unsupported format: "${format}". Only "json" is currently supported.`,
        hint: 'Rerun with --format json.',
      });
    }

    // Interactive prompt for --table if missing (TTY only)
    if (!options.table) {
      options.table = await promptText('Which table to export?', undefined, {
        field: 'table',
        hint: 'Rerun with --table <name>.',
        message: 'A table name is required before export can continue.',
      });
    }

    // Resolve Service Key and URL via shared utilities
    const serviceKey = resolveServiceKey(options);
    const serverUrl = resolveServerUrl(options);

    const tableName = options.table;
    const defaultName = `${tableName}-export.json`;
    const outputPath = resolve(options.output || `./${defaultName}`);

    // Ensure output directory exists
    const outputDir = dirname(outputPath);
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    if (!isQuiet()) {
      console.log(chalk.blue('📦 Exporting table data...'));
      console.log(chalk.dim(`  Table: ${tableName}`));
      console.log(chalk.dim(`  Format: ${format}`));
      console.log(chalk.dim(`  Output: ${outputPath}`));
      console.log();
    }

    // Call Export API endpoint (Service Key path)
    const exportUrl = `${serverUrl.replace(/\/$/, '')}/admin/api/backup/export/${encodeURIComponent(tableName)}?format=json`;

    const s = spin('Fetching data from server...');
    try {
      const response = await fetchWithTimeout(exportUrl, {
        headers: {
          'X-EdgeBase-Service-Key': serviceKey,
        },
      });

      if (!response.ok) {
        const error = await response.text();
        let message: string;
        try {
          const parsed = JSON.parse(error);
          message = parsed.message || error;
        } catch {
          message = error;
        }
        s.fail(`Export failed (${response.status})`);
        raiseCliError({
          code: response.status === 404 ? 'export_table_not_found' : 'export_failed',
          message,
          hint: response.status === 401
            ? 'Check your Service Key. It may have been rotated.'
            : response.status === 404
              ? `Table "${tableName}" not found. Check the table name and retry.`
              : 'Check the server URL and ensure the server is running.',
          details: {
            table: tableName,
            status: response.status,
          },
        });
      }

      const data = await response.text();
      writeFileSync(outputPath, data, 'utf-8');

      // Count records
      let recordCount = 0;
      try {
        const parsed = JSON.parse(data);
        recordCount = Array.isArray(parsed) ? parsed.length : 0;
      } catch { /* ignore */ }

      s.succeed(`Exported ${recordCount} record(s) from "${tableName}"`);

      // Show server notice if present (e.g., View table warning)
      const notice = response.headers.get('x-edgebase-notice');
      if (notice) {
        console.log(chalk.yellow('⚠'), chalk.yellow(notice));
      }

      if (isJson()) {
        console.log(JSON.stringify({
          status: 'success',
          table: tableName,
          records: recordCount,
          output: outputPath,
        }));
      } else if (!isQuiet()) {
        console.log(chalk.dim(`  → ${outputPath}`));
      }
    } catch (err) {
      if (isCliStructuredError(err)) throw err;
      s.fail('Export failed');
      raiseCliError({
        code: 'export_failed',
        message: (err as Error).message,
        hint: 'Check the server URL and ensure the server is running.',
        details: {
          table: tableName,
          output: outputPath,
        },
      });
    }
  });
