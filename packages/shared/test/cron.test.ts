import { describe, expect, it } from 'vitest';
import {
  SYSTEM_MAINTENANCE_CRON,
  SYSTEM_MAINTENANCE_SCHEDULE_ID,
  appFunctionScheduleIdentity,
  extraCronScheduleIdentity,
  getNextFireTime,
  getPreviousFireTime,
  matchesCron,
  normalizeCronExpression,
  parseCron,
  parseCronField,
  pluginFunctionScheduleIdentity,
} from '../src/cron.js';
import {
  MAX_MANAGED_CRON_UTF8_BYTES,
  MAX_MANAGED_SCHEDULE_TARGET_ID_UTF8_BYTES,
  assertManagedCronWireBound,
  assertManagedScheduleTargetIdWireBound,
  truncateUtf8,
  utf8ByteLength,
} from '../src/self-host-schedule.js';

describe('portable cron grammar', () => {
  it('normalizes whitespace and supports numeric lists, ranges, and steps', () => {
    expect(normalizeCronExpression('  0   3  * * * ')).toBe('0 3 * * *');
    expect([...parseCronField('1,5-9/2,12/4', 0, 15)]).toEqual([1, 5, 7, 9, 12]);
  });

  it('uses Cloudflare weekday numbers while matching JavaScript UTC days', () => {
    const sunday = parseCron('0 0 * * 1');
    const saturday = parseCron('0 0 * * 7');
    expect(matchesCron(new Date('2024-06-16T00:00:00Z'), sunday)).toBe(true);
    expect(matchesCron(new Date('2024-06-15T00:00:00Z'), saturday)).toBe(true);
    expect(() => parseCron('0 0 * * 0')).toThrow(/1-7/);
  });

  it('finds the inclusive latest UTC boundary for sparse and stepped schedules', () => {
    expect(getPreviousFireTime(
      parseCron('*/15 * * * *'),
      new Date('2026-07-16T12:37:45.000Z'),
    )).toBe(Date.parse('2026-07-16T12:30:00.000Z'));
    expect(getPreviousFireTime(
      parseCron('0 0 29 2 *'),
      new Date('2103-12-31T23:59:59.000Z'),
    )).toBe(Date.parse('2096-02-29T00:00:00.000Z'));
  });

  it('keeps day-of-month and weekday matching conjunctive', () => {
    const firstMonday = parseCron('0 0 1 * 2');
    expect(getPreviousFireTime(
      firstMonday,
      new Date('2026-07-16T12:00:00.000Z'),
    )).toBe(Date.parse('2026-06-01T00:00:00.000Z'));
  });

  it('searches the complete Gregorian cycle for sparse weekday-constrained leap days', () => {
    const fridayLeapDay = parseCron('0 0 29 2 6');
    expect(getPreviousFireTime(
      fridayLeapDay,
      new Date('2027-01-01T00:00:00.000Z'),
    )).toBe(Date.parse('2008-02-29T00:00:00.000Z'));
    expect(getNextFireTime(
      fridayLeapDay,
      new Date('2008-02-29T00:00:00.000Z'),
    )).toBe(Date.parse('2036-02-29T00:00:00.000Z'));
  });

  it('keeps previous inclusive and next exclusive at an exact minute boundary', () => {
    const schedule = parseCron('*/15 * * * *');
    const boundary = new Date('2026-07-16T12:30:00.000Z');
    expect(getPreviousFireTime(schedule, boundary)).toBe(boundary.getTime());
    expect(getNextFireTime(schedule, boundary)).toBe(Date.parse('2026-07-16T12:45:00.000Z'));
  });

  it('fails a calendar combination that has no realizable UTC date', () => {
    const impossible = parseCron('0 0 31 2 *');
    expect(() => getPreviousFireTime(
      impossible,
      new Date('2026-07-16T12:00:00.000Z'),
    )).toThrow(/400-year Gregorian calendar cycle/);
    expect(() => getNextFireTime(
      impossible,
      new Date('2026-07-16T12:00:00.000Z'),
    )).toThrow(/400-year Gregorian calendar cycle/);
  });

  it.each([
    '60 * * * *',
    '* 24 * * *',
    '* * 0 * *',
    '* * * 13 *',
    '* * * * 8',
    '0 3 9-2 * *',
    '0 3 */0 * *',
    '0 3 L * *',
    '0 3 * JAN *',
    '0 3 * * MON',
    '0 3 * * 2#1',
  ])('rejects unsupported or out-of-bounds expression %s', (expression) => {
    expect(() => parseCron(expression)).toThrow();
  });

  it('builds the stable identities shared by manifests and runtime routing', () => {
    expect(appFunctionScheduleIdentity('jobs', 'default')).toBe('app-function:jobs#default');
    expect(appFunctionScheduleIdentity('/', 'second')).toBe('app-function:/#second');
    expect(pluginFunctionScheduleIdentity('audit', 'rotate')).toBe('plugin-function:audit/rotate');
    expect(extraCronScheduleIdentity(' 0  3 * * * ')).toBe('extra-cron:0 3 * * *');
    expect({ id: SYSTEM_MAINTENANCE_SCHEDULE_ID, cron: SYSTEM_MAINTENANCE_CRON }).toEqual({
      id: 'system:maintenance',
      cron: '0 3 * * *',
    });
  });
});

describe('self-host schedule wire bounds', () => {
  it('enforces exact and over-limit UTF-8 cron and target boundaries', () => {
    const exactUnicode = `${'가'.repeat(85)}a`;
    expect(utf8ByteLength(exactUnicode)).toBe(MAX_MANAGED_CRON_UTF8_BYTES);
    expect(MAX_MANAGED_SCHEDULE_TARGET_ID_UTF8_BYTES).toBe(MAX_MANAGED_CRON_UTF8_BYTES);
    expect(() => assertManagedCronWireBound(exactUnicode)).not.toThrow();
    expect(() => assertManagedScheduleTargetIdWireBound(exactUnicode)).not.toThrow();
    expect(() => assertManagedCronWireBound(`${exactUnicode}b`)).toThrow(/1-256 UTF-8 bytes/);
    expect(() => assertManagedScheduleTargetIdWireBound(`${exactUnicode}b`)).toThrow(/1-256 UTF-8 bytes/);
    expect(truncateUtf8(`${exactUnicode}b`, MAX_MANAGED_CRON_UTF8_BYTES)).toBe(exactUnicode);
  });

  it('accepts a valid portable cron at the raw byte cap and rejects one byte over', () => {
    const normalized = `${Array.from({ length: 124 }, () => '0').join(',')} * * * *`;
    expect(utf8ByteLength(normalized)).toBe(MAX_MANAGED_CRON_UTF8_BYTES - 1);
    expect(normalizeCronExpression(` ${normalized}`)).toBe(normalized);
    expect(() => normalizeCronExpression(`  ${normalized}`)).toThrow(/1-256 UTF-8 bytes/);
  });
});
