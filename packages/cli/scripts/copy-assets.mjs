import { chmodSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, '..');
const srcTemplatesDir = resolve(packageDir, 'src', 'templates');
const distDir = resolve(packageDir, 'dist');
const distCliEntry = resolve(distDir, 'index.js');
const distTemplatesDir = resolve(distDir, 'templates');

if (!existsSync(srcTemplatesDir)) {
  throw new Error(`Template source directory not found: ${srcTemplatesDir}`);
}

mkdirSync(distDir, { recursive: true });
rmSync(distTemplatesDir, { recursive: true, force: true });
cpSync(srcTemplatesDir, distTemplatesDir, { recursive: true });

if (existsSync(distCliEntry)) {
  chmodSync(distCliEntry, 0o755);
}
