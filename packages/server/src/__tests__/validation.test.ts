/**
 * 서버 단위 테스트 — lib/validation.ts + lib/cidr.ts
 * 1-20 rate-limit.test.ts (일부) + 필드 validation 테스트 — 70개
 *
 * 실행: cd packages/server && npx vitest run src/__tests__/validation.test.ts
 *
 * 테스트 대상:
 *   validateInsert — required / type / enum / pattern / min / max / unknown field
 *   validateUpdate — partial update / $op passthrough / required null rejection
 *   isFieldOperator — $op 객체 판별
 *   isIpInCidr — IPv4/IPv6 CIDR 범위 검사
 */

import { describe, it, expect } from 'vitest';
import {
  CUSTOM_RECORD_ID_MESSAGE,
  CUSTOM_RECORD_ID_PATTERN,
  validateCustomRecordId,
  validateInsert,
  validateUpdate,
  isFieldOperator,
  summarizeValidationErrors,
} from '../lib/validation.js';
import { isIpInCidr } from '../lib/cidr.js';

// ─── A. validateInsert ────────────────────────────────────────────────────────

describe('validateInsert', () => {
  it('no schema → valid (schemaless)', () => {
    const result = validateInsert({ anything: 'goes' }, undefined);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it('empty schema → unknown fields silently ignored → valid', () => {
    const result = validateInsert({ title: 'hello' }, {});
    // Unknown fields are silently ignored — the SQL layer filters them out.
    // Rejecting unknown fields here would break SDK payloads that send extra metadata.
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it('required field present → valid', () => {
    const result = validateInsert(
      { email: 'test@example.com' },
      { email: { type: 'string', required: true } },
    );
    expect(result.valid).toBe(true);
  });

  it('required field missing → error', () => {
    const result = validateInsert(
      {},
      { email: { type: 'string', required: true } },
    );
    expect(result.valid).toBe(false);
    expect(result.errors.email).toContain('required');
  });

  it('required field with default → valid even if missing', () => {
    const result = validateInsert(
      {},
      { role: { type: 'string', required: true, default: 'user' } },
    );
    expect(result.valid).toBe(true);
  });

  it('string type — string value → valid', () => {
    const result = validateInsert({ name: 'Alice' }, { name: { type: 'string' } });
    expect(result.valid).toBe(true);
  });

  it('string type — number value → invalid', () => {
    const result = validateInsert({ name: 42 }, { name: { type: 'string' } });
    expect(result.valid).toBe(false);
    expect(result.errors.name).toContain('string');
  });

  it('number type — number value → valid', () => {
    const result = validateInsert({ age: 25 }, { age: { type: 'number' } });
    expect(result.valid).toBe(true);
  });

  it('number type — string value → invalid', () => {
    const result = validateInsert({ age: 'twenty-five' }, { age: { type: 'number' } });
    expect(result.valid).toBe(false);
    expect(result.errors.age).toContain('number');
  });

  it('boolean type — boolean value → valid', () => {
    const result = validateInsert({ active: true }, { active: { type: 'boolean' } });
    expect(result.valid).toBe(true);
  });

  it('boolean type — string value → invalid', () => {
    const result = validateInsert({ active: 'true' }, { active: { type: 'boolean' } });
    expect(result.valid).toBe(false);
  });

  it('datetime type — ISO string → valid', () => {
    const result = validateInsert(
      { ts: '2024-01-01T00:00:00Z' },
      { ts: { type: 'datetime' } },
    );
    expect(result.valid).toBe(true);
  });

  it('datetime type — invalid date string → invalid', () => {
    const result = validateInsert({ ts: 'not-a-date' }, { ts: { type: 'datetime' } });
    expect(result.valid).toBe(false);
  });

  it('json type — any value → valid', () => {
    const result = validateInsert({ meta: { key: 'value' } }, { meta: { type: 'json' } });
    expect(result.valid).toBe(true);
  });

  it('string min constraint', () => {
    const result = validateInsert({ pw: 'abc' }, { pw: { type: 'string', min: 8 } });
    expect(result.valid).toBe(false);
    expect(result.errors.pw).toContain('characters');
  });

  it('string max constraint', () => {
    const result = validateInsert({ pw: 'a'.repeat(300) }, { pw: { type: 'string', max: 100 } });
    expect(result.valid).toBe(false);
    expect(result.errors.pw).toContain('characters');
  });

  it('string pattern constraint', () => {
    const result = validateInsert(
      { slug: 'invalid slug!' },
      { slug: { type: 'string', pattern: '^[a-z0-9-]+$' } },
    );
    expect(result.valid).toBe(false);
    expect(result.errors.slug).toContain('pattern');
  });

  it('string enum constraint — valid value', () => {
    const result = validateInsert(
      { role: 'admin' },
      { role: { type: 'string', enum: ['user', 'admin', 'mod'] } },
    );
    expect(result.valid).toBe(true);
  });

  it('string enum constraint — invalid value', () => {
    const result = validateInsert(
      { role: 'superuser' },
      { role: { type: 'string', enum: ['user', 'admin'] } },
    );
    expect(result.valid).toBe(false);
    expect(result.errors.role).toContain('one of');
  });

  it('number min constraint', () => {
    const result = validateInsert({ age: -1 }, { age: { type: 'number', min: 0 } });
    expect(result.valid).toBe(false);
    expect(result.errors.age).toContain('at least');
  });

  it('number max constraint', () => {
    const result = validateInsert({ age: 200 }, { age: { type: 'number', max: 150 } });
    expect(result.valid).toBe(false);
    expect(result.errors.age).toContain('at most');
  });

  it('unknown field → silently ignored (valid)', () => {
    const result = validateInsert(
      { title: 'ok', unknown_field: 'bad' },
      { title: { type: 'string' } },
    );
    expect(result.valid).toBe(true);
    expect(Object.keys(result.errors)).toHaveLength(0);
  });

  it('optional field absent → valid', () => {
    const result = validateInsert({}, { nickname: { type: 'string' } });
    expect(result.valid).toBe(true);
  });

  it('custom record id with Korean characters → invalid', () => {
    const result = validateInsert({ id: '한글-id' }, { title: { type: 'string' } });
    expect(result.valid).toBe(false);
    expect(result.errors.id).toContain('English letters');
  });

  it('NaN for number → invalid', () => {
    const result = validateInsert({ n: NaN }, { n: { type: 'number' } });
    expect(result.valid).toBe(false);
  });
});

describe('validateCustomRecordId', () => {
  it('blank id is allowed and will be auto-generated later', () => {
    expect(validateCustomRecordId('')).toBeNull();
  });

  it('ASCII-safe custom id is valid', () => {
    expect(validateCustomRecordId('post_123-abc')).toBeNull();
  });

  it('exports the shared record id pattern for reuse', () => {
    expect(CUSTOM_RECORD_ID_PATTERN.test('post_123-abc')).toBe(true);
    expect(CUSTOM_RECORD_ID_PATTERN.test('한글-id')).toBe(false);
  });

  it('uses the shared invalid record id message', () => {
    expect(validateCustomRecordId('한글-id')).toBe(CUSTOM_RECORD_ID_MESSAGE);
  });
});

describe('summarizeValidationErrors', () => {
  it('uses a clearer message for record id validation', () => {
    expect(
      summarizeValidationErrors({
        id: 'Record ID must use English letters, numbers, hyphen (-), or underscore (_).',
      }),
    ).toBe("Invalid record ID. Record ID must use English letters, numbers, hyphen (-), or underscore (_).");
  });
});

// ─── B. validateUpdate ────────────────────────────────────────────────────────

describe('validateUpdate', () => {
  it('no schema → valid (schemaless)', () => {
    const result = validateUpdate({ x: 1 }, undefined);
    expect(result.valid).toBe(true);
  });

  it('valid partial update', () => {
    const result = validateUpdate(
      { title: 'New Title' },
      { title: { type: 'string' }, status: { type: 'string' } },
    );
    expect(result.valid).toBe(true);
  });

  it('unknown field in update → silently ignored (valid)', () => {
    const result = validateUpdate(
      { unknownField: 'x' },
      { title: { type: 'string' } },
    );
    expect(result.valid).toBe(true);
    expect(Object.keys(result.errors)).toHaveLength(0);
  });

  it('$op increment passes through without type error', () => {
    const result = validateUpdate(
      { count: { $op: 'increment', value: 1 } },
      { count: { type: 'number' } },
    );
    expect(result.valid).toBe(true);
  });

  it('$op deleteField passes through', () => {
    const result = validateUpdate(
      { avatar: { $op: 'deleteField' } },
      { avatar: { type: 'string' } },
    );
    expect(result.valid).toBe(true);
  });

  it('$op deleteField on required field → error', () => {
    const result = validateUpdate(
      { email: { $op: 'deleteField' } },
      { email: { type: 'string', required: true } },
    );
    expect(result.valid).toBe(false);
    expect(result.errors.email).toContain('required');
  });

  it('required field set to null → error', () => {
    const result = validateUpdate(
      { email: null },
      { email: { type: 'string', required: true } },
    );
    expect(result.valid).toBe(false);
    expect(result.errors.email).toContain('required');
  });

  it('auto fields (id/createdAt/updatedAt) always allowed', () => {
    const result = validateUpdate(
      { id: 'new-id', createdAt: '...', updatedAt: '...' },
      { title: { type: 'string' } },
    );
    expect(result.valid).toBe(true);
  });

  it('wrong type in partial update → error', () => {
    const result = validateUpdate(
      { views: 'not-a-number' },
      { views: { type: 'number' } },
    );
    expect(result.valid).toBe(false);
  });
});

// ─── C. isFieldOperator ───────────────────────────────────────────────────────

describe('isFieldOperator', () => {
  it('{ $op: "increment", value: 5 } → true', () => {
    expect(isFieldOperator({ $op: 'increment', value: 5 })).toBe(true);
  });

  it('{ $op: "deleteField" } → true', () => {
    expect(isFieldOperator({ $op: 'deleteField' })).toBe(true);
  });

  it('null → false', () => {
    expect(isFieldOperator(null)).toBe(false);
  });

  it('string → false', () => {
    expect(isFieldOperator('increment')).toBe(false);
  });

  it('number → false', () => {
    expect(isFieldOperator(42)).toBe(false);
  });

  it('plain object without $op → false', () => {
    expect(isFieldOperator({ op: 'increment' })).toBe(false);
  });

  it('array → false', () => {
    expect(isFieldOperator([])).toBe(false);
  });

  it('$op is a number → false-ish (since $op must be string)', () => {
    const result = isFieldOperator({ $op: 42 });
    expect(result).toBe(false);
  });
});

// ─── D. isIpInCidr — IPv4 ────────────────────────────────────────────────────

describe('isIpInCidr — IPv4', () => {
  it('10.0.0.1 in 10.0.0.0/8 → true', () => {
    expect(isIpInCidr('10.0.0.1', '10.0.0.0/8')).toBe(true);
  });

  it('10.0.0.255 in 10.0.0.0/8 → true', () => {
    expect(isIpInCidr('10.0.0.255', '10.0.0.0/8')).toBe(true);
  });

  it('192.168.1.1 in 10.0.0.0/8 → false', () => {
    expect(isIpInCidr('192.168.1.1', '10.0.0.0/8')).toBe(false);
  });

  it('192.168.1.100 in 192.168.1.0/24 → true', () => {
    expect(isIpInCidr('192.168.1.100', '192.168.1.0/24')).toBe(true);
  });

  it('192.168.2.1 in 192.168.1.0/24 → false', () => {
    expect(isIpInCidr('192.168.2.1', '192.168.1.0/24')).toBe(false);
  });

  it('127.0.0.1 in 127.0.0.1/32 → true (exact match)', () => {
    expect(isIpInCidr('127.0.0.1', '127.0.0.1/32')).toBe(true);
  });

  it('any IP in 0.0.0.0/0 → true', () => {
    expect(isIpInCidr('8.8.8.8', '0.0.0.0/0')).toBe(true);
  });

  it('no CIDR slash → false', () => {
    expect(isIpInCidr('10.0.0.1', '10.0.0.0')).toBe(false);
  });

  it('invalid IP → false', () => {
    expect(isIpInCidr('invalid.ip', '10.0.0.0/8')).toBe(false);
  });

  it('prefix > 32 → false', () => {
    expect(isIpInCidr('10.0.0.1', '10.0.0.0/33')).toBe(false);
  });

  it('IPv4 vs IPv6 CIDR → false (version mismatch)', () => {
    expect(isIpInCidr('10.0.0.1', '::1/128')).toBe(false);
  });
});

// ─── E. isIpInCidr — IPv6 ────────────────────────────────────────────────────

describe('isIpInCidr — IPv6', () => {
  it('::1 in ::1/128 → true', () => {
    expect(isIpInCidr('::1', '::1/128')).toBe(true);
  });

  it('2001:db8::1 in 2001:db8::/32 → true', () => {
    expect(isIpInCidr('2001:db8::1', '2001:db8::/32')).toBe(true);
  });

  it('2001:db9::1 in 2001:db8::/32 → false', () => {
    expect(isIpInCidr('2001:db9::1', '2001:db8::/32')).toBe(false);
  });

  it('IPv6 in IPv4 CIDR → false', () => {
    expect(isIpInCidr('::1', '10.0.0.0/8')).toBe(false);
  });

  it('prefix > 128 → false', () => {
    expect(isIpInCidr('::1', '::1/129')).toBe(false);
  });
});

// ─── F. isIpInCidr — Edge Cases (mutation coverage) ─────────────────────────

describe('isIpInCidr — IPv4 prefix boundaries', () => {
  it('/31 → 2 addresses: .0 included', () => {
    expect(isIpInCidr('192.168.0.0', '192.168.0.0/31')).toBe(true);
  });

  it('/31 → 2 addresses: .1 included', () => {
    expect(isIpInCidr('192.168.0.1', '192.168.0.0/31')).toBe(true);
  });

  it('/31 → 2 addresses: .2 excluded', () => {
    expect(isIpInCidr('192.168.0.2', '192.168.0.0/31')).toBe(false);
  });

  it('/30 → 4 addresses: .3 included, .4 excluded', () => {
    expect(isIpInCidr('192.168.0.3', '192.168.0.0/30')).toBe(true);
    expect(isIpInCidr('192.168.0.4', '192.168.0.0/30')).toBe(false);
  });

  it('/25 → upper half boundary', () => {
    expect(isIpInCidr('192.168.1.127', '192.168.1.0/25')).toBe(true);
    expect(isIpInCidr('192.168.1.128', '192.168.1.0/25')).toBe(false);
  });

  it('/16 → Class B boundary', () => {
    expect(isIpInCidr('172.16.255.255', '172.16.0.0/16')).toBe(true);
    expect(isIpInCidr('172.17.0.0', '172.16.0.0/16')).toBe(false);
  });

  it('/1 → entire upper/lower half', () => {
    expect(isIpInCidr('0.0.0.1', '0.0.0.0/1')).toBe(true);
    expect(isIpInCidr('127.255.255.255', '0.0.0.0/1')).toBe(true);
    expect(isIpInCidr('128.0.0.0', '0.0.0.0/1')).toBe(false);
  });
});

describe('isIpInCidr — IPv4 parse edge cases', () => {
  it('leading zeros rejected (octal attack prevention)', () => {
    expect(isIpInCidr('010.0.0.1', '10.0.0.0/8')).toBe(false);
  });

  it('too many octets → false', () => {
    expect(isIpInCidr('10.0.0.1.1', '10.0.0.0/8')).toBe(false);
  });

  it('too few octets → false', () => {
    expect(isIpInCidr('10.0.0', '10.0.0.0/8')).toBe(false);
  });

  it('negative octet → false', () => {
    expect(isIpInCidr('10.-1.0.1', '10.0.0.0/8')).toBe(false);
  });

  it('256 in octet → false', () => {
    expect(isIpInCidr('10.0.0.256', '10.0.0.0/8')).toBe(false);
  });

  it('non-numeric octet → false', () => {
    expect(isIpInCidr('10.0.abc.1', '10.0.0.0/8')).toBe(false);
  });

  it('negative prefix → false', () => {
    expect(isIpInCidr('10.0.0.1', '10.0.0.0/-1')).toBe(false);
  });

  it('NaN prefix → false', () => {
    expect(isIpInCidr('10.0.0.1', '10.0.0.0/abc')).toBe(false);
  });

  it('invalid CIDR IP → false', () => {
    expect(isIpInCidr('10.0.0.1', 'invalid/8')).toBe(false);
  });
});

describe('isIpInCidr — IPv6 prefix boundaries', () => {
  it('/127 → 2 addresses', () => {
    expect(isIpInCidr('2001:db8::0', '2001:db8::/127')).toBe(true);
    expect(isIpInCidr('2001:db8::1', '2001:db8::/127')).toBe(true);
    expect(isIpInCidr('2001:db8::2', '2001:db8::/127')).toBe(false);
  });

  it('/64 → network prefix boundary', () => {
    expect(isIpInCidr('2001:db8:0:0:ffff:ffff:ffff:ffff', '2001:db8::/64')).toBe(true);
    expect(isIpInCidr('2001:db8:0:1::', '2001:db8::/64')).toBe(false);
  });

  it('/0 → all IPv6 addresses match', () => {
    expect(isIpInCidr('ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', '::/0')).toBe(true);
    expect(isIpInCidr('::', '::/0')).toBe(true);
  });

  it(':: at end of CIDR → valid', () => {
    expect(isIpInCidr('2001:db8::1', '2001:db8::/32')).toBe(true);
  });

  it('full IPv6 notation matches :: shorthand CIDR', () => {
    expect(isIpInCidr('0000:0000:0000:0000:0000:0000:0000:0001', '::1/128')).toBe(true);
  });
});

describe('isIpInCidr — IPv6 parse edge cases', () => {
  it('multiple :: → false (invalid IPv6)', () => {
    expect(isIpInCidr('1::2::3', '1::2/128')).toBe(false);
  });

  it('too many groups (9 groups) → false', () => {
    expect(isIpInCidr('1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7:8/128')).toBe(false);
  });

  it('group value > 0xffff → false', () => {
    expect(isIpInCidr('10000::1', '10000::/128')).toBe(false);
  });

  it('invalid hex chars → false', () => {
    expect(isIpInCidr('gggg::1', '::1/128')).toBe(false);
  });

  it('empty string IP → false', () => {
    expect(isIpInCidr('', '::1/128')).toBe(false);
  });

  it('prefix exactly 0 → match all of same version', () => {
    expect(isIpInCidr('::1', '::/0')).toBe(true);
  });

  it('prefix exactly 128 → exact match only', () => {
    expect(isIpInCidr('::1', '::1/128')).toBe(true);
    expect(isIpInCidr('::2', '::1/128')).toBe(false);
  });
});

// ─── Mutation-killing: validation edge cases ────────────────────────────────

describe('validateInsert — mutation-killing', () => {
  it('schemaless insert returns valid=true AND errors={}', () => {
    const result = validateInsert({ anything: 'goes' });
    expect(result).toEqual({ valid: true, errors: {} });
  });

  it('id field in data is silently skipped (auto-managed)', () => {
    const result = validateInsert(
      { id: 'custom-id', title: 'hello' },
      { title: { type: 'string' } },
    );
    expect(result.valid).toBe(true);
    expect(result.errors).not.toHaveProperty('id');
  });

  it('required field with null value → invalid', () => {
    const result = validateInsert(
      { name: null },
      { name: { type: 'string', required: true } },
    );
    expect(result.valid).toBe(false);
    expect(result.errors.name).toContain('required');
  });

  it('optional field with null value → valid (skipped)', () => {
    const result = validateInsert(
      { bio: null },
      { bio: { type: 'string' } },
    );
    expect(result.valid).toBe(true);
  });

  it('optional field with undefined value → valid (skipped)', () => {
    const result = validateInsert(
      {},
      { bio: { type: 'string' } },
    );
    expect(result.valid).toBe(true);
  });

  it('string at exactly min length → valid', () => {
    const result = validateInsert(
      { name: 'ab' },
      { name: { type: 'string', min: 2 } },
    );
    expect(result.valid).toBe(true);
  });

  it('string one below min length → invalid', () => {
    const result = validateInsert(
      { name: 'a' },
      { name: { type: 'string', min: 2 } },
    );
    expect(result.valid).toBe(false);
  });

  it('string at exactly max length → valid', () => {
    const result = validateInsert(
      { name: 'abc' },
      { name: { type: 'string', max: 3 } },
    );
    expect(result.valid).toBe(true);
  });

  it('string one above max length → invalid', () => {
    const result = validateInsert(
      { name: 'abcd' },
      { name: { type: 'string', max: 3 } },
    );
    expect(result.valid).toBe(false);
  });

  it('enum join separator → error shows comma-space between values', () => {
    const result = validateInsert(
      { status: 'bad' },
      { status: { type: 'string', enum: ['a', 'b', 'c'] } },
    );
    expect(result.errors.status).toBe('Must be one of: a, b, c');
  });

  it('number exactly at min → valid', () => {
    const result = validateInsert(
      { score: 10 },
      { score: { type: 'number', min: 10 } },
    );
    expect(result.valid).toBe(true);
  });

  it('number one below min → invalid', () => {
    const result = validateInsert(
      { score: 9 },
      { score: { type: 'number', min: 10 } },
    );
    expect(result.valid).toBe(false);
  });

  it('number exactly at max → valid', () => {
    const result = validateInsert(
      { score: 100 },
      { score: { type: 'number', max: 100 } },
    );
    expect(result.valid).toBe(true);
  });

  it('number one above max → invalid', () => {
    const result = validateInsert(
      { score: 101 },
      { score: { type: 'number', max: 100 } },
    );
    expect(result.valid).toBe(false);
  });

  it('number with both min and max, value in range → valid', () => {
    const result = validateInsert(
      { score: 50 },
      { score: { type: 'number', min: 0, max: 100 } },
    );
    expect(result.valid).toBe(true);
  });

  it('number with no min/max constraint → valid for any number', () => {
    const result = validateInsert(
      { score: -999 },
      { score: { type: 'number' } },
    );
    expect(result.valid).toBe(true);
  });

  it('datetime with invalid string → invalid', () => {
    const result = validateInsert(
      { date: 'not-a-date' },
      { date: { type: 'datetime' } },
    );
    expect(result.valid).toBe(false);
    expect(result.errors.date).toContain('Invalid datetime');
  });

  it('datetime with valid ISO string → valid', () => {
    const result = validateInsert(
      { date: '2024-01-15T10:30:00Z' },
      { date: { type: 'datetime' } },
    );
    expect(result.valid).toBe(true);
  });
});

describe('validateUpdate — mutation-killing', () => {
  it('schemaless update returns valid=true AND errors={}', () => {
    const result = validateUpdate({ anything: 'goes' });
    expect(result).toEqual({ valid: true, errors: {} });
  });

  it('id field in data is skipped (auto-managed)', () => {
    const result = validateUpdate(
      { id: 'new-id', title: 'updated' },
      { title: { type: 'string' } },
    );
    expect(result.valid).toBe(true);
  });

  it('null value for optional field → valid (skipped)', () => {
    const result = validateUpdate(
      { bio: null },
      { bio: { type: 'string' } },
    );
    expect(result.valid).toBe(true);
  });

  it('undefined value for field → valid (skipped)', () => {
    const result = validateUpdate(
      { bio: undefined },
      { bio: { type: 'string' } },
    );
    expect(result.valid).toBe(true);
  });

  it('null for required field → invalid', () => {
    const result = validateUpdate(
      { name: null },
      { name: { type: 'string', required: true } },
    );
    expect(result.valid).toBe(false);
  });

  it('undefined for required field → invalid', () => {
    const result = validateUpdate(
      { name: undefined },
      { name: { type: 'string', required: true } },
    );
    expect(result.valid).toBe(false);
  });
});

describe('isIpInCidr — mask boundary precision', () => {
  it('IPv4 /31 boundary: .0 and .1 match, .2 does not', () => {
    expect(isIpInCidr('192.168.1.0', '192.168.1.0/31')).toBe(true);
    expect(isIpInCidr('192.168.1.1', '192.168.1.0/31')).toBe(true);
    expect(isIpInCidr('192.168.1.2', '192.168.1.0/31')).toBe(false);
  });

  it('IPv4 /25 boundary: .127 matches, .128 does not', () => {
    expect(isIpInCidr('10.0.0.127', '10.0.0.0/25')).toBe(true);
    expect(isIpInCidr('10.0.0.128', '10.0.0.0/25')).toBe(false);
  });

  it('IPv4 /1 boundary: 127.x matches, 128.x does not', () => {
    expect(isIpInCidr('127.255.255.255', '0.0.0.0/1')).toBe(true);
    expect(isIpInCidr('128.0.0.0', '0.0.0.0/1')).toBe(false);
  });

  it('IPv6 :: and 0:0:0:0:0:0:0:1 are equivalent', () => {
    expect(isIpInCidr('0:0:0:0:0:0:0:1', '::1/128')).toBe(true);
    expect(isIpInCidr('::1', '0:0:0:0:0:0:0:1/128')).toBe(true);
  });

  it('IPv4 octal prevention: 010 is not 10', () => {
    // parseIPv4 uses String(n) comparison to reject leading zeros
    expect(isIpInCidr('010.0.0.1', '10.0.0.0/8')).toBe(false);
  });

  it('IPv6 /64 remainBits=0 scenario (exact byte boundary)', () => {
    // /64 means 8 full bytes, 0 remain bits
    expect(isIpInCidr('2001:0db8:0000:0000:ffff:ffff:ffff:ffff', '2001:0db8::/64')).toBe(true);
    expect(isIpInCidr('2001:0db8:0000:0001:0000:0000:0000:0000', '2001:0db8::/64')).toBe(false);
  });

  it('IPv6 /65 remainBits=1 scenario (1 bit past byte boundary)', () => {
    // /65 means 8 full bytes, 1 remain bit in byte[8]
    expect(isIpInCidr('2001:db8::7fff:ffff:ffff:ffff', '2001:db8::/65')).toBe(true);
    expect(isIpInCidr('2001:db8::8000:0:0:0', '2001:db8::/65')).toBe(false);
  });
});
