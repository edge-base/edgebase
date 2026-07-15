import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ACT_VERSION, WORKFLOW_PATHS } from './config.mjs';
import { needsAmd64EmulationLimit, pnpmStoreVolumeName } from './act-job.mjs';
import {
  FULL_GATE_JOB_IDS,
  LOCAL_CI_JOBS,
  REMOTE_ONLY_WORKFLOW_JOBS,
  VIRTUAL_WORKFLOW_JOBS,
} from './jobs.mjs';
import {
  mutationFileList,
  parsePrePushInput,
  schedulerCapacity,
  validateReceiptShape,
} from './lib.mjs';
import { runWeightedJobs } from './scheduler.mjs';
import { listTopLevelJobs, renderStandaloneWorkflow } from './workflow.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('every public workflow job has an explicit local, virtual, or remote-only disposition', async () => {
  const workflowNames = (await readdir(path.join(repoRoot, '.github/workflows')))
    .filter((name) => /\.ya?ml$/.test(name))
    .sort();
  assert.deepEqual(
    WORKFLOW_PATHS,
    workflowNames.map((name) => `.github/workflows/${name}`),
    'workflow digest inventory must include every public workflow',
  );
  for (const name of workflowNames) {
    const workflow = `.github/workflows/${name}`;
    const source = await readFile(path.join(repoRoot, workflow), 'utf8');
    const actual = listTopLevelJobs(source).sort();
    const local = LOCAL_CI_JOBS.filter((job) => job.workflow === workflow).map(
      (job) => job.sourceJob,
    );
    const classified = [
      ...new Set([
        ...local,
        ...(VIRTUAL_WORKFLOW_JOBS[workflow] ?? []),
        ...(REMOTE_ONLY_WORKFLOW_JOBS[workflow] ?? []),
      ]),
    ].sort();
    assert.deepEqual(classified, actual, `${workflow} job coverage changed`);
  }
});

test('Linux matrices cover both Node versions and every Linux/macOS SDK matrix', () => {
  const nodeVersions = LOCAL_CI_JOBS.filter((job) => job.sourceJob === 'ci-node')
    .map((job) => job.matrix['node-version'])
    .sort();
  assert.deepEqual(nodeVersions, ['22', '24']);

  const linuxMatrixJobs = [
    'compatibility-node',
    'pack-smoke',
    'sdk-python',
    'sdk-js-unit',
    'sdk-kotlin-unit',
    'sdk-java-unit',
    'sdk-dart-unit',
    'sdk-rust-unit',
    'sdk-csharp-unit',
    'sdk-go-unit',
    'sdk-react-native-unit',
    'sdk-js-e2e',
    'sdk-go-e2e',
    'sdk-python-e2e',
    'sdk-react-native-e2e',
  ];
  for (const sourceJob of linuxMatrixJobs) {
    assert.ok(
      LOCAL_CI_JOBS.some((job) => job.sourceJob === sourceJob && job.matrix.os === 'ubuntu-latest'),
      `${sourceJob} has no local ubuntu-latest expansion`,
    );
  }
});

test('standalone workflows remove orchestration dependencies and GitHub-only uploads', async () => {
  const testSource = await readFile(path.join(repoRoot, '.github/workflows/test.yml'), 'utf8');
  const e2e = renderStandaloneWorkflow(testSource, 'sdk-js-e2e', 'sdk-js-e2e-linux');
  assert.deepEqual(listTopLevelJobs(e2e), ['sdk-js-e2e']);
  assert.doesNotMatch(e2e, /^    needs:/m);
  assert.match(e2e, /run-with-services\.mjs/);

  const ciSource = await readFile(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const docker = renderStandaloneWorkflow(ciSource, 'docker-smoke', 'docker-smoke-linux');
  assert.doesNotMatch(docker, /name: Upload container security evidence/);
  assert.match(docker, /name: Block fixable HIGH and CRITICAL vulnerabilities/);
  assert.match(ciSource, /name: Generate verified-image SBOM[\s\S]*version: v0\.70\.0/);
  assert.match(docker, /name: Install Trivy for local CI/);
  assert.match(
    docker,
    /raw\.githubusercontent\.com\/aquasecurity\/trivy\/75c4dc0f45c5d7ffd05ae26df1e0c666787bdf2a\/contrib\/install\.sh/,
  );
  assert.match(docker, /setup-trivy v0\.70\.0/);
  assert.match(docker, /EDGEBASE_LOCAL_CI_EMULATED_AMD64/);
  assert.match(docker, /RUNNER_ARCH/);
  assert.match(docker, /ARM64\) trivy_arch=arm64/);
  assert.match(docker, /ARCH=\\\$\(uname_arch\)/);
  assert.match(
    docker,
    /name: Generate verified-image SBOM[\s\S]*skip-setup-trivy: 'true'[\s\S]*version: v0\.70\.0/,
  );
  assert.doesNotMatch(docker, /token-setup-trivy:/);

  const kotlin = renderStandaloneWorkflow(testSource, 'sdk-kotlin-unit', 'sdk-kotlin-unit-linux');
  assert.match(kotlin, /android-actions\/setup-android@9fc6c4e9069bf8d3d10b2204b1fb8f6ef7065407/);
  assert.match(kotlin, /platform-tools platforms;android-34 build-tools;34\.0\.0/);

  const semgrepSource = await readFile(
    path.join(repoRoot, '.github/workflows/semgrep.yml'),
    'utf8',
  );
  const semgrep = renderStandaloneWorkflow(semgrepSource, 'scan', 'semgrep-high-severity');
  assert.doesNotMatch(semgrep, /name: Upload Semgrep SARIF/);
  assert.match(semgrep, /name: Block PR on high-severity Semgrep findings/);

  const mutation = renderStandaloneWorkflow(testSource, 'mutation-test', 'mutation-test');
  assert.match(mutation, /name: Build shared package/);
  assert.match(mutation, /name: Build JS SDK core package/);
  assert.match(mutation, /EDGEBASE_LOCAL_CI_MUTATE_FILES is required in local CI/);
  assert.match(mutation, /CHANGED="\$\{EDGEBASE_LOCAL_CI_MUTATE_FILES\}"/);
  assert.doesNotMatch(mutation, /CHANGED=\$\(git diff/);
});

test('mutation file discovery preserves only configured Stryker targets', () => {
  assert.equal(
    mutationFileList(
      [
        'packages/server/src/lib/version.ts',
        'packages/server/src/database-live-do.ts',
        'packages/server/src/lib/errors.ts',
        'packages/web/src/index.ts',
      ].join('\n'),
    ),
    'src/lib/errors.ts',
  );
  assert.throws(
    () => mutationFileList('packages/server/src/lib/unsafe,name.ts'),
    /cannot contain commas/,
  );
});

test('PostgreSQL service uses its isolated bridge-network hostname locally', async () => {
  const source = await readFile(path.join(repoRoot, '.github/workflows/test.yml'), 'utf8');
  const rendered = renderStandaloneWorkflow(source, 'server-unit', 'server-unit', {
    jobContainerImage: 'example.invalid/runner@sha256:deadbeef',
    postgresImage: 'postgres:16-alpine@sha256:cafebabe',
  });
  assert.match(rendered, /@postgres:5432\/edgebase_test/);
  assert.doesNotMatch(rendered, /@127\.0\.0\.1:5432\/edgebase_test/);
  assert.match(rendered, /container: example\.invalid\/runner@sha256:deadbeef/);
  assert.match(rendered, /image: postgres:16-alpine@sha256:cafebabe/);
  assert.match(rendered, /^    services:/m);

  const dryRun = renderStandaloneWorkflow(source, 'server-unit', 'server-unit', {
    dryRun: true,
    jobContainerImage: 'example.invalid/runner@sha256:deadbeef',
  });
  assert.doesNotMatch(dryRun, /^    services:/m);
});

test('weighted scheduler respects capacity, locks, and dependencies', async () => {
  const jobs = [
    { id: 'a', weight: 2, locks: ['shared'], needs: [] },
    { id: 'b', weight: 2, locks: ['shared'], needs: [] },
    { id: 'c', weight: 1, locks: [], needs: ['a'] },
    { id: 'd', weight: 1, locks: [], needs: [] },
  ];
  let weight = 0;
  let peak = 0;
  const activeLocks = new Set();
  const results = await runWeightedJobs(jobs, {
    maxJobs: 3,
    maxWeight: 3,
    async execute(job) {
      weight += job.weight;
      peak = Math.max(peak, weight);
      for (const lock of job.locks) {
        assert.ok(!activeLocks.has(lock));
        activeLocks.add(lock);
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
      weight -= job.weight;
      for (const lock of job.locks) activeLocks.delete(lock);
      return job.id;
    },
  });
  assert.ok(peak <= 3);
  assert.deepEqual(
    [...results.values()].map((result) => result.state),
    ['success', 'success', 'success', 'success'],
  );
});

test('Docker capacity keeps the local gate sequential at every supported size', () => {
  assert.deepEqual(schedulerCapacity(4, 7.7), { maxWeight: 4, maxJobs: 1 });
  assert.deepEqual(schedulerCapacity(8, 15.7), { maxWeight: 8, maxJobs: 1 });
  assert.deepEqual(schedulerCapacity(10, 64), { maxWeight: 8, maxJobs: 1 });
  assert.deepEqual(schedulerCapacity(2, 3.7), { maxWeight: 2, maxJobs: 1 });
});

test('eight-point local capacity still runs heavy and light jobs one at a time', async () => {
  let activeWeight = 0;
  let peakWeight = 0;
  let peakJobs = 0;
  const active = new Set();
  await runWeightedJobs(
    [
      { id: 'heavy-a', weight: 4, locks: [], needs: [] },
      { id: 'heavy-b', weight: 4, locks: [], needs: [] },
      { id: 'light', weight: 1, locks: [], needs: [] },
    ],
    {
      maxJobs: schedulerCapacity(8, 15.7).maxJobs,
      maxWeight: 8,
      async execute(job) {
        active.add(job.id);
        activeWeight += job.weight;
        peakJobs = Math.max(peakJobs, active.size);
        peakWeight = Math.max(peakWeight, activeWeight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active.delete(job.id);
        activeWeight -= job.weight;
      },
    },
  );
  assert.equal(peakWeight, 4);
  assert.equal(peakJobs, 1);
});

test('weighted scheduler blocks dependants after a failed prerequisite', async () => {
  const results = await runWeightedJobs(
    [
      { id: 'root', weight: 1, locks: [], needs: [] },
      { id: 'child', weight: 1, locks: [], needs: ['root'] },
      { id: 'independent', weight: 1, locks: [], needs: [] },
    ],
    {
      maxJobs: 2,
      maxWeight: 2,
      execute(job) {
        if (job.id === 'root') throw new Error('expected');
      },
    },
  );
  assert.equal(results.get('root').state, 'failed');
  assert.equal(results.get('child').state, 'blocked');
  assert.equal(results.get('independent').state, 'success');
});

test('push receipt validation is exact for SHA, digests, platform, engine, and job set', () => {
  const expected = {
    commit: 'a'.repeat(40),
    tree: 'b'.repeat(40),
    workflowDigest: 'c'.repeat(64),
    runnerDigest: 'd'.repeat(64),
    jobs: FULL_GATE_JOB_IDS,
  };
  const receipt = {
    schema: 1,
    status: 'success',
    platform: 'linux/amd64',
    engine: `act/${ACT_VERSION}`,
    ...expected,
  };
  assert.deepEqual(validateReceiptShape(receipt, expected), []);
  assert.match(
    validateReceiptShape({ ...receipt, commit: 'e'.repeat(40) }, expected).join('\n'),
    /commit/,
  );
  assert.match(validateReceiptShape({ ...receipt, jobs: [] }, expected).join('\n'), /job set/);
});

test('pre-push input parser preserves ref and SHA fields', () => {
  const rows = parsePrePushInput(
    `refs/heads/main ${'a'.repeat(40)} refs/heads/main ${'b'.repeat(40)}\n`,
  );
  assert.deepEqual(rows, [
    {
      localRef: 'refs/heads/main',
      localSha: 'a'.repeat(40),
      remoteRef: 'refs/heads/main',
      remoteSha: 'b'.repeat(40),
    },
  ]);
});

test('pre-push reads stdin as a Node 24-compatible stream', async () => {
  const source = await readFile(path.join(repoRoot, 'scripts/local-ci/pre-push.mjs'), 'utf8');
  assert.match(source, /for await \(const chunk of process\.stdin\)/);
  assert.doesNotMatch(source, /readFile\(0/);
});

test('act jobs keep root and isolated release installs on the same pnpm store', async () => {
  const source = await readFile(path.join(repoRoot, 'scripts/local-ci/act-job.mjs'), 'utf8');
  assert.match(source, /npm_config_store_dir=\/root\/\.local\/share\/pnpm\/store/);
  assert.match(source, /--mount=type=volume,source=\$\{pnpmStoreVolume\}/);
  assert.match(source, /target=\/root\/\.local\/share\/pnpm\/store/);
  assert.match(source, /EDGEBASE_LOCAL_CI_MUTATE_FILES=\$\{context\.mutationFiles\}/);
});

test('pnpm cache volumes are deterministic and isolated per workflow and job', () => {
  const first = pnpmStoreVolumeName('workflow-a', 'ci-node-22');
  assert.match(first, /^edgebase-lci-pnpm-[a-f0-9]{32}$/);
  assert.equal(first, pnpmStoreVolumeName('workflow-a', 'ci-node-22'));
  assert.notEqual(first, pnpmStoreVolumeName('workflow-a', 'ci-node-24'));
  assert.notEqual(first, pnpmStoreVolumeName('workflow-b', 'ci-node-22'));
});

test('nested Docker smoke probes its child container on the isolated job network', async () => {
  const runner = await readFile(path.join(repoRoot, 'scripts/local-ci/act-job.mjs'), 'utf8');
  const smoke = await readFile(
    path.join(repoRoot, 'packages/cli/scripts/docker-smoke.mjs'),
    'utf8',
  );
  assert.match(runner, /EDGEBASE_DOCKER_SMOKE_NETWORK=\$\{network\}/);
  assert.match(smoke, /process\.env\.EDGEBASE_DOCKER_SMOKE_NETWORK/);
  assert.match(smoke, /\['--network', dockerNetwork\]/);
  assert.match(smoke, /dockerNetwork \? containerName : '127\.0\.0\.1'/);
});

test('Go concurrency is limited only while amd64 jobs are emulated', () => {
  assert.equal(needsAmd64EmulationLimit('aarch64'), true);
  assert.equal(needsAmd64EmulationLimit('arm64'), true);
  assert.equal(needsAmd64EmulationLimit('amd64'), false);
  assert.equal(needsAmd64EmulationLimit('x86_64'), false);
});

test('isolated local release checks retain hosted timeouts outside local CI', async () => {
  const runner = await readFile(path.join(repoRoot, 'scripts/local-ci/act-job.mjs'), 'utf8');
  const releaseTest = await readFile(
    path.join(repoRoot, 'scripts/release-version.test.mjs'),
    'utf8',
  );
  const serverTimeout = await readFile(
    path.join(repoRoot, 'packages/server/vitest-local-ci-timeout.ts'),
    'utf8',
  );
  const cliUnitConfig = await readFile(
    path.join(repoRoot, 'packages/cli/vitest.config.ts'),
    'utf8',
  );
  const cliPackagingTest = await readFile(
    path.join(repoRoot, 'packages/cli/test/packaging.test.ts'),
    'utf8',
  );
  const serverUnitConfig = await readFile(
    path.join(repoRoot, 'packages/server/vitest.unit.config.ts'),
    'utf8',
  );
  const ownershipTest = await readFile(
    path.join(
      repoRoot,
      'packages/server/src/__tests__/integration-harness-process-ownership.test.ts',
    ),
    'utf8',
  );
  assert.match(runner, /EDGEBASE_LOCAL_CI_EMULATED_AMD64=1/);
  assert.match(releaseTest, /process\.env\.LOCAL_CI === '1'/);
  assert.match(releaseTest, /EDGEBASE_LOCAL_CI_EMULATED_AMD64 === '1'/);
  assert.match(releaseTest, /timeout: localCiTimeout\(120_000\)/);
  assert.match(serverTimeout, /process\.env\.LOCAL_CI === '1'/);
  assert.match(serverTimeout, /EDGEBASE_LOCAL_CI_EMULATED_AMD64 === '1'/);
  assert.match(serverTimeout, /milliseconds \* 3/);
  assert.match(cliUnitConfig, /process\.env\.LOCAL_CI === '1'/);
  assert.match(cliUnitConfig, /\? 180_000/);
  assert.match(cliUnitConfig, /\? 60_000/);
  assert.match(cliUnitConfig, /: 20_000/);
  assert.match(cliPackagingTest, /process\.env\.LOCAL_CI === '1' \? 180_000 : 60_000/);
  assert.match(cliPackagingTest, /}, packagingTestTimeout\);/);
  assert.match(serverUnitConfig, /testTimeout: localCiTimeout\(5_000\)/);
  assert.match(serverUnitConfig, /hookTimeout: localCiTimeout\(10_000\)/);
  assert.match(ownershipTest, /timeoutMs = localCiTimeout\(5_000\)/);
  assert.equal((ownershipTest.match(/localCiTimeout\(10_000\)/g) ?? []).length, 2);
});
