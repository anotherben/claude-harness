# Plan Overlay

Add these fields to the normal implementation plan:

- `Proof Scope Target`
- `Contract Path`
- `GitHub Issue Intake` when the lane starts from a GitHub issue
- `Issue Claim Verification` when the lane starts from a GitHub issue
- `Intent Continuity Ledger`
- `Alternatives And Decision Rationale`
- `Risky Dependencies`
- `Required Review Boundary`
- `Drift Stop Rule`
- `File And Module Architecture`
- `Touched File SRP Assessment`
- `DB/Query Ownership Packet`
- `Architecture Ratchet Matrix`
- `Local Full-Schema Proof Plan`
- `Known Review Trap Matrix`
- `PR Review Prevention Matrix`
- `E2E Trace And Edge Cases`
- `Repo Gate Matrix`
- `Live Proof Artifact Plan`
- `Mechanical Build Packet`

For each task, include:

- exact files
- issue claim id covered, when issue-backed
- file responsibility, directory rationale, public seam, and SRP risk
- touched-file SRP classification: `fix-now`, `follow-up`, or `note-only`, with
  current responsibility evidence and extraction/public-seam action when needed
- DB/query ownership row for any SELECT/write/report/migration/proof query used
  by the task, including read owner, write owner when applicable, scope
  predicates, affected-row/readback expectation, bounded proof, and cleanup
- architecture ratchet covered: boundary, owner layer, allowed direction, forbidden import, and architecture proof
- postconditions or deliverables covered
- test command
- expected `RED` signal
- expected `GREEN` signal
- live DB command for schema/query work
- local full-schema Postgres restore/proof command for schema/query/data-sensitive work, or a blocking/narrowing decision
- headless browser command for UI, PDF upload, file upload, preview/download, modal, navigation, or rendered-output work
- local command that mirrors each required CI/PR gate affected by the task
- live-proof artifact path or script when runtime DB/integration behavior is claimed
- edge cases covered or explicitly scoped out
- applicable PR Review Prevention Matrix cells covered, with planned proof command or blocking question

The build phase should be able to execute from the plan without guessing.

`Mechanical Build Packet` must include:

- `Intent Continuity Ledger`
- `Allowed Runtime Paths`
- `Allowed Test Paths`
- `Allowed Artifact Paths`
- `Touched File SRP Assessment`
- `DB/Query Ownership Packet`
- `Module Boundary`
- `Folder Placement`
- `Public Seam`
- `Owner Layer`
- `Allowed Dependency Direction`
- `Forbidden Imports`
- `Architecture Tests`
- `Postcondition Execution Order`
- `Expected RED`
- `Expected GREEN`
- `Required Commands`
- `Forbidden Changes`
- `Refusal Conditions`

Build refuses instead of inventing when the packet does not name a required
path, owner, test, proof command, public seam, layer boundary, dependency
direction, forbidden import, architecture test, architecture decision,
touched-file SRP/refactor action, or DB/query ownership row.

`Intent Continuity Ledger` must keep vague or product-shaped requests from
evaporating into generic tasks. Include one row per load-bearing outcome:

- Original user words or `/goal` claim.
- Business outcome and operator acceptance.
- Explicit non-goals or boundaries.
- Source evidence supporting the outcome.
- Planned proof command and expected signal.
- Downstream artifact owner: plan, contract, build, review, forge, verify, or harness.

If a row cannot name acceptance and proof, the plan is not ready for contract.

`Touched File SRP Assessment` is required for every planned file touch:

- Path and current source evidence.
- Current responsibilities and owner layer.
- One reason this work needs to change the file.
- Mixed-responsibility risk and duplicate-helper/writer risk.
- Classification: `fix-now`, `follow-up`, or `note-only`.
- If `fix-now`: smallest extraction, public seam preservation, forbidden imports,
  and proof command.
- If not `fix-now` despite mixed responsibility: blocking reason, narrowed claim,
  and contract non-goal.

Touched files that already do multiple jobs are not allowed to remain vague.
If this work touches one of the mixed responsibilities, `fix-now` is mandatory
unless the plan stops or narrows the claim.

`DB/Query Ownership Packet` is required for every query/read/write/report/
migration/proof path:

- Table, view, API, external source, or materialized source.
- Operation type: SELECT, INSERT, UPDATE, DELETE, UPSERT, repair, projection,
  sync, reconciliation, migration, report, verifier, or live-proof query.
- Approved reader/writer owner seam and source evidence.
- Current DB/schema/tenant/environment target.
- Tenant, owner, supplier, shop, customer, or identifier-family predicates.
- Parameter typing, cast/index safety, and bounded query plan when relevant.
- Affected-row, `RETURNING`, readback, or no-row expectation.
- Bounded proof command, cleanup/rollback, and secret/redaction control.
- Structured blocker when ownership or live proof is unavailable.

Ownership applies to reads as well as writes. A SELECT that bypasses the owning
repository/service seam can break tenant, freshness, or semantics just as easily
as a write; it must be planned or blocked.

Repo-specific gate commands must come from the committed repo profile or another
repo-local config. Do not put one repository's fixed command list into a generic
template, generator, or reusable skill body.

If the repo gate matrix is incomplete, the plan is not ready. Unknown PR body
requirements, no-new-mock gates, DB ownership gates, live-proof registry checks,
or browser/PDF commands are planning failures, not acceptable CI discoveries.

`GitHub Issue Intake` is required when a plan starts from an issue number or URL:

- Issue number, URL, title, state, labels, assignees, created/updated timestamps.
- Live fetch command and timestamp.
- Risk flags and recommended enterprise route.
- Source-read targets extracted from the issue body.
- Statement that the issue body is intake, not proof.

`Issue Claim Verification` must include one row per load-bearing issue claim:

- Claim text or id.
- Status: `confirmed`, `contradicted`, `unverified`, or `not relevant`.
- Current source evidence: file/line, symbol, command, DB proof, or blocker.
- Plan action: postcondition, invariant, non-goal, discovery task, or stop rule.
- For suggested fixes: chosen/rejected alternative with source evidence.

Plans cannot hand off to contract while a load-bearing issue claim is
`unverified` unless the plan records a blocking question or narrows the claim.

`Architecture Ratchet Matrix` must front-load structure quality. Include one item per boundary or extraction:

- Boundary preserved or introduced, with current source evidence.
- Target shape: thin vertical slice, deep module behind public seam, or explicit no-change.
- Public seam consumers will use.
- Owner layer and single responsibility.
- Allowed dependency direction.
- Forbidden imports, helper shortcuts, and state leaks.
- Architecture test command: module-graph, startup seam, seam-load, consumer smoke, or equivalent.
- Future regression that must fail fast.

If a new deep module, helper, shared service, or extraction lacks a public seam and architecture test, the plan is not ready for contract. If tasks are horizontal layer batches, rewrite them into thin vertical tracer bullets or justify the foundation task with independent proof.

`Local Full-Schema Proof Plan` is required for schema/query/data-sensitive plans:

- Status: `applies`, `not applicable with source evidence`, or `blocking open question`.
- Local Postgres source: explicit dev/staging/test/local/non-production source; production, primary, live, ambiguous RDS snapshot, or secret-bearing evidence is a blocker.
- Local DB target: local host/socket plus concrete database or container identity.
- Restore and migration command.
- Proof command that exercises the real runtime query path against the restored schema.
- Safety controls: no production writes, no printed secrets, no repo dumps, no machine-local proof dependency.
- Cleanup/reset command that drops, truncates, resets, or removes the local target.
- If not applicable: applicability predicate, source evidence, and changed paths proving `doc-only`, `no-runtime-change`, or `no-db-change`.

If local full-schema proof is unavailable for schema/query/data-sensitive paths, the plan must stop as a blocking question or explicitly narrow the claim away from schema/query behavior. N/A cannot self-waive DB-sensitive work.

`PR Review Prevention Matrix` must front-load the classes reviewers repeatedly catch after PR submission. Include these rows for every non-trivial or PR-producing plan, marking each `applies`, `not applicable with source evidence`, or `blocking open question`:

- Branch/reason/status/SQL-path coverage.
- Async/deferred/worker state machine, timeout, retry, reclaim, idempotency, and partial-commit behavior.
- Request/response/config/input field contract, including omitted/nullish/falsy values and caller compatibility.
- SQL cast/index safety, migration immutability/checksum, concurrent-index/lock posture, and bounded proof queries.
- Runtime-to-proof parity for verifier, replay, backtest, report, live-proof, and production helper logic.
- Proof-lane ownership and mixed-file lane collision behavior.
- Tenant/supplier/owner boundary and affected-row invariants.
- External integration fault matrix: fallback, timeout/cancellation, idempotent retries, sanitized errors, duplicate side effects.
- Security/observability/logging: secret redaction corpus, log field shape, diagnostic quality, and live-data redaction.
- Public seam/downstream consumer: exports, startup seams, API clients, UI lock/rehydration, nested-route selection, accessibility keyboard paths.
- Performance/bounded-work: looped I/O, eager materialization, full-history scans, hot-path allocation, and proof runtime budget.
- Artifact hygiene: portable commands, current head/base, consistent receipts/counts/timestamps, required frontmatter, no placeholders, no stale PR-state text.
- Test integrity: no new schema-coupled DB mocks, restored env, behavior proof over source-string proof, stable assertions over brittle counts.

If any `applies` row lacks a planned proof command and expected failure/pass signal, the plan is not ready for contract.
