/**
 * OpenAPI spec stability tests.
 *
 * Verifies the /openapi.json endpoint returns a valid spec.
 * - Spec is valid OpenAPI 3.1.0
 * - Every path has an operationId
 * - Full operation list is tracked (addition/removal/rename detected)
 */
import { describe, it, expect } from 'vitest';
import staticOpenApi from '../../openapi.json';

const BASE = 'http://localhost';
const SK = 'test-service-key-for-admin';

async function fetchSpec() {
  const res = await (globalThis as any).SELF.fetch(`${BASE}/openapi.json`, {
    headers: { 'X-EdgeBase-Service-Key': SK },
  });
  return res.json() as Promise<any>;
}

/** Extract sorted "METHOD /path" list from spec */
function extractOperations(spec: any): string[] {
  const ops: string[] = [];
  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    for (const method of Object.keys(methods as any)) {
      if (['get', 'post', 'put', 'delete', 'patch'].includes(method)) {
        ops.push(`${method.toUpperCase()} ${path}`);
      }
    }
  }
  return ops.sort();
}

describe('OpenAPI spec stability', () => {
  it('returns valid OpenAPI 3.1.0 spec', async () => {
    const spec = await fetchSpec();
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.info).toBeDefined();
    expect(spec.info.title).toBe('EdgeBase API');
    expect(spec.info.version).toBeDefined();
  });

  it('has paths object', async () => {
    const spec = await fetchSpec();
    expect(spec.paths).toBeDefined();
    expect(typeof spec.paths).toBe('object');
  });

  it('includes security schemes and request-scoped server metadata', async () => {
    const spec = await fetchSpec();

    expect(spec.servers).toEqual([
      {
        url: BASE,
        description: 'Current EdgeBase instance',
      },
    ]);

    expect(spec.components?.securitySchemes).toMatchObject({
      adminBearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
      userBearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
      serviceKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-EdgeBase-Service-Key',
      },
    });
  });

  it('marks auth requirements on representative operations', async () => {
    const spec = await fetchSpec();

    expect(spec.paths?.['/admin/api/data/users']?.get?.security).toEqual([
      { adminBearerAuth: [] },
      { serviceKeyAuth: [] },
    ]);
    expect(spec.paths?.['/api/auth/admin/users']?.get?.security).toEqual([
      { serviceKeyAuth: [] },
    ]);
    expect(spec.paths?.['/api/push/register']?.post?.security).toEqual([
      { userBearerAuth: [] },
    ]);
    expect(spec.paths?.['/api/auth/passkeys/auth-options']?.post?.security).toBeUndefined();
    expect(spec.paths?.['/api/storage/{bucket}/upload']?.post?.requestBody?.content).toHaveProperty(
      'multipart/form-data',
    );
    expect(spec.paths?.['/admin/api/setup']?.post?.responses).toHaveProperty('403');
  });

  it('documents the browser OAuth callback-binding inputs', async () => {
    const spec = await fetchSpec();
    const redirect = spec.paths?.['/api/auth/oauth/{provider}']?.get;
    const redirectQuery = Object.fromEntries(
      (redirect?.parameters ?? [])
        .filter((parameter: any) => parameter.in === 'query')
        .map((parameter: any) => [parameter.name, parameter]),
    );

    expect(Object.keys(redirectQuery).sort()).toEqual([
      'auth_transport',
      'captcha_token',
      'oauth_recovery_nonce',
      'redirectUrl',
      'redirect_url',
    ]);
    expect(redirectQuery.oauth_recovery_nonce?.schema).toMatchObject({
      type: 'string',
      pattern: '^[0-9a-f]{64}$',
    });

    const linkBody = spec.paths?.['/api/auth/oauth/link/{provider}']?.post?.requestBody;
    expect(linkBody?.required).toBe(false);
    expect(linkBody?.content?.['application/json']?.schema).toMatchObject({
      type: 'object',
      properties: {
        redirectUrl: { type: 'string' },
        state: { type: 'string', maxLength: 1024 },
        oauthRecoveryNonce: { type: 'string', pattern: '^[0-9a-f]{64}$' },
      },
    });
  });

  it('publishes completion, hosted captcha, combined signout, and phone-upgrade contracts', async () => {
    const spec = await fetchSpec();
    expect(spec.paths?.['/api/auth/oauth/exchange']?.post?.operationId).toBe('oauthExchange');
    expect(spec.paths?.['/api/auth/oauth/complete/link']?.post?.operationId).toBe('oauthLinkComplete');

    const captcha = spec.paths?.['/api/captcha/challenge']?.get;
    expect(captcha?.operationId).toBe('getCaptchaChallenge');
    expect(captcha?.responses?.['200']?.content).toHaveProperty('text/html');
    const bridge = (captcha?.parameters ?? []).find((parameter: any) => parameter.name === 'bridge');
    expect(bridge?.schema?.enum).toContain('uniwebview');

    expect(spec.paths?.['/api/auth/signout']?.post?.requestBody?.content?.['application/json']?.schema)
      .toMatchObject({
        properties: {
          pushDeviceId: {
            type: 'string',
            minLength: 1,
            maxLength: 128,
            pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$',
          },
        },
      });

    const phoneSchema = spec.paths?.['/api/auth/verify-link-phone']?.post
      ?.responses?.['200']?.content?.['application/json']?.schema;
    const branches = phoneSchema?.anyOf ?? phoneSchema?.oneOf;
    expect(branches).toHaveLength(2);
    expect(branches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        properties: { ok: { type: 'boolean', enum: [true] } },
        required: ['ok'],
      }),
      expect.objectContaining({
        properties: expect.objectContaining({
          user: expect.any(Object),
          accessToken: { type: 'string' },
          refreshToken: expect.objectContaining({ type: 'string' }),
          sessionId: { type: 'string' },
        }),
        required: expect.arrayContaining(['user', 'accessToken', 'sessionId']),
      }),
    ]));
  });

  it('keeps the checked-in SDK contract synchronized with runtime route semantics', async () => {
    const runtime = await fetchSpec();
    const paths = [
      '/api/auth/oauth/exchange',
      '/api/auth/oauth/complete/link',
      '/api/captcha/challenge',
      '/api/auth/signout',
      '/api/auth/verify-link-phone',
    ];
    for (const path of paths) {
      expect(
        (staticOpenApi.paths as Record<string, unknown>)[path],
        `${path} in packages/server/openapi.json drifted from the runtime route`,
      ).toEqual(runtime.paths?.[path]);
    }
  });

  it('every path has an operationId', async () => {
    const spec = await fetchSpec();
    const paths = spec.paths ?? {};
    for (const [path, methods] of Object.entries(paths)) {
      for (const [method, operation] of Object.entries(methods as any)) {
        if (['get', 'post', 'put', 'delete', 'patch'].includes(method)) {
          expect(
            (operation as any).operationId,
            `${method.toUpperCase()} ${path} missing operationId`,
          ).toBeDefined();
        }
      }
    }
  });

  /**
   * Full operation snapshot — catches additions, removals, AND renames.
   *
   * When you add/remove/rename an endpoint:
   * 1. Run tests → this will fail with a diff showing exactly what changed
   * 2. Verify the change is intentional
   * 3. Update the snapshot below
   *
   * This replaces the old path-count-only check which couldn't detect
   * swaps (add one + remove one = same count).
   */
  it('operation list matches snapshot', async () => {
    const spec = await fetchSpec();
    const ops = extractOperations(spec);

    // If this fails, the diff will show exactly which operations were added/removed.
    // Update this snapshot after verifying the change is intentional.
    expect(ops.length).toMatchSnapshot();
    expect(ops).toMatchSnapshot();
  });
});
