# Forge Report: Inventory Adjustment Feature

**Date**: 2026-03-14
**Feature**: Inventory Adjustment (`adjustInventory()` service)
**Forge iterations**: 2 (iteration 0: bug found, iteration 1: clean)
**Final verdict**: FORGED

---

## Part 1: Mechanical Checks

### Iteration 0

| Check | Result | Detail |
|-------|--------|--------|
| M1 Import Resolution | PASS | All require/import paths resolve |
| M2 Uncommitted Files | PASS | No orphaned source files |
| M3 Dead Exports | PASS | No flags |
| M4 Contract Crosscheck | PASS | All existing PCs have passing tests |
| M5 Debug Artifacts | PASS | No console.log/debug/debugger in new code |
| **M6 Tenant Isolation** | **FLAG** | `adjustInventory()` SELECT query lacks `tenant_id` scope |
| M7 Concurrency Check | PASS | No unguarded module-level mutable state |

**M6 Detail:**

```
M6 FLAG: apps/api/src/services/inventoryService.js — query may lack tenant_id:
+    const result = await pool.query('SELECT * FROM inventory WHERE product_id = $1', [productId]);
```

The query in `adjustInventory()` selects from `inventory` filtering only by `product_id`. It does not scope to `tenant_id`. In a multi-tenant system, this means a tenant could read or adjust inventory belonging to another tenant if product IDs collide or are guessed. This is a **security bug** — cross-tenant data leak.

**Verdict: M6 FLAG escalated to BUG. Entering recycle loop.**

---

## Recycle Loop

### Iteration 0 -> 1: Tenant Isolation Bug

**Bug found by**: M6 (Tenant Isolation check)
**Bug count this iteration**: 1
**Previous iteration bug count**: N/A (first iteration)

#### Step 1: Check known-traps registry

```bash
cat .claude/enterprise-state/known-traps.json
```

**Match found**: `trap-001` — `missing_tenant_id_scope`

> Pattern: SELECT/UPDATE/DELETE without WHERE tenant_id — cross-tenant data leak
> Previously found: 7 times
> Last found: 2026-03-14

This is a **known trap**. The registry confirms this is the most common bug class in the codebase (7 prior occurrences). The contract should have included a tenant isolation postcondition but did not — exactly the failure mode `trap-001.prevention` warns about.

**Registry update**: Increment `found_count` from 7 to 8, update `last_found` to `2026-03-14`.

#### Step 2: New postcondition (appended to contract)

```
PC-7: Every database query in adjustInventory() scopes to tenant_id.
  - The SELECT on inventory includes WHERE tenant_id = $tenantId
  - The UPDATE on inventory includes WHERE tenant_id = $tenantId
  - A call with a valid product_id but wrong tenant_id returns no rows / affects no rows
```

Postcondition registry updated:
```json
{
  "id": "PC-7",
  "description": "adjustInventory() scopes all queries to tenant_id",
  "passes": false,
  "added_by": "forge",
  "source_check": "M6",
  "iteration_added": 0
}
```

#### Step 3: RED test (must FAIL against current code)

```javascript
// apps/api/src/__tests__/inventoryService.test.js
// === FORGE PROBES ===

describe('PC-7: adjustInventory tenant isolation', () => {
  it('does not return inventory belonging to another tenant', async () => {
    // Setup: create inventory rows for tenant A and tenant B with same product_id
    const tenantA = testTenantA.id;
    const tenantB = testTenantB.id;
    const productId = sharedProductId;

    await pool.query(
      'INSERT INTO inventory (product_id, tenant_id, quantity) VALUES ($1, $2, 10)',
      [productId, tenantA]
    );
    await pool.query(
      'INSERT INTO inventory (product_id, tenant_id, quantity) VALUES ($1, $2, 20)',
      [productId, tenantB]
    );

    // Act: adjust inventory as tenant A
    const result = await adjustInventory(tenantA, productId, -5);

    // Assert: only tenant A's inventory is affected
    const rowA = await pool.query(
      'SELECT quantity FROM inventory WHERE product_id = $1 AND tenant_id = $2',
      [productId, tenantA]
    );
    const rowB = await pool.query(
      'SELECT quantity FROM inventory WHERE product_id = $1 AND tenant_id = $2',
      [productId, tenantB]
    );

    expect(rowA.rows[0].quantity).toBe(5);   // 10 - 5
    expect(rowB.rows[0].quantity).toBe(20);  // untouched
  });
});
```

**RED confirmation**: Test FAILS because `adjustInventory()` currently runs:
```sql
SELECT * FROM inventory WHERE product_id = $1
```
This returns BOTH tenant A and tenant B rows. The function operates on the wrong row (or both rows), violating tenant isolation.

#### Step 4: GREEN fix (minimal code to pass)

```javascript
// apps/api/src/services/inventoryService.js

// BEFORE (buggy):
async function adjustInventory(tenantId, productId, quantityDelta) {
  const result = await pool.query(
    'SELECT * FROM inventory WHERE product_id = $1',
    [productId]
  );
  // ... adjustment logic using result.rows[0] ...
  await pool.query(
    'UPDATE inventory SET quantity = quantity + $1 WHERE product_id = $2',
    [quantityDelta, productId]
  );
}

// AFTER (fixed):
async function adjustInventory(tenantId, productId, quantityDelta) {
  const result = await pool.query(
    'SELECT * FROM inventory WHERE product_id = $1 AND tenant_id = $2',
    [productId, tenantId]
  );
  if (result.rows.length === 0) {
    throw new Error(`No inventory found for product ${productId} in tenant ${tenantId}`);
  }
  // ... adjustment logic using result.rows[0] ...
  await pool.query(
    'UPDATE inventory SET quantity = quantity + $1 WHERE product_id = $2 AND tenant_id = $3',
    [quantityDelta, productId, tenantId]
  );
}
```

**GREEN confirmation**: Test now PASSES. Full test suite re-run: all tests pass.

#### Step 5: Update postcondition registry

```json
{
  "id": "PC-7",
  "description": "adjustInventory() scopes all queries to tenant_id",
  "passes": true,
  "added_by": "forge",
  "source_check": "M6",
  "iteration_added": 0,
  "fixed_in_iteration": 1
}
```

---

### Iteration 1: Re-forge

| Check | Result | Detail |
|-------|--------|--------|
| M1 Import Resolution | PASS | |
| M2 Uncommitted Files | PASS | |
| M3 Dead Exports | PASS | |
| M4 Contract Crosscheck | PASS | PC-7 now has a passing test |
| M5 Debug Artifacts | PASS | |
| M6 Tenant Isolation | PASS | Both SELECT and UPDATE now scope to tenant_id |
| M7 Concurrency Check | PASS | |

**Bug count this iteration**: 0
**Previous iteration bug count**: 1
**Monotonic progress**: YES (1 -> 0)

---

## Part 2: Contract Probing (Iteration 1)

| PC | Original Test | Probe Angle | Result |
|----|--------------|-------------|--------|
| PC-1 | Happy path adjustment | What if quantity goes negative? | PASS — validation rejects negative result |
| PC-2 | Returns updated quantity | Round-trip: write then read back from DB | PASS — quantity matches |
| PC-3 | Logs adjustment event | Does log include tenant_id for 3AM debugging? | PASS — log includes tenantId, productId, delta |
| PC-4 | Rejects invalid product_id | What about product_id = null? | PASS — validation catches null |
| PC-5 | Requires auth | Direct service call without route — does it still validate? | PASS — service validates tenantId param |
| PC-6 | Returns 404 for missing product | What about product that exists for different tenant? | PASS — returns 404 (tenant-scoped query) |
| PC-7 | Tenant isolation (forge-added) | Two tenants, same product_id, concurrent adjustments | PASS — each tenant's row independent |

**No bugs found in contract probing.**

---

## Part 3: Adversarial Lenses (Iteration 1)

### Lens 1: 3AM Test
No findings. Error paths log tenant_id, product_id, and the operation attempted. Sufficient for diagnosis.

### Lens 2: Delete Test
No findings. No dead code detected in changed files.

### Lens 3: New Hire Test
- **NEWHIRE-1** (improvement): The `quantityDelta` parameter name is clear, but the function doesn't document that negative values mean stock reduction. A JSDoc comment would help. **Non-blocking.**

### Lens 4: Adversary Test
No findings after fix. The tenant isolation fix closes the main attack vector. Transaction safety was reviewed — single SELECT then single UPDATE, no partial write risk for this operation.

### Lens 5: Scale Test
- **SCALE-1** (improvement): The query `SELECT * FROM inventory WHERE product_id = $1 AND tenant_id = $2` would benefit from a composite index on `(tenant_id, product_id)` at scale. Current index on `product_id` alone is sufficient for current volume. **Non-blocking — log for future.**

---

## Failure Tracker

| Check | Consecutive Failures | Limit | Status |
|-------|---------------------|-------|--------|
| M1 | 0/3 | 3 | OK |
| M2 | 0/3 | 3 | OK |
| M3 | 0/3 | 3 | OK |
| M4 | 0/3 | 3 | OK |
| M5 | 0/3 | 3 | OK |
| M6 | 1/3 | 3 | OK — fixed in iteration 1 |
| M7 | 0/3 | 3 | OK |

No circuit breakers fired.

---

## Known-Traps Registry Update

**Matched trap**: `trap-001` (`missing_tenant_id_scope`)

```json
{
  "id": "trap-001",
  "pattern": "missing_tenant_id_scope",
  "category": "security",
  "found_count": 8,
  "last_found": "2026-03-14",
  "source_check": "M6",
  "description": "SELECT/UPDATE/DELETE without WHERE tenant_id — cross-tenant data leak",
  "detection": "grep for SQL queries in changed files that lack tenant_id in WHERE clause",
  "prevention": "Add as INV-1 in every contract: 'Every query scopes to tenant_id'"
}
```

**Change**: `found_count` incremented from 7 to 8. `last_found` confirmed as `2026-03-14`.

**Observation**: This is the 8th occurrence of this trap. The `prevention` field recommends adding tenant isolation as an invariant (INV-1) to every contract. This recommendation has clearly not been adopted consistently — the inventory adjustment contract omitted it. Recommend enforcing this as a mandatory contract invariant via the enterprise-contract skill's template.

---

## Recycle Log Summary

| Iteration | Bugs Found | New PCs | RED | GREEN | All Tests Pass |
|-----------|-----------|---------|-----|-------|----------------|
| 0 | 1 (M6: tenant isolation) | PC-7 | YES | YES | YES |
| 1 | 0 | — | — | — | YES |

---

## Improvements (non-blocking)

1. **NEWHIRE-1**: Add JSDoc to `adjustInventory()` documenting that `quantityDelta` accepts negative values for stock reduction.
2. **SCALE-1**: Consider composite index `(tenant_id, product_id)` on `inventory` table when volume grows.

---

## Final Verdict

### FORGED

- Iterations: 2 (1 recycle)
- Bugs found and fixed: 1 (tenant isolation — cross-tenant data leak)
- Circuit breakers fired: 0
- Regressions: 0
- Known trap matched: trap-001 (8th occurrence)
- Improvements logged: 2 (non-blocking)
