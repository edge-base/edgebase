import { describe, expect, it } from 'vitest';

import { validateNegativeTransactExpectations } from '../src/transact.js';

const unsafe = 'Unsafe transaction shape';

describe('portable transact negative expectations', () => {
  it('allows a read-only negative expectation', () => {
    expect(validateNegativeTransactExpectations([
      { table: 'claims', op: 'expect', where: [['ownerId', '==', 'u1']], exists: false },
    ])).toBeNull();
  });

  it('allows an exact-id expectation sealed by the matching insert', () => {
    expect(validateNegativeTransactExpectations([
      { table: 'claims', op: 'expect', id: 'claim-1', exists: false },
      { table: 'claims', op: 'insert', data: { id: 'claim-1', ownerId: 'u1' } },
    ])).toBeNull();
  });

  it('rejects an unanchored negative predicate before writes', () => {
    expect(validateNegativeTransactExpectations([
      { table: 'claims', op: 'expect', where: [['ownerId', '==', 'u1']], exists: false },
      { table: 'documents', op: 'delete', id: 'document-1' },
    ])).toContain(unsafe);
  });

  it('accepts only a preceding actual-changing revision fence', () => {
    const negative = {
      table: 'claims',
      op: 'expect',
      where: [['ownerId', '==', 'u1']],
      exists: false,
      fencedBy: { table: 'organizations', id: 'org-1', field: 'version' },
    };
    expect(validateNegativeTransactExpectations([
      {
        table: 'organizations', op: 'expect', id: 'org-1',
        where: [['version', '==', 7]], exists: true,
      },
      { table: 'organizations', op: 'update', id: 'org-1', data: { version: 8 } },
      negative,
      { table: 'documents', op: 'delete', id: 'document-1' },
    ])).toBeNull();

    expect(validateNegativeTransactExpectations([
      {
        table: 'organizations', op: 'expect', id: 'org-1',
        where: [['version', '==', 7]], exists: true,
      },
      { table: 'organizations', op: 'update', id: 'org-1', data: { version: 7 } },
      negative,
      { table: 'documents', op: 'delete', id: 'document-1' },
    ])).toContain(unsafe);

    expect(validateNegativeTransactExpectations([
      negative,
      {
        table: 'organizations', op: 'expect', id: 'org-1',
        where: [['version', '==', 7]], exists: true,
      },
      { table: 'organizations', op: 'update', id: 'org-1', data: { version: 8 } },
      { table: 'documents', op: 'delete', id: 'document-1' },
    ])).toContain(unsafe);
  });
});
