#!/bin/bash
# SessionEnd hook — opportunistically remove THIS session's own worktree iff its branch is
# already merged and it has no uncommitted changes. Conservative by design:
#   - only ever touches the session's own worktree (--scope session), never others
#   - --no-force: a worktree with uncommitted/untracked work is LEFT ALONE (never discarded)
#   - no-ops silently unless the session ran inside a helpdesk worktree store
# The heavy lifting (merged/remote-gone classification, patch-back) lives in the shared engine.
# The daily launchd safety-net catches anything this misses.

INPUT=$(cat 2>/dev/null)
CWD=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('cwd',''))" 2>/dev/null)
[ -z "$CWD" ] && CWD="$PWD"

# Only act when the session was inside a registered worktree store (not the main checkout).
case "$CWD" in
  */.cursor/worktrees/*|*/.codex/worktrees/*|*/.Codex/worktrees/*|*/.claude/worktrees/*|*/.cache/worktrees/*|*/.worktrees/*) ;;
  *) exit 0 ;;
esac

ENGINE="$HOME/.claude/scripts/cleanup-merged-worktrees.sh"
[ -x "$ENGINE" ] || exit 0

# Resolve the worktree top-level and its owning repo's common dir, so we target the right repo.
WT_TOP=$(perl -e 'alarm 8; exec @ARGV' git -C "$CWD" rev-parse --show-toplevel 2>/dev/null) || exit 0
REPO_MAIN=$(perl -e 'alarm 8; exec @ARGV' git -C "$CWD" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
REPO_MAIN=$(dirname "$REPO_MAIN" 2>/dev/null)
[ -d "$REPO_MAIN/.git" ] || REPO_MAIN="/Users/ben/helpdesk"

"$ENGINE" --repo "$REPO_MAIN" --scope session --current "$WT_TOP" --apply --no-force --quiet >/dev/null 2>&1 &
exit 0
