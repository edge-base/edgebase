import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(REPO_ROOT, path), 'utf8');

test('Docker runtime uses immutable audited inputs and a self-hosted trust mode', () => {
  const dockerfile = read('Dockerfile');
  assert.match(
    dockerfile,
    /^FROM node:22-slim@sha256:[a-f0-9]{64}$/m,
    'Node base image must use a multi-arch digest, not a mutable tag',
  );
  assert.match(dockerfile, /npm install -g npm@\d+\.\d+\.\d+/);
  assert.match(dockerfile, /npm install -g wrangler@\d+\.\d+\.\d+/);
  assert.match(
    dockerfile,
    /apt-get install -y --no-install-recommends ca-certificates/,
    'Docker runtimes must trust public HTTPS APIs through the system CA bundle',
  );
  assert.match(
    dockerfile,
    /VOLUME \["\/data"\]/,
    'Docker runtimes must create a data volume when the operator does not map one explicitly',
  );
  assert.doesNotMatch(dockerfile, /\bcorepack\b|\bpnpm@/);
  assert.match(dockerfile, /export EDGEBASE_RUNTIME_MODE=self-hosted/);
  assert.match(dockerfile, /ENV EDGEBASE_RUNTIME_MODE=self-hosted/);
});

test('every runtime target pins the client-IP trust boundary', () => {
  assert.match(read('packages/cli/src/commands/deploy.ts'), /runtimeMode: 'cloudflare'/);
  assert.match(read('packages/cli/src/commands/dev.ts'), /EDGEBASE_RUNTIME_MODE:local-development/);
  assert.match(read('packages/cli/src/commands/docker.ts'), /runtimeMode: 'self-hosted'/);
  const pack = read('packages/cli/src/lib/pack.ts');
  assert.match(pack, /runtimeMode: 'self-hosted'/);
  assert.match(pack, /mergedEnv\.EDGEBASE_RUNTIME_MODE = 'self-hosted'/);
});

test('CI scans the exact runtime-tested image and blocks fixable severe findings', () => {
  const workflow = read('.github/workflows/ci.yml');
  assert.match(workflow, /EDGEBASE_KEEP_DOCKER_SMOKE_IMAGE: '1'/);
  assert.match(workflow, /format: cyclonedx/);
  assert.match(workflow, /edgebase-docker-sbom\.cdx\.json/);
  assert.match(workflow, /edgebase-docker-vulnerabilities\.json/);
  assert.match(
    workflow,
    /name: Block fixable HIGH and CRITICAL vulnerabilities[\s\S]*?exit-code: '1'[\s\S]*?ignore-unfixed: 'true'[\s\S]*?severity: HIGH,CRITICAL/,
  );
  assert.match(workflow, /name: Remove scanned image\n\s+if: always\(\)/);
});

test('workflow containers and every external action are immutable', () => {
  assert.match(
    read('.github/workflows/semgrep.yml'),
    /image: semgrep\/semgrep:\d+\.\d+\.\d+@sha256:[a-f0-9]{64}/,
  );

  const workflowsDir = resolve(REPO_ROOT, '.github/workflows');
  for (const filename of readdirSync(workflowsDir).filter((name) => /\.ya?ml$/.test(name))) {
    const workflow = readFileSync(join(workflowsDir, filename), 'utf8');
    for (const [index, line] of workflow.split(/\r?\n/).entries()) {
      const imageMatch = line.match(/^\s*image:\s*([^\s#]+)/);
      if (imageMatch) {
        assert.match(
          imageMatch[1],
          /@sha256:[a-f0-9]{64}$/,
          `${filename}:${index + 1} must pin container images to an immutable digest`,
        );
      }

      const actionMatch = line.match(/\buses:\s*([^\s#]+)/);
      if (
        !actionMatch ||
        actionMatch[1].startsWith('./') ||
        actionMatch[1].startsWith('docker://')
      ) {
        continue;
      }
      assert.match(
        actionMatch[1],
        /@[a-f0-9]{40}$/,
        `${filename}:${index + 1} must pin external actions to a full commit SHA`,
      );
    }
  }
});

test('secret scanning covers protected branches and all fetched history', () => {
  const workflow = read('.github/workflows/secret-scan.yml');
  assert.match(workflow, /push:\n\s+branches: \[main, develop\]/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /echo "[a-f0-9]{64}  \$RUNNER_TEMP\/\$archive"/);
  assert.match(workflow, /sha256sum --check --strict/);
  assert.match(workflow, /gitleaks git --redact --log-opts=--all/);
});

test('Dependabot covers workflow, Docker, workspace, and maintained SDK ecosystems', () => {
  const config = read('.github/dependabot.yml');
  for (const ecosystem of [
    'github-actions',
    'docker',
    'npm',
    'cargo',
    'gomod',
    'pip',
    'pub',
    'composer',
    'gradle',
    'nuget',
    'swift',
    'mix',
  ]) {
    assert.match(config, new RegExp(`package-ecosystem: ${ecosystem}\\b`));
  }
  assert.match(config, /package-ecosystem: docker\n\s+directory: \//);
  assert.match(config, /package-ecosystem: npm\n\s+directory: \//);
});
