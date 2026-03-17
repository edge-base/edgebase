#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const config = JSON.parse(
  readFileSync(resolve(__dirname, 'config.json'), 'utf-8'),
);

const generatedPaths = new Set(['packages/server/test/integration/generated']);

for (const languageConfig of Object.values(config.languages ?? {})) {
  for (const outputPath of Object.values(languageConfig ?? {})) {
    if (typeof outputPath === 'string') {
      generatedPaths.add(outputPath);
    }
  }
}

for (const outputPath of Object.values(config.wrappers ?? {})) {
  if (typeof outputPath === 'string') {
    generatedPaths.add(outputPath);
  }
}

for (const outputPath of [...generatedPaths].sort()) {
  console.log(outputPath);
}
