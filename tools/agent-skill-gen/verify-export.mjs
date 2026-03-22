#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const config = JSON.parse(
  readFileSync(resolve(__dirname, 'config.json'), 'utf-8'),
);

function parseArgs(argv) {
  const options = {
    dir: resolve(ROOT, config.distributionDir),
    publicRepo: config.publicRepo,
  };

  for (const arg of argv) {
    if (arg.startsWith('--dir=')) {
      options.dir = resolve(ROOT, arg.slice('--dir='.length).trim());
      continue;
    }
    if (arg.startsWith('--public-repo=')) {
      options.publicRepo = arg.slice('--public-repo='.length).trim();
    }
  }

  return options;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

const { dir, publicRepo } = parseArgs(process.argv.slice(2));

const readmePath = resolve(dir, 'README.md');
const licensePath = resolve(dir, 'LICENSE');
const skillPath = resolve(dir, 'skills/edgebase/SKILL.md');
const openaiYamlPath = resolve(dir, 'skills/edgebase/agents/openai.yaml');
const referencesDir = resolve(dir, 'skills/edgebase/references/generated');

for (const requiredPath of [readmePath, licensePath, skillPath, openaiYamlPath, referencesDir]) {
  if (!existsSync(requiredPath)) {
    fail(`Export is missing required path: ${requiredPath}`);
  }
}

const readme = readFileSync(readmePath, 'utf-8');

if (!readme.includes('# EdgeBase Agent Skills')) {
  fail('Exported README.md is missing the EdgeBase Agent Skills heading.');
}

if (!readme.includes(publicRepo)) {
  fail(`Exported README.md must mention ${publicRepo}.`);
}

const generatedFiles = readdirSync(referencesDir).filter((name) => name.endsWith('.md'));
if (generatedFiles.length === 0) {
  fail('Exported skill bundle does not include any generated reference files.');
}

console.log(`Verified exported EdgeBase agent-skills bundle at ${dir}`);
