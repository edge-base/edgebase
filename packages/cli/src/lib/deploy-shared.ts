import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { PluginInstance } from '@edge-base/shared';
import {
  buildManagedD1DatabaseName,
  buildManagedR2BucketName,
  extractWranglerWorkerName,
} from './managed-resource-names.js';
import { RESERVED_HOSTED_WORKER_SECRET_NAMES } from './wrangler-secrets.js';

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
  /** Cloudflare Workers send_email binding required by config.email. */
  sendEmailBinding?: string;
  /** CLI-owned trust boundary for request forwarding headers. */
  runtimeMode?: EdgeBaseRuntimeMode;
  /** Compatibility flags required by the generated runtime only. */
  requiredCompatibilityFlags?: string[];
  /** Restore and validate the finite core binding set used by self-host runtimes. */
  ensureSelfHostRuntimeBindings?: boolean;
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
const WORKER_BINDING_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const RESERVED_COMPILE_TIME_BUILD_SELECTORS = [
  'EDGEBASE_TEST_BUILD',
  'EDGEBASE_LOCAL_DEV_BUILD',
] as const;

export function isSafeWorkerBindingName(value: unknown): value is string {
  return typeof value === 'string' && WORKER_BINDING_NAME_PATTERN.test(value);
}

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

function stripTomlComment(line: string): string {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote) {
      if (quote === '"' && escaped) {
        escaped = false;
        continue;
      }
      if (quote === '"' && character === '\\') {
        escaped = true;
        continue;
      }
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '#') return line.slice(0, index);
  }
  return line;
}

function findTomlEquals(value: string, start = 0): number {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (quote === '"' && escaped) {
        escaped = false;
        continue;
      }
      if (quote === '"' && character === '\\') {
        escaped = true;
        continue;
      }
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '=') return index;
    if (character === '}') return -1;
  }
  return -1;
}

function parseTomlKeyPath(value: string): string[] | null {
  const path: string[] = [];
  let index = 0;
  const skipWhitespace = () => {
    while (index < value.length && /\s/.test(value[index])) index += 1;
  };

  while (index < value.length) {
    skipWhitespace();
    if (index >= value.length) break;
    const start = index;
    let key = '';
    if (value[index] === '"' || value[index] === "'") {
      const quote = value[index];
      index += 1;
      let escaped = false;
      while (index < value.length) {
        const character = value[index];
        index += 1;
        if (quote === '"' && escaped) {
          escaped = false;
          continue;
        }
        if (quote === '"' && character === '\\') {
          escaped = true;
          continue;
        }
        if (character === quote) break;
      }
      if (value[index - 1] !== quote) return null;
      const raw = value.slice(start, index);
      try {
        key = quote === '"' ? JSON.parse(raw) as string : raw.slice(1, -1);
      } catch {
        return null;
      }
    } else {
      const match = value.slice(index).match(/^[A-Za-z0-9_-]+/);
      if (!match) return null;
      key = match[0];
      index += key.length;
    }
    path.push(key);
    skipWhitespace();
    if (index >= value.length) break;
    if (value[index] !== '.') return null;
    index += 1;
  }

  return path.length > 0 ? path : null;
}

function skipTomlValue(value: string, start: number): number {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  let arrayDepth = 0;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (quote === '"' && escaped) {
        escaped = false;
        continue;
      }
      if (quote === '"' && character === '\\') {
        escaped = true;
        continue;
      }
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '[') arrayDepth += 1;
    else if (character === ']') arrayDepth = Math.max(0, arrayDepth - 1);
    else if (arrayDepth === 0 && (character === ',' || character === '}')) return index;
  }
  return value.length;
}

function scanInlineTomlTable(
  value: string,
  start: number,
  parentPath: string[],
  onPath: (path: string[]) => void,
): number {
  let index = start + 1;
  while (index < value.length) {
    while (index < value.length && (value[index] === ',' || /\s/.test(value[index]))) index += 1;
    if (value[index] === '}') return index + 1;

    const equals = findTomlEquals(value, index);
    if (equals === -1) return value.length;
    const keyPath = parseTomlKeyPath(value.slice(index, equals));
    if (!keyPath) return value.length;
    const fullPath = [...parentPath, ...keyPath];
    onPath(fullPath);

    index = equals + 1;
    while (index < value.length && /\s/.test(value[index])) index += 1;
    if (value[index] === '{') {
      index = scanInlineTomlTable(value, index, fullPath, onPath);
    } else {
      index = skipTomlValue(value, index);
    }
    if (value[index] === '}') return index + 1;
  }
  return index;
}

export function assertNoProtectedWranglerRuntimeSelectors(wranglerToml: string): void {
  const protectedNames = new Set<string>(RESERVED_HOSTED_WORKER_SECRET_NAMES);
  // This one is a CLI-owned public var and is normalized below instead of
  // rejected. It is still forbidden as a Worker secret by deploy preflight.
  protectedNames.delete('EDGEBASE_RUNTIME_MODE');
  const found = new Set<string>();
  let sectionPath: string[] = [];
  const collectPath = (path: string[]) => {
    const name = path.at(-1);
    if (!name) return;
    const scopes = path.slice(0, -1).map((segment) => segment.toLowerCase());
    if (scopes.includes('vars') && protectedNames.has(name)) found.add(name);
    if (
      scopes.includes('define')
      && (RESERVED_COMPILE_TIME_BUILD_SELECTORS as readonly string[]).includes(name)
    ) found.add(name);
  };

  for (const rawLine of wranglerToml.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) continue;
    const section = line.startsWith('[')
      && line.endsWith(']')
      && !line.startsWith('[[')
      && !line.endsWith(']]')
      ? line.slice(1, -1)
      : null;
    if (section !== null && !section.includes('[') && !section.includes(']')) {
      sectionPath = parseTomlKeyPath(section) ?? [];
      continue;
    }

    const equals = findTomlEquals(line);
    if (equals === -1) continue;
    const keyPath = parseTomlKeyPath(line.slice(0, equals));
    if (!keyPath) continue;
    const fullPath = [...sectionPath, ...keyPath];
    collectPath(fullPath);

    let valueStart = equals + 1;
    while (valueStart < line.length && /\s/.test(line[valueStart])) valueStart += 1;
    if (line[valueStart] === '{') {
      scanInlineTomlTable(line, valueStart, fullPath, collectPath);
    }
  }
  if (found.size === 0) return;

  throw new Error(
    `wrangler.toml must not define protected hosted runtime selector(s): ${[...found].join(', ')}. `
    + 'Remove them from [vars], environment vars, and [define]; configure production behavior in edgebase.config.ts. '
    + 'EDGEBASE_TEST_BUILD is reserved for the dedicated test-only Wrangler config; '
    + 'EDGEBASE_LOCAL_DEV_BUILD is injected only by the EdgeBase CLI dev command.',
  );
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

const SELF_HOST_DURABLE_OBJECT_BINDINGS = Object.freeze([
  { name: 'DATABASE', className: 'DatabaseDO' },
  { name: 'AUTH', className: 'AuthDO' },
  { name: 'DATABASE_LIVE', className: 'DatabaseLiveDO' },
  { name: 'ROOMS', className: 'RoomsDO' },
  { name: 'LOGS', className: 'LogsDO' },
]);
const SELF_HOST_CORE_MIGRATION_TAG = 'edgebase-self-host-core-v1';

function maskTomlComments(value: string): string {
  const characters = value.split('');
  let quote = '';
  let escaped = false;
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (quote) {
      if (quote === '"' && character === '\\' && !escaped) {
        escaped = true;
        continue;
      }
      if (character === quote && !escaped) quote = '';
      escaped = false;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character !== '#') continue;
    while (index < characters.length && characters[index] !== '\n') {
      characters[index] = ' ';
      index += 1;
    }
  }
  return characters.join('');
}

function quotedAssignment(value: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`).exec(value);
  return match?.[1] ?? null;
}

function rootTableRange(maskedToml: string, tableName: string): {
  headerStart: number;
  bodyStart: number;
  bodyEnd: number;
} | null {
  const header = new RegExp(`^[ \\t]*\\[${tableName}\\][^\\n]*(?:\\n|$)`, 'm').exec(maskedToml);
  if (!header || header.index === undefined) return null;
  const bodyStart = header.index + header[0].length;
  const nextHeader = /^[ \t]*\[(?:\[)?[^\n]+\]\]?[ \t]*(?:#.*)?$/m.exec(
    maskedToml.slice(bodyStart),
  );
  return {
    headerStart: header.index,
    bodyStart,
    bodyEnd: nextHeader?.index === undefined ? maskedToml.length : bodyStart + nextHeader.index,
  };
}

function arrayTableBlocks(maskedToml: string, tableName: string): string[] {
  const blocks: string[] = [];
  const headerPattern = new RegExp(`^[ \\t]*\\[\\[${tableName}\\]\\][^\\n]*(?:\\n|$)`, 'gm');
  for (const header of maskedToml.matchAll(headerPattern)) {
    if (header.index === undefined) continue;
    const bodyStart = header.index + header[0].length;
    const nextHeader = /^[ \t]*\[(?:\[)?[^\n]+\]\]?[ \t]*(?:#.*)?$/m.exec(
      maskedToml.slice(bodyStart),
    );
    const bodyEnd = nextHeader?.index === undefined
      ? maskedToml.length
      : bodyStart + nextHeader.index;
    blocks.push(maskedToml.slice(bodyStart, bodyEnd));
  }
  return blocks;
}

function parseQuotedArray(value: string): string[] {
  return [...value.matchAll(/["']([^"']+)["']/g)].map((match) => match[1]);
}

function ensureSelfHostRuntimeBindings(
  wranglerToml: string,
  workerName: string,
): { normalized: string; changed: boolean } {
  const masked = maskTomlComments(wranglerToml);
  const expectedDoClasses = new Map(
    SELF_HOST_DURABLE_OBJECT_BINDINGS.map(({ name, className }) => [name, className]),
  );
  const reservedBindingNames = new Set([...expectedDoClasses.keys(), 'KV', 'STORAGE']);
  const arrayBindings = new Map<string, string[]>();
  for (const tableName of [
    'kv_namespaces',
    'r2_buckets',
    'd1_databases',
    'vectorize',
    'hyperdrive',
    'services',
  ]) {
    for (const block of arrayTableBlocks(masked, tableName)) {
      const binding = quotedAssignment(block, 'binding');
      if (!binding) continue;
      const tables = arrayBindings.get(binding) ?? [];
      tables.push(tableName);
      arrayBindings.set(binding, tables);
    }
  }
  for (const reservedName of reservedBindingNames) {
    const tables = arrayBindings.get(reservedName) ?? [];
    const expectedTable = reservedName === 'KV'
      ? 'kv_namespaces'
      : (reservedName === 'STORAGE' ? 'r2_buckets' : null);
    if (
      (expectedTable === null && tables.length > 0)
      || tables.some((tableName) => tableName !== expectedTable)
      || tables.length > 1
    ) {
      throw new Error(
        `Reserved self-host binding ${reservedName} has a conflicting resource declaration.`,
      );
    }
  }

  const durableRange = rootTableRange(masked, 'durable_objects');
  const existingDoEntries: Array<{ name: string; className: string | null }> = [];
  let durableBindingMatch: RegExpExecArray | null = null;
  if (durableRange) {
    const durableBody = masked.slice(durableRange.bodyStart, durableRange.bodyEnd);
    durableBindingMatch = /\bbindings\s*=\s*\[([\s\S]*?)\]/m.exec(durableBody);
    if (durableBindingMatch) {
      for (const entry of durableBindingMatch[1].matchAll(/\{([^{}]*)\}/g)) {
        const name = quotedAssignment(entry[1], 'name');
        const className = quotedAssignment(entry[1], 'class_name');
        if (name) existingDoEntries.push({ name, className });
      }
    }
  }
  for (const reservedName of ['KV', 'STORAGE']) {
    if (existingDoEntries.some((entry) => entry.name === reservedName)) {
      throw new Error(
        `Reserved self-host binding ${reservedName} has a conflicting resource declaration.`,
      );
    }
  }
  for (const [name, className] of expectedDoClasses) {
    const matches = existingDoEntries.filter((entry) => entry.name === name);
    if (matches.length > 1 || (matches.length === 1 && matches[0].className !== className)) {
      throw new Error(`Reserved self-host binding ${name} has a conflicting Durable Object class.`);
    }
  }

  let normalized = wranglerToml;
  const missingDoBindings = SELF_HOST_DURABLE_OBJECT_BINDINGS.filter(
    ({ name }) => !existingDoEntries.some((entry) => entry.name === name),
  );
  if (missingDoBindings.length > 0) {
    const serialized = missingDoBindings
      .map(({ name, className }) => `  { name = "${name}", class_name = "${className}" }`)
      .join(',\n');
    if (!durableRange) {
      normalized = `${normalized.replace(/\s*$/, '')}\n\n[durable_objects]\nbindings = [\n${serialized}\n]\n`;
    } else if (!durableBindingMatch) {
      normalized = `${normalized.slice(0, durableRange.bodyEnd).replace(/\s*$/, '')}\n`
        + `bindings = [\n${serialized}\n]\n`
        + normalized.slice(durableRange.bodyEnd);
    } else {
      const assignmentStart = durableRange.bodyStart + durableBindingMatch.index;
      const assignmentEnd = assignmentStart + durableBindingMatch[0].length;
      const existingBody = durableBindingMatch[1].trimEnd();
      const separator = existingBody.trim().length === 0
        ? ''
        : (existingBody.trimEnd().endsWith(',') ? '\n' : ',\n');
      const replacement = `bindings = [${existingBody}${separator}${serialized}\n]`;
      normalized = normalized.slice(0, assignmentStart)
        + replacement
        + normalized.slice(assignmentEnd);
    }
  }

  const migrationClasses = new Set<string>();
  for (const match of masked.matchAll(/\bnew_sqlite_classes\s*=\s*\[([^\]]*)\]/g)) {
    for (const className of parseQuotedArray(match[1])) migrationClasses.add(className);
  }
  const missingMigrationClasses = SELF_HOST_DURABLE_OBJECT_BINDINGS
    .map(({ className }) => className)
    .filter((className) => !migrationClasses.has(className));
  if (missingMigrationClasses.length > 0) {
    if (new RegExp(`\\btag\\s*=\\s*["']${SELF_HOST_CORE_MIGRATION_TAG}["']`).test(masked)) {
      throw new Error(
        `Reserved self-host migration tag ${SELF_HOST_CORE_MIGRATION_TAG} is incomplete.`,
      );
    }
    normalized = `${normalized.replace(/\s*$/, '')}\n\n[[migrations]]\n`
      + `tag = "${SELF_HOST_CORE_MIGRATION_TAG}"\n`
      + `new_sqlite_classes = [${missingMigrationClasses.map((name) => `"${name}"`).join(', ')}]\n`;
  }

  const kvTables = arrayBindings.get('KV') ?? [];
  if (kvTables.length === 0) {
    normalized = `${normalized.replace(/\s*$/, '')}\n\n[[kv_namespaces]]\n`
      + 'binding = "KV"\nid = "local"\n';
  }
  const storageTables = arrayBindings.get('STORAGE') ?? [];
  if (storageTables.length === 0) {
    normalized = `${normalized.replace(/\s*$/, '')}\n\n[[r2_buckets]]\n`
      + `binding = "STORAGE"\nbucket_name = "${buildManagedR2BucketName(workerName)}"\n`;
  }

  return { normalized, changed: normalized !== wranglerToml };
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
  const sendEmailBinding = options.sendEmailBinding;
  if (sendEmailBinding !== undefined && !isSafeWorkerBindingName(sendEmailBinding)) {
    throw new Error(
      `Cloudflare email binding '${String(sendEmailBinding)}' is invalid. `
      + 'Use a JavaScript identifier such as EMAIL or TRANSACTIONAL_EMAIL.',
    );
  }
  const replaceTriggers = options.triggerMode === 'replace';
  const managedCrons = replaceTriggers ? options.managedCrons : [];

  const original = readFileSync(wranglerPath, 'utf-8');
  assertNoProtectedWranglerRuntimeSelectors(original);
  const { normalized: runtimeNormalized, changed: normalizedRuntimeMode } =
    ensureRuntimeModeVar(original, options.runtimeMode);
  const { normalized: compatibilityNormalized, changed: normalizedCompatibilityFlags } =
    ensureRequiredCompatibilityFlags(
      runtimeNormalized,
      options.requiredCompatibilityFlags,
    );
  const { normalized: normalizedOriginal, changed: normalizedAssetsRouting } =
    ensureManagedAssetsBlock(compatibilityNormalized);
  const workerName = extractWranglerWorkerName(original) || 'edgebase';
  const {
    normalized: selfHostNormalized,
    changed: normalizedSelfHostBindings,
  } = options.ensureSelfHostRuntimeBindings
    ? ensureSelfHostRuntimeBindings(normalizedOriginal, workerName)
    : { normalized: normalizedOriginal, changed: false };

  if (
    bindings.length === 0 &&
    !replaceTriggers &&
    rateLimitBindings.length === 0 &&
    !sendEmailBinding &&
    !normalizedRuntimeMode &&
    !normalizedCompatibilityFlags &&
    !normalizedAssetsRouting &&
    !normalizedSelfHostBindings
  ) {
    return null;
  }

  const kvBindingNames = new Set(
    bindings.filter((binding) => binding.type === 'kv_namespace').map((binding) => binding.binding),
  );
  const d1BindingNames = new Set(
    bindings.filter((binding) => binding.type === 'd1_database').map((binding) => binding.binding),
  );
  const rateLimitBindingNames = new Set(rateLimitBindings.map((binding) => binding.binding));
  const hasRequiredSendEmailBinding = sendEmailBinding
    ? [...selfHostNormalized.matchAll(
        /(?:^|\n)\[\[send_email\]\]([\s\S]*?)(?=\n\[\[|\n\[|$)/g,
      )].some((match) => {
        const nameMatch = match[1].match(/^\s*name\s*=\s*["']([^"']+)["']\s*$/m);
        return nameMatch?.[1] === sendEmailBinding;
      })
    : false;
  let sanitizedOriginal =
    rateLimitBindingNames.size > 0
      ? selfHostNormalized.replace(/\n?\[\[unsafe\.bindings\]\][\s\S]*?(?=\n\[\[|\n\[|$)/g, (block) => {
          const nameMatch = block.match(/^\s*name\s*=\s*"([^"]+)"/m);
          if (nameMatch && rateLimitBindingNames.has(nameMatch[1])) {
            return '';
          }
          return block;
        })
      : selfHostNormalized;
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

  if (sendEmailBinding && !hasRequiredSendEmailBinding) {
    appendManagedSection(`[[send_email]]\nname = ${JSON.stringify(sendEmailBinding)}`);
  }

  if (replaceTriggers) {
    appendManagedSection(`[triggers]\ncrons = [${managedCrons.map((c) => `"${c}"`).join(', ')}]`);
  }

  if (
    !didAppend
    && !normalizedAssetsRouting
    && !normalizedRuntimeMode
    && !normalizedCompatibilityFlags
    && !normalizedSelfHostBindings
    && (!sendEmailBinding || hasRequiredSendEmailBinding)
  ) return null;

  const tempDir = dirname(wranglerPath);
  const tempPath = join(tempDir, `.wrangler.generated.${randomBytes(6).toString('hex')}.toml`);
  writeFileSync(tempPath, sections.join('\n') + '\n', 'utf-8');
  return tempPath;
}
