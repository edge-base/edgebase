/**
 * Meta-test: route registration completeness.
 *
 * Ensures every route module imported in index.ts is also registered via app.route().
 * The expected route exports are derived from the route modules the entrypoint actually loads.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { describe, it, expect } from 'vitest';

describe('index.ts route registration completeness', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../index.ts', import.meta.url)),
    'utf-8',
  );
  const routesDir = resolve(fileURLToPath(new URL('../routes', import.meta.url)));
  const ROUTE_IMPORTS = [...source.matchAll(/import\('\.\/routes\/([^']+\.js)'\)/g)]
    .map((match) => match[1])
    .sort();
  const ROUTE_FILES = ROUTE_IMPORTS.map((fileName) => fileName.replace(/\.js$/, '.ts'));
  const EXPECTED_ROUTES = ROUTE_FILES
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

  it(`total route module imports = ${ROUTE_FILES.length}`, () => {
    expect(ROUTE_IMPORTS.length).toBe(ROUTE_FILES.length);
  });

  for (const routeFile of ROUTE_FILES) {
    const routePath = routeFile.replace(/\.ts$/, '.js');

    it(`${routeFile} is dynamically imported`, () => {
      expect(source).toContain(`import('./routes/${routePath}')`);
    });
  }

  for (const routeVar of EXPECTED_ROUTES) {
    it(`${routeVar} is registered via app.route()`, () => {
      const directRegistration = new RegExp(`app\\.route\\([^)]+,\\s*${routeVar}\\)`);
      const moduleRegistration = new RegExp(`app\\.route\\([^)]+,\\s*\\w+\\.${routeVar}\\)`);
      expect(directRegistration.test(source) || moduleRegistration.test(source)).toBe(true);
    });
  }
});
