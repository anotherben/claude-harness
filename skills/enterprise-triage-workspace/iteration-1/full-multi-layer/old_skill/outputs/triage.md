# Enterprise Triage Output

## Input Task

> "/enterprise build a purchase order system. Need a new purchase_orders table, purchase_order_line_items table, CRUD API endpoints (5 routes), PO generation service with auto-numbering, supplier integration via REX SOAP API for PO submission, React PO list page, PO detail page with line item editor, PO approval workflow. Probably 15+ files across API, service, and frontend."

---

## Step 1: TRIAGE — Tier Classification

### Scope Assessment

| Signal | Value | Tier Implication |
|--------|-------|------------------|
| New tables | 2 (purchase_orders, purchase_order_line_items) | Medium+ |
| New API routes | 5 CRUD endpoints + PO submission | Medium+ |
| New services | PO generation with auto-numbering, REX SOAP submission | Medium+ |
| External integration | REX SOAP API (supplier PO submission) | Large |
| Frontend pages | 2 (PO list, PO detail with line item editor) | Medium+ |
| Workflow logic | Approval workflow (state machine, permissions) | Large |
| Estimated files | 15+ across API, service, frontend | Large |
| Concurrency concerns | Auto-numbering (sequence gaps, race conditions), approval state transitions | Large |

### Tier Decision

**LARGE** — This is a new system, not an extension of an existing one.

Rationale: The task hits every Large-tier criterion from the skill's triage table:

- "New system" — purchase orders are a net-new domain, not modifying existing tables/routes
- "5+ files" — user estimates 15+, which is well above the 5-file threshold
- "Multiple integrations" — REX SOAP API for supplier submission is an external integration
- "Concurrency" — auto-numbering requires sequence management under concurrent requests; approval workflow has state transition race conditions (e.g., two users approving/rejecting simultaneously)

This is NOT Medium because:
- Medium caps at "3-5 files, UI + API" — this is 15+ files
- Medium says "new endpoint, new table" (singular) — this has 2 tables, 5+ endpoints, 2 UI pages, a service layer, and an external integration
- The REX SOAP integration alone could be a Medium task; the approval workflow alone could be a Medium task; combined they push firmly into Large

---

## Step 2: MODE SELECTION

```
TRIAGE: Large — New purchase order system spanning 2 tables, 5+ API routes,
REX SOAP integration, 2 React pages, and an approval workflow across 15+ files.

Recommended mode: Swarm — Multiple independent workstreams (data layer,
API routes, PO service, REX integration, React UI, approval workflow)
benefit from parallel execution with dependency blocking.

  1. Solo     -- Single agent, sequential stages. Best for Micro/Small.
                 Fast, low overhead, self-review acceptable.

  2. Subagent -- Fresh agent per task from plan. Best for Medium.
                 Isolation prevents context bleed. Two-stage review per task.
                 Spec compliance THEN code quality -- separate concerns.

  3. Swarm    -- Persistent teammates with task queue. Best for Large.
                 Parallel workstreams. Named roles. Dependency blocking.
                 Shared knowledge via task list + message passing.

Your choice (or press enter for recommended):
```

### Mode Enforcement Check

Per the MODE ENFORCEMENT table:
- **Tier: Large** -- Allowed modes: **Swarm only** (default: Swarm)
- Override: `--subagent --force` would require explicit justification logged in the plan document
- No override requested, so **Swarm** is selected

---

## Step 3: PIPELINE — Stages to Execute

### Applicable Pipeline Path

Per the skill, Large tier follows the **ALL TIERS (Small+)** base pipeline with all additions:

```
ALL TIERS (Small+):
  DISCOVER -> BRAINSTORM -> PLAN -> CONTRACT -> BUILD -> VERIFY -> DEPLOY -> COMPOUND -> COMPLETE

SMALL+ adds:
  ... -> BUILD -> REVIEW -> FORGE -> VERIFY -> ...

MEDIUM+ adds:
  Human approval gate after PLAN
  Two-stage review (spec + quality as separate passes)
  Separate agent for REVIEW (builder never reviews own work)

LARGE adds:
  Parallel research agents in BRAINSTORM
  Swarm execution in BUILD
  Cross-workstream integration testing in VERIFY
```

### Full Stage Sequence (Large Tier, Swarm Mode)

```
Stage 1:  DISCOVER         /enterprise-discover
          -> produces: project-profile.md (skip if exists and current)
          -> Large addition: none (standard)

Stage 2:  BRAINSTORM       /enterprise-brainstorm
          -> produces: docs/designs/2026-03-14-purchase-order-system-tdd.md
          -> Large addition: Parallel research agents
             - Agent 1: REX SOAP API research (envelope format, auth, error patterns)
             - Agent 2: Approval workflow patterns (state machine design)
             - Agent 3: Auto-numbering strategies (sequences, gap handling)

Stage 3:  PLAN             /enterprise-plan
          -> produces: docs/plans/2026-03-14-purchase-order-system-plan.md
          -> MEDIUM+ GATE: Human approval required before proceeding to CONTRACT
             User must confirm the plan before any code is written

Stage 4:  CONTRACT         /enterprise-contract
          -> produces: docs/contracts/2026-03-14-purchase-order-system-contract.md
          -> Also produces: .claude/enterprise-state/purchase-order-system-postconditions.json
          -> Postconditions will cover: schema, CRUD, auto-numbering, REX submission,
             UI rendering, approval transitions, tenant isolation, error handling
          -> GATE: Contract must be LOCKED before BUILD begins
          -> GATE: enterprise-pipeline-gate.sh blocks source edits until contract exists

Stage 5:  BUILD            /enterprise-build
          -> produces: code + tests (TDD RED->GREEN)
          -> Large addition: Swarm execution
             - Workstream A: Database layer (migrations, models)
             - Workstream B: API routes + PO service (depends on A)
             - Workstream C: REX SOAP integration (depends on A)
             - Workstream D: React UI pages (depends on B)
             - Workstream E: Approval workflow (depends on A, B)
          -> Dependency blocking ensures correct execution order
          -> Each workstream updates postcondition registry as tests go GREEN

Stage 6:  REVIEW           /enterprise-review
          -> produces: docs/reviews/2026-03-14-purchase-order-system-review.md
          -> MEDIUM+ GATE: Separate agent reviews (builder never reviews own work)
          -> Two-stage review:
             Pass 1: Spec compliance (do postconditions match implementation?)
             Pass 2: Code quality (security, patterns, maintainability)

Stage 7:  FORGE            /enterprise-forge
          -> produces: forge findings, bugs recycled to contract as new PCs
          -> Mechanical checks (M1-M8) + contract probes + adversarial lenses
          -> Special attention: REX SOAP error-as-success patterns, tenant isolation
             on both tables, auto-numbering race conditions, approval state corruption
          -> Circuit breaker: max 5 recycle iterations, 3-fail escalation

Stage 8:  VERIFY           /enterprise-verify
          -> produces: verification evidence (fresh test output)
          -> Large addition: Cross-workstream integration testing
             - End-to-end: create PO -> add line items -> submit to REX -> approve
             - Verify all workstreams integrate correctly
          -> 7 checks: test suite, postcondition trace, regression, build,
             diff classification, imports, debug artifacts

Stage 9:  DEPLOY           /enterprise-deploy (optional, if user requests)
          -> produces: deployment confirmation
          -> Uses deploy-checklist skill
          -> Checks: migrations, env vars (REX API credentials), feature flags
          -> Rollback plan required

Stage 10: COMPOUND         /enterprise-compound
          -> produces: docs/solutions/2026-03-14-purchase-order-system.md
          -> Institutional knowledge capture
          -> Tags, cross-references, patterns learned
```

### Stage Gates That Apply

| Gate | Applies | Notes |
|------|---------|-------|
| No code before contract | YES | Enforced by enterprise-pipeline-gate.sh |
| No code before failing test | YES | TDD RED->GREEN in BUILD |
| Human approval after PLAN | YES | Medium+ gate |
| Builder never reviews own work | YES | Medium+ gate, separate REVIEW agent |
| No completion without evidence | YES | VERIFY requires fresh test output |
| 3-fail circuit breaker | YES | FORGE escalation protocol |
| 5-recycle cap | YES | FORGE iteration limit |
| Artifact validation at each stage entry | YES | Each skill checks upstream artifact |

### Domain Guard Skills to Invoke During BUILD

Per CLAUDE.md skill suggestions and the skill's PIPELINE CONTAINMENT rules (domain guards allowed as utilities):

| Guard Skill | When | Why |
|-------------|------|-----|
| `rex-soap-protocol` | BUILD workstream C | Protocol detection, envelope construction, error-as-success patterns |
| `sql-guard` | BUILD workstream A | Tenant isolation, parameterized queries, type traps, TIMESTAMPTZ |
| `integration-guard` | BUILD workstreams B, C | Pre-code checklist for REX/external integration |

### JSON State Initialization

After triage confirmation, the following state file would be created:

```json
{
  "slug": "purchase-order-system",
  "created": "2026-03-14T...",
  "tier": "large",
  "mode": "swarm",
  "branch": "feat/purchase-order-system",
  "stages": {
    "discover":   { "status": "pending" },
    "brainstorm": { "status": "pending" },
    "plan":       { "status": "pending" },
    "contract":   { "status": "pending" },
    "build":      { "status": "pending" },
    "review":     { "status": "pending" },
    "forge":      { "status": "pending" },
    "verify":     { "status": "pending" },
    "compound":   { "status": "pending" }
  },
  "circuit_breakers": {
    "forge_iterations": 0,
    "forge_max": 5,
    "forge_per_check_failures": {},
    "debug_fix_attempts": 0,
    "debug_max": 3
  }
}
```

### Worktree Setup

```bash
git worktree add .claude/worktrees/purchase-order-system -b feat/purchase-order-system
cd .claude/worktrees/purchase-order-system
```

---

## Summary

| Property | Value |
|----------|-------|
| Tier | **Large** |
| Mode | **Swarm** |
| Slug | `purchase-order-system` |
| Branch | `feat/purchase-order-system` |
| Stages | 10 (DISCOVER through COMPOUND) |
| Hard gates | 8 (all stage gates apply) |
| Domain guards | 3 (rex-soap-protocol, sql-guard, integration-guard) |
| Estimated postconditions | 20-30 (2 tables, 5 routes, service, integration, 2 pages, workflow) |
| Parallel workstreams | 5 (database, API, REX, UI, approval) |
