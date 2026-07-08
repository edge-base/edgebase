import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Upsert `values` into an env file while preserving existing comments,
 * ordering, and unrelated keys. Existing keys are patched in place; new keys
 * are appended. Only creates the file (with `comment` header) if it is missing.
 */
export function upsertEnvFile(filePath: string, values: Record<string, string>, comment: string): void {
  const exists = existsSync(filePath);
  const raw = exists ? readFileSync(filePath, 'utf-8') : '';
  const remaining: Record<string, string> = { ...values };

  const hadTrailingNewline = raw.endsWith('\n');
  const lines = raw.length > 0 ? raw.replace(/\n$/, '').split('\n') : [];

  const patched = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) return line;
    const key = trimmed.slice(0, eqIdx).trim();
    if (Object.prototype.hasOwnProperty.call(remaining, key)) {
      const value = remaining[key];
      delete remaining[key];
      return `${key}=${value}`;
    }
    return line;
  });

  if (!exists && patched.length === 0) {
    patched.push(comment);
  }

  for (const [key, value] of Object.entries(remaining)) {
    patched.push(`${key}=${value}`);
  }

  const content = patched.join('\n') + (patched.length > 0 || hadTrailingNewline ? '\n' : '');
  writeFileSync(filePath, content, 'utf-8');
  chmodSync(filePath, 0o600);
}

function readSecretsJson(projectDir: string): Record<string, string> {
  const filePath = join(projectDir, '.edgebase', 'secrets.json');
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeSecretsJson(projectDir: string, values: Record<string, string>): void {
  const edgebaseDir = join(projectDir, '.edgebase');
  if (!existsSync(edgebaseDir)) mkdirSync(edgebaseDir, { recursive: true });
  const filePath = join(edgebaseDir, 'secrets.json');
  writeFileSync(filePath, JSON.stringify(values, null, 2) + '\n', 'utf-8');
  chmodSync(filePath, 0o600);
}

export function writeLocalSecrets(projectDir: string, values: Record<string, string>): void {
  const envDevPath = join(projectDir, '.env.development');
  const devVarsPath = join(projectDir, '.dev.vars');
  const primaryPath = (existsSync(envDevPath) || !existsSync(devVarsPath))
    ? envDevPath
    : devVarsPath;

  // Patch only the generated secrets into each file, preserving any existing
  // comments, ordering, and hand-maintained keys.
  upsertEnvFile(primaryPath, values, '# EdgeBase local development secrets');

  if (primaryPath !== devVarsPath) {
    upsertEnvFile(devVarsPath, values, '# EdgeBase local development secrets (synced)');
  }

  writeSecretsJson(projectDir, { ...readSecretsJson(projectDir), ...values });
}
