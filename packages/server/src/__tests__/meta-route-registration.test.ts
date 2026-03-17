/**
 * Meta-test: route registration completeness.
 *
 * Ensures every route file imported in index.ts is also registered via app.route().
 * The expected route exports are derived from the current route files.
 */
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';

describe('index.ts route registration completeness', () => {
  const source = readFileSync(
    new URL('../index.ts', import.meta.url),
    'utf-8',
  );
  const routesDir = resolve(new URL('../routes', import.meta.url).pathname);
  const EXPECTED_ROUTES = readdirSync(routesDir)
    .filter((fileName) => fileName.endsWith('.ts'))
    .sort()
    .flatMap((fileName) => {
      const routeSource = readFileSync(resolve(routesDir, fileName), 'utf-8');
      const directExports = [...routeSource.matchAll(/export const (\w+)\s*=\s*new OpenAPIHono/g)].map(
        (match) => match[1],
      );
      const aliasExports = [...routeSource.matchAll(/export \{ \w+ as (\w+) \}/g)].map(
        (match) => match[1],
      );
      return [...directExports, ...aliasExports];
    });

  const EXPECTED_COUNT = EXPECTED_ROUTES.length;

  it(`total route imports = ${EXPECTED_COUNT}`, () => {
    const importMatches = source.match(/import \{ \w+ \} from '\.\/routes\//g) || [];
    expect(importMatches.length).toBe(EXPECTED_COUNT);
  });

  for (const routeVar of EXPECTED_ROUTES) {
    it(`${routeVar} is imported`, () => {
      expect(source).toMatch(new RegExp(`import\\s*\\{[^}]*\\b${routeVar}\\b[^}]*\\}\\s*from '\\./routes/`));
    });

    it(`${routeVar} is registered via app.route()`, () => {
      expect(source).toMatch(new RegExp(`app\\.route\\([^)]+,\\s*${routeVar}\\)`));
    });
  }
});
