/**
 * migrator.ts — CLI data migration engine.
 *
 * Orchestrates data migration between providers (D1 ↔ PostgreSQL)
 * by communicating with the running Worker's Admin Backup API.
 *
 * Flow:
 *   1. Dump data from running Worker (old provider)
 *   2. Caller deploys/restarts with new config
 *   3. Restore data to new Worker (new provider)
 *
 * Supports: auth tables (16 tables) + data namespace tables (user-defined).
 */
import chalk from 'chalk';
import { spin } from './spinner.js';
import { raiseNeedsInput } from './agent-contract.js';
import { isNonInteractive, isQuiet } from './cli-context.js';
import { fetchWithTimeout } from './fetch-with-timeout.js';
import type { ProviderChange } from './schema-check.js';

// ─── Types ───

export interface MigrationOptions {
  /** What to migrate: auth, data, or both. */
  scope: 'auth' | 'data' | 'all';
  /** Data namespace(s) to migrate (e.g. ['shared']). */
  namespaces?: string[];
  /** Worker URL (http://localhost:8787 for dev, https://my-app.workers.dev for deploy). */
  serverUrl: string;
  /** Service Key for Admin API authentication. */
  serviceKey: string;
  /** Show preview only, don't execute. */
  dryRun: boolean;
}

export interface DumpedData {
  auth?: { tables: Record<string, unknown[]> };
  data?: Record<string, { tables: Record<string, unknown[]> }>;
}

export interface MigrationResult {
  success: boolean;
  authTables: number;
  authRows: number;
  dataTables: number;
  dataRows: number;
  duration: number;
  errors: string[];
}

// ─── Progress Bar Helper ───

function progressBar(current: number, total: number, width = 20): string {
  if (total === 0) return '░'.repeat(width);
  const ratio = Math.min(current / total, 1);
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const percent = Math.round(ratio * 100);
  return '█'.repeat(filled) + '░'.repeat(empty) + ` ${percent}%`;
}

function logHuman(...args: unknown[]): void {
  if (isQuiet()) return;
  console.log(...args);
}

// ─── Admin API Client ───

async function apiCall<T>(
  serverUrl: string,
  serviceKey: string,
  path: string,
  body?: unknown,
  timeoutMs = 120_000,
): Promise<T> {
  const url = `${serverUrl.replace(/\/$/, '')}/admin/api/backup${path}`;
  const resp = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-EdgeBase-Service-Key': serviceKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  }, timeoutMs);

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Migration API error (${resp.status}): ${text}`);
  }
  return resp.json() as Promise<T>;
}

// ─── Dump ───

/**
 * Print table listing after dump.
 */
function printTableListing(tables: Record<string, unknown[]>, indent = '    '): void {
  const nonEmpty = Object.entries(tables).filter(([, rows]) => rows.length > 0);
  if (nonEmpty.length === 0) return;

  const maxNameLen = Math.max(...nonEmpty.map(([name]) => name.length), 10);
  for (const [name, rows] of nonEmpty) {
    logHuman(
      chalk.dim(`${indent}${name.padEnd(maxNameLen + 2)}`) +
      chalk.dim(`${rows.length.toLocaleString().padStart(8)} rows`),
    );
  }
}

/**
 * Dump data from the currently running Worker (before deploy/restart).
 */
export async function dumpCurrentData(opts: MigrationOptions): Promise<DumpedData> {
  const dumped: DumpedData = {};

  // Auth dump
  if (opts.scope === 'auth' || opts.scope === 'all') {
    const s = spin('Dumping auth tables...');
    try {
      const result = await apiCall<{ tables: Record<string, unknown[]> }>(
        opts.serverUrl, opts.serviceKey, '/dump-d1',
      );
      dumped.auth = { tables: result.tables };

      const totalRows = Object.values(result.tables).reduce((sum, rows) => sum + rows.length, 0);
      const tableCount = Object.keys(result.tables).filter(t => result.tables[t].length > 0).length;
      s.succeed(`Auth tables dumped (${tableCount} tables, ${totalRows.toLocaleString()} rows)`);
      printTableListing(result.tables);
    } catch (err) {
      s.fail(`Auth dump failed: ${(err as Error).message}`);
      throw err;
    }
  }

  // Data namespace dump
  if (opts.scope === 'data' || opts.scope === 'all') {
    const namespaces = opts.namespaces ?? [];
    if (namespaces.length > 0) {
      dumped.data = {};
      for (const ns of namespaces) {
        const s = spin(`Dumping data namespace: ${ns}...`);
        try {
          const result = await apiCall<{
            tables: Record<string, unknown[]>;
            tableOrder: string[];
          }>(opts.serverUrl, opts.serviceKey, '/dump-data', { namespace: ns });

          dumped.data[ns] = { tables: result.tables };
          const totalRows = Object.values(result.tables).reduce((sum, rows) => sum + rows.length, 0);
          const tableCount = Object.keys(result.tables).filter(t => result.tables[t].length > 0).length;
          s.succeed(`Data '${ns}' dumped (${tableCount} tables, ${totalRows.toLocaleString()} rows)`);
          printTableListing(result.tables);
        } catch (err) {
          s.fail(`Data '${ns}' dump failed: ${(err as Error).message}`);
          throw err;
        }
      }
    }
  }

  return dumped;
}

// ─── Restore ───

/**
 * Restore data to the new Worker (after deploy/restart).
 * Sends tables one at a time with progress bar display.
 */
export async function restoreToNewProvider(
  opts: MigrationOptions,
  dumped: DumpedData,
): Promise<void> {
  // Auth restore — per-table progress
  if (dumped.auth && (opts.scope === 'auth' || opts.scope === 'all')) {
    const tables = dumped.auth.tables;
    const nonEmptyTables = Object.entries(tables).filter(([, rows]) => rows.length > 0);
    const totalRows = Object.values(tables).reduce((sum, rows) => sum + rows.length, 0);
    const totalTables = nonEmptyTables.length;

    const s = spin(`Restoring auth tables (${totalRows.toLocaleString()} rows)...`);
    try {
      // Step 1: Wipe existing data
      s.text = 'Wiping existing auth data...';
      await apiCall(
        opts.serverUrl, opts.serviceKey, '/restore-d1',
        { tables: {}, skipWipe: false },
        300_000,
      );

      // Step 2: Restore tables one by one
      let completed = 0;
      for (const [tableName, rows] of nonEmptyTables) {
        s.text = `Restoring auth [${completed + 1}/${totalTables}] ${tableName} (${rows.length.toLocaleString()} rows) ${progressBar(completed, totalTables)}`;

        await apiCall(
          opts.serverUrl, opts.serviceKey, '/restore-d1',
          { tables: { [tableName]: rows }, skipWipe: true },
          300_000,
        );
        completed++;
      }

      s.succeed(`Auth tables restored (${totalTables} tables, ${totalRows.toLocaleString()} rows)`);
    } catch (err) {
      s.fail(`Auth restore failed: ${(err as Error).message}`);
      throw err;
    }
  }

  // Data namespace restore — per-table progress
  if (dumped.data && (opts.scope === 'data' || opts.scope === 'all')) {
    for (const [ns, data] of Object.entries(dumped.data)) {
      const tables = data.tables;
      const nonEmptyTables = Object.entries(tables).filter(([, rows]) => rows.length > 0);
      const totalRows = Object.values(tables).reduce((sum, rows) => sum + rows.length, 0);
      const totalTables = nonEmptyTables.length;

      const s = spin(`Restoring data '${ns}' (${totalRows.toLocaleString()} rows)...`);
      try {
        // Step 1: Wipe existing data
        s.text = `Wiping existing data '${ns}'...`;
        await apiCall(
          opts.serverUrl, opts.serviceKey, '/restore-data',
          { namespace: ns, tables: {}, skipWipe: false },
          300_000,
        );

        // Step 2: Restore tables one by one
        let completed = 0;
        for (const [tableName, rows] of nonEmptyTables) {
          s.text = `Restoring '${ns}' [${completed + 1}/${totalTables}] ${tableName} (${rows.length.toLocaleString()} rows) ${progressBar(completed, totalTables)}`;

          await apiCall(
            opts.serverUrl, opts.serviceKey, '/restore-data',
            { namespace: ns, tables: { [tableName]: rows }, skipWipe: true },
            300_000,
          );
          completed++;
        }

        s.succeed(`Data '${ns}' restored (${totalTables} tables, ${totalRows.toLocaleString()} rows)`);
      } catch (err) {
        s.fail(`Data '${ns}' restore failed: ${(err as Error).message}`);
        throw err;
      }
    }
  }
}

// ─── Dry Run ───

/**
 * Display a migration preview without executing.
 */
export async function dryRunSummary(opts: MigrationOptions): Promise<MigrationResult> {
  const startTime = Date.now();
  let authTables = 0;
  let authRows = 0;
  let dataTables = 0;
  let dataRows = 0;

  logHuman();
  logHuman(chalk.blue('  Migration Preview (dry run)'));
  logHuman();

  // Auth
  if (opts.scope === 'auth' || opts.scope === 'all') {
    try {
      const result = await apiCall<{ tables: Record<string, unknown[]> }>(
        opts.serverUrl, opts.serviceKey, '/dump-d1',
      );
      logHuman(chalk.cyan('  Auth Tables:'));
      for (const [table, rows] of Object.entries(result.tables)) {
        if (rows.length > 0) {
          logHuman(`    ${table.padEnd(30)} ${rows.length.toLocaleString()} rows`);
          authTables++;
          authRows += rows.length;
        }
      }
      logHuman();
    } catch (err) {
      logHuman(chalk.red(`  Auth dump failed: ${(err as Error).message}`));
    }
  }

  // Data namespaces
  if (opts.scope === 'data' || opts.scope === 'all') {
    for (const ns of opts.namespaces ?? []) {
      try {
        const result = await apiCall<{ tables: Record<string, unknown[]> }>(
          opts.serverUrl, opts.serviceKey, '/dump-data', { namespace: ns },
        );
        logHuman(chalk.cyan(`  Data: ${ns}`));
        for (const [table, rows] of Object.entries(result.tables)) {
          if (rows.length > 0) {
            logHuman(`    ${table.padEnd(30)} ${rows.length.toLocaleString()} rows`);
            dataTables++;
            dataRows += rows.length;
          }
        }
        logHuman();
      } catch (err) {
        logHuman(chalk.red(`  Data '${ns}' dump failed: ${(err as Error).message}`));
      }
    }
  }

  const totalTables = authTables + dataTables;
  const totalRows = authRows + dataRows;
  logHuman(chalk.dim(`  Total: ${totalTables} tables, ${totalRows.toLocaleString()} rows`));
  logHuman();

  return {
    success: true,
    authTables,
    authRows,
    dataTables,
    dataRows,
    duration: Date.now() - startTime,
    errors: [],
  };
}

// ─── Main Orchestrator ───

/**
 * Execute a full migration. Called from deploy.ts, dev.ts, and migrate.ts.
 *
 * Note: This only handles the DUMP phase. The caller is responsible for:
 * 1. Calling dumpCurrentData() before deploy/restart
 * 2. Deploying/restarting with new config
 * 3. Calling restoreToNewProvider() after deploy/restart
 */
export async function executeMigration(opts: MigrationOptions): Promise<MigrationResult> {
  const startTime = Date.now();

  if (opts.dryRun) {
    return dryRunSummary(opts);
  }

  const errors: string[] = [];
  let authTables = 0;
  let authRows = 0;
  let dataTables = 0;
  let dataRows = 0;

  // Full migration in one shot (for standalone migrate command where server stays running)
  logHuman();
  logHuman(chalk.blue('📦 Phase 1/2: Dumping data from current provider...'));
  const dumped = await dumpCurrentData(opts);

  logHuman();
  logHuman(chalk.blue('📥 Phase 2/2: Restoring data to new provider...'));
  await restoreToNewProvider(opts, dumped);

  // Count results
  if (dumped.auth) {
    authTables = Object.keys(dumped.auth.tables).filter(t => dumped.auth!.tables[t].length > 0).length;
    authRows = Object.values(dumped.auth.tables).reduce((sum, rows) => sum + rows.length, 0);
  }
  if (dumped.data) {
    for (const data of Object.values(dumped.data)) {
      dataTables += Object.keys(data.tables).filter(t => data.tables[t].length > 0).length;
      dataRows += Object.values(data.tables).reduce((sum, rows) => sum + rows.length, 0);
    }
  }

  const duration = Date.now() - startTime;
  logHuman();
  logHuman(chalk.green('✓ Migration complete!'),
    chalk.dim(`(${(duration / 1000).toFixed(1)}s)`));

  return { success: true, authTables, authRows, dataTables, dataRows, duration, errors };
}

// ─── Interactive Prompt ───

/**
 * Prompt the user to choose migration action when provider change is detected.
 */
export async function promptMigration(changes: ProviderChange[]): Promise<'migrate' | 'skip'> {
  if (!process.stdin.isTTY || isNonInteractive()) {
    raiseNeedsInput({
      code: 'provider_migration_decision_required',
      field: 'migrationAction',
      message: 'Provider changes were detected and require an explicit migration decision.',
      hint: 'Run `edgebase migrate` to move data first, or rerun after intentionally deciding to skip migration.',
      choices: [
        {
          label: 'Migrate data now',
          value: 'migrate',
          args: ['migrate'],
          hint: 'Use the dedicated migrate command before continuing.',
        },
        {
          label: 'Skip migration for now',
          value: 'skip',
          hint: 'Only safe if you intentionally want to continue without moving data.',
        },
      ],
    });
  }

  const readline = await import('node:readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log();
  console.log(chalk.yellow('⚠ Database provider changes detected:'));
  for (const pc of changes) {
    const label = pc.namespace === '_auth' ? 'Auth' : pc.namespace;
    console.log(chalk.yellow(`  • ${label}: ${pc.oldProvider} → ${pc.newProvider}`));
  }
  console.log();
  console.log(chalk.cyan('[m]'), 'Migrate data to new provider');
  console.log(chalk.cyan('[s]'), 'Skip (continue without migration)');
  console.log();

  return new Promise((resolve) => {
    rl.question(chalk.cyan('Choose [m/s]: '), (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === 'm' ? 'migrate' : 'skip');
    });
  });
}
