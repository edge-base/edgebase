/**
 * Cron expression parser and next-fire-time calculator.
 *
 * Supports standard 5-field cron: minute hour dayOfMonth month dayOfWeek
 * Examples:
 *   '0 9 * * *'     - every day at 09:00
 *   '* /5 * * * *'  - every 5 minutes
 *   '30 2 * * 1'    - every Monday at 02:30
 *   '0 0 1 * *'     - first day of every month at midnight
 */

// ─── Types ───

export interface CronSchedule {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
}

export interface ParsedScheduleFunction {
  name: string;
  cron: string;
  schedule: CronSchedule;
  lastRunAt?: number;
}

// ─── Parser ───

/**
 * Parse a cron field into a Set of matching values.
 * Supports: *, N, N-M, N/step, star/step, N-M/step, lists (comma-separated).
 */
export function parseCronField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();

  for (const part of field.split(',')) {
    const trimmed = part.trim();

    if (trimmed === '*') {
      for (let i = min; i <= max; i++) values.add(i);
      continue;
    }

    // */step
    const stepMatch = trimmed.match(/^(\*|(\d+)-(\d+))\/(\d+)$/);
    if (stepMatch) {
      const step = parseInt(stepMatch[4], 10);
      if (step <= 0) throw new Error(`Invalid cron step: ${step}`);
      let start = min;
      let end = max;
      if (stepMatch[2] !== undefined && stepMatch[3] !== undefined) {
        start = parseInt(stepMatch[2], 10);
        end = parseInt(stepMatch[3], 10);
      }
      for (let i = start; i <= end; i += step) values.add(i);
      continue;
    }

    // N-M range
    const rangeMatch = trimmed.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      for (let i = start; i <= end; i++) values.add(i);
      continue;
    }

    // Single value
    const num = parseInt(trimmed, 10);
    if (isNaN(num) || num < min || num > max) {
      throw new Error(`Invalid cron value '${trimmed}' (${min}-${max})`);
    }
    values.add(num);
  }

  return values;
}

/**
 * Parse a 5-field cron expression.
 */
export function parseCron(expression: string): CronSchedule {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${fields.length}`);
  }

  return {
    minutes: parseCronField(fields[0], 0, 59),
    hours: parseCronField(fields[1], 0, 23),
    daysOfMonth: parseCronField(fields[2], 1, 31),
    months: parseCronField(fields[3], 1, 12),
    daysOfWeek: parseCronField(fields[4], 0, 6), // 0=Sunday
  };
}

/**
 * Check if a Date matches a cron schedule.
 */
export function matchesCron(date: Date, schedule: CronSchedule): boolean {
  return (
    schedule.minutes.has(date.getUTCMinutes()) &&
    schedule.hours.has(date.getUTCHours()) &&
    schedule.daysOfMonth.has(date.getUTCDate()) &&
    schedule.months.has(date.getUTCMonth() + 1) &&
    schedule.daysOfWeek.has(date.getUTCDay())
  );
}

// ─── Next Fire Time ───

/**
 * Calculate the next fire time from a given date for a cron schedule.
 * Scans forward minute-by-minute up to 366 days.
 * Returns timestamp in milliseconds.
 */
export function getNextFireTime(schedule: CronSchedule, from: Date): number {
  // Start from the next minute
  const next = new Date(from.getTime());
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(next.getUTCMinutes() + 1);

  const maxIterations = 366 * 24 * 60; // 1 year of minutes

  for (let i = 0; i < maxIterations; i++) {
    if (matchesCron(next, schedule)) {
      return next.getTime();
    }
    next.setUTCMinutes(next.getUTCMinutes() + 1);
  }

  throw new Error('Could not find next fire time within 366 days');
}

// ─── Alarm Multiplexer ───

/**
 * Given multiple schedule functions, find the earliest next fire time.
 * Returns the timestamp and the list of functions that fire at that time.
 */
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
