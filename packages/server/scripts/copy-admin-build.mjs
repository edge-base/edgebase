import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageDir = join(__dirname, '..');
const sourceDir = join(packageDir, '..', 'admin', 'build');
const targetDir = join(packageDir, 'admin-build');

if (!existsSync(join(sourceDir, 'index.html'))) {
  throw new Error(`Admin build source is missing: ${sourceDir}`);
}

rmSync(targetDir, { recursive: true, force: true });
mkdirSync(targetDir, { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true, force: true });
