#!/bin/bash
# PreToolUse:Bash hook — enforces merge conflict protocol.
# BLOCKS: git checkout --theirs and git checkout --ours (blind conflict resolution)
# BLOCKS: git merge without a test plan
# Requires reading both sides of conflicts before resolving.

HOOK_INPUT=$(cat)
COMMAND=$(echo "$HOOK_INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null)

# Block blind conflict resolution
case "$COMMAND" in
  *"checkout --theirs"*|*"checkout --ours"*)
    echo "BLOCKED: Never auto-resolve merge conflicts with --theirs or --ours."
    echo ""
    echo "Merge conflict protocol:"
    echo "  1. Read BOTH sides of the conflict (grep for <<<<<<)"
    echo "  2. Understand what each branch changed and WHY"
    echo "  3. Manually combine both changes using Edit tool"
    echo "  4. Run tests after resolving"
    echo ""
    echo "If you cannot resolve, abort the merge: git merge --abort"
    exit 2
    ;;
esac

# After a merge, remind to test
case "$COMMAND" in
  *"git merge"*)
    echo "MERGE PROTOCOL: After this merge completes, IMMEDIATELY run tests before any further merges."
    echo "  If tests fail, investigate and fix or git reset --soft HEAD~1."
    ;;
esac

exit 0
