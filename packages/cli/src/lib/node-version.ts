const MIN_NODE_MAJOR = 20;
const MIN_NODE_MINOR = 19;
const MIN_NODE_PATCH = 0;

interface ParsedNodeVersion {
  major: number;
  minor: number;
  patch: number;
}

function parseNodeVersion(version: string): ParsedNodeVersion | null {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

function isSupportedNodeVersion(version: ParsedNodeVersion): boolean {
  if (version.major !== MIN_NODE_MAJOR) {
    return version.major > MIN_NODE_MAJOR;
  }
  if (version.minor !== MIN_NODE_MINOR) {
    return version.minor > MIN_NODE_MINOR;
  }
  return version.patch >= MIN_NODE_PATCH;
}

export function getCurrentNodeVersion(): string {
  return process.env.EDGEBASE_NODE_VERSION_OVERRIDE?.trim() || process.versions.node;
}

export function assertSupportedNodeVersion(version = getCurrentNodeVersion()): void {
  const parsed = parseNodeVersion(version);
  if (!parsed || !isSupportedNodeVersion(parsed)) {
    throw new Error(
      `EdgeBase CLI requires Node.js >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}.${MIN_NODE_PATCH}, but found ${version}.`,
    );
  }
}
