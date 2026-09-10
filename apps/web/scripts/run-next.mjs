import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const allowedCommands = new Set(['dev', 'start']);
const command = process.argv[2];

if (!allowedCommands.has(command)) {
  console.error('Usage: node ./scripts/run-next.mjs <dev|start>');
  process.exit(1);
}

const port = process.env.WEB_PORT || '3001';

if (!/^\d+$/.test(port)) {
  console.error(`WEB_PORT must be a non-negative number. Received: ${port}`);
  process.exit(1);
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const nextBin = resolve(
  scriptDir,
  '..',
  'node_modules',
  'next',
  'dist',
  'bin',
  'next',
);

const child = spawn(process.execPath, [nextBin, command, '-p', port], {
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});
