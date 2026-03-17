import { parseConfig } from './do-router.js';

type HeaderReader = Request | { header: (name: string) => string | undefined; raw?: Request };

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

function isTrustSelfHostedProxyEnabled(env: unknown): boolean {
  if (env && typeof env === 'object' && !Array.isArray(env)) {
    const direct = (env as Record<string, unknown>).trustSelfHostedProxy;
    if (typeof direct === 'boolean') {
      return direct;
    }
  }

  return parseConfig(env).trustSelfHostedProxy === true;
}

export function getTrustedClientIp(
  env: unknown,
  reader?: HeaderReader,
): string | undefined {
  if (!reader) return undefined;

  const cfIp = parseForwardedIp(
    readHeader(reader, 'cf-connecting-ip') ?? readHeader(reader, 'CF-Connecting-IP'),
  );
  if (cfIp) return cfIp;

  if (!isTrustSelfHostedProxyEnabled(env)) {
    return undefined;
  }

  return parseForwardedIp(
    readHeader(reader, 'x-forwarded-for') ?? readHeader(reader, 'X-Forwarded-For'),
  );
}
