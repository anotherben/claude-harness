# Judge scores — A/B blind evaluation

Scored strictly on what each page states. R1 depth/route, R2 stage completeness, R3 model
routing, R4 gate fidelity (real gates only; inventing = 0; honest "not specified" = 0 but not
penalized as invention), R5 dead-reference-free. Max 10/scenario.

## A/B-1 per-scenario

### System X

| S | R1 | R2 | R3 | R4 | R5 | Tot | Justification (one line per row) |
|---|----|----|----|----|----|-----|----------------------------------|
| S1 | 2 | 2 | 1 | 2 | 2 | 9 | QUICK correct; analyze→build→test→SHIP complete; build/tests=sonnet (analyze worker unstated); 6-section body + rebase, DB-proof correctly excluded; all refs grounded. |
| S2 | 2 | 2 | 2 | 2 | 2 | 10 | DEBUG→re-enter QUICK/STANDARD exact; diagnose→plan→build→review→SHIP; opus root-cause/plan, sonnet build, sonnet+opus+codex review; exact DB-proof line + live-DB harness; grounded. |
| S3 | 2 | 2 | 2 | 2 | 2 | 10 | DEEP=enterprise correct; discover→brainstorm→plan→build→review/verify→ship; sonnet/haiku research, opus synth/plan, codex adversarial; 6-section+gate stack+rebase; grounded. |
| S4 | 2 | 2 | 2 | 2 | 2 | 10 | STANDARD with reasoning (Expected STANDARD/DEEP); plan→build→review→SHIP + blast-radius precheck; opus plan/sonnet build/codex; SRP 400/800 + justified-json + Code Placement Law; grounded. |
| S5 | 2 | 2 | 2 | 2 | 2 | 10 | QUICK-or-STANDARD matches Expected; verify stage w/ Playwright + plan-approval pause; sonnet build/opus plan; purchasing-full-kit + Playwright + purchasing pause gates; grounded. |
| S6 | 2 | 2 | 1 | 2 | 2 | 9 | ANSWER depth correct; answer directly, no build stages, STOP; only optional Explore worker named; substantively explains treadmill/reply-only grounded in GATES.md; grounded. |
| S7 | 1 | 1 | 0 | 2 | 2 | 6 | Classifies issue# but can't reach DEBUG (didn't infer #3618=poison bug); thin intake (no intake stage, straight to depth gate); routing unstated; yield protocol + worktree teardown real; grounded. |
| S8 | 0 | 0 | 0 | 0 | 2 | 2 | Files lack /promote so honestly declines to route (fails Expected /promote); no stages/routing/gates; correctly invents nothing. |

System X A/B-1 total: **66 / 80**

### System Y

| S | R1 | R2 | R3 | R4 | R5 | Tot | Justification (one line per row) |
|---|----|----|----|----|----|-----|----------------------------------|
| S1 | 2 | 2 | 0 | 0 | 2 | 6 | full-cycle-fast ≈ QUICK correct; Context/Analysis/Build/Verify+Ship present; no models named; ship = bare "commit," no PR/rebase/6-section gate; refs grounded to its file. |
| S2 | 2 | 2 | 0 | 1 | 2 | 7 | enterprise DEBUG root-cause-first correct; full worktree→plan→360→contract→build→review→forge→verify chain; no model tiering; real-DB-proof + DB/Query Ownership Packet real but no exact line/6-section/copilot/rebase; grounded. |
| S3 | 2 | 1 | 0 | 0 | 2 | 5 | full-cycle-research=DEEP correct; 9 phases but research after plan and ends at "compound" — no ship/PR stage; no models; no ship mechanics; refs grounded to file. |
| S4 | 2 | 2 | 0 | 1 | 2 | 7 | enterprise STANDARD/FULL ambiguity ~ Expected; generic chain + Touched-File SRP fix-now assessment; no models; SRP fix-now real, honestly notes no 400/800 or Placement Law in its files; grounded. |
| S5 | 2 | 1 | 0 | 0 | 2 | 5 | full-cycle-fast ≈ QUICK defensible; four stages but no browser/Playwright verify (missing required UI proof); no models; no purchasing gate (honestly won't invent); grounded. |
| S6 | 2 | 2 | 0 | 0 | 2 | 6 | Correctly: question, no pipeline, answer directly; but gives no substantive answer (says files don't cover the policy); no routing; no gate content; grounded/honest. |
| S7 | 1 | 2 | 0 | 1 | 2 | 6 | Strong named issue-intake front door but can't reach DEBUG from files; full intake-packet stage sequence complete; no models; enterprise-required-gates real, honestly disclaims yield protocol; grounded. |
| S8 | 0 | 0 | 0 | 0 | 2 | 2 | Files lack promote/deploy — honestly declines to route (fails Expected /promote); nothing specified; invents nothing. |

System Y A/B-1 total: **44 / 80**

## A/B-2 ship-stage (itemized against key, max 10)

| Behavior (points) | System X | System Y |
|---|---|---|
| Body sections (1) | 1 — exact 6-section template listed | 0 — "route_card sections," never enumerated |
| Exact DB-proof line (2) | 2 — `Real DB/schema proof: <cmd> - PASS` + format caveats | 0 — real-DB-proof required generically, exact line not given |
| Thread convergence (2) | 2 — batch fixes, reply-only ≥40char, resolveReviewThread, no bulk | 0 — only prevention-target harvest; explicitly says not specified |
| Rerun-after-green (1) | 1 — `gh run rerun <runid> --failed` | 0 — not specified |
| Event-payload caveat (1) | 1 — close/reopen to re-fire on body-only edit | 0 — not specified |
| Rebase-only (1) | 1 — `gh pr merge --rebase`, squash disabled | 0 — not specified |
| Worktree teardown (1) | 1 — cleanup engine, disk-full rationale | 0 — not specified |
| Restale/force-with-lease (1) | 1 — BEHIND/DIRTY, `--force-with-lease` | 0 — not specified |
| **A/B-2 total** | **10 / 10** | **0 / 10** |

## Grand totals

| | A/B-1 | A/B-2 | Total |
|---|-------|-------|-------|
| System X | 66 | 10 | **76 / 90** |
| System Y | 44 | 0 | **44 / 90** |

## Verdict (10 lines)

1. System X is decisively stronger: 76 vs 44, winning or tying every scenario and sweeping A/B-2 10-0.
2. X's edge is gate fidelity (R4) and ship mechanics — it reproduces the exact DB-proof line, 6-section body, copilot-wait convergence, rebase-only, and force-with-lease verbatim, all real gates.
3. X also wins model routing (R3): it consistently states opus/sonnet/haiku/codex tiering; Y names no models anywhere and scored 0 on R3 in all 8 scenarios.
4. Y's genuine strengths: disciplined honesty (never invents a gate), and a better-articulated named issue-intake front door on S7.
5. Both systems correctly and honestly punted S8 (neither's file tree included /promote) — a scoping gap in the harness, not a fault, and a tie.
6. Neither system inferred that issue #3618 is the payment-sync poison bug (both stalled at "depth not determinable"), so both missed DEBUG on S7 R1.
7. WINNER (System X) top weakness #1 — S7 intake is thin: it jumps from classification straight to the depth gate with no explicit intake/normalize stage and no yield-check-before-claim ordering, despite listing the yield protocol elsewhere.
8. WINNER weakness #2 — Depth over-hedging: X leaves S5 as "QUICK-or-STANDARD, not specified" and S7 depth blank; it could commit more decisively using surface heuristics rather than deferring.
9. WINNER weakness #3 — Dependency on files not in scope: X marks S8 fully "not specified" and S2's diagnose internals "not specified" because /promote and /diagnose bodies weren't provided; a cross-reference or explicit hand-off note would beat a flat blank.
10. Net: X is production-grade on ship/gate fidelity; sharpen issue-intake staging, decisive depth selection, and graceful cross-skill hand-offs to close the remaining 14 points.
