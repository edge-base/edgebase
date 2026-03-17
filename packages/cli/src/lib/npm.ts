/**
 * Cross-platform npm command resolution.
 *
 * On Windows, invoking `npm` without a shell fails because the executable is
 * exposed through `npm.cmd`. This helper mirrors the existing `npx` helper.
 */
export function npmCommand(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}
