/**
 * migrate command — Data migration between providers.
 *
 * Orchestrates automatic data migration when database provider changes
 * (D1 ↔ PostgreSQL). Uses the Worker's Admin Backup API for dump/restore.
 *
 * Usage:
 *   npx edgebase migrate                    # Auto-detect changes from snapshot
 *   npx edgebase migrate --scope auth       # Migrate auth tables only
 *   npx edgebase migrate --scope data       # Migrate data namespaces only
 *   npx edgebase migrate --dry-run          # Preview without executing
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { resolve, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { loadConfigSafe } from '../lib/load-config.js';
import {
  buildSnapshot,
  loadSnapshot,
  saveSnapshot,
  detectProviderChanges,
  detectAuthProviderChange,
  type ProviderChange,
} from '../lib/schema-check.js';
import {
  executeMigration,
  type MigrationOptions,
} from '../lib/migrator.js';
import { isCliStructuredError, raiseCliError, raiseNeedsInput } from '../lib/agent-contract.js';
import { isJson, isQuiet } from '../lib/cli-context.js';
import { resolveServiceKey } from '../lib/resolve-options.js';
import { _internals } from './deploy.js';

const { extractDatabases } = _internals;
const FULL_CONFIG_EVAL = { allowRegexFallback: false } as const;

type ConfigNamespaceResolution = 'loaded' | 'missing' | 'failed';

export function listConfigDataNamespaces(config?: Record<string, unknown> | null): string[] {
  const databases = config ? extractDatabases(config) : null;
  return databases ? Object.keys(databases) : [];
}

export function resolveMigrationTargets(input: {
  scope: MigrationOptions['scope'];
  namespace?: string;
  configNamespaces: string[];
  configState: ConfigNamespaceResolution;
}): Pick<MigrationOptions, 'scope' | 'namespaces'> {
  if (input.namespace) {
    if (input.scope === 'auth') {
      throw new Error('`--namespace` cannot be used with `--scope auth`.');
    }
    return {
      scope: 'data',
      namespaces: [input.namespace],
    };
  }

  if (input.scope === 'auth') {
    return { scope: 'auth' };
  }

  if (input.configNamespaces.length > 0) {
    return {
      scope: input.scope,
      namespaces: input.configNamespaces,
    };
  }

  if (input.configState === 'loaded') {
    if (input.scope === 'all') {
      return { scope: 'auth' };
    }
    throw new Error(
      'No data namespaces found in edgebase.config.ts. Use `--scope auth` or `--namespace <name>`.',
    );
  }

  throw new Error(
    'Could not determine data namespaces. Pass `--namespace <name>` or run the command from your project root with a readable edgebase.config.ts.',
  );
}

export const _migrateInternals = {
  listConfigDataNamespaces,
  resolveMigrationTargets,
};

export const migrateCommand = new Command('migrate')
  .description('Migrate data between database providers')
  .option('--scope <scope>', 'Scope: auth, data, or all (default: auto-detect)', undefined)
  .option('--namespace <ns>', 'Specific data namespace to migrate')
  .option('--dry-run', 'Show what would be migrated without executing')
  .option('--url <url>', 'Server URL (default: EDGEBASE_URL)')
  .option('--service-key <key>', 'Service Key (default: auto-resolve)')
  .action(async (options: {
    scope?: string;
    namespace?: string;
    dryRun?: boolean;
    url?: string;
    serviceKey?: string;
  }) => {
    const projectDir = resolve('.');
    const configPath = join(projectDir, 'edgebase.config.ts');
    const hasConfigFile = existsSync(configPath);
    const warnings: string[] = [];

    if (!isQuiet()) {
      console.log(chalk.blue('EdgeBase Data Migration'));
      console.log();
    }

    // ─── Resolve Server URL ───
    let serverUrl = options.url ?? process.env.EDGEBASE_URL ?? '';
    if (!serverUrl) {
      // Try to derive from wrangler.toml
      const wranglerFile = join(projectDir, 'wrangler.toml');
      if (existsSync(wranglerFile)) {
        const tomlContent = readFileSync(wranglerFile, 'utf-8');
        const nameMatch = tomlContent.match(/^name\s*=\s*"([^"]+)"/m);
        if (nameMatch) serverUrl = `https://${nameMatch[1]}.workers.dev`;
      }
    }
    if (!serverUrl) {
      raiseNeedsInput({
        code: 'migration_url_required',
        field: 'url',
        message: 'A server URL is required before migration can continue.',
        hint: 'Provide --url <worker-url>, set EDGEBASE_URL, or run from a project with a wrangler.toml name that can be inferred automatically.',
        choices: [
          {
            label: 'Use local dev server',
            value: 'local',
            args: ['--url', 'http://localhost:8787'],
          },
          {
            label: 'Use deployed Worker URL',
            value: 'workers-dev',
            args: ['--url', 'https://<name>.workers.dev'],
          },
        ],
      });
    }
    serverUrl = serverUrl.replace(/\/$/, '');

    // ─── Resolve Service Key ───
    const serviceKey = resolveServiceKey({ serviceKey: options.serviceKey });

    let configJson: Record<string, unknown> | null = null;
    let configLoadError: Error | null = null;
    let configNamespaces: string[] = [];

    if (hasConfigFile) {
      try {
        configJson = loadConfigSafe(configPath, projectDir, FULL_CONFIG_EVAL);
        configNamespaces = listConfigDataNamespaces(configJson);
      } catch (err) {
        configLoadError = err as Error;
      }
    }

    // ─── Auto-detect Changes from Snapshot ───
    let scope: MigrationOptions['scope'] = (options.scope as MigrationOptions['scope']) ?? 'all';
    let namespaces: string[] | undefined;
    const detectedChanges: ProviderChange[] = [];

    if (!options.scope && configJson) {
      try {
        const databases = extractDatabases(configJson);

        if (databases && Object.keys(databases).length > 0) {
          const authProvider = (configJson.auth as { provider?: string } | undefined)?.provider;
          const currentSnapshot = buildSnapshot(
            databases as Parameters<typeof buildSnapshot>[0],
            authProvider,
          );
          const savedSnapshot = loadSnapshot(projectDir);

          if (savedSnapshot) {
            const providerChanges = detectProviderChanges(savedSnapshot, currentSnapshot);
            const authChange = detectAuthProviderChange(savedSnapshot, currentSnapshot);

            if (authChange) detectedChanges.push(authChange);
            detectedChanges.push(...providerChanges);

            if (detectedChanges.length > 0) {
              if (!isQuiet()) {
                console.log(chalk.cyan('  Detected provider changes:'));
                for (const pc of detectedChanges) {
                  const label = pc.namespace === '_auth' ? 'Auth' : pc.namespace;
                  console.log(chalk.cyan(`    • ${label}: ${pc.oldProvider} → ${pc.newProvider}`));
                }
                console.log();
              }

              // Auto-determine scope
              const hasAuth = detectedChanges.some(c => c.namespace === '_auth');
              const dataChanges = detectedChanges.filter(c => c.namespace !== '_auth');

              if (hasAuth && dataChanges.length > 0) {
                scope = 'all';
                namespaces = dataChanges.map(c => c.namespace);
              } else if (hasAuth) {
                scope = 'auth';
              } else {
                scope = 'data';
                namespaces = dataChanges.map(c => c.namespace);
              }
            } else {
              if (isJson()) {
                console.log(JSON.stringify({
                  status: 'success',
                  changed: false,
                  scope: null,
                  namespaces: [],
                  warnings,
                }));
                return;
              }

              console.log(chalk.green('✓'), 'No provider changes detected.');
              console.log(chalk.dim('  Config matches the saved schema snapshot.'));
              console.log();
              console.log(chalk.dim('  To force migration, use --scope:'));
              console.log(chalk.dim('    npx edgebase migrate --scope auth'));
              console.log(chalk.dim('    npx edgebase migrate --scope data'));
              console.log(chalk.dim('    npx edgebase migrate --scope all'));
              return;
            }
          }
        }
      } catch (err) {
        configLoadError = err as Error;
      }
    }

    if (!options.scope && configLoadError) {
      warnings.push(`Skipping config auto-detection: ${configLoadError.message}`);
      if (!isQuiet()) {
        console.log(chalk.yellow('⚠'), `Skipping config auto-detection: ${configLoadError.message}`);
        console.log(chalk.dim('  Use --scope/--namespace explicitly if config evaluation depends on unavailable local modules.'));
      }
    }

    if (!namespaces) {
      try {
        const resolvedTargets = resolveMigrationTargets({
          scope,
          namespace: options.namespace,
          configNamespaces,
          configState: configJson ? 'loaded' : hasConfigFile ? 'failed' : 'missing',
        });
        scope = resolvedTargets.scope;
        namespaces = resolvedTargets.namespaces;
      } catch (err) {
        raiseCliError({
          code: 'migration_target_resolution_failed',
          message: (err as Error).message,
          hint: 'Provide --scope auth, --scope data, or --namespace <name> so the CLI knows what to migrate.',
        });
      }
    }

    // ─── Display Migration Info ───
    if (!isQuiet()) {
      console.log(chalk.cyan(`  Server:  ${serverUrl}`));
      console.log(chalk.cyan(`  Scope:   ${scope}`));
      if (namespaces) {
        console.log(chalk.cyan(`  Namespaces: ${namespaces.join(', ')}`));
      }
      if (options.dryRun) {
        console.log(chalk.cyan(`  Mode:    dry-run (preview only)`));
      }
      console.log();
    }

    // ─── Execute Migration ───
    try {
      const result = await executeMigration({
        scope,
        namespaces,
        serverUrl,
        serviceKey,
        dryRun: !!options.dryRun,
      });
      let snapshotUpdated = false;

      if (result.success) {
        if (options.dryRun) {
          if (!isQuiet()) {
            console.log(chalk.dim('  Run without --dry-run to execute the migration.'));
          }
        } else {
          // Update snapshot after successful migration
          if (configJson ?? existsSync(configPath)) {
            try {
              const latestConfig = configJson ?? loadConfigSafe(configPath, projectDir, FULL_CONFIG_EVAL);
              const databases = extractDatabases(latestConfig);
              if (databases && Object.keys(databases).length > 0) {
                const authProvider = (latestConfig.auth as { provider?: string } | undefined)?.provider;
                const newSnapshot = buildSnapshot(
                  databases as Parameters<typeof buildSnapshot>[0],
                  authProvider,
                );
                saveSnapshot(projectDir, newSnapshot);
                snapshotUpdated = true;
                if (!isQuiet()) {
                  console.log(chalk.dim('  Schema snapshot updated.'));
                }
              }
            } catch (err) {
              warnings.push(`Schema snapshot not updated: ${(err as Error).message}`);
              if (!isQuiet()) {
                console.log(chalk.yellow('⚠'), `Schema snapshot not updated: ${(err as Error).message}`);
              }
            }
          }
        }

        if (isJson()) {
          console.log(JSON.stringify({
            status: 'success',
            changed: detectedChanges.length > 0 || Boolean(options.scope),
            scope,
            namespaces: namespaces ?? [],
            serverUrl,
            dryRun: !!options.dryRun,
            detectedChanges,
            snapshotUpdated,
            result,
            warnings,
          }));
        }
      }
    } catch (err) {
      if (isCliStructuredError(err)) throw err;
      raiseCliError({
        code: 'migration_failed',
        message: (err as Error).message,
        hint: 'Ensure the server is running and accessible, verify the service key, and try with --dry-run first to preview.',
        details: {
          scope,
          namespaces: namespaces ?? [],
          serverUrl,
          dryRun: !!options.dryRun,
        },
      });
    }
  });
