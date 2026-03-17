const MIN_SUPPORTED = { major: 20, minor: 19, patch: 0 };
const DEFAULT_MAJOR = 24;
const currentVersion = process.versions.node;
const [currentMajor, currentMinor = 0, currentPatch = 0] = currentVersion
  .split('.')
  .map((part) => Number.parseInt(part, 10));

function isOlderThanMinimum(version, minimum) {
  if (version.major !== minimum.major) return version.major < minimum.major;
  if (version.minor !== minimum.minor) return version.minor < minimum.minor;
  return version.patch < minimum.patch;
}

if (isOlderThanMinimum(
  { major: currentMajor, minor: currentMinor, patch: currentPatch },
  MIN_SUPPORTED,
)) {
  console.error('');
  console.error(
    `EdgeBase requires Node.js ${MIN_SUPPORTED.major}.${MIN_SUPPORTED.minor}.${MIN_SUPPORTED.patch} or newer.`,
  );
  console.error(`Current version: ${currentVersion}`);
  console.error('');
  console.error(`The default local development version is Node.js ${DEFAULT_MAJOR}.x.`);
  console.error('');
  console.error('Use one of these before installing dependencies:');
  console.error(`  - nvm use ${DEFAULT_MAJOR}`);
  console.error(`  - fnm use ${DEFAULT_MAJOR}`);
  console.error(
    `  - any Node ${MIN_SUPPORTED.major}.${MIN_SUPPORTED.minor}.${MIN_SUPPORTED.patch}+ release that respects package engines`,
  );
  console.error('');
  process.exit(1);
}
