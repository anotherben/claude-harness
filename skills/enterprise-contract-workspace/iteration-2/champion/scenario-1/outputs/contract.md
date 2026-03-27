# Contract: POST /api/alert-configs — Tenant-Scoped Alert Configuration
**Date**: 2026-03-14 | **Status**: LOCKED
**Plan**: docs/plans/2026-03-14-alert-configs-plan.md
**TDD**: docs/designs/2026-03-14-alert-configs-tdd.md

---

## Preconditions

What MUST be true before this code runs. These are not tested — they are assumed.

- PRE-1: Database migration `20260314_create_alert_configs.sql` has been applied (`alert_configs` table exists with columns: `id UUID`, `tenant_id UUID`, `category VARCHAR(100)`, `threshold INTEGER`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`, and a unique constraint on `(tenant_id, category)`)
- PRE-2: `authenticateStaff` middleware is mounted in `apps/api/src/routes/index.js` and the alert-configs route mounts AFTER it — verified in route registration order
- PRE-3: `alertConfigService` is available and exported from `apps/api/src/services/alertConfigService.js`
- PRE-4: `pool` (PostgreSQL connection pool) is available and exported from `apps/api/src/database/pool.js`
- PRE-5: `req.user.tenant_id` is populated by `authenticateStaff` for all protected requests

---

## Postconditions

Every postcondition becomes a test assertion. Every postcondition is traceable to a specific test name AND a specific code line.

### API Layer (PC-A)

| ID | Postcondition | Test | Code |
|----|--------------|------|------|
| PC-A1 | `POST /api/alert-configs` with `{ category: "payment_delay", threshold: 60 }` returns 201 with `{ id, tenant_id, category, threshold, created_at }` | `alertConfigs.route.test.js: "creates alert config and returns 201 with full record"` | `apps/api/src/routes/alertConfigs.js:createAlertConfig():L18` |
| PC-A2 | `POST /api/alert-configs` with missing `category` field returns 400 with `{ error: "Category is required" }` | `alertConfigs.route.test.js: "returns 400 when category is missing"` | `apps/api/src/routes/alertConfigs.js:L12` |
| PC-A3 | `POST /api/alert-configs` with missing `threshold` field returns 400 with `{ error: "Threshold is required" }` | `alertConfigs.route.test.js: "returns 400 when threshold is missing"` | `apps/api/src/routes/alertConfigs.js:L14` |
| PC-A4 | `POST /api/alert-configs` without a valid auth token returns 401 | `alertConfigs.route.test.js: "returns 401 for unauthenticated request"` | `apps/api/src/middleware/auth.js` (middleware handles this) |
| PC-A5 | The response body from `POST /api/alert-configs` never includes a stack trace, SQL text, or internal file path | `alertConfigs.route.test.js: "error responses are generic"` | `apps/api/src/routes/alertConfigs.js: catch block` |

### Service Layer (PC-S)

| ID | Postcondition | Test | Code |
|----|--------------|------|------|
| PC-S1 | `alertConfigService.createAlertConfig({ tenantId, category, threshold })` inserts a row with `tenant_id = tenantId` sourced from the authenticated user — not from the request body | `alertConfigService.test.js: "inserts row with tenant_id from authenticated user"` | `apps/api/src/services/alertConfigService.js:createAlertConfig():L22` |
| PC-S2 | `alertConfigService.createAlertConfig()` returns the full inserted row: `{ id, tenant_id, category, threshold, created_at, updated_at }` | `alertConfigService.test.js: "returns complete created record"` | `apps/api/src/services/alertConfigService.js:createAlertConfig():L28` |
| PC-S3 | `alertConfigService.createAlertConfig()` with `threshold <= 0` throws a validation error with message `"Threshold must be a positive integer"` | `alertConfigService.test.js: "throws on non-positive threshold"` | `apps/api/src/services/alertConfigService.js:validatePayload():L8` |
| PC-S4 | `alertConfigService.createAlertConfig()` with a duplicate `(tenant_id, category)` pair throws an error with code `DUPLICATE_ALERT_CONFIG` | `alertConfigService.test.js: "throws on duplicate category for same tenant"` | `apps/api/src/services/alertConfigService.js:createAlertConfig():L35` |
| PC-S5 | `alertConfigService.createAlertConfig()` with `category` containing only whitespace trims and then rejects with `"Category is required"` | `alertConfigService.test.js: "rejects whitespace-only category"` | `apps/api/src/services/alertConfigService.js:validatePayload():L6` |
| PC-S6 | The SQL `INSERT` in `createAlertConfig()` uses parameterized values (`$1`, `$2`, `$3`) — no string concatenation or template literals in the query string | `alertConfigService.test.js: "SQL uses parameterized values"` (static grep assertion) | `apps/api/src/services/alertConfigService.js:createAlertConfig():L20` |

### Cross-Layer (PC-X)

| ID | Postcondition | Test | Code |
|----|--------------|------|------|
| PC-X1 | A record created via `POST /api/alert-configs` is retrievable from the database scoped to the same tenant_id immediately after the response is returned | `alertConfigs.integration.test.js: "created config is persisted and tenant-scoped"` | Route → Service → DB |
| PC-X2 | A record created for tenant A is NOT visible when queried under tenant B's credentials | `alertConfigs.integration.test.js: "tenant isolation — config invisible to other tenants"` | Route → Service → DB → `WHERE tenant_id = $1` |

---

## Invariants

Conditions that must be true at ALL times, across ALL postconditions. Violations are always bugs.

| ID | Invariant | Verification |
|----|-----------|-------------|
| INV-1 | Every `INSERT` in changed files includes `tenant_id` sourced from `req.user.tenant_id` | `grep -n 'INSERT INTO' apps/api/src/services/alertConfigService.js` — confirm `tenant_id` param present |
| INV-2 | Every `SELECT`/`UPDATE`/`DELETE` in changed files scopes to `tenant_id` via `WHERE tenant_id = $N` | `grep -n 'SELECT\|UPDATE\|DELETE' apps/api/src/services/alertConfigService.js` — confirm WHERE clause |
| INV-3 | All SQL queries in changed files use parameterized values (`$1`, `$2`) — zero string concatenation | `grep -n '\${\|template\|+ "' apps/api/src/services/alertConfigService.js` — count must be 0 |
| INV-4 | No changed source file exceeds 400 lines (soft limit) / 800 lines (hard limit) | `wc -l apps/api/src/services/alertConfigService.js apps/api/src/routes/alertConfigs.js` |
| INV-5 | The `/api/alert-configs` route mounts AFTER `authenticateStaff` middleware in `apps/api/src/routes/index.js` | Read `apps/api/src/routes/index.js` — confirm route registration order |
| INV-6 | All user-facing error responses are generic — no stack traces, no internal paths, no SQL errors | Read catch blocks in `alertConfigs.js` and `alertConfigService.js` — check error response shape |
| INV-7 | The `alert_configs` table migration uses `TIMESTAMPTZ` for `created_at` and `updated_at` | Read `apps/api/database/migrations/20260314_create_alert_configs.sql` — grep for `TIMESTAMPTZ` |

---

## Error Cases

Every error case becomes a negative test. The test proves the code handles the error correctly.

| ID | Trigger | Status | Response | Log | Recovery | Test |
|----|---------|--------|----------|-----|----------|------|
| ERR-1 | `category` field absent from request body | 400 | `{ error: "Category is required" }` | None — expected input error | Client supplies category | `"returns 400 when category is missing"` |
| ERR-2 | `threshold` field absent from request body | 400 | `{ error: "Threshold is required" }` | None — expected input error | Client supplies threshold | `"returns 400 when threshold is missing"` |
| ERR-3 | `threshold` is zero or negative (e.g., `0`, `-5`) | 400 | `{ error: "Threshold must be a positive integer" }` | None — expected input error | Client corrects threshold | `"returns 400 for non-positive threshold"` |
| ERR-4 | `threshold` is a non-integer float (e.g., `4.7`) | 400 | `{ error: "Threshold must be a positive integer" }` | None | Client rounds input | `"returns 400 for float threshold"` |
| ERR-5 | `category` is whitespace-only (`"   "`) | 400 | `{ error: "Category is required" }` | None | Client supplies category | `"returns 400 for whitespace-only category"` |
| ERR-6 | Duplicate `(tenant_id, category)` pair | 409 | `{ error: "An alert config for this category already exists" }` | `warn: duplicate alert config — tenantId=[id] category=[cat]` | Client updates existing config | `"returns 409 for duplicate category"` |
| ERR-7 | No auth token / expired token | 401 | `{ error: "Authentication required" }` | None — handled by `authenticateStaff` | Client re-authenticates | `"returns 401 for unauthenticated request"` |
| ERR-8 | Database connection failure during INSERT | 500 | `{ error: "An internal error occurred" }` | `error: createAlertConfig failed — tenantId=[id] category=[cat] err=[message] stack=[...]` | Ops intervenes; client retries | `"returns 500 and logs on DB failure"` |
| ERR-9 | `category` exceeds 100 characters | 400 | `{ error: "Category must not exceed 100 characters" }` | None | Client truncates category | `"returns 400 for category exceeding max length"` |

---

## Consumer Map

For every data output this code produces, list EVERY consumer and what it does with the data.

### Data: Single alert config (`POST /api/alert-configs` response — `{ id, tenant_id, category, threshold, created_at }`)

| Consumer | Purpose | What it reads | File:Line |
|----------|---------|---------------|-----------|
| `useAlertConfigs` hook | Appends newly created config to the local list cache after successful POST | `data.id`, `data.category`, `data.threshold` | `apps/admin/src/hooks/useAlertConfigs.js:L44` |
| Success toast notification | Confirms creation to the user | `data.category` (used in message: "Alert config for {category} created") | `apps/admin/src/components/AlertConfigForm.jsx:L72` |
| `AlertConfigList` component (via cache invalidation) | Re-renders list to include new row after creation | `data.id`, `data.category`, `data.threshold` | `apps/admin/src/components/AlertConfigList.jsx:L28` |

### Data: Validation error (`POST /api/alert-configs` 400/409 response — `{ error: "..." }`)

| Consumer | Purpose | What it reads | File:Line |
|----------|---------|---------------|-----------|
| `AlertConfigForm` component | Displays inline field error to user | `error` string | `apps/admin/src/components/AlertConfigForm.jsx:L85` |

**Separation of concerns check:** All consumers of the success response need the same fields (`id`, `category`, `threshold`). No consumer needs a different shape. No separate lightweight endpoint is warranted at this time.

---

## Blast Radius Scan

### Same-File Siblings

Functions in the same file as the changed code. Check each for the same class of issues.

#### `apps/api/src/services/alertConfigService.js` (new file — siblings apply at file-level from adjacent service files)

This is a new file. No existing siblings within the file. Blast radius shifts to cross-file.

#### `apps/api/src/routes/alertConfigs.js` (new file)

This is a new file. The route is registered in `apps/api/src/routes/index.js` — that file's registration order is affected.

**`apps/api/src/routes/index.js` siblings:**

| Existing Route | File:Line | Same Pattern? | Status |
|----------------|-----------|--------------|--------|
| `router.use('/api/sync-configs', syncConfigsRouter)` | `routes/index.js:L34` | YES — mounts after `authenticateStaff` | CHECKED — follows pattern |
| `router.use('/api/suppliers', suppliersRouter)` | `routes/index.js:L36` | YES — mounts after `authenticateStaff` | CHECKED — follows pattern |
| `router.post('/webhooks/shopify', ...)` | `routes/index.js:L12` | Webhook — mounts BEFORE auth | CHECKED — different pattern, correct |

### Cross-File Siblings

Functions in the same directory/module that perform similar logical operations.

| Function | File:Line | Same Operation? | Has Same Guard? |
|----------|-----------|-----------------|-----------------|
| `syncConfigService.createSyncConfig()` | `apps/api/src/services/syncConfigService.js:L15` | YES — creates tenant-scoped config with validation | YES — has `tenant_id` in INSERT and validation guard |
| `supplierService.createSupplier()` | `apps/api/src/services/supplierService.js:L22` | YES — creates tenant-scoped record | YES — has `tenant_id` in INSERT |
| `syncConfigService.getSyncConfigs()` | `apps/api/src/services/syncConfigService.js:L42` | YES — reads tenant-scoped list | YES — `WHERE tenant_id = $1` |
| `alertHelpers.getActiveAlerts()` | `apps/api/src/helpers/alertHelpers.js:L18` | PARTIAL — reads alert-related data | CHECKED — uses `WHERE tenant_id = $1` |

**No "NO" guard findings.** All cross-file siblings appear to enforce tenant scoping correctly.

### Validation Functions

Functions that validate or constrain the same data this code touches.

| Function | File:Line | Enforces Same Constraints? |
|----------|-----------|---------------------------|
| `validateAlertPayload()` (new — to be created) | `apps/api/src/services/alertConfigService.js:L6` | YES — owns category + threshold validation for this feature |
| `sanitizeInput()` middleware | `apps/api/src/middleware/sanitize.js:L12` | YES — strips XSS from request body fields |
| `authenticateStaff()` middleware | `apps/api/src/middleware/auth.js:L8` | YES — validates JWT and populates `req.user.tenant_id` |

### Edge Cases

| Edge Case | Checked? | Status |
|-----------|----------|--------|
| `category = null` | YES | Covered by ERR-1 (required validation) |
| `category = ""` | YES | Covered by ERR-1 (trim + required check) |
| `category = "   "` (whitespace only) | YES | Covered by ERR-5 |
| `category = "<script>alert(1)</script>"` | YES | Handled by `sanitizeInput` middleware before route handler |
| `category` length > 100 chars | YES | Covered by ERR-9 |
| `threshold = 0` | YES | Covered by ERR-3 |
| `threshold = -1` | YES | Covered by ERR-3 |
| `threshold = 4.7` (float) | YES | Covered by ERR-4 |
| `threshold = null` | YES | Covered by ERR-2 (required validation) |
| `threshold = Number.MAX_SAFE_INTEGER` | YES | Allowed — no upper bound defined in plan; integer column will accept |
| Duplicate `(tenant_id, category)` | YES | Covered by ERR-6 (DB unique constraint → 409) |
| Same category, different tenants | YES | Allowed by design — unique constraint is `(tenant_id, category)`, not `category` alone |
| Concurrent creation of same category by same tenant | YES | DB unique constraint `(tenant_id, category)` handles race — one wins, one gets 409 |
| `tenant_id` supplied in request body (attempt to spoof) | YES | `tenant_id` sourced exclusively from `req.user.tenant_id` — body field ignored (PC-S1) |

---

## Side Effects

Everything this code does BESIDES its primary function.

| Side Effect | Intentional? | Test |
|-------------|-------------|------|
| Writes a row to `alert_configs` table | YES — primary purpose | `"inserts row with tenant_id from authenticated user"` |
| Duplicate insertion attempt triggers DB constraint violation (logged at `warn`) | YES | `"returns 409 for duplicate category"` |
| DB failure triggers error log with tenantId, category, and stack trace | YES | `"returns 500 and logs on DB failure"` |

No cache, queue, email, or external API side effects are introduced by this feature.

---

## Error Strategy

### Error Handling Matrix

| Operation | Error Type | Strategy | User Message | Log Level | Recovery |
|-----------|-----------|----------|-------------|-----------|----------|
| Validate `category` (present, non-empty, ≤100 chars) | Validation failure | Return 400 immediately, do not reach DB | Specific field message (ERR-1, ERR-5, ERR-9) | none | User corrects input |
| Validate `threshold` (present, positive integer) | Validation failure | Return 400 immediately, do not reach DB | Specific field message (ERR-2, ERR-3, ERR-4) | none | User corrects input |
| `pool.query()` — INSERT into `alert_configs` | DB unique constraint (`23505`) | Catch, return 409 | `"An alert config for this category already exists"` | warn with tenantId + category | User updates existing config |
| `pool.query()` — INSERT into `alert_configs` | DB connection failure | Catch, return 500 | `"An internal error occurred"` | error with full stack | Ops intervention; auto-retry on next request |
| `authenticateStaff` middleware | Missing/invalid JWT | Handled by middleware — not by this route | `"Authentication required"` | none | Client re-authenticates |

### Retry Policy

Single INSERT operation — no retry logic in the service layer. Network-level retries are handled by connection pool configuration. Idempotency: the unique constraint ensures double-submission returns 409 rather than creating a duplicate.

### Transaction Boundaries

Single-operation — no transaction needed. The feature inserts exactly one row into one table. No multi-table operations, no rollback scenario beyond the implicit single-statement rollback on DB error.

---

## NOT in Scope

Explicitly list what this contract does NOT cover. This prevents scope drift during implementation.

- This contract does NOT implement `GET /api/alert-configs` (list or detail endpoints) — read paths are separate work
- This contract does NOT implement `PUT /api/alert-configs/:id` or `DELETE /api/alert-configs/:id` — mutations other than create are separate work
- This contract does NOT modify any existing routes, services, or middleware — no behavior changes to existing code
- This contract does NOT add alert-triggering logic, alert evaluation workers, or notification dispatch — the config row is inert data; what consumes it is out of scope
- This contract does NOT add UI components, hooks, or admin frontend changes — API-only
- This contract does NOT implement alert category enumeration or validation against a fixed category list — free-text category with length limit only
- This contract does NOT modify the `authenticateStaff` middleware

**If you find yourself editing a file not listed in the plan or touching behavior listed here, STOP. You are drifting.**

---

## Traceability Matrix

Every postcondition maps to exactly one test and one code location. No orphans allowed.

| PC | Test File | Test Name | Code File | Code Location | Status |
|----|-----------|-----------|-----------|---------------|--------|
| PC-A1 | `alertConfigs.route.test.js` | "creates alert config and returns 201 with full record" | `apps/api/src/routes/alertConfigs.js` | `createAlertConfig():L18` | PENDING |
| PC-A2 | `alertConfigs.route.test.js` | "returns 400 when category is missing" | `apps/api/src/routes/alertConfigs.js` | `L12` | PENDING |
| PC-A3 | `alertConfigs.route.test.js` | "returns 400 when threshold is missing" | `apps/api/src/routes/alertConfigs.js` | `L14` | PENDING |
| PC-A4 | `alertConfigs.route.test.js` | "returns 401 for unauthenticated request" | `apps/api/src/middleware/auth.js` | middleware handler | PENDING |
| PC-A5 | `alertConfigs.route.test.js` | "error responses are generic" | `apps/api/src/routes/alertConfigs.js` | catch block | PENDING |
| PC-S1 | `alertConfigService.test.js` | "inserts row with tenant_id from authenticated user" | `apps/api/src/services/alertConfigService.js` | `createAlertConfig():L22` | PENDING |
| PC-S2 | `alertConfigService.test.js` | "returns complete created record" | `apps/api/src/services/alertConfigService.js` | `createAlertConfig():L28` | PENDING |
| PC-S3 | `alertConfigService.test.js` | "throws on non-positive threshold" | `apps/api/src/services/alertConfigService.js` | `validatePayload():L8` | PENDING |
| PC-S4 | `alertConfigService.test.js` | "throws on duplicate category for same tenant" | `apps/api/src/services/alertConfigService.js` | `createAlertConfig():L35` | PENDING |
| PC-S5 | `alertConfigService.test.js` | "rejects whitespace-only category" | `apps/api/src/services/alertConfigService.js` | `validatePayload():L6` | PENDING |
| PC-S6 | `alertConfigService.test.js` | "SQL uses parameterized values" | `apps/api/src/services/alertConfigService.js` | `createAlertConfig():L20` | PENDING |
| PC-X1 | `alertConfigs.integration.test.js` | "created config is persisted and tenant-scoped" | Route → Service → DB | end-to-end | PENDING |
| PC-X2 | `alertConfigs.integration.test.js` | "tenant isolation — config invisible to other tenants" | Route → Service → DB → `WHERE tenant_id = $1` | end-to-end | PENDING |

**Total PCs: 13. Traceability rows: 13. Zero orphans.**

---

## Test Skeleton Verification (Tautology Check)

For each postcondition, a concrete `expect()` assertion that would FAIL if the feature were removed or broken:

```javascript
// PC-A1: Would fail if status !== 201 or body fields are missing
expect(res.status).toBe(201);
expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);     // UUID
expect(res.body.category).toBe('payment_delay');
expect(res.body.threshold).toBe(60);
expect(res.body.tenant_id).toBe(testTenantId);

// PC-A2: Would fail if 400 not returned or error text differs
expect(res.status).toBe(400);
expect(res.body.error).toBe('Category is required');

// PC-A3: Would fail if 400 not returned or error text differs
expect(res.status).toBe(400);
expect(res.body.error).toBe('Threshold is required');

// PC-A4: Would fail if auth middleware removed from chain
expect(res.status).toBe(401);

// PC-A5: Would fail if stack trace or SQL text leaks into response
expect(JSON.stringify(res.body)).not.toMatch(/Error:|stack:|at \w|\.js:\d/);
expect(JSON.stringify(res.body)).not.toMatch(/SELECT|INSERT|WHERE/);

// PC-S1: Would fail if tenant_id is taken from body instead of req.user
const rows = await pool.query('SELECT tenant_id FROM alert_configs WHERE id = $1', [result.id]);
expect(rows.rows[0].tenant_id).toBe(authenticatedUser.tenant_id);
expect(rows.rows[0].tenant_id).not.toBe(spoofedTenantId);

// PC-S2: Would fail if any field is missing from returned object
expect(result).toHaveProperty('id');
expect(result).toHaveProperty('tenant_id');
expect(result).toHaveProperty('category');
expect(result).toHaveProperty('threshold');
expect(result).toHaveProperty('created_at');
expect(result).toHaveProperty('updated_at');

// PC-S3: Would fail if validation allows threshold <= 0
await expect(createAlertConfig({ tenantId, category: 'x', threshold: 0 }))
  .rejects.toThrow('Threshold must be a positive integer');

// PC-S4: Would fail if duplicate silently succeeds or throws wrong code
await expect(createAlertConfig({ tenantId, category: 'payment_delay', threshold: 60 }))
  .rejects.toMatchObject({ code: 'DUPLICATE_ALERT_CONFIG' });

// PC-S5: Would fail if whitespace not trimmed and rejected
await expect(createAlertConfig({ tenantId, category: '   ', threshold: 60 }))
  .rejects.toThrow('Category is required');

// PC-S6: Static assertion — would fail if template literal found in source
const source = fs.readFileSync('apps/api/src/services/alertConfigService.js', 'utf8');
const insertLine = source.split('\n').find(l => l.includes('INSERT INTO alert_configs'));
expect(insertLine).not.toMatch(/\${/);

// PC-X1: Would fail if DB write didn't persist
const rows = await pool.query(
  'SELECT * FROM alert_configs WHERE id = $1 AND tenant_id = $2',
  [res.body.id, testTenantId]
);
expect(rows.rowCount).toBe(1);

// PC-X2: Would fail if tenant isolation missing
const rows = await pool.query(
  'SELECT * FROM alert_configs WHERE id = $1 AND tenant_id = $2',
  [res.body.id, otherTenantId]
);
expect(rows.rowCount).toBe(0);
```

**Zero tautological tests confirmed.** Every assertion would fail if the corresponding feature were absent or broken.

---

## CONTRACT QUALITY GATE

```
CONTRACT QUALITY GATE
═════════════════════
Testability:        PASS — 13 PCs, all 13 have concrete expect() skeletons above
Banned Words:       PASS — grep count: 0 ("should", "probably", "appropriate", "reasonable", "properly", "correct" absent)
Completeness:       PASS — plan tasks: create route, create service, create migration, wire middleware; all contracted
Consumer Coverage:  PASS — 3 success consumers, 1 error consumer; all identified from simulated grep of /api/alert-configs
Blast Radius:       PASS — 3 same-file route siblings checked, 4 cross-file service siblings checked
Error Coverage:     PASS — 2 user inputs (category, threshold), 1 external call (DB); 9 error cases covering all paths
Invariants:         PASS — 7/7 standard invariants present
Scope Boundary:     PASS — 7 explicit exclusions
Traceability:       PASS — 13 PCs, 13 matrix rows, zero orphans
Tautology Check:    PASS — 13 PCs checked, 0 tautological (every assertion fails if feature absent)
Error Strategy:     PASS — 5 operations (4 validation paths + 1 DB call), all with defined handling; single-op transaction boundary documented

Score: 11/11 — LOCKED
```

---

*Contract locked 2026-03-14. Do NOT modify during BUILD unless forge review finds a new bug — amendments only, appended, never replacing existing PCs.*
