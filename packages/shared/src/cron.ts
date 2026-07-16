/**
 * EdgeBase's portable cron grammar.
 *
 * The grammar is intentionally the numeric subset shared by Cloudflare Cron
 * Triggers and the self-hosted scheduler: five UTC fields, with `*`, lists,
 * ranges, and positive steps. Provider-only aliases and `L`, `W`, or `#`
 * syntax are rejected so a schedule cannot deploy successfully while failing
 * in another EdgeBase runtime.
 */

export interface CronSchedule {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  /** JavaScript UTC day values (0=Sunday through 6=Saturday). */
  daysOfWeek: Set<number>;
}

export interface ParsedScheduleFunction {
  name: string;
  cron: string;
  schedule: CronSchedule;
  lastRunAt?: number;
}

/** Stable managed-schedule identity shared by build manifests and runtimes. */
export const SYSTEM_MAINTENANCE_SCHEDULE_ID = 'system:maintenance';
/** The built-in platform maintenance boundary is daily at 03:00 UTC. */
export const SYSTEM_MAINTENANCE_CRON = '0 3 * * *';

export function appFunctionScheduleIdentity(route: string, exportName: string): string {
  const identity = `app-function:${route || '/'}#${exportName}`;
  assertManagedScheduleTargetIdWireBound(identity, 'App schedule identity');
  return identity;
}

export function pluginFunctionScheduleIdentity(pluginName: string, functionName: string): string {
  const identity = `plugin-function:${pluginName}/${functionName}`;
  assertManagedScheduleTargetIdWireBound(identity, 'Plugin schedule identity');
  return identity;
}

export function extraCronScheduleIdentity(expression: string): string {
  const identity = `extra-cron:${normalizeCronExpression(expression)}`;
  assertManagedScheduleTargetIdWireBound(identity, 'Extra-cron schedule identity');
  return identity;
}

function assertCronValue(value: number, min: number, max: number, raw: string): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Invalid cron value '${raw}' (${min}-${max})`);
  }
}

/** Parse one numeric cron field. */
export function parseCronField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();

  for (const rawPart of field.split(',')) {
    const part = rawPart.trim();
    if (!part) throw new Error('Invalid empty cron field segment');

    const match = part.match(/^(\*|\d+|\d+-\d+)(?:\/(\d+))?$/);
    if (!match) {
      throw new Error(
        `Unsupported cron field '${part}'. EdgeBase supports only numeric values, '*', lists, ranges, and steps.`,
      );
    }

    const base = match[1];
    const step = match[2] === undefined ? 1 : Number(match[2]);
    if (!Number.isInteger(step) || step <= 0) {
      throw new Error(`Invalid cron step: ${match[2]}`);
    }

    let start: number;
    let end: number;
    if (base === '*') {
      start = min;
      end = max;
    } else if (base.includes('-')) {
      const [rawStart, rawEnd] = base.split('-');
      start = Number(rawStart);
      end = Number(rawEnd);
      assertCronValue(start, min, max, rawStart);
      assertCronValue(end, min, max, rawEnd);
      if (start > end) {
        throw new Error(`Invalid cron range '${base}': start must not exceed end`);
      }
    } else {
      start = Number(base);
      assertCronValue(start, min, max, base);
      // Cloudflare treats N/step as a stepped range from N through the field max.
      end = match[2] === undefined ? start : max;
    }

    for (let value = start; value <= end; value += step) values.add(value);
  }

  return values;
}

/** Parse a portable five-field UTC cron expression. Weekdays use 1=Sunday through 7=Saturday. */
export function parseCron(expression: string): CronSchedule {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${fields.length}`);
  }

  const providerDaysOfWeek = parseCronField(fields[4], 1, 7);
  return {
    minutes: parseCronField(fields[0], 0, 59),
    hours: parseCronField(fields[1], 0, 23),
    daysOfMonth: parseCronField(fields[2], 1, 31),
    months: parseCronField(fields[3], 1, 12),
    daysOfWeek: new Set([...providerDaysOfWeek].map((day) => day - 1)),
  };
}

/** Validate and normalize insignificant outer/inter-field whitespace. */
export function normalizeCronExpression(expression: string): string {
  assertManagedCronWireBound(expression, 'Cron expression');
  parseCron(expression);
  const normalized = expression.trim().split(/\s+/).join(' ');
  assertManagedCronWireBound(normalized, 'Normalized cron expression');
  return normalized;
}

export function matchesCron(date: Date, schedule: CronSchedule): boolean {
  return (
    schedule.minutes.has(date.getUTCMinutes())
    && schedule.hours.has(date.getUTCHours())
    && schedule.daysOfMonth.has(date.getUTCDate())
    && schedule.months.has(date.getUTCMonth() + 1)
    && schedule.daysOfWeek.has(date.getUTCDay())
  );
}

const GREGORIAN_CALENDAR_CYCLE_YEARS = 400;

function sortedCronValues(values: Set<number>, direction: 1 | -1): number[] {
  return [...values].sort((left, right) => direction * (left - right));
}

function utcCalendarDay(year: number, month: number, day: number): Date {
  // Date.UTC treats years 0-99 as 1900-1999. setUTCFullYear preserves the
  // actual calendar year and still lets us reject normalized invalid dates.
  const candidate = new Date(0);
  candidate.setUTCHours(0, 0, 0, 0);
  candidate.setUTCFullYear(year, month - 1, day);
  return candidate;
}

function findCalendarFireTime(
  schedule: CronSchedule,
  from: Date,
  direction: 1 | -1,
): number {
  const fromTime = from.getTime();
  if (!Number.isFinite(fromTime)) throw new Error('Cron reference time must be finite');

  const startYear = from.getUTCFullYear();
  const months = sortedCronValues(schedule.months, direction);
  const days = sortedCronValues(schedule.daysOfMonth, direction);
  const hours = sortedCronValues(schedule.hours, direction);
  const minutes = sortedCronValues(schedule.minutes, direction);

  // The Gregorian weekday/date pattern repeats every 400 years. Include the
  // matching endpoint year so a reference immediately beyond the only usable
  // boundary in its cycle can still reach the equivalent boundary one full
  // cycle away.
  for (let yearOffset = 0; yearOffset <= GREGORIAN_CALENDAR_CYCLE_YEARS; yearOffset += 1) {
    const year = startYear + direction * yearOffset;
    for (const month of months) {
      for (const day of days) {
        const calendarDay = utcCalendarDay(year, month, day);
        if (
          !Number.isFinite(calendarDay.getTime())
          || calendarDay.getUTCFullYear() !== year
          || calendarDay.getUTCMonth() + 1 !== month
          || calendarDay.getUTCDate() !== day
          || !schedule.daysOfWeek.has(calendarDay.getUTCDay())
        ) {
          continue;
        }
        for (const hour of hours) {
          for (const minute of minutes) {
            const candidate = new Date(calendarDay.getTime());
            candidate.setUTCHours(hour, minute, 0, 0);
            const candidateTime = candidate.getTime();
            if (
              Number.isFinite(candidateTime)
              && (direction === 1 ? candidateTime > fromTime : candidateTime <= fromTime)
            ) {
              return candidateTime;
            }
          }
        }
      }
    }
  }

  throw new Error('Could not find fire time within one 400-year Gregorian calendar cycle');
}

/** Return the first matching UTC minute strictly after `from`. */
export function getNextFireTime(schedule: CronSchedule, from: Date): number {
  return findCalendarFireTime(schedule, from, 1);
}

/**
 * Return the latest matching UTC minute at or before `from`.
 *
 * Calendar-candidate search rather than per-minute iteration keeps sparse
 * schedules bounded while covering the complete Gregorian repeat cycle.
 */
export function getPreviousFireTime(schedule: CronSchedule, from: Date): number {
  return findCalendarFireTime(schedule, from, -1);
}

export function getNextAlarm(
  schedules: ParsedScheduleFunction[],
  from: Date,
): { time: number; functions: string[] } | null {
  if (schedules.length === 0) return null;

  let earliestTime = Infinity;
  let functions: string[] = [];
  for (const sched of schedules) {
    const nextTime = getNextFireTime(sched.schedule, from);
    if (nextTime < earliestTime) {
      earliestTime = nextTime;
      functions = [sched.name];
    } else if (nextTime === earliestTime) {
      functions.push(sched.name);
    }
  }

  return earliestTime === Infinity ? null : { time: earliestTime, functions };
}
import {
  assertManagedCronWireBound,
  assertManagedScheduleTargetIdWireBound,
} from './self-host-schedule.js';
