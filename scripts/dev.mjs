#!/usr/bin/env node
/** Run Vite and the save API together; stop both on exit or startup failure. */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const requireApp = createRequire(resolve(root, 'packages/app/package.json'));
const vite = resolve(dirname(requireApp.resolve('vite/package.json')), 'bin/vite.js');
const children = new Set();
let stopping = false;
let killTimer;
function signal(child, name) {
  try {
    if (process.platform === 'win32') child.kill(name);
    else if (child.pid) process.kill(-child.pid, name);
  } catch (error) {
    if (error.code !== 'ESRCH') console.error(error.message);
  }
}
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) signal(child, 'SIGTERM');
  killTimer = setTimeout(() => {
    for (const child of children) signal(child, 'SIGKILL');
  }, 5000);
  killTimer.unref();
}
function launch(command, args, env = process.env) {
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: 'inherit',
    detached: process.platform !== 'win32',
  });
  children.add(child);
  child.on('error', (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on('exit', (code) => {
    signal(child, 'SIGTERM');
    children.delete(child);
    if (!stopping) stop(code || 1);
    if (!children.size) clearTimeout(killTimer);
  });
  return child;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
const port = process.env.S2GOLD_PORT || '8000';
const api = `http://127.0.0.1:${port}`;
const occupied = await fetch(`${api}/api/saves`, { signal: AbortSignal.timeout(1000) }).then(
  () => true,
  () => false,
);
if (occupied) {
  console.error(`Save API port ${port} is already in use; stop that server or set S2GOLD_PORT.`);
  process.exit(1);
}
if (!stopping)
  launch('cargo', ['run', '-p', 's2gold-server'], {
    ...process.env,
    S2GOLD_HOST: '127.0.0.1',
    S2GOLD_PORT: port,
  });
// Wait for the API before opening the frontend, including a first Rust build.
const deadline = Date.now() + 180_000;
while (!stopping) {
  try {
    const response = await fetch(`${api}/api/saves`, { signal: AbortSignal.timeout(1000) });
    if (response.ok && response.headers.get('content-type')?.includes('json')) break;
  } catch {
    /* The API is still compiling or binding its port. */
  }
  if (Date.now() > deadline) {
    console.error('Save API startup timed out.');
    stop(1);
    break;
  }
  await new Promise((r) => setTimeout(r, 200));
}
if (!stopping)
  launch(
    process.execPath,
    [
      vite,
      '--config',
      resolve(root, 'packages/app/vite.config.ts'),
      '--host',
      '127.0.0.1',
      ...process.argv.slice(2),
    ],
    {
      ...process.env,
      S2GOLD_API_URL: api,
    },
  );
