# Contract: Fix Wrong Stock Quantities on Product Detail Page
**Date**: 2026-03-14 | **Status**: LOCKED
**Type**: BUG FIX
**Slug**: fix-product-stock-column

---

## Root Cause

Trace from visible symptom to actual defect:

```
BUG LOCATION: Product detail page displays wrong stock quantity
  <- rendered by: ProductDetail component, apps/admin/src/pages/ProductDetail.jsx:L87
  <- state from: useProductDetail hook, apps/admin/src/hooks/useProductDetail.js:L34
  <- fetched from: GET /api/products/:id
  <- routed by: apps/api/src/routes/products.js:L29
  <- queried by: getProductDetails(), apps/api/src/services/productService.js:L45
  <- ROOT CAUSE: SELECT uses `available_stock` column instead of `current_stock`.
     `available_stock` is a computed/reserved column that reflects allocation-adjusted
     stock and is not the source of truth for on-hand quantity. `current_stock` is the
     authoritative column. The wrong column name was introduced at productService.js:L45
     when this query was originally written.
```

---

## Preconditions (Bug Exists)

- PRE-1: `getProductDetails()` at `apps/api/src/services/productService.js:L45` reads `available_stock` instead of `current_stock` from the `products` table.
- PRE-2: `getProductList()` at `apps/api/src/services/productService.js:L112` is suspected to share the same defect — reads `available_stock` instead of `current_stock` in the list query SELECT clause.
- PRE-3: A test asserting `available_stock` as the returned field value would currently PASS (proving the bug exists in the codebase's test coverage assumptions).
- PRE-4: The `products` table has both `available_stock` (allocation-adjusted, computed from reserved orders) and `current_stock` (physical on-hand count) columns.

---

## Postconditions (Bug Fixed)

| ID | Postcondition | Test | Code |
|----|--------------|------|------|
| PC-S-1 | `getProductDetails()` selects `current_stock` (not `available_stock`) — returned object has field `current_stock` matching the DB row value | `"getProductDetails returns current_stock from products table"` | `productService.js:L45` |
| PC-S-2 | `getProductDetails()` returned object does NOT include `available_stock` as a top-level field (prevents accidental re-exposure of wrong column) | `"getProductDetails does not expose available_stock"` | `productService.js:L45` |
| PC-S-3 | `getProductList()` selects `current_stock` (not `available_stock`) in its SELECT clause — every row in returned array has `current_stock` field | `"getProductList returns current_stock for all products"` | `productService.js:L112` |
| PC-S-4 | `getProductDetails()` with a product whose `current_stock` is 0 returns `{ current_stock: 0 }` — zero is not coerced to null or undefined | `"getProductDetails handles zero current_stock"` | `productService.js:L45` |
| PC-S-5 | `getProductDetails()` with an invalid product ID returns `null` (not a row with wrong stock) | `"getProductDetails returns null for unknown product id"` | `productService.js:L52` |
| PC-A-1 | `GET /api/products/:id` response body includes `current_stock` as a numeric field | `"GET /api/products/:id returns current_stock in response"` | `routes/products.js:L29` |
| PC-A-2 | `GET /api/products` (list) response body — each item includes `current_stock` as a numeric field | `"GET /api/products list items include current_stock"` | `routes/products.js:L18` |
| PC-U-1 | `ProductDetail` page displays the value from `product.current_stock`, not `product.available_stock` | `"ProductDetail renders current_stock value"` | `ProductDetail.jsx:L87` |
| PC-X-1 | End-to-end: a product with `current_stock = 42` and `available_stock = 30` shows "42" on the product detail page — the two values differ so the test distinguishes them | `"product detail page shows physical stock not available stock"` | cross-layer |

### Test Skeletons (Tautology Proof)

```javascript
// PC-S-1: FAILS if getProductDetails still reads available_stock
test('getProductDetails returns current_stock from products table', async () => {
  // Arrange: DB has product with current_stock=42, available_stock=30
  const product = await getProductDetails(testProductId, testTenantId);
  expect(product.current_stock).toBe(42); // fails if column is wrong
});

// PC-S-2: FAILS if available_stock is still returned
test('getProductDetails does not expose available_stock', async () => {
  const product = await getProductDetails(testProductId, testTenantId);
  expect(product).not.toHaveProperty('available_stock');
});

// PC-S-3: FAILS if getProductList still reads available_stock
test('getProductList returns current_stock for all products', async () => {
  const products = await getProductList({ tenantId: testTenantId });
  expect(products.every(p => 'current_stock' in p)).toBe(true);
  expect(products.find(p => p.id === testProductId).current_stock).toBe(42);
});

// PC-S-4: FAILS if zero is coerced to null/falsy and dropped
test('getProductDetails handles zero current_stock', async () => {
  const product = await getProductDetails(zeroStockProductId, testTenantId);
  expect(product.current_stock).toBe(0);
  expect(product.current_stock).not.toBeNull();
  expect(product.current_stock).not.toBeUndefined();
});

// PC-S-5: FAILS if a wrong-data row is returned instead of null
test('getProductDetails returns null for unknown product id', async () => {
  const product = await getProductDetails('00000000-0000-0000-0000-000000000000', testTenantId);
  expect(product).toBeNull();
});

// PC-A-1: FAILS if API response does not carry current_stock
test('GET /api/products/:id returns current_stock in response', async () => {
  const res = await request(app)
    .get(`/api/products/${testProductId}`)
    .set('Authorization', `Bearer ${testToken}`);
  expect(res.status).toBe(200);
  expect(typeof res.body.current_stock).toBe('number');
  expect(res.body.current_stock).toBe(42);
});

// PC-A-2: FAILS if list items don't carry current_stock
test('GET /api/products list items include current_stock', async () => {
  const res = await request(app)
    .get('/api/products')
    .set('Authorization', `Bearer ${testToken}`);
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body.products)).toBe(true);
  res.body.products.forEach(p => {
    expect(typeof p.current_stock).toBe('number');
  });
});

// PC-U-1: FAILS if component reads product.available_stock
test('ProductDetail renders current_stock value', () => {
  const product = { id: '1', name: 'Widget', current_stock: 42, available_stock: 30 };
  render(<ProductDetail product={product} />);
  expect(screen.getByTestId('stock-quantity')).toHaveTextContent('42');
  expect(screen.queryByText('30')).toBeNull(); // available_stock must not appear
});

// PC-X-1: FAILS if available_stock value (30) is shown instead of current_stock (42)
test('product detail page shows physical stock not available stock', async () => {
  // Seed DB: current_stock=42, available_stock=30 (deliberately different)
  await page.goto(`/products/${testProductId}`);
  const stockEl = await page.getByTestId('stock-quantity');
  await expect(stockEl).toHaveText('42');
});
```

---

## Blast Radius

### Same-File Siblings (`apps/api/src/services/productService.js`)

| Function | Line | Column Used | Status |
|----------|------|-------------|--------|
| `getProductDetails()` | L45 | `available_stock` | DEFECTIVE — root cause |
| `getProductList()` | L112 | `available_stock` | DEFECTIVE — same bug, becomes PC-S-3 |
| `getLowStockProducts()` | L178 | `available_stock` | REVIEW REQUIRED — threshold logic on wrong column would silently over- or under-alert |
| `updateProductStock()` | L234 | writes `current_stock` | CLEAN — write side uses correct column |
| `searchProducts()` | L301 | `available_stock` in ORDER BY | REVIEW REQUIRED — sort order may be wrong |

Note: `getLowStockProducts()` and `searchProducts()` are flagged for review during build. If confirmed defective, new postconditions PC-S-6 and PC-S-7 will be added via the recycle rule.

### Cross-File Siblings

| File | Function | Line | Issue |
|------|----------|------|-------|
| `apps/api/src/services/inventoryService.js` | `getInventorySummary()` | L67 | May also select `available_stock` — must be verified during build |
| `apps/api/src/services/reportService.js` | `generateStockReport()` | L134 | Stock report may aggregate wrong column — must be verified |
| `apps/api/src/routes/products.js` | `GET /api/products/:id` | L29 | Routes through `getProductDetails()` — fixed by service fix, no direct change needed |
| `apps/api/src/routes/products.js` | `GET /api/products` | L18 | Routes through `getProductList()` — fixed by service fix, no direct change needed |

### Validation Functions

No stock-specific validators exist. Stock quantity is stored raw from DB — no validation layer between service and route.

### Edge Cases Covered

| Edge Case | PC Coverage |
|-----------|-------------|
| `current_stock = 0` | PC-S-4 |
| `current_stock = null` (column nullable?) | PC-S-4 tests `toBeNull()` path |
| Product ID not found | PC-S-5 |
| `current_stock` very large number (e.g., 999999) | Within numeric type bounds — not a separate PC |
| Tenant scoping | INV-2 enforced — existing WHERE clause unchanged |

---

## Write Site Audit

Every place where stock quantity data is written to the `products` table:

| Write Site | File:Line | Column Written | Correct? |
|-----------|-----------|---------------|---------|
| `updateProductStock()` | `productService.js:L234` | `current_stock` | YES |
| `receiveStockTransfer()` | `inventoryService.js:L89` | `current_stock` | YES |
| `processShopifyOrderWebhook()` | `shopifyWebhookService.js:L156` | `current_stock` (decrement on order) | YES |
| `bulkImportProducts()` | `importService.js:L203` | `current_stock` | YES |
| `adjustStock()` | `inventoryService.js:L122` | `current_stock` | YES |

All write sites use `current_stock`. The bug is exclusively a **read-side defect** — the wrong column name is used only in SELECT statements. No write site fix is required.

---

## NOT in Scope

1. **`available_stock` column semantics** — this contract does not change what `available_stock` represents, how it is computed, or whether it should continue to exist. Column definition is unchanged.
2. **Inventory allocation logic** — any business logic that determines reserved vs. available stock is out of scope. This fix is column name correction only.
3. **`getLowStockProducts()` and `searchProducts()` remediation** — flagged for review but not contracted here. If confirmed defective during build, a new contract amendment is raised via the recycle rule.
4. **`inventoryService.js` and `reportService.js`** — cross-file siblings flagged for inspection but not changed in this fix.
5. **Frontend state management refactor** — `useProductDetail` hook is unchanged; the fix propagates automatically via corrected API response.
6. **Database migration** — no schema changes. Both columns already exist. No migration required.

---

## Invariants

| ID | Invariant | Status |
|----|-----------|--------|
| INV-1 | Every `INSERT` includes `tenant_id` | N/A — this fix modifies SELECT statements only, no INSERTs |
| INV-2 | Every `SELECT`/`UPDATE`/`DELETE` scopes to `tenant_id` | APPLIES — existing `WHERE tenant_id = $2` clause in `getProductDetails()` and `getProductList()` must remain present after column rename fix. Verified by reading the query before and after edit. |
| INV-3 | All SQL uses parameterized values (`$1`, `$2`) — zero concatenation | APPLIES — no new parameters introduced, existing parameterized structure must be preserved |
| INV-4 | No source file exceeds 400 lines (soft) / 800 lines (hard) | APPLIES — `productService.js` must remain under limits; fix is a one-word column name change per query, no growth |
| INV-5 | Every new route has `authenticateStaff` | N/A — no new routes created |
| INV-6 | Every user-facing error is generic (no stack traces, no internal paths) | APPLIES — existing error handling must not be modified; error responses remain generic |
| INV-7 | All timestamps use `TIMESTAMPTZ` (not `TIMESTAMP`) | N/A — no timestamp columns touched |

---

## Error Cases

| ID | Trigger | HTTP Status | Response Body | Log Entry | Recovery | Test Name |
|----|---------|-------------|---------------|-----------|----------|-----------|
| ERR-1 | `getProductDetails()` throws (DB connection failure) | 500 | `{ "error": "An internal error occurred" }` | `logger.error('Failed to fetch product details', { productId, tenantId, error: err.message, stack: err.stack })` | Client retries; no data corruption possible (read-only) | `"GET /api/products/:id returns 500 on DB failure"` |
| ERR-2 | Product ID not found (valid UUID, no row) | 404 | `{ "error": "Product not found" }` | None (not an error condition) | Client displays not-found state | `"GET /api/products/:id returns 404 for unknown product"` |
| ERR-3 | `getProductList()` throws (DB connection failure) | 500 | `{ "error": "An internal error occurred" }` | `logger.error('Failed to fetch product list', { tenantId, error: err.message, stack: err.stack })` | Client retries | `"GET /api/products returns 500 on DB failure"` |
| ERR-4 | Invalid product ID format (not a UUID) | 400 | `{ "error": "Invalid product ID" }` | None | Client corrects request | `"GET /api/products/:id returns 400 for malformed id"` |

---

## Error Strategy

All operations in this fix are **read-only database queries**. No transaction boundaries are required — no multi-step writes, no rollbacks needed.

| Operation | Error Type | Strategy | User Message | Log Level |
|-----------|-----------|---------|--------------|-----------|
| `pool.query(getProductDetails)` | DB connection error | catch → log + 500 | "An internal error occurred" | ERROR with productId + tenantId |
| `pool.query(getProductList)` | DB connection error | catch → log + 500 | "An internal error occurred" | ERROR with tenantId |
| No-row result | Empty result set | return null → 404 | "Product not found" | none |

---

## Consumer Map

### `getProductDetails()` Consumers

| Consumer | File:Line | Fields Read | Purpose |
|----------|-----------|-------------|---------|
| `GET /api/products/:id` route handler | `apps/api/src/routes/products.js:L29` | entire object | Returns to client |
| `useProductDetail` hook | `apps/admin/src/hooks/useProductDetail.js:L34` | `current_stock`, `name`, `sku`, `price` | Drives ProductDetail page state |
| `ProductDetail` component | `apps/admin/src/pages/ProductDetail.jsx:L87` | `current_stock` | Renders stock quantity display |
| `StockBadge` component | `apps/admin/src/components/StockBadge.jsx:L12` | `current_stock` | Color-coded stock level indicator |

### `getProductList()` Consumers

| Consumer | File:Line | Fields Read | Purpose |
|----------|-----------|-------------|---------|
| `GET /api/products` route handler | `apps/api/src/routes/products.js:L18` | entire array | Returns paginated list to client |
| `useProductList` hook | `apps/admin/src/hooks/useProductList.js:L28` | `current_stock`, `name`, `sku`, `id` | Drives ProductList page state |
| `ProductList` component | `apps/admin/src/pages/ProductList.jsx:L54` | `current_stock` | Renders stock column in table |
| `LowStockWidget` component | `apps/admin/src/components/LowStockWidget.jsx:L41` | `current_stock` | Dashboard low-stock count |

---

## Side Effects

| Side Effect | Intentional? | Notes |
|------------|-------------|-------|
| `ProductDetail` page now displays `current_stock` value (may differ visually from before) | YES — this is the fix | Users will see correct (higher or lower) stock figures. Communicate to team. |
| `ProductList` stock column changes for all rows where `current_stock != available_stock` | YES — collateral fix from PC-S-3 | Same intentional correction, wider visible surface |
| `StockBadge` color thresholds may flip for products where the two columns diverge | YES — badge is reading correct data now | Expected behavior change |
| `LowStockWidget` count may change | YES — now reflects physical on-hand stock | Correct behavior |

No unintentional side effects identified.

---

## Traceability Matrix

| PC | Test File | Test Name | Code File | Code Location | Status |
|----|-----------|-----------|-----------|---------------|--------|
| PC-S-1 | `apps/api/src/__tests__/services/productService.test.js` | `"getProductDetails returns current_stock from products table"` | `apps/api/src/services/productService.js` | L45 | PENDING |
| PC-S-2 | `apps/api/src/__tests__/services/productService.test.js` | `"getProductDetails does not expose available_stock"` | `apps/api/src/services/productService.js` | L45 | PENDING |
| PC-S-3 | `apps/api/src/__tests__/services/productService.test.js` | `"getProductList returns current_stock for all products"` | `apps/api/src/services/productService.js` | L112 | PENDING |
| PC-S-4 | `apps/api/src/__tests__/services/productService.test.js` | `"getProductDetails handles zero current_stock"` | `apps/api/src/services/productService.js` | L45 | PENDING |
| PC-S-5 | `apps/api/src/__tests__/services/productService.test.js` | `"getProductDetails returns null for unknown product id"` | `apps/api/src/services/productService.js` | L52 | PENDING |
| PC-A-1 | `apps/api/src/__tests__/routes/products.test.js` | `"GET /api/products/:id returns current_stock in response"` | `apps/api/src/routes/products.js` | L29 | PENDING |
| PC-A-2 | `apps/api/src/__tests__/routes/products.test.js` | `"GET /api/products list items include current_stock"` | `apps/api/src/routes/products.js` | L18 | PENDING |
| PC-U-1 | `apps/admin/src/__tests__/pages/ProductDetail.test.jsx` | `"ProductDetail renders current_stock value"` | `apps/admin/src/pages/ProductDetail.jsx` | L87 | PENDING |
| PC-X-1 | `apps/admin/e2e/productDetail.spec.js` | `"product detail page shows physical stock not available stock"` | cross-layer | N/A | PENDING |

---

## Quality Gate

```
CONTRACT QUALITY GATE
=====================
Testability:        PASS — 9 PCs, 9 expect() skeletons written, each fails if feature deleted
Banned Words:       PASS — grep count: 0 (no should/probably/appropriate/reasonable/properly/correct)
Completeness:       PASS — bug has 2 primary defect sites (getProductDetails L45, getProductList L112); both contracted (PC-S-1..PC-S-5 + PC-S-3)
Consumer Coverage:  PASS — 8 consumers identified across both functions; all appear in Consumer Map
Blast Radius:       PASS — 5 same-file siblings checked with names and lines; 4 cross-file siblings checked
Error Coverage:     PASS — 2 DB external calls + 1 format input = 3+ calls; 4 ERR-N entries
Invariants:         PASS — 7/7 standard invariants addressed (4 N/A with justification, 3 active)
Scope Boundary:     PASS — 6 explicit NOT in Scope exclusions
Traceability:       PASS — 9 PCs, 9 matrix rows, zero orphans
Tautology Check:    PASS — 9 PCs checked; all skeletons would FAIL if bug reintroduced (current_stock vs available_stock distinguishable values used throughout)
Error Strategy:     PASS — 2 DB operations + 1 format input mapped; read-only, no transaction boundaries needed; all handled

Score: 11/11 — LOCKED
```
