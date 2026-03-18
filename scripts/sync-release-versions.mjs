import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASE_TARGETS } from './release-targets.mjs';
import { getSourceVersion, isValidSemver, updateTargetVersion, summarizeTargets } from './release-version-utils.mjs';

export function syncReleaseVersions(version = getSourceVersion()) {
  if (!isValidSemver(version)) {
    throw new Error(`Root version "${version}" is not a valid semver string.`);
  }

  const summary = summarizeTargets();
  console.log(`Syncing ${summary.fileBacked} file-backed release targets to ${version}...`);
  if (summary.tagOnly > 0) {
    console.log(`Skipping ${summary.tagOnly} tag-only targets (Go/Swift/Composer subpackages).`);
  }
  console.log();

  const results = RELEASE_TARGETS.map((target) => updateTargetVersion(target, version));

  for (const result of results) {
    if (result.skipped) {
      console.log(`- ${result.name}: skipped (${result.reason})`);
      continue;
    }

    const status = result.changed ? 'updated' : 'already synced';
    console.log(`- ${result.name}: ${status} (${result.currentVersion} -> ${version})`);
  }

  return results;
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  syncReleaseVersions();
}
