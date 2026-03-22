#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
const catalogPath = path.join(repoRoot, 'packages/sdk/contracts/role-contracts.json');
const workflowPath = path.join(repoRoot, '.github/workflows/test.yml');

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const workflowText = fs.readFileSync(workflowPath, 'utf8');

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
    { sdk: 'js', sources: ['packages/sdk/js/test/web.e2e.test.ts'] },
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

function discoverRoleTargets(role) {
  return (discovery[role] ?? [])
    .filter(entry => entry.sources.every(relExists))
    .map(entry => entry.sdk)
    .sort();
}

function getCatalogTargets(role) {
  return (catalog.roles?.[role]?.targets ?? []).map(target => target.sdk).sort();
}

function ensureWorkflowJob(jobName) {
  const pattern = new RegExp(`^\\s{2}${jobName}:\\s*$`, 'm');
  return pattern.test(workflowText);
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
}

function printSummary() {
  for (const [role, spec] of Object.entries(catalog.roles)) {
    const targets = spec.targets.map(target => `${target.sdk}:${target.mode}`).join(', ');
    console.log(`${role}: ${targets}`);
  }
}

const [, , command = 'verify', roleArg] = process.argv;

if (command === 'summary') {
  printSummary();
  process.exit(0);
}

if (command === 'verify' && roleArg) {
  verifyRole(roleArg);
  console.log(`verified role '${roleArg}'`);
  process.exit(0);
}

if (command === 'verify') {
  for (const role of Object.keys(catalog.roles)) {
    verifyRole(role);
  }
  printSummary();
  process.exit(0);
}

console.error(`Unknown command '${command}'. Use 'verify' or 'summary'.`);
process.exit(1);
