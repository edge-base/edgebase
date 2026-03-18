import { getSourceVersion, isValidSemver, readJson, writeJson } from './release-version-utils.mjs';
import { syncReleaseVersions } from './sync-release-versions.mjs';

const nextVersion = process.argv[2];

if (!nextVersion) {
  console.error('Usage: node ./scripts/set-release-version.mjs <version>');
  process.exit(1);
}

if (!isValidSemver(nextVersion)) {
  console.error(`Invalid semver version: ${nextVersion}`);
  process.exit(1);
}

const rootPackage = readJson('package.json');
const previousVersion = getSourceVersion();
rootPackage.version = nextVersion;
writeJson('package.json', rootPackage);

console.log(`Updated root version: ${previousVersion} -> ${nextVersion}`);
console.log();
syncReleaseVersions(nextVersion);
