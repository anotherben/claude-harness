# Enterprise Brainstorm Workflow

Use this reference when executing `enterprise-brainstorm`.

## Phase 1: Extract

Ask one question at a time until the request has concrete answers for:

- problem and pain point
- original user words that must survive downstream translation
- business outcome, operator acceptance, and non-goals
- user/persona and workflow
- desired experience or API behavior
- success criteria
- explicit exclusions and constraints
- known systems, integrations, data, and platform limits

If the user says to proceed before every dimension is concrete, mark the
remaining items as `assumed` in the Proof Ledger and give plan/contract a named
follow-up action.

## Phase 2: Discover

Read current source before making design claims. Capture:

- runtime entry points, public seams, and consumers
- database tables, constraints, query code, and migration/runtime gaps
- table/source owners, approved read/write seams, tenant/owner/current-DB scoping,
  and affected-row/readback expectations for every data path
- UI components, hooks, routes, state, browser/PDF/upload flows when relevant
- existing tests, fixtures, proof gaps, and local command patterns
- existing services, helpers, libraries, and reusable seams
- repo profile, traps, and prior decisions relevant to the slice

Do not treat migration names, stale docs, mocked tests, or memory as proof of
current runtime behavior.

## Phase 3: Product Design

Design the product/workflow, not just the code. Include:

- personas and journeys
- screen/API/event flow
- permission and tenant boundaries
- operational states, failure states, retries, and rollback
- observability and support/on-call needs
- downstream reporting, supplier, customer, and integration effects
- credible alternatives, including incumbent/no-change, with source evidence,
  operational tradeoffs, and proof impact

Ask the user only when a load-bearing product decision is blocked.

## Phase 4: Engineer The TDD

Write `docs/designs/YYYY-MM-DD-<slug>-tdd.md` with:

1. Problem Statement
2. Users And Success Criteria
3. Source Read And Discovery Summary
4. Product Workflow And UI/API Experience
5. Data Model And Source Of Truth
6. API/Interface Contracts
7. Architecture And Ownership Boundaries
8. Security, Permissions, And Tenant/Data Safety
9. Failure Modes, Edge Cases, And Rollback
10. Observability And Operations
11. Reuse Inventory
12. Alternatives And Decision Rationale
13. Intent Continuity Ledger
14. Touched File SRP/Refactor Seed
15. DB/Query Ownership Seed
16. Proof Ledger
17. Mechanical Build Packet Seed
18. Enterprise Solution Brief
19. Risks, Tradeoffs, And Open Questions
20. Plan/Contract Recommendations

## Proof Ledger Rules

Every load-bearing claim must be one of:

- `proven`: current source, live/dev DB, real integration, headless browser, or
  explicit user evidence appropriate to the claim.
- `assumed`: non-load-bearing, with a named plan/contract action.
- `blocked`: prevents handoff unless routed to discovery/user decision.

## Mechanical Build Packet Seed

Seed these fields for plan/contract:

- Probable Allowed Runtime Paths
- Probable Allowed Test Paths
- Probable Allowed Artifact Paths
- Probable Module Boundary
- Probable Folder Placement
- Probable Public Seam
- Probable Owner Layer
- Probable Allowed Dependency Direction
- Probable Forbidden Imports
- Probable Architecture Tests
- Probable Touched File SRP Assessment: current responsibility evidence, one
  reason to change, mixed-responsibility risk, and `fix-now` / `follow-up` /
  `note-only` recommendation for every likely touched file
- Probable DB/Query Ownership Packet: table/source owner, operation type,
  approved owner seam, tenant/owner/current-DB predicates, affected-row/readback,
  bounded proof command, and cleanup/rollback for every likely query path
- Intent Continuity Ledger rows linking original user words to business outcome,
  operator acceptance, non-goals, source/proof evidence, and downstream owner
- Candidate Postcondition Execution Order
- Expected RED proof surface
- Expected GREEN proof surface
- Forbidden Changes
- Refusal Conditions

Unknown packet fields must stay `UNKNOWN` with the exact source read, user
decision, or proof action needed. Do not let unknowns disappear.
