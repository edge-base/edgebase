import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertStableReleaseVersion, getSourceVersion, readJson, writeJson } from './release-version-utils.mjs';
import { syncReleaseVersions } from './sync-release-versions.mjs';

export function setReleaseVersion(nextVersion) {
  if (!nextVersion) {
    throw new Error('Usage: node ./scripts/set-release-version.mjs <version>');
  }

  assertStableReleaseVersion(nextVersion);

  const rootPackage = readJson('package.json');
  const previousVersion = getSourceVersion();
  rootPackage.version = nextVersion;
  writeJson('package.json', rootPackage);

  console.log(`Updated root version: ${previousVersion} -> ${nextVersion}`);
  console.log();
  syncReleaseVersions(nextVersion);
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  try {
    setReleaseVersion(process.argv[2]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
