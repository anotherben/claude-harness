# Change Type Taxonomy

For each change type, this reference gives the adaptive trace pattern: what to fan out to, what
assumptions each touchpoint typically makes, and the classes of bugs to look for. A change can be
multiple types — run each applicable pattern.

## Table of Contents

1. [Database schema change](#1-database-schema-change)
2. [API route change](#2-api-route-change)
3. [Service method signature change](#3-service-method-signature-change)
4. [Validation / business logic change](#4-validation--business-logic-change)
5. [Config / env var / feature flag change](#5-config--env-var--feature-flag-change)
6. [Auth / permission / multi-tenancy change](#6-auth--permission--multi-tenancy-change)
7. [Type / interface change](#7-type--interface-change)
8. [Refactor (rename, move file)](#8-refactor-rename-move-file)
9. [Test change](#9-test-change)
10. [External integration change](#10-external-integration-change)

---

## 1. Database schema change

**What counts**: migration files, column add/remove/rename, type changes, NOT NULL changes, default
changes, index changes, FK changes, partitioning changes.

**Why it's high blast**: SQL is stringly-typed. The compiler doesn't catch a query referencing a
deleted column — production does, the first time the query runs.

**Trace pattern (exhaustive, not depth-limited)**:

1. **List affected tables and columns** from the migration SQL.
2. **Find every SQL string referencing those columns**:
   ```bash
   grep -rn "\b<column_name>\b" apps/api/src/ --include='*.js'
   grep -rn "FROM <table>" apps/api/src/
   grep -rn "INSERT INTO <table>" apps/api/src/
   grep -rn "UPDATE <table>" apps/api/src/
   ```
   Repeat for camelCase if the column has multiple representations.
3. **Find ORM/model definitions** that mirror the table.
4. **Find typed clients / JSDoc / TypeScript types** that mirror row shape.
5. **Find serializers** (response shapers) referencing the column.
6. **Find background jobs / workers / cron** that read the table.
7. **Find external integrations** (Shopify sync, REX sync) that map to the column.
8. **Find tests** asserting column existence/shape.
9. **Verify live schema** against every assumption (see SKILL.md Step 4).

**Bug classes to look for**:
- Code references a column that doesn't exist on live (drift)
- Code assumes NOT NULL but live allows NULL (or vice versa)
- Code assumes type `int` but live is `bigint` or `text`
- Cross-table join uses `WHERE a.id = b.foo_id` where types don't match (see CLAUDE.md type traps)
- Serializer drops a renamed column silently → empty response field, frontend breaks
- Index dropped without removing the query that depended on it → silent slowdown
- DEFAULT removed without the code supplying a value → NULL violation on insert

**Stop conditions**: when you've covered every SQL string for the affected columns AND every
serializer/type that mirrors the row. Not 2-hop limited.

---

## 2. API route change

**What counts**: route path change, method change, request body shape, query param change, response
shape, status code change, middleware change.

**Trace pattern**:

1. **Find route registration** in `apps/api/src/routes/` and confirm mount path.
2. **Find clients** — frontend fetchers, mobile clients, other services, webhooks calling this route.
   ```bash
   grep -rn "<route-path>" apps/admin/src/
   grep -rn "<route-path>" apps/api/src/services/  # internal callers
   ```
3. **Find contract tests** (`__tests__/routes/<route>.test.js`).
4. **Find OpenAPI/typed clients** if any exist.
5. **Find the middleware chain** the route mounts under — does the change interact with auth, tenant
   scoping, rate limiting, body parsing?

**Bug classes**:
- Response shape changes (field renamed, removed, type changed) → silent frontend null
- Status code changes (200 → 201, 400 → 422) → client retry logic breaks
- Required vs optional body fields swapped → validation silently passes/fails
- Mounted before vs after `authenticateStaff` middleware (per CLAUDE.md: public/webhook routes MUST
  mount before)
- Bulk variant of route exists with different validation
- Webhook signature change without updating all webhook handlers

---

## 3. Service method signature change

**What counts**: parameter add/remove, parameter type change, parameter reorder, return shape change,
async/sync change.

**Trace pattern**:

1. **`cortex_find_references`** on the symbol — this is the gold-standard tool.
2. **`cortex_find_importers`** on the module — catches callers that destructure.
3. **Find mocks in tests**: `grep -rn "jest.mock.*<module>" apps/api/src/`. A mock with a stale
   signature will silently pass tests while production fails.
4. **Find re-exports** — services often re-export through `index.js`. Check both the original and
   re-export paths.
5. **Find destructured imports** — `const { methodName } = require(...)`. These survive a return-shape
   change with no compile error.

**Bug classes**:
- Caller passes args in the old order (positional → silent type mismatch)
- Caller relies on a removed field in the return value (undefined, then a downstream crash)
- Default param drift — caller passes `undefined`, function now requires the param
- Mock signature diverges from real → green tests, broken prod
- Async change — caller doesn't `await` the new promise (fire-and-forget bugs)

---

## 4. Validation / business logic change

**What counts**: a `WHERE` clause change, a status check, a permission check, a calculation, a
mapping from external → internal codes.

**Why it's the WHACK-A-MOLE category**: the bug almost certainly exists in 2–5 sibling files doing
the same thing slightly differently. Fixing one without finding the others IS whack-a-mole.

**Trace pattern**:

1. **Characterize the pattern**, not the instance:
   - Instance: "Order route checks `status !== 'cancelled'`"
   - Pattern: "Route handlers filtering orders by status"
2. **Find siblings**:
   ```bash
   # All places where order status is checked
   grep -rn "status.*===.*'cancelled'" apps/api/src/
   grep -rn "status.*!==.*'cancelled'" apps/api/src/
   # All places that filter orders
   grep -rn "WHERE.*status" apps/api/src/
   ```
3. **Bulk variants** — for every single-record route, find its bulk variant. They almost always have
   different validation paths.
4. **Cron / worker variants** — the same logic often appears in a sync job.
5. **Tests asserting old behavior** — these will pass for the wrong reason after the fix.

**Bug classes**:
- Single-record route fixed but `/bulk` route still wrong
- API route fixed but background sync job still wrong
- Validation in route but not in service (or vice versa) → bypass via different entry
- Test asserts the BUG behavior — it will turn red and someone will "fix" it back

---

## 5. Config / env var / feature flag change

**What counts**: env var name/value, `config.*` key, GrowthBook/LaunchDarkly flag, JSON config file.

**Trace pattern**:

1. **Find every reader**:
   ```bash
   grep -rn "process.env.<VAR>" apps/
   grep -rn "config\.<key>" apps/
   grep -rn "<flag-key>" apps/  # for feature flags, also check the literal key string
   ```
2. **Deployment configs**: `.env.example`, `render.yaml`, `apps/api/scripts/render-env-guard.md`,
   K8s configs, Dockerfile.
3. **Docs**: `docs/`, `README.md`, runbooks — anywhere the var is mentioned.
4. **Hooks / CI**: GitHub Actions workflows, pre-commit hooks, deploy scripts.

**Bug classes**:
- Renamed env var → reader still looks up old name, gets `undefined`, silent fallback
- Flag rolled to 100% but cleanup path still has the off-branch
- `.env.example` and prod render env diverge — devs work locally, prod 500s
- **Render env vars (per CLAUDE.md)**: PUT wipes all vars. If the change involves Render env, the
  blast radius MUST include the warning that ONLY append/patch is safe.

---

## 6. Auth / permission / multi-tenancy change

**What counts**: middleware change, role check, tenant_id scoping, JWT field, session shape, RBAC
role definition.

**Why it's nuclear**: a single missed touchpoint is a tenant leak or auth bypass.

**Trace pattern (cross-cutting — depth limit DOES NOT apply)**:

1. **Walk every route** in `apps/api/src/routes/` and group by middleware chain.
2. **For tenant_id changes**, grep every SELECT/INSERT/UPDATE/DELETE on tenant-anchored tables and
   verify each has `WHERE tenant_id = $X` or an equivalent join.
3. **Find middleware mount order** — per CLAUDE.md, public/webhook routes MUST mount BEFORE
   `authenticateStaff`. A new middleware mounted in the wrong order is a vulnerability.
4. **Find JWT payload shape** if it changed, then find every consumer of the payload.
5. **Check the master-data tables** (`products`, `suppliers`) per the supplier-margin-tenant-isolation
   decision doc — they're NOT tenant-partitioned today, so tenant checks must come via FK joins.

**Bug classes**:
- A route forgot tenant scoping → cross-tenant read
- A worker iterates all rows without tenant filter → cross-tenant mutation
- Middleware order wrong → unauthenticated access
- JWT field renamed → all session reads break, users logged out

---

## 7. Type / interface change

**What counts**: TypeScript interface, JSDoc `@typedef`, JSON schema, OpenAPI schema, validation
schema (Zod, Joi).

**Trace pattern**:

1. **Symbol references** via cortex.
2. **Find JSON schemas** that mirror the type (validation schemas, OpenAPI).
3. **External consumers**: published TypeScript types, mobile clients, partner integrations.
4. **Serializers** — if the type is on the API boundary, serializers shape into it.

**Bug classes**:
- Code compiles (or JS doesn't even check) but validator now rejects what was previously accepted
- External consumer (mobile, partner) breaks because the published type changed

---

## 8. Refactor (rename, move file)

**What counts**: identifier rename, file move, module reorg, default → named export change.

**Trace pattern**:

1. **Static imports**: cortex_find_importers.
2. **Dynamic imports**: `grep -rn "require.*['\"].*<basename>" apps/` — this catches `require(path)`
   with dynamic strings.
3. **Build configs**: `package.json` (bin, main), `tsconfig.json` paths, `vite.config.js` aliases.
4. **CI / scripts**: any script that references the file path.
5. **Docs**: `docs/`, `MEMORY.md`, `CLAUDE.md` — markdown links rot silently.
6. **Tests**: test file paths often mirror source file paths.

**Bug classes**:
- Dynamic require with stale string → ModuleNotFoundError in prod only
- Symlinked or aliased path didn't update
- Docs / handovers reference the old path → future agents follow stale links

---

## 9. Test change

**What counts**: test removal, test rename, test rewrite, mock change.

**Trace pattern**:

1. **What does the test cover?** Find the SUT (system under test) and trace its references.
2. **Find similar tests** — if you're removing a test for `featureX`, are there other tests covering
   the same path?
3. **Find what the test was guarding**. If it was added in a specific PR (`git log` on the test
   file), what bug did it catch?

**Bug classes**:
- Test removed without replacement → regression slip
- Mock updated to match new behavior, masking the production divergence
- Test renamed and someone weakens the assertion

---

## 10. External integration change

**What counts**: Shopify webhook handler, REX SOAP call, Stripe payment, third-party API call.

**Trace pattern**:

1. **Find every site that calls this integration**.
2. **Find webhook signature verification** — did the change touch the verification path?
3. **Find retry / queue logic** — exponential backoff, dead letter queue, idempotency keys.
4. **Find rate limit / quota tracking**.
5. **Find tests against real vs mock** — flag any mock-only tests as HIGH risk.

**Bug classes**:
- Webhook signature verification skipped on a specific path
- Retry retries a 4xx that should NOT retry, exhausting quota
- Idempotency key changed, causing duplicate charges / orders
- New rate-limit field not respected by the client
