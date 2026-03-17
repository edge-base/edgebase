import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import { raiseCliError, raiseNeedsInput } from '../lib/agent-contract.js';
import { isJson, isQuiet } from '../lib/cli-context.js';
import { fetchWithTimeout } from '../lib/fetch-with-timeout.js';
import { loadConfigSafe } from '../lib/load-config.js';
import { extractDatabases } from '../lib/deploy-shared.js';
import { resolveOptionalServiceKey, resolveServerUrl } from '../lib/resolve-options.js';

const FULL_CONFIG_EVAL = { allowRegexFallback: false } as const;

interface SeedRecord {
  [key: string]: unknown;
}

interface SeedData {
  [tableName: string]: SeedRecord[];
}

interface SeedDbBlockMeta {
  provider?: string;
  instance?: boolean;
  access?: { canCreate?: unknown; access?: unknown };
  tables?: unknown;
}

export interface ResolvedSeedTarget {
  namespace: string;
  instanceId?: string;
}

function isRetryableSeedFailure(status: number, bodyText: string): boolean {
  if (status === 429 || status >= 500) return true;
  if (status !== 404) return false;
  const normalized = bodyText.trim().toLowerCase();
  return normalized.startsWith('<!doctype html') || normalized.startsWith('<html');
}

async function createSeedRecord(
  url: string,
  headers: Record<string, string>,
  record: SeedRecord,
): Promise<{ ok: true } | { ok: false; status: number; body: string }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(record),
      });

      if (response.ok) {
        return { ok: true };
      }

      const body = await response.text();
      if (!isRetryableSeedFailure(response.status, body) || attempt === 2) {
        return { ok: false, status: response.status, body };
      }
    } catch (error) {
      if (attempt === 2) {
        throw error;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 1000));
  }

  return { ok: false, status: 500, body: 'Seed retry loop exhausted.' };
}

function isDynamicSeedDbBlock(dbBlock: SeedDbBlockMeta): boolean {
  if (dbBlock.instance) return true;
  if (dbBlock.access && typeof dbBlock.access === 'object') return true;
  return false;
}

function getSeedDatabases(
  config?: Record<string, unknown> | null,
): Record<string, SeedDbBlockMeta> {
  const databases = config ? extractDatabases(config) : null;
  return (databases ?? {}) as Record<string, SeedDbBlockMeta>;
}

export function listSeedNamespaces(config?: Record<string, unknown> | null): string[] {
  return Object.keys(getSeedDatabases(config));
}

export function inferDefaultSeedNamespace(config?: Record<string, unknown> | null): string | null {
  const staticNamespaces = Object.entries(getSeedDatabases(config))
    .filter(([, dbBlock]) => !isDynamicSeedDbBlock(dbBlock))
    .map(([namespace]) => namespace);

  return staticNamespaces.length === 1 ? staticNamespaces[0] : null;
}

export function buildSeedTableBasePath(namespace: string, instanceId?: string): string {
  const encodedNamespace = encodeURIComponent(namespace);
  if (instanceId) {
    return `/api/db/${encodedNamespace}/${encodeURIComponent(instanceId)}/tables`;
  }
  return `/api/db/${encodedNamespace}/tables`;
}

function resolveSeedTarget(
  options: { namespace?: string; id?: string },
  config?: Record<string, unknown> | null,
): ResolvedSeedTarget {
  const databases = getSeedDatabases(config);
  const availableNamespaces = Object.keys(databases);
  let namespace = options.namespace;

  if (options.id && !namespace) {
    if (availableNamespaces.length === 1) {
      namespace = availableNamespaces[0];
    } else {
      throw new Error('`--id` requires `--namespace` when more than one DB block exists.');
    }
  }

  if (!namespace) {
    const inferred = inferDefaultSeedNamespace(config);
    if (inferred) {
      namespace = inferred;
    } else if (availableNamespaces.length > 0) {
      throw new Error(
        'Could not infer a single seed namespace from edgebase.config.ts. Use `--namespace <name>`.',
      );
    } else {
      namespace = 'shared';
    }
  }

  const dbBlock = databases[namespace];
  if (dbBlock) {
    const dynamic = isDynamicSeedDbBlock(dbBlock);
    if (dynamic && !options.id) {
      throw new Error(
        `DB block '${namespace}' is dynamic and requires an instance id. Use \`--id <instanceId>\`.`,
      );
    }
    if (!dynamic && options.id) {
      throw new Error(
        `DB block '${namespace}' is single-instance. Remove \`--id\` or choose a dynamic namespace.`,
      );
    }
  }

  return {
    namespace,
    instanceId: options.id,
  };
}

function toSeedTargetIssue(
  error: Error,
  config?: Record<string, unknown> | null,
): never {
  const namespaces = listSeedNamespaces(config);

  if (/Use `--namespace <name>`/.test(error.message) && namespaces.length > 0) {
    raiseNeedsInput({
      code: 'seed_namespace_required',
      field: 'namespace',
      message: error.message,
      hint: 'Rerun with --namespace <name>.',
      choices: namespaces.map((namespace) => ({
        label: namespace,
        value: namespace,
        args: ['--namespace', namespace],
      })),
    });
  }

  if (/requires an instance id/.test(error.message)) {
    raiseNeedsInput({
      code: 'seed_instance_id_required',
      field: 'id',
      message: error.message,
      hint: 'Rerun with --id <instanceId>.',
    });
  }

  raiseCliError({
    code: 'seed_target_resolution_failed',
    message: error.message,
    hint: 'Provide --namespace <name> and, for dynamic DB blocks, --id <instanceId>.',
  });
}

export const _internals = {
  buildSeedTableBasePath,
  inferDefaultSeedNamespace,
  listSeedNamespaces,
  resolveSeedTarget,
};

export const seedCommand = new Command('seed')
  .description('Load seed data into local dev server')
  .option('--file <path>', 'Path to seed data file', 'edgebase.seed.json')
  .option('--url <url>', 'Server URL (default: EDGEBASE_URL or http://localhost:8787)')
  .option('--namespace <ns>', 'DB block namespace to seed')
  .option('--id <instanceId>', 'Instance id for dynamic DB blocks')
  .option('--reset', 'Delete existing data before seeding')
  .option('--service-key <key>', 'Service Key for authenticated requests (auto-resolve when available)')
  .action(
    async (options: {
      file: string;
      url?: string;
      namespace?: string;
      id?: string;
      reset?: boolean;
      serviceKey?: string;
    }) => {
      const cwd = process.cwd();
      const seedPath = path.resolve(cwd, options.file);
      const warnings: string[] = [];

      if (!fs.existsSync(seedPath)) {
        raiseCliError({
          code: 'seed_file_not_found',
          message: `Seed file not found: ${options.file}`,
          hint: 'Create edgebase.seed.json or rerun with --file <path>.',
        });
      }

      let seedData: SeedData;
      try {
        const content = fs.readFileSync(seedPath, 'utf-8');
        seedData = JSON.parse(content) as SeedData;
      } catch (err) {
        raiseCliError({
          code: 'seed_file_parse_failed',
          message: `Failed to parse seed file: ${(err as Error).message}`,
          hint: 'Ensure the seed file contains valid JSON with table names mapped to record arrays.',
        });
      }

      const sigintHandler = () => { process.exit(130); };
      process.on('SIGINT', sigintHandler);

      try {
        let configJson: Record<string, unknown> | null = null;
        const configPath = path.join(cwd, 'edgebase.config.ts');
        if (fs.existsSync(configPath)) {
          try {
            configJson = loadConfigSafe(configPath, cwd, FULL_CONFIG_EVAL);
          } catch (err) {
            if (!options.namespace) {
              raiseCliError({
                code: 'seed_config_load_failed',
                message: `Failed to infer seed namespace: ${(err as Error).message}`,
                hint: 'Pass --namespace <name> to seed without loading edgebase.config.ts.',
              });
            }
            warnings.push(`Skipping config-based namespace inference: ${(err as Error).message}`);
          }
        }

        let target: ResolvedSeedTarget;
        try {
          target = resolveSeedTarget(options, configJson);
        } catch (err) {
          toSeedTargetIssue(err as Error, configJson);
        }

        const baseUrl = resolveServerUrl({ url: options.url }, false) || 'http://localhost:8787';
        const tableBasePath = buildSeedTableBasePath(target.namespace, target.instanceId);
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };

        const serviceKey = resolveOptionalServiceKey({ serviceKey: options.serviceKey });
        if (serviceKey) {
          headers['X-EdgeBase-Service-Key'] = serviceKey;
        }

        try {
          await fetchWithTimeout(`${baseUrl}/api/health`, undefined, 5000);
        } catch {
          raiseCliError({
            code: 'seed_server_unreachable',
            message: `Cannot connect to dev server at ${baseUrl}`,
            hint: 'Make sure `npx edgebase dev` is running or rerun with --url <server-url>.',
          });
        }

        if (!isQuiet()) {
          console.log(`🌱 Seeding from: ${options.file}`);
          console.log(`   Server: ${baseUrl}`);
          console.log(`   Namespace: ${target.namespace}${target.instanceId ? ` (${target.instanceId})` : ''}`);
          console.log('');
        }

        let totalCreated = 0;
        let totalFailed = 0;
        const failures: Array<{ table: string; message: string }> = [];

        for (const [tableName, records] of Object.entries(seedData)) {
          if (!Array.isArray(records)) {
            const warning = `Skipping "${tableName}" - expected an array`;
            warnings.push(warning);
            if (!isQuiet()) {
              console.warn(chalk.yellow('⚠'), warning);
            }
            continue;
          }

          if (options.reset) {
            if (!isQuiet()) {
              console.log(`   🗑️  Resetting "${tableName}"...`);
            }
            try {
              const listRes = await fetchWithTimeout(
                `${baseUrl}${tableBasePath}/${encodeURIComponent(tableName)}?limit=1000`,
                { headers },
              );
              if (listRes.ok) {
                const data = (await listRes.json()) as {
                  data: Array<{ id: string }>;
                };
                for (const item of data.data ?? []) {
                  await fetchWithTimeout(
                    `${baseUrl}${tableBasePath}/${encodeURIComponent(tableName)}/${encodeURIComponent(item.id)}`,
                    { method: 'DELETE', headers },
                  );
                }
              }
            } catch {
              const warning = `Reset failed for "${tableName}" - continuing`;
              warnings.push(warning);
              if (!isQuiet()) {
                console.warn('  ', chalk.yellow('⚠'), warning);
              }
            }
          }

          if (!isQuiet()) {
            console.log(`   📝 Seeding "${tableName}" — ${records.length} records`);
          }

          for (const record of records) {
            try {
              const res = await createSeedRecord(
                `${baseUrl}${tableBasePath}/${encodeURIComponent(tableName)}`,
                headers,
                record,
              );

              if (res.ok) {
                totalCreated++;
              } else {
                totalFailed++;
                const message = `Failed to create record in "${tableName}": ${res.status} ${res.body.substring(0, 100)}`;
                failures.push({ table: tableName, message });
                if (!isQuiet()) {
                  console.warn('  ', chalk.yellow('⚠'), message);
                }
              }
            } catch (err) {
              totalFailed++;
              const message = `Network error for "${tableName}": ${(err as Error).message}`;
              failures.push({ table: tableName, message });
              if (!isQuiet()) {
                console.warn('  ', chalk.yellow('⚠'), message);
              }
            }
          }
        }

        if (totalFailed > 0) {
          raiseCliError({
            code: 'seed_partial_failure',
            message: `Seeding completed with ${totalFailed} failed record(s).`,
            hint: 'Inspect the failing tables, fix the data or schema mismatch, and rerun the seed command.',
            details: {
              created: totalCreated,
              failed: totalFailed,
              namespace: target.namespace,
              instanceId: target.instanceId,
              warnings,
              failures,
            },
          });
        }

        if (isJson()) {
          console.log(JSON.stringify({
            status: 'success',
            file: seedPath,
            serverUrl: baseUrl,
            namespace: target.namespace,
            instanceId: target.instanceId,
            created: totalCreated,
            failed: totalFailed,
            warnings,
          }));
          return;
        }

        console.log('');
        console.log(chalk.green('✅'), `Seeding complete: ${totalCreated} created, ${totalFailed} failed`);
      } finally {
        process.off('SIGINT', sigintHandler);
      }
    },
  );
