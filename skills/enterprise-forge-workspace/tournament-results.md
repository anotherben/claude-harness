# Enterprise-Forge A/B Tournament Results

**Date**: 2026-03-14
**Outcome**: Challenger PROMOTED after iteration 2 (swept 3/3)

## Final Metrics

| Metric | Champion (Before) | Challenger (After) |
|--------|-------------------|-------------------|
| SKILL.md lines | 676 | 158 |
| Reference files | 0 | 2 (mechanical-checks.md, adversarial-lenses.md) |
| Total content | 676 lines | ~360 lines |
| Reduction | — | 77% body, 47% total |

## Iteration Results

| Iteration | S1 API | S2 Bug Fix | S3 Complex | Winner |
|-----------|--------|------------|------------|--------|
| 1 | Champion (9.3 vs 8.3) | Challenger (9.7 vs 7.7) | Champion (10.0 vs 7.7) | Champion (2-1) |
| 2 | **Challenger** (9.0 vs 9.0, tie→B) | **Challenger** (10.0 vs 9.0) | **Challenger** (10.0 vs 9.0) | **Challenger (3-0)** |

## What Fixed It (Iteration 1 → 2)

The challenger's iteration 1 failure was a single issue: **it found bugs but didn't close them**. Reports ended REJECTED with unfixed bugs or deferred HIGH severity issues as "architecture decisions."

The fix was one paragraph added to the Recycle Rule section:
> "The forge's job is to CLOSE bugs, not just find them. A forge report that lists unfixed bugs is incomplete work... Never defer a bug unless a circuit breaker has actually fired."

This eliminated the deferral behavior completely in iteration 2.

## What the Challenger Did Better

1. **More bugs found** — consistently found 1-3 more bugs per scenario (4 vs 3 in S1, 2 vs 2 in S2, 9 vs 7 in S3)
2. **Better bug classification** — escalated unbounded SELECTs and N+1 patterns to blocking bugs instead of non-blocking improvements
3. **Per-PC probe narratives** — auditable per-postcondition documentation (original test / probe angle / method / result)
4. **Full RED/GREEN evidence** — code snippets for every recycled bug, not just narrative descriptions
5. **Active re-probing** — re-probed forge-added PCs in subsequent iterations, finding second-order bugs
6. **Accurate failure tracker** — per-iteration counts instead of aggregate zeros

## What the Champion Did Better

1. **Richer presentation** — more detailed RED/GREEN code snippets in iteration 1
2. **Better scope discipline** — correctly identified pre-existing issues as out-of-scope for a targeted fix
3. **More adversarial lens findings** — produced more non-blocking improvement observations
