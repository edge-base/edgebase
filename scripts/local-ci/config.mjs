import path from 'node:path';

export const RECEIPT_SCHEMA = 2;
export const ACT_VERSION = '0.2.89';
export const ACT_DOWNLOADS = Object.freeze({
  'darwin-arm64': {
    archive: `act_Darwin_arm64.tar.gz`,
    sha256: '48ae218af96725f7635a66de2b87e1e346893b02add0f16b92f560296b2151fc',
  },
  'darwin-x64': {
    archive: `act_Darwin_x86_64.tar.gz`,
    sha256: '41b31488e7c254baec31cce12c7dade3e35973b8a31b9486206ad43f233d814e',
  },
  'linux-arm64': {
    archive: `act_Linux_arm64.tar.gz`,
    sha256: 'daa8679ba9615a74d2d0cec321dc593f21948a2a11bb65862b063d8b930f4bcb',
  },
  'linux-x64': {
    archive: `act_Linux_x86_64.tar.gz`,
    sha256: '0191d6f1f3b716b5c55820032605d05fc3c1cdbf581ebeff655019e5dd1524c0',
  },
});

// The act runner is an immutable acquisition cache. Every actual job still gets
// a fresh linux/amd64 container, filesystem and network.
export const ACT_RUNNER_IMAGE =
  'ghcr.io/catthehacker/ubuntu:act-24.04@sha256:3df22cd190b95d9c79b5067a9a4d3d8007183670eafbb70bbbc19d654347e8c4';

export const POSTGRES_IMAGE =
  'postgres:16-alpine@sha256:7a396fd264a2067788b6551122b50f162bf6136312c7fc9d74381cb92c648382';
export const SEMGREP_IMAGE =
  'semgrep/semgrep:1.169.0@sha256:a40de619d5f2ede141f64ce73a1e8a5b2b00ca32e607fb20c8f6671f3190e604';

export const REQUIRED_IMAGES = Object.freeze([ACT_RUNNER_IMAGE, POSTGRES_IMAGE, SEMGREP_IMAGE]);

export const WORKFLOW_PATHS = Object.freeze([
  '.github/workflows/agent-skills-sync.yml',
  '.github/workflows/ci.yml',
  '.github/workflows/codeql.yml',
  '.github/workflows/go-split-sync.yml',
  '.github/workflows/npm-publish.yml',
  '.github/workflows/php-split-sync.yml',
  '.github/workflows/pipeline.yml',
  '.github/workflows/secret-scan.yml',
  '.github/workflows/semgrep.yml',
  '.github/workflows/swift-split-sync.yml',
  '.github/workflows/test.yml',
]);

export const RUNNER_PATHS = Object.freeze([
  'AGENT.md',
  'AGENTS.md',
  'package.json',
  'packages/server/mutation-targets.mjs',
  'packages/server/scripts/filter-mutation-files.mjs',
  'packages/server/stryker.config.mjs',
  'scripts/local-ci',
]);

export function stateDir(repoRoot) {
  return path.join(repoRoot, '.edgebase', 'local-linux-ci');
}

export function receiptPath(repoRoot) {
  return path.join(stateDir(repoRoot), 'receipt.json');
}
