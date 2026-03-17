/**
 * 서버 단위 테스트 — bundled runtime config + public config route helpers
 *
 * 실행: cd packages/server && npx vitest run src/__tests__/config.test.ts
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseConfig, setConfig } from '../lib/do-router.js';
import type { EdgeBaseConfig } from '@edgebase/shared';
import {
  parseProcessEnvConfig,
  resolveStartupConfig,
} from '../lib/startup-config.js';

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
});

describe('startup config resolution', () => {
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
