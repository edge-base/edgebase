/**
 * Spinner utility — wraps `ora` with automatic quiet/json mode detection.
 *
 * When --quiet or --json flags are active, returns a no-op stub
 * so commands don't need conditional logic around spinners.
 */

import ora, { type Ora } from 'ora';
import { isQuiet } from './cli-context.js';

/** No-op spinner stub returned in quiet/json mode. */
const noop = (): void => {};
const noopSpinner: Ora = {
  start: function () { return this; },
  stop: noop,
  succeed: noop,
  fail: noop,
  warn: noop,
  info: noop,
  stopAndPersist: noop,
  clear: noop,
  render: noop,
  frame: noop,
  get text() { return ''; },
  set text(_v: string) {},
  get isSpinning() { return false; },
} as unknown as Ora;

/**
 * Start a spinner with the given text.
 * Returns a no-op stub in quiet/json mode.
 *
 * Usage:
 * ```typescript
 * const s = spin('Deploying...');
 * // ... long operation ...
 * s.succeed('Deployed!');
 * ```
 */
export function spin(text: string): Ora {
  if (isQuiet()) return noopSpinner;
  return ora({ text, color: 'blue' }).start();
}
