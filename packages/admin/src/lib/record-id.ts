export const CUSTOM_RECORD_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export const CUSTOM_RECORD_ID_MESSAGE =
	'Record ID must use English letters, numbers, hyphen (-), or underscore (_).';

export function validateCustomRecordId(value: string): string | null {
	if (!value) return null;
	return CUSTOM_RECORD_ID_PATTERN.test(value) ? null : CUSTOM_RECORD_ID_MESSAGE;
}
