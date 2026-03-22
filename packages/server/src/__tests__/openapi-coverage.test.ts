/**
 * OpenAPI route coverage — static source scan.
 *
 * Ensures every route registration in src/routes/ uses .openapi() instead of
 * plain .get()/.post() etc.  Non-openapi routes won't appear in /openapi.json,
 * creating a silent gap between the spec and actual server behavior.
 *
 * Intentionally excluded routes (WebSocket upgrades, wildcard proxies, etc.)
 * must be listed in ALLOWED_NON_OPENAPI so the exclusion is explicit and
 * reviewed.  Adding a new non-openapi route without updating the allowlist
 * will fail CI.
 */
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';
import { normalizeOpenApiDocument, type OpenApiSpec } from '../lib/openapi.js';

const ROUTES_DIR = resolve(fileURLToPath(new URL('../routes', import.meta.url)));

// ─── Intentionally non-OpenAPI route registrations ───────────────────────────
// Format: "filename.ts:<line-content-substring>"
// Each entry must include enough of the line to be unique.
// When you remove a non-openapi route, remove the entry here too.
const ALLOWED_NON_OPENAPI = new Set([
  // User-defined function HTTP trigger — wildcard .all(), cannot be expressed as a fixed OpenAPI path
  'functions.ts:functionsRoute.all(',
]);

// ─── Detect .get/.post/.put/.delete/.patch/.all route registrations ──────────
// Matches: varName.get('/path'  or  varName.post("/path"  etc.
// Excludes: c.get('auth'), formData.get('file'), etc. by requiring a path-like string (starts with /)
const ROUTE_REG_PATTERN = /\w+\.(get|post|put|delete|patch|all)\(\s*['"][/]/g;

// Exclude .openapi( calls — these are already in the spec
const OPENAPI_CALL_PATTERN = /\.openapi\s*\(/;

function extractNonOpenapiRoutes(source: string, filename: string) {
  const lines = source.split('\n');
  const violations: { file: string; line: number; text: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip lines that are openapi registrations
    if (OPENAPI_CALL_PATTERN.test(line)) continue;
    // Skip comments
    if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;

    if (ROUTE_REG_PATTERN.test(line)) {
      // Check if this is in the allowlist
      const isAllowed = [...ALLOWED_NON_OPENAPI].some(
        (entry) => {
          const [file, substr] = entry.split(':');
          return filename === file && line.includes(substr);
        },
      );
      if (!isAllowed) {
        violations.push({ file: filename, line: i + 1, text: line.trim() });
      }
    }
    // Reset regex lastIndex
    ROUTE_REG_PATTERN.lastIndex = 0;
  }

  return violations;
}

describe('OpenAPI route coverage', () => {
  const routeFiles = readdirSync(ROUTES_DIR).filter((f) => f.endsWith('.ts'));

  it('all route registrations use .openapi() or are in ALLOWED_NON_OPENAPI', () => {
    const allViolations: { file: string; line: number; text: string }[] = [];

    for (const file of routeFiles) {
      const source = readFileSync(resolve(ROUTES_DIR, file), 'utf-8');
      const violations = extractNonOpenapiRoutes(source, file);
      allViolations.push(...violations);
    }

    if (allViolations.length > 0) {
      const report = allViolations
        .map((v) => `  ${v.file}:${v.line} → ${v.text}`)
        .join('\n');
      expect.fail(
        `Found ${allViolations.length} route registration(s) not using .openapi().\n` +
        `These routes will NOT appear in /openapi.json.\n` +
        `Either convert to createRoute() + .openapi(), or add to ALLOWED_NON_OPENAPI.\n\n${report}`,
      );
    }
  });

  it('ALLOWED_NON_OPENAPI entries are still valid', () => {
    // Ensure every entry in the allowlist still matches a real line in the source.
    // Stale entries must be removed.
    for (const entry of ALLOWED_NON_OPENAPI) {
      const [file, substr] = entry.split(':');
      const filePath = resolve(ROUTES_DIR, file);
      let source: string;
      try {
        source = readFileSync(filePath, 'utf-8');
      } catch {
        expect.fail(
          `ALLOWED_NON_OPENAPI contains '${entry}' but file '${file}' does not exist. Remove it.`,
        );
        return;
      }
      expect(
        source.includes(substr),
        `ALLOWED_NON_OPENAPI contains '${entry}' but '${substr}' is no longer found in ${file}. Remove it.`,
      ).toBe(true);
    }
  });

  it('normalizes security schemes and path-level auth requirements', () => {
    const spec: OpenApiSpec = {
      paths: {
        '/api/auth/me': { get: {} },
        '/api/sql': { post: {} },
        '/admin/api/setup': { get: {} },
        '/admin/api/data/users': { get: {} },
        '/api/room/media/realtime/session': { post: {} },
        '/api/room/media/cloudflare_realtimekit/session': { post: {} },
      },
    };

    const normalized = normalizeOpenApiDocument(spec, 'https://edgebase.example');
    const schemes = normalized.components?.securitySchemes ?? {};

    expect(normalized.servers).toEqual([
      { url: 'https://edgebase.example', description: 'Current EdgeBase instance' },
    ]);
    expect(schemes).toHaveProperty('adminBearerAuth');
    expect(schemes).toHaveProperty('userBearerAuth');
    expect(schemes).toHaveProperty('serviceKeyAuth');
    expect((normalized.paths?.['/api/auth/me'] as Record<string, { security?: unknown }>).get.security)
      .toEqual([{ userBearerAuth: [] }]);
    expect((normalized.paths?.['/api/room/media/realtime/session'] as Record<string, { security?: unknown }>).post.security)
      .toEqual([{ userBearerAuth: [] }]);
    expect((normalized.paths?.['/api/room/media/cloudflare_realtimekit/session'] as Record<string, { security?: unknown }>).post.security)
      .toEqual([{ userBearerAuth: [] }]);
    expect((normalized.paths?.['/api/sql'] as Record<string, { security?: unknown }>).post.security)
      .toEqual([{ serviceKeyAuth: [] }]);
    expect((normalized.paths?.['/admin/api/setup'] as Record<string, { security?: unknown }>).get.security)
      .toBeUndefined();
    expect((normalized.paths?.['/admin/api/data/users'] as Record<string, { security?: unknown }>).get.security)
      .toEqual([{ adminBearerAuth: [] }, { serviceKeyAuth: [] }]);
  });
});
