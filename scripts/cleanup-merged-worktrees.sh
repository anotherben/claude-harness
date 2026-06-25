#!/usr/bin/env bash
# cleanup-merged-worktrees.sh
# Remove git worktrees whose work is already merged (HEAD in origin/dev|main) OR whose
# remote branch was deleted on merge (delete_branch_on_merge:true). Commits always survive
# (branch refs persist past `worktree remove`); only uncommitted working-tree changes are at
# risk, and those are patch-backed before any --force. KEEPS: the main checkout, the current
# session's worktree, locked worktrees, and ACTIVE worktrees (remote branch still exists AND
# not yet merged = open/in-flight PR).
#
# One `git worktree list` enumerates EVERY location a worktree lives (.cursor/, ~/.codex/,
# ~/.claude/, .worktrees/) because they're all registered to the same repo .git — so a single
# pass covers them all.
#
# Usage:
#   cleanup-merged-worktrees.sh [--apply] [--repo DIR] [--scope all|session]
#                               [--current PATH] [--fetch] [--quiet]
# Default is DRY-RUN. Pass --apply to actually remove. Exit 0 always (safe for hooks/launchd).
#
# Proven recipe: see memory worktree-accumulation.md (2026-06-25 patch-back technique).

set -uo pipefail

REPO="${REPO:-/Users/ben/helpdesk}"
APPLY=0
NOFORCE=0
SCOPE=all
CURRENT="${CLAUDE_WORKTREE:-${CLAUDE_PROJECT_DIR:-}}"   # session's own worktree (scope=session)
FETCH=0
QUIET=0

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --no-force) NOFORCE=1 ;;
    --repo) REPO="$2"; shift ;;
    --scope) SCOPE="$2"; shift ;;
    --current) CURRENT="$2"; shift ;;
    --fetch) FETCH=1 ;;
    --quiet) QUIET=1 ;;
    *) echo "unknown arg: $1" >&2 ;;
  esac
  shift
done

DATE=$(date +%Y%m%d 2>/dev/null || echo manual)
BK_ROOT="$HOME/.claude/worktree-backups"
LOG_PREFIX="[worktree-cleanup]"
log() { [ "$QUIET" = 1 ] || echo "$LOG_PREFIX $*"; }

# git with an 8s wall-clock cap — worktree ops can HANG under lock contention with live
# Cursor gitWorker / running agents (memory: 2026-06-24). rc 142 = killed -> treat as busy.
g() { perl -e 'alarm 8; exec @ARGV' git "$@"; }

cd / 2>/dev/null   # never sit inside a worktree we may remove
[ -d "$REPO/.git" ] || { log "no git repo at $REPO — nothing to do"; exit 0; }

if [ "$FETCH" = 1 ]; then
  g -C "$REPO" fetch origin dev main --quiet 2>/dev/null || log "fetch failed (continuing with cached refs)"
fi

# Resolve integration tips once.
DEV=$(g -C "$REPO" rev-parse --verify -q origin/dev 2>/dev/null)
MAIN=$(g -C "$REPO" rev-parse --verify -q origin/main 2>/dev/null)
[ -n "$DEV$MAIN" ] || { log "neither origin/dev nor origin/main resolvable — abort (no merge baseline)"; exit 0; }

# Snapshot remote branches once (to detect 'merged & deleted' branches).
REMOTES=$(g -C "$REPO" ls-remote --heads origin 2>/dev/null | sed -E 's#.*refs/heads/##')

MAIN_WT=$(g -C "$REPO" rev-parse --show-toplevel 2>/dev/null)
# Normalise CURRENT to a real worktree top-level if provided.
[ -n "$CURRENT" ] && CURRENT=$(g -C "$CURRENT" rev-parse --show-toplevel 2>/dev/null || echo "$CURRENT")

removed=0; forced=0; patched=0; kept=0; busy=0; considered=0

# Parse porcelain worktree list into records.
wt=""; head=""; branch=""; locked=0
flush() {
  [ -n "$wt" ] || return 0
  local _wt="$wt" _head="$head" _branch="$branch" _locked="$locked"
  wt=""; head=""; branch=""; locked=0

  # --- skip rules (never touch) ---
  [ "$_wt" = "$MAIN_WT" ] && return 0                       # main checkout
  [ "$_wt" = "$REPO" ] && return 0
  [ "$_locked" = 1 ] && { log "KEEP (locked)         $_wt"; kept=$((kept+1)); return 0; }
  if [ "$SCOPE" = session ]; then
    # session scope: act ONLY on the session's own worktree (target it for removal)
    [ -z "$CURRENT" ] && return 0
    [ "$_wt" != "$CURRENT" ] && return 0
  else
    # full sweep: protect the worktree we're running from
    if [ -n "$CURRENT" ] && [ "$_wt" = "$CURRENT" ]; then
      log "KEEP (current session) $_wt"; kept=$((kept+1)); return 0
    fi
  fi

  considered=$((considered+1))
  local short="${_branch#refs/heads/}"

  # --- merged? HEAD reachable from dev or main ---
  local merged=no
  if [ -n "$DEV" ] && g -C "$REPO" merge-base --is-ancestor "$_head" "$DEV" 2>/dev/null; then merged=yes; fi
  if [ "$merged" = no ] && [ -n "$MAIN" ] && g -C "$REPO" merge-base --is-ancestor "$_head" "$MAIN" 2>/dev/null; then merged=yes; fi

  # --- remote branch gone? (deleted on merge) ---
  local remote=gone
  if [ "$short" != "$_head" ] && [ -n "$short" ]; then
    if printf '%s\n' "$REMOTES" | grep -qxF "$short"; then remote=exists; fi
  fi

  # KEEP active: not merged AND remote branch still present (open/in-flight PR)
  if [ "$merged" = no ] && [ "$remote" = exists ]; then
    log "KEEP (active PR)      $_wt [$short]"; kept=$((kept+1)); return 0
  fi

  # --- removable ---
  local why; [ "$merged" = yes ] && why="merged" || why="remote-gone"
  if [ "$APPLY" != 1 ]; then
    log "WOULD REMOVE ($why)   $_wt [$short]"; return 0
  fi

  # patch-back ALL uncommitted work — tracked mods AND untracked files — before any force,
  # so removal is fully reversible (nothing lost but disposable agent markers). Disposable
  # markers (.worktree-role, .cursor/, settings.local.json) don't count as "work".
  if [ -d "$_wt" ]; then
    local dc; dc=$(g -C "$_wt" status --porcelain 2>/dev/null \
      | grep -vE '^\?\? (\.worktree-role|\.cursor/|\.claude/settings\.local\.json)$' | wc -l | tr -d ' ')
    if [ "${dc:-0}" -gt 0 ]; then
      mkdir -p "$BK_ROOT/$DATE"
      local safe; safe=$(printf '%s' "${short:-detached}-$(basename "$_wt")" | tr '/ ' '__')
      # stage everything (incl untracked) so the patch captures new-file CONTENT, then unstage
      g -C "$_wt" add -A 2>/dev/null
      if g -C "$_wt" diff --cached HEAD > "$BK_ROOT/$DATE/$safe.patch" 2>/dev/null \
         && [ -s "$BK_ROOT/$DATE/$safe.patch" ]; then
        patched=$((patched+1)); log "  patched $dc uncommitted file(s) -> $BK_ROOT/$DATE/$safe.patch"
      fi
      g -C "$_wt" reset -q 2>/dev/null
    fi
  fi

  if g -C "$REPO" worktree remove "$_wt" 2>/dev/null; then
    removed=$((removed+1)); log "REMOVED ($why)        $_wt"
  elif [ "$NOFORCE" = 1 ]; then
    kept=$((kept+1)); log "KEEP (dirty, --no-force) $_wt"
  elif g -C "$REPO" worktree remove --force "$_wt" 2>/dev/null; then
    forced=$((forced+1)); log "FORCE-REMOVED ($why)  $_wt"
  else
    busy=$((busy+1)); log "BUSY/SKIP             $_wt (locked or in-use; retry next run)"
  fi
}

while IFS= read -r line; do
  case "$line" in
    worktree\ *) flush; wt="${line#worktree }" ;;
    HEAD\ *)     head="${line#HEAD }" ;;
    branch\ *)   branch="${line#branch }" ;;
    detached)    branch="" ;;
    locked*)     locked=1 ;;
    "")          flush ;;
  esac
done < <(g -C "$REPO" worktree list --porcelain 2>/dev/null)
flush

if [ "$APPLY" = 1 ]; then
  g -C "$REPO" worktree prune 2>/dev/null || true
  # delete local branches fully merged into dev/main (refs are tiny but tidy up)
  for base in "$DEV" "$MAIN"; do
    [ -n "$base" ] || continue
    g -C "$REPO" for-each-ref --format='%(refname:short)' refs/heads 2>/dev/null | while IFS= read -r b; do
      case "$b" in main|dev|master) continue ;; esac
      g -C "$REPO" merge-base --is-ancestor "refs/heads/$b" "$base" 2>/dev/null && \
        g -C "$REPO" branch -D "$b" >/dev/null 2>&1 && log "branch -D $b (merged)"
    done
  done
  # sweep empty parent dirs left behind in nested worktree stores (~/.codex/worktrees/<id>/)
  for store in "$HOME/.codex/worktrees" "$HOME/.claude/worktrees"; do
    [ -d "$store" ] && find "$store" -mindepth 1 -maxdepth 1 -type d -empty -delete 2>/dev/null
  done
fi

log "summary: considered=$considered removed=$removed forced=$forced patched=$patched kept=$kept busy=$busy apply=$APPLY scope=$SCOPE"
exit 0
