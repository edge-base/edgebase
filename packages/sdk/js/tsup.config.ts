import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  minify: false, // keep readable for debugging
  outDir: 'dist',
  target: 'es2022',
  // All workspace sub-packages are bundled inline so the published
  // @edgebase/sdk is fully self-contained (no peer dependencies at runtime).
  noExternal: ['@edgebase/core', '@edgebase/web', '@edgebase/admin', '@edgebase/shared'],
});
