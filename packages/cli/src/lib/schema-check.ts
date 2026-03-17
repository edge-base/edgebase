/**
 * Schema Destructive Change Detection — Build-time snapshot diff.
 *
 * Compares the current config schema against a saved snapshot to detect
 * destructive changes (column delete, rename, type change) and forces
 * the developer to choose: DB reset or migration.
 */

import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import type { SchemaField } from '@edgebase/shared';
import { raiseCliError, raiseNeedsInput } from './agent-contract.js';
import { isNonInteractive } from './cli-context.js';

// ─── Types ───

export interface SnapshotTableEntry {
  schema: Record<string, Pick<SchemaField, 'type' | 'primaryKey'>>;
  latestMigrationVersion: number;
}

export interface SchemaSnapshot {
  version: 1 | 2;
  databases: Record<string, {
    tables: Record<string, SnapshotTableEntry>;
    provider?: string;  // v2: track provider per namespace
  }>;
  authProvider?: string;  // v2: track auth.provider changes
}

export interface DestructiveChange {
  dbKey: string;
  table: string;
  type: 'column_deleted' | 'column_type_changed' | 'table_deleted';
  detail: string;
}

// ─── Auto-Fields (mirrors server AUTO_FIELDS —) ───

const AUTO_FIELDS: Record<string, Pick<SchemaField, 'type' | 'primaryKey'>> = {
  id: { type: 'string', primaryKey: true },
  createdAt: { type: 'datetime' },
  updatedAt: { type: 'datetime' },
};

// ─── Snapshot Build ───

/**
 * Build effective schema for snapshot purposes.
 * Mirrors server's buildEffectiveSchema() but only extracts type/primaryKey for diffing.
 * Accepts loosely-typed schema from parsed JSON config.
 */
function buildSnapshotSchema(
  userSchema?: Record<string, unknown>,
): Record<string, Pick<SchemaField, 'type' | 'primaryKey'>> {
  const effective: Record<string, Pick<SchemaField, 'type' | 'primaryKey'>> = {};

  // Inject auto-fields (disabled by `false`, type override blocked by §1a)
  for (const [name, field] of Object.entries(AUTO_FIELDS)) {
    if (userSchema?.[name] === false) continue;
    effective[name] = { ...field };
  }

  // Add user-defined fields
  if (userSchema) {
    for (const [name, field] of Object.entries(userSchema)) {
      if (name in AUTO_FIELDS) continue;
      if (field === false) continue;
      if (typeof field === 'object' && field !== null && 'type' in field) {
        const f = field as { type: string; primaryKey?: boolean };
        effective[name] = { type: f.type as SchemaField['type'], ...(f.primaryKey ? { primaryKey: true } : {}) };
      }
    }
  }

  return effective;
}

/** Minimal shape of a DB block needed for snapshot building. */
export interface DbBlockLike {
  tables?: Record<string, {
    schema?: Record<string, unknown>;
    migrations?: Array<{ version: number }>;
  }>;
  provider?: string;  // v2: track provider per namespace
}

/**
 * Build a full snapshot from the current config's databases block.
 */
export function buildSnapshot(databases: Record<string, DbBlockLike>, authProvider?: string): SchemaSnapshot {
  const snapshot: SchemaSnapshot = { version: 2, databases: {}, ...(authProvider ? { authProvider } : {}) };

  for (const [dbKey, dbBlock] of Object.entries(databases)) {
    const tables: Record<string, SnapshotTableEntry> = {};
    for (const [tableName, tableConfig] of Object.entries(dbBlock.tables ?? {})) {
      const migrations = tableConfig.migrations ?? [];
      const latestVersion = migrations.length > 0
        ? Math.max(...migrations.map(m => m.version))
        : 0;
      tables[tableName] = {
        schema: buildSnapshotSchema(tableConfig.schema),
        latestMigrationVersion: latestVersion,
      };
    }
    snapshot.databases[dbKey] = {
      tables,
      ...(dbBlock.provider ? { provider: dbBlock.provider } : {}),
    };
  }

  return snapshot;
}

// ─── Snapshot I/O ───

const SNAPSHOT_FILENAME = 'edgebase-schema.lock.json';

export function getSnapshotPath(projectDir: string): string {
  return resolve(projectDir, SNAPSHOT_FILENAME);
}

export function loadSnapshot(projectDir: string): SchemaSnapshot | null {
  const path = getSnapshotPath(projectDir);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as SchemaSnapshot;
  } catch {
    return null;
  }
}

export function saveSnapshot(projectDir: string, snapshot: SchemaSnapshot): void {
  const path = getSnapshotPath(projectDir);
  writeFileSync(path, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8');
}

// ─── Provider Change Detection ───

export interface ProviderChange {
  namespace: string;
  oldProvider: string;
  newProvider: string;
}

/**
 * Detect provider changes between snapshots.
 * Returns list of namespaces whose provider changed.
 */
export function detectProviderChanges(
  saved: SchemaSnapshot,
  current: SchemaSnapshot,
): ProviderChange[] {
  const changes: ProviderChange[] = [];

  for (const [ns, currentDb] of Object.entries(current.databases)) {
    const savedDb = saved.databases[ns];
    if (!savedDb) continue; // new namespace — no change to detect

    const oldProvider = savedDb.provider ?? 'do';
    const newProvider = currentDb.provider ?? 'do';

    if (oldProvider !== newProvider) {
      changes.push({ namespace: ns, oldProvider, newProvider });
    }
  }

  return changes;
}

/**
 * Detect auth provider change between snapshots.
 * Returns a ProviderChange for namespace '_auth' if auth.provider changed.
 */
export function detectAuthProviderChange(
  saved: SchemaSnapshot,
  current: SchemaSnapshot,
): ProviderChange | null {
  const oldProvider = saved.authProvider ?? 'd1';
  const newProvider = current.authProvider ?? 'd1';

  if (oldProvider !== newProvider) {
    return { namespace: '_auth', oldProvider, newProvider };
  }
  return null;
}

// ─── Destructive Change Detection (§2) ───

/**
 * Compare saved snapshot against current config and return destructive changes.
 */
export function detectDestructiveChanges(
  saved: SchemaSnapshot,
  current: SchemaSnapshot,
): DestructiveChange[] {
  const changes: DestructiveChange[] = [];

  for (const [dbKey, savedDb] of Object.entries(saved.databases)) {
    const currentDb = current.databases[dbKey];

    // Entire DB block removed
    if (!currentDb) {
      for (const tableName of Object.keys(savedDb.tables)) {
        changes.push({
          dbKey,
          table: tableName,
          type: 'table_deleted',
          detail: `Table '${dbKey}.${tableName}' removed (entire DB block '${dbKey}' deleted)`,
        });
      }
      continue;
    }

    for (const [tableName, savedTable] of Object.entries(savedDb.tables)) {
      const currentTable = currentDb.tables[tableName];

      // Table removed
      if (!currentTable) {
        changes.push({
          dbKey,
          table: tableName,
          type: 'table_deleted',
          detail: `Table '${dbKey}.${tableName}' removed`,
        });
        continue;
      }

      // Column-level diff
      for (const [colName, savedCol] of Object.entries(savedTable.schema)) {
        const currentCol = currentTable.schema[colName];

        if (!currentCol) {
          changes.push({
            dbKey,
            table: tableName,
            type: 'column_deleted',
            detail: `Column '${dbKey}.${tableName}.${colName}' removed`,
          });
          continue;
        }

        if (savedCol.type !== currentCol.type) {
          changes.push({
            dbKey,
            table: tableName,
            type: 'column_type_changed',
            detail: `Column '${dbKey}.${tableName}.${colName}' type: ${savedCol.type} → ${currentCol.type}`,
          });
        }
      }
    }
  }

  return changes;
}

// ─── Per-table Migration Auto-Pass (§4) ───

/**
 * Filter out destructive changes for tables that have new migrations covering them.
 */
export function filterAutoPassChanges(
  changes: DestructiveChange[],
  saved: SchemaSnapshot,
  current: SchemaSnapshot,
): DestructiveChange[] {
  return changes.filter(change => {
    const savedDb = saved.databases[change.dbKey];
    const currentDb = current.databases[change.dbKey];
    if (!savedDb || !currentDb) return true; // Keep — can't auto-pass

    const savedTable = savedDb.tables[change.table];
    const currentTable = currentDb.tables[change.table];
    if (!savedTable || !currentTable) return true; // Keep — table deleted, no migration possible

    const savedVersion = savedTable.latestMigrationVersion;
    const currentVersion = currentTable.latestMigrationVersion;

    // Auto-pass: new migration version > saved version for THIS table
    return currentVersion <= savedVersion;
  });
}

// ─── Interactive Prompt (§3) ───

export interface HandleResult {
  action: 'reset' | 'migration_guide' | 'auto_pass';
}

/**
 * Display destructive changes and prompt for action.
 * Returns the user's choice.
 */
export async function handleDestructiveChanges(
  changes: DestructiveChange[],
  isRelease: boolean,
  isTTY: boolean,
  ifDestructiveFlag?: string,
): Promise<HandleResult> {
  // Display changes
  console.log();
  console.log(chalk.yellow('⚠ Destructive schema changes detected:'));
  for (const c of changes) {
    console.log(chalk.yellow(`  • ${c.detail}`));
  }
  console.log();

  // Non-interactive (CI/CD) — §5a
  if (!isTTY || isNonInteractive()) {
    if (ifDestructiveFlag === 'reset') {
      if (isRelease) {
        raiseCliError({
          code: 'destructive_reset_not_allowed',
          field: 'ifDestructive',
          message: '--if-destructive=reset is not allowed when release: true.',
          hint: 'Use --if-destructive=reject and add a migration for the destructive schema change.',
        });
      }
      return { action: 'reset' };
    }
    raiseNeedsInput({
      code: 'destructive_schema_confirmation_required',
      field: 'ifDestructive',
      message: 'Destructive schema changes require an explicit strategy in non-interactive mode.',
      hint: 'Rerun with --if-destructive=reset for local development, or add migrations before retrying.',
      choices: isRelease
        ? [{
          label: 'Reject and add migrations',
          value: 'reject',
          args: ['--if-destructive', 'reject'],
          hint: 'Release mode cannot reset the database.',
        }]
        : [
          {
            label: 'Reject and add migrations',
            value: 'reject',
            args: ['--if-destructive', 'reject'],
          },
          {
            label: 'Reset local DB and continue',
            value: 'reset',
            args: ['--if-destructive', 'reset'],
            hint: 'Development only. This deletes local data.',
          },
        ],
    });
  }

  // Release mode: no reset option (§3)
  if (isRelease) {
    raiseCliError({
      code: 'destructive_reset_not_allowed',
      field: 'ifDestructive',
      message: 'DB reset is not supported in release mode.',
      hint: 'Write a migration instead of using --if-destructive reset in release mode.',
      details: {
        changes: changes.map((change) => ({
          dbKey: change.dbKey,
          table: change.table,
          type: change.type,
        })),
      },
    });
  }

  // Interactive dev mode: prompt for choice
  const readline = await import('node:readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    console.log(chalk.cyan('[r]'), 'Reset DB and continue (all data will be deleted)');
    console.log(chalk.cyan('[m]'), 'Show migration guide');
    console.log();

    rl.question(chalk.cyan('Choose: '), (answer) => {
      rl.close();
      const choice = answer.trim().toLowerCase();
      if (choice === 'r') {
        resolve({ action: 'reset' });
      } else {
        printMigrationGuide(changes);
        resolve({ action: 'migration_guide' });
      }
    });
  });
}

/**
 * Print migration guide for each affected table.
 */
function printMigrationGuide(changes: DestructiveChange[]): void {
  // Group changes by table
  const byTable = new Map<string, DestructiveChange[]>();
  for (const c of changes) {
    const key = `${c.dbKey}.${c.table}`;
    if (!byTable.has(key)) byTable.set(key, []);
    byTable.get(key)!.push(c);
  }

  console.log();
  for (const [tableKey, tableChanges] of byTable) {
    const [_dbKey, tableName] = tableKey.split('.');
    console.log(chalk.dim(`  Add to ${tableKey}.migrations:`));
    console.log();

    // Suggest SQL hints based on change types
    const hints: string[] = [];
    for (const c of tableChanges) {
      if (c.type === 'column_deleted') {
        const colName = c.detail.match(/Column '.*?\.(\w+)' removed/)?.[1] ?? '?';
        hints.push(`ALTER TABLE ${tableName} DROP COLUMN ${colName}`);
      } else if (c.type === 'column_type_changed') {
        const match = c.detail.match(/Column '.*?\.(\w+)' type: (\w+) → (\w+)/);
        if (match) {
          hints.push(`-- Type change: ${match[1]} ${match[2]} → ${match[3]} (manual SQL required)`);
        }
      } else if (c.type === 'table_deleted') {
        hints.push(`DROP TABLE IF EXISTS ${tableName}`);
      }
    }

    console.log(chalk.dim('    {'));
    console.log(chalk.dim(`      version: <next>,`));
    console.log(chalk.dim(`      description: '...',`));
    console.log(chalk.dim(`      up: '${hints.join('; ')}'`));
    console.log(chalk.dim('    }'));
    console.log();
  }
  console.log(chalk.dim('  Add the migration and run again.'));
}

// ─── Dev Mode Reset Helper ───

/**
 * Reset local Miniflare DO state for dev mode.
 */
export function resetLocalDoState(projectDir: string, persistTo?: string): void {
  const statePath = persistTo
    ? resolve(persistTo, 'v3', 'do')
    : resolve(projectDir, '.wrangler', 'state', 'v3', 'do');
  try {
    rmSync(statePath, { recursive: true, force: true });
    console.log(chalk.green('✓'), `Local DO state cleared (${statePath})`);
  } catch {
    console.log(chalk.yellow('⚠'), 'Could not clear local DO state — manual cleanup may be needed');
  }
}
