/**
 * Cross-platform pnpm command resolution.
 *
 * On Windows, invoking `pnpm` without a shell fails because the executable is
 * exposed through `pnpm.cmd`.
 */
export function pnpmCommand(): string {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}
