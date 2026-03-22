#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const config = JSON.parse(
  readFileSync(resolve(__dirname, 'config.json'), 'utf-8'),
);

function parseArgs(argv) {
  const options = {
    outDir: resolve(ROOT, config.distributionDir),
    publicRepo: config.publicRepo,
  };

  for (const arg of argv) {
    if (arg.startsWith('--out-dir=')) {
      options.outDir = resolve(ROOT, arg.slice('--out-dir='.length).trim());
      continue;
    }
    if (arg.startsWith('--public-repo=')) {
      options.publicRepo = arg.slice('--public-repo='.length).trim();
    }
  }

  return options;
}

function writeRepoReadme(outputDir, publicRepo) {
  const contents = `# EdgeBase Agent Skills

Installable EdgeBase AI skill bundles generated from the main EdgeBase monorepo.

If you reached this repository from search, start with the official AI guide first:

- https://edgebase.fun/docs/getting-started/ai

## Contents

- \`skills/edgebase\` — the single public EdgeBase skill with generated SDK and CLI references

## Install

- Codex: copy \`skills/edgebase\` into \`$CODEX_HOME/skills/edgebase\`
- GitHub-backed skill installers: use the \`${publicRepo}\` repository and install the \`edgebase\` skill from \`skills/edgebase\`

## What This Skill Does

- detects EdgeBase tasks from natural language and repo context
- routes to the narrowest CLI or SDK reference by runtime and trust boundary
- helps agents avoid mixing browser/mobile client code with admin/server-only SDKs

## Source Of Truth

This distribution is generated from:

- \`skills/edgebase/SKILL.md\`
- \`skills/edgebase/agents/openai.yaml\`
- \`skills/edgebase/references/generated/*.md\`
- the leaf \`llms.txt\` files in the main EdgeBase repository

Do not edit the generated files in the published repo by hand. Update the source repo and resync instead.
`;

  writeFileSync(resolve(outputDir, 'README.md'), contents, 'utf-8');
}

function main() {
  const { outDir, publicRepo } = parseArgs(process.argv.slice(2));
  const skillSourceDir = resolve(ROOT, 'skills/edgebase');
  const skillOutDir = resolve(outDir, 'skills/edgebase');
  const licenseSource = resolve(ROOT, 'LICENSE');

  if (!existsSync(skillSourceDir)) {
    throw new Error('Missing skills/edgebase source directory.');
  }

  if (!existsSync(licenseSource)) {
    throw new Error('Missing root LICENSE file.');
  }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(resolve(outDir, 'skills'), { recursive: true });

  cpSync(skillSourceDir, skillOutDir, { recursive: true });
  cpSync(licenseSource, resolve(outDir, 'LICENSE'));
  writeRepoReadme(outDir, publicRepo);

  console.log(`Exported EdgeBase agent skills to ${relative(ROOT, outDir) || outDir}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
