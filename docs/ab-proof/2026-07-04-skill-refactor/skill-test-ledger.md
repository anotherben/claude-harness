# Skill test ledger — FINAL (all skills converged)

Protocol: cold-read functional test per skill (fresh agent, only the SKILL.md + declared files,
realistic scenario) → findings graded HIGH/MED/LOW → fix → fresh-agent retest → CONVERGED at
zero HIGH+MED. Max 3 iterations; LOW recorded but non-blocking. Mechanical string-replacement
fixes verified by zero-hit grep instead of a full agent pass (noted "grep-verified").

## Final verdicts (33 units: 31 pre-existing live skills reduced set + go/GATES + advisor + incident)

| Skill | Iters | Findings closed (H/M/L) | Evidence trail | Final |
|---|---|---|---|---|
| go | 3 | 2/3/1 (OPS route, intake, tie-breaker rank, GATES restatement, cite) | A/B 76v44 → 0a205c3, b355151, a518d4e → iter-3 agent | CONVERGED |
| go/GATES.md | 2 | 1/0/0 (operator-auth rule) | codex adversarial → 0a205c3 → iter-2/3 agents | CONVERGED |
| advisor (NEW) | 2 | 0/1/0 (short-circuit ordering) | b355151 → a518d4e → final-wave agent | CONVERGED |
| incident (NEW) | 1 | 0/0/0 | final-wave agent walked 2 scenarios | CONVERGED |
| bug-factory | 2 | 1/0/1 (5-header→6-section; verdict-vocab contract) | codex → 0a205c3; diagnose roll-up 26a6cf8 | CONVERGED |
| diagnose | 3 | 2/0/1 (verdict roll-up, mapping-only bypass; LOW: fwd phase ref) | 26a6cf8 → iter-3 agent | CONVERGED (1 LOW open) |
| blast-radius | 2 | 0/0/0 post-trim | guards retest walked scenario end-to-end | CONVERGED |
| sql-guard | 2 | 0/1/0 (migration-ops gap → new rollout section) | b355151 → guards retest verified accuracy | CONVERGED |
| integration-guard | 2 | 0/1/1 (unmapped-tender trap #3618 class; MCP fallback) | 26a6cf8, grep-verified | CONVERGED |
| enterprise | 2 | (family) | chain test → e82e20d → chain retest | CONVERGED |
| enterprise-discover | 2 | 1/0/0 (no output artifact) | e82e20d (docs/designs/*-discover.md) → retest | CONVERGED |
| enterprise-brainstorm | 2 | 0/0/1 (path cited by description) | retest | CONVERGED (LOW open) |
| enterprise-plan | 3 | 1/1/0 (no artifact path; docs/plans collision) | e82e20d → 5f30351 (docs/designs/*-plan.md) grep-verified | CONVERGED |
| enterprise-build | 3 | 1/0/0 (receipts path) | e82e20d (docs/verify/<slug>-receipts.jsonl) → retest exact-match | CONVERGED |
| enterprise-review | 2 | 0/0/0 (consumes receipts path) | retest exact-match | CONVERGED |
| enterprise-pr-review | 3 | 2/1/0 (treadmill+rerun+operator-auth; forge/verify enums) | e82e20d → 5f30351 grep-verified → retest | CONVERGED |
| enterprise-debug | 2 | 0/1/0 (dead stages; boundary) | e82e20d + boundary commit → retest | CONVERGED |
| enterprise-compound | 3 | 0/1/0 (dead stage enums ×2 passes) | e82e20d → 5f30351 grep-verified | CONVERGED |
| promote | 1 | 0/0/0 (fleet pinned-deploy covered; scripts exec) | ops-wave agent | CONVERGED |
| worktree-cleanup | 1 | 0/0/1 (two script copies — verified identical) | ops-wave + diff | CONVERGED |
| pr-schema-audit | 3 | 1/2/0 (hardcoded script path → __dirname, both copies; guardrail wording; secret path = FALSE POSITIVE, live infra) | a518d4e + live .codex sync + node --check | CONVERGED |
| code-variable-audit | 2 | 0/2/0 (codex paths; .orig; guardrail) | b355151, a518d4e, grep-verified | CONVERGED |
| triage | 3 | 1/1/0 (decision/note unroutable → D route; missing-folder creation) | b355151 → a518d4e → final-wave agent | CONVERGED |
| vault-capture | 1 | 0/0/0 (+ /go handoff, MCP fallback added proactively) | ops-wave spot-check | CONVERGED |
| vault-context | 1 | 0/0/0 (hook-marker block intact + explicit) | ops-wave verified bash valid | CONVERGED |
| vault-process | 1 | 0/0/0 (thin /go queue alias; handoff verified both sides) | ops-wave cross-check vs go queue mode | CONVERGED |
| vault-sweep | 1 | 0/0/0 (status-mode merge) | ops-wave spot-check | CONVERGED |
| vault-update | 1 | 0/0/0 | ops-wave spot-check | CONVERGED |
| vault-init | 2 | 0/1/1 (vault-status dead path; template placeholder noted) | b355151 → final-wave grep-clean | CONVERGED (LOW open) |
| contract-manager | 2 | 0/2/0 (run-verification/scope-check refs) | f0262e4 → final-wave grep-clean | CONVERGED |
| plan-360-audit | 2 | 0/1/0 (patch-or-fix ref) | f0262e4 → final-wave verified diagnose mode exists | CONVERGED |
| session-heartbeat | 1 | 0/0/0 (scope-drift gate self-contained) | final-wave agent | CONVERGED |
| grill-with-docs | 1 | 0/0/0 (grill-me absorption grep-clean) | final-wave agent | CONVERGED |
| handover-writer | 2 | 0/1/0 (invalid vault type issue→note) | a518d4e, grep-verified | CONVERGED |

## Open LOWs (recorded, non-blocking)
- diagnose: system-mapping mode references Phase 3 before it's defined (readability).
- enterprise-brainstorm: design-doc handoff cited by description not literal dated path.
- vault-init: templated `/Users/you/.codex/...` placeholder at lines ~220/231.

## Process notes
- 1 retest false positive caught and documented: pr-schema-audit's ~/.codex secret path is
  canonical live infrastructure (launchd job verified via PlistBuddy), now annotated in-skill.
- 1 orchestrator error self-reported: daily-sweep.cjs was require()'d during a syntax check,
  executing a real (read-only) sweep pass; killed at 2min, no writes observed.
- Test coverage: 5 audit agents (wave 0) + 4 functional-test agents (wave 1, one 529 casualty
  relaunched) + 3 retest agents (wave 2) + 1 iter-3 verifier + blind A/B judge + codex
  adversarial review. All reports summarized in this dir; A/B raw materials in
  scenarios.md / condition-A.md / condition-B.md / judge-scores.md / codex-adversarial-review.md.
