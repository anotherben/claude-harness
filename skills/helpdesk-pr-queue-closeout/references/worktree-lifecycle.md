# Worktree Lifecycle

## Route Card

Read `.codex/enterprise-state/hook-ledger/latest-route-card.json` before repo
mutation. Treat these as stale or unsafe:

- wrong repo root,
- wrong cwd,
- wrong base ref,
- old head after checkout or rebase,
- missing or contradictory route fields,
- `allowed_to_edit_here=false`.

Regenerate or reread the route card inside the PR worktree after checkout, rebase,
conflict resolution, or PR `headRefOid` change. Mutation is allowed only when the
route card permits it.

## Create

Use one unique clean worktree per PR/head SHA:

```bash
/Users/ben/.codex/bin/codex-new-worktree pr-<PR>-<short-sha> --repo /Users/ben/helpdesk
```

Do not reuse a dirty worktree. Detect existing active closeout worktrees, branches, or
locks for the same PR before starting.

## Preserve

Preserve the worktree when:

- the PR is blocked but local evidence remains useful,
- fixes are unpushed,
- artifacts have not been exported,
- `git status --porcelain` is not clean,
- origin/dev containment has not been verified after merge.

Report the path and revisit condition.

## Cleanup

Clean only after the PR is merged, closed, or explicitly abandoned and all evidence has
been saved, attached, or exported.

```bash
git -C <worktree> status --porcelain
git fetch origin --prune
git merge-base --is-ancestor <merge-or-head-sha> origin/dev
git worktree remove <worktree>
git worktree prune
```

Do not use `rm -rf` for worktree cleanup.
