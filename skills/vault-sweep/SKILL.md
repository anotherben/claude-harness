---
name: vault-sweep
description: Weekly accountability check AND quick cross-project status for the Obsidian vault. Detects stale inbox, stale active work, ghost work, verification debt, dead branches, missing metadata, and cross-project sprawl. Use when the user says "sweep the vault", "what's stale", "clean up", or invokes /vault-sweep. Also covers the former /vault-status: "what's open", "vault status", "show my dashboard", "what am I working on", or when the user seems unsure what to work on next.
---

# Vault Sweep

The sweep follows the controller model. It has two modes:

- **Quick status** (read-only, was `/vault-status`) — a fast project-load + attention summary,
  no mutation offers. Triggered by "what's open", "vault status", "dashboard", "what am I working
  on", or when the user needs a project overview.
- **Full sweep** (default, weekly accountability) — quick status's flags plus dead-branch checks,
  resolved-blocker checks, and guided cleanup offers. Triggered by "sweep the vault", "what's
  stale", "clean up".

Both modes share the same flag computation (Step 2 below) — do it once, then branch on mode.

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

If the user named a project (quick status mode supports this), filter every result to that
`project` and state clearly: `Filtered to project: <name>`.

### 2. Classify controller debt

Flag (shared by both modes — compute once):

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
- `PROOF-GAP` (aka Verification Gap)
  - item has `proof_state`, or has obvious completion signals but is still open
- `NEEDS-ATTENTION`
  - all `critical` items, all `blocked` items

**Quick status mode stops here** — skip straight to Step 5's quick-status rendering, no mutation
offers. **Full sweep continues** to Steps 3–4 for branch/blocker/sprawl checks.

### 3. Check branches and blockers (full sweep only)

For `04-In-Progress` items with a branch:

- verify the branch still exists in the mapped repo
- flag dead branches

For items with `blocked_by`:

- inspect blocker state through vault-index
- flag blocks that are resolved in practice but still linked

### 4. Compute project sprawl (full sweep only)

Report:

- distinct open projects
- distinct recently active projects
- highest-load projects

If open projects are much higher than recently active projects, call that out as scatter-brain risk.

### 5. Present the report

**Quick status mode** — render just:

- `Project Load` table (per project: open / inbox / active / blocked / critical counts)
- `Needs Attention Today` (critical + blocked items)
- `Ghost Work`
- `Verification Gaps`
- `Inbox Debt`

Close with one recommendation, in priority order: critical items first, then blocked items, then
ghost-work cleanup, then inbox triage, otherwise the highest-load project. If the user wants the
actual dashboard surface, point to `[[Master Dashboard]]`, `[[06-Portfolio/00 Portfolio Control
Tower]]`, `[[06-Portfolio/05 Verification Gap Register]]`, `[[Projects/<project>/README]]`.

**Full sweep mode** — render all of:

- `Immediate Cleanup`
- `Ghost Work`
- `Stale Active Work`
- `Inbox Debt`
- `Verification Debt`
- `Dead Branches`
- `Resolved Blockers`
- `Project Load`

Use concise tables or flat lists.

### 6. Offer actions (full sweep only)

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

