/**
 * `npx edgebase plugins` — Plugin management commands.
 *
 * With explicit import pattern, plugin info comes from edgebase.config.ts
 * rather than node_modules scanning.
 */
import { Command } from 'commander';
import { createInterface } from 'node:readline';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import chalk from 'chalk';
import { raiseCliError, raiseNeedsInput } from '../lib/agent-contract.js';
import { isJson, isNonInteractive } from '../lib/cli-context.js';
import { loadConfigSafe } from '../lib/load-config.js';
import { fetchWithTimeout } from '../lib/fetch-with-timeout.js';
import { resolveServiceKey, resolveServerUrl } from '../lib/resolve-options.js';
import { enumerateDOsViaCFAPI, getCFNamespaces, type CloudflareAPIOptions } from './backup.js';

const FULL_CONFIG_EVAL = { allowRegexFallback: false } as const;

interface PluginsAPIOptions {
  url: string;
  serviceKey: string;
}

interface DOInfo {
  doName: string;
  type: 'database' | 'auth';
  namespace: 'DATABASE' | 'AUTH';
}

interface CleanupResponse {
  ok: boolean;
  prefix: string;
  target: { namespace?: string; id?: string; doName?: string } | null;
  removed: {
    tables: string[];
    metaKeys: string[];
  };
}

export const pluginsCommand = new Command('plugins').description('Plugin management');

function formatTemplate(template: Record<string, unknown>): string[] {
  return JSON.stringify(template, null, 2)
    .split('\n')
    .map((line) => chalk.dim(`      ${line}`));
}

function resolveOptions(options: { url?: string; serviceKey?: string }): PluginsAPIOptions {
  return {
    url: resolveServerUrl(options),
    serviceKey: resolveServiceKey(options),
  };
}

async function apiCall<T>(opts: PluginsAPIOptions, path: string, body?: unknown): Promise<T> {
  const url = `${opts.url.replace(/\/$/, '')}/admin/api/backup${path}`;
  const resp = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-EdgeBase-Service-Key': opts.serviceKey,
    },
    body: JSON.stringify(body ?? {}),
  });

  if (!resp.ok) {
    throw new Error(`API error (${resp.status}): ${await resp.text()}`);
  }

  return resp.json() as Promise<T>;
}

async function confirmCleanup(prefix: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    rl.question(
      `This will permanently delete data for '${prefix}'. Continue? (y/N): `,
      (answer) => {
        rl.close();
        resolve(['y', 'yes'].includes(answer.trim().toLowerCase()));
      },
    );
  });
}

function readProjectConfig(projectDir: string): {
  namespaces: string[];
  configuredPluginNames: string[];
} {
  const configPath = join(projectDir, 'edgebase.config.ts');
  if (!existsSync(configPath)) {
    return { namespaces: [], configuredPluginNames: [] };
  }

  const config = loadConfigSafe(configPath, projectDir, FULL_CONFIG_EVAL);
  const databases = (config.databases ?? {}) as Record<string, unknown>;
  const plugins = Array.isArray(config.plugins) ? (config.plugins as Array<{ name?: string }>) : [];

  return {
    namespaces: Array.from(new Set(['shared', ...Object.keys(databases)])).sort(),
    configuredPluginNames: plugins
      .map((plugin) => plugin.name)
      .filter((name): name is string => typeof name === 'string'),
  };
}

async function resolveDatabaseDOs(
  api: PluginsAPIOptions,
  cf: CloudflareAPIOptions,
): Promise<DOInfo[]> {
  const namespaces = await getCFNamespaces(cf);
  const hexIds: string[] = [];

  for (const namespace of namespaces) {
    const ids = await enumerateDOsViaCFAPI(cf, namespace.id);
    hexIds.push(...ids);
  }

  const result = await apiCall<{ dos: DOInfo[]; total: number }>(api, '/list-dos', { hexIds });
  return result.dos.filter((item) => item.type === 'database');
}

// ─── edgebase plugins list ───

pluginsCommand
  .command('list')
  .description('List installed EdgeBase plugins')
  .action(async () => {
    const projectDir = resolve('.');
    const configPath = join(projectDir, 'edgebase.config.ts');

    if (!existsSync(configPath)) {
      console.error(chalk.red('✗'), 'edgebase.config.ts not found.');
      return;
    }

    try {
      const config = loadConfigSafe(configPath, projectDir, FULL_CONFIG_EVAL);
      const plugins = config.plugins;

      if (!plugins || !Array.isArray(plugins) || plugins.length === 0) {
        console.log(chalk.dim('No EdgeBase plugins configured.'));
        console.log();
        console.log(chalk.dim('Add plugins to edgebase.config.ts:'));
        console.log(chalk.dim("  import { myPlugin } from 'my-plugin';"));
        console.log(chalk.dim('  export default defineConfig({'));
        console.log(chalk.dim('    plugins: [ myPlugin({ ... }) ],'));
        console.log(chalk.dim('  });'));
        return;
      }

      console.log(chalk.blue(`📦 ${plugins.length} plugin(s) configured:\n`));

      for (const plugin of plugins) {
        const versionStr = plugin.version ? chalk.dim(` v${plugin.version}`) : '';
        const apiVersionStr = plugin.pluginApiVersion
          ? chalk.dim(` api v${plugin.pluginApiVersion}`)
          : '';
        console.log(
          `  ${chalk.green('•')} ${chalk.bold(plugin.name)}${versionStr}${apiVersionStr}`,
        );
        if (plugin.manifest?.description) {
          console.log(`    ${chalk.dim(plugin.manifest.description)}`);
        }

        if (plugin.tables) {
          const tableNames = Object.keys(plugin.tables);
          console.log(`    Tables: ${tableNames.map((t: string) => chalk.cyan(t)).join(', ')}`);
        }

        if (plugin.functions) {
          const funcNames = Object.keys(plugin.functions);
          console.log(`    Functions: ${funcNames.map((f: string) => chalk.cyan(f)).join(', ')}`);
        }

        if (plugin.hooks) {
          const hookEvents = Object.keys(plugin.hooks);
          console.log(`    Hooks: ${hookEvents.map((h: string) => chalk.dim(h)).join(', ')}`);
        }

        const lifecycle: string[] = [];
        if (plugin.onInstall) lifecycle.push('onInstall');
        if (plugin.migrations) {
          lifecycle.push(`migrations(${Object.keys(plugin.migrations).length})`);
        }
        if (lifecycle.length > 0) {
          console.log(
            `    Lifecycle: ${lifecycle.map((l: string) => chalk.magenta(l)).join(', ')}`,
          );
        }

        if (plugin.manifest?.configTemplate) {
          console.log('    Config Template:');
          for (const line of formatTemplate(plugin.manifest.configTemplate)) {
            console.log(line);
          }
        }

        if (plugin.manifest?.docsUrl) {
          console.log(`    Docs: ${chalk.blue(plugin.manifest.docsUrl)}`);
        }

        console.log();
      }
    } catch {
      console.error(chalk.red('✗'), 'Failed to read edgebase.config.ts.');
      console.log(chalk.dim('  Check for syntax errors or missing dependencies.'));
    }
  });

// ─── edgebase plugins cleanup ───

pluginsCommand
  .command('cleanup <prefix>')
  .description('Remove namespaced data for a removed plugin')
  .option('--url <url>', 'Worker URL (or EDGEBASE_URL env)')
  .option('--service-key <key>', 'Service Key (or EDGEBASE_SERVICE_KEY env)')
  .option(
    '--account-id <id>',
    'Cloudflare Account ID for Edge Durable Object enumeration (or CLOUDFLARE_ACCOUNT_ID env)',
  )
  .option(
    '--api-token <token>',
    'Cloudflare API Token for Edge Durable Object enumeration (or CLOUDFLARE_API_TOKEN env)',
  )
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(
    async (
      rawPrefix: string,
      options: {
        url?: string;
        serviceKey?: string;
        accountId?: string;
        apiToken?: string;
        yes?: boolean;
      },
    ) => {
      const prefix = rawPrefix.trim().replace(/\/+$/, '');
      if (!prefix) {
        raiseCliError({
          code: 'plugin_prefix_required',
          field: 'prefix',
          message: 'Plugin prefix is required.',
        });
      }

      const projectDir = resolve('.');
      let namespaces: string[] = [];
      let configuredPluginNames: string[] = [];

      try {
        const projectConfig = readProjectConfig(projectDir);
        namespaces = projectConfig.namespaces;
        configuredPluginNames = projectConfig.configuredPluginNames;
      } catch (err) {
        console.log(
          chalk.yellow('⚠'),
          `Failed to read edgebase.config.ts: ${(err as Error).message}`,
        );
        console.log(chalk.dim('  Continuing with API-only cleanup.'));
      }

      if (configuredPluginNames.includes(prefix)) {
        raiseCliError({
          code: 'plugin_still_configured',
          message: `Plugin '${prefix}' is still configured in edgebase.config.ts. Remove it from config before running cleanup.`,
        });
      }

      if (!options.yes) {
        if (!process.stdin.isTTY || isNonInteractive()) {
          raiseNeedsInput({
            code: 'plugin_cleanup_confirmation_required',
            field: 'yes',
            message: `Plugin cleanup for '${prefix}' requires explicit confirmation before deleting data.`,
            hint: 'Review the cleanup target, then rerun with --yes.',
            choices: [{
              label: 'Approve plugin cleanup',
              value: 'yes',
              args: ['--yes'],
              hint: 'Use only after confirming the prefix and namespaces.',
            }],
          });
        }

        if (!isJson()) {
          console.log(chalk.yellow('⚠'), 'This permanently deletes plugin-managed data.');
          console.log(chalk.dim(`  Target prefix: ${prefix}`));
          if (namespaces.length > 0) {
            console.log(chalk.dim(`  Current namespaces: ${namespaces.join(', ')}`));
          }
          console.log();
        }

        const confirmed = await confirmCleanup(prefix);
        if (!confirmed) {
          console.log(chalk.dim('Cleanup cancelled.'));
          return;
        }
      }

      const api = resolveOptions(options);
      const accountId = options.accountId || process.env.CLOUDFLARE_ACCOUNT_ID;
      const apiToken = options.apiToken || process.env.CLOUDFLARE_API_TOKEN;
      const hasEdgeEnumeration = !!(accountId && apiToken);

      const cleanupResults: CleanupResponse[] = [];
      const failures: Array<{ target: string; error: string }> = [];
      const seenTargets = new Set<string>();

      async function cleanupTarget(
        label: string,
        body: { prefix: string; namespace?: string; id?: string; doName?: string },
      ) {
        if (seenTargets.has(label)) return;
        seenTargets.add(label);

        try {
          const result = await apiCall<CleanupResponse>(api, '/cleanup-plugin', body);
          cleanupResults.push(result);
          const removedTables = result.removed.tables.length;
          console.log(
            `${chalk.green('✓')} ${label} — removed ${removedTables} table${removedTables === 1 ? '' : 's'}`,
          );
        } catch (err) {
          failures.push({ target: label, error: (err as Error).message });
          console.log(chalk.red('✗'), `${label} — ${(err as Error).message}`);
        }
      }

      console.log(chalk.blue(`🧹 Cleaning plugin data for ${prefix}...`));

      for (const namespace of namespaces) {
        await cleanupTarget(`namespace:${namespace}`, { prefix, namespace });
      }

      if (hasEdgeEnumeration) {
        console.log(chalk.dim('  Discovering Durable Objects via Cloudflare API...'));
        try {
          const cf: CloudflareAPIOptions = { accountId: accountId!, apiToken: apiToken! };
          const dos = await resolveDatabaseDOs(api, cf);
          for (const doInfo of dos) {
            await cleanupTarget(`do:${doInfo.doName}`, { prefix, doName: doInfo.doName });
          }
        } catch (err) {
          failures.push({
            target: 'edge-do-enumeration',
            error: (err as Error).message,
          });
          console.log(chalk.yellow('⚠'), `Edge DO enumeration failed: ${(err as Error).message}`);
        }
      } else {
        console.log(
          chalk.dim(
            '  Cloudflare account credentials not provided; dynamic Durable Object instances cannot be discovered automatically.',
          ),
        );
      }

      if (cleanupResults.length === 0) {
        await cleanupTarget('plugin-version-meta', { prefix });
      }

      const removedTables = new Set(cleanupResults.flatMap((result) => result.removed.tables));
      const removedMetaKeys = new Set(cleanupResults.flatMap((result) => result.removed.metaKeys));

      console.log();
      console.log(
        chalk.green('Cleanup summary:'),
        `${removedTables.size} table${removedTables.size === 1 ? '' : 's'}, ${removedMetaKeys.size} metadata key${removedMetaKeys.size === 1 ? '' : 's'}`,
      );

      if (!hasEdgeEnumeration) {
        console.log(
          chalk.dim(
            'Dynamic DO-backed namespaces require --account-id and --api-token for complete cleanup on Cloudflare Edge.',
          ),
        );
      }

      if (failures.length > 0) {
        raiseCliError({
          code: 'plugin_cleanup_partial_failure',
          message: `Plugin cleanup completed with ${failures.length} failure(s).`,
          details: {
            prefix,
            failures,
            removedTables: Array.from(removedTables),
            removedMetaKeys: Array.from(removedMetaKeys),
          },
        });
      }

      if (isJson()) {
        console.log(JSON.stringify({
          status: 'success',
          prefix,
          removedTables: Array.from(removedTables),
          removedMetaKeys: Array.from(removedMetaKeys),
          edgeEnumerationUsed: hasEdgeEnumeration,
        }));
      }
    },
  );
