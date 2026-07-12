import type { Env } from '../types.js';
import { parseConfig } from './do-router.js';

type HeaderReader = Request | {
  url: string;
  header: (name: string) => string | undefined;
  raw?: Request;
};

function readHeader(reader: HeaderReader, name: string): string | undefined {
  if (reader instanceof Request) {
    return reader.headers.get(name) ?? undefined;
  }
  return reader.header(name) ?? reader.raw?.headers.get(name) ?? undefined;
}

function runtimeMode(env: unknown): unknown {
  if (!env || typeof env !== 'object' || Array.isArray(env)) return undefined;
  return (env as unknown as Record<string, unknown>).EDGEBASE_RUNTIME_MODE;
}

/** True only when CLI-owned runtime identity and config jointly trust proxy headers. */
export function trustsSelfHostedProxyHeaders(env: unknown): boolean {
  if (runtimeMode(env) !== 'self-hosted') return false;
  if (env && typeof env === 'object' && !Array.isArray(env)) {
    const direct = (env as Record<string, unknown>).trustSelfHostedProxy;
    if (typeof direct === 'boolean') return direct;
  }
  return parseConfig(env).trustSelfHostedProxy === true;
}

function firstForwardedValue(value: string | undefined): string | undefined {
  const first = value?.split(',')[0]?.trim();
  return first || undefined;
}

function forwardedProtocol(reader: HeaderReader): 'http:' | 'https:' | undefined {
  const value = firstForwardedValue(readHeader(reader, 'x-forwarded-proto'))?.toLowerCase();
  if (value === 'http' || value === 'https') return `${value}:`;
  return undefined;
}

function forwardedHost(reader: HeaderReader, protocol: 'http:' | 'https:'): string | undefined {
  const value = firstForwardedValue(readHeader(reader, 'x-forwarded-host'));
  if (!value || /[\\/@\s]/.test(value)) return undefined;

  try {
    const parsed = new URL(`${protocol}//${value}`);
    if (
      parsed.username
      || parsed.password
      || parsed.pathname !== '/'
      || parsed.search
      || parsed.hash
    ) {
      return undefined;
    }
    return parsed.host;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the browser-facing origin for public bearer URLs.
 *
 * Cloudflare and direct/local requests use the runtime Request URL and ignore
 * client-supplied forwarding headers. Only the CLI-owned self-hosted runtime,
 * together with the explicit trusted-proxy contract, may reconstruct the TLS
 * scheme and host that a reverse proxy overwrote.
 */
export function resolvePublicRequestOrigin(
  env: Env | Record<string, unknown>,
  reader: HeaderReader,
): string {
  const url = new URL(reader.url);
  if (!trustsSelfHostedProxyHeaders(env)) return url.origin;

  const protocol = forwardedProtocol(reader);
  if (protocol) url.protocol = protocol;

  const host = forwardedHost(reader, url.protocol as 'http:' | 'https:');
  if (host) return new URL(`${url.protocol}//${host}`).origin;

  return url.origin;
}
