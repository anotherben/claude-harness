import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startDaemon } from '../src/daemon.js';
import { RpcConnection } from '../src/rpc.js';

test('daemon close destroys connected client sockets', async () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-daemon-'));
  let client;
  let daemon;

  try {
    daemon = await startDaemon({
      sockPath: join(root, 'daemon.sock'),
      pidPath: join(root, 'daemon.pid'),
      platformRoot: join(root, 'platform'),
      dbPath: join(root, 'skills.sqlite'),
      repoRoot: root,
      skillRoots: [],
    });

    client = net.createConnection(daemon.sockPath);
    await new Promise((resolve, reject) => {
      client.once('connect', resolve);
      client.once('error', reject);
    });

    const result = await Promise.race([
      daemon.close().then(() => 'closed'),
      delay(1000, 'timeout'),
    ]);

    assert.equal(result, 'closed');
  } finally {
    client?.destroy();
    if (daemon) {
      await daemon.close().catch(() => {});
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test('rpc pending requests reject when the socket closes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-rpc-'));
  const sockPath = join(root, 'rpc.sock');
  let client;
  let server;
  let rpc;

  try {
    server = net.createServer((socket) => {
      socket.destroy();
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(sockPath, resolve);
    });

    client = net.createConnection(sockPath);
    await new Promise((resolve, reject) => {
      client.once('connect', resolve);
      client.once('error', reject);
    });
    rpc = new RpcConnection(client, client);

    await assert.rejects(
      Promise.race([
        rpc.request('never', {}),
        delay(1000).then(() => {
          throw new Error('request did not reject after socket close');
        }),
      ]),
      /rpc connection closed|closed|ECONNRESET|EPIPE/,
    );
  } finally {
    rpc?.close();
    client?.destroy();
    await new Promise((resolve) => server?.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
});
