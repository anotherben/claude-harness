# GitHub Issue Intake

Use this reference when an enterprise prompt names a GitHub issue number, issue
URL, or says to process a `gh issue`.

## Required Intake

1. Fetch the issue live:

```bash
python3 ~/.codex/skills/enterprise/scripts/github_issue_intake.py --repo <owner/name> --issue <number> --json
```

If the helper is unavailable, run the equivalent live command:

```bash
gh issue view <number> --repo <owner/name> --json number,title,state,labels,body,assignees,createdAt,updatedAt,url
```

2. Record or carry the GitHub Issue Intake Packet with:

- issue number, URL, title, state, labels, assignees, created/updated timestamps
- normalized labels and risk flags
- extracted source-read targets
- recommended enterprise route
- statement that `issue_body_is_proof=false`
- required next source reads and proof gates

3. Treat the issue as intake, not evidence. The issue may contain correct root
cause notes, production logs, or a suggested fix, but plan/contract/build cannot
trust them until current source and runtime/schema proof confirm them.

## Routing Rules

- Closed issue: `NO_EDIT_VERIFY_ISSUE_STATE` unless the user explicitly asks to
  reopen, audit, or port the fix.
- `bug` issue with production logs, schema/query/data, pricing/inventory/order,
  integration, or lock/transaction risk: start `DEBUG`, then promote to
  `STANDARD_AFTER_SOURCE_VERIFICATION` only after current code confirms root
  cause and scope.
- `ready-for-agent` means the issue is actionable enough to inspect; it does not
  bypass clean worktree, source reads, plan/contract, DB proof, review, forge, or
  verify.
- Specific issue with clear source targets and low risk may skip brainstorm, but
  it still needs path selection, source-read proof, issue-intent ledger, and a
  build packet before source edits.
- Vague issue, missing source targets, contradictory labels, or unclear operator
  outcome routes to `enterprise-brainstorm` or `enterprise-debug` before plan.

## Issue-Backed Plan Requirements

Every plan from a GitHub issue must include:

- `GitHub Issue Intake`: issue URL, labels, live fetch timestamp, route, risk
  flags, and source-read targets.
- `Issue Claim Verification`: each issue claim marked `confirmed`,
  `contradicted`, `unverified`, or `not relevant`, with file/line, command, DB
  proof, or blocker.
- `Issue Intent Continuity`: issue title/body claim, operator impact, acceptance
  criterion, non-goal, and proof command.
- `Alternatives And Decision Rationale`: issue-suggested fix, no-change/status
  quo, and at least one credible alternative when the choice is load-bearing.
- Normal enterprise sections: touched-file SRP, DB/query ownership, architecture
  ratchet, local full-schema proof, PR review prevention, and mechanical build
  packet when applicable.

## 2197-Style Numeric Overflow Pattern

An issue like `2197` has these risk flags:

- production log source
- schema/query/data-sensitive failure
- pricing/product mutation path
- external Shopify ingress
- lock/transaction context
- issue-suggested fix and schema-side alternative

Do not build directly from the suggested clamp. First verify:

- current source computes the percentage as claimed
- current schema precision/scale can overflow
- current dev branch or target branch has the same bug after refactors
- the INSERT/update happens in the claimed transaction or lock context
- the clamp, schema widening, or governance seam choice preserves audit semantics
- live/migrated integration proof covers overflow, normal percentage, negative
  percentage, zero/empty old price, and affected-row/readback behavior

Only after that can plan/contract lock the chosen fix.
