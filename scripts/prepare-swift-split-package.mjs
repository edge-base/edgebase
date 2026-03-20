import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

function parseArgs(argv) {
  const options = {
    target: null,
    packageDir: null,
    coreRepo: null,
    syncMode: 'branch',
    displayVersion: null,
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
    if (arg.startsWith('--core-repo=')) {
      options.coreRepo = arg.slice('--core-repo='.length).trim();
      continue;
    }
    if (arg.startsWith('--sync-mode=')) {
      options.syncMode = arg.slice('--sync-mode='.length).trim();
      continue;
    }
    if (arg.startsWith('--display-version=')) {
      options.displayVersion = arg.slice('--display-version='.length).trim();
      continue;
    }
  }

  return options;
}

function updateClientManifest(packageDir, coreRepo, syncMode, displayVersion) {
  const packagePath = join(packageDir, 'Package.swift');
  let contents = readFileSync(packagePath, 'utf8');

  const requirement =
    syncMode === 'tag'
      ? `.package(url: "https://github.com/${coreRepo}", exact: "${displayVersion}")`
      : `.package(url: "https://github.com/${coreRepo}", branch: "main")`;

  contents = contents.replace(
    /\.package\(path: "\.\.\/core"\)/m,
    requirement,
  );
  contents = contents.replace(
    /\.product\(name: "EdgeBaseCore", package: "core"\)/m,
    `.product(name: "EdgeBaseCore", package: "${coreRepo.split('/').at(-1)}")`,
  );

  writeFileSync(packagePath, contents);
}

function main() {
  const { target, packageDir, coreRepo, syncMode, displayVersion } = parseArgs(process.argv.slice(2));

  if (!target || !packageDir) {
    throw new Error(
      'Usage: node ./scripts/prepare-swift-split-package.mjs --target=core|client --package-dir=/tmp/worktree [--core-repo=edge-base/edgebase-swift-core] [--sync-mode=branch|tag] [--display-version=0.1.4]',
    );
  }

  const resolvedDir = resolve(packageDir);

  if (target === 'core') {
    return;
  }

  if (!coreRepo) {
    throw new Error('Client split preparation requires --core-repo=edge-base/edgebase-swift-core');
  }

  if (!displayVersion) {
    throw new Error('Client split preparation requires --display-version=0.1.x');
  }

  updateClientManifest(resolvedDir, coreRepo, syncMode, displayVersion);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
