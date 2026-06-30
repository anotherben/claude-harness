/**
 * skills-index per-user daemon.
 * One long-lived process owns the platform + store handle.
 * Each Claude session connects via a thin stdio proxy over a Unix socket.
 */
import { createServer } from 'node:net';
import {
  existsSync,
  mkdirSync,
  openSync,
  writeSync,
  closeSync,
  readFileSync,
  unlinkSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { RpcConnection } from './rpc.js';
import { compilePlatform, loadPlatform } from './platform.js';
import { buildToolHandlers } from './server.js';

// ─── Write queue ────────────────────────────────────────────────────────────

export function createWriteQueue() {
  let tail = Promise.resolve();
  return {
    run(fn) {
      const next = tail.then(
        () => fn(),
        () => fn(),
      );
      // Swallow rejection on tail so one failure doesn't poison the chain,
      // but still surface it to the specific caller.
      tail = next.catch(() => {});
      return next;
    },
  };
}

// ─── PID lock + socket helpers ───────────────────────────────────────────────

function acquireLock(pidPath) {
  mkdirSync(dirname(pidPath), { recursive: true });
  if (existsSync(pidPath)) {
    const existing = Number(readFileSync(pidPath, 'utf8').trim());
    if (existing && existing !== process.pid) {
      try {
        process.kill(existing, 0); // alive check
        const err = new Error(`daemon already running (pid ${existing})`);
        throw err;
      } catch (killErr) {
        if (killErr.code !== 'ESRCH') throw killErr;
        // stale pid, fall through
      }
    }
    unlinkSync(pidPath);
  }
  const fd = openSync(pidPath, 'wx');
  writeSync(fd, String(process.pid));
  closeSync(fd);
}

function cleanStaleSocket(sockPath) {
  mkdirSync(dirname(sockPath), { recursive: true });
  if (existsSync(sockPath)) {
    try {
      unlinkSync(sockPath);
    } catch {
      // ignore — socket may already be gone
    }
  }
}

// ─── Daemon platform shim ────────────────────────────────────────────────────

/**
 * Returns a shallow copy of `platform` where `store.close` is a no-op.
 * `withPlatform()` in server.js calls `platform.store.close()` in its finally block.
 * The daemon must prevent that from closing the persistent singleton store.
 * All other store methods (recordTelemetry, getTelemetryReport, etc.) remain live
 * because they are own-property function references that close over the original `db`.
 */
function makeDaemonPlatform(platform) {
  return {
    ...platform,
    store: { ...platform.store, close() {} },
  };
}

// ─── Daemon startup ──────────────────────────────────────────────────────────

const TOOL_NAMES = [
  'skill_catalog',
  'skill_search',
  'skill_outline',
  'skill_read_section',
  'skill_read_sections',
  'skill_status',
  'skill_telemetry',
  'list_skills',
  'match_skills',
  'get_skill_metadata',
  'get_skill_section',
  'get_skill_bundle',
  'get_policy_bundle',
  'task_bootstrap',
  'skill_bundle_status',
  'skill_validate_candidates',
  'skill_evaluate_challengers',
  'rebuild_platform',
];

export async function startDaemon(opts = {}) {
  const sockPath = opts.sockPath || join(homedir(), '.agent-platform', 'skills-index.sock');
  const pidPath = opts.pidPath || join(homedir(), '.agent-platform', 'daemon.pid');
  const platformOpts = {
    repoRoot: opts.repoRoot,
    dbPath: opts.dbPath,
    platformRoot: opts.platformRoot,
    skillRoots: opts.skillRoots,
    runtime: opts.runtime,
    // Bind the MCP socket quickly by reusing the compiled index on daemon startup.
    // Full source scans can be triggered explicitly via rebuild_platform.
    skipSourceMtime: opts.skipSourceMtime ?? true,
    skipEmbeddings: opts.skipEmbeddings ?? true,
  };

  acquireLock(pidPath);
  cleanStaleSocket(sockPath);

  const state = { platform: null };
  state.platform = await loadPlatform(platformOpts);
  const writeQueue = createWriteQueue();

  const handlers = buildToolHandlers({
    platformLoader: async () => makeDaemonPlatform(state.platform),
    compileLoader: async (compileOpts) => {
      return writeQueue.run(async () => {
        const fresh = await compilePlatform({ ...platformOpts, ...compileOpts });
        state.platform.store.close();
        state.platform = fresh;
        return makeDaemonPlatform(fresh);
      });
    },
  });

  const clients = new Set();
  const sockets = new Set();

  const server = createServer((socket) => {
    const rpc = new RpcConnection(socket, socket);
    clients.add(rpc);
    sockets.add(socket);

    rpc.onRequest('ping', async () => ({ pong: true }));
    rpc.onRequest('listTools', async () => TOOL_NAMES);
    rpc.onRequest('toolCall', async ({ name, args }) => {
      const handler = handlers[name];
      if (!handler) {
        const err = new Error(`unknown tool: ${name}`);
        err.code = -32601;
        throw err;
      }
      return handler.call(handlers, args || {});
    });

    socket.on('close', () => {
      rpc.close();
      clients.delete(rpc);
      sockets.delete(socket);
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(sockPath, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  return {
    sockPath,
    pidPath,
    async close() {
      for (const rpc of clients) rpc.close();
      for (const socket of sockets) socket.destroy();
      clients.clear();
      sockets.clear();
      await new Promise((r) => server.close(r));
      state.platform.store.close();
      try {
        unlinkSync(sockPath);
      } catch {}
      try {
        unlinkSync(pidPath);
      } catch {}
    },
  };
}
