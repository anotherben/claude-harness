import { homedir } from 'node:os';
import { join } from 'node:path';
import { initDb } from '../storage/db.js';
import {
  checkDispatch,
  closeDispatchRun,
  closeWorker,
  ensureOrchestrator,
  getDispatchRun,
  getOrchestrator,
  getWorker,
  heartbeatOrchestrator,
  heartbeatWorker,
  listDispatchRuns,
  openDispatchRun,
  registerWorker,
} from './orchestration.js';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  let index = 0;
  while (index < rest.length) {
    const token = rest[index];
    if (!token.startsWith('--')) {
      throw new Error(`unexpected argument: ${token}`);
    }
    const key = token.slice(2).replace(/-/g, '_');
    const next = rest[index + 1];
    if (next === undefined || next.startsWith('--')) {
      options[key] = true;
      index += 1;
      continue;
    }
    options[key] = next;
    index += 2;
  }
  return { command, options };
}

function coerceInteger(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid integer: ${value}`);
  }
  return parsed;
}

function requireOption(options, key) {
  if (!options[key]) {
    throw new Error(`missing required option --${key.replace(/_/g, '-')}`);
  }
  return options[key];
}

function nowIso(options) {
  return options.now || new Date().toISOString();
}

const DB_PATH = process.env.VAULT_INDEX_DB_PATH || join(homedir(), '.vault-index', 'index.db');

function run() {
  const { command, options } = parseArgs(process.argv.slice(2));
  const db = initDb(DB_PATH);

  try {
    let result;
    switch (command) {
      case 'ensure-orchestrator':
        result = ensureOrchestrator({
          db,
          profileName: requireOption(options, 'profile_name'),
          conductorName: requireOption(options, 'conductor_name'),
          ownerFamily: requireOption(options, 'owner_family'),
          ownerInstance: requireOption(options, 'owner_instance'),
          agentDeckSession: options.agent_deck_session || null,
          repoScope: options.repo_scope || 'global',
          now: nowIso(options),
          leaseSeconds: coerceInteger(options.lease_seconds, 900),
        });
        break;
      case 'heartbeat-orchestrator':
        result = heartbeatOrchestrator({
          db,
          orchestratorId: requireOption(options, 'orchestrator_id'),
          ownerInstance: requireOption(options, 'owner_instance'),
          now: nowIso(options),
          leaseSeconds: coerceInteger(options.lease_seconds, 900),
        });
        break;
      case 'get-orchestrator':
        result = getOrchestrator({
          db,
          profileName: options.profile_name || null,
          conductorName: options.conductor_name || null,
          orchestratorId: options.orchestrator_id || null,
        });
        break;
      case 'open-dispatch-run':
        result = openDispatchRun({
          db,
          orchestratorId: requireOption(options, 'orchestrator_id'),
          vaultItemId: requireOption(options, 'vault_item_id'),
          project: options.project || null,
          repoPath: requireOption(options, 'repo_path'),
          branch: requireOption(options, 'branch'),
          worktreePath: requireOption(options, 'worktree_path'),
          requestedBy: options.requested_by || null,
          now: nowIso(options),
        });
        break;
      case 'get-dispatch-run':
        result = getDispatchRun({
          db,
          runId: requireOption(options, 'run_id'),
        });
        break;
      case 'list-dispatch-runs':
        result = listDispatchRuns({
          db,
          project: options.project || null,
          status: options.status || null,
        });
        break;
      case 'register-worker':
        result = registerWorker({
          db,
          runId: requireOption(options, 'run_id'),
          vaultItemId: requireOption(options, 'vault_item_id'),
          ownerFamily: requireOption(options, 'owner_family'),
          ownerInstance: requireOption(options, 'owner_instance'),
          agentDeckSession: options.agent_deck_session || null,
          repoPath: requireOption(options, 'repo_path'),
          branch: requireOption(options, 'branch'),
          worktreePath: requireOption(options, 'worktree_path'),
          now: nowIso(options),
          leaseSeconds: coerceInteger(options.lease_seconds, 900),
          workerId: options.worker_id || null,
        });
        break;
      case 'heartbeat-worker':
        result = heartbeatWorker({
          db,
          workerId: requireOption(options, 'worker_id'),
          ownerInstance: requireOption(options, 'owner_instance'),
          now: nowIso(options),
          leaseSeconds: coerceInteger(options.lease_seconds, 900),
        });
        break;
      case 'get-worker':
        result = getWorker({
          db,
          workerId: requireOption(options, 'worker_id'),
        });
        break;
      case 'close-worker':
        result = closeWorker({
          db,
          workerId: requireOption(options, 'worker_id'),
          ownerInstance: requireOption(options, 'owner_instance'),
          status: options.status || 'closed',
          now: nowIso(options),
        });
        break;
      case 'close-dispatch-run':
        result = closeDispatchRun({
          db,
          runId: requireOption(options, 'run_id'),
          orchestratorId: requireOption(options, 'orchestrator_id'),
          status: options.status || 'closed',
          now: nowIso(options),
        });
        break;
      case 'check-dispatch':
        result = checkDispatch({
          db,
          profileName: requireOption(options, 'profile_name'),
          conductorName: requireOption(options, 'conductor_name'),
          ownerInstance: options.owner_instance || null,
          agentDeckSession: options.agent_deck_session || null,
          repoPath: requireOption(options, 'repo_path'),
          branch: requireOption(options, 'branch'),
          worktreePath: requireOption(options, 'worktree_path'),
          itemId: options.item_id || null,
          now: nowIso(options),
        });
        break;
      default:
        throw new Error(`unknown command: ${command}`);
    }

    console.log(JSON.stringify({ ok: true, command, result }, null, 2));
  } catch (error) {
    console.log(JSON.stringify({
      ok: false,
      command,
      error: error.message,
    }, null, 2));
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

run();
