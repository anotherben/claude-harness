---
name: incident
description: "Production incident response, rollback, and post-deploy watch. Use when prod is down or degraded, errors/alerts are spiking, a deploy went bad, readers are timing out (55P03), sync backlogs are climbing, or the user says \"prod is broken\", \"incident\", \"roll it back\", \"what's happening in prod\", \"watch the deploy\". Also owns post-promote observation after /promote's canary window closes."
---

# /incident — stabilize first, root-cause second

Priority order is fixed: **stop the bleeding → confirm stable → then diagnose**. Root-cause
work happens via /diagnose AFTER stability, never instead of it.

## 1. Triage (minutes, not analysis)

- What changed last? Check in this order: Render deploy events, `schema_migrations.applied_at`
  (a migration inside the incident window = manual out-of-band run; prod does NOT migrate on
  boot), recent merges to main, config/env changes.
- Classify the signature:
  - **55P03 lock-timeout cascade** on plain SELECTs across unrelated tables → DDL holding
    ACCESS EXCLUSIVE (see sql-guard's rollout rules). Usually resolves when the migration
    finishes; kill the offending backend only if it's a stuck rewrite.
  - **Sync backlog climbing** → check worker health before assuming code: a restart releases
    worker claims and re-flags items (looks like a spike but drains). Only a *climbing* backlog
    or db-down is rollback-class (promote's canary rule).
  - **Errors spiking after a deploy** → rollback-class if the trajectory is worsening.
- Spawn a haiku/sonnet watcher to poll the health signal every few minutes while you work;
  never let observation block action.

## 2. Rollback (when rollback-class)

- Render: POST a deploy pinned to the previous live commit for the affected service(s) — the
  same mechanism as /promote step 6. Portal/API fleet: remember auto-deploy does NOT fire on
  ref updates; every service you roll back needs an explicit pinned deploy.
- Migrations do NOT auto-reverse. If the bad release carried one, decide: roll code back and
  leave a compatible schema (preferred — additive migrations are backward-compatible), or
  write a explicit down-migration through the migrationLockTimeout owner. Never hand-revert
  schema on prod psql under pressure.
- One change at a time; after each action, wait one full signal cycle before the next.

## 3. Confirm stable

- Baseline-relative, not absolute: db connected, backlog trending down, no NEW issue codes
  (reuse `promote/scripts/canary-health-gate.sh watch` when applicable).
- State plainly what is proven stable and what is still unverified.

## 4. Hand off to root cause

- Open a GitHub issue with the timeline (signatures, actions, evidence links) while it's fresh.
- Route to `/go` DEBUG depth (→ /diagnose) for the real fix; the incident is not closed until
  the root-cause fix ships through normal gates AND /enterprise-compound records the trap.
- Post-incident, /advisor is the venue for "should we change process" questions — don't bolt
  process changes onto the incident PR.

## Rules

- Prod actions are operator-gated: rollbacks and prod migration runs need Ben's explicit
  go-ahead unless he's unreachable AND the signature is unambiguous db-down/climbing-backlog
  (then act, log every command, report immediately).
- Never debug on prod data beyond read-only queries; reproduction happens on dev.
- Every command you run during an incident goes in the issue timeline — no silent actions.
