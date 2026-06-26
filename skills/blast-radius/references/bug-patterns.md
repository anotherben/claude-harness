# Bug Pattern Library

Named detection recipes for the specific bug shapes that recur in this codebase. These are the
whack-a-mole patterns — the bugs that ship because a sibling caller, mock, or query was missed.

Use this reference as a **checklist** during fan-out: for each change in scope, mentally walk these
patterns and run the recipe if the pattern applies. Most production regressions match one of these.

## Table of Contents

1. [Tenant-scope leak](#1-tenant-scope-leak)
2. [Mock drift (and the project's real-DB-only test rule)](#2-mock-drift-and-the-projects-real-db-only-test-rule)
3. [Schema drift (code references columns that don't exist live)](#3-schema-drift-code-references-columns-that-dont-exist-live)
4. [Cross-table type trap](#4-cross-table-type-trap)
5. [Route mount order](#5-route-mount-order)
6. [HMAC / webhook raw-body wiring](#6-hmac--webhook-raw-body-wiring)
7. [Validation sibling drift (bulk vs single, route vs worker)](#7-validation-sibling-drift-bulk-vs-single-route-vs-worker)
8. [Incomplete value rename (status, role, enum, config key)](#8-incomplete-value-rename-status-role-enum-config-key)
9. [Soft-delete filter missing](#9-soft-delete-filter-missing)
10. [Default-param / signature drift](#10-default-param--signature-drift)
11. [Async/await loss](#11-asyncawait-loss)
12. [Dynamic require / import-string rot](#12-dynamic-require--import-string-rot)
13. [Deleted secret file / credential in git history](#13-deleted-secret-file--credential-in-git-history)
14. [Circular require / partial module init](#14-circular-require--partial-module-init)
15. [Identity fallback mismatch](#15-identity-fallback-mismatch)
16. [Predicate / index drift](#16-predicate--index-drift)
17. [Schema authority disagreement](#17-schema-authority-disagreement)
18. [Open PR review threads / closure drift](#18-open-pr-review-threads--closure-drift)
19. [Async claim / retry integrity](#19-async-claim--retry-integrity)
20. [Field-level runtime contract](#20-field-level-runtime-contract)
21. [Operator retry / reopen path](#21-operator-retry--reopen-path)
22. [Sync-confirmation preservation before async enqueue](#22-sync-confirmation-preservation-before-async-enqueue)
23. [Commit-boundary bookkeeping split](#23-commit-boundary-bookkeeping-split)
24. [Return-variant success semantics](#24-return-variant-success-semantics)
25. [Conditional branch / reason-set coverage](#25-conditional-branch--reason-set-coverage)
26. [Type / range cast safety](#26-type--range-cast-safety)
27. [Proof-lane integrity](#27-proof-lane-integrity)
28. [Artifact truth and portability](#28-artifact-truth-and-portability)
29. [Runtime-to-proof parity](#29-runtime-to-proof-parity)
30. [Integration fault and idempotency matrix](#30-integration-fault-and-idempotency-matrix)
31. [Boundary, identifier, and omitted-field invariants](#31-boundary-identifier-and-omitted-field-invariants)
32. [Observability and redaction contract](#32-observability-and-redaction-contract)
33. [Public seam, UI, and accessibility contract](#33-public-seam-ui-and-accessibility-contract)
34. [Test-integrity false confidence](#34-test-integrity-false-confidence)

For each pattern: what to look for, the exact detection command, and what a HIT looks like.

---

## 1. Tenant-scope leak

**Shape**: A SELECT/INSERT/UPDATE/DELETE on a tenant-partitioned table that lacks `WHERE tenant_id = $1`
(or equivalent join scope). Causes cross-tenant reads or writes.

**Reference**: CLAUDE.md's "Multi-tenant" rule. Master-data tables `products` and `suppliers` are NOT
tenant-partitioned today — see `docs/architecture/2026-04-26-supplier-margin-tenant-isolation-decision.md`.

**Detection**:

```bash
# For each tenant-anchored table, find queries that may lack tenant scope
for table in orders order_lines purchase_orders stock_movements customers fulfillments; do
  echo "=== $table ==="
  # SELECTs
  grep -rn "FROM $table\b" apps/api/src/ --include='*.js' | while read line; do
    file=$(echo "$line" | cut -d: -f1)
    lineno=$(echo "$line" | cut -d: -f2)
    # Read 10 lines of context, check for tenant scope
    context=$(awk -v start="$lineno" 'NR>=start && NR<start+12' "$file")
    if ! echo "$context" | grep -qE "tenant_id|tenant_uuid|JOIN.*tenant"; then
      echo "POSSIBLE LEAK $file:$lineno"
    fi
  done
  # UPDATEs / DELETEs
  grep -rn "UPDATE $table\b\|DELETE FROM $table\b" apps/api/src/ --include='*.js'
done
```

**HIT looks like**: a query where adjacent context shows no `tenant_id` filter and no `JOIN` that
brings tenant scope from an authenticated entity (e.g., joining via `customer_id` doesn't help
unless `customers.tenant_id` is also filtered).

**False positives**: queries on master-data tables (products, suppliers) are by design unscoped today —
but still flag a MEDIUM note so the user can decide.

---

## 2. Mock drift (and the project's real-DB-only test rule)

**Shape (two sub-patterns)**:

**2a — Mock drift** (classic): A test attaches a `jest.fn()` to a mocked module for a symbol that no
longer exists (was renamed, moved, or deleted). The test passes; production fails or silently
misbehaves.

**2b — Real-DB-only policy violation**: Per CLAUDE.md, *all* tests in this project must hit the
real dev DB — no mocked `config/database`, no `jest.mock('pg')`, no in-memory fakes. Any test in
the blast radius that mocks the database or its direct dependents IS a HIGH-risk false-confidence
test, even if the mock signature happens to match production today. Flag every such test as HIGH;
do not downgrade to MEDIUM/LOW just because the symbol still exists.

**Detection**:

```bash
# Find every jest.mock for a service, then enumerate the keys attached to it
grep -rn "jest\.mock(['\"]\(.*\)/orderRouteService['\"]" apps/api/src/__tests__/ -A 30 | \
  grep -E "^\s*\w+:\s*jest\.fn"

# Cross-reference each attached key with the actual exports of the real module
mcp__cortex-engine__cortex_outline(path="apps/api/src/services/orderRouteService.js", repo="helpdesk")
# Or grep for module.exports / exports.foo:
grep -n "exports\." apps/api/src/services/orderRouteService.js
```

If a test attaches `someMethod: jest.fn()` and `someMethod` is NOT in the real module's exports
list — that's mock drift.

**HIT looks like**: `recalcCachedCounts: jest.fn()` attached to a mocked `orderRouteService` in 11
test files, but `recalcCachedCounts` is exported by `ordersGatekeeperService`, not `orderRouteService`.

**Action**: HIGH risk. The tests give false confidence. Each test must be either fixed (mock the
right module) or rewritten to hit the real dev DB.

---

## 3. Schema drift (code references columns that don't exist live)

**Shape**: Code (insert, select, model, type) names a column that exists in a migration file but not
on the live dev DB (or vice versa — column exists live, code doesn't write it).

**Detection** (per `references/trace-recipes.md` Section 3):

```bash
psql "$DATABASE_URL" -c "\d <table>"

# Then, for every column the code references:
grep -rn "<column>\|<columnCamelCase>" apps/api/src/ --include='*.js'
```

Compare the union of code-referenced columns to the live column list. Either side missing → drift.

**HIT looks like**: `productEditService.js` references `can_dropship`, `dropship_setup_source`,
`dropship_mode_updated_at` — columns that do not exist on the live `products` table (verified via
`\d products`). The write would crash in production despite tests passing (because tests are mocked).

**Action**: HIGH risk. Either the migration didn't run, was rolled back, or the column was never
added. Confirm migration state on dev AND prod (Render).

---

## 4. Cross-table type trap

**Shape**: A JOIN between two columns of different types where the type cast is missing or wrong.
PostgreSQL will silently return zero rows for incompatible casts.

**Reference**: CLAUDE.md "Type traps": `suppliers.id` (UUID) vs `products.supplier_id` (integer) —
cast to text for joins.

**Detection**:

```bash
# Find cross-table joins by type — known problematic pairs:
grep -rn "suppliers\.id\b.*=\b.*supplier_id\|supplier_id.*=.*suppliers\.id" apps/api/src/
grep -rn "JOIN suppliers" apps/api/src/

# For each match, check whether ::text or similar cast is present
```

After finding the join, **verify with live data**:

```sql
-- If the join is between products.supplier_id (int) and suppliers.id (uuid)
SELECT COUNT(*) FROM products p
JOIN suppliers s ON p.supplier_id::text = s.id::text;

-- Compare to:
SELECT COUNT(*) FROM products WHERE supplier_id IS NOT NULL;

-- If the join count is 0 but the source count is 11,480, the cast is failing silently.
```

**HIT looks like**: `JOIN suppliers s ON s.retail_express_id = p.rex_supplier_id::text` returns 0
rows because `retail_express_id` is varchar and `rex_supplier_id::text` is the integer cast — they
look similar but match nothing. Verify with the live count.

---

## 5. Route mount order

**Shape**: A new route is added but mounted in the wrong middleware order — either before
`authenticateStaff` when it should be after (creates unauthenticated access), or after when it
should be before (e.g. a webhook handler needs raw body before JSON parsing).

**Reference**: CLAUDE.md: "Route order: public/webhook routes mount BEFORE `authenticateStaff`
middleware."

**Detection**:

```bash
# Locate the app's middleware chain
grep -n "app\.use\|router\.use" apps/api/src/app.js apps/api/src/bootstrap/*.js

# For any new route, find where it mounts relative to authenticateStaff
grep -n "authenticateStaff\|require.*routes" apps/api/src/app.js
```

Then read the file: every route mounted BEFORE the `authenticateStaff` line is public. Verify each
public route is intentionally public (webhooks, health checks). Every route mounted AFTER is
authenticated.

**HIT looks like**: a new staff-only route accidentally mounted in the public block, or a webhook
mounted in the authenticated block (which would reject the webhook because it lacks a session).

---

## 6. HMAC / webhook raw-body wiring

**Shape**: A new webhook route handler computes HMAC against the parsed JSON body instead of the
raw body, because the route wasn't added to the raw-body whitelist. Signature verification then
falls back to `JSON.stringify(req.body)` which is NOT the original payload bytes, so verification
silently passes for any payload.

**Detection**:

```bash
# Find the raw-body whitelist
grep -rn "rawBody\|verify:.*function\|raw.*body" apps/api/src/bootstrap/security.js \
  apps/api/src/app.js

# For each new webhook route, check if its path is in the whitelist
```

**HIT looks like**: A new route at `/api/portal/catalog-scrape/batch-ingest` is NOT listed in
`bootstrap/security.js`'s raw-body whitelist (a list of webhook paths around line 264). HMAC
verification falls back to JSON-stringified body → silently passes for any payload.

**Action**: HIGH risk. The webhook accepts any request. Add the route to the whitelist.

---

## 7. Validation sibling drift (bulk vs single, route vs worker)

**Shape**: A single-record route fixes validation X, but the bulk variant of the same route, or a
background sync job doing the same thing, still has the old (buggy) validation.

**This is the canonical whack-a-mole bug.**

**Detection**:

```bash
# For each modified route handler, find its bulk variant
modified_route="POST /api/orders/:id/status"
# Look for /bulk and /batch sibling endpoints
grep -rn "/orders/bulk\|/orders/batch\|bulkUpdate" apps/api/src/routes/

# Cross-check the validation logic in each variant
```

For each match, **read both** and verify they apply the same validation. If they differ, classify:
- "Both are correct, just different shapes" → LOW
- "One fixed, the other still has the bug" → HIGH

**Detection patterns by entry shape**:
- Single route → bulk route (look in same routes file)
- API route → cron worker (look in `apps/api/src/workers/`)
- API route → REX sync (look in `apps/api/src/services/rex/`)
- API route → Shopify webhook handler (look in `apps/api/src/services/shopify/`)
- Validation in route → validation in service (look one level down)

---

## 8. Incomplete value rename (status, role, enum, config key)

**Shape**: A literal value (string enum, status code, config key) is renamed in some files but not
others. Read paths and write paths diverge.

**Detection**:

```bash
# After finding the rename, grep BOTH old and new values
OLD="unfulfilled"
NEW="pending"

echo "=== OLD literal still in code ==="
grep -rn "['\"]${OLD}['\"]" apps/ docs/ 2>/dev/null

echo "=== NEW literal in code ==="
grep -rn "['\"]${NEW}['\"]" apps/ docs/ 2>/dev/null

echo "=== Live DB rows still containing OLD ==="
psql "$DATABASE_URL" -c "SELECT count(*) FROM orders WHERE status = '${OLD}';"
psql "$DATABASE_URL" -c "SELECT count(*) FROM orders WHERE status = '${NEW}';"
```

**HIT looks like**: Read formatters return `'pending'`, but writer-side code (`fulfillmentReplayService.js`,
`shopifyOrderSyncService/persistence.js`) still persists `'unfulfilled'`. SQL filter branches match
2,887 of 3,500 rows because the remaining 617 are stored under the old literal. UI "Pending" filter
finds nothing.

**Action**: HIGH risk. Either the migration to update existing rows is missing, or one of the writers
needs updating, or both. List all sites where each literal appears and classify.

---

## 9. Soft-delete filter missing

**Shape**: A new `deleted_at` (or `archived_at`) column is added, but existing SELECT queries don't
filter `WHERE deleted_at IS NULL`. Soft-deleted rows leak into responses, exports, syncs.

**Detection**:

```bash
# For every SELECT on a soft-delete-bearing table, check for the filter
TABLE="orders"
grep -rn "FROM ${TABLE}\b\|SELECT.*FROM ${TABLE}" apps/api/src/ --include='*.js' -A 5 | \
  grep -v "deleted_at IS NULL\|WHERE.*deleted_at"
```

**HIT looks like**: `getProductForEdit` SQL has no `WHERE p.deleted_at IS NULL` filter — soft-deleted
products are editable / returned to UI / pushed to Shopify.

**Action**: MEDIUM-HIGH. Inventory every SELECT on the table; decide for each whether soft-deleted
rows should be included (e.g. an admin audit view) or excluded (most reads).

---

## 10. Default-param / signature drift

**Shape**: A function signature is changed (parameter added, removed, reordered). Direct callers compile
but one or more invokes the function with the wrong positional args or relies on a removed return field.

**Detection**:

```bash
mcp__cortex-engine__cortex_find_references(name="<symbol>", repo="helpdesk")

# For each caller, inspect the call site to confirm the new signature is honored
```

Watch for callers that destructure the return value — they survive a renamed field with no compile
error but `undefined` at runtime.

---

## 11. Async/await loss

**Shape**: A function is changed from sync to async (or returns a Promise), but a caller still treats
the return value as immediate. Result: race conditions, fire-and-forget logic, missing data.

**Detection**:

```bash
# Find callers of the changed symbol that don't await it
SYMBOL="someNewlyAsyncFunction"
grep -rn "[^.]${SYMBOL}(" apps/api/src/ --include='*.js' | grep -v "await\|return\|\.then\|\.catch"
```

Each match: read context. Is the return value used? If yes and there's no `await`, that's a bug.

---

## 12. Dynamic require / import-string rot

**Shape**: A file or module is renamed/moved, but a `require()` with a dynamic-string path (or a
docs/handover/test path) still references the old location. Static imports update; dynamic strings
don't.

**Detection**:

```bash
# After a rename from oldName.js → newName.js
OLD_BASENAME="oldName"

grep -rn "require.*['\"].*${OLD_BASENAME}['\"]" apps/
grep -rn "['\"].*${OLD_BASENAME}\.js['\"]" apps/
grep -rn "${OLD_BASENAME}" docs/  # markdown links rot
grep -rn "${OLD_BASENAME}" .github/  # CI script paths
```

**HIT looks like**: a test file with `require('../../apps/api/src/services/productEditService')` that
resolves to a non-existent path — Jest silently doesn't run the test.

---

## 13. Deleted secret file / credential in git history

**Shape**: A file containing real credentials (`*.env`, `credentials.*`, `*-secrets.json`, `*.pem`,
service-account JSON) is deleted in the working tree or added to `.gitignore` — BUT the file
remains in git history. Anyone with repo read access can `git log -p -- <file>` to extract live
production secrets. `git rm` is NOT enough; the file must be purged from history (`git filter-repo`)
and every leaked credential must be rotated.

**Detection**:

```bash
# In a diff, look for deletions of likely credential files
git diff --name-status | grep -E "^D" | grep -iE "\.env$|credentials|secrets|\.pem$|service-account"

# Or in a PR
gh pr diff <num> | grep -E "^---.*\.env|credentials|secrets|\.pem"

# Confirm the file's history contains content that looks like real secrets
git log --all -- "<file>" --format=oneline | head -5
git log --all -p -- "<file>" | grep -iE "API_KEY|TOKEN|SECRET|PASSWORD|rnd_|sk_|AKIA" | head -20
```

**HIT looks like**: `D HTN Helpdesk.env` in working tree, but `git log -p -- "HTN Helpdesk.env"`
returns commits with DB URLs, API tokens, JWT secrets. The deletion in the diff hides the fact that
historical commits still contain plaintext credentials.

**Action**: **CRITICAL**. The skill must (a) list every credential the historical file contained,
(b) state explicitly that every listed credential must be rotated, (c) recommend `git filter-repo`
or BFG to purge the file from history, (d) recommend adding the path to `.gitignore` so it can't
re-enter. Do not downgrade this to MEDIUM "follow-up" — leaked secrets are an immediate incident.

---

## 14. Circular require / partial module init

**Shape**: Two CommonJS modules require each other (directly or transitively through a graph).
When the entry-point module is loaded first, the second module's `require()` of the first returns
the *partially-initialised* `module.exports` object — symbols not yet assigned are `undefined`.
Top-level destructuring binds these to `undefined` and the resulting `TypeError: X is not a
function` only fires when the dispatch path runs.

**Why it's hard to catch**: every test that loads the modules in dependency order passes. The bug
only surfaces under the specific load order from production entry points (typically a webhook or
worker that pulls one side of the cycle first).

**Detection**:

```bash
# Find all top-level destructures from local modules in the change set's file
grep -nE "^const \{[^}]+\} = require\(['\"]\\./" <file>

# For each destructured-from module, check if it transitively requires back into <file>
# by following require() chains. Tools like 'madge --circular' do this:
npx madge --circular apps/api/src/ 2>&1 | head -50

# Specifically search for the production crash pattern
grep -rn "is not a function" apps/api/logs/ docs/ 2>/dev/null
```

**HIT looks like**: PR #1856 — `refundAutoVoidService.js` top-level-required `./orderCommandService`,
whose dispatcher graph loads `orderFinancialCommandHandlers`, which loads `refundAutoVoidService`
back. Production webhook entry pulled `refundAutoVoidService` first, destructure bound `undefined`,
then `TypeError: dispatchOrderCancelInRexCommand is not a function`. Fix: move the require inside
the function body (deferred require) so it resolves against the fully-initialised module record.

**Action**: For any file in the change set with top-level destructures from sibling modules, walk
the require graph (or run `madge --circular`) and flag every cycle. Even if the cycle "works
today", any future change to load order will break it.

**Sibling-sweep when fixing**: After fixing one circular-require, grep for the same anti-pattern
across the whole codebase. The deferred-require fix is a pattern; apply it everywhere a top-level
destructure exists in a known-cyclic module.

---

## 15. Identity fallback mismatch

**Shape**: A guard, lookup, duplicate check, idempotency check, or permission check can match by more
than one identity source (ID, name, SKU, email, invoice number, PO id, external id). The new code handles
the clean ID path but misses historical rows or sibling requests that only have fallback identity.

**Why it ships**: tests usually seed the same shape they submit. Production has older rows created before
an ID was resolved, OCR names that differ from supplier display names, aliases, whitespace/case drift,
or requests where the existing-PO path lacks the ID that the new-PO path has.

**Detection**:

```bash
# For the touched guard/lookup, list every predicate identity source.
grep -rn "supplier_rex_id\|supplier_name\|invoice_number\|external_id\|sku\|email" apps/api/src/ --include='*.js'

# Find writers to the same table and note which identity fields each writer can provide.
TABLE="invoice_uploads"
grep -rn "INSERT INTO ${TABLE}\|UPDATE ${TABLE}\|FROM ${TABLE}" apps/api/src/ --include='*.js'
```

Then build a matrix:

| Existing row | New request | Expected |
|---|---|---|
| ID present, name present | same ID | match |
| ID missing, name present | same ID resolved later | match or backfill |
| ID present | name-only alias | match via resolved owner or reject as ambiguous |
| both missing | invoice number only | skip guard or reject, never global false-positive unless business rules require it |

**HIT looks like**: a duplicate guard uses `supplier_rex_id = $2` when the new request has a Rex id, so
it misses an active historical invoice row that only stored `supplier_name`. Or an existing-PO path calls
the guard before resolving the PO supplier id, so the guard scopes only by OCR supplier name and misses
the real supplier.

**Action**: HIGH when it can allow duplicate writes, tenant/auth bypass, or false-positive blocking of
valid work. Add fallback matching, resolve identity before guarding, backfill data, or reject ambiguous
requests at the boundary.

---

## 16. Predicate / index drift

**Shape**: A query changes predicate shape without changing the supporting index or uniqueness contract.
Examples: `LOWER(col)` becomes `LOWER(TRIM(col))`, `deleted_at IS NULL` is added without a partial index,
or an indexed equality becomes a function-wrapped expression. Correctness may hold in small data but the
hot-path lookup turns into a scan.

**Detection**:

```bash
# Find changed predicates in the diff.
git diff -U5 <base>...HEAD -- apps/api/src | grep -nE "WHERE|JOIN|ON CONFLICT|ORDER BY|LOWER|TRIM"

# Pull live indexes for every touched table.
psql "$DATABASE_URL" -P pager=off -c "
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('<table_1>', '<table_2>')
ORDER BY tablename, indexname;"
```

Compare the expression text, not just the column name. `LOWER(TRIM(invoice_number))` does not use an
index on `LOWER(invoice_number)` unless the planner can prove equivalence, which it generally cannot.

**HIT looks like**: four sibling invoice lookups all switch to `LOWER(TRIM(invoice_number))`, while the
live index remains `lower(invoice_number::text)`. The change may be functionally correct but is a
review-worthy performance/regression risk.

**Action**: MEDIUM for cold read paths; HIGH for hot write guards, sync loops, high-cardinality tables,
or anything in a transaction/lock path. Prefer normalizing on write, or add a matching functional index.

---

## 17. Schema authority disagreement

**Shape**: Live schema, migrations, canonical bootstrap schema, code comments, or tests disagree about
whether a column/index/constraint exists. Live DB is runtime truth, but committed schema is contract
truth; drift means the next environment, test DB, or reviewer may be operating from a different model.

**Detection**:

```bash
TABLE="invoice_uploads"
grep -rn "${TABLE}" apps/api/database apps/api/src/db docs/ --include='*.sql' --include='*.md' 2>/dev/null

psql "$DATABASE_URL" -P pager=off -c "
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.${TABLE}'::regclass
ORDER BY conname;"
```

Check all schema authorities:
- live `information_schema`, `pg_indexes`, `pg_constraint`
- migration files
- canonical schema/bootstrap files (`schema.sql`, `purchasing_schema.sql`, etc.)
- fact-drift/authority maps and docs
- tests that assert schema assumptions

**HIT looks like**: live DB has no unique constraint on `(invoice_number, supplier_rex_id)`, while a
canonical schema file still declares `UNIQUE(invoice_number, supplier_rex_id)`. A cancellation change
that relies on inserting a new row after excluding cancelled rows may pass live but fail in a fresh DB.

**Action**: MEDIUM if it is documentation/bootstrap drift only; HIGH if it affects uniqueness, foreign
keys, nullability, status checks, tenant constraints, or fresh-environment deployability.

---

## 18. Open PR review threads / closure drift

**Shape**: The local report, handoff, or rerun says the risk is closed, but GitHub still has unresolved
review threads, or the PR head changed after the trace. This is a process bug that becomes a merge bug:
the report is no longer describing the PR reviewers see.

**Detection**:

```bash
gh pr view <num> --json headRefOid,statusCheckRollup,reviewDecision

gh api graphql -F owner=<owner> -F repo=<repo> -F number=<num> -f query='
query($owner:String!,$repo:String!,$number:Int!){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$number){
      headRefOid
      reviewThreads(first:100){
        nodes{
          isResolved
          isOutdated
          path
          line
          comments(first:1){ nodes{ author{login} body url } }
        }
      }
    }
  }
}' | jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)'
```

**HIT looks like**: a blast-radius rerun says "covered" based on targeted tests, but GraphQL shows
unresolved threads for supplier identity fallback, cancelled-row uniqueness, or predicate/index drift.

**Action**: DO NOT MERGE in PR mode. Include every unresolved thread in the report's findings or mark it
as explicitly not evaluated. If `headRefOid` changed since the trace began, rerun against the new head.

---

## 19. Async claim / retry integrity

**Shape**: A queue, worker, scheduler, or background job can process the same state mutation twice, leave
`running` rows stuck forever, or mark committed work retryable after a later bookkeeping failure.

**Detection**:

```bash
grep -rn "FOR UPDATE\|SKIP LOCKED\|status.*running\|max_attempts\|retry" apps/api/src --include='*.js'
grep -rn "UPDATE .*status.*running\|UPDATE .*status.*pending" apps/api/src --include='*.js'
```

Prove duplicate schedulers/workers, lock winner vs lock waiter, stale-running recovery, max-attempt behavior,
and idempotent committed side effects.

**Action**: HIGH for any state-mutating async path without atomic claim and stale-run proof.

---

## 20. Field-level runtime contract

**Shape**: Producer and consumer use near-miss payload keys or aliases. Tests pass because mocks use the
consumer shape while the real route, worker, print payload, notification, or read model emits a different key.

**Detection**:

```bash
grep -rn "quantity\|receivedQuantity\|quantityReceived\|productId\|retailExpressProductId\|status\|intent" apps/api/src apps/web/src --include='*.js' --include='*.jsx' --include='*.ts' --include='*.tsx'
```

List real producer keys and real consumer keys side by side. Include zero/falsy values and non-zero values.

**Action**: HIGH when the mapper does not read the exact field emitted by the real producer, or when proof is mock-only.

---

## 21. Operator retry / reopen path

**Shape**: Staff-facing workflows lock, submit, print, retry, or recover correctly only until the modal closes,
the page refreshes, or a downstream dependency is unavailable/cancelled.

**Detection**: Identify the backend state that represents the lock/source of truth, then prove close/reopen,
refresh, retry, unavailable, cancelled, and duplicate-click paths through the real UI or route.

**Action**: HIGH for transient frontend-only locks on inventory, invoice, order, or label-printing flows.

---

## 22. Sync-confirmation preservation before async enqueue

**Shape**: A route starts queuing work before it runs the old synchronous service path, so recoverable `409`
confirmations or staff choices become later background failures.

**Detection**: Diff the old synchronous call path against the new enqueue path. Enumerate every old validation,
confirmation, and recoverable error code, then prove each still happens before acceptance.

**Action**: HIGH when a recoverable staff decision is moved behind `202 Accepted` without explicit product approval.

---

## 23. Commit-boundary bookkeeping split

**Shape**: The irreversible write/API call succeeds, but a later projection, status update, notification, or
bookkeeping step fails and marks the entire operation failed or safely retryable.

**Detection**: Mark the first commit point. Read the surrounding `try`/`catch` and status updates. Force the
post-commit step to fail and prove committed work remains recorded as committed, not uncommitted or retryable.

**Action**: HIGH for stock, money, invoice, pricing, sync, or external side effects.

---

## 24. Return-variant success semantics

**Shape**: A helper returns truthy objects for `unavailable`, `cancelled`, `skipped`, or `no-op`, and callers
treat all truthy values as success, suppressing retries or recording false completion.

**Detection**: Enumerate every return variant and every caller branch. Prove dedupe, locks, retry suppression,
and success notifications happen only on the explicit success discriminant.

**Action**: HIGH for printing, notification, sync helper, quick action, and integration calls.

---

## 25. Conditional branch / reason-set coverage

**Shape**: A new mode flag, reason string, behavior branch, or structured error code works for one literal
case but skips sibling reasons, negative cases, idempotent repeats, or placeholder ordering.

**Detection**:

```bash
grep -rn "reason\|code\|mode\|matchAny\|CASE\|WHEN\|ILIKE" apps/api/src --include='*.js'
```

For every new branch, require proof for on/off, matching/non-matching, sibling reasons that should recover,
already-updated idempotency, and SQL placeholder order.

**Action**: HIGH when a business recovery branch has only one happy-path literal test.

---

## 26. Type / range cast safety

**Shape**: Numeric-looking text, JSON payload IDs, or external IDs are cast to `bigint`, `uuid`, `int`, or
`numeric` without guarding malformed, empty, or out-of-range values. One corrupt row can abort the whole worker
query. Casting indexed columns can also force scans.

**Detection**:

```bash
grep -rn "::bigint\|::uuid\|::int\|::numeric\|CAST(" apps/api/src --include='*.js' --include='*.sql'
```

Prove malformed, empty, and out-of-range values are filtered before the cast. For indexed predicates, prove the
column side remains uncast or the matching expression index exists.

**Action**: HIGH for worker/sync loops and hot paths; MEDIUM for cold reads unless the cast can abort a transaction.

---

## 27. Proof-lane integrity

**Shape**: A live-proof registry, route matcher, CI mirror, or verification command appears green while selecting
the wrong lane or exiting `0` even when the resource it claims to verify is missing.

**Detection**: Add negative tests for lane precedence and missing resources. Mixed diffs containing a generic
route/glue file plus a domain file must select the domain lane. Schema probes must fail when expected tables,
columns, routes, workers, browser states, or artifacts are absent.

**Action**: DO NOT CLAIM FIXED when proof can pass for the wrong lane or an empty result set.

---

## 28. Artifact truth and portability

**Shape**: Review, verification, blast-radius, or PR-readiness artifacts contradict the current PR state, cite an
old head/base, include stale pending checklists, or commit machine-specific commands such as local home-directory
prefixes, `PATH=...`, or `NODE_PATH=...`.

**Detection**:

```bash
grep -rn "/Users/\|PATH=\|NODE_PATH=\|Pending\|Create PR\|Remaining Before Merge" docs .codex --include='*.md' --include='*.json'
```

Compare artifact head/base, gate status, and remaining-work sections to the actual PR state.

**Action**: MEDIUM for stale docs; HIGH when the artifact is used as proof for PR-ready, merge-ready, ship-ready,
or done.

---

## 29. Runtime-to-proof parity

**Shape**: A verifier, readiness script, replay/backtest, report, or live-proof query retypes production logic and
drifts from the runtime helper it claims to prove.

**Detection**: Compare runtime predicates/helpers with verification/replay/report code. Prefer shared helper imports;
otherwise require tests proving equivalent inputs, filters, joins, and business truth conditions.

**Action**: HIGH when the proof can pass on a proxy condition instead of the business condition users depend on.

---

## 30. Integration fault and idempotency matrix

**Shape**: External fallback, retry, timeout, cancellation, or error handling applies too broadly, leaks raw external
errors, duplicates non-idempotent side effects, or leaves resources running after timeout.

**Detection**: Build a method/fault matrix: transient vs permanent, idempotent vs mutating method, action-rejection
vs network/credential/5xx, timeout before/after upstream side effect, sanitized vs raw error object.

**Action**: HIGH for email, SOAP, Graph, Shopify, REX, backup, browser-worker, and sync integrations.

---

## 31. Boundary, identifier, and omitted-field invariants

**Shape**: A changed path loses tenant/supplier/owner scope, uses the wrong identifier family, changes defaults without
rollout approval, or overwrites persisted values with defaults when retry payloads omit fields.

**Detection**: List each identifier with its authority and type. Test missing, stale, wrong-family, omitted, null,
zero, and already-reconciled/upsert paths. Verify affected rows before success.

**Action**: HIGH for tenant, supplier, order, payment, voucher, forecast, purchasing, and sync state.

---

## 32. Observability and redaction contract

**Shape**: A logging/error change leaks credentials in message/stack/non-object fields, changes log schema unexpectedly,
or removes useful operator diagnostics.

**Detection**: Run an adversarial secret corpus through Error, string, object, Axios-like config, header, cookie,
access_token, refresh_token, id_token, bearer, basic auth, SOAP password, and stack shapes. Assert redaction and stable field shape.

**Action**: HIGH for logs, serializers, external clients, backup diagnostics, HMAC diagnostics, and operator review evidence.

---

## 33. Public seam, UI, and accessibility contract

**Shape**: A route, service export, API client, startup seam, UI lock, route highlight, or custom widget behavior changes
without proving real consumers and keyboard/focus paths.

**Detection**: Require module-graph/startup seam tests for exports, API client/server key matching, close/reopen UI
rehydration, deepest-route match tests, and Arrow/Enter/Space/Escape/outside-click/focus behavior for custom listbox or combobox controls.

**Action**: HIGH when mocks hide missing exports, request-key drift, or inaccessible custom controls.

---

## 34. Test-integrity false confidence

**Shape**: A test passes while proving the wrong surface: DB mocks in schema-coupled code, source-string assertions,
unrestored environment, brittle graph-size counts, or module-load tests that import too early.

**Detection**: Scan changed tests for `jest.mock` of DB/config, `fs.readFileSync(...).toContain`, global env mutation,
arbitrary count thresholds, and top-level imports that invalidate import-isolation tests.

**Action**: HIGH when the test is used as proof for schema, startup, route, worker, or integration behavior.

---

## How to apply this library during fan-out

For each change in scope, ask: which named patterns apply? Run those recipes specifically.
Patterns that don't apply, skip. This is faster than tracing every general principle from scratch
and catches the *specific* whack-a-mole bugs this codebase actually has.

The applicability heuristic:
- **Any DB change**: patterns 1, 3, 4, 9
- **Any DB predicate / lookup / guard change**: patterns 15, 16, 17
- **Any SQL cast / parser / external ID change**: patterns 4, 16, 26
- **Any new route**: patterns 5, 6
- **Any validation / business logic / duplicate / idempotency change**: patterns 7, 8, 15, 25
- **Any async / queue / worker / scheduler change**: patterns 19, 23, 25, 26
- **Any field projection / DTO / read-model / print / notification change**: pattern 20
- **Any staff retry / modal / close-reopen / print / unavailable dependency workflow**: patterns 21, 24
- **Any sync-to-async route conversion**: patterns 19, 22, 23, 24
- **Any live-proof registry / verification command / CI mirror change**: pattern 27
- **Any verification, review, blast-radius, PR-readiness, or solution artifact change**: pattern 28
- **Any verifier / replay / backtest / report / readiness script change**: pattern 29
- **Any external API / SOAP / Graph / Shopify / REX / browser-worker / backup timeout change**: pattern 30
- **Any tenant / supplier / owner / identifier / upsert / default / rollout change**: pattern 31
- **Any logging / sanitizer / diagnostic / operator evidence change**: pattern 32
- **Any export / route / API client / custom UI control / navigation / lock-state change**: pattern 33
- **Any test harness, mock, source-string, env, module-load, or brittle assertion change**: pattern 34
- **Any signature change**: patterns 2, 10, 11
- **Any rename / move**: patterns 8, 12
- **Any test change**: pattern 2
- **Any live DB proof test or hot-path proof query**: patterns 16, 26, 27
- **Any deletion / `.gitignore` change**: pattern 13 (always check for secret-file deletes)
- **Any require / module / circular-fix change**: pattern 14
- **Any file containing top-level destructures from local modules**: pattern 14 (even if not changed)
- **Any PR-mode run**: pattern 18 at the start and end of the trace

**Always scan patterns 1, 2, 3, 13 for ANY change** — these are so often the root cause they
override the heuristic. Pattern 1 in particular: for ANY function in the radius that touches the
DB (directly or transitively), confirm tenant scoping — don't restrict Pattern 1 to "tenant-related
changes." Tenant leaks happen most often in functions nobody thought were tenant-related.

**Always scan pattern 18 for PR mode** — unresolved review threads are not advisory noise. They are live
counterexamples until addressed, resolved, or explicitly classified as false positives with evidence.

**Strict mock policy**: a test using `jest.mock(...config/database)`, `jest.mock('pg')`, or any
in-memory DB fake is HIGH risk **regardless** of whether the mocked symbols exist. Per CLAUDE.md,
the project's standing rule is real-DB-only. Do not let mock-shape correctness mask the
false-confidence problem.
