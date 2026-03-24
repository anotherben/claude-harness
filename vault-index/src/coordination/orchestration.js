import { randomUUID } from 'node:crypto';
import { getClaim } from './claims.js';

const ACTIVE_ORCHESTRATOR_STATES = new Set(['active']);
const ACTIVE_RUN_STATES = new Set(['open']);
const ACTIVE_WORKER_STATES = new Set(['running']);
const ACTIVE_CLAIM_STATES = new Set(['claimed']);

function isoToMillis(isoString) {
  const value = Date.parse(isoString);
  if (Number.isNaN(value)) {
    throw new Error(`invalid ISO timestamp: ${isoString}`);
  }
  return value;
}

function addSeconds(isoString, seconds) {
  return new Date(isoToMillis(isoString) + seconds * 1000).toISOString();
}

function isLiveLease(row, now, activeStates) {
  return Boolean(
    row
      && activeStates.has(row.state || row.status)
      && row.lease_expires_at
      && isoToMillis(row.lease_expires_at) > isoToMillis(now)
  );
}

function getVaultItem(db, itemId) {
  return db.prepare(`
    SELECT id, project, branch, worktree_path, owner_family, owner_instance
    FROM vault_items
    WHERE id = ?
  `).get(itemId);
}

function mirrorDispatchToItem(db, {
  itemId,
  orchestratorId = undefined,
  dispatchRunId = undefined,
  workerId = undefined,
}) {
  const updates = [];
  const params = { itemId };

  if (orchestratorId !== undefined) {
    updates.push('orchestrator_id = @orchestratorId');
    params.orchestratorId = orchestratorId;
  }
  if (dispatchRunId !== undefined) {
    updates.push('dispatch_run_id = @dispatchRunId');
    params.dispatchRunId = dispatchRunId;
  }
  if (workerId !== undefined) {
    updates.push('worker_id = @workerId');
    params.workerId = workerId;
  }

  if (updates.length === 0) {
    return;
  }

  db.prepare(`
    UPDATE vault_items
    SET ${updates.join(', ')}
    WHERE id = @itemId
  `).run(params);
}

function requireOwner(row, ownerInstance, label) {
  if (!row) {
    throw new Error(`${label} does not exist`);
  }
  if (row.owner_instance !== ownerInstance) {
    throw new Error(`only the current owner may manage the ${label}`);
  }
}

function requireLiveOrchestrator(orchestrator, now) {
  if (!orchestrator || !isLiveLease(orchestrator, now, ACTIVE_ORCHESTRATOR_STATES)) {
    throw new Error('orchestrator is not active');
  }
}

function requireOpenRun(run) {
  if (!run || !ACTIVE_RUN_STATES.has(run.status) || run.closed_at) {
    throw new Error('dispatch run is not open');
  }
}

function requireLiveWorker(worker, now) {
  if (!worker || !isLiveLease(worker, now, ACTIVE_WORKER_STATES) || worker.closed_at) {
    throw new Error('worker is not active');
  }
}

function deriveOrchestratorId(profileName, conductorName) {
  return `${profileName}:${conductorName}`;
}

function getOpenRunByItem(db, itemId) {
  return db.prepare(`
    SELECT *
    FROM dispatch_runs
    WHERE vault_item_id = ?
      AND status = 'open'
      AND closed_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `).get(itemId) ?? null;
}

function getOpenRunByLane(db, { itemId = null, repoPath, branch, worktreePath }) {
  let sql = `
    SELECT *
    FROM dispatch_runs
    WHERE repo_path = ?
      AND branch = ?
      AND worktree_path = ?
      AND status = 'open'
      AND closed_at IS NULL
  `;
  const params = [repoPath, branch, worktreePath];
  if (itemId) {
    sql += ' AND vault_item_id = ?';
    params.push(itemId);
  }
  sql += ' ORDER BY created_at DESC LIMIT 1';
  return db.prepare(sql).get(...params) ?? null;
}

function getLiveWorkerByRun(db, runId, now) {
  const rows = db.prepare(`
    SELECT *
    FROM workers
    WHERE run_id = ?
      AND state = 'running'
      AND closed_at IS NULL
    ORDER BY started_at DESC
  `).all(runId);
  return rows.find((row) => isLiveLease(row, now, ACTIVE_WORKER_STATES)) ?? null;
}

function getLiveWorkerByItem(db, itemId, now) {
  const rows = db.prepare(`
    SELECT *
    FROM workers
    WHERE vault_item_id = ?
      AND state = 'running'
      AND closed_at IS NULL
    ORDER BY started_at DESC
  `).all(itemId);
  return rows.find((row) => isLiveLease(row, now, ACTIVE_WORKER_STATES)) ?? null;
}

export function getOrchestrator({ db, profileName, conductorName, orchestratorId = null }) {
  if (orchestratorId) {
    return db.prepare('SELECT * FROM orchestrators WHERE orchestrator_id = ?').get(orchestratorId) ?? null;
  }
  return db.prepare(`
    SELECT *
    FROM orchestrators
    WHERE profile_name = ?
      AND conductor_name = ?
    LIMIT 1
  `).get(profileName, conductorName) ?? null;
}

export function ensureOrchestrator({
  db,
  profileName,
  conductorName,
  ownerFamily,
  ownerInstance,
  agentDeckSession = null,
  repoScope = 'global',
  now,
  leaseSeconds = 900,
}) {
  const orchestratorTx = db.transaction(() => {
    const orchestratorId = deriveOrchestratorId(profileName, conductorName);
    const existing = getOrchestrator({ db, orchestratorId });
    if (existing && isLiveLease(existing, now, ACTIVE_ORCHESTRATOR_STATES) && existing.owner_instance !== ownerInstance) {
      throw new Error(`orchestrator already owned by ${existing.owner_instance}`);
    }

    const row = {
      orchestrator_id: orchestratorId,
      profile_name: profileName,
      conductor_name: conductorName,
      owner_family: ownerFamily,
      owner_instance: ownerInstance,
      agent_deck_session: agentDeckSession,
      state: 'active',
      repo_scope: repoScope,
      started_at: existing?.started_at ?? now,
      lease_expires_at: addSeconds(now, leaseSeconds),
      last_heartbeat_at: now,
    };

    db.prepare(`
      INSERT INTO orchestrators
        (orchestrator_id, profile_name, conductor_name, owner_family, owner_instance, agent_deck_session, state, repo_scope, started_at, lease_expires_at, last_heartbeat_at)
      VALUES
        (@orchestrator_id, @profile_name, @conductor_name, @owner_family, @owner_instance, @agent_deck_session, @state, @repo_scope, @started_at, @lease_expires_at, @last_heartbeat_at)
      ON CONFLICT(orchestrator_id) DO UPDATE SET
        owner_family = excluded.owner_family,
        owner_instance = excluded.owner_instance,
        agent_deck_session = excluded.agent_deck_session,
        state = excluded.state,
        repo_scope = excluded.repo_scope,
        lease_expires_at = excluded.lease_expires_at,
        last_heartbeat_at = excluded.last_heartbeat_at
    `).run(row);

    return getOrchestrator({ db, orchestratorId });
  });

  return orchestratorTx();
}

export function heartbeatOrchestrator({ db, orchestratorId, ownerInstance, now, leaseSeconds = 900 }) {
  const heartbeatTx = db.transaction(() => {
    const orchestrator = getOrchestrator({ db, profileName: null, conductorName: null, orchestratorId });
    requireOwner(orchestrator, ownerInstance, 'orchestrator');

    db.prepare(`
      UPDATE orchestrators
      SET state = 'active',
          lease_expires_at = ?,
          last_heartbeat_at = ?
      WHERE orchestrator_id = ?
    `).run(addSeconds(now, leaseSeconds), now, orchestratorId);

    return getOrchestrator({ db, profileName: null, conductorName: null, orchestratorId });
  });

  return heartbeatTx();
}

export function openDispatchRun({
  db,
  orchestratorId,
  vaultItemId,
  project = null,
  repoPath,
  branch,
  worktreePath,
  requestedBy = null,
  now,
}) {
  const runTx = db.transaction(() => {
    const item = getVaultItem(db, vaultItemId);
    if (!item) {
      throw new Error(`vault item not found: ${vaultItemId}`);
    }

    const orchestrator = getOrchestrator({ db, profileName: null, conductorName: null, orchestratorId });
    requireLiveOrchestrator(orchestrator, now);

    const existing = getOpenRunByItem(db, vaultItemId);
    if (existing) {
      if (
        existing.orchestrator_id === orchestratorId
        && existing.repo_path === repoPath
        && existing.branch === branch
        && existing.worktree_path === worktreePath
      ) {
        return existing;
      }
      throw new Error(`vault item already has an open dispatch run: ${existing.run_id}`);
    }

    const run = {
      run_id: randomUUID(),
      orchestrator_id: orchestratorId,
      vault_item_id: vaultItemId,
      project: project ?? item.project ?? null,
      repo_path: repoPath,
      branch,
      worktree_path: worktreePath,
      requested_by: requestedBy,
      status: 'open',
      created_at: now,
      updated_at: now,
      closed_at: null,
    };

    db.prepare(`
      INSERT INTO dispatch_runs
        (run_id, orchestrator_id, vault_item_id, project, repo_path, branch, worktree_path, requested_by, status, created_at, updated_at, closed_at)
      VALUES
        (@run_id, @orchestrator_id, @vault_item_id, @project, @repo_path, @branch, @worktree_path, @requested_by, @status, @created_at, @updated_at, @closed_at)
    `).run(run);

    mirrorDispatchToItem(db, {
      itemId: vaultItemId,
      orchestratorId,
      dispatchRunId: run.run_id,
    });

    return getDispatchRun({ db, runId: run.run_id });
  });

  return runTx();
}

export function getDispatchRun({ db, runId }) {
  return db.prepare('SELECT * FROM dispatch_runs WHERE run_id = ?').get(runId) ?? null;
}

export function listDispatchRuns({ db, project = null, status = null }) {
  let sql = 'SELECT * FROM dispatch_runs WHERE 1 = 1';
  const params = [];
  if (project) {
    sql += ' AND project = ?';
    params.push(project);
  }
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  sql += ' ORDER BY created_at DESC';
  return db.prepare(sql).all(...params);
}

export function registerWorker({
  db,
  runId,
  vaultItemId,
  ownerFamily,
  ownerInstance,
  agentDeckSession = null,
  repoPath,
  branch,
  worktreePath,
  now,
  leaseSeconds = 900,
  workerId = null,
}) {
  const workerTx = db.transaction(() => {
    const run = getDispatchRun({ db, runId });
    requireOpenRun(run);
    if (run.vault_item_id !== vaultItemId) {
      throw new Error(`dispatch run ${runId} is bound to ${run.vault_item_id}, not ${vaultItemId}`);
    }

    const orchestrator = getOrchestrator({ db, profileName: null, conductorName: null, orchestratorId: run.orchestrator_id });
    requireLiveOrchestrator(orchestrator, now);

    if (run.repo_path !== repoPath || run.branch !== branch || run.worktree_path !== worktreePath) {
      throw new Error('worker lane does not match the registered dispatch run');
    }

    const liveRunWorker = getLiveWorkerByRun(db, runId, now);
    if (liveRunWorker && liveRunWorker.owner_instance !== ownerInstance) {
      throw new Error(`dispatch run already has an active worker: ${liveRunWorker.owner_instance}`);
    }

    const liveItemWorker = getLiveWorkerByItem(db, vaultItemId, now);
    if (liveItemWorker && liveItemWorker.run_id !== runId && liveItemWorker.owner_instance !== ownerInstance) {
      throw new Error(`vault item already has an active worker: ${liveItemWorker.owner_instance}`);
    }

    const resolvedWorkerId = workerId ?? liveRunWorker?.worker_id ?? agentDeckSession ?? randomUUID();
    const row = {
      worker_id: resolvedWorkerId,
      run_id: runId,
      vault_item_id: vaultItemId,
      owner_family: ownerFamily,
      owner_instance: ownerInstance,
      agent_deck_session: agentDeckSession,
      repo_path: repoPath,
      branch,
      worktree_path: worktreePath,
      state: 'running',
      started_at: liveRunWorker?.started_at ?? now,
      lease_expires_at: addSeconds(now, leaseSeconds),
      last_heartbeat_at: now,
      closed_at: null,
    };

    db.prepare(`
      INSERT INTO workers
        (worker_id, run_id, vault_item_id, owner_family, owner_instance, agent_deck_session, repo_path, branch, worktree_path, state, started_at, lease_expires_at, last_heartbeat_at, closed_at)
      VALUES
        (@worker_id, @run_id, @vault_item_id, @owner_family, @owner_instance, @agent_deck_session, @repo_path, @branch, @worktree_path, @state, @started_at, @lease_expires_at, @last_heartbeat_at, @closed_at)
      ON CONFLICT(worker_id) DO UPDATE SET
        run_id = excluded.run_id,
        vault_item_id = excluded.vault_item_id,
        owner_family = excluded.owner_family,
        owner_instance = excluded.owner_instance,
        agent_deck_session = excluded.agent_deck_session,
        repo_path = excluded.repo_path,
        branch = excluded.branch,
        worktree_path = excluded.worktree_path,
        state = excluded.state,
        lease_expires_at = excluded.lease_expires_at,
        last_heartbeat_at = excluded.last_heartbeat_at,
        closed_at = excluded.closed_at
    `).run(row);

    mirrorDispatchToItem(db, {
      itemId: vaultItemId,
      orchestratorId: run.orchestrator_id,
      dispatchRunId: runId,
      workerId: resolvedWorkerId,
    });

    return getWorker({ db, workerId: resolvedWorkerId });
  });

  return workerTx();
}

export function getWorker({ db, workerId }) {
  return db.prepare('SELECT * FROM workers WHERE worker_id = ?').get(workerId) ?? null;
}

export function heartbeatWorker({ db, workerId, ownerInstance, now, leaseSeconds = 900 }) {
  const heartbeatTx = db.transaction(() => {
    const worker = getWorker({ db, workerId });
    requireOwner(worker, ownerInstance, 'worker');
    requireLiveWorker(worker, now);

    db.prepare(`
      UPDATE workers
      SET state = 'running',
          lease_expires_at = ?,
          last_heartbeat_at = ?
      WHERE worker_id = ?
    `).run(addSeconds(now, leaseSeconds), now, workerId);

    return getWorker({ db, workerId });
  });

  return heartbeatTx();
}

export function closeWorker({ db, workerId, ownerInstance, status = 'closed', now }) {
  const closeTx = db.transaction(() => {
    const worker = getWorker({ db, workerId });
    requireOwner(worker, ownerInstance, 'worker');

    db.prepare(`
      UPDATE workers
      SET state = ?, closed_at = ?, lease_expires_at = ?, last_heartbeat_at = ?
      WHERE worker_id = ?
    `).run(status, now, now, now, workerId);

    mirrorDispatchToItem(db, {
      itemId: worker.vault_item_id,
      workerId: null,
    });

    return getWorker({ db, workerId });
  });

  return closeTx();
}

export function closeDispatchRun({ db, runId, orchestratorId, status = 'closed', now }) {
  const closeTx = db.transaction(() => {
    const run = getDispatchRun({ db, runId });
    if (!run) {
      throw new Error(`dispatch run not found: ${runId}`);
    }
    if (run.orchestrator_id !== orchestratorId) {
      throw new Error(`dispatch run ${runId} is not owned by orchestrator ${orchestratorId}`);
    }

    const activeWorker = getLiveWorkerByRun(db, runId, now);
    if (activeWorker) {
      throw new Error(`dispatch run still has an active worker: ${activeWorker.worker_id}`);
    }

    db.prepare(`
      UPDATE dispatch_runs
      SET status = ?, updated_at = ?, closed_at = ?
      WHERE run_id = ?
    `).run(status, now, now, runId);

    mirrorDispatchToItem(db, {
      itemId: run.vault_item_id,
      orchestratorId: null,
      dispatchRunId: null,
      workerId: null,
    });

    return getDispatchRun({ db, runId });
  });

  return closeTx();
}

export function checkDispatch({
  db,
  profileName,
  conductorName,
  ownerInstance = null,
  agentDeckSession = null,
  repoPath,
  branch,
  worktreePath,
  itemId = null,
  now,
}) {
  const failures = [];
  const orchestrator = getOrchestrator({ db, profileName, conductorName });
  if (!orchestrator || !isLiveLease(orchestrator, now, ACTIVE_ORCHESTRATOR_STATES)) {
    failures.push(`orchestrator ${profileName}/${conductorName} is not active`);
  }

  const run = getOpenRunByLane(db, { itemId, repoPath, branch, worktreePath });
  if (!run) {
    failures.push('no open dispatch run matches this lane');
  }

  let worker = null;
  if (run) {
    const candidates = db.prepare(`
      SELECT *
      FROM workers
      WHERE run_id = ?
        AND state = 'running'
        AND closed_at IS NULL
      ORDER BY started_at DESC
    `).all(run.run_id);
    worker = candidates.find((row) => {
      if (!isLiveLease(row, now, ACTIVE_WORKER_STATES)) {
        return false;
      }
      if (agentDeckSession && row.agent_deck_session === agentDeckSession) {
        return true;
      }
      if (ownerInstance && row.owner_instance === ownerInstance) {
        return true;
      }
      return false;
    }) ?? null;

    if (!worker) {
      failures.push('no active worker is registered for this lane and session');
    }
  }

  const resolvedItemId = itemId ?? run?.vault_item_id ?? null;
  const claim = resolvedItemId ? getClaim({ db, itemId: resolvedItemId }) : null;
  if (!claim) {
    failures.push('vault item does not have a live claim');
  } else {
    if (!isLiveLease(claim, now, ACTIVE_CLAIM_STATES)) {
      failures.push('vault claim is stale or inactive');
    }
    if (claim.owner_instance !== (worker?.owner_instance ?? ownerInstance ?? claim.owner_instance)) {
      failures.push(`vault claim is owned by ${claim.owner_instance}, not the registered worker`);
    }
    if (claim.repo_path !== repoPath) {
      failures.push(`vault claim repo mismatch: ${claim.repo_path} != ${repoPath}`);
    }
    if (claim.branch !== branch) {
      failures.push(`vault claim branch mismatch: ${claim.branch} != ${branch}`);
    }
    if (claim.worktree_path !== worktreePath) {
      failures.push(`vault claim worktree mismatch: ${claim.worktree_path} != ${worktreePath}`);
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    orchestrator,
    run,
    worker,
    claim,
  };
}
