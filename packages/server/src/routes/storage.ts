/**
 * Storage Routes — R2 File Storage API (M7, M17)
 *
 * Endpoints (GET routes ordered by registration priority):
 *   POST   /api/storage/{bucket}/upload                    — File upload
 *   GET    /api/storage/{bucket}/{key}/metadata             — Get metadata
 *   PATCH  /api/storage/{bucket}/{key}/metadata             — Update metadata
 *   HEAD   /api/storage/{bucket}/{key}                      — Check file exists
 *   GET    /api/storage/{bucket}/uploads/{uploadId}/parts   — Get uploaded parts (M17 resume)
 *   GET    /api/storage/{bucket}/{key}                      — Download file (catch-all — LAST)
 *   GET    /api/storage/{bucket}                            — List files
 *   DELETE /api/storage/{bucket}/{key}                      — Delete file
 *   POST   /api/storage/{bucket}/delete-batch               — Batch delete files
 *   POST   /api/storage/{bucket}/signed-url                 — Create signed download URL
 *   POST   /api/storage/{bucket}/signed-urls                — Batch create signed download URLs
 *   POST   /api/storage/{bucket}/signed-upload-url          — Create signed upload URL
 *   POST   /api/storage/{bucket}/multipart/create           — Start multipart upload
 *   POST   /api/storage/{bucket}/multipart/upload-part      — Upload a part
 *   POST   /api/storage/{bucket}/multipart/complete         — Complete multipart upload
 *   POST   /api/storage/{bucket}/multipart/abort            — Abort multipart upload
 *
 * ⚠️ Route order matters: specific sub-paths (metadata, uploads/parts) must be
 *    registered BEFORE the /{key} catch-all to avoid route shadowing.
 *
 * Security: Bucket-level rules (read, write, delete) from config.storage.buckets.
 * Default deny when no rules are defined.
 */

import type { Context } from 'hono';
import { OpenAPIHono, createRoute, z, type HonoEnv } from '../lib/hono.js';
import type { Env } from '../types.js';
import { parseConfig } from '../lib/do-router.js';
import { resolveRootServiceKey, validateKey, timingSafeEqual, type ConstraintContext } from '../lib/service-key.js';
import { EdgeBaseError } from '@edge-base/shared';
import { hookRejectedError } from '../lib/errors.js';
import { getTrustedClientIp } from '../lib/client-ip.js';
import { zodDefaultHook, jsonResponseSchema, errorResponseSchema } from '../lib/schemas.js';
import type { StorageBucketConfig, StorageHooks, StorageHookCtx, AuthContext, R2FileMeta, WriteFileMeta, StorageTrigger } from '@edge-base/shared';
import {
  getFunctionsByTrigger,
  buildFunctionKvProxy,
  buildFunctionD1Proxy,
  buildFunctionVectorizeProxy,
  buildFunctionPushProxy,
  buildAdminAuthContext,
  buildAdminDbProxy,
  executeSqlProviderAware,
  getWorkerUrl,
} from '../lib/functions.js';
import {
  applyStorageContentSecurityHeaders,
  normalizeStorageContentType,
} from '../lib/storage-content-security.js';
import { resolvePublicRequestOrigin } from '../lib/public-origin.js';
import {
  assertSignedMultipartUploadGrant,
  assertSignedUploadGrantActive,
  bindSignedMultipartUploadGrant,
  claimSignedMultipartUploadGrant,
  consumeSignedUploadGrant,
  createSignedUploadGrantId,
  INTERNAL_STORAGE_NAMESPACE,
  reserveSignedMultipartUploadBytes,
  terminateSignedMultipartUploadGrant,
} from '../lib/signed-upload-grants.js';


const storage = new OpenAPIHono<HonoEnv>({ defaultHook: zodDefaultHook });

// ─── Plugin Storage Hook Execution (metadata only, non-blocking) ───

/**
 * Execute plugin-registered storage hooks (fire-and-forget via waitUntil).
 * Storage hooks receive file metadata only — NO file content (Worker 128MB memory limit).
 * NOTE: presigned URL direct uploads bypass the server and do NOT trigger these hooks.
 */
function executeStorageHooks(
  event: StorageTrigger['event'],
  fileMeta: R2FileMeta & { bucket: string },
  auth: AuthContext | null,
  executionCtx: ExecutionContext,
  env: Env,
  workerUrl?: string,
): void {
  const hooks = getFunctionsByTrigger('storage', { type: 'storage', event } as StorageTrigger);
  if (hooks.length === 0) return;

  const serviceKey = resolveRootServiceKey(parseConfig(env), env);
  const adminCtx = buildStorageHookAdminContext(env, executionCtx, workerUrl, serviceKey);

  for (const { name, definition } of hooks) {
    executionCtx.waitUntil(
      definition.handler({
        file: fileMeta,
        auth: auth ? { id: auth.id, email: auth.email } : null,
        admin: adminCtx,
      }).catch((err: unknown) => {
        console.error(`[EdgeBase] Storage hook '${name}' (${event}) failed:`, err);
      }),
    );
  }
}

function normalizeStorageHookError(
  error: unknown,
  event: 'beforeUpload' | 'beforeDelete' | 'beforeDownload',
): EdgeBaseError {
  const fallbackByEvent = {
    beforeUpload: 'Upload rejected by beforeUpload hook.',
    beforeDelete: 'Delete rejected by beforeDelete hook.',
    beforeDownload: 'Download rejected by beforeDownload hook.',
  } as const;

  return hookRejectedError(error, fallbackByEvent[event], event);
}

/**
 * Execute plugin-registered blocking storage hooks (beforeUpload, beforeDelete, beforeDownload).
 * Blocking hooks can throw to reject the operation. 5s timeout per hook.
 * beforeUpload hooks may return Record<string, string> to merge custom metadata.
 */
async function executeBlockingStorageHooks(
  event: 'beforeUpload' | 'beforeDelete' | 'beforeDownload',
  fileMeta: (R2FileMeta | WriteFileMeta) & { bucket: string },
  auth: AuthContext | null,
  env: Env,
  workerUrl?: string,
): Promise<Record<string, string> | void> {
  const hooks = getFunctionsByTrigger('storage', { type: 'storage', event } as unknown as StorageTrigger);
  if (hooks.length === 0) return;

  const HOOK_TIMEOUT_MS = 5000;
  const serviceKey = resolveRootServiceKey(parseConfig(env), env);
  const adminCtx = buildStorageHookAdminContext(env, undefined, workerUrl, serviceKey);
  const mergedMeta: Record<string, string> = {};

  for (const { name, definition } of hooks) {
    const hookCtx = {
      file: fileMeta,
      auth: auth ? { id: auth.id, email: auth.email } : null,
      admin: adminCtx,
    };

    let result: unknown;
    try {
      result = await Promise.race([
        definition.handler(hookCtx),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Storage hook '${name}' (${event}) timed out (5s)`)), HOOK_TIMEOUT_MS),
        ),
      ]);
    } catch (error) {
      throw normalizeStorageHookError(error, event);
    }

    if (result && typeof result === 'object' && event === 'beforeUpload') {
      Object.assign(mergedMeta, result as Record<string, string>);
    }
  }

  return Object.keys(mergedMeta).length > 0 ? mergedMeta : undefined;
}

/** Build admin context for plugin storage hooks (DB, auth, kv, d1, etc.). */
function buildStorageHookAdminContext(
  env: Env,
  executionCtx?: ExecutionContext,
  workerUrl?: string,
  serviceKey?: string,
) {
  const config = parseConfig(env);
  const adminDb = buildAdminDbProxy({
    databaseNamespace: env.DATABASE,
    config,
    workerUrl,
    serviceKey,
    env,
    executionCtx,
  });

  return {
    db: adminDb,
    table: (name: string) => adminDb('shared').table(name),
    auth: buildAdminAuthContext({ d1Database: env.AUTH_DB, serviceKey, workerUrl }),
    sqlProviderAware: (namespace: string, id: string | undefined, query: string, params?: unknown[]) =>
      executeSqlProviderAware(
        { env, config, databaseNamespace: env.DATABASE, workerUrl, serviceKey },
        namespace, id, query, params,
      ),
    sqlWithDirectD1Access: (namespace: string, id: string | undefined, query: string, params?: unknown[]) =>
      executeSqlProviderAware(
        { env, config, databaseNamespace: env.DATABASE, workerUrl, serviceKey },
        namespace, id, query, params,
      ),
    async broadcast(channel: string, event: string, payload?: Record<string, unknown>) {
      if (workerUrl && serviceKey) {
        await fetch(`${workerUrl}/api/db/broadcast`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-EdgeBase-Service-Key': serviceKey },
          body: JSON.stringify({ channel, event, payload: payload ?? {} }),
        });
        return;
      }
      throw new Error('admin.broadcast() requires workerUrl in storage hook context.');
    },
    functions: {
      async call(name: string, data?: unknown) {
        if (workerUrl && serviceKey) {
          const safeName = name.split('/').map(encodeURIComponent).join('/');
          const res = await fetch(`${workerUrl}/api/functions/${safeName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-EdgeBase-Service-Key': serviceKey },
            body: JSON.stringify(data ?? {}),
          });
          if (!res.ok) throw new Error(`admin.functions.call('${name}') failed: ${res.status}`);
          return res.json();
        }
        throw new Error('admin.functions.call() requires workerUrl in storage hook context.');
      },
    },
    kv: (namespace: string) => buildFunctionKvProxy(namespace, config, env, workerUrl, serviceKey),
    d1: (database: string) => buildFunctionD1Proxy(database, config, env, workerUrl, serviceKey),
    vector: (index: string) => buildFunctionVectorizeProxy(index, config, env, workerUrl, serviceKey),
    push: buildFunctionPushProxy(workerUrl, serviceKey),
  };
}

// ─── Helpers ───


/** Normalize a raw storage rule value to a callable. */
function normalizeStorageRule(
  rule: ((auth: AuthContext | null, file: R2FileMeta | WriteFileMeta) => boolean) | boolean | string | undefined,
): ((auth: AuthContext | null, resource: R2FileMeta | WriteFileMeta | null) => boolean) | null {
  if (rule === undefined || rule === null) return null;
  if (typeof rule === 'boolean') return () => rule;
  if (typeof rule === 'function') {
    const fn = rule;
    return (auth, resource) => fn(auth, (resource ?? {}) as R2FileMeta | WriteFileMeta);
  }
  if (typeof rule === 'string') {
    return (auth, resource) => evalStorageStringRule(rule, auth, resource);
  }
  return null;
}

/** Simple string rule evaluator for storage rules from JSON config. */
function evalStorageStringRule(
  expr: string,
  auth: AuthContext | null,
  resource: R2FileMeta | WriteFileMeta | null,
): boolean {
  const e = expr.trim().replace(/\s+/g, ' ');
  if (e === 'true') return true;
  if (e === 'false') return false;
  if (e === 'auth != null' || e === 'auth !== null') return auth !== null;
  if (e === 'auth == null' || e === 'auth === null') return auth === null;
  // auth.id == resource.X
  const authIdEqResource = /^auth\.id ===? resource\.(\w+)$/.exec(e);
  if (authIdEqResource) {
    const field = authIdEqResource[1];
    return auth !== null && resource !== null && resource !== undefined
      && auth.id === (resource as unknown as Record<string, unknown>)[field];
  }
  // Default: deny (fail-closed for unknown/unsupported expressions)
  console.warn(`[Storage] Unrecognized string rule expression: "${expr}" — denied (fail-closed).`);
  return false;
}

/** Evaluate a storage access rule (function, boolean, or string — §3/§5). */
function checkStorageRule(
  rule: ((auth: AuthContext | null, file: R2FileMeta | WriteFileMeta) => boolean) | boolean | string | undefined,
  auth: AuthContext | null,
  resource: R2FileMeta | WriteFileMeta | null,
  action: string,
  bucketName: string,
  release?: boolean,
): void {
  const ruleFn = normalizeStorageRule(rule);
  // Default deny — bypassed when release is false
  if (ruleFn === null) {
    if (!release) return; // release: false → allow without rules
    throw new EdgeBaseError(403, `Access denied. No '${action}' rule defined for bucket '${bucketName}'.`, undefined, 'access-denied');
  }
  try {
    const result = ruleFn(auth, resource);
    if (!result) throw new EdgeBaseError(403, 'Access denied by storage access rules.', undefined, 'access-denied');
  } catch (e) {
    if (e instanceof EdgeBaseError) throw e;
    throw new EdgeBaseError(403, 'Access denied by storage access rules.', undefined, 'access-denied');
  }
}

/** Get bucket config, throw if bucket not configured. Returns release flag for rule evaluation. */
function getBucketConfig(env: Env, bucketName: string): { bucketConfig: StorageBucketConfig; release: boolean } {
  if (bucketName === INTERNAL_STORAGE_NAMESPACE) {
    throw new EdgeBaseError(404, `Storage bucket '${bucketName}' is reserved for internal runtime state.`, undefined, 'not-found');
  }
  const config = parseConfig(env);
  const bucketConfig = config.storage?.buckets?.[bucketName];
  if (!bucketConfig) {
    throw new EdgeBaseError(404, `Storage bucket '${bucketName}' is not configured.`, undefined, 'not-found');
  }
  return { bucketConfig, release: config.release ?? false };
}

/** Check Service Key bypass for storage requests. */
function checkServiceKey(env: Env, header: string | undefined, scope: string, req?: { header: (name: string) => string | undefined }): boolean {
  const config = parseConfig(env);
  const constraintCtx: ConstraintContext = {
    env: env.ENVIRONMENT,
  };
  if (req) {
    constraintCtx.ip = getTrustedClientIp(env, req);
  }
  const { result } = validateKey(header, scope, config, env, undefined, constraintCtx);
  if (result === 'valid') return true;
  if (result === 'invalid') {
    throw new EdgeBaseError(401, `Invalid X-EdgeBase-Service-Key for storage scope '${scope}'.`, undefined, 'unauthenticated');
  }
  return false; // 'missing' → continue to normal rules
}

type SignedTokenClaims = {
  expiresAt: number;
  maxBytes: number | null;
  grantId: string | null;
  purpose: 'download' | 'upload' | null;
  file?: SignedTokenFileMetadata | null;
};

type SignedTokenFileMetadata = {
  size: number;
  contentType?: string;
  etag?: string;
  uploadedAt?: string;
  uploadedBy?: string | null;
  customMetadata?: Record<string, string>;
};

type SignedTokenOptions = {
  maxBytes?: number | null;
  grantId?: string | null;
  file?: SignedTokenFileMetadata | null;
};

type TrackedMultipartPart = {
  partNumber: number;
  etag: string;
  size?: number;
};

type ParsedDownloadRange =
  | { kind: 'full' }
  | { kind: 'partial'; offset: number; end: number; length: number }
  | { kind: 'unsatisfiable' };

function parseByteSize(value?: string): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d+)(B|KB|MB|GB)$/i);
  if (!match) {
    throw new EdgeBaseError(400, 'Invalid maxFileSize. Use a byte size like 128B, 1KB, 5MB, or 1GB.', undefined, 'validation-failed');
  }

  const amount = parseInt(match[1], 10);
  const unit = match[2].toUpperCase();
  const multiplier = unit === 'B'
    ? 1
    : unit === 'KB'
      ? 1024
      : unit === 'MB'
        ? 1024 * 1024
        : 1024 * 1024 * 1024;

  const bytes = amount * multiplier;
  if (!Number.isSafeInteger(bytes)) {
    throw new EdgeBaseError(400, 'Invalid maxFileSize. The byte size is too large.', undefined, 'validation-failed');
  }
  return bytes;
}

function emptySignedTokenClaims(expiresAt = 0, maxBytes: number | null = null): SignedTokenClaims {
  return { expiresAt, maxBytes, grantId: null, purpose: null, file: null };
}

function normalizeSignedTokenOptions(
  options?: number | null | SignedTokenOptions,
): Required<Pick<SignedTokenOptions, 'maxBytes' | 'grantId'>> & Pick<SignedTokenOptions, 'file'> {
  const rawMaxBytes = typeof options === 'object' && options !== null
    ? options.maxBytes
    : options;
  const maxBytes = typeof rawMaxBytes === 'number' && Number.isFinite(rawMaxBytes)
    ? Math.max(0, Math.trunc(rawMaxBytes))
    : null;
  const file = typeof options === 'object' && options !== null
    ? normalizeSignedFileMetadata(options.file)
    : null;
  const rawGrantId = typeof options === 'object' && options !== null
    ? options.grantId
    : null;
  const grantId = typeof rawGrantId === 'string' && /^[a-f0-9]{32}$/.test(rawGrantId)
    ? rawGrantId
    : null;
  return { maxBytes, grantId, file };
}

function normalizeSignedFileMetadata(file?: SignedTokenFileMetadata | null): SignedTokenFileMetadata | null {
  if (!file || typeof file.size !== 'number' || !Number.isFinite(file.size) || file.size < 0) {
    return null;
  }

  const customMetadata: Record<string, string> = {};
  if (file.customMetadata && typeof file.customMetadata === 'object') {
    for (const [key, value] of Object.entries(file.customMetadata)) {
      if (typeof value === 'string') customMetadata[key] = value;
    }
  }

  const normalized: SignedTokenFileMetadata = {
    size: Math.trunc(file.size),
  };
  if (typeof file.contentType === 'string' && file.contentType) normalized.contentType = file.contentType;
  if (typeof file.etag === 'string' && file.etag) normalized.etag = file.etag;
  if (typeof file.uploadedAt === 'string' && file.uploadedAt) normalized.uploadedAt = file.uploadedAt;
  if (typeof file.uploadedBy === 'string' || file.uploadedBy === null) normalized.uploadedBy = file.uploadedBy;
  if (Object.keys(customMetadata).length > 0) normalized.customMetadata = customMetadata;
  return normalized;
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function signedFileMetadataFromObject(obj: R2Object): SignedTokenFileMetadata {
  return {
    size: obj.size,
    contentType: obj.httpMetadata?.contentType || 'application/octet-stream',
    etag: obj.etag,
    uploadedAt: obj.uploaded?.toISOString(),
  };
}

/** Create HMAC-based signed URL token. */
export async function createSignedToken(
  key: string,
  bucket: string,
  expiresAt: number,
  secret: string,
  options?: number | null | SignedTokenOptions,
): Promise<string> {
  const encoder = new TextEncoder();
  const { maxBytes: normalizedMaxBytes, grantId, file } = normalizeSignedTokenOptions(options);
  if (grantId) {
    const payload = encodeBase64Url(JSON.stringify({
      v: 3,
      bucket,
      key,
      exp: Math.trunc(expiresAt),
      max: normalizedMaxBytes,
      grant: grantId,
      purpose: 'upload',
    }));
    const data = `v3.${payload}`;
    const cryptoKey = await crypto.subtle.importKey(
      'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
    const sigHex = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${data}.${sigHex}`;
  }
  if (file) {
    const payload = encodeBase64Url(JSON.stringify({
      v: 2,
      bucket,
      key,
      exp: Math.trunc(expiresAt),
      max: normalizedMaxBytes,
      file,
    }));
    const data = `v2.${payload}`;
    const cryptoKey = await crypto.subtle.importKey(
      'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
    const sigHex = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
    return `${data}.${sigHex}`;
  }

  const data = `${bucket}:${key}:${expiresAt}:${normalizedMaxBytes ?? ''}`;
  const cryptoKey = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
  const sigHex = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
  return normalizedMaxBytes === null
    ? `${expiresAt}.${sigHex}`
    : `${expiresAt}.${normalizedMaxBytes}.${sigHex}`;
}

export function createSignedUploadToken(
  key: string,
  bucket: string,
  expiresAt: number,
  secret: string,
  maxBytes: number | null = null,
): Promise<string> {
  return createSignedToken(key, bucket, expiresAt, secret, {
    maxBytes,
    grantId: createSignedUploadGrantId(),
  });
}

/** Verify HMAC-based signed URL token. */
async function verifySignedToken(
  token: string,
  key: string,
  bucket: string,
  secret: string,
): Promise<{ valid: boolean; claims: SignedTokenClaims }> {
  const parts = token.split('.');
  if (parts.length === 3 && (parts[0] === 'v2' || parts[0] === 'v3')) {
    const version = parts[0] === 'v3' ? 3 : 2;
    const payload = parts[1]!;
    const signature = parts[2]!;
    let claims: SignedTokenClaims = emptySignedTokenClaims();
    try {
      const parsed = JSON.parse(decodeBase64Url(payload)) as {
        v?: unknown;
        bucket?: unknown;
        key?: unknown;
        exp?: unknown;
        max?: unknown;
        grant?: unknown;
        purpose?: unknown;
        file?: unknown;
      };
      const expiresAt = typeof parsed.exp === 'number' ? Math.trunc(parsed.exp) : NaN;
      const maxBytes = typeof parsed.max === 'number' && Number.isFinite(parsed.max)
        ? Math.max(0, Math.trunc(parsed.max))
        : null;
      const grantId = typeof parsed.grant === 'string' && /^[a-f0-9]{32}$/.test(parsed.grant)
        ? parsed.grant
        : null;
      const purpose = version === 3
        ? (parsed.purpose === 'upload' ? 'upload' : null)
        : 'download';
      const file = normalizeSignedFileMetadata(parsed.file as SignedTokenFileMetadata | null | undefined);
      claims = { expiresAt, maxBytes, grantId, purpose, file };
      if (
        parsed.v !== version
        || parsed.bucket !== bucket
        || parsed.key !== key
        || !Number.isFinite(expiresAt)
        || Date.now() >= expiresAt
        || (version === 3 && (!grantId || purpose !== 'upload'))
      ) {
        return { valid: false, claims };
      }
    } catch {
      return { valid: false, claims: emptySignedTokenClaims() };
    }

    const encoder = new TextEncoder();
    const data = `v${version}.${payload}`;
    const cryptoKey = await crypto.subtle.importKey(
      'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const expected = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
    const expectedHex = Array.from(new Uint8Array(expected)).map(b => b.toString(16).padStart(2, '0')).join('');
    return {
      valid: timingSafeEqual(signature, expectedHex),
      claims,
    };
  }

  if (parts.length !== 2 && parts.length !== 3) {
    return { valid: false, claims: emptySignedTokenClaims() };
  }
  const expiresAt = parseInt(parts[0]!, 10);
  const maxBytes = parts.length === 3 ? parseInt(parts[1]!, 10) : null;
  const signature = parts[parts.length - 1]!;

  if (isNaN(expiresAt) || Date.now() >= expiresAt) {
    return { valid: false, claims: emptySignedTokenClaims(expiresAt, Number.isFinite(maxBytes ?? NaN) ? maxBytes : null) };
  }
  if (parts.length === 3 && !Number.isFinite(maxBytes)) {
    return { valid: false, claims: emptySignedTokenClaims(expiresAt) };
  }

  const encoder = new TextEncoder();
  const data = `${bucket}:${key}:${expiresAt}:${parts.length === 3 ? maxBytes : ''}`;
  const cryptoKey = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const expected = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
  const expectedHex = Array.from(new Uint8Array(expected)).map(b => b.toString(16).padStart(2, '0')).join('');
  return {
    valid: timingSafeEqual(signature, expectedHex),
    claims: {
      expiresAt,
      maxBytes: parts.length === 3 ? maxBytes : null,
      grantId: null,
      purpose: null,
      file: null,
    },
  };
}

async function verifySignedUploadQuery(
  c: Context<HonoEnv>,
  bucketName: string,
  key: string,
  multipartUploadId?: string,
): Promise<SignedTokenClaims | null> {
  const token = c.req.query('token');
  const tokenKey = c.req.query('key');
  if (!token) return null;
  if (tokenKey && tokenKey !== key) {
    throw new EdgeBaseError(400, 'Signed upload key mismatch.', undefined, 'validation-failed');
  }
  const secret = c.env.JWT_USER_SECRET;
  if (!secret) {
    throw new EdgeBaseError(403, 'Signed upload tokens require JWT_USER_SECRET to be configured.', undefined, 'access-denied');
  }
  const verified = await verifySignedToken(token, key, bucketName, secret);
  if (!verified.valid || verified.claims.purpose !== 'upload') {
    throw new EdgeBaseError(403, 'Signed upload token is invalid or expired.', undefined, 'access-denied');
  }
  if (multipartUploadId === undefined) {
    await assertSignedUploadGrantActive(c.env.STORAGE, verified.claims);
  } else {
    await assertSignedMultipartUploadGrant(c.env.STORAGE, verified.claims, multipartUploadId);
  }
  return verified.claims;
}

async function verifySignedDownloadQuery(
  c: Context<HonoEnv>,
  bucketName: string,
  key: string,
): Promise<SignedTokenClaims | null> {
  const token = c.req.query('token');
  if (!token) return null;

  // Asymmetric fail-closed: without a signing secret, or with an invalid or
  // upload-scoped token, normal storage read rules remain authoritative.
  const secret = c.env.JWT_USER_SECRET;
  if (!secret) return null;
  const verified = await verifySignedToken(token, key, bucketName, secret);
  if (!verified.valid || verified.claims.purpose === 'upload') return null;
  if (!verified.claims.file?.etag) throw signedDownloadPreconditionError();
  return verified.claims;
}

function requestContentLength(c: Context<HonoEnv>): number | null {
  const header = c.req.header('content-length');
  if (!header) return null;
  const normalized = header.trim();
  if (!/^\d+$/.test(normalized)) return null;
  const size = Number(normalized);
  return Number.isSafeInteger(size) ? size : null;
}

async function assertSignedMultipartSizeWithinLimit(
  c: Context<HonoEnv>,
  bucketName: string,
  key: string,
  uploadId: string,
  parts: Array<{ partNumber: number; etag: string }>,
  maxBytes: number,
) {
  const kvKey = partTrackingKey(bucketName, key, uploadId);
  const existing = await c.env.KV.get(kvKey, 'json') as TrackedMultipartPart[] | null;
  const tracked = new Map(
    (existing ?? []).map((part) => [`${part.partNumber}:${part.etag}`, part] as const),
  );
  let total = 0;
  for (const part of parts) {
    const trackedPart = tracked.get(`${part.partNumber}:${part.etag}`);
    if (!trackedPart || typeof trackedPart.size !== 'number' || !Number.isFinite(trackedPart.size)) {
      throw new EdgeBaseError(400, 'Signed multipart upload is missing tracked part size metadata.', undefined, 'validation-failed');
    }
    total += trackedPart.size;
    if (total > maxBytes) {
      throw new EdgeBaseError(413, `Signed upload exceeds maxFileSize of ${maxBytes} bytes.`, undefined, 'payload-too-large');
    }
  }
}

/** Parse duration string (e.g. '1h', '30m') to milliseconds. Max 7 days. */
export function parseDuration(str: string): number {
  const match = str.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 3600 * 1000; // default 1h
  const value = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1000, m: 60 * 1000, h: 3600 * 1000, d: 86400 * 1000 };
  const ms = value * (multipliers[unit] || 3600 * 1000);
  const MAX_MS = 7 * 86400 * 1000; // 7 days max for signed URLs
  return Math.min(ms, MAX_MS);
}

/** Build R2 object key with bucket prefix. */
function r2Key(bucket: string, key: string): string {
  return `${bucket}/${key}`;
}

/**
 * Validate storage key for security issues.
 * Rejects path traversal, null bytes, and overly long keys.
 */
function validateStorageKey(key: string): void {
  if (!key || !key.trim()) {
    throw new EdgeBaseError(400, 'Storage key must not be empty.', undefined, 'validation-failed');
  }
  if (key.length > 1024) {
    throw new EdgeBaseError(400, 'Storage key must not exceed 1024 characters.', undefined, 'validation-failed');
  }
  if (key.includes('\0')) {
    throw new EdgeBaseError(400, 'Storage key must not contain null bytes.', undefined, 'validation-failed');
  }
  // Check for path traversal: ".." as a standalone segment
  if (/(^|\/)\.\.(\/|$)/.test(key)) {
    throw new EdgeBaseError(400, 'Storage key must not contain path traversal sequences (..).', undefined, 'validation-failed');
  }
}

/** Build KV key for multipart part tracking (M17). */
export function partTrackingKey(bucket: string, key: string, uploadId: string): string {
  return `upload:${bucket}:${key}:${uploadId}:parts`;
}

/** Part tracking TTL — 7 days, synced with R2 auto-abort (M17). */
export const PART_TRACKING_TTL = 7 * 24 * 60 * 60; // 604800 seconds

/** Build file metadata from R2 object. */
function buildMetadata(obj: R2Object): R2FileMeta {
  return {
    key: obj.key.split('/').slice(1).join('/'), // remove bucket prefix
    size: obj.size,
    contentType: obj.httpMetadata?.contentType || 'application/octet-stream',
    etag: obj.etag,
    uploadedAt: obj.uploaded?.toISOString(),
    uploadedBy: obj.customMetadata?.uploadedBy || null,
    customMetadata: obj.customMetadata || {},
  } as R2FileMeta;
}

function signedDownloadPreconditionError(): EdgeBaseError {
  return new EdgeBaseError(
    412,
    'Signed download URL no longer matches the current object version. Create a new signed URL.',
    undefined,
    'failed-precondition',
  );
}

function assertSignedDownloadObjectMatches(
  claims: SignedTokenClaims | null,
  object: R2Object,
): void {
  if (!claims) return;
  const signed = claims.file;
  if (!signed?.etag) throw signedDownloadPreconditionError();

  const signedContentType = normalizeStorageContentType(signed.contentType);
  const actualContentType = normalizeStorageContentType(object.httpMetadata?.contentType);
  if (
    object.etag !== signed.etag
    || object.size !== signed.size
    || actualContentType !== signedContentType
  ) {
    throw signedDownloadPreconditionError();
  }
}

function hasR2Body(object: R2Object | R2ObjectBody): object is R2ObjectBody {
  return 'body' in object;
}

function parseDownloadRange(header: string | undefined, size: number): ParsedDownloadRange {
  if (!header) return { kind: 'full' };
  const match = header.trim().match(/^bytes=(.+)$/i);
  if (!match) return { kind: 'full' };
  const range = match[1]?.trim() ?? '';
  if (!range || range.includes(',')) return { kind: 'unsatisfiable' };

  const [rawStart, rawEnd] = range.split('-', 2);
  if (rawStart === undefined || rawEnd === undefined) return { kind: 'unsatisfiable' };

  let offset: number;
  let end: number;

  if (rawStart === '') {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0 || size <= 0) {
      return { kind: 'unsatisfiable' };
    }
    offset = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    const start = Number(rawStart);
    const requestedEnd = rawEnd === '' ? size - 1 : Number(rawEnd);
    if (
      !Number.isSafeInteger(start)
      || !Number.isSafeInteger(requestedEnd)
      || start < 0
      || requestedEnd < start
      || start >= size
    ) {
      return { kind: 'unsatisfiable' };
    }
    offset = start;
    end = Math.min(requestedEnd, size - 1);
  }

  return { kind: 'partial', offset, end, length: end - offset + 1 };
}

function createDownloadHeaders(meta: R2FileMeta, signedClaims?: SignedTokenClaims | null): Headers {
  const headers = new Headers();
  applyStorageContentSecurityHeaders(headers, meta.key, meta.contentType);
  if (meta.etag) {
    headers.set('ETag', meta.etag);
  }
  headers.set('Accept-Ranges', 'bytes');
  if (meta.uploadedAt) {
    const uploadedAt = new Date(meta.uploadedAt);
    if (!Number.isNaN(uploadedAt.getTime())) {
      headers.set('Last-Modified', uploadedAt.toUTCString());
    }
  }
  if (signedClaims) {
    const maxAge = Math.max(0, Math.floor((signedClaims.expiresAt - Date.now()) / 1000));
    if (maxAge > 0) {
      headers.set('Cache-Control', `private, max-age=${Math.min(maxAge, 3600)}`);
    }
  }
  return headers;
}

const STORAGE_OFFSET_CURSOR_PREFIX = 'offset:';

function parseStorageListInteger(raw: string | undefined, name: string, fallback: number): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new EdgeBaseError(400, `Invalid ${name}: must be a non-negative integer.`, undefined, 'validation-failed');
  }
  return parsed;
}

async function listStorageObjects(
  storage: R2Bucket,
  options: { prefix: string; limit: number; cursor?: string; offset?: number },
): Promise<{ objects: R2Object[]; truncated: boolean; cursor: string | null }> {
  const limit = Math.min(Math.max(options.limit, 1), 1000);
  const rawCursor = options.cursor;
  const usesOffsetCursor = !!rawCursor && rawCursor.startsWith(STORAGE_OFFSET_CURSOR_PREFIX);

  if (!usesOffsetCursor && (options.offset ?? 0) === 0) {
    const listed = await storage.list({
      prefix: options.prefix,
      cursor: rawCursor,
      limit,
    });
    return {
      objects: listed.objects,
      truncated: listed.truncated,
      cursor: listed.truncated ? listed.cursor : null,
    };
  }

  const baseOffset = usesOffsetCursor
    ? parseStorageListInteger(rawCursor!.slice(STORAGE_OFFSET_CURSOR_PREFIX.length), 'storage cursor offset', 0)
    : (options.offset ?? 0);
  let remainingOffset = baseOffset;
  const collected: R2Object[] = [];
  let cursor: string | undefined;
  const targetCount = limit + 1;

  while (collected.length < targetCount) {
    const pageLimit = Math.min(1000, Math.max(1, remainingOffset + (targetCount - collected.length)));
    const listed = await storage.list({
      prefix: options.prefix,
      cursor,
      limit: pageLimit,
    });

    if (remainingOffset >= listed.objects.length) {
      remainingOffset -= listed.objects.length;
    } else {
      collected.push(...listed.objects.slice(remainingOffset));
      remainingOffset = 0;
    }

    if (!listed.truncated) {
      const hasMore = collected.length > limit;
      return {
        objects: collected.slice(0, limit),
        truncated: hasMore,
        cursor: hasMore ? `${STORAGE_OFFSET_CURSOR_PREFIX}${baseOffset + limit}` : null,
      };
    }

    cursor = listed.cursor;
  }

  return {
    objects: collected.slice(0, limit),
    truncated: true,
    cursor: `${STORAGE_OFFSET_CURSOR_PREFIX}${baseOffset + limit}`,
  };
}

/**
 * Local R2 emulation can transiently miss freshly uploaded objects on `head()`
 * even though `get()` succeeds immediately. Fall back to `get()` so metadata,
 * exists, and delete stay consistent with download semantics.
 */
async function getStoredObject(
  storage: R2Bucket,
  fullKey: string,
): Promise<R2Object | R2ObjectBody | null> {
  const headed = await storage.head(fullKey);
  if (headed) {
    return headed;
  }

  return storage.get(fullKey);
}

function decodeStorageKey(rawKey: string): string {
  return rawKey
    .split('/')
    .map((segment) => decodeURIComponent(segment))
    .join('/');
}

function getCatchAllTail(c: Context<HonoEnv>, bucketName: string): string | null {
  const marker = `/api/storage/${bucketName}/`;
  if (!c.req.path.startsWith(marker)) {
    return null;
  }

  return c.req.path.slice(marker.length);
}

function resolveStorageKey(
  c: Context<HonoEnv>,
  bucketName: string,
  options?: { suffix?: string },
): string {
  const key = resolveStorageKeyRaw(c, bucketName, options);
  // Every caller of resolveStorageKey targets a single object (download, delete,
  // HEAD, metadata get/update), so an empty key or a path-traversal segment is
  // always invalid here. Validating centrally closes the gap where the read/
  // delete/HEAD/metadata paths reached R2 without the checks the upload and
  // signed-URL paths already run.
  validateStorageKey(key);
  return key;
}

function resolveStorageKeyRaw(
  c: Context<HonoEnv>,
  bucketName: string,
  options?: { suffix?: string },
): string {
  const directKey = c.req.param('key');
  if (directKey) {
    return directKey;
  }

  const tail = getCatchAllTail(c, bucketName);
  if (!tail) {
    return '';
  }

  const trimmedTail = options?.suffix && tail.endsWith(options.suffix)
    ? tail.slice(0, -options.suffix.length)
    : tail;

  return decodeStorageKey(trimmedTail);
}

// ─── Storage Hook Helpers ───

/** Get storage hooks for a bucket from config. */
function getStorageHooks(env: Env, bucketName: string): StorageHooks | undefined {
  const config = parseConfig(env);
  return config.storage?.buckets?.[bucketName]?.handlers?.hooks;
}

/** Build StorageHookCtx for Worker context. */
function buildStorageHookCtx(
  env: Env,
  executionCtx: ExecutionContext,
  workerUrl?: string,
): StorageHookCtx {
  const serviceKey = resolveRootServiceKey(parseConfig(env), env);
  const push = buildFunctionPushProxy(workerUrl, serviceKey);

  return {
    waitUntil: (p: Promise<unknown>) => executionCtx.waitUntil(p),
    push: {
      async send(userId: string, payload: { title?: string; body: string }): Promise<void> {
        if (!workerUrl || !serviceKey) return; // No self-call context available — skip push silently
        await push.send(userId, payload).catch((error) => {
          console.warn('[EdgeBase] storage hook push.send failed:', error);
        });
      },
    },
  };
}

// ─── Upload ───

const uploadFile = createRoute({
  operationId: 'uploadFile',
  method: 'post',
  path: '/{bucket}/upload',
  tags: ['client'],
  summary: 'Upload file',
  request: {
    params: z.object({ bucket: z.string() }),
    query: z.object({
      key: z.string().optional().openapi({ description: 'Optional signed upload key echoed from a signed upload URL.' }),
      token: z.string().optional().openapi({ description: 'Optional signed upload token for write-rule-bypassing upload grants.' }),
    }),
    body: { content: { 'multipart/form-data': { schema: z.object({}).passthrough() } }, required: true },
  },
  responses: {
    201: { description: 'File uploaded', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
    413: { description: 'Payload too large', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

storage.openapi(uploadFile, async (c) => {
  const bucketName = c.req.param('bucket')!;
  const { bucketConfig, release } = getBucketConfig(c.env, bucketName);

  // Security: signed upload token OR write rule
  const token = c.req.query('token');
  const tokenKey = c.req.query('key');
  let skipRules = false;
  let signedClaims: SignedTokenClaims | null = null;

  if (token && tokenKey) {
    const secret = c.env.JWT_USER_SECRET;
    if (secret) {
      const verified = await verifySignedToken(token, tokenKey, bucketName, secret);
      if (verified.valid && verified.claims.purpose === 'upload') {
        // A signed URL authorizes exactly one request attempt, not one
        // successful parse. Consume before reading attacker-controlled body
        // bytes so malformed and oversized replays cannot multiply ingress or
        // Worker memory cost with the same grant.
        await consumeSignedUploadGrant(c.env.STORAGE, verified.claims);
        skipRules = true;
        signedClaims = verified.claims;
      }
    }
    // secret absent → ignore token, fall through to rule evaluation (asymmetric fail-closed,)
  }

  // Parse multipart form data first — needed to get actual file size/type for write rule (§19)
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    throw new EdgeBaseError(400, 'Expected multipart/form-data request body.', undefined, 'validation-failed');
  }
  const file = formData.get('file') as File | null;
  const key = formData.get('key') as string | null;
  const customMetadataStr = formData.get('customMetadata') as string | null;

  if (!file || !key) {
    throw new EdgeBaseError(400, 'Missing required fields: file and key.', undefined, 'validation-failed');
  }
  validateStorageKey(key);
  const contentType = normalizeStorageContentType(file.type);
  if (skipRules && tokenKey !== key) {
    throw new EdgeBaseError(400, 'Signed upload key mismatch between query and form body.', undefined, 'validation-failed');
  }

  if (signedClaims?.maxBytes != null && file.size > signedClaims.maxBytes) {
    throw new EdgeBaseError(413, `Signed upload exceeds maxFileSize of ${signedClaims.maxBytes} bytes.`, undefined, 'payload-too-large');
  }

  if (!skipRules) {
    const serviceKeyBypass = checkServiceKey(c.env, c.req.header('X-EdgeBase-Service-Key'), `storage:bucket:${bucketName}:write`, c.req);
    if (!serviceKeyBypass) {
      const auth = c.get('auth') as AuthContext | null;
      // §19: WriteFileMeta uses actual file metadata from form data
      const writeFileMeta: WriteFileMeta = {
        size: file.size,
        contentType,
        key: key,
      };
      checkStorageRule(bucketConfig.access?.write, auth, writeFileMeta, 'write', bucketName, release);
    }
  }

  // §5/§19: maxFileSize/allowedMimeTypes removed — write rule handles validation.
  // Parse custom metadata
  let customMetadata: Record<string, string> = {};
  if (customMetadataStr) {
    try { customMetadata = JSON.parse(customMetadataStr); } catch { /* ignore */ }
  }

  const auth = c.get('auth') as AuthContext | null;
  if (auth?.id) {
    customMetadata.uploadedBy = auth.id as string;
  }

  // Plugin blocking storage hooks (beforeUpload)
  const pluginMeta = await executeBlockingStorageHooks('beforeUpload', { key, bucket: bucketName, size: file.size, contentType } as WriteFileMeta & { bucket: string }, auth, c.env, getWorkerUrl(c.req.url, c.env));
  if (pluginMeta) Object.assign(customMetadata, pluginMeta);

  // beforeUpload hook — blocking, can inject custom metadata or reject
  const hooks = getStorageHooks(c.env, bucketName);
  if (hooks?.beforeUpload) {
    const writeFileMeta: WriteFileMeta = { size: file.size, contentType, key };
    const hookCtx = buildStorageHookCtx(c.env, c.executionCtx, getWorkerUrl(c.req.url, c.env));
    let extraMeta: Record<string, string> | void;
    try {
      extraMeta = await hooks.beforeUpload(auth, writeFileMeta, hookCtx);
    } catch (error) {
      throw normalizeStorageHookError(error, 'beforeUpload');
    }
    if (extraMeta && typeof extraMeta === 'object') {
      Object.assign(customMetadata, extraMeta);
    }
  }

  // Upload to R2 — use arrayBuffer() instead of stream() for wrangler dev compatibility.
  // ReadableStream uploads can return null in wrangler local R2 emulation.
  const fullKey = r2Key(bucketName, key);
  const buf = await file.arrayBuffer();
  const obj = await c.env.STORAGE.put(fullKey, buf, {
    httpMetadata: {
      contentType,
    },
    customMetadata,
  });

  if (!obj) {
    throw new EdgeBaseError(500, `Failed to upload file '${key}' to bucket '${bucketName}'. R2 put() returned null — check that the STORAGE R2 binding is correctly configured in wrangler.toml and the bucket exists.`, undefined, 'internal-error');
  }

  // afterUpload hook — fire-and-forget (config-level)
  if (hooks?.afterUpload) {
    const meta = buildMetadata(obj);
    const hookCtx = buildStorageHookCtx(c.env, c.executionCtx, getWorkerUrl(c.req.url, c.env));
    c.executionCtx.waitUntil(
      Promise.resolve(hooks.afterUpload(auth, meta, hookCtx)).catch((err) => {
        console.error('[EdgeBase] afterUpload hook error:', err);
      }),
    );
  }

  // afterUpload — plugin-registered storage hooks (metadata only, non-blocking)
  executeStorageHooks('afterUpload', { ...buildMetadata(obj), bucket: bucketName }, auth, c.executionCtx, c.env, getWorkerUrl(c.req.url, c.env));

  return c.json(buildMetadata(obj), 201);
});

// ─── Metadata ───

const getFileMetadata = createRoute({
  operationId: 'getFileMetadata',
  method: 'get',
  path: '/{bucket}/{key}/metadata',
  tags: ['client'],
  summary: 'Get file metadata',
  request: {
    params: z.object({ bucket: z.string(), key: z.string() }),
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

const handleGetFileMetadata = async (c: Context<HonoEnv>) => {
  const bucketName = c.req.param('bucket')!;
  const key = resolveStorageKey(c, bucketName, { suffix: '/metadata' });
  const { bucketConfig, release } = getBucketConfig(c.env, bucketName);

  const fullKey = r2Key(bucketName, key);
  const obj = await getStoredObject(c.env.STORAGE, fullKey);
  if (!obj) {
    throw new EdgeBaseError(404, 'File not found.', undefined, 'not-found');
  }

  // Security: check read rule with resource context
  const serviceKeyBypass = checkServiceKey(c.env, c.req.header('X-EdgeBase-Service-Key'), `storage:bucket:${bucketName}:read`, c.req);
  if (!serviceKeyBypass) {
    const auth = c.get('auth') as AuthContext | null;
    const resource = buildMetadata(obj);
    checkStorageRule(bucketConfig.access?.read, auth, resource, 'read', bucketName, release);
  }

  return c.json(buildMetadata(obj));
};
storage.openapi(getFileMetadata, handleGetFileMetadata);

const updateFileMetadata = createRoute({
  operationId: 'updateFileMetadata',
  method: 'patch',
  path: '/{bucket}/{key}/metadata',
  tags: ['client'],
  summary: 'Update file metadata',
  request: {
    params: z.object({ bucket: z.string(), key: z.string() }),
    body: { content: { 'application/json': { schema: z.object({ customMetadata: z.record(z.string(), z.string()).optional(), contentType: z.string().optional() }) } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

const handleUpdateFileMetadata = async (c: Context<HonoEnv>) => {
  const bucketName = c.req.param('bucket')!;
  const key = resolveStorageKey(c, bucketName, { suffix: '/metadata' });
  const { bucketConfig, release } = getBucketConfig(c.env, bucketName);

  const fullKey = r2Key(bucketName, key);
  const existing = await c.env.STORAGE.get(fullKey);
  if (!existing) {
    throw new EdgeBaseError(404, 'File not found.', undefined, 'not-found');
  }

  // Security: check write rule (metadata update = write)
  const serviceKeyBypass = checkServiceKey(c.env, c.req.header('X-EdgeBase-Service-Key'), `storage:bucket:${bucketName}:write`, c.req);
  if (!serviceKeyBypass) {
    const auth = c.get('auth') as AuthContext | null;
    const resource = buildMetadata(existing);
    checkStorageRule(bucketConfig.access?.write, auth, resource, 'write', bucketName, release);
  }

  const body = await c.req.json<{ customMetadata?: Record<string, string>; contentType?: string }>();
  const newCustomMetadata = { ...existing.customMetadata, ...body.customMetadata };
  const newContentType = normalizeStorageContentType(
    body.contentType || existing.httpMetadata?.contentType,
  );

  // R2 doesn't support metadata-only update — re-put with same body
  const obj = await c.env.STORAGE.put(fullKey, existing.body, {
    httpMetadata: { contentType: newContentType },
    customMetadata: newCustomMetadata,
  });

  if (!obj) {
    throw new EdgeBaseError(500, 'Failed to update metadata.', undefined, 'internal-error');
  }

  // onMetadataUpdate — plugin-registered storage hooks (metadata only, non-blocking)
  executeStorageHooks('onMetadataUpdate', { ...buildMetadata(obj), bucket: bucketName }, c.get('auth') as AuthContext | null, c.executionCtx, c.env, getWorkerUrl(c.req.url, c.env));

  return c.json(buildMetadata(obj));
};
storage.openapi(updateFileMetadata, handleUpdateFileMetadata);

// ─── Exists (HEAD) ───

const checkFileExists = createRoute({
  operationId: 'checkFileExists',
  method: 'head',
  path: '/{bucket}/{key}',
  tags: ['client'],
  summary: 'Check if file exists',
  request: {
    params: z.object({ bucket: z.string(), key: z.string() }),
  },
  responses: {
    200: { description: 'File exists' },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
    412: { description: 'Signed object version changed', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

const handleCheckFileExists = async (c: Context<HonoEnv>) => {
  const bucketName = c.req.param('bucket')!;
  const key = resolveStorageKey(c, bucketName);
  const { bucketConfig, release } = getBucketConfig(c.env, bucketName);
  const signedClaims = await verifySignedDownloadQuery(c, bucketName, key);

  const fullKey = r2Key(bucketName, key);
  const obj = await getStoredObject(c.env.STORAGE, fullKey);
  if (!obj) {
    throw new EdgeBaseError(404, 'File not found.', undefined, 'not-found');
  }
  assertSignedDownloadObjectMatches(signedClaims, obj);
  const fileMeta = buildMetadata(obj);

  // Security: check read rule
  const serviceKeyBypass = signedClaims
    ? false
    : checkServiceKey(c.env, c.req.header('X-EdgeBase-Service-Key'), `storage:bucket:${bucketName}:read`, c.req);
  if (!signedClaims && !serviceKeyBypass) {
    const auth = c.get('auth') as AuthContext | null;
    checkStorageRule(bucketConfig.access?.read, auth, fileMeta, 'read', bucketName, release);
  }

  const headers = createDownloadHeaders(fileMeta, signedClaims);
  headers.set('Content-Length', String(fileMeta.size));
  return new Response(null, { status: 200, headers });
};
storage.openapi(checkFileExists, handleCheckFileExists);

// ─── Multipart Upload Resume (M17) ───
// Must come before the /:key{.+} catch-all to avoid route shadowing

const getUploadParts = createRoute({
  operationId: 'getUploadParts',
  method: 'get',
  path: '/{bucket}/uploads/{uploadId}/parts',
  tags: ['client'],
  summary: 'Get uploaded parts',
  request: {
    params: z.object({ bucket: z.string(), uploadId: z.string() }),
    query: z.object({
      key: z.string(),
      token: z.string().optional().openapi({ description: 'Optional signed upload token for write-rule-bypassing upload grants.' }),
    }),
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

storage.openapi(getUploadParts, async (c) => {
  const bucketName = c.req.param('bucket')!;
  const uploadId = c.req.param('uploadId')!;
  const { bucketConfig, release } = getBucketConfig(c.env, bucketName);
  const key = c.req.query('key');

  if (!key) {
    throw new EdgeBaseError(400, 'Missing required query param: key.', undefined, 'validation-failed');
  }

  // Security: check write rule (resume upload = write operation)
  const signedClaims = await verifySignedUploadQuery(c, bucketName, key, uploadId);
  const serviceKeyBypass = signedClaims
    ? false
    : checkServiceKey(c.env, c.req.header('X-EdgeBase-Service-Key'), `storage:bucket:${bucketName}:write`, c.req);
  if (!signedClaims && !serviceKeyBypass) {
    const auth = c.get('auth') as AuthContext | null;
    checkStorageRule(bucketConfig.access?.write, auth, null, 'write', bucketName, release);
  }

  const kvKey = partTrackingKey(bucketName, key, uploadId);
  const parts = await c.env.KV.get(kvKey, 'json') as TrackedMultipartPart[] | null;

  return c.json({
    uploadId,
    key,
    parts: parts || [],
  });
});

const downloadFile = createRoute({
  operationId: 'downloadFile',
  method: 'get',
  path: '/{bucket}/{key}',
  tags: ['client'],
  summary: 'Download file',
  request: {
    params: z.object({ bucket: z.string(), key: z.string() }),
  },
  responses: {
    200: { description: 'File content' },
    206: { description: 'Partial file content' },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
    412: { description: 'Signed object version changed', content: { 'application/json': { schema: errorResponseSchema } } },
    416: { description: 'Range not satisfiable' },
  },
});

const handleDownloadFile = async (c: Context<HonoEnv>) => {
  const bucketName = c.req.param('bucket')!;
  const key = resolveStorageKey(c, bucketName);
  const { bucketConfig, release } = getBucketConfig(c.env, bucketName);

  const signedClaims = await verifySignedDownloadQuery(c, bucketName, key);
  const skipRules = signedClaims !== null;

  const fullKey = r2Key(bucketName, key);
  const rangeHeader = c.req.header('Range') ?? c.req.header('range');
  let fileMeta: R2FileMeta | null = null;
  let bodyObj: R2ObjectBody | null = null;

  if (rangeHeader) {
    const file = await c.env.STORAGE.head(fullKey);
    if (!file) {
      throw new EdgeBaseError(404, 'File not found.', undefined, 'not-found');
    }
    assertSignedDownloadObjectMatches(signedClaims, file);
    fileMeta = buildMetadata(file);
  } else {
    const expectedEtag = signedClaims?.file?.etag;
    const file = await c.env.STORAGE.get(
      fullKey,
      expectedEtag ? { onlyIf: { etagMatches: expectedEtag } } : undefined,
    );
    if (!file) {
      throw new EdgeBaseError(404, 'File not found.', undefined, 'not-found');
    }
    assertSignedDownloadObjectMatches(signedClaims, file);
    if (!hasR2Body(file)) throw signedDownloadPreconditionError();
    fileMeta = buildMetadata(file);
    bodyObj = file;
  }

  // Security: check read rule
  if (!skipRules) {
    const serviceKeyBypass = checkServiceKey(c.env, c.req.header('X-EdgeBase-Service-Key'), `storage:bucket:${bucketName}:read`, c.req);
    if (!serviceKeyBypass) {
      const auth = c.get('auth') as AuthContext | null;
      checkStorageRule(bucketConfig.access?.read, auth, fileMeta, 'read', bucketName, release);
    }
  }

  // Plugin blocking storage hooks (beforeDownload)
  {
    const dlAuth = c.get('auth') as AuthContext | null;
    await executeBlockingStorageHooks('beforeDownload', { ...fileMeta, bucket: bucketName }, dlAuth, c.env, getWorkerUrl(c.req.url, c.env));
  }

  // beforeDownload hook — blocking, throw to reject
  const hooks = getStorageHooks(c.env, bucketName);
  if (hooks?.beforeDownload) {
    const auth = c.get('auth') as AuthContext | null;
    const hookCtx = buildStorageHookCtx(c.env, c.executionCtx, getWorkerUrl(c.req.url, c.env));
    try {
      await hooks.beforeDownload(auth, fileMeta, hookCtx);
    } catch (error) {
      throw normalizeStorageHookError(error, 'beforeDownload');
    }
  }

  const parsedRange = parseDownloadRange(rangeHeader, fileMeta.size);
  const headers = createDownloadHeaders(fileMeta, skipRules ? signedClaims : null);

  if (parsedRange.kind === 'unsatisfiable') {
    headers.set('Content-Range', `bytes */${fileMeta.size}`);
    headers.set('Content-Length', '0');
    return new Response(null, { status: 416, headers });
  }

  if (parsedRange.kind === 'partial') {
    const expectedEtag = signedClaims?.file?.etag;
    const rangedObj = await c.env.STORAGE.get(fullKey, {
      ...(expectedEtag ? { onlyIf: { etagMatches: expectedEtag } } : {}),
      range: { offset: parsedRange.offset, length: parsedRange.length },
    });
    if (!rangedObj) {
      throw new EdgeBaseError(404, 'File not found.', undefined, 'not-found');
    }
    assertSignedDownloadObjectMatches(signedClaims, rangedObj);
    if (!hasR2Body(rangedObj)) throw signedDownloadPreconditionError();
    headers.set('Content-Length', String(parsedRange.length));
    headers.set('Content-Range', `bytes ${parsedRange.offset}-${parsedRange.end}/${fileMeta.size}`);
    return new Response(rangedObj.body, { status: 206, headers });
  }

  if (!bodyObj) {
    const expectedEtag = signedClaims?.file?.etag;
    const object = await c.env.STORAGE.get(
      fullKey,
      expectedEtag ? { onlyIf: { etagMatches: expectedEtag } } : undefined,
    );
    if (!object) {
      throw new EdgeBaseError(404, 'File not found.', undefined, 'not-found');
    }
    assertSignedDownloadObjectMatches(signedClaims, object);
    if (!hasR2Body(object)) throw signedDownloadPreconditionError();
    bodyObj = object;
  }
  headers.set('Content-Length', String(fileMeta.size));
  return new Response(bodyObj.body, { headers });
};
storage.openapi(downloadFile, handleDownloadFile);

// ─── List ───

const listFiles = createRoute({
  operationId: 'listFiles',
  method: 'get',
  path: '/{bucket}',
  tags: ['client'],
  summary: 'List files in bucket',
  request: {
    params: z.object({ bucket: z.string() }),
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

storage.openapi(listFiles, async (c) => {
  const bucketName = c.req.param('bucket')!;
  const { bucketConfig, release } = getBucketConfig(c.env, bucketName);

  // Security: check read rule (list = read)
  const serviceKeyBypass = checkServiceKey(c.env, c.req.header('X-EdgeBase-Service-Key'), `storage:bucket:${bucketName}:read`, c.req);
  if (!serviceKeyBypass) {
    const auth = c.get('auth') as AuthContext | null;
    checkStorageRule(bucketConfig.access?.read, auth, null, 'read', bucketName, release);
  }

  const prefix = c.req.query('prefix') || '';
  const cursor = c.req.query('cursor') || undefined;
  const limit = parseStorageListInteger(c.req.query('limit'), 'storage limit', 100);
  const offset = parseStorageListInteger(c.req.query('offset'), 'storage offset', 0);

  const fullPrefix = r2Key(bucketName, prefix);
  const listed = await listStorageObjects(c.env.STORAGE, {
    prefix: fullPrefix,
    cursor,
    limit,
    offset,
  });

  const files = listed.objects.map(obj => buildMetadata(obj));

  return c.json({
    files,
    cursor: listed.truncated ? listed.cursor : null,
    truncated: listed.truncated,
  });
});

// ─── Delete ───

const deleteFile = createRoute({
  operationId: 'deleteFile',
  method: 'delete',
  path: '/{bucket}/{key}',
  tags: ['client'],
  summary: 'Delete file',
  request: {
    params: z.object({ bucket: z.string(), key: z.string() }),
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

const handleDeleteFile = async (c: Context<HonoEnv>) => {
  const bucketName = c.req.param('bucket')!;
  const key = resolveStorageKey(c, bucketName);
  const { bucketConfig, release } = getBucketConfig(c.env, bucketName);

  const fullKey = r2Key(bucketName, key);

  // Get existing file for resource context
  const existing = await getStoredObject(c.env.STORAGE, fullKey);
  if (!existing) {
    throw new EdgeBaseError(404, 'File not found.', undefined, 'not-found');
  }

  // Security: check delete rule
  const serviceKeyBypass = checkServiceKey(c.env, c.req.header('X-EdgeBase-Service-Key'), `storage:bucket:${bucketName}:delete`, c.req);
  if (!serviceKeyBypass) {
    const auth = c.get('auth') as AuthContext | null;
    const resource = buildMetadata(existing);
    checkStorageRule(bucketConfig.access?.delete, auth, resource, 'delete', bucketName, release);
  }

  // Plugin blocking storage hooks (beforeDelete)
  const auth = c.get('auth') as AuthContext | null;
  const fileMeta = buildMetadata(existing);
  await executeBlockingStorageHooks('beforeDelete', { ...fileMeta, bucket: bucketName }, auth, c.env, getWorkerUrl(c.req.url, c.env));

  // beforeDelete hook — blocking, throw to reject
  const hooks = getStorageHooks(c.env, bucketName);
  if (hooks?.beforeDelete) {
    const hookCtx = buildStorageHookCtx(c.env, c.executionCtx, getWorkerUrl(c.req.url, c.env));
    try {
      await hooks.beforeDelete(auth, fileMeta, hookCtx);
    } catch (error) {
      throw normalizeStorageHookError(error, 'beforeDelete');
    }
  }

  await c.env.STORAGE.delete(fullKey);

  // afterDelete hook — fire-and-forget (config-level)
  if (hooks?.afterDelete) {
    const hookCtx = buildStorageHookCtx(c.env, c.executionCtx, getWorkerUrl(c.req.url, c.env));
    c.executionCtx.waitUntil(
      Promise.resolve(hooks.afterDelete(auth, fileMeta, hookCtx)).catch((err) => {
        console.error('[EdgeBase] afterDelete hook error:', err);
      }),
    );
  }

  // afterDelete — plugin-registered storage hooks (metadata only, non-blocking)
  executeStorageHooks('afterDelete', { ...fileMeta, bucket: bucketName }, auth, c.executionCtx, c.env, getWorkerUrl(c.req.url, c.env));

  return c.json({ ok: true });
};
storage.openapi(deleteFile, handleDeleteFile);

// ─── Batch Delete ───

const deleteBatch = createRoute({
  operationId: 'deleteBatch',
  method: 'post',
  path: '/{bucket}/delete-batch',
  tags: ['client'],
  summary: 'Batch delete files',
  request: {
    params: z.object({ bucket: z.string() }),
    body: { content: { 'application/json': { schema: z.object({ keys: z.array(z.string()) }) } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

storage.openapi(deleteBatch, async (c) => {
  const bucketName = c.req.param('bucket')!;
  const { bucketConfig, release } = getBucketConfig(c.env, bucketName);

  const body = await c.req.json<{ keys: string[] }>();
  if (!body.keys || !Array.isArray(body.keys) || body.keys.length === 0) {
    throw new EdgeBaseError(400, 'Missing required field: keys (non-empty array).', undefined, 'validation-failed');
  }
  if (body.keys.length > 100) {
    throw new EdgeBaseError(400, 'Maximum 100 keys per batch delete request.', undefined, 'validation-failed');
  }

  const serviceKeyBypass = checkServiceKey(c.env, c.req.header('X-EdgeBase-Service-Key'), `storage:bucket:${bucketName}:delete`, c.req);
  const auth = c.get('auth') as AuthContext | null;
  const hooks = getStorageHooks(c.env, bucketName);

  const deleted: string[] = [];
  const failed: Array<{ key: string; error: string }> = [];

  for (const key of body.keys) {
    try {
      validateStorageKey(key);
      const fullKey = r2Key(bucketName, key);
      const existing = await getStoredObject(c.env.STORAGE, fullKey);
      if (!existing) {
        failed.push({ key, error: 'File not found.' });
        continue;
      }

      if (!serviceKeyBypass) {
        const resource = buildMetadata(existing);
        checkStorageRule(bucketConfig.access?.delete, auth, resource, 'delete', bucketName, release);
      }

      // Plugin blocking storage hooks (beforeDelete — batch)
      const fileMeta = buildMetadata(existing);
      await executeBlockingStorageHooks('beforeDelete', { ...fileMeta, bucket: bucketName }, auth, c.env, getWorkerUrl(c.req.url, c.env));

      // beforeDelete hook — blocking, throw to reject
      if (hooks?.beforeDelete) {
        const hookCtx = buildStorageHookCtx(c.env, c.executionCtx, getWorkerUrl(c.req.url, c.env));
        try {
          await hooks.beforeDelete(auth, fileMeta, hookCtx);
        } catch (error) {
          throw normalizeStorageHookError(error, 'beforeDelete');
        }
      }

      await c.env.STORAGE.delete(fullKey);
      deleted.push(key);

      // afterDelete hook — fire-and-forget (config-level)
      if (hooks?.afterDelete) {
        const hookCtx = buildStorageHookCtx(c.env, c.executionCtx, getWorkerUrl(c.req.url, c.env));
        c.executionCtx.waitUntil(
          Promise.resolve(hooks.afterDelete(auth, fileMeta, hookCtx)).catch((err) => {
            console.error('[EdgeBase] afterDelete hook error (batch):', err);
          }),
        );
      }

      // afterDelete — plugin-registered storage hooks (per-file, non-blocking)
      executeStorageHooks('afterDelete', { ...fileMeta, bucket: bucketName }, auth, c.executionCtx, c.env, getWorkerUrl(c.req.url, c.env));
    } catch (e) {
      const msg = e instanceof EdgeBaseError
        ? e.message
        : 'Delete failed with an unexpected storage error. Check worker logs for details.';
      failed.push({ key, error: msg });
    }
  }

  return c.json({ deleted, failed });
});

// ─── Signed URL (for private downloads) ───

const createSignedDownloadUrl = createRoute({
  operationId: 'createSignedDownloadUrl',
  method: 'post',
  path: '/{bucket}/signed-url',
  tags: ['client'],
  summary: 'Create signed download URL',
  request: {
    params: z.object({ bucket: z.string() }),
    body: { content: { 'application/json': { schema: z.object({ key: z.string(), expiresIn: z.string().optional() }) } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

storage.openapi(createSignedDownloadUrl, async (c) => {
  const bucketName = c.req.param('bucket')!;
  const { bucketConfig, release } = getBucketConfig(c.env, bucketName);

  const body = await c.req.json<{ key: string; expiresIn?: string }>();
  if (!body.key) {
    throw new EdgeBaseError(400, 'Missing required field: key.', undefined, 'validation-failed');
  }
  validateStorageKey(body.key);

  // Check file exists
  const fullKey = r2Key(bucketName, body.key);
  const obj = await c.env.STORAGE.head(fullKey);
  if (!obj) {
    throw new EdgeBaseError(404, 'File not found.', undefined, 'not-found');
  }

  // A signed URL delegates this exact object's read authority. Evaluate the
  // rule against its real metadata just like a direct download; a bucket/list
  // check with an empty resource must never authorize every key in the bucket.
  const serviceKeyBypass = checkServiceKey(c.env, c.req.header('X-EdgeBase-Service-Key'), `storage:bucket:${bucketName}:read`, c.req);
  if (!serviceKeyBypass) {
    const auth = c.get('auth') as AuthContext | null;
    checkStorageRule(bucketConfig.access?.read, auth, buildMetadata(obj), 'read', bucketName, release);
  }

  const expiresInMs = parseDuration(body.expiresIn || '1h');
  const expiresAt = Date.now() + expiresInMs;

  // Fail-closed: refuse to create signed URL without secret
  const secret = c.env.JWT_USER_SECRET;
  if (!secret) {
    throw new EdgeBaseError(500, 'Signed URLs require JWT_USER_SECRET to be configured.', undefined, 'internal-error');
  }
  const token = await createSignedToken(body.key, bucketName, expiresAt, secret, {
    file: signedFileMetadataFromObject(obj),
  });

  // Build signed URL
  const signedUrl = new URL(
    `/api/storage/${encodeURIComponent(bucketName)}/${encodeURIComponent(body.key)}`,
    resolvePublicRequestOrigin(c.env, c.req),
  );
  signedUrl.searchParams.set('token', token);

  return c.json({ url: signedUrl.href, expiresAt: new Date(expiresAt).toISOString() });
});

// ─── Batch Signed URLs ───

const createSignedDownloadUrls = createRoute({
  operationId: 'createSignedDownloadUrls',
  method: 'post',
  path: '/{bucket}/signed-urls',
  tags: ['client'],
  summary: 'Batch create signed download URLs',
  request: {
    params: z.object({ bucket: z.string() }),
    body: { content: { 'application/json': { schema: z.object({ keys: z.array(z.string()), expiresIn: z.string().optional() }) } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

storage.openapi(createSignedDownloadUrls, async (c) => {
  const bucketName = c.req.param('bucket')!;
  const { bucketConfig, release } = getBucketConfig(c.env, bucketName);

  const body = await c.req.json<{ keys: string[]; expiresIn?: string }>();
  if (!body.keys || !Array.isArray(body.keys) || body.keys.length === 0) {
    throw new EdgeBaseError(400, 'Missing required field: keys (non-empty array).', undefined, 'validation-failed');
  }
  if (body.keys.length > 100) {
    throw new EdgeBaseError(400, 'Maximum 100 keys per batch signed URL request.', undefined, 'validation-failed');
  }

  const secret = c.env.JWT_USER_SECRET;
  if (!secret) {
    throw new EdgeBaseError(500, 'Signed URLs require JWT_USER_SECRET to be configured.', undefined, 'internal-error');
  }

  const expiresInMs = parseDuration(body.expiresIn || '1h');
  const expiresAt = Date.now() + expiresInMs;
  const publicOrigin = resolvePublicRequestOrigin(c.env, c.req);
  const serviceKeyBypass = checkServiceKey(c.env, c.req.header('X-EdgeBase-Service-Key'), `storage:bucket:${bucketName}:read`, c.req);
  const auth = c.get('auth') as AuthContext | null;

  const urls: Array<{ key: string; url: string; expiresAt: string }> = [];

  for (const key of body.keys) validateStorageKey(key);
  for (const key of body.keys) {
    const fullKey = r2Key(bucketName, key);
    const obj = await c.env.STORAGE.head(fullKey);
    if (!obj) continue; // skip non-existent files

    if (!serviceKeyBypass) {
      checkStorageRule(bucketConfig.access?.read, auth, buildMetadata(obj), 'read', bucketName, release);
    }

    const token = await createSignedToken(key, bucketName, expiresAt, secret, {
      file: signedFileMetadataFromObject(obj),
    });
    const signedUrl = new URL(
      `/api/storage/${encodeURIComponent(bucketName)}/${encodeURIComponent(key)}`,
      publicOrigin,
    );
    signedUrl.searchParams.set('token', token);
    urls.push({
      key,
      url: signedUrl.href,
      expiresAt: new Date(expiresAt).toISOString(),
    });
  }

  return c.json({ urls });
});

// ─── Signed Upload URL ───

const createSignedUploadUrl = createRoute({
  operationId: 'createSignedUploadUrl',
  method: 'post',
  path: '/{bucket}/signed-upload-url',
  tags: ['client'],
  summary: 'Create signed upload URL',
  request: {
    params: z.object({ bucket: z.string() }),
    body: { content: { 'application/json': { schema: z.object({ key: z.string(), expiresIn: z.string().optional(), maxFileSize: z.string().optional() }) } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

storage.openapi(createSignedUploadUrl, async (c) => {
  const bucketName = c.req.param('bucket')!;
  const { bucketConfig, release } = getBucketConfig(c.env, bucketName);

  // Security: check write rule at URL generation time
  const serviceKeyBypass = checkServiceKey(c.env, c.req.header('X-EdgeBase-Service-Key'), `storage:bucket:${bucketName}:write`, c.req);
  if (!serviceKeyBypass) {
    const auth = c.get('auth') as AuthContext | null;
    checkStorageRule(bucketConfig.access?.write, auth, null, 'write', bucketName, release);
  }

  const body = await c.req.json<{ key: string; expiresIn?: string; maxFileSize?: string }>();
  if (!body.key) {
    throw new EdgeBaseError(400, 'Missing required field: key.', undefined, 'validation-failed');
  }
  validateStorageKey(body.key);
  const maxBytes = parseByteSize(body.maxFileSize);

  const expiresInMs = parseDuration(body.expiresIn || '30m');
  const expiresAt = Date.now() + expiresInMs;

  // Fail-closed: refuse to create signed URL without secret
  const secret = c.env.JWT_USER_SECRET;
  if (!secret) {
    throw new EdgeBaseError(500, 'Signed URLs require JWT_USER_SECRET to be configured.', undefined, 'internal-error');
  }
  const token = await createSignedUploadToken(body.key, bucketName, expiresAt, secret, maxBytes);

  // Build signed upload URL (uploads go through our Worker endpoint with the token)
  const signedUrl = new URL(
    `/api/storage/${encodeURIComponent(bucketName)}/upload`,
    resolvePublicRequestOrigin(c.env, c.req),
  );
  signedUrl.searchParams.set('token', token);
  signedUrl.searchParams.set('key', body.key);

  // Add uploadedBy from auth context
  const auth = c.get('auth') as AuthContext | null;

  return c.json({
    url: signedUrl.href,
    expiresAt: new Date(expiresAt).toISOString(),
    maxFileSize: body.maxFileSize ?? null,
    uploadedBy: auth?.id || null,
  });
});

// ─── Multipart Upload (7.3) ───

const createMultipartUpload = createRoute({
  operationId: 'createMultipartUpload',
  method: 'post',
  path: '/{bucket}/multipart/create',
  tags: ['client'],
  summary: 'Start multipart upload',
  request: {
    params: z.object({ bucket: z.string() }),
    query: z.object({
      key: z.string().optional().openapi({ description: 'Optional signed upload key echoed from a signed upload URL.' }),
      token: z.string().optional().openapi({ description: 'Optional signed upload token for write-rule-bypassing upload grants.' }),
    }),
    body: { content: { 'application/json': { schema: z.object({ key: z.string(), contentType: z.string().optional(), customMetadata: z.record(z.string(), z.string()).optional() }) } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

storage.openapi(createMultipartUpload, async (c) => {
  const bucketName = c.req.param('bucket')!;
  const { bucketConfig, release } = getBucketConfig(c.env, bucketName);

  const body = await c.req.json<{ key: string; contentType?: string; customMetadata?: Record<string, string> }>();
  if (!body.key) {
    throw new EdgeBaseError(400, 'Missing required field: key.', undefined, 'validation-failed');
  }
  validateStorageKey(body.key);

  // Security: check signed upload token or write rule
  const signedClaims = await verifySignedUploadQuery(c, bucketName, body.key);
  const serviceKeyBypass = signedClaims
    ? false
    : checkServiceKey(c.env, c.req.header('X-EdgeBase-Service-Key'), `storage:bucket:${bucketName}:write`, c.req);
  if (!signedClaims && !serviceKeyBypass) {
    const auth = c.get('auth') as AuthContext | null;
    checkStorageRule(bucketConfig.access?.write, auth, null, 'write', bucketName, release);
  }

  const auth = c.get('auth') as AuthContext | null;
  const customMetadata = body.customMetadata || {};
  if (auth?.id) {
    customMetadata.uploadedBy = auth.id as string;
  }

  const fullKey = r2Key(bucketName, body.key);
  const contentType = normalizeStorageContentType(body.contentType);
  const grantClaim = signedClaims
    ? await claimSignedMultipartUploadGrant(c.env.STORAGE, signedClaims)
    : null;
  let multipartUpload: R2MultipartUpload;
  try {
    multipartUpload = await c.env.STORAGE.createMultipartUpload(fullKey, {
      httpMetadata: { contentType },
      customMetadata,
    });
  } catch (error) {
    if (signedClaims && grantClaim) {
      // The existing creating marker already blocks replay if this best-effort
      // terminal CAS fails, so never release an ambiguous create for retry.
      await terminateSignedMultipartUploadGrant(c.env.STORAGE, signedClaims, grantClaim).catch(() => {});
    }
    throw error;
  }

  if (signedClaims && grantClaim) {
    try {
      await bindSignedMultipartUploadGrant(
        c.env.STORAGE,
        signedClaims,
        grantClaim,
        multipartUpload.uploadId,
      );
    } catch (error) {
      await multipartUpload.abort().catch(() => { /* R2 auto-aborts abandoned sessions. */ });
      await terminateSignedMultipartUploadGrant(c.env.STORAGE, signedClaims, grantClaim).catch(() => {});
      throw error;
    }
  }

  return c.json({
    uploadId: multipartUpload.uploadId,
    key: body.key,
  });
});

const uploadPart = createRoute({
  operationId: 'uploadPart',
  method: 'post',
  path: '/{bucket}/multipart/upload-part',
  tags: ['client'],
  summary: 'Upload a part',
  request: {
    params: z.object({ bucket: z.string() }),
    query: z.object({
      uploadId: z.string(),
      partNumber: z.string(),
      key: z.string(),
      token: z.string().optional().openapi({ description: 'Optional signed upload token for write-rule-bypassing upload grants.' }),
    }),
    body: { content: { 'application/octet-stream': { schema: z.string().openapi({ format: 'binary' }) } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
    413: { description: 'Payload too large', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

storage.openapi(uploadPart, async (c) => {
  const bucketName = c.req.param('bucket')!;
  const { bucketConfig, release } = getBucketConfig(c.env, bucketName);

  const uploadId = c.req.query('uploadId');
  const rawPartNumber = c.req.query('partNumber');
  const partNumber = rawPartNumber && /^\d+$/.test(rawPartNumber)
    ? Number(rawPartNumber)
    : 0;
  const key = c.req.query('key');

  if (!uploadId || !rawPartNumber || !key) {
    throw new EdgeBaseError(400, 'Missing required query params: uploadId, partNumber, key.', undefined, 'validation-failed');
  }
  if (!Number.isSafeInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
    throw new EdgeBaseError(400, 'partNumber must be an integer between 1 and 10000.', undefined, 'validation-failed');
  }
  validateStorageKey(key);

  // Security: check signed upload token or write rule
  const signedClaims = await verifySignedUploadQuery(c, bucketName, key, uploadId);
  const serviceKeyBypass = signedClaims
    ? false
    : checkServiceKey(c.env, c.req.header('X-EdgeBase-Service-Key'), `storage:bucket:${bucketName}:write`, c.req);
  if (!signedClaims && !serviceKeyBypass) {
    const auth = c.get('auth') as AuthContext | null;
    checkStorageRule(bucketConfig.access?.write, auth, null, 'write', bucketName, release);
  }
  const partSize = requestContentLength(c);
  if (signedClaims?.maxBytes != null && partSize == null) {
    throw new EdgeBaseError(400, 'Signed multipart upload parts require Content-Length.', undefined, 'validation-failed');
  }
  if (signedClaims?.maxBytes != null && partSize === 0) {
    throw new EdgeBaseError(400, 'Signed multipart upload parts must contain at least one byte.', undefined, 'validation-failed');
  }

  const fullKey = r2Key(bucketName, key);
  const multipartUpload = c.env.STORAGE.resumeMultipartUpload(fullKey, uploadId);

  if (signedClaims?.maxBytes != null && partSize !== null) {
    const reserved = await reserveSignedMultipartUploadBytes(
      c.env.STORAGE,
      signedClaims,
      uploadId,
      partSize,
    );
    if (!reserved) {
      await multipartUpload.abort().catch(() => { /* Terminal grant state still blocks continuation. */ });
      const kvKey = partTrackingKey(bucketName, key, uploadId);
      await c.env.KV.delete(kvKey).catch(() => { /* best effort */ });
      throw new EdgeBaseError(413, `Signed upload exceeds maxFileSize of ${signedClaims.maxBytes} bytes.`, undefined, 'payload-too-large');
    }
  }

  const part = await multipartUpload.uploadPart(partNumber, c.req.raw.body!);

  // M17: Save part info to KV for resume tracking
  const kvKey = partTrackingKey(bucketName, key, uploadId);
  const existing = await c.env.KV.get(kvKey, 'json') as TrackedMultipartPart[] | null;
  const parts = existing || [];
  // Replace if same partNumber exists (re-upload), otherwise append
  const idx = parts.findIndex(p => p.partNumber === part.partNumber);
  const trackedPart: TrackedMultipartPart = { partNumber: part.partNumber, etag: part.etag };
  if (partSize !== null) trackedPart.size = partSize;
  if (idx >= 0) {
    parts[idx] = trackedPart;
  } else {
    parts.push(trackedPart);
  }
  await c.env.KV.put(kvKey, JSON.stringify(parts), { expirationTtl: PART_TRACKING_TTL });

  return c.json({
    partNumber: part.partNumber,
    etag: part.etag,
  });
});

const completeMultipartUpload = createRoute({
  operationId: 'completeMultipartUpload',
  method: 'post',
  path: '/{bucket}/multipart/complete',
  tags: ['client'],
  summary: 'Complete multipart upload',
  request: {
    params: z.object({ bucket: z.string() }),
    query: z.object({
      key: z.string().optional().openapi({ description: 'Optional signed upload key echoed from a signed upload URL.' }),
      token: z.string().optional().openapi({ description: 'Optional signed upload token for write-rule-bypassing upload grants.' }),
    }),
    body: { content: { 'application/json': { schema: z.object({ uploadId: z.string(), key: z.string(), parts: z.array(z.object({ partNumber: z.number(), etag: z.string() })) }) } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
    413: { description: 'Payload too large', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

storage.openapi(completeMultipartUpload, async (c) => {
  const bucketName = c.req.param('bucket')!;
  const { bucketConfig, release } = getBucketConfig(c.env, bucketName);

  const body = await c.req.json<{
    uploadId: string;
    key: string;
    parts: Array<{ partNumber: number; etag: string }>;
  }>();

  if (!body.uploadId || !body.key || !body.parts?.length) {
    throw new EdgeBaseError(400, 'Missing required fields: uploadId, key, parts.', undefined, 'validation-failed');
  }
  validateStorageKey(body.key);

  // Security: check signed upload token or write rule
  const signedClaims = await verifySignedUploadQuery(c, bucketName, body.key, body.uploadId);
  const serviceKeyBypass = signedClaims
    ? false
    : checkServiceKey(c.env, c.req.header('X-EdgeBase-Service-Key'), `storage:bucket:${bucketName}:write`, c.req);
  if (!signedClaims && !serviceKeyBypass) {
    const auth = c.get('auth') as AuthContext | null;
    checkStorageRule(bucketConfig.access?.write, auth, null, 'write', bucketName, release);
  }
  if (signedClaims?.maxBytes != null) {
    await assertSignedMultipartSizeWithinLimit(c, bucketName, body.key, body.uploadId, body.parts, signedClaims.maxBytes);
  }
  const fullKey = r2Key(bucketName, body.key);
  const multipartUpload = c.env.STORAGE.resumeMultipartUpload(fullKey, body.uploadId);

  const obj = await multipartUpload.complete(body.parts);

  // M17: Clean up KV part tracking data after successful completion
  const kvKey = partTrackingKey(bucketName, body.key, body.uploadId);
  await c.env.KV.delete(kvKey).catch(() => { /* best effort */ });

  // afterUpload — plugin-registered storage hooks (multipart complete, metadata only, non-blocking)
  executeStorageHooks('afterUpload', { ...buildMetadata(obj), bucket: bucketName }, c.get('auth') as AuthContext | null, c.executionCtx, c.env, getWorkerUrl(c.req.url, c.env));

  return c.json(buildMetadata(obj));
});

const abortMultipartUpload = createRoute({
  operationId: 'abortMultipartUpload',
  method: 'post',
  path: '/{bucket}/multipart/abort',
  tags: ['client'],
  summary: 'Abort multipart upload',
  request: {
    params: z.object({ bucket: z.string() }),
    query: z.object({
      key: z.string().optional().openapi({ description: 'Optional signed upload key echoed from a signed upload URL.' }),
      token: z.string().optional().openapi({ description: 'Optional signed upload token for write-rule-bypassing upload grants.' }),
    }),
    body: { content: { 'application/json': { schema: z.object({ uploadId: z.string(), key: z.string() }) } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

storage.openapi(abortMultipartUpload, async (c) => {
  const bucketName = c.req.param('bucket')!;
  const { bucketConfig, release } = getBucketConfig(c.env, bucketName);

  const body = await c.req.json<{ uploadId: string; key: string }>();
  if (!body.uploadId || !body.key) {
    throw new EdgeBaseError(400, 'Missing required fields: uploadId, key.', undefined, 'validation-failed');
  }
  validateStorageKey(body.key);

  // Security: check signed upload token or write rule
  const signedClaims = await verifySignedUploadQuery(c, bucketName, body.key, body.uploadId);
  const serviceKeyBypass = signedClaims
    ? false
    : checkServiceKey(c.env, c.req.header('X-EdgeBase-Service-Key'), `storage:bucket:${bucketName}:write`, c.req);
  if (!signedClaims && !serviceKeyBypass) {
    const auth = c.get('auth') as AuthContext | null;
    checkStorageRule(bucketConfig.access?.write, auth, null, 'write', bucketName, release);
  }
  const fullKey = r2Key(bucketName, body.key);
  const multipartUpload = c.env.STORAGE.resumeMultipartUpload(fullKey, body.uploadId);
  await multipartUpload.abort();

  // M17: Clean up KV part tracking data after abort
  const kvKey = partTrackingKey(bucketName, body.key, body.uploadId);
  await c.env.KV.delete(kvKey).catch(() => { /* best effort */ });

  return c.json({ ok: true });
});

// ─── Subdirectory Key Catch-all Routes ───
// OpenAPI /{bucket}/{key} params only match a single path segment.
// These raw Hono routes use :key{.+} to handle multi-segment keys
// (e.g., "folder/file.txt"). Registered AFTER OpenAPI routes so
// single-segment keys still hit the OpenAPI-registered handlers first.
// Metadata catch-alls cannot rely on `:key{.+}/metadata` in Hono because the
// regexp consumes the suffix into `key`. Use wildcard tail parsing instead.
storage.on('GET', '/:bucket/*', async (c) => {
  const bucketName = c.req.param('bucket')!;
  const tail = getCatchAllTail(c, bucketName);
  if (tail?.endsWith('/metadata')) {
    return handleGetFileMetadata(c);
  }
  return handleDownloadFile(c);
});
storage.on('PATCH', '/:bucket/*', async (c) => {
  const bucketName = c.req.param('bucket')!;
  const tail = getCatchAllTail(c, bucketName);
  if (tail?.endsWith('/metadata')) {
    return handleUpdateFileMetadata(c);
  }
  throw new EdgeBaseError(404, 'Not found.', undefined, 'not-found');
});
storage.on('HEAD', '/:bucket/*', handleCheckFileExists);
storage.on('DELETE', '/:bucket/*', handleDeleteFile);

export { storage as storageRoute };
