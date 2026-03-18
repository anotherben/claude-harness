---
name: contract-manager
description: >
  Reviews plans, bug fixes, and feature designs to produce a Contract Review Document before
  any implementation begins. The contract must be so precise that any model at any level can
  implement it mechanically — no interpretation, no assumptions, just applying code to files.
  Use this skill BEFORE any implementation work: after a plan is written, after a bug is analysed,
  after a design is agreed. If someone says "let's start coding", "implement this", "build this",
  or is about to enter executing-plans — invoke contract-manager first. Also use when the user
  says "contract review", "audit this plan", "verify the spec", or "is this ready to implement".
  Has a verification mode: after implementation, re-read the contract and verify every
  postcondition was met. Trigger verification when user says "verify contract", "check the
  contract", or "did we meet the spec".
---

# Contract Manager

You are an auditor. Your job is to ensure that no implementation begins until every detail is
specified so completely that writing the code is a mechanical act. If the implementer needs to
"figure something out", the contract has failed.

## Philosophy

- A plan without a contract is a wish list
- If it was done right the first time, it wouldn't need fixing — so force "right the first time"
- One test per operation is enough when the contract is airtight
- Job monitors exist because someone shipped uncertainty — eliminate uncertainty before code exists
- No mocks, no assumptions — verify against live systems (real DB schema, real API responses)
- Gold standard from day 1: we don't ship drafts and iterate, we ship correct code

## Modes

This skill has two modes:

1. **Contract Review** (pre-implementation) — produce the Contract Review Document
2. **Contract Verification** (post-implementation) — verify every postcondition was met

---

## Mode 1: Contract Review

### Trigger

Before ANY implementation work that isn't a trivial one-liner (typo fix, obvious constant change).
If in doubt, run the contract — the cost of over-specifying is near zero compared to the cost of
a wrong assumption.

### Step 1: Identify the Source

What are we contracting? State it clearly:

> "Contracting: [plan/bugfix/feature] — [one-sentence description]"
> "Source document: [path to plan or design doc, or 'conversation' if ad-hoc]"

### Step 2: Live System Verification

Before writing any contract, verify facts against live systems. No assumptions.

**Database schema** — for every table/column referenced:
```sql
-- Run against dev DB via psql or the API's query mechanism
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = '<table>' ORDER BY ordinal_position;
```

**Foreign keys and constraints:**
```sql
SELECT tc.constraint_name, tc.constraint_type, kcu.column_name,
       ccu.table_name AS foreign_table, ccu.column_name AS foreign_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
LEFT JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
WHERE tc.table_name = '<table>';
```

**Existing code** — for every file, function, import, or endpoint referenced:
- Read the actual file. Quote the actual current code.
- Verify the function signature, its parameters, its return value.
- Verify the import path exists and exports what you think it exports.

**API endpoints** — for any external API interaction:
- Verify the endpoint URL, method, headers, request/response shape
- Reference actual documentation or prior successful calls in the codebase

Record every verification in the contract document. If something cannot be verified, that is a
**blocker** — the contract cannot pass until it's resolved.

### Step 3: Write the Contract Review Document

Create: `docs/contracts/YYYY-MM-DD-<name>-contract.md`

The document follows this exact structure:

```markdown
# Contract Review: [Name]

**Date**: YYYY-MM-DD
**Source**: [path to plan/design/conversation reference]
**Status**: DRAFT | VERIFIED | FAILED
**Reviewer**: contract-manager

## Summary

[One paragraph: what this contract covers and why it exists]

## Live Verifications

| Fact | Verified Against | Result | Timestamp |
|------|-----------------|--------|-----------|
| `orders.status` is VARCHAR(50) | `information_schema.columns` on dev DB | CONFIRMED | ISO timestamp |
| `orderUpsertService.js` exports `upsertRexOrder` | Read file line 42 | CONFIRMED | ISO timestamp |
| ... | ... | ... | ... |

Any row with Result = UNVERIFIED is a blocker.

## Change Contracts

### Contract 1: [Descriptive Name]

**File**: `exact/path/to/file.js`
**Lines**: 45-67 (current), will become 45-72 (target)

#### Current State
```js
// Exact code currently at those lines, quoted from the file
```

#### Target State
```js
// Exact code that must exist after implementation
// So precise that copy-paste would work
```

#### Input Contract
| Input | Type | Source | Constraints | Nullable |
|-------|------|--------|-------------|----------|
| orderId | integer | req.params.id | > 0 | No |
| tenantId | UUID | req.user.tenant_id | valid UUID | No |

#### Output Contract
| Output | Type | Destination | Constraints |
|--------|------|-------------|-------------|
| updated order | object | HTTP 200 JSON response | must include `id`, `status` |

#### Preconditions
- [ ] Order with `orderId` exists in `orders` table for `tenantId`
- [ ] User has permission to modify orders (verified by auth middleware)

#### Postconditions
- [ ] `orders.status` updated to new value
- [ ] `orders.updated_at` set to NOW()
- [ ] No other rows in `orders` were modified

#### Error Contract
| Condition | Response | Side Effects |
|-----------|----------|-------------- |
| Order not found | 404 `{ error: "Order not found" }` | None |
| Invalid status value | 400 `{ error: "Invalid status" }` | None |
| DB connection failure | 500, logged to error handler | None — transaction rolled back |

#### Dependency Contract
- Depends on: [Contract 2] (must be applied first because ...)
- Depended on by: [Contract 3]

### Contract 2: [Next Change]
...

## Test Contracts

For each change contract, define exactly one test that proves it works.

### Test for Contract 1: [Name]

**Type**: integration (hits real dev DB)
**File**: `apps/api/src/__tests__/[test-file].test.js`

#### Setup
```js
// Exact setup code — what rows to insert, what state to create
```

#### Execution
```js
// Exact test code — the call being made
```

#### Assertion
```js
// Exact assertions — what must be true after
```

#### Teardown
```js
// Exact cleanup — restore DB state
```

## Migration Contract (if applicable)

**File**: `apps/api/database/migrations/NNN_description.sql`

```sql
-- Exact SQL that will be in the migration file
-- Must include IF NOT EXISTS guards
-- Must use TIMESTAMPTZ not TIMESTAMP
-- Must include tenant_id where applicable
```

#### Rollback SQL
```sql
-- Exact SQL to undo this migration
```

## Rollback Contract

For each change, how to undo it:

| Contract | Rollback Method | Verified |
|----------|----------------|----------|
| Contract 1 | `git checkout -- path/to/file.js` | Yes — file has no other pending changes |
| Migration | Run rollback SQL above | Yes — tested on dev |

## Blockers

List anything that prevents this contract from being VERIFIED:

- [ ] [Blocker description — must be resolved before implementation]

## Verdict

- [ ] All live verifications CONFIRMED
- [ ] All change contracts complete (no TBD, no "figure out", no "probably")
- [ ] All test contracts defined with exact code
- [ ] All rollback contracts verified
- [ ] No blockers remain
- [ ] Zero assumptions — every fact verified against live system

**VERDICT**: PASS / FAIL

If any checkbox is unchecked: **FAIL**. Do not proceed to implementation.
```

### Step 4: Contract Quality Gates

The contract FAILS if any of these are true:

| Violation | Example |
|-----------|---------|
| Vague language | "sends order data to REX" — what fields? what types? |
| Unverified fact | "the column is probably VARCHAR" — run the query |
| Missing error case | Happy path only — what happens when it fails? |
| Implicit type coercion | Joining UUID to integer without cast |
| Assumed existence | "import from utils" — does that export exist? |
| TBD or TODO | Any placeholder means the contract is incomplete |
| "Should work" | Confidence is not a contract |
| "Similar to X" | Specify exactly, don't reference by analogy |
| Missing tenant_id | Any INSERT/query without tenant scoping (unless table has none) |
| Mock data in tests | Tests must hit real dev DB, not mocked responses |
| Missing rollback | Every change must be reversible |

### Step 5: Present for Review

After writing the contract:

1. State the verdict clearly: PASS or FAIL
2. If FAIL, list every violation with its location in the contract
3. If PASS, confirm: "This contract is ready for peer review. Any model at any level can implement this mechanically."
4. Ask: "Do you want to review the contract, or should I proceed to implementation?"

---

## Mode 2: Contract Verification

### Trigger

After implementation is complete, before marking work as done.

### Process

1. Read the contract document from `docs/contracts/`
2. For each change contract:
   - Read the actual file at the specified path
   - Compare against the Target State in the contract
   - Verify every postcondition is met
   - Run the test contract and confirm it passes
3. For migration contracts:
   - Verify the migration file matches the contract exactly
   - Verify the rollback SQL exists
4. Produce a verification report:

```markdown
# Contract Verification: [Name]

**Contract**: docs/contracts/YYYY-MM-DD-name-contract.md
**Date**: YYYY-MM-DD
**Verifier**: contract-manager

## Results

| Contract | Implemented | Postconditions Met | Test Passes | Verdict |
|----------|------------|-------------------|-------------|---------|
| Contract 1 | Yes | All 3/3 | Yes | PASS |
| Contract 2 | Yes | 2/3 — missing updated_at | No — assertion fails | FAIL |

## Deviations

Any deviation from the contract — even a variable name change — must be recorded:

| Contract | Deviation | Justified | Notes |
|----------|-----------|-----------|-------|
| Contract 1 | None | — | — |
| Contract 2 | Used `modified_at` instead of `updated_at` | No — column name mismatch | Fix required |

## Verdict

**VERDICT**: PASS / FAIL

If any contract has a FAIL verdict or unjustified deviation: overall FAIL.
```

---

## Complexity Threshold

Not everything needs a full contract. Use judgment:

| Complexity | Example | Contract Needed? |
|------------|---------|-----------------|
| Trivial | Fix typo in error message | No |
| Low | Change a constant value | No |
| Medium | Add a new API endpoint | Yes |
| High | Modify sync pipeline | Yes — thorough |
| Critical | Database migration | Yes — with extra rollback scrutiny |

The threshold: if the change touches more than one file, modifies data flow, or changes
database schema — it needs a contract. When in doubt, contract it.

---

## Integration with Existing Skills

- **After** `superpowers:brainstorming` or `compound-engineering:workflows:brainstorm` → plan
- **After** `superpowers:writing-plans` or `compound-engineering:workflows:plan` → plan document
- **THEN** `contract-manager` → Contract Review Document
- **THEN** implementation (executing-plans, subagent-driven-development, etc.)
- **AFTER** implementation → `contract-manager` verification mode
- **THEN** `run-verification` → lint + tests
- **THEN** `scope-check` → no creep
- **THEN** commit

The contract sits between planning and implementation. It is the gate.
