/**
 * Cross-platform npx command resolution.
 *
 * On Windows, `spawn('npx', [...])` without `shell: true` fails because
 * Node.js cannot resolve `npx` (a `.cmd` shim). This helper returns
 * the correct executable name for the current platform.
 */
export function npxCommand(): string {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}
