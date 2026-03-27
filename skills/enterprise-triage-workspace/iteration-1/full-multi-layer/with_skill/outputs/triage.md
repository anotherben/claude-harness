# Enterprise Triage Output

## Task Description

> Build a purchase order system. Need a new purchase_orders table, purchase_order_line_items table, CRUD API endpoints (5 routes), PO generation service with auto-numbering, supplier integration via REX SOAP API for PO submission, React PO list page, PO detail page with line item editor, PO approval workflow. Probably 15+ files across API, service, and frontend.

---

## Step 1: TRIAGE — Tier Classification

### Assessment Against Tier Criteria

| Tier | Criteria | Match? |
|------|----------|--------|
| Micro | Typo, 1-liner, config change, <2 files | NO |
| Small | Clear fix, 2-3 files, no new APIs or tables | NO |
| Medium | New endpoint, new table, 3-5 files, UI + API | PARTIAL — has new tables and UI+API, but scope exceeds 3-5 files |
| **Large** | **New system, 5+ files, multiple integrations, concurrency** | **YES** |
| Critical | Production is broken, data loss, security breach | NO |

### Tier Decision: LARGE

**Rationale:** This is a new system (purchase orders), not an extension of an existing one. It involves:
- 2 new database tables (purchase_orders, purchase_order_line_items) requiring migrations
- 5+ new API endpoints (CRUD routes)
- A new service layer (PO generation with auto-numbering)
- An external integration (REX SOAP API for PO submission)
- 2+ new React pages (PO list, PO detail with line item editor)
- A workflow component (approval workflow)
- User's own estimate: 15+ files across API, service, and frontend

This clearly exceeds Medium (3-5 files, single table) and lands squarely in Large territory: new system, 5+ files, multiple integrations.

---

## Step 2: MODE SELECTION

```
TRIAGE: Large — New purchase order system with 2 tables, 5 API routes,
REX SOAP integration, 2 React pages, and approval workflow across 15+ files.

Recommended mode: Swarm — Parallel workstreams needed for API, service,
and frontend layers. Named roles (API builder, frontend builder, integration
specialist) prevent context bleed across layers.

  1. Solo     — Single agent, sequential stages. Best for Micro/Small.
                Fast, low overhead, self-review acceptable.

  2. Subagent — Fresh agent per task from plan. Best for Medium.
                Isolation prevents context bleed. Two-stage review per task.
                Spec compliance THEN code quality — separate concerns.

  3. Swarm    — Persistent teammates with task queue. Best for Large.
                Parallel workstreams. Named roles. Dependency blocking.
                Shared knowledge via task list + message passing.

Your choice (or press enter for recommended):
```

### Mode Enforcement Check

Per the MODE ENFORCEMENT table:

| Tier | Allowed Modes | Default | Override |
|------|--------------|---------|----------|
| Large | Swarm only | Swarm | `--subagent --force` (requires explicit justification) |

**Result:** Swarm is the only non-override mode for Large tier. No override flags were provided, so **Swarm** is selected.

---

## Step 3: TRIAGE ROUTING — Signal Assessment

### Signal-by-Signal Evaluation

| Signal | Assessment | Value | Path Indicated |
|--------|-----------|-------|----------------|
| Files changed | 2 migrations + 5 route files + 1 service + 1 SOAP client + 2 React pages + shared types + tests | 15+ | **FULL** |
| Lines changed | New system: tables, routes, service, pages, tests | 500+ estimated | **FULL** |
| New tables/migrations | purchase_orders + purchase_order_line_items = 2 new tables | 2 | **FULL** |
| New API endpoints | 5 CRUD routes + potentially approval endpoint | 5+ | **FULL** |
| Frontend + backend | React pages (list + detail) + Express API + service layer | Yes | **FULL** |
| Multi-layer (API+service+UI+cross) | API layer, service layer (PO generation), UI layer, cross-cutting (REX SOAP integration, approval workflow) | Full stack, all 4 layers | **FULL** |
| Clear scope (1 sentence) | "Build a purchase order system" is clear intent, but requirements span tables, APIs, services, integrations, UI, and workflows | Not fully — multiple subsystems | **FULL** |
| Ambiguous requirements | Approval workflow details unclear (who approves? thresholds? states?), auto-numbering format unspecified, REX SOAP submission payload unknown | Yes — several open questions | **FULL** |

### Signal Conflict Check

All 8 signals point to FULL. No conflicts. No rounding needed.

### Path Decision: FULL PATH

```
FULL PATH (Medium-Large, ambiguous scope, multi-layer, or user requests it):
  DISCOVER -> BRAINSTORM -> PLAN -> CONTRACT -> BUILD -> REVIEW -> FORGE -> VERIFY -> COMPOUND -> COMPLETE
```

---

## Complete Stage Sequence

The following 10 stages will execute in order:

| # | Stage | Skill | Purpose | Produces |
|---|-------|-------|---------|----------|
| 1 | DISCOVER | `/enterprise-discover` | Codebase onboarding — understand existing patterns, stack, conventions | `project-profile.md` |
| 2 | BRAINSTORM | `/enterprise-brainstorm` | Requirements extraction, technical design, connection mapping, open question resolution (approval workflow details, auto-numbering format, REX SOAP contract) | `docs/designs/2026-03-14-purchase-order-system-tdd.md` |
| 3 | PLAN | `/enterprise-plan` | Task decomposition into parallel workstreams for Swarm mode, dependency ordering, estimated scope per task | `docs/plans/2026-03-14-purchase-order-system-plan.md` |
| 4 | CONTRACT | `/enterprise-contract` | Postconditions for every endpoint, table, service behavior, integration, UI interaction. Invariants for tenant isolation, data integrity. Blast radius analysis. | `docs/contracts/2026-03-14-purchase-order-system-contract.md` + `.claude/enterprise-state/purchase-order-system-postconditions.json` |
| 5 | BUILD | `/enterprise-build` | TDD RED-GREEN for every postcondition. Swarm mode: parallel builders for API, service, frontend. | Code + tests across 15+ files |
| 6 | REVIEW | `/enterprise-review` | Independent review (builder never reviews own work — Large tier). Spec compliance first, then code quality. | `docs/reviews/2026-03-14-purchase-order-system-review.md` |
| 7 | FORGE | `/enterprise-forge` | Adversarial testing: mechanical checks (tenant isolation, parameterized queries, concurrency), contract probes, attack lenses. Bugs recycle to CONTRACT as new PCs. | Forge findings, recycled PCs |
| 8 | VERIFY | `/enterprise-verify` | Fresh test evidence, postcondition trace, diff classification, regression check. verify.sh + manual checks. | Verification report + `.claude/enterprise-state/purchase-order-system-verification.json` |
| 9 | COMPOUND | `/enterprise-compound` | Institutional knowledge capture: patterns discovered, decisions made, gotchas for future PO work. | `docs/solutions/2026-03-14-purchase-order-system.md` |
| 10 | COMPLETE | Audit report | Final audit report printed to screen, gate deactivated. | Audit report |

---

## Stage Gates That Apply

| Gate | How It Applies Here |
|------|-------------------|
| No code before contract | Source file edits blocked until contract is LOCKED (mechanical hook enforcement) |
| No code before failing test | Every route, service method, and React component gets a RED test first |
| Builder never reviews own work | Large tier: separate agent handles REVIEW |
| Human approval before build | Hard-stop after PLAN — Ben must approve before BUILD proceeds |
| 3-fail circuit breaker | If FORGE finds recurring failures (e.g., tenant isolation on PO queries), escalate rather than retry |
| Bugs recycle to contract | Any FORGE bug becomes a new postcondition with full TDD cycle |

---

## Domain Guard Skills Available During BUILD

Per PIPELINE CONTAINMENT rules, these guard skills may be called as utilities during BUILD:

- **`rex-soap-protocol`** — for PO submission to supplier via REX SOAP API (envelope construction, error-as-success patterns)
- **`sql-guard`** — for migration safety (tenant isolation on both tables, parameterized queries, TIMESTAMPTZ, UUID vs integer type traps)
- **`integration-guard`** — general pre-code checklist for the REX integration

---

## Summary

| Field | Value |
|-------|-------|
| **Tier** | Large |
| **Path** | FULL (all 10 stages) |
| **Mode** | Swarm (persistent teammates, parallel workstreams) |
| **Slug** | `purchase-order-system` |
| **Branch** | `feat/purchase-order-system` |
| **Estimated files** | 15+ |
| **Estimated postconditions** | 20-30 (5 CRUD endpoints x 2-3 PCs each, service PCs, integration PCs, UI PCs, workflow PCs) |
| **Key risks** | REX SOAP API contract unknown, approval workflow ambiguous, auto-numbering concurrency |
| **Open questions for BRAINSTORM** | Approval states/thresholds, PO number format, REX SOAP payload schema, line item validation rules |
