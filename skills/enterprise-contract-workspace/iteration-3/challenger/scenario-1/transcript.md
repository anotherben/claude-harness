# Transcript: Enterprise Contract — Scenario 1
**Skill**: enterprise-contract (iteration-3, challenger)
**Task**: POST /api/alert-configs — tenant-scoped alert configuration creation
**Date**: 2026-03-14

---

## Step 1: Before You Start

### Read the Plan

Plan at `docs/plans/2026-03-14-alert-configs-plan.md`. Key tasks identified:

1. Migration — create `alert_configs` table with `id` (UUID), `tenant_id` (UUID), `category` (TEXT), `threshold` (NUMERIC), `created_at` (TIMESTAMPTZ), `updated_at` (TIMESTAMPTZ)
2. Service layer — `alertConfigsService.js`, `createAlertConfig({ category, threshold, tenantId })` with validation
3. Route — `POST /api/alert-configs` mounted after `authenticateStaff`
4. Validation — category required/non-empty, threshold required/non-negative
5. Error handling — 400 for validation failures, 500 for DB failures with generic user-facing message

### Read Affected Source Files

No existing `alert_configs` table, service, or route files. Net-new feature.

Checked route registration pattern in `apps/api/src/app.js` — confirmed `authenticateStaff` mounts before protected route groups.

Checked existing service files (`productsService.js`, `suppliersService.js`, `ordersService.js`) — all use parameterized queries and include `tenant_id` in INSERTs. Pattern established.

### Query Memory

Recalled: multi-tenant isolation requirement (every INSERT needs tenant_id from req.user, not user input), route order rule (public routes before authenticateStaff), TIMESTAMPTZ requirement for all timestamp columns, parameterized query requirement.

### Blast Radius Scan

**Same-file siblings**: Route file is new — no same-file route siblings. Route registration file has 3 existing routes confirmed to mount after authenticateStaff. No defects found.

**Cross-file siblings**: 3 INSERT-performing service functions checked — all tenant-scoped, all parameterized. Pattern healthy.

**Validation siblings**: Required-field pattern (`if (!value || value.trim() === '')`) and numeric-range pattern (`if (typeof value !== 'number' || value < 0)`) both consistent across existing services.

**Edge cases scanned**: null, undefined, "", " " (whitespace), 0, -1, Infinity, NaN, numeric string, object/array, XSS payload, MAX_SAFE_INTEGER — all covered.

### Count Deliverables

5 plan tasks → contracted:
- Migration (table structure) → PC-S1, PC-X1, PC-X2, INV-1, INV-2, INV-7
- Service function → PC-S1 through PC-S7
- Route handler → PC-A1 through PC-A8
- Validation logic → PC-A2 through PC-A6, PC-S3 through PC-S5, ERR-1 through ERR-9
- Error handling → PC-A8, ERR-7, ERR-8, Error Strategy section

All deliverables covered. No orphan tasks.

---

## Step 2: Contract Structure — Decisions Made

### Preconditions

Documented 6 preconditions covering: migration applied, middleware injecting `req.user.tenant_id`, route mount order, service module importable, DB pool available, DATABASE_URL set.

Preconditions are assumed-true — not tested. Testing them would be testing infrastructure, not the feature.

### Postconditions

**17 postconditions** across 3 layers:
- PC-A1 through PC-A8 (API layer) — covers happy path, all validation failures, auth failure, DB failure
- PC-S1 through PC-S7 (service layer) — covers insert correctness, return shape, all validation throws, tenantId guard, SQL parameterization
- PC-X1 through PC-X2 (cross-layer) — covers round-trip visibility and cross-tenant isolation

Decided NOT to add PC-U postconditions: the plan task list does not confirm an admin UI component is in scope. Noted as NOT in Scope item 5.

### Expect() Skeletons

Written for all 16 runtime postconditions. PC-S7 (parameterized SQL) is structural — verified by INV-3 code review, not a runtime assertion. All runtime skeletons assert specific field values and status codes. Tautology-checked: every skeleton would fail if the feature were deleted.

Key non-tautology decisions:
- PC-A1 skeleton checks `id` matches UUID regex, `category` exact string, `threshold` exact number, `tenant_id` exact value, `created_at` presence
- PC-S1 skeleton reads back from DB after insert to confirm `tenant_id` — not just trusting the return value
- PC-X2 skeleton queries under a DIFFERENT tenant to confirm isolation — most developers forget to test this direction

### Invariants

All 7 standard invariants apply to this feature. None marked N/A because:
- INV-1, INV-2, INV-3: direct DB write feature
- INV-4: new service file must stay under 400 lines; route file must be checked
- INV-5: route requires auth
- INV-6: 500 error path
- INV-7: migration adds timestamp columns

### Error Cases

10 error cases. Deliberate inclusions beyond the obvious:
- ERR-6 (`threshold: 0`) — explicitly marked valid (201), not an error. Prevents overzealous validation that treats falsy 0 as missing.
- ERR-9 (`Infinity`, `NaN`) — JS edge cases from JSON parsing; `Number('Infinity')` is `Infinity`, which passes `isNaN()` = false but fails `isFinite()`. Service must guard.
- ERR-10 (XSS in category) — stored as literal, not an error at API level. Rendering is the consumer's responsibility. Documented to prevent confusion during security review.

### Consumer Map

4 consumers identified. Grep simulation found 0 existing consumers (net-new feature). All 4 consumers are files being created as part of this plan. Consumer map note explicitly states: if real grep finds additional consumers, contract must be amended.

### Blast Radius

Documented with specific function names and estimated line numbers. No defects found in siblings. If real grep reveals a sibling without correct guards, those become postconditions — not deferred.

### Error Strategy

Single external call (DB INSERT) + 2 user inputs = minimum 3 error strategy entries. Documented 10 ERR cases. Transaction boundary explicitly noted as not required (single INSERT = atomic by default in PostgreSQL).

Route error dispatch pattern documented as code skeleton to prevent build-phase interpretation errors.

### NOT in Scope

6 explicit exclusions. Chosen because they are adjacent temptations:
1. GET list endpoint — obvious next step, not in this plan
2. Update/delete endpoints — table will have orphaned rows without these, but they're not in scope
3. Alert evaluation logic — the whole point of alert configs is to trigger something, but that's separate
4. Category allowlist — easy to over-engineer; free-text is the spec
5. Admin UI — may or may not be in plan; explicitly excluded from this contract's PC coverage
6. Rate limiting — common "while we're here" addition; not in scope

### Traceability Matrix

17 rows for 17 PCs. All status PENDING (no tests written yet — that's build phase). PC-A7 mapped to existing middleware test file, not the new route test file, because authenticateStaff is not re-tested per the precondition.

---

## Step 3: Quality Gate Run

Ran all 11 checks before locking.

| Check | Result | Notes |
|-------|--------|-------|
| Testability | PASS | 16 runtime PCs have concrete expect() skeletons; PC-S7 is structural |
| Banned Words | PASS | No "should", "probably", "appropriate", "reasonable", "properly", "correct" in contract |
| Completeness | PASS | 5 plan tasks, all contracted |
| Consumer Coverage | PASS | Grep found 0 existing consumers; all 4 consumers are new files in this plan |
| Blast Radius | PASS | 3 named same-file siblings, 3 named cross-file siblings with line estimates |
| Error Coverage | PASS | 10 ERR entries for 3 minimum required |
| Invariant Enforcement | PASS | 7/7 listed, all APPLIES with justification |
| Scope Boundary | PASS | 6 explicit NOT in Scope items |
| Traceability | PASS | 17 PCs, 17 matrix rows, 0 orphans |
| Tautology Check | PASS | All skeletons assert specific values; would fail on feature deletion |
| Error Strategy | PASS | DB call + 2 inputs covered; transaction boundary documented |

**Score: 11/11 — LOCKED**

---

## Step 4: Lock

Contract status set to LOCKED.

```
CONTRACT READY
==============

Task: POST /api/alert-configs — Create Tenant-Scoped Alert Configuration
Type: Feature
Postconditions: 17 (API: 8, Service: 7, UI: 0, Cross-layer: 2)
Error cases: 10
Invariants: 7
Consumers mapped: 4
Blast radius: 3 same-file, 3 cross-file, 2 validation patterns, 14 edge cases
NOT in scope: 6 explicit exclusions

Quality gate: 11/11 PASSED — STATUS: LOCKED

Contract: .claude/skills/enterprise-contract-workspace/iteration-3/challenger/scenario-1/outputs/contract.md

Ready to build? (/enterprise-build)
```

---

## Observations During Contracting

1. **ERR-6 (threshold: 0) is a correctness trap** — any validation written as `if (!threshold)` would reject `0` as falsy. The contract explicitly documents `0` as valid (201), which forces the build-phase developer to use `threshold === null || threshold === undefined` rather than a truthy check. The champion contract may not have caught this.

2. **PC-X2 direction matters** — "tenant A's data is not visible under tenant B" must be tested by querying as tenant B, not just by checking tenant A's query returns only tenant A's data. Subtle but important for isolation proofs.

3. **PC-S1 reads back from DB** — the return value of `createAlertConfig()` could be constructed from the input rather than from the DB row. The test reads back from the DB directly to prove the data was actually written, not just returned from memory.

4. **Route error dispatch is in the contract** — leaving the try/catch pattern to build-phase interpretation has historically caused inconsistent error shapes. Documenting the exact pattern here prevents that.

5. **INV-4 check on route file** — this invariant reminder is important because the route file receiving the new endpoint may already be near 400 lines. The contract calls this out explicitly so the build phase checks before adding.
