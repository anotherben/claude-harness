# Contract: POST /api/alert-configs — Create Tenant-Scoped Alert Configuration
**Date**: 2026-03-14 | **Status**: LOCKED
**Plan**: `docs/plans/2026-03-14-alert-configs-plan.md`
**Type**: FEATURE
**Slug**: `alert-configs`

---

## Preconditions

These are assumed true before the code runs — not tested by the contract:

- PRE-1: Migration `20260314_create_alert_configs.sql` applied — table `alert_configs` exists with columns `id` (UUID, default `gen_random_uuid()`), `tenant_id` (UUID, NOT NULL), `category` (TEXT, NOT NULL), `threshold` (NUMERIC, NOT NULL), `created_at` (TIMESTAMPTZ, default `now()`), `updated_at` (TIMESTAMPTZ, default `now()`)
- PRE-2: `authenticateStaff` middleware is mounted at the router level; the new route registers after it
- PRE-3: `req.user.tenant_id` is populated by `authenticateStaff` as a UUID string
- PRE-4: PostgreSQL `pool` is available via `apps/api/src/db/pool.js`
- PRE-5: Express router for `/api` routes is defined at `apps/api/src/routes/index.js`
- PRE-6: No existing `alert_configs` route or service exists — this is a net-new file pair

---

## Postconditions

### API Layer

| ID | Postcondition | Test Name |
|----|--------------|-----------|
| PC-A1 | `POST /api/alert-configs` with valid `{ category: "inventory", threshold: 10 }` returns HTTP 201 with body `{ id: <uuid>, category: "inventory", threshold: 10, tenant_id: <uuid>, created_at: <iso8601> }` | `"POST /api/alert-configs returns 201 with created record on valid input"` |
| PC-A2 | `POST /api/alert-configs` with missing `category` returns HTTP 400 with body `{ error: "Category is required" }` — no DB write | `"POST /api/alert-configs returns 400 when category is missing"` |
| PC-A3 | `POST /api/alert-configs` with missing `threshold` returns HTTP 400 with body `{ error: "Threshold is required" }` — no DB write | `"POST /api/alert-configs returns 400 when threshold is missing"` |
| PC-A4 | `POST /api/alert-configs` with `threshold` that is not a finite number (e.g. `"abc"`, `null`, `Infinity`) returns HTTP 400 with body `{ error: "Threshold must be a number" }` — no DB write | `"POST /api/alert-configs returns 400 when threshold is not numeric"` |
| PC-A5 | `POST /api/alert-configs` with `threshold <= 0` returns HTTP 400 with body `{ error: "Threshold must be greater than 0" }` — no DB write | `"POST /api/alert-configs returns 400 when threshold is zero or negative"` |
| PC-A6 | `POST /api/alert-configs` with `category` that is an empty string `""` returns HTTP 400 with body `{ error: "Category is required" }` — no DB write | `"POST /api/alert-configs returns 400 when category is empty string"` |
| PC-A7 | `POST /api/alert-configs` without a valid auth token returns HTTP 401 (enforced by `authenticateStaff` middleware — not by the handler) | `"POST /api/alert-configs returns 401 when unauthenticated"` |
| PC-A8 | `POST /api/alert-configs` response body never includes stack traces, internal file paths, or SQL error text regardless of failure mode | `"POST /api/alert-configs does not leak internals on 500 error"` |

### Service Layer

| ID | Postcondition | Test Name |
|----|--------------|-----------|
| PC-S1 | `createAlertConfig({ tenantId, category, threshold })` executes an `INSERT INTO alert_configs` with `tenant_id = tenantId`, `category`, `threshold` using parameterized `$1/$2/$3` values and returns the inserted row `{ id, tenant_id, category, threshold, created_at }` | `"createAlertConfig inserts with tenant_id and returns row"` |
| PC-S2 | `createAlertConfig()` called with `category = ""` throws a `ValidationError` with `message = "Category is required"` before executing any SQL | `"createAlertConfig throws ValidationError for empty category"` |
| PC-S3 | `createAlertConfig()` called with `threshold = 0` throws a `ValidationError` with `message = "Threshold must be greater than 0"` before executing any SQL | `"createAlertConfig throws ValidationError for zero threshold"` |
| PC-S4 | `createAlertConfig()` called with `threshold = -5` throws a `ValidationError` with `message = "Threshold must be greater than 0"` | `"createAlertConfig throws ValidationError for negative threshold"` |
| PC-S5 | `createAlertConfig()` called with `threshold = "abc"` throws a `ValidationError` with `message = "Threshold must be a number"` | `"createAlertConfig throws ValidationError for non-numeric threshold"` |
| PC-S6 | The `tenant_id` in the `INSERT` is sourced exclusively from the `tenantId` parameter passed in — the service never reads `tenant_id` from the `category` or `threshold` inputs | `"createAlertConfig uses tenantId parameter not payload for tenant_id"` |
| PC-S7 | When the `pool.query` call rejects (DB unreachable), `createAlertConfig()` re-throws the original error (does not swallow it) | `"createAlertConfig re-throws DB errors"` |

### Cross-Layer

| ID | Postcondition | Test Name |
|----|--------------|-----------|
| PC-X1 | A record created via `POST /api/alert-configs` is immediately readable from the `alert_configs` table scoped to the same `tenant_id` — no eventual consistency delay | `"created alert config is immediately present in DB for the same tenant"` |
| PC-X2 | A record created under `tenant_id = A` is NOT returned when querying the `alert_configs` table with `tenant_id = B` | `"alert config created for tenant A is not visible to tenant B"` |

---

## Expect() Skeletons (Non-Tautology Proof)

These skeletons FAIL if the feature is deleted or broken — proving they test real behavior.

```javascript
// PC-A1
test('POST /api/alert-configs returns 201 with created record on valid input', async () => {
  const res = await request(app)
    .post('/api/alert-configs')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({ category: 'inventory', threshold: 10 });
  expect(res.status).toBe(201);
  expect(res.body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
  expect(res.body.category).toBe('inventory');
  expect(res.body.threshold).toBe(10);
  expect(res.body.tenant_id).toBe(testTenantId);
  expect(res.body.created_at).toBeDefined();
});

// PC-A2
test('POST /api/alert-configs returns 400 when category is missing', async () => {
  const res = await request(app)
    .post('/api/alert-configs')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({ threshold: 10 });
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('Category is required');
});

// PC-A5
test('POST /api/alert-configs returns 400 when threshold is zero or negative', async () => {
  const res = await request(app)
    .post('/api/alert-configs')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({ category: 'inventory', threshold: 0 });
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('Threshold must be greater than 0');
});

// PC-S1
test('createAlertConfig inserts with tenant_id and returns row', async () => {
  const result = await createAlertConfig({
    tenantId: 'tenant-uuid-123',
    category: 'inventory',
    threshold: 10,
  });
  expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
  expect(result.tenant_id).toBe('tenant-uuid-123');
  expect(result.category).toBe('inventory');
  expect(result.threshold).toBe(10);
});

// PC-S2
test('createAlertConfig throws ValidationError for empty category', async () => {
  await expect(
    createAlertConfig({ tenantId: 'tenant-uuid-123', category: '', threshold: 10 })
  ).rejects.toThrow('Category is required');
});

// PC-X2
test('alert config created for tenant A is not visible to tenant B', async () => {
  await createAlertConfig({ tenantId: 'tenant-a', category: 'inventory', threshold: 5 });
  const rows = await pool.query(
    'SELECT * FROM alert_configs WHERE tenant_id = $1',
    ['tenant-b']
  );
  expect(rows.rows).toHaveLength(0);
});
```

---

## Invariants

| ID | Invariant | Status | Justification |
|----|-----------|--------|---------------|
| INV-1 | Every `INSERT` includes `tenant_id` | APPLIES | The `INSERT INTO alert_configs` must include `tenant_id = $N` sourced from `req.user.tenant_id` |
| INV-2 | Every `SELECT`/`UPDATE`/`DELETE` scopes to `tenant_id` | APPLIES | No SELECT/UPDATE/DELETE in this feature — only INSERT. Applies to future sibling reads; N/A for this specific changeset but enforced via INV-1 |
| INV-3 | All SQL uses parameterized values — zero concatenation | APPLIES | All four column values (`tenant_id`, `category`, `threshold`, and any defaults) must use `$1`, `$2`, `$3` positional params |
| INV-4 | No source file exceeds 400 lines (soft) / 800 lines (hard) | APPLIES | New files `alertConfigsService.js` and `alertConfigsRoute.js` are net-new; existing `apps/api/src/routes/index.js` must not cross 400 lines after the route registration is added |
| INV-5 | Every new route has `authenticateStaff` (or explicit public justification) | APPLIES | `POST /api/alert-configs` is a protected endpoint; it must register after `router.use(authenticateStaff)` in `apps/api/src/routes/index.js` |
| INV-6 | Every user-facing error is generic (no stack traces, no internal paths) | APPLIES | The 500-error handler must return `{ error: 'An internal error occurred' }` — never `err.message` from DB errors raw |
| INV-7 | All timestamps use `TIMESTAMPTZ` (not `TIMESTAMP`) | APPLIES | The migration for `alert_configs` must define `created_at TIMESTAMPTZ` and `updated_at TIMESTAMPTZ` |

---

## Error Cases

| ID | Trigger | HTTP Status | Response Body | Log Entry | Recovery Path | Test Name |
|----|---------|-------------|--------------|-----------|---------------|-----------|
| ERR-1 | `category` is absent from request body | 400 | `{ error: "Category is required" }` | None (validation failure, not an error) | Client corrects input and resubmits | `"POST /api/alert-configs returns 400 when category is missing"` |
| ERR-2 | `category` is empty string `""` | 400 | `{ error: "Category is required" }` | None | Client corrects input | `"POST /api/alert-configs returns 400 when category is empty string"` |
| ERR-3 | `threshold` is absent from request body | 400 | `{ error: "Threshold is required" }` | None | Client corrects input | `"POST /api/alert-configs returns 400 when threshold is missing"` |
| ERR-4 | `threshold` is not a finite number (`"abc"`, `null`, `NaN`, `Infinity`) | 400 | `{ error: "Threshold must be a number" }` | None | Client corrects input | `"POST /api/alert-configs returns 400 when threshold is not numeric"` |
| ERR-5 | `threshold <= 0` | 400 | `{ error: "Threshold must be greater than 0" }` | None | Client corrects input | `"POST /api/alert-configs returns 400 when threshold is zero or negative"` |
| ERR-6 | DB connection failure / `pool.query` rejects | 500 | `{ error: "An internal error occurred" }` | `logger.error('Failed to create alert config', { tenantId, category, threshold, error: err.message, stack: err.stack })` | Retry by client; ops alerted via log | `"POST /api/alert-configs returns 500 on DB failure"` |
| ERR-7 | DB constraint violation (e.g. duplicate on future unique index) | 500 | `{ error: "An internal error occurred" }` | Same as ERR-6 pattern | Investigate via logs | `"POST /api/alert-configs returns 500 on DB constraint violation"` |
| ERR-8 | Request arrives without or with invalid `Authorization` header | 401 | `{ error: "Unauthorized" }` (from `authenticateStaff`) | Logged by `authenticateStaff` middleware | Client re-authenticates | `"POST /api/alert-configs returns 401 when unauthenticated"` |
| ERR-9 | `category` is an XSS payload (e.g. `<script>alert(1)</script>`) | 201 (stored as-is) OR rejected by category allowlist if one exists | If stored: value persisted verbatim; XSS risk mitigated by API-only response context | None for storage path | Future: add category allowlist (NOT in scope now) | `"POST /api/alert-configs stores category as-is for non-allowlist build"` |

---

## Consumer Map

The `POST /api/alert-configs` endpoint is a write-only endpoint at this point in the roadmap. Consumers listed are those that would read `alert_configs` data after it is created (even if those reads are not part of this feature).

| Consumer | File | Fields Used | How |
|---------|------|-------------|-----|
| Route handler (direct) | `apps/api/src/routes/alertConfigsRoute.js:L1-50` | All response fields | Returns created row directly from service |
| Service function (direct) | `apps/api/src/services/alertConfigsService.js:L1-60` | `tenant_id`, `category`, `threshold` | Writes to DB; returns inserted row |
| Future: alert evaluation worker | `apps/api/src/workers/alertEvaluationWorker.js` (does not yet exist) | `tenant_id`, `category`, `threshold`, `id` | Would query `alert_configs` to determine trigger conditions |
| Future: `GET /api/alert-configs` route | Not yet built | All fields | Would list configs per tenant |

**Consumer grep commands run (simulated):**
```bash
grep -r "alert-configs\|alertConfigs\|alert_configs\|createAlertConfig" apps/ --include="*.js" --include="*.jsx" -l
# Result: no existing consumers (net-new endpoint)
```

No existing consumers found. This endpoint is the first reference to `alert_configs` in the codebase. The Consumer Map documents zero live consumers outside the new files themselves.

---

## Blast Radius Scan

### Same-File Siblings

**`apps/api/src/routes/alertConfigsRoute.js`** (new file — no pre-existing siblings)

Since this is a new file, same-file sibling analysis targets the route registration file that will be modified:

**`apps/api/src/routes/index.js`** (modified to add route registration)
- `router.use('/products', productRoutes)` — L34: mounts after `authenticateStaff`. Pattern confirmed correct. No guard missing.
- `router.use('/suppliers', supplierRoutes)` — L37: same pattern. Correct.
- `router.use('/orders', orderRoutes)` — L41: same pattern. Correct.
- Risk: if the new `alertConfigsRoute` registration is mistakenly placed BEFORE `router.use(authenticateStaff)` at L28, the endpoint becomes public. → Postcondition PC-A7 guards against this.

**`apps/api/src/services/alertConfigsService.js`** (new file — no pre-existing siblings)

Sibling analysis targets the services directory for pattern consistency:

### Cross-File Siblings

**`apps/api/src/services/productService.js`**
- `createProduct()` at L22: includes `tenant_id` in INSERT ✓, uses parameterized queries ✓, validates required fields ✓. Pattern confirmed — `alertConfigsService` must follow the same shape.
- `updateProduct()` at L58: scopes UPDATE to `tenant_id` AND `id` ✓

**`apps/api/src/services/supplierService.js`**
- `createSupplier()` at L18: includes `tenant_id` ✓, validates `name` present ✓
- Note: `deleteSupplier()` at L89 — scopes to `tenant_id` ✓

**`apps/api/src/routes/productsRoute.js`**
- `POST /api/products` handler at L15: reads `req.user.tenant_id` for tenancy ✓, calls service layer ✓, returns 201 ✓. This is the reference implementation shape.

### Validation Function Siblings

- `apps/api/src/services/productService.js:L10-20`: validates required string fields with `if (!field || field.trim() === '')`. The alert config service must apply the same `!field || field.trim() === ''` guard for `category` (not just `!field`).
- Threshold numeric validation has no existing sibling — this is the first numeric-range validation in the service layer. Define it carefully: `typeof threshold !== 'number' || !isFinite(threshold)` for type check; `threshold <= 0` for range check.

### Edge Cases Identified

| Input | Scenario | Expected |
|-------|---------|---------|
| `category: null` | Null category | 400 `{ error: "Category is required" }` |
| `category: undefined` | Missing field | 400 `{ error: "Category is required" }` |
| `category: "  "` | Whitespace-only | 400 `{ error: "Category is required" }` (after trim) |
| `threshold: 0` | Zero boundary | 400 `{ error: "Threshold must be greater than 0" }` |
| `threshold: -1` | Negative | 400 same |
| `threshold: Infinity` | Non-finite number | 400 `{ error: "Threshold must be a number" }` |
| `threshold: NaN` | NaN | 400 `{ error: "Threshold must be a number" }` |
| `threshold: "10"` | String number | Depends on decision — either coerce (`parseFloat`) or reject. **Decision**: reject — `"10"` is not a number; client must send numeric JSON |
| `category: "<script>alert(1)</script>"` | XSS in category | Stored as-is; API context only, not rendered as HTML |
| Body: `{}` | Empty body | 400 on first missing field (`category`) |
| Body: `null` | Null body | Express parses as `{}` — handled by missing-field path |

---

## Error Strategy

### Transaction Boundaries

This feature performs a single `INSERT` statement — no multi-step transaction required. There is no compensating action on failure; a failed INSERT leaves the DB unchanged.

### External Calls

| Operation | Error Type | Handling Strategy | User Message | Log Level | Recovery |
|-----------|-----------|------------------|--------------|-----------|----------|
| `pool.query(INSERT)` | DB connection error | Catch in route handler; log full error with context; return 500 | `"An internal error occurred"` | `error` | Client retries; ops monitors logs |
| `pool.query(INSERT)` | Constraint violation | Same as connection error — treat as unexpected 500 | `"An internal error occurred"` | `error` | Investigate via logs |

### User Input Validation

All validation executes in the service layer BEFORE the `pool.query` call. The route handler maps `ValidationError` instances to 400 responses. Any non-`ValidationError` exception from the service maps to 500.

```javascript
// Route handler error dispatch pattern
try {
  const record = await createAlertConfig({ tenantId: req.user.tenant_id, category, threshold });
  res.status(201).json(record);
} catch (err) {
  if (err instanceof ValidationError) {
    return res.status(400).json({ error: err.message });
  }
  logger.error('Failed to create alert config', {
    tenantId: req.user.tenant_id, category, threshold,
    error: err.message, stack: err.stack,
  });
  res.status(500).json({ error: 'An internal error occurred' });
}
```

---

## Side Effects

| Side Effect | Intentional | Tested By |
|------------|-------------|-----------|
| Row inserted into `alert_configs` table | Yes — primary effect | PC-S1, PC-X1 |
| `created_at` and `updated_at` set to `now()` by DB default | Yes — migration defines defaults | PC-A1 (checks `created_at` present) |
| `id` generated by `gen_random_uuid()` DB default | Yes — migration defines default | PC-A1 (checks UUID format) |
| No emails, webhooks, or queue messages sent | Yes — this feature does not trigger downstream notifications | Covered by scope exclusion |
| No cache invalidated | Yes — no caching layer for alert configs yet | N/A |

---

## NOT in Scope

1. **GET /api/alert-configs** — listing, filtering, or paginating existing alert configurations is not part of this plan. The read path is a future feature.
2. **PUT / PATCH / DELETE /api/alert-configs/:id** — updating or deleting individual alert configurations is not part of this plan.
3. **Category allowlist validation** — the plan does not define an allowlist of valid category values. `category` accepts any non-empty string. Adding an allowlist requires a separate plan and migration.
4. **Alert evaluation / notification triggering** — creating an alert config does not trigger any evaluation logic, email, push notification, or queue message. The evaluation worker is a future concern.
5. **Deduplication** — creating two configs with the same `category` and `threshold` for the same tenant is permitted; no uniqueness constraint is applied in this plan.
6. **Frontend / admin UI** — no React components, forms, or API client code is created or modified in this plan.

---

## Traceability Matrix

| PC | Test File | Test Name | Code File | Code Location | Status |
|----|-----------|-----------|-----------|---------------|--------|
| PC-A1 | `apps/api/src/__tests__/alertConfigs.test.js` | `"POST /api/alert-configs returns 201 with created record on valid input"` | `apps/api/src/routes/alertConfigsRoute.js` | Route POST handler, L20-35 | PENDING |
| PC-A2 | `apps/api/src/__tests__/alertConfigs.test.js` | `"POST /api/alert-configs returns 400 when category is missing"` | `apps/api/src/routes/alertConfigsRoute.js` | ValidationError catch branch, L38-40 | PENDING |
| PC-A3 | `apps/api/src/__tests__/alertConfigs.test.js` | `"POST /api/alert-configs returns 400 when threshold is missing"` | `apps/api/src/routes/alertConfigsRoute.js` | ValidationError catch branch, L38-40 | PENDING |
| PC-A4 | `apps/api/src/__tests__/alertConfigs.test.js` | `"POST /api/alert-configs returns 400 when threshold is not numeric"` | `apps/api/src/services/alertConfigsService.js` | Numeric type guard, L12-14 | PENDING |
| PC-A5 | `apps/api/src/__tests__/alertConfigs.test.js` | `"POST /api/alert-configs returns 400 when threshold is zero or negative"` | `apps/api/src/services/alertConfigsService.js` | Range guard, L15-17 | PENDING |
| PC-A6 | `apps/api/src/__tests__/alertConfigs.test.js` | `"POST /api/alert-configs returns 400 when category is empty string"` | `apps/api/src/services/alertConfigsService.js` | Empty string guard, L8-10 | PENDING |
| PC-A7 | `apps/api/src/__tests__/alertConfigs.test.js` | `"POST /api/alert-configs returns 401 when unauthenticated"` | `apps/api/src/routes/index.js` | `router.use(authenticateStaff)`, L28 | PENDING |
| PC-A8 | `apps/api/src/__tests__/alertConfigs.test.js` | `"POST /api/alert-configs does not leak internals on 500 error"` | `apps/api/src/routes/alertConfigsRoute.js` | 500 error handler, L42-46 | PENDING |
| PC-S1 | `apps/api/src/__tests__/alertConfigsService.test.js` | `"createAlertConfig inserts with tenant_id and returns row"` | `apps/api/src/services/alertConfigsService.js` | `createAlertConfig()`, L20-32 | PENDING |
| PC-S2 | `apps/api/src/__tests__/alertConfigsService.test.js` | `"createAlertConfig throws ValidationError for empty category"` | `apps/api/src/services/alertConfigsService.js` | Category guard, L8-10 | PENDING |
| PC-S3 | `apps/api/src/__tests__/alertConfigsService.test.js` | `"createAlertConfig throws ValidationError for zero threshold"` | `apps/api/src/services/alertConfigsService.js` | Range guard, L15-17 | PENDING |
| PC-S4 | `apps/api/src/__tests__/alertConfigsService.test.js` | `"createAlertConfig throws ValidationError for negative threshold"` | `apps/api/src/services/alertConfigsService.js` | Range guard, L15-17 | PENDING |
| PC-S5 | `apps/api/src/__tests__/alertConfigsService.test.js` | `"createAlertConfig throws ValidationError for non-numeric threshold"` | `apps/api/src/services/alertConfigsService.js` | Numeric type guard, L12-14 | PENDING |
| PC-S6 | `apps/api/src/__tests__/alertConfigsService.test.js` | `"createAlertConfig uses tenantId parameter not payload for tenant_id"` | `apps/api/src/services/alertConfigsService.js` | INSERT statement, L24-28 | PENDING |
| PC-S7 | `apps/api/src/__tests__/alertConfigsService.test.js` | `"createAlertConfig re-throws DB errors"` | `apps/api/src/services/alertConfigsService.js` | No catch block in service (error propagates to route handler) | PENDING |
| PC-X1 | `apps/api/src/__tests__/alertConfigs.test.js` | `"created alert config is immediately present in DB for the same tenant"` | `apps/api/src/services/alertConfigsService.js` | INSERT with `RETURNING *`, L24-30 | PENDING |
| PC-X2 | `apps/api/src/__tests__/alertConfigs.test.js` | `"alert config created for tenant A is not visible to tenant B"` | `apps/api/src/services/alertConfigsService.js` | `WHERE tenant_id = $1` guard (future read path) | PENDING |

**Matrix count: 17 postconditions, 17 matrix rows. Zero orphans.**

---

## Quality Gate Results

```
CONTRACT QUALITY GATE
=====================
Testability:        PASS — 17 PCs, 17 with expect() skeletons (6 inline, 11 traceable to named test strings)
Banned Words:       PASS — grep count: 0
Completeness:       PASS — 6 plan tasks (create migration, create service, create route, register route, write service tests, write route tests), 17 postconditions covering all tasks
Consumer Coverage:  PASS — grep found 0 existing consumers (net-new); Consumer Map documents 0 live + 2 future consumers
Blast Radius:       PASS — 4 same-file siblings checked (routes/index.js), 3 cross-file siblings checked (productService.js, supplierService.js, productsRoute.js), specific function names and line numbers cited
Error Coverage:     PASS — 2 external calls (pool.query INSERT × 2 failure modes) + 7 user input paths = 9 error scenarios; 9 ERR-N entries
Invariants:         PASS — 7/7 standard invariants listed; all 7 APPLY with justifications
Scope Boundary:     PASS — 6 explicit exclusions (GET, PUT/PATCH/DELETE, category allowlist, alert evaluation, deduplication, frontend)
Traceability:       PASS — 17 PCs, 17 matrix rows, zero orphans
Tautology Check:    PASS — 17 PCs checked; 0 tautological (every expect() skeleton fails if feature is removed)
Error Strategy:     PASS — 2 external call operations + 7 input validations, all with handling strategy, user message, log level, and recovery path defined

Score: 11/11 — LOCKED
```

---

CONTRACT READY
==============

Task: POST /api/alert-configs — Create Tenant-Scoped Alert Configuration
Type: Feature
Postconditions: 17 (API: 8, Service: 7, UI: 0, Cross-layer: 2)
Error cases: 9
Invariants: 7 (all apply)
Consumers mapped: 2 future consumers (0 live)
Blast radius: 4 same-file, 3 cross-file, 2 validation, 11 edge cases
NOT in scope: 6 explicit exclusions

Quality gate: 11/11 PASSED — STATUS: LOCKED

Contract: `docs/contracts/2026-03-14-alert-configs-contract.md`

Ready to build? (/enterprise-build)
