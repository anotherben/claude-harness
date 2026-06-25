# Trace Recipes

Concrete commands for fanning out a blast radius. Cortex-first per CLAUDE.md, with grep, psql, git
log, and route registry sweeps as backups.

## Table of Contents

1. [Cortex-engine commands (symbol-aware)](#1-cortex-engine-commands-symbol-aware)
2. [grep recipes (string-level)](#2-grep-recipes-string-level)
3. [Live database verification (REQUIRED for DB changes)](#3-live-database-verification-required-for-db-changes)
4. [Git history recipes](#4-git-history-recipes)
5. [Route registry sweep](#5-route-registry-sweep)
6. [Sibling-bug hunt recipes](#6-sibling-bug-hunt-recipes)
7. [Mock detection (false-confidence test detection)](#7-mock-detection-false-confidence-test-detection)
8. [Input-form resolvers](#8-input-form-resolvers)
9. [PR review-thread query](#9-pr-review-thread-query)

---

## 1. Cortex-engine commands (symbol-aware)

Per CLAUDE.md, cortex tools are first-line. They avoid the 80%+ token waste of grep+Read, AND they
understand symbol scope so they don't return false-positive name collisions.

```
# Find every call site of a symbol
mcp__cortex-engine__cortex_find_references(name="<symbol>", repo="<repo>")

# Find every file that imports a module
mcp__cortex-engine__cortex_find_importers(path="apps/api/src/services/<module>.js")

# Read a specific symbol's definition (saves reading the whole file)
mcp__cortex-engine__cortex_read_symbol(name="<symbol>", repo="<repo>")

# Find references to a string literal (SQL column names, route paths, env vars)
mcp__cortex-engine__cortex_find_text(query="<string>", repo="<repo>")

# Get an outline of a file before reading it
mcp__cortex-engine__cortex_outline(path="<path>", repo="<repo>")
```

**When cortex misses things**:
- Dynamic identifiers (`obj[varName]`)
- String literals (SQL, route paths) — use `cortex_find_text` instead
- New files added in the current branch that haven't been indexed
- Cross-language references (JS → SQL, JS → migration file)

For these, fall through to grep.

---

## 2. grep recipes (string-level)

```bash
# All SQL referencing a column (catch camelCase + snake_case variants)
grep -rn "\b<column_name>\b" apps/api/src/ --include='*.js'
grep -rn "<columnName>" apps/api/src/ --include='*.js'

# All references to a table
grep -rn "FROM <table>\b" apps/api/src/
grep -rn "INSERT INTO <table>\b" apps/api/src/
grep -rn "UPDATE <table>\b" apps/api/src/
grep -rn "DELETE FROM <table>\b" apps/api/src/

# All env var readers
grep -rn "process\.env\.<VAR>\b" apps/

# All references to a route path (frontend + backend)
grep -rn "['\"]<path-prefix>" apps/admin/src/
grep -rn "router\.\(get\|post\|put\|delete\|patch\).*<path>" apps/api/src/

# Dynamic require/import strings (after a rename or move)
grep -rn "require.*['\"].*<basename>['\"]" apps/

# Tenant scoping audit (for tenant_id changes)
grep -rn "WHERE.*tenant_id" apps/api/src/ -A 1 | head -100
grep -rn "UPDATE products" apps/api/src/ | while read line; do
  # check each line's context for tenant scoping
  echo "$line"
done

# Find re-exports
grep -rn "module.exports.*=.*require" apps/api/src/services/ | grep "<module>"
```

**Always** pair grep with `--include='*.js'` (or appropriate ext) to skip `node_modules` and
generated files. Better: `git grep` only searches tracked files, which is even cleaner.

---

## 3. Live database verification (REQUIRED for DB changes)

The dev DB is the source of truth. Never trust a migration file, a model, or a TypeScript type —
verify against the live schema.

### 3a. Get the DATABASE_URL

```bash
# It lives in apps/api/.env (or repo root .env)
grep "^DATABASE_URL=" apps/api/.env
```

Or use `dotenv -f apps/api/.env -- printenv DATABASE_URL` if you don't want to print the URL into
the report.

### 3b. Get the schema of a table

```bash
psql "$DATABASE_URL" -c "\d+ <table_name>"
```

Or, structured:

```bash
psql "$DATABASE_URL" -c "
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = '<table>'
ORDER BY ordinal_position;
"
```

For NOT NULL and constraints:

```bash
psql "$DATABASE_URL" -c "
SELECT conname, contype, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = '<table>'::regclass;
"
```

For indexes:

```bash
psql "$DATABASE_URL" -c "\di <table>*"
```

### 3c. Sample real data to prove behavior

For a `WHERE tenant_id = $1` change, prove the query works:

```bash
# Find two tenants
psql "$DATABASE_URL" -c "SELECT DISTINCT tenant_id FROM orders LIMIT 2;"

# Run the actual query with each tenant_id and confirm differing row counts
psql "$DATABASE_URL" -c "SELECT count(*) FROM orders WHERE tenant_id = '<id-1>';"
psql "$DATABASE_URL" -c "SELECT count(*) FROM orders WHERE tenant_id = '<id-2>';"
```

For a join change involving cross-table type traps:

```bash
psql "$DATABASE_URL" -c "
SELECT count(*) FROM products p
JOIN suppliers s ON p.supplier_id::text = s.id::text
LIMIT 1;
"
```

If `count(*)` is suspiciously 0 — the type cast may be silently failing. Sample one product and
look up its supplier manually.

### 3d. Diff live schema against code assumptions

For every column the code references, confirm it exists with the expected type and nullability. The
report's `## Live Schema Verification` section captures this:

```markdown
### Table `orders`

| Column | Live type | Live nullable | Code assumption | Match? |
|---|---|---|---|---|
| `id` | uuid | NO | `string` (UUID) | PASS |
| `tenant_id` | uuid | NO | `string` (UUID) | PASS |
| `status` | text | NO | `string` ('pending'\|'cancelled'\|...) | PASS |
| `customer_id` | integer | YES | `number` (assumed NOT NULL) | **FAIL — code crashes on null** |
```

Always include the actual psql output as an appendix so the user can verify.

### 3e. If psql is blocked

Do not silently fall back to migration files. Migration files are contract intent, not runtime truth.

1. State the limitation in `## Live Schema Verification`, including the exact error or policy.
2. Look for a read-only schema helper in `apps/api/scripts/` or `scripts/`.
3. Search for admin/API schema snapshot routes that query `information_schema`.
4. Check for read-only DB URLs such as `*_READ_ONLY_DATABASE_URL`.
5. Use migration history only as a weak signal and label it `intent, not live truth`.
6. Mark every column-level assumption `VERIFY-MANUAL`.
7. Emit the exact `psql` commands the user can run.

This caps the verdict at **NEEDS REVIEW (live verification blocked)**. If the blocked proof covers a
write path, identity boundary, tenant/auth boundary, or data-integrity guard, cap at **DO NOT MERGE**
unless another live source proves the same fact.

### 3f. Schema authority and predicate checklist

For each DB-touching change, compare these authorities:

- Live DB: `information_schema`, `pg_indexes`, `pg_constraint`
- Committed migrations under `apps/api/database/migrations/` or equivalent
- Canonical schema/bootstrap files such as `schema.sql`, `purchasing_schema.sql`, or fact-drift maps
- Code assumptions in SQL, services, models, tests, and docs

Look for columns referenced by code but absent live, live columns/types/defaults/nullability the code
does not expect, and cross-table type traps such as UUID-to-integer joins. If a join changed, sample
actual joined rows and prove it returns data.

For every changed `WHERE`, `JOIN`, `ORDER BY`, `ON CONFLICT`, uniqueness check, or lookup guard,
compare the predicate to live indexes and constraints exactly. `LOWER(TRIM(invoice_number))` does not
match an index on `LOWER(invoice_number)`.

---

## 4. Git history recipes

`git log` surfaces *why* a thing was done. Often the change set is documented in commit history.

```bash
# Who/when/why was this line added?
git blame -L <start>,<end> <file>

# Find every commit that touched this symbol
git log -p -S "<symbol>" --source -- apps/

# Find every commit that touched this table
git log -p -S "<table_name>" --source -- apps/api/

# Find recent commits to a directory
git log --oneline --since="1 month ago" -- apps/api/src/routes/

# Show what was in the PR that introduced this code
git log --merges --grep="<keyword>"
```

For migration history specifically:

```bash
ls apps/api/database/migrations/ | sort -n | tail -20
```

Migration files are numbered, so the latest ones are the recent changes.

---

## 5. Route registry sweep

For auth, tenant, or middleware changes, you need to walk every route and confirm the chain.

```bash
# All route files
ls apps/api/src/routes/

# Where each is mounted in the app
grep -rn "require.*['\"]./routes/" apps/api/src/index.js apps/api/src/app.js 2>/dev/null

# For each route file, list the routes and middleware
for f in apps/api/src/routes/*.js; do
  echo "=== $f ==="
  grep -n "router\.\(get\|post\|put\|delete\|patch\|use\)" "$f"
done
```

Then, for each route, check the middleware order. Per CLAUDE.md, public/webhook routes MUST mount
before `authenticateStaff`.

```bash
# Routes mounted BEFORE auth (must be public/webhook only)
awk '/authenticateStaff/{exit} /app\.use.*routes/' apps/api/src/app.js
```

---

## 6. Sibling-bug hunt recipes

These are the high-value greps after a bugfix. The goal: find code with the same shape as the
bug just fixed.

```bash
# Tenant-scope leak — UPDATE on tenant-anchored table without WHERE tenant_id
for table in orders products purchase_orders stock_movements; do
  echo "=== Updates on $table ==="
  grep -rn "UPDATE $table" apps/api/src/ | grep -v "WHERE.*tenant_id"
done

# Missing await
grep -rn "[^.]<asyncFn>(" apps/api/src/ | grep -v "await\|return\|\.then\|\.catch"

# Type-trap joins (UUID-to-int without cast)
grep -rn "suppliers\.id.*=.*supplier_id\|supplier_id.*=.*suppliers\.id" apps/api/src/

# Bulk routes that may diverge from single-record routes
for f in apps/api/src/routes/*.js; do
  if grep -q "bulk" "$f" || grep -q "/bulk/" "$f"; then
    echo "=== Bulk route in $f ==="
    grep -n "router\." "$f"
  fi
done

# Routes mounted before authenticateStaff (public surface audit)
grep -B 2 -A 0 "authenticateStaff" apps/api/src/app.js | head -50
```

For each match, classify as:
- **Same bug** — needs fixing
- **Different bug** — log separately, file vault item, don't fix here (scope-lock)
- **Safe by construction** — the upstream guarantees this won't happen (document the reason)

---

## 7. Mock detection (false-confidence test detection)

Per CLAUDE.md: all tests run against the dev DB. Any test using jest mocks for DB calls is
producing false confidence.

```bash
# Find jest.mock usages
grep -rn "jest\.mock\(" apps/api/src/__tests__/

# Find in-memory fakes
grep -rn "MockPool\|FakeDb\|InMemoryRepository" apps/api/src/

# Find test files that DON'T use the real dev DB
for f in apps/api/src/__tests__/**/*.test.js; do
  if ! grep -l "process.env.DATABASE_URL\|getDevPool\|sharedPool" "$f" > /dev/null; then
    echo "Possibly mocked: $f"
  fi
done
```

Flag any test in the blast radius that doesn't hit the dev DB as **HIGH risk**.

---

## 8. Input-form resolvers

How to turn each input form into a concrete change set.

### PR number

```bash
PR=856
gh pr view "$PR" --json title,body,headRefName,baseRefName,files,additions,deletions
gh pr diff "$PR" > /tmp/pr-${PR}.diff
gh pr view "$PR" --json reviewDecision,statusCheckRollup  # current state
```

Parse the diff for changed files, then for each file, identify:
- Changed symbols (look for `@@` hunks containing `function`, `class`, `module.exports`)
- Added/removed columns (look for migration files in the diff)
- Changed signatures (look for parameter lists in function declarations)

If the PR is large (>20 files), summarize: "PR #856 touches X files across N domains (API routes,
services, migrations). Tracing top 10 highest-risk symbols. Full list in appendix."

### Specific file

```bash
FILE="apps/api/src/services/foo.js"

# Outline the file via cortex (gets symbols without reading the whole thing)
mcp__cortex-engine__cortex_outline(path="$FILE", repo="helpdesk")

# Find every file that imports this one
mcp__cortex-engine__cortex_find_importers(path="$FILE")

# Find every reference to each exported symbol
# (for each exported symbol from the outline:)
mcp__cortex-engine__cortex_find_references(name="<exportedSymbol>", repo="helpdesk")

# Find SQL queries the file contains
grep -n "FROM \|INSERT INTO \|UPDATE \|DELETE FROM " "$FILE"
```

The change set is: every exported symbol of the file, every SQL string in the file, every config
key the file reads.

### Specific caller / symbol

```bash
SYMBOL="getRoute"

# References (callers)
mcp__cortex-engine__cortex_find_references(name="$SYMBOL", repo="helpdesk")

# Read the symbol itself to find what it depends on
mcp__cortex-engine__cortex_read_symbol(name="$SYMBOL", repo="helpdesk")

# If the symbol is exported, find re-exports
grep -rn "exports.*$SYMBOL\b" apps/api/src/
```

For "specific caller" mode, the change set IS the call graph — fan out from the symbol itself.

### Uncommitted diff

```bash
git diff                  # working tree
git diff --staged         # staged
git diff HEAD             # both combined
git status -s             # the file list at a glance
```

### Branch / commit range

```bash
BASE="main"
git diff "$BASE"...HEAD             # changes on this branch since branching from base
git log --oneline "$BASE"..HEAD     # commits on this branch
git diff --stat "$BASE"...HEAD      # file-level summary
```

---

## Cortex repo names

When using cortex tools, the repo name for this project is `helpdesk`. For multi-repo tracing,
pass the appropriate name. List repos via `mcp__cortex-engine__cortex_list_repos()`.

---

## 9. PR review-thread query

Run at the start of PR mode and again immediately before the final verdict. `headRefOid` and
`reviewThreads.nodes[].isResolved` are the source of truth.

```bash
gh api graphql -F owner=<owner> -F repo=<repo> -F number=<num> -f query='
query($owner:String!,$repo:String!,$number:Int!){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$number){
      headRefOid
      reviewThreads(first:100){
        totalCount
        nodes{
          isResolved
          isOutdated
          path
          line
          comments(first:1){ nodes{ author{login} body url } }
        }
      }
    }
  }
}' > /tmp/pr-review-threads.json
```

If `headRefOid` changes between the initial and final query, rerun the trace against the new head.
If any thread is unresolved, the verdict is **DO NOT MERGE / REVIEW THREADS OPEN** even when local
proof looks complete.
