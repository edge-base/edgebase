/**
 * Tests for CLI prompt utilities — non-TTY (CI/CD) safety paths.
 *
 * Since vitest runs in a non-TTY environment, we verify that promptText
 * and promptSelect return explicit structured requirements instead of
 * silently picking a value when input is required.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setContext } from '../src/lib/cli-context.js';
import { promptText, promptSelect } from '../src/lib/prompts.js';

describe('promptText', () => {
  const originalIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    // Ensure non-TTY state (undefined is the actual non-TTY value)
    process.stdin.isTTY = undefined as unknown as boolean;
    setContext({ nonInteractive: false });
  });

  afterEach(() => {
    process.stdin.isTTY = originalIsTTY;
  });

  it('returns defaultValue in non-TTY', async () => {
    const result = await promptText('Project name', 'my-app');
    expect(result).toBe('my-app');
  });

  it('throws a structured input request when no defaultValue exists in non-TTY', async () => {
    await expect(promptText('Project name', undefined, {
      field: 'project',
      hint: 'Rerun with --project <name>.',
    })).rejects.toMatchObject({
      payload: expect.objectContaining({
        status: 'needs_input',
        field: 'project',
      }),
    });
  });

  it('returns defaultValue regardless of message content', async () => {
    const result = await promptText('Enter anything you want', 'fallback-value');
    expect(result).toBe('fallback-value');
  });
});

describe('promptSelect', () => {
  const originalIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    process.stdin.isTTY = undefined as unknown as boolean;
    setContext({ nonInteractive: false });
  });

  afterEach(() => {
    process.stdin.isTTY = originalIsTTY;
  });

  it('throws a structured selection request in non-TTY when multiple choices exist', async () => {
    await expect(promptSelect('Pick a template', ['starter', 'blank', 'full'], {
      field: 'template',
      hint: 'Rerun with --template <name>.',
    })).rejects.toMatchObject({
      payload: expect.objectContaining({
        status: 'needs_input',
        field: 'template',
        choices: expect.arrayContaining([
          expect.objectContaining({ value: 'starter' }),
        ]),
      }),
    });
  });

  it('returns empty string when choices is empty', async () => {
    const result = await promptSelect('Pick a template', []);
    expect(result).toBe('');
  });

  it('auto-selects the only available choice in non-TTY', async () => {
    const result = await promptSelect('Pick a template', ['starter']);
    expect(result).toBe('starter');
  });
});
