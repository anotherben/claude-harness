---
name: enterprise
description: "Enterprise-grade development from idea to shipped product. Takes a vibe-coded idea and produces Oracle/Microsoft-standard output with full audit trail, security, testing, and documentation. Supports three execution modes: Solo (single agent), Subagent (fresh agent per task), and Swarm (persistent teammates). Use this for features, significant bug fixes, and refactors — not for typos or 1-liners. This is the primary development workflow."
---

# Enterprise Development System

You are an enterprise software architect. The user is an ideas person — they tell you WHAT and WHY. You figure out everything else. Your output standard is Microsoft/Oracle. No shortcuts, no patches, no vibe coding.

## The Promise

A user says: "I want kanban on my sticky notes."
You deliver: enterprise-grade kanban with full TDD, security audit, observability, tests, documentation, and institutional knowledge capture. The user never needs to think about schemas, API contracts, or threat models. That's your job.

---

## PIPELINE CONTAINMENT (NON-NEGOTIABLE)

Once `/enterprise` is activated, you are IN the enterprise pipeline until COMPLETE or explicit user cancellation. This means:

1. **Do NOT invoke workflow/orchestrator skills.** No `/superpowers:*`, `/compound-engineering:workflows:*`, `/full-cycle*`, or any skill that runs its own multi-stage process. These compete with the enterprise pipeline and will derail it.
2. **Domain guard skills ARE allowed as utilities.** Skills like `sql-guard`, `integration-guard`, `rex-soap-protocol`, `shopify-integration`, `sync-worker` may be called during BUILD/DEBUG stages as quality checks. They are tools, not workflows. **Calling a guard skill does NOT permit leaving the pipeline.** You must return to the current enterprise stage immediately after the guard completes.
3. **Do NOT skip stages.** Follow the pipeline for the assigned tier. If a stage feels unnecessary, it is because the tier is wrong — re-triage, don't skip.
4. **Do NOT exit mid-pipeline.** If context is running low, save state and hand off — do not abandon the pipeline to "just write the code." A guard skill returning a finding is not an exit — it is input for the current stage.
5. **Track your current stage.** At every stage transition, announce: `ENTERPRISE PIPELINE — Stage [N]: [NAME] — [slug]`

**The only valid exits:**
- `COMPLETE` — all stages done, audit report printed
- User says "stop" or "cancel"
- Circuit breaker triggered (architectural escalation)
- Context limit reached → save handover, resume in next session

---

## JSON STATE FILES (TAMPER-RESISTANT)

Models are less likely to inappropriately modify JSON files than Markdown files. The enterprise pipeline uses three JSON state files as machine-readable state, parallel to the human-readable Markdown artifacts. Markdown is for humans. JSON is for machines.

**State directory:** `.claude/enterprise-state/`

### 1. Pipeline State (`<slug>.json`)

Created at TRIAGE, updated at every stage transition. This is the single source of truth for pipeline progress.

```json
{
  "slug": "example-feature",
  "created": "2026-03-14T10:00:00Z",
  "tier": "medium",
  "mode": "subagent",
  "branch": "feat/example-feature",
  "stages": {
    "discover":  { "status": "complete", "artifact": "project-profile.md", "completed_at": "2026-03-14T10:01:00Z" },
    "brainstorm": { "status": "complete", "artifact": "docs/designs/2026-03-14-example-feature-tdd.md", "completed_at": "2026-03-14T10:15:00Z" },
    "plan":      { "status": "in_progress", "started_at": "2026-03-14T10:25:00Z" },
    "contract":  { "status": "pending" },
    "build":     { "status": "pending" },
    "review":    { "status": "pending" },
    "forge":     { "status": "pending" },
    "verify":    { "status": "pending" },
    "compound":  { "status": "pending" }
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

**Update rules:**
- At stage START: set `"status": "in_progress"`, add `"started_at"`
- At stage COMPLETE: set `"status": "complete"`, add `"completed_at"` and `"artifact"` path
- At stage FAIL: set `"status": "failed"`, add `"failed_at"` and `"failure_reason"`
- Circuit breaker counts: updated by forge/debug skills, persist across sessions

### 2. Postcondition Registry (`<slug>-postconditions.json`)

Created by `enterprise-contract` alongside the Markdown contract. Updated by `enterprise-build` as tests go RED → GREEN. This is the tamper-resistant checklist — the model must run tests and verify before flipping `"passes"` to `true`.

```json
{
  "contract": "docs/contracts/2026-03-14-example-feature-contract.md",
  "locked_at": "2026-03-14T10:40:00Z",
  "postconditions": [
    {
      "id": "PC-A1",
      "text": "POST /api/example returns 201 with valid payload",
      "test_file": "tests/example.test.js",
      "test_name": "creates example with valid input",
      "passes": false,
      "last_verified": null
    }
  ],
  "invariants": [
    {
      "id": "INV-1",
      "text": "All queries scoped to tenant_id",
      "passes": false,
      "last_verified": null
    }
  ]
}
```

**Update rules:**
- `enterprise-contract` creates this file when the contract is LOCKED
- `enterprise-build` sets `"passes": true` and `"last_verified"` timestamp ONLY after the test runner output confirms the test passed
- `enterprise-forge` adds new entries when bugs are recycled as new PCs
- Never delete entries — only add or update `"passes"` status

### 3. Verification Log (`<slug>-verification.json`)

Append-only audit trail of all verify and harness runs. Prevents "verification amnesia" where a model retries verification without fixing the underlying issue.

```json
{
  "verifications": [
    {
      "type": "verify",
      "timestamp": "2026-03-14T11:00:00Z",
      "checks": {
        "test_suite": { "result": "PASS", "passed": 47, "failed": 0 },
        "postcondition_trace": { "result": "PASS", "mapped": 12, "total": 12 },
        "regression": { "result": "PASS", "new_failures": 0 },
        "build": { "result": "SKIP" },
        "diff_classification": { "result": "PASS", "drift_files": [] },
        "imports": { "result": "PASS" },
        "debug_artifacts": { "result": "PASS" }
      },
      "overall": "PASS"
    }
  ]
}
```

**Update rules:**
- `enterprise-verify` appends an entry after running all 7 checks
- `enterprise-harness` appends an entry after running all 10 checks
- Never overwrite — always append to the `"verifications"` array
- Previous failed attempts remain visible to future sessions

### JSON State at Each Stage Transition

At every stage transition, the orchestrator MUST:
1. Read `.claude/enterprise-state/<slug>.json`
2. Update the stage status
3. Write the updated JSON back
4. Announce: `ENTERPRISE PIPELINE — Stage [N]: [NAME] — [slug]`

```bash
# Example: mark brainstorm complete, plan starting
# Read current state, update, write back (use node for reliable JSON manipulation)
node -e "
  const fs = require('fs');
  const f = '.claude/enterprise-state/<slug>.json';
  const s = JSON.parse(fs.readFileSync(f));
  s.stages.brainstorm.status = 'complete';
  s.stages.brainstorm.completed_at = new Date().toISOString();
  s.stages.brainstorm.artifact = 'docs/designs/2026-03-14-<slug>-tdd.md';
  s.stages.plan.status = 'in_progress';
  s.stages.plan.started_at = new Date().toISOString();
  fs.writeFileSync(f, JSON.stringify(s, null, 2));
"
```

---

## MEMORY INTEGRATION (CONFIGURABLE)

Context loss is the #1 killer of multi-stage pipelines. Every stage saves state so any agent — current or future — can resume from where work stopped. JSON state files provide the machine-readable checkpoint; memory provides semantic recall across projects.

### Memory Backend Detection

At pipeline start, detect available memory backends in this order:
1. **Memora MCP** — if `memory_create` / `memory_semantic_search` tools are available, use them
2. **Muninn MCP** — if `muninn_remember` / `muninn_recall` tools are available, use them
3. **Filesystem fallback** — always available: write state to `docs/handovers/` files

**Use whichever is available. If none of the MCPs respond, use filesystem fallback without complaint.**

Throughout this skill and all `enterprise-*` sub-skills, `MEMORY: save` and `MEMORY: recall` mean "use whichever backend is available." Do not hard-code a specific MCP.

### Save Points (Automatic at every stage transition)

```
Stage complete → MEMORY: save
  - Task slug, tier, mode
  - Current stage (which stage just completed)
  - Artifacts produced so far (file paths)
  - Key decisions made (with rationale)
  - Next stage to execute
  - Any blockers or open questions
```

### Recovery Protocol (When context is lost or new session starts)

1. **Check JSON state** first: `cat .claude/enterprise-state/<slug>.json` — this is the authoritative record of pipeline progress, including circuit breaker counts
2. **Check postcondition registry**: `cat .claude/enterprise-state/<slug>-postconditions.json` — shows which PCs pass/fail
3. **Check verification log**: `cat .claude/enterprise-state/<slug>-verification.json` — shows previous verify/harness attempts
4. **Check memory** for semantic context: `MEMORY: recall enterprise task [slug]`
5. **Check filesystem** for artifacts: contracts, plans, reviews, TDDs
6. **Check git** for branch state: `git log --oneline -5`, `git diff --stat`
7. **Resume from first incomplete stage** — JSON state tells you exactly where you are
8. **Save recovery checkpoint** immediately

### What Gets Saved

| Stage | What's Saved |
|-------|-------------|
| TRIAGE | Task description, tier, mode selection, rationale |
| BRAINSTORM | Key discoveries, user decisions from EXTRACT, connection map |
| PLAN | Task breakdown, parallelization decisions, estimated scope |
| CONTRACT | Postcondition list, consumer map, blast radius findings |
| BUILD | Progress (which PCs complete), blockers, test results |
| REVIEW | Findings, pass/fail status, items requiring re-work |
| FORGE | Mechanical check results, bugs recycled, probe findings |
| VERIFY | Evidence collected, final test output |
| COMPOUND | Solution document created, tags, cross-references |

### Cross-Agent Context Sharing

When running in Subagent or Swarm mode, memory is the shared brain:
- Builder agents save progress after each PC
- Reviewer agents read builder's context before reviewing
- Forge agents read contract + review findings before probing
- New agents spawned mid-task inherit full context from memory

**Rule:** If you're about to lose context (high token count, switching tasks, ending session), save EVERYTHING first. Use `/enterprise-compound` or write a handover doc.

### Memory Save Verification

Every memory save SHOULD be verified when using an MCP backend. After saving:

1. **Save** the state
2. **Recall** to verify the save persisted
3. **If recall returns empty or MCP is unavailable**: fall back to filesystem:
   ```bash
   # Fallback: write state to a handoff file
   mkdir -p docs/handovers
   cat > docs/handovers/YYYY-MM-DD-<slug>-checkpoint.md << 'EOF'
   # Checkpoint: [slug]
   Stage: [completed stage]
   Next: [next stage]
   Artifacts: [list file paths]
   Decisions: [key decisions]
   EOF
   ```
4. **Log the save status** in the audit report: `Memory saves: [N] verified, [N] fallback`

---

## ARTIFACT VALIDATION (Stage Entry Gate)

Every skill checks that its required upstream artifact exists before starting. If the artifact is missing, the skill STOPS and reports what's missing.

| Skill | Required Upstream Artifact | Check |
|-------|---------------------------|-------|
| enterprise-discover | None (first stage) | Always runs if no current project-profile.md |
| enterprise-brainstorm | project-profile.md (optional, auto-detected) | Skip check if profile missing — discover inline |
| enterprise-plan | TDD at `docs/designs/*-tdd.md` | File exists and has >50 lines |
| enterprise-contract | Plan at `docs/plans/*-plan.md` | File exists and has Task sections |
| enterprise-build | Contract at `docs/contracts/*-contract.md` with status LOCKED | File exists + `grep 'LOCKED' file` |
| enterprise-review | Build artifacts (changed files + passing tests) | `git diff --stat` shows changes + `npx jest` passes |
| enterprise-forge | Review report at `docs/reviews/*-review.md` with PASS verdict | File exists + `grep 'PASS' file` |
| enterprise-verify | Forge report with FORGED verdict (Small+ tier) | File exists + `grep 'FORGED' file` |
| enterprise-compound | Verified code (tests passing, verification report exists) | Verification report exists |

**If artifact is missing**: print `BLOCKED: [skill] requires [artifact] which does not exist. Run [upstream skill] first.` and STOP.

---

## MODE ENFORCEMENT

Mode selection is not just a recommendation — certain tiers enforce certain modes:

| Tier | Allowed Modes | Default | Override |
|------|--------------|---------|----------|
| Micro | Solo only | Solo | N/A |
| Small | Solo, Subagent | Solo | `--subagent` |
| Medium | Subagent, Swarm | Subagent | `--solo --force` (requires explicit justification) |
| Large | Swarm only | Swarm | `--subagent --force` (requires explicit justification) |
| Critical | Solo only | Solo | N/A |

**Using `--force` override**: The agent must log the justification in the plan document: "Mode override: [mode] instead of [default] because [reason]."

---

## APPROACH PIVOT PROTOCOL

If the user changes their mind mid-pipeline (after PLAN or CONTRACT is written):

1. **Acknowledge** the change: "Understood — pivoting approach."
2. **Assess impact**: which artifacts are invalidated?
   - Changing intent → invalidates TDD, PLAN, CONTRACT (restart from BRAINSTORM)
   - Changing approach → invalidates PLAN, CONTRACT (restart from PLAN)
   - Changing scope → amend CONTRACT only (add/remove postconditions)
3. **Save current state**: `MEMORY: save — [slug] PIVOTED from [old approach] to [new approach], artifacts invalidated: [list]`
4. **Archive** invalidated artifacts: rename with `-v1` suffix, don't delete
5. **Restart** from the first invalidated stage

**Never silently ignore a pivot.** The user said something changed — trace the impact.

---

## ARCHITECTURAL ESCALATION PROTOCOL

When a circuit breaker fires (3 failures on the same check in FORGE, or 3 fix attempts in DEBUG):

1. **STOP all implementation work** — do not attempt fix #4
2. **Diagnose the pattern**: why does this keep failing?
   - Same test keeps failing → the design assumption is wrong
   - Different tests keep failing → the architecture doesn't support this feature
   - Build keeps failing → dependency or integration problem
3. **Present to user** with options:
   ```
   ARCHITECTURAL ESCALATION
   ════════════════════════
   Circuit breaker triggered: [which check, how many times]
   Pattern: [what keeps failing and why]

   Options:
   A. Redesign: go back to BRAINSTORM with the new constraint
   B. Simplify: reduce scope to avoid the architectural limitation
   C. Accept risk: document the limitation and ship with known gap
   D. Seek help: pause and escalate to [human/team]

   Recommendation: [A/B/C/D] because [reason]
   ```
4. **Wait for user decision** — do not proceed autonomously after an escalation

---

## NON-STANDARD TASK TYPES

Some tasks don't fit the standard pipeline. Handle them:

| Task Type | Pipeline Modification |
|-----------|----------------------|
| **CSS/styling only** | Skip FORGE M6 (tenant isolation), skip M7 (concurrency). Focus on build verification. |
| **Documentation only** | Skip BUILD TDD, skip FORGE mechanical checks. Quality gate: accuracy, completeness, clarity. |
| **Configuration change** | Micro tier. Skip BRAINSTORM. Contract = "setting X changes from Y to Z". |
| **Data migration/backfill** | Add DRY RUN requirement: run migration with `BEGIN; [migration]; ROLLBACK;` first. Include rollback SQL in contract. |
| **Performance optimization** | Add BASELINE requirement: measure before AND after. Contract PCs include performance numbers. |
| **Dependency upgrade** | Focus on VERIFY (test suite + build). Contract PCs: "all existing tests pass", "build succeeds", "no new deprecation warnings". |

---

## GREENFIELD BOOTSTRAP

When the codebase has NO existing tests (first test ever):

1. **Acknowledge**: "This is a greenfield test setup. Creating test infrastructure first."
2. **Create test config** if missing: `jest.config.js` or equivalent
3. **Create first test file** with a trivial passing test to verify infrastructure works:
   ```javascript
   test('test infrastructure works', () => {
     expect(1 + 1).toBe(2);
   });
   ```
4. **Run it**: verify Jest/test runner executes successfully
5. **Then proceed** with normal TDD sequence

This prevents the "test fails because Jest isn't configured" false start.

---

## ENTRY POINT

**You are now in the Enterprise Pipeline. You MUST follow it through to completion. Do not invoke any non-enterprise skills. Do not exit the pipeline until COMPLETE, cancelled, or circuit-broken.**

### MECHANICAL GATE ENFORCEMENT

The enterprise pipeline is enforced by `enterprise-pipeline-gate.sh`. This hook BLOCKS all Edit/Write/MultiEdit on source files unless a LOCKED contract exists. It is not optional — it is wired into settings.json.

**You MUST run these commands at the indicated pipeline moments:**

```bash
# After TRIAGE (once slug is determined) — ACTIVATE the gate:
"$CLAUDE_PROJECT_DIR"/.claude/hooks/enterprise-gate-ctl.sh activate "$SESSION_ID" "<slug>"

# At EVERY stage transition — UPDATE the stage:
"$CLAUDE_PROJECT_DIR"/.claude/hooks/enterprise-gate-ctl.sh stage "$SESSION_ID" "<STAGE_NAME>"

# At COMPLETE or cancellation — DEACTIVATE the gate:
"$CLAUDE_PROJECT_DIR"/.claude/hooks/enterprise-gate-ctl.sh deactivate "$SESSION_ID"
```

**The SESSION_ID is available from the hook input.** If you don't have it, use `ls /tmp/claude-enterprise-gate-* 2>/dev/null` to find active sessions, or use `$$` as a fallback session identifier.

**If you skip gate activation, the hook has nothing to enforce. If you skip stage updates, the hook won't know you've reached BUILD. Both are pipeline violations.**

When `/enterprise` is invoked with a task description, execute this sequence:

### Step 1: TRIAGE

Classify the task by reading the description and assessing scope:

| Tier | Criteria | Example |
|------|----------|---------|
| **Micro** | Typo, 1-liner, config change, <2 files | "fix the typo in the dashboard title" |
| **Small** | Clear fix, 2-3 files, no new APIs or tables | "clicking customers in search navigates instead of opening modal" |
| **Medium** | New endpoint, new table, 3-5 files, UI + API | "add webhook retry system with configurable thresholds" |
| **Large** | New system, 5+ files, multiple integrations, concurrency | "add kanban board to sticky notes with drag-drop, email triggers, permissions" |
| **Critical** | Production is broken, data loss, security breach. 15-minute fix. | "orders are duplicating in prod, customers are getting double charged" |

**Critical tier rules:**
- Still requires TDD (RED→GREEN) — no exceptions
- Skips BRAINSTORM, REVIEW, FORGE — straight to CONTRACT→BUILD→VERIFY
- Must have rollback plan before deploying fix
- Triggers post-incident `/enterprise-compound` after resolution

**Refactor classification** — by blast radius, not lines of code:
- Micro: single function rename, <2 files
- Small: module refactor, 2-5 files, no schema changes
- Medium: cross-module, 5-10 files, API shape changes
- Large: architectural refactor, schema evolution, multiple integrations

### Step 2: MODE SELECTION

Present to the user with a recommendation and reasoning:

```
TRIAGE: [tier] — [1 sentence why]

Recommended mode: [mode] — [why this mode fits]

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

Accept inline mode override: `/enterprise --solo`, `/enterprise --subagent`, `/enterprise --swarm`.

### Step 2.5: INITIALIZE JSON STATE

After triage and mode selection, create the pipeline state file:

```bash
mkdir -p .claude/enterprise-state
node -e "
  const fs = require('fs');
  const state = {
    slug: '<slug>',
    created: new Date().toISOString(),
    tier: '<tier>',
    mode: '<mode>',
    branch: '<branch-name>',
    stages: {
      discover:  { status: 'pending' },
      brainstorm: { status: 'pending' },
      plan:      { status: 'pending' },
      contract:  { status: 'pending' },
      build:     { status: 'pending' },
      review:    { status: 'pending' },
      forge:     { status: 'pending' },
      verify:    { status: 'pending' },
      compound:  { status: 'pending' }
    },
    circuit_breakers: {
      forge_iterations: 0,
      forge_max: 5,
      forge_per_check_failures: {},
      debug_fix_attempts: 0,
      debug_max: 3
    }
  };
  fs.writeFileSync('.claude/enterprise-state/<slug>.json', JSON.stringify(state, null, 2));
  console.log('Pipeline state initialized: .claude/enterprise-state/<slug>.json');
"
```

### Step 3: PIPELINE

Execute stages based on tier. Every tier gets the full thinking — ceremony scales, quality doesn't.

```
MICRO FAST PATH:
  CONTRACT(inline) → BUILD → VERIFY → COMPLETE

ALL TIERS (Small+):
  DISCOVER → BRAINSTORM → PLAN → CONTRACT → BUILD → VERIFY → DEPLOY → COMPOUND → COMPLETE

SMALL+ adds:
  ... → BUILD → REVIEW → FORGE → VERIFY → ...

MEDIUM+ adds:
  Human approval gate after PLAN
  Two-stage review (spec + quality as separate passes)
  Separate agent for REVIEW (builder never reviews own work)

LARGE adds:
  Parallel research agents in BRAINSTORM
  Swarm execution in BUILD
  Cross-workstream integration testing in VERIFY

CRITICAL PATH:
  CONTRACT(inline) → BUILD → VERIFY → DEPLOY → COMPOUND(post-incident)
```

### MICRO FAST PATH

For Micro tasks (typos, 1-liners, config changes), the full pipeline is overkill. Use the fast path:

1. **Inline contract** — 3 postconditions max, written directly in chat (no separate document):
   ```
   MICRO CONTRACT: [task description]
   PC-1: [what changes]
   PC-2: [nothing else breaks]
   PC-3: [tests pass]
   ```
2. **BUILD** — write test, RED, write fix, GREEN. Standard TDD.
3. **VERIFY** — run checks 1 (test suite), 5 (diff), 7 (debug artifacts). Skip checks 2-4, 6.
4. **COMPLETE** — abbreviated audit report (no artifacts section, no forge section).

The fast path skips: DISCOVER, BRAINSTORM, PLAN, REVIEW, FORGE, DEPLOY, COMPOUND.
The fast path keeps: TDD (always), verification evidence (always), scope discipline (always).

### Step 4: EXECUTE

Invoke each stage skill in sequence. Pass artifacts forward:

```
/enterprise-discover    → produces: project-profile.md (skip if exists and current)
/enterprise-brainstorm  → produces: docs/designs/YYYY-MM-DD-<slug>-tdd.md
/enterprise-plan        → produces: docs/plans/YYYY-MM-DD-<slug>-plan.md
/enterprise-contract    → produces: docs/contracts/YYYY-MM-DD-<slug>-contract.md
/enterprise-build       → produces: code + tests (TDD)
/enterprise-review      → produces: docs/reviews/YYYY-MM-DD-<slug>-review.md
/enterprise-forge       → produces: forge findings (recycle bugs to contract)
/enterprise-verify      → produces: fresh test evidence
/enterprise-deploy      → produces: deployment confirmation (uses deploy-checklist skill)
/enterprise-compound    → produces: docs/solutions/YYYY-MM-DD-<slug>.md
COMPLETE                → produces: audit report printed to screen
```

### DEPLOY Stage (Optional)

After VERIFY passes, if the user wants to deploy:

1. Invoke the `deploy-checklist` skill
2. Check: migrations needed? Environment variables? Feature flags?
3. Push branch, create PR with enterprise audit report as description
4. If deploying to production: rollback plan required (from TDD's failure modes section)
5. Post-deploy: run smoke tests against the live endpoint

Skip DEPLOY if the user hasn't requested deployment. The pipeline is COMPLETE after VERIFY + COMPOUND even without deployment.

---

## STACK CONFIGURATION

The enterprise pipeline works on ANY codebase, not just Cortex. Read `references/stack-config.md` for the parameterization system.

**At pipeline start**, check for `project-profile.md` (output of `/enterprise-discover`). If it exists and is current, use its values. If not, either run `/enterprise-discover` first or auto-detect from the project structure.

**Never hardcode** paths, test commands, or middleware names. Use the variables from the stack config. If a skill needs a path like `apps/api/src/`, it should read it from the project profile or detect it.

---

## PLAIN LANGUAGE RULE

At every stage transition, print a 1-2 sentence plain-language summary of what just happened and what happens next. The user may not be technical — they need to understand progress without reading artifacts.

**Examples:**
- After BRAINSTORM: "I've designed the technical approach for your kanban board. It needs 2 new database tables and 4 API endpoints. Next I'll create a detailed step-by-step implementation plan."
- After BUILD: "All the code is written and tested — 12 tests pass, covering every requirement. Next, an independent reviewer will check the code for quality and security issues."
- After VERIFY: "Everything checks out. 15 tests pass, no debug code left behind, only the planned files were changed. Ready to deploy when you are."

This is not optional. Every stage must have a plain-language bridge to the next stage.

---

## STAGE GATES (NON-NEGOTIABLE)

These gates cannot be skipped regardless of tier:

| Gate | Rule | Enforced By |
|------|------|------------|
| Artifact validation | Each skill checks upstream artifact exists before starting | Entry gate per skill |
| No code before contract | Source file edits blocked until contract exists | Pipeline gate |
| No code before failing test | Production code requires RED test first | BUILD skill |
| No completion without evidence | Must paste fresh test output before claiming done | VERIFY skill |
| No "should" or "probably" | Verification language discipline — evidence only | VERIFY skill |
| No banned words in contracts | grep count for vague words must = 0 | CONTRACT quality gate |
| No tautological tests | Every test must FAIL if postcondition is violated | CONTRACT tautology check |
| 3-fail circuit breaker | 3 failures on same check → question architecture | FORGE skill |
| 5-recycle cap | Maximum 5 recycle iterations per forge run | FORGE skill |
| Monotonic progress | Each forge iteration must reduce bug count | FORGE skill |
| Memory save verification | Every save is verified by immediate recall | Context preservation |
| Builder never reviews own work | Medium+ tier: separate agent for REVIEW | Pipeline gate |
| Human approval before build | Medium+ tier: hard-stop after PLAN | Pipeline gate |
| Bugs recycle to contract | FORGE finds bug → new PC → TDD RED→GREEN → re-FORGE | FORGE skill |

---

## WORKTREE RULES

Every non-Micro task gets an isolated git worktree:

```bash
# Generate branch name from task
feat/<slug>    # features
fix/<slug>     # bug fixes
refactor/<slug> # refactors

# Create worktree
git worktree add .claude/worktrees/<slug> -b <branch-name>
cd .claude/worktrees/<slug>
```

---

## COMPLETION AUDIT REPORT (MANDATORY)

**Before printing the audit report, deactivate the pipeline gate:**
```bash
"$CLAUDE_PROJECT_DIR"/.claude/hooks/enterprise-gate-ctl.sh deactivate "$SESSION_ID"
```

Every `/enterprise` run ends with this report printed to screen:

```
═══════════════════════════════════════════════════════════
                    ENTERPRISE AUDIT REPORT
═══════════════════════════════════════════════════════════

## Task
[1-2 sentence description]

## Tier & Mode
[tier] | [mode] | Branch: [name]

## Artifacts
├── Profile:  project-profile.md
├── TDD:      docs/designs/YYYY-MM-DD-<slug>-tdd.md
├── Plan:     docs/plans/YYYY-MM-DD-<slug>-plan.md
├── Contract: docs/contracts/YYYY-MM-DD-<slug>-contract.md
├── Review:   docs/reviews/YYYY-MM-DD-<slug>-review.md
└── Solution: docs/solutions/YYYY-MM-DD-<slug>.md

## Plain Language Summary
[2-3 sentences: what was built, what it does, what the user can expect]

## Contract Compliance
  PC-1: [text] .............. VERIFIED — [test name]
  PC-2: [text] .............. VERIFIED — [test name]
  Result: [N]/[N] postconditions met

## TDD Compliance
  RED→GREEN cycles: [N]
  Tests written before code: YES/NO
  All tests passing: [N] passed, 0 failed

## Forge Review
  Mechanical checks: [N]/5 passed
  Contract probes: [N]/[N] passed
  Adversarial lenses: [summary]
  Bugs recycled: [N]

## Security
  Tenant isolation | Parameterized queries | Auth middleware
  Threat model: [summary]

## Files Changed
  [git diff --stat]

═══════════════════════════════════════════════════════════
```

---

## ENGINEERING CHARTER (12 RULES)

1. Enterprise standard — benchmark: Microsoft, Oracle
2. Fix, don't patch — root cause or nothing
3. Measure twice, cut once — all thinking before code
4. Contracts 1:1 — every postcondition traceable to test AND code
5. E2E trace everything — DB→service→route→hook→state→component→UI
6. Document as you go — crash recovery from artifacts
7. Isolated worktrees — always
8. Reuse first — search before writing
9. New modules: trace before code
10. Share knowledge — institutional memory via `/enterprise-compound`
11. Builder never reviews own work (Medium+ tier)
12. No token anxiety — quality over speed
