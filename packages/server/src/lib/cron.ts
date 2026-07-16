/**
 * Runtime compatibility export for the shared portable cron implementation.
 * Build-time inventory validation and self-hosted dispatch must use exactly the
 * same grammar and UTC matching semantics.
 */
export {
  getNextAlarm,
  getNextFireTime,
  getPreviousFireTime,
  matchesCron,
  normalizeCronExpression,
  parseCron,
  parseCronField,
} from '@edge-base/shared';
export type { CronSchedule, ParsedScheduleFunction } from '@edge-base/shared';
