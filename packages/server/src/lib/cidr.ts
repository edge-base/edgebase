/**
 * Pure IPv4/IPv6 CIDR matching utility.
 * No external dependencies — suitable for Cloudflare Workers runtime.
 *
 * @module cidr
 */

/**
 * Check if an IP address falls within a CIDR range.
 * Supports IPv4 (e.g. '10.0.0.0/8') and IPv6 (e.g. '2001:db8::/32').
 *
 * Returns false for invalid inputs (malformed IP or CIDR).
 */
export function isIpInCidr(ip: string, cidr: string): boolean {
  const slashIdx = cidr.indexOf('/');
  if (slashIdx === -1) return false;

  const cidrIp = cidr.substring(0, slashIdx);
  const prefixLen = parseInt(cidr.substring(slashIdx + 1), 10);
  if (isNaN(prefixLen) || prefixLen < 0) return false;

  // Determine IP version
  const isIPv6Input = ip.includes(':');
  const isIPv6Cidr = cidrIp.includes(':');

  // Must be same version
  if (isIPv6Input !== isIPv6Cidr) return false;

  if (isIPv6Input) {
    if (prefixLen > 128) return false;
    const ipBytes = parseIPv6(ip);
    const cidrBytes = parseIPv6(cidrIp);
    if (!ipBytes || !cidrBytes) return false;
    return matchesPrefixBits(ipBytes, cidrBytes, prefixLen);
  } else {
    if (prefixLen > 32) return false;
    const ipBytes = parseIPv4(ip);
    const cidrBytes = parseIPv4(cidrIp);
    if (!ipBytes || !cidrBytes) return false;
    return matchesPrefixBits(ipBytes, cidrBytes, prefixLen);
  }
}

/**
 * Parse an IPv4 address string to a 4-byte Uint8Array.
 * Returns null for invalid input.
 */
function parseIPv4(ip: string): Uint8Array | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;

  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const n = parseInt(parts[i], 10);
    if (isNaN(n) || n < 0 || n > 255 || parts[i] !== String(n)) return null;
    bytes[i] = n;
  }
  return bytes;
}

/**
 * Parse an IPv6 address string to a 16-byte Uint8Array.
 * Handles '::' shorthand expansion.
 * Returns null for invalid input.
 */
function parseIPv6(ip: string): Uint8Array | null {
  // Handle :: expansion
  let halves: string[];
  if (ip.includes('::')) {
    const [left, right] = ip.split('::');
    if (ip.indexOf('::', ip.indexOf('::') + 2) !== -1) return null; // multiple ::
    const leftGroups = left ? left.split(':') : [];
    const rightGroups = right ? right.split(':') : [];
    const missing = 8 - leftGroups.length - rightGroups.length;
    if (missing < 0) return null;
    halves = [...leftGroups, ...Array(missing).fill('0'), ...rightGroups];
  } else {
    halves = ip.split(':');
  }

  if (halves.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const val = parseInt(halves[i], 16);
    if (isNaN(val) || val < 0 || val > 0xffff) return null;
    // Validate hex string (no invalid chars)
    if (!/^[0-9a-fA-F]{1,4}$/.test(halves[i]) && halves[i] !== '0') return null;
    bytes[i * 2] = (val >> 8) & 0xff;
    bytes[i * 2 + 1] = val & 0xff;
  }
  return bytes;
}

/**
 * Compare the first `prefixLen` bits of two byte arrays.
 * Returns true if they are identical in the prefix range.
 */
function matchesPrefixBits(a: Uint8Array, b: Uint8Array, prefixLen: number): boolean {
  const fullBytes = Math.floor(prefixLen / 8);
  const remainBits = prefixLen % 8;

  // Compare full bytes
  for (let i = 0; i < fullBytes; i++) {
    if (a[i] !== b[i]) return false;
  }

  // Compare remaining bits with mask
  if (remainBits > 0 && fullBytes < a.length) {
    const mask = 0xff << (8 - remainBits);
    if ((a[fullBytes] & mask) !== (b[fullBytes] & mask)) return false;
  }

  return true;
}
