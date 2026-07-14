const ci = '.github/workflows/ci.yml';
const test = '.github/workflows/test.yml';

function job(id, workflow, sourceJob, options = {}) {
  return Object.freeze({
    id,
    workflow,
    sourceJob,
    event: 'workflow_dispatch',
    matrix: {},
    needs: [],
    weight: 1,
    locks: [],
    ...options,
  });
}

const serverDependent = [
  ['sdk-js-e2e-linux', 'sdk-js-e2e', 3, { os: 'ubuntu-latest' }],
  ['sdk-go-e2e-linux', 'sdk-go-e2e', 2, { os: 'ubuntu-latest' }],
  ['sdk-python-e2e-linux', 'sdk-python-e2e', 2, { os: 'ubuntu-latest' }],
  ['sdk-react-native-e2e-linux', 'sdk-react-native-e2e', 3, { os: 'ubuntu-latest' }],
  ['sdk-java-e2e-linux', 'sdk-java-e2e', 3],
  ['sdk-kotlin-e2e-linux', 'sdk-kotlin-e2e', 3],
  ['sdk-dart-e2e-linux', 'sdk-dart-e2e', 3],
  ['sdk-rust-e2e-linux', 'sdk-rust-e2e', 2],
  ['sdk-csharp-e2e-linux', 'sdk-csharp-e2e', 2],
  ['sdk-php-e2e-linux', 'sdk-php-e2e', 2],
  ['sdk-elixir-e2e-linux', 'sdk-elixir-e2e', 2],
  ['sdk-scala-e2e-linux', 'sdk-scala-e2e', 3],
  ['sdk-ruby-e2e-linux', 'sdk-ruby-e2e', 2],
  ['sdk-cpp-e2e-linux', 'sdk-cpp-e2e', 4],
].map(([id, sourceJob, weight, matrix = {}]) =>
  job(id, test, sourceJob, { weight, matrix, needs: ['server-unit'] }),
);

export const LOCAL_CI_JOBS = Object.freeze([
  job('release-version-check', ci, 'release-version-check', {
    weight: 4,
    locks: ['release-packaging'],
  }),
  job('ci-node-22', ci, 'ci-node', {
    weight: 3,
    matrix: { 'node-version': '22' },
    locks: ['ci-node'],
  }),
  job('ci-node-24', ci, 'ci-node', {
    weight: 3,
    matrix: { 'node-version': '24' },
    locks: ['ci-node'],
  }),
  job('compatibility-node-linux', ci, 'compatibility-node', {
    weight: 3,
    matrix: { os: 'ubuntu-latest' },
  }),
  job('docker-smoke-linux', ci, 'docker-smoke', {
    weight: 4,
    locks: ['docker-daemon'],
  }),
  job('pack-smoke-linux', ci, 'pack-smoke', {
    weight: 3,
    matrix: { os: 'ubuntu-latest' },
  }),
  job('sdk-python-unit-linux', ci, 'sdk-python', {
    matrix: { os: 'ubuntu-latest' },
  }),

  job('server-unit', test, 'server-unit', {
    weight: 4,
    locks: ['postgres-service'],
  }),
  job('generated-code-check', test, 'generated-code-check', { weight: 2 }),
  job('sdk-js-unit-linux', test, 'sdk-js-unit', {
    weight: 2,
    matrix: { os: 'ubuntu-latest' },
  }),
  job('sdk-kotlin-unit-linux', test, 'sdk-kotlin-unit', {
    weight: 2,
    matrix: { os: 'ubuntu-latest' },
  }),
  job('sdk-java-unit-linux', test, 'sdk-java-unit', {
    weight: 2,
    matrix: { os: 'ubuntu-latest' },
  }),
  job('sdk-dart-unit-linux', test, 'sdk-dart-unit', {
    weight: 3,
    matrix: { os: 'ubuntu-latest' },
  }),
  job('sdk-rust-unit-linux', test, 'sdk-rust-unit', {
    matrix: { os: 'ubuntu-latest' },
  }),
  job('sdk-csharp-unit-linux', test, 'sdk-csharp-unit', {
    weight: 2,
    matrix: { os: 'ubuntu-latest' },
  }),
  job('sdk-go-unit-linux', test, 'sdk-go-unit', {
    matrix: { os: 'ubuntu-latest' },
  }),
  job('sdk-react-native-unit-linux', test, 'sdk-react-native-unit', {
    weight: 2,
    matrix: { os: 'ubuntu-latest' },
  }),
  ...serverDependent,
  job('sdk-role-contract-catalog', test, 'sdk-role-contract-catalog'),
  job('openapi-check', test, 'openapi-check', {
    weight: 3,
    needs: ['server-unit'],
  }),
  job('mutation-test', test, 'mutation-test', {
    event: 'pull_request',
    weight: 4,
    locks: ['mutation'],
  }),
  job('bench', test, 'bench', {
    event: 'pull_request',
    weight: 3,
    needs: ['server-unit'],
  }),
  job('semgrep-high-severity', '.github/workflows/semgrep.yml', 'scan', {
    event: 'pull_request',
    weight: 2,
  }),
  job('gitleaks-history', '.github/workflows/secret-scan.yml', 'gitleaks-history', {
    event: 'push',
  }),
]);

export const VIRTUAL_WORKFLOW_JOBS = Object.freeze({
  '.github/workflows/test.yml': [
    'sdk-admin-contract',
    'sdk-core-contract',
    'sdk-client-contract',
    'sdk-client-auth-verify-contract',
    'test-summary',
  ],
});

export const REMOTE_ONLY_WORKFLOW_JOBS = Object.freeze({
  '.github/workflows/ci.yml': ['sdk-swift'],
  '.github/workflows/test.yml': ['sdk-swift-e2e'],
  '.github/workflows/codeql.yml': ['analyze'],
  '.github/workflows/agent-skills-sync.yml': ['sync'],
  '.github/workflows/go-split-sync.yml': ['sync'],
  '.github/workflows/npm-publish.yml': ['publish'],
  '.github/workflows/php-split-sync.yml': ['sync'],
  '.github/workflows/pipeline.yml': ['ci', 'test', 'semgrep', 'codeql'],
  '.github/workflows/swift-split-sync.yml': ['resolve', 'sync-core', 'sync-client'],
});

export const FULL_GATE_JOB_IDS = Object.freeze(LOCAL_CI_JOBS.map((entry) => entry.id));

export function findLocalCiJob(id) {
  return LOCAL_CI_JOBS.find((entry) => entry.id === id);
}
