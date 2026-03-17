/**
 * Auth routes — D1-first (Phase 3: Auth DO eliminated)
 *
 * All auth operations go directly to D1 via auth-d1-service.
 * No more DO shard routing — single D1 database for all users.
 */
import { OpenAPIHono, createRoute, z, type HonoEnv } from '../lib/hono.js';
import type { Env } from '../types.js';
import { EdgeBaseError, getAuthAccess, getAuthHandlers } from '@edgebase/shared';
import type {
  AuthAccess,
  AuthTrigger, EmailConfig, EmailTemplateOverrides, EmailSubjectOverrides,
  EmailOtpConfig, MagicLinkConfig, MailType, MailHookCtx, MfaConfig,
  PasskeysConfig, PasswordPolicyConfig, SmsConfig, SmsHookCtx, SmsType,
} from '@edgebase/shared';
import type { AuthContext } from '../middleware/auth.js';
import {
  validateKey,
  buildConstraintCtx,
  resolveRootServiceKey,
  resolveServiceKeyCandidate,
  timingSafeEqual,
} from '../lib/service-key.js';
import { counter, getLimit } from '../middleware/rate-limit.js';
import { parseConfig } from '../lib/do-router.js';
import {
  buildEmailActionUrl,
  parseClientRedirectInput,
} from '../lib/auth-redirect.js';
import {
  signAccessToken, signRefreshToken, verifyRefreshTokenWithFallback,
  parseDuration, decodeTokenUnsafe, TokenExpiredError,
} from '../lib/jwt.js';
import { generateId } from '../lib/uuid.js';
import { captchaMiddleware } from '../middleware/captcha-verify.js';
import { hashPassword, verifyPassword, needsRehash } from '../lib/password.js';
import { validatePassword } from '../lib/password-policy.js';
import { createEmailProvider } from '../lib/email-provider.js';
import type { EmailProvider } from '../lib/email-provider.js';
import { createSmsProvider } from '../lib/sms-provider.js';
import { getTrustedClientIp } from '../lib/client-ip.js';
import type { SmsProvider } from '../lib/sms-provider.js';
import { renderVerifyEmail, renderPasswordReset, renderMagicLink, renderEmailOtp, renderEmailChange } from '../lib/email-templates.js';
import { getDefaultSubject } from '../lib/email-translations.js';
import {
  generateTOTPSecret, generateTOTPUri, verifyTOTP,
  generateRecoveryCodes, encryptSecret, decryptSecret,
} from '../lib/totp.js';
import {
  getFunctionsByTrigger,
  buildFunctionKvProxy,
  buildFunctionD1Proxy,
  buildFunctionVectorizeProxy,
  buildFunctionPushProxy,
  buildAdminAuthContext,
  buildAdminDbProxy,
  getWorkerUrl,
} from '../lib/functions.js';
import * as authService from '../lib/auth-d1-service.js';
import {
  ensureAuthSchema,
  lookupEmail,
  registerEmailPending,
  confirmEmail,
  deleteEmail,
  deleteEmailPending,
  registerAnonPending,
  confirmAnon,
  deleteAnon,
  deleteOAuth,
  lookupPhone,
  registerPhonePending,
  confirmPhone,
  registerPasskey,
  deletePasskey,
} from '../lib/auth-d1.js';
import { zodDefaultHook, jsonResponseSchema, errorResponseSchema } from '../lib/schemas.js';
import { resolveAuthDb, type AuthDb } from '../lib/auth-db-adapter.js';
import { queuePublicUserProjectionSync, syncPublicUserProjection } from '../lib/public-user-profile.js';


/** Resolve AuthDb from Hono context or raw env. Defaults to D1 (AUTH_DB binding). */
function getAuthDb(c: { env: Env }): AuthDb {
  return resolveAuthDb(c.env as unknown as Record<string, unknown>);
}

/** Resolve AuthDb from raw env object. */
function envAuthDb(env: Env): AuthDb {
  return resolveAuthDb(env as unknown as Record<string, unknown>);
}

export const authRoute = new OpenAPIHono<HonoEnv>({ defaultHook: zodDefaultHook });

// Ensure errors propagate to parent app's error handler
authRoute.onError((err, c) => {
  if (err instanceof EdgeBaseError) {
    return c.json(err.toJSON(), err.code as 400);
  }
  // Duck-type fallback
  const e = err as unknown as Record<string, unknown>;
  if (typeof e.code === 'number' && e.code >= 400 && e.code < 600 && typeof e.message === 'string') {
    const body: Record<string, unknown> = { code: e.code, message: e.message };
    if (typeof e.slug === 'string') body.slug = e.slug;
    return c.json(body, e.code as 400);
  }
  throw err; // Re-throw for parent error handler
});

// ─── Helpers ───

function requireAuth(auth: AuthContext | null): string {
  if (!auth) {
    throw new EdgeBaseError(401, 'Authentication required.', undefined, 'unauthenticated');
  }
  return auth.id;
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

  const auth = (c.get('auth') as AuthContext | null | undefined) ?? null;
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

function getUserSecret(env: Env): string {
  if (!env.JWT_USER_SECRET) throw new EdgeBaseError(500, 'JWT_USER_SECRET is not configured. Set it in your environment variables to enable authentication.', undefined, 'internal-error');
  return env.JWT_USER_SECRET;
}

function getAccessTokenTTL(env: Env): string {
  const config = parseConfig(env);
  return config?.auth?.session?.accessTokenTTL ?? '15m';
}

function getRefreshTokenTTL(env: Env): string {
  const config = parseConfig(env);
  return config?.auth?.session?.refreshTokenTTL ?? '28d';
}

function getMaxActiveSessions(env: Env): number {
  const config = parseConfig(env);
  return config?.auth?.session?.maxActiveSessions ?? 0; // 0 = unlimited
}

function isEmailProviderName(value: unknown): value is EmailConfig['provider'] {
  return value === 'resend' || value === 'sendgrid' || value === 'mailgun' || value === 'ses';
}

function getEmailConfig(env: Env): EmailConfig | undefined {
  const config = parseConfig(env);
  const configured = (config as Record<string, unknown> | null)?.email as EmailConfig | undefined;
  const runtimeEnv = env as unknown as Record<string, unknown>;

  const provider = configured?.provider
    ?? (isEmailProviderName(runtimeEnv.EDGEBASE_EMAIL_PROVIDER) ? runtimeEnv.EDGEBASE_EMAIL_PROVIDER : undefined);
  const apiKey = configured?.apiKey
    ?? (typeof runtimeEnv.EDGEBASE_EMAIL_API_KEY === 'string' ? runtimeEnv.EDGEBASE_EMAIL_API_KEY : undefined);
  const from = configured?.from
    ?? (typeof runtimeEnv.EDGEBASE_EMAIL_FROM === 'string' ? runtimeEnv.EDGEBASE_EMAIL_FROM : undefined);

  if (!provider || !apiKey || !from) {
    return configured;
  }

  return {
    provider,
    apiKey,
    from,
    domain: configured?.domain
      ?? (typeof runtimeEnv.EDGEBASE_EMAIL_MAILGUN_DOMAIN === 'string' ? runtimeEnv.EDGEBASE_EMAIL_MAILGUN_DOMAIN : undefined),
    region: configured?.region
      ?? (typeof runtimeEnv.EDGEBASE_EMAIL_SES_REGION === 'string' ? runtimeEnv.EDGEBASE_EMAIL_SES_REGION : undefined),
    appName: configured?.appName ?? 'EdgeBase Local Auth Harness',
    defaultLocale: configured?.defaultLocale,
    verifyUrl: configured?.verifyUrl
      ?? (typeof runtimeEnv.EDGEBASE_APP_WEB_VERIFY_EMAIL_URL === 'string' ? runtimeEnv.EDGEBASE_APP_WEB_VERIFY_EMAIL_URL : undefined),
    resetUrl: configured?.resetUrl
      ?? (typeof runtimeEnv.EDGEBASE_APP_WEB_RESET_PASSWORD_URL === 'string' ? runtimeEnv.EDGEBASE_APP_WEB_RESET_PASSWORD_URL : undefined),
    magicLinkUrl: configured?.magicLinkUrl
      ?? (typeof runtimeEnv.EDGEBASE_APP_WEB_MAGIC_LINK_URL === 'string' ? runtimeEnv.EDGEBASE_APP_WEB_MAGIC_LINK_URL : undefined),
    emailChangeUrl: configured?.emailChangeUrl
      ?? (typeof runtimeEnv.EDGEBASE_APP_WEB_CHANGE_EMAIL_URL === 'string' ? runtimeEnv.EDGEBASE_APP_WEB_CHANGE_EMAIL_URL : undefined),
    templates: configured?.templates,
    subjects: configured?.subjects,
  };
}

function getAppName(env: Env): string {
  return getEmailConfig(env)?.appName ?? 'EdgeBase';
}

/**
 * Parse Accept-Language header to extract primary language code.
 * "ko-KR,ko;q=0.9,en-US;q=0.8" → "ko"
 */
function parseAcceptLanguage(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const first = header.split(',')[0]?.trim().split(';')[0]?.trim();
  return first?.split('-')[0] || undefined;
}

/**
 * Resolve locale for email sending.
 * Priority: user's stored locale > Accept-Language header > app default locale > 'en'
 */
function resolveEmailLocale(env: Env, userLocale?: string | null, acceptLang?: string): string {
  if (userLocale && userLocale !== 'en') return userLocale;
  if (userLocale === 'en') return 'en';
  if (acceptLang) return acceptLang;
  return getEmailConfig(env)?.defaultLocale ?? 'en';
}

function getEmailTemplates(env: Env): EmailTemplateOverrides | undefined {
  return getEmailConfig(env)?.templates;
}

/**
 * Resolve LocalizedString to a plain string.
 * LocalizedString = string | Record<string, string>.
 * When locale is provided, tries: exact locale → base language → 'en' → first available.
 */
function resolveLocalizedString(val: undefined, locale?: string): undefined;
function resolveLocalizedString(val: string | Record<string, string>, locale?: string): string;
function resolveLocalizedString(val: string | Record<string, string> | undefined, locale?: string): string | undefined;
function resolveLocalizedString(val: string | Record<string, string> | undefined, locale?: string): string | undefined {
  if (val === undefined) return undefined;
  if (typeof val === 'string') return val;
  if (locale) {
    const base = locale.split('-')[0];
    const resolved = val[locale] ?? val[base] ?? val.en ?? Object.values(val)[0];
    return resolved || undefined;
  }
  return val.en || Object.values(val)[0] || undefined;
}

function getEmailSubjects(env: Env): EmailSubjectOverrides | undefined {
  return getEmailConfig(env)?.subjects;
}

function resolveSubject(env: Env, type: keyof EmailSubjectOverrides, defaultSubject: string, locale?: string): string {
  const custom = getEmailSubjects(env)?.[type];
  if (!custom) return defaultSubject;
  // LocalizedString can be string or Record<string, string>
  let subjectStr: string;
  if (typeof custom === 'string') {
    subjectStr = custom;
  } else if (locale) {
    const base = locale.split('-')[0];
    subjectStr = custom[locale] ?? custom[base] ?? custom.en ?? Object.values(custom)[0] ?? defaultSubject;
  } else {
    subjectStr = custom.en || Object.values(custom)[0] || defaultSubject;
  }
  return subjectStr.replace(/\{\{appName\}\}/g, getAppName(env));
}

function getMagicLinkConfig(env: Env): MagicLinkConfig | undefined {
  const config = parseConfig(env);
  return config?.auth?.magicLink;
}

function getEmailOtpConfig(env: Env): EmailOtpConfig | undefined {
  const config = parseConfig(env);
  return config?.auth?.emailOtp;
}

function getSmsConfig(env: Env): SmsConfig | undefined {
  const config = parseConfig(env);
  return (config as Record<string, unknown> | null)?.sms as SmsConfig | undefined;
}

function getMfaConfig(env: Env): MfaConfig | undefined {
  const config = parseConfig(env);
  return config?.auth?.mfa;
}

function getPasswordPolicyConfig(env: Env): PasswordPolicyConfig | undefined {
  const config = parseConfig(env);
  return config?.auth?.passwordPolicy;
}

function getPasskeysConfig(env: Env): PasskeysConfig | undefined {
  const config = parseConfig(env);
  return config?.auth?.passkeys;
}

type OAuthIdentityRecord = {
  id: string;
  provider: string;
  providerUserId: string;
  createdAt: string;
};

async function getIdentityState(env: Env, db: AuthDb, userId: string): Promise<{
  user: Record<string, unknown>;
  oauthAccounts: OAuthIdentityRecord[];
  passkeyCount: number;
  summary: {
    total: number;
    hasPassword: boolean;
    hasMagicLink: boolean;
    hasEmailOtp: boolean;
    hasPhone: boolean;
    passkeyCount: number;
    oauthCount: number;
  };
}> {
  const user = await authService.getUserById(db, userId);
  if (!user) {
    throw new EdgeBaseError(404, 'User not found.', undefined, 'user-not-found');
  }

  const oauthAccounts = (await authService.listOAuthAccounts(db, userId)).map((row) => ({
    id: String(row.id),
    provider: String(row.provider),
    providerUserId: String(row.providerUserId),
    createdAt: String(row.createdAt),
  }));

  const passkeyCount = getPasskeysConfig(env)?.enabled
    ? (await authService.listWebAuthnCredentials(db, userId)).length
    : 0;

  const hasPassword =
    parseConfig(env)?.auth?.emailAuth !== false
    && typeof user.passwordHash === 'string'
    && user.passwordHash.length > 0;
  const hasMagicLink =
    typeof user.email === 'string'
    && user.email.length > 0
    && !!getMagicLinkConfig(env)?.enabled;
  const hasEmailOtp =
    typeof user.email === 'string'
    && user.email.length > 0
    && !!getEmailOtpConfig(env)?.enabled;
  const hasPhone =
    !!parseConfig(env)?.auth?.phoneAuth
    && typeof user.phone === 'string'
    && user.phone.length > 0
    && Number(user.phoneVerified) === 1;

  const total =
    Number(hasPassword)
    + Number(hasMagicLink)
    + Number(hasEmailOtp)
    + Number(hasPhone)
    + passkeyCount
    + oauthAccounts.length;

  return {
    user,
    oauthAccounts,
    passkeyCount,
    summary: {
      total,
      hasPassword,
      hasMagicLink,
      hasEmailOtp,
      hasPhone,
      passkeyCount,
      oauthCount: oauthAccounts.length,
    },
  };
}

function generateOTP(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 1000000).padStart(6, '0');
}

function parseTTLtoMs(ttl: string): number {
  const match = ttl.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 15 * 60 * 1000; // default 15m
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return 15 * 60 * 1000;
  }
}

async function hashRecoveryCode(code: string): Promise<string> {
  const encoded = new TextEncoder().encode(code);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  const bytes = new Uint8Array(hash);
  let hex = '';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}

async function verifyRecoveryCode(code: string, storedHash: string): Promise<boolean> {
  const hash = await hashRecoveryCode(code);
  if (hash.length !== storedHash.length) return false;
  let result = 0;
  for (let i = 0; i < hash.length; i++) {
    result |= hash.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Generate access token from user record, merging DB customClaims and hook overrides.
 */
async function generateAccessToken(
  env: Env,
  user: Record<string, unknown>,
  hookClaimsOverride?: Record<string, unknown>,
): Promise<string> {
  const dbClaims = user.customClaims
    ? (typeof user.customClaims === 'string' ? JSON.parse(user.customClaims as string) : user.customClaims)
    : undefined;

  let finalClaims = dbClaims;
  if (hookClaimsOverride) {
    finalClaims = { ...(dbClaims || {}), ...hookClaimsOverride };
    const SYSTEM_CLAIMS = ['sub', 'iss', 'exp', 'iat', 'isAnonymous', 'displayName'];
    for (const key of SYSTEM_CLAIMS) {
      if (key in finalClaims) delete finalClaims[key];
    }
  }

  return signAccessToken(
    {
      sub: user.id as string,
      email: user.email as string | null,
      displayName: (user.displayName as string | null) ?? undefined,
      role: user.role as string,
      isAnonymous: (typeof user.isAnonymous === 'number') ? user.isAnonymous === 1 : !!user.isAnonymous,
      custom: finalClaims,
    },
    getUserSecret(env),
    getAccessTokenTTL(env),
  );
}

/**
 * Create a session with eviction and token generation — D1-based.
 */
async function createSessionAndTokens(
  env: Env,
  userId: string,
  ip: string,
  userAgent: string,
): Promise<{ accessToken: string; refreshToken: string; sessionId: string }> {
  const db = envAuthDb(env);
  const user = await authService.getUserById(db, userId);
  if (!user) throw new EdgeBaseError(500, 'Internal error: user record was not found immediately after creation.', undefined, 'internal-error');

  // Session limit eviction
  const maxSessions = getMaxActiveSessions(env);
  if (maxSessions > 0) {
    await authService.evictOldestSessions(db, userId, maxSessions);
  }

  const accessToken = await generateAccessToken(env, user);
  const sessionId = generateId();
  const refreshToken = await signRefreshToken(
    { sub: userId, type: 'refresh', jti: sessionId },
    getUserSecret(env),
    getRefreshTokenTTL(env),
  );
  const now = new Date().toISOString();
  const refreshTTLSeconds = parseDuration(getRefreshTokenTTL(env));
  const expiresAt = new Date(Date.now() + refreshTTLSeconds * 1000).toISOString();

  const metadata = JSON.stringify({ ip, userAgent, lastActiveAt: now });

  await authService.createSession(db, {
    id: sessionId,
    userId,
    refreshToken,
    expiresAt,
    metadata,
  });

  return { accessToken, refreshToken, sessionId };
}

/**
 * Rotate refresh token — D1-based.
 */
async function rotateRefreshTokenFlow(
  env: Env,
  ctx: ExecutionContext,
  session: Record<string, unknown>,
  userId: string,
  workerUrl?: string,
): Promise<{ user: Record<string, unknown>; accessToken: string; refreshToken: string }> {
  const db = envAuthDb(env);
  const user = await authService.getUserById(db, userId);
  if (!user) throw new EdgeBaseError(401, 'User not found.', undefined, 'invalid-credentials');

  if (user.disabled === 1) {
    throw new EdgeBaseError(403, 'This account has been disabled.', undefined, 'account-disabled');
  }

  const newRefreshToken = await signRefreshToken(
    { sub: userId, type: 'refresh', jti: generateId() },
    getUserSecret(env),
    getRefreshTokenTTL(env),
  );
  const refreshTTLSeconds = parseDuration(getRefreshTokenTTL(env));
  const expiresAt = new Date(Date.now() + refreshTTLSeconds * 1000).toISOString();

  await authService.rotateRefreshToken(
    db,
    session.id as string,
    newRefreshToken,
    session.refreshToken as string,
    expiresAt,
  );

  // onTokenRefresh hook — blocking, returns custom claims
  let hookClaims: Record<string, unknown> | undefined;
  try {
    const result = await executeAuthHook(env, ctx, 'onTokenRefresh', authService.sanitizeUser(user), { blocking: true, workerUrl });
    if (result && typeof result === 'object') {
      hookClaims = result;
    }
  } catch {
    console.error('[EdgeBase] onTokenRefresh hook failed, proceeding without hook claims');
  }

  const accessToken = await generateAccessToken(env, user, hookClaims);

  return {
    user: authService.sanitizeUser(user),
    accessToken,
    refreshToken: newRefreshToken,
  };
}

/**
 * Sync user data to _users_public and KV cache.
 */
function syncUserPublic(
  env: Env,
  ctx: ExecutionContext,
  userId: string,
  userData: Record<string, unknown>,
  isSync: boolean = false,
): Promise<void> | void {
  const authDb = envAuthDb(env);
  if (isSync) {
    return syncPublicUserProjection(authDb, userId, userData, {
      executionCtx: ctx,
      kv: env.KV,
      awaitCacheWrites: true,
    });
  }
  queuePublicUserProjectionSync(authDb, userId, userData, {
    executionCtx: ctx,
    kv: env.KV,
  });
}

/**
 * Execute auth hooks for a given event — D1-based (no re-entrancy concern).
 */
export async function executeAuthHook(
  env: Env,
  ctx: ExecutionContext,
  event: AuthTrigger['event'],
  userData: Record<string, unknown>,
  options: { blocking?: boolean; ip?: string; userAgent?: string; workerUrl?: string } = {},
): Promise<Record<string, unknown> | void> {
  const functions = getFunctionsByTrigger('auth', { type: 'auth', event } as AuthTrigger);
  if (functions.length === 0) return;

  const HOOK_TIMEOUT_MS = 5000;
  const config = parseConfig(env);
  const serviceKey = resolveRootServiceKey(config, env);
  const adminDb = buildAdminDbProxy({
    databaseNamespace: env.DATABASE,
    config,
    workerUrl: options.workerUrl,
    serviceKey,
    env,
    executionCtx: ctx,
  });
  const authAdminBase = buildAdminAuthContext({
    d1Database: env.AUTH_DB,
    serviceKey,
    workerUrl: options.workerUrl,
    kvNamespace: env.KV,
  });
  const mergedBlockingResult: Record<string, unknown> = {};

  for (const { name, definition } of functions) {
    try {
      const authAdmin = {
        ...authAdminBase,
        async createUser(_data: {
          email: string;
          password: string;
          displayName?: string;
          role?: string;
        }) {
          throw new Error(
            'admin.auth.createUser() is not available inside auth hooks. ' +
            'Use the Admin API or SDK for user creation.',
          );
        },
        async deleteUser(_userId: string) {
          throw new Error(
            'admin.auth.deleteUser() is not available inside auth hooks. ' +
            'Use the Admin API or SDK for user deletion.',
          );
        },
      };

      const hookCtx: Record<string, unknown> = {
        request: new Request('http://internal/auth-hook'),
        auth: null,
        admin: {
          db: adminDb,
          table: (name: string) => adminDb('shared').table(name),
          auth: authAdmin,
          async sql(namespace: string, id: string | undefined, query: string, params?: unknown[]) {
            if (options.workerUrl && serviceKey) {
              const res = await fetch(`${options.workerUrl}/api/sql`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-EdgeBase-Service-Key': serviceKey },
                body: JSON.stringify({ namespace, id, sql: query, params: params ?? [] }),
              });
              if (!res.ok) throw new Error(`admin.sql() failed: ${res.status}`);
              return res.json();
            }
            throw new Error('admin.sql() requires workerUrl in auth hook context.');
          },
          async broadcast(channel: string, event: string, payload?: Record<string, unknown>) {
            if (options.workerUrl && serviceKey) {
              await fetch(`${options.workerUrl}/api/db/broadcast`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-EdgeBase-Service-Key': serviceKey },
                body: JSON.stringify({ channel, event, payload: payload ?? {} }),
              });
              return;
            }
            throw new Error('admin.broadcast() requires workerUrl in auth hook context.');
          },
          functions: {
            async call(name: string, data?: unknown) {
              if (options.workerUrl && serviceKey) {
                const safeName = name.split('/').map(encodeURIComponent).join('/');
                const res = await fetch(`${options.workerUrl}/api/functions/${safeName}`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'X-EdgeBase-Service-Key': serviceKey },
                  body: JSON.stringify(data ?? {}),
                });
                if (!res.ok) throw new Error(`admin.functions.call('${name}') failed: ${res.status}`);
                return res.json();
              }
              throw new Error('admin.functions.call() requires workerUrl in auth hook context.');
            },
          },
          kv: (namespace: string) => buildFunctionKvProxy(namespace, config, env, options.workerUrl, serviceKey),
          d1: (database: string) => buildFunctionD1Proxy(database, config, env, options.workerUrl, serviceKey),
          vector: (index: string) => buildFunctionVectorizeProxy(index, config, env, options.workerUrl, serviceKey),
          push: buildFunctionPushProxy(options.workerUrl, serviceKey),
        },
        data: { after: userData },
        ...(options.ip ? { ip: options.ip } : {}),
        ...(options.userAgent ? { userAgent: options.userAgent } : {}),
      };

      if (options.blocking) {
        const result = await Promise.race([
          definition.handler(hookCtx),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Auth hook '${name}' timed out (5s)`)), HOOK_TIMEOUT_MS),
          ),
        ]);
        if (result && typeof result === 'object') {
          Object.assign(mergedBlockingResult, result as Record<string, unknown>);
        }
      } else {
        ctx.waitUntil(
          definition.handler(hookCtx).catch((err: unknown) => {
            console.error(`[EdgeBase] Auth hook '${name}' (${event}) failed:`, err);
          }),
        );
      }
    } catch (err) {
      if (options.blocking) {
        console.error(`[EdgeBase] Blocking auth hook '${name}' (${event}) failed:`, err);
        throw new EdgeBaseError(403, `Auth hook '${name}' rejected the operation.`, undefined, 'hook-rejected');
      }
      console.error(`[EdgeBase] Auth hook '${name}' (${event}) error:`, err);
    }
  }

  if (options.blocking && Object.keys(mergedBlockingResult).length > 0) {
    return mergedBlockingResult;
  }
}

/**
 * Send email with optional auth.handlers.email.onSend interception.
 * The optional `locale` parameter is passed through to the onSend hook.
 */
async function sendMailWithHook(
  env: Env,
  ctx: ExecutionContext,
  provider: EmailProvider,
  type: MailType,
  to: string,
  subject: string,
  html: string,
  locale?: string,
): Promise<{ success: boolean; messageId?: string }> {
  const config = parseConfig(env);
  const onSend = getAuthHandlers(config)?.email?.onSend;

  let finalSubject = subject;
  let finalHtml = html;

  if (onSend) {
    const MAIL_HOOK_TIMEOUT = 5000;
    const mailCtx: MailHookCtx = {
      waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p),
    };

    try {
      const result = await Promise.race([
        Promise.resolve(onSend(type, to, finalSubject, finalHtml, mailCtx, locale)),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Mail hook timed out')), MAIL_HOOK_TIMEOUT),
        ),
      ]);

      if (result) {
        if (result.subject) finalSubject = result.subject;
        if (result.html) finalHtml = result.html;
      }
    } catch (err) {
      console.error('[EdgeBase] auth.handlers.email.onSend rejected or timed out:', err);
      throw new EdgeBaseError(403, 'Mail hook rejected the email.', undefined, 'hook-rejected');
    }
  }

  return provider.send({ to, subject: finalSubject, html: finalHtml });
}

async function sendSmsWithHook(
  env: Env,
  ctx: ExecutionContext,
  provider: SmsProvider,
  type: SmsType,
  to: string,
  body: string,
): Promise<void> {
  const onSend = getAuthHandlers(parseConfig(env))?.sms?.onSend;
  let finalBody = body;

  if (onSend) {
    const SMS_HOOK_TIMEOUT = 5000;
    const smsCtx: SmsHookCtx = {
      waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p),
    };

    try {
      const result = await Promise.race([
        Promise.resolve(onSend(type, to, finalBody, smsCtx)),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('SMS hook timed out')), SMS_HOOK_TIMEOUT),
        ),
      ]);

      if (result?.body) {
        finalBody = result.body;
      }
    } catch (err) {
      console.error('[EdgeBase] auth.handlers.sms.onSend rejected or timed out:', err);
      throw new EdgeBaseError(403, 'SMS hook rejected the SMS.', undefined, 'hook-rejected');
    }
  }

  await provider.send({ to, body: finalBody });
}

/**
 * Extract client IP from request headers.
 *
 * Priority: CF-Connecting-IP (Cloudflare, tamper-proof) →
 * X-Forwarded-For (only when trustSelfHostedProxy=true).
 *
 * Security: X-Forwarded-For is client-spoofable when EdgeBase is exposed without
 * a reverse proxy. Self-hosted deployments MUST place EdgeBase behind Nginx/Caddy
 * that overwrites X-Forwarded-For with $remote_addr. See docs/self-hosting.md.
 */
function getClientIP(env: Env, request: Request): string {
  return getTrustedClientIp(env, request) ?? '0.0.0.0';
}

function getAnonymousAuthEnabled(env: Env): boolean {
  try {
    const config = parseConfig(env);
    return !!config?.auth?.anonymousAuth;
  } catch {
    return false;
  }
}

// ─── D1 Schema Middleware ───

authRoute.use('*', async (c, next) => {
  await ensureAuthSchema(getAuthDb(c));
  await next();
});

// ─── Auth Rate Limiting Middleware ───
// 2-layer: software counter (config-driven) + Binding ceiling
// Service Key는 auth 그룹 바이패스

authRoute.use('*', async (c, next) => {
  // Service Key bypasses auth rate limit
  const providedServiceKey = resolveServiceKeyCandidate(
    c.req,
    c.get('serviceKeyToken') as string | null | undefined,
  );
  if (providedServiceKey) {
    const config = c.env ? parseConfig(c.env) : {};
    const { result: skResult } = validateKey(
      providedServiceKey,
      'auth:*:*:bypass',
      config,
      c.env as never,
      undefined,
      buildConstraintCtx((c.env ?? {}) as { ENVIRONMENT?: string }, c.req),
    );
    if (skResult === 'valid') {
      await next();
      return;
    }
    // 'invalid' key provided — still fall through to normal rate limiting
    // (don't throw here; auth routes return their own errors)
  }

  const ip = getClientIP(c.env, c.req.raw);
  const config = c.env ? parseConfig(c.env) : undefined;

  // Layer 1: Software counter (config-driven)
  const { requests, windowSec } = getLimit(config, 'auth');
  const counterKey = `auth:${ip}`;
  if (!counter.check(counterKey, requests, windowSec)) {
    throw new EdgeBaseError(429, 'Too many requests. Try again later.', undefined, 'rate-limited');
  }

  // Layer 2: Binding ceiling
  const authLimiter = c.env?.AUTH_RATE_LIMITER;
  if (authLimiter) {
    const { success } = await authLimiter.limit({ key: ip });
    if (!success) {
      throw new EdgeBaseError(429, 'Too many requests. Try again later.', undefined, 'rate-limited');
    }
  }
  await next();
});

// ─── Captcha Middleware ───
// Applied per-route after rate limiting. Service Key requests bypass.
authRoute.use('/signup', captchaMiddleware('signup'));
authRoute.use('/signin', captchaMiddleware('signin'));
authRoute.use('/signin/anonymous', captchaMiddleware('anonymous'));
authRoute.use('/signin/magic-link', captchaMiddleware('magic-link'));
authRoute.use('/signin/phone', captchaMiddleware('phone'));
authRoute.use('/request-password-reset', captchaMiddleware('password-reset'));

// ─── Signup (D1 Control Plane) ───

const signup = createRoute({
  operationId: 'authSignup',
  method: 'post',
  path: '/signup',
  tags: ['client'],
  summary: 'Sign up with email and password',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      email: z.string(),
      password: z.string(),
    }).passthrough() } }, required: true },
  },
  responses: {
    201: { description: 'User created', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    409: { description: 'Email already registered', content: { 'application/json': { schema: errorResponseSchema } } },
    429: { description: 'Too many requests', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(signup, async (c) => {
  const ip = getClientIP(c.env, c.req.raw);
  const config = c.env ? parseConfig(c.env) : undefined;

  // Layer 1: Software counter (config-driven)
  const { requests, windowSec } = getLimit(config, 'authSignup');
  const counterKey = `authSignup:${ip}`;
  if (!counter.check(counterKey, requests, windowSec)) {
    throw new EdgeBaseError(429, 'Too many signup attempts. Please try again later.', undefined, 'rate-limited');
  }

  // Layer 2: Binding ceiling
  const signupLimiter = c.env?.AUTH_SIGNUP_RATE_LIMITER;
  if (signupLimiter) {
    const { success } = await signupLimiter.limit({ key: ip });
    if (!success) {
      throw new EdgeBaseError(429, 'Too many signup attempts. Please try again later.', undefined, 'rate-limited');
    }
  }

  const body = await c.req.json<{ email: string; password: string; data?: Record<string, unknown> }>();
  if (!body.email || !body.password) {
    throw new EdgeBaseError(400, 'Email and password are required.', undefined, 'invalid-input');
  }
  body.email = body.email.trim().toLowerCase(); //
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    throw new EdgeBaseError(400, 'Invalid email format. Please provide a valid email address.', undefined, 'invalid-email');
  }
  if (body.password.length < 8) {
    throw new EdgeBaseError(400, 'Password must be at least 8 characters.', undefined, 'password-too-short');
  }
  if (body.password.length > 256) {
    throw new EdgeBaseError(400, 'Password must not exceed 256 characters.', undefined, 'password-too-long');
  }

  await ensureAuthActionAllowed(c, 'signUp', body as unknown as Record<string, unknown>);

  // Validate optional fields from body.data
  const displayName = body.data?.displayName ?? null;
  const avatarUrl = body.data?.avatarUrl ?? null;
  if (displayName !== null && typeof displayName === 'string' && displayName.length > 200) {
    throw new EdgeBaseError(400, 'Display name must not exceed 200 characters.', undefined, 'display-name-too-long');
  }
  if (avatarUrl !== null && typeof avatarUrl === 'string' && avatarUrl.length > 2048) {
    throw new EdgeBaseError(400, 'Avatar URL must not exceed 2048 characters.', undefined, 'invalid-input');
  }

  // Validate locale if provided
  const rawLocale = (body as Record<string, unknown>).locale as string | undefined;
  if (rawLocale && !/^[a-z]{2}(-[A-Z]{2})?$/.test(rawLocale)) {
    throw new EdgeBaseError(400, 'Invalid locale format. Expected format: "en" or "en-US".', undefined, 'invalid-locale');
  }
  const locale = rawLocale ?? parseAcceptLanguage(c.req.header('accept-language')) ?? 'en';

  const userId = generateId();
  const db = getAuthDb(c);

  // Register pending in D1 email index
  try {
    await registerEmailPending(db, body.email, userId);
  } catch (err) {
    if ((err as Error).message === 'EMAIL_ALREADY_REGISTERED') {
      throw new EdgeBaseError(409, 'Email already registered.', undefined, 'email-already-exists');
    }
    throw new EdgeBaseError(500, 'Signup failed. Please try again.', undefined, 'internal-error');
  }

  // Create user directly in D1
  try {
    // Password policy validation
    const policyResult = await validatePassword(body.password, getPasswordPolicyConfig(c.env));
    if (!policyResult.valid) {
      await deleteEmailPending(db, body.email).catch(() => {});
      throw new EdgeBaseError(400, policyResult.errors[0], { password: { code: 'password_policy', message: policyResult.errors.join('; ') } }, 'password-policy');
    }

    const passwordHash = await hashPassword(body.password);

    await authService.createUser(db, {
      userId,
      email: body.email,
      passwordHash,
      displayName: displayName as string | null,
      avatarUrl: avatarUrl as string | null,
      emailVisibility: 'private',
      role: 'user',
      verified: false,
      locale,
    });

    // beforeSignUp hook — blocking, can cancel signup
    await executeAuthHook(c.env, c.executionCtx, 'beforeSignUp', {
      id: userId,
      email: body.email,
      displayName,
      avatarUrl,
    }, { blocking: true, workerUrl: getWorkerUrl(c.req.url, c.env) });

    // Create session + tokens
    const session = await createSessionAndTokens(c.env, userId, ip, c.req.header('user-agent') || '');

    // Confirm email in D1 index
    await confirmEmail(db, body.email, userId);

    // Sync to _users_public
    const user = await authService.getUserById(db, userId);
    if (user) {
      syncUserPublic(c.env, c.executionCtx, userId, authService.buildPublicUserData(user));

      // afterSignUp hook — non-blocking
      c.executionCtx.waitUntil(
        executeAuthHook(c.env, c.executionCtx, 'afterSignUp', authService.sanitizeUser(user), { workerUrl: getWorkerUrl(c.req.url, c.env) }).catch(() => {}),
      );

      return c.json({
        user: authService.sanitizeUser(user),
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
      }, 201);
    }

    return c.json({ accessToken: session.accessToken, refreshToken: session.refreshToken }, 201);
  } catch (err) {
    if (err instanceof EdgeBaseError) throw err;
    // Compensating transaction
    await deleteEmailPending(db, body.email).catch(() => {});
    throw new EdgeBaseError(500, 'Signup failed. Please try again.', undefined, 'internal-error');
  }
});

// ─── Signin (D1 Control Plane) ───

const signin = createRoute({
  operationId: 'authSignin',
  method: 'post',
  path: '/signin',
  tags: ['client'],
  summary: 'Sign in with email and password',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      email: z.string(),
      password: z.string(),
    }).passthrough() } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Invalid credentials', content: { 'application/json': { schema: errorResponseSchema } } },
    429: { description: 'Too many requests', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(signin, async (c) => {
  const body = await c.req.json<{ email: string; password: string }>();
  if (!body.email || !body.password) {
    throw new EdgeBaseError(400, 'Email and password are required.', undefined, 'invalid-input');
  }
  body.email = body.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    throw new EdgeBaseError(400, 'Invalid email format.', undefined, 'invalid-email');
  }
  if (body.password.length > 256) {
    throw new EdgeBaseError(400, 'Password must not exceed 256 characters.', undefined, 'password-too-long');
  }

  await ensureAuthActionAllowed(c, 'signIn', body as unknown as Record<string, unknown>);

  // Layer 1: Software counter (config-driven, email당)
  const config = c.env ? parseConfig(c.env) : undefined;
  const signinLimit = getLimit(config, 'authSignin');
  const signinKey = `authSignin:${body.email}`;
  if (!counter.check(signinKey, signinLimit.requests, signinLimit.windowSec)) {
    throw new EdgeBaseError(429, 'Too many login attempts. Try again later.', undefined, 'rate-limited');
  }

  // Layer 2: Binding ceiling
  const signinLimiter = c.env?.AUTH_SIGNIN_RATE_LIMITER;
  if (signinLimiter) {
    const { success } = await signinLimiter.limit({ key: body.email });
    if (!success) {
      throw new EdgeBaseError(429, 'Too many login attempts. Try again later.', undefined, 'rate-limited');
    }
  }

  // Look up email → userId in D1
  const record = await lookupEmail(getAuthDb(c), body.email);
  if (!record) {
    throw new EdgeBaseError(401, 'Invalid credentials.', undefined, 'invalid-credentials');
  }

  const { userId } = record;
  const ip = getClientIP(c.env, c.req.raw);
  const db = getAuthDb(c);

  // Verify password directly in D1
  const user = await authService.getUserById(db, userId);
  if (!user) {
    throw new EdgeBaseError(401, 'Invalid credentials.', undefined, 'invalid-credentials');
  }

  // OAuth-only user check
  if (!user.passwordHash) {
    throw new EdgeBaseError(403, 'This account uses OAuth sign-in. Password login is not available.', undefined, 'oauth-only');
  }

  const valid = await verifyPassword(body.password, user.passwordHash as string);
  if (!valid) {
    throw new EdgeBaseError(401, 'Invalid credentials.', undefined, 'invalid-credentials');
  }

  // Lazy re-hash: if password uses non-native format (e.g. imported bcrypt), upgrade to PBKDF2
  if (needsRehash(user.passwordHash as string)) {
    const newHash = await hashPassword(body.password);
    await authService.updateUser(db, userId, { passwordHash: newHash });
  }

  // Disabled user check
  if (user.disabled === 1) {
    throw new EdgeBaseError(403, 'This account has been disabled.', undefined, 'account-disabled');
  }

  // beforeSignIn hook — blocking, can reject signin
  await executeAuthHook(c.env, c.executionCtx, 'beforeSignIn', authService.sanitizeUser(user), { blocking: true, workerUrl: getWorkerUrl(c.req.url, c.env) });

  // MFA Check
  const mfaConfig = getMfaConfig(c.env);
  if (mfaConfig?.totp) {
    const factors = await authService.listVerifiedMfaFactors(db, userId);
    if (factors.length > 0) {
      const mfaTicket = crypto.randomUUID();
      await c.env.KV.put(
        `mfa-ticket:${mfaTicket}`,
        JSON.stringify({ userId }),
        { expirationTtl: 300 },
      );

      return c.json({
        mfaRequired: true,
        mfaTicket,
        factors: factors.map((f: Record<string, unknown>) => ({ id: f.id, type: f.type })),
      });
    }
  }

  // Lazy cleanup of expired sessions
  await authService.cleanExpiredSessionsForUser(db, userId);

  const session = await createSessionAndTokens(c.env, userId, ip, c.req.header('user-agent') || '');

  // afterSignIn hook — non-blocking
  c.executionCtx.waitUntil(
    executeAuthHook(c.env, c.executionCtx, 'afterSignIn', authService.sanitizeUser(user), { workerUrl: getWorkerUrl(c.req.url, c.env) }).catch(() => {}),
  );

  return c.json({
    user: authService.sanitizeUser(user),
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
  });
});

// ─── Anonymous Signin (D1 Control Plane) ───

const signinAnonymous = createRoute({
  operationId: 'authSigninAnonymous',
  method: 'post',
  path: '/signin/anonymous',
  tags: ['client'],
  summary: 'Sign in anonymously',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      captchaToken: z.string().optional(),
    }).passthrough() } }, required: false },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    404: { description: 'Anonymous auth not enabled', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(signinAnonymous, async (c) => {
  if (!getAnonymousAuthEnabled(c.env)) {
    throw new EdgeBaseError(404, 'Anonymous authentication is not enabled.', undefined, 'feature-not-enabled');
  }

  const rawBody = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  await ensureAuthActionAllowed(c, 'signInAnonymous', rawBody);

  const ip = getClientIP(c.env, c.req.raw);

  const userId = generateId();
  const db = getAuthDb(c);

  // Register in D1 _anon_index
  await registerAnonPending(db, userId);

  try {
    // Create anonymous user directly in D1
    await authService.createAnonymousUser(db, userId);

    const session = await createSessionAndTokens(c.env, userId, ip, c.req.header('user-agent') || '');

    // Confirm in D1
    await confirmAnon(db, userId);

    const user = await authService.getUserById(db, userId);
    if (user) {
      syncUserPublic(c.env, c.executionCtx, userId, authService.buildPublicUserData(user));

      return c.json({
        user: authService.sanitizeUser(user),
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
      }, 201);
    }

    return c.json({ accessToken: session.accessToken, refreshToken: session.refreshToken }, 201);
  } catch (err) {
    if (err instanceof EdgeBaseError) throw err;
    await deleteAnon(db, userId).catch(() => {});
    throw new EdgeBaseError(500, 'Anonymous signin failed.', undefined, 'internal-error');
  }
});

// ─── Magic Link (D1 Control Plane) ───

const signinMagicLink = createRoute({
  operationId: 'authSigninMagicLink',
  method: 'post',
  path: '/signin/magic-link',
  tags: ['client'],
  summary: 'Send magic link to email',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      email: z.string(),
    }).passthrough() } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Magic link not enabled', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(signinMagicLink, async (c) => {
  const body = await c.req.json<{
    email: string;
    redirectUrl?: string;
    state?: string;
  }>();
  if (!body.email) {
    throw new EdgeBaseError(400, 'Email is required.', undefined, 'invalid-input');
  }
  body.email = body.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    throw new EdgeBaseError(400, 'Invalid email format.', undefined, 'invalid-email');
  }
  const redirect = parseClientRedirectInput(c.env, body);

  await ensureAuthActionAllowed(c, 'signInMagicLink', body as unknown as Record<string, unknown>);

  const config = c.env ? parseConfig(c.env) : undefined;
  if (!config?.auth?.magicLink?.enabled) {
    throw new EdgeBaseError(404, 'Magic link authentication is not enabled.', undefined, 'feature-not-enabled');
  }

  const autoCreate = config.auth.magicLink.autoCreate !== false; // default true

  // Look up email in D1
  const record = await lookupEmail(getAuthDb(c), body.email);

  const db = getAuthDb(c);
  let debugToken: string | undefined;
  let debugActionUrl: string | undefined;

  if (record) {
    // Existing user — send magic link directly via D1
    const { userId } = record;
    const user = await authService.getUserById(db, userId);
    if (!user) return c.json({ ok: true }); // Don't reveal details
    if (!user.email) return c.json({ ok: true });

    // Delete old magic-link tokens
    await authService.deleteEmailTokensByUserAndType(db, userId, 'magic-link');

    const magicLinkConfig = getMagicLinkConfig(c.env);
    const tokenTTL = magicLinkConfig?.tokenTTL ?? '15m';
    const ttlMs = parseTTLtoMs(tokenTTL);

    const token = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);
    await authService.createEmailToken(db, {
      token,
      userId,
      type: 'magic-link',
      expiresAt: expiresAt.toISOString(),
    });

    const provider = createEmailProvider(getEmailConfig(c.env), c.env);
    const emailCfg = getEmailConfig(c.env);
    const fallbackMagicLinkUrl = emailCfg?.magicLinkUrl
      ? emailCfg.magicLinkUrl.replace('{token}', token)
      : `#magic-link?token=${token}`;
    const magicLinkUrl = buildEmailActionUrl({
      redirectUrl: redirect.redirectUrl,
      fallbackUrl: fallbackMagicLinkUrl,
      token,
      type: 'magic-link',
      state: redirect.state,
    });
    if (!provider) {
      const release = config?.release ?? false;
      if (!release) {
        console.warn('[MagicLink] Email provider not configured. Token:', token);
        debugToken = token;
        debugActionUrl = magicLinkUrl;
      }
    } else {
      const locale = resolveEmailLocale(c.env, user.locale as string | null, parseAcceptLanguage(c.req.header('accept-language')));
      const html = renderMagicLink({
        appName: getAppName(c.env),
        magicLinkUrl,
        expiresInMinutes: Math.round(ttlMs / 60000),
      }, resolveLocalizedString(getEmailTemplates(c.env)?.magicLink, locale), locale);

      const defaultSubject = getDefaultSubject(locale, 'magicLink').replace(/\{\{appName\}\}/g, getAppName(c.env));
      await sendMailWithHook(
        c.env, c.executionCtx, provider, 'magicLink', user.email as string,
        resolveSubject(c.env, 'magicLink', defaultSubject, locale), html, locale,
      );
    }
  } else if (autoCreate) {
    // Auto-create user + send magic link
    const userId = generateId();

    try {
      await registerEmailPending(db, body.email, userId);
    } catch (err) {
      if ((err as Error).message === 'EMAIL_ALREADY_REGISTERED') {
        return c.json({ ok: true });
      }
      throw new EdgeBaseError(500, 'Magic link request failed.', undefined, 'internal-error');
    }

    try {
      // Create user with no password, verified = 1
      const reqLocale = parseAcceptLanguage(c.req.header('accept-language'));
      await authService.createUser(db, {
        userId,
        email: body.email,
        passwordHash: '',
        emailVisibility: 'private',
        role: 'user',
        verified: true,
        locale: reqLocale ?? 'en',
      });

      // beforeSignUp hook
      await executeAuthHook(c.env, c.executionCtx, 'beforeSignUp', {
        id: userId, email: body.email, displayName: null, avatarUrl: null,
      }, { blocking: true, workerUrl: getWorkerUrl(c.req.url, c.env) });

      // Sync to _users_public
      const user = await authService.getUserById(db, userId);
      if (user) {
        syncUserPublic(c.env, c.executionCtx, userId, authService.buildPublicUserData(user));
        c.executionCtx.waitUntil(
          executeAuthHook(c.env, c.executionCtx, 'afterSignUp', authService.sanitizeUser(user), { workerUrl: getWorkerUrl(c.req.url, c.env) }).catch(() => {}),
        );
      }

      await confirmEmail(db, body.email, userId);

      // Send magic link token
      const magicLinkConfig = getMagicLinkConfig(c.env);
      const tokenTTL = magicLinkConfig?.tokenTTL ?? '15m';
      const ttlMs = parseTTLtoMs(tokenTTL);

      const token = crypto.randomUUID();
      const tokenNow = new Date();
      const expiresAt = new Date(tokenNow.getTime() + ttlMs);
      await authService.createEmailToken(db, {
        token,
        userId,
        type: 'magic-link',
        expiresAt: expiresAt.toISOString(),
      });

      const provider = createEmailProvider(getEmailConfig(c.env), c.env);
      const emailCfg = getEmailConfig(c.env);
      const fallbackMagicLinkUrl = emailCfg?.magicLinkUrl
        ? emailCfg.magicLinkUrl.replace('{token}', token)
        : `#magic-link?token=${token}`;
      const magicLinkUrl = buildEmailActionUrl({
        redirectUrl: redirect.redirectUrl,
        fallbackUrl: fallbackMagicLinkUrl,
        token,
        type: 'magic-link',
        state: redirect.state,
      });
      if (provider) {
        const locale = resolveEmailLocale(c.env, reqLocale);
        const html = renderMagicLink({
          appName: getAppName(c.env),
          magicLinkUrl,
          expiresInMinutes: Math.round(ttlMs / 60000),
        }, resolveLocalizedString(getEmailTemplates(c.env)?.magicLink, locale), locale);

        const defaultSubject = getDefaultSubject(locale, 'magicLink').replace(/\{\{appName\}\}/g, getAppName(c.env));
        await sendMailWithHook(
          c.env, c.executionCtx, provider, 'magicLink', body.email,
          resolveSubject(c.env, 'magicLink', defaultSubject, locale), html, locale,
        ).catch(() => {});
      } else {
        const release = config?.release ?? false;
        if (!release) {
          debugToken = token;
          debugActionUrl = magicLinkUrl;
        }
      }
    } catch (err) {
      if (err instanceof EdgeBaseError) throw err;
      await deleteEmailPending(db, body.email).catch(() => {});
      return c.json({ ok: true });
    }
  }
  // else: !autoCreate && !record → return ok (don't reveal email existence)

  return c.json(debugToken
    ? { ok: true, token: debugToken, actionUrl: debugActionUrl }
    : { ok: true });
});

const verifyMagicLink = createRoute({
  operationId: 'authVerifyMagicLink',
  method: 'post',
  path: '/verify-magic-link',
  tags: ['client'],
  summary: 'Verify magic link token',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      token: z.string(),
    }).passthrough() } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Invalid or expired token', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(verifyMagicLink, async (c) => {
  const body = await c.req.json<{ token: string }>();
  if (!body.token) throw new EdgeBaseError(400, 'Magic link token is required.', undefined, 'invalid-input');

  await ensureAuthActionAllowed(c, 'verifyMagicLink', body as unknown as Record<string, unknown>);

  const db = getAuthDb(c);
  const ip = getClientIP(c.env, c.req.raw);

  // Look up token directly in D1
  const tokenRow = await authService.getEmailToken(db, body.token);
  if (!tokenRow || tokenRow.type !== 'magic-link') {
    throw new EdgeBaseError(400, 'Invalid or expired magic link token.', undefined, 'invalid-token');
  }

  if (new Date(tokenRow.expiresAt as string) < new Date()) {
    await authService.deleteEmailToken(db, body.token);
    throw new EdgeBaseError(400, 'Magic link has expired. Please request a new one.', undefined, 'token-expired');
  }

  const userId = tokenRow.userId as string;
  const user = await authService.getUserById(db, userId);
  if (!user) throw new EdgeBaseError(404, 'User not found.', undefined, 'user-not-found');

  // Disabled user check
  if (user.disabled === 1) {
    throw new EdgeBaseError(403, 'This account has been disabled.', undefined, 'account-disabled');
  }

  // Mark email as verified if not already
  if (!user.verified) {
    await authService.updateUser(db, userId, { verified: true });
  }

  // beforeSignIn hook
  await executeAuthHook(c.env, c.executionCtx, 'beforeSignIn', authService.sanitizeUser(user), { blocking: true, workerUrl: getWorkerUrl(c.req.url, c.env) });

  // Delete the token (single-use)
  await authService.deleteEmailToken(db, body.token);

  // Lazy cleanup of expired sessions
  await authService.cleanExpiredSessionsForUser(db, userId);

  // Create session
  const session = await createSessionAndTokens(c.env, userId, ip, c.req.header('user-agent') || '');

  // Re-read user (verified flag may have been updated)
  const updatedUser = await authService.getUserById(db, userId) || user;

  // afterSignIn hook — non-blocking
  c.executionCtx.waitUntil(
    executeAuthHook(c.env, c.executionCtx, 'afterSignIn', authService.sanitizeUser(updatedUser), { workerUrl: getWorkerUrl(c.req.url, c.env) }).catch(() => {}),
  );

  return c.json({
    user: authService.sanitizeUser(updatedUser),
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
  });
});

// ─── Phone/SMS OTP Routes ───

/**
 * E.164 phone number normalization.
 * Strips whitespace, dashes, parentheses. Must start with '+'.
 */
function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/[\s\-()]/g, '');
  if (!/^\+[1-9]\d{6,14}$/.test(cleaned)) {
    throw new EdgeBaseError(400, 'Invalid phone number. Must be in E.164 format (e.g. +15551234567).', undefined, 'invalid-phone');
  }
  return cleaned;
}

function getPhoneAuthEnabled(env: Env): boolean {
  try {
    const config = parseConfig(env);
    return !!config?.auth?.phoneAuth;
  } catch {
    return false;
  }
}

// POST /signin/phone — send OTP SMS
const signinPhone = createRoute({
  operationId: 'authSigninPhone',
  method: 'post',
  path: '/signin/phone',
  tags: ['client'],
  summary: 'Send OTP SMS to phone number',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      phone: z.string(),
    }).passthrough() } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Phone auth not enabled', content: { 'application/json': { schema: errorResponseSchema } } },
    429: { description: 'Too many requests', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(signinPhone, async (c) => {
  if (!getPhoneAuthEnabled(c.env)) {
    throw new EdgeBaseError(404, 'Phone authentication is not enabled.', undefined, 'feature-not-enabled');
  }

  const body = await c.req.json<{ phone: string }>();
  if (!body.phone) throw new EdgeBaseError(400, 'Phone number is required.', undefined, 'invalid-input');
  const phone = normalizePhone(body.phone);

  await ensureAuthActionAllowed(c, 'signInPhone', { phone });

  // Rate limit per phone: max 5 OTPs per hour
  const phoneRateKey = `phone-rate:${phone}`;
  if (!counter.check(phoneRateKey, 5, 3600)) {
    throw new EdgeBaseError(429, 'Too many OTP requests for this phone number. Try again later.', undefined, 'rate-limited');
  }

  // Look up phone in D1
  const record = await lookupPhone(getAuthDb(c), phone);

  let devCode: string | undefined;

  const db = getAuthDb(c);

  if (record) {
    // Existing user — send OTP directly
    const { userId } = record;
    const user = await authService.getUserById(db, userId);
    if (!user) return c.json({ ok: true });

    const code = generateOTP();

    // Store OTP in KV with 5 min TTL
    await c.env.KV.put(
      `phone-otp:${phone}`,
      JSON.stringify({ code, userId, attempts: 0 }),
      { expirationTtl: 300 },
    );

    // Send SMS
    const smsProvider = createSmsProvider(getSmsConfig(c.env), c.env);
    if (smsProvider) {
      const appName = getAppName(c.env);
      await sendSmsWithHook(
        c.env,
        c.executionCtx,
        smsProvider,
        'phoneOtp',
        phone,
        `Your ${appName} verification code is: ${code}. Valid for 5 minutes.`,
      );
    } else {
      const release = parseConfig(c.env)?.release ?? false;
      if (!release) {
        console.warn('[Phone] SMS provider not configured. OTP:', code);
        devCode = code;
      }
    }
  } else {
    // New user — auto-create
    const userId = generateId();

    try {
      await registerPhonePending(db, phone, userId);
    } catch (err) {
      if ((err as Error).message === 'PHONE_ALREADY_REGISTERED') {
        return c.json({ ok: true });
      }
      throw new EdgeBaseError(500, 'Phone OTP request failed.', undefined, 'internal-error');
    }

    try {
      // Create user with phone in D1
      await authService.createUser(db, {
        userId,
        email: null,
        passwordHash: '',
        role: 'user',
        verified: true,
      });
      await authService.updateUser(db, userId, { phone, phoneVerified: false });

      const code = generateOTP();

      // Store OTP in KV
      await c.env.KV.put(
        `phone-otp:${phone}`,
        JSON.stringify({ code, userId, attempts: 0 }),
        { expirationTtl: 300 },
      );

      // Send SMS
      const smsProvider = createSmsProvider(getSmsConfig(c.env), c.env);
      if (smsProvider) {
        const appName = getAppName(c.env);
        await sendSmsWithHook(
          c.env,
          c.executionCtx,
          smsProvider,
          'phoneOtp',
          phone,
          `Your ${appName} verification code is: ${code}. Valid for 5 minutes.`,
        );
      } else {
        const release = parseConfig(c.env)?.release ?? false;
        if (!release) {
          console.warn('[Phone] SMS provider not configured. OTP:', code);
          devCode = code;
        }
      }

      await confirmPhone(db, phone, userId);
    } catch (err) {
      if (err instanceof EdgeBaseError) throw err;
      return c.json({ ok: true });
    }
  }

  // Return OTP code only in dev mode (SMS provider not configured) for testing
  const release = parseConfig(c.env)?.release ?? false;
  return c.json(devCode && !release ? { ok: true, code: devCode } : { ok: true });
});

// POST /verify-phone — verify OTP → create session
const verifyPhone = createRoute({
  operationId: 'authVerifyPhone',
  method: 'post',
  path: '/verify-phone',
  tags: ['client'],
  summary: 'Verify phone OTP and create session',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      phone: z.string(),
      code: z.string(),
    }).passthrough() } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Invalid or expired OTP', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Invalid OTP code', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Phone auth not enabled', content: { 'application/json': { schema: errorResponseSchema } } },
    429: { description: 'Too many attempts', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(verifyPhone, async (c) => {
  if (!getPhoneAuthEnabled(c.env)) {
    throw new EdgeBaseError(404, 'Phone authentication is not enabled.', undefined, 'feature-not-enabled');
  }

  const body = await c.req.json<{ phone: string; code: string }>();
  if (!body.phone || !body.code) {
    throw new EdgeBaseError(400, 'Phone number and OTP code are required.', undefined, 'invalid-input');
  }
  const phone = normalizePhone(body.phone);

  await ensureAuthActionAllowed(c, 'verifyPhoneOtp', {
    phone,
    code: body.code,
  });

  // Look up phone → userId via KV OTP data
  const otpData = await c.env.KV.get(`phone-otp:${phone}`, 'json') as {
    code: string; userId: string; attempts: number;
  } | null;

  if (!otpData) {
    throw new EdgeBaseError(400, 'Invalid or expired OTP. Please request a new code.', undefined, 'invalid-token');
  }

  // Check attempts (max 5)
  if (otpData.attempts >= 5) {
    await c.env.KV.delete(`phone-otp:${phone}`).catch(() => {});
    throw new EdgeBaseError(429, 'Too many failed OTP attempts. Please request a new code.', undefined, 'rate-limited');
  }

  // Verify code (timing-safe comparison)
  if (!timingSafeEqual(otpData.code, body.code)) {
    await c.env.KV.put(
      `phone-otp:${phone}`,
      JSON.stringify({ ...otpData, attempts: otpData.attempts + 1 }),
      { expirationTtl: 300 },
    ).catch(() => {});
    throw new EdgeBaseError(401, 'Invalid OTP code.', undefined, 'invalid-otp');
  }

  // OTP valid — delete it (single-use)
  await c.env.KV.delete(`phone-otp:${phone}`).catch(() => {});

  const { userId } = otpData;
  const ip = getClientIP(c.env, c.req.raw);
  const db = getAuthDb(c);

  const user = await authService.getUserById(db, userId);
  if (!user) throw new EdgeBaseError(404, 'User not found.', undefined, 'user-not-found');

  // Disabled user check
  if (user.disabled === 1) {
    throw new EdgeBaseError(403, 'This account has been disabled.', undefined, 'account-disabled');
  }

  // Mark phone as verified if not already
  if (user.phoneVerified !== 1) {
    await authService.updateUser(db, userId, { phoneVerified: true });
  }

  // beforeSignIn hook
  await executeAuthHook(c.env, c.executionCtx, 'beforeSignIn', authService.sanitizeUser(user), { blocking: true, workerUrl: getWorkerUrl(c.req.url, c.env) });

  // MFA Check
  const mfaConfig = getMfaConfig(c.env);
  if (mfaConfig?.totp) {
    const factors = await authService.listVerifiedMfaFactors(db, userId);
    if (factors.length > 0) {
      const mfaTicket = crypto.randomUUID();
      await c.env.KV.put(
        `mfa-ticket:${mfaTicket}`,
        JSON.stringify({ userId }),
        { expirationTtl: 300 },
      );
      return c.json({
        mfaRequired: true,
        mfaTicket,
        factors: factors.map((f: Record<string, unknown>) => ({ id: f.id, type: f.type })),
      });
    }
  }

  // Create session
  const session = await createSessionAndTokens(c.env, userId, ip, c.req.header('user-agent') || '');

  // Re-fetch user after phoneVerified update
  const updatedUser = await authService.getUserById(db, userId) || user;

  // afterSignIn hook — non-blocking
  c.executionCtx.waitUntil(
    executeAuthHook(c.env, c.executionCtx, 'afterSignIn', authService.sanitizeUser(updatedUser), { workerUrl: getWorkerUrl(c.req.url, c.env) }).catch(() => {}),
  );

  return c.json({
    user: authService.sanitizeUser(updatedUser),
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
  });
});

// POST /link/phone — link phone to existing account (authenticated)
const linkPhone = createRoute({
  operationId: 'authLinkPhone',
  method: 'post',
  path: '/link/phone',
  tags: ['client'],
  summary: 'Link phone number to existing account',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      phone: z.string(),
    }).passthrough() } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Phone auth not enabled', content: { 'application/json': { schema: errorResponseSchema } } },
    409: { description: 'Phone already registered', content: { 'application/json': { schema: errorResponseSchema } } },
    429: { description: 'Too many requests', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(linkPhone, async (c) => {
  if (!getPhoneAuthEnabled(c.env)) {
    throw new EdgeBaseError(404, 'Phone authentication is not enabled.', undefined, 'feature-not-enabled');
  }

  const userId = requireAuth(c.get('auth'));
  const body = await c.req.json<{ phone: string }>();
  if (!body.phone) throw new EdgeBaseError(400, 'Phone number is required.', undefined, 'invalid-input');
  const phone = normalizePhone(body.phone);
  await ensureAuthActionAllowed(c, 'linkPhone', { phone, userId });
  const db = getAuthDb(c);

  // Rate limit per phone
  const phoneRateKey = `phone-rate:${phone}`;
  if (!counter.check(phoneRateKey, 5, 3600)) {
    throw new EdgeBaseError(429, 'Too many OTP requests. Try again later.', undefined, 'rate-limited');
  }

  // Check if phone is already registered
  const existing = await lookupPhone(db, phone);
  if (existing) {
    throw new EdgeBaseError(409, 'Phone number is already registered to another account.', undefined, 'phone-already-exists');
  }

  // Check if user already has a phone
  const user = await authService.getUserById(db, userId);
  if (!user) throw new EdgeBaseError(404, 'User not found.', undefined, 'user-not-found');
  if (user.phone) {
    throw new EdgeBaseError(409, 'User already has a phone number linked.', undefined, 'already-exists');
  }

  const code = generateOTP();

  // Store link OTP in KV (separate key pattern)
  await c.env.KV.put(
    `phone-link-otp:${phone}`,
    JSON.stringify({ code, userId, attempts: 0 }),
    { expirationTtl: 300 },
  );

  // Send SMS
  const smsProvider = createSmsProvider(getSmsConfig(c.env), c.env);
  if (smsProvider) {
    const appName = getAppName(c.env);
    await sendSmsWithHook(
      c.env,
      c.executionCtx,
      smsProvider,
      'phoneLink',
      phone,
      `Your ${appName} phone linking code is: ${code}. Valid for 5 minutes.`,
    );
    return c.json({ ok: true });
  } else {
    const release = parseConfig(c.env)?.release ?? false;
    if (!release) {
      console.warn('[Phone] SMS provider not configured. Link OTP:', code);
      return c.json({ ok: true, code });
    }
    return c.json({ ok: true });
  }
});

// POST /verify-link-phone — verify OTP and link phone to account (authenticated)
const verifyLinkPhone = createRoute({
  operationId: 'authVerifyLinkPhone',
  method: 'post',
  path: '/verify-link-phone',
  tags: ['client'],
  summary: 'Verify OTP and link phone to account',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      phone: z.string(),
      code: z.string(),
    }).passthrough() } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Invalid or expired OTP', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Invalid OTP code', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'OTP not issued for this user', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Phone auth not enabled', content: { 'application/json': { schema: errorResponseSchema } } },
    409: { description: 'Phone already registered', content: { 'application/json': { schema: errorResponseSchema } } },
    429: { description: 'Too many attempts', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(verifyLinkPhone, async (c) => {
  if (!getPhoneAuthEnabled(c.env)) {
    throw new EdgeBaseError(404, 'Phone authentication is not enabled.', undefined, 'feature-not-enabled');
  }

  const userId = requireAuth(c.get('auth'));
  const body = await c.req.json<{ phone: string; code: string }>();
  if (!body.phone || !body.code) {
    throw new EdgeBaseError(400, 'Phone number and OTP code are required.', undefined, 'invalid-input');
  }
  const phone = normalizePhone(body.phone);
  await ensureAuthActionAllowed(c, 'verifyLinkPhone', { phone, code: body.code, userId });
  const db = getAuthDb(c);

  // Verify OTP from KV
  const otpData = await c.env.KV.get(`phone-link-otp:${phone}`, 'json') as {
    code: string; userId: string; attempts: number;
  } | null;

  if (!otpData) {
    throw new EdgeBaseError(400, 'Invalid or expired OTP. Please request a new code.', undefined, 'invalid-token');
  }

  if (otpData.userId !== userId) {
    throw new EdgeBaseError(403, 'OTP was not issued for this user.', undefined, 'action-not-allowed');
  }

  if (otpData.attempts >= 5) {
    await c.env.KV.delete(`phone-link-otp:${phone}`).catch(() => {});
    throw new EdgeBaseError(429, 'Too many failed OTP attempts. Please request a new code.', undefined, 'rate-limited');
  }

  if (!timingSafeEqual(otpData.code, body.code)) {
    await c.env.KV.put(
      `phone-link-otp:${phone}`,
      JSON.stringify({ ...otpData, attempts: otpData.attempts + 1 }),
      { expirationTtl: 300 },
    ).catch(() => {});
    throw new EdgeBaseError(401, 'Invalid OTP code.', undefined, 'invalid-otp');
  }

  // OTP valid — delete it
  await c.env.KV.delete(`phone-link-otp:${phone}`).catch(() => {});

  // Register phone in D1
  try {
    await registerPhonePending(db, phone, userId);
  } catch (err) {
    if ((err as Error).message === 'PHONE_ALREADY_REGISTERED') {
      throw new EdgeBaseError(409, 'Phone number is already registered.', undefined, 'phone-already-exists');
    }
    throw new EdgeBaseError(500, 'Phone linking failed.', undefined, 'internal-error');
  }

  // Update user record directly in D1
  await authService.updateUser(db, userId, { phone, phoneVerified: true, isAnonymous: false });

  // Confirm in D1
  await confirmPhone(db, phone, userId);

  // Delete anon index if exists (upgrade path)
  await deleteAnon(db, userId).catch(() => {});

  return c.json({ ok: true });
});

// ─── Email OTP Routes ───

function getEmailOtpEnabled(env: Env): boolean {
  try {
    const config = parseConfig(env);
    return !!config?.auth?.emailOtp?.enabled;
  } catch {
    return false;
  }
}

// POST /signin/email-otp — send OTP code to email
const signinEmailOtp = createRoute({
  operationId: 'authSigninEmailOtp',
  method: 'post',
  path: '/signin/email-otp',
  tags: ['client'],
  summary: 'Send OTP code to email',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      email: z.string(),
    }).passthrough() } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Email OTP not enabled', content: { 'application/json': { schema: errorResponseSchema } } },
    429: { description: 'Too many requests', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(signinEmailOtp, async (c) => {
  if (!getEmailOtpEnabled(c.env)) {
    throw new EdgeBaseError(404, 'Email OTP authentication is not enabled.', undefined, 'feature-not-enabled');
  }

  const body = await c.req.json<{ email: string }>();
  if (!body.email) throw new EdgeBaseError(400, 'Email is required.', undefined, 'invalid-input');
  const email = body.email.trim().toLowerCase();

  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new EdgeBaseError(400, 'Invalid email format.', undefined, 'invalid-email');
  }

  await ensureAuthActionAllowed(c, 'signInEmailOtp', { email });

  // Rate limit per email: max 5 OTPs per hour
  const emailRateKey = `email-otp-rate:${email}`;
  if (!counter.check(emailRateKey, 5, 3600)) {
    throw new EdgeBaseError(429, 'Too many OTP requests for this email. Try again later.', undefined, 'rate-limited');
  }

  // Look up email in D1
  const record = await lookupEmail(getAuthDb(c), email);

  let devCode: string | undefined;

  const db = getAuthDb(c);

  if (record) {
    // Existing user — send OTP directly
    const { userId } = record;
    const user = await authService.getUserById(db, userId);
    if (!user) return c.json({ ok: true });

    const code = generateOTP();

    // Store OTP in KV with 5 min TTL
    await c.env.KV.put(
      `email-otp:${email}`,
      JSON.stringify({ code, userId, attempts: 0 }),
      { expirationTtl: 300 },
    );

    // Send email
    const emailProvider = createEmailProvider(getEmailConfig(c.env), c.env);
    if (emailProvider) {
      const appName = getAppName(c.env);
      const locale = resolveEmailLocale(c.env, user.locale as string | null, parseAcceptLanguage(c.req.header('accept-language')));
      const html = renderEmailOtp({ appName, code, expiresInMinutes: 5 }, resolveLocalizedString(getEmailTemplates(c.env)?.emailOtp, locale), locale);
      const defaultSubject = getDefaultSubject(locale, 'emailOtp').replace(/\{\{appName\}\}/g, appName);
      await sendMailWithHook(
        c.env, c.executionCtx, emailProvider, 'emailOtp', email,
        resolveSubject(c.env, 'emailOtp', defaultSubject, locale), html, locale,
      );
    } else {
      const release = parseConfig(c.env)?.release ?? false;
      if (!release) {
        console.warn('[EmailOTP] Email provider not configured. OTP:', code);
        devCode = code;
      }
    }
  } else {
    // New user — auto-create if enabled
    const config = parseConfig(c.env);
    const autoCreate = config?.auth?.emailOtp?.autoCreate !== false;
    if (!autoCreate) {
      return c.json({ ok: true });
    }

    const userId = generateId();

    try {
      await registerEmailPending(db, email, userId);
    } catch (err) {
      if ((err as Error).message === 'EMAIL_ALREADY_REGISTERED') {
        return c.json({ ok: true });
      }
      throw new EdgeBaseError(500, 'Email OTP request failed.', undefined, 'internal-error');
    }

    try {
      // Create user with email, verified = 1
      const otpReqLocale = parseAcceptLanguage(c.req.header('accept-language'));
      await authService.createUser(db, {
        userId,
        email,
        passwordHash: '',
        role: 'user',
        verified: true,
        locale: otpReqLocale ?? 'en',
      });

      const code = generateOTP();

      // Store OTP in KV
      await c.env.KV.put(
        `email-otp:${email}`,
        JSON.stringify({ code, userId, attempts: 0 }),
        { expirationTtl: 300 },
      );

      // Send email
      const emailProvider = createEmailProvider(getEmailConfig(c.env), c.env);
      if (emailProvider) {
        const appName = getAppName(c.env);
        const locale = resolveEmailLocale(c.env, otpReqLocale);
        const html = renderEmailOtp({ appName, code, expiresInMinutes: 5 }, resolveLocalizedString(getEmailTemplates(c.env)?.emailOtp, locale), locale);
        const defaultSubject = getDefaultSubject(locale, 'emailOtp').replace(/\{\{appName\}\}/g, appName);
        await sendMailWithHook(
          c.env, c.executionCtx, emailProvider, 'emailOtp', email,
          resolveSubject(c.env, 'emailOtp', defaultSubject, locale), html, locale,
        );
      } else {
        const release = parseConfig(c.env)?.release ?? false;
        if (!release) {
          console.warn('[EmailOTP] Email provider not configured. OTP:', code);
          devCode = code;
        }
      }

      await confirmEmail(db, email, userId);
    } catch (err) {
      if (err instanceof EdgeBaseError) throw err;
      return c.json({ ok: true });
    }
  }

  // Return OTP code only in dev mode (email provider not configured) for testing
  const release = parseConfig(c.env)?.release ?? false;
  return c.json(devCode && !release ? { ok: true, code: devCode } : { ok: true });
});

// POST /verify-email-otp — verify OTP → create session
const verifyEmailOtp = createRoute({
  operationId: 'authVerifyEmailOtp',
  method: 'post',
  path: '/verify-email-otp',
  tags: ['client'],
  summary: 'Verify email OTP and create session',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      email: z.string(),
      code: z.string(),
    }).passthrough() } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Invalid or expired OTP', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Invalid OTP code', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Email OTP not enabled', content: { 'application/json': { schema: errorResponseSchema } } },
    429: { description: 'Too many attempts', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(verifyEmailOtp, async (c) => {
  if (!getEmailOtpEnabled(c.env)) {
    throw new EdgeBaseError(404, 'Email OTP authentication is not enabled.', undefined, 'feature-not-enabled');
  }

  const body = await c.req.json<{ email: string; code: string }>();
  if (!body.email || !body.code) {
    throw new EdgeBaseError(400, 'Email and OTP code are required.', undefined, 'invalid-input');
  }
  const email = body.email.trim().toLowerCase();

  await ensureAuthActionAllowed(c, 'verifyEmailOtp', {
    email,
    code: body.code,
  });

  // Look up OTP data from KV
  const otpData = await c.env.KV.get(`email-otp:${email}`, 'json') as {
    code: string; userId: string; attempts: number;
  } | null;

  if (!otpData) {
    throw new EdgeBaseError(400, 'Invalid or expired OTP. Please request a new code.', undefined, 'invalid-token');
  }

  if (otpData.attempts >= 5) {
    await c.env.KV.delete(`email-otp:${email}`).catch(() => {});
    throw new EdgeBaseError(429, 'Too many failed OTP attempts. Please request a new code.', undefined, 'rate-limited');
  }

  if (!timingSafeEqual(otpData.code, body.code)) {
    await c.env.KV.put(
      `email-otp:${email}`,
      JSON.stringify({ ...otpData, attempts: otpData.attempts + 1 }),
      { expirationTtl: 300 },
    ).catch(() => {});
    throw new EdgeBaseError(401, 'Invalid OTP code.', undefined, 'invalid-otp');
  }

  // OTP valid — delete it (single-use)
  await c.env.KV.delete(`email-otp:${email}`).catch(() => {});

  const { userId } = otpData;
  const ip = getClientIP(c.env, c.req.raw);
  const db = getAuthDb(c);

  const user = await authService.getUserById(db, userId);
  if (!user) throw new EdgeBaseError(404, 'User not found.', undefined, 'user-not-found');

  // Disabled user check
  if (user.disabled === 1) {
    throw new EdgeBaseError(403, 'This account has been disabled.', undefined, 'account-disabled');
  }

  // beforeSignIn hook
  await executeAuthHook(c.env, c.executionCtx, 'beforeSignIn', authService.sanitizeUser(user), { blocking: true, workerUrl: getWorkerUrl(c.req.url, c.env) });

  // MFA Check
  const mfaConfig = getMfaConfig(c.env);
  if (mfaConfig?.totp) {
    const factors = await authService.listVerifiedMfaFactors(db, userId);
    if (factors.length > 0) {
      const mfaTicket = crypto.randomUUID();
      await c.env.KV.put(
        `mfa-ticket:${mfaTicket}`,
        JSON.stringify({ userId }),
        { expirationTtl: 300 },
      );
      return c.json({
        mfaRequired: true,
        mfaTicket,
        factors: factors.map((f: Record<string, unknown>) => ({ id: f.id, type: f.type })),
      });
    }
  }

  // Create session
  const session = await createSessionAndTokens(c.env, userId, ip, c.req.header('user-agent') || '');

  // afterSignIn hook — non-blocking
  c.executionCtx.waitUntil(
    executeAuthHook(c.env, c.executionCtx, 'afterSignIn', authService.sanitizeUser(user), { workerUrl: getWorkerUrl(c.req.url, c.env) }).catch(() => {}),
  );

  return c.json({
    user: authService.sanitizeUser(user),
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
  });
});

// ─── MFA/TOTP Routes ───

// POST /mfa/totp/enroll — enroll new TOTP factor (authenticated)
const mfaTotpEnroll = createRoute({
  operationId: 'authMfaTotpEnroll',
  method: 'post',
  path: '/mfa/totp/enroll',
  tags: ['client'],
  summary: 'Enroll new TOTP factor',
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(mfaTotpEnroll, async (c) => {
  const userId = requireAuth(c.get('auth'));
  await ensureAuthActionAllowed(c, 'mfaTotpEnroll', { userId });
  const db = getAuthDb(c);

  const mfaCfg = getMfaConfig(c.env);
  if (!mfaCfg?.totp) throw new EdgeBaseError(404, 'TOTP MFA is not enabled.', undefined, 'feature-not-enabled');

  // Check if user already has a verified TOTP factor
  const existing = await authService.getMfaFactorByUser(db, userId, 'totp');
  if (existing && existing.verified) {
    throw new EdgeBaseError(409, 'TOTP factor already enrolled. Disable it first to re-enroll.', undefined, 'mfa-already-enrolled');
  }

  // Delete any unverified (pending) factors
  await authService.deleteUnverifiedMfaFactors(db, userId, 'totp');

  // Generate TOTP secret
  const secret = generateTOTPSecret();
  const encryptedSecret = await encryptSecret(secret, getUserSecret(c.env));

  // Get user email for QR code URI
  const user = await authService.getUserById(db, userId);
  if (!user) throw new EdgeBaseError(404, 'User not found.', undefined, 'user-not-found');

  const appName = getAppName(c.env);
  const qrCodeUri = generateTOTPUri(secret, (user.email as string) || userId, appName);

  // Create factor (unverified)
  const factorId = generateId();
  await authService.createMfaFactor(db, {
    id: factorId,
    userId,
    type: 'totp',
    secret: encryptedSecret,
  });

  // Generate recovery codes
  const recoveryCodes = generateRecoveryCodes(8);
  const hashedCodes: { id: string; codeHash: string }[] = [];
  for (const code of recoveryCodes) {
    hashedCodes.push({ id: generateId(), codeHash: await hashRecoveryCode(code) });
  }
  await authService.createRecoveryCodes(db, userId, hashedCodes);

  return c.json({
    factorId,
    secret,
    qrCodeUri,
    recoveryCodes,
  });
});

// POST /mfa/totp/verify — confirm TOTP enrollment (authenticated)
const mfaTotpVerify = createRoute({
  operationId: 'authMfaTotpVerify',
  method: 'post',
  path: '/mfa/totp/verify',
  tags: ['client'],
  summary: 'Confirm TOTP enrollment with code',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      factorId: z.string(),
      code: z.string(),
    }).passthrough() } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(mfaTotpVerify, async (c) => {
  const userId = requireAuth(c.get('auth'));
  const body = await c.req.json<{ factorId: string; code: string }>();
  if (!body.factorId || !body.code) {
    throw new EdgeBaseError(400, 'factorId and code are required.', undefined, 'invalid-input');
  }
  await ensureAuthActionAllowed(c, 'mfaTotpVerify', {
    factorId: body.factorId,
    code: body.code,
    userId,
  });
  const db = getAuthDb(c);

  const factor = await authService.getMfaFactorForUser(db, body.factorId, userId);
  if (!factor) throw new EdgeBaseError(404, 'TOTP factor not found.', undefined, 'not-found');
  if (factor.verified) throw new EdgeBaseError(400, 'TOTP factor is already verified.', undefined, 'mfa-already-enrolled');

  // Decrypt and verify TOTP code
  const secret = await decryptSecret(factor.secret as string, getUserSecret(c.env));
  const valid = await verifyTOTP(secret, body.code);
  if (!valid) throw new EdgeBaseError(400, 'Invalid TOTP code. Please try again.', undefined, 'invalid-totp');

  // Mark factor as verified
  await authService.verifyMfaFactor(db, body.factorId);

  return c.json({ ok: true });
});

// POST /mfa/verify — verify TOTP code during signin (mfaTicket-based)
const mfaVerify = createRoute({
  operationId: 'authMfaVerify',
  method: 'post',
  path: '/mfa/verify',
  tags: ['client'],
  summary: 'Verify MFA code during signin',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      mfaTicket: z.string(),
      code: z.string(),
    }).passthrough() } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Invalid or expired MFA ticket', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'MFA verification failed', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(mfaVerify, async (c) => {
  const body = await c.req.json<{ mfaTicket: string; code: string }>();
  if (!body.mfaTicket || !body.code) {
    throw new EdgeBaseError(400, 'mfaTicket and code are required.', undefined, 'invalid-input');
  }
  await ensureAuthActionAllowed(c, 'mfaVerify', {
    mfaTicket: body.mfaTicket,
    code: body.code,
  });

  // Look up mfaTicket from KV
  const ticketData = await c.env.KV.get(`mfa-ticket:${body.mfaTicket}`, 'json') as {
    userId: string;
  } | null;

  if (!ticketData) {
    throw new EdgeBaseError(400, 'Invalid or expired MFA ticket.', undefined, 'invalid-token');
  }

  const { userId } = ticketData;
  const ip = getClientIP(c.env, c.req.raw);
  const db = getAuthDb(c);

  // Get verified TOTP factor
  const factor = await authService.getMfaFactorByUser(db, userId, 'totp');
  if (!factor || !factor.verified) throw new EdgeBaseError(400, 'No verified TOTP factor found.', undefined, 'invalid-input');

  // Disabled check
  const user = await authService.getUserById(db, userId);
  if (!user) throw new EdgeBaseError(404, 'User not found.', undefined, 'user-not-found');
  if (user.disabled === 1) {
    throw new EdgeBaseError(403, 'Account is disabled.', undefined, 'account-disabled');
  }

  // Decrypt and verify
  const secret = await decryptSecret(factor.secret as string, getUserSecret(c.env));
  const valid = await verifyTOTP(secret, body.code);
  if (!valid) throw new EdgeBaseError(401, 'Invalid TOTP code.', undefined, 'invalid-totp');

  // Delete mfaTicket (single-use)
  await c.env.KV.delete(`mfa-ticket:${body.mfaTicket}`).catch(() => {});

  // MFA passed — create session
  await authService.cleanExpiredSessionsForUser(db, userId);
  const session = await createSessionAndTokens(c.env, userId, ip, c.req.header('user-agent') || '');

  // afterSignIn hook — non-blocking
  c.executionCtx.waitUntil(
    executeAuthHook(c.env, c.executionCtx, 'afterSignIn', authService.sanitizeUser(user), { workerUrl: getWorkerUrl(c.req.url, c.env) }).catch(() => {}),
  );

  return c.json({
    user: authService.sanitizeUser(user),
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
  });
});

// POST /mfa/recovery — use recovery code during signin (mfaTicket-based)
const mfaRecovery = createRoute({
  operationId: 'authMfaRecovery',
  method: 'post',
  path: '/mfa/recovery',
  tags: ['client'],
  summary: 'Use recovery code during MFA signin',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      mfaTicket: z.string(),
      recoveryCode: z.string(),
    }).passthrough() } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Invalid or expired MFA ticket', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Recovery code verification failed', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(mfaRecovery, async (c) => {
  const body = await c.req.json<{ mfaTicket: string; recoveryCode: string }>();
  if (!body.mfaTicket || !body.recoveryCode) {
    throw new EdgeBaseError(400, 'mfaTicket and recoveryCode are required.', undefined, 'invalid-input');
  }
  await ensureAuthActionAllowed(c, 'mfaRecovery', {
    mfaTicket: body.mfaTicket,
    recoveryCode: body.recoveryCode,
  });

  // Look up mfaTicket from KV
  const ticketData = await c.env.KV.get(`mfa-ticket:${body.mfaTicket}`, 'json') as {
    userId: string;
  } | null;

  if (!ticketData) {
    throw new EdgeBaseError(400, 'Invalid or expired MFA ticket.', undefined, 'invalid-token');
  }

  const { userId } = ticketData;
  const ip = getClientIP(c.env, c.req.raw);
  const db = getAuthDb(c);

  // Disabled check
  const user = await authService.getUserById(db, userId);
  if (!user) throw new EdgeBaseError(404, 'User not found.', undefined, 'user-not-found');
  if (user.disabled === 1) {
    throw new EdgeBaseError(403, 'Account is disabled.', undefined, 'account-disabled');
  }

  // Find unused recovery codes for this user
  const codes = await authService.listRecoveryCodes(db, userId);
  if (codes.length === 0) {
    throw new EdgeBaseError(400, 'No recovery codes available.', undefined, 'invalid-input');
  }

  // Check each code (hash comparison)
  let matchedCodeId: string | null = null;
  for (const codeRow of codes) {
    const valid = await verifyRecoveryCode(body.recoveryCode, codeRow.codeHash as string);
    if (valid) {
      matchedCodeId = codeRow.id as string;
      break;
    }
  }

  if (!matchedCodeId) {
    throw new EdgeBaseError(401, 'Invalid recovery code.', undefined, 'invalid-recovery-code');
  }

  // Mark recovery code as used (single-use)
  await authService.useRecoveryCode(db, matchedCodeId);

  // Delete mfaTicket (single-use)
  await c.env.KV.delete(`mfa-ticket:${body.mfaTicket}`).catch(() => {});

  // MFA passed — create session
  await authService.cleanExpiredSessionsForUser(db, userId);
  const session = await createSessionAndTokens(c.env, userId, ip, c.req.header('user-agent') || '');

  // afterSignIn hook — non-blocking
  c.executionCtx.waitUntil(
    executeAuthHook(c.env, c.executionCtx, 'afterSignIn', authService.sanitizeUser(user), { workerUrl: getWorkerUrl(c.req.url, c.env) }).catch(() => {}),
  );

  return c.json({
    user: authService.sanitizeUser(user),
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
  });
});

// DELETE /mfa/totp — disable TOTP (authenticated)
const mfaTotpDelete = createRoute({
  operationId: 'authMfaTotpDelete',
  method: 'delete',
  path: '/mfa/totp',
  tags: ['client'],
  summary: 'Disable TOTP factor',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      password: z.string().optional(),
      code: z.string().optional(),
    }).passthrough() } }, required: false },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(mfaTotpDelete, async (c) => {
  const userId = requireAuth(c.get('auth'));
  const bodyText = await c.req.text();
  let body: { password?: string; code?: string } = {};
  try { body = JSON.parse(bodyText); } catch { /* empty body OK */ }
  await ensureAuthActionAllowed(c, 'mfaTotpDelete', {
    userId,
    passwordProvided: !!body.password,
    codeProvided: !!body.code,
  });
  const db = getAuthDb(c);

  // Verify identity: require either password or TOTP code
  const user = await authService.getUserById(db, userId);
  if (!user) throw new EdgeBaseError(404, 'User not found.', undefined, 'user-not-found');

  if (body.password) {
    if (!user.passwordHash) throw new EdgeBaseError(400, 'This account has no password set.', undefined, 'invalid-input');
    const valid = await verifyPassword(body.password, user.passwordHash as string);
    if (!valid) throw new EdgeBaseError(401, 'Invalid password.', undefined, 'invalid-password');
  } else if (body.code) {
    const factor = await authService.getMfaFactorByUser(db, userId, 'totp');
    if (!factor || !factor.verified) throw new EdgeBaseError(400, 'No TOTP factor found.', undefined, 'invalid-input');
    const secret = await decryptSecret(factor.secret as string, getUserSecret(c.env));
    const valid = await verifyTOTP(secret, body.code);
    if (!valid) throw new EdgeBaseError(401, 'Invalid TOTP code.', undefined, 'invalid-totp');
  } else {
    throw new EdgeBaseError(400, 'Either password or TOTP code is required to disable MFA.', undefined, 'invalid-input');
  }

  // Delete all MFA factors and recovery codes
  await authService.disableMfa(db, userId);

  return c.json({ ok: true });
});

// GET /mfa/factors — list user's MFA factors (authenticated)
const mfaFactors = createRoute({
  operationId: 'authMfaFactors',
  method: 'get',
  path: '/mfa/factors',
  tags: ['client'],
  summary: 'List MFA factors for authenticated user',
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(mfaFactors, async (c) => {
  const userId = requireAuth(c.get('auth'));
  await ensureAuthActionAllowed(c, 'mfaFactors', { userId });
  const db = getAuthDb(c);

  const factors = await authService.listMfaFactors(db, userId);

  return c.json({
    factors: factors.map((f) => ({
      id: f.id,
      type: f.type,
      verified: f.verified,
      createdAt: f.createdAt,
    })),
  });
});

// ─── Shard-routed routes (Refresh Token in body) ───

const refresh = createRoute({
  operationId: 'authRefresh',
  method: 'post',
  path: '/refresh',
  tags: ['client'],
  summary: 'Refresh access token',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      refreshToken: z.string(),
    }).passthrough() } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Invalid refresh token', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(refresh, async (c) => {
  const bodyText = await c.req.text();
  let body: { refreshToken?: string };
  try { body = JSON.parse(bodyText); } catch { throw new EdgeBaseError(400, 'Invalid JSON.', undefined, 'invalid-json'); }
  if (!body.refreshToken) throw new EdgeBaseError(400, 'Refresh token is required.', undefined, 'invalid-input');

  await ensureAuthActionAllowed(c, 'refresh', {
    refreshToken: body.refreshToken,
  });

  const db = getAuthDb(c);
  const GRACE_PERIOD_SECONDS = 30;

  // Verify the refresh token signature
  let tokenPayload;
  try {
    tokenPayload = await verifyRefreshTokenWithFallback(
      body.refreshToken,
      getUserSecret(c.env),
      c.env.JWT_USER_SECRET_OLD,
      c.env.JWT_USER_SECRET_OLD_AT,
    );
  } catch (err) {
    if (err instanceof TokenExpiredError) {
      throw new EdgeBaseError(401, 'Refresh token expired.', undefined, 'refresh-token-expired');
    }
    throw new EdgeBaseError(401, 'Invalid refresh token.', undefined, 'invalid-refresh-token');
  }

  const userId = tokenPayload.sub;

  // Use getSessionByRefreshToken which checks both current and previous tokens
  const result = await authService.getSessionByRefreshToken(db, body.refreshToken, userId);

  if (!result) {
    throw new EdgeBaseError(401, 'Invalid refresh token.', undefined, 'invalid-refresh-token');
  }

  const { session, matchType } = result;

  if (matchType === 'current') {
    // Normal rotation
    return c.json(await rotateRefreshTokenFlow(c.env, c.executionCtx, session, userId, getWorkerUrl(c.req.url, c.env)));
  }

  // matchType === 'previous' — Grace Period check
  const rotatedAt = session.rotatedAt as string;
  const rotatedTime = new Date(rotatedAt).getTime();
  const gracePeriodMs = GRACE_PERIOD_SECONDS * 1000;

  if (Date.now() - rotatedTime <= gracePeriodMs) {
    // Within grace period — return current tokens without re-rotation
    const user = await authService.getUserById(db, userId);
    if (!user) throw new EdgeBaseError(401, 'User not found.', undefined, 'invalid-credentials');
    return c.json({
      user: authService.sanitizeUser(user),
      accessToken: await generateAccessToken(c.env, user),
      refreshToken: session.refreshToken as string,
    });
  }

  // Beyond grace period — token theft suspected! Revoke session
  await authService.deleteSession(db, session.id as string);
  throw new EdgeBaseError(401, 'Refresh token reuse detected. Session revoked.', undefined, 'refresh-token-reused');
});

const signout = createRoute({
  operationId: 'authSignout',
  method: 'post',
  path: '/signout',
  tags: ['client'],
  summary: 'Sign out and revoke refresh token',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      refreshToken: z.string(),
    }).passthrough() } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Invalid refresh token', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(signout, async (c) => {
  const bodyText = await c.req.text();
  let body: { refreshToken?: string };
  try { body = JSON.parse(bodyText); } catch { throw new EdgeBaseError(400, 'Invalid JSON.', undefined, 'invalid-json'); }
  if (!body.refreshToken) throw new EdgeBaseError(400, 'Refresh token is required.', undefined, 'invalid-input');

  await ensureAuthActionAllowed(c, 'signOut', {
    refreshToken: body.refreshToken,
  });

  const payload = decodeTokenUnsafe(body.refreshToken);
  if (!payload?.sub) throw new EdgeBaseError(401, 'Invalid refresh token.', undefined, 'invalid-refresh-token');

  const db = getAuthDb(c);
  const userId = payload.sub as string;

  // beforeSignOut hook — blocking
  await executeAuthHook(c.env, c.executionCtx, 'beforeSignOut', { userId }, { blocking: true, workerUrl: getWorkerUrl(c.req.url, c.env) });

  // Delete session by refreshToken
  await authService.deleteSessionByRefreshToken(db, body.refreshToken);

  // afterSignOut hook — non-blocking
  c.executionCtx.waitUntil(
    executeAuthHook(c.env, c.executionCtx, 'afterSignOut', { userId }, { workerUrl: getWorkerUrl(c.req.url, c.env) }).catch(() => {}),
  );

  return c.json({ ok: true });
});

// ─── Shard-routed routes (Access Token in header) ───

// POST /change-password — verify current password, set new one
const changePassword = createRoute({
  operationId: 'authChangePassword',
  method: 'post',
  path: '/change-password',
  tags: ['client'],
  summary: 'Change password for authenticated user',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      currentPassword: z.string(),
      newPassword: z.string(),
    }).passthrough() } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Authentication required or invalid password', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(changePassword, async (c) => {
  const userId = requireAuth(c.get('auth'));
  const bodyText = await c.req.text();
  let body: { currentPassword: string; newPassword: string };
  try { body = JSON.parse(bodyText); } catch { throw new EdgeBaseError(400, 'Invalid JSON.', undefined, 'invalid-json'); }
  if (!body.currentPassword || !body.newPassword) {
    throw new EdgeBaseError(400, 'currentPassword and newPassword are required.', undefined, 'invalid-input');
  }
  if (body.newPassword.length < 8) {
    throw new EdgeBaseError(400, 'Password must be at least 8 characters.', undefined, 'password-too-short');
  }
  await ensureAuthActionAllowed(c, 'changePassword', {
    userId,
    newPasswordLength: body.newPassword.length,
  });

  const db = getAuthDb(c);

  // Password policy validation
  const policyResult = await validatePassword(body.newPassword, getPasswordPolicyConfig(c.env));
  if (!policyResult.valid) {
    throw new EdgeBaseError(400, policyResult.errors[0], { password: { code: 'password_policy', message: policyResult.errors.join('; ') } }, 'password-policy');
  }

  const user = await authService.getUserById(db, userId);
  if (!user) throw new EdgeBaseError(404, 'User not found.', undefined, 'user-not-found');
  if (Number(user.disabled) === 1) throw new EdgeBaseError(403, 'Account is disabled.', undefined, 'account-disabled');
  if (!user.passwordHash) {
    throw new EdgeBaseError(403, 'This account uses OAuth sign-in. Password login is not available.', undefined, 'oauth-only');
  }
  if (user.isAnonymous === 1) {
    throw new EdgeBaseError(403, 'Anonymous accounts cannot change password.', undefined, 'anonymous-not-allowed');
  }

  const valid = await verifyPassword(body.currentPassword, user.passwordHash as string);
  if (!valid) {
    throw new EdgeBaseError(401, 'Current password is incorrect.', undefined, 'invalid-password');
  }

  // beforePasswordReset hook
  await executeAuthHook(c.env, c.executionCtx, 'beforePasswordReset', { userId }, { blocking: true, workerUrl: getWorkerUrl(c.req.url, c.env) });

  // Update password
  const newHash = await hashPassword(body.newPassword);
  await authService.updateUser(db, userId, { passwordHash: newHash });

  // afterPasswordReset hook — non-blocking
  const changedUser = await authService.getUserById(db, userId);
  if (changedUser) {
    c.executionCtx.waitUntil(
      executeAuthHook(c.env, c.executionCtx, 'afterPasswordReset', authService.sanitizeUser(changedUser), { workerUrl: getWorkerUrl(c.req.url, c.env) }).catch(() => {}),
    );
  }

  // Revoke all sessions + create new session
  await authService.deleteAllUserSessions(db, userId);
  const ip = getClientIP(c.env, c.req.raw);
  const userAgent = c.req.header('user-agent') || 'change-password';
  const session = await createSessionAndTokens(c.env, userId, ip, userAgent);

  // Re-read user
  const updatedUser = await authService.getUserById(db, userId);
  if (updatedUser) {
    syncUserPublic(c.env, c.executionCtx, userId, authService.buildPublicUserData(updatedUser));
  }

  return c.json({
    user: updatedUser ? authService.sanitizeUser(updatedUser) : null,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
  });
});

// ─── Email Change (authenticated) ───

// POST /change-email — request email change (password re-confirm + verification email)
const changeEmail = createRoute({
  operationId: 'authChangeEmail',
  method: 'post',
  path: '/change-email',
  tags: ['client'],
  summary: 'Request email change with password confirmation',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      newEmail: z.string(),
      password: z.string(),
    }).passthrough() } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Password verification failed', content: { 'application/json': { schema: errorResponseSchema } } },
    409: { description: 'Email already registered', content: { 'application/json': { schema: errorResponseSchema } } },
    429: { description: 'Too many requests', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(changeEmail, async (c) => {
  const userId = requireAuth(c.get('auth'));
  const body = await c.req.json<{
    newEmail: string;
    password: string;
    redirectUrl?: string;
    state?: string;
  }>();

  if (!body.newEmail || !body.password) {
    throw new EdgeBaseError(400, 'newEmail and password are required.', undefined, 'invalid-input');
  }

  const newEmail = body.newEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    throw new EdgeBaseError(400, 'Invalid email format.', undefined, 'invalid-email');
  }
  const redirect = parseClientRedirectInput(c.env, body);
  await ensureAuthActionAllowed(c, 'changeEmail', { userId, newEmail });

  // Rate limit per user
  const rateKey = `email-change-rate:${userId}`;
  if (!counter.check(rateKey, 3, 3600)) {
    throw new EdgeBaseError(429, 'Too many email change requests. Try again later.', undefined, 'rate-limited');
  }

  const db = getAuthDb(c);

  // 1. Check new email is not already registered
  const existing = await lookupEmail(db, newEmail);
  if (existing) {
    throw new EdgeBaseError(409, 'Email is already registered.', undefined, 'email-already-exists');
  }

  // 2. Verify password directly in D1
  const user = await authService.getUserById(db, userId);
  if (!user) throw new EdgeBaseError(404, 'User not found.', undefined, 'user-not-found');
  if (!user.passwordHash) {
    throw new EdgeBaseError(403, 'This account uses OAuth sign-in. Password-based email change is not available.', undefined, 'oauth-only');
  }
  if (user.disabled === 1) {
    throw new EdgeBaseError(403, 'This account has been disabled.', undefined, 'account-disabled');
  }

  const valid = await verifyPassword(body.password, user.passwordHash as string);
  if (!valid) {
    throw new EdgeBaseError(401, 'Password verification failed.', undefined, 'invalid-password');
  }

  const oldEmail = user.email as string;

  // 3. Generate verification token and store in KV
  const token = crypto.randomUUID();
  await c.env.KV.put(
    `email-change:${token}`,
    JSON.stringify({ userId, newEmail, oldEmail }),
    { expirationTtl: 86400 },
  );

  // 4. Send verification email to the NEW email address
  const provider = createEmailProvider(getEmailConfig(c.env), c.env);
  if (provider) {
    const appName = getAppName(c.env);
    const emailCfg = getEmailConfig(c.env);
    const fallbackVerifyUrl = emailCfg?.emailChangeUrl
      ? emailCfg.emailChangeUrl.replace('{token}', token)
      : `#verify-email-change?token=${token}`;
    const verifyUrl = buildEmailActionUrl({
      redirectUrl: redirect.redirectUrl,
      fallbackUrl: fallbackVerifyUrl,
      token,
      type: 'email-change',
      state: redirect.state,
    });

    const locale = resolveEmailLocale(c.env, user.locale as string | null, parseAcceptLanguage(c.req.header('accept-language')));
    const html = renderEmailChange({
      appName,
      verifyUrl,
      token,
      newEmail,
      expiresInHours: 24,
    }, resolveLocalizedString(getEmailTemplates(c.env)?.emailChange, locale), locale);

    const defaultSubject = getDefaultSubject(locale, 'emailChange').replace(/\{\{appName\}\}/g, appName);
    await sendMailWithHook(
      c.env, c.executionCtx, provider, 'emailChange', newEmail,
      resolveSubject(c.env, 'emailChange', defaultSubject, locale), html, locale,
    ).catch((err) => {
      console.error('[Email Change] Failed to send verification email:', err);
    });
  } else {
    const release = parseConfig(c.env)?.release ?? false;
    if (!release) {
      console.warn('[Email Change] Email provider not configured. Token:', token);
    }
  }

  const release = parseConfig(c.env)?.release ?? false;
  if (!release) {
    const emailCfg = getEmailConfig(c.env);
    const fallbackVerifyUrl = emailCfg?.emailChangeUrl
      ? emailCfg.emailChangeUrl.replace('{token}', token)
      : `#verify-email-change?token=${token}`;
    const actionUrl = buildEmailActionUrl({
      redirectUrl: redirect.redirectUrl,
      fallbackUrl: fallbackVerifyUrl,
      token,
      type: 'email-change',
      state: redirect.state,
    });
    return c.json({ ok: true, token, actionUrl });
  }

  return c.json({ ok: true });
});

// POST /verify-email-change — verify token + swap email
const verifyEmailChange = createRoute({
  operationId: 'authVerifyEmailChange',
  method: 'post',
  path: '/verify-email-change',
  tags: ['client'],
  summary: 'Verify email change token',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      token: z.string(),
    }).passthrough() } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Invalid or expired token', content: { 'application/json': { schema: errorResponseSchema } } },
    409: { description: 'Email already registered', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(verifyEmailChange, async (c) => {
  const body = await c.req.json<{ token: string }>();
  if (!body.token) throw new EdgeBaseError(400, 'Verification token is required.', undefined, 'invalid-input');

  await ensureAuthActionAllowed(c, 'verifyEmailChange', body as unknown as Record<string, unknown>);

  const db = getAuthDb(c);

  // 1. Read from KV
  const data = await c.env.KV.get(`email-change:${body.token}`, 'json') as {
    userId: string; newEmail: string; oldEmail: string;
  } | null;

  if (!data) {
    throw new EdgeBaseError(400, 'Invalid or expired email change token.', undefined, 'invalid-token');
  }

  const { userId, newEmail, oldEmail } = data;

  // 2. Delete KV token (single-use)
  await c.env.KV.delete(`email-change:${body.token}`).catch(() => {});

  // 3. Check new email is still not registered (race condition check)
  const existing = await lookupEmail(db, newEmail);
  if (existing) {
    throw new EdgeBaseError(409, 'Email is already registered.', undefined, 'email-already-exists');
  }

  // 4. Register new email as pending in D1
  try {
    await registerEmailPending(db, newEmail, userId);
  } catch (err) {
    if ((err as Error).message === 'EMAIL_ALREADY_REGISTERED') {
      throw new EdgeBaseError(409, 'Email is already registered.', undefined, 'email-already-exists');
    }
    throw new EdgeBaseError(500, 'Email change failed.', undefined, 'internal-error');
  }

  // 5. Update user email directly in D1
  try {
    await authService.updateUser(db, userId, { email: newEmail });
  } catch {
    await deleteEmailPending(db, newEmail).catch(() => {});
    throw new EdgeBaseError(500, 'Email change failed.', undefined, 'internal-error');
  }

  // 6. Confirm new email + delete old email in D1
  await confirmEmail(db, newEmail, userId);
  if (oldEmail) {
    await deleteEmail(db, oldEmail).catch(() => {});
  }

  // Sync _users_public
  const user = await authService.getUserById(db, userId);
  if (user) {
    syncUserPublic(c.env, c.executionCtx, userId, authService.buildPublicUserData(user));
  }

  return c.json({ ok: true, user: user ? authService.sanitizeUser(user) : { id: userId, email: newEmail } });
});

// ─── Passkeys/WebAuthn ────────────────────────────────────────────────────────

// POST /passkeys/register-options — authenticated, generate registration options
const passkeysRegisterOptions = createRoute({
  operationId: 'authPasskeysRegisterOptions',
  method: 'post',
  path: '/passkeys/register-options',
  tags: ['client'],
  summary: 'Generate passkey registration options',
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(passkeysRegisterOptions, async (c) => {
  const userId = requireAuth(c.get('auth'));
  await ensureAuthActionAllowed(c, 'passkeysRegisterOptions', { userId });
  const db = getAuthDb(c);
  const passkeysConfig = getPasskeysConfig(c.env);
  if (!passkeysConfig?.enabled) throw new EdgeBaseError(400, 'Passkeys are not enabled.', undefined, 'feature-not-enabled');

  const { generateRegistrationOptions } = await import('@simplewebauthn/server');

  const user = await authService.getUserById(db, userId);
  if (!user) throw new EdgeBaseError(404, 'User not found.', undefined, 'user-not-found');
  if (Number(user.disabled) === 1) throw new EdgeBaseError(403, 'This account has been disabled.', undefined, 'account-disabled');

  // Gather existing credentials for exclusion
  const existingCreds = await authService.listWebAuthnCredentials(db, userId);

  const options = await generateRegistrationOptions({
    rpName: passkeysConfig.rpName,
    rpID: passkeysConfig.rpID,
    userName: (user.email as string) || userId,
    userDisplayName: (user.displayName as string) || (user.email as string) || '',
    excludeCredentials: existingCreds.map((cred) => ({
      id: cred.credentialId,
      transports: cred.transports ? JSON.parse(cred.transports) : undefined,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
    attestationType: 'none',
  });

  // Store challenge in KV (TTL 5 min)
  await c.env.KV.put(
    `webauthn-challenge:${userId}`,
    options.challenge,
    { expirationTtl: 300 },
  );

  return c.json({ options });
});

// POST /passkeys/register — authenticated, verify registration and store credential
const passkeysRegister = createRoute({
  operationId: 'authPasskeysRegister',
  method: 'post',
  path: '/passkeys/register',
  tags: ['client'],
  summary: 'Verify and store passkey registration',
  request: {
    body: { content: { 'application/json': { schema: z.object({}).passthrough() } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(passkeysRegister, async (c) => {
  const userId = requireAuth(c.get('auth'));
  const db = getAuthDb(c);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = await c.req.json<{ response: any }>();
  if (!body.response) throw new EdgeBaseError(400, 'Registration response is required.', undefined, 'invalid-input');
  await ensureAuthActionAllowed(c, 'passkeysRegister', { userId });

  const passkeysConfig = getPasskeysConfig(c.env);
  if (!passkeysConfig?.enabled) throw new EdgeBaseError(400, 'Passkeys are not enabled.', undefined, 'feature-not-enabled');

  const { verifyRegistrationResponse } = await import('@simplewebauthn/server');

  const user = await authService.getUserById(db, userId);
  if (!user) throw new EdgeBaseError(404, 'User not found.', undefined, 'user-not-found');
  if (Number(user.disabled) === 1) throw new EdgeBaseError(403, 'This account has been disabled.', undefined, 'account-disabled');

  // Retrieve challenge from KV
  const expectedChallenge = await c.env.KV.get(`webauthn-challenge:${userId}`);
  if (!expectedChallenge) throw new EdgeBaseError(400, 'Challenge expired or not found. Please request new registration options.', undefined, 'challenge-expired');

  // Clean up challenge (single-use)
  await c.env.KV.delete(`webauthn-challenge:${userId}`);

  const expectedOrigin = Array.isArray(passkeysConfig.origin) ? passkeysConfig.origin : [passkeysConfig.origin];

  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge,
      expectedOrigin,
      expectedRPID: passkeysConfig.rpID,
      // Registration/auth options use userVerification: 'preferred', so server verification
      // must not silently upgrade that requirement to "required".
      requireUserVerification: false,
    });
  } catch (error) {
    throw new EdgeBaseError(
      400,
      error instanceof Error ? error.message : 'Passkey registration verification failed.',
      undefined,
      'invalid-input',
    );
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw new EdgeBaseError(400, 'Registration verification failed.', undefined, 'invalid-input');
  }

  const { credentialID, credentialPublicKey, counter } = verification.registrationInfo;
  const transports = body.response.response?.transports || [];

  // Convert credentialPublicKey Uint8Array to base64 for TEXT storage
  const pubKeyBase64 = btoa(String.fromCharCode(...credentialPublicKey));

  const credId = generateId();

  try {
    await authService.createWebAuthnCredential(db, {
      id: credId,
      userId,
      credentialId: credentialID,
      credentialPublicKey: pubKeyBase64,
      counter,
      transports: JSON.stringify(transports),
    });

    // Register in D1 passkey index
    await registerPasskey(db, credentialID, userId);
  } catch (error) {
    console.error('[Passkeys] Failed to persist registered credential:', error);
    throw new EdgeBaseError(
      500,
      error instanceof Error
        ? `Passkey registration persistence failed: ${error.message}`
        : 'Passkey registration persistence failed.',
      undefined,
      'internal-error',
    );
  }

  return c.json({ ok: true, credentialId: credentialID });
});

// POST /passkeys/auth-options — public, generate authentication options
const passkeysAuthOptions = createRoute({
  operationId: 'authPasskeysAuthOptions',
  method: 'post',
  path: '/passkeys/auth-options',
  tags: ['client'],
  summary: 'Generate passkey authentication options',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      email: z.string().optional(),
    }).passthrough() } }, required: false },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'User not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(passkeysAuthOptions, async (c) => {
  const db = getAuthDb(c);
  const passkeysConfig = getPasskeysConfig(c.env);
  if (!passkeysConfig?.enabled) throw new EdgeBaseError(400, 'Passkeys are not enabled.', undefined, 'feature-not-enabled');

  const { generateAuthenticationOptions } = await import('@simplewebauthn/server');
  const body: { email?: string } = await c.req.json<{ email?: string }>().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email.toLowerCase().trim() : undefined;
  await ensureAuthActionAllowed(c, 'passkeysAuthOptions', email ? { email } : null);
  let userId: string | undefined;

  // If email is provided, look up the user to get their specific credentials
  if (email) {
    const emailLookup = await lookupEmail(db, email);
    if (!emailLookup) throw new EdgeBaseError(404, 'User not found.', undefined, 'user-not-found');
    userId = emailLookup.userId;
  }

  // Transport strings from DB are valid AuthenticatorTransportFuture values
  type TransportFuture = 'ble' | 'cable' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb';
  let allowCredentials: { id: string; transports?: TransportFuture[] }[] | undefined;

  // If userId is provided, limit to that user's credentials
  if (userId) {
    const creds = await authService.listWebAuthnCredentials(db, userId);
    if (creds.length === 0) throw new EdgeBaseError(400, 'No passkeys registered for this user.', undefined, 'not-found');
    allowCredentials = creds.map((cred) => ({
      id: cred.credentialId,
      transports: cred.transports ? JSON.parse(cred.transports) as TransportFuture[] : undefined,
    }));
  }

  const options = await generateAuthenticationOptions({
    rpID: passkeysConfig.rpID,
    allowCredentials,
    userVerification: 'preferred',
  });

  // Store challenge in KV (keyed by challenge itself for discoverable flow)
  await c.env.KV.put(
    `webauthn-auth-challenge:${options.challenge}`,
    JSON.stringify({ userId: userId || null }),
    { expirationTtl: 300 },
  );

  return c.json({ options });
});

// POST /passkeys/authenticate — public, verify assertion and create session
const passkeysAuthenticate = createRoute({
  operationId: 'authPasskeysAuthenticate',
  method: 'post',
  path: '/passkeys/authenticate',
  tags: ['client'],
  summary: 'Authenticate with passkey',
  request: {
    body: { content: { 'application/json': { schema: z.object({}).passthrough() } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Authentication failed', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(passkeysAuthenticate, async (c) => {
  const db = getAuthDb(c);
  const passkeysConfig = getPasskeysConfig(c.env);
  if (!passkeysConfig?.enabled) throw new EdgeBaseError(400, 'Passkeys are not enabled.', undefined, 'feature-not-enabled');

  const { verifyAuthenticationResponse } = await import('@simplewebauthn/server');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = await c.req.json<{ response: any }>();
  if (!body.response) throw new EdgeBaseError(400, 'Authentication response is required.', undefined, 'invalid-input');

  const credentialId = body.response.id as string;
  if (!credentialId) throw new EdgeBaseError(400, 'Credential ID is required in the response.', undefined, 'invalid-input');
  await ensureAuthActionAllowed(c, 'passkeysAuthenticate', { credentialId });

  const ip = getClientIP(c.env, c.req.raw);
  const userAgent = c.req.header('User-Agent') || 'passkey';

  // Find credential in D1 (check existence before challenge validation)
  const credRow = await authService.getWebAuthnCredential(db, credentialId);
  if (!credRow) throw new EdgeBaseError(400, 'Unknown credential.', undefined, 'invalid-input');

  // Extract challenge from clientDataJSON
  const clientDataJSON = body.response.response?.clientDataJSON as string;
  if (!clientDataJSON) throw new EdgeBaseError(400, 'clientDataJSON is required in the response.', undefined, 'invalid-input');

  let parsedChallenge: string;
  try {
    const decoded = atob(clientDataJSON.replace(/-/g, '+').replace(/_/g, '/'));
    const parsed = JSON.parse(decoded);
    parsedChallenge = parsed.challenge;
  } catch {
    throw new EdgeBaseError(400, 'Invalid clientDataJSON.', undefined, 'invalid-input');
  }

  // Retrieve challenge data from KV
  const challengeData = await c.env.KV.get(`webauthn-auth-challenge:${parsedChallenge}`);
  if (!challengeData) throw new EdgeBaseError(400, 'Challenge expired or not found.', undefined, 'challenge-expired');

  // Clean up challenge (single-use)
  await c.env.KV.delete(`webauthn-auth-challenge:${parsedChallenge}`);

  const userId = credRow.userId as string;
  const user = await authService.getUserById(db, userId);
  if (!user) throw new EdgeBaseError(404, 'User not found.', undefined, 'user-not-found');
  if (Number(user.disabled) === 1) throw new EdgeBaseError(403, 'This account has been disabled.', undefined, 'account-disabled');

  // Reconstruct Uint8Array from base64 string
  const pubKeyBinary = Uint8Array.from(atob(credRow.credentialPublicKey as string), (ch) => ch.charCodeAt(0));

  const expectedOrigin = Array.isArray(passkeysConfig.origin) ? passkeysConfig.origin : [passkeysConfig.origin];

  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  try {
    verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: parsedChallenge,
      expectedOrigin,
      expectedRPID: passkeysConfig.rpID,
      authenticator: {
        credentialID: credRow.credentialId as string,
        credentialPublicKey: pubKeyBinary,
        counter: credRow.counter as number,
      },
      requireUserVerification: false,
    });
  } catch (error) {
    throw new EdgeBaseError(
      401,
      error instanceof Error ? error.message : 'Passkey authentication verification failed.',
      undefined,
      'invalid-credentials',
    );
  }

  if (!verification.verified) {
    throw new EdgeBaseError(401, 'Authentication verification failed.', undefined, 'invalid-credentials');
  }

  // Update counter
  await authService.updateWebAuthnCounter(db, credentialId, verification.authenticationInfo.newCounter);

  // Run beforeSignIn hook
  const sanitizedUser = authService.sanitizeUser(user);
  const hookResult = await executeAuthHook(c.env, c.executionCtx, 'beforeSignIn', sanitizedUser, { ip, userAgent, workerUrl: getWorkerUrl(c.req.url, c.env) });
  if (hookResult?.blocked) {
    throw new EdgeBaseError(403, 'Sign-in blocked by hook.', undefined, 'hook-rejected');
  }

  // MFA Check
  const mfaConfig = getMfaConfig(c.env);
  if (mfaConfig?.totp) {
    const factors = await authService.listVerifiedMfaFactors(db, userId);
    if (factors.length > 0) {
      const mfaTicket = crypto.randomUUID();
      await c.env.KV.put(
        `mfa-ticket:${mfaTicket}`,
        JSON.stringify({ userId }),
        { expirationTtl: 300 },
      );
      return c.json({
        mfaRequired: true,
        mfaTicket,
        factors: factors.map((f) => ({ id: f.id, type: f.type })),
      });
    }
  }

  // Create session
  const session = await createSessionAndTokens(c.env, userId, ip, userAgent);

  // Run afterSignIn hook (non-blocking)
  c.executionCtx.waitUntil(
    executeAuthHook(c.env, c.executionCtx, 'afterSignIn', sanitizedUser, { ip, userAgent, workerUrl: getWorkerUrl(c.req.url, c.env) }).catch(() => {}),
  );

  return c.json({
    user: sanitizedUser,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
  });
});

// GET /passkeys — list passkeys for authenticated user
const passkeysList = createRoute({
  operationId: 'authPasskeysList',
  method: 'get',
  path: '/passkeys',
  tags: ['client'],
  summary: 'List passkeys for authenticated user',
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(passkeysList, async (c) => {
  const userId = requireAuth(c.get('auth'));
  await ensureAuthActionAllowed(c, 'passkeysList', { userId });
  const db = getAuthDb(c);

  const user = await authService.getUserById(db, userId);
  if (!user) throw new EdgeBaseError(404, 'User not found.', undefined, 'user-not-found');

  const creds = await authService.listWebAuthnCredentials(db, userId);

  return c.json({
    passkeys: creds.map((cred) => ({
      id: cred.id,
      credentialId: cred.credentialId,
      transports: cred.transports ? JSON.parse(cred.transports) : [],
      createdAt: cred.createdAt,
    })),
  });
});

// DELETE /passkeys/:credentialId — delete a passkey for authenticated user
const passkeysDelete = createRoute({
  operationId: 'authPasskeysDelete',
  method: 'delete',
  path: '/passkeys/{credentialId}',
  tags: ['client'],
  summary: 'Delete a passkey',
  request: {
    params: z.object({ credentialId: z.string() }),
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Passkey not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(passkeysDelete, async (c) => {
  const userId = requireAuth(c.get('auth'));
  const db = getAuthDb(c);
  const credentialId = decodeURIComponent(c.req.param('credentialId')!);
  await ensureAuthActionAllowed(c, 'passkeysDelete', { userId, credentialId });

  // Verify credential belongs to user
  const cred = await authService.getWebAuthnCredential(db, credentialId);
  if (!cred || cred.userId !== userId) throw new EdgeBaseError(404, 'Passkey not found.', undefined, 'not-found');

  // Delete from _webauthn_credentials table
  await authService.deleteWebAuthnCredential(db, credentialId, userId);

  // Also remove from D1 passkey index
  await deletePasskey(db, credentialId).catch(() => {});

  return c.json({ ok: true });
});

// ─── GET /me — Current authenticated user info ──────────────

const getMe = createRoute({
  operationId: 'authGetMe',
  method: 'get',
  path: '/me',
  tags: ['client'],
  summary: 'Get current authenticated user info',
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(getMe, async (c) => {
  const auth = c.get('auth');
  if (!auth) {
    return c.json({ code: 401, message: 'Authentication required.' }, 401);
  }
  const userId = requireAuth(auth);
  await ensureAuthActionAllowed(c, 'getMe', { userId });
  const db = getAuthDb(c);

  const user = await authService.getUserById(db, userId);
  if (!user) return c.json({ code: 404, message: 'User not found' }, 404);

  return c.json({ user: authService.sanitizeUser(user, { includeAppMetadata: true }) });
});

const updateProfile = createRoute({
  operationId: 'authUpdateProfile',
  method: 'patch',
  path: '/profile',
  tags: ['client'],
  summary: 'Update user profile',
  request: {
    body: { content: { 'application/json': { schema: z.object({}).passthrough() } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(updateProfile, async (c) => {
  const userId = requireAuth(c.get('auth'));
  const db = getAuthDb(c);

  const body = c.req.valid('json') as {
    displayName?: string;
    avatarUrl?: string;
    emailVisibility?: 'public' | 'private';
    metadata?: Record<string, unknown>;
    locale?: string | null;
  };
  await ensureAuthActionAllowed(c, 'updateProfile', {
    userId,
    ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
    ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl } : {}),
    ...(body.emailVisibility !== undefined ? { emailVisibility: body.emailVisibility } : {}),
    ...(body.locale !== undefined ? { locale: body.locale } : {}),
    ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
  });

  const updates: Record<string, unknown> = {};

  if (body.displayName !== undefined) {
    if (typeof body.displayName === 'string' && body.displayName.length > 200) {
      throw new EdgeBaseError(400, 'Display name must not exceed 200 characters.', undefined, 'display-name-too-long');
    }
    updates.displayName = body.displayName;
  }
  if (body.avatarUrl !== undefined) {
    if (typeof body.avatarUrl === 'string' && body.avatarUrl.length > 2048) {
      throw new EdgeBaseError(400, 'Avatar URL must not exceed 2048 characters.', undefined, 'invalid-input');
    }
    updates.avatarUrl = body.avatarUrl;
  }

  // User-writable metadata (16KB limit)
  if (body.metadata !== undefined) {
    const metadataStr = JSON.stringify(body.metadata);
    if (metadataStr.length > 16384) {
      throw new EdgeBaseError(400, 'metadata exceeds 16KB limit.', undefined, 'invalid-input');
    }
    updates.metadata = metadataStr;
  }

  // User locale preference for i18n emails
  if (body.locale !== undefined) {
    const localeVal = body.locale;
    if (localeVal !== null && !/^[a-z]{2}(-[A-Z]{2})?$/.test(localeVal as string)) {
      throw new EdgeBaseError(400, 'Invalid locale format. Use ISO 639-1 (e.g. "en", "ko", "ja-JP").', undefined, 'invalid-locale');
    }
    updates.locale = localeVal ?? 'en';
  }

  // emailVisibility change handling
  let isPrivacyDowngrade = false;
  let previousVisibility: string | null = null;

  if (body.emailVisibility !== undefined) {
    if (!['public', 'private'].includes(body.emailVisibility)) {
      throw new EdgeBaseError(400, 'emailVisibility must be "public" or "private".', undefined, 'invalid-input');
    }
    isPrivacyDowngrade = body.emailVisibility === 'private';
    if (isPrivacyDowngrade) {
      const current = await authService.getUserById(db, userId);
      previousVisibility = (current?.emailVisibility as string) ?? 'private';
    }
    updates.emailVisibility = body.emailVisibility;
  }

  if (Object.keys(updates).length === 0) {
    throw new EdgeBaseError(400, 'No valid fields to update. Allowed fields: displayName, avatarUrl, emailVisibility, metadata.', undefined, 'no-fields-to-update');
  }

  await authService.updateUser(db, userId, updates);

  const user = await authService.getUserById(db, userId);
  if (!user) throw new EdgeBaseError(404, 'User not found.', undefined, 'user-not-found');

  // Sync _users_public
  if (isPrivacyDowngrade && previousVisibility === 'public') {
    // Synchronous processing for privacy downgrade
    try {
      await syncUserPublic(c.env, c.executionCtx, userId, authService.buildPublicUserData(user), true);
    } catch {
      // Compensating transaction: restore previous emailVisibility
      await authService.updateUser(db, userId, { emailVisibility: previousVisibility });
      throw new EdgeBaseError(500, 'Privacy setting change failed. Please try again.', undefined, 'internal-error');
    }
  } else {
    syncUserPublic(c.env, c.executionCtx, userId, authService.buildPublicUserData(user));
  }

  // displayName is included in JWT, so issue fresh tokens when it changes
  if (body.displayName !== undefined) {
    const accessToken = await generateAccessToken(c.env, user);
    return c.json({ user: authService.sanitizeUser(user), accessToken });
  }

  return c.json({ user: authService.sanitizeUser(user) });
});

const getSessions = createRoute({
  operationId: 'authGetSessions',
  method: 'get',
  path: '/sessions',
  tags: ['client'],
  summary: 'List active sessions',
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(getSessions, async (c) => {
  const userId = requireAuth(c.get('auth'));
  await ensureAuthActionAllowed(c, 'getSessions', { userId });
  const db = getAuthDb(c);

  const sessions = await authService.listUserSessions(db, userId);

  return c.json({ sessions });
});

const deleteSession = createRoute({
  operationId: 'authDeleteSession',
  method: 'delete',
  path: '/sessions/{id}',
  tags: ['client'],
  summary: 'Delete a session',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Session not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(deleteSession, async (c) => {
  const userId = requireAuth(c.get('auth'));
  const db = getAuthDb(c);
  const sessionId = c.req.param('id')!;
  await ensureAuthActionAllowed(c, 'deleteSession', { userId, sessionId });

  await authService.deleteSessionForUser(db, sessionId, userId);

  return c.json({ ok: true });
});

const getIdentities = createRoute({
  operationId: 'authGetIdentities',
  method: 'get',
  path: '/identities',
  tags: ['client'],
  summary: 'List linked sign-in identities for the current user',
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(getIdentities, async (c) => {
  const userId = requireAuth(c.get('auth'));
  await ensureAuthActionAllowed(c, 'getIdentities', { userId });
  const db = getAuthDb(c);

  const { user, oauthAccounts, summary } = await getIdentityState(c.env, db, userId);

  return c.json({
    identities: oauthAccounts.map((account) => ({
      id: account.id,
      kind: 'oauth',
      provider: account.provider,
      providerUserId: account.providerUserId,
      createdAt: account.createdAt,
      canUnlink: summary.total > 1,
    })),
    methods: {
      ...summary,
      email: typeof user.email === 'string' ? user.email : null,
      phone: typeof user.phone === 'string' ? user.phone : null,
    },
  });
});

const deleteIdentity = createRoute({
  operationId: 'authDeleteIdentity',
  method: 'delete',
  path: '/identities/{identityId}',
  tags: ['client'],
  summary: 'Unlink a linked sign-in identity',
  request: {
    params: z.object({ identityId: z.string() }),
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Identity not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(deleteIdentity, async (c) => {
  const userId = requireAuth(c.get('auth'));
  const db = getAuthDb(c);
  const identityId = c.req.param('identityId')!;
  await ensureAuthActionAllowed(c, 'deleteIdentity', { userId, identityId });

  const { oauthAccounts, summary } = await getIdentityState(c.env, db, userId);
  const identity = oauthAccounts.find((account) => account.id === identityId);
  if (!identity) {
    throw new EdgeBaseError(404, 'Identity not found.', undefined, 'not-found');
  }
  if (summary.total <= 1) {
    throw new EdgeBaseError(400, 'Cannot unlink the last sign-in method.', undefined, 'invalid-input');
  }

  await authService.deleteOAuthAccount(db, identity.id);
  await deleteOAuth(db, identity.provider, identity.providerUserId).catch(() => {});

  const next = await getIdentityState(c.env, db, userId);
  return c.json({
    ok: true,
    identities: next.oauthAccounts.map((account) => ({
      id: account.id,
      kind: 'oauth',
      provider: account.provider,
      providerUserId: account.providerUserId,
      createdAt: account.createdAt,
      canUnlink: next.summary.total > 1,
    })),
    methods: next.summary,
  });
});

// ─── Anonymous → Email/Password linking ───

const linkEmail = createRoute({
  operationId: 'authLinkEmail',
  method: 'post',
  path: '/link/email',
  tags: ['client'],
  summary: 'Link email and password to existing account',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      email: z.string(),
      password: z.string(),
    }).passthrough() } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: errorResponseSchema } } },
    409: { description: 'Email already registered', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(linkEmail, async (c) => {
  const userId = requireAuth(c.get('auth'));
  const db = getAuthDb(c);
  const body = await c.req.json<{ email: string; password: string }>();

  if (!body.email || !body.password) {
    throw new EdgeBaseError(400, 'Email and password are required.', undefined, 'invalid-input');
  }
  body.email = body.email.trim().toLowerCase();
  if (body.password.length < 8) {
    throw new EdgeBaseError(400, 'Password must be at least 8 characters.', undefined, 'password-too-short');
  }
  await ensureAuthActionAllowed(c, 'linkEmail', { userId, email: body.email });

  // Verify user exists and is anonymous
  const user = await authService.getUserById(db, userId);
  if (!user) throw new EdgeBaseError(404, 'User not found.', undefined, 'user-not-found');
  if (!user.isAnonymous) throw new EdgeBaseError(400, 'User is not anonymous.', undefined, 'invalid-input');
  if (Number(user.disabled) === 1) throw new EdgeBaseError(403, 'Account is disabled.', undefined, 'account-disabled');

  // Check email uniqueness in D1
  const existing = await lookupEmail(db, body.email);
  if (existing) {
    throw new EdgeBaseError(409, 'Email is already registered.', undefined, 'email-already-exists');
  }

  // Register email as pending in D1
  try {
    await registerEmailPending(db, body.email, userId);
  } catch (err) {
    if ((err as Error).message === 'EMAIL_ALREADY_REGISTERED') {
      throw new EdgeBaseError(409, 'Email is already registered.', undefined, 'email-already-exists');
    }
    throw err;
  }

  // Update user in D1
  const passwordHash = await hashPassword(body.password);
  try {
    await authService.updateUser(db, userId, {
      email: body.email,
      passwordHash,
      isAnonymous: 0,
    });
  } catch (err) {
    await deleteEmailPending(db, body.email).catch(() => {});
    throw new EdgeBaseError(500, `Link failed: ${(err as Error).message}`, undefined, 'internal-error');
  }

  // Confirm email in D1
  await confirmEmail(db, body.email, userId);

  // Best-effort: delete from _anon_index
  await deleteAnon(db, userId).catch(() => {});

  // Sync _users_public
  const updatedUser = await authService.getUserById(db, userId);
  if (updatedUser) {
    syncUserPublic(c.env, c.executionCtx, userId, authService.buildPublicUserData(updatedUser));
  }

  // Generate new tokens (isAnonymous = false now)
  const session = await createSessionAndTokens(c.env, userId, '0.0.0.0', 'link');

  return c.json({
    user: authService.sanitizeUser(updatedUser || user),
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
  });
});

// ─── Email Verification & Password Reset (M14,) ───

const requestEmailVerification = createRoute({
  operationId: 'authRequestEmailVerification',
  method: 'post',
  path: '/request-email-verification',
  tags: ['client'],
  summary: 'Send a verification email to the current authenticated user',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      redirectUrl: z.string().optional(),
      state: z.string().optional(),
    }).passthrough() } }, required: false },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    401: { description: 'Authentication required', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Verification email is not available', content: { 'application/json': { schema: errorResponseSchema } } },
    429: { description: 'Too many requests', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(requestEmailVerification, async (c) => {
  const userId = requireAuth(c.get('auth'));
  const body = await c.req.json<{
    redirectUrl?: string;
    state?: string;
  }>().catch(() => ({}));
  const redirect = parseClientRedirectInput(c.env, body);
  await ensureAuthActionAllowed(c, 'verifyEmail', { userId });

  const db = getAuthDb(c);
  const user = await authService.getUserById(db, userId);
  if (!user) throw new EdgeBaseError(404, 'User not found.', undefined, 'user-not-found');
  if (!user.email) throw new EdgeBaseError(400, 'Current user has no email address.', undefined, 'invalid-input');
  if (Number(user.isAnonymous) === 1) throw new EdgeBaseError(403, 'Anonymous users cannot request verification email.', undefined, 'anonymous-not-allowed');
  if (Number(user.disabled) === 1) throw new EdgeBaseError(403, 'This account has been disabled.', undefined, 'account-disabled');

  const rateKey = `verify-email-rate:${userId}`;
  if (!counter.check(rateKey, 3, 3600)) {
    throw new EdgeBaseError(429, 'Too many verification email requests. Try again later.', undefined, 'rate-limited');
  }

  await authService.deleteEmailTokensByUserAndType(db, userId, 'verify');

  const token = crypto.randomUUID();
  const expiresInHours = 24;
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();
  await authService.createEmailToken(db, {
    token,
    userId,
    type: 'verify',
    expiresAt,
  });

  const emailConfig = getEmailConfig(c.env);
  const fallbackVerifyUrl = emailConfig?.verifyUrl
    ? emailConfig.verifyUrl.replace('{token}', token)
    : `#verify-email?token=${token}`;
  const verifyUrl = buildEmailActionUrl({
    redirectUrl: redirect.redirectUrl,
    fallbackUrl: fallbackVerifyUrl,
    token,
    type: 'verify',
    state: redirect.state,
  });

  const provider = createEmailProvider(getEmailConfig(c.env), c.env);
  if (!provider) {
    const release = parseConfig(c.env)?.release ?? false;
    if (!release) {
      console.warn('[VerifyEmail] Email provider not configured. Verification email not sent. Token:', token);
      return c.json({ ok: true, message: 'Email provider not configured.', token, actionUrl: verifyUrl });
    }
    return c.json({ ok: true, message: 'Email provider not configured.' });
  }

  const locale = resolveEmailLocale(c.env, user.locale as string | null, parseAcceptLanguage(c.req.header('accept-language')));
  const html = renderVerifyEmail({
    appName: getAppName(c.env),
    verifyUrl,
    token,
    expiresInHours,
  }, resolveLocalizedString(getEmailTemplates(c.env)?.verification, locale), locale);

  const defaultSubject = getDefaultSubject(locale, 'verification').replace(/\{\{appName\}\}/g, getAppName(c.env));
  const result = await sendMailWithHook(
    c.env, c.executionCtx, provider, 'verification', user.email as string,
    resolveSubject(c.env, 'verification', defaultSubject, locale), html, locale,
  );

  return c.json({ ok: result.success, messageId: result.messageId });
});

// POST /verify-email — KV token→shardId lookup → direct Shard call
const verifyEmail = createRoute({
  operationId: 'authVerifyEmail',
  method: 'post',
  path: '/verify-email',
  tags: ['client'],
  summary: 'Verify email address with token',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      token: z.string(),
    }).passthrough() } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Invalid or expired token', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(verifyEmail, async (c) => {
  const body = await c.req.json<{ token: string }>();
  if (!body.token) throw new EdgeBaseError(400, 'Verification token is required.', undefined, 'invalid-input');

  await ensureAuthActionAllowed(c, 'verifyEmail', body as unknown as Record<string, unknown>);

  const db = getAuthDb(c);

  // Look up token directly in D1
  const row = await authService.getEmailTokenByType(db, body.token, 'verify');
  if (!row) throw new EdgeBaseError(400, 'Invalid or expired verification token.', undefined, 'invalid-token');

  if (new Date(row.expiresAt as string) < new Date()) {
    await authService.deleteEmailToken(db, body.token);
    throw new EdgeBaseError(400, 'Verification token has expired. Please request a new one.', undefined, 'token-expired');
  }

  const userId = row.userId as string;

  await authService.updateUser(db, userId, { verified: 1 });
  await authService.deleteEmailTokensByUserAndType(db, userId, 'verify');

  // onEmailVerified hook -- non-blocking
  const verifiedUser = await authService.getUserById(db, userId);
  if (verifiedUser) {
    c.executionCtx.waitUntil(
      executeAuthHook(c.env, c.executionCtx, 'onEmailVerified', authService.sanitizeUser(verifiedUser), { workerUrl: getWorkerUrl(c.req.url, c.env) }).catch(() => {}),
    );
  }

  return c.json({ ok: true, message: 'Email verified' });
});

// POST /request-password-reset — D1 email lookup → Shard
const requestPasswordReset = createRoute({
  operationId: 'authRequestPasswordReset',
  method: 'post',
  path: '/request-password-reset',
  tags: ['client'],
  summary: 'Request password reset email',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      email: z.string(),
    }).passthrough() } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(requestPasswordReset, async (c) => {
  const body = await c.req.json<{
    email: string;
    redirectUrl?: string;
    state?: string;
  }>();
  if (!body.email) throw new EdgeBaseError(400, 'Email is required.', undefined, 'invalid-input');
  body.email = body.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    throw new EdgeBaseError(400, 'Invalid email format.', undefined, 'invalid-email');
  }
  const redirect = parseClientRedirectInput(c.env, body);

  await ensureAuthActionAllowed(c, 'requestPasswordReset', body as unknown as Record<string, unknown>);

  const db = getAuthDb(c);

  // Look up email in D1
  const record = await lookupEmail(db, body.email);

  if (!record) {
    // Don't reveal whether email exists -- return ok
    return c.json({ ok: true, message: 'If the email exists, a reset link has been sent.' });
  }

  const { userId } = record;
  const user = await authService.getUserById(db, userId);
  if (!user || !user.email) {
    return c.json({ ok: true, message: 'If the email exists, a reset link has been sent.' });
  }

  // Delete old reset tokens for this user
  await authService.deleteEmailTokensByUserAndType(db, userId, 'password-reset');

  const token = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000); // 1h

  await authService.createEmailToken(db, {
    token,
    userId,
    type: 'password-reset',
    expiresAt: expiresAt.toISOString(),
  });

  const emailConfig = getEmailConfig(c.env);
  const fallbackResetUrl = emailConfig?.resetUrl
    ? emailConfig.resetUrl.replace('{token}', token)
    : `#reset-password?token=${token}`;
  const resetUrl = buildEmailActionUrl({
    redirectUrl: redirect.redirectUrl,
    fallbackUrl: fallbackResetUrl,
    token,
    type: 'password-reset',
    state: redirect.state,
  });

  const provider = createEmailProvider(getEmailConfig(c.env), c.env);
  if (!provider) {
    const release = parseConfig(c.env)?.release ?? false;
    if (!release) {
      console.warn('[Auth] Email provider not configured. Reset email not sent. Token:', token);
      return c.json({ ok: true, message: 'Email provider not configured.', token, actionUrl: resetUrl });
    }
    return c.json({ ok: true, message: 'Email provider not configured.' });
  }

  const locale = resolveEmailLocale(c.env, user.locale as string | null, parseAcceptLanguage(c.req.header('accept-language')));
  const html = renderPasswordReset({
    appName: getAppName(c.env),
    resetUrl,
    token,
    expiresInMinutes: 60,
  }, resolveLocalizedString(getEmailTemplates(c.env)?.passwordReset, locale), locale);

  const defaultSubject = getDefaultSubject(locale, 'passwordReset').replace(/\{\{appName\}\}/g, getAppName(c.env));
  const result = await sendMailWithHook(
    c.env, c.executionCtx, provider, 'passwordReset', user.email as string,
    resolveSubject(c.env, 'passwordReset', defaultSubject, locale), html, locale,
  );

  return c.json({ ok: result.success, messageId: result.messageId });
});

// POST /reset-password — KV token→shardId lookup → direct Shard call
const resetPassword = createRoute({
  operationId: 'authResetPassword',
  method: 'post',
  path: '/reset-password',
  tags: ['client'],
  summary: 'Reset password with token',
  request: {
    body: { content: { 'application/json': { schema: z.object({
      token: z.string(),
      newPassword: z.string(),
    }).passthrough() } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Invalid or expired token', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Blocked by hook', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

authRoute.openapi(resetPassword, async (c) => {
  const body = await c.req.json<{ token: string; newPassword: string }>();
  if (!body.token) throw new EdgeBaseError(400, 'Password reset token is required.', undefined, 'invalid-input');
  if (!body.newPassword) throw new EdgeBaseError(400, 'New password is required.', undefined, 'invalid-input');

  await ensureAuthActionAllowed(c, 'resetPassword', {
    token: body.token,
    newPassword: body.newPassword,
  });

  const db = getAuthDb(c);

  // Password policy validation
  const policyResult = await validatePassword(body.newPassword, getPasswordPolicyConfig(c.env));
  if (!policyResult.valid) {
    throw new EdgeBaseError(400, policyResult.errors[0], { password: { code: 'password_policy', message: policyResult.errors.join('; ') } }, 'password-policy');
  }

  // Look up token in D1
  const row = await authService.getEmailTokenByType(db, body.token, 'password-reset');
  if (!row) throw new EdgeBaseError(400, 'Invalid or expired password reset token.', undefined, 'invalid-token');

  if (new Date(row.expiresAt as string) < new Date()) {
    await authService.deleteEmailToken(db, body.token);
    throw new EdgeBaseError(400, 'Password reset token has expired. Please request a new one.', undefined, 'token-expired');
  }

  const userId = row.userId as string;

  await executeAuthHook(c.env, c.executionCtx, 'beforePasswordReset', { userId }, {
    blocking: true,
    workerUrl: getWorkerUrl(c.req.url, c.env),
  });

  const newHash = await hashPassword(body.newPassword);
  await authService.updateUser(db, userId, { passwordHash: newHash });

  // afterPasswordReset hook -- non-blocking
  const resetUser = await authService.getUserById(db, userId);
  if (resetUser) {
    c.executionCtx.waitUntil(
      executeAuthHook(c.env, c.executionCtx, 'afterPasswordReset', authService.sanitizeUser(resetUser), { workerUrl: getWorkerUrl(c.req.url, c.env) }).catch(() => {}),
    );
  }

  // Revoke all sessions (force re-login)
  await authService.deleteAllUserSessions(db, userId);
  // Delete all reset tokens
  await authService.deleteEmailTokensByUserAndType(db, userId, 'password-reset');

  return c.json({ ok: true, message: 'Password reset. All sessions revoked.' });
});
