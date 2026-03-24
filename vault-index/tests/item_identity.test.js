import test from 'node:test';
import assert from 'node:assert/strict';
import { indexVault } from '../src/indexer/pipeline.js';
import { createTestContext } from './helpers/test_context.js';

test('indexVault backfills a stable id for notes that are missing one', async (t) => {
  const ctx = await createTestContext();
  t.after(async () => ctx.cleanup());

  await ctx.writeNote(
    '01-Bugs/20260317-bug-claim-collision.md',
    `---
type: bug
project: helpdesk
priority: high
status: open
created: 2026-03-17T10:00:00Z
updated: 2026-03-17T10:00:00Z
---
Supplier claim collision when two agents pick up the same item.`
  );

  await indexVault({ vaultPath: ctx.vaultPath, db: ctx.db, embedder: ctx.embedder, incremental: false });

  const row = ctx.db.prepare('SELECT id, path FROM vault_items WHERE path = ?').get('01-Bugs/20260317-bug-claim-collision.md');
  assert.ok(row?.id, 'expected an indexed id to be backfilled');
  assert.match(row.id, /^bug_helpdesk_20260317_/);
});

test('indexVault preserves an explicit frontmatter id', async (t) => {
  const ctx = await createTestContext();
  t.after(async () => ctx.cleanup());

  await ctx.writeNote(
    '02-Tasks/20260317-task-codex-parity.md',
    `---
id: task_helpdesk_20260317_manual
type: task
project: helpdesk
priority: medium
status: open
created: 2026-03-17T10:00:00Z
updated: 2026-03-17T10:00:00Z
---
Create Codex parity for the Obsidian workflow.`
  );

  await indexVault({ vaultPath: ctx.vaultPath, db: ctx.db, embedder: ctx.embedder, incremental: false });

  const row = ctx.db.prepare('SELECT id FROM vault_items WHERE path = ?').get('02-Tasks/20260317-task-codex-parity.md');
  assert.equal(row?.id, 'task_helpdesk_20260317_manual');
});

test('indexVault keeps the same logical id when a note moves folders', async (t) => {
  const ctx = await createTestContext();
  t.after(async () => ctx.cleanup());

  const fromPath = '02-Tasks/20260317-task-agent-handoff.md';
  const toPath = '04-In-Progress/20260317-task-agent-handoff.md';
  const note = `---
type: task
project: helpdesk
priority: medium
status: open
created: 2026-03-17T10:00:00Z
updated: 2026-03-17T10:00:00Z
---
Add explicit handoff support for shared agent work.`;

  await ctx.writeNote(fromPath, note);
  await indexVault({ vaultPath: ctx.vaultPath, db: ctx.db, embedder: ctx.embedder, incremental: false });

  const original = ctx.db.prepare('SELECT id FROM vault_items WHERE path = ?').get(fromPath);
  assert.ok(original?.id, 'expected an original id before moving the file');

  await ctx.moveNote(fromPath, toPath);
  await indexVault({ vaultPath: ctx.vaultPath, db: ctx.db, embedder: ctx.embedder, incremental: false });

  const moved = ctx.db.prepare('SELECT id FROM vault_items WHERE path = ?').get(toPath);
  const oldPath = ctx.db.prepare('SELECT id FROM vault_items WHERE path = ?').get(fromPath);

  assert.equal(moved?.id, original.id);
  assert.equal(oldPath, undefined);
});
