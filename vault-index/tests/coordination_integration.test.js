import test from 'node:test';
import assert from 'node:assert/strict';
import { indexVault } from '../src/indexer/pipeline.js';
import { createTestContext } from './helpers/test_context.js';
import {
  claimItem,
  completeItem,
  getClaim,
  reassignItem,
} from '../src/coordination/claims.js';

async function seedSharedItem(ctx) {
  await ctx.writeNote(
    '02-Tasks/20260317-task-shared-lane.md',
    `---
type: task
project: helpdesk
priority: high
status: open
created: 2026-03-17T10:00:00Z
updated: 2026-03-17T10:00:00Z
---
Build a shared lane that Claude and Codex can hand off cleanly.`
  );

  await indexVault({ vaultPath: ctx.vaultPath, db: ctx.db, embedder: ctx.embedder, incremental: false });
  return ctx.db.prepare('SELECT id FROM vault_items WHERE path = ?').get('02-Tasks/20260317-task-shared-lane.md').id;
}

test('shared agent coordination supports explicit handoff and completion', async (t) => {
  const ctx = await createTestContext();
  t.after(async () => ctx.cleanup());

  const itemId = await seedSharedItem(ctx);

  claimItem({
    db: ctx.db,
    itemId,
    ownerFamily: 'claude',
    ownerInstance: 'claude:session-1',
    repoPath: '/Users/ben/helpdesk',
    branch: 'claude/task_helpdesk_20260317_shared',
    worktreePath: '/Users/ben/.claude/worktrees/helpdesk/task_helpdesk_20260317_shared',
    now: '2026-03-17T11:00:00Z',
    leaseSeconds: 900,
  });

  const reassigned = reassignItem({
    db: ctx.db,
    itemId,
    fromOwnerInstance: 'claude:session-1',
    toOwnerFamily: 'codex',
    toOwnerInstance: 'codex:session-2',
    repoPath: '/Users/ben/helpdesk',
    branch: 'codex/task_helpdesk_20260317_shared',
    worktreePath: '/Users/ben/.codex/worktrees/helpdesk/task_helpdesk_20260317_shared',
    now: '2026-03-17T11:05:00Z',
    note: 'Claude finished discovery and handed the build lane to Codex.',
    leaseSeconds: 900,
  });

  assert.equal(reassigned.owner_instance, 'codex:session-2');
  assert.equal(getClaim({ db: ctx.db, itemId }).owner_instance, 'codex:session-2');

  const mirroredAfterHandoff = ctx.db.prepare(`
    SELECT owner_family, owner_instance, branch, worktree_path, handoff_from, handoff_note, status
    FROM vault_items
    WHERE id = ?
  `).get(itemId);
  assert.deepEqual(mirroredAfterHandoff, {
    owner_family: 'codex',
    owner_instance: 'codex:session-2',
    branch: 'codex/task_helpdesk_20260317_shared',
    worktree_path: '/Users/ben/.codex/worktrees/helpdesk/task_helpdesk_20260317_shared',
    handoff_from: 'claude:session-1',
    handoff_note: 'Claude finished discovery and handed the build lane to Codex.',
    status: 'claimed',
  });

  completeItem({
    db: ctx.db,
    itemId,
    ownerInstance: 'codex:session-2',
    now: '2026-03-17T11:30:00Z',
    note: 'Implementation and verification completed.',
  });

  const completed = ctx.db.prepare('SELECT status, completed_at FROM vault_items WHERE id = ?').get(itemId);
  assert.equal(completed.status, 'done');
  assert.equal(completed.completed_at, '2026-03-17T11:30:00Z');
});
