/**
 * OpenAPI spec stability tests.
 *
 * Verifies the /openapi.json endpoint returns a valid spec.
 * - Spec is valid OpenAPI 3.1.0
 * - Every path has an operationId
 * - Full operation list is tracked (addition/removal/rename detected)
 */
import { describe, it, expect } from 'vitest';

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
    expect(spec.paths?.['/api/room/media/realtime/session']?.post?.security).toEqual([
      { userBearerAuth: [] },
    ]);
    expect(spec.paths?.['/api/auth/passkeys/auth-options']?.post?.security).toBeUndefined();
    expect(spec.paths?.['/api/storage/{bucket}/upload']?.post?.requestBody?.content).toHaveProperty(
      'multipart/form-data',
    );
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
