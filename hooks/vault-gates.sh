#!/bin/bash
# PreToolUse:Skill hook — enforces vault workflow gates before enterprise pipeline.
# The /enterprise ORCHESTRATOR is allowed through Gate A — it handles vault context internally.
# Individual stages are hard-blocked.
#
# Hard gates (exit 2 = BLOCKED):
#   Gate A: /vault-context must run before enterprise sub-stages (orchestrator exempt)
#   Gate B: /vault-update or /vault-capture must run before /enterprise-verify or /enterprise-compound
#   Gate C: Inbox items >48h old block enterprise sub-stages (orchestrator exempt)
#   Gate D: Claim ownership via vault_claims table

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null)
if [ -z "$SESSION_ID" ]; then exit 0; fi

SKILL_NAME=$(echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin).get('tool_input',{}); print(d.get('skill','') or d.get('name',''))" 2>/dev/null)

SKILLS_FILE="/tmp/claude-skills-invoked-${SESSION_ID}"
VAULT_DB="$HOME/.vault-index/index.db"
CLAUDE_OWNER="claude:${SESSION_ID}"

# Determine if this is an enterprise pipeline skill
IS_ENTERPRISE=false
IS_ORCHESTRATOR=false
case "$SKILL_NAME" in
  enterprise)
    IS_ENTERPRISE=true
    IS_ORCHESTRATOR=true
    ;;
  enterprise-brainstorm|enterprise-plan|enterprise-contract|enterprise-build|enterprise-review|enterprise-forge|enterprise-debug|enterprise-discover|enterprise-harness|enterprise-verify|enterprise-compound)
    IS_ENTERPRISE=true
    ;;
esac

# Gate A: Require vault-context before enterprise sub-stages
# The orchestrator (/enterprise) is EXEMPT — it handles vault-context internally
if [ "$IS_ENTERPRISE" = true ] && [ "$IS_ORCHESTRATOR" = false ]; then
  if [ ! -f "$SKILLS_FILE" ] || ! grep -q "vault-context" "$SKILLS_FILE" 2>/dev/null; then
    echo "BLOCKED: /vault-context must be run before enterprise sub-stages."
    echo ""
    echo "Run /vault-context first, or use /enterprise which handles this automatically."
    exit 2
  fi

  # Gate C: Check for stale inbox items (>48h old) — sub-stages only
  INBOX_PATH="${OBSIDIAN_VAULT_PATH:-$HOME/Documents/Vault}/00-Inbox"
  if [ -d "$INBOX_PATH" ]; then
    STALE_COUNT=0
    NOW=$(date +%s)
    THRESHOLD=$((48 * 3600))
    for f in "$INBOX_PATH"/*.md; do
      [ -f "$f" ] || continue
      CREATED=$(head -15 "$f" | grep "^created:" | sed 's/created: *//' | tr -d '"' | tr -d "'")
      if [ -n "$CREATED" ]; then
        FILE_TS=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${CREATED%%Z*}" "+%s" 2>/dev/null \
               || date -j -f "%Y-%m-%dT%H:%M:%SZ" "$CREATED" "+%s" 2>/dev/null \
               || date -d "$CREATED" "+%s" 2>/dev/null)
        if [ -n "$FILE_TS" ]; then
          AGE=$((NOW - FILE_TS))
          if [ "$AGE" -gt "$THRESHOLD" ]; then
            STALE_COUNT=$((STALE_COUNT + 1))
          fi
        fi
      else
        STALE_COUNT=$((STALE_COUNT + 1))
      fi
    done
    if [ "$STALE_COUNT" -gt 0 ]; then
      echo "BLOCKED: Inbox has $STALE_COUNT item(s) older than 48 hours."
      echo ""
      echo "Run /vault-triage to process inbox items before starting enterprise work."
      exit 2
    fi
  fi

  # Gate D: Claim ownership enforcement via vault-index SQLite
  if [ -f "$VAULT_DB" ] && command -v sqlite3 >/dev/null 2>&1; then
    HAS_CLAIMS_TABLE=$(sqlite3 "$VAULT_DB" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='vault_claims'" 2>/dev/null)
    if [ "$HAS_CLAIMS_TABLE" = "1" ]; then
      CONTEXT_FILE="/tmp/claude-vault-context-${SESSION_ID}"
      TARGET_ITEM_ID=""
      if [ -f "$CONTEXT_FILE" ]; then
        TARGET_ITEM_ID=$(grep "^item_id=" "$CONTEXT_FILE" 2>/dev/null | head -1 | cut -d= -f2-)
      fi

      if [ -n "$TARGET_ITEM_ID" ]; then
        NOW_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
        CLAIM_ROW=$(sqlite3 "$VAULT_DB" "SELECT owner_instance, state, lease_expires_at FROM vault_claims WHERE item_id = '${TARGET_ITEM_ID}'" 2>/dev/null)
        if [ -z "$CLAIM_ROW" ]; then
          echo "BLOCKED: Item '${TARGET_ITEM_ID}' is not claimed."
          echo "Run /vault-update to claim this item before starting enterprise work."
          exit 2
        fi

        CLAIM_OWNER=$(echo "$CLAIM_ROW" | cut -d'|' -f1)
        CLAIM_STATE=$(echo "$CLAIM_ROW" | cut -d'|' -f2)
        CLAIM_LEASE=$(echo "$CLAIM_ROW" | cut -d'|' -f3)

        if [ "$CLAIM_STATE" != "claimed" ]; then
          echo "BLOCKED: Item '${TARGET_ITEM_ID}' claim state is '${CLAIM_STATE}', not 'claimed'."
          echo "Run /vault-update to re-claim this item."
          exit 2
        fi

        if [ "$CLAIM_OWNER" != "$CLAUDE_OWNER" ]; then
          echo "BLOCKED: Item '${TARGET_ITEM_ID}' is claimed by '${CLAIM_OWNER}', not this session."
          echo "Use /vault-update to request a handoff from the current owner."
          exit 2
        fi

        LEASE_TS=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$CLAIM_LEASE" "+%s" 2>/dev/null \
                || date -j -f "%Y-%m-%dT%H:%M:%S" "${CLAIM_LEASE%%Z*}" "+%s" 2>/dev/null \
                || date -d "$CLAIM_LEASE" "+%s" 2>/dev/null)
        NOW_TS=$(date +%s)
        if [ -n "$LEASE_TS" ] && [ "$NOW_TS" -gt "$LEASE_TS" ]; then
          echo "BLOCKED: Claim on '${TARGET_ITEM_ID}' has expired (lease: ${CLAIM_LEASE})."
          echo "Run /vault-update to re-claim this item."
          exit 2
        fi
      fi
    fi
  fi
fi

# Gate B: Require vault-update or vault-capture before enterprise completion
case "$SKILL_NAME" in
  enterprise-verify|enterprise-compound)
    if [ ! -f "$SKILLS_FILE" ]; then
      echo "BLOCKED: Vault not updated before completing the pipeline."
      echo "Run /vault-update or /vault-capture first."
      exit 2
    fi
    if ! grep -qE "vault-update|vault-capture" "$SKILLS_FILE" 2>/dev/null; then
      echo "BLOCKED: Vault not updated before completing the pipeline."
      echo "Run /vault-update or /vault-capture first."
      exit 2
    fi
    ;;
esac

exit 0
