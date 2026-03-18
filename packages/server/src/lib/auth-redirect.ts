import { EdgeBaseError } from '@edgebase-fun/shared';
import { parseConfig } from './do-router.js';
import type { Env } from '../types.js';

export interface ClientRedirectInput {
  redirectUrl?: string | null;
  state?: string | null;
}

export interface ParsedClientRedirect {
  redirectUrl: string | null;
  state: string | null;
}

function normalizeUrl(value: string): string {
  try {
    return new URL(value).toString();
  } catch {
    throw new EdgeBaseError(400, 'Invalid redirect_url.');
  }
}

function isAllowedRedirect(candidate: string, pattern: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) return false;

  if (trimmed.endsWith('*')) {
    return candidate.startsWith(trimmed.slice(0, -1));
  }

  let allowedUrl: URL;
  let candidateUrl: URL;
  try {
    allowedUrl = new URL(trimmed);
    candidateUrl = new URL(candidate);
  } catch {
    return false;
  }

  // Origin-wide allowlist entry: https://app.example.com
  if (allowedUrl.pathname === '/' && !allowedUrl.search && !allowedUrl.hash) {
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

export function parseClientRedirectUrl(env: Env, value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = normalizeUrl(value);
  const allowed = getAllowedRedirectUrls(env);
  if (allowed.length > 0 && !allowed.some((pattern) => isAllowedRedirect(normalized, pattern))) {
    throw new EdgeBaseError(400, 'redirect_url is not allowed.');
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

export function parseClientRedirectInput(env: Env, input: ClientRedirectInput | null | undefined): ParsedClientRedirect {
  return {
    redirectUrl: parseClientRedirectUrl(env, input?.redirectUrl),
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
