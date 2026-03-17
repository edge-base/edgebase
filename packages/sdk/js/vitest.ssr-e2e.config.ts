import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    include: ['test/ssr-auth.e2e.test.ts'],
    environment: 'node',
    env: {
      BASE_URL: process.env['BASE_URL'] ?? 'http://localhost:8688',
      SERVICE_KEY: process.env['SERVICE_KEY'] ?? 'test-service-key-for-admin',
    },
  },
  resolve: {
    alias: {
      '@edgebase/core': resolve(__dirname, 'packages/core/src/index.ts'),
    },
  },
});
