/** Shared, wire-visible bounds for the authenticated self-host scheduler. */
export const SELF_HOST_SCHEDULE_PROTOCOL_VERSION = 2 as const;
export const MAX_MANAGED_CRON_UTF8_BYTES = 256;
export const MAX_MANAGED_SCHEDULE_TARGET_ID_UTF8_BYTES = 256;
export const MAX_MANAGED_SCHEDULE_ENTRIES = 4_096;
export const MAX_SELF_HOST_SCHEDULE_ENVELOPES_PER_REQUEST = 64;
export const MAX_SELF_HOST_SCHEDULE_TARGETS_PER_REQUEST = 64;
export const MAX_SELF_HOST_SCHEDULE_REQUEST_BYTES = 128 * 1024;
export const MAX_SELF_HOST_SCHEDULE_RESPONSE_BYTES = 64 * 1024;
export const MAX_SELF_HOST_SCHEDULE_ERROR_UTF8_BYTES = 256;

export type SelfHostScheduleRequestMode = 'execute' | 'reconcile';

export interface SelfHostScheduleRequestTarget {
  id: string;
  mode: SelfHostScheduleRequestMode;
}

export interface SelfHostScheduleRequestEnvelope {
  cron: string;
  scheduledTime: number;
  targets: SelfHostScheduleRequestTarget[];
}

export interface SelfHostScheduleControlRequest {
  schemaVersion: typeof SELF_HOST_SCHEDULE_PROTOCOL_VERSION;
  generation: `sha256:${string}`;
  scheduleDigest: `sha256:${string}`;
  envelopes: SelfHostScheduleRequestEnvelope[];
}

export type SelfHostScheduleWireOutcomeStatus =
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'duplicate'
  | 'in_flight'
  | 'uncertain';

export interface SelfHostScheduleWireOutcome {
  cron: string;
  scheduledTime: number;
  itemId: string;
  lane: 'app-function' | 'plugin-function' | 'extra-cron' | 'system';
  status: SelfHostScheduleWireOutcomeStatus;
  attempt: number;
  executed: boolean;
  retryable: boolean;
  error?: string;
}

export interface SelfHostScheduleControlResponse {
  schemaVersion: typeof SELF_HOST_SCHEDULE_PROTOCOL_VERSION;
  outcome: 'ok' | 'incomplete';
  complete: boolean;
  generation: `sha256:${string}`;
  scheduleDigest: `sha256:${string}`;
  outcomes: SelfHostScheduleWireOutcome[];
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function truncateUtf8(value: string, maxBytes: number): string {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new Error('maxBytes must be a non-negative safe integer.');
  }
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength <= maxBytes) return value;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let end = maxBytes; end >= 0; end -= 1) {
    try {
      return decoder.decode(encoded.slice(0, end));
    } catch {
      // Move to the prior complete UTF-8 code point.
    }
  }
  return '';
}

export function assertManagedCronWireBound(value: string, context = 'cron'): void {
  const bytes = utf8ByteLength(value);
  if (bytes === 0 || bytes > MAX_MANAGED_CRON_UTF8_BYTES) {
    throw new Error(
      `${context} must encode to 1-${MAX_MANAGED_CRON_UTF8_BYTES} UTF-8 bytes.`,
    );
  }
}

export function assertManagedScheduleTargetIdWireBound(
  value: string,
  context = 'schedule target id',
): void {
  const bytes = utf8ByteLength(value);
  if (bytes === 0 || bytes > MAX_MANAGED_SCHEDULE_TARGET_ID_UTF8_BYTES) {
    throw new Error(
      `${context} must encode to 1-${MAX_MANAGED_SCHEDULE_TARGET_ID_UTF8_BYTES} UTF-8 bytes.`,
    );
  }
}
