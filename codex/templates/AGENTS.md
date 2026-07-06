# Global Agent Platform Startup Card

This file is loaded often. Keep it as a routing layer, not a handbook. Load
details only from the repo route card, focused docs, `vault-index`, or
`cortex-engine` when the task route actually needs them. Keep edits surgical,
prefer existing routes, and keep `patch-or-fix` mandatory before merge or
merge-ready claims for bugfixes and behavior changes.

## Startup Discipline

- Default to cheap mode for questions, status checks, local machine cleanup,
  docs-only work, and unclear prompts: answer or inspect with no skill bodies,
  no subagents, no PR/CI/watchers, and no broad logs. Escalate only when the
  user asks for code/PR/merge/proof, or the route touches runtime behavior,
  schema/data, auth, integrations, inventory/order/payment/invoice/pricing, or
  production risk.
- Load only the explicit skill or canonical skill file required by the task.
- Keep `~/.codex/skills` live for explicit `$...` skill invocations.
- Query `vault-index` only for enterprise work, tracked recovery, or vault-state
  requests.
- Use `cortex-engine` as a targeted navigation aid for non-trivial source reads;
  skip it for status, docs-only, global maintenance, and tiny edits.
- Treat tokens as a budget: read the smallest current evidence that can support
  the next decision, and cap command output.
- In `~/.codex`, broad search respects `.ignore`; target ignored archives
  explicitly only for session archaeology or cache maintenance.
- When delegating, pass compact pre-read bundles instead of raw source hunts.

## Reasoning And Delegation Router

- At the start of substantial work, state:
  `WORKFLOW BUDGET: <medium|high|xhigh> | <solo|reviewer-subagent|discovery-subagent|multi-subagent> | <none|narrow|normal|expanded tools>`.
- `medium`: chat, status, docs, PR body cleanup, tiny edits, mechanical changes,
  clear tests, and low-blast-radius single-file fixes.
- `high`: normal serious engineering, multi-file changes, user-facing behavior,
  PR-producing work, and known async or integration patterns.
- `xhigh`: schema/data, auth, tenancy, security, payments, invoicing, pricing,
  inventory correctness, concurrency, cross-service failures, hard debugging, or
  conflicting requirements.
- Use subagents only for high/xhigh work, explicit requests, or independent
  adversarial review/proof jobs; keep each job bounded.
- `NO_EDIT` and `LOCAL_AGENT_MAINTENANCE` routes stay cheap. Lazy-load
  skills/MCPs and prefer narrow exact searches, capped output, and summarized
  tool results.

## Worktree Guard

Guarded repo roots are read/plan surfaces. Substantive edits, git state changes,
dependency installs, PR mutations, and patches belong in an isolated worktree or
exclusive branch claim. Prefer `~/.codex/bin/codex-new-worktree <slug> --repo
<repo>`. Use `CODEX_WORKTREE_GUARD=off` only on Ben's explicit override.

## Deep Think

For substantive coding, debugging, review, design, refactor, workflow, or system
analysis, do a compact Deep Think pass before acting: actual ask, source truth,
objective/root cause, ownership, blast radius, edge cases, SRP classification,
scope lock, and verification. Load the full skill or separate `zoom-out` /
`blast-radius` only for high-risk, PR-producing, unclear, or explicit routes.
Trace e2e when needed, and treat unverified claims as unproven.

## Helpdesk Hard Gates

- Applies to `$HOME/helpdesk` and `$HOME/Projects/helpdesk` by default. Set
  `HELPDESK_ROOTS` to a colon-separated root list when a server uses different
  checkout paths.
- New write/business code belongs under `apps/api/src/domains/<domain>/`; new
  `apps/api/src/services/` files are forbidden except SRP-compliant
  `*Gatekeeper*` seams or listed exceptions. Produce a File Plan before code
  edits that create files.
- SRP is the standard: one responsibility and one reason to change. Classify
  refactor pressure as `fix-now`, `follow-up`, or `note-only`.
- For Helpdesk code changes, prefer the local linked-dev profile when available
  and prove the touched surface with focused tests plus the route-appropriate
  review/canary gate before push or PR. Do not run Shopify/REX write canaries
  without Ben approving the exact object and scope.
- Governed entity or owned-table work requires the repo preflight and merge
  readiness artifacts; stay inside their allowed paths and stop if blockers are
  unknown.

## Enterprise Gates

- Enterprise skills start with `enterprise-precheck --skill <skill-name>
  [--packet <packet.json>]`; stop and report stderr on failure.
- Use the stable enterprise wrappers: `enterprise-required-gates`,
  `enterprise-agent-session`, and `enterprise-containment` for state, required
  gates, containment, and merge-stage checks. Do not bypass hooks for enterprise
  plans, contracts, solutions, or `.codex/enterprise-state/**`.

## PR And Merge Rules

- Never push directly to `main`.
- Codex-authored GitHub PRs use `~/.codex/bin/codex-pr-create`, not plain
  `gh pr create`; the body must satisfy `.github/pull_request_template.md`,
  including `Regression check`, `Blast radius`, `Edge cases`, and
  `Conversations addressed`.
- Before merge or merge-ready claims for bugfixes and behavior changes, run
  `patch-or-fix`, resolve every `FIX-NOW`, and file real structural follow-ups
  as GitHub issues with owner, scope, and proof target.
- Merge only when explicitly authorized. For Helpdesk PRs, run the repo's
  review-wait gate before merge.

## Model And Delegation

- Use only Codex-available models. Codex stays lead orchestrator, integrator,
  final reviewer, and decision owner.
- Use native Codex subagents only for bounded jobs where delegation is worth the
  context cost. Do not route Helpdesk enterprise stages through Claude bridge
  roles.

## Memory

- Do not load long memory snapshots by default. Search `vault-index` or
  `$CODEX_HOME/memories/MEMORY.md` with exact terms, then open only the one or
  two relevant entries.
- When answering from unverified memory, say it is memory-derived and may be
  stale if the fact is drift-prone.
