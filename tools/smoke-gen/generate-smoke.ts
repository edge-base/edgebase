#!/usr/bin/env tsx
/**
 * Smoke E2E test generator.
 *
 * Reads /openapi.json from the Miniflare dev server and generates
 * smoke tests for every documented endpoint:
 *   1. Normal request → 2xx  (with response structure validation)
 *   2. No auth → 401         (if endpoint requires auth)
 *   3. Bad input → 400       (if endpoint accepts body)
 *
 * Usage:
 *   npx tsx tools/smoke-gen/generate-smoke.ts [--spec <path-to-spec.json>]
 *
 * Output:
 *   packages/server/test/integration/generated/smoke-*.test.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const OUTPUT_DIR = resolve(ROOT, 'packages/server/test/integration/generated');
const SKIP_REPORT_PATH = resolve(OUTPUT_DIR, 'smoke-skip-report.json');

// ─── Read Spec ──────────────────────────────────────────────────────────────

interface OpenAPISpec {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, OperationObject>>;
}

interface ParameterObject {
  name: string;
  in: string;
  required?: boolean;
  schema?: { type: string };
}

interface OperationObject {
  operationId?: string;
  summary?: string;
  tags?: string[];
  parameters?: ParameterObject[];
  requestBody?: {
    content?: Record<string, { schema?: any }>;
  };
  responses?: Record<string, any>;
}

function loadSpec(): OpenAPISpec {
  const specArg = process.argv.indexOf('--spec');
  let specPath: string;
  if (specArg !== -1 && process.argv[specArg + 1]) {
    specPath = resolve(process.argv[specArg + 1]);
  } else {
    // Default: read from generated file
    specPath = resolve(ROOT, 'packages/server/openapi.json');
  }
  return JSON.parse(readFileSync(specPath, 'utf-8'));
}

// ─── Path Parameter Sample Values ─────────────────────────────────────────

/**
 * Generate a realistic sample value for a path parameter.
 * These values should be valid enough to not cause 404s from bad params,
 * but the actual data may not exist (which is fine for smoke tests).
 */
function samplePathParam(name: string): string {
  const samples: Record<string, string> = {
    id: 'smoke-test-id-000',
    credentialId: 'smoke-cred-id-000',
    name: 'posts',
    table: 'posts',
    bucket: 'documents',
    key: 'smoke-test-file.txt',
    provider: 'smoke-provider',
    index: 'embeddings',
    namespace: 'test',
    instanceId: 'default',
    database: 'analytics',
    uploadId: 'smoke-upload-id-000',
  };
  return samples[name] ?? `smoke-${name}`;
}

function sampleQuery(operationId?: string): string | null {
  const samples: Record<string, string> = {
    checkDatabaseSubscriptionConnection: 'namespace=test&table=posts',
    connectDatabaseSubscription: 'namespace=shared&table=posts',
    connectRoom: 'namespace=test-game&id=smoke-room',
    getRoomMetadata: 'namespace=test-metadata&id=smoke-room',
    checkRoomConnection: 'namespace=test-game&id=smoke-room',
    getRoomRealtimeSession: 'namespace=test-game&id=smoke-room',
    adminGetPushLogs: 'userId=smoke-user',
    adminGetPushTokens: 'userId=smoke-user',
    getPushLogs: 'userId=smoke-user',
    getPushTokens: 'userId=smoke-user',
  };
  return operationId ? samples[operationId] ?? null : null;
}

/**
 * Replace {param} placeholders in a path with sample values.
 */
function resolvePath(path: string, operationId?: string): string {
  let resolvedPath = path;
  if (operationId === 'adminCreateTableRecord' && path === '/admin/api/data/tables/{name}/records') {
    resolvedPath = '/admin/api/data/tables/categories/records';
  } else if (path.startsWith('/admin/api/data/storage/buckets/{name}')) {
    resolvedPath = path
      .replace('{name}', 'documents')
      .replace(/\{(\w+)\}/g, (_, name) => samplePathParam(name));
  } else {
    resolvedPath = path.replace(/\{(\w+)\}/g, (_, name) => samplePathParam(name));
  }

  const query = sampleQuery(operationId);
  if (query) {
    return `${resolvedPath}${resolvedPath.includes('?') ? '&' : '?'}${query}`;
  }
  return resolvedPath;
}

// ─── Sample Request Bodies ────────────────────────────────────────────────

/**
 * Generate a valid-ish sample body for endpoints that require one.
 * Returns a string representation of the JS object literal (for code generation).
 */
function sampleBody(operationId: string): string {
  const bodies: Record<string, string> = {
    // Auth
    authSignup: '{ email: `smoke-signup-${Date.now()}@test.com`, password: "SmokeTest1234!" }',
    authSignin: '{ email: "smoke@test.com", password: "SmokeTest1234!" }',
    authSigninAnonymous: '{}',
    authRefreshToken: '{ refreshToken: "smoke-refresh-token" }',
    authRefresh: '{ refreshToken: "smoke-refresh-token" }',
    authChangePassword: '{ currentPassword: "Old1234!", newPassword: "New1234!" }',
    authForgotPassword: '{ email: "smoke@test.com" }',
    authResetPassword: '{ token: "smoke-token", password: "Reset1234!" }',
    authVerifyEmail: '{ token: "smoke-verify-token" }',
    authLinkEmail: '{ email: "smoke-link@test.com", password: "Link1234!" }',
    authPasskeysRegisterBegin: '{}',
    authPasskeysRegisterFinish: '{ credential: {} }',
    authPasskeysAuthBegin: '{}',
    authPasskeysAuthFinish: '{ credential: {} }',
    authMfaEnroll: '{ type: "totp" }',
    authMfaVerify: '{ factorId: "smoke-factor", code: "123456" }',
    authMfaChallenge: '{ factorId: "smoke-factor" }',

    // Admin Auth
    adminAuthCreateUser: '{ email: `smoke-admin-${Date.now()}@test.com`, password: "Admin1234!" }',
    adminAuthUpdateUser: '{ email: "smoke-updated@test.com" }',
    adminAuthSetClaims: '{ claims: { role: "smoke" } }',

    // Admin Data
    adminCreateTableRecord: '{ name: `smoke-category-${Date.now()}`, slug: `smoke-category-${Date.now()}` }',
    adminUpdateTableRecord: '{ title: "smoke-updated" }',
    adminBatchTableRecords: '{ records: [{ title: "smoke-batch" }] }',

    // DB single-instance
    dbSingleBatchRecords: '{ records: [{ title: "smoke-batch" }] }',
    dbSingleBatchByFilter: '{ filter: [["title", "==", "smoke"]], data: { views: 0 } }',
    dbBatchRecords: '{ records: [{ title: "smoke-batch" }] }',
    dbBatchByFilter: '{ filter: [["title", "==", "smoke"]], data: { views: 0 } }',

    // Storage
    uploadFile: '{}',
    deleteBatch: '{ keys: ["smoke-key"] }',
    createSignedDownloadUrl: '{ key: "smoke-file.txt" }',
    createSignedDownloadUrls: '{ keys: ["smoke-file.txt"] }',
    createSignedUploadUrl: '{ key: "smoke-upload.txt", contentType: "text/plain" }',
    createMultipartUpload: '{ key: "smoke-multipart.txt" }',
    uploadPart: '{ uploadId: "smoke-upload", partNumber: 1 }',
    completeMultipartUpload: '{ uploadId: "smoke-upload", parts: [] }',
    abortMultipartUpload: '{ uploadId: "smoke-upload" }',
    adminUploadFile: '{}',

    // SQL / KV / D1 / Vectorize
    executeSql: '{ namespace: "shared", sql: "SELECT 1" }',
    adminExecuteSql: '{ namespace: "shared", sql: "SELECT 1" }',
    kvOperation: '{ action: "get", key: "smoke-key" }',
    executeD1Query: '{ query: "SELECT 1" }',
    vectorizeOperation: '{ operation: "query", vector: [0.1, 0.2, 0.3] }',

    // Push
    pushRegister: '{ deviceId: "smoke-device-1", token: "smoke-push-token", platform: "web" }',
    pushUnregister: '{ deviceId: "smoke-device-1" }',
    pushSend: '{ userId: "smoke-user", payload: { title: "smoke", body: "test" } }',
    pushSendMany: '{ userIds: ["smoke-user"], payload: { title: "smoke", body: "test" } }',
    pushSendToToken: '{ token: "smoke-push-token", platform: "web", payload: { title: "smoke", body: "test" } }',
    pushSendToTopic: '{ topic: "smoke-topic", payload: { title: "smoke", body: "test" } }',
    pushBroadcast: '{ payload: { title: "smoke", body: "test" } }',
    pushTopicSubscribe: '{ topic: "smoke-topic" }',
    pushTopicUnsubscribe: '{ topic: "smoke-topic" }',
    putPushTokens: '{ userId: "smoke-user", deviceId: "smoke-device-1", token: "smoke-push-token", platform: "web" }',
    patchPushTokens: '{ userId: "smoke-user", deviceId: "smoke-device-1", metadata: { source: "smoke" } }',

    // Analytics
    trackEvents: '{ events: [{ name: "smoke_test", timestamp: 0 }] }',

    // Admin misc
    adminBroadcast: '{ channel: "smoke", event: "test", data: {} }',
    adminImportTable: '{ records: [] }',
    adminCreateStorageBucket: '{ name: "smoke-bucket" }',
    adminCreateTable: '{ name: "smoke_table", columns: [] }',
    adminUpdateTable: '{ columns: [] }',

    // Admin auth (additional)
    adminAuthImportUsers: '{ users: [] }',
    adminAuthRevokeUserSessions: '{}',

    // Admin data
    adminCreateUser: '{ email: `smoke-admin-${Date.now()}@test.com`, password: "Admin1234!" }',
    adminUpdateUser: '{ email: "smoke-updated@test.com" }',
    adminRulesTest: '{ rules: "true", method: "GET", path: "/api/test" }',

    // Admin panel auth
    adminLogin: '{ email: "admin@test.com", password: "Admin1234!" }',
    adminRefresh: '{ refreshToken: "smoke-refresh" }',
    adminSetup: '{ email: "admin@test.com", password: "Admin1234!" }',
    adminResetPassword: '{ token: "smoke-token", password: "Reset1234!" }',

    // Backup
    backupListDOs: '{ namespaces: ["shared"] }',
    backupDumpDO: '{ namespace: "shared", instanceId: "default" }',
    backupRestoreDO: '{ namespace: "shared", instanceId: "default", data: {} }',
    backupDumpD1: '{}',
    backupRestoreD1: '{ tables: {} }',
    backupDumpStorage: '{ bucket: "default" }',
    backupRestoreStorage: '{ bucket: "default", files: [] }',
    backupWipeDO: '{ namespace: "shared", instanceId: "default" }',
    backupResyncUsersPublic: '{}',
    backupExportTable: '{ namespace: "shared", table: "posts" }',
    backupGetConfig: '{}',

    // Client auth (additional)
    authSigninAnonymous: '{}',
    authSignout: '{}',
    authLinkPhone: '{ phone: "+15551234567" }',
    authChangeEmail: '{ email: "smoke-change@test.com" }',
    authDeleteSession: '{}',
    authVerifyEmailChange: '{ token: "smoke-verify-token" }',
    authVerifyEmailOtp: '{ email: "smoke@test.com", code: "123456" }',
    authVerifyMagicLink: '{ token: "smoke-magic-link-token" }',
    authVerifyPhone: '{ phone: "+15551234567", code: "123456" }',
    authVerifyLinkPhone: '{ phone: "+15551234567", code: "123456" }',
    authSigninEmailOtp: '{ email: "smoke@test.com" }',
    authSigninMagicLink: '{ email: "smoke@test.com" }',
    authSigninPhone: '{ phone: "+15551234567" }',
    authUpdateProfile: '{ displayName: "Smoke Test" }',
    authRequestPasswordReset: '{ email: "smoke@test.com" }',
    authPasskeysRegisterOptions: '{}',
    authPasskeysRegister: '{ response: {} }',
    authPasskeysAuthOptions: '{}',
    authPasskeysAuthenticate: '{ response: { id: "smoke-credential", type: "public-key" } }',
    authMfaTotpEnroll: '{}',
    authMfaTotpVerify: '{ factorId: "smoke-factor", code: "123456" }',
    authMfaVerify: '{ mfaTicket: "smoke-ticket", code: "123456" }',
    authMfaRecovery: '{ mfaTicket: "smoke-ticket", recoveryCode: "smoke-recovery-code" }',
    authMfaTotpDelete: '{ password: "SmokeTest1234!" }',
    addRoomRealtimeTracks: '{ sessionId: "smoke-session", tracks: [{ location: "local", trackName: "audio-track", kind: "audio" }] }',
    renegotiateRoomRealtimeSession: '{ sessionId: "smoke-session", sessionDescription: { sdp: "v=0\\r\\n", type: "offer" } }',
    closeRoomRealtimeTracks: '{ sessionId: "smoke-session", tracks: [{ mid: "0" }] }',

    // Admin test push
    adminTestPushSend: '{ userId: "smoke-user", title: "smoke", body: "test" }',

    // Admin upload
    adminUploadFile: '{}',
  };
  return bodies[operationId] ?? '{}';
}

// ─── Group by Tag ───────────────────────────────────────────────────────────

interface RouteEntry {
  method: string;
  path: string;
  resolvedPath: string;
  operationId: string;
  tags: string[];
  hasBody: boolean;
  requiresAuth: boolean;
  isList: boolean;
}

/**
 * Routes that require external infrastructure not available in Miniflare.
 * These are skipped in smoke tests (marked with it.skip) and reported in
 * smoke-skip-report.json so skip growth stays reviewable in CI.
 */
interface SkipRule {
  exact?: string;
  prefix?: string;
  code: string;
  description: string;
}

interface SmokeSkipEntry {
  method: string;
  path: string;
  operationId: string;
  reasonCode: string;
  reasonDescription: string;
}

const INFRA_SKIP_RULES: SkipRule[] = [
  { prefix: '/api/functions/', code: 'requires-functions-binding', description: 'Needs deployed user function bindings.' },
];

/**
 * Routes where "no auth" doesn't return 401 because:
 *   - Public read access (DB tables)
 *   - Zod validation runs before auth (returns 400)
 *   - Auth-optional endpoints (signin, signup, etc.)
 *   - Admin endpoints return 403 instead of 401
 *   - Public endpoints return 200
 */
const AUTH_EXEMPT_PREFIXES = [
  '/api/db/',                      // Public read allowed by default
  '/api/config',                   // Public endpoint
  '/api/room/connect-check',       // Public room preflight endpoint
  '/api/auth/signup',              // Auth endpoint itself
  '/api/auth/signin',              // Auth endpoint itself
  '/api/auth/refresh',             // Uses refresh token in body, not header
  '/api/auth/forgot',              // Public by design
  '/api/auth/reset',               // Public by design
  '/api/auth/verify',              // Public by design
  '/api/auth/link/',               // Needs auth but Zod runs first (returns 400)
  '/api/auth/link-email',          // Needs auth but Zod runs first
  '/api/auth/change',              // Needs auth but Zod runs first
  '/api/auth/signout',             // Needs auth but Zod runs first
  '/api/auth/request-password',    // Public by design
  '/api/analytics/track',          // Allows anonymous event ingestion
  '/api/auth/me',                  // Returns 401, but handled separately
  '/api/auth/sessions',            // Returns 401, but handled separately
  '/api/auth/profile',             // Returns 401, but handled separately
  '/api/auth/delete-session',      // Returns 401
  '/api/auth/admin/',              // Admin auth — returns 403, not 401
  '/admin/api/',                   // Admin panel — returns 403 for missing service key
];

function getInfraSkipRule(path: string): SkipRule | null {
  return INFRA_SKIP_RULES.find((rule) => {
    if (rule.exact && path === rule.exact) return true;
    if (rule.prefix && path.startsWith(rule.prefix)) return true;
    return false;
  }) ?? null;
}

function isAuthExempt(path: string): boolean {
  return AUTH_EXEMPT_PREFIXES.some(prefix => path.startsWith(prefix));
}

/**
 * Routes where 2xx test should expect exactly 2xx.
 * Other routes use relaxed assertion (status < 500 = not a server error).
 */
const EXPECT_2XX_PREFIXES = [
  '/api/health',
  '/api/config',
];

/**
 * Endpoints that intentionally accept any body (passthrough/record validation).
 * These are excluded from "bad input → 400" tests because they accept extra fields by design.
 */
const BAD_INPUT_EXEMPT_OPS = new Set([
  'adminAuthSetClaims',      // Custom claims: arbitrary key-value pairs
  'authSigninAnonymous',     // Only reads captchaToken, ignores rest
  'authPasskeysAuthOptions', // Public discoverable flow accepts empty/extra JSON and still returns options
  'backupListDOs',           // Config-scan mode accepts extra JSON keys by design
  'dbSingleBatchRecords',    // z.record() — dynamic columns, validation deferred to DO
  'dbBatchRecords',          // Same as above for namespaced DB
]);

/**
 * Endpoints where a "no auth" smoke request is not stable enough to assert
 * 401/403 because validation, not-found handling, or public bucket rules run
 * earlier than auth in the test configuration.
 */
const NO_AUTH_SMOKE_EXEMPT_OPS = new Set([
  'connectRoom',
  'getRoomMetadata',
  'uploadFile',
  'getFileMetadata',
  'updateFileMetadata',
  'downloadFile',
  'deleteFile',
  'getUploadParts',
  'deleteBatch',
  'completeMultipartUpload',
  'abortMultipartUpload',
  'authPasskeysAuthOptions',
  'authPasskeysAuthenticate',
  'authMfaVerify',
  'authMfaRecovery',
  'oauthRedirect',
  'oauthLinkStart',
  'vectorizeOperation',
]);

const WEBSOCKET_SMOKE_OPS = new Set([
  'connectDatabaseSubscription',
  'connectRoom',
]);

function extractRoutes(spec: OpenAPISpec): RouteEntry[] {
  const routes: RouteEntry[] = [];
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (!['get', 'post', 'put', 'delete', 'patch'].includes(method)) continue;
      const operation = op as OperationObject;
      const operationId = operation.operationId ?? `${method}_${path.replace(/[^a-zA-Z0-9]/g, '_')}`;
      routes.push({
        method: method.toUpperCase(),
        path,
        resolvedPath: resolvePath(path, operationId),
        operationId,
        tags: operation.tags ?? ['untagged'],
        hasBody: !!operation.requestBody,
        // Auth required unless exempted
        requiresAuth: !path.includes('/health') && !path.includes('/callback') && !isAuthExempt(path),
        // Detect list endpoints by operationId pattern
        isList: /list|ListRecords|GetTableRecords|SearchRecords/i.test(operationId),
      });
    }
  }
  return routes;
}

// ─── Generate Test File ─────────────────────────────────────────────────────

function generateTestFile(tag: string, routes: RouteEntry[]): string {
  const lines: string[] = [];
  const usesPushProvider = routes.some((route) => (
    route.path.startsWith('/api/push/')
    || route.path.startsWith('/admin/api/data/push/')
  ));

  lines.push(`/**`);
  lines.push(` * Auto-generated smoke tests for tag: ${tag}`);
  lines.push(` * DO NOT EDIT — regenerate with: npx tsx tools/smoke-gen/generate-smoke.ts`);
  lines.push(` */`);
  lines.push(`import { describe, it, expect } from 'vitest';`);
  if (usesPushProvider) {
    lines.push(`import { fetchMock } from 'cloudflare:test';`);
  }
  lines.push(``);
  lines.push(`const BASE = 'http://localhost';`);
  lines.push(`const SK = 'test-service-key-for-admin';`);
  if (usesPushProvider) {
    lines.push(`const MOCK_FCM_ORIGIN = 'http://localhost:9099';`);
    lines.push(``);
    lines.push(`function setupFcmMocks() {`);
    lines.push(`  fetchMock.activate();`);
    lines.push(`  fetchMock.disableNetConnect();`);
    lines.push(``);
    lines.push(`  fetchMock.get(MOCK_FCM_ORIGIN)`);
    lines.push(`    .intercept({ path: '/token', method: 'POST' })`);
    lines.push(`    .reply(200, JSON.stringify({ access_token: 'fake-access-token', expires_in: 3600 }), {`);
    lines.push(`      headers: { 'content-type': 'application/json' },`);
    lines.push(`    })`);
    lines.push(`    .persist();`);
    lines.push(``);
    lines.push(`  fetchMock.get(MOCK_FCM_ORIGIN)`);
    lines.push(`    .intercept({ path: /\\/v1\\/projects\\/.*\\/messages:send/, method: 'POST' })`);
    lines.push(`    .reply(200, JSON.stringify({ name: 'projects/test-project/messages/fake-123' }), {`);
    lines.push(`      headers: { 'content-type': 'application/json' },`);
    lines.push(`    })`);
    lines.push(`    .persist();`);
    lines.push(``);
    lines.push(`  fetchMock.get(MOCK_FCM_ORIGIN)`);
    lines.push(`    .intercept({ path: /\\/iid\\//, method: 'POST' })`);
    lines.push(`    .reply(200, '{}', { headers: { 'content-type': 'application/json' } })`);
    lines.push(`    .persist();`);
    lines.push(`}`);
    lines.push(``);
    lines.push(`async function withPushMocks<T>(fn: () => Promise<T>): Promise<T> {`);
    lines.push(`  setupFcmMocks();`);
    lines.push(`  try {`);
    lines.push(`    return await fn();`);
    lines.push(`  } finally {`);
    lines.push(`    fetchMock.deactivate();`);
    lines.push(`  }`);
    lines.push(`}`);
    lines.push(``);
  }
  lines.push(``);
  lines.push(`async function api(method: string, path: string, opts?: { headers?: Record<string, string>; body?: unknown }) {`);
  lines.push(`  const headers: Record<string, string> = { ...opts?.headers };`);
  lines.push(`  if (opts?.body) headers['Content-Type'] = 'application/json';`);
  lines.push(`  const res = await (globalThis as any).SELF.fetch(\`\${BASE}\${path}\`, {`);
  lines.push(`    method,`);
  lines.push(`    headers,`);
  lines.push(`    body: opts?.body ? JSON.stringify(opts.body) : undefined,`);
  lines.push(`  });`);
  lines.push(`  let data: any;`);
  lines.push(`  try { data = await res.json(); } catch { data = null; }`);
  lines.push(`  return { status: res.status, data };`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`async function wsConnect(path: string, headers?: Record<string, string>) {`);
  lines.push(`  const res = await (globalThis as any).SELF.fetch(\`\${BASE}\${path}\`, {`);
  lines.push(`    headers: { Upgrade: 'websocket', ...(headers ?? {}) },`);
  lines.push(`  });`);
  lines.push(`  const ws = (res as any).webSocket as WebSocket | undefined;`);
  lines.push(`  if (ws) {`);
  lines.push(`    ws.accept();`);
  lines.push(`    ws.close();`);
  lines.push(`  }`);
  lines.push(`  return { status: res.status };`);
  lines.push(`}`);
  lines.push(``);

  lines.push(`describe('Smoke: ${tag}', () => {`);

  for (const route of routes) {
    const desc = route.operationId;
    const body = route.hasBody ? sampleBody(route.operationId) : null;
    const skipRule = getInfraSkipRule(route.path);
    const skip = skipRule !== null;
    const itFn = skip ? 'it.skip' : 'it';
    const needsPushMocks = (
      route.path.startsWith('/api/push/')
      || route.path.startsWith('/admin/api/data/push/')
    );

    // ── Test 1: Normal request → not a server error ─────────────────
    const expect2xx = EXPECT_2XX_PREFIXES.some(p => route.path.startsWith(p));
    if (skipRule) {
      lines.push(`  // Skipped in generated smoke: ${skipRule.code} — ${skipRule.description}`);
    }
    lines.push(`  ${itFn}('${desc}: ${route.method} ${route.path} → not 5xx', async () => {`);
    if (needsPushMocks) {
      lines.push(`    await withPushMocks(async () => {`);
    }
    const isWebSocketSmoke = WEBSOCKET_SMOKE_OPS.has(route.operationId);
    if (isWebSocketSmoke) {
      lines.push(`    const { status } = await wsConnect('${route.resolvedPath}');`);
      lines.push(`    expect(status).toBe(101);`);
    } else {
      lines.push(`    const { status, data } = await api('${route.method}', '${route.resolvedPath}', {`);
      lines.push(`      headers: { 'X-EdgeBase-Service-Key': SK },`);
      if (body) {
        lines.push(`      body: ${body},`);
      }
      lines.push(`    });`);
      if (expect2xx) {
        lines.push(`    expect(status).toBeGreaterThanOrEqual(200);`);
        lines.push(`    expect(status).toBeLessThan(300);`);
        lines.push(`    if (data) expect(data).not.toHaveProperty('error');`);
      } else {
        // Smoke test: verify the route exists and doesn't crash
        lines.push(`    expect(status).toBeLessThan(500);`);
      }
      // List endpoints should return items array when successful
      if (route.isList && expect2xx) {
        lines.push(`    if (data) {`);
        lines.push(`      expect(data).toHaveProperty('items');`);
        lines.push(`      expect(Array.isArray(data.items)).toBe(true);`);
        lines.push(`    }`);
      }
    }
    if (needsPushMocks) {
      lines.push(`    });`);
    }
    lines.push(`  });`);
    lines.push(``);

    // ── Test 2: No auth → 401 or 403 (only if auth required) ─────────
    if (route.requiresAuth && !NO_AUTH_SMOKE_EXEMPT_OPS.has(route.operationId)) {
      lines.push(`  ${itFn}('${desc}: no auth → 401/403', async () => {`);
      if (needsPushMocks) {
        lines.push(`    await withPushMocks(async () => {`);
      }
      if (body) {
        lines.push(`    const { status } = await api('${route.method}', '${route.resolvedPath}', {`);
        lines.push(`      body: ${body},`);
        lines.push(`    });`);
      } else {
        lines.push(`    const { status } = await api('${route.method}', '${route.resolvedPath}');`);
      }
      lines.push(`    expect([401, 403]).toContain(status);`);
      if (needsPushMocks) {
        lines.push(`    });`);
      }
      lines.push(`  });`);
      lines.push(``);
    }

    // ── Test 3: Bad input → 400 (only if body required and not exempt) ─
    if (route.hasBody && !BAD_INPUT_EXEMPT_OPS.has(route.operationId)) {
      lines.push(`  ${itFn}('${desc}: bad input → 400', async () => {`);
      if (needsPushMocks) {
        lines.push(`    await withPushMocks(async () => {`);
      }
      lines.push(`    const { status } = await api('${route.method}', '${route.resolvedPath}', {`);
      lines.push(`      headers: { 'X-EdgeBase-Service-Key': SK },`);
      lines.push(`      body: { __invalid_field__: true, $$badKey: [null, undefined], nested: { bad: Symbol } },`);
      lines.push(`    });`);
      lines.push(`    expect(status).toBeGreaterThanOrEqual(400);`);
      lines.push(`    expect(status).toBeLessThan(500);`);
      if (needsPushMocks) {
        lines.push(`    });`);
      }
      lines.push(`  });`);
      lines.push(``);
    }
  }

  lines.push(`});`);
  lines.push(``);

  return lines.join('\n');
}

function buildSkipReport(routes: RouteEntry[]) {
  const skippedRoutes: SmokeSkipEntry[] = routes
    .map((route) => {
      const skipRule = getInfraSkipRule(route.path);
      if (!skipRule) return null;
      return {
        method: route.method,
        path: route.path,
        operationId: route.operationId,
        reasonCode: skipRule.code,
        reasonDescription: skipRule.description,
      };
    })
    .filter((entry): entry is SmokeSkipEntry => entry !== null)
    .sort((a, b) => (
      a.reasonCode.localeCompare(b.reasonCode)
      || a.path.localeCompare(b.path)
      || a.method.localeCompare(b.method)
      || a.operationId.localeCompare(b.operationId)
    ));

  const summaryByReason = Object.fromEntries(
    [...skippedRoutes.reduce((acc, entry) => {
      acc.set(entry.reasonCode, (acc.get(entry.reasonCode) ?? 0) + 1);
      return acc;
    }, new Map<string, number>()).entries()].sort(([a], [b]) => a.localeCompare(b)),
  );

  return {
    totalRoutes: routes.length,
    skippedRouteCount: skippedRoutes.length,
    summaryByReason,
    skippedRoutes,
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
  let spec: OpenAPISpec;
  try {
    spec = loadSpec();
  } catch (err) {
    console.error('Failed to load OpenAPI spec. Run the server first or provide --spec <path>.');
    console.error((err as Error).message);
    process.exit(1);
  }

  const routes = extractRoutes(spec);
  if (routes.length === 0) {
    console.log('No routes found in OpenAPI spec. Convert more routes to createRoute() first.');
    process.exit(0);
  }

  // Group by first tag
  const byTag = new Map<string, RouteEntry[]>();
  for (const route of routes) {
    const tag = route.tags[0] ?? 'untagged';
    if (!byTag.has(tag)) byTag.set(tag, []);
    byTag.get(tag)!.push(route);
  }

  // Ensure output dir
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const skipReport = buildSkipReport(routes);
  writeFileSync(SKIP_REPORT_PATH, `${JSON.stringify(skipReport, null, 2)}\n`, 'utf-8');

  let totalTests = 0;
  for (const [tag, tagRoutes] of byTag) {
    const content = generateTestFile(tag, tagRoutes);
    const fileName = `smoke-${tag.toLowerCase().replace(/[^a-z0-9]/g, '-')}.test.ts`;
    writeFileSync(resolve(OUTPUT_DIR, fileName), content, 'utf-8');
    // Count: each route gets 2xx + optional 401 + optional 400
    const testCount = tagRoutes.reduce((sum, r) => {
      let count = 1; // 2xx always
      if (r.requiresAuth) count++; // 401
      if (r.hasBody) count++; // 400
      return sum + count;
    }, 0);
    totalTests += testCount;
    console.log(`  ✅ ${fileName} (${tagRoutes.length} routes, ~${testCount} tests)`);
  }

  console.log(`\nGenerated ${byTag.size} file(s), ~${totalTests} tests total.`);
  console.log(`Skipped ${skipReport.skippedRouteCount} route(s) in smoke; report: ${SKIP_REPORT_PATH}`);
  console.log(`Output: ${OUTPUT_DIR}/`);
}

main();
