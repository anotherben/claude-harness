# Forge Report: Inventory Adjustment Feature

**Date**: 2026-03-14
**Feature**: Inventory adjustment (manual stock corrections)
**Contract**: `docs/contracts/2026-03-14-inventory-adjustment-contract.md`
**Plan**: `docs/plans/2026-03-14-inventory-adjustment-plan.md`
**Changed files**: `git diff --name-only dev...HEAD`

```
apps/api/src/services/inventory.js
apps/api/src/routes/inventory.js
apps/api/src/__tests__/inventory.test.js
apps/api/database/migrations/20260314_inventory_adjustments.sql
```

---

## Part 1: Mechanical Checks

| Check | What It Verifies | Verdict | Notes |
|-------|-----------------|---------|-------|
| M1 Import Resolution | Every require/import resolves | PASS | All 3 imports in inventory.js resolve |
| M2 Uncommitted Files | No orphaned untracked source files | PASS | No untracked .js/.sql files |
| M3 Dead Exports | Exports that nothing imports | PASS | `adjustInventory`, `getAdjustmentHistory` both imported by routes |
| M4 Contract Crosscheck | Every PC has a passing test | PASS | PC-1 through PC-5 all have tests, all passing |
| M5 Debug Artifacts | No console.log/debug/debugger | PASS | 0 debug artifacts in added lines |
| **M6 Tenant Isolation** | Every new query scopes to tenant_id | **FLAG** | **See below** |
| M7 Concurrency Check | No unguarded module-level mutable state | PASS | No module-level let/var |

### M6 Detail

```
M6 FLAG: apps/api/src/services/inventory.js — query may lack tenant_id:
+    const result = await pool.query('SELECT id, quantity FROM products WHERE id = $1', [productId]);
```

**Analysis**: The `adjustInventory()` function fetches the current product quantity before applying the adjustment. This SELECT does not include `AND tenant_id = $2`. A caller could pass any product ID and read/adjust products belonging to a different tenant.

**Verdict**: This is a **BUG**, not a false positive. The query is a data read that feeds directly into a write path. Without tenant scoping, tenant A could adjust tenant B's inventory.

---

## Part 2: Contract Probing

| PC | Original Test | Probe Angle | Result |
|----|--------------|-------------|--------|
| PC-1: Adjustment creates audit record | Happy path: adjust +5, check audit row exists | Probe: does audit record include tenant_id? | PASS — audit INSERT includes tenant_id |
| PC-2: Negative adjustment rejects if insufficient stock | Test: adjust -10 when stock=5, expect 400 | Probe: what if quantity is exactly 0? | PASS — adjust -1 when stock=0 returns 400 |
| PC-3: Adjustment updates product quantity | Test: adjust +5, read product, verify quantity | Probe: does the UPDATE scope to tenant_id? | PASS — UPDATE includes tenant_id |
| PC-4: Only warehouse_manager role can adjust | Test: call with staff role, expect 403 | Probe: what about admin role? | PASS — admin also permitted (correct per contract) |
| PC-5: Concurrent adjustments don't lose updates | Test: two parallel +1 adjustments | Probe: uses SELECT FOR UPDATE? | PASS — row lock present |

**Contract probing found 0 additional bugs.** The M6 flag is the primary finding.

---

## Part 3: Adversarial Lenses

### Lens 1: 3AM Test
- **3AM-1**: `adjustInventory()` catch block logs `"Adjustment failed"` with `error.message` but does NOT log `productId` or `tenantId`. Diagnosis at 3AM would require re-running the request. **Improvement** — non-blocking, but should add context.

### Lens 2: Delete Test
- No dead code found. Both exported functions are consumed by routes.

### Lens 3: New Hire Test
- **NEWHIRE-1**: The adjustment reason codes (`DAMAGE`, `RECOUNT`, `RETURN`, `MANUAL`) are inline strings in the route validation. Should be a constant enum for discoverability. **Improvement** — non-blocking.

### Lens 4: Adversary Test
- **ADVERSARY-1**: Cross-tenant inventory read via `adjustInventory()` — the SELECT query fetches product by ID without tenant scoping. An attacker who knows a product UUID from another tenant could read its quantity and apply an adjustment. **BUG** — this is the same finding as M6, confirmed from the adversary angle. Impact: data leakage + data corruption across tenants.

### Lens 5: Scale Test
- No N+1 patterns. Single SELECT + single UPDATE per adjustment. No unbounded queries.

---

## Recycle Loop

### Iteration 1: 1 bug found

**Bug**: M6 + ADVERSARY-1 — `adjustInventory()` SELECT query lacks tenant_id scoping.

#### Step 1: New Postcondition

> **PC-6** (added by forge): The SELECT query in `adjustInventory()` MUST scope to `tenant_id`. A request with a valid product ID belonging to a different tenant MUST return 404 (product not found for this tenant), NOT the other tenant's data.

Contract updated: `docs/contracts/2026-03-14-inventory-adjustment-contract.md` — PC-6 appended.

Postcondition registry updated:
```json
{
  "PC-6": {
    "description": "adjustInventory SELECT scopes to tenant_id",
    "passes": false,
    "added_by": "forge",
    "iteration": 1
  }
}
```

#### Step 2: RED Test

```javascript
// === FORGE PROBES === (in apps/api/src/__tests__/inventory.test.js)

// PC-6: adjustInventory SELECT must scope to tenant_id
test('PC-6: adjustInventory rejects product belonging to different tenant', async () => {
  // Setup: product belongs to tenant A
  const tenantA = testTenants.tenantA.id;
  const tenantB = testTenants.tenantB.id;
  const product = await createTestProduct({ tenant_id: tenantA, quantity: 100 });

  // Act: tenant B tries to adjust tenant A's product
  const result = await adjustInventory({
    productId: product.id,
    quantity: 5,
    reason: 'RECOUNT',
    tenantId: tenantB,    // WRONG tenant
    staffId: testStaff.id
  });

  // Assert: must not find the product — 404, not 200
  expect(result.success).toBe(false);
  expect(result.error).toBe('Product not found');
});
```

**RED confirmation**: Test FAILS against current code.

```
FAIL apps/api/src/__tests__/inventory.test.js
  ✕ PC-6: adjustInventory rejects product belonging to different tenant

  Expected: false
  Received: true

  The function found and adjusted tenant A's product using tenant B's context.
```

The test correctly proves the bug: `adjustInventory()` returns `success: true` and modifies tenant A's product when called with tenant B's context.

#### Step 3: GREEN Fix

Minimal fix in `apps/api/src/services/inventory.js`:

```javascript
// BEFORE (line 23):
const result = await pool.query(
  'SELECT id, quantity FROM products WHERE id = $1',
  [productId]
);

// AFTER:
const result = await pool.query(
  'SELECT id, quantity FROM products WHERE id = $1 AND tenant_id = $2',
  [productId, tenantId]
);
```

**GREEN confirmation**: Test PASSES after fix.

```
PASS apps/api/src/__tests__/inventory.test.js
  ✓ PC-6: adjustInventory rejects product belonging to different tenant (45ms)
```

**Full suite**: All 6 PC tests pass. No regressions.

```
Tests:  6 passed, 6 total
Time:   1.823s
```

---

### Iteration 2: Re-forge

Re-running all checks after the fix.

| Check | Verdict |
|-------|---------|
| M1 Import Resolution | PASS |
| M2 Uncommitted Files | PASS |
| M3 Dead Exports | PASS |
| M4 Contract Crosscheck | PASS (6/6 PCs have passing tests) |
| M5 Debug Artifacts | PASS |
| M6 Tenant Isolation | **PASS** — the flagged query now includes `tenant_id` |
| M7 Concurrency Check | PASS |

Contract probing on PC-6: Probed with `productId = null` — correctly returns 404. PASS.

Adversarial lenses: ADVERSARY-1 re-checked — cross-tenant access now blocked. No new bugs.

**Iteration 2 bug count: 0**

---

## Failure Tracker

| Check | Failure Count | Status |
|-------|--------------|--------|
| M1 | 0/3 | OK |
| M2 | 0/3 | OK |
| M3 | 0/3 | OK |
| M4 | 0/3 | OK |
| M5 | 0/3 | OK |
| M6 | 1/3 | OK — fixed in iteration 1, passed in iteration 2 |
| M7 | 0/3 | OK |

No circuit breakers fired.

---

## Recycle Log

| Iteration | Bugs Found | New PCs | RED | GREEN | Suite |
|-----------|-----------|---------|-----|-------|-------|
| 1 | 1 (M6/ADVERSARY-1: tenant isolation) | PC-6 | FAIL confirmed | PASS confirmed | 6/6 pass |
| 2 | 0 | — | — | — | 6/6 pass |

**Monotonic progress**: 1 → 0. Decreasing. No regression.

---

## Non-Blocking Improvements (logged, not recycled)

1. **3AM-1**: Add `productId` and `tenantId` to the catch block log in `adjustInventory()`.
2. **NEWHIRE-1**: Extract adjustment reason codes to a shared constant.

---

## Final Verdict

### FORGED

- 2 iterations total
- 1 bug found (tenant isolation in SELECT query) — recycled as PC-6
- PC-6: RED test confirmed the bug, GREEN fix resolved it, re-forge clean
- 0 circuit breakers fired
- 0 regressions introduced
- 2 non-blocking improvements logged
