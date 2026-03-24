import test from 'node:test';
import assert from 'node:assert/strict';
import { indexVault } from '../src/indexer/pipeline.js';
import { createTestContext } from './helpers/test_context.js';
import {
  claimItem,
  completeItem,
  getClaim,
  releaseItem,
} from '../src/coordination/claims.js';

async function seedItem(ctx) {
  await ctx.writeNote(
    '01-Bugs/20260317-bug-claim-item.md',
    `---
type: bug
project: helpdesk
priority: critical
status: open
created: 2026-03-17T10:00:00Z
updated: 2026-03-17T10:00:00Z
---
Two agents should not be able to own the same backlog item.`
  );

  await indexVault({ vaultPath: ctx.vaultPath, db: ctx.db, embedder: ctx.embedder, incremental: false });
  return ctx.db.prepare('SELECT id FROM vault_items WHERE path = ?').get('01-Bugs/20260317-bug-claim-item.md').id;
}

test('claimItem grants the first owner exclusive ownership and mirrors it to vault_items', async (t) => {
  const ctx = await createTestContext();
  t.after(async () => ctx.cleanup());

  const itemId = await seedItem(ctx);
  const now = '2026-03-17T11:00:00Z';

  const claim = claimItem({
    db: ctx.db,
    itemId,
    ownerFamily: 'codex',
    ownerInstance: 'codex:session-1',
    repoPath: '/Users/ben/helpdesk',
    branch: 'codex/bug_helpdesk_20260317_claim',
    worktreePath: '/Users/ben/.codex/worktrees/helpdesk/bug_helpdesk_20260317_claim',
    now,
    leaseSeconds: 900,
  });

  assert.equal(claim.item_id, itemId);
  assert.equal(claim.owner_instance, 'codex:session-1');

  const mirrored = ctx.db.prepare('SELECT owner_family, owner_instance, branch, worktree_path, claimed_at FROM vault_items WHERE id = ?').get(itemId);
  assert.deepEqual(mirrored, {
    owner_family: 'codex',
    owner_instance: 'codex:session-1',
    branch: 'codex/bug_helpdesk_20260317_claim',
    worktree_path: '/Users/ben/.codex/worktrees/helpdesk/bug_helpdesk_20260317_claim',
    claimed_at: now,
  });
});

test('claimItem rejects a second owner while the lease is still live', async (t) => {
  const ctx = await createTestContext();
  t.after(async () => ctx.cleanup());

  const itemId = await seedItem(ctx);

  claimItem({
    db: ctx.db,
    itemId,
    ownerFamily: 'claude',
    ownerInstance: 'claude:session-1',
    repoPath: '/Users/ben/helpdesk',
    branch: 'claude/claim',
    worktreePath: '/Users/ben/.claude/worktrees/helpdesk/claim',
    now: '2026-03-17T11:00:00Z',
    leaseSeconds: 900,
  });

  assert.throws(
    () => claimItem({
      db: ctx.db,
      itemId,
      ownerFamily: 'codex',
      ownerInstance: 'codex:session-2',
      repoPath: '/Users/ben/helpdesk',
      branch: 'codex/claim',
      worktreePath: '/Users/ben/.codex/worktrees/helpdesk/claim',
      now: '2026-03-17T11:01:00Z',
      leaseSeconds: 900,
    }),
    /already claimed/i
  );
});

test('releaseItem and completeItem reject non-owners', async (t) => {
  const ctx = await createTestContext();
  t.after(async () => ctx.cleanup());

  const itemId = await seedItem(ctx);

  claimItem({
    db: ctx.db,
    itemId,
    ownerFamily: 'codex',
    ownerInstance: 'codex:session-1',
    repoPath: '/Users/ben/helpdesk',
    branch: 'codex/claim',
    worktreePath: '/Users/ben/.codex/worktrees/helpdesk/claim',
    now: '2026-03-17T11:00:00Z',
    leaseSeconds: 900,
  });

  assert.throws(() => releaseItem({ db: ctx.db, itemId, ownerInstance: 'codex:session-2', now: '2026-03-17T11:02:00Z' }), /owner/i);
  assert.throws(() => completeItem({ db: ctx.db, itemId, ownerInstance: 'codex:session-2', now: '2026-03-17T11:02:00Z' }), /owner/i);
});

test('claimItem allows stale reclaim after lease expiry', async (t) => {
  const ctx = await createTestContext();
  t.after(async () => ctx.cleanup());

  const itemId = await seedItem(ctx);

  claimItem({
    db: ctx.db,
    itemId,
    ownerFamily: 'claude',
    ownerInstance: 'claude:session-1',
    repoPath: '/Users/ben/helpdesk',
    branch: 'claude/claim',
    worktreePath: '/Users/ben/.claude/worktrees/helpdesk/claim',
    now: '2026-03-17T11:00:00Z',
    leaseSeconds: 60,
  });

  const reclaimed = claimItem({
    db: ctx.db,
    itemId,
    ownerFamily: 'codex',
    ownerInstance: 'codex:session-2',
    repoPath: '/Users/ben/helpdesk',
    branch: 'codex/reclaim',
    worktreePath: '/Users/ben/.codex/worktrees/helpdesk/reclaim',
    now: '2026-03-17T11:01:01Z',
    leaseSeconds: 900,
  });

  assert.equal(reclaimed.owner_instance, 'codex:session-2');
  assert.equal(getClaim({ db: ctx.db, itemId }).owner_instance, 'codex:session-2');
});
