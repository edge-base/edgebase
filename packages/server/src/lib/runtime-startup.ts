// Compile-time constant — injected by wrangler [define] in wrangler.test.toml
declare const EDGEBASE_TEST_BUILD: boolean | undefined;

let startupPromise: Promise<void> | null = null;

async function detectWorkersTestRuntime(): Promise<boolean> {
  try {
    await import('cloudflare:test');
    return true;
  } catch {
    return false;
  }
}

export async function ensureServerStartup(): Promise<void> {
  if (startupPromise) {
    return startupPromise;
  }

  startupPromise = (async () => {
    const [{ resolveStartupConfig }, generatedConfigModule, { initFunctionRegistry }, doRouterModule] = await Promise.all([
      import('./startup-config.js'),
      import('../generated-config.js'),
      import('../_functions-registry.js'),
      import('./do-router.js'),
    ]);

    try {
      const processEnv = typeof process !== 'undefined' ? process.env : undefined;
      const isTestBuild = typeof EDGEBASE_TEST_BUILD !== 'undefined';
      const preferTestConfig = await detectWorkersTestRuntime() || isTestBuild;
      const resolvedConfig = await resolveStartupConfig(
        generatedConfigModule.default,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async () => import('../../edgebase.test.config.ts' as any),
        processEnv,
        { preferTestConfig },
      );

      if (resolvedConfig) {
        doRouterModule.setConfig(resolvedConfig);
      }
    } catch (err) {
      console.error('[EdgeBase] Failed to initialize config at startup:', err);
      throw err;
    }

    initFunctionRegistry();
  })();

  return startupPromise;
}
