#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const SKILL_PATH = resolve(ROOT, 'skills/edgebase/SKILL.md');
const OPENAI_YAML_PATH = resolve(ROOT, 'skills/edgebase/agents/openai.yaml');
const GENERATED_DIR = resolve(ROOT, 'skills/edgebase/references/generated');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    return null;
  }
  return match[1];
}

if (!existsSync(SKILL_PATH)) {
  fail('Missing skills/edgebase/SKILL.md');
}

if (!existsSync(OPENAI_YAML_PATH)) {
  fail('Missing skills/edgebase/agents/openai.yaml');
}

const skillBody = readFileSync(SKILL_PATH, 'utf-8');
const openaiYaml = readFileSync(OPENAI_YAML_PATH, 'utf-8');
const frontmatter = parseFrontmatter(skillBody);

if (frontmatter === null) {
  fail('skills/edgebase/SKILL.md is missing YAML frontmatter.');
}

if (!/^name:\s*edgebase\s*$/m.test(frontmatter)) {
  fail('skills/edgebase/SKILL.md frontmatter must include name: edgebase');
}

if (!/^description:\s*.+$/m.test(frontmatter)) {
  fail('skills/edgebase/SKILL.md frontmatter must include a description.');
}

if (!/display_name:\s*"EdgeBase"/.test(openaiYaml)) {
  fail('skills/edgebase/agents/openai.yaml must declare display_name: "EdgeBase".');
}

if (!/short_description:\s*".+"/.test(openaiYaml)) {
  fail('skills/edgebase/agents/openai.yaml must declare a short_description.');
}

const referencedFiles = Array.from(
  skillBody.matchAll(/`(references\/generated\/[^`]+\.md)`/g),
  (match) => resolve(dirname(SKILL_PATH), match[1]),
);

if (referencedFiles.length === 0) {
  fail('skills/edgebase/SKILL.md does not reference any generated reference files.');
}

for (const refPath of referencedFiles) {
  if (!existsSync(refPath)) {
    fail(`skills/edgebase/SKILL.md references a missing file: ${refPath}`);
  }
}

const generatedFiles = readdirSync(GENERATED_DIR)
  .filter((name) => name.endsWith('.md'))
  .sort();

if (generatedFiles.length === 0) {
  fail('skills/edgebase/references/generated is empty.');
}

for (const name of generatedFiles) {
  const fullPath = resolve(GENERATED_DIR, name);
  const body = readFileSync(fullPath, 'utf-8');

  if (!body.startsWith('<!-- Generated from ')) {
    fail(`Generated skill reference is missing its source header: ${fullPath}`);
  }
}

console.log(`Verified edgebase skill metadata and ${generatedFiles.length} generated references.`);
