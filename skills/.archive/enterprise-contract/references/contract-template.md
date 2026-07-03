# Contract Template

```markdown
# <Title> Contract

**Date**: YYYY-MM-DD
**Status**: DRAFT
**Proof Scope Target**: function-level | slice-level | domain-level | full-system
**Design**: docs/designs/YYYY-MM-DD-<slug>-tdd.md
**Plan**: docs/plans/YYYY-MM-DD-<slug>-plan.md

## GitHub Issue Intake

| Field | Value |
|-------|-------|
| Issue | #... / URL |
| Live fetch command | `gh issue view ...` or `github_issue_intake.py ...` |
| State / labels | ... |
| Risk flags | ... |
| Source-read targets | ... |

The issue body is intake, not proof.

## Issue Claim Verification

| Claim | Status | Current Evidence | Contract Item / Non-Goal / Blocker |
|-------|--------|------------------|-------------------------------------|
| issue claim text/id | confirmed / contradicted / unverified / not relevant | `path:line`, command, DB proof, or blocker | PC/INV/ERR id, non-goal, or stop rule |

`LOCKED` is blocked while a load-bearing claim remains `unverified`, unless the
claim is explicitly narrowed out of scope.

## Intent Continuity Ledger

| Original User Words | Business Outcome | Operator Acceptance | Non-Goals | Contract Item | Proof Command |
|---------------------|------------------|---------------------|-----------|---------------|---------------|
| ... | ... | ... | ... | PC/INV/ERR id | command + expected signal |

Every load-bearing outcome from the vague/product prompt or `/goal` intake must
stay traceable here. A row with no proof command or no contract item blocks
`LOCKED`.

## Alternatives And Decision Rationale

| Decision | Incumbent / No-Change | Alternative | Selected | Source Evidence | Proof Impact |
|----------|-----------------------|-------------|----------|-----------------|--------------|
| ... | ... | ... | ... | `path:line` / command | ... |

## Preconditions

- ...

## Postconditions

| ID | Layer | Requirement | Test Name | Code Target |
|----|-------|-------------|-----------|-------------|
| PC-1 | Service | ... | `...` | `path/to/file` |

## Invariants

| ID | Invariant | Applies | Notes |
|----|-----------|---------|-------|
| INV-1 | ... | yes | ... |

Prefer behavior invariants over volatile implementation constants. For tuning,
ranking, thresholds, generated scores, or heuristic outputs, lock exact numeric
values only when the business requirement is the number itself. Otherwise require
proof that the first run moves from the seeded baseline when it should, and that
later reruns preserve the first result/fingerprint without ratcheting.

## Error Cases

| ID | Trigger | Expected Result | Test Name |
|----|---------|-----------------|-----------|
| ERR-1 | ... | ... | `...` |

## Consumer Map

| Output | Consumer | Fields Used | Location |
|--------|----------|-------------|----------|
| ... | ... | ... | `path:line` |

## File And Module Architecture

| Path | Layer | Responsibility | Public Seam | Directory Rationale | SRP Risk |
|------|-------|----------------|-------------|---------------------|----------|
| `path/to/file.js` | service/repository/route/ui/worker | one reason to change | export/import/route | existing pattern followed | low/med/high |

## Touched File SRP Assessment

| Path | Current Responsibilities | Owner Layer | Why Touched | SRP Risk | Classification | Required Action | Proof Command |
|------|--------------------------|-------------|-------------|----------|----------------|-----------------|---------------|
| `path/to/file.js` | source-backed list | service/repository/route/ui/worker | one reason | low/med/high | fix-now / follow-up / note-only | extraction/public seam/non-goal | command + expected signal |

If a touched file mixes unrelated responsibilities and this work touches one of
them, `fix-now` is mandatory unless the contract blocks or narrows the claim.

## Architecture Ratchet Matrix

- Boundary:
- Current source evidence:
- Target shape:
- Public seam:
- Owner layer:
- Allowed dependency direction:
- Forbidden imports or coupling shortcuts:
- Architecture test command:
- Future regression that must fail fast:

## Source And Database Grounding

| Claim | Current Code Read | DB/Runtime Evidence | Mock-Free Test |
|-------|-------------------|---------------------|----------------|
| PC-1 | `path:line`, consumer `path:line` | psql/live test/source-grounding report | `.live.test.js` or integration command |

## DB/Query Ownership Packet

| Path / Query | Source Or Table | Operation | Owner Seam | DB/Schema Target | Scope Predicates | Affected Row / Readback | Bounded Proof | Cleanup |
|--------------|-----------------|-----------|------------|------------------|------------------|-------------------------|---------------|---------|
| `path:line` | table/view/API/source | SELECT/INSERT/UPDATE/DELETE/UPSERT/repair/projection/sync/report/verifier/live-proof | repository/service/reader/writer | local/dev/test DB + schema | tenant/owner/supplier/shop/customer/id family | expected row count, RETURNING, readback, or no-row behavior | command + expected signal | cleanup/reset |

Ownership applies to reads as well as writes. A query row without current
DB/schema target, owner seam, scope predicate, bounded proof, and cleanup blocks
`LOCKED`.

## Repo Gate Matrix

| Gate | Why It Applies | Local Command | Expected Result |
|------|----------------|---------------|-----------------|
| CI/PR body gate | required sections and proof metadata | `...` | PASS |
| no-new-mock gate | schema/query proof cannot be mock-only | `...` | PASS |
| DB ownership gate | owned-table writes stay on owned seams | `...` | PASS |
| live-proof registry | changed runtime path has live proof when required | `...` | PASS |
| headless browser/PDF gate | UI/file/PDF flow changed | `...` | PASS or N/A with reason |

## PR Review Prevention Matrix

| Class | Status | Source Evidence / N/A Reason | Contract Item | Required Proof Command |
|-------|--------|-------------------------------|---------------|------------------------|
| Branch/reason/status/SQL-path coverage | applies / not applicable with source evidence / blocking open question | `path:line` or N/A reason | PC/INV/ERR id | command + expected RED/GREEN |
| Async/deferred state machine, timeout, retry, reclaim, idempotency, partial commit | applies / not applicable with source evidence / blocking open question | ... | ... | ... |
| Request/response/config/input fields, omitted/nullish/falsy values, caller compatibility | applies / not applicable with source evidence / blocking open question | ... | ... | ... |
| SQL cast/index safety, migration immutability/checksum, concurrent index/lock posture, bounded proof query | applies / not applicable with source evidence / blocking open question | ... | ... | ... |
| Runtime-to-proof parity for verifier/replay/backtest/report/live-proof helpers | applies / not applicable with source evidence / blocking open question | ... | ... | ... |
| Proof-lane ownership, mixed-file collision, missing-resource fail-closed behavior | applies / not applicable with source evidence / blocking open question | ... | ... | ... |
| Tenant/supplier/owner boundary, affected rows, governed write ownership | applies / not applicable with source evidence / blocking open question | ... | ... | ... |
| External integration fallback, timeout/cancellation, idempotent retry, sanitized errors, duplicate side effects | applies / not applicable with source evidence / blocking open question | ... | ... | ... |
| Security/observability/log redaction, stable log shape, diagnostic quality, live-data redaction | applies / not applicable with source evidence / blocking open question | ... | ... | ... |
| Public seam/consumer, startup seam, API client, UI lock/rehydration, navigation/accessibility | applies / not applicable with source evidence / blocking open question | ... | ... | ... |
| Performance/bounded work, looped I/O, eager materialization, full-history scans, hot-path allocation | applies / not applicable with source evidence / blocking open question | ... | ... | ... |
| Artifact hygiene, current head/base, receipts/counts/timestamps, frontmatter, placeholders, stale PR text | applies / not applicable with source evidence / blocking open question | ... | ... | ... |
| Test integrity, no new DB mocks, env restoration, behavior proof over source-string proof, stable assertions | applies / not applicable with source evidence / blocking open question | ... | ... | ... |

Every `applies` row must map to a contract item and command. Every `not applicable with source evidence` row needs source-backed rationale. Every `blocking open question` row blocks contract lock until answered or the claim is narrowed.

## Async And Field Contract Matrix

- Producer:
- Field or state:
- Runtime source:
- Consumer:
- Lifecycle counterexample:
- Contract item:
- Proof command:

## Live Proof Artifact Plan

- Required artifact path:
- Command/script that creates it:
- Runtime data source:
- Cleanup/rollback plan:
- Why mock, migration, or diff evidence is insufficient:

## Local Full-Schema Proof Plan

- Status: `applies`, `not applicable with source evidence`, or `blocking open question`
- Local Postgres source: explicit dev/staging/test/local/non-production source; no production, primary, live, ambiguous RDS snapshot, or secret-bearing evidence
- Local DB target: local host/socket plus concrete database or container identity
- Restore and migration command:
- Runtime query proof command:
- Safety controls: no production writes, no printed secrets, no repo dumps
- Cleanup/reset command that drops, truncates, resets, or removes the local target:
- If not applicable: applicability predicate, source evidence, and changed paths proving `doc-only`, `no-runtime-change`, or `no-db-change`; DB-sensitive paths cannot use N/A

## Mechanical Build Packet

### Allowed Runtime Paths

- `path/to/source`

### Allowed Test Paths

- `path/to/test`

### Allowed Artifact Paths

- `docs/reviews/...`
- `.codex/enterprise-state/agent-sessions/...`

### Intent Continuity Ledger

- Rows from the contract that build must preserve:

### Touched File SRP Assessment

- `path/to/file`: classification, required action, forbidden shortcuts, proof command.

### DB/Query Ownership Packet

- `path:line or query id`: owner seam, operation, scope predicates, readback/affected-row expectation, bounded proof command, cleanup.

### Module Boundary

- `path/to/consumer` -> `path/to/public/seam`; one sentence naming which layer owns the behavior.

### Folder Placement

- `path/to/file` belongs in `[route/service/repository/component/worker/etc]` because `[existing local pattern]`.

### Public Seam

- Consumers use `[export/route/component/hook/worker/command]` from `path/to/file`; tests must exercise the public seam, not private helpers.

### Owner Layer

- `[layer]` owner: `path/to/file` owns `[one responsibility]`; sibling layers remain consumers/callees.

### Allowed Dependency Direction

- `routes -> services -> repositories/db` or the repo-specific exact direction; reverse imports are forbidden.

### Forbidden Imports

- Do not import `forbidden/module/or/layer` from `path/to/changed/file`.

### Architecture Tests

- Test path: `tests/seam-load/<seam>.module-graph.test.js`
- Command: `node tests/seam-load/<seam>.module-graph.test.js`

### Postcondition Execution Order

1. PC-1 -> RED command -> GREEN command

### Expected RED

- Command:
- Required failure signal:

### Expected GREEN

- Command:
- Required pass signal:

### Required Commands

- Focused:
- Gate:
- Live DB/headless, if applicable:
- Architecture ratchet/local full-schema, if applicable:
- PR review prevention matrix commands, if applicable:

### Forbidden Changes

- Paths:
- Helpers/writers:
- Schema/routes/flags/behaviors:

### Refusal Conditions

- Missing path, owner, test, proof command, runtime shape, DB/headless proof, or architecture choice.
- Missing original-intent row, touched-file SRP classification, or DB/query ownership packet for any touched or relied-on path.
- Any need to add an unlisted helper/writer, widen ownership, or edit outside the allowed paths.
- Any applicable PR Review Prevention Matrix row lacks a contract item and proof command.
- Any changed boundary lacks an architecture ratchet proof, or schema/query work lacks local full-schema proof or an explicit blocking/narrowing decision.

## E2E Trace And Edge Cases

| Contract Item | Changed Code Path | Source Of Truth | Final Consumer | Edge Cases | Required Proof |
|---------------|-------------------|-----------------|----------------|------------|----------------|
| PC-1 | repo -> service -> route -> UI | DB/API/input/file | component/export/log | null/empty/tenant/permission/retry | unit + live/E2E/headless |

## Blast Radius

- same-file siblings:
- cross-file siblings:
- validators and consumers:
- alternate entry points:

## Side Effects

- ...

## Non-Goals

- ...

## Traceability Matrix

| Contract Item | Test File | Test Name | Code File | Status |
|---------------|-----------|-----------|-----------|--------|
| PC-1 | ... | ... | ... | pending |
```
