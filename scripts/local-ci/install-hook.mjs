#!/usr/bin/env node

import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { git } from './lib.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MARKER = '# managed-by-edgebase-local-linux-ci';
const CONTENT = `#!/bin/sh
${MARKER}
set -eu
repo_root="$(git rev-parse --show-toplevel)"
exec node "$repo_root/scripts/local-ci/pre-push.mjs"
`;

async function main() {
  const gitPath = await git(repoRoot, ['rev-parse', '--git-path', 'hooks/pre-push']);
  const hookPath = path.resolve(repoRoot, gitPath);
  await mkdir(path.dirname(hookPath), { recursive: true });
  let existing = null;
  try {
    existing = await readFile(hookPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (existing && !existing.includes(MARKER)) {
    throw new Error(`Refusing to overwrite unmanaged pre-push hook: ${hookPath}`);
  }
  await writeFile(hookPath, CONTENT, { mode: 0o755 });
  await chmod(hookPath, 0o755);
  console.log(`Installed EdgeBase local Linux CI pre-push hook: ${hookPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
