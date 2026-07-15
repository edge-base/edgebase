import assert from 'node:assert/strict';
import test from 'node:test';
import { blockingAdvisories, parsePnpmPackageVersions } from './security-audit.mjs';

test('pnpm lock package versions are normalized for the npm bulk advisory API', () => {
  const lockfile = `lockfileVersion: '9.0'

importers: {}

packages:

  '@scope/package@1.2.3':
    resolution: {integrity: example}

  alias@npm:real-package@2.0.0:
    resolution: {integrity: example}

  package@2.0.0:
    resolution: {integrity: example}

  package@1.0.0:
    resolution: {integrity: example}

snapshots:

  package@2.0.0: {}
`;

  assert.deepEqual(parsePnpmPackageVersions(lockfile), {
    '@scope/package': ['1.2.3'],
    package: ['1.0.0', '2.0.0'],
    'real-package': ['2.0.0'],
  });
});

test('unsupported pnpm lock package entries fail closed', () => {
  assert.throws(
    () => parsePnpmPackageVersions('packages:\n  unsupported-key:\nsnapshots:\n'),
    /Unsupported pnpm package key/,
  );
  assert.throws(
    () => parsePnpmPackageVersions('packages:\n  package@1.0.0\nsnapshots:\n'),
    /Unsupported pnpm packages entry/,
  );
});

test('only high and critical advisories block the release audit', () => {
  assert.deepEqual(
    blockingAdvisories({
      'moderate-package': [{ id: 1, severity: 'moderate', title: 'moderate' }],
      severePackage: [{ id: 2, severity: 'HIGH', title: 'high' }],
      criticalPackage: [{ id: 3, severity: 'critical', title: 'critical' }],
    }),
    [
      { id: 3, name: 'criticalPackage', severity: 'critical', title: 'critical' },
      { id: 2, name: 'severePackage', severity: 'high', title: 'high' },
    ],
  );
});

test('malformed advisory responses fail closed', () => {
  assert.throws(() => blockingAdvisories([]), /must be an object/);
  assert.throws(() => blockingAdvisories({ package: {} }), /must be an array/);
  assert.throws(
    () => blockingAdvisories({ package: [{ severity: 'unknown' }] }),
    /unknown severity/,
  );
});
