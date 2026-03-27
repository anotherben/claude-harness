# Contract Quality Gate

Before locking any contract, verify it against these 11 objective checks. Every check is binary — PASS or FAIL. All 11 must pass before the contract can be locked.

---

## Checks

### 1. Testability
For each postcondition, write a skeleton `expect()` assertion. If you can't write one, the postcondition is too vague — rewrite it.

### 2. No Banned Words
```bash
grep -ciE 'should|probably|appropriate|reasonable|properly|correct' contract.md
```
Count must be 0. These words hide vague postconditions. Replace with specifics:
- "should handle errors properly" -> "returns 400 with `{ error: 'Category is required' }` when category is empty"
- "performs reasonably" -> "returns in <200ms with 1000 rows"

### 3. Completeness
Count plan tasks. Count postconditions. Every task in the plan must have at least one postcondition. `tasks_without_pc = 0`.

### 4. Consumer Coverage
Run:
```bash
grep -r "functionName\|endpointPath" apps/ --include="*.js" --include="*.jsx" -l
```
Compare results to the Consumer Map. Every consumer found by grep must appear in the map. Zero unlisted consumers.

### 5. Blast Radius
Same-file AND cross-file sibling sections must have specific function names and line numbers. "N/A — seems isolated" is never acceptable. Nothing is isolated — check both sections, always.

### 6. Error Coverage
Count external calls + user inputs in the plan. Count ERR-N entries. `err_count >= (external_calls + user_inputs)`.

### 7. Invariant Enforcement
All 7 standard invariants (INV-1 through INV-7 from `references/standards.md`) are listed. If one doesn't apply, mark it `N/A` with a brief justification.

### 8. Scope Boundary
At least 3 explicit "NOT in Scope" items. If you can't think of 3, you haven't fully understood the scope boundaries.

### 9. Traceability
Count postconditions. Count rows in traceability matrix. `matrix_rows == pc_count`. Zero orphans.

### 10. Tautology Check
For each postcondition's test skeleton: would the test STILL PASS if the feature were deleted? If yes, the postcondition is tautological — it proves nothing.

Examples:
```javascript
// TAUTOLOGICAL — passes even if createAlertConfig doesn't exist
test('creates alert config', () => {
  expect(true).toBe(true);
});

// ALSO TAUTOLOGICAL — any non-null return satisfies this
test('creates alert config', async () => {
  const result = await createAlertConfig(validPayload);
  expect(result).toBeDefined();
});

// NOT TAUTOLOGICAL — tests the specific postcondition
test('creates alert config', async () => {
  const result = await createAlertConfig(validPayload);
  expect(result.success).toBe(true);
  expect(result.id).toMatch(/^[0-9a-f-]+$/);
  expect(result.category).toBe('electronics');
});
```

### 11. Error Strategy
Error Handling Matrix has entries for each external call + user input. Transaction boundaries defined for multi-step operations. Zero unhandled operations.

---

## Score Format

```
CONTRACT QUALITY GATE
=====================
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

All 11 must pass. A contract that fails quality gate cannot be locked. An unlocked contract blocks the build phase.
