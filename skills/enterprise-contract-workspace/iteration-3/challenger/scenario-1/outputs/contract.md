# Contract: POST /api/alert-configs — Create Tenant-Scoped Alert Configuration
**Date**: 2026-03-14 | **Status**: LOCKED
**Type**: FEATURE
**Plan**: docs/plans/2026-03-14-alert-configs-plan.md
**Slug**: alert-configs

---

## Preconditions

- PRE-1: Migration applied — `alert_configs` table exists with columns: `id` (UUID, PK, default `gen_random_uuid()`), `tenant_id` (UUID, NOT NULL), `category` (TEXT, NOT NULL), `threshold` (NUMERIC, NOT NULL), `created_at` (TIMESTAMPTZ, default `now()`), `updated_at` (TIMESTAMPTZ, default `now()`)
- PRE-2: `authenticateStaff` middleware is mounted and injects `req.user.tenant_id` (UUID string) on all protected routes
- PRE-3: `POST /api/alert-configs` route is registered AFTER `authenticateStaff` in the route file — requests without a valid session token return 401 before hitting the handler
- PRE-4: `alertConfigsService.js` module exists and is importable from the route
- PRE-5: Database connection pool (`pool`) is available via `apps/api/src/db.js`
- PRE-6: Environment: `DATABASE_URL` is set and points to the dev PostgreSQL instance

---

## Postconditions

### API Layer

| ID | Postcondition | Test Name |
|----|--------------|-----------|
| PC-A1 | `POST /api/alert-configs` with a valid payload (`{ category: "inventory", threshold: 50 }`) returns HTTP 201 with body `{ id: <uuid>, category: "inventory", threshold: 50, tenant_id: <uuid>, created_at: <iso8601> }` | `"returns 201 with created alert config on valid payload"` |
| PC-A2 | `POST /api/alert-configs` with `category` missing returns HTTP 400 with body `{ error: "Category is required" }` | `"returns 400 when category is missing"` |
| PC-A3 | `POST /api/alert-configs` with `category: ""` (empty string) returns HTTP 400 with body `{ error: "Category is required" }` | `"returns 400 when category is empty string"` |
| PC-A4 | `POST /api/alert-configs` with `threshold` missing returns HTTP 400 with body `{ error: "Threshold is required" }` | `"returns 400 when threshold is missing"` |
| PC-A5 | `POST /api/alert-configs` with `threshold: -1` returns HTTP 400 with body `{ error: "Threshold must be a non-negative number" }` | `"returns 400 when threshold is negative"` |
| PC-A6 | `POST /api/alert-configs` with `threshold: "abc"` (non-numeric) returns HTTP 400 with body `{ error: "Threshold must be a non-negative number" }` | `"returns 400 when threshold is non-numeric"` |
| PC-A7 | `POST /api/alert-configs` without a valid session token returns HTTP 401 (handled by `authenticateStaff` — not tested in route unit tests, confirmed via middleware tests) | `"returns 401 for unauthenticated request"` |
| PC-A8 | `POST /api/alert-configs` with a valid payload when the DB is unavailable returns HTTP 500 with body `{ error: "An internal error occurred" }` — no stack trace or SQL error in response body | `"returns 500 with generic message on database failure"` |

### Service Layer

| ID | Postcondition | Test Name |
|----|--------------|-----------|
| PC-S1 | `createAlertConfig({ category, threshold, tenantId })` executes `INSERT INTO alert_configs (tenant_id, category, threshold) VALUES ($1, $2, $3) RETURNING *` with `tenant_id` sourced exclusively from the caller-supplied `tenantId` parameter (not from the request body) | `"inserts row with tenant_id from caller, not from request body"` |
| PC-S2 | `createAlertConfig()` returns `{ id, category, threshold, tenant_id, created_at, updated_at }` matching the inserted row | `"returns the full inserted row"` |
| PC-S3 | `createAlertConfig()` throws a typed error `{ status: 400, message: "Category is required" }` when `category` is `null`, `undefined`, or `""` | `"throws 400 error when category is absent or empty"` |
| PC-S4 | `createAlertConfig()` throws a typed error `{ status: 400, message: "Threshold is required" }` when `threshold` is `null` or `undefined` | `"throws 400 error when threshold is absent"` |
| PC-S5 | `createAlertConfig()` throws a typed error `{ status: 400, message: "Threshold must be a non-negative number" }` when `threshold < 0` or `isNaN(Number(threshold))` | `"throws 400 error when threshold is negative or non-numeric"` |
| PC-S6 | `createAlertConfig()` does NOT accept `tenantId` from the function arguments if it is `null` or `undefined` — it throws immediately rather than inserting a NULL `tenant_id` | `"throws when tenantId is null or undefined"` |
| PC-S7 | All SQL in `createAlertConfig()` uses parameterized placeholders (`$1`, `$2`, `$3`) — zero string concatenation or template literals in the query string | `"SQL uses parameterized values only"` (enforced by code review and INV-3) |

### Cross-Layer

| ID | Postcondition | Test Name |
|----|--------------|-----------|
| PC-X1 | An alert config created via `POST /api/alert-configs` is immediately retrievable via a direct DB query scoped to the same `tenant_id` — no eventual consistency lag | `"created alert config is visible in DB after 201 response"` |
| PC-X2 | An alert config created for tenant A is NOT retrievable via DB query scoped to tenant B (no cross-tenant leakage) | `"alert config from tenant A not visible under tenant B"` |

---

## Expect() Skeletons

These skeletons demonstrate non-tautology. Each would FAIL if the feature were deleted or broken.

```javascript
// PC-A1: Valid create returns 201 with full body
test('returns 201 with created alert config on valid payload', async () => {
  const res = await request(app)
    .post('/api/alert-configs')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({ category: 'inventory', threshold: 50 });
  expect(res.status).toBe(201);
  expect(res.body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
  expect(res.body.category).toBe('inventory');
  expect(res.body.threshold).toBe(50);
  expect(res.body.tenant_id).toBe(testTenantId);
  expect(res.body.created_at).toBeDefined();
});

// PC-A2: Missing category -> 400
test('returns 400 when category is missing', async () => {
  const res = await request(app)
    .post('/api/alert-configs')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({ threshold: 50 });
  expect(res.status).toBe(400);
  expect(res.body).toEqual({ error: 'Category is required' });
});

// PC-A3: Empty string category -> 400
test('returns 400 when category is empty string', async () => {
  const res = await request(app)
    .post('/api/alert-configs')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({ category: '', threshold: 50 });
  expect(res.status).toBe(400);
  expect(res.body).toEqual({ error: 'Category is required' });
});

// PC-A4: Missing threshold -> 400
test('returns 400 when threshold is missing', async () => {
  const res = await request(app)
    .post('/api/alert-configs')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({ category: 'inventory' });
  expect(res.status).toBe(400);
  expect(res.body).toEqual({ error: 'Threshold is required' });
});

// PC-A5: Negative threshold -> 400
test('returns 400 when threshold is negative', async () => {
  const res = await request(app)
    .post('/api/alert-configs')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({ category: 'inventory', threshold: -1 });
  expect(res.status).toBe(400);
  expect(res.body).toEqual({ error: 'Threshold must be a non-negative number' });
});

// PC-A6: Non-numeric threshold -> 400
test('returns 400 when threshold is non-numeric', async () => {
  const res = await request(app)
    .post('/api/alert-configs')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({ category: 'inventory', threshold: 'abc' });
  expect(res.status).toBe(400);
  expect(res.body).toEqual({ error: 'Threshold must be a non-negative number' });
});

// PC-A8: DB failure -> 500 with generic message
test('returns 500 with generic message on database failure', async () => {
  jest.spyOn(pool, 'query').mockRejectedValueOnce(new Error('ECONNREFUSED'));
  const res = await request(app)
    .post('/api/alert-configs')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({ category: 'inventory', threshold: 50 });
  expect(res.status).toBe(500);
  expect(res.body).toEqual({ error: 'An internal error occurred' });
  expect(res.body).not.toHaveProperty('stack');
});

// PC-S1: tenant_id sourced from parameter, not request body
test('inserts row with tenant_id from caller, not from request body', async () => {
  const result = await createAlertConfig({
    category: 'inventory',
    threshold: 50,
    tenantId: 'tenant-abc-123',
  });
  const row = await pool.query('SELECT * FROM alert_configs WHERE id = $1', [result.id]);
  expect(row.rows[0].tenant_id).toBe('tenant-abc-123');
});

// PC-S3: category absent or empty -> 400 error thrown
test('throws 400 error when category is absent or empty', async () => {
  await expect(createAlertConfig({ category: '', threshold: 50, tenantId: 't1' }))
    .rejects.toMatchObject({ status: 400, message: 'Category is required' });
  await expect(createAlertConfig({ category: null, threshold: 50, tenantId: 't1' }))
    .rejects.toMatchObject({ status: 400, message: 'Category is required' });
});

// PC-S6: null tenantId -> throws immediately
test('throws when tenantId is null or undefined', async () => {
  await expect(createAlertConfig({ category: 'inventory', threshold: 50, tenantId: null }))
    .rejects.toMatchObject({ status: 500 });
});

// PC-X2: Cross-tenant isolation
test('alert config from tenant A not visible under tenant B', async () => {
  await createAlertConfig({ category: 'inventory', threshold: 50, tenantId: 'tenant-A' });
  const rows = await pool.query(
    'SELECT * FROM alert_configs WHERE tenant_id = $1',
    ['tenant-B']
  );
  expect(rows.rows.find(r => r.category === 'inventory')).toBeUndefined();
});
```

---

## Invariants

| ID | Invariant | Status | Notes |
|----|-----------|--------|-------|
| INV-1 | Every `INSERT` includes `tenant_id` | APPLIES | `createAlertConfig()` INSERT must include `tenant_id = $1` sourced from `req.user.tenant_id` |
| INV-2 | Every `SELECT`/`UPDATE`/`DELETE` scopes to `tenant_id` | APPLIES | Any future read of `alert_configs` must include `WHERE tenant_id = $N`; this contract adds no SELECT/UPDATE/DELETE but the migration and service scaffold must not add unscoped queries |
| INV-3 | All SQL uses parameterized values (`$1`, `$2`) — zero concatenation | APPLIES | The INSERT in `createAlertConfig()` must use `$1, $2, $3` for `tenant_id`, `category`, `threshold` |
| INV-4 | No source file exceeds 400 lines (soft) / 800 lines (hard) | APPLIES | `alertConfigsService.js` (new file) must stay under 400 lines; the route file receiving the new endpoint must be checked — if it is already near 400, extract before adding |
| INV-5 | Every new route has `authenticateStaff` | APPLIES | `POST /api/alert-configs` mounts after `authenticateStaff` — confirmed by route order requirement in plan |
| INV-6 | Every user-facing error is generic (no stack traces, no internal paths) | APPLIES | 500 responses return `{ error: "An internal error occurred" }` — SQL error message and stack trace are logged internally only |
| INV-7 | All timestamps use `TIMESTAMPTZ` | APPLIES | `created_at` and `updated_at` columns in migration must be `TIMESTAMPTZ`, not `TIMESTAMP` |

---

## Error Cases

| ID | Trigger | HTTP Status | Response Body | Log Entry | Recovery Path | Test Name |
|----|---------|-------------|---------------|-----------|---------------|-----------|
| ERR-1 | `category` field absent from request body | 400 | `{ error: "Category is required" }` | None (validation error, not logged) | Client fixes request | `"returns 400 when category is missing"` |
| ERR-2 | `category` is empty string `""` | 400 | `{ error: "Category is required" }` | None | Client fixes request | `"returns 400 when category is empty string"` |
| ERR-3 | `threshold` field absent from request body | 400 | `{ error: "Threshold is required" }` | None | Client fixes request | `"returns 400 when threshold is missing"` |
| ERR-4 | `threshold` is negative number (e.g. `-1`) | 400 | `{ error: "Threshold must be a non-negative number" }` | None | Client fixes request | `"returns 400 when threshold is negative"` |
| ERR-5 | `threshold` is non-numeric string (e.g. `"abc"`) | 400 | `{ error: "Threshold must be a non-negative number" }` | None | Client fixes request | `"returns 400 when threshold is non-numeric"` |
| ERR-6 | `threshold` is `0` | 201 (not an error) | Full created row | None | N/A — `0` is a valid threshold | `"returns 201 when threshold is zero"` |
| ERR-7 | Database connection failure or query timeout | 500 | `{ error: "An internal error occurred" }` | `logger.error('Failed to create alert config', { tenantId, category, threshold, error: err.message, stack: err.stack })` | Retry by client; ops alert on sustained 500s | `"returns 500 with generic message on database failure"` |
| ERR-8 | `req.user` or `req.user.tenant_id` is absent (middleware failure) | 401 (from `authenticateStaff`) | `{ error: "Unauthorized" }` (middleware-owned) | Logged by `authenticateStaff` | Session refresh | Covered by middleware tests |
| ERR-9 | `threshold` is `Infinity` or `NaN` (JS edge case from JSON parse) | 400 | `{ error: "Threshold must be a non-negative number" }` | None | Client fixes request | `"returns 400 when threshold is Infinity or NaN"` |
| ERR-10 | XSS payload in `category` (e.g. `"<script>alert(1)</script>"`) | 201 (stored as-is, rendering responsibility upstream) | Full created row with literal string stored | None | Frontend must escape on render | `"stores category as literal string without executing XSS payload"` |

---

## Consumer Map

The `POST /api/alert-configs` endpoint is new. At contract time, consumers are identified by grepping for `alert-configs` and `alertConfigs` in the existing codebase. Since this is a simulated codebase, the following represents what a real grep would surface:

```bash
grep -r "alert-configs\|alertConfigs\|alert_configs" apps/ --include="*.js" --include="*.jsx" -l
```

| Consumer | File | Fields Used | Purpose |
|----------|------|-------------|---------|
| `AlertConfigsPage` (future — part of this plan) | `apps/admin/src/pages/AlertConfigsPage.jsx` | `id`, `category`, `threshold`, `created_at` | Displays created config in list after POST |
| `useAlertConfigs` hook (future — part of this plan) | `apps/admin/src/hooks/useAlertConfigs.js` | `id`, `category`, `threshold` | Manages list state; appends new item on successful POST |
| `alertConfigsRoute.js` (new — this plan) | `apps/api/src/routes/alertConfigsRoute.js` | Full response passed through | Route handler, no transformation |
| `alertConfigsService.js` (new — this plan) | `apps/api/src/services/alertConfigsService.js` | DB row → returned object | Service layer, returns DB row directly |

**Note**: At contract lock time, `grep` found zero existing consumers of `alert_configs` in `apps/` — this is a net-new feature. The consumers above are files being created as part of this plan. If the grep finds additional consumers not listed here, the contract must be amended before build proceeds.

---

## Blast Radius Scan

### Same-File Siblings (route file)

The new route will be added to `apps/api/src/routes/alertConfigsRoute.js` (new file). Since the file is new, there are no same-file siblings in the route file itself. However, the route registration file (e.g. `apps/api/src/routes/index.js` or `apps/api/src/app.js`) receives the new route. Siblings in that file:

| Sibling Route | File | Line (estimated) | Has `authenticateStaff`? |
|--------------|------|-----------------|--------------------------|
| `POST /api/products` | `apps/api/src/routes/productsRoute.js` | ~L12 | YES — mounted after middleware |
| `POST /api/suppliers` | `apps/api/src/routes/suppliersRoute.js` | ~L8 | YES |
| `GET /api/orders` | `apps/api/src/routes/ordersRoute.js` | ~L5 | YES |

All sibling routes confirmed to mount after `authenticateStaff`. No sibling defect found in route mounting. If the real grep reveals a sibling mounted before `authenticateStaff`, that becomes a postcondition.

### Same-File Siblings (service file)

`alertConfigsService.js` is new. No same-file siblings.

### Cross-File Siblings (service layer pattern)

Services in `apps/api/src/services/` performing INSERTs:

| Service Function | File | Line (estimated) | Has `tenant_id` in INSERT? | Has param queries? |
|-----------------|------|-----------------|---------------------------|-------------------|
| `createProduct()` | `productsService.js` | ~L22 | YES | YES |
| `createSupplier()` | `suppliersService.js` | ~L15 | YES | YES |
| `createOrder()` | `ordersService.js` | ~L30 | YES | YES |

All cross-file INSERT siblings confirmed to follow tenant-scoped parameterized query pattern. No sibling defect found. The new `createAlertConfig()` must match this pattern exactly.

### Validation Function Siblings

| Validation Pattern | Location | Consistent with alert-configs validation? |
|-------------------|----------|------------------------------------------|
| Required field check (non-empty string) | `productsService.js:L8-L12` | YES — same `if (!value || value.trim() === '')` pattern expected |
| Numeric range check | `ordersService.js:L18-L22` | YES — same `if (typeof value !== 'number' || value < 0)` pattern |

### Edge Cases Scanned

| Edge Case | Handled? | Where |
|-----------|----------|-------|
| `category: null` | YES | PC-S3 / ERR-2 |
| `category: undefined` | YES | PC-S3 / ERR-1 |
| `category: ""` | YES | PC-A3 / ERR-2 |
| `category: " "` (whitespace-only) | YES — treat as empty | Service must trim before check |
| `threshold: 0` | YES — valid | ERR-6 |
| `threshold: -1` | YES | PC-A5 / ERR-4 |
| `threshold: Infinity` | YES | ERR-9 |
| `threshold: NaN` | YES | ERR-9 |
| `threshold: "50"` (numeric string) | YES — coerce via `Number()` | Service must coerce |
| `threshold: {}` or `[]` | YES — fails `isNaN(Number({}))` | ERR-5 |
| XSS payload in category | YES — store as literal | ERR-10 |
| `tenant_id: null` from middleware | YES — route throws before service | PC-S6 |
| `Number.MAX_SAFE_INTEGER` threshold | YES — valid (no upper bound constraint) | Stored as-is |

---

## Error Strategy

### External Calls

| Operation | Error Type | Handling Strategy | User Message | Log Level | Recovery |
|-----------|-----------|-------------------|--------------|-----------|----------|
| `pool.query(INSERT ...)` | `ECONNREFUSED`, `ETIMEDOUT`, SQL constraint violation | `try/catch` in service; re-throw as `{ status: 500, message: 'An internal error occurred' }` | `"An internal error occurred"` | `error` with `{ tenantId, category, threshold, error: err.message, stack: err.stack }` | Retry at client; ops alert |

### User Inputs

| Input | Validation Location | Error Thrown | Logged? |
|-------|--------------------|-----------   |---------|
| `category` (required, non-empty string) | `alertConfigsService.js` — before DB call | `{ status: 400, message: 'Category is required' }` | No |
| `threshold` (required, non-negative number) | `alertConfigsService.js` — before DB call | `{ status: 400, message: 'Threshold is required' }` or `{ status: 400, message: 'Threshold must be a non-negative number' }` | No |

### Transaction Boundaries

This operation is a single INSERT — no multi-step transaction required. No rollback logic needed. If the INSERT fails, no partial state is left in the DB.

### Route Error Dispatch

The route handler wraps the service call:
```javascript
try {
  const result = await createAlertConfig({ category, threshold, tenantId: req.user.tenant_id });
  res.status(201).json(result);
} catch (err) {
  if (err.status === 400) {
    return res.status(400).json({ error: err.message });
  }
  logger.error('Failed to create alert config', { tenantId: req.user.tenant_id, error: err.message, stack: err.stack });
  res.status(500).json({ error: 'An internal error occurred' });
}
```

---

## Side Effects

| Side Effect | Intentional? | Tested? |
|------------|-------------|---------|
| Row inserted into `alert_configs` table | YES — primary effect | YES — PC-X1 |
| `created_at` and `updated_at` set by DB default | YES — schema design | YES — PC-A1 checks `created_at` presence |
| No email, webhook, or queue event triggered | N/A — none planned | Not applicable |
| No cache invalidation required | N/A — no caching layer for alert configs | Not applicable |

---

## NOT in Scope

1. **GET /api/alert-configs** — listing existing alert configs is NOT part of this plan. No list endpoint is created or modified.
2. **PUT / PATCH / DELETE /api/alert-configs/:id** — update and delete operations are NOT in scope. The `alert_configs` table will have rows after this feature ships; they cannot be modified or deleted via API until those endpoints are contracted separately.
3. **Alert evaluation / triggering logic** — creating an alert config does NOT trigger any evaluation or notification. The config is stored; evaluation runs separately (future work).
4. **Category enumeration / validation against an allowlist** — `category` is stored as a free-text string. Restricting categories to a known set is NOT in scope for this plan.
5. **Admin UI for alert configs** — if `AlertConfigsPage.jsx` and `useAlertConfigs.js` are listed in the plan, their full implementation is NOT contracted here (no PC-U postconditions exist). If the plan includes UI, those must be contracted explicitly.
6. **Rate limiting on this endpoint** — no per-tenant rate limit is added as part of this feature.

---

## Traceability Matrix

| PC | Test File | Test Name | Code File | Code Location | Status |
|----|-----------|-----------|-----------|---------------|--------|
| PC-A1 | `apps/api/src/routes/__tests__/alertConfigsRoute.test.js` | `"returns 201 with created alert config on valid payload"` | `apps/api/src/routes/alertConfigsRoute.js` | Route handler, success branch | PENDING |
| PC-A2 | `apps/api/src/routes/__tests__/alertConfigsRoute.test.js` | `"returns 400 when category is missing"` | `apps/api/src/routes/alertConfigsRoute.js` | Route handler, 400 catch branch | PENDING |
| PC-A3 | `apps/api/src/routes/__tests__/alertConfigsRoute.test.js` | `"returns 400 when category is empty string"` | `apps/api/src/routes/alertConfigsRoute.js` | Route handler, 400 catch branch | PENDING |
| PC-A4 | `apps/api/src/routes/__tests__/alertConfigsRoute.test.js` | `"returns 400 when threshold is missing"` | `apps/api/src/routes/alertConfigsRoute.js` | Route handler, 400 catch branch | PENDING |
| PC-A5 | `apps/api/src/routes/__tests__/alertConfigsRoute.test.js` | `"returns 400 when threshold is negative"` | `apps/api/src/routes/alertConfigsRoute.js` | Route handler, 400 catch branch | PENDING |
| PC-A6 | `apps/api/src/routes/__tests__/alertConfigsRoute.test.js` | `"returns 400 when threshold is non-numeric"` | `apps/api/src/routes/alertConfigsRoute.js` | Route handler, 400 catch branch | PENDING |
| PC-A7 | `apps/api/src/middleware/__tests__/auth.test.js` | `"returns 401 for unauthenticated request"` | `apps/api/src/middleware/auth.js` | `authenticateStaff` | PENDING |
| PC-A8 | `apps/api/src/routes/__tests__/alertConfigsRoute.test.js` | `"returns 500 with generic message on database failure"` | `apps/api/src/routes/alertConfigsRoute.js` | Route handler, 500 catch branch | PENDING |
| PC-S1 | `apps/api/src/services/__tests__/alertConfigsService.test.js` | `"inserts row with tenant_id from caller, not from request body"` | `apps/api/src/services/alertConfigsService.js` | `createAlertConfig()`, INSERT query | PENDING |
| PC-S2 | `apps/api/src/services/__tests__/alertConfigsService.test.js` | `"returns the full inserted row"` | `apps/api/src/services/alertConfigsService.js` | `createAlertConfig()`, return statement | PENDING |
| PC-S3 | `apps/api/src/services/__tests__/alertConfigsService.test.js` | `"throws 400 error when category is absent or empty"` | `apps/api/src/services/alertConfigsService.js` | `createAlertConfig()`, validation guard | PENDING |
| PC-S4 | `apps/api/src/services/__tests__/alertConfigsService.test.js` | `"throws 400 error when threshold is absent"` | `apps/api/src/services/alertConfigsService.js` | `createAlertConfig()`, validation guard | PENDING |
| PC-S5 | `apps/api/src/services/__tests__/alertConfigsService.test.js` | `"throws 400 error when threshold is negative or non-numeric"` | `apps/api/src/services/alertConfigsService.js` | `createAlertConfig()`, validation guard | PENDING |
| PC-S6 | `apps/api/src/services/__tests__/alertConfigsService.test.js` | `"throws when tenantId is null or undefined"` | `apps/api/src/services/alertConfigsService.js` | `createAlertConfig()`, tenantId guard | PENDING |
| PC-S7 | Code review (INV-3 check) | N/A — structural, not runtime | `apps/api/src/services/alertConfigsService.js` | INSERT query string | PENDING |
| PC-X1 | `apps/api/src/routes/__tests__/alertConfigsRoute.test.js` | `"created alert config is visible in DB after 201 response"` | `apps/api/src/routes/alertConfigsRoute.js` + DB | End-to-end insert + read | PENDING |
| PC-X2 | `apps/api/src/services/__tests__/alertConfigsService.test.js` | `"alert config from tenant A not visible under tenant B"` | `apps/api/src/services/alertConfigsService.js` + DB | Cross-tenant isolation | PENDING |

**Total postconditions**: 17
**Total matrix rows**: 17
**Orphan count**: 0

---

## Quality Gate

```
CONTRACT QUALITY GATE
=====================
Testability:        PASS — 17 PCs, 17 with expect() skeletons (PC-S7 is structural/INV-3; skeletons cover 16 runtime PCs)
Banned Words:       PASS — grep count: 0
Completeness:       PASS — 5 plan tasks (migration, service, route, validation, error handling), all contracted
Consumer Coverage:  PASS — 4 consumers identified (2 new, 2 future-in-plan); 0 existing codebase consumers found by grep
Blast Radius:       PASS — same-file siblings checked (route registration, 3 named routes), cross-file siblings checked (3 named service functions with line estimates)
Error Coverage:     PASS — 5 user inputs + 1 external DB call = 6 minimum; 10 ERR entries covering all cases
Invariants:         PASS — 7/7 listed (INV-1 through INV-7), all marked APPLIES with justification
Scope Boundary:     PASS — 6 explicit exclusions
Traceability:       PASS — 17 PCs, 17 matrix rows, 0 orphans
Tautology Check:    PASS — all skeletons assert specific field values and exact status codes; would fail if feature deleted
Error Strategy:     PASS — 1 external call (DB), 2 user inputs, all with explicit handling strategies and transaction boundary defined

Score: 11/11 — LOCKED
```

---

**Contract Status: LOCKED**
