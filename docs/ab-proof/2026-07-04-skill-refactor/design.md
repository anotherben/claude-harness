# Skill Ecosystem Refactor — Design (draft, pending PR-reality audit)

Date: 2026-07-04. Orchestrator: Claude (Opus 4.8). Inputs: 4 audit reports (enterprise/opus, entry-points/sonnet, guards/sonnet, codex/sonnet) + memories (merge gates, PR loop dynamics, vibe-coder) + repo↔live drift scan.

## Verdict summary

| Finding | Evidence |
|---|---|
| Enterprise pipeline can't run under Claude Code | assumes .codex/ state dirs + enterprise-precheck binaries; fails closed |
| enterprise == enterprise-dev | byte-identical bodies |
| review/forge/verify = same checklist ×3 | ~15 constructs duplicated across 7 files (~1,500 lines) |
| Zero model routing in Claude skills | only code-variable-audit + pr-schema-audit route (to Codex) |
| 3 parallel depth-routers, 2 intake systems | full-cycle×4 / vault-process→enterprise / bug-factory; GitHub vs vault |
| Only bug-factory + enterprise-pr-review + promote know real CI | others invent a parallel gate universe |
| Codex plugin is A/B-ready | --cwd worktrees, --output-schema, schema'd review JSON |
| Repo↔live drift | 51 repo-only skills, 14 differ (live assumed newer) |

## Target architecture

ONE front door: **/go** (new dispatcher skill). Any input — bug, idea, refactor, UI change, question, issue #, vault item — classified and routed.

### /go dispatcher
1. **Intake/classify** (from vault-capture's table): type = bug | feature | refactor | ui | question | ops. System of record = GitHub issues (vault optional mirror).
2. **Depth gate** (from vault-process): QUICK | STANDARD | DEEP | DEBUG | ANSWER (question short-circuit — new).
3. **Model routing table (NEW, embedded in dispatcher and referenced by stages):**
   - opus: planning, architecture synthesis, final review judgment, root-cause debugging
   - sonnet: standard build, tests, mechanical review, research fan-out
   - haiku: cheap sweeps (inventory, log trawls, link checks)
   - codex (codex-companion task/review, --cwd worktree, --output-schema): second implementation pass, adversarial review, A/B counterpart
4. **Universal terminal stage: SHIP** = bug-factory's PR/CI mechanics (worktree → PR body 6-section template → gates → copilot-review-wait convergence → rebase merge → teardown). All depths funnel here.
5. **Verify stage universal**: surface-gated (Playwright for UI, canaries for integrations, live-DB proof for SQL).

### Skill disposition (live set, 50 skills)

KEEP (as-is or trimmed): diagnose (absorbs patch-or-fix + zoom-out), blast-radius (trim), sql-guard, integration-guard, promote, contract-manager, enterprise-pr-review (real-CI closer), enterprise-compound, enterprise-debug→(merge into diagnose family? keep for now), bug-factory (becomes SHIP stage + still standalone), triage (GitHub intake), handover-writer, session-heartbeat (absorbs scope-check), grill-with-docs, vault-init, vault-update, vault-sweep (absorbs vault-status), vault-capture (intake logic feeds /go), vault-context (decouple hook-marker hack), worktree-cleanup (script wrapper, demote later), pr-schema-audit, code-variable-audit.

NEW: **go** (dispatcher).

REWRITE: enterprise (Claude-native front door for FULL-depth path, model routing added, real gates; or fold into /go as its DEEP tier — decision: fold, keep /enterprise as alias pointing at /go DEEP), enterprise-plan (merge +contract), enterprise-build (slim), enterprise-review (merge +forge+verify+harness), enterprise-brainstorm (slim → design), enterprise-discover (de-Codex paths), vault-process (becomes /go queue mode).

DELETE (live): enterprise-dev, enterprise-stack-review, enterprise-contract, enterprise-forge, enterprise-verify, enterprise-harness, enterprise-next (fold into /go), full-cycle, full-cycle-fast, full-cycle-tdd, full-cycle-research (all four fold into /go depth tiers), patch-or-fix, zoom-out, scope-check, vault-status, vault-triage (fold into triage/vault-capture), grill-me, senior-architect, deploy-checklist, run-verification.

Net: 50 live skills → ~27, plus /go.

### CI-gate alignment (single source of truth)
New shared reference file `skills/go/GATES.md` distilled from memories helpdesk-dev-merge-gates + helpdesk-pr-merge-loop-dynamics: required checks, copilot-review-wait convergence rule (fix-all-then-resolve-reply-only), 6-section PR body + strict DB-proof regex, live-DB test rule, rebase-only, restale cascade, concurrent-orchestrator yield protocol, SRP ratchets. Stages reference it instead of embedding drifting copies.

### A/B proof plan (task 4)
Judged against gate-shaped checks, not vibes:
- **A/B-1 (routing correctness)**: 8 synthetic requests (bug/idea/refactor/UI/question/ops/issue#/vault item) → old entry points vs /go; judge: correct depth + correct stages + no dead references. Haiku/sonnet run both sides fresh-context; opus judges.
- **A/B-2 (ship-stage fidelity)**: prompt old full-cycle "ship" section vs new SHIP stage to produce a PR plan for a sample diff; judge against real gate list (does output include 6-section body, DB-proof line format, copilot-wait convergence, rebase merge?). Score = gate coverage count.
- **A/B-3 (Claude vs Codex worker)**: one real small bug in helpdesk, two worktrees, Claude-sonnet vs codex task --write; judge = real CI-shaped local checks (lint, targeted jest real config) + opus review. Proves codex routing path works end-to-end.

### Implementation notes
- Work in ~/claude-harness on a new branch (worktree), edit skills there, then install to live via install.sh --update semantics for changed skills only; keep deleted live skills archived in repo (move to skills/.archive/), not rm'd from history.
- First reconcile drift: copy the 14 newer live skills into repo before editing.
- 51 repo-only skills: leave untouched this pass (not installed live; separate cleanup).
