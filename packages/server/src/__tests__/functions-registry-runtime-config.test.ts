import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const registryPath = join(here, '..', '_functions-registry.ts');

describe('_functions-registry runtime config wiring', () => {
  it('registers plugin handlers from parseConfig() instead of the bundled config object', () => {
    const content = readFileSync(registryPath, 'utf-8');

    expect(content).toContain("import { parseConfig } from './lib/do-router.js'");
    expect(content).toContain('const keepBundled = [config, registerMiddleware, RoomsDO];');
    expect(content).toContain('const resolvedConfig = parseConfig();');
  });
});
