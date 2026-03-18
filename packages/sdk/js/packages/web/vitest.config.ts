import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    env: {
      BASE_URL: process.env['BASE_URL'] ?? 'http://localhost:8688',
      SERVICE_KEY: process.env['SERVICE_KEY'] ?? 'test-service-key-for-admin',
    },
  },
  resolve: {
    alias: {
      '@edge-base/shared': resolve(__dirname, '../../../../shared/src/index.ts'),
      '@edge-base/core': resolve(__dirname, '../core/src/index.ts'),
    },
  },
});
