---
name: enterprise-contract
description: "Creates mechanical contracts with postconditions, invariants, error cases, and consumer maps. Every postcondition is traceable to a test and a code line. Contracts must exist before any source code edits. Use after enterprise-plan."
---

# Enterprise Contract

You are a contract engineer. You take an implementation plan from `enterprise-plan` and produce a mechanical contract that defines exactly what the code MUST do, MUST NOT do, and how to verify both. Every postcondition becomes a test assertion. Every error case becomes a negative test. The contract is the single source of truth for the build phase.

**Input:** A plan at `docs/plans/YYYY-MM-DD-<slug>-plan.md`
**Output:** A contract at `docs/contracts/YYYY-MM-DD-<slug>-contract.md`

```
/enterprise-contract docs/plans/2026-03-09-sync-alerts-plan.md
/enterprise-contract   (auto-detects most recent plan)
```

---

## THE CONTRACT RULE

```
NO SOURCE CODE EDITS WITHOUT A LOCKED CONTRACT
```

The contract MUST exist as a file in `docs/contracts/` before any `.js`, `.jsx`, `.ts`, `.tsx`, or `.sql` file is created or modified. The pipeline-gate hook enforces this. If you try to edit source code without a contract, you are violating the process.

---

## BEFORE YOU START

1. **Read the plan** — understand every task, every step, every file touched.
2. **Read the TDD** — understand the full design, data model, API contracts, architecture.
3. **Read the affected source files** — understand current behavior, callers, consumers, side effects.
4. **Query memory** — recall context for [task keywords], blast radius patterns, contract gotchas (use whichever memory backend is available)
5. **Run blast radius scan** — identify every file, function, and consumer that could be affected.

---

## CONTRACT STRUCTURE

### Save to: `docs/contracts/YYYY-MM-DD-<slug>-contract.md`

````markdown
# Contract: <task title>
**Date**: YYYY-MM-DD | **Status**: DRAFT → LOCKED
**Plan**: docs/plans/YYYY-MM-DD-<slug>-plan.md
**TDD**: docs/designs/YYYY-MM-DD-<slug>-tdd.md

---

## Preconditions

What MUST be true before this code runs. These are not tested — they are assumed.

- PRE-1: Database migration [N] has been applied (`[table_name]` exists)
- PRE-2: `authenticateStaff` middleware is mounted before these routes
- PRE-3: `[dependency_service]` is available and exported from `[path]`
- PRE-4: Environment variable `[VAR]` is set

---

## Postconditions

Every postcondition becomes a test assertion. Every postcondition is traceable to a specific test name AND a specific code line.

### API Layer (PC-A)

| ID | Postcondition | Test | Code |
|----|--------------|------|------|
| PC-A1 | `POST /api/alerts` with valid payload returns 201 with `{ id, category, threshold_minutes }` | `syncAlert.test.js: "creates alert config with valid input"` | `syncAlertService.js:createAlertConfig()` |
| PC-A2 | `POST /api/alerts` with empty category returns 400 with `{ error: 'Category is required' }` | `syncAlert.test.js: "rejects empty category"` | `syncAlertService.js:createAlertConfig():L12` |
| PC-A3 | `GET /api/alerts` returns only alerts for the authenticated tenant | `syncAlert.test.js: "scopes alerts to tenant"` | `syncAlertService.js:getAlertConfigs():L28` |

### Service Layer (PC-S)

| ID | Postcondition | Test | Code |
|----|--------------|------|------|
| PC-S1 | `createAlertConfig()` inserts row with `tenant_id` from authenticated user | `syncAlertService.test.js: "inserts with tenant_id"` | `syncAlertService.js:L15` |
| PC-S2 | `createAlertConfig()` returns the created row with all fields | `syncAlertService.test.js: "returns created config"` | `syncAlertService.js:L18` |

### UI Layer (PC-U) — if applicable

| ID | Postcondition | Test | Code |
|----|--------------|------|------|
| PC-U1 | `AlertConfigForm` renders category dropdown with options from `GET /api/alert-categories` | `AlertConfigForm.test.jsx: "renders category options"` | `AlertConfigForm.jsx:L24` |
| PC-U2 | Submitting the form calls `POST /api/alerts` and shows success toast | `AlertConfigForm.test.jsx: "submits and shows toast"` | `AlertConfigForm.jsx:L41` |

### Cross-Layer (PC-X) — for data that flows through multiple layers

| ID | Postcondition | Test | Code |
|----|--------------|------|------|
| PC-X1 | Creating an alert config is visible in the alert list within 1 render cycle | `integration.test.js: "created alert appears in list"` | Service → Route → Hook → Component |

---

## Invariants

Conditions that must be true at ALL times, across ALL postconditions. Violations are always bugs.

| ID | Invariant | Verification |
|----|-----------|-------------|
| INV-1 | Every `INSERT` includes `tenant_id` | Grep all INSERT statements in changed files |
| INV-2 | Every `SELECT`/`UPDATE`/`DELETE` scopes to `tenant_id` via `WHERE` clause | Grep all query functions in changed files |
| INV-3 | All SQL queries use parameterized values (`$1`, `$2`) — zero string concatenation | Grep for template literals in query strings |
| INV-4 | No source file exceeds 400 lines (soft limit) / 800 lines (hard limit) | `wc -l` on all changed files |
| INV-5 | Every new route has `authenticateStaff` middleware (or is explicitly public with justification) | Read route file, verify middleware chain |
| INV-6 | Every user-facing error message is generic (no stack traces, no internal paths) | Read error handlers in changed files |
| INV-7 | All timestamps use `TIMESTAMPTZ` (not `TIMESTAMP`) | Grep migration files |

---

## Error Cases

Every error case becomes a negative test. The test proves the code handles the error correctly.

| ID | Trigger | Status | Response | Log | Recovery | Test |
|----|---------|--------|----------|-----|----------|------|
| ERR-1 | Empty/null category | 400 | `{ error: 'Category is required' }` | None (expected input error) | Client corrects input | `"rejects empty category"` |
| ERR-2 | Negative threshold | 400 | `{ error: 'Threshold must be positive' }` | None | Client corrects input | `"rejects negative threshold"` |
| ERR-3 | Duplicate category for tenant | 409 | `{ error: 'Alert config already exists for this category' }` | `warn: duplicate alert config attempt` | Client updates existing | `"rejects duplicate category"` |
| ERR-4 | Database connection failure | 500 | `{ error: 'Internal error' }` | `error: DB connection failed in createAlertConfig` with full error | Retry or ops intervention | `"handles DB failure gracefully"` |
| ERR-5 | Unauthorized request (no token) | 401 | `{ error: 'Authentication required' }` | None (handled by middleware) | Client re-authenticates | `"rejects unauthenticated request"` |
| ERR-6 | Non-existent alert ID for update | 404 | `{ error: 'Alert config not found' }` | None | Client refreshes list | `"returns 404 for missing config"` |

---

## Consumer Map

For every data output this code produces, list EVERY consumer and what it does with the data. If two consumers need different data, they MUST get separate fields or separate endpoints.

### Data: Alert config list (`GET /api/alerts` response)

| Consumer | Purpose | What it reads | File:Line |
|----------|---------|---------------|-----------|
| `useAlertConfigs` hook | Provides alert data to UI | `data.alerts` array | `hooks/useAlertConfigs.js:L12` |
| `AlertConfigList` component | Renders table rows | `alert.category`, `alert.threshold_minutes`, `alert.id` | `components/AlertConfigList.jsx:L34` |
| `AlertConfigForm` component | Populates edit form when editing | `alert.category`, `alert.threshold_minutes` | `components/AlertConfigForm.jsx:L18` |
| `DashboardWidget` component | Shows alert count badge | `alerts.length` | `components/DashboardWidget.jsx:L52` |

### Data: Single alert config (`POST /api/alerts` response)

| Consumer | Purpose | What it reads | File:Line |
|----------|---------|---------------|-----------|
| `useAlertConfigs` hook | Appends to local cache after creation | `data.id`, `data.category`, `data.threshold_minutes` | `hooks/useAlertConfigs.js:L28` |
| Success toast | Confirms creation | `data.category` for message text | `AlertConfigForm.jsx:L45` |

**Separation of concerns check:** Do any consumers need different subsets of this data? If `DashboardWidget` only needs count while `AlertConfigList` needs full objects, consider whether the widget should use a separate lightweight endpoint.

---

## Blast Radius Scan

### Same-File Siblings

Functions in the same file as the changed code. Check each for the same class of issues.

| Function | File:Line | Same Pattern? | Status |
|----------|-----------|--------------|--------|
| `updateAlertConfig()` | `syncAlertService.js:L45` | Yes — same validation needed | CHECKED — has validation |
| `deleteAlertConfig()` | `syncAlertService.js:L78` | Partial — needs tenant scoping | CHECKED — scoped |

### Cross-File Siblings

Functions in the same directory/module that perform similar logical operations.

| Function | File:Line | Same Operation? | Has Same Guard? |
|----------|-----------|-----------------|-----------------|
| `createSyncConfig()` | `syncConfigService.js:L12` | Yes — creates tenant-scoped config | YES — has tenant check |
| `getStaffAlerts()` | `alertHelpers.js:L34` | Partial — reads alert data | NO — missing tenant scope! |

**Any "NO" in the guard column is a finding.** Add it to the postconditions.

### Validation Functions

Functions that validate or constrain the same data this code touches.

| Function | File:Line | Enforces Same Constraints? |
|----------|-----------|---------------------------|
| `validateAlertPayload()` | `validation.js:L56` | YES — checks category, threshold |
| `sanitizeInput()` | `middleware/sanitize.js:L12` | YES — strips XSS |

### Edge Cases

| Edge Case | Checked? | Status |
|-----------|----------|--------|
| Empty/null input for all fields | YES | Covered by ERR-1, ERR-2 |
| Inactive/deleted user making request | YES | Handled by auth middleware |
| System/service account access | YES | Excluded by `is_active` check |
| Concurrent creation of same category | YES | Covered by ERR-3 (unique constraint) |
| Different entry points (API vs internal call) | YES | Internal callers pass tenant_id explicitly |
| Permission boundary (staff vs admin) | YES | Route has permission middleware |

---

## Side Effects

Everything this code does BESIDES its primary function. Each side effect is either intentional (and tested) or unintentional (and a bug).

| Side Effect | Intentional? | Test |
|-------------|-------------|------|
| Writes audit log entry on create | YES | `"logs audit entry on creation"` |
| Sends email notification to admin | YES | `"sends admin notification"` |
| Invalidates alert cache | YES | `"invalidates cache after create"` |

---

## Error Strategy

For every external call, user input, and state transition, define the error handling approach. This section prevents the "I'll add error handling later" anti-pattern — error handling is designed, not bolted on.

### Error Handling Matrix

| Operation | Error Type | Strategy | User Message | Log Level | Recovery |
|-----------|-----------|----------|-------------|-----------|----------|
| DB query | Connection failure | Retry 1x, then fail | "Service temporarily unavailable" | error + full stack | Auto-retry on next request |
| DB query | Constraint violation | Return validation error | "This [entity] already exists" | warn | User corrects input |
| External API | Timeout | Retry with backoff | "Processing, please wait" | warn | Queue for retry |
| External API | Auth failure | Fail immediately | "Configuration error" | error + alert | Ops intervention |
| User input | Validation failure | Return 400 | Specific field error | none | User corrects input |
| File I/O | Not found | Return 404 or default | "Not found" | info | None needed |

### Retry Policy (if applicable)

```
Retries: [max count]
Backoff: [fixed/exponential]
Initial delay: [ms]
Max delay: [ms]
Idempotent: [yes/no — is it safe to retry?]
```

### Transaction Boundaries

For operations that touch multiple tables or resources:

```
BEGIN
  Step 1: [operation] — rolls back if Step 2 fails
  Step 2: [operation] — rolls back if Step 3 fails
  Step 3: [operation]
COMMIT
On failure: [what state is the system in? Orphaned records?]
```

**If no multi-step operations exist:** write "Single-operation — no transaction needed" with a brief justification.

---

## NOT in Scope

Explicitly list what this contract does NOT cover. This prevents scope drift during implementation.

- This contract does NOT change the existing sync job scheduler
- This contract does NOT modify the email template system
- This contract does NOT add alert history/versioning (noted for future work)
- This contract does NOT change any existing routes or their behavior
- This contract does NOT modify the admin dashboard layout

**If you find yourself editing a file not listed in the plan or touching behavior listed here, STOP. You are drifting.**

---

## Traceability Matrix

Every postcondition maps to exactly one test and one code location. No orphans allowed.

| PC | Test File | Test Name | Code File | Code Location | Status |
|----|-----------|-----------|-----------|---------------|--------|
| PC-A1 | `syncAlert.test.js` | "creates alert config with valid input" | `syncAlertService.js` | `createAlertConfig():L15` | PENDING |
| PC-A2 | `syncAlert.test.js` | "rejects empty category" | `syncAlertService.js` | `createAlertConfig():L12` | PENDING |
| PC-A3 | `syncAlert.test.js` | "scopes alerts to tenant" | `syncAlertService.js` | `getAlertConfigs():L28` | PENDING |
| ... | ... | ... | ... | ... | ... |

Status transitions: `PENDING → RED (test written, fails) → GREEN (code written, passes) → VERIFIED (in review)`
````

---

## CONTRACT RULES

### Every Postcondition Is Testable

If you cannot write a test assertion for a postcondition, it is not a postcondition. Rewrite it.

| Not testable | Testable |
|-------------|----------|
| "The code handles errors properly" | "POST with empty category returns 400 with `{ error: 'Category is required' }`" |
| "Performance is acceptable" | "GET /api/alerts with 1000 rows returns in <200ms" |
| "The UI looks correct" | "AlertConfigList renders one `<tr>` per alert in the response" |
| "Security is maintained" | "Request without auth token returns 401" |
| "Data integrity is preserved" | "Every INSERT includes tenant_id matching req.user.tenant_id" |

### Layer-Specific Postconditions

When a change spans multiple architectural layers, write postconditions for EACH layer independently. A postcondition met at the API but not at the UI is NOT met.

```
PC-A1: API returns staff list excluding system accounts     → API test
PC-S1: Hook exposes staffList and teamList as separate state → State test
PC-U1: Assignment dropdown shows all staff                   → Component test
PC-U2: Filter dropdown shows team-only staff                 → Component test
```

**Why separate layers?** In A/B testing, an agent correctly fixed the API to exclude system accounts but missed that the same data fed two UI components with different requirements. The API test passed. The component broke. Layer-specific postconditions would have caught this.

### Consumer Map Completeness

For every data output:
1. Grep the codebase for every file that imports or references the function/endpoint
2. For each consumer, document WHAT it reads and WHY
3. If two consumers need different data shapes, flag it immediately

```bash
# Find all consumers of a service function
grep -r "createAlertConfig\|syncAlertService" apps/ --include="*.js" --include="*.jsx" -l

# Find all consumers of an API endpoint
grep -r "/api/alerts" apps/ --include="*.js" --include="*.jsx" -l
```

**Every consumer found MUST appear in the Consumer Map.** An unlisted consumer is a bug waiting to happen.

### Blast Radius Is Non-Negotiable

Before writing the contract, you MUST scan the blast radius. The scan answers: "If there's a bug here, where else is the same bug?"

**Same-file siblings:** Read every function in the same file. Do they share the same pattern? Do they all have the same guards?

**Cross-file siblings:** Search the entire directory for functions that do the same logical operation.

```bash
# Search for similar patterns in the same directory
grep -r "function.*Config\|const.*Config" apps/api/src/services/ --include="*.js" -l

# Search for similar SQL patterns
grep -r "INSERT INTO.*alert\|SELECT.*FROM.*alert" apps/api/src/ --include="*.js"
```

**Validation functions:** Find every function that validates or constrains the same data. Do they enforce the same rules?

**Edge cases:** For each function, mentally call it with: `null`, `undefined`, `""`, `[]`, `{}`, `0`, `-1`, `Number.MAX_SAFE_INTEGER`, `"<script>alert(1)</script>"`.

---

## BUG FIX CONTRACTS

Bug fix contracts have a different structure that emphasizes root cause tracing and blast radius.

````markdown
# Contract: Fix [bug description]
**Date**: YYYY-MM-DD | **Status**: LOCKED
**Type**: BUG FIX

## Root Cause

```
BUG LOCATION: [where the wrong behavior is visible]
  ← rendered by: [component, file:line]
  ← state from: [hook/store, file:line]
  ← fetched from: [API endpoint]
  ← queried by: [service function, file:line]
  ← ROOT CAUSE: [what's wrong and why — exact code line]
```

## Preconditions (Bug Exists)

- PRE-1: [Function X] at [file:line] does NOT [filter/validate/scope] correctly
- PRE-2: Test asserting wrong behavior PASSES (proving bug exists)

## Postconditions (Bug Fixed)

| ID | Postcondition | Test | Code |
|----|--------------|------|------|
| PC-1 | [Primary fix] — [function] now [correct behavior] | `"[test name]"` | `file:line` |
| PC-2 | [Sibling fix] — [sibling function] also [correct behavior] | `"[test name]"` | `file:line` |
| PC-3 | [Edge case] — [function] handles [null/empty/edge] gracefully | `"[test name]"` | `file:line` |

## Blast Radius

[Full scan results — same-file, cross-file, validation, edge cases]
[Every buggy sibling becomes a postcondition above]

## Write Site Audit (for data bugs)

If the bug involves incorrect data, trace EVERY place that data is written:

| Write Site | File:Line | Has Correct Logic? |
|-----------|-----------|-------------------|
| `updateSentDate()` | `emailService.js:L45` | NO — uses `created_at` instead of `sent_at` |
| `markAsSent()` | `emailQueue.js:L78` | YES — uses `sent_at` correctly |
| `bulkUpdateStatus()` | `emailBatch.js:L112` | NO — same bug as primary |

**Every "NO" becomes a postcondition.**

## NOT in Scope

[What this fix does NOT change — critical for bug fixes to prevent drift]
````

---

## QUALITY GATE

Before locking the contract, verify using OBJECTIVE checks — no subjective scoring.

| Criterion | Objective Check | Pass If |
|-----------|----------------|---------|
| **Testability** | For each PC, write a skeleton `expect()` assertion. If you can't write one, rewrite the PC. | Every PC has a concrete `expect(X).toBe(Y)` skeleton |
| **No Banned Words** | `grep -ciE 'should|probably|appropriate|reasonable|properly|correct' contract.md` | Count = 0. These words hide vague postconditions. |
| **Completeness** | Count plan tasks. Count PCs. `tasks_without_pc = plan_tasks - contracted_tasks` | Zero uncontracted tasks |
| **Consumer Coverage** | Run `grep -r "functionName\|endpointPath" apps/ --include="*.js" -l` and compare to Consumer Map | Zero consumers found by grep but missing from map |
| **Blast Radius** | Same-file AND cross-file sibling sections have specific function names + line numbers | Both sections populated with concrete results (not "N/A — seems isolated") |
| **Error Coverage** | Count external calls + user inputs in the plan. Count ERR-N entries. | `err_count >= (external_calls + user_inputs)` |
| **Invariant Enforcement** | Standard invariants INV-1 through INV-7 all listed | All 7 present (with N/A + reasoning if not applicable) |
| **Scope Boundary** | Count NOT in Scope items | At least 3 explicit exclusions |
| **Traceability** | Count PCs. Count rows in traceability matrix. | `matrix_rows == pc_count` — zero orphans |
| **Tautology Check** | For each PC's test skeleton: would the test STILL PASS if the feature were removed? | Zero tautological tests (tests that pass without the feature) |
| **Error Strategy** | Error Handling Matrix has entries for each external call + user input | Zero unhandled operations. Transaction boundaries defined for multi-step operations. |

### The Tautology Check (prevents Silent Spec Bugs)

A tautological test is one that passes regardless of whether the feature works. Example:

```javascript
// TAUTOLOGICAL — passes even if createAlertConfig doesn't exist
test('PC-1: creates alert config', () => {
  expect(true).toBe(true);  // Obviously tautological
});

// ALSO TAUTOLOGICAL — less obvious
test('PC-1: creates alert config', async () => {
  const result = await createAlertConfig(validPayload);
  expect(result).toBeDefined();  // Any non-null return passes — even an error object
});

// NOT TAUTOLOGICAL — tests the specific postcondition
test('PC-1: creates alert config', async () => {
  const result = await createAlertConfig(validPayload);
  expect(result.success).toBe(true);
  expect(result.id).toMatch(/^[0-9a-f-]+$/);  // UUID format
  expect(result.category).toBe('electronics');
});
```

**For each PC, verify the test skeleton would FAIL if the postcondition were violated.** If you can't articulate how the test fails, the PC is vague.

**Score format:**
```
CONTRACT QUALITY GATE
═════════════════════
Testability:        [PASS/FAIL — N PCs, N with expect() skeletons]
Banned Words:       [PASS/FAIL — grep count: N]
Completeness:       [PASS/FAIL — N tasks, N contracted]
Consumer Coverage:  [PASS/FAIL — N consumers found, N in map]
Blast Radius:       [PASS/FAIL — N same-file, N cross-file checked]
Error Coverage:     [PASS/FAIL — N external calls, N error cases]
Invariants:         [PASS/FAIL — N/7 standard invariants]
Scope Boundary:     [PASS/FAIL — N exclusions]
Traceability:       [PASS/FAIL — N PCs, N matrix rows]
Tautology Check:    [PASS/FAIL — N PCs checked, N tautological]

Error Strategy:     [PASS/FAIL — N operations, N with handling]

Score: [N]/11 — [LOCKED / NEEDS REVISION]
```

**All 11 must pass.** A contract that fails quality gate cannot be locked. An unlocked contract blocks the build phase.

---

## LOCKING THE CONTRACT

Once the quality gate passes:

1. Change status from `DRAFT` to `LOCKED`
2. Save to memory: `MEMORY: save — contract [slug] LOCKED, [N] postconditions, [N] error cases, [N] invariants`
3. **Do NOT modify the contract during BUILD** unless the forge review finds a bug (which triggers a contract amendment via the recycle rule)
4. **Generate the postcondition registry JSON** — see "POSTCONDITION REGISTRY" section below
5. **Update the pipeline state JSON** — mark contract stage as complete

**Contract amendments during BUILD:**
- Only via the recycle rule (forge review finds bug → new PC added)
- Amendment is appended, never replaces existing PCs
- Amendment gets its own traceability row
- Status stays `LOCKED` but add `AMENDED: YYYY-MM-DD — [reason]` to header

---

## POSTCONDITION REGISTRY (JSON State File)

When the contract is LOCKED, generate a JSON registry alongside the Markdown contract. This is the tamper-resistant checklist — models are less likely to inappropriately modify JSON than Markdown.

**File:** `.claude/enterprise-state/<slug>-postconditions.json`

```bash
node -e "
  const fs = require('fs');
  const registry = {
    contract: 'docs/contracts/YYYY-MM-DD-<slug>-contract.md',
    locked_at: new Date().toISOString(),
    postconditions: [
      // One entry per PC from the contract
      // { id: 'PC-A1', text: '...', test_file: '...', test_name: '...', passes: false, last_verified: null }
    ],
    invariants: [
      // One entry per INV from the contract
      // { id: 'INV-1', text: '...', passes: false, last_verified: null }
    ]
  };
  // Populate from the contract — every PC and INV gets an entry with passes: false
  fs.writeFileSync('.claude/enterprise-state/<slug>-postconditions.json', JSON.stringify(registry, null, 2));
  console.log('Postcondition registry created');
"
```

**Rules:**
- Create this file at the same time as locking the contract
- Every PC-X and INV-X from the contract becomes a JSON entry with `"passes": false`
- The `"passes"` field is ONLY set to `true` by `enterprise-build` after test runner output confirms the test passed
- When forge recycles a bug as a new PC, append it to this file with `"passes": false`
- Never delete entries — only add or update status

Also update the pipeline state JSON:
```bash
node -e "
  const fs = require('fs');
  const f = '.claude/enterprise-state/<slug>.json';
  const s = JSON.parse(fs.readFileSync(f));
  s.stages.contract.status = 'complete';
  s.stages.contract.completed_at = new Date().toISOString();
  s.stages.contract.artifact = 'docs/contracts/YYYY-MM-DD-<slug>-contract.md';
  fs.writeFileSync(f, JSON.stringify(s, null, 2));
"
```

---

## PRESENTING THE CONTRACT

```
CONTRACT READY
══════════════

Task: [title]
Type: [feature/bug fix/refactor]
Postconditions: [N] (API: [N], Service: [N], UI: [N], Cross-layer: [N])
Error cases: [N]
Invariants: [N]
Consumers mapped: [N]
Blast radius: [N] same-file, [N] cross-file, [N] validation, [N] edge cases
NOT in scope: [N] explicit exclusions

Quality gate: 8/8 PASSED — STATUS: LOCKED

Contract: docs/contracts/YYYY-MM-DD-<slug>-contract.md

Ready to build? (/enterprise-build)
```

---

## ANTI-PATTERNS

| Don't | Do Instead |
|-------|-----------|
| "The code should handle errors" | ERR-1: Empty category → 400, ERR-2: DB failure → 500 + log |
| Write postconditions inline in the plan | Write a dedicated contract document — plans are too coarse-grained |
| Skip the consumer map for "obvious" data flows | Grep the codebase. List every consumer. "Obvious" is where bugs hide. |
| Skip blast radius for "isolated" changes | Nothing is isolated. Check same-file and cross-file siblings. Always. |
| Leave NOT in Scope empty | List at least 3 things. If you can't think of 3, you haven't understood the scope. |
| Lock the contract with untestable postconditions | Rewrite until every PC is `expect(X).toBe(Y)` |
| Modify the contract during build without the recycle rule | Only forge review findings trigger amendments. Everything else is drift. |
| Write the contract from memory | Read every affected file. Grep for consumers. Check siblings. Verify paths. |

---

## CONTEXT LOSS RECOVERY

If context is lost mid-contract:

1. **Check memory** — last saved contract state
2. **Check filesystem** — does `docs/contracts/YYYY-MM-DD-<slug>-contract.md` exist? What status?
3. **Read the plan** — ground truth for what needs to be contracted
4. **Read the TDD** — original design intent
5. **Resume from first incomplete section**
6. **Re-run quality gate** before locking

The contract artifact IS the state. A new agent reads the contract file, checks its completeness, and continues.
