import { readFileSync } from 'node:fs';
import * as readline from 'node:readline';
import { fetchWithTimeout } from './fetch-with-timeout.js';
import {
  raiseCliError,
  raiseNeedsInput,
} from './agent-contract.js';
import { isNonInteractive } from './cli-context.js';

export interface AdminAccount {
  id: string;
  email: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PromptOptions {
  field?: string;
  hint?: string;
  message?: string;
}

export interface ResolvePasswordInputOptions {
  directValue?: string;
  filePath?: string;
  stdin?: boolean;
  promptLabel: string;
  promptField?: string;
  promptHint?: string;
  requiredMessage?: string;
  confirmationLabel?: string;
  confirmationMismatchMessage?: string;
}

export interface EnsureBootstrapAdminOptions {
  url: string;
  serviceKey: string;
  email?: string;
  password?: string;
  passwordFile?: string;
  passwordStdin?: boolean;
  emailPromptLabel?: string;
  emailPromptField?: string;
  emailPromptHint?: string;
  emailRequiredMessage?: string;
  passwordPromptLabel?: string;
  passwordPromptField?: string;
  passwordPromptHint?: string;
  passwordRequiredMessage?: string;
  passwordConfirmationLabel?: string;
  passwordConfirmationMismatchMessage?: string;
}

export type EnsureBootstrapAdminResult =
  | { status: 'created'; admin: AdminAccount }
  | { status: 'already-configured'; admin: AdminAccount; admins: AdminAccount[] }
  | { status: 'skipped-existing'; admins: AdminAccount[]; requestedEmail?: string };

const ADMIN_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeAdminEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateAdminEmail(email: string): void {
  if (!ADMIN_EMAIL_REGEX.test(email)) {
    raiseCliError({
      code: 'admin_invalid_email',
      field: 'email',
      message: 'Admin email must be a valid email address.',
      hint: 'Use a full email address such as admin@example.com.',
    });
  }
}

export function validateAdminPassword(password: string): void {
  if (password.length < 8) {
    raiseCliError({
      code: 'admin_password_too_short',
      field: 'password',
      message: 'Password must be at least 8 characters.',
      hint: 'Choose a password with at least 8 characters and retry.',
    });
  }
  if (password.length > 256) {
    raiseCliError({
      code: 'admin_password_too_long',
      field: 'password',
      message: 'Password must not exceed 256 characters.',
      hint: 'Use a shorter password and retry.',
    });
  }
}

export function promptValue(
  question: string,
  hidden = false,
  options?: PromptOptions,
): Promise<string> {
  if (!process.stdin.isTTY || isNonInteractive()) {
    raiseNeedsInput({
      code: 'admin_input_required',
      field: options?.field,
      message: options?.message ?? `${question.replace(/:?\s*$/, '')} is required.`,
      hint: options?.hint,
    });
  }

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    if (hidden && process.stdout.isTTY) {
      process.stdout.write(question);
      const stdin = process.stdin;
      const oldRawMode = stdin.isRaw;
      stdin.setRawMode(true);
      let input = '';
      stdin.resume();
      stdin.on('data', function handler(ch: Buffer) {
        const c = ch.toString('utf8');
        if (c === '\n' || c === '\r' || c === '\u0004') {
          stdin.setRawMode(oldRawMode ?? false);
          stdin.removeListener('data', handler);
          stdin.pause();
          rl.close();
          process.stdout.write('\n');
          resolve(input);
        } else if (c === '\u007F' || c === '\b') {
          if (input.length > 0) input = input.slice(0, -1);
        } else {
          input += c;
        }
      });
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

async function readSecretFromStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    raiseNeedsInput({
      code: 'admin_password_stdin_required',
      field: 'password',
      message: 'Password stdin mode requires piped input.',
      hint: 'Pipe the password into stdin or omit --bootstrap-admin-password-stdin to use an interactive prompt.',
    });
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8').trimEnd()));
    process.stdin.on('error', reject);
  });
}

export async function resolvePasswordInput(options: ResolvePasswordInputOptions): Promise<string> {
  let value = options.directValue;

  if (!value && options.filePath) {
    try {
      value = readFileSync(options.filePath, 'utf-8').trimEnd();
    } catch (error) {
      raiseCliError({
        code: 'admin_password_file_read_failed',
        field: 'password',
        message: `Failed to read bootstrap admin password file: ${(error as Error).message}`,
        hint: 'Check the file path and permissions, then retry.',
      });
    }
  }

  if (!value && options.stdin) {
    value = await readSecretFromStdin();
  }

  if (!value) {
    value = await promptValue(options.promptLabel, true, {
      field: options.promptField,
      hint: options.promptHint,
      message: options.requiredMessage,
    });
  }

  if (!value) {
    raiseNeedsInput({
      code: 'admin_password_required',
      field: options.promptField ?? 'password',
      message: options.requiredMessage ?? `${options.promptLabel.replace(/:?\s*$/, '')} is required.`,
      hint: options.promptHint,
    });
  }

  if (!options.directValue && !options.filePath && !options.stdin && options.confirmationLabel) {
    const confirmation = await promptValue(options.confirmationLabel, true, {
      field: options.promptField,
      hint: options.promptHint,
      message: options.requiredMessage,
    });
    if (value !== confirmation) {
      raiseCliError({
        code: 'admin_password_confirmation_failed',
        field: options.promptField ?? 'password',
        message: options.confirmationMismatchMessage ?? 'Passwords did not match.',
        hint: 'Retry and enter the same password twice.',
      });
    }
  }

  validateAdminPassword(value);
  return value;
}

export async function listRemoteAdmins(url: string, serviceKey: string): Promise<AdminAccount[]> {
  let response: Response;
  try {
    response = await fetchWithTimeout(`${url}/admin/api/data/admins`, {
      method: 'GET',
      headers: {
        'X-EdgeBase-Service-Key': serviceKey,
      },
    });
  } catch (error) {
    raiseCliError({
      code: 'admin_bootstrap_connection_failed',
      message: `Could not reach the admin bootstrap endpoint: ${(error as Error).message}`,
      hint: 'Check the server URL, wait for the runtime to finish starting, and retry.',
    });
  }

  let payload: { admins?: AdminAccount[]; message?: string; code?: number } | null = null;
  try {
    payload = await response.json() as { admins?: AdminAccount[]; message?: string; code?: number };
  } catch {
    payload = null;
  }

  if (!response.ok) {
    raiseCliError({
      code: 'admin_bootstrap_list_failed',
      message: payload?.message
        ? `Failed to inspect admin accounts: ${payload.message}`
        : `Failed to inspect admin accounts (${response.status}).`,
      hint: 'Make sure the Service Key has admin privileges and the runtime is reachable.',
    });
  }

  return payload?.admins ?? [];
}

export async function createRemoteAdmin(
  url: string,
  serviceKey: string,
  email: string,
  password: string,
): Promise<AdminAccount> {
  let response: Response;
  try {
    response = await fetchWithTimeout(`${url}/admin/api/data/admins`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EdgeBase-Service-Key': serviceKey,
      },
      body: JSON.stringify({ email, password }),
    });
  } catch (error) {
    raiseCliError({
      code: 'admin_bootstrap_connection_failed',
      message: `Could not create the bootstrap admin: ${(error as Error).message}`,
      hint: 'Check the server URL, wait for the runtime to finish starting, and retry.',
    });
  }

  let payload: { id?: string; email?: string; message?: string; code?: number } | null = null;
  try {
    payload = await response.json() as { id?: string; email?: string; message?: string; code?: number };
  } catch {
    payload = null;
  }

  if (!response.ok) {
    raiseCliError({
      code: response.status === 409 ? 'admin_bootstrap_conflict' : 'admin_bootstrap_create_failed',
      message: payload?.message
        ? `Failed to create bootstrap admin: ${payload.message}`
        : `Failed to create bootstrap admin (${response.status}).`,
      hint: response.status === 409
        ? 'An admin with this email already exists. Use the existing admin account or add a different one explicitly from the dashboard settings.'
        : 'Make sure the Service Key has admin privileges and retry.',
    });
  }

  return {
    id: payload?.id ?? '',
    email: payload?.email ?? email,
  };
}

export async function ensureBootstrapAdmin(
  options: EnsureBootstrapAdminOptions,
): Promise<EnsureBootstrapAdminResult> {
  const requestedEmail = options.email ? normalizeAdminEmail(options.email) : '';
  if (requestedEmail) {
    validateAdminEmail(requestedEmail);
  }

  const admins = await listRemoteAdmins(options.url, options.serviceKey);
  if (admins.length > 0) {
    const matchingAdmin = requestedEmail
      ? admins.find((admin) => normalizeAdminEmail(admin.email) === requestedEmail)
      : undefined;
    if (matchingAdmin) {
      return {
        status: 'already-configured',
        admin: matchingAdmin,
        admins,
      };
    }
    return {
      status: 'skipped-existing',
      admins,
      ...(requestedEmail ? { requestedEmail } : {}),
    };
  }

  let email = requestedEmail;
  if (!email) {
    email = normalizeAdminEmail(await promptValue(
      options.emailPromptLabel ?? 'Bootstrap admin email: ',
      false,
      {
        field: options.emailPromptField ?? 'bootstrapAdminEmail',
        hint: options.emailPromptHint,
        message: options.emailRequiredMessage ?? 'A bootstrap admin email is required.',
      },
    ));
  }

  if (!email) {
    raiseNeedsInput({
      code: 'bootstrap_admin_email_required',
      field: options.emailPromptField ?? 'bootstrapAdminEmail',
      message: options.emailRequiredMessage ?? 'A bootstrap admin email is required.',
      hint: options.emailPromptHint,
    });
  }

  validateAdminEmail(email);

  const password = await resolvePasswordInput({
    directValue: options.password,
    filePath: options.passwordFile,
    stdin: options.passwordStdin,
    promptLabel: options.passwordPromptLabel ?? 'Bootstrap admin password (min 8 chars): ',
    promptField: options.passwordPromptField ?? 'bootstrapAdminPassword',
    promptHint: options.passwordPromptHint,
    requiredMessage: options.passwordRequiredMessage ?? 'A bootstrap admin password is required.',
    confirmationLabel: options.passwordConfirmationLabel ?? 'Confirm bootstrap admin password: ',
    confirmationMismatchMessage: options.passwordConfirmationMismatchMessage ?? 'Bootstrap admin passwords did not match.',
  });

  const admin = await createRemoteAdmin(options.url, options.serviceKey, email, password);
  return {
    status: 'created',
    admin,
  };
}
