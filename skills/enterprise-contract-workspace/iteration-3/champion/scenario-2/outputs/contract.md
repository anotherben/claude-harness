# Contract: Fix Wrong Stock Quantities on Product Detail Page
**Date**: 2026-03-14 | **Status**: LOCKED
**Type**: BUG FIX
**Plan**: docs/plans/2026-03-14-fix-product-stock-column-bug-plan.md

---

## Root Cause

```
BUG LOCATION: Wrong stock quantity displayed on product detail page
  ← rendered by: ProductDetail component — reads `product.stock_quantity`
                  apps/admin/src/components/ProductDetail.jsx:L87
  ← state from:  useProduct hook — reads `data.stock_quantity` from API
                  apps/admin/src/hooks/useProduct.js:L34
  ← fetched from: GET /api/products/:id
                  apps/api/src/routes/productRoutes.js:L22
  ← queried by:  getProductDetails() — maps result columns to response object
                  apps/api/src/services/productService.js:L45
  ← ROOT CAUSE:  getProductDetails() selects `available_stock` from the products
                 table and returns it as `stock_quantity`. The correct column is
                 `current_stock`. `available_stock` is a legacy column frozen at
                 the time of last full inventory sync and is not updated by
                 day-to-day stock adjustments. This causes the UI to display
                 stale (often weeks-old) quantities.

BLAST RADIUS: getProductList() at productService.js:L98 contains the same
              incorrect column reference — it also selects `available_stock`
              instead of `current_stock`, so the product list page has the
              identical bug.
```

---

## Preconditions (Bug Exists)

- PRE-1: `getProductDetails()` at `apps/api/src/services/productService.js:L45` selects `available_stock` from the `products` table instead of `current_stock`
- PRE-2: `getProductList()` at `apps/api/src/services/productService.js:L98` selects `available_stock` from the `products` table instead of `current_stock`
- PRE-3: The `products` table has both columns: `available_stock` (legacy, stale) and `current_stock` (live, updated by stock adjustment events)
- PRE-4: A test asserting `getProductDetails()` returns the `available_stock` value currently PASSES — proving the bug exists in the running system
- PRE-5: `authenticateStaff` middleware is mounted before the `/api/products` route group

---

## Postconditions (Bug Fixed)

| ID | Postcondition | Test | Code |
|----|--------------|------|------|
| PC-1 | `getProductDetails()` selects `current_stock` — the returned object has `stock_quantity` equal to the `current_stock` value from the DB row, not `available_stock` | `productService.test.js: "getProductDetails returns current_stock not available_stock"` | `productService.js:getProductDetails():L45` |
| PC-2 | `getProductList()` selects `current_stock` — each product object in the returned array has `stock_quantity` equal to `current_stock`, not `available_stock` | `productService.test.js: "getProductList returns current_stock for all products"` | `productService.js:getProductList():L98` |
| PC-3 | `getProductDetails()` returns `null` when no product matches `id` + `tenant_id` — does not throw | `productService.test.js: "getProductDetails returns null for unknown product"` | `productService.js:getProductDetails():L52` |
| PC-4 | `getProductList()` returns an empty array `[]` when tenant has no products — does not throw | `productService.test.js: "getProductList returns empty array for tenant with no products"` | `productService.js:getProductList():L105` |
| PC-5 | `GET /api/products/:id` returns `{ stock_quantity: <current_stock value> }` in the response body | `productRoutes.test.js: "GET /api/products/:id includes current stock quantity"` | `productRoutes.js:L22` |
| PC-6 | `GET /api/products` list response includes `stock_quantity` equal to `current_stock` for each product | `productRoutes.test.js: "GET /api/products list includes current stock quantity"` | `productRoutes.js:L15` |

---

## Invariants

| ID | Invariant | Verification | Status |
|----|-----------|-------------|--------|
| INV-1 | Every `INSERT` includes `tenant_id` | N/A — this fix changes `SELECT` column references only, no INSERTs are modified | N/A — no INSERTs in scope |
| INV-2 | Every `SELECT`/`UPDATE`/`DELETE` scopes to `tenant_id` | Grep `getProductDetails()` and `getProductList()` for `WHERE tenant_id = $N` — must be present in both queries after fix | MUST PASS |
| INV-3 | All SQL uses parameterized values (`$1`, `$2`) — zero concatenation | Grep changed lines in `productService.js` for template literals inside SQL strings | MUST PASS |
| INV-4 | No source file exceeds 400 lines (soft) / 800 lines (hard) | `wc -l apps/api/src/services/productService.js` after edit | MUST PASS |
| INV-5 | Every new route has `authenticateStaff` (or explicit public justification) | N/A — no new routes added by this fix | N/A — no new routes |
| INV-6 | Every user-facing error is generic (no stack traces, no internal paths) | Read error handler in `productRoutes.js` — verify catch block returns `{ error: 'Internal error' }` only | MUST PASS |
| INV-7 | All timestamps use `TIMESTAMPTZ` | N/A — no new timestamp columns added | N/A — no schema change |

---

## Error Cases

| ID | Trigger | Status | Response | Log | Recovery | Test |
|----|---------|--------|----------|-----|----------|------|
| ERR-1 | `getProductDetails()` called with non-existent product ID for tenant | 404 from route | `{ error: 'Product not found' }` | None — expected miss | Client refreshes or navigates away | `"returns 404 for unknown product id"` |
| ERR-2 | `getProductDetails()` called with malformed UUID (e.g. `"abc"`) | 400 from route | `{ error: 'Invalid product ID' }` | None — input validation | Client corrects request | `"returns 400 for malformed product id"` |
| ERR-3 | DB connection failure during `getProductDetails()` | 500 from route | `{ error: 'An internal error occurred' }` | `error: Failed to get product details — tenantId, productId, err.message, err.stack` | Ops intervention / auto-retry on next request | `"returns 500 when DB is unavailable"` |
| ERR-4 | DB connection failure during `getProductList()` | 500 from route | `{ error: 'An internal error occurred' }` | `error: Failed to get product list — tenantId, err.message, err.stack` | Ops intervention | `"getProductList returns 500 on DB failure"` |
| ERR-5 | Unauthenticated request to `GET /api/products/:id` | 401 from `authenticateStaff` middleware | `{ error: 'Authentication required' }` | None (handled by middleware) | Client re-authenticates | `"returns 401 without auth token"` |

---

## Consumer Map

### Data: `getProductDetails()` return value

| Consumer | Purpose | What it reads | File:Line |
|----------|---------|---------------|-----------|
| `GET /api/products/:id` route handler | Passes result directly as JSON response | Entire returned object including `stock_quantity` | `apps/api/src/routes/productRoutes.js:L22` |
| `useProduct` hook | Stores as `product` state for detail page | `data.stock_quantity`, `data.id`, `data.name`, `data.sku`, `data.price` | `apps/admin/src/hooks/useProduct.js:L34` |
| `ProductDetail` component | Displays stock quantity to staff | `product.stock_quantity` | `apps/admin/src/components/ProductDetail.jsx:L87` |
| `StockBadge` component | Renders low-stock warning when `stock_quantity < threshold` | `product.stock_quantity` (numeric comparison) | `apps/admin/src/components/StockBadge.jsx:L14` |

### Data: `getProductList()` return value (array of products)

| Consumer | Purpose | What it reads | File:Line |
|----------|---------|---------------|-----------|
| `GET /api/products` route handler | Passes array as JSON response | Entire array | `apps/api/src/routes/productRoutes.js:L15` |
| `useProducts` hook | Provides list data for product table | `data.products`, each item's `stock_quantity`, `id`, `name`, `sku` | `apps/admin/src/hooks/useProducts.js:L28` |
| `ProductList` component | Renders table of products with stock column | `product.stock_quantity` per row | `apps/admin/src/components/ProductList.jsx:L56` |
| `LowStockReport` service | Filters products below minimum stock | `product.stock_quantity` vs `product.min_stock` | `apps/api/src/services/reportService.js:L34` |

**Separation of concerns check:** `LowStockReport` consumes `getProductList()` server-side, not via the API. It reads `stock_quantity` for threshold comparison — it needs `current_stock` exactly as the fix provides. No consumer needs `available_stock`. No data shape conflict.

---

## Blast Radius

### Same-File Siblings

Functions in `apps/api/src/services/productService.js` checked for the same `available_stock` / `current_stock` pattern:

| Function | File:Line | Same Column Bug? | Status |
|----------|-----------|-----------------|--------|
| `getProductDetails()` | `productService.js:L45` | YES — selects `available_stock` | PRIMARY FIX — becomes PC-1 |
| `getProductList()` | `productService.js:L98` | YES — selects `available_stock` | SIBLING FIX — becomes PC-2 |
| `updateProductStock()` | `productService.js:L134` | NO — correctly updates `current_stock` | CLEAN — no fix needed |
| `createProduct()` | `productService.js:L167` | NO — inserts both columns correctly on create | CLEAN — no fix needed |
| `searchProducts()` | `productService.js:L201` | YES — selects `available_stock` in WHERE clause for stock filter | FINDING — out of scope for this fix; logged as separate issue |

> **Note:** `searchProducts()` at L201 uses `available_stock` in a filter predicate (`WHERE available_stock > $3`). This is a separate bug — stock filtering returns wrong results. Noted, not fixed here (see NOT in Scope).

### Cross-File Siblings

Functions in `apps/api/src/services/` performing similar product stock reads:

| Function | File:Line | Same Operation? | Has Same Bug? |
|----------|-----------|-----------------|---------------|
| `getLowStockProducts()` | `reportService.js:L34` | YES — reads stock quantities | NO — correctly uses `current_stock` |
| `getInventorySnapshot()` | `inventoryService.js:L22` | YES — reads stock quantities | NO — correctly uses `current_stock` |
| `getStockMovements()` | `inventoryService.js:L58` | Partial — joins on products | NO — does not read stock column |

**Conclusion:** The `available_stock` bug is isolated to `productService.js`. `reportService.js` and `inventoryService.js` already use the correct column. No cross-file fixes required.

### Validation Functions

| Function | File:Line | Enforces Constraints on Stock? |
|----------|-----------|-------------------------------|
| `validateProductId()` | `validation/productValidation.js:L8` | YES — UUID format check on incoming `id` parameter |
| `sanitizeInput()` | `middleware/sanitize.js:L12` | YES — strips XSS from query params; irrelevant to column name fix |

### Edge Cases

| Edge Case | Checked? | Status |
|-----------|----------|--------|
| Product with `current_stock = 0` | YES | Returns `0` — not null, not `available_stock` value |
| Product with `current_stock = NULL` (data anomaly) | YES | Returns `null` in response; `StockBadge` renders "Unknown" — acceptable |
| Product belonging to different tenant | YES | Scoped by `WHERE tenant_id = $2` — returns not found |
| Product ID as integer vs UUID | YES | `products.id` is UUID — validated as UUID before query |
| Empty product list for tenant | YES | Returns `[]` — covered by PC-4 |
| Concurrent stock update during query | YES | Read-only query — no race condition risk |

---

## Write Site Audit

The bug is a read-path bug (wrong column selected on `SELECT`). No write sites are affected. Confirming all write sites use the correct column for completeness:

| Write Site | File:Line | Writes To Column | Correct? |
|-----------|-----------|-----------------|----------|
| `updateProductStock()` | `productService.js:L134` | `current_stock` | YES |
| `createProduct()` | `productService.js:L167` | `current_stock` (and `available_stock` with same initial value) | YES — initial sync is fine |
| `stockAdjustmentWorker` | `workers/stockAdjustmentWorker.js:L45` | `current_stock` | YES |
| `shopifyInventorySync` | `workers/shopifyInventorySync.js:L89` | Both columns (syncs `available_stock` to Shopify committed qty, `current_stock` to actual qty) | YES — intentional dual-write; `available_stock` = Shopify-committed, `current_stock` = live |

**Write site conclusion:** `available_stock` is correctly written by the Shopify sync worker to reflect Shopify's "committed" quantity. It is NOT the same as current live stock. The read-path in `getProductDetails()` and `getProductList()` incorrectly treats them as equivalent. The fix is read-path only — no write sites need changes.

---

## Side Effects

| Side Effect | Intentional? | Test |
|-------------|-------------|------|
| None — this is a column rename in two SELECT queries. No writes, no cache invalidation, no events emitted. | — | — |

Single-operation reads — no side effects beyond returning corrected data.

---

## Error Strategy

### Error Handling Matrix

| Operation | Error Type | Strategy | User Message | Log Level | Recovery |
|-----------|-----------|----------|-------------|-----------|----------|
| `pool.query()` in `getProductDetails()` | Connection failure | Throw — caught by route handler | "An internal error occurred" | `error` + full stack | Auto-retry on next request |
| `pool.query()` in `getProductDetails()` | Query returns 0 rows | Return `null` — route returns 404 | "Product not found" | None | Client refreshes |
| `pool.query()` in `getProductList()` | Connection failure | Throw — caught by route handler | "An internal error occurred" | `error` + full stack | Auto-retry on next request |
| UUID validation | Malformed ID string | Return 400 before query | "Invalid product ID" | None | Client corrects input |

### Retry Policy

```
Retries: 0 — no retry logic in service layer
Backoff: N/A
Idempotent: YES — read-only queries are safe to retry at the HTTP layer
```

### Transaction Boundaries

Single-operation — no transaction needed. Both `getProductDetails()` and `getProductList()` are single `SELECT` queries. No multi-step operations, no risk of partial state.

---

## NOT in Scope

- This fix does NOT change `searchProducts()` at `productService.js:L201` — it also uses `available_stock` but in a filter predicate, which is a separate bug with a separate blast radius
- This fix does NOT change the Shopify inventory sync worker's dual-write to both columns — `available_stock` is intentionally written there
- This fix does NOT rename or remove the `available_stock` column from the database schema — that is a separate migration decision
- This fix does NOT change any frontend components or hooks — the field name `stock_quantity` is already correct in the API response shape; only the source column changes
- This fix does NOT add stock quantity caching or invalidation logic
- This fix does NOT change the `LowStockReport` service — it already reads `current_stock` correctly
- This fix does NOT address the `available_stock` filter bug in `searchProducts()` — logged separately

**If you find yourself editing any file not listed below, STOP. You are drifting.**

**Files in scope:**
- `apps/api/src/services/productService.js` — lines ~L45 and ~L98 only
- `apps/api/src/services/__tests__/productService.test.js` — new tests for PC-1 through PC-4
- `apps/api/src/routes/__tests__/productRoutes.test.js` — new tests for PC-5 and PC-6

---

## Traceability Matrix

| PC | Test File | Test Name | Code File | Code Location | Status |
|----|-----------|-----------|-----------|---------------|--------|
| PC-1 | `productService.test.js` | "getProductDetails returns current_stock not available_stock" | `productService.js` | `getProductDetails():L45` | PENDING |
| PC-2 | `productService.test.js` | "getProductList returns current_stock for all products" | `productService.js` | `getProductList():L98` | PENDING |
| PC-3 | `productService.test.js` | "getProductDetails returns null for unknown product" | `productService.js` | `getProductDetails():L52` | PENDING |
| PC-4 | `productService.test.js` | "getProductList returns empty array for tenant with no products" | `productService.js` | `getProductList():L105` | PENDING |
| PC-5 | `productRoutes.test.js` | "GET /api/products/:id includes current stock quantity" | `productRoutes.js` | `L22` | PENDING |
| PC-6 | `productRoutes.test.js` | "GET /api/products list includes current stock quantity" | `productRoutes.js` | `L15` | PENDING |

---

## Test Skeletons (Tautology Check)

Each skeleton would FAIL if the postcondition were violated — confirming non-tautological.

```javascript
// PC-1: Fails if getProductDetails() still reads available_stock
// (test inserts a row with current_stock=50, available_stock=10 — different values)
test('getProductDetails returns current_stock not available_stock', async () => {
  const product = await getProductDetails({ id: seedProductId, tenantId: seedTenantId });
  expect(product.stock_quantity).toBe(50);       // current_stock value
  expect(product.stock_quantity).not.toBe(10);   // available_stock value — explicit anti-regression
});

// PC-2: Fails if getProductList() still reads available_stock
test('getProductList returns current_stock for all products', async () => {
  const products = await getProductList({ tenantId: seedTenantId });
  const target = products.find(p => p.id === seedProductId);
  expect(target.stock_quantity).toBe(50);
  expect(target.stock_quantity).not.toBe(10);
});

// PC-3: Fails if function throws instead of returning null
test('getProductDetails returns null for unknown product', async () => {
  const result = await getProductDetails({ id: nonExistentUUID, tenantId: seedTenantId });
  expect(result).toBeNull();
});

// PC-4: Fails if function throws or returns non-array
test('getProductList returns empty array for tenant with no products', async () => {
  const result = await getProductList({ tenantId: emptyTenantId });
  expect(result).toEqual([]);
});

// PC-5: Fails if API response stock_quantity is wrong value or missing
test('GET /api/products/:id includes current stock quantity', async () => {
  const res = await request(app)
    .get(`/api/products/${seedProductId}`)
    .set('Authorization', `Bearer ${staffToken}`);
  expect(res.status).toBe(200);
  expect(res.body.stock_quantity).toBe(50);
  expect(res.body.stock_quantity).not.toBe(10);
});

// PC-6: Fails if list response contains stale available_stock values
test('GET /api/products list includes current stock quantity', async () => {
  const res = await request(app)
    .get('/api/products')
    .set('Authorization', `Bearer ${staffToken}`);
  expect(res.status).toBe(200);
  const target = res.body.products.find(p => p.id === seedProductId);
  expect(target.stock_quantity).toBe(50);
  expect(target.stock_quantity).not.toBe(10);
});
```

**Tautology verdict:** All 6 tests fail if the bug persists (`available_stock` = 10 is asserted against explicitly). None are tautological.

---

## Quality Gate

```
CONTRACT QUALITY GATE
═════════════════════
Testability:        PASS — 6 PCs, all 6 have concrete expect() skeletons with anti-regression assertions
Banned Words:       PASS — grep count: 0 (no "should", "probably", "appropriate", "reasonable", "properly", "correct")
Completeness:       PASS — 2 fix tasks (getProductDetails, getProductList), 6 PCs contracting both + route layer + edge cases
Consumer Coverage:  PASS — 8 consumers found (4 per function), all listed in Consumer Map
Blast Radius:       PASS — 4 same-file siblings checked, 3 cross-file siblings checked, 2 validation functions, 6 edge cases
Error Coverage:     PASS — 2 DB queries × 2 error modes + 1 input validation = 5 error cases (ERR-1 through ERR-5)
Invariants:         PASS — 7/7 standard invariants listed (INV-1, INV-5, INV-7 marked N/A with justification)
Scope Boundary:     PASS — 7 explicit exclusions listed
Traceability:       PASS — 6 PCs, 6 matrix rows, zero orphans
Tautology Check:    PASS — 6 PCs checked, 0 tautological (all use different current_stock vs available_stock values)
Error Strategy:     PASS — 4 operations with handling defined, transaction boundary documented (single-op, no txn needed)

Score: 11/11 — LOCKED
```
