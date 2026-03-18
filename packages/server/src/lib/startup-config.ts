import { materializeConfig, type EdgeBaseConfig } from '@edgebase-fun/shared';

function hasConfigContent(config: unknown): config is EdgeBaseConfig {
  return Boolean(
    config &&
    typeof config === 'object' &&
    !Array.isArray(config) &&
    Object.keys(config as Record<string, unknown>).length > 0,
  );
}

function shouldPreferTestConfig(
  processEnv: Record<string, string | undefined> | undefined,
): boolean {
  if (!processEnv) {
    return false;
  }

  if (processEnv.EDGEBASE_USE_TEST_CONFIG === '1' || processEnv.EDGEBASE_USE_TEST_CONFIG === 'true') {
    return true;
  }

  if (processEnv.VITEST === '1' || processEnv.VITEST === 'true') {
    return true;
  }

  if ((processEnv.VITEST_WORKER_ID ?? '').trim().length > 0) {
    return true;
  }

  if ((processEnv.VITEST_POOL_ID ?? '').trim().length > 0) {
    return true;
  }

  return processEnv.NODE_ENV === 'test';
}

async function loadMaterializedTestConfig(
  loadTestConfig: () => Promise<unknown>,
): Promise<EdgeBaseConfig | null> {
  let resolvedConfig: unknown = null;
  try {
    const mod = await loadTestConfig();
    resolvedConfig = (mod as { default?: unknown })?.default ?? mod;
  } catch {
    // Test-only config is optional in packaged/runtime environments.
  }

  if (!hasConfigContent(resolvedConfig)) {
    return null;
  }

  return materializeConfig(resolvedConfig as EdgeBaseConfig);
}

export function parseProcessEnvConfig(
  processEnv: Record<string, string | undefined> | undefined,
): EdgeBaseConfig | null {
  const rawConfig = processEnv?.EDGEBASE_CONFIG;
  if (!rawConfig || rawConfig.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawConfig) as EdgeBaseConfig;
    if (!hasConfigContent(parsed)) {
      return null;
    }

    return materializeConfig(parsed);
  } catch {
    return null;
  }
}

export async function resolveStartupConfig(
  generatedConfig: unknown,
  loadTestConfig: () => Promise<unknown>,
  processEnv: Record<string, string | undefined> | undefined,
  options?: { preferTestConfig?: boolean },
): Promise<EdgeBaseConfig | null> {
  const processEnvConfig = parseProcessEnvConfig(processEnv);
  if (processEnvConfig) {
    return processEnvConfig;
  }

  if (options?.preferTestConfig || shouldPreferTestConfig(processEnv)) {
    const preferredTestConfig = await loadMaterializedTestConfig(loadTestConfig);
    if (preferredTestConfig) {
      return preferredTestConfig;
    }
  }

  if (hasConfigContent(generatedConfig)) {
    return materializeConfig(generatedConfig as EdgeBaseConfig);
  }

  return loadMaterializedTestConfig(loadTestConfig);
}
