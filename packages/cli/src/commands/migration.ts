import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import { raiseCliError } from '../lib/agent-contract.js';
import { isJson } from '../lib/cli-context.js';


// ─── Config parsing (lightweight) ───

/**
 * Extract the highest migration version for a given table
 * by parsing edgebase.config.ts with regex.
 */
function getMaxMigrationVersion(configPath: string, tableName: string): number {
  const content = fs.readFileSync(configPath, 'utf-8');

  // Find the table block
  const tableRegex = new RegExp(
    `${tableName}\\s*:\\s*\\{[\\s\\S]*?migrations\\s*:\\s*\\[([\\s\\S]*?)\\]`,
    'm',
  );
  const match = tableRegex.exec(content);
  if (!match) return 0;

  // Find all version numbers
  const versionRegex = /version\s*:\s*(\d+)/g;
  let maxVersion = 0;
  let vMatch;
  while ((vMatch = versionRegex.exec(match[1])) !== null) {
    const v = parseInt(vMatch[1], 10);
    if (v > maxVersion) maxVersion = v;
  }

  return maxVersion;
}

function resolveConfigPath(cwd: string): string | null {
  for (const name of ['edgebase.config.ts', 'edgebase.config.js']) {
    const p = path.join(cwd, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}


/** Generate a migration skeleton snippet string. */
function generateMigrationSnippet(
  version: number,
  name: string,
  tableName?: string,
): string {
  return `{
  version: ${version},
  description: '${name}',
  up: \`
    -- Write your SQL migration here
    -- Supported DDL: ALTER TABLE, CREATE INDEX, DROP COLUMN (SQLite 3.35.0+)
    -- RENAME COLUMN (SQLite 3.25.0+)
    -- Example:
    -- ALTER TABLE ${tableName ?? 'your_table'} ADD COLUMN newField TEXT DEFAULT '';
  \`,
},`;
}

/** Exported for testing */
export const _internals = { getMaxMigrationVersion, resolveConfigPath, generateMigrationSnippet };

// ─── Command ───

export const migrationCommand = new Command('migration')
  .alias('mg')
  .description('Manage schema migrations');

migrationCommand
  .command('create <name>')
  .description('Generate a migration skeleton snippet')
  .option('-c, --table <name>', 'Target table name')
  .action((name: string, options: { table?: string }) => {
    const cwd = process.cwd();
    const configPath = resolveConfigPath(cwd);

    if (!configPath) {
      raiseCliError({
        code: 'migration_config_not_found',
        message: 'edgebase.config.ts not found. Run this command from your EdgeBase project root.',
      });
    }

    const tableName = options.table;
    let nextVersion = 2;

    if (tableName) {
      const maxVersion = getMaxMigrationVersion(configPath, tableName);
      nextVersion = maxVersion + 1;
      console.log(
        `📋 Table "${tableName}" — current max version: ${maxVersion}`,
      );
    } else {
      console.log('📋 No table specified. Generating generic skeleton.');
      console.log('   Use --table <name> for auto version numbering.');
    }

    // Generate migration snippet
    const snippet = generateMigrationSnippet(nextVersion, name, tableName);

    if (isJson()) {
      console.log(JSON.stringify({
        status: 'success',
        version: nextVersion,
        table: tableName ?? null,
        snippet,
      }));
      return;
    }

    console.log(`\n✅ Migration snippet (version ${nextVersion}):\n`);
    console.log('Add this to your edgebase.config.ts → databases.shared.tables.' +
      `${tableName ?? '<tableName>'} → migrations:\n`);
    console.log('```typescript');
    console.log(snippet);
    console.log('```');

    console.log('\n📝 Reminder: SQLite DDL support varies by version:');
    console.log('   • RENAME COLUMN — SQLite 3.25.0+ (Cloudflare: ✅)');
    console.log('   • DROP COLUMN   — SQLite 3.35.0+ (Cloudflare: ✅)');
    console.log(
      '   • Recommended: Use 2-step migration for destructive changes',
    );
    console.log('     (ADD new → update code → DROP old)');
  });

// migrate warm (not yet implemented — hidden from help)
migrationCommand
  .command('warm', { hidden: true })
  .description('Batch warming for Isolated DO migrations')
  .action(() => {
    console.log(chalk.yellow('⚠'), 'This feature is not yet implemented.');
    console.log('   Each Durable Object applies migrations lazily on first request.');
    console.log('   Batch warming will be available in a future release.');
  });
