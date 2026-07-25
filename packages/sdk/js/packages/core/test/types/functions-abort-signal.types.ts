import type { FunctionCallOptions } from '../../src/functions.js';

const controller = new AbortController();

const cancellableFunctionCall = {
  method: 'GET',
  query: { q: 'synthetic' },
  signal: controller.signal,
} satisfies FunctionCallOptions;

void cancellableFunctionCall;
