# Enterprise-Contract A/B Tournament Results

**Date**: 2026-03-14
**Outcome**: Challenger PROMOTED after iteration 3 (won 2/3)

## Final Metrics

| Metric | Champion (Before) | Challenger (After) |
|--------|-------------------|-------------------|
| SKILL.md lines | 589 | 181 |
| Reference files | 0 | 2 (bugfix-contract-template.md, quality-gate.md) |
| Total content (SKILL + refs) | 589 lines | ~310 lines |
| Reduction | — | 69% body, 47% total |

## Iteration Results

| Iteration | S1 API | S2 Bug Fix | S3 Complex | Winner |
|-----------|--------|------------|------------|--------|
| 1 | Challenger | Champion | Champion | Champion (1-2) |
| 2 | Challenger | Champion | Champion | Champion (1-2) |
| 3 | Challenger | Champion | Challenger | **Challenger (2-1)** |

## Key Improvements That Won

1. **Deliverable inventory checkpoint** (Step 6 of "Before You Start") — count every endpoint/table/component in the plan before writing PCs. This caught the S3 completeness gap where iteration 1-2 challengers missed the stats endpoint.

2. **Self-contained postcondition rows** — test names directly in the PC table, not just in the traceability matrix. Evaluators consistently preferred this.

3. **Inline expect() skeletons** — proving non-tautology with concrete test code. The champion described tautology checks but didn't mandate inline skeletons.

4. **Blast radius contraction rule** — "Never defer a buggy sibling as 'review required'" — contract it immediately. This was the S2 weakness in iterations 1-2 but the instruction still didn't fully eliminate deferral behavior.

5. **Why-based language** — "This matters because..." instead of "MUST" / "NON-NEGOTIABLE". Comparators never penalized the softer tone.

## What the Champion Did Better (Consistently)

- **Write site audit depth** in bug fix contracts — richer business context about why data diverges
- **Blast radius decisiveness** — contracted siblings immediately rather than deferring
- **Consumer map file:line precision** — more specific line number estimates

## Shared References Used

- `references/standards.md` (shared across all enterprise skills) — invariants INV-1 through INV-7
- `references/bugfix-contract-template.md` (new) — extracted bug fix contract template
- `references/quality-gate.md` (new) — extracted 11-check quality gate criteria
