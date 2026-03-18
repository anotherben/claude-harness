---
name: deploy-checklist
description: Use when preparing to deploy code to production, merging to main, running migrations on production databases, or setting environment variables on hosting platforms. Use when the user mentions "deploy", "push to production", "merge to main", "run migrations", or asks about pending deploy items. Also use when reviewing what needs to happen before a feature goes live.
---

# Deploy Checklist

## Overview

A structured pre-deployment validation process that ensures nothing is missed when moving code from dev to production. Deployments have many moving parts (migrations, env vars, feature flags, service restarts) and forgetting any one can cause downtime or data loss.

## When to Use

- Before merging dev to main
- Before running migrations on production DB
- Before setting/changing env vars on hosting platform
- When user asks "what needs to be deployed" or "is this ready for prod"

## When NOT to Use

- Local development workflow
- Pushing to dev branch (that's normal workflow)
- Running migrations on dev DB (lower risk)

## Pre-Deploy Validation Checklist

### 1. Code Readiness

- [ ] All changes committed to dev branch
- [ ] All tests passing (run full test suite)
- [ ] No debug code (console.log, debugger statements)
- [ ] No hardcoded URLs or credentials
- [ ] `git diff dev..main` reviewed — understand what's changing

### 2. Migration Safety

Check pending migrations:
```bash
# List migration files
ls <migration-directory>/

# Compare against what's been run (check production DB)
# Migrations are sequential — run in order, never skip
```

For each pending migration:
- [ ] Uses `IF NOT EXISTS` / `IF EXISTS` guards
- [ ] Uses `TIMESTAMPTZ` (not `TIMESTAMP`)
- [ ] Parameterized queries only (no string interpolation)
- [ ] Backward compatible (old code works with new schema during rollout)
- [ ] Has rollback plan (what to run if migration fails)

### 3. Environment Variables

Before deploying, check if new env vars are needed:
```bash
# Compare .env keys between branches
diff <(grep -oP '^[A-Z_]+=' .env | sort) <(grep -oP '^[A-Z_]+=' .env.example | sort)
```

For each new env var:
- [ ] Value set on hosting platform (use safe update methods — never overwrite all vars)
- [ ] Default/fallback in code if var is optional
- [ ] Documented in .env.example

**CRITICAL**: When updating env vars on hosting platforms, use PATCH/append operations. Some platforms (like Render) will WIPE ALL existing variables if you use PUT.

### 4. Dependency Check

- [ ] No new packages that need installation on production
- [ ] If new packages exist, verify they're in package.json/requirements.txt (not just locally installed)
- [ ] Check for breaking version changes in updated packages

### 5. Feature Flags

- [ ] New features behind flags default to OFF
- [ ] Flag names documented
- [ ] Rollout plan defined (which flags to enable, in what order)

### 6. Database Extensions

Check if new extensions are needed:
- `pgcrypto` — for UUID generation
- `pg_trgm` — for fuzzy text search
- Verify extension exists on production before running migrations that depend on it

### 7. Deploy Sequence

Execute in this exact order:
1. Set env vars on hosting platform
2. Install DB extensions if needed
3. Run migrations in batch order
4. Push code to main
5. Verify service restarts successfully
6. Run smoke test (hit key API endpoints)
7. Monitor logs for 15 minutes

### 8. Rollback Plan

Before deploying, document:
- [ ] What to revert if something breaks
- [ ] Which migrations have rollback SQL
- [ ] Previous known-good commit hash
- [ ] Who to notify if rollback is needed

## Post-Deploy Verification

- [ ] API responds on production URL
- [ ] Key endpoints return expected data
- [ ] No new errors in logs
- [ ] Cron jobs running on schedule
- [ ] Background workers processing queue

## Common Mistakes

| Mistake | Impact | Prevention |
|---------|--------|------------|
| Overwriting all env vars (PUT instead of PATCH) | Wipes ALL vars, full outage | Always PATCH/append |
| Skip migration order | Foreign key violations, data loss | Run in sequence |
| Deploy without env vars | Features crash on missing config | Set vars BEFORE push |
| No rollback plan | Extended downtime | Document rollback for each migration |
| Push to master directly | Bypasses CI, no review | Always merge via PR or controlled push |
