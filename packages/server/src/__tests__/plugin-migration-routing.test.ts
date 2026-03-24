import { describe, expect, it } from 'vitest';
import { shouldRunPluginMigrationsForRequestPath } from '../lib/plugin-migration-routing.js';

describe('shouldRunPluginMigrationsForRequestPath', () => {
  it.each([
    '/api/auth/sign-in',
    '/api/db/shared/tables/posts',
    '/api/functions/send-welcome-email',
    '/api/sql/shared',
    '/api/storage/assets/upload',
    '/admin/api/data/tables/posts',
  ])('runs plugin migrations before %s', (path) => {
    expect(shouldRunPluginMigrationsForRequestPath(path)).toBe(true);
  });

  it.each([
    '/',
    '/api/health',
    '/openapi.json',
    '/admin',
    '/admin/login',
    '/_app/version.json',
    '/harness/scenarios/demo',
    '/admin/api/backup',
    '/admin/api/backup/shared',
    '/admin/api/data/backup/shared',
    '/internal/backup',
    '/internal/backup/shared',
  ])('skips plugin migrations for %s', (path) => {
    expect(shouldRunPluginMigrationsForRequestPath(path)).toBe(false);
  });
});
