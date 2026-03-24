import test from 'node:test';
import assert from 'node:assert/strict';
import { indexVault } from '../src/indexer/pipeline.js';
import { createTestContext } from './helpers/test_context.js';
import { claimItem } from '../src/coordination/claims.js';
import {
  checkDispatch,
  closeDispatchRun,
  closeWorker,
  ensureOrchestrator,
  getDispatchRun,
  heartbeatOrchestrator,
  openDispatchRun,
  registerWorker,
} from '../src/coordination/orchestration.js';

async function seedDispatchItem(ctx) {
  await ctx.writeNote(
    '02-Tasks/20260317-task-dispatch-gate.md',
    `---
type: task
project: helpdesk
priority: high
status: open
created: 2026-03-17T10:00:00Z
updated: 2026-03-17T10:00:00Z
---
All repo-changing work must sit behind a registered dispatch lane.`
  );

  await indexVault({ vaultPath: ctx.vaultPath, db: ctx.db, embedder: ctx.embedder, incremental: false });
  return ctx.db.prepare('SELECT id FROM vault_items WHERE path = ?').get('02-Tasks/20260317-task-dispatch-gate.md').id;
}

test('ensureOrchestrator blocks a second live coordinator and allows stale takeover', async (t) => {
  const ctx = await createTestContext();
  t.after(async () => ctx.cleanup());

  const first = ensureOrchestrator({
    db: ctx.db,
    profileName: 'LEADER',
    conductorName: 'orchestrator',
    ownerFamily: 'claude',
    ownerInstance: 'claude:deck:leader-1',
    agentDeckSession: 'leader-1',
    repoScope: 'global',
    now: '2026-03-17T11:00:00Z',
    leaseSeconds: 60,
  });

  assert.equal(first.orchestrator_id, 'LEADER:orchestrator');

  assert.throws(
    () => ensureOrchestrator({
      db: ctx.db,
      profileName: 'LEADER',
      conductorName: 'orchestrator',
      ownerFamily: 'codex',
      ownerInstance: 'codex:deck:leader-2',
      agentDeckSession: 'leader-2',
      repoScope: 'global',
      now: '2026-03-17T11:00:30Z',
      leaseSeconds: 60,
    }),
    /already owned/i
  );

  const reclaimed = ensureOrchestrator({
    db: ctx.db,
    profileName: 'LEADER',
    conductorName: 'orchestrator',
    ownerFamily: 'codex',
    ownerInstance: 'codex:deck:leader-2',
    agentDeckSession: 'leader-2',
    repoScope: 'global',
    now: '2026-03-17T11:01:05Z',
    leaseSeconds: 900,
  });

  assert.equal(reclaimed.owner_instance, 'codex:deck:leader-2');
});

test('dispatch registration enforces a matching worker lane and vault claim', async (t) => {
  const ctx = await createTestContext();
  t.after(async () => ctx.cleanup());

  const itemId = await seedDispatchItem(ctx);
  const orchestrator = ensureOrchestrator({
    db: ctx.db,
    profileName: 'LEADER',
    conductorName: 'orchestrator',
    ownerFamily: 'claude',
    ownerInstance: 'claude:deck:leader-1',
    agentDeckSession: 'leader-1',
    repoScope: 'global',
    now: '2026-03-17T11:00:00Z',
    leaseSeconds: 900,
  });

  const run = openDispatchRun({
    db: ctx.db,
    orchestratorId: orchestrator.orchestrator_id,
    vaultItemId: itemId,
    project: 'helpdesk',
    repoPath: '/Users/ben/helpdesk',
    branch: 'claude/task_dispatch_gate',
    worktreePath: '/Users/ben/.claude/worktrees/helpdesk/task_dispatch_gate',
    requestedBy: 'leader-1',
    now: '2026-03-17T11:01:00Z',
  });

  const worker = registerWorker({
    db: ctx.db,
    runId: run.run_id,
    vaultItemId: itemId,
    ownerFamily: 'claude',
    ownerInstance: 'claude:deck:worker-1',
    agentDeckSession: 'worker-1',
    repoPath: '/Users/ben/helpdesk',
    branch: 'claude/task_dispatch_gate',
    worktreePath: '/Users/ben/.claude/worktrees/helpdesk/task_dispatch_gate',
    workerId: 'worker-1',
    now: '2026-03-17T11:02:00Z',
    leaseSeconds: 900,
  });

  claimItem({
    db: ctx.db,
    itemId,
    ownerFamily: 'claude',
    ownerInstance: 'claude:deck:worker-1',
    repoPath: '/Users/ben/helpdesk',
    branch: 'claude/task_dispatch_gate',
    worktreePath: '/Users/ben/.claude/worktrees/helpdesk/task_dispatch_gate',
    now: '2026-03-17T11:02:10Z',
    leaseSeconds: 900,
  });

  const check = checkDispatch({
    db: ctx.db,
    profileName: 'LEADER',
    conductorName: 'orchestrator',
    agentDeckSession: 'worker-1',
    repoPath: '/Users/ben/helpdesk',
    branch: 'claude/task_dispatch_gate',
    worktreePath: '/Users/ben/.claude/worktrees/helpdesk/task_dispatch_gate',
    itemId,
    now: '2026-03-17T11:03:00Z',
  });

  assert.equal(check.ok, true);
  assert.equal(check.worker.worker_id, worker.worker_id);
  assert.equal(check.run.run_id, run.run_id);
});

test('checkDispatch fails closed on branch mismatch even when the worker exists', async (t) => {
  const ctx = await createTestContext();
  t.after(async () => ctx.cleanup());

  const itemId = await seedDispatchItem(ctx);
  const orchestrator = ensureOrchestrator({
    db: ctx.db,
    profileName: 'LEADER',
    conductorName: 'orchestrator',
    ownerFamily: 'claude',
    ownerInstance: 'claude:deck:leader-1',
    agentDeckSession: 'leader-1',
    repoScope: 'global',
    now: '2026-03-17T11:00:00Z',
    leaseSeconds: 900,
  });

  const run = openDispatchRun({
    db: ctx.db,
    orchestratorId: orchestrator.orchestrator_id,
    vaultItemId: itemId,
    project: 'helpdesk',
    repoPath: '/Users/ben/helpdesk',
    branch: 'claude/task_dispatch_gate',
    worktreePath: '/Users/ben/.claude/worktrees/helpdesk/task_dispatch_gate',
    requestedBy: 'leader-1',
    now: '2026-03-17T11:01:00Z',
  });

  registerWorker({
    db: ctx.db,
    runId: run.run_id,
    vaultItemId: itemId,
    ownerFamily: 'claude',
    ownerInstance: 'claude:deck:worker-1',
    agentDeckSession: 'worker-1',
    repoPath: '/Users/ben/helpdesk',
    branch: 'claude/task_dispatch_gate',
    worktreePath: '/Users/ben/.claude/worktrees/helpdesk/task_dispatch_gate',
    workerId: 'worker-1',
    now: '2026-03-17T11:02:00Z',
    leaseSeconds: 900,
  });

  claimItem({
    db: ctx.db,
    itemId,
    ownerFamily: 'claude',
    ownerInstance: 'claude:deck:worker-1',
    repoPath: '/Users/ben/helpdesk',
    branch: 'claude/task_dispatch_gate',
    worktreePath: '/Users/ben/.claude/worktrees/helpdesk/task_dispatch_gate',
    now: '2026-03-17T11:02:10Z',
    leaseSeconds: 900,
  });

  const check = checkDispatch({
    db: ctx.db,
    profileName: 'LEADER',
    conductorName: 'orchestrator',
    agentDeckSession: 'worker-1',
    repoPath: '/Users/ben/helpdesk',
    branch: 'claude/task_dispatch_gate_wrong',
    worktreePath: '/Users/ben/.claude/worktrees/helpdesk/task_dispatch_gate',
    itemId,
    now: '2026-03-17T11:03:00Z',
  });

  assert.equal(check.ok, false);
  assert.match(check.failures.join('\n'), /no open dispatch run matches this lane/i);
});

test('closed workers allow the dispatch run to close cleanly', async (t) => {
  const ctx = await createTestContext();
  t.after(async () => ctx.cleanup());

  const itemId = await seedDispatchItem(ctx);
  const orchestrator = ensureOrchestrator({
    db: ctx.db,
    profileName: 'LEADER',
    conductorName: 'orchestrator',
    ownerFamily: 'claude',
    ownerInstance: 'claude:deck:leader-1',
    agentDeckSession: 'leader-1',
    repoScope: 'global',
    now: '2026-03-17T11:00:00Z',
    leaseSeconds: 900,
  });

  const refreshed = heartbeatOrchestrator({
    db: ctx.db,
    orchestratorId: orchestrator.orchestrator_id,
    ownerInstance: 'claude:deck:leader-1',
    now: '2026-03-17T11:00:30Z',
    leaseSeconds: 900,
  });
  assert.equal(refreshed.owner_instance, 'claude:deck:leader-1');

  const run = openDispatchRun({
    db: ctx.db,
    orchestratorId: orchestrator.orchestrator_id,
    vaultItemId: itemId,
    project: 'helpdesk',
    repoPath: '/Users/ben/helpdesk',
    branch: 'claude/task_dispatch_gate',
    worktreePath: '/Users/ben/.claude/worktrees/helpdesk/task_dispatch_gate',
    requestedBy: 'leader-1',
    now: '2026-03-17T11:01:00Z',
  });

  const worker = registerWorker({
    db: ctx.db,
    runId: run.run_id,
    vaultItemId: itemId,
    ownerFamily: 'claude',
    ownerInstance: 'claude:deck:worker-1',
    agentDeckSession: 'worker-1',
    repoPath: '/Users/ben/helpdesk',
    branch: 'claude/task_dispatch_gate',
    worktreePath: '/Users/ben/.claude/worktrees/helpdesk/task_dispatch_gate',
    workerId: 'worker-1',
    now: '2026-03-17T11:02:00Z',
    leaseSeconds: 900,
  });

  closeWorker({
    db: ctx.db,
    workerId: worker.worker_id,
    ownerInstance: 'claude:deck:worker-1',
    status: 'completed',
    now: '2026-03-17T11:10:00Z',
  });

  const closedRun = closeDispatchRun({
    db: ctx.db,
    runId: run.run_id,
    orchestratorId: orchestrator.orchestrator_id,
    status: 'completed',
    now: '2026-03-17T11:11:00Z',
  });

  assert.equal(closedRun.status, 'completed');
  assert.equal(getDispatchRun({ db: ctx.db, runId: run.run_id }).closed_at, '2026-03-17T11:11:00Z');
  const mirroredItem = ctx.db.prepare(`
    SELECT orchestrator_id, dispatch_run_id, worker_id
    FROM vault_items
    WHERE id = ?
  `).get(itemId);
  assert.equal(mirroredItem.orchestrator_id, null);
  assert.equal(mirroredItem.dispatch_run_id, null);
  assert.equal(mirroredItem.worker_id, null);
});
