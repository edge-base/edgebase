/**
 * Tests for shell completion command (completion.ts).
 * Verifies bash, zsh, and fish completion scripts contain expected content.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('completion command', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('generates bash completion with expected commands', async () => {
    const { completionCommand } = await import('../src/commands/completion.js');
    await completionCommand.parseAsync(['bash'], { from: 'user' });

    const output = stdoutSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('_edgebase_completions');
    expect(output).toContain('init');
    expect(output).toContain('deploy');
    expect(output).toContain('migrate');
    expect(output).toContain('neon');
    expect(output).toContain('backup');
    expect(output).toContain('describe');
    expect(output).toContain('complete -F');
    expect(output).toContain('bash');
  });

  it('generates zsh completion with expected commands', async () => {
    const { completionCommand } = await import('../src/commands/completion.js');
    await completionCommand.parseAsync(['zsh'], { from: 'user' });

    const output = stdoutSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('#compdef edgebase');
    expect(output).toContain('_edgebase');
    expect(output).toContain('init');
    expect(output).toContain('deploy');
    expect(output).toContain('neon');
    expect(output).toContain('describe');
    expect(output).toContain('--verbose');
    expect(output).toContain('--quiet');
    expect(output).toContain('--json');
    expect(output).toContain('--non-interactive');
  });

  it('generates fish completion with expected commands', async () => {
    const { completionCommand } = await import('../src/commands/completion.js');
    await completionCommand.parseAsync(['fish'], { from: 'user' });

    const output = stdoutSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('complete -c edgebase');
    expect(output).toContain('init');
    expect(output).toContain('deploy');
    expect(output).toContain('migrate');
    expect(output).toContain('neon');
    expect(output).toContain('backup');
    expect(output).toContain('describe');
    expect(output).toContain('-l verbose');
    expect(output).toContain('-l non-interactive');
  });

  it('raises a structured error for unsupported shell', async () => {
    const { completionCommand } = await import('../src/commands/completion.js');
    await expect(completionCommand.parseAsync(['powershell'], { from: 'user' })).rejects.toMatchObject({
      payload: expect.objectContaining({
        status: 'error',
        code: 'completion_shell_unsupported',
        message: 'Unsupported shell: powershell. Use bash, zsh, or fish.',
      }),
    });
  });
});
