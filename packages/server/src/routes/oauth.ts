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
import type { Context, MiddlewareHandler } from 'hono';
import type { Env } from '../types.js';
import { EdgeBaseError, getAuthAccess } from '@edge-base/shared';
import type { AuthAccess } from '@edge-base/shared';
import { parseConfig } from '../lib/do-router.js';
import {
  appendRedirectParams,
  parseClientRedirectInput,
  parseClientRedirectUrl,
} from '../lib/auth-redirect.js';
import { zodDefaultHook, jsonResponseSchema, errorResponseSchema } from '../lib/schemas.js';
import { resolveServiceKeyCandidate, validateKey, buildConstraintCtx } from '../lib/service-key.js';
import {
  isSupportedProvider,
  createOAuthProvider,
  getOAuthProviderConfig,
  getAllowedOAuthProviders,
  generatePKCE,
  verifyAppleIdToken,
  verifyOIDCIdToken,
  assertOIDCUserInfoSubject,
  validateOIDCProviderSecurity,
  prefetchOIDCDiscovery,
  type OAuthUserInfo,
  type OAuthTokens,
  type OIDCProviderConfig,
  type SupportedProvider,
} from '../lib/oauth-providers.js';
import {
  ensureAuthSchema,
  lookupOAuth,
  registerOAuthPending,
  deleteOAuthPending,
  lookupEmail,
  registerEmailPending,
  confirmEmail,
  deleteEmailPending,
  upsertUserPublic,
} from '../lib/auth-d1.js';
import type { UserPublicData } from '../lib/auth-d1.js';
import { captchaMiddleware } from '../middleware/captcha-verify.js';
import * as authService from '../lib/auth-d1-service.js';
import { generateId } from '../lib/uuid.js';
import { resolveAuthDb, type AuthDb } from '../lib/auth-db-adapter.js';
import { getTrustedClientIp } from '../lib/client-ip.js';
import { counter, getLimit } from '../middleware/rate-limit.js';
import { resolvePublicRequestOrigin } from '../lib/public-origin.js';
import { getWorkerUrl } from '../lib/functions.js';
import {
  applyAuthNoStore,
  assertAuthTransportAllowed,
  assertCookieAuthEnabled,
  cookieSessionResponse,
  ensureOAuthBrowserGeneration,
  isCookieAuthTransport,
  readOAuthBrowserGeneration,
  setOAuthBrowserGeneration,
  setRefreshCookie,
  setOAuthStateCookie,
  clearOAuthStateCookie,
  verifyOAuthStateCookie,
  verifyOAuthBrowserGeneration,
} from '../lib/auth-session-cookie.js';
import {
  claimOAuthCompletion,
  checkpointOAuthCompletion,
  completeOAuthCompletion,
  consumeOAuthTransient,
  putOAuthTransient,
  releaseOAuthCompletion,
  renewOAuthCompletion,
} from '../lib/oauth-state-store.js';
import { createSessionAndTokens, executeAuthHook } from './auth.js';

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
  release?: boolean;
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
  applyAuthNoStore(c);
  if (err instanceof EdgeBaseError) {
    return c.json(err.toJSON(), err.code as 400);
  }
  console.error('OAuth unhandled error:', err);
  return c.json({ code: 500, message: 'OAuth flow failed unexpectedly. Check the worker logs for the original exception.' }, 500);
});

// ─── Helpers ───

export function resolveOAuthBaseUrl(env: Env, request: Request): string {
  const config = getOAuthRuntimeConfig(env);
  const configured = typeof config.baseUrl === 'string' && config.baseUrl.trim()
    ? config.baseUrl.trim()
    : null;
  const raw = configured ?? resolvePublicRequestOrigin(env, request);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new EdgeBaseError(500, 'OAuth baseUrl must be an absolute HTTP(S) origin.', undefined, 'invalid-config');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.username
    || url.password
    || (url.pathname !== '' && url.pathname !== '/')
    || url.search
    || url.hash
  ) {
    throw new EdgeBaseError(500, 'OAuth baseUrl must contain only an HTTP(S) origin.', undefined, 'invalid-config');
  }
  const requestUrl = new URL(request.url);
  const localDevelopmentLoopback = env.EDGEBASE_RUNTIME_MODE === 'local-development'
    && (() => {
      const ip = getTrustedClientIp(env, request);
      return ip === '::1' || ip === '[::1]' || ip?.startsWith('127.') === true;
    })()
    && requestUrl.protocol === 'http:'
    && (requestUrl.hostname === 'localhost'
      || requestUrl.hostname === '127.0.0.1'
      || requestUrl.hostname === '[::1]')
    && url.protocol === 'http:'
    && (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]');
  if (config.release === true && url.protocol !== 'https:' && !localDevelopmentLoopback) {
    throw new EdgeBaseError(500, 'OAuth baseUrl must use HTTPS in release mode.', undefined, 'invalid-config');
  }
  return url.origin;
}

function getBaseUrl(c: { env: Env; req: { raw: Request } }): string {
  return resolveOAuthBaseUrl(c.env, c.req.raw);
}

function generateState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const OAUTH_RECOVERY_NONCE_PATTERN = /^[0-9a-f]{64}$/;
const OAUTH_CALLBACK_CODE_MAX = 8192;
const OAUTH_CALLBACK_ERROR_MAX = 256;
const OAUTH_CALLBACK_ERROR_DESCRIPTION_MAX = 2048;
const OAUTH_COMPLETION_TTL_SECONDS = 5 * 60;
const oauthStateSchema = z.string().regex(OAUTH_RECOVERY_NONCE_PATTERN);
const oauthCallbackQuerySchema = z.object({
  code: z.string().max(OAUTH_CALLBACK_CODE_MAX).optional(),
  state: oauthStateSchema.optional(),
  error: z.string().max(OAUTH_CALLBACK_ERROR_MAX).optional(),
  error_description: z.string().max(OAUTH_CALLBACK_ERROR_DESCRIPTION_MAX).optional(),
});
const oauthRecoveryNonceSchema = z.string()
  .regex(OAUTH_RECOVERY_NONCE_PATTERN)
  .openapi({
    description: 'Optional 32-byte lowercase hexadecimal client SDK callback-binding nonce.',
    example: 'ab'.repeat(32),
  });
const oauthRedirectQuerySchema = z.object({
  captcha_token: z.string().optional().openapi({ description: 'Optional CAPTCHA token for OAuth start.' }),
  auth_transport: z.string().optional().openapi({ description: "Optional refresh-token transport; only 'cookie' is supported." }),
  redirect_url: z.string().optional().openapi({ description: 'Client application callback URL.' }),
  redirectUrl: z.string().optional().openapi({ description: 'Legacy camelCase alias for redirect_url.' }),
  oauth_recovery_nonce: oauthRecoveryNonceSchema.optional(),
});
const oauthLinkStartBodySchema = z.object({
  redirectUrl: z.string().optional().openapi({ description: 'Client application callback URL.' }),
  state: z.string().max(1024).optional().openapi({ description: 'Optional application state returned with the callback.' }),
  oauthRecoveryNonce: oauthRecoveryNonceSchema.optional(),
});
const oauthCallbackFormSchema = z.object({
  code: z.string().max(OAUTH_CALLBACK_CODE_MAX).optional(),
  state: oauthStateSchema.optional(),
  error: z.string().max(OAUTH_CALLBACK_ERROR_MAX).optional(),
  error_description: z.string().max(OAUTH_CALLBACK_ERROR_DESCRIPTION_MAX).optional(),
  user: z.string().max(8192).optional().openapi({
    description: 'Apple first-authorization user profile JSON.',
  }),
});

interface OAuthCallbackInput {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
  appleUser?: string;
}

function validateOAuthCallbackInput(input: OAuthCallbackInput): void {
  if (input.state !== undefined && !OAUTH_RECOVERY_NONCE_PATTERN.test(input.state)) {
    throw new EdgeBaseError(400, 'Invalid OAuth state.', undefined, 'validation-failed');
  }
  if (input.code !== undefined && input.code.length > OAUTH_CALLBACK_CODE_MAX) {
    throw new EdgeBaseError(400, 'OAuth code is too large.', undefined, 'validation-failed');
  }
  if (input.error !== undefined && input.error.length > OAUTH_CALLBACK_ERROR_MAX) {
    throw new EdgeBaseError(400, 'OAuth error is too large.', undefined, 'validation-failed');
  }
  if (
    input.errorDescription !== undefined
    && input.errorDescription.length > OAUTH_CALLBACK_ERROR_DESCRIPTION_MAX
  ) {
    throw new EdgeBaseError(400, 'OAuth error description is too large.', undefined, 'validation-failed');
  }
  if (input.appleUser !== undefined && input.appleUser.length > 8192) {
    throw new EdgeBaseError(400, 'Apple user payload is too large.', undefined, 'validation-failed');
  }
}

function oauthStateKey(provider: string, state: string): string {
  return `oauth:state:${provider}:${state}`;
}

function oauthLinkStateKey(provider: string, state: string): string {
  return `oauth:link-state:${provider}:${state}`;
}

export function normalizeOAuthUserInfo(userInfo: OAuthUserInfo): OAuthUserInfo {
  const providerUserId = typeof userInfo.providerUserId === 'string'
    ? userInfo.providerUserId.trim()
    : '';
  if (
    !providerUserId
    || providerUserId.length > 512
    || providerUserId === 'undefined'
    || providerUserId === 'null'
  ) {
    throw new EdgeBaseError(400, 'OAuth provider returned an invalid user identifier.', undefined, 'invalid-provider-response');
  }
  let email: string | null = null;
  if (userInfo.email !== null) {
    if (typeof userInfo.email !== 'string') {
      throw new EdgeBaseError(400, 'OAuth provider returned an invalid email.', undefined, 'invalid-provider-response');
    }
    email = userInfo.email.trim().toLowerCase();
    if (email.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(email)) {
      throw new EdgeBaseError(400, 'OAuth provider returned an invalid email.', undefined, 'invalid-provider-response');
    }
  }
  const displayName = userInfo.displayName === null ? null : userInfo.displayName?.trim();
  if (displayName !== null && (typeof displayName !== 'string' || displayName.length > 200)) {
    throw new EdgeBaseError(400, 'OAuth provider returned an invalid display name.', undefined, 'invalid-provider-response');
  }
  let avatarUrl = userInfo.avatarUrl;
  if (avatarUrl !== null) {
    if (typeof avatarUrl !== 'string' || avatarUrl.length > 2048) {
      throw new EdgeBaseError(400, 'OAuth provider returned an invalid avatar URL.', undefined, 'invalid-provider-response');
    }
    try {
      const avatar = new URL(avatarUrl);
      if (avatar.protocol !== 'https:' && avatar.protocol !== 'http:') throw new Error('scheme');
      avatarUrl = avatar.toString();
    } catch {
      throw new EdgeBaseError(400, 'OAuth provider returned an invalid avatar URL.', undefined, 'invalid-provider-response');
    }
  }
  return { ...userInfo, providerUserId, email, displayName: displayName || null, avatarUrl };
}

export function normalizeOAuthTokens(
  tokens: OAuthTokens,
  providerName: SupportedProvider,
): OAuthTokens {
  if (
    typeof tokens.accessToken !== 'string'
    || !tokens.accessToken
    || tokens.accessToken.length > 16_384
  ) {
    throw new EdgeBaseError(400, 'OAuth provider returned an invalid access token.', undefined, 'invalid-provider-response');
  }
  if (tokens.idToken !== undefined && (typeof tokens.idToken !== 'string' || !tokens.idToken || tokens.idToken.length > 32_768)) {
    throw new EdgeBaseError(400, 'OAuth provider returned an invalid ID token.', undefined, 'invalid-provider-response');
  }
  if ((providerName === 'apple' || providerName.startsWith('oidc:')) && !tokens.idToken) {
    throw new EdgeBaseError(400, 'OAuth provider response is missing id_token.', undefined, 'invalid-provider-response');
  }
  if (typeof tokens.tokenType !== 'string' || !tokens.tokenType || tokens.tokenType.length > 64) {
    throw new EdgeBaseError(400, 'OAuth provider returned an invalid token type.', undefined, 'invalid-provider-response');
  }
  if (tokens.refreshToken !== undefined && (typeof tokens.refreshToken !== 'string' || tokens.refreshToken.length > 16_384)) {
    throw new EdgeBaseError(400, 'OAuth provider returned an invalid refresh token.', undefined, 'invalid-provider-response');
  }
  return tokens;
}

function ticketUserInfo(userInfo: OAuthUserInfo): OAuthUserInfo {
  return { ...userInfo, raw: {} };
}

const oauthCompletionBodySchema = z.object({
  ticket: oauthStateSchema,
  oauthRecoveryNonce: oauthRecoveryNonceSchema.optional(),
});

interface OAuthSignInCompletion {
  kind: 'signin';
  provider: SupportedProvider;
  userInfo: OAuthUserInfo;
  oauthRecoveryNonce: string | null;
  authTransport: 'body' | 'cookie';
  browserGeneration?: string;
  newUserId?: string;
  lifecycleBefore?: 'signUp' | 'signIn';
  oauthReservationId?: string;
  emailReservationId?: string;
}

interface OAuthLinkCompletion {
  kind: 'link';
  provider: SupportedProvider;
  userInfo: OAuthUserInfo;
  linkUserId: string;
  linkSessionId: string;
  linkMode: 'anonymous-upgrade' | 'attach-oauth';
  oauthRecoveryNonce: string | null;
  authTransport: 'body' | 'cookie';
  browserGeneration?: string;
  identityMutationStarted?: boolean;
}

function assertCompletionBinding(
  c: Context<HonoEnv>,
  stored: { oauthRecoveryNonce: string | null; authTransport: 'body' | 'cookie' },
  suppliedNonce: string | undefined,
): void {
  if ((stored.oauthRecoveryNonce ?? undefined) !== suppliedNonce) {
    throw new EdgeBaseError(400, 'OAuth completion nonce mismatch.', undefined, 'invalid-token');
  }
  const requestedTransport = isCookieAuthTransport(c) ? 'cookie' : 'body';
  if (stored.authTransport !== requestedTransport) {
    throw new EdgeBaseError(400, 'OAuth completion transport mismatch.', undefined, 'invalid-token');
  }
}

type OAuthLifecycleEvent = 'signUp' | 'signIn';

interface OAuthLifecycleHooks {
  readonly oauthReservationId?: string;
  readonly emailReservationId?: string;
  checkpointOAuthReservation(reservationId: string): Promise<void>;
  checkpointEmailReservation(reservationId: string): Promise<void>;
  beforeSignUp(userId: string, provider: SupportedProvider, userInfo: OAuthUserInfo): Promise<void>;
  beforeSignIn(user: Record<string, unknown>): Promise<void>;
  assertFinalizeOutcome(created: boolean): void;
}

function createOAuthLifecycleHooks(
  c: Context<HonoEnv>,
  completion?: OAuthSignInCompletion,
  checkpoint?: () => Promise<void>,
  directProvider?: SupportedProvider,
): OAuthLifecycleHooks {
  let beforeEvent: OAuthLifecycleEvent | undefined = completion?.lifecycleBefore;
  const authProvider = completion?.provider ?? directProvider;
  const run = async (event: OAuthLifecycleEvent, userData: Record<string, unknown>) => {
    if (completion?.lifecycleBefore) {
      if (completion.lifecycleBefore !== event) {
        throw new EdgeBaseError(
          409,
          'OAuth account state changed during lifecycle validation.',
          undefined,
          'auth-state-changed',
        );
      }
      beforeEvent = completion.lifecycleBefore;
      return;
    }
    await executeAuthHook(
      c.env,
      c.executionCtx,
      event === 'signUp' ? 'beforeSignUp' : 'beforeSignIn',
      userData,
      {
        blocking: true,
        workerUrl: getWorkerUrl(c.req.url, c.env),
        authMethod: 'oauth',
        ...(authProvider ? { authProvider } : {}),
      },
    );
    if (completion) {
      completion.lifecycleBefore = event;
      await checkpoint?.();
    }
    beforeEvent = event;
  };
  return {
    get oauthReservationId() {
      return completion?.oauthReservationId;
    },
    get emailReservationId() {
      return completion?.emailReservationId;
    },
    checkpointOAuthReservation: async (reservationId) => {
      if (!completion || completion.oauthReservationId === reservationId) return;
      completion.oauthReservationId = reservationId;
      await checkpoint?.();
    },
    checkpointEmailReservation: async (reservationId) => {
      if (!completion || completion.emailReservationId === reservationId) return;
      completion.emailReservationId = reservationId;
      await checkpoint?.();
    },
    beforeSignUp: (userId, provider, userInfo) => run('signUp', {
      id: userId,
      email: userInfo.email,
      displayName: userInfo.displayName,
      avatarUrl: userInfo.avatarUrl,
      provider,
    }),
    beforeSignIn: (user) => run('signIn', authService.sanitizeUser(user)),
    assertFinalizeOutcome: (created) => {
      const committedEvent: OAuthLifecycleEvent = created ? 'signUp' : 'signIn';
      if (beforeEvent !== committedEvent) {
        throw new EdgeBaseError(
          409,
          'OAuth lifecycle classification changed during atomic finalization.',
          undefined,
          'auth-state-changed',
        );
      }
    },
  };
}

function scheduleOAuthAfterLifecycleHook(
  c: Context<HonoEnv>,
  event: OAuthLifecycleEvent,
  user: Record<string, unknown>,
  authProvider: SupportedProvider,
): void {
  const trigger = event === 'signUp' ? 'afterSignUp' : 'afterSignIn';
  c.executionCtx.waitUntil(
    executeAuthHook(
      c.env,
      c.executionCtx,
      trigger,
      user,
      {
        workerUrl: getWorkerUrl(c.req.url, c.env),
        authMethod: 'oauth',
        authProvider,
      },
    ).catch(() => undefined),
  );
}

async function completionStorageKey(prefix: string, components: Array<string | null | undefined>): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(components.map((value) => value ?? null)));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoded));
  const suffix = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${prefix}:${suffix}`;
}

interface CachedOAuthCompletionResult {
  version: 1;
  kind: 'signin' | 'link';
  result: OAuthResult;
  status: 200 | 201;
  acceptedBrowserGenerations?: string[];
  acceptedLinkSessionIds?: string[];
}

function completionSessionId(storageKey: string): string {
  const digest = storageKey.slice(storageKey.lastIndexOf(':') + 1);
  return `oauth_${digest}`;
}

async function claimCompletionWithWait(env: Env, storageKey: string) {
  const claimId = generateState();
  const deadline = Date.now() + 10_000;
  while (true) {
    const claim = await claimOAuthCompletion(env, storageKey, claimId);
    if (claim.status !== 'in-progress') return claim;
    if (Date.now() >= deadline) {
      throw new EdgeBaseError(
        503,
        'OAuth completion is still in progress. Retry the same ticket.',
        undefined,
        'temporarily-unavailable',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function startCompletionLeaseHeartbeat(env: Env, storageKey: string, claimId: string) {
  let stopped = false;
  let lost = false;
  let pending: Promise<void> = Promise.resolve();
  const renew = () => {
    pending = pending.then(async () => {
      if (stopped || lost) return;
      try {
        if (!await renewOAuthCompletion(env, storageKey, claimId)) lost = true;
      } catch {
        // A transient coordinator failure is retried on the next heartbeat;
        // exact ownership is checked synchronously again before completion.
      }
    });
    return pending;
  };
  const timer = setInterval(() => { void renew(); }, 5_000);
  return {
    async assertAndRenew(): Promise<void> {
      await renew();
      if (lost) {
        throw new EdgeBaseError(
          503,
          'OAuth completion ownership changed. Retry the same ticket.',
          undefined,
          'temporarily-unavailable',
        );
      }
    },
    async stop(): Promise<void> {
      stopped = true;
      clearInterval(timer);
      await pending;
    },
  };
}

function parseCachedCompletion(raw: string, expectedKind: 'signin' | 'link'): CachedOAuthCompletionResult {
  let cached: CachedOAuthCompletionResult;
  try {
    cached = JSON.parse(raw) as CachedOAuthCompletionResult;
  } catch {
    throw new EdgeBaseError(500, 'Invalid cached OAuth completion result.', undefined, 'internal-error');
  }
  if (
    cached.version !== 1
    || cached.kind !== expectedKind
    || (cached.status !== 200 && cached.status !== 201)
    || !cached.result
    || typeof cached.result.accessToken !== 'string'
    || typeof cached.result.refreshToken !== 'string'
  ) {
    throw new EdgeBaseError(500, 'Invalid cached OAuth completion result.', undefined, 'internal-error');
  }
  return cached;
}

function assertCachedBrowserGeneration(
  cached: CachedOAuthCompletionResult,
  requestedTransport: 'body' | 'cookie',
  currentBrowserGeneration: string | null,
): void {
  if (requestedTransport !== 'cookie') return;
  if (
    !currentBrowserGeneration
    || !cached.acceptedBrowserGenerations?.includes(currentBrowserGeneration)
  ) {
    throw new EdgeBaseError(409, 'The browser session changed during OAuth completion.', undefined, 'auth-state-changed');
  }
}

function oauthCompletionResponse(
  c: Context<HonoEnv>,
  cached: CachedOAuthCompletionResult,
): Response {
  if (cached.acceptedBrowserGenerations) {
    const finalGeneration = cached.acceptedBrowserGenerations.at(-1);
    if (!finalGeneration) {
      throw new EdgeBaseError(500, 'Invalid OAuth browser generation.', undefined, 'internal-error');
    }
    setOAuthBrowserGeneration(c, finalGeneration);
    setRefreshCookie(c, cached.result.refreshToken);
    const { refreshToken: _refreshToken, ...safeResult } = cached.result;
    return c.json({ ...safeResult, sessionTransport: 'cookie' }, cached.status);
  }
  return c.json(cached.result, cached.status);
}

export function parseAppleFormDisplayName(raw: string | undefined): string | null {
  if (!raw) return null;
  if (raw.length > 8192) {
    throw new EdgeBaseError(400, 'Apple user payload is too large.', undefined, 'validation-failed');
  }
  try {
    const parsed = JSON.parse(raw) as {
      name?: { firstName?: unknown; lastName?: unknown };
    };
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    const firstName = parsed.name?.firstName;
    const lastName = parsed.name?.lastName;
    if (firstName !== undefined && typeof firstName !== 'string') throw new Error('invalid');
    if (lastName !== undefined && typeof lastName !== 'string') throw new Error('invalid');
    const displayName = [firstName, lastName]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
      .map((part) => part.trim())
      .join(' ');
    if (displayName.length > 200) throw new Error('invalid');
    return displayName || null;
  } catch {
    throw new EdgeBaseError(400, 'Invalid Apple user payload.', undefined, 'validation-failed');
  }
}

/**
 * @hono/zod-openapi only treats an optional JSON body as absent when the
 * Content-Type header is also absent. Some older SDK transports send that
 * header with no body, so normalize that equivalent empty request before the
 * generated validator runs. Non-empty JSON still goes through Zod unchanged.
 */
const normalizeOptionalEmptyJsonBody: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const contentType = c.req.header('content-type');
  if (
    contentType
    && /^application\/(?:[a-z.-]+\+)?json(?:\s*;.*)?$/i.test(contentType)
  ) {
    const rawText = c.req.raw.body === null ? '' : await c.req.raw.clone().text();
    if (rawText.trim() === '' || rawText.trim() === 'null') {
      const headers = new Headers(c.req.raw.headers);
      headers.delete('content-type');
      c.req.raw = new Request(c.req.raw.url, {
        method: c.req.raw.method,
        headers,
      });
    }
  }
  await next();
};

function parseOAuthRecoveryNonce(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !OAUTH_RECOVERY_NONCE_PATTERN.test(value)) {
    throw new EdgeBaseError(
      400,
      'Invalid OAuth recovery nonce.',
      undefined,
      'validation-failed',
    );
  }
  return value;
}

function getClientIP(env: Env, request: Request): string {
  return getTrustedClientIp(env, request) ?? 'unknown';
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
  request: Request,
  completionSessionId?: string,
): Promise<{ accessToken: string; refreshToken: string; sessionId: string }> {
  const userId = user.id as string;
  const userAgent = (request.headers.get('user-agent') ?? 'unknown').slice(0, 512);
  return createSessionAndTokens(
    env,
    userId,
    getTrustedClientIp(env, request) ?? 'unknown',
    userAgent,
    completionSessionId
      ? { sessionId: completionSessionId, reuseExisting: true }
      : undefined,
  );
}

// ─── D1 Schema Middleware ───

oauthRoute.use('*', async (c, next) => {
  assertAuthTransportAllowed(c);
  applyAuthNoStore(c);
  await next();
});

// OAuth is mounted as a separate sub-app, so it must enforce the auth budget
// itself rather than falling through to the permissive global release default.
oauthRoute.use('*', async (c, next) => {
  const providedServiceKey = resolveServiceKeyCandidate(
    c.req,
    c.get('serviceKeyToken') as string | null | undefined,
  );
  if (providedServiceKey) {
    try {
      const { result } = validateKey(
        providedServiceKey,
        'auth:*:*:bypass',
        parseConfig(c.env),
        c.env as never,
        undefined,
        buildConstraintCtx((c.env ?? {}) as { ENVIRONMENT?: string }, c.req),
      );
      if (result === 'valid') {
        await next();
        return;
      }
    } catch {
      // Invalid/malformed keys receive the ordinary per-IP budget.
    }
  }

  const ip = getClientIP(c.env, c.req.raw);
  const config = parseConfig(c.env);
  const { requests, windowSec } = getLimit(config, 'auth');
  const counterKey = `auth:${ip}`;
  if (!counter.check(counterKey, requests, windowSec)) {
    c.header('Retry-After', String(counter.getRetryAfter(counterKey)));
    throw new EdgeBaseError(429, 'Too many requests. Try again later.', undefined, 'rate-limited');
  }
  if (c.env?.AUTH_RATE_LIMITER) {
    const { success } = await c.env.AUTH_RATE_LIMITER.limit({ key: ip });
    if (!success) {
      c.header('Retry-After', '60');
      throw new EdgeBaseError(429, 'Too many requests. Try again later.', undefined, 'rate-limited');
    }
  }
  await next();
});

oauthRoute.use('*', async (c, next) => {
  await ensureAuthSchema(getAuthDb(c));
  await next();
});

// ─── Captcha for OAuth start ───
// captcha_token is passed as query parameter for GET requests
oauthRoute.use('/:provider', async (c, next) => {
  if (c.req.method !== 'GET') {
    await next();
    return;
  }
  return captchaMiddleware('oauth')(c, next);
});

// ─── GET /api/auth/oauth/:provider — Redirect to OAuth provider ───

const oauthRedirect = createRoute({
  operationId: 'oauthRedirect',
  method: 'get',
  path: '/{provider}',
  tags: ['client'],
  summary: 'Start OAuth redirect',
  request: {
    params: z.object({ provider: z.string() }),
    query: oauthRedirectQuerySchema,
  },
  responses: {
    302: { description: 'Redirect to OAuth provider' },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

oauthRoute.openapi(oauthRedirect, async (c) => {
  c.header('Referrer-Policy', 'no-referrer');
  const providerName = c.req.param('provider')!;
  const query = c.req.valid('query') as z.infer<typeof oauthRedirectQuerySchema>;
  const authTransport = query.auth_transport?.trim().toLowerCase();
  if (authTransport && authTransport !== 'cookie') {
    throw new EdgeBaseError(400, `Unsupported auth transport '${authTransport}'.`, undefined, 'invalid-input');
  }
  const cookieTransport = authTransport === 'cookie';
  if (cookieTransport) assertCookieAuthEnabled(c);
  const appRedirectUrl = parseClientRedirectUrl(
    c.env,
    query.redirect_url ?? query.redirectUrl,
    c.req.raw,
  );
  const oauthRecoveryNonce = parseOAuthRecoveryNonce(
    query.oauth_recovery_nonce,
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
    validateOIDCProviderSecurity(
      providerConfig as OIDCProviderConfig,
      configObj.release === true,
    );
    await prefetchOIDCDiscovery((providerConfig as OIDCProviderConfig).issuer);
  }
  const provider = createOAuthProvider(providerName, providerConfig);
  const state = generateState();
  const redirectUri = `${getBaseUrl(c)}/api/auth/oauth/${providerName}/callback`;

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

  const browserGeneration = ensureOAuthBrowserGeneration(c);

  // Store callback authority in the strongly consistent coordinator.
  await putOAuthTransient(
    c.env,
    oauthStateKey(providerName, state),
    JSON.stringify({
      provider: providerName,
      redirectUri,
      codeVerifier: codeVerifier || null,
      appRedirectUrl,
      oauthRecoveryNonce,
      browserGeneration,
      authTransport: cookieTransport ? 'cookie' : 'body',
      ...(captchaPassed ? { captcha_passed: true } : {}),
    }),
    300,
  );

  // Account linking mutates the initiating user before any app callback can
  // validate a client nonce, so bind every transport to this browser.
  setOAuthStateCookie(c, state, { crossSitePost: providerName === 'apple' });

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
  request: {
    params: z.object({ provider: z.string().max(128) }),
    query: oauthCallbackQuerySchema,
  },
  responses: {
    200: { description: 'Authentication result', content: { 'application/json': { schema: jsonResponseSchema } } },
    302: { description: 'Redirect to the client application' },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

const oauthCallbackPost = createRoute({
  operationId: 'oauthCallbackPost',
  method: 'post',
  path: '/{provider}/callback',
  tags: ['client'],
  summary: 'OAuth form-post callback',
  request: {
    params: z.object({ provider: z.string() }),
    body: {
      required: true,
      content: { 'application/x-www-form-urlencoded': { schema: oauthCallbackFormSchema } },
    },
  },
  responses: {
    200: { description: 'Authentication result', content: { 'application/json': { schema: jsonResponseSchema } } },
    302: { description: 'Redirect to the client application' },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

const oauthExchange = createRoute({
  operationId: 'oauthExchange',
  method: 'post',
  path: '/exchange',
  tags: ['client'],
  summary: 'Atomically exchange a verified OAuth callback ticket',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: oauthCompletionBodySchema } },
    },
  },
  responses: {
    200: { description: 'Authentication result', content: { 'application/json': { schema: jsonResponseSchema } } },
    201: { description: 'Created authentication result', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Invalid or expired completion ticket', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

oauthRoute.openapi(oauthExchange, async (c) => {
  const body = c.req.valid('json') as z.infer<typeof oauthCompletionBodySchema>;
  const requestedTransport = isCookieAuthTransport(c) ? 'cookie' : 'body';
  const currentBrowserGeneration = requestedTransport === 'cookie'
    ? readOAuthBrowserGeneration(c)
    : null;
  if (requestedTransport === 'cookie' && !currentBrowserGeneration) {
    throw new EdgeBaseError(409, 'The browser session changed during OAuth completion.', undefined, 'auth-state-changed');
  }
  const storageKey = await completionStorageKey('oauth:exchange', [
    body.ticket,
    body.oauthRecoveryNonce,
    requestedTransport,
    null,
  ]);
  const claim = await claimCompletionWithWait(c.env, storageKey);
  if (claim.status === 'missing') {
    throw new EdgeBaseError(400, 'Invalid or expired OAuth completion ticket.', undefined, 'invalid-token');
  }
  if (claim.status === 'completed') {
    const cached = parseCachedCompletion(claim.value, 'signin');
    assertCachedBrowserGeneration(cached, requestedTransport, currentBrowserGeneration);
    return oauthCompletionResponse(c, cached);
  }

  const heartbeat = startCompletionLeaseHeartbeat(c.env, storageKey, claim.claimId);
  try {
    let completion: OAuthSignInCompletion;
    try {
      completion = JSON.parse(claim.value) as OAuthSignInCompletion;
    } catch {
      throw new EdgeBaseError(400, 'Invalid OAuth completion ticket.', undefined, 'invalid-token');
    }
    if (completion.kind !== 'signin' || !isSupportedProvider(completion.provider)) {
      throw new EdgeBaseError(400, 'Invalid OAuth completion ticket.', undefined, 'invalid-token');
    }
    assertCompletionBinding(c, completion, body.oauthRecoveryNonce);
    if (
      completion.authTransport === 'cookie'
      && (!completion.browserGeneration
        || !verifyOAuthBrowserGeneration(c, completion.browserGeneration))
    ) {
      throw new EdgeBaseError(409, 'The browser session changed during OAuth completion.', undefined, 'auth-state-changed');
    }
    const newUserId = completion.newUserId ?? generateId();
    if (!completion.newUserId) {
      completion.newUserId = newUserId;
      await checkpointOAuthCompletion(c.env, storageKey, claim.claimId, JSON.stringify(completion));
    }
    const lifecycleHooks = createOAuthLifecycleHooks(
      c,
      completion,
      () => checkpointOAuthCompletion(c.env, storageKey, claim.claimId, JSON.stringify(completion)),
    );
    const result = await processOAuthCallback(
      c.env,
      completion.provider,
      normalizeOAuthUserInfo(completion.userInfo),
      c.req.raw,
      completionSessionId(storageKey),
      newUserId,
      lifecycleHooks,
    );
    const status = result.created ? 201 : 200;
    const finalBrowserGeneration = completion.authTransport === 'cookie' ? generateState() : undefined;
    const cached: CachedOAuthCompletionResult = {
      version: 1,
      kind: 'signin',
      result,
      status,
      ...(completion.browserGeneration && finalBrowserGeneration
        ? { acceptedBrowserGenerations: [completion.browserGeneration, finalBrowserGeneration] }
        : {}),
    };
    await heartbeat.assertAndRenew();
    await completeOAuthCompletion(
      c.env,
      storageKey,
      claim.claimId,
      JSON.stringify(cached),
      OAUTH_COMPLETION_TTL_SECONDS,
    );
    scheduleOAuthAfterLifecycleHook(
      c,
      result.created ? 'signUp' : 'signIn',
      result.user,
      completion.provider,
    );
    return oauthCompletionResponse(c, cached);
  } catch (error) {
    await heartbeat.stop();
    await releaseOAuthCompletion(c.env, storageKey, claim.claimId).catch(() => undefined);
    throw error;
  } finally {
    await heartbeat.stop();
  }
});

async function handleOAuthCallback(c: Context<HonoEnv>, input: OAuthCallbackInput) {
  c.header('Referrer-Policy', 'no-referrer');
  const providerName = c.req.param('provider')!;
  validateOAuthCallbackInput(input);
  if (!isSupportedProvider(providerName)) {
    throw new EdgeBaseError(400, `Unsupported OAuth provider: ${providerName}`, undefined, 'validation-failed');
  }
  const { code, state, error } = input;
  const stateCookieOptions = { crossSitePost: providerName === 'apple' };

  if (error) {
    if (state) {
      if (!verifyOAuthStateCookie(c, state)) {
        throw new EdgeBaseError(400, 'OAuth state is not bound to this browser.', undefined, 'invalid-token');
      }
      const stateData = await consumeOAuthTransient(c.env, oauthStateKey(providerName, state));
      if (stateData) {
        clearOAuthStateCookie(c, state, stateCookieOptions);
        // A provider error is terminal for the exact state regardless of
        // provider/redirect validity. Consume before parsing or branching so a
        // malformed, mismatched, or JSON-only flow can never be replayed.
        const stored = JSON.parse(stateData) as {
          provider: string;
          appRedirectUrl?: string | null;
          oauthRecoveryNonce?: string | null;
          authTransport?: 'body' | 'cookie';
        };
        if (stored.provider === providerName && stored.appRedirectUrl) {
          return c.redirect(appendRedirectParams(stored.appRedirectUrl, {
            error,
            error_description: input.errorDescription || error,
            oauth_recovery_nonce: stored.oauthRecoveryNonce,
          }));
        }
      }
    }
    throw new EdgeBaseError(400, `OAuth error: ${input.errorDescription || error}`, undefined, 'validation-failed');
  }
  if (!code || !state) {
    throw new EdgeBaseError(400, 'Missing code or state parameter.', undefined, 'validation-failed');
  }

  // Require proof that the callback belongs to this browser before disclosing
  // provider configuration state. This check does not consume the one-shot
  // state, so a third party cannot burn the legitimate browser's flow.
  if (!verifyOAuthStateCookie(c, state)) {
    throw new EdgeBaseError(400, 'OAuth state is not bound to this browser.', undefined, 'invalid-token');
  }

  // Configuration validation is independent of the one-shot state. Perform
  // it before consuming state so a broken release OIDC issuer cannot burn the
  // legitimate browser's flow merely by reaching the callback endpoint.
  const configObj = getOAuthRuntimeConfig(c.env);
  const providerConfig = getOAuthProviderConfig(configObj, providerName);
  if (!providerConfig) {
    throw new EdgeBaseError(500, `OAuth provider ${providerName} is not configured.`, undefined, 'internal-error');
  }
  if (providerName.startsWith('oidc:')) {
    validateOIDCProviderSecurity(
      providerConfig as OIDCProviderConfig,
      configObj.release === true,
    );
  }

  // Browser proof precedes the strongly consistent one-shot consume.
  const stateData = await consumeOAuthTransient(c.env, oauthStateKey(providerName, state));
  if (!stateData) {
    throw new EdgeBaseError(400, 'Invalid or expired OAuth state.', undefined, 'invalid-token');
  }
  clearOAuthStateCookie(c, state, stateCookieOptions);

  const {
    provider: storedProvider,
    redirectUri,
    codeVerifier,
    captcha_passed,
    appRedirectUrl,
    oauthRecoveryNonce,
    authTransport,
    browserGeneration,
  } = JSON.parse(stateData) as {
    provider: string;
    redirectUri: string;
    codeVerifier: string | null;
    captcha_passed?: boolean;
    appRedirectUrl?: string | null;
    oauthRecoveryNonce?: string | null;
    authTransport?: 'body' | 'cookie';
    browserGeneration?: string;
  };
  if (storedProvider !== providerName) {
    throw new EdgeBaseError(400, 'OAuth state provider mismatch.', undefined, 'validation-failed');
  }
  if (!browserGeneration || !verifyOAuthBrowserGeneration(c, browserGeneration)) {
    throw new EdgeBaseError(400, 'OAuth flow was superseded by browser sign-out.', undefined, 'invalid-token');
  }
  await ensureAuthActionAllowed(c, 'oauthCallback', { provider: providerName, state });
  // Verify captcha was passed during OAuth initiation. A valid Service Key
  // bypasses captcha, but mere presence of the header must not — validate it.
  if (getOAuthRuntimeConfig(c.env).captcha && !captcha_passed) {
    let bypass = false;
    const provided = resolveServiceKeyCandidate(c.req, c.get('serviceKeyToken') as string | null | undefined);
    if (provided) {
      try {
        const { result } = validateKey(
          provided,
          'auth:*:*:bypass',
          parseConfig(c.env),
          c.env as never,
          undefined,
          buildConstraintCtx((c.env ?? {}) as { ENVIRONMENT?: string }, c.req),
        );
        bypass = result === 'valid';
      } catch {
        bypass = false;
      }
    }
    if (!bypass) {
      throw new EdgeBaseError(403, 'Captcha verification required for OAuth.', undefined, 'forbidden');
    }
  }

  const provider = createOAuthProvider(providerName, providerConfig);

  // Exchange code for tokens
  const tokens = normalizeOAuthTokens(
    await provider.exchangeCode(code, redirectUri, codeVerifier || undefined),
    providerName,
  );

  // Get user info
  let userInfo: OAuthUserInfo;
  if (providerName === 'apple' && tokens.idToken) {
    userInfo = await verifyAppleIdToken(tokens.idToken, providerConfig.clientId, state);
    const displayName = parseAppleFormDisplayName(input.appleUser);
    if (displayName) userInfo = { ...userInfo, displayName };
  } else if (providerName.startsWith('oidc:')) {
    if (!tokens.idToken) throw new EdgeBaseError(400, 'OIDC token response is missing id_token.');
    const verifiedClaims = await verifyOIDCIdToken(
      tokens.idToken,
      providerConfig as OIDCProviderConfig,
      state,
    );
    userInfo = await provider.getUserInfo(tokens.accessToken);
    try {
      assertOIDCUserInfoSubject(verifiedClaims, userInfo);
    } catch {
      throw new EdgeBaseError(400, 'OIDC id_token and userinfo subject mismatch.', undefined, 'invalid-token');
    }
  } else {
    // Generic OIDC deliberately uses the provider's authenticated userinfo
    // endpoint. Decoding an id_token without JWKS/issuer/audience verification
    // must never drive email auto-linking.
    userInfo = await provider.getUserInfo(tokens.accessToken);
  }
  userInfo = normalizeOAuthUserInfo(userInfo);

  if (appRedirectUrl) {
    // App callbacks receive no bearer credentials and create no server session.
    // The SDK first validates/scrubs its local nonce+epoch, then atomically
    // exchanges this short-lived one-time ticket.
    const ticket = generateState();
    const completionTransport = authTransport === 'cookie' ? 'cookie' : 'body';
    const storageKey = await completionStorageKey('oauth:exchange', [
      ticket,
      oauthRecoveryNonce,
      completionTransport,
      null,
    ]);
    await putOAuthTransient(c.env, storageKey, JSON.stringify({
      kind: 'signin',
      provider: providerName,
      userInfo: ticketUserInfo(userInfo),
      newUserId: generateId(),
      oauthRecoveryNonce: oauthRecoveryNonce ?? null,
      authTransport: completionTransport,
      browserGeneration,
    } satisfies OAuthSignInCompletion), OAUTH_COMPLETION_TTL_SECONDS);
    return c.redirect(appendRedirectParams(appRedirectUrl, {
      oauth_exchange_ticket: ticket,
      auth_transport: authTransport === 'cookie' ? 'cookie' : 'body',
      oauth_recovery_nonce: oauthRecoveryNonce,
    }));
  }
  // Direct server-terminated OAuth (no app redirect) can issue immediately.
  const newUserId = generateId();
  const result = await processOAuthCallback(
    c.env,
    providerName,
    userInfo,
    c.req.raw,
    undefined,
    newUserId,
    createOAuthLifecycleHooks(c, undefined, undefined, providerName),
  );
  scheduleOAuthAfterLifecycleHook(c, result.created ? 'signUp' : 'signIn', result.user, providerName);
  return authTransport === 'cookie'
    ? cookieSessionResponse(c, result, result.created ? 201 : 200)
    : c.json(result, result.created ? 201 : 200);
}

oauthRoute.openapi(oauthCallback, (c) => {
  const query = c.req.valid('query') as z.infer<typeof oauthCallbackQuerySchema>;
  return handleOAuthCallback(c, {
    code: query.code,
    state: query.state,
    error: query.error,
    errorDescription: query.error_description,
  });
});

oauthRoute.openapi(oauthCallbackPost, (c) => {
  const form = c.req.valid('form') as z.infer<typeof oauthCallbackFormSchema>;
  return handleOAuthCallback(c, {
    code: form.code,
    state: form.state,
    error: form.error,
    errorDescription: form.error_description,
    appleUser: form.user,
  });
});

// ─── POST /api/auth/oauth/link/:provider — Start anonymous→OAuth linking ───

const oauthLinkStart = createRoute({
  operationId: 'oauthLinkStart',
  method: 'post',
  path: '/link/{provider}',
  tags: ['client'],
  summary: 'Start OAuth account linking',
  middleware: normalizeOptionalEmptyJsonBody,
  request: {
    params: z.object({ provider: z.string() }),
    body: {
      required: false,
      content: { 'application/json': { schema: oauthLinkStartBodySchema } },
    },
  },
  responses: {
    200: { description: 'Redirect URL', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

oauthRoute.openapi(oauthLinkStart, async (c) => {
  const providerName = c.req.param('provider')!;
  const cookieTransport = isCookieAuthTransport(c);
  const body = (c.req.valid('json') ?? null) as z.infer<typeof oauthLinkStartBodySchema> | null;
  const redirect = parseClientRedirectInput(c.env, body, c.req.raw);
  const appRedirectUrl = redirect.redirectUrl;
  const oauthRecoveryNonce = parseOAuthRecoveryNonce(body?.oauthRecoveryNonce);

  if (!isSupportedProvider(providerName)) {
    throw new EdgeBaseError(400, `Unsupported OAuth provider: ${providerName}`, undefined, 'validation-failed');
  }

  // Verify JWT — user must be authenticated.
  const auth = c.get('auth') as { id: string; sessionId?: string; isAnonymous: boolean } | null;
  if (!auth) {
    throw new EdgeBaseError(401, 'Authentication required.', undefined, 'unauthenticated');
  }
  if (!auth.sessionId) {
    throw new EdgeBaseError(401, 'A session-bound access token is required for OAuth linking.', undefined, 'unauthenticated');
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
  if (providerName.startsWith('oidc:')) {
    validateOIDCProviderSecurity(
      providerConfig2 as OIDCProviderConfig,
      configObj2.release === true,
    );
    await prefetchOIDCDiscovery((providerConfig2 as OIDCProviderConfig).issuer);
  }
  const redirectUri = `${getBaseUrl(c)}/api/auth/oauth/link/${providerName}/callback`;
  const linkMode = auth.isAnonymous ? 'anonymous-upgrade' : 'attach-oauth';
  const linkBrowserGeneration = cookieTransport ? ensureOAuthBrowserGeneration(c) : undefined;

  // PKCE for providers that require or strongly prefer it.
  let codeChallenge: string | undefined;
  let codeVerifier: string | undefined;
  if (providerName === 'google' || providerName === 'x' || providerName.startsWith('oidc:')) {
    const pkce = await generatePKCE();
    codeChallenge = pkce.codeChallenge;
    codeVerifier = pkce.codeVerifier;
  }

  await putOAuthTransient(
    c.env,
    oauthLinkStateKey(providerName, state),
    JSON.stringify({
      provider: providerName,
      redirectUri,
      codeVerifier: codeVerifier || null,
      appRedirectUrl,
      oauthRecoveryNonce,
      linkUserId: userId,
      linkSessionId: auth.sessionId,
      linkMode,
      appState: redirect.state,
      authTransport: cookieTransport ? 'cookie' : 'body',
      browserGeneration: linkBrowserGeneration,
    }),
    300,
  );

  const authUrl = provider.getAuthorizationUrl(state, redirectUri, codeChallenge);
  const continueTicket = generateState();
  await putOAuthTransient(
    c.env,
    `oauth:link-continue:${continueTicket}`,
    JSON.stringify({ provider: providerName, state, authUrl }),
    60,
  );
  const continueUrl = new URL(
    `/api/auth/oauth/link/${encodeURIComponent(providerName)}/continue`,
    getBaseUrl(c),
  );
  continueUrl.searchParams.set('ticket', continueTicket);
  applyAuthNoStore(c);
  c.header('Referrer-Policy', 'no-referrer');
  return c.json({ redirectUrl: continueUrl.toString() });
});

const oauthLinkContinue = createRoute({
  operationId: 'oauthLinkContinue',
  method: 'get',
  path: '/link/{provider}/continue',
  tags: ['client'],
  summary: 'Continue OAuth account linking in the system browser',
  request: {
    params: z.object({ provider: z.string() }),
    query: z.object({ ticket: z.string().regex(OAUTH_RECOVERY_NONCE_PATTERN) }),
  },
  responses: {
    302: { description: 'Redirect to the OAuth provider' },
    400: { description: 'Invalid or expired continuation', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

oauthRoute.openapi(oauthLinkContinue, async (c) => {
  const providerName = c.req.param('provider')!;
  const ticket = c.req.query('ticket');
  if (!ticket || !OAUTH_RECOVERY_NONCE_PATTERN.test(ticket)) {
    throw new EdgeBaseError(400, 'Invalid OAuth link continuation.', undefined, 'invalid-token');
  }
  const key = `oauth:link-continue:${ticket}`;
  const raw = await consumeOAuthTransient(c.env, key);
  if (!raw) {
    throw new EdgeBaseError(400, 'Invalid or expired OAuth link continuation.', undefined, 'invalid-token');
  }
  // Consume before parsing/branching so a malformed ticket can never replay.
  const continuation = JSON.parse(raw) as { provider?: unknown; state?: unknown; authUrl?: unknown };
  if (
    continuation.provider !== providerName
    || typeof continuation.state !== 'string'
    || typeof continuation.authUrl !== 'string'
  ) {
    throw new EdgeBaseError(400, 'Invalid OAuth link continuation.', undefined, 'invalid-token');
  }
  setOAuthStateCookie(c, continuation.state, { crossSitePost: providerName === 'apple' });
  applyAuthNoStore(c);
  c.header('Referrer-Policy', 'no-referrer');
  return c.redirect(continuation.authUrl);
});

// ─── GET /api/auth/oauth/link/:provider/callback — Handle link OAuth callback ───

const oauthLinkCallback = createRoute({
  operationId: 'oauthLinkCallback',
  method: 'get',
  path: '/link/{provider}/callback',
  tags: ['client'],
  summary: 'OAuth link callback',
  request: {
    params: z.object({ provider: z.string().max(128) }),
    query: oauthCallbackQuerySchema,
  },
  responses: {
    200: { description: 'Link result', content: { 'application/json': { schema: jsonResponseSchema } } },
    302: { description: 'Redirect after linking' },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

const oauthLinkCallbackPost = createRoute({
  operationId: 'oauthLinkCallbackPost',
  method: 'post',
  path: '/link/{provider}/callback',
  tags: ['client'],
  summary: 'OAuth link form-post callback',
  request: {
    params: z.object({ provider: z.string() }),
    body: {
      required: true,
      content: { 'application/x-www-form-urlencoded': { schema: oauthCallbackFormSchema } },
    },
  },
  responses: {
    200: { description: 'Link result', content: { 'application/json': { schema: jsonResponseSchema } } },
    302: { description: 'Redirect after linking' },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

const oauthLinkComplete = createRoute({
  operationId: 'oauthLinkComplete',
  method: 'post',
  path: '/complete/link',
  tags: ['client'],
  summary: 'Complete OAuth account linking for the current authenticated user',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: oauthCompletionBodySchema } },
    },
  },
  responses: {
    200: { description: 'Link result', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Invalid or expired completion ticket', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: errorResponseSchema } } },
    409: { description: 'Initiating account changed', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

oauthRoute.openapi(oauthLinkComplete, async (c) => {
  const auth = c.get('auth') as { id: string; sessionId?: string; isAnonymous?: boolean } | null;
  if (!auth) {
    // Do not consume while signed out: no unauthenticated request can burn a
    // legitimate authenticated completion ticket.
    throw new EdgeBaseError(401, 'Authentication required.', undefined, 'unauthenticated');
  }
  if (!auth.sessionId) {
    throw new EdgeBaseError(401, 'A session-bound access token is required for OAuth linking.', undefined, 'unauthenticated');
  }
  const body = c.req.valid('json') as z.infer<typeof oauthCompletionBodySchema>;
  const requestedTransport = isCookieAuthTransport(c) ? 'cookie' : 'body';
  const currentBrowserGeneration = requestedTransport === 'cookie'
    ? readOAuthBrowserGeneration(c)
    : null;
  if (requestedTransport === 'cookie' && !currentBrowserGeneration) {
    throw new EdgeBaseError(409, 'The browser session changed during OAuth linking.', undefined, 'auth-state-changed');
  }
  const storageKey = await completionStorageKey('oauth:link-complete', [
    body.ticket,
    body.oauthRecoveryNonce,
    requestedTransport,
    auth.id,
    null,
  ]);
  const claim = await claimCompletionWithWait(c.env, storageKey);
  if (claim.status === 'missing') {
    throw new EdgeBaseError(400, 'Invalid or expired OAuth link completion ticket.', undefined, 'invalid-token');
  }
  if (claim.status === 'completed') {
    const cached = parseCachedCompletion(claim.value, 'link');
    assertCachedBrowserGeneration(cached, requestedTransport, currentBrowserGeneration);
    if (!auth.sessionId || !cached.acceptedLinkSessionIds?.includes(auth.sessionId)) {
      throw new EdgeBaseError(
        409,
        'The authenticated session changed during OAuth linking.',
        undefined,
        'auth-state-changed',
      );
    }
    return oauthCompletionResponse(c, cached);
  }

  const heartbeat = startCompletionLeaseHeartbeat(c.env, storageKey, claim.claimId);
  try {
    let completion: OAuthLinkCompletion;
    try {
      completion = JSON.parse(claim.value) as OAuthLinkCompletion;
    } catch {
      throw new EdgeBaseError(400, 'Invalid OAuth link completion ticket.', undefined, 'invalid-token');
    }
    if (completion.kind !== 'link' || !isSupportedProvider(completion.provider)) {
      throw new EdgeBaseError(400, 'Invalid OAuth link completion ticket.', undefined, 'invalid-token');
    }
    assertCompletionBinding(c, completion, body.oauthRecoveryNonce);
    if (
      completion.authTransport === 'cookie'
      && (!completion.browserGeneration
        || !verifyOAuthBrowserGeneration(c, completion.browserGeneration))
    ) {
      throw new EdgeBaseError(409, 'The browser session changed during OAuth linking.', undefined, 'auth-state-changed');
    }
    if (auth.id !== completion.linkUserId || !auth.sessionId || auth.sessionId !== completion.linkSessionId) {
      throw new EdgeBaseError(
        409,
        'The authenticated account changed during OAuth linking.',
        undefined,
        'auth-state-changed',
      );
    }
    const userInfo = normalizeOAuthUserInfo(completion.userInfo);
    const authDb = getAuthDb(c);
    const currentUser = await authService.getUserById(authDb, auth.id);
    const expectedAnonymous = completion.linkMode === 'anonymous-upgrade';
    const currentAnonymous = currentUser ? Boolean(Number(currentUser.isAnonymous)) : null;
    const linkedOwner = await lookupOAuth(
      authDb,
      completion.provider,
      userInfo.providerUserId,
    );
    const sameOwnerAlreadyFinalized = linkedOwner?.userId === completion.linkUserId;
    const recoverableFinalizedMutation = sameOwnerAlreadyFinalized
      && completion.identityMutationStarted === true;
    const completedAnonymousUpgrade = expectedAnonymous
      && currentUser
      && currentAnonymous === false
      && recoverableFinalizedMutation;
    if (
      !currentUser
      || Number(currentUser.disabled) === 1
      || (currentAnonymous !== expectedAnonymous && !completedAnonymousUpgrade)
    ) {
      throw new EdgeBaseError(
        409,
        'The initiating account state changed during OAuth linking.',
        undefined,
        'auth-state-changed',
      );
    }
    const initiatingSession = await authDb.first<Record<string, unknown>>(
      'SELECT userId, expiresAt FROM _sessions WHERE id = ?',
      [completion.linkSessionId],
    );
    const initiatingSessionValid = initiatingSession?.userId === completion.linkUserId
      && new Date(String(initiatingSession.expiresAt ?? '')).getTime() > Date.now();
    if (!initiatingSessionValid && !recoverableFinalizedMutation) {
      throw new EdgeBaseError(
        409,
        'The initiating session was revoked during OAuth linking.',
        undefined,
        'auth-state-changed',
      );
    }
    if (!sameOwnerAlreadyFinalized && !completion.identityMutationStarted) {
      completion.identityMutationStarted = true;
      await checkpointOAuthCompletion(c.env, storageKey, claim.claimId, JSON.stringify(completion));
    }
    await ensureAuthActionAllowed(c, 'oauthLinkCallback', {
      provider: completion.provider,
      linkUserId: completion.linkUserId,
    });
    const deterministicSessionId = completionSessionId(storageKey);
    const result = completion.linkMode === 'attach-oauth'
      ? await processAttachOAuthCallback(
          c.env,
          completion.provider,
          userInfo,
          completion.linkUserId,
          c.req.raw,
          deterministicSessionId,
        )
      : await processLinkOAuthCallback(
          c.env,
          completion.provider,
          userInfo,
          completion.linkUserId,
          c.req.raw,
          deterministicSessionId,
        );
    const finalBrowserGeneration = completion.authTransport === 'cookie' ? generateState() : undefined;
    const cached: CachedOAuthCompletionResult = {
      version: 1,
      kind: 'link',
      result,
      status: 200,
      acceptedLinkSessionIds: [completion.linkSessionId, result.sessionId],
      ...(completion.browserGeneration && finalBrowserGeneration
        ? { acceptedBrowserGenerations: [completion.browserGeneration, finalBrowserGeneration] }
        : {}),
    };
    await heartbeat.assertAndRenew();
    await completeOAuthCompletion(
      c.env,
      storageKey,
      claim.claimId,
      JSON.stringify(cached),
      OAUTH_COMPLETION_TTL_SECONDS,
    );
    return oauthCompletionResponse(c, cached);
  } catch (error) {
    await heartbeat.stop();
    await releaseOAuthCompletion(c.env, storageKey, claim.claimId).catch(() => undefined);
    throw error;
  } finally {
    await heartbeat.stop();
  }
});

async function handleOAuthLinkCallback(c: Context<HonoEnv>, input: OAuthCallbackInput) {
  c.header('Referrer-Policy', 'no-referrer');
  const providerName = c.req.param('provider')!;
  validateOAuthCallbackInput(input);
  if (!isSupportedProvider(providerName)) {
    throw new EdgeBaseError(400, `Unsupported OAuth provider: ${providerName}`, undefined, 'validation-failed');
  }
  const { code, state, error } = input;
  const stateCookieOptions = { crossSitePost: providerName === 'apple' };

  if (error) {
    if (state) {
      if (!verifyOAuthStateCookie(c, state)) {
        throw new EdgeBaseError(400, 'OAuth state is not bound to this browser.', undefined, 'invalid-token');
      }
      const stateData = await consumeOAuthTransient(c.env, oauthLinkStateKey(providerName, state));
      if (stateData) {
        clearOAuthStateCookie(c, state, stateCookieOptions);
        // Link-state errors obey the same one-shot rule as sign-in state.
        const stored = JSON.parse(stateData) as {
          provider: string;
          appState?: string | null;
          appRedirectUrl?: string | null;
          oauthRecoveryNonce?: string | null;
          authTransport?: 'body' | 'cookie';
        };
        if (stored.provider === providerName && stored.appRedirectUrl) {
          return c.redirect(appendRedirectParams(stored.appRedirectUrl, {
            error,
            error_description: input.errorDescription || error,
            state: stored.appState ?? undefined,
            oauth_recovery_nonce: stored.oauthRecoveryNonce,
          }));
        }
      }
    }
    throw new EdgeBaseError(400, `OAuth error: ${input.errorDescription || error}`, undefined, 'validation-failed');
  }
  if (!code || !state) {
    throw new EdgeBaseError(400, 'Missing code or state parameter.', undefined, 'validation-failed');
  }
  if (!verifyOAuthStateCookie(c, state)) {
    throw new EdgeBaseError(400, 'OAuth state is not bound to this browser.', undefined, 'invalid-token');
  }

  const stateData = await consumeOAuthTransient(c.env, oauthLinkStateKey(providerName, state));
  if (!stateData) {
    throw new EdgeBaseError(400, 'Invalid or expired OAuth link state.', undefined, 'invalid-token');
  }
  clearOAuthStateCookie(c, state, stateCookieOptions);

  const {
    provider: storedProvider,
    redirectUri,
    codeVerifier,
    linkUserId,
    linkSessionId,
    appRedirectUrl,
    oauthRecoveryNonce,
    linkMode,
    appState,
    authTransport,
    browserGeneration,
  } = JSON.parse(stateData) as {
    provider: string;
    redirectUri: string;
    codeVerifier: string | null;
    linkUserId: string;
    linkSessionId: string;
    linkMode?: 'anonymous-upgrade' | 'attach-oauth';
    appState?: string | null;
    appRedirectUrl?: string | null;
    oauthRecoveryNonce?: string | null;
    authTransport?: 'body' | 'cookie';
    browserGeneration?: string;
  };
  if (storedProvider !== providerName) {
    throw new EdgeBaseError(400, 'OAuth state provider mismatch.', undefined, 'validation-failed');
  }
  if (
    authTransport === 'cookie'
    && (!browserGeneration || !verifyOAuthBrowserGeneration(c, browserGeneration))
  ) {
    throw new EdgeBaseError(409, 'The browser session changed during OAuth linking.', undefined, 'auth-state-changed');
  }
  await ensureAuthActionAllowed(c, 'oauthLinkCallback', {
    provider: providerName,
    state,
    linkUserId,
    linkSessionId,
  });
  const configObj = getOAuthRuntimeConfig(c.env);
  const providerConfig = getOAuthProviderConfig(configObj, providerName);
  if (!providerConfig) {
    throw new EdgeBaseError(500, `OAuth provider ${providerName} is not configured.`, undefined, 'internal-error');
  }
  if (providerName.startsWith('oidc:')) {
    validateOIDCProviderSecurity(
      providerConfig as OIDCProviderConfig,
      configObj.release === true,
    );
  }

  const provider = createOAuthProvider(providerName, providerConfig);

  // Exchange code for tokens
  const tokens = normalizeOAuthTokens(
    await provider.exchangeCode(code, redirectUri, codeVerifier || undefined),
    providerName,
  );

  // Get user info
  let userInfo: OAuthUserInfo;
  if (providerName === 'apple' && tokens.idToken) {
    userInfo = await verifyAppleIdToken(tokens.idToken, providerConfig.clientId, state);
    const displayName = parseAppleFormDisplayName(input.appleUser);
    if (displayName) userInfo = { ...userInfo, displayName };
  } else if (providerName.startsWith('oidc:')) {
    if (!tokens.idToken) throw new EdgeBaseError(400, 'OIDC token response is missing id_token.');
    const verifiedClaims = await verifyOIDCIdToken(
      tokens.idToken,
      providerConfig as OIDCProviderConfig,
      state,
    );
    userInfo = await provider.getUserInfo(tokens.accessToken);
    try {
      assertOIDCUserInfoSubject(verifiedClaims, userInfo);
    } catch {
      throw new EdgeBaseError(400, 'OIDC id_token and userinfo subject mismatch.', undefined, 'invalid-token');
    }
  } else {
    userInfo = await provider.getUserInfo(tokens.accessToken);
  }

  userInfo = normalizeOAuthUserInfo(userInfo);

  const completionTicket = generateState();
  const completionTransport = authTransport === 'cookie' ? 'cookie' : 'body';
  const storageKey = await completionStorageKey('oauth:link-complete', [
    completionTicket,
    oauthRecoveryNonce,
    completionTransport,
    linkUserId,
    null,
  ]);
  await putOAuthTransient(c.env, storageKey, JSON.stringify({
    kind: 'link',
    provider: providerName,
    userInfo: ticketUserInfo(userInfo),
    linkUserId,
    linkSessionId,
    linkMode: linkMode === 'attach-oauth' ? 'attach-oauth' : 'anonymous-upgrade',
    oauthRecoveryNonce: oauthRecoveryNonce ?? null,
    authTransport: completionTransport,
    browserGeneration,
  } satisfies OAuthLinkCompletion), OAUTH_COMPLETION_TTL_SECONDS);
  if (appRedirectUrl) {
    return c.redirect(appendRedirectParams(appRedirectUrl, {
      oauth_link_ticket: completionTicket,
      auth_transport: authTransport === 'cookie' ? 'cookie' : 'body',
      state: appState ?? undefined,
      oauth_recovery_nonce: oauthRecoveryNonce,
    }));
  }
  return c.json({
    completionTicket,
    oauthRecoveryNonce: oauthRecoveryNonce ?? undefined,
    state: appState ?? undefined,
  });
}

oauthRoute.openapi(oauthLinkCallback, (c) => {
  const query = c.req.valid('query') as z.infer<typeof oauthCallbackQuerySchema>;
  return handleOAuthLinkCallback(c, {
    code: query.code,
    state: query.state,
    error: query.error,
    errorDescription: query.error_description,
  });
});

oauthRoute.openapi(oauthLinkCallbackPost, (c) => {
  const form = c.req.valid('form') as z.infer<typeof oauthCallbackFormSchema>;
  return handleOAuthLinkCallback(c, {
    code: form.code,
    state: form.state,
    error: form.error,
    errorDescription: form.error_description,
    appleUser: form.user,
  });
});

// ─── Core OAuth callback processing (D1-based,) ───

interface OAuthResult {
  user: Record<string, unknown>;
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  created: boolean;
}

async function syncOAuthPublicProjection(
  db: AuthDb,
  user: Record<string, unknown>,
): Promise<void> {
  await upsertUserPublic(
    db,
    String(user.id),
    authService.buildPublicUserData(user) as unknown as UserPublicData,
  );
}

function isOAuthReservationUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message === 'OAUTH_ALREADY_LINKED' || message === 'OAUTH_RESERVATION_CONFLICT';
}

async function processOAuthCallback(
  env: Env,
  providerName: SupportedProvider,
  userInfo: OAuthUserInfo,
  request: Request,
  completionSessionId?: string,
  newUserId?: string,
  lifecycleHooks?: OAuthLifecycleHooks,
): Promise<OAuthResult> {
  const db = getAuthDbFromEnv(env);
  // Step 1: Check _oauth_index in D1 for existing OAuth account
  const oauthRecord = await lookupOAuth(db, providerName, userInfo.providerUserId);

  // Case A: Existing OAuth account → just sign in
  if (oauthRecord) {
    const { userId } = oauthRecord;
    const user = await authService.getUserById(db, userId);
    if (!user) throw new EdgeBaseError(500, 'User not found for OAuth account.', undefined, 'internal-error');
    if (Number(user.disabled) === 1) {
      throw new EdgeBaseError(403, 'This account has been disabled.', undefined, 'account-disabled');
    }
    await lifecycleHooks?.beforeSignIn(user);
    await syncOAuthPublicProjection(db, user);
    const { accessToken, refreshToken, sessionId } = await createOAuthSessionAndTokens(
      env,
      user,
      request,
      completionSessionId,
    );
    return { user: authService.sanitizeUser(user), accessToken, refreshToken, sessionId, created: false };
  }

  // Step 2: Check _email_index in D1 for auto-linking
  if (userInfo.email) {
    const emailRecord = await lookupEmail(db, userInfo.email);

    if (emailRecord) {
      // Auto-link: email_verified check
      if (userInfo.emailVerified) {
        return autoLinkOAuth(
          env,
          providerName,
          userInfo,
          emailRecord,
          request,
          completionSessionId,
          lifecycleHooks,
        );
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
            const emailReservationId = await registerEmailPending(db, userInfo.email, existingUserId);
            await confirmEmail(db, userInfo.email, existingUserId, emailReservationId);
          } catch (err) {
            if ((err as Error).message !== 'EMAIL_ALREADY_REGISTERED') {
              throw err;
            }
          }
          return autoLinkOAuth(
            env,
            providerName,
            userInfo,
            { userId: existingUserId, shardId: 0 },
            request,
            completionSessionId,
            lifecycleHooks,
          );
        }
        userInfo = { ...userInfo, email: null };
      }
    }
  }

  // Step 3: Create new user via OAuth
  return createOAuthUser(
    env,
    providerName,
    userInfo,
    request,
    completionSessionId,
    newUserId,
    lifecycleHooks,
  );
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
  request: Request,
  completionSessionId?: string,
): Promise<OAuthResult> {
  const db = getAuthDbFromEnv(env);
  const currentUser = await authService.getUserById(db, linkUserId);
  if (!currentUser) throw new EdgeBaseError(404, 'User not found.', undefined, 'user-not-found');
  if (Number(currentUser.disabled) === 1) {
    throw new EdgeBaseError(403, 'This account has been disabled.', undefined, 'account-disabled');
  }
  const oauthRecord = await lookupOAuth(db, providerName, userInfo.providerUserId);
  if (oauthRecord) {
    if (
      completionSessionId
      && oauthRecord.userId === linkUserId
      && !Number(currentUser.isAnonymous)
    ) {
      await syncOAuthPublicProjection(db, currentUser);
      const { accessToken, refreshToken, sessionId } = await createOAuthSessionAndTokens(
        env,
        currentUser,
        request,
        completionSessionId,
      );
      return {
        user: authService.sanitizeUser(currentUser),
        accessToken,
        refreshToken,
        sessionId,
        created: false,
      };
    }
    throw new EdgeBaseError(409, 'This OAuth account is already linked to another user.', undefined, 'already-exists');
  }
  if (!Number(currentUser.isAnonymous)) {
    throw new EdgeBaseError(409, 'The account is no longer anonymous.', undefined, 'auth-state-changed');
  }

  const reservedEmail = userInfo.email && userInfo.emailVerified ? userInfo.email : null;
  if (reservedEmail) {
    const emailRecord = await lookupEmail(db, reservedEmail);
    if (emailRecord) {
      throw new EdgeBaseError(409, 'Email is already registered to another account.', undefined, 'email-already-exists');
    }
  }

  let oauthReservationId: string;
  try {
    oauthReservationId = await registerOAuthPending(
      db,
      providerName,
      userInfo.providerUserId,
      linkUserId,
    );
  } catch (err) {
    if (isOAuthReservationUnavailable(err)) {
      throw new EdgeBaseError(409, 'This OAuth account is already linked.', undefined, 'already-exists');
    }
    throw err;
  }

  let emailReservationId: string | null = null;
  if (reservedEmail) {
    try {
      emailReservationId = await registerEmailPending(db, reservedEmail, linkUserId);
    } catch {
      await deleteOAuthPending(
        db,
        providerName,
        userInfo.providerUserId,
        linkUserId,
        oauthReservationId,
      ).catch(() => {});
      throw new EdgeBaseError(409, 'Email is already registered.', undefined, 'email-already-exists');
    }
  }

  const updates: Record<string, unknown> = { isAnonymous: 0 };
  if (reservedEmail) updates.email = reservedEmail;
  if (userInfo.displayName) updates.displayName = userInfo.displayName;
  if (userInfo.avatarUrl) updates.avatarUrl = userInfo.avatarUrl;
  if (userInfo.emailVerified) updates.verified = 1;
  try {
    await authService.finalizeOAuthIdentity(db, {
      oauthAccount: {
        id: generateId(),
        userId: linkUserId,
        provider: providerName,
        providerUserId: userInfo.providerUserId,
      },
      oauthReservationId,
      ...(reservedEmail && emailReservationId ? {
        emailReservation: {
          email: reservedEmail,
          userId: linkUserId,
          reservationId: emailReservationId,
        },
      } : {}),
      user: {
        mode: 'update',
        userId: linkUserId,
        updates,
        expectedAuthRevision: Number(currentUser.authRevision ?? 0),
      },
      deleteAnonymousIndex: true,
      revokeSessionsOnUpgrade: true,
    });
  } catch (err) {
    await deleteOAuthPending(
      db,
      providerName,
      userInfo.providerUserId,
      linkUserId,
      oauthReservationId,
    ).catch(() => {});
    if (reservedEmail && emailReservationId) {
      await deleteEmailPending(db, reservedEmail, linkUserId, emailReservationId).catch(() => {});
    }
    if (err instanceof EdgeBaseError) throw err;
    throw new EdgeBaseError(500, `Link failed: ${(err as Error).message}`, undefined, 'internal-error');
  }

  const user = await authService.getUserById(db, linkUserId);
  if (!user) throw new EdgeBaseError(500, 'User not found after link.', undefined, 'internal-error');
  await syncOAuthPublicProjection(db, user);
  const { accessToken, refreshToken, sessionId } = await createOAuthSessionAndTokens(
    env,
    user,
    request,
    completionSessionId,
  );

  return { user: authService.sanitizeUser(user), accessToken, refreshToken, sessionId, created: false };
}

/**
 * Process link/oauth callback — authenticated user attaches an additional OAuth identity.
 */
async function processAttachOAuthCallback(
  env: Env,
  providerName: SupportedProvider,
  userInfo: OAuthUserInfo,
  linkUserId: string,
  request: Request,
  completionSessionId?: string,
): Promise<OAuthResult> {
  const db = getAuthDbFromEnv(env);
  const currentUser = await authService.getUserById(db, linkUserId);
  if (!currentUser) throw new EdgeBaseError(404, 'User not found.', undefined, 'user-not-found');
  if (Number(currentUser.disabled) === 1) {
    throw new EdgeBaseError(403, 'This account has been disabled.', undefined, 'account-disabled');
  }

  const oauthRecord = await lookupOAuth(db, providerName, userInfo.providerUserId);
  if (oauthRecord) {
    if (oauthRecord.userId === linkUserId) {
      if (completionSessionId) {
        await syncOAuthPublicProjection(db, currentUser);
        const { accessToken, refreshToken, sessionId } = await createOAuthSessionAndTokens(
          env,
          currentUser,
          request,
          completionSessionId,
        );
        return {
          user: authService.sanitizeUser(currentUser),
          accessToken,
          refreshToken,
          sessionId,
          created: false,
        };
      }
      throw new EdgeBaseError(409, 'This OAuth account is already linked to your user.', undefined, 'already-exists');
    }
    throw new EdgeBaseError(409, 'This OAuth account is already linked to another user.', undefined, 'already-exists');
  }

  let pendingEmail: string | null = null;
  let emailReservationId: string | null = null;
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
      }
      updates.email = userInfo.email;
      updates.verified = 1;
    } else if (currentEmail === userInfo.email && !currentUser.verified) {
      updates.verified = 1;
    }
  }

  let oauthReservationId: string;
  try {
    oauthReservationId = await registerOAuthPending(
      db,
      providerName,
      userInfo.providerUserId,
      linkUserId,
    );
  } catch (err) {
    if (isOAuthReservationUnavailable(err)) {
      throw new EdgeBaseError(409, 'This OAuth account is already linked.', undefined, 'already-exists');
    }
    throw err;
  }

  if (pendingEmail) {
    try {
      emailReservationId = await registerEmailPending(db, pendingEmail, linkUserId);
    } catch (err) {
      await deleteOAuthPending(
        db,
        providerName,
        userInfo.providerUserId,
        linkUserId,
        oauthReservationId,
      ).catch(() => {});
      if (err instanceof EdgeBaseError) throw err;
      throw new EdgeBaseError(409, 'Email is already registered.', undefined, 'email-already-exists');
    }
  }

  try {
    await authService.finalizeOAuthIdentity(db, {
      oauthAccount: {
        id: generateId(),
        userId: linkUserId,
        provider: providerName,
        providerUserId: userInfo.providerUserId,
      },
      oauthReservationId,
      ...(pendingEmail && emailReservationId ? {
        emailReservation: {
          email: pendingEmail,
          userId: linkUserId,
          reservationId: emailReservationId,
        },
      } : {}),
      user: {
        mode: 'update',
        userId: linkUserId,
        updates,
        expectedAuthRevision: Number(currentUser.authRevision ?? 0),
      },
    });
  } catch (err) {
    await deleteOAuthPending(
      db,
      providerName,
      userInfo.providerUserId,
      linkUserId,
      oauthReservationId,
    ).catch(() => {});
    if (pendingEmail && emailReservationId) {
      await deleteEmailPending(db, pendingEmail, linkUserId, emailReservationId).catch(() => {});
    }
    if (err instanceof EdgeBaseError) throw err;
    throw new EdgeBaseError(500, `Link failed: ${(err as Error).message}`, undefined, 'internal-error');
  }

  const user = await authService.getUserById(db, linkUserId);
  if (!user) throw new EdgeBaseError(500, 'User not found after link.', undefined, 'internal-error');
  await syncOAuthPublicProjection(db, user);
  const { accessToken, refreshToken, sessionId } = await createOAuthSessionAndTokens(
    env,
    user,
    request,
    completionSessionId,
  );

  return { user: authService.sanitizeUser(user), accessToken, refreshToken, sessionId, created: false };
}

/**
 * Auto-link: add OAuth to existing email-verified user
 */
async function autoLinkOAuth(
  env: Env,
  providerName: SupportedProvider,
  userInfo: OAuthUserInfo,
  emailRecord: { userId: string; shardId: number },
  request: Request,
  completionSessionId?: string,
  lifecycleHooks?: OAuthLifecycleHooks,
): Promise<OAuthResult> {
  const { userId } = emailRecord;
  const db = getAuthDbFromEnv(env);

  // Validate the target before reserving a global identity. Disabled/missing
  // targets must not leave a fresh five-minute pending reservation behind.
  const currentUser = await authService.getUserById(db, userId);
  if (!currentUser) throw new EdgeBaseError(404, 'User not found.', undefined, 'user-not-found');
  if (Number(currentUser.disabled) === 1) {
    throw new EdgeBaseError(403, 'This account has been disabled.', undefined, 'account-disabled');
  }

  let oauthReservationId: string;
  try {
    oauthReservationId = await registerOAuthPending(
      db,
      providerName,
      userInfo.providerUserId,
      userId,
      lifecycleHooks?.oauthReservationId,
    );
  } catch (err) {
    if (isOAuthReservationUnavailable(err)) {
      throw new EdgeBaseError(409, 'This OAuth account is already linked.', undefined, 'already-exists');
    }
    throw err;
  }
  try {
    await lifecycleHooks?.checkpointOAuthReservation(oauthReservationId);
  } catch (err) {
    await deleteOAuthPending(
      db,
      providerName,
      userInfo.providerUserId,
      userId,
      oauthReservationId,
    ).catch(() => {});
    throw err;
  }

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
    await lifecycleHooks?.beforeSignIn(currentUser);
    const finalization = await authService.finalizeOAuthIdentity(db, {
      oauthAccount: {
        id: generateId(),
        userId,
        provider: providerName,
        providerUserId: userInfo.providerUserId,
      },
      oauthReservationId,
      user: {
        mode: 'update',
        userId,
        updates,
        expectedAuthRevision: Number(currentUser.authRevision ?? 0),
      },
    });
    lifecycleHooks?.assertFinalizeOutcome(finalization.created);
  } catch (err) {
    await deleteOAuthPending(
      db,
      providerName,
      userInfo.providerUserId,
      userId,
      oauthReservationId,
    ).catch(() => {});
    if (err instanceof EdgeBaseError) throw err;
    throw new EdgeBaseError(500, `OAuth auto-link failed: ${(err as Error).message}`, undefined, 'internal-error');
  }

  // Get user and create session
  const user = await authService.getUserById(db, userId);
  if (!user) throw new EdgeBaseError(500, 'User not found.', undefined, 'internal-error');
  await syncOAuthPublicProjection(db, user);
  const { accessToken, refreshToken, sessionId } = await createOAuthSessionAndTokens(
    env,
    user,
    request,
    completionSessionId,
  );

  return { user: authService.sanitizeUser(user), accessToken, refreshToken, sessionId, created: false };
}

/**
 * Create new OAuth user
 */
async function createOAuthUser(
  env: Env,
  providerName: SupportedProvider,
  userInfo: OAuthUserInfo,
  request: Request,
  completionSessionId?: string,
  plannedUserId?: string,
  lifecycleHooks?: OAuthLifecycleHooks,
): Promise<OAuthResult> {
  const userId = plannedUserId ?? crypto.randomUUID();
  const db = getAuthDbFromEnv(env);
  const reservedEmail = userInfo.email && userInfo.emailVerified ? userInfo.email : null;

  let oauthReservationId: string;
  try {
    oauthReservationId = await registerOAuthPending(
      db,
      providerName,
      userInfo.providerUserId,
      userId,
      lifecycleHooks?.oauthReservationId,
    );
  } catch (err) {
    if (isOAuthReservationUnavailable(err)) {
      throw new EdgeBaseError(409, 'This OAuth account is already linked.', undefined, 'already-exists');
    }
    throw err;
  }
  try {
    await lifecycleHooks?.checkpointOAuthReservation(oauthReservationId);
  } catch (err) {
    await deleteOAuthPending(
      db,
      providerName,
      userInfo.providerUserId,
      userId,
      oauthReservationId,
    ).catch(() => {});
    throw err;
  }

  let emailReservationId: string | null = null;
  if (reservedEmail) {
    try {
      emailReservationId = await registerEmailPending(
        db,
        reservedEmail,
        userId,
        lifecycleHooks?.emailReservationId,
      );
    } catch (err) {
      await deleteOAuthPending(
        db,
        providerName,
        userInfo.providerUserId,
        userId,
        oauthReservationId,
      ).catch(() => {});
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'EMAIL_ALREADY_REGISTERED' || message === 'EMAIL_RESERVATION_CONFLICT') {
        throw new EdgeBaseError(409, 'Email is already registered.', undefined, 'email-already-exists');
      }
      throw err;
    }
    try {
      await lifecycleHooks?.checkpointEmailReservation(emailReservationId);
    } catch (err) {
      await deleteEmailPending(db, reservedEmail, userId, emailReservationId).catch(() => {});
      await deleteOAuthPending(
        db,
        providerName,
        userInfo.providerUserId,
        userId,
        oauthReservationId,
      ).catch(() => {});
      throw err;
    }
  }

  try {
    await lifecycleHooks?.beforeSignUp(userId, providerName, userInfo);
    const finalization = await authService.finalizeOAuthIdentity(db, {
      oauthAccount: {
        id: generateId(),
        userId,
        provider: providerName,
        providerUserId: userInfo.providerUserId,
      },
      oauthReservationId,
      ...(reservedEmail && emailReservationId ? {
        emailReservation: {
          email: reservedEmail,
          userId,
          reservationId: emailReservationId,
        },
      } : {}),
      user: {
        mode: 'create',
        input: {
          userId,
          email: userInfo.email ?? null,
          passwordHash: '',
          displayName: userInfo.displayName,
          avatarUrl: userInfo.avatarUrl,
          verified: Boolean(userInfo.emailVerified),
          role: 'user',
        },
      },
    });
    lifecycleHooks?.assertFinalizeOutcome(finalization.created);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deleteOAuthPending(
      db,
      providerName,
      userInfo.providerUserId,
      userId,
      oauthReservationId,
    ).catch(() => {});
    if (reservedEmail && emailReservationId) {
      await deleteEmailPending(db, reservedEmail, userId, emailReservationId).catch(() => {});
    }
    if (reservedEmail && userInfo.emailVerified && /_users\.email|idx_users_email|unique/i.test(message)) {
      const existingUser = await db.first<{ id: string }>(
        `SELECT id FROM _users WHERE lower(email) = lower(?)`,
        [reservedEmail],
      );
      if (existingUser) {
        try {
          const healingReservationId = await registerEmailPending(db, reservedEmail, existingUser.id);
          await confirmEmail(db, reservedEmail, existingUser.id, healingReservationId);
        } catch (healingErr) {
          if ((healingErr as Error).message !== 'EMAIL_ALREADY_REGISTERED') {
            throw healingErr;
          }
        }
        return autoLinkOAuth(env, providerName, userInfo, {
          userId: existingUser.id,
          shardId: 0,
        }, request, completionSessionId, lifecycleHooks);
      }
    }
    if (err instanceof EdgeBaseError) throw err;
    throw new EdgeBaseError(500, `OAuth user creation failed: ${(err as Error).message}`, undefined, 'internal-error');
  }

  const user = await authService.getUserById(db, userId);
  if (!user) throw new EdgeBaseError(500, 'User not found after OAuth creation.', undefined, 'internal-error');
  await syncOAuthPublicProjection(db, user);
  const { accessToken, refreshToken, sessionId } = await createOAuthSessionAndTokens(
    env,
    user,
    request,
    completionSessionId,
  );

  return { user: authService.sanitizeUser(user), accessToken, refreshToken, sessionId, created: true };
}
