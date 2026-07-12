import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { PluginInstance } from '@edge-base/shared';
import { buildManagedD1DatabaseName, extractWranglerWorkerName } from './managed-resource-names.js';

export interface ProvisionedBinding {
  type: 'kv_namespace' | 'd1_database' | 'vectorize' | 'hyperdrive';
  /** User-facing name from config (e.g. 'cache', 'analytics') */
  name: string;
  /** Wrangler binding name (e.g. 'CACHE_KV', 'ANALYTICS_DB') */
  binding: string;
  /** Resource ID from Wrangler (namespace_id, database_id, etc.) */
  id: string;
  /** Actual account-global resource name when it differs from the logical name. */
  resourceName?: string;
  /** Whether this resource should be deleted by project destroy. */
  managed?: boolean;
  /** Whether the resource was created during deploy or already existed. */
  source?: 'created' | 'existing';
}

export interface ProvisionedRateLimitBinding {
  binding: string;
  namespaceId: string;
  limit: number;
  period: 10 | 60;
}

export type EdgeBaseRuntimeMode = 'cloudflare' | 'local-development' | 'self-hosted';

export const RUNTIME_PROCESS_ENV_COMPATIBILITY_FLAGS = [
  'nodejs_compat',
  'nodejs_compat_populate_process_env',
];

interface GenerateTempWranglerBaseOptions {
  bindings: ProvisionedBinding[];
  rateLimitBindings?: ProvisionedRateLimitBinding[];
  /** CLI-owned trust boundary for request forwarding headers. */
  runtimeMode?: EdgeBaseRuntimeMode;
  /** Compatibility flags required by the generated runtime only. */
  requiredCompatibilityFlags?: string[];
}

export type GenerateTempWranglerTomlOptions =
  | (GenerateTempWranglerBaseOptions & {
      // Preserve any existing [triggers] section from the source wrangler.toml.
      triggerMode?: 'preserve';
      managedCrons?: undefined;
    })
  | (GenerateTempWranglerBaseOptions & {
      // Replace the source [triggers] section with the CLI-managed cron set.
      triggerMode: 'replace';
      managedCrons: string[];
    });

const EDGEBASE_ASSETS_DIRECTORY = '.edgebase/runtime/server/app-assets';
const LEGACY_EDGEBASE_ASSETS_DIRECTORY = '.edgebase/runtime/server/admin-build';
const EDGEBASE_ASSETS_BINDING = 'ASSETS';

function ensureRequiredCompatibilityFlags(
  wranglerToml: string,
  requiredFlags: string[] | undefined,
): { normalized: string; changed: boolean } {
  const required = [...new Set(requiredFlags ?? [])].filter(Boolean);
  if (required.length === 0) {
    return { normalized: wranglerToml, changed: false };
  }

  const firstSection = /^[ \t]*\[/m.exec(wranglerToml);
  const rootEnd = firstSection?.index ?? wranglerToml.length;
  const root = wranglerToml.slice(0, rootEnd);
  const remainder = wranglerToml.slice(rootEnd);
  const assignmentPattern = /^[ \t]*compatibility_flags[ \t]*=[ \t]*\[([\s\S]*?)\]/m;
  const assignment = assignmentPattern.exec(root);
  if (assignment) {
    const existing = [...assignment[1].matchAll(/["']([^"']+)["']/g)]
      .map((match) => match[1]);
    const flags = [...new Set([...existing, ...required])];
    if (required.every((flag) => existing.includes(flag))) {
      return { normalized: wranglerToml, changed: false };
    }
    const normalizedAssignment = `compatibility_flags = [${flags.map((flag) => JSON.stringify(flag)).join(', ')}]`;
    return {
      normalized: `${root.replace(assignment[0], normalizedAssignment)}${remainder}`,
      changed: true,
    };
  }

  const assignmentLine = `compatibility_flags = [${required.map((flag) => JSON.stringify(flag)).join(', ')}]`;
  const compatibilityDatePattern = /^([ \t]*compatibility_date[ \t]*=.*)$/m;
  if (compatibilityDatePattern.test(root)) {
    return {
      normalized: `${root.replace(
        compatibilityDatePattern,
        `$1\n${assignmentLine}`,
      )}${remainder}`,
      changed: true,
    };
  }

  const normalizedRoot = root.replace(/\s*$/, '');
  const separator = remainder.length > 0 ? '\n\n' : '\n';
  return {
    normalized: `${normalizedRoot}\n${assignmentLine}${separator}${remainder}`,
    changed: true,
  };
}

function ensureRuntimeModeVar(
  wranglerToml: string,
  runtimeMode: EdgeBaseRuntimeMode | undefined,
): { normalized: string; changed: boolean } {
  if (!runtimeMode) return { normalized: wranglerToml, changed: false };

  const lines = wranglerToml.split(/\r?\n/);
  const rootVarsIndex = lines.findIndex((line) => line.trim() === '[vars]');
  const assignment = `EDGEBASE_RUNTIME_MODE = "${runtimeMode}"`;

  if (rootVarsIndex === -1) {
    const normalized = wranglerToml.replace(/\s*$/, '');
    return {
      normalized: `${normalized}\n\n[vars]\n${assignment}\n`,
      changed: true,
    };
  }

  let blockEnd = lines.length;
  for (let index = rootVarsIndex + 1; index < lines.length; index += 1) {
    if (/^\s*\[/.test(lines[index])) {
      blockEnd = index;
      break;
    }
  }

  let existingIndex = -1;
  for (let index = rootVarsIndex + 1; index < blockEnd; index += 1) {
    if (/^\s*EDGEBASE_RUNTIME_MODE\s*=/.test(lines[index])) {
      existingIndex = index;
      break;
    }
  }

  if (existingIndex !== -1 && lines[existingIndex].trim() === assignment) {
    return { normalized: wranglerToml, changed: false };
  }

  if (existingIndex !== -1) {
    lines[existingIndex] = assignment;
  } else {
    lines.splice(rootVarsIndex + 1, 0, assignment);
  }

  return { normalized: lines.join('\n'), changed: true };
}

function readAssetsDirectory(block: string): string | null {
  const match = block.match(/^\s*directory\s*=\s*"([^"\n]*)"\s*$/m);
  return match?.[1] ?? null;
}

function normalizeAssetsDirectory(directory: string | null): string | null {
  if (!directory) return null;
  return directory
    .replace(/\\\\/g, '/')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/');
}

function hasAssetsBlock(wranglerToml: string): boolean {
  return /\n?\[assets\][\s\S]*?(?=\n\[\[|\n\[|$)/.test(wranglerToml);
}

export function normalizeLegacyEdgeBaseAssetsDirectory(
  wranglerToml: string,
): { normalized: string; changed: boolean } {
  let changed = false;

  const normalized = wranglerToml.replace(
    /\n?\[assets\][\s\S]*?(?=\n\[\[|\n\[|$)/g,
    (block) => {
      const normalizedDirectory = normalizeAssetsDirectory(readAssetsDirectory(block));
      const isEdgeBaseAssetsBlock =
        /^\s*binding\s*=\s*"ASSETS"\s*$/m.test(block) ||
        normalizedDirectory === EDGEBASE_ASSETS_DIRECTORY ||
        normalizedDirectory === LEGACY_EDGEBASE_ASSETS_DIRECTORY;

      if (!isEdgeBaseAssetsBlock || normalizedDirectory !== LEGACY_EDGEBASE_ASSETS_DIRECTORY) {
        return block;
      }

      changed = true;
      return block.replace(
        /^\s*directory\s*=\s*"([^"\n]*)"\s*$/m,
        `directory = "${EDGEBASE_ASSETS_DIRECTORY}"`,
      );
    },
  );

  return { normalized, changed };
}

function normalizeAssetsRunWorkerFirst(
  wranglerToml: string,
): { normalized: string; changed: boolean } {
  const {
    normalized: normalizedLegacyAssets,
    changed: normalizedLegacyAssetsDirectory,
  } = normalizeLegacyEdgeBaseAssetsDirectory(wranglerToml);
  let changed = normalizedLegacyAssetsDirectory;

  const normalized = normalizedLegacyAssets.replace(
    /\n?\[assets\][\s\S]*?(?=\n\[\[|\n\[|$)/g,
    (block) => {
      const normalizedDirectory = normalizeAssetsDirectory(readAssetsDirectory(block));
      const isEdgeBaseAssetsBlock =
        /^\s*binding\s*=\s*"ASSETS"\s*$/m.test(block) ||
        normalizedDirectory === EDGEBASE_ASSETS_DIRECTORY ||
        normalizedDirectory === LEGACY_EDGEBASE_ASSETS_DIRECTORY;

      if (!isEdgeBaseAssetsBlock) return block;
      const rewritten = block;
      if (/^\s*run_worker_first\s*=\s*true\s*$/m.test(rewritten)) return rewritten;

      changed = true;

      if (/^\s*run_worker_first\s*=\s*(true|false)\s*$/m.test(rewritten)) {
        return rewritten.replace(/^\s*run_worker_first\s*=\s*(true|false)\s*$/m, 'run_worker_first = true');
      }

      return `${rewritten.replace(/\s*$/, '')}\nrun_worker_first = true`;
    },
  );

  return { normalized, changed };
}

function ensureManagedAssetsBlock(
  wranglerToml: string,
): { normalized: string; changed: boolean } {
  const { normalized, changed } = normalizeAssetsRunWorkerFirst(wranglerToml);

  if (hasAssetsBlock(normalized)) {
    return { normalized, changed };
  }

  const trimmed = normalized.replace(/\s*$/, '');
  return {
    normalized: `${trimmed}\n\n[assets]\ndirectory = "${EDGEBASE_ASSETS_DIRECTORY}"\nbinding = "${EDGEBASE_ASSETS_BINDING}"\nrun_worker_first = true\n`,
    changed: true,
  };
}

/**
 * Merge plugin tables into the user's config databases (in-memory).
 * Plugins declare tables in their PluginInstance; CLI adds them to the target DB block.
 *
 * Plugin tables are namespaced: `plugin.name/tableName` (e.g. '@edge-base/plugin-stripe/customers').
 */
export function mergePluginTables(
  databases: Record<string, { tables?: Record<string, unknown> }>,
  plugins: PluginInstance[],
): void {
  for (const plugin of plugins) {
    if (!plugin.tables) continue;
    const dbKey = plugin.dbBlock ?? 'shared';
    if (!databases[dbKey]) databases[dbKey] = { tables: {} };
    if (!databases[dbKey].tables) databases[dbKey].tables = {};
    for (const [tableName, tableConfig] of Object.entries(plugin.tables)) {
      databases[dbKey].tables![`${plugin.name}/${tableName}`] = tableConfig;
    }
  }
}

/**
 * Extract database blocks from config.
 */
export function extractDatabases(
  config: Record<string, unknown>,
): Record<string, { tables?: Record<string, unknown> }> | null {
  let databases =
    config.databases && typeof config.databases === 'object'
      ? (config.databases as Record<string, { tables?: Record<string, unknown> }>)
      : null;

  if (Array.isArray(config.plugins) && config.plugins.length > 0) {
    databases ??= {};
    mergePluginTables(databases, config.plugins as PluginInstance[]);
  }

  return databases;
}

/**
 * Generate a temporary wrangler.toml with user KV/D1/Vectorize/Hyperdrive bindings appended.
 * Returns the path to the temp file, or null if no normalization or extra bindings are needed.
 *
 * Source wrangler.toml is NEVER modified (Decision #121 §5 immutability principle).
 */
export function generateTempWranglerToml(
  wranglerPath: string,
  options: GenerateTempWranglerTomlOptions,
): string | null {
  const bindings = options.bindings.filter((binding, index, all) =>
    all.findIndex((candidate) =>
      candidate.type === binding.type && candidate.binding === binding.binding) === index,
  );
  const rateLimitBindings = options.rateLimitBindings ?? [];
  const replaceTriggers = options.triggerMode === 'replace';
  const managedCrons = replaceTriggers ? options.managedCrons : [];

  const original = readFileSync(wranglerPath, 'utf-8');
  const { normalized: runtimeNormalized, changed: normalizedRuntimeMode } =
    ensureRuntimeModeVar(original, options.runtimeMode);
  const { normalized: compatibilityNormalized, changed: normalizedCompatibilityFlags } =
    ensureRequiredCompatibilityFlags(
      runtimeNormalized,
      options.requiredCompatibilityFlags,
    );
  const { normalized: normalizedOriginal, changed: normalizedAssetsRouting } =
    ensureManagedAssetsBlock(compatibilityNormalized);

  if (
    bindings.length === 0 &&
    !replaceTriggers &&
    rateLimitBindings.length === 0 &&
    !normalizedRuntimeMode &&
    !normalizedCompatibilityFlags &&
    !normalizedAssetsRouting
  ) {
    return null;
  }

  const workerName = extractWranglerWorkerName(original) || 'edgebase';
  const kvBindingNames = new Set(
    bindings.filter((binding) => binding.type === 'kv_namespace').map((binding) => binding.binding),
  );
  const d1BindingNames = new Set(
    bindings.filter((binding) => binding.type === 'd1_database').map((binding) => binding.binding),
  );
  const rateLimitBindingNames = new Set(rateLimitBindings.map((binding) => binding.binding));
  let sanitizedOriginal =
    rateLimitBindingNames.size > 0
      ? normalizedOriginal.replace(/\n?\[\[unsafe\.bindings\]\][\s\S]*?(?=\n\[\[|\n\[|$)/g, (block) => {
          const nameMatch = block.match(/^\s*name\s*=\s*"([^"]+)"/m);
          if (nameMatch && rateLimitBindingNames.has(nameMatch[1])) {
            return '';
          }
          return block;
        })
      : normalizedOriginal;
  if (kvBindingNames.size > 0) {
    sanitizedOriginal = sanitizedOriginal.replace(
      /\n?\[\[kv_namespaces\]\][\s\S]*?(?=\n\[\[|\n\[|$)/g,
      (block) => {
        const bindingMatch = block.match(/^\s*binding\s*=\s*"([^"]+)"/m);
        if (bindingMatch && kvBindingNames.has(bindingMatch[1])) {
          return '';
        }
        return block;
      },
    );
  }
  if (replaceTriggers) {
    sanitizedOriginal = sanitizedOriginal.replace(
      /\n?\[triggers\][\s\S]*?(?=\n\[\[|\n\[|$)/g,
      '',
    );
  }
  if (d1BindingNames.size > 0) {
    sanitizedOriginal = sanitizedOriginal.replace(
      /\n?\[\[d1_databases\]\][\s\S]*?(?=\n\[\[|\n\[|$)/g,
      (block) => {
        const bindingMatch = block.match(/^\s*binding\s*=\s*"([^"]+)"/m);
        if (bindingMatch && d1BindingNames.has(bindingMatch[1])) {
          return '';
        }
        return block;
      },
    );
  }
  const sections: string[] = [sanitizedOriginal];
  let didAppend = false;
  function appendManagedSection(section: string): void {
    if (!didAppend) {
      sections.push('', '# ─── Auto-provisioned bindings ───');
      didAppend = true;
    }
    sections.push('', section);
  }

  const kvBindings = bindings.filter((b) => b.type === 'kv_namespace');
  const d1Bindings = bindings.filter((b) => b.type === 'd1_database');
  const vecBindings = bindings.filter((b) => b.type === 'vectorize');

  if (kvBindings.length > 0) {
    for (const b of kvBindings) {
      appendManagedSection(`[[kv_namespaces]]\nbinding = "${b.binding}"\nid = "${b.id}"`);
    }
  }

  if (d1Bindings.length > 0) {
    for (const b of d1Bindings) {
      appendManagedSection(
        `[[d1_databases]]\nbinding = "${b.binding}"\ndatabase_name = "${b.resourceName ?? buildManagedD1DatabaseName(workerName, b.name)}"\ndatabase_id = "${b.id}"`,
      );
    }
  }

  if (vecBindings.length > 0) {
    if (original.includes('vectorize')) {
      for (const b of vecBindings) {
        if (!original.includes(`binding = "${b.binding}"`)) {
          appendManagedSection(`[[vectorize]]\nbinding = "${b.binding}"\nindex_name = "${b.id}"`);
        }
      }
    } else {
      for (const b of vecBindings) {
        appendManagedSection(`[[vectorize]]\nbinding = "${b.binding}"\nindex_name = "${b.id}"`);
      }
    }
  }

  const hdBindings = bindings.filter((b) => b.type === 'hyperdrive');
  if (hdBindings.length > 0) {
    for (const b of hdBindings) {
      if (!original.includes(`binding = "${b.binding}"`)) {
        appendManagedSection(`[[hyperdrive]]\nbinding = "${b.binding}"\nid = "${b.id}"`);
      }
    }
  }

  if (rateLimitBindings.length > 0) {
    for (const binding of rateLimitBindings) {
      appendManagedSection(
        `[[unsafe.bindings]]\nname = "${binding.binding}"\ntype = "ratelimit"\nnamespace_id = "${binding.namespaceId}"\nsimple = { limit = ${binding.limit}, period = ${binding.period} }`,
      );
    }
  }

  if (replaceTriggers) {
    appendManagedSection(`[triggers]\ncrons = [${managedCrons.map((c) => `"${c}"`).join(', ')}]`);
  }

  if (
    !didAppend
    && !normalizedAssetsRouting
    && !normalizedRuntimeMode
    && !normalizedCompatibilityFlags
  ) return null;

  const tempDir = dirname(wranglerPath);
  const tempPath = join(tempDir, `.wrangler.generated.${randomBytes(6).toString('hex')}.toml`);
  writeFileSync(tempPath, sections.join('\n') + '\n', 'utf-8');
  return tempPath;
}
