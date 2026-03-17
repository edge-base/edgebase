#!/usr/bin/env tsx
/**
 * Client Wrapper Codegen Validation Test
 *
 * Validates:
 *   1. wrapper-config.json structure & integrity
 *   2. Every operationId in wrapper-config exists in openapi.json
 *   3. No duplicate wrapper method names within a group
 *   4. All 12 generated wrapper files exist
 *   5. Generated files contain expected class names and method counts
 *   6. Wrapper method names don't collide with core operationIds
 *   7. Reverse check: every client-tagged operationId is covered or explicitly excluded
 *   8. SDK integration: hand-written SDK code uses GeneratedDbApi from generated files
 *
 * Usage:
 *   npx tsx tools/sdk-codegen/test-wrappers.ts
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

// ─── Load Files ─────────────────────────────────────────────────────────────

const config = JSON.parse(readFileSync(resolve(__dirname, 'config.json'), 'utf-8'));
const wrapperConfig = JSON.parse(readFileSync(resolve(__dirname, 'wrapper-config.json'), 'utf-8'));
const spec = JSON.parse(readFileSync(resolve(ROOT, config.specPath), 'utf-8'));

// Collect all operationIds from spec
const specOperationIds = new Set<string>();
for (const pathMethods of Object.values(spec.paths)) {
  for (const op of Object.values(pathMethods as Record<string, any>)) {
    if (op.operationId) specOperationIds.add(op.operationId);
  }
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${msg}`);
  }
}

function toPascalCase(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

// ─── Test 1: wrapper-config.json structure ──────────────────────────────────

console.log('\n🧪 Test 1: wrapper-config.json structure');

assert(typeof wrapperConfig.description === 'string', 'has description');
assert(typeof wrapperConfig.groups === 'object', 'has groups object');

const groupNames = Object.keys(wrapperConfig.groups);
assert(groupNames.length >= 3, `has at least 3 groups (got ${groupNames.length})`);
assert(groupNames.includes('auth'), 'has auth group');
assert(groupNames.includes('storage'), 'has storage group');
assert(groupNames.includes('analytics'), 'has analytics group');

for (const [name, group] of Object.entries(wrapperConfig.groups) as [string, any][]) {
  assert(Array.isArray(group.methods), `${name}.methods is array`);
  assert(group.methods.length > 0, `${name}.methods is non-empty`);
  for (const m of group.methods) {
    assert(typeof m.op === 'string' && m.op.length > 0, `${name}: method has op`);
    assert(typeof m.name === 'string' && m.name.length > 0, `${name}: method has name`);
  }
}

// ─── Test 2: operationId validation against openapi.json ────────────────────

console.log('🧪 Test 2: operationId mapping validation');

let totalMethods = 0;
for (const [groupName, group] of Object.entries(wrapperConfig.groups) as [string, any][]) {
  for (const m of group.methods) {
    assert(
      specOperationIds.has(m.op),
      `${groupName}.${m.name} → operationId '${m.op}' exists in spec`,
    );
    totalMethods++;
  }
}
assert(totalMethods > 0, `wrapper config defines methods (got ${totalMethods})`);

// ─── Test 3: no duplicate wrapper names within a group ──────────────────────

console.log('🧪 Test 3: no duplicate wrapper names');

for (const [groupName, group] of Object.entries(wrapperConfig.groups) as [string, any][]) {
  const names = new Set<string>();
  for (const m of group.methods) {
    assert(!names.has(m.name), `${groupName}: no duplicate name '${m.name}'`);
    names.add(m.name);
  }
  const ops = new Set<string>();
  for (const m of group.methods) {
    assert(!ops.has(m.op), `${groupName}: no duplicate op '${m.op}'`);
    ops.add(m.op);
  }
}

// ─── Test 4: generated wrapper files exist ──────────────────────────────────

console.log('🧪 Test 4: generated wrapper files exist');

const wrapperPaths = config.wrappers as Record<string, string>;
assert(Object.keys(wrapperPaths).length === 13, `config has 13 wrapper paths (got ${Object.keys(wrapperPaths).length})`);

for (const [lang, relPath] of Object.entries(wrapperPaths)) {
  const fullPath = resolve(ROOT, relPath);
  assert(existsSync(fullPath), `${lang}: ${relPath} exists`);
}

// ─── Test 5: generated file content validation ─────────────────────────────

console.log('🧪 Test 5: generated file content validation');

// TypeScript
const tsContent = readFileSync(resolve(ROOT, wrapperPaths.typescript), 'utf-8');
assert(tsContent.includes('DO NOT EDIT'), 'TS: has DO NOT EDIT header');
assert(tsContent.includes('import type { GeneratedDbApi }'), 'TS: imports GeneratedDbApi');

for (const [groupName, group] of Object.entries(wrapperConfig.groups) as [string, any][]) {
  const className = `Generated${toPascalCase(groupName)}Methods`;
  assert(tsContent.includes(className), `TS: has ${className} class`);
  for (const m of group.methods) {
    assert(tsContent.includes(`async ${m.name}(`), `TS: has ${groupName} method ${m.name}`);
    assert(tsContent.includes(`this.core.${m.op}(`), `TS: ${m.name} delegates to core.${m.op}`);
  }
}

// Python
const pyContent = readFileSync(resolve(ROOT, wrapperPaths.python), 'utf-8');
assert(pyContent.includes('DO NOT EDIT'), 'Python: has DO NOT EDIT header');
for (const groupName of groupNames) {
  const className = `class Generated${toPascalCase(groupName)}Methods`;
  assert(pyContent.includes(className), `Python: has ${className}`);
}

// Dart
const dartContent = readFileSync(resolve(ROOT, wrapperPaths.dart), 'utf-8');
assert(dartContent.includes('GeneratedAuthMethods'), 'Dart: has GeneratedAuthMethods');
assert(dartContent.includes('Future<dynamic>'), 'Dart: uses Future<dynamic>');

// Go
const goContent = readFileSync(resolve(ROOT, wrapperPaths.go), 'utf-8');
assert(goContent.includes('GeneratedAuthMethods'), 'Go: has GeneratedAuthMethods');
assert(goContent.includes('context.Context'), 'Go: uses context.Context');

// Kotlin
const ktContent = readFileSync(resolve(ROOT, wrapperPaths.kotlin), 'utf-8');
assert(ktContent.includes('open class GeneratedAuthMethods'), 'Kotlin: has open class');
assert(ktContent.includes('open suspend fun'), 'Kotlin: uses suspend fun');

// Swift
const swiftContent = readFileSync(resolve(ROOT, wrapperPaths.swift), 'utf-8');
assert(swiftContent.includes('GeneratedAuthMethods'), 'Swift: has GeneratedAuthMethods');
assert(swiftContent.includes('async throws'), 'Swift: uses async throws');

// Rust
const rustContent = readFileSync(resolve(ROOT, wrapperPaths.rust), 'utf-8');
assert(rustContent.includes('GeneratedAuthMethods'), 'Rust: has GeneratedAuthMethods');
assert(rustContent.includes('pub async fn'), 'Rust: uses pub async fn');

// C#
const csContent = readFileSync(resolve(ROOT, wrapperPaths.csharp), 'utf-8');
assert(csContent.includes('GeneratedAuthMethods'), 'C#: has GeneratedAuthMethods');
assert(csContent.includes('virtual Task<'), 'C#: uses virtual Task<>');

// Java
const javaContent = readFileSync(resolve(ROOT, wrapperPaths.java), 'utf-8');
assert(javaContent.includes('GeneratedClientWrappers'), 'Java: has outer class');
assert(javaContent.includes('static class AuthMethods'), 'Java: has static inner class');

// PHP
const phpContent = readFileSync(resolve(ROOT, wrapperPaths.php), 'utf-8');
assert(phpContent.includes('GeneratedAuthMethods'), 'PHP: has GeneratedAuthMethods');
assert(phpContent.includes('create_multipart_upload'), 'PHP: storage wrapper exposes multipart creation');
assert(phpContent.includes('complete_multipart_upload'), 'PHP: storage wrapper exposes multipart completion');
assert(phpContent.includes('abort_multipart_upload'), 'PHP: storage wrapper exposes multipart abort');

// C++ header
const cppHContent = readFileSync(resolve(ROOT, wrapperPaths.cpp_header), 'utf-8');
assert(cppHContent.includes('GeneratedAuthMethods'), 'C++ header: has GeneratedAuthMethods');
assert(cppHContent.includes('#pragma once'), 'C++ header: has pragma once');

// C++ impl
const cppContent = readFileSync(resolve(ROOT, wrapperPaths.cpp_impl), 'utf-8');
assert(cppContent.includes('GeneratedAuthMethods'), 'C++ impl: has GeneratedAuthMethods');

// Ruby
const rbContent = readFileSync(resolve(ROOT, wrapperPaths.ruby), 'utf-8');
assert(rbContent.includes('DO NOT EDIT'), 'Ruby: has DO NOT EDIT header');
assert(rbContent.includes('def '), 'Ruby: has def methods');
assert(rbContent.includes('create_multipart_upload'), 'Ruby: storage wrapper exposes multipart creation');
assert(rbContent.includes('complete_multipart_upload'), 'Ruby: storage wrapper exposes multipart completion');
assert(rbContent.includes('abort_multipart_upload'), 'Ruby: storage wrapper exposes multipart abort');
for (const groupName of groupNames) {
  const className = `Generated${toPascalCase(groupName)}Methods`;
  assert(rbContent.includes(className), `Ruby: has ${className}`);
}

// ─── Test 6: cross-group name collision check ───────────────────────────────

console.log('🧪 Test 6: cross-group collision check');

const allWrapperNames = new Map<string, string>();
for (const [groupName, group] of Object.entries(wrapperConfig.groups) as [string, any][]) {
  for (const m of group.methods) {
    if (allWrapperNames.has(m.name)) {
      // Same name in different groups is OK (e.g. storage.delete vs auth.delete) since they're in different classes
      // But same name + same op would be weird
      assert(
        allWrapperNames.get(m.name) !== m.op,
        `cross-group: '${m.name}' doesn't map to same op in ${groupName} and elsewhere`,
      );
    }
    allWrapperNames.set(m.name, m.op);
  }
}

// ─── Test 7: reverse check — every client operationId covered ────────────────

console.log('🧪 Test 7: reverse coverage — every client operationId accounted for');

// Collect all operationIds that wrapper-config covers
const wrappedOps = new Set<string>();
for (const group of Object.values(wrapperConfig.groups) as any[]) {
  for (const m of group.methods) {
    wrappedOps.add(m.op);
  }
}

// Operations intentionally excluded from wrapper layer.
// Each must have a reason comment. When adding a new endpoint,
// you MUST either add it to wrapper-config.json or list it here.
const EXCLUDED_OPS: Record<string, string> = {
  // ── Client: DB/Table CRUD — exposed via TableRef/DbRef ──
  dbSingleCountRecords: 'TableRef API',
  dbSingleSearchRecords: 'TableRef API',
  dbSingleGetRecord: 'TableRef API',
  dbSingleUpdateRecord: 'TableRef API',
  dbSingleDeleteRecord: 'TableRef API',
  dbSingleListRecords: 'TableRef API',
  dbSingleInsertRecord: 'TableRef API',
  dbSingleBatchRecords: 'TableRef API',
  dbSingleBatchByFilter: 'TableRef API',
  dbCountRecords: 'TableRef API',
  dbSearchRecords: 'TableRef API',
  dbGetRecord: 'TableRef API',
  dbUpdateRecord: 'TableRef API',
  dbDeleteRecord: 'TableRef API',
  dbListRecords: 'TableRef API',
  dbInsertRecord: 'TableRef API',
  dbBatchRecords: 'TableRef API',
  dbBatchByFilter: 'TableRef API',
  // ── Client: Storage — binary or dedicated StorageClient ──
  uploadFile: 'binary upload via StorageClient',
  downloadFile: 'binary download via StorageClient',
  listFiles: 'StorageClient.list()',
  getUploadParts: 'multipart via StorageClient',
  createMultipartUpload: 'multipart via StorageClient',
  uploadPart: 'multipart via StorageClient',
  completeMultipartUpload: 'multipart via StorageClient',
  abortMultipartUpload: 'multipart via StorageClient',
  // ── Client: OAuth — redirect-based ──
  oauthRedirect: 'browser redirect flow',
  oauthCallback: 'browser redirect flow',
  oauthLinkStart: 'browser redirect flow',
  oauthLinkCallback: 'browser redirect flow',
  // ── Client: Realtime/Room — WebSocket protocol ──
  connectDatabaseSubscription: 'WebSocket protocol',
  checkDatabaseSubscriptionConnection: 'WebSocket readiness check',
  connectRoom: 'WebSocket protocol',
  checkRoomConnection: 'WebSocket readiness check',
  getRoomMetadata: 'Room SDK',
  // ── Client: Auth — internal token ops ──
  authRefresh: 'internal token refresh',
  authGetIdentities: 'auth SDK direct HTTP',
  authDeleteIdentity: 'auth SDK direct HTTP',
  authRequestEmailVerification: 'auth SDK direct HTTP',
  // ── Client: Push — dedicated push SDK ──
  pushRegister: 'client push SDK',
  pushUnregister: 'client push SDK',
  pushTopicSubscribe: 'client push SDK',
  pushTopicUnsubscribe: 'client push SDK',
  // ── Client: System/Utility ──
  getHealth: 'system health',
  getConfig: 'system config',
  getSchema: 'schema introspection',
  // ── Admin API: auth management ──
  adminAuthGetUser: 'admin SDK',
  adminAuthUpdateUser: 'admin SDK',
  adminAuthDeleteUser: 'admin SDK',
  adminAuthListUsers: 'admin SDK',
  adminAuthCreateUser: 'admin SDK',
  adminAuthDeleteUserMfa: 'admin SDK',
  adminAuthSetClaims: 'admin SDK',
  adminAuthRevokeUserSessions: 'admin SDK',
  adminAuthImportUsers: 'admin SDK',
  // ── Admin API: services ──
  databaseLiveBroadcast: 'admin SDK (broadcast)',
  executeSql: 'admin SDK (raw SQL)',
  kvOperation: 'admin SDK (KV)',
  executeD1Query: 'admin SDK (D1)',
  vectorizeOperation: 'admin SDK (Vectorize)',
  // ── Admin API: push ──
  pushSend: 'admin SDK (push)',
  pushSendMany: 'admin SDK (push)',
  pushSendToToken: 'admin SDK (push)',
  pushSendToTopic: 'admin SDK (push)',
  pushBroadcast: 'admin SDK (push)',
  getPushLogs: 'admin SDK (push)',
  getPushTokens: 'admin SDK (push)',
  patchPushTokens: 'admin SDK (push)',
  putPushTokens: 'admin SDK (push)',
  // ── Admin API: analytics ──
  queryAnalytics: 'admin SDK (analytics)',
  queryCustomEvents: 'admin SDK (analytics)',
  // ── Admin Dashboard endpoints ──
  adminSetupStatus: 'admin dashboard',
  adminSetup: 'admin dashboard',
  adminLogin: 'admin dashboard',
  adminRefresh: 'admin dashboard',
  adminResetPassword: 'admin dashboard',
  adminListTables: 'admin dashboard',
  adminGetTableRecords: 'admin dashboard',
  adminCreateTableRecord: 'admin dashboard',
  adminUpdateTableRecord: 'admin dashboard',
  adminDeleteTableRecord: 'admin dashboard',
  adminListUsers: 'admin dashboard',
  adminCreateUser: 'admin dashboard',
  adminUpdateUser: 'admin dashboard',
  adminDeleteUser: 'admin dashboard',
  adminGetUserProfile: 'admin dashboard',
  adminDeleteUserSessions: 'admin dashboard',
  adminCleanupAnon: 'admin dashboard',
  adminListBuckets: 'admin dashboard',
  adminListBucketObjects: 'admin dashboard',
  adminDeleteBucketObject: 'admin dashboard',
  adminGetSchema: 'admin dashboard',
  adminExportTable: 'admin dashboard',
  adminGetLogs: 'admin dashboard',
  adminGetMonitoring: 'admin dashboard',
  adminGetAnalytics: 'admin dashboard',
  adminGetOverview: 'admin dashboard',
  adminGetDevInfo: 'admin dashboard',
  adminExecuteSql: 'admin dashboard',
  adminImportTable: 'admin dashboard',
  adminRulesTest: 'admin dashboard',
  adminListFunctions: 'admin dashboard',
  adminGetConfigInfo: 'admin dashboard',
  adminGetRecentLogs: 'admin dashboard',
  adminGetAuthSettings: 'admin dashboard',
  adminDeleteUserMfa: 'admin dashboard',
  adminUploadFile: 'admin dashboard',
  adminGetPushTokens: 'admin dashboard',
  adminGetPushLogs: 'admin dashboard',
  adminTestPushSend: 'admin dashboard',
  adminGetUser: 'admin dashboard',
  adminGetBucketObject: 'admin dashboard',
  adminGetBucketStats: 'admin dashboard',
  adminCreateSignedUrl: 'admin dashboard',
  adminGetAnalyticsEvents: 'admin dashboard',
  adminGetEmailTemplates: 'admin dashboard',
  adminSendPasswordReset: 'admin dashboard',
  adminListAdmins: 'admin dashboard',
  adminCreateAdmin: 'admin dashboard',
  adminDeleteAdmin: 'admin dashboard',
  adminChangePassword: 'admin dashboard',
  // ── Admin: Backup ──
  adminBackupListDOs: 'admin backup',
  adminBackupDumpDO: 'admin backup',
  adminBackupRestoreDO: 'admin backup',
  adminBackupDumpD1: 'admin backup',
  adminBackupRestoreD1: 'admin backup',
  adminBackupGetConfig: 'admin backup',
  backupListDOs: 'admin backup',
  backupGetConfig: 'admin backup',
  backupWipeDO: 'admin backup',
  backupDumpDO: 'admin backup',
  backupRestoreDO: 'admin backup',
  backupDumpD1: 'admin backup',
  backupRestoreD1: 'admin backup',
  backupCleanupPlugin: 'admin backup',
  backupDumpControlD1: 'admin backup',
  backupRestoreControlD1: 'admin backup',
  backupDumpStorage: 'admin backup',
  backupRestoreStorage: 'admin backup',
  backupResyncUsersPublic: 'admin backup',
  backupExportTable: 'admin backup',
  backupDumpData: 'admin backup',
  backupRestoreData: 'admin backup',
};

// Collect all client-tagged operationIds from spec
const clientOps = new Set<string>();
for (const [, methods] of Object.entries(spec.paths)) {
  for (const [, operation] of Object.entries(methods as Record<string, any>)) {
    const op = operation as any;
    if (op.operationId) {
      clientOps.add(op.operationId);
    }
  }
}

const uncovered: string[] = [];
for (const opId of clientOps) {
  if (!wrappedOps.has(opId) && !EXCLUDED_OPS[opId]) {
    uncovered.push(opId);
  }
}

assert(
  uncovered.length === 0,
  `all operationIds covered — uncovered: [${uncovered.join(', ')}]`,
);

// Also verify excluded ops are real operationIds (catch stale entries)
for (const opId of Object.keys(EXCLUDED_OPS)) {
  assert(
    clientOps.has(opId),
    `EXCLUDED_OPS '${opId}' exists in openapi.json (not stale)`,
  );
}

console.log(`  ℹ️  ${wrappedOps.size} wrapped + ${Object.keys(EXCLUDED_OPS).length} excluded = ${wrappedOps.size + Object.keys(EXCLUDED_OPS).length} total (spec has ${clientOps.size})`);

// ─── Test 8: SDK integration — hand-written code uses GeneratedDbApi ─────────

console.log('🧪 Test 8: SDK integration — GeneratedDbApi wired into hand-written code');

// For each language, verify the hand-written SDK code imports/uses GeneratedDbApi.
// This guarantees the generated Core layer is actually connected.
// Pattern can be any of: GeneratedDbApi, DefaultDbApi, api_core, api-core
// because some SDKs use the implementation class or re-export the module.
const sdkIntegrationChecks: Array<{
  lang: string;
  file: string;
  patterns: string[]; // at least one must match
}> = [
  // JS/TS
  { lang: 'JS/web-auth', file: 'packages/sdk/js/packages/web/src/auth.ts', patterns: ['GeneratedDbApi'] },
  { lang: 'JS/web-client', file: 'packages/sdk/js/packages/web/src/client.ts', patterns: ['GeneratedDbApi', 'DefaultDbApi', 'generated'] },
  { lang: 'JS/core-storage', file: 'packages/sdk/js/packages/core/src/storage.ts', patterns: ['GeneratedDbApi'] },
  // Python
  { lang: 'Python/admin', file: 'packages/sdk/python/packages/admin/src/edgebase_admin/admin_client.py', patterns: ['GeneratedDbApi'] },
  { lang: 'Python/core', file: 'packages/sdk/python/packages/core/src/edgebase_core/table.py', patterns: ['GeneratedDbApi'] },
  // Go
  { lang: 'Go', file: 'packages/sdk/go/edgebase.go', patterns: ['GeneratedDbApi'] },
  // Rust
  { lang: 'Rust', file: 'packages/sdk/rust/packages/core/src/lib.rs', patterns: ['GeneratedDbApi'] },
  // Dart
  { lang: 'Dart/flutter', file: 'packages/sdk/dart/packages/flutter/lib/src/client.dart', patterns: ['GeneratedDbApi'] },
  { lang: 'Dart/core-barrel', file: 'packages/sdk/dart/packages/core/lib/edgebase_core.dart', patterns: ['api_core'] },
  // Swift
  { lang: 'Swift/ios', file: 'packages/sdk/swift/packages/ios/Sources/EdgeBaseClient.swift', patterns: ['GeneratedDbApi'] },
  { lang: 'Swift/core', file: 'packages/sdk/swift/packages/core/Sources/TableRef.swift', patterns: ['GeneratedDbApi'] },
  // C#
  { lang: 'C#/unity', file: 'packages/sdk/csharp/packages/unity/EdgeBaseClient.cs', patterns: ['GeneratedDbApi'] },
  { lang: 'C#/core', file: 'packages/sdk/csharp/packages/core/TableRef.cs', patterns: ['GeneratedDbApi'] },
  // C++
  { lang: 'C++/src', file: 'packages/sdk/cpp/packages/core/src/edgebase.cpp', patterns: ['GeneratedDbApi'] },
  { lang: 'C++/header', file: 'packages/sdk/cpp/packages/core/include/edgebase/edgebase.h', patterns: ['GeneratedDbApi'] },
  // PHP
  { lang: 'PHP/core', file: 'packages/sdk/php/packages/core/src/DbRef.php', patterns: ['GeneratedDbApi'] },
  { lang: 'PHP/admin', file: 'packages/sdk/php/packages/admin/src/AdminClient.php', patterns: ['GeneratedDbApi'] },
  // Kotlin
  { lang: 'Kotlin/client', file: 'packages/sdk/kotlin/client/src/commonMain/kotlin/dev/edgebase/sdk/client/ClientEdgeBase.kt', patterns: ['GeneratedDbApi'] },
  { lang: 'Kotlin/core', file: 'packages/sdk/kotlin/core/src/commonMain/kotlin/dev/edgebase/sdk/core/TableRef.kt', patterns: ['GeneratedDbApi'] },
  // Java
  { lang: 'Java/android', file: 'packages/sdk/java/packages/android/src/main/java/dev/edgebase/sdk/client/ClientEdgeBase.java', patterns: ['GeneratedDbApi'] },
  { lang: 'Java/core', file: 'packages/sdk/java/packages/core/src/main/java/dev/edgebase/sdk/core/TableRef.java', patterns: ['GeneratedDbApi'] },
  // React Native
  { lang: 'ReactNative', file: 'packages/sdk/react-native/src/client.ts', patterns: ['GeneratedDbApi', 'DefaultDbApi'] },
  // Ruby
  { lang: 'Ruby/core', file: 'packages/sdk/ruby/packages/core/lib/edgebase_core/storage.rb', patterns: ['GeneratedDbApi'] },
  { lang: 'Ruby/admin', file: 'packages/sdk/ruby/packages/admin/lib/edgebase_admin/admin_client.rb', patterns: ['GeneratedDbApi'] },
];

for (const check of sdkIntegrationChecks) {
  const fullPath = resolve(ROOT, check.file);
  if (!existsSync(fullPath)) {
    assert(false, `${check.lang}: file exists — ${check.file}`);
    continue;
  }
  const content = readFileSync(fullPath, 'utf-8');
  const matched = check.patterns.some(p => content.includes(p));
  assert(
    matched,
    `${check.lang}: ${check.file} uses one of [${check.patterns.join(', ')}]`,
  );
}

// ─── Summary ────────────────────────────────────────────────────────────────

console.log(`\n${'═'.repeat(60)}`);
if (failed === 0) {
  console.log(`✅ All ${passed} assertions passed.`);
  process.exit(0);
} else {
  console.log(`❌ ${failed} failed, ${passed} passed.`);
  process.exit(1);
}
