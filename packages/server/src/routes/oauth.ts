/**
 * OAuth routes — Worker-level OAuth2 flow
 *
 * Mounted at /api/auth/oauth — resolved paths:
 * GET  /api/auth/oauth/:provider              → Redirect to provider authorization URL
 * GET  /api/auth/oauth/:provider/callback     → Handle OAuth callback, create/link user
 * POST /api/auth/oauth/link/:provider         → Start authenticated account linking redirect
 * GET  /api/auth/oauth/link/:provider/callback → Handle link OAuth callback
 */
import { OpenAPIHono, createRoute, z, type HonoEnv } from '../lib/hono.js';
import type { Env } from '../types.js';
import { EdgeBaseError, getAuthAccess } from '@edgebase/shared';
import type { AuthAccess } from '@edgebase/shared';
import { parseConfig } from '../lib/do-router.js';
import {
  appendRedirectParams,
  parseClientRedirectInput,
  parseClientRedirectUrl,
} from '../lib/auth-redirect.js';
import { zodDefaultHook, jsonResponseSchema, errorResponseSchema } from '../lib/schemas.js';
import {
  isSupportedProvider,
  createOAuthProvider,
  getOAuthProviderConfig,
  getAllowedOAuthProviders,
  generatePKCE,
  parseAppleIdToken,
  parseOIDCIdToken,
  prefetchOIDCDiscovery,
  type OAuthUserInfo,
  type OIDCProviderConfig,
  type SupportedProvider,
} from '../lib/oauth-providers.js';
import {
  ensureAuthSchema,
  lookupOAuth,
  registerOAuthPending,
  confirmOAuth,
  deleteOAuth,
  lookupEmail,
  registerEmailPending,
  confirmEmail,
  deleteEmail,
  deleteEmailPending,
  deleteAnon,
  upsertUserPublic,
} from '../lib/auth-d1.js';
import type { UserPublicData } from '../lib/auth-d1.js';
import { captchaMiddleware } from '../middleware/captcha-verify.js';
import * as authService from '../lib/auth-d1-service.js';
import { signAccessToken, signRefreshToken, parseDuration } from '../lib/jwt.js';
import { generateId } from '../lib/uuid.js';
import { resolveAuthDb, type AuthDb } from '../lib/auth-db-adapter.js';
import { getTrustedClientIp } from '../lib/client-ip.js';

/** Resolve AuthDb from Hono context. Defaults to D1 (AUTH_DB binding). */
function getAuthDb(c: { env: unknown }): AuthDb {
  return resolveAuthDb(c.env as Record<string, unknown>);
}

/** Resolve AuthDb from env directly (for helper functions). */
function getAuthDbFromEnv(env: unknown): AuthDb {
  return resolveAuthDb(env as Record<string, unknown>);
}

type OAuthRuntimeConfig = Record<string, unknown> & {
  baseUrl?: string;
  captcha?: boolean;
  auth?: {
    session?: {
      accessTokenTTL?: string;
      refreshTokenTTL?: string;
    };
  };
};

function getOAuthRuntimeConfig(env: Env): OAuthRuntimeConfig {
  return parseConfig(env) as unknown as OAuthRuntimeConfig;
}

export const oauthRoute = new OpenAPIHono<HonoEnv>({ defaultHook: zodDefaultHook });

// Error handler for OAuth sub-app
oauthRoute.onError((err, c) => {
  if (err instanceof EdgeBaseError) {
    return c.json(err.toJSON(), err.code as 400);
  }
  console.error('OAuth unhandled error:', err);
  return c.json({ code: 500, message: 'OAuth error.' }, 500);
});

// ─── Helpers ───

function getBaseUrl(c: { env: Env; req: { url: string } }): string {
  try {
    const baseUrl = getOAuthRuntimeConfig(c.env).baseUrl;
    if (typeof baseUrl === 'string' && baseUrl.length > 0) {
      return baseUrl.replace(/\/$/, '');
    }
  } catch {
    // Fall back to request-derived origin below.
  }

  try {
    const requestUrl = new URL(c.req.url);
    return requestUrl.origin.replace(/\/$/, '');
  } catch {
    return '';
  }
}

function generateState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function getClientIP(env: Env, request: Request): string {
  return getTrustedClientIp(env, request) ?? '0.0.0.0';
}

type AuthAccessAction = Extract<keyof AuthAccess, string>;

async function ensureAuthActionAllowed(
  c: { env: Env; req: { raw: Request }; get(name: string): unknown },
  action: AuthAccessAction,
  input: Record<string, unknown> | null,
): Promise<void> {
  const config = parseConfig(c.env);
  const rule = getAuthAccess(config.auth)?.[action];
  if (!rule) return;

  const auth = (c.get('auth') as {
    id: string;
    role?: string;
    email?: string | null;
    isAnonymous?: boolean;
    custom?: Record<string, unknown> | null;
    meta?: Record<string, unknown>;
  } | null | undefined) ?? null;

  const allowed = await Promise.resolve(rule(input, {
    request: c.req.raw,
    auth: auth ? {
      id: auth.id,
      role: auth.role,
      email: auth.email ?? undefined,
      isAnonymous: auth.isAnonymous,
      custom: auth.custom ?? undefined,
      meta: auth.meta,
    } : null,
    ip: getClientIP(c.env, c.req.raw),
  }));

  if (!allowed) {
    throw new EdgeBaseError(403, `Auth action '${action}' is not allowed.`, undefined, 'action-not-allowed');
  }
}

/**
 * Create a session and generate JWT tokens for an OAuth user.
 * Shared by all OAuth flows (sign-in, auto-link, create, link).
 */
async function createOAuthSessionAndTokens(
  env: Env,
  user: Record<string, unknown>,
): Promise<{ accessToken: string; refreshToken: string }> {
  const userId = user.id as string;
  const secret = env.JWT_USER_SECRET;
  if (!secret) throw new EdgeBaseError(500, 'JWT_USER_SECRET is not configured.', undefined, 'internal-error');

  const config = getOAuthRuntimeConfig(env);
  const accessTTL = config.auth?.session?.accessTokenTTL ?? '15m';
  const refreshTTL = config.auth?.session?.refreshTokenTTL ?? '28d';

  const dbClaims = user.customClaims
    ? (typeof user.customClaims === 'string' ? JSON.parse(user.customClaims as string) : user.customClaims)
    : undefined;

  const accessToken = await signAccessToken(
    {
      sub: userId,
      email: user.email as string | null,
      displayName: (user.displayName as string | null) ?? undefined,
      role: user.role as string,
      isAnonymous: (typeof user.isAnonymous === 'number') ? user.isAnonymous === 1 : !!user.isAnonymous,
      custom: dbClaims,
    },
    secret,
    accessTTL,
  );

  const sessionId = generateId();
  const refreshToken = await signRefreshToken(
    { sub: userId, type: 'refresh', jti: sessionId },
    secret,
    refreshTTL,
  );

  const now = new Date().toISOString();
  const refreshTTLSeconds = parseDuration(refreshTTL);
  const expiresAt = new Date(Date.now() + refreshTTLSeconds * 1000).toISOString();

  await authService.createSession(getAuthDbFromEnv(env), {
    id: sessionId,
    userId,
    refreshToken,
    expiresAt,
    metadata: JSON.stringify({ ip: '0.0.0.0', userAgent: 'OAuth', lastActiveAt: now }),
  });

  return { accessToken, refreshToken };
}

// ─── D1 Schema Middleware ───

oauthRoute.use('*', async (c, next) => {
  await ensureAuthSchema(getAuthDb(c));
  await next();
});

// ─── Captcha for OAuth start ───
// captcha_token is passed as query parameter for GET requests
oauthRoute.use('/:provider', captchaMiddleware('oauth'));

// ─── GET /api/auth/oauth/:provider — Redirect to OAuth provider ───

const oauthRedirect = createRoute({
  operationId: 'oauthRedirect',
  method: 'get',
  path: '/{provider}',
  tags: ['client'],
  summary: 'Start OAuth redirect',
  request: { params: z.object({ provider: z.string() }) },
  responses: {
    302: { description: 'Redirect to OAuth provider' },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

oauthRoute.openapi(oauthRedirect, async (c) => {
  const providerName = c.req.param('provider')!;
  const appRedirectUrl = parseClientRedirectUrl(
    c.env,
    c.req.query('redirect_url') ?? c.req.query('redirectUrl'),
  );

  if (!isSupportedProvider(providerName)) {
    throw new EdgeBaseError(400, `Unsupported OAuth provider: ${providerName}`, undefined, 'validation-failed');
  }
  await ensureAuthActionAllowed(c, 'oauthRedirect', { provider: providerName });

  // Check if provider is allowed
  const configObj = getOAuthRuntimeConfig(c.env);
  const allowed = getAllowedOAuthProviders(configObj);
  if (allowed.length > 0 && !allowed.includes(providerName)) {
    throw new EdgeBaseError(400, `OAuth provider ${providerName} is not enabled.`, undefined, 'feature-not-enabled');
  }

  const providerConfig = getOAuthProviderConfig(configObj, providerName);
  if (!providerConfig) {
    throw new EdgeBaseError(500, `OAuth provider ${providerName} is not configured.`, undefined, 'internal-error');
  }

  // Pre-fetch OIDC discovery document (must happen before getAuthorizationUrl)
  if (providerName.startsWith('oidc:') && (providerConfig as OIDCProviderConfig).issuer) {
    await prefetchOIDCDiscovery((providerConfig as OIDCProviderConfig).issuer);
  }

  const provider = createOAuthProvider(providerName, providerConfig);
  const state = generateState();
  const redirectUri = `${getBaseUrl(c)}/api/auth/oauth/${encodeURIComponent(providerName)}/callback`;

  // PKCE for providers that require or strongly prefer it.
  let codeChallenge: string | undefined;
  let codeVerifier: string | undefined;
  if (providerName === 'google' || providerName === 'x' || providerName.startsWith('oidc:')) {
    const pkce = await generatePKCE();
    codeChallenge = pkce.codeChallenge;
    codeVerifier = pkce.codeVerifier;
  }

  // Determine if captcha was verified for this request
  let captchaPassed = false;
  try {
    if (getOAuthRuntimeConfig(c.env).captcha) {
      captchaPassed = true;
    }
  } catch { /* ignore */ }

  // Store state in KV
  await c.env.KV.put(
    `oauth:state:${state}`,
    JSON.stringify({
      provider: providerName,
      redirectUri,
      codeVerifier: codeVerifier || null,
      appRedirectUrl,
      ...(captchaPassed ? { captcha_passed: true } : {}),
    }),
    { expirationTtl: 300 },
  );

  const authUrl = provider.getAuthorizationUrl(state, redirectUri, codeChallenge);
  return c.redirect(authUrl);
});

// ─── GET /api/auth/oauth/:provider/callback — Handle OAuth callback ───

const oauthCallback = createRoute({
  operationId: 'oauthCallback',
  method: 'get',
  path: '/{provider}/callback',
  tags: ['client'],
  summary: 'OAuth callback',
  request: { params: z.object({ provider: z.string() }) },
  responses: {
    200: { description: 'Auth tokens', content: { 'application/json': { schema: jsonResponseSchema } } },
    302: { description: 'Redirect with tokens' },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

oauthRoute.openapi(oauthCallback, async (c) => {
  const providerName = c.req.param('provider')!;
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');

  if (error) {
    if (state) {
      const stateData = await c.env.KV.get(`oauth:state:${state}`);
      if (stateData) {
        try {
          const stored = JSON.parse(stateData) as {
            provider: string;
            appRedirectUrl?: string | null;
          };
          if (stored.provider === providerName && stored.appRedirectUrl) {
            await c.env.KV.delete(`oauth:state:${state}`);
            return c.redirect(appendRedirectParams(stored.appRedirectUrl, {
              error,
              error_description: c.req.query('error_description') || error,
            }));
          }
        } catch {
          // Fall through to JSON error response.
        }
      }
    }
    throw new EdgeBaseError(400, `OAuth error: ${c.req.query('error_description') || error}`, undefined, 'validation-failed');
  }
  if (!code || !state) {
    throw new EdgeBaseError(400, 'Missing code or state parameter.', undefined, 'validation-failed');
  }
  if (!isSupportedProvider(providerName)) {
    throw new EdgeBaseError(400, `Unsupported OAuth provider: ${providerName}`, undefined, 'validation-failed');
  }

  // Verify state from KV
  const stateData = await c.env.KV.get(`oauth:state:${state}`);
  if (!stateData) {
    throw new EdgeBaseError(400, 'Invalid or expired OAuth state.', undefined, 'invalid-token');
  }

  const { provider: storedProvider, redirectUri, codeVerifier, captcha_passed, appRedirectUrl } = JSON.parse(stateData) as {
    provider: string;
    redirectUri: string;
    codeVerifier: string | null;
    captcha_passed?: boolean;
    appRedirectUrl?: string | null;
  };
  if (storedProvider !== providerName) {
    throw new EdgeBaseError(400, 'OAuth state provider mismatch.', undefined, 'validation-failed');
  }
  await ensureAuthActionAllowed(c, 'oauthCallback', { provider: providerName, state });
  // Delete state immediately after policy check (single-use)
  await c.env.KV.delete(`oauth:state:${state}`);

  // Verify captcha was passed during OAuth initiation
  try {
    if (getOAuthRuntimeConfig(c.env).captcha && !captcha_passed) {
      if (!c.req.header('X-EdgeBase-Service-Key')) {
        throw new EdgeBaseError(403, 'Captcha verification required for OAuth.', undefined, 'forbidden');
      }
    }
  } catch (e) {
    if (e instanceof EdgeBaseError) throw e;
  }

  const configObj = getOAuthRuntimeConfig(c.env);
  const providerConfig = getOAuthProviderConfig(configObj, providerName);
  if (!providerConfig) {
    throw new EdgeBaseError(500, `OAuth provider ${providerName} is not configured.`, undefined, 'internal-error');
  }

  const provider = createOAuthProvider(providerName, providerConfig);

  // Exchange code for tokens
  const tokens = await provider.exchangeCode(code, redirectUri, codeVerifier || undefined);

  // Get user info
  let userInfo: OAuthUserInfo;
  if (providerName === 'apple' && tokens.idToken) {
    userInfo = parseAppleIdToken(tokens.idToken);
  } else if (providerName.startsWith('oidc:') && tokens.idToken) {
    // OIDC: prefer id_token claims, fall back to userinfo endpoint
    userInfo = parseOIDCIdToken(tokens.idToken);
  } else {
    userInfo = await provider.getUserInfo(tokens.accessToken);
  }

  // Normalize email
  if (userInfo.email) {
    userInfo = { ...userInfo, email: userInfo.email.trim().toLowerCase() };
  }

  // Process OAuth callback — this is the core logic
  const result = await processOAuthCallback(c.env, providerName, userInfo);
  if (appRedirectUrl) {
    return c.redirect(appendRedirectParams(appRedirectUrl, {
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
    }));
  }
  return c.json(result, result.created ? 201 : 200);
});

// ─── POST /api/auth/oauth/link/:provider — Start anonymous→OAuth linking ───

const oauthLinkStart = createRoute({
  operationId: 'oauthLinkStart',
  method: 'post',
  path: '/link/{provider}',
  tags: ['client'],
  summary: 'Start OAuth account linking',
  request: { params: z.object({ provider: z.string() }) },
  responses: {
    200: { description: 'Redirect URL', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

oauthRoute.openapi(oauthLinkStart, async (c) => {
  const providerName = c.req.param('provider')!;
  const body = await c.req.json<{ redirectUrl?: string; state?: string }>().catch(() => null);
  const redirect = parseClientRedirectInput(c.env, body);
  const appRedirectUrl = redirect.redirectUrl;

  if (!isSupportedProvider(providerName)) {
    throw new EdgeBaseError(400, `Unsupported OAuth provider: ${providerName}`, undefined, 'validation-failed');
  }

  // Verify JWT — user must be authenticated.
  const auth = c.get('auth') as { id: string; isAnonymous: boolean } | null;
  if (!auth) {
    throw new EdgeBaseError(401, 'Authentication required.', undefined, 'unauthenticated');
  }

  const userId = auth.id;
  await ensureAuthActionAllowed(c, 'oauthLinkStart', { provider: providerName, userId });

  const currentUser = await authService.getUserById(getAuthDb(c), userId);
  if (!currentUser) {
    throw new EdgeBaseError(404, 'User not found.', undefined, 'user-not-found');
  }
  if (Number(currentUser.disabled) === 1) {
    throw new EdgeBaseError(403, 'This account has been disabled.', undefined, 'account-disabled');
  }

  // Check if provider is allowed
  const configObj2 = getOAuthRuntimeConfig(c.env);
  const allowed2 = getAllowedOAuthProviders(configObj2);
  if (allowed2.length > 0 && !allowed2.includes(providerName)) {
    throw new EdgeBaseError(400, `OAuth provider ${providerName} is not enabled.`, undefined, 'feature-not-enabled');
  }

  const providerConfig2 = getOAuthProviderConfig(configObj2, providerName);
  if (!providerConfig2) {
    throw new EdgeBaseError(500, `OAuth provider ${providerName} is not configured.`, undefined, 'internal-error');
  }

  const provider = createOAuthProvider(providerName, providerConfig2);
  const state = generateState();
  const redirectUri = `${getBaseUrl(c)}/api/auth/oauth/link/${providerName}/callback`;
  const linkMode = auth.isAnonymous ? 'anonymous-upgrade' : 'attach-oauth';

  // PKCE for Google and OIDC providers
  let codeChallenge: string | undefined;
  let codeVerifier: string | undefined;
  if (providerName === 'google' || providerName.startsWith('oidc:')) {
    const pkce = await generatePKCE();
    codeChallenge = pkce.codeChallenge;
    codeVerifier = pkce.codeVerifier;
  }

  // Store state in KV with link metadata (shardId kept as 0 for legacy compatibility)
  await c.env.KV.put(
    `oauth:link-state:${state}`,
    JSON.stringify({
      provider: providerName,
      redirectUri,
      codeVerifier: codeVerifier || null,
      appRedirectUrl,
      linkUserId: userId,
      linkMode,
      appState: redirect.state,
    }),
    { expirationTtl: 300 },
  );

  const authUrl = provider.getAuthorizationUrl(state, redirectUri, codeChallenge);
  return c.json({ redirectUrl: authUrl });
});

// ─── GET /api/auth/oauth/link/:provider/callback — Handle link OAuth callback ───

const oauthLinkCallback = createRoute({
  operationId: 'oauthLinkCallback',
  method: 'get',
  path: '/link/{provider}/callback',
  tags: ['client'],
  summary: 'OAuth link callback',
  request: { params: z.object({ provider: z.string() }) },
  responses: {
    200: { description: 'Link result', content: { 'application/json': { schema: jsonResponseSchema } } },
    302: { description: 'Redirect after linking' },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

oauthRoute.openapi(oauthLinkCallback, async (c) => {
  const providerName = c.req.param('provider')!;
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');

  if (error) {
    if (state) {
      const stateData = await c.env.KV.get(`oauth:link-state:${state}`);
      if (stateData) {
        try {
          const stored = JSON.parse(stateData) as {
            provider: string;
            appState?: string | null;
            appRedirectUrl?: string | null;
          };
          if (stored.provider === providerName && stored.appRedirectUrl) {
            await c.env.KV.delete(`oauth:link-state:${state}`);
            return c.redirect(appendRedirectParams(stored.appRedirectUrl, {
              error,
              error_description: c.req.query('error_description') || error,
              state: stored.appState ?? undefined,
            }));
          }
        } catch {
          // Fall through to JSON error response.
        }
      }
    }
    throw new EdgeBaseError(400, `OAuth error: ${c.req.query('error_description') || error}`, undefined, 'validation-failed');
  }
  if (!code || !state) {
    throw new EdgeBaseError(400, 'Missing code or state parameter.', undefined, 'validation-failed');
  }
  if (!isSupportedProvider(providerName)) {
    throw new EdgeBaseError(400, `Unsupported OAuth provider: ${providerName}`, undefined, 'validation-failed');
  }

  // Verify link state from KV (different prefix from regular OAuth)
  const stateData = await c.env.KV.get(`oauth:link-state:${state}`);
  if (!stateData) {
    throw new EdgeBaseError(400, 'Invalid or expired OAuth link state.', undefined, 'invalid-token');
  }

  const { provider: storedProvider, redirectUri, codeVerifier, linkUserId, appRedirectUrl, linkMode, appState } = JSON.parse(stateData) as {
    provider: string;
    redirectUri: string;
    codeVerifier: string | null;
    linkUserId: string;
    linkMode?: 'anonymous-upgrade' | 'attach-oauth';
    appState?: string | null;
    appRedirectUrl?: string | null;
  };
  if (storedProvider !== providerName) {
    throw new EdgeBaseError(400, 'OAuth state provider mismatch.', undefined, 'validation-failed');
  }
  await ensureAuthActionAllowed(c, 'oauthLinkCallback', {
    provider: providerName,
    state,
    linkUserId,
  });
  await c.env.KV.delete(`oauth:link-state:${state}`);

  const configObj = getOAuthRuntimeConfig(c.env);
  const providerConfig = getOAuthProviderConfig(configObj, providerName);
  if (!providerConfig) {
    throw new EdgeBaseError(500, `OAuth provider ${providerName} is not configured.`, undefined, 'internal-error');
  }

  const provider = createOAuthProvider(providerName, providerConfig);

  // Exchange code for tokens
  const tokens = await provider.exchangeCode(code, redirectUri, codeVerifier || undefined);

  // Get user info
  let userInfo: OAuthUserInfo;
  if (providerName === 'apple' && tokens.idToken) {
    userInfo = parseAppleIdToken(tokens.idToken);
  } else {
    userInfo = await provider.getUserInfo(tokens.accessToken);
  }

  // Normalize email
  if (userInfo.email) {
    userInfo = { ...userInfo, email: userInfo.email.trim().toLowerCase() };
  }

  // Process link OAuth callback
  const result = linkMode === 'attach-oauth'
    ? await processAttachOAuthCallback(c.env, providerName, userInfo, linkUserId)
    : await processLinkOAuthCallback(c.env, providerName, userInfo, linkUserId);
  if (appRedirectUrl) {
    return c.redirect(appendRedirectParams(appRedirectUrl, {
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
      state: appState ?? undefined,
    }));
  }
  return c.json(result);
});

// ─── Core OAuth callback processing (D1-based,) ───

interface OAuthResult {
  user: Record<string, unknown>;
  accessToken: string;
  refreshToken: string;
  created: boolean;
}

async function processOAuthCallback(
  env: Env,
  providerName: SupportedProvider,
  userInfo: OAuthUserInfo,
): Promise<OAuthResult> {
  const db = getAuthDbFromEnv(env);
  // Step 1: Check _oauth_index in D1 for existing OAuth account
  const oauthRecord = await lookupOAuth(db, providerName, userInfo.providerUserId);

  // Case A: Existing OAuth account → just sign in
  if (oauthRecord) {
    const { userId } = oauthRecord;
    const user = await authService.getUserById(db, userId);
    if (!user) throw new EdgeBaseError(500, 'User not found for OAuth account.', undefined, 'internal-error');
    const { accessToken, refreshToken } = await createOAuthSessionAndTokens(env, user);
    return { user: authService.sanitizeUser(user), accessToken, refreshToken, created: false };
  }

  // Step 2: Check _email_index in D1 for auto-linking
  if (userInfo.email) {
    const emailRecord = await lookupEmail(db, userInfo.email);

    if (emailRecord) {
      // Auto-link: email_verified check
      if (userInfo.emailVerified) {
        return autoLinkOAuth(env, providerName, userInfo, emailRecord);
      }
      // email_verified = false → create new account (email 미제공 정책 동일 흐름)
      userInfo = { ...userInfo, email: null };
    } else {
      const existingUser = await db.first<{ id: string }>(
        `SELECT id FROM _users WHERE lower(email) = lower(?)`,
        [userInfo.email],
      );
      if (existingUser) {
        if (userInfo.emailVerified) {
          const existingUserId = String(existingUser.id);
          try {
            await registerEmailPending(db, userInfo.email, existingUserId);
            await confirmEmail(db, userInfo.email, existingUserId);
          } catch (err) {
            if ((err as Error).message !== 'EMAIL_ALREADY_REGISTERED') {
              throw err;
            }
          }
          return autoLinkOAuth(env, providerName, userInfo, { userId: existingUserId, shardId: 0 });
        }
        userInfo = { ...userInfo, email: null };
      }
    }
  }

  // Step 3: Create new user via OAuth
  return createOAuthUser(env, providerName, userInfo);
}

/**
 * Process link/oauth callback — anonymous → OAuth
 *
 * Does NOT apply auto-connect policy.
 * If email exists in _email_index as confirmed → 409 Conflict.
 */
async function processLinkOAuthCallback(
  env: Env,
  providerName: SupportedProvider,
  userInfo: OAuthUserInfo,
  linkUserId: string,
): Promise<OAuthResult> {
  // Check if OAuth account already exists in D1
  const oauthRecord = await lookupOAuth(getAuthDbFromEnv(env), providerName, userInfo.providerUserId);
  if (oauthRecord) {
    throw new EdgeBaseError(409, 'This OAuth account is already linked to another user.', undefined, 'already-exists');
  }

  // Check email conflict in D1
  if (userInfo.email) {
    const emailRecord = await lookupEmail(getAuthDbFromEnv(env), userInfo.email);
    if (emailRecord) {
      throw new EdgeBaseError(409, 'Email is already registered to another account.', undefined, 'email-already-exists');
    }
  }

  // D1: register in _oauth_index as pending
  try {
    await registerOAuthPending(getAuthDbFromEnv(env), providerName, userInfo.providerUserId, linkUserId);
  } catch (err) {
    if ((err as Error).message === 'OAUTH_ALREADY_LINKED') {
      throw new EdgeBaseError(409, 'This OAuth account is already linked.', undefined, 'already-exists');
    }
    throw err;
  }

  // If email available + verified, also register in _email_index
  if (userInfo.email && userInfo.emailVerified) {
    try {
      await registerEmailPending(getAuthDbFromEnv(env), userInfo.email, linkUserId);
    } catch {
      // If email registration fails, clean up OAuth and re-throw
      await deleteOAuth(getAuthDbFromEnv(env), providerName, userInfo.providerUserId).catch(() => {});
      throw new EdgeBaseError(409, 'Email is already registered.', undefined, 'email-already-exists');
    }
  }

  // Link OAuth directly in D1 instead of shard
  try {
    // Update user: set email/displayName/avatarUrl, clear isAnonymous
    const updates: Record<string, unknown> = { isAnonymous: 0 };
    if (userInfo.email) updates.email = userInfo.email;
    if (userInfo.displayName) updates.displayName = userInfo.displayName;
    if (userInfo.avatarUrl) updates.avatarUrl = userInfo.avatarUrl;
    if (userInfo.emailVerified) updates.verified = 1;
    await authService.updateUser(getAuthDbFromEnv(env), linkUserId, updates);

    // Create OAuth account
    const oauthId = generateId();
    await authService.createOAuthAccount(getAuthDbFromEnv(env), {
      id: oauthId,
      userId: linkUserId,
      provider: providerName,
      providerUserId: userInfo.providerUserId,
    });
  } catch (err) {
    // Compensating transactions — D1 cleanup
    await deleteOAuth(getAuthDbFromEnv(env), providerName, userInfo.providerUserId).catch(() => {});
    if (userInfo.email && userInfo.emailVerified) {
      await deleteEmail(getAuthDbFromEnv(env), userInfo.email).catch(() => {});
    }
    throw new EdgeBaseError(500, `Link failed: ${(err as Error).message}`, undefined, 'internal-error');
  }

  // Confirm in D1
  await confirmOAuth(getAuthDbFromEnv(env), providerName, userInfo.providerUserId);
  if (userInfo.email && userInfo.emailVerified) {
    await confirmEmail(getAuthDbFromEnv(env), userInfo.email, linkUserId);
  }

  // Best-effort: delete from _anon_index in D1
  await deleteAnon(getAuthDbFromEnv(env), linkUserId).catch(() => {});

  // Get updated user and create session
  const user = await authService.getUserById(getAuthDbFromEnv(env), linkUserId);
  if (!user) throw new EdgeBaseError(500, 'User not found after link.', undefined, 'internal-error');
  const { accessToken, refreshToken } = await createOAuthSessionAndTokens(env, user);

  // Sync _users_public
  try {
    await upsertUserPublic(getAuthDbFromEnv(env), linkUserId, authService.buildPublicUserData(user) as unknown as UserPublicData);
  } catch { /* best-effort */ }

  return { user: authService.sanitizeUser(user), accessToken, refreshToken, created: false };
}

/**
 * Process link/oauth callback — authenticated user attaches an additional OAuth identity.
 */
async function processAttachOAuthCallback(
  env: Env,
  providerName: SupportedProvider,
  userInfo: OAuthUserInfo,
  linkUserId: string,
): Promise<OAuthResult> {
  const db = getAuthDbFromEnv(env);

  const oauthRecord = await lookupOAuth(db, providerName, userInfo.providerUserId);
  if (oauthRecord) {
    if (oauthRecord.userId === linkUserId) {
      throw new EdgeBaseError(409, 'This OAuth account is already linked to your user.', undefined, 'already-exists');
    }
    throw new EdgeBaseError(409, 'This OAuth account is already linked to another user.', undefined, 'already-exists');
  }

  const currentUser = await authService.getUserById(db, linkUserId);
  if (!currentUser) throw new EdgeBaseError(404, 'User not found.');
  if (Number(currentUser.disabled) === 1) throw new EdgeBaseError(403, 'This account has been disabled.');

  let pendingEmail: string | null = null;
  const updates: Record<string, unknown> = {};
  const currentEmail = typeof currentUser.email === 'string' ? currentUser.email : null;

  if (!currentUser.displayName && userInfo.displayName) {
    updates.displayName = userInfo.displayName;
  }
  if (!currentUser.avatarUrl && userInfo.avatarUrl) {
    updates.avatarUrl = userInfo.avatarUrl;
  }

  if (userInfo.email && userInfo.emailVerified) {
    if (!currentEmail) {
      const emailRecord = await lookupEmail(db, userInfo.email);
      if (emailRecord && emailRecord.userId !== linkUserId) {
        throw new EdgeBaseError(409, 'Email is already registered to another account.', undefined, 'email-already-exists');
      }
      if (!emailRecord) {
        pendingEmail = userInfo.email;
        await registerEmailPending(db, pendingEmail, linkUserId);
      }
      updates.email = userInfo.email;
      updates.verified = 1;
    } else if (currentEmail === userInfo.email && !currentUser.verified) {
      updates.verified = 1;
    }
  }

  try {
    await registerOAuthPending(db, providerName, userInfo.providerUserId, linkUserId);
    if (Object.keys(updates).length > 0) {
      await authService.updateUser(db, linkUserId, updates);
    }
    await authService.createOAuthAccount(db, {
      id: generateId(),
      userId: linkUserId,
      provider: providerName,
      providerUserId: userInfo.providerUserId,
    });
  } catch (err) {
    await deleteOAuth(db, providerName, userInfo.providerUserId).catch(() => {});
    if (pendingEmail) {
      await deleteEmailPending(db, pendingEmail).catch(() => {});
    }
    if (err instanceof EdgeBaseError) throw err;
    throw new EdgeBaseError(500, `Link failed: ${(err as Error).message}`, undefined, 'internal-error');
  }

  await confirmOAuth(db, providerName, userInfo.providerUserId);
  if (pendingEmail) {
    await confirmEmail(db, pendingEmail, linkUserId);
  }

  const user = await authService.getUserById(db, linkUserId);
  if (!user) throw new EdgeBaseError(500, 'User not found after link.', undefined, 'internal-error');
  const { accessToken, refreshToken } = await createOAuthSessionAndTokens(env, user);

  try {
    await upsertUserPublic(db, linkUserId, authService.buildPublicUserData(user) as unknown as UserPublicData);
  } catch { /* best-effort */ }

  return { user: authService.sanitizeUser(user), accessToken, refreshToken, created: false };
}

/**
 * Auto-link: add OAuth to existing email-verified user
 */
async function autoLinkOAuth(
  env: Env,
  providerName: SupportedProvider,
  userInfo: OAuthUserInfo,
  emailRecord: { userId: string; shardId: number },
): Promise<OAuthResult> {
  const { userId } = emailRecord;
  const db = getAuthDbFromEnv(env);

  // D1: register in _oauth_index
  try {
    await registerOAuthPending(db, providerName, userInfo.providerUserId, userId);
  } catch (err) {
    if ((err as Error).message === 'OAUTH_ALREADY_LINKED') {
      throw new EdgeBaseError(409, 'This OAuth account is already linked.', undefined, 'already-exists');
    }
    throw err;
  }

  const currentUser = await authService.getUserById(db, userId);
  if (!currentUser) throw new EdgeBaseError(404, 'User not found.');
  if (Number(currentUser.disabled) === 1) throw new EdgeBaseError(403, 'This account has been disabled.');

  const updates: Record<string, unknown> = {};
  if (!currentUser.displayName && userInfo.displayName) {
    updates.displayName = userInfo.displayName;
  }
  if (!currentUser.avatarUrl && userInfo.avatarUrl) {
    updates.avatarUrl = userInfo.avatarUrl;
  }
  if (!currentUser.email && userInfo.email) {
    updates.email = userInfo.email;
  }
  if (userInfo.emailVerified && !currentUser.verified) {
    updates.verified = 1;
  }

  try {
    if (Object.keys(updates).length > 0) {
      await authService.updateUser(db, userId, updates);
    }
    const oauthId = generateId();
    await authService.createOAuthAccount(db, {
      id: oauthId,
      userId,
      provider: providerName,
      providerUserId: userInfo.providerUserId,
    });
    await confirmOAuth(db, providerName, userInfo.providerUserId);
  } catch (err) {
    await deleteOAuth(db, providerName, userInfo.providerUserId).catch(() => {});
    if (err instanceof EdgeBaseError) throw err;
    throw new EdgeBaseError(500, `OAuth auto-link failed: ${(err as Error).message}`, undefined, 'internal-error');
  }

  // Get user and create session
  const user = await authService.getUserById(db, userId);
  if (!user) throw new EdgeBaseError(500, 'User not found.', undefined, 'internal-error');
  const { accessToken, refreshToken } = await createOAuthSessionAndTokens(env, user);

  return { user: authService.sanitizeUser(user), accessToken, refreshToken, created: false };
}

/**
 * Create new OAuth user
 */
async function createOAuthUser(
  env: Env,
  providerName: SupportedProvider,
  userInfo: OAuthUserInfo,
): Promise<OAuthResult> {
  const userId = crypto.randomUUID();
  const db = getAuthDbFromEnv(env);
  const reservedEmail = userInfo.email && userInfo.emailVerified ? userInfo.email : null;
  let userCreated = false;
  let user: Record<string, unknown> | null = null;

  // D1: register in _oauth_index as pending
  try {
    await registerOAuthPending(db, providerName, userInfo.providerUserId, userId);
  } catch (err) {
    if ((err as Error).message === 'OAUTH_ALREADY_LINKED') {
      throw new EdgeBaseError(409, 'This OAuth account is already linked.', undefined, 'already-exists');
    }
    throw err;
  }

  // If email is available + verified, also register in _email_index
  if (reservedEmail) {
    try {
      await registerEmailPending(db, reservedEmail, userId);
    } catch {
      await deleteOAuth(db, providerName, userInfo.providerUserId).catch(() => {});
      throw new EdgeBaseError(409, 'Email is already registered.', undefined, 'email-already-exists');
    }
  }

  try {
    // Create user directly in D1
    user = await authService.createUser(db, {
      userId,
      email: userInfo.email ?? null,
      passwordHash: '', // no password for OAuth users
      displayName: userInfo.displayName,
      avatarUrl: userInfo.avatarUrl,
      verified: !!userInfo.emailVerified,
      role: 'user',
    });
    userCreated = true;

    // Create OAuth account in D1
    const oauthId = generateId();
    await authService.createOAuthAccount(db, {
      id: oauthId,
      userId,
      provider: providerName,
      providerUserId: userInfo.providerUserId,
    });

    // Confirm in D1
    await confirmOAuth(db, providerName, userInfo.providerUserId);
    if (reservedEmail) {
      await confirmEmail(db, reservedEmail, userId);
    }

    // Create session
    const { accessToken, refreshToken } = await createOAuthSessionAndTokens(env, user);

    // Sync to _users_public
    try {
      await upsertUserPublic(db, userId, authService.buildPublicUserData(user) as unknown as UserPublicData);
    } catch { /* best-effort */ }

    return { user: authService.sanitizeUser(user), accessToken, refreshToken, created: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!userCreated && reservedEmail && userInfo.emailVerified && /_users\.email|idx_users_email/i.test(message)) {
      const existingUser = await db.first<{ id: string }>(
        `SELECT id FROM _users WHERE lower(email) = lower(?)`,
        [reservedEmail],
      );
      await deleteOAuth(db, providerName, userInfo.providerUserId).catch(() => {});
      await deleteEmailPending(db, reservedEmail).catch(() => {});
      if (existingUser) {
        try {
          await registerEmailPending(db, reservedEmail, existingUser.id);
          await confirmEmail(db, reservedEmail, existingUser.id);
        } catch (healingErr) {
          if ((healingErr as Error).message !== 'EMAIL_ALREADY_REGISTERED') {
            throw healingErr;
          }
        }
        return autoLinkOAuth(env, providerName, userInfo, {
          userId: existingUser.id,
          shardId: 0,
        });
      }
    }

    await deleteOAuth(db, providerName, userInfo.providerUserId).catch(() => {});
    if (reservedEmail) {
      await deleteEmail(db, reservedEmail).catch(() => {});
    }
    if (userCreated) {
      await authService.deleteUserCascade(db, userId).catch(() => {});
      await db.run(`DELETE FROM _users_public WHERE id = ?`, [userId]).catch(() => {});
    }
    if (err instanceof EdgeBaseError) throw err;
    throw new EdgeBaseError(500, `OAuth user creation failed: ${(err as Error).message}`, undefined, 'internal-error');
  }
}
