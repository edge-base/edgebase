import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const docsRoot = process.cwd();
const buildDir = path.join(docsRoot, 'build');
const staticDir = path.join(docsRoot, 'static');
const buildIndexPattern = /^search-index.*\.json$/;
const watchRoots = [
  path.join(docsRoot, 'docs'),
  path.join(docsRoot, 'src'),
  path.join(docsRoot, 'docusaurus.config.ts'),
  path.join(docsRoot, 'sidebars.ts'),
  path.join(docsRoot, 'site-metadata.json'),
  path.join(docsRoot, 'package.json'),
];

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(targetPath) {
  const stat = await fs.stat(targetPath);
  if (stat.isFile()) {
    return [targetPath];
  }

  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => collectFiles(path.join(targetPath, entry.name))),
  );
  return nested.flat();
}

async function getLatestMtime(pathsToCheck) {
  const files = (
    await Promise.all(
      pathsToCheck.map(async (targetPath) => (await exists(targetPath) ? collectFiles(targetPath) : [])),
    )
  ).flat();

  if (files.length === 0) {
    return 0;
  }

  const stats = await Promise.all(files.map((filePath) => fs.stat(filePath)));
  return Math.max(...stats.map((stat) => stat.mtimeMs));
}

async function getSearchFiles(targetPath) {
  if (!(await exists(targetPath))) {
    return [];
  }

  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && buildIndexPattern.test(entry.name))
    .map((entry) => path.join(targetPath, entry.name));
}

async function syncSearchIndexes() {
  const searchFiles = await getSearchFiles(buildDir);
  if (searchFiles.length === 0) {
    throw new Error('No search index files were found in docs/build.');
  }

  await fs.mkdir(staticDir, { recursive: true });

  const staticFiles = await getSearchFiles(staticDir);
  await Promise.all(staticFiles.map((filePath) => fs.unlink(filePath)));
  await Promise.all(
    searchFiles.map((filePath) =>
      fs.copyFile(filePath, path.join(staticDir, path.basename(filePath))),
    ),
  );
}

async function ensureFreshSearchIndex() {
  const sourceMtime = await getLatestMtime(watchRoots);
  const staticSearchFiles = await getSearchFiles(staticDir);
  const buildSearchFiles = await getSearchFiles(buildDir);
  const newestStaticMtime =
    staticSearchFiles.length > 0
      ? Math.max(...(await Promise.all(staticSearchFiles.map((filePath) => fs.stat(filePath)))).map((stat) => stat.mtimeMs))
      : 0;
  const newestBuildMtime =
    buildSearchFiles.length > 0
      ? Math.max(...(await Promise.all(buildSearchFiles.map((filePath) => fs.stat(filePath)))).map((stat) => stat.mtimeMs))
      : 0;

  if (newestStaticMtime >= sourceMtime) {
    return;
  }

  if (newestBuildMtime < sourceMtime) {
    const result = spawnSync('pnpm', ['build'], {
      cwd: docsRoot,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    if (result.status !== 0) {
      throw new Error('Failed to refresh docs build for dev search.');
    }
  }

  await syncSearchIndexes();
}

await ensureFreshSearchIndex();
