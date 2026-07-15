export function localCiTimeout(milliseconds: number): number {
  return process.env.LOCAL_CI === '1' || process.env.EDGEBASE_LOCAL_CI_EMULATED_AMD64 === '1'
    ? milliseconds * 3
    : milliseconds;
}
