#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const catalogPath = path.join(repoRoot, 'packages/sdk/contracts/role-contracts.json');
const workflowPath = path.join(repoRoot, '.github/workflows/test.yml');

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const workflowText = fs.readFileSync(workflowPath, 'utf8');
const sourceCache = new Map();

const discovery = {
  admin: [
    { sdk: 'go', sources: ['packages/sdk/go/edgebase_e2e_test.go'] },
    { sdk: 'js', sources: ['packages/sdk/js/packages/admin/test/e2e/admin.e2e.test.ts'] },
    { sdk: 'python', sources: ['packages/sdk/python/packages/admin/tests/test_admin_e2e.py'] },
    { sdk: 'java', sources: ['packages/sdk/java/packages/admin/src/test/java/dev/edgebase/sdk/admin/AdminE2ETest.java'] },
    { sdk: 'kotlin', sources: ['packages/sdk/kotlin/admin/src/test/kotlin/dev/edgebase/sdk/admin/AdminEdgeBaseE2ETest.kt'] },
    { sdk: 'dart', sources: ['packages/sdk/dart/packages/admin/test/admin_e2e_test.dart'] },
    { sdk: 'rust', sources: ['packages/sdk/rust/tests/e2e.rs'] },
    { sdk: 'csharp', sources: ['packages/sdk/csharp/packages/admin/tests/AdminE2ETests.cs'] },
    { sdk: 'php', sources: ['packages/sdk/php/packages/admin/tests/e2e/AdminClientE2ETest.php'] },
    { sdk: 'elixir', sources: ['packages/sdk/elixir/packages/admin/test/admin_e2e_test.exs'] },
    { sdk: 'scala', sources: ['packages/sdk/scala/packages/admin/src/test/scala/dev/edgebase/sdk/scala/admin/AdminEdgeBaseE2ETest.scala'] },
    { sdk: 'ruby', sources: ['packages/sdk/ruby/packages/admin/test/test_admin_e2e.rb'] }
  ],
  core: [
    { sdk: 'go', sources: ['packages/sdk/go/edgebase_e2e_test.go'] },
    { sdk: 'js', sources: ['packages/sdk/js/packages/core/test/e2e/core.e2e.test.ts'] },
    { sdk: 'python', sources: ['packages/sdk/python/packages/core/tests/test_core_e2e.py'] },
    { sdk: 'java', sources: ['packages/sdk/java/packages/core/src/test/java/dev/edgebase/sdk/core/CoreE2ETest.java'] },
    { sdk: 'kotlin', sources: ['packages/sdk/kotlin/core/src/androidUnitTest/kotlin/io/edgebase/sdk/EdgeBaseE2ETest.kt'] },
    { sdk: 'dart', sources: ['packages/sdk/dart/packages/core/test/core_e2e_test.dart'] },
    { sdk: 'rust', sources: ['packages/sdk/rust/tests/e2e.rs'] },
    { sdk: 'php', sources: ['packages/sdk/php/packages/core/tests/e2e/CoreCrudE2ETest.php'] },
    { sdk: 'swift', sources: ['packages/sdk/swift/packages/core/Tests/CoreE2ETests.swift'] },
    { sdk: 'cpp', sources: ['packages/sdk/cpp/packages/core/tests/e2e_tests.cpp'] }
  ],
  client: [
    { sdk: 'js', sources: ['packages/sdk/js/packages/web/test/e2e/web.e2e.test.ts'] },
    { sdk: 'react-native', sources: ['packages/sdk/react-native/test/e2e/rn.e2e.test.ts'] },
    { sdk: 'java', sources: ['packages/sdk/java/packages/android/src/test/java/dev/edgebase/sdk/client/AndroidE2ETest.java'] },
    { sdk: 'kotlin', sources: ['packages/sdk/kotlin/client/src/androidUnitTest/kotlin/dev/edgebase/sdk/client/ClientEdgeBaseE2ETest.kt'] },
    { sdk: 'dart', sources: ['packages/sdk/dart/packages/flutter/test/flutter_e2e_test.dart'] },
    { sdk: 'csharp', sources: ['packages/sdk/csharp/packages/unity/tests/UnityE2ETests.cs'] },
    { sdk: 'swift', sources: ['packages/sdk/swift/packages/ios/Tests/IosE2ETests.swift'] },
    { sdk: 'cpp', sources: ['packages/sdk/cpp/packages/unreal/tests/e2e_tests.cpp'] }
  ],
  'client-auth-verify': [
    { sdk: 'js', sources: ['packages/sdk/js/packages/web/test/e2e/web.e2e.test.ts'] },
    { sdk: 'react-native', sources: ['packages/sdk/react-native/test/e2e/rn.e2e.test.ts'] },
    { sdk: 'java', sources: ['packages/sdk/java/packages/android/src/test/java/dev/edgebase/sdk/client/AndroidE2ETest.java'] },
    { sdk: 'kotlin', sources: ['packages/sdk/kotlin/client/src/jvmTest/kotlin/dev/edgebase/sdk/client/ClientEdgeBaseJvmAuthE2ETest.kt'] },
    { sdk: 'dart', sources: ['packages/sdk/dart/packages/flutter/test/flutter_e2e_test.dart'] },
    { sdk: 'swift', sources: ['packages/sdk/swift/packages/ios/Tests/IosE2ETests.swift'] }
  ]
};

function relExists(relPath) {
  return fs.existsSync(path.join(repoRoot, relPath));
}

function readRel(relPath) {
  if (!sourceCache.has(relPath)) {
    sourceCache.set(relPath, fs.readFileSync(path.join(repoRoot, relPath), 'utf8'));
  }
  return sourceCache.get(relPath);
}

function sortStrings(values) {
  return [...values].sort();
}

function discoverRoleTargets(role) {
  return (discovery[role] ?? [])
    .filter((entry) => entry.sources.every(relExists))
    .map((entry) => entry.sdk)
    .sort();
}

function getCatalogTargets(role) {
  return (catalog.roles?.[role]?.targets ?? []).map((target) => target.sdk).sort();
}

function ensureWorkflowJob(jobName) {
  const pattern = new RegExp(`^\\s{2}${jobName}:\\s*$`, 'm');
  return pattern.test(workflowText);
}

function getRoleTargetMap(role) {
  const declared = catalog.roles?.[role];
  return new Map((declared?.targets ?? []).map((target) => [target.sdk, target]));
}

function normalizeEvidence(role, checkpoint, rawEvidence, targetMap) {
  if (!rawEvidence || typeof rawEvidence !== 'object' || Array.isArray(rawEvidence)) {
    throw new Error(`Role '${role}' checkpoint '${checkpoint}' must define an evidence object.`);
  }

  const entries = rawEvidence.entries;
  if (!Array.isArray(entries)) {
    throw new Error(`Role '${role}' checkpoint '${checkpoint}' must define an entries array.`);
  }

  const reason = rawEvidence.reason;
  if (entries.length === 0 && typeof reason !== 'string') {
    throw new Error(
      `Role '${role}' checkpoint '${checkpoint}' has no evidence entries and must declare a reason.`
    );
  }

  const coveredTargets = new Set();
  for (const [index, entry] of entries.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Role '${role}' checkpoint '${checkpoint}' entry #${index + 1} must be an object.`);
    }

    const { sdk, source, pattern } = entry;
    if (typeof sdk !== 'string' || !targetMap.has(sdk)) {
      throw new Error(`Role '${role}' checkpoint '${checkpoint}' entry #${index + 1} references unknown sdk '${sdk}'.`);
    }
    if (typeof source !== 'string') {
      throw new Error(`Role '${role}' checkpoint '${checkpoint}' entry #${index + 1} must define a source.`);
    }
    if (!relExists(source)) {
      throw new Error(`Role '${role}' checkpoint '${checkpoint}' entry #${index + 1} references missing source '${source}'.`);
    }

    const target = targetMap.get(sdk);
    if (!target.sources.includes(source)) {
      throw new Error(
        `Role '${role}' checkpoint '${checkpoint}' entry #${index + 1} uses source '${source}' outside target '${sdk}' sources.`
      );
    }

    if (typeof pattern !== 'string' || pattern.length === 0) {
      throw new Error(`Role '${role}' checkpoint '${checkpoint}' entry #${index + 1} must define a non-empty pattern.`);
    }
    if (!readRel(source).includes(pattern)) {
      throw new Error(
        `Role '${role}' checkpoint '${checkpoint}' entry #${index + 1} pattern not found in '${source}': ${pattern}`
      );
    }

    coveredTargets.add(sdk);
  }

  const missingTargets = sortStrings([...targetMap.keys()].filter((sdk) => !coveredTargets.has(sdk)));
  const status = entries.length === 0 ? 'gap' : missingTargets.length === 0 ? 'covered' : 'partial';

  return {
    status,
    reason,
    coveredTargets: sortStrings(coveredTargets),
    missingTargets
  };
}

function verifyRole(role) {
  const declared = catalog.roles?.[role];
  if (!declared) {
    throw new Error(`Unknown role '${role}' in catalog.`);
  }

  const discoveredTargets = discoverRoleTargets(role);
  const catalogTargets = getCatalogTargets(role);

  if (JSON.stringify(discoveredTargets) !== JSON.stringify(catalogTargets)) {
    throw new Error(
      [
        `Role '${role}' target drift detected.`,
        `  discovered: ${discoveredTargets.join(', ') || '(none)'}`,
        `  catalog:    ${catalogTargets.join(', ') || '(none)'}`
      ].join('\n')
    );
  }

  for (const target of declared.targets) {
    if (!ensureWorkflowJob(target.job)) {
      throw new Error(`Role '${role}' target '${target.sdk}' references missing workflow job '${target.job}'.`);
    }
    for (const source of target.sources) {
      if (!relExists(source)) {
        throw new Error(`Role '${role}' target '${target.sdk}' references missing source '${source}'.`);
      }
    }
  }

  const evidence = declared.evidence ?? {};
  const checkpointSet = new Set(declared.checkpoints);

  for (const checkpoint of declared.checkpoints) {
    if (!(checkpoint in evidence)) {
      throw new Error(`Role '${role}' checkpoint '${checkpoint}' is missing an evidence declaration.`);
    }
  }

  for (const checkpoint of Object.keys(evidence)) {
    if (!checkpointSet.has(checkpoint)) {
      throw new Error(`Role '${role}' evidence declares unknown checkpoint '${checkpoint}'.`);
    }
  }

  const targetMap = getRoleTargetMap(role);
  const checkpoints = declared.checkpoints.map((checkpoint) => ({
    checkpoint,
    ...normalizeEvidence(role, checkpoint, evidence[checkpoint], targetMap)
  }));

  return {
    role,
    targets: declared.targets.map((target) => `${target.sdk}:${target.mode}`),
    checkpoints
  };
}

function printSummary(results) {
  for (const result of results) {
    const counts = result.checkpoints.reduce(
      (acc, checkpoint) => {
        acc[checkpoint.status] += 1;
        return acc;
      },
      { covered: 0, partial: 0, gap: 0 }
    );

    console.log(
      `${result.role}: targets=${result.targets.join(', ')} | checkpoints covered=${counts.covered} partial=${counts.partial} gap=${counts.gap}`
    );

    for (const checkpoint of result.checkpoints) {
      const coverage = checkpoint.coveredTargets.length > 0 ? checkpoint.coveredTargets.join(', ') : '(none)';
      const missing = checkpoint.missingTargets.length > 0 ? checkpoint.missingTargets.join(', ') : '(none)';
      const suffix = checkpoint.reason ? ` | reason: ${checkpoint.reason}` : '';
      console.log(
        `  - ${checkpoint.checkpoint}: ${checkpoint.status} | covered=${coverage} | missing=${missing}${suffix}`
      );
    }
  }
}

const [, , command = 'verify', roleArg] = process.argv;

if (command === 'summary') {
  const roles = roleArg ? [roleArg] : Object.keys(catalog.roles);
  const results = roles.map((role) => verifyRole(role));
  printSummary(results);
  process.exit(0);
}

if (command === 'verify' && roleArg) {
  const result = verifyRole(roleArg);
  printSummary([result]);
  process.exit(0);
}

if (command === 'verify') {
  const results = Object.keys(catalog.roles).map((role) => verifyRole(role));
  printSummary(results);
  process.exit(0);
}

console.error(`Unknown command '${command}'. Use 'verify' or 'summary'.`);
process.exit(1);
