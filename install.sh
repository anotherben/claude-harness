#!/bin/bash
set -euo pipefail

# claude-harness installer
# Usage: curl -fsSL https://raw.githubusercontent.com/<your-org>/claude-harness/main/install.sh | bash
# Or:    cd my-project && ~/claude-harness/install.sh

VERSION="1.0.0"
HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="${1:-.}"
CLAUDE_DIR="$TARGET_DIR/.claude"

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

# --- Header ---
echo ""
echo -e "${BLUE}claude-harness${NC} installer v${VERSION}"
echo "Vibe prompt in, enterprise quality out."
echo ""

# --- Detect project type ---
detect_project() {
  if [ -f "$TARGET_DIR/package.json" ]; then
    echo "node"
  elif [ -f "$TARGET_DIR/pyproject.toml" ] || [ -f "$TARGET_DIR/setup.py" ]; then
    echo "python"
  elif [ -f "$TARGET_DIR/go.mod" ]; then
    echo "go"
  elif [ -f "$TARGET_DIR/Cargo.toml" ]; then
    echo "rust"
  else
    echo "unknown"
  fi
}

PROJECT_TYPE=$(detect_project)
info "Detected project type: ${PROJECT_TYPE}"

# --- Detect project name ---
detect_project_name() {
  # Try git remote
  local name
  name=$(cd "$TARGET_DIR" && git remote get-url origin 2>/dev/null | sed 's/.*\///' | sed 's/\.git$//' || true)
  if [ -n "$name" ]; then
    echo "$name"
    return
  fi
  # Fall back to directory name
  basename "$(cd "$TARGET_DIR" && pwd)"
}

DEFAULT_PROJECT_NAME=$(detect_project_name)
read -rp "Project name [$DEFAULT_PROJECT_NAME]: " PROJECT_NAME
PROJECT_NAME="${PROJECT_NAME:-$DEFAULT_PROJECT_NAME}"
info "Project: ${PROJECT_NAME}"

# --- Choose tier ---
echo ""
echo "Choose your tier:"
echo "  [1] Lite     — TDD + evidence + lint + merge protocol"
echo "  [2] Standard — + vault integration, plan gate, independent review"
echo "  [3] Full     — + context injection, cortex-engine, skills-index, prompt refinement"
echo ""
read -rp "Tier [1/2/3]: " TIER_CHOICE
case "$TIER_CHOICE" in
  1) TIER="lite" ;;
  2) TIER="standard" ;;
  3) TIER="full" ;;
  *) TIER="lite"; warn "Invalid choice, defaulting to Lite" ;;
esac
info "Installing ${TIER} tier"

# --- Tier-specific prompts ---

# Test command
DEFAULT_TEST=""
case "$PROJECT_TYPE" in
  node)
    if [ -f "$TARGET_DIR/package.json" ]; then
      if grep -q '"test:local"' "$TARGET_DIR/package.json" 2>/dev/null; then
        DEFAULT_TEST="npm run test:local"
      elif grep -q '"test"' "$TARGET_DIR/package.json" 2>/dev/null; then
        DEFAULT_TEST="npm test"
      fi
    fi
    ;;
  python) DEFAULT_TEST="pytest" ;;
  go) DEFAULT_TEST="go test ./..." ;;
  rust) DEFAULT_TEST="cargo test" ;;
esac
read -rp "Test command [${DEFAULT_TEST:-npm test}]: " TEST_COMMAND
TEST_COMMAND="${TEST_COMMAND:-${DEFAULT_TEST:-npm test}}"

# Lint command
DEFAULT_LINT=""
case "$PROJECT_TYPE" in
  node) DEFAULT_LINT="npx eslint" ;;
  python) DEFAULT_LINT="ruff check" ;;
  go) DEFAULT_LINT="golangci-lint run" ;;
  rust) DEFAULT_LINT="cargo clippy" ;;
esac
read -rp "Lint command [${DEFAULT_LINT:-npx eslint}]: " LINT_COMMAND
LINT_COMMAND="${LINT_COMMAND:-${DEFAULT_LINT:-npx eslint}}"

# Source extensions
DEFAULT_EXT=""
case "$PROJECT_TYPE" in
  node) DEFAULT_EXT="js,jsx,ts,tsx" ;;
  python) DEFAULT_EXT="py" ;;
  go) DEFAULT_EXT="go" ;;
  rust) DEFAULT_EXT="rs" ;;
esac
read -rp "Source file extensions [${DEFAULT_EXT:-js,jsx,ts,tsx}]: " SOURCE_EXTENSIONS
SOURCE_EXTENSIONS="${SOURCE_EXTENSIONS:-${DEFAULT_EXT:-js,jsx,ts,tsx}}"

# Protected files
read -rp "Protected files (comma-separated) [.env]: " PROTECTED_FILES
PROTECTED_FILES="${PROTECTED_FILES:-.env}"

# Min suites
read -rp "Minimum test suites for evidence [10]: " MIN_SUITES
MIN_SUITES="${MIN_SUITES:-10}"

# Min test tier
echo ""
echo "Minimum test tier for commit evidence:"
echo "  [1] integration (default) — tests must hit real services (DB, API)"
echo "  [2] e2e                   — browser tests must pass"
echo "  [3] mocked                — any passing tests count (not recommended)"
echo ""
read -rp "Minimum tier [1/2/3]: " TIER_CHOICE_TEST
case "$TIER_CHOICE_TEST" in
  1) MIN_TEST_TIER="integration" ;;
  2) MIN_TEST_TIER="e2e" ;;
  3) MIN_TEST_TIER="mocked" ;;
  *) MIN_TEST_TIER="integration"; warn "Invalid choice, defaulting to integration" ;;
esac
info "Minimum test tier: ${MIN_TEST_TIER}"

# Vault path (required — Obsidian is core to the harness)
VAULT_PATH=""
VAULT_EVIDENCE_PATH=""
read -rp "Obsidian vault path [~/Documents/Vault]: " VAULT_PATH
VAULT_PATH="${VAULT_PATH:-$HOME/Documents/Vault}"
VAULT_EVIDENCE_PATH="${VAULT_PATH}/_evidence"
if [ ! -d "$VAULT_PATH" ]; then
  warn "Vault path does not exist yet — it will be created at install time"
  mkdir -p "$VAULT_PATH"
  mkdir -p "$VAULT_EVIDENCE_PATH"
  ok "Created vault at ${VAULT_PATH}"
fi

# --- Create directory structure ---
echo ""
info "Creating directory structure..."
mkdir -p "$CLAUDE_DIR/hooks"
mkdir -p "$CLAUDE_DIR/skills"
mkdir -p "$CLAUDE_DIR/evidence"
mkdir -p "$CLAUDE_DIR/enterprise-state"
ok "Directory structure created"

# --- Determine which hooks to install ---
get_hooks_for_tier() {
  local tier="$1"
  # Lite hooks (always installed — includes vault, which is core)
  local hooks=(
    protect-files.sh
    require-tdd-before-source-edit.sh
    require-test-evidence.sh
    record-test-evidence.sh
    invalidate-after-git-op.sh
    pre-commit-gate.sh
    require-lint-clean.sh
    enforce-enterprise-pipeline.sh
    enforce-merge-protocol.sh
    post-merge-test-gate.sh
    mark-skill-invoked.sh
    auto-format.sh
    require-vault-for-edits.sh
    require-vault-update.sh
    enforce-vault-context.sh
    vault-gates.sh
    vault-sweep-reminder.sh
    pre-agent-dispatch.sh
    post-agent-checklist.sh
  )

  # Standard adds
  if [ "$tier" = "standard" ] || [ "$tier" = "full" ]; then
    hooks+=(
      require-plan-before-edits.sh
      require-independent-review.sh
      mark-plan-approved.sh
      pre-merge-test-check.sh
    )
  fi

  # Full adds
  if [ "$tier" = "full" ]; then
    hooks+=(
      context-inject.sh
      context-fade.sh
      refine-prompt.sh
      suggest-cortex.sh
      suggest-skill.sh
      cortex-reindex.sh
      post-compact-handover.sh
      ensure-environment.sh
    )
  fi

  echo "${hooks[@]}"
}

# --- Copy and templatize hooks ---
info "Installing hooks..."
HOOK_COUNT=0
for hook in $(get_hooks_for_tier "$TIER"); do
  if [ -f "$HARNESS_DIR/hooks/$hook" ]; then
    sed \
      -e "s|{{PROJECT_NAME}}|${PROJECT_NAME}|g" \
      -e "s|{{TEST_COMMAND}}|${TEST_COMMAND}|g" \
      -e "s|{{LINT_COMMAND}}|${LINT_COMMAND}|g" \
      -e "s|{{PROTECTED_FILES}}|${PROTECTED_FILES}|g" \
      -e "s|{{SOURCE_EXTENSIONS}}|${SOURCE_EXTENSIONS}|g" \
      -e "s|{{MIN_SUITES}}|${MIN_SUITES}|g" \
      -e "s|{{MIN_TEST_TIER}}|${MIN_TEST_TIER}|g" \
      -e "s|{{VAULT_PATH}}|${VAULT_PATH}|g" \
      -e "s|{{VAULT_EVIDENCE_PATH}}|${VAULT_EVIDENCE_PATH}|g" \
      "$HARNESS_DIR/hooks/$hook" > "$CLAUDE_DIR/hooks/$hook"
    chmod +x "$CLAUDE_DIR/hooks/$hook"
    HOOK_COUNT=$((HOOK_COUNT + 1))
  else
    warn "Hook not found: $hook (skipped)"
  fi
done
ok "Installed ${HOOK_COUNT} hooks"

# --- Copy skills ---
info "Installing skills..."
SKILL_COUNT=0

# Get skill list from tier JSON
get_skills_for_tier() {
  local tier="$1"
  # Base skills (all tiers — vault is core to the harness)
  local skills=(
    enterprise enterprise-discover enterprise-brainstorm
    enterprise-plan enterprise-contract enterprise-build
    enterprise-review enterprise-forge enterprise-verify
    enterprise-compound enterprise-debug enterprise-harness
    contract-manager scope-check patch-or-fix but-why
    handover-writer session-heartbeat run-verification
    senior-architect deploy-checklist create-migration
    vault-capture vault-context vault-init vault-process
    vault-status vault-sweep vault-triage vault-update
    worktree-cleanup cortex-index
    integration-guard sql-guard sync-worker
    rex-soap-protocol shopify-integration
    prompt-intelligence harness-update
  )

  # Full adds
  if [ "$tier" = "full" ]; then
    skills+=(conductor-resume)
  fi

  echo "${skills[@]}"
}

for skill in $(get_skills_for_tier "$TIER"); do
  if [ -d "$HARNESS_DIR/skills/$skill" ]; then
    cp -r "$HARNESS_DIR/skills/$skill" "$CLAUDE_DIR/skills/$skill"
    SKILL_COUNT=$((SKILL_COUNT + 1))
  fi
done
ok "Installed ${SKILL_COUNT} skills"

# --- Generate settings.json ---
info "Generating settings.json..."

generate_settings() {
  local tier="$1"
  local hook_prefix='$CLAUDE_PROJECT_DIR/.claude/hooks'

  cat <<SETTINGS_EOF
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "${hook_prefix}/pre-commit-gate.sh", "timeout": 10 },
          { "type": "command", "command": "${hook_prefix}/require-test-evidence.sh", "timeout": 5 },
          { "type": "command", "command": "${hook_prefix}/enforce-merge-protocol.sh", "timeout": 5 },
          { "type": "command", "command": "${hook_prefix}/require-lint-clean.sh", "timeout": 15 },
          { "type": "command", "command": "${hook_prefix}/require-vault-update.sh", "timeout": 5 }$(
  if [ "$tier" = "standard" ] || [ "$tier" = "full" ]; then
    cat <<STANDARD_BASH
,
          { "type": "command", "command": "${hook_prefix}/pre-merge-test-check.sh", "timeout": 5 }
STANDARD_BASH
  fi)
        ]
      },
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "${hook_prefix}/protect-files.sh", "timeout": 5 },
          { "type": "command", "command": "${hook_prefix}/require-tdd-before-source-edit.sh", "timeout": 5 },
          { "type": "command", "command": "${hook_prefix}/require-vault-for-edits.sh", "timeout": 5 }$(
  if [ "$tier" = "standard" ] || [ "$tier" = "full" ]; then
    cat <<STANDARD_EDIT
,
          { "type": "command", "command": "${hook_prefix}/require-plan-before-edits.sh", "timeout": 5 }
STANDARD_EDIT
  fi)
$(if [ "$tier" = "full" ]; then
    cat <<FULL_EDIT_PRE
,
          { "type": "command", "command": "${hook_prefix}/suggest-skill.sh", "timeout": 5 }
FULL_EDIT_PRE
  fi)
        ]
      },
      {
        "matcher": "Skill",
        "hooks": [
          { "type": "command", "command": "${hook_prefix}/enforce-enterprise-pipeline.sh", "timeout": 5 },
          { "type": "command", "command": "${hook_prefix}/enforce-vault-context.sh", "timeout": 5 },
          { "type": "command", "command": "${hook_prefix}/vault-gates.sh", "timeout": 10 }$(
  if [ "$tier" = "standard" ] || [ "$tier" = "full" ]; then
    cat <<STANDARD_SKILL
,
          { "type": "command", "command": "${hook_prefix}/require-independent-review.sh", "timeout": 5 }
STANDARD_SKILL
  fi)
        ]
      },
      {
        "matcher": "Agent",
        "hooks": [
          { "type": "command", "command": "${hook_prefix}/pre-agent-dispatch.sh", "timeout": 5 }
        ]
      }$(
  if [ "$tier" = "full" ]; then
    cat <<FULL_READ
,
      {
        "matcher": "Read",
        "hooks": [
          { "type": "command", "command": "${hook_prefix}/suggest-cortex.sh", "timeout": 5 }
        ]
      }
FULL_READ
  fi)
    ],
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          { "type": "command", "command": "${hook_prefix}/record-test-evidence.sh", "timeout": 10 },
          { "type": "command", "command": "${hook_prefix}/invalidate-after-git-op.sh", "timeout": 5 },
          { "type": "command", "command": "${hook_prefix}/post-merge-test-gate.sh", "timeout": 5 }
        ]
      },
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "${hook_prefix}/auto-format.sh", "timeout": 15 }$(
  if [ "$tier" = "full" ]; then
    cat <<FULL_EDIT_POST
,
          { "type": "command", "command": "${hook_prefix}/cortex-reindex.sh", "timeout": 5 }
FULL_EDIT_POST
  fi)
        ]
      },
      {
        "matcher": "Skill",
        "hooks": [
          { "type": "command", "command": "${hook_prefix}/mark-skill-invoked.sh", "timeout": 5 }
        ]
      },
      {
        "matcher": "Agent",
        "hooks": [
          { "type": "command", "command": "${hook_prefix}/post-agent-checklist.sh", "timeout": 5 }
        ]
      }$(
  if [ "$tier" = "standard" ] || [ "$tier" = "full" ]; then
    cat <<STANDARD_EXIT_PLAN
,
      {
        "matcher": "ExitPlanMode",
        "hooks": [
          { "type": "command", "command": "${hook_prefix}/mark-plan-approved.sh", "timeout": 5 }
        ]
      }
STANDARD_EXIT_PLAN
  fi)$(
  if [ "$tier" = "full" ]; then
    cat <<FULL_CONTEXT
,
      {
        "hooks": [
          { "type": "command", "command": "${hook_prefix}/context-fade.sh", "timeout": 5 }
        ]
      }
FULL_CONTEXT
  fi)
    ],
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "${hook_prefix}/vault-sweep-reminder.sh", "timeout": 5 }$(
  if [ "$tier" = "full" ]; then
    cat <<FULL_SESSION
,
          { "type": "command", "command": "${hook_prefix}/ensure-environment.sh", "timeout": 30 }
FULL_SESSION
  fi)
        ]
      }
    ]$(
  if [ "$tier" = "full" ]; then
    cat <<FULL_LIFECYCLE
,
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "${hook_prefix}/refine-prompt.sh", "timeout": 5 }
        ]
      }
    ],
    "PostCompact": [
      {
        "hooks": [
          { "type": "command", "command": "${hook_prefix}/post-compact-handover.sh", "timeout": 5 }
        ]
      }
    ]
FULL_LIFECYCLE
  fi)
  }
}
SETTINGS_EOF
}

# Check for existing settings.json
if [ -f "$CLAUDE_DIR/settings.json" ]; then
  warn "Existing settings.json found — backing up to settings.json.bak"
  cp "$CLAUDE_DIR/settings.json" "$CLAUDE_DIR/settings.json.bak"
fi

generate_settings "$TIER" > "$CLAUDE_DIR/settings.json"

# Validate JSON
if python3 -c "import json; json.load(open('$CLAUDE_DIR/settings.json'))" 2>/dev/null; then
  ok "Generated valid settings.json"
else
  err "Generated settings.json is invalid — check manually"
fi

# --- Generate CLAUDE.md enforcement section ---
info "Generating CLAUDE.md..."

generate_claude_md() {
  local tier="$1"
  local min_tier="${MIN_TEST_TIER:-integration}"
  cat <<CLAUDEMD_HEADER
## Proof-or-STFU (ENFORCED BY HOOKS)

**Every claim is false until you paste the test output.**

- "Tests pass" → false until test output is in this conversation
- "No regression" → false until you ran the full test suite
- "Already fixed" → false until you tested on current HEAD
- After ANY git operation, ALL prior results are stale
- After ANY source file edit, prior results are stale
- If you cannot verify, say **"UNVERIFIED"** — never say "passes"
- **Minimum evidence tier: \`${min_tier}\`** — mocked tests are not acceptable evidence. Run integration tests (\`npm run test:local\` or equivalent) before committing.

Evidence is stored as JSON in \`.claude/evidence/\`. Hooks read this — not markdown, not /tmp markers.

### Hook enforcement chain (all exit 2 = hard block)

| When | Hook | What it checks |
|------|------|---------------|
CLAUDEMD_HEADER

  # Lite hooks (always)
  cat <<'LITE_ROWS'
| **Edit/Write** source file | `require-tdd-before-source-edit.sh` | Must have recent tests or staged test files |
| **Edit/Write** protected file | `protect-files.sh` | Blocks protected files |
| **Bash** git commit | `require-test-evidence.sh` | Evidence must be fresh, matching HEAD, minimum tier enforced |
| **Bash** git commit | `require-lint-clean.sh` | Lint must pass on staged source files |
| **Bash** git commit | `pre-commit-gate.sh` | Must have test files or evidence |
| **Bash** git merge | `enforce-merge-protocol.sh` | Blocks blind conflict resolution |
| **Bash** test commands | `record-test-evidence.sh` | Auto-records evidence JSON with tier, output, and vault note |
| **Bash** git operations | `invalidate-after-git-op.sh` | Auto-marks evidence stale |
| **Bash** git merge | `post-merge-test-gate.sh` | Flags merge-pending-test state |
| **Skill** enterprise-* | `enforce-enterprise-pipeline.sh` | Must follow stage order |
| **Edit/Write** source file | `require-vault-for-edits.sh` | Must have vault context (subagents auto-inherit via vault pass) |
| **Agent** dispatch | `pre-agent-dispatch.sh` | Creates vault pass so subagent inherits parent authorization |
| **Skill** enterprise-* | `enforce-vault-context.sh` | Must run /vault-context first |
| **Bash** git commit/push | `require-vault-update.sh` | Must have invoked /vault-update or /vault-capture |
LITE_ROWS

  # Standard adds
  if [ "$tier" = "standard" ] || [ "$tier" = "full" ]; then
    cat <<'STANDARD_ROWS'
| **Edit/Write** source file | `require-plan-before-edits.sh` | Must have approved plan |
| **Skill** enterprise-review | `require-independent-review.sh` | Builder cannot review own work |
| **Bash** git merge | `pre-merge-test-check.sh` | Must test after prior merges |
| **PostToolUse** ExitPlanMode | `mark-plan-approved.sh` | Sets plan-approved marker |
STANDARD_ROWS
  fi

  # Full adds
  if [ "$tier" = "full" ]; then
    cat <<'FULL_ROWS'
| **Read** source file >50 lines | `suggest-cortex.sh` | Must use cortex-engine MCP |
| **PostCompact** | `post-compact-handover.sh` | Escalates handover urgency |
FULL_ROWS
  fi

  cat <<'CLAUDEMD_FOOTER'

No escape hatches. No bypass tags. If no source files are staged the checks skip automatically — that's the only legitimate bypass.
If a hook blocks you, fix the issue. Do not try to work around it.
CLAUDEMD_FOOTER
}

# Append to existing CLAUDE.md or create new
if [ -f "$TARGET_DIR/CLAUDE.md" ]; then
  warn "Existing CLAUDE.md found — appending enforcement section"
  echo "" >> "$TARGET_DIR/CLAUDE.md"
  echo "<!-- claude-harness enforcement section -->" >> "$TARGET_DIR/CLAUDE.md"
  generate_claude_md "$TIER" >> "$TARGET_DIR/CLAUDE.md"
else
  generate_claude_md "$TIER" > "$TARGET_DIR/CLAUDE.md"
fi
ok "CLAUDE.md updated with enforcement chain"

# --- Install vault-index MCP server ---
info "Setting up vault-index MCP server..."
VAULT_INDEX_DIR="$HOME/.vault-index"
if [ ! -d "$VAULT_INDEX_DIR" ]; then
  cp -r "$HARNESS_DIR/vault-index" "$VAULT_INDEX_DIR"
  (cd "$VAULT_INDEX_DIR" && npm install --production 2>/dev/null)
  ok "vault-index installed at ${VAULT_INDEX_DIR}"
else
  info "vault-index already exists at ${VAULT_INDEX_DIR} — skipping"
fi

# --- Install cortex-engine MCP server ---
info "Setting up cortex-engine MCP server..."
CORTEX_DIR="$HOME/claude-harness/cortex-engine"
if [ -d "$CORTEX_DIR" ] && [ -f "$CORTEX_DIR/package.json" ]; then
  if [ ! -d "$CORTEX_DIR/node_modules" ]; then
    (cd "$CORTEX_DIR" && npm install --production 2>/dev/null)
    ok "cortex-engine dependencies installed"
  else
    ok "cortex-engine already set up"
  fi
else
  warn "cortex-engine not found at ${CORTEX_DIR} — install manually"
fi

# --- Install skills-index MCP server ---
info "Setting up skills-index MCP server..."
SKILLS_INDEX_DIR="$HOME/claude-harness/skills-index"
if [ -d "$SKILLS_INDEX_DIR" ] && [ -f "$SKILLS_INDEX_DIR/package.json" ]; then
  if [ ! -d "$SKILLS_INDEX_DIR/node_modules" ]; then
    (cd "$SKILLS_INDEX_DIR" && npm install --production 2>/dev/null)
    ok "skills-index dependencies installed"
  else
    ok "skills-index already set up"
  fi
else
  warn "skills-index not found at ${SKILLS_INDEX_DIR} — install manually"
fi

# --- Register MCP servers in project .mcp.json ---
info "Registering MCP servers..."
MCP_JSON="$TARGET_DIR/.mcp.json"
if [ -f "$MCP_JSON" ]; then
  # Add cortex-engine, vault-index, and skills-index if not present
  python3 -c "
import json, sys
with open('$MCP_JSON') as f:
    data = json.load(f)
servers = data.setdefault('mcpServers', {})
changed = False
if 'cortex-engine' not in servers:
    servers['cortex-engine'] = {
        'type': 'stdio',
        'command': 'node',
        'args': ['$CORTEX_DIR/src/server.js']
    }
    changed = True
if 'vault-index' not in servers:
    servers['vault-index'] = {
        'type': 'stdio',
        'command': 'node',
        'args': ['$VAULT_INDEX_DIR/src/server.js']
    }
    changed = True
if 'skills-index' not in servers:
    servers['skills-index'] = {
        'type': 'stdio',
        'command': 'node',
        'args': ['$SKILLS_INDEX_DIR/src/server.js']
    }
    changed = True
if changed:
    with open('$MCP_JSON', 'w') as f:
        json.dump(data, f, indent=2)
    print('added')
else:
    print('present')
" 2>/dev/null
  ok "MCP servers registered in .mcp.json"
else
  cat > "$MCP_JSON" <<MCP_EOF
{
  "mcpServers": {
    "cortex-engine": {
      "type": "stdio",
      "command": "node",
      "args": ["$CORTEX_DIR/src/server.js"]
    },
    "vault-index": {
      "type": "stdio",
      "command": "node",
      "args": ["$VAULT_INDEX_DIR/src/server.js"]
    },
    "skills-index": {
      "type": "stdio",
      "command": "node",
      "args": ["$SKILLS_INDEX_DIR/src/server.js"]
    }
  }
}
MCP_EOF
  ok "Created .mcp.json with MCP servers"
fi

# --- Summary ---
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}claude-harness installed (${TIER} tier)${NC}"
echo ""
echo "  Hooks:  ${HOOK_COUNT} installed in .claude/hooks/"
echo "  Skills: ${SKILL_COUNT} installed in .claude/skills/"
echo "  Config: .claude/settings.json generated"
echo "  MCP:    cortex-engine + vault-index + skills-index registered"
echo "  Docs:   CLAUDE.md enforcement section added"
echo ""
echo "Run /enterprise to start your first enforced development cycle."
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
