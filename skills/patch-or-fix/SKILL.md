---
name: patch-or-fix
description: >
  Evaluates whether a bug fix addresses the root cause or just patches the symptom, then
  writes the real fix with actual code. Use after writing a bug fix plan (catch patches before
  wasting effort), or after a vibe-style fix with no plan (mandatory review). Triggers on
  bug fixes, fix PRs, null checks, try/catch wrappers, retry logic, or "fixed it" claims.
---

# Patch or Fix?

A patch changes what happens when things go wrong. A fix changes why things go wrong.
**We don't ship patches. We ship fixes.**

## The Rule

When you find a patch, your job is not to label it. Your job is to **write the fix**.
Real files. Real line numbers. Real code a developer can PR right now.

A verdict without a fix is just criticism. Criticism is cheap. Fixes are valuable.

## Step 1: Read the Code

Before you judge anything, **read the actual code**. Not the description. Not the PR title.
The code.

- Read the files that were changed (or would be changed)
- Read the surrounding context — what's upstream, what's downstream
- Search for existing patterns and utilities the fix should be using
- Search for other instances of the same bug — if one query is broken, others might be too

Skip this step and your verdict is theoretical. Do this step and your verdict has teeth.

## Step 2: Trace the Chain

Map the path from symptom to root cause:

```
Symptom: Orders showing wrong totals
  ^ caused by: Frontend displaying cents instead of dollars
    ^ caused by: API returning cents (changed in v2.3)
      ^ caused by: Migration changed column, nobody updated serializer
        ^ ROOT: No coupling between schema changes and API contract
```

If the chain has an `[UNKNOWN]` in it — stop. You can't fix what you haven't diagnosed.
Say so: **"Root cause is undiagnosed. Diagnose first."**

## Step 3: Classify

One question matters: **does this change target the symptom or the cause?**

Quick signals:
- Could you remove this change if the root cause were properly fixed? → **Patch**
- If the same root cause produces a different symptom tomorrow, does this help? No → **Patch**
- Does this add a guard/check/fallback? → Probably a **patch**. Why is the data bad?
- Does this correct the source of bad data/state? → Probably a **fix**

### Patch Disguises

These look like fixes but aren't:
- `user?.email` → Still a null guard. Why is user null on a page requiring auth?
- `try/catch` with fallback → What's throwing? Fix that.
- Retry with backoff → Why does it fail? Hoping it's transient isn't engineering.
- Default/fallback value → Why is the real value missing?
- Data backfill without fixing the source → What created the bad data?
- Loading spinner / "please wait" → UX enhancement, not a fix. The bug is still there.
- Right diagnosis, wrong fix → Correct problem identified, implementation doesn't actually solve it.

**Harmful patches**: If a patch **destroys diagnostic signal** (try/catch swallowing errors,
fallback hiding data corruption, "Unknown" masking missing data), flag it as **HARMFUL PATCH**.
Recommend reverting before any other work. The first fix is undoing the damage.

### Proportionality

A fix can address the root cause and still be wrong — if it's a microservice for a one-line bug.
If the fix is wildly disproportionate, flag **OVERENGINEERED** and provide the simpler alternative.

## Step 4: Write the Verdict

**Fix first, label second.** The fix is the product. The label is metadata.

---

### If it's a PATCH:

```markdown
## The Fix

**Root cause**: [file_path:line — what's actually wrong and why]

**Changes**:

**1. [file_path:line_number]** — [what and why]
\```[lang]
// Before (the patch):
[patch code]

// After (the fix):
[fix code — real, complete, implementable]
\```

**2. [file_path:line_number]** — [if more changes needed]
\```[lang]
[code]
\```

**Why this is a fix**: [1 sentence — what root cause is eliminated]
**What this prevents**: [what future variants become impossible]

---

## Verdict: PATCH

**Bug**: [one line]
**What the patch does**: [one line]
**Why it's a patch**: [2-3 sentences referencing the causal chain]
**Root cause**: [what actually caused the bug]
```

The fix code must be:
- **Real** — actual files, actual lines, actual function names from the codebase
- **Complete** — not "add validation here" but the actual validation code
- **Implementable** — copy it, make a PR, ship it
- **Minimal** — smallest change that kills the root cause

---

### If it's a PARTIAL FIX:

```markdown
## Completing the Fix

**What's already fixed**: [the part addressing root cause]
**What's still patched**: [the part that's just guarded/compensated]

**Changes to complete**:
[Same format — real code, real files, real lines]

---

## Verdict: PARTIAL FIX
[Standard verdict fields]
```

---

### If it's a FIX:

```markdown
## Verdict: FIX

**Bug**: [one line]
**What the fix does**: [one line]
**Root cause**: [what caused it]
**Root cause addressed**: Yes
```

If a world-class engineer would do it differently (use an existing utility, follow an
established codebase pattern), add:

```markdown
## Better Fix

[The improved approach with code]
```

---

### If root cause is unknown:

```markdown
## Verdict: UNDIAGNOSED

**Bug**: [one line]
**Root cause**: Unknown — the proposed change cannot be evaluated as a fix or patch
because nobody knows what's actually wrong.
**Next step**: Diagnose first using `but-why` or systematic debugging. Then come back.
```

---

### Systemic patterns (append if found):

```markdown
## Systemic Pattern

**Pattern**: [what broader issue this bug is an instance of]
**Other locations**: [files/endpoints with the same problem]
**Systemic fix**: [what would fix the pattern, not just this instance]
```

## Shipping Patches

The default answer is **no**. You've already written the fix — it's right there.

> "The fix is [N] lines in [file]. The patch is [M] lines. Why ship the patch?"

If there's a genuine reason (production is down, fix needs a migration that can't run now):
1. Ship the patch with: `// PATCH: [root cause]. Fix: [ticket link]`
2. Create a ticket with the fix code from this verdict
3. Set a deadline — patches without deadlines become permanent

## The Standard

A world-class engineer doesn't ship `user?.email`. They fix the auth guard.
And they write the code to prove it.
