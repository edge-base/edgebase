import { trustsSelfHostedProxyHeaders } from './public-origin.js';

type HeaderReader = Request | { header: (name: string) => string | undefined; raw?: Request };

export type EdgeBaseRuntimeMode = 'cloudflare' | 'local-development' | 'self-hosted';

function readHeader(reader: HeaderReader, name: string): string | undefined {
  if (reader instanceof Request) {
    return reader.headers.get(name) ?? undefined;
  }
  const direct = reader.header(name);
  if (direct !== undefined) {
    return direct;
  }
  return reader.raw?.headers.get(name) ?? undefined;
}

function parseForwardedIp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const first = value.split(',')[0]?.trim();
  return first && first.length > 0 ? first : undefined;
}

function runtimeMode(env: unknown): EdgeBaseRuntimeMode | undefined {
  if (!env || typeof env !== 'object' || Array.isArray(env)) return undefined;
  const value = (env as Record<string, unknown>).EDGEBASE_RUNTIME_MODE;
  if (
    value === 'cloudflare'
    || value === 'local-development'
    || value === 'self-hosted'
  ) {
    return value;
  }
  return undefined;
}

export function getTrustedClientIp(
  env: unknown,
  reader?: HeaderReader,
): string | undefined {
  if (!reader) return undefined;

  const mode = runtimeMode(env);

  // Self-hosted behind a trusted reverse proxy: the authoritative client IP is
  // the one the proxy writes to X-Forwarded-For. `cf-connecting-ip` must NOT be
  // trusted in this mode — Cloudflare is not the one setting it, so a client can
  // forge it to spoof rate-limit keys and service-key IP/CIDR constraints.
  if (mode === 'self-hosted' && trustsSelfHostedProxyHeaders(env)) {
    return parseForwardedIp(
      readHeader(reader, 'x-forwarded-for') ?? readHeader(reader, 'X-Forwarded-For'),
    );
  }

  // The CLI injects this binding for every supported runtime target. An absent
  // or invalid value fails closed instead of assuming a self-hosted request
  // came through Cloudflare. Docker/portable targets use `self-hosted`, where
  // every forwarded header is client-controlled unless the operator explicitly
  // opts into the trusted reverse-proxy contract above.
  if (mode !== 'cloudflare' && mode !== 'local-development') return undefined;

  // Cloudflare edge and the CLI-owned local-development listener supply this
  // header. X-Forwarded-For remains ignored unless the trusted-proxy contract
  // above is enabled.
  return parseForwardedIp(
    readHeader(reader, 'cf-connecting-ip') ?? readHeader(reader, 'CF-Connecting-IP'),
  );
}
