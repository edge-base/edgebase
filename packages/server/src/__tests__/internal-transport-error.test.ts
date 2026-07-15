import { describe, expect, it } from 'vitest';

import { internalTransportError } from '../lib/internal-transport.js';

describe('internal transport errors', () => {
  it('preserves the HTTP status and structured error fields', () => {
    const error = internalTransportError(409, {
      code: 'record_conflict',
      details: { table: 'pages' },
      message: 'Record already exists.',
    });

    expect(error).toMatchObject({
      code: 'record_conflict',
      details: { table: 'pages' },
      message: 'Record already exists.',
      status: 409,
    });
  });
});
