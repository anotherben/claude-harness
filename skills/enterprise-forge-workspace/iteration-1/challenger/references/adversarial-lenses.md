# Adversarial Lenses Reference

Five lenses, each asking a different "what if" question. These are qualitative — they produce findings, not PASS/FAIL. Each finding is either a **bug** (requires recycle) or an **improvement** (logged but non-blocking).

---

## Lens 1: The 3AM Test

> Can the on-call engineer diagnose a failure from logs alone at 3AM?

Check every error path in changed files:
- Does every catch block log enough context? (input, expected, actual, tenant)
- Are error messages specific enough to identify the failing component?
- Would you know which query failed, with which parameters?

```bash
for f in $(git diff --name-only <base>...HEAD | grep -E '\.js$' | grep -v __tests__); do
  [ -f "$f" ] || continue
  echo "=== $f ==="
  grep -n -A3 "catch" "$f" | head -30
done
```

**Finding format:** `3AM-X: [error path] in [file:line] — [what's missing from the log]`

---

## Lens 2: The Delete Test

> What can I remove and nothing breaks?

Look for: unused variables/imports/functions, unreachable code paths, defensive checks that duplicate upstream checks, config options with no effect.

```bash
for f in $(git diff --name-only <base>...HEAD | grep -E '\.js$' | grep -v __tests__); do
  [ -f "$f" ] || continue
  grep -n "const \|let \|var " "$f" | while read -r line; do
    varname=$(echo "$line" | grep -oP '(const|let|var)\s+(\w+)' | awk '{print $2}')
    [ -n "$varname" ] && [ "$(grep -c "\b$varname\b" "$f" 2>/dev/null)" -le 1 ] && echo "UNUSED? $line"
  done
done
```

**Finding format:** `DELETE-X: [dead code] in [file:line] — [why it's removable]`

---

## Lens 3: The New Hire Test

> Will someone understand this in 6 months with no context?

Look for: magic numbers, opaque variable names, complex business rules without explanation, implicit assumptions, data flows that aren't clear from top-to-bottom reading.

**Finding format:** `NEWHIRE-X: [code section] in [file:line] — [what would confuse someone]`

---

## Lens 4: The Adversary Test

> How would I break this?

Attack vectors to consider:
- Unexpected inputs: null, undefined, "", [], {}, 0, -1, MAX_SAFE_INTEGER
- Bypass validation by calling the service directly (skipping the route)
- Access another tenant's data by manipulating IDs
- Cause a partial write with no rollback (transaction safety)
- Trigger a race condition with concurrent requests

```bash
for f in $(git diff --name-only <base>...HEAD | grep -E '\.js$' | grep -v __tests__); do
  [ -f "$f" ] || continue
  HAS_MULTI_QUERY=$(grep -c "pool\.\|db\.\|query(" "$f" 2>/dev/null)
  HAS_TRANSACTION=$(grep -c "BEGIN\|COMMIT\|ROLLBACK\|transaction" "$f" 2>/dev/null)
  [ "$HAS_MULTI_QUERY" -gt 2 ] && [ "$HAS_TRANSACTION" -eq 0 ] && echo "ADVERSARY FLAG: $f has $HAS_MULTI_QUERY queries but no transaction"
done
```

**Finding format:** `ADVERSARY-X: [attack vector] targeting [file:line] — [impact] — [fix]`

---

## Lens 5: The Scale Test

> What happens at 10x / 100x / 1000x?

Look for: N+1 query patterns (query in a loop), unbounded SELECT (no LIMIT), in-memory aggregations that should be SQL, missing indexes on WHERE/JOIN columns.

```bash
for f in $(git diff --name-only <base>...HEAD | grep -E '\.js$' | grep -v __tests__); do
  [ -f "$f" ] || continue
  grep -n "for\|while\|forEach\|\.map(" "$f" | head -5
  grep -n "SELECT" "$f" | grep -v "LIMIT" | grep -v "WHERE.*id\s*=" | head -5
done
```

**Finding format:** `SCALE-X: [concern] in [file:line] — at 10x: [effect], at 1000x: [effect] — [fix]`
