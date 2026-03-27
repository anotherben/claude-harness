---
name: plan-360-audit
description: Use when a plan, design, migration, or deployment checklist is drafted and needs review before passing a planning gate or proceeding to implementation. Triggers on phrases like "review this plan", "is this ready", "gate check", "audit the plan", "stakeholder review", or whenever a document in docs/plans/, .claude/designs/, or docs/handovers/ is about to be acted on. Also use proactively before any implementation begins — every plan must pass 360-degree stakeholder audit and enterprise-grade architecture review before code is written.
---

# Plan 360 Audit

## Overview

Every plan must survive scrutiny from every direction before a single line of code is written. This skill stress-tests plans, designs, migrations, and deployment checklists from two dimensions:

1. **Stakeholder 360** — Would this plan work for everyone it touches? Not just the developer, but the accountant, the warehouse operator, the customer, the supplier, the support agent.
2. **Enterprise Architecture Gate** — Is this built to enterprise standards, or is it "just making it work"? Enterprise-grade means observable, scalable, auditable, recoverable, and secure by default — not gold-plated after the fact.

The philosophy: **we don't ship fixes then harden later. We build enterprise-level systems from the start.** When someone reviews our code, they should see deliberate architecture, not vibe-coded solutions.

## When to Use

- Before passing any planning gate (brainstorm → plan, plan → implementation)
- Before the final gate into implementation
- When reviewing migration plans, deployment checklists, or design docs
- When you feel a plan is "done" — that's exactly when it needs this audit

## Process

### Step 1: Identify the Document

Read the plan/design/migration being audited. Understand its scope, goals, and proposed approach.

### Step 2: Discover Affected Stakeholders

Don't use a fixed list. Derive stakeholders from the plan itself by asking:

- **Who touches this system?** (developers, ops, support)
- **Who sees the output?** (customers, suppliers, internal users)
- **Who pays for it?** (finance, accounting, management)
- **Who supports it?** (support agents, on-call engineers)
- **Who audits it?** (compliance, security, external auditors)
- **Who depends on it downstream?** (integrations, reporting, other teams)
- **Who is affected indirectly?** (end customers whose orders flow through this, partners whose data changes)

Common stakeholder categories (use as seeds, not a checklist):

| Category | Example Roles | What They Care About |
|----------|--------------|---------------------|
| Financial | Accountant, CFO, bookkeeper | Cost, tax implications, margins, reconciliation, audit trail, reporting accuracy |
| Operational | Warehouse, logistics, support | Workflow disruption, training, edge cases, manual overrides, daily routine changes |
| Customer-facing | End customer, guest, B2B buyer | UX clarity, communication, self-service, error recovery, order accuracy and timing |
| Supplier/Partner | Supplier, vendor, integration partner | Data accuracy, API contracts, notification timing, portal experience |
| Technical | Developer, DevOps, on-call | Maintenance burden, observability, deployment risk, rollback, debugging at 3am |
| Compliance | Legal, security, privacy | Data handling, access control, retention, regulation, audit completeness |
| Strategic | Owner, product lead | Alignment with direction, ROI, opportunity cost, incremental value delivery |

**The customer trap:** Technical plans naturally focus on the builder's perspective. The most commonly missed stakeholder is the end customer — the person whose order, payment, or experience flows through this system. Even backend-only changes can affect order timing, notification accuracy, or error messages that reach customers. Always ask: "Does this change affect anything a customer eventually sees, receives, or experiences?" If yes, include them.

**The reporting trap:** Changes to data schemas, status values, timestamps, or calculation logic can silently break reports, dashboards, and exports that finance/management rely on for decisions. If the plan touches any data that feeds reporting, the financial stakeholder must be included — even if the plan is "purely technical."

### Step 3: Dispatch Stakeholder Audits (Parallel)

For each identified stakeholder perspective, dispatch a subagent that:

1. Reads the plan from that stakeholder's viewpoint
2. Identifies concerns, risks, and gaps specific to their role
3. Rates severity: BLOCKER / HIGH / MEDIUM / LOW
4. Suggests mitigations for each concern

Each subagent prompt should include:
```
You are reviewing this plan as a [ROLE]. Your job is to find problems
that someone in this role would care about. Be specific — don't flag
generic risks, flag concrete issues with this specific plan.

Think about:
- What could go wrong for you specifically?
- What information is missing that you'd need?
- What assumptions does this plan make about your domain?
- What edge cases would hit you hardest?
- Would this plan survive your audit/review process?
```

**The grounding rule — no unanchored concerns:**

Every concern you raise must cite a specific section, quote, file, or detail from the plan. If you can't point to where in the plan the problem originates, the concern is too generic to be useful. "No rollback strategy" is weak. "Phase 1 migration (migrations 351-353) uses `DROP TABLE ... CASCADE` with no rollback step or backup mentioned" is strong — it points to the exact phase and operation.

**The code verification rule — read before you flag:**

If a concern involves code (files the plan mentions, services it proposes to change, migrations, endpoints, existing abstractions), you must read the actual source files before raising the concern. Plans regularly contain stale information — wrong file counts, missed existing abstractions, outdated line references, migration number collisions. The only way to catch these is to verify against the codebase. Specifically:

- If the plan says "update 47 files" — grep and count the real number
- If the plan proposes creating a new service — check if one already exists that does the same thing
- If the plan references migration numbers — check what migrations already exist
- If the plan claims a function works a certain way — read the function
- If the plan says a table has N rows or columns — verify the schema

An audit that doesn't verify code claims is just reviewing the plan's marketing copy. The highest-value findings come from the gap between what the plan says and what the code actually is.

### Step 4: Enterprise Architecture Gate

Run a separate assessment against enterprise-grade standards. This is not optional — it's the baseline expectation.

**The plan must demonstrate deliberate thinking in each area:**

| Enterprise Dimension | What to Check | Red Flag If Missing |
|---------------------|---------------|-------------------|
| **Observability** | Logging, metrics, alerting, dashboards | "We'll add monitoring later" |
| **Scalability** | Load considerations, bottlenecks, growth path | No mention of volume/scale |
| **Data Integrity** | Transactions, idempotency, consistency guarantees | Happy-path only design |
| **Security** | Auth, input validation, tenant isolation, secrets | Security as afterthought |
| **Recoverability** | Rollback plan, data recovery, failure modes | No rollback strategy |
| **Auditability** | Change tracking, who-did-what, compliance trail | No audit consideration |
| **Operability** | Runbooks, manual overrides, feature flags, on-call | Requires developer intervention for ops tasks |
| **Testability** | Test strategy, coverage approach, CI integration | "We'll test manually" |
| **Migration Safety** | Backwards compatibility, zero-downtime, data backfill | Big-bang cutover |
| **Documentation** | API contracts, architecture decisions, onboarding | Tribal knowledge only |

**Enterprise grading:**
- **Enterprise-Ready**: All dimensions addressed with concrete specifics
- **Needs Hardening**: Core functionality solid but gaps in 1-3 dimensions
- **Vibe-Coded**: Multiple dimensions missing or hand-waved — send back to planning

**Grading discipline — avoid the "current scale" excuse:**

A common rationalization is marking Scalability as "pass" because "we only have 71 suppliers" or "current volume is low." Enterprise-grade means the architecture can handle 10x growth without redesign. Don't grade against today's numbers — grade against where the system needs to be in 12-18 months. If the plan doesn't mention growth considerations at all, that's a gap, not a pass.

Similarly, don't give Observability a pass just because logging exists. Enterprise observability means: if this breaks at 2am, can the on-call engineer diagnose it without reading the source code? If the answer is "they'd need to check the database directly," that's a gap.

**The "we'll add it later" red flag:**

Any plan that defers enterprise dimensions to a future phase is not enterprise-grade — it's vibe-coded with a TODO list. Monitoring, rollback, runbooks, and security are not Phase 2 features. They ship with Phase 1 or the plan fails the enterprise gate. The whole point of this gate is to prevent "ship now, harden later" thinking.

### Step 5: Synthesize Conflicts

Cross-reference all stakeholder concerns and the enterprise gate:

- Where do stakeholder needs clash? (e.g., "faster for ops" vs "more audit trail for compliance")
- Where does the enterprise gate expose gaps no stakeholder caught?
- Where are concerns duplicated across perspectives? (signals a fundamental issue)

### Step 6: Produce the Audit Document

Output a structured document with this format:

```markdown
# 360 Audit: [Plan Name]

**Date:** [date]
**Document audited:** [path]
**Overall verdict:** PASS / CONDITIONAL PASS / FAIL

## Stakeholder Matrix

| Stakeholder | Concerns Found | Blockers | Highest Severity |
|-------------|---------------|----------|-----------------|
| [role]      | [count]       | [count]  | [BLOCKER/HIGH/etc] |

## Enterprise Architecture Grade

**Grade:** Enterprise-Ready / Needs Hardening / Vibe-Coded

| Dimension | Status | Detail |
|-----------|--------|--------|
| Observability | [pass/gap/missing] | [specific assessment] |
| ... | ... | ... |

## Stakeholder Detail

### [Stakeholder Role]
| # | Concern | Severity | Mitigation |
|---|---------|----------|------------|
| 1 | [specific issue] | [level] | [suggested fix] |

## Conflicts & Tradeoffs

| Conflict | Stakeholders | Resolution Options |
|----------|-------------|-------------------|
| [description] | [who vs who] | [options] |

## Blockers (Must Resolve Before Implementation)

1. [blocker with clear description and owner]

## Recommendations

1. [ordered by priority]

## Verdict Rationale

[Why this plan passed/failed the gate, and what must change for conditional passes]
```

### Step 7: Gate Decision

- **PASS**: No blockers, enterprise-grade, stakeholder concerns addressed or explicitly accepted as tradeoffs
- **CONDITIONAL PASS**: No blockers but gaps exist — list specific conditions that must be met before implementation
- **FAIL**: Blockers present or enterprise grade is "Vibe-Coded" — return to planning

A CONDITIONAL PASS requires the conditions to be resolved and the audit re-run before proceeding. Don't let conditions become "we'll do it later" — that's how enterprise standards erode.

## Common Mistakes

- **Fixed stakeholder list**: Don't audit every plan from 7 perspectives. A database migration doesn't need customer UX review. Derive stakeholders from the plan.
- **Generic concerns**: "Security could be an issue" is useless. "The plan doesn't specify how tenant isolation is maintained during the batch migration" is useful.
- **Skipping the enterprise gate**: Stakeholder review alone misses architectural gaps. The enterprise gate catches systemic issues.
- **Rubber-stamping**: If everything passes easily, the audit wasn't rigorous enough. Push harder on assumptions.
- **Over-auditing trivial changes**: A one-line config change doesn't need 6 stakeholder reviews. Scale the audit to the plan's blast radius.
- **Developer-heavy bias**: Technical reviews naturally gravitate toward developer concerns. If your audit has 7 developer issues and 1-2 per other stakeholder, you haven't pushed hard enough on non-technical perspectives. The whole point of 360 is to catch what the technical review misses.
- **Ignoring downstream data consumers**: Changing a timestamp's meaning, a status value's definition, or a calculation formula can silently break every report, dashboard, and export that uses that data. Always trace data changes downstream to their consumers.
- **Passing scalability because "current load is low"**: Enterprise-grade means the architecture handles growth without redesign. Grade against 10x, not today.
- **Missing the incremental delivery question**: Large plans that deliver zero value until 100% complete are a business risk. The strategic stakeholder should always ask: "Can we ship partial value earlier?"
- **Ungrounded concerns**: Every concern must cite a specific plan section, quote, or file. "Security could be an issue" is useless. "The plan encrypts credentials in migration 352 but never NULLs the plaintext column before the DROP in migration 353" is useful. If you can't anchor it, cut it.
- **Reviewing the plan without reading the code**: Plans contain claims about the codebase — file counts, existing services, table schemas, function behavior. These claims are frequently wrong. If you audit a code-related plan without verifying its claims against the actual source files, you're reviewing fiction. The most valuable findings in any audit are the gaps between what the plan says and what the code actually does.
