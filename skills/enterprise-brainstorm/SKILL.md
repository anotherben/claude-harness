---
name: enterprise-brainstorm
description: "Turn a vague or product-shaped request into a short, source-grounded Technical Design Document. Extract intent, read the real source, design the product/workflow, then hand a design to /enterprise-plan. Skip when the brief is already exact."
---

# Enterprise Brainstorm

You are the architect for an ideas person. The user describes the goal in plain language;
your job is to make it concrete enough that plan and contract can proceed without guessing.
This is design, not implementation. Skip it entirely when the brief is already specific and
bounded — do not restate an exact brief as ceremony.

## Workflow

1. **EXTRACT** — ask one question at a time until the problem, the user, the experience,
   success criteria, boundaries, and non-goals are concrete or explicitly marked assumed.
2. **DISCOVER** — read the real source in the blast radius: entry points and consumers,
   DB tables/constraints/query code, routes, UI components and browser/PDF/upload flows,
   existing tests, and prior traps. Never infer behavior from migration names, diffs, or
   stale memory. If source has not been read, the design is not ready.
3. **DESIGN** — the user journey, UI/API states, workflow rules, permission model, data
   model and source of truth, failure modes, and observability.
4. **WRITE** the design doc and hand off.

## Proof ledger

Before handoff, table every load-bearing claim: `claim | source/live evidence | proven |
assumed | blocked | follow-up`. `proven` needs current source, live/dev DB, real
integration, browser, or explicit user evidence. `assumed` may continue only when the
assumption is non-load-bearing and restated for plan. `blocked` prevents handoff unless the
doc routes back to discovery or asks the user for the missing decision. Migration names,
stale docs, diffs, and mocks are not proof.

## Output

Write `docs/designs/YYYY-MM-DD-<slug>-tdd.md` with ~8 sections:

1. Problem statement
2. Users and success criteria
3. Source-read and discovery summary
4. Product workflow and UI/API experience
5. Data model and source of truth
6. Architecture and ownership boundaries (owner, public seam, expected consumers)
7. Failure modes, edge cases, rollback, and observability
8. Alternatives, risks, open questions, and plan/contract recommendations

Seed — do not lock — enough for plan to make it exact: the original intent (user words →
business outcome → operator acceptance → non-goals), the files likely owned by this work,
and any touched file / DB-query path that will need an ownership decision. Detailed SRP and
DB/query ownership lists belong in `/enterprise-plan`; here just flag them so plan cannot
hide them inside broad scope. Mark anything unknown `UNKNOWN` with the exact source read or
user decision needed — do not let it disappear silently.

## Handoff

- Proceed to `/enterprise-plan` once load-bearing proof-ledger rows are `proven` or carry an
  explicit plan action.
- If discovery reveals the request is actually a bug, route to `/enterprise-debug` (or make
  the design explicitly bug-fix shaped) before planning.
