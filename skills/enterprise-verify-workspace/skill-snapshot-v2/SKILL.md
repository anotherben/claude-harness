---
name: enterprise-verify
description: "Evidence-based verification before any completion claim. No 'should work' or 'probably fine' — paste fresh test output or don't claim done. 7-check verification sequence. Use before committing or claiming work is complete."
---

# Enterprise Verify — Evidence-Based Completion Verification

## Why Evidence Matters

Without verification evidence, completion claims are beliefs — and beliefs ship bugs. "The code looks correct" means nothing when an import path is wrong, a test is silently skipped, or a debug `console.log` made it into the diff. The verification sequence exists because every category of missed check has caused a production incident at least once.

The distinction is simple: **evidence** is command output you can paste. **Belief** is anything else. This skill deals only in evidence.

---

## The 7-Check Verification Sequence

Run all 7 checks in order. Each produces PASS or FAIL with pasted evidence. See `references/verification-checks.md` for the full commands, templates, and scripts for each check.

| Check | What It Verifies | When to Skip |
|-------|-----------------|-------------|
| 1. Test Suite | All tests pass after your changes | Never |
| 2. Postcondition Trace | Every PC maps to a passing test | Never |
| 3. Regression Check | No existing tests broke | Never |
| 4. Build Verification | Frontend builds successfully | Backend-only changes |
| 5. Final Diff | Only expected files changed, no drift | Never |
| 6. Import Resolution | All imports resolve to real files | Never |
| 7. Debug Artifacts | No console.log/debugger in production code | Never |

If any check fails: stop, fix, re-run check 1 (to confirm the fix didn't break something else), then continue the sequence.

---

## Language That Signals Missing Evidence

These phrases typically appear right before an unverified completion claim. If you catch yourself reaching for one, it means you haven't run the checks yet:

- "should work" / "probably fine" / "seems to" → run the tests, paste the output
- "looks good" / "looks correct" → run the checks, report evidence
- "I'm confident" / "I believe" → confidence isn't evidence, output is
- "this fixes the issue" → paste the test that proves it

This isn't about policing language — it's about catching the moment where you're about to claim done without proof. That moment is where bugs ship.

---

## When to Run Verification

| Trigger | Action |
|---------|--------|
| About to say "it's done" | Run all 7 checks first |
| About to commit | Run all 7 checks first |
| About to create a PR | Run all 7 checks first |
| "One more thing" was fixed | Re-run ALL 7 checks from scratch |
| Someone asks "is it working?" | Run verification, report evidence |

---

## Failure Recovery

When a check fails:
1. Fix the issue — do not proceed with failures
2. Re-run the failed check — confirm it passes
3. Re-run check 1 (test suite) — confirm the fix didn't break anything else
4. Continue the sequence from where you left off
5. If check 1 fails after a fix: you introduced a regression — revert and try again

---

## Persisting Results (JSON)

After verification, append results to `.claude/enterprise-state/<slug>-verification.json`. This creates an audit trail — failed attempts remain visible to future sessions, preventing "verification amnesia" where a new context doesn't know about prior failures.

Also update `.claude/enterprise-state/<slug>.json` to mark the verify stage complete or failed.

---

## The Completion Gate

You may claim completion only when:
1. All 7 checks show PASS (or SKIPPED with valid reason)
2. The verification report is printed with pasted evidence
3. The report includes: test counts, postcondition map, git diff --stat, and any failure recovery log

**Valid**: "Verification complete. All 7 checks passed. 42 tests passing, 14/14 postconditions verified, no regressions, no drift, all imports resolve, no debug artifacts. Report above."

**Invalid**: "I think this should work now. The code looks correct."

The difference: evidence vs. belief.

---

## Edge Cases

**No formal contract?** Derive postconditions from the task description. "Fix stock quantities on product detail page" implies: correct values display, no other fields broke, edge cases (zero/null stock) handled.

**Only one file changed?** Still run all 7 checks. A one-line change can break the test suite, introduce a regression, or leave a debug artifact.

**Test suite takes too long?** Run targeted tests first for rapid feedback, then the full suite for regression coverage. Both must pass — targeted doesn't replace full.
