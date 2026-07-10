import { copyFileSync, mkdirSync } from 'node:fs';

const distDir = new URL('../dist/', import.meta.url);
mkdirSync(distDir, { recursive: true });
copyFileSync(
  new URL('../src/styles.css', import.meta.url),
  new URL('styles.css', distDir),
);
