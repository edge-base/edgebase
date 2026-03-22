import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASE_TARGETS, RELEASE_VERSION_REFERENCES } from './release-targets.mjs';
import { getSourceVersion, isValidSemver, updateTargetVersion, updateVersionReference, summarizeTargets } from './release-version-utils.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function regenerateGeneratedSkillReferences() {
  const result = spawnSync(process.execPath, ['tools/agent-skill-gen/generate.mjs'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (output.trim().length > 0) {
    process.stdout.write(output);
    if (!output.endsWith('\n')) {
      process.stdout.write('\n');
    }
  }

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`Failed to regenerate generated skill references (exit ${result.status ?? 1}).`);
  }
}

export function syncReleaseVersions(version = getSourceVersion()) {
  if (!isValidSemver(version)) {
    throw new Error(`Root version "${version}" is not a valid semver string.`);
  }

  const summary = summarizeTargets();
  console.log(`Syncing ${summary.fileBacked} file-backed release targets to ${version}...`);
  if (summary.tagOnly > 0) {
    console.log(`Skipping ${summary.tagOnly} tag-only targets (Go/Swift/Composer subpackages).`);
  }
  if (summary.versionReferences > 0) {
    console.log(`Syncing ${summary.versionReferences} versioned dependency/doc references to ${version}.`);
  }
  console.log();

  const results = RELEASE_TARGETS.map((target) => updateTargetVersion(target, version));
  const referenceResults = RELEASE_VERSION_REFERENCES.map((reference) => updateVersionReference(reference, version));

  for (const result of results) {
    if (result.skipped) {
      console.log(`- ${result.name}: skipped (${result.reason})`);
      continue;
    }

    const status = result.changed ? 'updated' : 'already synced';
    console.log(`- ${result.name}: ${status} (${result.currentVersion} -> ${version})`);
  }

  for (const result of referenceResults) {
    const status = result.changed ? 'updated' : 'already synced';
    console.log(`- ${result.label}: ${status} (${result.path})`);
  }

  console.log();
  console.log('Regenerating generated skill references...');
  regenerateGeneratedSkillReferences();

  return {
    targets: results,
    references: referenceResults,
  };
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  syncReleaseVersions();
}
