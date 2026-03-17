/**
 * CookieTokenManager — ITokenManager implementation for SSR environments.
 *
 * Stores access/refresh tokens in httpOnly cookies instead of localStorage.
 * Works with any framework that provides a CookieStore interface
 * (Next.js cookies(), Nuxt useCookie, etc.).
 */

import type { ITokenManager, ITokenPair } from '@edgebase/core';
import type { CookieStore, CookieOptions } from './types.js';

const ACCESS_TOKEN_COOKIE = 'eb_access_token';
const REFRESH_TOKEN_COOKIE = 'eb_refresh_token';

/** Default cookie options — secure, httpOnly, SameSite=Lax */
const DEFAULT_COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
};

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

  constructor(
    private cookies: CookieStore,
    cookieOptions?: Partial<CookieOptions>,
  ) {
    this.cookieOptions = { ...DEFAULT_COOKIE_OPTIONS, ...cookieOptions };
  }

  getAccessToken(
    refreshFn?: (refreshToken: string) => Promise<ITokenPair>,
  ): Promise<string | null> | string | null {
    const accessToken = this.cookies.get(ACCESS_TOKEN_COOKIE) ?? null;

    // If we have an access token, return it directly
    if (accessToken && !isTokenExpired(accessToken)) return accessToken;
    if (accessToken) {
      this.cookies.delete(ACCESS_TOKEN_COOKIE);
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
    return this.cookies.get(REFRESH_TOKEN_COOKIE) ?? null;
  }

  invalidateAccessToken(): void {
    this.cookies.delete(ACCESS_TOKEN_COOKIE);
  }

  setTokens(tokens: ITokenPair): void {
    const accessMaxAge = getTokenMaxAge(tokens.accessToken) ?? 900;
    const refreshMaxAge = getTokenMaxAge(tokens.refreshToken) ?? 60 * 60 * 24 * 28;

    this.cookies.set(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
      ...this.cookieOptions,
      maxAge: accessMaxAge,
    });
    this.cookies.set(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
      ...this.cookieOptions,
      maxAge: refreshMaxAge,
    });
  }

  clearTokens(): void {
    this.cookies.delete(ACCESS_TOKEN_COOKIE);
    this.cookies.delete(REFRESH_TOKEN_COOKIE);
  }
}
