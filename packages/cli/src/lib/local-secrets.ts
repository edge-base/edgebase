import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx <= 0) continue;
    result[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
  }
  return result;
}

function writeEnvFile(filePath: string, values: Record<string, string>, comment: string): void {
  const content = [
    comment,
    ...Object.entries(values).map(([key, value]) => `${key}=${value}`),
    '',
  ].join('\n');
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
  const existingPrimary = existsSync(primaryPath)
    ? parseEnvContent(readFileSync(primaryPath, 'utf-8'))
    : {};
  const mergedPrimary = { ...existingPrimary, ...values };

  writeEnvFile(primaryPath, mergedPrimary, '# EdgeBase local development secrets');

  if (primaryPath !== devVarsPath) {
    writeEnvFile(devVarsPath, mergedPrimary, '# EdgeBase local development secrets (synced)');
  }

  writeSecretsJson(projectDir, { ...readSecretsJson(projectDir), ...values });
}
