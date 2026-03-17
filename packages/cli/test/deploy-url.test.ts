import { describe, expect, it } from 'vitest';
import { extractWorkerUrlFromWranglerDeployOutput } from '../src/commands/deploy.js';

describe('deploy worker URL extraction', () => {
  it('extracts the actual workers.dev hostname from wrangler deploy output', () => {
    const output = `
Uploaded app-functions-suite-edgebase (5.35 sec)
Deployed app-functions-suite-edgebase triggers (1.28 sec)
  https://app-functions-suite-edgebase.melodydreamj.workers.dev
Current Version ID: c9264185-a4e0-4e9c-b77e-932eed0fb87c
`;

    expect(extractWorkerUrlFromWranglerDeployOutput(output)).toBe(
      'https://app-functions-suite-edgebase.melodydreamj.workers.dev',
    );
  });

  it('returns an empty string when wrangler output has no workers.dev URL', () => {
    expect(extractWorkerUrlFromWranglerDeployOutput('Uploaded worker without url line')).toBe('');
  });
});
