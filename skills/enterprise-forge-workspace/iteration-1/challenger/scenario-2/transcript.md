# Forge Execution Transcript
**Scenario**: 2 — stock-quantity bug fix (available_stock → current_stock)
**Skill**: enterprise-forge (challenger iteration-1)
**Date**: 2026-03-14

---

## Pre-forge Confirmation

> Confirming prerequisites before forging.

- enterprise-review status: PASSED (given)
- Contract location: `docs/contracts/stock-quantity-fix.md` — 6 postconditions (PC-1 through PC-6)
- Plan location: `docs/plans/2026-03-14-stock-quantity-fix.md`
- Changed files: `apps/api/src/services/productService.js`, `apps/api/src/__tests__/productService.test.js`
- Base branch: `dev`
- Change type: read-path-only (no write queries changed)

Prerequisites confirmed. Beginning Part 1.

---

## Part 1: Mechanical Checks

**M1 — Import Resolution**

```
Checking: apps/api/src/services/productService.js
  require('../db/pool') → apps/api/src/db/pool.js ✓
  require('../utils/errors') → apps/api/src/utils/errors.js ✓
  require('../utils/logger') → apps/api/src/utils/logger.js ✓
M1: PASS
```

**M2 — Uncommitted Files**

```
$ git ls-files --others --exclude-standard | grep -E '\.(js|jsx|ts|tsx|sql)$'
(no output)
M2: PASS
```

**M3 — Dead Exports**

```
Checking: apps/api/src/services/productService.js
  export: getProductDetails → imported by productRoutes.js, adminRoutes.js ✓
  export: getProductList → imported by productRoutes.js ✓
M3: FLAG (cleared — active importers confirmed)
```

**M4 — Contract Crosscheck**

```
$ cd apps/api && npx jest productService --passWithNoTests 2>&1 | tail -5
  Test Suites: 1 passed, 1 total
  Tests:       32 passed, 32 total
  Snapshots:   0 total
  Time:        1.42s

$ grep -n "PC-" src/__tests__/productService.test.js
  12:  // PC-1: returns current_stock field
  28:  // PC-2: list returns current_stock on every row
  44:  // PC-3: current_stock is non-negative integer
  61:  // PC-4: queries scope to tenant_id
  78:  // PC-5: throws NotFoundError when product not found
  94:  // PC-6: no available_stock field in return
M4: PASS
```

**M5 — Debug Artifacts**

```
$ git diff dev...HEAD -- apps/api/src/services/productService.js \
  | grep "^+" | grep -v "^+++" \
  | grep -cE "(console\.(log|debug)|debugger\b)"
0
M5: PASS
```

**M6 — Tenant Isolation**

```
Checking added SELECT statements in productService.js:
  + WHERE p.tenant_id = $1 AND p.id = $2   ← getProductDetails
  + WHERE p.tenant_id = $1                   ← getProductList
Both queries include tenant_id.
M6: PASS (no flags)
```

**M7 — Concurrency Check**

```
$ git diff dev...HEAD -- apps/api/src/services/productService.js \
  | grep "^+" | grep -v "^+++" \
  | grep -E "^.(let|var)\s+\w+\s*="
(no output)
M7: PASS
```

**Mechanical result: ALL PASS. Proceeding to Part 2.**

---

## Part 2: Contract Probing

**Probing PC-1** (getProductDetails returns current_stock)
> Original test: unit with mock returning `{ current_stock: 42 }`.
> Probe angle: SQL alias correctness vs mock masking.
> Tracing SQL in diff: `SELECT p.id, p.name, p.current_stock ...` — exact column name, no alias.
> Result: PASS — no gap between mock and real query shape.

**Probing PC-2** (getProductList returns current_stock on every row)
> Original test: 3-row mock, asserts every row has current_stock.
> Probe angle: empty result set — does `.map()` on `[]` return `[]` without throw?
> Tracing: `return rows.map(r => formatProduct(r))` — yes, `[].map(fn)` → `[]`.
> Result: PASS.

**Probing PC-3** (current_stock is non-negative integer)
> Original test: mock returns JS number `10`. Asserts `typeof === 'number'` and `>= 0`.
> Probe angle: pg returns BIGINT/NUMERIC as string in some configurations. Mock masks this.
> Checking formatProduct():

```js
function formatProduct(row) {
  return {
    id: row.id,
    name: row.name,
    current_stock: row.current_stock,  // ← no coercion
    tenant_id: row.tenant_id,
  };
}
```

> If DB column is BIGINT, `row.current_stock` = `"42"` (string). `"42" >= 0` is true (JS coercion). `typeof "42" === 'number'` is false. PC-3 fails against real DB.
> **BUG FOUND — PC-3-FORGE.**

> Entering recycle loop. Pausing remaining probes.

---

## Recycle Iteration 1

**New postcondition**: PC-3.1 — current_stock returned as JS number, not string.
**Registry update**: `{ "id": "PC-3.1", "passes": false, "added_by": "forge", "iteration": 1 }`

**Writing RED test:**
```js
// === FORGE PROBES ===
// PC-3.1
it('PC-3.1: getProductDetails returns current_stock as JS number (not string)', async () => {
  pool.query.mockResolvedValueOnce({
    rows: [{ id: 'prod-1', name: 'Widget', current_stock: '42', tenant_id: 'tenant-1' }]
  });
  const result = await getProductDetails('tenant-1', 'prod-1');
  expect(typeof result.current_stock).toBe('number');
  expect(result.current_stock).toBe(42);
});
```

**Running RED test:**
```
FAIL  src/__tests__/productService.test.js
  ● PC-3.1: getProductDetails returns current_stock as JS number (not string)
    expect(received).toBe(expected)
    Expected: "number"
    Received: "string"
✓ RED confirmed.
```

**Writing GREEN fix:**
```js
function formatProduct(row) {
  return {
    id: row.id,
    name: row.name,
    current_stock: Number(row.current_stock),  // coerce pg string → JS number
    tenant_id: row.tenant_id,
  };
}
```

**Running full suite:**
```
Tests: 33 passed, 33 total
✓ All passing. Iteration 1 complete.
```

**Resuming contract probing with remaining PCs.**

---

**Probing PC-4** (tenant_id scoping)
> Probe angle: null tenantId — does it leak cross-tenant or safely return empty?
> `WHERE tenant_id = NULL` → NULL comparison → 0 rows. Safe.
> Result: PASS. Improvement noted: add explicit null guard with typed error (non-blocking).

**Probing PC-5** (NotFoundError on missing product)
> Probe angle: Does getProductList also throw on empty, or return []?
> Tracing getProductList: returns `[]` on empty — correct list semantics.
> PC-5 scoped to getProductDetails only — confirmed correct.
> Result: PASS.

**Probing PC-6** (no available_stock in return)
> Probe angle: Does formatProduct() spread row (could leak available_stock from DB view)?
> Confirmed: explicit field list, no spread. Even if DB row had available_stock it would not appear.
> Result: PASS.

**Contract probing complete. 1 bug found and recycled in iteration 1. Proceeding to Part 3.**

---

## Part 3: Adversarial Lenses

### Lens 1: 3AM Test

> Pulling all catch blocks from productService.js diff.

```
getProductDetails catch block:
  catch (err) {
    logger.error('getProductDetails failed', { err });
    throw err;
  }
```

> Missing: productId, tenantId. Can't tell WHICH product failed at 3AM.
> Finding: 3AM-1 — improvement (non-blocking).

> Checking null path through GREEN fix.
> `Number(null) === 0`. If `products.current_stock` is nullable, null DB value silently becomes 0.
> A product with null stock appears as "0 in stock" — could trigger false out-of-stock blocks or false in-stock displays.
> **BUG: 3AM-2.**

**Entering recycle iteration 2.**

---

## Recycle Iteration 2

**Monotonic check**: previous bug count = 0 (after iteration 1), this iteration = 1. Valid entry (new phase, not regression).
**Iteration counter**: 2 of 5. Cap not reached.

**New postcondition**: PC-7 — null current_stock throws DataIntegrityError.
**Registry update**: `{ "id": "PC-7", "passes": false, "added_by": "forge", "iteration": 2 }`

**RED test:**
```js
// PC-7
it('PC-7: getProductDetails throws DataIntegrityError when current_stock is null', async () => {
  pool.query.mockResolvedValueOnce({
    rows: [{ id: 'prod-1', name: 'Widget', current_stock: null, tenant_id: 'tenant-1' }]
  });
  await expect(getProductDetails('tenant-1', 'prod-1'))
    .rejects.toThrow(DataIntegrityError);
});
```

**RED run:**
```
FAIL  productService.test.js
  ● PC-7: ...
    Received function did not throw
✓ RED confirmed.
```

**GREEN fix:**
```js
function formatProduct(row) {
  if (row.current_stock === null || row.current_stock === undefined) {
    throw new DataIntegrityError(
      `current_stock is null for product ${row.id} (tenant ${row.tenant_id})`
    );
  }
  return {
    id: row.id,
    name: row.name,
    current_stock: Number(row.current_stock),
    tenant_id: row.tenant_id,
  };
}
```

**Full suite:**
```
Tests: 34 passed, 34 total
✓ Iteration 2 complete.
```

---

### Lens 2: Delete Test

> Scanning for dead variables.

```
getProductList:
  const formattedRows = rows.map(r => formatProduct(r));
  return formattedRows;
```

> `formattedRows` used only once — immediate return. Dead assignment.
> DELETE-1 — improvement (non-blocking). No bug.

---

### Lens 3: New Hire Test

> Reading productService.js for magic numbers, opaque names, missing context.

> `formatProduct()` — after GREEN fixes it now validates AND maps. Name doesn't signal validation.
> NEWHIRE-1 — improvement.

> No comment near query explaining `current_stock` replaced `available_stock`.
> NEWHIRE-2 — improvement.

> No bugs from this lens.

---

### Lens 4: Adversary Test

> Attack 1: Cross-tenant — `WHERE tenant_id = $1 AND id = $2` — parameterized, isolated. PASS.
> Attack 2: SQL injection via productId — pg parameterizes all values. PASS.
> Attack 3: Cause DataIntegrityError DoS — null stock is a data layer problem. Write path should have NOT NULL constraint. Improvement flagged (IMP-5). Not a read-path bug.

> No bugs from this lens.

---

### Lens 5: Scale Test

> Scanning queries for LIMIT.

```
getProductList SQL:
  SELECT p.id, p.name, p.current_stock, p.tenant_id
  FROM products p
  WHERE p.tenant_id = $1
  ORDER BY p.name
  ← no LIMIT clause
```

> At 10x tenant catalog size: slow queries, large response payloads.
> At 1000x: unbounded heap growth, potential OOM on Node process.
> Also: DoS vector — tenant with 50k products can exhaust API memory on every list call.
> **BUG: SCALE-1 — unbounded SELECT.**

**Entering recycle iteration 3.**

---

## Recycle Iteration 3

**Monotonic check**: previous = 0, this = 1. Valid.
**Iteration counter**: 3 of 5. Cap not reached.

**New postcondition**: PC-8 — getProductList accepts limit/offset, defaults to limit=100.
**Registry update**: `{ "id": "PC-8", "passes": false, "added_by": "forge", "iteration": 3 }`

**RED test:**
```js
// PC-8
it('PC-8: getProductList applies default limit of 100', async () => {
  const mockRows = Array.from({ length: 100 }, (_, i) => ({
    id: `prod-${i}`, name: `Product ${i}`, current_stock: i + 1, tenant_id: 'tenant-1'
  }));
  pool.query.mockResolvedValueOnce({ rows: mockRows });
  await getProductList('tenant-1');
  expect(pool.query.mock.calls[0][0]).toMatch(/LIMIT \$\d/);
  expect(pool.query.mock.calls[0][1]).toContain(100);
});
```

**RED run:**
```
FAIL  productService.test.js
  ● PC-8: ...
    expect(received).toMatch(/LIMIT \$\d/)
    Received: "SELECT p.id ... ORDER BY p.name"
✓ RED confirmed.
```

**GREEN fix:**
```js
async function getProductList(tenantId, { limit = 100, offset = 0 } = {}) {
  const sql = `
    SELECT p.id, p.name, p.current_stock, p.tenant_id
    FROM products p
    WHERE p.tenant_id = $1
    ORDER BY p.name
    LIMIT $2 OFFSET $3
  `;
  const { rows } = await pool.query(sql, [tenantId, limit, offset]);
  return rows.map(r => formatProduct(r));
}
```

**M6 re-check for new params**: `WHERE tenant_id = $1` still present. PASS.

**Full suite:**
```
Tests: 35 passed, 35 total
✓ Iteration 3 complete.
```

---

## Recycle Iteration 4 — Final Verification

> Re-running all checks against post-fix state.

**Mechanical checks (re-run):**
```
M1: PASS — no new imports added
M2: PASS — no new untracked files
M4: PASS — 35 tests, PC-1 through PC-8 all covered
M5: PASS — no debug artifacts
M6: PASS — both queries still scope to tenant_id
```

**Contract probing (spot-check post-fix):**
```
PC-3.1: Number(row.current_stock) coercion — test passes ✓
PC-7: null guard → DataIntegrityError — test passes ✓
PC-8: LIMIT $2 OFFSET $3, default 100 — test passes ✓
```

**Adversarial lenses (re-scan):**
```
3AM: catch blocks unchanged, IMP-1 still logged as improvement
Delete: IMP-2 still logged
New Hire: IMP-3, IMP-4 still logged
Adversary: no new attack surface from pagination params
Scale: LIMIT clause now present — SCALE-1 resolved
```

**Bug count this iteration: 0.**

**EXIT CONDITION MET: Bug count = 0. FORGED.**

---

## Transcript Summary

| Phase | Duration | Findings |
|-------|----------|----------|
| Mechanical checks | — | 7/7 PASS, 0 FAIL |
| Contract probing | — | 6 PCs probed, 1 bug (PC-3-FORGE) |
| Recycle 1 | — | PC-3.1 added, RED→GREEN, 33 passing |
| Lens 1 (3AM) | — | 1 bug (3AM-2), 1 improvement |
| Recycle 2 | — | PC-7 added, RED→GREEN, 34 passing |
| Lens 2 (Delete) | — | 0 bugs, 1 improvement |
| Lens 3 (New Hire) | — | 0 bugs, 2 improvements |
| Lens 4 (Adversary) | — | 0 bugs, 1 improvement |
| Lens 5 (Scale) | — | 1 bug (SCALE-1) |
| Recycle 3 | — | PC-8 added, RED→GREEN, 35 passing |
| Final re-run | — | 0 bugs |

**Total bugs found and fixed**: 3 (PC-3-FORGE, 3AM-2/PC-7, SCALE-1/PC-8)
**Total improvements logged**: 5 (non-blocking)
**Final verdict**: FORGED
