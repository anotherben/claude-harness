---
name: enterprise-forge
description: "Adversarial code review with mechanical checks, contract probing, and 5 adversarial lenses. Bugs recycle to contract for full TDD treatment. 3-fail circuit breaker prevents infinite loops. Use after enterprise-review."
---

# Enterprise Forge

You are the adversarial tester — the last line of defense before code ships. Your job is to break things. You assume the code is guilty until proven innocent. Three weapons: mechanical checks that produce binary PASS/FAIL, contract probing that tests from unexpected angles, and adversarial lenses that stress-test the design.

---

## THE RECYCLE RULE

```
Any BUG found by the forge becomes a new postcondition in the contract.
That postcondition gets full TDD treatment: RED test → GREEN implementation.
Then the forge re-runs. Loop exits when forge finds 0 bugs.
```

### Recycle Loop Limits (NON-NEGOTIABLE)

The recycle loop has TWO independent safeguards:

**1. RECYCLE CAP: Maximum 5 recycles per forge run.**
After 5 recycles, STOP regardless of remaining bugs. Report the remaining bugs as known issues and escalate.

**2. MONOTONIC PROGRESS: Each recycle must reduce total bug count.**
Track bugs found per iteration:
```
Iteration 1: 4 bugs found
Iteration 2: 2 bugs found ✓ (reduced from 4)
Iteration 3: 3 bugs found ✗ STOP — bug count increased
```
If bug count increases or stays the same: STOP. The fixes are introducing new bugs — this is an architectural problem, not an implementation problem.

**3. CIRCUIT BREAKER: Same check fails 3 times → architectural escalation.**
This is separate from the recycle cap. If M1 (import resolution) fails 3 times across iterations, the problem isn't missing files — it's a structural issue with how modules are organized.

```
Recycle Tracker (persisted in JSON — survives context compression):
- Iteration: 1/5
- Bugs this iteration: [N]
- Bugs last iteration: [N/A for first]
- Progress: [IMPROVING / STALLED / REGRESSING]
- Circuit breaker status: read from `.claude/enterprise-state/<slug>.json`

At each recycle iteration START, read and update circuit breaker state:
```bash
node -e "
  const fs = require('fs');
  const f = '.claude/enterprise-state/<slug>.json';
  const s = JSON.parse(fs.readFileSync(f));
  // Read current state
  console.log('Forge iterations:', s.circuit_breakers.forge_iterations, '/', s.circuit_breakers.forge_max);
  console.log('Per-check failures:', JSON.stringify(s.circuit_breakers.forge_per_check_failures));
  // Increment iteration
  s.circuit_breakers.forge_iterations++;
  fs.writeFileSync(f, JSON.stringify(s, null, 2));
"
```

At each check FAILURE, increment that check's failure counter:
```bash
node -e "
  const fs = require('fs');
  const f = '.claude/enterprise-state/<slug>.json';
  const s = JSON.parse(fs.readFileSync(f));
  const check = '<check_name>';  // e.g., 'M1', 'M2', etc.
  s.circuit_breakers.forge_per_check_failures[check] = (s.circuit_breakers.forge_per_check_failures[check] || 0) + 1;
  if (s.circuit_breakers.forge_per_check_failures[check] >= 3) {
    console.log('CIRCUIT BREAKER TRIGGERED: ' + check + ' failed 3 times');
  }
  fs.writeFileSync(f, JSON.stringify(s, null, 2));
"
```

This state persists across context compressions and session boundaries. A new agent resuming mid-forge will see the correct iteration count and failure history.
```

**Why two safeguards?** The circuit breaker catches repeat failures on the SAME check. The recycle cap catches the total loop length. The monotonic progress rule catches flaky/oscillating failures where different bugs appear each time. Together they prevent the three failure modes: infinite loop, oscillating loop, and architectural mismatch.

---

## PREREQUISITES

Before forging:

1. **Verify upstream artifacts exist**:
   ```bash
   # Review report must exist and show PASS
   REVIEW=$(ls docs/reviews/*review* 2>/dev/null | head -1)
   if [ -z "$REVIEW" ]; then
     echo "BLOCKED: No review report found. Run /enterprise-review first."
   fi
   grep -q "PASS" "$REVIEW" 2>/dev/null || echo "BLOCKED: Review report does not show PASS."
   ```
   **If either check fails: STOP.** Do not forge unreviewed code.

2. **Confirm enterprise-review passed** — forge runs AFTER review, not instead of it
3. **Locate the contract** — `docs/contracts/` or `.claude/designs/`
4. **Locate the plan** — `docs/plans/`
5. **Identify the base branch** — typically `dev`
6. **Get list of changed files:**
   ```bash
   cd /home/clawdbot/clawd/cortex
   git diff --name-only <base-branch>...HEAD
   ```

---

## PART 1: MECHANICAL CHECKS

Each check is a command that produces PASS or FAIL. No judgment calls — purely mechanical.

### M1: Import Resolution

Every `require()` and `import` in changed files must resolve to a real file.

```bash
cd /home/clawdbot/clawd/cortex
FAIL=0
for f in $(git diff --name-only <base-branch>...HEAD | grep -E '\.(js|jsx|ts|tsx)$' | grep -v node_modules); do
  [ -f "$f" ] || continue
  grep -n "require(" "$f" 2>/dev/null | grep -oP "require\(['\"](\./[^'\"]+)" | sed "s/require(['\"//" | while read -r mod; do
    dir=$(dirname "$f")
    resolved="$dir/$mod"
    if [ ! -f "$resolved" ] && [ ! -f "${resolved}.js" ] && [ ! -f "${resolved}.jsx" ] && [ ! -f "${resolved}/index.js" ]; then
      echo "M1 FAIL: $f imports '$mod' — file not found"
      FAIL=1
    fi
  done
done
echo "M1: $([ $FAIL -eq 0 ] && echo 'PASS' || echo 'FAIL')"
```

### M2: Uncommitted Files

No orphaned source files that should be tracked but aren't.

```bash
cd /home/clawdbot/clawd/cortex
# Check for untracked .js/.jsx/.ts/.tsx files in the working tree
UNTRACKED=$(git ls-files --others --exclude-standard | grep -E '\.(js|jsx|ts|tsx|sql)$' | grep -v node_modules | grep -v dist | grep -v build)
if [ -z "$UNTRACKED" ]; then
  echo "M2: PASS"
else
  echo "M2: FAIL — untracked source files:"
  echo "$UNTRACKED"
fi
```

### M3: Dead Exports

Exports from changed files that nothing imports.

```bash
cd /home/clawdbot/clawd/cortex
for f in $(git diff --name-only <base-branch>...HEAD | grep -E '\.js$' | grep -v __tests__ | grep -v '\.test\.' | grep -v '\.spec\.'); do
  [ -f "$f" ] || continue
  # Get exported names
  grep -oP '(module\.exports\s*=\s*\{[^}]+\}|exports\.\w+|module\.exports\s*=\s*\w+)' "$f" 2>/dev/null | while read -r export_line; do
    # Extract individual export names
    echo "$export_line" | grep -oP '\b\w+\b' | grep -v module | grep -v exports | while read -r name; do
      # Search for usage in other files
      count=$(grep -rn "$name" apps/api/src/ --include="*.js" -l 2>/dev/null | grep -v "$f" | grep -v node_modules | wc -l)
      if [ "$count" -eq 0 ]; then
        echo "M3 FLAG: '$name' exported from $f — no importers found"
      fi
    done
  done
done
echo "M3: review above flags (false positives possible for dynamic imports)"
```

### M4: Contract Crosscheck

Every postcondition in the contract has a passing test.

```bash
cd /home/clawdbot/clawd/cortex/apps/api

# Run tests and check results
npx jest --passWithNoTests 2>&1 | tail -30

# Then manually verify: for each PC-X in the contract,
# grep for the postcondition text or ID in test files
grep -rn "PC-" src/__tests__/ --include="*.js" | head -20
```

For EACH postcondition:
- Is there a test? (grep for PC identifier or postcondition description)
- Does the test pass?
- Does the test actually exercise the postcondition (not just exist)?

### M5: Debug Artifacts

No debug code in production files.

```bash
cd /home/clawdbot/clawd/cortex
FAIL=0
for f in $(git diff --name-only <base-branch>...HEAD | grep -E '\.js$' | grep -v __tests__ | grep -v '\.test\.' | grep -v '\.spec\.'); do
  [ -f "$f" ] || continue
  # Only check ADDED lines (not existing code)
  HITS=$(git diff <base-branch>...HEAD -- "$f" | grep "^+" | grep -v "^+++" | grep -cE "(console\.(log|debug)|debugger\b)")
  if [ "$HITS" -gt 0 ]; then
    echo "M5 FAIL: $f has $HITS debug artifacts in new code:"
    git diff <base-branch>...HEAD -- "$f" | grep "^+" | grep -nE "(console\.(log|debug)|debugger\b)"
    FAIL=1
  fi
done
echo "M5: $([ $FAIL -eq 0 ] && echo 'PASS' || echo 'FAIL')"
```

### M6: Tenant Isolation

Every new query in changed files scopes to `tenant_id`.

```bash
cd /home/clawdbot/clawd/cortex
FAIL=0
for f in $(git diff --name-only <base-branch>...HEAD | grep -E '\.js$' | grep -v __tests__ | grep -v '\.test\.' | grep -v '\.spec\.'); do
  [ -f "$f" ] || continue
  # Find new SQL statements
  git diff <base-branch>...HEAD -- "$f" | grep "^+" | grep -v "^+++" | grep -iE "(SELECT .* FROM|INSERT INTO|UPDATE .* SET|DELETE FROM)" | while read -r line; do
    # Check if tenant_id is present (skip customers table which has no tenant_id)
    if ! echo "$line" | grep -qi "tenant_id" && ! echo "$line" | grep -qi "customers"; then
      echo "M6 FLAG: $f — query may lack tenant_id:"
      echo "  $line"
      FAIL=1
    fi
  done
done
echo "M6: $([ $FAIL -eq 0 ] && echo 'PASS' || echo 'review flags above')"
```

### M7: Concurrency Check

No unguarded shared state mutations — look for module-level mutable state.

```bash
cd /home/clawdbot/clawd/cortex
for f in $(git diff --name-only <base-branch>...HEAD | grep -E '\.js$' | grep -v __tests__ | grep -v '\.test\.' | grep -v '\.spec\.'); do
  [ -f "$f" ] || continue
  # Find module-level let/var declarations (potential shared mutable state)
  git diff <base-branch>...HEAD -- "$f" | grep "^+" | grep -v "^+++" | grep -E "^.(let|var)\s+\w+\s*=" | while read -r line; do
    echo "M7 FLAG: $f — module-level mutable state:"
    echo "  $line"
  done
done
echo "M7: review above flags (module-level let/var may indicate shared mutable state)"
```

### Mechanical Checks Summary Template

```
╔═══════════════════════════════════════════╗
║       PART 1: MECHANICAL CHECKS          ║
╠═══════════════════════════════════════════╣
║ M1 Import Resolution:    [PASS/FAIL]     ║
║ M2 Uncommitted Files:    [PASS/FAIL]     ║
║ M3 Dead Exports:         [PASS/FLAG]     ║
║ M4 Contract Crosscheck:  [PASS/FAIL]     ║
║ M5 Debug Artifacts:      [PASS/FAIL]     ║
║ M6 Tenant Isolation:     [PASS/FAIL]     ║
║ M7 Concurrency Check:    [PASS/FLAG]     ║
╠═══════════════════════════════════════════╣
║ MECHANICAL VERDICT:      [PASS/FAIL]     ║
╚═══════════════════════════════════════════╝
```

**Any FAIL in M1, M2, M4, M5 = MECHANICAL FAIL.** Stop and fix before proceeding.
M3, M6, M7 produce FLAGS that require human judgment — review each flag.

---

## PART 2: CONTRACT PROBING

For each postcondition, test it from an ANGLE THE ORIGINAL TEST DID NOT COVER. The goal: find gaps between what the test proves and what the postcondition promises.

### Probing Strategy Matrix

| Original Test Type | Probe Angle | What You're Looking For |
|-------------------|-------------|------------------------|
| Unit test with mocks | Does the SQL actually return this from real DB? | Mock hides a real query bug |
| Happy path only | What about empty result / null input / zero rows? | Missing edge case |
| API response test | Does the frontend actually USE the returned field? | Dead fields, wrong shape |
| Insert/update test | Does the data survive a round-trip (write → read → verify)? | Silent truncation, type coercion |
| Permission test | What about a user with the WRONG role? | Missing denial path |
| Validation test | What about a value at the exact boundary? | Off-by-one in validation |

### Probing Procedure

For EACH postcondition (PC-X):

```
PC-X: [postcondition text]
├── Original test: [describe what the existing test does]
├── Probe angle: [which angle from the matrix above]
├── Probe test: [describe what you will test]
├── Probe result: PASS / BUG
│   └── If BUG:
│       ├── Description: [what broke]
│       ├── Root cause: [why it broke]
│       └── New PC: PC-X.1 [new postcondition to add to contract]
└── Status: CLEAR / RECYCLED
```

### Writing Probe Tests

```bash
# Run a specific probe test
cd /home/clawdbot/clawd/cortex/apps/api
npx jest --testPathPattern="<test-file>" --testNamePattern="<probe-test-name>" 2>&1
```

Probe tests go in the SAME test file as the original tests, clearly marked:

```javascript
// === FORGE PROBES ===

describe('PC-X probe: empty result', () => {
  it('should return empty array when no records match', async () => {
    // Probe: original test always has data, what about zero rows?
    const result = await someFunction({ tenantId, filters: { impossible: true } });
    expect(result).toEqual([]);
  });
});
```

### Contract Probing Summary Template

```
╔═══════════════════════════════════════════╗
║       PART 2: CONTRACT PROBING           ║
╠═══════════════════════════════════════════╣
║ PC-1: [CLEAR/RECYCLED]                   ║
║ PC-2: [CLEAR/RECYCLED]                   ║
║ PC-3: [CLEAR/RECYCLED]                   ║
║ ...                                      ║
╠═══════════════════════════════════════════╣
║ Bugs found: N                            ║
║ New PCs added: N                         ║
║ PROBING VERDICT: [CLEAR/RECYCLE]         ║
╚═══════════════════════════════════════════╝
```

---

## PART 3: ADVERSARIAL LENSES

Five lenses, each asking a different "what if" question. These are qualitative — they produce findings, not PASS/FAIL.

### Lens 1: The 3AM Test

> Can the on-call engineer diagnose a failure from logs alone at 3AM?

Questions to answer:
- Does every error path log enough context? (what was the input, what was expected, what actually happened)
- Are error messages specific enough to identify the failing component?
- Is there a clear trail from symptom to root cause in logs?
- Would you know which query failed, with which parameters?

```bash
# Check error handling in changed files
cd /home/clawdbot/clawd/cortex
for f in $(git diff --name-only <base-branch>...HEAD | grep -E '\.js$' | grep -v __tests__); do
  [ -f "$f" ] || continue
  echo "=== $f ==="
  # Find catch blocks and check if they log context
  grep -n -A3 "catch" "$f" | head -30
done
```

**Finding template:**
```
3AM-X: [error path] in [file:line]
  Problem: [what's missing from the log]
  Impact: on-call sees "[vague error]" and has no idea what tenant/record caused it
  Fix: add [specific context] to the error log
```

### Lens 2: The Delete Test

> What can I remove and nothing breaks?

Questions to answer:
- Are there unused variables, imports, or functions in the diff?
- Are there code paths that can never execute?
- Are there config options that have no effect?
- Are there defensive checks that duplicate checks already done upstream?

```bash
# Find potentially dead code in changed files
cd /home/clawdbot/clawd/cortex
for f in $(git diff --name-only <base-branch>...HEAD | grep -E '\.js$' | grep -v __tests__); do
  [ -f "$f" ] || continue
  echo "=== $f ==="
  # Variables declared but potentially unused
  grep -n "const \|let \|var " "$f" | while read -r line; do
    varname=$(echo "$line" | grep -oP '(const|let|var)\s+(\w+)' | awk '{print $2}')
    if [ -n "$varname" ]; then
      count=$(grep -c "\b$varname\b" "$f" 2>/dev/null)
      if [ "$count" -le 1 ]; then
        echo "  UNUSED? $line"
      fi
    fi
  done
done
```

### Lens 3: The New Hire Test

> Will someone understand this in 6 months with no context?

Questions to answer:
- Are there magic numbers without explanation?
- Are variable names descriptive enough?
- Are complex business rules documented?
- Would the data flow be clear from reading the code top-to-bottom?
- Are there implicit assumptions that should be explicit?

**Finding template:**
```
NEWHIRE-X: [code section] in [file:line]
  Confusion risk: [what would confuse someone]
  Fix: [add comment / rename variable / extract named constant]
```

### Lens 4: The Adversary Test

> How would I break this?

Questions to answer:
- What inputs would cause unexpected behavior? (null, undefined, empty string, huge arrays, negative numbers)
- Can I bypass validation by calling the service directly (skipping the route)?
- Can I access another tenant's data by manipulating IDs?
- Can I cause a partial write with no rollback (transaction safety)?
- Can I trigger a race condition with concurrent requests?

```bash
# Check for transaction usage in database operations
cd /home/clawdbot/clawd/cortex
for f in $(git diff --name-only <base-branch>...HEAD | grep -E '\.js$' | grep -v __tests__); do
  [ -f "$f" ] || continue
  HAS_MULTI_QUERY=$(grep -c "pool\.\|db\.\|query(" "$f" 2>/dev/null)
  HAS_TRANSACTION=$(grep -c "BEGIN\|COMMIT\|ROLLBACK\|transaction" "$f" 2>/dev/null)
  if [ "$HAS_MULTI_QUERY" -gt 2 ] && [ "$HAS_TRANSACTION" -eq 0 ]; then
    echo "ADVERSARY FLAG: $f has $HAS_MULTI_QUERY queries but no transaction"
  fi
done
```

**Finding template:**
```
ADVERSARY-X: [attack vector]
  Target: [file:line]
  Steps: [how to exploit]
  Impact: [what breaks]
  Fix: [specific mitigation]
```

### Lens 5: The Scale Test

> What happens at 10x / 100x / 1000x?

Questions to answer:
- Are there N+1 query patterns? (query in a loop)
- Are there unbounded SELECT queries? (no LIMIT)
- Are there in-memory aggregations that should be SQL aggregations?
- Would this work with 10,000 rows? 100,000 rows?
- Are there missing indexes on columns used in WHERE/JOIN?

```bash
# Find potential N+1 patterns and unbounded queries
cd /home/clawdbot/clawd/cortex
for f in $(git diff --name-only <base-branch>...HEAD | grep -E '\.js$' | grep -v __tests__); do
  [ -f "$f" ] || continue
  echo "=== $f ==="
  # Queries inside loops
  grep -n "for\|while\|forEach\|\.map(" "$f" | head -5
  # Unbounded SELECT
  grep -n "SELECT" "$f" | grep -v "LIMIT" | grep -v "WHERE.*id\s*=" | head -5
done
```

**Finding template:**
```
SCALE-X: [scaling concern]
  Location: [file:line]
  Current behavior: [what it does now]
  At 10x: [what happens]
  At 100x: [what happens]
  At 1000x: [what happens]
  Fix: [add LIMIT / add index / batch / use SQL aggregation]
```

### Adversarial Lenses Summary Template

```
╔═══════════════════════════════════════════╗
║       PART 3: ADVERSARIAL LENSES         ║
╠═══════════════════════════════════════════╣
║ Lens 1 (3AM):       N findings           ║
║ Lens 2 (Delete):    N findings           ║
║ Lens 3 (New Hire):  N findings           ║
║ Lens 4 (Adversary): N findings           ║
║ Lens 5 (Scale):     N findings           ║
╠═══════════════════════════════════════════╣
║ Total findings: N                        ║
║ Bugs (require recycle): N                ║
║ Improvements (optional): N              ║
╚═══════════════════════════════════════════╝
```

---

## THE RECYCLE LOOP

When bugs are found:

```
1. Bug found by forge — log bug count for this iteration
2. Compare to previous iteration: is bug count lower? If not → STOP (regression)
3. Check iteration counter: is this iteration 5+? If yes → STOP (cap reached)
4. Write new postcondition: PC-X.N (appended to contract)
4.5. Update postcondition registry JSON:
```bash
node -e "
  const fs = require('fs');
  const f = '.claude/enterprise-state/<slug>-postconditions.json';
  const r = JSON.parse(fs.readFileSync(f));
  r.postconditions.push({
    id: 'PC-X.N',
    text: '<new postcondition text>',
    test_file: '<test file>',
    test_name: '<test name>',
    passes: false,
    last_verified: null,
    added_by: 'forge',
    iteration: <N>
  });
  fs.writeFileSync(f, JSON.stringify(r, null, 2));
"
```
5. Write RED test for new PC (test must FAIL against current code)
6. Write GREEN implementation (minimal code to pass)
7. Run full test suite — all tests must pass
8. Re-run forge (increment iteration counter)
9. If same check fails again → increment that check's failure counter
10. If any check's failure counter reaches 3 → CIRCUIT BREAK
```

**Exit conditions (any one triggers STOP):**
- Bug count = 0 → EXIT: FORGED (success)
- Iteration count >= 5 → EXIT: CAP REACHED (report remaining bugs)
- Bug count >= previous iteration's bug count → EXIT: REGRESSION (fixes introducing new bugs)
- Any check fails 3 times → EXIT: CIRCUIT BREAK (architectural problem)

### Circuit Breaker Protocol

```
╔═══════════════════════════════════════════╗
║         CIRCUIT BREAKER TRIGGERED        ║
╠═══════════════════════════════════════════╣
║ Check: [which check failed 3x]           ║
║ Pattern: [what keeps failing]            ║
║                                          ║
║ DIAGNOSIS:                               ║
║ [Why does this keep failing? Is it an    ║
║  architectural problem?]                 ║
║                                          ║
║ RECOMMENDATION:                          ║
║ [Restructure / redesign / accept risk]   ║
║                                          ║
║ ACTION: Escalate to architect.           ║
║ Forge is PAUSED until architecture       ║
║ decision is made.                        ║
╚═══════════════════════════════════════════╝
```

---

## FINAL FORGE REPORT

Save to: `docs/reviews/YYYY-MM-DD-<slug>-forge.md`

```markdown
# Forge Report: <Feature Slug>

**Date:** YYYY-MM-DD
**Contract:** <path to contract>
**Review:** <path to review report>
**Forge iterations:** N

## Part 1: Mechanical Checks

| Check | Result | Details |
|-------|--------|---------|
| M1 Import Resolution | PASS/FAIL | ... |
| M2 Uncommitted Files | PASS/FAIL | ... |
| M3 Dead Exports | PASS/FLAG | ... |
| M4 Contract Crosscheck | PASS/FAIL | ... |
| M5 Debug Artifacts | PASS/FAIL | ... |
| M6 Tenant Isolation | PASS/FAIL | ... |
| M7 Concurrency Check | PASS/FLAG | ... |

## Part 2: Contract Probing

| PC | Original Test | Probe Angle | Result | New PC |
|----|--------------|-------------|--------|--------|
| PC-1 | [description] | [angle] | CLEAR/BUG | PC-1.1 |
| ... | ... | ... | ... | ... |

## Part 3: Adversarial Lenses

### 3AM Test
- [findings]

### Delete Test
- [findings]

### New Hire Test
- [findings]

### Adversary Test
- [findings]

### Scale Test
- [findings]

## Recycle Log

| Iteration | Bug | New PC | RED | GREEN | Re-forge |
|-----------|-----|--------|-----|-------|----------|
| 1 | [bug description] | PC-X.1 | FAIL confirmed | PASS | re-ran |
| ... | ... | ... | ... | ... | ... |

## Failure Tracker

| Check | Failures | Status |
|-------|----------|--------|
| M1 | 0/3 | OK |
| M2 | 0/3 | OK |
| ... | ... | ... |

## Final Verdict

**Forge iterations:** N
**Bugs found and recycled:** N
**Circuit breakers triggered:** N
**Outstanding findings (non-blocking):** N

**VERDICT: [FORGED / REJECTED / CIRCUIT BREAK]**

- FORGED: All mechanical checks pass, all probes clear, no blocking findings.
- REJECTED: Mechanical failures or blocking bugs remain.
- CIRCUIT BREAK: Architecture issue detected, escalated.
```

---

## FORGE WORKFLOW

```
1. Confirm enterprise-review PASSED
2. Run Part 1: Mechanical Checks
   └── Any hard FAIL? → STOP. Fix and re-run Part 1.
3. Run Part 2: Contract Probing
   └── Bugs found? → RECYCLE (new PC → RED → GREEN → re-forge)
4. Run Part 3: Adversarial Lenses
   └── Bugs found? → RECYCLE
   └── Findings (non-blocking)? → Log in report
5. All clear? → Write forge report → FORGED
6. Circuit breaker? → Escalate → PAUSED
```
