---
name: enterprise-build
description: Use when a locked enterprise plan/contract exists and implementation must proceed as strict mechanical TDD from the allowed paths, emitting receipts, one agent per file-cluster. Stop and recycle if the plan is incomplete.
---

# Enterprise Build

Mechanical execution from the locked plan. Build does **not** discover requirements, choose
architecture, widen ownership, or invent proof. If the plan is missing a path, test, owner
seam, or proof command, stop and recycle to `/enterprise-plan`.

Builds run in an **isolated worktree via sonnet subagents**, one agent per file-cluster.
One agent = one job. During build the proof verdict is always `not-yet-claiming`; no
completion/PR-ready/merge-ready claim is made here.

## Before editing

Confirm the plan is locked and covers what you are about to touch:

- every path you will edit is in the plan's **allowed runtime/test/artifact paths**
- every behavior maps to a plan postcondition (and, for issue-backed work, a verified claim)
- every touched file has its SRP decision, including any required fix-now extraction
- every DB read/write/report/proof path has its owner seam and a bounded proof/readback plan

If any is missing, stop and go back upstream — do not fill the gap by guessing.

## Execute

1. Read the locked plan, the current repo state, and the domain guards in scope:
   `/sql-guard` (any SQL), `/integration-guard` (REX/Shopify), `/blast-radius` (multi-caller).
2. Pre-edit authority scan: search for an existing owner before adding money/date/quantity/
   status/route/tenant logic or any DB writer/reader. Reuse the owned seam; if a second
   writer is genuinely needed, only add it if the plan authorizes that authority change.
3. Work the plan's postconditions **in order**, one RED→GREEN loop each:
   run the expected RED (it must fail for the stated reason), make the smallest allowed edit,
   run the expected GREEN. Build in tracer bullets — never all tests first then all code.
4. Emit **receipts**, not claims: for each loop record changed paths, postcondition id,
   command, exit status, proof type, test file/name, and log path. Mark `green` only from a
   command you actually ran and that passed — never from staged, queued, or "CI-will-pass".
5. Schema/query/data work: the first relevant RED test is live-DB / real-integration proof
   against migrated Postgres (mocks may supplement but never satisfy schema proof).
   UI/PDF/file work: leave a headless-browser command ready for review.
6. Run or stage the plan's named verification commands as each seam exists — do not defer
   field-spelling, duplicate-submit, retry, or rehydration proof to the final review.
7. Keep the diff gate-clean while coding (no new inline DB mocks for schema proof; no writes
   through mixed-owner files unless the plan owns that seam). Keep receipts portable — no
   machine-local paths or PR-creation leftovers as proof.

Hand off to `/enterprise-review` after each meaningful task boundary (or after the whole
build for small lanes). Review classifies the diff — the quality/adversarial/release lenses
live there, not here.

## Stop and recycle when

- a needed file, test, helper, writer, owner seam, or proof command is not named by the plan
- the RED signal does not fail for the stated reason, or GREEN cannot prove the postcondition
- an implementation choice needs architecture, ownership, scope, route, schema, or API judgment
- the only available proof would be partial, mock-only, stale, or wrong-head

Real CI gates live in `skills/go/GATES.md`. Build cannot call work ready, safe, complete,
mergeable, verified, or done.
