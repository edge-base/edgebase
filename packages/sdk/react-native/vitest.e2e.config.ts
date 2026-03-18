import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    alias: {
      '../src/token-manager.js': path.resolve(__dirname, 'src/token-manager.ts'),
      '../src/token-manager': path.resolve(__dirname, 'src/token-manager.ts'),
      '@edge-base/shared': path.resolve(__dirname, '../../shared/src/index.ts'),
      '@edge-base/core': path.resolve(__dirname, '../js/packages/core/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/e2e/**/*.test.ts'],
    env: {
      BASE_URL: process.env['BASE_URL'] || 'http://localhost:8688',
      SERVICE_KEY: process.env['SERVICE_KEY'] || process.env['EDGEBASE_SERVICE_KEY'] || 'test-service-key-for-admin',
      EDGEBASE_SERVICE_KEY: process.env['EDGEBASE_SERVICE_KEY'] || process.env['SERVICE_KEY'] || 'test-service-key-for-admin',
    },
  },
});
