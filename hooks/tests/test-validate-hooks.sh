#!/bin/bash
# Test suite for validate-test-relevance.sh and validate-test-quality.sh
# Sets up temp git repos and runs the hooks against staged content.
# Usage: bash hooks/tests/test-validate-hooks.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RELEVANCE_HOOK="$SCRIPT_DIR/validate-test-relevance.sh"
QUALITY_HOOK="$SCRIPT_DIR/validate-test-quality.sh"
PASS_COUNT=0
FAIL_COUNT=0
TEST_COUNT=0

# Colors (only if terminal supports them)
if [ -t 1 ]; then
  GREEN='\033[0;32m'
  RED='\033[0;31m'
  YELLOW='\033[1;33m'
  NC='\033[0m'
else
  GREEN=''
  RED=''
  YELLOW=''
  NC=''
fi

setup_temp_repo() {
  local tmpdir
  tmpdir=$(mktemp -d)
  cd "$tmpdir"
  git init -q
  git config user.email "test@test.com"
  git config user.name "Test"
  # Initial commit so HEAD exists
  echo "init" > README.md
  git add README.md
  git commit -q -m "init"
  echo "$tmpdir"
}

cleanup_temp_repo() {
  local tmpdir="$1"
  rm -rf "$tmpdir"
}

run_hook() {
  local hook="$1"
  local project_dir="$2"
  local input='{"tool_name":"Bash","tool_input":{"command":"git commit -m test"}}'
  local output exit_code
  output=$(cd "$project_dir" && export CLAUDE_PROJECT_DIR="$project_dir" && echo "$input" | bash "$hook" 2>&1)
  exit_code=$?
  echo "$output"
  return $exit_code
}

assert_pass() {
  local test_name="$1"
  local hook="$2"
  local project_dir="$3"
  TEST_COUNT=$((TEST_COUNT + 1))

  local output exit_code
  set +e
  output=$(run_hook "$hook" "$project_dir")
  exit_code=$?
  set -e

  if [ "$exit_code" -eq 0 ]; then
    echo -e "  ${GREEN}PASS${NC} $test_name"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo -e "  ${RED}FAIL${NC} $test_name (expected PASS, got exit $exit_code)"
    echo "    Output: $output"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

assert_block() {
  local test_name="$1"
  local hook="$2"
  local project_dir="$3"
  local expected_pattern="${4:-}"
  TEST_COUNT=$((TEST_COUNT + 1))

  local output exit_code
  set +e
  output=$(run_hook "$hook" "$project_dir")
  exit_code=$?
  set -e

  if [ "$exit_code" -eq 2 ]; then
    if [ -n "$expected_pattern" ]; then
      if echo "$output" | grep -qi "$expected_pattern"; then
        echo -e "  ${GREEN}PASS${NC} $test_name (blocked with expected message)"
        PASS_COUNT=$((PASS_COUNT + 1))
      else
        echo -e "  ${RED}FAIL${NC} $test_name (blocked but message didn't match '$expected_pattern')"
        echo "    Output: $output"
        FAIL_COUNT=$((FAIL_COUNT + 1))
      fi
    else
      echo -e "  ${GREEN}PASS${NC} $test_name (blocked as expected)"
      PASS_COUNT=$((PASS_COUNT + 1))
    fi
  else
    echo -e "  ${RED}FAIL${NC} $test_name (expected BLOCK exit 2, got exit $exit_code)"
    echo "    Output: $output"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

# ============================================================
echo ""
echo "=== validate-test-relevance.sh ==="
echo ""

# --- Test 1: No source files staged (docs only) -> PASS ---
echo "Test group: skip conditions"
TMPDIR=$(setup_temp_repo)
echo "# Documentation" > "$TMPDIR/docs.md"
git -C "$TMPDIR" add docs.md
assert_pass "docs-only commit skips check" "$RELEVANCE_HOOK" "$TMPDIR"
cleanup_temp_repo "$TMPDIR"

# --- Test 2: Source files but no test files -> PASS (delegates to pre-commit-gate) ---
TMPDIR=$(setup_temp_repo)
cat > "$TMPDIR/myModule.js" << 'SRCEOF'
function processOrder(order) {
  return order.total * 1.1;
}
module.exports = { processOrder };
SRCEOF
git -C "$TMPDIR" add myModule.js
assert_pass "source without tests delegates to pre-commit-gate" "$RELEVANCE_HOOK" "$TMPDIR"
cleanup_temp_repo "$TMPDIR"

# --- Test 3: Test references source symbol -> PASS ---
echo ""
echo "Test group: relevance pass cases"
TMPDIR=$(setup_temp_repo)
cat > "$TMPDIR/calculator.js" << 'SRCEOF'
function add(a, b) { return a + b; }
function subtract(a, b) { return a - b; }
module.exports = { add, subtract };
SRCEOF
cat > "$TMPDIR/calculator.test.js" << 'TESTEOF'
const { add, subtract } = require('./calculator');
test('add returns sum', () => {
  expect(add(2, 3)).toBe(5);
});
test('subtract returns difference', () => {
  expect(subtract(5, 3)).toBe(2);
});
TESTEOF
git -C "$TMPDIR" add calculator.js calculator.test.js
assert_pass "test imports source symbols" "$RELEVANCE_HOOK" "$TMPDIR"
cleanup_temp_repo "$TMPDIR"

# --- Test 4: Test references module by basename -> PASS ---
TMPDIR=$(setup_temp_repo)
cat > "$TMPDIR/orderService.js" << 'SRCEOF'
export function createOrder(data) { return data; }
export function cancelOrder(id) { return id; }
SRCEOF
cat > "$TMPDIR/orderService.test.js" << 'TESTEOF'
import { createOrder } from './orderService';
test('createOrder builds order', () => {
  const result = createOrder({ item: 'widget' });
  expect(result.item).toBe('widget');
});
TESTEOF
git -C "$TMPDIR" add orderService.js orderService.test.js
assert_pass "test references module by import path" "$RELEVANCE_HOOK" "$TMPDIR"
cleanup_temp_repo "$TMPDIR"

# --- Test 5: Integration test references endpoint path -> PASS ---
TMPDIR=$(setup_temp_repo)
mkdir -p "$TMPDIR/routes"
cat > "$TMPDIR/routes/orders.js" << 'SRCEOF'
const express = require('express');
const router = express.Router();
router.get('/api/orders', (req, res) => res.json([]));
module.exports = router;
SRCEOF
cat > "$TMPDIR/routes/orders.test.js" << 'TESTEOF'
const request = require('supertest');
const app = require('../app');
test('GET /api/orders returns list', async () => {
  const res = await request(app).get('/api/orders');
  expect(res.status).toBe(200);
});
TESTEOF
git -C "$TMPDIR" add routes/orders.js routes/orders.test.js
assert_pass "integration test references endpoint and module name" "$RELEVANCE_HOOK" "$TMPDIR"
cleanup_temp_repo "$TMPDIR"

# --- Test 6: Test does NOT reference any source symbol -> BLOCK ---
echo ""
echo "Test group: relevance block cases"
TMPDIR=$(setup_temp_repo)
cat > "$TMPDIR/paymentProcessor.js" << 'SRCEOF'
function chargeCard(card, amount) { return { success: true }; }
function refundPayment(txId) { return { refunded: true }; }
module.exports = { chargeCard, refundPayment };
SRCEOF
cat > "$TMPDIR/unrelated.test.js" << 'TESTEOF'
test('math works', () => {
  expect(2 + 2).toBe(4);
});
test('strings work', () => {
  expect('hello'.length).toBe(5);
});
TESTEOF
git -C "$TMPDIR" add paymentProcessor.js unrelated.test.js
assert_block "test doesn't reference any source symbols" "$RELEVANCE_HOOK" "$TMPDIR" "reference"
cleanup_temp_repo "$TMPDIR"

# --- Test 7: Test references some but not all source files -> BLOCK ---
TMPDIR=$(setup_temp_repo)
cat > "$TMPDIR/auth.js" << 'SRCEOF'
export function login(user, pass) { return 'token'; }
SRCEOF
cat > "$TMPDIR/billing.js" << 'SRCEOF'
export function createInvoice(data) { return data; }
SRCEOF
cat > "$TMPDIR/auth.test.js" << 'TESTEOF'
import { login } from './auth';
test('login returns token', () => {
  expect(login('user', 'pass')).toBe('token');
});
TESTEOF
git -C "$TMPDIR" add auth.js billing.js auth.test.js
assert_block "partial coverage — billing.js not referenced" "$RELEVANCE_HOOK" "$TMPDIR" "billing"
cleanup_temp_repo "$TMPDIR"

# --- Test 8: ESM export default function -> PASS ---
echo ""
echo "Test group: export style edge cases"
TMPDIR=$(setup_temp_repo)
cat > "$TMPDIR/formatter.js" << 'SRCEOF'
export default function formatCurrency(amount) {
  return `$${amount.toFixed(2)}`;
}
SRCEOF
cat > "$TMPDIR/formatter.test.js" << 'TESTEOF'
import formatCurrency from './formatter';
test('formats currency', () => {
  expect(formatCurrency(10)).toBe('$10.00');
});
TESTEOF
git -C "$TMPDIR" add formatter.js formatter.test.js
assert_pass "export default function recognized" "$RELEVANCE_HOOK" "$TMPDIR"
cleanup_temp_repo "$TMPDIR"

# --- Test 9: exports.NAME style -> PASS ---
TMPDIR=$(setup_temp_repo)
cat > "$TMPDIR/logger.js" << 'SRCEOF'
exports.info = function(msg) { console.log(msg); };
exports.error = function(msg) { console.error(msg); };
SRCEOF
cat > "$TMPDIR/logger.test.js" << 'TESTEOF'
const { info, error } = require('./logger');
test('info logs', () => {
  const spy = jest.spyOn(console, 'log').mockImplementation();
  info('hello');
  expect(spy).toHaveBeenCalledWith('hello');
  spy.mockRestore();
});
TESTEOF
git -C "$TMPDIR" add logger.js logger.test.js
assert_pass "exports.NAME pattern recognized" "$RELEVANCE_HOOK" "$TMPDIR"
cleanup_temp_repo "$TMPDIR"


# ============================================================
echo ""
echo "=== validate-test-quality.sh ==="
echo ""

# --- Test Q1: No test files staged -> PASS ---
echo "Test group: skip conditions"
TMPDIR=$(setup_temp_repo)
echo "const x = 1;" > "$TMPDIR/source.js"
git -C "$TMPDIR" add source.js
assert_pass "no test files skips check" "$QUALITY_HOOK" "$TMPDIR"
cleanup_temp_repo "$TMPDIR"

# --- Test Q2: expect(true).toBe(true) -> BLOCK ---
echo ""
echo "Test group: tautological assertions"
TMPDIR=$(setup_temp_repo)
cat > "$TMPDIR/bad.test.js" << 'TESTEOF'
test('placeholder', () => {
  expect(true).toBe(true);
});
TESTEOF
git -C "$TMPDIR" add bad.test.js
assert_block "expect(true) blocked" "$QUALITY_HOOK" "$TMPDIR" "tautological"
cleanup_temp_repo "$TMPDIR"

# --- Test Q3: expect(false).toBe(false) -> BLOCK ---
TMPDIR=$(setup_temp_repo)
cat > "$TMPDIR/bad2.test.js" << 'TESTEOF'
test('check false', () => {
  expect(false).toBe(false);
});
TESTEOF
git -C "$TMPDIR" add bad2.test.js
assert_block "expect(false) blocked" "$QUALITY_HOOK" "$TMPDIR" "tautological"
cleanup_temp_repo "$TMPDIR"

# --- Test Q4: expect(1).toBe(1) -> BLOCK ---
TMPDIR=$(setup_temp_repo)
cat > "$TMPDIR/num.test.js" << 'TESTEOF'
test('number check', () => {
  expect(1).toBe(1);
});
TESTEOF
git -C "$TMPDIR" add num.test.js
assert_block "expect(1).toBe(1) blocked" "$QUALITY_HOOK" "$TMPDIR" "literal"
cleanup_temp_repo "$TMPDIR"

# --- Test Q5: expect("foo").toBe("foo") -> BLOCK ---
TMPDIR=$(setup_temp_repo)
cat > "$TMPDIR/str.test.js" << 'TESTEOF'
test('string check', () => {
  expect("foo").toBe("foo");
});
TESTEOF
git -C "$TMPDIR" add str.test.js
assert_block 'expect("foo").toBe("foo") blocked' "$QUALITY_HOOK" "$TMPDIR" "literal"
cleanup_temp_repo "$TMPDIR"

# --- Test Q6: expect().toBeDefined() -> BLOCK ---
TMPDIR=$(setup_temp_repo)
cat > "$TMPDIR/empty.test.js" << 'TESTEOF'
test('empty expect', () => {
  expect().toBeDefined();
});
TESTEOF
git -C "$TMPDIR" add empty.test.js
assert_block "empty expect() blocked" "$QUALITY_HOOK" "$TMPDIR" "empty expect"
cleanup_temp_repo "$TMPDIR"

# --- Test Q7: Test body with no assertions -> BLOCK ---
echo ""
echo "Test group: empty test bodies"
TMPDIR=$(setup_temp_repo)
cat > "$TMPDIR/noassert.test.js" << 'TESTEOF'
test('does something', () => {
  const x = 1 + 1;
  console.log(x);
})
TESTEOF
git -C "$TMPDIR" add noassert.test.js
assert_block "test with no assertions blocked" "$QUALITY_HOOK" "$TMPDIR" "no assertion"
cleanup_temp_repo "$TMPDIR"

# --- Test Q8: Placeholder test names -> BLOCK ---
echo ""
echo "Test group: placeholder names"
TMPDIR=$(setup_temp_repo)
cat > "$TMPDIR/placeholder.test.js" << 'TESTEOF'
test('placeholder', () => {
  expect(1 + 1).toBe(2);
})
TESTEOF
git -C "$TMPDIR" add placeholder.test.js
assert_block "placeholder test name blocked" "$QUALITY_HOOK" "$TMPDIR" "placeholder"
cleanup_temp_repo "$TMPDIR"

# --- Test Q9: todo test name -> BLOCK ---
TMPDIR=$(setup_temp_repo)
cat > "$TMPDIR/todo.test.js" << 'TESTEOF'
test('todo: write real test', () => {
  expect(true).toBe(true);
})
TESTEOF
git -C "$TMPDIR" add todo.test.js
assert_block "todo test name blocked" "$QUALITY_HOOK" "$TMPDIR" "placeholder"
cleanup_temp_repo "$TMPDIR"

# --- Test Q10: Legitimate test -> PASS ---
echo ""
echo "Test group: legitimate tests pass"
TMPDIR=$(setup_temp_repo)
cat > "$TMPDIR/good.test.js" << 'TESTEOF'
const { processOrder } = require('./orderProcessor');

describe('processOrder', () => {
  test('applies tax to order total', () => {
    const order = { items: [{ price: 100 }], taxRate: 0.1 };
    const result = processOrder(order);
    expect(result.total).toBe(110);
  });

  test('throws on empty order', () => {
    expect(() => processOrder({ items: [] })).toThrow('Empty order');
  });

  test('handles discount codes', () => {
    const order = { items: [{ price: 100 }], discount: 'SAVE10' };
    const result = processOrder(order);
    expect(result.total).toBeLessThan(100);
    expect(result.discountApplied).toBe(true);
  });
});
TESTEOF
git -C "$TMPDIR" add good.test.js
assert_pass "legitimate test with real assertions passes" "$QUALITY_HOOK" "$TMPDIR"
cleanup_temp_repo "$TMPDIR"

# --- Test Q11: Test with async/await and real assertions -> PASS ---
TMPDIR=$(setup_temp_repo)
cat > "$TMPDIR/api.test.js" << 'TESTEOF'
const request = require('supertest');
const app = require('../app');

describe('GET /api/users', () => {
  test('returns 200 with user list', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('filters by role', async () => {
    const res = await request(app).get('/api/users?role=admin');
    expect(res.status).toBe(200);
    expect(res.body.every(u => u.role === 'admin')).toBe(true);
  });
});
TESTEOF
git -C "$TMPDIR" add api.test.js
assert_pass "async test with real assertions passes" "$QUALITY_HOOK" "$TMPDIR"
cleanup_temp_repo "$TMPDIR"

# --- Test Q12: expect('different').toBe('strings') -> PASS (different literals are fine) ---
TMPDIR=$(setup_temp_repo)
cat > "$TMPDIR/diff.test.js" << 'TESTEOF'
test('type coercion check', () => {
  const result = formatType('number');
  expect(result).toBe('numeric');
});
TESTEOF
git -C "$TMPDIR" add diff.test.js
assert_pass "different literal values in expect/toBe passes" "$QUALITY_HOOK" "$TMPDIR"
cleanup_temp_repo "$TMPDIR"

# --- Test Q13: toHaveBeenCalled counts as assertion -> PASS ---
TMPDIR=$(setup_temp_repo)
cat > "$TMPDIR/mock.test.js" << 'TESTEOF'
test('calls the callback', () => {
  const cb = jest.fn();
  doThing(cb);
  expect(cb).toHaveBeenCalled();
})
TESTEOF
git -C "$TMPDIR" add mock.test.js
assert_pass "toHaveBeenCalled counts as assertion" "$QUALITY_HOOK" "$TMPDIR"
cleanup_temp_repo "$TMPDIR"

# ============================================================
# Combined scenario: both hooks together
echo ""
echo "=== Combined scenarios ==="
echo ""

# --- Test C1: Fake test for real source -> both should catch it ---
TMPDIR=$(setup_temp_repo)
cat > "$TMPDIR/inventory.js" << 'SRCEOF'
function checkStock(sku) { return 42; }
function reserveStock(sku, qty) { return true; }
module.exports = { checkStock, reserveStock };
SRCEOF
cat > "$TMPDIR/fake.test.js" << 'TESTEOF'
test('placeholder', () => {
  expect(true).toBe(true);
})
TESTEOF
git -C "$TMPDIR" add inventory.js fake.test.js
assert_block "combined: relevance catches unrelated test" "$RELEVANCE_HOOK" "$TMPDIR" "reference"
assert_block "combined: quality catches tautological test" "$QUALITY_HOOK" "$TMPDIR" "tautological"
cleanup_temp_repo "$TMPDIR"

# --- Test C2: Real test for real source -> both pass ---
TMPDIR=$(setup_temp_repo)
cat > "$TMPDIR/inventory.js" << 'SRCEOF'
function checkStock(sku) { return 42; }
function reserveStock(sku, qty) { return true; }
module.exports = { checkStock, reserveStock };
SRCEOF
cat > "$TMPDIR/inventory.test.js" << 'TESTEOF'
const { checkStock, reserveStock } = require('./inventory');
test('checkStock returns quantity', () => {
  expect(checkStock('SKU-001')).toBe(42);
});
test('reserveStock succeeds', () => {
  expect(reserveStock('SKU-001', 5)).toBe(true);
});
TESTEOF
git -C "$TMPDIR" add inventory.js inventory.test.js
assert_pass "combined: relevance passes for real test" "$RELEVANCE_HOOK" "$TMPDIR"
assert_pass "combined: quality passes for real test" "$QUALITY_HOOK" "$TMPDIR"
cleanup_temp_repo "$TMPDIR"


# ============================================================
echo ""
echo "==============================="
echo -e "Results: ${GREEN}${PASS_COUNT} passed${NC}, ${RED}${FAIL_COUNT} failed${NC} (${TEST_COUNT} total)"
echo "==============================="

if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
exit 0
