#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
DRY_RUN=false
PRESERVE_AGENTS=false

usage() {
  cat <<'EOF'
Usage: scripts/install-codex-overhead-savings.sh [options]

Installs the portable Codex startup-overhead bundle into CODEX_HOME.

Options:
  --codex-home <path>   Install into this Codex home instead of $CODEX_HOME or ~/.codex
  --dry-run             Print actions without writing files
  --preserve-agents     Do not replace an existing AGENTS.md
  -h, --help            Show this help

Environment:
  CODEX_HOME            Target Codex home
  HELPDESK_ROOTS        Colon-separated Helpdesk checkout roots for guard hooks
  CODEX_DEFAULT_REPO    Default repo used by the context hook
  VAULT_ROOT            Vault root for optional evidence notes
  CODEX_PROJECT_SLUG    Project slug used in optional evidence notes
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --codex-home)
      CODEX_HOME="${2:?missing value for --codex-home}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --preserve-agents)
      PRESERVE_AGENTS=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

run() {
  if [[ "$DRY_RUN" == true ]]; then
    printf '[dry-run]'
    printf ' %q' "$@"
    printf '\n'
  else
    "$@"
  fi
}

backup_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  local stamp
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  run cp "$file" "${file}.bak.${stamp}"
}

ensure_dir() {
  local dir="$1"
  if [[ "$DRY_RUN" == true ]]; then
    echo "[dry-run] mkdir -p $dir"
  else
    mkdir -p "$dir"
  fi
}

install_file() {
  local src="$1"
  local dst="$2"
  local mode="${3:-0644}"
  ensure_dir "$(dirname "$dst")"
  if [[ -f "$dst" ]] && cmp -s "$src" "$dst"; then
    echo "unchanged: $dst"
    return 0
  fi
  backup_file "$dst"
  run cp "$src" "$dst"
  run chmod "$mode" "$dst"
  if [[ "$DRY_RUN" == true ]]; then
    echo "would install: $dst"
  else
    echo "installed: $dst"
  fi
}

install_ignore() {
  local template="$ROOT_DIR/codex/templates/ignore"
  local target="$CODEX_HOME/.ignore"
  ensure_dir "$CODEX_HOME"
  if [[ ! -f "$target" ]]; then
    install_file "$template" "$target" 0644
    return 0
  fi
  backup_file "$target"
  if [[ "$DRY_RUN" == true ]]; then
    echo "[dry-run] merge ignore entries into $target"
    return 0
  fi
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^# ]] && continue
    if ! grep -Fxq "$line" "$target"; then
      printf '%s\n' "$line" >> "$target"
    fi
  done < "$template"
  echo "merged: $target"
}

patch_config() {
  local config="$CODEX_HOME/config.toml"
  ensure_dir "$CODEX_HOME"
  if [[ -f "$config" ]]; then
    backup_file "$config"
  elif [[ "$DRY_RUN" != true ]]; then
    : > "$config"
  fi
  if [[ "$DRY_RUN" == true ]]; then
    echo "[dry-run] set reasoning defaults in $config"
    return 0
  fi
  python3 - "$config" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
body = path.read_text(encoding="utf-8") if path.exists() else ""
settings = {
    "model_reasoning_effort": "medium",
    "plan_mode_reasoning_effort": "high",
}

def upsert(text: str, key: str, value: str) -> str:
    pattern = re.compile(rf'(?m)^(\s*{re.escape(key)}\s*=\s*)".*"\s*$')
    if pattern.search(text):
        return pattern.sub(rf'\1"{value}"', text, count=1)
    prefix = f'{key} = "{value}"\n'
    return prefix + text

for key, value in reversed(list(settings.items())):
    body = upsert(body, key, value)

path.write_text(body, encoding="utf-8")
PY
  echo "patched: $config"
}

patch_hooks_json() {
  local hooks_json="$CODEX_HOME/hooks.json"
  ensure_dir "$CODEX_HOME"
  if [[ -f "$hooks_json" ]]; then
    backup_file "$hooks_json"
  elif [[ "$DRY_RUN" != true ]]; then
    printf '{\n  "hooks": {}\n}\n' > "$hooks_json"
  fi
  if [[ "$DRY_RUN" == true ]]; then
    echo "[dry-run] merge Codex hook registrations into $hooks_json"
    return 0
  fi
  python3 - "$hooks_json" "$CODEX_HOME" <<'PY'
from pathlib import Path
import json
import sys

path = Path(sys.argv[1])
codex_home = Path(sys.argv[2])

try:
    data = json.loads(path.read_text(encoding="utf-8"))
except Exception:
    data = {"hooks": {}}
hooks = data.setdefault("hooks", {})

context = f"node {codex_home}/hooks/enterprise-context-hook.cjs"
write_guard = f"node {codex_home}/hooks/codex-write-guard.cjs"

wanted = {
    "SessionStart": [(None, f"{context} SessionStart", 5)],
    "UserPromptSubmit": [(None, f"{context} UserPromptSubmit", 5)],
    "PreToolUse": [(None, write_guard, 3)],
    "PostToolUse": [(None, f"{context} PostToolUse", 5)],
    "PreCompact": [(None, f"{context} PreCompact", 5)],
    "PostCompact": [(None, f"{context} PostCompact", 5)],
}

for event, entries in wanted.items():
    bucket = hooks.setdefault(event, [])
    for matcher, command, timeout in entries:
        already = False
        for item in bucket:
            for hook in item.get("hooks", []):
                if hook.get("command") == command:
                    already = True
                    break
            if already:
                break
        if already:
            continue
        item = {"hooks": [{"type": "command", "command": command, "timeout": timeout}]}
        if matcher:
            item["matcher"] = matcher
        bucket.append(item)

path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
PY
  echo "patched: $hooks_json"
}

main() {
  echo "Installing Codex overhead-savings bundle into $CODEX_HOME"
  install_file "$ROOT_DIR/codex/hooks/enterprise-context-hook.cjs" "$CODEX_HOME/hooks/enterprise-context-hook.cjs" 0755
  install_file "$ROOT_DIR/codex/hooks/codex-write-guard.cjs" "$CODEX_HOME/hooks/codex-write-guard.cjs" 0755
  if [[ "$PRESERVE_AGENTS" == true && -f "$CODEX_HOME/AGENTS.md" ]]; then
    echo "preserved: $CODEX_HOME/AGENTS.md"
  else
    install_file "$ROOT_DIR/codex/templates/AGENTS.md" "$CODEX_HOME/AGENTS.md" 0644
  fi
  install_ignore
  patch_config
  patch_hooks_json
  echo "Codex overhead-savings bundle installed."
}

main
