import fs from 'node:fs';
import path from 'node:path';

const TIER_ORDER = { mocked: 0, unknown: 0, integration: 1, e2e: 2 };
const MIN_EVIDENCE_TIER = 'integration';

function readEvidence(repoPath) {
  if (!repoPath) return null;
  const evidencePath = path.join(repoPath, '.claude/evidence/last-test-run.json');
  if (!fs.existsSync(evidencePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  } catch {
    return null;
  }
}

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

function isLiveClaim(claim, now) {
  return Boolean(claim && claim.state === 'claimed' && isoToMillis(claim.lease_expires_at) > isoToMillis(now));
}

function getItemRow(db, itemId) {
  return db.prepare('SELECT id, project, status FROM vault_items WHERE id = ?').get(itemId);
}

function requireOwner(claim, ownerInstance) {
  if (!claim) {
    throw new Error('item is not currently claimed');
  }
  if (claim.owner_instance !== ownerInstance) {
    throw new Error('only the current owner may perform that action');
  }
}

function mirrorClaimToItem(db, {
  itemId,
  ownerFamily = null,
  ownerInstance = null,
  branch = null,
  worktreePath = null,
  claimedAt = null,
  completedAt = null,
  handoffFrom = null,
  handoffNote = null,
  status = null,
}) {
  db.prepare(`
    UPDATE vault_items
    SET owner_family = @ownerFamily,
        owner_instance = @ownerInstance,
        branch = COALESCE(@branch, branch),
        worktree_path = @worktreePath,
        claimed_at = @claimedAt,
        completed_at = @completedAt,
        handoff_from = @handoffFrom,
        handoff_note = @handoffNote,
        status = COALESCE(@status, status)
    WHERE id = @itemId
  `).run({
    itemId,
    ownerFamily,
    ownerInstance,
    branch,
    worktreePath,
    claimedAt,
    completedAt,
    handoffFrom,
    handoffNote,
    status,
  });
}

function writeHandoff(db, {
  itemId,
  action,
  fromOwnerInstance = null,
  toOwnerInstance = null,
  note = null,
  createdAt,
}) {
  db.prepare(`
    INSERT INTO vault_handoffs (item_id, action, from_owner_instance, to_owner_instance, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(itemId, action, fromOwnerInstance, toOwnerInstance, note, createdAt);
}

export function getClaim({ db, itemId }) {
  return db.prepare('SELECT * FROM vault_claims WHERE item_id = ?').get(itemId) ?? null;
}

export function listClaims({ db, project = null, state = null }) {
  let sql = 'SELECT * FROM vault_claims WHERE 1 = 1';
  const params = [];
  if (project) {
    sql += ' AND project = ?';
    params.push(project);
  }
  if (state) {
    sql += ' AND state = ?';
    params.push(state);
  }
  sql += ' ORDER BY claimed_at DESC';
  return db.prepare(sql).all(...params);
}

export function claimItem({
  db,
  itemId,
  ownerFamily,
  ownerInstance,
  repoPath,
  branch,
  worktreePath,
  now,
  leaseSeconds = 900,
}) {
  const claimTx = db.transaction(() => {
    const item = getItemRow(db, itemId);
    if (!item) {
      throw new Error(`vault item not found: ${itemId}`);
    }

    const existing = getClaim({ db, itemId });
    if (isLiveClaim(existing, now) && existing.owner_instance !== ownerInstance) {
      throw new Error(`item already claimed by ${existing.owner_instance}`);
    }

    // Evidence gate: check if this owner's last completed item has mocked-only evidence
    const priorCompleted = db.prepare(
      `SELECT item_id, repo_path FROM vault_claims
       WHERE owner_instance = ? AND state = 'completed'
       ORDER BY claimed_at DESC LIMIT 1`
    ).all(ownerInstance);

    for (const prior of priorCompleted) {
      const ev = readEvidence(prior.repo_path || repoPath);
      if (ev && (ev.tier === 'mocked' || ev.tier === 'unknown')) {
        throw new Error(
          `Cannot claim new item: your last completed item (${prior.item_id}) has "${ev.tier}" evidence. ` +
          `Run integration tests on the previous work before moving on.`
        );
      }
    }

    const claim = {
      item_id: itemId,
      owner_family: ownerFamily,
      owner_instance: ownerInstance,
      project: item.project,
      repo_path: repoPath,
      branch,
      worktree_path: worktreePath,
      claimed_at: now,
      lease_expires_at: addSeconds(now, leaseSeconds),
      last_heartbeat_at: now,
      state: 'claimed',
    };

    db.prepare(`
      INSERT INTO vault_claims
        (item_id, owner_family, owner_instance, project, repo_path, branch, worktree_path, claimed_at, lease_expires_at, last_heartbeat_at, state)
      VALUES
        (@item_id, @owner_family, @owner_instance, @project, @repo_path, @branch, @worktree_path, @claimed_at, @lease_expires_at, @last_heartbeat_at, @state)
      ON CONFLICT(item_id) DO UPDATE SET
        owner_family = excluded.owner_family,
        owner_instance = excluded.owner_instance,
        project = excluded.project,
        repo_path = excluded.repo_path,
        branch = excluded.branch,
        worktree_path = excluded.worktree_path,
        claimed_at = excluded.claimed_at,
        lease_expires_at = excluded.lease_expires_at,
        last_heartbeat_at = excluded.last_heartbeat_at,
        state = excluded.state
    `).run(claim);

    mirrorClaimToItem(db, {
      itemId,
      ownerFamily,
      ownerInstance,
      branch,
      worktreePath,
      claimedAt: now,
      status: item.status === 'in-progress' ? 'in-progress' : 'claimed',
    });

    const action = existing && existing.owner_instance !== ownerInstance ? 'stale-reclaim' : 'claim';
    writeHandoff(db, {
      itemId,
      action,
      fromOwnerInstance: existing?.owner_instance ?? null,
      toOwnerInstance: ownerInstance,
      createdAt: now,
    });

    return claim;
  });

  return claimTx();
}

export function heartbeatItem({ db, itemId, ownerInstance, now, leaseSeconds = 900 }) {
  const heartbeatTx = db.transaction(() => {
    const claim = getClaim({ db, itemId });
    requireOwner(claim, ownerInstance);

    const nextLease = addSeconds(now, leaseSeconds);
    db.prepare(`
      UPDATE vault_claims
      SET lease_expires_at = ?, last_heartbeat_at = ?, state = 'claimed'
      WHERE item_id = ?
    `).run(nextLease, now, itemId);

    writeHandoff(db, {
      itemId,
      action: 'heartbeat',
      fromOwnerInstance: ownerInstance,
      toOwnerInstance: ownerInstance,
      createdAt: now,
    });

    return getClaim({ db, itemId });
  });

  return heartbeatTx();
}

export function releaseItem({ db, itemId, ownerInstance, now, note = null }) {
  const releaseTx = db.transaction(() => {
    const claim = getClaim({ db, itemId });
    requireOwner(claim, ownerInstance);

    db.prepare(`
      UPDATE vault_claims
      SET state = 'released', lease_expires_at = ?, last_heartbeat_at = ?
      WHERE item_id = ?
    `).run(now, now, itemId);

    mirrorClaimToItem(db, {
      itemId,
      ownerFamily: null,
      ownerInstance: null,
      worktreePath: null,
      claimedAt: null,
      handoffFrom: ownerInstance,
      handoffNote: note,
      status: 'open',
    });

    writeHandoff(db, {
      itemId,
      action: 'release',
      fromOwnerInstance: ownerInstance,
      note,
      createdAt: now,
    });

    return getClaim({ db, itemId });
  });

  return releaseTx();
}

export function completeItem({ db, itemId, ownerInstance, now, note = null }) {
  const completeTx = db.transaction(() => {
    const claim = getClaim({ db, itemId });
    requireOwner(claim, ownerInstance);

    // Evidence gate: require integration+ tier before completion
    const ev = readEvidence(claim.repo_path);
    if (ev) {
      if ((TIER_ORDER[ev.tier] || 0) < TIER_ORDER[MIN_EVIDENCE_TIER]) {
        throw new Error(
          `Cannot complete item: test evidence tier is "${ev.tier}" but minimum required is "${MIN_EVIDENCE_TIER}". ` +
          `Run integration tests before completing. Mocked tests are not proof.`
        );
      }
      if (ev.stale) {
        throw new Error('Cannot complete item: test evidence is stale. Re-run tests on current code.');
      }
    }

    db.prepare(`
      UPDATE vault_claims
      SET state = 'completed', lease_expires_at = ?, last_heartbeat_at = ?
      WHERE item_id = ?
    `).run(now, now, itemId);

    mirrorClaimToItem(db, {
      itemId,
      ownerFamily: claim.owner_family,
      ownerInstance,
      branch: claim.branch,
      worktreePath: claim.worktree_path,
      claimedAt: claim.claimed_at,
      completedAt: now,
      handoffFrom: null,
      handoffNote: note,
      status: 'done',
    });

    writeHandoff(db, {
      itemId,
      action: 'complete',
      fromOwnerInstance: ownerInstance,
      toOwnerInstance: ownerInstance,
      note,
      createdAt: now,
    });

    return getClaim({ db, itemId });
  });

  return completeTx();
}

export function reassignItem({
  db,
  itemId,
  fromOwnerInstance,
  toOwnerFamily,
  toOwnerInstance,
  repoPath,
  branch,
  worktreePath,
  now,
  note = null,
  leaseSeconds = 900,
}) {
  const reassignTx = db.transaction(() => {
    const claim = getClaim({ db, itemId });
    requireOwner(claim, fromOwnerInstance);

    const nextClaim = {
      item_id: itemId,
      owner_family: toOwnerFamily,
      owner_instance: toOwnerInstance,
      project: claim.project,
      repo_path: repoPath ?? claim.repo_path,
      branch: branch ?? claim.branch,
      worktree_path: worktreePath ?? claim.worktree_path,
      claimed_at: now,
      lease_expires_at: addSeconds(now, leaseSeconds),
      last_heartbeat_at: now,
      state: 'claimed',
    };

    db.prepare(`
      UPDATE vault_claims
      SET owner_family = @owner_family,
          owner_instance = @owner_instance,
          repo_path = @repo_path,
          branch = @branch,
          worktree_path = @worktree_path,
          claimed_at = @claimed_at,
          lease_expires_at = @lease_expires_at,
          last_heartbeat_at = @last_heartbeat_at,
          state = @state
      WHERE item_id = @item_id
    `).run(nextClaim);

    mirrorClaimToItem(db, {
      itemId,
      ownerFamily: toOwnerFamily,
      ownerInstance: toOwnerInstance,
      branch: nextClaim.branch,
      worktreePath: nextClaim.worktree_path,
      claimedAt: now,
      handoffFrom: fromOwnerInstance,
      handoffNote: note,
      status: 'claimed',
    });

    writeHandoff(db, {
      itemId,
      action: 'reassign',
      fromOwnerInstance,
      toOwnerInstance,
      note,
      createdAt: now,
    });

    return getClaim({ db, itemId });
  });

  return reassignTx();
}
