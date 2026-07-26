#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
TARGET_HOME="${CODEX_USER_HOME:-}"
AGENT_PLATFORM_HOME="${AGENT_PLATFORM_HOME:-}"
DRY_RUN=false
PRESERVE_AGENTS=false

usage() {
  cat <<'EOF'
Usage: scripts/install-codex-overhead-savings.sh [options]

Installs the portable GPT-5.6 Codex scope-alignment bundle into CODEX_HOME.

Options:
  --codex-home <path>          Install into this Codex home instead of ~/.codex
  --user-home <path>           Home used for portable absolute paths
  --agent-platform-home <path> Canonical full-skill home (default: <user-home>/.agent-platform)
  --dry-run                    Print actions without writing target files
  --preserve-agents            Preserve an existing global AGENTS.md
  -h, --help                   Show this help

Environment:
  CODEX_HOME            Target Codex home
  CODEX_USER_HOME       Home used for portable absolute paths
  AGENT_PLATFORM_HOME   Canonical full-skill home
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
    --user-home)
      TARGET_HOME="${2:?missing value for --user-home}"
      shift 2
      ;;
    --agent-platform-home)
      AGENT_PLATFORM_HOME="${2:?missing value for --agent-platform-home}"
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

if [[ -z "$TARGET_HOME" ]]; then
  if [[ "$(basename "$CODEX_HOME")" == ".codex" ]]; then
    TARGET_HOME="$(dirname "$CODEX_HOME")"
  else
    TARGET_HOME="$HOME"
  fi
fi
AGENT_PLATFORM_HOME="${AGENT_PLATFORM_HOME:-$TARGET_HOME/.agent-platform}"

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
    [[ -d "$dir" ]] || echo "[dry-run] mkdir -p $dir"
  else
    mkdir -p "$dir"
  fi
}

install_file() {
  local src="$1"
  local dst="$2"
  local mode="${3:-0644}"
  if [[ -L "$dst" ]]; then
    echo "Refusing to replace symlink target: $dst" >&2
    return 1
  fi
  if [[ -f "$dst" ]] && cmp -s "$src" "$dst"; then
    echo "unchanged: $dst"
    return 0
  fi
  ensure_dir "$(dirname "$dst")"
  backup_file "$dst"
  run cp "$src" "$dst"
  run chmod "$mode" "$dst"
  if [[ "$DRY_RUN" == true ]]; then
    echo "would install: $dst"
  else
    echo "installed: $dst"
  fi
}

install_tree() {
  local src_root="$1"
  local dst_root="$2"
  local src rel mode
  while IFS= read -r src; do
    rel="${src#"$src_root"/}"
    mode=0644
    [[ -x "$src" ]] && mode=0755
    install_file "$src" "$dst_root/$rel" "$mode"
  done < <(find "$src_root" -type f | LC_ALL=C sort)
}

install_rendered_tree() {
  local src_root="$1"
  local dst_root="$2"
  local src rel mode tmp
  while IFS= read -r src; do
    rel="${src#"$src_root"/}"
    mode=0644
    [[ -x "$src" ]] && mode=0755
    tmp="$(mktemp "${TMPDIR:-/tmp}/codex-portable.XXXXXX")"
    python3 - "$src" "$CODEX_HOME" "$AGENT_PLATFORM_HOME" "$TARGET_HOME" > "$tmp" <<'PY'
from pathlib import Path
import sys

source = Path(sys.argv[1]).read_text(encoding="utf-8")
source = source.replace("/Users/ben/.agent-platform", sys.argv[3])
source = source.replace("/Users/ben/.codex", sys.argv[2])
source = source.replace("/Users/ben", sys.argv[4])
sys.stdout.write(source)
PY
    install_file "$tmp" "$dst_root/$rel" "$mode"
    rm -f "$tmp"
  done < <(find "$src_root" -type f | LC_ALL=C sort)
}

render_template() {
  local src="$1"
  local dst="$2"
  local placeholder="$3"
  local replacement="$4"
  local tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/codex-template.XXXXXX")"
  python3 - "$src" "$placeholder" "$replacement" > "$tmp" <<'PY'
from pathlib import Path
import sys

source = Path(sys.argv[1]).read_text(encoding="utf-8")
sys.stdout.write(source.replace(sys.argv[2], sys.argv[3]))
PY
  install_file "$tmp" "$dst" 0644
  rm -f "$tmp"
}

install_ignore() {
  local template="$ROOT_DIR/codex/templates/ignore"
  local target="$CODEX_HOME/.ignore"
  if [[ ! -f "$target" ]]; then
    install_file "$template" "$target" 0644
    return 0
  fi

  local missing=""
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^# ]] && continue
    if ! grep -Fxq "$line" "$target"; then
      missing+="$line"$'\n'
    fi
  done < "$template"

  if [[ -z "$missing" ]]; then
    echo "unchanged: $target"
    return 0
  fi
  backup_file "$target"
  if [[ "$DRY_RUN" == true ]]; then
    echo "[dry-run] merge ignore entries into $target"
  else
    printf '%s' "$missing" >> "$target"
    echo "merged: $target"
  fi
}

refuse_symlink_target() {
  local target="$1"
  if [[ -L "$target" ]]; then
    echo "Refusing to patch symlink target: $target" >&2
    return 1
  fi
}

preflight_targets() {
  refuse_symlink_target "$CODEX_HOME/AGENTS.md"
  refuse_symlink_target "$CODEX_HOME/.ignore"
  refuse_symlink_target "$CODEX_HOME/config.toml"
  refuse_symlink_target "$CODEX_HOME/hooks.json"
}

preflight_dependencies() {
  command -v node >/dev/null 2>&1 || {
    echo "Node.js is required for the installed Codex hooks." >&2
    return 1
  }
  command -v python3 >/dev/null 2>&1 || {
    echo "Python 3.11 or newer is required for safe Codex config merging." >&2
    return 1
  }
  python3 -c 'import tomllib' >/dev/null 2>&1 || {
    echo "Python 3.11 or newer with tomllib is required for safe Codex config merging." >&2
    return 1
  }
}

patch_config() {
  local config="$CODEX_HOME/config.toml"
  local tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/codex-config.XXXXXX")"
  python3 "$ROOT_DIR/scripts/patch-codex-overhead-config.py" "$config" "$TARGET_HOME" > "$tmp"

  if [[ -f "$config" ]] && cmp -s "$tmp" "$config"; then
    rm -f "$tmp"
    echo "unchanged: $config"
    return 0
  fi
  ensure_dir "$CODEX_HOME"
  backup_file "$config"
  if [[ "$DRY_RUN" == true ]]; then
    echo "would patch: $config"
  else
    cp "$tmp" "$config"
    chmod 0644 "$config"
    echo "patched: $config"
  fi
  rm -f "$tmp"
}

patch_hooks_json() {
  local hooks_json="$CODEX_HOME/hooks.json"
  local tmp
  tmp="$(mktemp "${TMPDIR:-/tmp}/codex-hooks.XXXXXX")"
  python3 - "$hooks_json" "$CODEX_HOME" > "$tmp" <<'PY'
from pathlib import Path
import json
import sys

path = Path(sys.argv[1])
codex_home = Path(sys.argv[2])

try:
    data = json.loads(path.read_text(encoding="utf-8"))
except FileNotFoundError:
    data = {"hooks": {}}
except Exception as error:
    raise SystemExit(f"Refusing to replace invalid hooks JSON at {path}: {error}")
hooks = data.setdefault("hooks", {})

from shlex import quote

context = f"node {quote(str(codex_home / 'hooks' / 'enterprise-context-hook.cjs'))}"
write_guard = f"node {quote(str(codex_home / 'hooks' / 'codex-write-guard.cjs'))}"
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
        if any(
            hook.get("command") == command
            for item in bucket
            for hook in item.get("hooks", [])
        ):
            continue
        item = {"hooks": [{"type": "command", "command": command, "timeout": timeout}]}
        if matcher:
            item["matcher"] = matcher
        bucket.append(item)

sys.stdout.write(json.dumps(data, indent=2) + "\n")
PY

  if [[ -f "$hooks_json" ]] && cmp -s "$tmp" "$hooks_json"; then
    rm -f "$tmp"
    echo "unchanged: $hooks_json"
    return 0
  fi
  ensure_dir "$CODEX_HOME"
  backup_file "$hooks_json"
  if [[ "$DRY_RUN" == true ]]; then
    echo "would patch: $hooks_json"
  else
    cp "$tmp" "$hooks_json"
    chmod 0644 "$hooks_json"
    echo "patched: $hooks_json"
  fi
  rm -f "$tmp"
}

install_agents() {
  install_tree "$ROOT_DIR/codex/agents" "$CODEX_HOME/agents"
}

install_scope_skills() {
  install_rendered_tree "$ROOT_DIR/skills/diagnose" "$AGENT_PLATFORM_HOME/skills/diagnose"
  install_rendered_tree "$ROOT_DIR/skills/patch-or-fix" "$AGENT_PLATFORM_HOME/skills/patch-or-fix"
  install_rendered_tree "$ROOT_DIR/skills/blast-radius" "$CODEX_HOME/skills/blast-radius"
  install_rendered_tree "$ROOT_DIR/skills/diagnostic-cohort" "$CODEX_HOME/skills/diagnostic-cohort"
  install_rendered_tree "$ROOT_DIR/skills/nested-agent-control" "$CODEX_HOME/skills/nested-agent-control"
  render_template \
    "$ROOT_DIR/codex/templates/skills/diagnose/SKILL.md" \
    "$CODEX_HOME/skills/diagnose/SKILL.md" \
    "__AGENT_PLATFORM_HOME__" \
    "$AGENT_PLATFORM_HOME"
  render_template \
    "$ROOT_DIR/codex/templates/skills/patch-or-fix/SKILL.md" \
    "$CODEX_HOME/skills/patch-or-fix/SKILL.md" \
    "__AGENT_PLATFORM_HOME__" \
    "$AGENT_PLATFORM_HOME"
}

main() {
  echo "Installing GPT-5.6 Codex scope-alignment bundle into $CODEX_HOME"
  echo "Portable user home: $TARGET_HOME"
  echo "Canonical skill home: $AGENT_PLATFORM_HOME"
  preflight_dependencies
  preflight_targets
  install_file "$ROOT_DIR/codex/hooks/enterprise-context-hook.cjs" "$CODEX_HOME/hooks/enterprise-context-hook.cjs" 0755
  install_file "$ROOT_DIR/codex/hooks/codex-write-guard.cjs" "$CODEX_HOME/hooks/codex-write-guard.cjs" 0755
  if [[ "$PRESERVE_AGENTS" == true && -f "$CODEX_HOME/AGENTS.md" ]]; then
    echo "preserved: $CODEX_HOME/AGENTS.md"
  else
    install_file "$ROOT_DIR/codex/templates/AGENTS.md" "$CODEX_HOME/AGENTS.md" 0644
  fi
  install_agents
  install_scope_skills
  install_ignore
  patch_config
  patch_hooks_json
  echo "GPT-5.6 Codex scope-alignment bundle installed. Restart Codex before verification."
}

main
