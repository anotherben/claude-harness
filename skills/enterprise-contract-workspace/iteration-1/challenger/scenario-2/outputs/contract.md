# Contract: Fix Wrong Stock Quantities on Product Detail Page
**Date**: 2026-03-14 | **Status**: LOCKED
**Type**: BUG FIX
**Slug**: fix-product-stock-column

---

## Root Cause

Trace from visible symptom back to the defect:

```
BUG LOCATION: Product detail page shows wrong stock quantity (UI)
  <- rendered by: ProductDetail component
                  apps/admin/src/pages/ProductDetail.jsx:L38
                  — renders `product.available_stock` (field exists, is wrong column)
  <- state from: useProduct() hook
                 apps/admin/src/hooks/useProduct.js:L22
                 — returns API response as-is, no transformation
  <- fetched from: GET /api/products/:id
                   apps/api/src/routes/products.js:L61
  <- queried by: getProductDetails()
                 apps/api/src/services/productService.js:L45
  <- ROOT CAUSE: SELECT query uses column `available_stock` instead of `current_stock`.
                 `available_stock` is a legacy column that is no longer maintained
                 and holds stale data. `current_stock` is the authoritative, live-updated
                 column for inventory. The query at L45 was never updated when the schema
                 was migrated.
```

---

## Preconditions (Bug Exists)

- PRE-1: `getProductDetails()` at `apps/api/src/services/productService.js:L45` selects `available_stock` instead of `current_stock`, returning stale inventory figures.
- PRE-2: `getProductList()` at `apps/api/src/services/productService.js:L112` also selects `available_stock` instead of `current_stock`, propagating the same defect to the product list view.
- PRE-3: A regression test asserting `available_stock` values PASSES today (proving the bug is embedded and untested-against-correct-behavior).
- PRE-4: The `products` table contains both `available_stock` (legacy, stale) and `current_stock` (authoritative) columns, confirmed by schema inspection.

---

## Postconditions (Bug Fixed)

| ID | Postcondition | Test | Code |
|----|--------------|------|------|
| PC-S-1 | `getProductDetails()` selects `current_stock` — returned object contains `{ current_stock: <integer> }` matching the authoritative DB value, NOT `available_stock` | `"getProductDetails returns current_stock not available_stock"` | `productService.js:L45` |
| PC-S-2 | `getProductDetails()` does NOT include `available_stock` in its return value — the field is absent from the response object | `"getProductDetails response does not expose available_stock"` | `productService.js:L45` |
| PC-S-3 | `getProductList()` selects `current_stock` — each row in the returned array has `current_stock` set to the authoritative DB value | `"getProductList returns current_stock for each product"` | `productService.js:L112` |
| PC-S-4 | `getProductList()` does NOT include `available_stock` in any returned row | `"getProductList response rows do not expose available_stock"` | `productService.js:L112` |
| PC-A-1 | `GET /api/products/:id` returns HTTP 200 with a body containing `current_stock` as an integer equal to the value stored in `products.current_stock` for that row | `"GET /api/products/:id returns current_stock"` | `products.js:L61` |
| PC-A-2 | `GET /api/products` (list) returns HTTP 200; each item in the array contains `current_stock` as an integer equal to the authoritative value in the DB | `"GET /api/products list items contain current_stock"` | `products.js:L28` |
| PC-A-3 | `GET /api/products/:id` with a valid product whose `current_stock = 0` returns `{ current_stock: 0 }` — zero is preserved, not coerced to null or omitted | `"GET /api/products/:id returns zero current_stock correctly"` | `products.js:L61` |
| PC-U-1 | `ProductDetail` page renders the value from `product.current_stock`, not `product.available_stock` | `"ProductDetail displays current_stock value"` | `ProductDetail.jsx:L38` |
| PC-U-2 | `ProductList` page renders the correct stock figure (`current_stock`) for each row | `"ProductList displays current_stock for each product row"` | `ProductList.jsx:L74` |
| PC-X-1 | A product with `current_stock = 42` and `available_stock = 0` (stale): the detail page shows `42`, not `0` | `"end-to-end: detail page shows current_stock not available_stock"` | E2E |

---

## Invariants

| ID | Invariant | Status | Justification |
|----|-----------|--------|---------------|
| INV-1 | Every `INSERT` includes `tenant_id` | N/A | This fix modifies a `SELECT` column reference only — no `INSERT` statements are changed. |
| INV-2 | Every `SELECT`/`UPDATE`/`DELETE` scopes to `tenant_id` | APPLIES | The corrected `SELECT` at `productService.js:L45` and `L112` must retain their existing `WHERE tenant_id = $2` clause. Verified: clause present in both query sites; this fix does not remove it. |
| INV-3 | All SQL uses parameterized values — zero concatenation | APPLIES | Both query sites already use `$1`, `$2` positional parameters. The column name fix is a static string change, not a parameter — no injection risk introduced. |
| INV-4 | No source file exceeds 400 lines (soft) / 800 lines (hard) | APPLIES | `productService.js` must be measured before and after edit. If currently under 400 lines, the one-line column rename keeps it under. If over 400, note for refactor; do not grow further. |
| INV-5 | Every new route has `authenticateStaff` (or explicit public justification) | N/A | No new routes are added. Existing `GET /api/products` and `GET /api/products/:id` routes already have `authenticateStaff` applied. |
| INV-6 | Every user-facing error is generic (no stack traces, no internal paths) | APPLIES | Error handling in the route controllers must continue to return `{ error: 'An internal error occurred' }` — the column rename must not alter error handler behavior. |
| INV-7 | All timestamps use `TIMESTAMPTZ` (not `TIMESTAMP`) | N/A | No new timestamp columns are added or modified by this fix. |

---

## Blast Radius

### Same-File Siblings (`apps/api/src/services/productService.js`)

All functions in this file were audited for the same `available_stock` defect:

| Function | Line | Uses `available_stock`? | Action |
|----------|------|------------------------|--------|
| `getProductDetails()` | L45 | YES — **ROOT CAUSE** | Fix: replace with `current_stock` |
| `getProductList()` | L112 | YES — **SIBLING BUG** | Fix: replace with `current_stock` (PC-S-3, PC-S-4) |
| `updateProductStock()` | L178 | NO — uses `current_stock` in `UPDATE SET` correctly | No change |
| `getLowStockProducts()` | L234 | YES — **SIBLING BUG** | Fix: replace `available_stock` with `current_stock` in `WHERE` clause (new PC-S-5 below) |
| `getProductBySku()` | L298 | NO — does not select stock column | No change |
| `searchProducts()` | L341 | YES — **SIBLING BUG** | Fix: replace `available_stock` in SELECT with `current_stock` (new PC-S-6 below) |

**Additional postconditions from sibling blast radius:**

| ID | Postcondition | Test | Code |
|----|--------------|------|------|
| PC-S-5 | `getLowStockProducts()` filters on `current_stock` — a product with `current_stock = 2` and `available_stock = 50` appears in the low-stock result when threshold is 5 | `"getLowStockProducts filters on current_stock"` | `productService.js:L234` |
| PC-S-6 | `searchProducts()` includes `current_stock` in returned rows — the field name in the response is `current_stock`, not `available_stock` | `"searchProducts returns current_stock in results"` | `productService.js:L341` |

### Cross-File Siblings

| File | Function | Usage | Impact |
|------|----------|-------|--------|
| `apps/api/src/services/inventoryService.js:L67` | `getInventorySummary()` | References `available_stock` in aggregation SUM — same defect pattern | Audit required; NOT in scope for this fix (separate service, separate contract) |
| `apps/api/src/routes/products.js:L61` | Route handler | Passes service result directly to `res.json()` — no column mapping | No change needed; fix is purely in service layer |
| `apps/api/src/routes/products.js:L28` | List route handler | Same pass-through pattern | No change needed |
| `apps/admin/src/hooks/useProduct.js:L22` | `useProduct()` | Returns API response as-is | No change needed once API response field name corrects |
| `apps/admin/src/hooks/useProductList.js:L18` | `useProductList()` | Returns API response as-is | No change needed once API response field name corrects |

### Validation Functions

No dedicated validation functions gate stock column selection. Stock value validation (non-negative integer check) occurs in `updateProductStock()` at `productService.js:L185` — that path is not touched by this fix.

### Edge Cases

| Case | `getProductDetails()` | `getProductList()` | `getLowStockProducts()` | `searchProducts()` |
|------|-----------------------|-------------------|------------------------|-------------------|
| `current_stock = 0` | Must return `0`, not null | Must return `0` per row | Must include in low-stock results | Must return `0` |
| `current_stock = null` (unmigrated row) | Must return `null` without error | Must return `null` per row | Must exclude from threshold comparison safely | Must return `null` |
| Product not found | 404, empty result | N/A (list) | Not included | Not included |
| Very large stock (e.g. 999999) | Returns integer, no overflow | Same | Excluded from low-stock | Returns integer |

---

## Write Site Audit

The bug is a **read-side defect** (wrong column in SELECT). However, the write site for `current_stock` is audited to confirm the authoritative column is being populated:

| Write Site | File:Line | Column Written | Correct? |
|-----------|-----------|---------------|---------|
| `updateProductStock()` | `productService.js:L185` | `current_stock` | YES — uses `UPDATE products SET current_stock = $1` |
| `applyStockAdjustment()` | `productService.js:L267` | `current_stock` | YES — same pattern |
| Shopify inventory webhook handler | `apps/api/src/routes/webhooks/shopify.js:L134` | `current_stock` | YES — `UPDATE products SET current_stock = $1 WHERE sku = $2 AND tenant_id = $3` |
| `bulkImportProducts()` | `apps/api/src/services/importService.js:L89` | `current_stock` | YES — INSERT includes `current_stock` |
| Legacy migration `available_stock` population | `apps/api/database/migrations/20230615_add_available_stock.sql` | `available_stock` | N/A — historical migration, column exists but is no longer updated after migration 20240101 |

**Conclusion**: `current_stock` is the authoritative column written by all active code paths. `available_stock` was populated only by a 2023 migration and has not been updated since. All read sites must be corrected to use `current_stock`.

---

## Error Cases

| ID | Trigger | HTTP Status | Response Body | Log Entry | Recovery | Test Name |
|----|---------|-------------|---------------|-----------|----------|-----------|
| ERR-1 | `getProductDetails()` receives a product `id` that does not exist in `products` for this tenant | 404 | `{ "error": "Product not found" }` | `logger.warn('getProductDetails: product not found', { tenantId, productId })` | Client retries with valid ID | `"GET /api/products/:id returns 404 for unknown product"` |
| ERR-2 | `getProductDetails()` receives `id` that is not a valid UUID | 400 | `{ "error": "Invalid product ID" }` | `logger.warn('getProductDetails: invalid product ID format', { tenantId, id })` | Client sends valid UUID | `"GET /api/products/:id returns 400 for non-UUID id"` |
| ERR-3 | Database connection failure during `getProductDetails()` query | 500 | `{ "error": "An internal error occurred" }` | `logger.error('getProductDetails: DB query failed', { tenantId, productId, error: err.message, stack: err.stack })` | Automatic retry at client; DB recovers | `"GET /api/products/:id returns 500 on DB error"` |
| ERR-4 | Database connection failure during `getProductList()` query | 500 | `{ "error": "An internal error occurred" }` | `logger.error('getProductList: DB query failed', { tenantId, error: err.message, stack: err.stack })` | Same as ERR-3 | `"GET /api/products returns 500 on DB error"` |
| ERR-5 | `getLowStockProducts()` called with `threshold` parameter that is non-numeric | 400 | `{ "error": "Threshold must be a positive integer" }` | `logger.warn('getLowStockProducts: invalid threshold', { tenantId, threshold })` | Client sends valid integer | `"getLowStockProducts returns 400 for non-numeric threshold"` |
| ERR-6 | `searchProducts()` called with an empty query string | 400 | `{ "error": "Search query is required" }` | `logger.warn('searchProducts: empty query', { tenantId })` | Client sends non-empty query | `"searchProducts returns 400 for empty query"` |

---

## Error Handling Matrix (Error Strategy)

| Operation | External Call? | Error Type | Handling | User Message | Log Level |
|-----------|---------------|------------|----------|-------------|-----------|
| DB SELECT in `getProductDetails()` | YES (PostgreSQL) | Connection error, timeout, constraint | `try/catch`, return 500 | "An internal error occurred" | `error` with stack |
| DB SELECT in `getProductList()` | YES (PostgreSQL) | Same | `try/catch`, return 500 | "An internal error occurred" | `error` with stack |
| DB SELECT in `getLowStockProducts()` | YES (PostgreSQL) | Same | `try/catch`, return 500 | "An internal error occurred" | `error` with stack |
| DB SELECT in `searchProducts()` | YES (PostgreSQL) | Same | `try/catch`, return 500 | "An internal error occurred" | `error` with stack |

Transaction boundaries: this fix involves only `SELECT` statements — no transactions required. No multi-step operations are introduced.

---

## Side Effects

| Side Effect | Intentional? | Tested? |
|-------------|-------------|---------|
| API response field `available_stock` removed from product detail and list responses | INTENTIONAL — removing stale field | YES — PC-S-2, PC-S-4 |
| Any consumer reading `available_stock` from the API will receive `undefined` | INTENTIONAL consequence — see Consumer Map | Consumers must be updated (see Consumer Map) |
| `getLowStockProducts()` results will change — products previously hidden (high `available_stock`, low `current_stock`) will now correctly appear | INTENTIONAL — correct behavior | YES — PC-S-5 |
| `searchProducts()` results will have `current_stock` field instead of `available_stock` | INTENTIONAL | YES — PC-S-6 |

---

## Consumer Map

Every consumer of the affected functions / endpoints:

### `getProductDetails()` / `GET /api/products/:id`

| Consumer | File:Line | Fields Read | Notes |
|----------|-----------|-------------|-------|
| `useProduct()` hook | `apps/admin/src/hooks/useProduct.js:L22` | `id`, `name`, `sku`, `current_stock`, `price`, `supplier_id` | After fix: reads `current_stock`. Previously read `available_stock` — hook requires no code change, field name in response changes. |
| `ProductDetail` page | `apps/admin/src/pages/ProductDetail.jsx:L38` | `current_stock` (rendered as "Stock"), `name`, `sku`, `price` | **Must be updated** to reference `current_stock` if currently referencing `available_stock`. |
| `StockBadge` component | `apps/admin/src/components/StockBadge.jsx:L12` | `current_stock` | Renders low/ok/critical badge. **Must be verified** — if it reads `available_stock`, update to `current_stock`. |
| `ProductEditForm` | `apps/admin/src/pages/ProductEditForm.jsx:L55` | `current_stock` (for pre-fill) | Read for form pre-population — verify field reference. |

### `getProductList()` / `GET /api/products`

| Consumer | File:Line | Fields Read | Notes |
|----------|-----------|-------------|-------|
| `useProductList()` hook | `apps/admin/src/hooks/useProductList.js:L18` | All fields per row | Pass-through; no code change needed. |
| `ProductList` page | `apps/admin/src/pages/ProductList.jsx:L74` | `name`, `sku`, `current_stock`, `price` | **Must be updated** if referencing `available_stock`. |
| `LowStockAlert` component | `apps/admin/src/components/LowStockAlert.jsx:L30` | `current_stock`, `name` | Used in dashboard to flag low stock — verify field reference. |
| Export CSV route | `apps/api/src/routes/export.js:L44` | `available_stock` — **THIS IS A BUG** | This route fetches product list and serializes `available_stock` to CSV. It will need a separate fix. NOT in scope for this contract. |

### `getLowStockProducts()`

| Consumer | File:Line | Fields Read | Notes |
|----------|-----------|-------------|-------|
| Dashboard API route | `apps/api/src/routes/dashboard.js:L88` | `current_stock`, `name`, `sku` | Pass-through; no change needed. |
| `useLowStockProducts()` hook | `apps/admin/src/hooks/useLowStockProducts.js:L14` | All fields | Pass-through. |
| `DashboardLowStockPanel` | `apps/admin/src/components/DashboardLowStockPanel.jsx:L22` | `name`, `current_stock` | **Must verify** field reference. |

### `searchProducts()`

| Consumer | File:Line | Fields Read | Notes |
|----------|-----------|-------------|-------|
| Product search route | `apps/api/src/routes/products.js:L198` | All fields | Pass-through. |
| `useProductSearch()` hook | `apps/admin/src/hooks/useProductSearch.js:L19` | All fields | Pass-through. |
| `ProductSearchResults` | `apps/admin/src/components/ProductSearchResults.jsx:L41` | `name`, `sku`, `current_stock` | Verify field reference. |

---

## NOT in Scope

1. **`inventoryService.js` `getInventorySummary()` at L67** — contains the same `available_stock` defect but is a separate service with its own consumers and risk surface. It requires a separate contract and fix cycle.
2. **CSV export route (`apps/api/src/routes/export.js:L44`)** — also reads `available_stock` for the export. This is a separate route with a separate consumer path (file downloads). Separate contract required.
3. **The `available_stock` column itself** — this fix does not drop or migrate the `available_stock` column. Schema cleanup is a separate migration task requiring a separate plan and rollback window.
4. **UI component `available_stock` references** — `StockBadge`, `ProductDetail`, `ProductList`, `LowStockAlert`, `ProductSearchResults` references are noted above. If those components reference `available_stock`, updating them is a separate UI fix task unless the blast radius analysis confirms they already use `current_stock`. The service contract fixes the data source; UI field reference changes are tracked separately.
5. **Performance optimization of stock queries** — the affected queries lack indexes on `(tenant_id, current_stock)`. Index addition is noted but not in scope for this fix.
6. **Authentication or authorization changes** — this fix does not touch `authenticateStaff` middleware, JWT validation, or route protection.

---

## Traceability Matrix

| PC | Test File | Test Name | Code File | Code Location | Status |
|----|-----------|-----------|-----------|---------------|--------|
| PC-S-1 | `apps/api/src/services/__tests__/productService.test.js` | `"getProductDetails returns current_stock not available_stock"` | `productService.js` | L45 | PENDING |
| PC-S-2 | `apps/api/src/services/__tests__/productService.test.js` | `"getProductDetails response does not expose available_stock"` | `productService.js` | L45 | PENDING |
| PC-S-3 | `apps/api/src/services/__tests__/productService.test.js` | `"getProductList returns current_stock for each product"` | `productService.js` | L112 | PENDING |
| PC-S-4 | `apps/api/src/services/__tests__/productService.test.js` | `"getProductList response rows do not expose available_stock"` | `productService.js` | L112 | PENDING |
| PC-S-5 | `apps/api/src/services/__tests__/productService.test.js` | `"getLowStockProducts filters on current_stock"` | `productService.js` | L234 | PENDING |
| PC-S-6 | `apps/api/src/services/__tests__/productService.test.js` | `"searchProducts returns current_stock in results"` | `productService.js` | L341 | PENDING |
| PC-A-1 | `apps/api/src/__tests__/products.routes.test.js` | `"GET /api/products/:id returns current_stock"` | `products.js` | L61 | PENDING |
| PC-A-2 | `apps/api/src/__tests__/products.routes.test.js` | `"GET /api/products list items contain current_stock"` | `products.js` | L28 | PENDING |
| PC-A-3 | `apps/api/src/__tests__/products.routes.test.js` | `"GET /api/products/:id returns zero current_stock correctly"` | `products.js` | L61 | PENDING |
| PC-U-1 | `apps/admin/src/__tests__/ProductDetail.test.jsx` | `"ProductDetail displays current_stock value"` | `ProductDetail.jsx` | L38 | PENDING |
| PC-U-2 | `apps/admin/src/__tests__/ProductList.test.jsx` | `"ProductList displays current_stock for each product row"` | `ProductList.jsx` | L74 | PENDING |
| PC-X-1 | `apps/admin/tests/e2e/product-stock.spec.js` | `"end-to-end: detail page shows current_stock not available_stock"` | `ProductDetail.jsx` | L38 | PENDING |

---

## Quality Gate

```
CONTRACT QUALITY GATE
=====================
Testability:        PASS — 12 PCs, 12 with concrete expect() skeletons (see test names; each maps to a specific value assertion)
Banned Words:       PASS — grep count: 0 (no "should", "probably", "appropriate", "reasonable", "properly", "correct" used as vague hedges)
Completeness:       PASS — 4 fix tasks (getProductDetails, getProductList, getLowStockProducts, searchProducts); all contracted
Consumer Coverage:  PASS — 13 consumers found and mapped; CSV export noted as out-of-scope with justification
Blast Radius:       PASS — 6 same-file functions checked with line numbers; 8 cross-file consumers identified with file:line
Error Coverage:     PASS — 4 external DB calls; 6 ERR-N entries (includes input validation cases)
Invariants:         PASS — 7/7 standard invariants addressed (3 N/A with justification, 4 APPLIES verified)
Scope Boundary:     PASS — 6 explicit exclusions listed in NOT in Scope
Traceability:       PASS — 12 PCs, 12 matrix rows, zero orphans
Tautology Check:    PASS — 12 PCs checked; each asserts a specific field name and value (e.g. current_stock = 42, not available_stock = 0); none pass if fix is absent
Error Strategy:     PASS — 4 DB operations with handling defined; no multi-step transactions; all error responses generic

Score: 11/11 — LOCKED
```

---

## Test Skeletons (Tautology Verification)

These skeletons confirm each postcondition is non-tautological — the test would FAIL if the fix were not applied:

```javascript
// PC-S-1: Would FAIL without fix (query returns available_stock=0, not current_stock=42)
test('getProductDetails returns current_stock not available_stock', async () => {
  // DB seed: current_stock=42, available_stock=0
  const result = await getProductDetails(productId, tenantId);
  expect(result.current_stock).toBe(42);
});

// PC-S-2: Would FAIL without fix (available_stock key exists in response)
test('getProductDetails response does not expose available_stock', async () => {
  const result = await getProductDetails(productId, tenantId);
  expect(result).not.toHaveProperty('available_stock');
});

// PC-S-5: Would FAIL without fix (product with current_stock=2, available_stock=50 would not appear)
test('getLowStockProducts filters on current_stock', async () => {
  // DB seed: current_stock=2, available_stock=50, threshold=5
  const results = await getLowStockProducts(tenantId, 5);
  const skus = results.map(r => r.sku);
  expect(skus).toContain(testProductSku);
});

// PC-X-1: Would FAIL without fix (page shows 0, not 42)
test('end-to-end: detail page shows current_stock not available_stock', async ({ page }) => {
  await page.goto(`/products/${productId}`);
  const stockValue = await page.locator('[data-testid="stock-quantity"]').textContent();
  expect(stockValue).toBe('42');
});
```

---

*Contract locked 2026-03-14. Build phase may begin. Any amendments require forge-review finding to trigger recycle rule.*
