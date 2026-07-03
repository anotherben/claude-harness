---
name: enterprise-plan
description: Use when an approved design (or a specific issue/brief) exists and the next step is an exact implementation plan — file paths, task boundaries, verification commands — plus a locked contract of postconditions and invariants before build starts
---

# Enterprise Plan (plan + lock)

Turn an approved design or a verified brief into an exact, mechanical plan, then lock it.
Planning may consume most of the lane — resolve schema, file-boundary, SRP, DB, and E2E
uncertainty here, not during build. Read `skills/go/GATES.md` before planning proof.

## Inputs / outputs

- In: the design doc (`docs/designs/YYYY-MM-DD-<slug>-tdd.md`, or the issue + verified claims), the current repo state, `GATES.md`.
- Out: `docs/designs/YYYY-MM-DD-<slug>-plan.md` — the plan (tasks, paths, commands) with the
  **Lock** section (below) inline. This exact path is what build consumes; never hand off a
  plan that lives only in conversation.

## Plan

1. Re-read the design and the **current code** — a plan built only on a migration, diff,
   branch name, or issue text is invalid. For issue-backed work, mark each load-bearing
   claim `confirmed | contradicted | unverified | not-relevant` with a file/line or command;
   issue prose and labels are not proof.
2. Break the work into exact, bounded tasks with **exact file paths**. Mark which tasks are
   independent (safe for isolated subagent execution) and which are coupled.
3. Resolve fuzzy domain terms against the repo's source-of-truth docs and current code
   before they become task names, postconditions, or public seams.
4. For every new/modified file name the owner layer, single responsibility, directory
   rationale, public seam, and expected consumers. If a touched file already does multiple
   jobs and this work touches one of them, plan the fix-now extraction (or record why not).
5. Map every changed runtime file to an E2E source-to-consumer trace and its edge cases.
6. Give every task exact **verification commands** and expected outcomes — live-DB contract
   tests for schema/query work, headless-browser proof for UI/PDF/file work. Read
   `skills/go/GATES.md` and the repo's `docs/blast-radius/` conventions; plan those
   entries and DB-proof tests up front, not as merge-time patchwork.
7. Name the CI gates the work must satisfy by reference to `GATES.md` — do not restate them.

For non-trivial or risky work, run `/plan-360-audit` on the written plan and `/contract-manager`
before locking. Pause once for user approval on schema/auth/tenant/purchasing/prod-promote work.

## Lock

Once the plan is sound, lock it so build is mechanical and cannot invent scope:

- **Postconditions** — the observable end-state per layer, each with its proof command.
- **Invariants** — tenant/owner/current-DB scoping, affected-row/readback expectations,
  dependency direction, forbidden imports, and the boundaries this work must preserve.
- **Consumer mapping** — for every changed output (DTO, query result, event, projection,
  print/notification payload), the exact downstream consumers and the field names/aliases
  they read. One list — no duplicated matrices.
- **Allowed paths** — exact runtime, test, and artifact files build may touch. Anything
  outside is a build failure that recycles here.
- **Refusal conditions** — missing owner, path, test, DB-ownership seam, or any need to
  widen scope stops build and returns to this plan.

Do not lock while current code, real DB behavior, file boundaries, SRP, or edge cases
remain unclear. A schema/query claim cannot lock without a live-DB proof command (or an
explicit narrowing of the claim). Hand off to `/enterprise-build`.
