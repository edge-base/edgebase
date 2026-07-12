/**
 * OAuth Provider Abstraction Layer
 *
 * Supports: Google, GitHub, Apple, Discord, Microsoft, Facebook, Kakao, Naver,
 *           X (Twitter), Reddit, Line, Slack, Spotify, Twitch
 * Each provider implements a common interface for authorization URL generation,
 * code exchange, and user info retrieval.
 *
 * M3: Google, GitHub, Apple, Discord
 * M18: Microsoft, Facebook, Kakao, Naver, X, Line, Slack, Spotify, Twitch
 */

import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  type JSONWebKeySet,
  type JWTPayload,
} from 'jose';

// ─── Types ───

export interface OAuthUserInfo {
  providerUserId: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
  raw: Record<string, unknown>;
}

export interface OAuthTokens {
  accessToken: string;
  tokenType: string;
  idToken?: string;
  refreshToken?: string;
  expiresIn?: number;
}

export interface OAuthProviderConfig {
  clientId: string;
  clientSecret: string;
}

export interface OAuthProvider {
  name: string;
  getAuthorizationUrl(
    state: string,
    redirectUri: string,
    codeChallenge?: string,
  ): string;
  exchangeCode(
    code: string,
    redirectUri: string,
    codeVerifier?: string,
  ): Promise<OAuthTokens>;
  getUserInfo(accessToken: string): Promise<OAuthUserInfo>;
}

const OAUTH_FETCH_TIMEOUT_MS = 10_000;
const OAUTH_RESPONSE_MAX_BYTES = 1024 * 1024;

/** Bound every provider request across headers and body, and reject redirects. */
async function fetchOAuthResponse(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OAUTH_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      // Cloudflare Workers implements only `follow` and `manual`. Manual mode
      // plus an explicit 3xx rejection gives us the same no-redirect SSRF
      // boundary without relying on a Fetch option the production runtime
      // rejects before issuing the request.
      redirect: 'manual',
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      response.body?.cancel().catch(() => undefined);
      throw new Error('OAuth provider redirects are not allowed');
    }
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > OAUTH_RESPONSE_MAX_BYTES) {
      throw new Error('OAuth provider response is too large');
    }
    if (!response.body) return response;

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > OAUTH_RESPONSE_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('OAuth provider response is too large');
      }
      chunks.push(value);
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Accept only the boolean/standard string representation of verified=true. */
export function isOAuthEmailVerified(value: unknown): boolean {
  return value === true || value === 'true';
}

function safeProviderErrorCode(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(value)
    ? value
    : 'provider_error';
}

// ─── PKCE Helper ───

export async function generatePKCE(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  const codeVerifier = base64urlEncode(array);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  const codeChallenge = base64urlEncode(new Uint8Array(digest));
  return { codeVerifier, codeChallenge };
}

function base64urlEncode(buffer: Uint8Array): string {
  const str = btoa(String.fromCharCode(...buffer));
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ─── Google OAuth ───

class GoogleOAuthProvider implements OAuthProvider {
  readonly name = 'google';
  constructor(private config: OAuthProviderConfig) {}

  getAuthorizationUrl(state: string, redirectUri: string, codeChallenge?: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      access_type: 'offline',
      prompt: 'consent',
    });
    if (codeChallenge) {
      params.set('code_challenge', codeChallenge);
      params.set('code_challenge_method', 'S256');
    }
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async exchangeCode(code: string, redirectUri: string, codeVerifier?: string): Promise<OAuthTokens> {
    const body: Record<string, string> = {
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    };
    if (codeVerifier) body.code_verifier = codeVerifier;

    const resp = await fetchOAuthResponse('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });
    if (!resp.ok) throw new Error(`Google token exchange failed: ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    return {
      accessToken: data.access_token as string,
      tokenType: data.token_type as string,
      idToken: data.id_token as string | undefined,
      refreshToken: data.refresh_token as string | undefined,
      expiresIn: data.expires_in as number | undefined,
    };
  }

  async getUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    const resp = await fetchOAuthResponse('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) throw new Error(`Google userinfo failed: ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    return {
      providerUserId: String(data.id),
      email: (data.email as string) || null,
      emailVerified: isOAuthEmailVerified(data.verified_email), // Google uses verified_email
      displayName: (data.name as string) || null,
      avatarUrl: (data.picture as string) || null,
      raw: data,
    };
  }
}

// ─── GitHub OAuth ───

class GitHubOAuthProvider implements OAuthProvider {
  readonly name = 'github';
  constructor(private config: OAuthProviderConfig) {}

  getAuthorizationUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      scope: 'read:user user:email',
      state,
    });
    return `https://github.com/login/oauth/authorize?${params}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
    const resp = await fetchOAuthResponse('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!resp.ok) throw new Error(`GitHub token exchange failed: ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    if (data.error) throw new Error(`GitHub OAuth error: ${safeProviderErrorCode(data.error)}`);
    return {
      accessToken: data.access_token as string,
      tokenType: data.token_type as string,
    };
  }

  async getUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    const [userResp, emailsResp] = await Promise.all([
      fetchOAuthResponse('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'EdgeBase' },
      }),
      fetchOAuthResponse('https://api.github.com/user/emails', {
        headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'EdgeBase' },
      }),
    ]);
    if (!userResp.ok) throw new Error(`GitHub user API failed: ${userResp.status}`);
    const userData = await userResp.json() as Record<string, unknown>;

    let email: string | null = null;
    let emailVerified = false;
    if (emailsResp.ok) {
      const emails = await emailsResp.json() as Array<{ email: string; primary: boolean; verified: boolean }>;
      const primary = emails.find((e) => e.primary && e.verified);
      if (primary) {
        email = primary.email;
        emailVerified = primary.verified;
      }
    }

    return {
      providerUserId: String(userData.id),
      email,
      emailVerified,
      displayName: (userData.name as string) || (userData.login as string) || null,
      avatarUrl: (userData.avatar_url as string) || null,
      raw: userData,
    };
  }
}

// ─── Apple OAuth ───

class AppleOAuthProvider implements OAuthProvider {
  readonly name = 'apple';
  constructor(private config: OAuthProviderConfig) {}

  getAuthorizationUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'name email',
      state,
      nonce: state,
      response_mode: 'form_post',
    });
    return `https://appleid.apple.com/auth/authorize?${params}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
    const resp = await fetchOAuthResponse('https://appleid.apple.com/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!resp.ok) throw new Error(`Apple token exchange failed: ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    return {
      accessToken: data.access_token as string,
      tokenType: data.token_type as string,
      idToken: data.id_token as string | undefined,
    };
  }

  async getUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    // Apple provides user info in the id_token, not a separate API
    // The id_token is already returned from exchangeCode
    // For Apple, we need the id_token from the token response
    // This is handled in the callback route which passes idToken
    void accessToken;
    throw new Error('Apple getUserInfo should use id_token parsing instead');
  }
}

/** Decode Apple claims for compatibility tooling. Auth routes use verifyAppleIdToken(). */
export function parseAppleIdToken(idToken: string): OAuthUserInfo {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Invalid Apple id_token');
  const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
  return {
    providerUserId: payload.sub as string,
    email: (payload.email as string) || null,
    emailVerified: isOAuthEmailVerified(payload.email_verified),
    displayName: null, // Apple sends name only on first sign-in via form_post body
    avatarUrl: null,
    raw: payload,
  };
}

// ─── Discord OAuth ───

class DiscordOAuthProvider implements OAuthProvider {
  readonly name = 'discord';
  constructor(private config: OAuthProviderConfig) {}

  getAuthorizationUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'identify email',
      state,
    });
    return `https://discord.com/oauth2/authorize?${params}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
    const resp = await fetchOAuthResponse('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!resp.ok) throw new Error(`Discord token exchange failed: ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    return {
      accessToken: data.access_token as string,
      tokenType: data.token_type as string,
    };
  }

  async getUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    const resp = await fetchOAuthResponse('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) throw new Error(`Discord user API failed: ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;

    const avatarHash = data.avatar as string | null;
    const avatarUrl = avatarHash
      ? `https://cdn.discordapp.com/avatars/${data.id}/${avatarHash}.png`
      : null;

    return {
      providerUserId: String(data.id),
      email: (data.email as string) || null,
      emailVerified: isOAuthEmailVerified(data.verified), // Discord uses 'verified' field
      displayName: (data.global_name as string) || (data.username as string) || null,
      avatarUrl,
      raw: data,
    };
  }
}

// ─── Microsoft (Azure AD) OAuth (M18) ───

class MicrosoftOAuthProvider implements OAuthProvider {
  readonly name = 'microsoft';
  constructor(private config: OAuthProviderConfig) {}

  getAuthorizationUrl(state: string, redirectUri: string, codeChallenge?: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
    });
    if (codeChallenge) {
      params.set('code_challenge', codeChallenge);
      params.set('code_challenge_method', 'S256');
    }
    return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`;
  }

  async exchangeCode(code: string, redirectUri: string, codeVerifier?: string): Promise<OAuthTokens> {
    const body: Record<string, string> = {
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      scope: 'openid email profile',
    };
    if (codeVerifier) body.code_verifier = codeVerifier;
    const resp = await fetchOAuthResponse('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });
    if (!resp.ok) throw new Error(`Microsoft token exchange failed: ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    return {
      accessToken: data.access_token as string,
      tokenType: data.token_type as string,
      idToken: data.id_token as string | undefined,
      refreshToken: data.refresh_token as string | undefined,
      expiresIn: data.expires_in as number | undefined,
    };
  }

  async getUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    const resp = await fetchOAuthResponse('https://graph.microsoft.com/oidc/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) throw new Error(`Microsoft userinfo failed: ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    return {
      providerUserId: String(data.sub),
      email: (data.email as string) || null,
      emailVerified: isOAuthEmailVerified(data.email_verified), //: Microsoft provides email_verified
      displayName: (data.name as string) || null,
      avatarUrl: null, // Microsoft Graph userinfo doesn't return avatar
      raw: data,
    };
  }
}

// ─── Facebook/Meta OAuth (M18) ───

class FacebookOAuthProvider implements OAuthProvider {
  readonly name = 'facebook';
  constructor(private config: OAuthProviderConfig) {}

  getAuthorizationUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'email,public_profile',
      state,
    });
    return `https://www.facebook.com/v19.0/dialog/oauth?${params}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      redirect_uri: redirectUri,
    });
    const resp = await fetchOAuthResponse('https://graph.facebook.com/v19.0/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    if (!resp.ok) throw new Error(`Facebook token exchange failed: ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    return {
      accessToken: data.access_token as string,
      tokenType: data.token_type as string || 'bearer',
      expiresIn: data.expires_in as number | undefined,
    };
  }

  async getUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    const resp = await fetchOAuthResponse(
      'https://graph.facebook.com/v19.0/me?fields=id,name,email,picture.type(large)',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!resp.ok) throw new Error(`Facebook user API failed: ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    const picture = data.picture as { data?: { url?: string } } | undefined;
    return {
      providerUserId: String(data.id),
      email: (data.email as string) || null,
      emailVerified: false, //: Facebook — no email_verified field, force false
      displayName: (data.name as string) || null,
      avatarUrl: picture?.data?.url || null,
      raw: data,
    };
  }
}

// ─── Kakao OAuth (M18) ───

class KakaoOAuthProvider implements OAuthProvider {
  readonly name = 'kakao';
  constructor(private config: OAuthProviderConfig) {}

  getAuthorizationUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
    });
    return `https://kauth.kakao.com/oauth/authorize?${params}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
    const resp = await fetchOAuthResponse('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!resp.ok) throw new Error(`Kakao token exchange failed: ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    return {
      accessToken: data.access_token as string,
      tokenType: data.token_type as string,
      refreshToken: data.refresh_token as string | undefined,
      expiresIn: data.expires_in as number | undefined,
    };
  }

  async getUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    const resp = await fetchOAuthResponse('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) throw new Error(`Kakao user API failed: ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    const account = data.kakao_account as Record<string, unknown> | undefined;
    const profile = account?.profile as Record<string, unknown> | undefined;
    return {
      providerUserId: String(data.id),
      email: (account?.email as string) || null,
      //: Kakao — conditional, use is_email_verified if available
      emailVerified: isOAuthEmailVerified(account?.is_email_verified),
      displayName: (profile?.nickname as string) || null,
      avatarUrl: (profile?.profile_image_url as string) || null,
      raw: data,
    };
  }
}

// ─── Naver OAuth (M18) ───

class NaverOAuthProvider implements OAuthProvider {
  readonly name = 'naver';
  constructor(private config: OAuthProviderConfig) {}

  getAuthorizationUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      state,
    });
    return `https://nid.naver.com/oauth2.0/authorize?${params}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
    void redirectUri; // Naver doesn't require redirect_uri in token exchange
    const resp = await fetchOAuthResponse('https://nid.naver.com/oauth2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        grant_type: 'authorization_code',
      }),
    });
    if (!resp.ok) throw new Error(`Naver token exchange failed: ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    return {
      accessToken: data.access_token as string,
      tokenType: data.token_type as string,
      refreshToken: data.refresh_token as string | undefined,
      expiresIn: typeof data.expires_in === 'string' ? parseInt(data.expires_in) : (data.expires_in as number | undefined),
    };
  }

  async getUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    const resp = await fetchOAuthResponse('https://openapi.naver.com/v1/nid/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) throw new Error(`Naver user API failed: ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    const response = data.response as Record<string, unknown> | undefined;
    return {
      providerUserId: String(response?.id),
      email: (response?.email as string) || null,
      emailVerified: false, //: Naver — no email_verified field, force false
      displayName: (response?.name as string) || (response?.nickname as string) || null,
      avatarUrl: (response?.profile_image as string) || null,
      raw: data,
    };
  }
}

// ─── X (Twitter) OAuth 2.0 PKCE (M18) ───

class XOAuthProvider implements OAuthProvider {
  readonly name = 'x';
  constructor(private config: OAuthProviderConfig) {}

  getAuthorizationUrl(state: string, redirectUri: string, codeChallenge?: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'tweet.read users.read',
      state,
      code_challenge_method: 'S256',
    });
    // X (Twitter) OAuth 2.0 requires PKCE
    if (codeChallenge) {
      params.set('code_challenge', codeChallenge);
    }
    return `https://twitter.com/i/oauth2/authorize?${params}`;
  }

  async exchangeCode(code: string, redirectUri: string, codeVerifier?: string): Promise<OAuthTokens> {
    const body: Record<string, string> = {
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      client_id: this.config.clientId,
    };
    if (codeVerifier) body.code_verifier = codeVerifier;
    // X uses Basic Auth for confidential clients
    const credentials = btoa(`${this.config.clientId}:${this.config.clientSecret}`);
    const resp = await fetchOAuthResponse('https://api.x.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
      body: new URLSearchParams(body),
    });
    if (!resp.ok) throw new Error(`X token exchange failed: ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    return {
      accessToken: data.access_token as string,
      tokenType: data.token_type as string,
      refreshToken: data.refresh_token as string | undefined,
      expiresIn: data.expires_in as number | undefined,
    };
  }

  async getUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    const resp = await fetchOAuthResponse('https://api.x.com/2/users/me?user.fields=profile_image_url,name,username', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) throw new Error(`X user API failed: ${resp.status}`);
    const json = await resp.json() as Record<string, unknown>;
    const data = json.data as Record<string, unknown>;
    return {
      providerUserId: String(data.id),
      email: null, //: X — email selectively provided, not requesting email scope
      emailVerified: false, //: X — no email_verified, force false
      displayName: (data.name as string) || (data.username as string) || null,
      avatarUrl: (data.profile_image_url as string) || null,
      raw: json,
    };
  }
}

// ─── Reddit OAuth 2.0 (M18) ───

class RedditOAuthProvider implements OAuthProvider {
  readonly name = 'reddit';
  constructor(private config: OAuthProviderConfig) {}

  getAuthorizationUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      duration: 'permanent',
      scope: 'identity',
      state,
    });
    return `https://www.reddit.com/api/v1/authorize?${params}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
    const credentials = btoa(`${this.config.clientId}:${this.config.clientSecret}`);
    const resp = await fetchOAuthResponse('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
        'User-Agent': 'EdgeBase OAuth/1.0',
      },
      body: new URLSearchParams({
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!resp.ok) throw new Error(`Reddit token exchange failed: ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    return {
      accessToken: data.access_token as string,
      tokenType: data.token_type as string,
      refreshToken: data.refresh_token as string | undefined,
      expiresIn: data.expires_in as number | undefined,
    };
  }

  async getUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    const resp = await fetchOAuthResponse('https://oauth.reddit.com/api/v1/me', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'EdgeBase OAuth/1.0',
      },
    });
    if (!resp.ok) throw new Error(`Reddit user API failed: ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    return {
      providerUserId: String(data.id),
      email: null, //: Reddit does not expose email through this OAuth scope set
      emailVerified: false, //: Reddit does not expose email verification through this API
      displayName: (data.name as string) || null,
      avatarUrl: (data.snoovatar_img as string) || (data.icon_img as string) || null,
      raw: data,
    };
  }
}

// ─── Line OAuth (M18) ───

class LineOAuthProvider implements OAuthProvider {
  readonly name = 'line';
  constructor(private config: OAuthProviderConfig) {}

  getAuthorizationUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'profile openid email',
      state,
    });
    return `https://access.line.me/oauth2/v2.1/authorize?${params}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
    const resp = await fetchOAuthResponse('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!resp.ok) throw new Error(`Line token exchange failed: ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    return {
      accessToken: data.access_token as string,
      tokenType: data.token_type as string,
      idToken: data.id_token as string | undefined,
      refreshToken: data.refresh_token as string | undefined,
      expiresIn: data.expires_in as number | undefined,
    };
  }

  async getUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    const resp = await fetchOAuthResponse('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) throw new Error(`Line user API failed: ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    return {
      providerUserId: String(data.userId),
      email: null, // Line profile API doesn't return email; email comes from id_token
      emailVerified: false, //: Line — no email_verified field, force false
      displayName: (data.displayName as string) || null,
      avatarUrl: (data.pictureUrl as string) || null,
      raw: data,
    };
  }
}

// ─── Slack OAuth (OpenID Connect) (M18) ───

class SlackOAuthProvider implements OAuthProvider {
  readonly name = 'slack';
  constructor(private config: OAuthProviderConfig) {}

  getAuthorizationUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
    });
    return `https://slack.com/openid/connect/authorize?${params}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
    const resp = await fetchOAuthResponse('https://slack.com/api/openid.connect.token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!resp.ok) throw new Error(`Slack token exchange failed: ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    if (!data.ok) throw new Error(`Slack OAuth error: ${safeProviderErrorCode(data.error)}`);
    return {
      accessToken: data.access_token as string,
      tokenType: data.token_type as string || 'bearer',
      idToken: data.id_token as string | undefined,
    };
  }

  async getUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    const resp = await fetchOAuthResponse('https://slack.com/api/openid.connect.userInfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) throw new Error(`Slack userinfo failed: ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    return {
      providerUserId: String(data.sub),
      email: (data.email as string) || null,
      emailVerified: isOAuthEmailVerified(data.email_verified),
      displayName: (data.name as string) || null,
      avatarUrl: (data.picture as string) || null,
      raw: data,
    };
  }
}

// ─── Spotify OAuth (M18) ───

class SpotifyOAuthProvider implements OAuthProvider {
  readonly name = 'spotify';
  constructor(private config: OAuthProviderConfig) {}

  getAuthorizationUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'user-read-email user-read-private',
      state,
    });
    return `https://accounts.spotify.com/authorize?${params}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
    const credentials = btoa(`${this.config.clientId}:${this.config.clientSecret}`);
    const resp = await fetchOAuthResponse('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!resp.ok) throw new Error(`Spotify token exchange failed: ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    return {
      accessToken: data.access_token as string,
      tokenType: data.token_type as string,
      refreshToken: data.refresh_token as string | undefined,
      expiresIn: data.expires_in as number | undefined,
    };
  }

  async getUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    const resp = await fetchOAuthResponse('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) throw new Error(`Spotify user API failed: ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    const images = data.images as Array<{ url: string }> | undefined;
    return {
      providerUserId: String(data.id),
      email: (data.email as string) || null,
      emailVerified: false, //: Spotify — no email_verified, force false
      displayName: (data.display_name as string) || null,
      avatarUrl: images?.[0]?.url || null,
      raw: data,
    };
  }
}

// ─── Twitch OAuth (M18) ───

class TwitchOAuthProvider implements OAuthProvider {
  readonly name = 'twitch';
  constructor(private config: OAuthProviderConfig) {}

  getAuthorizationUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'user:read:email',
      state,
    });
    return `https://id.twitch.tv/oauth2/authorize?${params}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
    const resp = await fetchOAuthResponse('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    if (!resp.ok) throw new Error(`Twitch token exchange failed: ${resp.status}`);
    const data = await resp.json() as Record<string, unknown>;
    return {
      accessToken: data.access_token as string,
      tokenType: data.token_type as string,
      refreshToken: data.refresh_token as string | undefined,
      expiresIn: data.expires_in as number | undefined,
    };
  }

  async getUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    const resp = await fetchOAuthResponse('https://api.twitch.tv/helix/users', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Client-Id': this.config.clientId,
      },
    });
    if (!resp.ok) throw new Error(`Twitch user API failed: ${resp.status}`);
    const json = await resp.json() as Record<string, unknown>;
    const users = json.data as Array<Record<string, unknown>>;
    const data = users?.[0];
    if (!data) throw new Error('Twitch user not found');
    return {
      providerUserId: String(data.id),
      email: (data.email as string) || null,
      emailVerified: isOAuthEmailVerified(data.email_verified),
      displayName: (data.display_name as string) || (data.login as string) || null,
      avatarUrl: (data.profile_image_url as string) || null,
      raw: data,
    };
  }
}

// ─── OIDC Provider (Generic OpenID Connect, Phase 2 ⑦) ───

/**
 * Extended config for OIDC providers (adds issuer + optional scopes).
 */
export interface OIDCProviderConfig extends OAuthProviderConfig {
  issuer: string;
  scopes?: string[];
}

/**
 * OpenID Connect discovery document (subset of fields we use).
 */
interface OIDCDiscoveryDocument {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  jwks_uri?: string;
  issuer: string;
}

const appleJwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
const OIDC_ASYMMETRIC_ALGORITHMS = [
  'RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA',
];

function assertAuthorizedParty(payload: JWTPayload, clientId: string): void {
  const audiences = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
  if (payload.azp !== undefined && payload.azp !== clientId) {
    throw new Error('OIDC id_token azp does not match client_id');
  }
  if (audiences.length > 1 && payload.azp !== clientId) {
    throw new Error('OIDC id_token azp does not match client_id');
  }
}

export async function verifyAppleIdToken(
  idToken: string,
  clientId: string,
  expectedNonce: string,
): Promise<OAuthUserInfo> {
  const { payload } = await jwtVerify(idToken, appleJwks, {
    issuer: 'https://appleid.apple.com',
    audience: clientId,
    algorithms: ['RS256'],
    requiredClaims: ['iss', 'aud', 'exp', 'iat', 'sub', 'nonce'],
  });
  assertAuthorizedParty(payload, clientId);
  if (payload.nonce !== expectedNonce) throw new Error('Apple id_token nonce mismatch');
  if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('Apple id_token missing sub');
  return {
    providerUserId: payload.sub,
    email: typeof payload.email === 'string' ? payload.email : null,
    emailVerified: isOAuthEmailVerified(payload.email_verified),
    displayName: null,
    avatarUrl: null,
    raw: payload,
  };
}

/**
 * In-memory cache for OIDC discovery documents (per Worker lifetime).
 * Avoids refetching on every request within the same Worker instance.
 */
const oidcDiscoveryCache = new Map<string, { doc: OIDCDiscoveryDocument; expiresAt: number }>();
const oidcJwksCache = new Map<string, {
  jwks: ReturnType<typeof createLocalJWKSet>;
  expiresAt: number;
}>();
const OIDC_JSON_MAX_BYTES = OAUTH_RESPONSE_MAX_BYTES;

async function fetchOIDCResponse(url: string, init: RequestInit = {}): Promise<Response> {
  return fetchOAuthResponse(url, init);
}

async function readOIDCJson<T>(response: Response, label: string): Promise<T> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > OIDC_JSON_MAX_BYTES) {
    throw new Error(`OIDC ${label} response is too large`);
  }
  if (!response.body) throw new Error(`OIDC ${label} response body is missing`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > OIDC_JSON_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`OIDC ${label} response is too large`);
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`OIDC ${label} response is not valid JSON`);
  }
}

function canonicalIssuer(value: string): string {
  return value.replace(/\/$/, '');
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function parseOIDCHttpsEndpoint(
  value: string,
  label: string,
  allowInsecureLoopback: boolean,
): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`OIDC ${label} must be an absolute URL`);
  }
  if (url.username || url.password) throw new Error(`OIDC ${label} must not contain userinfo`);
  if (url.protocol !== 'https:' && !(allowInsecureLoopback && url.protocol === 'http:' && isLoopbackHost(url.hostname))) {
    throw new Error(`OIDC ${label} must use HTTPS`);
  }
  return url;
}

/** Validate issuer configuration before any discovery/network request. */
export function validateOIDCProviderSecurity(
  config: OIDCProviderConfig,
  release: boolean,
): void {
  parseOIDCHttpsEndpoint(config.issuer, 'issuer', !release);
}

async function fetchOIDCDiscovery(issuer: string): Promise<OIDCDiscoveryDocument> {
  const issuerUrl = parseOIDCHttpsEndpoint(issuer, 'issuer', true);
  const allowInsecureLoopback = issuerUrl.protocol === 'http:' && isLoopbackHost(issuerUrl.hostname);
  const cacheKey = issuer;
  const cached = oidcDiscoveryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.doc;
  }

  const discoveryUrl = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const resp = await fetchOIDCResponse(discoveryUrl, {
    headers: { Accept: 'application/json' },
  });

  if (!resp.ok) {
    throw new Error(`OIDC discovery failed for ${issuer}: ${resp.status} ${resp.statusText}`);
  }

  const doc = await readOIDCJson<OIDCDiscoveryDocument>(resp, 'discovery');
  if (!doc.authorization_endpoint || !doc.token_endpoint) {
    throw new Error(`OIDC discovery document missing required endpoints for ${issuer}`);
  }
  if (canonicalIssuer(doc.issuer) !== canonicalIssuer(issuer)) {
    throw new Error(`OIDC discovery issuer mismatch for ${issuer}`);
  }
  parseOIDCHttpsEndpoint(doc.authorization_endpoint, 'authorization_endpoint', allowInsecureLoopback);
  parseOIDCHttpsEndpoint(doc.token_endpoint, 'token_endpoint', allowInsecureLoopback);
  if (doc.userinfo_endpoint) {
    parseOIDCHttpsEndpoint(doc.userinfo_endpoint, 'userinfo_endpoint', allowInsecureLoopback);
  }
  if (doc.jwks_uri) parseOIDCHttpsEndpoint(doc.jwks_uri, 'jwks_uri', allowInsecureLoopback);

  // Cache for 1 hour
  oidcDiscoveryCache.set(cacheKey, { doc, expiresAt: Date.now() + 3600_000 });
  return doc;
}

export async function verifyOIDCIdToken(
  idToken: string,
  config: OIDCProviderConfig,
  expectedNonce: string,
): Promise<JWTPayload> {
  const discovery = await fetchOIDCDiscovery(config.issuer);
  if (!discovery.jwks_uri) throw new Error('OIDC discovery document missing jwks_uri');
  let cachedJwks = oidcJwksCache.get(discovery.jwks_uri);
  if (!cachedJwks || cachedJwks.expiresAt <= Date.now()) {
    const response = await fetchOIDCResponse(discovery.jwks_uri, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`OIDC JWKS request failed: ${response.status}`);
    const document = await readOIDCJson<JSONWebKeySet>(response, 'JWKS');
    if (!document || !Array.isArray(document.keys) || document.keys.length === 0) {
      throw new Error('OIDC JWKS response does not contain keys');
    }
    cachedJwks = {
      jwks: createLocalJWKSet(document),
      expiresAt: Date.now() + 3600_000,
    };
    oidcJwksCache.set(discovery.jwks_uri, cachedJwks);
  }
  const { payload } = await jwtVerify(idToken, cachedJwks.jwks, {
    issuer: discovery.issuer,
    audience: config.clientId,
    algorithms: OIDC_ASYMMETRIC_ALGORITHMS,
    requiredClaims: ['iss', 'aud', 'exp', 'iat', 'sub', 'nonce'],
  });
  assertAuthorizedParty(payload, config.clientId);
  if (payload.nonce !== expectedNonce) throw new Error('OIDC id_token nonce mismatch');
  if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('OIDC id_token missing sub');
  return payload;
}

export function assertOIDCUserInfoSubject(
  payload: JWTPayload,
  userInfo: Pick<OAuthUserInfo, 'providerUserId'>,
): void {
  if (userInfo.providerUserId !== payload.sub) {
    throw new Error('OIDC id_token and userinfo subject mismatch');
  }
}

/**
 * Decode OIDC claims for compatibility tooling. Auth routes use
 * verifyOIDCIdToken() plus the authenticated userinfo endpoint.
 */
export function parseOIDCIdToken(idToken: string): OAuthUserInfo {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Invalid OIDC id_token');
  const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
  return {
    providerUserId: payload.sub as string,
    email: (payload.email as string) || null,
    emailVerified: isOAuthEmailVerified(payload.email_verified),
    displayName: (payload.name as string) || (payload.preferred_username as string) || null,
    avatarUrl: (payload.picture as string) || null,
    raw: payload,
  };
}

class OIDCGenericProvider implements OAuthProvider {
  readonly name: string;
  private discovery: OIDCDiscoveryDocument | null = null;

  constructor(
    providerName: string,
    private config: OIDCProviderConfig,
  ) {
    this.name = providerName;
  }

  private async getDiscovery(): Promise<OIDCDiscoveryDocument> {
    if (!this.discovery) {
      this.discovery = await fetchOIDCDiscovery(this.config.issuer);
    }
    return this.discovery;
  }

  getAuthorizationUrl(state: string, redirectUri: string, codeChallenge?: string): string {
    // For OIDC, we need the discovery document synchronously in getAuthorizationUrl.
    // We'll use a cached discovery doc if available, otherwise fall back to issuer + /authorize.
    const cached = oidcDiscoveryCache.get(this.config.issuer);
    const authEndpoint = cached?.doc?.authorization_endpoint
      || `${this.config.issuer.replace(/\/$/, '')}/authorize`;

    const scopes = this.config.scopes || ['openid', 'email', 'profile'];
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      state,
      nonce: state,
    });
    if (codeChallenge) {
      params.set('code_challenge', codeChallenge);
      params.set('code_challenge_method', 'S256');
    }
    return `${authEndpoint}?${params}`;
  }

  async exchangeCode(code: string, redirectUri: string, codeVerifier?: string): Promise<OAuthTokens> {
    const discovery = await this.getDiscovery();

    const bodyParams: Record<string, string> = {
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    };
    if (codeVerifier) {
      bodyParams.code_verifier = codeVerifier;
    }

    const resp = await fetchOIDCResponse(discovery.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(bodyParams),
    });

    if (!resp.ok) {
      // Provider bodies can echo codes, client credentials, or bearer tokens.
      // Never propagate them into application logs or top-level error JSON.
      throw new Error(`OIDC token exchange failed: ${resp.status}`);
    }

    const data = await readOIDCJson<Record<string, unknown>>(resp, 'token');
    return {
      accessToken: data.access_token as string,
      tokenType: (data.token_type as string) || 'Bearer',
      idToken: data.id_token as string | undefined,
      refreshToken: data.refresh_token as string | undefined,
      expiresIn: data.expires_in as number | undefined,
    };
  }

  async getUserInfo(accessToken: string): Promise<OAuthUserInfo> {
    const discovery = await this.getDiscovery();

    if (!discovery.userinfo_endpoint) {
      throw new Error(`OIDC provider ${this.name} does not have a userinfo endpoint`);
    }

    const resp = await fetchOIDCResponse(discovery.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!resp.ok) {
      throw new Error(`OIDC userinfo failed: ${resp.status}`);
    }

    const data = await readOIDCJson<Record<string, unknown>>(resp, 'userinfo');
    return {
      providerUserId: data.sub as string,
      email: (data.email as string) || null,
      emailVerified: isOAuthEmailVerified(data.email_verified),
      displayName: (data.name as string) || (data.preferred_username as string) || null,
      avatarUrl: (data.picture as string) || null,
      raw: data,
    };
  }
}

/**
 * Pre-fetch OIDC discovery document before calling getAuthorizationUrl().
 * This is needed because getAuthorizationUrl() is synchronous.
 */
export async function prefetchOIDCDiscovery(issuer: string): Promise<void> {
  await fetchOIDCDiscovery(issuer);
}

// ─── Provider Factory ───

const SUPPORTED_PROVIDERS = [
  'google', 'github', 'apple', 'discord',
  // M18: Additional providers
  'microsoft', 'facebook', 'kakao', 'naver', 'x', 'reddit', 'line', 'slack', 'spotify', 'twitch',
] as const;
export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number] | `oidc:${string}`;

/**
 * Check if a provider name is supported (built-in or OIDC federation).
 */
export function isSupportedProvider(name: string): name is SupportedProvider {
  if ((SUPPORTED_PROVIDERS as readonly string[]).includes(name)) return true;
  // OIDC federation: oidc:{name}
  if (/^oidc:[A-Za-z0-9._-]+$/.test(name)) return true;
  return false;
}

export function createOAuthProvider(name: SupportedProvider, config: OAuthProviderConfig): OAuthProvider {
  // OIDC federation: oidc:{name}
  if (name.startsWith('oidc:')) {
    const oidcConfig = config as OIDCProviderConfig;
    if (!oidcConfig.issuer) {
      throw new Error(`OIDC provider ${name} requires an 'issuer' in config.`);
    }
    return new OIDCGenericProvider(name, oidcConfig);
  }

  switch (name) {
    case 'google': return new GoogleOAuthProvider(config);
    case 'github': return new GitHubOAuthProvider(config);
    case 'apple': return new AppleOAuthProvider(config);
    case 'discord': return new DiscordOAuthProvider(config);
    // M18
    case 'microsoft': return new MicrosoftOAuthProvider(config);
    case 'facebook': return new FacebookOAuthProvider(config);
    case 'kakao': return new KakaoOAuthProvider(config);
    case 'naver': return new NaverOAuthProvider(config);
    case 'x': return new XOAuthProvider(config);
    case 'reddit': return new RedditOAuthProvider(config);
    case 'line': return new LineOAuthProvider(config);
    case 'slack': return new SlackOAuthProvider(config);
    case 'spotify': return new SpotifyOAuthProvider(config);
    case 'twitch': return new TwitchOAuthProvider(config);
    default: throw new Error(`Unknown OAuth provider: ${name}`);
  }
}

/**
 * Get OAuth provider config from a serialized config object.
 * Config format:
 *   - Built-in: auth.oauth.{provider}.clientId, auth.oauth.{provider}.clientSecret
 *   - OIDC: auth.oauth.oidc.{name}.clientId, auth.oauth.oidc.{name}.clientSecret, auth.oauth.oidc.{name}.issuer
 */
function parseOAuthConfigInput(
  edgebaseConfig: Record<string, unknown> | string | undefined,
): Record<string, unknown> | null {
  if (!edgebaseConfig) return null;
  if (typeof edgebaseConfig === 'string') {
    try {
      const parsed = JSON.parse(edgebaseConfig);
      return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
  return edgebaseConfig;
}

export function getOAuthProviderConfig(
  edgebaseConfig: Record<string, unknown> | string | undefined,
  provider: SupportedProvider,
): OAuthProviderConfig | OIDCProviderConfig | null {
  const config = parseOAuthConfigInput(edgebaseConfig) as
    | {
        auth?: {
          oauth?: Record<string, unknown> & {
            oidc?: Record<string, { clientId?: string; clientSecret?: string; issuer?: string; scopes?: string[] }>;
          };
        };
      }
    | null;
  if (!config) return null;

  // OIDC federation: oidc:{name}
  if (provider.startsWith('oidc:')) {
    const oidcName = provider.slice(5); // Remove 'oidc:' prefix
    const oidcConfig = config?.auth?.oauth?.oidc?.[oidcName];
    if (!oidcConfig?.clientId || !oidcConfig?.clientSecret || !oidcConfig?.issuer) return null;
    return {
      clientId: oidcConfig.clientId,
      clientSecret: oidcConfig.clientSecret,
      issuer: oidcConfig.issuer,
      scopes: oidcConfig.scopes,
    } as OIDCProviderConfig;
  }

  const oauthConfig = config?.auth?.oauth?.[provider] as
    | { clientId?: string; clientSecret?: string }
    | undefined;
  if (!oauthConfig?.clientId || !oauthConfig?.clientSecret) return null;
  return { clientId: oauthConfig.clientId, clientSecret: oauthConfig.clientSecret };
}

/**
 * Get list of allowed OAuth providers from config (includes OIDC federation providers).
 */
export function getAllowedOAuthProviders(
  edgebaseConfig: Record<string, unknown> | string | undefined,
): SupportedProvider[] {
  const config = parseOAuthConfigInput(edgebaseConfig) as
    | { auth?: { allowedOAuthProviders?: string[] } }
    | null;
  if (!config) return [];
  const allowed = config?.auth?.allowedOAuthProviders;
  if (!Array.isArray(allowed)) return [];
  return allowed.filter((p: string) => isSupportedProvider(p)) as SupportedProvider[];
}
