import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RELEASE_TARGETS, RELEASE_VERSION_SOURCE } from './release-targets.mjs';

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
    case 'toml-version':
      return updateTextVersion(target, nextVersion, /(^version\s*=\s*")([^"]+)(")/m);
    case 'yaml-version':
      return updateTextVersion(target, nextVersion, /(^version:\s*)(.+)$/m);
    case 'gradle-version':
      return updateTextVersion(target, nextVersion, /(^\s*version\s*=\s*['"])([^'"]+)(['"])/m);
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
    case 'toml-version':
      return readTextVersion(target, /(^version\s*=\s*")([^"]+)(")/m);
    case 'yaml-version':
      return readTextVersion(target, /(^version:\s*)(.+)$/m);
    case 'gradle-version':
      return readTextVersion(target, /(^\s*version\s*=\s*['"])([^'"]+)(['"])/m);
    case 'tag-only':
      return null;
    default:
      throw new Error(`Unsupported strategy: ${target.strategy}`);
  }
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

export function summarizeTargets() {
  const fileBacked = RELEASE_TARGETS.filter((target) => target.strategy !== 'tag-only');
  const tagOnly = RELEASE_TARGETS.filter((target) => target.strategy === 'tag-only');
  return {
    total: RELEASE_TARGETS.length,
    fileBacked: fileBacked.length,
    tagOnly: tagOnly.length,
  };
}
