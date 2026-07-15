#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const AUDIT_ENDPOINT = 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk';
const AUDIT_TIMEOUT_MS = 60_000;
const BLOCKING_SEVERITIES = new Set(['high', 'critical']);
const KNOWN_SEVERITIES = new Set(['info', 'low', 'moderate', 'high', 'critical']);

function decodePackageKey(rawKey) {
  if (rawKey.startsWith("'") || rawKey.endsWith("'")) {
    if (!(rawKey.startsWith("'") && rawKey.endsWith("'"))) {
      throw new Error(`Malformed single-quoted pnpm package key: ${rawKey}`);
    }
    return rawKey.slice(1, -1).replaceAll("''", "'");
  }
  if (rawKey.startsWith('"') || rawKey.endsWith('"')) {
    if (!(rawKey.startsWith('"') && rawKey.endsWith('"'))) {
      throw new Error(`Malformed double-quoted pnpm package key: ${rawKey}`);
    }
    return JSON.parse(rawKey);
  }
  return rawKey;
}

function splitPackageKey(rawKey) {
  const decoded = decodePackageKey(rawKey);
  const aliasMarker = decoded.indexOf('@npm:');
  const packageKey = aliasMarker > 0 ? decoded.slice(aliasMarker + '@npm:'.length) : decoded;
  const versionMarker = packageKey.lastIndexOf('@');
  if (versionMarker < 1) {
    throw new Error(`Unsupported pnpm package key: ${decoded}`);
  }

  const name = packageKey.slice(0, versionMarker);
  const version = packageKey.slice(versionMarker + 1);
  if (!name || !version || /\s/.test(name) || /\s/.test(version)) {
    throw new Error(`Unsupported pnpm package key: ${decoded}`);
  }
  return { name, version };
}

export function parsePnpmPackageVersions(lockfile) {
  const lines = lockfile.split(/\r?\n/);
  const packagesStart = lines.indexOf('packages:');
  const snapshotsStart = lines.indexOf('snapshots:');
  if (packagesStart < 0 || snapshotsStart <= packagesStart) {
    throw new Error('pnpm-lock.yaml must contain packages and snapshots sections.');
  }

  const versionsByPackage = new Map();
  for (const line of lines.slice(packagesStart + 1, snapshotsStart)) {
    if (!line.startsWith('  ') || line.startsWith('    ') || line.trim() === '') continue;
    const match = line.match(/^  (\S.*):$/);
    if (!match) {
      throw new Error(`Unsupported pnpm packages entry: ${line.trim()}`);
    }
    const { name, version } = splitPackageKey(match[1]);
    const versions = versionsByPackage.get(name) ?? new Set();
    versions.add(version);
    versionsByPackage.set(name, versions);
  }

  if (versionsByPackage.size === 0) {
    throw new Error('pnpm-lock.yaml packages section is empty.');
  }

  return Object.fromEntries(
    [...versionsByPackage.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, versions]) => [name, [...versions].sort()]),
  );
}

export function blockingAdvisories(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('npm security advisory response must be an object.');
  }

  const result = [];
  for (const [name, advisories] of Object.entries(payload)) {
    if (!Array.isArray(advisories)) {
      throw new Error(`npm security advisories for ${name} must be an array.`);
    }
    for (const advisory of advisories) {
      if (!advisory || typeof advisory !== 'object' || typeof advisory.severity !== 'string') {
        throw new Error(`npm security advisory for ${name} is malformed.`);
      }
      const severity = advisory.severity.toLowerCase();
      if (!KNOWN_SEVERITIES.has(severity)) {
        throw new Error(`npm security advisory for ${name} has unknown severity: ${severity}`);
      }
      if (BLOCKING_SEVERITIES.has(severity)) {
        result.push({ name, ...advisory, severity });
      }
    }
  }
  return result.sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      String(left.id ?? '').localeCompare(String(right.id ?? '')),
  );
}

async function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const lockfile = await readFile(path.join(repoRoot, 'pnpm-lock.yaml'), 'utf8');
  const packageVersions = parsePnpmPackageVersions(lockfile);
  const packageVersionCount = Object.values(packageVersions).reduce(
    (count, versions) => count + versions.length,
    0,
  );

  const response = await fetch(AUDIT_ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'edgebase-security-audit',
    },
    body: JSON.stringify(packageVersions),
    signal: AbortSignal.timeout(AUDIT_TIMEOUT_MS),
  });
  const responseBody = await response.text();
  if (!response.ok) {
    throw new Error(
      `npm security advisory request failed (${response.status}): ${responseBody.slice(0, 500)}`,
    );
  }

  let payload;
  try {
    payload = JSON.parse(responseBody);
  } catch (error) {
    throw new Error('npm security advisory response was not valid JSON.', { cause: error });
  }

  const blocked = blockingAdvisories(payload);
  if (blocked.length > 0) {
    console.error(`Security audit found ${blocked.length} HIGH or CRITICAL advisory finding(s):`);
    for (const advisory of blocked) {
      const reference = advisory.url ? ` ${advisory.url}` : '';
      console.error(
        `- ${advisory.name}: ${advisory.severity.toUpperCase()} ${advisory.title ?? advisory.id ?? 'advisory'}${reference}`,
      );
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `Security audit passed: ${Object.keys(packageVersions).length} package names, ` +
      `${packageVersionCount} locked versions, no HIGH or CRITICAL advisories.`,
  );
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(`Security audit failed: ${error.message}`);
    process.exitCode = 1;
  });
}
