/**
 * 서버 단위 테스트 — lib/cron.ts
 *
 * 실행: cd packages/server && npx vitest run src/__tests__/cron.test.ts
 *
 * 테스트 대상:
 *   parseCronField / parseCron / matchesCron / getNextFireTime / getNextAlarm
 */

import { describe, it, expect } from 'vitest';
import {
  parseCronField,
  parseCron,
  matchesCron,
  getNextFireTime,
  getNextAlarm,
  type ParsedScheduleFunction,
} from '../lib/cron.js';

// ─── A. parseCronField ──────────────────────────────────────────────────────

describe('parseCronField', () => {
  it('* → all values in range', () => {
    const result = parseCronField('*', 0, 59);
    expect(result.size).toBe(60);
    expect(result.has(0)).toBe(true);
    expect(result.has(59)).toBe(true);
  });

  it('single value', () => {
    const result = parseCronField('5', 0, 59);
    expect(result.size).toBe(1);
    expect(result.has(5)).toBe(true);
  });

  it('range N-M', () => {
    const result = parseCronField('10-15', 0, 59);
    expect(result.size).toBe(6);
    for (let i = 10; i <= 15; i++) expect(result.has(i)).toBe(true);
    expect(result.has(9)).toBe(false);
    expect(result.has(16)).toBe(false);
  });

  it('*/step (star step)', () => {
    const result = parseCronField('*/5', 0, 59);
    expect(result.has(0)).toBe(true);
    expect(result.has(5)).toBe(true);
    expect(result.has(10)).toBe(true);
    expect(result.has(55)).toBe(true);
    expect(result.has(3)).toBe(false);
  });

  it('range/step (N-M/step)', () => {
    const result = parseCronField('0-30/5', 0, 59);
    expect([...result].sort((a, b) => a - b)).toEqual([0, 5, 10, 15, 20, 25, 30]);
  });

  it('comma-separated list', () => {
    const result = parseCronField('1,15,30', 0, 59);
    expect(result.size).toBe(3);
    expect(result.has(1)).toBe(true);
    expect(result.has(15)).toBe(true);
    expect(result.has(30)).toBe(true);
  });

  it('mixed list: value, range, step', () => {
    const result = parseCronField('0,10-12,*/20', 0, 59);
    // 0, 10, 11, 12, 0, 20, 40 → unique: {0, 10, 11, 12, 20, 40}
    expect(result.has(0)).toBe(true);
    expect(result.has(10)).toBe(true);
    expect(result.has(11)).toBe(true);
    expect(result.has(12)).toBe(true);
    expect(result.has(20)).toBe(true);
    expect(result.has(40)).toBe(true);
  });

  it('step 0 → throws', () => {
    expect(() => parseCronField('*/0', 0, 59)).toThrow('Invalid cron step');
  });

  it('out of range single value → throws', () => {
    expect(() => parseCronField('60', 0, 59)).toThrow();
  });

  it('below min → throws', () => {
    expect(() => parseCronField('-1', 0, 59)).toThrow();
  });

  it('non-numeric → throws', () => {
    expect(() => parseCronField('abc', 0, 59)).toThrow();
  });

  it('day of week 0-6', () => {
    const result = parseCronField('0', 0, 6);
    expect(result.has(0)).toBe(true);
  });

  it('month 1-12 single', () => {
    const result = parseCronField('12', 1, 12);
    expect(result.has(12)).toBe(true);
  });

  it('whitespace in comma list trimmed', () => {
    const result = parseCronField('1, 2, 3', 0, 59);
    expect(result.size).toBe(3);
  });
});

// ─── B. parseCron ───────────────────────────────────────────────────────────

describe('parseCron', () => {
  it('every day at 09:00 → minute=0, hour=9', () => {
    const sched = parseCron('0 9 * * *');
    expect(sched.minutes.has(0)).toBe(true);
    expect(sched.minutes.size).toBe(1);
    expect(sched.hours.has(9)).toBe(true);
    expect(sched.hours.size).toBe(1);
    expect(sched.daysOfMonth.size).toBe(31);
    expect(sched.months.size).toBe(12);
    expect(sched.daysOfWeek.size).toBe(7);
  });

  it('every 5 minutes', () => {
    const sched = parseCron('*/5 * * * *');
    expect(sched.minutes.size).toBe(12); // 0,5,10,...,55
    expect(sched.minutes.has(0)).toBe(true);
    expect(sched.minutes.has(55)).toBe(true);
    expect(sched.minutes.has(3)).toBe(false);
  });

  it('every Monday at 02:30', () => {
    const sched = parseCron('30 2 * * 1');
    expect(sched.minutes.has(30)).toBe(true);
    expect(sched.hours.has(2)).toBe(true);
    expect(sched.daysOfWeek.has(1)).toBe(true);
    expect(sched.daysOfWeek.size).toBe(1);
  });

  it('first day of every month at midnight', () => {
    const sched = parseCron('0 0 1 * *');
    expect(sched.minutes.has(0)).toBe(true);
    expect(sched.hours.has(0)).toBe(true);
    expect(sched.daysOfMonth.has(1)).toBe(true);
    expect(sched.daysOfMonth.size).toBe(1);
  });

  it('wrong number of fields → throws', () => {
    expect(() => parseCron('* * *')).toThrow('expected 5 fields');
  });

  it('6 fields → throws', () => {
    expect(() => parseCron('0 0 0 0 0 0')).toThrow('expected 5 fields');
  });

  it('extra whitespace is trimmed', () => {
    const sched = parseCron('  0  9  *  *  *  ');
    expect(sched.minutes.has(0)).toBe(true);
    expect(sched.hours.has(9)).toBe(true);
  });
});

// ─── C. matchesCron ─────────────────────────────────────────────────────────

describe('matchesCron', () => {
  it('matches exact time', () => {
    const sched = parseCron('30 14 * * *');
    // 2024-06-15 14:30 UTC is a Saturday (day 6)
    const date = new Date('2024-06-15T14:30:00Z');
    expect(matchesCron(date, sched)).toBe(true);
  });

  it('does not match wrong minute', () => {
    const sched = parseCron('30 14 * * *');
    const date = new Date('2024-06-15T14:31:00Z');
    expect(matchesCron(date, sched)).toBe(false);
  });

  it('does not match wrong hour', () => {
    const sched = parseCron('30 14 * * *');
    const date = new Date('2024-06-15T15:30:00Z');
    expect(matchesCron(date, sched)).toBe(false);
  });

  it('day of week matters', () => {
    const sched = parseCron('0 0 * * 1'); // Monday only
    // 2024-06-17 is Monday
    expect(matchesCron(new Date('2024-06-17T00:00:00Z'), sched)).toBe(true);
    // 2024-06-18 is Tuesday
    expect(matchesCron(new Date('2024-06-18T00:00:00Z'), sched)).toBe(false);
  });

  it('month matters', () => {
    const sched = parseCron('0 0 1 6 *'); // June 1st only
    expect(matchesCron(new Date('2024-06-01T00:00:00Z'), sched)).toBe(true);
    expect(matchesCron(new Date('2024-07-01T00:00:00Z'), sched)).toBe(false);
  });

  it('day of month matters', () => {
    const sched = parseCron('0 0 15 * *'); // 15th of each month
    expect(matchesCron(new Date('2024-06-15T00:00:00Z'), sched)).toBe(true);
    expect(matchesCron(new Date('2024-06-14T00:00:00Z'), sched)).toBe(false);
  });

  it('uses UTC methods', () => {
    const sched = parseCron('0 0 * * *'); // midnight UTC
    const date = new Date('2024-06-15T00:00:00Z');
    expect(matchesCron(date, sched)).toBe(true);
  });
});

// ─── D. getNextFireTime ─────────────────────────────────────────────────────

describe('getNextFireTime', () => {
  it('next minute for every-minute cron', () => {
    const sched = parseCron('* * * * *');
    const from = new Date('2024-06-15T10:30:00Z');
    const next = getNextFireTime(sched, from);
    expect(next).toBe(new Date('2024-06-15T10:31:00Z').getTime());
  });

  it('next day for daily cron', () => {
    const sched = parseCron('0 9 * * *');
    const from = new Date('2024-06-15T10:00:00Z'); // after 09:00
    const next = getNextFireTime(sched, from);
    expect(next).toBe(new Date('2024-06-16T09:00:00Z').getTime());
  });

  it('same day if before target time', () => {
    const sched = parseCron('0 14 * * *');
    const from = new Date('2024-06-15T10:00:00Z'); // before 14:00
    const next = getNextFireTime(sched, from);
    expect(next).toBe(new Date('2024-06-15T14:00:00Z').getTime());
  });

  it('skips to correct day of week', () => {
    const sched = parseCron('0 0 * * 1'); // Monday only
    // 2024-06-15 is Saturday → next Monday is June 17
    const from = new Date('2024-06-15T00:00:00Z');
    const next = getNextFireTime(sched, from);
    expect(next).toBe(new Date('2024-06-17T00:00:00Z').getTime());
  });

  it('month boundary: Dec 31 → Jan 1 next year', () => {
    const sched = parseCron('0 0 1 1 *'); // Jan 1st midnight
    const from = new Date('2024-12-31T23:59:00Z');
    const next = getNextFireTime(sched, from);
    expect(next).toBe(new Date('2025-01-01T00:00:00Z').getTime());
  });

  it('seconds are zeroed', () => {
    const sched = parseCron('* * * * *');
    const from = new Date('2024-06-15T10:30:45Z'); // 45 seconds
    const next = getNextFireTime(sched, from);
    const d = new Date(next);
    expect(d.getUTCSeconds()).toBe(0);
    expect(d.getUTCMilliseconds()).toBe(0);
  });
});

// ─── E. getNextAlarm ────────────────────────────────────────────────────────

describe('getNextAlarm', () => {
  it('empty schedules → null', () => {
    expect(getNextAlarm([], new Date())).toBe(null);
  });

  it('single schedule → returns its next fire time', () => {
    const sched = parseCron('0 9 * * *');
    const schedules: ParsedScheduleFunction[] = [
      { name: 'daily', cron: '0 9 * * *', schedule: sched },
    ];
    const from = new Date('2024-06-15T10:00:00Z');
    const result = getNextAlarm(schedules, from);
    expect(result).not.toBe(null);
    expect(result!.functions).toEqual(['daily']);
    expect(result!.time).toBe(new Date('2024-06-16T09:00:00Z').getTime());
  });

  it('multiple schedules → picks earliest', () => {
    const schedules: ParsedScheduleFunction[] = [
      { name: 'hourly', cron: '0 * * * *', schedule: parseCron('0 * * * *') },
      { name: 'daily', cron: '0 9 * * *', schedule: parseCron('0 9 * * *') },
    ];
    const from = new Date('2024-06-15T10:30:00Z');
    const result = getNextAlarm(schedules, from);
    expect(result!.functions).toEqual(['hourly']);
    // Next hour is 11:00
    expect(result!.time).toBe(new Date('2024-06-15T11:00:00Z').getTime());
  });

  it('simultaneous fire times → groups function names', () => {
    const schedules: ParsedScheduleFunction[] = [
      { name: 'jobA', cron: '0 12 * * *', schedule: parseCron('0 12 * * *') },
      { name: 'jobB', cron: '0 12 * * *', schedule: parseCron('0 12 * * *') },
    ];
    const from = new Date('2024-06-15T10:00:00Z');
    const result = getNextAlarm(schedules, from);
    expect(result!.functions).toContain('jobA');
    expect(result!.functions).toContain('jobB');
    expect(result!.functions.length).toBe(2);
  });
});
