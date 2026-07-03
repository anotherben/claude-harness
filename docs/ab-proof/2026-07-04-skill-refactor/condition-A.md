# Condition A answers — based solely on full-cycle, full-cycle-fast, full-cycle-tdd, full-cycle-research, vault-process, enterprise SKILL.md files

Note on method: for each scenario I picked whichever of the six skill files' own trigger language most directly matches the scenario, then listed only what that file actually specifies. Where two files plausibly match, I say so. Where the files are silent on a sub-question (model routing, exact merge mechanics, etc.), I say "not specified" rather than inventing an answer.

---

## S1 — Typo in refundEmail.js subject line

**Pipeline:** `full-cycle-fast`. Its own description is "quick fixes that are too big for 'just do it'"; a one-file string fix is the paradigm case. (`enterprise`'s `QUICK` path — "tiny, bounded changes with no meaningful architecture ambiguity" — is also a plausible match if this were being routed through `enterprise` instead; the two skill sets overlap and the given files don't say which one wins.)

**Ordered stages (full-cycle-fast):**
1. Context Recall — query knowledge graph for prior context (if configured)
2. Quick Analysis — output TASK / DONE WHEN / FILES / RISK, no formal doc
3. Build — read existing pattern, implement, write tests for new behavior, run tests after each file change
4. Verify + Ship — run full test suite, `git diff --stat`, commit with conventional message, compound gotchas to knowledge graph

**Model/worker per stage:** not specified. The file names no models.

**Ship/merge mechanics:** not specified beyond "commit with conventional message." No PR process, review gate, or merge strategy is described in this file.

---

## S2 — Orders with deleted customer crash invoice endpoint (42703)

**Pipeline:** `enterprise`, `DEBUG` path. This is the only one of the six files that names a distinct root-cause-first path for bugs: *"DEBUG: bug or regression path when the problem is not yet understood; after root cause, continue through plan -> plan-360-audit -> contract-manager before build unless explicitly narrowed to QUICK."* None of the full-cycle variants have a "diagnose first" mode.

**Ordered stages (from enterprise's "Required Workflow" + cross-references):**
1. Decide path or, and required final gates; state them
2. (If applicable) fetch/normalize any GitHub issue intake — n/a here, no issue # given
3. Fetch `origin/dev`, cut a clean feature worktree
4. Resolve/mint agent session (`enterprise-agent-session ensure`)
5. Run `enterprise-required-gates --stage start`
6. Root-cause work (file references `systematic-debugging` skill for this)
7. Plan → `plan-360-audit` (must run immediately after plan) → `contract-manager` (before contract lock/build)
8. Build — mechanical, requires a recorded `build_packet` with exact paths/commands/postconditions; this is a DB-touching change so it also requires a "DB/Query Ownership Packet" (table/source owner, operation type, schema target, tenant/owner scoping, affected-row/readback expectation, bounded proof command, cleanup/rollback, approved writer/reader seam) — file explicitly says schema/query/data claims "require current code reads plus real database proof. Migrations, diffs, and mocks are not enough."
9. Review → Forge → Verify (must be recorded in that order against current diff before any PR/merge-ready claim)
10. `pr-readiness` / `merge` stage gate via `enterprise-required-gates`

**Model/worker per stage:** not specified by symbol/name. The only model-related statement in the file is a general instruction to "Use a GPT-5.5 fresh baseline" for stating outcomes/constraints — this is not stage-specific tiering, and no other model (e.g. anything Claude-branded) is named anywhere in this file.

**Ship/merge mechanics:** the file establishes *that* a `pr-readiness`/`merge` stage gate must pass, and that PR gate requirements come from a "route card" (`route_card.required_pr_gates`, `route_card.required_pr_body_sections`) — but the actual PR body sections, review-thread convergence protocol, and merge strategy (rebase vs. merge, force-with-lease, etc.) are not given in this file; they live in a referenced route-card file not included in what I read. So: not specified in detail.

---

## S3 — SMS notification for repair-ready (never built SMS before)

**Pipeline:** `full-cycle-research`. This is a near-verbatim match to its own trigger table: *"New technology or integration... First time doing X in this project... Use for unfamiliar territory, new integrations, architectural decisions."*

**Ordered stages:**
1. Phase 1 — Define: load Agent Harness Phase 0 (knowledge-graph recall), invoke `compound-engineering:workflows:brainstorm`, save design doc
2. Phase 2 — Create Plan: invoke `compound-engineering:workflows:plan`
3. Phase 3 — Deep Research: invoke `compound-engineering:deepen-plan`, which runs 8+ parallel research agents (best-practices researcher, framework-docs researcher, architecture strategist, performance oracle, security sentinel, code-simplicity reviewer, agent-native reviewer, data-integrity guardian)
4. Phase 4 — Spec Flow Analysis: `compound-engineering:workflow:spec-flow-analyzer`
5. >>> SINGLE CHECKPOINT <<< — present deepened plan, wait for "go"
6. Execution: invoke `compound-engineering:workflows:work` (Agent Harness execution model — work autonomously, Agent Teams for [TEAM] tasks)
7. Post-Execution Review: `compound-engineering:workflows:review` (12+ agents, re-running research-phase agents plus pattern recognition, data migration expert, schema drift detector)
8. Fix Critical Findings: `compound-engineering:resolve_todo_parallel` (P1/P2 in parallel)
9. Compound Learnings: `compound-engineering:workflows:compound`, save to knowledge graph

**Model/worker per stage:** not specified. No model names appear anywhere in this file; the research/review agents are named by *role* (e.g. "security sentinel") not by model.

**Ship/merge mechanics:** not specified. The file never mentions a PR, review-thread process, or merge strategy — it ends at "Compound Learnings."

---

## S4 — productSyncService.js is 700 lines, does 4 jobs, split it up

**Pipeline:** `enterprise`. Its own description explicitly lists "significant refactor" as a trigger. Path is ambiguous between `STANDARD` ("clear feature or fix with moderate blast radius; still runs plan -> plan-360-audit -> contract-manager before build") and `FULL` ("multi-stage work needing discovery, design, contract, adversarial review, and evidence pack") — the file's routing matrix doesn't give a bright line for a 700-line/4-responsibility split, so I can't pick one without more info; both are defensible, honestly.

**Ordered stages:** same generic sequence as S2 (path decision → clean worktree off `origin/dev` → agent session → `enterprise-required-gates --stage start` → plan → `plan-360-audit` → `contract-manager` → build → review → forge → verify → pr-readiness/merge gate), plus this file's specific requirement for refactors:
- A **Touched File SRP Assessment** is required for every touched/created file before source edits: current responsibility evidence, owner layer, one reason to change, known mixed responsibilities, and a `fix-now` / `follow-up` / `note-only` classification. The file states: *"If the file is already doing multiple jobs and this work touches one of them, fix-now is mandatory unless the contract records a blocking reason and narrows the claim."* — directly on-point for this scenario.
- No specific numeric line-count thresholds (e.g. "400 soft/800 hard") appear anywhere in this file — that language is not present in what I read, so I won't assert it as a real gate.
- "Code Placement Law" / "no new files under services/" — not mentioned in this file either.

**Model/worker per stage:** not specified.

**Ship/merge mechanics:** not specified beyond the same generic `pr-readiness`/`merge` gate described in S2.

---

## S5 — Make purchasing dashboard table sortable by supplier column

**Pipeline:** `full-cycle-fast` is the best textual match — "small features... 3-10 file changes with clear requirements... anything that takes 15-60 minutes." (`full-cycle` is a plausible alternate if this is being treated as a full "new feature," and `enterprise` `QUICK`/`STANDARD` is plausible too — the given files don't disambiguate a UI-only, single-component change from these overlapping categories.)

**Ordered stages (full-cycle-fast):** same four as S1 — Context Recall → Quick Analysis → Build → Verify + Ship.

**Model/worker per stage:** not specified.

**Ship/merge mechanics:** not specified beyond "commit with conventional message." Nothing in this file (or any of the six) mentions Playwright, browser verification, or a "purchasing" domain evidence gate — I won't invent one. `enterprise` does have a general line that *"UI, PDF upload, file upload, preview/download, modal, navigation, and rendered-output claims require headless browser proof when verified"* — if this scenario were routed through `enterprise` instead, that clause would apply, but it's not part of `full-cycle-fast`.

---

## S6 — "Why do we resolve copilot threads reply-only instead of pushing?"

**Pipeline:** none of the six files apply. This is a question, not a build/bug/idea/refactor/queue task, and none of the six skill files describe an "answer a question" mode or reference a copilot-thread-resolution policy at all. Correct answer from these files alone: **not specified / no pipeline** — I would just answer directly without invoking any of the six skills.

---

## S7 — "Handle issue #3618."

**Pipeline:** `enterprise`. This is an explicit, named trigger in the file: *"A GitHub issue number or URL is also an enterprise intent front door. Fetch it live, normalize it into a GitHub Issue Intake Packet, and treat the issue body as intake, not proof."* It further specifies: *"Use github-issue-intake.md and `python3 ~/.codex/skills/enterprise/scripts/github_issue_intake.py --repo <owner/name> --issue <number> --json` when `gh` is available."*

**Ordered stages:**
1. Fetch issue #3618 live via the intake script; normalize into a GitHub Issue Intake Packet (issue body = intake, not proof)
2. Path selection: the file gives domain defaults — *"Production-log, schema/query/data, integration, pricing/inventory/order, or lock/transaction issues start as DEBUG or STANDARD_AFTER_SOURCE_VERIFICATION, not freehand build."* Without reading the actual issue content I cannot say which bucket #3618 falls in from these files alone — that determination requires the fetched issue body.
3. Suggested fixes inside the issue must be evaluated as alternatives, not copied directly — turned into a source-grounded plan/contract decision with proof commands
4. From there, same generic gate sequence as S2/S4 (clean worktree off `origin/dev`, agent session, `enterprise-required-gates --stage start`, plan → plan-360-audit → contract-manager, build with build_packet, review → forge → verify, pr-readiness/merge gate)

**Model/worker per stage:** not specified.

**"Yield protocol before claiming":** not present anywhere in this file. I won't assert this gate exists — the file references `agent-session-model.md` and `agent-stage-gates.md` for session state/stage-entry enforcement, but I have not read those files, so I can't describe their content; correct answer is "not specified from what I read."

**Ship/merge mechanics:** not specified in detail, same as S2.

---

## S8 — "Promote dev to production."

**Pipeline:** none of the six given files cover this. None of `full-cycle`, `full-cycle-fast`, `full-cycle-tdd`, `full-cycle-research`, `vault-process`, or `enterprise` mention deployment, promotion, Render, or a `/promote` command anywhere in their text. `enterprise`'s routing matrix (`DISCOVER_ONLY`, `NO_ENTERPRISE`, `QUICK`, `STANDARD`, `FULL`, `DEBUG`) has no category for a production-promotion operation, and `NO_ENTERPRISE` is defined as "local agent, skill, hook, Codex config, or agent-platform maintenance outside the target repo" — which also doesn't fit a prod promotion. Correct answer from these files alone: **not specified** — none of the six skills addresses this task.

---

# A/B-2 — Ship-stage prompt: finished diff touching apps/api/src/services/orderSync.js (SQL change)

Of the six files, only `enterprise` says anything substantive about shipping a SQL-touching change; `vault-process` only says a PR gets created and its URL recorded, with no detail; the four `full-cycle*` files say "commit" and nothing more.

**What `enterprise` specifies:**

- **DB/Query Ownership Packet is required** before this SQL change can be built/reviewed/shipped: *"Every database query, read, write, repair, projection, sync, reconciliation, migration, report, verifier, or live-proof query must have a DB/Query Ownership Packet: table/source owner, operation type, current DB/schema target, tenant/owner/supplier scoping, affected-row or readback expectation, bounded proof command, cleanup/rollback, and approved writer/reader seam."* This applies directly since `orderSync.js` is a sync file with a SQL change — "Ownership is required for reads as well as writes."
- **Schema/query/data claims require real DB proof**: *"Migrations, diffs, and mocks are not enough."*
- **No PR-ready/merge-ready/ship-ready claim** until `enterprise-review`, `enterprise-forge`, and `enterprise-verify` are recorded in order against the current final diff, and the `pr-readiness`/`merge` stage gate (run via `enterprise-required-gates --stage <stage>`) passes.
- PR body sections and required PR gates are sourced from **a route card** (`route_card.required_pr_gates`, `route_card.required_pr_body_sections`) — the file says these must be stated at intake, but does not itself enumerate the sections (e.g., it does not give an exact "6-section" list, an exact DB-proof line format, or an event-payload caveat).
- **Review feedback control loop**: every accepted P1/P2/P3 review finding must be harvested into exactly one prevention target (contract postcondition, plan question, forge lens, verify command, CI/gate recommendation, repo trap, or skill eval). This is the closest thing to a "thread convergence" rule in these files, and it's about *what happens to accepted findings*, not about *how review threads/comments get resolved or replied to*.
- High-risk async/order/sync lanes (which `orderSync.js` plausibly is) require *"field-level producer-to-consumer contracts and lifecycle counterexamples during plan/contract"* and call out specific traps to catch before PR review: *"quantity-field mismatches, bypassed synchronous confirmations, duplicate workers, stale running states, post-commit bookkeeping ambiguity, truthy non-success helper returns, lost retries, UI rehydration gaps."*

**Not specified in any of the six files:**
- Exact PR body section list/count
- Exact DB-proof line format/string
- Exact thread-convergence protocol (reply-only vs. push, when to re-request review)
- "Rerun after green" requirement
- Event-payload body caveat
- Merge strategy specifics (rebase-only, squash, etc.)
- Worktree teardown steps after merge
- Force-with-lease / restale handling

I would not assert any of the above from these six files — they simply aren't in them.
