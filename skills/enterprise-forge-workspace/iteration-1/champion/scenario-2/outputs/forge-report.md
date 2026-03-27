# Forge Report: stock-quantity-fix

**Date:** 2026-03-14
**Contract:** `docs/contracts/stock-quantity-fix-contract.md`
**Review:** `docs/reviews/2026-03-14-stock-quantity-fix-review.md` — PASSED
**Forge iterations:** 2
**Changed files:** `apps/api/src/services/productService.js`, `apps/api/src/__tests__/productService.test.js`
**Base branch:** `dev`

---

## Part 1: Mechanical Checks

| Check | Result | Details |
|-------|--------|---------|
| M1 Import Resolution | PASS | All `require()` calls in both changed files resolve: `../db`, `../utils/logger`, `../utils/errors`, `../services/productService` |
| M2 Uncommitted Files | PASS | No untracked `.js`/`.ts`/`.sql` source files in working tree |
| M3 Dead Exports | PASS | `getProductDetails` and `getProductList` both imported by `routes/products.js` and the test file |
| M4 Contract Crosscheck | PASS | 6 original PCs + 1 forge-added PC (PC-3.1) all have passing tests; 12 tests pass in final suite |
| M5 Debug Artifacts | PASS | No `console.log`, `console.debug`, or `debugger` in added lines of `productService.js` |
| M6 Tenant Isolation | PASS | All 3 new SELECT statements in diff scope to `tenant_id = $1` |
| M7 Concurrency Check | PASS | No module-level `let`/`var` mutable state introduced |

**Mechanical Verdict: PASS**

---

## Part 2: Contract Probing

| PC | Original Test | Probe Angle | Result | New PC |
|----|--------------|-------------|--------|--------|
| PC-1 | Mock asserts `result.current_stock === 42` | Inspect literal SQL for column alias hiding `available_stock` | CLEAR | — |
| PC-2 | Non-existent productId returns null | Cross-tenant: product exists for tenant B, request from tenant A | CLEAR | — |
| PC-3 | Missing `tenantId` (undefined) throws | Falsy variants: `null` and `''` (empty string) | **BUG** | PC-3.1 |
| PC-4 | 3 products return with `current_stock` field | `current_stock=0` — field present even at zero value | CLEAR | — |
| PC-5 | 2 in-stock / 1 out-of-stock, asserts length=2 | Exact boundary: `current_stock=0` excluded, `current_stock=1` included | CLEAR | — |
| PC-6 | Empty tenant returns `[]` | Route response shape: bare array vs wrapped `{ products: [] }` | CLEAR | — |

**Bug found in PC-3 probe:**

`getProductDetails()` used `if (tenantId === undefined)` — a strict equality guard that passed `''` (empty string) through to the SQL query. The query ran with `tenant_id = ''`, returned zero rows, and the function returned `null` silently. A caller passing an empty string received `null` and could not distinguish a missing product from a malformed call.

**Fix applied (iteration 1 recycle):**

```javascript
// Before
if (tenantId === undefined) {
  throw new ValidationError('tenantId is required');
}

// After
if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
  throw new ValidationError('tenantId is required');
}
```

Same fix applied to `getProductList()`. PC-3.1 added to contract and test suite.

---

## Part 3: Adversarial Lenses

### Lens 1: 3AM Test

**3AM-1 (non-blocking):** `catch` block in `getProductDetails` logs `{ err }` only. No `tenantId` or `productId` context. On-call engineer cannot identify affected tenant or record from the log entry alone.
- Fix: `logger.error('getProductDetails failed', { err, tenantId, productId })`

**3AM-2 (non-blocking):** Same logging gap in `getProductList`. No `tenantId` or `inStock` filter logged on error.
- Fix: `logger.error('getProductList failed', { err, tenantId, inStock })`

### Lens 2: Delete Test

No dead code found. All `available_stock` references fully excised. `inStock` parameter pathway clean. **CLEAN.**

### Lens 3: New Hire Test

**NEWHIRE-1 (non-blocking):** `WHERE current_stock > 0` implements the `inStock=true` filter with no comment explaining that "in stock" is a quantity threshold, not a status flag.
- Fix: Add inline comment above the conditional SQL fragment.

**NEWHIRE-2 (non-blocking):** The compound `typeof tenantId !== 'string'` check in the guard (added by recycle fix) is not obviously necessary to a reader who assumes middleware always provides a string.
- Fix: Add inline comment explaining the guard protects against misconfigured middleware.

### Lens 4: Adversary Test

**ADVERSARY-2 (non-blocking):** `getProductDetails()` validates `tenantId` but has no guard on `productId`. Passing `productId: undefined` causes the pg driver to coerce `undefined` to `null`, running `WHERE id = NULL` (no rows match), and returning `null` silently. No data leak occurs (SQL NULL semantics isolate the query), but the caller cannot distinguish "product not found" from "call was malformed."
- Fix: Add `if (!productId) throw new ValidationError('productId is required')` before the query.
- Note: Not a security issue. Data remains isolated. Tracked as contract gap.

### Lens 5: Scale Test

**SCALE-1 (non-blocking):** `getProductList()` issues an unbounded `SELECT ... FROM products WHERE tenant_id = $1` with no `LIMIT`. At current tenant scale (< 500 products) this is negligible. At 10,000+ products per tenant, payload and memory pressure become significant.
- Fix: Add cursor-based or offset pagination before scale concerns materialise.

**SCALE-2 (non-blocking):** `WHERE current_stock > 0` with no partial index means Postgres may seq scan the tenant's product rows for the `inStock=true` path at high row counts. `tenant_id` index narrows the scan but does not eliminate it.
- Fix: Consider `CREATE INDEX ... ON products(tenant_id) WHERE current_stock > 0` when product counts grow.

---

## Recycle Log

| Iteration | Bugs Found | Bug Description | New PC | RED | GREEN | Re-forge |
|-----------|-----------|-----------------|--------|-----|-------|----------|
| 1 | 1 | `tenantId=''` bypasses guard, silent null return | PC-3.1 | Confirmed FAIL | 12 tests PASS | Run |
| 2 | 0 | — | — | — | — | Exit: FORGED |

---

## Failure Tracker

| Check | Failures | Status |
|-------|----------|--------|
| M1 | 0/3 | OK |
| M2 | 0/3 | OK |
| M3 | 0/3 | OK |
| M4 | 0/3 | OK |
| M5 | 0/3 | OK |
| M6 | 0/3 | OK |
| M7 | 0/3 | OK |

---

## Final Verdict

**Forge iterations:** 2
**Bugs found and recycled:** 1 (PC-3 probe — tenantId empty string guard; fixed and verified)
**Circuit breakers triggered:** 0
**Outstanding findings (non-blocking):** 7

| # | Finding | Severity |
|---|---------|----------|
| 3AM-1 | Missing tenantId/productId in error log (getProductDetails) | Non-blocking |
| 3AM-2 | Missing tenantId/inStock in error log (getProductList) | Non-blocking |
| NEWHIRE-1 | Uncommented `current_stock > 0` inStock filter intent | Non-blocking |
| NEWHIRE-2 | Uncommented `typeof` check in tenantId guard | Non-blocking |
| ADVERSARY-2 | Missing productId validation — silent null on undefined input | Non-blocking |
| SCALE-1 | Unbounded SELECT in getProductList — no pagination | Non-blocking |
| SCALE-2 | No partial index for current_stock > 0 filter path | Non-blocking |

**VERDICT: FORGED**

All mechanical checks pass. 1 bug found (tenantId empty-string bypass), recycled with full TDD treatment (RED → GREEN), re-forged to 0 bugs. 7 non-blocking improvements logged for follow-up. Code is safe to merge.
