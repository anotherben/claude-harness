#!/bin/bash
# UserPromptSubmit hook — evaluates user prompts and injects refinement instructions for vague requests.
# Fast-path bypasses for skills, questions, continuations. LLM evaluation for ambiguous cases.
#
# Input: JSON on stdin with { "prompt": "user's message" }
# Output: nothing (pass through) or system reminder text on stdout

HOOK_INPUT=$(cat)
USER_PROMPT=$(echo "$HOOK_INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    # Handle both possible shapes
    print(d.get('prompt', d.get('user_prompt', d.get('content', ''))))
except:
    print('')
" 2>/dev/null)

# Empty prompt — pass through
[ -z "$USER_PROMPT" ] && exit 0

# Trim leading/trailing whitespace
USER_PROMPT=$(echo "$USER_PROMPT" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')

# --- FAST-PATH BYPASSES (no LLM cost) ---

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

# 3b. Prompts ending with ? are always questions
case "$USER_PROMPT" in
  *\?) exit 0 ;;
esac

# 4. Direct questions and conversational openers that lead to questions
# Strip common conversational prefixes before checking first word
STRIPPED=$(echo "$USER_PROMPT" | sed -E 's/^(ok|okay|yeah|yep|right|so|well|hey|hmm|hm|alright|sure|cool|nice|great|good|fine|thanks|thank you)[,. !]*//i' | sed 's/^[[:space:]]*//')
# Use stripped version if it's non-empty, otherwise use original
[ -n "$STRIPPED" ] && CHECK_PROMPT="$STRIPPED" || CHECK_PROMPT="$USER_PROMPT"
FIRST_WORD=$(echo "$CHECK_PROMPT" | awk '{print tolower($1)}')
case "$FIRST_WORD" in
  what|whats|what\'s|where|wheres|where\'s|how|hows|how\'s|\
  why|whys|why\'s|which|when|whens|when\'s|\
  is|does|doesnt|doesn\'t|can|cant|can\'t|do|did|didnt|didn\'t|\
  are|arent|aren\'t|has|hasnt|hasn\'t|have|havent|haven\'t|\
  will|wont|won\'t|would|wouldnt|wouldn\'t|could|couldnt|couldn\'t|\
  show|list|explain|describe|tell|check|find|search|look|read|display|print|dump|\
  status|remember|recall|forget)
    exit 0 ;;
esac

# 5. Phrases that indicate status checks or memory operations
LOWER_FULL=$(echo "$USER_PROMPT" | tr '[:upper:]' '[:lower:]')
case "$LOWER_FULL" in
  *"where are we"*|*"where were we"*|*"what's running"*|*"what have we"*|\
  *"status check"*|*"health check"*|*"checkpoint"*|*"session heartbeat"*|\
  *"save progress"*|*"write handover"*|*"context"*limit*|\
  *"git status"*|*"git log"*|*"git diff"*|\
  *"remember that"*|*"don't forget"*|*"recall"*|*"what do you remember"*)
    exit 0 ;;
esac

# 6. Already-structured prompts (contain TASK: or SCOPE: or acceptance criteria markers)
case "$USER_PROMPT" in
  *"TASK:"*|*"SCOPE:"*|*"ACCEPTANCE CRITERIA"*|*"BLAST RADIUS"*|*"INTENT:"*)
    exit 0 ;;
esac

# 7. Very short action requests that are clearly scoped (contain a file path)
if echo "$USER_PROMPT" | grep -qE '\.(js|ts|jsx|tsx|sql|sh|json|md|css|html)[ :]' 2>/dev/null; then
  # Contains a filename — likely already scoped. Check if it also has line numbers or specific function names.
  if echo "$USER_PROMPT" | grep -qE '(line [0-9]+|:[0-9]+|function |method |class |const |let |var )' 2>/dev/null; then
    exit 0
  fi
fi

# 8. If the prompt is very long (>500 chars), it's probably already detailed
if [ "$PROMPT_LEN" -gt 500 ]; then
  exit 0
fi

# --- VAGUE PROMPT DETECTED — inject refinement ---
# If we reach here, the prompt didn't match any fast-path bypass.
# Inject a system reminder to trigger the Prompt Refinement Protocol.

cat <<'REFINEMENT'
<system-reminder>
PROMPT REFINEMENT TRIGGERED — The user's request appears to be a vibe-coded action command without explicit scope, blast radius, or acceptance criteria.

Before acting on this request, you MUST refine it using the Prompt Refinement Protocol:

```
TASK: [1-sentence clear description]
INTENT: [what the user actually wants to achieve]
SCOPE:
  - Files likely affected: [list or "TBD — need to explore"]
  - Tables/APIs touched: [list or "none"]
  - Frontend / Backend / Both: [which]
BLAST RADIUS:
  - What else depends on this: [list consumers, importers, callers]
  - What could break: [list risks]
EDGE CASES:
  - [edge case 1]
  - [edge case 2]
  - [edge case 3]
ACCEPTANCE CRITERIA:
  - [ ] [criterion 1]
  - [ ] [criterion 2]
  - [ ] [criterion 3]
NOT IN SCOPE:
  - [explicit exclusions to prevent creep]
```

Present this to the user and STOP. Wait for confirmation before exploring code, reading files, invoking skills, or dispatching agents.

If the user says "just do it" or "skip refinement", proceed without the protocol.
</system-reminder>
REFINEMENT

exit 0
