---
name: vault-sweep
description: Weekly accountability check for the Obsidian vault. Detects stale inbox, stale active work, ghost work, verification debt, dead branches, missing metadata, and cross-project sprawl. Use when the user says "sweep the vault", "what's stale", "clean up", or invokes /vault-sweep.
---

# Vault Sweep

The sweep now follows the controller model. It is primarily a detection and triage routine, not an automatic mutation pass.

## Controller Rules

Canonical statuses:

- `open`
- `claimed`
- `in-progress`
- `blocked`
- `done`
- `wont-do`

Normalize:

- `active` => `in-progress`
- `closed` => `done`
- `completed` => `done`

## Procedure

### 1. Load active items

Fetch:

- `status="open"`
- `status="claimed"`
- `status="in-progress"`
- `status="blocked"`

Also load:

- `folder="00-Inbox"`
- `folder="04-In-Progress"`

### 2. Classify controller debt

Flag:

- `STALE-INBOX`
  - inbox item older than 48 hours
- `STALE-ACTIVE`
  - claimed or in-progress item untouched for 7+ days
- `GHOST`
  - completion evidence exists but status is not `done`
- `MISSING-NEXT`
  - governed item missing `next_action`
- `MISSING-ID`
  - item missing `id`
- `PROOF-GAP`
  - item has `proof_state`

### 3. Check branches and blockers

For `04-In-Progress` items with a branch:

- verify the branch still exists in the mapped repo
- flag dead branches

For items with `blocked_by`:

- inspect blocker state through vault-index
- flag blocks that are resolved in practice but still linked

### 4. Compute project sprawl

Report:

- distinct open projects
- distinct recently active projects
- highest-load projects

If open projects are much higher than recently active projects, call that out as scatter-brain risk.

### 5. Present the report

Render these sections:

- `Immediate Cleanup`
- `Ghost Work`
- `Stale Active Work`
- `Inbox Debt`
- `Verification Debt`
- `Dead Branches`
- `Resolved Blockers`
- `Project Load`

Use concise tables or flat lists.

### 6. Offer actions

Offer guided operations, not automatic ones:

- normalize statuses
- add missing `next_action`
- close or archive ghost work
- remove resolved blockers
- create missing project homes

Do not auto-escalate priorities unless the user explicitly asks for it.

### 7. Re-index after changes

After any updates:

```text
mcp__vault-index__index_vault(incremental=true)
```

### 8. Record the sweep timestamp

```bash
date -u +"%Y-%m-%dT%H:%M:%SZ" > /tmp/claude-vault-last-sweep
```

