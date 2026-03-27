# Forge Report: alert-configs

**Date**: 2026-03-14
**Feature**: POST /api/alert-configs — tenant-scoped alert configurations
**Contract**: docs/contracts/2026-03-14-alert-configs-contract.md
**Postconditions**: PC-A1–PC-A5, PC-S1–PC-S7, PC-X1–PC-X2 (14 total)
**Changed files**:
- `apps/api/src/services/alertConfigService.js`
- `apps/api/src/routes/alertConfigRoutes.js`
- `apps/api/src/__tests__/alertConfig.test.js`
**Base branch**: dev
**Review status**: PASSED
**Forge status**: REJECTED (2 bugs found, recycle required)

---

## Prerequisites Check

- [x] enterprise-review PASSED
- [x] Contract exists at docs/contracts/2026-03-14-alert-configs-contract.md
- [x] Plan exists at docs/plans/
- [x] Changed files identified via git diff

---

## Part 1: Mechanical Checks

| Check | Description | Result | Detail |
|-------|-------------|--------|--------|
| M1 | Import Resolution | PASS | All require() paths resolve: `../db`, `../middleware/auth`, `../services/alertConfigService` — all confirmed present |
| M2 | Uncommitted Files | PASS | No untracked `.js` or `.sql` files outside the 3 changed files |
| M3 | Dead Exports | FLAG | `alertConfigService.js` exports `deleteAlertConfig` — no importer found in `apps/api/src/`. Not in routes. Not in any test. |
| M4 | Contract Crosscheck | FAIL | PC-S6 (`alert_configs.updated_at` advances on update) has no corresponding test. The test file contains tests for PC-A1 through PC-A5 and PC-S1–PC-S5, PC-S7, PC-X1–PC-X2, but `PC-S6` is absent. `grep -rn "PC-S6" src/__tests__/` returns 0 results. |
| M5 | Debug Artifacts | PASS | No `console.log`, `console.debug`, or `debugger` in added lines of non-test files |
| M6 | Tenant Isolation | FLAG | `alertConfigService.js` line ~47: `SELECT * FROM alert_configs WHERE id = $1` — the fetch-by-id query used in the update path does not scope to `tenant_id`. Only the INSERT query explicitly includes `tenant_id`. |
| M7 | Concurrency Check | PASS | No module-level `let` or `var` mutable state in changed non-test files |

**Hard FAIL on M4** — PC-S6 has no test.

**M6 FLAG elevated to BUG** — a query that retrieves a record by ID without tenant scoping is a tenant isolation violation (Adversary Test confirms: caller can supply any UUID and retrieve any tenant's alert config). This is not just a flag — it is exploitable.

**M3 FLAG noted** — `deleteAlertConfig` is dead code (improvement, non-blocking this iteration).

**Mechanical verdict**: FAIL (M4 hard-stops; M6 elevated to bug)

---

## Part 2: Contract Probing

Probing all 14 postconditions. Angle selection follows the strategy table in the skill.

### PC-A1: POST /api/alert-configs returns 201 on valid input

- **Original test**: Happy path — valid body, authenticated staff user → 201 + created record
- **Probe angle**: What if `Content-Type` is missing? Express body-parser won't parse; `req.body` is `undefined`. Does the route guard against `undefined` body?
- **Result**: PASS — route validation extracts fields with explicit presence checks before service call; missing body returns 400 validation error

### PC-A2: Response body includes `id`, `tenant_id`, `created_at`

- **Original test**: Checks JSON shape on 201 response
- **Probe angle**: Does `created_at` survive a round-trip? (write → GET → verify same value, not re-generated)
- **Result**: PASS — `created_at` is set by the DB `DEFAULT NOW()` and returned from the INSERT; subsequent reads return the same stored value

### PC-A3: `threshold` field must be a positive integer; non-positive or non-integer returns 400

- **Original test**: Sends `threshold: -1`, expects 400; sends `threshold: 5`, expects 201
- **Probe angle**: Boundary — `threshold: 0` (off-by-one candidate), `threshold: 0.5` (float), `threshold: "5"` (numeric string)
- **Result**: BUG — `threshold: 0` returns **201**, not 400. Validation reads `if (threshold < 0)` instead of `if (threshold <= 0)`. Zero is not a positive integer and should be rejected. `threshold: "5"` is also accepted and coerced silently to integer — no type check, just coercion.

> **New postcondition**: PC-X3 — `threshold` value of `0` must be rejected with 400. `threshold` must be a strict positive integer; numeric strings must be rejected.

### PC-A4: Missing required fields return 400 with field-level error messages

- **Original test**: Omits `name` field; expects 400 with `errors.name` present
- **Probe angle**: What if `channel_type` is omitted — does the error message identify the correct field?
- **Result**: PASS — validation iterates required fields array; each missing field appears in `errors` object by name

### PC-A5: Request without authentication returns 401

- **Original test**: Sends request without Authorization header; expects 401
- **Probe angle**: Sends request with a valid token for a different tenant's staff member — does the route still scope to the requesting user's tenant?
- **Result**: PASS — `authenticateStaff` middleware attaches `req.tenantId` from the token; service uses `req.tenantId`, not a body-supplied tenant_id

### PC-S1: Record is written to `alert_configs` table with correct `tenant_id`

- **Original test**: Mocked DB — verifies INSERT called with `tenant_id` matching auth token
- **Probe angle**: Does the SQL actually return this from a real DB? Mock hides whether the column even exists in the migration.
- **Result**: FLAG (improvement) — test is fully mocked; no integration test hits the real DB. Not a forge bug (review approved this), but logged as an improvement: add one integration-level test that hits the dev DB.

### PC-S2: `name` field max length 255 is enforced

- **Original test**: Sends 256-character name; expects 400
- **Probe angle**: Sends exactly 255 characters — should succeed; sends 256 — should fail
- **Result**: PASS — validation uses `name.length > 255` correctly; 255-char name accepted, 256 rejected

### PC-S3: `channel_type` must be one of `["email", "sms", "webhook"]`

- **Original test**: Sends `channel_type: "slack"` — expects 400
- **Probe angle**: Case sensitivity — `channel_type: "EMAIL"` (uppercase)
- **Result**: BUG — `"EMAIL"` is accepted and stored as `"EMAIL"`, which will cause downstream rendering and filtering logic to miss it (all consumers compare against lowercase literals). Validation does `allowedTypes.includes(channel_type)` without `.toLowerCase()`. Stored value diverges from the enum contract.

> **New postcondition**: PC-X4 — `channel_type` values with incorrect casing (e.g., `"EMAIL"`, `"Sms"`) must be rejected with 400.

### PC-S4: Duplicate `name` per tenant returns 409

- **Original test**: Inserts a record, then attempts to insert with same name → 409
- **Probe angle**: Same name, different tenant — should succeed (not treated as duplicate across tenants)
- **Result**: PASS — uniqueness constraint in service is `WHERE name = $1 AND tenant_id = $2`; cross-tenant insert succeeds with 201

### PC-S5: `is_active` defaults to `true` when not provided

- **Original test**: Omits `is_active` from payload; verifies stored record has `is_active = true`
- **Probe angle**: Explicitly sends `is_active: false` — verify it is honoured, not overridden by default logic
- **Result**: PASS — default only applies when field is `undefined`; explicit `false` is preserved

### PC-S6: `updated_at` advances when alert config is modified (PUT/PATCH path)

- **Original test**: ABSENT — confirmed by M4 mechanical check
- **Probe angle**: N/A — no test exists to probe from a different angle
- **Result**: FAIL (no test) — already surfaced in M4. This is a contract coverage gap. The implementation may be correct but there is no proof.

> This is already an M4 hard-fail. The recycle for PC-X3 and PC-X4 must also add a test for PC-S6.

### PC-S7: Soft delete sets `deleted_at`; record excluded from list queries

- **Original test**: DELETE endpoint (separate) sets `deleted_at`; GET /api/alert-configs omits it
- **Probe angle**: Does `alertConfigService.js` list query filter `WHERE deleted_at IS NULL`?
- **Result**: PASS — list query confirmed to include `WHERE deleted_at IS NULL AND tenant_id = $1`

### PC-X1: Service-layer validation is independent of route layer

- **Original test**: Calls `createAlertConfig()` directly (bypassing Express) with invalid input; expects validation error thrown
- **Probe angle**: Does the service throw a typed/structured error, or a generic `Error`? Is the error catchable with the right `code` property?
- **Result**: PASS — service throws `{ code: 'VALIDATION_ERROR', errors: {...} }`; route catches and maps to 400

### PC-X2: Validation errors do not reach the database (no partial writes)

- **Original test**: Mocked DB — verifies `db.query` not called when validation fails
- **Probe angle**: What about the duplicate-name check? That IS a DB call that happens pre-insert. Does a DB error during duplicate check cause a 500?
- **Result**: PASS — duplicate check is wrapped; DB errors during the existence check are caught and re-thrown as 503, not leaking stack traces

---

## Part 3: Adversarial Lenses

### Lens 1: The 3AM Test

**Simulated error paths reviewed in `alertConfigService.js`:**

- `3AM-1`: The duplicate-name conflict catch block logs `'Duplicate alert config name'` but does not log `tenant_id` or the conflicting `name` value. At 3AM, seeing this error gives you no context about which tenant or name caused it. **Improvement** (non-blocking — the 409 is returned correctly; logging context is missing).
- `3AM-2`: The generic catch at the bottom of `createAlertConfig` logs `err.message` but not `err.stack` or the input payload. At 3AM, a DB constraint violation (e.g., column type mismatch) would appear as a cryptic Postgres error with no indication of which fields triggered it. **Improvement** (non-blocking).

No 3AM findings rise to bug level — all error paths return appropriate HTTP status codes; the gaps are in log richness, not correctness.

### Lens 2: The Delete Test

- `DELETE-1`: `deleteAlertConfig` is exported from `alertConfigService.js` but imported by nothing (confirmed M3 flag). The function exists, is tested in... zero test files. It is dead export. **Improvement** — remove or wire up before the next iteration to prevent confusion.
- `DELETE-2`: `const ALLOWED_CHANNEL_TYPES = ['email', 'sms', 'webhook']` is defined inside `createAlertConfig()` function body. If a second service method ever needs this list, it will be re-defined or duplicated. **Improvement** — hoist to module-level constant.

No delete-test findings rise to bug level.

### Lens 3: The New Hire Test

- `NEWHIRE-1`: `alertConfigRoutes.js` line ~31 has the comment `// TODO: rate limit this`. No ticket reference, no threshold value, no indication of priority. A new hire reading this will either ignore it or waste time researching whether it was done. **Improvement**.
- `NEWHIRE-2`: `alertConfigService.js` calls `sanitizeInput(name)` — `sanitizeInput` is imported from `../lib/sanitize` but there is no JSDoc or inline comment explaining what sanitization is performed. A new hire will not know if HTML stripping, SQL escaping, or Unicode normalization is happening. **Improvement**.

No new-hire findings rise to bug level.

### Lens 4: The Adversary Test

- `ADVERSARY-1`: **BUG** — The M6 flag is confirmed here as exploitable. `getAlertConfigById(id)` in `alertConfigService.js` runs `SELECT * FROM alert_configs WHERE id = $1`. This function is called internally from the update handler. An authenticated staff member of Tenant A can craft a PUT/PATCH with the UUID of Tenant B's alert config. The service will fetch it (no tenant scope on the read), then the update path applies the change — **cross-tenant write**. This is the same vulnerability as the M6 flag, now proven exploitable. **BUG — recycle required.**

> Already captured as a bug from M6 elevation. This is the same root — confirm it surfaces as PC-X5.

- `ADVERSARY-2`: `alertConfigRoutes.js` mounts AFTER `authenticateStaff` — verified correct. No route order inversion.
- `ADVERSARY-3`: No transaction wrapping on `createAlertConfig`. The service runs: (1) SELECT to check duplicate, (2) INSERT. These are two separate queries with no `BEGIN/COMMIT`. Under concurrent requests, two identical names from the same tenant can both pass the duplicate check before either INSERT completes — the DB unique constraint (if present) would catch this, but if the unique constraint is not in the migration, duplicate names can be silently written. This is a TOCTOU race. **Bug or improvement?** — Without seeing the migration, this is a potential bug. Elevated to **bug** per the adversary test protocol (trust nothing).

> **New postcondition**: PC-X5 — `getAlertConfigById` must scope its SELECT to `tenant_id` of the requesting tenant. PC-X6 — concurrent duplicate-name inserts from the same tenant must not produce two records (transaction or DB constraint required).

### Lens 5: The Scale Test

- `SCALE-1`: `GET /api/alert-configs` (list endpoint) runs `SELECT * FROM alert_configs WHERE tenant_id = $1 AND deleted_at IS NULL` with no `LIMIT` clause. At 10x: acceptable. At 1000x: a tenant with 50,000 alert configs will return all 50,000 rows in one response, blowing memory and response time. **Improvement** — add pagination with `LIMIT`/`OFFSET` or cursor. Non-blocking this iteration (endpoint is not part of this feature's postconditions), but logged.
- `SCALE-2`: No index on `(tenant_id, name)` or `(tenant_id, deleted_at)` visible in the migration. The duplicate-name check and list query both need this. At 10x tenants: table scan. **Improvement** — add composite index in migration.

No scale findings rise to bug level for this iteration (the list endpoint is out of scope for this feature's contract).

---

## Recycle Log

### Iteration 1 (this run)

**Bugs found**: 4

| Bug ID | Source | Description | New PC |
|--------|--------|-------------|--------|
| BUG-1 | M4 hard-fail | PC-S6 has no test — `updated_at` advancement unproven | (PC-S6 must get test — not a new PC, existing gap) |
| BUG-2 | PC-A3 probe | `threshold: 0` accepted; should be 400 | PC-X3 |
| BUG-3 | PC-S3 probe | `channel_type: "EMAIL"` accepted; should be 400 | PC-X4 |
| BUG-4 | M6 + ADVERSARY-1 | `getAlertConfigById` missing tenant_id scope — cross-tenant read/write | PC-X5 |

**TOCTOU race (ADVERSARY-3)** elevated to bug pending migration review:
| BUG-5 | ADVERSARY-3 | No transaction on duplicate-check + INSERT; race window exists | PC-X6 |

**Total bugs this iteration**: 5 (BUG-1 through BUG-5)
**Previous iteration bugs**: N/A (first run)
**Progress**: N/A (first run)

**Recycle action required**: Yes — 5 bugs found. All must get RED tests before GREEN fixes.

### Required RED tests (to be written before any fix):

1. **PC-S6 RED**: `it('advances updated_at when alert config is modified')` — must FAIL against current code (no update path tested)
2. **PC-X3 RED**: `it('rejects threshold of 0 with 400')` and `it('rejects numeric string threshold with 400')` — must FAIL (currently returns 201)
3. **PC-X4 RED**: `it('rejects channel_type "EMAIL" with 400')` — must FAIL (currently returns 201)
4. **PC-X5 RED**: `it('cannot fetch another tenants alert config by id')` — must FAIL (currently no tenant scope on getAlertConfigById)
5. **PC-X6 RED**: `it('prevents duplicate names under concurrent inserts for same tenant')` — must FAIL if no DB unique constraint and no transaction

---

## Failure Tracker

| Check | Failures | Threshold | Status |
|-------|----------|-----------|--------|
| M1 | 0/3 | 3 | OK |
| M2 | 0/3 | 3 | OK |
| M3 | 0/3 | 3 | OK (flag) |
| M4 | 1/3 | 3 | OPEN |
| M5 | 0/3 | 3 | OK |
| M6 | 1/3 | 3 | OPEN (elevated to bug) |
| M7 | 0/3 | 3 | OK |
| PC-A3 | 1/3 | 3 | OPEN |
| PC-S3 | 1/3 | 3 | OPEN |

No circuit breaker fired (no check at 3/3).

---

## Improvements Log (non-blocking)

| ID | Lens | Description |
|----|------|-------------|
| IMP-1 | 3AM | Duplicate-name catch block should log `tenant_id` and conflicting `name` |
| IMP-2 | 3AM | Generic catch in `createAlertConfig` should log input payload (sanitized) and `err.stack` |
| IMP-3 | Delete | `deleteAlertConfig` export is dead — remove or wire up |
| IMP-4 | Delete | `ALLOWED_CHANNEL_TYPES` should be a module-level constant, not defined inside function body |
| IMP-5 | NewHire | `// TODO: rate limit this` comment needs a ticket reference or removal |
| IMP-6 | NewHire | `sanitizeInput()` import should have a comment explaining what sanitization it performs |
| IMP-7 | Scale | List query needs `LIMIT`/`OFFSET` for pagination |
| IMP-8 | Scale | Add composite index on `(tenant_id, name)` and `(tenant_id, deleted_at)` in migration |

---

## Final Verdict

**REJECTED**

5 bugs require recycle. The forge cannot clear until:

1. RED tests written for PC-X3, PC-X4, PC-X5, PC-X6, and the missing PC-S6 test
2. GREEN fixes applied: off-by-one in threshold validation, case normalization or rejection for channel_type, tenant scoping on getAlertConfigById, transaction wrapping on createAlertConfig
3. Full test suite passes
4. Forge re-runs (iteration 2)

The two most critical bugs are **BUG-4** (cross-tenant read/write via missing tenant scope) and **BUG-3** (case bypass on enum validation) — both are exploitable by authenticated users and must be fixed before any staging deployment.

---

*Forge run by enterprise-forge skill. Iteration 1 of max 5. Circuit breaker: not fired.*
