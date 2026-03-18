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
  getWorkerUrl,
} from '../lib/functions.js';


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
    async sql(namespace: string, id: string | undefined, query: string, params?: unknown[]) {
      if (workerUrl && serviceKey) {
        const res = await fetch(`${workerUrl}/api/sql`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-EdgeBase-Service-Key': serviceKey },
          body: JSON.stringify({ namespace, id, sql: query, params: params ?? [] }),
        });
        if (!res.ok) throw new Error(`admin.sql() failed: ${res.status}`);
        return res.json();
      }
      throw new Error('admin.sql() requires workerUrl in storage hook context.');
    },
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
    throw new EdgeBaseError(401, 'Unauthorized. Invalid Service Key.', undefined, 'unauthenticated');
  }
  return false; // 'missing' → continue to normal rules
}

type SignedTokenClaims = {
  expiresAt: number;
  maxBytes: number | null;
};

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

  return amount * multiplier;
}

/** Create HMAC-based signed URL token. */
export async function createSignedToken(
  key: string,
  bucket: string,
  expiresAt: number,
  secret: string,
  maxBytes?: number | null,
): Promise<string> {
  const encoder = new TextEncoder();
  const normalizedMaxBytes = typeof maxBytes === 'number' && Number.isFinite(maxBytes)
    ? Math.max(0, Math.trunc(maxBytes))
    : null;
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

/** Verify HMAC-based signed URL token. */
async function verifySignedToken(
  token: string,
  key: string,
  bucket: string,
  secret: string,
): Promise<{ valid: boolean; claims: SignedTokenClaims }> {
  const parts = token.split('.');
  if (parts.length !== 2 && parts.length !== 3) {
    return { valid: false, claims: { expiresAt: 0, maxBytes: null } };
  }
  const expiresAt = parseInt(parts[0]!, 10);
  const maxBytes = parts.length === 3 ? parseInt(parts[1]!, 10) : null;
  const signature = parts[parts.length - 1]!;

  if (isNaN(expiresAt) || Date.now() > expiresAt) {
    return { valid: false, claims: { expiresAt, maxBytes: Number.isFinite(maxBytes ?? NaN) ? maxBytes : null } };
  }
  if (parts.length === 3 && !Number.isFinite(maxBytes)) {
    return { valid: false, claims: { expiresAt, maxBytes: null } };
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
    },
  };
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
    body: { content: { 'multipart/form-data': { schema: z.object({}).passthrough() } }, required: true },
  },
  responses: {
    201: { description: 'File uploaded', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

storage.openapi(uploadFile, async (c) => {
  const bucketName = c.req.param('bucket')!;
  const { bucketConfig, release } = getBucketConfig(c.env, bucketName);

  // Security: signed upload token OR write rule
  const token = c.req.query('token');
  const tokenKey = c.req.query('key');
  let skipRules = false;

  if (token && tokenKey) {
    const secret = c.env.JWT_USER_SECRET;
    if (secret) {
      const verified = await verifySignedToken(token, tokenKey, bucketName, secret);
      if (verified.valid) {
        skipRules = true;
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
  if (skipRules && tokenKey !== key) {
    throw new EdgeBaseError(400, 'Signed upload key mismatch between query and form body.', undefined, 'validation-failed');
  }

  let signedClaims: SignedTokenClaims | null = null;
  if (skipRules && token && tokenKey) {
    const secret = c.env.JWT_USER_SECRET;
    if (secret) {
      const verified = await verifySignedToken(token, tokenKey, bucketName, secret);
      if (verified.valid) {
        signedClaims = verified.claims;
      }
    }
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
        contentType: file.type || 'application/octet-stream',
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
  const pluginMeta = await executeBlockingStorageHooks('beforeUpload', { key, bucket: bucketName, size: file.size, contentType: file.type || 'application/octet-stream' } as WriteFileMeta & { bucket: string }, auth, c.env, getWorkerUrl(c.req.url, c.env));
  if (pluginMeta) Object.assign(customMetadata, pluginMeta);

  // beforeUpload hook — blocking, can inject custom metadata or reject
  const hooks = getStorageHooks(c.env, bucketName);
  if (hooks?.beforeUpload) {
    const writeFileMeta: WriteFileMeta = { size: file.size, contentType: file.type || 'application/octet-stream', key };
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
      contentType: file.type || 'application/octet-stream',
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
  const newContentType = body.contentType || existing.httpMetadata?.contentType || 'application/octet-stream';

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
  },
});

const handleCheckFileExists = async (c: Context<HonoEnv>) => {
  const bucketName = c.req.param('bucket')!;
  const key = resolveStorageKey(c, bucketName);
  const { bucketConfig, release } = getBucketConfig(c.env, bucketName);

  const fullKey = r2Key(bucketName, key);
  const obj = await getStoredObject(c.env.STORAGE, fullKey);
  if (!obj) {
    throw new EdgeBaseError(404, 'File not found.', undefined, 'not-found');
  }

  // Security: check read rule
  const serviceKeyBypass = checkServiceKey(c.env, c.req.header('X-EdgeBase-Service-Key'), `storage:bucket:${bucketName}:read`, c.req);
  if (!serviceKeyBypass) {
    const auth = c.get('auth') as AuthContext | null;
    const resource = buildMetadata(obj);
    checkStorageRule(bucketConfig.access?.read, auth, resource, 'read', bucketName, release);
  }

  return c.body(null, 200);
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
    query: z.object({ key: z.string() }),
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
  const serviceKeyBypass = checkServiceKey(c.env, c.req.header('X-EdgeBase-Service-Key'), `storage:bucket:${bucketName}:write`, c.req);
  if (!serviceKeyBypass) {
    const auth = c.get('auth') as AuthContext | null;
    checkStorageRule(bucketConfig.access?.write, auth, null, 'write', bucketName, release);
  }

  const kvKey = partTrackingKey(bucketName, key, uploadId);
  const parts = await c.env.KV.get(kvKey, 'json') as Array<{ partNumber: number; etag: string }> | null;

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
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
    404: { description: 'Not found', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

const handleDownloadFile = async (c: Context<HonoEnv>) => {
  const bucketName = c.req.param('bucket')!;
  const key = resolveStorageKey(c, bucketName);
  const { bucketConfig, release } = getBucketConfig(c.env, bucketName);

  // Check for signed URL token
  const token = c.req.query('token');
  let skipRules = false;

  if (token) {
    // Asymmetric fail-closed (#99): secret 미설정 시 토큰 무시 → 보안 규칙으로 fallback
    const secret = c.env.JWT_USER_SECRET;
    if (secret) {
      const verified = await verifySignedToken(token, key, bucketName, secret);
      if (verified.valid) {
        skipRules = true;
      }
    }
  }

  const fullKey = r2Key(bucketName, key);
  const obj = await c.env.STORAGE.get(fullKey);
  if (!obj) {
    throw new EdgeBaseError(404, 'File not found.', undefined, 'not-found');
  }

  // Security: check read rule
  if (!skipRules) {
    const serviceKeyBypass = checkServiceKey(c.env, c.req.header('X-EdgeBase-Service-Key'), `storage:bucket:${bucketName}:read`, c.req);
    if (!serviceKeyBypass) {
      const auth = c.get('auth') as AuthContext | null;
      const resource = buildMetadata(obj);
      checkStorageRule(bucketConfig.access?.read, auth, resource, 'read', bucketName, release);
    }
  }

  // Plugin blocking storage hooks (beforeDownload)
  {
    const dlAuth = c.get('auth') as AuthContext | null;
    const dlMeta = buildMetadata(obj);
    await executeBlockingStorageHooks('beforeDownload', { ...dlMeta, bucket: bucketName }, dlAuth, c.env, getWorkerUrl(c.req.url, c.env));
  }

  // beforeDownload hook — blocking, throw to reject
  const hooks = getStorageHooks(c.env, bucketName);
  if (hooks?.beforeDownload) {
    const auth = c.get('auth') as AuthContext | null;
    const meta = buildMetadata(obj);
    const hookCtx = buildStorageHookCtx(c.env, c.executionCtx, getWorkerUrl(c.req.url, c.env));
    try {
      await hooks.beforeDownload(auth, meta, hookCtx);
    } catch (error) {
      throw normalizeStorageHookError(error, 'beforeDownload');
    }
  }

  // Stream response
  const headers = new Headers();
  headers.set('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Content-Length', String(obj.size));
  headers.set('ETag', obj.etag);
  if (obj.uploaded) {
    headers.set('Last-Modified', obj.uploaded.toUTCString());
  }

  return new Response(obj.body, { headers });
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
      const msg = e instanceof EdgeBaseError ? e.message : 'Unknown error.';
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

  // Security: check read rule (signed URL creation = read access)
  const serviceKeyBypass = checkServiceKey(c.env, c.req.header('X-EdgeBase-Service-Key'), `storage:bucket:${bucketName}:read`, c.req);
  if (!serviceKeyBypass) {
    const auth = c.get('auth') as AuthContext | null;
    checkStorageRule(bucketConfig.access?.read, auth, null, 'read', bucketName, release);
  }

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

  const expiresInMs = parseDuration(body.expiresIn || '1h');
  const expiresAt = Date.now() + expiresInMs;

  // Fail-closed: refuse to create signed URL without secret
  const secret = c.env.JWT_USER_SECRET;
  if (!secret) {
    throw new EdgeBaseError(500, 'Signed URLs require JWT_USER_SECRET to be configured.', undefined, 'internal-error');
  }
  const token = await createSignedToken(body.key, bucketName, expiresAt, secret);

  // Build signed URL
  const url = new URL(c.req.url);
  const signedUrl = `${url.protocol}//${url.host}/api/storage/${encodeURIComponent(bucketName)}/${encodeURIComponent(body.key)}?token=${token}`;

  return c.json({ url: signedUrl, expiresAt: new Date(expiresAt).toISOString() });
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

  // Security: check read rule
  const serviceKeyBypass = checkServiceKey(c.env, c.req.header('X-EdgeBase-Service-Key'), `storage:bucket:${bucketName}:read`, c.req);
  if (!serviceKeyBypass) {
    const auth = c.get('auth') as AuthContext | null;
    checkStorageRule(bucketConfig.access?.read, auth, null, 'read', bucketName, release);
  }

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
  const url = new URL(c.req.url);

  const urls: Array<{ key: string; url: string; expiresAt: string }> = [];

  for (const key of body.keys) {
    validateStorageKey(key);
    const fullKey = r2Key(bucketName, key);
    const obj = await c.env.STORAGE.head(fullKey);
    if (!obj) continue; // skip non-existent files

    const token = await createSignedToken(key, bucketName, expiresAt, secret);
    urls.push({
      key,
      url: `${url.protocol}//${url.host}/api/storage/${encodeURIComponent(bucketName)}/${encodeURIComponent(key)}?token=${token}`,
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
  const token = await createSignedToken(body.key, bucketName, expiresAt, secret, maxBytes);

  // Build signed upload URL (uploads go through our Worker endpoint with the token)
  const url = new URL(c.req.url);
  const signedUrl = `${url.protocol}//${url.host}/api/storage/${bucketName}/upload?token=${token}&key=${encodeURIComponent(body.key)}`;

  // Add uploadedBy from auth context
  const auth = c.get('auth') as AuthContext | null;

  return c.json({
    url: signedUrl,
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

  // Security: check write rule
  const serviceKeyBypass = checkServiceKey(c.env, c.req.header('X-EdgeBase-Service-Key'), `storage:bucket:${bucketName}:write`, c.req);
  if (!serviceKeyBypass) {
    const auth = c.get('auth') as AuthContext | null;
    checkStorageRule(bucketConfig.access?.write, auth, null, 'write', bucketName, release);
  }

  const body = await c.req.json<{ key: string; contentType?: string; customMetadata?: Record<string, string> }>();
  if (!body.key) {
    throw new EdgeBaseError(400, 'Missing required field: key.', undefined, 'validation-failed');
  }
  validateStorageKey(body.key);

  const auth = c.get('auth') as AuthContext | null;
  const customMetadata = body.customMetadata || {};
  if (auth?.id) {
    customMetadata.uploadedBy = auth.id as string;
  }

  const fullKey = r2Key(bucketName, body.key);
  const multipartUpload = await c.env.STORAGE.createMultipartUpload(fullKey, {
    httpMetadata: { contentType: body.contentType || 'application/octet-stream' },
    customMetadata,
  });

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
    body: { content: { 'application/json': { schema: z.record(z.string(), z.unknown()) } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

storage.openapi(uploadPart, async (c) => {
  const bucketName = c.req.param('bucket')!;
  const { bucketConfig, release } = getBucketConfig(c.env, bucketName);

  // Security: check write rule
  const serviceKeyBypass = checkServiceKey(c.env, c.req.header('X-EdgeBase-Service-Key'), `storage:bucket:${bucketName}:write`, c.req);
  if (!serviceKeyBypass) {
    const auth = c.get('auth') as AuthContext | null;
    checkStorageRule(bucketConfig.access?.write, auth, null, 'write', bucketName, release);
  }

  const uploadId = c.req.query('uploadId');
  const partNumber = parseInt(c.req.query('partNumber') || '0', 10);
  const key = c.req.query('key');

  if (!uploadId || !partNumber || !key) {
    throw new EdgeBaseError(400, 'Missing required query params: uploadId, partNumber, key.', undefined, 'validation-failed');
  }

  const fullKey = r2Key(bucketName, key);
  const multipartUpload = c.env.STORAGE.resumeMultipartUpload(fullKey, uploadId);

  const part = await multipartUpload.uploadPart(partNumber, c.req.raw.body!);

  // M17: Save part info to KV for resume tracking
  const kvKey = partTrackingKey(bucketName, key, uploadId);
  const existing = await c.env.KV.get(kvKey, 'json') as Array<{ partNumber: number; etag: string }> | null;
  const parts = existing || [];
  // Replace if same partNumber exists (re-upload), otherwise append
  const idx = parts.findIndex(p => p.partNumber === part.partNumber);
  if (idx >= 0) {
    parts[idx] = { partNumber: part.partNumber, etag: part.etag };
  } else {
    parts.push({ partNumber: part.partNumber, etag: part.etag });
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
    body: { content: { 'application/json': { schema: z.object({ uploadId: z.string(), key: z.string(), parts: z.array(z.object({ partNumber: z.number(), etag: z.string() })) }) } }, required: true },
  },
  responses: {
    200: { description: 'Success', content: { 'application/json': { schema: jsonResponseSchema } } },
    400: { description: 'Bad request', content: { 'application/json': { schema: errorResponseSchema } } },
    403: { description: 'Forbidden', content: { 'application/json': { schema: errorResponseSchema } } },
  },
});

storage.openapi(completeMultipartUpload, async (c) => {
  const bucketName = c.req.param('bucket')!;
  const { bucketConfig, release } = getBucketConfig(c.env, bucketName);

  // Security: check write rule
  const serviceKeyBypass = checkServiceKey(c.env, c.req.header('X-EdgeBase-Service-Key'), `storage:bucket:${bucketName}:write`, c.req);
  if (!serviceKeyBypass) {
    const auth = c.get('auth') as AuthContext | null;
    checkStorageRule(bucketConfig.access?.write, auth, null, 'write', bucketName, release);
  }

  const body = await c.req.json<{
    uploadId: string;
    key: string;
    parts: Array<{ partNumber: number; etag: string }>;
  }>();

  if (!body.uploadId || !body.key || !body.parts?.length) {
    throw new EdgeBaseError(400, 'Missing required fields: uploadId, key, parts.', undefined, 'validation-failed');
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

  // Security: check write rule
  const serviceKeyBypass = checkServiceKey(c.env, c.req.header('X-EdgeBase-Service-Key'), `storage:bucket:${bucketName}:write`, c.req);
  if (!serviceKeyBypass) {
    const auth = c.get('auth') as AuthContext | null;
    checkStorageRule(bucketConfig.access?.write, auth, null, 'write', bucketName, release);
  }

  const body = await c.req.json<{ uploadId: string; key: string }>();
  if (!body.uploadId || !body.key) {
    throw new EdgeBaseError(400, 'Missing required fields: uploadId, key.', undefined, 'validation-failed');
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
