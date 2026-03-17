import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import chalk from 'chalk';
import { ensureCloudflareAuth } from '../lib/cf-auth.js';
import {
  getCloudflareDeployManifestPath,
  readCloudflareDeployManifest,
  type CloudflareDeployManifest,
  type CloudflareResourceRecord,
} from '../lib/cloudflare-deploy-manifest.js';
import { parseWranglerResourceConfig } from '../lib/cloudflare-wrangler-resources.js';
import { fetchWithTimeout } from '../lib/fetch-with-timeout.js';
import { raiseCliError, raiseNeedsInput } from '../lib/agent-contract.js';
import { isJson, isNonInteractive } from '../lib/cli-context.js';
import {
  buildLegacyManagedD1DatabaseName,
  buildManagedD1DatabaseName,
} from '../lib/managed-resource-names.js';
import { resolveProjectWorkerName, resolveProjectWorkerUrl } from '../lib/project-runtime.js';
import { resolveOptionalServiceKey } from '../lib/resolve-options.js';
import { wranglerArgs, wranglerCommand } from '../lib/wrangler.js';

interface DestroyResult {
  deleted: string[];
  skipped: string[];
  failures: Array<{ label: string; message: string }>;
}

interface DestroyOptions {
  dryRun?: boolean;
  serviceKey?: string;
  url?: string;
  yes?: boolean;
}

function resolveWorkerNameFromProject(projectDir: string): string {
  return resolveProjectWorkerName(projectDir);
}

function resolveWorkerUrlFromProject(projectDir: string): string {
  return resolveProjectWorkerUrl(projectDir);
}

function resourceKey(resource: Pick<CloudflareResourceRecord, 'type' | 'name' | 'binding' | 'id'>): string {
  return [resource.type, resource.id ?? '', resource.binding ?? '', resource.name].join(':');
}

function mergeDestroyResources(
  manifest: CloudflareDeployManifest | null,
  wranglerContent: string | null,
): CloudflareResourceRecord[] {
  const merged = new Map<string, CloudflareResourceRecord>();

  for (const resource of manifest?.resources ?? []) {
    merged.set(resourceKey(resource), resource);
  }

  if (wranglerContent) {
    const wranglerConfig = parseWranglerResourceConfig(wranglerContent);
    for (const bucket of wranglerConfig.r2Buckets) {
      const key = resourceKey({
        type: 'r2_bucket',
        name: bucket.bucketName,
        binding: bucket.binding,
        id: bucket.bucketName,
      });
      const existing = merged.get(key);
      merged.set(key, {
        type: 'r2_bucket',
        name: bucket.bucketName,
        binding: bucket.binding,
        id: bucket.bucketName,
        managed: true,
        source: existing?.source ?? 'wrangler',
        metadata: {
          ...(existing?.metadata ?? {}),
          ...(bucket.jurisdiction ? { jurisdiction: bucket.jurisdiction } : {}),
        },
      });
    }

    const existingBindings = new Set(
      [...merged.values()].map((r) => `${r.type}:${r.binding ?? ''}`),
    );

    for (const db of wranglerConfig.d1Databases) {
      if (existingBindings.has(`d1_database:${db.binding}`)) continue;
      const key = resourceKey({
        type: 'd1_database',
        name: db.databaseName,
        binding: db.binding,
        id: db.databaseId,
      });
      if (!merged.has(key)) {
        merged.set(key, {
          type: 'd1_database',
          name: db.databaseName,
          binding: db.binding,
          id: db.databaseId,
          managed: true,
          source: 'wrangler',
        });
      }
    }

    for (const kv of wranglerConfig.kvNamespaces) {
      if (existingBindings.has(`kv_namespace:${kv.binding}`)) continue;
      const key = resourceKey({
        type: 'kv_namespace',
        name: kv.binding,
        binding: kv.binding,
        id: kv.id,
      });
      if (!merged.has(key)) {
        merged.set(key, {
          type: 'kv_namespace',
          name: kv.binding,
          binding: kv.binding,
          id: kv.id,
          managed: true,
          source: 'wrangler',
        });
      }
    }

    for (const vec of wranglerConfig.vectorizeIndexes) {
      if (existingBindings.has(`vectorize:${vec.binding}`)) continue;
      const key = resourceKey({
        type: 'vectorize',
        name: vec.indexName,
        binding: vec.binding,
        id: vec.indexName,
      });
      if (!merged.has(key)) {
        merged.set(key, {
          type: 'vectorize',
          name: vec.indexName,
          binding: vec.binding,
          id: vec.indexName,
          managed: true,
          source: 'wrangler',
        });
      }
    }

    for (const hd of wranglerConfig.hyperdriveConfigs) {
      if (existingBindings.has(`hyperdrive:${hd.binding}`)) continue;
      const key = resourceKey({
        type: 'hyperdrive',
        name: hd.binding,
        binding: hd.binding,
        id: hd.id,
      });
      if (!merged.has(key)) {
        merged.set(key, {
          type: 'hyperdrive',
          name: hd.binding,
          binding: hd.binding,
          id: hd.id,
          managed: true,
          source: 'wrangler',
        });
      }
    }
  }

  return Array.from(merged.values());
}

function extractExecErrorFull(error: unknown): string {
  if (error && typeof error === 'object') {
    const stderr = 'stderr' in error ? String((error as { stderr?: Buffer | string }).stderr ?? '').trim() : '';
    if (stderr) return stderr;

    const stdout = 'stdout' in error ? String((error as { stdout?: Buffer | string }).stdout ?? '').trim() : '';
    if (stdout) return stdout;
  }

  return error instanceof Error ? error.message : String(error);
}

function extractExecErrorMessage(error: unknown): string {
  const full = extractExecErrorFull(error);
  // Wrangler may append a log-file path as the last line — prefer the last meaningful line.
  const lines = full.split('\n').filter(Boolean);
  return lines.at(-1) ?? full;
}

function runWrangler(
  projectDir: string,
  args: string[],
  options?: { input?: string },
): string {
  return execFileSync(wranglerCommand(), wranglerArgs(args), {
    cwd: projectDir,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    input: options?.input,
  });
}

async function confirmDestroy(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolveAnswer) => {
    rl.question(message, (value) => resolveAnswer(value));
  });
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function wipeManagedStorageBucket(workerUrl: string, serviceKey: string): Promise<number> {
  const response = await fetchWithTimeout(
    `${workerUrl.replace(/\/$/, '')}/admin/api/backup/restore-storage?action=wipe`,
    {
      method: 'POST',
      headers: { 'X-EdgeBase-Service-Key': serviceKey },
    },
  );

  if (!response.ok) {
    throw new Error(`storage wipe failed (${response.status}): ${await response.text()}`);
  }

  const payload = await response.json() as { deleted?: unknown };
  return typeof payload.deleted === 'number' ? payload.deleted : 0;
}

async function listTurnstileWidgets(
  accountId: string,
  apiToken: string,
): Promise<Array<{ name: string; sitekey: string }>> {
  const response = await fetchWithTimeout(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/challenges/widgets`,
    {
      headers: { Authorization: `Bearer ${apiToken}` },
    },
  );

  if (!response.ok) {
    throw new Error(`Turnstile list failed (${response.status}): ${await response.text()}`);
  }

  const payload = await response.json() as {
    result?: Array<{ name?: unknown; sitekey?: unknown }>;
  };

  return (payload.result ?? [])
    .filter((entry) => typeof entry.name === 'string' && typeof entry.sitekey === 'string')
    .map((entry) => ({ name: entry.name as string, sitekey: entry.sitekey as string }));
}

async function deleteTurnstileWidget(
  accountId: string,
  apiToken: string,
  resource: CloudflareResourceRecord,
): Promise<void> {
  const configuredSiteKey =
    typeof resource.metadata?.siteKey === 'string' ? resource.metadata.siteKey : undefined;
  const siteKey = configuredSiteKey ?? (
    await listTurnstileWidgets(accountId, apiToken)
  ).find((widget) => widget.name === resource.name)?.sitekey;

  if (!siteKey) {
    throw new Error(`Turnstile widget "${resource.name}" not found (no siteKey in manifest and no matching widget name on account).`);
  }

  const response = await fetchWithTimeout(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/challenges/widgets/${siteKey}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiToken}` },
    },
  );

  if (!response.ok) {
    throw new Error(`Turnstile delete failed (${response.status}): ${await response.text()}`);
  }
}

function fetchD1DatabaseList(
  projectDir: string,
): Map<string, string> {
  const uuidToName = new Map<string, string>();
  try {
    const output = runWrangler(projectDir, ['wrangler', 'd1', 'list', '--json']);
    const databases = JSON.parse(output) as Array<{ uuid?: unknown; name?: unknown }>;
    for (const entry of databases) {
      if (typeof entry.uuid === 'string' && typeof entry.name === 'string') {
        uuidToName.set(entry.uuid, entry.name);
      }
    }
  } catch {
    // Fall back to deterministic naming.
  }
  return uuidToName;
}

function resolveManagedD1DeleteName(
  workerName: string,
  resource: CloudflareResourceRecord,
  d1List: Map<string, string>,
): string {
  if (resource.id) {
    const name = d1List.get(resource.id);
    if (name) return name;
  }

  if (workerName) {
    return buildManagedD1DatabaseName(workerName, resource.name);
  }

  return buildLegacyManagedD1DatabaseName(resource.name);
}

function formatDestroyPlan(workerName: string, resources: CloudflareResourceRecord[]): string[] {
  const lines: string[] = [];
  if (workerName) {
    lines.push(`Worker: ${workerName}`);
  }

  for (const resource of resources) {
    if (resource.managed === false) continue;
    const detail = resource.binding ? `${resource.name} (${resource.binding})` : resource.name;
    lines.push(`${resource.type}: ${detail}`);
  }

  return lines;
}

function isAlreadyDeletedError(message: string): boolean {
  return /not.?found|does not exist|couldn't find|could not find|no such/i.test(message);
}

async function runDeleteStep(
  label: string,
  dryRun: boolean,
  result: DestroyResult,
  action: () => Promise<void> | void,
): Promise<void> {
  if (dryRun) {
    result.skipped.push(`[dry-run] ${label}`);
    return;
  }

  try {
    await action();
    result.deleted.push(label);
  } catch (error) {
    const full = extractExecErrorFull(error);
    if (isAlreadyDeletedError(full)) {
      result.deleted.push(`${label} (already removed)`);
    } else {
      result.failures.push({ label, message: extractExecErrorMessage(error) });
    }
  }
}

function isManagedResource(resource: CloudflareResourceRecord): boolean {
  return resource.managed !== false;
}

export const _internals = {
  mergeDestroyResources,
};

function resolveProjectDir(): string {
  const cwd = resolve('.');
  if (existsSync(getCloudflareDeployManifestPath(cwd)) || existsSync(join(cwd, 'wrangler.toml'))) {
    return cwd;
  }
  const edgebaseSubdir = join(cwd, 'edgebase');
  if (existsSync(getCloudflareDeployManifestPath(edgebaseSubdir)) || existsSync(join(edgebaseSubdir, 'wrangler.toml'))) {
    return edgebaseSubdir;
  }
  return cwd;
}

export const destroyCommand = new Command('destroy')
  .description('Destroy project-scoped Cloudflare resources for this project')
  .option('--dry-run', 'Show the deletion plan without removing resources')
  .option('--service-key <key>', 'Service Key used to wipe the managed STORAGE bucket')
  .option('--url <url>', 'Worker URL used to wipe the managed STORAGE bucket')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (options: DestroyOptions) => {
    const projectDir = resolveProjectDir();
    const wranglerPath = join(projectDir, 'wrangler.toml');
    const manifestPath = getCloudflareDeployManifestPath(projectDir);
    const manifest = readCloudflareDeployManifest(projectDir);
    const wranglerContent = existsSync(wranglerPath) ? readFileSync(wranglerPath, 'utf-8') : null;
    const resources = mergeDestroyResources(manifest, wranglerContent).filter(isManagedResource);
    const workerName = manifest?.worker.name || resolveWorkerNameFromProject(projectDir);
    const workerUrl = (
      options.url
      || process.env.EDGEBASE_URL
      || manifest?.worker.url
      || resolveWorkerUrlFromProject(projectDir)
    ).replace(/\/$/, '');
    const isTTY = !!process.stdin.isTTY;

    if (!workerName && resources.length === 0) {
      const message = `No Cloudflare resources found for this project. (${manifestPath})`;
      if (isJson()) {
        console.log(JSON.stringify({ status: 'noop', message }));
      } else {
        console.log(chalk.yellow('⚠'), message);
      }
      return;
    }

    const planLines = formatDestroyPlan(workerName, resources);
    if (!isJson()) {
      console.log(chalk.blue(options.dryRun ? '🧹 Previewing Cloudflare destroy...' : '🧹 Destroying Cloudflare resources...'));
      console.log();
      for (const line of planLines) {
        console.log(chalk.dim(`  • ${line}`));
      }
      console.log();
    }

    if (!options.dryRun && !options.yes) {
      if (isJson() || !isTTY || isNonInteractive()) {
        raiseNeedsInput({
          code: 'destroy_confirmation_required',
          field: 'yes',
          message: 'Destroy requires explicit confirmation before deleting Cloudflare resources.',
          hint: 'Review the deletion plan, then rerun with --yes.',
          choices: [{
            label: 'Approve deletion',
            value: 'yes',
            args: ['--yes'],
            hint: 'Use only after confirming the destroy plan.',
          }],
        });
      }

      const confirmed = await confirmDestroy(`  ${chalk.cyan('Proceed with Cloudflare resource deletion?')} (y/N): `);
      if (!confirmed) {
        console.log(chalk.yellow('⚠ Destroy cancelled.'));
        return;
      }
    }

    const cfAuth = options.dryRun ? null : await ensureCloudflareAuth(projectDir, isTTY);
    const accountId = manifest?.accountId || cfAuth?.accountId || '';
    const apiToken = process.env.CLOUDFLARE_API_TOKEN;
    const serviceKey = resolveOptionalServiceKey({ serviceKey: options.serviceKey });
    const result: DestroyResult = { deleted: [], skipped: [], failures: [] };

    const turnstileResources = resources.filter((resource) => resource.type === 'turnstile_widget');
    for (const resource of turnstileResources) {
      await runDeleteStep(`Turnstile ${resource.name}`, !!options.dryRun, result, async () => {
        if (!accountId) {
          throw new Error('Cloudflare account id is required for Turnstile deletion.');
        }
        if (!apiToken) {
          throw new Error('Set CLOUDFLARE_API_TOKEN to delete managed Turnstile widgets.');
        }
        await deleteTurnstileWidget(accountId, apiToken, resource);
      });
    }

    const r2Resources = resources.filter((resource) => resource.type === 'r2_bucket');
    for (const resource of r2Resources) {
      await runDeleteStep(`R2 ${resource.name}`, !!options.dryRun, result, async () => {
        const jurisdiction =
          typeof resource.metadata?.jurisdiction === 'string'
            ? resource.metadata.jurisdiction
            : undefined;
        if (resource.binding === 'STORAGE' && workerUrl && serviceKey) {
          try {
            await wipeManagedStorageBucket(workerUrl, serviceKey);
          } catch {
            // Storage wipe may fail if Worker is already deleted — continue with bucket deletion.
          }
        }

        const args = ['wrangler', 'r2', 'bucket', 'delete', resource.name];
        if (jurisdiction) {
          args.push(`--jurisdiction=${jurisdiction}`);
        }

        try {
          runWrangler(projectDir, args, { input: 'y\n' });
        } catch (error) {
          const full = extractExecErrorFull(error);
          if (isAlreadyDeletedError(full)) return;
          if (resource.binding === 'STORAGE' && (!workerUrl || !serviceKey)) {
            throw new Error(
              `${extractExecErrorMessage(error)}. Set --url/EDGEBASE_URL and --service-key/EDGEBASE_SERVICE_KEY if the bucket is not empty.`,
            );
          }
          throw error;
        }
      });
    }

    const storageDeleteFailed = r2Resources.some(
      (r) => r.binding === 'STORAGE' && result.failures.some((f) => f.label === `R2 ${r.name}`),
    );

    if (workerName && storageDeleteFailed) {
      result.skipped.push(`Worker ${workerName} (skipped: STORAGE bucket deletion failed — deleting the Worker would prevent future bucket cleanup)`);
    } else if (workerName) {
      await runDeleteStep(`Worker ${workerName}`, !!options.dryRun, result, () => {
        runWrangler(projectDir, ['wrangler', 'delete', workerName, '--force'], { input: 'y\n' });
      });
    }

    const orderedTypes: CloudflareResourceRecord['type'][] = [
      'kv_namespace',
      'd1_database',
      'vectorize',
      'hyperdrive',
    ];

    const hasD1 = resources.some((r) => r.type === 'd1_database');
    const d1List = hasD1 && !options.dryRun ? fetchD1DatabaseList(projectDir) : new Map<string, string>();

    for (const type of orderedTypes) {
      for (const resource of resources.filter((entry) => entry.type === type)) {
        const label = `${type} ${resource.binding ?? resource.name}`;
        await runDeleteStep(label, !!options.dryRun, result, () => {
          if (resource.type === 'kv_namespace') {
            const args = resource.id
              ? ['wrangler', 'kv', 'namespace', 'delete', '--namespace-id', resource.id, '-y']
              : ['wrangler', 'kv', 'namespace', 'delete', `${workerName}-${resource.binding ?? resource.name}`, '-y'];
            runWrangler(projectDir, args);
            return;
          }

          if (resource.type === 'd1_database') {
            const deleteName = resolveManagedD1DeleteName(workerName, resource, d1List);
            try {
              runWrangler(projectDir, ['wrangler', 'd1', 'delete', deleteName, '-y']);
            } catch (error) {
              if (deleteName !== buildLegacyManagedD1DatabaseName(resource.name)) {
                runWrangler(
                  projectDir,
                  ['wrangler', 'd1', 'delete', buildLegacyManagedD1DatabaseName(resource.name), '-y'],
                );
                return;
              }
              throw error;
            }
            return;
          }

          if (resource.type === 'vectorize') {
            runWrangler(projectDir, ['wrangler', 'vectorize', 'delete', resource.id || `edgebase-${resource.name}`, '-y']);
            return;
          }

          if (resource.type === 'hyperdrive') {
            let hyperdriveId = resource.id;
            if (!hyperdriveId) {
              // Attempt to resolve ID by name from wrangler hyperdrive list
              try {
                const listOutput = runWrangler(projectDir, ['wrangler', 'hyperdrive', 'list']);
                const namePattern = resource.name === 'auth' ? 'edgebase-auth' : `edgebase-db-${resource.name}`;
                const match = listOutput.match(new RegExp(`(${namePattern})\\s.*?([a-f0-9-]{36})`, 'i'))
                  ?? listOutput.match(new RegExp(`([a-f0-9-]{36}).*?${namePattern}`, 'i'));
                hyperdriveId = match?.[2] ?? match?.[1];
              } catch {
                // list failed
              }
            }
            if (!hyperdriveId) {
              throw new Error(`Hyperdrive id is missing and could not be resolved for "${resource.name}".`);
            }
            runWrangler(projectDir, ['wrangler', 'hyperdrive', 'delete', hyperdriveId], { input: 'y\n' });
          }
        });
      }
    }

    if (!options.dryRun && result.failures.length === 0) {
      rmSync(manifestPath, { force: true });
      rmSync(join(projectDir, '.edgebase', 'secrets.json'), { force: true });
      rmSync(join(projectDir, 'edgebase-schema.lock.json'), { force: true });
    }

    if (isJson()) {
      if (result.failures.length > 0) {
        raiseCliError({
          code: 'destroy_partial_failure',
          message: `Destroy completed with ${result.failures.length} failure(s).`,
          details: {
            worker: workerName,
            deleted: result.deleted,
            skipped: result.skipped,
            failures: result.failures,
          },
        });
      }
      console.log(JSON.stringify({
        status: options.dryRun ? 'dry-run' : 'success',
        worker: workerName,
        deleted: result.deleted,
        skipped: result.skipped,
      }));
    } else if (result.failures.length === 0) {
      console.log(chalk.green(`✓ ${options.dryRun ? 'Destroy preview complete.' : 'Cloudflare resources removed.'}`));
      if (options.dryRun) {
        console.log(chalk.dim('  Run npx edgebase destroy --yes to execute.'));
      }
    } else {
      raiseCliError({
        code: 'destroy_partial_failure',
        message: `Destroy completed with ${result.failures.length} failure(s).`,
        details: {
          worker: workerName,
          deleted: result.deleted,
          skipped: result.skipped,
          failures: result.failures,
        },
      });
    }
  });
