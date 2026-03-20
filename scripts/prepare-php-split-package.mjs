import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

function parseArgs(argv) {
  const options = {
    target: null,
    packageDir: null,
    repo: null,
  };

  for (const arg of argv) {
    if (arg.startsWith('--target=')) {
      options.target = arg.slice('--target='.length).trim();
      continue;
    }
    if (arg.startsWith('--package-dir=')) {
      options.packageDir = arg.slice('--package-dir='.length).trim();
      continue;
    }
    if (arg.startsWith('--repo=')) {
      options.repo = arg.slice('--repo='.length).trim();
      continue;
    }
  }

  return options;
}

function updateComposerJson(packageDir, target, repo) {
  const composerPath = join(packageDir, 'composer.json');
  const composer = JSON.parse(readFileSync(composerPath, 'utf8'));

  if (repo) {
    composer.support ??= {};
    composer.support.source = `https://github.com/${repo}`;
  }

  delete composer.repositories;

  if (target === 'core') {
    if (composer['require-dev']) {
      delete composer['require-dev']['edgebase/admin'];
      if (Object.keys(composer['require-dev']).length === 0) {
        delete composer['require-dev'];
      }
    }
    delete composer['minimum-stability'];
    delete composer['prefer-stable'];
  }

  writeFileSync(composerPath, `${JSON.stringify(composer, null, 4)}\n`);
}

function removeComposerLock(packageDir) {
  const lockPath = join(packageDir, 'composer.lock');
  if (existsSync(lockPath)) {
    rmSync(lockPath);
  }
}

function replaceInFile(filePath, replacements) {
  if (!existsSync(filePath)) return;

  let contents = readFileSync(filePath, 'utf8');
  for (const [from, to] of replacements) {
    contents = contents.replace(from, to);
  }
  writeFileSync(filePath, contents);
}

function updateReadme(packageDir, target, repo) {
  const readmePath = join(packageDir, 'README.md');
  const replacements = [];

  if (repo) {
    replacements.push([
      `- in this repository: [llms.txt](https://github.com/edge-base/edgebase/blob/main/packages/sdk/php/packages/${target}/llms.txt)
`,
      `- in this repository: [llms.txt](https://github.com/${repo}/blob/main/llms.txt)
`,
    ]);
  }

  if (target === 'core') {
    replacements.push([
      `## Installation

Planned public package name:

\`\`\`bash
composer require edgebase/core
\`\`\`

Current monorepo usage:

- reference the package through Composer path repositories, or
- publish split PHP package repos before treating \`composer require edgebase/core\` as a public Packagist install`,
      `## Installation

\`\`\`bash
composer require edgebase/core
\`\`\``,
    ]);
    replaceInFile(readmePath, replacements);
    return;
  }

  if (target === 'admin') {
    replacements.push([
      `## Installation

Planned public package name:

\`\`\`bash
composer require edgebase/admin
\`\`\`

Current monorepo usage:

- consume the package through Composer path repositories, or
- publish split PHP package repos before treating \`composer require edgebase/admin\` as a public Packagist install`,
      `## Installation

\`\`\`bash
composer require edgebase/admin
\`\`\``,
    ]);
    replaceInFile(readmePath, replacements);
    return;
  }

  replaceInFile(readmePath, replacements);
}

function updateLlms(packageDir, target, repo) {
  const llmsPath = join(packageDir, 'llms.txt');
  const replacements = [];

  if (repo) {
    replacements.push([
      `- Package README: https://github.com/edge-base/edgebase/blob/main/packages/sdk/php/packages/${target}/README.md
`,
      `- Package README: https://github.com/${repo}/blob/main/README.md
`,
    ]);
  }

  if (target === 'core') {
    replacements.push([
      '`edgebase/core` is the intended public Composer package name, but the current monorepo still needs a Packagist-compatible publish path before that install works from Packagist.',
      '`edgebase/core` is the public Composer package name for the lower-level PHP EdgeBase primitives.',
    ]);
    replaceInFile(llmsPath, replacements);
    return;
  }

  if (target === 'admin') {
    replacements.push([
      '`edgebase/admin` is the intended public Composer package name, but the current monorepo still needs a Packagist-compatible publish path before that install works from Packagist.',
      '`edgebase/admin` is the public Composer package name for trusted server-side PHP EdgeBase workloads.',
    ]);
    replaceInFile(llmsPath, replacements);
    return;
  }

  replaceInFile(llmsPath, replacements);
}

function main() {
  const { target, packageDir, repo } = parseArgs(process.argv.slice(2));

  if (!target || !packageDir) {
    throw new Error(
      'Usage: node ./scripts/prepare-php-split-package.mjs --target=core|admin --package-dir=/tmp/worktree [--repo=edge-base/edgebase-php-core]',
    );
  }

  const resolvedDir = resolve(packageDir);
  updateComposerJson(resolvedDir, target, repo);
  removeComposerLock(resolvedDir);
  updateReadme(resolvedDir, target, repo);
  updateLlms(resolvedDir, target, repo);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
