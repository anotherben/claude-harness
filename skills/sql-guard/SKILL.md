---
name: sql-guard
description: SQL safety checker for database queries and migrations. This skill should be used before writing or modifying any SQL query, database migration, or code that constructs SQL strings. It enforces multi-tenant scoping, parameterized queries, correct timestamp types, IF NOT EXISTS guards, and type-safe joins. Invoke this skill when writing INSERT/UPDATE/DELETE statements, creating migrations, modifying database queries, joining tables with mixed ID types, or when any code touches the database layer. Even for "simple SELECT queries", invoke this — tenant scoping bugs are silent and ship to production undetected.
---

# SQL Guard

A pre-edit checker for all SQL and database code. These rules have zero automated enforcement but cause the most insidious production bugs — tenant isolation violations, type mismatches, and unsafe query construction.

## Before Writing Any SQL

1. **Read the Prisma schema** at `prisma/schema.prisma` for the authoritative model definitions, relations, and field types. That file is the source of truth for which models have tenant scoping fields and which don't.

2. **Explore the actual service/route file** that already queries the tables you are about to use. Column names, query patterns, and scoping conventions vary — do not guess:
   - Use `Grep` to find which files query that table
   - Use `Read` to pull the specific query function
   - Use `Glob` to find related service files

3. **Verify the migration files** for any table you are adding columns to or creating indexes on:
   - Search `prisma/migrations/` for the relevant migration
   - This confirms the actual column types, existing indexes, and constraints

## The Pre-Write Checklist

Run through every item before writing or modifying database code. Skipping even one item has caused production bugs.

### 1. Tenant Isolation

**The #1 silent bug.** A missing tenant scoping field in a WHERE clause leaks data across tenants with zero errors.

- Every `INSERT` into a tenant-scoped table includes the scoping field (e.g., `dealerId`)
- Every `SELECT` / `UPDATE` / `DELETE` on a tenant-scoped table has the appropriate `WHERE` clause (or joins to a table that does)
- **Check the Prisma schema** to confirm whether each model has a tenant scoping field — don't guess

### 2. Parameterized Queries

**The #1 security vulnerability.** Template literals in SQL strings = SQL injection.

- All user-supplied values use parameterized placeholders (`$1`, `$2`, etc. for raw SQL, or Prisma's built-in parameterization)
- NEVER use template literals (`${value}`) inside SQL strings — not even for "known safe" values
- For `IN` clauses: build placeholder list dynamically, not string concatenation:
  ```typescript
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
  const result = await prisma.$queryRawUnsafe(
    `SELECT * FROM "Table" WHERE id IN (${placeholders})`,
    ...ids
  );
  ```
- For dynamic column/table names (rare): whitelist against an explicit array of known values, never interpolate
- Prefer Prisma's query builder over raw SQL wherever possible — it handles parameterization automatically

### 3. Timestamp Types

**The timezone trap.** Ensure consistency between server timezone and business timezone.

- Always use `TIMESTAMPTZ`, never `TIMESTAMP`, in DDL
- Date filtering pattern for timezone-aware queries:
  ```sql
  WHERE created_at >= $1::DATE::TIMESTAMP AT TIME ZONE 'Your/Timezone'
    AND created_at < ($1::DATE + INTERVAL '1 day')::TIMESTAMP AT TIME ZONE 'Your/Timezone'
  ```
- The `::TIMESTAMP` cast before `AT TIME ZONE` is mandatory — `DATE AT TIME ZONE` without it shifts in the wrong direction on UTC servers
- **CURRENT_DATE trap**: `CURRENT_DATE` returns the UTC date, which may be wrong for your business timezone. For "today" queries use:
  ```sql
  (CURRENT_TIMESTAMP AT TIME ZONE 'Your/Timezone')::date
  ```

### 4. Migration Safety

- `CREATE TABLE IF NOT EXISTS` — always
- `ADD COLUMN IF NOT EXISTS` — wrap in DO block:
  ```sql
  DO $$ BEGIN
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number TEXT;
  EXCEPTION WHEN duplicate_column THEN NULL;
  END $$;
  ```
- `CREATE INDEX IF NOT EXISTS` — and NEVER inside a transaction if using `CONCURRENTLY`
- Check next migration number: verify with `ls prisma/migrations/ | tail -5`
- Migration file exists does NOT mean it was run. Verify with `\d table_name` on the actual database if uncertain.

**Rollback safety**: Every migration should be reversible or at minimum non-destructive:
- `ADD COLUMN` is safe (reversible with `DROP COLUMN`)
- `DROP COLUMN` is NOT reversible — gate behind explicit user confirmation
- `ALTER COLUMN TYPE` may lose data — add a comment noting the original type
- `CREATE INDEX CONCURRENTLY` can fail partway — always use `IF NOT EXISTS` so re-running is safe

**Dev vs production**: Migrations run on the dev database first. Production migrations are a separate deploy step. Never assume a migration that ran on dev has run on production — check the deploy notes.

**Operating a rollout against shared prod infra (lock cascade trap)**: DDL taking `ACCESS
EXCLUSIVE` (ALTER TABLE, DROP/CREATE MATERIALIZED VIEW) on the shared app pool head-of-line
blocks every concurrent reader — each queued SELECT trips its own `lock_timeout` (55P03
cascade across unrelated tables is the signature; confirm with
`SELECT applied_at, filename FROM schema_migrations WHERE applied_at BETWEEN <window>`).
Rules:
- Transactional DDL MUST go through the single owner
  `apps/api/src/services/migrations/migrationLockTimeout.js`
  (`runTransactionalDdlWithLockTimeout`, `SET LOCAL lock_timeout='750ms'` + bounded retry) —
  never raw pool clients. `CREATE INDEX CONCURRENTLY` stays unwrapped (and outside txns).
- `lock_timeout` bounds lock *acquisition* only — a table-rewrite DDL still blocks while it
  holds the lock; use online-DDL patterns for rewrites.
- Never run out-of-band manual migration runs against prod during business hours; prod does
  NOT migrate on boot, so a migration inside an incident window proves a manual run.

### 5. Type-Safe Joins

Mixed column types cause silent bugs. Never rely on implicit PostgreSQL coercion — always cast explicitly when types differ.

Common traps:
- UUID fields vs integer fields — joins require casting to a common type (usually text)
- String IDs from external systems vs internal integer IDs
- BigInt fields from external APIs vs VARCHAR storage columns

**Always check the Prisma schema** to confirm the actual types of both sides of a join before writing it.

### 6. Batch/Bulk Operations

- Use `unnest()` for bulk inserts (more efficient than VALUES lists for large batches):
  ```sql
  INSERT INTO items (sku, name, price)
  SELECT * FROM unnest($1::text[], $2::text[], $3::numeric[])
  ON CONFLICT (sku) DO UPDATE SET name = EXCLUDED.name, price = EXCLUDED.price;
  ```
- Use `VALUES` lists for small batches (under ~50 rows)
- Bound all queries — add `LIMIT` or date windows to prevent unbounded table scans
- For large result sets, use cursor-based pagination (`WHERE id > $last_id ORDER BY id LIMIT $page_size`)

## Post-Write Review Checklist

After writing any SQL query or migration, run through these 8 items. This takes 30 seconds and catches the mistakes that pass code review:

1. **Tenant scoped?** Every tenant-scoped table in the query has the appropriate WHERE clause
2. **Parameterized?** Zero template literals inside SQL strings
3. **Types match?** Every JOIN and WHERE comparison uses matching types (or explicit casts)
4. **Timestamps correct?** `TIMESTAMPTZ` in DDL, `AT TIME ZONE` pattern in queries, no bare `CURRENT_DATE`
5. **Bounded?** Query has `LIMIT`, date window, or pagination — no unbounded scans
6. **Idempotent?** Migration uses `IF NOT EXISTS` / `IF EXISTS` guards
7. **Column names real?** Every column name was verified by reading the actual Prisma schema or migration file
8. **CONCURRENTLY safe?** If using `CREATE INDEX CONCURRENTLY`, it is NOT inside a transaction block

## Quick Reference: Safe Patterns

```sql
-- Safe INSERT with tenant scoping
INSERT INTO "FirearmItem" ("dealerId", "serialNumber", "make", "model")
VALUES ($1, $2, $3, $4)
RETURNING id;

-- Safe date filtering (timezone-aware)
WHERE "createdAt" >= $1::DATE::TIMESTAMP AT TIME ZONE 'Your/Timezone'
  AND "createdAt" < ($1::DATE + INTERVAL '1 day')::TIMESTAMP AT TIME ZONE 'Your/Timezone'

-- Safe "today" query (timezone-aware)
WHERE "createdAt" >= (CURRENT_TIMESTAMP AT TIME ZONE 'Your/Timezone')::date::TIMESTAMP AT TIME ZONE 'Your/Timezone'

-- Safe type-mismatched comparison
WHERE "externalId"::text = $1::text

-- Safe migration column add
DO $$ BEGIN
  ALTER TABLE "FirearmItem" ADD COLUMN IF NOT EXISTS tracking_number TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Safe bulk insert with unnest
INSERT INTO items (sku, name, price)
SELECT * FROM unnest($1::text[], $2::text[], $3::numeric[])
ON CONFLICT (sku) DO UPDATE SET name = EXCLUDED.name, price = EXCLUDED.price;

-- Safe parameterized IN clause
const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
const result = await prisma.$queryRawUnsafe(
  `SELECT * FROM "FirearmItem" WHERE id IN (${placeholders})`,
  ...ids
);
```
