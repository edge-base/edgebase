import { describe, expect, it } from 'vitest';
import { normalizeFrontendMountPath } from '../lib/frontend-config.js';

describe('frontend mount path normalization', () => {
  it('defaults to the root mount path when unset', () => {
    expect(normalizeFrontendMountPath(undefined)).toBe('/');
  });

  it('preserves the root mount path', () => {
    expect(normalizeFrontendMountPath('/')).toBe('/');
  });

  it('trims a trailing slash from custom mount paths', () => {
    expect(normalizeFrontendMountPath('/app/')).toBe('/app');
  });
});
