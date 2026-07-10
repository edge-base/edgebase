import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { checkReleaseVersions } from './check-release-versions.mjs';
import {
  assertPreparedRelease,
  assertReleaseTagAtHead,
} from './release-publish-guard.mjs';
import {
  DART_OPTIONAL_PUBLISH_TARGET_IDS,
  DART_PUBLISH_TARGET_IDS,
  GO_SPLIT_TARGET_IDS,
  HEX_PUBLISH_TARGET_IDS,
  JITPACK_VERIFY_TARGET_IDS,
  NPM_PUBLISH_TARGET_IDS,
  NUGET_PUBLISH_TARGET_IDS,
  PHP_SPLIT_TARGET_IDS,
  PYTHON_OPTIONAL_PUBLISH_TARGET_IDS,
  PYTHON_PUBLISH_TARGET_IDS,
  RELEASE_CHANGELOGS,
  RELEASE_TARGETS,
  RELEASE_VERSION_REFERENCES,
  RUBY_PUBLISH_TARGET_IDS,
  RUST_PUBLISH_TARGET_IDS,
  SWIFT_SPLIT_TARGET_IDS,
} from './release-targets.mjs';
import { getSourceVersion, REPO_ROOT } from './release-version-utils.mjs';
import { syncPhpSplitRelease } from '../dev/release/sync-php-split-release.mjs';
import { syncSwiftSplitRelease } from '../dev/release/sync-swift-split-release.mjs';
import { syncGoSplitRelease } from '../dev/release/sync-go-split-release.mjs';
import { verifyGoSplitRelease } from '../dev/release/verify-go-split-release.mjs';
import { createNpmReleaseWorkspace } from '../dev/release/publish-npm-release.mjs';
import {
  buildJitpackArtifactUrl,
  verifyJitpackRelease,
} from '../dev/release/verify-jitpack-release.mjs';

function withoutConsoleLogs(callback) {
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    return callback();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
}

test('release target ids and paths are unique and publish lists resolve', () => {
  const ids = RELEASE_TARGETS.map((target) => target.id);
  const paths = RELEASE_TARGETS.map((target) => target.path);
  assert.equal(new Set(ids).size, ids.length, 'release target ids must be unique');
  assert.equal(new Set(paths).size, paths.length, 'release target paths must be unique');

  const targetMap = new Map(RELEASE_TARGETS.map((target) => [target.id, target]));
  const routedIds = [
    ...NPM_PUBLISH_TARGET_IDS,
    ...DART_PUBLISH_TARGET_IDS,
    ...DART_OPTIONAL_PUBLISH_TARGET_IDS,
    ...PYTHON_PUBLISH_TARGET_IDS,
    ...PYTHON_OPTIONAL_PUBLISH_TARGET_IDS,
    ...RUST_PUBLISH_TARGET_IDS,
    ...NUGET_PUBLISH_TARGET_IDS,
    ...RUBY_PUBLISH_TARGET_IDS,
    ...HEX_PUBLISH_TARGET_IDS,
    ...PHP_SPLIT_TARGET_IDS,
    ...SWIFT_SPLIT_TARGET_IDS,
    ...GO_SPLIT_TARGET_IDS,
    ...JITPACK_VERIFY_TARGET_IDS,
  ];
  for (const id of routedIds) {
    assert.ok(targetMap.has(id), `release route references unknown target ${id}`);
  }
});

test('npm packages publish after their first-party runtime dependencies', () => {
  const targetsById = new Map(RELEASE_TARGETS.map((target) => [target.id, target]));
  const idsByName = new Map(
    NPM_PUBLISH_TARGET_IDS.map((id) => {
      const target = targetsById.get(id);
      return [target.name, id];
    }),
  );
  const position = new Map(NPM_PUBLISH_TARGET_IDS.map((id, index) => [id, index]));

  for (const id of NPM_PUBLISH_TARGET_IDS) {
    const target = targetsById.get(id);
    const manifest = JSON.parse(readFileSync(resolve(REPO_ROOT, target.path), 'utf8'));
    const dependencies = {
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
    };
    for (const dependencyName of Object.keys(dependencies)) {
      const dependencyId = idsByName.get(dependencyName);
      if (!dependencyId) continue;
      assert.ok(
        position.get(dependencyId) < position.get(id),
        `${target.name} must publish after ${dependencyName}`,
      );
    }
  }
});

test('Node and Wrangler release floors stay aligned with the Docker runtime', () => {
  const nodeEngineManifests = [
    'package.json',
    'docs/package.json',
    'packages/cli/package.json',
    'packages/server/package.json',
    'packages/create-edgebase/package.json',
  ];
  for (const path of nodeEngineManifests) {
    const manifest = JSON.parse(readFileSync(resolve(REPO_ROOT, path), 'utf8'));
    assert.equal(manifest.engines?.node, '>=22.0.0', `${path} must require Node.js 22+`);
  }

  for (const path of ['packages/cli/package.json', 'packages/server/package.json']) {
    const manifest = JSON.parse(readFileSync(resolve(REPO_ROOT, path), 'utf8'));
    const wranglerRange = manifest.dependencies?.wrangler ?? manifest.devDependencies?.wrangler;
    assert.equal(wranglerRange, '4.103.0', `${path} must pin the audited Wrangler build`);
  }

  const serverManifest = JSON.parse(
    readFileSync(resolve(REPO_ROOT, 'packages/server/package.json'), 'utf8'),
  );
  assert.equal(
    serverManifest.devDependencies?.['@cloudflare/workers-types'],
    '4.20260305.1',
    'server must pin the Hono-compatible Workers type snapshot',
  );
  const serverTsconfig = JSON.parse(
    readFileSync(resolve(REPO_ROOT, 'packages/server/tsconfig.json'), 'utf8'),
  );
  assert.deepEqual(
    serverTsconfig.compilerOptions?.types,
    ['@cloudflare/workers-types/2023-07-01'],
    'server must use the dated Workers runtime entrypoint',
  );

  const dockerfile = readFileSync(resolve(REPO_ROOT, 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /^FROM node:22-slim$/m);
  assert.match(dockerfile, /^RUN npm install -g wrangler@4\.103\.0$/m);
});

test('release security audit covers development tooling and keeps patched floors', () => {
  const rootManifest = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'));
  assert.equal(rootManifest.scripts?.['security:audit'], 'pnpm audit --audit-level high');
  assert.equal(rootManifest.devDependencies?.turbo, '^2.9.14');
  assert.deepEqual(
    {
      devalue: rootManifest.pnpm?.overrides?.['devalue@<5.8.1'],
      flatted: rootManifest.pnpm?.overrides?.['flatted@<3.4.2'],
      formData: rootManifest.pnpm?.overrides?.['form-data@>=4.0.0 <4.0.6'],
      tmp: rootManifest.pnpm?.overrides?.['tmp@<0.2.7'],
    },
    {
      devalue: '5.8.1',
      flatted: '3.4.2',
      formData: '4.0.6',
      tmp: '0.2.7',
    },
  );

  const adminManifest = JSON.parse(
    readFileSync(resolve(REPO_ROOT, 'packages/admin/package.json'), 'utf8'),
  );
  assert.equal(adminManifest.devDependencies?.['@sveltejs/kit'], '^2.60.1');
  assert.equal(adminManifest.devDependencies?.svelte, '^5.55.7');
  assert.equal(adminManifest.devDependencies?.vite, '^6.4.3');
  const jsSdkManifest = JSON.parse(
    readFileSync(resolve(REPO_ROOT, 'packages/sdk/js/package.json'), 'utf8'),
  );
  assert.equal(jsSdkManifest.devDependencies?.['happy-dom'], '^20.8.9');

  for (const path of [
    'packages/admin/package.json',
    'packages/cli/package.json',
    'packages/sdk/js/package.json',
    'packages/sdk/js/packages/admin/package.json',
    'packages/sdk/js/packages/auth-ui-react/package.json',
    'packages/sdk/js/packages/core/package.json',
    'packages/sdk/js/packages/web/package.json',
    'packages/sdk/react-native/package.json',
    'packages/server/package.json',
    'packages/shared/package.json',
  ]) {
    const manifest = JSON.parse(readFileSync(resolve(REPO_ROOT, path), 'utf8'));
    assert.equal(manifest.devDependencies?.vitest, '^3.2.6', `${path} must use patched Vitest`);
  }
});

test('C++ CMake project versions are first-class release targets', () => {
  const cmakeTargets = RELEASE_TARGETS.filter((target) => target.strategy === 'cmake-project-version');
  assert.deepEqual(cmakeTargets.map((target) => target.id), [
    'cpp-core-cmake',
    'cpp-unreal-cmake',
  ]);
  for (const target of cmakeTargets) {
    const source = readFileSync(resolve(REPO_ROOT, target.path), 'utf8');
    assert.match(source, new RegExp(`^project\\([^\\n]* VERSION ${getSourceVersion().replaceAll('.', '\\.')} LANGUAGES`, 'm'));
  }
});

test('Go release route matches its public module path', () => {
  const goMod = readFileSync(resolve(REPO_ROOT, 'packages/sdk/go/go.mod'), 'utf8');
  assert.match(goMod, /^module github\.com\/edge-base\/sdk-go$/m);
  assert.deepEqual(GO_SPLIT_TARGET_IDS, ['go-sdk']);
});

test('all release manifests, references, and changelogs match the source version', () => {
  withoutConsoleLogs(() => checkReleaseVersions(getSourceVersion()));
});

test('all generated SDK headers match the versioned OpenAPI source', () => {
  const version = getSourceVersion();
  const spec = JSON.parse(
    readFileSync(resolve(REPO_ROOT, 'packages/server/openapi.json'), 'utf8'),
  );
  assert.equal(spec.info?.version, version);
  assert.equal(
    spec.paths?.['/api/health']?.get?.responses?.['200']?.content?.['application/json']?.schema?.properties?.version?.example,
    version,
    'OpenAPI health response example must match the release version',
  );

  const codegenConfig = JSON.parse(
    readFileSync(resolve(REPO_ROOT, 'tools/sdk-codegen/config.json'), 'utf8'),
  );
  const languageOutputs = Object.values(codegenConfig.languages)
    .flatMap((config) => Object.values(config))
    .filter((value) => typeof value === 'string');
  const wrapperOutputs = Object.values(codegenConfig.wrappers)
    .filter((value) => typeof value === 'string');
  for (const path of [...languageOutputs, ...wrapperOutputs]) {
    const source = readFileSync(resolve(REPO_ROOT, path), 'utf8');
    assert.match(source, new RegExp(`openapi\\.json \\(${version.replaceAll('.', '\\.')}\\)`), path);
  }
});

test('prepared-release guard rejects a mismatched version without mutating source', () => {
  const observedPaths = new Set([
    'package.json',
    ...RELEASE_TARGETS.map((target) => target.path),
    ...RELEASE_VERSION_REFERENCES.map((reference) => reference.path),
    ...RELEASE_CHANGELOGS.map((changelog) => changelog.path),
  ]);
  const before = new Map(
    [...observedPaths].map((path) => [path, readFileSync(resolve(REPO_ROOT, path), 'utf8')]),
  );
  const [major, minor, patch] = getSourceVersion().split('.').map(Number);
  const mismatchedVersion = `${major}.${minor}.${patch + 1}`;

  assert.throws(
    () => withoutConsoleLogs(() => assertPreparedRelease(mismatchedVersion, { dryRun: true })),
    /Release source is .* not/,
  );

  for (const [path, contents] of before) {
    assert.equal(readFileSync(resolve(REPO_ROOT, path), 'utf8'), contents, `${path} was mutated`);
  }
});

test('prepared-release guard fails closed on a dirty publish tree', () => {
  const version = getSourceVersion();
  assert.throws(
    () => withoutConsoleLogs(() => assertPreparedRelease(version, {
      requireClean: true,
      allowDirty: false,
      readWorkingTreeStatus: () => ' M package.json',
    })),
    /git working tree is not clean/,
  );
  assert.deepEqual(
    withoutConsoleLogs(() => assertPreparedRelease(version, {
      requireClean: true,
      allowDirty: false,
      readWorkingTreeStatus: () => '',
      readRevision: () => '0123456789abcdef',
    })),
    { version, clean: true },
  );
});

test('non-dry external release actions require the matching central tag at HEAD', () => {
  const version = getSourceVersion();
  assert.throws(
    () => withoutConsoleLogs(() => assertPreparedRelease(version, {
      requireClean: true,
      readWorkingTreeStatus: () => '',
      readRevision: (ref) => ref === 'HEAD' ? '0123456789abcdef' : 'fedcba9876543210',
    })),
    /must exist and point to HEAD/,
  );
});

test('split release guard requires the central release tag at HEAD', () => {
  const version = getSourceVersion();
  const revision = '0123456789abcdef';
  assert.deepEqual(
    assertReleaseTagAtHead(version, { readRevision: () => revision }),
    { tag: `v${version}`, revision },
  );
  assert.throws(
    () => assertReleaseTagAtHead(version, {
      readRevision: (ref) => ref === 'HEAD' ? revision : 'fedcba9876543210',
    }),
    /must exist and point to HEAD/,
  );
});

test('external release drivers use the read-only prepared-release guard', () => {
  const rootPackage = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'));
  const externalScripts = Object.entries(rootPackage.scripts)
    .filter(([name]) => name.startsWith('release:'))
    .map(([, command]) => command.match(/node\s+\.\/(\S+)/)?.[1])
    .filter((path) => path?.startsWith('dev/release/'));

  assert.ok(externalScripts.length >= 12, 'expected all external release routes to be declared');
  for (const path of externalScripts) {
    const absolutePath = resolve(REPO_ROOT, path);
    assert.ok(existsSync(absolutePath), `missing release entrypoint ${path}`);
    const source = readFileSync(absolutePath, 'utf8');
    assert.match(source, /assertPreparedRelease/, `${path} must enforce prepared source`);
    assert.doesNotMatch(source, /setReleaseVersion/, `${path} must not rewrite versions`);
    assert.doesNotMatch(source, /requireTag\s*:\s*false/, `${path} must not bypass release provenance`);
  }
});

test('explicit registry credentials override ignored release env files', () => {
  for (const path of [
    'dev/release/publish-npm-release.mjs',
    'dev/release/publish-pypi-release.mjs',
    'dev/release/publish-rust-release.mjs',
    'dev/release/publish-nuget-release.mjs',
    'dev/release/publish-rubygems-release.mjs',
    'dev/release/publish-hex-release.mjs',
  ]) {
    const source = readFileSync(resolve(REPO_ROOT, path), 'utf8');
    const fileEnvPosition = source.indexOf('...fileEnv');
    const processEnvPosition = source.indexOf('...process.env', fileEnvPosition);
    assert.ok(fileEnvPosition >= 0, `${path} must load its optional env file`);
    assert.ok(
      processEnvPosition > fileEnvPosition,
      `${path} must give explicit process.env credentials precedence`,
    );
  }
});

test('npm prepack and publish run from an isolated temporary workspace', () => {
  const source = readFileSync(
    resolve(REPO_ROOT, 'dev/release/publish-npm-release.mjs'),
    'utf8',
  );
  assert.match(source, /releaseRoot:\s*releaseWorkspace\.root/);
  assert.match(source, /resolve\(releaseRoot, dirname\(target\.path\)\)/);

  const stage = createNpmReleaseWorkspace();
  try {
    assert.notEqual(stage.root, REPO_ROOT);
    assert.ok(existsSync(resolve(stage.root, 'packages/server/src/index.ts')));
    assert.ok(existsSync(resolve(stage.root, 'packages/admin/src')));
    assert.equal(existsSync(resolve(stage.root, 'packages/server/admin-build')), false);
    assert.equal(existsSync(resolve(stage.root, 'packages/admin/build')), false);
    assert.ok(lstatSync(resolve(stage.root, 'node_modules')).isSymbolicLink());
    assert.ok(lstatSync(resolve(stage.root, 'packages/server/node_modules')).isSymbolicLink());
  } finally {
    stage.cleanup();
  }
  assert.equal(existsSync(stage.root), false);

  const serverNpmIgnore = readFileSync(
    resolve(REPO_ROOT, 'packages/server/src/.npmignore'),
    'utf8',
  );
  assert.match(serverNpmIgnore, /^__tests__\/$/m);
  assert.match(serverNpmIgnore, /^\*\*\/\*\.test\.ts$/m);
});

test('isolated server pack excludes tests and credential fixtures', () => {
  const stage = createNpmReleaseWorkspace();
  const packDir = mkdtempSync(resolve(tmpdir(), 'edgebase-server-pack-contract-'));
  try {
    const pack = spawnSync(
      'pnpm',
      [
        '--dir',
        resolve(stage.root, 'packages/server'),
        'pack',
        '--pack-destination',
        packDir,
        '--json',
      ],
      {
        cwd: stage.root,
        encoding: 'utf8',
        env: { ...process.env, npm_config_ignore_scripts: 'true' },
      },
    );
    assert.equal(pack.status, 0, `${pack.stdout ?? ''}${pack.stderr ?? ''}`);
    const tarballs = readdirSync(packDir).filter((name) => name.endsWith('.tgz'));
    assert.equal(tarballs.length, 1);
    const tarball = resolve(packDir, tarballs[0]);

    const listing = spawnSync('tar', ['-tzf', tarball], { encoding: 'utf8' });
    assert.equal(listing.status, 0, listing.stderr);
    assert.doesNotMatch(listing.stdout, /\/(?:__tests__|test)\//);
    assert.doesNotMatch(listing.stdout, /\.(?:test|spec)\.[cm]?[jt]sx?$/m);

    const contents = spawnSync('tar', ['-xOzf', tarball], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    assert.equal(contents.status, 0, contents.stderr);
    assert.doesNotMatch(contents.stdout, /invalid-for-mock/);
  } finally {
    stage.cleanup();
    rmSync(packDir, { recursive: true, force: true });
  }
});

test('packed npm CLI materializes portable and Docker dependencies from a clean consumer install', { timeout: 240_000 }, async () => {
  const stage = createNpmReleaseWorkspace();
  const tempRoot = mkdtempSync(resolve(tmpdir(), 'edgebase-cli-consumer-contract-'));
  const packDir = join(tempRoot, 'tarballs');
  const consumerDir = join(tempRoot, 'consumer');
  mkdirSync(packDir, { recursive: true });
  mkdirSync(join(consumerDir, 'functions'), { recursive: true });

  try {
    const packageDirs = [
      'packages/shared',
      'packages/sdk/js/packages/core',
      'packages/server',
      'packages/cli',
    ];
    const tarballs = [];

    for (const packageDir of packageDirs) {
      const before = new Set(readdirSync(packDir));
      const packed = spawnSync(
        'pnpm',
        ['--dir', resolve(stage.root, packageDir), 'pack', '--pack-destination', packDir],
        {
          cwd: stage.root,
          encoding: 'utf8',
          env: { ...process.env, npm_config_ignore_scripts: 'false' },
          timeout: 120_000,
        },
      );
      assert.equal(packed.status, 0, `${packed.stdout ?? ''}${packed.stderr ?? ''}`);
      const created = readdirSync(packDir).filter((name) => !before.has(name) && name.endsWith('.tgz'));
      assert.equal(created.length, 1, `${packageDir} must produce exactly one npm tarball`);
      tarballs.push(resolve(packDir, created[0]));
    }

    writeFileSync(
      join(consumerDir, 'package.json'),
      `${JSON.stringify({ name: 'edgebase-clean-consumer-contract', private: true, type: 'module' }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      join(consumerDir, 'edgebase.config.ts'),
      'export default { databases: { app: { tables: {} } } };\n',
      'utf8',
    );
    writeFileSync(
      join(consumerDir, 'functions', 'health.ts'),
      "export async function GET() { return Response.json({ status: 'ok' }); }\n",
      'utf8',
    );

    const installed = spawnSync(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs],
      {
        cwd: consumerDir,
        encoding: 'utf8',
        timeout: 120_000,
      },
    );
    assert.equal(installed.status, 0, `${installed.stdout ?? ''}${installed.stderr ?? ''}`);

    const version = getSourceVersion();
    for (const packageName of ['@edge-base/shared', '@edge-base/core', '@edge-base/server', '@edge-base/cli']) {
      const manifestPath = join(consumerDir, 'node_modules', ...packageName.split('/'), 'package.json');
      assert.equal(JSON.parse(readFileSync(manifestPath, 'utf8')).version, version, packageName);
    }

    const cliEntry = join(consumerDir, 'node_modules', '@edge-base', 'cli', 'dist', 'index.js');
    const portable = spawnSync(
      process.execPath,
      [cliEntry, '--json', 'pack', '--format', 'dir', '--output', 'portable-bundle'],
      {
        cwd: consumerDir,
        encoding: 'utf8',
        env: { ...process.env, NO_COLOR: '1' },
        timeout: 120_000,
      },
    );
    assert.equal(portable.status, 0, `${portable.stdout ?? ''}${portable.stderr ?? ''}`);

    const appBundleModule = await import(
      `${pathToFileURL(join(consumerDir, 'node_modules', '@edge-base', 'cli', 'dist', 'lib', 'app-bundle.js')).href}?contract=${Date.now()}`
    );
    appBundleModule.createAppBundle(consumerDir, {
      outputDir: 'docker-bundle',
      overwrite: true,
      portableDependencies: true,
      dependencyProfile: 'docker',
    });

    const requiredRuntimePackages = [
      '@edge-base/core',
      '@edge-base/shared',
      '@hono/zod-openapi',
      '@simplewebauthn/server',
      'bcryptjs',
      'hono',
      'jose',
      'pg',
      'zod',
    ];
    for (const bundleName of ['portable-bundle', 'docker-bundle']) {
      const runtimeNodeModules = join(
        consumerDir,
        bundleName,
        '.edgebase',
        'runtime',
        'server',
        'node_modules',
      );
      for (const packageName of requiredRuntimePackages) {
        const packageDir = join(runtimeNodeModules, ...packageName.split('/'));
        assert.ok(existsSync(join(packageDir, 'package.json')), `${bundleName} missing ${packageName}`);
        assert.equal(lstatSync(packageDir).isSymbolicLink(), false, `${bundleName} linked ${packageName}`);
      }
    }
  } finally {
    stage.cleanup();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('split synchronization never stores credentials or force-overwrites tags', () => {
  const askpass = readFileSync(resolve(REPO_ROOT, 'scripts/release-github-askpass.sh'), 'utf8');
  assert.match(askpass, /EDGEBASE_SPLIT_PUSH_TOKEN/);
  assert.doesNotMatch(askpass, /npm_|github_pat_|ghp_/i);

  for (const path of [
    'scripts/sync-php-split-repo.sh',
    'scripts/sync-swift-split-repo.sh',
    'scripts/sync-go-split-repo.sh',
  ]) {
    const source = readFileSync(resolve(REPO_ROOT, path), 'utf8');
    assert.match(source, /REMOTE_URL="https:\/\/github\.com\/\$\{DEST_REPO\}\.git"/);
    assert.match(source, /GIT_ASKPASS=/);
    assert.doesNotMatch(source, /x-access-token:\$\{PUSH_TOKEN\}/);
    assert.doesNotMatch(source, /push --force[^\n]*refs\/tags/);
    assert.match(source, /already points to .*; skipping/);
    assert.match(source, /Refusing to overwrite/);
    assert.match(source, /must resolve to the same central release commit/);
  }
  for (const path of [
    'scripts/sync-php-split-repo.sh',
    'scripts/sync-swift-split-repo.sh',
  ]) {
    const source = readFileSync(resolve(REPO_ROOT, path), 'utf8');
    assert.match(source, /GIT_AUTHOR_DATE="\$SOURCE_COMMIT_DATE"/);
  }
});

test('split sync, split verification, and JitPack dry runs are source-read-only plans', async () => {
  const version = getSourceVersion();
  const packageJsonPath = resolve(REPO_ROOT, 'package.json');
  const before = readFileSync(packageJsonPath, 'utf8');

  const php = withoutConsoleLogs(() => syncPhpSplitRelease(version, { dryRun: true }));
  const swift = withoutConsoleLogs(() => syncSwiftSplitRelease(version, { dryRun: true }));
  const go = withoutConsoleLogs(() => syncGoSplitRelease(version, { dryRun: true }));
  const goVerification = withoutConsoleLogs(
    () => verifyGoSplitRelease(version, { dryRun: true }),
  );
  const jitpack = await withoutConsoleLogs(
    () => verifyJitpackRelease(version, { dryRun: true }),
  );

  assert.deepEqual(php.map((plan) => plan.id), PHP_SPLIT_TARGET_IDS);
  assert.deepEqual(swift.map((plan) => plan.id), SWIFT_SPLIT_TARGET_IDS);
  assert.equal(go.id, GO_SPLIT_TARGET_IDS[0]);
  assert.equal(goVerification.id, GO_SPLIT_TARGET_IDS[0]);
  assert.equal(goVerification.status, 'planned');
  assert.deepEqual(jitpack.map((result) => result.target.id), JITPACK_VERIFY_TARGET_IDS);
  assert.equal(readFileSync(packageJsonPath, 'utf8'), before);
});

test('split tag plans reject a tag that does not match the prepared version', () => {
  const version = getSourceVersion();
  assert.throws(
    () => syncPhpSplitRelease(version, { dryRun: true, tag: 'v9.9.9' }),
    /does not match prepared release/,
  );
  assert.throws(
    () => syncSwiftSplitRelease(version, { dryRun: true, tag: 'v9.9.9' }),
    /does not match prepared release/,
  );
  assert.throws(
    () => syncGoSplitRelease(version, { dryRun: true, tag: 'v9.9.9' }),
    /does not match prepared release/,
  );
});

test('JitPack verifier builds the canonical multi-module POM URL', () => {
  const version = getSourceVersion();
  assert.equal(
    buildJitpackArtifactUrl('edgebase-client', version),
    `https://jitpack.io/com/github/edge-base/edgebase/edgebase-client/v${version}/edgebase-client-v${version}.pom`,
  );
});
