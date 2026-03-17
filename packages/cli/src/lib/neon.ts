import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { npxCommand } from './npx.js';

const NEONCTL_PACKAGE = 'neonctl@latest';
const POSTGRES_PROTOCOLS = ['postgres://', 'postgresql://'];

export interface RunNeonctlOptions {
  apiKey?: string;
  configDir?: string;
  cwd?: string;
  output?: 'json' | 'yaml' | 'table';
}

export interface NeonBranchSummary {
  id?: string;
  name: string;
  default?: boolean;
  primary?: boolean;
}

export interface NeonOrganizationSummary {
  id: string;
  name: string;
  handle?: string;
}

export interface NeonProjectSummary {
  id: string;
  name: string;
  orgId?: string;
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function formatExecError(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return String(error);
  }

  const err = error as Error & {
    stdout?: string | Buffer;
    stderr?: string | Buffer;
  };

  const stderr = typeof err.stderr === 'string'
    ? err.stderr.trim()
    : Buffer.isBuffer(err.stderr)
      ? err.stderr.toString('utf-8').trim()
      : '';
  if (stderr) return stderr;

  const stdout = typeof err.stdout === 'string'
    ? err.stdout.trim()
    : Buffer.isBuffer(err.stdout)
      ? err.stdout.toString('utf-8').trim()
      : '';
  if (stdout) return stdout;

  return err.message;
}

function findConnectionString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (POSTGRES_PROTOCOLS.some((prefix) => trimmed.startsWith(prefix))) {
      return trimmed;
    }
    return undefined;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findConnectionString(entry);
      if (found) return found;
    }
    return undefined;
  }

  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const key of [
    'connection_string',
    'connectionString',
    'uri',
    'url',
    'dsn',
    'connection_uri',
    'connectionUri',
  ]) {
    const found = pickString(record[key]);
    if (found && POSTGRES_PROTOCOLS.some((prefix) => found.startsWith(prefix))) {
      return found;
    }
  }

  for (const nested of Object.values(record)) {
    const found = findConnectionString(nested);
    if (found) return found;
  }

  return undefined;
}

export function getDefaultPostgresEnvKey(namespace: string): string {
  return `DB_POSTGRES_${namespace.toUpperCase().replace(/-/g, '_')}_URL`;
}

export function buildNeonctlArgs(
  commandArgs: string[],
  options: RunNeonctlOptions = {},
): string[] {
  const args = ['-y', NEONCTL_PACKAGE, ...commandArgs];
  if (options.output) args.push('--output', options.output);
  if (options.configDir) args.push('--config-dir', options.configDir);
  if (options.apiKey) args.push('--api-key', options.apiKey);
  return args;
}

export function runNeonctl(
  commandArgs: string[],
  options: RunNeonctlOptions = {},
): string {
  try {
    return execFileSync(
      npxCommand(),
      buildNeonctlArgs(commandArgs, options),
      {
        cwd: options.cwd,
        encoding: 'utf-8',
        stdio: ['inherit', 'pipe', 'pipe'],
      },
    );
  } catch (error) {
    throw new Error(formatExecError(error));
  }
}

export function runNeonctlInteractive(
  commandArgs: string[],
  options: RunNeonctlOptions = {},
): void {
  try {
    execFileSync(
      npxCommand(),
      buildNeonctlArgs(commandArgs, options),
      {
        cwd: options.cwd,
        stdio: 'inherit',
      },
    );
  } catch (error) {
    throw new Error(formatExecError(error));
  }
}

export function parseNeonConnectionString(rawOutput: string): string {
  const trimmed = rawOutput.trim();
  if (!trimmed) {
    throw new Error('Neon CLI returned an empty response.');
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const found = findConnectionString(parsed);
    if (found) return found;
  } catch {
    // Not JSON — fall through to raw line parsing.
  }

  const line = trimmed
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => POSTGRES_PROTOCOLS.some((prefix) => entry.startsWith(prefix)));
  if (line) return line;

  throw new Error('Neon CLI did not return a PostgreSQL connection string.');
}

export function parseNeonBranches(rawOutput: string): NeonBranchSummary[] {
  const trimmed = rawOutput.trim();
  if (!trimmed) return [];

  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
    .map((entry) => ({
      id: pickString(entry.id),
      name: pickString(entry.name) ?? pickString(entry.slug) ?? '',
      default: entry.default === true,
      primary: entry.primary === true,
    }))
    .filter((entry) => entry.name.length > 0);
}

export function parseNeonOrganizations(rawOutput: string): NeonOrganizationSummary[] {
  const trimmed = rawOutput.trim();
  if (!trimmed) return [];

  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
    .map((entry) => ({
      id: pickString(entry.id) ?? '',
      name: pickString(entry.name) ?? '',
      handle: pickString(entry.handle),
    }))
    .filter((entry) => entry.id.length > 0 && entry.name.length > 0);
}

export function parseNeonProjects(rawOutput: string): NeonProjectSummary[] {
  const trimmed = rawOutput.trim();
  if (!trimmed) return [];

  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
    .map((entry) => ({
      id: pickString(entry.id) ?? '',
      name: pickString(entry.name) ?? '',
      orgId: pickString(entry.org_id) ?? pickString(entry.owner_id),
    }))
    .filter((entry) => entry.id.length > 0 && entry.name.length > 0);
}

export function parseNeonProject(rawOutput: string): NeonProjectSummary | null {
  const trimmed = rawOutput.trim();
  if (!trimmed) return null;

  const parsed = JSON.parse(trimmed) as unknown;
  if (Array.isArray(parsed)) {
    return parseNeonProjects(trimmed)[0] ?? null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const record = parsed as Record<string, unknown>;
  const nestedProject = record.project;
  if (nestedProject && typeof nestedProject === 'object') {
    const nestedRecord = nestedProject as Record<string, unknown>;
    const nestedId = pickString(nestedRecord.id);
    const nestedName = pickString(nestedRecord.name);
    if (nestedId && nestedName) {
      return {
        id: nestedId,
        name: nestedName,
        orgId: pickString(nestedRecord.org_id) ?? pickString(nestedRecord.owner_id),
      };
    }
  }

  const id = pickString(record.id);
  const name = pickString(record.name);
  if (!id || !name) return null;

  return {
    id,
    name,
    orgId: pickString(record.org_id) ?? pickString(record.owner_id),
  };
}

export function parseNeonNamedItems(rawOutput: string): string[] {
  const trimmed = rawOutput.trim();
  if (!trimmed) return [];

  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
    .map((entry) => pickString(entry.name) ?? '')
    .filter((entry) => entry.length > 0);
}

export function listNeonOrganizations(
  options: RunNeonctlOptions = {},
): NeonOrganizationSummary[] {
  const output = runNeonctl(
    ['orgs', 'list'],
    { ...options, output: 'json' },
  );
  return parseNeonOrganizations(output);
}

export function listNeonProjects(
  orgId: string,
  options: RunNeonctlOptions = {},
): NeonProjectSummary[] {
  const output = runNeonctl(
    ['project', 'list', '--org-id', orgId],
    { ...options, output: 'json' },
  );
  return parseNeonProjects(output);
}

export function listNeonBranches(
  projectId: string,
  options: RunNeonctlOptions = {},
): NeonBranchSummary[] {
  const output = runNeonctl(
    ['branches', 'list', '--project-id', projectId],
    { ...options, output: 'json' },
  );
  return parseNeonBranches(output);
}

export function listNeonDatabases(
  projectId: string,
  branch: string | undefined,
  options: RunNeonctlOptions = {},
): string[] {
  const args = ['database', 'list', '--project-id', projectId];
  if (branch) args.push('--branch', branch);
  const output = runNeonctl(args, { ...options, output: 'json' });
  return parseNeonNamedItems(output);
}

export function listNeonRoles(
  projectId: string,
  branch: string | undefined,
  options: RunNeonctlOptions = {},
): string[] {
  const args = ['role', 'list', '--project-id', projectId];
  if (branch) args.push('--branch', branch);
  const output = runNeonctl(args, { ...options, output: 'json' });
  return parseNeonNamedItems(output);
}

export function upsertEnvValue(
  filePath: string,
  key: string,
  value: string,
  headerComment: string,
): void {
  if (!existsSync(filePath)) {
    const freshContent = [headerComment, '', `${key}=${value}`, ''].join('\n');
    writeFileSync(filePath, freshContent, 'utf-8');
    chmodSync(filePath, 0o600);
    return;
  }

  const lines = readFileSync(filePath, 'utf-8').split(/\r?\n/);
  const updatedLines: string[] = [];
  let replaced = false;

  for (const line of lines) {
    if (line.trimStart().startsWith(`${key}=`)) {
      if (!replaced) {
        updatedLines.push(`${key}=${value}`);
        replaced = true;
      }
      continue;
    }
    updatedLines.push(line);
  }

  if (!replaced) {
    while (updatedLines.length > 0 && updatedLines[updatedLines.length - 1] === '') {
      updatedLines.pop();
    }
    if (updatedLines.length > 0) updatedLines.push('');
    updatedLines.push(`${key}=${value}`);
  }

  updatedLines.push('');
  writeFileSync(filePath, updatedLines.join('\n'), 'utf-8');
  chmodSync(filePath, 0o600);
}

export function removeEnvValue(filePath: string, key: string): void {
  if (!existsSync(filePath)) return;

  const lines = readFileSync(filePath, 'utf-8').split(/\r?\n/);
  const updatedLines: string[] = [];
  let removed = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      updatedLines.push(line);
      continue;
    }

    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) {
      updatedLines.push(line);
      continue;
    }

    const existingKey = line.slice(0, eqIdx).trim();
    if (existingKey === key) {
      removed = true;
      continue;
    }

    updatedLines.push(line);
  }

  if (!removed) return;

  while (updatedLines.length > 1 && updatedLines[updatedLines.length - 1] === '' && updatedLines[updatedLines.length - 2] === '') {
    updatedLines.pop();
  }
  if (updatedLines.length === 0 || updatedLines[updatedLines.length - 1] !== '') {
    updatedLines.push('');
  }

  writeFileSync(filePath, updatedLines.join('\n'), 'utf-8');
  chmodSync(filePath, 0o600);
}

export function writeProjectEnvValue(
  projectDir: string,
  fileName: '.env.development' | '.env.release',
  key: string,
  value: string,
): string {
  const filePath = join(projectDir, fileName);
  upsertEnvValue(
    filePath,
    key,
    value,
    fileName === '.env.development'
      ? '# EdgeBase local development secrets'
      : '# EdgeBase production secrets',
  );
  return filePath;
}
