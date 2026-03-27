#!/bin/bash

FLEET_CLI_BIN="${FLEET_CLI_BIN:-fleet-cli}"
VAULT_REGISTRY_CLI="${VAULT_REGISTRY_CLI:-${HOME}/.vault-index/src/coordination/registry_cli.js}"
ORCHESTRATOR_PROFILE="${FLEET_ORCHESTRATOR_PROFILE:-LEADER}"
ORCHESTRATOR_NAME="${FLEET_ORCHESTRATOR_NAME:-orchestrator}"
ORCHESTRATOR_DESCRIPTION="${FLEET_ORCHESTRATOR_DESCRIPTION:-Enterprise hardening orchestrator - monitors compliance, routes tasks to optimal tool+model}"

json_read() {
  local code="$1"
  python3 -c "$code" 2>/dev/null
}

sanitize_label() {
  printf '%s' "$1" | tr '[:space:]/:' '---' | tr -cd 'A-Za-z0-9._-'
}

current_worktree_root() {
  git rev-parse --show-toplevel 2>/dev/null
}

current_repo_root() {
  local git_common
  git_common=$(git rev-parse --git-common-dir 2>/dev/null)
  if [ -n "$git_common" ] && [ "$git_common" != ".git" ]; then
    cd "$(dirname "$git_common")" && pwd
    return
  fi
  current_worktree_root
}

current_branch_name() {
  git branch --show-current 2>/dev/null
}

current_fleet_session() {
  "$FLEET_CLI_BIN" session current --json 2>/dev/null | json_read 'import json,sys; print(json.load(sys.stdin).get("session",""))'
}

current_fleet_profile() {
  "$FLEET_CLI_BIN" session current --json 2>/dev/null | json_read 'import json,sys; print(json.load(sys.stdin).get("profile",""))'
}

current_worker_owner_instance() {
  local owner_family="$1"
  local session_name
  session_name=$(current_fleet_session)
  if [ -z "$session_name" ]; then
    return 1
  fi
  printf '%s:deck:%s' "$owner_family" "$(sanitize_label "$session_name")"
}

registry_cli() {
  node "$VAULT_REGISTRY_CLI" "$@"
}

ensure_fleet_orchestrator() {
  local owner_family="${1:-claude}"
  local owner_instance="${owner_family}:orchestrator:${ORCHESTRATOR_PROFILE}:${ORCHESTRATOR_NAME}"
  local status_json
  status_json=$("$FLEET_CLI_BIN" -p "$ORCHESTRATOR_PROFILE" conductor status "$ORCHESTRATOR_NAME" -json 2>/dev/null || true)

  local session_registered
  session_registered=$(printf '%s' "$status_json" | json_read 'import json,sys; data=json.load(sys.stdin); conductors=data.get("conductors",[]); print("1" if conductors and conductors[0].get("session_registered") else "")')
  if [ -z "$session_registered" ]; then
    "$FLEET_CLI_BIN" -p "$ORCHESTRATOR_PROFILE" conductor setup "$ORCHESTRATOR_NAME" -description "$ORCHESTRATOR_DESCRIPTION" -json >/dev/null
  fi

  local running
  running=$("$FLEET_CLI_BIN" -p "$ORCHESTRATOR_PROFILE" conductor status "$ORCHESTRATOR_NAME" -json 2>/dev/null | json_read 'import json,sys; data=json.load(sys.stdin); conductors=data.get("conductors",[]); print("1" if conductors and conductors[0].get("running") else "")')
  if [ -z "$running" ]; then
    "$FLEET_CLI_BIN" -p "$ORCHESTRATOR_PROFILE" session start "$ORCHESTRATOR_NAME" >/dev/null
  fi

  registry_cli ensure-orchestrator \
    --profile-name "$ORCHESTRATOR_PROFILE" \
    --conductor-name "$ORCHESTRATOR_NAME" \
    --owner-family "$owner_family" \
    --owner-instance "$owner_instance" \
    --fleet-session "$ORCHESTRATOR_NAME" \
    --repo-scope global
}

check_registered_dispatch_lane() {
  local fleet_session="$1"
  local repo_root="$2"
  local branch="$3"
  local worktree_root="$4"

  registry_cli check-dispatch \
    --profile-name "$ORCHESTRATOR_PROFILE" \
    --conductor-name "$ORCHESTRATOR_NAME" \
    --fleet-session "$fleet_session" \
    --repo-path "$repo_root" \
    --branch "$branch" \
    --worktree-path "$worktree_root"
}
