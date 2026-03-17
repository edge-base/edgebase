/**
 * Interactive prompt helpers using Node.js readline.
 * All prompts return default values silently when stdin is not a TTY (CI/CD).
 */

import { createInterface } from 'node:readline';
import { raiseNeedsInput, type CliChoice } from './agent-contract.js';
import { isNonInteractive } from './cli-context.js';

interface PromptMetadata {
  field?: string;
  hint?: string;
  message?: string;
  choices?: CliChoice[];
}

/**
 * Prompt the user for a text value.
 * Returns defaultValue (or empty string) in non-TTY environments.
 */
export async function promptText(
  message: string,
  defaultValue?: string,
  metadata?: PromptMetadata,
): Promise<string> {
  if (!process.stdin.isTTY || isNonInteractive()) {
    if (defaultValue !== undefined) return defaultValue;
    raiseNeedsInput({
      code: 'input_required',
      field: metadata?.field,
      message: metadata?.message ?? `${message.replace(/:?\s*$/, '')} is required.`,
      hint: metadata?.hint,
    });
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultValue ? ` (${defaultValue})` : '';

  return new Promise((resolve) => {
    rl.question(`${message}${suffix}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

/**
 * Prompt the user to select from a list of choices.
 * Returns the first choice in non-TTY environments.
 */
export async function promptSelect(
  message: string,
  choices: string[],
  metadata?: PromptMetadata,
): Promise<string> {
  if (choices.length === 0) return '';
  if ((!process.stdin.isTTY || isNonInteractive()) && choices.length === 1) return choices[0];
  if (!process.stdin.isTTY || isNonInteractive()) {
    raiseNeedsInput({
      code: 'selection_required',
      field: metadata?.field,
      message: metadata?.message ?? `${message.replace(/:?\s*$/, '')}.`,
      hint: metadata?.hint,
      choices: metadata?.choices ?? choices.map((choice) => ({
        label: choice,
        value: choice,
      })),
    });
  }

  console.log(message);
  choices.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    rl.question('  Select (number): ', (answer) => {
      rl.close();
      const idx = parseInt(answer, 10) - 1;
      resolve(choices[idx] ?? choices[0]);
    });
  });
}

/**
 * Prompt the user for a yes/no confirmation.
 * Returns defaultValue in non-TTY environments.
 */
export async function promptConfirm(
  message: string,
  defaultValue = true,
): Promise<boolean> {
  if (!process.stdin.isTTY || isNonInteractive()) return defaultValue;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultValue ? ' (Y/n)' : ' (y/N)';

  return new Promise((resolve) => {
    rl.question(`${message}${suffix}: `, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      if (!normalized) {
        resolve(defaultValue);
        return;
      }
      resolve(normalized === 'y' || normalized === 'yes');
    });
  });
}
