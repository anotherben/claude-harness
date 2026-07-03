# Enterprise Debug Workflow

Use this reference when executing `enterprise-debug`.

## Phase 1: Reproduce Or Validate

Start from the user's exact signal: log line, failing test, browser symptom,
HTTP response, DB row, PR comment, or workflow error. Do not patch before the
signal is reproduced or source-proven.

Record:

- exact symptom and timestamp/context
- command, URL, selector, query, or log source used
- current branch/head/worktree
- affected user/workflow/data surface
- whether the task is read-only diagnosis or fix-authorized

## Phase 2: Source-Grounded Trace

Trace the real execution path before forming root cause:

- entry point, route, worker, webhook, UI action, or scheduled job
- auth/tenant/owner boundary
- service/repository/query path
- side effects, transactions, retries, and background jobs
- final consumer, rendered state, outgoing integration, or persisted row

Use Cortex as a location map when available, then verify with direct source
reads. If Cortex is stale or incomplete, record the fallback reason and use
`rg`/direct reads.

## Phase 3: Root Cause And Blast Radius

Write a concise root-cause statement:

- trigger
- failing condition
- exact code path
- why existing checks missed it
- sibling paths and consumers that may share the bug class

Classify SRP/refactor ideas as:

- `fix-now`: required to solve the bug safely
- `follow-up`: real debt, not required for the current fix
- `note-only`: observation with no current action

## Phase 4: Contractable Fix

Before implementation, produce or update the contract/build packet with:

- exact runtime paths
- exact test paths
- exact artifact paths
- module boundary, folder placement, public seam, owner layer, allowed dependency
  direction, forbidden imports, and architecture tests
- PC execution order
- RED command and failure signal
- GREEN command and pass signal
- required local/CI/live/headless commands
- forbidden changes
- refusal conditions

If the fix needs an unlisted path, helper, writer, query, schema, public seam, or
architecture decision, stop and recycle to plan/contract.

## Phase 5: Verify And Recycle

Run the smallest proof that fails for the real reason, then the proof that turns
green after the fix. For schema/query/data-sensitive work, mock-only or
migration-only evidence is not enough. For UI/PDF/file/rendered-output work,
headless browser proof is required when making completion claims.

If review, CI, or live proof forces a code pivot, previous review
evidence for affected files expires.
