/**
 * 서버 단위 테스트 — bundled runtime config + public config route helpers
 *
 * 실행: cd packages/server && npx vitest run src/__tests__/config.test.ts
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseConfig, setConfig } from '../lib/do-router.js';
import type { EdgeBaseConfig } from '@edge-base/shared';
import {
  parseProcessEnvConfig,
  resolveStartupConfig,
} from '../lib/startup-config.js';
import {
  assertReleaseRuntimeIntegrity,
  collectReleaseRuntimeIntegrityViolations,
  isTrustedEdgeBaseLocalDevBuild,
  isTrustedEdgeBaseTestBuild,
  RELEASE_PROTECTED_RUNTIME_BINDINGS,
} from '../lib/release-runtime-integrity.js';

afterEach(() => {
  setConfig({} as EdgeBaseConfig);
});

async function loadFreshDoRouter() {
  vi.resetModules();
  return import('../lib/do-router.js');
}

function getCaptchaFromRuntime(env: {
  CAPTCHA_SITE_KEY?: string;
}): { siteKey: string } | null {
  if (env.CAPTCHA_SITE_KEY) {
    return { siteKey: env.CAPTCHA_SITE_KEY };
  }

  const config = parseConfig();
  const captchaCfg = (config as { captcha?: { siteKey?: string } }).captcha;
  if (captchaCfg?.siteKey) {
    return { siteKey: captchaCfg.siteKey };
  }

  return null;
}

describe('parseConfig', () => {
  it('returns empty object when no startup config has been injected', () => {
    expect(parseConfig()).toEqual({});
  });

  it('returns the injected bundled config', () => {
    const cfg: EdgeBaseConfig = {
      databases: {
        shared: {
          tables: {
            posts: {},
          },
        },
      },
    };

    setConfig(cfg);

    expect(parseConfig()).toBe(cfg);
  });

  it('ignores unrelated runtime input and keeps singleton config authoritative', () => {
    setConfig({ databases: { shared: { tables: { posts: {} } } } } as EdgeBaseConfig);

    expect(parseConfig({ arbitrary: true })).toEqual({
      databases: { shared: { tables: { posts: {} } } },
    });
  });

  it('empty injected config stays authoritative', () => {
    setConfig({} as EdgeBaseConfig);

    expect(parseConfig({ arbitrary: true })).toEqual({});
  });

  it('request-scoped EDGEBASE_CONFIG overrides singleton config', () => {
    setConfig({ databases: { shared: { tables: { posts: {} } } } } as EdgeBaseConfig);

    expect(parseConfig({
      EDGEBASE_CONFIG: JSON.stringify({
        databases: {
          shared: {
            tables: {
              comments: {
                schema: {
                  body: { type: 'string' },
                },
              },
            },
          },
        },
      }),
    })).toEqual({
      databases: {
        shared: {
          tables: {
            comments: {
              schema: {
                body: { type: 'string' },
              },
            },
          },
        },
      },
    });
  });

  it('fresh module without startup config returns empty object', async () => {
    const fresh = await loadFreshDoRouter();
    expect(fresh.parseConfig({ arbitrary: true })).toEqual({});
  });

  it('fresh module reads request-scoped EDGEBASE_CONFIG when present', async () => {
    const fresh = await loadFreshDoRouter();
    expect(fresh.parseConfig({
      EDGEBASE_CONFIG: JSON.stringify({
        databases: {
          shared: {
            tables: {
              posts: {
                schema: {
                  title: { type: 'string' },
                },
              },
            },
          },
        },
      }),
    })).toEqual({
      databases: {
        shared: {
          tables: {
            posts: {
              schema: {
                title: { type: 'string' },
              },
            },
          },
        },
      },
    });
  });

  it('accepts request-scoped EDGEBASE_CONFIG when Wrangler provides it as an object binding', () => {
    setConfig({ databases: { from: 'singleton' } } as EdgeBaseConfig);

    expect(parseConfig({
      EDGEBASE_CONFIG: {
        databases: {
          shared: {
            tables: {
              posts: {
                schema: {
                  title: { type: 'string' },
                },
              },
            },
          },
        },
      },
    })).toEqual({
      databases: {
        shared: {
          tables: {
            posts: {
              schema: {
                title: { type: 'string' },
              },
            },
          },
        },
      },
    });
  });

  it('fails closed when a request binding tries to override a bundled release config', () => {
    setConfig({
      release: true,
      databases: { shared: { tables: { generated: {} } } },
    } as EdgeBaseConfig);

    expect(() => parseConfig({
      EDGEBASE_CONFIG: JSON.stringify({ release: false, databases: {} }),
    })).toThrow(/Release config integrity violation.*EDGEBASE_CONFIG/i);
    expect(() => parseConfig({ EDGEBASE_TEST: '1' }))
      .toThrow(/Release config integrity violation.*EDGEBASE_TEST/i);
    expect(() => parseConfig({ EDGEBASE_LOCAL_DEV_BUILD: 'true' }))
      .toThrow(/Release config integrity violation.*EDGEBASE_LOCAL_DEV_BUILD/i);
    expect(() => parseConfig({ EDGEBASE_EMAIL_API_URL: 'https://sink.example.test' }))
      .toThrow(/Release config integrity violation.*EDGEBASE_EMAIL_API_URL/i);
    expect(() => parseConfig({ EDGEBASE_SMS_API_URL: 'https://sink.example.test/sms' }))
      .toThrow(/Release config integrity violation.*EDGEBASE_SMS_API_URL/i);
    expect(() => parseConfig({ EDGEBASE_INTERNAL_WORKER_URL: 'https://sink.example.test' }))
      .toThrow(/Release config integrity violation.*EDGEBASE_INTERNAL_WORKER_URL/i);
    expect(() => parseConfig({ EDGEBASE_DEV_SIDECAR_PORT: '8788' }))
      .toThrow(/Release config integrity violation.*EDGEBASE_DEV_SIDECAR_PORT/i);
    expect(() => parseConfig({
      EDGEBASE_APP_WEB_RESET_PASSWORD_URL: 'https://sink.example.test/reset',
    })).toThrow(/Release config integrity violation.*EDGEBASE_APP_WEB_RESET_PASSWORD_URL/i);
    expect(parseConfig({ unrelated: true })).toMatchObject({ release: true });
  });
});

describe('startup config resolution', () => {
  it('centralizes the protected release runtime binding contract', () => {
    expect(RELEASE_PROTECTED_RUNTIME_BINDINGS).toContain('EDGEBASE_EMAIL_API_URL');
    expect(RELEASE_PROTECTED_RUNTIME_BINDINGS).toContain('EDGEBASE_SMS_API_URL');
    expect(RELEASE_PROTECTED_RUNTIME_BINDINGS).toContain('EDGEBASE_INTERNAL_WORKER_URL');
    expect(RELEASE_PROTECTED_RUNTIME_BINDINGS).toContain('EDGEBASE_TEST_BUILD');
    expect(RELEASE_PROTECTED_RUNTIME_BINDINGS).toContain('EDGEBASE_LOCAL_DEV_BUILD');
    expect(RELEASE_PROTECTED_RUNTIME_BINDINGS).toContain('EDGEBASE_DEV_SIDECAR_PORT');
    expect(() => assertReleaseRuntimeIntegrity(
      { release: true },
      { EDGEBASE_APP_WEB_MAGIC_LINK_URL: 'https://sink.example.test' },
    )).toThrow(/EDGEBASE_APP_WEB_MAGIC_LINK_URL/i);
  });

  it('allows test-only bindings only for the compile-time trusted test build', () => {
    expect(isTrustedEdgeBaseTestBuild()).toBe(false);
    const bindings = {
      EDGEBASE_TEST: '1',
      EDGEBASE_USE_TEST_CONFIG: '1',
      EDGEBASE_TEST_BUILD: 'true',
      EDGEBASE_DEV_SIDECAR_PORT: '8788',
      EDGEBASE_CONFIG: '{"release":false}',
      EDGEBASE_INTERNAL_WORKER_URL: 'https://sink.example.test',
      EDGEBASE_SMS_API_URL: 'https://sink.example.test/sms',
      NODE_ENV: 'test',
    };

    expect(collectReleaseRuntimeIntegrityViolations(bindings, false)).toEqual([
      'EDGEBASE_CONFIG',
      'EDGEBASE_TEST',
      'EDGEBASE_TEST_BUILD',
      'EDGEBASE_DEV_SIDECAR_PORT',
      'EDGEBASE_INTERNAL_WORKER_URL',
      'EDGEBASE_SMS_API_URL',
      'EDGEBASE_USE_TEST_CONFIG',
      'NODE_ENV',
    ]);
    expect(collectReleaseRuntimeIntegrityViolations(bindings, true)).toEqual([]);
    expect(collectReleaseRuntimeIntegrityViolations(
      { EDGEBASE_RUNTIME_MODE: 'untrusted' },
      true,
    )).toEqual(['EDGEBASE_RUNTIME_MODE']);
  });

  it('allows only the loopback sidecar binding for the compile-time trusted local-dev build', () => {
    expect(isTrustedEdgeBaseLocalDevBuild()).toBe(false);
    const localSidecar = {
      EDGEBASE_RUNTIME_MODE: 'local-development',
      EDGEBASE_DEV_SIDECAR_PORT: '8788',
    };

    expect(collectReleaseRuntimeIntegrityViolations(localSidecar, false, false))
      .toEqual(['EDGEBASE_DEV_SIDECAR_PORT']);
    expect(collectReleaseRuntimeIntegrityViolations(localSidecar, false, true))
      .toEqual([]);
    expect(collectReleaseRuntimeIntegrityViolations({
      ...localSidecar,
      EDGEBASE_EMAIL_API_URL: 'https://sink.example.test',
    }, false, true)).toEqual(['EDGEBASE_EMAIL_API_URL']);
    expect(collectReleaseRuntimeIntegrityViolations({
      EDGEBASE_RUNTIME_MODE: 'cloudflare',
      EDGEBASE_DEV_SIDECAR_PORT: '8788',
    }, false, true)).toEqual(['EDGEBASE_DEV_SIDECAR_PORT']);
    expect(collectReleaseRuntimeIntegrityViolations({
      ...localSidecar,
      EDGEBASE_LOCAL_DEV_BUILD: 'true',
    }, false, true)).toEqual(['EDGEBASE_LOCAL_DEV_BUILD']);
  });

  it('keeps a generated release config authoritative and rejects process-env overrides', async () => {
    const generated = {
      release: true,
      databases: { shared: { tables: { generated: {} } } },
    };

    await expect(resolveStartupConfig(
      generated,
      async () => ({ default: { release: false } }),
      { EDGEBASE_CONFIG: JSON.stringify({ release: false }) },
      { preferTestConfig: true },
    )).rejects.toThrow(/Release config integrity violation.*EDGEBASE_CONFIG/i);

    await expect(resolveStartupConfig(
      generated,
      async () => ({ default: { release: false } }),
      { EDGEBASE_TEST: '0' },
    )).rejects.toThrow(/Release config integrity violation.*EDGEBASE_TEST/i);

    await expect(resolveStartupConfig(
      generated,
      async () => ({ default: { release: false } }),
      { EDGEBASE_EMAIL_API_URL: 'https://sink.example.test' },
    )).rejects.toThrow(/Release config integrity violation.*EDGEBASE_EMAIL_API_URL/i);

    await expect(resolveStartupConfig(
      generated,
      async () => ({ default: { release: false } }),
      { EDGEBASE_USE_TEST_CONFIG: '1' },
      { preferTestConfig: true },
    )).rejects.toThrow(/Release config integrity violation.*EDGEBASE_USE_TEST_CONFIG/i);

    await expect(resolveStartupConfig(
      generated,
      async () => ({ default: { release: false } }),
      { NODE_ENV: 'test' },
    )).rejects.toThrow(/Release config integrity violation.*NODE_ENV/i);

    await expect(resolveStartupConfig(
      generated,
      async () => ({ default: { release: false } }),
      { EDGEBASE_RUNTIME_MODE: 'cloudflare', NODE_ENV: 'production' },
    )).resolves.toMatchObject({ release: true });
  });

  it('prefers process env EDGEBASE_CONFIG over generated or test config', async () => {
    const resolved = await resolveStartupConfig(
      {
        databases: {
          shared: {
            tables: {
              generated: {},
            },
          },
        },
      },
      async () => ({
        default: {
          databases: {
            shared: {
              tables: {
                fromTest: {},
              },
            },
          },
        },
      }),
      {
        EDGEBASE_CONFIG: JSON.stringify({
          databases: {
            shared: {
              tables: {
                fromEnv: {},
              },
            },
          },
        }),
      },
    );

    expect(resolved).toEqual({
      databases: {
        shared: {
          tables: {
            fromEnv: {},
          },
        },
      },
    });
  });

  it('prefers generated config over test config when no process env config exists', async () => {
    const resolved = await resolveStartupConfig(
      {
        databases: {
          shared: {
            tables: {
              generated: {},
            },
          },
        },
      },
      async () => ({
        default: {
          databases: {
            shared: {
              tables: {
                fromTest: {},
              },
            },
          },
        },
      }),
      {},
    );

    expect(resolved).toEqual({
      databases: {
        shared: {
          tables: {
            generated: {},
          },
        },
      },
    });
  });

  it('prefers test config in vitest environments', async () => {
    const resolved = await resolveStartupConfig(
      {
        databases: {
          shared: {
            tables: {
              generated: {},
            },
          },
        },
      },
      async () => ({
        default: {
          databases: {
            shared: {
              tables: {
                fromTest: {},
              },
            },
          },
        },
      }),
      { VITEST: 'true' },
    );

    expect(resolved).toEqual({
      databases: {
        shared: {
          tables: {
            fromTest: {},
          },
        },
      },
    });
  });

  it('prefers test config when explicitly requested by the caller', async () => {
    const resolved = await resolveStartupConfig(
      {
        databases: {
          shared: {
            tables: {
              generated: {},
            },
          },
        },
      },
      async () => ({
        default: {
          databases: {
            shared: {
              tables: {
                fromTest: {},
              },
            },
          },
        },
      }),
      {},
      { preferTestConfig: true },
    );

    expect(resolved).toEqual({
      databases: {
        shared: {
          tables: {
            fromTest: {},
          },
        },
      },
    });
  });

  it('falls back to test config when generated config is empty', async () => {
    const resolved = await resolveStartupConfig(
      {},
      async () => ({
        default: {
          databases: {
            shared: {
              tables: {
                fromTest: {},
              },
            },
          },
        },
      }),
      {},
    );

    expect(resolved).toEqual({
      databases: {
        shared: {
          tables: {
            fromTest: {},
          },
        },
      },
    });
  });

  it('returns generated config when test config is unavailable', async () => {
    const resolved = await resolveStartupConfig(
      {
        databases: {
          shared: {
            tables: {
              generated: {},
            },
          },
        },
      },
      async () => {
        throw new Error('missing');
      },
      {},
    );

    expect(resolved).toEqual({
      databases: {
        shared: {
          tables: {
            generated: {},
          },
        },
      },
    });
  });

  it('parses process env config safely', () => {
    expect(parseProcessEnvConfig({
      EDGEBASE_CONFIG: '{"databases":{"shared":{"tables":{"posts":{}}}}}',
    })).toEqual({
      databases: {
        shared: {
          tables: {
            posts: {},
          },
        },
      },
    });
  });
});

describe('public captcha config resolution', () => {
  it('uses CAPTCHA_SITE_KEY when present', () => {
    expect(getCaptchaFromRuntime({ CAPTCHA_SITE_KEY: '0x12345' })).toEqual({
      siteKey: '0x12345',
    });
  });

  it('prefers CAPTCHA_SITE_KEY over bundled captcha config', () => {
    setConfig({ captcha: { siteKey: 'config-key' } } as EdgeBaseConfig);

    expect(getCaptchaFromRuntime({ CAPTCHA_SITE_KEY: 'env-key' })).toEqual({
      siteKey: 'env-key',
    });
  });

  it('falls back to bundled captcha config', () => {
    setConfig({ captcha: { siteKey: 'config-site-key' } } as EdgeBaseConfig);

    expect(getCaptchaFromRuntime({})).toEqual({
      siteKey: 'config-site-key',
    });
  });

  it('returns null when no captcha config exists', () => {
    setConfig({ auth: {} } as EdgeBaseConfig);

    expect(getCaptchaFromRuntime({})).toBeNull();
  });
});

describe('config materialization', () => {
  it('accepts empty config', () => {
    setConfig({} as EdgeBaseConfig);

    expect(parseConfig()).toEqual({});
  });

  it('preserves nested config structure', () => {
    const cfg: EdgeBaseConfig = {
      databases: {
        shared: {
          tables: {
            users: { schema: { name: { type: 'string' } } },
          },
        },
      },
      auth: { passwordPolicy: { minLength: 12 } },
    };

    setConfig(cfg);

    expect(parseConfig()).toBe(cfg);
  });
});

describe('config route cache headers', () => {
  it('uses public cache header', () => {
    const header = 'public, max-age=60, s-maxage=60';
    expect(header).toContain('public');
    expect(header).toContain('max-age=60');
  });

  it('uses CDN cache header', () => {
    const header = 'public, max-age=60';
    expect(header).toContain('public');
  });
});
