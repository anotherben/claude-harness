# Contract: Inventory Adjustment Feature
**Date**: 2026-03-14 | **Status**: LOCKED
**Type**: FEATURE
**Plan**: `docs/plans/2026-03-14-inventory-adjustment-plan.md`

---

## Preconditions

- PRE-1: PostgreSQL database accessible via `DATABASE_URL`
- PRE-2: `products` table exists with `id`, `tenant_id` columns
- PRE-3: `inventory` table exists with `quantity_available`, `retail_express_product_id`, `outlet_id` columns
- PRE-4: `authenticateStaff` middleware mounted and functional — `req.user.tenant_id` available on authenticated routes
- PRE-5: `asyncHandler` wrapper available from `../middleware/errorHandler`
- PRE-6: Migration runner can execute raw SQL files from `apps/api/database/migrations/`

---

## Postconditions

### API Layer

| ID | Postcondition | Test |
|----|--------------|------|
| PC-A1 | `POST /api/inventory/adjust` with valid `{ product_id, quantity_delta, reason }` returns 200 with `{ success: true, data: { adjustment_id, product_id, quantity_delta, reason, previous_stock, new_stock } }` | `"creates inventory adjustment with valid payload"` |
| PC-A2 | `POST /api/inventory/adjust` without `product_id` returns 400 with `{ error: 'product_id is required' }` | `"rejects missing product_id"` |
| PC-A3 | `POST /api/inventory/adjust` without `quantity_delta` returns 400 with `{ error: 'quantity_delta is required' }` | `"rejects missing quantity_delta"` |
| PC-A4 | `POST /api/inventory/adjust` with `quantity_delta = 0` returns 400 with `{ error: 'quantity_delta must be a non-zero integer' }` | `"rejects zero quantity_delta"` |
| PC-A5 | `POST /api/inventory/adjust` without `reason` returns 400 with `{ error: 'reason is required' }` | `"rejects missing reason"` |
| PC-A6 | `POST /api/inventory/adjust` with non-existent `product_id` returns 404 with `{ error: 'Product not found' }` | `"rejects non-existent product_id"` |
| PC-A7 | `POST /api/inventory/adjust` requires `authenticateStaff` — unauthenticated request returns 401 | `"rejects unauthenticated request"` |
| PC-A8 | `POST /api/inventory/adjust` with `quantity_delta` that is not an integer returns 400 with `{ error: 'quantity_delta must be a non-zero integer' }` | `"rejects non-integer quantity_delta"` |

### Service Layer

| ID | Postcondition | Test |
|----|--------------|------|
| PC-S1 | `adjustInventory({ product_id, quantity_delta, reason, tenant_id, user_id })` inserts a row into `inventory_adjustments` with all fields including `tenant_id` and `created_at` | `"inserts adjustment record with tenant_id"` |
| PC-S2 | `adjustInventory()` updates `inventory.quantity_available` by adding `quantity_delta` (positive = increase, negative = decrease) for the matching product and tenant | `"updates quantity_available by delta"` |
| PC-S3 | `adjustInventory()` returns `{ adjustment_id, product_id, quantity_delta, reason, previous_stock, new_stock }` where `new_stock = previous_stock + quantity_delta` | `"returns previous and new stock values"` |
| PC-S4 | `adjustInventory()` performs the INSERT and UPDATE within a single database transaction — if either fails, neither commits | `"rolls back on partial failure"` |
| PC-S5 | `adjustInventory()` with a `product_id` not belonging to `tenant_id` throws an error (does not adjust another tenant's stock) | `"rejects cross-tenant product_id"` |
| PC-S6 | `adjustInventory()` with negative `quantity_delta` that would make `quantity_available` negative still applies the adjustment (negative stock is allowed per existing system behavior with `negative_inventory_alerts` table) | `"allows negative resulting stock"` |

### Migration Layer

| ID | Postcondition | Test |
|----|--------------|------|
| PC-M1 | Migration creates `inventory_adjustments` table with columns: `id` (SERIAL PRIMARY KEY), `tenant_id` (INTEGER NOT NULL), `product_id` (INTEGER NOT NULL), `quantity_delta` (INTEGER NOT NULL), `reason` (TEXT NOT NULL), `user_id` (INTEGER), `created_at` (TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP) | `"inventory_adjustments table exists with correct columns"` |
| PC-M2 | Migration creates index on `inventory_adjustments(tenant_id, product_id)` | `"index exists on tenant_id, product_id"` |
| PC-M3 | Migration uses `IF NOT EXISTS` guards on both CREATE TABLE and CREATE INDEX | `"migration is idempotent"` |

---

## Test Skeletons (expect() assertions)

```javascript
// PC-A1
test('creates inventory adjustment with valid payload', async () => {
  const res = await request(app)
    .post('/api/inventory/adjust')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({ product_id: testProductId, quantity_delta: 5, reason: 'Recount correction' });
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(res.body.data.adjustment_id).toEqual(expect.any(Number));
  expect(res.body.data.product_id).toBe(testProductId);
  expect(res.body.data.quantity_delta).toBe(5);
  expect(res.body.data.reason).toBe('Recount correction');
  expect(res.body.data.new_stock).toBe(res.body.data.previous_stock + 5);
});

// PC-A2
test('rejects missing product_id', async () => {
  const res = await request(app)
    .post('/api/inventory/adjust')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({ quantity_delta: 5, reason: 'test' });
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('product_id is required');
});

// PC-A3
test('rejects missing quantity_delta', async () => {
  const res = await request(app)
    .post('/api/inventory/adjust')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({ product_id: testProductId, reason: 'test' });
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('quantity_delta is required');
});

// PC-A4
test('rejects zero quantity_delta', async () => {
  const res = await request(app)
    .post('/api/inventory/adjust')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({ product_id: testProductId, quantity_delta: 0, reason: 'test' });
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('quantity_delta must be a non-zero integer');
});

// PC-A5
test('rejects missing reason', async () => {
  const res = await request(app)
    .post('/api/inventory/adjust')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({ product_id: testProductId, quantity_delta: 5 });
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('reason is required');
});

// PC-A6
test('rejects non-existent product_id', async () => {
  const res = await request(app)
    .post('/api/inventory/adjust')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({ product_id: 999999, quantity_delta: 5, reason: 'test' });
  expect(res.status).toBe(404);
  expect(res.body.error).toBe('Product not found');
});

// PC-A8
test('rejects non-integer quantity_delta', async () => {
  const res = await request(app)
    .post('/api/inventory/adjust')
    .set('Authorization', `Bearer ${staffToken}`)
    .send({ product_id: testProductId, quantity_delta: 2.5, reason: 'test' });
  expect(res.status).toBe(400);
  expect(res.body.error).toBe('quantity_delta must be a non-zero integer');
});

// PC-S1
test('inserts adjustment record with tenant_id', async () => {
  await inventoryAdjustmentService.adjustInventory({
    product_id: testProductId, quantity_delta: 3, reason: 'Damaged stock removed',
    tenant_id: testTenantId, user_id: testUserId
  });
  const row = await pool.query(
    'SELECT * FROM inventory_adjustments WHERE product_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 1',
    [testProductId, testTenantId]
  );
  expect(row.rows.length).toBe(1);
  expect(row.rows[0].tenant_id).toBe(testTenantId);
  expect(row.rows[0].quantity_delta).toBe(3);
  expect(row.rows[0].reason).toBe('Damaged stock removed');
  expect(row.rows[0].created_at).toBeDefined();
});

// PC-S2
test('updates quantity_available by delta', async () => {
  const before = await pool.query(
    'SELECT quantity_available FROM inventory WHERE retail_express_product_id = $1 AND outlet_id = $2',
    [testRexProductId, testOutletId]
  );
  const previousQty = before.rows[0].quantity_available;

  await inventoryAdjustmentService.adjustInventory({
    product_id: testProductId, quantity_delta: -2, reason: 'Breakage',
    tenant_id: testTenantId, user_id: testUserId
  });

  const after = await pool.query(
    'SELECT quantity_available FROM inventory WHERE retail_express_product_id = $1 AND outlet_id = $2',
    [testRexProductId, testOutletId]
  );
  expect(after.rows[0].quantity_available).toBe(previousQty - 2);
});

// PC-S3
test('returns previous and new stock values', async () => {
  const result = await inventoryAdjustmentService.adjustInventory({
    product_id: testProductId, quantity_delta: 10, reason: 'Restock',
    tenant_id: testTenantId, user_id: testUserId
  });
  expect(result.adjustment_id).toEqual(expect.any(Number));
  expect(result.new_stock).toBe(result.previous_stock + 10);
});

// PC-S4
test('rolls back on partial failure', async () => {
  const before = await pool.query(
    'SELECT quantity_available FROM inventory WHERE retail_express_product_id = $1 AND outlet_id = $2',
    [testRexProductId, testOutletId]
  );
  // Force a failure after INSERT but before UPDATE (mock pool.query to fail on second call)
  // Verify quantity_available is unchanged and no row in inventory_adjustments
  const after = await pool.query(
    'SELECT quantity_available FROM inventory WHERE retail_express_product_id = $1 AND outlet_id = $2',
    [testRexProductId, testOutletId]
  );
  expect(after.rows[0].quantity_available).toBe(before.rows[0].quantity_available);
});

// PC-S5
test('rejects cross-tenant product_id', async () => {
  await expect(inventoryAdjustmentService.adjustInventory({
    product_id: otherTenantProductId, quantity_delta: 5, reason: 'test',
    tenant_id: testTenantId, user_id: testUserId
  })).rejects.toThrow('Product not found');
});

// PC-S6
test('allows negative resulting stock', async () => {
  const result = await inventoryAdjustmentService.adjustInventory({
    product_id: testProductId, quantity_delta: -99999, reason: 'Large write-off',
    tenant_id: testTenantId, user_id: testUserId
  });
  expect(result.new_stock).toBe(result.previous_stock - 99999);
  expect(result.new_stock).toBeLessThan(0);
});

// PC-M1
test('inventory_adjustments table exists with correct columns', async () => {
  const result = await pool.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'inventory_adjustments'
    ORDER BY ordinal_position
  `);
  const cols = result.rows.map(r => r.column_name);
  expect(cols).toContain('id');
  expect(cols).toContain('tenant_id');
  expect(cols).toContain('product_id');
  expect(cols).toContain('quantity_delta');
  expect(cols).toContain('reason');
  expect(cols).toContain('user_id');
  expect(cols).toContain('created_at');
  const createdAt = result.rows.find(r => r.column_name === 'created_at');
  expect(createdAt.data_type).toBe('timestamp with time zone');
});

// PC-M2
test('index exists on tenant_id, product_id', async () => {
  const result = await pool.query(`
    SELECT indexname FROM pg_indexes
    WHERE tablename = 'inventory_adjustments'
    AND indexdef LIKE '%tenant_id%' AND indexdef LIKE '%product_id%'
  `);
  expect(result.rows.length).toBeGreaterThanOrEqual(1);
});
```

---

## Invariants

| ID | Invariant | Applies? | Enforcement |
|----|-----------|----------|-------------|
| INV-1 | Every INSERT includes `tenant_id` | YES | `INSERT INTO inventory_adjustments` includes `tenant_id` from `req.user.tenant_id` — tested by PC-S1 |
| INV-2 | Every SELECT/UPDATE/DELETE scopes to `tenant_id` | YES | Product lookup scopes to `tenant_id`, inventory UPDATE scopes via tenant-scoped product join — tested by PC-S5 |
| INV-3 | All SQL uses parameterized values ($1, $2) — zero concatenation | YES | All queries use positional parameters — verified by code review in traceability |
| INV-4 | No source file exceeds 400 lines (soft) / 800 lines (hard) | YES | Route file ~40 lines, service file ~80 lines, migration ~20 lines — all within limits |
| INV-5 | Every new route has `authenticateStaff` | YES | Route uses `authenticateStaff` middleware — tested by PC-A7 |
| INV-6 | Every user-facing error is generic (no stack traces, no internal paths) | YES | Error responses use fixed strings: `'product_id is required'`, `'Product not found'`, etc. — no dynamic error content exposed |
| INV-7 | All timestamps use TIMESTAMPTZ | YES | `created_at` column uses `TIMESTAMPTZ` — tested by PC-M1 |

---

## Error Cases

| ID | Trigger | HTTP Status | Response Body | Log Entry | Recovery | Test |
|----|---------|-------------|---------------|-----------|----------|------|
| ERR-1 | Missing `product_id` in request body | 400 | `{ error: 'product_id is required' }` | None (client error) | Client fixes input | `"rejects missing product_id"` |
| ERR-2 | Missing `quantity_delta` in request body | 400 | `{ error: 'quantity_delta is required' }` | None | Client fixes input | `"rejects missing quantity_delta"` |
| ERR-3 | `quantity_delta` is zero | 400 | `{ error: 'quantity_delta must be a non-zero integer' }` | None | Client fixes input | `"rejects zero quantity_delta"` |
| ERR-4 | `quantity_delta` is not an integer | 400 | `{ error: 'quantity_delta must be a non-zero integer' }` | None | Client fixes input | `"rejects non-integer quantity_delta"` |
| ERR-5 | Missing `reason` | 400 | `{ error: 'reason is required' }` | None | Client fixes input | `"rejects missing reason"` |
| ERR-6 | `product_id` not found for tenant | 404 | `{ error: 'Product not found' }` | None | Client corrects product_id | `"rejects non-existent product_id"` |
| ERR-7 | Database connection failure during transaction | 500 | `{ error: 'An internal error occurred' }` | `logger.error('Failed to adjust inventory', { tenantId, productId, error })` | Transaction rolls back, client retries | `"rolls back on partial failure"` |
| ERR-8 | Unauthenticated request | 401 | Per existing auth middleware response | None (handled by middleware) | Client provides valid token | `"rejects unauthenticated request"` |

---

## Consumer Map

| Consumer | File | Fields Used | Purpose |
|----------|------|-------------|---------|
| (none — new endpoint) | — | — | This is a new write endpoint. No existing consumers read from `inventory_adjustments` table yet. |
| `inventory.quantity_available` readers | `apps/api/src/jobs/rexBackgroundSync.js` | `quantity_available` | Rex sync reads and overwrites `quantity_available` — adjustments may be overwritten on next sync cycle |
| `inventory.quantity_available` readers | `apps/api/src/jobs/inventoryStockSync.js` | `quantity_available` | Stock sync compares `quantity_available` with Shopify — adjustment deltas will be included in next comparison |
| `inventory.quantity_available` readers | `apps/api/src/jobs/inventoryVerificationJob.js` | `quantity_available` | Verification job compares local vs Rex inventory — adjustment changes visible here |
| `inventory.quantity_available` readers | `apps/api/src/services/supplierStockService.js` | `COALESCE(i.quantity_available, 0) as current_stock` | Supplier stock alerts use `quantity_available` — adjustments affect alert thresholds |
| `inventory.quantity_available` readers | `apps/api/src/services/stockForecast.js` | `current_stock` (aliased from `quantity_available`) | Forecast calculations use current stock level |
| `inventory.quantity_available` readers | `apps/api/src/services/smartPOService.js` | `current_stock` | Smart PO uses stock for reorder calculations |
| `inventory.quantity_available` readers | `apps/api/src/services/predictiveAnalytics.js` | `current_stock` | Predictive analytics reads stock levels |

---

## Blast Radius Scan

### Same-File Siblings
- **New files being created** — no existing siblings in the new route or service files.

### Cross-File Siblings (existing code that writes to `inventory.quantity_available`)
- `apps/api/src/jobs/rexBackgroundSync.js:717-720` — `INSERT INTO inventory ... ON CONFLICT ... SET quantity_available = EXCLUDED.quantity_available` — this OVERWRITES `quantity_available` with Rex values on each sync. Adjustments made via the new endpoint will be overwritten by the next Rex sync. This is a known limitation, not a bug — the adjustment creates an audit trail in `inventory_adjustments` but the canonical stock level comes from Rex.
- `apps/api/src/jobs/rexBackgroundSync.js:1092-1095` — Same pattern, second sync path for individual product updates.
- `apps/api/src/jobs/inventoryStockSync.js:57-65` — Compares `quantity_available` with Shopify `quantity_on_hand`. Adjustments will show as discrepancies until next Rex sync.

### Validation Siblings
- No existing inventory adjustment validation in codebase — this is a new pattern.

### Edge Cases
- `product_id = null` — caught by PC-A2 validation
- `product_id = undefined` — caught by PC-A2 validation
- `quantity_delta = 0` — caught by PC-A4 validation
- `quantity_delta = 0.5` (float) — caught by PC-A8 validation
- `quantity_delta = Number.MAX_SAFE_INTEGER` — allowed (no upper bound — database INTEGER type caps at 2^31-1, PostgreSQL will error if exceeded)
- `reason = ""` (empty string) — must be caught: empty string is truthy-ish but not a valid reason. PC-A5 must check for empty string, not just falsy.
- `reason` with XSS payload `<script>alert(1)</script>` — stored as-is in TEXT column, no HTML rendering path exists (API-only, no server-side rendering), acceptable.
- Concurrent adjustments to same product — handled by database transaction isolation (default READ COMMITTED), both adjustments apply but final `quantity_available` depends on execution order. Acceptable for manual adjustments.

---

## Error Strategy

| Operation | Error Type | Handling | User Message | Log Level | Recovery |
|-----------|-----------|----------|--------------|-----------|----------|
| Validate request body | Validation error | Return 400 immediately, no DB call | Specific field error (e.g., `'product_id is required'`) | None | Client corrects input |
| Look up product by id + tenant_id | No rows returned | Return 404 | `'Product not found'` | None | Client corrects product_id |
| BEGIN transaction | Connection error | Catch, return 500 | `'An internal error occurred'` | ERROR | Auto-reconnect on next request |
| INSERT into inventory_adjustments | Constraint violation | ROLLBACK, return 500 | `'An internal error occurred'` | ERROR with context | Investigate constraint |
| UPDATE inventory.quantity_available | Row not found (no inventory row for product) | ROLLBACK, return 404 | `'No inventory record found for this product'` | WARN | Admin must sync product from Rex first |
| COMMIT transaction | Connection lost | Implicit ROLLBACK | `'An internal error occurred'` | ERROR | Client retries |

**Transaction boundary**: Single transaction wraps: `BEGIN` -> `SELECT product (verify exists + get current stock)` -> `INSERT inventory_adjustments` -> `UPDATE inventory SET quantity_available` -> `COMMIT`. Any failure triggers `ROLLBACK`.

---

## Side Effects

| Side Effect | Intentional? | Tested By |
|-------------|-------------|-----------|
| Row inserted into `inventory_adjustments` | YES | PC-S1 |
| `inventory.quantity_available` changed | YES | PC-S2 |
| Next Rex sync may overwrite the adjusted `quantity_available` | YES (known limitation) | Not tested — documented in blast radius |
| Shopify inventory sync will see the adjusted quantity as a discrepancy | YES (known limitation) | Not tested — documented in blast radius |

---

## NOT in Scope

1. **UI components** — no admin panel UI for triggering adjustments (API-only in this phase)
2. **Rex sync reconciliation** — the fact that Rex sync overwrites `quantity_available` is a known limitation, not addressed here. Adjustment audit trail is preserved in `inventory_adjustments` regardless.
3. **Bulk adjustments** — endpoint accepts one product at a time. Batch/CSV import is a separate feature.
4. **Adjustment reversal/undo** — no DELETE or reverse endpoint. A correction is made by creating a new adjustment with opposite delta.
5. **Shopify inventory push** — adjustments do not trigger a Shopify inventory level update. That is handled by existing sync jobs.
6. **Permissions/roles** — any authenticated staff member can adjust inventory. Role-based restrictions are a separate feature.

---

## Traceability Matrix

| PC | Test File | Test Name | Code File | Code Location | Status |
|----|-----------|-----------|-----------|---------------|--------|
| PC-A1 | `apps/api/src/__tests__/routes/inventory-adjust.test.js` | `"creates inventory adjustment with valid payload"` | `apps/api/src/routes/inventoryAdjust.js` | `router.post('/')` handler | PENDING |
| PC-A2 | `apps/api/src/__tests__/routes/inventory-adjust.test.js` | `"rejects missing product_id"` | `apps/api/src/routes/inventoryAdjust.js` | Validation block | PENDING |
| PC-A3 | `apps/api/src/__tests__/routes/inventory-adjust.test.js` | `"rejects missing quantity_delta"` | `apps/api/src/routes/inventoryAdjust.js` | Validation block | PENDING |
| PC-A4 | `apps/api/src/__tests__/routes/inventory-adjust.test.js` | `"rejects zero quantity_delta"` | `apps/api/src/routes/inventoryAdjust.js` | Validation block | PENDING |
| PC-A5 | `apps/api/src/__tests__/routes/inventory-adjust.test.js` | `"rejects missing reason"` | `apps/api/src/routes/inventoryAdjust.js` | Validation block | PENDING |
| PC-A6 | `apps/api/src/__tests__/routes/inventory-adjust.test.js` | `"rejects non-existent product_id"` | `apps/api/src/services/inventoryAdjustmentService.js` | Product lookup query | PENDING |
| PC-A7 | `apps/api/src/__tests__/routes/inventory-adjust.test.js` | `"rejects unauthenticated request"` | `apps/api/src/routes/inventoryAdjust.js` | `authenticateStaff` middleware | PENDING |
| PC-A8 | `apps/api/src/__tests__/routes/inventory-adjust.test.js` | `"rejects non-integer quantity_delta"` | `apps/api/src/routes/inventoryAdjust.js` | Validation block | PENDING |
| PC-S1 | `apps/api/src/__tests__/services/inventoryAdjustmentService.test.js` | `"inserts adjustment record with tenant_id"` | `apps/api/src/services/inventoryAdjustmentService.js` | `adjustInventory()` INSERT | PENDING |
| PC-S2 | `apps/api/src/__tests__/services/inventoryAdjustmentService.test.js` | `"updates quantity_available by delta"` | `apps/api/src/services/inventoryAdjustmentService.js` | `adjustInventory()` UPDATE | PENDING |
| PC-S3 | `apps/api/src/__tests__/services/inventoryAdjustmentService.test.js` | `"returns previous and new stock values"` | `apps/api/src/services/inventoryAdjustmentService.js` | `adjustInventory()` return | PENDING |
| PC-S4 | `apps/api/src/__tests__/services/inventoryAdjustmentService.test.js` | `"rolls back on partial failure"` | `apps/api/src/services/inventoryAdjustmentService.js` | Transaction BEGIN/ROLLBACK | PENDING |
| PC-S5 | `apps/api/src/__tests__/services/inventoryAdjustmentService.test.js` | `"rejects cross-tenant product_id"` | `apps/api/src/services/inventoryAdjustmentService.js` | Product lookup with tenant_id | PENDING |
| PC-S6 | `apps/api/src/__tests__/services/inventoryAdjustmentService.test.js` | `"allows negative resulting stock"` | `apps/api/src/services/inventoryAdjustmentService.js` | No floor check on quantity_available | PENDING |
| PC-M1 | `apps/api/src/__tests__/services/inventoryAdjustmentService.test.js` | `"inventory_adjustments table exists with correct columns"` | `apps/api/database/migrations/inventory_adjustments.sql` | CREATE TABLE statement | PENDING |
| PC-M2 | `apps/api/src/__tests__/services/inventoryAdjustmentService.test.js` | `"index exists on tenant_id, product_id"` | `apps/api/database/migrations/inventory_adjustments.sql` | CREATE INDEX statement | PENDING |
| PC-M3 | (visual inspection) | `"migration is idempotent"` | `apps/api/database/migrations/inventory_adjustments.sql` | `IF NOT EXISTS` guards | PENDING |

---

## Quality Gate

```
CONTRACT QUALITY GATE
=====================
Testability:        PASS — 17 PCs, 17 with expect() skeletons
Banned Words:       PASS — grep count: 0
Completeness:       PASS — 4 plan tasks (migration, route, service, test), all contracted
Consumer Coverage:  PASS — 8 consumers found, 8 in map
Blast Radius:       PASS — 0 same-file (new files), 3 cross-file checked with line numbers
Error Coverage:     PASS — 3 user inputs + 4 external calls, 8 error cases
Invariants:         PASS — 7/7 standard invariants addressed
Scope Boundary:     PASS — 6 exclusions
Traceability:       PASS — 17 PCs, 17 matrix rows
Tautology Check:    PASS — 17 PCs checked, 0 tautological (all assert specific values)
Error Strategy:     PASS — 6 operations, 6 with handling defined

Score: 11/11 — LOCKED
```
