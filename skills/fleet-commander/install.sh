#!/bin/bash
# Fleet Commander — Install Script
# Copies hooks into place and shows the user what to add to settings.local.json.
#
# Usage:
#   bash install.sh                  # install to current project
#   bash install.sh /path/to/project # install to specific project

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="${1:-$(pwd)}"
SKILL_DIR="$PROJECT_DIR/.claude/skills/fleet-commander"
HOOKS_DIR="$SKILL_DIR/hooks"
SETTINGS_FILE="$PROJECT_DIR/.claude/settings.local.json"

echo "Fleet Commander — Install"
echo "========================="
echo ""
echo "Project:  $PROJECT_DIR"
echo "Skill:    $SKILL_DIR"
echo ""

# Step 1: Ensure skill directory exists
if [ ! -d "$PROJECT_DIR/.claude/skills" ]; then
  mkdir -p "$PROJECT_DIR/.claude/skills"
fi

# Step 2: Copy skill files if installing from external location
if [ "$SCRIPT_DIR" != "$SKILL_DIR" ]; then
  echo "Copying skill files..."
  mkdir -p "$SKILL_DIR/hooks"
  cp "$SCRIPT_DIR/SKILL.md" "$SKILL_DIR/"
  cp "$SCRIPT_DIR/hooks/"*.sh "$HOOKS_DIR/"
  cp "$SCRIPT_DIR/settings.template.json" "$SKILL_DIR/"
  cp "$SCRIPT_DIR/install.sh" "$SKILL_DIR/"
  [ -f "$SCRIPT_DIR/README.md" ] && cp "$SCRIPT_DIR/README.md" "$SKILL_DIR/"
  echo "  Done."
  echo ""
fi

# Step 3: Make hooks executable
chmod +x "$HOOKS_DIR/"*.sh
echo "Hooks marked executable."
echo ""

# Step 4: Ensure enterprise-state directory exists
mkdir -p "$PROJECT_DIR/.claude/enterprise-state"
echo "Created .claude/enterprise-state/ directory."
echo ""

# Step 5: Show what to add to settings
echo "═══════════════════════════════════════════════"
echo "  MANUAL STEP: Add hooks to settings.local.json"
echo "═══════════════════════════════════════════════"
echo ""
echo "Add the following to your .claude/settings.local.json 'hooks' section."
echo "Replace \${SKILL_DIR} with: $SKILL_DIR"
echo ""
echo "In PreToolUse → Bash matcher, add:"
echo "  { \"type\": \"command\", \"command\": \"$HOOKS_DIR/run-hook.sh enforce-fleet-gate.sh\", \"timeout\": 10 }"
echo "  { \"type\": \"command\", \"command\": \"$HOOKS_DIR/run-hook.sh enforce-merge-protocol.sh\", \"timeout\": 5 }"
echo "  { \"type\": \"command\", \"command\": \"$HOOKS_DIR/run-hook.sh pre-merge-test-check.sh\", \"timeout\": 5 }"
echo "  { \"type\": \"command\", \"command\": \"$HOOKS_DIR/run-hook.sh agent-output-review.sh\", \"timeout\": 5 }"
echo ""
echo "In PreToolUse → Edit|Write|MultiEdit matcher, add:"
echo "  { \"type\": \"command\", \"command\": \"$HOOKS_DIR/run-hook.sh require-worktree.sh\", \"timeout\": 5 }"
echo ""
echo "In PostToolUse → Bash matcher, add:"
echo "  { \"type\": \"command\", \"command\": \"$HOOKS_DIR/run-hook.sh post-merge-test-gate.sh\", \"timeout\": 5 }"
echo "  { \"type\": \"command\", \"command\": \"$HOOKS_DIR/run-hook.sh post-merge-worktree-cleanup.sh\", \"timeout\": 5 }"
echo ""
echo "Dashboard (run manually):"
echo "  bash $HOOKS_DIR/fleet-dashboard.sh"
echo ""
echo "═══════════════════════════════════════════════"
echo "  Installation complete."
echo "═══════════════════════════════════════════════"
