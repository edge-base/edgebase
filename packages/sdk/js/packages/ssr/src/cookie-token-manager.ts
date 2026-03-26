/**
 * CookieTokenManager — ITokenManager implementation for SSR environments.
 *
 * Stores access/refresh tokens in httpOnly cookies instead of localStorage.
 * Works with any framework that provides a CookieStore interface
 * (Next.js cookies(), Nuxt useCookie, etc.).
 */

import type { ITokenManager, ITokenPair } from '@edge-base/core';
import type { CookieStore, CookieOptions } from './types.js';

interface CookieTokenNames {
  accessToken: string;
  refreshToken: string;
}

export interface CookieTokenManagerOptions {
  cookieOptions?: Partial<CookieOptions>;
  authNamespace?: string;
}

type CookieTokenManagerInput = CookieTokenManagerOptions | Partial<CookieOptions>;

/** Default cookie options — secure, httpOnly, SameSite=Lax */
const DEFAULT_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
};

function sanitizeCookieNamespace(namespace: string): string {
  return namespace
    .trim()
    .replace(/[^!#$%&'*+.^_`|~0-9A-Za-z-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function buildCookieTokenNames(authNamespace?: string): CookieTokenNames {
  const sanitizedNamespace = authNamespace ? sanitizeCookieNamespace(authNamespace) : '';
  if (!sanitizedNamespace) {
    return {
      accessToken: 'eb_access_token',
      refreshToken: 'eb_refresh_token',
    };
  }
  return {
    accessToken: `eb_${sanitizedNamespace}_access_token`,
    refreshToken: `eb_${sanitizedNamespace}_refresh_token`,
  };
}

function isCookieTokenManagerOptions(input: CookieTokenManagerInput): input is CookieTokenManagerOptions {
  return 'cookieOptions' in input || 'authNamespace' in input;
}

function normalizeCookieTokenManagerOptions(input: CookieTokenManagerInput = {}): CookieTokenManagerOptions {
  if (!isCookieTokenManagerOptions(input)) {
    return {
      cookieOptions: input,
    };
  }

  return input;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '=='.slice(0, (4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getTokenMaxAge(token: string): number | null {
  const exp = decodeJwtPayload(token)?.exp;
  if (typeof exp !== 'number') return null;
  return Math.max(0, exp - Math.floor(Date.now() / 1000));
}

function isTokenExpired(token: string): boolean {
  const maxAge = getTokenMaxAge(token);
  if (maxAge === null) return true;
  return maxAge <= 0;
}

export class CookieTokenManager implements ITokenManager {
  private cookieOptions: CookieOptions;
  private cookieNames: CookieTokenNames;

  constructor(
    cookies: CookieStore,
    cookieOptions?: Partial<CookieOptions>,
  );
  constructor(
    cookies: CookieStore,
    options?: CookieTokenManagerOptions,
  );
  constructor(
    private cookies: CookieStore,
    input: CookieTokenManagerInput = {},
  ) {
    const options = normalizeCookieTokenManagerOptions(input);
    this.cookieOptions = { ...DEFAULT_COOKIE_OPTIONS, ...options.cookieOptions };
    this.cookieNames = buildCookieTokenNames(options.authNamespace);
  }

  getAccessToken(
    refreshFn?: (refreshToken: string) => Promise<ITokenPair>,
  ): Promise<string | null> | string | null {
    const accessToken = this.cookies.get(this.cookieNames.accessToken) ?? null;

    // If we have an access token, return it directly
    if (accessToken && !isTokenExpired(accessToken)) return accessToken;
    if (accessToken) {
      this.cookies.delete(this.cookieNames.accessToken);
    }

    // If no access token but we have a refresh token and a refresh function,
    // try to refresh
    const refreshToken = this.getRefreshToken();
    if (refreshToken && refreshFn) {
      return refreshFn(refreshToken).then((tokens) => {
        this.setTokens(tokens);
        return tokens.accessToken;
      });
    }

    return null;
  }

  getRefreshToken(): string | null {
    return this.cookies.get(this.cookieNames.refreshToken) ?? null;
  }

  invalidateAccessToken(): void {
    this.cookies.delete(this.cookieNames.accessToken);
  }

  setTokens(tokens: ITokenPair): void {
    const accessMaxAge = getTokenMaxAge(tokens.accessToken) ?? 900;
    const refreshMaxAge = getTokenMaxAge(tokens.refreshToken) ?? 60 * 60 * 24 * 28;

    this.cookies.set(this.cookieNames.accessToken, tokens.accessToken, {
      ...this.cookieOptions,
      maxAge: accessMaxAge,
    });
    this.cookies.set(this.cookieNames.refreshToken, tokens.refreshToken, {
      ...this.cookieOptions,
      maxAge: refreshMaxAge,
    });
  }

  clearTokens(): void {
    this.cookies.delete(this.cookieNames.accessToken);
    this.cookies.delete(this.cookieNames.refreshToken);
  }
}
