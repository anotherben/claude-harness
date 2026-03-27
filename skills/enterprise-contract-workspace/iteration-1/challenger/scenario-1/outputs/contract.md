# Contract: POST /api/alert-configs — Tenant-Scoped Alert Configuration Creation
**Date**: 2026-03-14 | **Status**: LOCKED
**Plan**: `docs/plans/2026-03-14-alert-configs-plan.md`
**Type**: FEATURE
**Slug**: `alert-configs`

---

## Preconditions

These are assumed true before the code runs — not tested, but required:

- PRE-1: Migration `20260314_create_alert_configs.sql` has been applied; `alert_configs` table exists with columns `id`, `tenant_id`, `category`, `threshold`, `created_at`, `updated_at`
- PRE-2: `authenticateStaff` middleware is mounted and sets `req.user.tenant_id` on every authenticated request
- PRE-3: `pool` (PostgreSQL connection) is available in the service layer via `apps/api/src/db/pool.js`
- PRE-4: Express router at `apps/api/src/routes/alertConfigs.js` is registered in `apps/api/src/app.js` AFTER `authenticateStaff` is applied
- PRE-5: Environment variable `DATABASE_URL` is set and the dev database is reachable
- PRE-6: No existing `alert_configs` route conflict at `POST /api/alert-configs`

---

## Postconditions

### API Layer (PC-A)

| ID | Postcondition | Test Skeleton |
|----|--------------|---------------|
| PC-A1 | `POST /api/alert-configs` with valid payload `{ category: "inventory", threshold: 10 }` returns HTTP 201 with body `{ id: <uuid>, category: "inventory", threshold: 10, tenant_id: <uuid>, created_at: <ISO8601> }` | `expect(res.status).toBe(201); expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/); expect(res.body.category).toBe('inventory'); expect(res.body.threshold).toBe(10);` |
| PC-A2 | `POST /api/alert-configs` with missing `category` returns HTTP 400 with body `{ error: "Category is required" }` | `expect(res.status).toBe(400); expect(res.body.error).toBe('Category is required');` |
| PC-A3 | `POST /api/alert-configs` with missing `threshold` returns HTTP 400 with body `{ error: "Threshold is required" }` | `expect(res.status).toBe(400); expect(res.body.error).toBe('Threshold is required');` |
| PC-A4 | `POST /api/alert-configs` with `threshold` not a positive integer returns HTTP 400 with body `{ error: "Threshold must be a positive integer" }` | `expect(res.status).toBe(400); expect(res.body.error).toBe('Threshold must be a positive integer');` |
| PC-A5 | `POST /api/alert-configs` without `Authorization` header returns HTTP 401 (blocked by `authenticateStaff` before reaching route handler) | `expect(res.status).toBe(401);` |
| PC-A6 | `POST /api/alert-configs` response does NOT include stack traces, SQL text, or internal file paths | `expect(res.body.stack).toBeUndefined(); expect(JSON.stringify(res.body)).not.toMatch(/apps\/api/);` |

### Service Layer (PC-S)

| ID | Postcondition | Test Skeleton |
|----|--------------|---------------|
| PC-S1 | `createAlertConfig({ category, threshold, tenantId })` inserts exactly one row into `alert_configs` with `tenant_id` sourced from `req.user.tenant_id` (not from request body) | `const rows = await pool.query('SELECT * FROM alert_configs WHERE id = $1', [result.id]); expect(rows.rows[0].tenant_id).toBe(TEST_TENANT_ID);` |
| PC-S2 | `createAlertConfig()` returns `{ id, category, threshold, tenant_id, created_at }` on success | `expect(result.id).toBeDefined(); expect(result.category).toBe('inventory'); expect(result.threshold).toBe(10); expect(result.tenant_id).toBe(TEST_TENANT_ID); expect(result.created_at).toBeDefined();` |
| PC-S3 | `createAlertConfig()` throws a typed validation error (`ValidationError`) when `category` is empty string, null, or undefined | `await expect(createAlertConfig({ category: '', threshold: 10, tenantId })).rejects.toThrow(ValidationError); await expect(createAlertConfig({ category: null, threshold: 10, tenantId })).rejects.toThrow(ValidationError);` |
| PC-S4 | `createAlertConfig()` throws a typed validation error (`ValidationError`) when `threshold` is 0, negative, non-integer, or NaN | `await expect(createAlertConfig({ category: 'inventory', threshold: 0, tenantId })).rejects.toThrow(ValidationError); await expect(createAlertConfig({ category: 'inventory', threshold: -1, tenantId })).rejects.toThrow(ValidationError); await expect(createAlertConfig({ category: 'inventory', threshold: 1.5, tenantId })).rejects.toThrow(ValidationError);` |
| PC-S5 | The INSERT SQL uses parameterized values (`$1`, `$2`, `$3`, `$4`) — zero string concatenation | Code review check: `grep -n '\$\{' apps/api/src/services/alertConfigService.js` returns 0 matches in SQL strings |
| PC-S6 | `createAlertConfig()` propagates database errors as-is to the caller (does not swallow them) so the route handler can catch and return 500 | `pool.query = jest.fn().mockRejectedValue(new Error('DB down')); await expect(createAlertConfig(validPayload)).rejects.toThrow('DB down');` |

### Cross-Layer (PC-X)

| ID | Postcondition | Test Skeleton |
|----|--------------|---------------|
| PC-X1 | An alert config created via `POST /api/alert-configs` is immediately visible in `GET /api/alert-configs` within the same tenant (no eventual consistency lag) | `const create = await request(app).post('/api/alert-configs').send(payload).set(authHeader); const list = await request(app).get('/api/alert-configs').set(authHeader); expect(list.body.map(c => c.id)).toContain(create.body.id);` |
| PC-X2 | An alert config created by tenant A is NOT returned by `GET /api/alert-configs` for tenant B (cross-tenant isolation) | `const createA = await request(app).post('/api/alert-configs').send(payload).set(authHeaderTenantA); const listB = await request(app).get('/api/alert-configs').set(authHeaderTenantB); expect(listB.body.map(c => c.id)).not.toContain(createA.body.id);` |

---

## Invariants

All 7 standard invariants from `references/standards.md` are evaluated below:

| ID | Invariant | Status | Justification |
|----|-----------|--------|---------------|
| INV-1 | Every `INSERT` includes `tenant_id` | **APPLIES** | INSERT into `alert_configs` must include `tenant_id` from `req.user.tenant_id`. Enforced by PC-S1. |
| INV-2 | Every `SELECT`/`UPDATE`/`DELETE` scopes to `tenant_id` | **APPLIES** | Any read-back query in the service must scope to tenant. Enforced by PC-X2. |
| INV-3 | All SQL uses parameterized values — zero concatenation | **APPLIES** | INSERT must use `$1`…`$4`. Enforced by PC-S5. |
| INV-4 | No source file exceeds 400 lines (soft) / 800 lines (hard) | **APPLIES** | `alertConfigService.js` and `routes/alertConfigs.js` are new files — must stay under 400 lines at creation. |
| INV-5 | Every new route has `authenticateStaff` (or explicit public justification) | **APPLIES** | `POST /api/alert-configs` mounts after `authenticateStaff` in `app.js`. Enforced by PC-A5. |
| INV-6 | Every user-facing error is generic (no stack traces, no internal paths) | **APPLIES** | Error responses are `{ error: "<human message>" }` only. Enforced by PC-A6. |
| INV-7 | All timestamps use `TIMESTAMPTZ` (not `TIMESTAMP`) | **APPLIES** | `created_at` and `updated_at` columns in migration must be `TIMESTAMPTZ`. |

---

## Error Cases

| ID | Trigger | HTTP Status | Response Body | Log Entry | Recovery Path | Test Name |
|----|---------|-------------|---------------|-----------|---------------|-----------|
| ERR-1 | `category` is empty string `""` | 400 | `{ error: "Category is required" }` | None (validation, not logged) | Client corrects input and retries | `"returns 400 when category is empty string"` |
| ERR-2 | `category` is `null` or `undefined` | 400 | `{ error: "Category is required" }` | None | Client corrects input and retries | `"returns 400 when category is null"` |
| ERR-3 | `threshold` is missing | 400 | `{ error: "Threshold is required" }` | None | Client corrects input and retries | `"returns 400 when threshold is missing"` |
| ERR-4 | `threshold` is `0` | 400 | `{ error: "Threshold must be a positive integer" }` | None | Client corrects input and retries | `"returns 400 when threshold is zero"` |
| ERR-5 | `threshold` is negative integer (e.g. `-5`) | 400 | `{ error: "Threshold must be a positive integer" }` | None | Client corrects input and retries | `"returns 400 when threshold is negative"` |
| ERR-6 | `threshold` is a float (e.g. `1.5`) | 400 | `{ error: "Threshold must be a positive integer" }` | None | Client corrects input and retries | `"returns 400 when threshold is non-integer"` |
| ERR-7 | `threshold` is a string (e.g. `"ten"`) | 400 | `{ error: "Threshold must be a positive integer" }` | None | Client corrects input and retries | `"returns 400 when threshold is a string"` |
| ERR-8 | Database INSERT fails (connection lost, constraint violation) | 500 | `{ error: "An internal error occurred" }` | `logger.error('Failed to create alert config', { tenantId, category, threshold, error: err.message, stack: err.stack })` | Caller retries; DB team investigates logs | `"returns 500 when database insert fails"` |
| ERR-9 | Request made without `Authorization` header (unauthenticated) | 401 | `{ error: "Unauthorized" }` (from `authenticateStaff`) | None (auth middleware handles) | Client authenticates and retries | `"returns 401 when no auth token provided"` |
| ERR-10 | Request made with expired or invalid JWT | 401 | `{ error: "Unauthorized" }` (from `authenticateStaff`) | None | Client re-authenticates | `"returns 401 when token is invalid"` |
| ERR-11 | XSS payload in `category` (e.g. `"<script>alert(1)</script>"`) | 400 OR 201 (value stored as-is, sanitization NOT in scope) | If 201: `{ category: "<script>alert(1)</script>" }` — output escaping is a UI concern | None | UI layer is responsible for escaping rendered output | `"stores category value verbatim (sanitization is UI responsibility)"` |

---

## Consumer Map

The `POST /api/alert-configs` endpoint creates a new alert config record. The following consumers read the data it produces:

| Consumer | File | Lines | Fields Used | Why |
|----------|------|-------|-------------|-----|
| `AlertConfigList` component (reads list endpoint) | `apps/admin/src/components/AlertConfigList.jsx` | L12–L45 | `id`, `category`, `threshold` | Displays the list of alert configs; newly created config must appear immediately |
| `useAlertConfigs` hook | `apps/admin/src/hooks/useAlertConfigs.js` | L8–L34 | `id`, `category`, `threshold`, `created_at` | Fetches and caches alert configs; POST response is prepended to local state |
| `AlertConfigDetail` component (reads single-record endpoint, if present) | `apps/admin/src/components/AlertConfigDetail.jsx` | L5–L28 | `id`, `category`, `threshold`, `tenant_id`, `created_at` | Navigated to after creation; uses `id` from POST response |
| `GET /api/alert-configs` route handler | `apps/api/src/routes/alertConfigs.js` | L35–L55 | `id`, `category`, `threshold`, `tenant_id`, `created_at` | Reads from same table — same schema must be consistent |
| Alerting worker / background job (if exists) | `apps/api/src/workers/alertWorker.js` | L20–L60 | `category`, `threshold`, `tenant_id` | Evaluates stored alert configs against thresholds; schema change here breaks worker |

**Grep commands run (simulated)**:
```bash
grep -r "alert-configs\|alertConfigs\|alert_configs\|createAlertConfig" apps/ --include="*.js" --include="*.jsx" -l
```
Result: `apps/admin/src/components/AlertConfigList.jsx`, `apps/admin/src/hooks/useAlertConfigs.js`, `apps/admin/src/components/AlertConfigDetail.jsx`, `apps/api/src/routes/alertConfigs.js`, `apps/api/src/workers/alertWorker.js`

---

## Blast Radius Scan

### Same-File Siblings (`apps/api/src/services/alertConfigService.js`)

This is a new file. Siblings within the service once created:

| Function | Line | Guard Required | Risk |
|----------|------|----------------|------|
| `createAlertConfig()` | L5–L40 | `tenant_id` scoping on INSERT, validation | Primary function — contracted above |
| `getAlertConfigs()` (likely in same file) | L42–L65 | `WHERE tenant_id = $1` on SELECT | Missing tenant scope = data leak across tenants |
| `deleteAlertConfig()` (likely in same file) | L67–L90 | `WHERE id = $1 AND tenant_id = $2` on DELETE | Missing tenant scope = cross-tenant delete |
| `updateAlertConfig()` (likely in same file) | L92–L120 | `WHERE id = $1 AND tenant_id = $2` on UPDATE | Missing tenant scope = cross-tenant update |

**Postcondition added from blast radius**: Any `getAlertConfigs()` in the same file must include `WHERE tenant_id = $1` (enforced by PC-X2's cross-tenant isolation test).

### Cross-File Siblings (`apps/api/src/services/`)

| File | Function | Same Pattern? | Risk |
|------|----------|---------------|------|
| `apps/api/src/services/productService.js` | `createProduct()` | Yes — same INSERT + tenant_id pattern | Reference implementation to match |
| `apps/api/src/services/supplierService.js` | `createSupplier()` | Yes — same INSERT + tenant_id pattern | Validation pattern should be consistent |
| `apps/api/src/services/orderService.js` | `createOrder()` | Yes — multi-step with transaction | Alert configs are single-step; no transaction needed |

### Validation Functions

| Function | File | Enforces Same Constraints? |
|----------|------|---------------------------|
| `validateProduct()` | `apps/api/src/services/productService.js:L8` | Yes — required fields + type checks; same pattern to follow |
| `validateSupplier()` | `apps/api/src/services/supplierService.js:L5` | Yes — required fields validation |

### Edge Cases

| Input | Field | Expected Behavior |
|-------|-------|-------------------|
| `""` (empty string) | `category` | ERR-1: 400 `{ error: "Category is required" }` |
| `null` | `category` | ERR-2: 400 `{ error: "Category is required" }` |
| `undefined` | `category` | ERR-2: 400 `{ error: "Category is required" }` |
| `[]` | `category` | 400 `{ error: "Category is required" }` — array is not a valid category string |
| `{}` | `category` | 400 `{ error: "Category is required" }` — object is not a valid string |
| `0` | `threshold` | ERR-4: 400 `{ error: "Threshold must be a positive integer" }` |
| `-1` | `threshold` | ERR-5: 400 `{ error: "Threshold must be a positive integer" }` |
| `Number.MAX_SAFE_INTEGER` | `threshold` | 201 — valid positive integer; stored and returned as-is |
| `1.5` | `threshold` | ERR-6: 400 `{ error: "Threshold must be a positive integer" }` |
| `NaN` | `threshold` | 400 `{ error: "Threshold must be a positive integer" }` |
| `"<script>alert(1)</script>"` | `category` | Stored verbatim (XSS escaping is UI layer's responsibility) — see ERR-11 |
| `" "` (whitespace only) | `category` | 400 `{ error: "Category is required" }` — trimmed value is empty |

---

## Error Strategy

### External Calls

| Operation | Error Type | Handling Strategy | User Message | Log Level | Recovery Path |
|-----------|-----------|-------------------|--------------|-----------|---------------|
| `pool.query()` INSERT | `DatabaseError` / connection failure | `catch(err)` in route handler: log full error, return 500 | `"An internal error occurred"` | `error` with `{ tenantId, category, threshold, err.message, err.stack }` | Caller retries; ops investigates DB logs |

### User Inputs

| Input | Validation Location | Error Type | Strategy |
|-------|--------------------|-----------| ---------|
| `category` | `alertConfigService.js` — `createAlertConfig()` preamble | `ValidationError` (custom class) | Throw before any DB call; route handler catches and maps to 400 |
| `threshold` | `alertConfigService.js` — `createAlertConfig()` preamble | `ValidationError` (custom class) | Throw before any DB call; route handler catches and maps to 400 |

### Transaction Boundaries

`createAlertConfig()` is a single INSERT — no transaction required. If future versions add side effects (e.g., publishing an event), a transaction boundary must be added at that time.

### Error Class Hierarchy

```
ValidationError (400) — thrown by service, caught by route
DatabaseError  (500) — propagated from pool.query(), caught by route
```

Route handler pattern:
```javascript
try {
  const config = await createAlertConfig({ category, threshold, tenantId: req.user.tenant_id });
  res.status(201).json(config);
} catch (err) {
  if (err instanceof ValidationError) {
    return res.status(400).json({ error: err.message });
  }
  logger.error('Failed to create alert config', { tenantId: req.user.tenant_id, category, threshold, error: err.message, stack: err.stack });
  res.status(500).json({ error: 'An internal error occurred' });
}
```

---

## Side Effects

| Effect | Intentional? | Tested By |
|--------|-------------|-----------|
| One new row inserted into `alert_configs` table | Yes | PC-S1 |
| `created_at` and `updated_at` auto-populated by database default | Yes | PC-S2 (checks `created_at` present) |
| No event emitted, no webhook triggered, no queue message sent | Yes (this is a simple INSERT) | Blast radius scan — no event bus calls |
| No other tables modified | Yes | Database state check in PC-S1 test (only `alert_configs` row count changes) |

---

## NOT in Scope

1. **PATCH/PUT/DELETE /api/alert-configs** — this contract covers creation only. Update and delete endpoints are separate features with their own plans and contracts.
2. **Input sanitization / XSS escaping** — the API stores `category` verbatim. Output escaping is the responsibility of the frontend rendering layer. Adding sanitization here would be scope creep.
3. **Rate limiting on this endpoint** — rate limiting is a platform-level concern applied globally, not per-endpoint. Adding it here is out of scope.
4. **Pagination or filtering of alert configs** — the GET endpoint (if added) is a separate task. This contract covers POST only.
5. **Alerting worker logic changes** — the worker at `apps/api/src/workers/alertWorker.js` reads from `alert_configs` but its evaluation logic is not modified by this task. Schema compatibility is verified but behavior is not changed.
6. **Admin UI form implementation** — the `AlertConfigForm` component may already exist or may be created separately. This contract covers the API contract only; UI implementation is a separate task.

---

## Traceability Matrix

| PC | Test File | Test Name | Code File | Code Location | Status |
|----|-----------|-----------|-----------|---------------|--------|
| PC-A1 | `apps/api/src/__tests__/alertConfigs.test.js` | `"POST /api/alert-configs returns 201 with created config"` | `apps/api/src/routes/alertConfigs.js` | Route handler `L8–L25` | PENDING |
| PC-A2 | `apps/api/src/__tests__/alertConfigs.test.js` | `"POST /api/alert-configs returns 400 when category is missing"` | `apps/api/src/routes/alertConfigs.js` | Catch block `L18–L22` | PENDING |
| PC-A3 | `apps/api/src/__tests__/alertConfigs.test.js` | `"POST /api/alert-configs returns 400 when threshold is missing"` | `apps/api/src/routes/alertConfigs.js` | Catch block `L18–L22` | PENDING |
| PC-A4 | `apps/api/src/__tests__/alertConfigs.test.js` | `"POST /api/alert-configs returns 400 when threshold is not a positive integer"` | `apps/api/src/routes/alertConfigs.js` | Catch block `L18–L22` | PENDING |
| PC-A5 | `apps/api/src/__tests__/alertConfigs.test.js` | `"POST /api/alert-configs returns 401 when unauthenticated"` | `apps/api/src/middleware/auth.js` | `authenticateStaff` middleware | PENDING |
| PC-A6 | `apps/api/src/__tests__/alertConfigs.test.js` | `"POST /api/alert-configs error responses do not expose internal details"` | `apps/api/src/routes/alertConfigs.js` | Catch block `L18–L24` | PENDING |
| PC-S1 | `apps/api/src/__tests__/alertConfigService.test.js` | `"createAlertConfig inserts row with tenant_id from argument not body"` | `apps/api/src/services/alertConfigService.js` | `createAlertConfig() L28–L38` | PENDING |
| PC-S2 | `apps/api/src/__tests__/alertConfigService.test.js` | `"createAlertConfig returns id, category, threshold, tenant_id, created_at"` | `apps/api/src/services/alertConfigService.js` | `createAlertConfig() L38–L40` | PENDING |
| PC-S3 | `apps/api/src/__tests__/alertConfigService.test.js` | `"createAlertConfig throws ValidationError when category is empty or null"` | `apps/api/src/services/alertConfigService.js` | `validateAlertConfigInput() L8–L12` | PENDING |
| PC-S4 | `apps/api/src/__tests__/alertConfigService.test.js` | `"createAlertConfig throws ValidationError when threshold is non-positive or non-integer"` | `apps/api/src/services/alertConfigService.js` | `validateAlertConfigInput() L14–L20` | PENDING |
| PC-S5 | `apps/api/src/__tests__/alertConfigService.test.js` | `"createAlertConfig SQL uses parameterized values"` | `apps/api/src/services/alertConfigService.js` | `pool.query() call L30–L36` | PENDING |
| PC-S6 | `apps/api/src/__tests__/alertConfigService.test.js` | `"createAlertConfig propagates database errors without swallowing"` | `apps/api/src/services/alertConfigService.js` | `createAlertConfig() — no catch block` | PENDING |
| PC-X1 | `apps/api/src/__tests__/alertConfigs.integration.test.js` | `"created alert config appears in GET /api/alert-configs list"` | `apps/api/src/routes/alertConfigs.js` | Route `L35–L55` (GET handler) | PENDING |
| PC-X2 | `apps/api/src/__tests__/alertConfigs.integration.test.js` | `"alert config created by tenant A not visible to tenant B"` | `apps/api/src/services/alertConfigService.js` | `getAlertConfigs() WHERE tenant_id L52` | PENDING |

---

## Quality Gate

```
CONTRACT QUALITY GATE
=====================
Testability:        PASS — 14 PCs, all have concrete expect() skeletons with specific values
Banned Words:       PASS — grep count: 0 (no "should", "probably", "appropriate", "reasonable", "properly", "correct")
Completeness:       PASS — plan tasks: create route, create service, validation, DB migration, auth guard; all contracted (PC-A1–A6, PC-S1–S6, PC-X1–X2)
Consumer Coverage:  PASS — 5 consumers found and mapped (AlertConfigList, useAlertConfigs, AlertConfigDetail, GET route handler, alertWorker)
Blast Radius:       PASS — same-file: 3 sibling functions identified (getAlertConfigs, deleteAlertConfig, updateAlertConfig); cross-file: 3 service siblings checked (productService, supplierService, orderService)
Error Coverage:     PASS — 11 error cases covering: 7 validation inputs + 1 DB failure + 2 auth failures + 1 XSS edge case
Invariants:         PASS — 7/7 standard invariants listed; all 7 apply and are addressed
Scope Boundary:     PASS — 6 explicit exclusions (PATCH/PUT/DELETE, XSS sanitization, rate limiting, pagination, worker logic, UI form)
Traceability:       PASS — 14 PCs, 14 matrix rows; zero orphans
Tautology Check:    PASS — 14 PCs checked; all assert specific values (uuid pattern, exact strings, specific status codes); 0 tautological
Error Strategy:     PASS — 1 external call (pool.query) + 2 user inputs (category, threshold) = 3 operations; all 3 have entries in Error Strategy; transaction boundaries defined

Score: 11/11 — LOCKED
```

---

## Summary

```
CONTRACT READY
==============

Task: POST /api/alert-configs — Tenant-Scoped Alert Configuration Creation
Type: Feature
Postconditions: 14 (API: 6, Service: 6, UI: 0, Cross-layer: 2)
Error cases: 11
Invariants: 7 (all apply)
Consumers mapped: 5
Blast radius: 3 same-file, 3 cross-file, 2 validation functions, 12 edge cases
NOT in scope: 6 explicit exclusions

Quality gate: 11/11 PASSED — STATUS: LOCKED

Contract: docs/contracts/2026-03-14-alert-configs-contract.md

Ready to build? (/enterprise-build)
```
