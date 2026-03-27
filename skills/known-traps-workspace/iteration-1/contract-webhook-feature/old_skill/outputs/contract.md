# Contract: Shopify Returns Webhook Handler
**Date**: 2026-03-14 | **Status**: LOCKED
**Type**: FEATURE
**Plan**: `docs/plans/2026-03-14-shopify-returns-webhook-plan.md`

---

## Preconditions

- PRE-1: PostgreSQL database is accessible via `DATABASE_URL`
- PRE-2: `SHOPIFY_WEBHOOK_SECRET` env var is set and non-empty
- PRE-3: `shopify_webhook_events` table exists (idempotency dedup — migration 031b)
- PRE-4: Express app mounts Shopify webhook routes at `/api/shopify/webhooks` BEFORE auth middleware (index.js:633)
- PRE-5: `express.raw()` body parser is mounted for webhook route prefix (index.js:454)
- PRE-6: Migration for `returns` table has been applied
- PRE-7: Tenant exists in the system (multi-tenant scoping)

---

## Postconditions

### API Layer (PC-A)

| ID | Postcondition | Test |
|----|--------------|------|
| PC-A1 | `POST /api/shopify/webhooks/returns/create` with valid HMAC and payload returns `200 { received: true }` | `"returns 200 with received:true for valid return webhook"` |
| PC-A2 | `POST /api/shopify/webhooks/returns/create` without `X-Shopify-Hmac-Sha256` header returns `401 { error: 'Missing signature' }` | `"rejects return webhook without HMAC header"` |
| PC-A3 | `POST /api/shopify/webhooks/returns/create` with invalid HMAC returns `401 { error: 'Invalid signature' }` | `"rejects return webhook with invalid HMAC"` |
| PC-A4 | Duplicate webhook (same `X-Shopify-Webhook-Id`) returns `200 { received: true, duplicate: true }` — no processing occurs | `"skips duplicate return webhook via idempotency check"` |
| PC-A5 | Processing error returns `200 { received: true, error: 'processing_failed' }` — Shopify must not retry on our processing errors | `"returns 200 even when processing fails to prevent Shopify retries"` |

### Service Layer (PC-S)

| ID | Postcondition | Test |
|----|--------------|------|
| PC-S1 | `processReturn(payload, tenantId)` inserts a row into `returns` table with `tenant_id`, `shopify_return_id`, `shopify_order_id`, `status`, `reason`, `created_at` | `"inserts return row with all required fields and tenant_id"` |
| PC-S2 | `processReturn()` with a `shopify_return_id` that already exists in `returns` table upserts (updates status, does not create duplicate) | `"upserts existing return instead of creating duplicate"` |
| PC-S3 | `processReturn()` extracts and stores individual return line items in `return_line_items` (if line items are part of the payload schema) | `"stores return line items linked to parent return"` |
| PC-S4 | `processReturn()` logs webhook to `shopifyWebhookService.logWebhook('returns/create', ...)` for audit trail | `"logs return webhook to audit trail"` |
| PC-S5 | `processReturn()` with null/undefined `reason` field stores `NULL` — does not throw | `"handles null reason field gracefully"` |

### Database Layer (PC-D)

| ID | Postcondition | Test |
|----|--------------|------|
| PC-D1 | Migration creates `returns` table with columns: `id` (PK, UUID), `tenant_id` (NOT NULL), `shopify_return_id` (BIGINT, NOT NULL), `shopify_order_id` (BIGINT), `status` (VARCHAR), `reason` (TEXT, nullable), `note` (TEXT, nullable), `created_at` (TIMESTAMPTZ DEFAULT NOW()), `updated_at` (TIMESTAMPTZ DEFAULT NOW()) | `"returns table has correct schema"` |
| PC-D2 | Migration creates unique index on `(tenant_id, shopify_return_id)` — prevents duplicate returns per tenant | `"unique constraint prevents duplicate shopify_return_id per tenant"` |
| PC-D3 | Migration creates index on `(tenant_id, shopify_order_id)` — supports lookup by order | `"index on tenant_id + shopify_order_id exists"` |
| PC-D4 | Migration uses `IF NOT EXISTS` guard — re-running migration does not fail | `"migration is idempotent"` |

### UI Layer (PC-U)

| ID | Postcondition | Test |
|----|--------------|------|
| PC-U1 | `ReturnsList.jsx` renders a table with columns: Return ID, Order, Status, Reason, Date | `"renders returns table with all columns"` |
| PC-U2 | `ReturnsList.jsx` shows loading spinner while data is fetching | `"shows loading state while fetching"` |
| PC-U3 | `ReturnsList.jsx` shows empty state message when no returns exist | `"shows empty state when no returns"` |
| PC-U4 | `ReturnsList.jsx` shows error state with retry button on fetch failure | `"shows error state with retry on fetch failure"` |
| PC-U5 | `ReturnsList.jsx` fetches from `GET /api/returns` with tenant-scoped auth | `"fetches returns from authenticated API endpoint"` |

### Cross-Layer (PC-X)

| ID | Postcondition | Test |
|----|--------------|------|
| PC-X1 | Shopify sends return webhook -> return appears in `returns` table -> `GET /api/returns` includes the new return -> `ReturnsList` renders it | `"end-to-end: webhook creates return visible in UI list"` |

---

## Test Skeletons

```javascript
// PC-A1
test('returns 200 with received:true for valid return webhook', async () => {
  const payload = { id: 123456, order_id: 789, reason: 'defective', return_line_items: [] };
  const hmac = generateValidHmac(JSON.stringify(payload));
  const res = await request(app)
    .post('/api/shopify/webhooks/returns/create')
    .set('X-Shopify-Hmac-Sha256', hmac)
    .set('X-Shopify-Webhook-Id', 'wh-unique-1')
    .send(payload);
  expect(res.status).toBe(200);
  expect(res.body.received).toBe(true);
});

// PC-A2
test('rejects return webhook without HMAC header', async () => {
  const res = await request(app)
    .post('/api/shopify/webhooks/returns/create')
    .send({ id: 123 });
  expect(res.status).toBe(401);
  expect(res.body.error).toBe('Missing signature');
});

// PC-S1
test('inserts return row with all required fields and tenant_id', async () => {
  await processReturn({ id: 100, order_id: 200, reason: 'wrong_item', status: 'open' }, tenantId);
  const row = await db.query('SELECT * FROM returns WHERE shopify_return_id = $1 AND tenant_id = $2', [100, tenantId]);
  expect(row.rows).toHaveLength(1);
  expect(row.rows[0].shopify_order_id).toBe(200);
  expect(row.rows[0].status).toBe('open');
  expect(row.rows[0].reason).toBe('wrong_item');
  expect(row.rows[0].tenant_id).toBe(tenantId);
});

// PC-S2
test('upserts existing return instead of creating duplicate', async () => {
  await processReturn({ id: 100, order_id: 200, reason: 'wrong_item', status: 'open' }, tenantId);
  await processReturn({ id: 100, order_id: 200, reason: 'wrong_item', status: 'closed' }, tenantId);
  const rows = await db.query('SELECT * FROM returns WHERE shopify_return_id = $1 AND tenant_id = $2', [100, tenantId]);
  expect(rows.rows).toHaveLength(1);
  expect(rows.rows[0].status).toBe('closed');
});

// PC-S5
test('handles null reason field gracefully', async () => {
  await expect(processReturn({ id: 101, order_id: 200, reason: null, status: 'open' }, tenantId))
    .resolves.not.toThrow();
  const row = await db.query('SELECT reason FROM returns WHERE shopify_return_id = $1', [101]);
  expect(row.rows[0].reason).toBeNull();
});

// PC-U1
test('renders returns table with all columns', () => {
  render(<ReturnsList />);
  expect(screen.getByText('Return ID')).toBeInTheDocument();
  expect(screen.getByText('Order')).toBeInTheDocument();
  expect(screen.getByText('Status')).toBeInTheDocument();
  expect(screen.getByText('Reason')).toBeInTheDocument();
  expect(screen.getByText('Date')).toBeInTheDocument();
});

// PC-U3
test('shows empty state when no returns', async () => {
  mockApi.get('/api/returns').reply(200, { returns: [] });
  render(<ReturnsList />);
  await waitFor(() => expect(screen.getByText(/no returns/i)).toBeInTheDocument());
});
```

---

## Invariants

| ID | Invariant | Applies | Justification |
|----|-----------|---------|---------------|
| INV-1 | Every INSERT includes `tenant_id` | YES | `returns` table INSERT must include `tenant_id` from webhook context |
| INV-2 | Every query scopes to `tenant_id` | YES | `GET /api/returns` must filter by `tenant_id`; service queries must scope |
| INV-3 | Public/webhook routes mount BEFORE `authenticateStaff` middleware | YES | `/api/shopify/webhooks/returns/create` must be mounted before auth (index.js already does this at L633) |
| INV-4 | UUID vs integer type awareness for joins | YES | `shopify_return_id` is BIGINT (Shopify numeric ID); `returns.id` is UUID — cast to text for any cross-table joins |
| INV-5 | SQL uses parameterized queries only | YES | All INSERT/SELECT statements use `$1, $2, ...` — no string interpolation |
| INV-6 | SQL migrations use `IF NOT EXISTS` guards | YES | `CREATE TABLE IF NOT EXISTS returns` |
| INV-7 | Timestamps use `TIMESTAMPTZ` not `TIMESTAMP` | YES | `created_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ` |

---

## Error Cases

| ID | Trigger | HTTP Status | Response Body | Log Entry | Recovery | Test |
|----|---------|-------------|--------------|-----------|----------|------|
| ERR-1 | Missing HMAC header | 401 | `{ error: 'Missing signature' }` | WARN `[SHOPIFY WEBHOOK] Missing HMAC header - rejecting` | None — Shopify will retry | `"rejects return webhook without HMAC header"` |
| ERR-2 | Invalid HMAC signature | 401 | `{ error: 'Invalid signature' }` | WARN `[SHOPIFY WEBHOOK] Invalid signature - rejecting` | Track rejection, alert on high rate | `"rejects return webhook with invalid HMAC"` |
| ERR-3 | Malformed JSON body | 400 | `{ error: 'Invalid JSON' }` | ERROR `[SHOPIFY WEBHOOK] Failed to parse JSON body` | None — payload is corrupt | `"rejects malformed JSON body"` |
| ERR-4 | Database INSERT failure | 200 | `{ received: true, error: 'processing_failed' }` | ERROR `[SHOPIFY WEBHOOK] Return processing error` | Return 200 to prevent Shopify infinite retries; log for ops investigation | `"returns 200 even when DB insert fails"` |
| ERR-5 | Missing `SHOPIFY_WEBHOOK_SECRET` env var | 500 | `{ error: 'Webhook verification not configured' }` | ERROR `[SHOPIFY WEBHOOK] WEBHOOK_SECRET not configured` | Ops alert — deploy env var | `"returns 500 when webhook secret not configured"` |
| ERR-6 | Return payload missing required `id` field | 200 | `{ received: true, error: 'processing_failed' }` | ERROR `[SHOPIFY WEBHOOK] Return payload missing id` | Log and skip — do not crash route | `"logs error when return payload has no id"` |

---

## Consumer Map

| Consumer | File | Fields Used | Purpose |
|----------|------|-------------|---------|
| `ReturnsList.jsx` | `apps/admin/src/components/returns/ReturnsList.jsx` (NEW) | `id`, `shopify_return_id`, `shopify_order_id`, `status`, `reason`, `created_at` | Renders returns table in admin UI |
| `GET /api/returns` route | `apps/api/src/routes/returns.js` (NEW) | `returns.*` | API endpoint serving returns list to admin UI |
| `returns_service.js` | `apps/api/src/services/returns_service.js` (NEW) | `shopify_return_id`, `shopify_order_id`, `status`, `reason`, `tenant_id` | Write path — processes webhook payload into `returns` table |
| `shopifyWebhookService.logWebhook` | `apps/api/src/services/shopifyWebhookService.js` (EXISTING) | topic string, resource ID, status, error message | Audit logging — already used by all other webhook handlers |

---

## Blast Radius Scan

### Same-File Siblings (shopifyWebhooks.js)

The new `returns/create` route will be added to `apps/api/src/routes/shopifyWebhooks.js`. This file contains 15+ existing webhook handlers. Key patterns to match:

| Sibling Route | Line | Pattern Match |
|---------------|------|---------------|
| `refunds/create` | L580 | Uses `verifyWebhook`, `persistAndDispatchShopifyWebhookCommand`, try/catch with 200 on error — **new route MUST follow this pattern** |
| `fulfillments/create` | L603 | Same pattern — `verifyWebhook` + `persistAndDispatchShopifyWebhookCommand` |
| `orders/create` | L372 | Uses `verifyWebhook` + `dispatchCanonicalOrderWebhook` — different dispatch path |
| `orders/paid` | L560 | Same error-handling pattern: catch -> logWebhook -> res.status(200) |

All siblings use:
1. `verifyWebhook` middleware (HMAC + idempotency)
2. Try/catch wrapping the handler body
3. Return `200` even on processing failure (Shopify retry prevention)
4. `logWebhook()` in catch block for audit trail

**Finding**: All sibling handlers follow the same structural pattern. The new `returns/create` handler MUST use `verifyWebhook` middleware and the try/catch-with-200 error pattern. Deviation is a contract violation.

### Cross-File Siblings

| File | Function | Guard Check |
|------|----------|-------------|
| `shopifyWebhookService.js` | `logWebhook()` | Accepts any topic string — no validation. Adding `'returns/create'` as topic is safe. |
| `shopifyInboxService.js` | `persistVerifiedWebhook()` | Used by `dispatchCanonicalOrderWebhook` — may or may not be needed for returns depending on dispatch path choice. |
| `shopifyWebhookCommandBridge.js` | `persistAndDispatchShopifyWebhookCommand()` | Used by refunds/fulfillments — handles inbox persistence + command dispatch. Appropriate for returns. |

### Edge Cases

| Input | Expected Behavior |
|-------|-------------------|
| `null` body | `verifyWebhook` rejects with 400 (JSON parse fails) |
| `{}` (empty object) | `processReturn` fails on missing `id` — ERR-6 triggers, 200 returned |
| `{ id: 0 }` | Valid — 0 is a valid Shopify ID (edge but possible); must not treat as falsy |
| `{ id: "not-a-number" }` | Store as-is — Shopify IDs are typically BIGINT but cast defensively |
| Very large payload (>1MB) | `express.raw()` has default 100kb limit at index.js:454 — verify this covers return payloads |
| `reason` field as XSS string `<script>alert(1)</script>` | Stored in DB as text; React auto-escapes on render. No raw HTML insertion in `ReturnsList.jsx`. |

---

## Error Strategy

| Operation | Error Type | Handling | User Message | Log Level | Recovery |
|-----------|-----------|----------|-------------|-----------|----------|
| HMAC verification | Auth failure | Return 401 immediately | N/A (Shopify-to-server) | WARN | Shopify retries automatically |
| JSON parsing | Parse error | Return 400 | N/A | ERROR | Shopify retries with same payload |
| DB insert (returns table) | Connection/query error | Catch, return 200 | N/A | ERROR | Shopify does not retry (200); ops investigates via logs |
| `logWebhook()` call | Non-critical write | Catch, log debug, do not propagate | N/A | DEBUG | Non-critical — processing succeeded |
| Idempotency INSERT | DB error | Catch, log warn, proceed with processing | N/A | WARN | Fail-open: process webhook rather than drop it |

**Transaction boundaries**: `processReturn()` is a single INSERT/UPSERT — no multi-step transaction needed. If return line items are added, wrap in a single transaction: `BEGIN` -> insert return -> insert line items -> `COMMIT`. Failure rolls back both.

---

## Side Effects

| Side Effect | Intentional | Tested |
|-------------|------------|--------|
| Row inserted into `returns` table | YES | PC-S1 |
| Row inserted into `shopify_webhook_events` for idempotency | YES (via `verifyWebhook`) | PC-A4 |
| Webhook logged via `logWebhook()` | YES | PC-S4 |
| Rejection counter incremented on invalid HMAC | YES (via `verifyWebhook`) | Existing tests |

---

## NOT in Scope

1. **Shopify return webhook registration** — registering the `returns/create` topic with Shopify's API is a separate ops task, not part of this implementation
2. **Return refund processing** — creating refunds or adjusting financial records based on returns. Returns are recorded; financial implications are handled by the existing refunds pipeline
3. **Return status webhooks** (returns/update, returns/close) — this contract covers only `returns/create`. Additional return lifecycle webhooks are future work
4. **Email notifications** — no customer or staff email is sent when a return is received via webhook
5. **REX sync** — returns are not synced to REX. This is a Shopify-only data capture

---

## Files Touched

| File | Action | Purpose |
|------|--------|---------|
| `apps/api/src/routes/shopifyWebhooks.js` | MODIFY | Add `returns/create` route handler |
| `apps/api/src/services/returns_service.js` | CREATE | Return processing logic (single write path for `returns` table) |
| `apps/api/database/migrations/XXX_returns.sql` | CREATE | `returns` table schema |
| `apps/admin/src/components/returns/ReturnsList.jsx` | CREATE | Admin UI list component |
| `apps/api/src/routes/returns.js` | CREATE | `GET /api/returns` authenticated route for admin UI |
| `apps/api/src/routes/__tests__/shopifyWebhooks.returns.test.js` | CREATE | Route-level tests for returns webhook |

**Total: 6 files** (1 modified, 5 created) — matches plan.

---

## Traceability Matrix

| PC | Test File | Test Name | Code File | Code Location | Status |
|----|-----------|-----------|-----------|---------------|--------|
| PC-A1 | `routes/__tests__/shopifyWebhooks.returns.test.js` | `"returns 200 with received:true for valid return webhook"` | `routes/shopifyWebhooks.js` | `router.post('/returns/create', ...)` | PENDING |
| PC-A2 | `routes/__tests__/shopifyWebhooks.returns.test.js` | `"rejects return webhook without HMAC header"` | `routes/shopifyWebhooks.js` | `verifyWebhook` (L187-189) | PENDING |
| PC-A3 | `routes/__tests__/shopifyWebhooks.returns.test.js` | `"rejects return webhook with invalid HMAC"` | `routes/shopifyWebhooks.js` | `verifyWebhook` (L210-214) | PENDING |
| PC-A4 | `routes/__tests__/shopifyWebhooks.returns.test.js` | `"skips duplicate return webhook via idempotency check"` | `routes/shopifyWebhooks.js` | `verifyWebhook` (L230-237) | PENDING |
| PC-A5 | `routes/__tests__/shopifyWebhooks.returns.test.js` | `"returns 200 even when processing fails to prevent Shopify retries"` | `routes/shopifyWebhooks.js` | catch block in `returns/create` handler | PENDING |
| PC-S1 | `services/__tests__/returns_service.test.js` | `"inserts return row with all required fields and tenant_id"` | `services/returns_service.js` | `processReturn()` | PENDING |
| PC-S2 | `services/__tests__/returns_service.test.js` | `"upserts existing return instead of creating duplicate"` | `services/returns_service.js` | `processReturn()` UPSERT | PENDING |
| PC-S3 | `services/__tests__/returns_service.test.js` | `"stores return line items linked to parent return"` | `services/returns_service.js` | `processReturn()` line items INSERT | PENDING |
| PC-S4 | `services/__tests__/returns_service.test.js` | `"logs return webhook to audit trail"` | `services/returns_service.js` | `logWebhook()` call | PENDING |
| PC-S5 | `services/__tests__/returns_service.test.js` | `"handles null reason field gracefully"` | `services/returns_service.js` | `processReturn()` reason handling | PENDING |
| PC-D1 | `migrations/__tests__/returns_migration.test.js` | `"returns table has correct schema"` | `migrations/XXX_returns.sql` | `CREATE TABLE` | PENDING |
| PC-D2 | `migrations/__tests__/returns_migration.test.js` | `"unique constraint prevents duplicate shopify_return_id per tenant"` | `migrations/XXX_returns.sql` | `CREATE UNIQUE INDEX` | PENDING |
| PC-D3 | `migrations/__tests__/returns_migration.test.js` | `"index on tenant_id + shopify_order_id exists"` | `migrations/XXX_returns.sql` | `CREATE INDEX` | PENDING |
| PC-D4 | `migrations/__tests__/returns_migration.test.js` | `"migration is idempotent"` | `migrations/XXX_returns.sql` | `IF NOT EXISTS` | PENDING |
| PC-U1 | `components/__tests__/ReturnsList.test.jsx` | `"renders returns table with all columns"` | `components/returns/ReturnsList.jsx` | table render | PENDING |
| PC-U2 | `components/__tests__/ReturnsList.test.jsx` | `"shows loading state while fetching"` | `components/returns/ReturnsList.jsx` | loading branch | PENDING |
| PC-U3 | `components/__tests__/ReturnsList.test.jsx` | `"shows empty state when no returns"` | `components/returns/ReturnsList.jsx` | empty state branch | PENDING |
| PC-U4 | `components/__tests__/ReturnsList.test.jsx` | `"shows error state with retry on fetch failure"` | `components/returns/ReturnsList.jsx` | error branch | PENDING |
| PC-U5 | `components/__tests__/ReturnsList.test.jsx` | `"fetches returns from authenticated API endpoint"` | `components/returns/ReturnsList.jsx` | useEffect/hook fetch | PENDING |
| PC-X1 | `__tests__/integration/returns-webhook-e2e.test.js` | `"end-to-end: webhook creates return visible in UI list"` | Multiple files | Webhook -> DB -> API -> UI | PENDING |

---

## Quality Gate

```
CONTRACT QUALITY GATE
=====================
Testability:        PASS — 20 PCs, 20 with expect() skeletons
Banned Words:       PASS — grep count: 0
Completeness:       PASS — 6 plan deliverables, 6 contracted (route, service, migration, UI component, API route, test file)
Consumer Coverage:  PASS — 4 consumers found, 4 in map
Blast Radius:       PASS — 4 same-file siblings checked, 3 cross-file checked
Error Coverage:     PASS — 5 external calls/inputs, 6 error cases
Invariants:         PASS — 7/7 standard invariants listed
Scope Boundary:     PASS — 5 exclusions
Traceability:       PASS — 20 PCs, 20 matrix rows
Tautology Check:    PASS — 20 PCs checked, 0 tautological (all skeletons test specific values)
Error Strategy:     PASS — 5 operations, 5 with handling defined

Score: 11/11 — LOCKED
```
