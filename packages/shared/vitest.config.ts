import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: '.vitest-cache',
  test: {
    include: ['test/**/*.test.ts'],
    server: {
      deps: {
        inline: [/@edgebase\//],
      },
    },
  },
});
