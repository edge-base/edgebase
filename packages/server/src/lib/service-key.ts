/**
 * Service Key utility — config-driven scope engine.
 *
 * Service Keys are defined in config.serviceKeys and resolved against Worker
 * secrets via secretRef or inlineSecret. No separate env-only validation path.
 *
 * Memory keymap is built once per worker lifetime (lazy on first use).
 * No D1/KV reads in the request hot path.
 */

import type { EdgeBaseConfig, ServiceKeyEntry } from '@edge-base/shared';
import type { Env } from '../types.js';
import { isIpInCidr } from './cidr.js';
import { getTrustedClientIp } from './client-ip.js';

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

function firstDefinedValue(
  ...values: Array<string | null | undefined>
): string | undefined {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

/**
 * Read the explicit Service Key header from a request-like object.
 *
 * Header names accepted:
 * - X-EdgeBase-Service-Key
 * - x-edgebase-service-key
 */
export function extractServiceKeyHeader(reader: HeaderReader): string | undefined {
  return firstDefinedValue(
    readHeader(reader, 'X-EdgeBase-Service-Key'),
    readHeader(reader, 'x-edgebase-service-key'),
  );
}

/**
 * Resolve the first explicitly provided Service Key candidate.
 *
 * If a dedicated Service Key header is present, it wins even when the value is
 * the empty string. This prevents explicit-but-empty headers from being treated
 * as "missing" and silently falling back to public access or Bearer tokens.
 */
export function resolveServiceKeyCandidate(
  reader: HeaderReader,
  ...fallbacks: Array<string | null | undefined>
): string | undefined {
  const header = extractServiceKeyHeader(reader);
  if (header !== undefined) {
    return header;
  }
  return firstDefinedValue(...fallbacks);
}

/**
 * Read the raw Bearer token payload from Authorization.
 *
 * Returns `null` when the header is missing or does not use the Bearer scheme.
 * Returns the raw token payload as-is, including the empty string for `Bearer `.
 */
export function extractBearerToken(reader: HeaderReader): string | null {
  const authHeader = readHeader(reader, 'authorization') || readHeader(reader, 'Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}

/**
 * Timing-safe comparison of two strings.
 * Always runs in O(max(a,b)) time regardless of match.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  const encodedA = new TextEncoder().encode(a);
  const encodedB = new TextEncoder().encode(b);

  let diff = 0;
  for (let i = 0; i < encodedA.length; i++) {
    diff |= encodedA[i] ^ encodedB[i];
  }

  return diff === 0;
}

// ─── Constraint Context ───

/** Request-level context needed for constraint evaluation */
export interface ConstraintContext {
  /** Server environment name from ENVIRONMENT env var */
  env?: string;
  /** Client IP from cf-connecting-ip / x-forwarded-for */
  ip?: string;
  /** Tenant ID — auto-injected from DB URL instanceId (§15/136) */
  tenantId?: string;
}

/**
 * Build a ConstraintContext from a minimal request-like object and env.
 * Works with Hono's c.req or any object with a `.header()` method.
 *
 * @param env    - The Worker Env (for ENVIRONMENT var)
 * @param req    - Request object with .header() method (optional)
 */
export function buildConstraintCtx(
  env: { ENVIRONMENT?: string; EDGEBASE_CONFIG?: unknown; trustSelfHostedProxy?: boolean },
  req?: { header: (name: string) => string | undefined },
): ConstraintContext {
  const ctx: ConstraintContext = {
    env: env.ENVIRONMENT,
  };
  if (req) {
    ctx.ip = getTrustedClientIp(env, req);
    // Note: tenantId is auto-injected from DB URL instanceId in rules.ts (§15)
    // tenantId: from DB namespace+id in URL path (§2/#136)
  }
  return ctx;
}

// ─── Scoped Key Engine ───

/** In-memory resolved key entry: the entry + its resolved secret */
interface ResolvedKeyEntry {
  entry: ServiceKeyEntry;
  secret: string;
}

/** Scope string: "{domain}:{resourceType}:{resourceName}:{action}" */
export type ScopeString = string;

/**
 * Build an in-memory keymap from config.serviceKeys and env secrets.
 * Returns null if config.serviceKeys is not defined.
 *
 * Each resolved entry stores the entry metadata and the resolved secret.
 * 'dashboard' mode: reads env[secretRef] dynamically.
 * 'inline' mode: uses inlineSecret directly.
 */
export function buildKeymap(
  config: EdgeBaseConfig,
  env: Env,
): Map<string, ResolvedKeyEntry> | null {
  if (!config.serviceKeys?.keys?.length) return null;

  const keymap = new Map<string, ResolvedKeyEntry>();

  for (const entry of config.serviceKeys.keys) {
    // Skip disabled entries
    if (entry.enabled === false) continue;

    // Resolve secret
    let secret: string | undefined;
    if (entry.secretSource === 'inline') {
      secret = entry.inlineSecret;
    } else {
      // 'dashboard': read from env by secretRef name
      if (entry.secretRef) {
        secret = (env as unknown as Record<string, string | undefined>)[entry.secretRef];
      }
    }

    // Skip entries with no resolvable secret (misconfigured)
    if (!secret) continue;

    keymap.set(entry.kid, { entry, secret });
  }

  return keymap.size > 0 ? keymap : null;
}

/**
 * Returns true when the provided value exactly matches any configured Service Key
 * secret, ignoring scope/constraint checks. Used by auth middleware to classify
 * Bearer tokens as Service Key candidates before route-specific validation runs.
 */
export function matchesConfiguredSecret(
  provided: string | null | undefined,
  keymap: Map<string, ResolvedKeyEntry> | null,
): boolean {
  if (provided == null || provided === '') return false;
  if (!keymap || keymap.size === 0) return false;

  for (const [, resolved] of keymap) {
    if (timingSafeEqual(provided, resolved.secret)) {
      return true;
    }
  }

  return false;
}

/**
 * Resolve the internal-use root-tier Service Key secret for Worker self-calls.
 *
 * Selection rules:
 * - only root-tier keys are eligible
 * - keys must be usable without request-scoped context (tenant/IP constraints fail)
 * - if present, the canonical `secretRef: 'SERVICE_KEY'` root key wins
 * - otherwise, the first usable root-tier key in config order is used
 *
 * Returns undefined when no eligible root-tier key is configured or resolvable.
 */
export function resolveRootServiceKey(
  config: EdgeBaseConfig,
  env: Env,
): string | undefined {
  const keymap = buildKeymap(config, env);
  if (!keymap) return undefined;

  let fallback: string | undefined;
  for (const { entry, secret } of keymap.values()) {
    if (entry.tier !== 'root') continue;
    if (!checkConstraints(entry, { env: env.ENVIRONMENT })) continue;
    if (entry.secretSource === 'dashboard' && entry.secretRef === 'SERVICE_KEY') {
      return secret;
    }
    fallback ??= secret;
  }

  return fallback;
}

/**
 * Check if an entry's scopes satisfy a required scope.
 *
 * Root tier entries always pass.
 * Scoped entries: each scope segment is compared allowing '*' wildcard.
 * Scope format: "domain:resourceType:resourceName:action"
 *
 * Examples:
 *   required = "storage:bucket:avatars:write"
 *   passes with: ["*"], ["storage:*:*:*"], ["storage:bucket:avatars:write"], ["storage:bucket:avatars:*"]
 *   fails with:  ["storage:bucket:photos:write"], ["db:table:posts:read"]
 */
export function matchesScope(required: ScopeString, entry: ServiceKeyEntry): boolean {
  // Root tier: always passes
  if (entry.tier === 'root') return true;

  const requiredParts = required.split(':');

  for (const scope of entry.scopes) {
    // Global wildcard
    if (scope === '*') return true;

    const scopeParts = scope.split(':');

    // Must have same segment count
    if (scopeParts.length !== requiredParts.length) continue;

    let matches = true;
    for (let i = 0; i < scopeParts.length; i++) {
      if (scopeParts[i] !== '*' && scopeParts[i] !== requiredParts[i]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }

  return false;
}

/**
 * Check entry constraints: expiry, env, ipCidr, tenant.
 * Returns true if constraints pass (or no constraints defined).
 * Fail-closed: if a constraint is defined but the corresponding context value
 * is missing, the constraint fails (deny). This prevents bypassing constraints
 * by omitting context information.
 */
function checkConstraints(entry: ServiceKeyEntry, ctx?: ConstraintContext): boolean {
  const c = entry.constraints;
  if (!c) return true;

  // 1. Expiry check
  if (c.expiresAt) {
    const expiresAt = new Date(c.expiresAt).getTime();
    if (!isNaN(expiresAt) && Date.now() >= expiresAt) return false;
  }

  // 2. Environment check — ENVIRONMENT env var must be in allowed list
  if (c.env?.length) {
    if (!ctx?.env || !c.env.includes(ctx.env)) return false;
  }

  // 3. IP CIDR check — client IP must be in at least one allowed range
  if (c.ipCidr?.length) {
    if (!ctx?.ip || !c.ipCidr.some(cidr => isIpInCidr(ctx.ip!, cidr))) return false;
  }

  // 4. Tenant check — request tenant ID must match
  if (c.tenant) {
    if (!ctx?.tenantId || c.tenant !== ctx.tenantId) return false;
  }

  return true;
}

/**
 * Validate a scoped service key against a keymap.
 *
 * Key format: "jb_{kid}_{secret}" (recommended) or plain root-tier secret.
 *
 * Validation order:
 *   1. Extract kid from "jb_{kid}_{...}" format
 *   2. Look up entry in keymap by kid
 *   3. timing-safe compare full provided key against stored secret
 *   4. Check constraints (expiry, env)
 *   5. Check scope match
 *
 * If key doesn't have "jb_" prefix, iterate root-tier entries and compare directly.
 *
 * Returns 'valid' | 'invalid' | 'missing'
 */
export function validateScopedKey(
  provided: string | null | undefined,
  requiredScope: ScopeString,
  keymap: Map<string, ResolvedKeyEntry>,
  ctx?: ConstraintContext,
): 'valid' | 'invalid' | 'missing' {
  if (provided == null) return 'missing';
  if (provided === '') return 'invalid';
  if (keymap.size === 0) return 'missing';

  // Try structured "jb_{kid}_{...}" format
  if (provided.startsWith('jb_')) {
    const secondUnderscore = provided.indexOf('_', 3);
    if (secondUnderscore > 3) {
      const kid = provided.substring(3, secondUnderscore);
      const resolved = keymap.get(kid);
      if (!resolved) return 'invalid';

      if (!timingSafeEqual(provided, resolved.secret)) return 'invalid';
      if (!checkConstraints(resolved.entry, ctx)) return 'invalid';
      if (!matchesScope(requiredScope, resolved.entry)) return 'invalid';
      return 'valid';
    }
  }

  // Plain key format: iterate all root-tier entries directly
  // (scoped entries are skipped because they require a kid)
  let foundRootEntry = false;
  for (const [, resolved] of keymap) {
    if (resolved.entry.tier !== 'root') continue;
    foundRootEntry = true;
    if (timingSafeEqual(provided, resolved.secret)) {
      if (!checkConstraints(resolved.entry, ctx)) return 'invalid';
      // Root tier: scope always passes
      return 'valid';
    }
  }

  return foundRootEntry ? 'invalid' : 'missing';
}

/**
 * Validate that a provided key matches any configured Service Key, without
 * enforcing a route-specific scope check. Used by auth middleware to detect
 * Service Key requests before endpoint-level scope validation runs.
 */
export function validateConfiguredKey(
  provided: string | null | undefined,
  keymap: Map<string, ResolvedKeyEntry> | null,
  ctx?: ConstraintContext,
): 'valid' | 'invalid' | 'missing' {
  if (provided == null) return 'missing';
  if (provided === '') return 'invalid';
  if (!keymap || keymap.size === 0) return 'missing';

  for (const [, resolved] of keymap) {
    if (!timingSafeEqual(provided, resolved.secret)) continue;
    if (!checkConstraints(resolved.entry, ctx)) return 'invalid';
    return 'valid';
  }

  return 'invalid';
}

// ─── Unified Validator ───

/**
 * Primary entry point for Service Key validation.
 *
 * Strategy:
 *   1. If config.serviceKeys is defined → use scoped engine (validateScopedKey)
 *   2. Otherwise → return missing
 */
export function validateKey(
  provided: string | null | undefined,
  requiredScope: ScopeString,
  config: EdgeBaseConfig,
  env: Env,
  keymapCache?: Map<string, ResolvedKeyEntry> | null,
  ctx?: ConstraintContext,
): { result: 'valid' | 'invalid' | 'missing'; keymap: Map<string, ResolvedKeyEntry> | null } {
  const keymap = keymapCache !== undefined ? keymapCache : buildKeymap(config, env);
  if (keymap !== null) {
    const result = validateScopedKey(provided, requiredScope, keymap, ctx);
    return { result, keymap };
  }
  return { result: 'missing', keymap: null };
}
