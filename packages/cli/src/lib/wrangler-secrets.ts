import { execFileSync } from 'node:child_process';
import { wranglerArgs, wranglerCommand } from './wrangler.js';

interface WranglerSecretListEntry {
  name?: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseWranglerSecretNames(output: string): Set<string> {
  const parsed = JSON.parse(output) as unknown;
  const entries = Array.isArray(parsed)
    ? parsed
    : isObject(parsed) && Array.isArray(parsed.result)
      ? parsed.result
      : null;

  if (!entries) {
    throw new Error('Unexpected Wrangler secret list format.');
  }

  const names = new Set<string>();
  for (const entry of entries as WranglerSecretListEntry[]) {
    if (typeof entry?.name === 'string') {
      names.add(entry.name);
    }
  }

  return names;
}

export function listWranglerSecretNames(projectDir: string): Set<string> {
  const output = execFileSync(
    wranglerCommand(),
    wranglerArgs(['wrangler', 'secret', 'list', '--format', 'json']),
    {
      cwd: projectDir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );

  return parseWranglerSecretNames(output);
}
