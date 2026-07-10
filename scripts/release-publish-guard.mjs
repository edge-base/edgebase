import { spawnSync } from 'node:child_process';
import { checkReleaseVersions } from './check-release-versions.mjs';
import {
  assertStableReleaseVersion,
  getSourceVersion,
  REPO_ROOT,
} from './release-version-utils.mjs';

export function getWorkingTreeStatus() {
  const result = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });

  if (result.error) {
    throw new Error(`Unable to inspect the git working tree: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    throw new Error(`Unable to inspect the git working tree${detail ? `: ${detail}` : '.'}`);
  }

  return (result.stdout ?? '').trim();
}

export function getGitRevision(ref) {
  const result = spawnSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (result.error) {
    throw new Error(`Unable to resolve git ref ${ref}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Unable to resolve git ref ${ref}.`);
  }
  return (result.stdout ?? '').trim();
}

export function assertReleaseTagAtHead(version, options = {}) {
  assertStableReleaseVersion(version);
  const { readRevision = getGitRevision } = options;
  const tag = `v${version}`;
  const headRevision = readRevision('HEAD');
  const tagRevision = readRevision(tag);
  if (!headRevision || tagRevision !== headRevision) {
    throw new Error(
      `Refusing external release action: central tag ${tag} must exist and point to HEAD.`,
    );
  }
  return { tag, revision: headRevision };
}

/**
 * Verify that a release was prepared before a publish/sync/remote-verification
 * command starts. This guard is intentionally read-only: release:set is the
 * only command allowed to change versions, and its result must be reviewed and
 * committed separately before any external release action.
 */
export function assertPreparedRelease(version, options = {}) {
  const {
    dryRun = false,
    requireClean = !dryRun,
    requireTag = !dryRun,
    allowDirty = process.env.EDGEBASE_ALLOW_DIRTY === '1',
    readWorkingTreeStatus = getWorkingTreeStatus,
    readRevision = getGitRevision,
  } = options;

  assertStableReleaseVersion(version);

  const sourceVersion = getSourceVersion();
  if (sourceVersion !== version) {
    throw new Error(
      `Release source is ${sourceVersion}, not ${version}. `
        + `Run \`pnpm release:set ${version}\`, review the generated changes, and commit them before publishing.`,
    );
  }

  checkReleaseVersions(version);

  let clean = null;
  if (requireClean && allowDirty) {
    console.warn('Warning: skipping clean-working-tree enforcement (EDGEBASE_ALLOW_DIRTY=1).');
    clean = false;
  } else if (requireClean) {
    const status = readWorkingTreeStatus();
    if (status) {
      throw new Error(
        'Refusing external release action: git working tree is not clean. '
          + 'Commit the prepared release first (or set EDGEBASE_ALLOW_DIRTY=1 only for an intentional emergency override).',
      );
    }
    clean = true;
  }

  if (requireTag) {
    assertReleaseTagAtHead(version, { readRevision });
  }

  return { version, clean };
}
