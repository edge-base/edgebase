export const REDACTED_CONFIG_VALUE = '[REDACTED]';

const MAX_CONFIG_EXPORT_DEPTH = 32;
const MAX_CONFIG_EXPORT_NODES = 20_000;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSchemaFieldName(path: string[], value: unknown): boolean {
  return normalizeKey(path.at(-1) ?? '') === 'schema'
    && !!value
    && typeof value === 'object'
    && !Array.isArray(value);
}

function isPluginConfigPath(path: string[]): boolean {
  const normalized = path.map(normalizeKey);
  const pluginsIndex = normalized.lastIndexOf('plugins');
  return pluginsIndex !== -1
    && normalized.slice(pluginsIndex + 1).includes('config');
}

function isSensitiveConfigKey(key: string, path: string[], value: unknown): boolean {
  if (isSchemaFieldName(path, value)) return false;
  const normalized = normalizeKey(key);
  if (!normalized) return true;
  const normalizedPath = path.map(normalizeKey);

  // Plugin/extension config has no enforceable schema, so a name heuristic
  // can never prove that an innocuous-looking key is public. Keep only the
  // extension identity and redact its entire opaque config payload.
  if (
    normalized === 'config'
    && normalizedPath.some((segment) => segment === 'plugins' || segment === 'extensions')
  ) return true;

  if (
    normalized === 'secret'
    || normalized === 'secrets'
    || normalized.endsWith('secret')
    || normalized.endsWith('secrets')
    || normalized.startsWith('clientsecret')
    || normalized.startsWith('privatekey')
    || normalized.includes('passwordhash')
    || normalized === 'password'
    || normalized.endsWith('password')
    || normalized === 'token'
    || normalized === 'tokens'
    || normalized.endsWith('token')
    || normalized.endsWith('tokens')
    || normalized === 'apikey'
    || normalized.startsWith('apikey')
    || normalized.endsWith('apikey')
    || normalized === 'apisecret'
    || normalized === 'inlinesecret'
    || normalized === 'connectionstring'
    || normalized.endsWith('connectionstring')
    || normalized === 'accountid'
    || normalized.endsWith('accountid')
    || normalized === 'credential'
    || normalized === 'credentials'
    || normalized.endsWith('credential')
    || normalized.endsWith('credentials')
    || normalized === 'authorization'
    || normalized === 'cookie'
    || normalized === 'setcookie'
    || normalized === 'signingkey'
    || normalized === 'secretkey'
    || normalized === 'accesskey'
    || normalized === 'licensekey'
  ) return true;

  if (
    path.some((segment) => normalizeKey(segment) === 'schema')
    && (normalized === 'default' || normalized === 'example' || normalized === 'examples')
  ) return true;

  return isPluginConfigPath(path)
    && (
      normalized === 'key'
      || normalized === 'auth'
      || normalized === 'license'
      || normalized.endsWith('key')
      || normalized.includes('credential')
    );
}

function stringContainsCredential(value: string): boolean {
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i.test(value)) return true;
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return true;
  if (/^(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9_-]{12,}$/i.test(value)) return true;

  try {
    const url = new URL(value);
    if (url.username.length > 0 || url.password.length > 0) return true;
    const sensitiveUrlName = (name: string) => {
      const normalized = normalizeKey(name);
      return normalized === 'key'
        || normalized.includes('token')
        || normalized.includes('secret')
        || normalized.includes('password')
        || normalized.includes('signature')
        || normalized.includes('credential')
        || normalized.includes('apikey')
        || normalized.includes('accesskey');
    };
    for (const name of url.searchParams.keys()) {
      if (sensitiveUrlName(name)) return true;
    }
    const pathSegments = url.pathname.split('/').filter(Boolean);
    const lastPathSegment = pathSegments.at(-1) ?? '';
    if (
      lastPathSegment.length >= 16
      && /[-_0-9A-Z]/.test(lastPathSegment)
      && new Set(lastPathSegment.toLowerCase()).size >= 8
    ) return true;
    const fragment = url.hash.slice(1);
    if (fragment) {
      const fragmentParams = new URLSearchParams(fragment);
      for (const name of fragmentParams.keys()) {
        if (fragment.includes('=') && sensitiveUrlName(name)) return true;
      }
      if (
        /(?:token|secret|password|signature|credential|api[\s._-]*key|access[\s._-]*key)\s*[:=]/i
          .test(fragment)
        || /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(fragment)
        || /^(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9_-]{12,}$/i.test(fragment)
      ) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Return a JSON-safe, fail-closed config snapshot for support/backup tooling.
 * The export describes enabled features and schemas; it is never a credential
 * recovery mechanism.
 */
export function sanitizeConfigForBackup(value: unknown): unknown {
  const seen = new WeakSet<object>();
  let nodes = 0;

  const visit = (current: unknown, path: string[], depth: number): unknown => {
    nodes += 1;
    if (nodes > MAX_CONFIG_EXPORT_NODES || depth > MAX_CONFIG_EXPORT_DEPTH) {
      return REDACTED_CONFIG_VALUE;
    }
    if (current === null || typeof current === 'boolean' || typeof current === 'number') {
      return current;
    }
    if (typeof current === 'string') {
      return stringContainsCredential(current) ? REDACTED_CONFIG_VALUE : current;
    }
    if (typeof current !== 'object') return REDACTED_CONFIG_VALUE;
    if (seen.has(current)) return REDACTED_CONFIG_VALUE;
    seen.add(current);

    if (Array.isArray(current)) {
      return current.map((entry, index) => visit(entry, [...path, String(index)], depth + 1));
    }

    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(current as Record<string, unknown>)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) {
        result[key] = REDACTED_CONFIG_VALUE;
        continue;
      }
      if (isSensitiveConfigKey(key, path, entry)) {
        result[key] = REDACTED_CONFIG_VALUE;
        continue;
      }
      result[key] = visit(entry, [...path, key], depth + 1);
    }
    return result;
  };

  return visit(value, [], 0);
}
