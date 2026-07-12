import { EdgeBaseError } from '@edge-base/shared';
import { parseConfig } from './do-router.js';
import type { Env } from '../types.js';
import { getTrustedClientIp } from './client-ip.js';

export interface ClientRedirectInput {
  redirectUrl?: string | null;
  state?: string | null;
}

export interface ParsedClientRedirect {
  redirectUrl: string | null;
  state: string | null;
}

const FORBIDDEN_REDIRECT_PROTOCOLS = new Set([
  'javascript:', 'data:', 'file:', 'blob:', 'vbscript:', 'about:',
  'view-source:', 'filesystem:', 'intent:', 'chrome:', 'chrome-extension:',
  'moz-extension:', 'safari-extension:', 'edge:', 'resource:', 'content:',
  'ws:', 'wss:', 'ftp:', 'mailto:', 'tel:', 'sms:',
]);

function isSafeRedirectUrl(url: URL): boolean {
  return !FORBIDDEN_REDIRECT_PROTOCOLS.has(url.protocol)
    && !url.username
    && !url.password;
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!isSafeRedirectUrl(url)) throw new Error('unsafe');
    return url.toString();
  } catch {
    throw new EdgeBaseError(400, 'Invalid redirect_url.');
  }
}

function isAllowedRedirect(candidate: string, pattern: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) return false;

  if (trimmed.endsWith('*')) {
    // Compare origin + path-prefix instead of a raw string startsWith so that a
    // wildcard can only match within the same origin. A naive prefix match lets
    // 'https://app.example.com*' match 'https://app.example.com.evil.com'.
    const prefix = trimmed.slice(0, -1);
    let prefixUrl: URL;
    let candidateUrl: URL;
    try {
      prefixUrl = new URL(prefix);
      candidateUrl = new URL(candidate);
    } catch {
      return false;
    }
    if (!isSafeRedirectUrl(prefixUrl) || !isSafeRedirectUrl(candidateUrl)) return false;
    // Custom schemes have the opaque origin string "null" in the URL API, so
    // origin comparison would make unrelated schemes/hosts equivalent. Deep
    // links must be registered as exact URLs; wildcard matching is reserved
    // for HTTP(S) origins whose authority can be compared safely.
    if (!['http:', 'https:'].includes(prefixUrl.protocol)) return false;
    if (prefixUrl.origin !== candidateUrl.origin) return false;
    const prefixPath = prefixUrl.pathname + prefixUrl.search;
    const candidatePath = candidateUrl.pathname + candidateUrl.search;
    return candidatePath.startsWith(prefixPath);
  }

  let allowedUrl: URL;
  let candidateUrl: URL;
  try {
    allowedUrl = new URL(trimmed);
    candidateUrl = new URL(candidate);
  } catch {
    return false;
  }
  if (!isSafeRedirectUrl(allowedUrl) || !isSafeRedirectUrl(candidateUrl)) return false;

  // Origin-wide entries are safe only for HTTP(S). Custom schemes intentionally
  // require an exact URL match because URL.origin is "null" for all of them.
  if (
    ['http:', 'https:'].includes(allowedUrl.protocol)
    && allowedUrl.pathname === '/'
    && !allowedUrl.search
    && !allowedUrl.hash
  ) {
    return allowedUrl.origin === candidateUrl.origin;
  }

  return allowedUrl.toString() === candidateUrl.toString();
}

function getAllowedRedirectUrls(env: Env): string[] {
  const config = parseConfig(env);
  const entries = config?.auth?.allowedRedirectUrls;
  if (!Array.isArray(entries)) return [];
  return entries.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
}

export function appendRedirectParams(
  redirectUrl: string,
  params: Record<string, string | undefined | null>,
): string {
  const url = new URL(redirectUrl);
  const fragmentParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      fragmentParams.set(key, value);
    }
  }
  const fragment = fragmentParams.toString();
  if (fragment) {
    url.hash = fragment;
  }
  return url.toString();
}

const redirectAllowlistWarned = new Set<string>();

function isLocalDevelopmentLoopbackRedirect(env: Env, request: Request | undefined, candidate: URL): boolean {
  if (!request || env.EDGEBASE_RUNTIME_MODE !== 'local-development') return false;
  const requestUrl = new URL(request.url);
  const ip = getTrustedClientIp(env, request);
  const loopbackPeer = ip === '::1' || ip === '[::1]' || ip?.startsWith('127.') === true;
  const requestLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(requestUrl.hostname);
  const candidateLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(candidate.hostname);
  return loopbackPeer
    && requestUrl.protocol === 'http:'
    && requestLoopback
    && candidate.protocol === 'http:'
    && candidateLoopback;
}

export function parseClientRedirectUrl(
  env: Env,
  value: string | null | undefined,
  request?: Request,
): string | null {
  if (!value) return null;
  const normalized = normalizeUrl(value);
  const allowed = getAllowedRedirectUrls(env);
  let release = false;
  try {
    release = !!parseConfig(env)?.release;
  } catch {
    release = false;
  }
  const normalizedUrl = new URL(normalized);
  if (
    release
    && normalizedUrl.protocol !== 'https:'
    && !isLocalDevelopmentLoopbackRedirect(env, request, normalizedUrl)
  ) {
    throw new EdgeBaseError(
      400,
      'redirect_url must use HTTPS in release mode.',
      undefined,
      'validation-failed',
    );
  }
  if (allowed.length > 0) {
    if (!allowed.some((pattern) => isAllowedRedirect(normalized, pattern))) {
      throw new EdgeBaseError(400, 'redirect_url is not allowed.');
    }
    return normalized;
  }
  // No allowlist configured. OAuth and email flows append bearer credentials
  // to this redirect, so release deployments must fail closed.
  if (release) {
    throw new EdgeBaseError(
      400,
      'redirect_url requires auth.allowedRedirectUrls in release mode.',
      undefined,
      'validation-failed',
    );
  }
  if (!redirectAllowlistWarned.has('missing-redirect-allowlist')) {
    redirectAllowlistWarned.add('missing-redirect-allowlist');
    console.warn(
      '[Auth] Development mode accepted redirect_url without auth.allowedRedirectUrls. '
      + 'Release mode rejects this; configure an explicit allowlist before deployment.',
    );
  }
  return normalized;
}

export function parseClientRedirectState(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new EdgeBaseError(400, 'Invalid state.');
  }
  if (value.length > 1024) {
    throw new EdgeBaseError(400, 'state must not exceed 1024 characters.');
  }
  return value;
}

export function parseClientRedirectInput(
  env: Env,
  input: ClientRedirectInput | null | undefined,
  request?: Request,
): ParsedClientRedirect {
  return {
    redirectUrl: parseClientRedirectUrl(env, input?.redirectUrl, request),
    state: parseClientRedirectState(input?.state),
  };
}

export function buildEmailActionUrl(options: {
  redirectUrl: string | null;
  fallbackUrl: string;
  token: string;
  type: string;
  state?: string | null;
}): string {
  if (!options.redirectUrl) {
    return options.fallbackUrl;
  }
  return appendRedirectParams(options.redirectUrl, {
    token: options.token,
    type: options.type,
    state: options.state ?? null,
  });
}
