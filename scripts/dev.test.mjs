/** Integration coverage for startup failure and process-tree cleanup. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}
async function up(port) {
  try {
    return (await fetch(`http://127.0.0.1:${port}/api/saves`, { signal: AbortSignal.timeout(300) }))
      .ok;
  } catch {
    return false;
  }
}
async function until(check) {
  const deadline = Date.now() + 60_000;
  while (!(await check())) {
    assert(Date.now() < deadline, 'timed out waiting for launcher');
    await new Promise((r) => setTimeout(r, 100));
  }
}

test(
  'launcher starts both services and shuts down the process tree, including on Vite failure',
  { timeout: 90_000 },
  async () => {
    const data = await mkdtemp(join(tmpdir(), 's2gold-launcher-'));
    const apiPort = await freePort();
    const webPort = await freePort();
    const start = () => {
      const child = spawn(
        process.execPath,
        ['scripts/dev.mjs', '--port', String(webPort), '--strictPort'],
        {
          env: {
            ...process.env,
            S2GOLD_PORT: String(apiPort),
            S2GOLD_DB_PATH: join(data, 'saves.db'),
            S2GOLD_SAVES_DIR: join(data, 'legacy-saves'),
            S2GOLD_SESSIONS_DIR: join(data, 'legacy-sessions'),
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let log = '';
      child.stdout.on('data', (b) => {
        log += b;
      });
      child.stderr.on('data', (b) => {
        log += b;
      });
      return { child, exited: once(child, 'exit'), log: () => log };
    };
    let running = start();
    let occupied;
    try {
      await until(async () => {
        assert.equal(running.child.exitCode, null, running.log());
        return (await up(apiPort)) && (await up(webPort));
      });
      running.child.kill('SIGTERM');
      assert.equal((await running.exited)[0], 0, running.log());
      await until(async () => !(await up(apiPort)) && !(await up(webPort)));

      occupied = createServer();
      occupied.listen(webPort, '127.0.0.1');
      await once(occupied, 'listening');
      running = start();
      assert.equal((await running.exited)[0], 1, running.log());
      assert.match(running.log(), /already in use/);
      await until(async () => !(await up(apiPort)));
    } finally {
      running.child.kill('SIGTERM');
      if (occupied) await new Promise((r) => occupied.close(r));
      await rm(data, { recursive: true, force: true });
    }
  },
);
