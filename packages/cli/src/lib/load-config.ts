/**
 * Safe config loading — evaluates edgebase.config.ts without shell injection risk.
 *
 * Uses execFileSync (no shell) + temp script file with JSON.stringify'd paths
 * to prevent command injection via malicious file paths.
 *
 * Three strategies (tsx → esbuild → regex), matching typegen.ts fallback chain.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildBundleWithEsbuild, execTsxSync } from './node-tools.js';
import { ensureProjectSharedPackageLink } from './runtime-scaffold.js';

/**
 * Extract the config JSON from stdout, ignoring any noise before the sentinel.
 * This prevents console.log in user config files or imported modules from
 * corrupting the JSON output.
 */
function extractConfigFromOutput(raw: string, sentinel: string): string {
  const idx = raw.lastIndexOf(sentinel);
  if (idx === -1) {
    // Fallback: try parsing the last non-empty line (legacy behavior)
    const lines = raw.trim().split('\n');
    return lines[lines.length - 1];
  }
  return raw.slice(idx + sentinel.length);
}

function firstUsefulLine(value: string): string | null {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return null;
  return (
    lines.find((line) => line.startsWith('Error:')) ??
    lines.find((line) => /^Transform failed|^Build failed/.test(line)) ??
    lines[0]
  );
}

function summarizeLoadConfigError(error: unknown): string {
  const baseMessage = error instanceof Error ? error.message.split('\n')[0] : String(error);
  if (!error || typeof error !== 'object') return baseMessage;

  const stderr =
    typeof (error as { stderr?: unknown }).stderr === 'string'
      ? (error as { stderr: string }).stderr
      : '';
  const stdout =
    typeof (error as { stdout?: unknown }).stdout === 'string'
      ? (error as { stdout: string }).stdout
      : '';

  const detail = firstUsefulLine(stderr) ?? firstUsefulLine(stdout);
  if (!detail || baseMessage.includes(detail)) return baseMessage;
  return `${baseMessage} | ${detail}`;
}

/**
 * Safely evaluate edgebase.config.ts via tsx and return the config as a plain object.
 * Falls back to esbuild, then regex parsing if tsx is unavailable.
 *
 * @param configPath - Absolute or relative path to the config file
 * @param cwd - Working directory for evaluation
 * @param options.stripFunctions - Remove function values (default: true)
 * @param options.allowRegexFallback - Allow schema-only regex parsing when evaluation fails (default: true)
 */
export function loadConfigSafe(
  configPath: string,
  cwd: string,
  options?: { stripFunctions?: boolean; allowRegexFallback?: boolean },
): Record<string, unknown> {
  const stripFns = options?.stripFunctions !== false;
  const allowRegexFallback = options?.allowRegexFallback !== false;
  const absPath = resolve(cwd, configPath);
  const configUrl = pathToFileURL(absPath).href;
  const tmpDir = join(cwd, '.edgebase');
  mkdirSync(tmpDir, { recursive: true });
  ensureProjectSharedPackageLink(cwd);
  let tsxError: string | null = null;
  let esbuildError: string | null = null;

  // Strategy 1: tsx eval via temp script (safest, most accurate)
  //
  // Uses a unique sentinel prefix so we can reliably extract the JSON config
  // even if imported modules write to stdout (e.g. console.log in dependencies).
  try {
    const tmpScript = join(tmpDir, '_config_eval.mjs');
    const sentinel = '__EDGEBASE_CONFIG_JSON__';
    const replacer = stripFns
      ? `(_, v) => typeof v === 'function' ? '__EDGEBASE_FUNCTION__' : v`
      : `undefined`;
    const code = [
      `const p = ${JSON.stringify(configUrl)};`,
      `const mod = await import(p);`,
      `const c = mod.default ?? mod;`,
      `process.stdout.write(${JSON.stringify(sentinel)} + JSON.stringify(c, ${replacer}));`,
    ].join('\n');

    writeFileSync(tmpScript, code, 'utf-8');
    try {
      const raw = execTsxSync([tmpScript], {
        cwd,
        encoding: 'utf-8',
        timeout: 15000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const result = extractConfigFromOutput(raw, sentinel);
      return JSON.parse(result);
    } finally {
      try {
        unlinkSync(tmpScript);
      } catch {
        /* cleanup non-fatal */
      }
    }
  } catch (err) {
    tsxError = summarizeLoadConfigError(err);
    // tsx not available or config error — fall through
  }

  // Strategy 2: esbuild bundle + node eval
  try {
    const tmpBundle = join(tmpDir, '_config_eval_bundle.mjs');
    buildBundleWithEsbuild(absPath, tmpBundle, cwd);

    const tmpEvalScript = join(tmpDir, '_config_eval2.mjs');
    const sentinel = '__EDGEBASE_CONFIG_JSON__';
    const replacer = stripFns
      ? `(_, v) => typeof v === 'function' ? '__EDGEBASE_FUNCTION__' : v`
      : `undefined`;
    const code = [
      `const p = ${JSON.stringify(pathToFileURL(tmpBundle).href)};`,
      `const mod = await import(p);`,
      `const c = mod.default ?? mod;`,
      `process.stdout.write(${JSON.stringify(sentinel)} + JSON.stringify(c, ${replacer}));`,
    ].join('\n');
    writeFileSync(tmpEvalScript, code, 'utf-8');

    try {
      const raw = execFileSync(process.execPath, [tmpEvalScript], {
        cwd,
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const result = extractConfigFromOutput(raw, sentinel);
      return JSON.parse(result);
    } finally {
      try {
        unlinkSync(tmpBundle);
      } catch {
        /* cleanup non-fatal */
      }
      try {
        unlinkSync(tmpEvalScript);
      } catch {
        /* cleanup non-fatal */
      }
    }
  } catch (err) {
    esbuildError = summarizeLoadConfigError(err);
    // Both strategies failed — fall through to regex
  }

  if (!allowRegexFallback) {
    const messages = [tsxError, esbuildError].filter((err): err is string => Boolean(err));
    const detail = messages.length > 0 ? ` ${messages.join(' | ')}` : '';
    throw new Error(`Failed to fully evaluate edgebase.config.ts.${detail}`.trim());
  }

  // Strategy 3: regex-based fallback (no execution required)
  return parseConfigRegex(configPath);
}

// ─── Regex fallback parser ───

/**
 * Find the index of the closing brace that balances the opening brace at `openIndex`.
 * Returns -1 if no matching brace is found.
 */
function findMatchingBrace(content: string, openIndex: number): number {
  let depth = 1;
  for (let i = openIndex + 1; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractNamedObjectBlock(content: string, key: string): string | null {
  const pattern = new RegExp(`\\b${key}\\s*:\\s*\\{`, 'm');
  const match = pattern.exec(content);
  if (!match) return null;
  const openIndex = content.indexOf('{', match.index);
  if (openIndex === -1) return null;
  const closeIndex = findMatchingBrace(content, openIndex);
  if (closeIndex === -1) return null;
  return content.slice(openIndex + 1, closeIndex);
}

function extractTopLevelObjectEntries(block: string): Record<string, string> {
  const entries: Record<string, string> = {};
  let cursor = 0;

  while (cursor < block.length) {
    const keyMatch = /\b([A-Za-z_]\w*)\b/g;
    keyMatch.lastIndex = cursor;
    const match = keyMatch.exec(block);
    if (!match) break;

    const key = match[1];
    let index = keyMatch.lastIndex;
    while (index < block.length && /\s/.test(block[index])) index++;
    if (block[index] !== ':') {
      cursor = index + 1;
      continue;
    }

    index += 1;
    while (index < block.length && /\s/.test(block[index])) index++;
    if (block[index] !== '{') {
      cursor = index + 1;
      continue;
    }

    const closeIndex = findMatchingBrace(block, index);
    if (closeIndex === -1) break;
    entries[key] = block.slice(index + 1, closeIndex);
    cursor = closeIndex + 1;
  }

  return entries;
}

/** Exported for testing. */
export function parseConfigRegex(configPath: string): Record<string, unknown> {
  const content = readFileSync(configPath, 'utf-8');
  const result: Record<string, unknown> = {};

  const databases: Record<string, { tables: Record<string, unknown> }> = {};

  const databasesBlock = extractNamedObjectBlock(content, 'databases');
  if (databasesBlock) {
    for (const [dbKey, dbContent] of Object.entries(extractTopLevelObjectEntries(databasesBlock))) {
      const tablesBlock = extractNamedObjectBlock(dbContent, 'tables');
      if (!tablesBlock) continue;
      const tables = extractTablesFromBlock(tablesBlock);
      if (Object.keys(tables).length > 0) {
        databases[dbKey] = { tables };
      }
    }
  }

  if (Object.keys(databases).length > 0) {
    result.databases = databases;
  }

  return result;
}

function extractTablesFromBlock(block: string): Record<string, unknown> {
  const tables: Record<string, unknown> = {};
  for (const [name, tableContent] of Object.entries(extractTopLevelObjectEntries(block))) {
    const schemaBlock = extractNamedObjectBlock(tableContent, 'schema');
    if (!schemaBlock) continue;
    const schema = extractSchemaFields(schemaBlock);
    tables[name] = { schema };
  }

  return tables;
}

function extractSchemaFields(block: string): Record<string, unknown> {
  const schema: Record<string, unknown> = {};
  for (const [name, fieldContent] of Object.entries(extractTopLevelObjectEntries(block))) {
    if (['required', 'unique'].includes(name)) continue;
    const typeMatch = /type\s*:\s*['"](\w+)['"]/.exec(fieldContent);
    if (!typeMatch) continue;
    const field: Record<string, unknown> = { type: typeMatch[1] };
    const rest = fieldContent;
    if (/required\s*:\s*true/.test(rest)) field.required = true;
    const referenceMatch =
      /references\s*:\s*['"]([^'"]+)['"]/.exec(rest) ??
      /references\s*:\s*\{[\s\S]*?table\s*:\s*['"]([^'"]+)['"]/.exec(rest);
    if (referenceMatch) field.references = referenceMatch[1];
    const enumMatch = /enum\s*:\s*\[([^\]]+)\]/.exec(rest);
    if (enumMatch) {
      field.enum = enumMatch[1]
        .split(',')
        .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    }
    schema[name] = field;
  }
  const falsePattern = /(\w+)\s*:\s*false/g;
  let fm;
  while ((fm = falsePattern.exec(block)) !== null) {
    if (!['required', 'unique'].includes(fm[1])) schema[fm[1]] = false;
  }
  return schema;
}
