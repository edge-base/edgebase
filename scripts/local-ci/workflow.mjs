const JOB_HEADER = /^  ([A-Za-z_][A-Za-z0-9_-]*):\s*$/;
const LOCAL_TRIVY_VERSION = 'v0.70.0';
const TRIVY_INSTALL_SCRIPT_COMMIT = '75c4dc0f45c5d7ffd05ae26df1e0c666787bdf2a';

export function listTopLevelJobs(source) {
  const lines = source.split(/\r?\n/);
  const jobsLine = lines.findIndex((line) => line === 'jobs:');
  if (jobsLine < 0) return [];
  const result = [];
  for (const line of lines.slice(jobsLine + 1)) {
    const match = line.match(JOB_HEADER);
    if (match) result.push(match[1]);
  }
  return result;
}

function removeJobField(lines, field) {
  const result = [];
  let skipping = false;
  for (const line of lines) {
    if (!skipping && line.match(new RegExp(`^    ${field}:`))) {
      skipping = line.trim() === `${field}:`;
      continue;
    }
    if (skipping) {
      const indent = line.match(/^ */)[0].length;
      if (line.trim() !== '' && indent <= 4) skipping = false;
      else continue;
    }
    result.push(line);
  }
  return result;
}

function removeNamedStep(lines, stepName) {
  const result = [];
  let skipping = false;
  for (const line of lines) {
    if (line === `      - name: ${stepName}`) {
      skipping = true;
      continue;
    }
    if (skipping) {
      if (/^      - (name:|uses:)/.test(line)) skipping = false;
      else continue;
    }
    result.push(line);
  }
  return result;
}

function prepareDockerSmokeTrivy(lines) {
  const sbomStep = lines.indexOf('      - name: Generate verified-image SBOM');
  if (sbomStep < 0) {
    throw new Error('Docker smoke workflow has no verified-image SBOM step.');
  }

  const bootstrap = [
    '      - name: Install Trivy for local CI',
    '        shell: bash',
    '        run: |',
    '          install_root="${RUNNER_TEMP}/edgebase-trivy"',
    '          mkdir -p "$install_root/bin"',
    '          curl --fail --location --silent --show-error \\',
    `            https://raw.githubusercontent.com/aquasecurity/trivy/${TRIVY_INSTALL_SCRIPT_COMMIT}/contrib/install.sh \\`,
    '            --output "$install_root/install.sh"',
    '          install_script="$install_root/install.sh"',
    '          if [ "${EDGEBASE_LOCAL_CI_EMULATED_AMD64:-}" = "1" ]; then',
    '            case "${RUNNER_ARCH:-}" in',
    '              ARM64) trivy_arch=arm64 ;;',
    '              X64) trivy_arch=amd64 ;;',
    '              *) echo "Unsupported local Trivy runner architecture: ${RUNNER_ARCH:-unset}" >&2; exit 1 ;;',
    '            esac',
    '            runner_install_script="$install_root/install-runner-arch.sh"',
    '            sed "s/^ARCH=\\$(uname_arch)$/ARCH=${trivy_arch}/" "$install_script" > "$runner_install_script"',
    '            grep -q "^ARCH=${trivy_arch}$" "$runner_install_script"',
    '            install_script="$runner_install_script"',
    '          fi',
    `          bash "$install_script" -b "$install_root/bin" -c setup-trivy ${LOCAL_TRIVY_VERSION}`,
    '          echo "$install_root/bin" >> "$GITHUB_PATH"',
    '',
  ];
  lines.splice(sbomStep, 0, ...bootstrap);

  const renderedSbomStep = lines.indexOf('      - name: Generate verified-image SBOM');
  const nextStep = lines.findIndex(
    (line, index) => index > renderedSbomStep && /^      - (name:|uses:)/.test(line),
  );
  const stepEnd = nextStep < 0 ? lines.length : nextStep;
  const withLine = lines.findIndex(
    (line, index) => index > renderedSbomStep && index < stepEnd && line === '        with:',
  );
  if (withLine < 0) {
    throw new Error('Docker smoke SBOM action has no inputs block.');
  }
  lines.splice(withLine + 1, 0, "          skip-setup-trivy: 'true'");
  return lines;
}

export function renderStandaloneWorkflow(source, sourceJob, localJobId, options = {}) {
  const lines = source.split(/\r?\n/);
  const jobsLine = lines.findIndex((line) => line === 'jobs:');
  if (jobsLine < 0) throw new Error('Workflow has no top-level jobs mapping.');

  const start = lines.findIndex((line, index) => index > jobsLine && line === `  ${sourceJob}:`);
  if (start < 0) throw new Error(`Workflow job ${sourceJob} was not found.`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (JOB_HEADER.test(lines[index])) {
      end = index;
      break;
    }
  }

  const prefix = lines.slice(0, jobsLine + 1);
  if (prefix[0]?.startsWith('name:')) prefix[0] = `name: Local CI - ${localJobId}`;
  let block = removeJobField(lines.slice(start, end), 'needs');

  // Upload transport is GitHub-only. The scanners and artifact generation still
  // run locally; GitHub remains authoritative for SARIF/artifact publication.
  block = removeNamedStep(block, 'Upload Semgrep SARIF');
  block = removeNamedStep(block, 'Upload container security evidence');

  if (sourceJob === 'docker-smoke') {
    block = prepareDockerSmokeTrivy(block);
  }

  if (sourceJob === 'server-unit') {
    if (options.dryRun) block = removeJobField(block, 'services');
    block = block.map((line) =>
      line.replace('@127.0.0.1:5432/edgebase_test', '@postgres:5432/edgebase_test'),
    );
    if (options.jobContainerImage) {
      block.splice(1, 0, `    container: ${options.jobContainerImage}`);
    }
    if (options.postgresImage) {
      block = block.map((line) =>
        line.replace(/postgres:16-alpine@sha256:[a-f0-9]{64}/, options.postgresImage),
      );
    }
  }

  if (sourceJob === 'scan' && options.semgrepImage) {
    block = block.map((line) =>
      line.replace(/semgrep\/semgrep:1\.169\.0@sha256:[a-f0-9]{64}/, options.semgrepImage),
    );
  }

  return `${[...prefix, ...block].join('\n')}\n`;
}
