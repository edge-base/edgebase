import { describe, it, expect } from 'vitest';
import {
  defineConfig,
  defineFunction,
  EdgeBaseError,
  createErrorResponse,
  materializeConfig,
  getRoomActionHandlers,
  getRoomHooks,
  getRoomStateConfig,
} from '../src/index.js';

describe('defineConfig', () => {
  it('should return the config object — databases block (#133 §1)', () => {
    const config = defineConfig({
      databases: {
        shared: {
          tables: {
            posts: {
              schema: {
                title: { type: 'string', required: true },
              },
              access: {
                read: (auth) => true,
                insert: (auth) => auth !== null,
              },
            },
          },
        },
      },
    });

    expect(config.databases?.shared?.tables?.posts).toBeDefined();
    expect(config.databases?.shared?.tables?.posts).toHaveProperty('schema');
    expect(config.databases?.shared?.tables?.posts).toHaveProperty('access');
  });

  it('should accept a complete config with all sections', () => {
    const config = defineConfig({
      databases: {
        shared: {
          tables: {
            posts: {
              schema: {
                title: { type: 'string', required: true },
                content: { type: 'text' },
                authorId: { type: 'string' },
              },
              access: {
                read: (_auth, _row) => true,
                insert: (auth) => auth !== null,
                update: (auth, row) => auth?.id === row['authorId'],
                delete: (auth, row) => auth?.id === row['authorId'],
              },
              indexes: [{ fields: ['authorId'] }],
              fts: ['title', 'content'],
            },
          },
        },
        workspace: {
          access: {
            canCreate: (auth, id) => auth !== null,
            access: (auth, id) => auth !== null,
          },
          tables: {
            docs: {
              schema: { title: { type: 'string', required: true } },
            },
          },
        },
      },
      auth: {
        emailAuth: true,
        anonymousAuth: false,
        allowedOAuthProviders: ['google'],
        oauth: {
          google: {
            clientId: 'google-client-id',
            clientSecret: 'google-client-secret',
          },
        },
        session: { accessTokenTTL: '15m', refreshTokenTTL: '28d' },
      },
      storage: {
        buckets: {
          avatars: {
            access: {
              read: (_auth, _file) => true,
              write: (auth, _file) => auth !== null,
            },
          },
        },
      },
      cors: { origin: '*' },
      rateLimiting: {
        global: { requests: 1000, window: '1m' },
        auth: { requests: 10, window: '1m' },
      },
      databaseLive: { authTimeoutMs: 5000 },
      functions: { scheduleFunctionTimeout: '30s' },
      cloudflare: { extraCrons: ['15 * * * *'] },
    });

    expect(config.auth?.emailAuth).toBe(true);
    expect(config.auth?.allowedOAuthProviders).toEqual(['google']);
    expect((config.auth?.oauth?.google as { clientId: string } | undefined)?.clientId).toBe('google-client-id');
    expect(config.storage?.buckets?.avatars).toBeDefined();
    expect(config.cors?.origin).toBe('*');
    expect(config.rateLimiting?.global?.requests).toBe(1000);
    expect(config.databaseLive?.authTimeoutMs).toBe(5000);
    expect(config.functions?.scheduleFunctionTimeout).toBe('30s');
    expect(config.cloudflare?.extraCrons).toEqual(['15 * * * *']);
  });

  it('should accept admin instance discovery on dynamic namespaces', () => {
    const config = defineConfig({
      databases: {
        shared: {
          tables: {
            workspaces: {
              schema: {
                name: { type: 'string', required: true },
              },
            },
          },
        },
        workspace: {
          instance: true,
          admin: {
            instances: {
              source: 'table',
              targetLabel: 'Workspace',
              namespace: 'shared',
              table: 'workspaces',
              idField: 'id',
              labelField: 'name',
              helperText: 'Pick a workspace to inspect.',
            },
          },
          tables: {
            docs: {
              schema: {
                title: { type: 'string', required: true },
              },
            },
          },
        },
      },
    });

    expect(config.databases?.workspace?.admin?.instances).toMatchObject({
      source: 'table',
      targetLabel: 'Workspace',
      namespace: 'shared',
      table: 'workspaces',
      labelField: 'name',
    });
  });

  it('should reject admin instance discovery on static namespaces', () => {
    expect(() =>
      defineConfig({
        databases: {
          shared: {
            admin: {
              instances: {
                source: 'manual',
              },
            },
            tables: {
              posts: {
                schema: {
                  title: { type: 'string', required: true },
                },
              },
            },
          },
        },
      }),
    ).toThrow(/admin\.instances is only supported on dynamic namespaces/);
  });

  it('should reject non-string admin instance target labels', () => {
    expect(() =>
      defineConfig({
        databases: {
          workspace: {
            instance: true,
            admin: {
              instances: {
                source: 'manual',
                targetLabel: 123 as never,
              },
            },
            tables: {
              docs: {
                schema: {
                  title: { type: 'string', required: true },
                },
              },
            },
          },
        },
      }),
    ).toThrow(/admin\.instances\.targetLabel must be a string/);
  });

  it('should reject non-string cloudflare.extraCrons entries', () => {
    expect(() =>
      defineConfig({
        cloudflare: {
          extraCrons: ['0 * * * *', '' as string],
        },
      }),
    ).toThrow(/cloudflare\.extraCrons\[1\]/);
  });

  it('should accept empty config', () => {
    const config = defineConfig({});
    expect(config).toEqual({});
  });

  it('should accept trustSelfHostedProxy when enabled', () => {
    const config = defineConfig({ trustSelfHostedProxy: true });
    expect(config.trustSelfHostedProxy).toBe(true);
  });

  it('should accept frontend config for a built static bundle', () => {
    const config = defineConfig({
      frontend: {
        directory: './web/dist',
        mountPath: '/app',
        spaFallback: true,
      },
    });

    expect(config.frontend).toEqual({
      directory: './web/dist',
      mountPath: '/app',
      spaFallback: true,
    });
  });

  it('should reject non-boolean trustSelfHostedProxy values', () => {
    expect(() => defineConfig({ trustSelfHostedProxy: 'yes' as never })).toThrow(/trustSelfHostedProxy must be a boolean/);
  });

  it('should reject empty frontend.directory values', () => {
    expect(() => defineConfig({
      frontend: {
        directory: '   ',
      },
    })).toThrow(/frontend\.directory must be a non-empty string/);
  });

  it('should reject frontend.mountPath values without a leading slash', () => {
    expect(() => defineConfig({
      frontend: {
        directory: './web/dist',
        mountPath: 'app',
      },
    })).toThrow(/frontend\.mountPath must start with "\/"/);
  });

  it('should reject non-boolean frontend.spaFallback values', () => {
    expect(() => defineConfig({
      frontend: {
        directory: './web/dist',
        spaFallback: 'yes' as never,
      },
    })).toThrow(/frontend\.spaFallback must be a boolean/);
  });

  it('should reject removed rules aliases', () => {
    expect(() =>
      defineConfig({
        databases: {
          shared: {
            rules: {
              access: () => true,
            },
          } as any,
        },
      }),
    ).toThrow(
      /Legacy config syntax is no longer supported at databases\.shared\.rules\. Use databases\.shared\.access instead\./,
    );

    expect(() =>
      defineConfig({
        databases: {
          shared: {
            tables: {
              posts: {
                access: {
                  read: () => true,
                },
                rules: {
                  read: () => true,
                },
              } as any,
            },
          },
        },
      }),
    ).toThrow(
      /Legacy config syntax is no longer supported at databases\.shared\.tables\.posts\.rules\. Use databases\.shared\.tables\.posts\.access instead\./,
    );

    expect(() =>
      defineConfig({
        storage: {
          buckets: {
            avatars: {
              rules: {
                read: () => true,
              },
            } as any,
          },
        },
      }),
    ).toThrow(
      /Legacy config syntax is no longer supported at storage\.buckets\.avatars\.rules\. Use storage\.buckets\.avatars\.access instead\./,
    );
  });

  it('should reject removed room handler aliases', () => {
    expect(() =>
      defineConfig({
        rooms: {
          game: {
            onCreate: () => {},
          } as any,
        },
      }),
    ).toThrow(
      /Legacy config syntax is no longer supported at rooms\.game\.onCreate\. Move it to rooms\.game\.handlers\.lifecycle\.onCreate\./,
    );
  });

  it('should accept canonical room state/hooks config', () => {
    const action = () => 'ok';
    const onJoin = () => {};
    const beforeSend = () => {};

    const config = defineConfig({
      rooms: {
        workspace: {
          access: {
            join: (auth) => auth !== null,
            signal: (auth, _roomId, event) => auth !== null && event.length > 0,
            admin: (auth) => auth?.role === 'admin',
          },
          state: {
            actions: {
              RENAME: action,
            },
          },
          hooks: {
            lifecycle: {
              onJoin,
            },
            signals: {
              beforeSend,
            },
          },
        },
      },
    });

    expect(getRoomStateConfig(config.rooms?.workspace)?.actions?.RENAME).toBe(action);
    expect(getRoomActionHandlers(config.rooms?.workspace)?.RENAME).toBe(action);
    expect(getRoomHooks(config.rooms?.workspace)?.lifecycle?.onJoin).toBe(onJoin);
    expect(config.rooms?.workspace?.hooks?.signals?.beforeSend).toBe(beforeSend);
  });

  it('should normalize legacy room handlers into canonical room state/hooks', () => {
    const action = () => 'ok';
    const onCreate = () => {};

    const config = defineConfig({
      rooms: {
        game: {
          handlers: {
            actions: {
              START: action,
            },
            lifecycle: {
              onCreate,
            },
          },
        },
      },
    });

    expect(config.rooms?.game?.state?.actions?.START).toBe(action);
    expect(config.rooms?.game?.hooks?.lifecycle?.onCreate).toBe(onCreate);
    expect(getRoomActionHandlers(config.rooms?.game)?.START).toBe(action);
    expect(getRoomHooks(config.rooms?.game)?.lifecycle?.onCreate).toBe(onCreate);
  });

  it('should allow room handler normalization to be materialized more than once', () => {
    const action = () => 'ok';
    const config = defineConfig({
      rooms: {
        game: {
          handlers: {
            actions: {
              START: action,
            },
          },
        },
      },
    });

    expect(() => materializeConfig(config)).not.toThrow();
    expect(config.rooms?.game?.state?.actions?.START).toBe(action);
    expect(config.rooms?.game?.handlers?.actions?.START).toBe(action);
  });

  it('should reject conflicting canonical and legacy room config for the same behavior', () => {
    expect(() =>
      defineConfig({
        rooms: {
          game: {
            state: {
              actions: {
                START: () => 'state',
              },
            },
            handlers: {
              actions: {
                START: () => 'legacy',
              },
            },
          },
        },
      }),
    ).toThrow(
      /rooms\.game cannot define both handlers\.actions and state\.actions\. Use the canonical state\.actions shape only once\./,
    );
  });

  it('should reject removed functions.hookTimeout alias', () => {
    expect(() =>
      defineConfig({
        functions: {
          hookTimeout: '5s',
        } as any,
      }),
    ).toThrow(
      /Legacy config syntax is no longer supported at functions\.hookTimeout\. Blocking auth\/storage hook timeouts are fixed internally\./,
    );
  });

  it('should reject removed schema aliases and missing migration descriptions', () => {
    expect(() =>
      defineConfig({
        databases: {
          shared: {
            tables: {
              posts: {
                schema: {
                  authorId: { type: 'string', ref: 'users' },
                },
              },
            },
          },
        },
      }),
    ).toThrow(
      /Legacy config syntax is no longer supported at databases\.shared\.tables\.posts\.schema\.authorId\.ref\. Use references instead\./,
    );

    expect(() =>
      defineConfig({
        databases: {
          shared: {
            tables: {
              posts: {
                schema: {
                  authorId: { type: 'string', references: 'users' },
                },
                migrations: [{ version: 2, description: '', up: 'ALTER TABLE posts ADD COLUMN authorId TEXT;' }],
              },
            },
          },
        },
      }),
    ).toThrow(
      /databases\.shared\.tables\.posts\.migrations\[0\]\.description is required\. Add a short summary such as "Add slug column"\./,
    );
  });

  it('should reject removed auth and storage legacy fields', () => {
    expect(() =>
      defineConfig({
        auth: {
          shardCount: 2,
        } as any,
      }),
    ).toThrow(
      /Legacy config syntax is no longer supported at auth\.shardCount\. Auth shards are fixed internally now, so remove shardCount from the config\./,
    );

    expect(() =>
      defineConfig({
        storage: {
          buckets: {
            avatars: {
              maxFileSize: '5MB',
              access: {
                write: () => true,
              },
            } as any,
          },
        },
      }),
    ).toThrow(
      /Legacy config syntax is no longer supported at storage\.buckets\.avatars\.maxFileSize\. Validate file\.size inside storage\.buckets\.avatars\.access\.write instead\./,
    );
  });

  it('should accept table without schema (schemaless CRUD)', () => {
    const config = defineConfig({
      databases: {
        shared: {
          tables: {
            posts: {},
          },
        },
      },
    });
    expect(config.databases?.shared?.tables?.posts).toBeDefined();
  });

  it('should accept static shared DB (no id) and dynamic user DB', () => {
    const config = defineConfig({
      databases: {
        shared: {
          tables: { posts: { schema: { title: { type: 'string' } } } },
        },
        user: {
          access: {
            access: (auth, id) => auth?.id === id,
          },
          tables: {
            profile: { schema: { bio: { type: 'text' } } },
          },
        },
      },
    });

    expect(config.databases?.shared).toBeDefined();
    expect(config.databases?.user?.access?.access).toBeTypeOf('function');
    expect(config.databases?.user?.tables?.profile).toBeDefined();
  });

  it('should throw on invalid field type value', () => {
    expect(() =>
      defineConfig({
        databases: {
          shared: {
            tables: {
              posts: { schema: { title: { type: 'blah' as any } } },
            },
          },
        },
      }),
    ).toThrow("invalid type 'blah'");
  });

  // ─── Auto-field type override blocking ───

  it('should throw when auto-field id is type-overridden', () => {
    expect(() =>
      defineConfig({
        databases: {
          shared: {
            tables: {
              posts: { schema: { id: { type: 'number', primaryKey: true } as any } },
            },
          },
        },
      }),
    ).toThrow("auto-field 'id' cannot be type-overridden");
  });

  it('should throw when auto-field createdAt is type-overridden', () => {
    expect(() =>
      defineConfig({
        databases: {
          shared: {
            tables: {
              posts: { schema: { createdAt: { type: 'string' } as any } },
            },
          },
        },
      }),
    ).toThrow("auto-field 'createdAt' cannot be type-overridden");
  });

  it('should throw when auto-field updatedAt is type-overridden', () => {
    expect(() =>
      defineConfig({
        databases: {
          shared: {
            tables: {
              posts: { schema: { updatedAt: { type: 'number' } as any } },
            },
          },
        },
      }),
    ).toThrow("auto-field 'updatedAt' cannot be type-overridden");
  });

  it('should allow auto-field set to false (disable)', () => {
    const config = defineConfig({
      databases: {
        shared: {
          tables: {
            logs: { schema: { updatedAt: false, message: { type: 'text' } } },
          },
        },
      },
    });
    expect(config.databases?.shared?.tables?.logs).toBeDefined();
  });

  it('should allow all auto-fields disabled with false', () => {
    const config = defineConfig({
      databases: {
        shared: {
          tables: {
            raw: {
              schema: { id: false, createdAt: false, updatedAt: false, data: { type: 'json' } },
            },
          },
        },
      },
    });
    expect(config.databases?.shared?.tables?.raw).toBeDefined();
  });

  it('should allow schema without mentioning auto-fields at all', () => {
    const config = defineConfig({
      databases: {
        shared: {
          tables: {
            posts: { schema: { title: { type: 'string' } } },
          },
        },
      },
    });
    expect(config.databases?.shared?.tables?.posts?.schema?.title).toEqual({ type: 'string' });
  });

  it('should preserve access and handlers across runtime config surfaces', () => {
    const config = defineConfig({
      databases: {
        shared: {
          access: {
            access: (auth) => auth !== null,
          },
          tables: {
            posts: {
              access: {
                read: () => true,
              },
              handlers: {
                hooks: {
                  onEnrich: (_auth, record) => record,
                },
              },
            },
          },
        },
      },
      storage: {
        buckets: {
          uploads: {
            access: {
              write: (auth) => auth !== null,
            },
            handlers: {
              hooks: {
                beforeUpload: () => ({ owner: 'user-1' }),
              },
            },
          },
        },
      },
      push: {
        access: {
          send: (auth) => auth !== null,
        },
        handlers: {
          hooks: {
            beforeSend: (_auth, input) => input,
          },
        },
      },
      auth: {
        access: {
          linkPhone: (input, ctx) => !!ctx.auth && !!input?.phone,
          changePassword: (_input, ctx) => !!ctx.auth,
          passkeysAuthenticate: (input) => typeof input?.credentialId === 'string',
          oauthRedirect: (input) => typeof input?.provider === 'string',
          oauthLinkCallback: (input) => typeof input?.linkUserId === 'string',
        },
        handlers: {
          hooks: {
            enrich: async () => ({ tenantRole: 'admin' }),
          },
          email: {
            onSend: () => undefined,
          },
          sms: {
            onSend: () => undefined,
          },
        },
      },
      rooms: {
        game: {
          handlers: {
            lifecycle: {
              onJoin: () => {},
            },
            actions: {
              MOVE: () => ({ ok: true }),
            },
            timers: {
              tick: () => {},
            },
          },
        },
      },
    });

    expect(config.databases?.shared?.access?.access).toBeTypeOf('function');
    expect(config.databases?.shared?.tables?.posts?.access?.read).toBeTypeOf('function');
    expect(config.databases?.shared?.tables?.posts?.handlers?.hooks?.onEnrich).toBeTypeOf(
      'function',
    );
    expect(config.storage?.buckets?.uploads?.access?.write).toBeTypeOf('function');
    expect(config.storage?.buckets?.uploads?.handlers?.hooks?.beforeUpload).toBeTypeOf('function');
    expect(config.push?.access?.send).toBeTypeOf('function');
    expect(config.push?.handlers?.hooks?.beforeSend).toBeTypeOf('function');
    expect(config.auth?.access?.linkPhone).toBeTypeOf('function');
    expect(config.auth?.access?.changePassword).toBeTypeOf('function');
    expect(config.auth?.access?.passkeysAuthenticate).toBeTypeOf('function');
    expect(config.auth?.access?.oauthRedirect).toBeTypeOf('function');
    expect(config.auth?.access?.oauthLinkCallback).toBeTypeOf('function');
    expect(config.auth?.handlers?.hooks?.enrich).toBeTypeOf('function');
    expect(config.auth?.handlers?.email?.onSend).toBeTypeOf('function');
    expect(config.auth?.handlers?.sms?.onSend).toBeTypeOf('function');
    expect(config.rooms?.game?.handlers?.lifecycle?.onJoin).toBeTypeOf('function');
    expect(config.rooms?.game?.handlers?.actions?.MOVE).toBeTypeOf('function');
    expect(config.rooms?.game?.handlers?.timers?.tick).toBeTypeOf('function');
  });

  it('should merge plugin tables into databases and preserve plugin table config', () => {
    const config = defineConfig({
      plugins: [
        {
          name: 'plugin-a',
          pluginApiVersion: 1,
          manifest: {
            description: 'Example plugin',
            configTemplate: {
              apiKey: 'CHANGE_ME',
            },
          },
          config: {},
          tables: {
            events: {
              access: {
                read: () => true,
              },
              handlers: {
                hooks: {
                  onEnrich: (_auth, record) => record,
                },
              },
            },
          },
        },
      ],
    });

    expect(config.databases?.shared?.tables?.['plugin-a/events']).toBeDefined();
    expect(config.databases?.shared?.tables?.['plugin-a/events']?.access?.read).toBeTypeOf(
      'function',
    );
    expect(
      config.databases?.shared?.tables?.['plugin-a/events']?.handlers?.hooks?.onEnrich,
    ).toBeTypeOf('function');
    expect(config.plugins?.[0]?.manifest?.description).toBe('Example plugin');
    expect(config.plugins?.[0]?.manifest?.configTemplate).toEqual({ apiKey: 'CHANGE_ME' });
  });

  it('should reject plugins built against a different plugin API version', () => {
    expect(() =>
      defineConfig({
        plugins: [
          {
            name: 'plugin-a',
            pluginApiVersion: 999,
            config: {},
          },
        ],
      }),
    ).toThrow(/targets pluginApiVersion '999'/);
  });

  it('should reject service key kids that contain underscores', () => {
    expect(() =>
      defineConfig({
        serviceKeys: {
          keys: [
            {
              kid: 'backend_api',
              tier: 'root',
              scopes: ['*'],
              secretSource: 'dashboard',
              secretRef: 'SERVICE_KEY_BACKEND',
            },
          ],
        },
      }),
    ).toThrow(/Underscore is reserved/);
  });

  it('should reject duplicate service key kids', () => {
    expect(() =>
      defineConfig({
        serviceKeys: {
          keys: [
            {
              kid: 'backend',
              tier: 'root',
              scopes: ['*'],
              secretSource: 'dashboard',
              secretRef: 'SERVICE_KEY_BACKEND',
            },
            {
              kid: 'backend',
              tier: 'scoped',
              scopes: ['db:table:posts:read'],
              secretSource: 'dashboard',
              secretRef: 'SERVICE_KEY_ANALYTICS',
            },
          ],
        },
      }),
    ).toThrow(/Duplicate Service Key kid 'backend'/);
  });

  it('should reject dashboard service keys without secretRef', () => {
    expect(() =>
      defineConfig({
        serviceKeys: {
          keys: [
            {
              kid: 'backend',
              tier: 'root',
              scopes: ['*'],
              secretSource: 'dashboard',
            },
          ],
        },
      }),
    ).toThrow(/requires a non-empty secretRef/);
  });

  it('should reject inline service keys without inlineSecret', () => {
    expect(() =>
      defineConfig({
        serviceKeys: {
          keys: [
            {
              kid: 'backend',
              tier: 'root',
              scopes: ['*'],
              secretSource: 'inline',
            },
          ],
        },
      }),
    ).toThrow(/requires a non-empty inlineSecret/);
  });
});

describe('defineFunction', () => {
  it('should accept DB trigger function (table field — #133 §21)', () => {
    const fn = defineFunction({
      trigger: { type: 'db', table: 'posts', event: 'create' },
      handler: async () => {},
    });

    expect(fn.trigger.type).toBe('db');
    expect((fn.trigger as any).table).toBe('posts');
  });

  it('should accept HTTP trigger function', () => {
    const fn = defineFunction({
      trigger: { type: 'http', method: 'POST', path: '/api/webhook/stripe' },
      handler: async () => {},
    });

    expect(fn.trigger.type).toBe('http');
  });

  it('should accept schedule trigger function', () => {
    const fn = defineFunction({
      trigger: { type: 'schedule', cron: '0 9 * * *' },
      handler: async () => {},
    });

    expect(fn.trigger.type).toBe('schedule');
  });

  it('should accept auth trigger function', () => {
    const fn = defineFunction({
      trigger: { type: 'auth', event: 'afterSignUp' },
      handler: async () => {},
    });

    expect(fn.trigger.type).toBe('auth');
  });
});

describe('EdgeBaseError', () => {
  it('should create error with code and message', () => {
    const err = new EdgeBaseError(400, 'Validation failed.');
    expect(err.code).toBe(400);
    expect(err.message).toBe('Validation failed.');
    expect(err.data).toBeUndefined();
  });

  it('should create error with field-level data', () => {
    const err = new EdgeBaseError(400, 'Validation failed.', {
      title: { code: 'required', message: 'Field is required.' },
      email: { code: 'invalid_format', message: 'Invalid email format.' },
    });

    expect(err.data?.title.code).toBe('required');
    expect(err.data?.email.code).toBe('invalid_format');
  });

  it('should serialize to JSON matching format', () => {
    const err = new EdgeBaseError(400, 'Validation failed.', {
      title: { code: 'required', message: 'Field is required.' },
    });

    const json = err.toJSON();
    expect(json).toEqual({
      code: 400,
      message: 'Validation failed.',
      data: {
        title: { code: 'required', message: 'Field is required.' },
      },
    });
  });

  it('should omit data field when not provided', () => {
    const err = new EdgeBaseError(404, 'Not found.');
    const json = err.toJSON();

    expect(json).toEqual({ code: 404, message: 'Not found.' });
    expect(json).not.toHaveProperty('data');
  });
});

describe('Config serialization pipeline', () => {
  it('defineConfig → JSON.stringify → JSON.parse preserves non-function fields', () => {
    const config = defineConfig({
      databases: {
        shared: {
          tables: {
            posts: {
              schema: {
                title: { type: 'string', required: true, min: 3, max: 200 },
                content: { type: 'text' },
                views: { type: 'number', default: 0 },
              },
              // Function-based rules are dropped by JSON.stringify (esbuild bundle is source-of-truth)
              fts: ['title', 'content'],
              indexes: [{ fields: ['views'] }],
            },
          },
        },
      },
      auth: { emailAuth: true, session: { accessTokenTTL: '15m' } },
    });

    // Simulates the statically bundled runtime config
    const serialized = JSON.stringify(config);
    const parsed = JSON.parse(serialized);

    expect(parsed.databases.shared.tables.posts.schema.title.type).toBe('string');
    expect(parsed.databases.shared.tables.posts.fts).toEqual(['title', 'content']);
    expect(parsed.auth.emailAuth).toBe(true);
  });

  it('config with function references → JSON.stringify drops functions silently', () => {
    const config = defineConfig({
      databases: {
        shared: {
          tables: {
            posts: {
              schema: { title: { type: 'string', required: true } },
            },
          },
        },
      },
    });

    // Simulate accidental function reference
    const configWithFn = { ...config, customHook: () => {} };
    const serialized = JSON.stringify(configWithFn);
    const parsed = JSON.parse(serialized);

    // Functions are silently dropped by JSON.stringify
    expect(parsed.customHook).toBeUndefined();
    // But the rest of the config survives
    expect(parsed.databases.shared.tables.posts.schema.title.type).toBe('string');
  });
});

describe('createErrorResponse', () => {
  it('should create error response object', () => {
    const response = createErrorResponse(500, 'Internal server error.');
    expect(response).toEqual({ code: 500, message: 'Internal server error.' });
  });

  it('should include data when provided', () => {
    const response = createErrorResponse(400, 'Bad request.', {
      name: { code: 'required', message: 'Name is required.' },
    });

    expect(response.data?.name.code).toBe('required');
  });
});
