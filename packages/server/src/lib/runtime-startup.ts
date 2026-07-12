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
    const [
      { resolveStartupConfig },
      generatedConfigModule,
      { initFunctionRegistry },
      doRouterModule,
      { isTrustedEdgeBaseTestBuild },
    ] = await Promise.all([
      import('./startup-config.js'),
      import('../generated-config.js'),
      import('../_functions-registry.js'),
      import('./do-router.js'),
      import('./release-runtime-integrity.js'),
    ]);

    try {
      const processEnv = typeof process !== 'undefined' ? process.env : undefined;
      const isTestBuild = isTrustedEdgeBaseTestBuild();
      const preferTestConfig = await detectWorkersTestRuntime() || isTestBuild;
      const existingConfig = doRouterModule.parseConfig();
      const resolvedConfig = await resolveStartupConfig(
        generatedConfigModule.default,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async () => import('../../edgebase.test.config.ts' as any),
        processEnv,
        { preferTestConfig },
      );

      if (resolvedConfig && Object.keys(existingConfig).length === 0) {
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
