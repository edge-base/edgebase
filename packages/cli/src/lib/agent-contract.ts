import chalk from 'chalk';
import { isJson } from './cli-context.js';

export interface CliChoice {
  label: string;
  value: string;
  hint?: string;
  args?: string[];
}

export interface CliUserAction {
  type: 'open_browser' | 'confirm' | 'rerun_with_flags';
  title?: string;
  message: string;
  command?: string;
  args?: string[];
  instructions?: string[];
}

export interface CliStructuredIssue {
  status: 'needs_input' | 'needs_user_action' | 'error';
  code: string;
  message: string;
  field?: string;
  hint?: string;
  retryable?: boolean;
  details?: Record<string, unknown> | unknown[];
  choices?: CliChoice[];
  action?: CliUserAction;
}

export class CliStructuredError extends Error {
  readonly payload: CliStructuredIssue;
  readonly exitCode: number;

  constructor(payload: CliStructuredIssue, exitCode = 2) {
    super(payload.message);
    this.name = 'CliStructuredError';
    this.payload = payload;
    this.exitCode = exitCode;
  }
}

export function isCliStructuredError(error: unknown): error is CliStructuredError {
  return error instanceof CliStructuredError;
}

export function raiseNeedsInput(payload: Omit<CliStructuredIssue, 'status'>): never {
  throw new CliStructuredError({
    retryable: true,
    ...payload,
    status: 'needs_input',
  });
}

export function raiseNeedsUserAction(payload: Omit<CliStructuredIssue, 'status'>): never {
  throw new CliStructuredError({
    retryable: true,
    ...payload,
    status: 'needs_user_action',
  });
}

export function raiseCliError(
  payload: Omit<CliStructuredIssue, 'status'>,
  exitCode = 1,
): never {
  throw new CliStructuredError({
    retryable: false,
    ...payload,
    status: 'error',
  }, exitCode);
}

export function renderStructuredIssue(issue: CliStructuredIssue): void {
  if (isJson()) {
    console.log(JSON.stringify(issue));
    return;
  }

  const icon = issue.status === 'error'
    ? chalk.red('✗')
    : chalk.yellow('⚠');

  console.error(icon, issue.message);

  if (issue.field) {
    console.error(chalk.dim(`  Field: ${issue.field}`));
  }

  if (issue.hint) {
    console.error(chalk.dim(`  Hint: ${issue.hint}`));
  }

  if (issue.details && !Array.isArray(issue.details) && Object.keys(issue.details).length > 0) {
    console.error(chalk.dim(`  Details: ${JSON.stringify(issue.details)}`));
  }

  if (issue.choices && issue.choices.length > 0) {
    console.error(chalk.dim('  Choices:'));
    for (const choice of issue.choices) {
      const argsText = choice.args && choice.args.length > 0
        ? ` (${choice.args.join(' ')})`
        : '';
      const hintText = choice.hint ? ` — ${choice.hint}` : '';
      console.error(chalk.dim(`    • ${choice.label}${argsText}${hintText}`));
    }
  }

  if (issue.action) {
    if (issue.action.title) {
      console.error(chalk.dim(`  Action: ${issue.action.title}`));
    }
    console.error(chalk.dim(`  ${issue.action.message}`));
    if (issue.action.command) {
      console.error(chalk.dim(`  Command: ${issue.action.command}`));
    }
    for (const line of issue.action.instructions ?? []) {
      console.error(chalk.dim(`  ${line}`));
    }
  }
}
