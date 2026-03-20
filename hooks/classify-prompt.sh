#!/bin/bash
# UserPromptSubmit hook — multi-class intent classifier with learning integration
# Replaces binary refine-prompt.sh with 12-category routing + correction detection
#
# Input: JSON on stdin with { "prompt": "user's message" }
# Output: nothing (pass through) or intent-specific system reminder on stdout

HOOK_INPUT=$(cat)
USER_PROMPT=$(echo "$HOOK_INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get('prompt', d.get('user_prompt', d.get('content', ''))))
except:
    print('')
" 2>/dev/null)

# Empty prompt — pass through
[ -z "$USER_PROMPT" ] && exit 0

# Trim leading/trailing whitespace
USER_PROMPT=$(echo "$USER_PROMPT" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

# Session ID for hot-correction state
SESSION_ID="${CLAUDE_SESSION_ID:-$(echo "$$-$(date +%Y%m%d)" | shasum | cut -c1-8)}"
PROJ_DIR="${CLAUDE_PROJECT_DIR:-.}"
KNOWLEDGE_FILE="${PROJ_DIR}/.cortex/knowledge.jsonl"
CLASSIFICATION_FILE="/tmp/claude-classification-${SESSION_ID}"

# ─── FAST-PATH BYPASSES (no classification cost) ───

# 1. Skill invocations (start with /)
case "$USER_PROMPT" in
  /*)  exit 0 ;;
esac

# 2. Bypass markers (* or # prefix)
case "$USER_PROMPT" in
  \#*|\**)  exit 0 ;;
esac

# 3. Short continuations / approvals (under 20 chars)
PROMPT_LEN=${#USER_PROMPT}
if [ "$PROMPT_LEN" -lt 20 ]; then
  LOWER=$(echo "$USER_PROMPT" | tr '[:upper:]' '[:lower:]')
  case "$LOWER" in
    yes|y|no|n|ok|proceed|continue|approve|approved|reject|stop|cancel|abort|\
    commit|commit*|push|merge|lgtm|ship*|do*it|go|go*ahead|next|skip|skip*|\
    refine*|looks*good|confirmed|ack|roger|done|ready|sure|yep|nah|nope)
      exit 0 ;;
  esac
fi

# 4. Status checks / memory operations
LOWER_FULL=$(echo "$USER_PROMPT" | tr '[:upper:]' '[:lower:]')
case "$LOWER_FULL" in
  *"where are we"*|*"where were we"*|*"what's running"*|*"what have we"*|\
  *"status check"*|*"health check"*|*"checkpoint"*|*"session heartbeat"*|\
  *"save progress"*|*"write handover"*|*"context"*limit*|\
  *"git status"*|*"git log"*|*"git diff"*|\
  *"remember that"*|*"don't forget"*|*"recall"*|*"what do you remember"*)
    exit 0 ;;
esac

# 5. Already-structured prompts (contain TASK: or SCOPE: markers)
case "$USER_PROMPT" in
  *"TASK:"*|*"SCOPE:"*|*"ACCEPTANCE CRITERIA"*|*"BLAST RADIUS"*|*"INTENT:"*)
    exit 0 ;;
esac

# 6. File path with line-level specifics
if echo "$USER_PROMPT" | grep -qE '\.(js|ts|jsx|tsx|sql|sh|json|md|css|html)[ :]' 2>/dev/null; then
  if echo "$USER_PROMPT" | grep -qE '(line [0-9]+|:[0-9]+|function |method |class |const |let |var )' 2>/dev/null; then
    exit 0
  fi
fi

# 7. Very long prompts (>500 chars) — probably already detailed
if [ "$PROMPT_LEN" -gt 500 ]; then
  exit 0
fi

# ─── CORRECTION DETECTION ───
# Runs before classification — corrections are logged regardless of intent

detect_and_log_correction() {
  local correction_cat=""
  local correction_note=""

  case "$LOWER_FULL" in
    *"test it yourself"*|*"run the test"*|*"prove it"*|*"show me the output"*|*"paste the output"*)
      correction_cat="proof"
      correction_note="User correction: '${USER_PROMPT}' — agent must run tests and paste output, never claim without evidence"
      ;;
    *"just do it"*|*"don't ask"*|*"stop asking"*|*"don't question"*|*"execute it"*)
      correction_cat="autonomy"
      correction_note="User correction: '${USER_PROMPT}' — after plan approval, execute autonomously without confirmation loops"
      ;;
    *"do the migration"*|*"you do it"*|*"do it yourself"*|*"don't tell me"*|*"handle it"*)
      correction_cat="execute"
      correction_note="User correction: '${USER_PROMPT}' — agent should execute tasks, not instruct the user to do them"
      ;;
    *"i already told you"*|*"again"*|*"how many times"*|*"i said"*|*"already said"*|*"told you"*)
      correction_cat="repeated"
      correction_note="User correction (repeated): '${USER_PROMPT}' — agent is repeating a mistake the user already corrected"
      ;;
  esac

  # Positive reinforcement detection (separate from corrections)
  local positive_signal=""
  case "$LOWER_FULL" in
    *"perfect"*|*"exactly what i wanted"*|*"nailed it"*|*"great job"*|*"well done"*|\
    *"that's exactly"*|*"spot on"*|*"love it"*|*"this is great"*|*"nicely done"*)
      positive_signal="positive"
      ;;
  esac

  if [ -n "$positive_signal" ] && [ -d "$(dirname "$KNOWLEDGE_FILE")" ]; then
    local timestamp
    timestamp=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
    printf '{"target":"global","note":"Positive reinforcement: user said '\''%s'\'' — current approach is working well","author":"prompt-intelligence","tags":["feedback","positive","reinforcement"],"timestamp":"%s"}\n' \
      "$(echo "$USER_PROMPT" | sed "s/'/\\\\'/g" | sed 's/"/\\"/g')" \
      "$timestamp" >> "$KNOWLEDGE_FILE"
  fi

  if [ -n "$correction_cat" ]; then
    local timestamp
    timestamp=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

    # Write cortex annotation
    if [ -d "$(dirname "$KNOWLEDGE_FILE")" ]; then
      printf '{"target":"global","note":"%s","author":"prompt-intelligence","tags":["feedback","%s","auto-enforce","lesson"],"timestamp":"%s"}\n' \
        "$(echo "$correction_note" | sed 's/"/\\"/g')" \
        "$correction_cat" \
        "$timestamp" >> "$KNOWLEDGE_FILE"
    fi

    # Track frequency for hot-correction escalation
    local count_file="/tmp/claude-correction-count-${SESSION_ID}-${correction_cat}"
    local count=1
    if [ -f "$count_file" ]; then
      count=$(( $(cat "$count_file") + 1 ))
    fi
    echo "$count" > "$count_file"

    # Escalate to hot-correction at 3+ occurrences
    if [ "$count" -ge 3 ]; then
      local hot_file="/tmp/claude-hot-correction-${SESSION_ID}"
      local hot_line=""
      case "$correction_cat" in
        proof)    hot_line="- ALWAYS run tests and paste output before claiming anything passes" ;;
        autonomy) hot_line="- After plan approval, execute without asking for confirmation" ;;
        execute)  hot_line="- Execute tasks yourself, do not instruct the user to do them" ;;
        repeated) hot_line="- Pay close attention — you are repeating previously corrected mistakes" ;;
      esac

      # Write or append to hot-correction file
      if [ ! -f "$hot_file" ]; then
        echo "LEARNED (auto-enforced after repeated corrections):" > "$hot_file"
      fi
      # Only add if not already present
      if ! grep -qF "$hot_line" "$hot_file" 2>/dev/null; then
        echo "$hot_line" >> "$hot_file"
      fi
    fi
  fi
}

detect_and_log_correction

# ─── CONFIDENCE PRE-SCAN ───
# Count how many technical categories match. If 3+ match, the prompt is ambiguous.
CATEGORY_HITS=0
echo "$LOWER_FULL" | grep -qE '(broken|error|crash|slow|wrong|500|null|time.?out|fail|bug|not working|stuck)' 2>/dev/null && CATEGORY_HITS=$((CATEGORY_HITS + 1))
echo "$LOWER_FULL" | grep -qE '(deploy|migrate|migration|rollback|env.var|production|render|hotfix|release)' 2>/dev/null && CATEGORY_HITS=$((CATEGORY_HITS + 1))
echo "$LOWER_FULL" | grep -qE '\b(add|create|build|implement)\b' 2>/dev/null && CATEGORY_HITS=$((CATEGORY_HITS + 1))
echo "$LOWER_FULL" | grep -qE '\bnew (\w+ )?(feature|endpoint|component|service|handler|webhook)' 2>/dev/null && CATEGORY_HITS=$((CATEGORY_HITS + 1))
echo "$LOWER_FULL" | grep -qE '(refactor|clean.?up|extract|split|rename)' 2>/dev/null && CATEGORY_HITS=$((CATEGORY_HITS + 1))

# If 3+ technical categories fire on one short prompt, confidence is too low — pass through
if [ "$CATEGORY_HITS" -ge 3 ] && [ "$PROMPT_LEN" -lt 80 ]; then
  exit 0
fi

# ─── COMPOUND PROMPT DETECTION ───
# "fix X then deploy Y" or "do A and then B" — emit routing for multiple intents
COMPOUND=""
if echo "$LOWER_FULL" | grep -qE '\b(then|and then|after that|afterwards|once .* done|when .* is (done|fixed|ready))\b' 2>/dev/null; then
  # Split on the compound signal and classify each half
  COMPOUND_INTENTS=""
  # Classify first half (before the compound word)
  FIRST_HALF=$(echo "$LOWER_FULL" | sed -E 's/ (then|and then|after that|afterwards|once .* done|when .* is (done|fixed|ready)) .*//')
  SECOND_HALF=$(echo "$LOWER_FULL" | sed -E 's/.* (then|and then|after that|afterwards) //')

  classify_fragment() {
    local frag="$1"
    echo "$frag" | grep -qE '(broken|error|crash|slow|wrong|fail|bug|not working|fix)' 2>/dev/null && echo "bug" && return
    echo "$frag" | grep -qE '(deploy|migrate|rollback|production|render|release)' 2>/dev/null && echo "ops" && return
    echo "$frag" | grep -qE '\b(add|create|build|implement)\b' 2>/dev/null && echo "feature" && return
    echo "$frag" | grep -qE '(refactor|clean.?up|extract|split|rename)' 2>/dev/null && echo "refactor" && return
    echo "$frag" | grep -qE '(look into|audit|trace|investigat)' 2>/dev/null && echo "investigate" && return
    echo "unknown"
  }

  INTENT_A=$(classify_fragment "$FIRST_HALF")
  INTENT_B=$(classify_fragment "$SECOND_HALF")

  if [ "$INTENT_A" != "unknown" ] && [ "$INTENT_B" != "unknown" ] && [ "$INTENT_A" != "$INTENT_B" ]; then
    COMPOUND="yes"
    # Write classification result
    echo "compound:${INTENT_A}+${INTENT_B}" > "$CLASSIFICATION_FILE"

    # Read hot corrections
    HOT_CORRECTIONS=""
    HOT_FILE="/tmp/claude-hot-correction-${SESSION_ID}"
    if [ -f "$HOT_FILE" ]; then
      HOT_CORRECTIONS=$(cat "$HOT_FILE")
    fi
    HOT_BLOCK=""
    [ -n "$HOT_CORRECTIONS" ] && HOT_BLOCK="

${HOT_CORRECTIONS}"

    cat <<EOF
<system-reminder>
COMPOUND INTENT DETECTED: ${INTENT_A} + ${INTENT_B}

This prompt contains two sequential tasks. Handle them in order:

STEP 1 (${INTENT_A}): $(echo "$FIRST_HALF" | sed 's/^[[:space:]]*//')
STEP 2 (${INTENT_B}): $(echo "$SECOND_HALF" | sed 's/^[[:space:]]*//')

Complete Step 1 fully before starting Step 2. Each step gets its own routing:
- ${INTENT_A}: follow ${INTENT_A}-specific workflow
- ${INTENT_B}: follow ${INTENT_B}-specific workflow${HOT_BLOCK}
</system-reminder>
EOF
    exit 0
  fi
fi

# ─── INTENT CLASSIFICATION ───
# Priority: reference > investigate (explicit verb) > bug > ops > feature > refactor
#           > investigate (residual) > design > business > marketing > content
#           > meta > question > unclassified

INTENT=""

# Priority 0: Explicit investigation verbs OVERRIDE bug symptoms
# "look into the sync failure" = investigate, not bug — the user asked to investigate
INVESTIGATE_VERBS='(look into|audit|trace|figure out|dig into|investigat|root cause|check (if|whether|why))'
if echo "$LOWER_FULL" | grep -qE "$INVESTIGATE_VERBS" 2>/dev/null; then
  INTENT="investigate"
fi

# Priority 1: Reference (secrets/keys — must be captured, never echoed)
if [ -z "$INTENT" ]; then
  if echo "$LOWER_FULL" | grep -qE '(api[_ -]?key|password|token|secret|credentials|endpoint is|here.s the|use this for)' 2>/dev/null; then
    if echo "$USER_PROMPT" | grep -qE '(sk-|pk-|key_|token_|https?://|[A-Za-z0-9_-]{20,})' 2>/dev/null; then
      INTENT="reference"
    fi
  fi
fi

# Priority 2: Bug (only if no explicit investigation verb)
if [ -z "$INTENT" ]; then
  if echo "$LOWER_FULL" | grep -qE '(broken|error|crash(ed|es|ing)?|slow|wrong|500|null|time.?out|timing out|duplicat|fail(s|ed|ing)?|bug|not working|doesn.t work|won.t work|can.t|unable|exception|undefined|NaN|blank page|white screen|stuck|regression|flak)' 2>/dev/null; then
    INTENT="bug"
  fi
fi

# Priority 3: Ops
if [ -z "$INTENT" ]; then
  if echo "$LOWER_FULL" | grep -qE '(deploy|migrate|migration|rollback|env.var|production|render|redeploy|hotfix|revert to|release)' 2>/dev/null; then
    INTENT="ops"
  fi
fi

# Priority 4: Feature
if [ -z "$INTENT" ]; then
  if echo "$LOWER_FULL" | grep -qE '\b(add|create|build|implement)\b' 2>/dev/null; then
    INTENT="feature"
  fi
  # "new" only when followed by a buildable noun (not "what's new" or "new here")
  if [ -z "$INTENT" ] && echo "$LOWER_FULL" | grep -qE '\bnew (\w+ )?(feature|endpoint|component|page|route|table|field|column|hook|service|worker|migration|api|modal|form|button|tab|view|skill|system|handler|job|queue|script|test|config|plugin|webhook)' 2>/dev/null; then
    INTENT="feature"
  fi
  # "want/need" — match unless followed by thinking verbs (think/discuss/consider/know/understand)
  if [ -z "$INTENT" ] && echo "$LOWER_FULL" | grep -qE '\b(want|need)\b' 2>/dev/null; then
    if ! echo "$LOWER_FULL" | grep -qE '(want|need) to (think|discuss|consider|know|understand|talk|decide)' 2>/dev/null; then
      INTENT="feature"
    fi
  fi
  if [ -z "$INTENT" ] && echo "$LOWER_FULL" | grep -qE '(can we|let.s make|set up|hook up|wire up|integrate|support for)\b' 2>/dev/null; then
    INTENT="feature"
  fi
fi

# Priority 5: Refactor
if [ -z "$INTENT" ]; then
  if echo "$LOWER_FULL" | grep -qE '(refactor|clean.?up|extract|split|rename|DRY|dedup|simplif|consolidat|reorganiz)' 2>/dev/null; then
    INTENT="refactor"
  fi
fi

# Priority 6: Investigate (residual — catches analyze/debug without explicit verb from Priority 0)
if [ -z "$INTENT" ]; then
  if echo "$LOWER_FULL" | grep -qE '(debug|analyze|what.s (going|happening)|how does.*work)' 2>/dev/null; then
    INTENT="investigate"
  fi
fi

# Priority 7: Design
if [ -z "$INTENT" ]; then
  if echo "$LOWER_FULL" | grep -qE '(should (we|i)|trade.?off|approach|pattern|architect|compare|between.*and|pros.*cons|better.*or|option)' 2>/dev/null; then
    INTENT="design"
  fi
fi

# Priority 8: Business
if [ -z "$INTENT" ]; then
  if echo "$LOWER_FULL" | grep -qE '(pricing|strategy|revenue|cost|ROI|business model|competitive|market|customers|monetiz|unit economics)' 2>/dev/null; then
    INTENT="business"
  fi
fi

# Priority 9: Marketing
if [ -z "$INTENT" ]; then
  if echo "$LOWER_FULL" | grep -qE '(copy|campaign|landing page|SEO|social media|brand|messaging|audience|funnel|conversion rate|marketing)' 2>/dev/null; then
    INTENT="marketing"
  fi
fi

# Priority 10: Content
if [ -z "$INTENT" ]; then
  if echo "$LOWER_FULL" | grep -qE '(documentation|blog|readme|changelog|tutorial|guide|write up|announcement|write.*(doc|post|article))' 2>/dev/null; then
    INTENT="content"
  fi
fi

# Priority 11: Meta (hooks, pipeline, settings)
if [ -z "$INTENT" ]; then
  if echo "$LOWER_FULL" | grep -qE '\b(hooks?|pipeline|skill|agent|settings|harness|mcp|cortex)\b' 2>/dev/null; then
    INTENT="meta"
  fi
fi

# Priority 12: Question (ends in ? or starts with question word, no action signals matched)
if [ -z "$INTENT" ]; then
  case "$USER_PROMPT" in *\?) INTENT="question" ;; esac
fi
if [ -z "$INTENT" ]; then
  STRIPPED=$(echo "$USER_PROMPT" | sed -E 's/^(ok|okay|yeah|yep|right|so|well|hey|hmm|hm|alright|sure|cool|nice|great|good|fine|thanks|thank you)[,. !]*//i' | sed 's/^[[:space:]]*//')
  [ -n "$STRIPPED" ] && CHECK_PROMPT="$STRIPPED" || CHECK_PROMPT="$USER_PROMPT"
  FIRST_WORD=$(echo "$CHECK_PROMPT" | awk '{print tolower($1)}')
  case "$FIRST_WORD" in
    what|whats|what\'s|where|wheres|where\'s|how|hows|how\'s|\
    why|whys|why\'s|which|when|whens|when\'s|\
    is|does|doesnt|doesn\'t|can|cant|can\'t|do|did|didnt|didn\'t|\
    are|arent|aren\'t|has|hasnt|hasn\'t|have|havent|haven\'t|\
    will|wont|won\'t|would|wouldnt|wouldn\'t|could|couldnt|couldn\'t|\
    show|list|explain|describe|tell)
      INTENT="question" ;;
  esac
fi

# Fallback: unclassified
[ -z "$INTENT" ] && INTENT="unclassified"

# Write classification result for log-classification.sh to read
echo "$INTENT" > "$CLASSIFICATION_FILE"

# ─── HOT-CORRECTION INJECTION ───
HOT_CORRECTIONS=""
HOT_FILE="/tmp/claude-hot-correction-${SESSION_ID}"
if [ -f "$HOT_FILE" ]; then
  HOT_CORRECTIONS=$(cat "$HOT_FILE")
fi

# ─── EMIT INTENT-SPECIFIC ROUTING ───

emit_reminder() {
  local body="$1"

  if [ -n "$HOT_CORRECTIONS" ]; then
    body="${body}

${HOT_CORRECTIONS}"
  fi

  cat <<EOF
<system-reminder>
INTENT CLASSIFIED: ${INTENT}

${body}
</system-reminder>
EOF
}

case "$INTENT" in
  reference)
    emit_reminder "REFERENCE DETECTED — The user is sharing credentials, API keys, URLs, or configuration values.

ACTION REQUIRED:
1. NEVER echo secrets back in your response
2. Route to /vault-capture immediately to store securely
3. Acknowledge receipt without repeating the sensitive value
4. If it's a URL or non-secret config, save to memory instead"
    ;;

  bug)
    emit_reminder "BUG REPORT DETECTED — The user is describing broken behavior, an error, or unexpected results.

ROUTING:
1. Reproduce first — run the related code/test to confirm the bug
2. Check logs and error output before theorizing
3. Run related tests to establish a baseline
4. Suggest /enterprise-debug for systematic root-cause analysis
5. Do NOT guess the fix — investigate first"
    ;;

  ops)
    emit_reminder "OPS/DEPLOY REQUEST — The user wants operational action (deploy, migrate, rollback, env vars).

ROUTING:
1. Execute autonomously — ops requests should not require confirmation loops
2. Include operational safety context (backup plan, rollback path)
3. For Render deploys: NEVER use PUT for env vars (wipes all). Use APPEND/PATCH
4. For migrations: parameterized queries, IF NOT EXISTS guards, TIMESTAMPTZ
5. For rollbacks: git stash or git reset --soft HEAD~1"
    ;;

  feature)
    emit_reminder "FEATURE REQUEST DETECTED — The user wants something new built.

Before acting, scope it:
\`\`\`
TASK: [1-sentence clear description]
INTENT: [what the user actually wants to achieve]
SCOPE:
  - Files likely affected: [list or \"TBD — need to explore\"]
  - Tables/APIs touched: [list or \"none\"]
  - Frontend / Backend / Both: [which]
BLAST RADIUS:
  - What else depends on this: [list consumers, importers, callers]
  - What could break: [list risks]
ACCEPTANCE CRITERIA:
  - [ ] [criterion 1]
  - [ ] [criterion 2]
NOT IN SCOPE:
  - [explicit exclusions]
\`\`\`

Present this to the user and STOP. Suggest /enterprise for full pipeline.
If the user says \"just do it\" or \"skip refinement\", proceed without the protocol."
    ;;

  refactor)
    emit_reminder "REFACTOR REQUEST — The user wants existing code restructured without behavior change.

ROUTING:
1. Verify tests pass FIRST — establish green baseline before changing anything
2. Define the boundary: what moves, what stays
3. Run tests after each change to catch regressions immediately
4. Suggest /enterprise for full pipeline treatment"
    ;;

  investigate)
    emit_reminder "INVESTIGATION REQUEST — The user wants you to explore, trace, or understand something.

ROUTING:
1. Read code first — trace the execution path before forming theories
2. Use cortex tools for code navigation (cortex_outline, cortex_find_symbol, cortex_read_symbol)
3. Present findings with file:line references
4. Do NOT fix anything yet — investigation only unless explicitly asked"
    ;;

  design)
    emit_reminder "DESIGN QUESTION — The user wants to discuss approaches, trade-offs, or architecture.

ROUTING:
1. Present 2-3 concrete options with trade-offs for each
2. Include: complexity, performance, maintenance burden, migration cost
3. Reference existing patterns in the codebase where relevant
4. Do NOT start coding — this is a discussion, not an implementation request
5. If a decision is reached, suggest capturing it in vault or stack-decisions.json"
    ;;

  business)
    emit_reminder "BUSINESS/STRATEGY TOPIC — This is not a code request.

ROUTING:
1. Flag as business/strategy domain — do not write code
2. Present structured thinking: market context, options, trade-offs, recommendation
3. Suggest capturing decisions in vault for future reference
4. If it leads to technical requirements, suggest transitioning to /enterprise"
    ;;

  marketing)
    emit_reminder "MARKETING/CONTENT TOPIC — The user wants copy, campaigns, or marketing strategy.

ROUTING:
1. Use brainstorm approach for content/campaigns
2. Present multiple angles or variations
3. Route final decisions/assets to vault-capture for archival
4. If it requires technical implementation (landing page code), transition to feature workflow"
    ;;

  content)
    emit_reminder "DOCUMENTATION/CONTENT REQUEST — The user wants written content produced.

ROUTING:
1. Determine format: markdown doc, blog post, changelog entry, README section
2. Follow existing project conventions for docs (check docs/ directory structure)
3. Do NOT create files unless explicitly asked — present draft in conversation first
4. For API docs, reference actual route handlers and service methods"
    ;;

  meta)
    # Meta questions about hooks/pipeline/skills — pass through, answer directly
    exit 0
    ;;

  question)
    # Pure questions — pass through, answer directly
    exit 0
    ;;

  unclassified)
    emit_reminder "PROMPT REFINEMENT TRIGGERED — The request appears to be an action command without explicit scope.

Before acting, refine it:
\`\`\`
TASK: [1-sentence clear description]
INTENT: [what the user actually wants to achieve]
SCOPE:
  - Files likely affected: [list or \"TBD — need to explore\"]
  - Tables/APIs touched: [list or \"none\"]
  - Frontend / Backend / Both: [which]
BLAST RADIUS:
  - What else depends on this: [list consumers, importers, callers]
  - What could break: [list risks]
ACCEPTANCE CRITERIA:
  - [ ] [criterion 1]
  - [ ] [criterion 2]
NOT IN SCOPE:
  - [explicit exclusions]
\`\`\`

Present this to the user and STOP. Wait for confirmation before proceeding.
If the user says \"just do it\" or \"skip refinement\", proceed without the protocol."
    ;;
esac

exit 0
