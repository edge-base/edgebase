import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASE_TARGETS, RELEASE_VERSION_REFERENCES, RELEASE_VERSION_SOURCE } from './release-targets.mjs';

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url));
export const REPO_ROOT = resolve(SCRIPT_DIR, '..');

export function resolveRepoPath(relativePath) {
  return resolve(REPO_ROOT, relativePath);
}

export function readRepoFile(relativePath) {
  return readFileSync(resolveRepoPath(relativePath), 'utf8');
}

export function writeRepoFile(relativePath, contents) {
  writeFileSync(resolveRepoPath(relativePath), contents, 'utf8');
}

export function readJson(relativePath) {
  return JSON.parse(readRepoFile(relativePath));
}

export function writeJson(relativePath, data) {
  writeRepoFile(relativePath, `${JSON.stringify(data, null, 4)}\n`);
}

export function getSourceVersion() {
  const source = readJson(RELEASE_VERSION_SOURCE.path);
  const version = source[RELEASE_VERSION_SOURCE.field];
  if (typeof version !== 'string' || version.length === 0) {
    throw new Error(`Missing root version in ${RELEASE_VERSION_SOURCE.path}`);
  }
  return version;
}

export function isValidSemver(version) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version);
}

export function updateTargetVersion(target, nextVersion) {
  switch (target.strategy) {
    case 'json-version':
      return updateJsonVersion(target, nextVersion);
    case 'uplugin-version':
      return updateTextVersion(target, nextVersion, /(^\s*"VersionName":\s*")([^"]+)(",?$)/m);
    case 'toml-version':
      return updateTextVersion(target, nextVersion, /(^version\s*=\s*")([^"]+)(")/m);
    case 'yaml-version':
      return updateTextVersion(target, nextVersion, /(^version:\s*)(.+)$/m);
    case 'gradle-version':
      return updateTextVersion(target, nextVersion, /(^\s*version\s*=\s*['"])([^'"]+)(['"])/m);
    case 'gradle-const-version':
      return updateTextVersion(target, nextVersion, /(^\s*(?:def|val)\s+edgebaseReleaseVersion\s*=\s*['"])([^'"]+)(['"])/m);
    case 'gradle-root-version':
      return verifyInheritedVersionTarget(target, nextVersion, /^\s*version\s*=\s*rootProject\.version\s*$/m);
    case 'csproj-version':
      return updateTextVersion(target, nextVersion, /(<Version>)([^<]+)(<\/Version>)/);
    case 'gemspec-version':
      return updateTextVersion(target, nextVersion, /(^\s*spec\.version\s*=\s*["'])([^"']+)(["'])/m);
    case 'mix-version':
      return updateTextVersion(target, nextVersion, /(^\s*version:\s*")([^"]+)(")/m);
    case 'tag-only':
      return {
        ...target,
        nextVersion,
        changed: false,
        skipped: true,
        reason: target.note ?? 'Version is tag-driven for this ecosystem.',
      };
    default:
      throw new Error(`Unsupported strategy: ${target.strategy}`);
  }
}

export function readTargetVersion(target) {
  switch (target.strategy) {
    case 'json-version':
      return readJson(target.path).version;
    case 'uplugin-version':
      return readTextVersion(target, /(^\s*"VersionName":\s*")([^"]+)(",?$)/m);
    case 'toml-version':
      return readTextVersion(target, /(^version\s*=\s*")([^"]+)(")/m);
    case 'yaml-version':
      return readTextVersion(target, /(^version:\s*)(.+)$/m);
    case 'gradle-version':
      return readTextVersion(target, /(^\s*version\s*=\s*['"])([^'"]+)(['"])/m);
    case 'gradle-const-version':
      return readTextVersion(target, /(^\s*(?:def|val)\s+edgebaseReleaseVersion\s*=\s*['"])([^'"]+)(['"])/m);
    case 'gradle-root-version':
      return readInheritedVersionTarget(target, /^\s*version\s*=\s*rootProject\.version\s*$/m);
    case 'csproj-version':
      return readTextVersion(target, /(<Version>)([^<]+)(<\/Version>)/);
    case 'gemspec-version':
      return readTextVersion(target, /(^\s*spec\.version\s*=\s*["'])([^"']+)(["'])/m);
    case 'mix-version':
      return readTextVersion(target, /(^\s*version:\s*")([^"]+)(")/m);
    case 'tag-only':
      return null;
    default:
      throw new Error(`Unsupported strategy: ${target.strategy}`);
  }
}

export function getCompatibleUpperBound(version) {
  const core = version.split(/[-+]/, 1)[0];
  const [major, minor] = core.split('.').map((part) => Number.parseInt(part, 10));
  if (!Number.isInteger(major) || !Number.isInteger(minor)) {
    throw new Error(`Cannot compute compatibility upper bound for invalid semver: ${version}`);
  }
  if (major === 0) {
    return `0.${minor + 1}.0`;
  }
  return `${major + 1}.0.0`;
}

function applyVersionReference(contents, reference, nextVersion) {
  let matched = false;
  const upperBound = getCompatibleUpperBound(nextVersion);
  const tagVersion = `v${nextVersion}`;
  const nextContents = contents.replace(reference.pattern, (fullMatch, ...captures) => {
    matched = true;
    return reference.replace({ version: nextVersion, upperBound, tagVersion }, ...captures);
  });
  if (!matched) {
    throw new Error(`No version reference found for ${reference.label} in ${reference.path}`);
  }
  return nextContents;
}

export function updateVersionReference(reference, nextVersion) {
  const currentContents = readRepoFile(reference.path);
  const nextContents = applyVersionReference(currentContents, reference, nextVersion);
  if (nextContents !== currentContents) {
    writeRepoFile(reference.path, nextContents);
  }
  return {
    ...reference,
    changed: nextContents !== currentContents,
  };
}

export function checkVersionReference(reference, version) {
  const currentContents = readRepoFile(reference.path);
  const expectedContents = applyVersionReference(currentContents, reference, version);
  return {
    ...reference,
    ok: currentContents === expectedContents,
  };
}

function updateJsonVersion(target, nextVersion) {
  const json = readJson(target.path);
  const currentVersion = json.version;
  if (typeof currentVersion !== 'string') {
    throw new Error(`No version field found in ${target.path}`);
  }
  json.version = nextVersion;
  writeJson(target.path, json);
  return {
    ...target,
    currentVersion,
    nextVersion,
    changed: currentVersion !== nextVersion,
    skipped: false,
  };
}

function updateTextVersion(target, nextVersion, pattern) {
  const currentContents = readRepoFile(target.path);
  const match = currentContents.match(pattern);
  if (!match) {
    throw new Error(`No version field found in ${target.path}`);
  }
  const currentVersion = match[2];
  const captureCount = match.length - 1;
  const nextContents = currentContents.replace(pattern, (_fullMatch, prefix, _current, ...rest) => {
    const suffix = captureCount >= 3 ? rest[0] ?? '' : '';
    return `${prefix}${nextVersion}${suffix}`;
  });
  if (nextContents !== currentContents) {
    writeRepoFile(target.path, nextContents);
  }
  return {
    ...target,
    currentVersion,
    nextVersion,
    changed: currentVersion !== nextVersion,
    skipped: false,
  };
}

function readTextVersion(target, pattern) {
  const match = readRepoFile(target.path).match(pattern);
  if (!match) {
    throw new Error(`No version field found in ${target.path}`);
  }
  return match[2].trim();
}

function verifyInheritedVersionTarget(target, nextVersion, pattern) {
  if (!pattern.test(readRepoFile(target.path))) {
    throw new Error(`No inherited version field found in ${target.path}`);
  }
  return {
    ...target,
    currentVersion: getSourceVersion(),
    nextVersion,
    changed: false,
    skipped: false,
  };
}

function readInheritedVersionTarget(target, pattern) {
  if (!pattern.test(readRepoFile(target.path))) {
    throw new Error(`No inherited version field found in ${target.path}`);
  }
  return getSourceVersion();
}

export function summarizeTargets() {
  const fileBacked = RELEASE_TARGETS.filter((target) => target.strategy !== 'tag-only');
  const tagOnly = RELEASE_TARGETS.filter((target) => target.strategy === 'tag-only');
  return {
    total: RELEASE_TARGETS.length,
    fileBacked: fileBacked.length,
    tagOnly: tagOnly.length,
    versionReferences: RELEASE_VERSION_REFERENCES.length,
  };
}
