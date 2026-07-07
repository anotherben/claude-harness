# Condition B answers — based strictly on skills/go/SKILL.md, skills/go/GATES.md, skills/enterprise/SKILL.md

## S1 — Typo in refund email subject line

1. **Pipeline/depth**: `/go`, depth = QUICK (bug, single file, no schema/integration surface).
2. **Ordered stages**: analyze → build → test → SHIP.
3. **Model routing**: not specified per-stage for QUICK explicitly, but per the Step 3 table: build/tests = sonnet (standard build, tests). Analyze step has no explicit worker named — not specified.
4. **Ship mechanics**: universal SHIP stage per GATES.md — 6-section PR body (What changed / Regression check / Blast radius / Edge cases / AI-Copilot review routing / Conversations addressed), gate stack runs (pr-body-gate, lint, pr-scope-gate+freshness, preflight-dev, review-hard, enterprise-delivery-gate, copilot-review-wait, CodeRabbit+content-survival), merge via `gh pr merge <n> --rebase` (rebase ONLY, squash/merge-commit disabled), draft PR early, babysit with a sonnet poller, worktree teardown after merge. No DB-proof line required (change is not near SQL in apps/api/src/**/*.js).

## S2 — Orders with deleted customer crash invoice endpoint (42703)

1. **Pipeline/depth**: `/go`, depth = DEBUG (root cause unknown), triggering "/diagnose first, then re-enter at QUICK or STANDARD with the diagnosis packet." The skill files given do not include /diagnose's internal contents, so its stage list is not specified beyond "run it first."
2. **Ordered stages**: /diagnose (root-cause) → re-enter at QUICK or STANDARD → for STANDARD: plan → build (TDD default for bugs) → review → SHIP.
3. **Model routing**: Step 3 table — opus for "root-cause debugging" (fits /diagnose), opus for plan, sonnet for build/tests, review is "fresh-eyes /code-review (sonnet finder, opus verify) + codex adversarial review."
4. **Ship mechanics**: Since this is an apps/api/src/**/*.js change near SQL, GATES.md requires `## Regression check` to contain a line matching exactly `Real DB/schema proof: <cmd> - PASS`. Test requirement per GATES.md "Tests: live-DB, not mocks": real-DB contract test in `apps/api/src/__tests__/real/*.contract.real.test.js` + `jest.real.config.js` + `liveDbContractHarness`/`primeTestDatabaseUrl`, pg_temp shadows, emitting `__LIVE_DB_PROOF__`; run via `cd apps/api && npx jest --config jest.real.config.js <file> --runInBand --forceExit`. Then standard SHIP mechanics (6-section body, gate stack, copilot-review-wait convergence, rebase-only merge, worktree teardown) as in S1.

## S3 — SMS notification when repair is ready (new integration, idea)

1. **Pipeline/depth**: `/go` routes to DEEP depth ("new integration, architectural, unfamiliar territory") → this is the enterprise pipeline (skills/enterprise/SKILL.md: "DEEP/FULL-depth delivery pipeline... /go routes here when it picks DEEP depth").
2. **Ordered stages** (enterprise SKILL.md Stage flow): discover (`/enterprise-discover`, only if territory unfamiliar) → brainstorm/design (`/enterprise-brainstorm`, turns vague/product-shaped ask into design doc — applies here since this is exactly an "idea") → plan+lock (`/enterprise-plan`, includes reading GATES.md for DB-proof tests/blast-radius up front; risky/multi-session work also produces a `/contract-manager` contract) → build (`/enterprise-build`, mechanical TDD, isolated worktree, sonnet subagents, one agent = one job) → review+verify (`/enterprise-review`, fresh eyes, spec-compliance vs quality, adversarial codex pass, proof-scope verdict, release-risk/rollback/observability checklist) → ship (hand to /go's SHIP stage).
   Cross-referencing /go's own DEEP row: "research fan-out → design → plan → build → review → SHIP", and Step 4's research stage description: "4–8 parallel sonnet/haiku Explore agents; opus synthesizes."
3. **Model routing**: research/discover fan-out = sonnet/haiku; opus synthesizes research; plan = opus (architecture synthesis); build = sonnet; review = sonnet finder + opus verify, plus codex adversarial pass (untrusted output, judged not executed).
4. **Ship mechanics**: same SHIP mechanics as S1/GATES.md — 6-section PR body, full gate stack, copilot-review-wait convergence protocol, rebase-only merge, worktree teardown. Since this is a new integration/domain not necessarily apps/api SQL-adjacent, the DB-proof line requirement is conditional ("near SQL") — not specified whether it applies here without knowing implementation details.

## S4 — Split productSyncService.js (700 lines, 4 jobs)

1. **Pipeline/depth**: `/go`, depth = STANDARD ("multi-file, one domain, known territory") per the depth table's refactor row description matches STANDARD's trigger; DEEP is triggered only by new integration/architectural/unfamiliar/research request, none of which is stated here — so STANDARD is the file-supported answer (not "STANDARD/DEEP" — the files don't give a refactor-specific ambiguity rule).
2. **Ordered stages**: plan → build (TDD default; "skip only for pure UI polish" — refactor isn't UI polish, so TDD applies) → review → SHIP. Domain guard: build stage explicitly says "/blast-radius (multi-caller changes)" is a mandatory pre-check when in scope — applies here since splitting a service affects multiple callers.
3. **Model routing**: plan = opus, build = sonnet subagents in isolated worktree "one per file-cluster," review = sonnet finder + opus verify + codex adversarial pass.
4. **Ship mechanics**: GATES.md Ratchets & placement law directly applies: SRP soft limit 400 lines (api services cohort), god-file hard limit 800 (`tests/architecture/cohortBudgetRatchet.test.cjs`); if soft limit still tripped, fix must be "a JUSTIFIED entry in `docs/architecture/cohorts/srp-soft-limit-documented.json` — never boilerplate justifications." Code Placement Law: "no NEW runtime files under `apps/api/src/services/` (frozen baseline) — shared helpers go under `apps/api/src/scripts/**` or `domains/**`" — this directly constrains how the split can be shipped (must not add new files under services/). Then standard SHIP mechanics (6-section body, gate stack including enterprise-delivery-gate which covers "SRP/file-size/dup/ratchet checks", copilot-review-wait convergence, rebase-only merge, worktree teardown).

## S5 — Make purchasing dashboard table sortable by supplier column (UI)

1. **Pipeline/depth**: `/go`, depth = QUICK if ≤2 files/single module, else STANDARD if multi-file — files don't give enough detail to pick definitively; both are plausible per the trigger table. Not specified which exactly without more detail.
2. **Ordered stages**: QUICK: analyze → build → test → SHIP; STANDARD: plan → build → review → SHIP. UI work is explicitly exempted from mandatory TDD ("skip only for pure UI polish" — sortable table may or may not qualify as "pure UI polish").
3. **Model routing**: build = sonnet; if STANDARD, plan = opus, review = sonnet finder + opus verify + codex.
4. **Verify stage** (Step 4 library): "surface-gated proof — Playwright/browser for UI ... Demonstrative proof or it didn't happen" — Playwright/browser verify is required for this UI change.
5. **Risk/pause gate**: Step 2 says "Medium/high-risk items (schema changes, auth/tenant boundaries, purchasing scope, prod promote) pause once for user approval at the plan step" — this task is explicitly "purchasing dashboard," i.e. purchasing scope, so it pauses once for user approval at the plan step.
6. **Ship mechanics**: GATES.md "purchasing-full-kit-evidence: purchasing-scoped changes must regenerate the closeout artifact via the real proof pipeline; never hand-edit `proof_subject_sha`" — applies since this touches the purchasing dashboard. Then standard SHIP mechanics (6-section PR body, gate stack, copilot-review-wait convergence, rebase-only merge, worktree teardown).

## S6 — "Why do we resolve copilot threads reply-only instead of pushing?" (question)

1. **Pipeline/depth**: `/go`, depth = ANSWER ("question / read-only").
2. **Ordered stages**: "Answer it (Explore subagents if needed). No build stages. STOP." — i.e., answer directly, optionally using Explore subagents; no pipeline stages run.
3. **Model routing**: not specified beyond optional Explore subagents (no specific model named for ANSWER depth).
4. **Ship mechanics**: none — ANSWER depth explicitly has no build/ship stages ("SHIP (universal terminal stage — every depth except ANSWER ends here)" confirms ANSWER never reaches SHIP).

Substantively, the answer itself (from GATES.md's "Treadmill rule"): bots (Copilot, CodeRabbit, codex) re-review on EVERY push, but resolving threads does NOT re-trigger them — so pushing more code churns the whole bot review cycle again, whereas reply-only resolution (a substantive ≥40-char human reply as the last comment on reply-required threads) lets copilot-review-wait converge without restarting the bot re-review treadmill. GATES.md states the convergence requires "every review thread resolved (GraphQL `resolveReviewThread` + substantive reply — no bulk resolving)."

## S7 — "Handle issue #3618."

1. **Pipeline/depth**: `/go`. Step 1 classify: Source = GitHub issue #, and "GitHub issues are the system of record." Depth: not specified by the skill files what #3618 is about — the files given contain no information about what issue #3618 is, so depth cannot be determined from these files alone (DEBUG only applies if root cause is unknown, which isn't stated in the skill files). **Not specified** which depth without issue content.
2. **Ordered stages**: Per Step 1, since source is a GitHub issue #, no separate "intake" stage is described beyond classification itself — proceed straight to Step 2's depth gate and the corresponding pipeline stage list once depth is determined.
3. **Model routing**: not specified — depends on depth, which is not determinable from these files.
4. **Ship mechanics**: standard SHIP mechanics apply regardless of depth (6-section PR body, gate stack, copilot-review-wait convergence, rebase-only merge, worktree teardown).
5. **Other applicable rules**: GATES.md "Concurrent-orchestrator yield protocol" — "Before touching any shared-queue PR: check last-commit recency (`gh pr view <n> --json commits`); minutes-old = it's actively driven → SKIP... if a remote head was replaced with unfamiliar history: YIELD, never force-push over it." Worktree per work item (Hard rules in SKILL.md and GATES.md's Worktrees section: `.worktrees/issue-N` under repo root, resolves node_modules from root, tear down after merge).

## S8 — "Promote dev to production." (ops)

1. **Pipeline/depth**: The skill files given (go/SKILL.md, GATES.md, enterprise/SKILL.md) do not mention a `/promote` skill or ops-type routing rule at all — Step 1 lists Type as including "ops" but Step 2's depth table has no ops-specific row, and there is no reference to a promote/deploy pipeline anywhere in these three files. **Not specified** in the files read. (I am told to answer strictly from these files and not invent — so I cannot state that it routes to /promote, since that skill's existence/behavior isn't described in go/SKILL.md, GATES.md, or enterprise/SKILL.md.)
2. **Ordered stages**: Not specified.
3. **Model routing**: Not specified.
4. **Ship mechanics**: Not specified — GATES.md's gate stack (PR body, lint, preflight, review-hard, enterprise-delivery-gate, copilot-review-wait, CodeRabbit, rebase merge) is scoped to "anotherben/helpdesk (dev + main)" pull requests, not to a dev→main promotion operation as such; whether/how it applies to a promote action is not addressed in these files.

---

## A/B-2 — Ship-stage prompt: finished diff touching apps/api/src/services/orderSync.js (SQL change)

**PR body**: Must use the exact 6-section template from GATES.md:
```
## What changed
## Regression check
## Blast radius
## Edge cases
## AI / Copilot review routing
## Conversations addressed
```
Every section must be non-placeholder (pr-body-gate / enterprise-delivery-gate body validation, fires first in the gate stack). Because this touches `apps/api/src/**/*.js` near SQL, `## Regression check` MUST contain a line matching exactly: `Real DB/schema proof: <cmd> - PASS` — colon right after "proof", plain ` - PASS` (no bold, no parenthetical before the colon). Note: "main's regex is stricter than dev's."

**Checks expected** (gate stack, in firing order per GATES.md):
1. pr-body-gate / enterprise-delivery-gate body validation
2. lint (diff-scoped ESLint + Prettier, required on both dev and main)
3. pr-scope-gate + branch freshness (require branches up to date + linear history; expect rebases)
4. preflight-dev (broad suite, 8–10 min)
5. review-hard (mechanical review script incl. live-DB proof checks and `ensureNoNewMockTests` — a module-level `jest.mock('config/database')` on DB-coupled changes is rejected)
6. enterprise-delivery-gate (SRP/file-size/dup/ratchet checks)
7. copilot-review-wait (the long pole; see convergence protocol)
8. CodeRabbit + content-survival (additional async review checks)

Additionally, since `orderSync.js` is under `apps/api/src/services/` — the Code Placement Law notes this directory is a "frozen baseline" for NEW runtime files (shared helpers go under `apps/api/src/scripts/**` or `domains/**`), though editing an existing file there isn't itself prohibited by the stated rule (only adding new files is called out).

Tests: real-DB contract test required per "Tests: live-DB, not mocks" — `apps/api/src/__tests__/real/*.contract.real.test.js` + `jest.real.config.js` + `liveDbContractHarness`/`primeTestDatabaseUrl`, pg_temp shadows, emitting `__LIVE_DB_PROOF__`. Run via `cd apps/api && npx jest --config jest.real.config.js <file> --runInBand --forceExit`. Creds in repo-root `.env`. The live-proof-registry `command` must require `TEST_DATABASE_URL` (never `DATABASE_URL`).

**Converging review threads**: Per the copilot-review-wait convergence protocol — it fails (non_waitable) unless ALL of: every other blocking check is SUCCESS; Copilot + CodeRabbit have posted; every review thread resolved (GraphQL `resolveReviewThread` + a substantive reply — no bulk resolving); DB-proof body line present. Treadmill rule: bots re-review on EVERY push and resolving threads does NOT re-trigger them, so batch ALL code fixes first to minimize pushes, then resolve remaining threads reply-only. Reply-required threads (codex `chatgpt-codex-connector`, `copilot-pull-request-reviewer`, plus CodeRabbit code-issue threads) need a substantive human reply (≥40 chars) as the LAST comment — bots often re-ack after the reply, so reply once more so the human has the last word, then re-run the gate. Justify-and-resolve nits without code changes; only fix genuine bugs.

**Rerun-after-green**: copilot-review-wait "gives up early while base checks still run → after base goes green, re-run it: `gh run rerun <runid> --failed`."

**Event-payload body caveat**: Gates read the PR body from the EVENT PAYLOAD, not the live API — after a body-only edit, must `gh pr close && gh pr reopen` (or push) to re-fire the gates; `gh run rerun` replays the stale body.

**Merge mechanics**: Merge: rebase ONLY (`gh pr merge <n> --rebase`). Squash/merge-commit disabled. 0 human approvals required; `enforce_admins=true` (no admin override).

**Restale/force-with-lease**: Every merge flips sibling PRs to BEHIND (clean) or DIRTY (conflict). BEHIND: `gh pr update-branch <n> --rebase`. DIRTY: worktree + `git rebase origin/<base>` + push `--force-with-lease` (never plain force). Import-block / SELECT-column conflicts: keep BOTH sides. Fetch `pull/<n>/head` for the true PR head since local `origin/<branch>` can be stale.

**Worktree teardown**: Per /go SHIP stage and GATES.md Worktrees section: worktree per work item, always tear down merged worktrees (cleanup engine / `cleanup-merged-worktrees.sh`) — worktree accumulation has caused disk-full incidents. A daily reaper may remove stale worktrees mid-run; recreate with `git worktree add <wt> <branch>` if the branch survives. `.worktrees/issue-N` under repo root resolves node_modules from root (no per-worktree install).

**Draft/babysitting**: Draft PR early; babysit with a sonnet poller, not the orchestrator (per /go's SHIP stage description).

**Concurrent-orchestrator check**: Before touching, check last-commit recency; minutes-old = actively driven → SKIP; if remote head replaced with unfamiliar history, YIELD, never force-push over it.
