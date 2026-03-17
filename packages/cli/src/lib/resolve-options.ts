/**
 * Shared utilities for resolving common CLI options:
 * - Service Key (--service-key / EDGEBASE_SERVICE_KEY / .edgebase/secrets.json)
 * - Server URL (--url / EDGEBASE_URL)
 *
 * Eliminates duplication across backup, export, admin, seed commands.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { raiseNeedsInput } from './agent-contract.js';

/**
 * Resolve Service Key from multiple sources (flag → env → secrets file).
 * Exits with helpful error if not found.
 *
 * Resolution order:
 * 1. --service-key flag
 * 2. EDGEBASE_SERVICE_KEY environment variable
 * 3. .edgebase/secrets.json file (auto-saved after deploy)
 */
export function resolveServiceKey(options: { serviceKey?: string }): string {
  const resolved = resolveOptionalServiceKey(options);
  if (resolved) return resolved;

  raiseNeedsInput({
    code: 'service_key_required',
    field: 'serviceKey',
    message: 'Service Key required.',
    hint: 'Provide --service-key <key>, set EDGEBASE_SERVICE_KEY, or deploy once so .edgebase/secrets.json is populated.',
    choices: [{
      label: 'Provide service key flag',
      value: 'service-key',
      args: ['--service-key', '<key>'],
      hint: 'Use an admin Service Key with backup/export/admin commands.',
    }],
  });
}

/**
 * Resolve Service Key from multiple sources without requiring one to exist.
 *
 * Resolution order:
 * 1. --service-key flag
 * 2. EDGEBASE_SERVICE_KEY environment variable
 * 3. .edgebase/secrets.json file (auto-saved after deploy)
 */
export function resolveOptionalServiceKey(options: { serviceKey?: string }): string | undefined {
  // 1. CLI flag
  if (options.serviceKey) return options.serviceKey;

  // 2. Environment variable
  const envKey = process.env.EDGEBASE_SERVICE_KEY;
  if (envKey) return envKey;

  // 3. .edgebase/secrets.json (auto-saved after first deploy)
  const projectDir = process.cwd();
  const secretsPath = join(projectDir, '.edgebase', 'secrets.json');
  if (existsSync(secretsPath)) {
    try {
      const secrets = JSON.parse(readFileSync(secretsPath, 'utf-8'));
      if (secrets.SERVICE_KEY) return secrets.SERVICE_KEY;
    } catch {
      /* ignore corrupted file */
    }
  }

  return undefined;
}

/**
 * Resolve server URL from flag or environment variable.
 * Exits with helpful error if not found (when required=true).
 *
 * Resolution order:
 * 1. --url flag
 * 2. EDGEBASE_URL environment variable
 */
export function resolveServerUrl(options: { url?: string }, required = true): string {
  // 1. CLI flag
  if (options.url) return options.url.replace(/\/$/, '');

  // 2. Environment variable
  const envUrl = process.env.EDGEBASE_URL;
  if (envUrl) return envUrl.replace(/\/$/, '');

  if (!required) return '';

  raiseNeedsInput({
    code: 'worker_url_required',
    field: 'url',
    message: 'Worker URL required.',
    hint: 'Provide --url <worker-url> or set EDGEBASE_URL. Typical values are http://localhost:8787 for local dev or https://<name>.workers.dev for production.',
    choices: [{
      label: 'Provide worker URL flag',
      value: 'url',
      args: ['--url', '<worker-url>'],
    }],
  });
}
