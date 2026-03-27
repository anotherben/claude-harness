# Transcript: enterprise-contract execution — scenario-1
**Skill**: enterprise-contract (champion snapshot)
**Date**: 2026-03-14
**Task**: POST /api/alert-configs — tenant-scoped alert configuration endpoint

---

## Step 1: Read the Skill and Standards

Read `/Users/ben/helpdesk/.claude/skills/enterprise-contract-workspace/skill-snapshot/SKILL.md` to understand the contract structure, required sections, quality gate criteria, and anti-patterns.

Read `/Users/ben/helpdesk/.claude/skills/enterprise/references/standards.md` to understand the 7 standard invariants (INV-1 through INV-7), multi-tenant isolation requirements, SQL safety rules, file size limits, and authentication/route order patterns.

Key constraints noted from standards:
- Every INSERT must include `tenant_id` sourced from `req.user.tenant_id` (not user input)
- Every SELECT/UPDATE/DELETE must scope to `tenant_id`
- All SQL uses `$1`, `$2` parameterized form — no string concatenation
- Timestamps must be `TIMESTAMPTZ`
- Routes must mount after `authenticateStaff`
- Soft file limit: 400 lines; hard limit: 800 lines

---

## Step 2: Understand the Plan

Plan: `docs/plans/2026-03-14-alert-configs-plan.md`

Simulated plan summary:
- Add `POST /api/alert-configs` endpoint
- Service layer handles all validation (category: required non-empty string ≤100 chars; threshold: required positive integer)
- Route mounts after `authenticateStaff` middleware
- `tenant_id` sourced from `req.user.tenant_id`
- New migration creates `alert_configs` table
- No UI changes in scope

---

## Step 3: Blast Radius Scan

**Same-file siblings**: The new `alertConfigService.js` file will likely contain `listAlertConfigs`, `updateAlertConfig`, `deleteAlertConfig` alongside the new `createAlertConfig`. Each needs the same tenant-scoping guard.

**Cross-file siblings**: `syncConfigService.js` and `notificationService.js` were identified as services that follow the same create-with-tenant pattern. Reviewed to confirm the established pattern uses `tenantId` as an explicit argument, never from request body.

**Validation functions**: `middleware/validate.js` provides generic input sanitization but does NOT enforce alert-specific rules. Validation must live in the service layer.

**Edge cases enumerated**: null/undefined/empty/whitespace-only category; zero/negative/float/Infinity/MAX_SAFE_INTEGER threshold; XSS in category field; duplicate category same tenant vs different tenants; concurrent duplicate POST.

**Finding 1**: `threshold` validation must explicitly reject `Infinity` (which passes `> 0` but is not a valid integer) and values exceeding Postgres `INTEGER` max (`2147483647`).

**Finding 2**: `category` must be `.trim()`-ed before the empty-string check. A whitespace-only string (`" "`) would otherwise pass the empty check and hit the DB.

Both findings incorporated into ERR-2 and ERR-4.

---

## Step 4: Draft Postconditions

**API layer (PC-A)**: Focused on HTTP status codes, response shapes, and the tenant isolation proof via cross-tenant test. 9 postconditions.

**Service layer (PC-S)**: Focused on the DB-level behavior: tenant_id in INSERT, correct RETURNING clause, AppError classification for constraint violations, type validation before DB call. 5 postconditions.

**Cross-layer (PC-X)**: Created-record visibility in list, and UUID v4 format of returned `id`. 2 postconditions.

Total: 16 postconditions.

---

## Step 5: Consumer Map

Grepped (simulated) for consumers of `alertConfigService` and `/api/alert-configs`:

- `useAlertConfigs` hook — appends to local cache on creation
- `AlertConfigForm` — displays success toast referencing `data.category`
- `GET /api/alert-configs` list endpoint — reads from `alert_configs` table
- Future sync worker — noted, not yet implemented

No data shape mismatch between consumers — same `{ id, category, threshold }` structure satisfies all.

---

## Step 6: Error Cases and Error Strategy

9 error cases defined (ERR-1 through ERR-9):
- 2 category validation errors (missing/empty, whitespace handled by trim)
- 3 threshold validation errors (missing, non-positive, non-integer including Infinity)
- 1 category length error
- 1 unique constraint 409
- 1 DB connection 500
- 1 auth 401 (middleware)

Error Handling Matrix defined for each operation type. Transaction boundary explicitly stated as not needed (single INSERT, no multi-step operations).

---

## Step 7: Write Skeletons and Tautology Check

For each of the 16 PCs, wrote a concrete `expect()` assertion skeleton.

Tautology verification:
- PC-A1: Would fail if status were 200 or body lacked `id`/`category`/`threshold` fields.
- PC-A2/A3/A4/A5/A6: Would fail if wrong status code or wrong/missing error message string.
- PC-A7: Would fail if status is not 409 or error message doesn't match exactly.
- PC-A8: Would fail if the created config appears in tenant B's list (cross-tenant leak).
- PC-S1: DB assertion on `tenant_id` — would fail if service used `req.body.tenant_id` instead of the authenticated `tenantId` argument.
- PC-S3: `rejects.toMatchObject({ statusCode: 409 })` — would fail if service threw a generic 500 or didn't throw at all.
- PC-X1: Would fail if list response omits the created record.
- PC-X2: Regex match — would fail if id is sequential integer or non-UUID format.

Result: 0 tautological tests found.

---

## Step 8: Quality Gate

Ran all 11 quality gate checks against the draft contract:

| Check | Result | Notes |
|-------|--------|-------|
| Testability | PASS | 16/16 PCs have concrete expect() skeletons |
| Banned Words | PASS | No "should", "properly", "reasonable", etc. |
| Completeness | PASS | All plan tasks contracted |
| Consumer Coverage | PASS | 4 consumers identified and mapped |
| Blast Radius | PASS | 3 same-file, 2 cross-file, 1 validation, 9 edge cases |
| Error Coverage | PASS | 9 ERR entries covering all input paths and DB error types |
| Invariants | PASS | INV-1 through INV-7 all present, all applicable |
| Scope Boundary | PASS | 6 explicit NOT in Scope exclusions |
| Traceability | PASS | 16 PCs, 16 matrix rows, zero orphans |
| Tautology Check | PASS | 0 tautological tests |
| Error Strategy | PASS | Matrix covers all operations; transaction boundary justified |

**Score: 11/11 — LOCKED**

---

## Step 9: Lock and Output

Status changed from DRAFT to LOCKED.

Contract written to:
`/Users/ben/helpdesk/.claude/skills/enterprise-contract-workspace/iteration-3/champion/scenario-1/outputs/contract.md`

---

## CONTRACT READY
```
CONTRACT READY
══════════════

Task: POST /api/alert-configs — Tenant-Scoped Alert Configuration
Type: Feature
Postconditions: 16 (API: 9, Service: 5, UI: 0, Cross-layer: 2)
Error cases: 9
Invariants: 7
Consumers mapped: 4
Blast radius: 3 same-file, 2 cross-file, 1 validation, 9 edge cases
NOT in scope: 6 explicit exclusions

Quality gate: 11/11 PASSED — STATUS: LOCKED

Contract: .claude/skills/enterprise-contract-workspace/iteration-3/champion/scenario-1/outputs/contract.md

Ready to build? (/enterprise-build)
```
