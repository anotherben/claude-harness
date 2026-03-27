# Forge Report — alert-configs Feature
**Date**: 2026-03-14
**Feature**: POST /api/alert-configs (tenant-scoped alert configuration)
**Skill**: enterprise-forge (challenger iteration-2)
**Base branch**: dev
**Files changed**: 3
**Contract at entry**: 14 postconditions (PC-A1–A5, PC-S1–S7, PC-X1–X2)
**Contract at exit**: 18 postconditions (PC-A1–A5, PC-S1–S7, PC-X1–X6)
**Verdict**: FORGED

---

## 1. Mechanical Checks

### Iteration 1

| Check | Result | Notes |
|-------|--------|-------|
| M1 Import Resolution | PASS | All requires resolve |
| M2 Uncommitted Files | PASS | No orphaned source files |
| M3 Dead Exports | FLAG | `validateAlertThreshold` exported but not imported externally |
| M4 Contract Crosscheck | PASS | All 14 PCs have passing tests |
| M5 Debug Artifacts | PASS | No console.log or debugger in production files |
| M6 Tenant Isolation | PASS | All new queries scope to tenant_id |
| M7 Concurrency Check | FLAG → BUG | Module-level `let retryCount = 0` — shared across concurrent requests |

**Hard FAILs**: None. Proceeded to contract probing.
**M3 Flag**: Dead export `validateAlertThreshold` — improvement, non-blocking.
**M7 Flag**: Escalated to BUG-1 (shared mutable state is a correctness issue, not just a style flag).

### Iteration 2 (post-fix re-run)

| Check | Result | Notes |
|-------|--------|-------|
| M1 | PASS | — |
| M2 | PASS | — |
| M3 | FLAG (pre-existing) | Same dead export — not regressed |
| M4 | PASS | All 18 PCs pass |
| M5 | PASS | — |
| M6 | PASS | New getAlertConfigs queries scoped |
| M7 | PASS | retryCount removed |

---

## 2. Contract Probing

### Iteration 1 Probes

| Postcondition | Original Test Angle | Probe Angle | Result | Action |
|---------------|-------------------|-------------|--------|--------|
| PC-A1 (201 on valid) | Valid payload | String threshold `"100"` | PASS — JS coercion handled | None |
| PC-A2 (body shape) | Key existence | created_at in response | PASS — RETURNING * includes it | None |
| PC-A3 (400 missing threshold) | Omit field | Explicit null | PASS — `!null` caught | None |
| PC-A4 (400 missing channel) | Omit field | Empty string `""` | PASS — `!""` caught | None |
| PC-A5 (400 unknown channel) | Invalid value | Uppercase `"EMAIL"` | PASS — not in allowed list | Improvement logged |
| PC-S1 (record written) | Insert + read back | INSERT ... RETURNING atomicity | PASS | None |
| PC-S2 (tenant_id from auth) | Mocked tenantId | `req.user.tenantId` undefined | BUG-2 — DB constraint fires, 500 returned | Recycle → PC-X4 |
| PC-S3 (created_at populated) | Not null in response | TIMESTAMPTZ vs TIMESTAMP | PASS — migration uses TIMESTAMPTZ | None |
| PC-S4 (threshold > 0) | threshold=0 | threshold=-1 | PASS | None |
| PC-S5 (threshold <= 10000) | threshold=10001 | threshold=10000 (boundary) | PASS | None |
| PC-S6 (duplicate → 409) | Insert twice sequential | Concurrent inserts (TOCTOU) | BUG-3 — second insert hits unique constraint → 500 | Recycle → PC-X5 |
| PC-S7 (no cross-tenant read) | Tenant isolation on read | Debug/admin bypass | PASS — no bypass endpoint | None |
| PC-X1 (DB error → 500) | Mock pool throws | Connection error vs constraint error | PASS — consistent shape | None |
| PC-X2 (auth → 401) | Omit auth header | Malformed JWT | PASS — middleware rejects | None |

**Bugs from contract probing: BUG-2, BUG-3**

### Iteration 2 Probes (new PCs only)

| Postcondition | Probe | Result |
|---------------|-------|--------|
| PC-X3 (retry scope) | Concurrent requests sharing counter | PASS — counter removed |
| PC-X4 (tenantId guard) | `req.user` present, `tenantId` undefined | PASS — 400 returned before DB |
| PC-X5 (TOCTOU → 409) | Concurrent inserts, 23505 caught | PASS — mapped to 409 |
| PC-X6 (paginated GET) | LIMIT applied, shape correct | PASS |

**Bugs from contract probing (iteration 2): 0**

---

## 3. Adversarial Lenses

### Iteration 1

**Lens 1 — 3AM Test**
- `3AM-1`: `alertConfigService.createAlertConfig` catch block re-throws without logging input context (tenantId, threshold, channel). On-call cannot identify which config triggered DB failure. **Improvement** (non-blocking — contract does not mandate log content).
- `3AM-2`: Duplicate-check SELECT failure propagates uncaught with no context logging. **Improvement**.

**Lens 2 — Delete Test**
- `validateAlertThreshold` exported but used only internally. Dead export — **improvement** (already flagged M3).
- `retryCount` increments on error but is never read as a gate condition. Logic is broken regardless of concurrency issue. Confirmed and escalated as **BUG-1**.

**Lens 3 — New Hire Test**
- `NEWHIRE-1`: `ALLOWED_CHANNELS` array has no comment explaining business rule or spec reference. **Improvement**.
- `NEWHIRE-2`: Positional SQL parameters — readable but could use inline comments. **Improvement**.

**Lens 4 — Adversary Test**
- Body-injected `tenant_id` correctly ignored (auth-derived). PASS.
- Single-INSERT path has no partial-write risk. PASS.
- MAX_SAFE_INTEGER threshold rejected by `<= 10000` check. PASS.
- Long-string channel rejected by `ALLOWED_CHANNELS.includes`. PASS.
- TOCTOU race on duplicate check confirmed as **BUG-3** (already identified in PC-S6 probe).

**Lens 5 — Scale Test**
- `SCALE-1`: `getAlertConfigs` runs `SELECT * FROM alert_configs WHERE tenant_id = $1` with no LIMIT. At 100 tenants × 1000 configs = 100,000 rows returned per call. At 1000x: OOM risk on Node process. **BUG-4 — escalated to recycle**.

### Iteration 2 (focused on changed code)

**3AM**: BUG-3 conflict error not logged with context. Pre-existing improvement pattern — not a new regression.
**Delete**: `validateAlertThreshold` still exported (out of scope for fixes). Pre-existing.
**New Hire**: `err.code === '23505'` without inline comment. **Improvement** (add `// PostgreSQL unique violation`).
**Adversary**: `23505` catch does not catch `23514` (check violation). Acceptable — app-level validation is primary gate. Not a bug.
**Scale**: PC-X6 LIMIT fix applied. No N+1 introduced by new COUNT query. PASS.

**Lens bugs in iteration 2: 0**

---

## 4. Recycle Log

### Iteration 1 → 2

| Bug | Source | New PC | RED Test Status | GREEN Fix | Suite |
|-----|--------|--------|----------------|-----------|-------|
| BUG-1: module-level retryCount | M7 + Lens 2 | PC-X3 | RED — concurrent requests share state | Remove retryCount from module scope | 15 PCs PASS |
| BUG-2: no tenantId guard | PC-S2 probe | PC-X4 | RED — undefined tenantId → 500 | Guard in route: `if (!tenantId) return 400` | 16 PCs PASS |
| BUG-3: TOCTOU duplicate check | PC-S6 probe + Lens 4 | PC-X5 | RED — concurrent inserts produce [201, 500] | Catch `err.code === '23505'`, map to 409 | 17 PCs PASS |
| BUG-4: unbounded SELECT | Lens 5 | PC-X6 | RED — no LIMIT in query | Add LIMIT/OFFSET, return paginated shape | 18 PCs PASS |

**Iteration 1 bugs**: 4
**Iteration 2 bugs**: 0
**Progress**: monotonically decreasing. Exit condition: bug count = 0.

---

## 5. Failure Tracker

| Check | Failure Count | Circuit Breaker Status |
|-------|--------------|----------------------|
| M1 | 0/3 | — |
| M2 | 0/3 | — |
| M3 | 0/3 | — |
| M4 | 0/3 | — |
| M5 | 0/3 | — |
| M6 | 0/3 | — |
| M7 | 1/3 | — |
| PC-S2 probe | 1/3 | — |
| PC-S6 probe | 1/3 | — |
| Lens 5 Scale | 1/3 | — |

No circuit breaker fired.

---

## 6. Improvements Logged (Non-Blocking)

| ID | Location | Finding |
|----|----------|---------|
| IMP-1 | alertConfigService.js catch | Log structured error context (tenantId, channel, threshold) on DB failure |
| IMP-2 | alertConfigService.js SELECT | Log context on duplicate-check query failure |
| IMP-3 | alert-configs.js | `ALLOWED_CHANNELS` needs a comment referencing the alerting spec or ADR |
| IMP-4 | alertConfigService.js | Positional SQL params: consider inline field comments for readability |
| IMP-5 | alertConfigService.js | `validateAlertThreshold` export is dead — make private or remove export |
| IMP-6 | alertConfigService.js | Add `// PostgreSQL unique violation` comment next to `err.code === '23505'` |

---

## 7. Final Verdict

**FORGED**

The forge found 4 bugs across 2 lenses and 2 contract probes. All 4 bugs completed the full recycle loop: new postcondition written, RED test verified against broken code, GREEN fix applied, full suite re-run. Iteration 2 found 0 bugs. Progress was monotonically decreasing. No circuit breaker fired. No cap reached.

**Contract expanded from 14 → 18 postconditions.**

The feature is cleared for production.

| Metric | Value |
|--------|-------|
| Iterations | 2 |
| Bugs found | 4 |
| Bugs fixed | 4 |
| PCs at entry | 14 |
| PCs at exit | 18 |
| Circuit breakers | 0 |
| Verdict | FORGED |
