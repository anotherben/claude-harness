#!/bin/bash
set -euo pipefail

# claude-harness installer
# Installs hooks, skills, commands, and MCP servers GLOBALLY to ~/.claude/
# Then optionally sets up a project with .mcp.json and CLAUDE.md
#
# Usage:
#   ./install.sh                    # Global install + current project setup
#   ./install.sh --global           # Global install only (no project setup)
#   ./install.sh --project <path>   # Project setup only (assumes global already done)
#   ./install.sh --update           # Update global hooks/skills from repo

VERSION="2.2.1"
HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GLOBAL_DIR="$HOME/.claude"
RUNTIME_HOME="${CLAUDE_HARNESS_HOME:-$HOME/.claude-harness}"
MODE="full"  # full | global | project | update

# --- Parse args ---
PROJECT_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --global) MODE="global"; shift ;;
    --project) MODE="project"; PROJECT_DIR="${2:-.}"; shift 2 ;;
    --update) MODE="update"; shift ;;
    *) PROJECT_DIR="$1"; shift ;;
  esac
done
PROJECT_DIR="${PROJECT_DIR:-.}"

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}→${NC} $1"; }
ok()    { echo -e "${GREEN}✓${NC} $1"; }
warn()  { echo -e "${YELLOW}!${NC} $1"; }
err()   { echo -e "${RED}✗${NC} $1"; }

echo ""
echo -e "${BLUE}claude-harness${NC} installer v${VERSION}"
echo "Vibe prompt in, enterprise quality out."
echo ""

cortex_server_path() { echo "${RUNTIME_HOME}/cortex-engine/src/server.js"; }
skills_server_path() { echo "${RUNTIME_HOME}/skills-index/src/server.js"; }
vault_server_path() { echo "$HOME/.vault-index/src/server.js"; }
memory_server_path() { echo "$HOME/.cortex-memory/src/server.js"; }

# ============================================================
# GLOBAL INSTALL — hooks, skills, commands, settings to ~/.claude/
# ============================================================
install_global() {
  info "Installing globally to ${GLOBAL_DIR}/"

  # --- Hooks ---
  mkdir -p "$GLOBAL_DIR/hooks"
  local hook_count=0
  for hook in "$HARNESS_DIR/hooks/"*.sh; do
    [ -f "$hook" ] || continue
    local name=$(basename "$hook")
    cp "$hook" "$GLOBAL_DIR/hooks/$name"
    chmod +x "$GLOBAL_DIR/hooks/$name"
    hook_count=$((hook_count + 1))
  done
  ok "Installed ${hook_count} hooks to ~/.claude/hooks/"

  # --- Skills ---
  mkdir -p "$GLOBAL_DIR/skills"
  local skill_count=0
  for skill_dir in "$HARNESS_DIR/skills/"*/; do
    [ -d "$skill_dir" ] || continue
    local name=$(basename "$skill_dir")
    rm -rf "$GLOBAL_DIR/skills/$name"
    cp -r "$skill_dir" "$GLOBAL_DIR/skills/$name"
    skill_count=$((skill_count + 1))
  done
  ok "Installed ${skill_count} skills to ~/.claude/skills/"

  # --- Commands ---
  if [ -d "$HARNESS_DIR/commands" ]; then
    mkdir -p "$GLOBAL_DIR/commands"
    local cmd_count=0
    for cmd in "$HARNESS_DIR/commands/"*.md; do
      [ -f "$cmd" ] || continue
      cp "$cmd" "$GLOBAL_DIR/commands/$(basename "$cmd")"
      cmd_count=$((cmd_count + 1))
    done
    ok "Installed ${cmd_count} commands to ~/.claude/commands/"
  fi

  # --- Settings.json (hooks wiring) ---
  if [ -f "$GLOBAL_DIR/settings.json" ]; then
    # Check if hooks are already wired
    if python3 -c "import json; d=json.load(open('$GLOBAL_DIR/settings.json')); assert 'hooks' in d" 2>/dev/null; then
      warn "Existing ~/.claude/settings.json has hooks — preserving (run with --force to overwrite)"
    else
      generate_global_settings >> "$GLOBAL_DIR/settings.json"
      ok "Added hooks to existing ~/.claude/settings.json"
    fi
  else
    generate_global_settings > "$GLOBAL_DIR/settings.json"
    ok "Created ~/.claude/settings.json with hook wiring"
  fi

  # --- MCP Servers ---
  install_mcp_servers
  register_global_claude_mcp_servers
  register_global_codex_mcp_servers

  echo ""
  ok "Global install complete"
  echo "  Hooks:    ${hook_count} in ~/.claude/hooks/"
  echo "  Skills:   ${skill_count} in ~/.claude/skills/"
  echo "  Settings: ~/.claude/settings.json"
  echo "  Runtime:  ${RUNTIME_HOME}"
  echo "  Claude:   ~/.claude.json mcpServers updated"
  if command -v codex >/dev/null 2>&1; then
    echo "  Codex:    global MCP registry updated"
  fi
  echo ""
  echo "  All projects now use these hooks/skills automatically."
  echo "  No per-project copies needed."
}

# ============================================================
# SETTINGS.JSON GENERATOR — wires hooks to $HOME/.claude/hooks/
# ============================================================
generate_global_settings() {
  local hp='"$HOME"/.claude/hooks'
  cat <<SETTINGS_EOF
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "${hp}/block-bash-file-writes.sh", "timeout": 5 },
          { "type": "command", "command": "${hp}/pre-commit-gate.sh", "timeout": 10 },
          { "type": "command", "command": "${hp}/require-test-evidence.sh", "timeout": 5 },
          { "type": "command", "command": "${hp}/enforce-merge-protocol.sh", "timeout": 5 },
          { "type": "command", "command": "${hp}/require-lint-clean.sh", "timeout": 15 },
          { "type": "command", "command": "${hp}/require-vault-update.sh", "timeout": 5 },
          { "type": "command", "command": "${hp}/pre-merge-test-check.sh", "timeout": 5 },
          { "type": "command", "command": "${hp}/context-inject.sh", "timeout": 5 }
        ]
      },
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "${hp}/protect-files.sh", "timeout": 5 },
          { "type": "command", "command": "${hp}/require-tdd-before-source-edit.sh", "timeout": 5 },
          { "type": "command", "command": "${hp}/require-vault-for-edits.sh", "timeout": 5 },
          { "type": "command", "command": "${hp}/require-plan-before-edits.sh", "timeout": 5 },
          { "type": "command", "command": "${hp}/require-worktree.sh", "timeout": 5 },
          { "type": "command", "command": "${hp}/require-gate-sequence.sh", "timeout": 5 },
          { "type": "command", "command": "${hp}/suggest-skill.sh", "timeout": 5 }
        ]
      },
      {
        "matcher": "Skill",
        "hooks": [
          { "type": "command", "command": "${hp}/enforce-enterprise-pipeline.sh", "timeout": 5 },
          { "type": "command", "command": "${hp}/enforce-vault-context.sh", "timeout": 5 },
          { "type": "command", "command": "${hp}/require-independent-review.sh", "timeout": 5 }
        ]
      },
      {
        "matcher": "Agent",
        "hooks": [
          { "type": "command", "command": "${hp}/pre-agent-dispatch.sh", "timeout": 5 }
        ]
      },
      {
        "matcher": "Read",
        "hooks": [
          { "type": "command", "command": "${hp}/suggest-cortex-engine.sh", "timeout": 5 }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "${hp}/record-test-evidence.sh", "timeout": 10 },
          { "type": "command", "command": "${hp}/invalidate-after-git-op.sh", "timeout": 5 },
          { "type": "command", "command": "${hp}/post-merge-test-gate.sh", "timeout": 5 },
          { "type": "command", "command": "${hp}/mark-test-run.sh", "timeout": 5 },
          { "type": "command", "command": "${hp}/audit-bash-file-writes.sh", "timeout": 10 }
        ]
      },
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "${hp}/auto-format.sh", "timeout": 15 },
          { "type": "command", "command": "${hp}/cortex-engine-reindex.sh", "timeout": 5 }
        ]
      },
      {
        "matcher": "Skill",
        "hooks": [
          { "type": "command", "command": "${hp}/mark-skill-invoked.sh", "timeout": 5 }
        ]
      },
      {
        "matcher": "Agent",
        "hooks": [
          { "type": "command", "command": "${hp}/post-agent-checklist.sh", "timeout": 5 }
        ]
      },
      {
        "matcher": "ExitPlanMode",
        "hooks": [
          { "type": "command", "command": "${hp}/mark-plan-approved.sh", "timeout": 5 }
        ]
      },
      {
        "hooks": [
          { "type": "command", "command": "${hp}/context-fade.sh", "timeout": 5 }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "${hp}/ensure-environment.sh", "timeout": 30 }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "${hp}/refine-prompt.sh", "timeout": 5 }
        ]
      }
    ],
    "PostCompact": [
      {
        "hooks": [
          { "type": "command", "command": "${hp}/post-compact-handover.sh", "timeout": 5 },
          { "type": "command", "command": "${hp}/post-compact-reinject.sh", "timeout": 5 }
        ]
      }
    ],
    "Notification": [
      {
        "hooks": [
          { "type": "command", "command": "osascript -e 'display notification \"Claude Code needs your attention\" with title \"Claude Code\"'" }
        ]
      }
    ]
  }
}
SETTINGS_EOF
}

# ============================================================
# MCP SERVER INSTALL — cortex-engine, vault-index, skills-index, cortex-memory
# ============================================================
install_mcp_servers() {
  info "Setting up MCP servers..."

  # cortex-engine
  local cortex_dst="${RUNTIME_HOME}/cortex-engine"
  if [ -d "$HARNESS_DIR/cortex-engine" ]; then
    if [ ! -d "$cortex_dst" ] || [ "$MODE" = "update" ]; then
      mkdir -p "$(dirname "$cortex_dst")"
      rm -rf "$cortex_dst"
      cp -r "$HARNESS_DIR/cortex-engine" "$cortex_dst"
      (cd "$cortex_dst" && npm install --production 2>/dev/null)
      ok "cortex-engine installed at ${cortex_dst}"
    else
      ok "cortex-engine already at ${cortex_dst}"
    fi
  fi

  # vault-index
  local vault_dst="$HOME/.vault-index"
  if [ -d "$HARNESS_DIR/vault-index" ]; then
    if [ ! -d "$vault_dst" ] || [ "$MODE" = "update" ]; then
      rm -rf "$vault_dst"
      cp -r "$HARNESS_DIR/vault-index" "$vault_dst"
      (cd "$vault_dst" && npm install --production 2>/dev/null)
      ok "vault-index installed at ${vault_dst}"
    else
      ok "vault-index already at ${vault_dst}"
    fi
  fi

  # skills-index
  local skills_dst="${RUNTIME_HOME}/skills-index"
  if [ -d "$HARNESS_DIR/skills-index" ]; then
    if [ ! -d "$skills_dst" ] || [ "$MODE" = "update" ]; then
      mkdir -p "$(dirname "$skills_dst")"
      rm -rf "$skills_dst"
      cp -r "$HARNESS_DIR/skills-index" "$skills_dst"
      (cd "$skills_dst" && npm install --production 2>/dev/null)
      ok "skills-index installed at ${skills_dst}"
    else
      ok "skills-index already at ${skills_dst}"
    fi
  fi

  # cortex-memory
  local memory_dst="$HOME/.cortex-memory"
  if [ -d "$HARNESS_DIR/cortex-memory" ]; then
    if [ ! -d "$memory_dst" ] || [ "$MODE" = "update" ]; then
      rm -rf "$memory_dst"
      cp -r "$HARNESS_DIR/cortex-memory" "$memory_dst"
      (cd "$memory_dst" && npm install --production 2>/dev/null)
      ok "cortex-memory installed at ${memory_dst}"
    else
      ok "cortex-memory already at ${memory_dst}"
    fi
  fi
}

register_global_claude_mcp_servers() {
  local claude_json="$HOME/.claude.json"
  info "Registering global MCP servers in ${claude_json}"

  CLAUDE_JSON_PATH="$claude_json" \
  CORTEX_SERVER_PATH="$(cortex_server_path)" \
  VAULT_SERVER_PATH="$(vault_server_path)" \
  SKILLS_SERVER_PATH="$(skills_server_path)" \
  MEMORY_SERVER_PATH="$(memory_server_path)" \
  python3 - <<'PY'
import json
import os
from pathlib import Path

path = Path(os.environ["CLAUDE_JSON_PATH"]).expanduser()
if path.exists():
    data = json.loads(path.read_text())
else:
    data = {}

servers = data.setdefault("mcpServers", {})
desired = {
    "cortex-engine": {
        "type": "stdio",
        "command": "node",
        "args": [os.environ["CORTEX_SERVER_PATH"]],
    },
    "vault-index": {
        "type": "stdio",
        "command": "node",
        "args": [os.environ["VAULT_SERVER_PATH"]],
    },
    "skills-index": {
        "type": "stdio",
        "command": "node",
        "args": [os.environ["SKILLS_SERVER_PATH"]],
    },
    "cortex-memory": {
        "type": "stdio",
        "command": "node",
        "args": [os.environ["MEMORY_SERVER_PATH"]],
    },
}

changed = False
for name, config in desired.items():
    if servers.get(name) != config:
        servers[name] = config
        changed = True

if changed or not path.exists():
    path.write_text(json.dumps(data, indent=2) + "\\n")
    print("updated")
else:
    print("already current")
PY
  ok "Claude global MCP registration ready"
}

register_global_codex_mcp_servers() {
  if ! command -v codex >/dev/null 2>&1; then
    warn "Codex CLI not found — skipping global Codex MCP registration"
    return
  fi

  info "Registering global MCP servers in Codex"
  local failures=0

  while IFS='|' read -r name path; do
    codex mcp remove "$name" >/dev/null 2>&1 || true
    if codex mcp add "$name" -- node "$path" >/dev/null 2>&1; then
      ok "Codex MCP registered: ${name}"
    else
      warn "Codex MCP registration failed: ${name}"
      failures=$((failures + 1))
    fi
  done <<EOF
cortex-engine|$(cortex_server_path)
vault-index|$(vault_server_path)
skills-index|$(skills_server_path)
cortex-memory|$(memory_server_path)
EOF

  if [ "$failures" -gt 0 ]; then
    warn "Codex MCP registration completed with ${failures} failure(s)"
  fi
}

# ============================================================
# PROJECT SETUP — .mcp.json + CLAUDE.md (no hooks/skills copies)
# ============================================================
setup_project() {
  local target="$1"
  info "Setting up project at ${target}/"

  # --- Detect project ---
  local project_name
  project_name=$(cd "$target" && git remote get-url origin 2>/dev/null | sed 's/.*\///' | sed 's/\.git$//' || basename "$(pwd)")
  info "Project: ${project_name}"

  # --- .mcp.json ---
  local mcp_json="$target/.mcp.json"
  local cortex_dir
  cortex_dir="$(dirname "$(dirname "$(cortex_server_path)")")"
  local vault_dir="$HOME/.vault-index"
  local skills_dir
  skills_dir="$(dirname "$(dirname "$(skills_server_path)")")"
  local memory_dir="$HOME/.cortex-memory"

  if [ -f "$mcp_json" ]; then
    info "Existing .mcp.json found — merging MCP servers"
    python3 -c "
import json
with open('$mcp_json') as f:
    data = json.load(f)
servers = data.setdefault('mcpServers', {})
changed = False
for name, args_path in [('cortex-engine','$cortex_dir/src/server.js'),('vault-index','$vault_dir/src/server.js'),('skills-index','$skills_dir/src/server.js'),('cortex-memory','$memory_dir/src/server.js')]:
    if name not in servers:
        servers[name] = {'type':'stdio','command':'node','args':[args_path]}
        changed = True
if changed:
    with open('$mcp_json','w') as f:
        json.dump(data, f, indent=2)
    print('added missing servers')
else:
    print('all servers present')
" 2>/dev/null
  else
    cat > "$mcp_json" <<MCP_EOF
{
  "mcpServers": {
    "cortex-engine": {
      "type": "stdio",
      "command": "node",
      "args": ["${cortex_dir}/src/server.js"]
    },
    "vault-index": {
      "type": "stdio",
      "command": "node",
      "args": ["${vault_dir}/src/server.js"]
    },
    "skills-index": {
      "type": "stdio",
      "command": "node",
      "args": ["${skills_dir}/src/server.js"]
    },
    "cortex-memory": {
      "type": "stdio",
      "command": "node",
      "args": ["${memory_dir}/src/server.js"]
    }
  }
}
MCP_EOF
  fi
  ok "MCP servers configured in .mcp.json"

  # --- CLAUDE.md enforcement section ---
  if [ -f "$target/CLAUDE.md" ]; then
    if grep -q 'claude-harness enforcement' "$target/CLAUDE.md" 2>/dev/null; then
      info "CLAUDE.md already has enforcement section — skipping"
    else
      warn "Appending enforcement section to existing CLAUDE.md"
      echo "" >> "$target/CLAUDE.md"
      echo "<!-- claude-harness enforcement section -->" >> "$target/CLAUDE.md"
      generate_claude_md >> "$target/CLAUDE.md"
    fi
  else
    generate_claude_md > "$target/CLAUDE.md"
  fi
  ok "CLAUDE.md enforcement section ready"

  # --- Remove stale per-project copies (if upgrading from v1) ---
  if [ -d "$target/.claude/hooks" ]; then
    warn "Removing stale per-project hooks (now global)"
    rm -rf "$target/.claude/hooks"
  fi
  if [ -d "$target/.claude/skills" ]; then
    warn "Removing stale per-project skills (now global)"
    rm -rf "$target/.claude/skills"
  fi
  if [ -f "$target/.claude/settings.json" ]; then
    local has_only_hooks
    has_only_hooks=$(python3 -c "import json; d=json.load(open('$target/.claude/settings.json')); print('yes' if list(d.keys())==['hooks'] else 'no')" 2>/dev/null || echo "no")
    if [ "$has_only_hooks" = "yes" ]; then
      warn "Removing stale per-project settings.json (hooks now global)"
      rm "$target/.claude/settings.json"
    fi
  fi

  echo ""
  ok "Project setup complete"
  echo "  .mcp.json:  cortex-engine + vault-index + skills-index + cortex-memory"
  echo "  CLAUDE.md:  enforcement chain documented"
  echo "  Hooks:      global (~/.claude/hooks/) — no local copies"
  echo "  Skills:     global (~/.claude/skills/) — no local copies"
}

# ============================================================
# CLAUDE.MD GENERATOR
# ============================================================
generate_claude_md() {
  cat <<'CLAUDEMD_EOF'
## Proof-or-STFU (ENFORCED BY HOOKS)

**Every claim is false until you paste the test output.**

- "Tests pass" → false until test output is in this conversation
- "No regression" → false until you ran the full test suite
- "Already fixed" → false until you tested on current HEAD
- After ANY git operation, ALL prior results are stale
- After ANY source file edit, prior results are stale
- If you cannot verify, say **"UNVERIFIED"** — never say "passes"
- **Minimum evidence tier: `integration`** — mocked tests are not acceptable evidence.

Evidence is stored as JSON in `.claude/evidence/`. Hooks read this — not markdown, not /tmp markers.

### Hook enforcement chain (all exit 2 = hard block)

| When | Hook | What it checks |
|------|------|---------------|
| **Bash** any command | `block-bash-file-writes.sh` | Blocks writes to protected infra, marker forgery |
| **Edit/Write** source file | `require-tdd-before-source-edit.sh` | Must have recent tests or staged test files |
| **Edit/Write** protected file | `protect-files.sh` | Blocks .env, .git/hooks, .claude/hooks, .claude/settings.json |
| **Edit/Write** source file | `require-vault-for-edits.sh` | Must have HMAC-signed vault context |
| **Edit/Write** source file | `require-plan-before-edits.sh` | Must have HMAC-signed plan approval |
| **Bash** git commit | `require-test-evidence.sh` | HMAC-signed evidence, fresh, matching HEAD, min tier |
| **Bash** git commit | `require-lint-clean.sh` | Lint must pass on staged source files |
| **Bash** git commit | `pre-commit-gate.sh` | Must have test files or evidence |
| **Bash** git merge | `enforce-merge-protocol.sh` | Blocks blind conflict resolution |
| **Bash** test commands | `record-test-evidence.sh` | Auto-records HMAC-signed evidence JSON |
| **Bash** post-test | `audit-bash-file-writes.sh` | Detects + reverts source files modified via Bash |
| **Bash** git operations | `invalidate-after-git-op.sh` | Auto-marks evidence stale |
| **Skill** enterprise-* | `enforce-enterprise-pipeline.sh` | Must follow stage order |
| **Skill** enterprise-* | `enforce-vault-context.sh` | Must run /vault-context first |
| **Agent** dispatch | `pre-agent-dispatch.sh` | Creates vault pass for subagent |
| **Bash** git commit/push | `require-vault-update.sh` | Must have invoked /vault-update or /vault-capture |
| **Skill** enterprise-review | `require-independent-review.sh` | Builder cannot review own work |
| **PostToolUse** ExitPlanMode | `mark-plan-approved.sh` | HMAC-signed plan approval marker |

No escape hatches. No bypass tags. Agents cannot forge markers, modify hooks, or fabricate evidence.
CLAUDEMD_EOF
}

# ============================================================
# MAIN
# ============================================================
case "$MODE" in
  full)
    install_global
    echo ""
    setup_project "$PROJECT_DIR"
    ;;
  global)
    install_global
    ;;
  project)
    setup_project "$PROJECT_DIR"
    ;;
  update)
    info "Updating global hooks and skills..."
    install_global
    ;;
esac

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}claude-harness v${VERSION} installed${NC}"
echo ""
echo "  Global:  ~/.claude/hooks/, ~/.claude/skills/, ~/.claude/commands/"
echo "  MCP:     cortex-engine + vault-index + skills-index + cortex-memory"
echo "  Runtime: ${RUNTIME_HOME}"
echo ""
echo "  To set up a new project:  ./install.sh --project /path/to/project"
echo "  To update global:         ./install.sh --update"
echo ""
echo "Run /enterprise to start your first enforced development cycle."
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
