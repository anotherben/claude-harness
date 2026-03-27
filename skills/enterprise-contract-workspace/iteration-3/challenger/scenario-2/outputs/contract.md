# Contract: Fix Wrong Stock Quantity on Product Detail Page
**Date**: 2026-03-14 | **Status**: LOCKED
**Type**: BUG FIX
**Slug**: fix-product-stock-column

---

## Root Cause

```
BUG LOCATION: Product detail page shows wrong stock quantity (e.g., 0 when stock is 42)
  <- rendered by: ProductDetail component — apps/admin/src/pages/ProductDetail.jsx:L87
  <- state from: useProduct hook — apps/admin/src/hooks/useProduct.js:L34
  <- fetched from: GET /api/products/:id
  <- queried by: getProductDetails() — apps/api/src/services/productService.js:L45
  <- ROOT CAUSE: query selects `available_stock` (stale column, reflects reservations subtracted)
                 instead of `current_stock` (authoritative inventory column). Both columns exist
                 on the products table; `available_stock` is populated by a separate reservation
                 sync job and frequently lags. `current_stock` is the single source of truth
                 for on-hand quantity.
```

---

## Preconditions (Bug Exists)

- PRE-1: `getProductDetails()` at `apps/api/src/services/productService.js:L45` selects `available_stock` instead of `current_stock` in its SQL query
- PRE-2: `getProductList()` at `apps/api/src/services/productService.js:L112` selects `available_stock` instead of `current_stock` — same defect in sibling function confirmed by blast radius scan
- PRE-3: A test asserting that `getProductDetails()` returns the `available_stock` value PASSES today (proving the bug exists and is currently undetected by the test suite)

---

## Postconditions (Bug Fixed)

| ID | Postcondition | Test | Code |
|----|--------------|------|------|
| PC-S-1 | `getProductDetails()` returns `current_stock` value — when a product has `current_stock = 42` and `available_stock = 0`, the response includes `{ stock: 42 }` | `"getProductDetails returns current_stock not available_stock"` | `apps/api/src/services/productService.js:L45` |
| PC-S-2 | `getProductList()` returns `current_stock` for every product in the list — when products have `current_stock = [10, 25]` and `available_stock = [0, 0]`, each list item includes the correct `current_stock` value | `"getProductList returns current_stock not available_stock"` | `apps/api/src/services/productService.js:L112` |
| PC-S-3 | `getProductDetails()` returns `current_stock = 0` when a product genuinely has zero stock — does not return null or undefined | `"getProductDetails handles zero stock gracefully"` | `apps/api/src/services/productService.js:L45` |
| PC-S-4 | `getProductDetails()` scopes query to `tenant_id` — a product owned by tenant B is not returned when requested by tenant A | `"getProductDetails does not leak across tenants"` | `apps/api/src/services/productService.js:L45` |
| PC-A-1 | `GET /api/products/:id` returns `{ stock: 42 }` in the response body when the product's `current_stock = 42` | `"GET /api/products/:id returns current_stock in response"` | `apps/api/src/routes/products.js:L23` |
| PC-A-2 | `GET /api/products` (list endpoint) returns `current_stock` for each product — list item shape includes `{ id, name, stock }` where `stock` reflects `current_stock` | `"GET /api/products list includes current_stock per product"` | `apps/api/src/routes/products.js:L10` |
| PC-U-1 | `ProductDetail` page displays the value returned by the API for `stock` — when API returns `{ stock: 42 }`, the DOM renders "42" in the stock quantity field | `"ProductDetail renders stock quantity from API response"` | `apps/admin/src/pages/ProductDetail.jsx:L87` |

### Expect() Skeletons

```javascript
// PC-S-1 — would FAIL if getProductDetails still reads available_stock
test('getProductDetails returns current_stock not available_stock', async () => {
  // Seed: product has current_stock=42, available_stock=0
  const result = await getProductDetails({ productId: 'prod-uuid-1', tenantId: 'tenant-1' });
  expect(result.stock).toBe(42);       // fails if available_stock (0) is returned
  expect(result.stock).not.toBe(0);   // explicit assertion against the buggy value
});

// PC-S-2 — would FAIL if getProductList still reads available_stock
test('getProductList returns current_stock not available_stock', async () => {
  // Seed: two products with current_stock=[10,25], available_stock=[0,0]
  const result = await getProductList({ tenantId: 'tenant-1' });
  const stocks = result.products.map(p => p.stock);
  expect(stocks).toEqual([10, 25]);    // fails if [0, 0] returned
});

// PC-S-3 — would FAIL if 0 is treated as null/undefined
test('getProductDetails handles zero stock gracefully', async () => {
  // Seed: product with current_stock=0
  const result = await getProductDetails({ productId: 'prod-uuid-2', tenantId: 'tenant-1' });
  expect(result.stock).toBe(0);
  expect(result.stock).not.toBeNull();
  expect(result.stock).not.toBeUndefined();
});

// PC-S-4 — would FAIL if tenant isolation is missing
test('getProductDetails does not leak across tenants', async () => {
  // Seed: product belongs to tenant-B
  const result = await getProductDetails({ productId: 'prod-tenant-b', tenantId: 'tenant-A' });
  expect(result).toBeNull();           // or expect a 404, not the product data
});

// PC-A-1 — would FAIL if route maps available_stock to stock field
test('GET /api/products/:id returns current_stock in response', async () => {
  const res = await request(app)
    .get('/api/products/prod-uuid-1')
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  expect(res.body.stock).toBe(42);
  expect(res.body.stock).not.toBe(0);
});

// PC-A-2 — would FAIL if list maps available_stock
test('GET /api/products list includes current_stock per product', async () => {
  const res = await request(app)
    .get('/api/products')
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  const stocks = res.body.products.map(p => p.stock);
  expect(stocks).toContain(42);
  expect(stocks).not.toContain(0);   // given our seed data, available_stock would be 0
});

// PC-U-1 — would FAIL if UI ignores API stock field
test('ProductDetail renders stock quantity from API response', async () => {
  render(<ProductDetail productId="prod-uuid-1" />);
  // Mock API returns { stock: 42 }
  await screen.findByText('42');
  expect(screen.queryByText('0')).not.toBeInTheDocument();
});
```

---

## Blast Radius

### Same-File Siblings (`apps/api/src/services/productService.js`)

| Function | Approx Line | Uses `available_stock`? | Action |
|----------|-------------|------------------------|--------|
| `getProductDetails()` | L45 | YES — ROOT CAUSE | Fix → PC-S-1 |
| `getProductList()` | L112 | YES — same defect | Fix → PC-S-2 |
| `getLowStockProducts()` | L178 | VERIFY — thresholds against stock column; if using `available_stock` for threshold comparison, threshold logic is incorrect | Audit required; if confirmed, becomes PC-S-5 via recycle rule |
| `updateProductStock()` | L220 | N/A — write path, does not SELECT stock for return | No action |
| `searchProducts()` | L265 | VERIFY — returns product cards including stock; likely same defect | Audit required; if confirmed, becomes PC-S-6 via recycle rule |

**Confirmed siblings with defect:** `getProductDetails()` (L45) and `getProductList()` (L112). Both contracted above.

### Cross-File Siblings

| File | Function | Concern |
|------|----------|---------|
| `apps/api/src/services/inventoryService.js:L55` | `getInventorySummary()` | May also aggregate `available_stock` — if so, summary dashboards show wrong totals |
| `apps/api/src/routes/products.js:L10` | Route handler mapping | Maps service response fields to API response — verify field aliasing doesn't re-introduce `available_stock` |
| `apps/admin/src/hooks/useProduct.js:L34` | `useProduct` hook | Reads `stock` field from API; if API field name changes, this breaks — no field rename planned, no action required |
| `apps/admin/src/components/ProductCard.jsx:L22` | `ProductCard` | Renders `product.stock` — consumes the list endpoint; will automatically reflect fix when API is corrected |

### Edge Cases Audited

| Case | Behavior | Status |
|------|----------|--------|
| `current_stock = 0` | Must return `0`, not `null` | Contracted — PC-S-3 |
| `current_stock = null` (unmigrated rows) | Should return `null` safely, no crash | Audit — if null rows exist, defensive coalesce needed |
| Very large stock (`current_stock = 999999`) | No truncation in integer column | N/A — `current_stock` is standard integer, no overflow risk |
| Product not found | Returns `null` from service; route returns 404 | Covered by existing tests — not changed by this fix |

---

## Write Site Audit

| Write Site | File:Line | Writes `current_stock`? | Notes |
|-----------|-----------|------------------------|-------|
| `updateProductStock()` | `productService.js:L220` | YES — `UPDATE products SET current_stock = $1` | Correct |
| `receiveInventory()` | `inventoryService.js:L88` | YES — `UPDATE products SET current_stock = current_stock + $1` | Correct |
| `reservationSyncJob()` | `jobs/reservationSync.js:L34` | Writes `available_stock` only | Correct — this job owns `available_stock`, not `current_stock` |
| `bulkImportProducts()` | `productService.js:L310` | YES — sets `current_stock` on INSERT | Correct |

No write site uses the wrong column. The bug is purely a read-side defect — `available_stock` is read where `current_stock` should be read.

---

## Error Cases

| ID | Trigger | HTTP Status | Response Body | Log Entry | Recovery Path | Test |
|----|---------|-------------|---------------|-----------|---------------|------|
| ERR-1 | `getProductDetails()` called with non-existent product ID | 404 | `{ "error": "Product not found" }` | `WARN: product not found — productId=%s tenantId=%s` | Return null from service; route maps to 404 | `"GET /api/products/:id returns 404 for unknown product"` |
| ERR-2 | Database connection failure during `getProductDetails()` | 500 | `{ "error": "An internal error occurred" }` | `ERROR: getProductDetails failed — productId=%s tenantId=%s error=%s stack=%s` | Catch block re-throws; route error handler returns 500; no stack trace in response | `"GET /api/products/:id returns 500 on DB failure"` |
| ERR-3 | Database connection failure during `getProductList()` | 500 | `{ "error": "An internal error occurred" }` | `ERROR: getProductList failed — tenantId=%s error=%s stack=%s` | Same as ERR-2 | `"GET /api/products returns 500 on DB failure"` |
| ERR-4 | Unauthenticated request to `GET /api/products/:id` | 401 | `{ "error": "Unauthorized" }` | None (middleware handles) | `authenticateStaff` middleware rejects before handler | `"GET /api/products/:id returns 401 without auth"` |
| ERR-5 | `tenant_id` missing from `req.user` (malformed token) | 500 | `{ "error": "An internal error occurred" }` | `ERROR: tenant_id missing from authenticated request` | Defensive guard at top of service function; throw before DB call | `"getProductDetails throws when tenantId is undefined"` |

---

## Invariants

| ID | Invariant | Status | Notes |
|----|-----------|--------|-------|
| INV-1 | Every `INSERT` includes `tenant_id` | N/A | No INSERTs in this fix — read-only change |
| INV-2 | Every `SELECT`/`UPDATE`/`DELETE` scopes to `tenant_id` | APPLIES | Both `getProductDetails()` and `getProductList()` must include `WHERE tenant_id = $N` — verified in PC-S-4 |
| INV-3 | All SQL uses parameterized values — zero concatenation | APPLIES | Fixing column name (`available_stock` → `current_stock`) in existing parameterized query — no new concatenation introduced |
| INV-4 | No source file exceeds 400 lines (soft) / 800 lines (hard) | APPLIES | `productService.js` currently ~330 lines — fix adds 0 net lines (column rename in query string), remains under soft limit |
| INV-5 | Every new route has `authenticateStaff` | N/A | No new routes — existing routes already have `authenticateStaff` |
| INV-6 | Every user-facing error is generic | APPLIES | ERR-2 and ERR-3 responses use generic message; full error logged internally — contracted in Error Cases |
| INV-7 | All timestamps use `TIMESTAMPTZ` | N/A | No new timestamp columns — this fix touches stock quantity only |

---

## Consumer Map

**Data output: `getProductDetails()` response shape `{ id, name, sku, current_stock (as "stock"), price, tenantId }`**

| Consumer | File:Line | Fields Used | Purpose |
|----------|-----------|-------------|---------|
| `GET /api/products/:id` route handler | `apps/api/src/routes/products.js:L23` | All fields | Maps service response to HTTP JSON response |
| `useProduct` hook | `apps/admin/src/hooks/useProduct.js:L34` | `id`, `name`, `stock`, `price` | Manages product detail state for the ProductDetail page |
| `ProductDetail` component | `apps/admin/src/pages/ProductDetail.jsx:L87` | `stock` | Renders stock quantity to user |

**Data output: `getProductList()` response shape `{ products: [{ id, name, sku, stock, price }], total }`**

| Consumer | File:Line | Fields Used | Purpose |
|----------|-----------|-------------|---------|
| `GET /api/products` route handler | `apps/api/src/routes/products.js:L10` | All fields | Maps service response to HTTP JSON response |
| `useProducts` hook | `apps/admin/src/hooks/useProducts.js:L18` | `products`, `total` | Manages product list state |
| `ProductCard` component | `apps/admin/src/components/ProductCard.jsx:L22` | `id`, `name`, `stock`, `price` | Renders stock quantity in product list cards |
| `LowStockBadge` component | `apps/admin/src/components/LowStockBadge.jsx:L8` | `stock` | Conditionally renders low-stock warning badge |

---

## Side Effects

| Side Effect | Intentional? | Test |
|-------------|-------------|------|
| Products that previously showed `0` stock (from stale `available_stock`) now show actual `current_stock` — visible change to all product pages and lists | YES — this is the fix | PC-A-1, PC-A-2, PC-U-1 |
| `LowStockBadge` thresholds may now trigger differently — if `available_stock` was 0 and `current_stock` is 50, badges that were showing will disappear | YES — correct behavior; previously spurious warnings | Covered by PC-A-2 via list response |
| No database schema changes | N/A — column already exists | — |
| No migration required | N/A — read-only fix | — |

---

## NOT in Scope

1. **Fixing or modifying `reservationSyncJob`** — the job that writes `available_stock` is not broken; the defect is in the read path. The job is correct and must not be touched.
2. **Renaming or removing the `available_stock` column** — a schema migration is out of scope for this bug fix. The column remains; it is simply no longer read by these functions.
3. **Changing the API response field name** — the field is already named `stock` in the response; no contract change for consumers. If it were named `available_stock` in the API response, that would be a separate ticket.
4. **Fixing `getLowStockProducts()` or `searchProducts()`** — these functions were flagged in the blast radius scan but require further audit. If the audit confirms the same defect, they will be added as new postconditions via the recycle rule, not silently folded into this fix.
5. **UI changes** — the frontend reads `stock` from the API response and renders it. Once the API returns the correct value, the UI is correct. No UI code changes are required or permitted under this contract.

---

## Error Handling Strategy

| Operation | Error Type | Handling Strategy | User Message | Log Level | Recovery |
|-----------|-----------|------------------|-------------|-----------|---------|
| `pool.query()` in `getProductDetails()` | `DatabaseError` | Catch → log with productId + tenantId → re-throw | "An internal error occurred" | ERROR | Route error handler returns 500 |
| `pool.query()` in `getProductList()` | `DatabaseError` | Catch → log with tenantId + filters → re-throw | "An internal error occurred" | ERROR | Route error handler returns 500 |
| Missing `tenantId` argument | `TypeError` | Guard at function entry → throw `Error('tenantId required')` | "An internal error occurred" | ERROR | Never reaches DB |
| Missing `productId` argument in `getProductDetails()` | `TypeError` | Guard at function entry → throw `Error('productId required')` | "An internal error occurred" | ERROR | Never reaches DB |

Transaction boundaries: This fix has no multi-step write operations. Both functions are read-only SELECT queries — no transaction boundary required.

---

## Traceability Matrix

| PC | Test File | Test Name | Code File | Code Location | Status |
|----|-----------|-----------|-----------|---------------|--------|
| PC-S-1 | `apps/api/src/services/__tests__/productService.test.js` | `"getProductDetails returns current_stock not available_stock"` | `apps/api/src/services/productService.js` | L45 | PENDING |
| PC-S-2 | `apps/api/src/services/__tests__/productService.test.js` | `"getProductList returns current_stock not available_stock"` | `apps/api/src/services/productService.js` | L112 | PENDING |
| PC-S-3 | `apps/api/src/services/__tests__/productService.test.js` | `"getProductDetails handles zero stock gracefully"` | `apps/api/src/services/productService.js` | L45 | PENDING |
| PC-S-4 | `apps/api/src/services/__tests__/productService.test.js` | `"getProductDetails does not leak across tenants"` | `apps/api/src/services/productService.js` | L45 | PENDING |
| PC-A-1 | `apps/api/src/routes/__tests__/products.test.js` | `"GET /api/products/:id returns current_stock in response"` | `apps/api/src/routes/products.js` | L23 | PENDING |
| PC-A-2 | `apps/api/src/routes/__tests__/products.test.js` | `"GET /api/products list includes current_stock per product"` | `apps/api/src/routes/products.js` | L10 | PENDING |
| PC-U-1 | `apps/admin/src/pages/__tests__/ProductDetail.test.jsx` | `"ProductDetail renders stock quantity from API response"` | `apps/admin/src/pages/ProductDetail.jsx` | L87 | PENDING |

---

## Quality Gate

```
CONTRACT QUALITY GATE
=====================
Testability:        PASS — 7 PCs, 7 with expect() skeletons (all non-tautological)
Banned Words:       PASS — grep count: 0
Completeness:       PASS — 2 fix tasks (getProductDetails, getProductList), 7 PCs across service/API/UI layers
Consumer Coverage:  PASS — 6 consumers identified and mapped (useProduct, ProductDetail, useProducts, ProductCard, LowStockBadge, route handlers)
Blast Radius:       PASS — 5 same-file siblings checked with line numbers; 4 cross-file consumers checked
Error Coverage:     PASS — 2 DB calls + 2 input validation paths = 5 error cases (ERR-1 through ERR-5)
Invariants:         PASS — 7/7 standard invariants addressed (3 N/A with justification, 4 applicable)
Scope Boundary:     PASS — 5 explicit NOT in Scope exclusions
Traceability:       PASS — 7 PCs, 7 matrix rows, zero orphans
Tautology Check:    PASS — 7 PCs checked, 0 tautological (each skeleton fails when feature breaks)
Error Strategy:     PASS — 4 operations with handling defined, transaction boundary assessed

Score: 11/11 — LOCKED
```
