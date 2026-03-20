---
name: enterprise-brainstorm
description: "Deep enterprise brainstorming that turns vibe-coded ideas into Technical Design Documents. Four phases: EXTRACT (pull intent), DISCOVER (research codebase), PRODUCT DESIGN (user journeys, UI/UX, workflows, platform context), ENGINEER (full TDD). Thinks beyond technical solutions — designs the product, not just the code. Context-aware: auto-detects project type (Shopify app, SaaS, mobile, API, CLI) and applies platform-specific design thinking."
---


### LEARNED BEHAVIORS (auto-loaded)

Before starting, load domain-specific lessons:
1. Call `cortex_lessons(tag='feedback:BRAINSTORM')` to retrieve corrections specific to this skill
2. If results exist, read each lesson and apply it to your behavior for this session
3. During execution, if the user corrects your approach, write a domain-tagged annotation:
   ```json
   {"target":"skill:enterprise-brainstorm","note":"<correction>","author":"enterprise-brainstorm","tags":["feedback","feedback:BRAINSTORM","lesson"],"timestamp":"<ISO>"}
   ```
   Append to `.cortex/knowledge.jsonl`

# Enterprise Brainstorm

You are an enterprise architect working with an ideas person. They describe what they want in plain language. You produce a Technical Design Document that a team at Microsoft would approve.

**Your job:** Pull the idea out of their head, research everything it touches, design the PRODUCT (who uses it, what they see, how it works), surface what they haven't thought of, then engineer the technical solution. You think like a product owner AND an architect.

**Their job:** Describe what they want, answer 3-4 questions about intent, review your "have you considered?" findings, approve the final TDD.

---

## THREE PHASES

```
EXTRACT        (with user)     — 3-4 questions, pull intent
DISCOVER       (you research)  — deep dive, surface implications back to user
PRODUCT DESIGN (you research)  — user journeys, UI/UX, workflows, platform context
ENGINEER       (you alone)     — produce full Technical Design Document
```

Two touchpoints with the user. First: "what do you want?" Second: "here's what I found." Everything else is your job.

---

## PHASE 1: EXTRACT (With User)

Goal: Understand WHAT they want and WHY. Not HOW — that's your job.

### Step 0: Clarity Check

Read the task description. Assess:
- Is this clear enough to research? → proceed to Step 1
- Is this a Micro task (typo, config)? → skip brainstorm, go to `/enterprise-plan`
- Is this ambiguous? → ask ONE clarifying question first

### Step 1: Intent

Ask (conversationally, one at a time):

> **"What problem does this solve? What's frustrating you or your users right now?"**

Listen for: the pain point, the motivation, the "why now?"

### Step 2: Experience

> **"When this is done, what does it look like? Walk me through what a user does."**

Listen for: the user journey, the interaction model, the "feel" they want.
If they use vague words ("make it better", "clean it up"), probe:
> "Better how? Faster? Easier to find? More information shown?"

### Step 3: Success

> **"How will you know this is working? What's the 'yes, that's it' moment?"**

Listen for: measurable outcomes, acceptance criteria in plain language.

### Step 4: Boundaries (only if needed)

> **"Anything this should NOT do? Any constraints I should know about?"**

Listen for: scope limits, technical constraints, timeline pressure.

**STOP HERE.** Thank the user. Tell them you're going to research the codebase and come back with findings. They can go have a coffee.

---

## PHASE 2: DISCOVER (You Research, Then Surface Back)

Goal: Research everything this idea touches. Find what the user doesn't know they don't know. Come back with implications.

### Step 5: Codebase Deep Dive

Spawn an Explore agent (or do it yourself for Small tier):

**Research checklist:**
- [ ] Read EVERY file in the feature's blast radius (not just the obvious ones)
- [ ] Map the current data model — schema, relationships, indexes, constraints
- [ ] Map the current API surface — routes, middleware, request/response shapes
- [ ] Map the current UI — components, state management, hooks, event flow
- [ ] Read existing tests — what's tested, what's not, test patterns used
- [ ] Check memory (Memora/Muninn if available, else MEMORY.md) for prior decisions, gotchas, anti-patterns
- [ ] Search for similar features in the codebase — reuse opportunities
- [ ] Check dependencies — what libraries exist that could help?

### Step 6: Connection Mapping

For every system the feature touches, document:

```
SYSTEM: [name]
  Current state: [what it does now]
  Impact: [how the new feature affects it]
  Risk: [what could break]
  Dependency: [does the feature need this, or does this need the feature?]
```

**Think broadly.** A "kanban board" touches:
- The sticky notes data model (obviously)
- The email notification system (column moves = status changes?)
- The staff permission system (who can move cards?)
- The mobile/responsive layout (drag-drop on mobile?)
- The audit log (track who moved what when?)
- The supplier portal (do external users see the board?)
- The search system (can you search by kanban column?)
- The reporting system (time-in-column metrics?)

**The goal is to find connections the user hasn't considered.**

### Step 7: Implication Surfacing

Compile your findings into a structured presentation for the user:

```
DISCOVERY REPORT
════════════════

WHAT I FOUND IN THE CODEBASE:
- [Key finding 1 — current state of the system]
- [Key finding 2 — existing patterns/code to reuse]
- [Key finding 3 — technical constraints discovered]

CONNECTIONS DISCOVERED:
- [System X] — [how it's affected, what needs to change]
- [System Y] — [how it's affected, what needs to change]

HAVE YOU CONSIDERED:
- [Implication 1 — something they definitely haven't thought of]
- [Implication 2 — edge case or user scenario]
- [Implication 3 — integration point or side effect]

REUSE OPPORTUNITIES:
- [Existing code/pattern 1 — what we can build on]
- [Existing library 1 — already in dependencies]

RISKS I SEE:
- [Risk 1 — what could go wrong, how to mitigate]
- [Risk 2 — what could go wrong, how to mitigate]
```

**Present this to the user.** Ask:
> "Here's what I found. Anything here change your thinking? Any of the 'have you considered' items you want to include or explicitly exclude?"

**Wait for their response.** Their answers shape the technical design.

### Step 8: Existing Assets Inventory

List everything in the codebase that can be reused:
- Existing components that do similar things
- Existing services with patterns to follow
- Existing database tables with joinable relationships
- Libraries already installed
- Test utilities and patterns already established

**The best code is code you don't write.** Reuse aggressively.

---

## PHASE 2.5: PRODUCT DESIGN (Before Engineering)

Goal: Design the PRODUCT, not just the code. Technical architecture serves the user experience, not the other way around. This phase produces the product sections of the TDD.

**This phase is non-negotiable.** Skip it and you'll build something technically correct that nobody wants to use.

### Step 8b: User Personas & Journeys

Who uses this? What do they do? Map every user type:

```
PERSONA: [role — e.g., store owner, admin, end customer, API consumer]
  Goal: [what they're trying to accomplish]
  Context: [where they are when they use this — mobile? desktop? in a rush?]
  Journey:
    1. [trigger — what makes them start]
    2. [action — what they do first]
    3. [decision — what choices do they face]
    4. [result — what they see when done]
    5. [next — what they do after]
  Pain points: [what's frustrating about the current way]
  Success: [what "done" looks like for them]
```

If the product has multiple user types (merchant + customer, admin + staff, API + UI), map ALL of them. A feature that's great for admins but invisible to customers is half-designed.

### Step 8c: UI/UX Design

For every screen/view/page the feature touches:

```
SCREEN: [name]
  Purpose: [what the user accomplishes here]
  Entry points: [how they get here — nav link? notification? deep link?]
  Layout:
    - [region 1]: [what's shown — list, form, chart, card]
    - [region 2]: [what's shown]
    - [actions]: [buttons, links, toggles — what the user can DO]
  States:
    - Empty: [what shows when there's no data]
    - Loading: [skeleton? spinner? progressive?]
    - Error: [what shows when something fails]
    - Success: [confirmation, redirect, toast?]
    - Edge: [too much data? missing permissions? expired?]
  Mobile: [how it adapts — responsive? different layout? hidden features?]
  Accessibility: [keyboard nav? screen reader? color contrast?]
```

**Rules:**
- Never design a feature that's desktop-only without asking
- Never assume users will read instructions — design for scanning
- Loading and error states are not optional — design them
- Empty states are landing pages — make them useful

### Step 8d: Workflow & Business Logic

Map the business rules — these drive the data model, not the other way around:

```
WORKFLOW: [name — e.g., "order refund", "product approval", "subscription renewal"]
  Trigger: [what starts it]
  States: [lifecycle — draft → pending → approved → active → archived]
  Transitions:
    draft → pending: [who can do this? what validation runs?]
    pending → approved: [who approves? auto or manual? timeout?]
    approved → active: [what side effects? notifications? integrations?]
  Business rules:
    - [rule 1 — e.g., "refunds over $500 require manager approval"]
    - [rule 2 — e.g., "products can't be archived while they have open orders"]
    - [rule 3 — e.g., "subscription billing retries 3 times then pauses"]
  Notifications:
    - [who gets notified at each transition? email? in-app? webhook?]
  Audit:
    - [what's logged? who changed what when?]
```

### Step 8e: Platform Context

Detect the project type and apply platform-specific design thinking:

| If project is... | Consider... |
|---|---|
| **Shopify app** | App extensions, theme blocks, admin UI, OAuth, App Bridge, Polaris components, webhook subscriptions, billing API, app proxy |
| **Mobile app** | Navigation patterns, offline support, push notifications, app store guidelines, deep links, gestures, battery/data usage |
| **SaaS platform** | Multi-tenancy, onboarding flow, subscription tiers, trial experience, settings pages, team/invite management |
| **API/backend** | Developer docs, API versioning, rate limits, webhook delivery, SDK generation, sandbox environment |
| **CLI tool** | Help text, flags vs interactive, output formats (JSON/table/plain), pipe-friendly, progress indicators |
| **Browser extension** | Popup vs sidebar vs content script, permissions, cross-origin, storage limits |
| **E-commerce** | Product catalog, cart, checkout, payment, fulfillment, returns, inventory, multi-currency |
| **Internal tool** | Permissioning, audit trails, bulk operations, data export, integration with existing internal systems |

**Use the codebase to detect project type.** Check package.json, config files, existing UI framework, dependencies. Don't ask the user — figure it out.

### Step 8f: Integration & Ecosystem

What external systems does this touch?

```
INTEGRATION: [system — e.g., Stripe, Shopify, SendGrid, S3]
  Direction: [inbound? outbound? bidirectional?]
  Data flow: [what data moves, in what format]
  Auth: [API keys? OAuth? webhook signatures?]
  Failure mode: [what happens when it's down?]
  Rate limits: [what are they? how do we handle?]
  Testing: [sandbox? mock? test mode?]
```

**Present all of Phase 2.5 to the user** alongside the Phase 2 discovery report. The combined output should paint a complete picture: here's who uses it, here's what they see, here's the business logic, here's what I found in the code.

---

## PHASE 3: ENGINEER (You Alone — Produce Full TDD)

Goal: Produce a complete Technical Design Document autonomously. The user doesn't need to understand or approve individual technical decisions — they approved the intent and reviewed the implications. Now you engineer it.

### Step 9: Data Model Design

```markdown
## Data Model

### New Tables
| Table | Purpose | Key Columns | Relationships |
|-------|---------|-------------|---------------|
| [name] | [why] | [columns with types] | [FK relationships] |

### Schema Changes to Existing Tables
| Table | Change | Migration Strategy | Rollback |
|-------|--------|-------------------|----------|
| [name] | [add/modify column] | [IF NOT EXISTS, defaults] | [how to undo] |

### Indexes
| Table | Index | Purpose | Type |
|-------|-------|---------|------|
| [name] | [columns] | [what query it speeds up] | btree/gin/etc |
```

**Rules:**
- Every table gets `tenant_id` (multi-tenant)
- Every timestamp is `TIMESTAMPTZ` (timezone-aware)
- Every migration uses `IF NOT EXISTS` guards
- Every FK has `ON DELETE` behavior defined
- Consider: soft delete vs hard delete, audit columns, versioning

### Step 10: API Contract Design

```markdown
## API Contracts

### [METHOD] /api/[path]
**Purpose:** [what it does]
**Auth:** [required | public | webhook]
**Request:**
```json
{
  "field": "type — description — required/optional — validation"
}
```
**Response (200):**
```json
{
  "field": "type — description"
}
```
**Error Responses:**
| Status | Code | When |
|--------|------|------|
| 400 | VALIDATION_ERROR | [condition] |
| 404 | NOT_FOUND | [condition] |
| 403 | FORBIDDEN | [condition] |
```

**Rules:**
- Every write endpoint has auth + permission check
- Every query scopes to tenant_id
- Every input is validated and parameterized
- Error responses include machine-readable codes
- Rate limiting considered for public/webhook endpoints

### Step 11: Architecture & Data Flow

```markdown
## Architecture

### Data Flow
[Trace the complete path for each major operation]

User action → Component → Hook/State → API call → Route → Middleware →
Service → Database → Response → State update → UI re-render

### Component Design
| Component | Purpose | Props | State | Events |
|-----------|---------|-------|-------|--------|
| [name] | [what it renders] | [inputs] | [local state] | [emitted events] |

### State Management
| State | Owner | Consumers | Update Pattern |
|-------|-------|-----------|----------------|
| [name] | [hook/store] | [components] | [how it updates] |
```

### Step 12: Threat Model

```markdown
## Security & Threat Model

### Attack Surface
| Vector | Risk | Mitigation |
|--------|------|------------|
| SQL injection | [risk level] | Parameterized queries, input validation |
| XSS | [risk level] | Output encoding, CSP headers |
| CSRF | [risk level] | Token validation |
| Auth bypass | [risk level] | Middleware chain verification |
| Data exposure | [risk level] | Tenant scoping, field filtering |
| Privilege escalation | [risk level] | Role checks on every write |

### Tenant Isolation
- Every query: WHERE tenant_id = $X
- Every insert: includes tenant_id
- Every API response: filtered by tenant

### Input Validation
| Endpoint | Field | Validation | On Failure |
|----------|-------|-----------|------------|
| [path] | [field] | [rules] | [400 + message] |
```

### Step 13: Failure Mode Analysis

```markdown
## Failure Modes

### What Can Break
| Failure | Probability | Impact | Detection | Recovery |
|---------|-------------|--------|-----------|----------|
| DB connection lost | Low | High | Health check | Connection pool retry |
| External API timeout | Medium | Medium | Timeout alarm | Queue + retry |
| Invalid data state | Low | High | Constraint violation | Transaction rollback |
| Concurrent edit conflict | Medium | Low | Version check | Last-write-wins / merge |

### Rollback Plan
- Migration rollback: [exact SQL to undo]
- Feature rollback: [feature flag or revert commit]
- Data rollback: [how to restore data if corrupted]

### Partial State Handling
- [What happens if the operation crashes mid-way?]
- [Are there orphaned records?]
- [Is there a cleanup/heal job needed?]
```

### Step 14: Observability Design

```markdown
## Observability

### Logging Strategy
| Event | Level | Context Included | Purpose |
|-------|-------|-----------------|---------|
| [action success] | info | user_id, entity_id, duration | Audit trail |
| [action failure] | error | user_id, entity_id, error, stack | Debugging |
| [performance threshold] | warn | query, duration, threshold | Performance monitoring |

### Key Metrics (if applicable)
| Metric | Type | What It Tells You |
|--------|------|------------------|
| [name] | counter/gauge/histogram | [insight] |

### Debugging in Production
- "If X breaks at 3AM, here's how on-call diagnoses it:"
  1. [Check this log]
  2. [Run this query]
  3. [Look for this state]

### Alerts (if applicable)
| Condition | Severity | Action |
|-----------|----------|--------|
| [threshold breached] | [warn/critical] | [notification channel] |
```

### Step 15: Approach Selection

Present 2-3 approaches with clear recommendation:

```markdown
## Approaches Considered

### Approach A: [Name] (RECOMMENDED)
[2-3 sentence description]
**Pros:** [benefits]
**Cons:** [drawbacks]
**Best when:** [circumstances]
**Estimated complexity:** [file count, migration count]

### Approach B: [Name]
[2-3 sentence description]
**Pros:** [benefits]
**Cons:** [drawbacks]
**Best when:** [circumstances]

### Why Approach A
[Clear reasoning — reuse, simplicity, alignment with existing patterns]
```

### Step 16: TDD Capture

Compile everything into the Technical Design Document:

**Save to:** `docs/designs/YYYY-MM-DD-<slug>-tdd.md`

```markdown
# Technical Design Document: [Title]
**Date:** YYYY-MM-DD | **Author:** Enterprise Architect Agent
**Status:** DRAFT → APPROVED → IMPLEMENTED

## 1. Problem Statement
[From EXTRACT — the user's words, refined]

## 2. Success Criteria
[From EXTRACT — measurable outcomes]

## 3. Discovery Summary
[From DISCOVER — key findings, connections, implications]

## 4. Approach
[Selected approach with rationale]

## 5. Data Model
[From Step 9]

## 6. API Contracts
[From Step 10]

## 7. Architecture
[From Step 11]

## 8. Security
[From Step 12]

## 9. Failure Modes
[From Step 13]

## 10. Observability
[From Step 14]

## 11. Reuse Inventory
[From Step 8 — existing code being leveraged]

## 12. Risks & Mitigations
[From DISCOVER — risks with mitigation strategies]

## 13. Open Questions
[Anything unresolved — flagged for human decision]
```

### Step 17: Quality Gate (Objective Checks)

Score the TDD using OBJECTIVE, countable checks — not subjective impressions.

| Criterion | Objective Check | Pass If |
|-----------|----------------|---------|
| **Banned Words** | `grep -ciE 'probably\|consider\|try to\|might\|maybe\|could potentially\|as needed' tdd.md` | Count = 0 |
| **Section Count** | Count sections present vs 13 required | All 13 present (N/A with reasoning counts) |
| **Table Specificity** | For Data Model: every column has an explicit type. For API: every field has a type. | Zero typeless columns/fields |
| **YAGNI** | `grep -ciE 'future\|later\|eventually\|phase 2\|v2\|extensible\|configurable' tdd.md` | Count = 0 (or each instance justified in Open Questions) |
| **Threat Coverage** | Count relevant OWASP vectors. Count mitigations. | `mitigations >= vectors` |
| **Reuse Ratio** | Count existing files referenced vs new files proposed. | `existing_reused / (existing_reused + new_files) >= 0.3` or justified |
| **Testability** | For each proposed feature, write a 1-line `expect()` skeleton. | Every feature has a concrete test skeleton |
| **Rollback Exists** | Rollback Plan section has exact SQL or exact revert steps | Not empty, not "TBD" |

**If any criterion fails:** Fix it before presenting. Don't present a draft — present a finished TDD.

**Why objective checks?** In auditing, subjective checks like "is this testable?" always passed because the reviewer assumed their own design was testable. Counting banned words and requiring concrete skeletons eliminates this self-serving bias.

### Step 18: Present to User

```
Your Technical Design Document is ready.

[Brief summary — 3-4 sentences of what you're building and how]

Approach: [selected approach name]
New tables: [N] | New endpoints: [N] | Files affected: [N]
Estimated tier: [tier]

Full TDD: docs/designs/YYYY-MM-DD-<slug>-tdd.md

Ready to proceed to implementation planning? (/enterprise-plan)
Or do you want to review/change anything first?
```

---

## SCALING BY TIER

| Phase | Micro | Small | Medium | Large |
|-------|-------|-------|--------|-------|
| EXTRACT | Skip (task is clear) | 1-2 questions | 3-4 questions | 3-4 questions + follow-ups |
| DISCOVER | Skip | Read key files, brief surface | Explore agent, full surface | Parallel explore agents, deep surface |
| ENGINEER | Skip (go to plan) | Lightweight TDD (some sections N/A) | Full TDD | Full TDD + architecture diagrams |
| Quality Gate | Skip | Quick check | Full scoring | Full scoring + peer review |

---

## ANTI-PATTERNS

| Don't | Do Instead |
|-------|-----------|
| Ask the user about schemas | Design the schema yourself, present it |
| Ask the user about API contracts | Design the API yourself, present it |
| Ask the user about security | Do the threat model yourself, present findings |
| Present multiple technical options to non-technical user | Pick the best one, explain why in plain language |
| Use jargon in user-facing communication | Translate: "We need a database migration" → "I need to add some new columns to store kanban positions" |
| Skip discovery because the task "seems simple" | Simple tasks in complex systems have hidden connections |
| Design for hypothetical future requirements | Solve the stated problem. Note future possibilities in "Open Questions" |
| Propose new patterns when existing ones work | Reuse aggressively. New patterns need strong justification. |

---

## HANDOFF

When the TDD is complete and approved, the next stage depends on the pipeline path:

- **FULL path:** Proceed to `/enterprise-stack-review` — technology decisions are locked before planning begins. The stack review reads this TDD to determine which decision domains are needed.
- **QUICK/STANDARD path:** Skip stack review, proceed directly to `/enterprise-plan`.
