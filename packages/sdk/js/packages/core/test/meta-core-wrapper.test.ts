/**
 * Meta-test: Core↔Wrapper coverage.
 *
 * Verifies that every method in GeneratedDbApi interface is referenced
 * somewhere in the SDK source — either in core wrapper (table.ts, http.ts, etc.)
 * or in sibling packages (admin, web, react-native).
 *
 * If a new method is added to GeneratedDbApi (via codegen), this test
 * will fail until the wrapper integrates it or it's added to KNOWN_EXTERNAL.
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';

const GENERATED_PATH = resolve(
  new URL('../src/generated/api-core.ts', import.meta.url).pathname,
);
const SRC_DIR = resolve(new URL('../src', import.meta.url).pathname);

// Sibling package source directories (SRC_DIR = core/src → up 2 = packages/)
const JS_ROOT = resolve(SRC_DIR, '../..');
const SIBLING_SRC_DIRS = [
  resolve(JS_ROOT, 'admin/src'),
  resolve(JS_ROOT, 'web/src'),
].filter(existsSync);

// Also check react-native package (packages/sdk/react-native/src)
const RN_SRC_DIR = resolve(JS_ROOT, '../../react-native/src');
if (existsSync(RN_SRC_DIR)) {
  SIBLING_SRC_DIRS.push(RN_SRC_DIR);
}

// ─── Methods exposed in other packages, not in core wrapper ─────────────
// These are GeneratedDbApi methods used by admin/web/react-native packages
// or exposed directly through ApiPaths. When you add a test for one, remove it.
// Adding a NEW GeneratedDbApi method without referencing it anywhere will fail CI.
const KNOWN_EXTERNAL = new Set([
  // Methods that map to database-live / WebSocket (no HTTP wrapper needed)
  'connectDatabaseSubscription',
  'connectRoom',

  // OAuth: redirect/callback flows handled by browser, not SDK wrapper
  'oauthRedirect',
  'oauthCallback',
  'oauthLinkStart',
  'oauthLinkCallback',

  // Health check: consumed via direct fetch, no SDK wrapper needed
  'getHealth',

  // Auth: SDK auth module calls these via ApiPaths constants directly
  'authSignup',
  'authSignin',
  'authSigninAnonymous',
  'authSigninMagicLink',
  'authVerifyMagicLink',
  'authSigninPhone',
  'authVerifyPhone',
  'authLinkPhone',
  'authVerifyLinkPhone',
  'authSigninEmailOtp',
  'authVerifyEmailOtp',
  'authRefresh',
  'authSignout',
  'authChangePassword',
  'authChangeEmail',
  'authVerifyEmailChange',

  // MFA: SDK auth module handles these via direct HTTP calls
  'authMfaTotpEnroll',
  'authMfaTotpVerify',
  'authMfaVerify',
  'authMfaRecovery',
  'authMfaTotpDelete',
  'authMfaFactors',

  // Passkeys: SDK auth module handles WebAuthn flows directly
  'authPasskeysRegisterOptions',
  'authPasskeysRegister',
  'authPasskeysAuthOptions',
  'authPasskeysAuthenticate',
  'authPasskeysList',
  'authPasskeysDelete',

  // Auth: session/profile/email/password management via direct HTTP
  'authGetMe',
  'authUpdateProfile',
  'authGetSessions',
  'authDeleteSession',
  'authGetIdentities',
  'authDeleteIdentity',
  'authLinkEmail',
  'authRequestEmailVerification',
  'authVerifyEmail',
  'authRequestPasswordReset',
  'authResetPassword',

  // Schema/Config: consumed via direct fetch, no SDK wrapper needed
  'getSchema',
  'getConfig',

  // Storage: SDK storage module handles these via direct HTTP calls
  'uploadFile',
  'abortMultipartUpload',
  'checkFileExists', // Used in generated/client-wrappers.ts (excluded from scan)

  // Push: SDK push module handles these via direct HTTP calls
  'pushRegister',
  'pushUnregister',
  'pushTopicSubscribe',
  'pushTopicUnsubscribe',

  // Room/User/Analytics: SDK modules handle via direct HTTP
  'checkDatabaseSubscriptionConnection',
  'checkRoomConnection',
  'getRoomMetadata',
  'getRoomRealtimeSession',
  'createRoomRealtimeSession',
  'createRoomRealtimeIceServers',
  'addRoomRealtimeTracks',
  'renegotiateRoomRealtimeSession',
  'closeRoomRealtimeTracks',
  'trackEvents',
]);

// Extract method names from the GeneratedDbApi interface
function extractInterfaceMethods(source: string): string[] {
  // Use \n} to match the closing brace on its own line — avoids stopping
  // early at } inside JSDoc path params like {credentialId}.
  const interfaceMatch = source.match(
    /export interface GeneratedDbApi \{([\s\S]*?)\n\}/,
  );
  if (!interfaceMatch) return [];
  const body = interfaceMatch[1];
  const methods: string[] = [];
  for (const m of body.matchAll(/^\s+(\w+)\(/gm)) {
    methods.push(m[1]);
  }
  return methods;
}

// Read all .ts source files from a directory (non-generated, non-test)
function readSourceDir(dir: string): string {
  if (!existsSync(dir)) return '';
  const files = readdirSync(dir, { recursive: true }) as string[];
  return files
    .filter((f) => f.endsWith('.ts') && !f.includes('generated') && !f.includes('test'))
    .map((f) => readFileSync(resolve(dir, f), 'utf-8'))
    .join('\n');
}

// Read all wrapper source files across core + sibling packages
function getAllWrapperSource(): string {
  const parts: string[] = [];
  // Core wrapper
  parts.push(readSourceDir(SRC_DIR));
  // Sibling packages (admin, web, react-native)
  for (const dir of SIBLING_SRC_DIRS) {
    parts.push(readSourceDir(dir));
  }
  return parts.join('\n');
}

describe('Core↔Wrapper meta test', () => {
  const generatedSource = readFileSync(GENERATED_PATH, 'utf-8');
  const methods = extractInterfaceMethods(generatedSource);

  it('GeneratedDbApi has at least 1 method', () => {
    expect(methods.length).toBeGreaterThanOrEqual(1);
  });

  it('KNOWN_EXTERNAL entries still exist in GeneratedDbApi', () => {
    for (const name of KNOWN_EXTERNAL) {
      expect(
        methods.includes(name),
        `KNOWN_EXTERNAL has '${name}' but it no longer exists in GeneratedDbApi. Remove it.`,
      ).toBe(true);
    }
  });

  // Every GeneratedDbApi method must be referenced in at least one
  // wrapper source file across core, admin, web, or react-native.
  it('every GeneratedDbApi method is referenced in wrapper', () => {
    const wrapperSource = getAllWrapperSource();
    const unreferenced: string[] = [];

    for (const method of methods) {
      if (KNOWN_EXTERNAL.has(method)) continue;
      if (!wrapperSource.includes(method)) {
        unreferenced.push(method);
      }
    }

    expect(
      unreferenced,
      `These GeneratedDbApi methods are not referenced in any wrapper source file:\n` +
        unreferenced.map((m) => `  - ${m}()`).join('\n') +
        `\nEither add wrapper integration or add to KNOWN_EXTERNAL.`,
    ).toEqual([]);
  });
});
