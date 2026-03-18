---
name: enterprise-review
description: "Two-stage code review: spec compliance THEN code quality. Separate concerns prevent spec bugs hiding behind quality observations. Medium+ tier requires a separate agent — builder never reviews own work. Use after enterprise-build."
---

# Enterprise Review

You are reviewing code that was built from a contract. Your job is adversarial verification — find what's wrong, not confirm what's right. Two stages, two separate concerns: spec compliance FIRST, code quality SECOND. They never mix.

---

## THE SEPARATION PRINCIPLE

```
Spec bugs hide behind quality observations.
"Clean code" that violates the contract is WORSE than messy code that fulfills it.
Review spec compliance FIRST. Only then review code quality.
```

Quality findings during Stage 1? Write them down, but DO NOT report them until Stage 2. Spec findings during Stage 2? STOP — you missed something. Go back to Stage 1.

---

## STACK RESOLUTION

Read `.claude/enterprise-state/stack-profile.json` at skill start. Extract:
- `$TEST_CMD` = `commands.test_all`
- `$SOURCE_DIR` = `structure.source_dirs.backend`
- `$FRONTEND_DIR` = `structure.source_dirs.frontend`
- `$TENANT_FIELD` = `multi_tenancy.field`
- `$TENANT_ENABLED` = `multi_tenancy.enabled`
- `$AUTH_MIDDLEWARE` = `auth.middleware_name`
- `$FILE_EXTENSIONS` = `conventions.file_extensions`

If no profile exists: BLOCKED — run /enterprise-discover first.

---

## PREREQUISITES

Before starting review:

1. **Verify upstream artifacts exist**:
   ```bash
   # Contract must exist
   ls docs/contracts/*contract* 2>/dev/null || echo "BLOCKED: No contract found"
   # Build must have produced changes
   git diff --stat HEAD 2>/dev/null | tail -1 || echo "BLOCKED: No changes to review"
   # Tests must be passing
   $TEST_CMD 2>&1 | tail -5
   ```
   **If any check fails: STOP.** Report what's missing.

2. **Identify the contract** — find the contract document in `docs/contracts/` or `.claude/designs/`
3. **Identify the plan** — find the plan in `docs/plans/`
4. **Identify all changed files** — run `git diff --name-only <base-branch>...HEAD`
5. **Identify the tier** — Micro/Small/Medium/Large/XL from the contract
6. **Check builder identity** — Medium+ tier: you MUST be a different agent than the builder

```
Medium+ Tier Gate:
- Ask: "Who built this?"
- If YOU built it → STOP. Tell the user a separate agent must review.
- Builder reviews own work = review is INVALID.
```

---

## SCOPE CLASSIFICATION

Before reviewing any code, classify EVERY changed file:

| Category | Definition | Review Action |
|----------|-----------|---------------|
| **REQUIRED** | Directly implements a postcondition | Full Stage 1 + Stage 2 |
| **ENABLING** | Infrastructure needed by REQUIRED files (utils, types, migrations) | Stage 2 only |
| **DRIFT** | Not traceable to any postcondition | Flag for removal |

```bash
# List all changed files
git diff --name-only <base-branch>...HEAD

# For each file, answer: which postcondition does this serve?
# If no postcondition → DRIFT
```

**DRIFT files are a red flag.** They indicate scope creep. Report them prominently. The builder must justify each one or revert it.

---

## STAGE 1: SPEC COMPLIANCE

### 1A — Postcondition Verification

For EACH postcondition in the contract (PC-1, PC-2, etc.):

```
PC-X: [postcondition text]
├── Implemented? YES/NO
│   └── Where? [file:line]
├── Test exists? YES/NO
│   └── Where? [test file:line]
├── Test verifies the RIGHT thing? YES/NO
│   └── Does the assertion match the postcondition exactly?
│   └── Does the test exercise the actual code path (not a mock)?
│   └── Does the test fail if the postcondition is violated?
└── Verdict: PASS / FAIL [reason]
```

**Common spec failures:**
- Test passes but doesn't actually verify the postcondition (assertion too weak)
- Implementation handles happy path but not the error case stated in the PC
- Test mocks the exact thing the postcondition is about
- Postcondition says "returns X" but implementation returns X wrapped in something else

### 1B — Consumer Map Verification

For each consumer listed in the contract's consumer map:

```
Consumer: [consumer name]
├── Still receives correct data shape? YES/NO
├── Breaking changes introduced? YES/NO
├── Integration tested? YES/NO
└── Verdict: PASS / FAIL [reason]
```

```bash
# Find all consumers of the changed module
cd $PROJECT_ROOT
grep -rn "require.*<module>" $SOURCE_DIR/ --include="*.js" | grep -v node_modules | grep -v __tests__
grep -rn "import.*from.*<module>" $SOURCE_DIR/ --include="*.js" | grep -v node_modules | grep -v __tests__
```

### 1C — Invariant Verification

For each invariant in the contract:

```
Invariant: [invariant text]
├── Maintained in all code paths? YES/NO
├── Test guards the invariant? YES/NO
└── Verdict: PASS / FAIL [reason]
```

### 1D — Stage 1 Verdict

```
═══════════════════════════════════════════
STAGE 1 VERDICT: SPEC [PASS/FAIL]
═══════════════════════════════════════════

Postconditions: X/Y passed
Consumers: X/Y verified
Invariants: X/Y maintained

[If FAIL:]
FAILURES:
- PC-X: [specific failure]
- Consumer Y: [specific failure]
- Invariant Z: [specific failure]

ACTION: Fix failures and re-submit for review.
Stage 2 will NOT run until Stage 1 passes.
═══════════════════════════════════════════
```

**If Stage 1 FAILS: STOP. Do not proceed to Stage 2.** Report failures and return to builder.

---

## STAGE 2: CODE QUALITY (Lens Dispatch)

Only runs after Stage 1 passes. Stage 2 dispatches stack-specific review lenses generated by `/harness-init`.

### 2.0 — Load Lens Registry

```bash
cat .claude/enterprise-state/review-lenses.json
```

If `review-lenses.json` exists → use **Lens Dispatch** (2.1–2.3 below).
If it does NOT exist → use **Legacy Checks** (2A–2H fallback at the end of this section).

### 2.1 — Filter Relevant Lenses

For each lens in the registry, check if any changed files match the lens's `applies_to` pattern. Skip lenses that match zero changed files.

```bash
# Get changed files
CHANGED=$(git diff --name-only <base-branch>...HEAD)
```

`security` and `architecture` lenses always run (they apply to all files).

### 2.2 — Dispatch Each Lens

For each relevant lens, invoke it as a subagent (or inline for Solo mode):

```
REVIEW LENS: {lens_id}
CHANGED FILES: {files matching this lens}
BASE BRANCH: {base_branch}

Run the checklist in .claude/skills/review-lens-{id}/SKILL.md
Return the VERDICT FORMAT exactly as specified in the skill.
```

Each lens returns:
```
LENS: {id}
FILES CHECKED: [count]
FINDINGS:
  - [file:line] [FAIL|WARN] description
VERDICT: PASS | FAIL | WARN
BLOCKING: [FAIL items]
ADVISORY: [WARN items]
```

### 2.3 — Aggregate Verdicts

Collect all lens verdicts into the Stage 2 table:

```
═══════════════════════════════════════════
STAGE 2 VERDICT: QUALITY [PASS/FAIL]
═══════════════════════════════════════════

| Lens | Files | Verdict | Blocking | Advisory |
|------|-------|---------|----------|----------|
| api-node | 3 | PASS | 0 | 1 |
| sql-pg | 2 | FAIL | 2 | 0 |
| test-js | 4 | WARN | 0 | 3 |
| security | 5 | PASS | 0 | 0 |
| architecture | 5 | PASS | 0 | 1 |

OVERALL: PASS if all lenses PASS/WARN, FAIL if any lens FAIL

[If FAIL:]
BLOCKING FINDINGS:
- [lens:file:line] description

ACTION: Fix blocking findings and re-submit for review.
═══════════════════════════════════════════
```

### Legacy Checks (fallback if no review-lenses.json)

If the lens registry does not exist, run these hardcoded checks instead. These are the original Stage 2 checks for backwards compatibility with projects installed before lens generation.

**2A — File Size**: Flag files over 400 lines (soft), FAIL over 800 (hard). Test files exempt.
**2B — Tenant Isolation**: Every new SQL query must have `$TENANT_FIELD` in WHERE/INSERT.
**2C — Query Safety**: All queries parameterized, no string concatenation in SQL.
**2D — Import Verification**: Every require/import resolves to an existing file.
**2E — Debug Code**: No console.log/debugger in production code.
**2F — Security**: Auth middleware on non-public routes, input validation present.
**2G — Pattern Compliance**: Code follows existing codebase patterns, no reinvented utilities.
**2H — Migration Safety**: IF NOT EXISTS guards, TIMESTAMPTZ, indexes on foreign keys.

---

## FINAL REVIEW REPORT

Save to: `docs/reviews/YYYY-MM-DD-<slug>-review.md`

```markdown
# Review: <Feature Slug>

**Date:** YYYY-MM-DD
**Contract:** <path to contract>
**Builder:** <who built it>
**Reviewer:** <who reviewed it>
**Tier:** <Micro/Small/Medium/Large/XL>

## Scope Classification

| File | Category | Postcondition |
|------|----------|---------------|
| ... | REQUIRED | PC-X |
| ... | ENABLING | supports PC-Y |
| ... | DRIFT | none — flagged |

## Stage 1: Spec Compliance — [PASS/FAIL]

### Postconditions
| PC | Status | Implementation | Test | Notes |
|----|--------|---------------|------|-------|
| PC-1 | PASS/FAIL | file:line | test:line | ... |

### Consumers
| Consumer | Status | Notes |
|----------|--------|-------|
| ... | PASS/FAIL | ... |

### Invariants
| Invariant | Status | Notes |
|-----------|--------|-------|
| ... | PASS/FAIL | ... |

## Stage 2: Code Quality — [PASS/FAIL]

| Check | Status | Notes |
|-------|--------|-------|
| File Size | PASS/FAIL | ... |
| Tenant Isolation | PASS/FAIL | ... |
| Query Safety | PASS/FAIL | ... |
| Import Resolution | PASS/FAIL | ... |
| Debug Code | PASS/FAIL | ... |
| Security | PASS/FAIL | ... |
| Pattern Compliance | PASS/FAIL | ... |
| Migration Safety | PASS/FAIL | ... |

## Overall Verdict: [PASS/FAIL]

[Summary of findings, required fixes, or approval statement]
```

---

## REVIEW WORKFLOW

```
1. Receive review request
2. Locate contract + plan + changed files
3. Check tier → enforce builder != reviewer for Medium+
4. Classify scope: REQUIRED / ENABLING / DRIFT
5. Stage 1: Spec Compliance
   └── FAIL? → STOP. Return to builder with failures.
6. Stage 2: Code Quality
   └── FAIL? → Return to builder with failures.
7. Both PASS → Write review report → Approve
```

---

## RE-REVIEW PROTOCOL

When code comes back after fixes:

1. **Only re-check the failures** — don't re-review passing checks
2. **Verify the fix didn't break a previously passing check** — run all tests
3. **Update the review report** with new verdicts
4. **If new issues found during re-review** — full stage re-run for that stage

```bash
# Verify tests still pass after fixes
cd $PROJECT_ROOT && $TEST_CMD 2>&1 | tail -20
```
