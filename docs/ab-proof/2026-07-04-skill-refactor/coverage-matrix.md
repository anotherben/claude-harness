# Skill ecosystem coverage matrix

Legend: GO=go(orchestrator/depth-gate) · ENT=enterprise-* family · BF=bug-factory · DIAG=diagnose ·
TRI=triage · VC/VX/VU/VS/VP/VI=vault-capture/context/update/sweep/process/init · CM=contract-manager
P360=plan-360-audit · BR=blast-radius · SQL=sql-guard · IG=integration-guard · CVA=code-variable-audit
PSA=pr-schema-audit · PROM=promote · SH=session-heartbeat · HW=handover-writer · WC=worktree-cleanup
GWD=grill-with-docs · Builtins: CR=code-review RV=review SR=security-review VER=verify RUN=run

## Matrix (phase × situation) — GO means "handled generically by /go's depth-routed stages"

| Phase | bug | feature | refactor | UI | data/schema | integration | ops/infra | docs | security incident | perf issue |
|---|---|---|---|---|---|---|---|---|---|---|
| capture/intake | VC/TRI | VC/TRI | TRI | VC | TRI | TRI | GAP(a)* | GAP(c) | GAP(a) | GAP(a) |
| triage/prioritize | TRI | TRI | TRI | TRI | TRI | TRI | GO(ops) | GO | TRI+SR-adjacent GAP(b) | GAP(b) |
| context/brief | VX | VX/ENT-brainstorm | VX | VX | VX | VX+IG | VX | GO | GAP(b) | GAP(a) |
| design | GO(plan) | ENT-brainstorm | GO/ENT | GO | GO+SQL | ENT+IG | GAP(b) | GAP(c) | GAP(b) | GAP(a) |
| plan | GO/CM/P360 | ENT-plan/CM | CM/P360 | GO | CM+SQL+P360 | ENT-plan+IG | PROM(if promote) | GO | GAP(a) | GAP(a) |
| build | GO(TDD) | GO/ENT-build | GO | GO | SQL+GO | IG+GO | PROM/WC | GO | GAP(b, SR post-hoc) | GAP(a) |
| test | GO/BF | GO | GO | VER | SQL live-DB | IG+VER | VER | GAP(c) | GAP(b) | GAP(a) |
| review | CR/RV/BR | CR/RV | CR/simplify | CR | CVA+SQL+BR | CVA+IG+BR | GAP(b) | GAP(c) | SR(builtin) | GAP(a) |
| verify | VER/BF | VER | VER | VER(Playwright) | VER live-DB | VER canary | GAP(b) | GAP(c) | SR | GAP(a) |
| review(PR async) | ENT-pr-review | ENT-pr-review | ENT-pr-review | ENT-pr-review | PSA+ENT-pr-review | ENT-pr-review | GAP(b) | GAP(c) | GAP(b) | GAP(a) |
| ship/PR | GO(SHIP)/BF | GO(SHIP) | GO(SHIP) | GO(SHIP) | GO(SHIP)+SQL proof | GO(SHIP) | PROM | GO | GAP(b) | GAP(a) |
| deploy/promote | PROM | PROM | PROM | PROM | PROM(migrations-first) | PROM | PROM | n/a | GAP(a)** | GAP(a) |
| monitor/observe | GAP(a) | GAP(a) | GAP(a) | GAP(a) | GAP(a) | GAP(a) | PROM(canary, deploy-window only) | n/a | GAP(a) | GAP(a) |
| learn/compound | ENT-compound | ENT-compound | ENT-compound | ENT-compound | ENT-compound | ENT-compound+PSA | ENT-compound | n/a | GAP(a) | GAP(a) |
| maintain/cleanup | WC/VS | WC/VS | WC/VS | WC/VS | WC/VS | WC/VS | WC/PROM | n/a | GAP(a) | GAP(a) |

*ops/infra capture: no dedicated intake, but low-friction (just run the ops skill directly).
**incident-declared production rollback: PROM's canary-fail branch does halt+rollback, but there's
no skill for "prod is down right now, act" as a first-class entry distinct from a scheduled promote.

Cross-cutting (not phase-bound): SH=scope/health checkpoints, HW=context-limit handover, GWD=domain-
model stress-test, VI=project bootstrap, CM=contract precision gate — all apply across every column.

## GAP analysis

**(a) Genuinely uncovered, worth a skill/section**
1. **Production incident response** (monitor→act→rollback as a named entry point). PROM's canary
   step *reacts* mid-promote, but nothing exists for "prod is broken right now" declared out-of-band
   — no severity triage, no comms template, no explicit rollback-vs-fix-forward decision skill.
2. **Post-deploy monitoring/alert triage**. PROM watches its own canary window then stops; nothing
   owns ongoing observability once the canary closes (this is exactly the class of gap that produced
   the migration-lock-cascade incident — discovered ad hoc, not via a monitoring skill).
3. **Performance regression work** as a first-class situation type — no perf-profiling skill, no
   before/after benchmark gate, no regression-budget ratchet (contrast with the SRP/god-file
   ratchets that DO exist for size).
4. **Consultative "advice, no execution" mode.** Nothing in the 31 skills is scoped to "give me a
   second opinion and stop" — every skill either does the work (build/ship) or gates work someone
   else is about to do (contract-manager, plan-360-audit) with an implicit assumption implementation
   follows. `/advisor` (read + reason + recommend, explicitly no edits/PRs) is a real gap, not a
   duplicate of code-review/diagnose (those still bottom out in fixing or judging a diff, not just
   in advising on an open question).
5. **Database migration *operations*** (running/coordinating migrations against shared prod
   infra, lock-timeout awareness) — sql-guard covers writing safe SQL/migrations, but nothing
   covers *operating* a migration rollout (the exact gap that caused the 55P03 reader-cascade
   memory item). PROM says "migrations-first" but doesn't own lock-contention diagnosis.

**(b) Covered implicitly by /go stages (not a gap)**
- Ops/infra design & build, docs review/verify, security-incident triage/context/design/build,
  perf-issue triage/context/design/build, review of ops/data/PR-async changes: all just route
  through /go's normal plan→build→review→SHIP pipeline with domain guards (SQL/IG/BR) attached —
  no dedicated skill needed because the generic pipeline plus guards already produces the right
  behavior. Adding a skill here would just restate GATES.md/go's stage library (which the hard
  rules explicitly forbid — "GATES.md is the only source of gate knowledge").
- Docs-only changes: genuinely low-ceremony — QUICK depth in /go, code-review/lint gates still
  apply, no domain-specific risk profile that would justify a bespoke docs skill.
- Dependency updates: not asked about explicitly but same logic — QUICK/STANDARD /go depth,
  lint+preflight gates catch breakage; a dedicated "bump deps" skill would just be a /go alias.

**(c) Intentionally out of scope for an agent**
- Capture/intake and design phases for docs and security-incident/perf work: these are typically
  triggered by a human noticing something (a slow page, a CVE alert) rather than needing an agent
  intake funnel — forcing them through vault-capture/triage adds ceremony without value when the
  human is already standing in front of the problem.
- **Security review**: NOT a gap — `/security-review` is a Claude Code builtin already covering
  the "review this diff for vulns" case; `code-review`/`review`/`verify`/`run` builtins likewise
  cover generic diff review, PR review, runtime verification, and app-launch — none of these
  needed reinventing as project skills.
- **A/B testing of skills themselves** (meta-evaluation of skill variants): out of scope for an
  agent to self-assign — this is a human product decision about which skill design "won", and
  skill-creator's benchmark/eval mode (in the skills-index ecosystem, outside this 31) already
  exists for the mechanical variance-testing part; deciding what counts as "better" stays human.

## Top-5 "worth building" (ranked)

1. **Post-deploy monitoring/alert-triage skill** — closes the observability gap between
   promote's canary window and the next incident; would have caught the migration-lock cascade
   earlier instead of via ad hoc diagnosis.
2. **Incident-response/rollback skill** — distinct entry point from `/promote` for "prod is down
   now": severity call, rollback-vs-fix-forward decision, comms, then hands off to /diagnose.
3. **`/advisor` consultative mode** — real, unaddressed gap; every existing skill either executes
   or gates execution, none is scoped to "answer and stop."
4. **Migration-operations skill** — owns lock-timeout-aware rollout/coordination for schema
   changes on shared prod infra, distinct from sql-guard's write-time safety checks.
5. **Performance-regression skill** — profiling + before/after budget gate, mirroring the
   SRP/god-file ratchet pattern already proven out for code size.
