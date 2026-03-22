#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const config = JSON.parse(
  readFileSync(resolve(__dirname, 'config.json'), 'utf-8'),
);

const SDK_ROOT = resolve(ROOT, 'packages/sdk');
const OUTPUT_DIR = resolve(ROOT, config.outputDir);

function posixPath(path) {
  return path.replaceAll('\\', '/');
}

function readDirs(path) {
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function collectSdkLeafReferences() {
  const refs = [];

  for (const family of readDirs(SDK_ROOT)) {
    const familyPath = join(SDK_ROOT, family);
    const familyRefs = [];

    const packagesPath = join(familyPath, 'packages');
    try {
      for (const pkg of readDirs(packagesPath)) {
        const sourcePath = join(packagesPath, pkg, 'llms.txt');
        if (existsSync(sourcePath)) {
          familyRefs.push({
            source: posixPath(relative(ROOT, sourcePath)),
            output: `${family}-${pkg}.md`,
          });
        }
      }
    } catch {
      // package-less SDK family
    }

    for (const moduleName of ['admin', 'client', 'core']) {
      const sourcePath = join(familyPath, moduleName, 'llms.txt');
      if (existsSync(sourcePath)) {
        familyRefs.push({
          source: posixPath(relative(ROOT, sourcePath)),
          output: `${family}-${moduleName}.md`,
        });
      }
    }

    if (familyRefs.length === 0) {
      const rootLlms = join(familyPath, 'llms.txt');
      if (existsSync(rootLlms)) {
        familyRefs.push({
          source: posixPath(relative(ROOT, rootLlms)),
          output: `${family}.md`,
        });
      }
    }

    refs.push(...familyRefs);
  }

  return refs.sort((a, b) => a.output.localeCompare(b.output));
}

function collectAllReferences() {
  const refs = [
    ...(config.extraReferences ?? []),
    ...collectSdkLeafReferences(),
  ];

  const outputs = new Set();
  for (const ref of refs) {
    if (outputs.has(ref.output)) {
      throw new Error(`Duplicate generated skill output: ${ref.output}`);
    }
    outputs.add(ref.output);
  }

  return refs;
}

function writeGeneratedReference(ref) {
  const sourcePath = resolve(ROOT, ref.source);
  const outputPath = resolve(OUTPUT_DIR, ref.output);
  const sourceBody = readFileSync(sourcePath, 'utf-8').trimEnd();
  const header =
    `<!-- Generated from ${ref.source}. Do not edit directly; update the source llms.txt and rerun \`node tools/agent-skill-gen/generate.mjs\`. -->\n\n`;
  writeFileSync(outputPath, `${header}${sourceBody}\n`, 'utf-8');
}

mkdirSync(OUTPUT_DIR, { recursive: true });

const refs = collectAllReferences();
const nextOutputs = new Set(refs.map((ref) => ref.output));

for (const entry of readdirSync(OUTPUT_DIR, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  if (!entry.name.endsWith('.md')) continue;
  if (!nextOutputs.has(entry.name)) {
    rmSync(join(OUTPUT_DIR, entry.name));
  }
}

for (const ref of refs) {
  writeGeneratedReference(ref);
}
