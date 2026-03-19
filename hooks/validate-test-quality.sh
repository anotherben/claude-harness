#!/bin/bash
# PreToolUse:Bash — Block commits with tautological or placeholder tests in staged test files.
# Scans the staged diff (added lines only) for patterns that indicate fake tests.
# Exit 0 = PASS, Exit 2 = BLOCK.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null)

# Only gate git commit commands
if ! echo "$COMMAND" | grep -qE 'git commit'; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

# Get staged test files
STAGED_TESTS=$(git -C "$PROJECT_DIR" diff --cached --name-only 2>/dev/null \
  | grep -E '(\.test\.|\.spec\.|__tests__/)' || true)

# No test files staged — nothing to validate
if [ -z "$STAGED_TESTS" ]; then
  exit 0
fi

# Get the staged diff for test files (added lines only)
DIFF_OUTPUT=$(git -C "$PROJECT_DIR" diff --cached -U0 -- $STAGED_TESTS 2>/dev/null)

if [ -z "$DIFF_OUTPUT" ]; then
  exit 0
fi

# Write python script to temp file to avoid heredoc quoting issues
PYSCRIPT=$(mktemp /tmp/validate-quality-XXXXXX.py)
trap "rm -f $PYSCRIPT" EXIT

cat > "$PYSCRIPT" << 'PYEOF'
import sys, subprocess, re

project_dir = sys.argv[1]

# Get staged test files
result = subprocess.run(
    ['git', '-C', project_dir, 'diff', '--cached', '--name-only'],
    capture_output=True, text=True
)
all_staged = result.stdout.strip().splitlines()
test_files = [f for f in all_staged if re.search(r'(\.test\.|\.spec\.|__tests__/)', f)]

if not test_files:
    print('PASS|No test files staged')
    sys.exit(0)

violations = []

for tf in test_files:
    # Get staged diff for this specific file (only added lines)
    diff_result = subprocess.run(
        ['git', '-C', project_dir, 'diff', '--cached', '-U3', '--', tf],
        capture_output=True, text=True
    )
    diff_text = diff_result.stdout

    # Extract added lines (lines starting with +, excluding the +++ header)
    added_lines = []
    for line in diff_text.splitlines():
        if line.startswith('+') and not line.startswith('+++'):
            added_lines.append(line[1:])  # Strip the leading +

    if not added_lines:
        continue

    added_block = '\n'.join(added_lines)
    file_violations = []

    # --- Pattern 1: Tautological expects ---
    # expect(true).toBe(true), expect(false).toBe(false)
    if re.search(r'expect\s*\(\s*true\s*\)', added_block):
        file_violations.append('expect(true) -- tautological assertion')
    if re.search(r'expect\s*\(\s*false\s*\)', added_block):
        file_violations.append('expect(false) -- tautological assertion')

    # --- Pattern 2: Literal-to-same-literal ---
    # expect(1).toBe(1), expect("foo").toBe("foo"), expect('bar').toBe('bar')
    quote_pat = r"""expect\s*\(\s*(['"])(.*?)\1\s*\)\s*\.(?:toBe|toEqual|toStrictEqual)\s*\(\s*(['"])(.*?)\3\s*\)"""
    for m in re.finditer(quote_pat, added_block):
        if m.group(2) == m.group(4):
            file_violations.append(
                'expect("{}").toBe("{}") -- literal matches itself'.format(m.group(2), m.group(4))
            )

    num_pat = r'expect\s*\(\s*(\d+(?:\.\d+)?)\s*\)\s*\.(?:toBe|toEqual|toStrictEqual)\s*\(\s*(\d+(?:\.\d+)?)\s*\)'
    for m in re.finditer(num_pat, added_block):
        if m.group(1) == m.group(2):
            file_violations.append(
                'expect({}).toBe({}) -- literal matches itself'.format(m.group(1), m.group(2))
            )

    # --- Pattern 3: Empty expect ---
    if re.search(r'expect\s*\(\s*\)\s*\.', added_block):
        file_violations.append('expect() -- empty expect call')

    # --- Pattern 4: Placeholder test names ---
    placeholder_words = ['placeholder', 'todo', 'skip', 'fixme', 'noop', 'dummy']
    # temp needs word boundary
    for word in placeholder_words:
        pat = r'(?:test|it)\s*\(\s*[' + "'" + r'"]' + word
        if re.search(pat, added_block, re.IGNORECASE):
            match = re.search(pat, added_block, re.IGNORECASE)
            file_violations.append('placeholder test name detected: {}'.format(match.group(0).strip()))
    # temp with word boundary
    temp_pat = r'(?:test|it)\s*\(\s*[' + "'" + r'"]temp\b'
    if re.search(temp_pat, added_block, re.IGNORECASE):
        match = re.search(temp_pat, added_block, re.IGNORECASE)
        file_violations.append('placeholder test name detected: {}'.format(match.group(0).strip()))

    # --- Pattern 5: Test body with no expect/assert ---
    opener_pat = r'(?:test|it)\s*\(\s*[' + "'" + r'"](.+?)[' + "'" + r'"]\s*,'
    test_openers = list(re.finditer(opener_pat, added_block))

    for i, opener in enumerate(test_openers):
        test_name = opener.group(1)
        start = opener.end()
        if i + 1 < len(test_openers):
            end = test_openers[i + 1].start()
        else:
            end = len(added_block)
        body = added_block[start:end]

        # Only flag if we can see the full body (has closing brace/paren)
        has_closing = bool(re.search(r'[}\)]\s*\)', body))

        if has_closing:
            has_assertion = bool(re.search(
                r'(expect\s*\(|assert[.(]|should[.(]|\.toHaveBeenCalled|\.rejects\.|\.resolves\.)',
                body
            ))
            if not has_assertion:
                file_violations.append(
                    'test "{}" has no assertions (expect/assert)'.format(test_name)
                )

    # --- Pattern 6: "should work" with no assertions ---
    sw_pat = r'(?:test|it)\s*\(\s*[' + "'" + r'"]should work[' + "'" + r'"]\s*,'
    for m in re.finditer(sw_pat, added_block, re.IGNORECASE):
        start = m.end()
        rest = added_block[start:start+500]
        has_closing = bool(re.search(r'[}\)]\s*\)', rest))
        if has_closing:
            has_assertion = bool(re.search(
                r'(expect\s*\(|assert[.(]|should[.(]|\.toHaveBeenCalled)',
                rest
            ))
            if not has_assertion:
                file_violations.append(
                    'test "should work" -- vague name with no assertions'
                )

    if file_violations:
        for v in file_violations:
            violations.append('{}: {}'.format(tf, v))

if violations:
    print('FAIL|' + '||'.join(violations))
else:
    print('PASS|No tautological or placeholder tests detected')
PYEOF

RESULT=$(python3 "$PYSCRIPT" "$PROJECT_DIR")

STATUS=$(echo "$RESULT" | cut -d'|' -f1)
MESSAGE=$(echo "$RESULT" | cut -d'|' -f2-)

if [ "$STATUS" = "FAIL" ]; then
  echo "BLOCKED: Tautological or placeholder tests detected in staged test files." >&2
  echo "" >&2
  echo "$MESSAGE" | tr '|' '\n' | while read -r line; do
    [ -n "$line" ] && echo "  $line" >&2
  done
  echo "" >&2
  echo "Fix: Replace placeholder assertions with real tests that exercise actual code behavior." >&2
  exit 2
fi

exit 0
