import { spawn, spawnSync } from 'node:child_process';

const docsRoot = process.cwd();
const forwardedArgs = process.argv.slice(2);
const normalizedArgs =
  forwardedArgs[0] === '--' ? forwardedArgs.slice(1) : forwardedArgs;

const prepare = spawnSync('node', ['scripts/prepare-search-dev.mjs'], {
  cwd: docsRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (prepare.status !== 0) {
  process.exit(prepare.status ?? 1);
}

const child = spawn('docusaurus', ['start', ...normalizedArgs], {
  cwd: docsRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

process.on('SIGINT', () => {
  child.kill('SIGINT');
});

process.on('SIGTERM', () => {
  child.kill('SIGTERM');
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
