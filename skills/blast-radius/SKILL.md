---
name: blast-radius
description: "Project-grounded blast-radius tracing for code changes, PRs, diffs, files, symbols, or bugfixes, especially in Helpdesk-style repos. Use before editing, committing, merging, or reviewing when downstream callers, tests, routes, SQL, configs, schema, auth/tenant boundaries, external integrations, sibling bugs, or review-derived trap replays could be affected."
---

# Blast Radius

A change is a stone dropped in a pond. The skill traces every ripple — and stops the next whack-a-mole bug before it lands in production.

## Scope and Strength

Combines a generic blast-radius workflow with Helpdesk-specific production bug patterns. Use the
generic workflow in any repo; apply Helpdesk-specific rules when the repo matches (real-DB-only
tests, tenant isolation, route mounting rules, schema authority files, patterns in
`references/bug-patterns.md`). Don't soften a finding because a rule feels project-specific — mark non-applicable checks `NOT APPLICABLE` with evidence instead.

## The Rule

**You cannot ship a change you have not traced.** If you can't list what it touches, list each
touchpoint's assumption, and prove it still holds — otherwise you're guessing, not shipping safely.

This skill produces mode-aware artifacts so the user can both *read* the analysis and *act* on it:
1. **Report** — full structured Markdown, saved to `docs/blast-radius/<change-name>.md` (or
   `$CLAUDE_JOB_DIR` if no docs dir convention applies)
2. **Risk-ranked checklist** — CRITICAL/HIGH/MEDIUM/LOW touchpoints with file:line, why each could
   break, and the verification step
3. **Inline diff annotations** — for diff-bearing modes, per-hunk downstream effects

| Mode | Report | Checklist | Inline annotations |
|---|---|---|---|
| **Plan** | YES | YES | NO unless a diff exists |
| **Pre-commit** | YES | YES | YES |
| **Review** | YES | YES | YES |
| **Post-fix** | YES | YES | NO unless reviewing the fix diff |
| **Lite speed** | Compact report is allowed inline | YES | YES only if a diff exists |

If an artifact is not applicable, say why in `## Trace Boundaries`. Do not skip the verdict,
finding counts, verification plan, or any mandatory check.

**Artifact write safety**: check active route/worktree rules before creating files — write only where
editing is allowed. If blocked, emit the report/checklist inline or to `$CLAUDE_JOB_DIR`, state that
repo writes were skipped, and never let a blocked write become a weaker analysis.

## Speed modes — pick by diff size

The full trace can take 10+ minutes; don't apply that to a one-line change. Auto-select the speed
mode from the change set size:

| Mode | When to pick | What changes |
|---|---|---|
| **Lite** | ≤ 5 files changed, no migration, no auth/middleware change, no rename | Run mandatory core patterns 1, 2, 3, 13 plus any conditional mandatory patterns that apply. Direct callers (1 hop). Compact report/checklist. Target: 2–3 min. |
| **Standard** | 6–20 files, OR any DB change, OR any new route | Full Step 1–7 below. 2-hop fan-out with smart stops. All applicable patterns. All applicable output artifacts. Target: 5–10 min. |
| **Deep** | >20 files, OR auth/tenant/middleware change, OR cross-system integration change, OR explicit `--deep` from user | Full sweep + cross-repo trace (admin, partners) + all mandatory patterns from `bug-patterns.md`. Target: 10–20 min. |

When the user explicitly names a mode ("lite blast-radius on this", "deep trace") use that. Otherwise
classify by counting files: `git diff --stat <base>...HEAD | tail -1`. State the chosen mode at the
top of the report.

## When this skill runs

Four entry modes — detect from context, don't ask if it's obvious: **Plan** ("I want to change X",
a written plan, a proposed migration), **Pre-commit** (uncommitted diff in the working tree),
**Review** (branch/PR/file/caller targeted for review), **Post-fix** (just landed a bugfix — the
fix commit + original bug description). Post-fix is the odd one out: it ALSO runs a **sibling-bug
hunt** for other code with the same shape as the bug just fixed.

## Step 1 — Identify the change set

Don't trace what you haven't named. Make the change set explicit before fanning out. The skill
accepts several input forms — match the user's input to the right one and proceed:

| Input form | How the user phrases it | What to do |
|---|---|---|
| **PR number** | "blast radius on PR 856", "trace #1234" | `gh pr diff <num>` for the diff; `gh pr view <num> --json title,body,headRefName,baseRefName` for context |
| **Diff (uncommitted)** | "what's the blast radius of my current changes", "check my diff" | `git diff` (working tree) and `git diff --staged` |
| **Branch / commit range** | "trace this branch", "review changes since main" | `git diff <base>...HEAD`, then `git log --oneline <base>..HEAD` |
| **Specific file** | "trace apps/api/src/services/foo.js", "what depends on this file" | Treat the whole file as the change set; `cortex_outline` the file, then trace each exported symbol |
| **Specific symbol / caller** | "blast radius of `orderRouteService.getRoute`", "what calls this function" | Start from the symbol — `cortex_find_references` and trace each call site |
| **Written plan / description** | "I want to add a `deleted_at` column to products" | Extract proposed changes from prose; if vague, STOP and ask for concrete changes |
| **Post-fix sweep** | "I just fixed X, find similar bugs" | The fix commit + the original bug description; pattern-hunt for siblings (see Step 5) |

For PR mode specifically:

```bash
gh pr diff <num>                                          # the full diff
gh pr view <num> --json title,body,headRefName,baseRefName,files  # metadata + file list
gh pr view <num> --json reviewDecision,statusCheckRollup  # current review state (useful context)
```

Capture the live PR review-thread state at the start of the trace and again before the final verdict.
GitHub GraphQL `reviewThreads.nodes[].isResolved` is the source of truth (REST comments can look open
after a thread resolves); query recipe in `references/trace-recipes.md`. If `headRefOid` changes
mid-trace, rerun against the new head — never carry forward a verdict from an older SHA.

Build a **review feedback trap bank** before the trace: search current PR threads, prior
blast-radius/prove-it artifacts for the touched domain, and resolved Cursor/Copilot/human comments.
Extract the invariant class behind each valid finding, not just the literal comment, and replay it in
Step 5.5 with proof or mark `NOT APPLICABLE` with source evidence. If a valid PR conversation surfaces
after the PR was already claimed locally proven and a focused local test/canary/schema/import-cycle
check should reasonably have caught it, classify it `Local Proof Miss`: fix the line, add the missing
local regression, and update the responsible skill/runbook with the new trap class. If a gate blocks
updating the runbook, record the blocker and keep the verdict blocked unless Ben explicitly accepts it.

For symbol/caller mode, the change set is the call graph, not a diff: start at the symbol, fan out to
all references/importers/tests/routes, and run live-DB verification if it touches DB. For file mode,
treat every exported symbol as a change-set item plus internal DB queries.

Write the resolved change set to the report's `## Change Set` section: the input form given and the
resolved items fanned out from it.

## Step 2 — Classify the change type (adaptive depth)

The trace depth and pattern depend on what kind of change it is. Don't trace a util function the same
way you trace a schema migration. Read **`references/change-types.md`** for the full taxonomy, but the
core categories are:

| Change type | Trace focus |
|---|---|
| Database schema | All reads/writes of affected columns. Always verify live schema against code assumptions. |
| API route | All clients (path, method, request/response shape, status codes). |
| Service method signature | All direct callers + mocks + re-exports. |
| Validation / business logic | SIBLING code paths doing similar validation — the whack-a-mole killer. |
| DB-backed guard / idempotency / dup prevention | Falsification matrix: identity sources, active vs cancelled rows, all writers, concurrent attempts. |
| Async / queue / worker / scheduled job | Atomic claim, dup scheduler/worker behavior, stale-running recovery, retry policy, post-commit bookkeeping, idempotent side effects. |
| Cross-layer DTO / projection / print / notification | Field-level matrix producer → route/service/DB/worker/read-model/UI; aliases must match runtime source. |
| Order / invoice / inventory / pricing / label-printing | Field mismatches, retries, unavailable downstream, UI rehydration — data-integrity risk, not UX polish. |
| Sync route converted to async/queued | Every validation/confirmation/recoverable error from the old sync path still happens before enqueue, or the product deliberately accepts background failure. |
| Irreversible side effect + bookkeeping | Identify the commit point; failures after it must not mark the op uncommitted/failed/retryable. |
| Helper return variants / truthy handling | Enumerate every return variant; dedupe/locks/notifications/retry-suppression gated on real success only. |
| SQL type/range cast / parser boundary | Casts can't throw or de-index the hot path; guard malformed/out-of-range/empty/wrong-type before casting. |
| Mode flag / reason-set / conditional branch | New flag/branch/reason needs on/off + sibling-reason coverage, idempotent repeat, parameter ordering. |
| Proof lane / live-proof registry | Selected lane can't be stolen by generic matches; fails non-zero when asserted resource is absent. |
| Evidence / PR-readiness artifact | Current-head, portable, internally consistent — no stale "pending"/"create PR" leftovers or machine-local paths. |
| Audit/log/redaction shape | Stable explicit values (not literal `undefined`); secrets redacted in structured and serialized forms. |
| Parser / numeric extraction | Reject partial matches, punctuation-only, multi-decimal, `NaN`, infinite values before returning. |
| Config / env var / feature flag | All readers + deployment configs + docs. |
| Auth / permission / multi-tenancy | ALL routes sharing the boundary. |
| Type / interface | All usages + JSON schemas + external consumers. |
| Refactor (rename / move) | Static imports AND dynamic require/import-string usages. |
| Test | What it covers + similar tests that should have caught this. |

A change can be multiple types. Run each applicable trace. Full taxonomy: `references/change-types.md`.

**Depth heuristic** — 2 hops with smart stops:
- Stop at module public boundaries (an exported interface that's stable)
- Stop at unrelated domain boundaries (don't follow `fs.readFile` into the Node stdlib)
- Always continue across cross-cutting concerns (auth, tenant, transactions, queues) even if "2 hops"
- For database changes, always trace until you hit every SQL string referencing the affected column

## Step 3 — Fan out the trace

**Pattern-library first**: for each item in the change set, walk **`references/bug-patterns.md`**
and run the recipes for the patterns that apply. The applicability heuristic (at the bottom of
that file) tells you which patterns to scan based on the change type. This is faster and more
accurate than deriving recipes from scratch — these are the specific bug shapes this codebase
actually has.

Core patterns are MANDATORY for every change regardless of type. If a pattern truly does not apply,
record it as `NOT APPLICABLE` with evidence rather than silently skipping it:

- **Pattern 1 (tenant-scope leak)** — for every function in the radius that touches the DB
  directly or transitively, confirm tenant scoping. Don't restrict Pattern 1 to "tenant-related
  changes" — tenant leaks happen most often in functions nobody thought were tenant-related.
- **Pattern 2 (mock policy)** — every test in the radius using `jest.mock(...config/database)`,
  `jest.mock('pg')`, or an in-memory DB fake is HIGH risk regardless of whether the mocked
  symbols exist. Per CLAUDE.md the project's standing rule is real-DB-only.
- **Pattern 3 (schema drift)** — for every DB-touching file, SQL string, migration/schema edit, or test
  asserting DB shape in the radius, compare referenced columns against live DB or mark live verification
  blocked. Do not trust code, migrations, or types as runtime truth.
- **Pattern 13 (deleted secret files)** — every diff or PR must be scanned for deletions of
  `.env`, `credentials.*`, `*.pem`, secret JSON files. Even when removed from the working tree
  they remain in git history and every credential they contained must be rotated. This is
  CRITICAL, not LOW — leaked secrets are an immediate incident.

For DB-backed validation, identity matching, idempotency, duplicate guards, soft-delete filters,
changed `WHERE` predicates, async/worker changes, cross-layer DTO/projection changes, or
order/invoice/inventory/pricing/label-printing changes, the PR-adversarial patterns are also mandatory:

| # | Pattern | Required proof |
|---|---|---|
| 15 | Identity fallback mismatch | Test old-row/new-row combos where one side has the ID and the other only an alias/name (e.g. `supplier_rex_id` vs historical `supplier_name`). |
| 16 | Predicate/index drift | Compare every changed SQL predicate against live indexes; wrapping an indexed column in a new function can turn a lookup into a scan. |
| 17 | Schema authority disagreement | Live DB is runtime truth; migrations/schema files/docs are contract truth. Record drift — a live-DB pass doesn't erase a broken committed contract. |
| 18 | Open PR review threads | Unresolved GitHub review threads are findings; ingest reviewer counterexamples or report them unresolved. |
| 19 | Async claim/retry integrity | Prove atomic job claim, dup scheduler behavior, stale-running recovery, retry limits, post-commit bookkeeping. Missing proof on a state-mutating async path is HIGH. |
| 20 | Field-level runtime contract | Map runtime field names/aliases producer→consumer across every layer. Run a field-spelling collision scan (`quantityReceived` vs `receivedQuantity`, snake_case vs camelCase). Mock-only proof of a changed producer is HIGH. |
| 21 | Operator retry/reopen path | UI close/reopen/refresh rehydration plus unavailable/cancelled/retry. Frontend-only state is HIGH when backend is the lock source. |
| 22 | Sync-confirmation preservation before async enqueue | Old confirmation/error outcomes from the skipped sync path must still return before `202 Accepted`. |
| 23 | Commit-boundary bookkeeping split | Bookkeeping/projection/notification failures after the first committed write must not mark the whole op failed/uncommitted/retryable. |
| 24 | Return-variant success semantics | Enumerate success/unavailable/skipped/cancelled/error variants; dedupe/locks/retry-suppression gated on the success discriminant only. |
| 25 | Conditional branch/reason-set coverage | Every new flag/branch/reason needs positive+negative proof and sibling-reason coverage; SQL branch tests prove placeholder ordering and idempotent repeat. |
| 26 | Type/range cast safety | SQL/parser casts on JSON/text/external data must not throw on empty/malformed/out-of-range; casts on indexed columns must stay indexable. |
| 27 | Proof-lane integrity | Live-proof registries/selectors must pick the domain-specific lane for mixed diffs and fail non-zero on a missing asserted resource — exit-0-on-empty is false proof. |
| 28 | Artifact truth and portability | Verification/review/PR-readiness artifacts must be current-head and portable — no machine-local paths, stale "pending"/"create PR" leftovers, or wrong-head evidence. |
| 29 | Runtime-to-proof parity | Verifier/replay/backtest/live-proof code must use the same helpers or equivalent predicates as production. |
| 30 | Integration fault and idempotency matrix | External clients need fallback criteria, timeout/cancellation, idempotent retry boundaries, sanitized errors, dup-side-effect prevention. |
| 31 | Boundary/identifier/omitted-field invariants | Tenant, supplier, owner, id-shape, default-change, and omitted-field/upsert behavior locked from source + tests. |
| 32 | Observability and redaction contract | Log/error changes redact adversarial message/stack/non-object/cookie/token/header/live-identifier values while keeping diagnostic shape. |
| 33 | Public seam, UI, accessibility contract | Export/startup seams, API client keys, UI lock rehydration, nested-route specificity, custom listbox keyboard/focus behavior proven. |
| 34 | Test-integrity false confidence | Schema-coupled DB mocks, source-string-only assertions, leaked test env, brittle counts, non-isolated tests are findings in the radius. |

After the pattern sweep, use the recipes in **`references/trace-recipes.md`** for the general
fan-out (cortex_find_references, importers, route registry, etc.). Then produce the Pattern-Library
Sweep table in the report (one row per pattern with hit/miss verdict + evidence).
The recipes give the exact `cortex_find_references`, `grep`, `psql`, and `git log` invocations per
change type. Key principles:

- **Cortex-first**: `cortex_find_references`/`cortex_find_importers` before `grep` (symbol-scope-aware,
  fewer false positives); `cortex_find_text` for string-level matches (SQL columns, env vars, config keys).
- **grep for strings**: column names, route paths, flag keys, dynamic-require strings — symbol tools miss these.
- **git log for history**: `git log -p -S "<symbol>"` surfaces assumptions baked into the original change.
- **Route registry sweep**: for auth/tenant changes, walk `apps/api/src/routes/` grouped by middleware chain.

For every touchpoint: file:line, the assumption it makes about the changed thing (e.g. "expects
`result.customer_id` to be non-null"), whether that assumption still holds, and whether a test would
have caught a violation.

## Step 4 — Verify against the live database (REQUIRED)

This step is non-negotiable for any change that touches data. The dev DB is the source of truth, not
the migration files, not the model, not the type. Mocks lie; live schema doesn't.

If `psql` is blocked, use the graceful-degradation recipe in `references/trace-recipes.md`. Do not
silently fall back to migration files. The verdict is **NEEDS REVIEW (live verification blocked)** at
minimum — never **SAFE TO PROCEED** without live schema confirmation.

For every DB-touching call in the blast radius:

1. Pull live schema for affected tables: columns, types, nullability, defaults, constraints, indexes.
2. Diff live schema against code assumptions, including cross-table type traps and join behavior.
3. Reconcile schema authorities: live DB, committed migrations, canonical bootstrap/schema files,
   code assumptions, tests, and docs. Drift is at least MEDIUM; HIGH if it can cause data loss,
   duplicate writes, runtime crashes, or reviewer-visible ambiguity.
4. Run a realistic live sample query, not just a count.
5. Check every changed predicate, lookup, join, `ON CONFLICT`, and uniqueness guard against live
   indexes/constraints.
6. Reject mocked DB tests in the radius as HIGH risk.

Write findings to the report's `## Live Schema Verification` section. Include the actual `\d` output
or column listing, code assumption, PASS/FAIL, and the exact commands from `references/trace-recipes.md`.

## Step 5 — Sibling-bug hunt (ALWAYS for validation/business-logic changes; MANDATORY post-fix)

This is the whack-a-mole killer. **Run it always when**:
- The change is in post-fix mode (you just fixed a bug)
- The change touches **validation logic** (a `WHERE` clause, status check, permission check, type
  cast, mapping table, parameter validation, schema validation)
- The change touches **business logic** (a calculation, a state transition, an enum mapping)
- The change adds or modifies a **null/undefined guard** (the same shape may exist elsewhere)
- The change involves a **rename** of a literal value (status, role, enum, config key) — see
  pattern 8 in `bug-patterns.md`

For other kinds of changes, the sweep is opportunistic — run it when the pattern is repeatable.

Sibling sweeping IS NOT optional for the change classes above. The most common production
regression in this codebase is "fixed validation in one place, missed the bulk variant / worker /
sync job." If you find the change shape, you MUST search for siblings.

1. Characterize the bug as a *pattern*, not an instance. Example:
   - Instance: "ProductEditService.updateProduct didn't include tenant_id"
   - Pattern: "UPDATE/DELETE on tenant-partitioned tables without `WHERE tenant_id = $1`"

2. Search for the pattern. Examples:
   - Tenant leak → `grep -rn "UPDATE products" apps/api/src/` then check each for `WHERE.*tenant_id`
   - Missing await → `grep -rn "asyncFn(" apps/api/src/` then check return value usage
   - Bad type cast → `grep -rn "::int" apps/api/src/` near join columns

3. Each match: read the surrounding code. Same bug? Different bug? Safe by construction (e.g. a route
   that already filters tenants upstream)? Capture all three categories in the report.

## Step 5.5 — Adversarial PR review sweep

This step exists because a trace can be locally true and still miss the counterexample a reviewer will
find five minutes later. Run it whenever the input is a PR, a rerun after previous findings, or a change
touches validation/business logic, identity matching, duplicate/idempotency guards, soft-delete filters,
or DB-backed write prevention.

Review-derived traps are first-class inputs. Replay valid current or prior Cursor/Copilot/human findings
that match the touched invariant class before inventing new edge cases. A review comment that was "fixed
once" is not closed for a new change until the current diff proves the same class cannot recur.

1. **Build a falsification matrix**. Turn the fix into a grid of ways it can be wrong — one row per
   applicable Pattern 15–34 above (identity axis for 15, field-spelling for 20, return-variant for 24,
   etc.), plus these axes a numbered pattern doesn't already cover. Include only axes that apply, but
   do not skip one just because the happy path passed:
   - lifecycle/concurrency: active vs cancelled/soft-deleted/historical row; one row vs many, newest vs
     oldest; concurrent attempts (lock winner vs waiter); queued vs running vs stale vs succeeded vs
     failed vs retryable state
   - old behavior preserved vs intentionally changed
   - review-derived traps not yet promoted to a numbered pattern: action-timestamp source, UUID vs
     integer identity, undefined/JSON hashing, decline/dedupe semantics, local vs external ID aliases

2. **Write the matrix into the report**. Each cell must be `PROVED`, `FAILED`, `NOT APPLICABLE`, or
   `UNTESTED`. Any `FAILED` cell is a finding. Any important `UNTESTED` cell caps the verdict at
   NEEDS REVIEW; if it is on a write path, async side effect, identity boundary, tenant/auth boundary,
   operator confirmation path, or data-integrity guard, cap at DO NOT MERGE.

3. **Simulate review comments before reviewers do**. Ask: "What would Copilot or a strict reviewer object
   to in this diff?" Explicitly scan for false positives, false negatives, performance regression,
   missing DB backstop, stale schema contracts, unsafe casts, proof-lane collisions, non-failing
   proof commands, stale/non-portable evidence artifacts, and tests that prove only the happy-path shape.

4. **Close previous findings mechanically on reruns**. If this is a rerun after an earlier blast-radius
   report, create a `## Finding Closure Ledger`:
   - previous finding ID / severity
   - exact fix
   - exact proof command/query
   - residual risk
   - reviewer-style counterexample tried

   Do not write "now covered" unless the counterexample that created the finding has a direct proof.

5. **Ingest live review threads**. In PR mode, query GitHub review threads at the end and summarize every
   unresolved thread by file:line, author, and risk theme. If an unresolved thread names a plausible bug,
   include it as a finding even if your local trace did not discover it independently.

## Step 6 — Risk-rank and write the outputs

Score each touchpoint:
- **CRITICAL** — deleted secret files, credential exposure in git history, confirmed live secret leak,
  or any finding that requires immediate incident handling.
- **HIGH** — production data loss, tenant leak, auth bypass, cross-system sync break, mocked test
  hiding the issue, schema drift between code and live DB, unresolved PR thread naming a plausible data
  integrity bug, or important falsification-matrix failure
- **MEDIUM** — caller compiles but behavior differs (silently wrong totals, missing field in response,
  default param drift), missing test coverage, sibling code with the same bug, predicate/index drift, or
  schema-authority disagreement that is not immediately production-breaking
- **LOW** — internal helper that needs updating, comment/docs stale, low-traffic path

Assign every finding a stable ID before writing the verdict:
- `BR-CRIT-001`, `BR-HIGH-001`, `BR-MED-001`, `BR-LOW-001`
- Reuse the same ID on reruns when the finding is the same underlying risk.
- Include the ID in the report tables, checklist, inline annotations, and closure ledger.
- Do not mark an ID closed without direct proof and a reviewer-style counterexample.

Then produce:
1. **Report** — see template in `references/output-templates.md`. Saves to `docs/blast-radius/`.
2. **Checklist** — risk-ordered, one line per touchpoint, with the verification command/test to run.
3. **Inline annotations** — for review mode, emit a `blast-radius-inline.md` keyed to diff hunks the
   user can paste into the PR or read alongside the diff.
4. **Diagnostic Gate Summary** — a normalized block inside the report with the
   gate verdict, consensus status, diagnose status recommendation, blocking
   finding IDs, disagreement ledger, and exact next handoff. This does not make
   blast-radius a fixer; it makes its findings consumable by `$diagnose`,
   `$diagnostic-cohort`, and `/goal` handoffs.

For PR mode or reruns, the report must also include:
- `## PR Review State` — head SHA, check status summary, unresolved-thread count, and the final
  GraphQL query timestamp
- `## Adversarial Matrix` — the falsification matrix from Step 5.5
- `## Review Feedback Trap Replay` — valid current/prior review findings, invariant class, applicability,
  local regression/proof, and residual risk
- `## Finding Closure Ledger` — required when any previous report or review thread had HIGH/MEDIUM
  findings

### Verdict guardrail (CRITICAL — read this every run)

Verdict is driven by **findings**, not by patterns checked. The most common failure mode: "all
mandatory patterns 1/2/13 PASSED → SAFE TO PROCEED" while a real HIGH finding sits elsewhere in the
report. That false-confidence failure has shipped real bugs. Passing every named pattern does not
mean the change is safe — the pattern library is finite; real bugs exist outside it (migration
bootstrap regressions, build script edits, infra config changes).

Derive the verdict mechanically. Prefer `scripts/derive_verdict.py` when available:

```bash
scripts/derive_verdict.py \
  --critical <n> --high <n> --medium <n> \
  --live-schema <verified|blocked|not_applicable> \
  --unresolved-threads <n> \
  --prior-unclosed <none|medium|high|critical> \
  --untested-important <none|review|do_not_merge> \
  --mandatory-patterns <passed|failed>
```

If unavailable, apply the same precedence by hand and say the script wasn't run.

**Hard rules** (worst case wins, not the average, not the "feel"):

| Condition | Verdict floor |
|---|---|
| Any finding HIGH or CRITICAL | **DO NOT MERGE** |
| Any finding MEDIUM (no HIGH) | **NEEDS REVIEW** |
| Live schema verification BLOCKED | **NEEDS REVIEW** — you can't certify what you didn't verify |
| PR mode: any unresolved review thread | **DO NOT MERGE / REVIEW THREADS OPEN** |
| Prior HIGH/MEDIUM finding not closed in the Closure Ledger with direct proof + counterexample | capped at that prior severity |
| Review-derived trap applies but has no local regression/live proof/`NOT APPLICABLE` evidence | **NEEDS REVIEW**; **DO NOT MERGE** if it covers writes, async, identity, money, inventory, or user-visible state |
| Adversarial-matrix cell `UNTESTED` | **NEEDS REVIEW**; **DO NOT MERGE** if it's a write path, async side effect, identity/tenant/auth boundary, or data-integrity guard |
| Proof `PARTIALLY PROVED`, mock-only, stale, wrong-head, or missing a required lifecycle leg | **DO NOT MERGE** |

**SAFE TO PROCEED** only when: every finding is LOW, every mandatory pattern PASSED, live schema
verification succeeded, PR threads are resolved, and the adversarial matrix has no important
UNTESTED/FAILED cells. No exceptions — if the most severe finding is HIGH, do not round up because
"the patterns all passed."

## Step 7 — Recommend the verification plan

Don't just list risks. List the *commands the user should run* to prove the change is safe:
- The specific Jest tests to run (or to add)
- The specific E2E paths to exercise
- The specific psql queries to run against dev to confirm schema/data
- The specific sibling files to grep before merging
- The falsification-matrix cells that still need proof
- The final GitHub GraphQL review-thread query for PR mode

This is the part the user does after reading the report. Make it copy-pasteable.

## Stopping rules

This skill can run forever if you don't draw a line. Stop tracing when:
- You hit a stable public interface (e.g. Express router boundary, exported package API)
- You've gone 2 hops and the next hop is in an unrelated domain
- You're trawling the same file you've already analyzed (no new info)
- You've covered every SQL string for the affected columns (DB changes are exhaustive, not depth-limited)
- The user explicitly says "narrow to X"

For PR mode, do not stop before the final review-thread query. For DB-backed validation/identity/duplicate
guards, do not stop before the adversarial matrix is written and each important cell is classified.

When you stop, say *why* in the report's `## Trace Boundaries` section. Honesty about what wasn't
traced is more valuable than a false claim of completeness.

## What this skill is NOT

- Not a fixer. Surfacing what could break is the deliverable. Fixing is the user's call.
- Not the `session-heartbeat` pre-commit scope-drift check. That checks whether the diff matches the
  task. Blast-radius checks downstream effects.
- Not `diagnose`'s post-fix verification mode. That checks whether a fix is root-cause. Blast-radius
  checks whether the fix is complete (no sibling bugs, no missed callers).
- Not a replacement for tests. A green blast-radius report does not mean the code is correct — it means
  you've enumerated the surface area and verified the assumptions you knew to check.

## Output paths

- Report: `docs/blast-radius/<YYYY-MM-DD>-<change-slug>.md`
- Checklist: `docs/blast-radius/<YYYY-MM-DD>-<change-slug>-checklist.md`, and repeated in the
  report's `## Checklist` section
- Inline annotations: `docs/blast-radius/<YYYY-MM-DD>-<change-slug>-inline.md`

`docs/blast-radius/` entries are LIVE CI inputs (PR gates reference them, per GATES.md) — entries must
be real, current-head findings, not boilerplate. If it doesn't exist, create it. If the project has a
different convention (e.g. `evidence/`), use that instead. If route/worktree rules block artifact
writes, emit the outputs inline or use `$CLAUDE_JOB_DIR` if allowed, and record the limitation in
`## Trace Boundaries`.
