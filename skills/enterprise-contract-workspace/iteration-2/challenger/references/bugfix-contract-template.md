# Bug Fix Contract Template

Bug fix contracts emphasize root cause tracing and blast radius over feature specification. Use this template instead of the standard contract structure when the task is fixing a bug.

---

## Template

````markdown
# Contract: Fix [bug description]
**Date**: YYYY-MM-DD | **Status**: LOCKED
**Type**: BUG FIX

## Root Cause

Trace the bug from where it's visible back to the actual defect. Each arrow represents a dependency — the root cause is at the bottom.

```
BUG LOCATION: [where the wrong behavior is visible]
  <- rendered by: [component, file:line]
  <- state from: [hook/store, file:line]
  <- fetched from: [API endpoint]
  <- queried by: [service function, file:line]
  <- ROOT CAUSE: [what's wrong and why — exact code line]
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

Every "NO" becomes a postcondition.

## NOT in Scope

[What this fix does NOT change — critical for bug fixes to prevent drift]
````

---

## When to Use

Use this template when:
- The task is fixing existing broken behavior (not adding new behavior)
- There's a specific user-reported symptom to trace back
- The blast radius matters more than the feature specification

The key difference from a feature contract: bug fix contracts start with a root cause trace and include a write site audit. Feature contracts start with preconditions and emphasize consumer maps.
