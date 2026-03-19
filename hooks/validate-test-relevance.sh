#!/bin/bash
# PreToolUse:Bash — Block commits where staged tests don't reference symbols from staged source files.
# Ensures tests exercise the code being committed, not just placeholder assertions.
# Exit 0 = PASS, Exit 2 = BLOCK.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null)

# Only gate git commit commands
if ! echo "$COMMAND" | grep -qE 'git commit'; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

# Get staged source files (exclude tests, node_modules, config)
STAGED_SRC=$(git -C "$PROJECT_DIR" diff --cached --name-only 2>/dev/null \
  | grep -E '\.(js|jsx|ts|tsx)$' \
  | grep -vE '(__tests__|\.test\.|\.spec\.|node_modules|\.config\.)' || true)

# No source files staged — nothing to validate
if [ -z "$STAGED_SRC" ]; then
  exit 0
fi

# Get staged test files
STAGED_TESTS=$(git -C "$PROJECT_DIR" diff --cached --name-only 2>/dev/null \
  | grep -E '(\.test\.|\.spec\.|__tests__/)' || true)

# No test files staged — delegate to pre-commit-gate.sh (already handles this case)
if [ -z "$STAGED_TESTS" ]; then
  exit 0
fi

# Write python script to temp file to avoid heredoc quoting issues
PYSCRIPT=$(mktemp /tmp/validate-relevance-XXXXXX.py)
trap "rm -f $PYSCRIPT" EXIT

cat > "$PYSCRIPT" << 'PYEOF'
import sys, subprocess, re, os

project_dir = sys.argv[1]

def get_staged_files(pattern_include, pattern_exclude=None):
    """Get staged file paths matching include pattern, excluding exclude pattern."""
    result = subprocess.run(
        ['git', '-C', project_dir, 'diff', '--cached', '--name-only'],
        capture_output=True, text=True
    )
    files = result.stdout.strip().splitlines()
    matched = [f for f in files if re.search(pattern_include, f)]
    if pattern_exclude:
        matched = [f for f in matched if not re.search(pattern_exclude, f)]
    return matched

def extract_symbols_from_file(filepath):
    """Extract exported symbol names from a source file."""
    full_path = os.path.join(project_dir, filepath)
    if not os.path.exists(full_path):
        return set()

    symbols = set()
    try:
        with open(full_path, 'r', encoding='utf-8', errors='replace') as f:
            content = f.read()
    except (OSError, IOError):
        return symbols

    # export function NAME / export async function NAME
    for m in re.finditer(r'export\s+(?:async\s+)?function\s+(\w+)', content):
        symbols.add(m.group(1))

    # export const NAME / export let NAME / export var NAME
    for m in re.finditer(r'export\s+(?:const|let|var)\s+(\w+)', content):
        symbols.add(m.group(1))

    # export class NAME
    for m in re.finditer(r'export\s+class\s+(\w+)', content):
        symbols.add(m.group(1))

    # export default function NAME
    for m in re.finditer(r'export\s+default\s+(?:async\s+)?function\s+(\w+)', content):
        symbols.add(m.group(1))

    # export default class NAME
    for m in re.finditer(r'export\s+default\s+class\s+(\w+)', content):
        symbols.add(m.group(1))

    # module.exports = { name1, name2 } or module.exports = NAME
    for m in re.finditer(r'module\.exports\s*=\s*\{([^}]+)\}', content):
        block = m.group(1)
        for sym in re.finditer(r'(\w+)', block):
            symbols.add(sym.group(1))
    for m in re.finditer(r'module\.exports\s*=\s*(\w+)', content):
        val = m.group(1)
        if val not in ('require', 'class', 'function', 'async', 'new'):
            symbols.add(val)

    # module.exports.NAME = ...
    for m in re.finditer(r'module\.exports\.(\w+)\s*=', content):
        symbols.add(m.group(1))

    # exports.NAME = ...
    for m in re.finditer(r'(?<!\.)exports\.(\w+)\s*=', content):
        symbols.add(m.group(1))

    # Standalone function/class at top-level (common in CJS without explicit exports block)
    for m in re.finditer(r'^(?:async\s+)?function\s+(\w+)', content, re.MULTILINE):
        symbols.add(m.group(1))
    for m in re.finditer(r'^class\s+(\w+)', content, re.MULTILINE):
        symbols.add(m.group(1))

    # Also extract the basename without extension as a symbol (for import './myModule' style)
    basename = os.path.splitext(os.path.basename(filepath))[0]
    basename = re.sub(r'\.(test|spec)$', '', basename)
    if basename and basename not in ('index',):
        symbols.add(basename)

    return symbols

def read_file_content(filepath):
    """Read full content of a file."""
    full_path = os.path.join(project_dir, filepath)
    if not os.path.exists(full_path):
        return ''
    try:
        with open(full_path, 'r', encoding='utf-8', errors='replace') as f:
            return f.read()
    except (OSError, IOError):
        return ''

# Gather staged source files and test files
src_files = get_staged_files(
    r'\.(js|jsx|ts|tsx)$',
    r'(__tests__|\.test\.|\.spec\.|node_modules|\.config\.)'
)
test_files = get_staged_files(r'(\.test\.|\.spec\.|__tests__/)')

if not src_files or not test_files:
    print('PASS|No validation needed')
    sys.exit(0)

# Collect all symbols from all staged source files
all_symbols = set()
symbols_by_file = {}
for sf in src_files:
    syms = extract_symbols_from_file(sf)
    symbols_by_file[sf] = syms
    all_symbols.update(syms)

if not all_symbols:
    print('PASS|No exported symbols found to validate')
    sys.exit(0)

# Check each test file for references to any symbol from staged source files
test_contents = {}
for tf in test_files:
    test_contents[tf] = read_file_content(tf)

# For each source file, check if at least one test references it
uncovered_src = []
for sf in src_files:
    syms = symbols_by_file[sf]
    if not syms:
        continue

    basename = os.path.splitext(os.path.basename(sf))[0]
    search_terms = set(syms)
    search_terms.add(basename)

    found = False
    for tf, content in test_contents.items():
        for term in search_terms:
            if len(term) < 2:
                continue
            # Word boundary check to avoid false positives
            if re.search(r'(?<![.\w])' + re.escape(term) + r'(?!\w)', content):
                found = True
                break
        if found:
            break

        # Check path-based imports
        sf_no_ext = os.path.splitext(sf)[0]
        if sf_no_ext in content or basename in content:
            found = True
            break

    if not found:
        uncovered_src.append((sf, list(syms)[:5]))

if uncovered_src:
    violations = []
    for sf, syms in uncovered_src:
        sym_list = ', '.join(syms[:3])
        if len(syms) > 3:
            sym_list += ' (+{} more)'.format(len(syms) - 3)
        violations.append('{}: exports [{}] but no staged test references these'.format(sf, sym_list))
    print('FAIL|' + '||'.join(violations))
else:
    print('PASS|All staged source symbols referenced in tests')
PYEOF

RESULT=$(python3 "$PYSCRIPT" "$PROJECT_DIR")

STATUS=$(echo "$RESULT" | cut -d'|' -f1)
MESSAGE=$(echo "$RESULT" | cut -d'|' -f2-)

if [ "$STATUS" = "FAIL" ]; then
  echo "BLOCKED: Test files don't reference changed source symbols. Tests must exercise the code being committed." >&2
  echo "" >&2
  echo "$MESSAGE" | tr '|' '\n' | while read -r line; do
    [ -n "$line" ] && echo "  $line" >&2
  done
  echo "" >&2
  echo "Fix: Ensure staged test files import or reference symbols from the staged source files." >&2
  exit 2
fi

exit 0
