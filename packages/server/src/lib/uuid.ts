/**
 * UUID v7 Monotonic generation utility.
 * Manual implementation using crypto.getRandomValues() — no external dependency.
 * RFC 9562 compliant: 48-bit unix_ts_ms + 4-bit version(7) + 12-bit rand_a + 2-bit var(10) + 62-bit rand_b.
 * Time-ordered for natural cursor pagination on PK.
 */

const HEX = '0123456789abcdef';
let lastTimestamp = -1;
let lastBytes: Uint8Array | null = null;

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += HEX[bytes[i] >> 4] + HEX[bytes[i] & 0x0f];
  }
  return hex;
}

function writeTimestamp(bytes: Uint8Array, timestamp: number): void {
  bytes[0] = (timestamp / 2 ** 40) & 0xff;
  bytes[1] = (timestamp / 2 ** 32) & 0xff;
  bytes[2] = (timestamp / 2 ** 24) & 0xff;
  bytes[3] = (timestamp / 2 ** 16) & 0xff;
  bytes[4] = (timestamp / 2 ** 8) & 0xff;
  bytes[5] = timestamp & 0xff;
}

function createRandomUuidBytes(timestamp: number): Uint8Array {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  writeTimestamp(bytes, timestamp);

  // version: 4 bits = 0111 (7)
  bytes[6] = (bytes[6] & 0x0f) | 0x70;

  // variant: 2 bits = 10
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return bytes;
}

function incrementMonotonicTail(bytes: Uint8Array): boolean {
  for (let i = 15; i >= 6; i--) {
    const mask = i === 6 ? 0x0f : i === 8 ? 0x3f : 0xff;
    const fixedBits = i === 6 ? 0x70 : i === 8 ? 0x80 : 0x00;
    const value = bytes[i] & mask;

    if (value < mask) {
      bytes[i] = fixedBits | (value + 1);
      return true;
    }

    bytes[i] = fixedBits;
  }

  return false;
}

/**
 * Generate a UUID v7 string.
 * Format: xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx
 * where y is one of [8, 9, a, b]
 */
export function generateId(): string {
  let timestamp = Date.now();
  if (timestamp < lastTimestamp) {
    timestamp = lastTimestamp;
  }

  let bytes: Uint8Array;
  if (lastBytes !== null && timestamp === lastTimestamp) {
    bytes = lastBytes.slice();
    if (!incrementMonotonicTail(bytes)) {
      timestamp = lastTimestamp + 1;
      bytes = createRandomUuidBytes(timestamp);
    }
  } else {
    bytes = createRandomUuidBytes(timestamp);
  }

  lastTimestamp = timestamp;
  lastBytes = bytes;

  const hex = bytesToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
