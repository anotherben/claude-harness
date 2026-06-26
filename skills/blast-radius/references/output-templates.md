# Output Templates

The skill produces mode-aware artifacts. Use these templates verbatim when the artifact applies — the
structure is what makes the output skimmable for a reviewer and copy-pasteable into a PR description.
If route/worktree rules block repo writes, emit the same structure inline or write it only to an
approved scratch path such as `$CLAUDE_JOB_DIR`.

## Table of Contents

1. [Report template (full)](#1-report-template-full)
2. [Checklist template (risk-ranked)](#2-checklist-template-risk-ranked)
3. [Inline annotations template](#3-inline-annotations-template)
4. [How to assemble in different modes](#4-how-to-assemble-in-different-modes)

---

## 1. Report template (full)

Save to, when writes are allowed: `docs/blast-radius/<YYYY-MM-DD>-<change-slug>.md`

```markdown
# Blast Radius: <change name>

**Mode**: <Plan | Pre-commit | Review | Post-fix>
**Speed mode**: <Lite | Standard | Deep>
**Input form**: <PR #N | file <path> | symbol <name> | diff | description>
**Generated**: <YYYY-MM-DD HH:MM>
**Skill version**: blast-radius v1
**Artifact write status**: <written to docs/blast-radius | written to $CLAUDE_JOB_DIR | inline only because route/worktree blocked repo writes>

## Summary

<2-4 sentences. What's changing, how many touchpoints, top risks.>

**Touchpoint count**: <N> (CRITICAL: <n>, HIGH: <n>, MEDIUM: <n>, LOW: <n>)
**Verdict**: <SAFE TO PROCEED | NEEDS REVIEW | DO NOT MERGE | DO NOT MERGE / REVIEW THREADS OPEN>
**Rationale**: <one sentence on why the verdict>

## PR Review State

(PR mode only. Omit for pure local diff/file/symbol traces.)

- PR: `<number or URL>`
- Head SHA traced: `<sha>`
- Final head SHA: `<sha>`
- Checks summary: `<passing/failing/pending>`
- Unresolved review threads: `<count>`
- Final GraphQL review-thread query: `<timestamp and command/ref>`

If unresolved threads exist, list each one:

| file:line | author | risk theme | URL |
|---|---|---|---|
| `apps/api/src/services/foo.js:42` | `copilot-pull-request-reviewer` | identity fallback mismatch | `<url>` |

## Change Set

The exact things this trace fans out from.

### Files
- `apps/api/src/services/foo.js` (modified)
- `apps/api/database/migrations/0042_add_deleted_at.sql` (new)

### Symbols
- `FooService.updateOrder` (signature changed: added `tenantId` parameter)
- `FooService.deleteOrder` (new export)

### Database
- `orders.deleted_at` (column added, type `TIMESTAMPTZ`, nullable, no default)
- `orders` (added partial index on `deleted_at IS NULL`)

### Routes
- `POST /api/orders/:id/delete` (new)

### Config / env
- None

## Change Type Classification

- [x] Database schema (orders.deleted_at)
- [x] Service method signature (FooService.updateOrder)
- [x] New API route
- [ ] Validation / business logic
- [ ] Auth / multi-tenancy
- [ ] Refactor
- [ ] External integration

## Pattern-Library Sweep

Every mandatory pattern is listed even when not applicable. A `HIT` with risk gets a finding ID.

| Pattern | Applicability | Verdict | Evidence | Finding ID |
|---|---|---|---|---|
| Pattern 1 tenant-scope leak | DB-touching route/service | PASS | all changed queries filter `tenant_id` or are master-data exceptions | - |
| Pattern 2 mock policy | tests in radius | HIT | `foo.test.js:88` uses `jest.mock('pg')` | `BR-HIGH-003` |
| Pattern 3 schema drift | migration and SQL in radius | HIT | canonical `schema.sql` missing `orders.deleted_at` | `BR-MED-005` |
| Pattern 13 deleted secret files | diff/PR | NOT APPLICABLE | no secret-file deletion in diff | - |
| Pattern 15 identity fallback mismatch | no identity guard changed | NOT APPLICABLE | no ID/name/email/SKU fallback logic in change set | - |

## Touchpoints

Grouped by category. Each touchpoint includes file:line, the assumption it makes, and whether the
assumption holds after the change.

### Callers (direct)

| Finding ID | file:line | Touchpoint | Assumption | Holds? | Risk |
|---|---|---|---|---|---|
| `BR-HIGH-001` | `apps/api/src/routes/orders.js:42` | `FooService.updateOrder(req.body)` call | Old 2-arg signature | **NO** — needs `tenantId` | HIGH |
| `BR-HIGH-002` | `apps/api/src/workers/syncWorker.js:88` | `FooService.updateOrder(order)` | Old 2-arg signature | **NO** | HIGH |

### Callers (indirect, via re-export)

| file:line | Touchpoint | Risk |
|---|---|---|
| `apps/api/src/services/index.js:12` | re-exports `FooService` | LOW (just a passthrough) |

### Tests

| Finding ID | file:line | What it asserts | Will it pass? | Risk |
|---|---|---|---|---|
| `BR-MED-001` | `apps/api/src/__tests__/services/foo.test.js:55` | `updateOrder(order)` returns row | Will fail (signature) | MEDIUM (will be caught) |
| `BR-HIGH-003` | `apps/api/src/__tests__/services/foo.test.js:88` | uses `jest.mock('pg')` | **HIGH — mocked, false confidence** | HIGH |

### SQL queries touching affected columns

| Finding ID | file:line | Query | Live schema OK? | Risk |
|---|---|---|---|---|
| `BR-MED-002` | `apps/api/src/services/foo.js:120` | `SELECT * FROM orders WHERE id = $1` | Need to filter `deleted_at IS NULL`? | MEDIUM |
| `BR-MED-003` | `apps/api/src/routes/orders.js:200` | `SELECT count(*) FROM orders` | Should exclude soft-deleted? | MEDIUM |

### Background jobs / workers

| Finding ID | file:line | What it does | Risk |
|---|---|---|---|
| `BR-MED-004` | `apps/api/src/workers/orderReporter.js:30` | Aggregates orders, doesn't filter `deleted_at` | MEDIUM — will count deleted |

### External integrations

| Finding ID | file:line | Integration | Risk |
|---|---|---|---|
| `BR-HIGH-004` | `apps/api/src/services/shopify/orderSync.js:200` | Pushes orders to Shopify, doesn't know about soft-delete | HIGH — deleted orders still sync |

## Live Schema Verification

Required for any DB-touching change. Source of truth: dev DB (DATABASE_URL).

### Table `orders`

\`\`\`
psql output of \d+ orders (paste here)
\`\`\`

| Column | Live type | Live nullable | Code assumption | Match? |
|---|---|---|---|---|
| `id` | uuid | NO | UUID string | PASS |
| `tenant_id` | uuid | NO | UUID string | PASS |
| `status` | text | NO | string | PASS |
| `deleted_at` | timestamptz | YES | (new) | PASS — column exists post-migration |

### Sample data check

\`\`\`bash
$ psql "$DATABASE_URL" -c "SELECT count(*) FROM orders;"
 count
-------
  4521

$ psql "$DATABASE_URL" -c "SELECT count(*) FROM orders WHERE deleted_at IS NOT NULL;"
 count
-------
     0
\`\`\`

**Findings**:
- No existing soft-deleted rows (expected for a new column)
- All listed queries should explicitly include `WHERE deleted_at IS NULL` unless they need historical data

### Schema Authority Reconciliation

| Finding ID | Authority | What it says | Match? | Risk |
|---|---|---|---|---|
| - | Live DB | `orders.deleted_at` exists, nullable | PASS | LOW |
| - | Migration files | migration adds `orders.deleted_at` | PASS | LOW |
| `BR-MED-005` | Canonical schema/bootstrap | no `deleted_at` in `schema.sql` | DRIFT | MEDIUM |

### Predicate / Index Check

| Finding ID | Query predicate | Supporting live index/constraint | Match? | Risk |
|---|---|---|---|---|
| `BR-MED-006` | `LOWER(TRIM(invoice_number)) = LOWER(TRIM($1))` | `idx_invoice_uploads_invoice_number` on `LOWER(invoice_number)` | NO | MEDIUM |

## Sibling-Bug Hunt

(Post-fix mode only, or opportunistic for pattern-shaped fixes.)

Bug pattern fixed: `<describe pattern>`

| Finding ID | Match | Same bug? | Notes |
|---|---|---|---|
| `BR-HIGH-005` | `apps/api/src/services/bar.js:80` | YES | Needs the same fix — file vault item |
| - | `apps/api/src/services/baz.js:120` | NO | Already filters via upstream join |
| `BR-MED-007` | `apps/api/src/workers/cleanupWorker.js:60` | UNSURE — needs read | TODO before merge |

## Adversarial Matrix

(Required for PR mode, reruns, and DB-backed validation/business/identity/duplicate/idempotency changes.)

| Finding ID | Axis | Case | Status | Evidence |
|---|---|---|---|---|
| - | Identity | existing row has ID, request has same ID | PROVED | `<test/query>` |
| `BR-HIGH-006` | Identity | existing row has only fallback name, request has resolved ID | UNTESTED | needs real-DB/query proof |
| `BR-HIGH-007` | State | cancelled historical row, fresh active upload | FAILED | unique/index conflict |
| - | Predicate | whitespace/case variant | PROVED | `<test/query>` |
| `BR-HIGH-008` | Writer surface | existing/bulk/pending writer to same table | UNTESTED | needs sibling route proof |

## Finding Closure Ledger

(Required for reruns or when previous blast-radius reports/review threads had HIGH/MEDIUM findings.)

| Previous finding ID | Severity | Fix | Proof | Counterexample tried | Residual risk |
|---|---|---|---|---|---|
| `BR-HIGH-001` | HIGH | guard moved before allocation persistence | `<test/query>` | existing PO without supplier ID | LOW |
| `BR-MED-002` | MEDIUM | none | none | reviewer comment still open | MEDIUM |

## Trace Boundaries (what was NOT traced)

Honesty about scope.

- Did not trace into `node_modules/pg` (3rd-party)
- Did not trace mobile app consumers (out of repo)
- Stopped at `apps/admin/src/api/orders.js` boundary; client-side consumers not enumerated
- Excluded test fixtures from the radius

## Verification Plan (commands to run before merge)

\`\`\`bash
# 1. Unit tests for the changed service
cd apps/api && npx jest src/__tests__/services/foo.test.js

# 2. Integration test for the new route
cd apps/api && npx jest src/__tests__/routes/orders-delete.test.js

# 3. Confirm migration applied cleanly on dev
psql "$DATABASE_URL" -c "\d+ orders" | grep deleted_at

# 4. E2E for the soft-delete user flow
cd apps/admin && npx playwright test e2e/order-soft-delete.spec.ts

# 5. Manual verification — count of soft-deleted before/after
psql "$DATABASE_URL" -c "SELECT count(*) FROM orders WHERE deleted_at IS NOT NULL;"
\`\`\`

## Checklist

(Same content as separate checklist artifact — risk-ranked single-line items.)

### CRITICAL (incident/rotation required)
- [ ] `BR-CRIT-001` `secrets/production.env:1` — deleted secret remains in git history; rotate every credential and purge history if required

### HIGH (do not merge without addressing)
- [ ] `BR-HIGH-001` `routes/orders.js:42` — caller still uses old `updateOrder` signature (add `tenantId`)
- [ ] `BR-HIGH-002` `workers/syncWorker.js:88` — caller still uses old signature
- [ ] `BR-HIGH-003` `__tests__/services/foo.test.js:88` — mocked DB call; rewrite to use real dev DB
- [ ] `BR-HIGH-004` `services/shopify/orderSync.js:200` — Shopify sync doesn't honor soft-delete

### MEDIUM
- [ ] `BR-MED-002` `services/foo.js:120` — `SELECT * FROM orders` doesn't filter `deleted_at IS NULL`
- [ ] `BR-MED-003` `routes/orders.js:200` — aggregate count includes soft-deleted rows
- [ ] `BR-MED-004` `workers/orderReporter.js:30` — reports include soft-deleted

### LOW
- [ ] `BR-LOW-001` `services/index.js:12` — re-export verified, no action

---

## Appendix A — Full diff

\`\`\`diff
<paste git diff or gh pr diff output here>
\`\`\`

## Appendix B — Cortex/grep evidence

Raw output of the searches used, for auditability.

\`\`\`
<paste evidence>
\`\`\`
```

---

## 2. Checklist template (risk-ranked)

The checklist is duplicated into the report's `## Checklist` section AND optionally produced as a
standalone file for users who only want the actionable summary.

Standalone path: `docs/blast-radius/<YYYY-MM-DD>-<change-slug>-checklist.md`

```markdown
# Blast Radius Checklist: <change name>

**Verdict**: <SAFE TO PROCEED | NEEDS REVIEW | DO NOT MERGE | DO NOT MERGE / REVIEW THREADS OPEN>

## CRITICAL risk (incident/rotation required)

- [ ] `BR-CRIT-001` `<file>:<line>` — <one-line description> — <verification/incident step>

## HIGH risk (must address before merge)

- [ ] `BR-HIGH-001` `<file>:<line>` — <one-line description> — <verification step>
- [ ] `BR-HIGH-002` `<file>:<line>` — <one-line description> — <verification step>

## MEDIUM risk (should address)

- [ ] `BR-MED-001` `<file>:<line>` — <one-line description> — <verification step>

## LOW risk (note for follow-up)

- [ ] `BR-LOW-001` `<file>:<line>` — <one-line description>

## Verification commands

\`\`\`bash
<copy-pasteable commands>
\`\`\`
```

---

## 3. Inline annotations template

For review mode. Keyed to diff hunks. Save to:
`docs/blast-radius/<YYYY-MM-DD>-<change-slug>-inline.md`

```markdown
# Inline Blast-Radius Annotations: <change name>

For each hunk in the diff, downstream effects:

## apps/api/src/services/foo.js

### Hunk @@ line 42-58 — `updateOrder(order)` → `updateOrder(order, tenantId)`

**Downstream effects**:
- 2 callers in `routes/orders.js:42` and `workers/syncWorker.js:88` — both still use old signature → **HIGH**
- 1 test in `__tests__/services/foo.test.js:55` — needs updating → MEDIUM
- 1 mock at `__tests__/services/foo.test.js:88` — uses jest.mock('pg') → **HIGH (false confidence)**

### Hunk @@ line 75-85 — new export `deleteOrder`

**Downstream effects**:
- No existing callers (new symbol)
- Will be invoked by new route at `routes/orders.js:200`
- No tests yet — MEDIUM (must add)

## apps/api/database/migrations/0042_add_deleted_at.sql

### Whole file — adds `deleted_at TIMESTAMPTZ` to `orders`

**Downstream effects**:
- 5 SELECT queries on `orders` will silently include soft-deleted rows unless updated:
  - `services/foo.js:120`
  - `routes/orders.js:200`
  - `workers/orderReporter.js:30`
  - `services/shopify/orderSync.js:200` — **HIGH** (will re-push soft-deleted to Shopify)
  - `services/exports/orderExport.js:55`
- 0 INSERT queries reference the new column (NULL default is fine)
```

---

## 4. How to assemble in different modes

| Mode | Report | Checklist | Inline |
|---|---|---|---|
| Plan | YES | YES | NO unless a diff exists |
| Pre-commit | YES | YES | YES |
| Review | YES | YES | YES — also paste a copy into the PR description |
| Post-fix | YES | YES (focus on sibling-bug items) | NO unless reviewing the fix diff |
| Lite speed | Compact report may be inline | YES | YES only if a diff exists |

**Slug rules**: kebab-case, max 40 chars. Examples:
- `add-deleted-at-to-orders`
- `pr-856-soft-delete`
- `fix-tenant-leak-in-product-edit`

If the user provided a name, use it. Otherwise derive from the change set (first changed symbol or
first changed migration). For PR mode, prefix with `pr-<num>-`.

**Write fallback**: if there's no `docs/` dir, or route/worktree policy blocks repo writes, write to
`$CLAUDE_JOB_DIR/blast-radius-<slug>.md` when allowed or emit the artifacts inline. Report the path
or the write limitation back to the user.
