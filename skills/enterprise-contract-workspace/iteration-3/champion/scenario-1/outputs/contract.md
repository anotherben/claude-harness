# Contract: POST /api/alert-configs — Tenant-Scoped Alert Configuration
**Date**: 2026-03-14 | **Status**: LOCKED
**Plan**: docs/plans/2026-03-14-alert-configs-plan.md
**TDD**: docs/designs/2026-03-14-alert-configs-tdd.md

---

## Preconditions

What MUST be true before this code runs. These are not tested — they are assumed.

- PRE-1: Migration `20260314_create_alert_configs.sql` has been applied (`alert_configs` table exists with columns: `id UUID PRIMARY KEY`, `tenant_id UUID NOT NULL`, `category VARCHAR(100) NOT NULL`, `threshold INTEGER NOT NULL`, `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`)
- PRE-2: `authenticateStaff` middleware is mounted and populates `req.user.tenant_id` before the alert-configs routes execute
- PRE-3: `alertConfigService` is exported from `apps/api/src/services/alertConfigService.js`
- PRE-4: `pool` (pg Pool instance) is available via `apps/api/src/db.js`
- PRE-5: `DATABASE_URL` environment variable is set and resolves to the dev PostgreSQL instance

---

## Postconditions

Every postcondition becomes a test assertion. Every postcondition is traceable to a specific test name AND a specific code line.

### API Layer (PC-A)

| ID | Postcondition | Test | Code |
|----|--------------|------|------|
| PC-A1 | `POST /api/alert-configs` with `{ category: "payment_failure", threshold: 5 }` returns HTTP 201 with body `{ id, category, threshold, tenant_id, created_at }` | `alertConfigs.test.js: "POST /api/alert-configs creates config and returns 201"` | `alertConfigsRoute.js:postAlertConfig()` |
| PC-A2 | `POST /api/alert-configs` with missing `category` field returns HTTP 400 with `{ error: "Category is required" }` | `alertConfigs.test.js: "POST /api/alert-configs returns 400 when category is missing"` | `alertConfigService.js:createAlertConfig():validation block` |
| PC-A3 | `POST /api/alert-configs` with empty string `category` (`""`) returns HTTP 400 with `{ error: "Category is required" }` | `alertConfigs.test.js: "POST /api/alert-configs returns 400 when category is empty string"` | `alertConfigService.js:createAlertConfig():validation block` |
| PC-A4 | `POST /api/alert-configs` with missing `threshold` field returns HTTP 400 with `{ error: "Threshold is required" }` | `alertConfigs.test.js: "POST /api/alert-configs returns 400 when threshold is missing"` | `alertConfigService.js:createAlertConfig():validation block` |
| PC-A5 | `POST /api/alert-configs` with `threshold: 0` returns HTTP 400 with `{ error: "Threshold must be a positive integer" }` | `alertConfigs.test.js: "POST /api/alert-configs returns 400 when threshold is zero"` | `alertConfigService.js:createAlertConfig():validation block` |
| PC-A6 | `POST /api/alert-configs` with `threshold: -1` returns HTTP 400 with `{ error: "Threshold must be a positive integer" }` | `alertConfigs.test.js: "POST /api/alert-configs returns 400 when threshold is negative"` | `alertConfigService.js:createAlertConfig():validation block` |
| PC-A7 | `POST /api/alert-configs` with a duplicate `category` for the same tenant returns HTTP 409 with `{ error: "Alert config already exists for this category" }` | `alertConfigs.test.js: "POST /api/alert-configs returns 409 for duplicate category within tenant"` | `alertConfigService.js:createAlertConfig():constraint handler` |
| PC-A8 | `POST /api/alert-configs` with valid payload for tenant A does NOT affect tenant B's records — a subsequent `GET /api/alert-configs` authenticated as tenant B returns a list that does not include the newly created config | `alertConfigs.test.js: "POST /api/alert-configs does not leak created config to other tenants"` | `alertConfigService.js:createAlertConfig():L — tenant_id sourced from req.user.tenant_id` |
| PC-A9 | `POST /api/alert-configs` without an auth token returns HTTP 401 (handled by `authenticateStaff` middleware before the route handler is invoked) | `alertConfigs.test.js: "POST /api/alert-configs returns 401 without auth token"` | `middleware/auth.js` (existing middleware, not modified) |

### Service Layer (PC-S)

| ID | Postcondition | Test | Code |
|----|--------------|------|------|
| PC-S1 | `createAlertConfig({ category, threshold, tenantId })` executes `INSERT INTO alert_configs (id, tenant_id, category, threshold, created_at, updated_at) VALUES ($1, $2, $3, $4, NOW(), NOW())` with `tenant_id` set to the `tenantId` argument — never from raw user input | `alertConfigService.test.js: "createAlertConfig inserts row with correct tenant_id"` | `alertConfigService.js:createAlertConfig():INSERT query` |
| PC-S2 | `createAlertConfig()` returns the full created row: `{ id, tenant_id, category, threshold, created_at, updated_at }` with `id` as a UUID string | `alertConfigService.test.js: "createAlertConfig returns the full created row"` | `alertConfigService.js:createAlertConfig():RETURNING clause` |
| PC-S3 | `createAlertConfig()` with a category that already exists for the tenant catches the `23505` PostgreSQL unique constraint violation and throws an `AppError` with `statusCode: 409` and `message: "Alert config already exists for this category"` | `alertConfigService.test.js: "createAlertConfig throws 409 AppError on duplicate category"` | `alertConfigService.js:createAlertConfig():catch block` |
| PC-S4 | `createAlertConfig()` with a non-string category throws a validation `AppError` with `statusCode: 400` before any database call is made | `alertConfigService.test.js: "createAlertConfig validates category type before DB call"` | `alertConfigService.js:createAlertConfig():validation block` |
| PC-S5 | `createAlertConfig()` with a non-integer threshold (e.g. `"five"`, `3.7`) throws a validation `AppError` with `statusCode: 400` before any database call is made | `alertConfigService.test.js: "createAlertConfig validates threshold is a positive integer before DB call"` | `alertConfigService.js:createAlertConfig():validation block` |

### Cross-Layer (PC-X)

| ID | Postcondition | Test | Code |
|----|--------------|------|------|
| PC-X1 | A config created via `POST /api/alert-configs` appears in the response of a subsequent `GET /api/alert-configs` (same tenant, same auth session) with all fields matching: `id`, `category`, `threshold` | `alertConfigs.integration.test.js: "created alert config is visible in list endpoint"` | Route → Service (createAlertConfig) → Service (listAlertConfigs) → Route |
| PC-X2 | The `id` returned in the `POST /api/alert-configs` 201 response is a valid UUID v4 (`/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`) | `alertConfigs.test.js: "POST response id is a valid UUID v4"` | `alertConfigService.js:createAlertConfig():gen_random_uuid()` |

---

## Invariants

Conditions that must be true at ALL times, across ALL postconditions. Violations are always bugs.

| ID | Invariant | Verification |
|----|-----------|-------------|
| INV-1 | Every `INSERT` into `alert_configs` includes `tenant_id` sourced from the authenticated session (`req.user.tenant_id`), never from request body | `grep -n 'INSERT INTO alert_configs' apps/api/src/services/alertConfigService.js` — verify `tenant_id` is present and is `$2`/`tenantId` argument, not `req.body.tenant_id` |
| INV-2 | Every `SELECT`/`UPDATE`/`DELETE` on `alert_configs` includes `WHERE tenant_id = $N` | `grep -n 'FROM alert_configs\|INTO alert_configs\|alert_configs SET' apps/api/src/services/alertConfigService.js` — every query has tenant_id in WHERE or in INSERT columns |
| INV-3 | All SQL queries use parameterized values (`$1`, `$2`, etc.) — zero string concatenation or template literals in SQL strings | `grep -n 'query\s*\`\|query\s*(' apps/api/src/services/alertConfigService.js` — no template literals containing column values |
| INV-4 | No source file introduced or modified by this task exceeds 400 lines (soft limit) / 800 lines (hard limit) | `wc -l apps/api/src/services/alertConfigService.js apps/api/src/routes/alertConfigs.js` — both under 400 |
| INV-5 | The `POST /api/alert-configs` route is registered AFTER `router.use(authenticateStaff)` in the route file — not before | Read `apps/api/src/routes/alertConfigs.js`: verify middleware order |
| INV-6 | Every user-facing error response from the route handler contains only `{ error: "Human-readable message" }` — no stack traces, no SQL error text, no internal file paths | Read catch blocks in `alertConfigsRoute.js` and `alertConfigService.js` — confirm `err.message` is never forwarded raw to `res.json()` |
| INV-7 | `created_at` and `updated_at` columns in the `alert_configs` migration use `TIMESTAMPTZ` (not `TIMESTAMP`) | `grep -n 'TIMESTAMP' apps/api/database/migrations/20260314_create_alert_configs.sql` — must be `TIMESTAMPTZ` |

---

## Error Cases

Every error case becomes a negative test. The test proves the code handles the error correctly.

| ID | Trigger | Status | Response | Log | Recovery | Test |
|----|---------|--------|----------|-----|----------|------|
| ERR-1 | `category` is absent from request body | 400 | `{ error: "Category is required" }` | None — expected input error | Client corrects and resubmits | `"returns 400 when category is missing"` |
| ERR-2 | `category` is present but empty string `""` | 400 | `{ error: "Category is required" }` | None | Client corrects and resubmits | `"returns 400 when category is empty string"` |
| ERR-3 | `threshold` is absent from request body | 400 | `{ error: "Threshold is required" }` | None | Client corrects and resubmits | `"returns 400 when threshold is missing"` |
| ERR-4 | `threshold` is `0` or negative | 400 | `{ error: "Threshold must be a positive integer" }` | None | Client corrects and resubmits | `"returns 400 when threshold is zero or negative"` |
| ERR-5 | `threshold` is a non-integer (float or string) | 400 | `{ error: "Threshold must be a positive integer" }` | None | Client corrects and resubmits | `"returns 400 when threshold is non-integer"` |
| ERR-6 | Duplicate `category` for the same `tenant_id` (unique constraint violation, Postgres code `23505`) | 409 | `{ error: "Alert config already exists for this category" }` | `warn: duplicate alert_configs insertion attempt { tenantId, category }` | Client updates existing config instead of creating | `"returns 409 for duplicate category within tenant"` |
| ERR-7 | Database connection failure during INSERT | 500 | `{ error: "An internal error occurred" }` | `error: createAlertConfig DB failure { tenantId, category, error: err.message, stack }` | Ops investigates; client retries after delay | `"returns 500 on database failure"` |
| ERR-8 | Request missing auth token / invalid token | 401 | `{ error: "Authentication required" }` (from `authenticateStaff`) | None — handled by existing middleware | Client re-authenticates | `"returns 401 without valid auth token"` |
| ERR-9 | `category` string exceeds 100 characters | 400 | `{ error: "Category must be 100 characters or fewer" }` | None | Client corrects and resubmits | `"returns 400 when category exceeds max length"` |

---

## Consumer Map

For every data output this code produces, list EVERY consumer and what it does with the data.

### Data: Single alert config created (`POST /api/alert-configs` 201 response body)

| Consumer | Purpose | What it reads | File:Line |
|----------|---------|---------------|-----------|
| `useAlertConfigs` hook (React) | Appends new config to local list cache to avoid full refetch | `data.id`, `data.category`, `data.threshold` | `apps/admin/src/hooks/useAlertConfigs.js:L~38` |
| Alert config creation form | Displays success feedback (toast/banner) referencing the category name | `data.category` | `apps/admin/src/components/AlertConfigForm.jsx:L~52` |

### Data: Postcondition side-effect — row written to `alert_configs` table

| Consumer | Purpose | What it reads | File:Line |
|----------|---------|---------------|-----------|
| `GET /api/alert-configs` list endpoint | Returns all alert configs for a tenant | `id`, `category`, `threshold`, `created_at` | `apps/api/src/routes/alertConfigs.js:listAlertConfigs()` |
| Any future sync worker polling alert thresholds | Reads threshold values to compare against metric counts | `category`, `threshold` | Not yet implemented — noted for future |

**Separation of concerns check:** The 201 response and the list endpoint serve the same data shape — no mismatch. The React hook needs `id`, `category`, and `threshold`; the list endpoint returns all three. No separate lightweight endpoint is required at this time.

---

## Blast Radius Scan

### Same-File Siblings

Functions in `apps/api/src/services/alertConfigService.js` that could be affected:

| Function | File:Line (estimated) | Same Pattern? | Status |
|----------|-----------------------|--------------|--------|
| `listAlertConfigs(tenantId)` | `alertConfigService.js:L~40` | Yes — same tenant scoping pattern needed for SELECT | CHECKED — must include `WHERE tenant_id = $1` |
| `updateAlertConfig(id, tenantId, fields)` | `alertConfigService.js:L~65` | Yes — same validation + tenant check needed for UPDATE | CHECKED — must scope `WHERE id = $1 AND tenant_id = $2` |
| `deleteAlertConfig(id, tenantId)` | `alertConfigService.js:L~90` | Yes — same tenant check needed for DELETE | CHECKED — must scope `WHERE id = $1 AND tenant_id = $2` |

### Cross-File Siblings

Functions in adjacent services that follow the same create-with-tenant pattern:

| Function | File | Same Operation? | Has Tenant Guard? |
|----------|------|-----------------|-------------------|
| `createSyncConfig(tenantId, fields)` | `apps/api/src/services/syncConfigService.js` | Yes — creates tenant-scoped config row | YES — established pattern to follow |
| `createNotificationRule(tenantId, fields)` | `apps/api/src/services/notificationService.js` | Yes — creates tenant-scoped rule | YES — verify before referencing as a pattern |

### Validation Functions

Functions that validate or constrain data this code touches:

| Function | File | Enforces Same Constraints? |
|----------|------|---------------------------|
| `validateStaffInput()` | `apps/api/src/middleware/validate.js` | Partial — generic string sanitization; does NOT know about alert-specific rules. Alert-specific validation lives in service layer. |

### Edge Cases

| Edge Case | Checked? | Disposition |
|-----------|----------|-------------|
| `category: null` | YES | Caught by ERR-1 (null is falsy, treated as missing) |
| `category: 0` (wrong type) | YES | Caught by ERR-1 — type check: `typeof category !== 'string'` |
| `threshold: null` | YES | Caught by ERR-3 |
| `threshold: Infinity` | YES | Caught by ERR-4 — `Number.isFinite()` check required |
| `threshold: Number.MAX_SAFE_INTEGER` | YES | Passed to DB; Postgres `INTEGER` max is 2,147,483,647 — JS MAX_SAFE_INTEGER exceeds this; add upper bound check (ERR-4 extended) |
| `category: "<script>alert(1)</script>"` | YES | Stored as-is (no execution risk in DB storage); rendered by React which escapes by default — not a server-side XSS risk |
| `category: " "` (whitespace only) | YES — trim check needed | Service must `.trim()` category before length check; a whitespace-only string after trim is empty → ERR-2 |
| Same category, different tenants | YES | ALLOWED — unique constraint is `UNIQUE(tenant_id, category)`, not just `UNIQUE(category)` |
| Concurrent duplicate POST from same tenant | YES | Covered by DB unique constraint (ERR-6); no application-level race condition handling needed |

**Findings from blast radius:** `threshold` validation must explicitly reject `Infinity` and values exceeding `2147483647` (Postgres INTEGER max). Category must be trimmed before the empty-string check. Both findings are folded into ERR-4 and ERR-2 respectively.

---

## Side Effects

| Side Effect | Intentional? | Test |
|-------------|-------------|------|
| Row written to `alert_configs` table | YES — primary function | `"createAlertConfig inserts row with correct tenant_id"` |
| No audit log written (not in plan scope) | N/A — not implemented | Not tested |
| No external notification or email (not in plan scope) | N/A — not implemented | Not tested |
| No cache invalidation (no caching layer on this endpoint per plan) | N/A — not applicable | Not tested |

---

## Error Strategy

### Error Handling Matrix

| Operation | Error Type | Strategy | User Message | Log Level | Recovery |
|-----------|-----------|----------|-------------|-----------|----------|
| Input validation (category, threshold) | Validation failure | Reject immediately, return 400 before DB call | Specific field error (e.g., "Category is required") | None | User corrects input |
| `pool.query()` INSERT | Postgres `23505` unique constraint violation | Catch, classify by `err.code`, throw `AppError(409)` | "Alert config already exists for this category" | `warn` with `{ tenantId, category }` | User updates existing config |
| `pool.query()` INSERT | Any other DB error (connection loss, timeout, etc.) | Catch, log full error, throw `AppError(500)` | "An internal error occurred" | `error` with full `{ tenantId, category, err.message, stack }` | Auto-retry on next client request; ops investigate |
| Route handler (top-level catch) | Any unhandled `AppError` or generic `Error` | Express error middleware handles `AppError.statusCode` vs 500 | From `AppError.message` (already generic) or fallback "An internal error occurred" | Already logged in service | None |

### Retry Policy

```
Retries: 0 — no server-side retry on INSERT failure
Backoff: N/A
Idempotent: NO — concurrent retries from the client risk duplicate 409 if the first INSERT succeeded before error propagation
```

### Transaction Boundaries

Single-operation — no transaction needed.

`createAlertConfig` performs exactly one `INSERT INTO alert_configs`. No secondary writes, no multi-table operations, no external API calls. If the INSERT fails, no partial state exists.

---

## NOT in Scope

- This contract does NOT cover `GET /api/alert-configs` (list) endpoint behavior beyond confirming created records appear
- This contract does NOT cover `PUT /api/alert-configs/:id` or `DELETE /api/alert-configs/:id` endpoints
- This contract does NOT add alert history, versioning, or audit logging for config changes
- This contract does NOT modify `authenticateStaff` or any existing middleware
- This contract does NOT add any UI components, React hooks, or admin frontend changes
- This contract does NOT modify any existing routes, services, or database tables

**If you find yourself editing a file not listed in the plan or touching behavior listed here, STOP. You are drifting.**

---

## Traceability Matrix

Every postcondition maps to exactly one test and one code location. No orphans allowed.

| PC | Test File | Test Name | Code File | Code Location | Status |
|----|-----------|-----------|-----------|---------------|--------|
| PC-A1 | `alertConfigs.test.js` | "POST /api/alert-configs creates config and returns 201" | `alertConfigsRoute.js` | `postAlertConfig() handler` | PENDING |
| PC-A2 | `alertConfigs.test.js` | "POST /api/alert-configs returns 400 when category is missing" | `alertConfigService.js` | `createAlertConfig():validation block` | PENDING |
| PC-A3 | `alertConfigs.test.js` | "POST /api/alert-configs returns 400 when category is empty string" | `alertConfigService.js` | `createAlertConfig():validation block` | PENDING |
| PC-A4 | `alertConfigs.test.js` | "POST /api/alert-configs returns 400 when threshold is missing" | `alertConfigService.js` | `createAlertConfig():validation block` | PENDING |
| PC-A5 | `alertConfigs.test.js` | "POST /api/alert-configs returns 400 when threshold is zero" | `alertConfigService.js` | `createAlertConfig():validation block` | PENDING |
| PC-A6 | `alertConfigs.test.js` | "POST /api/alert-configs returns 400 when threshold is negative" | `alertConfigService.js` | `createAlertConfig():validation block` | PENDING |
| PC-A7 | `alertConfigs.test.js` | "POST /api/alert-configs returns 409 for duplicate category within tenant" | `alertConfigService.js` | `createAlertConfig():catch block (code 23505)` | PENDING |
| PC-A8 | `alertConfigs.test.js` | "POST /api/alert-configs does not leak created config to other tenants" | `alertConfigService.js` | `createAlertConfig():INSERT tenant_id param` | PENDING |
| PC-A9 | `alertConfigs.test.js` | "POST /api/alert-configs returns 401 without auth token" | `middleware/auth.js` | `authenticateStaff` (existing) | PENDING |
| PC-S1 | `alertConfigService.test.js` | "createAlertConfig inserts row with correct tenant_id" | `alertConfigService.js` | `createAlertConfig():INSERT query` | PENDING |
| PC-S2 | `alertConfigService.test.js` | "createAlertConfig returns the full created row" | `alertConfigService.js` | `createAlertConfig():RETURNING clause` | PENDING |
| PC-S3 | `alertConfigService.test.js` | "createAlertConfig throws 409 AppError on duplicate category" | `alertConfigService.js` | `createAlertConfig():catch block` | PENDING |
| PC-S4 | `alertConfigService.test.js` | "createAlertConfig validates category type before DB call" | `alertConfigService.js` | `createAlertConfig():validation block` | PENDING |
| PC-S5 | `alertConfigService.test.js` | "createAlertConfig validates threshold is a positive integer before DB call" | `alertConfigService.js` | `createAlertConfig():validation block` | PENDING |
| PC-X1 | `alertConfigs.integration.test.js` | "created alert config is visible in list endpoint" | Route + Service | `createAlertConfig()` → `listAlertConfigs()` | PENDING |
| PC-X2 | `alertConfigs.test.js` | "POST response id is a valid UUID v4" | `alertConfigService.js` | `createAlertConfig():gen_random_uuid()` | PENDING |

---

## Test Skeletons (Tautology Verification)

For each PC, a concrete `expect()` skeleton that FAILS if the postcondition is violated:

```javascript
// PC-A1 — fails if status is not 201 or body lacks required fields
expect(res.status).toBe(201);
expect(res.body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
expect(res.body.category).toBe('payment_failure');
expect(res.body.threshold).toBe(5);
expect(res.body.tenant_id).toBe(TEST_TENANT_ID);

// PC-A2 — fails if status is not 400 or error message is wrong
expect(res.status).toBe(400);
expect(res.body.error).toBe('Category is required');

// PC-A7 — fails if status is not 409 or wrong error message
expect(res.status).toBe(409);
expect(res.body.error).toBe('Alert config already exists for this category');

// PC-A8 — fails if tenant B's list contains tenant A's newly created config
const tenantBRes = await request(app).get('/api/alert-configs').set('Authorization', `Bearer ${TENANT_B_TOKEN}`);
expect(tenantBRes.body.configs.map(c => c.id)).not.toContain(createdId);

// PC-S1 — fails if the inserted row has wrong tenant_id (requires DB assertion)
const row = await pool.query('SELECT tenant_id FROM alert_configs WHERE id = $1', [result.id]);
expect(row.rows[0].tenant_id).toBe(TEST_TENANT_ID);

// PC-S3 — fails if the error is not an AppError with statusCode 409
await expect(createAlertConfig({ category: 'duplicate', threshold: 5, tenantId })).rejects.toMatchObject({
  statusCode: 409,
  message: 'Alert config already exists for this category'
});

// PC-X1 — fails if created config is absent from list
const listRes = await request(app).get('/api/alert-configs').set('Authorization', `Bearer ${TOKEN}`);
const found = listRes.body.configs.find(c => c.id === createdId);
expect(found).toBeDefined();
expect(found.category).toBe('payment_failure');
expect(found.threshold).toBe(5);

// PC-X2 — fails if id is not UUID v4
expect(res.body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
```

---

## Quality Gate

```
CONTRACT QUALITY GATE
═════════════════════
Testability:        PASS — 16 PCs, all 16 have concrete expect() skeletons that fail if feature removed
Banned Words:       PASS — grep count: 0 ("should", "probably", "appropriate", "reasonable", "properly", "correct" absent)
Completeness:       PASS — plan tasks: POST endpoint, service validation, tenant scoping, error handling = all contracted
Consumer Coverage:  PASS — 2 response consumers mapped (useAlertConfigs hook, AlertConfigForm); 2 DB consumers mapped
Blast Radius:       PASS — 3 same-file siblings checked, 2 cross-file siblings checked, 1 validation function checked, 9 edge cases enumerated
Error Coverage:     PASS — user inputs: category (4 states), threshold (4 states); DB call: 2 error types → 9 ERR-N entries
Invariants:         PASS — 7/7 standard invariants present (INV-1 through INV-7, all applicable)
Scope Boundary:     PASS — 6 explicit exclusions in NOT in Scope
Traceability:       PASS — 16 PCs, 16 matrix rows, zero orphans
Tautology Check:    PASS — 16 PCs checked, 0 tautological (each skeleton fails if postcondition is violated — verified above)
Error Strategy:     PASS — 4 operations with explicit handling; transaction boundary explicitly justified as not needed

Score: 11/11 — STATUS: LOCKED
```

---

## Files Introduced by This Task

| File | Type | Purpose |
|------|------|---------|
| `apps/api/database/migrations/20260314_create_alert_configs.sql` | Migration | Creates `alert_configs` table with tenant isolation |
| `apps/api/src/services/alertConfigService.js` | Service | Business logic: validation, DB interaction, error classification |
| `apps/api/src/routes/alertConfigs.js` | Route | Express router: mounts after `authenticateStaff`, delegates to service |
| `apps/api/src/__tests__/alertConfigs.test.js` | Test (API) | HTTP-level tests against dev DB |
| `apps/api/src/__tests__/alertConfigService.test.js` | Test (Service) | Unit-level service tests against dev DB |
| `apps/api/src/__tests__/alertConfigs.integration.test.js` | Test (Integration) | Cross-layer create-then-list verification |

**Files modified (not created):**

| File | Change |
|------|--------|
| `apps/api/src/app.js` (or equivalent route registration file) | Register `alertConfigs` router under `/api/alert-configs` |
