# GATES.md — the real merge gates (single source of truth)

Scope: anotherben/helpdesk (dev + main). Every workflow stage that plans, builds, or ships MUST
reference this file instead of embedding its own copy of gate knowledge. If reality disagrees with
this file, verify with `gh pr checks` / `gh api repos/anotherben/helpdesk/rules/branches/<base>`
and update THIS file — never fork the knowledge into another skill.
Last verified: 2026-07-04 (30-PR mining sweep + merge-gate memories).

## Gate stack, in firing order

1. **pr-body-gate / enterprise-delivery-gate body validation** — PR body must use the 6-section
   template (below), every section non-placeholder.
2. **lint** — diff-scoped ESLint + Prettier. Required on BOTH dev and main.
3. **pr-scope-gate + branch freshness** — base moves fast; "require branches up to date" + linear
   history. Expect rebases.
4. **preflight-dev** — broad suite, 8–10 min.
5. **review-hard** — mechanical review script incl. live-DB proof checks and
   `ensureNoNewMockTests` (a module-level `jest.mock('config/database')` on DB-coupled changes is
   rejected).
6. **enterprise-delivery-gate** — SRP/file-size/dup/ratchet checks (see Ratchets).
7. **copilot-review-wait** — the long pole. See convergence protocol.
8. **CodeRabbit + content-survival** — additional async review checks.
9. **Merge: rebase ONLY** (`gh pr merge <n> --rebase`). Squash/merge-commit disabled. 0 GitHub
   approvals required; `enforce_admins=true` (no admin override).
   **Operator authorization:** dev merges are autonomous once green. Merges to **main** (and any
   prod-facing promote) are human-gated — never run them without Ben's explicit go-ahead for that
   specific PR. Zero *GitHub* approvals ≠ zero *operator* approval.

## PR body template (exact section headers)

```
## What changed
## Regression check
## Blast radius
## Edge cases
## AI / Copilot review routing
## Conversations addressed
```

- If the diff touches `apps/api/src/**/*.js` near SQL, `## Regression check` MUST contain a line
  matching exactly: `Real DB/schema proof: <cmd> - PASS` — colon right after "proof", plain
  ` - PASS` (no bold, no parenthetical before the colon). **main's regex is stricter than dev's.**
- Gates read the body from the EVENT PAYLOAD, not the live API: after a body-only edit,
  `gh pr close && gh pr reopen` (or push) to re-fire the gates — `gh run rerun` replays the stale
  body.

## copilot-review-wait convergence protocol

Fails (non_waitable) unless ALL of: every other blocking check SUCCESS; Copilot + CodeRabbit have
posted; every review thread resolved (GraphQL `resolveReviewThread` + substantive reply — no bulk
resolving); DB-proof body line present when required. It gives up early while base checks still
run → after base goes green, re-run it: `gh run rerun <runid> --failed`.

**Treadmill rule:** bots re-review on EVERY push; resolving threads does NOT re-trigger them.
So: batch ALL code fixes first, minimise pushes, then resolve remaining threads reply-only.
Reply-required threads (codex `chatgpt-codex-connector`, `copilot-pull-request-reviewer`,
plus CodeRabbit code-issue threads) need a substantive human reply (≥40 chars) as the LAST
comment — bots often re-ack after your reply; reply once more so the human has the last word,
then re-run the gate. Justify-and-resolve nits without code changes; fix only genuine bugs.

## Tests: live-DB, not mocks

DB-coupled changes need real-DB contract tests:
`apps/api/src/__tests__/real/*.contract.real.test.js` + `jest.real.config.js` +
`liveDbContractHarness`/`primeTestDatabaseUrl`, pg_temp shadows, emit `__LIVE_DB_PROOF__`.
Run: `cd apps/api && npx jest --config jest.real.config.js <file> --runInBand --forceExit`.
Creds in repo-root `.env` (dev is fully mutable). live-proof-registry `command` must require
`TEST_DATABASE_URL` (never `DATABASE_URL`).

## Ratchets & placement law

- **SRP soft limit** 400 lines (api services cohort), **god-file hard limit** 800
  (`tests/architecture/cohortBudgetRatchet.test.cjs`). Rebasing two PRs together can trip these.
  Fix: compact, or a JUSTIFIED entry in `docs/architecture/cohorts/srp-soft-limit-documented.json`
  — never boilerplate justifications (that spawns its own bugfix PRs, see PR #3820).
- **Code Placement Law:** no NEW runtime files under `apps/api/src/services/` (frozen baseline) —
  shared helpers go under `apps/api/src/scripts/**` or `domains/**`.
- **purchasing-full-kit-evidence:** purchasing-scoped changes must regenerate the closeout
  artifact via the real proof pipeline; never hand-edit `proof_subject_sha`.
- `docs/blast-radius/` and `docs/verify/` are LIVE CI inputs — write real entries there;
  `plans/`, `.codex/enterprise-state/`, `handover/` are dead conventions — do not add to them.

## Restale cascade & rebase protocol

Every merge flips sibling PRs to BEHIND (clean) or DIRTY (conflict).
- BEHIND: `gh pr update-branch <n> --rebase`.
- DIRTY: worktree + `git rebase origin/<base>` + push `--force-with-lease` (never plain force).
- Import-block / SELECT-column conflicts: keep BOTH sides.
- Fetch `pull/<n>/head` for the true PR head — local `origin/<branch>` can be stale.

## Concurrent-orchestrator yield protocol

Other automations (Cursor, Codex, other Claude runs) work the same queue. Before touching any
shared-queue PR: check last-commit recency (`gh pr view <n> --json commits`); minutes-old = it's
actively driven → SKIP. If a remote head was replaced with unfamiliar history: YIELD, never
force-push over it; if their version ships a bug you found, leave one substantive PR comment with
repro + fix and move on. If codex review quota is exhausted account-wide, substitute
`/code-review xhigh` subagents as the review gate.

## Worktrees

`.worktrees/issue-N` under the repo root resolve `node_modules` from the root (no per-worktree
install). Always tear down merged worktrees (cleanup engine / `cleanup-merged-worktrees.sh`) —
worktree accumulation has caused disk-full incidents. A daily reaper may remove worktrees it
thinks are stale mid-run; recreate with `git worktree add <wt> <branch>` if the branch survives.
