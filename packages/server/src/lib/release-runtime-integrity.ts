import type { EdgeBaseConfig } from '@edge-base/shared';

// These identifiers are replaced with boolean literals only by CLI-owned
// bundles. Worker vars/secrets live on the request env object and therefore
// cannot satisfy either check.
declare const EDGEBASE_TEST_BUILD: boolean | undefined;
declare const EDGEBASE_LOCAL_DEV_BUILD: boolean | undefined;

/**
 * Bindings that are useful for local/test compatibility but must not replace
 * bundled production authority. URL overrides can receive auth tokens or full
 * email bodies, so accepting them in release mode would create an exfiltration
 * path even when edgebase.config.ts itself is safe.
 */
export const RELEASE_PROTECTED_RUNTIME_BINDINGS = [
  'EDGEBASE_CONFIG',
  'EDGEBASE_TEST',
  'EDGEBASE_TEST_BUILD',
  'EDGEBASE_LOCAL_DEV_BUILD',
  'EDGEBASE_DEV_SIDECAR_PORT',
  'EDGEBASE_INTERNAL_WORKER_URL',
  'EDGEBASE_EMAIL_API_URL',
  'EDGEBASE_SMS_API_URL',
  'EDGEBASE_APP_WEB_VERIFY_EMAIL_URL',
  'EDGEBASE_APP_WEB_RESET_PASSWORD_URL',
  'EDGEBASE_APP_WEB_MAGIC_LINK_URL',
  'EDGEBASE_APP_WEB_CHANGE_EMAIL_URL',
  'EDGEBASE_USE_TEST_CONFIG',
  'VITEST',
  'VITEST_WORKER_ID',
  'VITEST_POOL_ID',
] as const;

export function isTrustedEdgeBaseTestBuild(): boolean {
  return typeof EDGEBASE_TEST_BUILD !== 'undefined'
    && EDGEBASE_TEST_BUILD === true;
}

export function isTrustedEdgeBaseLocalDevBuild(): boolean {
  return typeof EDGEBASE_LOCAL_DEV_BUILD !== 'undefined'
    && EDGEBASE_LOCAL_DEV_BUILD === true;
}

export function collectReleaseRuntimeIntegrityViolations(
  runtimeBindings: Record<string, unknown> | undefined,
  trustedTestBuild: boolean,
  trustedLocalDevBuild = false,
): string[] {
  if (!runtimeBindings) return [];

  // The dedicated test bundle intentionally uses request-scoped config and
  // mock endpoints. The local-dev bundle gets one much narrower exception:
  // its loopback sidecar port, and only together with the CLI-owned runtime
  // mode. A runtime binding named like either build marker never grants trust.
  const trustedLocalSidecar = trustedLocalDevBuild
    && runtimeBindings.EDGEBASE_RUNTIME_MODE === 'local-development';
  const reserved: string[] = RELEASE_PROTECTED_RUNTIME_BINDINGS.filter((name) => {
    if (runtimeBindings[name] === undefined) return false;
    if (name === 'EDGEBASE_LOCAL_DEV_BUILD') return true;
    if (trustedTestBuild) return false;
    if (trustedLocalSidecar && name === 'EDGEBASE_DEV_SIDECAR_PORT') return false;
    return true;
  });

  // NODE_ENV is ambient in many self-hosted Node processes; only the value
  // that actually selects the bundled test config is forbidden here.
  if (!trustedTestBuild && runtimeBindings.NODE_ENV === 'test') reserved.push('NODE_ENV');

  // EDGEBASE_RUNTIME_MODE is an intentional CLI-owned public binding. Reject
  // malformed values even in a trusted test build.
  const runtimeMode = runtimeBindings.EDGEBASE_RUNTIME_MODE;
  if (
    runtimeMode !== undefined
    && runtimeMode !== 'cloudflare'
    && runtimeMode !== 'local-development'
    && runtimeMode !== 'self-hosted'
  ) reserved.push('EDGEBASE_RUNTIME_MODE');

  return reserved;
}

export function assertReleaseRuntimeIntegrity(
  runtimeConfig: EdgeBaseConfig | null,
  runtimeBindings: Record<string, unknown> | undefined,
): void {
  if (runtimeConfig?.release !== true || !runtimeBindings) return;

  const reserved = collectReleaseRuntimeIntegrityViolations(
    runtimeBindings,
    isTrustedEdgeBaseTestBuild(),
    isTrustedEdgeBaseLocalDevBuild(),
  );
  if (reserved.length === 0) return;

  throw new Error(
    `Release config integrity violation: protected runtime binding(s) ${reserved.join(', ')} `
    + 'cannot override bundled release behavior. Remove the legacy Worker var/secret and configure the production value in edgebase.config.ts.',
  );
}
