---
name: enterprise-dev
description: "DEPRECATED — Use /enterprise instead. This skill has been superseded by the modular enterprise pipeline (/enterprise orchestrator + /enterprise-discover, /enterprise-brainstorm, /enterprise-plan, /enterprise-contract, /enterprise-build, /enterprise-review, /enterprise-forge, /enterprise-verify, /enterprise-compound). All unique features from this skill (DISCOVER, ERROR STRATEGY) have been incorporated into the modular pipeline. Invoke /enterprise for all development work."
---

# Enterprise Development Pipeline (DEPRECATED)

> **This skill is deprecated.** Use `/enterprise` instead. The modular enterprise pipeline now includes all stages from this skill:
> - DISCOVER stage → `/enterprise-discover`
> - ERROR STRATEGY → incorporated into `/enterprise-contract`
> - All other stages → individual `/enterprise-*` skills
>
> This file is preserved for reference only. Do not invoke it for new work.

## Engineering Charter (NON-NEGOTIABLE)

1. **Enterprise standard.** Benchmark: Microsoft, Oracle. No shortcuts, no patches, no vibe coding.
2. **Fix, don't patch.** Root cause or nothing.
3. **Measure twice, cut once.** All thinking before code. Coding is mechanical.
4. **Contracts are 1:1.** Every postcondition traceable to a test AND a code line. No guessing.
5. **E2E trace everything.** DB → service → route → hook → state → component → UI. Every radius and edge documented.
6. **Document as you go.** If we crash, the next agent picks up from artifacts.
7. **Isolated worktrees.** Many agents concurrent. Keep your room tidy.
8. **Reuse first.** Search before writing. New files only when genuinely new.
9. **New modules: trace before code.** Map all system interactions BEFORE implementation.
10. **Use available memory tools.** Store decisions, share knowledge, document gaps. Use Memora MCP, Muninn MCP, or filesystem fallback — whichever is available. Use `cortex-engine` for code indexing if available.
11. **Builder never reviews own work (Medium+ tier).** For Medium and Large tier: REVIEW and FORGE stages MUST be run by a separate agent. The agent that wrote the code cannot grade it. For Micro and Small tier: self-review is acceptable to avoid doubling token cost on low-risk changes.
12. **No token anxiety.** Take whatever time needed. Quality over speed.

---

One skill. Give it an idea or a bug. It drives through to completion.

```
/enterprise-dev add configurable sync alert thresholds per product category
/enterprise-dev fix: PO double receipt — receiveItems called twice in saveAndReceive.js
/enterprise-dev refactor: extract order upsert pipeline into separate service modules
```

---

## How This Works

Ten stages. Each produces an artifact. Hooks enforce the gates.

```
WORKTREE → TRIAGE → DISCOVER → PLAN → CONTRACT → GUARD → BUILD → REVIEW → VERIFY → COMPLETE
    ↓         ↓          ↓        ↓        ↓          ↓        ↓        ↓         ↓        ↓
 isolated   tier     design +  plan.md  contract   error    TDD      review    tests   merge +
 branch     set      codebase  (exact   locked    strategy  code +    .md      green   cleanup
                     mapped    code)                        tests
```

Two things make this better than "just write code":

1. **The CONTRACT stage** forces exhaustive tracing of every affected code path before implementation. In A/B testing, contract-first agents found real bugs that freestyle agents missed — because the contract forced them to trace all write sites, all callers, all edge cases.

2. **Strict TDD** — no production code without a failing test first. If you write code before the test, delete it and start over. This is the iron law.

---

## Stage 0: WORKTREE (30 seconds)

Every non-trivial task gets its own isolated git worktree.

1. **Generate a branch name** from the task:
   - Features: `feat/<slug>` (e.g., `feat/sync-alert-thresholds`)
   - Bug fixes: `fix/<slug>` (e.g., `fix/po-double-receipt`)
   - Refactors: `refactor/<slug>` (e.g., `refactor/order-upsert-extract`)

2. **Check for existing worktrees**:
   ```bash
   git worktree list
   ls .claude/worktrees/ 2>/dev/null
   ```

3. **Create the worktree**:
   ```bash
   git worktree add .claude/worktrees/<slug> -b <branch-name>
   cd .claude/worktrees/<slug>
   ```

4. **Verify**: `git branch --show-current` shows your new branch.

**Skip for**: Micro tier, or when the user says "just do it here."

---

## Stage 1: TRIAGE (30 seconds)

Classify the task to determine how much ceremony each stage gets.

| Tier | Criteria | Stages Applied |
|------|----------|---------------|
| **Micro** | Typo, 1-liner, config change, <2 files | BUILD → VERIFY only |
| **Small** | Clear fix, 2-3 files, no new APIs or tables | DISCOVER → PLAN → CONTRACT (bugs only) → BUILD → REVIEW → VERIFY |
| **Medium** | New endpoint, new table, 3-5 files | All 10 stages |
| **Large** | New system, 5+ files, concurrency, multiple integrations | All 10 stages + parallel research agents |

For bugs, default to **Small** unless concurrency, data corruption, or multiple systems are involved.

Announce: "**TRIAGE**: [tier] — [feature/bug/refactor]. [1 sentence why this tier]."

---

## Stage 2: DISCOVER (3-8 minutes)

Two goals: understand the codebase AND shape the design through questions.

### Part A: Codebase Mapping

1. **Query domain knowledge** — memory (Memora/Muninn if available), MEMORY.md, existing docs for gotchas and anti-patterns.

2. **Map the affected code** — read every file in the blast radius. For each:
   - Current behavior
   - Data flow (where data comes from, where it goes)
   - Callers (trace upstream — who calls this?)
   - Side effects (emails, logs, other table writes)
   - Existing tests

3. **For bugs** — trace the exact execution path. Find the root cause. Then check if the same pattern exists elsewhere (the emailService lesson).

### Part A.1: End-to-End Data Flow Trace (MANDATORY for full-stack changes)

If the change touches data that flows across architectural layers (DB → service → route → frontend hook → component → rendered UI), you MUST trace it through EVERY layer to its final consumer. Don't stop at the service or the hook.

**Trace template** — for each piece of affected data, document:
```
DATA: [what the data is, e.g., "staff list for assignment"]
  → DB query: [function, file:line]
  → Service: [function, file:line]
  → Route response: [field name in JSON response, file:line]
  → Frontend fetch: [hook/function, file:line]
  → State: [state variable name, file:line]
  → Component consumer 1: [component, prop, what it renders, file:line]
  → Component consumer 2: [component, prop, what it renders, file:line]
```

**Why this matters**: In A/B testing, an agent correctly fixed the API layer but missed that the same data was consumed by two components with different requirements (a filter dropdown needing team-only data vs an assignment dropdown needing all-staff data). The API fix was correct but the frontend was incomplete because the trace stopped at the hook.

**Separation of concerns check**: When a single data source feeds multiple UI elements, ask: "Do these consumers have different data requirements?" If yes, they need separate data paths — not one shared variable. Flag this in the plan.

**Field completeness audit (MANDATORY when user reports "incorrect" or "wrong" data)**: When a user says information is "incorrect", "wrong", or "broken" — even if they mention specific fields like "especially stock quantities" — you MUST audit ALL fields the component displays against the actual DB schema. "Especially X" means X is the most visible problem, not the only one. In A/B testing, an enterprise agent fixed stock quantities but missed 4 other broken fields (reorder_point, reorder_quantity, current_stock, updated_at) because it only checked what was explicitly mentioned. The freestyle agent checked everything and found them all.

**How to do the audit**: Read the component's JSX/render. List every data field it displays. For each field, trace it back to the API response, then to the DB query, then to the actual table schema. Any mismatch is a bug — add it to the contract postconditions.

### Part B: Design Conversation (Medium/Large tier)

Interactive design conversation — streamlined for autonomous execution:

1. **If requirements are clear** (user gave specific details): skip to approaches.
2. **If requirements are fuzzy**: ask 2-3 targeted clarifying questions. Wait for answers. Don't shotgun 10 questions — ask the most important one first.

3. **Propose 2-3 approaches** with tradeoffs:
   ```
   Approach A: [description] — tradeoff: [simpler but less flexible]
   Approach B: [description] — tradeoff: [more complex but extensible]
   Recommended: A, because [reason]
   ```

4. **Get approval** on the approach before proceeding.

**For Small tier**: Skip the interactive design — just map the code and move to PLAN.
**For autonomous execution** (no human in loop): pick the recommended approach and document why.

---

## Stage 3: PLAN (3-8 minutes)

Write a fine-grained implementation plan. Every step should be 2-5 minutes of work with exact file paths, exact code, and exact test commands.

### Save to: `docs/plans/YYYY-MM-DD-<task-slug>-plan.md`

### Plan header:

```markdown
# Plan: <task title>
**Date**: YYYY-MM-DD | **Type**: feature/bug/refactor | **Tier**: micro/small/medium/large

## Problem Statement
[2-3 sentences grounded in what DISCOVER found]

## Approach
[Which approach from DISCOVER, and why]
```

### Task format (fine-grained granularity):

````markdown
### Task 1: <Component Name>

**Files:**
- Create: `exact/path/to/file.js`
- Modify: `exact/path/to/existing.js:123-145`
- Test: `exact/path/to/test.js`

**Step 1: Write the failing test**
```javascript
test('rejects empty category', async () => {
  const result = await createAlertConfig({ category: '', threshold_minutes: 30 });
  expect(result.error).toBe('Category is required');
});
```

**Step 2: Run test — verify it fails**
Run: `cd apps/api && npx jest --testPathPattern="syncAlert" --no-coverage`
Expected: FAIL — "createAlertConfig is not defined"

**Step 3: Write minimal implementation**
```javascript
async function createAlertConfig({ category, threshold_minutes, tenant_id }) {
  if (!category?.trim()) return { error: 'Category is required' };
  // ...
}
```

**Step 4: Run test — verify it passes**
Expected: PASS

**Step 5: Commit**
```bash
git add -A && git commit -m "feat: add alert config validation"
```
````

### Plan rules:
- **Exact file paths** always
- **Complete code** in the plan (not "add validation")
- **Exact commands** with expected output
- **2-5 minute steps** — if a step takes longer, split it
- **TDD order** — test first, then implementation, always

**For Small tier**: Fewer steps, less code in plan, but still TDD order.

---

## Stage 4: CONTRACT (3-8 minutes)

The most important stage. This is why enterprise-dev beats freestyle.

A contract is a mechanical specification that defines exactly what the code must do, must not do, and how to verify both. Every postcondition becomes a test. Every error case becomes a negative test.

### Save to: `docs/contracts/YYYY-MM-DD-<task-slug>-contract.md`

```markdown
# Contract: <task title>
**Date**: YYYY-MM-DD | **Status**: LOCKED

## Preconditions
- [What must be true before this code runs]

## Postconditions
- PC-1: [Exact verifiable outcome — this becomes a test assertion]
- PC-2: [Another outcome]

### Layer-Specific Postconditions (for full-stack changes)
If the change spans multiple layers, write postconditions for EACH layer:
- API: PC-A1: [endpoint returns X in field Y]
- State: PC-S1: [hook exposes X and Y as separate state variables]
- UI: PC-U1: [component A renders X in dropdown, component B renders Y in list]

Every postcondition becomes a test. API postconditions become API tests.
UI postconditions become assertions about what data each component receives.
A postcondition that is "met at the API but not at the UI" is NOT met.

## Invariants
- INV-1: Every query scopes to tenant_id
- INV-2: No SQL injection (parameterized queries only)
- INV-3: No file exceeds 400 lines

## Error Cases
- ERR-1: [How this fails] → [What happens: status code, log, recovery]
- ERR-2: ...

## Consumer Map
For each data output, list every consumer and what it does with the data:
- [Data field] → consumed by [component/function] for [purpose] at [file:line]
- [Data field] → consumed by [component/function] for [purpose] at [file:line]
If two consumers need different subsets of the same data, they MUST get separate fields/state.

## Side Effects
- [Everything this code does besides its primary function]

## NOT in Scope
- [Explicitly list what this does NOT change — prevents drift]
```

### Why this matters:

The contract forces you to enumerate every write site, every caller, every side effect BEFORE writing code. In 3 rounds of A/B testing:
- Contract agents found a real bug in `emailService.js` (wrong column name) that freestyle missed
- Contract agents added NULL guards and type-safe lock keys that freestyle skipped
- Contract agents added permission checks on routes that freestyle forgot
- Contract agents did an 8-site audit of all `sent_date` writes when freestyle checked 0

**The contract must exist BEFORE any source code edits.** The `pipeline-gate.sh` hook enforces this — source file edits are blocked until a contract document exists in `docs/contracts/`.

**For Small tier bugs**: Still write a contract. The contract can be shorter (skip Error Cases and Side Effects sections if trivial), but postconditions MUST exist as a standalone artifact. In A/B testing, inline postconditions in plans were too coarse-grained — they missed layer-specific requirements that a dedicated contract would have caught.

**For Small tier features**: Write postconditions inline in the plan.

---

## Stage 5: GUARD (2-4 minutes)

Define how this code fails gracefully.

### Save to: `docs/error-strategies/YYYY-MM-DD-<task-slug>.md`

```markdown
# Error Strategy: <task title>

## External Calls
| Call | Timeout | Retry | On Failure |
|------|---------|-------|------------|
| REX API | 30s | 1 retry | Log + mark failed |
| Database | 5s | none | Throw, transaction rollback |
| Email | 10s | none | Log warning, continue |

## Failure Classification
| Error | Code | Retryable? | Action |
|-------|------|------------|--------|
| rex_timeout | EREX001 | Yes | Queue retry |
| invalid_input | EVAL001 | No | Return 400 |

## Recovery
- Crash mid-operation: [partial state handling]
- Stale claims: [timeout and reclamation]
```

**Skip for Micro and Small tier.**

---

## Stage 6: BUILD — Strict TDD (the bulk of the work)

Now write code. The contract tells you what. The plan tells you how. TDD tells you the order.

### The Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

Write code before the test? **Delete it. Start over.** Not "keep as reference." Not "adapt it." Delete.

### The Mechanical Sequence (non-negotiable)

Every piece of functionality follows this exact sequence. No shortcuts. No reordering.

**Step 1: WRITE the test.** One test. One behavior. Save the test file.

**Step 2: RUN the test. Show the FAIL output.**
```bash
cd apps/api && npx jest --testPathPattern="<pattern>" --no-coverage 2>&1 | tail -20
```
You MUST see the test fail. You MUST paste/show the failure output. If the test passes, you wrote a useless test — delete it and write one that tests something missing. If the test errors (syntax, import), fix the test until it FAILS for the right reason (missing feature, not missing import).

**Step 3: WRITE the minimal production code** to make the test pass. Nothing more.

**Step 4: RUN the test. Show the PASS output.**
```bash
cd apps/api && npx jest --testPathPattern="<pattern>" --no-coverage 2>&1 | tail -20
```
You MUST see the test pass. If it fails, fix the production code (not the test).

**Step 5: REFACTOR** if needed. Run tests again — still green.

**Step 6: COMMIT** the passing unit.

**Step 7: REPEAT** for next postcondition.

### Why This Sequence Matters

In A/B testing, agents that skipped steps 2 and 4 (running the test) produced code that looked correct but had subtle gaps — the test was written to match the code rather than to specify the behavior. Running the test and seeing RED first proves the test is actually testing something. A test that has never been red has never caught a bug.

The sequence is: **test file saved → test run → RED output shown → code written → test run → GREEN output shown**. If you find yourself writing a `.js` production file before a `.test.js` file, STOP. You are violating the sequence.

### Rationalizations That Mean STOP

| Thought | Reality |
|---------|---------|
| "Too simple to test" | Simple code breaks. Test takes 30 seconds. |
| "I'll test after" | Tests passing immediately prove nothing. |
| "I already know what the fix is" | Great — prove it by writing the test first. If you know the fix, the test is trivial. |
| "The trace/contract/consumer-map took a while, let me just write the code" | The trace told you WHAT to test. Use it. Test first. |
| "Need to explore first" | Fine. Throw away exploration, start with TDD. |
| "Test is hard to write" | Hard to test = hard to use. Fix the design. |
| "TDD slows me down" | TDD is faster than debugging. Every time. |
| "Just this once" | There is no "just this once." |

### Implementation Order

1. **Migration first** (if needed) — `IF NOT EXISTS`, `TIMESTAMPTZ`, `tenant_id`
2. **Tests second** — write failing tests for each postcondition, one at a time
3. **Production code third** — make each test pass, one at a time
4. **Repeat** steps 2-3 for each postcondition in the contract

Do NOT write all tests first then all code. Interleave: one test RED → one piece of code GREEN → next test RED → next piece of code GREEN.

### After each logical unit passes:

```bash
cd apps/api && npx jest --testPathPattern="<pattern>" --no-coverage
```

Commit with conventional message:
```bash
git commit -m "feat: add sync alert config service with CRUD operations"
```

### BUILD Rules

- **Read before import** — verify every function exists, signature matches, return type is right
- **Scope lock** — implement ONLY what the contract specifies
- **No god files** — 400 line soft limit. Approaching it? Extract first.
- **Existing patterns** — use what the codebase already uses. Don't invent new patterns.
- **Permission checks** — every new write endpoint needs auth + permission scoping
- **Verify every consumer** — after changing a data source (API response, service return, state shape), read every file that consumes that data. If a consumer needs different data than another consumer, give them separate fields/state. Don't assume one fix propagates correctly to all consumers.
- **Full-stack completeness** — if you change an API response shape, you MUST update every frontend consumer. If you add state to a hook, you MUST verify every component that uses that hook. An API fix without the corresponding frontend fix is an incomplete fix.

---

## Stage 7: REVIEW (3-5 minutes)

Systematic self-review against the contract. Not "looks good" — a checklist.

### Save to: `docs/reviews/YYYY-MM-DD-<task-slug>-review.md`

```markdown
# Review: <task title>
**Date**: YYYY-MM-DD | **Verdict**: PASS | FAIL | PASS WITH NOTES

## Contract Compliance
- [ ] PC-1: [text] — VERIFIED: [test name that proves it]
- [ ] PC-2: [text] — VERIFIED: [test name]
- [ ] Every postcondition has at least one test
- [ ] Every error case has a negative test

## TDD Compliance
- [ ] Every new function has a test that was written FIRST (test file saved before production file edited)
- [ ] Every test was RUN and shown to FAIL before production code was written
- [ ] RED output was shown/pasted for each test before GREEN implementation
- [ ] No production code without a prior failing test
- [ ] Tests were interleaved with code (not all tests first, then all code)

## Code Quality
- [ ] No file exceeds 400 lines
- [ ] Every query scopes to tenant_id
- [ ] All queries parameterized (no string concatenation)
- [ ] Every import verified (function exists, signature matches)
- [ ] No debug code (console.log, TODO, FIXME)

## Security
- [ ] New routes have authentication middleware
- [ ] Write endpoints have permission checks
- [ ] Input validated before use
- [ ] No SQL injection vectors

## End-to-End Verification
- [ ] For each postcondition, verified at EVERY architectural layer (API, state, component, UI)
- [ ] Every consumer of changed data verified — no consumer left using stale/wrong data shape
- [ ] If data feeds multiple UI elements with different purposes, each gets its own data path
- [ ] Walked the user-visible behavior mentally: "A user clicks X, sees Y" — does it work?

## Scope
- [ ] Only files in the plan were changed
- [ ] No scope creep beyond the contract
- [ ] Out-of-scope observations noted (not fixed)

## Classification
For each changed file: REQUIRED (in contract) | ENABLING (needed for required) | DRIFT
- [ ] No DRIFT changes remain — revert any immediately
```

**FAIL?** Fix the failing items, re-review. Don't proceed to VERIFY with failures.

---

## Stage 8: VERIFY (2-3 minutes)

Run the full test suite. Trace every postcondition to a passing test.

1. **Run all tests**:
   ```bash
   cd apps/api && npx jest --no-coverage
   ```

2. **Postcondition trace** — for each contract postcondition, name the test that exercises it:
   - PC-1 → `syncAlertService.test.js: "rejects empty category"` → PASS
   - PC-2 → `syncAlertService.test.js: "creates config with valid input"` → PASS

3. **Regression check** — any existing tests now failing? Fix before proceeding.

4. **Final diff** — `git diff --stat` to confirm only expected files changed.

5. **Build verification** (MANDATORY if frontend files changed):
   ```bash
   cd apps/admin && npx vite build 2>&1 | tail -20
   ```
   This catches missing imports, unresolved modules, and build-time errors that tests don't cover. A test suite can pass with 100% green while the production build fails because of a missing component file. In production, an enterprise agent added imports for `DashboardErrorBoundary` but the component file wasn't committed — tests passed, Render build failed. This step would have caught it.

   **If build fails**: fix the missing file/import, re-run build, re-run tests. Do NOT proceed to FORGE with a broken build.

---

## Stage 8.5: FORGE REVIEW (3-5 minutes)

The code works. The tests pass. But we shipped bugs anyway — tests passed, build failed; tests passed, missing imports crashed Render. The forge review must be MECHANICAL first, then adversarial. Run actual commands. Check actual files. Don't just think about what could go wrong — PROVE nothing is wrong.

### Part 1: Mechanical Verification (run these commands — not optional)

These are not questions to ponder. They are commands to run. Every one produces a pass/fail result.

**M1 — Import Resolution Check**: Every import in changed files must resolve to a real file.
```bash
# For each changed .js/.jsx file, extract imports and verify the target exists
git diff main --name-only -- '*.js' '*.jsx' | while read f; do
  grep -oP "from ['\"](\.\./[^'\"]+)" "$f" | while read imp; do
    target=$(echo "$imp" | sed "s/from ['\"]//")
    dir=$(dirname "$f")
    resolved="$dir/$target"
    # Check .js, .jsx, /index.js, /index.jsx
    if [ ! -f "${resolved}.js" ] && [ ! -f "${resolved}.jsx" ] && [ ! -f "${resolved}/index.js" ] && [ ! -f "${resolved}/index.jsx" ]; then
      echo "MISSING IMPORT: $f imports $target — FILE NOT FOUND"
    fi
  done
done
```
**Any output = BUG.** This is exactly what caught us — DashboardErrorBoundary was imported but the file didn't exist. Tests passed. Build crashed.

**M2 — Uncommitted File Check**: Are there created files that should be committed but aren't?
```bash
git status --short | grep '^??' | grep -E '\.(js|jsx|ts|tsx|sql|md)$'
```
If any untracked file is referenced by a committed file's import, it's a BUG.

**M3 — Dead Export Check**: Did you export something nothing imports?
```bash
# For each new export in changed files, verify at least one file imports it
git diff main -- '*.js' '*.jsx' | grep '^+.*export' | grep -v '^+++' | while read line; do
  name=$(echo "$line" | grep -oP '(?:export (?:function|const|class) )(\w+)' | head -1 | awk '{print $NF}')
  if [ -n "$name" ]; then
    count=$(grep -r "$name" apps/ --include='*.js' --include='*.jsx' -l | wc -l)
    if [ "$count" -lt 2 ]; then
      echo "DEAD EXPORT: $name exported but only found in 1 file (itself)"
    fi
  fi
done
```
Dead exports aren't bugs but signal incomplete work — you created something you forgot to wire up.

**M4 — Contract Postcondition Crosscheck**: Every postcondition in the contract must map to a test name that exists and passes.
```bash
# Read the contract, extract PC-N lines, verify each test name exists in test files
grep 'PC-' docs/contracts/*.md | grep -oP 'VERIFIED.*?"([^"]+)"' | while read test_name; do
  if ! grep -r "$test_name" apps/ --include='*.test.*' -q; then
    echo "UNVERIFIED POSTCONDITION: test '$test_name' not found in test files"
  fi
done
```
**Any output = BUG.** A postcondition without a real test is a lie.

**M5 — Console/Debug Check**: No debug artifacts shipping to production.
```bash
git diff main -- '*.js' '*.jsx' | grep '^+' | grep -v '^+++' | grep -iE 'console\.(log|debug|warn|info)|debugger|TODO|FIXME|HACK|XXX' | grep -v '\.test\.' | grep -v 'console\.error'
```
`console.error` in error handlers is fine. Everything else is a finding.

### Part 1.5: Contract Probing (the forge's real job)

The contract says "PC-1: getStaffUsers excludes system accounts." The test says `expect(sql).toContain('is_active')`. Both passed. But does it ACTUALLY work from a different angle?

**For each postcondition, probe it from a direction the original test didn't cover:**

| Original Test Angle | Probe Angle |
|---------------------|-------------|
| Unit test with mock DB | What does the actual SQL return against real data? |
| Tests the happy path | What about the empty result? The single result? |
| Tests the API response | Does the frontend actually USE the field correctly? |
| Tests with valid input | What about boundary input? (max length, unicode, special chars) |
| Tests one consumer | Do ALL consumers handle the data correctly? |
| Tests the function works | Does the function get CALLED in the right place? (wiring check) |

**How to probe:**

1. Read each postcondition from the contract
2. Read the test that verifies it
3. Ask: "What angle did this test NOT cover?"
4. Write or mentally trace a scenario from that uncovered angle
5. If the scenario reveals a gap → BUG → recycle to contract

**Example that would have caught our bug:**
- PC: "DashboardErrorBoundary wraps CEO dashboard"
- Test: Component test mocking the boundary
- Probe: "Does the import resolve? Does the file exist on disk?" → **FILE NOT FOUND** → BUG

**Contract probes are not new tests** — they are scenarios you trace mentally or verify by reading code. Only write a new test if the probe reveals an actual gap. The point is to attack each postcondition from an angle the original test was blind to.

### Part 2: Adversarial Lenses (think, then verify)

Only run these AFTER Part 1 is clean. The mechanical checks catch the embarrassing bugs. The lenses catch the subtle ones.

**1. The 3AM Test** — "If this breaks at 3AM, can on-call figure out what happened from the logs alone?"
- Does every error path log enough context to diagnose without a debugger?
- Are error messages specific? ("Query returned 0 rows for user_id=X" not "Error occurred")
- If a dependency fails (DB down, external API timeout), does the error propagate clearly or get swallowed?
- **VERIFY**: grep changed files for `catch` blocks — does each one log the error with context?

**2. The Delete Test** — "What can I remove and nothing breaks?"
- Any helper/utility that's only called once? Inline it.
- Any abstraction that only has one implementation? Remove the abstraction.
- Any variable that's assigned and used once in the next line? Inline it.
- **VERIFY**: for each new function/component created, count its call sites. If only 1, flag it.

**3. The New Hire Test** — "If someone reads this in 6 months with no context, will they understand why?"
- Are variable names precise? (`staffWithHelpdeskAccess` not `filteredUsers`)
- Is there a non-obvious business rule that needs a comment? (Not what the code does — why)
- **VERIFY**: read the diff top-to-bottom as if you've never seen the codebase. Is it clear?

**4. The Adversary Test** — "How would I break this?"
- What input crashes this? (null, undefined, empty string, array with 10K items)
- What happens if this is called twice concurrently? Race condition?
- What if the data is in an unexpected state? (deleted user, archived record, orphaned FK)
- **VERIFY**: for each new function, mentally call it with null, [], {}, and undefined. Does it crash or handle gracefully?

**5. The Scale Test** — "What happens at 10x/100x/1000x?"
- Any query without a LIMIT that returns all rows? What at 100K rows?
- Any N+1 pattern? (loop that makes a query per iteration)
- **VERIFY**: grep changed SQL for `SELECT` without `LIMIT`. Grep for queries inside loops.

### Processing Findings

For each lens, categorize every finding:

```
FORGE REVIEW FINDINGS
═════════════════════

MECHANICAL CHECKS (Part 1):
  M1 — Import Resolution:  [PASS | FAIL: list missing imports]
  M2 — Uncommitted Files:  [PASS | FAIL: list orphaned files]
  M3 — Dead Exports:       [PASS | WARN: list unused exports]
  M4 — Contract Crosscheck: [PASS | FAIL: list unverified PCs]
  M5 — Debug Artifacts:    [PASS | FAIL: list debug code]

CONTRACT PROBING (Part 1.5 — test each postcondition from a different angle):
  PC-1: [original test] + [probe test/scenario] → [PASS | FOUND GAP]
  PC-2: [original test] + [probe test/scenario] → [PASS | FOUND GAP]
  ...

ADVERSARIAL LENSES (Part 2):
  LENS 1 — 3AM Test:      [findings or "clean"]
  LENS 2 — Delete Test:   [findings or "clean"]
  LENS 3 — New Hire Test: [findings or "clean"]
  LENS 4 — Adversary Test: [findings or "clean"]
  LENS 5 — Scale Test:    [findings or "clean"]

VERDICT: M[N] mechanical failures, [N] contract gaps, [N] cosmetic, [N] bugs recycled
```

### The Recycle Rule (NON-NEGOTIABLE)

If ANY finding is classified as **BUG** (not cosmetic):

1. **Do NOT fix it inline.** That's a patch, not a fix.
2. Add it as a new postcondition to the existing contract (PC-N+1, PC-N+2, etc.)
3. Run the blast radius scan on the new bug — same-file, cross-file, validation, edge cases
4. Write a failing test (TDD RED)
5. Fix the bug (TDD GREEN)
6. Re-run VERIFY (full test suite)
7. Re-run FORGE REVIEW on the new changes only

This is the loop:
```
FORGE finds bug → CONTRACT (new PC) → BLAST RADIUS → TDD (RED→GREEN) → VERIFY → FORGE again
```

The loop exits when FORGE finds zero bugs. Cosmetic fixes don't trigger the loop.

### What counts as a BUG vs COSMETIC?

| BUG (recycle) | COSMETIC (fix inline) |
|---------------|----------------------|
| Missing error handling that could crash | Rename variable for clarity |
| Race condition or concurrent access issue | Reorder code for readability |
| Unbounded query that could OOM at scale | Remove dead code/comment |
| Missing validation on user input | Inline a single-use helper |
| Security gap (auth bypass, injection) | Improve log message text |
| Data integrity issue (orphan, duplicate) | Simplify a conditional |
| Incorrect behavior on edge case input | Fix formatting/whitespace |

**When in doubt, it's a BUG.** Recycling is cheap. Missing a bug is expensive.

### Why This Stage Exists

In A/B testing, every methodology produced code that passed tests but had gaps only visible through adversarial review. The compound-engineering multi-agent review caught issues but applied them as patches after the fact. Enterprise-dev's contract system is the right place for bugs — the forge review just gives them one more chance to surface before the code ships. The difference: bugs found here get the FULL treatment (contract, TDD, blast radius), not a quick fix at the finish line.

---

## Stage 9: COMPLETE (1-2 minutes)

Close the loop: commit, merge, clean up.

1. **Final commit** (if uncommitted changes remain):
   ```bash
   git add -A && git commit -m "feat: <summary>

   Contract: docs/contracts/YYYY-MM-DD-<slug>-contract.md
   Tests: N passed, 0 failed"
   ```

2. **Merge to dev** (from the main repo):
   ```bash
   cd <project-root>
   git checkout dev
   git merge --no-ff <branch-name> -m "Merge <branch-name>: <summary>"
   ```

3. **Clean up**:
   ```bash
   git worktree remove .claude/worktrees/<slug>
   git branch -d <branch-name>
   ```

4. **Update MEMORY.md** — add completion note to "Active Work" section.

5. **Save to memory** — key decisions and patterns for future tasks (use whichever memory backend is available).

**Skip merge** when: user wants to review first, review found issues, tests failed.

### Output — Completion Audit Report (MANDATORY, printed to screen)

This report MUST be printed as your final output. It is the accountability artifact — the user reads this, not the review doc. Every line must be backed by evidence.

```
═══════════════════════════════════════════════════════════
                    ENTERPRISE AUDIT REPORT
═══════════════════════════════════════════════════════════

## Task
[1-2 sentence description of what was done]

## Branch & Artifacts
Branch: <name> | Status: <merged/ready for review>
├── Plan:     <path>
├── Contract: <path>
├── Review:   <path>
└── Guard:    <path or "skipped (Small tier)">

## Contract Compliance (every postcondition)
  PC-1: [text] .............. ✅ VERIFIED — [test name]
  PC-2: [text] .............. ✅ VERIFIED — [test name]
  PC-3: [text] .............. ✅ VERIFIED — [test name]
  ...
  Result: [N]/[N] postconditions met

## E2E Trace Verification
  DATA: [what was traced]
    DB → Service → Route → Hook → State → Component
    [file:line] → [file:line] → [file:line] → [file:line] → [file:line] → [file:line]
  Consumers verified: [N]/[N]
    ✅ [consumer 1] — [what it renders, file:line]
    ✅ [consumer 2] — [what it renders, file:line]
    ...

## TDD Compliance
  RED→GREEN cycles: [N]
  Tests written before code: ✅ YES / ❌ NO
  All tests passing: ✅ [N] passed, 0 failed

## Blast Radius Audit
  Same-file siblings: [N] checked — [list with status]
  Cross-file siblings: [N] checked — [list with status]
  Validation/consumer functions: [N] checked — [list with status]
  Edge cases: [empty/null, inactive/system users, alt entry points, permissions]
  OR: "N/A — isolated function, no siblings or shared data"

## Forge Review
  Mechanical Checks:
    M1 Import Resolution:   [PASS/FAIL]
    M2 Uncommitted Files:   [PASS/FAIL]
    M3 Dead Exports:        [PASS/WARN]
    M4 Contract Crosscheck: [PASS/FAIL]
    M5 Debug Artifacts:     [PASS/FAIL]
  Contract Probing:
    [N]/[N] postconditions probed from alternate angle — [N gaps found]
  Adversarial Lenses:
    3AM / Delete / New Hire / Adversary / Scale — [summary]
  ──────────────
  Mechanical failures: [N]
  Contract gaps found: [N]
  Cosmetic fixes: [N]
  Bugs recycled to contract: [N]
  Recycle loops: [N]

## Files Changed
  [git diff --stat output]

## Security
  ✅ tenant_id scoped | ✅ parameterized queries | ✅ auth middleware
  [any additional security notes]

## Scope Discipline
  In-scope changes: [N] files
  Drift detected: NONE / [list any drift]

═══════════════════════════════════════════════════════════
```

**Rules for the audit report:**
- Every postcondition MUST show ✅ or ❌ with the specific test name that proves it
- If ANY postcondition shows ❌, the task is NOT complete — fix it first
- The E2E trace must show actual file:line references, not placeholders
- The consumer list must match the contract's Consumer Map exactly
- Do NOT fabricate test names — use the actual test descriptions from the test runner output

---

## Autonomous Execution

After WORKTREE + TRIAGE, work through every stage without stopping — all the way through to COMPLETE.

**STOP ONLY for**:
- Genuine ambiguity that changes the entire approach (Medium/Large tier: ask)
- Blocker you cannot work around
- Task complete

**WHEN UNCERTAIN**:
- Make the reasonable assumption
- Document it in the plan or contract
- Continue working
- Flag for human review in the review artifact

---

## Bug Fix Shortcut

For bugs, the stages shift:

| Standard | Bug Fix |
|----------|---------|
| DISCOVER | **ROOT CAUSE**: trace execution path end-to-end, find the bug, run BLAST RADIUS scan (same-file + cross-file siblings + validation functions + edge cases) |
| PLAN | **FIX PLAN**: what to change + every blast radius finding becomes a task + edge cases become test cases |
| CONTRACT | **FIX CONTRACT**: precondition (bug exists), postcondition (bug fixed at every layer and every consumer) |
| BUILD | **TDD FIX**: write test proving bug exists → fix → test passes |
| REVIEW | **BLAST RADIUS REVIEW**: did you scan same-file AND cross-file siblings? Did you check validation functions? Did you test edge cases (null, inactive, system, alt entry points)? |
| FORGE | **5 LENSES**: 3AM (logging), Delete (YAGNI), New Hire (clarity), Adversary (break it), Scale (10x/100x). Bugs recycle to CONTRACT. |

### The Three Critical Rules

**Rule 1 — Trace all WRITE sites**: if `sent_date` is wrong in one place, search for EVERY place `sent_date` is written and check them all. The contract postconditions must cover every write site, not just the first one you found.

**Rule 2 — Trace all CONSUMERS**: after fixing the data source, trace every component/function that READS the data. Ask for each consumer: "After my fix, does this consumer still get what it needs? Does it use the data for a different purpose than other consumers?" If two consumers need different subsets (e.g., a filter needs team-only, an assignment dropdown needs all-staff), they need separate data paths. Don't assume fixing the source fixes all consumers — verify each one.

**Rule 3 — Blast Radius: "If it's a bug here, where else is it a bug?"**: When you find a bug, it is almost never unique. The same class of bug exists elsewhere — in sibling functions, in other files in the same service directory, in validation code that trusts the same data. You MUST check the full blast radius BEFORE writing the contract.

**3a — Same-file siblings**: If the buggy function belongs to a group of similar functions in the same file (e.g., `searchSuppliers` alongside `searchOrders`, `searchProducts`...), check EVERY sibling for the same class of bug. Not "a few." ALL.

**3b — Cross-file siblings**: Search the ENTIRE service/module directory for functions that do the same logical operation. Example: `getStaffUsers()` in `helpers.js` returns user lists — does `getTeamMembers()` in `queries.js` have the same filter gap? Does `validateUserIds()` in `kanban.js` trust the same data without the same guards? Same directory = same blast radius.

**3c — Edge cases at boundaries**: For each bug, ask: "What happens at the edges?"
- What if the input is empty/null/undefined?
- What if the user is inactive/deleted/system?
- What if the data crosses a permission boundary?
- What if the same action is triggered by a different entry point (API vs kanban vs internal)?

**The trigger**: When you find a bug, run this blast radius scan:
1. `grep -r` the service directory for functions with similar names, similar SQL patterns, or similar data access
2. For each match: does it have the same guard/filter that was missing in the original bug?
3. Check validation functions that consume the same data — do they enforce the same constraints?
4. List ALL findings in the Bug Fix E2E Verification trace below

**Why this matters**: In A/B testing, enterprise found 1 bug in `getStaffUsers()` but missed the same filter gap in `getTeamMembers()` (different file) and a missing `is_active` check in `validateUserIds()` (different concern, same directory). The compound agent checked cross-file and found all 3. Enterprise's sibling check was limited to the current file — the blast radius is the entire module.

### Bug Fix E2E Verification

Before writing the contract, complete this trace:
```
BUG LOCATION: [where the wrong behavior is visible to the user]
  ← rendered by: [component, file:line]
  ← state from: [hook/store, file:line]
  ← fetched from: [API endpoint]
  ← queried by: [service function, file:line]
  ← ROOT CAUSE: [what's wrong and why]

AFFECTED CONSUMERS (everything that reads the buggy data):
  1. [consumer, purpose, file:line] — needs: [what it needs after fix]
  2. [consumer, purpose, file:line] — needs: [what it needs after fix]

BLAST RADIUS SCAN (mandatory — "if it's a bug here, where else is it a bug?"):

  Same-file siblings:
  1. [function name, file:line] — status: [OK | SAME BUG | DIFFERENT BUG]
  ... (list ALL)

  Cross-file siblings (same directory/module):
  1. [function name, file:line] — does same logical operation? [YES/NO] — has same guard? [YES/NO]
  ... (list ALL matches from grep scan)

  Validation/consumer functions that trust this data:
  1. [function name, file:line] — enforces same constraints? [YES/NO]
  ... (list ALL)

  Edge cases checked:
  - Empty/null input: [OK | BUG]
  - Inactive/deleted/system users: [OK | BUG]
  - Different entry points (API/kanban/internal): [OK | BUG]
  - Permission boundaries: [OK | BUG]
```

Every item in AFFECTED CONSUMERS becomes a postcondition. Every buggy SIBLING becomes a postcondition. Every postcondition becomes a test.

### Bug Fix TDD Sequence

Bug fixes are where TDD discipline gets skipped most — "I already found the root cause, let me just fix it." No. The sequence for bugs is:

1. Write a test that **reproduces the bug** (e.g., asserts the wrong behavior exists)
2. Run it — watch it PASS (proving the bug exists)
3. Invert the assertion to what the **correct** behavior should be
4. Run it — watch it FAIL (proving the fix hasn't been applied yet)
5. Write the fix
6. Run it — watch it PASS (proving the fix works)

This proves three things: the bug existed, the test catches it, and the fix resolves it.

---

## Context Preservation

If context fills before completion:
1. Save state to `docs/plans/YYYY-MM-DD-<slug>-handoff.md`
2. Save key decisions to memory (Memora/Muninn if available, else filesystem)
3. New session: read handoff, resume from next incomplete stage

The artifacts ARE the state — a new agent detects progress from the filesystem.

## Recovery

1. `git worktree list` — find the task's branch
2. Check artifacts: contract exists? stages 0-4 done. Review exists? stages 0-7 done.
3. Resume from first incomplete stage.

---

## Artifact Summary

| Stage | Artifact | Path |
|-------|----------|------|
| WORKTREE | Isolated branch | `.claude/worktrees/<slug>` |
| PLAN | Implementation plan (exact code) | `docs/plans/YYYY-MM-DD-<slug>-plan.md` |
| CONTRACT | Pre/postconditions + invariants | `docs/contracts/YYYY-MM-DD-<slug>-contract.md` |
| GUARD | Error strategy + failure classification | `docs/error-strategies/YYYY-MM-DD-<slug>.md` |
| BUILD | Code + tests (TDD) | Source files + conventional commits |
| REVIEW | Contract compliance checklist | `docs/reviews/YYYY-MM-DD-<slug>-review.md` |
| COMPLETE | Merged branch | Merged to dev, worktree removed |
