# Skill test ledger — test → fix → retest until clean

Protocol: every live skill gets a cold-read functional test (fresh agent, only the SKILL.md +
declared supporting files, realistic scenario). Findings are classified HIGH (can't execute /
wrong behavior / contradicts GATES.md) / MED (dead reference, missing known-trap coverage) /
LOW (style, bloat). Every fix is retested by a NEW fresh agent. A skill converges when a full
retest pass returns zero HIGH+MED findings. Evidence = the test report + the fix commit + the
clean retest verdict, all recorded here.

| Skill | Iter | Test verdict | Findings (H/M/L) | Fix commit | Retest |
|---|---|---|---|---|---|
| go | 1 | A/B judge 76/90; missing OPS route, intake thin, depth hedging | 0/3/0 | 0a205c3 | pending iter-2 |
| GATES.md | 1 | codex adversarial: missing operator-auth rule | 1/0/0 | 0a205c3 | pending iter-2 |
| bug-factory | 1 | codex adversarial: 5-header vs 6-section body | 1/0/0 | 0a205c3 | wave-1 retest running |
| advisor | 0 | NEW — untested | — | — | wave-2 |
| diagnose | 1 | wave-1 running (3 modes) | — | — | — |
| blast-radius | 1 | wave-1 running (post-trim integrity) | — | — | — |
| sql-guard | 1 | wave-1 running | — | — | — |
| integration-guard | 1 | wave-1 running | — | — | — |
| enterprise | 1 | wave-1 running (chain test) | — | — | — |
| enterprise-discover | 1 | wave-1 running (chain) | — | — | — |
| enterprise-brainstorm | 1 | wave-1 running (chain) | — | — | — |
| enterprise-plan | 1 | wave-1 running (chain) | — | — | — |
| enterprise-build | 1 | wave-1 running (chain) | — | — | — |
| enterprise-review | 1 | wave-1 running (chain) | — | — | — |
| enterprise-pr-review | 1 | wave-1 running (vs GATES convergence) | — | — | — |
| enterprise-debug | 1 | wave-1 running (vs diagnose boundary) | — | — | — |
| enterprise-compound | 1 | wave-1 running (chain) | — | — | — |
| promote | 1 | wave-1 running (scripts + fleet-deploy coverage) | — | — | — |
| worktree-cleanup | 1 | wave-1 running (script path) | — | — | — |
| pr-schema-audit | 1 | wave-1 running (codex routing current?) | — | — | — |
| code-variable-audit | 1 | wave-1 running (codex routing current?) | — | — | — |
| triage | 1 | wave-1 running (vault-intake merge coherence) | — | — | — |
| vault-capture | 1 | wave-1 running | — | — | — |
| vault-context | 1 | wave-1 running (hook-marker intact) | — | — | — |
| vault-process | 1 | wave-1 running (/go queue handoff) | — | — | — |
| vault-sweep | 1 | wave-1 running (status-mode merge) | — | — | — |
| vault-update | 1 | wave-1 running | — | — | — |
| vault-init | 1 | wave-1 running | — | — | — |
| contract-manager | 1 | pending wave-2 (refs fixed iter-1: run-verification/scope-check) | 0/2/0 | f0262e4 | wave-2 |
| plan-360-audit | 1 | pending wave-2 (ref fixed iter-1: patch-or-fix) | 0/1/0 | f0262e4 | wave-2 |
| session-heartbeat | 1 | wave-2 (scope-mode merge untested) | — | — | — |
| grill-with-docs | 1 | wave-2 (grill-me absorption untested) | — | — | — |
| handover-writer | 1 | wave-2 | — | — | — |
| sql-guard/integration-guard evals | — | see guard rows | — | — | — |

Convergence rule: max 3 iterations per skill; if iter-3 still has findings, escalate the skill
for redesign rather than more polish. LOW findings do not block convergence but are recorded.
