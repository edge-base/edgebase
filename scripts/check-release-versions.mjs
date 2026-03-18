import { RELEASE_TARGETS } from './release-targets.mjs';
import { getSourceVersion, isValidSemver, readTargetVersion, summarizeTargets } from './release-version-utils.mjs';

const version = getSourceVersion();

if (!isValidSemver(version)) {
  throw new Error(`Root version "${version}" is not a valid semver string.`);
}

const summary = summarizeTargets();
console.log(`Checking ${summary.fileBacked} file-backed release targets against root version ${version}...`);
if (summary.tagOnly > 0) {
  console.log(`Tag-only targets are listed for release planning but excluded from file-version checks: ${summary.tagOnly}.`);
}
console.log();

const mismatches = [];

for (const target of RELEASE_TARGETS) {
  if (target.strategy === 'tag-only') {
    console.log(`- ${target.name}: tag-only (${target.note ?? 'managed by git tags'})`);
    continue;
  }

  const currentVersion = readTargetVersion(target);
  if (currentVersion !== version) {
    mismatches.push({
      name: target.name,
      path: target.path,
      currentVersion,
    });
    console.log(`- ${target.name}: mismatch (${currentVersion} != ${version})`);
  } else {
    console.log(`- ${target.name}: ok (${currentVersion})`);
  }
}

if (mismatches.length > 0) {
  console.error();
  console.error(`Found ${mismatches.length} release target version mismatch(es).`);
  for (const mismatch of mismatches) {
    console.error(`  - ${mismatch.name} at ${mismatch.path}: ${mismatch.currentVersion}`);
  }
  console.error('Run `pnpm release:sync` to align file-backed targets to the root version.');
  process.exit(1);
}

console.log();
console.log('All file-backed release targets are aligned.');
