# Enterprise Engineering Standards

This is the single source of truth for coding standards enforced across all enterprise pipeline stages. Every enterprise skill references this file instead of repeating these rules inline.

---

## Multi-Tenant Isolation

Every database operation must scope to the authenticated tenant. This exists because the application serves multiple businesses from one database — a missing `tenant_id` filter means one customer sees another's data.

### Writes
- Every `INSERT` statement includes `tenant_id` sourced from `req.user.tenant_id` (never from user input)
- Every `UPDATE` and `DELETE` includes `WHERE tenant_id = $N` in addition to the record ID

### Reads
- Every `SELECT` includes `WHERE tenant_id = $N` (or joins through a tenant-scoped table)
- Aggregate queries (`COUNT`, `SUM`, etc.) must also scope to tenant

### Verification
```bash
# Grep for SQL statements missing tenant_id in changed files
git diff --name-only <base>...HEAD | grep -E '\.js$' | xargs grep -n -E '(INSERT INTO|UPDATE .* SET|DELETE FROM|SELECT .* FROM)' | grep -v tenant_id | grep -v __tests__
```

---

## SQL Safety

### Parameterized Queries Only
All query values use positional parameters (`$1`, `$2`, etc.) — zero string concatenation or template literals in SQL strings. This prevents SQL injection, which is the #1 web application vulnerability.

```javascript
// Correct
const result = await pool.query('SELECT * FROM products WHERE id = $1 AND tenant_id = $2', [id, tenantId]);

// Wrong — SQL injection risk
const result = await pool.query(`SELECT * FROM products WHERE id = ${id}`);
```

### Timestamp Type
All timestamp columns use `TIMESTAMPTZ` (not `TIMESTAMP`). Without timezone awareness, timestamps shift when servers are in different timezones, causing data corruption in date-based queries.

### Migration Guards
All `CREATE TABLE` and `CREATE INDEX` statements use `IF NOT EXISTS`. This makes migrations idempotent — safe to run multiple times without error.

---

## File Size Limits

Source files (excluding tests) have size limits to maintain readability and prevent "god files" that become impossible to navigate:

| Limit | Lines | Action |
|-------|-------|--------|
| **Soft limit** | 400 | New code should not push a file past this. If approaching, extract a module. |
| **Hard limit** | 800 | File must not exceed this. If already over, refactor when touched — don't grow further. |

Test files are exempt from these limits.

---

## Authentication & Route Order

### Middleware
- Every new route that handles tenant data requires `authenticateStaff` middleware (or an explicitly documented justification for being public)
- Public routes (webhooks, health checks) must mount BEFORE the `authenticateStaff` middleware in the route registration order — otherwise they'll be blocked

### Route Pattern
```javascript
// Public routes first
router.post('/webhooks/shopify', shopifyWebhookHandler);
router.get('/health', healthCheck);

// Then auth middleware
router.use(authenticateStaff);

// Then protected routes
router.get('/api/products', getProducts);
```

---

## Debug Artifact Rules

No debug code ships to production. These artifacts indicate incomplete work and can leak internal state to users.

### Banned in Production Files
- `console.log()` — use structured logging instead
- `console.debug()`
- `debugger` statements
- `// TODO` / `// FIXME` / `// HACK` / `// XXX` comments

### Allowed Exceptions
- `console.error()` in error handlers — this is legitimate error logging
- `console.warn()` in deprecation notices
- Any of the above in test files (`.test.js`, `.spec.js`, `__tests__/`)

### Verification
```bash
# Check for debug artifacts in changed source files (not test files)
git diff -- '*.js' '*.jsx' | grep '^+' | grep -v '^+++' | grep -v '\.test\.' | grep -iE 'console\.(log|debug|warn|info)|debugger|TODO|FIXME|HACK|XXX' | grep -v 'console\.error'
```

---

## Error Handling

### No Silent Failures
Every `catch` block must either:
1. Log the error with context (what operation, what inputs, what tenant)
2. Re-throw the error
3. Return an explicit error response

Empty catch blocks are bugs — they hide real failures that then manifest as mysterious data corruption.

### User-Facing Error Messages
- Generic messages only — no stack traces, internal file paths, or SQL errors exposed to users
- Use structured error responses: `{ error: 'Human-readable message' }`
- Log the full error internally (with stack trace) for debugging

### Error Response Pattern
```javascript
try {
  const result = await someOperation();
  res.json(result);
} catch (err) {
  logger.error('Failed to [operation]', { tenantId, input, error: err.message, stack: err.stack });
  res.status(500).json({ error: 'An internal error occurred' });
}
```

---

## Standard Invariants (INV-1 through INV-7)

These invariants apply to every enterprise contract. They represent the baseline quality bar — violations are always bugs.

| ID | Invariant | Why It Matters |
|----|-----------|---------------|
| INV-1 | Every `INSERT` includes `tenant_id` | Multi-tenant data isolation |
| INV-2 | Every `SELECT`/`UPDATE`/`DELETE` scopes to `tenant_id` | Prevents cross-tenant data leaks |
| INV-3 | All SQL uses parameterized values (`$1`, `$2`) — zero concatenation | SQL injection prevention |
| INV-4 | No source file exceeds 400 lines (soft) / 800 lines (hard) | Code maintainability |
| INV-5 | Every new route has `authenticateStaff` (or explicit public justification) | Authorization enforcement |
| INV-6 | Every user-facing error is generic (no stack traces, no internal paths) | Security — information disclosure prevention |
| INV-7 | All timestamps use `TIMESTAMPTZ` (not `TIMESTAMP`) | Timezone correctness |

### Applying Invariants to Contracts
When writing a contract, include all 7 invariants. If one doesn't apply to the current task, mark it `N/A` with a brief justification (e.g., "INV-7: N/A — no new timestamp columns").

---

## Type Traps

### Supplier ID Mismatch
`suppliers.id` is UUID, but `products.supplier_id` is integer. When joining these tables, cast to text:
```sql
WHERE suppliers.id::text = products.supplier_id::text
```

This is a known schema inconsistency that cannot be fixed without a migration. All new code must handle it.
